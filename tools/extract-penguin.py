#!/usr/bin/env python3
"""Extract Sherbet Land's penguin (the giant emperor penguin on the ice and the small ones) from a local US ROM.

Usage: python3 tools/extract-penguin.py ROM --source /path/to/n64decomp/mk64 [--output public/mk64/sherbet-land]
n64decomp/mk64 courses/sherbet_land/course_data.c: d_course_sherbet_land_unk_data1 is the penguin's armature
(src/animation.c render_armature) over lit display lists dl_8D00 (body), dl_8730 / dl_8810 (flippers),
dl_8930 / dl_8A78 (feet) and dl_8E00 (head: eye texture G_CC_BLENDRGBA, beak texture G_CC_MODULATEI, shaded head);
d_course_sherbet_land_unk_data11 lists its three animations. Textures gTexturePenguinEye / gTexturePenguinBeak are
32x32 RGBA16 in the course data segment. Every vertex array is verified against the ROM before writing penguin.json.
"""
import argparse
import hashlib
import importlib.util
import json
from pathlib import Path
import re
import struct

spec = importlib.util.spec_from_file_location('karts', Path(__file__).with_name('extract-karts.py'))
karts = importlib.util.module_from_spec(spec)
spec.loader.exec_module(karts)

PREFIX = 'd_course_sherbet_land_'
TEXTURES = {'penguin_eye': ('eye.png', '0x07AE8'), 'penguin_beak': ('beak.png', '0x072E8')}


def numbers(text):
    return [int(v, 0) for v in re.findall(r'-?(?:0x[0-9A-Fa-f]+|\d+)', text)]


