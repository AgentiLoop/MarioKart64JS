#!/usr/bin/env python3
"""Extract the native kart exhaust smoke texture from a local US ROM (no downloads).

Usage: python3 tools/extract-smoke.py ROM [--output public/mk64/particles]
common_texture_particle_smoke[0..2] (yamls/us/common_data.yml): 32x32 I8 frames at offset 0x2BC58
of the common_data MIO0 block (segment 0x0D @ 0x132B50), cycled by func_80062C74 (unk_010 0..2) and
drawn by func_8006538C. Frames are stacked vertically; each PNG pixel is the I8 intensity in RGB and
alpha, so the shader can lerp ENVIRONMENT -> PRIMITIVE by TEXEL0 and use TEXEL0 * PRIMITIVE alpha.
"""
import argparse
import hashlib
import importlib.util
from pathlib import Path

spec = importlib.util.spec_from_file_location('karts', Path(__file__).with_name('extract-karts.py'))
karts = importlib.util.module_from_spec(spec)
spec.loader.exec_module(karts)

COMMON_DATA = 0x132B50
SMOKE = 0x2BC58
FRAMES = 3


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('rom', type=Path)
    parser.add_argument('--output', type=Path, default=Path('public/mk64/particles'))
    args = parser.parse_args()
    rom = args.rom.read_bytes()
    if hashlib.sha1(rom).hexdigest() != karts.US_SHA1:
        raise SystemExit('Expected the US Mario Kart 64 ROM (SHA1 %s)' % karts.US_SHA1)
    args.output.mkdir(parents=True, exist_ok=True)
    data = karts.mio0(rom[COMMON_DATA:])[SMOKE:SMOKE + FRAMES * 1024]
    rgba = b''.join(bytes((i, i, i, i)) for i in data)
    (args.output / 'smoke.png').write_bytes(karts.png(32, 32 * FRAMES, rgba))
    print('smoke.png  32x%d (%d frames)  common_data+0x%X' % (32 * FRAMES, FRAMES, SMOKE))


if __name__ == '__main__':
    main()
