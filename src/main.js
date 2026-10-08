import * as THREE from 'three';
import { Track, TRACKS, loadNativeCourse, nativeSkyColors, nativeClouds, cloudScreenX, STAR_TWINKLE, NATIVE_SCALE, battleSpawn } from './track.js';
import { Kart, CC_INDEX, CC_BATTLE, ccSpeedScale, pickRivals, cpuSpeedControl, PATH_POINTS, speedKmh, togglePhysics } from './kart.js';
import { AudioSys } from './audio.js';
import { Items, ITEM_LABELS } from './items.js';
import { createTitleFlag } from './flag.js';
import * as HD from './hd.js';
import { Exhaust } from './smoke.js';
import { Net } from './net.js';
import { Lakitu } from './lakitu.js';
import { Penguins } from './penguins.js';

const LAPS = 3;
const canvas = document.getElementById('game');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: false });
renderer.setPixelRatio(1);
HD.setRenderer(renderer);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;

const scene = new THREE.Scene();
const params = new URLSearchParams(location.search);
const trackId = params.get('track');
const playerChar = params.get('char') || localStorage.getItem('mk64char') || 'mario';
const trackDef = TRACKS.find(t => t.id === trackId) || null;   // null -> show the track menu
const battle = !!(trackDef && trackDef.battle);   // battle arena: balloons, no laps (rules below)
// Engine class from the GAME SELECT cc rows (?cc=50|100|150|extra, gCCSelection); links without one race 150cc.
// EXTRA is MK64's mirror mode at 100cc speeds: the 3D frame is flipped left-right and so is steering.
// The flip is in each camera's projection (mirrorCamera), not a CSS flip of the canvas, so the course is mirrored
// while camera-facing sprites (karts, item actors, Lakitu, clouds) flip themselves back and read the right way round.
// GAME SELECT mode (?mode=mario_gp|vs|time_trials|battle); links without one race as Grand Prix (two CPU rivals).
const raceMode = params.get('mode') || 'mario_gp';
// The console has no cc choice for TIME TRIALS or BATTLE (menus.c setup_selected_game_mode): time trials always race
// CC_100 and never mirror (so records compare); battle never mirrors and its karts take the CC_BATTLE row (topSpeed
// 245 for everyone, spawn_players.c), so ?cc= is ignored in both. engine: the gTopSpeedTable row (ccSpeedScale).
const fixedCc = raceMode === 'time_trials' || battle;
const ccParam = fixedCc ? '100' : params.get('cc');
const cc = CC_INDEX[ccParam] ?? CC_INDEX[150];
const engine = battle ? CC_BATTLE : cc;
const mirror = !!trackDef && ccParam === 'extra';
// ?autopilot (or window.__game.autopilot = true): the CPU driver (Kart.think / Items.aiUse) drives your kart - for testing
let autopilot = params.has('autopilot');
const th = (trackDef || TRACKS[0]).theme;
const skyTop = new THREE.Color(th.skyTop), skyBot = new THREE.Color(th.skyBot);
scene.background = skyBot;
scene.fog = new THREE.Fog(th.skyBot, 160, 750);
// EXTRA: negate clip-space x in the camera's projection (camera.userData.mirror tells the billboards to flip back).
// That reverses every triangle's winding, so the on-screen pass swaps the cull side; shadow maps render to their
// own target with an unflipped camera and keep it.
function mirrorCamera(cam) {
  if (!mirror) return cam;
  cam.userData.mirror = true;
  const update = cam.updateProjectionMatrix.bind(cam);
  cam.updateProjectionMatrix = () => {
    update();
    const e = cam.projectionMatrix.elements;
    e[0] = -e[0]; e[4] = -e[4]; e[8] = -e[8]; e[12] = -e[12];
    cam.projectionMatrixInverse.copy(cam.projectionMatrix).invert();
  };
  cam.updateProjectionMatrix();
  return cam;
}
if (mirror) {
  const setMaterial = renderer.state.setMaterial;
  renderer.state.setMaterial = (material, frontFaceCW, ...rest) => setMaterial(material, renderer.getRenderTarget() === null ? !frontFaceCW : frontFaceCW, ...rest);
}
const camera = mirrorCamera(new THREE.PerspectiveCamera(70, 1, 0.5, 2500));

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
    depthTest: false, depthWrite: false, fog: false, side: THREE.DoubleSide,   // screen-space: never culled, EXTRA or not
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
function updateSky(camera, vw = 0, vh = 0) {   // per view: vw x vh is the viewport in buffer pixels (0 = whole frame)
  if (!nativeSky) return;
  camera.updateMatrixWorld();
  camera.getWorldDirection(_hp); _hp.y = 0;
  if (_hp.lengthSq() < 1e-8) _hp.set(0, 0, -1);
  cameraYaw = Math.round(Math.atan2(_hp.x, _hp.z) * 32768 / Math.PI) & 0xffff;
  _hp.normalize().multiplyScalar(30000 * NATIVE_SCALE).add(camera.position); _hp.y = 0;
  sky.material.uniforms.horizon.value = _hp.project(camera).y;
  updateClouds(vw, vh);
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
  const map = HD.loadTexture(`sky/${cloudSet.texture}.png`, { mipmaps: false, retroFilter: THREE.LinearFilter, onLoad: (t, scale) => {
    // per-quad UVs need the frame count (native image height / 32); N64 samples texel i at s = i
    const w = cloudSet.stars ? 16 : 64, h = cloudSet.stars ? 16 : 32, rows = t.image.height / scale;
    const uv = geo.attributes.uv;
    cloudSet.objects.forEach((o, i) => {
      const [s0, s1, t0] = [0.5 / w, (w - 0.5) / w, o.frame * h];
      const v0 = (t0 + 0.5) / rows, v1 = (t0 + h - 0.5) / rows;
      uv.array.set([s0, v0, s1, v0, s1, v1, s0, v1], i * 8);
    });
    uv.needsUpdate = true;
  } });
  map.flipY = false;
  map.wrapS = map.wrapT = THREE.ClampToEdgeWrapping;
  clouds = new THREE.Mesh(geo, new THREE.ShaderMaterial({
    depthTest: false, depthWrite: false, fog: false, side: THREE.DoubleSide,
    blending: THREE.CustomBlending, blendSrc: THREE.SrcAlphaFactor, blendDst: THREE.OneMinusSrcAlphaFactor,
    uniforms: { map: { value: map }, horizon: sky.material.uniforms.horizon, clipBelow: { value: (trackDef || TRACKS[0]).id === 'rainbow' ? 0 : 1 } },
    vertexShader: 'attribute float alpha; varying vec2 vUv; varying float a, y; void main(){ vUv = uv; a = alpha; y = position.y; gl_Position = vec4(position.xy, 0., 1.); }',
    fragmentShader: `uniform sampler2D map; uniform float horizon, clipBelow; varying vec2 vUv; varying float a, y;
      void main(){ if (clipBelow > .5 && y < horizon) discard; gl_FragColor = vec4(1., 1., 1., texture2D(map, vUv).a * a); }`,
  }));
  clouds.frustumCulled = false; clouds.renderOrder = -999;
  scene.add(clouds);
}
function updateClouds(vw, vh) {
  if (!clouds) return;
  const size = renderer.getDrawingBufferSize(new THREE.Vector2());
  if (vw && vh) size.set(vw, vh);
  const kx = (size.y / 240) * 2 / size.x;   // native px -> NDC x, height-matched scaling
  const row = (1 - sky.material.uniforms.horizon.value) * 120;
  const tick = Math.floor(performance.now() * 0.03);   // object updates at 30 Hz (assumption)
  const pos = clouds.geometry.attributes.position, al = clouds.geometry.attributes.alpha;
  const [hw, hh] = cloudSet.stars ? [8, 8] : [32, 16];
  cloudSet.objects.forEach((o, i) => {
    const x = Math.trunc(cloudScreenX(cameraYaw, o.rotY)), y = row - o.posY;
    // EXTRA: screen-space quads skip the mirrored projection, so mirror where they sit but not their image
    const X = d => ((mirror ? 160 - x : x - 160) + d * o.scale) * kx, Y = d => 1 - (y + d * o.scale) / 120;
    pos.array.set([X(-hw), Y(-hh), 0, X(hw - 1), Y(-hh), 0, X(hw - 1), Y(hh - 1), 0, X(-hw), Y(hh - 1), 0], i * 12);
    if (cloudSet.stars) al.array.fill(STAR_TWINKLE[i % 5][tick & 1] / 255, i * 4, i * 4 + 4);
  });
  pos.needsUpdate = al.needsUpdate = true;
}
window.__clouds = clouds && { set: cloudSet, get yaw() { return cameraYaw; }, mesh: clouds };

const track = new Track(await loadNativeCourse(trackDef || TRACKS[0]), { mirror });
scene.add(track.group);

const PALETTE = [0xe63946, 0x2a9d8f, 0xf49ac2, 0x3a86ff, 0x70c83c, 0x98633b, 0xf4cd30, 0xe78d32];
const names = ['Mario', 'Luigi', 'Peach', 'Toad', 'Yoshi', 'Donkey Kong', 'Wario', 'Bowser'];
const characters = ['mario', 'luigi', 'peach', 'toad', 'yoshi', 'donkeykong', 'wario', 'bowser'];
let karts = [], player, raceTime = 0, state = 'countdown', finishOrder = [];
let lapTimes = [], lapStart = 0, lapsDone = -1;   // the player's lap splits (time trial records)

const GRID_SLOTS = [[-6, 14], [6, 14], [-6, 24], [6, 24], [-6, 34], [6, 34], [-6, 44], [6, 44]];   // [d, back] per start spot
function setup(count = battle ? 4 : 8) {   // count: karts on the grid (8 for 1P; MAX_ONLINE_KARTS when an online room falls back to the CPU)
  for (const k of karts) { scene.remove(k.mesh); k.mesh.userData.dispose(); }
  karts = []; finishOrder = []; raceTime = 0; state = 'countdown';
  lapTimes = []; lapStart = 0; lapsDone = -1;
  const slots = GRID_SLOTS;
  // start line is at s=0; grid sits behind it so lap 1 begins on crossing
  // player takes their character (URL ?char= / localStorage), AI fill the rest in native order.
  // Grand Prix (spawn_players_gp_one_player, func_80039DA4): every race here is a cup's first course, so the
  // player starts last (D_80165270 = 7, 6, .. 0: player 1 on spot 7, CPU n on spot 7 - n). Time trials
  // (spawn_players.c TIME_TRIALS) is the player alone on the middle of the first row. VS / an online room
  // falling back to CPU karts keep the old order (the player second).
  // Battle (assumption, the console has no 1P battle): the player is P1 on the first start spot and up to three
  // CPU karts take the other spots (spawn_players_4p_battle order).
  const rest = characters.filter(c => c !== playerChar);
  const order = battle ? [playerChar, ...rest].slice(0, Math.min(4, count))
    : timeTrial ? [playerChar]
    : raceMode === 'mario_gp' && count === 8 ? [...rest].reverse().concat(playerChar)
    : [rest[6], playerChar, rest[0], rest[1], rest[2], rest[3], rest[4], rest[5]].slice(0, count);
  order.forEach((c, i) => {
    const ci = characters.indexOf(c);
    const [d, back] = order.length === 1 ? [0, slots[0][1]] : slots[i];
    const k = new Kart(track, {
      color: PALETTE[ci], s: track.length - back, d, isPlayer: c === playerChar,
      skill: 0.6 + 0.4 * Math.random(), name: names[ci], character: c, speedScale: ccSpeedScale(engine, c), cc,
      spawn: battle ? battleSpawn(trackDef.id, i) : null,
    });
    k.aiOffset = d * 0.8;
    k.prevS = k.s; k.crossings = -1;   // gLapCountByPlayerId starts at -1: crossing the line from the grid begins lap 1
    scene.add(k.mesh); karts.push(k);
    if (c === playerChar) player = k;
  });
  if (raceMode === 'mario_gp') pickRivals(karts);
  setViews([player]);
  banner.textContent = '';
  items.reset();
  // func_8005995C: a time trial hands player 1 a mushroom twice more once it is used, i.e. three mushrooms
  if (timeTrial) items.give(player, 'triple_mushroom');
  startCountdown();
}

