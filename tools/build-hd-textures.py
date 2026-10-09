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

from PIL import Image, ImageChops

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


def right_bevel(img, rel):
    """The HD pack's cup icons end in black where the native 65x40 ones have the grey right bevel column
    (like the course title plates), and its MAP/GAME SELECT banners only have a thin bevel with a stubby
    corner: paste the native last column and bottom row back, nearest-scaled to this tier, then cut the
    top-right and bottom-left corner pixels into 45-degree diagonals like the HD title plates."""
    native = Image.open(NATIVE / rel).convert('RGBA')
    t = img.width // native.width
    w, h = img.size
    col = native.crop((native.width - 1, 1, native.width, native.height))
    row = native.crop((1, native.height - 1, native.width, native.height))
    col.putpixel((0, 0), col.getpixel((0, 1)))     # banners anti-alias their 1px corner: use the full grey
    row.putpixel((0, 0), row.getpixel((1, 0)))
    img.paste(col.resize((t, (native.height - 1) * t), Image.NEAREST), (w - t, t))
    img.paste(row.resize(((native.width - 1) * t, t), Image.NEAREST), (t, h - t))
    black, grey = native.getpixel((0, 0)), col.getpixel((0, 0))
    for i in range(t):
        for j in range(t):
            img.putpixel((w - t + i, j), grey if i + j >= t - 1 else black)        # top-right
            img.putpixel((i, h - t + j), grey if i + j >= t - 1 else black)        # bottom-left
    return img


# The pack's Mario/Royal Raceway asphalt (and its finish line) darkens from 116 at the centre to 61 by the
# kerb stripe and greys the stripe itself, where the ROM texture is flat. These are mirror-wrapped across
# the road and the courses lay patches of the same texture over it at other UVs (layer batches), so the
# gradient shows as lighter/darker rectangles around the lane dashes. Keep the HD grain but put back the
# native shading: add the per-texel native - box-downscaled difference, bilinear-upscaled to the tier.
NATIVE_SHADING = {'common/gTextureRoad0.png', 'common/gTextureRoadFinish0.png'}


def native_shading(img, rel):
    native = Image.open(NATIVE / rel).convert('RGBA')
    small = img.resize(native.size, Image.BOX)
    bands = []
    for c in range(3):
        diff = Image.new('L', native.size)
        diff.putdata([max(0, min(255, 128 + a - b)) for a, b in
                      zip(native.getchannel(c).get_flattened_data(), small.getchannel(c).get_flattened_data())])
        bands.append(ImageChops.add(img.getchannel(c), diff.resize(img.size, Image.BILINEAR), 1.0, -128))
    return Image.merge('RGBA', bands + [img.getchannel('A')])


# mean |native - downscaled HD| over RGBA (colour weighted by alpha), 0-255. The pack repaints a lot (cows,
# crabs, neon glow: 20-36 for the right name), so this only picks among guesses and drops unrelated images.
MAX_DIFF = 40
RENAMES = (('CrossingSignal', 'CrossingSign'), ('Chasis', 'Chassis'), ('TankerBumper', 'TankerTruckBumper'),
           ('TankerFront', 'TankerTruckFront'), ('TankerHeadlights', 'TankerTruckHeadlights'),
           ('TankerStripe', 'TankerTruckStripe'), ('TankerWindshield', 'TankerTruckWindshield'))
EXTRA_NAMES = {   # native image -> SpaghettiKart names the guesses below miss
    'mario-raceway/prop-gTextureMarioRacewaySignLeft.png': ['tracks/mario_raceway/mario_raceway_data/d_course_mario_sign_left'],
    'mario-raceway/prop-gTextureMarioRacewaySignRight.png': ['tracks/mario_raceway/mario_raceway_data/d_course_mario_sign_right'],
    'bowsers-castle/foliage-gTextureShrub.png': ['other_textures/shrub'],
    'rainbow-road/chomp-eye.png': ['tracks/rainbow_road/rainbow_road_data/d_course_rainbow_road_chain_chomp_eye'],
    'rainbow-road/chomp-tongue.png': ['tracks/rainbow_road/rainbow_road_data/d_course_rainbow_road_chain_chomp_tongue'],
}


def snake(s):
    return re.sub(r'(?<=[a-z0-9])(?=[A-Z])|(?<=[A-Z])(?=[A-Z][a-z])', '_', s).lower()


def camel(s):
    return ''.join(w[:1].upper() + w[1:] for w in re.split(r'[-_]', s))


