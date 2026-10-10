#!/usr/bin/env python3
"""Stage the Mario Kart Wii Standard Kart + the 8 MK64 drivers (Collada rips in ~/Downloads) into public/wii/.

Usage: python3 tools/build-wii-karts.py [--downloads ~/Downloads] [--out public/wii]

Standard Kart/{Small,Medium,Large} are the Wii weight classes (different body + tire meshes, same 256x128 texture
size), not texture tiers: Toad rides the Small kart, Mario/Luigi/Peach/Yoshi the Medium, DK/Wario/Bowser the Large.
Each class folder ships one body_<xx>.png per character; only the 8 MK64 ones are copied.

Output: kart/<class>/{body,tire_fl,tire_fr}.dae + metal/low_light/body_<xx> textures (tire_black.png is kept),
<char>/model.dae + the PNGs it references. In every .dae `<init_from><ref>x</ref></init_from>` is collapsed to
`<init_from>x</init_from>` (ColladaLoader reads the text only) and materials get a name attribute (= id) so
src/kart3d.js can find the eye material by name.
"""
import argparse
import re
import shutil
from pathlib import Path

CLASSES = {'small': 'Small', 'medium': 'Medium', 'large': 'Large'}
KART_FILES = ('body.dae', 'tire_fl.dae', 'tire_fr.dae', 'low_light_2.png', 'metal_4_2.png')
# MK64 driver -> (rip folder, seated kart pose .dae, Wii class, body texture suffix)
DRIVERS = {
    'mario': ('Mario', 'model_cpu (kart).dae', 'medium', 'mr'),
    'luigi': ('Luigi', 'model_cpu (kart).dae', 'medium', 'lg'),
    'peach': ('Peach', 'model_cpu (kart).dae', 'medium', 'pc'),
    'toad': ('Toad', 'model_cpu (kart).dae', 'small', 'ko'),
    'yoshi': ('Yoshi', 'model_cpu (kart).dae', 'medium', 'ys'),
    'donkeykong': ('Donkey Kong', 'model_cpu (kart).dae', 'large', 'dk'),
    'wario': ('Wario', 'model_cpu (kart).dae', 'large', 'wr'),
    'bowser': ('Bowser', 'la_kart-kp_cpu.dae', 'large', 'kp'),
}


def convert_dae(src, dst):
    text = src.read_text()
    text = re.sub(r'<init_from>\s*<ref>([^<]*)</ref>\s*</init_from>', r'<init_from>\1</init_from>', text)
    text = re.sub(r'<material id="([^"]+)">', r'<material id="\1" name="\1">', text)
    dst.write_text(text)
    return sorted(set(re.findall(r'<init_from>([^<]+\.png)</init_from>', text)))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--downloads', default=str(Path.home() / 'Downloads'))
    ap.add_argument('--out', default=str(Path(__file__).resolve().parent.parent / 'public' / 'wii'))
    args = ap.parse_args()
    dl, out = Path(args.downloads), Path(args.out)

    for cls, folder in CLASSES.items():
        src, dst = dl / 'Standard Kart' / folder, out / 'kart' / cls
        dst.mkdir(parents=True, exist_ok=True)
        for name in KART_FILES:
            if name.endswith('.dae'):
                convert_dae(src / name, dst / name)
            else:
                shutil.copy(src / name, dst / name)
        for char, (_, _, c, suffix) in DRIVERS.items():
            if c == cls:
                shutil.copy(src / f'body_{suffix}.png', dst / f'body_{suffix}.png')
        print(f'{cls}: {sorted(p.name for p in dst.iterdir())}')

    for char, (folder, dae, _, _) in DRIVERS.items():
        src, dst = dl / folder, out / char
        dst.mkdir(parents=True, exist_ok=True)
        images = convert_dae(src / dae, dst / 'model.dae')
        for img in images:
            shutil.copy(src / img, dst / img)
        print(f'{char}: model.dae <- {dae!r} + {images}')


if __name__ == '__main__':
    main()
