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
const BOX_RESPAWN = 4;
// Native item box (tools/extract-item-boxes.py, common_data D_0D003090 / itemBoxQuestionMarkModel /
// D_0D002EE8): MK64 units scaled to the kart sprites; it hovers 8.66 units up (update_actor_item_box).
const BOX_SCALE = 0.25, BOX_HOVER = 8.66 * BOX_SCALE, DEG = Math.PI / 180, FPS = 30;
// sounds (include/sounds.h SOUND_ARG_LOAD(bank << 4 | 9, .., .., id)): func_8007ABFC 0x19008406 box hit,
// func_8007B254 0x0100FE1C roulette loop, func_8007B34C state 6 0x0100FE47 item decided
const SND_BOX = [1, 0x06], SND_ROULETTE = [0, 0x1c], SND_DECIDED = [0, 0x47];
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
const SHELL_COLOR = { green_shell: 0x2fbf3a, red_shell: 0xe8312b, blue_shell: 0x3a6cf0 };

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
  return {
    // G_CC_SHADE, G_RM_ZB_CLD_SURF: rainbow shade colours at alpha 153, back faces culled
    box: listMesh(model.box, new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, depthWrite: false, toneMapped: false })),
    // G_CC_MODULATERGBA, G_RM_AA_ZB_TEX_EDGE, drawn with G_CULL_BACK cleared
    card: listMesh(model.questionMark, new THREE.MeshBasicMaterial({ map, vertexColors: true, alphaTest: 0.5, side: THREE.DoubleSide, toneMapped: false }), [questionMark.width, questionMark.height]),
    // G_CC_SHADE, G_RM_ZB_XLU_SURF: black at alpha 128
    shadow: listMesh(model.shadow, new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, depthWrite: false, toneMapped: false })),
  };
}

