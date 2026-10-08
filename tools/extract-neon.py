#!/usr/bin/env python3
"""Extract the Rainbow Road neon signs (no downloads).

Usage: python3 tools/extract-neon.py ROM --source /path/to/n64decomp/mk64 [--output public/mk64/rainbow-road]
Ten billboard objects (NUM_NEON_SIGNS, update_objects.c:7701-7860, render_object_neon in render_objects.c):
  0 mushroom, 1 mario, 2 boo - 64x64 CI8 textures with five 256-colour palettes the object steps through
    (textureListIndex -> update_neon_texture: tlutList + index * 512 bytes);
  3..9 peach, luigi, donkey kong, yoshi, bowser, wario, toad - one palette each, never animated.
Positions: set_obj_origin_pos in init_obj_neon_mushroom / func_80085DB8 / func_80085EF8 and the
D_800E6734 table (some_data.c) for the other seven. Each is drawn with common_vtx_hedgehog (8 vertices, two
64x32 halves; common_data 0x60B0, read here from the ROM) at sizeScaling 8.0, turned about y toward the camera.
The textures and the 21 palettes come from the ROM (assets/courses/rainbow_road.json gives their offsets); every
palette frame is written as its own RGBA PNG. Writes <output>/neon.json plus neon-<sign>-<frame>.png.
"""
import argparse
import hashlib
import importlib.util
import json
import re
import struct
from pathlib import Path

spec = importlib.util.spec_from_file_location('karts', Path(__file__).with_name('extract-karts.py'))
karts = importlib.util.module_from_spec(spec)
spec.loader.exec_module(karts)
spec = importlib.util.spec_from_file_location('finish', Path(__file__).with_name('extract-finish-line.py'))
finish = importlib.util.module_from_spec(spec)
spec.loader.exec_module(finish)

COMMON_DATA = 0x132B50
HEDGEHOG_VTX = 0x60B0
ANIMATED = ['Mushroom', 'Mario', 'Boo']
STATIC = ['Peach', 'Luigi', 'DonkeyKong', 'Yoshi', 'Bowser', 'Wario', 'Toad']
SCALE = 8.0   # func_80085BB4


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('rom', type=Path)
    parser.add_argument('--source', type=Path, required=True)
    parser.add_argument('--output', type=Path, default=Path('public/mk64/rainbow-road'))
    args = parser.parse_args()
    rom = args.rom.read_bytes()
    if hashlib.sha1(rom).hexdigest() != karts.US_SHA1:
        raise SystemExit('Expected the US Mario Kart 64 ROM (SHA1 %s)' % karts.US_SHA1)
    assets = json.loads((args.source / 'assets/courses/rainbow_road.json').read_text())
    updates = (args.source / 'src/update_objects.c').read_text()
    some_data = (args.source / 'src/data/some_data.c').read_text()

    # Positions: three set_obj_origin_pos calls (x scaled by xOrientation = 1 unless mirrored) + D_800E6734.
    fixed = {}
    for name in ('mushroom', 'mario', 'boo'):
        m = re.search(r'set_obj_origin_pos\(objectIndex, xOrientation \* (-?[\d.]+), (-?[\d.]+)f, (-?[\d.]+)f\);\s*'
                      r'init_texture_object\(objectIndex, \(u8\*\) d_course_rainbow_road_neon_%s_tlut_list' % name, updates)
        fixed[name] = [float(v) for v in m.groups()]
    table = re.search(r'float D_800E6734\[\] = \{(.*?)\};', some_data, re.S).group(1)
    values = [float(v) for v in re.findall(r'-?[\d.]+', table)]
    assert len(values) == 21
    static_positions = [values[i:i + 3] for i in range(0, 21, 3)]
    init = re.search(r'func_80086074.*?\{(.*?)\n\}', updates, re.S).group(1)
    assert 'xOrientation' in init and '&d_course_rainbow_road_static_tluts[arg1 * 256]' in init

    common = karts.mio0(rom[COMMON_DATA:])
    hedgehog = [list(struct.unpack_from('>4h2h4B', common, HEDGEHOG_VTX + 16 * i)) for i in range(8)]

    args.output.mkdir(parents=True, exist_ok=True)
    signs = []

    def palette(key):
        raw = karts.asset_bytes(rom, assets[key])
        assert len(raw) == 512
        return karts.rgba16(raw)

    def texture(key):
        meta = assets[key]
        assert (meta['width'], meta['height'], meta['type']) == (64, 64, 'ci8')
        return karts.asset_bytes(rom, meta)

    for index, name in enumerate(ANIMATED + STATIC):
        animated = index < 3
        ci8 = texture('gTextureRainbowRoadNeon' + name)
        keys = ['gTLUTRainbowRoadNeon%s%d' % (name, f) for f in range(1, 6)] if animated else ['gTLUTRainbowRoadNeon' + name]
        frames = []
        for f, key in enumerate(keys):
            colors = palette(key)
            png = karts.png(64, 64, b''.join(colors[p] for p in ci8))
            image = 'neon-%s-%d.png' % (name.lower(), f)
            (args.output / image).write_bytes(png)
            frames.append(image)
        signs.append(dict(name=name.lower(), animated=animated, frames=frames,
                          position=fixed[name.lower()] if animated else static_positions[index - 3],
                          riceCrc='%08X' % finish.rice_crc(ci8, 64, 64, 64)))
    out = dict(romSha1=karts.US_SHA1, commonDataRomOffset=COMMON_DATA, scale=SCALE, vertices=hedgehog, signs=signs)
    (args.output / 'neon.json').write_text(json.dumps(out, separators=(',', ':')) + '\n')
    for s in signs:
        print(s['name'], s['position'], len(s['frames']), 'frame(s)', s['riceCrc'])


if __name__ == '__main__':
    main()
