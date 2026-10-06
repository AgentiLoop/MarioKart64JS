import * as THREE from 'three';
import { HALF_WIDTH } from './track.js';

const MAX_SPEED = 44;
const BOOST_SPEED = 62;

// View tables: n64decomp/mk64 src/kart_dma.c (neutral slope group 4).
// Angle quantization: src/player_controller.c, func_8002934C.
export function kartSpriteFrame(angle, spinning = false) {
  const turn = Math.PI * 2;
  const units = Math.floor(((angle % turn + turn) % turn) / turn * 65536);
  const mirrored = Math.floor(units / 128) >= 257;
  const folded = units >= 0x7ff9 ? (65536 - units) & 0xffff : units;
  let frame;
  if (spinning) {
    frame = Math.floor(folded / 1638);
    if (units >= 0x7ff9 && frame === 0) frame = 1;
    if (frame >= 20) frame = 0;
    frame = frame === 0 ? 84 : 229 + frame;
  } else {
    const coarse = mirrored ? 513 - Math.floor(units / 128) : Math.floor(units / 128);
    const selector = Math.min(34, Math.floor(folded / (coarse < 81 ? 520 : 1638)) + (coarse < 81 ? 0 : 15));
    frame = selector <= 20 ? 84 + selector : 235 + selector - 21;
  }
  return { frame, mirrored };
}

export function buildKartMesh(character = 'mario') {
  const g = new THREE.Group();
  const map = new THREE.TextureLoader().load(`${import.meta.env?.BASE_URL ?? '/'}mk64/karts/${character}.png`);
  map.colorSpace = THREE.SRGBColorSpace;
  map.magFilter = map.minFilter = THREE.NearestFilter;
  map.generateMipmaps = false;
  const material = new THREE.SpriteMaterial({ map, alphaTest: 0.5, transparent: false, toneMapped: false });
  const sprite = new THREE.Sprite(material);
  sprite.center.set(0.5, 0);
  sprite.scale.set(4.5, 4.5, 1);
  g.add(sprite);
  const cameraPosition = new THREE.Vector3(), local = new THREE.Vector3(), inverse = new THREE.Quaternion();
  sprite.onBeforeRender = (_renderer, _scene, camera) => {
    camera.getWorldPosition(cameraPosition);
    g.getWorldQuaternion(inverse).invert();
    local.copy(cameraPosition).sub(g.position).applyQuaternion(inverse);
    // unmirrored MK64 frames show the kart's left flank (nose to screen-left), i.e. camera on local -x
    const view = kartSpriteFrame(Math.atan2(-local.x, local.z), g.userData.spinning);
    const column = view.frame % 21, row = Math.floor(view.frame / 21);
    map.repeat.set((view.mirrored ? -1 : 1) / 21, 1 / 16);
    map.offset.set((column + (view.mirrored ? 1 : 0)) / 21, 1 - (row + 1) / 16);
    material.rotation = g.userData.lean || 0;
    sprite.userData.frame = view.frame;
    sprite.userData.mirrored = view.mirrored;
  };
  g.userData.character = character;
  g.userData.dispose = () => { map.dispose(); material.dispose(); };
  return g;
}

export class Kart {
  constructor(track, { color, s, d, isPlayer = false, skill = 1, name = 'Racer', character = 'mario' }) {
    this.track = track; this.isPlayer = isPlayer; this.skill = skill; this.name = name;
    this.s = s; this.d = d; this.psi = 0; this.phi = 0; this.v = 0;
    this.crossings = 0; this.prevS = s;
    this.drift = 0;            // -1 left, +1 right, 0 none
    this.driftTime = 0; this.boost = 0;
    this.aiOffset = d; this.finished = false; this.finishTime = 0;
    this.mesh = buildKartMesh(character);
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
    target = THREE.MathUtils.clamp(target, -Math.min(HALF_WIDTH, t.wallAt(this.s, -1)) + 2.5, Math.min(HALF_WIDTH, t.wallAt(this.s, 1)) - 2.5);
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
    const sgn = Math.sign(this.d), wall = t.wallAt(this.s, sgn) - 1.2;
    if (Math.abs(this.d) > wall) {
      this.d = sgn * wall;
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
    this.mesh.userData.lean = this.steerVis * 0.08 + (this.drift ? this.drift * 0.12 : 0);
    this.mesh.userData.spinning = this.spin > 0;
    if (this.spinAngle) this.mesh.quaternion.multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), this.spinAngle));
    this.mesh.position.copy(this.world);
  }
}