// track menu (shown until a track is picked; picking reloads with ?track=id)
const $ = id => document.getElementById(id);
const banner = $('banner'), posEl = $('pos'), posStrokeEl = $('posStroke'), lapEl = $('lapText'), timeEl = $('time'), speedEl = $('speed');
// round-joined outline + solid drop shadow from text-shadow rings (-webkit-text-stroke gives miter spikes)
const ring = (r, dy, c) => {
  const out = [];
  for (const rr of [r, r * 0.5]) {
    const n = Math.max(16, Math.ceil(2 * Math.PI * rr / 1.5));
    for (let i = 0; i < n; i++) { const a = i / n * 2 * Math.PI; out.push(`${(Math.cos(a) * rr).toFixed(2)}px ${(Math.sin(a) * rr + dy).toFixed(2)}px 0 ${c}`); }
  }
  return out;
};
const outline = (el, r, color, dy) => { el.style.textShadow = [...ring(r, 0, color), ...ring(r, dy, '#000'), `0 ${dy}px 0 #000`].join(','); };
outline($('hud'), 3, '#000', 3);
outline(banner, 6, '#b3200f', 8);
outline(posStrokeEl, 5, '#1a1a6e', 6);
const mini = $('mini').getContext('2d');
const audio = new AudioSys();
if (trackDef) audio.wantMusic = trackDef.id;   // starts on first key press (browser autoplay rule)
const items = new Items(track, scene, audio);
items.gp = raceMode === 'mario_gp';   // GP CPUs draw items on a timer (cpu_use_item_strategy), not from boxes
const exhaust = new Exhaust(scene);
const lakitu = new Lakitu(scene, track);
const penguins = trackDef?.id === 'sherbet' ? new Penguins(scene, track) : null;   // Sherbet Land's penguins
// his cloud's hum while he fishes a kart out or shows the reverse sign: 0x0100FA28 = SOUND_ARG_LOAD(0x01, 0x00, 0xFA, 0x28), bank 0
lakitu.onHum = on => on ? audio.playSound(0, 0x28) : audio.stopSound(0, 0x28);
// Sherbet Land's ice block: 0x1900A055 as it closes round the kart, 0x1900A056 as it breaks (bank 1)
lakitu.onSound = (bank, id) => audio.playSound(bank, id);
// Lakitu's start signal: two red lights, then blue starts the race (update_object_lakitu_countdown). The ROM's
// SOUND_ACTION_COUNTDOWN_LIGHT 0x49008003 / SOUND_ACTION_GREEN_LIGHT 0x49008004 (bank 4)
function countdownLight(light) {
  if (state !== 'countdown') return;
  if (light === 'ready') { revs.ready = 0; return; }
  if (light === 'red') { audio.playSound(4, 0x03); return; }
  state = 'race'; audio.playSound(4, 0x04);
  rocketStart();
}
// Rocket start (player_accelerate_during_start_sequence / player_decelerate_during_start_sequence): holding A through
// the countdown revs the engine, currentSpeed against the gTopSpeedTable top speed, + gKartAccelerationTables[band]
// x 3 (x 2.5 from 60%) a frame, - 5 a frame let go. From the end of Lakitu's blue-light animation (D_801656F0) a
// fresh press within 8 frames (20 in time trials) sets START_BOOST_TRIGGER, kept only while A stays down; revs at
// 90% of top speed without it set START_SPINOUT_TRIGGER (cleared once they fall to 70%). At GO the boost is a mushroom
// (apply_triggers -> func_8002A704, voice n 1) and the spinout an early-start spin (func_8008F104, voice n 3).
// Assumption: the player's start sequence runs at Lakitu's 60 Hz object tick (gRaceFrameCounter counts those).
const START_ACCEL = { mario: [2, 2, 2, 1.6, 1.4, 1.2, 1, 0.8, 0.6, 0.4], yoshi: [2, 2, 2.5, 2.6, 2.6, 2, 1.5, 0.8, 0.8, 0.8],
  donkeykong: [2, 2, 2, 1.6, 1, 1, 1, 1.8, 1.8, 1.2] };
Object.assign(START_ACCEL, { luigi: START_ACCEL.mario, toad: START_ACCEL.yoshi, peach: START_ACCEL.yoshi, wario: START_ACCEL.donkeykong, bowser: START_ACCEL.donkeykong });
let revs = null;
function startCountdown() {
  revs = { rev: 0, held: false, ready: null, boost: false, spin: false, acc: 0 };
  lakitu.startCountdown(countdownLight);
}
function revEngine(dt, inp) {
  const r = revs, top = 320 * Math.sqrt(ccSpeedScale(engine, playerChar)), accel = START_ACCEL[playerChar] || START_ACCEL.mario;
  for (r.acc += dt * 60; r.acc >= 1; r.acc--) {
    const a = inp.throttle > 0;
    if (r.ready !== null) r.ready++;
    if (a) {
      const band = Math.floor(r.rev / top * 10);
      if (band >= 0 && band <= 9) r.rev += accel[band] * (band < 6 ? 3 : 2.5);
      if (r.ready !== null) {
        if (r.ready < (raceMode === 'time_trials' ? 20 : 8) && !r.held) r.boost = true;
        else if (r.rev >= top * 0.9 && !r.boost) r.spin = true;
      }
    } else {
      r.rev = Math.min(top, Math.max(0, r.rev - 5));
      if (r.rev <= top * 0.7) r.spin = false;
      r.boost = false;
    }
    r.held = a;
  }
}
function rocketStart() {
  const r = revs;
  revs = null;
  if (!r || !player || autopilot) return;
  if (r.boost) { player.boost = Math.max(player.boost, 1.8); player.v += 6; audio.playSound(1, 0x0b); items.voice(player, 1); }
  if (r.spin) { player.spin = 1.1; player.v /= 3; player.drift = 0; player.boost = 0; items.voice(player, 3); }
}
const itemEl = $('item'), itemWin = $('itemWin'), itemName = $('itemName');
// gItemWindowTextures order (tools/extract-item-window.py); preloaded at the current HD tier so the roulette never waits on a fetch
const ITEM_WINDOW = ['none', 'banana', 'banana_bunch', 'green_shell', 'triple_green_shell', 'red_shell', 'triple_red_shell',
  'blue_shell', 'thunder_bolt', 'fake_item_box', 'star', 'boo', 'mushroom', 'double_mushroom', 'triple_mushroom',
  'super_mushroom'].map((n, i) => `item-window/${String(i).padStart(2, '0')}-${n}.png`);
const preloadItemWindow = () => ITEM_WINDOW.forEach(rel => { new Image().src = HD.hdSource(rel).url; });
preloadItemWindow();
HD.onChange(preloadItemWindow);
const ordinal = n => ['st', 'nd', 'rd'][n - 1] || 'th';
const fmt = t => `${Math.floor(t / 60)}:${(t % 60).toFixed(2).padStart(5, '0')}`;

// ------- title screen & menu flow (no ?track=): title -> game select -> course menu -> character select -> ?track=id&char=c[&players=n] -------
// All screens live inside #screen, a 320x240 frame scaled uniformly to the viewport (N64 4:3 output).
const screenEl = $('screen'), hintEl = $('hint');
const titleEl = $('title'), pushStart = $('pushStart'), gameEl = $('gameSel'), menuEl = $('menu'), charEl = $('char');
let curScreen = null;
function showScreen(el, hint) {
  for (const s of [titleEl, gameEl, menuEl, charEl, $('opt'), $('data')]) s.style.display = s === el ? 'block' : 'none';
  curScreen = el;
  hintEl.textContent = hint;
}
function fitScreen() {
  const s = Math.min(innerWidth / 320, innerHeight / 240);
  screenEl.style.zoom = s;   // laid out (and rasterized) at full size, so 2x/4x menu art stays sharp
}
addEventListener('resize', fitScreen);
const atTitle = () => curScreen === titleEl;
let blinkTick = 0;
const titleFlag = trackDef ? null : createTitleFlag($('titleFlag'));   // START_MENU_FLAG waving behind the logo
if (titleFlag) { titleFlag.setScale(HD.tier()); HD.onChange(() => titleFlag.setScale(HD.tier())); }
function titleStep(now) {
  // MK64 start menu: ((gGlobalTimer / 8) % 3) != 0 draws the PUSH START button (menu_items.c:5905)
  if (atTitle()) {
    blinkTick = Math.floor(now / 1000 * 60 / 8);
    pushStart.style.visibility = blinkTick % 3 !== 0 ? 'visible' : 'hidden';
    titleFlag.step(now);
  }
}
window.__flag = titleFlag;
// menu sounds, bank 4 of include/sounds.h: SOUND_MENU_CURSOR_MOVE, _SELECT, _GO_BACK, _OK_CLICKED, SOUND_INTRO_ENTER_MENU
const SND = { move: 0x00, select: 0x01, back: 0x02, okClicked: 0x16, enter: 0x1a };
const snd = name => audio.menuSound(SND[name]);
function enterMenus() {
  if (!atTitle()) return;
  // Browsers keep audio suspended until a gesture: the first press unlocks audio and advances in one go.
  if (audio.ctx && audio.ctx.state !== 'running') audio.ctx.resume();
  snd('enter');   // splash_menu_act: A/Start plays SOUND_INTRO_ENTER_MENU
  enterGameSelect();
  audio.playMusic(2);   // SEQ_MENU_MAIN_MENU (menus.c:1861)
}
function backToTitle() {
  showScreen(titleEl, 'Press Enter / Start / click anywhere to continue');
  audio.playMusic(1);   // SEQ_MENU_TITLE_SCREEN (menus.c:1844)
}

