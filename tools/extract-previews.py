#!/usr/bin/env python3
"""Extract MK64 course preview thumbnails from a local US ROM (standard library only).

Usage: python3 tools/extract-previews.py ROM --metadata /path/to/mk64/assets/course_previews.json
The 16 race previews + 4 battle previews are MIO0-compressed rgba16 blocks (the metadata
rom_offset points at the 'MIO0' header; see assets/include/course_previews.mk) and map to
the web front end's TRACKS ids. Output: public/mk64/menu/previews/<id>.png
"""
import argparse
import hashlib
import importlib.util
import json
from pathlib import Path
import struct
import zlib

spec = importlib.util.spec_from_file_location('karts', Path(__file__).with_name('extract-karts.py'))
karts = importlib.util.module_from_spec(spec)
spec.loader.exec_module(karts)

US_SHA1 = '579c48e211ae952530ffc8738709f078d5dd215e'

# course_previews.json symbol -> (web track id)
RACE = {
    'gTextureCoursePreviewMarioRaceway': 'mario',
    'gTextureCoursePreviewChocoMountain': 'choco',
    'gTextureCoursePreviewBowsersCastle': 'bowser',
    'gTextureCoursePreviewBansheeBoardwalk': 'banshee',
    'gTextureCoursePreviewYoshiValley': 'yoshi',
    'gTextureCoursePreviewFrappeSnowland': 'frappe',
    'gTextureCoursePreviewKoopaTroopaBeach': 'koopa',
    'gTextureCoursePreviewRoyalRaceway': 'royal',
    'gTextureCoursePreviewLuigiRaceway': 'luigi',
    'gTextureCoursePreviewMooMooFarm': 'moomoo',
    'gTextureCoursePreviewToadsTurnpike': 'toad',
    'gTextureCoursePreviewKalimariDesert': 'kalimari',
    'gTextureCoursePreviewSherbetLand': 'sherbet',
    'gTextureCoursePreviewRainbowRoad': 'rainbow',
    'gTextureCoursePreviewWarioStadium': 'wario',
    'gTextureCoursePreviewDksJungleParkway': 'dk',
}
BATTLE = {
    'gTextureCoursePreviewBlockFort': 'block-fort',
    'gTextureCoursePreviewSkyscraper': 'skyscraper',
    'gTextureCoursePreviewDoubleDeck': 'double-deck',
    'gTextureCoursePreviewBigDonut': 'big-donut',
}


def rgba16_to_rgba8888(pixels):
    out = bytearray()
    for (pixel,) in struct.iter_unpack('>H', pixels):
        channels = [(pixel >> shift) & 31 for shift in (11, 6, 1)]
        out += bytes([round(c * 255 / 31) for c in channels] + [255 * (pixel & 1)])
    return bytes(out)


def png(width, height, rgba):
    def chunk(kind, data):
        return struct.pack('>I', len(data)) + kind + data + struct.pack('>I', zlib.crc32(kind + data))
    stride = width * 4
    scanlines = b''.join(b'\0' + rgba[y * stride:(y + 1) * stride] for y in range(height))
    return (b'\x89PNG\r\n\x1a\n'
            + chunk(b'IHDR', struct.pack('>IIBBBBB', width, height, 8, 6, 0, 0, 0))
            + chunk(b'IDAT', zlib.compress(scanlines, 9)) + chunk(b'IEND', b''))


def extract(rom_path, metadata, output):
    rom = rom_path.read_bytes()
    if hashlib.sha1(rom).hexdigest() != US_SHA1:
        raise ValueError('ROM is not the supported big-endian Mario Kart 64 USA revision')
    assets = json.loads(Path(metadata).read_text())
    output = Path(output)
    output.mkdir(parents=True, exist_ok=True)
    manifest = {'romSha1': US_SHA1, 'metadataSource': 'n64decomp/mk64/assets/course_previews.json',
                'previews': {}}
    for symbol, track_id in {**RACE, **BATTLE}.items():
        asset = assets[symbol]
        if asset['type'] != 'rgba16':
            raise ValueError(f'Unsupported preview format: {symbol}')
        offset = int(asset['rom_offset'], 16)
        size = asset['width'] * asset['height'] * 2
        pixels = karts.mio0(rom[offset:])
        if len(pixels) != size:
            raise ValueError(f'{symbol}: MIO0 block decodes to {len(pixels)} bytes, expected {size}')
        rgba = rgba16_to_rgba8888(pixels)
        encoded = png(asset['width'], asset['height'], rgba)
        (output / f'{track_id}.png').write_bytes(encoded)
        manifest['previews'][track_id] = {'symbol': symbol, 'width': asset['width'], 'height': asset['height'],
                                         'pngSha256': hashlib.sha256(encoded).hexdigest()}
        print(f'{track_id}: {symbol} {asset["width"]}x{asset["height"]}')
    (output / 'manifest.json').write_text(json.dumps(manifest, indent=2) + '\n')
    print(f'Validated ROM SHA-1; extracted {len(manifest["previews"])} previews into {output}')


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('rom', type=Path)
    parser.add_argument('--metadata', type=Path, required=True)
    parser.add_argument('--output', type=Path, default=Path('public/mk64/menu/previews'))
    args = parser.parse_args()
    extract(args.rom, args.metadata, args.output)