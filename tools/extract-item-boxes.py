#!/usr/bin/env python3
"""Extract the native MK64 item box model and per-course item box spawns (no downloads).

Usage: python3 tools/extract-item-boxes.py ROM --source /path/to/n64decomp/mk64 [--output public/mk64/item-box]
Model: common_data (segment 0x0D, MIO0 @ ROM 0x132B50, yamls/us/common_data.yml). The three display
lists render_actor_item_box draws in its idle state are decoded as F3DEX GBI straight from the ROM:
  D_0D002EE8 shadow quad, itemBoxQuestionMarkModel (0x3008) "?" card, D_0D003090 the box itself.
Spawns: d_course_<course>_item_box_spawns (ActorSpawnData: Vec3s pos + u16 id) parsed from the
decompilation and verified byte for byte inside a MIO0 course data block of the ROM.
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

COMMON_DATA = 0x132B50
QUESTION_TEXTURE = 0x1EE8          # common_texture_item_box_question_mark, RGBA16 32x64
LISTS = {'shadow': 0x2EE8, 'questionMark': 0x3008, 'box': 0x3090}
COURSES = ['luigi_raceway', 'moo_moo_farm', 'koopa_troopa_beach', 'kalimari_desert', 'toads_turnpike',
           'frappe_snowland', 'choco_mountain', 'mario_raceway', 'wario_stadium', 'sherbet_land',
           'royal_raceway', 'bowsers_castle', 'dks_jungle_parkway', 'yoshi_valley', 'banshee_boardwalk',
           'rainbow_road']
# Known GBI words (F3DEX / gbi.h) for the state each list sets, used as named labels.
COMBINE = {0xFCFFFFFFFFFE793C: 'G_CC_SHADE', 0xFC127E24FFFFF3F9: 'G_CC_MODULATERGBA'}
RENDER_MODE = {0x00504B50: 'G_RM_ZB_XLU_SURF', 0x00553078: 'G_RM_AA_ZB_TEX_EDGE'}


def decode_list(data, offset):
    """Return vertices (x, y, z, s, t, r, g, b, a) and triangles drawn by one F3DEX display list."""
    cache, verts, tris, state = {}, [], [], {}
    while True:
        w0, w1 = struct.unpack_from('>II', data, offset)
        op = w0 >> 24
        offset += 8
        if op == 0x04:                                  # G_VTX: v0*2, n<<10, n*16-1
            n, v0 = (w0 >> 10) & 0x3F, ((w0 >> 16) & 0xFF) // 2
            if w1 >> 24 != 0x0D or (w0 & 0x3FF) != n * 16 - 1:
                raise ValueError('Unexpected G_VTX at 0x%X' % (offset - 8))
            base = w1 & 0xFFFFFF
            for i in range(n):
                x, y, z, _, s, t, r, g, b, a = struct.unpack_from('>4h2h4B', data, base + 16 * i)
                cache[v0 + i] = len(verts)
                verts.append([x, y, z, s, t, r, g, b, a])
        elif op == 0xBF:                                # G_TRI1
            tris.append([cache[(w1 >> s & 0xFF) // 2] for s in (16, 8, 0)])
        elif op == 0xB1:                                # G_TRI2
            tris.append([cache[(w0 >> s & 0xFF) // 2] for s in (16, 8, 0)])
            tris.append([cache[(w1 >> s & 0xFF) // 2] for s in (16, 8, 0)])
        elif op == 0xFC:
            state['combine'] = COMBINE[(w0 << 32) | w1]
        elif op == 0xB9 and (w0 & 0xFFFF) == 0x031D:    # G_SETOTHERMODE_L render mode
            state['renderMode'] = RENDER_MODE[w1]
        elif op == 0xFD:                                # G_SETTIMG
            state['textureImage'] = w1 & 0xFFFFFF
        elif op == 0xF2:                                # G_SETTILESIZE (render tile)
            state['tile'] = [((w1 >> 12) & 0xFFF) // 4 + 1, (w1 & 0xFFF) // 4 + 1]
        elif op == 0xB8:                                # G_ENDDL
            return dict(vertices=verts, triangles=tris, **state)
        elif op not in (0xE7, 0xBB, 0xB6, 0xB7, 0xC0, 0xE8, 0xF5, 0xE6, 0xF3, 0xBA):
            raise ValueError('Unsupported GBI op 0x%02X at 0x%X' % (op, offset - 8))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('rom', type=Path)
    parser.add_argument('--source', type=Path, required=True)
    parser.add_argument('--output', type=Path, default=Path('public/mk64/item-box'))
    args = parser.parse_args()
    rom = args.rom.read_bytes()
    if hashlib.sha1(rom).hexdigest() != karts.US_SHA1:
        raise SystemExit('Expected the US Mario Kart 64 ROM (SHA1 %s)' % karts.US_SHA1)
    common = karts.mio0(rom[COMMON_DATA:])
    model = {name: decode_list(common, off) for name, off in LISTS.items()}
    q = model['questionMark']
    if q['textureImage'] != QUESTION_TEXTURE or q['tile'] != [32, 64]:
        raise SystemExit('Question mark texture reference mismatch')
    rgba = b''.join(karts.rgba16(common[QUESTION_TEXTURE:QUESTION_TEXTURE + 32 * 64 * 2]))
    png = karts.png(32, 64, rgba)

    blocks = []
    for match in re.finditer(b'MIO0', rom):
        try:
            blocks.append((match.start(), karts.mio0(rom[match.start():])))
        except Exception:
            continue
    spawns = {}
    for course in COURSES:
        name = 'courses/%s/course_data.c' % course
        text = (args.source / name).read_text()
        body = re.search(r'ActorSpawnData d_course_%s_item_box_spawns\[\] = \{(.*?)\};' % course, text, re.S).group(1)
        rows = [[int(v) for v in re.findall(r'-?\d+', a + ',' + b)]
                for a, b in re.findall(r'\{\s*\{([^{}]*)\},\s*\{([^{}]*)\}\s*\}', body)]
        if rows[-1][0] != -32768:
            raise SystemExit('%s: missing END_OF_SPAWN_DATA' % course)
        packed = b''.join(struct.pack('>3hH', x, y, z, i & 0xFFFF) for x, y, z, i in rows)
        hit = next(((off, d.find(packed)) for off, d in blocks if d.find(packed) >= 0), None)
        if hit is None:
            raise SystemExit('%s: item box spawns not found in ROM' % course)
        spawns[course] = dict(boxes=[r[:3] for r in rows[:-1]], romBlock=hit[0], blockOffset=hit[1],
                              sha256=hashlib.sha256(packed).hexdigest())
        print('%-20s %3d boxes  MIO0 0x%X +0x%X' % (course, len(rows) - 1, hit[0], hit[1]))

    args.output.mkdir(parents=True, exist_ok=True)
    (args.output / 'question-mark.png').write_bytes(png)
    out = dict(romSha1=karts.US_SHA1, commonDataRomOffset=COMMON_DATA, model=model,
               questionMark=dict(image='question-mark.png', width=32, height=64, romDataOffset=QUESTION_TEXTURE,
                                 rgbaSha256=hashlib.sha256(rgba).hexdigest()),
               spawns=spawns)
    (args.output / 'item-boxes.json').write_text(json.dumps(out, separators=(',', ':')) + '\n')
    print('model: %s' % {k: (len(v['vertices']), len(v['triangles'])) for k, v in model.items()})


if __name__ == '__main__':
    main()
