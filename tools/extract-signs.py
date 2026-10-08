#!/usr/bin/env python3
"""Extract the Mario Raceway and Wario Stadium sign actors (no downloads).

Usage: python3 tools/extract-signs.py ROM --source /path/to/n64decomp/mk64 [--output public/mk64]
ACTOR_MARIO_SIGN (src/actors/mario_sign/render.inc.c) draws d_course_mario_raceway_dl_sign and
ACTOR_WARIO_SIGN (src/actors/wario_sign/render.inc.c) draws d_course_wario_stadium_dl_sign, both through
mtxf_rotate_zxy_translate at the actor position with lighting cleared (vertex colours are colours).
The Mario sign turns +1 degree per update (update_actor_mario_sign), the Wario sign is static.
Display lists, vertices and spawn positions come from the decompilation; every vertex array is
verified against the course data block in the supplied US ROM, the textures are cut from the ROM.
Writes <output>/<course>/signs.json plus the sign PNGs.
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

SIGNS = {
    'mario_raceway': dict(root='d_course_mario_raceway_dl_sign', actor='ACTOR_MARIO_SIGN', spin=True),
    'wario_stadium': dict(root='d_course_wario_stadium_dl_sign', actor='ACTOR_WARIO_SIGN', spin=False),
}


def numbers(text):
    return [int(n, 0) for n in re.findall(r'-?0x[0-9a-fA-F]+|-?\d+', text)]


def convert(source, rom, course_id):
    cfg = SIGNS[course_id]
    data = (source / f'courses/{course_id}/course_data.c').read_text()
    actors_c = (source / 'src/racing/actors.c').read_text()
    lists = dict(re.findall(r'Gfx (\w+)\[\] = \{(.*?)\};', data, re.S))
    vtx = {}
    for name, body in re.findall(r'Vtx (\w+)\[\] = \{(.*?)\n\};', data, re.S):
        vtx[name] = [numbers(row) for row in re.findall(r'\{ \{ \{([^{}]+)\}, ([^{},]+), \{([^{}]+)\}, \{([^{}]+)\} \} \}', body)
                     for row in [','.join(row)]]
    assets = json.loads((source / f'assets/courses/{course_id}.json').read_text())
    symbols = dict(re.findall(r'u8 (\w+)\[\] = \{\s*#include "assets/courses/\w+/(\w+)\.inc\.c"', data))

    state = dict(texture=None, enabled=True, shade=False, width=0, height=0, cache={})
    groups, order, used = {}, [], {}

    def walk(name):
        for command, args in re.findall(r'(gs\w+)\((.*?)\)', lists[name], re.S):
            a = [v.strip() for v in args.split(',')]
            if command == 'gsSPDisplayList':
                walk(a[0])
            elif command == 'gsSPTexture':
                state['enabled'] = a[-1] == 'G_ON'
            elif command == 'gsDPSetCombineMode':
                state['shade'] = a[0] == 'G_CC_SHADE'
            elif command == 'gsDPSetRenderMode':
                if 'XLU' in args or 'TEX_EDGE' in args:
                    raise ValueError('Unsupported sign render mode: ' + args)
            elif command == 'gsDPSetTextureImage':
                if a[:2] != ['G_IM_FMT_RGBA', 'G_IM_SIZ_16b']:
                    raise ValueError('Unsupported sign texture format')
                state['texture'] = symbols[a[3]]
            elif command == 'gsDPSetTileSize':
                state.update(width=(int(a[3], 0) >> 2) + 1, height=(int(a[4], 0) >> 2) + 1)
            elif command == 'gsSPVertex':
                count, start = int(a[1], 0), int(a[2], 0)
                for i in range(count):
                    state['cache'][start + i] = (a[0], i)
            elif command in ('gsSP1Triangle', 'gsSP2Triangles'):
                texture = state['texture'] if state['enabled'] and not state['shade'] else None
                if texture:
                    used[texture] = (state['width'], state['height'])
                if texture not in groups:
                    groups[texture] = dict(texture=texture, vertices=[], triangles=[], index={})
                    order.append(texture)
                g = groups[texture]
                for j in range(0, len(a), 4):
                    tri = []
                    for v in a[j:j + 3]:
                        ref = state['cache'][int(v, 0)]
                        if ref not in g['index']:
                            g['index'][ref] = len(g['vertices'])
                            x, y, z, _, s, t, r, gg, b, _a = vtx[ref[0]][ref[1]]
                            g['vertices'].append([x, y, z, s, t, r, gg, b])
                        tri.append(g['index'][ref])
                    g['triangles'].append(tri)
            elif command not in ('gsDPPipeSync', 'gsDPTileSync', 'gsDPLoadSync', 'gsDPLoadBlock', 'gsDPSetTile',
                                 'gsSPEndDisplayList'):
                raise ValueError(f'Unsupported sign display-list command: {command} in {name}')
    walk(cfg['root'])

    # Spawn positions: spawn_course_actors (position[0] *= gCourseDirection, direction 1 when not mirrored).
    block = actors_c[actors_c.index('void spawn_course_actors'):]
    positions = [[float(v.rstrip('f')) for v in m[:3]] for m in re.findall(
        r'vec3f_set\(position, ([-\d.]+f?), ([-\d.]+f?), ([-\d.]+f?)\);\s*(?:position\[0\] \*= gCourseDirection;\s*)?'
        r'(?:actor = &gActorList\[)?add_actor_to_empty_slot\(position, rotation, velocity, ' + cfg['actor'], block)]

    # Verify the vertex arrays against the ROM: find the MIO0 block of the course data holding them.
    arrays = [n for n in vtx if any(ref[0] == n for g in groups.values() for ref in g['index'])]
    block_offset = None
    first = b''.join(struct.pack('>3hH2h4B', *v[:3], v[3], v[4], v[5], *v[6:10]) for v in vtx[arrays[0]])
    for match in re.finditer(b'MIO0', rom):
        try:
            found = karts.mio0(rom[match.start():]).find(first)
        except Exception:
            continue
        if found >= 0:
            decoded = karts.mio0(rom[match.start():])
            block_offset = match.start()
            for n in arrays:
                if decoded.find(b''.join(struct.pack('>3hH2h4B', *v[:3], v[3], v[4], v[5], *v[6:10]) for v in vtx[n])) < 0:
                    raise ValueError('Sign vertices do not match the ROM: ' + n)
            break
    if block_offset is None:
        raise ValueError('Sign vertices not found in the ROM')

    textures, images = {}, {}
    for symbol, (width, height) in used.items():
        meta = assets[symbol]
        if (meta['width'], meta['height']) != (width, height):
            raise ValueError('Tile dimensions mismatch: ' + symbol)
        raw = karts.asset_bytes(rom, meta)
        rgba = b''.join(karts.rgba16(raw))
        encoded = karts.png(width, height, rgba)
        images[symbol + '.png'] = encoded
        textures[symbol] = dict(image=symbol + '.png', width=width, height=height, romOffset=int(meta['rom_offset'], 16),
                                blockOffset=int(meta['block_offset'], 16), rgbaSha256=hashlib.sha256(rgba).hexdigest())
    model = [dict(texture=t, vertices=groups[t]['vertices'], triangles=groups[t]['triangles']) for t in order]
    out = dict(romSha1=karts.US_SHA1, courseDataRomOffset=block_offset, spin=cfg['spin'], positions=positions,
               model=model, textures=textures, displayListRoot=cfg['root'])
    return out, images


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('rom', type=Path)
    parser.add_argument('--source', type=Path, required=True)
    parser.add_argument('--output', type=Path, default=Path('public/mk64'))
    args = parser.parse_args()
    rom = args.rom.read_bytes()
    if hashlib.sha1(rom).hexdigest() != karts.US_SHA1:
        raise SystemExit('Expected the US Mario Kart 64 ROM (SHA1 %s)' % karts.US_SHA1)
    for course_id in SIGNS:
        out, images = convert(args.source, rom, course_id)
        folder = args.output / course_id.replace('_', '-')
        folder.mkdir(parents=True, exist_ok=True)
        for name, png in images.items():
            (folder / name).write_bytes(png)
        (folder / 'signs.json').write_text(json.dumps(out, separators=(',', ':')) + '\n')
        print(course_id, 'positions', out['positions'], 'groups',
              [(g['texture'], len(g['vertices']), len(g['triangles'])) for g in out['model']])


if __name__ == '__main__':
    main()
