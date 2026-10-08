#!/usr/bin/env python3
"""Extract the course outline (minimap) textures from a local US ROM (no downloads).

Usage: python3 tools/extract-minimaps.py ROM --source /path/to/mk64-master [--output public/mk64/minimaps]
gCourseOutlineTextures (src/data/some_data.c) are MIO0 blocks of I4 texels, sizes and ROM offsets from
assets/course_outlines.json (64x64, or 64x96 / 128x64 for a few race courses). The game draws them with
func_8004D37C: colour = PRIMITIVE (D_8018D300.. = white), alpha = TEXEL0, so each PNG is white RGB with
the I4 intensity (x17) as alpha. The manifest keeps the ROM offsets and our course ids.
"""
import argparse
import hashlib
import importlib.util
import json
from pathlib import Path

spec = importlib.util.spec_from_file_location('karts', Path(__file__).with_name('extract-karts.py'))
karts = importlib.util.module_from_spec(spec)
spec.loader.exec_module(karts)

# decomp symbol -> course id used by src/track.js
COURSES = {
    'minimap_mario_raceway': 'mario', 'minimap_choco_mountain': 'choco', 'minimap_bowsers_castle': 'bowser',
    'minimap_banshee_boardwalk': 'banshee', 'minimap_yoshi_valley': 'yoshi', 'minimap_frappe_snowland': 'frappe',
    'minimap_koopa_troopa_beach': 'koopa', 'minimap_royal_raceway': 'royal', 'minimap_luigi_raceway': 'luigi',
    'minimap_moo_moo_farm': 'moomoo', 'minimap_toads_turnpike': 'toad', 'minimap_kalimari_desert': 'kalimari',
    'minimap_sherbet_land': 'sherbet', 'minimap_rainbow_road': 'rainbow', 'minimap_wario_stadium': 'wario',
    'minimap_block_fort': 'block-fort', 'minimap_skyscraper': 'skyscraper', 'minimap_double_deck': 'double-deck',
    'minimap_dks_jungle_parkway': 'dk', 'minimap_big_donut': 'big-donut',
}


def i4_rgba(data):
    out = bytearray()
    for byte in data:
        for nibble in (byte >> 4, byte & 15):
            out += bytes((255, 255, 255, nibble * 17))
    return bytes(out)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('rom', type=Path)
    parser.add_argument('--source', type=Path, required=True, help='mk64 decomp checkout (assets/course_outlines.json)')
    parser.add_argument('--output', type=Path, default=Path('public/mk64/minimaps'))
    args = parser.parse_args()
    rom = args.rom.read_bytes()
    if hashlib.sha1(rom).hexdigest() != karts.US_SHA1:
        raise SystemExit('Expected the US Mario Kart 64 ROM (SHA1 %s)' % karts.US_SHA1)
    outlines = json.loads((args.source / 'assets' / 'course_outlines.json').read_text())
    args.output.mkdir(parents=True, exist_ok=True)
    manifest = {'romSha1': karts.US_SHA1, 'source': 'n64decomp/mk64 assets/course_outlines.json', 'courses': {}}
    for symbol, asset in outlines.items():
        if asset['type'] != 'i4':
            raise SystemExit('%s: unexpected type %s' % (symbol, asset['type']))
        cid, offset = COURSES[symbol], int(asset['rom_offset'], 16)
        width, height = asset['width'], asset['height']
        data = karts.mio0(rom[offset:])
        if len(data) != width * height // 2:
            raise SystemExit('%s: %d bytes, expected %d' % (symbol, len(data), width * height // 2))
        (args.output / (cid + '.png')).write_bytes(karts.png(width, height, i4_rgba(data)))
        manifest['courses'][cid] = {'image': cid + '.png', 'symbol': symbol, 'width': width, 'height': height,
                                    'romOffset': offset, 'i4Sha256': hashlib.sha256(data).hexdigest()}
        print('%-12s %3dx%-3d ROM 0x%X (%s)' % (cid, width, height, offset, symbol))
    (args.output / 'manifest.json').write_text(json.dumps(manifest, indent=1) + '\n')


if __name__ == '__main__':
    main()
