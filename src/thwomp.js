// Bowser's Castle Thwomps (tools/extract-thwomp.py -> public/mk64/bowsers-castle/thwomp.json).
// init_course_objects places gThomwpSpawns50CC / gThwompSpawns100CCExtra / gThomwpSpawns150CC (8 / 11 / 12 by cc);
// func_80081210 (once a frame = every other 60 Hz tick) runs each one by its behaviour (unk_0D5):
// 1 func_8007ED6C: waits 60 frames, slams, turns round (0x8000) when a player comes within 300 in front of the camera;
// 2 func_8007F5A8: walks a square (x 200, z -100 / +100 by variant), slamming at each corner;
// 3 func_8007FFC0: chases a human player through the corridor (nearest path point 170-180: alongside at 1.25 x their
//   speed, weaving in z; 215-225: steps to their x) and slams;
// 4 func_800801FC: slams every 60 frames after a staggered first wait (2 / 60 / 120 / 180);
// 5 func_800808CC: floats 70 up, sliding 250 in z and back (1 / 1.5 a frame), face animating;
// 6 func_80080408: the big one (x 1.5), pulls faces 6 times when a screen comes within 100 of it.
// The slam (func_8007E63C 0x32-0x36): rise 1.5 a frame to unk_01C[1] + 15, drop 2 a frame to the floor, faces 3 / 2,
// then climb back at 0.5. The CI8 face frame is the object's textureListIndex.
// render_object_thwomps: drawn while the screen's track section is within one of unk_0DF and the Thwomp is in the
// camera's 180-degree view wedge; lit (F3DEX) by type: 0 D_800E4638 with its direction turned every frame
// (func_800419F8: (0, 0, 120) by D_80165834, + 0x100 / + 0x200 a frame), 1 D_800E4650 (yellow), 2 D_800E4668.
// EXTRA: the console mirrors every spawn, angle and step (xOrientation), so the port runs the unmirrored behaviour and
// flips each model back in its own x (the light's x is negated, as the ferry's).
// Not ported: squashing karts (func_80080B28, THWOMP_SQUISH_TRIGGER, the 0x64-0x6C / 0xC8 states), the slam's dust
// (func_80080FEC), camera shake (func_8001CA10), kart tyre effects (func_80080A14) and the ground shadow
// (func_8004A7AC, D_0D007B20).
import * as THREE from 'three';
import { NATIVE_SCALE } from './track.js';
import * as HD from './hd.js';
import { partMeshes } from './props.js';
import { placedSound } from './penguins.js';
import { TrackSections } from './sections.js';
import { speedKmh } from './kart.js';

const TICK = 1 / 60;
const S = NATIVE_SCALE;
const RAD = Math.PI / 32768;
const VISIBLE = 0x40000;
const f32 = Math.fround;
const u16 = a => a & 0xFFFF;
const atan2s = (x, z) => Math.round(Math.atan2(x, z) / RAD) & 0xFFFF;
const _p = new THREE.Vector3(), _n = new THREE.Vector3(), _m = new THREE.Matrix3(), color = new THREE.Color();

// math_util_2.c steps (single precision): each returns 1 only on the step that reaches the target
function stepUp(o, k, target, step) {
  if (o[k] < target) { o[k] = f32(o[k] + step); if (target <= o[k]) { o[k] = target; return true; } }
  return false;
}
function stepDown(o, k, target, step) {
  if (target < o[k]) { o[k] = f32(o[k] - step); if (o[k] <= target) { o[k] = target; return true; } }
  return false;
}
function stepTowards(o, k, target, step) {
  step = Math.abs(step);
  if (o[k] < target) { o[k] = f32(o[k] + step); if (target <= o[k]) { o[k] = target; return true; } }
  else if (target < o[k]) { o[k] = f32(o[k] - step); if (o[k] <= target) { o[k] = target; return true; } }
  return false;
}
// func_800417B4: turn angle1 towards angle2 in coarse steps
function turnTowards(a1, a2) {
  if ((a1 >> 8) === (a2 >> 8)) return a2;
  const d = u16(a2 - a1);
  const step = d < 0x400 ? 0x80 : d < 0x800 ? 0x200 : d < 0x4000 ? 0x400 : d < 0x8000 ? 0x700
    : d < 0xC000 ? -0x700 : d < 0xF800 ? -0x400 : d < 0xFC00 ? -0x200 : -0x80;
  return u16(a1 + step);
}

