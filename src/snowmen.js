// Frappe Snowland snowmen (tools/extract-snowmen.py -> public/mk64/frappe-snowland/snowmen.json).
// init_course_objects puts a body (origin y + 3) and a head (origin y + 8) on each of the 19 gSnowmanSpawns; update_snowmen
// (once a frame = every other 60 Hz tick):
// - the head (func_80083948) sways: primAlpha (random -0x1000..0x0FFF) +- 0x400 every other frame between -0x1000 and
//   0x1000 (func_80073D0C), drawn rolled by primAlpha + 0x8000;
// - while a screen's track section is within one of the body's (func_8008A8B0) and a kart touches it (func_80089B50:
//   x/z within 2 + the kart's boundingBoxSize, any height) the kart tumbles (VERTICAL_TUMBLE_TRIGGER; a star kart only
//   hears 0x19018010), the body vanishes, D_8018D3BC snow puffs burst out (func_800836F0: 40 / 24 / 16 by screens) and
//   the head flies up (vy 10, - 0.5 for 10 frames) and falls (- 0.2 a frame) to 7 below its rest;
// - 300 frames later (func_80083C04) the head climbs back at 0.2 a frame, the body reappears 10 frames after at 0.001
//   scale and grows 0.0025 a frame to 0.1, then it can be hit again.
// render_object_snowmans_list_1: within 600 (func_8008A364: 0x5555 / 0x4000 / 0x2AAB view wedge by distance) both are
// turned to the camera (func_800418AC from the body) and drawn as 64x64 CI8 quads at 0.1 scale, the head 12 nearer.
// render_object_snowmans_list_2: each puff (func_8008379C: 4.5-5.4 out, 2.6-12.1 up, - 0.74 a frame for 100 frames,
// spinning) is the 32x32 snow quad at 0.05-0.149, within 500.
// EXTRA: the console mirrors the spawns; the port keeps them and flips each quad back in its own x (roll negated).
// Not ported: the falling snowflakes (gObjectParticle1, NUM_SNOWFLAKES) and the time-trial replay flag (func_80072180).
import * as THREE from 'three';
import * as HD from './hd.js';
import { NATIVE_SCALE } from './track.js';
import { TrackSections } from './sections.js';
import { inWedge } from './thwomp.js';

const TICK = 1 / 60;
const S = NATIVE_SCALE;
const RAD = Math.PI / 32768;
const f32 = Math.fround;
const s16 = v => ((v + 0x8000) & 0xFFFF) - 0x8000;
const rand = n => Math.floor(Math.random() * n);   // random_int
const BBOX = { donkeykong: 6, bowser: 6 };   // gKartBoundingBoxSizeTable: 5.5, DK and Bowser 6
const MAX_PUFFS = 128;   // gObjectParticle2_SIZE
const _v = new THREE.Vector3(), _q = new THREE.Quaternion(), _s = new THREE.Vector3(), _e = new THREE.Euler();

// common_rectangle_display (0, 2, 1), (0, 3, 2) per 4 vertices; each further strip starts 31 rows down the texture
export function quadGeometry(verts, size) {
  const pos = [], uv = [], index = [];
  verts.forEach(([x, y, z, s, t], i) => {
    pos.push(x, y, z);
    uv.push(s / size, (t + 31 * Math.floor(i / 4)) / size);
  });
  for (let k = 0; k < verts.length; k += 4) index.push(k, k + 2, k + 1, k, k + 3, k + 2);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(index);
  return g;
}

export class Snowmen {
  constructor(scene, def, { mirror = false, items = null, audio = null } = {}) {
    this.group = new THREE.Group();
    this.group.name = 'snowmen';
    scene.add(this.group);
    this.mirror = mirror; this.items = items; this.audio = audio;
    this.screens = 1; this.ticks = 0; this.acc = 0;
    this.sections = new Map();   // camera -> pathCounter (D_8018CF68)
    this.list = []; this.puffs = [];
    this.ready = fetch(`${import.meta.env?.BASE_URL ?? '/'}mk64/${def.dir}/snowmen.json`)
      .then(r => (r.ok ? r.json().catch(() => null) : null))   // no file: the dev server answers with index.html
      .then(data => data && this._build(data, def.dir));
  }

