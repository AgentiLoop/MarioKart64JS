import * as THREE from 'three';
import * as HD from './hd.js';

// MK64 items (include/defines.h enum ITEMS; the index is also the gItemWindowTextures icon). Everything lives in
// track coordinates (s, d), or world x/y/z in the battle arenas.
export const ITEMS = ['none', 'banana', 'banana_bunch', 'green_shell', 'triple_green_shell', 'red_shell', 'triple_red_shell',
  'blue_shell', 'thunder_bolt', 'fake_item_box', 'star', 'boo', 'mushroom', 'double_mushroom', 'triple_mushroom',
  'super_mushroom'];
export const ITEM_ICON = Object.fromEntries(ITEMS.map((n, i) => [n, i]));
export const ITEM_LABELS = Object.fromEntries(ITEMS.map(n => [n, n === 'none' ? '' : n.replace(/_/g, ' ').toUpperCase()]));
const BOX_SPOTS = [0.06, 0.22, 0.40, 0.55, 0.72, 0.90];   // fractions of track length
const BOX_D = [-6, 0, 6];
// Native item box (tools/extract-item-boxes.py, common_data D_0D003090 / itemBoxQuestionMarkModel /
// D_0D002EE8): MK64 units scaled to the kart sprites; it hovers 8.66 units up (update_actor_item_box).
const BOX_SCALE = 0.25, BOX_HOVER = 8.66 * BOX_SCALE, DEG = Math.PI / 180, FPS = 30;
// sounds (include/sounds.h SOUND_ARG_LOAD(bank << 4 | 9, .., .., id)): func_8007ABFC 0x19008406 box hit,
// func_8007B254 0x0100FE1C roulette loop, func_8007B34C state 6 0x0100FE47 item decided
const SND_BOX = [1, 0x06], SND_ROULETTE = [0, 0x1c], SND_DECIDED = [0, 0x47];
// item sounds: 0x19008012 item pulled out / dropped, 0x19008004 shell fired, 0x19019053 held item knocked away,
// 0x19018010 crash (shell / star hit), 0x1900A40B mushroom (trigger_shroom), 0x1900F013 + SOUND_ITEM_THUNDERBOLT
// 0x5101C00C lightning (looped until nobody is shrunk, func_800C8920), SOUND_ITEM_STAR 0x31029008 (until the star ends)
const SND_DROP = [1, 0x12], SND_FIRE = [1, 0x04], SND_KNOCK = [1, 0x53], SND_CRASH = [1, 0x10], SND_SHROOM = [1, 0x0b],
  SND_THUNDER = [1, 0x13], SND_THUNDER_LOOP = [5, 0x0c], SND_STAR = [3, 0x08];
// driver voices, bank 2, characterId * 0x10 + n: 0 throw, 1 boost, 3 spun out (add_spinout_effect), 6 laugh at a victim
const CHAR_ID = { mario: 0, luigi: 1, yoshi: 2, toad: 3, donkeykong: 4, wario: 5, peach: 6, bowser: 7 };
const V_THROW = 0, V_BOOST = 1, V_SPUN = 3, V_LAUGH = 6;
// held on Z (use_banana_item / use_*_shell_item / use_fake_itembox_item HELD_* states) and let go on release
const HOLD = new Set(['banana', 'fake_item_box', 'green_shell', 'red_shell', 'blue_shell']);
// gen_random_item curves (common_data 0x8150.. , 100 entries per rank, read from the US ROM) as [item id, count] pairs
const CURVES = {
  human: [[1, 30, 2, 5, 3, 30, 4, 5, 5, 5, 9, 10, 11, 5, 12, 10], [2, 5, 3, 5, 4, 10, 5, 15, 6, 20, 8, 5, 9, 5, 10, 5, 11, 5, 12, 5, 14, 15, 15, 5], [4, 10, 5, 20, 6, 20, 8, 5, 10, 10, 12, 5, 14, 20, 15, 10], [5, 15, 6, 20, 7, 5, 8, 10, 10, 15, 12, 5, 14, 20, 15, 10], [5, 10, 6, 20, 7, 5, 8, 10, 10, 15, 12, 5, 14, 25, 15, 10], [6, 20, 7, 10, 8, 15, 10, 20, 14, 25, 15, 10], [6, 20, 7, 10, 8, 20, 10, 30, 14, 10, 15, 10], [6, 20, 7, 15, 8, 20, 10, 30, 14, 5, 15, 10]],
  cpu: [[1, 60, 3, 25, 9, 10, 11, 5], [1, 50, 3, 25, 4, 5, 9, 10, 11, 5, 12, 5], [1, 40, 3, 25, 4, 10, 9, 10, 11, 5, 12, 10], [1, 35, 3, 25, 4, 15, 9, 10, 11, 5, 12, 10], [1, 30, 3, 20, 4, 20, 9, 5, 10, 5, 12, 20], [1, 30, 3, 20, 4, 20, 9, 5, 10, 5, 12, 20], [1, 30, 3, 20, 4, 20, 10, 10, 12, 20], [1, 25, 3, 20, 4, 20, 8, 1, 10, 10, 12, 24]],
  vs2: [[1, 25, 2, 10, 3, 30, 4, 5, 5, 5, 9, 10, 11, 5, 12, 10], [2, 5, 4, 5, 5, 5, 6, 15, 7, 5, 8, 15, 10, 15, 14, 15, 15, 20]],
  vs3: [[1, 35, 2, 5, 3, 30, 5, 5, 9, 10, 11, 5, 12, 10], [1, 5, 2, 5, 4, 10, 5, 15, 6, 15, 8, 5, 9, 5, 10, 5, 11, 5, 12, 5, 14, 20, 15, 5], [5, 10, 6, 20, 7, 10, 8, 15, 10, 15, 14, 20, 15, 10]],
  vs4: [[1, 35, 2, 5, 3, 30, 5, 5, 9, 10, 11, 5, 12, 10], [1, 5, 2, 5, 3, 5, 4, 10, 5, 15, 6, 15, 9, 5, 10, 5, 11, 5, 12, 5, 14, 25], [2, 5, 4, 5, 5, 10, 6, 15, 7, 5, 8, 10, 9, 5, 10, 10, 12, 5, 14, 25, 15, 5], [6, 20, 7, 10, 8, 15, 10, 20, 14, 25, 15, 10]],
  battle: [[1, 10, 2, 5, 3, 5, 4, 20, 5, 20, 9, 15, 10, 20, 11, 5]],
};
const pick = curve => { let r = Math.floor(Math.random() * 100), i = 0; while (r >= curve[i + 1]) { r -= curve[i + 1]; i += 2; } return ITEMS[curve[i]]; };
// cpu_decisions_branch_item: only banana, fake item box, thunderbolt, star, boo and mushroom have a strategy (shells redraw)
const CPU_BRANCH = { banana: 'banana', fake_item_box: 'fake', thunder_bolt: 'thunder', star: 'star', boo: 'boo', mushroom: 'mushroom' };
// effect lengths: STAR_EFFECT_DURATION 10 s, BOO_EFFECT_DURATION 7 s; apply_lightning_effect keeps the kart at size 0.7
// for 0x1CC player frames (60 Hz) after its two-turn strike spin (8 degrees a frame); goldenMushroomTimer 0x258.
const STAR_TIME = 10, BOO_TIME = 7, SHRINK_TIME = 0x1CC / 60, SHRINK_SIZE = 0.7, GOLD_TIME = 0x258 / 60;
const SHRINK_SPEED = 0.75;   // assumption: shrunk top speed (MK64 scales its speed force by 0.6 a frame)
// green shell launch speed: max(8, 1.2 x kart speed) MK64 units/frame; top kart speed is 5.885 units/frame
const SHELL_MIN = 8 / 5.885;
const MUSHROOMS = new Set(['mushroom', 'double_mushroom', 'triple_mushroom', 'super_mushroom']);
const TRAIL = { banana_bunch: ['banana', 5], triple_green_shell: ['green_shell', 3], triple_red_shell: ['red_shell', 3] };

