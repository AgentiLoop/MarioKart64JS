// Rainbow Road's Chain Chomps (tools/extract-chomp.py -> public/mk64/rainbow-road/chomp.json).
// init_course_objects (not in the credits) starts NUM_CHAIN_CHOMPS (3); update_chain_chomps, once a frame (every other
// 60 Hz tick):
// - func_80085878 (state 1): chomp i on track path 0's point i * 300 + 500, origin (0, -15, 0), scale 0.03;
// - state 2 steps its 20-frame animation one frame a frame (func_80072E54(0, length - 1, 1, 0, -1));
// - every 64th frame (D_8018D40C == 0) it rattles (0x19018057, func_800C98B8 from where it is);
// - func_80074344 swings its lateral factor (surfaceHeight) -0.8 .. 0.8 .. -0.8 by 0.03 a frame;
// - func_8000D940 moves it 4 units at the mean of set_track_offset_position at path points - 3 and - 4 past the nearest
//   (update_path_index, adjust_path_at_start_line): it bounds along against the karts, weaving across the road;
//   it faces the way it moved (get_xz_angle_between_points);
// - func_80089CBC(30): a kart within 10 + its box (x/z) and 30 (y), not under a boo or tumbling, tumbles
//   (VERTICAL_TUMBLE_TRIGGER); a star kart drives through.
// render_object_chain_chomps / func_8008A1D0(1500, 2500), per screen: hidden past 2500 (x/z) or outside the view wedge
// (0x5555 / 0x4000 / 0x2AAB by distance); within 1500 the armature (render_animated_model: body halves and jaws are
// G_TEXTURE_GEN reflection maps, the tongue vertex-coloured, the eyes lit by light1), beyond it the sphere picture
// (func_800468E0: 64x64 at 0.54, 16 up, turned to the camera, rolled 0x8000).
// G_TEXTURE_GEN: the game never sets gSPLookAt, so the RSP's lookat X (1, 0, 0) and Y (0, 1, 0) are taken as is
// (assumption: the HLE default) and dotted with the world-space normal (the object matrix is the modelview):
// s = (n.x + 1) / 2 * 31, t = (n.y + 1) / 2 * 31 texels (gSPTexture 0x07C0).
// EXTRA: the console runs the mirrored path; here the unmirrored path is run with the lateral factor negated (as
// src/traffic.js) and each model is flipped back in its own x; texgen uses the console's (mirrored) normal x.
// Not ported: the time-trial replay flag (func_80072180).
import * as THREE from 'three';
import * as HD from './hd.js';
import { NATIVE_SCALE } from './track.js';
import { inWedge } from './thwomp.js';
import { quadGeometry } from './snowmen.js';
import { objectMatrix, limbMatrix, placedSound } from './penguins.js';

const TICK = 1 / 60;
const S = NATIVE_SCALE;
const RAD = Math.PI / 32768;
const f32 = Math.fround;
const s16 = v => ((v & 0xFFFF) ^ 0x8000) - 0x8000;
const atan2s = (x, z) => s16(Math.round(Math.atan2(x, z) / RAD));
const BBOX = { donkeykong: 6, bowser: 6 };   // gKartBoundingBoxSizeTable: 5.5, DK and Bowser 6
const HIDDEN = 0, NEAR = 1, FAR = 2;
const _m = new THREE.Matrix4(), _n = new THREE.Matrix3(), _v = new THREE.Vector3(), _c = new THREE.Color();
const _q = new THREE.Quaternion(), _s = new THREE.Vector3(), _e = new THREE.Euler();
const FLIP = new THREE.Matrix4().makeScale(-1, 1, 1);

export class Chomps {
  constructor(scene, track, def, { mirror = false, items = null, audio = null } = {}) {
    this.group = new THREE.Group();
    this.group.name = 'chomps';
    scene.add(this.group);
    this.mirror = mirror; this.items = items; this.audio = audio;
    this.path = track.def.native.path;
    this.ticks = 0; this.acc = 0; this.frame = 0; this.list = [];
    this.ready = fetch(`${import.meta.env?.BASE_URL ?? '/'}mk64/${def.dir}/chomp.json`)
      .then(r => (r.ok ? r.json().catch(() => null) : null))   // no file: the dev server answers with index.html
      .then(data => data && this._build(data, def.dir));
  }

  _texture(dir, image, wrap) {
    const t = HD.loadTexture(`${dir}/${image}`, { mipmaps: false });
    t.colorSpace = THREE.SRGBColorSpace; t.flipY = false;
    t.wrapS = t.wrapT = wrap;
    return t;
  }