  _build(data, dir) {
    this.data = data;
    this.trackSections = new TrackSections(data.sections);
    this.materials = {};
    this.geometries = {};
    for (const [name, t] of Object.entries(data.textures)) {
      const map = HD.loadTexture(`${dir}/${t.image}`);
      map.colorSpace = THREE.SRGBColorSpace;
      map.flipY = false;
      map.wrapS = map.wrapT = THREE.ClampToEdgeWrapping;   // G_TX_CLAMP, G_TF_BILERP
      // G_CC_DECALRGBA + G_RM_AA_ZB_TEX_EDGE: the texel as is, alpha-tested
      this.materials[name] = new THREE.MeshBasicMaterial({ map, alphaTest: 0.5, side: THREE.DoubleSide, toneMapped: false, fog: false });
      this.geometries[name] = quadGeometry(data.quads[name], t.size);
    }
    const self = this;
    this.puffMeshes = Array.from({ length: MAX_PUFFS }, (_, i) => {
      const mesh = this._mesh('snow');
      mesh.onBeforeRender = function (renderer, scene, camera) {
        const p = self.puffs[i];
        if (!p || p.state <= 0 || !self._place(this, camera, p.pos, p.pos, p.rotZ, p.scale, 500)) this.matrixWorld.makeScale(0, 0, 0);
      };
      return mesh;
    });
    this.setScreens(this.screens);
  }

  _mesh(name) {
    const mesh = new THREE.Mesh(this.geometries[name], this.materials[name]);
    mesh.matrixAutoUpdate = false;
    mesh.frustumCulled = false;   // the matrix is built per camera
    this.group.add(mesh);
    return mesh;
  }

  // func_8008A364 visibility from `from`, then the quad at `at` turned to the camera (func_800418AC) and rolled by rotZ
  _place(mesh, camera, from, at, rotZ, scale, max) {
    const e = camera.matrixWorld.elements, dx = from[0] - e[12] / S, dz = from[2] - e[14] / S, d2 = dx * dx + dz * dz;
    if (d2 >= max * max) return false;
    if (!inWedge(from, camera, d2 < 10001 ? 0x5555 : d2 < 40001 ? 0x4000 : 0x2AAB)) return false;
    const m = this.mirror ? -1 : 1;
    _q.setFromEuler(_e.set(0, Math.atan2(dx, dz), m * rotZ * RAD, 'YXZ'));
    mesh.matrixWorld.compose(_v.set(at[0] * S, at[1] * S, at[2] * S), _q, _s.set(m * scale * S, scale * S, scale * S));
    return true;
  }

  // init_course_objects for a new race on this many screens
  setScreens(n) {
    this.screens = n; this.acc = 0; this.ticks = 0;
    if (!this.data) return;
    for (const o of this.list) { this.group.remove(o.headMesh); this.group.remove(o.bodyMesh); }
    this.puffs = [];
    const self = this;
    this.list = this.data.spawns.map(([x, y, z, section]) => {
      const o = {
        section,
        head: { origin: [x, y + 5 + 3, z], offset: [0, 0, 0], pos: [x, y + 8, z], vy: 0, ae: 1, flag8: false, b0: 0,
          alpha: rand(0x2000) - 0x1000, cf: 0, ac: 0, d0: 0, rotZ: 0x8000 },
        body: { pos: [x, y + 3, z], state: 2, timerActive: false, timer: 0, drawn: true, hit: false, u058: 0, scale: 0.1,
          cd: 0, aa: 0, ce: 0 },
      };
      o.bodyMesh = this._mesh('body');
      o.bodyMesh.onBeforeRender = function (renderer, scene, camera) {
        const b = o.body;
        if (b.state < 2 || !b.drawn || !self._place(this, camera, b.pos, b.pos, 0x8000, b.scale, 600)) this.matrixWorld.makeScale(0, 0, 0);
      };
      o.headMesh = this._mesh('head');
      o.headMesh.onBeforeRender = function (renderer, scene, camera) {
        if (o.body.state < 2 || !self._place(this, camera, o.body.pos, o.head.pos, o.head.rotZ, 0.1, 600)) this.matrixWorld.makeScale(0, 0, 0);
      };
      return o;
    });
  }

