#!/usr/bin/env python3
"""Stage the Mario Kart Wii Lakitu (Collada rip in ~/Downloads/Lakitu, BrawlCrate export) into public/wii/lakitu/.

Usage: python3 tools/build-wii-lakitu.py [--src ~/Downloads/Lakitu] [--out public/wii/lakitu]

Parts (centimetres, Y up, facing +z, each skinned to its own joints): jugemu.dae (body + cloud, 14 joints, arms
T-posed), jugemu_hair.dae (on ef_head), rod.dae (rod_1 in the hand, the line and hook at its tip), jugemu_signal.dae
(start signal: signal_01 housing, light_1-3 lamps, lightb1-3 glow quads), jugemu_lap.dae (lap board; its `number`
material shows jg_lap.N.png), jugemu_lapf.dae (final lap board), jg_flag.dae (checkered flag, pole along +z),
board_reverse.dae (wrong way sign). As in build-wii-karts.py, `<init_from><ref>x</ref></init_from>` is collapsed
to `<init_from>x</init_from>`, materials get a name attribute and the COLLADA 1.5 header is rewritten as 1.4.1 so
ColladaLoader reads it like the kart rips. src/lakitu3d.js poses and animates the parts.
"""
import argparse
import re
import shutil
from pathlib import Path

DAES = ('jugemu.dae', 'jugemu_hair.dae', 'rod.dae', 'jugemu_signal.dae', 'jugemu_lap.dae', 'jugemu_lapf.dae', 'jg_flag.dae', 'board_reverse.dae')
EXTRA_PNGS = tuple(f'jg_lap.{i}.png' for i in range(8))


def convert_dae(src, dst):
    text = src.read_text()
    text = re.sub(r'<init_from>\s*<ref>([^<]*)</ref>\s*</init_from>', r'<init_from>\1</init_from>', text)
    text = re.sub(r'<material id="([^"]+)">', r'<material id="\1" name="\1">', text)
    text = text.replace('version="1.5.0" xmlns="http://www.collada.org/2008/03/COLLADASchema"',
                        'xmlns="http://www.collada.org/2005/11/COLLADASchema" version="1.4.1"')
    dst.write_text(text)
    return sorted(set(re.findall(r'<init_from>([^<]+\.png)</init_from>', text)))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--src', default=str(Path.home() / 'Downloads' / 'Lakitu'))
    ap.add_argument('--out', default=str(Path(__file__).resolve().parent.parent / 'public' / 'wii' / 'lakitu'))
    args = ap.parse_args()
    src, out = Path(args.src), Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    images = set(EXTRA_PNGS)
    for name in DAES:
        images.update(convert_dae(src / name, out / name))
    for img in sorted(images):
        shutil.copy(src / img, out / img)
    print(f'{out}: {sorted(p.name for p in out.iterdir())}')


if __name__ == '__main__':
    main()
