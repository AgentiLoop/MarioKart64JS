// Autopilot race test: Mario (the player kart) is driven by the CPU driver (?autopilot) for 3 laps on every race
// course, in Google Chrome via playwright-core. Reports lap times, place, stalls and page errors per course, and
// "hidden": how many of the 0.3 s samples had course geometry between the kart and the chase camera (by mesh), and
// "clip": how many had a face closer than the camera's near plane (the view cuts through it), and "snap": rendered
// frames where the camera jumped more than 1.5 units against the kart (a jerk), by where the kart was.
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

// SHOTS=dir: every 3 s of the race, screenshot the page and measure the lower two thirds (below the sky) for
// flat untextured masses: pixels whose 3x3 neighbourhood varies < 4 per channel and are near-white (all > 200)
// or near-black (all < 16). The worst frame of each kind is saved as dir/<id>-white.png / <id>-black.png.
const SHOTS = process.env.SHOTS;
if (SHOTS) (await import('node:fs')).mkdirSync(SHOTS, { recursive: true });
const flatStats = async b64 => {
  const img = new Image();
  img.src = 'data:image/png;base64,' + b64;
  await img.decode();
  const c = document.createElement('canvas');
  c.width = img.width; c.height = img.height;
  const x2 = c.getContext('2d', { willReadFrequently: true });
  x2.drawImage(img, 0, 0);
  const { data: d, width: w, height: h } = x2.getImageData(0, 0, c.width, c.height);
  let white = 0, black = 0, n = 0;
  const at = { white: [], black: [] };   // sample pixels (every 24th) of each kind, for pickMeshes
  for (let y = Math.floor(h / 3) + 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
    const i = (y * w + x) * 4;
    let flat = true;
    for (let dy = -1; dy <= 1 && flat; dy++) for (let dx = -1; dx <= 1 && flat; dx++) {
      const j = ((y + dy) * w + x + dx) * 4;
      if (Math.abs(d[j] - d[i]) > 3 || Math.abs(d[j + 1] - d[i + 1]) > 3 || Math.abs(d[j + 2] - d[i + 2]) > 3) flat = false;
    }
    n++;
    if (!flat) continue;
    const kind = d[i] > 200 && d[i + 1] > 200 && d[i + 2] > 200 ? 'white' : d[i] < 16 && d[i + 1] < 16 && d[i + 2] < 16 ? 'black' : null;
    if (!kind) continue;
    if (kind === 'white') white++; else black++;
    if (x % 24 === 0 && y % 24 === 0) at[kind].push([x, y]);
  }
  return { white: white / n, black: black / n, at };
};
// what the camera sees at those screen pixels: the first mesh hit (course batches are named by texture, 'shade' when
// untextured) and the hit point in world units. Counts per name, most common first.
const pickMeshes = async pts => {
  const T = await import('/node_modules/.vite/deps/three.js');
  const g = window.__game, rc = new T.Raycaster(), r = g.renderer.domElement.getBoundingClientRect(), count = {};
  for (const [x, y] of pts) {
    rc.setFromCamera(new T.Vector2((x - r.left) / r.width * 2 - 1, 1 - (y - r.top) / r.height * 2), g.camera);
    const hit = rc.intersectObjects(g.scene.children, true).find(i => i.object.isMesh && i.object.visible);
    const col = hit && hit.face && hit.object.geometry.attributes.color;
    const name = hit ? `${hit.object.name || hit.object.type}${col ? ` rgb(${[col.getX(hit.face.a), col.getY(hit.face.a), col.getZ(hit.face.a)].map(c => Math.round(c * 255))})` : ''}` : 'nothing (sky/background)';
    (count[name] ??= { n: 0, at: hit && hit.point.toArray().map(c => Math.round(c * 10)) }).n++;   // MK64 units (NATIVE_SCALE 0.1)
  }
  return Object.entries(count).sort((a, b) => b[1].n - a[1].n).map(([k, v]) => `${k} x${v.n}${v.at ? ' @' + v.at : ''}`);
};

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
    let settled = false;
    const run = page.evaluate(async limit => {
      const T = await import('/node_modules/.vite/deps/three.js');
      return new Promise(done => {
      const g = window.__game, p = g.player, laps = [];
      let lastLap = p.crossings, best = p.progress, bestAt = 0, stalls = 0, rescues = 0, wasRescue = false, minV = 1e9;
      // camera behind the course: course geometry between the kart (1.6 above it) and the race camera hides the kart.
      // Sampled every 0.3 s of the race; counts per mesh name with the first hit point (MK64 units) and race time.
      const rc = new T.Raycaster(), eye = new T.Vector3(), dir = new T.Vector3(), hidden = {}, clip = {};
      let looks = 0, polls = 0, over = false;
      // "snap": rendered frames where the race camera jumped against the kart (its offset from the kart changed by
      // more than 1.5 units since the previous frame: a pull in front of a face or a push off a wall, seen as a jerk)
      const off = new T.Vector3(), prevOff = new T.Vector3(), snap = {};
      let frames = 0, had = false;
      const frame = () => {
        if (over) return;
        if (g.state === 'race' && !p.finished && !p.rescue) {
          off.copy(g.camera.position).sub(p.world);
          const d = off.distanceTo(prevOff);
          frames++;
          if (had && d > 1.5) {
            const k = `${p.world.toArray().map(c => Math.round(c / 5) * 50)}`;   // MK64 units, 50-unit cells
            const e = snap[k] ??= { n: 0, max: 0, rt: +g.raceTime.toFixed(1), in: 0, out: 0 };
            e.n++;
            if (off.length() < prevOff.length()) e.in++; else e.out++;   // pulled in toward the kart or let out
            e.max = Math.max(e.max, +d.toFixed(1));
          }
          prevOff.copy(off); had = true;
        } else had = false;
        requestAnimationFrame(frame);
      };
      requestAnimationFrame(frame);
      const t = setInterval(() => {
        const rt = g.raceTime;
        if (g.state === 'race' && !p.finished && !p.rescue && ++polls % 3 === 0 && g.track.group) {
          looks++;
          eye.copy(p.world).addScaledVector(p.up, 1.6);
          dir.copy(g.camera.position).sub(eye);
          const len = dir.length();
          rc.set(eye, dir.normalize()); rc.far = len;
          const hit = rc.intersectObject(g.track.group, true).find(i => i.object.isMesh && i.object.visible);
          const mk = v => v.toArray().map(c => Math.round(c * 10));
          if (hit) (hidden[hit.object.name || hit.object.type] ??= { n: 0, at: `${mk(hit.point)} kart ${mk(p.world)} cam ${mk(g.camera.position)}`, rt: +rt.toFixed(1) }).n++;
          // "clip": the near plane cutting into course geometry (a face closer than the near plane at the view's centre,
          // edges or corners), which shows through the face to what is behind it
          const cam = g.camera;
          cam.updateMatrixWorld();
          for (const [sx, sy] of [[0, 0], [-1, -1], [1, -1], [-1, 1], [1, 1], [0, -1], [0, 1], [-1, 0], [1, 0]]) {
            dir.set(sx, sy, -1).unproject(cam).sub(cam.position);   // NDC z -1: the near plane
            const d = dir.length();
            rc.set(cam.position, dir.normalize()); rc.far = d;
            const h = rc.intersectObject(g.track.group, true).find(i => i.object.isMesh && i.object.visible);
            if (h) { (clip[h.object.name || h.object.type] ??= { n: 0, at: `${mk(h.point)} kart ${mk(p.world)} cam ${mk(cam.position)}`, rt: +rt.toFixed(1) }).n++; break; }
          }
        }
        if (p.crossings > lastLap) { if (p.crossings >= 1) laps.push(rt); lastLap = p.crossings; }
        if (p.progress > best + 1) { best = p.progress; bestAt = rt; }
        else if (g.state === 'race' && rt - bestAt > 5) { stalls++; bestAt = rt; }
        if (p.rescue > 0 && !wasRescue) rescues++;
        wasRescue = p.rescue > 0;
        if (g.state === 'race' && rt > 5) minV = Math.min(minV, p.v);
        if (p.finished || rt > limit) {
          clearInterval(t); over = true;
          const order = [...g.karts].sort((a, b) => (b.finished - a.finished) || (a.finished ? a.finishTime - b.finishTime : b.progress - a.progress));
          done({ finished: p.finished, time: p.finishTime || rt, laps: laps.map((x, i) => +(x - (laps[i - 1] ?? 0)).toFixed(2)),
            place: order.indexOf(p) + 1, stalls, rescues, autopilot: g.autopilot, minV: +minV.toFixed(1),
            cpusFinished: g.karts.filter(k => !k.isPlayer && k.finished).length,
            cpuTimes: g.karts.filter(k => !k.isPlayer && k.finished).map(k => +k.finishTime.toFixed(1)),
            hidden: { of: looks, n: Object.values(hidden).reduce((a, e) => a + e.n, 0),
              by: Object.entries(hidden).sort((a, b) => b[1].n - a[1].n).slice(0, 4).map(([k, e]) => `${k} x${e.n} @${e.at} t${e.rt}`) },
            clip: { n: Object.values(clip).reduce((a, e) => a + e.n, 0),
              by: Object.entries(clip).sort((a, b) => b[1].n - a[1].n).slice(0, 4).map(([k, e]) => `${k} x${e.n} @${e.at} t${e.rt}`) },
            snap: { of: frames, n: Object.values(snap).reduce((a, e) => a + e.n, 0),
              by: Object.entries(snap).sort((a, b) => b[1].n - a[1].n).slice(0, 4).map(([k, e]) => `kart ${k} x${e.n} (in ${e.in} out ${e.out}) max ${e.max} t${e.rt}`) } });
        }
      }, 100);
      });
    }, LIMIT).finally(() => { settled = true; });
    run.catch(() => {});   // awaited below; keeps a rejection during the screenshot loop from going unhandled
    const worst = { white: { v: -1 }, black: { v: -1 } };
    while (SHOTS && !settled) {
      await new Promise(r => setTimeout(r, 3000));
      if (settled || !await page.evaluate(() => window.__game.state === 'race').catch(() => false)) continue;
      // only the 3D view: hide the HUD and every other page element for the screenshot
      const hide = on => page.evaluate(on => {
        const keep = new Set();
        for (let e = window.__game.renderer.domElement; e; e = e.parentElement) keep.add(e);
        for (const e of document.body.querySelectorAll('*')) {
          if (keep.has(e)) continue;
          if (on) { e.dataset.apVis = e.style.visibility; e.style.visibility = 'hidden'; }
          else { e.style.visibility = e.dataset.apVis ?? ''; delete e.dataset.apVis; }
        }
        window.__game.renderer.domElement.style.visibility = 'visible';
      }, on);
      await hide(true);
      const png = await page.screenshot().catch(() => null);
      await hide(false);
      if (!png) continue;
      const s = await page.evaluate(flatStats, png.toString('base64'));
      const rt = await page.evaluate(() => +window.__game.raceTime.toFixed(1));
      for (const k of ['white', 'black']) if (s[k] > worst[k].v) worst[k] = { v: s[k], rt, png, hits: await page.evaluate(pickMeshes, s.at[k]) };
    }
    const r = await run;
    if (SHOTS) {
      const fs = await import('node:fs');
      r.flat = {};
      for (const k of ['white', 'black']) if (worst[k].png) {
        fs.writeFileSync(`${SHOTS}/${id}-${k}.png`, worst[k].png);
        r.flat[k] = { pct: +(worst[k].v * 100).toFixed(1), at: worst[k].rt, hits: worst[k].hits };
      }
    }
    return r;
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
      const t0 = Date.now();
      let r = await race(id);
      // a Vite full reload (a watched file changed, e.g. by another checkout) restarts the page: run the course again
      if (/context was destroyed/.test(r.error)) r = await race(id);
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