def name_candidates(rel):
    folder, stem = rel.split('/')[0], Path(rel).stem
    sk = folder.replace('-', '_')
    data = f'tracks/{sk}/{sk}_data/'
    out = list(EXTRA_NAMES.get(rel, []))
    sym = re.sub(r'^(prop|foliage|yoshi-egg)-', '', stem)
    out += [f'other_textures/{sym}', data + sym, f'common_data/common_texture_{stem.replace("-", "_")}',
            data + f'd_course_{sk}_{stem.replace("-", "_")}']
    hexname = re.fullmatch(r'g[A-Z]*Texture([0-9A-F]{6})', sym)
    if hexname:
        out.append(f'other_textures/texture_{hexname.group(1)}')
    if sym.startswith('gTexture'):
        rest = sym[len('gTexture'):]
        for a, b in RENAMES:
            rest = rest.replace(a, b)
        rest = rest[len(camel(sk)):] if rest.startswith(camel(sk)) else rest
        out += [data + f'd_course_{sk}_{snake(rest)}', data + f'd_course_{snake(rest)}']
    # frames: crab-1 -> gTextureCrab1, piranha-1 -> gTexturePiranhaPlant1; neon-mario-0 (TLUT 1) -> ..._neon_mario1
    frame = re.fullmatch(r'([a-z-]+?)-(\d+)', stem)
    base, n = (frame.group(1), int(frame.group(2)) + stem.startswith('neon-')) if frame else (stem, '')
    out += [data + f'gTexture{camel(base)}{n}', f'other_textures/gTexture{camel(base)}Plant{n}',
            data + f'gTexture{camel(sk)}{camel(base)}{n}', data + f'd_course_{sk}_{base.replace("-", "_")}{n}']
    return out


