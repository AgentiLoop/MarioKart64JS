#!/usr/bin/env python3
"""Extract the MAIN_MENU (game select / number of players) textures from a local US ROM.

Usage: python3 tools/extract-mainmenu.py ROM
Offsets/dimensions from n64decomp/mk64 assets.json + src/data/textures.c (seg2_game_select_texture,
seg2_menu_1p_column..seg2_menu_4p_column, gTextureMenuLOption, seg2_textureMenuRData).
Output: public/mk64/mainmenu/*.png + manifest.json
"""
import hashlib
import json
import struct
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from tkmk00 import decode_tkmk00, png  # noqa: E402

US_SHA1 = '579c48e211ae952530ffc8738709f078d5dd215e'

# name -> (rom offset, width, height, MenuTexture type); type 1 decodes with clear colour 0xBE
TKMK00 = {
    'game_select': (0x803DC0, 200, 32, 0),
    'menu_1p_game': (0x8049C0, 64, 54, 1),
    'menu_2p_game': (0x804EC0, 64, 54, 1),
    'menu_3p_game': (0x8055C0, 64, 54, 1),
    'menu_4p_game': (0x805FC0, 64, 54, 1),
    'mode_mario_gp': (0x8071C0, 64, 18, 1),
    'mode_time_trials': (0x806DC0, 64, 18, 1),
    'mode_vs': (0x8075C0, 64, 18, 1),
    'mode_battle': (0x806AC0, 64, 18, 1),
    'l_option': (0x8078C0, 58, 19, 1),
    'r_data': (0x807BC0, 58, 19, 1),
}

# raw rgba16 (data/course_player_selection.s): the cursor triangle under the chosen column (D_020047DC dX 27, dY 56)
RAW = {
    'small_green_triangle': (0x7E563C, 12, 7),
}


def png_rgba16(width, height, rgba16_bytes):
    out = bytearray()
    for (pixel,) in struct.iter_unpack('>H', rgba16_bytes):
        channels = [(pixel >> shift) & 31 for shift in (11, 6, 1)]
        out += bytes([round(c * 255 / 31) for c in channels] + [255 * (pixel & 1)])
    return png(width, height, bytes(out))


def extract(rom_path, output):
    rom = rom_path.read_bytes()
    if hashlib.sha1(rom).hexdigest() != US_SHA1:
        raise ValueError('ROM is not the supported big-endian Mario Kart 64 USA revision')
    output = Path(output)
    output.mkdir(parents=True, exist_ok=True)
    manifest = {'romSha1': US_SHA1, 'source': 'n64decomp/mk64 data/texture_tkmk00.s, src/data/textures.c', 'images': {}}
    for name, (off, w, h, tex_type) in TKMK00.items():
        block = rom[off:off + 0x4000]
        if block[:4] != b'TKMK':
            raise ValueError(f'{name}: no TKMK00 header at {off:#x}')
        _, _, rgba = decode_tkmk00(block, 0xBE if tex_type == 1 else 0x01)
        encoded = png(w, h, rgba)
        (output / f'{name}.png').write_bytes(encoded)
        manifest['images'][name] = {'format': 'tkmk00', 'width': w, 'height': h,
                                   'romOffset': hex(off), 'pngSha256': hashlib.sha256(encoded).hexdigest()}
        print(f'{name}: TKMK00 {w}x{h} @{off:#x}')
    for name, (off, w, h) in RAW.items():
        encoded = png_rgba16(w, h, rom[off:off + w * h * 2])
        (output / f'{name}.png').write_bytes(encoded)
        manifest['images'][name] = {'format': 'rgba16', 'width': w, 'height': h,
                                   'romOffset': hex(off), 'pngSha256': hashlib.sha256(encoded).hexdigest()}
        print(f'{name}: rgba16 {w}x{h} @{off:#x}')
    (output / 'manifest.json').write_text(json.dumps(manifest, indent=2) + '\n')
    print(f'Validated ROM SHA-1; extracted {len(manifest["images"])} images into {output}')


if __name__ == '__main__':
    rom = Path(sys.argv[1])
    out = Path(sys.argv[2]) if len(sys.argv) > 2 else Path('public/mk64/mainmenu')
    extract(rom, out)
