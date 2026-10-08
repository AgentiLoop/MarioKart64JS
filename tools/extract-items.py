#!/usr/bin/env python3
"""Extract the native MK64 item actors' models and textures (no downloads).

Usage: python3 tools/extract-items.py ROM [--output public/mk64/items]
common_data (segment 0x0D, MIO0 @ ROM 0x132B50, offsets from yamls/us/common_data.yml):
  common_model_banana (0x4B48): common_vtx_banana (0x3298, 5 verts), two crossed triangles drawn with
    common_texture_banana (0x3348, RGBA16 32x32), G_CULL_BACK cleared. render_actor_banana draws it unrotated.
  common_model_flat_banana (0x4BD8): common_vtx_flat_banana (0x32E8, 6 verts) with common_texture_flat_banana
    (0x3B48, RGBA16 64x32), the DESTROYED_BANANA model.
Vertices are [x, y, z, s, t, r, g, b, a] in MK64 units (s, t in S10.5 texels).
"""
import argparse
import hashlib
import importlib.util
import json
import struct
from pathlib import Path

spec = importlib.util.spec_from_file_location('karts', Path(__file__).with_name('extract-karts.py'))
karts = importlib.util.module_from_spec(spec)
spec.loader.exec_module(karts)

COMMON_DATA = 0x132B50
# name: (vtx offset, count, triangles from the model's gSP2Triangles / gSP1Triangle, texture offset, w, h)
MODELS = {
    'banana': (0x3298, 5, [[0, 1, 2], [3, 1, 4]], 0x3348, 32, 32),
    'flat-banana': (0x32E8, 6, [[0, 1, 2], [3, 4, 5]], 0x3B48, 64, 32),
}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('rom', type=Path)
    parser.add_argument('--output', type=Path, default=Path('public/mk64/items'))
    args = parser.parse_args()
    rom = args.rom.read_bytes()
    if hashlib.sha1(rom).hexdigest() != karts.US_SHA1:
        raise SystemExit('Expected the US Mario Kart 64 ROM (SHA1 %s)' % karts.US_SHA1)
    common = karts.mio0(rom[COMMON_DATA:])
    args.output.mkdir(parents=True, exist_ok=True)
    out = dict(romSha1=karts.US_SHA1, commonDataRomOffset=COMMON_DATA, models={})
    for name, (vtx, count, triangles, tex, w, h) in MODELS.items():
        vertices = []
        for i in range(count):
            x, y, z, _flag, s, t, r, g, b, a = struct.unpack('>3hH2h4B', common[vtx + 16 * i:vtx + 16 * i + 16])
            vertices.append([x, y, z, s, t, r, g, b, a])
        rgba = b''.join(karts.rgba16(common[tex:tex + w * h * 2]))
        image = name + '.png'
        (args.output / image).write_bytes(karts.png(w, h, rgba))
        out['models'][name] = dict(image=image, width=w, height=h, texture=tex, vertices=vertices, triangles=triangles,
                                   rgbaSha256=hashlib.sha256(rgba).hexdigest())
        print('%-12s vtx 0x%04X tex 0x%04X %dx%d' % (name, vtx, tex, w, h))
    (args.output / 'items.json').write_text(json.dumps(out, indent=1) + '\n')


if __name__ == '__main__':
    main()