def likeness(native, hd_path):
    """Mean RGBA difference between the native image and the HD one box-downscaled to native size;
    None when the aspect ratio differs (atlas, other crop) or the HD image isn't at least 2x."""
    hd = Image.open(hd_path)
    w, h = native.size
    if hd.width * h != hd.height * w or hd.width < 2 * w:
        return None
    small = hd.convert('RGBA').resize((w, h), Image.BOX)
    total = 0
    for (r, g, b, a), (R, G, B, A) in zip(native.get_flattened_data(), small.get_flattened_data()):
        total += abs(a - A) + (abs(r - R) + abs(g - G) + abs(b - B)) * max(a, A) / 255 / 3
    return total / (w * h) / 2


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
            rel = tex['image'] if tex['image'].startswith('common/') else f'{course}/{tex["image"]}'
            img = Image.open(NATIVE / rel).convert('RGBA')
            fmt = tex.get('format', 'rgba16')
            single(rel, pack.by_texels(texels16(img, fmt), *img.size, 3 if fmt == 'ia16' else 0, 2),
                   post=(lambda img, rel=rel: native_shading(img, rel)) if rel in NATIVE_SHADING else None)

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
    # Lakitu animations (extract-lakitu.py): atlases of other_textures/gTextureLakitu* frames, `columns` per row
    lakitu = json.loads((NATIVE / 'lakitu' / 'manifest.json').read_text())
    for info in lakitu['anims'].values():
        fw, fh, cols = info['frameWidth'], info['frameHeight'], lakitu['columns']
        parts = [(named(f'other_textures/{s}'), (n % cols * fw, n // cols * fh, fw, fh), False)
                 for n, s in enumerate(info['symbols'])]
        if all(p for p, _, _ in parts):
            jobs[f'lakitu/{info["image"]}'] = (Image.open(NATIVE / 'lakitu' / info['image']).size, parts, 4, None)
        else:
            print(f'  incomplete HD frames: lakitu/{info["image"]}')
    # item window icons: CI8 40x32, by decomp name (gItemWindowTextures order, see extract-item-window.py)
    for path in sorted((NATIVE / 'item-window').glob('*.png')):
        single(f'item-window/{path.name}', named(f'common_data/common_texture_item_window_{path.stem[3:]}'))
    # exhaust smoke: 3 stacked 32x32 I8 frames (matched by CRC); native pixels are the intensity in RGBA
    img = Image.open(NATIVE / 'particles' / 'smoke.png').convert('RGBA')
    parts = [(pack.by_texels(img.crop((0, y, 32, y + 32)).getchannel('A').tobytes(), 32, 32, 4, 1), (0, y, 32, 32), False)
             for y in range(0, img.height, 32)]
    if all(p for p, _, _ in parts):
        jobs['particles/smoke.png'] = (img.size, parts, 4, lambda a: Image.merge('RGBA', [a.getchannel('A')] * 4))
    else:
        print('  incomplete HD frames: particles/smoke.png')
    # item atlases (extract-items.py), frame by frame; each frame keeps the closest of its candidates.
    # Shells: eight 32x32 CI8 spin frames side by side = the pack's Projectiles/<Colour> Shell/1..8 (frames 5 and 6
    # vary by CRC in the ROM: the base folders hold every variant, the exact CRC sits under Hacks/DX).
    # Balloon: gTextureBalloon1 over 2 (64x32 CI8); explosion: lightning_zap_0 | 1 (32x64 IA8) side by side.
    def frames(rel, boxes):
        native = Image.open(NATIVE / rel).convert('RGBA')
        parts = []
        for box, candidates in boxes:
            x, y, bw, bh = box
            crop = native.crop((x, y, x + bw, y + bh))
            scored = sorted((s, str(p)) for p in candidates if p and (s := likeness(crop, p)) is not None)
            if not scored or scored[0][0] > MAX_DIFF:
                print(f'  incomplete HD frames: {rel}')
                return
            parts.append((Path(scored[0][1]), box, False))
        jobs[rel] = (native.size, parts, 4, None)
    for colour in ('green', 'red', 'blue'):
        dirs = [pack.base / 'Projectiles', pack.base / 'Hacks' / 'DX' / 'Projectiles']
        frames(f'items/{colour}-shell.png', [((n * 32, 0, 32, 32), [p for d in dirs for p in
                                              (d / f'{colour.title()} Shell' / str(n + 1)).glob('*.png')]) for n in range(8)])
    frames('items/balloon.png', [((0, 0, 64, 32), [named('other_textures/gTextureBalloon1')]),
                                 ((0, 32, 64, 32), [named('other_textures/gTextureBalloon2')])])
    frames('items/explosion.png', [((0, 0, 32, 64), [named('other_textures/lightning_zap_0')]),
                                   ((32, 0, 32, 64), [named('other_textures/lightning_zap_1')])])

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
    single('courseselect/map_select.png', named('texture_tkmk00/gTextureMapSelect'),
           post=lambda img: right_bevel(img, 'courseselect/map_select.png'))
    for cup in ('mushroom', 'flower', 'star', 'special'):
        single(f'courseselect/cup_{cup}.png', named(f'texture_tkmk00/gTextureMenu{cup.title()}Cup'),
               post=lambda img, rel=f'courseselect/cup_{cup}.png': right_bevel(img, rel))
    single('charselect/player_select_banner.png', named('texture_tkmk00/texture_player_select'))
    single('charselect/ok.png', named('texture_tkmk00/texture_ok'))
    for driver in ('mario', 'luigi', 'peach', 'toad', 'yoshi', 'donkeykong', 'wario', 'bowser'):
        single(f'charselect/name_{driver}.png', named(f'texture_tkmk00/texture_name_{"dk" if driver == "donkeykong" else driver}'))
    for border in ('p1_border_blue', 'p2_border_red', 'p3_border_orange', 'p4_border_green'):
        single(f'charselect/{border}.png', named(f'player_selection/{border}'))
    for name in ('game_select', 'menu_1p_game', 'menu_2p_game', 'menu_3p_game', 'menu_4p_game', 'mode_mario_gp',
                 'mode_time_trials', 'mode_vs', 'mode_battle', 'l_option', 'r_data', '50cc', '100cc', '150cc', 'extra'):
        single(f'mainmenu/{name}.png', named(f'texture_tkmk00/texture_{name}'),
               post=(lambda img, rel=f'mainmenu/{name}.png': right_bevel(img, rel))
               if name == 'game_select' or name.endswith('p_game') else None)
    single('mainmenu/small_green_triangle.png', named('player_selection/texture_small_green_triangle'))

    # everything else (props, foliage, signs, actors, neon, course textures the CRC missed): by guessed
    # decomp name, keeping the candidate whose downscaled pixels look most like the native image
    for path in sorted(NATIVE.rglob('*.png')):
        rel = str(path.relative_to(NATIVE))
        if rel in jobs:
            continue
        native = Image.open(path).convert('RGBA')
        scored = []
        for name in dict.fromkeys(name_candidates(rel)):
            hd = named(name)
            if hd:
                score = likeness(native, hd)
                if score is not None:
                    scored.append((score, name, hd))
        if scored:
            score, name, hd = min(scored)
            if score <= MAX_DIFF:
                single(rel, hd)
            print(f'  {"named" if score <= MAX_DIFF else "REJECTED"} {rel} <- {name} (diff {score:.1f})')
        if rel in jobs:
            continue
        # no name: the same RGBA16 / IA16 texels by CRC anywhere in the pack (boat sign, jungle trees,
        # Koopa palms, locomotive, chomp metal/gold, Lakitu's ice), kept even where the pack repaints them
        for fmt, code in (('rgba16', 0), ('ia16', 3)):
            hd = pack.by_texels(texels16(native, fmt), *native.size, code, 2)
            if hd:
                single(rel, hd)
                print(f'  crc {rel} <- {hd.relative_to(pack.base)}')
                break

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
