// 3D title screen (3 key on the title): the START_MENU art redone in 3D. MK64's background_blue_sky.png is one
// flat 320x240 picture (sky, hills, road and the five drivers all painted in), so the sky, the hills and the
// road are built here and the drivers are the Wii karts from kart3d.js. The flag, logo, PUSH START and copyright
// stay the 2D overlays drawn over this canvas. Layout follows the art: Wario front left, Bowser behind him,
// Mario front right, Peach behind Mario, Toad coming out of the right-hand bend; the camera sits low on the road
// ahead of them and they drive at it, so the road scrolls under them instead of the karts moving. Like the art it is a
// wide, low lens (64 deg, looking up ~12 deg) with the front karts close and turned well off-axis, so Wario / Mario /
// Toad show a lot of their side instead of facing the camera head-on.
import * as THREE from 'three';
import { buildWiiKart } from './kart3d.js';

const SPEED = 14;   // scene units / s the road scrolls under the karts
// [character, x, z, yaw (rad, + turns the nose to the camera's right)]; scene +z is towards the camera. Placed so
// each kart's screen box matches its driver's box in background_blue_sky.png (to within ~10 of 320x240 pixels).
const GRID = [
  ['mario', 2.23, -7.9, -0.15],
  ['wario', -2.96, -9.8, 0.55],
  ['bowser', 0.02, -16.33, 0.12],
  ['peach', 5.47, -11.59, -0.25],
  ['toad', 11.12, -18.37, -0.7],
];

function canvasTex(w, h, draw, repeat = false) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 8;
  return t;
}

// deep N64 blue fading lighter at the horizon, streaky cumulus drawn as clusters of soft ellipses
function skyTexture() {
  return canvasTex(2048, 1024, (g, w, h) => {
    const grad = g.createLinearGradient(0, 0, 0, h / 2);
    grad.addColorStop(0, '#00109a'); grad.addColorStop(0.55, '#0a2fc8'); grad.addColorStop(1, '#3d6ff0');
    g.fillStyle = grad; g.fillRect(0, 0, w, h);
    let seed = 7; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    // the title camera sees elevations -1..27 degrees, canvas rows 0.35h..0.5h: the clouds sit there, smaller near the horizon
    for (let i = 0; i < 110; i++) {
      const cy = h * (0.28 + 0.21 * rnd()), cx = w * rnd(), n = 6 + 10 * rnd(), sc = 1.6 - 1.1 * (cy / h - 0.28) / 0.21;
      for (let j = 0; j < n; j++) {
        const x = cx + (rnd() - 0.5) * 110 * sc, y = cy + (rnd() - 0.5) * 14 * sc, rx = (12 + 26 * rnd()) * sc, ry = rx * (0.3 + 0.25 * rnd());
        for (const dx of [-w, 0, w]) {   // wraps round the seam
          const rg = g.createRadialGradient(x + dx, y, 0, x + dx, y, rx);
          rg.addColorStop(0, `rgba(255,255,255,${0.25 + 0.3 * rnd()})`); rg.addColorStop(1, 'rgba(255,255,255,0)');
          g.save(); g.translate(x + dx, y); g.scale(1, ry / rx); g.translate(-(x + dx), -y);
          g.fillStyle = rg; g.beginPath(); g.arc(x + dx, y, rx, 0, Math.PI * 2); g.fill(); g.restore();
        }
      }
    }
  });
}

// mottled grass for the hills
function grassTexture() {
  return canvasTex(512, 512, (g, w, h) => {
    g.fillStyle = '#4c8a12'; g.fillRect(0, 0, w, h);
    let seed = 3; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    for (let i = 0; i < 2500; i++) {
      const x = w * rnd(), y = h * rnd(), r = 3 + 14 * rnd(), l = 20 + 25 * rnd();
      g.fillStyle = `hsla(${88 + 20 * rnd()},70%,${l}%,0.35)`;
      for (const [dx, dy] of [[0, 0], [-w, 0], [w, 0], [0, -h], [0, h]]) { g.beginPath(); g.arc(x + dx, y + dy, r, 0, Math.PI * 2); g.fill(); }
    }
  }, true);
}

// asphalt with the art's motion-blur streaks running along the road (v = along)
function roadTexture() {
  return canvasTex(256, 512, (g, w, h) => {
    g.fillStyle = '#48474a'; g.fillRect(0, 0, w, h);
    let seed = 11; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    for (let i = 0; i < 900; i++) {
      const x = w * rnd(), y = h * rnd(), len = 30 + 160 * rnd(), l = 15 + 45 * rnd();
      g.strokeStyle = `hsla(240,3%,${l}%,${0.25 + 0.35 * rnd()})`; g.lineWidth = 0.6 + 2 * rnd();
      for (const dy of [-h, 0, h]) { g.beginPath(); g.moveTo(x, y + dy); g.lineTo(x, y + dy + len); g.stroke(); }
    }
  }, true);
}

