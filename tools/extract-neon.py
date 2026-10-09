#!/usr/bin/env python3
"""Extract Rainbow Road's neon signs from the ROM (no downloads).

Usage: python3 tools/extract-neon.py ROM --source /path/to/n64decomp/mk64
Writes public/mk64/rainbow-road/neon.json plus neon-*.png (one PNG per sign and palette frame).

- init_course_objects (COURSE_RAINBOW_ROAD, not in the credits): init_object on the NUM_NEON_SIGNS (10) objects.
- update_object_neon: 0 = the mushroom (func_80085CA0 at -1431, 827, -2957), 1 = Mario (func_80085E38 at 799, 1193,
  -5891), 2 = the Boo (func_80085F74 at -2013, 555, 0), each a 64x64 CI8 texture animated through 5 TLUTs
  (d_course_rainbow_road_neon_*_tlut_list); 3-9 = the static signs at D_800E6734 (src/data/some_data.c, verified in
  the ROM): Peach, Luigi, DK, Yoshi, Bowser, Wario, Toad (d_course_rainbow_road_static_textures / _static_tluts).
  func_80085BB4: sizeScaling 8, orientation (0, 0, 0x8000). x * xOrientation.
- render_object_neon: draw_2d_texture_at (common_vtx_hedgehog, 64x64 drawn as two 64x32 strips, D_0D007D78:
  G_CC_DECALRGBA, G_RM_AA_ZB_TEX_EDGE, bilinear) turned to the camera, while state >= 2, not hidden (0x80000) and in
  the camera's 0x2AAB view wedge (is_object_visible_on_camera). No distance limit.
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


snowmen = load('extract-snowmen')
karts = snowmen.karts

COURSE = 'rainbow_road'
ANIMATED = [('mushroom', 'Mushroom', (-1431, 827, -2957)), ('mario', 'Mario', (799, 1193, -5891)), ('boo', 'Boo', (-2013, 555, 0))]
STATIC = ['Peach', 'Luigi', 'DonkeyKong', 'Yoshi', 'Bowser', 'Wario', 'Toad']
NEEDLES = [
    'set_obj_origin_pos(objectIndex, xOrientation * -1431.0, 827.0f, -2957.0f);',
    'set_obj_origin_pos(objectIndex, xOrientation * 799.0, 1193.0f, -5891.0f);',
    'set_obj_origin_pos(objectIndex, xOrientation * -2013.0, 555.0f, 0.0f);',
    'gObjectList[objectIndex].sizeScaling = 8.0f;',
    'set_obj_orientation(objectIndex, 0U, 0U, 0x8000U);',
    # mushroom
    'func_80072E54(objectIndex, 0, 4, 1, 0x0000000C, 5);', 'func_80072D3C(objectIndex, 3, 4, 4, 0x0000000A);',
    'set_and_run_timer_object(objectIndex, 0x00000014);', 'func_80072D3C(objectIndex, 3, 4, 0, 0x00000014);',
    # Mario
    'func_80072E54(objectIndex, 0, 4, 1, 0x0000000C, 1);', 'func_80072D3C(objectIndex, 3, 4, 0x0000000C, 1);',
    'func_80072B48(objectIndex, 0x0000000C);',
    # Boo
    'func_80072E54(objectIndex, 0, 4, 1, 5, 1);', 'set_and_run_timer_object(objectIndex, 0x0000001E);',
    'func_80072C00(objectIndex, 4, 0, 7);', 'func_80072F88(objectIndex, 3, 0, 1, 5, 1);',
    'func_80072B48(objectIndex, 0x0000000F);',
]


def ci8(segment, meta, tex, tlut):
    m, tm = meta[tex], meta[tlut]
    if (m['type'], m['width'], m['height']) != ('ci8', 64, 64) or tm['type'] != 'rgba16':
        raise ValueError(f'{tex}: expected a 64x64 CI8 texture')
    at, tat = int(m['block_offset'], 16), int(tm['block_offset'], 16)
    palette = karts.rgba16(segment[tat:tat + 512])
    return b''.join(palette[c] for c in segment[at:at + 64 * 64])


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('rom', type=Path)
    parser.add_argument('--source', type=Path, required=True)
    args = parser.parse_args()
    rom = args.rom.read_bytes()
    if hashlib.sha1(rom).hexdigest() != karts.US_SHA1:
        raise SystemExit('Expected the US Mario Kart 64 ROM (SHA1 %s)' % karts.US_SHA1)
    common = karts.mio0(rom[snowmen.COMMON_DATA_ROM:])
    want = bytes.fromhex(snowmen.EXPECT[0x7D78].replace(' ', ''))
    if common[0x7D78:0x7D78 + len(want)] != want:
        raise ValueError('common_data 0x0D007D78 differs from the expected display list')
    at = snowmen.QUADS['body'][0]   # common_vtx_hedgehog
    rows = [struct.unpack('>3hH2h4B', common[at + 16 * i:at + 16 * i + 16]) for i in range(8)]
    quad = [[x, y, z, s / 64, t / 64] for x, y, z, _, s, t, *_ in rows]

    src = (args.source / 'src/update_objects.c').read_text()
    for needle in NEEDLES:
        if needle not in src:
            raise ValueError(f'update_objects.c no longer has: {needle}')

    data = (args.source / 'src/data/some_data.c').read_text()
    floats = [float(v) for v in re.findall(r'-?\d+\.\d+', re.search(r'float D_800E6734\[\] = \{(.*?)\};', data, re.S).group(1))]
    packed = struct.pack('>%df' % len(floats), *floats)
    table_at = rom.find(packed)
    if len(floats) != 21 or table_at < 0:
        raise ValueError('D_800E6734 does not match the ROM')

    folder = Path('public/mk64') / COURSE.replace('_', '-')
    course_json = json.loads((folder / 'course.json').read_text())
    meta = json.loads((args.source / f'assets/courses/{COURSE}.json').read_text())
    block = course_json['provenance']['pathBlockRomOffset']
    segment = karts.mio0(rom[block:])
    images, signs = {}, []
    for key, name, pos in ANIMATED:
        frames = []
        for i in range(5):
            rgba = ci8(segment, meta, f'gTextureRainbowRoadNeon{name}', f'gTLUTRainbowRoadNeon{name}{i + 1}')
            image = f'neon-{key}-{i}.png'
            images[image] = karts.png(64, 64, rgba)
            frames.append(image)
        signs.append(dict(name=key, anim=key, pos=list(pos), frames=frames))
    for i, name in enumerate(STATIC):
        tex, tlut = f'gTextureRainbowRoadNeon{name}', f'gTLUTRainbowRoadNeon{name}'
        # func_80086074: &static_tluts[i * 256] / &static_textures[i] must land on this sign's own data
        if int(meta[tex]['block_offset'], 16) != 0xB000 + 0x1000 * i or int(meta[tlut]['block_offset'], 16) != 0x7200 + 0x200 * i:
            raise ValueError(f'{name}: not at static_textures[{i}] / static_tluts[{i} * 256]')
        image = f'neon-{name.lower()}.png'
        images[image] = karts.png(64, 64, ci8(segment, meta, tex, tlut))
        signs.append(dict(name=name.lower(), anim=None, pos=floats[3 * i:3 * i + 3], frames=[image]))

    out = dict(romSha1=karts.US_SHA1, courseDataRomOffset=block, staticPositions='D_800E6734', staticPositionsRomOffset=table_at,
               scale=8, viewAngle=0x2AAB, quad=quad, signs=signs)
    for name, png in images.items():
        (folder / name).write_bytes(png)
    (folder / 'neon.json').write_text(json.dumps(out, separators=(',', ':')) + '\n')
    print(f'{len(signs)} neon signs (D_800E6734 at ROM {table_at:#x}); {len(images)} textures')


if __name__ == '__main__':
    main()
