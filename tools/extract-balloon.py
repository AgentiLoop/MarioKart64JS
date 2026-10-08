#!/usr/bin/env python3
"""Extract Luigi Raceway's hot-air balloon from the course data segment (no downloads).

Usage: python3 tools/extract-balloon.py ROM --source /path/to/n64decomp/mk64
Writes public/mk64/luigi-raceway/balloon.json plus the decoded textures (prop-<symbol>.png).

- func_80055CCC (render_object_hot_air_balloon, tools/extract-props.py walker, every vertex array and texture verified
  byte-for-byte): within 1500 of the camera d_course_luigi_raceway_dl_F960 (balloon + basket) then dl_F650 (ropes)
  turned by the object's direction_angle; further out (to 3000) dl_FBE0 (low-detail balloon + basket) then dl_FA20
  (ropes) turned to face the camera. func_80043328 runs common_data D_0D0077D0 first (G_LIGHTING | G_CULL_BACK, checked
  here as raw F3DEX words), and each list sets d_course_luigi_raceway_light1, so the normals are kept and shaded at
  run time as the balloon turns.
- init_hot_air_balloon: origin (-176 x xOrientation, 0, -2323), offset y 300, velocity y -2 (checked in the decomp).
"""
import argparse
import hashlib
import importlib.util
import json
from pathlib import Path


def load(name):
    spec = importlib.util.spec_from_file_location(name.replace('-', '_'), Path(__file__).with_name(f'{name}.py'))
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


props = load('extract-props')
karts = props.karts

COURSE = 'luigi_raceway'
D = f'd_course_{COURSE}_dl_'
KINDS = {
    'near': ([(f'{D}F960', True), (f'{D}F650', True)], True),
    'far': ([(f'{D}FBE0', True), (f'{D}FA20', True)], True),
}
LIGHT = [170, 170, 170, 255, 255, 255, 0, 84, 84]   # d_course_luigi_raceway_light1 (every list sets it first)
COMMON_DATA_ROM = 0x132B50
# D_0D0077D0: gsSPDisplayList(D_0D007780), G_RM_AA_ZB_OPA_SURF, G_CC_SHADE,
# gsSPSetGeometryMode(G_ZBUFFER | G_SHADE | G_CULL_BACK | G_LIGHTING | G_SHADING_SMOOTH), gsSPEndDisplayList
D_0D0077D0 = bytes.fromhex('060000000d007780 b900031d00552078 fcfffffffffe793c b700000000022204 b800000000000000')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('rom', type=Path)
    parser.add_argument('--source', type=Path, required=True)
    args = parser.parse_args()
    rom = args.rom.read_bytes()
    if hashlib.sha1(rom).hexdigest() != karts.US_SHA1:
        raise SystemExit('Expected the US Mario Kart 64 ROM (SHA1 %s)' % karts.US_SHA1)
    if karts.mio0(rom[COMMON_DATA_ROM:])[0x77D0:0x77D0 + len(D_0D0077D0)] != D_0D0077D0:
        raise ValueError('common_data D_0D0077D0 differs from the expected render setup')
    src = (args.source / 'src/update_objects.c').read_text()
    for needle in ('set_obj_origin_pos(objectIndex, xOrientation * -176.0, 0.0f, -2323.0f);',
                   'set_obj_origin_offset(objectIndex, 0.0f, 300.0f, 0.0f);',
                   'gObjectList[objectIndex].velocity[1] = -2.0f;',
                   'gObjectList[objectIndex].direction_angle[1] += 0x100;'):
        if needle not in src:
            raise ValueError(f'update_objects.c no longer has: {needle}')
    folder = Path('public/mk64') / COURSE.replace('_', '-')
    course_json = json.loads((folder / 'course.json').read_text())
    out, images = props.convert(args.source, rom, COURSE, course_json,
                                (None, KINDS, {}, dict(mode='opaque', combine='G_CC_SHADE')), normals=LIGHT)
    del out['actors']
    out.update(origin=[-176, 0, -2323], offsetY=300, velocityY=-2, spinPerFrame=0x100,
               nearDistance=1500, maxDistance=3000)
    for name, data in images.items():
        (folder / name).write_bytes(data)
    (folder / 'balloon.json').write_text(json.dumps(out, separators=(',', ':')) + '\n')
    tris = {k: sum(len(p['triangles']) for p in m['parts']) for k, m in out['models'].items()}
    print(f'triangles {tris}; lights {[l["name"] for l in out["lights"]]}; {len(images)} textures')


if __name__ == '__main__':
    main()
