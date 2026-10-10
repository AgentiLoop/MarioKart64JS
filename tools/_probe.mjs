// How far do karts sink into walls? Drives the player kart (synchronously, 60 Hz steps, no rendering in between)
// straight at and along the course's steep faces (Track.wallTris) from many start spots and headings, and measures
// how much of the kart's visible sprite width ends up on the far side of a face: the horizontal distance from the
// kart to the nearest face at body height against the sprite's visible half-width (Kart.visualHalfWidth).
// Battle arenas use updateFree (wallPush); race courses update() along the route (wallAt clamp, then wallPush).
// With WII3D=1 the karts are the Wii 3D karts (key 3) and the body is their capsule (kart3d.js userData.capsule): a circle
// over each axle, measured against the capsule radius instead of the sprite's half-width.
// usage: node tools/test-walls.mjs [course ids...]   (PLAYWRIGHT=path/to/playwright-core, LIMIT=% to fail above, default 10, WII3D=1)
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const pw = process.env.PLAYWRIGHT || '/private/tmp/mk64-browser-check/node_modules/playwright-core';
const { chromium } = createRequire(import.meta.url)(pw);
const LIMIT = +(process.env.LIMIT ?? 10), WII = !!process.env.WII3D;
const BATTLE = ['big-donut', 'block-fort', 'double-deck', 'skyscraper'];
const RACE = ['mario', 'luigi', 'bowser', 'banshee', 'frappe', 'choco', 'dk', 'yoshi', 'royal', 'wario'];
const courses = process.argv.slice(2).length ? process.argv.slice(2) : [...BATTLE, ...RACE];

