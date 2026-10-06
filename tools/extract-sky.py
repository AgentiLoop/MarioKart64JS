#!/usr/bin/env python3
"""Extract native MK64 cloud and star textures from a local US ROM (no downloads).

Usage: python3 tools/extract-sky.py ROM [--output public/mk64/sky]
Clouds: gTextureExhaust0..5 (data/other_textures.s, ROM offsets from assets.json), which
init_cloud_object indexes as u8[1024] = 64x32 I4 frames (func_80044DA0 loads G_IM_FMT_I 4b).
Star: D_0D0293D8, 16x16 I4 at offset 0x293D8 of the common_data MIO0 block (segment 0x0D @ 0x132B50).
Clouds/stars are drawn with combine colour = PRIMITIVE (white) and alpha = TEXEL0, so each PNG is
white RGB with the I4 intensity (x17) as alpha.
"""
import argparse
import hashlib
import importlib.util
from pathlib import Path

spec = importlib.util.spec_from_file_location('karts', Path(__file__).with_name('extract-karts.py'))
karts = importlib.util.module_from_spec(spec)
spec.loader.exec_module(karts)

EXHAUST = [0x717A84, 0x717F00, 0x718388, 0x71887C, 0x718C44, 0x71903C]
COMMON_DATA = 0x132B50
STAR = 0x293D8


def i4_rgba(data):
    out = bytearray()
    for byte in data:
        for nibble in (byte >> 4, byte & 15):
            out += bytes((255, 255, 255, nibble * 17))
    return bytes(out)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('rom', type=Path)
    parser.add_argument('--output', type=Path, default=Path('public/mk64/sky'))
    args = parser.parse_args()
    rom = args.rom.read_bytes()
    if hashlib.sha1(rom).hexdigest() != karts.US_SHA1:
        raise SystemExit('Expected the US Mario Kart 64 ROM (SHA1 %s)' % karts.US_SHA1)
    args.output.mkdir(parents=True, exist_ok=True)
    for index, offset in enumerate(EXHAUST):
        data = karts.mio0(rom[offset:])
        frames = len(data) // 1024
        if len(data) % 1024 or frames not in (3, 4):
            raise SystemExit('Unexpected cloud block size at 0x%X' % offset)
        # frames stacked vertically: frame n occupies rows 32n..32n+31
        (args.output / ('clouds-%d.png' % index)).write_bytes(karts.png(64, 32 * frames, i4_rgba(data)))
        print('clouds-%d.png  %d frames  ROM 0x%X' % (index, frames, offset))
    star = karts.mio0(rom[COMMON_DATA:])[STAR:STAR + 128]
    (args.output / 'star.png').write_bytes(karts.png(16, 16, i4_rgba(star)))
    print('star.png  16x16  common_data+0x%X' % STAR)


if __name__ == '__main__':
    main()