  _build(data, dir) {
    this.data = data;
    const P = this.path, N = P.length, w = data.maxSeparation;
    // calculate_track_boundaries (posX / posZ stored as s16: truncated)
    this.left = []; this.right = [];
    for (let i = 0; i < N; i++) {
      const [x1, , z1] = P[i], [x2, , z2] = P[(i + 1) % N], dx = x2 - x1, dz = z2 - z1, d = Math.hypot(dx, dz);
      this.left.push([Math.trunc(w * dz / d + x1), Math.trunc(w * -dx / d + z1)]);
      this.right.push([Math.trunc(w * -dz / d + x1), Math.trunc(w * dx / d + z1)]);
    }
    const textures = {};
    const tex = (image, wrap) => (textures[image] ??= this._texture(dir, image, wrap));
    this.templates = new Map();
    for (const step of data.armature) {
      if (step.op !== 'limb' || !step.model) continue;
      this.templates.set(step, step.model.map(part => {
        const position = new THREE.Float32BufferAttribute(part.positions, 3);
        let material, colors = null;
        if (part.kind === 'reflect') {   // G_CC_DECALRGB, G_TX_WRAP
          material = new THREE.MeshBasicMaterial({ map: tex(part.texture, THREE.RepeatWrapping), toneMapped: false, fog: false });
        } else if (part.kind === 'colour') {   // G_CC_MODULATEI, G_LIGHTING off: texel x vertex colour
          material = new THREE.MeshBasicMaterial({ map: tex(part.texture, THREE.RepeatWrapping), vertexColors: true, toneMapped: false, fog: false });
          colors = new Float32Array(part.colors.length);
          for (let i = 0; i < colors.length; i += 3) {
            _c.setRGB(part.colors[i] / 255, part.colors[i + 1] / 255, part.colors[i + 2] / 255, THREE.SRGBColorSpace);
            colors[i] = _c.r; colors[i + 1] = _c.g; colors[i + 2] = _c.b;
          }
        } else {   // the eyes: G_CC_MODULATEIA lit, G_TX_CLAMP, G_RM_AA_ZB_TEX_EDGE
          material = new THREE.MeshBasicMaterial({ map: tex(part.texture, THREE.ClampToEdgeWrapping), vertexColors: true, alphaTest: 0.5, toneMapped: false, fog: false });
        }
        const light = part.light ? data.lights[part.light] : null;
        const dl = light ? new THREE.Vector3(...light.dir).normalize() : null;
        if (dl && this.mirror) dl.x = -dl.x;   // the console's light is in its mirrored world
        return { kind: part.kind, position, uvs: part.uvs, normals: part.normals, colors, material, light, dl };
      }));
    }
    const sphere = data.sphere;
    this.sphereGeometry = quadGeometry(sphere.quad, 64);
    this.sphereMaterial = new THREE.MeshBasicMaterial({ map: this._texture(dir, sphere.image, THREE.ClampToEdgeWrapping),
      alphaTest: 0.5, side: THREE.DoubleSide, toneMapped: false, fog: false });   // D_0D0079C8: G_CC_DECALRGBA, TEX_EDGE
    this.reset();
  }

  _instance(c) {
    const self = this, parts = new Map(), meshes = [];
    const near = function (renderer, scene, camera) {
      if (self._view(c, camera) === NEAR) this.matrixWorld.copy(this.matrix); else this.matrixWorld.makeScale(0, 0, 0);
    };
    for (const [step, list] of this.templates) parts.set(step, list.map(t => {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', t.position);
      g.setAttribute('uv', new THREE.Float32BufferAttribute(Float32Array.from(t.uvs), 2));
      if (t.kind === 'colour') g.setAttribute('color', new THREE.Float32BufferAttribute(t.colors, 3));
      if (t.kind === 'lit') g.setAttribute('color', new THREE.Float32BufferAttribute(new Float32Array(t.position.array.length), 3));
      const mesh = new THREE.Mesh(g, t.material);
      mesh.matrixAutoUpdate = false; mesh.frustumCulled = false;
      mesh.onBeforeRender = near;
      this.group.add(mesh); meshes.push(mesh);
      return { mesh, t, uv: g.attributes.uv, color: g.attributes.color };
    }));
    const sphere = new THREE.Mesh(this.sphereGeometry, this.sphereMaterial);
    sphere.matrixAutoUpdate = false; sphere.frustumCulled = false;
    sphere.onBeforeRender = function (renderer, scene, camera) {
      if (self._view(c, camera) === FAR) self._sphere(this, c, camera); else this.matrixWorld.makeScale(0, 0, 0);
    };
    this.group.add(sphere); meshes.push(sphere);
    c.parts = parts; c.meshes = meshes;
  }

