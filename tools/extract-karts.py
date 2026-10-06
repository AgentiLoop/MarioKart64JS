#!/usr/bin/env python3
"""Extract native kart frames from a local US ROM (standard library only).

Usage: python3 tools/extract-karts.py ROM --metadata /path/to/mk64/assets/karts
Metadata: https://github.com/n64decomp/mk64/tree/master/assets/karts
MIO0 layout: n64decomp/mk64 tools/libmio0.c, mio0_decode.
Palette stitching: n64decomp/mk64 tools/new_extract_assets.py.
No ROM download is performed. Output uses wheel palette phase zero.
"""
import argparse
import hashlib
import json
from pathlib import Path
import struct
import zlib

US_SHA1 = '579c48e211ae952530ffc8738709f078d5dd215e'
DRIVERS = ('mario', 'luigi', 'peach', 'toad', 'yoshi', 'donkeykong', 'wario', 'bowser')


def mio0(data):
    if data[:4] != b'MIO0':
        raise ValueError('Expected MIO0 block')
    size, compressed, raw = struct.unpack_from('>III', data, 4)
    if not 0 < size <= 16 * 1024 * 1024:
        raise ValueError('Invalid MIO0 output length')
    out = bytearray()
    bit = 0
    while len(out) < size:
        if data[16 + bit // 8] & (0x80 >> (bit % 8)):
            out.append(data[raw])
            raw += 1
        else:
            pair = struct.unpack_from('>H', data, compressed)[0]
            compressed += 2
            length, distance = (pair >> 12) + 3, (pair & 0xfff) + 1
            if distance > len(out) or len(out) + length > size:
                raise ValueError('Invalid MIO0 back-reference')
            for _ in range(length):
                out.append(out[-distance])
        bit += 1
    return bytes(out)


def asset_bytes(rom, asset):
    offset = int(asset['rom_offset'], 16)
    size = asset['width'] * asset['height'] * (2 if asset['type'] == 'rgba16' else 1)
    block = int(asset.get('block_offset', '0'), 16)
    data = mio0(rom[offset:]) if rom[offset:offset + 4] == b'MIO0' else rom[offset:]
    result = data[block:block + size]
    if len(result) != size:
        raise ValueError('Truncated asset')
    return result


def rgba16(palette):
    colors = []
    for (pixel,) in struct.iter_unpack('>H', palette):
        channels = [(pixel >> shift) & 31 for shift in (11, 6, 1)]
        colors.append(bytes([round(c * 255 / 31) for c in channels] + [255 * (pixel & 1)]))
    return colors


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
    manifest = {'romSha1': US_SHA1, 'metadataSource': 'n64decomp/mk64/assets/karts',
                'wheelPhase': 0, 'drivers': {}}
    output.mkdir(parents=True, exist_ok=True)
    for driver in DRIVERS:
        source = (metadata / f'{driver}_kart.json').read_bytes()
        assets = json.loads(source)
        names = sorted(name for name in assets if name.startswith(f'{driver}_kart_frame'))
        if len(names) != 321:
            raise ValueError(f'Expected 321 frames for {driver}, got {len(names)}')
        columns, rows, tile = 21, 16, 64
        width, height = columns * tile, rows * tile
        atlas = bytearray(width * height * 4)
        frames = []
        for index, name in enumerate(names):
            asset = assets[name]
            if (asset['type'], asset['width'], asset['height']) != ('ci8', tile, tile):
                raise ValueError(f'Unsupported frame format: {name}')
            palette = b''.join(asset_bytes(rom, assets[key]) for key in asset['tlut'])
            if len(palette) != 512:
                raise ValueError(f'Expected stitched 256-color palette: {name}')
            colors = rgba16(palette)
            pixels = b''.join(colors[i] for i in asset_bytes(rom, asset))
            if not any(pixels[3::4]) or all(pixels[3::4]):
                raise ValueError(f'Expected opaque kart and transparent background: {name}')
            x, y = (index % columns) * tile, (index // columns) * tile
            for row in range(tile):
                start = ((y + row) * width + x) * 4
                atlas[start:start + tile * 4] = pixels[row * tile * 4:(row + 1) * tile * 4]
            frames.append({'name': name, 'x': x, 'y': y, 'rgbaSha256': hashlib.sha256(pixels).hexdigest()})
        encoded = png(width, height, atlas)
        (output / f'{driver}.png').write_bytes(encoded)
        manifest['drivers'][driver] = {'image': f'{driver}.png', 'width': width, 'height': height,
                                      'frameWidth': tile, 'frameHeight': tile,
                                      'metadataSha256': hashlib.sha256(source).hexdigest(),
                                      'pngSha256': hashlib.sha256(encoded).hexdigest(), 'frames': frames}
        print(f'{driver}: {len(frames)} native {tile}x{tile} frames -> {width}x{height} atlas')
    (output / 'manifest.json').write_text(json.dumps(manifest, indent=2) + '\n')
    print(f'Validated ROM SHA-1; extracted {sum(len(d["frames"]) for d in manifest["drivers"].values())} frames into {output}')


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('rom', type=Path)
    parser.add_argument('--metadata', type=Path, required=True)
    parser.add_argument('--output', type=Path, default=Path('public/mk64/karts'))
    args = parser.parse_args()
    extract(args.rom, args.metadata, args.output)
