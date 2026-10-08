import * as THREE from 'three';
import { HALF_WIDTH } from './track.js';
import * as HD from './hd.js';

const MAX_SPEED = 44;
const BOOST_SPEED = 62;
// Engine classes: gTopSpeedTable (src/data/kart_attributes.c), per gCCSelection and characterId
// (Mario Luigi Yoshi Toad DK Wario Peach Bowser). MAX_SPEED is the 150cc Mario 320; Extra (mirror) races 100cc.
export const CC_INDEX = { 50: 0, 100: 1, 150: 2, extra: 3 };
const TOP_SPEED = [
  [290, 290, 294, 294, 290, 290, 294, 290],
  [310, 310, 314, 314, 310, 310, 314, 310],
  [320, 320, 324, 324, 320, 320, 324, 320],
  [310, 310, 314, 314, 310, 310, 314, 310],
];
const CHARACTER_ID = { mario: 0, luigi: 1, yoshi: 2, toad: 3, donkeykong: 4, wario: 5, peach: 6, bowser: 7 };
// Top velocity is the drive force currentSpeed^2 / 25 over the drag 0.12 * kartFriction (5800), so it scales with
// the square of gTopSpeedTable: 320 -> 5.885 units/frame (= MAX_SPEED), 290 -> 4.83 (50cc is 82% of 150cc).
const V_TOP = 320 * 320 / 25 / (0.12 * 5800);
export const ccSpeedScale = (cc, character) => (TOP_SPEED[cc][CHARACTER_ID[character] ?? 0] / 320) ** 2;
// CPU personalities, cpu_vehicles_camera_path/cpu_speed_control.inc.c regulate_cpu_speed: every frame a CPU
// accelerates normally, accelerates with CPU_FAST_EFFECT or decelerates 1 currentSpeed unit per frame.
// Path points per lap: yamls/courses/*_metadata.yml path_sizes[0] (gPathCountByPathIndex[0]).
export const PATH_POINTS = { luigi: 0x2DA, moomoo: 0x230, koopa: 0x2BC, kalimari: 0x2BC, toad: 0x3E8, frappe: 0x2EE, choco: 0x2BC,
  mario: 0x258, wario: 0x640, sherbet: 0x2BC, royal: 0x3E8, bowser: 0x30C, dk: 0x370, yoshi: 0x2B2, banshee: 0x2EE, rainbow: 0x76C };
// Pack bands in path points, [lap * 8 + slot] at lap start, [+ 8] at lap end (D_800DCBB4: Mario Raceway D_800DCB34, rest D_800DCAF4)
const PACK_BAND = [20, 5, 10, 15, 20, 25, 30, 35, 30, 25, 50, 75, 100, 125, 150, 175, 40, 30, 60, 90, 120, 150, 180, 210, 50, 40, 80, 120, 160, 200, 240, 280];
const PACK_BAND_MARIO = [20, 5, 10, 15, 20, 25, 30, 35, 30, 25, 45, 65, 90, 115, 140, 165, 40, 3, 6, 16, 46, 49, 59, 89, 50, 30, 60, 63, 73, 78, 108, 138];
const CPU_MIN_SPEED = [2.5, 10 / 3, 3.75, 10 / 3];   // regulate_cpu_speed var_f0 per gCCSelection, units/frame
const MK_UNIT = MAX_SPEED / V_TOP;                    // one MK64 speed unit/frame (player->speed) in our speed
// CPU target speeds per gCCSelection, units/frame (yamls/courses/*_metadata.yml): cpu_CurveTargetSpeed where
// are_in_curve (the straights leading into a curve, Track.cpuStraight), while drifting or airborne;
// cpu_NormalTargetSpeed in the curves; cpu_OffTrackTargetSpeed beyond 0.9 of the track half-width.
const CURVE_TARGET = [4.1666665, 5.5833334, 6.1666665, 6.75], NORMAL_TARGET = [3.75, 5.1666665, 5.75, 6.3333334];
const CPU_TARGET = {
  default: { curve: CURVE_TARGET, normal: NORMAL_TARGET, off: NORMAL_TARGET },
  toad: { curve: CURVE_TARGET, normal: CURVE_TARGET, off: NORMAL_TARGET },
  yoshi: { curve: CURVE_TARGET, normal: [3.75, 4.5833334, 4.5833334, 4.5833334], off: [2.9166667, 3.75, 3.75, 3.75] },
};
// player_decelerate_alternative(player, 1): currentSpeed (320 = 150cc top) drops 1 per frame; as a brake input
const CPU_SLOW_BRAKE = MAX_SPEED / 320 * (MAX_SPEED / 0.1 / 9) / 55;

