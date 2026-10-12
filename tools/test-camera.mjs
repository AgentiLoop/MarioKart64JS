// Chase camera vs course geometry: does the player ever see behind a wall (the "double wall" / dark void / slit of sky
// seen through a face the camera has slipped past)? Runs a race on autopilot in headless Chromium and, after every
// rendered frame, casts segments from the kart's eye (1.6 over the kart, what the camera looks at) to the camera and to
// the four corners of its near plane. A segment that crosses any drawn course triangle means part of the view starts
// behind that face. Reports the share of frames with a crossing and the worst spots. Each course is driven twice:
// "line" (the autopilot's racing line) and "hug" (every 3 s the autopilot lets go for 1.5 s while the kart is steered
// hard into the left, then the right side, so it scrapes along walls and banks).
// usage: node tools/test-camera.mjs [course ids...]   (default sherbet frappe; SECONDS=60 per course, LIMIT=% to fail
// above, default 1, SHOTS=dir for a screenshot of the worst frame, PLAYWRIGHT=path/to/playwright-core)
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const pw = process.env.PLAYWRIGHT || '/private/tmp/mk64-browser-check/node_modules/playwright-core';
const { chromium } = createRequire(import.meta.url)(pw);
const SECONDS = +(process.env.SECONDS ?? 60), LIMIT = +(process.env.LIMIT ?? 1), SHOTS = process.env.SHOTS;
const courses = process.argv.slice(2).length ? process.argv.slice(2) : ['sherbet', 'frappe'];
if (SHOTS) mkdirSync(SHOTS, { recursive: true });

