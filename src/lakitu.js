// Lakitu, the referee on his cloud (n64decomp/mk64 src/update_objects.c update_object_lakitu, placed by
// func_8007A66C / func_8007A778, drawn by render_lakitu). One referee per screen player, seen only in that view:
//   countdown  update_object_lakitu_countdown: flies in on spline D_800E67B8 and holds out the signal, red, red,
//              blue -> GO (the race start waits for his blue light)
//   secondlap / finallap  update_object_lakitu_second_lap / _final_lap: the lap signs (spline D_800E694C)
//   flag       update_object_lakitu_red_flag: waves the checkered flag (looping spline D_800E6834) once his
//              player has finished, while the kart drives on
//   fishing    update_object_lakitu_fishing: comes down on the kart that fell off the course and hooks it
// Every kart that falls off (kart.js sets kart.fell) is fished out by the effects.c func_80090970 sequence: held,
// lifted, faded out, put back over the last road point it drove on (gCopyNearestPathPointByPlayerId) and lowered
// onto it. CPU karts are held at once, without a visible Lakitu (func_8002C4F8).
// Sprites: tools/extract-lakitu.py atlases (HD tiers from MK64 Reloaded via tools/build-hd-textures.py).
// Assumptions: the object logic ticks at 60 Hz, which puts the countdown's lights 56 ticks (0.93 s) apart like the
// console; MK64 lengths around the kart use the kart scale of smoke.js (18-unit kart quad x 0.75 = our 4.5-unit
// sprite), so Lakitu keeps his size and height relative to the kart. Our chase camera sits closer behind the kart than
// the console's, so the camera-relative side / depth offsets use KXZ instead (the waving flag's z = 50 then stays in
// front of the camera, 2 units off the lens, as large on screen as on the console).
import * as THREE from 'three';
import * as HD from './hd.js';
import { NATIVE_SCALE } from './track.js';

const TICK = 1 / 60, K = 4.5 / (18 * 0.75), KXZ = 0.15, COLS = 8, KART_MID = 1.5;
// atlas frame width, height, count (extract-lakitu.py)
const ANIMS = { countdown: [56, 72, 32], flag: [72, 56, 32], secondlap: [72, 56, 16], finallap: [72, 56, 16], fishing: [56, 72, 4] };
// quads as seen on screen: x0, x1, half height in vertex units, scaled by sizeScaling 0.15 (common_vtx_lakitu,
// D_0D005F30 with the fishing line on its anchor, common_vtx_also_lakitu)
const QUADS = { countdown: [-28, 27, 35], fishing: [-10, 45, 35], flag: [-36, 35, 27], secondlap: [-36, 35, 27], finallap: [-36, 35, 27] };
const spline = (n, rows) => ({ n, pts: rows.map(([x, y, z, v]) => ({ p: [x, y, z], v })) });
// src/data/some_data.c
const COUNTDOWN_PATH = spline(13, [[150, 204, -500, 20], [100, 104, -300, 20], [50, 54, -100, 40], [4, 11, -14, 40],
  [4, 16, -10, 30], [4, 14, -8, 30], [4, 16, -6, 30], [4, 14, -4, 50], [4, 16, -2, 50], [4, 14, 0, 50],
  [-10, 16, 10, 40], [-50, 44, 100, 0], [-999, 1003, 500, 0]]);
const FLAG_PATH = spline(20, [[20, 18, 30, 40], [0, 18, 20, 40], [-20, 18, 10, 40], [0, 18, 0, 40], [20, 11, 0, 40],
  [0, 18, -30, 40], [-20, 11, 0, 40], [0, 18, -30, 40], [20, 11, 0, 40], [0, 18, 30, 40], [-20, 11, 50, 40],
  [0, 18, 30, 40], [20, 11, 0, 40], [0, 18, -30, 40], [-20, 11, 0, 40], [0, 18, -30, 40], [20, 11, 0, 40],
  [0, 18, -30, 40], [-20, 11, 0, 40], [0, 18, 30, 40]]);
const LAP_PATH = spline(11, [[50, 20, 80, 10], [20, 19, 40, 10], [0, 18, 30, 10], [-8, 17, 20, 30], [-12, 16, 10, 30],
  [0, 15, 0, 30], [12, 15, 10, 10], [8, 16, 20, 10], [0, 17, 30, 10], [-20, 18, 40, 10], [-60, 19, 100, 10]]);
