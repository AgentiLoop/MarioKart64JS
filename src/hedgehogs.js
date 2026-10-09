// Yoshi Valley hedgehogs (tools/extract-hedgehogs.py -> public/mk64/yoshi-valley/hedgehogs.json).
// init_course_objects puts one hedgehog on each of the 15 gHedgehogSpawns at (x, y + 6, z); update_hedgehogs (once a
// frame = every other 60 Hz tick):
// - func_800833D0: func_80072D3C(0, 1, 4) swaps the quad between common_vtx_hedgehog and its s-flipped twin
//   D_0D006130 every 5 frames (the waddle);
// - func_80083248 (unk_0AE): 1 walks from the spawn to (patrolX, patrolZ) at (i % 6) * 0.1 + 0.5 a frame
//   (func_80087A0C), 2 waits 60 (func_800871AC), 3 walks back to the spawn, 4 waits 60 and starts over; while the last
//   frame drew it on a screen (0x200000) it stands 6 above the ground, the ground re-read (func_8008861C) only while it
//   was within 600 (0x400000); render_object_hedgehogs sets those flags, update_hedgehogs clears them (func_80072120);
// - func_80089F24: a kart touching it (x/z within 2 + its boundingBoxSize) without a boo / star / spin spins out.
// render_object_hedgehogs: within 1000 and its view wedge (func_8008A364, 0x5555 / 0x4000) and within 580 the quad is
// turned to the camera (func_800418AC), rolled 0x8000 and drawn as two 64x32 strips at 0.2.
// EXTRA: the console mirrors the spawns; the port keeps them and flips the quad back in its own x.
// Not ported: the ground shadow (func_8004A870) and the time-trial replay flag (func_80072180).
import * as THREE from 'three';
import * as HD from './hd.js';
import { NATIVE_SCALE } from './track.js';
import { inWedge } from './thwomp.js';
import { quadGeometry } from './snowmen.js';

const TICK = 1 / 60;
const S = NATIVE_SCALE;
const RAD = Math.PI / 32768;
const f32 = Math.fround;
const atan2s = (x, z) => Math.round(Math.atan2(x, z) / RAD) & 0xFFFF;
const _v = new THREE.Vector3(), _q = new THREE.Quaternion(), _s = new THREE.Vector3(), _e = new THREE.Euler();

export class Hedgehogs {
  constructor(scene, track, def, { mirror = false, items = null } = {}) {
    this.group = new THREE.Group();
    this.group.name = 'hedgehogs';
    scene.add(this.group);
    this.track = track; this.mirror = mirror; this.items = items;
    this.ticks = 0; this.acc = 0; this.list = [];
    this.ready = fetch(`${import.meta.env?.BASE_URL ?? '/'}mk64/${def.dir}/hedgehogs.json`)
      .then(r => (r.ok ? r.json().catch(() => null) : null))   // no file: the dev server answers with index.html
      .then(data => data && this._build(data, def.dir));
  }

  _build(data, dir) {
    this.data = data;
    this.geometries = data.quads.map(q => quadGeometry(q, 64));
    const map = HD.loadTexture(`${dir}/${data.image}`);
    map.colorSpace = THREE.SRGBColorSpace;
    map.flipY = false;
    map.wrapS = map.wrapT = THREE.ClampToEdgeWrapping;
    // G_CC_DECALRGBA + G_RM_AA_ZB_TEX_EDGE: the texel as is, alpha-tested
    this.material = new THREE.MeshBasicMaterial({ map, alphaTest: 0.5, side: THREE.DoubleSide, toneMapped: false, fog: false });
    this.reset();
  }

  // init_course_objects for a new race
  reset() {
    this.acc = 0; this.ticks = 0;
    if (!this.data) return;
    for (const o of this.list) this.group.remove(o.mesh);
    const self = this;
    this.list = this.data.spawns.map(([x, y, z, , px, pz, speed]) => {
      const o = { origin: [x, 0, z], patrol: [px, pz], offset: [0, 0, 0], pos: [x, f32(y + 6), z], surface: f32(y + 6),
        vel: [0, 0], dir: 0, speed, state: 1, ae: 1, flag8: false, b0: 0, anim: false, d4: 1, timer: 0, quad: 0,
        drawn: false, near: false, rendered: false };
      o.mesh = new THREE.Mesh(this.geometries[0], this.material);
      o.mesh.matrixAutoUpdate = false;
      o.mesh.frustumCulled = false;   // the matrix is built per camera
      o.mesh.onBeforeRender = function (renderer, scene, camera) {
        o.rendered = true;
        if (o.state < 2 || !self._place(this, camera, o)) this.matrixWorld.makeScale(0, 0, 0);
      };
      this.group.add(o.mesh);
      return o;
    });
  }

