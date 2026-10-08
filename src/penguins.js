// Sherbet Land's giant emperor penguin (update_objects.c func_80084430 / func_8008453C, render_objects.c
// render_object_train_penguins penguin 0): the course's penguin armature (tools/extract-penguin.py ->
// public/mk64/sherbet-land/penguin.json) at sizeScaling 0.2 on the ice at (-383, 2, -690), playing animation 0
// (19-frame waddle, one frame per object tick) while it walks spline D_800E659C (func_8008B78C: a B-spline round a
// 20-unit circle, 125 / 10000 of a segment per tick) and turns towards its heading (func_800873F4). The console
// only sets it up in 1P (gPlayerCountSelection1 == 1).
// Penguins 1-14 (func_800845C8, every player count) share the armature: 1-8 at 0.08 swim in pairs round four
// circles in the water at y -80, 9-14 at 0.04 waddle, belly-slide and turn back on the ice, drawing an upside-down
// reflection under themselves when a camera is near.
// update_penguins / func_80089820: penguins 1-14 (box 4) bonk the karts they touch (Kart.bonk, sound 0x1900A046 for
// a human); a kart under a star sends one spinning instead (func_800850B0: 0x96 ticks, + 0x2000 a tick).
// func_80084B7C squawks (flag 0x80): every 90-179 ticks while looping its animation, every 16 while spinning, and as
// a slider drops onto its belly; ice penguins (0x10) play 0x19007049, swimmers 0x19007017, heard from where they are
// (func_800C98B8: volume func_800C1480 by distance, pan func_800C16E8).
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

// func_800845C8 penguins 1-8: pairs swimming opposite each other round a circle at y -80 (func_80088038),
// [x, z, unk_0C6 angle step per tick, unk_01C[1] radius]
const SWIMMERS = [[-2960, 1521, 0x150, 100], [-2490, 1612, 0x100, 80], [-2098, 1624, 0xFF00, 80], [-2080, 1171, 0x150, 80]];
// penguins 9-14 on the ice at y 0 (func_80084D2C): [x, z, unk_0C6, its EXTRA (mirror) adjustment, unk_0DD]
const SLIDERS = [[146, -380, 0x9000, -0x4000, 3], [380, -766, 0x5000, 0x8000, 4], [-2300, -210, 0xC000, 0x8000, 6],
  [-2500, -250, 0x4000, 0x8000, 6], [-535, 875, 0x8000, -0x4000, 6], [-250, 953, 0x9000, -0x4000, 6]];
const SLIDE_SPEED = { 3: 1.0, 4: 1.5, 5: 2.0, 6: 2.5 };
// render_object_train_penguins: 1P / 2P / 3-4P reach of the ice reflection (func_800557B4, squared distance)
const REFLECT_REACH = [0x3D090, 0x27100, 0x15F90];
const sins = a => Math.sin(binary(a)), coss = a => Math.cos(binary(a));
const atan2s = (x, z) => Math.round(Math.atan2(x, z) * 32768 / Math.PI) & 0xFFFF;

// f32_step_towards
function stepTowards(v, target, step) {
  step = Math.abs(step);
  return v < target ? Math.min(target, v + step) : v > target ? Math.max(target, v - step) : v;
}

