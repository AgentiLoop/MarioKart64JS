// Course view sweep: looks for flat white or black masses (untextured or missing-texture geometry) on every race
// course. For each of STATIONS points along the course path the race camera is placed behind the path point at the
// player's chase distance and height, the scene is rendered, and the lower two thirds of the frame (below the sky) are
// scanned for pixels whose 3x3 neighbourhood varies < 4 per channel and are near-white (all > 200) or near-black
// (all < 16). Sample pixels of each kind are raycast to the mesh that drew them (course batches are named by texture,
// 'shade' when untextured) with the vertex colour and the hit point in MK64 units.
// usage: node tools/test-course-view.mjs [course ids...]   (PLAYWRIGHT=path/to/playwright-core, STATIONS=n,
// VIEW=n saves view n of each course as /tmp/course-view-<id>-<n>.png)
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { writeFileSync } from 'node:fs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const pw = process.env.PLAYWRIGHT || '/private/tmp/mk64-browser-check/node_modules/playwright-core';
const { chromium } = createRequire(import.meta.url)(pw);
const ALL = ['luigi', 'moomoo', 'koopa', 'kalimari', 'toad', 'frappe', 'choco', 'mario',
  'wario', 'sherbet', 'royal', 'bowser', 'dk', 'yoshi', 'banshee', 'rainbow'];
const courses = process.argv.slice(2).length ? process.argv.slice(2) : ALL;
const STATIONS = +process.env.STATIONS || 120, VIEW = process.env.VIEW === undefined ? -1 : +process.env.VIEW;

const port = 5300 + Math.floor(Math.random() * 500);
const vite = spawn('npx', ['vite', '--port', String(port), '--strictPort'], { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'] });
await new Promise(r => vite.stdout.on('data', d => { if (String(d).includes('Local')) r(); }));
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--ignore-gpu-blocklist'] });

// runs in the page: one synchronous sweep, so the game loop never moves the camera in between
async function sweep([stations, view]) {
  const T = await import('/node_modules/.vite/deps/three.js');
  const g = window.__game, cam = g.camera, tr = g.track, p = g.player, gl = g.renderer.domElement;
  // the chase camera's distance behind and height above the kart, measured from the live race camera
  const off = cam.position.clone().sub(p.world ?? p.mesh.position);
  const back = Math.hypot(off.x, off.z), up = off.y;
  const saved = { pos: cam.position.clone(), quat: cam.quaternion.clone(), up: cam.up.clone() };
  const c2 = document.createElement('canvas');
  c2.width = gl.width; c2.height = gl.height;
  const x2 = c2.getContext('2d', { willReadFrequently: true });
  const rc = new T.Raycaster(), hits = {}, frames = [];
  for (let s = 0; s < stations; s++) {
    const i = Math.floor(s * tr.n / stations), at = tr.pos[i], dir = tr.T[i].clone().setY(0).normalize();
    cam.up.set(0, 1, 0);
    cam.position.copy(at).addScaledVector(dir, -back).setY(at.y + up);
    cam.lookAt(at.x + dir.x * back, at.y, at.z + dir.z * back);
    cam.updateMatrixWorld();
    tr.showOffCourse?.(cam); tr.updateWater?.(cam);   // as renderViews does before each render
    g.renderer.render(g.scene, cam);
    x2.drawImage(gl, 0, 0);
    const { data: d, width: w, height: h } = x2.getImageData(0, 0, c2.width, c2.height);
    const f = { station: s, i, white: 0, black: 0, pts: { white: [], black: [] } };
    if (s === view) frames.png = c2.toDataURL('image/png');
    let n = 0;
    for (let y = Math.floor(h / 3) + 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
      const k = (y * w + x) * 4;
      let flat = true;
      for (let dy = -1; dy <= 1 && flat; dy++) for (let dx = -1; dx <= 1 && flat; dx++) {
        const j = ((y + dy) * w + x + dx) * 4;
        if (Math.abs(d[j] - d[k]) > 3 || Math.abs(d[j + 1] - d[k + 1]) > 3 || Math.abs(d[j + 2] - d[k + 2]) > 3) flat = false;
      }
      n++;
      if (!flat) continue;
      const kind = d[k] > 200 && d[k + 1] > 200 && d[k + 2] > 200 ? 'white' : d[k] < 16 && d[k + 1] < 16 && d[k + 2] < 16 ? 'black' : null;
      if (!kind) continue;
      f[kind]++;
      if (x % 16 === 0 && y % 16 === 0) f.pts[kind].push([x, y]);
    }
    f.white /= n; f.black /= n;
    for (const kind of ['white', 'black']) for (const [x, y] of f.pts[kind]) {
      rc.setFromCamera(new T.Vector2(x / w * 2 - 1, 1 - y / h * 2), cam);
      const hit = rc.intersectObjects(g.scene.children, true).find(q => q.object.isMesh && q.object.visible);
      const col = hit && hit.face && hit.object.geometry.attributes.color;
      const name = hit ? `${hit.object.name || hit.object.type}${col ? ` rgb(${[col.getX(hit.face.a), col.getY(hit.face.a), col.getZ(hit.face.a)].map(c => Math.round(c * 255))})` : ''}` : 'nothing (sky/background)';
      const e = (hits[kind + ' ' + name] ??= { n: 0, stations: new Set(), at: hit && hit.point.toArray().map(c => Math.round(c * 10)) });
      e.n++; e.stations.add(s);
    }
    delete f.pts;
    frames.push(f);
  }
  cam.position.copy(saved.pos); cam.quaternion.copy(saved.quat); cam.up.copy(saved.up);
  const worst = kind => frames.reduce((a, b) => (b[kind] > a[kind] ? b : a));
  return {
    worst: { white: worst('white'), black: worst('black') }, png: frames.png,
    hits: Object.entries(hits).sort((a, b) => b[1].n - a[1].n)
      .map(([k, v]) => `${k} x${v.n} in ${v.stations.size} views${v.at ? ' @' + v.at : ''}`),
  };
}

try {
  for (const id of courses) {
    const page = await browser.newPage({ viewport: { width: 480, height: 360 } });
    try {
      await page.goto(`http://localhost:${port}/?track=${id}&char=mario&cc=150&mode=mario_gp&autopilot`);
      await page.waitForFunction(() => window.__game && window.__game.player && window.__game.state === 'race', null, { timeout: 90000 });
      await page.waitForTimeout(1000);
      const r = await page.evaluate(sweep, [STATIONS, VIEW]);
      if (r.png) writeFileSync(`/tmp/course-view-${id}-${VIEW}.png`, Buffer.from(r.png.split(',')[1], 'base64'));
      const pct = v => +(v * 100).toFixed(1);
      console.log(`${id.padEnd(9)} worst white ${pct(r.worst.white.white)}% (view ${r.worst.white.station})  worst black ${pct(r.worst.black.black)}% (view ${r.worst.black.station})`);
      for (const h of r.hits.slice(0, 12)) console.log(`    ${h}`);
    } catch (e) {
      console.log(`${id.padEnd(9)} ERROR ${e}`);
    } finally {
      await page.close().catch(() => {});
    }
  }
} finally {
  await browser.close(); vite.kill();
}