// One mesh per display list: vertices [x, y, z, s, t, r, g, b, a] in MK64 units.
function listMesh(list, material, tile) {
  const pos = [], col = [], uv = [], c = new THREE.Color();
  for (const tri of list.triangles) for (const i of tri) {
    const [x, y, z, s, t, r, g, b, a] = list.vertices[i];
    pos.push(x * BOX_SCALE, y * BOX_SCALE, z * BOX_SCALE);
    c.setRGB(r / 255, g / 255, b / 255, THREE.SRGBColorSpace);
    col.push(c.r, c.g, c.b, a / 255);
    if (tile) uv.push(s / 32 / tile[0], t / 32 / tile[1]);   // S10.5 texels, PNG rows top-down
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 4));
  if (tile) g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  return new THREE.Mesh(g, material);
}

async function loadBoxModel() {
  const res = await fetch(`${import.meta.env?.BASE_URL ?? '/'}mk64/item-box/item-boxes.json`);
  const { model, questionMark } = await res.json();
  const map = HD.loadTexture(`item-box/${questionMark.image}`);
  map.colorSpace = THREE.SRGBColorSpace; map.flipY = false;
  // broken box pieces: G_CULL_BACK cleared, every other frame G_RM_AA_ZB_OPA_SURF / G_RM_AA_ZB_XLU_INTER
  const opaque = new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide, toneMapped: false });
  const xlu = new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide, transparent: true, depthWrite: false, toneMapped: false });
  return {
    // G_CC_SHADE, G_RM_ZB_CLD_SURF: rainbow shade colours at alpha 153, back faces culled
    box: listMesh(model.box, new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, depthWrite: false, toneMapped: false })),
    // G_CC_MODULATERGBA, G_RM_AA_ZB_TEX_EDGE, drawn with G_CULL_BACK cleared
    card: listMesh(model.questionMark, new THREE.MeshBasicMaterial({ map, vertexColors: true, alphaTest: 0.5, side: THREE.DoubleSide, toneMapped: false }), [questionMark.width, questionMark.height]),
    // G_CC_SHADE, G_RM_ZB_XLU_SURF: black at alpha 128
    shadow: listMesh(model.shadow, new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, depthWrite: false, toneMapped: false })),
    pieces: model.pieces.map(p => listMesh(p, opaque)), opaque, xlu,
  };
}

// render_actor_item_box state 3 / render_actor_fake_item_box state 2: the box's six one-triangle pieces fly apart
// by these offsets x the frame count (world axes, unrotated), turning with the box; from frame 10 they shrink by
// 0.1 a frame. The first three are opaque on odd frames and see-through on even ones, the last three the reverse.
const PIECE_OFFSETS = [[0, 2, 1], [0.8, 2.3, 0.5], [0.8, 1.2, -0.5], [0, 1.8, -1], [-0.8, 0.6, -0.5], [-0.8, 2, 0.5]];
const BREAK_FRAMES = 20;
function makeShatter(model) {
  const g = new THREE.Group();
  for (const p of model.pieces) { const m = p.clone(); m.renderOrder = 2; g.add(m); }
  return g;
}
function poseShatter(g, t, rot, { opaque, xlu }) {
  const s = t < 10 ? 1 : Math.max(0.001, 1 - (t - 10) * 0.1);
  g.children.forEach((m, i) => {
    const o = PIECE_OFFSETS[i];
    m.position.set(o[0] * t * BOX_SCALE, BOX_HOVER + o[1] * t * BOX_SCALE, o[2] * t * BOX_SCALE);
    m.rotation.copy(rot); m.scale.setScalar(s);
    m.material = ((t & 1) === 1) !== (i >= 3) ? opaque : xlu;
  });
}

// tools/extract-items.py: common_model_banana, two crossed textured triangles drawn unrotated (render_actor_banana),
// G_CC_MODULATERGBA, G_CULL_BACK cleared; its vertices span y -3..4, so it stands 3 units up.
async function loadItemModels() {
  const res = await fetch(`${import.meta.env?.BASE_URL ?? '/'}mk64/items/items.json`);
  const { models, shells, shellQuads } = await res.json();
  const out = { shells: {} };
  for (const [name, m] of Object.entries(models)) {
    const map = HD.loadTexture(`items/${m.image}`);
    map.colorSpace = THREE.SRGBColorSpace; map.flipY = false;
    const mesh = listMesh(m, new THREE.MeshBasicMaterial({ map, vertexColors: true, alphaTest: 0.5, side: THREE.DoubleSide, toneMapped: false }), [m.width, m.height]);
    mesh.position.y = 3 * BOX_SCALE;
    out[name] = mesh;
  }
  // Shells (render_actor_shell): a 6x6 CI8 sprite strip of 8 spin frames per colour (red = the green TLUT with red
  // and green swapped), one geometry per frame on quad D_0D005338 and per frame on the mirrored D_0D005368, texture
  // scale 0.5. Its base sits at pos - boundingBoxSize (4) + 1, i.e. 1 unit above the ground.
  for (const [color, sh] of Object.entries(shells)) {
    const map = HD.loadTexture(`items/${sh.image}`);
    map.colorSpace = THREE.SRGBColorSpace; map.flipY = false;
    const material = new THREE.MeshBasicMaterial({ map, alphaTest: 0.5, side: THREE.DoubleSide, toneMapped: false });
    const geos = [];
    for (const q of [shellQuads.shell, shellQuads.shellMirrored]) for (let f = 0; f < sh.frames; f++) {
      const vertices = q.vertices.map(([x, y, z, s, t, ...c]) => [x, y, z, s * q.textureScale + f * sh.frameWidth * 32, t * q.textureScale, ...c]);
      geos.push(listMesh({ vertices, triangles: q.triangles }, material, [sh.frameWidth * sh.frames, sh.frameHeight]).geometry);
    }
    const mesh = new THREE.Mesh(geos[0], material);
    mesh.position.y = BOX_SCALE;
    out.shells[`${color}_shell`] = { mesh, geos, frames: sh.frames };
  }
  return out;
}

// D_801502C0: actors drawn facing the camera, turned about their up axis only
const _p = new THREE.Vector3(), _u = new THREE.Vector3(), _z = new THREE.Vector3(), _x = new THREE.Vector3();
function faceCamera(renderer, scene, camera) {
  const e = this.matrixWorld.elements;
  _p.set(e[12], e[13], e[14]);
  _u.set(e[4], e[5], e[6]);
  const su = _u.length(), sx = Math.hypot(e[0], e[1], e[2]);
  _u.divideScalar(su);
  _z.setFromMatrixPosition(camera.matrixWorld).sub(_p);
  _z.addScaledVector(_u, -_z.dot(_u));
  if (_z.lengthSq() < 1e-8) return;
  _z.normalize();
  _x.crossVectors(_u, _z);
  this.matrixWorld.makeBasis(_x.multiplyScalar(sx), _u.multiplyScalar(su), _z.multiplyScalar(sx)).setPosition(_p);
}


