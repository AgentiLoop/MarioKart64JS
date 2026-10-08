// Kalimari Desert's trains and railroad crossings (tools/extract-train.py -> public/mk64/kalimari-desert/train.json).
// generate_train_path: gVehicle2DPathPoint (path2D, 465 points) from d_course_kalimari_desert_train_path, the trains
// riding at the floor height under its first point (D_80162EB0 = get_surface_height(x, 2000, z)).
// init_vehicles_trains: two trains from 2D point (i * length / 2 + 160) % length; five passenger cars 4 points apart,
// the tender 3 on, the locomotive 4 on, speed 5. 1P runs every car; 2P outside Grand Prix the tender and car 4; else
// the locomotive alone. spawn_course_vehicles moves each active car once; update_vehicle_trains (once a frame, every
// other 60 Hz tick) moves them again: update_vehicle_following_path heads 5 units at the mean of 2D points + 3 and + 4
// past the nearest one (find_closest_vehicles_path_point: index - 2 .. + 6), the car turned to its motion.
// update_actor_train_*: wheels - DEGREES(9) a tick (tender DEGREES(7)). render_actor_train_*: three levels of detail by
// x/z distance (engine 350 / 800, tender and cars 500 / 1000), nothing past 3000, wheels (dl_22DB8 small, dl_22D70
// big, each turned about x at its own offset and phase) within 1200.
// func_80013054: crossing 0 rings while a locomotive is between 0.42299348 - 0.1 and + 0.01 + cars x 0.01 of the path,
// crossing 1 the same round 0.72017354. Four ACTOR_RAILROAD_CROSSING (spawn_course_actors) draw
// dl_crossing_both_inactive, or while rung (update_actor_railroad_crossing: timer 1..40) dl_crossing_right_active
// below 20 and dl_crossing_left_active from 20, within 2000; bell 0x19017016 at timer 1 and 20.
// The locomotive's bell 0x1901800E as it reaches 2D point 190 or 320, else its whistle 0x1901800D one frame in 100.
// EXTRA: the console mirrors positions and headings only, so each model is flipped back in its own x (as src/props.js)
// and the crossings turn the other way.
// Not ported: the locomotive's smoke (render_object_trains_smoke_particles), karts tumbling when a train hits them
// (handle_trains_interactions) and CPU karts waiting at a rung crossing (check_ai_crossing_distance).
import * as THREE from 'three';
import { NATIVE_SCALE } from './track.js';
import { partMeshes } from './props.js';
import { placedSound } from './penguins.js';

const TICK = 1 / 60;
const S = NATIVE_SCALE;
const DEG = d => Math.trunc(d * 65536 / 360) & 0xFFFF;   // DEGREES()
const RAD = Math.PI / 32768;
const SPEED = 5, CARS = 5;
// [lod names, lod 0 / 1 bounds (squared), wheels [x, y, z, big, phase], wheel turn per tick]
const KINDS = {
  engine: { lods: ['engine0', 'engine1', 'engine2'], near: [122500, 640000], turn: DEG(9),
    wheels: [[17, 6, 32, 0, 0], [17, 6, 16, 0, 2], [17, 12, -12, 1, 6], [17, 12, -34, 1, 4]] },
  tender: { lods: ['tender0', 'tender1', 'tender2'], near: [250000, 1000000], turn: DEG(7),
    wheels: [[17, 6, 8, 0, 0], [17, 6, -8, 0, 6]] },
  car: { lods: ['car0', 'car1', 'car2'], near: [250000, 1000000], turn: DEG(9),
    wheels: [[17, 6, 28, 0, 0], [17, 6, 12, 0, 3], [17, 6, -8, 0, 8], [17, 6, -24, 0, 2]] },
};
const FAR = 9000000, WHEELS = 1440000, CROSSING_FAR = 4000000;
const CROSSING_AT = [0.42299348, 0.72017354];

const _p = new THREE.Vector3();
// x/z distance squared from this camera to the actor (distance_if_visible without its view-cone test)
function dist2(origin, camera) {
  const c = camera.matrixWorld.elements, dx = (origin.x - c[12]) / S, dz = (origin.z - c[14]) / S;
  return dx * dx + dz * dz;
}
// onBeforeRender: drawn only while this camera's distance is in [min, max)
export function band(renderer, scene, camera) {
  const { origin, min, max } = this.userData, d = dist2(origin, camera);
  if (d < min || d >= max) {
    const e = this.matrixWorld.elements;
    _p.set(e[12], e[13], e[14]);
    this.matrixWorld.makeScale(0, 0, 0).setPosition(_p);
  }
}

