import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import * as THREE from 'three';
import { Kart, kartSpriteFrame, buildKartMesh, ccSpeedScale, CC_INDEX, CC_BATTLE, PATH_POINTS, speedKmh, PHYSICS,
  togglePhysics, physicsLabel, pickRivals, cpuSpeedControl, bumpKarts } from '../src/kart.js';
import { makeTrack, makeKart, run, idle, gas, flush } from './helpers.js';
import { battleSpawn } from '../src/track.js';
import { fluidAt, fluidLevel } from '../src/lakitu.js';

describe('kart helpers', () => {
  it('ccSpeedScale is 1 for 150cc Mario and smaller for 50cc', () => {
    expect(ccSpeedScale(CC_INDEX[150], 'mario')).toBe(1);
    expect(ccSpeedScale(CC_INDEX[50], 'mario')).toBeCloseTo((290 / 320) ** 2, 6);
    expect(ccSpeedScale(CC_INDEX[150], 'yoshi')).toBeGreaterThan(1);
    expect(ccSpeedScale(CC_INDEX[150], 'unknown')).toBe(1);
    expect(ccSpeedScale(CC_BATTLE, 'mario')).toBeCloseTo((245 / 320) ** 2, 6);
  });
  it('speedKmh is symmetric and zero at rest', () => {
    expect(speedKmh(0)).toBe(0);
    expect(speedKmh(-10)).toBe(speedKmh(10));
    expect(speedKmh(44)).toBeCloseTo(70.6, 0);
  });
  it('every race course has a path point count', () => {
    expect(Object.keys(PATH_POINTS)).toHaveLength(16);
  });
  it('togglePhysics flips the model and persists it', () => {
    const before = PHYSICS.glue;
    expect(physicsLabel()).toBe(`Kart physics: ${before ? 'Glue' : 'Jumps'}`);
    const label = togglePhysics();
    expect(PHYSICS.glue).toBe(!before);
    expect(label).toBe(physicsLabel());
    expect(localStorage.getItem('kartPhysics')).toBe(PHYSICS.glue ? 'glue' : 'jumps');
    togglePhysics();
    expect(PHYSICS.glue).toBe(before);
  });
  it('pickRivals chooses two distinct CPU rivals and skips humans', () => {
    const karts = [{ isPlayer: true }, { remote: true }, ...Array.from({ length: 5 }, () => ({}))];
    pickRivals(karts);
    const r = karts.filter(k => k.rival != null).map(k => k.rival).sort();
    expect(r).toEqual([0, 1]);
    expect(karts[0].rival).toBeUndefined();
    expect(karts[1].rival).toBeUndefined();
    pickRivals([{ isPlayer: true }]);   // nothing to pick
  });
});

describe('kartSpriteFrame', () => {
  it('shows the rear view straight ahead and wraps angles', () => {
    expect(kartSpriteFrame(0)).toEqual({ frame: 84, mirrored: false });
    expect(kartSpriteFrame(Math.PI * 2)).toEqual({ frame: 84, mirrored: false });
    expect(kartSpriteFrame(-Math.PI / 2).mirrored).toBe(true);
    expect(kartSpriteFrame(Math.PI / 2).mirrored).toBe(false);
  });
  it('uses spin frames while spinning', () => {
    expect(kartSpriteFrame(0, true).frame).toBe(84);
    expect(kartSpriteFrame(1, true).frame).toBeGreaterThanOrEqual(230);
    expect(kartSpriteFrame(Math.PI * 2 - 0.0001, true).frame).toBe(230);
  });
});

describe('buildKartMesh', () => {
  it('creates a sprite + shadow group and renders frames for a camera', async () => {
    const g = buildKartMesh('luigi');
    await flush();
    expect(g.userData.character).toBe('luigi');
    const sprite = g.children.find(c => c.isSprite), shadow = g.children.find(c => c.isMesh);
    expect(sprite).toBeTruthy();
    const cam = new THREE.PerspectiveCamera();
    cam.position.set(3, 2, -6); cam.updateMatrixWorld();
    sprite.onBeforeRender(null, null, cam);
    expect(Number.isInteger(sprite.userData.frame)).toBe(true);
    shadow.onBeforeRender(null, null, cam);
    cam.userData.mirror = true;
    g.userData.spinning = true; g.userData.tumble = 3; g.userData.lean = 0.2; g.userData.squash = 0.1;
    sprite.onBeforeRender(null, null, cam);
    expect(sprite.userData.frame).toBe(292);
    g.userData.setShadow(Infinity); expect(shadow.visible).toBe(false);
    g.userData.setShadow(0); expect(shadow.visible).toBe(true);
    g.userData.setBlob(false); expect(shadow.visible).toBe(false);
    g.userData.setCold([10, 20, 30], [1, 2, 3]);
    g.userData.setAlpha(0.5); expect(sprite.material.transparent).toBe(true);
    g.userData.setAlpha(1); expect(sprite.material.transparent).toBe(false);
    sprite.material.onBeforeCompile({ uniforms: {}, fragmentShader: '#include <map_fragment>' });
    g.userData.dispose();
  });
});