// ------- main menu: MAIN_MENU (GAME SELECT) at the ROM's pixel positions (D_800E70A0) -------
// Banner 200x32 at (61,17); the 1P..4P GAME columns at x 21/92/163/234, y 62: a 64x54 card over a box, then one
// 64x18 mode row per mode at y+65+18i (seg2_menu_Np_column), the green cursor triangle at (+27,+56); OPTION (21,200),
// DATA (85,200). func_800A8270: the chosen column's box is the cream (255,249,220) chosen colour, flashing grey while
// the cursor is still on the columns (MAIN_MENU_PLAYER_SELECT); once a count is picked (MAIN_MENU_MODE_SELECT) the
// column moves to (128,62) (func_800A9D5C), the others close, and the mode row flashes instead. A on MARIO GP / VS
// opens MAIN_MENU_MODE_SUB_SELECT: the 50cc/100cc/150cc/EXTRA rows at column + 64, mode row y + 18i (func_800A9E58,
// D_800E70E8). Assumption: EXTRA is unlocked (no save data to check has_unlocked_extra_mode). OK is skipped: the cc
// (or TIME TRIALS, which races 100cc, spawn_players.c) goes straight to course select.
// 2P-4P GAME are online: `players` rides along to the race URL, which waits for that many players (src/net.js).
// BATTLE goes to the battle course select (SUB_MENU_MAP_SELECT_BATTLE_COURSE: the four arenas, no cups); 1P GAME
// also offers it here (assumption: the console has no solo battle, this port battles three CPU karts).
const PCOL_X = [21, 92, 163, 234];
// 2P-4P all get MARIO GP / VS / BATTLE (this port's choice, not the console's): online the CPU fills the grid up to MAX_ONLINE_KARTS.
const PMODES = [['mario_gp', 'time_trials', 'battle'], ['mario_gp', 'vs', 'battle'], ['mario_gp', 'vs', 'battle'], ['mario_gp', 'vs', 'battle']];
const CC_ROWS = ['50cc', '100cc', '150cc', 'extra'];   // gCCSelection CC_50..CC_EXTRA
let pcount = 0, pmode = 0, ccSel = 0, gameMode = 'player';   // 'player' | 'mode' | 'cc'
const hasCc = () => ['mario_gp', 'vs'].includes(PMODES[pcount][pmode]);
function buildGameSelect() {
  const cols = $('pcols');
  PCOL_X.forEach((x, i) => {
    const b = document.createElement('button');
    b.className = 'pcol'; b.style.left = `${x}px`;
    b.setAttribute('aria-label', `${i + 1}P game`);
    let html = '<div class="box"></div><img class="card" alt="" />';
    PMODES[i].forEach((m, j) => { html += `<div class="mbox" style="top:${65 + 18 * j}px"></div><img class="mode" style="top:${65 + 18 * j}px" alt="" data-mode="${m}" />`; });
    html += '<img class="tri" alt="" />';
    b.innerHTML = html;
    HD.setImg(b.querySelector('.card'), `mainmenu/menu_${i + 1}p_game.png`);
    b.querySelectorAll('.mode').forEach(img => HD.setImg(img, `mainmenu/mode_${img.dataset.mode}.png`));
    HD.setImg(b.querySelector('.tri'), 'mainmenu/small_green_triangle.png');
    b.onclick = () => {
      if (gameMode === 'player' || pcount !== i) { pcount = i; gameMode = 'mode'; pmode = 0; snd('select'); updateGameSelect(); }
      else pickMode();
    };
    b.querySelectorAll('.mode').forEach((img, j) => { img.onclick = e => { e.stopPropagation(); pcount = i; pmode = j; gameMode = 'mode'; pickMode(); }; });
    cols.appendChild(b);
  });
  CC_ROWS.forEach((c, i) => {
    const b = document.createElement('button');
    b.className = 'ccrow'; b.setAttribute('aria-label', c === 'extra' ? 'Extra' : c);
    b.innerHTML = '<div class="box"></div><img alt="" />';
    HD.setImg(b.querySelector('img'), `mainmenu/${c}.png`);
    b.onclick = () => { ccSel = i; pickCc(); };
    $('ccrows').appendChild(b);
  });
}
function updateGameSelect() {
  const picked = gameMode !== 'player';
  [...$('pcols').children].forEach((b, i) => {
    b.setAttribute('aria-pressed', i === pcount && picked);
    b.classList.toggle('gone', picked && i !== pcount);
    b.style.left = `${picked && i === pcount ? 128 : PCOL_X[i]}px`;
  });
  const show = gameMode === 'cc';
  [...$('ccrows').children].forEach((b, i) => {
    b.style.display = show ? 'block' : 'none';
    b.style.left = '192px'; b.style.top = `${62 + 65 + 18 * (pmode + i)}px`;
    b.setAttribute('aria-pressed', show && i === ccSel);
  });
}
function enterGameSelect() {
  gameMode = 'player'; pmode = 0;
  showScreen(gameEl, 'Game select: ←/→ number of players, Enter · ↑/↓ mode, Enter · ↑/↓ 50cc/100cc/150cc/Extra, Enter · Esc goes back · L option · R data · 2P-4P race online');
  updateGameSelect();
}
function pickMode() {
  if (hasCc()) { gameMode = 'cc'; snd('select'); updateGameSelect(); return; }   // MAIN_MENU_MODE_SUB_SELECT
  ccSel = 1;   // time trials (and battle) use the 100cc tables (spawn_players.c)
  pickCc();
}
function pickCc() {
  snd('okClicked');
  if (PMODES[pcount][pmode] === 'battle') {   // menus.c COURSE_SELECT_MENU: gCupSelection = BATTLE_CUP, straight to the course rows
    cupSel = 4;
    showScreen(menuEl, 'Battle course select: ↑/↓ pick an arena, Enter · Enter on OK starts · Esc goes back');
    cupMode('course');
    return;
  }
  if (cupSel === 4) cupSel = 0;
  showScreen(menuEl, 'Course select: ←/→ pick a cup, Enter · ↑/↓ pick a course, Enter · Enter on OK starts · Esc goes back');
  cupMode('cup');
}
function gameStep(now) {
  if (curScreen !== gameEl) return;
  menuTick = Math.floor(now / 1000 * 30);
  [...$('pcols').children].forEach((b, i) => {
    b.querySelector('.box').style.background = boxColour(i === pcount, gameMode !== 'player');
    b.querySelectorAll('.mbox').forEach((m, j) => { m.style.background = boxColour(i === pcount && j === pmode && gameMode !== 'player', gameMode === 'cc'); });
  });
  [...$('ccrows').children].forEach((b, i) => { b.querySelector('.box').style.background = boxColour(i === ccSel, false); });
}

// ------- L OPTION / R DATA (main_menu_act: L_TRIG -> MAIN_MENU_OPTION, R_TRIG -> MAIN_MENU_DATA, menus.c:1323-1334) -------
// OPTIONS_MENU (options_menu_act): RETURN TO GAME SELECT, SOUND MODE (stereo/headphones/mono), COPY CONTROLLER PAK,
// ERASE ALL DATA. DATA_MENU (data_menu_act): the 16 courses as 4 cup columns x 4 rows; A opens COURSE_DATA_MENU, the
// course's time trial records (best 5 times and best lap). The "save data" here is localStorage. Layout is plain text,
// not the ROM's screens.
const optEl = $('opt'), dataEl = $('data');
const SOUND_MODES = ['STEREO', 'HEADPHONES', 'MONO'];
const SOUND_MODE_SND = [0x24, 0x25, 0x29];   // SOUND_MENU_STEREO / _HEADPHONES / _MONO
const OPT_ROWS = ['RETURN TO GAME SELECT', 'SOUND MODE', 'COPY CONTROLLER PAK', 'ERASE ALL DATA'];
let optSel = 0, optMsg = '', eraseAsk = false, dataSel = 0, dataCourse = false;
function enterOption() {
  optSel = 0; optMsg = ''; eraseAsk = false;
  audio.menuSound(0x10);   // SOUND_MENU_OPTION
  showScreen(optEl, 'Option: ↑/↓ choose, Enter · Esc goes back to game select');
  drawOption();
}
function drawOption() {
  $('optList').innerHTML = OPT_ROWS.map((r, i) => `<div class="row${i === optSel ? ' on' : ''}">${r}${i === 1 ? ` : ${SOUND_MODES[audio.soundMode]}` : ''}${i === 3 && eraseAsk ? ' — ARE YOU SURE? ENTER = YES, ESC = NO' : ''}</div>`).join('') + `<div class="msg">${optMsg}</div>`;
}
function optionKey(code, enter, back) {
  if (eraseAsk) {
    if (enter) { eraseRecords(); localStorage.removeItem('mk64sound'); audio.setSoundMode(0); eraseAsk = false; optMsg = 'ALL DATA ERASED'; audio.menuSound(0x1d); }   // SOUND_MENU_EXPLOSION
    else if (back) { eraseAsk = false; snd('back'); }
    drawOption(); return;
  }
  optMsg = '';
  if (code === 'ArrowUp' && optSel > 0) { optSel--; snd('move'); }
  else if (code === 'ArrowDown' && optSel < OPT_ROWS.length - 1) { optSel++; snd('move'); }
  else if (back) { enterGameSelect(); snd('back'); return; }
  else if (enter) {
    if (optSel === 0) { enterGameSelect(); snd('back'); return; }
    if (optSel === 1) { const m = (audio.soundMode + 1) % 3; audio.setSoundMode(m); audio.menuSound(SOUND_MODE_SND[m]); }
    if (optSel === 2) { optMsg = 'NO CONTROLLER PAK (records are kept in this browser)'; audio.menuSound(0x07); }   // SOUND_MENU_FILE_NOT_FOUND
    if (optSel === 3) { eraseAsk = true; snd('select'); }
  }
  drawOption();
}
// time trial records per course id: { times: [{ t, char }] best 5, lap: { t, char } }
const loadRecords = () => { try { return JSON.parse(localStorage.getItem('mk64records')) || {}; } catch { return {}; } };
const eraseRecords = () => localStorage.removeItem('mk64records');
const recFmt = t => t == null ? "-'--\"--" : `${Math.floor(t / 60)}'${String(Math.floor(t % 60)).padStart(2, '0')}"${String(Math.floor(t * 100) % 100).padStart(2, '0')}`;
function enterData() {
  dataCourse = false;
  audio.menuSound(0x11);   // SOUND_MENU_DATA
  drawData();
}
function drawData() {
  const recs = loadRecords();
  if (!dataCourse) {
    showScreen(dataEl, 'Data: arrows pick a course, Enter shows its records · Esc goes back to game select');
    $('dataHead').textContent = 'DATA';
    $('dataList').innerHTML = `<div id="dataGrid">${TRACKS.slice(0, 16).map((t, i) =>
      `<div class="row${i === dataSel ? ' on' : ''}" data-i="${i}">${t.name}<b>${recFmt(recs[t.id]?.times?.[0]?.t)}</b></div>`).join('')}</div>
      <div class="msg">Records come from TIME TRIALS (1P GAME).</div>`;
    $('dataList').querySelectorAll('[data-i]').forEach(d => { d.onclick = () => { dataSel = +d.dataset.i; dataCourse = true; snd('okClicked'); drawData(); }; });
    return;
  }
  const t = TRACKS[dataSel], r = recs[t.id] || {};
  showScreen(dataEl, 'Course records: Enter / Esc goes back to data');
  $('dataHead').textContent = t.name.toUpperCase();
  const rows = [0, 1, 2, 3, 4].map(i => { const e = r.times?.[i]; return `<tr><td>${i + 1}</td><td>${recFmt(e?.t)}</td><td>${e ? NAMES[e.char] || e.char : ''}</td></tr>`; }).join('');
  $('dataList').innerHTML = `<div class="row on">RETURN</div><table>${rows}<tr><td>LAP</td><td>${recFmt(r.lap?.t)}</td><td>${r.lap ? NAMES[r.lap.char] || r.lap.char : ''}</td></tr></table>`;
  $('dataList').querySelector('.row').onclick = () => { dataCourse = false; snd('back'); drawData(); };
}
function dataKey(code, enter, back) {
  if (dataCourse) { if (enter || back) { dataCourse = false; snd('back'); drawData(); } return; }
  // data_menu_act: down/up inside a cup column (index % 4), right/left across cups (index / 4)
  const move = { ArrowDown: dataSel % 4 !== 3 ? 1 : 0, ArrowUp: dataSel % 4 !== 0 ? -1 : 0, ArrowRight: dataSel < 12 ? 4 : 0, ArrowLeft: dataSel >= 4 ? -4 : 0 }[code];
  if (move) { dataSel += move; snd('move'); drawData(); }
  else if (enter) { dataCourse = true; snd('okClicked'); drawData(); }
  else if (back) { enterGameSelect(); snd('back'); }
}
// a finished time trial: keep the best 5 race times and the best lap for the course
function saveRecord(id, time, laps, char) {
  const recs = loadRecords(), r = recs[id] || (recs[id] = { times: [] });
  r.times = [...r.times, { t: time, char }].sort((a, b) => a.t - b.t).slice(0, 5);
  const best = Math.min(...laps);
  if (laps.length && (!r.lap || best < r.lap.t)) r.lap = { t: best, char };
  localStorage.setItem('mk64records', JSON.stringify(recs));
}
$('optionBtn').onclick = () => { if (curScreen === gameEl) enterOption(); };
$('dataBtn').onclick = () => { if (curScreen === gameEl) enterData(); };