export class Penguins {
  constructor(scene, track, audio = null) {
    this.scene = scene; this.audio = audio; this.acc = 0; this.data = null; this.mirror = !!track.mirror;
    this.group = new THREE.Group(); this.group.matrixAutoUpdate = false;
    scene.add(this.group);
    const m = track.mirror ? -1 : 1;   // EXTRA flips the camera, so mirrored angles turn the other way here
    // penguin 0 (func_80084430)
    this.big = { origin: [-383, 2, -690], scale: 0.2, anim: 0, frame: 0, dir: 0, pos: [-383, 2, -690],
      spline: { active: false, idx: 0, p: 0, timer: 0 } };
    this.small = [];
    const common = { scale: 0.08, anim: 0, frame: 0, step: 2, state: 2, animOn: false, flags: 0, sub: 1, timerOn: false,
      timer: 0, cc: 0, dir: 0, speed: 0, offset: [0, 0, 0], vel: [0, 0, 0], yaw: 0, spinT: 0, call: 0 };
    for (let i = 1; i <= 8; i++) {
      const [x, z, c6, r] = SWIMMERS[(i - 1) >> 1];
      this.small.push({ ...common, offset: [0, 0, 0], vel: [0, 0, 0], kind: 'swim', origin: [x, -80, z], pos: [x, -80, z],
        c6: (c6 * m) & 0xFFFF, c4: ((i << 15) & 0xFFFF) * m & 0xFFFF, r, flags: 8 });
    }
    for (const [x, z, c6, adj, mode] of SLIDERS) {
      const c = ((track.mirror ? c6 + adj : c6) * m) & 0xFFFF;
      this.small.push({ ...common, offset: [0, 0, 0], vel: [0, 0, 0], kind: 'slide', mode, origin: [x, 0, z], pos: [x, 0, z],
        scale: 0.04, c6: c, dir: (c + 0x8000) & 0xFFFF, flags: 4 | 0x10 });
    }
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
    // one template per model part; every drawn penguin gets its own colour buffer (lit by its own matrix)
    const L = d.lights, templates = new Map();
    for (const step of d.armature) {
      if (step.op !== 'limb' || !step.model) continue;
      templates.set(step, step.model.map(part => {
        const position = new THREE.Float32BufferAttribute(part.positions, 3), uv = new THREE.Float32BufferAttribute(part.uvs, 2);
        // G_CC_SHADE / G_CC_MODULATEI (texel x shade); G_CC_BLENDRGBA lays the 1-bit-alpha texel over the shade
        const blend = part.combine === 'G_CC_BLENDRGBA';
        const mats = [new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: false, fog: false,
          map: part.texture && !blend ? textures[part.texture] : null })];
        if (blend) mats.push(new THREE.MeshBasicMaterial({ map: textures[part.texture], alphaTest: 0.5, toneMapped: false, fog: false,
          polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -2 }));
        const light = L[part.light];
        return { position, uv, mats, normals: part.normals, light, dl: new THREE.Vector3(...light.dir).normalize() };
      }));
    }
    const instance = () => {
      const group = new THREE.Group(); group.matrixAutoUpdate = false;
      this.group.add(group);
      const parts = new Map();
      for (const [step, list] of templates) parts.set(step, list.map(t => {
        const g = new THREE.BufferGeometry();
        g.setAttribute('position', t.position); g.setAttribute('uv', t.uv);
        g.setAttribute('color', new THREE.Float32BufferAttribute(new Float32Array(t.position.array.length), 3));
        const meshes = t.mats.map(mat => {
          const mesh = new THREE.Mesh(g, mat);
          mesh.matrixAutoUpdate = false; mesh.frustumCulled = false;
          group.add(mesh);
          return mesh;
        });
        return { meshes, normals: t.normals, color: g.attributes.color, light: t.light, dl: t.dl };
      }));
      return { group, parts };
    };
    this.big.view = instance();
    for (const o of this.small) {
      o.view = instance();
      // func_800557B4: penguins flagged 4 (the sliders) also draw upside down 1 unit below themselves on the ice
      if (o.flags & 4) o.mirrorView = instance();
    }
    this.placeAll();
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
    const heading = atan2s(vx, vz);   // get_y_direction_angle
    o.dir = turnTowards(o.dir, heading);
  }

  // func_80072E54 with no frame delay: frames a1..a2 by a3; a5 -1 loops, 0 plays once then object_next_state
  animate(o, a1, a2, a3, a5) {
    if (!o.animOn) { o.frame = a1; o.cc = a5; o.animOn = true; return; }
    o.frame += a3;
    if (a2 < o.frame) {
      if (o.cc > 0) o.cc--;
      if (o.cc === 0) { o.frame = a2; o.animOn = false; o.state++; } else o.frame = a1;
    }
  }

  // func_800726CC / func_80086FD4 / func_8008701C / func_80087060
  setState(o, s) { o.state = s; o.animOn = false; }
  nextSub(o, s = o.sub + 1) { o.timerOn = false; o.sub = s; }
  wait(o, n) {
    if (!o.timerOn) { o.timerOn = true; o.timer = n; }
    if (--o.timer < 0) { o.timerOn = false; return true; }
    return false;
  }
  setAnim(o, anim, state) { o.anim = anim; o.frame = 0; o.type = this.data.animations[anim].length - 1; this.setState(o, state); }

  // func_80084B7C: the animation states of penguins 1-14
  animateSmall(o) {
    if (o.type === undefined) o.type = this.data.animations[o.anim].length - 1;
    if (o.state === 2) this.animate(o, 0, o.type, o.step, -1);
    else if (o.state === 3) this.animate(o, 0, o.type, 1, 0);
    else if (o.state === 4) { o.flags &= ~2; o.state = 5; }
  }

  // func_80084D2C: a slider turns round, waddles faster, belly-slides away (anim 1), slows, stands up (anim 2) and
  // heads back the other way
  slide(o) {
    switch (o.sub) {
      case 1:
        o.dir = turnTowards(o.dir, o.c6);
        if (o.dir === o.c6) { o.step = 4; o.speed = 0.4; this.nextSub(o); }
        break;
      case 2:
        o.speed = stepTowards(o.speed, 0.8, 0.02);
        if (this.wait(o, 15)) {
          o.flags |= 1 | 2; o.step = 1; this.setAnim(o, 1, 3); this.nextSub(o);
          if (!(o.flags & 0x20)) o.flags |= 0x80;
        }
        break;
      case 3: {
        const target = SLIDE_SPEED[o.mode];
        o.speed = stepTowards(o.speed, target, 0.15);
        if (!(o.flags & 2) && o.speed === target) this.nextSub(o);
        break;
      }
      case 4:
        if (this.wait(o, 30)) { o.flags &= ~1; this.nextSub(o); }
        break;
      case 5:
        o.speed = stepTowards(o.speed, 0.4, 0.2);
        if (this.wait(o, 10)) { o.flags |= 2; this.setAnim(o, 2, 3); this.nextSub(o); }
        break;
      case 6:
        if (!(o.flags & 2)) { this.setAnim(o, 0, 2); o.c6 = (o.c6 + 0x8000) & 0xFFFF; this.nextSub(o, 1); }
        break;
    }
    // func_8008781C
    o.vel = [o.speed * sins(o.dir), 0, o.speed * coss(o.dir)];
    o.offset[0] += o.vel[0]; o.offset[2] += o.vel[2];
    o.pos = [o.origin[0] + o.offset[0], o.origin[1], o.origin[2] + o.offset[2]];
  }

  // func_8008502C: func_80088038 round the circle, then face the way it swims (func_800873F4)
  swim(o) {
    const [ox, , oz] = o.offset;
    o.c4 = (o.c4 + o.c6) & 0xFFFF;
    o.offset = [sins(o.c4) * o.r, 0, coss(o.c4) * o.r];
    o.vel = [o.offset[0] - ox, 0, o.offset[2] - oz];
    o.pos = [o.origin[0] + o.offset[0], o.origin[1], o.origin[2] + o.offset[2]];
    o.dir = turnTowards(o.dir, atan2s(o.vel[0], o.vel[2]));
  }

  // func_800850B0's tail: a penguin flagged 0x20 spins (0x40 starts its 0x96-tick timer), else faces its direction
  spinStep(o) {
    if (o.flags & 0x20) {
      if (o.flags & 0x40) { o.flags &= ~0x40; o.spinT = 0x96; }
      if (o.spinT === 0) o.flags &= ~0x20;
      else { o.spinT--; o.yaw = (o.yaw + 0x2000) & 0xFFFF; return; }
    }
    o.yaw = o.dir;
  }
  // func_80084B7C's tail: when to squawk
  call(o) {
    if (o.flags & 0x20) {
      if (o.call === 0) { o.flags |= 0x80; o.call = 0x10; } else o.call--;
    } else if (o.state === 2) {
      if (o.call === 0) { o.call = Math.floor(Math.random() * 0x5A) + 0x5A; o.flags |= 0x80; } else o.call--;
    }
  }
  // func_800C98B8 once per screen: XZ distance d from that camera sets the volume (func_800C1480, sound bits
  // & 0x30000 = 0: 400 near, silent past 2000); 1P pans by where it sits across the camera (func_800C16E8), more
  // screens pan each camera hard left / right ((cameraId & 1) * 0x7F)
  squawk(o, cams) {
    if (!(o.flags & 0x80)) return;
    o.flags &= ~0x80;
    const id = o.flags & 0x10 ? 0x49 : 0x17;
    cams.forEach((cam, i) => {
      const x = o.pos[0] - cam.position.x / NATIVE_SCALE, z = o.pos[2] - cam.position.z / NATIVE_SCALE;
      const d = Math.hypot(x, z);
      if (d > 2000) return;
      let vol = d < 400 ? (400 - d) / 400 * 0.5 + 0.5 : (1 - (d - 400) / 1600) * 0.5;
      vol *= vol;
      let pan = (i & 1) * 0x7F;
      if (cams.length === 1) {
        const e = cam.matrixWorld.elements;   // camera right (column 0) and forward (-column 2) on the ground
        const side = (x * e[0] + z * e[2]) * (this.mirror ? -1 : 1), ahead = -(x * e[8] + z * e[10]);
        const ax = Math.min(Math.abs(side), 100), az = Math.min(Math.abs(ahead), 100);
        let p = side === 0 && ahead === 0 ? 0.5 : side >= 0 && az <= ax ? 1 - (200 - ax) / (5 * (200 - az))
          : side < 0 && az <= ax ? (200 - ax) / (5 * (200 - az)) : side / (3.3333333 * az) + 0.5;
        p = Math.min(1, Math.max(0, p));
        pan = Math.floor(p * 127 + 0.5);
      }
      this.audio?.playSound(1, id, vol, pan);
    });
  }
  // func_80089820 (penguin 0 has no 0x200 flag, so only 1-14): a kart within the boxes (has_collided_horizontally_
  // with_player) and not under a boo is bonked, or under a star sets 0x02000000, which starts a spin unless one runs
  collide(o, karts) {
    const [a2, a3] = o.flags & 1 ? [1.75, 1.5] : o.flags & 8 ? [1.3, 1.0] : [1.5, 1.25];
    let star = false;
    for (const k of karts) {
      if (k.remote || k.free || k.boo > 0 || k.rescue || k.out) continue;
      const r = 4 + k.boxSize, dx = o.pos[0] - k.world.x / NATIVE_SCALE, dz = o.pos[2] - k.world.z / NATIVE_SCALE;
      if (dx * dx + dz * dz > r * r) continue;
      if (k.star > 0) { star = true; continue; }
      if (k.bonk(o.pos[0], o.pos[2], o.vel[0], o.vel[2], a2, a3 * 1.1) >= 4 && k.isPlayer) this.audio?.playSound(1, 0x46);
    }
    if (star && !(o.flags & 0x20)) o.flags |= 0x20 | 0x40;
  }
  // cams: each screen's camera (scene units); penguin 0 is only set up in 1P
  update(dt, cams, karts = []) {
    const screens = cams.length;
    for (this.acc += dt; this.acc >= TICK; this.acc -= TICK) {
      const o = this.big;
      this.walk(o);
      // func_80072E54(objectIndex, 0, type = length - 1, 1, 0, -1): one frame per tick, 0..type round
      if (this.data) {
        o.frame = o.frame + 1 > this.data.animations[o.anim].length - 1 ? 0 : o.frame + 1;
        for (const p of this.small) {
          this.animateSmall(p);
          if (p.kind === 'swim') this.swim(p); else this.slide(p);
          this.spinStep(p);
          this.collide(p, karts);
          this.call(p);
          this.squawk(p, cams);
        }
      }
    }
    if (!this.data) return;
    this.big.view.group.visible = screens === 1;
    const reach = REFLECT_REACH[Math.min(screens, 3) - 1];
    for (const p of this.small) if (p.mirrorView) {
      p.mirrorView.group.visible = cams.some(c => (c.position.x / NATIVE_SCALE - p.pos[0]) ** 2 + (c.position.z / NATIVE_SCALE - p.pos[2]) ** 2 <= reach);
    }
    this.placeAll();
  }

  placeAll() {
    this.place(this.big, this.big.view, this.big.pos, [0, this.big.dir, 0]);
    for (const p of this.small) {
      this.place(p, p.view, p.pos, [0, p.yaw, 0]);
      // rsp_set_matrix_transformation_inverted_x_y_orientation at y - 1
      if (p.mirrorView?.group.visible) this.place(p, p.mirrorView, [p.pos[0], p.pos[1] - 1, p.pos[2]], [0x8000, (p.yaw + 0x8000) & 0xFFFF, 0]);
    }
  }

  // render_armature for one penguin at its current animation frame
  place(o, view, pos, rot) {
    const anim = this.data.animations[o.anim], v = anim.values, f = o.frame;
    const channel = ([len, idx]) => v[idx + (f < len ? f : 0)];
    const root = anim.limbs[0].map(channel);
    const stack = [objectMatrix(pos, rot, o.scale, new THREE.Matrix4())];
    let noPop = false, limb = 1, first = true;
    for (const step of this.data.armature) {
      if (step.op === 'stop') break;
      if (step.op === 'nopop') { noPop = true; continue; }
      if (step.op === 'pop') { stack.pop(); continue; }
      if (!noPop) stack.pop();
      const p = first ? step.pos.map((q, i) => q + root[i]) : step.pos;
      first = false;
      const angle = anim.limbs[limb++].map(channel);
      const m = stack[stack.length - 1].clone().multiply(limbMatrix(p, angle, _m));
      stack.push(m);
      noPop = false;
      const parts = view.parts.get(step);
      if (parts) for (const part of parts) this.shade(part, m);
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