// render_courses.c D_8015F8E4 (fluid / out-of-bounds level, MK64 units); the others use gCourseMinY - 10.
const FLUID = { choco: -80, bowser: -50, banshee: -80, frappe: -50, royal: -60, sherbet: -18, rainbow: 0, dk: -475 };
const SNOW = 0x05, CAVE = 0x0F;   // SURFACE_TYPE (mk64.h)

// gCourseMinY starts at 0 and takes the lowest collision triangle (add_collision_triangle); courses extracted
// without the collision mesh use their lowest vertex
function courseMinY(course) {
  let min = 0;
  if (course.collision) for (const i of course.collision.indices) min = Math.min(min, course.vertices[i][1]);
  else for (const v of course.vertices) min = Math.min(min, v[1]);
  return min;
}

export function fluidLevel(track) {
  const course = track.def.native;
  if (!course) return -1e4 * NATIVE_SCALE;
  return (FLUID[track.def.id] ?? courseMinY(course) - 10) * NATIVE_SCALE;
}

// collision.c func_802AAB4C: the fluid level at a kart (scene units), with the per-area overrides: Bowser's
// Castle moat by the drawbridge, the Koopa Troopa Beach pool, Sherbet Land's snow tunnel and D.K.'s Jungle
// Parkway's river (-33.9) vs. the cave and the drop below it (-475). floor = the last collision triangle the
// kart was over (meshIndexZX): { surface, section }.
export function fluidAt(track, x, z, floor) {
  const id = track.def.native ? track.def.id : null, S = NATIVE_SCALE;
  x /= S; z /= S;
  const surface = floor?.surface, section = floor?.section ?? 0xFF;
  switch (id) {
    case 'bowser': return x > 1859 || x < 1549 || z > -1102 || z < -1402 ? track.fluidY : 20 * S;
    case 'koopa': return x > 239 || x < 67 || z > 2405 || z < 2233 ? track.fluidY : 0.8 * S;
    case 'sherbet':
      if (surface === SNOW) return (track.courseMinY ??= courseMinY(track.def.native)) * S - 10 * S;
      return track.fluidY;
    case 'dk':
      if (section === 0xFF) {
        if (surface === CAVE) return -475 * S;
        if (x > -478) return -33.9 * S;
        if (x < -838 || z > -436) return -475 * S;
        if (z < -993) return -33.9 * S;
        return (z < x ? -475 : -33.9) * S;
      }
      return (section >= 0x14 ? -475 : -33.9) * S;
    default: return track.fluidY;
  }
}

// func_8008ACE0: uniform cubic B-spline basis
const basis = t => [(1 - t) ** 3 / 6, t ** 3 / 2 - t * t + 2 / 3, -(t ** 3) / 2 + t * t / 2 + t / 2 + 1 / 6, t ** 3 / 6];