// ------- course select: COURSE_SELECT_MENU at the ROM's pixel positions (single-course / VS style) -------
// Cup icons 65x40 at D_800E7148 (x 23/93/162/232, y 59); the chosen cup slides to x 128 once a cup is
// picked and the others collapse (func_800AB164 / func_800AB098). Course title plates 140x18 at
// (157, 112 + 24*i) over 139x17 boxes (D_800E7208); previews 128x78 at (23,112), or four half-size
// ones at D_800E7168 while picking a cup. OK 31x19 at (265,208). Box colours: black (1,1,1),
// chosen (255,249,220), or the grey flash of draw_flash_select_case_slow while the cursor is on it.
const CUPS = [
  { id: 'mushroom', name: 'Mushroom Cup' }, { id: 'flower', name: 'Flower Cup' },
  { id: 'star', name: 'Star Cup' }, { id: 'special', name: 'Special Cup' },
];
const CUP_X = [23, 93, 162, 232];
const PREV_SMALL = [[23, 112], [87, 112], [23, 151], [87, 151]];
const cupCourses = c => TRACKS.slice(c * 4, c * 4 + 4);   // TRACKS is in gCupCourseOrder order
let cupSel = 0, courseIdx = 0, courseMode = 'cup';          // 'cup' | 'course' | 'ok'  (SUB_MENU_MAP_SELECT_*)
const flashGrey = () => { let g = ((menuTick % 64) << 9) / 64; if (g > 0x100) g = 0x200 - g; return Math.min(g, 255) | 0; };
const boxColour = (on, confirmed) => !on ? 'rgb(1,1,1)' : confirmed ? 'rgb(255,249,220)' : `rgb(${flashGrey()},${flashGrey()},${flashGrey()})`;
function buildCourseMenu() {
  const cups = $('cups'), prevs = $('prevs'), names = $('cnames');
  CUPS.forEach((c, i) => {
    const b = document.createElement('button');
    b.className = 'cup'; b.setAttribute('aria-label', c.name);
    b.innerHTML = '<div class="box"></div><img alt="" />';
    HD.setImg(b.querySelector('img'), `courseselect/cup_${c.id}.png`);
    b.onclick = () => { cupSel = i; cupMode('course'); snd('select'); };
    cups.appendChild(b);
  });
  for (let i = 0; i < 4; i++) {
    const d = document.createElement('div');
    d.className = 'prev'; d.style.position = 'absolute';
    d.style.left = `${PREV_SMALL[i][0]}px`; d.style.top = `${PREV_SMALL[i][1]}px`;
    d.innerHTML = '<img alt="" src="" />';
    prevs.appendChild(d);
    const b = document.createElement('button');
    b.className = 'cname'; b.style.top = `${112 + 24 * i}px`;
    b.innerHTML = '<div class="box"></div><img alt="" src="" />';
    b.onclick = () => { if (courseMode === 'cup') cupMode('course'); courseIdx = i; cupMode('ok'); snd('select'); };
    names.appendChild(b);
  }
  $('courseOk').onclick = () => { if (courseMode === 'ok') { snd('okClicked'); enterChar(cupCourses(cupSel)[courseIdx].id); } };
}
function cupMode(mode) {
  courseMode = mode;
  if (mode === 'cup') courseIdx = 0;
  const courses = cupCourses(cupSel);
  [...$('cups').children].forEach((b, i) => {
    const on = i === cupSel;
    b.style.display = mode === 'cup' || on ? 'block' : 'none';   // battle cup (4) has no icon: all hidden
    b.style.left = `${mode === 'cup' ? CUP_X[i] : 128}px`;
    b.setAttribute('aria-pressed', on);
  });
  [...$('prevs').children].forEach((d, i) => {
    d.style.display = mode === 'cup' ? 'block' : 'none';
    HD.setImg(d.querySelector('img'), `menu/previews/${courses[i].id}.png`);
  });
  $('prevBig').style.display = mode === 'cup' ? 'none' : 'block';
  HD.setImg($('prevBig').querySelector('img'), `menu/previews/${courses[courseIdx].id}.png`);
  [...$('cnames').children].forEach((b, i) => {
    HD.setImg(b.querySelector('img'), `courseselect/title_${courses[i].id}.png`);
    b.setAttribute('aria-label', courses[i].name);
    b.setAttribute('aria-pressed', mode !== 'cup' && i === courseIdx);
  });
}
function courseStep(now) {
  if (curScreen !== menuEl) return;
  menuTick = Math.floor(now / 1000 * 30);
  [...$('cups').children].forEach((b, i) => { b.querySelector('.box').style.background = boxColour(i === cupSel, courseMode !== 'cup'); });
  [...$('cnames').children].forEach((b, i) => { b.querySelector('.box').style.background = boxColour(courseMode !== 'cup' && i === courseIdx, courseMode === 'ok'); });
  $('courseOk').querySelector('.box').style.background = boxColour(courseMode === 'ok', false);
}

// ------- character select: CHARACTER_SELECT_MENU laid out at the ROM's pixel positions -------
// Grid ids 1..8 run left to right, top row then bottom (menus.c player_select_menu_act: R_JPAD = id+1,
// D_JPAD = id+4); id = index+1 into sCharacterGridOrder MARIO LUIGI PEACH TOAD YOSHI DK WARIO BOWSER.
// Portrait origins D_800E7108 (menu_items.c:114): x 24/93/162/231, y 63 (top row) / 145 (bottom row);
// 64x64 face at (x,y), 64x12 name plate at (x,y+64), P1 border 64x64 over the face.
const CHAR_ORDER = ['mario', 'luigi', 'peach', 'toad', 'yoshi', 'donkeykong', 'wario', 'bowser'];
const CHAR_POS = [[24, 63], [93, 63], [162, 63], [231, 63], [24, 145], [93, 145], [162, 145], [231, 145]];
const NAMES = { mario: 'Mario', luigi: 'Luigi', peach: 'Peach', toad: 'Toad', yoshi: 'Yoshi', donkeykong: 'D. Kong', wario: 'Wario', bowser: 'Bowser' };
// MkAnimation frame tables, decoded from textures.c D_02006708..: frame index = face_XX
const ANIM = {
  base: { frames: [0], rate: 50 },                       // D_02006708 [00@0x32]
  hover: { frames: [15], rate: 5 },                      // D_800E8320/8340 [15@5]
  singleBlink: [1, 2, 3, 4, 5, 4, 3, 2, 1, 0].map(f => ({ frames: [f], rate: 1 })).concat([{ frames: [0], rate: 10 }]),
  doubleBlink: [1, 2, 3, 4, 5, 4, 3, 2, 1, 0, 1, 2, 3, 4, 5, 4, 3, 2, 1, 0].map(f => ({ frames: [f], rate: 1 })).concat([{ frames: [0], rate: 10 }]),
  celebrate: { seq: [6, 7, 8, 9, 10, 11, 12, 13, 14, 15], rate: 1 },   // D_02006718: 06..14 @1, 15 @5
  deselect: { seq: [15, 14, 13, 12, 11, 10, 9, 8, 7, 6], rate: 2 },    // D_02006788: 15..06 @2
};
const faceState = [];
const faceImgs = [];       // one <img> per cell: tall atlas positioned so frame f shows
let charCursor = 0;        // player's grid slot 0..7 (grid id - 1)
let charSel = null;        // chosen slot once confirmed
let selCourse = null;      // pending track id
let okMode = false;        // PLAYER_SELECT_MENU_OK reached
let menuTick = 0;          // ~gGlobalTimer / gCycleFlashMenu (30 Hz)

function frameOf(st, i) {
  const hovered = i === charCursor && !okMode;
  const selected = i === charSel;
  // sub-state machine mirroring func_800AA69C (updates once per rAF, ~2x native 30 Hz)
  st.t--;
  if (st.t <= 0) {
    switch (st.sub) {
      case 0: { // base: blink on random_int(0xC8) >= 0xC5 (menus.c:9876)
        const r = (Math.random() * 200) | 0;
        if (selected && hovered) { st.sub = 1; st.idx = 0; }
        else if (r >= 0xC6) { st.sub = 4; st.idx = 0; }
        else if (r >= 0xC5) { st.sub = 5; st.idx = 0; }
        st.t = 1; break;
      }
      case 1: // celebrate 06..15; native holds 15 (D_800E8440=0x0a -> substate 2 hover)
        st.idx++; st.t = ANIM.celebrate.rate;
        if (st.idx >= ANIM.celebrate.seq.length) {
          if (selected && hovered) { st.idx = ANIM.celebrate.seq.length - 1; st.t = 5; }   // hold face 15
          else { st.sub = 3; st.idx = 0; }   // deselected -> 15..06 @2
        }
        break;
      case 3: // deselect: 15->06 @2 then back to base
        st.idx++; st.t = ANIM.deselect.rate;
        if (st.idx >= ANIM.deselect.seq.length) { st.sub = 0; st.t = ANIM.base.rate; }
        break;
      case 4: case 5: { // single/double blink
        const seq = st.sub === 4 ? ANIM.singleBlink : ANIM.doubleBlink;
        st.idx++; st.t = seq[st.idx]?.rate ?? 1;
        if (st.idx >= seq.length) { st.sub = 0; st.t = ANIM.base.rate; }
        break;
      }
    }
  }
  // hover shows face 15 (D_800E8340 [15@5]); selected runs its animation
  if (hovered && !selected && st.sub !== 1 && st.sub !== 3) return 15;
  switch (st.sub) {
    case 1: return ANIM.celebrate.seq[Math.min(st.idx, ANIM.celebrate.seq.length - 1)];
    case 3: return ANIM.deselect.seq[Math.min(st.idx, ANIM.deselect.seq.length - 1)];
    case 4: { const s = ANIM.singleBlink[Math.min(st.idx, ANIM.singleBlink.length - 1)]; return s.frames[0]; }
    case 5: { const s = ANIM.doubleBlink[Math.min(st.idx, ANIM.doubleBlink.length - 1)]; return s.frames[0]; }
    default: return ANIM.base.frames[0];
  }
}
function charStep(now) {
  if (curScreen !== charEl) return;
  menuTick = Math.floor(now / 1000 * 30);
  faceState.forEach((st, i) => {
    const f = frameOf(st, i);
    // atlas is 17 frames stacked: shift the img up by f frames inside the overflow-hidden holder
    faceImgs[i].style.top = `-${f * 64}px`;
  });
  // P1 border: env colour pulses 191..255 once the character is picked (menu_items.c:6072-6090)
  const cell = $('charGrid').children[charSel ?? charCursor];
  if (cell) {
    let t = menuTick % 16; t = t >= 8 ? 128 - t * 8 : t * 8;
    cell.querySelector('.border').style.filter = charSel !== null ? `brightness(${(t + 191) / 255})` : '';
  }
  // OK box flashes grey (draw_flash_select_case_slow, speed 64) while PLAYER_SELECT_MENU_OK
  $('charOk').querySelector('.box').style.background = boxColour(okMode, false);
}
function enterChar(trackId) {
  selCourse = trackId;
  showScreen(charEl, 'Click a driver, or use the arrow keys and Enter · Esc goes back to course select');
  okMode = false; charSel = null; charCursor = 0;   // P1 cursor starts on grid 1 (Mario)
  faceState.length = 0; faceImgs.length = 0;
  const grid = $('charGrid');
  grid.innerHTML = '';
  CHAR_ORDER.forEach((c, i) => {
    const b = document.createElement('button');
    b.className = 'char';
    b.style.left = `${CHAR_POS[i][0]}px`; b.style.top = `${CHAR_POS[i][1]}px`;
    b.setAttribute('aria-label', NAMES[c]);
    const holder = document.createElement('div');
    holder.className = 'holder';
    const img = document.createElement('img');
    img.className = 'face'; img.alt = '';
    HD.setImg(img, `faces/${c}.png`);
    holder.appendChild(img);
    faceImgs.push(img);
    faceState.push({ sub: 0, idx: 0, t: ANIM.base.rate });
    const name = document.createElement('img');
    name.className = 'name'; name.alt = '';
    HD.setImg(name, `charselect/name_${c}.png`);
    const border = document.createElement('img');
    border.className = 'border'; border.alt = '';
    HD.setImg(border, 'charselect/p1_border_blue.png');
    b.append(holder, name, border);
    b.onclick = () => { charCursor = i; pickChar(i); };
    grid.appendChild(b);
  });
  updateCharClasses();
}
function updateCharClasses() {
  // PLAYER_SELECT_MENU_OK (1P): the chosen portrait slides to D_800E7188[0] = (128,88) and the other seven
  // close up (func_800AAA9C / func_800AAC18); OK opens at (264,202). Going back restores the grid.
  [...$('charGrid').children].forEach((b, i) => {
    const on = i === (charSel ?? charCursor);
    b.classList.toggle('cursor', on);
    b.classList.toggle('closed', okMode && !on);
    const [x, y] = okMode && on ? [128, 88] : CHAR_POS[i];
    b.style.left = `${x}px`; b.style.top = `${y}px`;
    if (!on) b.querySelector('.border').style.filter = '';
  });
  $('charOk').classList.toggle('closed', !okMode);
}
// characterId (include/defines.h MARIO..BOWSER) for the pick voice
const CHAR_ID = { mario: 0, luigi: 1, yoshi: 2, toad: 3, donkeykong: 4, wario: 5, peach: 6, bowser: 7 };
function pickChar(slot) {
  charSel = slot;
  okMode = true;   // single player: every pick leads to OK (menus.c:1543)
  audio.voice(CHAR_ID[CHAR_ORDER[slot]]);   // func_800C90F4(.., characterId * 0x10 + 0x2900800E)
  updateCharClasses();
  $('charOk').focus();
}
let leaving = false;
function confirmChar() {
  if (charSel === null || leaving) return;
  const c = CHAR_ORDER[charSel];
  localStorage.setItem('mk64char', c);
  snd('okClicked');
  leaving = true;   // let SOUND_MENU_OK_CLICKED play before the page reloads into the race
  setTimeout(() => { location.search = `?track=${selCourse}&char=${c}&cc=${CC_ROWS[ccSel].replace('cc', '')}&mode=${PMODES[pcount][pmode]}${pcount ? `&players=${pcount + 1}` : ''}`; }, 500);
}
function backFromChar() {
  snd('back');
  if (okMode) { okMode = false; charSel = null; updateCharClasses(); return; }   // B on OK goes back (menus.c:1651)
  showScreen(menuEl, 'Course select: ←/→ pick a cup, Enter · ↑/↓ pick a course, Enter · Enter on OK starts · Esc goes back');
  cupMode('ok');
}
$('charOk').onclick = confirmChar;