export class Items {
  constructor(track, scene, audio) {
    this.track = track; this.scene = scene; this.audio = audio;
    this.group = new THREE.Group(); scene.add(this.group);
    this.fr = { pos: new THREE.Vector3(), T: new THREE.Vector3(), U: new THREE.Vector3(), R: new THREE.Vector3(), k: 0 };
    this.boxes = [];
    this.arena = !!track.arena;   // battle: boxes at the course's item box actor spots, everything in world x/y/z
    if (this.arena) {
      const S = 0.1;   // NATIVE_SCALE
      for (const [x, y, z] of track.def.native.itemBoxes) {
        const mesh = new THREE.Group();
        this.group.add(mesh);
        this.boxes.push({ x: x * S, y: y * S, z: z * S, mesh, cd: 0, rot: new THREE.Euler(0, 0, 0, 'YXZ'), parts: null });
      }
    } else for (const u of BOX_SPOTS) for (const d of BOX_D) {
      const mesh = new THREE.Group();
      this.group.add(mesh);
      this.boxes.push({ s: u * track.length, d, mesh, cd: 0, rot: new THREE.Euler(0, 0, 0, 'YXZ'), parts: null });
    }
    this.boxModel = loadBoxModel().then(m => {
      this.boxParts = m;
      for (const b of this.boxes) {
        const box = m.box.clone(), card = m.card.clone(), shadow = m.shadow.clone(), shatter = makeShatter(m);
        box.position.y = card.position.y = BOX_HOVER;
        shadow.position.y = 2 * BOX_SCALE;   // resetDistance + 2
        box.renderOrder = 2;                 // translucent shell over the "?" card
        shatter.visible = false;
        b.mesh.add(shadow, card, box, shatter);
        b.parts = { box, card, shadow, shatter };
      }
      return m;
    });
    // prototypes cloned into every dropped / fired / held item
    this.protos = {}; this.sprites = {}; this.spinning = [];
    this.protosReady = Promise.all([loadItemModels(), this.boxModel]).then(([models, box]) => {
      this.protos.banana = models.banana;
      this.protos.flat_banana = models['flat-banana'];
      this.sprites = models.shells;
      for (const [k, s] of Object.entries(models.shells)) this.protos[k] = s.mesh;
      // fake item box: the box with its "?" upside down (common_model_fake_itembox)
      const fake = new THREE.Group(), b = box.box.clone(), c = box.card.clone();
      b.position.y = c.position.y = BOX_HOVER; c.rotation.z = Math.PI; b.renderOrder = 2;
      fake.add(box.shadow.clone(), c, b);
      fake.children[0].position.y = 2 * BOX_SCALE;
      this.protos.fake_item_box = fake;
    });
    this.hazards = []; this.shots = []; this.trails = new Set(); this.debris = [];
    this.strat = new Map(); this.gp = false; this.clock = 0;
  }

  reset() {
    this.strat.clear();
    for (const h of this.hazards) this.group.remove(h.mesh);
    for (const o of this.shots) this.group.remove(o.mesh);
    for (const k of this.trails) this.clearTrail(k);
    for (const d of this.debris) this.group.remove(d.mesh);
    this.hazards = []; this.shots = []; this.debris = [];
    for (const b of this.boxes) { b.cd = 0; b.state = 2; }
    this.audio.stopSound(...SND_ROULETTE);
    this.audio.stopSound(...SND_THUNDER_LOOP); this.audio.stopSound(...SND_STAR); this.thunder = false;
  }

  makeMesh(kind) {
    const g = new THREE.Group();
    this.group.add(g);
    const add = () => {
      const m = this.protos[kind].clone();
      g.add(m);
      const sprite = this.sprites[kind];
      if (sprite) { m.onBeforeRender = faceCamera; this.spinning.push({ m, g, sprite, rot: 0 }); }
    };
    if (this.protos[kind]) add(); else this.protosReady.then(add);
    return g;
  }
  // render_actor_shell: rotVelocity grows 10 degrees a frame; frame rotVelocity / 24 degrees (0..15) shows
  // sprites 0..7, then 7..1 mirrored (index 15 reads past the table; shown here as sprite 0 mirrored)
  spinShells(dt) {
    this.spinning = this.spinning.filter(p => p.g.parent);
    for (const p of this.spinning) {
      p.rot = (p.rot + 10 * FPS * dt) % 360;
      const i = Math.floor(p.rot / 24), n = p.sprite.frames;
      p.m.geometry = p.sprite.geos[i < 8 ? i : n + (i === 15 ? 0 : 15 - i)];
    }
  }

  // Player item window: update_objects.c func_8007B34C (1P), one step per 30 Hz frame. win.slide is
  // playerHUD.slideItemBoxY (0..64), win.tex the gItemWindowTextures index on screen.
  startRoulette(k) {
    k.win = { state: 2, slide: k.win ? k.win.slide : 0, tex: 0, skip: 50, ready: 0, acc: 0, item: null, init: false };
    this.audio.playSound(...SND_BOX);
    this.audio.playSound(...SND_ROULETTE);
  }
  // func_80072E54: step the icon first..last every `period` frames, `loops` times, then the next state
  cycle(w, first, last, period, loops) {
    if (!w.init) { w.init = true; w.tex = first; w.timer = period; w.loops = loops; return; }
    if (--w.timer > 0) return;
    w.timer = period;
    if (++w.tex <= last) return;
    if (--w.loops > 0) { w.tex = first; return; }
    w.tex = last; w.init = false; w.state++;
  }
  // func_80072D3C: blink between icons a and b every period + 1 frames, `count` times, then the next state
  blink(w, a, b, period, count) {
    if (!w.init) { w.init = true; w.timer = period; w.tex = a; w.phase = 1; w.loops = count; return; }
    if (--w.timer >= 0) return;
    w.timer = period;
    w.tex = --w.phase & 1 ? a : b;
    if (w.phase >= 0) return;
    w.phase = 1;
    if (--w.loops === 0) { w.init = false; w.state++; }
  }
  windowStep(k, karts) {
    const w = k.win;
    switch (w.state) {
      case 2: w.slide = Math.min(64, w.slide + 4); if (w.slide === 64) w.state = 3; break;
      case 3: this.cycle(w, 1, 15, 2, 2); break;
      case 4: this.cycle(w, 1, 6, 8, 1); break;
      case 5: this.cycle(w, 1, 4, 16, 1); break;
      case 6:
        w.item = this.roll(k, karts); w.tex = ITEM_ICON[w.item]; w.ready = 8; w.skip = -1; w.init = false; w.state = 7;
        this.audio.stopSound(...SND_ROULETTE);
        this.audio.playSound(...SND_DECIDED);
        break;
      case 7: this.blink(w, ITEM_ICON[w.item], 0, 8, 10); break;
      case 9: w.tex = 0; w.timer = 20; w.state = 10; break;   // item used: empty window, then slide away
      case 10: if (--w.timer <= 0) w.state = 11; break;
      case 11: w.slide = Math.max(0, w.slide - 4); if (w.slide === 0) k.win = null; return;
    }
    if (w.skip > 0) w.skip--;
    if (w.ready > 0 && --w.ready === 0) k.item = w.item;   // unk_04C 8 frames, then set_type_object
  }
  // the window follows the item: a double / triple mushroom steps down, an empty hand slides it away
  showItem(kart) {
    const w = kart.win;
    if (!w || w.state < 7) return;
    if (kart.item) { w.item = kart.item; w.tex = ITEM_ICON[kart.item]; }
    else if (w.state < 9) { w.init = false; w.state = 9; }
  }