class Referee {
  constructor(scene, layer, textures) {
    this.textures = textures;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(12), 3));
    geo.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(8), 2));
    geo.setIndex([0, 1, 2, 0, 2, 3]);
    this.material = new THREE.MeshBasicMaterial({ transparent: true, alphaTest: 0.5, side: THREE.DoubleSide, toneMapped: false, fog: false });
    this.mesh = new THREE.Mesh(geo, this.material);
    this.mesh.frustumCulled = false; this.mesh.visible = false;
    this.mesh.layers.set(layer);
    scene.add(this.mesh);
    this.mode = null; this.offset = [0, 0, 0];
  }

  start(mode, kart) {
    this.mode = mode; this.kart = kart; this.state = 1; this.frame = 0; this.alpha = 1; this.wt = null; this.an = null;
    this.sp = null; this.visible = false; this.offset = [0, 0, 0];
    const [x0, x1, h] = QUADS[mode].map(v => v * 0.15 * K), pos = this.mesh.geometry.attributes.position;
    pos.array.set([x0, -h, 0, x1, -h, 0, x1, h, 0, x0, h, 0]); pos.needsUpdate = true;
    this.material.map = this.textures[mode]; this.material.needsUpdate = true;
  }

  stop() { this.mode = null; this.mesh.visible = false; }

  // set_and_run_timer_object: next state after n + 1 ticks
  wait(n) { if (this.wt === null) this.wt = n; if (--this.wt < 0) { this.wt = null; this.state++; return true; } return false; }

  // func_80072E54 / func_80072F88 (dir -1): frames first..last every `period` ticks, `loops` passes (-1 forever)
  anim(first, last, period, loops, dir = 1) {
    if (!this.an) { this.an = { t: period, loops }; this.frame = first; return false; }
    if (--this.an.t > 0) return false;
    this.an.t = period; this.frame += dir;
    if (dir * (this.frame - last) > 0) {
      if (this.an.loops > 0) this.an.loops--;
      if (this.an.loops === 0) { this.frame = last; this.an = null; this.state++; return true; }
      this.frame = first;
    }
    return false;
  }

  // func_800730BC: first..last..first ping-pong
  pingpong(first, last, period) {
    if (!this.an) { this.an = { t: period, up: true }; this.frame = first; return; }
    if (--this.an.t > 0) return;
    this.an.t = period;
    if (this.an.up) { if (++this.frame >= last) { this.frame = last; this.an.up = false; } }
    else if (--this.frame <= first) { this.frame = first; this.an.up = true; }
  }

  // func_8008B620 (once) / func_8008B6A4 (loop): offset = B-spline over 4 control points, 10000 / velocity per tick
  splineTick() {
    const s = this.sp;
    if (!s || s.done) return;
    const { n, pts } = s.path, P = i => pts[i % n], t = s.timer / 10000, b = basis(t);
    for (let a = 0; a < 3; a++) this.offset[a] = b.reduce((sum, w, k) => sum + w * P(s.idx + k).p[a], 0);
    const v0 = P(s.idx).v, v1 = P(s.idx + 1).v;
    s.timer += 10000 / ((v1 - v0) * t + v0);
    if (s.timer >= 10000) {
      s.idx++; s.timer = 0;
      if (s.loop ? s.idx === n : s.idx + 3 === n) { if (s.loop) s.idx = 0; else s.done = true; }
    }
  }

  tick(events) {
    switch (this.mode) {
      case 'countdown':   // update_object_lakitu_countdown
        switch (this.state) {
          case 1: this.frame = 0; this.state++; break;
          case 2: this.wait(0); break;   // unk_048 = D_8018D180: the console's intro delay, none here
          case 3: this.visible = true; this.sp = { path: COUNTDOWN_PATH, idx: 0, timer: 0, loop: false }; this.state++; break;
          case 4: case 5: this.wait(30); break;
          case 6: this.anim(1, 7, 2, 0); break;
          case 7: if (this.wait(20)) events?.('red'); break;   // tlutList += 0x200: no lights -> red
          case 8: this.anim(8, 15, 6, 0); break;
          case 9: if (this.wait(8)) events?.('red'); break;
          case 10: this.anim(16, 23, 6, 0); break;
          case 11: if (this.wait(8)) events?.('green'); break;  // red -> blue, SOUND_ACTION_GREEN_LIGHT
          case 12: this.anim(24, 27, 6, 0); break;
          case 13: this.state++; break;
          case 14: this.wait(120); break;
          case 15: this.stop(); return;
        }
        break;
      case 'flag':   // update_object_lakitu_red_flag
        if (this.state === 1) { this.sp = { path: FLAG_PATH, idx: 0, timer: 0, loop: true }; this.state++; }
        else if (this.state === 2) { this.visible = true; this.state++; }
        else this.anim(0, 31, 2, -1);
        break;
      case 'secondlap': case 'finallap':   // update_object_lakitu_second_lap / _final_lap
        switch (this.state) {
          case 1: this.sp = { path: LAP_PATH, idx: 0, timer: 0, loop: false }; this.state++; break;
          case 2: this.visible = true; this.state++; break;
          case 3: this.wait(20); break;
          case 4: this.anim(0, 15, 2, 1); break;
          case 5: this.wait(60); break;
          case 6: this.anim(15, 0, 2, 1, -1); break;
          case 7: if (this.sp.done) { this.stop(); return; } break;
        }
        break;
      case 'fishing': {   // update_object_lakitu_fishing + func_80079A5C (offset 80 down to 5, later up to 100)
        const r = this.kart.rescue;
        if (this.state === 1) { this.offset = [0, 80, 0]; this.stage = 1; this.state++; }
        else if (this.state === 2) { this.visible = true; this.state++; }
        else this.pingpong(0, 3, 2);
        if (this.stage === 1 && (this.offset[1] = Math.max(5, this.offset[1] - 1)) === 5) { if (r) r.held = true; this.stage = 2; }
        else if (this.stage === 2 && !r) this.stage = 3;
        else if (this.stage === 3 && (this.offset[1] = Math.min(100, this.offset[1] + 1)) === 100) { this.stop(); return; }
        this.alpha = r ? r.alpha : 1;   // func_8007993C: fades with the kart (LAKITU_FIZZLE)
        break;
      }
    }
    this.splineTick();
  }

  // func_8007A66C (rotated by the camera yaw, height from the kart's ground) / func_8007A778 (fishing: over the kart)
  place(cam) {
    const k = this.kart;
    if (!this.mode || !this.visible || !k) { this.mesh.visible = false; return; }
    const ox = this.offset[0] * KXZ, oy = this.offset[1] * K, oz = this.offset[2] * KXZ, m = this.mesh.position;
    if (this.mode === 'fishing') m.set(k.world.x, k.world.y + KART_MID + oy, k.world.z);
    else {
      cam.getWorldDirection(_dir);
      const t = Math.PI - Math.atan2(_dir.x, _dir.z), c = Math.cos(t), s = Math.sin(t);
      m.set(k.world.x + c * ox - s * oz, (k.groundY ?? k.world.y) + oy, k.world.z + s * ox + c * oz);
    }
    this.mesh.rotation.set(0, Math.atan2(cam.position.x - m.x, cam.position.z - m.z), 0);   // func_800418AC: yaw to the camera
    const [fw, fh, n] = ANIMS[this.mode], cols = Math.min(COLS, n), rows = Math.ceil(n / COLS);
    const col = this.frame % COLS, row = Math.floor(this.frame / COLS), iu = 0.5 / (fw * cols), iv = 0.5 / (fh * rows);
    const u0 = col / cols + iu, u1 = (col + 1) / cols - iu, v1 = 1 - row / rows - iv, v0 = 1 - (row + 1) / rows + iv;
    const uv = this.mesh.geometry.attributes.uv;
    uv.array.set([u0, v0, u1, v0, u1, v1, u0, v1]); uv.needsUpdate = true;
    this.material.opacity = this.alpha;
    this.mesh.visible = true;
  }
}
const _dir = new THREE.Vector3();