if (!trackDef) {
  canvas.style.display = 'none';   // menus are the 4:3 frame on black, like the console output
  screenEl.style.display = 'block';
  hintEl.style.display = 'block';
  fitScreen();
  buildGameSelect();
  buildCourseMenu();
  if (params.get('menu') === 'course') {   // M from a race: back on the course menu, that race's course picked
    pcount = Math.min(3, Math.max(0, (+params.get('players') || 1) - 1));
    pmode = Math.max(0, PMODES[pcount].indexOf(raceMode));
    const cc = ccParam === 'extra' ? 'extra' : `${ccParam}cc`;
    ccSel = CC_ROWS.includes(cc) ? CC_ROWS.indexOf(cc) : 0;
    gameMode = hasCc() ? 'cc' : 'mode';
    updateGameSelect();
    const ti = Math.max(0, TRACKS.findIndex(t => t.id === params.get('from')));
    cupSel = Math.floor(ti / 4); courseIdx = ti % 4;
    showScreen(menuEl, cupSel === 4 ? 'Battle course select: ↑/↓ pick an arena, Enter · Enter on OK starts · Esc goes back'
      : 'Course select: ←/→ pick a cup, Enter · ↑/↓ pick a course, Enter · Enter on OK starts · Esc goes back');
    cupMode('course');
    audio.playMusic(2);   // SEQ_MENU_MAIN_MENU
  } else {
    backToTitle();
    audio.welcome();   // menu_items.c:2618 plays SOUND_INTRO_WELCOME as the title screen comes up
  }
} else if (!params.get('players')) {
  $('hud').style.display = 'block';   // online: the HUD comes up with GO (startRace)
}
titleEl.addEventListener('click', enterMenus);
addEventListener('keydown', e => {
  if (!trackDef) {
    if (atTitle() && (e.code === 'Enter' || e.code === 'Space' || e.code === 'NumpadEnter')) { e.preventDefault(); enterMenus(); return; }
    if (curScreen === charEl) {
      // player_select_menu_act: left/right stay inside the row (ids 1-4 / 5-8), up/down swap rows
      const col = charCursor % 4, row = charCursor >> 2;
      const move = { ArrowLeft: col > 0 ? -1 : 0, ArrowRight: col < 3 ? 1 : 0, ArrowUp: row > 0 ? -4 : 0, ArrowDown: row < 1 ? 4 : 0 }[e.code];
      if (move !== undefined) {
        e.preventDefault();
        if (!okMode && move) { charCursor += move; updateCharClasses(); snd('move'); }
        return;
      }
      if (e.code === 'Enter' || e.code === 'NumpadEnter' || e.code === 'Space') {
        e.preventDefault();
        if (okMode) confirmChar(); else pickChar(charCursor);
        return;
      }
      if (e.code === 'Escape' || e.code === 'Backspace') { e.preventDefault(); backFromChar(); return; }
      return;
    }
    if (curScreen === gameEl) {
      // main_menu_act: MAIN_MENU_PLAYER_SELECT left/right over the columns, A picks; MAIN_MENU_MODE_SELECT up/down the rows
      const enter = e.code === 'Enter' || e.code === 'NumpadEnter' || e.code === 'Space';
      const back = e.code === 'Escape' || e.code === 'Backspace';
      if (e.code.startsWith('Arrow') || enter || back) e.preventDefault();
      if (e.code === 'KeyL' && !e.repeat) { enterOption(); return; }   // L_TRIG -> MAIN_MENU_OPTION (from any game select step)
      if (e.code === 'KeyR' && !e.repeat) { enterData(); return; }     // R_TRIG -> MAIN_MENU_DATA
      if (gameMode === 'player') {
        if (e.code === 'ArrowLeft' && pcount > 0) { pcount--; snd('move'); }
        else if (e.code === 'ArrowRight' && pcount < 3) { pcount++; snd('move'); }
        else if (enter) { gameMode = 'mode'; pmode = 0; snd('select'); updateGameSelect(); }
        else if (back) { backToTitle(); snd('back'); }
      } else if (gameMode === 'mode') {
        if (e.code === 'ArrowUp' && pmode > 0) { pmode--; snd('move'); }
        else if (e.code === 'ArrowDown' && pmode < PMODES[pcount].length - 1) { pmode++; snd('move'); }
        else if (enter) pickMode();
        else if (back) { gameMode = 'player'; snd('back'); updateGameSelect(); }
      } else {   // MAIN_MENU_MODE_SUB_SELECT: up/down the cc rows, B back to the modes
        if (e.code === 'ArrowUp' && ccSel > 0) { ccSel--; snd('move'); updateGameSelect(); }
        else if (e.code === 'ArrowDown' && ccSel < CC_ROWS.length - 1) { ccSel++; snd('move'); updateGameSelect(); }
        else if (enter) pickCc();
        else if (back) { gameMode = 'mode'; snd('back'); updateGameSelect(); }
      }
      return;
    }
    if (curScreen === optEl || curScreen === dataEl) {
      const enter = e.code === 'Enter' || e.code === 'NumpadEnter' || e.code === 'Space';
      const back = e.code === 'Escape' || e.code === 'Backspace';
      if (e.code.startsWith('Arrow') || enter || back) e.preventDefault();
      (curScreen === optEl ? optionKey : dataKey)(e.code, enter, back);
      return;
    }
    if (curScreen === menuEl) {
      // SUB_MENU_MAP_SELECT_CUP: left/right cup; _COURSE: up/down course; _OK: A starts, B steps back
      const enter = e.code === 'Enter' || e.code === 'NumpadEnter' || e.code === 'Space';
      const back = e.code === 'Escape' || e.code === 'Backspace';
      if (e.code.startsWith('Arrow') || enter || back) e.preventDefault();
      if (courseMode === 'cup') {
        if (e.code === 'ArrowLeft' && cupSel > 0) { cupSel--; cupMode('cup'); snd('move'); }
        else if (e.code === 'ArrowRight' && cupSel < 3) { cupSel++; cupMode('cup'); snd('move'); }
        else if (enter) { cupMode('course'); snd('select'); }
        else if (back) { enterGameSelect(); snd('back'); }
      } else if (courseMode === 'course') {
        if (e.code === 'ArrowUp' && courseIdx > 0) { courseIdx--; cupMode('course'); snd('move'); }
        else if (e.code === 'ArrowDown' && courseIdx < 3) { courseIdx++; cupMode('course'); snd('move'); }
        else if (enter) { cupMode('ok'); snd('select'); }
        else if (back) { if (cupSel === 4) enterGameSelect(); else cupMode('cup'); snd('back'); }   // battle: B returns to the main menu
      } else {
        if (enter) { snd('okClicked'); enterChar(cupCourses(cupSel)[courseIdx].id); }
        else if (back) { cupMode('course'); snd('back'); }
      }
      return;
    }
  }
});

