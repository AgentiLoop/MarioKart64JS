// Headless graphics QC. Starts Vite, loads every course in headless Chromium at each resolution
// preset and checks:
//   - no failed requests and no console errors
//   - every course texture loaded, at the HD tier the manifest promises (or the ROM image)
//   - no texture in the scene (course, props, karts, items) samples with nearest filtering in an HD preset
//   - z-fighting: renders an ID buffer (one flat colour per course batch, alpha-tested cutouts kept)
//     from cameras along the route, then again with sub-millimetre camera jitter. Pixels inside a
//     surface whose batch changes between those renders are depth fights (flicker in motion).
// Usage: node tools/qc-graphics.mjs [--course mario] [--presets 1x,4x] [--shots /tmp/mk64-qc] [--double-sided]
//   --double-sided renders every batch DoubleSide (the old behaviour) to show what the check catches.
// Needs playwright-core (PLAYWRIGHT_CORE=/path/to/playwright-core if it is not resolvable) and its
// Chromium headless shell.
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const arg = (name, def) => { const i = process.argv.indexOf(`--${name}`); return i < 0 ? def : process.argv[i + 1]; };
const COURSES = ['luigi', 'moomoo', 'koopa', 'kalimari', 'toad', 'frappe', 'choco', 'mario', 'wario', 'sherbet',
  'royal', 'bowser', 'dk', 'yoshi', 'banshee', 'rainbow'];
const courses = arg('course') ? arg('course').split(',') : COURSES;
const presets = arg('presets', '1x,4x').split(',');
const shots = arg('shots');
const doubleSided = process.argv.includes('--double-sided');
const VIEWS = 24, JITTERS = 4, MAX_FLICKER = 0.0005;   // fraction of rendered surface pixels

