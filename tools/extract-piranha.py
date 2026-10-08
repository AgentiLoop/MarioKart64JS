#!/usr/bin/env python3
"""Extract the Mario Raceway / Royal Raceway piranha plants from a local US ROM (no downloads).

Usage: python3 tools/extract-piranha.py ROM --source /path/to/n64decomp/mk64 [--course mario_raceway]
Writes public/mk64/<course>/piranha.json plus the 9 decoded frames (piranha-<n>.png).

- spawn_piranha_plants (src/racing/actors.c): one ACTOR_PIRANHA_PLANT per d_course_<course>_piranha_plant_spawn(s)
  entry, x * gCourseDirection, not lifted onto the ground.
- init_actors_and_load_textures: gTexturePiranhaPlant1-9 (MIO0, CI8 32x64) are loaded 0x800 apart from D_802BA058.
- render_actor_piranha_plant (src/actors/piranha_plant/render.inc.c): D_801502C0 (turned to the camera's yaw),
  drawn within 1000 (distance_if_visible, 1000000 squared); frame = min(8, timer / 6) where the camera's timer
  only runs within 300 (90000 squared), else frame 0. It loads the frame with gDPLoadTextureBlock and draws
  d_course_<course>_dl_piranha_plant: the list's tile mirrors S at 32 texels (G_TX_MIRROR | G_TX_WRAP, mask 5)
  and clamps T, so the 64-texel-wide quad shows the 32-texel frame and its mirror image; G_CC_MODULATEIDECALA,
  G_RM_AA_ZB_TEX_EDGE, unlit; CI8 through the list's own TLUT (gsDPLoadTLUT_pal256).
- update_actor_piranha_plant: per camera, timer + 1 a tick while state 1 (within 300), > 60 -> 6; otherwise 0.
The vertex array, TLUT and spawn list are verified byte-for-byte inside the course data segment.
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

COURSES = {
    'mario_raceway': 'd_course_mario_raceway_piranha_plant_spawns',
    'royal_raceway': 'd_course_royal_raceway_piranha_plant_spawn',
}
FRAMES = [f'gTexturePiranhaPlant{i}' for i in range(1, 10)]


def numbers(text):
    return [int(n, 0) for n in re.findall(r'-?0x[0-9a-fA-F]+|-?\d+', text)]


def convert(source, rom, course_id, course_json):
    spawn_name = COURSES[course_id]
    data_c = (source / f'courses/{course_id}/course_data.c').read_text()
    # the frames are only listed in mario_raceway.json; Royal Raceway loads the same ROM symbols
    meta = json.loads((source / 'assets/courses/mario_raceway.json').read_text())
    meta.update(json.loads((source / f'assets/courses/{course_id}.json').read_text()))
    block_offset = course_json['provenance']['pathBlockRomOffset']
    segment = karts.mio0(rom[block_offset:])

    def verify(packed, what):
        at = segment.find(packed)
        if at < 0:
            raise ValueError(f'{what} does not match the ROM course data')
        return at

    dl_name = f'd_course_{course_id}_dl_piranha_plant'
    dl = re.search(rf'Gfx {dl_name}\[\] = \{{(.*?)\}};', data_c, re.S).group(1)
    expect = ['gsDPSetCombineMode(G_CC_MODULATEIDECALA', 'gsDPSetRenderMode(G_RM_AA_ZB_TEX_EDGE',
              'G_TX_NOMIRROR | G_TX_CLAMP, 6, G_TX_NOLOD,\n                G_TX_MIRROR | G_TX_WRAP, 5',
              'gsDPSetTileSize(G_TX_RENDERTILE, 0, 0, 0x007C, 0x00FC)', 'gsSP2Triangles(0, 1, 2, 0, 0, 2, 3, 0)']
    for e in expect:
        if e not in dl:
            raise ValueError(f'{dl_name}: expected {e!r}')
    tlut_name = re.search(r'gsDPLoadTLUT_pal256\((\w+)\)', dl).group(1)
    tlut_asset = re.search(rf'u8 {tlut_name}\[\] = \{{\s*#include "assets/courses/\w+/(\w+)\.inc\.c"', data_c).group(1)
    tm = meta[tlut_asset]
    if int(tm['rom_offset'], 16) != block_offset:
        raise ValueError(f'{tlut_asset} is not in the course data segment')
    tlut_at = int(tm['block_offset'], 16)
    palette = karts.rgba16(segment[tlut_at:tlut_at + 0x200])

    vtx_name = re.search(r'gsSPVertex\((\w+), 4, 0\)', dl).group(1)
    body = re.search(rf'Vtx {vtx_name}\[\d*\] = \{{(.*?)\n\}};', data_c, re.S).group(1)
    rows = [numbers(','.join(r)) for r in re.findall(
        r'\{\s*\{\s*\{([^{}]+)\}\s*,\s*(-?\w+)\s*,\s*\{([^{}]+)\}\s*,\s*\{([^{}]+)\}\s*\}\s*\}', body)]
    vtx_at = verify(b''.join(struct.pack('>3hH2h4B', *r) for r in rows), vtx_name)
    # [x, y, z, s, t, r, g, b, a]
    vertices = [[x, y, z, s, t, r, g, b, a] for x, y, z, _, s, t, r, g, b, a in rows]
    triangles = [[vertices[0], vertices[1], vertices[2]], [vertices[0], vertices[2], vertices[3]]]

    images, frames = {}, []
    for i, name in enumerate(FRAMES):
        m = meta[name]
        if (m['type'], m['width'], m['height']) != ('ci8', 32, 64):
            raise ValueError(f'{name}: expected a 32x64 CI8 texture')
        raw = karts.mio0(rom[int(m['rom_offset'], 16):])[:32 * 64]
        rgba = b''.join(palette[c] for c in raw)
        image = f'piranha-{i + 1}.png'
        images[image] = karts.png(32, 64, rgba)
        frames.append(dict(image=image, symbol=name, romOffset=m['rom_offset'], rgbaSha256=hashlib.sha256(rgba).hexdigest()))

    spawn = re.search(rf'struct ActorSpawnData {spawn_name}\[\] = \{{(.*?)\}};', data_c, re.S).group(1)
    srows = [numbers(a + ',' + b) for a, b in re.findall(r'\{\s*\{([^{}]+)\}\s*,\s*\{([^{}]+)\}\s*\}', spawn)]
    if srows[-1][0] != -32768:
        raise ValueError('Spawn list is not terminated')
    spawn_at = verify(b''.join(struct.pack('>3hH', x, y, z, i & 0xffff) for x, y, z, i in srows), spawn_name)
    out = dict(romSha1=karts.US_SHA1, courseDataRomOffset=block_offset, displayList=dl_name,
               vertices=vtx_name, verticesOffset=vtx_at, tlut=tlut_asset, tlutOffset=tlut_at,
               spawnList=spawn_name, spawnListOffset=spawn_at,
               maxDistance=1000, animateDistance=300, ticksPerFrame=6, timerWrap=[60, 6],
               width=32, height=64, wrapS='mirror', wrapT='clamp', triangles=triangles, frames=frames,
               actors=[[x, y, z] for x, y, z, _ in srows[:-1]])
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
        (folder / 'piranha.json').write_text(json.dumps(out, separators=(',', ':')) + '\n')
        print(f'{course_id:16} {len(out["actors"]):3} piranha plants, {len(images)} frames')


if __name__ == '__main__':
    main()