  // render_object_hedgehogs: func_8008A364(0x4000, 1000) sets the flags the next update reads; drawn within 580,
  // turned to the camera (func_800418AC) and rolled 0x8000
  _place(mesh, camera, o) {
    const p = o.pos, e = camera.matrixWorld.elements, dx = p[0] - e[12] / S, dz = p[2] - e[14] / S, d2 = dx * dx + dz * dz;
    if (d2 >= 1000 * 1000 || !inWedge(p, camera, d2 < 10001 ? 0x5555 : 0x4000)) return false;
    o.drawn = true;
    if (d2 < 0x57E41) o.near = true;
    if (d2 >= 0x52211) return false;
    const m = this.mirror ? -1 : 1, scale = this.data.scale;
    _q.setFromEuler(_e.set(0, Math.atan2(dx, dz), Math.PI, 'YXZ'));
    mesh.matrixWorld.compose(_v.set(p[0] * S, p[1] * S, p[2] * S), _q, _s.set(m * scale * S, scale * S, scale * S));
    return true;
  }

  // func_80072D3C(0, 1, 4, -1)
  _waddle(o) {
    if (!o.anim) { o.anim = true; o.timer = 4; o.quad = 0; o.d4 = 1; return; }
    if (--o.timer >= 0) return;
    o.timer = 4;
    o.quad = --o.d4 & 1 ? 0 : 1;
    if (o.d4 < 0) o.d4 = 1;
  }

  // the unk_0B0 countdowns: true once it has run out
  _count(o, start) {
    if (!o.flag8) { o.flag8 = true; o.b0 = start(); }
    if (--o.b0 < 0) { o.flag8 = false; return true; }
    return false;
  }

  // func_80087A0C(from x, to x, from z, to z): func_8008751C then object_add_velocity_offset_xz while it runs
  _walk(o, x0, x1, z0, z1) {
    const done = this._count(o, () => {
      const dx = (x1 - x0) << 16 >> 16, dz = (z1 - z0) << 16 >> 16;
      const dist = Math.trunc(Math.sqrt(dx * dx + dz * dz)) << 16 >> 16;
      o.origin[1] = 0; o.dir = atan2s(dx, dz);
      const a = o.dir * RAD;
      o.vel = [f32(o.speed * Math.sin(a)), f32(o.speed * Math.cos(a))];
      return Math.trunc(f32(dist / o.speed));
    });
    if (!done) { o.offset[0] = f32(o.offset[0] + o.vel[0]); o.offset[2] = f32(o.offset[2] + o.vel[1]); }
    return done;
  }

  // func_80083248
  _move(o) {
    switch (o.ae) {
      case 1: if (this._walk(o, o.origin[0], o.patrol[0], o.origin[2], o.patrol[1])) o.ae++; break;
      case 2: if (this._count(o, () => 60)) o.ae++; break;
      case 3: if (this._walk(o, o.patrol[0], o.origin[0], o.patrol[1], o.origin[2])) o.ae++; break;
      case 4: if (this._count(o, () => 60)) o.ae = 1; break;
    }
    for (let i = 0; i < 3; i++) o.pos[i] = f32(o.origin[i] + o.offset[i]);
    if (o.drawn) {
      if (o.near) {   // check_bounding_collision (10 around y 20)
        const g = this.track?.groundBelow?.(o.pos[0] * S, o.pos[2] * S, 30 * S);
        if (g) o.surface = f32(g.y / S);
      }
      o.pos[1] = f32(o.surface + 6);
    }
  }

  // func_80089F24: spin out every kart touching the hedgehog
  _collide(o, karts) {
    const r0 = this.data.boundingBoxSize;
    for (const k of karts) {
      if (!k?.world || k.remote || k.boo > 0 || k.star > 0 || k.spin > 0 || k.out) continue;
      const r = r0 + (k.boxSize ?? 5.5), dx = o.pos[0] - k.world.x / S, dz = o.pos[2] - k.world.z / S;
      if (dx * dx + dz * dz <= r * r) this.items?.hit(k);   // SPINOUT_TRIGGER
    }
  }

  // update_hedgehogs
  _frame(karts) {
    for (const o of this.list) {
      if (o.state === 1) o.state = 2;   // func_8008311C, object_next_state
      else this._waddle(o);
      o.mesh.geometry = this.geometries[o.quad];
      this._move(o);
      this._collide(o, karts);
      if (o.rendered) o.drawn = o.near = o.rendered = false;   // func_80072120 (kept when no frame was drawn since)
    }
  }

  // karts: every kart (the screens' cameras flag the hedgehogs as they draw them)
  update(dt, karts = []) {
    if (!this.data) return;
    for (this.acc += dt; this.acc >= TICK; this.acc -= TICK) {
      this.ticks++;
      if (!(this.ticks & 1)) continue;   // objects update once a frame (two 60 Hz ticks)
      this._frame(karts);
    }
  }
}
