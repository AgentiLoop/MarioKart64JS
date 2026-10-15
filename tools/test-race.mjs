// Autopilot race trace: Mario (the player kart) is driven by the CPU driver (?autopilot) for 3 laps on every race
// course, in Google Chrome via playwright-core, and everything that costs it time is logged with its cause:
// item hits (kind, who threw it), lightning, critter / vehicle hits, spin-outs, tumbles, Lakitu rescues (what it
// fell into), wall hits, stops (under 2/s for over a second) and slow stretches (under 40% of its top speed for over
// 1.5 s) with the driver's last-second trace, off-road time and reverse (backing off a wall) time, each with the
// lap and the position. The same for every CPU, summarised. Player-view screenshots every few race seconds are
// scored for flat white / black pixel masses (untextured or unlit surfaces).
// usage: node tools/test-race.mjs [course ids...]   (PLAYWRIGHT=path/to/playwright-core, PARALLEL=n, CC=50|100|150,
//        SHOTS=/tmp/mk64-race for the screenshots, SHOT_EVERY=secs, ALLKARTS=1 to list every CPU's events too)
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const pw = process.env.PLAYWRIGHT || '/private/tmp/mk64-browser-check/node_modules/playwright-core';
const { chromium } = createRequire(import.meta.url)(pw);
const ALL = ['luigi', 'moomoo', 'koopa', 'kalimari', 'toad', 'frappe', 'choco', 'mario',
  'wario', 'sherbet', 'royal', 'bowser', 'dk', 'yoshi', 'banshee', 'rainbow'];
const courses = process.argv.slice(2).length ? process.argv.slice(2) : ALL;
const PARALLEL = +process.env.PARALLEL || 4, CC = process.env.CC || '150', SHOTS = process.env.SHOTS || '/tmp/mk64-race';
const ALLKARTS = !!process.env.ALLKARTS;
const LIMIT = 8 * 60;   // race seconds before a course counts as failed
const SHOT_EVERY = +process.env.SHOT_EVERY || 15;   // race seconds between player-view screenshots
mkdirSync(SHOTS, { recursive: true });

