import * as THREE from 'three';
import { HALF_WIDTH } from './track.js';
import * as HD from './hd.js';

const MAX_SPEED = 44;
const BOOST_SPEED = 62;
// Engine classes: gTopSpeedTable (src/data/kart_attributes.c), per gCCSelection and characterId
// (Mario Luigi Yoshi Toad DK Wario Peach Bowser). MAX_SPEED is the 150cc Mario 320; Extra (mirror) races 100cc.
// CC_BATTLE (defines.h 4) is only a top speed row (gTopSpeedBattle, 245); the CPU tables stop at CC_EXTRA.
export const CC_INDEX = { 50: 0, 100: 1, 150: 2, extra: 3 }, CC_BATTLE = 4;
const TOP_SPEED = [
  [290, 290, 294, 294, 290, 290, 294, 290],
  [310, 310, 314, 314, 310, 310, 314, 310],
  [320, 320, 324, 324, 320, 320, 324, 320],
  [310, 310, 314, 314, 310, 310, 314, 310],
  [245, 245, 245, 245, 245, 245, 245, 245],
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
// Speedometer km/h, code_80057C60.c func_8005C360((player->speed / 18) * 216): 150cc Mario tops out at 70.6.
export const speedKmh = v => Math.abs(v) / MK_UNIT / 18 * 216;
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
  const humans = order.filter(k => k.isPlayer || (k.remote && !k.cpu));
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
// A grounded kart only leaves the ground once the arc it would fly from a crest clears the ground by this much
// (units, ~4 MK64 units): seams and gentle crests keep it on the road at any frame rate, ramp lips and bumps
// still launch. Assumption: tuned value, not from the ROM.
const LIFT = 0.4;
// Item hit tumbles, effects.c, stepped per 60 Hz player tick (gTickSpeed 2 at 30 fps). low: green shell
// (func_8008C528 / func_8008C62C, HIT_BY_GREEN_SHELL_EFFECT): hop D_800E3790 / jerk D_800E37B0, kartGravity 1100,
// currentSpeed -5 a tick, frame counter unk_0A8 +0xA0 for 2 laps of 0x2000. high: red / blue shell, star
// (trigger_high_tumble / apply_hit_by_star_effect, HIT_BY_STAR_EFFECT): hop D_800E3710 2.2 / jerk D_800E3730 0.002,
// gravity 800, drive force halved (velocity drags out), +0x90 for 4 laps or until 4 ticks on the ground. vertical:
// fake item box (trigger_vertical_tumble / func_8008E4A4, EXPLOSION_CRASH_EFFECT): same hop, gravity 550, the kart
// stops dead, +0x80, 3 ground ticks. The sprite is gKartTextureTumbles[unk_0A8 >> 8] (kart frames 289-320).
const TUMBLE = {
  low: { hop: c => (c === 0 ? 1.2 : 1.45), jerk: 0.01, gravity: 1100, step: 0xA0, laps: 2, ground: Infinity },
  high: { hop: () => 2.2, jerk: 0.002, gravity: 800, step: 0x90, laps: 4, ground: 4 },
  vertical: { hop: () => 2.2, jerk: 0.002, gravity: 550, step: 0x80, laps: 4, ground: 3 },
};
const TICK = 1 / 60, DRAG = 0.12 * 5800 / 6000;
// Kart height model, toggled in game with J (saved): Jumps steps the decomp's vertical speed and ground push-out
// per 60 Hz tick (Kart.tickHeight); Glue (default) keeps the kart on the road and only flies off a
// BOOST_RAMP_* lip or a drop of more than GLUE_DROP
export const PHYSICS = { glue: globalThis.localStorage?.getItem('kartPhysics') !== 'jumps' };
export function togglePhysics() {
  PHYSICS.glue = !PHYSICS.glue;
  globalThis.localStorage?.setItem('kartPhysics', PHYSICS.glue ? 'glue' : 'jumps');
  return physicsLabel();
}
export const physicsLabel = () => `Kart physics: ${PHYSICS.glue ? 'Glue' : 'Jumps'}`;
const GLUE_DROP = 1, UP = new THREE.Vector3(0, 1, 0);
// Battle balloons (Kart.makeBalloons). render_battle_balloon prim / env colours per characterId, prim alpha 0xD8;
// update_player_one_balloon_position sp80 heights; update_player_balloons_position (x, z) offsets.
const BALLOON_PRIM = [0xC80100, 0x007001, 0x107951, 0x005970, 0x705500, 0x7A7E00, 0x772C24, 0x301458];
const BALLOON_ENV = [0xDC0000, 0x008C06, 0x000051, 0, 0, 0, 0, 0];
const BALLOON_ALPHA = 0xD8 / 255, BALLOON_FAN = 0x1C70 * Math.PI / 32768, DEG1 = Math.PI / 180;
const BALLOON_Y = [9, 10, 9, 8, 10, 9.5, 9.5, 11];
const BALLOON_AT = [[0, -3.2], [1.8, 2.6 - 3.2], [-1.8, 2.6 - 3.2]];
const K_UNIT = 0.25;   // MK64 units at the kart sprites' size (items.js BOX_SCALE)
const KART_RADIUS = [5.5, 5.5, 5.5, 5.5, 5.5, 6.0, 5.5, 6.0].map(r => r * 0.1);   // gKartBoundingBoxSizeTable, NATIVE_SCALE
const WALL_SLOW = 18 / 320 * MAX_SPEED;   // player_decelerate_alternative(18) on currentSpeed (top ~320)
const _bRight = new THREE.Vector3(), _bCam = new THREE.Vector3(), _bX = new THREE.Vector3(), _bZ = new THREE.Vector3();
const _bUp = new THREE.Vector3(0, 1, 0), _bS = new THREE.Vector3(), _bM = new THREE.Matrix4(), _bR = new THREE.Matrix4();
// gBalloonVertexPlane1 (y 9..18, gTextureBalloon1) over gBalloonVertexPlane2 (y 0..9, the first 28 rows of
// gTextureBalloon2), x +-9, 6 units behind the knot; balloon.png stacks the two 64x32 textures.
let balloonGeo = null;
function balloonGeometry() {
  if (balloonGeo) return balloonGeo;
  const u = 63 / 64, p = [], uv = [];
  for (const [y0, y1, v0, v1] of [[9, 18, 0.5, 1], [0, 9, 1 - 60 / 64, 0.5]]) {
    p.push(-9, y1, -6, 9, y1, -6, 9, y0, -6, -9, y0, -6);
    uv.push(0, v1, u, v1, u, v0, 0, v0);
  }
  balloonGeo = new THREE.BufferGeometry();
  balloonGeo.setAttribute('position', new THREE.Float32BufferAttribute(p, 3));
  balloonGeo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  balloonGeo.setIndex([0, 2, 1, 0, 3, 2, 4, 6, 5, 4, 7, 6]);
  return balloonGeo;
}

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
  // func_8004B614's combiner (1 - ENV) * TEXEL0 + PRIM with ENV 0: the item effects' prim colour added to the
  // texel in the N64's gamma space (items.js fxStep sets it)
  const prim = { value: new THREE.Color(0, 0, 0) };
  material.userData.prim = prim;
  // Sherbet Land's frozen kart (lakitu.js, render_player.c func_800235AC FRIGID / THAWING): its own prim colour on
  // top and the ENV colour that takes its share out of the texel
  const coldPrim = { value: new THREE.Color(0, 0, 0) }, env = { value: new THREE.Color(0, 0, 0) };
  material.onBeforeCompile = shader => {
    Object.assign(shader.uniforms, { uPrim: prim, uColdPrim: coldPrim, uEnv: env });
    shader.fragmentShader = 'uniform vec3 uPrim, uColdPrim, uEnv;\n' + shader.fragmentShader.replace('#include <map_fragment>',
      '#include <map_fragment>\n  diffuseColor.rgb = pow(min(pow(diffuseColor.rgb, vec3(1.0 / 2.2)) * (1.0 - uEnv) + uPrim + uColdPrim, 1.0), vec3(2.2));');
  };
  g.userData.setCold = (p, e) => { coldPrim.value.setRGB(p[0] / 255, p[1] / 255, p[2] / 255); env.value.setRGB(e[0] / 255, e[1] / 255, e[2] / 255); };
  const sprite = new THREE.Sprite(material);
  sprite.center.set(0.5, 0);
  sprite.scale.set(4.5, 4.5, 1);
  g.add(sprite);
  const cameraPosition = new THREE.Vector3(), local = new THREE.Vector3(), inverse = new THREE.Quaternion();
  sprite.onBeforeRender = (_renderer, _scene, camera) => {
    camera.getWorldPosition(cameraPosition);
    g.getWorldQuaternion(inverse).invert();
    local.copy(cameraPosition).sub(g.position).applyQuaternion(inverse);
    // unmirrored MK64 frames show the kart's left flank (nose to screen-left), i.e. camera on local -x.
    // EXTRA (camera.userData.mirror): the frame for the mirrored course's view, pre-flipped so the mirrored
    // projection draws it the way the ROM's sprite reads
    const flip = !!camera.userData.mirror;
    const view = kartSpriteFrame(Math.atan2(flip ? local.x : -local.x, local.z), g.userData.spinning);
    if (g.userData.tumble != null) view.frame = 289 + g.userData.tumble;   // gKartTextureTumbles, still mirrored by view
    const column = view.frame % 21, row = Math.floor(view.frame / 21), back = view.mirrored !== flip;
    map.repeat.set((back ? -1 : 1) / 21, 1 / 16);
    map.offset.set((column + (back ? 1 : 0)) / 21, 1 - (row + 1) / 16);
    material.rotation = g.userData.lean || 0;
    sprite.scale.y = 4.5 * (1 - (g.userData.squash || 0));   // landing bounce (Kart.stepBounce)
    sprite.userData.frame = view.frame;
    sprite.userData.mirrored = view.mirrored;
  };
  g.userData.character = character;
  // Lakitu fades a fished-out kart (player->alpha, LAKITU_FIZZLE)
  g.userData.setAlpha = a => {
    if (material.transparent !== a < 1) { material.transparent = a < 1; material.depthWrite = a >= 1; material.needsUpdate = true; }
    material.opacity = a;
  };
  g.userData.dispose = () => { map.dispose(); material.dispose(); };
  return g;
}