export class Lakitu {
  constructor(scene, track) {
    this.scene = scene; this.track = track; this.acc = 0; this.referees = []; this.onLight = null;
    track.fluidY = fluidLevel(track);
    track.fluidAt = (x, z, floor) => fluidAt(track, x, z, floor);
    this.textures = {};
    for (const mode of Object.keys(ANIMS)) {
      const tex = HD.loadTexture(`lakitu/${mode}.png`, { mipmaps: false });
      tex.colorSpace = THREE.SRGBColorSpace;
      this.textures[mode] = tex;
    }
  }

  // views: [{ kart, cam }] in screen order; referee i is drawn on layer 1 + i, which only camera i renders
  setViews(views) {
    for (const r of this.referees) { this.scene.remove(r.mesh); r.mesh.geometry.dispose(); r.material.dispose(); }
    this.referees = views.map((v, i) => {
      for (let l = 1; l <= 4; l++) v.cam.layers.disable(l);
      v.cam.layers.enable(1 + i);
      const r = new Referee(this.scene, 1 + i, this.textures);
      r.kart = v.kart; r.cam = v.cam;
      return r;
    });
  }

  // the console's func_80078F64: every screen player's referee starts the countdown; P1's calls the lights
  startCountdown(onLight) {
    this.onLight = onLight; this.acc = 0;
    for (const r of this.referees) { r.start('countdown', r.kart); r.seen = { lap: 1, finished: false }; }
  }

