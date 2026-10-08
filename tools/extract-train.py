#!/usr/bin/env python3
"""Extract Kalimari Desert's train and railroad crossings from the course data segment (no downloads).

Usage: python3 tools/extract-train.py ROM --source /path/to/n64decomp/mk64
Writes public/mk64/kalimari-desert/train.json plus the decoded textures (prop-<symbol>.png).

- Models (tools/extract-props.py walker, every vertex array and texture verified byte-for-byte):
  render_actor_train_engine: dl_1C0F0 + dl_1B978 (near) / dl_1D670 + dl_1D160 / dl_1E910 + dl_1E480 (far);
  render_actor_train_tender: dl_1F228 / dl_1F708 / dl_1FAF8; render_actor_train_passenger_car: dl_20A20 + dl_20A08 /
  dl_21550 + dl_21220 / dl_21C90 + dl_21A80; the wheels dl_22D28 (bogie texture) + dl_22DB8 (small) / dl_22D70 (big),
  G_CULL_BACK cleared; render_actor_railroad_crossing: dl_crossing_both_inactive / _right_active / _left_active,
  G_CULL_BACK cleared. All drawn unlit (G_LIGHTING cleared).
- d_course_kalimari_desert_train_path (TrackPathPoint, verified) and its generate_2d_path result (gVehicle2DPathPoint,
  computed here with the console's single-precision float steps).
"""
import argparse
import hashlib
import importlib.util
import json
from pathlib import Path
import re
import struct

spec = importlib.util.spec_from_file_location('props', Path(__file__).with_name('extract-props.py'))
props = importlib.util.module_from_spec(spec)
spec.loader.exec_module(props)
karts = props.karts

COURSE = 'kalimari_desert'
D = 'd_course_kalimari_desert_dl_'
KINDS = {
    'engine0': ([(f'{D}1C0F0', True), (f'{D}1B978', True)], False),
    'engine1': ([(f'{D}1D670', True), (f'{D}1D160', True)], False),
    'engine2': ([(f'{D}1E910', True), (f'{D}1E480', True)], False),
    'tender0': ([(f'{D}1F228', True)], False),
    'tender1': ([(f'{D}1F708', True)], False),
    'tender2': ([(f'{D}1FAF8', True)], False),
    'car0': ([(f'{D}20A20', True), (f'{D}20A08', True)], False),
    'car1': ([(f'{D}21550', True), (f'{D}21220', True)], False),
    'car2': ([(f'{D}21C90', True), (f'{D}21A80', True)], False),
    'wheelSmall': ([(f'{D}22D28', False), (f'{D}22DB8', False)], False),
    'wheelBig': ([(f'{D}22D28', False), (f'{D}22D70', False)], False),
    'crossingInactive': ([(f'{D}crossing_both_inactive', False)], False),
    'crossingRight': ([(f'{D}crossing_right_active', False)], False),
    'crossingLeft': ([(f'{D}crossing_left_active', False)], False),
}
# spawn_course_actors: ACTOR_RAILROAD_CROSSING (x, y, z, rot y in degrees, crossingId)
CROSSINGS = [(-1680, 2, 35, 0, 1), (-1600, 2, 35, 0, 1), (-2459, 2, 2263, -45, 0), (-2467, 2, 2375, -45, 0)]


def f32(v):
    return struct.unpack('f', struct.pack('f', v))[0]


def generate_2d_path(src, n):
    """generate_2d_path (path_calc.inc.c): quadratic B-spline through the x/z points, one point every 20 units."""
    out = []
    spA8, spA0, travelled = f32(src[0][0]), f32(src[0][2]), f32(0.0)
    for i in range(n):
        (x1, _, z1), (x2, _, z2), (x3, _, z3) = (src[(i + k) % n][:3] for k in range(3))
        d1 = f32(f32((x2 - x1) * (x2 - x1)) + f32((z2 - z1) * (z2 - z1))) ** 0.5
        d2 = f32(f32((x3 - x2) * (x3 - x2)) + f32((z3 - z2) * (z3 - z2))) ** 0.5
        step = f32(0.05 / (f32(d1) + f32(d2)))
        j = f32(0.0)
        while j <= 1.0:
            a = f32((1.0 - j) * 0.5 * (1.0 - j))
            b = f32((1.0 - j) * j + 0.5)
            c = f32(j * 0.5 * j)
            x = f32(f32(f32(a * x1) + f32(b * x2)) + f32(c * x3))
            z = f32(f32(f32(a * z1) + f32(b * z2)) + f32(c * z3))
            travelled = f32(travelled + f32(f32(f32((x - spA8) * (x - spA8)) + f32((z - spA0) * (z - spA0))) ** 0.5))
            spA8, spA0 = x, z
            if travelled > 20.0 or (i == 0 and j == 0.0):
                out.append([int(spA8), int(spA0)])   # (s16) truncates toward zero
                travelled = f32(0.0)
            j = f32(j + step)
    return out


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
    out, images = props.convert(args.source, rom, COURSE, course_json, (None, KINDS, {}, dict(mode='opaque', combine=None)))
    del out['actors']

    data_c = (args.source / f'courses/{COURSE}/course_data.c').read_text()
    body = re.search(r'd_course_kalimari_desert_train_path\[\] = \{(.*?)\};', data_c, re.S).group(1)
    points = [props.numbers(p) for p in re.findall(r'\{([^{}]+)\}', body)]
    segment = karts.mio0(rom[course_json['provenance']['pathBlockRomOffset']:])
    packed = b''.join(struct.pack('>3hH', x, y, z, s & 0xffff) for x, y, z, s in points)
    at = segment.find(packed)
    if at < 0:
        raise ValueError('train path does not match the ROM course data')
    count = next(i for i, p in enumerate(points) if p[0] == -32768)
    path = generate_2d_path(points, count - 1)   # generate_train_path: GET_PATH_LENGTH(...) then i - 1
    out.update(trainPath=points[:count], trainPathOffset=at, path2D=path,
               crossings=[dict(pos=[x, y, z], rotY=r, id=i) for x, y, z, r, i in CROSSINGS])
    for name, data in images.items():
        (folder / name).write_bytes(data)
    (folder / 'train.json').write_text(json.dumps(out, separators=(',', ':')) + '\n')
    tris = {k: sum(len(p['triangles']) for p in m['parts']) for k, m in out['models'].items()}
    print(f'{len(points[:count])} path points -> {len(path)} 2D points; triangles {tris}; {len(images)} textures')


if __name__ == '__main__':
    main()
