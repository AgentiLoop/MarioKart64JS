#!/usr/bin/env python3
"""Extract the native MK64 item actors' models and textures (no downloads).

Usage: python3 tools/extract-items.py ROM [--output public/mk64/items]
common_data (segment 0x0D, MIO0 @ ROM 0x132B50, offsets from yamls/us/common_data.yml):
  common_model_banana (0x4B48): common_vtx_banana (0x3298, 5 verts), two crossed triangles drawn with
    common_texture_banana (0x3348, RGBA16 32x32), G_CULL_BACK cleared. render_actor_banana draws it unrotated.
  common_model_flat_banana (0x4BD8): common_vtx_flat_banana (0x32E8, 6 verts) with common_texture_flat_banana
    (0x3B48, RGBA16 64x32), the DESTROYED_BANANA model.
Vertices are [x, y, z, s, t, r, g, b, a] in MK64 units (s, t in S10.5 texels).
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
# name: (vtx offset, count, triangles from the model's gSP2Triangles / gSP1Triangle, texture offset, w, h)
MODELS = {
    'banana': (0x3298, 5, [[0, 1, 2], [3, 1, 4]], 0x3348, 32, 32),
    'flat-banana': (0x32E8, 6, [[0, 1, 2], [3, 4, 5]], 0x3B48, 64, 32),
}
# Shells (render_actor_shell): eight 32x32 CI8 spin frames, each its own MIO0 block (assets/greenshell.json,
# blueshell.json), drawn with a 256-colour RGBA16 TLUT from common_data. The red shell has no texture of its own:
# init_red_shell_texture swaps the red and green fields of the green TLUT (as s16, so a set top red bit
# sign-extends into the red and green fields). Quads D_0D005338 (vtx 0x5238) and mirrored D_0D005368 (vtx 0x5278),
# gSPTexture scale 0.5 (D_0D005308).
SHELL_FRAMES = {
    'green': (0x4E38, [0x68EB50, 0x68EDA0, 0x68EFF0, 0x68F248, 0x68F4A8, 0x68F700, 0x68F96C, 0x68FBCC]),
    'blue': (0x5038, [0x68FE20, 0x69004C, 0x690284, 0x6904C4, 0x690708, 0x690960, 0x690BBC, 0x690DF8]),
}
SHELL_QUADS = {'shell': 0x5238, 'shellMirrored': 0x5278}
# Item-hit explosion (func_80068724, particlePool2 type 4 set by func_8008C310 on every tumble trigger):
# gTextureLightningBolt0 / 1 (textures/standalone/lightning_zap_0 / 1.ia8, 32x64 IA8, MIO0 @ the assets.json offsets)
# on quads D_800E8A00 / D_800E8A40 (main code data, ROM = RAM - 0x80000400 + 0x1000), gSPTexture scale 0.5
# (D_0D008DB8), G_CC_MODULATEIDECALA: texel intensity x the red / yellow vertex colours, texel alpha.
EXPLOSION_TEXTURES = [0x6A04E4, 0x6A0798]
EXPLOSION_QUADS = [0x800E8A00, 0x800E8A40]
# Battle balloon (render_battle_balloon): gTextureBalloon1 / 2 (assets/onomatopoeia.json, 64x32 CI8, MIO0) with the
# 256-colour RGBA16 TLUT D_800E52D0 (gTLUTOnomatopoeia, main code data @ ROM 0xE5ED0) on gBalloonVertexPlane1
# (y 9..18) over gBalloonVertexPlane2 (y 0..9), gSPTexture scale 0.5 (D_0D008DB8). Stacked top to bottom.
BALLOON_TEXTURES = [0x6A010C, 0x6A0350]
BALLOON_TLUT = 0xE5ED0


def red_tlut(green):
    out = bytearray()
    for (c,) in struct.iter_unpack('>H', green):
        r = c & 0xF800
        if r & 0x8000:
            r -= 0x10000
        out += struct.pack('>H', ((r >> 5) | ((c & 0x7C0) << 5) | (c & 0x3E) | (c & 1)) & 0xFFFF)
    return bytes(out)



def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('rom', type=Path)
    parser.add_argument('--output', type=Path, default=Path('public/mk64/items'))
    args = parser.parse_args()
    rom = args.rom.read_bytes()
    if hashlib.sha1(rom).hexdigest() != karts.US_SHA1:
        raise SystemExit('Expected the US Mario Kart 64 ROM (SHA1 %s)' % karts.US_SHA1)
    common = karts.mio0(rom[COMMON_DATA:])
    args.output.mkdir(parents=True, exist_ok=True)
    out = dict(romSha1=karts.US_SHA1, commonDataRomOffset=COMMON_DATA, models={})
    for name, (vtx, count, triangles, tex, w, h) in MODELS.items():
        vertices = []
        for i in range(count):
            x, y, z, _flag, s, t, r, g, b, a = struct.unpack('>3hH2h4B', common[vtx + 16 * i:vtx + 16 * i + 16])
            vertices.append([x, y, z, s, t, r, g, b, a])
        rgba = b''.join(karts.rgba16(common[tex:tex + w * h * 2]))
        image = name + '.png'
        (args.output / image).write_bytes(karts.png(w, h, rgba))
        out['models'][name] = dict(image=image, width=w, height=h, texture=tex, vertices=vertices, triangles=triangles,
                                   rgbaSha256=hashlib.sha256(rgba).hexdigest())
        print('%-12s vtx 0x%04X tex 0x%04X %dx%d' % (name, vtx, tex, w, h))
    for name, vtx in SHELL_QUADS.items():
        vertices = [list(struct.unpack('>3hH2h4B', common[vtx + 16 * i:vtx + 16 * i + 16])) for i in range(4)]
        out.setdefault('shellQuads', {})[name] = dict(vertices=[v[:3] + v[4:] for v in vertices], triangles=[[0, 1, 2], [0, 2, 3]],
                                   textureScale=0.5)
    tluts = {name: common[tlut:tlut + 0x200] for name, (tlut, _) in SHELL_FRAMES.items()}
    tluts['red'] = red_tlut(tluts['green'])
    out['shells'] = {}
    for name, tlut in tluts.items():
        palette = karts.rgba16(tlut)
        frames = [karts.mio0(rom[o:]) for o in SHELL_FRAMES['blue' if name == 'blue' else 'green'][1]]
        rows = []
        for y in range(32):
            rows.append(b''.join(palette[f[y * 32 + x]] for f in frames for x in range(32)))
        rgba = b''.join(rows)
        image = name + '-shell.png'
        (args.output / image).write_bytes(karts.png(32 * len(frames), 32, rgba))
        out['shells'][name] = dict(image=image, frameWidth=32, frameHeight=32, frames=len(frames),
                                   rgbaSha256=hashlib.sha256(rgba).hexdigest())
        print('%-12s %d frames' % (name + ' shell', len(frames)))
    halves = [karts.mio0(rom[o:])[:32 * 64] for o in EXPLOSION_TEXTURES]
    rgba = b''.join(bytes(((v >> 4) * 17,) * 3 + ((v & 15) * 17,)) for y in range(64) for h in halves for v in h[y * 32:y * 32 + 32])
    (args.output / 'explosion.png').write_bytes(karts.png(64, 64, rgba))
    quads = []
    for i, ram in enumerate(EXPLOSION_QUADS):
        off = ram - 0x80000400 + 0x1000
        verts = [list(struct.unpack('>3hH2h4B', rom[off + 16 * j:off + 16 * j + 16])) for j in range(4)]
        quads.append([v[:3] + [v[4] * 0.5 + i * 32 * 32, v[5] * 0.5] + v[6:] for v in verts])
    out['explosion'] = dict(image='explosion.png', width=64, height=64, quads=quads, triangles=[[0, 1, 2], [0, 2, 3]],
                            rgbaSha256=hashlib.sha256(rgba).hexdigest())
    print('explosion    64x64, 2 quads')
    palette = karts.rgba16(rom[BALLOON_TLUT:BALLOON_TLUT + 0x200])
    rgba = b''.join(palette[i] for o in BALLOON_TEXTURES for i in karts.mio0(rom[o:])[:64 * 32])
    (args.output / 'balloon.png').write_bytes(karts.png(64, 64, rgba))
    out['balloon'] = dict(image='balloon.png', width=64, height=64, rgbaSha256=hashlib.sha256(rgba).hexdigest())
    print('balloon      64x64')
    (args.output / 'items.json').write_text(json.dumps(out, indent=1) + '\n')


if __name__ == '__main__':
    main()