const port = 5800 + Math.floor(Math.random() * 500);
const vite = spawn('npx', ['vite', '--port', String(port), '--strictPort'], { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'] });
await new Promise(r => vite.stdout.on('data', d => { if (String(d).includes('Local')) r(); }));
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--ignore-gpu-blocklist'] });

let fail = 0;
for (const id of courses) {
  for (const char of ['bowser']) {
    const page = await (await browser.newContext({ viewport: { width: 320, height: 240 } })).newPage();
    if (WII) await page.addInitScript(() => localStorage.setItem('mk64wii3d', '1'));
    await page.goto(`http://localhost:${port}/?track=${id}&char=${char}${BATTLE.includes(id) ? '&mode=battle' : ''}`);
    await page.waitForFunction(wii => window.__game && window.__game.player && window.__game.player.track.wallTris && (!wii || window.__game.player.model?.userData.capsule), WII, { timeout: 60000 });
    const r = await page.evaluate(wii => {
      const k = window.__game.player, t = k.track, W = t.wallTris, cap = wii && k.model.userData.capsule;
      const half = cap ? cap.r : k.visualHalfWidth;
      const FR = k.frame && { pos: k.frame.pos.clone(), T: k.frame.T.clone(), U: k.frame.U.clone(), R: k.frame.R.clone(), k: 0 };
      // closest point on triangle abc to p (Ericson, Real-Time Collision Detection 5.1.5)
      const sub = (u, v) => [u[0] - v[0], u[1] - v[1], u[2] - v[2]], dot = (u, v) => u[0] * v[0] + u[1] * v[1] + u[2] * v[2];
      const at = (a, u, s, v, w) => [a[0] + u[0] * s + v[0] * w, a[1] + u[1] * s + v[1] * w, a[2] + u[2] * s + v[2] * w];
      const closest = (p, a, b, c) => {
        const ab = sub(b, a), ac = sub(c, a), ap = sub(p, a), d1 = dot(ab, ap), d2 = dot(ac, ap);
        if (d1 <= 0 && d2 <= 0) return a;
        const bp = sub(p, b), d3 = dot(ab, bp), d4 = dot(ac, bp);
        if (d3 >= 0 && d4 <= d3) return b;
        const vc = d1 * d4 - d3 * d2;
        if (vc <= 0 && d1 >= 0 && d3 <= 0) return at(a, ab, d1 / (d1 - d3), ac, 0);
        const cp = sub(p, c), d5 = dot(ab, cp), d6 = dot(ac, cp);
        if (d6 >= 0 && d5 <= d6) return c;
        const vb = d5 * d2 - d1 * d6;
        if (vb <= 0 && d2 >= 0 && d6 <= 0) return at(a, ac, d2 / (d2 - d6), ab, 0);
        const va = d3 * d6 - d5 * d4;
        if (va <= 0 && d4 - d3 >= 0 && d5 - d6 >= 0) { const w = (d4 - d3) / ((d4 - d3) + (d5 - d6)); return at(b, sub(c, b), w, ab, 0); }
        const den = 1 / (va + vb + vc);
        return at(a, ab, vb * den, ac, vc * den);
      };
      const box = W.map(([a, b, c]) => [Math.min(a[0], b[0], c[0]), Math.max(a[0], b[0], c[0]), Math.min(a[2], b[2], c[2]), Math.max(a[2], b[2], c[2])]);
      // horizontal distance from the kart at (x, y, z) to the nearest face part standing at body height
      const gap = (x, y, z) => {
        let best = Infinity;
        W.forEach(([a, b, c], i) => {
          const [x0, x1, z0, z1] = box[i];
          if (x < x0 - half || x > x1 + half || z < z0 - half || z > z1 + half) return;
          for (const lift of [0.6, 1.2, 2]) {
            const q = closest([x, y + lift, z], a, b, c);
            // lips under 0.6 are climbed (Track groundAt CLIMB); edges over 2 hang over the road and the kart drives
            // under them (Track.wallPush body 0.55..2)
            if (q[1] < y + 0.55 || q[1] > y + 2) continue;
            best = Math.min(best, Math.hypot(q[0] - x, q[2] - z));
          }
        });
        return best;
      };
      const worst = { pen: 0, at: null }, pens = [], bads = []; let trialNo = 0, LOG = null;
      const trial = (setup, input, steps) => {
        setup();
        let max = 0, where = null, dropAt = -99, lastY = k.mesh.position.y;
        for (let i = 0; i < steps; i++) {
          if (k.free) k.updateFree(1 / 60, input); else k.update(1 / 60, input);
          const p = k.mesh.position;
          if (lastY - p.y > 0.5) dropAt = i;   // stepped down off a ledge (Double Deck's tiers): the face is behind it
          lastY = p.y;
          if (k.air || k.rescue > 0 || i - dropAt < 20) continue;   // falling past a building's side / Lakitu is not driving into it
          let pen = half - gap(p.x, p.y, p.z);
          if (cap && !k.free) {   // the capsule's two circles, along the kart's heading (Kart.routeWallPush)
            const f = t.frameAt(k.s, FR), hc = Math.cos(k.psi), hs = Math.sin(k.psi);
            const hx = f.T.x * hc + f.R.x * hs, hz = f.T.z * hc + f.R.z * hs;
            pen = Math.max(half - gap(p.x + hx * cap.front, p.y, p.z + hz * cap.front), half - gap(p.x + hx * cap.rear, p.y, p.z + hz * cap.rear));
          }
          if (LOG) LOG.push([i, +k.s.toFixed(2), +k.d.toFixed(2), +k.v.toFixed(2), +k.psi.toFixed(2), +k.phi.toFixed(2), +(k.wallT||0).toFixed(2), +p.x.toFixed(2), +p.z.toFixed(2), +(pen/(2*half)*100).toFixed(0), +(t.wallAt(k.s,-1)-1.2).toFixed(2), +(t.wallAt(k.s,1)-1.2).toFixed(2)]);
          if (pen > max) { max = pen; where = [+p.x.toFixed(1), +p.y.toFixed(1), +p.z.toFixed(1), i]; }
        }
        pens.push(max); if (max/(2*half)*100 > 10) bads.push(trialNo); trialNo++;
        if (max > worst.pen) { worst.pen = max; worst.at = where; }
      };
      const reset = () => { k.v = 0; k.drift = 0; k.boost = 0; k.spin = 0; k.slip = 0; k.vy = 0; k.air = false; k.rescue = 0; k.tumble = null; k.finished = false; k.out = false; };
      if (k.free) {
        const sp = k.spawn;
        for (let a = 0; a < 32; a++) for (const steer of [0, 0.35, -0.35]) {
          trial(() => { reset(); k.x = sp.x; k.z = sp.z; k.y = sp.y; k.h = a / 32 * Math.PI * 2; k.syncFree(0); },
            { throttle: 1, brake: 0, steer, drift: false }, 420);
        }
      } else {
        const ALL = []; for (let i = 0; i < 24; i++) for (const steer of [1, -1, 0.4, -0.4]) ALL.push([i, steer]);
        const run = ([i, steer]) => trial(() => { reset(); k.s = i / 24 * t.length; k.prevS = k.s; k.d = 0; k.psi = 0; k.phi = 0; k.v = 20; k.syncMesh(0); },
            { throttle: 1, brake: 0, steer, drift: false }, 150);
        ALL.forEach(run); for (const b of bads.slice(0,1)) { LOG = []; run(ALL[b]); window.__log = [[ALL[b], LOG]]; }
      }
      pens.sort((p, q) => p - q);
      return { half, walls: W.length, trials: pens.length, max: worst.pen, at: worst.at, p90: pens[Math.floor(pens.length * 0.9)], log: window.__log, over: pens.filter(p => p / (2 * half) * 100 > 10).length };
    }, WII);
    const pct = v => (Math.max(0, v) / (2 * r.half) * 100).toFixed(0) + '%';
    const bad = r.max / (2 * r.half) * 100 > LIMIT;
    if (bad) fail++;
    console.log(`${bad ? 'FAIL' : 'PASS'} ${id.padEnd(12)} ${char.padEnd(7)} ${WII ? 'capsule r' : 'half-width'} ${r.half.toFixed(2)}  deepest ${pct(r.max)} of the kart's width at ${JSON.stringify(r.at)}  90th pct ${pct(r.p90)}  trials over 10%: ${r.over}/${r.trials}`);
    if (r.log) for (const [tr, l] of r.log) { console.log('trial', tr); const j = l.findIndex(x => x[9] > 10); for (const x of l.slice(Math.max(0, j - 12), j + 6)) console.log(x.join(' ')); }
    await page.context().close();
  }
}
await browser.close();
vite.kill();
process.exit(fail ? 1 : 0);