// ------- online (2P-4P GAME): ../GoKart-style lobby + WebRTC mesh (src/net.js) -------
// The race page with ?players=N quick-matches on mk64js.gokart.games: a room for N starts 15 s after its first
// player arrives (or as soon as it is full). Everyone races the room's course, so a player who picked another one
// reloads onto it (?room=&you= rejoin the room). Every game drives only its own kart and sends its pose ~30 times a
// second; the other karts are puppets replaying those poses 0.1 s in the past. Items: you roll and use your own,
// every banana / shell / star / boo / lightning you use appears in the other games, and only the player who gets hit decides it (their spin
// arrives in their pose). The lowest id is the host: each game says READY once its mesh is up, the host answers
// GO and all run Lakitu's start countdown together. Every online grid is MAX_ONLINE_KARTS karts: the humans who showed up,
// then CPU karts in the empty seats. The host (lowest id) drives the CPU karts and sends their poses and items like
// its own (they carry an `id`); the other games show them as puppets. If the host leaves, the next one takes them over.
// Enter on the lobby (nobody came) races MAX_ONLINE_KARTS offline with CPU karts.
// MAX_ONLINE_KARTS can go up to 8 (GRID_SLOTS has 8 spots). Raising it: also MAX_ROOM_PLAYERS in website/src/lobby.js
// if more than 4 humans, viewRects (split screen has 4 panes) and battleSpawn (4 arena spots) / setup's battle cap.
const MAX_ONLINE_KARTS = 4;
const PLAYERS_WANTED = Math.min(MAX_ONLINE_KARTS, Math.max(0, +params.get('players') || 0));
const online = !!trackDef && PLAYERS_WANTED >= 2;
// TIME TRIALS (1P): the player alone (setup) with three mushrooms and no item boxes (actors.c spawn_item_box_actors)
const timeTrial = raceMode === 'time_trials' && !online;
if (timeTrial) { for (const b of items.boxes) items.group.remove(b.mesh); items.boxes = []; }
const net = online ? new Net() : null;
const lobbyEl = $('lobby'), lobbyCount = $('lobbyCount'), lobbyList = $('lobbyList'), lobbyMsg = $('lobbyMsg');
const SEND_INTERVAL = 1 / 30, PUPPET_DELAY = 0.1;
let sendClock = 0, netReady = new Set(), raceGo = false;
const peerKart = id => karts.find(k => k.netId === id);
// Drivers by player id (the same on every peer): a driver picked twice goes to the first free one, in native order.
function resolveChars(players) {
  const taken = new Set(), out = new Map();
  for (const p of players) {
    const c = characters.includes(p.char) && !taken.has(p.char) ? p.char : characters.find(x => !taken.has(x));
    taken.add(c); out.set(p.id, c);
  }
  return out;
}
function lobbyShow(players, countdown, max) {
  lobbyCount.textContent = countdown >= 0 ? countdown : '';
  lobbyList.innerHTML = '';
  const chars = resolveChars(players);
  for (const p of players) {
    const d = document.createElement('div');
    d.textContent = `P${p.id}  ${NAMES[chars.get(p.id)].toUpperCase()}${p.id === net.myId ? ' (YOU)' : ''}`;
    if (p.id === net.myId) d.className = 'me';
    lobbyList.appendChild(d);
  }
  for (let i = players.length; i < max; i++) { const d = document.createElement('div'); d.textContent = '· · ·'; d.style.opacity = .5; lobbyList.appendChild(d); }
}
// Grid in id order, then the CPU karts (unpicked drivers in native order, ids 'c1'..) - the same on every peer.
function setupOnline() {
  for (const k of karts) { scene.remove(k.mesh); k.mesh.userData.dispose(); }
  karts = []; finishOrder = []; raceTime = 0; state = 'countdown'; raceGo = false;
  const chars = resolveChars(net.players);
  const seats = net.players.map(p => ({ id: p.id, c: chars.get(p.id) }));
  const free = characters.filter(c => ![...chars.values()].includes(c));
  while (seats.length < MAX_ONLINE_KARTS && free.length) seats.push({ id: `c${seats.length + 1}`, c: free.shift(), cpu: true });
  seats.forEach(({ id, c, cpu }, i) => {
    const ci = characters.indexOf(c);
    const [d, back] = GRID_SLOTS[i];
    const mine = id === net.myId;
    const k = new Kart(track, { color: PALETTE[ci], s: track.length - back, d, isPlayer: mine, name: names[ci], character: c,
      skill: cpu ? 0.6 + 0.4 * Math.random() : 1,
      spawn: battle ? battleSpawn(trackDef.id, i) : null, speedScale: ccSpeedScale(engine, c), cc });
    k.netId = id; k.cpu = !!cpu; k.remote = cpu ? !net.hostIsMe : !mine; k.poses = [];
    k.aiOffset = d * 0.8;
    k.prevS = k.s; k.crossings = -1;   // gLapCountByPlayerId starts at -1: crossing the line from the grid begins lap 1
    scene.add(k.mesh); karts.push(k);
    if (mine) player = k;
  });
  if (raceMode === 'mario_gp' && net.hostIsMe) pickRivals(karts);
  setViews(karts.filter(k => !k.cpu));   // every human player's view, in grid order, like the console's split screen
  banner.textContent = '';
  items.reset();
  startCountdown();
}
function sendPose() {
  sendKartPose(player);
  if (net.hostIsMe) for (const k of karts) if (k.cpu && !k.remote) sendKartPose(k, k.netId);
}
function sendKartPose(k, id) {   // id: a CPU kart the host drives (a human's pose is known by who sent it)
  if (battle) {   // arena: world position and heading; balloons left and out ride along (the victim decides hits)
    net.send({ t: 'p', id, x: k.x, z: k.z, h: k.h, v: k.v, y: k.y, air: k.air ? 1 : 0, dr: k.drift, b: k.boost, sp: k.spin,
      sv: k.steerVis, bl: k.balloons, o: k.out ? 1 : 0, r: k.rescue > 0 ? 1 : 0, ...tumblePose(k) }, false);
    return;
  }
  net.send({ t: 'p', id, s: k.s, d: k.d, psi: k.psi, v: k.v, y: k.world.y, air: k.air ? 1 : 0,
    dr: k.drift, b: k.boost, sp: k.spin, sv: k.steerVis, c: k.crossings, f: k.finished ? k.finishTime : -1, ...tumblePose(k) }, false);
}
// an item-hit tumble rides along as its gKartTextureTumbles frame (unk_0A8 >> 8) and hop height, so the puppet shows it
const tumblePose = k => k.tumble ? { tu: k.tumble.a8, tl: k.tumble.lift } : {};
const puppetTumble = (k, src) => { k.tumble = src.tu != null ? { a8: src.tu, lift: src.tl } : null; };
function puppetStepArena(k, now) {
  const P = k.poses;
  if (!P.length) return;
  const t = now - PUPPET_DELAY * 1000;
  while (P.length > 2 && P[1].rx <= t) P.shift();
  const a = P[0], b = P[1];
  let x = a.x, z = a.z, h = a.h, v = a.v, y = a.y, src = a;
  if (b && b.rx > a.rx) {
    const u = Math.min(1, Math.max(0, (t - a.rx) / (b.rx - a.rx)));
    let dh = b.h - a.h; dh = Math.atan2(Math.sin(dh), Math.cos(dh));
    x += (b.x - a.x) * u; z += (b.z - a.z) * u; h += dh * u; v += (b.v - a.v) * u; y += (b.y - a.y) * u;
    if (u >= 1) src = b;
  } else if (!b) {
    const e = v * Math.min(0.3, Math.max(0, (t - a.rx) / 1000));   // dead reckoning along the heading
    x += Math.sin(h) * e; z += Math.cos(h) * e;
  }
  k.x = x; k.z = z; k.h = h; k.v = v; k.y = y;
  k.drift = src.dr; k.boost = src.b; k.spin = src.sp; k.spinAngle = src.sp > 0 ? (k.spinAngle + 11 / 60) : 0; k.steerVis = src.sv;
  k.balloons = src.bl; k.out = !!src.o; k.rescue = src.r ? 1 : 0;
  k.air = !!src.air;
  puppetTumble(k, src);
  k.syncFree(0);
  k.y = y; k.world.y = y; k.mesh.position.y = y;   // the owner's height is the truth (falls, rescue)
}
// Replay the puppet's poses PUPPET_DELAY behind their arrival; extrapolate along the road past the newest.
function puppetStep(k, now) {
  if (battle) return puppetStepArena(k, now);
  const P = k.poses;
  if (!P.length) return;
  const L = track.length, t = now - PUPPET_DELAY * 1000;
  while (P.length > 2 && P[1].rx <= t) P.shift();
  const a = P[0], b = P[1];
  let s = a.s, d = a.d, psi = a.psi, v = a.v, y = a.y, src = a;
  if (b && b.rx > a.rx) {
    const u = Math.min(1, Math.max(0, (t - a.rx) / (b.rx - a.rx)));
    let ds = b.s - a.s; if (ds > L / 2) ds -= L; if (ds < -L / 2) ds += L;
    const dpsi = Math.atan2(Math.sin(b.psi - a.psi), Math.cos(b.psi - a.psi));   // a player kart can turn round past +-180
    s = a.s + ds * u; d += (b.d - a.d) * u; psi += dpsi * u; v += (b.v - a.v) * u; y += (b.y - a.y) * u;
    if (u >= 1) src = b;
  } else if (!b) {
    s += v * Math.min(0.3, Math.max(0, (t - a.rx) / 1000));   // dead reckoning along the road
  }
  k.s = ((s % L) + L) % L; k.d = d; k.psi = k.phi = psi; k.v = v;
  k.drift = src.dr; k.boost = src.b; k.spin = src.sp; k.spinAngle = src.sp > 0 ? (k.spinAngle + 11 / 60) : 0; k.steerVis = src.sv;
  k.crossings = src.c;
  if (src.f >= 0 && !k.finished) { k.finished = true; k.finishTime = src.f; finishOrder.push(k); }
  puppetTumble(k, src);
  k.syncMesh(0);
  if (src.air) { k.world.y = y; k.mesh.position.y = y; }
}
function useItem() { sendItem(items.use(player, karts)); }
// item button let go: a held banana / fake box / shell leaves (stick up throws a banana ahead, stick down sends a green
// shell back; on the keyboard Down / S holds the stick down)
function releaseItem(stickY = (keys.ArrowDown || keys.KeyS) ? -80 : 0) { if (player) sendItem(items.release(player, karts, stickY)); }
function sendItem(item, k = player) {   // what was fired: the other games replay it with items.fire
  const id = k.cpu ? k.netId : undefined;
  if (online && item) net.send(battle ? { t: 'item', id, item, x: k.x, z: k.z, h: k.h, y: k.y } : { t: 'item', id, item, s: k.s, d: k.d });
}
// the host's CPU karts fire from Items (aiUse / cpuStrategy), not from useItem
items.onFire = (k, kind) => { if (online && k.cpu && !k.remote) sendItem(kind, k); };
function onlineData(from, m) {
  const k = m.id != null ? peerKart(m.id) : peerKart(from);
  switch (m.t) {
    case 'p': if (k) { m.rx = performance.now(); k.poses.push(m); if (k.poses.length > 30) k.poses.shift(); } break;
    case 'item': if (k) { if (battle) { k.x = m.x; k.z = m.z; k.h = m.h; k.y = m.y; } else { k.s = m.s; k.d = m.d; } items.fire(k, m.item, karts); } break;
    case 'ready': netReady.add(from); hostCheckGo(); break;
    case 'go': startRace(); break;
  }
}
function hostCheckGo() {
  if (!net.hostIsMe || raceGo) return;
  if (net.players.every(p => p.id === net.myId || netReady.has(p.id))) { net.send({ t: 'go' }); startRace(); }
}
function startRace() {
  if (raceGo) return;
  raceGo = true;
  lobbyEl.style.display = 'none';
  $('hud').style.display = 'block';
}
function raceCpuInstead() {   // Enter on the lobby: nobody came, so CPU karts fill the empty seats (MAX_ONLINE_KARTS karts)
  net.leave();
  setup(MAX_ONLINE_KARTS);
  startRace();
}
if (online) {
  lobbyEl.style.display = 'block';
  lobbyCount.textContent = '';
  net.addEventListener('room', e => lobbyShow(e.detail.players, e.detail.countdown, e.detail.max));
  net.addEventListener('start', e => {
    const m = e.detail;
    if (m.course !== trackDef.id) {   // the room races the host's course: reload onto it, then rejoin
      location.search = `?track=${m.course}&char=${playerChar}${ccParam ? `&cc=${ccParam}` : ''}&mode=${raceMode}&players=${PLAYERS_WANTED}&room=${m.code}&you=${m.you}`;
      return;
    }
    lobbyShow(m.players, -1, m.players.length);
    lobbyMsg.textContent = 'CONNECTING…';
    net.ready();
  });
  net.addEventListener('mesh', () => {
    lobbyMsg.textContent = 'READY';
    setupOnline();
    netReady.add(net.myId);
    net.send({ t: 'ready' });
    hostCheckGo();
  });
  net.addEventListener('data', e => onlineData(e.detail.from, e.detail.msg));
  net.addEventListener('left', e => {
    const k = peerKart(e.detail.id);
    if (k) { scene.remove(k.mesh); k.mesh.userData.dispose(); karts = karts.filter(q => q !== k); }
    if (net.hostIsMe) for (const q of karts) if (q.cpu && q.remote) { q.remote = false; q.poses = []; q.prevS = q.s; }   // new host: drive the CPU karts
    if (karts.filter(q => !q.cpu).length <= 1 && state !== 'finished') { banner.textContent = 'OPPONENT LEFT'; setTimeout(() => { if (banner.textContent === 'OPPONENT LEFT') banner.textContent = ''; }, 3000); }
    hostCheckGo();
  });
  net.addEventListener('error', e => { lobbyMsg.textContent = e.detail.message; lobbyCount.textContent = ''; });
  if (params.get('room')) net.rejoin(params.get('room'), +params.get('you'));
  else net.quickMatch({ name: NAMES[playerChar] || playerChar, course: trackDef.id, char: playerChar, players: PLAYERS_WANTED, mode: raceMode });
  addEventListener('keydown', e => {
    if (lobbyEl.style.display !== 'block' || raceGo) return;
    if (e.code === 'Escape' || e.code === 'Backspace') { net.leave(); location.search = ''; }
    else if ((e.code === 'Enter' || e.code === 'NumpadEnter') && net.state === 'lobby') raceCpuInstead();
  });
}