// update_vehicle_following_path (find_closest_vehicles_path_point, get_angle_between_path) on the 2D path P:
// car.idx, car.pos, car.vel and car.yaw (the motion's heading)
export function followPath(P, car, speed) {
  const L = P.length, [x, , z] = car.pos;
  let best = 250000, bi = -1;
  for (let r = car.idx - 2; r < car.idx + 7; r++) {
    const c = (r < 0 ? r + L : r) % L, dx = P[c][0] - x, dz = P[c][1] - z, d = dx * dx + dz * dz;
    if (d < best) { best = d; bi = c; }
  }
  if (bi >= 0) car.idx = bi;
  const a = P[(car.idx + 3) % L], b = P[(car.idx + 4) % L];
  const dx = (a[0] + b[0]) * 0.5 - x, dz = (a[1] + b[1]) * 0.5 - z, d = Math.sqrt(dx * dx + dz * dz);
  if (d > 0.01) { car.pos[0] = x + dx * speed / d; car.pos[2] = z + dz * speed / d; }
  car.vel = [car.pos[0] - x, car.pos[2] - z];
  if (car.vel[0] || car.vel[1]) car.yaw = Math.atan2(car.vel[0], car.vel[1]);   // atan2s(dx, dz)
}
export class Train {
  constructor(scene, track, def, { mirror = false, audio = null, gp = false } = {}) {
    this.group = new THREE.Group();
    this.group.name = 'train';
    scene.add(this.group);
    this.track = track; this.mirror = mirror; this.audio = audio; this.gp = gp;
    this.screens = 1; this.ticks = 0; this.acc = 0;
    this.triggered = [false, false];
    this.ready = fetch(`${import.meta.env?.BASE_URL ?? '/'}mk64/${def.dir}/train.json`)
      .then(r => (r.ok ? r.json().catch(() => null) : null))   // no file: the dev server answers with index.html
      .then(data => data && this._build(data, def.dir));
  }

  _build(data, dir) {
    this.data = data;
    this.path = data.path2D;
    const p0 = this.path[0];
    this.y = (this.track.groundBelow?.(p0[0] * S, p0[1] * S, 2000 * S)?.y ?? 0) / S;   // D_80162EB0
    const textures = {};
    this.meshes = Object.fromEntries(Object.entries(data.models).map(([k, m]) => [k, partMeshes(m, dir, textures)]));
    this.trains = [0, 1].map(() => ({
      engine: this._car('engine'), tender: this._car('tender'),
      cars: Array.from({ length: CARS }, () => this._car('car')), numCars: 0,
    }));
    this.crossings = data.crossings.map(({ pos: [x, y, z], rotY, id }) => {
      const g = new THREE.Group();
      g.position.set(x * S, y * S, z * S);
      g.rotation.y = (this.mirror ? -rotY : rotY) * Math.PI / 180;
      g.scale.set(this.mirror ? -S : S, S, S);
      const states = ['crossingInactive', 'crossingRight', 'crossingLeft'].map(k => {
        const s = new THREE.Group();
        for (const { geometry, material } of this.meshes[k]) {
          const mesh = new THREE.Mesh(geometry, material);
          mesh.userData = { origin: g.position, min: 0, max: CROSSING_FAR };
          mesh.onBeforeRender = band;
          s.add(mesh);
        }
        g.add(s);
        return s;
      });
      this.group.add(g);
      return { id, timer: 0, pos: [x, y, z], group: g, states };
    });
    this.setScreens(this.screens);
  }

