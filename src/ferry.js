// D.K.'s Jungle Parkway's paddle-boat ferry (tools/extract-ferry.py -> public/mk64/dks-jungle-parkway/ferry.json).
// generate_ferry_path: gVehicle2DPathPoint (path2D, 345 points) from d_course_dks_jungle_parkway_ferry_path, the boat
// floating at y -40 (D_80162EB2). init_vehicles_ferry: one boat (NUM_ACTIVE_PADDLE_BOATS) at 2D point 0, speed
// 1.6666666, active with 1 or 2 screens; spawn_course_vehicles moves it once and heads it along that motion.
// update_vehicle_paddle_boats (once a frame, every other 60 Hz tick): update_vehicle_following_path at its speed, then
// it turns toward 2D point index + 5 from where it was: more than 0x1770 off it slows by 0.04 (down to 0.2) and turns
// up to 0x3C, else it speeds up by 0.02 (up to 2.0) and turns up to 0x1E; its horn 0x19018047 / 0x19018048 one
// frame in 100. update_actor_paddle_boat: the paddle wheel + DEGREES(5) a tick.
// render_actor_paddle_boat: nothing while the screen's pathCounter (src/sections.js) is 21-24 or past 3000
// (distance_if_visible, 9000000 squared); boat_dl + railings_dl, then paddle_wheel_dl turned about x at (0, 16, -255)
// in the boat's space, G_CULL_BACK cleared. Lit (F3DEX, the light in world space): each vertex lit by the light in
// force when it was loaded, so the colours are worked out again as the boat and its wheel turn.
// EXTRA: the console mirrors positions and headings only, so the model is flipped back in its own x (as src/train.js).
// Not ported: its smoke (spawn_ferry_smoke, render_object_paddle_boat_smoke_particles) and karts tumbling when it
// hits them (handle_paddle_boats_interactions).
import * as THREE from 'three';
import { NATIVE_SCALE } from './track.js';
import { partMeshes } from './props.js';
import { placedSound } from './penguins.js';
import { followPath } from './train.js';
import { TrackSections } from './sections.js';

const TICK = 1 / 60;
const S = NATIVE_SCALE;
const DEG = d => Math.trunc(d * 65536 / 360) & 0xFFFF;   // DEGREES()
const RAD = Math.PI / 32768;
const s16 = v => ((v + 0x8000) & 0xFFFF) - 0x8000;
const atan2s = (x, z) => s16(Math.round(Math.atan2(x, z) / RAD));
const _p = new THREE.Vector3(), _n = new THREE.Vector3(), _m = new THREE.Matrix3(), color = new THREE.Color();

export class Ferry {
  constructor(scene, def, { mirror = false, audio = null } = {}) {
    this.group = new THREE.Group();
    this.group.name = 'ferry';
    scene.add(this.group);
    this.mirror = mirror; this.audio = audio;
    this.screens = 1; this.ticks = 0; this.acc = 0;
    this.sections = new Map();   // camera -> pathCounter
    this.ready = fetch(`${import.meta.env?.BASE_URL ?? '/'}mk64/${def.dir}/ferry.json`)
      .then(r => (r.ok ? r.json().catch(() => null) : null))   // no file: the dev server answers with index.html
      .then(data => data && this._build(data, def.dir));
  }

