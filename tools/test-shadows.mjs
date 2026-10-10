// Wii 3D kart shadow test. Starts Vite, loads courses in headless Chromium with the 3D karts on (mk64wii3d), puts the
// player's kart on flat ground of every course batch layer (layer 0 base surfaces and the polygon-offset decals drawn
// over them, e.g. Mario Raceway's grass at layers 1-3) and renders it from behind with the shadow catchers on and off.
// The pixels the catchers darken are the kart's shadow. Each spot is rendered again with sub-millimetre camera
// jitter: shadow pixels that come and go between those renders are depth fights (flicker in motion); a spot with
// almost no shadow pixels has its shadow hidden under a decal.
// Usage: node tools/test-shadows.mjs [--course mario,luigi] [--spots 6] [--shots /tmp/mk64-shadows]
// Needs playwright-core (PLAYWRIGHT_CORE=/path/to/playwright-core if it is not resolvable).
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const arg = (name, def) => { const i = process.argv.indexOf(`--${name}`); return i < 0 ? def : process.argv[i + 1]; };
const courses = arg('course', 'mario,luigi,royal,moomoo,koopa').split(',');
const SPOTS = +arg('spots', 6), JITTERS = 4;
const MAX_FLICKER = 0.03, MIN_SHADOW_PX = 150;   // fraction of the spot's shadow pixels / pixels at 640x480
const shots = arg('shots');

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
  for (const id of courses) {
    const context = await browser.newContext({ viewport: { width: 640, height: 480 } });
    await context.addInitScript(() => { localStorage.setItem('mk64res', '1x'); localStorage.setItem('mk64wii3d', '1'); });
    const page = await context.newPage();
    page.on('pageerror', e => console.log(`  page error: ${e.message}`));
    await page.goto(`http://localhost:${port}/?track=${id}&char=mario`);
    await page.waitForFunction(() => window.__game?.player?.model && window.__game.track.catchers?.[0]?.visible, null, { timeout: 90000 });
    const result = await page.evaluate(({ SPOTS, JITTERS, shots }) => {
      const { track, renderer, scene, camera, player, karts } = window.__game;
      const THREE = { Vector3: camera.position.constructor };
      let sun = null;
      scene.traverse(o => { if (o.isDirectionalLight && o.castShadow) sun = o; });
      for (const k of karts) if (k !== player) k.mesh.visible = false;
      const catchers = track.catchers;
      // flat triangles of each opaque course batch, grouped by its polygon-offset layer
      const byLayer = new Map();
      const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3(), n = new THREE.Vector3();
      for (const m of track.group.children) {
        if (!m.isMesh || m.material.isShadowMaterial || m.material.transparent || m.material.alphaTest) continue;
        const layer = -(m.material.polygonOffsetFactor || 0), p = m.geometry.attributes.position;
        for (let i = 0; i < p.count; i += 3) {
          a.fromBufferAttribute(p, i); b.fromBufferAttribute(p, i + 1); c.fromBufferAttribute(p, i + 2);
          n.crossVectors(b.clone().sub(a), c.clone().sub(a));
          const area = n.length() / 2;
          if (area < 6 || n.y / (2 * area) < 0.9) continue;   // upward faces: ground, not a ceiling
          if (!byLayer.has(layer)) byLayer.set(layer, []);
          byLayer.get(layer).push({ name: m.name, area, p: a.clone().add(b).add(c).divideScalar(3) });
        }
      }
      const gl = renderer.getContext(), W = gl.drawingBufferWidth, H = gl.drawingBufferHeight;
      const read = () => { const buf = new Uint8Array(W * H * 4); gl.readPixels(0, 0, W, H, gl.RGBA, gl.UNSIGNED_BYTE, buf); return buf; };
      let seed = 7;
      const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647) - 0.5;
      const out = [];
      const pngs = [];
      let skipped = 0;   // spots with the kart out of sight
      for (const [layer, tris] of [...byLayer].sort((x, y) => x[0] - y[0])) {
        tris.sort((x, y) => y.area - x.area);
        const step = Math.max(1, Math.floor(tris.length / SPOTS));
        for (let t = 0; t < tris.length && out.filter(o => o.layer === layer).length < SPOTS; t += step) {
          const spot = tris[t];
          player.mesh.position.copy(spot.p); player.mesh.quaternion.identity(); player.mesh.updateMatrixWorld(true);
          sun.position.copy(spot.p).add(new THREE.Vector3(60, 100, 40)); sun.target.position.copy(spot.p); sun.target.updateMatrixWorld();
          const view = (yaw, jitter) => {
            const fwd = new THREE.Vector3(Math.sin(yaw), 0, Math.cos(yaw));
            camera.position.copy(spot.p).addScaledVector(fwd, -10).add(new THREE.Vector3(0, 4.2, 0));
            if (jitter) { camera.position.x += rnd() * 2e-3; camera.position.y += rnd() * 2e-3; camera.position.z += rnd() * 2e-3; }
            camera.up.set(0, 1, 0); camera.fov = 70; camera.lookAt(spot.p.clone().add(new THREE.Vector3(0, 1.6, 0)));
            camera.updateProjectionMatrix(); camera.updateMatrixWorld();
          };
          const shadow = () => {   // pixels the catchers darken; also returns the frame with them on
            for (const k of catchers) k.visible = true;
            renderer.render(scene, camera); const on = read();
            for (const k of catchers) k.visible = false;
            renderer.render(scene, camera); const off = read();
            for (const k of catchers) k.visible = true;
            const mask = new Uint8Array(W * H);
            let n = 0;
            for (let i = 0; i < W * H; i++) {
              const d = (off[i * 4] + off[i * 4 + 1] + off[i * 4 + 2]) - (on[i * 4] + on[i * 4 + 1] + on[i * 4 + 2]);
              if (d > 24) { mask[i] = 1; n++; }
            }
            return { mask, on, n };
          };
          // four sides round the kart; the one showing most shadow (the kart's body hides it from some sides)
          let best = null;
          for (let q = 0; q < 4; q++) {
            const yaw = t * 0.7 + q * Math.PI / 2;
            view(yaw, false);
            const s = shadow();
            // the kart itself in view? (a hill or wall between it and the camera hides kart and shadow alike)
            player.mesh.visible = false; renderer.render(scene, camera); const gone = read(); player.mesh.visible = true;
            let kartPx = 0;
            for (let i = 0; i < W * H; i++) if (Math.abs(gone[i * 4] - s.on[i * 4]) + Math.abs(gone[i * 4 + 1] - s.on[i * 4 + 1]) + Math.abs(gone[i * 4 + 2] - s.on[i * 4 + 2]) > 24) kartPx++;
            if (kartPx >= 300 && (!best || s.n > best.s.n)) best = { yaw, s };
          }
          if (!best) { skipped++; continue; }
          // shadow under a translucent surface (Koopa Troopa Beach's water): blended away there, not a depth problem
          let underTranslucent = false;
          if (best.s.n < 150) {
            view(best.yaw, false);
            const tr = track.group.children.filter(m => m.visible && m.material.transparent && !m.material.isShadowMaterial);
            tr.forEach(m => { m.visible = false; });
            underTranslucent = shadow().n >= 150;
            tr.forEach(m => { m.visible = true; });
          }
          const masks = [best.s.mask];
          let last = best.s.on;
          for (let j = 1; j < JITTERS; j++) { view(best.yaw, true); const s = shadow(); masks.push(s.mask); last = s.on; }
          // flicker: shadow pixels that come and go between the jittered renders, inside the shadow (all 8 neighbours
          // shadowed in some render) - the soft edge's pixels shift with any camera move and are left out
          let union = 0, inter = 0, flick = 0;
          const any = new Uint8Array(W * H);
          for (let i = 0; i < W * H; i++) { let s = 0; for (const m of masks) s += m[i]; any[i] = s ? 1 : 0; if (s) union++; if (s === masks.length) inter++; }
          for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) {
            const i = y * W + x;
            if (!any[i] || masks.every(m => m[i])) continue;
            let inside = true;
            for (let dy = -1; dy <= 1 && inside; dy++) for (let dx = -1; dx <= 1; dx++) if (!any[i + dy * W + dx]) { inside = false; break; }
            if (inside) flick++;
          }
          out.push({ layer, name: spot.name, at: spot.p.toArray().map(v => +v.toFixed(1)), shadowPx: inter, flicker: union ? flick / union : 0, underTranslucent });
          if (shots) {
            const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
            const ctx = cv.getContext('2d'), img = ctx.createImageData(W, H);
            for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
              const s = ((H - 1 - y) * W + x) * 4, d = (y * W + x) * 4, m = masks.some(k => k[s / 4]) && !masks.every(k => k[s / 4]);
              img.data[d] = m ? 255 : last[s]; img.data[d + 1] = m ? 0 : last[s + 1]; img.data[d + 2] = m ? 255 : last[s + 2]; img.data[d + 3] = 255;
            }
            ctx.putImageData(img, 0, 0); pngs.push(cv.toDataURL('image/png'));
          }
        }
      }
      return { spots: out, pngs, skipped };
    }, { SPOTS, JITTERS, shots: !!shots });
    let bad = 0;
    result.spots.forEach((s, i) => {
      const why = [];
      if (s.flicker > MAX_FLICKER) why.push(`flicker ${(s.flicker * 100).toFixed(1)}%`);
      if (s.shadowPx < MIN_SHADOW_PX && !s.underTranslucent) why.push(`shadow hidden (${s.shadowPx} px)`);
      if (why.length) bad++;
      console.log(`${id} layer ${s.layer} ${s.name} (${s.at}): shadow ${s.shadowPx} px, flicker ${(s.flicker * 100).toFixed(1)}%${s.underTranslucent ? ' (under a translucent surface)' : ''}${why.length ? '  FAIL ' + why.join(', ') : ''}`);
      if (shots) writeFileSync(`${shots}/${id}-${i}-L${s.layer}.png`, Buffer.from(result.pngs[i].split(',')[1], 'base64'));
    });
    console.log(`${id}: ${result.spots.length - bad}/${result.spots.length} spots ok (${result.skipped} skipped: kart out of sight)`);
    failures += bad;
    report.push({ id, spots: result.spots });
    await context.close();
  }
} finally {
  await browser.close();
  vite.kill();
}
if (shots) writeFileSync(`${shots}/report.json`, JSON.stringify(report, null, 1));
console.log(failures ? `FAIL: ${failures} spots` : 'PASS');
process.exit(failures ? 1 : 0);