// func_8000F124: Grand Prix picks two different random CPU drivers as rivals (D_80163348 / D_80163344).
export function pickRivals(karts) {
  const cpus = karts.filter(k => !k.isPlayer && !k.remote);
  for (let i = 0; i < 2 && cpus.length; i++) cpus.splice(Math.floor(Math.random() * cpus.length), 1)[0].rival = i;
}

// order: karts by race position. Sets k.aiSpeed ('fast' | 'normal' | 'slow') on every CPU kart.
export function cpuSpeedControl(karts, order, track, cc) {
  const L = track.length, pts = PATH_POINTS[track.def.id];
  const humans = order.filter(k => k.isPlayer || k.remote);
  if (!pts || !humans.length) return;
  const band = track.def.id === 'mario' ? PACK_BAND_MARIO : PACK_BAND;
  const at = k => k.progress / L * pts;   // gNumPathPointsTraversed
  const rankOf = k => order.indexOf(k);
  const human = humans[0], humanRank = rankOf(human);   // gBestRankedHumanPlayer
  const rivals = karts.filter(k => k.rival != null).sort((a, b) => a.rival - b.rival);
  const anchor = rivals[0] || karts.find(k => k.isPlayer) || human;   // D_80163344[0]: rival 1, else player 1 (VS)
  for (const k of karts) {
    if (k.isPlayer || k.remote) continue;
    const rank = rankOf(k);
    let mode;
    if (k.rival != null) {
      // func_80007D04: a rival outside the top two, or behind the best human, runs fast; otherwise normal.
      // (Its lead margin, 50 + 0/8/18 path points (+20/24/36 for rival 1), only matters once D_801631E0 is set
      // by LOST_RACE_EFFECT, and above it the rival still accelerates normally.)
      mode = rank >= 2 || at(k) < at(human) ? 'fast' : 'normal';
    } else {
      // func_800088D8: the leading CPU waits when more than band * (cc + 1) ahead of the best human; the others
      // run fast when farther than their slot's band from rival 1 and ease off inside it, so the pack trails the rival.
      const lap = Math.min(3, k.crossings), frac = k.s / L;
      const bandAt = slot => Math.trunc(lap < 3 ? band[lap * 8 + slot + 8] * frac + band[lap * 8 + slot] * (1 - frac) : band[lap * 8 + slot]);
      if (lap < 0) mode = 'fast';
      else if (rank === 0) {
        let gap = at(k) - at(human);
        if (gap > pts * 2 / 3 && humanRank >= 6) gap = at(k) - at(order[humanRank - 1]);
        mode = bandAt(0) * (cc + 1) < Math.abs(gap) && k.v >= 20 / 216 * 18 * MK_UNIT ? 'slow' : 'fast';
      } else {
        const rivalsAhead = rivals.filter(r => rankOf(r) < rank).length, humansAhead = humans.filter(h => rankOf(h) < rank).length;
        const slot = rank - rivalsAhead - humansAhead + (rivalsAhead || humansAhead ? 1 : 0);
        mode = slot < 0 || slot >= 8 ? 'slow' : bandAt(slot) < Math.abs(at(anchor) - at(k)) ? 'fast' : 'slow';
      }
    }
    if (k.v < CPU_MIN_SPEED[cc] * MK_UNIT) mode = 'normal';   // below the class minimum: always accelerate
    k.aiSpeed = mode;
  }
}

