// Autopilot battle test: Mario (the player kart) is driven by the arena CPU driver (?autopilot&mode=battle) against
// three CPU karts on every battle arena, in Google Chrome via playwright-core. Reports balloons, rescues, stalls,
// wall time and page errors per arena, plus a graphics survey: screenshots from the player's view every few race
// seconds and from an orbit around the arena, each scored for flat white / black pixel masses (untextured or
// unlit surfaces), and the shade-only (untextured) batches of the course with their size and colour.
// usage: node tools/test-battle.mjs [arena ids...]   (PLAYWRIGHT=path/to/playwright-core, PARALLEL=n, SECS=race seconds,
//        SHOTS=/tmp/mk64-battle for the screenshots)
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const pw = process.env.PLAYWRIGHT || '/private/tmp/mk64-browser-check/node_modules/playwright-core';
const { chromium } = createRequire(import.meta.url)(pw);
const ALL = ['big-donut', 'block-fort', 'double-deck', 'skyscraper'];
const arenas = process.argv.slice(2).length ? process.argv.slice(2) : ALL;
const PARALLEL = +process.env.PARALLEL || 2, SECS = +process.env.SECS || 120, SHOTS = process.env.SHOTS || '/tmp/mk64-battle';
const SHOT_EVERY = 10;   // race seconds between player-view screenshots
mkdirSync(SHOTS, { recursive: true });

