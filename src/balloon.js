// Luigi Raceway's hot-air balloon (tools/extract-balloon.py -> public/mk64/luigi-raceway/balloon.json).
// D_80165898: set once a player's lap counter reaches 1 (the HUD lap code), never in time trials; until then the
// balloon is neither updated nor drawn. update_hot_air_balloon (once a frame, every other 60 Hz tick):
// init_hot_air_balloon puts it at origin (-176 x xOrientation, 0, -2323) + offset (0, 300, 0) with velocity y -2,
// then func_80085534 steps its sub-state (sink to offset 18; ease the velocity to 0, wait, ease to +1, rise 90 frames,
// ease to 0, ease to -1, sink 90 frames, ease to 0 and hold 90, back to the wait) and adds the velocity to the offset;
// direction_angle[1] + 0x100 a frame. render_object_hot_air_balloon / func_80055CCC: within 1500 x/z of the camera
// dl_F960 + dl_F650 turned by direction_angle, out to 3000 the low-detail dl_FBE0 + dl_FA20 turned to face the camera
// (and in 1P the spin is reset to 0 while it is far). Lit (F3DEX, d_course_luigi_raceway_light1 in world space), so the
// colours are worked out again as it turns.
// EXTRA: the console mirrors positions only, so the model is flipped back in its own x and turns the other way.
// Not ported: the item box hanging under it (ACTOR_HOT_AIR_BALLOON_ITEM_BOX) and its ground shadow (func_8004A6EC,
// D_0D007B20, within 300).
import * as THREE from 'three';
import { NATIVE_SCALE } from './track.js';
import { partMeshes } from './props.js';

const TICK = 1 / 60;
const S = NATIVE_SCALE;
const RAD = Math.PI / 32768;
const f32 = Math.fround;
const _p = new THREE.Vector3(), _n = new THREE.Vector3(), _m = new THREE.Matrix3(), _q = new THREE.Matrix4(), color = new THREE.Color();

// f32_step_towards
function stepTowards(v, target, step) {
  if (v < target) { v = f32(v + step); if (target <= v) v = target; }
  else if (target < v) { v = f32(v - step); if (v <= target) v = target; }
  return v;
}

export class HotAirBalloon {
  constructor(scene, def, { mirror = false, timeTrial = false } = {}) {
    this.group = new THREE.Group();
    this.group.name = 'hot-air-balloon';
    scene.add(this.group);
    this.mirror = mirror; this.timeTrial = timeTrial;
    this.screens = 1; this.ticks = 0; this.acc = 0;
    // state 0: waiting for D_80165898; 1: init_hot_air_balloon next frame; 2: flying. sub = unk_0AE, flag8 / timer = unk_0B0
    this.obj = { state: 0, sub: 0, flag8: false, timer: 0, offsetY: 0, vy: 0, rotY: 0, pos: [0, 0, 0] };
    this.ready = fetch(`${import.meta.env?.BASE_URL ?? '/'}mk64/${def.dir}/balloon.json`)
      .then(r => (r.ok ? r.json().catch(() => null) : null))   // no file: the dev server answers with index.html
      .then(data => data && this._build(data, def.dir));
  }

  _build(data, dir) {
    this.data = data;
    const textures = {}, near2 = data.nearDistance ** 2, far2 = data.maxDistance ** 2, obj = this.obj, sx = this.mirror ? -S : S;
    this.lit = [];
    const hide = mesh => { const e = mesh.matrixWorld.elements; _p.set(e[12], e[13], e[14]); mesh.matrixWorld.makeScale(0, 0, 0).setPosition(_p); };
    const dist2 = (mesh, camera) => {
      const e = mesh.matrixWorld.elements, c = camera.matrixWorld.elements, dx = (e[12] - c[12]) / S, dz = (e[14] - c[14]) / S;
      return dx * dx + dz * dz;
    };
    const build = (model, parent, onBeforeRender) => {
      for (const [k, { geometry, material }] of partMeshes(model, dir, textures).entries()) {
        const mesh = new THREE.Mesh(geometry, material);
        mesh.onBeforeRender = onBeforeRender;
        parent.add(mesh);
        const verts = model.parts[k].triangles.flat();
        this.lit.push({ mesh, verts: verts.map(([, , , , , r, g, b, , light]) => [r, g, b, light]) });
      }
    };
    // func_8008A1D0 (0x5DC, 0xBB8): the near model under 1500, the far one from 1500 to 3000
    this.near = new THREE.Group();
    this.near.scale.set(sx, S, S);
    build(data.models.near, this.near, function (renderer, scene, camera) {
      const d = dist2(this, camera);
      if (obj.state < 2 || d >= near2) hide(this);
    });
    this.far = new THREE.Group();
    this.far.scale.set(sx, S, S);
    build(data.models.far, this.far, function (renderer, scene, camera) {
      const d = dist2(this, camera);
      if (obj.state < 2 || d < near2 || d > far2) { hide(this); return; }
      // D_80183E80[1] = func_800418AC(pos, camera) + 0x8000: its front (+z) turned to this camera
      const e = this.matrixWorld.elements, c = camera.matrixWorld.elements;
      _p.set(e[12], e[13], e[14]);
      _q.makeRotationY(Math.atan2(c[12] - _p.x, c[14] - _p.z)).scale(_n.set(sx, S, S)).setPosition(_p);
      this.matrixWorld.copy(_q);
    });
    for (const m of [...this.near.children, ...this.far.children]) m.frustumCulled = false;   // matrices set per camera
    this.group.add(this.near, this.far);
    this.lights = data.lights.map(({ ambient, color: c, direction: [x, y, z] }) => {
      const l = Math.hypot(x, y, z) || 1;
      return { ambient, color: c, dir: [(this.mirror ? -x : x) / l, y / l, z / l] };
    });
  }

