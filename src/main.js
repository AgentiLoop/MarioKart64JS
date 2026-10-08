import * as THREE from 'three';
import { Track, TRACKS, loadNativeCourse, nativeSkyColors, nativeClouds, cloudScreenX, STAR_TWINKLE, NATIVE_SCALE } from './track.js';
import { Kart } from './kart.js';
import { AudioSys } from './audio.js';
import { Items, ITEM_LABELS } from './items.js';
import { createTitleFlag } from './flag.js';
import * as HD from './hd.js';
import { Exhaust } from './smoke.js';
import { Net } from './net.js';

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
  // player takes their character (URL ?char= / localStorage), AI fill the rest in native order.
  // With playerChar=mario this reproduces the old [7,0,1,2,3,4,5,6] grid exactly.
  const rest = characters.filter(c => c !== playerChar);
  const order = [rest[6], playerChar, rest[0], rest[1], rest[2], rest[3], rest[4], rest[5]];
  order.forEach((c, i) => {
    const ci = characters.indexOf(c);
    const [d, back] = slots[i];
    const k = new Kart(track, {
      color: PALETTE[ci], s: track.length - back, d, isPlayer: c === playerChar,
      skill: 0.6 + 0.4 * Math.random(), name: names[ci], character: c,
    });
    k.aiOffset = d * 0.8;
    k.prevS = k.s; k.crossings = 0;
    scene.add(k.mesh); karts.push(k);
    if (c === playerChar) player = k;
  });
  camPos.copy(player.world); camInit = false;
  banner.textContent = '';
  items.reset();
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
const exhaust = new Exhaust(scene);
const itemEl = $('item'), itemWin = $('itemWin'), itemName = $('itemName');
// gItemWindowTextures order (tools/extract-item-window.py); preloaded so the roulette never waits on a fetch
const ITEM_WINDOW = ['none', 'banana', 'banana_bunch', 'green_shell', 'triple_green_shell', 'red_shell', 'triple_red_shell',
  'blue_shell', 'thunder_bolt', 'fake_item_box', 'star', 'boo', 'mushroom', 'double_mushroom', 'triple_mushroom',
  'super_mushroom'].map((n, i) => { const img = new Image(); img.src = `mk64/item-window/${String(i).padStart(2, '0')}-${n}.png`; return img.src; });
const ordinal = n => ['st', 'nd', 'rd'][n - 1] || 'th';
const fmt = t => `${Math.floor(t / 60)}:${(t % 60).toFixed(2).padStart(5, '0')}`;

