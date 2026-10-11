import { describe, it, expect, vi, afterEach, beforeAll } from 'vitest';
import * as THREE from 'three';
import { Train, band, followPath } from '../src/train.js';
import { makeTrack, makeKart, def } from './helpers.js';

const camAt = (x, y, z, tx = 0, ty = 0, tz = 0) => {
  const c = new THREE.PerspectiveCamera(40, 1, 0.1, 10000);
  c.position.set(x * 0.1, y * 0.1, z * 0.1);
  c.lookAt(tx * 0.1, ty * 0.1, tz * 0.1);
  c.updateMatrixWorld(true);
  return c;
};
const scale = m => new THREE.Vector3().setFromMatrixScale(m).length();
const fakeAudio = () => ({ playSound: vi.fn(), stopSound: vi.fn(), starMusic: vi.fn() });
const TICK = 1 / 60 + 1e-9;

afterEach(() => vi.restoreAllMocks());

describe('band', () => {
  it('collapses the matrix outside [min, max) of x/z distance squared (course units)', () => {
    const o = new THREE.Object3D();
    o.position.set(5, 1, 0);
    o.updateMatrixWorld(true);
    o.userData = { origin: o.position, min: 100, max: 10000 };
    const cam = new THREE.PerspectiveCamera(); cam.updateMatrixWorld(true);   // 50 course units away: 2500
    band.call(o, null, null, cam);
    expect(scale(o.matrixWorld)).toBeGreaterThan(0);
    o.userData.max = 2500;   // d >= max
    band.call(o, null, null, cam);
    expect(scale(o.matrixWorld)).toBe(0);
    expect(o.matrixWorld.elements[12]).toBe(5);
    o.updateMatrixWorld(true);
    o.userData = { origin: o.position, min: 2501, max: 1e9 };   // d < min
    band.call(o, null, null, cam);
    expect(scale(o.matrixWorld)).toBe(0);
  });
});

describe('followPath', () => {
  // a straight 2D path along +x, one unit per point
  const P = Array.from({ length: 20 }, (_, i) => [i * 10, 0]);

  it('heads `speed` units at the mean of points +3 and +4 past the nearest', () => {
    const car = { idx: 0, pos: [0, 7, 0], vel: [0, 0], yaw: 0 };
    followPath(P, car, 5);
    expect(car.idx).toBe(0);
    expect(car.pos).toEqual([5, 7, 0]);
    expect(car.vel).toEqual([5, 0]);
    expect(car.yaw).toBeCloseTo(Math.PI / 2);
  });

  it('finds the nearest point within the search window and wraps at the start', () => {
    const car = { idx: 1, pos: [42, 0, 1], vel: [0, 0], yaw: 0 };
    followPath(P, car, 5);
    expect(car.idx).toBe(4);
    const wrap = { idx: 0, pos: [190, 0, 0], vel: [0, 0], yaw: 0 };   // idx - 2 wraps to 18, 19
    followPath(P, wrap, 5);
    expect(wrap.idx).toBe(19);
    // heads back to the mean of points 2 and 3 (25, 0)
    expect(wrap.pos[0]).toBeCloseTo(185);
  });

  it('keeps idx when no point is within 500 and stays put at the target', () => {
    const car = { idx: 5, pos: [5000, 0, 5000], vel: [0, 0], yaw: 1 };
    followPath(P, car, 5);
    expect(car.idx).toBe(5);
    const at = { idx: 0, pos: [3, 0, 3], vel: [0, 0], yaw: 1 };   // every point at the car: nowhere to go
    followPath(Array.from({ length: 10 }, () => [3, 3]), at, 5);
    expect(at.vel).toEqual([0, 0]);
    expect(at.yaw).toBe(1);
  });
});