// red / white kerb blocks along v
function kerbTexture() {
  return canvasTex(32, 128, (g, w, h) => {
    g.fillStyle = '#f4f4f4'; g.fillRect(0, 0, w, h);
    g.fillStyle = '#e02018'; g.fillRect(0, 0, w, h / 2);
  }, true);
}

// soft white puff for the tyre smoke
function puffTexture() {
  return canvasTex(64, 64, (g, w) => {
    const rg = g.createRadialGradient(w / 2, w / 2, 0, w / 2, w / 2, w / 2);
    rg.addColorStop(0, 'rgba(235,235,235,0.9)'); rg.addColorStop(0.5, 'rgba(220,220,220,0.45)'); rg.addColorStop(1, 'rgba(220,220,220,0)');
    g.fillStyle = rg; g.fillRect(0, 0, w, w);
  });
}

// the road's centreline: straight past the camera, then bending away to the right behind the pack
function roadPoint(t) {   // t = distance along the road from z = 6, just behind the camera
  const bend = Math.max(0, t - 12);
  const R = 30, a = bend / R;   // right-hand bend of radius R
  if (bend === 0) return { x: 0, z: 6 - t, ang: 0 };
  return { x: R - R * Math.cos(a), z: 6 - 12 - R * Math.sin(a), ang: a };
}
// half width: narrow at the camera so the kerbs show at the bottom corners as in the art, widening into the bend
// so Peach and Toad (further right in the art than one road width allows) are still on it
const roadHalf = t => 3.9 + Math.min(6.5, Math.max(0, t - 14) * 0.7);