// the camera's yaw (camera->rot[1]): atan2s of its forward direction on the ground
const camYaw = cam => { const e = cam.matrixWorld.elements; return atan2s(-e[8], -e[10]); };
// is_object_visible_on_camera
export function inWedge(pos, cam, angle) {
  const e = cam.matrixWorld.elements;
  return u16(atan2s(pos[0] - e[12] / S, pos[2] - e[14] / S) + (angle >> 1) - camYaw(cam)) <= angle;
}

export class Thwomps {
  constructor(scene, def, { mirror = false, cc = 2, audio = null } = {}) {
    this.group = new THREE.Group();
    this.group.name = 'thwomps';
    scene.add(this.group);
    this.mirror = mirror; this.audio = audio; this.dir = def.dir;
    this.ccKey = ['50', '100', '150', '100'][cc] ?? '150';   // CC_EXTRA uses the 100cc list
    this.screens = 1; this.ticks = 0; this.acc = 0;
    this.sections = new Map();   // camera -> pathCounter (D_8018CF68)
    this.list = [];
    this.ready = fetch(`${import.meta.env?.BASE_URL ?? '/'}mk64/${def.dir}/thwomp.json`)
      .then(r => (r.ok ? r.json().catch(() => null) : null))   // no file: the dev server answers with index.html
      .then(data => data && this._build(data, def.dir));
  }

  _build(data, dir) {
    this.data = data;
    this.trackSections = new TrackSections(data.sections);
    this.faces = data.faces.map(f => {
      const map = HD.loadTexture(`${dir}/${f.image}`);
      map.colorSpace = THREE.SRGBColorSpace;
      map.flipY = false;
      map.wrapS = THREE.MirroredRepeatWrapping;   // rsp_load_texture_mask: S mirrored at 16 texels, T clamped
      map.wrapT = THREE.ClampToEdgeWrapping;   // filtering comes from HD.loadTexture: nearest at 1x, smooth in HD tiers
      return map;
    });
    this.lights = Object.fromEntries(Object.entries(data.typeLights).map(([k, { ambient, color: c, direction }]) =>
      [k, { ambient, color: c, dir: this._dir(direction) }]));
    this.textures = {};
    this.path = null;
    this.setScreens(this.screens);
  }

  _dir([x, y, z]) {
    const l = Math.hypot(x, y, z) || 1;
    return [(this.mirror ? -x : x) / l, y / l, z / l];
  }

  // one Thwomp's meshes: the face quad with its own material (the frame changes), the body with the side texture
  _meshes(o) {
    const g = new THREE.Group(), model = this.data.models.thwomp, self = this;
    const meshes = partMeshes(model, this.dir, this.textures);
    o.lit = [];
    model.parts.forEach((part, k) => {
      let { geometry, material } = meshes[k];
      if (part.face) {
        const uv = [];
        for (const tri of part.triangles) for (const [, , , s, t] of tri) uv.push(s / 32 / 16, t / 32 / 64);
        geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
        material = new THREE.MeshBasicMaterial({ map: this.faces[0], vertexColors: true, toneMapped: false, fog: false });
        o.face = material;
      }
      const mesh = new THREE.Mesh(geometry, material);
      mesh.onBeforeRender = function (renderer, scene, camera) {
        if (!self._drawn(o, camera)) {
          const e = this.matrixWorld.elements;
          _p.set(e[12], e[13], e[14]);
          this.matrixWorld.makeScale(0, 0, 0).setPosition(_p);
        }
      };
      g.add(mesh);
      o.lit.push({ mesh, verts: part.triangles.flat().map(([, , , , , nx, ny, nz]) => [nx, ny, nz]) });
    });
    return g;
  }

  // render_object_thwomps: state >= 2, the screen's section within unk_0DF +- 1, in the 180-degree wedge
  _drawn(o, camera) {
    if (o.state < 2) return false;
    const s = this.sections.get(camera);
    if (s === undefined || s < o.section - 1 || s > o.section + 1) return false;
    return inWedge(o.pos, camera, 0x8000);
  }