  update(dt, karts, laps) {
    for (this.acc += dt; this.acc >= TICK; this.acc -= TICK) {
      for (const k of karts) {
        if (k.remote || k.free) continue;   // arena karts keep their own rescue timer (Kart.updateFree)
        if (k.fell && !k.rescue) this.rescue(k);
        if (k.rescue) rescueTick(k, this.track);
      }
      this.referees.forEach((r, i) => {
        const k = r.kart;
        if (k && r.seen && r.mode !== 'countdown') {   // lap signs and the finish flag (func_80079084 / func_800790B4 / func_80079054)
          const lap = Math.min(laps, k.crossings + 1);
          if (k.finished && !r.seen.finished) { r.seen.finished = true; if (!k.rescue) r.start('flag', k); }
          else if (lap > r.seen.lap && !k.finished) {
            r.seen.lap = lap;
            if (!k.rescue && lap >= 2) r.start(lap === laps ? 'finallap' : 'secondlap', k);
          }
        }
        if (r.mode) r.tick(i === 0 ? this.onLight : null);
      });
    }
    for (const r of this.referees) r.place(r.cam);
  }

  // func_80079860 -> func_800797AC: a screen player's Lakitu comes down to hook it; CPU karts are held at once
  rescue(k) {
    const f = k.fell;
    k.fell = null;
    k.rescue = { kind: f.kind, base: f.base, phase: 0, count: 0, alpha: 1, held: false, y: k.world.y, swing: 0, swingV: 0.5, swingDir: 1, watch: true };
    k.air = true; k.v = 0; k.vy = 0;
    const r = this.referees.find(q => q.kart === k);
    if (r) r.start('fishing', k); else k.rescue.held = true;
  }
}

// effects.c func_80090970 (unk_222 phases 0-4), MK64 heights scaled by K over the fluid level / catch height / road
function rescueTick(k, track) {
  const r = k.rescue;
  switch (r.phase) {
    case 0:
      if (r.kind === 'water' && (r.count < 60 || !r.held)) r.count = Math.min(60, r.count + 1);   // sinks first
      else if (r.held) {
        r.y += (r.base + 100 * K - r.y) * (r.kind === 'water' ? 0.012 : 0.025);
        if (r.y >= r.base + 40 * K) r.phase = 1;   // LAKITU_FIZZLE
      }
      break;
    case 1:
      r.y += (r.base + 40 * K - r.y) * 0.02;
      r.alpha -= 8 / 255;
      if (r.alpha < 9 / 255) { r.alpha = 0; r.phase = 2; }
      break;
    case 2: {   // func_80090178: over the last road point, facing along the course, 40 up
      const L = track.length, s0 = k.s, s1 = k.lastGroundS ?? k.s;
      if (s0 < L * 0.25 && s1 > L * 0.75) k.crossings--;
      else if (s0 > L * 0.75 && s1 < L * 0.25) k.crossings++;
      k.s = s1; k.prevS = s1; k.d = 0; k.psi = k.phi = 0;
      k.y = null; k.groundY = null; k.air = false; k.vy = 0; k.ramp = null; k.takeoffY = null;
      k.syncMesh(0);
      r.road = k.world.y; r.y = r.road + 40 * K; r.phase = 3; r.watch = false; r.snap = true;
      k.air = true;
      break;
    }
    case 3:
      r.alpha += 8 / 255;
      if (r.alpha >= 240 / 255) { r.alpha = 1; r.phase = 4; r.count = 0; }
      break;
    case 4:
      r.y += (r.road - r.y) * 0.04;
      if (++r.count >= 91) {   // let go: the kart drops the rest of the way under its own gravity
        k.rescue = null;
        k.y = r.y; k.vy = 0; k.air = true; k.takeoffY = r.road;
        k.mesh.userData.setAlpha(1); k.mesh.userData.lean = 0;
        return;
      }
      break;
  }
  // unk_D9C: the hooked kart swings +-10 degrees
  r.swingV = Math.min(180, r.swingV + 8);
  r.swing += r.swingV * r.swingDir;
  if (Math.abs(r.swing) >= 1820) { r.swingV = 0; r.swingDir *= -1; }
  k.world.y = r.y; k.mesh.position.copy(k.world);
  k.mesh.userData.lean = r.swing * Math.PI * 2 / 65536;
  k.mesh.userData.setAlpha(r.alpha);
}