const port = 5300 + Math.floor(Math.random() * 500);
const vite = spawn('npx', ['vite', '--port', String(port), '--strictPort'], { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'] });
await new Promise(r => vite.stdout.on('data', d => { if (String(d).includes('Local')) r(); }));
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'] });

// in-page: render the game's camera, return the PNG data URL and the fraction of pixels that are flat white / flat
// black, counted over the lower 2/3 of the frame (the sky is above)
const SHOT_FN = `label => {
  const g = window.__game, r = g.renderer, gl = r.getContext();
  const W = gl.drawingBufferWidth, H = gl.drawingBufferHeight;
  r.render(g.scene, g.camera);
  const b = new Uint8Array(W * H * 4);
  gl.readPixels(0, 0, W, H, gl.RGBA, gl.UNSIGNED_BYTE, b);
  let white = 0, black = 0, n = 0;
  for (let y = 0; y < (H * 2 / 3) | 0; y++) for (let x = 0; x < W; x++) {
    const i = (y * W + x) * 4, R = b[i], G = b[i + 1], B = b[i + 2];
    n++;
    if (R >= 248 && G >= 248 && B >= 248) white++;
    else if (R <= 6 && G <= 6 && B <= 6) black++;
  }
  const c = document.createElement('canvas'); c.width = W; c.height = H;
  const ctx = c.getContext('2d'), img = ctx.createImageData(W, H);
  for (let y = 0; y < H; y++) img.data.set(b.subarray(y * W * 4, (y + 1) * W * 4), (H - 1 - y) * W * 4);
  ctx.putImageData(img, 0, 0);
  const p = g.player.world, q = g.camera.position;
  return { label, white: +(white / n).toFixed(3), black: +(black / n).toFixed(3), png: c.toDataURL('image/png'),
    at: 'kart (' + [p.x, p.y, p.z].map(v => v.toFixed(0)) + ') s' + g.player.s.toFixed(0) + ' cam (' + [q.x, q.y, q.z].map(v => v.toFixed(1)) + ')' };
}`;

async function race(id) {
  const page = await browser.newPage({ viewport: { width: 640, height: 480 } });
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  page.on('console', m => { if (m.type() === 'error' && !m.text().startsWith('Failed to load resource')) errors.push(m.text()); });
  page.on('response', r => { if (r.status() >= 400) errors.push(`${r.status()} ${new URL(r.url()).pathname}`); });
  const shots = [];
  const save = s => { writeFileSync(`${SHOTS}/${id}-${s.label}.png`, Buffer.from(s.png.split(',')[1], 'base64')); shots.push({ label: s.label, white: s.white, black: s.black, at: s.at }); };
  try {
    await page.goto(`http://localhost:${port}/?track=${id}&char=mario&cc=${CC}&mode=mario_gp&autopilot`);
    await page.waitForFunction(() => window.__game && window.__game.player, null, { timeout: 60000 });
    const result = await page.evaluate(([limit, SHOT_FN, every, all]) => new Promise(done => {
      const shot = eval(SHOT_FN), g = window.__game, p = g.player, items = g.items, karts = g.karts;
      const ev = karts.map(() => []), laps = [], shotsOut = [];
      const where = k => `(${k.world.x.toFixed(0)},${k.world.y.toFixed(0)},${k.world.z.toFixed(0)}) s${k.s.toFixed(0)}`;
      const at = k => `${g.raceTime.toFixed(1)}s L${k.crossings} ${where(k)}`;
      const log = (k, what) => ev[karts.indexOf(k)].push(`${at(k)} ${what}`);
      // every hit with its cause: Items.hit (kind null = a critter's / vehicle's spin-out trigger), lightning, a bonk
      const st = karts.map(k => ({ rescue: false, stop: 0, slow: 0, slowS: 0, off: 0, offAt: 0, rev: 0, wall: 0, lastHit: -1, lastX: k.world.x, lastZ: k.world.z, movedAt: 0, stalls: 0, trace: [], spin: false, tumble: false }));
      const hit0 = items.hit.bind(items), strike0 = items.strike.bind(items);
      // a vehicle hit (kind 'star', no owner): the nearest vehicle on the route - kind, where it is relative to the
      // kart (route units ahead / across) and its speed - and the driver's last second
      const vehicle = k => {
        const sp = g.traffic?.spots; if (!sp?.length) return '';
        const L = g.track.length, rel = o => { let ds = o.s - k.s; if (ds < -L / 2) ds += L; if (ds > L / 2) ds -= L; return ds; };
        const i = sp.map((o, i) => [Math.abs(rel(o)) + Math.abs(o.d - k.d), i]).sort((a, b) => a[0] - b[0])[0][1], o = sp[i], v = g.traffic.vehicles[i];
        return ` ${v.kind} ds${rel(o).toFixed(1)} dd${(o.d - k.d).toFixed(1)} v${o.v.toFixed(0)} after ${st[karts.indexOf(k)].trace.join(' ')}`;
      };
      items.hit = (k, kind, owner) => { const r = hit0(k, kind, owner); if (r) log(k, `hit ${kind ?? 'critter'}${owner ? ' by ' + (owner.name ?? '?') : ''}${kind === 'star' && !owner ? vehicle(k) : ''}`); return r; };
      items.strike = k => { strike0(k); log(k, 'lightning'); };
      const bonk0 = p.bonk;
      for (const k of karts) k.bonk = function (...a) { const m2 = bonk0.apply(this, a); if (Math.sqrt(m2) >= 6.5) log(this, 'bonked'); return m2; };
      let lastLap = p.crossings, nextShot = every, minV = 1e9, topV = 0;
      const dt = 0.1;
      const t = setInterval(() => {
        const rt = g.raceTime, racing = g.state === 'race';
        if (p.crossings > lastLap) { if (p.crossings >= 1) laps.push(rt); lastLap = p.crossings; }
        karts.forEach((k, i) => {
          const s = st[i], top = k.top || 1;
          if (k.rescue > 0 && !s.rescue) log(k, `rescued (${k.fell?.kind ?? '?'}) after ${s.trace.join(' ')}`);
          s.rescue = k.rescue > 0;
          if (k.spin > 0 && !s.spin) log(k, `spin-out after ${s.trace.join(' ')}`);
          s.spin = k.spin > 0;
          if (k.tumble && !s.tumble) log(k, `tumble ${k.tumble.mode}`);
          s.tumble = !!k.tumble;
          if (k.hitWall > 0 && rt - s.lastHit > 0.5) { s.wall++; s.lastHit = rt; if (all || k === p) log(k, `wall v${k.v.toFixed(0)}`); }
          if (k.offroad) { if (!s.off) s.offAt = rt; s.off += dt; } else if (s.off) { if (s.off >= 1) log(k, `off-road ${s.off.toFixed(1)}s`); s.off = 0; }
          if (k.reverse > 0) { s.rev += dt; if (s.rev === dt) log(k, `reversing after ${s.trace.join(' ')}`); } else s.rev = 0;
          if (racing && rt > 4 && !k.finished && !(k.rescue > 0)) {
            if (Math.abs(k.v) < 2) { s.stop += dt; if (Math.abs(s.stop - 1) < dt / 2) log(k, `stopped after ${s.trace.join(' ')}`); } else s.stop = 0;
            if (k.v < top * 0.4 && !(k.spin > 0) && !k.tumble) { if (!s.slow) s.slowS = k.s; s.slow += dt; }
            else if (s.slow) { if (s.slow >= 1.5) log(k, `slow ${s.slow.toFixed(1)}s from s${s.slowS.toFixed(0)} after ${s.trace.join(' ')}`); s.slow = 0; }
          }
          if (Math.hypot(k.world.x - s.lastX, k.world.z - s.lastZ) > 1) { s.lastX = k.world.x; s.lastZ = k.world.z; s.movedAt = rt; }
          else if (racing && !k.finished && !(k.rescue > 0) && rt - s.movedAt > 5) { s.stalls++; s.movedAt = rt; log(k, `STALL after ${s.trace.join(' ')}`); }
          // the driver's last second: speed, item held, reversing / spinning / tumbling / boosting / off-road / wall
          s.trace.push(`v${k.v.toFixed(0)}${k.item ? '(' + k.item + ')' : ''}${k.reverse > 0 ? 'R' : ''}${k.spin > 0 ? 'S' : ''}${k.tumble ? 'T' : ''}${k.boost > 0 ? 'B' : ''}${k.offroad ? 'O' : ''}${k.hitWall > 0 ? 'W' : ''}${k.air ? 'A' : ''}d${k.d.toFixed(0)}`);
          if (s.trace.length > 10) s.trace.shift();
        });
        if (racing && rt > 5 && !p.finished) { minV = Math.min(minV, p.v); topV = Math.max(topV, p.v); }
        if (racing && rt >= nextShot) { nextShot += every; shotsOut.push(shot(`t${Math.round(rt)}`)); }
        if (p.finished || rt > limit) {
          clearInterval(t);
          const order = [...karts].sort((a, b) => (b.finished - a.finished) || (a.finished ? a.finishTime - b.finishTime : b.progress - a.progress));
          done({ finished: p.finished, time: +(p.finishTime || rt).toFixed(1), laps: laps.map((x, i) => +(x - (laps[i - 1] ?? 0)).toFixed(2)),
            place: order.indexOf(p) + 1, stalls: st[karts.indexOf(p)].stalls, minV: +minV.toFixed(1), topV: +topV.toFixed(1),
            cpus: karts.filter(k => !k.isPlayer).map((k, i) => `${k.name}:${k.finished ? k.finishTime.toFixed(1) : 'L' + k.crossings}${st[karts.indexOf(k)].stalls ? ' STALL' + st[karts.indexOf(k)].stalls : ''}`),
            player: ev[karts.indexOf(p)], others: all ? Object.fromEntries(karts.filter(k => !k.isPlayer).map(k => [k.name, ev[karts.indexOf(k)]])) : undefined,
            cpuEvents: karts.filter(k => !k.isPlayer).flatMap(k => ev[karts.indexOf(k)].filter(e => /STALL|rescued|stopped|reversing/.test(e)).map(e => `${k.name} ${e}`)),
            shots: shotsOut });
        }
      }, 100);
    }), [LIMIT, SHOT_FN, SHOT_EVERY, ALLKARTS]);
    result.shots.forEach(save);
    delete result.shots;
    return { ...result, shots };
  } catch (e) {
    return { finished: false, error: String(e), shots };
  } finally {
    await page.close().catch(() => {});
    if (errors.length) console.error(`  [${id}] page errors: ${[...new Set(errors)].slice(0, 5).join(' | ')}`);
  }
}

const results = {};
let fail = 0;
try {
  const queue = [...courses];
  await Promise.all(Array.from({ length: Math.min(PARALLEL, queue.length) }, async () => {
    for (let id; (id = queue.shift());) {
      const t0 = Date.now(), r = await race(id);
      r.wallSec = Math.round((Date.now() - t0) / 1000);
      results[id] = r;
      // Banshee Boardwalk and Rainbow Road are built over the night void: black masses are the course
      const flat = r.shots.filter(s => s.white > 0.15 || (s.black > 0.3 && !['banshee', 'rainbow'].includes(id)));
      const ok = r.finished && r.laps && r.laps.length === 3 && !r.stalls && !flat.length;
      if (!ok) fail++;
      const { player, others, cpuEvents, shots, ...rest } = r;
      console.log(`${ok ? 'PASS' : 'FAIL'} ${id.padEnd(9)} ${JSON.stringify(rest)}`);
      for (const e of player ?? []) console.log(`    ${e}`);
      for (const e of cpuEvents ?? []) console.log(`    cpu ${e}`);
      if (others) for (const [n, es] of Object.entries(others)) for (const e of es) console.log(`    ${n} ${e}`);
      console.log(`  shots: ${shots.map(s => `${s.label} w${s.white} b${s.black}`).join(', ')}`);
      for (const s of flat) console.log(`    ${s.label}: ${s.at}`);
      if (flat.length) console.log(`  flat masses: ${flat.map(s => `${SHOTS}/${id}-${s.label}.png`).join(' ')}`);
    }
  }));
} finally {
  await browser.close(); vite.kill();
}
writeFileSync(`${SHOTS}/report.json`, JSON.stringify(results, null, 1));
console.log(`${courses.length - fail}/${courses.length} courses clean`);
process.exit(fail ? 1 : 0);