// Airborne vertical physics, player_controller.c: vy += (gravityY - vy * 0.12 * kartFriction) / 6000 / unk_DAC
// per frame (gKartGravityTable 2600, gKartFrictionTable 5800). Assumption: MK64's top speed of 9 units/frame
// (gKartTopSpeedTable) maps to our MAX_SPEED at course scale 0.1, which fixes one MK64 frame in seconds.
const MK_FPS = MAX_SPEED / 0.1 / 9;
const KART_GRAVITY = 2600, GRAVITY_SCALE = 0.1 * MK_FPS * MK_FPS / 6000, AIR_DRAG = MK_FPS * 0.12 * 5800 / 6000;
// func_8002AB70: BOOST_RAMP_ASPHALT (Royal Raceway) / BOOST_RAMP_WOOD (DKJP) kartGravity and unk_DAC
const RAMP_AIR = { asphalt: { gravity: 3500, dac: 20 }, wood: { gravity: 1800, dac: 25 } };

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
  const map = HD.loadTexture(`karts/${character}.png`);   // 1x nearest, HD tiers mipmapped (atlas built up to 2x)
  map.colorSpace = THREE.SRGBColorSpace;
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
  constructor(track, { color, s, d, isPlayer = false, skill = 1, name = 'Racer', character = 'mario', spawn = null, speedScale = 1, cc = 2 }) {
    this.track = track; this.isPlayer = isPlayer; this.skill = skill; this.name = name; this.speedScale = speedScale; this.cc = cc;
    this.s = s; this.d = d; this.psi = 0; this.phi = 0; this.v = 0;
    // arena (battle) kart: roams freely as (x, z, heading h) with facing (sin h, 0, cos h); spawn = { x, y, z, h }
    this.free = !!track.arena;
    if (this.free) {
      this.spawn = spawn; this.x = spawn.x; this.z = spawn.z; this.h = spawn.h; this.slip = 0; this.rescue = 0; this.balloons = 3;
      const g = track.groundAt(spawn.x, spawn.z, spawn.y) || track.groundBelow(spawn.x, spawn.z, spawn.y + 0.5);
      this.y = g ? g.y : spawn.y;
    }
    this.mesh = buildKartMesh(character);
    this.color = color;
    if (this.free) {   // battle balloons: three in the kart's colour floating over the roof, one less per hit
      this.balloonMeshes = [[-1.3, 5.4, 0.6], [1.3, 5.4, 0.6], [0, 6.3, -0.5]].map(p => {
        const m = new THREE.Mesh(new THREE.SphereGeometry(0.7, 12, 10), new THREE.MeshBasicMaterial({ color, toneMapped: false }));
        m.position.set(...p); m.userData.base = p[1];
        this.mesh.add(m);
        return m;
      });
    }
    this.crossings = 0; this.prevS = s;
    this.drift = 0;            // -1 left, +1 right, 0 none
    this.driftTime = 0; this.boost = 0;
    this.aiOffset = d; this.finished = false; this.finishTime = 0;
    this.frame = { pos: new THREE.Vector3(), T: new THREE.Vector3(), U: new THREE.Vector3(), R: new THREE.Vector3(), k: 0 };
    this.world = new THREE.Vector3(); this.fwd = new THREE.Vector3(); this.up = new THREE.Vector3();
    this.steerVis = 0; this.sparks = 0; this.offroad = false; this.hitWall = 0;
    this.item = null; this.itemTimer = 0; this.spin = 0; this.spinAngle = 0; this.invuln = 0;
    this.syncMesh();
  }

  get progress() { return this.crossings * this.track.length + this.s; }

  // Arena CPU: chase the nearest opponent still in the battle, turning away from walls and edges ahead.
  thinkFree(dt, karts) {
    const t = this.track;
    let target = null, best = Infinity;
    for (const o of karts) {
      if (o === this || o.out || o.rescue > 0) continue;
      const d = Math.hypot(o.x - this.x, o.z - this.z);
      if (d < best) { best = d; target = o; }
    }
    this.wander = (this.wander ?? 0) + (Math.random() - 0.5) * dt * 2;
    this.wander = THREE.MathUtils.clamp(this.wander, -0.8, 0.8);
    let want = target ? Math.atan2(target.x - this.x, target.z - this.z) + this.wander * 0.5 : this.h + this.wander;
    // probe ahead (further the faster it goes): a wall or a drop there turns the kart towards the open side
    const reach = 6 + Math.abs(this.v) * 0.5;
    // ground sampled along the ray: a step down of up to 6 units (decks, slabs) is fine, a hole is not
    const probe = (ang, dist = reach) => {
      let px = this.x, pz = this.z, py = this.y;
      for (let k = 1; k <= 3; k++) {
        const qx = this.x + Math.sin(ang) * dist * k / 3, qz = this.z + Math.cos(ang) * dist * k / 3;
        if (t.blocked(px, pz, qx, qz, py)) return false;
        const g = t.groundAt(qx, qz, py) || t.groundBelow(qx, qz, py + 0.5);
        if (!g || g.y < py - 6) return false;
        px = qx; pz = qz; py = g.y;
      }
      return true;
    };
    let blockedAhead = false;
    if (!probe(this.h) || !probe(this.h + 0.3, reach * 0.8) || !probe(this.h - 0.3, reach * 0.8)) {   // a corridor, not a single ray
      blockedAhead = true;
      if (this.avoid == null) {
        const l = probe(this.h + 0.8), r = probe(this.h - 0.8);
        this.avoid = l && !r ? 1 : r && !l ? -1 : probe(this.h + 1.6) ? 1 : probe(this.h - 1.6) ? -1 : (Math.random() < 0.5 ? 1 : -1);
      }
      want = this.h + this.avoid * 1.4;
    } else this.avoid = null;
    let diff = want - this.h;
    diff = Math.atan2(Math.sin(diff), Math.cos(diff));
    const steer = THREE.MathUtils.clamp(-diff * 2.5, -1, 1);   // steering right turns h negative
    return { throttle: blockedAhead ? 0.3 : Math.abs(diff) > 2.2 ? 0.5 : 1, brake: blockedAhead && this.v > 18 ? 0.8 : 0, steer, drift: false };
  }

  think(dt, karts) {
    if (this.free) return this.thinkFree(dt, karts);
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
    // regulate_cpu_speed: under the class minimum always accelerate; at or above the target speed decelerate 2
    if (this.v >= CPU_MIN_SPEED[this.cc] * MK_UNIT) {
      const tbl = CPU_TARGET[t.def.id] || CPU_TARGET.default, n = t.n;
      const straight = t.cpuStraight && t.cpuStraight[Math.floor((((this.s % t.length) + t.length) % t.length) / t.ds) % n];
      let cap = (straight || this.drift || this.air ? tbl.curve : tbl.normal)[this.cc];
      if (Math.abs(this.d) > 0.9 * HALF_WIDTH) cap = tbl.off[this.cc];
      if (this.v >= cap * MK_UNIT) return { throttle: 0, brake: 2 * CPU_SLOW_BRAKE, steer, drift: false };
      if (this.aiSpeed === 'slow') return { throttle: 0, brake: CPU_SLOW_BRAKE, steer, drift: false };
    }
    // our steering model still needs a lift in the tightest bends (not in MK64)
    return { throttle: sharp > 1.4 ? 0.2 : 1, brake: 0, steer, drift: false };
  }

  update(dt, input) {
    if (this.free) return this.updateFree(dt, input);
    const t = this.track;
    const absD = Math.abs(this.d);
    this.offroad = absD > HALF_WIDTH + 1.5;
    let scale = this.speedScale * (this.isPlayer ? 1 : 0.93 + 0.05 * this.skill);
    // CPU_FAST_EFFECT: unk_0E8 eases to 380 on top of the speed force currentSpeed^2 / 25 (func_80030150);
    // top velocity is linear in the force: (cs^2 / 25 + 380) / (cs^2 / 25)
    if (!this.isPlayer && this.aiSpeed === 'fast') scale *= 1 + 380 * 25 / (320 * 320 * this.speedScale);
    this.top = MAX_SPEED * scale;
    let max = (this.boost > 0 ? BOOST_SPEED : MAX_SPEED) * scale;
    if (this.offroad && this.boost <= 0) max *= 0.45;
    if (this.finished) input = { throttle: 0.3, brake: 0, steer: 0, drift: false };
    if (this.spin > 0) {
      this.spin -= dt; this.spinAngle += dt * 11;
      input = { throttle: 0, brake: 0, steer: 0, drift: false };
      if (this.spin <= 0) this.spinAngle = 0;
    }

    this.throttle = input.throttle > 0;   // kartProps THROTTLE (exhaust smoke rate)
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

  // Arena driving: the same speed / drift model, heading h integrated directly; the course collision mesh
  // gives the ground (slopes, ramps, upper decks) and steep faces are walls. Off an edge the kart falls; below
  // the course's fall height (lava, the void) it is put back on its start spot after a short rescue.
  updateFree(dt, input) {
    const t = this.track;
    this.offroad = false;
    this.top = MAX_SPEED * (this.isPlayer ? 1 : 0.93 + 0.05 * this.skill);
    let max = (this.boost > 0 ? BOOST_SPEED : MAX_SPEED) * (this.isPlayer ? 1 : 0.93 + 0.05 * this.skill);
    if (this.rescue > 0) {   // Lakitu: hang above the start spot, then drop in
      this.rescue -= dt; this.v = 0; this.drift = 0; this.boost = 0; this.spin = 0;
      this.x = this.spawn.x; this.z = this.spawn.z; this.h = this.spawn.h; this.air = false; this.vy = 0;
      const g = t.groundAt(this.x, this.z, this.spawn.y) || t.groundBelow(this.x, this.z, this.spawn.y + 0.5);   // the spot's floor
      this.y = (g ? g.y : this.spawn.y) + (this.rescue > 0 ? 4 : 0);
      this.syncFree(0);
      return;
    }
    if (this.finished || this.out) input = { throttle: 0, brake: 0, steer: 0, drift: false };
    if (this.spin > 0) {
      this.spin -= dt; this.spinAngle += dt * 11;
      input = { throttle: 0, brake: 0, steer: 0, drift: false };
      if (this.spin <= 0) this.spinAngle = 0;
    }
    this.throttle = input.throttle > 0;
    if (input.throttle > 0) {
      this.v += (14 + 10 * (1 - this.v / max)) * Math.max(0, 1 - this.v / max) * input.throttle * dt * 2.2;
      if (this.boost > 0) this.v += 40 * dt;
    }
    if (input.brake > 0) this.v -= (this.v > 0 ? 55 : 14) * input.brake * dt;
    this.v -= Math.sign(this.v) * 4 * dt;
    if (this.v > max) this.v = Math.max(max, this.v - (this.boost > 0 ? 0 : 30) * dt);
    this.v = Math.max(this.v, -12);
    if (this.boost > 0) this.boost -= dt;
    if (input.drift && !this.drift && this.v > 18 && Math.abs(input.steer) > 0.25) { this.drift = Math.sign(input.steer); this.driftTime = 0; }
    if (this.drift) {
      this.driftTime += dt;
      if (!input.drift || this.v < 12) {
        if (this.driftTime > 2.2) this.boost = 1.6; else if (this.driftTime > 1.1) this.boost = 0.8;
        this.drift = 0; this.driftTime = 0;
      }
    }
    let steer = input.steer;
    if (this.drift) steer = this.drift * 0.65 + steer * 0.55;
    const speedFactor = THREE.MathUtils.clamp(Math.abs(this.v) / 10, 0, 1) / (1 + Math.abs(this.v) / 90);
    this.steerVis += (input.steer - this.steerVis) * Math.min(1, dt * 12);
    const dir = this.v >= 0 ? 1 : -1;
    // right = fwd x up = (-cos h, 0, sin h): steering right turns h negative
    this.h -= steer * (this.drift ? 2.3 : 1.9) * speedFactor * dt * dir;
    // the nose points into the drift while the kart slides a little wide
    this.slip += ((this.drift ? this.drift * 0.35 : 0) - this.slip) * Math.min(1, (this.drift ? 1.6 : 9) * dt);
    if (this.drift) this.v -= 2 * dt;
    const a = this.h + this.slip, step = this.v * dt;
    let nx = this.x + Math.sin(a) * step, nz = this.z + Math.cos(a) * step;
    // walls: slide along by trying each axis alone, else stop
    if (!this.air && t.blocked(this.x, this.z, nx, nz, this.y)) {
      const hit = () => { this.v *= 0.82; this.hitWall = 0.25; this.drift = 0; };
      if (!t.blocked(this.x, this.z, nx, this.z, this.y)) { nz = this.z; hit(); }
      else if (!t.blocked(this.x, this.z, this.x, nz, this.y)) { nx = this.x; hit(); }
      else { nx = this.x; nz = this.z; this.v *= 0.3; this.hitWall = 0.25; this.drift = 0; }
    }
    this.hitWall = Math.max(0, this.hitWall - dt);
    this.x = nx; this.z = nz;
    this.syncFree(dt);
  }

  syncFree(dt = 0) {
    const t = this.track, x = this.x, z = this.z;
    this.fwd.set(Math.sin(this.h), 0, Math.cos(this.h));
    let g = this.air ? t.groundBelow(x, z, this.y + 0.5) : t.groundAt(x, z, this.y);
    if (!g && !this.air) g = t.groundBelow(x, z, this.y + 0.5);   // rolled off an edge: whatever is below
    const accel = () => -KART_GRAVITY * GRAVITY_SCALE - AIR_DRAG * this.vy;
    if (!dt) { if (g && !this.rescue) this.y = g.y; this.vy = 0; this.air = false; }
    else if (this.air) {
      this.vy += accel() * dt; this.y += this.vy * dt;
      if (g && this.y <= g.y) { this.air = false; this.y = g.y; this.vy = 0; }
    } else if (g) {
      const fall = this.y + (this.vy + accel() * dt) * dt;
      if (g.y < fall - 0.05) { this.air = true; this.vy += accel() * dt; this.y = fall; }
      else { this.y = g.y; this.vy = 0; }
    } else { this.air = true; this.vy += accel() * dt; this.y += this.vy * dt; }
    if (this.y <= t.fallY + 0.3 && dt) { this.rescue = 1.5; this.air = false; this.vy = 0; this.invuln = Math.max(this.invuln, 2.5); }   // fell into the lava / off the arena
    this.world.set(x, this.y, z);
    this.groundY = this.y;
    const n = g && !this.air ? g.normal : null;
    this.groundN = n ? (this.groundN || n.clone()).lerp(n, 0.25).normalize() : (this.groundN || new THREE.Vector3(0, 1, 0));
    this.up.copy(this.groundN);
    this.fwd.addScaledVector(this.up, -this.fwd.dot(this.up)).normalize();
    const right = new THREE.Vector3().crossVectors(this.fwd, this.up).normalize();
    this.up.crossVectors(right, this.fwd).normalize();
    const m = new THREE.Matrix4().makeBasis(right, this.up, this.fwd.clone().negate());
    this.mesh.quaternion.setFromRotationMatrix(m);
    this.mesh.userData.lean = this.steerVis * 0.08 + (this.drift ? this.drift * 0.12 : 0);
    this.mesh.userData.spinning = this.spin > 0;
    if (this.spinAngle) this.mesh.quaternion.multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), this.spinAngle));
    this.mesh.position.copy(this.world);
    const bob = performance.now() / 1000;
    this.balloonMeshes.forEach((m, i) => { m.visible = i < this.balloons; m.position.y = m.userData.base + Math.sin(bob * 2 + i * 2.1) * 0.15; });
  }

  syncMesh(dt = 0) {
    if (this.free) return this.syncFree(dt);
    const t = this.track;
    t.frameAt(this.s, this.frame);
    const f = this.frame;
    this.fwd.copy(f.T).multiplyScalar(Math.cos(this.psi)).addScaledVector(f.R, Math.sin(this.psi)).normalize();
    this.world.copy(f.pos).addScaledVector(f.R, this.d).addScaledVector(f.U, 0.0);
    const { x, z } = this.world, px = this.prevX ?? x, pz = this.prevZ ?? z;
    this.prevX = x; this.prevZ = z;
    // native courses: sit on the real surface (embankments, banked turns) instead of the route plane
    let g = null;
    if (t.groundAt) {
      if (this.air) g = t.groundBelow(x, z, this.y + 0.5);
      else {
        g = t.groundAt(x, z, this.groundY ?? this.world.y);
        // climbing off a ramp lip over a gap: fly. Rolling off any other edge keeps the old route-plane fallback
        // (there is no Lakitu rescue, so falling into water/void would strand the kart)
        if (!g && this.groundY != null && this.vy > 0.5) g = t.groundBelow(x, z, this.groundY + 0.5);
      }
    }
    // ballistic height: leave the ground when it falls away faster than gravity (ramp lips, crests)
    if (this.y == null || !dt) { if (g) this.y = g.y; this.vy = 0; this.air = false; this.dac = 1; this.ramp = null; }
    else {
      // BOOST_RAMP_* surface: trigger_*_ramp_boost / apply_boost_ramp_*_effect hold top speed until touchdown
      if (!this.air && g && g.ramp) this.ramp = g.ramp;
      if (this.ramp) this.v = Math.max(this.v, this.top ?? MAX_SPEED);
      // func_8002AB70: unk_DAC eases to the ramp's value (1/frame), else back to 1 (0.07/frame); >= 50 units up: 2
      const target = this.ramp ? RAMP_AIR[this.ramp].dac : 1, step = (this.ramp ? 1 : 0.07) * MK_FPS * dt;
      this.dac = this.dac + THREE.MathUtils.clamp(target - this.dac, -step, step);
      if (this.air && !this.ramp && g && this.y - g.y >= 5) this.dac = 2 - 0.07;
      const accel = () => (-(this.ramp ? RAMP_AIR[this.ramp].gravity : KART_GRAVITY) * GRAVITY_SCALE - AIR_DRAG * this.vy) / this.dac;
      if (this.air) {
        this.vy += accel() * dt; this.y += this.vy * dt;
        // no Lakitu rescue: outside a ramp flight, ground well below the route (water, void) is floored at the route
        const floor = !this.ramp && (!g || g.y < f.pos.y - 4) ? f.pos.y : g ? g.y : -Infinity;
        if (this.y <= floor) {
          this.air = false; this.y = floor; this.vy = 0;
          if (!g || floor !== g.y) g = null;   // landed on the route plane
          if (!g || !g.ramp) this.ramp = null;
        }
        else if (!g && this.y < f.pos.y - 30) { this.air = false; this.y = f.pos.y; this.vy = 0; this.ramp = null; }   // fell into the void
      } else if (g) {
        const fall = this.y + (this.vy + accel() * dt) * dt;
        if (g.y < fall - 0.05) { this.air = true; this.vy += accel() * dt; this.y = fall; }
        else {
          const n = g.normal;   // vertical speed of the slope under the kart (not frame-to-frame, so steps don't launch)
          this.vy = n.y > 0.2 ? THREE.MathUtils.clamp(-(n.x * (x - px) + n.z * (z - pz)) / (n.y * dt), -0.6 * Math.abs(this.v), 0.6 * Math.abs(this.v)) : 0;
          this.y = g.y;
          if (!g.ramp) this.ramp = null;
        }
      }
    }
    if (g && !this.air) {
      this.groundY = g.y; this.world.y = g.y;
      this.groundN = (this.groundN || g.normal.clone()).lerp(g.normal, 0.25).normalize();
      this.up.copy(this.groundN);
      this.fwd.addScaledVector(this.up, -this.fwd.dot(this.up)).normalize();   // pitch with the slope
    } else if (this.air) {
      this.groundY = this.y; this.world.y = this.y;
      this.up.copy(this.groundN || f.U);
      this.fwd.addScaledVector(this.up, -this.fwd.dot(this.up)).normalize();
    } else {
      this.y = this.world.y; this.vy = 0;
      this.groundY = this.world.y; this.groundN = null;
      this.up.copy(f.U);
    }
    const right = new THREE.Vector3().crossVectors(this.fwd, this.up).normalize();
    this.up.crossVectors(right, this.fwd).normalize();
    const m = new THREE.Matrix4().makeBasis(right, this.up, this.fwd.clone().negate());
    this.mesh.quaternion.setFromRotationMatrix(m);
    // body-roll when drifting / steering
    this.mesh.userData.lean = this.steerVis * 0.08 + (this.drift ? this.drift * 0.12 : 0);
    this.mesh.userData.spinning = this.spin > 0;
    if (this.spinAngle) this.mesh.quaternion.multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), this.spinAngle));
    this.mesh.position.copy(this.world);
  }
}
