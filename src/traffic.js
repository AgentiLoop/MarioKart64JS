// Toad's Turnpike's traffic (tools/extract-traffic.py -> public/mk64/toads-turnpike/traffic.json): 7 box trucks,
// 7 school buses, 7 tanker trucks and 7 cars driving track path 0 (course.json "path").
// load_track_path / calculate_track_boundaries: the path's left / right edges 50 (cpu_maximum_separation) either side,
// stored as s16. initialize_toads_turnpike_vehicle: vehicle i of n starts on path point (i * count / n + offset) % count
// (offset 0 trucks, 75 buses, 50 tankers, 25 cars; n = 8 in time trials though only 7 are spawned), lane type
// random_int(3) (i % 3 in time trials), lateral factor (type - 1) * 0.6, speed cc * 90 / 216 + 4.5833 for type 2 above
// 50cc (and in time trials), else cc * 90 / 216 + 2.9167; then one step along the path. spawn_vehicle_on_road steps it
// again and faces it DEGREES(180) (0 in EXTRA). update_vehicle_follow_path_point (once a frame = every other 60 Hz
// tick): the factor moves 0.06 towards func_80013C74's lane (before point 0x28A: type 0 -0.7, 1 0, 2 0.7; after:
// types 0 / 1 -0.5, 2 0.5), then func_8000D6D0 heads `speed` units (3D) at the mean of set_track_offset_position at
// path points + 3 and + 4 past the nearest (update_path_index: - 3 .. + 6 within 400, adjust_path_at_start_line);
// EXTRA's func_8000D940 heads for points - 3 and - 4 instead, i.e. against the karts. Yaw and pitch turn at most 100
// angle units an update towards the motion (adjust_angle). Box trucks take box texture 0, 1, 2 in turn (D_802BA260).
// render_actor_*: by x/z distance squared, 1P near < 160000, middle < 640000, far < 9000000; 2P-4P middle < 160000,
// far beyond. Cars are scaled 0.1.
// EXTRA: the console runs the mirrored path; here the unmirrored path is run with the lateral factor negated (its left
// edge is the mirror of the right one) and each model is flipped back in its own x, as src/train.js.
// Not ported: engine hum / horns (func_800C9D80, handle_vehicle_interactions), karts tumbling when hit
// (VERTICAL_TUMBLE_TRIGGER), CPU karts steering round traffic (update_player_track_position_factor_from_*).
import * as THREE from 'three';
import { NATIVE_SCALE } from './track.js';
import { partMeshes } from './props.js';
import { band } from './train.js';

const TICK = 1 / 60;
const S = NATIVE_SCALE;
const RAD = Math.PI / 32768;
const NUM = 7, FAR = 9000000;
// kind: [models per level of detail, start offset, scale]
const KINDS = [
  ['truck', 0, 1], ['bus', 75, 1], ['tanker', 50, 1], ['car', 25, 0.1],
];
const s16 = v => ((v & 0xFFFF) ^ 0x8000) - 0x8000;
const atan2s = (x, z) => s16(Math.round(Math.atan2(x, z) / RAD));
// adjust_angle: step towards target by at most `step`
function adjustAngle(angle, target, step) {
  const d = s16(target - angle);
  return d > 0 ? (d - step >= 0 ? s16(target - (d - step)) : target) : (d + step <= 0 ? s16(target - (d + step)) : target);
}

export class Traffic {
  constructor(scene, track, def, { mirror = false, cc = 2, timeTrial = false } = {}) {
    this.group = new THREE.Group();
    this.group.name = 'traffic';
    scene.add(this.group);
    this.mirror = mirror; this.cc = cc; this.timeTrial = timeTrial;
    this.screens = 1; this.ticks = 0; this.acc = 0;
    this.path = track.def.native.path;
    this.ready = fetch(`${import.meta.env?.BASE_URL ?? '/'}mk64/${def.dir}/traffic.json`)
      .then(r => (r.ok ? r.json().catch(() => null) : null))   // no file: the dev server answers with index.html
      .then(data => data && this._build(data, def.dir));
  }

  _build(data, dir) {
    this.data = data;
    const P = this.path, N = P.length, w = data.maxSeparation;
    if (N !== data.pathPoints) throw new Error(`traffic: path has ${N} points, expected ${data.pathPoints}`);
    // calculate_track_boundaries (posX / posZ stored as s16: truncated)
    this.left = []; this.right = [];
    for (let i = 0; i < N; i++) {
      const [x1, , z1] = P[i], [x2, , z2] = P[(i + 1) % N], dx = x2 - x1, dz = z2 - z1, d = Math.hypot(dx, dz);
      this.left.push([Math.trunc(w * dz / d + x1), Math.trunc(w * -dx / d + z1)]);
      this.right.push([Math.trunc(w * -dz / d + x1), Math.trunc(w * dx / d + z1)]);
    }
    const textures = {};
    this.meshes = Object.fromEntries(Object.entries(data.models).map(([k, m]) => [k, partMeshes(m, dir, textures)]));
    const A = this.cc * 90 / 216 + 4.583333333333333, B = this.cc * 90 / 216 + 2.9166666666666665;
    const n = this.timeTrial ? NUM + 1 : NUM;
    this.vehicles = [];
    for (const [kind, offset, scale] of KINDS) {
      for (let i = 0; i < NUM; i++) {   // initialize_toads_turnpike_vehicle (only NUM_RACE_* are spawned and moved)
        const at = (Math.trunc(i * N / n) + offset) % N;
        const type = this.timeTrial ? i % 3 : Math.floor(Math.random() * 3);
        const v = {
          kind, type, idx: at, pos: [P[at][0], P[at][1], P[at][2]], factor: Math.fround((type - 1) * 0.6),
          speed: (this.cc > 0 || this.timeTrial) && type === 2 ? A : B, yaw: 0, pitch: 0, vel: [0, 0, 0],
        };
        v.yaw = this._step(v);
        // spawn_vehicle_on_road
        const [ox, , oz] = v.pos;
        this._step(v);
        v.yaw = this.mirror ? 0 : -0x8000; v.pitch = 0;
        v.vel = [v.pos[0] - ox, 0, v.pos[2] - oz];
        const model = kind === 'truck' ? `truck${i % 3}_` : kind;   // ACTOR_BOX_TRUCK state = D_802BA260++ % 3
        v.group = this._model(model, scale);
        this.vehicles.push(v);
      }
    }
    this.setScreens(this.screens);
    this._place();
  }