const port = 5300 + Math.floor(Math.random() * 500);
const vite = spawn('npx', ['vite', '--port', String(port), '--strictPort'], { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'] });
await new Promise(r => vite.stdout.on('data', d => { if (String(d).includes('Local')) r(); }));
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'] });

// in-page: render the scene from `cam` (or the game's camera when null), return the PNG data URL and the fraction of
// pixels that are flat white / flat black, counted over the lower 2/3 of the frame (the sky gradient is above)
const SHOT_FN = `(cam, label) => {
  const g = window.__game, r = g.renderer, gl = r.getContext();
  const W = gl.drawingBufferWidth, H = gl.drawingBufferHeight;
  r.render(g.scene, cam || g.camera);
  const b = new Uint8Array(W * H * 4);
  gl.readPixels(0, 0, W, H, gl.RGBA, gl.UNSIGNED_BYTE, b);
  let white = 0, black = 0, n = 0;
  for (let y = 0; y < (H * 2 / 3) | 0; y++) for (let x = 0; x < W; x++) {   // GL rows start at the bottom
    const i = (y * W + x) * 4, R = b[i], G = b[i + 1], B = b[i + 2];
    n++;
    if (R >= 248 && G >= 248 && B >= 248) white++;
    else if (R <= 6 && G <= 6 && B <= 6) black++;
  }
  const c = document.createElement('canvas'); c.width = W; c.height = H;
  const ctx = c.getContext('2d'), img = ctx.createImageData(W, H);
  for (let y = 0; y < H; y++) img.data.set(b.subarray(y * W * 4, (y + 1) * W * 4), (H - 1 - y) * W * 4);
  ctx.putImageData(img, 0, 0);
  return { label, white: +(white / n).toFixed(3), black: +(black / n).toFixed(3), png: c.toDataURL('image/png') };
}`;

async function battle(id) {
  const page = await browser.newPage({ viewport: { width: 640, height: 480 } });
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  page.on('console', m => { if (m.type() === 'error' && !m.text().startsWith('Failed to load resource')) errors.push(m.text()); });
  page.on('response', r => { if (r.status() >= 400) errors.push(`${r.status()} ${new URL(r.url()).pathname}`); });
  const shots = [];
  const save = s => { writeFileSync(`${SHOTS}/${id}-${s.label}.png`, Buffer.from(s.png.split(',')[1], 'base64')); shots.push({ label: s.label, white: s.white, black: s.black }); };
  try {
    await page.goto(`http://localhost:${port}/?track=${id}&char=mario&mode=battle&autopilot`);
    await page.waitForFunction(() => window.__game && window.__game.player && window.__game.track?.arena, null, { timeout: 60000 });
    await page.waitForFunction(() => {   // every course texture loaded before the survey
      const maps = [];
      window.__game.scene.traverse(o => { if (o.material?.map?.userData?.hd) maps.push(o.material.map); });
      return maps.length && maps.every(t => t.image?.complete && t.image.naturalWidth);
    }, null, { timeout: 60000 }).catch(() => errors.push('textures did not finish loading'));
    // shade-only (untextured) batches: triangles, bounding box (scene units) and mean vertex colour
    const shade = await page.evaluate(() => {
      const out = [];
      window.__game.track.group.traverse(o => {
        if (!o.isMesh || o.name !== 'shade') return;
        const p = o.geometry.attributes.position, c = o.geometry.attributes.color;
        o.geometry.computeBoundingBox();
        const b = o.geometry.boundingBox, rgb = [0, 0, 0];
        for (let i = 0; i < c.count; i++) { rgb[0] += c.getX(i); rgb[1] += c.getY(i); rgb[2] += c.getZ(i); }
        out.push({ tris: p.count / 3, min: b.min.toArray().map(v => +v.toFixed(0)), max: b.max.toArray().map(v => +v.toFixed(0)),
          rgb: rgb.map(v => Math.round(v / c.count * 255)) });
      });
      return out;
    });
    // orbit survey: 8 views around the arena at mid height and one from above, before the karts move
    const orbit = await page.evaluate(SHOT_FN => {
      const shot = eval(SHOT_FN), g = window.__game, b = g.track.bounds;
      const cx = (b.minX + b.maxX) / 2, cz = (b.minZ + b.maxZ) / 2, cy = (b.minY + b.maxY) / 2;
      const r = Math.max(b.maxX - b.minX, b.maxZ - b.minZ) * 0.7, cam = g.camera.clone();
      cam.fov = 60; cam.updateProjectionMatrix();
      const out = [];
      for (let k = 0; k < 8; k++) {
        const a = k * Math.PI / 4;
        cam.position.set(cx + Math.sin(a) * r, b.maxY + r * 0.25, cz + Math.cos(a) * r);
        cam.up.set(0, 1, 0); cam.lookAt(cx, cy, cz); cam.updateMatrixWorld();
        out.push(shot(cam, `orbit${k}`));
      }
      cam.position.set(cx, b.maxY + r * 1.2, cz + 0.01); cam.lookAt(cx, cy, cz); cam.updateMatrixWorld();
      out.push(shot(cam, 'top'));
      return out;
    }, SHOT_FN);
    orbit.forEach(save);
    // the battle: poll balloons, rescues, stalls; a player-view screenshot every SHOT_EVERY race seconds
    const result = await page.evaluate(([limit, SHOT_FN, every]) => new Promise(done => {
      const shot = eval(SHOT_FN), g = window.__game, p = g.player, pops = [], shots = [];
      let rescues = 0, wasRescue = false, stalls = 0, lastX = p.x, lastZ = p.z, movedAt = 0, maxV = 0, nextShot = every, hits = 0, lastHit = 0;
      // every kart's pops with the cause: an item hit (kind, who threw it), lightning, or a Lakitu rescue (fell off)
      const balloons = g.karts.map(k => k.balloons), cause = g.karts.map(() => null), items = g.items;
      const hit0 = items.hit.bind(items), strike0 = items.strike.bind(items);
      items.hit = (k, kind, owner) => { const r = hit0(k, kind, owner); if (r) cause[g.karts.indexOf(k)] = `${kind} by ${owner?.name ?? '?'} at (${k.x.toFixed(0)},${k.y.toFixed(0)},${k.z.toFixed(0)})`; return r; };
      items.strike = k => { strike0(k); cause[g.karts.indexOf(k)] = 'lightning'; };
      const t = setInterval(() => {
        const rt = g.raceTime;
        if (p.rescue > 0 && !wasRescue) rescues++;
        wasRescue = p.rescue > 0;
        if (Math.hypot(p.x - lastX, p.z - lastZ) > 1) { lastX = p.x; lastZ = p.z; movedAt = rt; }
        else if (g.state === 'race' && !p.out && !(p.rescue > 0) && rt - movedAt > 5) { stalls++; movedAt = rt; }
        g.karts.forEach((k, i) => {
          if (k.rescue > 0 && !cause[i]) cause[i] = `fell off at (${k.lastX?.toFixed(0)},${k.lastY?.toFixed(0)},${k.lastZ?.toFixed(0)}) after ${k.trace?.join(' ') ?? ''}`;
          if (!(k.rescue > 0) && !k.air) {
            k.lastX = k.x; k.lastY = k.y; k.lastZ = k.z;
            // the last second of the driver's state (one entry per poll): speed, reversing / spinning / tumbling /
            // steering round a wall or edge, and what it was chasing
            (k.trace ??= []).push(`v${k.v.toFixed(0)}${k.reverse > 0 ? 'R' : ''}${k.spin > 0 ? 'S' : ''}${k.tumble ? 'T' : ''}${k.avoid ? (k.avoid > 0 ? 'L' : 'r') : ''}${k.goal ? (k.goal.name ? 'k' : 'b') : '-'}`);
            if (k.trace.length > 10) k.trace.shift();
          }
          if (k.balloons !== balloons[i]) { pops.push(`${rt.toFixed(1)}s ${k.name} ${balloons[i]}->${k.balloons}: ${cause[i] ?? '?'}`); balloons[i] = k.balloons; cause[i] = null; }
        });
        if (p.hitWall > 0 && rt - lastHit > 0.5) { hits++; lastHit = rt; }
        maxV = Math.max(maxV, p.v);
        if (g.state === 'race' && rt >= nextShot) { nextShot += every; shots.push(shot(null, `t${Math.round(rt)}`)); }
        if (g.state === 'finished' || rt > limit) {
          clearInterval(t);
          done({ state: g.state, time: +rt.toFixed(1), balloons: g.karts.map(k => `${k.name}:${k.out ? 'OUT' : k.balloons}`), pops, rescues, stalls,
            wallHits: hits, maxV: +maxV.toFixed(1), banner: document.getElementById('banner')?.textContent ?? '', shots });
        }
      }, 100);
    }), [SECS, SHOT_FN, SHOT_EVERY]);
    result.shots.forEach(save);
    delete result.shots;
    return { ...result, shade, shots };
  } catch (e) {
    return { error: String(e), shots };
  } finally {
    await page.close().catch(() => {});
    if (errors.length) console.error(`  [${id}] page errors: ${[...new Set(errors)].slice(0, 5).join(' | ')}`);
  }
}

const results = {};
let fail = 0;
try {
  const queue = [...arenas];
  await Promise.all(Array.from({ length: Math.min(PARALLEL, queue.length) }, async () => {
    for (let id; (id = queue.shift());) {
      const t0 = Date.now(), r = await battle(id);
      r.wallSec = Math.round((Date.now() - t0) / 1000);
      results[id] = r;
      // Big Donut and Skyscraper have a black sky (NATIVE_SKY) and sit in a void, so black masses are only reported
      const flat = r.shots.filter(s => s.white > 0.15);
      const ok = !r.error && r.stalls === 0 && !flat.length;
      if (!ok) fail++;
      const { shots, shade, ...rest } = r;
      console.log(`${ok ? 'PASS' : 'FAIL'} ${id.padEnd(11)} ${JSON.stringify(rest)}`);
      if (shade?.length) console.log(`  shade batches: ${shade.map(s => `${s.tris}tri rgb(${s.rgb}) [${s.min}]..[${s.max}]`).join('; ')}`);
      console.log(`  shots: ${shots.map(s => `${s.label} w${s.white} b${s.black}`).join(', ')}`);
      if (flat.length) console.log(`  flat masses: ${flat.map(s => `${SHOTS}/${id}-${s.label}.png`).join(' ')}`);
    }
  }));
} finally {
  await browser.close(); vite.kill();
}
writeFileSync(`${SHOTS}/report.json`, JSON.stringify(results, null, 1));
console.log(`${arenas.length - fail}/${arenas.length} arenas clean`);
process.exit(fail ? 1 : 0);
