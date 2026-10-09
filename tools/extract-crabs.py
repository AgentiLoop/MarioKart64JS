#!/usr/bin/env python3
"""Extract Koopa Troopa Beach's crabs from the ROM (no downloads).

Usage: python3 tools/extract-crabs.py ROM --source /path/to/n64decomp/mk64
Writes public/mk64/koopa-troopa-beach/crabs.json plus crab-1.png .. crab-7.png.

- init_course_objects (COURSE_KOOPA_BEACH, not in the credits): one crab per gCrabSpawns entry {startX, patrolX, startZ,
  patrolZ} (src/data/some_data.c, verified in the ROM), x * xOrientation.
- init_ktb_crab: d_course_koopa_troopa_beach_crab_frames (gTextureCrab1..7, 64x64 CI8, one after another) through
  gTLUTCrab, sizeScaling 0.15, boundingBoxSize 1, rolled 0x8000, unk_034 1.5.
- draw_crabs: draw_2d_texture_at with common_vtx_hedgehog (two 64x32 strips, D_0D007D78: G_CC_DECALRGBA,
  G_RM_AA_ZB_TEX_EDGE, bilinear), the same setup tools/extract-snowmen.py checks.
The common_data vertex array is read from the ROM; the textures from the course data segment.
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

COURSE = 'koopa_troopa_beach'
COMMON_DATA_ROM = 0x132B50
EXPECT = {   # D_0D007D78 and the D_0D007C88 it calls (see tools/extract-snowmen.py)
    0x7C88: 'ba00130100080000 b900000200000000 ba000e0200008000 fcfffffffffcf279 bb00000180008000 b800000000000000',
    0x7D78: '060000000d007c88 ba000c0200002000 b900031d00553078 b800000000000000',
}
QUAD = 0x60B0   # common_vtx_hedgehog, 8 vertices
FRAMES = 7
# update_objects.c / render_objects.c lines the port follows (src/crabs.js)
NEEDLES = {
    'src/update_objects.c': (
        'init_texture_object(objectIndex, d_course_koopa_troopa_beach_crab_tlut,\n'
        '                        (u8*) d_course_koopa_troopa_beach_crab_frames, 0x40U, (u16) 0x00000040);',
        'object->sizeScaling = 0.15f;', 'object->boundingBoxSize = 1;', 'set_obj_orientation(objectIndex, 0U, 0U, 0x8000U);',
        'object->unk_034 = 1.5f;', 'func_80072E54(objectIndex, 0, 3, 1, 2, -1);', 'func_80072E54(objectIndex, 4, 6, 1, 2, -1);',
        'gObjectList[objectIndex].unk_034 = 0.8f;', 'func_80087104(objectIndex, 0x003CU)', 'func_80087954(objectIndex, 0x0000003C)',
        'func_8008789C(objectIndex, 0x0000003C)', 'func_8008A6DC(objectIndex, 500.0f);',
        '(f32) (gObjectList[objectIndex].surfaceHeight + 2.5);'),
    'src/render_objects.c': ('func_8008A364(test, arg0, 0x2AABU, 0x00000320);', 'common_vtx_hedgehog, 0x00000040, 0x00000040,\n'
                             '                           0x00000040, 0x00000020);'),
}


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
    rows = [struct.unpack('>3hH2h4B', common[QUAD + 16 * i:QUAD + 16 * i + 16]) for i in range(8)]
    if any(r[6:] != (255, 255, 255, 255) for r in rows):
        raise ValueError('common_vtx_hedgehog: expected white vertices')
    quad = [[x, y, z, s / 64, t / 64] for x, y, z, _, s, t, *_ in rows]   # s / t in texels (gSPTexture 0x8000 halves them)

    folder = Path('public/mk64') / COURSE.replace('_', '-')
    course_json = json.loads((folder / 'course.json').read_text())
    meta = json.loads((args.source / f'assets/courses/{COURSE}.json').read_text())
    block = course_json['provenance']['pathBlockRomOffset']
    segment = karts.mio0(rom[block:])
    tm = meta['gTLUTCrab']
    if (tm['type'], tm['width'] * tm['height'], int(tm['rom_offset'], 16)) != ('rgba16', 256, block):
        raise ValueError('gTLUTCrab: expected 256 RGBA16 colours in the course data segment')
    tat = int(tm['block_offset'], 16)
    palette = karts.rgba16(segment[tat:tat + 512])
    first = int(meta['gTextureCrab1']['block_offset'], 16)
    images, frames = {}, []
    for i in range(FRAMES):
        m = meta[f'gTextureCrab{i + 1}']
        at = int(m['block_offset'], 16)
        if (m['type'], m['width'], m['height'], m['tlut']) != ('ci8', 64, 64, 'gTLUTCrab') or int(m['rom_offset'], 16) != block \
                or at != first + i * 64 * 64:
            raise ValueError(f'gTextureCrab{i + 1}: expected the next 64x64 CI8 frame in the course data segment')
        rgba = b''.join(palette[c] for c in segment[at:at + 64 * 64])
        image = f'crab-{i + 1}.png'
        images[image] = karts.png(64, 64, rgba)
        frames.append(dict(image=image, symbol=f'gTextureCrab{i + 1}', rgbaSha256=hashlib.sha256(rgba).hexdigest()))

    data = (args.source / 'src/data/some_data.c').read_text()
    body = re.search(r'CrabSpawn gCrabSpawns\[\] = \{(.*?)\};', data, re.S).group(1)
    rows = [props.numbers(r) for r in re.findall(r'\{([^{}]+)\}', body)]
    packed = b''.join(struct.pack('>4H', *r) for r in rows)
    spawn_at = rom.find(packed)
    if len(rows) != 10 or spawn_at < 0:
        raise ValueError('gCrabSpawns does not match the ROM')
    s16 = lambda v: v - 0x10000 if v > 0x7FFF else v
    spawns = [[s16(v) for v in r] for r in rows]   # startX, patrolX, startZ, patrolZ

    out = dict(romSha1=karts.US_SHA1, courseDataRomOffset=block, spawnList='gCrabSpawns', spawnListRomOffset=spawn_at,
               spawns=spawns, quad=quad, frames=frames, scale=0.15, boundingBoxSize=1, speed=1.5, patrolSpeed=0.8)
    for name, png in images.items():
        (folder / name).write_bytes(png)
    (folder / 'crabs.json').write_text(json.dumps(out, separators=(',', ':')) + '\n')
    print(f'{len(spawns)} crabs (spawns at ROM {spawn_at:#x}); {len(images)} frames')


if __name__ == '__main__':
    main()