  // func_80083948
  _head(h) {
    switch (h.ae) {
      case 1: h.flag8 = false; h.ae++; break;   // func_80086FD4
      case 2:   // func_800871AC(20)
        if (!h.flag8) { h.flag8 = true; h.b0 = 20; }
        if (--h.b0 < 0) { h.flag8 = false; h.ae++; }
        break;
      case 3: h.flag8 = false; h.ae = 1; break;   // func_8008701C(1)
      case 10:   // func_80087C48(10, 0.5, 10)
        if (!h.flag8) { h.flag8 = true; h.vy = 10; h.b0 = 10; }
        if (--h.b0 < 0) { h.flag8 = false; h.ae++; }
        else { h.vy = f32(h.vy - 0.5); h.offset[1] = f32(h.offset[1] + h.vy); }
        break;
      case 11:   // func_80087D24(0, 0.2, -7)
        if (!h.flag8) { h.flag8 = true; h.vy = 0; }
        h.vy = f32(h.vy - 0.2); h.offset[1] = f32(h.offset[1] + h.vy);
        if (h.offset[1] <= -7) { h.flag8 = false; h.offset[1] = -7; h.ae++; }
        break;
      case 20:   // f32_step_up_towards(offset y, 0, 0.2)
        if (h.offset[1] < 0) {
          h.offset[1] = f32(h.offset[1] + 0.2);
          if (h.offset[1] >= 0) { h.offset[1] = 0; h.cf = 0; h.flag8 = false; h.ae = 1; }
        }
        break;
    }
    for (let i = 0; i < 3; i++) h.pos[i] = f32(h.origin[i] + h.offset[i]);
    // func_80073D0C(primAlpha, -0x1000, 0x1000, 0x400, 1, -1)
    if (h.cf === 0) { h.ac = 1; h.d0 = -1; h.cf = 1; }
    else if (--h.ac < 0) {
      h.ac = 1;
      if (h.cf === 1) { h.alpha = s16(h.alpha + 0x400); if (h.alpha >= 0x1000) { h.alpha = 0x1000; h.cf++; } }
      else {
        h.alpha = s16(h.alpha - 0x400);
        if (h.alpha <= -0x1000) { h.alpha = -0x1000; if (h.d0 > 0) h.d0--; if (h.d0 !== 0) h.cf = 1; }
      }
    }
    h.rotZ = (h.alpha + 0x8000) & 0xFFFF;
  }

  // set_and_run_timer_object
  _timer(b, t) {
    if (!b.timerActive) { b.timerActive = true; b.timer = t; }
    if (--b.timer < 0) { b.timerActive = false; b.state++; return true; }
    return false;
  }

  // func_80083C04
  _body(b) {
    switch (b.state) {
      case 2: this._timer(b, 150); break;
      case 10: if (this._timer(b, 300)) b.u058 |= 2; break;
      case 11: if (this._timer(b, 10)) { b.drawn = true; b.scale = 0.001; } break;
      case 12:   // func_80074118(sizeScaling, 0.001, 0.1, 0.0025, 0, 0)
        if (b.cd === 0) { b.scale = 0.001; b.aa = 0; b.ce = 0; b.cd = 1; }
        else if (--b.aa < 0) {
          b.aa = 0; b.scale = f32(b.scale + 0.0025);
          if (0.1 < b.scale) {
            if (b.ce > 0) b.ce--;
            if (b.ce === 0) { b.scale = 0.1; b.cd = 0; b.timerActive = false; b.state++; }
            else b.scale = 0.001;
          }
        }
        break;
      case 13: b.timerActive = false; b.state = 2; b.hit = false; break;
    }
  }

