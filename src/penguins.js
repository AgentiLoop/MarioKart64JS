// Sherbet Land's giant emperor penguin (update_objects.c func_80084430 / func_8008453C, render_objects.c
// render_object_train_penguins penguin 0): the course's penguin armature (tools/extract-penguin.py ->
// public/mk64/sherbet-land/penguin.json) at sizeScaling 0.2 on the ice at (-383, 2, -690), playing animation 0
// (19-frame waddle, one frame per object tick) while it walks spline D_800E659C (func_8008B78C: a B-spline round a
// 20-unit circle, 125 / 10000 of a segment per tick) and turns towards its heading (func_800873F4). The console
// only sets it up in 1P (gPlayerCountSelection1 == 1).
// Model: src/animation.c render_armature / mtxf_translate_rotate2 per limb under the object's
// mtxf_set_matrix_transformation, each limb lit like F3DEX (ambient + colour x max(0, n . dir), dir (40, 40, 40)
// in world space because MK64 loads the object matrix straight into the modelview).
import * as THREE from 'three';
import * as HD from './hd.js';
import { NATIVE_SCALE } from './track.js';

const TICK = 1 / 60;
const binary = a => a * Math.PI / 32768;
// D_800E659C: 24 control points (x, z; y 0), every velocity 0x50
const SPLINE = [[-20, 0], [-14, -14], [0, -20], [14, -14], [20, 0], [14, 14], [0, 20], [-14, 14]];
const SPLINE_POINTS = 24, SPLINE_SPEED = 0x50;

// N64 row-vector Mat4 (dest[row][col]) -> three.js column-vector matrix
function n64(m, out) {
  return out.set(m[0][0], m[1][0], m[2][0], m[3][0], m[0][1], m[1][1], m[2][1], m[3][1],
    m[0][2], m[1][2], m[2][2], m[3][2], 0, 0, 0, 1);
}

// mtxf_translate_rotate2
function limbMatrix(pos, angle, out) {
  const sx = Math.sin(binary(angle[0])), cx = Math.cos(binary(angle[0]));
  const sy = Math.sin(binary(angle[1])), cy = Math.cos(binary(angle[1]));
  const sz = Math.sin(binary(angle[2])), cz = Math.cos(binary(angle[2]));
  return n64([
    [cy * cz, cy * sz, -sy, 0],
    [sx * sy * cz - cx * sz, sx * sy * sz + cx * cz, sx * cy, 0],
    [cx * sy * cz + sx * sz, cx * sy * sz - sx * cz, cx * cy, 0],
    [pos[0], pos[1], pos[2], 1]], out);
}

// mtxf_set_matrix_transformation, then course units -> scene units
function objectMatrix(pos, rot, scale, out) {
  const sX = Math.sin(binary(rot[0])), cX = Math.cos(binary(rot[0]));
  const sY = Math.sin(binary(rot[1])), cY = Math.cos(binary(rot[1]));
  const sZ = Math.sin(binary(rot[2])), cZ = Math.cos(binary(rot[2]));
  const s = scale * NATIVE_SCALE, t = NATIVE_SCALE;
  return n64([
    [(cY * cZ + sX * sY * sZ) * s, cX * sZ * s, (-sY * cZ + sX * cY * sZ) * s, 0],
    [(-cY * sZ + sX * sY * cZ) * s, cX * cZ * s, (sY * sZ + sX * cY * cZ) * s, 0],
    [cX * sY * s, -sX * s, cX * cY * s, 0],
    [pos[0] * t, pos[1] * t, pos[2] * t, 1]], out);
}

// func_800417B4: turn angle1 towards angle2 in steps
function turnTowards(a1, a2) {
  if ((a1 >> 8) === (a2 >> 8)) return a2;
  const d = (a2 - a1) & 0xFFFF;
  const step = d < 0x400 ? 0x80 : d < 0x800 ? 0x200 : d < 0x4000 ? 0x400 : d < 0x8000 ? 0x700
    : d < 0xC000 ? -0x700 : d < 0xF800 ? -0x400 : d < 0xFC00 ? -0x200 : -0x80;
  return (a1 + step) & 0xFFFF;
}

// func_8008ACE0 / func_8008ADD0: uniform cubic B-spline basis and its derivative
const basis = t => [(1 - t) ** 3 / 6, t * t * t * 0.5 - t * t + 2 / 3, t * t * t * -0.5 + 0.5 * t * t + 0.5 * t + 1 / 6, t * t * t / 6];
const dbasis = t => [(1 - t) * -0.5 * (1 - t), t * t * 1.5 - 2 * t, (t * t * 3 - 2 * t - 1) * -0.5, t * t * 0.5];

const _m = new THREE.Matrix4(), _n = new THREE.Matrix3(), _v = new THREE.Vector3(), _c = new THREE.Color();

export class Penguins {
  constructor(scene, track) {
    this.scene = scene; this.acc = 0; this.data = null; this.limbs = []; this.visible = true;
    this.group = new THREE.Group(); this.group.matrixAutoUpdate = false;
    scene.add(this.group);
    // penguin 0 (func_80084430)
    this.big = { origin: [-383, 2, -690], scale: 0.2, anim: 0, frame: 0, dir: 0, pos: [-383, 2, -690],
      spline: { active: false, idx: 0, p: 0, timer: 0 } };
    const base = `${import.meta.env?.BASE_URL ?? '/'}mk64/${track.def.dir}/`;
    fetch(`${base}penguin.json`).then(r => r.json()).then(d => this.build(d, track.def.dir)).catch(() => {});
  }