  place(mesh, s, d, h, yaw = 0) {
    if (this.arena) { mesh.position.set(s, h, d); mesh.quaternion.identity(); if (yaw) mesh.rotateY(yaw); return; }   // (x, z, y)
    const f = this.track.frameAt(s, this.fr);
    mesh.position.copy(f.pos).addScaledVector(f.R, d).addScaledVector(f.U, h);
    mesh.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(f.R, f.U, f.T.clone().negate()));
    if (yaw) mesh.rotateY(yaw);
  }
  // a spot `ahead` units in front of the kart (behind when negative), `side` to its right
  spot(kart, ahead, side = 0) {
    if (!this.arena) return { s: (kart.s + ahead + this.track.length) % this.track.length, d: kart.d + side };
    const fx = Math.sin(kart.h), fz = Math.cos(kart.h);
    const x = kart.x + fx * ahead - fz * side, z = kart.z + fz * ahead + fx * side;
    const g = this.track.groundAt(x, z, kart.y) || this.track.groundBelow(x, z, kart.y + 0.5);
    return { x, z, y: g ? g.y : kart.y };
  }
  put(mesh, p, h = 0.05) { if (this.arena) this.place(mesh, p.x, p.z, p.y + h); else this.place(mesh, p.s, p.d, h); }
  touch(k, p, r) {
    if (this.arena) return Math.abs(k.x - p.x) < r && Math.abs(k.z - p.z) < r && Math.abs(k.y - p.y) < 2.5;
    return Math.abs(this.delta(k.s, p.s)) < r && Math.abs(k.d - p.d) < r;
  }

  delta(a, b) { const L = this.track.length; let ds = a - b; if (ds > L / 2) ds -= L; if (ds < -L / 2) ds += L; return ds; }

  // gen_random_item: battle curve; VS curves by the humans' count and rank; GP human / CPU curves by race rank
  roll(kart, karts, cpu = false) {
    if (this.arena) return pick(CURVES.battle[0]);
    const byProgress = list => [...list].sort((a, b) => b.progress - a.progress);
    const humans = karts.filter(k => k.isPlayer || k.remote);
    if (!this.gp && !cpu && humans.length > 1) {
      const n = Math.min(4, humans.length);
      return pick(CURVES['vs' + n][Math.min(n - 1, byProgress(humans).indexOf(kart))]);
    }
    return pick(CURVES[cpu ? 'cpu' : 'human'][Math.min(7, byProgress(karts).indexOf(kart))]);
  }

  // Z: stops the roulette early, fires the next held banana / shell, or uses the item in the window.
  // Returns what was fired (online sends it so the other games replay it with fire()), or null.
  use(kart, karts = []) {
    const w = kart.win;
    // Z after the first 50 frames stops the roulette early (unk_04C / unk_0D6 == 1 -> state 6)
    if (w && w.state >= 2 && w.state <= 5) { if (w.skip === 0) { w.init = false; w.state = 6; } return null; }
    if (kart.trail) {
      if (kart.trail.held) return null;   // let go with release()
      const kind = kart.trail.kind; this.fire(kart, kind, karts); return kind;
    }
    const item = kart.item;
    if (!item) return null;
    // func_8007B34C: triple -> double -> mushroom; the super mushroom stays for goldenMushroomTimer after its first use
    kart.item = { triple_mushroom: 'double_mushroom', double_mushroom: 'mushroom', super_mushroom: 'super_mushroom' }[item] || null;
    if (item === 'super_mushroom' && !(kart.gold > 0)) kart.gold = GOLD_TIME;
    this.showItem(kart);
    // player_use_item: a banana, fake item box or single shell comes out behind the kart and is dragged until Z is let go
    if (kart.isPlayer && HOLD.has(item)) {
      kart.trail = { kind: item, meshes: [this.makeMesh(item)], t: 0, held: true, acc: 0 };
      this.trails.add(kart);
      return null;
    }
    const shot = MUSHROOMS.has(item) ? 'mushroom' : item;
    this.fire(kart, shot, karts);
    return shot;
  }

  // Z let go with a held item (stickY is the N64 rawStickY, up positive). A banana is dropped with a hop
  // (velocity y 1.5) or, stick up (> 30, |x| < 10), thrown ahead at 0.75 x speed + 3.5 + (y - 30) / 20 + 0.5 and
  // that much upward; a fake item box is set down; a green shell goes backwards with the stick down (< -0x2D),
  // otherwise shells swing round from behind to the front (RELEASED_SHELL, 20 degrees a frame, red / blue 10) and fire.
  // Returns what was let go (sent online), or null.
  release(kart, karts = [], stickY = 0) {
    const t = kart.trail;
    if (!t || !t.held || t.swing !== undefined) return null;
    const kind = t.kind, p = t.meshes[0] && t.meshes[0].userData.p;
    if (kind.endsWith('shell')) {
      if (kind === 'green_shell' && stickY < -0x2d) { this.clearTrail(kart); this.launch(kart, kind, karts, true); }
      else { t.swing = 170; t.side = kart.steerVis < 0 ? -1 : 1; }
      return kind;
    }
    this.clearTrail(kart);
    const at = p || this.spot(kart, -3.2);
    if (kind === 'fake_item_box') { this.drop(kart, kind, at); return kind; }
    const u = (kart.top || 60) / 5.885 / FPS;   // our units per MK64 unit a frame
    let vs = 0, vh = 1.5;
    if (stickY > 30) {
      vh = (stickY - 30) / 20 + 0.5;
      const speed = Math.abs(kart.v) / u / FPS;
      vs = (speed < 2 ? 4 : speed * 0.75 + 3.5 + vh) * u;
    }
    this.drop(kart, kind, at, { vs, vh, alt: 0, h: kart.h });
    return kind;
  }

  fire(kart, kind, karts = []) {
    const trail = TRAIL[kind];
    if (trail) {   // banana bunch / triple shells: held around the kart, fired one per press
      this.clearTrail(kart);
      kart.trail = { kind: trail[0], meshes: Array.from({ length: trail[1] }, () => this.makeMesh(trail[0])), t: 0 };
      this.trails.add(kart);
      this.snd(kart, SND_DROP);
      return;
    }
    if (kart.trail && kart.trail.kind === kind) this.popTrail(kart);
    switch (kind) {
      case 'mushroom':
        kart.boost = Math.max(kart.boost, 1.8); kart.v += 6;
        this.snd(kart, SND_SHROOM); this.voice(kart, V_BOOST);
        break;
      case 'banana': case 'fake_item_box': this.drop(kart, kind, this.spot(kart, -4)); break;
      case 'green_shell': case 'red_shell': case 'blue_shell': this.launch(kart, kind, karts); break;
      case 'thunder_bolt':   // use_thunder_item: every other racer is struck and shrinks
        for (const k of karts) if (k !== kart) this.strike(k);
        this.audio.playSound(...SND_THUNDER); this.audio.playSound(...SND_THUNDER_LOOP); this.thunder = true;
        break;
      case 'star': kart.star = STAR_TIME; kart.spin = 0; this.snd(kart, SND_STAR); break;
      case 'boo': kart.boo = BOO_TIME; if (kart.fx) kart.fx.other = 255; this.steal(kart, karts); break;
    }
  }

  // a shell leaves the kart: forwards (or backwards) at max(8, 1.2 x kart speed)
  launch(kart, kind, karts, back = false) {
    const p = this.spot(kart, back ? -3 : 3), mesh = this.makeMesh(kind);
    const speed = Math.max(SHELL_MIN * (kart.top || 60), 1.2 * Math.abs(kart.v));
    this.shots.push({ kind, ...p, h: kart.h + (back ? Math.PI : 0), dir: back ? -1 : 1, speed, owner: kart, safe: 0.6, mesh,
      ttl: kind === 'green_shell' ? 8 : 12, target: kind === 'blue_shell' ? this.leader(karts, kart) : null });
    this.snd(kart, SND_FIRE); this.voice(kart, V_THROW);
  }

  // toss: a released banana's flight (DROPPED_BANANA): vs along the track a frame, vh up, 0.15 less a frame down to -1
  drop(kart, kind, p, toss = null) {
    const mesh = this.makeMesh(kind);
    this.put(mesh, p);
    this.hazards.push({ kind, ...p, mesh, owner: kart, safe: 0.5, ...(toss && { toss, acc: 0 }) });
    this.snd(kart, SND_DROP);
  }
  // one 30 Hz step at a time until it lands (BANANA_ON_GROUND); true when it fell off the arena
  flight(h, dt) {
    for (h.acc += dt; h.toss && h.acc >= 1 / FPS; h.acc -= 1 / FPS) {
      const t = h.toss;
      if (t.vh > -1) t.vh -= 0.15;
      t.alt += t.vh * BOX_SCALE;
      if (this.arena) {
        h.x += Math.sin(t.h) * t.vs; h.z += Math.cos(t.h) * t.vs;
        const g = this.track.groundAt(h.x, h.z, h.y + t.alt) || this.track.groundBelow(h.x, h.z, h.y + t.alt + 0.5);
        if (g) { t.alt += h.y - g.y; h.y = g.y; } else if (h.y + t.alt < this.track.fallY) return true;
      } else h.s = (h.s + t.vs + this.track.length) % this.track.length;
      if (t.alt <= 0 && t.vh < 0) h.toss = null;
    }
    return false;
  }
  // sounds the original only plays for a human player (func_800C9060 / func_800C90F4 by player index)
  snd(kart, s) { if (kart && kart.isPlayer) this.audio.playSound(...s); }
  voice(kart, n) {
    const id = kart && kart.isPlayer && CHAR_ID[kart.mesh.userData.character];
    if (id !== undefined && id !== false) this.audio.playSound(2, id * 0x10 + n);
  }

  leader(karts, owner) {
    let best = null;
    for (const k of karts) if (!k.finished && (!best || (this.arena ? 0 : k.progress - best.progress) > 0)) best = k;
    return best === owner && !this.arena ? null : best;
  }

  // func_8007B040: in Grand Prix the boo hands over a random item 81% of the time; otherwise it takes a random
  // other racer's item
  steal(kart, karts) {
    let got = null;
    if (this.gp) { if (Math.random() * 100 < 81) got = this.roll(kart, karts); }
    else {
      const victims = karts.filter(k => k !== kart && !k.remote && k.item);
      const v = victims[Math.floor(Math.random() * victims.length)];
      if (v) { got = v.item; v.item = null; this.showItem(v); }
    }
    if (!got) return;
    kart.item = got;
    if (kart.isPlayer) { kart.win = { state: 7, slide: 64, tex: ITEM_ICON[got], skip: -1, ready: 0, acc: 0, item: got, init: false }; this.audio.playSound(...SND_DECIDED); }
    else kart.itemTimer = 0.8 + Math.random() * 2.2;
  }

  // trigger_lightning_strike / apply_lightning_effect: spin, lose the held item, shrink
  strike(k) {
    if (k.remote || k.star > 0 || k.boo > 0 || k.out || k.rescue > 0) return;
    k.spin = 1.5; k.v *= 0.6; k.drift = 0; k.boost = 0; k.shrink = SHRINK_TIME; k.zap = 0x78 / FPS;   // unk_0B0 < 0x78: flashing
    this.clearTrail(k);
    if (k.item) { k.item = null; this.showItem(k); }
    if (this.arena) k.balloons = Math.max(0, k.balloons - 1);
  }

  // A banana or shell that was run into stays in the world for 0x3C frames: it pops up at 3 units a frame, falls
  // 0.3 a frame faster each frame (at most 5) with no ground under it. DESTROYED_BANANA swaps in
  // common_model_flat_banana turned zxy by +2 / -8 / +5 degrees a frame (render_actor_banana); DESTROYED_SHELL /
  // GREEN_SHELL_HIT_A_RACER keep the spinning sprite. A fake item box breaks into the item box's pieces for 20
  // frames (DESTROYED_FAKE_ITEM_BOX: update_actor_fake_item_box state 2, rot +6 / -4 / +2 a frame). The blue
  // shell is just gone here.
  wreck(mesh, kind) {
    if (kind === 'fake_item_box' && this.boxParts) {
      mesh.clear();
      const shatter = makeShatter(this.boxParts), rot = new THREE.Euler(0, 0, 0, 'YXZ');
      mesh.add(shatter); poseShatter(shatter, 0, rot, this.boxParts);
      this.debris.push({ mesh, kind, shatter, rot, t: 0, acc: 0 });
      return;
    }
    if (kind !== 'banana' && !kind.endsWith('shell') || kind === 'blue_shell') { this.group.remove(mesh); return; }
    const d = { mesh, kind, base: mesh.position.clone(), up: new THREE.Vector3(0, 1, 0).applyQuaternion(mesh.quaternion),
      y: 0, vy: 3, t: 0x3C, acc: 0, rot: new THREE.Euler(0, 0, 0, 'YXZ') };
    if (kind === 'banana') {
      const flat = () => { if (!mesh.parent) return; mesh.clear(); d.model = this.protos.flat_banana.clone(); mesh.add(d.model); };
      if (this.protos.flat_banana) flat(); else this.protosReady.then(flat);
    }
    this.debris.push(d);
  }
  updateDebris(dt) {
    for (let i = this.debris.length - 1; i >= 0; i--) {
      const d = this.debris[i];
      if (d.shatter) {
        for (d.acc += dt; d.acc >= 1 / FPS && d.t < BREAK_FRAMES; d.acc -= 1 / FPS) {
          d.t++; d.rot.x += 6 * DEG; d.rot.y -= 4 * DEG; d.rot.z += 2 * DEG;
        }
        poseShatter(d.shatter, d.t, d.rot, this.boxParts);
        if (d.t >= BREAK_FRAMES) { this.group.remove(d.mesh); this.debris.splice(i, 1); }
        continue;
      }
      for (d.acc += dt; d.acc >= 1 / FPS && d.t > 0; d.acc -= 1 / FPS) {
        d.vy = Math.max(-5, d.vy - 0.3); d.y += d.vy; d.t--;
        d.rot.x += 2 * DEG; d.rot.y -= 8 * DEG; d.rot.z += 5 * DEG;
      }
      d.mesh.position.copy(d.base).addScaledVector(d.up, d.y * BOX_SCALE);
      if (d.model) d.model.rotation.copy(d.rot);
      if (d.t <= 0) { this.group.remove(d.mesh); this.debris.splice(i, 1); }
    }
  }

  popTrail(kart) {
    const m = kart.trail.meshes.pop();
    if (m) this.group.remove(m);
    if (!kart.trail.meshes.length) { kart.trail = null; this.trails.delete(kart); }
  }
  clearTrail(kart) {
    if (!kart.trail) return;
    for (const m of kart.trail.meshes) this.group.remove(m);
    kart.trail = null; this.trails.delete(kart);
  }

  // Online: only the player who gets hit decides it (../GoKart online_race.gd), so puppets are never hit here;
  // their spin arrives in their own pose packets.
  // kind / owner: what hit it and whose it was. A banana spins its driver out (voice 3); anything else crashes
  // (0x19018010, heard by the human in the crash); a human owner laughs at someone else's misfortune (voice 6).
  hit(kart, kind = null, owner = null) {
    if (kart.remote || kart.spin > 0 || kart.invuln > 0 || kart.star > 0 || kart.boo > 0 || kart.out || kart.rescue > 0) return false;
    kart.spin = 1.1; kart.invuln = 2.2; kart.v *= 0.3; kart.drift = 0; kart.boost = 0;
    if (this.arena) kart.balloons = Math.max(0, kart.balloons - 1);   // battle: every hit pops a balloon
    if (kind === 'banana') this.voice(kart, V_SPUN);
    else if (kart.isPlayer || (owner && owner.isPlayer)) this.audio.playSound(...SND_CRASH);
    if (owner && owner !== kart) this.voice(owner, V_LAUGH);
    return true;
  }

  // Grand Prix CPUs: cpu_use_item_strategy, one step per 30 Hz frame (every other player update). CPUs get no items
  // from boxes; every 601 steps (once past 100 + 20 * playerId path points, at most 3 items a lap) they draw one from
  // common_grand_prix_cpu_item_curve at their rank. cpu_decisions_branch_item only acts on banana, fake item box,
  // thunderbolt, star, boo and mushroom (shells redraw).
  cpuStrategy(kart, karts, order, id, pts, dt) {
    const st = this.strat.get(kart) || { branch: 'wait', timer: 0, uses: 0, lap: kart.crossings, hold: 0, acc: 0 };
    this.strat.set(kart, st);
    if (kart.crossings !== st.lap) { st.lap = kart.crossings; st.uses = 0; }   // numItemUse = 0 at the line
    const L = this.track.length, at = k => k.progress / L * pts;
    for (st.acc += dt; st.acc >= 1 / FPS; st.acc -= 1 / FPS) {
      const rank = order.indexOf(kart), human = order.find(k => k.isPlayer || k.remote);
      switch (st.branch) {
        case 'wait':
          if (100 + 20 * id < at(kart) && st.timer >= 601 && st.uses < 3 && kart.crossings < 3) {
            st.branch = CPU_BRANCH[pick(CURVES.cpu[Math.min(7, rank)])] || 'wait';
          }
          break;
        case 'banana':
          // a CPU behind a first-place human throws it 30 path points ahead of them once within range (DK 40, Peach 4, else 10)
          if (human && kart.crossings > 0 && rank > order.indexOf(human) && order.indexOf(human) === 0) {
            const range = { donkeykong: 40, peach: 4 }[kart.mesh.userData.character] ?? 10, gap = at(human) - at(kart);
            if (gap >= -2 && gap <= range) {
              this.drop(kart, 'banana', { s: (human.s + 30 / pts * L) % L, d: 0 });
              st.uses++; st.timer = 0; st.branch = 'wait';
            }
            break;
          }
          // fall through: held behind the kart, dropped after 10/30/50 steps
        case 'fake':
          this.clearTrail(kart);
          st.drop = st.branch === 'fake' ? 'fake_item_box' : 'banana';
          kart.trail = { kind: st.drop, meshes: [this.makeMesh(st.drop)], t: 0 }; this.trails.add(kart);
          st.uses++; st.timer = 0; st.hold = Math.floor(Math.random() * 3) * 20 + 10; st.branch = 'hold';
          break;
        case 'hold':
          if (!kart.trail) { st.timer = 0; st.branch = 'wait'; break; }   // knocked away (lightning)
          if (st.hold < st.timer) { this.fire(kart, st.drop, karts); st.timer = 0; st.branch = 'wait'; }
          break;
        case 'thunder':   // CPU_STRATEGY_ITEM_THUNDERBOLT, then CPU_STRATEGY_END_THUNDERBOLT for 0xF1 steps
          this.fire(kart, 'thunder_bolt', karts); st.uses++; st.timer = 0; st.branch = 'thunderEnd';
          break;
        case 'thunderEnd':
          if (st.timer >= 0xF1) { st.timer = 0; st.branch = 'wait'; }
          break;
        case 'star': case 'boo':
          this.fire(kart, st.branch, karts); st.uses++; st.timer = 0; st.branch = 'effectEnd';
          break;
        case 'effectEnd':   // CPU_STRATEGY_END_ITEM_STAR / CPU_STRATEGY_WAIT_END_BOO
          if (!(kart.star > 0) && !(kart.boo > 0)) st.branch = 'wait';
          st.timer = 0;
          break;
        case 'mushroom':
          this.fire(kart, 'mushroom', karts); st.uses++; st.timer = 0; st.branch = 'wait';
          break;
      }
      if (st.timer < 10000) st.timer++;
    }
  }

  // CPUs outside Grand Prix (VS / battle seats): boosts, star, boo, lightning and the blue shell go at once; shells
  // when a rival is ahead in range, bananas and fake boxes when one is close behind.
  aiUse(kart, karts, dt) {
    if ((!kart.item && !kart.trail) || kart.spin > 0) return;
    kart.itemTimer -= dt;
    if (kart.itemTimer > 0) return;
    const it = kart.trail ? kart.trail.kind : kart.item;
    const go = () => { this.use(kart, karts); kart.itemTimer = 0.5 + Math.random(); };
    if (!['banana', 'fake_item_box', 'green_shell', 'red_shell'].includes(it)) return go();
    const shell = it.endsWith('shell');
    for (const o of karts) {
      if (o === kart || o.out) continue;
      if (this.arena) {
        const dx = o.x - kart.x, dz = o.z - kart.z, dist = Math.hypot(dx, dz);
        const ahead = Math.cos(Math.atan2(dx, dz) - kart.h);
        if (shell && dist > 6 && dist < 70 && ahead > (it === 'green_shell' ? 0.9 : 0.6)) return go();
        if (!shell && dist < 20 && ahead < -0.5) return go();
        continue;
      }
      const ds = this.delta(o.s, kart.s), dd = Math.abs(o.d - kart.d);
      if (shell && ds > 8 && ds < 90 && (it === 'red_shell' || dd < 3)) return go();
      if (!shell && ds < -4 && ds > -25 && dd < 6) return go();
    }
    if (kart.itemTimer < -8) go();   // don't hoard forever
  }

  update(dt, karts) {
    this.clock += dt;
    for (const b of this.boxes) {
      // update_actor_item_box, one step per 30 Hz frame. State 2: hovering, rot x +1, y -2, z +1 degrees a frame.
      // State 3 (run into): broken for 20 frames, rot +6 / -4 / +2 a frame. Then it comes back from 20 units below
      // the ground (state 0/1), rising 0.45 a frame to 8.66 up, the box alone; the "?" card and shadow only
      // show in state 2. The card turns about Y at twice the box's yaw, the shadow at its yaw.
      b.state ??= 2;
      for (b.acc = (b.acc || 0) + dt; b.acc >= 1 / FPS; b.acc -= 1 / FPS) {
        if (b.state === 2) { b.rot.x += DEG; b.rot.y -= 2 * DEG; b.rot.z += DEG; }
        else if (b.state === 3) {
          if (b.t === BREAK_FRAMES) { b.state = 1; b.lift = -20 - 8.66; }
          else { b.t++; b.rot.x += 6 * DEG; b.rot.y -= 4 * DEG; b.rot.z += 2 * DEG; }
        } else if (b.lift + 0.45 < 0) b.lift += 0.45;
        else { b.lift = 0; b.state = 2; }
      }
      b.cd = b.state === 2 ? 0 : 1;
      if (this.arena) this.place(b.mesh, b.x, b.z, b.y + 0.05); else this.place(b.mesh, b.s, b.d, 0.05);
      if (b.parts) {
        const p = b.parts;
        p.card.visible = p.shadow.visible = b.state === 2;
        p.box.visible = b.state !== 3; p.shatter.visible = b.state === 3;
        p.box.rotation.copy(b.rot);
        p.box.position.y = BOX_HOVER + (b.state === 1 ? b.lift * BOX_SCALE : 0);
        p.card.rotation.y = 2 * b.rot.y;
        p.shadow.rotation.y = b.rot.y;
        if (b.state === 3) poseShatter(p.shatter, b.t, b.rot, this.boxParts);
      }
      // a rising box can be hit again once it is out of the ground (assumption for the 3D collision test)
      if (b.state === 3 || (b.state === 1 && b.lift < -8.66)) continue;
      for (const k of karts) {
        // MK64: any kart touching a box breaks it; only an empty-handed kart gets an item
        if (this.touch(k, b, 3)) {
          if (k.isPlayer) { if (!k.item && (!k.trail || k.trail.held) && (!k.win || k.win.state >= 9)) this.startRoulette(k); }
          else if (!k.item && !k.trail && !k.remote && !this.gp) { k.item = this.roll(k, karts, true); k.itemTimer = 0.8 + Math.random() * 2.2; }
          b.state = 3; b.t = 0; b.cd = 1;
          break;
        }
      }
    }
    for (const k of karts) {
      k.invuln = Math.max(0, k.invuln - dt);
      this.effects(k, karts, dt);
      if (!k.win) continue;
      for (k.win.acc += dt; k.win && k.win.acc >= 1 / FPS; ) { k.win.acc -= 1 / FPS; this.windowStep(k, karts); }
    }
    this.updateTrails(karts, dt);
    this.spinShells(dt);
    if (this.thunder && !karts.some(k => k.shrink > 0)) { this.audio.stopSound(...SND_THUNDER_LOOP); this.thunder = false; }
    this.updateDebris(dt);
    // bananas and fake item boxes sit where dropped until someone runs into them
    for (let i = this.hazards.length - 1; i >= 0; i--) {
      const h = this.hazards[i]; h.safe -= dt;
      if (h.toss && this.flight(h, dt)) { this.group.remove(h.mesh); this.hazards.splice(i, 1); continue; }
      this.put(h.mesh, h, 0.05 + (h.toss ? h.toss.alt : 0));
      const k = karts.find(k => (k !== h.owner || h.safe <= 0) && this.touch(k, h, 2.2));
      if (k && (this.hit(k, h.kind, h.owner) || k.star > 0 || k.remote)) { this.wreck(h.mesh, h.kind); this.hazards.splice(i, 1); }
    }
    for (let i = this.shots.length - 1; i >= 0; i--) {
      const o = this.shots[i]; o.ttl -= dt; o.safe -= dt;
      let gone = o.ttl <= 0 || (this.arena ? this.moveArenaShot(o, karts, dt) : this.moveShot(o, karts, dt)), smash = false;
      for (const k of karts) {
        if (gone || (k === o.owner && o.safe > 0) || k.out) continue;
        if (this.touch(k, o, 2.3)) {
          if (o.kind === 'blue_shell' && k !== o.target) { this.hit(k, o.kind, o.owner); continue; }   // it knocks over anyone in its path
          this.hit(k, o.kind, o.owner); gone = smash = true;
          if (o.kind === 'blue_shell') for (const n of karts) if (n !== k && this.touch(n, o, 6)) this.hit(n, o.kind, o.owner);   // blast
        }
      }
      // shells that meet a dropped banana / fake box take each other out
      for (let j = this.hazards.length - 1; !gone && j >= 0; j--) {
        if (o.kind !== 'blue_shell' && this.near(o, this.hazards[j], 2)) { this.wreck(this.hazards[j].mesh, this.hazards[j].kind); this.hazards.splice(j, 1); gone = smash = true; }
      }
      this.put(o.mesh, o);
      if (o.kind === 'blue_shell') o.mesh.position.y += 2.5;   // it flies over the track
      if (gone) { if (smash) this.wreck(o.mesh, o.kind); else this.group.remove(o.mesh); this.shots.splice(i, 1); }
    }
  }
  near(a, b, r) {
    if (this.arena) return Math.abs(a.x - b.x) < r && Math.abs(a.z - b.z) < r && Math.abs(a.y - b.y) < 2.5;
    return Math.abs(this.delta(a.s, b.s)) < r && Math.abs(a.d - b.d) < r;
  }

  // star / boo / lightning / super mushroom timers and their look: the star flashes and runs at boost speed and
  // knocks over whoever it touches, the boo turns its kart see-through (invisible to the others), lightning shrinks
  effects(k, karts, dt) {
    if (k.star > 0) {
      k.star -= dt; k.boost = Math.max(k.boost, 0.1);
      if (k.star <= 0 && k.isPlayer) this.audio.stopSound(...SND_STAR);   // func_800CAACC
      for (const o of karts) if (o !== k && !(o.star > 0) && this.touch(o, k, 2.5)) this.hit(o, 'star', k);
    }
    if (k.boo > 0) k.boo = Math.max(1e-9, k.boo - dt);   // held just above 0 while it fades back in (fxStep ends it)
    if (k.gold > 0) { k.gold -= dt; if (k.gold <= 0 && k.item === 'super_mushroom') { k.item = null; this.showItem(k); } }
    if (k.shrink > 0) {
      k.shrink -= dt;
      k.v = Math.min(k.v, (k.top || 60) * SHRINK_SPEED);
      // squished: a full-size kart running over a shrunk one
      for (const o of karts) if (o !== k && !(o.shrink > 0) && this.touch(o, k, 1.8)) { if (this.hit(k, 'squish', o)) k.shrink = Math.max(k.shrink, 2); break; }
    }
    const size = k.shrink > 0 ? SHRINK_SIZE : 1;
    const s = k.mesh.scale.x + THREE.MathUtils.clamp(size - k.mesh.scale.x, -6 * dt, 6 * dt);
    k.mesh.scale.setScalar(s);
    const sprite = k.mesh.children.find(c => c.isSprite);
    if (!sprite) return;
    const m = sprite.material, f = k.fx || (k.fx = { acc: 0, n: 0, rgb: [0, 0, 0], own: 255, other: 255 });
    if (k.zap > 0) k.zap -= dt;
    for (f.acc += dt; f.acc >= 1 / FPS; f.acc -= 1 / FPS) this.fxStep(k, f);
    // func_8004B614: G_CC (1 - ENV) * TEXEL0 + PRIM, ENV 0 here -> the texel plus the prim colour
    if (m.userData.prim) m.userData.prim.value.setRGB(f.rgb[0] / 255, f.rgb[1] / 255, f.rgb[2] / 255);
    // own screen sees player->alpha, the other screens gPlayerOtherScreensAlpha (ZMODE_XLU blend)
    const opacity = (k.isPlayer ? f.own : f.other) / 255, see = opacity < 1;
    m.opacity = opacity;
    if (m.transparent !== see) { m.transparent = see; m.alphaTest = see ? 0.05 : 0.5; m.needsUpdate = true; }
    if (k.balloonMeshes) k.balloonMeshes.forEach(b => { b.material.opacity = opacity; b.material.transparent = see; });
  }
  // One 30 Hz step of the kart's colour and alpha (render_player.c func_80022E84 colour effects, effects.c
  // apply_boo_effect). Struck by lightning (unk_0B0 < 0x78): counter +5, wrapping at 0x1E, grey 0x808080 / blue 0x70 /
  // yellow 0x8F8F00. Star, its first 8 whole seconds: counter +5 (+10 from 7 s), wrapping at 40, blue 0x70 / yellow
  // 0x707000 / red 0x700000 / green 0x7000. Each moves 0.8 of the way there a step; otherwise 0.3 back to black.
  // Boo: alpha -2 a step to 0x60 on its own screen and to 0 on the others; after 7 s +4 / +8 until either >= 0xF0.
  fxStep(k, f) {
    if (k.boo > 0) {
      if (k.boo > 1e-6) { f.own = Math.max(0x60, f.own - 2); f.other = Math.max(0, f.other - 2); }
      else { f.own += 4; f.other += 8; if (f.own >= 0xF0 || f.other >= 0xF0) { f.own = f.other = 255; k.boo = 0; } }
    } else f.own = f.other = 255;
    let target = 0, rate = 0.8;
    const sec = Math.floor(STAR_TIME - k.star);
    if (k.zap > 0) {
      f.n += 5; if (f.n >= 0x1E) f.n = 0;
      target = f.n < 0xB ? 0x808080 : f.n < 0x15 ? 0x70 : 0x8F8F00;
    } else if (k.star > 0 && sec <= 8) {
      f.n += sec >= 7 ? 10 : 5; if (f.n >= 40) f.n = 0;
      target = f.n <= 10 ? 0x70 : f.n <= 20 ? 0x707000 : f.n <= 30 ? 0x700000 : 0x7000;
    } else { f.n = 0; rate = 0.3; }
    for (let i = 0; i < 3; i++) f.rgb[i] = Math.trunc(f.rgb[i] - (f.rgb[i] - ((target >> (16 - 8 * i)) & 0xFF)) * rate);
  }

  // held bananas trail behind the kart, triple shells circle it; anyone else touching one is hit and it is gone
  updateTrails(karts, dt) {
    for (const k of this.trails) {
      const t = k.trail; t.t += dt;
      if (t.swing !== undefined) {   // RELEASED_SHELL: round from behind to the front, then MOVING_SHELL
        for (t.acc += dt; t.acc >= 1 / FPS && t.swing > 0; t.acc -= 1 / FPS) t.swing -= t.kind === 'green_shell' ? 20 : 10;
        if (t.swing <= 0) { const kind = t.kind; this.clearTrail(k); this.launch(k, kind, karts); continue; }
      }
      t.meshes.forEach((m, i) => {
        const a = t.t * 6 + i * 2 * Math.PI / 3;
        // held: a shell sits boundingBoxSize + 6 behind, a banana / fake box ~10 MK64 units back; swinging: 8 out
        const p = t.swing !== undefined ? this.spot(k, Math.cos(t.swing * DEG) * 2, Math.sin(t.swing * DEG) * 2 * t.side)
          : t.held ? this.spot(k, t.kind.endsWith('shell') ? -2.75 : -3.2)
          : t.kind.endsWith('shell') ? this.spot(k, Math.cos(a) * 2.6, Math.sin(a) * 2.6)
          : this.spot(k, -3.2 - 2.2 * i);
        m.userData.p = p;
        this.put(m, p);
      });
      for (const o of karts) {
        if (o === k || o.out || !k.trail) continue;
        const i = k.trail.meshes.findIndex(m => m.userData.p && this.touch(o, m.userData.p, 2));
        if (i >= 0 && this.hit(o, k.trail.kind, k)) {
          this.snd(k, SND_KNOCK);
          this.wreck(k.trail.meshes[i], k.trail.kind); k.trail.meshes.splice(i, 1);
          if (!k.trail.meshes.length) { k.trail = null; this.trails.delete(k); break; }
        }
      }
    }
  }

  // Track: green shells run straight along the course, kept on the road; red shells home on the racer
  // ahead; the blue shell chases the leader. Returns true when the shell is spent.
  moveShot(o, karts, dt) {
    const L = this.track.length;
    let target = o.target;
    if (o.kind === 'red_shell') {
      let best = 120; target = null;
      for (const k of karts) {
        if (k === o.owner || k.out) continue;
        const ds = this.delta(k.s, o.s);
        if (ds > -2 && ds < best) { best = ds; target = k; }
      }
    }
    o.s = (o.s + (o.dir || 1) * o.speed * (o.kind === 'blue_shell' ? 1.4 : 1) * dt + L) % L;
    if (target) o.d += THREE.MathUtils.clamp(target.d - o.d, -18 * dt, 18 * dt);
    o.d = THREE.MathUtils.clamp(o.d, -10, 10);
    return false;
  }

  // Battle: shells fly along their heading and follow the floor; green ones bounce off walls, red ones home on the
  // nearest kart.
  moveArenaShot(o, karts, dt) {
    const t = this.track;
    if (o.kind !== 'green_shell') {
      let target = null, best = 90;
      for (const k of karts) {
        if (k === o.owner || k.out || k.rescue > 0) continue;
        const d = Math.hypot(k.x - o.x, k.z - o.z);
        if (d < best) { best = d; target = k; }
      }
      if (target) {
        let diff = Math.atan2(target.x - o.x, target.z - o.z) - o.h;
        diff = Math.atan2(Math.sin(diff), Math.cos(diff));
        o.h += THREE.MathUtils.clamp(diff, -3 * dt, 3 * dt);
      }
    }
    let vx = Math.sin(o.h) * o.speed * dt, vz = Math.cos(o.h) * o.speed * dt;
    if (t.blocked(o.x, o.z, o.x + vx, o.z + vz, o.y)) {
      if (o.kind !== 'green_shell') return true;
      if (t.blocked(o.x, o.z, o.x + vx, o.z, o.y)) vx = -vx;
      if (t.blocked(o.x, o.z, o.x, o.z + vz, o.y)) vz = -vz;
      o.h = Math.atan2(vx, vz);
      if (t.blocked(o.x, o.z, o.x + vx, o.z + vz, o.y)) return true;
    }
    o.x += vx; o.z += vz;
    const g = t.groundAt(o.x, o.z, o.y) || t.groundBelow(o.x, o.z, o.y + 0.5);
    if (g) o.y = g.y; else if (o.y < t.fallY) return true; else o.y -= 20 * dt;
    return false;
  }
}