describe('Kart on a race course', () => {
  let track;
  beforeAll(async () => { track = await makeTrack('mario'); });
  afterEach(() => { if (!PHYSICS.glue) togglePhysics(); });

  it('starts at rest on the route', () => {
    const k = makeKart(track, { isPlayer: true });
    expect(k.v).toBe(0);
    expect(k.progress).toBeCloseTo(20, 5);
    expect(k.visualHalfWidth).toBeGreaterThan(1);
    expect(k.boxSize).toBeCloseTo(5.5, 5);
    expect(k.mesh.position.distanceTo(k.world)).toBeLessThan(1e-6);
  });
  it('clamps its starting offset inside the walls', () => {
    const k = makeKart(track, { d: 500 });
    expect(Math.abs(k.d)).toBeLessThan(track.wallAt(20, 1));
  });
  it('accelerates under throttle and coasts to a stop', () => {
    const k = makeKart(track, { isPlayer: true });
    run(k, 3, gas);
    expect(k.v).toBeGreaterThan(15);
    expect(k.s).toBeGreaterThan(20);
    expect(k.throttle).toBe(true);
    run(k, 20, idle);
    expect(k.v).toBeLessThan(1);
  });
  it('brakes and reverses', () => {
    const k = makeKart(track, { isPlayer: true });
    run(k, 2, gas);
    const v = k.v;
    run(k, 0.5, { throttle: 0, brake: 1, steer: 0, drift: false });
    expect(k.v).toBeLessThan(v);
    run(k, 5, { throttle: 0, brake: 1, steer: 0, drift: false });
    expect(k.v).toBeGreaterThanOrEqual(-12);
    expect(k.v).toBeLessThan(0);
  });
  it('steering turns the kart and is wrapped for the player', () => {
    const k = makeKart(track, { isPlayer: true });
    run(k, 1, gas);
    run(k, 3, { throttle: 1, brake: 0, steer: 1, drift: false });
    expect(Number.isFinite(k.psi)).toBe(true);
    expect(Math.abs(k.psi)).toBeLessThanOrEqual(Math.PI + 1e-6);
  });
  it('CPU heading stays within 83 degrees', () => {
    const k = makeKart(track, { isPlayer: false });
    run(k, 5, { throttle: 1, brake: 0, steer: 1, drift: false });
    expect(Math.abs(k.psi)).toBeLessThanOrEqual(1.45 + 1e-9);
  });
  it('drifting charges a mini-turbo boost', () => {
    const k = makeKart(track, { isPlayer: true, s: 100 });
    k.v = 40;
    k.update(1 / 60, { throttle: 1, brake: 0, steer: 1, drift: true });
    expect(k.drift).toBe(1);
    for (let i = 0; i < 150; i++) { k.v = 40; k.d = 0; k.update(1 / 60, { throttle: 1, brake: 0, steer: 0.3, drift: true }); }
    k.update(1 / 60, { throttle: 1, brake: 0, steer: 0, drift: false });
    expect(k.drift).toBe(0);
    expect(k.boost).toBeGreaterThan(0.7);
    const kb = makeKart(track, { isPlayer: true, s: 100 });
    kb.v = 40; kb.update(1 / 60, { throttle: 1, brake: 0, steer: 1, drift: true });
    for (let i = 0; i < 80; i++) { kb.v = 40; kb.d = 0; kb.update(1 / 60, { throttle: 1, brake: 0, steer: 0.3, drift: true }); }
    kb.update(1 / 60, idle);
    expect(kb.boost).toBeGreaterThan(0);
  });
  it('boost raises the speed ceiling and then decays', () => {
    const k = makeKart(track, { isPlayer: true });
    k.boost = 1;
    run(k, 1, gas);
    expect(k.v).toBeGreaterThan(44);
    run(k, 3, gas);
    expect(k.v).toBeLessThanOrEqual(44.5);
  });
  it('going off the road slows the kart', () => {
    const k = makeKart(track, { isPlayer: true });
    k.d = 14;
    k.update(1 / 60, gas);
    expect(k.offroad).toBe(true);
  });
  it('hitting the route wall bounces and slows', () => {
    const k = makeKart(track, { isPlayer: true, s: 100 });
    run(k, 3, gas);
    const lim = track.wallAt(k.s, 1);
    k.d = lim + 2; k.psi = 0.5; k.phi = 0.5; k.v = 40;
    k.update(1 / 60, gas);
    // the limit closing in is eased (a quarter of the way a frame), a kart just past it is put back and bounced
    expect(Math.abs(k.d)).toBeLessThan(lim + 2);
    const lim2 = track.wallAt(k.s, 1);   // the limit where the first step left the kart
    k.d = lim2 - 1.2 + 0.5; k.psi = 0.5; k.phi = 0.5; k.v = 40; k.wallEase = 0;
    k.update(1 / 60, gas);
    expect(Math.abs(k.d)).toBeLessThan(lim2);
    expect(k.v).toBeLessThan(39);
    expect(k.wallT).toBeGreaterThan(0);
  });
  it('wraps around the lap line and counts crossings', () => {
    const k = makeKart(track, { isPlayer: true, s: track.length - 2 });
    k.prevS = k.s;
    k.v = 40;
    run(k, 0.5, gas);
    expect(k.crossings).toBe(1);
    expect(k.s).toBeLessThan(track.length / 4);
    const back = makeKart(track, { isPlayer: true, s: 2 });
    back.v = -10;
    run(back, 1, { throttle: 0, brake: 1, steer: 0, drift: false });
    expect(back.crossings).toBe(-1);
  });
  it('a rescued kart is held still', () => {
    const k = makeKart(track, { isPlayer: true });
    k.v = 30; k.rescue = 1; k.boost = 1;
    k.update(1 / 60, gas);
    expect(k.v).toBe(0);
    expect(k.boost).toBe(0);
  });
  it('spinning out ignores input and then recovers', () => {
    const k = makeKart(track, { isPlayer: true });
    run(k, 1, gas);
    k.spin = 0.5;
    run(k, 0.3, gas);
    expect(k.spinAngle).toBeGreaterThan(0);
    run(k, 0.5, gas);
    expect(k.spinAngle).toBe(0);
    expect(k.spin).toBeLessThanOrEqual(0);
  });
  it.each(['low', 'high', 'vertical'])('%s tumble plays out', mode => {
    const k = makeKart(track, { isPlayer: true });
    run(k, 2, gas);
    k.startTumble(mode);
    expect(k.tumble.mode).toBe(mode);
    let lifted = 0;
    for (let i = 0; i < 600 && k.tumble; i++) { k.update(1 / 60, gas); lifted = Math.max(lifted, k.tumble?.lift ?? 0); }
    expect(lifted).toBeGreaterThan(0);
    expect(k.tumble).toBeNull();
    expect(k.mesh.userData.tumble).toBeNull();
  });
  it('bonk shoves the kart and spins it out above the threshold', () => {
    const k = makeKart(track, { isPlayer: true });
    run(k, 2, gas);
    const hard = k.bonk(k.world.x * 10 + 5, k.world.z * 10, 30, 30, 1, 1);
    expect(hard).toBeGreaterThan(0);
    expect(k.bonkWait).toBeGreaterThan(0);
    expect(k.bonk(0, 0, 1, 1, 1, 1)).toBe(0);   // still waiting
    expect(k.spin).toBeGreaterThan(0);
    const s0 = k.s;
    for (let i = 0; i < 900 && k.push; i++) k.update(1 / 60, idle);
    expect(k.push).toBeNull();
    expect(k.s).not.toBe(s0);
    const soft = makeKart(track, { isPlayer: true });
    soft.v = 20;
    soft.bonk(0, 0, 0, 0, 0.001, 0);
    expect(soft.spin).toBe(0);
  });
  it('Jumps physics steps the height in 60 Hz ticks', () => {
    togglePhysics();
    const k = makeKart(track, { isPlayer: true });
    run(k, 3, gas, 1 / 30);
    expect(Number.isFinite(k.y)).toBe(true);
    expect(k.air).toBe(false);
    k.air = true; k.y += 5; k.vy = 0;
    run(k, 1, gas, 1 / 30);
    expect(k.air).toBe(false);
    expect(k.bounce || k.mesh.userData.squash >= 0).toBeTruthy();
  });
  it('glue physics takes off after a big drop and lands', () => {
    const k = makeKart(track, { isPlayer: true });
    run(k, 1, gas);
    k.y += 2; k.groundY = k.y;
    run(k, 0.1, gas);
    expect(k.air).toBe(true);
    run(k, 3, gas);
    expect(k.air).toBe(false);
  });
  it('landing after a long flight squashes the sprite', () => {
    const k = makeKart(track, { isPlayer: true });
    k.v = 40;
    k.airTicks = 40; k.land();
    expect(k.bounce.c).toBe(3);
    for (let i = 0; i < 60; i++) k.stepBounce(1 / 30);
    expect(k.bounce).toBeNull();
    k.airTicks = 30; k.land(); expect(k.bounce.c).toBe(2.8);
    k.airTicks = 5; k.land(); expect(k.bounce.c).toBe(1.5);
    k.bounce = null; k.airTicks = 1; k.land(); expect(k.bounce).toBeNull();
  });
  it('set3D swaps the model for the sprite', () => {
    const k = makeKart(track, { isPlayer: true });
    const model = new THREE.Group();
    model.userData.update = (s, v, dt) => { model.userData.last = [s, v, dt]; };
    k.set3D(model);
    expect(k.mesh.children).toContain(model);
    expect(k.mesh.children.find(c => c.isSprite).visible).toBe(false);
    k.update(1 / 60, gas);
    expect(model.userData.last).toBeTruthy();
    k.set3D(null);
    expect(k.mesh.children).not.toContain(model);
    expect(k.mesh.children.find(c => c.isSprite).visible).toBe(true);
  });
  it('a 3D capsule model pushes with two axle circles', () => {
    const k = makeKart(track, { isPlayer: true, s: 100 });
    const model = new THREE.Group();
    model.userData.update = () => {};
    model.userData.capsule = { front: 1, rear: -1, r: 0.9 };
    k.set3D(model);
    run(k, 4, { throttle: 1, brake: 0, steer: 0.4, drift: false });
    expect(Number.isFinite(k.s)).toBe(true);
  });
});