  // one train car actor: its levels of detail and wheels
  _car(kind) {
    const k = KINDS[kind], g = new THREE.Group();
    g.scale.set(this.mirror ? -S : S, S, S);
    k.lods.forEach((name, i) => {
      const min = i ? k.near[i - 1] : 0, max = i < 2 ? k.near[i] : FAR;
      for (const { geometry, material } of this.meshes[name]) {
        const mesh = new THREE.Mesh(geometry, material);
        mesh.userData = { origin: g.position, min, max };
        mesh.onBeforeRender = band;
        g.add(mesh);
      }
    });
    const wheels = [];
    for (const [x, y, z, big, phase] of k.wheels) for (const side of [1, -1]) {
      const w = new THREE.Group();
      w.position.set(x * side, y, z);
      for (const { geometry, material } of this.meshes[big ? 'wheelBig' : 'wheelSmall']) {
        const mesh = new THREE.Mesh(geometry, material);
        mesh.userData = { origin: g.position, min: 0, max: WHEELS };
        mesh.onBeforeRender = band;
        w.add(mesh);
      }
      g.add(w);
      wheels.push({ group: w, phase: DEG(phase) });
    }
    this.group.add(g);
    return { kind, group: g, wheels, turn: k.turn, wheelRot: 0, pos: [0, 0, 0], vel: [0, 0], idx: 0, yaw: 0, active: false };
  }

  // init_vehicles_trains + spawn_course_vehicles for this many screens
  setScreens(n) {
    this.screens = n;
    if (!this.data) return;
    const P = this.path, L = P.length;
    this.trains.forEach((t, i) => {
      let at = (Math.trunc(i * L / 2) + 160) % L;
      const place = car => {
        car.pos = [P[at][0], this.y, P[at][1]]; car.idx = at; car.vel = [0, 0]; car.active = false;
      };
      for (const c of t.cars) { at += 4; place(c); }
      at += 3; place(t.tender);
      at += 4; place(t.engine);
      t.engine.active = true;
      const all = n === 1, two = n === 2 && !this.gp;
      t.tender.active = all || two;
      t.cars.forEach((c, j) => { c.active = all || (two && j === 4); });
      t.numCars = all ? 1 + CARS : two ? 2 : 0;
      for (const car of [t.engine, t.tender, ...t.cars]) {
        car.group.visible = car.active;
        if (car.active) this._follow(car);
      }
    });
    this._place();
  }

  _follow(car) { followPath(this.path, car, SPEED); }
  // update_vehicle_trains
  _vehicles(cams) {
    for (const t of this.trains) {
      const old = t.engine.idx;
      this._follow(t.engine);
      if (old !== t.engine.idx && (t.engine.idx === 0xBE || t.engine.idx === 0x140)) {
        placedSound(this.audio, cams, t.engine.pos, 1, 0x0E, this.mirror, 500);
      } else if (Math.floor(Math.random() * 100) === 0) {
        placedSound(this.audio, cams, t.engine.pos, 1, 0x0D, this.mirror, 500);
      }
      for (const car of [t.tender, ...t.cars]) if (car.active) this._follow(car);
    }
  }

  // func_80013054
  _crossingTriggers() {
    const L = this.path.length;
    this.triggered = CROSSING_AT.map(at => this.trains.some(t => {
      const f = t.engine.idx / L;
      return at - 0.1 < f && f < t.numCars * 0.01 + (at + 0.01);
    }));
  }

  _place() {
    for (const t of this.trains) for (const car of [t.engine, t.tender, ...t.cars]) {
      if (!car.active) continue;
      car.group.position.set(car.pos[0] * S, car.pos[1] * S, car.pos[2] * S);
      car.group.rotation.y = car.yaw;
      for (const w of car.wheels) w.group.rotation.x = ((car.wheelRot + w.phase) & 0xFFFF) * RAD;
    }
    for (const c of this.crossings) {
      const state = this.triggered[c.id] ? (c.timer < 20 ? 1 : 2) : 0;
      c.states.forEach((s, i) => { s.visible = i === state; });
    }
  }

  // cams: each screen's camera (scene units) for the bells and whistle
  update(dt, cams = []) {
    if (!this.data) return;
    for (this.acc += dt; this.acc >= TICK; this.acc -= TICK) {
      this.ticks++;
      this._crossingTriggers();
      if (this.ticks & 1) this._vehicles(cams);   // update_vehicles runs twice a frame, the trains on one of them
      for (const t of this.trains) for (const car of [t.engine, t.tender, ...t.cars]) {
        if (car.active) car.wheelRot = (car.wheelRot - car.turn) & 0xFFFF;
      }
      for (const c of this.crossings) {   // update_actor_railroad_crossing
        if (!this.triggered[c.id]) continue;
        if (++c.timer > 40) c.timer = 1;
        if (c.timer === 1 || c.timer === 20) placedSound(this.audio, cams, c.pos, 1, 0x16, this.mirror, 500);
      }
    }
    this._place();
  }
}