  // init_course_objects for a new race (state 1: func_80085878 runs on the first update)
  reset() {
    this.acc = 0; this.ticks = 0; this.frame = 0;
    if (!this.data) return;
    for (const c of this.list) for (const m of c.meshes) this.group.remove(m);
    this.list = Array.from({ length: this.data.count }, (_, i) => {
      const c = { i, state: 1, idx: 0, offset: [0, 0, 0], pos: [0, 0, 0], yaw: 0, frame: 0, animOn: false, cd: 0, side: 0 };
      this._instance(c);
      return c;
    });
  }

  // func_8008A1D0(1500, 2500) for this camera
  _view(c, camera) {
    if (c.state < 2) return HIDDEN;
    const e = camera.matrixWorld.elements, dx = c.pos[0] - e[12] / S, dz = c.pos[2] - e[14] / S, d2 = dx * dx + dz * dz;
    if (!inWedge(c.pos, camera, d2 < 10001 ? 0x5555 : d2 < 40001 ? 0x4000 : 0x2AAB) || d2 > this.data.far ** 2) return HIDDEN;
    return d2 >= this.data.near ** 2 ? FAR : NEAR;
  }

  // func_800468E0: the sphere 16 up, turned to the camera (func_800418AC), rolled 0x8000, at 0.54
  _sphere(mesh, c, camera) {
    const e = camera.matrixWorld.elements, dx = c.pos[0] - e[12] / S, dz = c.pos[2] - e[14] / S, sp = this.data.sphere;
    const m = this.mirror ? -1 : 1;
    _q.setFromEuler(_e.set(0, Math.atan2(dx, dz), m * sp.roll * RAD, 'YXZ'));
    mesh.matrixWorld.compose(_v.set(c.pos[0] * S, (c.pos[1] + sp.up) * S, c.pos[2] * S), _q, _s.set(m * sp.scale * S, sp.scale * S, sp.scale * S));
  }

  // set_track_offset_position: between the left and right edges at points i and i + 1
  _offset(i, factor) {
    const N = this.path.length, j = (i + 1) % N, L = this.left, R = this.right;
    const a = 0.5 - (this.mirror ? -factor : factor) / 2, b = 1 - a;
    return [a * (L[i][0] + L[j][0]) / 2 + b * (R[i][0] + R[j][0]) / 2, a * (L[i][1] + L[j][1]) / 2 + b * (R[i][1] + R[j][1]) / 2];
  }

  // update_path_index (+ the nearest point overall when none is within 400) and adjust_path_at_start_line
  _nearest(c) {
    const P = this.path, N = P.length, [x, y, z] = c.offset;
    let best = 160000, bi = -1;
    for (let r = c.idx - 3; r < c.idx + 7; r++) {
      const k = (r + N) % N, dx = P[k][0] - x, dy = P[k][1] - y, dz = P[k][2] - z, d = dx * dx + dy * dy + dz * dz;
      if (d < best) { best = d; bi = k; }
    }
    if (bi < 0) {   // func_8000D24C picks the nearest point of the track section; the nearest overall here
      best = Infinity;
      P.forEach((p, k) => {
        const d = (p[0] - x) ** 2 + (p[1] - y) ** 2 + (p[2] - z) ** 2;
        if (d < best) { best = d; bi = k; }
      });
    }
    const startZ = P[0][2];
    if (bi === 0 && startZ < z) bi = N - 1;
    else if (bi + 1 === N && z <= startZ) bi = 0;
    return bi;
  }

  // func_8000D940: `speed` units towards the mean of points - 3 and - 4 at lateral factor `factor`
  _step(c, speed, factor) {
    const P = this.path, N = P.length, [x, y, z] = c.offset;
    c.idx = this._nearest(c);
    const p1 = (c.idx + N - 3) % N, p2 = (c.idx + N - 4) % N;
    const [ax, az] = this._offset(p1, factor), [bx, bz] = this._offset(p2, factor);
    const dx = (ax + bx) * 0.5 - x, dy = (P[p1][1] + P[p2][1]) * 0.5 - y, dz = (az + bz) * 0.5 - z;
    const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (d > 0.01) c.offset = [f32(x + dx * speed / d), f32(y + dy * speed / d), f32(z + dz * speed / d)];
  }

