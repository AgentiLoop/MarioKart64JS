#!/usr/bin/env python3
"""Extract Sherbet Land's ice block (Lakitu fishing a frozen kart out) from a local US ROM (no downloads).

Usage: python3 tools/extract-ice-block.py ROM --source /path/to/n64decomp/mk64 [--output public/mk64/lakitu]
n64decomp/mk64 courses/sherbet_land/course_data.c: d_course_sherbet_land_dl_ice_block (dl_70E8) draws
d_course_sherbet_land_model1..4 (lit Vtx, s10.5 texture coordinates) with the 32x32 IA16 gTextureSherbetLandIce
(mirrored wrap). The ice shards of update_objects.c func_80083FD0 are one triangle, common_data D_0D005BD0, with the
same texture; both are lit by data_800E45C0.yml D_800E4620 (ambient + one white light, render_ice_block).
Every vertex is verified against the ROM before writing iceblock.json / ice.png.
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
SHARD = 0x5BD0          # D_0D005BD0, 3 Vtx in common_data
LIGHTS = 0xE5220        # D_800E4620 (data_800E45C0.yml: vram 0x800E45C0 at ROM 0xE51C0)


def numbers(text):
    return [int(v, 0) for v in re.findall(r'-?(?:0x[0-9A-Fa-f]+|\d+)', text)]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('rom', type=Path)
    parser.add_argument('--source', type=Path, required=True)
    parser.add_argument('--output', type=Path, default=Path('public/mk64/lakitu'))
    args = parser.parse_args()
    rom = args.rom.read_bytes()
    if hashlib.sha1(rom).hexdigest() != karts.US_SHA1:
        raise SystemExit('Expected the US Mario Kart 64 ROM (SHA1 %s)' % karts.US_SHA1)
    source = args.source / 'courses/sherbet_land/course_data.c'
    text = source.read_text()
    models = {}
    for i in range(1, 5):
        body = re.search(rf'Vtx d_course_sherbet_land_model{i}\[\] = \{{(.*?)\}};', text, re.S).group(1)
        models[f'd_course_sherbet_land_model{i}'] = [numbers(row) for row in re.findall(r'\{\s*\{\s*\{([^\n]*?)\}\s*\}\s*\}', body)]
    # the Vtx run as stored in the course data segment (x y z flag s t nx ny nz a)
    packed = b''.join(struct.pack('>3hH2h4B', x, y, z, f, s, t, nx & 255, ny & 255, nz & 255, a)
                      for name in models for x, y, z, f, s, t, nx, ny, nz, a in models[name])
    found = None
    for match in re.finditer(b'MIO0', rom):
        try:
            at = karts.mio0(rom[match.start():]).find(packed)
        except Exception:
            continue
        if at >= 0:
            found = (match.start(), at)
            break
    if not found:
        raise ValueError('Ice block vertices do not match the ROM')
    dl = re.search(r'Gfx d_course_sherbet_land_dl_70E8\[\] = \{(.*?)\};', text, re.S).group(1)
    positions, normals, uvs, index, cache = [], [], [], [], {}
    for command, a in re.findall(r'(gs\w+)\((.*?)\)', dl, re.S):
        a = [v.strip() for v in a.split(',')]
        if command == 'gsSPVertex':
            rows, count, start = models[a[0]], int(a[1], 0), int(a[2], 0)
            for j in range(count):
                cache[start + j] = rows[j]
        elif command in ('gsSP1Triangle', 'gsSP2Triangles'):
            for j in range(0, len(a), 4):
                for v in a[j:j + 3]:
                    x, y, z, _f, s, t, nx, ny, nz, _a = cache[int(v, 0)]
                    positions += [x, y, z]
                    normals += [round(n / 127, 4) for n in (nx, ny, nz)]
                    uvs += [s / 32 / 32, t / 32 / 32]   # s10.5 texels over the 32-texel tile
                    index.append(len(index))
    common = karts.mio0(rom[COMMON_DATA:])
    shard = [list(struct.unpack('>3hH2h4B', common[SHARD + 16 * i:SHARD + 16 * i + 16])) for i in range(3)]
    ambient, light = list(rom[LIGHTS:LIGHTS + 3]), list(rom[LIGHTS + 8:LIGHTS + 11])
    ice = karts.asset_bytes(rom, dict(rom_offset='0x86ECF0', block_offset='0x068E8', width=32, height=32, type='rgba16'))
    rgba = b''.join(bytes([i, i, i, a]) for i, a in zip(ice[0::2], ice[1::2]))
    args.output.mkdir(parents=True, exist_ok=True)
    (args.output / 'ice.png').write_bytes(karts.png(32, 32, rgba))
    out = dict(romSha1=karts.US_SHA1, source='n64decomp/mk64 courses/sherbet_land/course_data.c d_course_sherbet_land_dl_ice_block',
               vertexBlockRomOffset=found[0], vertexBlockOffset=found[1], texture='ice.png', textureRomOffset='0x86ECF0+0x068E8',
               positions=positions, normals=normals, uvs=uvs,
               shard=dict(source='common_data D_0D005BD0', positions=[v[:3] for v in shard], uvs=[[v[4] / 32 / 32, v[5] / 32 / 32] for v in shard]),
               lights=dict(source='D_800E4620', ambient=ambient, color=light))
    (args.output / 'iceblock.json').write_text(json.dumps(out, separators=(',', ':')) + '\n')
    print(f'{len(index) // 3} triangles, vertices at MIO0 {found[0]:#x} + {found[1]:#x}, ambient {ambient}, light {light}')


if __name__ == '__main__':
    main()
