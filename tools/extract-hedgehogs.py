#!/usr/bin/env python3
"""Extract Yoshi Valley's hedgehogs from the ROM (no downloads).

Usage: python3 tools/extract-hedgehogs.py ROM --source /path/to/n64decomp/mk64
Writes public/mk64/yoshi-valley/hedgehogs.json plus hedgehog.png.

- init_course_objects (COURSE_YOSHI_VALLEY, not in the credits): one hedgehog per gHedgehogSpawns entry {x, y, z, group}
  at (x * xOrientation, y + 6, z) walking to gHedgehogPatrolPoints[i] (x, z) (src/data/some_data.c, both verified in
  the ROM).
- func_8008311C: d_course_yoshi_valley_hedgehog (64x64 CI8) through d_course_yoshi_valley_hedgehog_tlut, sizeScaling 0.2,
  boundingBoxSize 2, rolled 0x8000, unk_034 (i % 6) * 0.1 + 0.5.
- func_800833D0: the quad alternates between common_vtx_hedgehog and D_0D006130 (the same two 64x32 strips with s
  flipped), both read from the ROM's common_data.
- func_800555BC: draw_2d_texture_at (D_0D007D78: G_CC_DECALRGBA, G_RM_AA_ZB_TEX_EDGE, bilinear), the setup
  tools/extract-snowmen.py checks.
"""
import argparse
import hashlib
import importlib.util
import json
from pathlib import Path
import re
import struct


def load(name):
    spec = importlib.util.spec_from_file_location(name.replace('-', '_'), Path(__file__).with_name(f'{name}.py'))
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


props = load('extract-props')
karts = props.karts

COURSE = 'yoshi_valley'
COMMON_DATA_ROM = 0x132B50
EXPECT = {   # D_0D007D78 and the D_0D007C88 it calls (see tools/extract-snowmen.py)
    0x7C88: 'ba00130100080000 b900000200000000 ba000e0200008000 fcfffffffffcf279 bb00000180008000 b800000000000000',
    0x7D78: '060000000d007c88 ba000c0200002000 b900031d00553078 b800000000000000',
}
QUADS = (0x60B0, 0x6130)   # common_vtx_hedgehog, D_0D006130: 8 vertices each
COUNT = 15
# update_objects.c / render_objects.c lines the port follows (src/hedgehogs.js)
NEEDLES = {
    'src/update_objects.c': (
        'init_texture_object(objectIndex, d_course_yoshi_valley_hedgehog_tlut, d_course_yoshi_valley_hedgehog, 0x40U,',
        'object->sizeScaling = 0.2f;', 'set_obj_orientation(objectIndex, 0U, 0U, 0x8000U);',
        'object->unk_034 = ((arg1 % 6) * 0.1) + 0.5;', 'set_object_flag_status_true(objectIndex, 0x04000600);',
        'object->boundingBoxSize = 2;', 'func_800871AC(objectIndex, 0x0000003C);',
        'if (func_80087060(objectIndex, 0x0000003C) != 0) {', 'func_80072D3C(objectIndex, 0, 1, 4, -1);',
        'gObjectList[objectIndex].pos[1] = gObjectList[objectIndex].surfaceHeight + 6.0;',
        'func_80072120(indexObjectList2, 0x0000000F);'),
    'src/render_objects.c': ('something = func_8008A364(test, arg0, 0x4000U, 0x000003E8);', 'if (something < 0x57E41U) {',
                             'if (something < 0x52211U) {'),
    'src/code_8006E9C0.c': ('gHedgehogSpawns[i].pos[1] + 6.0;', 'gHedgehogPatrolPoints[i][0] * xOrientation;'),
}


