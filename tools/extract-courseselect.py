#!/usr/bin/env python3
"""Extract course-select (MAP SELECT) menu textures from a local US ROM (standard library only).

Usage: python3 tools/extract-courseselect.py ROM
Offsets/dimensions from n64decomp/mk64 assets.json (bin/*.rgba16.tkmk00) and
src/data/textures.c (gMenuTexturesTrackSelection: seg2_menu_select_texture 190x32 @(65,18),
cup icons 65x40 type 1, course title plates 140x18 type 1 @(157, 112+24*i)).
Type-1 textures use TKMK00 clear colour 0xBE, the banner 0x01 (load_menu_img_comp_type).
Output: public/mk64/courseselect/*.png + manifest.json
"""
import hashlib
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from tkmk00 import decode_tkmk00, png  # noqa: E402

US_SHA1 = '579c48e211ae952530ffc8738709f078d5dd215e'

# name -> (rom offset, width, height, clear colour)
TKMK00 = {
    'map_select': (0x8021C0, 190, 32, 0x01),
    'cup_mushroom': (0x8031C0, 65, 40, 0xBE),
    'cup_flower': (0x802DC0, 65, 40, 0xBE),
    'cup_star': (0x8035C0, 65, 40, 0xBE),
    'cup_special': (0x8039C0, 65, 40, 0xBE),
    # course title plates, keyed by the web TRACKS ids
    'title_luigi': (0x7FEFC0, 140, 18, 0xBE),
    'title_moomoo': (0x7FF3C0, 140, 18, 0xBE),
    'title_koopa': (0x7FE6C0, 140, 18, 0xBE),
    'title_kalimari': (0x7FFCC0, 140, 18, 0xBE),
    'title_toad': (0x7FF7C0, 140, 18, 0xBE),
    'title_frappe': (0x7FE1C0, 140, 18, 0xBE),
    'title_choco': (0x7FCDC0, 140, 18, 0xBE),
    'title_mario': (0x7FC8C0, 140, 18, 0xBE),
    'title_wario': (0x8008C0, 140, 18, 0xBE),
    'title_sherbet': (0x8000C0, 140, 18, 0xBE),
    'title_royal': (0x7FEBC0, 140, 18, 0xBE),
    'title_bowser': (0x7FD2C0, 140, 18, 0xBE),
    'title_dk': (0x8018C0, 140, 18, 0xBE),
    'title_yoshi': (0x7FDDC0, 140, 18, 0xBE),
    'title_banshee': (0x7FD7C0, 140, 18, 0xBE),
    'title_rainbow': (0x8004C0, 140, 18, 0xBE),
    'title_big-donut': (0x801EC0, 140, 18, 0xBE),
    'title_block-fort': (0x800DC0, 140, 18, 0xBE),
    'title_double-deck': (0x8014C0, 140, 18, 0xBE),
    'title_skyscraper': (0x8010C0, 140, 18, 0xBE),
}


def extract(rom_path, output):
    rom = rom_path.read_bytes()
    if hashlib.sha1(rom).hexdigest() != US_SHA1:
        raise ValueError('ROM is not the supported big-endian Mario Kart 64 USA revision')
    output = Path(output)
    output.mkdir(parents=True, exist_ok=True)
    manifest = {'romSha1': US_SHA1, 'source': 'n64decomp/mk64 assets.json, src/data/textures.c gMenuTexturesTrackSelection',
                'images': {}}
    for name, (off, w, h, clear) in TKMK00.items():
        block = rom[off:off + 0x4000]
        if block[:4] != b'TKMK':
            raise ValueError(f'{name}: no TKMK00 header at {off:#x}')
        _, _, rgba = decode_tkmk00(block, clear)
        encoded = png(w, h, rgba)
        (output / f'{name}.png').write_bytes(encoded)
        manifest['images'][name] = {'format': 'tkmk00', 'width': w, 'height': h, 'clearColour': hex(clear),
                                   'romOffset': hex(off), 'pngSha256': hashlib.sha256(encoded).hexdigest()}
        print(f'{name}: TKMK00 {w}x{h} @{off:#x}')
    (output / 'manifest.json').write_text(json.dumps(manifest, indent=2) + '\n')
    print(f'Validated ROM SHA-1; extracted {len(manifest["images"])} images into {output}')


if __name__ == '__main__':
    rom = Path(sys.argv[1])
    out = Path(sys.argv[2]) if len(sys.argv) > 2 else Path('public/mk64/courseselect')
    extract(rom, out)