def block(text, kind, name):
    return re.search(rf'{kind} {PREFIX}{name}\[\] = \{{(.*?)\}};', text, re.S).group(1)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('rom', type=Path)
    parser.add_argument('--source', type=Path, required=True)
    parser.add_argument('--output', type=Path, default=Path('public/mk64/sherbet-land'))
    args = parser.parse_args()
    rom = args.rom.read_bytes()
    if hashlib.sha1(rom).hexdigest() != karts.US_SHA1:
        raise SystemExit('Expected the US Mario Kart 64 ROM (SHA1 %s)' % karts.US_SHA1)
    text = (args.source / 'courses/sherbet_land/course_data.c').read_text()

    lights = {}
    for name, body in re.findall(rf'Lights1 {PREFIX}(light\d) = gdSPDefLights1\((.*?)\);', text):
        v = numbers(body)
        lights[name] = dict(ambient=v[0:3], color=v[3:6], dir=[c - 256 if c > 127 else c for c in v[6:9]])

    vtx = {}
    for name, body in re.findall(rf'Vtx {PREFIX}(penguin_\w+)\[\] = \{{(.*?)\}};', text, re.S):
        vtx[name] = [numbers(row) for row in re.findall(r'\{\s*\{\s*\{([^\n]*?)\}\s*\}\s*\}', body)]
    segment, at = None, None
    for match in re.finditer(b'MIO0', rom):
        try:
            data = karts.mio0(rom[match.start():])
        except Exception:
            continue
        first = vtx['penguin_eyes_model']
        packed = b''.join(struct.pack('>3hH2h4B', x, y, z, f, s, t, nx & 255, ny & 255, nz & 255, a) for x, y, z, f, s, t, nx, ny, nz, a in first)
        if data.find(packed) >= 0:
            segment, at = data, match.start()
            break
    if segment is None:
        raise ValueError('Penguin vertices do not match the ROM')
    for name, rows in vtx.items():
        packed = b''.join(struct.pack('>3hH2h4B', x, y, z, f, s, t, nx & 255, ny & 255, nz & 255, a) for x, y, z, f, s, t, nx, ny, nz, a in rows)
        if segment.find(packed) < 0:
            raise ValueError(f'{name} does not match the ROM')

    # display lists -> meshes grouped by (light, texture, combine)
    def walk(name, state, meshes, cache):
        body = text.split('Gfx wut = ')[1].split(';')[0] + ',' + block(text, 'Gfx', 'dl_8810') if name == 'wut' else block(text, 'Gfx', name)
        for command, a in re.findall(r'(gs\w+)\((.*?)\)(?=\s*,|\s*$)', body, re.S):
            a = [v.strip() for v in a.split(',')]
            if command == 'gsSPLight' and a[0].endswith('.l'):
                state['light'] = a[0].split(PREFIX)[1].split('.')[0]
            elif command == 'gsSPDisplayList':
                walk(a[0].replace(PREFIX, ''), state, meshes, cache)
            elif command == 'gsDPSetTextureImage':
                state['texture'] = TEXTURES[a[3].replace(PREFIX, '')][0]
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
                key = (state['light'], state['texture'], state['combine'] if state['texture'] else None)
                mesh = next((m for m in meshes if m['key'] == key), None)
                if mesh is None:
                    mesh = dict(key=key, positions=[], normals=[], uvs=[])
                    meshes.append(mesh)
                for j in range(0, len(a), 4):
                    for v in a[j:j + 3]:
                        x, y, z, _f, s, t, nx, ny, nz, _a = cache[int(v, 0)]
                        mesh['positions'] += [x, y, z]
                        mesh['normals'] += [round(n / 127, 4) for n in (nx, ny, nz)]
                        mesh['uvs'] += [s / 32 / 32, t / 32 / 32]   # s10.5 texels over the 32-texel tile

    def model(name):
        meshes = []
        walk(name, dict(light=None, texture=None, combine=None), meshes, {})
        return [dict(light=m['key'][0], texture=m['key'][1], combine=m['key'][2], positions=m['positions'], normals=m['normals'], uvs=m['uvs']) for m in meshes]

    armature = []
    for m in re.finditer(r'ANIMATION_(DISABLE_AUTOMATIC_POP|POP_MATRIX|STOP|RENDER_MODEL|ADD_POS)(?:\((.*?)\))?,', block(text, 'u32', 'unk_data1')):
        kind, a = m.group(1), m.group(2)
        if kind == 'RENDER_MODEL':
            name = a.strip().lstrip('&').replace(PREFIX, '')
            armature.append(dict(op='limb', model=model(name), pos=[0, 0, 0], name=name))
        elif kind == 'ADD_POS':
            armature.append(dict(op='limb', model=None, pos=numbers(a)))
        else:
            armature.append(dict(op={'DISABLE_AUTOMATIC_POP': 'nopop', 'POP_MATRIX': 'pop', 'STOP': 'stop'}[kind]))

    animations = []
    for name in re.findall(rf'&{PREFIX}(unk_data\d+)', re.search(rf'Animation\* {PREFIX}unk_data11\[\] = \{{(.*?)\}};', text, re.S).group(1)):
        head = numbers(re.search(rf'Animation {PREFIX}{name} = \{{(.*?)\}};', text, re.S).group(1).split(PREFIX)[0])
        values_name, limbs_name = re.findall(rf'{PREFIX}(unk_data\d+)', re.search(rf'Animation {PREFIX}{name} = \{{(.*?)\}};', text, re.S).group(1))
        values = [v - 65536 if v > 32767 else v for v in numbers(block(text, 's16', values_name))]
        cycle = numbers(block(text, 'AnimationLimbVector', limbs_name))
        animations.append(dict(length=head[2], values=values, limbs=[[cycle[i:i + 2] for i in range(j, j + 6, 2)] for j in range(0, len(cycle), 6)]))

    args.output.mkdir(parents=True, exist_ok=True)
    for name, (image, offset) in TEXTURES.items():
        raw = karts.asset_bytes(rom, dict(rom_offset='0x86ECF0', block_offset=offset, width=32, height=32, type='rgba16'))
        (args.output / f'penguin-{image}').write_bytes(karts.png(32, 32, b''.join(karts.rgba16(raw))))
    out = dict(romSha1=karts.US_SHA1, source='n64decomp/mk64 courses/sherbet_land/course_data.c d_course_sherbet_land_unk_data1 / unk_data11',
               vertexSegmentRomOffset=at, textures={v[0]: f'penguin-{v[0]}' for v in TEXTURES.values()},
               lights=lights, armature=armature, animations=animations)
    (args.output / 'penguin.json').write_text(json.dumps(out, separators=(',', ':')) + '\n')
    limbs = sum(1 for a in armature if a['op'] == 'limb')
    print(f'{limbs} limbs, {sum(len(m["positions"]) // 9 for a in armature if a.get("model") for m in a["model"])} triangles, '
          f'{len(animations)} animations {[a["length"] for a in animations]}, vertices in MIO0 {at:#x}')


if __name__ == '__main__':
    main()
