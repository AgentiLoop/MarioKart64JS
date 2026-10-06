import * as THREE from 'three';
import { Track, TRACKS } from './track.js';
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
scene.fog = new THREE.Fog(th.skyBot, 200, 900);
const camera = new THREE.PerspectiveCamera(70, 1, 0.5, 2500);

scene.add(new THREE.HemisphereLight(th.hemiSky, th.hemiGround, 1.6));
const sun = new THREE.DirectionalLight(th.sun, 2.2);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
Object.assign(sun.shadow.camera, { left: -60, right: 60, top: 60, bottom: -60, near: 1, far: 300 });
scene.add(sun, sun.target);

// sky dome
const sky = new THREE.Mesh(new THREE.SphereGeometry(1800, 24, 12), new THREE.ShaderMaterial({
  side: THREE.BackSide, depthWrite: false, fog: false,
  uniforms: { top: { value: skyTop }, bot: { value: skyBot } },
  vertexShader: 'varying float h; void main(){ h = normalize(position).y; gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.); }',
  fragmentShader: 'uniform vec3 top; uniform vec3 bot; varying float h; void main(){ gl_FragColor = vec4(mix(bot, top, clamp(h*1.6,0.,1.)),1.); }',
}));
scene.add(sky);

const track = new Track(trackDef || TRACKS[0]);
scene.add(track.group);

const PALETTE = [0xe63946, 0x2a9d8f, 0xf4a261, 0x9b5de5, 0x3a86ff];
const names = ['You', 'Rex', 'Pip', 'Vega', 'Juno'];
let karts = [], player, raceTime = 0, state = 'countdown', countdown = 3.4, finishOrder = [];

function setup() {
  for (const k of karts) scene.remove(k.mesh);
  karts = []; finishOrder = []; raceTime = 0; state = 'countdown'; countdown = 3.4;
  const slots = [[-6, 14], [6, 14], [-6, 24], [6, 24], [0, 34]];
  // start line is at s=0; grid sits behind it so lap 1 begins on crossing
  const order = [4, 0, 1, 2, 3];
  order.forEach((ci, i) => {
    const [d, back] = slots[i];
    const k = new Kart(track, {
      color: PALETTE[ci], s: track.length - back, d, isPlayer: ci === 0,
      skill: 0.6 + 0.4 * Math.random(), name: names[ci],
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
const banner = $('banner'), posEl = $('pos'), lapEl = $('lapText'), timeEl = $('time'), speedEl = $('speed');
const mini = $('mini').getContext('2d');
const audio = new AudioSys();
const items = new Items(track, scene, audio);
const itemEl = $('item');
const ordinal = n => ['st', 'nd', 'rd', 'th', 'th'][n - 1];
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
  posEl.innerHTML = `${place}<small>${ordinal(place)}</small>`;
  lapEl.textContent = `LAP ${Math.min(LAPS, player.crossings + 1)}/${LAPS}`;
  timeEl.textContent = fmt(raceTime);
  speedEl.innerHTML = `${Math.round(Math.abs(player.v) * 3.6)}<small> km/h</small>`;
  audio.update(player.v / 62, player.drift !== 0, player.offroad, player.boost > 0);
  updateCamera(dt);
  drawMini();
  renderer.render(scene, camera);
}
let lastTick = 4;
if (trackDef) setup();
requestAnimationFrame(frame);
window.__game = { track, items, get karts() { return karts; }, get player() { return player; }, keys };