describe('CPU driving', () => {
  it('drives a lap segment on its own without leaving the road', async () => {
    const track = await makeTrack('mario');
    const cpu = makeKart(track, { isPlayer: false, skill: 1, s: 30 });
    const karts = [cpu];
    for (let i = 0; i < 60 * 20; i++) {
      const input = cpu.think(1 / 60, karts);
      cpu.update(1 / 60, input);
    }
    expect(cpu.progress).toBeGreaterThan(200);
    expect(Math.abs(cpu.d)).toBeLessThan(track.wallAt(cpu.s, Math.sign(cpu.d) || 1));
  });
  it('a finished kart drives the cinematic line', async () => {
    const track = await makeTrack('mario');
    const k = makeKart(track, { isPlayer: true, s: 30 });
    k.finished = true;
    for (let i = 0; i < 60 * 8; i++) k.update(1 / 60, k.think(1 / 60, [k]));
    expect(k.progress).toBeGreaterThan(50);
  });
  it('dodges a slower kart ahead and backs off when stuck', async () => {
    const track = await makeTrack('mario');
    const cpu = makeKart(track, { s: 30 }), blocker = makeKart(track, { s: 40, d: 0 });
    cpu.think(1 / 60, [cpu, blocker]);
    expect(cpu.dbgT).not.toBe(0);
    cpu.reverse = 0.5;
    expect(cpu.think(1 / 60, [cpu]).brake).toBe(1);
  });
  it('keeps out of the gap between Koopa Troopa Beach\'s start ramp and the rock beside it', async () => {
    // the gap (-172, 14) is 3 wide: the route limit stops at the ramp's side (Track._nativeBounds GAP), not the rock
    const track = await makeTrack('koopa');
    for (let s = 416; s <= 424; s += 2) expect(track.wallAt(s, -1)).toBeLessThan(4.5);
    // Bowser on the line that wedged him there for 40 s of a 150cc race drives on over the ramp at speed
    const cpu = makeKart(track, { character: 'bowser', name: 'Bowser', s: 409.6, d: -3.26 });
    cpu.psi = -0.06; cpu.phi = -0.11; cpu.v = 42;
    for (let i = 0; i < 60 * 3; i++) cpu.update(1 / 60, cpu.think(1 / 60, [cpu]), [cpu]);
    expect(cpu.s).toBeGreaterThan(450);
    expect(cpu.v).toBeGreaterThan(30);
  });
  it('has Lakitu fish out a CPU wedged beside Royal Raceway\'s ramp', async () => {
    // a CPU 10 out at the foot of the ramp at (125, -230), where the limit drops from 40 to 4.5, is held out by the
    // ramp's side face and drives into the grass wedge where it meets the barrier at (70, -196) (s1061); it stayed
    // there for the rest of a 150cc race (1 race in 3). (From 980, 10 out, the CPU now brakes and takes the ramp: it
    // starts beside the ramp, on the ground under its side.)
    const track = await makeTrack('royal');
    const cpu = makeKart(track, { name: 'Luigi', character: 'luigi', s: 1010, d: -6 });
    cpu.d = -6; cpu.v = 40; cpu.groundY = 0; cpu.y = undefined; cpu.syncMesh(0);
    let t = 0;
    for (; t < 12 && !cpu.fell; t += 1 / 60) cpu.update(1 / 60, cpu.think(1 / 60, [cpu]), [cpu]);
    expect(cpu.fell).toBeTruthy();
    expect(cpu.s).toBeGreaterThan(1040);
    expect(cpu.s).toBeLessThan(1070);
    // a CPU driving on is not fished out
    const ok = makeKart(track, { name: 'Mario', s: 980, d: 0 });
    ok.v = 40;
    for (let i = 0; i < 60 * 8; i++) ok.update(1 / 60, ok.think(1 / 60, [ok]), [ok]);
    expect(ok.fell).toBeFalsy();
  });
  it('brakes a CPU out wide of the bend before Royal Raceway\'s ramp so it gets onto the ramp, not beside it', async () => {
    // out of the bend at (160, -255) 3-9 out and heading further out, the karts came to the ramp's foot at (125, -230)
    // 5-6 out (its limit 4.5), were held out by its side face and drove along it into the grass wedge at (70, -196)
    const track = await makeTrack('royal');
    const beside = [];
    for (const s0 of [960, 970]) for (const d0 of [-3, -5, -7, -9]) for (const ps of [-0.3, -0.15]) {
      const cpu = makeKart(track, { name: 'Luigi', character: 'luigi', s: s0, d: d0 });
      cpu.d = d0; cpu.v = 46; cpu.psi = cpu.phi = ps; cpu.aiOffset = -4.8;
      for (let i = 0; i < 60 * 3 && !cpu.fell; i++) cpu.update(1 / 60, cpu.think(1 / 60, [cpu]), [cpu]);
      if (cpu.world.y < 1 && cpu.s < 1075) beside.push([s0, d0, ps, +cpu.s.toFixed(1), +cpu.d.toFixed(1)]);
    }
    expect(beside).toEqual([]);
  });
  it('does not sink a kart dropped back on D.K.\'s Jungle Parkway\'s cave floor, under the river\'s level', async () => {
    // the cave floor at s1468 (-9 high) lies under the river's level (-3.39); without its CAVE surface the river level
    // applied, every kart Lakitu dropped back there sank at once and was fished out again, endlessly (jumps physics)
    const track = await makeTrack('dk');
    track.fluidY = fluidLevel(track); track.fluidAt = (x, z, f) => fluidAt(track, x, z, f);
    const glue = PHYSICS.glue;
    try {
      for (const g of [true, false]) {
        PHYSICS.glue = g;
        const k = makeKart(track, { isPlayer: true, character: 'dk', s: 1468.5, d: 0 });
        k.syncMesh(0); k.y += 4; k.air = true;   // released 40 MK64 units up, as Lakitu drops it
        for (let i = 0; i < 60 * 2 && !k.fell; i++) k.update(1 / 60, gas, [k]);
        expect(k.fell).toBeFalsy();
        expect(k.s).toBeGreaterThan(1480);
      }
    } finally { PHYSICS.glue = glue; }
  });
  it('keeps CPUs off the bank into D.K.\'s Jungle Parkway\'s river after the big jump', async () => {
    // the wall limit runs 40 out across the river at (92, -188); the dry limit stops at the bank's edge
    const track = await makeTrack('dk');
    track.fluidY = fluidLevel(track); track.fluidAt = (x, z) => fluidAt(track, x, z);   // as Lakitu sets them
    for (let s = 600; s <= 630; s += 5) {
      expect(track.wallAt(s, -1)).toBeGreaterThan(30);
      expect(track.dryAt(s, -1)).toBeLessThan(7);
    }
    expect(track.dryAt(600, 1)).toBe(track.wallAt(600, 1));
    // a CPU landed 30 out right of the route, swinging back across for its lane -4.8 (a 150cc race slid it down the
    // bank into the water at s620): it settles inside the dry limit
    const cpu = makeKart(track, { name: 'Toad', character: 'toad', s: 571.2, d: 30.6 });
    cpu.aiOffset = -4.8; cpu.psi = -0.24; cpu.phi = -0.12; cpu.v = 35;
    let minD = 0;
    for (let i = 0; i < 60 * 3 && !cpu.fell; i++) { cpu.update(1 / 60, cpu.think(1 / 60, [cpu]), [cpu]); minD = Math.min(minD, cpu.d); }
    expect(cpu.fell).toBeFalsy();
    expect(minD).toBeGreaterThan(-4.5);
    expect(cpu.s).toBeGreaterThan(625);
  });
  it('keeps CPUs off Yoshi Valley\'s canyon side, a slope too steep to drive down', async () => {
    // the road's right edge at (-297, -34) runs on down a 65 deg slope into the canyon: no wall, so the wall limit is
    // 40 out (the player can still go over), and CPU lanes reached 8.5 out; 1-2 karts a race fell in at s915-925
    const track = await makeTrack('yoshi');
    for (let s = 916; s <= 931; s += 3) {
      expect(track.wallAt(s, 1)).toBeGreaterThan(30);
      expect(track.dryAt(s, 1)).toBeLessThan(7);
    }
    const over = [];
    for (const d0 of [2, 4]) for (const off of [4.8, 8]) for (const s0 of [890, 895, 902]) {
      const cpu = makeKart(track, { name: 'Wario', character: 'wario', s: s0, d: d0 });
      cpu.aiOffset = off; cpu.psi = cpu.phi = 0.1; cpu.v = 38;
      let low = Infinity;
      for (let i = 0; i < 60 * 2 && !cpu.fell; i++) { cpu.update(1 / 60, cpu.think(1 / 60, [cpu]), [cpu]); low = Math.min(low, cpu.world.y); }
      if (low < -3 || cpu.fell) over.push([s0, d0, off, +cpu.s.toFixed(1), +cpu.d.toFixed(1), +low.toFixed(1)]);
    }
    expect(over).toEqual([]);
  });
  it('brakes a CPU still in Sherbet Land\'s first hairpin on full lock instead of powering it into the outside wall', async () => {
    // the bend at (47, -67), s84-95 (k -0.13), past the end of the corner brake's lookahead (s+6..14): the karts
    // powered out on full lock with the bend still under them and slid onto the outside wall (wR 6.5) at d 5.2
    const track = await makeTrack('sherbet');
    const hit = [];
    for (const s0 of [55, 60, 65, 70]) for (const d0 of [-2, 2]) for (const off of [0, 4.8]) for (const v0 of [35, 42]) {
      const cpu = makeKart(track, { name: 'Wario', character: 'wario', s: s0, d: d0 });
      cpu.aiOffset = off; cpu.v = v0;
      let n = 0;
      const wb = cpu.wallBounce.bind(cpu); cpu.wallBounce = (...a) => { if (cpu.s > 75 && cpu.s < 110) n++; return wb(...a); };
      for (let i = 0; i < 60 * 3; i++) cpu.update(1 / 60, cpu.think(1 / 60, [cpu]), [cpu]);
      if (n) hit.push([s0, d0, off, v0, n]);
      expect(cpu.s).toBeGreaterThan(s0 + 60);
    }
    expect(hit).toEqual([]);
  });
  it('lifts a CPU sliding out of Banshee Boardwalk\'s hairpin onto its outside limit', async () => {
    // out of the hairpin at (-5, -210) (k 0.21) the karts powered away on full lock with the travel 0.26 rad outward
    // of the route, slid 2 units across and hit the outside limit (wR 5.5) 20-30 times a race
    const track = await makeTrack('banshee');
    const cpu = makeKart(track, { name: 'Luigi', character: 'luigi', s: 281.0, d: 2.45 });
    cpu.aiOffset = 4.8; cpu.psi = -0.43; cpu.phi = -0.26; cpu.v = 13.3;
    let hits = 0, maxD = 0;
    const wb = cpu.wallBounce.bind(cpu); cpu.wallBounce = (...a) => { hits++; return wb(...a); };
    for (let i = 0; i < 60 * 1.5; i++) { cpu.update(1 / 60, cpu.think(1 / 60, [cpu]), [cpu]); maxD = Math.max(maxD, cpu.d); }
    expect(hits).toBe(0);
    expect(maxD).toBeLessThan(track.wallAt(290, 1) - 1.4);
    expect(cpu.s).toBeGreaterThan(300);
  });
  it('flies off Wario Stadium\'s jump lip instead of gluing onto the pit face below it', async () => {
    // the pit's Lakitu-flagged face starts 0.8 under the lip at (-146, 55): a kart leaving the lip on the wrong frame
    // was glued down onto it and fished out (3 karts in one full race), or, rising 0.2 over it in its first frame of
    // flight, fished out at once
    const track = await makeTrack('wario');
    let fell = 0, n = 0;
    const starts = [];
    for (let s0 = 2270.56; s0 < 2270.75; s0 += 0.035) for (const d0 of [-0.5, 0.5]) starts.push([s0, d0, 0, 42.6]);
    for (let s0 = 2283; s0 < 2285; s0 += 0.11) for (const d0 of [-2.6, 0, 2.6]) for (const ph of [-0.25, 0.25]) starts.push([s0, d0, ph, 41]);
    for (const [s0, d0, ph, v0] of starts) {
      const cpu = makeKart(track, { name: 'Wario', character: 'wario', s: s0, d: d0 });
      cpu.v = v0; cpu.psi = cpu.phi = ph; cpu.aiOffset = d0; n++;
      for (let i = 0; i < 60 && !cpu.fell; i++) cpu.update(1 / 60, cpu.think(1 / 60, [cpu]), [cpu]);
      if (cpu.fell) fell++;
      else expect(cpu.s).toBeGreaterThan(2300);
    }
    expect(n).toBeGreaterThan(8);
    expect(fell).toBe(0);
  });
  it('drives down Bowser\'s Castle\'s stairs without being shoved on by each step\'s riser', async () => {
    // the stairs at (158..133, -79) drop 1 every 5: glued down a step, the riser just behind pushed the kart's body
    // clear of it in one frame (1.1-1.5 for Bowser, 0.6-0.9 for Mario) on every step, every lap
    const track = await makeTrack('bowser');
    for (const ch of ['bowser', 'mario']) {
      const k = makeKart(track, { name: ch, character: ch, s: 728, d: 0 });
      k.v = 25; k.psi = -0.42; k.phi = -0.56; k.aiOffset = -4.8;
      let worst = 0;
      for (let i = 0; i < 120; i++) {
        const x = k.world.x, z = k.world.z;
        k.update(1 / 60, k.think(1 / 60, [k]), [k]);
        worst = Math.max(worst, Math.hypot(k.world.x - x, k.world.z - z) - Math.abs(k.v) / 60);
      }
      expect(k.world.x).toBeLessThan(130);
      expect(worst).toBeLessThan(0.3);
    }
  });
  it('drives Mario Raceway\'s grass and infield without being flung or dragged sideways', async () => {
    // far in on the inside of a bend (1 - k d under 0.3) the frame step moved the kart up to 7x its speed (1.7 a
    // frame at (257, 5)); out on the hills the closing route limit dragged it in 5.5 a frame at (110, -55); beside the
    // road at (102, 46) it dragged it 2.3 a frame sideways into the pipe ahead. Each frame's move stays its own.
    const track = await makeTrack('mario');
    const cases = [
      { s: 471.76, d: -35.14, psi: -0.12, v: 13.3, input: gas },
      { s: 213.57, d: -37.65, psi: -0.31, phi: -0.02, v: 18.8, drift: 1, input: { throttle: 1, brake: 0, steer: -0.46, drift: true } },
      { s: 819.4, d: 18.15, psi: 0.07, v: 17.3, input: { throttle: 1, brake: 0, steer: 0.37, drift: false } },
    ];
    for (const c of cases) {
      const k = makeKart(track, { isPlayer: true, s: c.s, d: 0 });
      k.d = c.d; k.psi = c.psi; k.phi = c.phi ?? c.psi; k.v = c.v; k.drift = c.drift ?? 0; k.syncMesh(0);
      let worst = 0;
      for (let i = 0; i < 90 && !k.fell; i++) {
        const x = k.world.x, z = k.world.z, v = Math.abs(k.v);
        k.update(1 / 60, c.input, [k]);
        worst = Math.max(worst, Math.hypot(k.world.x - x, k.world.z - z) - v / 60);
      }
      expect(worst).toBeLessThan(0.6);
    }
  });
  it('drives across Kalimari Desert\'s start line far out without being thrown', async () => {
    // the path's closing point sits 0.14 from the one before it and 0.1 to the side: the route's tangent swung 0.24
    // rad there and back, and a kart 34 out crossing the line backwards was thrown 3-5 a frame
    const track = await makeTrack('kalimari');
    const cases = [
      { s: 1.0, d: 34.3, psi: -3.05, v: 19 }, { s: 1.0, d: 38.7, psi: 3.06, v: 14 }, { s: 1324, d: 34, psi: 0.05, v: 19 },
    ];
    for (const c of cases) {
      const k = makeKart(track, { isPlayer: true, s: c.s, d: 0 });
      k.d = c.d; k.psi = k.phi = c.psi; k.v = c.v; k.syncMesh(0);
      let worst = 0;
      for (let i = 0; i < 40; i++) {
        const x = k.world.x, z = k.world.z, v = Math.abs(k.v);
        k.update(1 / 60, { throttle: 1, brake: 0, steer: -0.19, drift: false }, [k]);
        worst = Math.max(worst, Math.hypot(k.world.x - x, k.world.z - z) - v / 60);
      }
      expect(worst).toBeLessThan(0.6);
    }
  });
  it('drives far out beside Frappe Snowland\'s route without being thrown by its wiggles', async () => {
    // the route's tangent wiggled up to 0.1-0.5 rad from sample to sample, and 34-38 out the frame's lateral lines
    // crossed: a kart at (20, -210) or (-125, 60) was thrown 1.6-3.6 in a frame (now averaged over 3 samples)
    const track = await makeTrack('frappe');
    for (const c of [{ s: 769.22, d: -38.05, psi: -2.8, v: 19.3 }, { s: 236, d: -38, psi: 0.05, v: 19 }, { s: 236, d: -34, psi: 0.05, v: 30 }]) {
      const k = makeKart(track, { isPlayer: true, s: c.s, d: 0 });
      k.d = c.d; k.psi = k.phi = c.psi; k.v = c.v; k.syncMesh(0);
      let worst = 0;
      for (let i = 0; i < 60; i++) {
        const x = k.world.x, z = k.world.z, v = Math.abs(k.v);
        k.update(1 / 60, gas, [k]);
        worst = Math.max(worst, Math.hypot(k.world.x - x, k.world.z - z) - v / 60);
      }
      expect(worst).toBeLessThan(0.4);
    }
  });
  it('drives off a bank or a hill\'s edge beside the road without being lifted or snapped onto the route plane', async () => {
    // y change a frame on the ground (or landing), worst rise and worst grounded jump
    const drive = (k, input, frames) => {
      let rise = 0, jump = 0;
      for (let i = 0; i < frames && !k.fell; i++) {
        const y = k.mesh.position.y, air = k.air;
        k.update(1 / 60, input, [k]);
        const dy = k.mesh.position.y - y;
        if (!k.air) rise = Math.max(rise, dy);
        if (!k.air && !air) jump = Math.max(jump, Math.abs(dy));
      }
      return { rise, jump };
    };
    // down the 48 deg bank beside Royal Raceway's road at (-48, -181) (route 0.4, its floor -6): leaving the bank at
    // -4.3 the kart was lifted 4.8 onto the route plane (route-plane floor for flights coming down from above)
    const royal = await makeTrack('royal');
    const r = makeKart(royal, { isPlayer: true, s: 179.73, d: 0 });
    r.d = -27.79; r.psi = -0.48; r.phi = -0.39; r.v = 17.8; r.syncMesh(0);
    const rr = drive(r, { throttle: 1, brake: 0, steer: -0.58, drift: false }, 30);
    expect(rr.rise).toBeLessThan(1);
    // off the side of Choco Mountain's hill at (-50, 115), 11 over the road, into the void past it: it was snapped
    // 11 down onto the route plane in a frame; it falls
    const choco = await makeTrack('choco');
    const c = makeKart(choco, { isPlayer: true, s: 559.22, d: 0 });
    c.d = 28.42; c.wallEase = 28.42; c.psi = c.phi = 0.78; c.v = 19.8; c.groundY = 11.4; c.y = undefined; c.syncMesh(0);
    expect(c.mesh.position.y).toBeGreaterThan(11);
    const cr = drive(c, gas, 20);
    expect(cr.jump).toBeLessThan(1);
    expect(c.air || c.fell).toBeTruthy();
    // down Yoshi Valley's canyon side at (-291, 21), 24 under the road: off the foot of the upper slope (3.8 down to the
    // next) the kart was lifted 24 onto the route plane in a frame; it falls on down the canyon
    const yoshi = await makeTrack('yoshi');
    const y = makeKart(yoshi, { isPlayer: true, s: 968, d: 0 });
    y.d = 14.2; y.wallEase = 14.2; y.psi = y.phi = 0.3; y.v = 19; y.groundY = -23.3; y.y = undefined; y.syncMesh(0);
    expect(y.mesh.position.y).toBeLessThan(-20);
    const yr = drive(y, gas, 40);
    expect(yr.rise).toBeLessThan(1);
    expect(y.mesh.position.y).toBeLessThan(-20);
  });
  it('is not carried through a mound\'s side in flight or thrown past a bend\'s centre', async () => {
    const step = (k, input, frames) => {
      let worst = 0;
      for (let i = 0; i < frames && !k.fell; i++) {
        const x = k.world.x, z = k.world.z, v = Math.abs(k.v);
        k.update(1 / 60, input, [k]);
        worst = Math.max(worst, Math.hypot(k.world.x - x, k.world.z - z) - v / 60);
      }
      return worst;
    };
    // falling past the 70 deg side of the mound beside Royal Raceway's road at (-265, -14): the closing route limit
    // carried the kart 3.9 in one frame through the face, 6 under the mound's top (wallBetween skipped flights)
    const royal = await makeTrack('royal');
    const r = makeKart(royal, { isPlayer: true, s: 1437.37, d: 0 });
    Object.assign(r, { d: 25.14, psi: 0.863, phi: 0.84, v: 44, boost: 1, wallEase: 21.79, wallT: 0.58 });
    r.syncMesh(0);
    Object.assign(r, { air: true, y: -0.27, vy: -14.1, groundY: -0.27 });
    expect(step(r, { throttle: 1, brake: 0, steer: 0, drift: true }, 1)).toBeLessThan(0.6);
    expect(r.d).toBeGreaterThan(24);
    // 36.5 in from Mario Raceway's bend at (178, 113), radius 16-20, past its centre (1 - k d = -0.6): the frame step
    // clamped to +0.3 ran backwards and 3x the kart's move, 2-3 a frame with the kart wrong way at 0.8 a frame
    const mario = await makeTrack('mario');
    const m = makeKart(mario, { isPlayer: true, s: 688.31, d: 0 });
    Object.assign(m, { d: 36.55, psi: 3.144, phi: 3.229, v: 50.4, boost: 1 });
    m.syncMesh(0);
    expect(step(m, { throttle: 1, brake: 0, steer: 0, drift: false }, 20)).toBeLessThan(0.6);
  });
  // main.js collide measured the bump box in route coordinates (s, d), so it grew with 1 - k d: far out on a bend's
  // outside karts 10-16 apart in the world bumped (Mario Raceway (185, 35), 38 out: thrown 3 in a frame), far in on
  // its inside karts on top of each other passed through; and side by side both pushes shoved them 1.7 along the road
  it('bumps karts that touch in the world, not in route coordinates', async () => {
    const t = await makeTrack('mario'), a = makeKart(t), b = makeKart(t);
    const put = (k, s, d) => { k.s = s; k.prevS = s; k.d = d; k.v = 30; k.prevX = undefined; k.prevZ = undefined; k.syncMesh(0); };
    const dist = () => Math.hypot(a.world.x - b.world.x, a.world.z - b.world.z);
    const fr = { pos: new THREE.Vector3(), T: new THREE.Vector3(), U: new THREE.Vector3(), R: new THREE.Vector3(), k: 0 };
    let out = null, inn = null, straight = null;
    for (let s = 0; s < t.length; s += 2) {
      const k = t.frameAt(s, fr).k, side = Math.sign(k);
      if (Math.abs(k) < 1e-3) { if (straight == null && Math.abs(t.frameAt(s + 4, fr).k) < 1e-3) straight = s; continue; }
      const dOut = -side * (t.wallAt(s, -side) - 1.5), dIn = side * Math.min(t.wallAt(s, side) - 1.5, 0.6 / Math.abs(k));
      if (!out && 1 - k * dOut > 1.6) out = [s, dOut];
      if (!inn && 1 - k * dIn < 0.5) inn = [s, dIn];
    }
    expect(out && inn && straight != null).toBeTruthy();
    // far out on a bend's outside: 3 along the route is well over the box's 3.4 in the world - no bump
    put(a, out[0], out[1]); put(b, out[0] + 3, out[1]);
    expect(dist()).toBeGreaterThan(4);
    bumpKarts(a, b);
    expect([a.s, a.d, b.s, b.d]).toEqual([out[0], out[1], out[0] + 3, out[1]]);
    // far in on a bend's inside: 3.6 along the route is under 2.5 in the world - pushed apart
    put(a, inn[0], inn[1]); put(b, inn[0] + 3.6, inn[1]);
    const before = dist();
    expect(before).toBeLessThan(2.5);
    bumpKarts(a, b); a.syncMesh(0); b.syncMesh(0);
    expect(dist()).toBeGreaterThan(before + 0.2);
    // side by side: pushed apart across only, not shoved along the road
    put(a, straight, 0); put(b, straight + 0.2, 1.8);
    bumpKarts(a, b);
    expect(a.s).toBe(straight); expect(b.s).toBeCloseTo(straight + 0.2, 9);
    expect(b.d - a.d).toBeGreaterThan(2);
  });
  // the route limit is the narrowest of its neighbours, so it closes in 2.5 short of Bowser's Castle's wall across the
  // outside of the road at x 105 (z 50-60, s1199): a kart driving at the wall was snapped sideways 1.1 a physics step,
  // 2.2 a frame at the game's two steps, instead of meeting the face; and the eased limit took 0.5 a step, not a frame
  it('meets a wall across its lane instead of being snapped sideways by the limit closing in ahead of it', async () => {
    const t = await makeTrack('bowser');
    const k = makeKart(t, { isPlayer: true, s: 1194, d: 0 });
    Object.assign(k, { d: -12, psi: 0, phi: 0, v: 30 });
    k.syncMesh(0);
    let worst = 0;
    for (let i = 0; i < 40; i++) {
      const x = k.world.x, z = k.world.z, v = Math.abs(k.v);
      k.update(1 / 120, { throttle: 1, brake: 0, steer: 0, drift: false });
      k.update(1 / 120, { throttle: 1, brake: 0, steer: 0, drift: false });
      worst = Math.max(worst, Math.hypot(k.world.x - x, k.world.z - z) - v / 60);
      expect(k.world.x).toBeGreaterThan(105.5);
    }
    expect(worst).toBeLessThan(0.6);
  });
  it('is eased in, not slid along at 4x its move, where the limit closes in steeply along Bowser\'s Castle\'s ledge', async () => {
    // the limit beside the ledge over the lava at (68, 35-55) closes 4 in per 1 along (s1233-1238): under the 1-unit
    // ease threshold every step, the snap carried a kart on the limit 1.4 a frame along the edge at 22 (0.37 a frame)
    const t = await makeTrack('bowser');
    for (const [s, d, v, steer] of [[1233.0, 15.4, 22.5, 0.42], [1231.8, 3.2, 44, 0], [1234.2, -4.4, 34.3, 0]]) {
      const k = makeKart(t, { isPlayer: true, s: 1200, d: 0 });
      Object.assign(k, { s, d, psi: Math.sign(d) * 0.1, phi: Math.sign(d) * 0.1, v });
      k.syncMesh(0);
      let worst = 0;
      for (let i = 0; i < 20 && !k.fell; i++) {
        const x = k.world.x, z = k.world.z, v0 = Math.abs(k.v);
        k.update(1 / 120, { throttle: 1, brake: 0, steer, drift: false });
        k.update(1 / 120, { throttle: 1, brake: 0, steer, drift: false });
        worst = Math.max(worst, Math.hypot(k.world.x - x, k.world.z - z) - v0 / 60);
      }
      expect(worst).toBeLessThan(0.7);
    }
  });
  it('rides down a bank too steep to stand on without being shoved off it by its own slope', async () => {
    // Royal Raceway's 48 deg bank beside the road at (-78, -163), s369: riding down it, the upright body's lower
    // circles cut the slope it is on (its ground sinks under it), then the slope behind it at its foot, and the face
    // pushed it off 1-1.9 a frame at 20 (0.33 a frame)
    const t = await makeTrack('royal');
    const k = makeKart(t, { isPlayer: true, s: 360, d: 0 });
    Object.assign(k, { s: 368.8, d: -23.15, psi: -1.39, phi: -1.3, v: 19.8, y: undefined, groundY: -3.2, prevX: undefined, prevZ: undefined });
    k.syncMesh(0);
    let worst = 0;
    for (let i = 0; i < 20 && !k.fell; i++) {
      const x = k.world.x, z = k.world.z, v0 = Math.abs(k.v);
      k.update(1 / 120, { throttle: 1, brake: 0, steer: -0.58, drift: false });
      k.update(1 / 120, { throttle: 1, brake: 0, steer: -0.58, drift: false });
      worst = Math.max(worst, Math.hypot(k.world.x - x, k.world.z - z) - v0 / 60);
    }
    expect(worst).toBeLessThan(0.7);
  });
  it('rides beside the crest of Choco Mountain\'s ledge without being shoved down the ridge by its edge', async () => {
    // the ledge's edge at (-9.5, 11, 4.9) -> (-5.3, 2, 16.3) runs down 37 deg with a steep fan below it on one side
    // and the kart's ground on the other; backing down beside it (s1131, d -9), the body's height band cut the edge
    // behind the kart and the edge pushed it on down the ridge, 1-1.3 a frame at a crawl
    const t = await makeTrack('choco');
    const k = makeKart(t, { isPlayer: true, s: 1120, d: 0 });
    Object.assign(k, { s: 1131.26, d: -9.07, psi: 0.46, phi: 0.1, v: -12, wallEase: 9, y: undefined, groundY: 8, prevX: undefined, prevZ: undefined });
    k.syncMesh(0);
    let worst = 0;
    for (let i = 0; i < 9 && !k.fell; i++) {
      const x = k.world.x, z = k.world.z, v0 = Math.abs(k.v);
      k.update(1 / 120, { throttle: 1, brake: 0, steer: 0.92, drift: false });
      k.update(1 / 120, { throttle: 1, brake: 0, steer: 0.92, drift: false });
      worst = Math.max(worst, Math.hypot(k.world.x - x, k.world.z - z) - v0 / 60);
    }
    expect(worst).toBeLessThan(0.75);
  });
  it('is not shoved off the 55 deg slope below Choco Mountain\'s ledge by a hair\'s move into it at a standstill', async () => {
    // eased in down the slope at (-6, 10) (s1130, d -6, normal y 0.59), stopped: the slope the kart rides overlaps its
    // body and pushes out only the part its own move took it in, unless it moves into the face. A step of 0.001 into it
    // at v 0.1 counted as driven in and the whole overlap was pushed out: 1.2 sideways in one step (1.5 a frame)
    const t = await makeTrack('choco');
    const x = -5.902, z = 9.96, y = 4.395;
    const h = t.wallPush(x, z + 0.001, x, z, y, 1.336);
    expect(h).not.toBeNull();
    expect(Math.hypot(h.x - x, h.z - z)).toBeLessThan(0.3);
    // driven into it (0.3 a step) it still pushes the overlap out
    const in3 = t.wallPush(x + 0.3, z, x, z, y, 1.336);
    expect(Math.hypot(in3.x - x, in3.z - z)).toBeGreaterThan(1);
  });
  it('is not shoved down Choco Mountain\'s 52 deg slope at (5, 96) turning uphill across it', async () => {
    // the drawn slope Mario rides (normal y 0.62) lies 0.85 over its collision face (0.67), so the body overlaps the
    // face ~0.5 wherever it is on the slope; turned 0.14 a step uphill that counted as driven in and the whole overlap
    // was pushed out down the slope every step (0.63 a step, 1.3 a frame at v 10). Riding steep ground, only the move
    // in plus 0.15 goes
    const t = await makeTrack('choco');
    const h = t.wallPush(5.47, 96.0721, 5.7337, 95.9754, 2.1945, 1.3359);
    expect(h).not.toBeNull();
    expect(Math.hypot(h.x - 5.7337, h.z - 95.9754)).toBeLessThan(0.35);
    // from the floor at its foot, driven into it, it still pushes the whole overlap out
    const foot = t.wallPush(6.5647, 97.7737, 6.8363, 97.7162, 0.0809, 1.3359, 0.0511);
    expect(Math.hypot(foot.x - 6.8363, foot.z - 97.7162)).toBeGreaterThan(0.6);
  });
  it('is not shoved off the side of Choco Mountain\'s 58 deg slope at (-7, 14) creeping beside it', async () => {
    // Bowser eased in onto the slope below the ledge, beside the 58 deg face's sloped edge, creeping 0.008-0.024 a step:
    // the edge's whole line beside him (end-on rule, as if driven along the edge) pushed where the cut point he was
    // measured against last step did not - 0.97 sideways in one step (1.25 a frame)
    const t = await makeTrack('choco');
    const dist = (h, x, z) => h ? Math.hypot(h.x - x, h.z - z) : 0;
    expect(dist(t.wallPush(-6.75, 13.623, -6.754, 13.616, 4.22, 1.688), -6.754, 13.616)).toBeLessThan(0.3);
    expect(dist(t.wallPush(-6.783, 13.584, -6.795, 13.563, 4.266, 1.688), -6.795, 13.563)).toBeLessThan(0.3);
    // driven into the face (0.35 a step) it still pushes the overlap out
    expect(dist(t.wallPush(-6.5, 13.75, -6.795, 13.563, 4.266, 1.688), -6.795, 13.563)).toBeGreaterThan(0.8);
  });
  it('is not snapped up onto Choco Mountain\'s drawn-only hump at (-70, 43) it falls under after a jump (jumps physics)', async () => {
    // the hump at (-78, 27)..(-68, 45) is drawn 2-4 over the collision floor and has no collision of its own; Bowser
    // rode the floor in under it, jumped its crest and fell back past the hump's height + 3: the in-flight "inside a
    // mound" rule took the hump within 3 over him as just come in under (a frame ago it was over 3 up) - 3.2 in a frame
    const t = await makeTrack('choco'), glue = PHYSICS.glue;
    PHYSICS.glue = false;
    try {
      const k = makeKart(t, { character: 'bowser' });
      Object.assign(k, { s: 498.8792, d: 11.1415, psi: -0.5741, phi: -0.5992, v: 19.37, y: 3.9475, vy: -20.9266, groundY: 3.9475,
        prevX: -69.2362, prevZ: 43.0291, air: true, ticks: 0, dac: 1, airTicks: 27, lead: 0, groundN: new THREE.Vector3(0.382, 0.871, -0.308) });
      const inp = { throttle: 0, brake: 0, steer: 0, drift: true };
      let py = k.y, max = 0;
      for (let i = 0; i < 24; i++) { k.update(1 / 120, inp); max = Math.max(max, Math.abs(k.mesh.position.y - py)); py = k.mesh.position.y; }
      expect(max).toBeLessThan(0.5);
      expect(k.mesh.position.y).toBeLessThan(3);   // on the collision floor (~2), not the hump (~5)
    } finally { PHYSICS.glue = glue; }
  });
  it('is not shoved sideways off Koopa Troopa Beach\'s rock face when its ground drops beside it', async () => {
    // eased in past the limit down the rock at (-48, 184), the ground fell 1.4 in a frame: the 73 deg face (top 3.9,
    // not a low face, too steep for the slope rule) now cut the body 1.2 deep at a kart backing away from it, and
    // pushed it all out in one step (1.26 a frame). Not moving into it, it pushes out only 0.15 a step
    const t = await makeTrack('koopa');
    const x = -47.709, z = 183.276, y = 2.116;
    const h = t.wallPush(-47.672, 183.27, x, z, y, 1.336);
    expect(h).not.toBeNull();
    expect(Math.hypot(h.x - x, h.z - z)).toBeLessThan(0.3);
    // driven into it (0.3 a step) it pushes back the move (no deeper in) + 0.15, not the whole overlap at once
    const into = t.wallPush(x - 0.25, z - 0.166, x, z, y, 1.336);
    expect(Math.hypot(into.x - x, into.z - z)).toBeGreaterThan(0.3);
    expect(Math.hypot(into.x - x, into.z - z)).toBeLessThan(0.6);
    // and beside a face, driving onto the end of one (Koopa's at (-61, 168)) still meets its rim (as far in as the
    // edge's cut through the body's height is, not the edge's whole line beside it)
    const rim = t.wallPush(-60.744, 167.386, -60.667, 167.837, 0.086, 1.336);
    expect(Math.hypot(rim.x + 60.667, rim.z - 167.837)).toBeGreaterThan(0.4);
  });
  it('is not thrown off Koopa Troopa Beach\'s rock face it already overlaps when it turns into it', async () => {
    // Bowser eased in down the rock at (-48, 184): the ground dropped 1.25 in a frame and left the 73 deg face 1.5 into
    // his body (eased out 0.15 a step, not moving into it); a 0.1 turn into it the next step pushed the whole overlap
    // out at once, the plane 1.6 and the face's rim at the top circle 1.28 (1.7 a frame). Now a face no slope (normal y
    // under 0.35) that the body already overlapped pushes back the move in + 0.15, moving into it or not
    const t = await makeTrack('koopa');
    const h = t.wallPush(-48.1884, 184.1357, -48.0603, 184.0983, 2.261, 1.6875);
    expect(h).not.toBeNull();
    expect(Math.hypot(h.x + 48.0603, h.z - 184.0983)).toBeLessThan(0.4);
    // from outside it, driven into it, the whole overlap still goes (the body never ends up further in than it was)
    const out = t.wallPush(-49.6, 182.9, -48.0603, 184.0983, 2.261, 1.6875);
    expect(Math.hypot(out.x + 48.0603, out.z - 184.0983)).toBeGreaterThan(1);
  });
  it('is not shoved sideways by the side of a Koopa Troopa Beach ramp it drives up beside, nor past an edge\'s end', async () => {
    // Bowser on the road 0.36 from the side of the ramp at (-6, 73), driving along it toward where its edge rises into
    // his body: once the body reached past the edge's cut through its height the edge's whole line beside him pushed,
    // 1.33 in one step (1.1 a frame). Now the line comes in only as near as the cut point is
    const t = await makeTrack('koopa');
    const step = t.wallPush(-6.411, 73.566, -6.46, 73.343, 0.1, 1.688);
    expect(step).not.toBeNull();
    expect(Math.hypot(step.x + 6.46, step.z - 73.343)).toBeLessThan(0.5);
    // past the end of the edge of the rock's slope at (-145, -79) there is no edge beside him (1.43 in one step)
    const end = t.wallPush(-145.36, -79.955, -145.145, -79.766, 3.171, 1.688);
    expect(end ? Math.hypot(end.x + 145.145, end.z + 79.766) : 0).toBeLessThan(0.3);
  });
  it('is eased off the side of a Koopa Troopa Beach wedge ramp it rides off, not thrown off it in one step', async () => {
    // Bowser riding up the ramp at (-6, 71) across its side: his centre 0.05 past the side's edge, the edge (his ramp
    // top's a step before, so no rim where he was) pushed its whole line, 1.63 in one step; then pass 2, his move
    // including pass 1's push, met the edge's cut point ahead head-on (30 -> -18). Off the top (ground now 0.7 lower)
    // the edge he rode counts where he was: pushed back his move out + 0.15
    const t = await makeTrack('koopa');
    const dist = (h, x, z) => h ? Math.hypot(h.x - x, h.z - z) : 0;
    const b = t.wallPush(-6.044, 71.33, -6.154, 71.111, 0.823, 1.688, 0.823);
    expect(dist(b, -6.154, 71.111)).toBeLessThan(0.4);
    expect(Math.abs(b.nx)).toBeGreaterThan(0.99);   // sideways off the side, not back off the edge ahead
    // Mario off the ramp at (-6, 52): the edge's cut point ahead was out of reach where he was (1.24 in a step)
    expect(dist(t.wallPush(-5.573, 52.179, -5.859, 51.767, 0.574, 1.336, 0.574), -5.859, 51.767)).toBeLessThan(0.5);
    // off the foot of the start ramp at (-180, 17), 0.36 up, the side still pushes the whole overlap (else 37% sank in)
    expect(dist(t.wallPush(-179.615, 16.212, -179.637, 16.676, 0.434, 1.688, 0.434), -179.637, 16.676)).toBeGreaterThan(1);
  });
  it('is not thrown off the foot of Koopa Troopa Beach\'s wedge ramp at (-6, 73) by the side\'s line under its body', async () => {
    // Bowser riding up the ramp 0.12 over the road, his centre 0.13 past the side: the edge beside him (0.37 up) is under
    // the body's foot over the road (0.65), yet the whole line pushed, 1.56 in one step. The cut ahead pushes, sideways
    // in every pass (a pass's move is the kart's own, else the cut point shoved him back: turned 0.6 rad, 62 -> 51)
    const t = await makeTrack('koopa');
    const h = t.wallPush(-6.039, 73.14, -6.23, 72.686, 0.22, 1.688, 0.22);
    expect(h).not.toBeNull();
    expect(Math.hypot(h.x + 6.23, h.z - 72.686)).toBeLessThan(1.1);
    expect(Math.abs(h.nx)).toBeGreaterThan(0.99);
  });
  it('is not eased off the side of Koopa Troopa Beach\'s wedge ramp at (-56, 169) once per pass, deeper each time', async () => {
    // Donkey Kong riding up the ramp along its side, his centre 0.03 past the top's edge: the side's edge pushed him off
    // across the face's plane, deeper into it each pass, and each of the 3 passes eased out the extra again (0.28 + 0.4
    // + 0.77, 1.45 in one step). The eased part is the face's over all passes
    const t = await makeTrack('koopa');
    const h = t.wallPush(-56.652, 168.824, -56.376, 169.107, 1.204, 1.477, 1.204);
    expect(h ? Math.hypot(h.x + 56.376, h.z - 169.107) : 0).toBeLessThan(0.4);
  });
  it('is not eased across Koopa Troopa Beach\'s rock prow at (-48.4, 185.2) once per triangle of its split side', async () => {
    // Donkey Kong falling off the rock's tip: pushed 0.32 off the face beside him, then on across the prow's 81 deg
    // side, split in two nearly coplanar triangles, by each in turn (0.36 + 0.62): 1.3 in one step (1.05 a frame).
    // The eased push across a face's plane is done for the step for every triangle in that plane
    const t = await makeTrack('koopa');
    const h = t.wallPush(-48.477, 185.228, -48.371, 185.376, 3.07, 1.477, 3.07);
    expect(h).not.toBeNull();
    expect(Math.hypot(h.x + 48.371, h.z - 185.376)).toBeLessThan(0.8);
  });
  it('is not held inside D.K.\'s Jungle Parkway\'s river bank at (100, -188) from the floor that runs on under it', async () => {
    // the river floor (-3.4) runs on under the 49 deg bank (1.7 high); the Wii 3D kart come down the bank onto it had
    // its tail circle (r 1.25) behind the bank's plane, and each step its move out (0.53 toward the river) was pushed
    // back into the bank, 0.68 (+ 0.15): held there at full throttle, creeping 0.02 a frame
    const t = await makeTrack('dk');
    const h = t.wallPush(100.763, -188.917, 100.799, -188.383, -3.4, 1.252, -3.4);
    expect(h ? h.z : -188.383).toBeGreaterThan(-188.4);
    // ... and the nose circle at the bank's foot is still pushed out toward the river, not into the bank
    const n = t.wallPush(100.901, -187.621, 100.937, -187.087, -3.4, 1.252, -3.4);
    expect(n ? n.z : -187.087).toBeGreaterThan(-187.1);
  });
  it('is not pushed on into Koopa Troopa Beach\'s mound at (-15, 15) by its 50 deg face rising from the edge it rides', async () => {
    // the face (foot 0.1, top 3.7) rises from the edge of the 0.82 slope up the mound; eased back down off the top by
    // the route limit, the Wii 3D kart's nose circle came in from behind the face's plane, 0.57 over its ground there,
    // and was pushed on into the mound (0.54) while the limit eased it out: it shuttled half its width in the face
    const t = await makeTrack('koopa');
    const h = t.wallPush(-15.743, 14.806, -15.248, 14.561, 3.254, 1.252, 3.254);
    expect(h.nx).toBeGreaterThan(0.9);
    expect(h.x).toBeGreaterThan(-15.25);
  });
  it('is not thrown off the tip of a Frappe Snowland bank face it crosses in front of on the ground', async () => {
    // the face at (-108, -105) rises from a tip on the ground; Bowser crossing past the tip was behind its plane
    // there, read as coming off a ramp's top, and the edge's whole line pushed him 1.6 in one step
    const t = await makeTrack('frappe');
    const step = t.wallPush(-107.946, -105.115, -108.61, -105.475, -4.809, 1.688);
    expect(step ? Math.hypot(step.x + 108.61, step.z + 105.475) : 0).toBeLessThan(1);
  });
  it('is not thrown off Yoshi Valley\'s 67 deg canyon side it rides down, turning across it', async () => {
    // Bowser past the bound at (-307, -48), riding down the canyon side (its ground dropping 1.5 a frame, the upright
    // body 1.45 into the face it rides) and turning across it: measured at one height, the turn read as a move into
    // the face (0.08 a step) and its whole overlap went at once, 1.6 off the cliff in one step. With last frame's
    // height the move is along the face and it eases out
    const t = await makeTrack('yoshi');
    const step = t.wallPush(-306.606, -47.745, -306.587, -47.448, -18.475, 1.688, -18.646);
    expect(step ? Math.hypot(step.x + 306.587, step.z + 47.448) : 0).toBeLessThan(0.3);
    // driven into it at its own height (0.3 a step) it still pushes the whole overlap out
    const into = t.wallPush(-306.9, -47.45, -306.587, -47.448, -18.475, 1.688, -18.475);
    expect(Math.hypot(into.x + 306.587, into.z + 47.448)).toBeGreaterThan(1);
    // the kart itself, two steps from the fuzz's spot: no step more than its own move + 0.5
    const k = makeKart(t, { isPlayer: true, character: 'bowser', s: 900, d: 0 });
    Object.assign(k, { s: 906.6786, d: 13.968, psi: 0.2793, phi: 0.3507, v: 37.35, y: -17.918, vy: -22.41, groundY: -17.918,
      prevX: -306.2376, prevZ: -47.9715, air: false, wallT: 0.59, wallN: { t: -0.1314, r: 0.9913 } });
    k.syncMesh(0);
    for (let i = 0; i < 2; i++) {
      const x = k.world.x, z = k.world.z, v0 = Math.abs(k.v);
      k.update(1 / 120, { throttle: 1, brake: 0, steer: -0.7134, drift: false });
      expect(Math.hypot(k.world.x - x, k.world.z - z) - v0 / 120).toBeLessThan(0.5);
    }
  });
  it('is not shoved down Mario Raceway\'s 46 deg hillside at (98, -87) by both Wii 3D capsule circles at once', async () => {
    // backing down the hillside (normal y 0.69, a wall face the kart rides) 10 past the route limit: both axle circles
    // cut the slope, each was eased off it 0.15 in each of routeWallPush's two passes, and the two circles' pushes along
    // the heading were added up: 1.9 a frame down the slope at v -11.9 (player fuzz WII3D mario 120 seed 45)
    const t = await makeTrack('mario');
    const k = makeKart(t, { isPlayer: true, s: 140, d: 0 });
    const model = new THREE.Group();
    model.userData.update = () => {};
    model.userData.capsule = { front: 0.7315, rear: -0.5719, r: 1.252 };
    k.set3D(model);
    Object.assign(k, { s: 148.7274, d: -9.8721, psi: -1.0978, phi: -2.4316, v: -11.903, y: 5.1863, vy: -7.1418, groundY: 5.1863,
      prevX: 98.6327, prevZ: -87.4177, air: false, wallEase: 10.7514, wallT: 0.59, hitWall: 0.225, wallN: { t: 0.0793, r: 0.9969 } });
    k.syncMesh(0);
    const x = k.world.x, z = k.world.z;
    for (let i = 0; i < 2; i++) k.update(1 / 120, { throttle: 1, brake: 0, steer: -0.1197, drift: false });
    expect(Math.hypot(k.world.x - x, k.world.z - z)).toBeLessThan(1);
  });
  it('is not thrown up Royal Raceway\'s bank at (-272, -55) from inside it, its drawn ground 0.9 under the collision slope', async () => {
    // Bowser's Wii 3D tail circle (r 1.5) rides the drawn bank, 1.7 inside the collision slope's hill; a step 0.05
    // further in pushed the whole overlap out over the slope, 2.3 in one step (player fuzz WII3D royal bowser seed 46)
    const t = await makeTrack('royal');
    const h = t.wallPush(-272.375, -54.729, -272.201, -55.002, -2.084, 1.495, -1.817);
    expect(h ? Math.hypot(h.x + 272.201, h.z + 55.002) : 0).toBeLessThan(1);
  });
  it('is not shoved off Choco Mountain\'s 58 deg slope at (-7, 9) by its own ground sinking under it', async () => {
    // Bowser's Wii 3D nose circle riding down beside the slope below the ledge, moving away from it: the ground under it
    // dropped 0.17, which in plane terms reads as moving into the slope, so its whole overlap was pushed out, 0.78 in
    // one step (1.4 a frame; player fuzz WII3D choco bowser seed 46)
    const t = await makeTrack('choco');
    const h = t.wallPush(-6.966, 8.937, -6.962, 9.181, 7.051, 1.495, 7.225, 0);
    expect(h ? Math.hypot(h.x + 6.962, h.z - 9.181) : 0).toBeLessThan(0.3);
  });
  it('is not thrown off the side of Koopa Troopa Beach\'s wedge ramp at (-6, 52) as its nose drops off it', async () => {
    // Bowser's Wii 3D kart driving off the ramp's side at full speed: the centre came down onto the road (0.1) first,
    // then the nose circle left the ramp's top (0.49 under it) over the side's 0.1-2.1 face. Measured at the road the
    // body band took in the face's sloped edge it had ridden over, and the whole overlap went, 1.37 in one step (1.65 a
    // frame; player fuzz WII3D koopa bowser seed 46). Its overlap where it was counts at the height it is now
    const t = await makeTrack('koopa');
    const h = t.wallPush(-5.662, 52.424, -5.927, 52.129, 0.1, 1.495, 0.1, 0.15, 0.492);
    expect(h ? Math.hypot(h.x + 5.927, h.z - 52.129) : 0).toBeLessThan(0.5);
  });
  it('is not thrown down Royal Raceway\'s bank at (-270, -59) as the route limit eases it a hair back in', async () => {
    // Bowser's Wii 3D nose circle riding the drawn bank (27 deg), 0.57 under its 48 deg collision face, past the route
    // limit: the limit's ease drew it 0.02 back into the face, which read as driven into it from a floor, and the whole
    // overlap went, 1.95 in one step (player fuzz WII3D royal bowser seed 46). The kart rides the slope: eased
    const t = await makeTrack('royal');
    const h = t.wallPush(-269.807, -58.365, -269.734, -58.296, -4.851, 1.495, -4.903, 0.15, -4.903);
    expect(h ? Math.hypot(h.x + 269.734, h.z + 58.296) : 0).toBeLessThan(0.5);
  });
  it('is not shuttled between Royal Raceway\'s mound foot and the route limit easing it in', async () => {
    // Bowser 23 out past the limit at (-116, 8), eased in (wallEase) at a standstill against the mound's 53 deg foot:
    // the face pushed him out past the eased edge, and the edge snapped him back in from where it had eased to,
    // 1.2 in one step, into the face again (1.15 a frame)
    const t = await makeTrack('royal');
    const k = makeKart(t, { isPlayer: true, character: 'bowser', s: 1600, d: 0 });
    Object.assign(k, { s: 1630.1442, d: -23.1313, psi: 2.8897, phi: 3.109, v: -0.971, y: -6, vy: 0, groundY: -6,
      prevX: undefined, prevZ: undefined, air: false, wallEase: 23.1313, wallT: 0.59, hitWall: 0.17, wallN: { t: 0.5155, r: -0.8569 } });
    k.syncMesh(0);
    let worst = 0;
    for (let i = 0; i < 120; i++) {
      const x = k.world.x, z = k.world.z, v0 = Math.abs(k.v);
      k.update(1 / 120, { throttle: 1, brake: 0, steer: 0.9067, drift: false });
      worst = Math.max(worst, Math.hypot(k.world.x - x, k.world.z - z) - v0 / 120);
    }
    expect(worst).toBeLessThan(0.5);
  });
  it('cpuSpeedControl assigns fast / normal / slow to CPUs', async () => {
    const track = await makeTrack('mario');
    const karts = [makeKart(track, { isPlayer: true, s: 50 })];
    for (let i = 0; i < 7; i++) { const k = makeKart(track, { s: 20 + i * 20, d: (i % 3 - 1) * 4 }); k.v = 30; karts.push(k); }
    pickRivals(karts);
    const order = [...karts].sort((a, b) => b.progress - a.progress);
    cpuSpeedControl(karts, order, track, 2);
    for (const k of karts.slice(1)) expect(['fast', 'normal', 'slow']).toContain(k.aiSpeed);
    // lap 3 and a wide gap
    karts.forEach(k => { k.crossings = 2; });
    karts[3].progress; karts[3].crossings = 2;
    cpuSpeedControl(karts, order, track, 0);
    // no humans / unknown course: nothing happens
    const before = karts.map(k => k.aiSpeed);
    cpuSpeedControl(karts, order.filter(k => !k.isPlayer), track, 2);
    expect(karts.map(k => k.aiSpeed)).toEqual(before);
    cpuSpeedControl(karts, order, { length: 1, def: { id: 'zzz' } }, 2);
  });
  it('cpuSpeedControl runs on Mario with leading CPU gaps', async () => {
    const track = await makeTrack('luigi');
    const player = makeKart(track, { isPlayer: true, s: 10 });
    const cpus = Array.from({ length: 4 }, (_, i) => makeKart(track, { s: 300 + i * 30 }));
    cpus.forEach(c => { c.v = 40; c.crossings = 1; });
    const karts = [player, ...cpus];
    cpuSpeedControl(karts, [...cpus].reverse().concat(player), track, 1);
    expect(cpus.map(c => c.aiSpeed).every(Boolean)).toBe(true);
    cpus[0].crossings = -1;
    cpuSpeedControl(karts, [...cpus].concat(player), track, 1);
    expect(cpus[0].aiSpeed).toBe('fast');   // before the start line (lap < 0)
  });
});