  // init_course_objects (gThowmpSpawnList for the cc, init_object) for a new race on this many screens
  setScreens(n) {
    this.screens = n; this.acc = 0; this.ticks = 0; this.frame = 0;
    this.lightRot = [0, 0];   // D_80165834
    if (!this.data) return;
    for (const o of this.list) this.group.remove(o.group);
    this.list = this.data.spawns[this.ccKey].thwomps.map(([x, z, kind, variant]) => {
      const o = { kind, variant, state: 1, stack: [], timerActive: false, timer: 0, status: 0, flags: 0, sub: 0, dd: 0,
        turning: false, u048: 0, u0b0: 0, u0cc: 0, u01c: [0, 0, 0], offset: [0, 0, 0], origin: [x, 0, z],
        pos: [x, 0, z], vel: [0, 0, 0], rotY: 0, dirY: 0, tex: 0, scale: 1, type: 0, section: 6, player: 0,
        surfaceHeight: 0 };
      o.group = this._meshes(o);
      this.group.add(o.group);
      return o;
    });
    this._place();
  }

  // --- update_objects.c object state helpers ---
  _next(o) { o.timerActive = false; o.status &= ~0x2000; o.state++; }                                   // object_next_state
  _push(o, s) { o.timerActive = false; o.status &= ~0x2008; this._next(o); o.stack.push(o.state); o.state = s; }   // func_80072568
  _pushAs(o, s, back) { o.timerActive = false; o.status &= ~0x2008; o.stack.push(back); o.state = s; }   // func_800725E8
  _pop(o) { o.timerActive = false; o.status &= ~0x2008; o.state = o.stack.pop(); }                    // func_8007266C
  _set(o, s) { o.timerActive = false; o.status &= ~0x2000; o.state = s; }                              // func_800726CC
  _sub(o) { o.status &= ~8; o.sub++; }                                                                   // func_80086FD4
  _setSub(o, s) { o.status &= ~8; o.sub = s; }                                                           // func_80086E70 / func_8008701C
  _timer(o, t) {   // set_and_run_timer_object
    if (!o.timerActive) { o.timerActive = true; o.timer = t; }
    if (--o.timer < 0) { o.timerActive = false; this._next(o); return true; }
    return false;
  }
  _face(o, idx, t) {   // func_80072AAC
    if (!o.timerActive) { o.timerActive = true; o.tex = idx; o.timer = t; }
    if (--o.timer < 0) { o.timerActive = false; this._next(o); return true; }
    return false;
  }
  _faces(o, lo, hi, step, t, times) {   // func_800730BC: frames lo..hi and back, `times` times (-1 for ever)
    if (!(o.status & 0x2000)) {
      o.tex = lo; o.timer = t; o.u0cc = times; o.timerActive = true; o.status = (o.status | 0x2000) & ~0x4000;
      return false;
    }
    if (--o.timer > 0) return false;
    o.timer = t;
    if (!(o.status & 0x4000)) {
      o.tex += step;
      if (o.tex >= hi) { o.tex = hi; o.status |= 0x4000; }
      return false;
    }
    o.tex -= step;
    if (lo >= o.tex) {
      o.tex = lo;
      if (o.u0cc > 0) o.u0cc--;
      if (o.u0cc === 0) { o.status &= ~0x2080; o.timerActive = false; this._next(o); return true; }
      o.status = (o.status & ~0x4000) | 0x80;
    }
    return false;
  }
  _turn(o, step, total) {   // func_80073E18: orientation[1] + step a frame until `total` has been turned
    if (!o.turning) { o.turning = true; o.u048 = total; }
    const left = o.u048 - step;
    if (left <= 0) { o.rotY = u16(o.rotY + o.u048); o.turning = false; return true; }
    o.rotY = u16(o.rotY + step); o.u048 = left;
    return false;
  }