  build(d, dir) {
    this.data = d;
    const textures = {};
    for (const [key, file] of Object.entries(d.textures)) {
      const t = textures[key] = HD.loadTexture(`${dir}/${file}`, { mipmaps: false });
      t.colorSpace = THREE.SRGBColorSpace; t.flipY = false;
      t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
    }
    const L = d.lights;
    for (const step of d.armature) {
      if (step.op !== 'limb' || !step.model) continue;
      for (const part of step.model) {
        const g = new THREE.BufferGeometry();
        g.setAttribute('position', new THREE.Float32BufferAttribute(part.positions, 3));
        g.setAttribute('uv', new THREE.Float32BufferAttribute(part.uvs, 2));
        g.setAttribute('color', new THREE.Float32BufferAttribute(new Float32Array(part.positions.length), 3));
        const light = L[part.light], dl = new THREE.Vector3(...light.dir).normalize();
        const add = mat => {
          const m = new THREE.Mesh(g, mat);
          m.matrixAutoUpdate = false; m.frustumCulled = false;
          this.group.add(m);
          return m;
        };
        // G_CC_SHADE / G_CC_MODULATEI (texel x shade); G_CC_BLENDRGBA lays the 1-bit-alpha texel over the shade
        const blend = part.combine === 'G_CC_BLENDRGBA';
        const meshes = [add(new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: false, fog: false,
          map: part.texture && !blend ? textures[part.texture] : null }))];
        if (blend) meshes.push(add(new THREE.MeshBasicMaterial({ map: textures[part.texture], alphaTest: 0.5, toneMapped: false, fog: false,
          polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -2 })));
        step.parts = step.parts || [];
        step.parts.push({ meshes, normals: part.normals, color: g.attributes.color, light, dl });
      }
    }
    this.place();
  }

  // func_8008B78C -> func_8008B6A4 (the wrapping spline walk) and func_800873F4
  walk(o) {
    const s = o.spline;
    if (!s.active) { s.idx = 0; s.timer = 0; s.p = 0; s.active = true; }
    // func_8008B284: four control points from p, wrapping to the first after the last
    const n = SPLINE_POINTS, wrap = n - 4 >= s.idx ? 4 : s.idx + 3 === n ? 2 : s.idx + 2 === n ? 1 : 0;
    const pts = [];
    for (let i = 0, p = s.p; i < 4; i++) { pts.push(SPLINE[p % SPLINE.length]); p = i === wrap ? 0 : p + 1; }
    const t = s.timer / 10000, b = basis(t), db = dbasis(t);
    let x = 0, z = 0, vx = 0, vz = 0;
    for (let i = 0; i < 4; i++) { x += b[i] * pts[i][0]; z += b[i] * pts[i][1]; vx += db[i] * pts[i][0]; vz += db[i] * pts[i][1]; }
    s.timer += Math.trunc(10000 / SPLINE_SPEED);
    if (s.timer >= 10000) {
      s.idx++;
      if (s.idx === n) s.active = false; else { s.p++; s.timer = 0; }
    }
    o.pos = [o.origin[0] + x, o.origin[1], o.origin[2] + z];
    const heading = Math.round(Math.atan2(vx, vz) * 32768 / Math.PI) & 0xFFFF;   // get_y_direction_angle
    o.dir = turnTowards(o.dir, heading);
  }

  update(dt, screens) {
    this.group.visible = screens === 1;
    for (this.acc += dt; this.acc >= TICK; this.acc -= TICK) {
      const o = this.big;
      this.walk(o);
      // func_80072E54(objectIndex, 0, type = length - 1, 1, 0, -1): one frame per tick, 0..type round
      if (this.data) o.frame = o.frame + 1 > this.data.animations[o.anim].length - 1 ? 0 : o.frame + 1;
    }
    this.place();
  }

  // render_armature for penguin 0 at its current frame
  place() {
    if (!this.data) return;
    const o = this.big, anim = this.data.animations[o.anim], v = anim.values, f = o.frame;
    const channel = ([len, idx]) => v[idx + (f < len ? f : 0)];
    const root = anim.limbs[0].map(channel);
    const stack = [objectMatrix(o.pos, [0, o.dir, 0], o.scale, new THREE.Matrix4())];
    let noPop = false, limb = 1, first = true;
    for (const step of this.data.armature) {
      if (step.op === 'stop') break;
      if (step.op === 'nopop') { noPop = true; continue; }
      if (step.op === 'pop') { stack.pop(); continue; }
      if (!noPop) stack.pop();
      const pos = first ? step.pos.map((p, i) => p + root[i]) : step.pos;
      first = false;
      const angle = anim.limbs[limb++].map(channel);
      const m = stack[stack.length - 1].clone().multiply(limbMatrix(pos, angle, _m));
      stack.push(m);
      noPop = false;
      if (step.parts) for (const part of step.parts) this.shade(part, m);
    }
  }

  shade(part, m) {
    for (const mesh of part.meshes) mesh.matrix.copy(m);
    _n.getNormalMatrix(m);
    const { normals: nr, color, light, dl } = part, a = color.array;
    for (let i = 0; i < nr.length; i += 3) {
      _v.set(nr[i], nr[i + 1], nr[i + 2]).applyMatrix3(_n).normalize();
      const d = Math.max(0, _v.dot(dl));
      _c.setRGB(...[0, 1, 2].map(c => Math.min(255, light.ambient[c] + light.color[c] * d) / 255), THREE.SRGBColorSpace);
      a[i] = _c.r; a[i + 1] = _c.g; a[i + 2] = _c.b;
    }
    color.needsUpdate = true;
  }
}
