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
    // there for the rest of a 150cc race (1 race in 3)
    const track = await makeTrack('royal');
    const cpu = makeKart(track, { name: 'Luigi', character: 'luigi', s: 980, d: -10 });
    cpu.d = -10; cpu.v = 40;
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
