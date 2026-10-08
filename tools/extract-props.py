#!/usr/bin/env python3
"""Extract course prop actors drawn from the course data segment (no downloads): Koopa Troopa Beach palm trees,
the spinning Mario Raceway / Wario Stadium signs and D.K.'s Jungle Parkway trees.

Usage: python3 tools/extract-props.py ROM --source /path/to/n64decomp/mk64 [--course koopa_troopa_beach]
Writes public/mk64/<course>/props.json plus the decoded textures (prop-<symbol>.png).

- spawn_palm_trees (src/racing/actors.c): one ACTOR_PALM_TREE per d_course_koopa_troopa_beach_tree_spawn entry
  (someId = variant 0-2); render_actor_palm_tree draws dl_tree_trunkN then dl_tree_topN (G_CULL_BACK cleared)
  lit (G_LIGHTING, the lists' gsSPSetLights1), unrotated at the spawn position, within distance 2000.
- spawn_course_actors puts ACTOR_MARIO_SIGN x2 / ACTOR_WARIO_SIGN x3 at fixed positions; update_actor_*_sign
  turns each DEGREES(1) a tick; render_actor_*_sign draws dl_sign unlit within 4000 (16000000 squared).
- func_80298D10 / render_palm_trees: D.K.'s Jungle Parkway tree list (UnkActorSpawnData: y = unk8,
  id = someId & 0xF); ids 0/4/5 face the camera (D_801502C0), 6 (palm) is unrotated; drawn within 1000,
  G_CC_MODULATEIDECALA + G_RM_AA_ZB_TEX_EDGE, unlit.
Every vertex array, spawn list and texture is verified byte-for-byte inside the course data segment (the MIO0
block extract-course.py found the track path in). Lit vertices are shaded here (F3DEX: ambient + colour x
max(0, n . l), light in world space since MK64 puts the camera in the projection matrix).
"""
import argparse
import hashlib
import importlib.util
import json
import math
from pathlib import Path
import re
import struct

spec = importlib.util.spec_from_file_location('karts', Path(__file__).with_name('extract-karts.py'))
karts = importlib.util.module_from_spec(spec)
spec.loader.exec_module(karts)

KTB = 'd_course_koopa_troopa_beach_dl_'
DKJ = 'd_course_dks_jungle_parkway_dl_'
# course: (spawn, {model id: ([(display list, cull)], lit)}, drawing {kind, maxDistance}, list initial state)
# spawn = (list name, row format) or [(x, y, z, model id)] fixed positions (spawn_course_actors)
COURSES = {
    'koopa_troopa_beach': (('d_course_koopa_troopa_beach_tree_spawn', 'actor'),
                           {v: ([(f'{KTB}tree_trunk{v + 1}', True), (f'{KTB}tree_top{v + 1}', False)], True)
                            for v in range(3)},
                           dict(kind='static', maxDistance=2000), dict(mode='opaque', combine='G_CC_MODULATEIA')),
    'mario_raceway': ([(150, 40, -1300, 0), (2520, 0, 1240, 0)],
                      {0: ([('d_course_mario_raceway_dl_sign', True)], False)},
                      dict(kind='spin', maxDistance=4000, spinPerTick=1 / 360), dict(mode='opaque', combine=None)),
    'wario_stadium': ([(-131, 83, 286, 0), (-2353, 72, -1608, 0), (-2622, 79, 739, 0)],
                      {0: ([('d_course_wario_stadium_dl_sign', True)], False)},
                      dict(kind='spin', maxDistance=4000, spinPerTick=1 / 360), dict(mode='opaque', combine=None)),
    'dks_jungle_parkway': (('d_course_dks_jungle_parkway_tree_spawn', 'unk'),
                           {0: ([(f'{DKJ}tree1', True)], False), 4: ([(f'{DKJ}tree2', True)], False),
                            5: ([(f'{DKJ}tree3', True)], False), 6: ([(f'{DKJ}palm_tree', True)], False)},
                           dict(kind='billboard', maxDistance=1000, static=[6]),
                           dict(mode='edge', combine='G_CC_MODULATEIDECALA')),
}


def numbers(text):
    return [int(n, 0) for n in re.findall(r'-?0x[0-9a-fA-F]+|-?\d+', text)]


def s8(v):
    return v - 256 if v > 127 else v