def rows_of(data, name, count, width):
    body = re.search(name + r'\[\] = \{(.*?)\};', data, re.S).group(1)
    nums = props.numbers(body)
    if len(nums) != count * width:
        raise ValueError(f'{name}: expected {count} x {width} numbers')
    return [nums[i:i + width] for i in range(0, len(nums), width)]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('rom', type=Path)
    parser.add_argument('--source', type=Path, required=True)
    args = parser.parse_args()
    rom = args.rom.read_bytes()
    if hashlib.sha1(rom).hexdigest() != karts.US_SHA1:
        raise SystemExit('Expected the US Mario Kart 64 ROM (SHA1 %s)' % karts.US_SHA1)
    for path, needles in NEEDLES.items():
        text = (args.source / path).read_text()
        for needle in needles:
            if needle not in text:
                raise ValueError(f'{path} no longer has: {needle}')
    common = karts.mio0(rom[COMMON_DATA_ROM:])
    for at, words in EXPECT.items():
        want = bytes.fromhex(words.replace(' ', ''))
        if common[at:at + len(want)] != want:
            raise ValueError(f'common_data 0x0D00{at:04X} differs from the expected display list')
    quads = []
    for base in QUADS:
        rows = [struct.unpack('>3hH2h4B', common[base + 16 * i:base + 16 * i + 16]) for i in range(8)]
        if any(r[6:] != (255, 255, 255, 255) for r in rows):
            raise ValueError(f'common_data 0x0D00{base:04X}: expected white vertices')
        quads.append([[x, y, z, s / 64, t / 64] for x, y, z, _, s, t, *_ in rows])   # s / t in texels

    folder = Path('public/mk64') / COURSE.replace('_', '-')
    course_json = json.loads((folder / 'course.json').read_text())
    meta = json.loads((args.source / f'assets/courses/{COURSE}.json').read_text())
    block = course_json['provenance']['pathBlockRomOffset']
    segment = karts.mio0(rom[block:])
    tm, im = meta['gTLUTYoshiValleyHedgehog'], meta['gTextureYoshiValleyHedgehog']
    if (tm['type'], tm['width'] * tm['height'], int(tm['rom_offset'], 16)) != ('rgba16', 256, block):
        raise ValueError('gTLUTYoshiValleyHedgehog: expected 256 RGBA16 colours in the course data segment')
    if (im['type'], im['width'], im['height'], im['tlut'], int(im['rom_offset'], 16)) != \
            ('ci8', 64, 64, 'gTLUTYoshiValleyHedgehog', block):
        raise ValueError('gTextureYoshiValleyHedgehog: expected a 64x64 CI8 texture in the course data segment')
    tat, at = int(tm['block_offset'], 16), int(im['block_offset'], 16)
    palette = karts.rgba16(segment[tat:tat + 512])
    rgba = b''.join(palette[c] for c in segment[at:at + 64 * 64])

    data = (args.source / 'src/data/some_data.c').read_text()
    spawns = rows_of(data, r'HegdehogSpawn gHedgehogSpawns', COUNT, 4)
    patrol = rows_of(data, r'Vec3s gHedgehogPatrolPoints', COUNT, 3)
    found = {}
    for name, rows, fmt in (('gHedgehogSpawns', spawns, '>4H'), ('gHedgehogPatrolPoints', patrol, '>3H')):
        packed = b''.join(struct.pack(fmt, *r) for r in rows)
        found[name] = rom.find(packed)
        if found[name] < 0:
            raise ValueError(f'{name} does not match the ROM')
    s16 = lambda v: v - 0x10000 if v > 0x7FFF else v
    out_spawns = [[s16(x), s16(y), s16(z), g, s16(p[0]), s16(p[2]), struct.unpack('f', struct.pack('f', (i % 6) * 0.1 + 0.5))[0]]
                  for i, ((x, y, z, g), p) in enumerate(zip(spawns, patrol))]   # x, y, z, group, patrolX, patrolZ, speed

    out = dict(romSha1=karts.US_SHA1, courseDataRomOffset=block, spawnList='gHedgehogSpawns',
               spawnListRomOffset=found['gHedgehogSpawns'], patrolListRomOffset=found['gHedgehogPatrolPoints'],
               spawns=out_spawns, quads=quads, image='hedgehog.png', rgbaSha256=hashlib.sha256(rgba).hexdigest(),
               scale=0.2, boundingBoxSize=2)
    (folder / 'hedgehog.png').write_bytes(karts.png(64, 64, rgba))
    (folder / 'hedgehogs.json').write_text(json.dumps(out, separators=(',', ':')) + '\n')
    print(f'{len(out_spawns)} hedgehogs (spawns at ROM {found["gHedgehogSpawns"]:#x}, '
          f'patrol points at {found["gHedgehogPatrolPoints"]:#x})')


if __name__ == '__main__':
    main()
