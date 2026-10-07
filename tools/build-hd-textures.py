#!/usr/bin/env python3
"""Build 2x/4x texture tiers from the MK64 Reloaded HD pack (requires Pillow).

Usage: python3 tools/build-hd-textures.py /path/to/MK64-Reloaded-master [--output public/mk64-hd]

Every native image under public/mk64 is matched to an HD replacement and Lanczos-resampled to
exactly native size x 2 and 4, so each tier is shared by the 480p / 960p+ presets:
  - course textures: Rice/GLideN64 texture CRC (MARIOKART64#CRC#fmt#siz) computed from the native
    rgba16 / ia16 texels, which are recovered losslessly from our PNGs (no ROM needed);
  - menus, faces, karts, sky: by decomp asset name, using the pack's SpaghettiKart port
    (Ports/SpaghettiKart/textures and the CRC -> name table in spaghetti.sh).
Atlases (karts, faces, clouds) are re-assembled frame by frame. The tinted menu backgrounds are
re-derived from the HD blue-sky background with the same greyscale + tint as the ROM path.
Writes <output>/<N>x/<same path as public/mk64>.png and <output>/manifest.json
({files: {path: highest tier}}); images without an HD source stay native-only.
"""
import argparse
import json
import os
import re
import struct
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
NATIVE = ROOT / 'public' / 'mk64'
TIERS = (2, 4)
KART_MAX_TIER = 2   # 8 driver atlases of 1344x1024 frames: 4x would be ~1 GB of VRAM with mipmaps
SKIP_DIRS = ('/Ports/', '/Hacks/', '/iQue/', '/rt64/', '/Widescreen/')


def rice_crc(buf, width, height, size, pitch):
    """Rice Video CalculateRDRAMCRC (also used by GLideN64 for Rice-format packs)."""
    bpl = ((width << size) + 1) // 2
    crc = 0
    for y in range(height - 1, -1, -1):
        row = (height - 1 - y) * pitch
        esi = 0
        for x in range(bpl - 4, -1, -4):
            esi = struct.unpack_from('>I', buf, row + x)[0] ^ x
            crc = (((crc << 4) | (crc >> 28)) + esi) & 0xffffffff
        crc = (crc + (esi ^ y)) & 0xffffffff
    return crc


def texels16(img, fmt):
    out = bytearray()
    for r, g, b, a in img.get_flattened_data():
        if fmt == 'ia16':
            out += bytes((r, a))
        else:
            out += struct.pack('>H', (r >> 3) << 11 | (g >> 3) << 6 | (b >> 3) << 1 | (a >= 128))
    return bytes(out)