  _build(data, dir) {
    this.data = data;
    this.path = data.path2D;
    this.trackSections = new TrackSections(data.sections);
    const [lo, hi] = data.hiddenSections, far = data.maxDistance * data.maxDistance, sections = this.sections;
    this.boat = { pos: [0, 0, 0], vel: [0, 0], idx: 0, yaw: 0, rotY: 0, speed: 0, wheelRot: 0, active: false };
    const textures = {};
    this.lit = [];   // { mesh, normals, lights } per mesh with lit vertices
    const build = (model, parent) => {
      for (const [k, { geometry, material }] of partMeshes(model, dir, textures).entries()) {
        const mesh = new THREE.Mesh(geometry, material);
        mesh.onBeforeRender = function (renderer, scene, camera) {
          const e = this.matrixWorld.elements, c = camera.matrixWorld.elements;
          const dx = (e[12] - c[12]) / S, dz = (e[14] - c[14]) / S, s = sections.get(camera) ?? 1;
          if (s >= lo && s <= hi || dx * dx + dz * dz >= far) {
            _p.set(e[12], e[13], e[14]);
            this.matrixWorld.makeScale(0, 0, 0).setPosition(_p);
          }
        };
        parent.add(mesh);
        const verts = model.parts[k].triangles.flat();
        if (verts.some(v => v[9] >= 0)) {
          this.lit.push({ mesh, verts: verts.map(([, , , , , r, g, b, , light]) => [r, g, b, light]) });
        }
      }
    };
    this.boatGroup = new THREE.Group();
    this.boatGroup.scale.set(this.mirror ? -S : S, S, S);
    build(data.models.boat, this.boatGroup);
    this.wheel = new THREE.Group();
    this.wheel.position.set(...data.wheelOffset);
    build(data.models.wheel, this.wheel);
    this.boatGroup.add(this.wheel);
    this.group.add(this.boatGroup);
    this.lights = data.lights.map(({ ambient, color: c, direction: [x, y, z] }) => {
      const l = Math.hypot(x, y, z) || 1;
      return { ambient, color: c, dir: [(this.mirror ? -x : x) / l, y / l, z / l] };
    });
    this.setScreens(this.screens);
  }

  // init_vehicles_ferry + spawn_course_vehicles for this many screens
  setScreens(n) {
    this.screens = n;
    if (!this.data) return;
    const b = this.boat, p = this.path[0];
    Object.assign(b, { pos: [p[0], this.data.y, p[1]], vel: [0, 0], idx: 0, rotY: 0, speed: Math.fround(1.6666666), active: n < 3 });
    this.boatGroup.visible = b.active;
    if (b.active) {
      followPath(this.path, b, b.speed);
      b.rotY = atan2s(b.vel[0], b.vel[1]);
    }
    this._place();
  }

  // update_vehicle_paddle_boats
  _vehicle(cams) {
    const b = this.boat, P = this.path, [ox, , oz] = b.pos;
    followPath(P, b, b.speed);
    if (Math.floor(Math.random() * 100) === 0) {
      placedSound(this.audio, cams, b.pos, 1, Math.floor(Math.random() * 2) === 0 ? 0x47 : 0x48, this.mirror, 500);
    }
    const q = P[(b.idx + 5) % P.length];
    const temp = atan2s(q[0] - ox, q[1] - oz) - b.rotY;   // s32 difference of two s16 angles
    let turn = s16(temp);
    if (turn < 0) turn = s16(-turn);
    if (turn >= 0x1771) {
      if (b.speed > 0.2) b.speed = Math.fround(b.speed - 0.04);
      if (turn >= 0x3D) turn = 0x3C;
    } else {
      if (b.speed < 2.0) b.speed = Math.fround(b.speed + 0.02);
      if (turn >= 0x1F) turn = 0x1E;
    }
    if (temp >= 0x8000) b.rotY = s16(b.rotY - turn);
    else if (temp > 0) b.rotY = s16(b.rotY + turn);
    else if (temp < -0x7FFF) b.rotY = s16(b.rotY + turn);
    else if (temp < 0) b.rotY = s16(b.rotY - turn);
  }

  _place() {
    const b = this.boat;
    if (!b.active) return;
    this.boatGroup.position.set(b.pos[0] * S, b.pos[1] * S, b.pos[2] * S);
    this.boatGroup.rotation.y = b.rotY * RAD;
    this.wheel.rotation.x = s16(b.wheelRot) * RAD;
    this.boatGroup.updateMatrixWorld(true);
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

  // cams: each screen's camera (scene units) for the horn and the screen's track section
  update(dt, cams = []) {
    if (!this.data) return;
    for (const cam of this.sections.keys()) if (!cams.includes(cam)) this.sections.delete(cam);
    for (const cam of cams) this.sections.set(cam, this.trackSections.pathCounter(cam, this.sections.get(cam) ?? 1));
    if (!this.boat.active) return;
    let ticked = false;
    for (this.acc += dt; this.acc >= TICK; this.acc -= TICK) {
      this.ticks++;
      if (this.ticks & 1) this._vehicle(cams);   // update_vehicles runs twice a frame, the boats on one of them
      this.boat.wheelRot = (this.boat.wheelRot + DEG(5)) & 0xFFFF;
      ticked = true;
    }
    if (ticked) this._place();
  }
}