// tools/extract-items.py: common_model_banana, two crossed textured triangles drawn unrotated (render_actor_banana),
// G_CC_MODULATERGBA, G_CULL_BACK cleared; its vertices span y -3..4, so it stands 3 units up.
async function loadItemModels() {
  const res = await fetch(`${import.meta.env?.BASE_URL ?? '/'}mk64/items/items.json`);
  const { models } = await res.json();
  const out = {};
  for (const [name, m] of Object.entries(models)) {
    const map = HD.loadTexture(`items/${m.image}`);
    map.colorSpace = THREE.SRGBColorSpace; map.flipY = false;
    const mesh = listMesh(m, new THREE.MeshBasicMaterial({ map, vertexColors: true, alphaTest: 0.5, side: THREE.DoubleSide, toneMapped: false }), [m.width, m.height]);
    mesh.position.y = 3 * BOX_SCALE;
    out[name] = mesh;
  }
  return out;
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
      for (const b of this.boxes) {
        const box = m.box.clone(), card = m.card.clone(), shadow = m.shadow.clone();
        box.position.y = card.position.y = BOX_HOVER;
        shadow.position.y = 2 * BOX_SCALE;   // resetDistance + 2
        box.renderOrder = 2;                 // translucent shell over the "?" card
        b.mesh.add(shadow, card, box);
        b.parts = { box, card, shadow };
      }
      return m;
    });
    // prototypes cloned into every dropped / fired / held item
    const shell = (color) => {
      const m = new THREE.Mesh(new THREE.SphereGeometry(0.9, 16, 10), new THREE.MeshLambertMaterial({ color, emissive: color, emissiveIntensity: 0.35 }));
      m.scale.y = 0.7; m.position.y = 0.65;
      return m;
    };
    this.protos = Object.fromEntries(Object.entries(SHELL_COLOR).map(([k, c]) => [k, shell(c)]));
    this.protosReady = Promise.all([loadItemModels(), this.boxModel]).then(([models, box]) => {
      this.protos.banana = models.banana;
      // fake item box: the box with its "?" upside down (common_model_fake_itembox)
      const fake = new THREE.Group(), b = box.box.clone(), c = box.card.clone();
      b.position.y = c.position.y = BOX_HOVER; c.rotation.z = Math.PI; b.renderOrder = 2;
      fake.add(box.shadow.clone(), c, b);
      fake.children[0].position.y = 2 * BOX_SCALE;
      this.protos.fake_item_box = fake;
    });
    this.hazards = []; this.shots = []; this.trails = new Set();
    this.strat = new Map(); this.gp = false; this.clock = 0;
  }

  reset() {
    this.strat.clear();
    for (const h of this.hazards) this.group.remove(h.mesh);
    for (const o of this.shots) this.group.remove(o.mesh);
    for (const k of this.trails) this.clearTrail(k);
    this.hazards = []; this.shots = [];
    for (const b of this.boxes) { b.cd = 0; b.mesh.visible = true; }
    this.audio.stopSound(...SND_ROULETTE);
  }

  makeMesh(kind) {
    const g = new THREE.Group();
    this.group.add(g);
    if (this.protos[kind]) g.add(this.protos[kind].clone());
    else this.protosReady.then(() => g.add(this.protos[kind].clone()));
    return g;
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
    if (kart.trail) { const kind = kart.trail.kind; this.fire(kart, kind, karts); return kind; }
    const item = kart.item;
    if (!item) return null;
    // func_8007B34C: triple -> double -> mushroom; the super mushroom stays for goldenMushroomTimer after its first use
    kart.item = { triple_mushroom: 'double_mushroom', double_mushroom: 'mushroom', super_mushroom: 'super_mushroom' }[item] || null;
    if (item === 'super_mushroom' && !(kart.gold > 0)) kart.gold = GOLD_TIME;
    this.showItem(kart);
    const shot = MUSHROOMS.has(item) ? 'mushroom' : item;
    this.fire(kart, shot, karts);
    return shot;
  }

  fire(kart, kind, karts = []) {
    const trail = TRAIL[kind];
    if (trail) {   // banana bunch / triple shells: held around the kart, fired one per press
      this.clearTrail(kart);
      kart.trail = { kind: trail[0], meshes: Array.from({ length: trail[1] }, () => this.makeMesh(trail[0])), t: 0 };
      this.trails.add(kart);
      this.audio.sfx('drop');
      return;
    }
    if (kart.trail && kart.trail.kind === kind) this.popTrail(kart);
    switch (kind) {
      case 'mushroom': kart.boost = Math.max(kart.boost, 1.8); kart.v += 6; this.audio.sfx('turbo'); break;
      case 'banana': case 'fake_item_box': this.drop(kart, kind, this.spot(kart, -4)); break;
      case 'green_shell': case 'red_shell': case 'blue_shell': {
        const p = this.spot(kart, 3), mesh = this.makeMesh(kind);
        const speed = Math.max(SHELL_MIN * (kart.top || 60), 1.2 * Math.abs(kart.v));
        this.shots.push({ kind, ...p, h: kart.h, speed, owner: kart, safe: 0.6, mesh, ttl: kind === 'green_shell' ? 8 : 12,
          target: kind === 'blue_shell' ? this.leader(karts, kart) : null });
        this.audio.sfx('launch');
        break;
      }
      case 'thunder_bolt':   // use_thunder_item: every other racer is struck and shrinks
        for (const k of karts) if (k !== kart) this.strike(k);
        this.audio.sfx('hit');
        break;
      case 'star': kart.star = STAR_TIME; kart.spin = 0; this.audio.sfx('turbo'); break;
      case 'boo': kart.boo = BOO_TIME; this.steal(kart, karts); break;
    }
  }

  drop(kart, kind, p) {
    const mesh = this.makeMesh(kind);
    this.put(mesh, p);
    this.hazards.push({ kind, ...p, mesh, owner: kart, safe: 0.5 });
    this.audio.sfx('drop');
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
    k.spin = 1.5; k.v *= 0.6; k.drift = 0; k.boost = 0; k.shrink = SHRINK_TIME;
    this.clearTrail(k);
    if (k.item) { k.item = null; this.showItem(k); }
    if (this.arena) k.balloons = Math.max(0, k.balloons - 1);
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
  hit(kart) {
    if (kart.remote || kart.spin > 0 || kart.invuln > 0 || kart.star > 0 || kart.boo > 0 || kart.out || kart.rescue > 0) return false;
    kart.spin = 1.1; kart.invuln = 2.2; kart.v *= 0.3; kart.drift = 0; kart.boost = 0;
    if (this.arena) kart.balloons = Math.max(0, kart.balloons - 1);   // battle: every hit pops a balloon
    this.audio.sfx('hit');
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
      if (b.cd > 0) { b.cd -= dt; b.mesh.visible = b.cd <= 0; }
      // update_actor_item_box state 2: rot x +1, y -2, z +1 degrees per frame; the box turns on all
      // three axes, the "?" card only about Y at twice the box's yaw, the shadow at its yaw
      b.rot.x += DEG * FPS * dt; b.rot.y -= 2 * DEG * FPS * dt; b.rot.z += DEG * FPS * dt;
      if (this.arena) this.place(b.mesh, b.x, b.z, b.y + 0.05); else this.place(b.mesh, b.s, b.d, 0.05);
      if (b.parts) {
        b.parts.box.rotation.copy(b.rot);
        b.parts.card.rotation.y = 2 * b.rot.y;
        b.parts.shadow.rotation.y = b.rot.y;
      }
      if (b.cd > 0) continue;
      for (const k of karts) {
        // MK64: any kart touching a box breaks it; only an empty-handed kart gets an item
        if (this.touch(k, b, 3)) {
          if (k.isPlayer) { if (!k.item && !k.trail && (!k.win || k.win.state >= 9)) this.startRoulette(k); }
          else if (!k.item && !k.trail && !k.remote && !this.gp) { k.item = this.roll(k, karts, true); k.itemTimer = 0.8 + Math.random() * 2.2; }
          b.cd = BOX_RESPAWN; b.mesh.visible = false;
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
    // bananas and fake item boxes sit where dropped until someone runs into them
    for (let i = this.hazards.length - 1; i >= 0; i--) {
      const h = this.hazards[i]; h.safe -= dt;
      this.put(h.mesh, h);
      const k = karts.find(k => (k !== h.owner || h.safe <= 0) && this.touch(k, h, 2.2));
      if (k && (this.hit(k) || k.star > 0 || k.remote)) { this.group.remove(h.mesh); this.hazards.splice(i, 1); }
    }
    for (let i = this.shots.length - 1; i >= 0; i--) {
      const o = this.shots[i]; o.ttl -= dt; o.safe -= dt;
      let gone = o.ttl <= 0 || (this.arena ? this.moveArenaShot(o, karts, dt) : this.moveShot(o, karts, dt));
      for (const k of karts) {
        if (gone || (k === o.owner && o.safe > 0) || k.out) continue;
        if (this.touch(k, o, 2.3)) {
          if (o.kind === 'blue_shell' && k !== o.target) { this.hit(k); continue; }   // it knocks over anyone in its path
          this.hit(k); gone = true;
          if (o.kind === 'blue_shell') for (const n of karts) if (n !== k && this.touch(n, o, 6)) this.hit(n);   // blast
        }
      }
      // shells that meet a dropped banana / fake box take each other out
      for (let j = this.hazards.length - 1; !gone && j >= 0; j--) {
        if (o.kind !== 'blue_shell' && this.near(o, this.hazards[j], 2)) { this.group.remove(this.hazards[j].mesh); this.hazards.splice(j, 1); gone = true; }
      }
      this.put(o.mesh, o);
      if (o.kind === 'blue_shell') o.mesh.position.y += 2.5;   // it flies over the track
      if (gone) { this.group.remove(o.mesh); this.shots.splice(i, 1); }
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
      for (const o of karts) if (o !== k && !(o.star > 0) && this.touch(o, k, 2.5)) this.hit(o);
    }
    if (k.boo > 0) k.boo -= dt;
    if (k.gold > 0) { k.gold -= dt; if (k.gold <= 0 && k.item === 'super_mushroom') { k.item = null; this.showItem(k); } }
    if (k.shrink > 0) {
      k.shrink -= dt;
      k.v = Math.min(k.v, (k.top || 60) * SHRINK_SPEED);
      // squished: a full-size kart running over a shrunk one
      for (const o of karts) if (o !== k && !(o.shrink > 0) && this.touch(o, k, 1.8)) { if (this.hit(k)) k.shrink = Math.max(k.shrink, 2); break; }
    }
    const size = k.shrink > 0 ? SHRINK_SIZE : 1;
    const s = k.mesh.scale.x + THREE.MathUtils.clamp(size - k.mesh.scale.x, -6 * dt, 6 * dt);
    k.mesh.scale.setScalar(s);
    const sprite = k.mesh.children.find(c => c.isSprite);
    if (!sprite) return;
    const m = sprite.material;
    if (k.star > 0) m.color.setHSL((this.clock * 4) % 1, 1, 0.65); else m.color.set(0xffffff);
    const boo = k.boo > 0, opacity = boo ? (k.isPlayer ? 0.4 : 0) : 1;
    if (m.opacity !== opacity) { m.opacity = opacity; m.transparent = boo; m.alphaTest = boo ? 0.05 : 0.5; m.needsUpdate = true; }
    if (k.balloonMeshes) k.balloonMeshes.forEach(b => { b.material.opacity = opacity; b.material.transparent = boo; });
  }

  // held bananas trail behind the kart, triple shells circle it; anyone else touching one is hit and it is gone
  updateTrails(karts, dt) {
    for (const k of this.trails) {
      const t = k.trail; t.t += dt;
      t.meshes.forEach((m, i) => {
        const a = t.t * 6 + i * 2 * Math.PI / 3;
        const p = t.kind.endsWith('shell') ? this.spot(k, Math.cos(a) * 2.6, Math.sin(a) * 2.6)
          : this.spot(k, -3.2 - 2.2 * i);
        m.userData.p = p;
        this.put(m, p);
      });
      for (const o of karts) {
        if (o === k || o.out || !k.trail) continue;
        const i = k.trail.meshes.findIndex(m => m.userData.p && this.touch(o, m.userData.p, 2));
        if (i >= 0 && this.hit(o)) {
          this.group.remove(k.trail.meshes[i]); k.trail.meshes.splice(i, 1);
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
    o.s = (o.s + o.speed * (o.kind === 'blue_shell' ? 1.4 : 1) * dt + L) % L;
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