describe('Kart in a battle arena', () => {
  it.each(['block-fort', 'big-donut'])('%s: spawns, drives, thinks and is rescued', async id => {
    const track = await makeTrack(id);
    const kart = new Kart(track, { color: 1, s: 0, d: 0, isPlayer: true, spawn: battleSpawn(id, 0) });
    const foe = new Kart(track, { color: 2, s: 0, d: 0, spawn: battleSpawn(id, 1) });
    expect(kart.free).toBe(true);
    expect(kart.balloons).toBe(3);
    expect(kart.balloonFx).toHaveLength(3);
    const karts = [kart, foe];
    let top = 0;
    for (let i = 0; i < 60 * 4; i++) {
      kart.update(1 / 60, { throttle: 1, brake: 0, steer: Math.sin(i / 30), drift: i % 100 < 40 });
      foe.update(1 / 60, foe.think(1 / 60, karts));
      top = Math.max(top, kart.v);
    }
    expect(Number.isFinite(kart.x)).toBe(true);
    expect(top).toBeGreaterThan(10);
    // balloons render for a camera
    const cam = new THREE.PerspectiveCamera(); cam.position.set(0, 20, 0); cam.userData.kart = kart; cam.updateMatrixWorld();
    kart.balloonFx.forEach(b => b.m.onBeforeRender(null, null, cam));
    kart.balloons = 1; kart.balloonT = 0;
    kart.balloonFx[0].m.onBeforeRender(null, null, cam);
    kart.balloonT = 0; kart.balloonFx[2].m.onBeforeRender(null, null, cam);
    cam.userData.kart = null;
    kart.balloonT = 0; kart.balloonFx[1].m.onBeforeRender(null, null, cam);
    kart.mesh.userData.dispose();
    // falling below the arena puts the kart back with Lakitu
    kart.y = track.fallY - 5; kart.air = true;
    kart.update(1 / 60, idle);
    expect(kart.rescue).toBeGreaterThan(0);
    const bal = kart.balloons;
    for (let i = 0; i < 120; i++) kart.update(1 / 60, idle);
    expect(kart.balloons).toBe(bal - 1);
    expect(kart.x).toBeCloseTo(kart.spawn.x, 5);
    // tumble / spin in free mode
    kart.startTumble('high');
    for (let i = 0; i < 60; i++) kart.update(1 / 60, gas);
    kart.spin = 0.3;
    for (let i = 0; i < 30; i++) kart.update(1 / 60, gas);
    kart.finished = true; kart.update(1 / 60, gas);
  }, 30000);
  it('clearPath detects walls and the CPU navigates via item boxes', async () => {
    const track = await makeTrack('block-fort');
    const a = new Kart(track, { color: 1, s: 0, d: 0, spawn: battleSpawn('block-fort', 0) });
    const b = new Kart(track, { color: 2, s: 0, d: 0, spawn: battleSpawn('block-fort', 1) });
    expect(typeof a.clearPath(b.x, b.y, b.z)).toBe('boolean');
    a.think(0.6, [a, b]);
    expect(a.goal === null || a.goal === b || typeof a.goal.x === 'number').toBe(true);
    a.reverse = 0.3;
    expect(a.think(0.1, [a, b]).brake).toBe(1);
    a.reverse = 0; a.v = 0;
    for (let i = 0; i < 100; i++) a.think(0.02, [a, b]);
  });
  // player fuzz in the arenas (random spots, random inputs): a kart rolling off a block was put on the floor 4.7 below
  // in a frame, one scraping a wall at a few degrees stopped dead, and Skyscraper's 59 deg bridge sides let a kart in
  // under their roofs (a tunnel along the bridge at (0, 36): floor x +-5.4, roof 3.9 up at x +-3.4)
  it('falls off a ledge, slides along a wall and is kept out of a covered bridge', async () => {
    const put = (k, o) => { Object.assign(k, { vy: 0, air: false, drift: 0, slip: 0, wallT: 0, hitWall: 0, prevX: undefined, prevZ: undefined }, o); k.syncFree(0); };
    const fort = await makeTrack('block-fort');
    const k = new Kart(fort, { color: 1, s: 0, d: 0, isPlayer: true, spawn: battleSpawn('block-fort', 0) });
    put(k, { x: 63, z: -22.1, y: 4.7, h: 1.4677, v: 34 });
    expect(k.y).toBeCloseTo(4.7, 1);
    let y = k.y, maxStep = 0, flew = false;
    for (let i = 0; i < 40; i++) {
      k.update(1 / 60, gas);
      if (!k.air) maxStep = Math.max(maxStep, Math.abs(k.y - y));
      flew ||= k.air; y = k.y;
    }
    expect(flew).toBe(true);
    expect(maxStep).toBeLessThan(1);
    expect(k.y).toBeCloseTo(0, 1);
    put(k, { x: 74.5, z: -40, y: 0, h: 0.17, v: 40 });
    for (let i = 0; i < 90; i++) k.update(1 / 60, gas);
    expect(k.v).toBeGreaterThan(20);
    expect(k.z).toBeGreaterThan(-15);
    const sky = await makeTrack('skyscraper');
    const s = new Kart(sky, { color: 1, s: 0, d: 0, isPlayer: true, spawn: battleSpawn('skyscraper', 0) });
    put(s, { x: -3, z: 28, y: 48, h: -0.15, v: 25 });
    for (let i = 0; i < 60; i++) {
      s.update(1 / 60, gas);
      const top = sky.groundBelow(s.x, s.z, s.y + 3);
      expect(top.y - s.y).toBeLessThan(1);
    }
    expect(s.z).toBeGreaterThan(36);
  }, 30000);
  // arena fuzz with boosts: a kart stopped nose-first against a wall a few degrees off square was bounced to travel
  // along it at +-1.2-1.4 rad off the nose, and the throttle, added to the speed along that travel, pushed it sideways
  // the other way each frame: pinned with the throttle held (Block Fort's wall at (-33, 7), Double Deck's at (-17, 37))
  it('scrapes off a wall it is stopped against nose-first with the throttle held', async () => {
    for (const [id, o, input] of [['block-fort', { x: -33.461, z: 7.0641, y: 0, h: 0.1221, v: -0.728, slip: 1.2193 }, gas],
      ['double-deck', { x: -16.942, z: 37.0641, y: 3, h: -0.0485, v: -0.78, slip: 1.4004 }, { throttle: 1, brake: 0, steer: 0.15, drift: true }]]) {
      const t = await makeTrack(id);
      const k = new Kart(t, { color: 1, s: 0, d: 0, isPlayer: true, spawn: battleSpawn(id, 0) });
      Object.assign(k, { vy: 0, air: false, drift: 0, wallT: 0.5, hitWall: 0.1, prevX: undefined, prevZ: undefined }, o);
      k.syncFree(0);
      for (let i = 0; i < 180; i++) k.update(1 / 60, input);
      expect(Math.hypot(k.x - o.x, k.z - o.z)).toBeGreaterThan(3);
      expect(Math.abs(k.v)).toBeGreaterThan(1.2);
    }
  }, 30000);
});
