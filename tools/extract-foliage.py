#!/usr/bin/env python3
"""Extract each race course's foliage actors (trees, bushes, cacti) from a local US ROM (no downloads).

Usage: python3 tools/extract-foliage.py ROM --source /path/to/n64decomp/mk64 [--course mario_raceway]
Writes public/mk64/<course>/foliage.json plus the decoded textures (foliage-<symbol>.png).

spawn_foliage (src/racing/actors.c) puts one actor per ActorSpawnData entry of the course's list
(d_course_<course>_tree_spawn(s) / _cactus_spawn); the actor type comes from the course and, on Royal
Raceway and Kalimari Desert, the entry's signedSomeId. render_course_actors draws them with the
camera-facing matrix D_801502C0 (turned about the up axis only) through render_actor_tree_* /
render_actor_bush_bowser_castle / func_80299864 (Luigi Raceway, its list 0x0600FC70), each with its
own culling distance (distance_if_visible, squared x/z distance from the camera).
Textures are loaded into segment 3 by init_actors_and_load_textures (dma_textures, MIO0): 16 shell
frames (0x400 each), 8 finish banner frames + 2 more (0x800 each) fill 0x0000-0x8FFF, so the course's
own textures start at 0x03009000, 0x800 apart in load order. CI8 textures use the TLUT the renderer
loads (common_tlut_trees_import) or the one the list loads itself (gsDPLoadTLUT_pal256).
Every model vertex array and spawn list is verified byte-for-byte inside the course data segment
(the MIO0 block extract-course.py found the track path in).
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

COMMON_DATA = 0x132B50
COMMON_TREE_TLUT = 0x4C68   # common_tlut_trees_import (assets/trees.json)
# course: (spawn list, segment 3 textures from 0x9000 in load order, {signedSomeId or None: (list, max distance)},
#          player counts that skip the spawn)
# max distance = sqrt(maxDistanceSquared) of the render function's distance_if_visible call.
COURSES = {
    'mario_raceway': ('d_course_mario_raceway_tree_spawns', ['gTextureTrees1'],
                      {None: ('d_course_mario_raceway_dl_tree', 4000)}, []),
    'bowsers_castle': ('d_course_bowsers_castle_tree_spawn', ['gTextureShrub'],
                       {None: ('d_course_bowsers_castle_dl_bush', 800)}, []),   # ACTOR_BUSH_BOWSERS_CASTLE
    'yoshi_valley': ('d_course_yoshi_valley_tree_spawn', ['gTextureTrees2'],
                     {None: ('d_course_yoshi_valley_dl_tree', 2000)}, []),
    'frappe_snowland': ('d_course_frappe_snowland_tree_spawns',
                        ['gTextureFrappeSnowlandTreeLeft', 'gTextureFrappeSnowlandTreeRight'],
                        {None: ('d_course_frappe_snowland_dl_tree', 2000)}, []),
    # id 6 -> ACTOR_TREE_BOWSERS_CASTLE, whose renderer draws d_course_royal_raceway_dl_castle_tree; 7 -> royal tree
    'royal_raceway': ('d_course_royal_raceway_tree_spawn', ['gTextureTrees3', 'gTextureTrees7'],
                      {6: ('d_course_royal_raceway_dl_castle_tree', 2000), 7: ('d_course_royal_raceway_dl_tree', 2000)}, []),
    'luigi_raceway': ('d_course_luigi_raceway_tree_spawn', ['gTextureTrees5Left', 'gTextureTrees5Right'],
                      {None: ('d_course_luigi_raceway_dl_FC70', 2000)}, []),
    # spawn_course_actors: no trees when gPlayerCountSelection1 == 4
    'moo_moo_farm': ('d_course_moo_moo_farm_tree_spawn', ['gTextureTrees4Left', 'gTextureTrees4Right'],
                     {None: ('d_course_moo_moo_farm_dl_tree', 2500)}, [4]),
    'kalimari_desert': ('d_course_kalimari_desert_cactus_spawn',
                        ['gTextureCactus1Left', 'gTextureCactus1Right', 'gTextureCactus2Left',
                         'gTextureCactus2Right', 'gTextureCactus3'],
                        {5: ('d_course_kalimari_desert_dl_cactus1', 2000), 6: ('d_course_kalimari_desert_dl_cactus2', 2000),
                         7: ('d_course_kalimari_desert_dl_cactus3', 2000)}, []),
}
# Moo Moo Farm cows (written to cows.json): render_course_actors -> render_cows walks d_course_moo_moo_farm_cow_spawn
# itself (no actors, so no ground snap and no 4P skip), x * gCourseDirection, D_801502C0, someId 0-4 -> dl_cow1-5,
# distance_if_visible 4000000 (2000). The cow textures follow the two tree halves in segment 3 (dma_textures order);
# dl_13B88 loads the 12x17 d_course_moo_moo_farm_cow_tlut with gsDPLoadTLUT_pal256, so its last 52 entries are the
# bytes after it in the segment, as on the console.
MMF_SEG3 = ['gTextureTrees4Left', 'gTextureTrees4Right'] + [f'gTextureCow0{i}{s}' for i in range(1, 6) for s in ('Left', 'Right')]
COWS = {
    'moo_moo_farm': ('d_course_moo_moo_farm_cow_spawn', MMF_SEG3,
                     {i: (f'd_course_moo_moo_farm_dl_cow{i + 1}', 2000) for i in range(5)}, []),
}


def numbers(text):
    return [int(n, 0) for n in re.findall(r'-?0x[0-9a-fA-F]+|-?\d+', text)]


def convert(source, rom, course_id, course_json, table=COURSES):
    spawn_name, seg3, kinds, skip = table[course_id]
    data_c = (source / f'courses/{course_id}/course_data.c').read_text()
    assets = json.loads((source / 'assets.json').read_text())
    tex_meta = json.loads((source / 'assets/trees.json').read_text())
    if (source / f'assets/courses/{course_id}.json').exists():
        tex_meta.update(json.loads((source / f'assets/courses/{course_id}.json').read_text()))
    block_offset = course_json['provenance']['pathBlockRomOffset']
    segment = karts.mio0(rom[block_offset:])
    common = karts.mio0(rom[COMMON_DATA:])

    def verify(packed, what):
        at = segment.find(packed)
        if at < 0:
            raise ValueError(f'{what} does not match the ROM course data')
        return at

    vtx_arrays = dict(re.findall(r'Vtx (\w+)\[\d*\] = \{(.*?)\n\};', data_c, re.S))
    lists = dict(re.findall(r'Gfx (\w+)\[\] = \{(.*?)\};', data_c, re.S))
    tluts = dict(re.findall(r'u8 (\w+)\[\] = \{\s*#include "assets/courses/\w+/(\w+)\.inc\.c"', data_c))

    def vertices(name):
        rows = [numbers(r) for r in re.findall(r'\{\s*\{\s*\{([^{}]+)\}\s*,\s*(-?\w+)\s*,\s*\{([^{}]+)\}\s*,\s*\{([^{}]+)\}\s*\}\s*\}',
                                                 vtx_arrays[name]) for r in [','.join(r)]]
        verify(b''.join(struct.pack('>3hH2h4B', *r) for r in rows), name)
        return rows

    def texture(name, tlut):
        """Decoded RGBA for a segment 3 texture (CI8 through tlut, or RGBA16)."""
        if name in tex_meta:
            meta = tex_meta[name]
            w, h, kind = meta['width'], meta['height'], meta['type']
            raw = karts.mio0(rom[int(meta['rom_offset'], 16):])
        else:   # textures/standalone/<name>.rgba16 in assets.json
            path = {'gTextureShrub': 'textures/standalone/shrub.rgba16.png'}[name]
            (w, h), kind = assets[path]['meta']['dims'], 'rgba16'
            raw = karts.mio0(rom[int(assets[path]['offsets']['us'][0], 16):])
        if kind == 'ci8':
            palette = karts.rgba16(tlut)
            return w, h, b''.join(palette[i] for i in raw[:w * h])
        return w, h, b''.join(karts.rgba16(raw[:w * h * 2]))

    images, models = {}, {}
    for some_id, (dl, max_distance) in kinds.items():
        tlut = common[COMMON_TREE_TLUT:COMMON_TREE_TLUT + 0x200]   # gDPLoadTLUT_pal256(common_tlut_trees_import)
        parts, cache, current, combine = [], {}, None, None
        def commands(name):   # gsSPDisplayList calls inlined
            for command, args in re.findall(r'(gs\w+)\((.*?)\)', lists[name], re.S):
                a = [v.strip() for v in args.split(',')]
                if command == 'gsSPDisplayList':
                    yield from commands(a[0])
                else:
                    yield command, a
        for command, a in commands(dl):
            if command == 'gsDPLoadTLUT_pal256':
                meta = tex_meta[tluts[a[0]]]
                at = int(meta['rom_offset'], 16)
                if at != block_offset:
                    raise ValueError(f'{a[0]} is not in the course data segment')
                tlut = segment[int(meta['block_offset'], 16):int(meta['block_offset'], 16) + 0x200]
            elif command in ('gsDPLoadTextureBlock', 'gsDPSetTextureImage'):
                address = int(a[0] if command == 'gsDPLoadTextureBlock' else a[3], 0)
                index = (address - 0x03009000) // 0x800
                if address >> 24 != 3 or (address - 0x03009000) % 0x800 or not 0 <= index < len(seg3):
                    raise ValueError(f'{dl}: unexpected texture address {address:#x}')
                symbol = seg3[index]
                w, h, rgba = texture(symbol, tlut)
                image = f'foliage-{symbol}.png'
                images[image] = karts.png(w, h, rgba)
                current = dict(image=image, width=w, height=h, rgbaSha256=hashlib.sha256(rgba).hexdigest(), triangles=[])
                parts.append(current)
            elif command == 'gsSPVertex':
                rows, count, start = vertices(a[0]), int(a[1], 0), int(a[2], 0)
                for i in range(count):
                    if i < len(rows):   # Kalimari's cactus 3 loads 8 from a 4-vertex array and uses the first 4
                        cache[start + i] = rows[i]
            elif command in ('gsSP1Triangle', 'gsSP2Triangles'):
                for j in range(0, len(a), 4):
                    current['triangles'].append([cache[int(v, 0)] for v in a[j:j + 3]])
            elif command == 'gsDPSetCombineMode':
                combine = a[0]
        for p in parts:   # [x, y, z, s, t, r, g, b, a] per corner, G_RM_AA_ZB_TEX_EDGE (alpha-tested)
            p['triangles'] = [[[v[0], v[1], v[2], v[4], v[5], *v[6:10]] for v in tri] for tri in p['triangles']]
        models[dl] = dict(maxDistance=max_distance, combine=combine, parts=parts)
    spawn = re.search(rf'struct ActorSpawnData {spawn_name}\[\] = \{{(.*?)\}};', data_c, re.S)
    rows = [numbers(a + ',' + b) for a, b in re.findall(r'\{\s*\{([^{}]+)\}\s*,\s*\{([^{}]+)\}\s*\}', spawn.group(1))]
    if rows[-1][0] != -32768:
        raise ValueError('Spawn list is not terminated')
    spawn_at = verify(b''.join(struct.pack('>3hH', x, y, z, i & 0xffff) for x, y, z, i in rows), spawn_name)
    actors = [dict(model=kinds[i if i in kinds else None][0], pos=[x, y, z]) for x, y, z, i in rows[:-1]]
    out = dict(romSha1=karts.US_SHA1, courseDataRomOffset=block_offset, spawnList=spawn_name, spawnListOffset=spawn_at,
               skipPlayerCounts=skip, onGround=table is COURSES, models=models, actors=actors)
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
        for table, file in ((COURSES, 'foliage.json'), (COWS, 'cows.json')):
            if course_id not in table:
                continue
            out, images = convert(args.source, rom, course_id, course_json, table)
            for name, data in images.items():
                (folder / name).write_bytes(data)
            (folder / file).write_text(json.dumps(out, separators=(',', ':')) + '\n')
            print(f'{course_id:18} {file:12} {len(out["actors"]):3} actors, {len(out["models"])} models, {len(images)} textures')


if __name__ == '__main__':
    main()
