import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import * as THREE from 'three';
import { Kart, kartSpriteFrame, buildKartMesh, ccSpeedScale, CC_INDEX, CC_BATTLE, PATH_POINTS, speedKmh, PHYSICS,
  togglePhysics, physicsLabel, pickRivals, cpuSpeedControl } from '../src/kart.js';
import { makeTrack, makeKart, run, idle, gas, flush } from './helpers.js';
import { battleSpawn } from '../src/track.js';

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
    k.d = lim - 1.2 + 0.5; k.psi = 0.5; k.phi = 0.5; k.v = 40; k.wallEase = 0;
    k.update(1 / 60, gas);
    expect(Math.abs(k.d)).toBeLessThan(lim);
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
});