export class Kart {
  constructor(track, { color, s, d, isPlayer = false, skill = 1, name = 'Racer', character = 'mario', spawn = null, speedScale = 1, cc = 2 }) {
    this.track = track; this.isPlayer = isPlayer; this.skill = skill; this.name = name; this.speedScale = speedScale; this.cc = cc;
    this.s = s; this.psi = 0; this.phi = 0; this.v = 0;
    // inside the walls from the first ground lookup: a grid spot past the road's edge (Frappe Snowland's bridge)
    // would otherwise seed groundY from the ground beside the road and the kart would start on it, under the deck
    this.d = track.arena ? d : THREE.MathUtils.clamp(d, -(track.wallAt(s, -1) - 1.2), track.wallAt(s, 1) - 1.2);
    // arena (battle) kart: roams freely as (x, z, heading h) with facing (sin h, 0, cos h); spawn = { x, y, z, h }
    this.free = !!track.arena;
    if (this.free) {
      this.spawn = spawn; this.x = spawn.x; this.z = spawn.z; this.h = spawn.h; this.slip = 0; this.rescue = 0; this.balloons = 3;
      const g = track.groundAt(spawn.x, spawn.z, spawn.y) || track.groundBelow(spawn.x, spawn.z, spawn.y + 0.5);
      this.y = g ? g.y : spawn.y;
    }
    this.mesh = buildKartMesh(character);
    this.color = color;
    if (this.free) this.makeBalloons(character);
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

  // gKartBoundingBoxSizeTable, MK64 units (has_collided_horizontally_with_player)
  get boxSize() { return KART_RADIUS[CHARACTER_ID[this.mesh.userData.character] ?? 0] * 10; }

  // func_8008933C: a critter (Sherbet Land's penguins) at (ox, oz) moving (ovx, ovz) bonks the kart. The shove
  // D_8018CE10 unk_04 is -velocity * a2 on each axis, plus the critter's velocity * a3 where the kart is on the side
  // it moves towards; then 4 ticks before the next (unk_18[6]). MK64 units a frame; returns the shove squared.
  // func_8002C7E4 -> func_8002B9CC (CRITTER_TOUCH, not under a mushroom): a shove of 6.5 or more quarters currentSpeed
  // (velocity ~ currentSpeed^2) and spins the kart out (add_spinout_effect).
  bonk(ox, oz, ovx, ovz, a2, a3) {
    if (this.bonkWait > 0) return 0;
    this.bonkWait = 4;
    const f = this.frame, u = this.v / (0.1 * MK_FPS), c = Math.cos(this.phi), s = Math.sin(this.phi);
    const vx = (f.T.x * c + f.R.x * s) * u, vz = (f.T.z * c + f.R.z * s) * u;
    const kx = this.world.x * 10, kz = this.world.z * 10;
    this.push = [-vx * a2 + ((kx - ox) * ovx >= 0 ? ovx * a3 : 0), -vz * a2 + ((kz - oz) * ovz >= 0 ? ovz * a3 : 0)];
    const m2 = this.push[0] ** 2 + this.push[1] ** 2;
    if (!(this.boost > 0) && Math.sqrt(m2) >= 6.5) {
      this.v /= 16; this.drift = 0;
      if (!(this.spin > 0)) this.spin = 1.1;
    }
    return m2;
  }

  // func_800892E0: the shove moves the kart on top of its velocity (nextX = pos + velocity + unk_04) and steps
  // towards 0 at Sherbet Land's rates (func_80089020, faster while spinning out) every tick
  shoveStep(dt, denom) {
    const n = MK_FPS * dt;
    if (this.bonkWait > 0) this.bonkWait = Math.max(0, this.bonkWait - n);
    if (!this.push) return;
    const f = this.frame, px = this.push[0] * 0.1 * n, pz = this.push[1] * 0.1 * n, spun = this.spin > 0;
    this.s += (px * f.T.x + pz * f.T.z) / denom; this.d += px * f.R.x + pz * f.R.z;
    this.push = this.push.map(p => {
      const a = Math.abs(p), step = (a <= 0.5 ? 0.025 : a <= 2 ? 0.075 : a <= 4 ? (spun ? 0.15 : 0.1) : (spun ? 0.25 : 0.15)) * n;
      return a <= step ? 0 : p - Math.sign(p) * step;
    });
    if (!this.push[0] && !this.push[1]) this.push = null;
  }

  // mode: 'low' | 'high' | 'vertical' (TUMBLE). lift is the hop height above the kart's ground in MK64 units.
  startTumble(mode) {
    const c = TUMBLE[mode];
    this.spin = 0; this.spinAngle = 0; this.drift = 0; this.boost = 0;
    this.tumble = { mode, a8: 0, laps: c.laps, ground: 0, lift: 0, vy: 0, hop: c.hop(CHARACTER_ID[this.mesh.userData.character] ?? 0),
      acc: 0, jerk: c.jerk, t: 0 };
  }

  tumbleUpdate(dt) {
    for (this.tumble.t += dt; this.tumble && this.tumble.t >= TICK; ) { this.tumble.t -= TICK; this.tumbleTick(); }
  }

  // one 60 Hz tick: the effect (func_8008C62C / apply_hit_by_star_effect / func_8008E4A4), then the hop
  // (func_8002AAC0: acceleration -= jerk within +-9, velocity += acceleration up to 15, ends at 0) and kartGravity
  // on velocity[1] with the 0.12 * kartFriction drag, both added to the height (func_8002B9CC nextY)
  tumbleTick() {
    const T = this.tumble, c = TUMBLE[T.mode], top = this.top || MAX_SPEED;
    if (T.mode === 'low') {   // player_decelerate_alternative(player, 5): velocity ~ currentSpeed^2
      const cs = Math.max(0, 320 * Math.sqrt(Math.max(0, this.v) / top) - 5);
      this.v = top * (cs / 320) ** 2;
    } else {
      if (T.lift <= 0 && ++T.ground >= c.ground) { this.tumble = null; return; }   // unk_0E0
      this.v = T.mode === 'vertical' ? 0 : this.v * (1 - DRAG);
    }
    T.a8 += c.step;
    if (T.a8 >= 0x2000) {
      T.a8 = 0;
      if (--T.laps === 0) { if (T.mode === 'low') this.v = 0; this.tumble = null; return; }   // unk_236
    }
    T.acc = THREE.MathUtils.clamp(T.acc - T.jerk, -9, 9);
    T.hop = Math.min(15, T.hop + T.acc);
    if (T.hop <= 0) T.hop = T.acc = T.jerk = 0;
    T.vy += (-c.gravity - T.vy * 0.12 * 5800) / 6000;
    T.lift += T.hop + T.vy;
    if (T.lift <= 0) { T.lift = 0; T.vy = 0; }
  }

  // Can the kart drive straight to (x, y, z)? Ground sampled every 3 units: no wall, no hole, no step over 2.5
  // units, and it arrives on the point's floor (the battle mode has no CPU drivers on the console, so no ROM paths).
  clearPath(x, y, z) {
    const t = this.track, n = Math.max(1, Math.ceil(Math.hypot(x - this.x, z - this.z) / 3));
    let px = this.x, pz = this.z, py = this.y;
    for (let k = 1; k <= n; k++) {
      const qx = this.x + (x - this.x) * k / n, qz = this.z + (z - this.z) * k / n;
      if (t.blocked(px, pz, qx, qz, py)) return false;
      const g = t.groundAt(qx, qz, py) || t.groundBelow(qx, qz, py + 0.5);
      if (!g || Math.abs(g.y - py) > 2.5) return false;
      px = qx; pz = qz; py = g.y;
    }
    return Math.abs(py - y) < 2;
  }

  // Arena CPU: chase the nearest opponent it can drive straight to; when walls or another floor are in the way,
  // drive via the item box spots (on every deck and ramp), picking the reachable one that is closest to an
  // opponent. Re-planned twice a second; walls and edges ahead still turn it towards the open side.
  thinkFree(dt, karts) {
    const t = this.track;
    this.plan = (this.plan ?? 0) - dt;
    if (this.plan <= 0) {
      this.plan = 0.5;
      const foes = karts.filter(o => o !== this && !o.out && !(o.rescue > 0)).sort((a, b) =>
        Math.hypot(a.x - this.x, a.z - this.z) - Math.hypot(b.x - this.x, b.z - this.z));
      this.goal = foes.find(o => this.clearPath(o.x, o.y, o.z)) || null;
      if (!this.goal && foes.length) {
        if (!t.navSpots) t.navSpots = t.def.native.itemBoxes.map(([x, y, z]) => {
          const g = t.groundBelow(x * 0.1, z * 0.1, y * 0.1 + 0.5);   // NATIVE_SCALE
          return g && { x: x * 0.1, y: g.y, z: z * 0.1 };
        }).filter(Boolean);
        const near = (p, o) => Math.hypot(p.x - o.x, p.z - o.z) + 4 * Math.abs(p.y - o.y);
        let best = Infinity;
        for (const p of t.navSpots) {
          if (p === this.lastSpot || Math.hypot(p.x - this.x, p.z - this.z) < 4 || !this.clearPath(p.x, p.y, p.z)) continue;
          const cost = Math.min(...foes.map(o => near(p, o))) + 0.3 * Math.hypot(p.x - this.x, p.z - this.z);
          if (cost < best) { best = cost; this.goal = p; }
        }
      }
    }
    const target = this.goal && !this.goal.out ? this.goal : null;
    if (target && !(target instanceof Kart) && Math.hypot(target.x - this.x, target.z - this.z) < 4) { this.lastSpot = target; this.plan = 0; }
    this.wander = (this.wander ?? 0) + (Math.random() - 0.5) * dt * 2;
    this.wander = THREE.MathUtils.clamp(this.wander, -0.8, 0.8);
    let want = target ? Math.atan2(target.x - this.x, target.z - this.z) + this.wander * 0.2 : this.h + this.wander;
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
    // nose stuck on a wall: no speed means no steering, so back off for a moment turning towards the open side
    // (reversing, steering right turns h positive)
    if (this.reverse > 0) { this.reverse -= dt; return { throttle: 0, brake: 1, steer: this.avoid || 1, drift: false }; }
    this.stuckT = Math.abs(this.v) < 3 && !(this.spin > 0) && !this.tumble ? (this.stuckT || 0) + dt : 0;
    if (this.stuckT > 0.7) { this.stuckT = 0; this.reverse = 0.9; }
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
    if (this.rescue) { this.v = 0; this.drift = 0; this.boost = 0; this.spin = 0; this.spinAngle = 0; return; }   // held by Lakitu (src/lakitu.js)
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
    if (this.tumble) { this.tumbleUpdate(dt); input = { throttle: 0, brake: 0, steer: 0, drift: false }; }

    this.throttle = input.throttle > 0;   // kartProps THROTTLE (exhaust smoke rate)
    // longitudinal
    if (input.throttle > 0) {
      this.v += (14 + 10 * (1 - this.v / max)) * Math.max(0, 1 - this.v / max) * input.throttle * dt * 2.2;
      if (this.boost > 0) this.v += 40 * dt;
    }
    if (input.brake > 0) this.v -= (this.v > 0 ? 55 : 14) * input.brake * dt;
    // coasting drag fades out with the throttle: at full throttle it held the kart at 88% of max, below the
    // decomp's terminal velocity (force / (0.12 * kartFriction)), e.g. 62 instead of 70.6 km/h for 150cc Mario
    this.v -= Math.sign(this.v) * 4 * dt * (1 - Math.max(0, input.throttle));
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
    // the player can turn all the way round (detect_wrong_player_direction -> Lakitu's reverse sign), wrapped to
    // +-180 degrees with phi alongside; CPU karts keep to +-83 degrees of the course
    if (!this.isPlayer) this.psi = THREE.MathUtils.clamp(this.psi, -1.45, 1.45);
    else if (Math.abs(this.psi) > Math.PI) { const w = Math.sign(this.psi) * 2 * Math.PI; this.psi -= w; this.phi -= w; }
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
    this.shoveStep(dt, denom);
    const yaw = k * ds;                 // frame rotates under us
    this.psi -= yaw; this.phi -= yaw;

    // walls
    const sgn = Math.sign(this.d), wall = t.wallAt(this.s, sgn) - 1.2;
    if (Math.abs(this.d) > wall) {
      this.d = sgn * wall;
      const into = sgn * Math.sin(this.phi) * this.v;
      // moving into the wall: the velocity's part into it is lost, the part along it stays (func_8002C954 /
      // Track.wallPush), and a fresh hit slows the kart by 18 currentSpeed units (player_decelerate_alternative).
      // (Not a per-frame fraction: that scaled with the frame rate and, with no speed to steer with, pinned a kart
      // that grazed a wall at the bridge edges of Frappe Snowland's grid, Bowser's Castle, Banshee Boardwalk.)
      if (into > 0) {
        this.v *= Math.abs(Math.cos(this.phi));
        if (this.hitWall <= 0) this.v = Math.sign(this.v) * Math.max(0, Math.abs(this.v) - WALL_SLOW);
        this.hitWall = 0.25;
      }
      // turned away from the wall: toward the course, or toward straight back when facing the wrong way
      const off = a => Math.abs(a) > Math.PI / 2 ? Math.sign(a) * Math.PI - (Math.sign(a) * Math.PI - a) * 0.4 : a * 0.4;
      if (sgn * this.psi > 0) this.psi = off(this.psi);
      if (sgn * this.phi > 0) this.phi = off(this.phi);
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
    const scale = this.speedScale * (this.isPlayer ? 1 : 0.93 + 0.05 * this.skill);   // gTopSpeedBattle row
    this.top = MAX_SPEED * scale;
    let max = (this.boost > 0 ? BOOST_SPEED : MAX_SPEED) * scale;
    if (this.rescue > 0) {   // Lakitu: hang above the start spot, then drop in
      this.rescue -= dt; this.v = 0; this.drift = 0; this.boost = 0; this.spin = 0;
      this.x = this.spawn.x; this.z = this.spawn.z; this.h = this.spawn.h; this.air = false; this.vy = 0;
      const g = t.groundAt(this.x, this.z, this.spawn.y) || t.groundBelow(this.x, this.z, this.spawn.y + 0.5);   // the spot's floor
      this.y = (g ? g.y : this.spawn.y) + (this.rescue > 0 ? 4 : 0);
      // effects.c (Lakitu rescue, state 4): letting go of the kart in BATTLE pops a balloon (pop_player_balloon)
      if (this.rescue <= 0) this.balloons = Math.max(0, this.balloons - 1);
      this.syncFree(0);
      return;
    }
    if (this.finished || this.out) input = { throttle: 0, brake: 0, steer: 0, drift: false };
    if (this.spin > 0) {
      this.spin -= dt; this.spinAngle += dt * 11;
      input = { throttle: 0, brake: 0, steer: 0, drift: false };
      if (this.spin <= 0) this.spinAngle = 0;
    }
    if (this.tumble) { this.tumbleUpdate(dt); input = { throttle: 0, brake: 0, steer: 0, drift: false }; }
    this.throttle = input.throttle > 0;
    if (input.throttle > 0) {
      this.v += (14 + 10 * (1 - this.v / max)) * Math.max(0, 1 - this.v / max) * input.throttle * dt * 2.2;
      if (this.boost > 0) this.v += 40 * dt;
    }
    if (input.brake > 0) this.v -= (this.v > 0 ? 55 : 14) * input.brake * dt;
    this.v -= Math.sign(this.v) * 4 * dt * (1 - Math.max(0, input.throttle));   // as in update()
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
    // walls, in the air too (func_8003F734 / func_8002A5F4 / func_8002C954): the kart's bounding sphere
    // (gKartBoundingBoxSizeTable) is pushed back out of the face; of the velocity, the part along the wall is kept
    // and the part into it bounces back at half; the drift ends and the kart slows by 18 (player_decelerate_alternative)
    const w = t.wallPush(this.x, this.z, nx, nz, this.y, KART_RADIUS[CHARACTER_ID[this.mesh.userData.character] ?? 0]);
    if (w) {
      nx = w.x; nz = w.z;
      const mx = Math.sin(a) * this.v, mz = Math.cos(a) * this.v, vn = mx * w.nx + mz * w.nz;
      if (vn < 0) {
        const bx = mx - 1.5 * vn * w.nx, bz = mz - 1.5 * vn * w.nz;
        // keep the nose: the new motion becomes speed (backwards if it points behind the kart) plus slip
        let rel = Math.atan2(bx, bz) - this.h, sp = Math.max(0, Math.hypot(bx, bz) - WALL_SLOW);
        rel = Math.atan2(Math.sin(rel), Math.cos(rel));
        if (Math.abs(rel) > Math.PI / 2) { sp = -sp; rel = Math.atan2(Math.sin(rel + Math.PI), Math.cos(rel + Math.PI)); }
        this.v = sp; this.slip = rel; this.drift = 0; this.hitWall = 0.25;
      }
    }
    this.hitWall = Math.max(0, this.hitWall - dt);
    this.x = nx; this.z = nz;
    this.syncFree(dt);
  }

  syncFree(dt = 0) {
    const t = this.track, x = this.x, z = this.z, px = this.prevX ?? x, pz = this.prevZ ?? z;
    this.prevX = x; this.prevZ = z;
    this.fwd.set(Math.sin(this.h), 0, Math.cos(this.h));
    let g = this.air ? t.groundBelow(x, z, this.y + 0.5) : t.groundAt(x, z, this.y);
    if (!g && !this.air) g = t.groundBelow(x, z, this.y + 0.5);   // rolled off an edge: whatever is below
    const accel = (vy = this.vy) => -KART_GRAVITY * GRAVITY_SCALE - AIR_DRAG * vy;
    if (!dt) { if (g && !this.rescue) this.y = g.y; this.vy = 0; this.air = false; this.arc = null; }
    else if (this.air) {
      this.vy += accel() * dt; this.y += this.vy * dt;
      if (g && this.y <= g.y) { this.air = false; this.y = g.y; this.vy = 0; }
    } else if (g) this.rideGround(g, this.slopeRate(g, x - px, z - pz, dt), accel, dt);
    else { this.air = true; this.arc = null; this.vy += accel() * dt; this.y += this.vy * dt; }
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
    this.mesh.userData.tumble = this.tumble ? this.tumble.a8 >> 8 : null;
    if (this.tumble) this.mesh.position.addScaledVector(this.up, this.tumble.lift * 0.1);   // MK64 units at course scale 0.1
  }

  // Battle balloons (code_80057C60.c). update_player_one_balloon_position: each hangs from a point
  // BALLOON_Y[characterId] units over the kart's ground at (x, z) BALLOON_AT, pushed back speed_kmh / 10 units;
  // its lean D_8018D890 eases to player->speed degrees (move_s16_towards 0.1 a frame). render_battle_balloon: the
  // 18 x 18 card turned to the camera, rolled by its fan angle (init_all_player_balloons 0 / +-0x1C70) where the
  // camera sees the kart from behind, leaning back 4x / sideways 8x the lean, scaled 0.3 on the kart's own screen
  // and distance / 300 (0.3..1.8) on the others. A popped balloon (pop_player_balloon, BALLOON_STATUS_DEPARTING)
  // stops where it was and rises 0.2 units a frame for 0x78 frames.
  makeBalloons(character) {
    const map = HD.loadTexture('items/balloon.png');
    map.colorSpace = THREE.SRGBColorSpace;
    const id = CHARACTER_ID[character] ?? 0, rgb = h => new THREE.Vector3((h >> 16 & 255) / 255, (h >> 8 & 255) / 255, (h & 255) / 255);
    const prim = { value: rgb(BALLOON_PRIM[id]) }, env = { value: rgb(BALLOON_ENV[id]) };
    const material = new THREE.MeshBasicMaterial({ map, transparent: true, opacity: BALLOON_ALPHA, depthWrite: false,
      side: THREE.DoubleSide, toneMapped: false });
    material.onBeforeCompile = shader => {   // func_8004B614: (1 - ENV) * TEXEL0 + PRIM in the N64's gamma space
      shader.uniforms.uPrim = prim; shader.uniforms.uEnv = env;
      shader.fragmentShader = 'uniform vec3 uPrim;\nuniform vec3 uEnv;\n' + shader.fragmentShader.replace('#include <map_fragment>',
        '#include <map_fragment>\n  diffuseColor.rgb = pow(min(pow(diffuseColor.rgb, vec3(1.0 / 2.2)) * (1.0 - uEnv) + uPrim, 1.0), vec3(2.2));');
    };
    this.balloonY = BALLOON_Y[id]; this.balloonLean = 0; this.balloonOpacity = 1; this.balloonT = 0;
    this.balloonFx = BALLOON_AT.map((_, i) => {
      const m = new THREE.Mesh(balloonGeometry(), material);
      m.matrixAutoUpdate = false; m.frustumCulled = false; m.renderOrder = 3;
      const b = { m, pos: new THREE.Vector3(), depart: -1, sway: Math.random() * 6 };
      m.onBeforeRender = (_r, _s, camera) => { this.balloonStep(); this.placeBalloon(b, i, camera); };
      this.mesh.add(m);
      return b;
    });
    const dispose = this.mesh.userData.dispose;
    this.mesh.userData.dispose = () => { dispose(); map.dispose(); material.dispose(); };
  }

  // once per frame (the first balloon drawn): anchors, lean, popped balloons rising
  balloonStep() {
    const now = performance.now(), dt = Math.min(0.1, (now - (this.balloonT || now)) / 1000);
    if (this.balloonT && now - this.balloonT < 4) return;
    this.balloonT = now;
    this.balloonLean += (Math.abs(this.v) / MK_UNIT - this.balloonLean) * (1 - 0.9 ** (dt * 60));
    const right = _bRight.crossVectors(this.fwd, this.up).normalize(), back = speedKmh(this.v) / 10;
    this.balloonFx.forEach((b, i) => {
      if (i < this.balloons) b.depart = -1;
      else if (b.depart < 0 && b.m.visible) b.depart = 0;
      if (b.depart >= 0) {
        b.depart += dt; b.pos.y += 0.2 * 60 * dt * K_UNIT;
        b.m.visible = b.depart < 0x78 / 60;
        return;
      }
      b.m.visible = true;
      b.sway += dt;
      const [x, z] = BALLOON_AT[i], bob = 0.3 * (1 + Math.sin(b.sway * 2.3));   // assumption: D_8018D710's random spring as a sine
      b.pos.copy(this.mesh.position).addScaledVector(right, x * K_UNIT).addScaledVector(this.up, (this.balloonY - bob) * K_UNIT)
        .addScaledVector(this.fwd, (z - back) * K_UNIT);
    });
    this.balloonFx[0].m.material.opacity = BALLOON_ALPHA * this.balloonOpacity;
  }

  placeBalloon(b, i, camera) {
    camera.getWorldPosition(_bCam);
    _bZ.subVectors(_bCam, b.pos); _bZ.y = 0;
    const dist = _bZ.length();
    if (dist < 1e-6) return;
    _bZ.divideScalar(dist);
    _bX.crossVectors(_bUp, _bZ);   // screen right
    const own = camera.userData.kart === this;
    // distance in MK64 units at the karts' size (K_UNIT), so a balloon keeps the original's size next to its kart
    const scale = (own ? 0.3 : THREE.MathUtils.clamp(dist / K_UNIT / 300, 0.3, 1.8)) * K_UNIT;
    const behind = -this.fwd.x * _bZ.x - this.fwd.z * _bZ.z;   // cos of the camera's angle from the kart's tail
    const across = this.fwd.x * _bX.x + this.fwd.z * _bX.z;   // the kart's motion across the screen
    const up = b.depart < 0, lean = up ? this.balloonLean * DEG1 : 0;
    // roll: positive tips the top to screen-left. The fan opens outward; the balloons trail the kart's motion.
    const roll = (up ? -Math.sign(BALLOON_AT[i][0]) * BALLOON_FAN * behind + Math.sin(b.sway * 1.3 + i) * 5 * DEG1 : 0) + lean * 8 * across;
    const pitch = lean * 4 * behind;   // positive tips the top towards the camera (the kart driving away)
    _bM.makeBasis(_bX, _bUp, _bZ).multiply(_bR.makeRotationZ(roll)).multiply(_bR.makeRotationX(pitch)).scale(_bS.setScalar(scale));
    b.m.matrixWorld.copy(_bM).setPosition(b.pos);
  }

  // vertical speed of the slope under the kart for a (dx, dz) move (not frame-to-frame, so steps don't launch)
  slopeRate(g, dx, dz, dt) {
    const n = g.normal, cap = 0.6 * Math.abs(this.v);
    return n.y > 0.2 ? THREE.MathUtils.clamp(-(n.x * dx + n.z * dz) / (n.y * dt), -cap, cap) : 0;
  }

  // Grounded height step: the kart sits on the ground with the slope's vertical speed (rate). Where the ground
  // curves away faster than gravity (a crest, a ramp lip) a shadow arc follows the flight the kart would take; it
  // only takes off once that arc is LIFT above the ground, and the arc is dropped if the ground catches up with it.
  rideGround(g, rate, accel, dt) {
    let a = this.arc;
    if (a) { a.vy += accel(a.vy) * dt; a.y += a.vy * dt; }
    else if (this.vy + accel() * dt > rate) a = this.arc = { y: Math.max(g.y, this.y + this.vy * dt), vy: this.vy };   // carries on the climb
    if (a) {
      if (a.y <= g.y) this.arc = null;
      else if (a.y - g.y > LIFT) { this.arc = null; this.air = true; this.y = a.y; this.vy = a.vy; return; }
    }
    this.vy = rate; this.y = g.y;
  }

  // Option A: kart height stepped in 60 Hz player ticks (player_controller.c, TICK). newVelocity[1] gets gravity
  // and drag / unk_DAC; nextY = pos + the last tick's velocity[1] - 0.02; ground contact (surfaceDistance[2] <= 0)
  // pushes nextY back out by 10% of the depth (func_8003E048) and drops the velocity's part into the surface, or
  // reflects it when deeper than 2 units (func_8002A5F4(.., 1, 2)). Returns the ground (null on the route plane).
  tickHeight(g, f, x, z, px, pz, dt) {
    const t = this.track, wasAir = this.air;
    if (!wasAir && g && g.ramp) this.ramp = g.ramp;
    if (this.ramp) this.v = Math.max(this.v, this.top ?? MAX_SPEED);
    // the same fluid / void / route-plane rules as the frame-step path above, for a kart that is in the air
    const fluid = wasAir && t.fluidAt ? t.fluidAt(x, z) : -Infinity, sunk = !g || g.y < fluid;
    const floor = sunk ? -Infinity : !this.ramp && g.y < f.pos.y - 4 ? f.pos.y : g.y;
    const n = floor === g?.y && g.normal.y > 0.2 ? g.normal : UP;
    this.ticks += dt / TICK;
    const count = Math.min(Math.floor(this.ticks), 8);
    this.ticks = Math.min(this.ticks - Math.floor(this.ticks), 1);
    const hx = (x - px) * TICK / (dt * 0.1), hz = (z - pz) * TICK / (dt * 0.1);   // MK units per tick
    let vy = this.vy * TICK / 0.1;
    for (let i = count - 1; i >= 0; i--) {   // tick i (+ the leftover fraction) ticks before this frame's position
      const target = this.ramp ? RAMP_AIR[this.ramp].dac : 1, step = this.ramp ? 1 : 0.07;
      this.dac += THREE.MathUtils.clamp(target - this.dac, -step, step);
      if (this.air && !this.ramp && this.y - floor >= 5) this.dac = 2 - 0.07;
      const gravity = this.ramp ? RAMP_AIR[this.ramp].gravity : KART_GRAVITY;
      const next = vy + (-gravity - vy * 0.12 * 5800) / 6000 / this.dac;
      let y = this.y + vy * 0.1 - 0.002;
      const back = (i + this.ticks) * 0.1, fy = floor + (n.x * hx + n.z * hz) * back / n.y;   // floor plane there
      const depth = (y - fy) * n.y / 0.1;
      if (depth <= 0) {
        if (this.air) { this.air = false; this.land(); }
        y -= n.y * depth * 0.1 * 0.1;
        vy = next - (hx * n.x + next * n.y + hz * n.z) * n.y * (depth < -2 ? 2 : 1);
      } else {
        if (!this.air) { this.air = true; this.airTicks = 0; }
        this.airTicks++; vy = next;
      }
      this.y = y;
    }
    this.vy = vy * 0.1 / TICK;
    this.lead = vy * 0.1 * this.ticks;
    if (this.air) {
      if (g && sunk && this.y < fluid - 0.55) this.fell = { kind: 'water', base: fluid };
      else if (!g && this.y < f.pos.y - 30) this.fell = { kind: 'drop', base: this.y };   // fell into the void
      return g;
    }
    if (floor !== g?.y) g = null;   // on the route plane
    if (!g || !g.ramp) this.ramp = null;
    return g;
  }

  // Landing bounce (player_controller.c): 4+ ticks in the air at speed (speed / 18 * 216 >= 20) squashes the sprite
  // with unk_DB4.unkC 1.5, 28+ ticks 2.8, 35+ ticks 3 at any speed (POOMP)
  land() {
    const ticks = this.airTicks || 0, fast = Math.abs(this.v) * 9 / MAX_SPEED / 18 * 216 >= 20;
    const c = ticks >= 35 ? 3 : ticks >= 28 && fast ? 2.8 : ticks >= 4 && fast ? 1.5 : 0;
    if (c) this.bounce = { c, t: 0, acc: 0, dip: 0 };
    this.airTicks = 0;
  }

  // func_80022DB4 per 30 Hz frame: dip = t * c - 0.7 t^2, each time it goes under 0 the bounce restarts at 0.8 c;
  // func_80022E84 lowers the sprite's top vertices (18 units high) by the dip
  stepBounce(dt) {
    const b = this.bounce;
    if (b) {
      for (b.acc += dt * 30; b.acc >= 1 && b.c; b.acc--) {
        b.t++;
        const d = Math.trunc(b.t * b.c - 0.7 * b.t * b.t);
        if (d < 0) { b.c *= 0.8; b.t = 0; if (b.c <= 0.1) b.c = 0; }
        b.dip = Math.max(d, 0);
      }
      if (!b.c) this.bounce = null;
    }
    this.mesh.userData.squash = this.bounce ? this.bounce.dip / 18 : 0;
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
        // climbing off a ramp lip over a gap: fly. Rolling off any other edge keeps the route-plane fallback
        if (!g && this.groundY != null && this.vy > 0.5) g = t.groundBelow(x, z, this.groundY + 0.5);
      }
    }
    // ballistic height: leave the ground when it falls away faster than gravity (ramp lips, crests)
    if (this.y == null || !dt) { if (g) this.y = g.y; this.vy = 0; this.air = false; this.dac = 1; this.ramp = null; this.arc = null; this.airTicks = 0; this.ticks = 0; this.lead = 0; }
    else if (!PHYSICS.glue && (this.air || g)) { this.arc = null; g = this.tickHeight(g, f, x, z, px, pz, dt); }
    else {
      this.lead = 0;
      // BOOST_RAMP_* surface: trigger_*_ramp_boost / apply_boost_ramp_*_effect hold top speed until touchdown
      if (!this.air && g && g.ramp) this.ramp = g.ramp;
      if (this.ramp) this.v = Math.max(this.v, this.top ?? MAX_SPEED);
      // func_8002AB70: unk_DAC eases to the ramp's value (1/frame), else back to 1 (0.07/frame); >= 50 units up: 2
      const target = this.ramp ? RAMP_AIR[this.ramp].dac : 1, step = (this.ramp ? 1 : 0.07) * MK_FPS * dt;
      this.dac = this.dac + THREE.MathUtils.clamp(target - this.dac, -step, step);
      if (this.air && !this.ramp && g && this.y - g.y >= 5) this.dac = 2 - 0.07;
      const accel = (vy = this.vy) => (-(this.ramp ? RAMP_AIR[this.ramp].gravity : KART_GRAVITY) * GRAVITY_SCALE - AIR_DRAG * vy) / this.dac;
      if (this.air) {
        this.vy += accel() * dt; this.y += this.vy * dt; this.airTicks += dt / TICK;
        // ground under the course's fluid level (water, lava: func_802AAB4C) or none at all (the void) is no landing:
        // the kart sinks / drops and Lakitu fishes it out (src/lakitu.js). Outside a ramp flight, other ground well
        // below the route is floored at the route.
        const fluid = t.fluidAt ? t.fluidAt(x, z) : -Infinity, sunk = !g || g.y < fluid;
        const floor = sunk ? -Infinity : !this.ramp && g.y < f.pos.y - 4 ? f.pos.y : g.y;
        if (this.y <= floor) {
          this.air = false; this.y = floor; this.vy = 0; this.land();
          if (floor !== g.y) g = null;   // landed on the route plane
          if (!g || !g.ramp) this.ramp = null;
        }
        else if (g && sunk && this.y < fluid - 0.55) this.fell = { kind: 'water', base: fluid };
        else if (!g && this.y < f.pos.y - 30) this.fell = { kind: 'drop', base: this.y };   // fell into the void
      } else if (g) {
        const fall = this.y + (this.vy + accel() * dt) * dt;
        // glued: only a BOOST_RAMP_* lip or a real drop (ground gone GLUE_DROP below) takes off; crests and seams don't
        if (g.y < fall - 0.05 && (this.ramp || g.y < this.y - GLUE_DROP)) { this.air = true; this.airTicks = 0; this.vy += accel() * dt; this.y = fall; }
        else {
          this.vy = this.slopeRate(g, x - px, z - pz, dt); this.y = g.y;
          if (!g.ramp) this.ramp = null;
        }
      } else this.arc = null;
    }
    this.stepBounce(dt);
    if (g && !this.air) {
      this.groundY = g.y; this.world.y = PHYSICS.glue ? g.y : this.y + this.lead;
      if (!this.ramp) this.lastGroundS = this.s;   // gCopyNearestPathPointByPlayerId: Lakitu's drop-off point
      this.groundN = (this.groundN || g.normal.clone()).lerp(g.normal, 0.25).normalize();
      this.up.copy(this.groundN);
      this.fwd.addScaledVector(this.up, -this.fwd.dot(this.up)).normalize();   // pitch with the slope
    } else if (this.air) {
      this.groundY = this.y; this.world.y = this.y + (PHYSICS.glue ? 0 : this.lead);

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
    this.mesh.userData.tumble = this.tumble ? this.tumble.a8 >> 8 : null;
    if (this.tumble) this.mesh.position.addScaledVector(this.up, this.tumble.lift * 0.1);   // MK64 units at course scale 0.1
  }
}
