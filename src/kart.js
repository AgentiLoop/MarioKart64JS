import * as THREE from 'three';
import { HALF_WIDTH, WALL_D } from './track.js';

const MAX_SPEED = 44;
const BOOST_SPEED = 62;

export function buildKartMesh(color) {
  const g = new THREE.Group();
  const body = new THREE.MeshLambertMaterial({ color });
  const dark = new THREE.MeshLambertMaterial({ color: 0x222226 });
  // model faces -Z, +Y up
  const chassis = new THREE.Mesh(new THREE.BoxGeometry(1.7, 0.5, 3.2), body);
  chassis.position.y = 0.55; g.add(chassis);
  const nose = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.35, 1.2), body);
  nose.position.set(0, 0.5, -2.0); g.add(nose);
  const spoiler = new THREE.Mesh(new THREE.BoxGeometry(2.0, 0.12, 0.6), dark);
  spoiler.position.set(0, 1.35, 1.6); g.add(spoiler);
  for (const x of [-0.8, 0.8]) {
    const strut = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.8, 0.1), dark);
    strut.position.set(x, 0.95, 1.6); g.add(strut);
  }
  const wheelG = new THREE.CylinderGeometry(0.5, 0.5, 0.45, 8);
  wheelG.rotateZ(Math.PI / 2);
  for (const [x, z, r] of [[-1.05, -1.2, 0.5], [1.05, -1.2, 0.5], [-1.1, 1.2, 0.6], [1.1, 1.2, 0.6]]) {
    const w = new THREE.Mesh(wheelG, dark);
    w.position.set(x, r, z); w.scale.setScalar(r / 0.5); g.add(w);
  }
  const driver = new THREE.Mesh(new THREE.SphereGeometry(0.55, 8, 6), new THREE.MeshLambertMaterial({ color: 0xf2c9a0 }));
  driver.position.set(0, 1.35, 0.2); g.add(driver);
  const helmet = new THREE.Mesh(new THREE.SphereGeometry(0.6, 8, 5, 0, Math.PI * 2, 0, Math.PI / 2), new THREE.MeshLambertMaterial({ color: 0xffffff }));
  helmet.position.set(0, 1.4, 0.2); g.add(helmet);
  const torso = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.7, 0.6), new THREE.MeshLambertMaterial({ color: 0x2a63c8 }));
  torso.position.set(0, 0.95, 0.4); g.add(torso);
  g.traverse(o => { if (o.isMesh) o.castShadow = true; });
  return g;
}

export class Kart {
  constructor(track, { color, s, d, isPlayer = false, skill = 1, name = 'Racer' }) {
    this.track = track; this.isPlayer = isPlayer; this.skill = skill; this.name = name;
    this.s = s; this.d = d; this.psi = 0; this.phi = 0; this.v = 0;
    this.crossings = 0; this.prevS = s;
    this.drift = 0;            // -1 left, +1 right, 0 none
    this.driftTime = 0; this.boost = 0;
    this.aiOffset = d; this.finished = false; this.finishTime = 0;
    this.mesh = buildKartMesh(color);
    this.color = color;
    this.frame = { pos: new THREE.Vector3(), T: new THREE.Vector3(), U: new THREE.Vector3(), R: new THREE.Vector3(), k: 0 };
    this.world = new THREE.Vector3(); this.fwd = new THREE.Vector3(); this.up = new THREE.Vector3();
    this.steerVis = 0; this.sparks = 0; this.offroad = false; this.hitWall = 0;
    this.item = null; this.itemTimer = 0; this.spin = 0; this.spinAngle = 0; this.invuln = 0;
    this.syncMesh();
  }

  get progress() { return this.crossings * this.track.length + this.s; }

  think(dt, karts) {
    const t = this.track, look = 14 + this.v * 0.6;
    const f = t.frameAt(this.s + look, { pos: new THREE.Vector3(), T: new THREE.Vector3(), U: new THREE.Vector3(), R: new THREE.Vector3(), k: 0 });
    let target = this.aiOffset;
    for (const o of karts) { // dodge slower karts ahead
      if (o === this) continue;
      let ds = o.s - this.s; if (ds < -t.length / 2) ds += t.length; if (ds > t.length / 2) ds -= t.length;
      if (ds > 0 && ds < 18 && Math.abs(o.d - this.d) < 3.5) target = this.d + (o.d >= this.d ? -4 : 4);
    }
    target = THREE.MathUtils.clamp(target, -HALF_WIDTH + 2.5, HALF_WIDTH - 2.5);
    const want = Math.atan2(target - this.d, 14) ;
    const steer = THREE.MathUtils.clamp((want - this.psi) * 3.5, -1, 1);
    const sharp = Math.abs(f.k) * (this.v * this.v) / 40;
    return { throttle: sharp > 1.4 ? 0.2 : 1, brake: 0, steer, drift: false };
  }