  // D_80165898 = 1 (not in time trials); init_object(state 1) was done at course load
  trigger() {
    if (this.timeTrial || this.obj.state !== 0) return;
    this.obj.state = 1;
  }

  // func_800871AC / func_80087060: count down `n` frames on unk_0B0 (flag 8 marks a running count)
  _wait(n) {
    const o = this.obj;
    if (!o.flag8) { o.flag8 = true; o.timer = n; }
    o.timer--;
    if (o.timer < 0) { o.flag8 = false; return true; }
    return false;
  }

  _next() { this.obj.flag8 = false; this.obj.sub++; }   // func_80086FD4

  // update_hot_air_balloon
  _frame() {
    const o = this.obj, d = this.data;
    if (o.state === 0) return;
    if (o.state === 1) {   // init_hot_air_balloon
      o.offsetY = d.offsetY; o.vy = d.velocityY; o.sub = 1; o.flag8 = false; o.state = 2;
    }
    switch (o.sub) {   // func_80085534
      case 1: if (o.offsetY <= 18.0) this._next(); break;
      case 2: o.vy = stepTowards(o.vy, 0, 0.05); if (o.vy === 0) this._next(); break;
      case 3: if (this._wait(1)) this._next(); break;
      case 4: o.vy = stepTowards(o.vy, 1, 0.05); if (o.vy === 1) this._next(); break;
      case 5: if (this._wait(90)) this._next(); break;
      case 6: o.vy = stepTowards(o.vy, 0, 0.05); if (o.vy === 0) this._next(); break;
      case 7: o.vy = stepTowards(o.vy, -1, 0.05); if (o.vy === -1) this._next(); break;
      case 8: if (this._wait(90)) this._next(); break;
      case 9: o.vy = stepTowards(o.vy, 0, 0.05); if (this._wait(90)) { o.flag8 = false; o.sub = 3; } break;   // func_8008701C
    }
    o.offsetY = f32(o.offsetY + o.vy);   // object_add_velocity_offset_y
    o.rotY = (o.rotY + d.spinPerFrame) & 0xFFFF;
    o.pos = [d.origin[0], d.origin[1] + o.offsetY, d.origin[2]];   // object_calculate_new_pos_offset
  }

  _place(cam) {
    const o = this.obj;
    this.near.position.set(o.pos[0] * S, o.pos[1] * S, o.pos[2] * S);
    this.far.position.copy(this.near.position);
    this.near.rotation.y = (this.mirror ? -o.rotY : o.rotY) * RAD;
    // the far model's shading follows screen 1's camera (one vertex colour set is shared by every screen)
    this.far.rotation.y = cam ? Math.atan2(cam.position.x - this.far.position.x, cam.position.z - this.far.position.z) : 0;
    this.group.updateMatrixWorld(true);
    // F3DEX: ambient + colour x max(0, n . l) with the normal turned into world space
    for (const { mesh, verts } of this.lit) {
      _m.getNormalMatrix(mesh.matrixWorld);
      const col = mesh.geometry.attributes.color, a = col.array;
      verts.forEach(([nx, ny, nz, li], i) => {
        if (li < 0) return;
        const { ambient, color: lc, dir } = this.lights[li];
        _n.set(nx, ny, nz).applyMatrix3(_m).normalize();
        const d = Math.max(0, _n.x * dir[0] + _n.y * dir[1] + _n.z * dir[2]);
        color.setRGB(...[0, 1, 2].map(k => Math.min(255, Math.round(ambient[k] + lc[k] * d)) / 255), THREE.SRGBColorSpace);
        a[i * 3] = color.r; a[i * 3 + 1] = color.g; a[i * 3 + 2] = color.b;
      });
      col.needsUpdate = true;
    }
  }

  // init_course_objects (D_80165898 = 0, init_object) for a new race on this many screens
  setScreens(n) {
    this.screens = n; this.acc = 0;
    Object.assign(this.obj, { state: 0, sub: 0, flag8: false, timer: 0, offsetY: 0, vy: 0, rotY: 0 });
  }

  // cams: each screen's camera (scene units); laps: whether a player's lap counter has reached 1
  update(dt, cams = [], lapDone = false) {
    if (!this.data) return;
    if (lapDone) this.trigger();
    if (this.obj.state === 0) return;
    for (this.acc += dt; this.acc >= TICK; this.acc -= TICK) {
      this.ticks++;
      if (!(this.ticks & 1)) continue;   // objects update once a frame (two 60 Hz ticks)
      this._frame();
      // func_80055CCC: in 1P the spin is put back to 0 while the balloon is drawn far
      const c = cams[0];
      if (this.screens === 1 && c) {
        const dx = this.obj.pos[0] - c.position.x / S, dz = this.obj.pos[2] - c.position.z / S, d = dx * dx + dz * dz;
        if (d >= this.data.nearDistance ** 2 && d <= this.data.maxDistance ** 2) this.obj.rotY = 0;
      }
    }
    this._place(cams[0]);
  }
}