  // --- the inits (state 1) ---
  _init(o) {
    const k = o.kind;
    o.status = (k === 1 || k === 6 ? 0x05000220 : 0x04000220); o.tex = 0; o.scale = 1;
    o.origin[1] = 0; o.surfaceHeight = 0; o.offset = [0, 0, 0];
    if (k === 1) {   // func_8007EC30
      o.rotY = o.dirY = 0xC000; o.u01c[1] = 30; o.type = 0; o.section = 6;
    } else if (k === 2) {   // func_8007EE5C
      o.type = 0; o.section = 6; this._setSub(o, 1);
      o.offset = [0, 20, 0]; o.u01c[1] = 20; o.rotY = o.dirY = 0xC000;
      o.dd = o.variant === 0 ? 1 : 2;
    } else if (k === 3) {   // func_8007FA08
      o.type = 0; o.dirY = 0; o.rotY = 0x4000; o.vel[0] = 0; o.dirY = o.rotY;
      o.dd = 1; o.section = 8; o.offset[1] = 15; o.u01c[1] = 15;
    } else if (k === 4) {   // func_80080078
      o.type = 2; o.section = 8; o.dirY = 0; o.u01c[1] = 30; o.rotY = 0xC000;
      o.timer = [2, 60, 120, 180][o.variant];
    } else if (k === 6) {   // func_800802C0
      o.scale = 1.5; o.type = 1; o.section = 6; o.dirY = 0;
      o.offset[1] = 10; o.u01c[1] = 10; o.rotY = 0xC000;
    } else if (k === 5) {   // func_80080524
      o.type = 0; o.section = 10; this._setSub(o, 1);
      o.surfaceHeight = 70; o.origin[1] = 70; o.u01c[1] = 0; o.dirY = 0; o.rotY = 0x4000;
      o.dd = 2; o.vel[2] = o.variant === 0 ? -1 : -1.5;
      o.flags |= 0x80;
    }
    o.stack = [];   // func_800724DC
    this._next(o);
  }

  // func_8007E63C: the slam
  _slam(o) {
    switch (o.state) {
      case 0x32:
        if (stepUp(o.offset, 1, o.u01c[1] + 15, 1.5)) { o.status |= 0x200; o.flags = (o.flags | 1) & ~2; this._next(o); }
        break;
      case 0x33:
        if (stepDown(o.offset, 1, 0, 2)) {
          o.tex = o.offset[1] >= 16 ? 0 : o.offset[1] >= 8 ? 1 : 2;
          o.flags &= ~1;
          if (o.status & 0x10000) { o.flags |= 0x10; if (o.status & VISIBLE) o.flags |= 0x20; }
          this._next(o);   // (flag 2, a squashed kart, would go to 0x64: not ported)
        }
        break;
      case 0x34: this._face(o, 3, 6); break;
      case 0x35: this._face(o, 2, 50); break;
      case 0x36:
        if (o.offset[1] >= 20) o.tex = 0; else if (o.offset[1] >= 18) o.tex = 1;
        if (stepUp(o.offset, 1, o.u01c[1], 0.5)) { o.status &= ~0x200; this._pop(o); }
        break;
      case 0x12C:   // turn round after a player came near (behaviour 1)
        if (this._turn(o, 0x400, 0x8000)) { o.flags &= ~4; this._pop(o); }
        break;
    }
  }

  // func_8007E59C / func_8007E50C: a screen's player within 300 and ahead of its camera (func_8008A060 is always true)
  _playerNear(o, players, cams) {
    for (let i = 0; i < Math.min(players.length, cams.length); i++) {
      const p = players[i]?.world, cam = cams[i];
      if (!p || !cam || (o.flags & 4)) continue;
      const dx = o.pos[0] - p.x / S, dz = o.pos[2] - p.z / S;
      if (dx * dx + dz * dz > 300 * 300) continue;
      if (u16(camYaw(cam) - atan2s(dx, dz) + 0x2000) > 0x4000) continue;
      o.flags |= 4;
      return true;
    }
    return false;
  }

  _kind1(o, players, cams) {   // func_8007ED6C
    switch (o.state) {
      case 1: this._init(o); break;
      case 2: this._timer(o, 60); break;
      case 3: this._push(o, 0x32); break;
      case 4: if (this._playerNear(o, players, cams)) this._pushAs(o, 0x12C, 2); else this._set(o, 2); break;
    }
    this._slam(o);
    this._pos(o);
    o.dirY = o.rotY;
  }