// input
const keys = {};
addEventListener('keydown', e => {
  keys[e.code] = true;
  if (trackDef) audio.start();   // menu: no engine hum (audio.update never runs there, so it droned)
  // Mac "delete" is Backspace, forward-delete is Delete; L/R are kept for the menu's L OPTION / R DATA
  if ((e.code === 'Backspace' || e.code === 'Delete') && trackDef && !online) { e.preventDefault(); setup(); }
  // M in a race goes back to the course menu with the same players / mode / cc; on the menus it goes to the title
  if (e.code === 'KeyM') location.search = trackDef ? `?menu=course&from=${trackDef.id}&mode=${raceMode}${ccParam ? `&cc=${ccParam}` : ''}${PLAYERS_WANTED ? `&players=${PLAYERS_WANTED}` : ''}` : '';
  if (e.code === 'KeyN') audio.toggleMusic();
  if (e.code === 'KeyG') { HD.cyclePreset(); showRes(); }
  if (e.code === 'KeyJ' && !e.repeat) showRes(togglePhysics());   // jump mode Jumps / Glue, saved
  // Q is a second item button that holds the stick up on release: a held banana is thrown ahead (gamepad: stick up)
  if ((e.code === 'ShiftLeft' || e.code === 'ShiftRight' || e.code === 'KeyE' || e.code === 'KeyQ') && !e.repeat && state !== 'countdown' && player) useItem();
  if (e.code.startsWith('Arrow') || e.code === 'Space') e.preventDefault();
});
addEventListener('keyup', e => {
  keys[e.code] = false;
  if (e.code === 'ShiftLeft' || e.code === 'ShiftRight' || e.code === 'KeyE') releaseItem();
  if (e.code === 'KeyQ') releaseItem(80);   // N64 rawStickY at full tilt up
});
// gamepad: A/RT gas, B/LT brake, LB/RB drift, X/Y item, Start restart, stick or d-pad steers
let padItemHeld = false, padStartHeld = false;
function pollPad() {
  const pad = (navigator.getGamepads ? [...navigator.getGamepads()] : []).find(p => p && p.connected);
  if (!pad) return null;
  const b = i => !!(pad.buttons[i] && pad.buttons[i].pressed);
  const item = b(2) || b(3), start = b(9);
  if (item && !padItemHeld && state !== 'countdown' && player) useItem();
  if (!item && padItemHeld) releaseItem(-(pad.axes[1] || 0) * 80);   // N64 rawStickY, about +-80 at full tilt
  if (start && !padStartHeld && !online) setup();
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
  const inp = !p ? kb : {
    throttle: Math.max(kb.throttle, p.throttle),
    brake: Math.max(kb.brake, p.brake),
    steer: kb.steer || p.steer,
    drift: kb.drift || p.drift,
  };
  if (mirror) inp.steer = -inp.steer;   // EXTRA: left on the stick turns left on the mirrored screen
  return inp;
}

// minimap
const mm = [];
{
  let minX = 1e9, maxX = -1e9, minZ = 1e9, maxZ = -1e9;
  if (track.arena) ({ minX, maxX, minZ, maxZ } = track.bounds);
  else for (const p of track.pos) { minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x); minZ = Math.min(minZ, p.z); maxZ = Math.max(maxZ, p.z); }
  const sc = 300 / Math.max(maxX - minX, maxZ - minZ);
  mm.push(sc, minX, minZ, 20 + (300 - (maxX - minX) * sc) / 2, 20 + (300 - (maxZ - minZ) * sc) / 2);
}
function drawMini() {
  const [sc, minX, minZ, ox, oy] = mm;
  mini.clearRect(0, 0, 340, 340);
  mini.lineWidth = 9; mini.strokeStyle = '#fff'; mini.lineJoin = 'round'; mini.beginPath();
  if (track.arena) {   // arena: its footprint and the item boxes
    const b = track.bounds;
    mini.strokeRect(ox, oy, (b.maxX - b.minX) * sc, (b.maxZ - b.minZ) * sc);
    mini.fillStyle = '#ffd23a';
    for (const bx of items.boxes) if (bx.cd <= 0) mini.fillRect(ox + (bx.x - minX) * sc - 3, oy + (bx.z - minZ) * sc - 3, 6, 6);
  } else {
    track.pos.forEach((p, i) => { const x = ox + (p.x - minX) * sc, y = oy + (p.z - minZ) * sc; i ? mini.lineTo(x, y) : mini.moveTo(x, y); });
    mini.closePath(); mini.stroke();
  }
  for (const k of karts) {
    mini.fillStyle = '#' + k.color.toString(16).padStart(6, '0');
    mini.strokeStyle = '#000'; mini.lineWidth = 3;
    mini.beginPath(); mini.arc(ox + (k.world.x - minX) * sc, oy + (k.world.z - minZ) * sc, k === player ? 10 : 7, 0, 7);
    mini.fill(); mini.stroke();
  }
}

// ------- views: one chase camera per screen player. MK64 split screen (skybox_and_splitscreen.c): 2P stacks P1 over
// P2 (SCREEN_MODE_2P_SPLITSCREEN_HORIZONTAL, 320x120 each); 3P/4P are quadrants P1 top-left, P2 top-right, P3
// bottom-left, P4 bottom-right (SCREEN_MODE_3P_4P_SPLITSCREEN); in 3P the fourth quadrant draws no course, only
// its HUD (render_player_four_3p_4p_screen), which here holds the course map. Online every game shows every
// player's view, so the screen matches the console's; only the local player's view carries the full HUD.
const mkView = (cam, kart) => { cam.userData.kart = kart; return { cam, kart, pos: new THREE.Vector3(), up: new THREE.Vector3(0, 1, 0), look: new THREE.Vector3(), init: false, rect: [0, 0, 1, 1], hud: null }; };   // userData.kart: the battle balloons' own screen
let views = [mkView(camera, null)];
const miniEl = $('mini'), hudEl = $('hud');
function setViews(list) {
  for (const v of views) if (v.hud) v.hud.remove();
  views = list.map((k, i) => mkView(i === 0 ? camera : mirrorCamera(new THREE.PerspectiveCamera(70, 1, 0.5, 2500)), k));
  views.forEach((v, i) => {
    if (!v.kart || v.kart === player) return;
    v.hud = document.createElement('div');
    v.hud.className = 'vhud';
    v.hud.innerHTML = `<div class="vpos"></div><div class="vlap"></div><div class="vname">P${i + 1} ${v.kart.name.toUpperCase()}</div>`;
    document.body.appendChild(v.hud);
  });
  layoutViews();
  lakitu.setViews(views);
}
// Viewport rects as fractions of the frame (x, y from the top-left, w, h).
function viewRects(n) {
  if (n <= 1) return [[0, 0, 1, 1]];
  if (n === 2) return [[0, 0, 1, 0.5], [0, 0.5, 1, 0.5]];
  return [[0, 0, 0.5, 0.5], [0.5, 0, 0.5, 0.5], [0, 0.5, 0.5, 0.5], [0.5, 0.5, 0.5, 0.5]].slice(0, n);
}
function layoutViews() {
  const rects = viewRects(views.length), n = views.length;
  const zoom = n === 1 ? 1 : n === 2 ? 0.7 : 0.55;
  views.forEach((v, i) => {
    v.rect = rects[i];
    v.cam.aspect = (innerWidth * v.rect[2]) / (innerHeight * v.rect[3]); v.cam.updateProjectionMatrix();
    const box = el => { el.style.left = `${v.rect[0] * 100}%`; el.style.top = `${v.rect[1] * 100}%`; el.style.width = `${v.rect[2] * 100}%`; el.style.height = `${v.rect[3] * 100}%`; };
    if (v.hud) { box(v.hud); v.hud.style.zoom = zoom; }
    if (v.kart === player || !v.kart) { box(hudEl); hudEl.style.zoom = zoom; }
  });
  // 3P: the course map takes the empty fourth quadrant
  if (n === 3) { document.body.appendChild(miniEl); Object.assign(miniEl.style, { position: 'fixed', left: `calc(75vw - 85px)`, top: `calc(75vh - 85px)`, zIndex: 3 }); }
  else if (miniEl.parentElement !== hudEl) { hudEl.prepend(miniEl); Object.assign(miniEl.style, { position: '', left: '', top: '', zIndex: '' }); }
}
function updateCamera(dt, v) {
  const k = v.kart, camera = v.cam;
  if (k.rescue?.watch) { camera.lookAt(k.world); return; }   // camera.c: holds still while Lakitu fishes the kart out
  if (k.rescue?.snap) { k.rescue.snap = false; v.init = false; }   // and cuts back behind it over the road
  const behind = k.fwd.clone().multiplyScalar(-(9 + Math.min(k.v, 60) * 0.06)).addScaledVector(k.up, 4.2);
  const target = k.world.clone().add(behind);
  const a = v.init ? 1 - Math.exp(-dt * 7) : 1;
  v.pos.lerp(target, a);
  v.up.lerp(k.up, 1 - Math.exp(-dt * 4)).normalize();
  v.look.copy(k.world).addScaledVector(k.up, 1.6).addScaledVector(k.fwd, 6);
  camera.position.copy(v.pos); camera.up.copy(v.up); camera.lookAt(v.look);
  camera.fov += ((68 + Math.min(k.v, 62) * 0.35 + (k.boost > 0 ? 10 : 0)) - camera.fov) * Math.min(1, dt * 4);
  camera.updateProjectionMatrix();
  v.init = true;
  if (k === player) { sun.position.copy(k.world).add(new THREE.Vector3(60, 100, 40)); sun.target.position.copy(k.world); }
}
function renderViews() {
  if (views.length === 1) { updateSky(camera); renderer.render(scene, camera); return; }
  const size = renderer.getDrawingBufferSize(new THREE.Vector2());
  renderer.setScissorTest(true);
  const rect = r => [Math.round(r[0] * size.x), Math.round((1 - r[1] - r[3]) * size.y), Math.round(r[2] * size.x), Math.round(r[3] * size.y)];
  for (const v of views) {
    const [x, y, w, h] = rect(v.rect);
    renderer.setViewport(x, y, w, h); renderer.setScissor(x, y, w, h);
    exhaust.draw(karts, v.cam);
    updateSky(v.cam, w, h);
    renderer.render(scene, v.cam);
  }
  if (views.length === 3) { const [x, y, w, h] = rect([0.5, 0.5, 0.5, 0.5]); renderer.setViewport(x, y, w, h); renderer.setScissor(x, y, w, h); renderer.clear(); }
  renderer.setScissorTest(false);
  renderer.setViewport(0, 0, size.x, size.y);
}

