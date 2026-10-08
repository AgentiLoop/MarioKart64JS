#!/usr/bin/env python3
"""Extract D.K.'s Jungle Parkway's paddle-boat ferry from the course data segment (no downloads).

Usage: python3 tools/extract-ferry.py ROM --source /path/to/n64decomp/mk64
Writes public/mk64/dks-jungle-parkway/ferry.json plus the decoded textures (prop-<symbol>.png).

- render_actor_paddle_boat (tools/extract-props.py walker, every vertex array and texture verified byte-for-byte):
  d_course_dks_jungle_parkway_boat_dl + railings_dl, then paddle_wheel_dl (G_CULL_BACK cleared) turned about x by
  wheelRot at (0, 16, -255) in the boat's space; lit (G_LIGHTING) by each list's gsSPSetLights1 after the render
  code's D_800DC610[1], so the normals are kept and shaded at run time as the boat turns.
- d_course_dks_jungle_parkway_ferry_path (TrackPathPoint, verified) and its generate_2d_path result.
- The TrackSections d_course_dks_jungle_parkway_addr triangles with their section ids: the boat is not drawn while
  the screen's pathCounter is 21-24.
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


props, train, egg = load('extract-props'), load('extract-train'), load('extract-yoshi-egg')
karts = props.karts

COURSE = 'dks_jungle_parkway'
D = f'd_course_{COURSE}_'
KINDS = {
    'boat': ([(f'{D}boat_dl', True), (f'{D}railings_dl', True)], True),
    'wheel': ([(f'{D}paddle_wheel_dl', False)], True),
}
LIGHT = [115, 115, 115, 255, 255, 255, 0, 0, 120]   # D_800DC610[1], replaced by each list's own gsSPSetLights1


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('rom', type=Path)
    parser.add_argument('--source', type=Path, required=True)
    args = parser.parse_args()
    rom = args.rom.read_bytes()
    if hashlib.sha1(rom).hexdigest() != karts.US_SHA1:
        raise SystemExit('Expected the US Mario Kart 64 ROM (SHA1 %s)' % karts.US_SHA1)
    folder = Path('public/mk64') / COURSE.replace('_', '-')
    course_json = json.loads((folder / 'course.json').read_text())
    out, images = props.convert(args.source, rom, COURSE, course_json,
                                (None, KINDS, {}, dict(mode='opaque', combine=None)), normals=LIGHT)
    del out['actors']

    data_c = (args.source / f'courses/{COURSE}/course_data.c').read_text()
    light_c = (args.source / 'src/code_800029B0.c').read_text()
    if 'gdSPDefLights1(115, 115, 115, 255, 255, 255, 0, 0, 120)' not in light_c:
        raise ValueError('D_800DC610[1] differs from the expected light')
    body = re.search(rf'{D}ferry_path\[\] = \{{(.*?)\}};', data_c, re.S).group(1)
    points = [props.numbers(p) for p in re.findall(r'\{([^{}]+)\}', body)]
    segment = karts.mio0(rom[course_json['provenance']['pathBlockRomOffset']:])
    packed = b''.join(struct.pack('>3hH', x, y, z, s & 0xffff) for x, y, z, s in points)
    at = segment.find(packed)
    if at < 0:
        raise ValueError('ferry path does not match the ROM course data')
    count = next(i for i, p in enumerate(points) if p[0] == -32768)
    path = train.generate_2d_path(points, count - 1)   # generate_ferry_path: GET_PATH_LENGTH(...) then i - 1

    dls_c = (args.source / f'courses/{COURSE}/course_displaylists.inc.c').read_text()
    lists = dict(re.findall(r'Gfx (\w+)\[\] = \{(.*?)\};', dls_c + data_c, re.S))
    sections = egg.track_sections(data_c, lists, course_json['vertices'], COURSE)

    out.update(ferryPath=points[:count], ferryPathOffset=at, path2D=path, y=-40,
               wheelOffset=[0, 16, -255], hiddenSections=[21, 24], maxDistance=3000,
               sectionTable=f'{D}addr', sections=sections)
    for name, data in images.items():
        (folder / name).write_bytes(data)
    (folder / 'ferry.json').write_text(json.dumps(out, separators=(',', ':')) + '\n')
    tris = {k: sum(len(p['triangles']) for p in m['parts']) for k, m in out['models'].items()}
    lit = [l['name'] for l in out['lights']]
    print(f'{count} path points -> {len(path)} 2D points; triangles {tris}; lights {lit}; '
          f'{len(sections)} section triangles; {len(images)} textures')


if __name__ == '__main__':
    main()
