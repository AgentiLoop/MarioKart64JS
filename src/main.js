import * as THREE from 'three';
import { Track, TRACKS, loadNativeCourse, nativeSkyColors, nativeClouds, cloudScreenX, STAR_TWINKLE, NATIVE_SCALE } from './track.js';
import { Kart } from './kart.js';
import { AudioSys } from './audio.js';
import { Items, ITEM_LABELS } from './items.js';

const LAPS = 3;
const canvas = document.getElementById('game');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: false });
renderer.setPixelRatio(1);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;

const scene = new THREE.Scene();
const trackId = new URLSearchParams(location.search).get('track');
const trackDef = TRACKS.find(t => t.id === trackId) || null;   // null -> show the track menu
const th = (trackDef || TRACKS[0]).theme;
const skyTop = new THREE.Color(th.skyTop), skyBot = new THREE.Color(th.skyBot);
scene.background = skyBot;
scene.fog = new THREE.Fog(th.skyBot, 160, 750);
const camera = new THREE.PerspectiveCamera(70, 1, 0.5, 2500);

scene.add(new THREE.HemisphereLight(th.hemiSky, th.hemiGround, 1.35));
const sun = new THREE.DirectionalLight(th.sun, 2.5);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
Object.assign(sun.shadow.camera, { left: -60, right: 60, top: 60, bottom: -60, near: 1, far: 300 });
scene.add(sun, sun.target);

// sky: native courses use MK64's screen-space skybox (render_skybox / func_802A487C):
// two Gouraud quads split at the projected y=0 horizon, colours written unconverted.
const nativeSky = nativeSkyColors((trackDef || TRACKS[0]).id);
let sky;
if (nativeSky) {
  const c = a => new THREE.Vector3(...a.map(v => v / 255));
  sky = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), new THREE.ShaderMaterial({
    depthTest: false, depthWrite: false, fog: false,
    uniforms: { horizon: { value: 0 }, top: { value: c(nativeSky.top) }, hor: { value: c(nativeSky.horizon) },
      below: { value: c(nativeSky.below) }, bottom: { value: c(nativeSky.bottom) } },
    vertexShader: 'varying float y; void main(){ y = position.y; gl_Position = vec4(position.xy, 1., 1.); }',
    fragmentShader: `uniform float horizon; uniform vec3 top, hor, below, bottom; varying float y;
      void main(){
        vec3 c = y >= horizon ? mix(hor, top, clamp((y - horizon) / max(1. - horizon, 1e-4), 0., 1.))
                              : mix(below, bottom, clamp((horizon - y) / max(horizon + 1., 1e-4), 0., 1.));
        gl_FragColor = vec4(c, 1.);
      }`,
  }));
  sky.frustumCulled = false; sky.renderOrder = -1000;
  scene.background = null;
} else {
  sky = new THREE.Mesh(new THREE.SphereGeometry(1800, 24, 12), new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, fog: false,
    uniforms: { top: { value: skyTop }, bot: { value: skyBot } },
    vertexShader: 'varying float h; void main(){ h = normalize(position).y; gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.); }',
    fragmentShader: 'uniform vec3 top; uniform vec3 bot; varying float h; void main(){ gl_FragColor = vec4(mix(bot, top, clamp(h*1.6,0.,1.)),1.); }',
  }));
}
scene.add(sky);
// MK64 projects a y=0 point 30000 units out to find the horizon row; we take that
// point along the camera's horizontal heading (assumption: avoids the original's
// fixed +Z point flipping when facing away).
const _hp = new THREE.Vector3();
let cameraYaw = 0;   // camera->rot[1]: u16 binary angle, atan2s(dx, dz)
function updateSky() {
  if (!nativeSky) return;
  camera.updateMatrixWorld();
  camera.getWorldDirection(_hp); _hp.y = 0;
  if (_hp.lengthSq() < 1e-8) _hp.set(0, 0, -1);
  cameraYaw = Math.round(Math.atan2(_hp.x, _hp.z) * 32768 / Math.PI) & 0xffff;
  _hp.normalize().multiplyScalar(30000 * NATIVE_SCALE).add(camera.position); _hp.y = 0;
  sky.material.uniforms.horizon.value = _hp.project(camera).y;
  updateClouds();
}
window.__sky = nativeSky && { colors: nativeSky, get horizon() { return sky.material.uniforms.horizon.value; } };

