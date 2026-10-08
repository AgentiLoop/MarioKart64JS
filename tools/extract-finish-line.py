#!/usr/bin/env python3
"""Extract the native MK64 start/finish gantry (no downloads).

Usage: python3 tools/extract-finish-line.py ROM [--output public/mk64/finish-line]
Model: common_data (segment 0x0D, MIO0 @ ROM 0x132B50, yamls/us/common_data.yml). func_80297340
(actors.c) draws it at the first track path point, y - 15, with no rotation, picking one of four lists
(D_0D001B90 / BD8 / C20 / C88). The pieces are decoded as F3DEX GBI straight from the ROM:
  D_0D001840 banner: 4x2 panels, each a 64x32 CI8 texture the game DMAs into segment 3 + 0x4000..0x7800
             (gTextureFinishLineBanner1..8, 8 x 0x800 in dma order, actors.c:1205-1212) with the
             common_tlut_finish_line_banner palette (common_data + 0). G_CULL_BACK: front only.
  common_model_finish_post (0x1AB8): two poles + four brackets, RGBA16 32x32 textures at segment 3 +
             0x8000 / 0x8800 (gTexture671A88 / gTexture6774D8), G_RM_AA_ZB_TEX_EDGE, culling cleared.
  D_0D001B68: untextured white quad behind the banner, seen from the back side.
"""
import argparse
import hashlib
import importlib.util
import json
import struct
from pathlib import Path

spec = importlib.util.spec_from_file_location('karts', Path(__file__).with_name('extract-karts.py'))
karts = importlib.util.module_from_spec(spec)
spec.loader.exec_module(karts)

COMMON_DATA = 0x132B50
BANNER_LIST, POST_LIST, BACK_LIST = 0x1840, 0x1AB8, 0x1B68
BANNER_ROM = [0x696BAC, 0x696E3C, 0x697138, 0x69743C, 0x6977F0, 0x697B10, 0x697E80, 0x69811C]
POST_ROM = {0x8000: 0x671A88, 0x8800: 0x6774D8}   # segment 3 offset -> MIO0 rgba16 32x32 texture
SEG3 = {0x4000 + 0x800 * i: ('banner%d' % (i + 1)) for i in range(8)}
SEG3.update({0x8000: 'post1', 0x8800: 'post2'})


def rice_crc(buf, width, height, pitch):
    """Rice Video texture CRC of 8-bit texels: the hash in the MK64 Reloaded pack file names (tools/build-hd-textures.py)."""
    crc = 0
    for y in range(height - 1, -1, -1):
        row = (height - 1 - y) * pitch
        esi = 0
        for x in range(width - 4, -1, -4):
            esi = struct.unpack_from('>I', buf, row + x)[0] ^ x
            crc = (((crc << 4) | (crc >> 28)) + esi) & 0xffffffff
        crc = (crc + (esi ^ y)) & 0xffffffff
    return crc