const { chromium } = await import(process.env.PLAYWRIGHT_CORE || 'playwright-core');
const port = 5300 + Math.floor(Math.random() * 500);
const vite = spawn('npx', ['vite', '--port', String(port), '--strictPort'], { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'] });
await new Promise((resolve, reject) => {
  vite.stdout.on('data', d => { if (String(d).includes('Local')) resolve(); });
  vite.on('exit', code => reject(new Error(`vite exited ${code}`)));
});
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
if (shots) mkdirSync(shots, { recursive: true });

let failures = 0;
const report = [];
try {
  for (const preset of presets) for (const id of courses) {
    const context = await browser.newContext({ viewport: { width: 1280, height: 960 } });
    await context.addInitScript(p => localStorage.setItem('mk64res', p), preset);
    const page = await context.newPage();
    const problems = [];
    page.on('console', m => { if (m.type() === 'error') problems.push(`console: ${m.text()}`); });
    page.on('pageerror', e => problems.push(`page error: ${e.message}`));
    page.on('requestfailed', r => problems.push(`request failed: ${r.url()}`));
    page.on('response', r => { if (r.status() >= 400) problems.push(`HTTP ${r.status()}: ${r.url()}`); });
    await page.goto(`http://localhost:${port}/?track=${id}&char=mario`);
    await page.waitForFunction(() => window.__game?.track, null, { timeout: 60000 });
    // every texture loaded at the tier hd.js chose (tex.userData.hd.url is the requested image)
    await page.waitForFunction(() => {
      const maps = [];
      window.__game.scene.traverse(o => { if (o.material?.map?.userData?.hd) maps.push(o.material.map); });
      return maps.length && maps.every(t => t.image?.complete && t.image.naturalWidth && t.image.src.endsWith(t.userData.hd.url));
    }, null, { timeout: 60000 }).catch(() => problems.push('textures did not finish loading'));
    const manifest = await page.evaluate(() => fetch('/mk64-hd/manifest.json').then(r => (r.ok ? r.json() : { files: {} })));
    const result = await page.evaluate(({ manifest, VIEWS, JITTERS, doubleSided }) => {
      const { track, items, renderer, scene, camera } = window.__game;
      const out = { textures: [], flicker: {}, flickerPx: 0, surfacePx: 0 };
      // texture tiers
      const tier = { '1x': 1, '2x': 2, '4x': 4 }[localStorage.getItem('mk64res')] ?? 4;
      scene.traverse(o => {
        const t = o.material?.map, hd = t?.userData?.hd;
        if (!hd) return;
        const want = Math.min(tier, manifest.files[hd.rel] || 1);
        if (hd.scale !== want) out.textures.push(`${hd.rel}: tier ${hd.scale}, expected ${want}`);
        else if (!t.image.naturalWidth) out.textures.push(`${hd.rel}: empty image`);
      });
      // pixelation: in HD presets nothing in the scene may sample with nearest filtering
      if (tier > 1) {
        const seen = new Set();
        scene.traverse(o => {
          for (const m of [].concat(o.material || [])) for (const k of ['map', 'alphaMap', 'emissiveMap']) {
            const t = m[k];
            if (!t || seen.has(t)) continue;
            seen.add(t);
            if (t.magFilter === 1003 || t.minFilter === 1003)   // THREE.NearestFilter
              out.textures.push(`${t.userData?.hd?.rel || t.name || t.constructor.name} on ${o.name || o.parent?.name || o.type}: nearest filtering in an HD preset`);
          }
        });
      }
      // ID pass: course batches (translucent ones too, written like opaque) + the item boxes' opaque
      // "?" cards, flat colours, linear output so colours are exact
      const batches = [];
      const saved = [];
      scene.traverse(o => { if (o.isMesh || o.isSprite || o.isPoints || o.isLine) saved.push([o, o.visible, o.material]); });
      const keep = new Set();
      track.group.traverse(o => { if (o.isMesh) keep.add(o); });
      items.group.traverse(o => { if (o.isMesh && !o.material.transparent) keep.add(o); });
      for (const [o] of saved) {
        o.visible = keep.has(o);
        if (!keep.has(o)) continue;
        // visible ancestors
        for (let p = o.parent; p; p = p.parent) p.visible = true;
        const n = batches.push(o.name || o.parent?.name || 'item-box');
        const m = o.material.clone();
        m.color.setRGB((n & 255) / 255, ((n >> 8) & 255) / 255, 0);
        m.vertexColors = false; m.fog = false; m.toneMapped = false; m.transparent = false; m.depthWrite = true;
        if (doubleSided) m.side = 2;
        m.onBeforeCompile = s => {   // keep map alpha for the alpha test, then output the flat ID
          s.fragmentShader = s.fragmentShader.replace('#include <alphatest_fragment>', '#include <alphatest_fragment>\ndiffuseColor.rgb = diffuse;');
        };
        m.customProgramCacheKey = () => 'qc-id';
        o.material = m;
      }
      const bg = scene.background, cs = renderer.outputColorSpace, cam = camera.clone();
      scene.background = null;
      renderer.outputColorSpace = 'srgb-linear';
      renderer.setClearColor(0x000000, 1);
      const gl = renderer.getContext(), W = gl.drawingBufferWidth, H = gl.drawingBufferHeight;
      const read = () => { const b = new Uint8Array(W * H * 4); gl.readPixels(0, 0, W, H, gl.RGBA, gl.UNSIGNED_BYTE, b); return b; };
      const idAt = (b, i) => b[i * 4] | (b[i * 4 + 1] << 8);
      const f = { pos: camera.position.clone(), T: camera.position.clone(), U: camera.position.clone(), R: camera.position.clone(), k: 0 };
      const look = camera.position.clone();
      let seed = 1;
      const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647) - 0.5;
      const shoot = (s, yaw, jitter) => {
        track.frameAt(s, f);
        const fwd = f.T.clone().applyAxisAngle(f.U, yaw);
        camera.position.copy(f.pos).addScaledVector(fwd, -10).addScaledVector(f.U, 4.2);
        look.copy(f.pos).addScaledVector(f.U, 1.6).addScaledVector(fwd, 6);
        if (jitter) { camera.position.x += rnd() * 2e-3; camera.position.y += rnd() * 2e-3; camera.position.z += rnd() * 2e-3; }
        camera.up.copy(f.U); camera.fov = 70; camera.lookAt(look); camera.updateProjectionMatrix(); camera.updateMatrixWorld();
        renderer.render(scene, camera);
        return read();
      };
      for (let v = 0; v < VIEWS; v++) {
        const s = (v / VIEWS) * track.length, yaw = [0, 0.6, -0.6][v % 3];
        const base = shoot(s, yaw, false);
        const interior = new Uint8Array(W * H);
        for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) {
          const i = y * W + x, id = idAt(base, i);
          if (!id) continue;
          let same = true;
          for (let dy = -1; dy <= 1 && same; dy++) for (let dx = -1; dx <= 1; dx++) if (idAt(base, i + dy * W + dx) !== id) { same = false; break; }
          if (same) { interior[i] = 1; out.surfacePx++; }
        }
        for (let j = 0; j < JITTERS; j++) {
          const b = shoot(s, yaw, true);
          for (let i = 0; i < W * H; i++) {
            if (!interior[i]) continue;
            const a = idAt(base, i), c = idAt(b, i);
            if (a === c) continue;
            out.flickerPx++;
            const key = [batches[a - 1], c ? batches[c - 1] : 'sky'].sort().join(' / ');
            out.flicker[key] = (out.flicker[key] || 0) + 1;
          }
        }
      }
      // restore the game's own rendering
      for (const [o, vis, mat] of saved) { o.visible = vis; o.material = mat; }
      scene.background = bg; renderer.outputColorSpace = cs;
      camera.position.copy(cam.position); camera.quaternion.copy(cam.quaternion); camera.up.copy(cam.up);
      camera.fov = cam.fov; camera.updateProjectionMatrix();
      out.flickerPx /= JITTERS;
      out.size = [W, H];
      return out;
    }, { manifest, VIEWS, JITTERS, doubleSided });
    if (shots) await page.screenshot({ path: `${shots}/${id}-${preset}.png` });
    const rate = result.flickerPx / Math.max(1, result.surfacePx);
    const ok = !problems.length && !result.textures.length && rate <= MAX_FLICKER;
    if (!ok) failures++;
    const top = Object.entries(result.flicker).sort((a, b) => b[1] - a[1]).slice(0, 4).map(([k, n]) => `${k} ${Math.round(n / JITTERS)}px`);
    console.log(`${ok ? 'ok  ' : 'FAIL'} ${id.padEnd(9)} ${preset.padEnd(3)} ${result.size.join('x').padEnd(9)} flicker ${(rate * 1e4).toFixed(2)}‱` +
      `${top.length ? `  [${top.join(', ')}]` : ''}`);
    for (const p of [...problems, ...result.textures]) console.log(`       ${p}`);
    report.push({ id, preset, ...result, problems, rate });
    await context.close();
  }
} finally {
  await browser.close();
  vite.kill();
}
if (shots) writeFileSync(`${shots}/report.json`, JSON.stringify(report, null, 1));
console.log(failures ? `${failures} failing course/preset runs` : 'all clean');
process.exit(failures ? 1 : 0);