// Clouds / stars: screen-space quads in MK64's 320x240 frame (func_80051ABC via
// func_80051EBC, 1P). x from func_800788F8, y = horizon row - posY. Drawn after the upper
// sky quad and before func_802A487C's lower quad, so they vanish below the horizon,
// except on Rainbow Road where both sky quads come first. Combine: colour = white
// PRIMITIVE, alpha = TEXEL0 (x star twinkle); G_RM_XLU_SURF, bilinear, clamped.
// Assumption: no ±50° cull (func_800788F8) so widescreen edges don't pop.
const cloudSet = nativeSky && nativeClouds((trackDef || TRACKS[0]).id);
let clouds = null;
if (cloudSet) {
  const n = cloudSet.objects.length;
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 12), 3));
  geo.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(n * 8), 2));
  geo.setAttribute('alpha', new THREE.BufferAttribute(new Float32Array(n * 4).fill(1), 1));
  const idx = [];
  for (let i = 0; i < n; i++) idx.push(4 * i, 4 * i + 3, 4 * i + 1, 4 * i + 1, 4 * i + 3, 4 * i + 2);
  geo.setIndex(idx);
  const map = new THREE.TextureLoader().load(`${import.meta.env?.BASE_URL ?? '/'}mk64/sky/${cloudSet.texture}.png`, t => {
    // per-quad UVs need the frame count (image height / 32); N64 samples texel i at s = i
    const w = cloudSet.stars ? 16 : 64, h = cloudSet.stars ? 16 : 32, rows = t.image.height;
    const uv = geo.attributes.uv;
    cloudSet.objects.forEach((o, i) => {
      const [s0, s1, t0] = [0.5 / w, (w - 0.5) / w, o.frame * h];
      const v0 = (t0 + 0.5) / rows, v1 = (t0 + h - 0.5) / rows;
      uv.array.set([s0, v0, s1, v0, s1, v1, s0, v1], i * 8);
    });
    uv.needsUpdate = true;
  });
  map.flipY = false; map.generateMipmaps = false;
  map.minFilter = map.magFilter = THREE.LinearFilter;
  map.wrapS = map.wrapT = THREE.ClampToEdgeWrapping;
  clouds = new THREE.Mesh(geo, new THREE.ShaderMaterial({
    depthTest: false, depthWrite: false, fog: false,
    blending: THREE.CustomBlending, blendSrc: THREE.SrcAlphaFactor, blendDst: THREE.OneMinusSrcAlphaFactor,
    uniforms: { map: { value: map }, horizon: sky.material.uniforms.horizon, clipBelow: { value: (trackDef || TRACKS[0]).id === 'rainbow' ? 0 : 1 } },
    vertexShader: 'attribute float alpha; varying vec2 vUv; varying float a, y; void main(){ vUv = uv; a = alpha; y = position.y; gl_Position = vec4(position.xy, 0., 1.); }',
    fragmentShader: `uniform sampler2D map; uniform float horizon, clipBelow; varying vec2 vUv; varying float a, y;
      void main(){ if (clipBelow > .5 && y < horizon) discard; gl_FragColor = vec4(1., 1., 1., texture2D(map, vUv).a * a); }`,
  }));
  clouds.frustumCulled = false; clouds.renderOrder = -999;
  scene.add(clouds);
}
function updateClouds() {
  if (!clouds) return;
  const size = renderer.getDrawingBufferSize(new THREE.Vector2());
  const kx = (size.y / 240) * 2 / size.x;   // native px -> NDC x, height-matched scaling
  const row = (1 - sky.material.uniforms.horizon.value) * 120;
  const tick = Math.floor(performance.now() * 0.03);   // object updates at 30 Hz (assumption)
  const pos = clouds.geometry.attributes.position, al = clouds.geometry.attributes.alpha;
  const [hw, hh] = cloudSet.stars ? [8, 8] : [32, 16];
  cloudSet.objects.forEach((o, i) => {
    const x = Math.trunc(cloudScreenX(cameraYaw, o.rotY)), y = row - o.posY;
    const X = d => (x - 160 + d * o.scale) * kx, Y = d => 1 - (y + d * o.scale) / 120;
    pos.array.set([X(-hw), Y(-hh), 0, X(hw - 1), Y(-hh), 0, X(hw - 1), Y(hh - 1), 0, X(-hw), Y(hh - 1), 0], i * 12);
    if (cloudSet.stars) al.array.fill(STAR_TWINKLE[i % 5][tick & 1] / 255, i * 4, i * 4 + 4);
  });
  pos.needsUpdate = al.needsUpdate = true;
}
window.__clouds = clouds && { set: cloudSet, get yaw() { return cameraYaw; }, mesh: clouds };

