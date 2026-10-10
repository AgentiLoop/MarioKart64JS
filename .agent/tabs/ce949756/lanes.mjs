// human-like player sweep: start at (s, d) heading along the route at speed V, hold the lane (steer = lane keeping),
// run N frames; report starts where the kart gets redirected (|psi| > 0.6), slowed (v < 0.5 V), hit walls, or
// leaves its lane by > 4. Also count flights. usage: node lanes.mjs koopa mario [s0 s1 step] [dmin dmax dstep]
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
const ROOT = process.env.ROOT || '/Users/toddbruss/Documents/GitHub/MarioKart64JS/';
const { chromium } = createRequire(import.meta.url)('/private/tmp/mk64-browser-check/node_modules/playwright-core');
const [course = 'koopa', ch = 'mario', S0 = '0', S1 = '-1', SS = '4', D0 = '-8', D1 = '8', DS = '2', N = '90'] = process.argv.slice(2);
const port = 7100 + Math.floor(Math.random() * 800);
const vite = spawn('npx', ['vite', '--port', String(port), '--strictPort'], { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'] });
await new Promise(r => vite.stdout.on('data', d => { if (String(d).includes('Local')) r(); }));
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 200, height: 150 } });
await page.goto(`http://localhost:${port}/?track=${course}&char=${ch}&cc=150`);
await page.waitForFunction(() => window.__game && window.__game.player && window.__game.player.track.wallTris, null, { timeout: 90000 });
const out = await page.evaluate(([S0, S1, SS, D0, D1, DS, N, TR, FS, VV]) => {
  const g = window.__game, k = g.player, t = k.track, R = []; const THREE_V = k.frame.pos.constructor;
  // top speed: accelerate on the straight at s0
  k.s = k.prevS = 5; k.d = 0; k.psi = k.phi = 0; k.v = 0; k.wallEase = 0; k.syncMesh(0);
  for (let i = 0; i < 400; i++) k.update(1 / 60, { throttle: 1, brake: 0, steer: 0, drift: false });
  const V = VV || Math.max(k.v, k.top * 0.97), end = S1 < 0 ? t.length : S1;
  let flights = 0, n = 0;
  for (let s = S0; s < end; s += SS) for (let d = D0; d <= D1; d += DS) {
    if (d < -t.wallAt(s, -1) + 1 || d > t.wallAt(s, 1) - 1) continue;
    k.s = k.prevS = s; k.d = d; k.psi = k.phi = 0; k.v = V; k.wallEase = 0; k.air = false; k.vy = 0; k.arc = null;
    k.rescue = 0; k.spin = 0; k.wallT = 0; k.syncMesh(0);
    const w0 = `${k.world.x.toFixed(0)},${k.world.z.toFixed(0)}`;
    let maxPsi = 0, minV = V, hits = 0, air = 0, maxOff = 0, bad = '';
    for (let i = 0; i < N; i++) {
      const fr = t.frameAt(k.s + 5, { pos: new THREE_V(), T: new THREE_V(), U: new THREE_V(), R: new THREE_V(), k: 0 });
      const sf = Math.min(1, Math.abs(k.v) / 10) / (1 + Math.abs(k.v) / 90);
      const ff = k.v > 0 && sf > 0.05 ? fr.k * k.v / Math.max(0.3, 1 - fr.k * k.d) / (1.9 * sf) : 0;
      const steer = FS !== null ? FS : Math.max(-1, Math.min(1, ff + 3.5 * (Math.atan2(d - k.d, 14) - k.psi)));
      const wt = k.wallT; let kk = 0; for (const a of [8, 20, 32]) kk += t.frameAt(k.s + a, fr).k; kk = Math.abs(kk / 3);
      const cv = kk > 1e-4 ? 1.7 / kk / (1 + k.v / 90) : Infinity;
      k.update(1 / 60, k.v > cv ? { throttle: 0, brake: k.v > cv * 1.15 ? 0.6 : 0.2, steer, drift: false } : { throttle: 1, brake: 0, steer, drift: false });
      if (TR) R.push(`${i} s${k.s.toFixed(1)} d${k.d.toFixed(2)} psi${k.psi.toFixed(2)} v${k.v.toFixed(1)} st${steer.toFixed(2)} air${+k.air} wT${k.wallT.toFixed(2)} wN${k.wallN ? k.wallN.t.toFixed(2)+','+k.wallN.r.toFixed(2) : ''} w${k.world.x.toFixed(1)},${k.world.z.toFixed(1)} y${k.world.y.toFixed(2)} wl${t.wallAt(k.s,-1).toFixed(1)} wr${t.wallAt(k.s,1).toFixed(1)} ease${(k.wallEase||0).toFixed(2)}`);
      if (k.wallT > wt + 0.01) hits++;
      if (k.air) air++;
      maxPsi = Math.max(maxPsi, Math.abs(k.psi)); minV = Math.min(minV, k.v); maxOff = Math.max(maxOff, Math.abs(k.d - d));
      if (!bad && (Math.abs(k.psi) > 0.6 || k.v < 0.5 * V)) bad = `@${i} w${k.world.x.toFixed(0)},${k.world.z.toFixed(0)} y${k.world.y.toFixed(1)}`;
    }
    n++; if (air > 15) flights++;
    if (bad || hits || maxOff > 4) R.push(`s${s} d${d} w${w0} psi${maxPsi.toFixed(2)} vmin${minV.toFixed(0)} hits${hits} off${maxOff.toFixed(1)} air${air} ${bad}`);
  }
  return { V, n, flights, R };
}, [+S0, +S1, +SS, +D0, +D1, +DS, +N, !!process.env.TRACE, process.env.STEER ? +process.env.STEER : null, +(process.env.V || 0)]);
console.log(`V=${out.V.toFixed(1)} starts=${out.n} flights=${out.flights} flagged=${out.R.length}`);
console.log(out.R.join('\n'));
await browser.close(); vite.kill(); process.exit(0);