class Pack:
    def __init__(self, root):
        self.base = Path(root) / 'MARIOKART64'
        self.crc = {}       # 'MARIOKART64#CRC#fmt#siz..._all' -> path
        self.by_crc = {}    # 'CRC' -> [keys]
        for dirpath, _, files in os.walk(self.base):
            if any(s in dirpath + '/' for s in SKIP_DIRS):
                continue
            for f in files:
                if f.startswith('MARIOKART64#') and f.endswith('.png'):
                    key, path = f[:-4], Path(dirpath) / f
                    if key not in self.crc or '(Alt)' in str(self.crc[key]):
                        self.crc[key] = path
                    self.by_crc.setdefault(key.split('#')[1], []).append(key)
        self.dims = {}
        for line in (self.base / 'mk64.tdb').read_text().splitlines():
            key, _, wh = line.partition(';')
            if 'x' in wh:
                self.dims[key] = tuple(map(int, wh.split('x')))
        self.named = {}     # SpaghettiKart texture path without .png -> file
        sk = self.base / 'Ports' / 'SpaghettiKart' / 'textures'
        for path in sk.rglob('*.png'):
            self.named[str(path.relative_to(sk))[:-4]] = path
        script = (self.base / 'spaghetti.sh').read_text()
        for src, dst in re.findall(r'cp "_temp/(MARIOKART64#[^"]+?)\$EXT" "\$PORT/textures/([^"]+?)\$EXT"', script):
            if src in self.crc:
                self.named.setdefault(dst, self.crc[src])

    def by_texels(self, buf, w, h, fmt_code, siz):
        crc = '%08X' % rice_crc(buf, w, h, siz, (w << siz) // 2)
        for key in self.by_crc.get(crc, []):
            parts = key.split('#')
            if parts[2] == str(fmt_code) and parts[3].split('_')[0] == str(siz) and self.dims.get(key, (w, h)) == (w, h):
                return self.crc[key]
        return None


def open_hd(path, intensity=False):
    img = Image.open(path).convert('RGBA')
    if intensity:   # I4 sprites: drawn as PRIMITIVE (white) with TEXEL0 alpha, like our native PNGs
        alpha = img.getchannel('A')
        if alpha.getextrema() == (255, 255):
            alpha = img.convert('L')
        img = Image.merge('RGBA', (*[Image.new('L', img.size, 255)] * 3, alpha))
    return img


def tint_lut(colour, arg1=0x19):
    """Continuous form of extract-menu-backgrounds.tint (convert_img_to_greyscale + adjust_img_colour)."""
    exp = arg1 * 1.5 / 256 + 0.25
    luts = []
    for c in colour:
        lut = []
        for v in range(256):
            grey = min(31.0, ((v * 31 / 255) / 32) ** exp * 32)
            t = grey * (0x4D + 0x96 + 0x1D) / 256
            lut.append(min(255, round(t * c / 256 * 255 / 31)))
        luts.append(lut)
    return luts


def tinted(img, colour):
    grey = img.convert('RGB').convert('L', (0x55 / 256, 0x4B / 256, 0x5F / 256, 0))
    return Image.merge('RGBA', [grey.point(lut) for lut in tint_lut(colour)] + [img.getchannel('A')])


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument('pack', type=Path)
    parser.add_argument('--output', type=Path, default=ROOT / 'public' / 'mk64-hd')
    args = parser.parse_args()
    pack = Pack(args.pack)
    print(f'{len(pack.crc)} CRC textures, {len(pack.named)} named textures in pack')
    jobs = {}   # rel -> (native size, [(hd image path, box, intensity)], max tier, post)

    lower = {k.lower(): v for k, v in pack.named.items()}

    def named(name):
        return pack.named.get(name) or lower.get(name.lower())

    def single(rel, path, max_tier=4, post=None, intensity=False):
        if path is None:
            print('  no HD source:', rel)
            return
        w, h = Image.open(NATIVE / rel).size
        jobs[rel] = ((w, h), [(path, (0, 0, w, h), intensity)], max_tier, post)

    # courses
    for course in sorted(p.parent.name for p in NATIVE.glob('*/course.json')):
        data = json.loads((NATIVE / course / 'course.json').read_text())
        for tex in data['textures'].values():
            rel = f'{course}/{tex["image"]}'
            img = Image.open(NATIVE / rel).convert('RGBA')
            fmt = tex.get('format', 'rgba16')
            single(rel, pack.by_texels(texels16(img, fmt), *img.size, 3 if fmt == 'ia16' else 0, 2))

    # karts / faces atlases
    # wheel phase 0 like extract-karts.py; frames 289+ have no wheels and no _wheelN variants
    for kind, folder, tier in (('karts', lambda d, f: f'karts/{d}_kart/{f}_wheel0'
                                if f'karts/{d}_kart/{f}_wheel0' in pack.named else f'karts/{d}_kart/{f}', KART_MAX_TIER),
                               ('faces', lambda d, f: f'player_selection/{f}', 4)):
        manifest = json.loads((NATIVE / kind / 'manifest.json').read_text())
        for driver, info in manifest['drivers'].items():
            fw, fh = info['frameWidth'], info['frameHeight']
            parts = [(named(folder(driver, f['name'])), (f.get('x', 0), f['y'], fw, fh), False) for f in info['frames']]
            if all(p for p, _, _ in parts):
                jobs[f'{kind}/{info["image"]}'] = ((info['width'], info['height']), parts, tier, None)
            else:
                print(f'  incomplete HD frames: {kind}/{driver}')

    # sky: clouds are stacked 64x32 I4 frames (matched by CRC), star is D_0D0293D8
    for path in sorted((NATIVE / 'sky').glob('clouds-*.png')):
        img = Image.open(path).convert('RGBA')
        parts = []
        for y in range(0, img.height, 32):
            alpha = img.crop((0, y, 64, y + 32)).getchannel('A').get_flattened_data()
            nib = [a // 17 for a in alpha]
            buf = bytes(nib[i] << 4 | nib[i + 1] for i in range(0, len(nib), 2))
            parts.append((pack.by_texels(buf, 64, 32, 4, 0), (0, y, 64, 32), True))
        if all(p for p, _, _ in parts):
            jobs[f'sky/{path.name}'] = (img.size, parts, 4, None)
        else:
            print(f'  incomplete HD frames: sky/{path.name}')
    single('sky/star.png', named('common_data/D_0D0293D8'), intensity=True)
    # item box "?" card: common_texture_item_box_question_mark, RGBA16 32x64 (by CRC)
    img = Image.open(NATIVE / 'item-box' / 'question-mark.png').convert('RGBA')
    single('item-box/question-mark.png', pack.by_texels(texels16(img, 'rgba16'), *img.size, 0, 2))

    # menus
    sky = named('texture_tkmk00/background_blue_sky')
    single('menu/background_blue_sky.png', sky)
    single('menu/background_sunset.png', named('texture_tkmk00/background_sunset'))
    for name, colour in (('main_menu', (0xFF, 0xAF, 0xAF)), ('player_select', (0xAF, 0xFF, 0xAF)),
                         ('course_select', (0xAF, 0xAF, 0xFF))):
        single(f'menu/background_{name}.png', sky, post=lambda img, c=colour: tinted(img, c))
    single('menu/logo_mario_kart_64.png', named('other_textures/logo_mario_kart_64'))
    single('menu/copyright_1996.png', named('player_selection/copyright_1996'))
    single('menu/push_start_button.png', named('player_selection/push_start_button'))
    previews = json.loads((NATIVE / 'menu' / 'previews' / 'manifest.json').read_text())['previews']
    for cid, info in previews.items():
        single(f'menu/previews/{cid}.png', named(f'player_selection/{info["symbol"]}'))
        title = info['symbol'].replace('gTextureCoursePreview', 'gTextureTitle')
        single(f'courseselect/title_{cid}.png', named(f'texture_tkmk00/{title}'))
    single('courseselect/map_select.png', named('texture_tkmk00/gTextureMapSelect'))
    for cup in ('mushroom', 'flower', 'star', 'special'):
        single(f'courseselect/cup_{cup}.png', named(f'texture_tkmk00/gTextureMenu{cup.title()}Cup'))
    single('charselect/player_select_banner.png', named('texture_tkmk00/texture_player_select'))
    single('charselect/ok.png', named('texture_tkmk00/texture_ok'))
    for driver in ('mario', 'luigi', 'peach', 'toad', 'yoshi', 'donkeykong', 'wario', 'bowser'):
        single(f'charselect/name_{driver}.png', named(f'texture_tkmk00/texture_name_{"dk" if driver == "donkeykong" else driver}'))
    for border in ('p1_border_blue', 'p2_border_red', 'p3_border_orange', 'p4_border_green'):
        single(f'charselect/{border}.png', named(f'player_selection/{border}'))

    # render tiers
    files, cache = {}, {}
    for rel, ((w, h), parts, max_tier, post) in sorted(jobs.items()):
        sources = []
        for path, box, intensity in parts:
            if (path, intensity) not in cache:
                cache.clear()   # karts/faces reuse nothing across files; keep memory flat
                cache[(path, intensity)] = open_hd(path, intensity)
            sources.append((cache[(path, intensity)], box))
        # never upscale: a tier needs an HD source at least that many times the native size
        scale = min(min(img.width / box[2], img.height / box[3]) for img, box in sources)
        tiers = [t for t in TIERS if t <= max_tier and t <= scale + 0.01]
        for t in tiers:
            atlas = Image.new('RGBA', (w * t, h * t))
            for img, (x, y, bw, bh) in sources:
                atlas.paste(img.resize((bw * t, bh * t), Image.LANCZOS), (x * t, y * t))
            if post:
                atlas = post(atlas)
            out = args.output / f'{t}x' / rel
            out.parent.mkdir(parents=True, exist_ok=True)
            atlas.save(out, optimize=True)
        if tiers:
            files[rel] = tiers[-1]
    (args.output / 'manifest.json').write_text(json.dumps(dict(
        source='MK64 Reloaded (github.com/GhostlyDark/MK64-Reloaded)', tiers=list(TIERS), files=files), indent=1) + '\n')
    total = sum(1 for _ in NATIVE.rglob('*.png'))
    print(f'{len(files)} of {total} native images have HD tiers -> {args.output}')


if __name__ == '__main__':
    main()
