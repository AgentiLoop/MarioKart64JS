// Autopilot race test: Mario (the player kart) is driven by the CPU driver (?autopilot) for 3 laps on every race
// course, in Google Chrome via playwright-core. Reports lap times, place, stalls and page errors per course.
// usage: node tools/test-autopilot.mjs [course ids...]   (PLAYWRIGHT=path/to/playwright-core, PARALLEL=n, CC=50|100|150)
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const pw = process.env.PLAYWRIGHT || '/private/tmp/mk64-browser-check/node_modules/playwright-core';
const { chromium } = createRequire(import.meta.url)(pw);
const ALL = ['luigi', 'moomoo', 'koopa', 'kalimari', 'toad', 'frappe', 'choco', 'mario',
  'wario', 'sherbet', 'royal', 'bowser', 'dk', 'yoshi', 'banshee', 'rainbow'];
const courses = process.argv.slice(2).length ? process.argv.slice(2) : ALL;
const PARALLEL = +process.env.PARALLEL || 4, CC = process.env.CC || '150';
const LIMIT = 8 * 60;   // race seconds before a course counts as failed

const port = 5300 + Math.floor(Math.random() * 500);
const vite = spawn('npx', ['vite', '--port', String(port), '--strictPort'], { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'] });
await new Promise(r => vite.stdout.on('data', d => { if (String(d).includes('Local')) r(); }));
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'] });

async function race(id) {
  const page = await browser.newPage({ viewport: { width: 480, height: 360 } });
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  page.on('console', m => { if (m.type() === 'error' && !m.text().startsWith('Failed to load resource')) errors.push(m.text()); });
  page.on('response', r => { if (r.status() >= 400) errors.push(`${r.status()} ${new URL(r.url()).pathname}`); });
  try {
    await page.goto(`http://localhost:${port}/?track=${id}&char=mario&cc=${CC}&mode=mario_gp&autopilot`);
    await page.waitForFunction(() => window.__game && window.__game.player, null, { timeout: 60000 });
    // poll: lap splits, stalls (no progress for 5 race seconds), rescues (fell off), place at the finish
    return await page.evaluate(limit => new Promise(done => {
      const g = window.__game, p = g.player, laps = [];
      let lastLap = p.crossings, best = p.progress, bestAt = 0, stalls = 0, rescues = 0, wasRescue = false, minV = 1e9;
      const t = setInterval(() => {
        const rt = g.raceTime;
        if (p.crossings > lastLap) { if (p.crossings >= 1) laps.push(rt); lastLap = p.crossings; }
        if (p.progress > best + 1) { best = p.progress; bestAt = rt; }
        else if (g.state === 'race' && rt - bestAt > 5) { stalls++; bestAt = rt; }
        if (p.rescue > 0 && !wasRescue) rescues++;
        wasRescue = p.rescue > 0;
        if (g.state === 'race' && rt > 5) minV = Math.min(minV, p.v);
        if (p.finished || rt > limit) {
          clearInterval(t);
          const order = [...g.karts].sort((a, b) => (b.finished - a.finished) || (a.finished ? a.finishTime - b.finishTime : b.progress - a.progress));
          done({ finished: p.finished, time: p.finishTime || rt, laps: laps.map((x, i) => +(x - (laps[i - 1] ?? 0)).toFixed(2)),
            place: order.indexOf(p) + 1, stalls, rescues, autopilot: g.autopilot, minV: +minV.toFixed(1),
            cpusFinished: g.karts.filter(k => !k.isPlayer && k.finished).length });
        }
      }, 100);
    }), LIMIT);
  } catch (e) {
    return { finished: false, error: String(e) };
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
      const ok = r.finished && r.laps && r.laps.length === 3;
      if (!ok) fail++;
      console.log(`${ok ? 'PASS' : 'FAIL'} ${id.padEnd(9)} ${JSON.stringify(r)}`);
    }
  }));
} finally {
  await browser.close(); vite.kill();
}
console.log(`${courses.length - fail}/${courses.length} courses: Mario on autopilot finished 3 laps`);
process.exit(fail ? 1 : 0);