  _kind2(o) {   // func_8007F5A8 with func_8007EFBC (variant 0) / func_8007F280 (variant 1)
    switch (o.state) {
      case 1: this._init(o); break;
      case 3: this._push(o, 0x32); break;
      case 4: this._sub(o); this._next(o); break;
    }
    this._slam(o);
    const a = o.dd === 1;   // the two squares are mirror images
    const T = (step, total, then) => { if (this._turn(o, step, total)) { if (then) this._set(o, 3); this._sub(o); } };
    switch (o.sub) {
      case 1: if (this._turn(o, a ? 0x800 : 0x400, a ? 0x8000 : 0x10000)) { o.u01c[0] = a ? 200 : -200; this._sub(o); } break;
      case 2: if (stepTowards(o.offset, 0, o.u01c[0], 4)) this._sub(o); break;
      case 3: if (this._turn(o, 0x400, a ? 0x8000 : 0x10000)) { this._set(o, 3); this._sub(o); } break;
      case 5: T(0x400, a ? 0xC000 : 0x4000, false); break;
      case 6: if (a ? stepDown(o.offset, 2, -100, 2) : stepUp(o.offset, 2, 100, 2)) this._sub(o); break;
      case 7: T(0x400, a ? 0x4000 : 0xC000, true); break;
      case 9: T(0x400, a ? 0x10000 : 0x8000, false); break;
      case 10: if (stepTowards(o.offset, 0, 0, 4)) this._sub(o); break;
      case 11: T(0x400, a ? 0x10000 : 0x8000, true); break;
      case 13: T(0x400, a ? 0x14000 : 0xC000, false); break;
      case 14: if (a ? stepUp(o.offset, 2, 0, 2) : stepDown(o.offset, 2, 0, 2)) this._sub(o); break;
      case 15: T(0x400, a ? 0xC000 : 0x14000, true); break;
      case 17: this._setSub(o, 1); break;
    }
    this._pos(o);
  }

  // func_8007F8D8: when every chaser is idle, the first human player in the corridor sets them off
  _chaseTrigger(players) {
    const chasers = this.list.filter(o => o.kind === 3);
    if (!chasers.length || chasers.some(o => o.state < 2 || (o.flags & 8))) return;
    for (let i = 0; i < players.length; i++) {
      const p = players[i], point = this._pathPoint(p);
      if (point >= 0xAA && point < 0xB5) {
        const wait = Math.floor(Math.random() * 50) + 50;   // random_int(0x32) + 0x32
        for (const o of chasers) { o.flags |= 8; this._setSub(o, 1); o.dd = 1; o.player = p; o.u048 = wait; }
        return;
      }
      if (point >= 0xD7 && point < 0xE2) {
        for (const o of chasers) { o.flags |= 8; this._setSub(o, 1); o.dd = 2; o.u01c[0] = f32(p.world.x / S - o.origin[0]); o.player = p; }
        return;
      }
    }
  }

  // gNearestPathPointByPlayerId: the track path point nearest the kart
  _pathPoint(k) {
    const path = this.path, w = k?.world;
    if (!path || !w) return -1;
    const x = w.x / S, y = w.y / S, z = w.z / S;
    let best = -1, bd = Infinity;
    for (let i = 0; i < path.length; i++) {
      const p = path[i], d = (p[0] - x) ** 2 + (p[1] - y) ** 2 + (p[2] - z) ** 2;
      if (d < bd) { bd = d; best = i; }
    }
    return best;
  }

