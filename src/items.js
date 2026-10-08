import * as THREE from 'three';
import * as HD from './hd.js';

// Original item system: item boxes, Turbo (self boost), Slick (oil puddle dropped behind),
// Seeker (orb that chases the kart ahead). Everything lives in track coordinates (s, d).
export const ITEM_LABELS = { turbo: '⚡ TURBO', slick: '● SLICK', orb: '◎ SEEKER' };
const BOX_SPOTS = [0.06, 0.22, 0.40, 0.55, 0.72, 0.90];   // fractions of track length
const BOX_D = [-6, 0, 6];
const BOX_RESPAWN = 4;
// Native item box (tools/extract-item-boxes.py, common_data D_0D003090 / itemBoxQuestionMarkModel /
// D_0D002EE8): MK64 units scaled to the kart sprites; it hovers 8.66 units up (update_actor_item_box).
const BOX_SCALE = 0.25, BOX_HOVER = 8.66 * BOX_SCALE, DEG = Math.PI / 180, FPS = 30;
// Item window icons (tools/extract-item-window.py, gItemWindowTextures index): banana, red shell, mushroom
export const ITEM_ICON = { slick: 1, orb: 5, turbo: 12 };
// sounds (include/sounds.h SOUND_ARG_LOAD(bank << 4 | 9, .., .., id)): func_8007ABFC 0x19008406 box hit,
// func_8007B254 0x0100FE1C roulette loop, func_8007B34C state 6 0x0100FE47 item decided
const SND_BOX = [1, 0x06], SND_ROULETTE = [0, 0x1c], SND_DECIDED = [0, 0x47];
// common_grand_prix_cpu_item_curve (common_data 0x8470, 100 entries per rank) as counts of
// [banana, green shell, triple green shell, thunderbolt, fake item box, star, boo, mushroom], read from the US ROM
const CPU_ITEM_CURVE = [
  [60, 25, 0, 0, 10, 0, 5, 0], [50, 25, 5, 0, 10, 0, 5, 5], [40, 25, 10, 0, 10, 0, 5, 10], [35, 25, 15, 0, 10, 0, 5, 10],
  [30, 20, 20, 0, 5, 5, 0, 20], [30, 20, 20, 0, 5, 5, 0, 20], [30, 20, 20, 0, 0, 10, 0, 20], [25, 20, 20, 1, 0, 10, 0, 24],
];
const CPU_ITEM_BRANCH = ['banana', null, null, 'none', 'fake', 'star', 'none', 'turbo'];   // null: no strategy, redraw

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
    });
    this.orbGeo = new THREE.SphereGeometry(0.8, 16, 12);
    this.orbMat = new THREE.MeshBasicMaterial({ color: 0x35e0ff });
    this.slickGeo = new THREE.CircleGeometry(2.0, 20); this.slickGeo.rotateX(-Math.PI / 2);
    this.slickMat = new THREE.MeshLambertMaterial({ color: 0x120a1c, emissive: 0x2b0f55 });
    this.hazards = []; this.orbs = [];
    this.strat = new Map(); this.gp = false;
  }

  reset() {
    this.strat.clear();
    for (const h of this.hazards) this.group.remove(h.mesh);
    for (const o of this.orbs) this.group.remove(o.mesh);
    this.hazards = []; this.orbs = [];
    for (const b of this.boxes) { b.cd = 0; b.mesh.visible = true; }
    this.audio.stopSound(...SND_ROULETTE);
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

  place(mesh, s, d, h, yaw = 0) {
    if (this.arena) { mesh.position.set(s, h, d); mesh.quaternion.identity(); if (yaw) mesh.rotateY(yaw); return; }   // (x, z, y)
    const f = this.track.frameAt(s, this.fr);
    mesh.position.copy(f.pos).addScaledVector(f.R, d).addScaledVector(f.U, h);
    mesh.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(f.R, f.U, f.T.clone().negate()));
    if (yaw) mesh.rotateY(yaw);
  }

  delta(a, b) { const L = this.track.length; let ds = a - b; if (ds > L / 2) ds -= L; if (ds < -L / 2) ds += L; return ds; }

  roll(kart, karts) {
    const sorted = [...karts].sort((a, b) => this.arena ? b.balloons - a.balloons : b.progress - a.progress);
    const frac = karts.length > 1 ? sorted.indexOf(kart) / (karts.length - 1) : 0;   // 0 = leader
    const wTurbo = 0.3 + 0.15 * frac, wOrb = 0.15 + 0.4 * frac;
    const r = Math.random();
    return r < wTurbo ? 'turbo' : r < wTurbo + wOrb ? 'orb' : 'slick';
  }

  use(kart) {
    const w = kart.win;
    // Z after the first 50 frames stops the roulette early (unk_04C / unk_0D6 == 1 -> state 6)
    if (w && w.state >= 2 && w.state <= 5) { if (w.skip === 0) { w.init = false; w.state = 6; } return; }
    if (!kart.item) return;
    if (w && w.state >= 7) { w.init = false; w.state = 9; }
    const L = this.track.length;
    if (kart.item === 'turbo') {
      kart.boost = Math.max(kart.boost, 1.8); kart.v += 6; this.audio.sfx('turbo');
    } else if (this.arena) {   // world space: a slick drops behind the kart, an orb flies off its nose along its heading
      const fx = Math.sin(kart.h), fz = Math.cos(kart.h);
      if (kart.item === 'slick') {
        const mesh = new THREE.Mesh(this.slickGeo, this.slickMat);
        this.group.add(mesh);
        const x = kart.x - fx * 5, z = kart.z - fz * 5, g = this.track.groundAt(x, z, kart.y) || this.track.groundBelow(x, z, kart.y + 0.5);
        this.place(mesh, x, z, (g ? g.y : kart.y) + 0.12);
        this.hazards.push({ x, z, y: g ? g.y : kart.y, mesh, ttl: 30 });
        this.audio.sfx('drop');
      } else {
        const mesh = new THREE.Mesh(this.orbGeo, this.orbMat);
        this.group.add(mesh);
        this.orbs.push({ x: kart.x + fx * 4, z: kart.z + fz * 4, y: kart.y, h: kart.h, owner: kart, mesh, ttl: 7 });
        this.audio.sfx('launch');
      }
    } else if (kart.item === 'slick') {
      const mesh = new THREE.Mesh(this.slickGeo, this.slickMat);
      mesh.receiveShadow = true;
      this.group.add(mesh);
      const s = (kart.s - 5 + L) % L;
      this.place(mesh, s, kart.d, 0.12);
      this.hazards.push({ s, d: kart.d, mesh, ttl: 30 });
      this.audio.sfx('drop');
    } else if (kart.item === 'orb') {
      const mesh = new THREE.Mesh(this.orbGeo, this.orbMat);
      this.group.add(mesh);
      this.orbs.push({ s: (kart.s + 4) % L, d: kart.d, owner: kart, mesh, ttl: 7 });
      this.audio.sfx('launch');
    }
    kart.item = null;
  }

  // Online: only the player who gets hit decides it (../GoKart online_race.gd), so puppets are never hit here;
  // their spin arrives in their own pose packets.
  hit(kart) {
    if (kart.remote || kart.spin > 0 || kart.invuln > 0 || kart.out || kart.rescue > 0) return false;
    kart.spin = 1.1; kart.invuln = 2.2; kart.v *= 0.3; kart.drift = 0; kart.boost = 0;
    if (this.arena) kart.balloons = Math.max(0, kart.balloons - 1);   // battle: every hit pops a balloon
    this.audio.sfx('hit');
    return true;
  }

  // Grand Prix CPUs: cpu_use_item_strategy, one step per 30 Hz frame (every other player update). CPUs get no items
  // from boxes; every 601 steps (once past 100 + 20 * playerId path points, at most 3 items a lap) they draw one from
  // common_grand_prix_cpu_item_curve at their rank. cpu_decisions_branch_item only acts on banana, fake item box,
  // thunderbolt, star, boo and mushroom (shells redraw). Ours: banana / fake item box -> Slick, mushroom -> Turbo,
  // star -> Turbo + 10 s invulnerability (STAR_EFFECT_DURATION); thunderbolt and boo have no counterpart: the turn
  // is spent (uses + 1, timer 0) with no effect.
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
            const curve = CPU_ITEM_CURVE[Math.min(7, rank)];
            let r = Math.floor(Math.random() * 100), i = 0;
            while (r >= curve[i]) r -= curve[i++];
            st.branch = CPU_ITEM_BRANCH[i] || 'wait';
          }
          break;
        case 'banana':
          // a CPU behind a first-place human throws it 30 path points ahead of them once within range (DK 40, Peach 4, else 10)
          if (human && kart.crossings > 0 && rank > order.indexOf(human) && order.indexOf(human) === 0) {
            const range = { donkeykong: 40, peach: 4 }[kart.mesh.userData.character] ?? 10, gap = at(human) - at(kart);
            if (gap >= -2 && gap <= range) {
              const mesh = new THREE.Mesh(this.slickGeo, this.slickMat), s = (human.s + 30 / pts * L) % L;
              this.group.add(mesh); this.place(mesh, s, 0, 0.12);
              this.hazards.push({ s, d: 0, mesh, ttl: 30 });
              this.audio.sfx('launch');
              st.uses++; st.timer = 0; st.branch = 'wait';
            }
            break;
          }
          // fall through: held behind the kart, dropped after 10/30/50 steps
        case 'fake':
          st.uses++; st.timer = 0; st.hold = Math.floor(Math.random() * 3) * 20 + 10; st.branch = 'hold';
          break;
        case 'hold':
          if (st.hold < st.timer) { kart.item = 'slick'; this.use(kart); st.timer = 0; st.branch = 'wait'; }
          break;
        case 'star':
          kart.invuln = Math.max(kart.invuln, 10); kart.spin = 0;
          kart.item = 'turbo'; this.use(kart); st.uses++; st.timer = 0; st.branch = 'starEnd';
          break;
        case 'starEnd':
          if (kart.invuln <= 0) st.branch = 'wait';
          st.timer = 0;
          break;
        case 'turbo':
          kart.item = 'turbo'; this.use(kart); st.uses++; st.timer = 0; st.branch = 'wait';
          break;
        case 'none':
          st.uses++; st.timer = 0; st.branch = 'wait';
          break;
      }
      if (st.timer < 10000) st.timer++;
    }
  }

  aiUse(kart, karts, dt) {
    if (!kart.item || kart.spin > 0) return;
    kart.itemTimer -= dt;
    if (kart.itemTimer > 0) return;
    if (kart.item === 'turbo') return this.use(kart);
    for (const o of karts) {
      if (o === kart) continue;
      if (this.arena) {   // orb when an opponent is roughly ahead and in range; slick when one is close behind
        if (o.out) continue;
        const dx = o.x - kart.x, dz = o.z - kart.z, dist = Math.hypot(dx, dz);
        const ahead = Math.cos(Math.atan2(dx, dz) - kart.h);
        if (kart.item === 'orb' && dist > 6 && dist < 70 && ahead > 0.6) return this.use(kart);
        if (kart.item === 'slick' && dist < 20 && ahead < -0.5) return this.use(kart);
        continue;
      }
      const ds = this.delta(o.s, kart.s);
      if (kart.item === 'orb' && ds > 8 && ds < 90) return this.use(kart);
      if (kart.item === 'slick' && ds < -4 && ds > -25 && Math.abs(o.d - kart.d) < 6) return this.use(kart);
    }
    if (kart.itemTimer < -8) this.use(kart);   // don't hoard forever
  }

  update(dt, karts) {
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
        const touching = this.arena ? Math.abs(k.x - b.x) < 3 && Math.abs(k.z - b.z) < 3 && Math.abs(k.y - b.y) < 3
          : Math.abs(this.delta(k.s, b.s)) < 3 && Math.abs(k.d - b.d) < 3;
        if (touching) {
          if (k.isPlayer) { if (!k.item && (!k.win || k.win.state >= 9)) this.startRoulette(k); }
          else if (!k.item && !k.remote && !this.gp) { k.item = this.roll(k, karts); k.itemTimer = 0.8 + Math.random() * 2.2; }
          b.cd = BOX_RESPAWN; b.mesh.visible = false;
          break;
        }
      }
    }
    for (const k of karts) {
      k.invuln = Math.max(0, k.invuln - dt);
      if (!k.win) continue;
      for (k.win.acc += dt; k.win && k.win.acc >= 1 / FPS; ) { k.win.acc -= 1 / FPS; this.windowStep(k, karts); }
    }
    if (this.arena) { this.updateArena(dt, karts); return; }
    // slicks
    for (let i = this.hazards.length - 1; i >= 0; i--) {
      const h = this.hazards[i]; h.ttl -= dt; let gone = h.ttl <= 0;
      for (const k of karts) {
        if (!gone && Math.abs(this.delta(k.s, h.s)) < 2.2 && Math.abs(k.d - h.d) < 2.4 && this.hit(k)) gone = true;
      }
      if (gone) { this.group.remove(h.mesh); this.hazards.splice(i, 1); }
    }
    // seeker orbs
    for (let i = this.orbs.length - 1; i >= 0; i--) {
      const o = this.orbs[i]; o.ttl -= dt; let gone = o.ttl <= 0;
      let target = null, best = 120;
      for (const k of karts) {
        if (k === o.owner) continue;
        const ds = this.delta(k.s, o.s);
        if (ds > -2 && ds < best) { best = ds; target = k; }
      }
      o.s = (o.s + 75 * dt + this.track.length) % this.track.length;
      if (target) o.d += THREE.MathUtils.clamp(target.d - o.d, -18 * dt, 18 * dt);
      o.d = THREE.MathUtils.clamp(o.d, -10, 10);
      for (const k of karts) {
        if (k === o.owner || k.remote || gone) continue;
        if (Math.abs(this.delta(k.s, o.s)) < 2.4 && Math.abs(k.d - o.d) < 2.2) { this.hit(k); gone = true; }
      }
      this.place(o.mesh, o.s, o.d, 1.0);
      if (gone) { this.group.remove(o.mesh); this.orbs.splice(i, 1); }
    }
  }

  // Battle: slicks sit where dropped; orbs fly along their heading, homing on the nearest kart in the
  // battle, follow the floor and die on walls.
  updateArena(dt, karts) {
    const t = this.track;
    for (let i = this.hazards.length - 1; i >= 0; i--) {
      const h = this.hazards[i]; h.ttl -= dt; let gone = h.ttl <= 0;
      for (const k of karts) {
        if (!gone && Math.abs(k.x - h.x) < 2.3 && Math.abs(k.z - h.z) < 2.3 && Math.abs(k.y - h.y) < 2.5 && this.hit(k)) gone = true;
      }
      if (gone) { this.group.remove(h.mesh); this.hazards.splice(i, 1); }
    }
    for (let i = this.orbs.length - 1; i >= 0; i--) {
      const o = this.orbs[i]; o.ttl -= dt; let gone = o.ttl <= 0;
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
      const nx = o.x + Math.sin(o.h) * 75 * dt, nz = o.z + Math.cos(o.h) * 75 * dt;
      if (t.blocked(o.x, o.z, nx, nz, o.y)) gone = true;
      o.x = nx; o.z = nz;
      const g = t.groundAt(o.x, o.z, o.y) || t.groundBelow(o.x, o.z, o.y + 0.5);
      if (g) o.y = g.y; else if (o.y < t.fallY) gone = true; else o.y -= 20 * dt;
      for (const k of karts) {
        if (k === o.owner || k.remote || gone) continue;
        if (Math.abs(k.x - o.x) < 2.4 && Math.abs(k.z - o.z) < 2.4 && Math.abs(k.y - o.y) < 2.5) { this.hit(k); gone = true; }
      }
      this.place(o.mesh, o.x, o.z, o.y + 1.0);
      if (gone) { this.group.remove(o.mesh); this.orbs.splice(i, 1); }
    }
  }
}
