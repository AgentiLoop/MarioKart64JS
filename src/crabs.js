// Koopa Troopa Beach crabs (tools/extract-crabs.py -> public/mk64/koopa-troopa-beach/crabs.json).
// init_course_objects puts one crab on each of the 10 gCrabSpawns at (startX, 0, startZ); update_crabs (once a frame =
// every other 60 Hz tick):
// - func_80082B34 animates gTextureCrab1..7: state 2 shows frames 0-3, state 3 frames 4-6, two frames each, round
//   (func_80072E54); a state change starts its loop again (func_800726CC clears 0x2000);
// - func_80082C30 (unk_0AE): 1 walks from the spawn to (patrolX, patrolZ) at 1.5 a frame (func_80087A0C), then waits
//   random(60) (func_80087104), backs off 60 frames at 0.8 (func_80087954), waits, walks forward 60 frames
//   (func_8008789C) and goes back to waiting; walking shows state 2, waiting state 3;
// - while the crab is within 500 of a screen and inside its 0x4000 view wedge (func_8008A6DC) it stands 2.5 above the
//   ground (func_80088538), otherwise at y 0;
// - func_80089F24: a kart touching it (x/z within 1 + its boundingBoxSize) without a boo / star / spin spins out.
// render_object_crabs: within 800 and its view wedge (func_8008A364, 0x5555 / 0x4000 / 0x2AAB by distance) the
// current frame is turned to the camera (func_800418AC), rolled 0x8000 and drawn as two 64x32 strips at 0.15.
// EXTRA: the console mirrors the spawns; the port keeps them and flips the quad back in its own x.
// Not ported: the ground shadow (func_8004A6EC, D_0D007B20) and the time-trial replay flag (func_80072180).
import * as THREE from 'three';
import * as HD from './hd.js';
import { NATIVE_SCALE } from './track.js';
import { inWedge } from './thwomp.js';
import { quadGeometry } from './snowmen.js';

const TICK = 1 / 60;
const S = NATIVE_SCALE;
const RAD = Math.PI / 32768;
const f32 = Math.fround;
const rand = n => Math.floor(Math.random() * n);   // random_int
const atan2s = (x, z) => Math.round(Math.atan2(x, z) / RAD) & 0xFFFF;
const _v = new THREE.Vector3(), _q = new THREE.Quaternion(), _s = new THREE.Vector3(), _e = new THREE.Euler();

export class Crabs {
  constructor(scene, track, def, { mirror = false, items = null } = {}) {
    this.group = new THREE.Group();
    this.group.name = 'crabs';
    scene.add(this.group);
    this.track = track; this.mirror = mirror; this.items = items;
    this.ticks = 0; this.acc = 0; this.list = [];
    this.ready = fetch(`${import.meta.env?.BASE_URL ?? '/'}mk64/${def.dir}/crabs.json`)
      .then(r => (r.ok ? r.json().catch(() => null) : null))   // no file: the dev server answers with index.html
      .then(data => data && this._build(data, def.dir));
  }

  _build(data, dir) {
    this.data = data;
    this.geometry = quadGeometry(data.quad, 64);
    // G_CC_DECALRGBA + G_RM_AA_ZB_TEX_EDGE: the texel as is, alpha-tested
    this.materials = data.frames.map(f => {
      const map = HD.loadTexture(`${dir}/${f.image}`);
      map.colorSpace = THREE.SRGBColorSpace;
      map.flipY = false;
      map.wrapS = map.wrapT = THREE.ClampToEdgeWrapping;
      return new THREE.MeshBasicMaterial({ map, alphaTest: 0.5, side: THREE.DoubleSide, toneMapped: false, fog: false });
    });
    this.reset();
  }

  // init_course_objects for a new race
  reset() {
    this.acc = 0; this.ticks = 0;
    if (!this.data) return;
    for (const o of this.list) this.group.remove(o.mesh);
    const self = this, scale = this.data.scale;
    this.list = this.data.spawns.map(([x, px, z, pz]) => {
      const o = { origin: [x, 0, z], patrol: [px, pz], offset: [0, 0, 0], pos: [x, 0, z], vel: [0, 0], dir: 0,
        speed: this.data.speed, state: 1, ae: 1, flag8: false, b0: 0, anim: false, frame: 0, timer: 0, visible: false };
      o.mesh = new THREE.Mesh(this.geometry, this.materials[0]);
      o.mesh.matrixAutoUpdate = false;
      o.mesh.frustumCulled = false;   // the matrix is built per camera
      o.mesh.onBeforeRender = function (renderer, scene, camera) {
        if (o.state < 2 || !self._place(this, camera, o.pos, scale)) this.matrixWorld.makeScale(0, 0, 0);
      };
      this.group.add(o.mesh);
      return o;
    });
  }

