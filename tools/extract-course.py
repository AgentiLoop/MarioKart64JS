#!/usr/bin/env python3
"""Extract Luigi Raceway static geometry/path and ROM textures (no downloads).

Usage: python3 tools/extract-course.py ROM --source /path/to/n64decomp/mk64
Display-list topology comes from the decompilation. Every CourseVtx and path
point is verified against the supplied US ROM before writing any output.
This is a static mesh conversion, not an RSP/RDP emulator or actor exporter.
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
ROOT = 'd_course_luigi_raceway_packed_dl_C730'


def numbers(text):
    return [int(n, 0) for n in re.findall(r'-?0x[0-9a-fA-F]+|-?\d+', text)]


def convert(source, rom):
    inputs = ['courses/luigi_raceway/course_vertices.inc.c',
              'courses/luigi_raceway/course_displaylists.inc.c',
              'courses/luigi_raceway/course_data.c', 'assets.json', 'data/other_textures.s']
    texts = {name: (source / name).read_text() for name in inputs}
    vertices = []
    packed = bytearray()
    for line in texts[inputs[0]].splitlines():
        if 'MACRO_COLOR_FLAG' not in line:
            continue
        x, y, z, s, t, r, g, b, flag, alpha = numbers(line)
        packed.extend(struct.pack('>5h4B', x, y, z, s, t, (r & 252) | (flag & 3),
                                  (g & 252) | ((flag >> 2) & 3), b, alpha))
        vertices.append([x, y, z, s, t, r & 252, g & 252, b])
    # Find the original compressed vertex block by its declared decoded size.
    vertex_offset = None
    for match in re.finditer(b'MIO0', rom):
        offset = match.start()
        if struct.unpack_from('>I', rom, offset + 4)[0] == len(packed):
            if karts.mio0(rom[offset:]) == packed:
                vertex_offset = offset
                break
    if vertex_offset is None:
        raise ValueError('Course vertices do not match the ROM')
    path_body = re.search(r'TrackPathPoint d_course_luigi_raceway_track_path\[\] = \{(.*?)\};',
                          texts[inputs[2]], re.S).group(1)
    route = [numbers(row) for row in re.findall(r'\{([^{}]+)\}', path_body)]
    path_bytes = b''.join(struct.pack('>4h', *point) for point in route)
    course_block = karts.mio0(rom[0x84E8E0:])
    path_offset = course_block.find(path_bytes)
    if path_offset < 0 or route[-1][0] != -32768:
        raise ValueError('Course path does not match the ROM')
    lists = dict(re.findall(r'Gfx (\w+)\[\] = \{(.*?)\};', texts[inputs[1]], re.S))
    batches = {}
    state = {'texture': None, 'enabled': True, 'wrapS': 'repeat', 'wrapT': 'repeat',
             'width': 32, 'height': 32}
    cache = {}
    visited = set()

    def wrap(value):
        return 'clamp' if 'G_TX_CLAMP' in value else 'mirror' if 'G_TX_MIRROR' in value else 'repeat'

    def walk(name, stack=()):
        if name in stack:
            raise ValueError('Recursive display list')
        visited.add(name)
        for command, args in re.findall(r'(gs\w+)\((.*?)\)', lists[name], re.S):
            a = [v.strip() for v in args.split(',')]
            if command == 'gsSPDisplayList':
                walk(a[0], (*stack, name))
            elif command == 'gsSPTexture':
                if a[-1] == 'G_ON' and a[:2] != ['0xFFFF', '0xFFFF']:
                    raise ValueError('Unsupported texture scale')
                state['enabled'] = a[-1] == 'G_ON'
            elif command == 'gsDPSetTextureImage':
                if a[:2] != ['G_IM_FMT_RGBA', 'G_IM_SIZ_16b']:
                    raise ValueError('Unsupported texture format')
                state['texture'] = a[3]
            elif command == 'gsDPSetTile' and a[4] == 'G_TX_RENDERTILE':
                if a[8] != 'G_TX_NOLOD' or a[11] != 'G_TX_NOLOD':
                    raise ValueError('Unsupported texture shift')
                state.update(wrapS=wrap(a[9]), wrapT=wrap(a[6]))
            elif command == 'gsDPSetTileSize':
                if a[1:3] != ['0', '0']:
                    raise ValueError('Unsupported tile origin')
                state.update(width=(int(a[3], 0) >> 2) + 1, height=(int(a[4], 0) >> 2) + 1)
            elif command == 'gsSPVertex':
                address, count, start = [int(v, 0) for v in a]
                if address >> 24 != 4 or address % 16 or start + count > 32:
                    raise ValueError('Unsupported vertex cache load')
                first = (address & 0xffffff) // 16
                for i in range(count):
                    if first + i >= len(vertices):
                        raise ValueError('Vertex out of range')
                    cache[start + i] = first + i
            elif command in ('gsSP1Triangle', 'gsSP2Triangles'):
                texture = state['texture'] if state['enabled'] else None
                key = (texture, state['width'], state['height'], state['wrapS'], state['wrapT'])
                batch = batches.setdefault(key, dict(texture=texture, width=key[1], height=key[2],
                                                     wrapS=key[3], wrapT=key[4], indices=[]))
                for j in range(0, len(a), 4):
                    batch['indices'].extend(cache[int(v, 0)] for v in a[j:j + 3])
            elif command not in ('gsDPTileSync', 'gsDPLoadSync', 'gsDPLoadBlock', 'gsDPSetTile',
                                 'gsSPEndDisplayList', 'gsDPSetCombineMode'):
                raise ValueError(f'Unsupported display-list command: {command}')
    walk(ROOT)
    # The race renderer submits the alpha-edged flags separately (render_courses.c:883–886).
    walk('d_course_luigi_raceway_packed_dl_E0')
    walk('d_course_luigi_raceway_packed_dl_68')
    triangle_lists = {name for name, body in lists.items() if 'gsSP1Triangle' in body or 'gsSP2Triangles' in body}
    if triangle_lists - visited:
        raise ValueError(f'Unvisited geometry lists: {triangle_lists - visited}')
    assets = json.loads(texts['assets.json'])
    symbols = dict(re.findall(r'glabel (\w+)\s*\.incbin "([^"]+)"', texts['data/other_textures.s']))
    textures, images = {}, {}
    for batch in batches.values():
        name = batch['texture']
        if name is None:
            continue
        path = symbols[name.replace('gLRTexture', 'gTexture')].replace('.mio0', '.png')
        meta = assets[path]
        width, height = meta['meta']['dims']
        if (width, height) != (batch['width'], batch['height']):
            raise ValueError(f'Tile dimensions mismatch: {name}')
        offset, block = [int(v, 16) for v in meta['offsets']['us']]
        data = karts.asset_bytes(rom, dict(rom_offset=hex(offset), block_offset=hex(block),
                                         width=width, height=height, type='rgba16'))
        rgba = b''.join(karts.rgba16(data))
        encoded = karts.png(width, height, rgba)
        images[name + '.png'] = encoded
        textures[name] = dict(image=name + '.png', width=width, height=height, romOffset=offset,
                              rgbaSha256=hashlib.sha256(rgba).hexdigest(),
                              pngSha256=hashlib.sha256(encoded).hexdigest())
    course = dict(name='Luigi Raceway', vertices=vertices, path=route[:-1], batches=list(batches.values()),
                  textures=textures, provenance=dict(romSha1=karts.US_SHA1, displayListRoot=ROOT,
                  vertexRomOffset=vertex_offset, vertexBytesSha256=hashlib.sha256(packed).hexdigest(),
                  pathBlockRomOffset=0x84E8E0, pathBlockOffset=path_offset,
                  pathBytesSha256=hashlib.sha256(path_bytes).hexdigest(),
                  sources={name: hashlib.sha256((source / name).read_bytes()).hexdigest() for name in inputs}))
    return course, images


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('rom', type=Path)
    parser.add_argument('--source', type=Path, required=True)
    parser.add_argument('--output', type=Path, default=Path('public/mk64/luigi-raceway'))
    args = parser.parse_args()
    rom = args.rom.read_bytes()
    if hashlib.sha1(rom).hexdigest() != karts.US_SHA1:
        raise ValueError('Expected supported big-endian US ROM')
    course, images = convert(args.source, rom)
    args.output.mkdir(parents=True, exist_ok=True)
    for name, data in images.items():
        (args.output / name).write_bytes(data)
    (args.output / 'course.json').write_text(json.dumps(course, separators=(',', ':')) + '\n')
    print(f'{len(course["vertices"])} ROM-verified vertices, {len(course["path"])} ROM-verified path points, '
          f'{sum(len(b["indices"]) // 3 for b in course["batches"])} triangles, {len(images)} native textures')