const port = 7300 + Math.floor(Math.random() * 500);
const vite = spawn('npx', ['vite', '--port', String(port), '--strictPort'], { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'] });
await new Promise(r => vite.stdout.on('data', d => { if (String(d).includes('Local')) r(); }));
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--ignore-gpu-blocklist'] });

let fail = 0;
try {
  for (const id of courses) for (const mode of (process.env.MODE || 'line,hug').split(',')) {
    const page = await (await browser.newContext({ viewport: { width: 480, height: 360 } })).newPage();
    page.on('pageerror', e => console.log(`  page error: ${e.message}`));
    await page.goto(`http://localhost:${port}/?track=${id}&char=mario&mode=mario_gp&autopilot`);
    await page.waitForFunction(() => window.__game?.player && window.__game.track.group, null, { timeout: 90000 });
    await page.evaluate(mode => {
      const { track, camera, keys } = window.__game;
      if (mode === 'hug') {
        let tick = 0;
        setInterval(() => {
          const g = window.__game, ph = tick++ % 12, side = Math.floor(tick / 12) % 2 ? 'ArrowRight' : 'ArrowLeft';
          g.autopilot = ph < 6;
          keys.ArrowUp = ph >= 6; keys.ArrowLeft = ph >= 6 && side === 'ArrowLeft'; keys.ArrowRight = ph >= 6 && side === 'ArrowRight';
        }, 250);
      }
      const V = camera.position.constructor, CELL = 8, grid = new Map(), tris = [];
      track.group.updateMatrixWorld(true);
      for (const m of track.group.children) {
        if (!m.isMesh || m.material.isShadowMaterial || m.material.transparent || !m.visible) continue;
        const p = m.geometry.attributes.position, idx = m.geometry.index;
        const n = idx ? idx.count : p.count, at = i => new V().fromBufferAttribute(p, idx ? idx.getX(i) : i).applyMatrix4(m.matrixWorld);
        for (let i = 0; i < n; i += 3) {
          const t = [at(i), at(i + 1), at(i + 2), m.name], id = tris.push(t) - 1;
          const xs = t.slice(0, 3).map(v => v.x), zs = t.slice(0, 3).map(v => v.z);
          for (let cx = Math.floor(Math.min(...xs) / CELL); cx <= Math.floor(Math.max(...xs) / CELL); cx++)
            for (let cz = Math.floor(Math.min(...zs) / CELL); cz <= Math.floor(Math.max(...zs) / CELL); cz++) {
              const key = cx * 65536 + cz;
              if (!grid.has(key)) grid.set(key, []);
              grid.get(key).push(id);
            }
        }
      }
      const e1 = new V(), e2 = new V(), h = new V(), s = new V(), q = new V(), d = new V();
      const cross = (p, r) => {   // nearest crossing (0..1) of segment p -> r with a course triangle, or null
        d.subVectors(r, p);
        let best = null;
        const seen = new Set();
        for (let cx = Math.floor(Math.min(p.x, r.x) / CELL); cx <= Math.floor(Math.max(p.x, r.x) / CELL); cx++)
          for (let cz = Math.floor(Math.min(p.z, r.z) / CELL); cz <= Math.floor(Math.max(p.z, r.z) / CELL); cz++)
            for (const ti of grid.get(cx * 65536 + cz) || []) {
              if (seen.has(ti)) continue;
              seen.add(ti);
              const [a, b, c, name] = tris[ti];
              e1.subVectors(b, a); e2.subVectors(c, a); h.crossVectors(d, e2);
              const det = e1.dot(h);
              if (Math.abs(det) < 1e-9) continue;
              s.subVectors(p, a);
              const u = s.dot(h) / det;
              if (u < 0 || u > 1) continue;
              q.crossVectors(s, e1);
              const v = d.dot(q) / det;
              if (v < 0 || u + v > 1) continue;
              const k = e2.dot(q) / det;
              if (k > 0 && k < 1 && (!best || k < best.k)) {
                const nm = new V().crossVectors(e1, e2).normalize();
                best = { k, name, at: [p.x + d.x * k, p.y + d.y * k, p.z + d.z * k].map(v => +v.toFixed(1)), ny: +nm.y.toFixed(2) };
              }
            }
        return best;
      };
      const eye = new V(), corner = new V(), res = window.__cam = { frames: 0, bad: 0, worst: [] };
      const check = () => {
        requestAnimationFrame(check);
        const g = window.__game, k = g.player;
        if (g.state !== 'race' || k.rescue || k.fell || k.finished) return;
        camera.updateMatrixWorld();
        eye.copy(k.world).addScaledVector(k.up, 1.6);
        res.frames++;
        let hit = null, n = 0;
        for (const [x, y] of [[0, 0], [-1, -1], [1, -1], [-1, 1], [1, 1]]) {
          corner.set(x, y, -1).unproject(camera);
          const c = cross(eye, corner);
          if (c) { n++; hit = hit || c; }
        }
        if (!n) return;
        res.bad++;
        const pos = k.world;
        res.worst.push({ t: +g.raceTime.toFixed(2), n, mesh: hit.name, kart: [pos.x, pos.y, pos.z].map(v => +v.toFixed(1)),
          cam: [camera.position.x, camera.position.y, camera.position.z].map(v => +v.toFixed(1)), at: hit.at, ny: hit.ny });
      };
      requestAnimationFrame(check);
    }, mode);
    const t0 = Date.now();
    let shot = 0;
    while (Date.now() - t0 < SECONDS * 1000) {
      await page.waitForTimeout(1000);
      if (SHOTS) {
        const r = await page.evaluate(() => window.__cam.bad);
        if (r > shot && shot < 8) { shot = r; await page.screenshot({ path: `${SHOTS}/${id}-${mode}-${String(Date.now() - t0).padStart(6, '0')}.png` }); }
      }
    }
    const r = await page.evaluate(() => window.__cam);
    const pct = r.frames ? 100 * r.bad / r.frames : 0;
    const ok = r.frames > 0 && pct <= LIMIT;
    if (!ok) fail++;
    console.log(`${ok ? 'PASS' : 'FAIL'} ${id} ${mode}: ${r.bad}/${r.frames} frames see behind a face (${pct.toFixed(1)}%)`);
    const spots = new Map();   // one line per 4-unit spot
    for (const w of r.worst) {
      const key = w.kart.map(v => Math.round(v / 4)).join();
      if (!spots.has(key)) spots.set(key, { ...w, count: 0 });
      spots.get(key).count++;
    }
    for (const w of [...spots.values()].sort((a, b) => b.count - a.count).slice(0, 12))
      console.log(`   x${w.count} t=${w.t} kart ${w.kart} cam ${w.cam} corners ${w.n} ${w.mesh} at ${w.at} ny ${w.ny}`);
    await page.close();
  }
} finally {
  await browser.close();
  vite.kill();
}
process.exit(fail ? 1 : 0);