  update(dt, input) {
    const t = this.track;
    const absD = Math.abs(this.d);
    this.offroad = absD > HALF_WIDTH + 1.5;
    let max = (this.boost > 0 ? BOOST_SPEED : MAX_SPEED) * (this.isPlayer ? 1 : 0.93 + 0.05 * this.skill);
    if (this.offroad && this.boost <= 0) max *= 0.45;
    if (this.finished) input = { throttle: 0.3, brake: 0, steer: 0, drift: false };
    if (this.spin > 0) {
      this.spin -= dt; this.spinAngle += dt * 11;
      input = { throttle: 0, brake: 0, steer: 0, drift: false };
      if (this.spin <= 0) this.spinAngle = 0;
    }

    // longitudinal
    if (input.throttle > 0) {
      this.v += (14 + 10 * (1 - this.v / max)) * Math.max(0, 1 - this.v / max) * input.throttle * dt * 2.2;
      if (this.boost > 0) this.v += 40 * dt;
    }
    if (input.brake > 0) this.v -= (this.v > 0 ? 55 : 14) * input.brake * dt;
    this.v -= Math.sign(this.v) * 4 * dt;
    if (this.v > max) this.v = Math.max(max, this.v - (this.boost > 0 ? 0 : 30) * dt);
    this.v = Math.max(this.v, -12);
    if (this.boost > 0) this.boost -= dt;

    // drifting
    if (input.drift && !this.drift && this.v > 18 && Math.abs(input.steer) > 0.25) {
      this.drift = Math.sign(input.steer); this.driftTime = 0;
    }
    if (this.drift) {
      this.driftTime += dt;
      if (!input.drift || this.v < 12) {
        if (this.driftTime > 2.2) this.boost = 1.6; else if (this.driftTime > 1.1) this.boost = 0.8;
        this.drift = 0; this.driftTime = 0;
      }
    }
    // steering
    let steer = input.steer;
    if (this.drift) steer = this.drift * 0.65 + steer * 0.55;
    const speedFactor = THREE.MathUtils.clamp(Math.abs(this.v) / 10, 0, 1) / (1 + Math.abs(this.v) / 90);
    this.steerVis += (input.steer - this.steerVis) * Math.min(1, dt * 12);
    const dir = this.v >= 0 ? 1 : -1;
    this.psi += steer * (this.drift ? 2.3 : 1.9) * speedFactor * dt * dir;
    this.psi = THREE.MathUtils.clamp(this.psi, -1.45, 1.45);
    const grip = this.drift ? 1.6 : 9;
    this.phi += (this.psi - this.phi) * Math.min(1, grip * dt);
    if (this.drift) this.v -= 2 * dt;

    // advance along track (Frenet frame)
    t.frameAt(this.s, this.frame);
    const k = this.frame.k;
    const dsActual = this.v * dt;
    const along = dsActual * Math.cos(this.phi);
    const lateral = dsActual * Math.sin(this.phi);
    const denom = Math.max(0.3, 1 - k * this.d);
    const ds = along / denom;
    this.s += ds; this.d += lateral;
    const yaw = k * ds;                 // frame rotates under us
    this.psi -= yaw; this.phi -= yaw;

    // walls
    if (Math.abs(this.d) > WALL_D - 1.2) {
      const sgn = Math.sign(this.d);
      this.d = sgn * (WALL_D - 1.2);
      const into = sgn * Math.sin(this.phi) * this.v;
      if (into > 0) { this.v *= 0.82; this.hitWall = 0.25; }
      if (sgn * this.psi > 0) this.psi *= 0.4;
      if (sgn * this.phi > 0) this.phi *= 0.4;
      this.drift = 0;
    }
    this.hitWall = Math.max(0, this.hitWall - dt);

    // wrap & lap counting
    const L = t.length;
    if (this.s >= L) { this.s -= L; }
    else if (this.s < 0) { this.s += L; }
    if (this.prevS > L * 0.75 && this.s < L * 0.25) this.crossings++;
    else if (this.prevS < L * 0.25 && this.s > L * 0.75) this.crossings--;
    this.prevS = this.s;

    // boost pads
    for (const p of t.boostPads) {
      let dd = this.s - p.s; if (dd > L / 2) dd -= L; if (dd < -L / 2) dd += L;
      if (Math.abs(dd) < p.hl && Math.abs(this.d - p.d) < p.hw + 1) this.boost = Math.max(this.boost, 1.3);
    }
    this.syncMesh(dt);
  }

  syncMesh() {
    const t = this.track;
    t.frameAt(this.s, this.frame);
    const f = this.frame;
    this.fwd.copy(f.T).multiplyScalar(Math.cos(this.psi)).addScaledVector(f.R, Math.sin(this.psi)).normalize();
    this.up.copy(f.U);
    const right = new THREE.Vector3().crossVectors(this.fwd, this.up).normalize();
    this.up.crossVectors(right, this.fwd).normalize();
    this.world.copy(f.pos).addScaledVector(f.R, this.d).addScaledVector(f.U, 0.0);
    const m = new THREE.Matrix4().makeBasis(right, this.up, this.fwd.clone().negate());
    this.mesh.quaternion.setFromRotationMatrix(m);
    // body-roll when drifting / steering
    const lean = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, -1), -this.steerVis * 0.08 + (this.drift ? this.drift * -0.12 : 0));
    this.mesh.quaternion.multiply(lean);
    if (this.spinAngle) this.mesh.quaternion.multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), this.spinAngle));
    this.mesh.position.copy(this.world);
  }
}
