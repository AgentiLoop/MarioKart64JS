#!/usr/bin/env python3
"""Extract Yoshi Valley's giant Yoshi egg from a local US ROM (no downloads).

Usage: python3 tools/extract-yoshi-egg.py ROM --source /path/to/n64decomp/mk64
Writes public/mk64/yoshi-valley/yoshi-egg.json plus its two textures (yoshi-egg-*.png).

- spawn_course_actors (src/racing/actors.c): one ACTOR_YOSHI_EGG at (-2300 * gCourseDirection, 0, 634);
  add_actor_to_empty_slot: pathRadius 70, pathCenter = (x, y, z + 70).
- update_actor_yoshi_egg: pathRot += 0x5B a tick, pos = pathCenter + (sins(pathRot), coss(pathRot)) * radius,
  eggRot -= DEGREES(3) a tick.
- render_actor_yoshi_egg: within 4000 (distance_if_visible, 16000000 squared); while the screen's track section
  (pathCounter) is 13-19 it draws d_course_yoshi_valley_dl_16D70 (lit by its gsSPSetLights1, G_CC_MODULATEIA,
  opaque) turned by eggRot about the up axis (mtxf_rotate_zxy_translate), otherwise the flat d_course_yoshi_valley_
  dl_egg_lod0 turned to the camera's yaw (D_801502C0), unlit, G_CC_MODULATEIDECALA + G_RM_AA_ZB_TEX_EDGE.
- The screen's section comes from the collision triangle under the camera (get_track_section_id); the triangles
  of every TrackSections d_course_yoshi_valley_addr list are written with their section id.
Vertex arrays and textures are verified byte-for-byte inside the course data segment; the section lists index the
course vertices extract-course.py verified (course.json, same order as the ROM vertex block).
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

COURSE = 'yoshi_valley'
NEAR, FAR = 'd_course_yoshi_valley_dl_16D70', 'd_course_yoshi_valley_dl_egg_lod0'


def numbers(text):
    return [int(n, 0) for n in re.findall(r'-?0x[0-9a-fA-F]+|-?\d+', text)]


def s8(v):
    return v - 256 if v > 127 else v


def track_sections(data_c, lists, cv, course):
    """TrackSections d_course_<course>_addr: {list, surface, section id, flags}; every triangle of each list as
    [section id, ax, ay, az, bx, by, bz, cx, cy, cz] (vertex slots -> course.json vertex index)."""
    table = re.search(rf'TrackSections d_course_{course}_addr\[\] = \{{(.*?)\}};', data_c, re.S).group(1)
    sections = []
    for name, _, section in re.findall(r'\{\s*(\w+),\s*(\w+),\s*(\w+),', table):
        if name not in lists:   # the { 0x00000000, ... } terminator
            continue
        slots, stack = {}, [name]
        while stack:
            for command, args in re.findall(r'(gs\w+)\((.*?)\)', lists[stack.pop()], re.S):
                a = [v.strip() for v in args.split(',')]
                if command == 'gsSPDisplayList':
                    stack.append(a[0])
                elif command == 'gsSPVertex':
                    address, count, start = [int(v, 0) for v in a]
                    for i in range(count):
                        slots[start + i] = (address & 0xffffff) // 16 + i
                elif command in ('gsSP1Triangle', 'gsSP2Triangles'):
                    for j in range(0, len(a), 4):
                        tri = [cv[slots[int(v, 0)]][:3] for v in a[j:j + 3]]
                        sections.append([int(section, 0)] + [c for p in tri for c in p])
    return sections
def convert(source, rom, course_json):
    data_c = (source / f'courses/{COURSE}/course_data.c').read_text()
    dls_c = (source / f'courses/{COURSE}/course_displaylists.inc.c').read_text()
    meta = json.loads((source / f'assets/courses/{COURSE}.json').read_text())
    block_offset = course_json['provenance']['pathBlockRomOffset']
    segment = karts.mio0(rom[block_offset:])

    def verify(packed, what):
        at = segment.find(packed)
        if at < 0:
            raise ValueError(f'{what} does not match the ROM course data')
        return at

    vtx_arrays = dict(re.findall(r'Vtx (\w+)\[\d*\] = \{(.*?)\n\};', data_c, re.S))
    lists = dict(re.findall(r'Gfx (\w+)\[\] = \{(.*?)\};', dls_c + data_c, re.S))
    images_c = dict(re.findall(r'u8 (\w+)\[\] = \{\s*#include "assets/courses/\w+/(\w+)\.inc\.c"', data_c))
    lights = {n: numbers(a) for n, a in re.findall(r'Lights1 (\w+) = gdSPDefLights1\((.*?)\);', data_c)}
    images, verified = {}, {}

    def vertices(name):
        rows = [numbers(','.join(r)) for r in re.findall(
            r'\{\s*\{\s*\{([^{}]+)\}\s*,\s*(-?\w+)\s*,\s*\{([^{}]+)\}\s*,\s*\{([^{}]+)\}\s*\}\s*\}', vtx_arrays[name])]
        verified[name] = verify(b''.join(struct.pack('>3hH2h4B', *r) for r in rows), name)
        return rows

    def texture(symbol):
        name = images_c[symbol]
        m = meta[name]
        if int(m['rom_offset'], 16) != block_offset or m['type'] != 'rgba16':
            raise ValueError(f'{name} is not an RGBA16 texture in the course data segment')
        w, h, at = m['width'], m['height'], int(m['block_offset'], 16)
        rgba = b''.join(karts.rgba16(segment[at:at + w * h * 2]))
        image = f'yoshi-egg-{name}.png'
        images[image] = karts.png(w, h, rgba)
        return dict(image=image, symbol=name, width=w, height=h, rgbaSha256=hashlib.sha256(rgba).hexdigest())

    def model(dl, expect):
        body = lists[dl]
        for e in expect:
            if e not in body:
                raise ValueError(f'{dl}: expected {e!r}')
        out, cache = dict(triangles=[]), {}
        for command, args in re.findall(r'(gs\w+)\((.*?)\)', body, re.S):
            a = [v.strip() for v in args.split(',')]
            if command == 'gsSPSetLights1':
                ar, ag, ab, cr, cg, cb, lx, ly, lz = lights[a[0]]
                out['light'] = dict(ambient=[ar, ag, ab], color=[cr, cg, cb],
                                    direction=[s8(lx & 0xff), s8(ly & 0xff), s8(lz & 0xff)])
            elif command == 'gsDPSetTextureImage':
                out.update(texture(a[3]))
            elif command == 'gsSPVertex':
                rows = vertices(a[0])
                for i in range(int(a[1], 0)):
                    cache[int(a[2], 0) + i] = rows[i]
            elif command in ('gsSP1Triangle', 'gsSP2Triangles'):
                for j in range(0, len(a), 4):
                    tri = []
                    for v in a[j:j + 3]:
                        x, y, z, _, s, t, r, g, b, alpha = cache[int(v, 0)]
                        # lit: r, g, b carry the normal (signed bytes)
                        tri.append([x, y, z, s, t, s8(r), s8(g), s8(b)] if 'light' in out else
                                   [x, y, z, s, t, r, g, b, alpha])
                    out['triangles'].append(tri)
        return out

    near = model(NEAR, ['gsDPSetCombineMode(G_CC_MODULATEIA', 'gsDPSetRenderMode(G_RM_AA_ZB_OPA_SURF',
                        'G_TX_NOMIRROR | G_TX_WRAP, 5, G_TX_NOLOD,\n                G_TX_NOMIRROR | G_TX_WRAP, 5',
                        'gsDPSetTileSize(G_TX_RENDERTILE, 0, 0, 0x007C, 0x007C)'])
    far = model(FAR, ['gsDPSetCombineMode(G_CC_MODULATEIDECALA', 'gsDPSetRenderMode(G_RM_AA_ZB_TEX_EDGE',
                      'G_TX_NOMIRROR | G_TX_CLAMP, 5, G_TX_NOLOD,\n                G_TX_NOMIRROR | G_TX_CLAMP, 6',
                      'gsDPSetTileSize(G_TX_RENDERTILE, 0, 0, 0x00FC, 0x007C)'])
    if (near['width'], near['height'], far['width'], far['height']) != (32, 32, 64, 32):
        raise ValueError('Unexpected egg texture sizes')

    sections = track_sections(data_c, lists, course_json['vertices'], COURSE)
    out = dict(romSha1=karts.US_SHA1, courseDataRomOffset=block_offset, source='spawn_course_actors (src/racing/actors.c)',
               spawn=[-2300, 0, 634], pathRadius=70, pathCenterOffset=[0, 0, 70], pathRotPerTick=0x5B,
               eggRotPerTick=-546, maxDistance=4000, nearSections=[13, 19],
               near=dict(displayList=NEAR, **near), far=dict(displayList=FAR, **far),
               vertexOffsets=verified, sectionTable=f'd_course_{COURSE}_addr', sections=sections)
    return out, images


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('rom', type=Path)
    parser.add_argument('--source', type=Path, required=True)
    args = parser.parse_args()
    rom = args.rom.read_bytes()
    if hashlib.sha1(rom).hexdigest() != karts.US_SHA1:
        raise SystemExit('Expected the US Mario Kart 64 ROM (SHA1 %s)' % karts.US_SHA1)
    folder = Path('public/mk64/yoshi-valley')
    course_json = json.loads((folder / 'course.json').read_text())
    out, images = convert(args.source, rom, course_json)
    for name, data in images.items():
        (folder / name).write_bytes(data)
    (folder / 'yoshi-egg.json').write_text(json.dumps(out, separators=(',', ':')) + '\n')
    print(f'yoshi egg: {len(out["near"]["triangles"])} + {len(out["far"]["triangles"])} triangles, '
          f'{len(out["sections"])} section triangles, {len(images)} textures')


if __name__ == '__main__':
    main()
