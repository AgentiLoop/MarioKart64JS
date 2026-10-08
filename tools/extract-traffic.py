#!/usr/bin/env python3
"""Extract Toad's Turnpike's traffic models from the course data segment (no downloads).

Usage: python3 tools/extract-traffic.py ROM --source /path/to/n64decomp/mk64
Writes public/mk64/toads-turnpike/traffic.json plus the decoded textures (prop-<symbol>.png).

- render_actor_box_truck draws dl_23858 / dl_238A0 / dl_238E8 (actor state 0-2: which box texture sits in TMEM)
  then toads_turnpike_dl_0 / _1 / _2 (near / middle / far); render_actor_school_bus toads_turnpike_dl_3-5,
  render_actor_tanker_truck dl_6-8, render_actor_car dl_9-11 (scaled 0.1). All unlit (G_LIGHTING cleared).
  The toads_turnpike_dl_N lists (courses/toads_turnpike/course_offsets.c) call common_data render-mode lists,
  checked word for word against the ROM's common_data segment (MIO0 at 0x132B50):
    0x0D005398 G_CC_MODULATEIA, G_RM_AA_ZB_OPA_SURF          (near / middle body)
    0x0D0053B0 G_CC_MODULATEIDECALA, G_RM_AA_ZB_TEX_EDGE     (near / middle cut-out parts)
    0x0D0053C8 / 0x0D0053F0 2-cycle G_FOG, G_CC_MODULATEI + pass, G_RM_FOG_SHADE_A / G_RM_AA_ZB_OPA_SURF2 (far)
    0x0D005418 back to 1-cycle, G_FOG cleared.
  The port draws the far level without the N64 fog (props.js materials have fog off).
- The traffic route is the course's track path 0 (course.json "path", d_course_toads_turnpike_track_path); its
  left / right edges come from cpu_maximum_separation (yamls/courses/toads_turnpike_metadata.yml: 50.0).
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

COURSE = 'toads_turnpike'
COMMON_DATA_ROM = 0x132B50
# common_data display lists: (segment offset, raw F3DEX words, the same as walker text)
COMMON = {
    'D_toads_turnpike_0D005398': (0x5398, 'fc121824ff33ffff b900031d00552078 b800000000000000',
                                  'gsDPSetCombineMode(G_CC_MODULATEIA, G_CC_MODULATEIA), '
                                  'gsDPSetRenderMode(G_RM_AA_ZB_OPA_SURF, G_RM_AA_ZB_OPA_SURF2), gsSPEndDisplayList()'),
    'D_toads_turnpike_0D0053B0': (0x53B0, 'fc127e24fffff3f9 b900031d00553078 b800000000000000',
                                  'gsDPSetCombineMode(G_CC_MODULATEIDECALA, G_CC_MODULATEIDECALA), '
                                  'gsDPSetRenderMode(G_RM_AA_ZB_TEX_EDGE, G_RM_AA_ZB_TEX_EDGE2), gsSPEndDisplayList()'),
    'D_toads_turnpike_0D0053C8': (0x53C8, 'ba00140200100000 b700000000010200 fc127ffffffff838 b900031dc8112078 '
                                  'b800000000000000',
                                  'gsDPSetCombineMode(G_CC_MODULATEI, G_CC_PASS2), '
                                  'gsDPSetRenderMode(G_RM_FOG_SHADE_A, G_RM_AA_ZB_OPA_SURF2), gsSPEndDisplayList()'),
    'D_toads_turnpike_0D0053F0': (0x53F0, 'ba00140200100000 b700000000010200 fc127ffffffff838 b900031dc8112078 '
                                  'b800000000000000',
                                  'gsDPSetCombineMode(G_CC_MODULATEI, G_CC_PASS2), '
                                  'gsDPSetRenderMode(G_RM_FOG_SHADE_A, G_RM_AA_ZB_OPA_SURF2), gsSPEndDisplayList()'),
    'D_toads_turnpike_0D005418': (0x5418, 'ba00140200000000 b600000000010000 b800000000000000', 'gsSPEndDisplayList()'),
}
D = 'd_course_toads_turnpike_dl_'
T = 'toads_turnpike_dl_'
BOXES = [f'{D}23858', f'{D}238A0', f'{D}238E8']
KINDS = {}
for lod in range(3):
    for state, box in enumerate(BOXES):
        KINDS[f'truck{state}_{lod}'] = ([(box, True), (f'{T}{lod}', True)], False)
    KINDS[f'bus{lod}'] = ([(f'{T}{3 + lod}', True)], False)
    KINDS[f'tanker{lod}'] = ([(f'{T}{6 + lod}', True)], False)
    KINDS[f'car{lod}'] = ([(f'{T}{9 + lod}', True)], False)
MAX_SEPARATION = 50.0


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('rom', type=Path)
    parser.add_argument('--source', type=Path, required=True)
    args = parser.parse_args()
    rom = args.rom.read_bytes()
    if hashlib.sha1(rom).hexdigest() != karts.US_SHA1:
        raise SystemExit('Expected the US Mario Kart 64 ROM (SHA1 %s)' % karts.US_SHA1)
    common = karts.mio0(rom[COMMON_DATA_ROM:])
    extra = {}
    for name, (offset, words, text) in COMMON.items():
        raw = bytes.fromhex(words.replace(' ', ''))
        if common[offset:offset + len(raw)] != raw:
            raise ValueError(f'{name} does not match the ROM common data')
        extra[name] = text
    offsets_c = (args.source / f'courses/{COURSE}/course_offsets.c').read_text()
    extra.update(re.findall(r'const Gfx (\w+)\[\] = \{(.*?)\};', offsets_c, re.S))
    meta = (args.source / f'yamls/courses/{COURSE}_metadata.yml').read_text()
    if float(re.search(r'cpu_maximum_separation: ([\d.]+)f', meta).group(1)) != MAX_SEPARATION:
        raise ValueError('cpu_maximum_separation differs from the decomp metadata')

    folder = Path('public/mk64') / COURSE.replace('_', '-')
    course_json = json.loads((folder / 'course.json').read_text())
    out, images = props.convert(args.source, rom, COURSE, course_json,
                                (None, KINDS, {}, dict(mode='opaque', combine=None)), extra)
    del out['actors']
    out.update(maxSeparation=MAX_SEPARATION, pathPoints=len(course_json['path']))
    for name, data in images.items():
        (folder / name).write_bytes(data)
    (folder / 'traffic.json').write_text(json.dumps(out, separators=(',', ':')) + '\n')
    tris = {k: sum(len(p['triangles']) for p in m['parts']) for k, m in out['models'].items()}
    print(f'triangles {tris}; {len(images)} textures')


if __name__ == '__main__':
    main()