const track = new Track(await loadNativeCourse(trackDef || TRACKS[0]));
scene.add(track.group);

const PALETTE = [0xe63946, 0x2a9d8f, 0xf49ac2, 0x3a86ff, 0x70c83c, 0x98633b, 0xf4cd30, 0xe78d32];
const names = ['Mario', 'Luigi', 'Peach', 'Toad', 'Yoshi', 'Donkey Kong', 'Wario', 'Bowser'];
const characters = ['mario', 'luigi', 'peach', 'toad', 'yoshi', 'donkeykong', 'wario', 'bowser'];
let karts = [], player, raceTime = 0, state = 'countdown', countdown = 3.4, finishOrder = [];

function setup() {
  for (const k of karts) { scene.remove(k.mesh); k.mesh.userData.dispose(); }
  karts = []; finishOrder = []; raceTime = 0; state = 'countdown'; countdown = 3.4;
  const slots = [[-6, 14], [6, 14], [-6, 24], [6, 24], [-6, 34], [6, 34], [-6, 44], [6, 44]];
  // start line is at s=0; grid sits behind it so lap 1 begins on crossing
  const order = [7, 0, 1, 2, 3, 4, 5, 6];
  order.forEach((ci, i) => {
    const [d, back] = slots[i];
    const k = new Kart(track, {
      color: PALETTE[ci], s: track.length - back, d, isPlayer: ci === 0,
      skill: 0.6 + 0.4 * Math.random(), name: names[ci], character: characters[ci],
    });
    k.aiOffset = d * 0.8;
    k.prevS = k.s; k.crossings = 0;
    scene.add(k.mesh); karts.push(k);
    if (ci === 0) player = k;
  });
  camPos.copy(player.world); camInit = false;
  banner.textContent = '';
  items.reset();
}

// track menu (shown until a track is picked; picking reloads with ?track=id)
const menuEl = document.getElementById('menu');
if (!trackDef) {
  menuEl.style.display = 'flex';
  const list = document.getElementById('menuList');
  TRACKS.forEach((t, i) => {
    const b = document.createElement('button');
    b.innerHTML = `<b>${i + 1}. ${t.name}</b><span>${t.blurb}</span>`;
    b.onclick = () => { location.search = `?track=${t.id}`; };
    list.appendChild(b);
  });
  addEventListener('keydown', e => {
    const n = parseInt(e.key, 10);
    if (n >= 1 && n <= TRACKS.length) location.search = `?track=${TRACKS[n - 1].id}`;
  });
}

// input
const keys = {};
addEventListener('keydown', e => {
  keys[e.code] = true; audio.start();
  if (e.code === 'KeyR') setup();
  if (e.code === 'KeyM') location.search = '';
  if (e.code === 'KeyN') audio.toggleMusic();
  if (e.code === 'KeyG') { retro = !retro; resize(); }
  if ((e.code === 'ShiftLeft' || e.code === 'ShiftRight' || e.code === 'KeyE') && state !== 'countdown' && player) items.use(player);
  if (e.code.startsWith('Arrow') || e.code === 'Space') e.preventDefault();
});
addEventListener('keyup', e => { keys[e.code] = false; });
// gamepad: A/RT gas, B/LT brake, LB/RB drift, X/Y item, Start restart, stick or d-pad steers
let padItemHeld = false, padStartHeld = false;
function pollPad() {
  const pad = (navigator.getGamepads ? [...navigator.getGamepads()] : []).find(p => p && p.connected);
  if (!pad) return null;
  const b = i => !!(pad.buttons[i] && pad.buttons[i].pressed);
  const item = b(2) || b(3), start = b(9);
  if (item && !padItemHeld && state !== 'countdown' && player) items.use(player);
  if (start && !padStartHeld) setup();
  padItemHeld = item; padStartHeld = start;
  let sx = pad.axes[0] || 0;
  if (Math.abs(sx) < 0.15) sx = 0;
  if (b(14)) sx = -1; else if (b(15)) sx = 1;
  return { throttle: (b(0) || b(7)) ? 1 : 0, brake: (b(1) || b(6)) ? 1 : 0, steer: sx, drift: b(4) || b(5) };
}
function playerInput() {
  const l = keys.ArrowLeft || keys.KeyA, r = keys.ArrowRight || keys.KeyD;
  const kb = {
    throttle: (keys.ArrowUp || keys.KeyW) ? 1 : 0,
    brake: (keys.ArrowDown || keys.KeyS) ? 1 : 0,
    steer: (r ? 1 : 0) - (l ? 1 : 0),
    drift: !!keys.Space,
  };
  const p = pollPad();
  if (!p) return kb;
  return {
    throttle: Math.max(kb.throttle, p.throttle),
    brake: Math.max(kb.brake, p.brake),
    steer: kb.steer || p.steer,
    drift: kb.drift || p.drift,
  };
}

