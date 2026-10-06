#!/usr/bin/env python3
"""Extract the MK64 menu backgrounds from a local US ROM (standard library only).

Usage: python3 tools/extract-menu-backgrounds.py ROM [public/mk64/menu]

Decodes the two TKMK00 backgrounds (seg2_blue_sky_background_texture @0x8094C0,
seg2_sunset_background_texture @0x8162C0, both 320x240) and derives the three
tinted variants the game builds at menu load (menu_items.c load_menu_img ...
case MAIN_MENU_BACKGROUND / CHARACTER_SELECT_BACKGROUND / COURSE_SELECT_BACKGROUND):
    convert_img_to_greyscale(0, 0x19)  -> gamma'd luma, 5 bits per channel
    adjust_img_colour(..., gBackgroundColor[type - MAIN_MENU_BACKGROUND])
with gBackgroundColor = { ff,af,af } (main menu), { af,ff,af } (player select),
{ af,af,ff } (course select).  The source is gMenuTexturesBackground[0] (blue sky)
until the extra mode is unlocked.
Output: background_blue_sky.png, background_sunset.png, background_main_menu.png,
background_player_select.png, background_course_select.png + manifest.json
"""
import hashlib
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from tkmk00 import decode_tkmk00, png  # noqa: E402

US_SHA1 = '579c48e211ae952530ffc8738709f078d5dd215e'
BACKGROUNDS = {'background_blue_sky': 0x8094C0, 'background_sunset': 0x8162C0}
# gBackgroundColor[] (menu_items.c:282), indexed by type - MAIN_MENU_BACKGROUND
TINTS = {
    'background_main_menu': (0xFF, 0xAF, 0xAF),
    'background_player_select': (0xAF, 0xFF, 0xAF),
    'background_course_select': (0xAF, 0xAF, 0xFF),
}


def to_rgba16(rgba8):
    """Invert tkmk00.py's 5->8 bit expansion (round(c*255/31)) back to 5-bit channels."""
    for i in range(0, len(rgba8), 4):
        r, g, b, a = rgba8[i:i + 4]
        yield round(r * 31 / 255), round(g * 31 / 255), round(b * 31 / 255), 1 if a else 0


def greyscale_table(arg1=0x19):
    # convert_img_to_greyscale: sp48[i] = menu_pow(i / 32.0, arg1 * 1.5 / 256 + 0.25)
    return [(i / 32.0) ** (arg1 * 1.5 / 256.0 + 0.25) for i in range(32)]


def tint(rgba8, colour):
    table = greyscale_table()
    out = bytearray()
    for r, g, b, a in to_rgba16(rgba8):
        luma = (r * 0x55 + g * 0x4B + b * 0x5F) // 256
        grey = int(table[luma] * 32.0)            # f32 -> u32 truncates
        grey = min(grey, 31)
        # adjust_img_colour: (r*0x4D + g*0x96 + b*0x1D) / 256 == grey when r == g == b
        t = (grey * 0x4D + grey * 0x96 + grey * 0x1D) // 256
        nr, ng, nb = ((t * c) // 256 for c in colour)
        out += bytes([round(nr * 255 / 31), round(ng * 255 / 31), round(nb * 255 / 31), 255 if a else 0])
    return bytes(out)


def extract(rom_path, output):
    rom = rom_path.read_bytes()
    if hashlib.sha1(rom).hexdigest() != US_SHA1:
        raise ValueError('ROM is not the supported big-endian Mario Kart 64 USA revision')
    output = Path(output)
    output.mkdir(parents=True, exist_ok=True)
    manifest = {'romSha1': US_SHA1, 'source': 'n64decomp/mk64 menu_items.c (gMenuTexturesBackground, gBackgroundColor, '
                                               'convert_img_to_greyscale, adjust_img_colour)', 'images': {}}

    def emit(name, w, h, rgba, extra):
        encoded = png(w, h, rgba)
        (output / f'{name}.png').write_bytes(encoded)
        manifest['images'][name] = {'width': w, 'height': h, 'pngSha256': hashlib.sha256(encoded).hexdigest(), **extra}
        print(f'{name}: {w}x{h}')

    decoded = {}
    for name, off in BACKGROUNDS.items():
        if rom[off:off + 4] != b'TKMK':
            raise ValueError(f'{name}: no TKMK00 header at {off:#x}')
        w, h, rgba = decode_tkmk00(rom[off:off + 0x20000], 0x01)
        decoded[name] = (w, h, rgba)
        emit(name, w, h, rgba, {'format': 'tkmk00', 'romOffset': hex(off)})
    w, h, sky = decoded['background_blue_sky']
    for name, colour in TINTS.items():
        emit(name, w, h, tint(sky, colour), {'format': 'tkmk00+greyscale(0x19)+tint', 'romOffset': hex(BACKGROUNDS['background_blue_sky']),
                                            'tint': list(colour)})
    (output / 'manifest.json').write_text(json.dumps(manifest, indent=2) + '\n')
    print(f'Validated ROM SHA-1; wrote {len(manifest["images"])} images into {output}')


if __name__ == '__main__':
    rom = Path(sys.argv[1])
    out = Path(sys.argv[2]) if len(sys.argv) > 2 else Path('public/mk64/menu')
    extract(rom, out)