  _model(prefix, scale) {
    const g = new THREE.Group();
    g.rotation.order = 'YXZ';   // mtxf_rotate_zxy_translate
    g.scale.set((this.mirror ? -S : S) * scale, S * scale, S * scale);
    g.userData.lods = [0, 1, 2].map(lod => this.meshes[`${prefix}${lod}`].map(({ geometry, material }) => {
      const mesh = new THREE.Mesh(geometry, material);
      mesh.userData = { origin: g.position, min: 0, max: 0 };
      mesh.onBeforeRender = band;
      g.add(mesh);
      return mesh;
    }));
    this.group.add(g);
    return g;
  }

  // levels of detail by screen count (render_actor_*: gActiveScreenMode)
  setScreens(n) {
    this.screens = n;
    if (!this.vehicles) return;
    const bands = n === 1 ? [[0, 160000], [160000, 640000], [640000, FAR]] : [[0, 0], [0, 160000], [160000, FAR]];
    for (const v of this.vehicles) v.group.userData.lods.forEach((meshes, lod) => {
      for (const m of meshes) [m.userData.min, m.userData.max] = bands[lod];
    });
  }

  // set_track_offset_position: between the left and right edges at points i and i + 1
  _offset(i, factor) {
    const N = this.path.length, j = (i + 1) % N, L = this.left, R = this.right;
    const a = 0.5 - (this.mirror ? -factor : factor) / 2, b = 1 - a;
    return [a * (L[i][0] + L[j][0]) / 2 + b * (R[i][0] + R[j][0]) / 2, a * (L[i][1] + L[j][1]) / 2 + b * (R[i][1] + R[j][1]) / 2];
  }

  // update_path_index (+ the nearest point overall when none is within 400) and adjust_path_at_start_line
  _nearest(v) {
    const P = this.path, N = P.length, [x, y, z] = v.pos;
    let best = 160000, bi = -1;
    for (let r = v.idx - 3; r < v.idx + 7; r++) {
      const c = (r + N) % N, dx = P[c][0] - x, dy = P[c][1] - y, dz = P[c][2] - z, d = dx * dx + dy * dy + dz * dz;
      if (d < best) { best = d; bi = c; }
    }
    if (bi < 0) {   // func_8000D24C picks the nearest point of the kart's track section; the nearest overall here
      best = Infinity;
      P.forEach((p, c) => {
        const d = (p[0] - x) ** 2 + (p[1] - y) ** 2 + (p[2] - z) ** 2;
        if (d < best) { best = d; bi = c; }
      });
    }
    const startZ = P[0][2];
    if (bi === 0 && startZ < z) bi = N - 1;
    else if (bi + 1 === N && z <= startZ) bi = 0;
    return bi;
  }

  // func_8000D6D0 (arg5 3) / func_8000D940 in EXTRA: one step; returns the motion's heading (get_angle_between_path)
  _step(v) {
    const P = this.path, N = P.length, [x, y, z] = v.pos;
    v.idx = this._nearest(v);
    const p1 = this.mirror ? (v.idx + N - 3) % N : (v.idx + 3) % N, p2 = this.mirror ? (v.idx + N - 4) % N : (v.idx + 4) % N;
    const [ax, az] = this._offset(p1, v.factor), [bx, bz] = this._offset(p2, v.factor);
    const dx = (ax + bx) * 0.5 - x, dy = (P[p1][1] + P[p2][1]) * 0.5 - y, dz = (az + bz) * 0.5 - z;
    const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (d > 0.01) v.pos = [x + dx * v.speed / d, y + dy * v.speed / d, z + dz * v.speed / d];
    return atan2s(v.pos[0] - x, v.pos[2] - z);
  }

  // update_vehicle_follow_path_point
  _update(v) {
    const [ox, oy, oz] = v.pos;
    const lane = v.idx < 0x28A ? [-0.7, 0, 0.7][v.type] : [-0.5, -0.5, 0.5][v.type];   // func_80013C74
    if (v.factor < lane) v.factor = Math.min(lane, Math.fround(v.factor + 0.06));
    if (lane < v.factor) v.factor = Math.max(lane, Math.fround(v.factor - 0.06));
    v.yaw = adjustAngle(v.yaw, this._step(v), 100);
    const dx = v.pos[0] - ox, dz = v.pos[2] - oz;
    v.pitch = adjustAngle(v.pitch, -atan2s(v.pos[1] - oy, Math.sqrt(dx * dx + dz * dz)), 100);
    v.vel = [dx, v.pos[1] - oy, dz];
  }

  _place() {
    for (const v of this.vehicles) {
      v.group.position.set(v.pos[0] * S, v.pos[1] * S, v.pos[2] * S);
      v.group.rotation.set(v.pitch * RAD, v.yaw * RAD, 0);
    }
  }

  update(dt) {
    if (!this.vehicles) return;
    for (this.acc += dt; this.acc >= TICK; this.acc -= TICK) {
      if (++this.ticks & 1) for (const v of this.vehicles) this._update(v);   // update_vehicles: every other tick
    }
    this._place();
  }
}