  // func_8008A364(0x2AAB, 800), then the quad turned to the camera (func_800418AC) and rolled 0x8000
  _place(mesh, camera, p, scale) {
    const e = camera.matrixWorld.elements, dx = p[0] - e[12] / S, dz = p[2] - e[14] / S, d2 = dx * dx + dz * dz;
    if (d2 >= 800 * 800) return false;
    if (!inWedge(p, camera, d2 < 10001 ? 0x5555 : d2 < 40001 ? 0x4000 : 0x2AAB)) return false;
    const m = this.mirror ? -1 : 1;
    _q.setFromEuler(_e.set(0, Math.atan2(dx, dz), Math.PI, 'YXZ'));
    mesh.matrixWorld.compose(_v.set(p[0] * S, p[1] * S, p[2] * S), _q, _s.set(m * scale * S, scale * S, scale * S));
    return true;
  }

  // func_800726CC
  _state(o, s) { o.state = s; o.anim = false; }

  // func_80072E54(first, last, 1, 2, -1)
  _animate(o, first, last) {
    if (!o.anim) { o.anim = true; o.frame = first; o.timer = 2; return; }
    if (--o.timer > 0) return;
    o.timer = 2;
    if (++o.frame > last) o.frame = first;
  }

  // the unk_0B0 countdowns: true once it has run out
  _count(o, start) {
    if (!o.flag8) { o.flag8 = true; o.b0 = start(); }
    if (--o.b0 < 0) { o.flag8 = false; return true; }
    return false;
  }

  // func_8008751C / func_80087620 then object_add_velocity_offset_xz while the countdown runs
  _walk(o, frames, back = false) {
    const done = this._count(o, () => {
      const n = frames();   // func_80087A0C sets the direction first
      const a = (o.dir + (back ? 0x8000 : 0)) * RAD;
      o.vel = [f32(o.speed * Math.sin(a)), f32(o.speed * Math.cos(a))];
      return n;
    });
    if (!done) { o.offset[0] = f32(o.offset[0] + o.vel[0]); o.offset[2] = f32(o.offset[2] + o.vel[1]); }
    return done;
  }

  // func_80082C30
  _move(o) {
    switch (o.ae) {
      case 1: {   // func_80087A0C(origin x, patrol x, origin z, patrol z)
        const dx = (o.patrol[0] - o.origin[0]) << 16 >> 16, dz = (o.patrol[1] - o.origin[2]) << 16 >> 16;
        if (this._walk(o, () => {
          o.origin[1] = 0; o.dir = atan2s(dx, dz);
          return Math.trunc(Math.trunc(Math.sqrt(dx * dx + dz * dz)) / o.speed);
        })) { this._state(o, 3); o.ae++; }
        break;
      }
      case 2: if (this._count(o, () => rand(60))) { o.speed = this.data.patrolSpeed; this._state(o, 2); o.ae++; } break;
      case 3: if (this._walk(o, () => 60, true)) { o.ae++; this._state(o, 3); } break;
      case 4: if (this._count(o, () => rand(60))) { this._state(o, 2); o.ae++; } break;
      case 5: if (this._walk(o, () => 60)) { this._state(o, 3); o.ae = 2; } break;
    }
    for (let i = 0; i < 3; i++) o.pos[i] = f32(o.origin[i] + o.offset[i]);
    if (o.visible) {
      const g = this.track?.groundBelow?.(o.pos[0] * S, o.pos[2] * S, 30 * S);   // check_bounding_collision (10 around y 20)
      if (g) o.pos[1] = f32(g.y / S + 2.5);
    }
  }

  // func_8008A6DC(500): within 500 of a screen and inside its 0x4000 wedge
  _visible(o, cams) {
    return cams.some(cam => {
      const e = cam.matrixWorld.elements, dx = o.pos[0] - e[12] / S, dz = o.pos[2] - e[14] / S;
      return dx * dx + dz * dz <= 500 * 500 && inWedge(o.pos, cam, 0x4000);
    });
  }

  // func_80089F24: spin out every kart touching the crab
  _collide(o, karts) {
    const r0 = this.data.boundingBoxSize;
    for (const k of karts) {
      if (!k?.world || k.remote || k.boo > 0 || k.star > 0 || k.spin > 0 || k.out) continue;
      const r = r0 + (k.boxSize ?? 5.5), dx = o.pos[0] - k.world.x / S, dz = o.pos[2] - k.world.z / S;
      if (dx * dx + dz * dz <= r * r) this.items?.hit(k);   // SPINOUT_TRIGGER
    }
  }

  // update_crabs
  _frame(cams, karts) {
    for (const o of this.list) {
      if (o.state === 1) this._state(o, 2);   // init_ktb_crab, object_next_state
      else if (o.state === 2) this._animate(o, 0, 3);
      else if (o.state === 3) this._animate(o, 4, 6);
      o.mesh.material = this.materials[o.frame];   // func_80073514
      o.visible = this._visible(o, cams);
      this._move(o);
      this._collide(o, karts);
    }
  }

  // cams: each screen's camera; karts: every kart
  update(dt, cams = [], karts = []) {
    if (!this.data) return;
    for (this.acc += dt; this.acc >= TICK; this.acc -= TICK) {
      this.ticks++;
      if (!(this.ticks & 1)) continue;   // objects update once a frame (two 60 Hz ticks)
      this._frame(cams, karts);
    }
  }
}
