#!/usr/bin/env python3
"""Extract the 16 native MK64 item window icons (no downloads).

Usage: python3 tools/extract-item-window.py ROM --source /path/to/n64decomp/mk64 [--output public/mk64/item-window]
common_data (segment 0x0D, MIO0 @ ROM 0x132B50): common_texture_item_window_* are CI8 40x32, each with its
own 256-colour RGBA16 common_tlut_item_window_* (offsets from yamls/us/common_data.yml). Files are numbered
by gItemWindowTextures (src/update_objects.c), the index the item roulette cycles through.
"""
import argparse
import hashlib
import importlib.util
import json
import re
from pathlib import Path

spec = importlib.util.spec_from_file_location('karts', Path(__file__).with_name('extract-karts.py'))
karts = importlib.util.module_from_spec(spec)
spec.loader.exec_module(karts)

COMMON_DATA = 0x132B50
ITEMS = ['none', 'banana', 'banana_bunch', 'green_shell', 'triple_green_shell', 'red_shell', 'triple_red_shell',
         'blue_shell', 'thunder_bolt', 'fake_item_box', 'star', 'boo', 'mushroom', 'double_mushroom',
         'triple_mushroom', 'super_mushroom']
W, H = 40, 32


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('rom', type=Path)
    parser.add_argument('--source', type=Path, required=True)
    parser.add_argument('--output', type=Path, default=Path('public/mk64/item-window'))
    args = parser.parse_args()
    rom = args.rom.read_bytes()
    if hashlib.sha1(rom).hexdigest() != karts.US_SHA1:
        raise SystemExit('Expected the US Mario Kart 64 ROM (SHA1 %s)' % karts.US_SHA1)
    yml = (args.source / 'yamls/us/common_data.yml').read_text()
    offset = lambda sym: int(re.search(r'^%s:\n(?:  .*\n)*?  offset: (0x[0-9A-Fa-f]+)' % sym, yml, re.M).group(1), 16)
    common = karts.mio0(rom[COMMON_DATA:])
    args.output.mkdir(parents=True, exist_ok=True)
    icons = []
    for i, name in enumerate(ITEMS):
        tex, tlut = offset('common_texture_item_window_' + name), offset('common_tlut_item_window_' + name)
        palette = karts.rgba16(common[tlut:tlut + 512])
        rgba = b''.join(palette[p] for p in common[tex:tex + W * H])
        image = '%02d-%s.png' % (i, name)
        (args.output / image).write_bytes(karts.png(W, H, rgba))
        icons.append(dict(image=image, texture=tex, tlut=tlut, rgbaSha256=hashlib.sha256(rgba).hexdigest()))
        print('%2d %-20s tex 0x%05X tlut 0x%05X' % (i, name, tex, tlut))
    out = dict(romSha1=karts.US_SHA1, commonDataRomOffset=COMMON_DATA, width=W, height=H, icons=icons)
    (args.output / 'item-window.json').write_text(json.dumps(out, indent=1) + '\n')


if __name__ == '__main__':
    main()
