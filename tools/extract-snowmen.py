#!/usr/bin/env python3
"""Extract Frappe Snowland's snowmen from the ROM (no downloads).

Usage: python3 tools/extract-snowmen.py ROM --source /path/to/n64decomp/mk64
Writes public/mk64/frappe-snowland/snowmen.json plus snowman-head.png, snowman-body.png and snow.png.

- init_course_objects (COURSE_FRAPPE_SNOWLAND, not in the credits): one head (indexObjectList2, origin y + 5 + 3) and one
  body (indexObjectList1, origin y + 3, unk_0D5 = the spawn's section) per gSnowmanSpawns entry {x, y, z, section}
  (src/data/some_data.c, verified in the ROM), x * xOrientation.
- render_object_snowmans_list_1: draw_2d_texture_at the body (common_vtx_hedgehog) and the head (D_0D0061B0, 12 nearer
  the camera), both 64x64 CI8 through gTLUTSnowman, drawn as two 64x32 strips (draw_rectangle_texture_overlap: the
  second strip starts at row 31) with gSPTexture 0x8000 (D_0D007C88, so s / t are halved), D_0D007D78 setup:
  G_CC_DECALRGBA, G_RM_AA_ZB_TEX_EDGE, G_TT_RGBA16, bilinear.
- render_object_snowmans_list_2: the snow puffs (func_800836F0), D_0D0069E0 = D_0D005AE0 quad + the 32x32 CI8
  gTextureSnow through gTLUTSnow.
The common_data vertex arrays and display lists are read from the ROM; the textures from the course data segment.
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


props, egg = load('extract-props'), load('extract-yoshi-egg')
karts = props.karts

COURSE = 'frappe_snowland'
COMMON_DATA_ROM = 0x132B50
# D_0D007C88 (G_TT_RGBA16, G_CC_DECALRGBA, gSPTexture 0x8000 0x8000) and D_0D007D78 (+ G_TF_BILERP, G_RM_AA_ZB_TEX_EDGE)
EXPECT = {
    0x7C88: 'ba00130100080000 b900000200000000 ba000e0200008000 fcfffffffffcf279 bb00000180008000 b800000000000000',
    0x7D78: '060000000d007c88 ba000c0200002000 b900031d00553078 b800000000000000',
    0x69E0: '0400103f0d005ae0 060000000d006940 b800000000000000',   # snow puff: D_0D005AE0 + common_rectangle_display
    0x6940: 'b100040200000604 b800000000000000',                     # common_rectangle_display: (0, 2, 1), (0, 3, 2)
}
QUADS = {'body': (0x60B0, 8), 'head': (0x61B0, 8), 'snow': (0x5AE0, 4)}   # common_vtx_hedgehog, D_0D0061B0, D_0D005AE0
TEXTURES = {'head': ('gTextureSnowmanHead', 'gTLUTSnowman', 64), 'body': ('gTextureSnowmanBody', 'gTLUTSnowman', 64),
            'snow': ('gTextureSnow', 'gTLUTSnow', 32)}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('rom', type=Path)
    parser.add_argument('--source', type=Path, required=True)
    args = parser.parse_args()
    rom = args.rom.read_bytes()
    if hashlib.sha1(rom).hexdigest() != karts.US_SHA1:
        raise SystemExit('Expected the US Mario Kart 64 ROM (SHA1 %s)' % karts.US_SHA1)
    common = karts.mio0(rom[COMMON_DATA_ROM:])
    for at, words in EXPECT.items():
        want = bytes.fromhex(words.replace(' ', ''))
        if common[at:at + len(want)] != want:
            raise ValueError(f'common_data 0x0D00{at:04X} differs from the expected display list')

    # [x, y, z, s, t] per vertex, s / t in texels (S10.5 halved by gSPTexture 0x8000)
    quads = {}
    for name, (at, n) in QUADS.items():
        rows = [struct.unpack('>3hH2h4B', common[at + 16 * i:at + 16 * i + 16]) for i in range(n)]
        if any(r[6:] != (255, 255, 255, 255) for r in rows):
            raise ValueError(f'{name}: expected white vertices')
        quads[name] = [[x, y, z, s / 64, t / 64] for x, y, z, _, s, t, *_ in rows]

    folder = Path('public/mk64') / COURSE.replace('_', '-')
    course_json = json.loads((folder / 'course.json').read_text())
    meta = json.loads((args.source / f'assets/courses/{COURSE}.json').read_text())
    block = course_json['provenance']['pathBlockRomOffset']
    segment = karts.mio0(rom[block:])
    images, textures = {}, {}
    for name, (tex, tlut, size) in TEXTURES.items():
        m, tm = meta[tex], meta[tlut]
        if (m['type'], m['width'], m['height'], m['tlut']) != ('ci8', size, size, tlut) or int(m['rom_offset'], 16) != block \
                or int(tm['rom_offset'], 16) != block:
            raise ValueError(f'{tex}: expected a {size}x{size} CI8 texture in the course data segment')
        at, tat = int(m['block_offset'], 16), int(tm['block_offset'], 16)
        palette = karts.rgba16(segment[tat:tat + 512])
        rgba = b''.join(palette[c] for c in segment[at:at + size * size])
        image = f'{"snowman-" if name != "snow" else ""}{name}.png'
        images[image] = karts.png(size, size, rgba)
        textures[name] = dict(image=image, symbol=tex, size=size, rgbaSha256=hashlib.sha256(rgba).hexdigest())

    data = (args.source / 'src/data/some_data.c').read_text()
    rows = [props.numbers(f'{a},{b}') for a, b in re.findall(r'\{\s*\{([^{}]+)\}\s*,\s*(0x\w+)\s*\}',
                                                              re.search(r'SnowmanSpawn gSnowmanSpawns\[\] = \{(.*?)\};', data, re.S).group(1))]
    packed = b''.join(struct.pack('>4H', *r) for r in rows)
    spawn_at = rom.find(packed)
    if len(rows) != 19 or spawn_at < 0:
        raise ValueError('gSnowmanSpawns does not match the ROM')
    s16 = lambda v: v - 0x10000 if v > 0x7FFF else v
    spawns = [[s16(x), s16(y), s16(z), section] for x, y, z, section in rows]

    src = (args.source / 'src/update_objects.c').read_text()
    for needle in ('func_80087C48(objectIndex, 10.0f, 0.5f, 0x0000000A);', 'func_80087D24(objectIndex, 0.0f, 0.2f, -7.0f);',
                   'set_and_run_timer_object(objectIndex, 0x0000012C)', '&object->sizeScaling, 0.001f, 0.1f, 0.0025f, 0, 0)',
                   '-0x00001000, 0x00001000, 0x00000400, 1, -1);', 'gObjectList[objectIndex].velocity[1], 0.74f,',
                   'object->velocity[1] = (object->velocity[1] * 0.5) + 2.6;', 'object->unk_034 = (object->unk_034 * 0.1) + 4.5;'):
        if needle not in src:
            raise ValueError(f'update_objects.c no longer has: {needle}')

    data_c = (args.source / f'courses/{COURSE}/course_data.c').read_text()
    dls_c = (args.source / f'courses/{COURSE}/course_displaylists.inc.c').read_text()
    lists = dict(re.findall(r'Gfx (\w+)\[\] = \{(.*?)\};', dls_c + data_c, re.S))
    sections = egg.track_sections(data_c, lists, course_json['vertices'], COURSE)

    out = dict(romSha1=karts.US_SHA1, courseDataRomOffset=block, spawnList='gSnowmanSpawns', spawnListRomOffset=spawn_at,
               spawns=spawns, quads=quads, textures=textures,
               puffsByScreens={'1': 40, '2': 24, '3': 16, '4': 16},   # D_8018D3BC (init_hud_one_player / two / three-four)
               sectionTable=f'd_course_{COURSE}_addr', sections=sections)
    for name, png in images.items():
        (folder / name).write_bytes(png)
    (folder / 'snowmen.json').write_text(json.dumps(out, separators=(',', ':')) + '\n')
    print(f'{len(spawns)} snowmen (spawns at ROM {spawn_at:#x}); quads {list(quads)}; {len(sections)} section triangles; '
          f'{len(images)} textures')


if __name__ == '__main__':
    main()
