// Renders the 3D title scene (src/title3d.js, Digit3 on the title) once in headless Chrome and writes the three menu
// stills public/title3d/background_{main_menu,course_select,player_select}.png: the frame tinted exactly as MK64 tints
// background_blue_sky for its menus (menu_items.c convert_img_to_greyscale(0, 0x19) + adjust_img_colour with
// gBackgroundColor {ff,af,af} / {af,af,ff} / {af,ff,af}, see tools/extract-menu-backgrounds.py).
// Usage: npx vite (dev server on :5173) then  node tools/render-title3d-stills.mjs [--out public/title3d] [--url http://localhost:5173/]
// PLAYWRIGHT_CORE=<path to playwright-core index.mjs> if it is not installed next to the repo.
import { createRequire } from 'module';
import { mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';

const argv = process.argv.slice(2);
const opt = (name, dflt) => { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : dflt; };
const out = opt('--out', 'public/title3d'), url = opt('--url', 'http://localhost:5173/');
const corePath = process.env.PLAYWRIGHT_CORE || '/private/tmp/mk64-browser-check/node_modules/playwright-core/index.mjs';
const { chromium } = await import(corePath).catch(() => createRequire(import.meta.url)('playwright-core'));

const TINTS = { background_main_menu: [0xFF, 0xAF, 0xAF], background_player_select: [0xAF, 0xFF, 0xAF], background_course_select: [0xAF, 0xAF, 0xFF] };

const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 960 } });
page.on('pageerror', e => console.log('[pageerror]', e.message));
await page.goto(url);
await page.waitForTimeout(3000);
for (let i = 0; i < 6 && !await page.evaluate(() => !!window.__title3d); i++) {
  await page.keyboard.press('Digit3');
  await page.waitForTimeout(2500);
}
if (!await page.evaluate(() => !!window.__title3d)) { console.error('3D title did not start'); process.exit(1); }
// all five Wii karts loaded (buildWiiKart is async)
await page.waitForFunction(() => window.__title3d.karts.every(k => k.userData.model), null, { timeout: 60000 });
await page.waitForTimeout(1500);

// one frame rendered and read back in the same task (the drawing buffer is not preserved across tasks), then tinted
const frames = await page.evaluate((tints) => {
  const c = document.getElementById('title3d'), t3d = window.__title3d;
  const px = Math.min(innerWidth / 320, innerHeight / 240) * devicePixelRatio;
  const w = Math.round(320 * px), h = Math.round(240 * px);
  t3d.step(performance.now(), w, h);
  const src = document.createElement('canvas'); src.width = w; src.height = h;
  const g = src.getContext('2d'); g.drawImage(c, 0, 0);
  const img = g.getImageData(0, 0, w, h), d = img.data;
  // convert_img_to_greyscale: sp48[i] = pow(i / 32, 0x19 * 1.5 / 256 + 0.25) on 5-bit luma
  const table = Array.from({ length: 32 }, (_, i) => Math.pow(i / 32, 0x19 * 1.5 / 256 + 0.25));
  const q = v => Math.round(v * 31 / 255), e = v => Math.round(v * 255 / 31);
  const result = {};
  for (const [name, [cr, cg, cb]] of Object.entries(tints)) {
    const o = document.createElement('canvas'); o.width = w; o.height = h;
    const og = o.getContext('2d'), oi = og.createImageData(w, h), od = oi.data;
    for (let i = 0; i < d.length; i += 4) {
      const r = q(d[i]), gg = q(d[i + 1]), b = q(d[i + 2]);
      const luma = (r * 0x55 + gg * 0x4B + b * 0x5F) >> 8;
      const grey = Math.min(31, Math.floor(table[luma] * 32));
      const t = (grey * 0x4D + grey * 0x96 + grey * 0x1D) >> 8;   // adjust_img_colour, == grey for r == g == b
      od[i] = e((t * cr) >> 8); od[i + 1] = e((t * cg) >> 8); od[i + 2] = e((t * cb) >> 8); od[i + 3] = 255;
    }
    og.putImageData(oi, 0, 0);
    result[name] = o.toDataURL('image/png');
  }
  return { w, h, result };
}, TINTS);
await browser.close();

mkdirSync(out, { recursive: true });
for (const [name, dataUrl] of Object.entries(frames.result)) {
  const file = join(out, `${name}.png`);
  writeFileSync(file, Buffer.from(dataUrl.split(',')[1], 'base64'));
  console.log(`${file}: ${frames.w}x${frames.h}`);
}
