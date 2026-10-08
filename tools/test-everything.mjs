// Whole-game smoke test in visible Google Chrome windows (playwright-core): menus driven by the keyboard, keyboard
// driving / restart / HD / music / back-to-menu, the four battle arenas, EXTRA (mirror), 50cc / 100cc, time trials,
// VS, every character, and (LOBBY=ws://...) a 2-window online race. Prints one PASS/FAIL line per scenario with
// what it measured, saves a screenshot of each to /tmp/mk64-test/, and writes /tmp/mk64-test/results.json.
// usage: node tools/test-everything.mjs [scenario names...]   (PLAYWRIGHT=path/to/playwright-core, PARALLEL=n,
// HEADLESS=1 to hide the windows, LOBBY=ws://localhost:8787/api/mp to add the online scenario)
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const OUT = '/tmp/mk64-test';
mkdirSync(OUT, { recursive: true });
const pw = process.env.PLAYWRIGHT || '/private/tmp/mk64-browser-check/node_modules/playwright-core';
const { chromium } = createRequire(import.meta.url)(pw);
const PARALLEL = +process.env.PARALLEL || 4;

const port = 5300 + Math.floor(Math.random() * 500);
const vite = spawn('npx', ['vite', '--port', String(port), '--strictPort'], { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'] });
await new Promise(r => vite.stdout.on('data', d => { if (String(d).includes('Local')) r(); }));
const BASE = `http://localhost:${port}/`;
const browser = await chromium.launch({ channel: 'chrome', headless: !!process.env.HEADLESS,
  args: ['--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'] });

const sleep = ms => new Promise(r => setTimeout(r, ms));
async function open(name) {   // a new context = its own Chrome window
  const ctx = await browser.newContext({ viewport: { width: 640, height: 480 } });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  page.on('console', m => { if (m.type() === 'error' && !m.text().startsWith('Failed to load resource')) errors.push(m.text()); });
  page.on('response', r => { if (r.status() >= 400) errors.push(`${r.status()} ${new URL(r.url()).pathname}`); });
  return { page, errors, close: async () => { await page.screenshot({ path: `${OUT}/${name}.png` }).catch(() => {}); await ctx.close().catch(() => {}); } };
}
const shown = (page, id) => page.evaluate(id => getComputedStyle(document.getElementById(id)).display !== 'none', id);
const waitShown = (page, id, timeout = 10000) => page.waitForFunction(id => getComputedStyle(document.getElementById(id)).display !== 'none', id, { timeout });
const waitPlayer = page => page.waitForFunction(() => window.__game && window.__game.player, null, { timeout: 60000 });
const waitRace = page => page.waitForFunction(() => window.__game.state === 'race', null, { timeout: 30000 });
async function press(page, ...codes) { for (const c of codes) { await page.keyboard.press(c); await sleep(250); } }
async function toGameSelect(page) {   // title: the first press may only unlock audio
  await page.goto(BASE);
  await waitShown(page, 'title', 30000);
  for (let i = 0; i < 4 && !(await shown(page, 'gameSel')); i++) await press(page, 'Enter');
  await waitShown(page, 'gameSel');
}

// race on autopilot until the player finishes (or `limit` race seconds): lap splits, place, stalls, rescues
const raceWatch = (page, limit) => page.evaluate(limit => new Promise(done => {
  const g = window.__game, p = g.player, laps = [];
  let lastLap = p.crossings, best = p.progress, bestAt = 0, stalls = 0, rescues = 0, wasRescue = false;
  const t = setInterval(() => {
    const rt = g.raceTime;
    if (p.crossings > lastLap) { if (p.crossings >= 1) laps.push(rt); lastLap = p.crossings; }
    if (p.progress > best + 1) { best = p.progress; bestAt = rt; }
    else if (g.state === 'race' && rt - bestAt > 5) { stalls++; bestAt = rt; }
    if (p.rescue > 0 && !wasRescue) rescues++;
    wasRescue = p.rescue > 0;
    if (p.finished || rt > limit) {
      clearInterval(t);
      const order = [...g.karts].sort((a, b) => (b.finished - a.finished) || (a.finished ? a.finishTime - b.finishTime : b.progress - a.progress));
      done({ finished: !!p.finished, time: +(p.finishTime || rt).toFixed(2), laps: laps.map((x, i) => +(x - (laps[i - 1] ?? 0)).toFixed(2)),
        place: order.indexOf(p) + 1, of: g.karts.length, stalls, rescues, banner: document.getElementById('banner').textContent });
    }
  }, 100);
}), limit);

async function race(name, query, check = () => [], limit = 8 * 60) {
  const w = await open(name);
  try {
    await w.page.goto(`${BASE}?${query}&autopilot`);
    await waitPlayer(w.page);
    // EXTRA mirrors in the camera projection (clip x negated), never with a CSS flip of the canvas
    const extra = await w.page.evaluate(() => ({ mirrored: window.__game.camera.projectionMatrix.elements[0] < 0
        && getComputedStyle(document.querySelector('canvas')).transform === 'none',
      karts: window.__game.karts.length, chars: window.__game.karts.map(k => k.char || k.name) }));
    const r = { ...await raceWatch(w.page, limit), ...extra };
    const bad = [];
    if (!r.finished || r.laps.length !== 3) bad.push('did not finish 3 laps');
    if (r.stalls) bad.push(`${r.stalls} stalls`);
    if (r.rescues) bad.push(`${r.rescues} rescues`);
    bad.push(...check(r));
    return { ...r, bad, errors: w.errors };
  } finally { await w.close(); }
}

async function battle(id) {
  const w = await open(`battle-${id}`);
  try {
    await w.page.goto(`${BASE}?track=${id}&mode=battle&autopilot`);
    await waitPlayer(w.page);
    const r = await w.page.evaluate(() => new Promise(done => {
      const g = window.__game, t0 = performance.now();
      let minY = 1e9, maxY = -1e9, rescues = 0, was = new Map(), hits = 0, lastB = new Map();
      const t = setInterval(() => {
        for (const k of g.karts) {
          minY = Math.min(minY, k.y); maxY = Math.max(maxY, k.y);
          if (k.rescue > 0 && !was.get(k)) rescues++;
          was.set(k, k.rescue > 0);
          if (lastB.has(k) && k.balloons < lastB.get(k)) hits++;
          lastB.set(k, k.balloons);
        }
        if (g.state === 'finished' || g.raceTime > 180 || performance.now() - t0 > 240000) {
          clearInterval(t);
          done({ state: g.state, raceTime: +g.raceTime.toFixed(1), balloons: g.karts.map(k => `${k.name}:${k.out ? 'out' : k.balloons}`),
            hits, rescues, minY: +minY.toFixed(1), maxY: +maxY.toFixed(1), banner: document.getElementById('banner').textContent,
            lap: document.getElementById('lap').textContent });
        }
      }, 100);
    }));
    const bad = [];
    if (!r.hits) bad.push('no balloon popped in 3 minutes');
    if (r.state !== 'finished') bad.push(`no winner after ${r.raceTime}s`);
    return { ...r, bad, errors: w.errors };
  } finally { await w.close(); }
}

// menus: title -> GAME SELECT (L OPTION / R DATA and back) -> 1P MARIO GP 150cc -> Flower Cup course 2 -> char 2 -> race
async function menusGp() {
  const w = await open('menus-gp'), p = w.page, steps = [];
  try {
    await toGameSelect(p); steps.push('title->game select');
    await press(p, 'KeyL'); await waitShown(p, 'opt'); await press(p, 'Escape'); await waitShown(p, 'gameSel'); steps.push('L option + back');
    await press(p, 'KeyR'); await waitShown(p, 'data'); await press(p, 'Escape'); await waitShown(p, 'gameSel'); steps.push('R data + back');
    await press(p, 'Enter', 'Enter', 'ArrowDown', 'ArrowDown', 'Enter'); await waitShown(p, 'menu'); steps.push('1P / mario gp / 150cc');
    await press(p, 'ArrowRight', 'Enter', 'ArrowDown', 'Enter', 'Enter'); await waitShown(p, 'char'); steps.push('flower cup / course 2 / ok');
    await press(p, 'ArrowRight', 'Enter', 'Enter');
    await p.waitForURL(/track=/, { timeout: 10000 }); steps.push('char -> race');
    const url = new URL(p.url()).search;
    await waitPlayer(p); await waitRace(p);
    const bad = [];
    if (!/track=frappe/.test(url) || !/cc=150/.test(url) || !/mode=mario_gp/.test(url)) bad.push(`unexpected race URL ${url}`);
    return { steps, url, bad, errors: w.errors };
  } catch (e) { return { steps, bad: [`stuck after "${steps.at(-1)}": ${String(e).split('\n')[0]}`], errors: w.errors }; }
  finally { await w.close(); }
}
// menus: 1P BATTLE -> arena 3 -> race URL; 1P TIME TRIALS -> URL races 100cc
async function menusModes() {
  const w = await open('menus-modes'), p = w.page, steps = [], urls = [];
  try {
    await toGameSelect(p);
    await press(p, 'Enter', 'ArrowDown', 'ArrowDown', 'Enter'); await waitShown(p, 'menu'); steps.push('1P battle');
    await press(p, 'ArrowDown', 'ArrowDown', 'Enter', 'Enter'); await waitShown(p, 'char'); steps.push('arena 3 / ok');
    await press(p, 'Enter', 'Enter'); await p.waitForURL(/track=/, { timeout: 10000 }); urls.push(new URL(p.url()).search); steps.push('battle race');
    await waitPlayer(p);
    await press(p, 'KeyM'); await p.waitForURL(u => !new URL(u).search, { timeout: 10000 }); steps.push('M -> menu');
    await toGameSelect(p);
    await press(p, 'Enter', 'ArrowDown', 'Enter'); await waitShown(p, 'menu'); steps.push('1P time trials');
    await press(p, 'Enter', 'Enter', 'Enter'); await waitShown(p, 'char');
    await press(p, 'Enter', 'Enter'); await p.waitForURL(/track=/, { timeout: 10000 }); urls.push(new URL(p.url()).search); steps.push('time trial race');
    await waitPlayer(p);
    const bad = [];
    if (!/track=double-deck/.test(urls[0]) || !/mode=battle/.test(urls[0])) bad.push(`battle URL ${urls[0]}`);
    if (!/mode=time_trials/.test(urls[1]) || !/cc=100/.test(urls[1])) bad.push(`time trial URL ${urls[1]}`);
    return { steps, urls, bad, errors: w.errors };
  } catch (e) { return { steps, urls, bad: [`stuck after "${steps.at(-1)}": ${String(e).split('\n')[0]}`], errors: w.errors }; }
  finally { await w.close(); }
}
// keyboard: up drives forward, restart (Backspace) resets the race, G cycles HD, N toggles music, M returns to the menu
async function keyboard() {
  const w = await open('keyboard'), p = w.page, bad = [];
  try {
    await p.goto(`${BASE}?track=luigi&char=mario&mode=mario_gp&cc=150`);
    await waitPlayer(p); await waitRace(p);
    const s0 = await p.evaluate(() => window.__game.player.progress);
    await p.keyboard.down('ArrowUp'); await sleep(6000);
    const r1 = await p.evaluate(() => ({ progress: window.__game.player.progress, v: window.__game.player.v, t: window.__game.raceTime }));
    await p.keyboard.down('ArrowLeft'); await sleep(1500); await p.keyboard.up('ArrowLeft');
    await p.keyboard.up('ArrowUp');
    if (!(r1.progress > s0 + 20)) bad.push(`holding up moved only ${(r1.progress - s0).toFixed(1)}`);
    const res0 = await p.evaluate(() => document.getElementById('res').textContent);
    await press(p, 'KeyG'); await sleep(1500);
    const res1 = await p.evaluate(() => document.getElementById('res').textContent);
    if (res0 === res1) bad.push(`G did not change the HD preset (${res0})`);
    await press(p, 'KeyN', 'KeyN');
    await press(p, 'Backspace'); await sleep(500);
    const after = await p.evaluate(() => ({ state: window.__game.state, t: window.__game.raceTime, progress: window.__game.player.progress }));
    if (after.state !== 'countdown' || after.t > 1) bad.push(`restart left state ${after.state} t ${after.t}`);
    await press(p, 'KeyM'); await p.waitForURL(u => !new URL(u).search, { timeout: 10000 });
    await waitShown(p, 'title', 30000);
    return { r1, res0, res1, after, bad, errors: w.errors };
  } catch (e) { bad.push(String(e).split('\n')[0]); return { bad, errors: w.errors }; }
  finally { await w.close(); }
}
// online: two windows quick-match a 2-player room on LOBBY, both must see 2 humans and race
async function online() {
  const lobby = process.env.LOBBY, ws = [await open('online-a'), await open('online-b')];
  try {
    const q = `?track=moomoo&char=mario&cc=150&mode=vs&players=2&lobby=${encodeURIComponent(lobby)}`;
    await ws[0].page.goto(BASE + q); await sleep(1500); await ws[1].page.goto(BASE + q.replace('char=mario', 'char=luigi'));
    await Promise.all(ws.map(w => w.page.waitForFunction(() => window.__game && window.__game.state === 'race', null, { timeout: 90000 })));
    await sleep(8000);
    const s = await Promise.all(ws.map(w => w.page.evaluate(() => ({ karts: window.__game.karts.length,
      humans: window.__game.karts.filter(k => !k.cpu).length, t: +window.__game.raceTime.toFixed(1) }))));
    const bad = s.some(x => x.humans < 2) ? ['a window does not see the other player'] : [];
    return { s, bad, errors: ws.flatMap(w => w.errors) };
  } catch (e) { return { bad: [String(e).split('\n')[0]], errors: ws.flatMap(w => w.errors) }; }
  finally { await Promise.all(ws.map(w => w.close())); }
}

const CHARS = ['mario', 'luigi', 'yoshi', 'toad', 'donkeykong', 'wario', 'peach', 'bowser'];
const S = {
  'menus-gp': menusGp, 'menus-modes': menusModes, keyboard,
  ...Object.fromEntries(['big-donut', 'block-fort', 'double-deck', 'skyscraper'].map(id => [`battle-${id}`, () => battle(id)])),
  ...Object.fromEntries(['luigi', 'koopa', 'bowser', 'banshee'].map(id => [`mirror-${id}`, () => race(`mirror-${id}`, `track=${id}&char=mario&cc=extra&mode=mario_gp`,
    r => r.mirrored ? [] : ['canvas not mirrored'])])),
  '50cc-moomoo': () => race('50cc-moomoo', 'track=moomoo&char=mario&cc=50&mode=mario_gp'),
  '100cc-kalimari': () => race('100cc-kalimari', 'track=kalimari&char=mario&cc=100&mode=mario_gp'),
  'tt-mario': () => race('tt-mario', 'track=mario&char=mario&cc=100&mode=time_trials', r => r.karts === 1 ? [] : [`time trial has ${r.karts} karts`]),
  'vs-yoshi': () => race('vs-yoshi', 'track=yoshi&char=mario&cc=150&mode=vs'),
  ...Object.fromEntries(CHARS.map(c => [`char-${c}`, () => race(`char-${c}`, `track=moomoo&char=${c}&cc=150&mode=mario_gp`)])),
  ...(process.env.LOBBY ? { online } : {}),
};
const names = process.argv.slice(2).length ? process.argv.slice(2) : Object.keys(S);
const results = {};
let fail = 0;
try {
  const queue = [...names];
  await Promise.all(Array.from({ length: Math.min(PARALLEL, queue.length) }, async () => {
    for (let n; (n = queue.shift());) {
      const t0 = Date.now();
      let r;
      try { r = await S[n](); } catch (e) { r = { bad: [String(e).split('\n')[0]], errors: [] }; }
      r.errors = [...new Set(r.errors)].slice(0, 6);
      r.wallSec = Math.round((Date.now() - t0) / 1000);
      const ok = !r.bad.length && !r.errors.length;
      if (!ok) fail++;
      results[n] = { ok, ...r };
      console.log(`${ok ? 'PASS' : 'FAIL'} ${n.padEnd(22)} ${JSON.stringify(r)}`);
    }
  }));
} finally {
  writeFileSync(`${OUT}/results.json`, JSON.stringify(results, null, 1));
  await browser.close(); vite.kill();
}
console.log(`${names.length - fail}/${names.length} scenarios passed (screenshots + results.json in ${OUT})`);
process.exit(fail ? 1 : 0);
