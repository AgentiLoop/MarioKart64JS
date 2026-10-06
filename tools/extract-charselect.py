#!/usr/bin/env python3
"""Extract character-select menu textures from a local US ROM (standard library only).

Usage: python3 tools/extract-charselect.py ROM
Offsets/dimensions verified against n64decomp/mk64: data/texture_tkmk00.s +
src/data/textures.c (MenuTexture tables D_02001A64..D_02001B04, D_02004B4C,
D_02004B74, seg2_P1..P4_border) and data/course_player_selection.s.
Output: public/mk64/charselect/*.png + manifest.json
"""
import hashlib
import json
import struct
import sys
import zlib
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from tkmk00 import decode_tkmk00, png  # noqa: E402

US_SHA1 = '579c48e211ae952530ffc8738709f078d5dd215e'


def chunk(kind, data):
    return struct.pack('>I', len(data)) + kind + data + struct.pack('>I', zlib.crc32(kind + data))


def png_rgba16(width, height, rgba16_bytes):
    out = bytearray()
    for (pixel,) in struct.iter_unpack('>H', rgba16_bytes):
        channels = [(pixel >> shift) & 31 for shift in (11, 6, 1)]
        out += bytes([round(c * 255 / 31) for c in channels] + [255 * (pixel & 1)])
    scanlines = b''.join(b'\0' + bytes(out[y * width * 4:(y + 1) * width * 4]) for y in range(height))
    return (b'\x89PNG\r\n\x1a\n'
            + chunk(b'IHDR', struct.pack('>IIBBBBB', width, height, 8, 6, 0, 0, 0))
            + chunk(b'IDAT', zlib.compress(scanlines, 9)) + chunk(b'IEND', b''))


# TKMK00-compressed menu images: name -> (rom offset, width, height, MenuTexture type)
# offsets from n64decomp/mk64 assets.json (bin/texture_*.rgba16.tkmk00)
# type 1 textures are decoded with clear colour 0xBE, all others with 0x01
# (load_menu_img_comp_type, menu_items.c)
TKMK00 = {
    'player_select_banner': (0x7FA3C0, 220, 32, 0),
    'name_mario': (0x7FC0C0, 64, 12, 0),
    'name_luigi': (0x7FBEC0, 64, 12, 0),
    'name_peach': (0x7FC2C0, 64, 12, 0),
    'name_toad': (0x7FBAC0, 64, 12, 0),
    'name_yoshi': (0x7FC6C0, 64, 12, 0),
    'name_donkeykong': (0x7FB8C0, 64, 12, 0),
    'name_wario': (0x7FC4C0, 64, 12, 0),
    'name_bowser': (0x7FBCC0, 64, 12, 0),
    'ok': (0x8092C0, 31, 19, 1),
}

# raw rgba16 player-border textures (data/course_player_selection.s)
RAW = {
    'p1_border_blue': (0x7DD63C, 64, 64),
    'p2_border_red': (0x7DF63C, 64, 64),
    'p3_border_orange': (0x7E163C, 64, 64),
    'p4_border_green': (0x7E363C, 64, 64),
}


def extract(rom_path, output):
    rom = rom_path.read_bytes()
    if hashlib.sha1(rom).hexdigest() != US_SHA1:
        raise ValueError('ROM is not the supported big-endian Mario Kart 64 USA revision')
    output = Path(output)
    output.mkdir(parents=True, exist_ok=True)
    manifest = {'romSha1': US_SHA1, 'source': 'n64decomp/mk64 data/texture_tkmk00.s, data/course_player_selection.s',
                'images': {}}
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
        size = w * h * 2
        encoded = png_rgba16(w, h, rom[off:off + size])
        (output / f'{name}.png').write_bytes(encoded)
        manifest['images'][name] = {'format': 'rgba16', 'width': w, 'height': h,
                                   'romOffset': hex(off), 'pngSha256': hashlib.sha256(encoded).hexdigest()}
        print(f'{name}: rgba16 {w}x{h} @{off:#x}')
    (output / 'manifest.json').write_text(json.dumps(manifest, indent=2) + '\n')
    print(f'Validated ROM SHA-1; extracted {len(manifest["images"])} images into {output}')


if __name__ == '__main__':
    rom = Path(sys.argv[1])
    out = Path(sys.argv[2]) if len(sys.argv) > 2 else Path('public/mk64/charselect')
    extract(rom, out)