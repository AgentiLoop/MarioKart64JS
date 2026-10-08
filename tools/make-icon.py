#!/usr/bin/env python3
"""MK64JS app icon, shared by every desktop build (Electron Windows / Linux, the macOS WebKit app).

Draws desktop/icon/MK64JS.png (1024x1024: a rounded red tile with a checkered-flag band, "MK64" in Arial Black
with a black outline and a yellow "JS" plate) and derives the platform icons from it:
  desktop/build/icon.png      electron-builder (Linux png set, Windows .ico)
  desktop/webkit/MK64JS.icns  the WebKit app (iconutil)
Usage: python3 tools/make-icon.py
"""
import pathlib, subprocess, tempfile
from PIL import Image, ImageDraw, ImageFilter, ImageFont

ROOT = pathlib.Path(__file__).resolve().parent.parent / 'desktop'
S = 1024
FONT = '/System/Library/Fonts/Supplemental/Arial Black.ttf'
RED, DARK_RED, YELLOW, BLACK, WHITE = (227, 34, 29), (150, 12, 16), (255, 210, 58), (18, 14, 14), (255, 255, 255)


def rounded_mask(size, radius):
    m = Image.new('L', (size, size), 0)
    ImageDraw.Draw(m).rounded_rectangle([0, 0, size - 1, size - 1], radius=radius, fill=255)
    return m


def main():
    img = Image.new('RGBA', (S, S), (0, 0, 0, 0))
    # tile: vertical red gradient
    tile = Image.new('RGBA', (S, S))
    px = tile.load()
    for y in range(S):
        t = y / (S - 1)
        c = tuple(int(RED[i] * (1 - t) + DARK_RED[i] * t) for i in range(3))
        for x in range(S):
            px[x, y] = c + (255,)
    # checkered band across the lower third, slanted like a finish line
    band = Image.new('RGBA', (S, S), (0, 0, 0, 0))
    bd = ImageDraw.Draw(band)
    sq = 64
    for row in range(3):
        for col in range(-2, S // sq + 4):
            if (row + col) % 2 == 0:
                x0 = col * sq - row * 20 + 40
                y0 = 690 + row * sq
                bd.polygon([(x0, y0), (x0 + sq, y0), (x0 + sq - 20, y0 + sq), (x0 - 20, y0 + sq)], fill=WHITE)
    bd.rectangle([0, 690 - 14, S, 690], fill=BLACK)
    bd.rectangle([0, 690 + 3 * sq, S, 690 + 3 * sq + 14], fill=BLACK)
    tile.alpha_composite(band)
    # soft top highlight
    hl = Image.new('RGBA', (S, S), (0, 0, 0, 0))
    ImageDraw.Draw(hl).ellipse([-200, -500, S + 200, 420], fill=(255, 255, 255, 46))
    tile.alpha_composite(hl.filter(ImageFilter.GaussianBlur(40)))
    tile.putalpha(rounded_mask(S, 230))
    img.alpha_composite(tile)

    d = ImageDraw.Draw(img)
    # "MK64": white on black outline, slight drop shadow
    f = ImageFont.truetype(FONT, 330)
    text = 'MK64'
    w = d.textlength(text, font=f)
    x, y = (S - w) / 2, 180
    shadow = Image.new('RGBA', (S, S), (0, 0, 0, 0))
    ImageDraw.Draw(shadow).text((x + 10, y + 18), text, font=f, fill=(0, 0, 0, 160), stroke_width=22, stroke_fill=(0, 0, 0, 160))
    img.alpha_composite(shadow.filter(ImageFilter.GaussianBlur(10)))
    d.text((x, y), text, font=f, fill=WHITE, stroke_width=22, stroke_fill=BLACK)
    # "JS" plate, bottom right, the JS-logo yellow square
    ps = 300
    plate = Image.new('RGBA', (ps, ps), (0, 0, 0, 0))
    ImageDraw.Draw(plate).rounded_rectangle([0, 0, ps - 1, ps - 1], radius=48, fill=YELLOW, outline=BLACK, width=14)
    pf = ImageFont.truetype(FONT, 190)
    pd = ImageDraw.Draw(plate)
    pw = pd.textlength('JS', font=pf)
    pd.text(((ps - pw) / 2, 38), 'JS', font=pf, fill=BLACK)
    plate = plate.rotate(-8, resample=Image.BICUBIC, expand=True)
    img.alpha_composite(plate, (S - plate.width - 40, S - plate.height - 40))

    out = ROOT / 'icon'
    out.mkdir(exist_ok=True)
    master = out / 'MK64JS.png'
    img.save(master)
    (ROOT / 'build').mkdir(exist_ok=True)
    img.save(ROOT / 'build' / 'icon.png')
    # macOS .icns: the Apple icon grid leaves a margin round the tile
    with tempfile.TemporaryDirectory() as td:
        iconset = pathlib.Path(td) / 'MK64JS.iconset'
        iconset.mkdir()
        for size in (16, 32, 128, 256, 512):
            for scale in (1, 2):
                n = size * scale
                canvas = Image.new('RGBA', (n, n), (0, 0, 0, 0))
                inner = round(n * 0.86)
                canvas.alpha_composite(img.resize((inner, inner), Image.LANCZOS), ((n - inner) // 2, (n - inner) // 2))
                canvas.save(iconset / f'icon_{size}x{size}{"@2x" if scale == 2 else ""}.png')
        subprocess.run(['iconutil', '-c', 'icns', str(iconset), '-o', str(ROOT / 'webkit' / 'MK64JS.icns')], check=True)
    print(f'{master}, desktop/build/icon.png, desktop/webkit/MK64JS.icns')


if __name__ == '__main__':
    main()
