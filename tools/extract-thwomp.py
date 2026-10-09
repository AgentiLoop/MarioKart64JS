#!/usr/bin/env python3
"""Extract Bowser's Castle's Thwomps from the ROM (no downloads).

Usage: python3 tools/extract-thwomp.py ROM --source /path/to/n64decomp/mk64
Writes public/mk64/bowsers-castle/thwomp.json plus the decoded textures (prop-gTextureThwompSide.png and
thwomp-face-1..6.png).

- render_object_thwomps_model draws d_course_bowsers_castle_dl_thwomp (tools/extract-props.py walker, vertex arrays and
  the RGBA16 side texture verified byte-for-byte; common_data D_0D007828 sets G_LIGHTING | G_CULL_BACK, checked here as
  raw F3DEX words). Its first quad (the face) uses the texture the render code loads first: the object's CI8 16x64 face
  frame (d_course_bowsers_castle_thwomp_faces[textureListIndex], 6 frames) through d_course_bowsers_castle_thwomp_tlut,
  S mirrored at 16 texels (rsp_load_texture_mask), T clamped.
- func_800534E8 lights each Thwomp by its object type: 0 = D_800E4638 (its direction replaced every frame by
  func_800419F8's (0, 0, 120) turned by D_80165834), 1 = D_800E4650, 2 = D_800E4668 (bytes read from the ROM's
  data_800E45C0 block).
- init_course_objects: gThomwpSpawns50CC / gThwompSpawns100CCExtra / gThomwpSpawns150CC {x, z, behaviour, variant}
  (src/data/some_data.c), verified in the ROM.
- The TrackSections d_course_bowsers_castle_addr triangles with their section ids (D_8018CF68: a Thwomp is drawn while
  the screen's section is within one of its unk_0DF).
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

COURSE = 'bowsers_castle'
D = f'd_course_{COURSE}_'
KINDS = {'thwomp': ([(f'{D}dl_thwomp', True)], True)}
COMMON_DATA_ROM = 0x132B50
# D_0D007828: gsSPDisplayList(D_0D007780), G_RM_AA_ZB_OPA_SURF, a combine, gsSPSetGeometryMode(G_ZBUFFER | G_SHADE |
# G_CULL_BACK | G_LIGHTING | G_SHADING_SMOOTH), gsSPEndDisplayList
D_0D007828 = bytes.fromhex('060000000d007780 b900031d00552078 fc121824ff33ffff b700000000022204 b800000000000000')
LIGHTS = {0: 'D_800E4638', 1: 'D_800E4650', 2: 'D_800E4668'}   # func_800534E8, by object type
SPAWNS = {'50': 'gThomwpSpawns50CC', '100': 'gThwompSpawns100CCExtra', '150': 'gThomwpSpawns150CC'}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('rom', type=Path)
    parser.add_argument('--source', type=Path, required=True)
    args = parser.parse_args()
    rom = args.rom.read_bytes()
    if hashlib.sha1(rom).hexdigest() != karts.US_SHA1:
        raise SystemExit('Expected the US Mario Kart 64 ROM (SHA1 %s)' % karts.US_SHA1)
    if karts.mio0(rom[COMMON_DATA_ROM:])[0x7828:0x7828 + len(D_0D007828)] != D_0D007828:
        raise ValueError('common_data D_0D007828 differs from the expected render setup')
    folder = Path('public/mk64') / COURSE.replace('_', '-')
    course_json = json.loads((folder / 'course.json').read_text())
    out, images = props.convert(args.source, rom, COURSE, course_json,
                                (None, KINDS, {}, dict(mode='opaque', combine='G_CC_MODULATEIA')),
                                normals=[85, 85, 85, 255, 255, 255, 0, 136, 0])
    del out['actors']
    parts = out['models']['thwomp']['parts']
    if 'image' in parts[0] or len(parts[0]['triangles']) != 2 or any('image' not in p for p in parts[1:]):
        raise ValueError('expected the face quad first, untextured by the list itself')
    parts[0]['face'] = True
    if [l['name'] for l in out['lights']] != ['render']:
        raise ValueError('the Thwomp list should only use the render code light')

    # the object-type lights from the ROM (yamls/us/data_800E45C0.yml: vram 0x800E45C0 at ROM 0xE51C0)
    yml = (args.source / 'yamls/us/data_800E45C0.yml').read_text()
    vram, offset = (int(v, 16) for v in re.search(r'addr: (0x\w+)\s+offset: (0x\w+)', yml).groups())
    lights = {}
    for kind, name in LIGHTS.items():
        at = offset + int(re.search(rf'{name}:\s+symbol: {name}\s+type: lights\s+offset: (0x\w+)', yml).group(1), 16) - vram
        a = rom[at:at + 24]
        if a[0:3] != a[4:7] or a[8:11] != a[12:15]:
            raise ValueError(f'{name} at ROM {at:#x} is not a Lights1')
        lights[kind] = dict(name=name, romOffset=at, ambient=list(a[0:3]), color=list(a[8:11]),
                            direction=[props.s8(v) for v in a[16:19]])

    # the CI8 face frames through the course TLUT
    meta = json.loads((args.source / f'assets/courses/{COURSE}.json').read_text())
    segment = karts.mio0(rom[course_json['provenance']['pathBlockRomOffset']:])
    tlut_at = int(meta['gTLUTThwomp']['block_offset'], 16)
    palette = karts.rgba16(segment[tlut_at:tlut_at + 512])
    faces = []
    for i in range(6):
        m = meta[f'gTextureThwompFace{i + 1}']
        if (m['type'], m['width'], m['height'], m['tlut']) != ('ci8', 16, 64, 'gTLUTThwomp'):
            raise ValueError(f'gTextureThwompFace{i + 1} is not a CI8 16x64 frame')
        at = int(m['block_offset'], 16)
        rgba = b''.join(palette[c] for c in segment[at:at + 1024])
        name = f'thwomp-face-{i + 1}.png'
        images[name] = karts.png(16, 64, rgba)
        faces.append(dict(image=name, rgbaSha256=hashlib.sha256(rgba).hexdigest()))

    # gThwompSpawns: {startX, startZ, behaviour (unk_0D5), variant (primAlpha)}
    data = (args.source / 'src/data/some_data.c').read_text()
    spawns = {}
    for cc, name in SPAWNS.items():
        rows = [props.numbers(r) for r in re.findall(r'\{([^{}]+)\}', re.search(rf'ThwompSpawn {name}\[\] = \{{(.*?)\}};', data, re.S).group(1))]
        packed = b''.join(struct.pack('>4H', *r) for r in rows)
        at = rom.find(packed)
        if at < 0:
            raise ValueError(f'{name} does not match the ROM')
        spawns[cc] = dict(name=name, romOffset=at, thwomps=[[x - 0x10000 if x > 0x7FFF else x, z - 0x10000 if z > 0x7FFF else z, b, v]
                                                            for x, z, b, v in rows])

    src = (args.source / 'src/update_objects.c').read_text()
    for needle in ('D_80165834[0] += 0x100;', 'D_80165834[1] += 0x200;', 'object->sizeScaling = 1.5f;',
                   'object->surfaceHeight = 70.0f;', "f32_step_towards(&gObjectList[objectIndex].offset[2], -250.0f,"):
        if needle not in src:
            raise ValueError(f'update_objects.c no longer has: {needle}')

    data_c = (args.source / f'courses/{COURSE}/course_data.c').read_text()
    dls_c = (args.source / f'courses/{COURSE}/course_displaylists.inc.c').read_text()
    lists = dict(re.findall(r'Gfx (\w+)\[\] = \{(.*?)\};', dls_c + data_c, re.S))
    sections = egg.track_sections(data_c, lists, course_json['vertices'], COURSE)

    out.update(typeLights=lights, faces=faces, spawns=spawns, sectionTable=f'{D}addr', sections=sections)
    for name, png in images.items():
        (folder / name).write_bytes(png)
    (folder / 'thwomp.json').write_text(json.dumps(out, separators=(',', ':')) + '\n')
    tris = sum(len(p['triangles']) for p in parts)
    print(f'{tris} triangles in {len(parts)} parts; lights {[l["name"] for l in lights.values()]}; '
          f'spawns { {cc: len(s["thwomps"]) for cc, s in spawns.items()} }; {len(sections)} section triangles; '
          f'{len(images)} textures')


if __name__ == '__main__':
    main()
