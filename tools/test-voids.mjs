// See-through holes in the course: does the player ever see the sky below the horizon where the course should be (a
// "small dark void" / slit between faces, a missing face, a crack along a wall's foot)? Below the horizon MK64's skybox
// is drawn behind the course (Frappe Snowland: blue fading to black), so any of it on screen is a hole in the course.
// Runs a race on autopilot in headless Chrome and draws every 4th frame twice, the below-horizon sky magenta then
// yellow (above it cyan then blue), so the pixels that go from one key colour to the other are sky; a hole is a
// below-horizon sky region walled in by course pixels with course faces within NEAR around it, not seen through a
// cut-out texture (fences, leaves) and not touching the above-horizon sky or a screen edge. Driven twice, like
// tools/test-camera.mjs: "line" (racing line) and "hug" (every 3 s the kart is steered hard into the left, then the
// right side for 1.5 s). Banshee Boardwalk and Rainbow Road are built over the void and show the sky between their
// rails by design (MK64 too): they fail.
// usage: node tools/test-voids.mjs [course ids...]   (default sherbet frappe; SECONDS=60 per course, MODE=line,hug,
// PX=pixels a hole needs (default 3), NEAR=how far the course around it may be (default 60; Toad's Turnpike shows the
// sky 75-120 away between its roads), LIMIT=% of frames to fail above (default 1), SHOTS=dir)
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const pw = process.env.PLAYWRIGHT || '/private/tmp/mk64-browser-check/node_modules/playwright-core';
const { chromium } = createRequire(import.meta.url)(pw);
const SECONDS = +(process.env.SECONDS ?? 60), LIMIT = +(process.env.LIMIT ?? 1), PX = +(process.env.PX ?? 3), NEAR = +(process.env.NEAR ?? 60), SHOTS = process.env.SHOTS;
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
    const ok0 = await page.evaluate(([mode, PX, NEAR]) => {
      const { scene, renderer, camera, keys, track } = window.__game;
      const sky = scene.children.find(m => m.isMesh && m.renderOrder === -1000 && m.material.uniforms?.below);
      if (!sky) return false;
      const u = sky.material.uniforms;
      u.below.value.set(1, 0, 1); u.bottom.value.set(1, 0, 1); u.top.value.set(0, 1, 1); u.hor.value.set(0, 1, 1);
      if (mode === 'hug') {
        let tick = 0;
        setInterval(() => {
          const g = window.__game, ph = tick++ % 12, side = Math.floor(tick / 12) % 2 ? 'ArrowRight' : 'ArrowLeft';
          g.autopilot = ph < 6;
          keys.ArrowUp = ph >= 6; keys.ArrowLeft = ph >= 6 && side === 'ArrowLeft'; keys.ArrowRight = ph >= 6 && side === 'ArrowRight';
        }, 250);
      }
      const gl = renderer.getContext(), res = window.__voids = { frames: 0, bad: 0, worst: [] };
      const V = camera.position.constructor, o = new V(), d = new V();
      const ray = (w, h, x, y) => d.set(2 * (x + 0.5) / w - 1, 2 * (y + 0.5) / h - 1, 0.5).unproject(camera).sub(o).normalize();
      // every course triangle, tagged with its mesh name and whether its texture has cut-out (alpha) texels
      const CELL = 8, grid = new Map(), tris = [];
      track.group.updateMatrixWorld(true);
      for (const m of track.group.children) {
        if (!m.isMesh || m.material.isShadowMaterial || !m.visible) continue;
        const cut = m.material.alphaTest > 0 || m.material.transparent;
        const p = m.geometry.attributes.position, idx = m.geometry.index;
        const cnt = idx ? idx.count : p.count, at = i => new V().fromBufferAttribute(p, idx ? idx.getX(i) : i).applyMatrix4(m.matrixWorld);
        for (let i = 0; i < cnt; i += 3) {
          const t = [at(i), at(i + 1), at(i + 2), m.name, cut], id = tris.push(t) - 1;
          const xs = t.slice(0, 3).map(v => v.x), zs = t.slice(0, 3).map(v => v.z);
          for (let cx = Math.floor(Math.min(...xs) / CELL); cx <= Math.floor(Math.max(...xs) / CELL); cx++)
            for (let cz = Math.floor(Math.min(...zs) / CELL); cz <= Math.floor(Math.max(...zs) / CELL); cz++) {
              const key = cx * 65536 + cz;
              if (!grid.has(key)) grid.set(key, []);
              grid.get(key).push(id);
            }
        }
      }
      const e1 = new V(), e2 = new V(), hv = new V(), s = new V(), q = new V(), cell = new V();
      const depth = (L = 800) => {   // first course triangle along o + t d: { t, name, cut } or null
        let best = null;
        for (let t = 0; t < L && !best; t += CELL) {   // cell by cell along the ray: nearest hit in reach so far
          cell.copy(o).addScaledVector(d, t + CELL / 2);
          for (let cx = Math.floor((cell.x - CELL) / CELL); cx <= Math.floor((cell.x + CELL) / CELL); cx++)
            for (let cz = Math.floor((cell.z - CELL) / CELL); cz <= Math.floor((cell.z + CELL) / CELL); cz++)
              for (const ti of grid.get(cx * 65536 + cz) || []) {
                const [A, B, C, name, cut] = tris[ti];
                e1.subVectors(B, A); e2.subVectors(C, A); hv.crossVectors(d, e2);
                const det = e1.dot(hv);
                if (Math.abs(det) < 1e-9) continue;
                s.subVectors(o, A);
                const u = s.dot(hv) / det;
                if (u < 0 || u > 1) continue;
                q.crossVectors(s, e1);
                const v = d.dot(q) / det;
                if (v < 0 || u + v > 1) continue;
                const k = e2.dot(q) / det;
                if (k > 0 && k < t + 2 * CELL && (!best || k < best.t)) best = { t: k, name, cut };
              }
        }
        return best;
      };
      let buf = null, buf2 = null, n = 0;
      const render = renderer.render.bind(renderer);
      renderer.render = (s, c) => {
        render(s, c);
        const g = window.__game, k = g.player;
        if (s !== scene || g.state !== 'race' || k.rescue || k.fell || k.finished || n++ % 4) return;
        const w = gl.drawingBufferWidth, h = gl.drawingBufferHeight;
        if (!buf || buf.length !== w * h * 4) { buf = new Uint8Array(w * h * 4); buf2 = new Uint8Array(w * h * 4); }
        gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, buf);
        // the same frame again with the sky in other colours: the pixels that change are sky (course textures can be
        // magenta or cyan too: Mario Raceway's Koopa Air signs)
        u.below.value.set(1, 1, 0); u.bottom.value.set(1, 1, 0); u.top.value.set(0, 0, 1); u.hor.value.set(0, 0, 1);
        render(s, c);
        gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, buf2);
        u.below.value.set(1, 0, 1); u.bottom.value.set(1, 0, 1); u.top.value.set(0, 1, 1); u.hor.value.set(0, 1, 1);
        res.frames++;
        // magenta regions touching the cyan sky above the horizon or a screen edge are the open distance past the
        // course's far edge (MK64 shows the below-horizon sky there too); a hole is a magenta region walled in by
        // course pixels, and it counts when the course around it is within NEAR (a distant gap between hills is not)
        const N = w * h, kind = new Uint8Array(N), seen = new Uint8Array(N), stack = [];
        for (let p = 0, i = 0; p < N; p++, i += 4) {
          // below the horizon magenta then yellow, above it cyan then blue (animated sprites and snowflakes change
          // between the two renders too, but not from one key colour to the other)
          const hi = v => v > 200, lo = v => v < 60, [r1, g1, b1, r2, g2, b2] = [buf[i], buf[i + 1], buf[i + 2], buf2[i], buf2[i + 1], buf2[i + 2]];
          if (hi(r1) && lo(g1) && hi(b1) && hi(r2) && hi(g2) && lo(b2)) kind[p] = 1;
          else if (lo(r1) && hi(g1) && hi(b1) && lo(r2) && lo(g2) && hi(b2)) kind[p] = 2;
        }
        o.copy(camera.position); camera.updateMatrixWorld();
        let worst = null;
        for (let p0 = 0; p0 < N; p0++) {
          if (kind[p0] !== 1 || seen[p0]) continue;
          let open = false, cnt = 0, x0 = w, x1 = 0, y0 = h, y1 = 0;
          seen[p0] = 1; stack.push(p0);
          while (stack.length) {
            const p = stack.pop(), x = p % w, y = (p - x) / w;
            cnt++; x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y);
            if (x === 0 || x === w - 1 || y === 0 || y === h - 1) open = true;
            for (const q of [x > 0 ? p - 1 : -1, x < w - 1 ? p + 1 : -1, p - w, p + w]) {
              if (q < 0 || q >= N) continue;
              if (kind[q] === 2) open = true;
              else if (kind[q] === 1 && !seen[q]) { seen[q] = 1; stack.push(q); }
            }
          }
          if (open || cnt < PX) continue;
          // seen through a cut-out texture (a fence, a tree's leaves): MK64 shows the sky there too
          const px0 = p0 % w, py0 = (p0 - px0) / w;
          ray(w, h, px0, py0);
          const through = depth();
          if (through?.cut) continue;
          const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;   // the course just outside the hole: left, right, above, below
          let far = 0, names = new Set();
          for (const [x, y] of [[x0 - 2, cy], [x1 + 2, cy], [cx, y1 + 2], [cx, y0 - 2]]) {
            ray(w, h, x, y);
            const hit = depth();
            far = Math.max(far, hit ? hit.t : Infinity);
            if (hit) names.add(hit.name);
          }
          if (far > NEAR) continue;
          if (!worst || cnt > worst.cnt) {
            ray(w, h, px0, py0);
            worst = { cnt, far: +far.toFixed(1), px: [px0, h - 1 - py0], dir: d.toArray().map(v => +v.toFixed(2)),
              through: through && `${through.name} at ${through.t.toFixed(1)}`, around: [...names].join(' ') };
          }
        }
        if (!worst) return;
        res.bad++;
        const r = v => [v.x, v.y, v.z].map(a => +a.toFixed(1));
        res.worst.push({ t: +g.raceTime.toFixed(2), ...worst, kart: r(k.world), cam: r(camera.position) });
      };
      return true;
    }, [mode, PX, NEAR]);
    if (!ok0) { console.log(`SKIP ${id}: no native sky`); await page.close(); continue; }
    const t0 = Date.now();
    let shot = 0;
    while (Date.now() - t0 < SECONDS * 1000) {
      await page.waitForTimeout(1000);
      if (SHOTS) {
        const r = await page.evaluate(() => window.__voids.bad);
        if (r > shot && shot < 8) { shot = r; await page.screenshot({ path: `${SHOTS}/${id}-${mode}-${String(Date.now() - t0).padStart(6, '0')}.png` }); }
      }
    }
    const r = await page.evaluate(() => window.__voids);
    const pct = r.frames ? 100 * r.bad / r.frames : 0;
    const ok = r.frames > 0 && pct <= LIMIT;
    if (!ok) fail++;
    console.log(`${ok ? 'PASS' : 'FAIL'} ${id} ${mode}: ${r.bad}/${r.frames} frames show a hole (${pct.toFixed(1)}%)`);
    const spots = new Map();   // one line per 4-unit spot
    for (const w of r.worst) {
      const key = w.kart.map(v => Math.round(v / 4)).join();
      if (!spots.has(key)) spots.set(key, { ...w, count: 0, max: 0 });
      const sp = spots.get(key); sp.count++; if (w.cnt > sp.max) Object.assign(sp, w, { count: sp.count, max: w.cnt });
    }
    for (const w of [...spots.values()].sort((a, b) => b.count - a.count).slice(0, 12))
      console.log(`   x${w.count} t=${w.t} kart ${w.kart} cam ${w.cam} ${w.max}px at ${w.px} dir ${w.dir}, course around it ${w.far} away (${w.around})${w.through ? `, behind it ${w.through}` : ''}`);
    await page.close();
  }
} finally {
  await browser.close();
  vite.kill();
}
process.exit(fail ? 1 : 0);