// ------- title screen & menu flow (no ?track=): title -> game select -> course menu -> character select -> ?track=id&char=c[&players=n] -------
// All screens live inside #screen, a 320x240 frame scaled uniformly to the viewport (N64 4:3 output).
const screenEl = $('screen'), hintEl = $('hint');
const titleEl = $('title'), pushStart = $('pushStart'), gameEl = $('gameSel'), menuEl = $('menu'), charEl = $('char');
let curScreen = null;
function showScreen(el, hint) {
  for (const s of [titleEl, gameEl, menuEl, charEl]) s.style.display = s === el ? 'block' : 'none';
  curScreen = el;
  hintEl.textContent = hint;
}
function fitScreen() {
  const s = Math.min(innerWidth / 320, innerHeight / 240);
  screenEl.style.transform = `translate(-50%, -50%) scale(${s})`;
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
  // Browsers keep audio suspended until a gesture; on the console the voice and title music start with
  // the title screen, so the first press only unlocks audio (playing them here) and the next one advances.
  if (audio.ctx && audio.ctx.state !== 'running') { audio.ctx.resume(); return; }
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
// the cursor is still on the columns (MAIN_MENU_PLAYER_SELECT); once a count is picked the mode row flashes instead
// (MAIN_MENU_MODE_SELECT). The cc sub-select and OK are skipped: picking a mode goes straight to course select.
// 2P-4P GAME are online: `players` rides along to the race URL, which waits for that many players (src/net.js).
const PCOL_X = [21, 92, 163, 234];
const PMODES = [['mario_gp', 'time_trials'], ['mario_gp', 'vs', 'battle'], ['vs', 'battle'], ['vs', 'battle']];
let pcount = 0, pmode = 0, gameMode = 'player';   // 'player' | 'mode'
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
}
function updateGameSelect() {
  [...$('pcols').children].forEach((b, i) => b.setAttribute('aria-pressed', i === pcount && gameMode === 'mode'));
}
function enterGameSelect() {
  gameMode = 'player'; pmode = 0;
  showScreen(gameEl, 'Game select: ←/→ number of players, Enter · ↑/↓ mode, Enter · Esc goes back · 2P-4P race online');
  updateGameSelect();
}
function pickMode() {
  snd('okClicked');
  showScreen(menuEl, 'Course select: ←/→ pick a cup, Enter · ↑/↓ pick a course, Enter · Enter on OK starts · Esc goes back');
  cupMode('cup');
}
function gameStep(now) {
  if (curScreen !== gameEl) return;
  menuTick = Math.floor(now / 1000 * 30);
  [...$('pcols').children].forEach((b, i) => {
    b.querySelector('.box').style.background = boxColour(i === pcount, gameMode !== 'player');
    b.querySelectorAll('.mbox').forEach((m, j) => { m.style.background = boxColour(i === pcount && j === pmode && gameMode === 'mode', false); });
  });
}

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
    b.style.display = mode === 'cup' || on ? 'block' : 'none';
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
  setTimeout(() => { location.search = `?track=${selCourse}&char=${c}${pcount ? `&players=${pcount + 1}` : ''}`; }, 500);
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
  backToTitle();
  audio.welcome();   // menu_items.c:2618 plays SOUND_INTRO_WELCOME as the title screen comes up
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
      if (gameMode === 'player') {
        if (e.code === 'ArrowLeft' && pcount > 0) { pcount--; snd('move'); }
        else if (e.code === 'ArrowRight' && pcount < 3) { pcount++; snd('move'); }
        else if (enter) { gameMode = 'mode'; pmode = 0; snd('select'); updateGameSelect(); }
        else if (back) { backToTitle(); snd('back'); }
      } else {
        if (e.code === 'ArrowUp' && pmode > 0) { pmode--; snd('move'); }
        else if (e.code === 'ArrowDown' && pmode < PMODES[pcount].length - 1) { pmode++; snd('move'); }
        else if (enter) pickMode();
        else if (back) { gameMode = 'player'; snd('back'); updateGameSelect(); }
      }
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
        else if (back) { cupMode('cup'); snd('back'); }
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
// every slick / seeker you drop appears in the other games, and only the player who gets hit decides it (their spin
// arrives in their pose). The lowest id is the host: each game says READY once its mesh is up, the host answers
// GO and all run the 3-2-1 countdown together. VS rules: no CPU karts.
const PLAYERS_WANTED = Math.min(4, Math.max(0, +params.get('players') || 0));
const online = !!trackDef && PLAYERS_WANTED >= 2;
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
// Grid in id order (the same on every peer).
function setupOnline() {
  for (const k of karts) { scene.remove(k.mesh); k.mesh.userData.dispose(); }
  karts = []; finishOrder = []; raceTime = 0; state = 'countdown'; countdown = 3.4; raceGo = false;
  const slots = [[-6, 14], [6, 14], [-6, 24], [6, 24]];
  const chars = resolveChars(net.players);
  net.players.forEach((p, i) => {
    const c = chars.get(p.id), ci = characters.indexOf(c);
    const [d, back] = slots[i];
    const mine = p.id === net.myId;
    const k = new Kart(track, { color: PALETTE[ci], s: track.length - back, d, isPlayer: mine, name: names[ci], character: c });
    k.netId = p.id; k.remote = !mine; k.poses = [];
    k.prevS = k.s; k.crossings = 0;
    scene.add(k.mesh); karts.push(k);
    if (mine) player = k;
  });
  camPos.copy(player.world); camInit = false;
  banner.textContent = '';
  items.reset();
}
function sendPose() {
  const k = player;
  net.send({ t: 'p', s: k.s, d: k.d, psi: k.psi, v: k.v, y: k.world.y, air: k.air ? 1 : 0,
    dr: k.drift, b: k.boost, sp: k.spin, sv: k.steerVis, c: k.crossings, f: k.finished ? k.finishTime : -1 }, false);
}
// Replay the puppet's poses PUPPET_DELAY behind their arrival; extrapolate along the road past the newest.
function puppetStep(k, now) {
  const P = k.poses;
  if (!P.length) return;
  const L = track.length, t = now - PUPPET_DELAY * 1000;
  while (P.length > 2 && P[1].rx <= t) P.shift();
  const a = P[0], b = P[1];
  let s = a.s, d = a.d, psi = a.psi, v = a.v, y = a.y, src = a;
  if (b && b.rx > a.rx) {
    const u = Math.min(1, Math.max(0, (t - a.rx) / (b.rx - a.rx)));
    let ds = b.s - a.s; if (ds > L / 2) ds -= L; if (ds < -L / 2) ds += L;
    s = a.s + ds * u; d += (b.d - a.d) * u; psi += (b.psi - a.psi) * u; v += (b.v - a.v) * u; y += (b.y - a.y) * u;
    if (u >= 1) src = b;
  } else if (!b) {
    s += v * Math.min(0.3, Math.max(0, (t - a.rx) / 1000));   // dead reckoning along the road
  }
  k.s = ((s % L) + L) % L; k.d = d; k.psi = k.phi = psi; k.v = v;
  k.drift = src.dr; k.boost = src.b; k.spin = src.sp; k.spinAngle = src.sp > 0 ? (k.spinAngle + 11 / 60) : 0; k.steerVis = src.sv;
  k.crossings = src.c;
  if (src.f >= 0 && !k.finished) { k.finished = true; k.finishTime = src.f; finishOrder.push(k); }
  k.syncMesh(0);
  if (src.air) { k.world.y = y; k.mesh.position.y = y; }
}
function useItem() {
  const item = player.item;
  items.use(player);
  if (online && item && !player.item) net.send({ t: 'item', item, s: player.s, d: player.d });
}
function onlineData(from, m) {
  const k = peerKart(from);
  switch (m.t) {
    case 'p': if (k) { m.rx = performance.now(); k.poses.push(m); if (k.poses.length > 30) k.poses.shift(); } break;
    case 'item': if (k) { k.s = m.s; k.d = m.d; k.item = m.item; items.use(k); } break;
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
function raceCpuInstead() {   // Enter on the lobby: give up waiting and race the CPU alone
  net.leave();
  setup();
  startRace();
}
if (online) {
  lobbyEl.style.display = 'block';
  lobbyCount.textContent = '';
  net.addEventListener('room', e => lobbyShow(e.detail.players, e.detail.countdown, e.detail.max));
  net.addEventListener('start', e => {
    const m = e.detail;
    if (m.course !== trackDef.id) {   // the room races the host's course: reload onto it, then rejoin
      location.search = `?track=${m.course}&char=${playerChar}&players=${PLAYERS_WANTED}&room=${m.code}&you=${m.you}`;
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
    if (karts.length <= 1 && state !== 'finished') { banner.textContent = 'OPPONENT LEFT'; setTimeout(() => { if (banner.textContent === 'OPPONENT LEFT') banner.textContent = ''; }, 3000); }
    hostCheckGo();
  });
  net.addEventListener('error', e => { lobbyMsg.textContent = e.detail.message; lobbyCount.textContent = ''; });
  if (params.get('room')) net.rejoin(params.get('room'), +params.get('you'));
  else net.quickMatch({ name: NAMES[playerChar] || playerChar, course: trackDef.id, char: playerChar, players: PLAYERS_WANTED });
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
  if (e.code === 'KeyR' && !online) setup();
  if (e.code === 'KeyM') location.search = '';
  if (e.code === 'KeyN') audio.toggleMusic();
  if (e.code === 'KeyG') { HD.cyclePreset(); showRes(); }
  if ((e.code === 'ShiftLeft' || e.code === 'ShiftRight' || e.code === 'KeyE') && state !== 'countdown' && player) useItem();
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
  if (item && !padItemHeld && state !== 'countdown' && player) useItem();
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
  if (!p) return kb;
  return {
    throttle: Math.max(kb.throttle, p.throttle),
    brake: Math.max(kb.brake, p.brake),
    steer: kb.steer || p.steer,
    drift: kb.drift || p.drift,
  };
}

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

// Presentation: render HD.renderLines() lines (1x = N64 240p, upscaled with hard pixels). G cycles presets.
function resize() {
  const h = HD.renderLines();
  const w = Math.round(h * innerWidth / innerHeight);
  renderer.setSize(w, Math.round(h), false);
  canvas.style.imageRendering = HD.smooth() ? 'auto' : 'pixelated';
  camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix();
}
addEventListener('resize', resize); resize();
HD.onChange(resize);
let resTimer = 0;
function showRes() {
  const el = $('res');
  el.textContent = `${HD.presetLabel()} · textures ${HD.tier()}×`;
  el.style.display = 'block';
  clearTimeout(resTimer); resTimer = setTimeout(() => { el.style.display = 'none'; }, 1500);
}

function collide() {
  const L = track.length;
  for (let i = 0; i < karts.length; i++) for (let j = i + 1; j < karts.length; j++) {
    const a = karts[i], b = karts[j];
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
  const sorted = [...karts].sort((a, b) => (b.finished - a.finished) || (a.finished ? a.finishTime - b.finishTime : b.progress - a.progress));
  return sorted;
}

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
    track.frameAt(flyS, flyA); track.frameAt(flyS + 40, flyB);
    const target = flyA.pos.clone().addScaledVector(flyA.R, 10).addScaledVector(flyA.U, 12);
    const look = flyB.pos.clone().addScaledVector(flyB.U, 1);
    if (!flyInit) { camera.position.copy(target); flyLook.copy(look); flyInit = true; }
    const a = 1 - Math.exp(-3 * dt);
    camera.position.lerp(target, a); flyLook.lerp(look, a); camera.lookAt(flyLook);
    titleStep(now);   // blink PUSH START while the attract fly-along runs behind the title overlay
    gameStep(now);    // GAME SELECT column / mode row flash boxes
    charStep(now);    // animate the character-select faces when that screen is open
    courseStep(now);  // cup / course / OK flash boxes on the course-select screen
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
    for (const k of karts) { if (k.remote) puppetStep(k, now); else k.update(dt, { throttle: 0, brake: 0, steer: 0, drift: false }); }
  } else {
    raceTime += dt;
    for (const k of karts) if (k.remote) puppetStep(k, now);
    for (let s = 0; s < steps; s++) {
      for (const k of karts) {
        if (k.remote) continue;
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
  if (online) { sendClock += dt; if (sendClock >= SEND_INTERVAL) { sendClock = 0; sendPose(); } }
  const win = player.win;
  itemEl.style.display = win ? 'block' : 'none';
  if (win) {
    const s = Math.min(innerWidth / 320, innerHeight / 240);
    itemEl.style.top = `${(win.slide - 48) * s}px`;   // centre y = itemBoxY (-32) + slideItemBoxY, 32 px tall
    itemWin.style.width = `${40 * s}px`; itemWin.style.height = `${32 * s}px`;
    if (itemWin.getAttribute('src') !== ITEM_WINDOW[win.tex]) itemWin.setAttribute('src', ITEM_WINDOW[win.tex]);
    itemName.textContent = player.item ? ITEM_LABELS[player.item] : '';
  }
  const order = rank();
  const place = order.indexOf(player) + 1;
  posEl.innerHTML = posStrokeEl.innerHTML = `${place}<small>${ordinal(place)}</small>`;
  lapEl.textContent = `LAP ${Math.min(LAPS, player.crossings + 1)}/${LAPS}`;
  timeEl.textContent = fmt(raceTime);
  speedEl.innerHTML = `${Math.round(Math.abs(player.v) * 3.6)}<small> km/h</small>`;
  audio.update(player.v / 62, player.drift !== 0, player.offroad, player.boost > 0);
  updateCamera(dt);
  exhaust.update(dt, karts, camera);
  drawMini();
  updateSky();
  renderer.render(scene, camera);
}
let lastTick = 4;
if (trackDef && !online) setup();
requestAnimationFrame(frame);
window.__game = { track, items, get karts() { return karts; }, get player() { return player; }, keys, renderer, scene, camera };