  _kind3(o) {   // func_8007FFC0
    switch (o.state) {
      case 1: this._init(o); break;
      case 3: this._push(o, 0x32); break;
      case 4: this._next(o); this._sub(o); break;
    }
    this._slam(o);
    if (o.dd === 1) {   // func_8007FB48: alongside the player
      switch (o.sub) {
        case 1: o.u0b0 = 0xA0; o.offset[0] = 0; o.offset[2] = 0; o.vel[2] = 0; this._sub(o); break;
        case 2: {
          const speed = o.player ? speedKmh(o.player.v) * 18 / 216 : 0;   // player->speed
          o.vel[0] = f32(speed * 1.25);
          if (o.u048 >= o.u0b0) {
            if (o.u0b0 === o.u048) o.vel[2] = this.frame & 1 ? 1.5 : -1.5;   // D_8018D400 & 1
            if (o.vel[2] >= 0) { if (o.offset[2] >= 40) o.vel[2] = -1.5; }
            else if (o.offset[2] <= -40) o.vel[2] = 1.5;
          }
          o.offset[0] = f32(o.offset[0] + o.vel[0]); o.offset[2] = f32(o.offset[2] + o.vel[2]);
          if (o.u0b0 < 0x65) {
            o.rotY = turnTowards(o.rotY, u16(o.dirY + 0x8000));
            if (o.u0b0 === 0x64) o.tex = 1;
          }
          const past = o.offset[0] >= 1000;
          o.u0b0--;
          if (o.u0b0 === 0 || past) { this._set(o, 3); this._sub(o); }
          break;
        }
        case 4:
          stepTowards(o.offset, 2, 0, 2); stepTowards(o.offset, 0, 0, 5);
          if (o.offset[0] + o.offset[2] === 0) this._sub(o);
          break;
        case 5:
          o.rotY = turnTowards(o.rotY, o.dirY);
          if (o.rotY === o.dirY) { o.flags &= ~8; this._sub(o); o.tex = 0; }
          break;
      }
    } else if (o.dd === 2) {   // func_8007FEA4: steps across to the player's x
      switch (o.sub) {
        case 1: if (stepTowards(o.offset, 0, o.u01c[0], 5)) { this._set(o, 3); this._sub(o); } break;
        case 3: if (stepTowards(o.offset, 0, 0, 5)) { this._sub(o); o.flags &= ~8; } break;
      }
    }
    this._pos(o);
  }

  _kind4(o) {   // func_800801FC
    switch (o.state) {
      case 1: this._init(o); break;
      case 2: this._timer(o, o.timer); break;
      case 3: this._push(o, 0x32); break;
      case 4: o.timer = 60; this._set(o, 2); break;
    }
    this._slam(o);
    this._pos(o);
  }

  _kind6(o, cams) {   // func_80080408
    switch (o.state) {
      case 1: this._init(o); break;
      case 2:
        // func_8008A6DC(100): within 100 of a screen and in its 90-degree wedge
        o.status &= ~0x60000;
        for (const cam of cams) {
          const e = cam.matrixWorld.elements, dx = o.pos[0] - e[12] / S, dz = o.pos[2] - e[14] / S;
          if (dx * dx + dz * dz > 100 * 100) continue;
          o.status |= 0x20000;
          if (inWedge(o.pos, cam, 0x4000)) o.status |= VISIBLE;
        }
        if (o.status & VISIBLE) { placedSound(this.audio, cams, o.pos, 1, 0x45, this.mirror, 500); this._next(o); }   // 0x19018045
        break;
      case 3: if (this._faces(o, 3, 5, 1, 6, 6)) o.tex = 0; break;
      case 4: if (this._timer(o, 300)) this._set(o, 2); break;
    }
    this._pos(o);
  }

  _kind5(o, cams) {   // func_800808CC
    switch (o.state) {
      case 1: this._init(o); break;
      case 2: this._faces(o, 3, 5, 1, 6, -1); break;
    }
    if (o.state < 2) return;
    this._slam(o);
    // func_8008085C: dd 2 = func_8008078C (z out to -250 and back)
    if (o.sub === 1) {
      if (stepTowards(o.offset, 2, -250, o.vel[2])) { o.vel[2] = -o.vel[2]; this._sub(o); }
    } else if (o.sub === 2) {
      if (stepTowards(o.offset, 2, 0, o.vel[2])) { o.vel[2] = -o.vel[2]; this._setSub(o, 1); }
    }
    this._pos(o);
    if ((this.frame & 0x3F) === 0 && o.state === 2) placedSound(this.audio, cams, o.pos, 1, 0x45, this.mirror, 1000);   // 0x19036045
  }

  _pos(o) {   // object_calculate_new_pos_offset
    for (let i = 0; i < 3; i++) o.pos[i] = f32(o.origin[i] + o.offset[i]);
  }