def convert(source, rom, course_id, course_json, config=None):
    """config: (spawn, kinds, drawing, initial) like COURSES (spawn None = models only); returns (out, images)."""
    spawn, kinds, drawing, initial = config or COURSES[course_id]
    data_c = (source / f'courses/{course_id}/course_data.c').read_text()
    tex_meta = json.loads((source / f'assets/courses/{course_id}.json').read_text())
    block_offset = course_json['provenance']['pathBlockRomOffset']
    segment = karts.mio0(rom[block_offset:])

    def verify(packed, what):
        at = segment.find(packed)
        if at < 0:
            raise ValueError(f'{what} does not match the ROM course data')
        return at

    vtx_arrays = dict(re.findall(r'Vtx (\w+)\[\d*\] = \{(.*?)\n\};', data_c, re.S))
    lists = dict(re.findall(r'Gfx (\w+)\[\] = \{(.*?)\};', data_c, re.S))
    images_c = dict(re.findall(r'u8 (\w+)\[\] = \{\s*#include "assets/courses/\w+/(\w+)\.inc\.c"', data_c))
    lights = {n: numbers(a) for n, a in re.findall(r'Lights1 (\w+) = gdSPDefLights1\((.*?)\);', data_c)}

    def vertices(name):
        rows = [numbers(r) for r in re.findall(r'\{\s*\{\s*\{([^{}]+)\}\s*,\s*(-?\w+)\s*,\s*\{([^{}]+)\}\s*,\s*\{([^{}]+)\}\s*\}\s*\}',
                                                 vtx_arrays[name]) for r in [','.join(r)]]
        verify(b''.join(struct.pack('>3hH2h4B', *r) for r in rows), name)
        return rows

    images = {}

    def texture(symbol):
        name = images_c[symbol]
        meta = tex_meta[name]
        if int(meta['rom_offset'], 16) != block_offset or meta['type'] != 'rgba16':
            raise ValueError(f'{name} is not an RGBA16 texture in the course data segment')
        w, h, at = meta['width'], meta['height'], int(meta['block_offset'], 16)
        rgba = b''.join(karts.rgba16(segment[at:at + w * h * 2]))
        image = f'prop-{name}.png'
        images[image] = karts.png(w, h, rgba)
        return image, w, h, hashlib.sha256(rgba).hexdigest()

    def wrap(value):
        return 'clamp' if 'G_TX_CLAMP' in value else 'mirror' if 'G_TX_MIRROR' in value else 'repeat'

    def walk(name, state, parts, cache):
        for command, args in re.findall(r'(gs\w+)\((.*?)\)', lists[name], re.S):
            a = [v.strip() for v in args.split(',')]
            if command == 'gsSPDisplayList':
                walk(a[0], state, parts, cache)
            elif command == 'gsSPTexture':
                state['enabled'] = a[-1] == 'G_ON'
            elif command == 'gsDPSetCombineMode':
                state['combine'] = a[0]
            elif command == 'gsDPSetRenderMode':
                state['mode'] = ('edge' if 'TEX_EDGE' in a[0] else 'decal' if 'XLU_DECAL' in a[0]
                                 else 'xlu' if 'XLU' in a[0] else 'opaque')
            elif command in ('gsSPSetGeometryMode', 'gsSPClearGeometryMode'):
                if 'G_CULL_BACK' in args:
                    state['cull'] = command == 'gsSPSetGeometryMode'
                if 'G_LIGHTING' in args:
                    state['lit'] = command == 'gsSPSetGeometryMode'
            elif command == 'gsSPSetLights1':
                state['light'] = a[0]
            elif command == 'gsDPSetTile' and a[4] == 'G_TX_RENDERTILE':
                state.update(wrapS=wrap(a[9]), wrapT=wrap(a[6]))
            elif command == 'gsDPSetTileSize':
                state.update(tileW=(int(a[3], 0) >> 2) + 1, tileH=(int(a[4], 0) >> 2) + 1)
            elif command == 'gsDPSetTextureImage':
                if (a[0], a[1]) != ('G_IM_FMT_RGBA', 'G_IM_SIZ_16b'):
                    raise ValueError(f'{name}: unsupported texture format {a[0]} {a[1]}')
                state['texture'] = a[3]
            elif command == 'gsSPVertex':
                rows, count, start = vertices(a[0]), int(a[1], 0), int(a[2], 0)
                if count > len(rows):
                    raise ValueError(f'{name}: {a[0]} has fewer than {count} vertices')
                for i in range(count):
                    cache[start + i] = rows[i]
            elif command in ('gsSP1Triangle', 'gsSP2Triangles'):
                if state['mode'] == 'decal':   # XLU_DECAL re-draw of the same triangles: only blends their AA edges
                    continue
                textured = state['enabled'] and state['combine'] != 'G_CC_SHADE'
                key = (state['texture'] if textured else None, state['tileW'], state['tileH'], state['wrapS'],
                       state['wrapT'], state['mode'], state['cull'], state['lit'] and state['light'])
                if not parts or parts[-1]['key'] != key:
                    part = dict(key=key, triangles=[], alphaTest=state['mode'] == 'edge', doubleSided=not state['cull'])
                    if key[0]:
                        image, w, h, digest = texture(key[0])
                        if (w, h) != key[1:3]:
                            raise ValueError(f'{name}: tile {key[1:3]} differs from {key[0]} {w}x{h}')
                        part.update(image=image, width=w, height=h, wrapS=key[3], wrapT=key[4], rgbaSha256=digest)
                    parts.append(part)
                for j in range(0, len(a), 4):
                    parts[-1]['triangles'].append([shade(cache[int(v, 0)], key[7]) for v in a[j:j + 3]])
            elif command == 'gsDPSetTextureLUT' and a[0] != 'G_TT_NONE':
                raise ValueError(f'{name}: unsupported {command}({a[0]})')
            elif command not in ('gsDPPipeSync', 'gsDPTileSync', 'gsDPLoadSync', 'gsDPLoadBlock', 'gsDPSetTile',
                                 'gsDPSetTextureLUT', 'gsSPEndDisplayList'):
                raise ValueError(f'{name}: unsupported display-list command {command}')

    def shade(v, light):
        """[x, y, z, s, t, r, g, b, a]; lit vertices carry a normal instead of a colour."""
        x, y, z, _, s, t, r, g, b, alpha = v
        if light:
            ar, ag, ab, cr, cg, cb, lx, ly, lz = lights[light]
            n, l = [s8(r), s8(g), s8(b)], [s8(lx & 0xff), s8(ly & 0xff), s8(lz & 0xff)]
            nl, ll = math.sqrt(sum(c * c for c in n)) or 1, math.sqrt(sum(c * c for c in l)) or 1
            d = max(0.0, sum(p * q for p, q in zip(n, l)) / nl / ll)
            r, g, b = (min(255, round(amb + col * d)) for amb, col in ((ar, cr), (ag, cg), (ab, cb)))
        return [x, y, z, s, t, r, g, b, alpha]

    models = {}
    for some_id, (dls, lit) in kinds.items():
        parts, cache = [], {}
        state = dict(enabled=True, texture=None, tileW=32, tileH=32, wrapS='repeat', wrapT='repeat', light=None,
                     lit=lit, **initial)
        for dl, cull in dls:
            state['cull'] = cull
            walk(dl, state, parts, cache)
        for p in parts:
            del p['key']
        models[str(some_id)] = dict(lists=[dl for dl, _ in dls], parts=parts)
    out = dict(romSha1=karts.US_SHA1, courseDataRomOffset=block_offset, **drawing, models=models)
    if spawn is None:
        out['actors'] = []
        return out, images
    if isinstance(spawn, list):
        out['source'] = 'spawn_course_actors (src/racing/actors.c)'
        rows = spawn
    else:
        spawn_name, kind = spawn
        body = re.search(rf'{spawn_name}\[\] = \{{(.*?)\}};', data_c, re.S).group(1)
        if kind == 'actor':   # ActorSpawnData {pos, someId}
            rows = [numbers(p + ',' + i) for p, i in re.findall(r'\{\s*\{([^{}]+)\}\s*,\s*\{([^{}]+)\}\s*\}', body)]
            packed = b''.join(struct.pack('>3hH', x, y, z, i & 0xffff) for x, y, z, i in rows)
        else:   # UnkActorSpawnData {pos, someId, unk8}
            rows = [numbers(p + ',' + i) for p, i in re.findall(r'\{\s*\{([^{}]+)\}\s*,([^{}]+?)\}', body)]
            packed = b''.join(struct.pack('>3h2h', *r) for r in rows)
            rows = [(x, unk8, z, i & 0xf) for x, _, z, i, unk8 in rows]   # func_80298D10
        if rows[-1][0] != -32768:
            raise ValueError('Spawn list is not terminated')
        out.update(spawnList=spawn_name, spawnListOffset=verify(packed, spawn_name))
        rows = rows[:-1]
    out['actors'] = [dict(model=str(i), pos=[x, y, z]) for x, y, z, i in rows]
    missing = {a['model'] for a in out['actors']} - set(models)
    if missing:
        raise ValueError(f'No model for ids {missing}')
    return out, images


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('rom', type=Path)
    parser.add_argument('--source', type=Path, required=True)
    parser.add_argument('--course', choices=sorted(COURSES), action='append')
    args = parser.parse_args()
    rom = args.rom.read_bytes()
    if hashlib.sha1(rom).hexdigest() != karts.US_SHA1:
        raise SystemExit('Expected the US Mario Kart 64 ROM (SHA1 %s)' % karts.US_SHA1)
    for course_id in args.course or sorted(COURSES):
        folder = Path('public/mk64') / course_id.replace('_', '-')
        course_json = json.loads((folder / 'course.json').read_text())
        out, images = convert(args.source, rom, course_id, course_json)
        for name, data in images.items():
            (folder / name).write_bytes(data)
        (folder / 'props.json').write_text(json.dumps(out, separators=(',', ':')) + '\n')
        tris = sum(len(p['triangles']) for m in out['models'].values() for p in m['parts'])
        print(f'{course_id:20} {len(out["actors"]):3} actors, {len(out["models"])} models, {tris} triangles, {len(images)} textures')


if __name__ == '__main__':
    main()