  // func_80089B50: every kart touching the body (2 + its boundingBoxSize, x/z only) tumbles; true if any did
  _collide(b, karts) {
    let hit = false;
    for (const k of karts) {
      if (!k?.world || k.boo > 0 || k.tumble || k.out) continue;
      const r = 2 + (BBOX[k.mesh?.userData?.character] ?? 5.5);
      const dx = b.pos[0] - k.world.x / S, dz = b.pos[2] - k.world.z / S;
      if (dx * dx + dz * dz > r * r) continue;
      if (k.star > 0) { if (k.isPlayer) this.audio?.playSound(1, 0x10); }   // 0x19018010
      else this.items?.hit(k, 'fake_item_box');   // VERTICAL_TUMBLE_TRIGGER (trigger_vertical_tumble)
      hit = true;
    }
    return hit;
  }

  // func_800836F0 / func_80083538: D_8018D3BC puffs from the body, evenly spread round
  _burst(pos) {
    const n = this.data.puffsByScreens[Math.min(4, this.screens)] ?? 40;
    for (let i = 0; i < n && this.puffs.length < MAX_PUFFS; i++) {
      const dir = s16(Math.trunc((i << 16) / n));
      this.puffs.push({ origin: [...pos], offset: [0, 0, 0], pos: [...pos], vel: [0, 0, 0], state: 1, flag8: false, b0: 0,
        scale: f32(rand(100) * 0.001 + 0.05), vy: f32(rand(20) * 0.5 + 2.6), speed: f32(rand(10) * 0.1 + 4.5), dir,
        spin: rand(0x4000) + 0x1000, rotZ: 0 });
    }
  }

  // func_8008379C
  _puff(p) {
    if (p.state === 1) {   // func_80087E08(vy, 0.74, speed, dir, 100)
      if (!p.flag8) {
        p.flag8 = true; p.offset = [0, 0, 0]; p.b0 = 100;
        p.vel = [f32(p.speed * Math.sin(p.dir * RAD)) * (this.mirror ? -1 : 1), p.vy, f32(p.speed * Math.cos(p.dir * RAD))];
      }
      if (--p.b0 < 0) { p.flag8 = false; p.state = 2; }
      else { p.vel[1] = f32(p.vel[1] - 0.74); for (let i = 0; i < 3; i++) p.offset[i] = f32(p.offset[i] + p.vel[i]); }
    } else if (p.state === 2) p.state = 0;   // func_80072428
    for (let i = 0; i < 3; i++) p.pos[i] = f32(p.origin[i] + p.offset[i]);
    p.rotZ = (p.rotZ + p.spin) & 0xFFFF;
  }

  // update_snowmen
  _frame(cams, karts) {
    this.puffs.forEach(p => this._puff(p));
    this.puffs = this.puffs.filter(p => p.state !== 0);
    for (const o of this.list) {
      this._head(o.head);
      this._body(o.body);
      const b = o.body;
      if (!b.hit) {
        const near = cams.some(cam => { const s = this.sections.get(cam); return s >= o.section - 1 && s <= o.section + 1; });
        if (near && this._collide(b, karts)) {
          b.hit = true; b.drawn = false; b.timerActive = false; b.state = 10;
          o.head.flag8 = false; o.head.ae = 10;
          this._burst(b.pos);
        }
      } else if (b.u058 & 2) {
        b.u058 &= ~2;
        o.head.flag8 = false; o.head.ae = 20;
      }
    }
  }

  // cams: each screen's camera; karts: every kart
  update(dt, cams = [], karts = []) {
    if (!this.data) return;
    for (const cam of this.sections.keys()) if (!cams.includes(cam)) this.sections.delete(cam);
    for (const cam of cams) this.sections.set(cam, this.trackSections.pathCounter(cam, this.sections.get(cam) ?? 1));
    for (this.acc += dt; this.acc >= TICK; this.acc -= TICK) {
      this.ticks++;
      if (!(this.ticks & 1)) continue;   // objects update once a frame (two 60 Hz ticks)
      this._frame(cams, karts);
    }
  }
}
