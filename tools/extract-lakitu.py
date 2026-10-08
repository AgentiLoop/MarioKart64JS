#!/usr/bin/env python3
"""Extract the Lakitu sprite animations from a local US ROM (no downloads).

Usage: python3 tools/extract-lakitu.py ROM [--output public/mk64/lakitu]
n64decomp/mk64 assets/lakitu/*.json + data/other_textures.s: every animation is a run of uncompressed CI8 frames
(56x72 portrait or 72x56 landscape, 0xFC0 bytes apart) in other_textures, each with a 256-colour RGBA16 TLUT in the
common_data MIO0 block (segment 0x0D @ 0x132B50). update_objects.c plays them:
  countdown  NoLights1-8, RedLights01-16, BlueLight1-8: one 32-frame textureList (init_obj_lakitu_red_flag_countdown),
             the TLUT stepping no-lights -> red -> blue (tlutList += 0x200) as the frames do
  flag       CheckeredFlag01-32 (init_obj_lakitu_red_flag: finish), fishing Fishing1-4 (init_obj_lakitu_red_flag_fishing),
  secondlap  SecondLap01-16, finallap FinalLap01-16, reverse Reverse01-16
Each animation is one atlas (8 frames per row, frame 0 top-left) and manifest.json lists frame size and count.
"""
import argparse
import hashlib
import importlib.util
import json
from pathlib import Path

spec = importlib.util.spec_from_file_location('karts', Path(__file__).with_name('extract-karts.py'))
karts = importlib.util.module_from_spec(spec)
spec.loader.exec_module(karts)

COMMON_DATA = 0x132B50
FRAME = 0xFC0
COLUMNS = 8
# name: [(rom offset of the first frame, frames, TLUT offset in common_data, decomp symbol prefix, digits)], w, h
ANIMS = {
    'countdown': ([(0x6A0AC0, 8, 0x24ED8, 'gTextureLakituNoLights', 1), (0x6A88C0, 16, 0x250D8, 'gTextureLakituRedLights', 2),
                   (0x6B84C0, 8, 0x252D8, 'gTextureLakituBlueLight', 1)], 56, 72),
    'flag': ([(0x6C02C0, 32, 0x254D8, 'gTextureLakituCheckeredFlag', 2)], 72, 56),
    'secondlap': ([(0x6DFAC0, 16, 0x256D8, 'gTextureLakituSecondLap', 2)], 72, 56),
    'finallap': ([(0x6EF6C0, 16, 0x258D8, 'gTextureLakituFinalLap', 2)], 72, 56),
    'reverse': ([(0x6FF2C0, 16, 0x25AD8, 'gTextureLakituReverse', 2)], 72, 56),
    'fishing': ([(0x70EEC0, 4, 0x25CD8, 'gTextureLakituFishing', 1)], 56, 72),
}


def rgba16(v):
    return bytes((((v >> 11) & 31) * 255 // 31, ((v >> 6) & 31) * 255 // 31, ((v >> 1) & 31) * 255 // 31, 255 * (v & 1)))


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('rom', type=Path)
    parser.add_argument('--output', type=Path, default=Path('public/mk64/lakitu'))
    args = parser.parse_args()
    rom = args.rom.read_bytes()
    if hashlib.sha1(rom).hexdigest() != karts.US_SHA1:
        raise SystemExit('Expected the US Mario Kart 64 ROM (SHA1 %s)' % karts.US_SHA1)
    args.output.mkdir(parents=True, exist_ok=True)
    common = karts.mio0(rom[COMMON_DATA:])
    manifest = {'romSha1': karts.US_SHA1, 'source': 'n64decomp/mk64 assets/lakitu', 'columns': COLUMNS, 'anims': {}}
    for name, (runs, w, h) in ANIMS.items():
        frames, symbols = [], []
        for start, count, tlut, symbol, digits in runs:
            pal = [rgba16(int.from_bytes(common[tlut + 2 * i:tlut + 2 * i + 2], 'big')) for i in range(256)]
            for i in range(count):
                texels = rom[start + i * FRAME:start + i * FRAME + w * h]
                frames.append([pal[c] for c in texels])
                symbols.append('%s%0*d' % (symbol, digits, i + 1))
        rows = (len(frames) + COLUMNS - 1) // COLUMNS
        aw, ah = w * min(COLUMNS, len(frames)), h * rows
        atlas = bytearray(aw * ah * 4)
        for n, px in enumerate(frames):
            ox, oy = n % COLUMNS * w, n // COLUMNS * h
            for y in range(h):
                o = ((oy + y) * aw + ox) * 4
                atlas[o:o + w * 4] = b''.join(px[y * w:(y + 1) * w])
        (args.output / f'{name}.png').write_bytes(karts.png(aw, ah, bytes(atlas)))
        manifest['anims'][name] = {'image': f'{name}.png', 'frameWidth': w, 'frameHeight': h, 'frames': len(frames),
                                   'symbols': symbols}
        print('%-10s %dx%d  %2d frames of %dx%d' % (name, aw, ah, len(frames), w, h))
    (args.output / 'manifest.json').write_text(json.dumps(manifest, indent=1) + '\n')


if __name__ == '__main__':
    main()