describe('Train', () => {
  let track;
  beforeAll(async () => { track = await makeTrack('kalimari'); });

  it('a missing file builds nothing and update is a no-op', async () => {
    const t = new Train(new THREE.Scene(), track, { dir: 'no-such-course' });
    t.update(1, []);
    t.setScreens(2);
    await t.ready;
    expect(t.data).toBeUndefined();
  });

  it('builds two trains, four crossings, and places the cars on the path', async () => {
    const t = new Train(new THREE.Scene(), track, def('kalimari'));
    await t.ready;
    expect(t.trains).toHaveLength(2);
    expect(t.crossings).toHaveLength(4);
    const tr = t.trains[0];
    expect(tr.numCars).toBe(6);
    expect([tr.engine, tr.tender, ...tr.cars].every(c => c.active && c.group.visible)).toBe(true);
    expect(tr.engine.wheels).toHaveLength(8);
    expect(tr.tender.wheels).toHaveLength(4);
    expect(tr.cars[0].wheels).toHaveLength(8);
    // engine 4 + tender 3 + 5 cars x 4 = 27 points past 160 (one step on)
    expect(Math.abs(tr.engine.idx - (160 + 27))).toBeLessThanOrEqual(1);
    expect(t.trains[1].engine.idx).toBeGreaterThan(t.path.length / 2);
    expect(tr.engine.pos[1]).toBe(t.y);
    expect(tr.engine.group.position.x).toBeCloseTo(tr.engine.pos[0] * 0.1);
    // crossings idle: the inactive model shows
    expect(t.crossings.every(c => c.states[0].visible && !c.states[1].visible && !c.states[2].visible)).toBe(true);
  });

  it('screen counts pick the active cars', async () => {
    const t = new Train(new THREE.Scene(), track, def('kalimari'));
    await t.ready;
    t.setScreens(2);
    let tr = t.trains[0];
    expect(tr.numCars).toBe(2);
    expect(tr.tender.active).toBe(true);
    expect(tr.cars.map(c => c.active)).toEqual([false, false, false, false, true]);
    const gp = new Train(new THREE.Scene(), track, def('kalimari'), { gp: true });
    await gp.ready;
    gp.setScreens(2);
    tr = gp.trains[0];
    expect(tr.numCars).toBe(0);
    expect(tr.tender.active).toBe(false);
    expect(tr.engine.active).toBe(true);
    t.setScreens(3);
    expect(t.trains[0].numCars).toBe(0);
    expect(t.trains[0].cars.some(c => c.group.visible)).toBe(false);
  });

  it('drives along the path, spinning the wheels, and is mirrored in x', async () => {
    const t = new Train(new THREE.Scene(), track, def('kalimari'), { mirror: true });
    await t.ready;
    const e = t.trains[0].engine, start = [...e.pos];
    for (let i = 0; i < 120; i++) t.update(TICK, []);
    // 60 frames x 5 units
    expect(Math.hypot(e.pos[0] - start[0], e.pos[2] - start[2])).toBeGreaterThan(200);
    expect(e.wheelRot).toBe((-120 * Math.trunc(9 * 65536 / 360)) & 0xFFFF);
    expect(t.trains[0].tender.wheelRot).toBe((-120 * Math.trunc(7 * 65536 / 360)) & 0xFFFF);
    expect(e.group.scale.x).toBeCloseTo(-0.1);
    expect(e.group.rotation.y).toBeCloseTo(e.yaw);
    expect(t.crossings[0].group.rotation.y).toBeCloseTo(-t.data.crossings[0].rotY * Math.PI / 180);
  });

  it('rings the crossings while a locomotive is near and switches the lights', async () => {
    const audio = fakeAudio();
    const t = new Train(new THREE.Scene(), track, def('kalimari'), { audio });
    await t.ready;
    vi.spyOn(Math, 'random').mockReturnValue(0.5);   // no whistle
    const L = t.path.length, e = t.trains[0].engine;
    // put locomotive 0 just before crossing 0's trigger zone
    e.idx = Math.ceil((0.42299348 - 0.1) * L) + 1;
    e.pos = [t.path[e.idx][0], t.y, t.path[e.idx][1]];
    const c0 = t.crossings.find(c => c.id === 0);
    const cam = camAt(c0.pos[0] + 100, 20, c0.pos[2], c0.pos[0], 0, c0.pos[2]);
    t.update(TICK, [cam]);
    expect(t.triggered[0]).toBe(true);
    expect(c0.timer).toBe(1);
    expect(audio.playSound).toHaveBeenCalledWith(1, 0x16, expect.any(Number), expect.any(Number));
    expect(c0.states[1].visible).toBe(true);
    for (let i = 0; i < 25; i++) t.update(TICK, [cam]);
    expect(c0.states[2].visible).toBe(true);   // timer past 20: left light
    for (let i = 0; i < 20; i++) t.update(TICK, [cam]);
    expect(c0.timer).toBeLessThan(20);           // wrapped after 40
  });

  it('bell at points 190 / 320 and a whistle one frame in 100', async () => {
    const audio = fakeAudio();
    const t = new Train(new THREE.Scene(), track, def('kalimari'), { audio });
    await t.ready;
    const e = t.trains[0].engine;
    vi.spyOn(Math, 'random').mockReturnValue(0.5);
    // drive until point 0xBE
    let rang = false;
    for (let i = 0; i < 400 && !rang; i++) {
      t.update(TICK, [camAt(e.pos[0] + 50, 20, e.pos[2], e.pos[0], 0, e.pos[2])]);
      rang = audio.playSound.mock.calls.some(c => c[1] === 0x0E);
    }
    expect(rang).toBe(true);
    Math.random.mockReturnValue(0);
    audio.playSound.mockClear();
    t.update(TICK * 2, [camAt(e.pos[0] + 50, 20, e.pos[2], e.pos[0], 0, e.pos[2])]);   // one tick moves the trains
    expect(audio.playSound).toHaveBeenCalledWith(1, 0x0D, expect.any(Number), expect.any(Number));
  });

  it('knocks a kart touching a car into the air, but not a star / boo kart', async () => {
    const items = { hit: vi.fn() };
    const t = new Train(new THREE.Scene(), track, def('kalimari'), { items });
    await t.ready;
    const e = t.trains[0].engine;
    const kart = makeKart(track);
    kart.world.set(e.pos[0] * 0.1, (e.pos[1] + 5) * 0.1, e.pos[2] * 0.1);
    const far = makeKart(track);
    far.world.set((e.pos[0] + 500) * 0.1, e.pos[1] * 0.1, e.pos[2] * 0.1);
    t.update(0, [], [kart, far, null]);
    expect(items.hit).toHaveBeenCalledTimes(1);
    expect(items.hit).toHaveBeenCalledWith(kart, 'star');
    items.hit.mockClear();
    kart.star = 100;
    t.update(0, [], [kart]);
    kart.star = 0; kart.boo = 10;
    t.update(0, [], [kart]);
    expect(items.hit).not.toHaveBeenCalled();
    // Bowser's bigger box still hits from just outside the default radius
    kart.boo = 0;
    kart.mesh.userData.character = 'bowser';
    kart.world.set(e.pos[0] * 0.1, (e.pos[1] + 5) * 0.1, e.pos[2] * 0.1);
    t.update(0, [], [kart]);
    expect(items.hit).toHaveBeenCalledTimes(1);
  });
});