def decode(data, offset):
    """Walk one display list; return groups of triangles that share a segment 3 texture."""
    cache, verts, groups, tex, clear = {}, [], [], None, 0
    while True:
        w0, w1 = struct.unpack_from('>II', data, offset)
        op = w0 >> 24
        offset += 8
        if op == 0x04:                                  # G_VTX
            n, v0 = (w0 >> 10) & 0x3F, ((w0 >> 16) & 0xFF) // 2
            if w1 >> 24 != 0x0D or (w0 & 0x3FF) != n * 16 - 1:
                raise ValueError('Unexpected G_VTX at 0x%X' % (offset - 8))
            base = w1 & 0xFFFFFF
            for i in range(n):
                x, y, z, _, s, t, r, g, b, a = struct.unpack_from('>4h2h4B', data, base + 16 * i)
                cache[v0 + i] = len(verts)
                verts.append([x, y, z, s, t, r, g, b, a])
        elif op == 0xFD and w1 >> 24 == 0x03:          # G_SETTIMG, segment 3
            tex = SEG3[w1 & 0xFFFFFF]
        elif op in (0xB1, 0xBF):
            tris = ([[cache[(w0 >> s & 0xFF) // 2] for s in (16, 8, 0)], [cache[(w1 >> s & 0xFF) // 2] for s in (16, 8, 0)]]
                    if op == 0xB1 else [[cache[(w1 >> s & 0xFF) // 2] for s in (16, 8, 0)]])
            if not groups or groups[-1]['texture'] != tex:
                groups.append(dict(texture=tex, triangles=[]))
            groups[-1]['triangles'] += tris
        elif op == 0xB6:
            clear |= w1
        elif op == 0xB8:
            return verts, groups, clear
        elif op not in (0xE7, 0xBB, 0xB7, 0xB9, 0xFC, 0xF5, 0xE6, 0xF3, 0xBA, 0xE8, 0xF2, 0xF0, 0xFD, 0x06):
            raise ValueError('Unsupported GBI op 0x%02X at 0x%X' % (op, offset - 8))


def compact(verts, groups):
    """Re-index so each group owns its vertices (the poles and panels share one vertex array)."""
    out = []
    for g in groups:
        remap, vs, ts = {}, [], []
        for tri in g['triangles']:
            row = []
            for i in tri:
                if i not in remap:
                    remap[i] = len(vs)
                    vs.append(verts[i])
                row.append(remap[i])
            ts.append(row)
        out.append(dict(texture=g['texture'], vertices=vs, triangles=ts))
    return out


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('rom', type=Path)
    parser.add_argument('--output', type=Path, default=Path('public/mk64/finish-line'))
    args = parser.parse_args()
    rom = args.rom.read_bytes()
    if hashlib.sha1(rom).hexdigest() != karts.US_SHA1:
        raise SystemExit('Expected the US Mario Kart 64 ROM (SHA1 %s)' % karts.US_SHA1)
    common = karts.mio0(rom[COMMON_DATA:])
    args.output.mkdir(parents=True, exist_ok=True)

    palette = karts.rgba16(common[:512])
    images, crcs = {}, {}
    for i, off in enumerate(BANNER_ROM):
        ci8 = karts.mio0(rom[off:])[:64 * 32]
        crcs['banner%d' % (i + 1)] = '%08X' % rice_crc(ci8, 64, 32, 64)
        images['banner%d' % (i + 1)] = (64, 32, b''.join(palette[p] for p in ci8))
    for n, (seg, off) in enumerate(POST_ROM.items(), 1):
        images['post%d' % n] = (32, 32, b''.join(karts.rgba16(karts.mio0(rom[off:])[:32 * 32 * 2])))
    for name, (w, h, rgba) in images.items():
        (args.output / (name + '.png')).write_bytes(karts.png(w, h, rgba))

    model = {}
    for key, off in (('banner', BANNER_LIST), ('post', POST_LIST), ('back', BACK_LIST)):
        verts, groups, clear = decode(common, off)
        model[key] = dict(groups=compact(verts, groups), cullCleared=bool(clear & 0x2000))
    # D_0D001B68 draws vtx 0x1710 as a plain quad: the decoder above only knows segment 3 textures, so it
    # keeps texture=None there (BB texture off + G_CC_SHADE in the list).
    assert all(g['texture'] is None for g in model['back']['groups'])
    assert [g['texture'] for g in model['banner']['groups']] == ['banner%d' % i for i in range(1, 9)]
    assert [g['texture'] for g in model['post']['groups']] == ['post1', 'post2']
    out = dict(romSha1=karts.US_SHA1, commonDataRomOffset=COMMON_DATA, model=model,
               images={n: dict(width=w, height=h, sha256=hashlib.sha256(r).hexdigest(), **({'riceCrc': crcs[n]} if n in crcs else {}))
                       for n, (w, h, r) in images.items()},
               origin='first track path point, y - 15, no rotation (code_800029B0.c:219-226, actors.c:317)')
    (args.output / 'finish-line.json').write_text(json.dumps(out, separators=(',', ':')) + '\n')
    for key, m in model.items():
        print('%-6s %s' % (key, [(g['texture'], len(g['vertices']), len(g['triangles'])) for g in m['groups']]))


if __name__ == '__main__':
    main()