// HUD
const $ = id => document.getElementById(id);
const banner = $('banner'), posEl = $('pos'), posStrokeEl = $('posStroke'), lapEl = $('lapText'), timeEl = $('time'), speedEl = $('speed');
const mini = $('mini').getContext('2d');
const audio = new AudioSys();
if (trackDef) audio.wantMusic = trackDef.id;   // starts on first key press (browser autoplay rule)
const items = new Items(track, scene, audio);
const itemEl = $('item');
const ordinal = n => ['st', 'nd', 'rd'][n - 1] || 'th';
const fmt = t => `${Math.floor(t / 60)}:${(t % 60).toFixed(2).padStart(5, '0')}`;

// minimap
const mm = [];
{
  let minX = 1e9, maxX = -1e9, minZ = 1e9, maxZ = -1e9;
  for (const p of track.pos) { minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x); minZ = Math.min(minZ, p.z); maxZ = Math.max(maxZ, p.z); }
  const sc = 300 / Math.max(maxX - minX, maxZ - minZ);
  mm.push(sc, minX, minZ, 20 + (300 - (maxX - minX) * sc) / 2, 20 + (300 - (maxZ - minZ) * sc) / 2);
}
function drawMini() {
  const [sc, minX, minZ, ox, oy] = mm;
  mini.clearRect(0, 0, 340, 340);
  mini.lineWidth = 9; mini.strokeStyle = '#fff'; mini.lineJoin = 'round'; mini.beginPath();
  track.pos.forEach((p, i) => { const x = ox + (p.x - minX) * sc, y = oy + (p.z - minZ) * sc; i ? mini.lineTo(x, y) : mini.moveTo(x, y); });
  mini.closePath(); mini.stroke();
  for (const k of karts) {
    mini.fillStyle = '#' + k.color.toString(16).padStart(6, '0');
    mini.strokeStyle = '#000'; mini.lineWidth = 3;
    mini.beginPath(); mini.arc(ox + (k.world.x - minX) * sc, oy + (k.world.z - minZ) * sc, k === player ? 10 : 7, 0, 7);
    mini.fill(); mini.stroke();
  }
}

const camPos = new THREE.Vector3(), camUp = new THREE.Vector3(0, 1, 0), camLook = new THREE.Vector3();
let camInit = false;
function updateCamera(dt) {
  const k = player;
  const behind = k.fwd.clone().multiplyScalar(-(9 + Math.min(k.v, 60) * 0.06)).addScaledVector(k.up, 4.2);
  const target = k.world.clone().add(behind);
  const a = camInit ? 1 - Math.exp(-dt * 7) : 1;
  camPos.lerp(target, a);
  camUp.lerp(k.up, 1 - Math.exp(-dt * 4)).normalize();
  camLook.copy(k.world).addScaledVector(k.up, 1.6).addScaledVector(k.fwd, 6);
  camera.position.copy(camPos); camera.up.copy(camUp); camera.lookAt(camLook);
  camera.fov += ((68 + Math.min(k.v, 62) * 0.35 + (k.boost > 0 ? 10 : 0)) - camera.fov) * Math.min(1, dt * 4);
  camera.updateProjectionMatrix();
  camInit = true;
  sun.position.copy(k.world).add(new THREE.Vector3(60, 100, 40)); sun.target.position.copy(k.world);
}