  // func_80081210
  _frame(cams, players, karts) {
    this.frame++;   // D_8018D400
    this.lightRot[0] = u16(this.lightRot[0] + 0x100); this.lightRot[1] = u16(this.lightRot[1] + 0x200);
    for (const o of this.list) {   // func_8008A4CC
      o.flags &= ~0x10;
      o.status &= ~0x70000;
      if (o.state === 0) continue;
      for (const cam of cams) {
        const s = this.sections.get(cam);
        if (s === undefined || s < o.section - 1 || s > o.section + 1) continue;
        o.status |= 0x10000;
        if (s === o.section) o.status |= 0x20000;
        if (inWedge(o.pos, cam, 0x2AAB)) o.status |= VISIBLE;
      }
    }
    this._chaseTrigger(players);
    for (const o of this.list) {
      if (o.state === 0) continue;
      switch (o.kind) {
        case 1: this._kind1(o, players, cams); break;
        case 2: this._kind2(o); break;
        case 3: this._kind3(o); break;
        case 4: this._kind4(o); break;
        case 6: this._kind6(o, cams); break;
        case 5: this._kind5(o, cams); break;
      }
    }
    // func_80080A4C: a slam heard (0x1900800F) by a kart within 500, not with 3-4 screens (assumption: once per slam)
    if (this.screens < 3) {
      for (const o of this.list) {
        if (!(o.status & 0x10000) || !(o.flags & 0x10)) continue;
        if (karts.some(k => k?.world && (o.pos[0] - k.world.x / S) ** 2 + (o.pos[2] - k.world.z / S) ** 2 <= 500 * 500)) {
          placedSound(this.audio, cams, o.pos, 1, 0x0F, this.mirror);
        }
      }
    }
  }

  // func_800419F8: type 0's light direction, (0, 0, 120) turned by D_80165834 (vec3f_rotate_x_y), stored as s8
  _swirl() {
    const [r0, r1] = this.lightRot.map(a => a * RAD), s1 = Math.sin(r0), c1 = Math.cos(r0), s2 = Math.sin(r1), c2 = Math.cos(r1);
    const v = [-120 * s2, 120 * s1 * c2, 120 * c1 * c2].map(Math.trunc);
    return this._dir(v);
  }

  _place() {
    const sx = this.mirror ? -S : S, swirl = this.data ? this._swirl() : null;
    for (const o of this.list) {
      o.group.position.set(o.pos[0] * S, o.pos[1] * S, o.pos[2] * S);
      o.group.scale.set(sx * o.scale, S * o.scale, S * o.scale);
      o.group.rotation.y = o.rotY * RAD;
      if (o.face) o.face.map = this.faces[Math.max(0, Math.min(5, o.tex))];
    }
    this.group.updateMatrixWorld(true);
    // F3DEX: ambient + colour x max(0, n . l), the normal turned into world space
    for (const o of this.list) {
      const L = this.lights[o.type], dir = o.type === 0 && swirl ? swirl : L.dir;
      for (const { mesh, verts } of o.lit) {
        _m.getNormalMatrix(mesh.matrixWorld);
        const col = mesh.geometry.attributes.color, a = col.array;
        verts.forEach(([nx, ny, nz], i) => {
          _n.set(nx, ny, nz).applyMatrix3(_m).normalize();
          const d = Math.max(0, _n.x * dir[0] + _n.y * dir[1] + _n.z * dir[2]);
          color.setRGB(...[0, 1, 2].map(k => Math.min(255, Math.round(L.ambient[k] + L.color[k] * d)) / 255), THREE.SRGBColorSpace);
          a[i * 3] = color.r; a[i * 3 + 1] = color.g; a[i * 3 + 2] = color.b;
        });
        col.needsUpdate = true;
      }
    }
  }

  // cams: each screen's camera; players: each screen's kart (the human players); karts: every kart
  update(dt, cams = [], players = [], karts = [], path = null) {
    if (!this.data) return;
    this.path = path;
    for (const cam of this.sections.keys()) if (!cams.includes(cam)) this.sections.delete(cam);
    for (const cam of cams) this.sections.set(cam, this.trackSections.pathCounter(cam, this.sections.get(cam) ?? 1));
    for (this.acc += dt; this.acc >= TICK; this.acc -= TICK) {
      this.ticks++;
      if (!(this.ticks & 1)) continue;   // objects update once a frame (two 60 Hz ticks)
      this._frame(cams, players, karts);
    }
    this._place();
  }
}