  // func_80089CBC(30)
  _collide(c, karts) {
    const box = this.data.box, h = this.data.hitHeight;
    for (const k of karts) {
      if (!k?.world || k.boo > 0 || k.tumble || k.out) continue;
      const r = box + (BBOX[k.mesh?.userData?.character] ?? 5.5);
      const dx = c.pos[0] - k.world.x / S, dz = c.pos[2] - k.world.z / S, dy = c.pos[1] - k.world.y / S;
      if (dx * dx + dz * dz > r * r || Math.abs(dy) > h) continue;
      if (!(k.star > 0)) this.items?.hit(k, 'fake_item_box');   // VERTICAL_TUMBLE_TRIGGER (trigger_vertical_tumble)
    }
  }

  // update_chain_chomps
  _frame(cams, karts) {
    const d = this.data, type = d.animation.length - 1, P = this.path;
    this.frame++;
    for (const c of this.list) {
      if (c.state === 1) {   // func_80085878
        c.idx = c.i * d.pointStep + d.firstPoint;
        c.offset = P[c.idx].slice(0, 3).map(f32);
        c.yaw = 0; c.state = 2;
      } else if (!c.animOn) { c.frame = 0; c.animOn = true; }   // func_80072E54(0, type, 1, 0, -1)
      else if (++c.frame > type) c.frame = 0;
      if ((this.frame & 0x3F) === 0) placedSound(this.audio, cams, c.pos, d.sound[0], d.sound[1], this.mirror, 500);   // 0x19018057
      const [lo, hi, step] = d.weave;   // func_80074344(surfaceHeight, -0.8, 0.8, 0.03, 0, -1)
      if (c.cd === 0) { c.side = f32(lo); c.cd = 1; }
      else if (c.cd === 1) { c.side = f32(c.side + f32(step)); if (f32(hi) <= c.side) { c.side = f32(hi); c.cd = 2; } }
      else { c.side = f32(c.side - f32(step)); if (c.side <= f32(lo)) { c.side = f32(lo); c.cd = 1; } }
      const [ox, , oz] = c.offset;
      this._step(c, d.speed, c.side);
      c.yaw = atan2s(c.offset[0] - ox, c.offset[2] - oz);
      c.pos = c.offset.map((v, i) => f32(d.origin[i] + v));
      this._collide(c, karts);
    }
  }

  // render_armature for one chomp at its animation frame: limb matrices, texgen UVs and eye shading
  _place(c) {
    const anim = this.data.animation, v = anim.values, f = c.frame;
    const channel = ([len, idx]) => v[idx + (f < len ? f : 0)];
    const root = anim.limbs[0].map(channel);
    const base = objectMatrix(c.pos, [0, c.yaw, 0], this.data.scale, new THREE.Matrix4());
    if (this.mirror) base.multiply(FLIP);
    const stack = [base], sx = this.mirror ? -1 : 1;
    let noPop = false, limb = 1, first = true;
    for (const step of this.data.armature) {
      if (step.op === 'stop') break;
      if (step.op === 'nopop') { noPop = true; continue; }
      if (step.op === 'pop') { stack.pop(); continue; }
      if (!noPop) stack.pop();
      const p = first ? step.pos.map((q, i) => q + root[i]) : step.pos;
      first = false;
      const m = stack[stack.length - 1].clone().multiply(limbMatrix(p, anim.limbs[limb++].map(channel), _m));
      stack.push(m);
      noPop = false;
      const parts = c.parts.get(step);
      if (!parts) continue;
      _n.getNormalMatrix(m);
      for (const { mesh, t, uv, color } of parts) {
        mesh.matrix.copy(m);
        const nr = t.normals;
        if (t.kind === 'reflect') {
          const a = uv.array;
          for (let i = 0, j = 0; i < nr.length; i += 3, j += 2) {
            _v.set(nr[i], nr[i + 1], nr[i + 2]).applyMatrix3(_n).normalize();
            a[j] = (sx * _v.x + 1) / 2 * 31 / 32; a[j + 1] = (_v.y + 1) / 2 * 31 / 32;
          }
          uv.needsUpdate = true;
        } else if (t.kind === 'lit') {
          const a = color.array, L = t.light;
          for (let i = 0; i < nr.length; i += 3) {
            _v.set(nr[i], nr[i + 1], nr[i + 2]).applyMatrix3(_n).normalize();
            const d = Math.max(0, _v.dot(t.dl));
            _c.setRGB(...[0, 1, 2].map(k => Math.min(255, L.ambient[k] + L.color[k] * d) / 255), THREE.SRGBColorSpace);
            a[i] = _c.r; a[i + 1] = _c.g; a[i + 2] = _c.b;
          }
          color.needsUpdate = true;
        }
      }
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
    for (const c of this.list) if (c.state >= 2) this._place(c);
  }
}
