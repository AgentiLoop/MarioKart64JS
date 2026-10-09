#!/usr/bin/env python3
"""Extract Rainbow Road's Chain Chomps from the ROM (no downloads).

Usage: python3 tools/extract-chomp.py ROM --source /path/to/n64decomp/mk64
Writes public/mk64/rainbow-road/chomp.json plus chomp-*.png.

- init_course_objects (COURSE_RAINBOW_ROAD, not in the credits): init_object on the NUM_CHAIN_CHOMPS (3) objects.
- func_80085878 (chomp i): model d_rainbow_road_unk4 (armature) / vertex d_rainbow_road_unk3 (its one animation),
  sizeScaling 0.03, boundingBoxSize 10, flags 0x04000200, path point i * 300 + 500 of gCurrentTrackPath, origin
  (0, -15, 0), speed (unk_034) 4, type = animation length - 1.
- update_chain_chomps: func_80072E54(0, type, 1, 0, -1) steps the animation frame every frame; every 64th frame
  (D_8018D40C == 0) sound 0x19018057 from the chomp; func_80074344 swings surfaceHeight -0.8 .. 0.8 by 0.03 a frame;
  func_8000D940 moves it 4 units towards path points - 3 / - 4 (against the karts) at lateral factor surfaceHeight;
  it faces the way it moved; func_80089CBC(30): a kart within 10 + its box (x/z) and 30 (y) tumbles.
- render_object_chain_chomps: func_8008A1D0(1500, 2500): drawn within 2500 in the view wedge; within 1500 the
  armature (D_0D0077D0 + render_animated_model), beyond it d_course_rainbow_road_sphere (32x64 RGBA16, S mirrored to 64)
  on D_0D0062B0 at 0.54, 16 up, turned to the camera and rolled 0x8000 (func_800468E0, D_0D0079C8).
- Model display lists: the body halves and jaws are G_TEXTURE_GEN reflection maps (metal / gold, G_CC_DECALRGB,
  gSPTexture 0x07C0), the tongue G_CC_MODULATEI unlit (vertex colours), the eyes G_CC_MODULATEIA lit by light1
  (G_RM_AA_ZB_TEX_EDGE). Every vertex array, the animation data and the common_data pieces are checked in the ROM.
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
PREFIX = 'd_course_rainbow_road_'
TEXTURES = {   # course symbol -> (assets json name, PNG)
    'reflection_map_metal': ('gTextureRainbowRoadReflectionMapMetal', 'chomp-metal.png'),
    'reflection_map_gold': ('gTextureRainbowRoadReflectionMapGold', 'chomp-gold.png'),
    'chain_chomp_tongue': ('gTextureRainbowRoadChainChompTongue', 'chomp-tongue.png'),
    'chain_chomp_eye': ('gTextureRainbowRoadChainChompEye', 'chomp-eye.png'),
}
COMMON = {   # common_data display lists the chomp relies on (raw F3DEX words)
    0x77D0: '060000000d007780 b900031d00552078 fcfffffffffe793c b700000000022204 b800000000000000',   # D_0D0077D0
    0x79C8: '060000000d0078f8 b900031d00553078 ba000c0200002000 b800000000000000',                     # D_0D0079C8
    0x78F8: 'ba00130100080000 ba000e0200000000 b900000200000000 fcfffffffffcf279 bb00000180008000 b800000000000000',
    0x6940: 'b100040200000604 b800000000000000',                                                       # common_rectangle_display
}
SPHERE_VTX = 0x62B0   # D_0D0062B0
NEEDLES = {
    'src/update_objects.c': [
        'object->model = (Gfx*) d_rainbow_road_unk4;', 'object->vertex = (Vtx*) d_rainbow_road_unk3;',
        'object->sizeScaling = 0.03f;', 'object->boundingBoxSize = 0x000A;',
        'set_object_flag_status_true(objectIndex, 0x04000200);', 'object->unk_084[8] = (arg1 * 0x12C) + 0x1F4;',
        'set_obj_origin_pos(objectIndex, 0.0f, -15.0f, 0.0f);', 'object->unk_034 = 4.0f;',
        'object->type = get_animation_length(d_rainbow_road_unk3, 0);',
        'func_80072E54(objectIndex, 0, (s32) object->type, 1, 0, -1);',
        'func_800C98B8(object->pos, object->velocity, SOUND_ARG_LOAD(0x19, 0x01, 0x80, 0x57));',
        'func_80074344(objectIndex, &object->surfaceHeight, -0.8f, 0.8f, 0.03f, 0, -1);',
        'func_8000D940(object->offset, &object->unk_084[8], object->unk_034, object->surfaceHeight, 0);',
        'object->direction_angle[1] = get_xz_angle_between_points(object->unk_01C, object->offset);',
        'func_80089CBC(objectIndex, 30.0f);',
    ],
    'src/render_objects.c': [
        'func_8008A1D0(objectIndex, cameraId, 0x000005DC, 0x000009C4);',
        'D_80183E40[1] = gObjectList[objectIndex].pos[1] + 16.0;', 'D_80183E80[2] = 0x8000;',
        'func_800468E0(D_80183E40, D_80183E80, 0.54f, d_course_rainbow_road_sphere, D_0D0062B0, 0x00000020,',
        'gSPDisplayList(gDisplayListHead++, D_0D0077D0);',
    ],
    'include/objects.h': ['#define NUM_CHAIN_CHOMPS 3'],
    'yamls/courses/rainbow_road_metadata.yml': ['cpu_maximum_separation: 50.0f'],
}


def numbers(text):
    return [int(v, 0) for v in re.findall(r'-?(?:0x[0-9A-Fa-f]+|\d+)', text)]


def s8(v):
    return v - 256 if v > 127 else v


def pack_vtx(rows):
    return b''.join(struct.pack('>3hH2h4B', x, y, z, f, s, t, a, b, c, d) for x, y, z, f, s, t, a, b, c, d in rows)


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

    common = karts.mio0(rom[snowmen.COMMON_DATA_ROM:])
    for at, words in COMMON.items():
        want = bytes.fromhex(words.replace(' ', ''))
        if common[at:at + len(want)] != want:
            raise ValueError(f'common_data 0x0D00{at:04X} differs from the expected display list')
    rows = [struct.unpack('>3hH2h4B', common[SPHERE_VTX + 16 * i:SPHERE_VTX + 16 * i + 16]) for i in range(4)]
    sphere_quad = [[x, y, z, s / 64, t / 64] for x, y, z, _, s, t, *_ in rows]   # S10.5 halved by gSPTexture 0x8000

    folder = Path('public/mk64') / COURSE.replace('_', '-')
    course_json = json.loads((folder / 'course.json').read_text())
    meta = json.loads((args.source / f'assets/courses/{COURSE}.json').read_text())
    block = course_json['provenance']['pathBlockRomOffset']
    segment = karts.mio0(rom[block:])
    text = (args.source / f'courses/{COURSE}/course_data.c').read_text()

    lights = {}
    for name, body in re.findall(rf'Lights1 {PREFIX}(light\d) = gdSPDefLights1\((.*?)\);', text):
        v = numbers(body)
        lights[name] = dict(ambient=v[0:3], color=v[3:6], dir=[s8(c) for c in v[6:9]])

    vtx = {}
    for name, body in re.findall(rf'Vtx {PREFIX}(chomp_\w+)\[\] = \{{(.*?)\}};', text, re.S):
        vtx[name] = [numbers(row) for row in re.findall(r'\{\s*\{\s*\{([^\n]*?)\}\s*\}\s*\}', body)]
        if segment.find(pack_vtx([r[:6] + [c & 255 for c in r[6:]] for r in vtx[name]])) < 0:
            raise ValueError(f'{name} does not match the ROM')

    # display lists -> parts grouped by how the RDP draws them
    def walk(name, state, parts, cache):
        body = re.search(rf'Gfx {PREFIX}{name}\[\] = \{{(.*?)\}};', text, re.S).group(1)
        for command, a in re.findall(r'(gs\w+)\((.*?)\)(?=\s*,|\s*$)', body, re.S):
            a = [v.strip() for v in a.split(',')]
            if command == 'gsSPSetGeometryMode' or command == 'gsSPClearGeometryMode':
                on = command == 'gsSPSetGeometryMode'
                for flag in a[0].split('|'):
                    state[flag.strip()] = on
            elif command == 'gsSPLight' and a[0].endswith('.l'):
                state['light'] = a[0].split(PREFIX)[1].split('.')[0]
            elif command in ('gsDPLoadTextureBlock', 'gsDPSetTextureImage'):
                symbol = (a[0] if command == 'gsDPLoadTextureBlock' else a[3]).replace(PREFIX, '')
                state['texture'] = TEXTURES[symbol][1]
            elif command == 'gsSPTexture':
                if a[4] == 'G_OFF':
                    state['texture'] = None
            elif command == 'gsDPSetCombineMode':
                state['combine'] = a[0]
            elif command == 'gsSPVertex':
                rows, count, start = vtx[a[0].replace(PREFIX, '')], int(a[1], 0), int(a[2], 0)
                for j in range(count):
                    cache[start + j] = rows[j]
            elif command in ('gsSP1Triangle', 'gsSP2Triangles'):
                if state['G_TEXTURE_GEN']:
                    kind = 'reflect'   # G_CC_DECALRGB: the texel picked by the normal
                elif state['G_LIGHTING']:
                    kind = 'lit'
                else:
                    kind = 'colour'
                key = (kind, state['texture'], state['combine'], state['light'] if kind == 'lit' else None)
                part = next((p for p in parts if p['key'] == key), None)
                if part is None:
                    part = dict(key=key, positions=[], normals=[], colors=[], uvs=[])
                    parts.append(part)
                for j in range(0, len(a), 4):
                    for v in a[j:j + 3]:
                        x, y, z, _f, s, t, r, g, b, _a = cache[int(v, 0)]
                        part['positions'] += [x, y, z]
                        if kind == 'colour':
                            part['colors'] += [r & 255, g & 255, b & 255]
                        else:
                            part['normals'] += [round(s8(n & 255) / 127, 4) for n in (r, g, b)]
                        part['uvs'] += [s / 32 / 32, t / 32 / 32]   # s10.5 texels over the 32-texel tile

    def model(name):
        parts = []
        walk(name, {'G_TEXTURE_GEN': False, 'G_LIGHTING': True, 'texture': None, 'combine': None, 'light': None}, parts, {})
        out = []
        for p in parts:
            kind, texture, combine, light = p['key']
            part = dict(kind=kind, texture=texture, combine=combine, positions=p['positions'], uvs=p['uvs'])
            if kind == 'colour':
                part['colors'] = p['colors']
            else:
                part['normals'] = p['normals']
            if light:
                part['light'] = light
            out.append(part)
        return out

    armature = []
    body = re.search(r'u32 d_rainbow_road_unk4\[\] = \{(.*?)\};', text, re.S).group(1)
    for m in re.finditer(r'ANIMATION_(DISABLE_AUTOMATIC_POP|POP_MATRIX|STOP|RENDER_MODEL|ADD_POS)(?:\((.*?)\))?,', body):
        kind, a = m.group(1), m.group(2)
        if kind == 'RENDER_MODEL':
            name = a.strip().lstrip('&').replace(PREFIX, '')
            armature.append(dict(op='limb', model=model(name), pos=[0, 0, 0], name=name))
        elif kind == 'ADD_POS':
            armature.append(dict(op='limb', model=None, pos=numbers(a)))
        else:
            armature.append(dict(op={'DISABLE_AUTOMATIC_POP': 'nopop', 'POP_MATRIX': 'pop', 'STOP': 'stop'}[kind]))

    # the one animation: d_rainbow_road_unk3[0] = &d_rainbow_road_unk2 (0x060160F8)
    head = re.search(r'Animation d_rainbow_road_unk2 = \{(.*?)\};', text, re.S).group(1)
    flags, _, length, limbs = numbers(head.split('d_rainbow_road_chomp_angle')[0])[:4]
    values = [v - 65536 if v > 32767 else v for v in numbers(re.search(r's16 d_rainbow_road_chomp_angle\[\] = \{(.*?)\};', text, re.S).group(1))]
    cycle = numbers(re.search(r'AnimationLimbVector d_rainbow_road_chomp_animation_matrix\[\] = \{(.*?)\};', text, re.S).group(1))
    if segment[0x15FC8:0x15FC8 + 2 * len(values)] != struct.pack('>%dh' % len(values), *values):
        raise ValueError('d_rainbow_road_chomp_angle does not match the ROM')
    if segment[0x16098:0x16098 + 2 * len(cycle)] != struct.pack('>%dH' % len(cycle), *cycle):
        raise ValueError('d_rainbow_road_chomp_animation_matrix does not match the ROM')
    if segment[0x160F8:0x160F8 + 12] != struct.pack('>IIhh', flags, 0, length, limbs):
        raise ValueError('d_rainbow_road_unk2 does not match the ROM')
    if len(cycle) != 6 * (limbs + 1) or sum(1 for s in armature if s['op'] == 'limb') != limbs:
        raise ValueError('animation limbs do not match the armature')
    animation = dict(length=length, values=values, limbs=[[cycle[i:i + 2] for i in range(j, j + 6, 2)] for j in range(0, len(cycle), 6)])

    images = {}
    for symbol, (asset, image) in TEXTURES.items():
        m = meta[asset]
        if (m['type'], m['width'], m['height']) != ('rgba16', 32, 32):
            raise ValueError(f'{asset}: expected 32x32 RGBA16')
        at = int(m['block_offset'], 16)
        images[image] = karts.png(32, 32, b''.join(karts.rgba16(segment[at:at + 2048])))
    m = meta['gTextureRainbowRoadSphere']
    if (m['type'], m['width'], m['height']) != ('rgba16', 32, 64):
        raise ValueError('gTextureRainbowRoadSphere: expected 32x64 RGBA16')
    at = int(m['block_offset'], 16)
    texels = karts.rgba16(segment[at:at + 32 * 64 * 2])
    # G_TX_MIRROR on S (mask 5): texels 32..63 repeat 31..0
    rows64 = [texels[32 * r:32 * r + 32] for r in range(64)]
    images['chomp-sphere.png'] = karts.png(64, 64, b''.join(b''.join(row) + b''.join(reversed(row)) for row in rows64))

    out = dict(romSha1=karts.US_SHA1, courseDataRomOffset=block,
               source='n64decomp/mk64 courses/rainbow_road/course_data.c d_rainbow_road_unk4 / unk3; src/update_objects.c func_80085878',
               count=3, firstPoint=0x1F4, pointStep=0x12C, origin=[0, -15, 0], speed=4, scale=0.03, box=10, hitHeight=30,
               weave=[-0.8, 0.8, 0.03], maxSeparation=50, near=1500, far=2500, sound=[1, 0x57],
               sphere=dict(image='chomp-sphere.png', quad=sphere_quad, scale=0.54, up=16, roll=0x8000),
               lights=lights, armature=armature, animation=animation)
    for name, png in images.items():
        (folder / name).write_bytes(png)
    (folder / 'chomp.json').write_text(json.dumps(out, separators=(',', ':')) + '\n')
    tris = sum(len(p['positions']) // 9 for s in armature if s.get('model') for p in s['model'])
    print(f'{limbs} limbs, {tris} triangles, animation {length} frames; {len(images)} textures; '
          f'parts {[(p["kind"], p["texture"]) for s in armature if s.get("model") for p in s["model"]]}')


if __name__ == '__main__':
    main()