// N64-style presentation: low internal resolution (240 lines) upscaled with hard pixels. G toggles full-res.
let retro = true;
function resize() {
  const h = retro ? 240 : innerHeight * Math.min(devicePixelRatio, 2);
  const w = Math.round(h * innerWidth / innerHeight);
  renderer.setSize(w, Math.round(h), false);
  canvas.style.imageRendering = retro ? 'pixelated' : 'auto';
  camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix();
}
addEventListener('resize', resize); resize();

function collide() {
  const L = track.length;
  for (let i = 0; i < karts.length; i++) for (let j = i + 1; j < karts.length; j++) {
    const a = karts[i], b = karts[j];
    let ds = b.s - a.s; if (ds > L / 2) ds -= L; if (ds < -L / 2) ds += L;
    const dd = b.d - a.d;
    if (Math.abs(ds) < 3.4 && Math.abs(dd) < 2.1) {
      const push = (2.1 - Math.abs(dd)) * 0.5 * (dd >= 0 ? 1 : -1);
      a.d -= push; b.d += push;
      const sepS = (3.4 - Math.abs(ds)) * 0.25 * (ds >= 0 ? 1 : -1);
      a.s -= sepS; b.s += sepS;
      const avg = (a.v + b.v) / 2; a.v = a.v * 0.7 + avg * 0.3; b.v = b.v * 0.7 + avg * 0.3;
    }
  }
}

function rank() {
  const sorted = [...karts].sort((a, b) => (b.finished - a.finished) || (a.finished ? a.finishTime - b.finishTime : b.progress - a.progress));
  return sorted;
}

let last = performance.now();
function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min(0.05, (now - last) / 1000); last = now;
  const steps = 2, h = dt / steps;

  if (!trackDef) {   // menu open: orbit the camera over the default course, no race
    const t = now / 4000, p = track.pos[Math.floor(t * 40) % track.n];
    camera.position.set(p.x + Math.cos(t * 3) * 40, p.y + 25, p.z + Math.sin(t * 3) * 40); camera.lookAt(p);
    updateSky();
    renderer.render(scene, camera);
    return;
  }
  if (state === 'countdown') {
    countdown -= dt;
    const c = Math.ceil(countdown - 0.4);
    banner.textContent = c > 0 ? c : 'GO!';
    if (countdown <= 0.4 && !player.started) { player.started = true; }
    if (countdown <= 0.4) { state = 'race'; audio.beep(true); setTimeout(() => { if (state === 'race') banner.textContent = ''; }, 900); }
    else if (Math.ceil(countdown - 0.4) !== lastTick) { lastTick = Math.ceil(countdown - 0.4); audio.beep(false); }
    for (const k of karts) k.update(dt, { throttle: 0, brake: 0, steer: 0, drift: false });
  } else {
    raceTime += dt;
    for (let s = 0; s < steps; s++) {
      for (const k of karts) {
        if (!k.isPlayer) items.aiUse(k, karts, h);
        const inp = k.isPlayer ? playerInput() : k.think(h, karts);
        if (k.isPlayer && state === 'finished') { inp.throttle = 0.4; inp.brake = 0; }
        k.update(h, inp);
        if (!k.finished && k.crossings >= LAPS) {
          k.finished = true; k.finishTime = raceTime; finishOrder.push(k);
          if (k.isPlayer) { state = 'finished'; banner.textContent = `${finishOrder.length}${ordinal(finishOrder.length)} PLACE!`; }
        }
      }
      collide();
      items.update(h, karts);
    }
  }
  itemEl.textContent = player.item ? ITEM_LABELS[player.item] : 'NO ITEM';
  const order = rank();
  const place = order.indexOf(player) + 1;
  posEl.innerHTML = posStrokeEl.innerHTML = `${place}<small>${ordinal(place)}</small>`;
  lapEl.textContent = `LAP ${Math.min(LAPS, player.crossings + 1)}/${LAPS}`;
  timeEl.textContent = fmt(raceTime);
  speedEl.innerHTML = `${Math.round(Math.abs(player.v) * 3.6)}<small> km/h</small>`;
  audio.update(player.v / 62, player.drift !== 0, player.offroad, player.boost > 0);
  updateCamera(dt);
  drawMini();
  updateSky();
  renderer.render(scene, camera);
}
let lastTick = 4;
if (trackDef) setup();
requestAnimationFrame(frame);
window.__game = { track, items, get karts() { return karts; }, get player() { return player; }, keys };