// Presentation: render HD.renderLines() lines (1x = N64 240p, upscaled with hard pixels). G cycles presets.
function resize() {
  const h = HD.renderLines();
  const w = Math.round(h * innerWidth / innerHeight);
  renderer.setSize(w, Math.round(h), false);
  canvas.style.imageRendering = HD.smooth() ? 'auto' : 'pixelated';
  camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix();
  layoutViews();
}
addEventListener('resize', resize); resize();
if (mirror) miniEl.style.transform = 'scaleX(-1)';   // the course map follows the mirrored course
HD.onChange(resize);
let resTimer = 0;
function showRes(text = `${HD.presetLabel()} · textures ${HD.tier()}×`) {
  const el = $('res');
  el.textContent = text;
  el.style.display = 'block';
  clearTimeout(resTimer); resTimer = setTimeout(() => { el.style.display = 'none'; }, 1500);
}

function collide() {
  const L = track.length;
  if (battle) {   // arena: push overlapping karts apart in the ground plane
    for (let i = 0; i < karts.length; i++) for (let j = i + 1; j < karts.length; j++) {
      const a = karts[i], b = karts[j];
      if (a.rescue > 0 || b.rescue > 0 || Math.abs(a.y - b.y) > 2.5) continue;
      const dx = b.x - a.x, dz = b.z - a.z, dist = Math.hypot(dx, dz);
      if (dist >= 2.8 || dist < 1e-4) continue;
      const push = (2.8 - dist) * 0.5, ux = dx / dist, uz = dz / dist, avg = (a.v + b.v) / 2;
      if (!a.remote) { a.x -= ux * push; a.z -= uz * push; a.v = a.v * 0.7 + avg * 0.3; }
      if (!b.remote) { b.x += ux * push; b.z += uz * push; b.v = b.v * 0.7 + avg * 0.3; }
    }
    return;
  }
  for (let i = 0; i < karts.length; i++) for (let j = i + 1; j < karts.length; j++) {
    const a = karts[i], b = karts[j];
    if (a.rescue || b.rescue) continue;
    let ds = b.s - a.s; if (ds > L / 2) ds -= L; if (ds < -L / 2) ds += L;
    const dd = b.d - a.d;
    if (Math.abs(ds) < 3.4 && Math.abs(dd) < 2.1) {
      const push = (2.1 - Math.abs(dd)) * 0.5 * (dd >= 0 ? 1 : -1);
      const sepS = (3.4 - Math.abs(ds)) * 0.25 * (ds >= 0 ? 1 : -1);
      const avg = (a.v + b.v) / 2;
      if (!a.remote) { a.d -= push; a.s -= sepS; a.v = a.v * 0.7 + avg * 0.3; }   // online: a puppet's pose is its owner's truth
      if (!b.remote) { b.d += push; b.s += sepS; b.v = b.v * 0.7 + avg * 0.3; }
    }
  }
}

function rank() {
  if (battle) return [...karts].sort((a, b) => (b.balloons - a.balloons) || ((b.outAt ?? 1e9) - (a.outAt ?? 1e9)));   // balloons, then who lasted longer
  const sorted = [...karts].sort((a, b) => (b.finished - a.finished) || (a.finished ? a.finishTime - b.finishTime : b.progress - a.progress));
  return sorted;
}
// Battle rules: every item hit (items.js hit / strike) and every Lakitu rescue (Kart.updateFree) pops a balloon; a
// kart with none left is out and sits where it stopped (assumption: no bomb kart). The last kart with balloons wins;
// the player's result shows on their banner. pop_player_balloon plays 0x19009051 for a human.
function battleStep() {
  for (const k of karts) {
    if (k.isPlayer && k.balloons < (k.shownBalloons ?? 3)) audio.playSound(1, 0x51);
    k.shownBalloons = k.balloons;
    if (!k.out && k.balloons <= 0) { k.out = true; k.outAt = raceTime; if (k.isPlayer && state === 'race') { banner.textContent = 'LOSER'; } }
  }
  const alive = karts.filter(k => !k.out);
  if (state === 'race' && alive.length <= 1 && karts.length > 1) {
    state = 'finished';
    banner.textContent = alive[0] === player ? 'WINNER!' : alive[0] ? `${alive[0].name.toUpperCase()} WINS` : 'DRAW';
  }
}
const balloonText = k => k.out ? 'OUT' : '●'.repeat(k.balloons) + '○'.repeat(3 - k.balloons);

let last = performance.now();
const mkFrame = () => ({ pos: new THREE.Vector3(), T: new THREE.Vector3(), U: new THREE.Vector3(), R: new THREE.Vector3(), k: 0 });
const flyA = mkFrame(), flyB = mkFrame(), flyLook = new THREE.Vector3();
let flyS = 0, flyInit = false;
function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min(0.05, (now - last) / 1000); last = now;
  const steps = 2, h = dt / steps;

  if (!trackDef || (online && !raceGo)) {   // menu / online lobby open: fly along the road (like ../GoKart attract.gd), no race
    flyS += 20 * dt;
    let target, look;
    if (track.arena) {   // circle the arena
      const b = track.bounds, cx = (b.minX + b.maxX) / 2, cz = (b.minZ + b.maxZ) / 2, r = Math.max(b.maxX - b.minX, b.maxZ - b.minZ) * 0.45;
      const a = flyS / r;
      target = new THREE.Vector3(cx + Math.sin(a) * r, b.maxY + r * 0.35, cz + Math.cos(a) * r);
      look = new THREE.Vector3(cx, (b.minY + b.maxY) / 2, cz);
    } else {
      track.frameAt(flyS, flyA); track.frameAt(flyS + 40, flyB);
      target = flyA.pos.clone().addScaledVector(flyA.R, 10).addScaledVector(flyA.U, 12);
      look = flyB.pos.clone().addScaledVector(flyB.U, 1);
    }
    if (!flyInit) { camera.position.copy(target); flyLook.copy(look); flyInit = true; }
    const a = 1 - Math.exp(-3 * dt);
    camera.position.lerp(target, a); flyLook.lerp(look, a); camera.lookAt(flyLook);
    titleStep(now);   // blink PUSH START while the attract fly-along runs behind the title overlay
    gameStep(now);    // GAME SELECT column / mode row flash boxes
    charStep(now);    // animate the character-select faces when that screen is open
    courseStep(now);  // cup / course / OK flash boxes on the course-select screen
    updateSky(camera);
    renderer.render(scene, camera);
    return;
  }
  if (state === 'countdown') {   // Lakitu's lights end it (countdownLight)
    for (const k of karts) { if (k.remote) puppetStep(k, now); else k.update(dt, { throttle: 0, brake: 0, steer: 0, drift: false }); }
    if (revs && player && !autopilot) revEngine(dt, playerInput());
  } else {
    raceTime += dt;
    for (const k of karts) if (k.remote) puppetStep(k, now);
    for (let s = 0; s < steps; s++) {
      // VS / battle have no CPU karts on the console, so the CPUs that fill online seats just drive (no bands)
      const order = raceMode === 'mario_gp' ? rank() : null;
      if (order) cpuSpeedControl(karts, order, track, cc);
      for (const [id, k] of karts.entries()) {
        if (k.remote) continue;
        if (!k.isPlayer && order) { if (PATH_POINTS[track.def.id]) items.cpuStrategy(k, karts, order, id, PATH_POINTS[track.def.id], h); }
        else if (!k.isPlayer || autopilot) items.aiUse(k, karts, h);
        const inp = k.isPlayer && !autopilot ? playerInput() : k.think(h, karts);
        if (k.isPlayer && state === 'finished') { inp.throttle = 0.4; inp.brake = 0; }
        k.update(h, inp);
        if (k.isPlayer && !k.finished && k.crossings > lapsDone) { if (lapsDone >= 0) lapTimes.push(raceTime - lapStart); lapStart = raceTime; lapsDone = k.crossings; }
        if (!battle && !k.finished && k.crossings >= LAPS) {
          k.finished = true; k.finishTime = raceTime; finishOrder.push(k);
          if (k.isPlayer) { state = 'finished'; banner.textContent = timeTrial ? fmt(raceTime) : `${finishOrder.length}${ordinal(finishOrder.length)} PLACE!`; }   // a time trial has no places
          if (k.isPlayer && raceMode === 'time_trials' && !online && !autopilot) saveRecord(track.def.id, raceTime, lapTimes, playerChar);   // R DATA's course records
        }
      }
      collide();
      items.update(h, karts);
    }
    if (battle) battleStep();
  }
  if (online) { sendClock += dt; if (sendClock >= SEND_INTERVAL) { sendClock = 0; sendPose(); } }
  const win = player.win;
  itemEl.style.display = win ? 'block' : 'none';
  if (win) {
    const s = Math.min(innerWidth / 320, innerHeight / 240);
    itemEl.style.top = `${(win.slide - 48) * s}px`;   // centre y = itemBoxY (-32) + slideItemBoxY, 32 px tall
    itemWin.style.width = `${40 * s}px`; itemWin.style.height = `${32 * s}px`;
    const winSrc = HD.hdSource(ITEM_WINDOW[win.tex]).url;
    if (itemWin.getAttribute('src') !== winSrc) itemWin.setAttribute('src', winSrc);
    itemName.textContent = player.item ? ITEM_LABELS[player.item] : '';
  }
  const order = rank();
  const place = order.indexOf(player) + 1;
  posEl.innerHTML = posStrokeEl.innerHTML = `${place}<small>${ordinal(place)}</small>`;
  lapEl.textContent = battle ? balloonText(player) : `LAP ${Math.max(1, Math.min(LAPS, player.crossings + 1))}/${LAPS}`;
  for (const v of views) {   // the other players' views: place and lap (battle: balloons)
    if (!v.hud) continue;
    const p = order.indexOf(v.kart) + 1;
    v.hud.children[0].innerHTML = `${p}<small>${ordinal(p)}</small>`;
    v.hud.children[1].textContent = battle ? balloonText(v.kart) : `LAP ${Math.max(1, Math.min(LAPS, v.kart.crossings + 1))}/${LAPS}`;
  }
  timeEl.textContent = fmt(raceTime);
  speedEl.innerHTML = `${Math.round(speedKmh(player.v))}<small> km/h</small>`;
  audio.update(player.v / 62, player.drift !== 0, player.offroad, player.boost > 0);
  for (const v of views) updateCamera(dt, v);
  lakitu.update(dt, karts, battle ? 0 : LAPS);
  penguins?.update(dt, views.map(v => v.cam));
  exhaust.update(dt, karts, camera);
  drawMini();
  renderViews();
}
if (trackDef && !online) setup();
requestAnimationFrame(frame);
window.__game = { track, items, lakitu, penguins, get karts() { return karts; }, get player() { return player; }, get autopilot() { return autopilot; }, set autopilot(v) { autopilot = !!v; },
  get state() { return state; }, get raceTime() { return raceTime; }, keys, renderer, scene, camera };