// a flat ribbon offset from(t)..to(t) across the centreline (+ = right), v running along the road in units / vScale
function ribbon(from, to, y, length, vScale, mat) {
  const n = 120, pos = [], uv = [], idx = [];
  for (let i = 0; i <= n; i++) {
    const t = -8 + (length + 8) * i / n, p = roadPoint(Math.max(0, t)), z0 = t < 0 ? p.z - t : p.z;
    const rx = Math.cos(p.ang), rz = -Math.sin(p.ang);   // right of the road direction
    for (const [o, u] of [[from(t), 0], [to(t), 1]]) { pos.push(p.x + rx * o, y, z0 + rz * o); uv.push(u, t / vScale); }
    if (i < n) { const k = i * 2; idx.push(k, k + 1, k + 2, k + 1, k + 3, k + 2); }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geo.setIndex(idx); geo.computeVertexNormals();
  const m = new THREE.Mesh(geo, mat); m.receiveShadow = true;
  return m;
}

export function createTitle3D(canvas) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(64, 4 / 3, 0.1, 3000);
  camera.position.set(0.29, 1.3, -1.4);
  camera.lookAt(0.69, 4.3, -14.9);

  const sky = new THREE.Mesh(new THREE.SphereGeometry(1500, 48, 24), new THREE.MeshBasicMaterial({ map: skyTexture(), side: THREE.BackSide, fog: false }));
  sky.rotation.y = 1.2;
  scene.add(sky);
  scene.fog = new THREE.Fog(0x4a78e8, 120, 700);

  scene.add(new THREE.HemisphereLight(0xcfe0ff, 0x4a5a30, 1.4));
  const sun = new THREE.DirectionalLight(0xffffff, 2.6);
  sun.position.set(-12, 30, 22); sun.target.position.set(1, 0, -10);
  sun.castShadow = true; sun.shadow.mapSize.set(2048, 2048);
  Object.assign(sun.shadow.camera, { left: -16, right: 16, top: 16, bottom: -16, near: 1, far: 90 });
  scene.add(sun, sun.target);

  // grass out to the horizon, the road and its kerbs on top
  const grassTex = grassTexture(); grassTex.repeat.set(200, 200);
  const grass = new THREE.Mesh(new THREE.PlaneGeometry(2000, 2000), new THREE.MeshLambertMaterial({ map: grassTex }));
  grass.rotation.x = -Math.PI / 2; grass.receiveShadow = true;
  scene.add(grass);
  const roadTex = roadTexture(), kerbTex = kerbTexture();
  const KERB = 1.2, LEN = 160;
  scene.add(ribbon(t => -roadHalf(t), roadHalf, 0.02, LEN, 6, new THREE.MeshLambertMaterial({ map: roadTex })));
  for (const s of [-1, 1]) scene.add(ribbon(t => s * roadHalf(t), t => s * (roadHalf(t) + KERB), 0.03, LEN, 4, new THREE.MeshLambertMaterial({ map: kerbTex })));

  // hills: squashed, lumpy domes sized and placed from the art (the big one at the left peaking ~11° up, a smaller
  // one behind Bowser)
  const hillMat = new THREE.MeshLambertMaterial({ map: grassTex.clone() });
  hillMat.map.repeat.set(6, 3); hillMat.map.needsUpdate = true;
  for (const [x, z, r, hgt, sx] of [[-50, -94, 64, 35, 1], [14.6, -107, 12.5, 17.5, 1]]) {
    const geo = new THREE.SphereGeometry(r, 48, 24, 0, Math.PI * 2, 0, Math.PI / 2), p = geo.attributes.position;
    for (let i = 0; i < p.count; i++) {   // a few low-frequency lumps so they read as hills, not domes
      const vx = p.getX(i), vy = p.getY(i), vz = p.getZ(i), k = 1 + 0.08 * Math.sin(vx * 0.11 + x) * Math.cos(vz * 0.09 + z) + 0.05 * Math.sin(vy * 0.2);
      p.setXYZ(i, vx * k, vy * k, vz * k);
    }
    geo.computeVertexNormals();
    const h = new THREE.Mesh(geo, hillMat);
    h.position.set(x, 0, z); h.scale.set(sx, hgt / r, 0.35);
    scene.add(h);
  }

  // the five karts driving at the camera (each Wii kart faces -z, turned round)
  const karts = [];
  for (const [ch, x, z, yaw] of GRID) {
    const holder = new THREE.Group();
    holder.position.set(x, 0, z); holder.rotation.y = Math.PI + yaw;
    holder.userData.phase = Math.random() * 6;
    scene.add(holder);
    karts.push(holder);
    buildWiiKart(ch).then(m => { holder.add(m); holder.userData.model = m; }, err => console.error(err));
  }

  // tyre smoke: puffs left behind the rear tyres drift away with the road and swell
  const puffMat = new THREE.SpriteMaterial({ map: puffTexture(), depthWrite: false, fog: false });
  const puffs = [];
  for (let i = 0; i < 90; i++) { const s = new THREE.Sprite(puffMat.clone()); s.visible = false; scene.add(s); puffs.push({ s, age: 1 }); }
  let nextPuff = 0, puffClock = 0;

  let last = 0;
  return {
    step(now, pixelW, pixelH) {
      if (canvas.width !== pixelW || canvas.height !== pixelH) renderer.setSize(pixelW, pixelH, false);
      const dt = last ? Math.min(0.05, (now - last) / 1000) : 0; last = now;
      const t = now / 1000;
      roadTex.offset.y -= SPEED * dt / 6; kerbTex.offset.y -= SPEED * dt / 4;
      sky.rotation.y += dt * 0.004;
      for (const k of karts) {   // engine judder and a little weave
        const ph = k.userData.phase;
        k.position.y = 0.03 * Math.abs(Math.sin(t * 17 + ph));
        k.rotation.z = 0.015 * Math.sin(t * 2.3 + ph);
        k.userData.model?.userData.update(0.15 * Math.sin(t * 1.1 + ph), SPEED, dt);
      }
      puffClock += dt;
      while (puffClock > 0.03) {
        puffClock -= 0.03;
        const k = karts[Math.floor(Math.random() * karts.length)], p = puffs[nextPuff++ % puffs.length];
        const side = Math.random() < 0.5 ? -1 : 1;
        p.s.position.set(side * 1.1, 0.35, 0.9).applyMatrix4(k.matrixWorld);   // rear tyre (kart space: +z is behind once turned round)
        p.age = 0; p.spin = Math.random() * 6; p.s.visible = true;
      }
      for (const p of puffs) {
        if (!p.s.visible) continue;
        p.age += dt;
        if (p.age > 0.9) { p.s.visible = false; continue; }
        p.s.position.z -= SPEED * dt; p.s.position.y += 0.6 * dt;
        p.s.scale.setScalar(0.5 + 2.2 * p.age);
        p.s.material.opacity = 0.75 * (1 - p.age / 0.9);
        p.s.material.rotation = p.spin + p.age;
      }
      renderer.render(scene, camera);
    },
    dispose() { renderer.dispose(); },
    scene, camera, karts,
  };
}
