#!/usr/bin/env python3
"""Extract native MK64 course static geometry/path and ROM textures (no downloads).

Usage: python3 tools/extract-course.py ROM --source /path/to/n64decomp/mk64 [--course mario_raceway]
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
# Root = full static course list; edge = lists the race renderer submits separately with
# G_RM_AA_ZB_TEX_EDGE (alpha-tested), per src/racing/render_courses.c.
COURSES = {
    'luigi_raceway': dict(name='Luigi Raceway', prefix='gLRTexture', root='C730', edge=['E0', '68']),
    'mario_raceway': dict(name='Mario Raceway', prefix='gMRTexture', root='6928', edge=['450', '240', 'E0', '160']),
    'moo_moo_farm': dict(name='Moo Moo Farm', prefix='gMMFTexture', root='6730', edge=['10C0']),
    'koopa_troopa_beach': dict(name='Koopa Troopa Beach', prefix='gKTBTexture', root='B2B0', edge=['2C0']),
    'kalimari_desert': dict(name='Kalimari Desert', prefix='gKDTexture', root='A670', edge=['998', '270']),
    'toads_turnpike': dict(name="Toad's Turnpike", prefix='gTTTexture', root='6B08', edge=['0', '68', 'D8']),
    'frappe_snowland': dict(name='Frappe Snowland', prefix='gFSTexture', root='6638', edge=[]),
    'choco_mountain': dict(name='Choco Mountain', prefix='gCMTexture', root='5AE0', edge=['448', '5D8', '718']),
    'sherbet_land': dict(name='Sherbet Land', prefix='gSLTexture', root='3848', edge=[]),
    'royal_raceway': dict(name='Royal Raceway', prefix='gRRWTexture', root='B120', edge=['8A0']),
    'bowsers_castle': dict(name="Bowser's Castle", prefix='gBCTexture', root='9910', edge=['248']),
    'wario_stadium': dict(name='Wario Stadium', prefix='gWSTexture', root='A4A8', edge=['A88']),
    'banshee_boardwalk': dict(name='Banshee Boardwalk', prefix='gBBTexture', root='7338', edge=['580', '60', '540']),
    'yoshi_valley': dict(name='Yoshi Valley', prefix='gYVTexture', root='8150', edge=[]),
    'rainbow_road': dict(name='Rainbow Road', prefix='gRRTexture', root='20F8', edge=[]),
    'dks_jungle_parkway': dict(name="D.K.'s Jungle Parkway", prefix='gDKJTexture', root='9C18', edge=[]),
}
# Per-section arrays render_<course>/render_course_segments walks, with the render mode set
# before the call, and lists the translucent second pass (G_RM_AA_ZB_XLU_*) submits.
for _id, _sections in {
        'luigi_raceway': [('luigi_raceway_dls', 'opaque')],
        'mario_raceway': [('mario_raceway_dls', 'opaque')],
        'moo_moo_farm': [('moo_moo_farm_dls', 'opaque'), ('d_course_moo_moo_farm_dl_14060', 'opaque')],
        'koopa_troopa_beach': [('d_course_koopa_troopa_beach_dl_list1', 'opaque'),
                               ('d_course_koopa_troopa_beach_dl_list2', 'xlu')],
        'kalimari_desert': [('kalimari_desert_dls', 'opaque')],
        'toads_turnpike': [('d_course_toads_turnpike_dl_list', 'opaque')],
        'frappe_snowland': [('d_course_frappe_snowland_dl_list', 'opaque')],
        'choco_mountain': [('choco_mountain_dls', 'opaque')],
        'sherbet_land': [('sherbet_land_dls', 'opaque'), ('sherbet_land_dls_2', 'xlu')],
        'royal_raceway': [('royal_raceway_dls', 'opaque')],
        'bowsers_castle': [('bowsers_castle_dls', 'opaque')],
        'wario_stadium': [('wario_stadium_dls', 'opaque')],
        'banshee_boardwalk': [('banshee_boardwalk_dls', 'opaque')],
        'yoshi_valley': [('d_course_yoshi_valley_dl_list', 'opaque')],
        'rainbow_road': [('d_course_rainbow_road_dl_list', 'opaque')],
        'dks_jungle_parkway': [('d_course_dks_jungle_parkway_unknown_dl_list', 'edge')],
}.items():
    COURSES[_id]['sections'] = _sections
COURSES['banshee_boardwalk']['xlu'] = ['878']
COURSES['wario_stadium']['xlu'] = ['EC0']
COURSES['wario_stadium']['unused'] = ['3B0']  # only under the unreferenced aggregate list F20


def numbers(text):
    return [int(n, 0) for n in re.findall(r'-?0x[0-9a-fA-F]+|-?\d+', text)]


def convert(source, rom, course_id):
    cfg = COURSES[course_id]
    dl = f'd_course_{course_id}_packed_dl_'
    inputs = [f'courses/{course_id}/course_vertices.inc.c',
              f'courses/{course_id}/course_displaylists.inc.c',
              f'courses/{course_id}/course_data.c', f'courses/{course_id}/course_offsets.c',
              'assets.json', 'data/other_textures.s', 'src/racing/render_courses.c',
              f'assets/courses/{course_id}.json']
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
    path_body = re.search(rf'TrackPathPoint d_course_{course_id}_track_path\[\] = \{{(.*?)\}};',
                          texts[inputs[2]], re.S).group(1)
    route = [numbers(row) for row in re.findall(r'\{([^{}]+)\}', path_body)]
    path_bytes = b''.join(struct.pack('>4h', *point) for point in route)
    # The course data segment is a MIO0 block; locate the one that holds this exact path.
    path_block = path_offset = None
    for match in re.finditer(b'MIO0', rom):
        try:
            found = karts.mio0(rom[match.start():]).find(path_bytes)
        except Exception:
            continue
        if found >= 0:
            path_block, path_offset = match.start(), found
            break
    if path_block is None or route[-1][0] != -32768:
        raise ValueError('Course path does not match the ROM')
    # Packed course lists plus the course_data wrappers the race renderer reaches through
    # its per-section arrays (render_course_segments); wrappers set render mode/texture state.
    lists = dict(re.findall(r'Gfx (\w+)\[\] = \{(.*?)\};', texts[inputs[1]] + texts[inputs[2]], re.S))
    arrays = dict(re.findall(r'Gfx\* (\w+)\[\] = \{(.*?)\};', texts[inputs[2]] + texts[inputs[3]], re.S))
    batches = {}
    state = {'texture': None, 'format': 'rgba16', 'enabled': True, 'wrapS': 'repeat', 'wrapT': 'repeat',
             'width': 32, 'height': 32, 'origin': (0, 0), 'mode': 'opaque'}
    cache = {}
    visited = set()
    seen = set()
    formats = {}

    def wrap(value):
        return 'clamp' if 'G_TX_CLAMP' in value else 'mirror' if 'G_TX_MIRROR' in value else 'repeat'

    def fixed(value):  # signed 10.2 tile coordinate -> texels
        v = int(value, 0) & 0xfff
        return (v - 0x1000 if v & 0x800 else v) / 4

    def texture_image(fmt, size, name):
        kind = {('G_IM_FMT_RGBA', 'G_IM_SIZ_16b'): 'rgba16', ('G_IM_FMT_IA', 'G_IM_SIZ_16b'): 'ia16'}.get((fmt, size))
        if kind is None:
            raise ValueError(f'Unsupported texture format {fmt} {size}')
        state.update(texture=name, format=kind)

    def walk(name, stack=()):
        if name in stack:
            raise ValueError('Recursive display list')
        if name in visited:
            return  # each packed list is converted once, in the first pass that draws it
        visited.add(name)
        for command, args in re.findall(r'(gs\w+)\((.*?)\)', lists[name], re.S):
            a = [v.strip() for v in args.split(',')]
            if command == 'gsSPDisplayList':
                walk(a[0], (*stack, name))
            elif command == 'gsSPTexture':
                if a[-1] == 'G_ON' and a[:2] != ['0xFFFF', '0xFFFF']:
                    raise ValueError('Unsupported texture scale')
                state['enabled'] = a[-1] == 'G_ON'
            elif command == 'gsDPSetRenderMode':
                state['mode'] = ('xlu' if 'XLU' in a[0] + a[1] else
                                 'edge' if 'TEX_EDGE' in a[1] else 'opaque')
            elif command == 'gsDPSetTextureImage':
                texture_image(a[0], a[1], a[3])
            elif command == 'gsDPLoadTextureBlock':
                texture_image(a[1], a[2], a[0])
                state.update(wrapS=wrap(a[6]), wrapT=wrap(a[7]), width=int(a[3], 0),
                             height=int(a[4], 0), origin=(0, 0))
            elif command == 'gsDPSetTile' and a[4] == 'G_TX_RENDERTILE':
                if a[8] != 'G_TX_NOLOD' or a[11] != 'G_TX_NOLOD':
                    raise ValueError('Unsupported texture shift')
                state.update(wrapS=wrap(a[9]), wrapT=wrap(a[6]))
            elif command == 'gsDPSetTileSize':
                state.update(width=(int(a[3], 0) >> 2) + 1, height=(int(a[4], 0) >> 2) + 1,
                             origin=(fixed(a[1]), fixed(a[2])))
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
                if texture:
                    formats[texture] = state['format']
                key = (texture, state['width'], state['height'], state['wrapS'], state['wrapT'],
                       state['mode'] == 'edge', state['mode'] == 'xlu', state['origin'])
                batch = batches.get(key)
                if batch is None:
                    batch = batches[key] = dict(texture=texture, width=key[1], height=key[2],
                                                wrapS=key[3], wrapT=key[4], alphaTest=key[5], indices=[])
                    if key[6]:
                        batch['translucent'] = True
                    if key[7] != (0, 0):
                        batch['tileOrigin'] = list(key[7])
                for j in range(0, len(a), 4):
                    tri = tuple(cache[int(v, 0)] for v in a[j:j + 3])
                    if (texture, tri) not in seen:  # sections repeat shared lists
                        seen.add((texture, tri))
                        batch['indices'].extend(tri)
            elif command not in ('gsDPTileSync', 'gsDPLoadSync', 'gsDPLoadBlock', 'gsDPSetTile',
                                 'gsSPEndDisplayList', 'gsDPSetCombineMode', 'gsDPPipeSync',
                                 'gsSPSetGeometryMode', 'gsSPClearGeometryMode', 'gsDPSetBlendMask',
                                 'gsDPSetTextureFilter', 'gsDPSetTexturePersp', 'gsDPSetAlphaCompare',
                                 'gsDPSetPrimColor', 'gsDPNoOp', 'gsSPNumLights', 'gsSPSetLights1',
                                 'gsSPLight', 'gsDPSetCycleType', 'gsDPSetFogColor', 'gsSPFogPosition',
                                 'gsSPFogFactor') and not (command == 'gsDPSetTextureLUT' and a == ['G_TT_NONE']):
                raise ValueError(f'Unsupported display-list command: {command} in {name}')

    def resolve(name):
        return dl + name if dl + name in lists else name

    # Pass order mirrors render_<course>: opaque section arrays, separately submitted alpha-edge
    # lists, the translucent pass; the full static root last catches anything else.
    sections = cfg.get('sections', [])
    passes = ([s for s in sections if s[1] != 'xlu'] + [(n, 'edge') for n in cfg['edge']] +
              [(n, 'xlu') for n in cfg.get('xlu', [])] + [s for s in sections if s[1] == 'xlu'] +
              [(cfg['root'], 'opaque')])
    for name, mode in passes:
        state['mode'] = mode
        if name in arrays:
            for entry in re.findall(r'\w+', arrays[name]):
                if entry in lists:
                    walk(entry)
        else:
            walk(resolve(name))
    # Lists reached only by course_generate_collision_mesh (invisible collision geometry), by
    # render_course_credits, or declared unreferenced are legitimately not race scenery.
    render_c = texts['src/racing/render_courses.c']
    collision_text = render_c[render_c.index('void course_generate_collision_mesh'):]
    credits_text = render_c[render_c.index('void render_course_credits'):render_c.index('void render_course(')]
    not_race = set()

    def mark(name):
        if name in lists and name not in not_race:
            not_race.add(name)
            for child in re.findall(r'gsSPDisplayList\((\w+)\)', lists[name]):
                mark(child)
    for name in (re.findall(rf'{dl}\w+', collision_text) + re.findall(rf'd_course_{course_id}_dl_\w+', credits_text)
                 + [dl + n for n in cfg.get('unused', [])]):
        mark(name)
    triangle_lists = {name for name, body in lists.items() if name.startswith(dl)
                      and ('gsSP1Triangle' in body or 'gsSP2Triangles' in body)}
    missing = triangle_lists - visited - not_race
    if missing:
        raise ValueError(f'Unvisited geometry lists: {sorted(missing)}')
    batches = {k: b for k, b in batches.items() if b['indices']}
    assets = json.loads(texts['assets.json'])
    course_assets = json.loads(texts[inputs[7]])
    symbols = dict(re.findall(r'glabel (\w+)\s*\.incbin "([^"]+)"', texts['data/other_textures.s']))
    textures, images = {}, {}
    for batch in batches.values():
        name = batch['texture']
        if name is None or name in textures:
            continue
        symbol = name.replace(cfg['prefix'], 'gTexture')
        path = symbols[symbol].replace('.mio0', '.png')
        if path in assets:
            meta = assets[path]
            width, height = meta['meta']['dims']
            offset, block = [int(v, 16) for v in meta['offsets']['us']]
        else:  # named course textures are described in assets/courses/<course>.json
            meta = course_assets[symbol]
            width, height = meta['width'], meta['height']
            offset, block = int(meta['rom_offset'], 16), int(meta.get('block_offset', '0'), 16)
            path = f'{path[:-4]}.{meta["type"]}.png'
        if (width, height) != (batch['width'], batch['height']):
            raise ValueError(f'Tile dimensions mismatch: {name}')
        if not path.endswith(f'.{formats[name]}.png'):
            raise ValueError(f'Texture format mismatch: {name} {path}')
        data = karts.asset_bytes(rom, dict(rom_offset=hex(offset), block_offset=hex(block),
                                         width=width, height=height, type='rgba16'))  # both 16-bit
        if formats[name] == 'ia16':
            rgba = b''.join(bytes([i, i, i, a]) for i, a in zip(data[0::2], data[1::2]))
        else:
            rgba = b''.join(karts.rgba16(data))
        encoded = karts.png(width, height, rgba)
        images[name + '.png'] = encoded
        textures[name] = dict(image=name + '.png', width=width, height=height, romOffset=offset,
                              rgbaSha256=hashlib.sha256(rgba).hexdigest(),
                              pngSha256=hashlib.sha256(encoded).hexdigest())
        if formats[name] != 'rgba16':
            textures[name]['format'] = formats[name]
    provenance = dict(romSha1=karts.US_SHA1, displayListRoot=dl + cfg['root'],
                      edgeLists=[dl + name for name in cfg['edge']])
    if cfg.get('xlu'):
        provenance['translucentLists'] = [resolve(n) for n in cfg['xlu']]
    if cfg.get('sections'):
        provenance['sectionArrays'] = [n for n, _ in cfg['sections']]
    course = dict(name=cfg['name'], vertices=vertices, path=route[:-1], batches=list(batches.values()),
                  textures=textures, provenance=dict(**provenance,
                  vertexRomOffset=vertex_offset, vertexBytesSha256=hashlib.sha256(packed).hexdigest(),
                  pathBlockRomOffset=path_block, pathBlockOffset=path_offset,
                  pathBytesSha256=hashlib.sha256(path_bytes).hexdigest(),
                  sources={name: hashlib.sha256((source / name).read_bytes()).hexdigest() for name in inputs}))
    return course, images


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('rom', type=Path)
    parser.add_argument('--source', type=Path, required=True)
    parser.add_argument('--course', choices=sorted(COURSES), default='luigi_raceway')
    parser.add_argument('--output', type=Path, help='default: public/mk64/<course-with-dashes>')
    args = parser.parse_args()
    args.output = args.output or Path('public/mk64') / args.course.replace('_', '-')
    rom = args.rom.read_bytes()
    if hashlib.sha1(rom).hexdigest() != karts.US_SHA1:
        raise ValueError('Expected supported big-endian US ROM')
    course, images = convert(args.source, rom, args.course)
    args.output.mkdir(parents=True, exist_ok=True)
    for name, data in images.items():
        (args.output / name).write_bytes(data)
    (args.output / 'course.json').write_text(json.dumps(course, separators=(',', ':')) + '\n')
    print(f'{len(course["vertices"])} ROM-verified vertices, {len(course["path"])} ROM-verified path points, '
          f'{sum(len(b["indices"]) // 3 for b in course["batches"])} triangles, {len(images)} native textures')
