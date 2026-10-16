import { describe, it, expect, beforeAll, vi } from 'vitest';
import * as THREE from 'three';
import { Traffic } from '../src/traffic.js';
import { makeTrack, makeKart, def } from './helpers.js';

const TICK = 1 / 60 + 1e-9;

describe('Traffic', () => {
  let track;
  beforeAll(async () => { track = await makeTrack('toad'); });

  it('a missing file builds nothing and update is a no-op', async () => {
    const t = new Traffic(new THREE.Scene(), track, { dir: 'no-such-course' });
    t.update(1);
    t.setScreens(2);
    await t.ready;
    expect(t.vehicles).toBeUndefined();
  });

  it('refuses a path with the wrong number of points', async () => {
    const bad = { def: { native: { path: [[0, 0, 0], [10, 0, 0], [20, 0, 0]] } } };
    const t = new Traffic(new THREE.Scene(), bad, def('toad'));
    await expect(t.ready).rejects.toThrow(/expected 912/);
  });

  it('spawns 7 trucks, buses, tankers and cars on the path (time trial lanes i % 3)', async () => {
    const t = new Traffic(new THREE.Scene(), track, def('toad'), { timeTrial: true, cc: 0 });
    await t.ready;
    expect(t.vehicles).toHaveLength(28);
    const kinds = t.vehicles.map(v => v.kind);
    for (const k of ['truck', 'bus', 'tanker', 'car']) expect(kinds.filter(x => x === k)).toHaveLength(7);
    expect(t.vehicles.slice(0, 7).map(v => v.type)).toEqual([0, 1, 2, 0, 1, 2, 0]);
    // speed: type 2 gets the fast lane speed in time trials even at 50cc
    expect(t.vehicles[2].speed).toBeCloseTo(4.583333, 5);
    expect(t.vehicles[0].speed).toBeCloseTo(2.916667, 5);
    // n = 8 in time trials: bus 1 starts at point 912 / 8 + 75 = 189 (two steps on)
    expect(Math.abs(t.vehicles[8].idx - 189)).toBeLessThanOrEqual(2);
    // facing back down the road (DEGREES(180)) at spawn
    expect(t.vehicles[0].yaw).toBe(-0x8000);
    expect(t.vehicles[0].group.rotation.y).toBeCloseTo(-Math.PI);
    // cars are scaled 0.1
    expect(t.vehicles[21].group.scale.y).toBeCloseTo(0.01);
    expect(t.vehicles[0].group.scale.y).toBeCloseTo(0.1);
    expect(t.left).toHaveLength(912);
  });

  it('box trucks take textures 0, 1, 2 in turn', async () => {
    const t = new Traffic(new THREE.Scene(), track, def('toad'));
    await t.ready;
    const m = i => t.vehicles[i].group.userData.lods[0][0].geometry;
    expect(m(0)).toBe(t.meshes.truck0_0[0].geometry);
    expect(m(1)).toBe(t.meshes.truck1_0[0].geometry);
    expect(m(2)).toBe(t.meshes.truck2_0[0].geometry);
    expect(m(3)).toBe(t.meshes.truck0_0[0].geometry);
  });

  it('levels of detail follow the screen count', async () => {
    const t = new Traffic(new THREE.Scene(), track, def('toad'));
    await t.ready;
    const lods = t.vehicles[0].group.userData.lods;
    expect(lods.map(l => [l[0].userData.min, l[0].userData.max])).toEqual([[0, 160000], [160000, 640000], [640000, 9000000]]);
    t.setScreens(3);
    expect(lods.map(l => [l[0].userData.min, l[0].userData.max])).toEqual([[0, 0], [0, 160000], [160000, 9000000]]);
  });

  it('drives along the path, steering into its lane and turning at most 100 a frame', async () => {
    const t = new Traffic(new THREE.Scene(), track, def('toad'), { cc: 2 });
    await t.ready;
    const v = t.vehicles[0], start = [...v.pos], idx0 = v.idx;
    v.type = 2; v.factor = -0.6;
    t.update(TICK * 2);   // one object frame
    expect(v.factor).toBeCloseTo(-0.54, 5);
    expect(v.yaw).toBe(-0x8000 + 100);   // the heading is far: one 100 step
    for (let i = 0; i < 600; i++) t.update(TICK);
    expect(Math.hypot(v.pos[0] - start[0], v.pos[2] - start[2])).toBeGreaterThan(300);
    expect(v.factor).toBeCloseTo(v.idx < 0x28A ? 0.7 : 0.5, 5);
    expect(v.idx).not.toBe(idx0);
    expect(v.group.position.x).toBeCloseTo(v.pos[0] * 0.1);
    expect(Math.hypot(...v.vel)).toBeCloseTo(v.speed, 3);
  });

  it('headStart drives the vehicles through the console\'s intro before the countdown', async () => {
    const plain = new Traffic(new THREE.Scene(), track, def('toad'), { timeTrial: true, cc: 2 });
    const t = new Traffic(new THREE.Scene(), track, def('toad'), { timeTrial: true, cc: 2, headStart: n => (n === 1 ? 312 : 0) });
    await Promise.all([plain.ready, t.ready]);
    // 312 ticks = 156 frames of speed 3.75 along the path: truck 0 is well past the start line, where a plain
    // instance gets after the same ticks
    const v = t.vehicles[0], p = plain.vehicles[0];
    expect(p.idx).toBeLessThan(4);
    expect(t.ticks).toBe(312);
    expect(Math.hypot(v.pos[0] - p.pos[0], v.pos[2] - p.pos[2])).toBeGreaterThan(400);
    plain.update(312 / 60 + 1e-9);
    expect(v.idx).toBe(p.idx);
    expect(v.pos).toEqual(p.pos);
    expect(Math.abs(v.group.position.x - v.pos[0] * 0.1)).toBeLessThan(0.4);   // drawn between the last two frames
  });

  it('past point 0x28A the lanes move over', async () => {
    const t = new Traffic(new THREE.Scene(), track, def('toad'));
    await t.ready;
    const v = t.vehicles[0];
    v.idx = 0x300; v.pos = [...t.path[0x300]]; v.type = 0; v.factor = 0;
    t._update(v);
    expect(v.factor).toBeCloseTo(-0.06, 5);
    v.type = 2; v.factor = 0.5;
    t._update(v);
    expect(v.factor).toBe(0.5);
  });

  it('mirrored traffic is flipped, faces 0 and drives against the karts', async () => {
    const t = new Traffic(new THREE.Scene(), track, def('toad'), { mirror: true });
    await t.ready;
    const v = t.vehicles[0];
    expect(v.yaw).toBe(0);
    expect(v.group.scale.x).toBeCloseTo(-0.1);
    const idx = v.idx;
    for (let i = 0; i < 120; i++) t.update(TICK);
    const N = t.path.length;
    expect(((idx - v.idx) + N) % N).toBeGreaterThan(5);   // index runs backwards
  });

  it('a vehicle lost far from the path finds the nearest point overall and wraps at the start line', async () => {
    const t = new Traffic(new THREE.Scene(), track, def('toad'));
    await t.ready;
    const P = t.path, N = P.length;
    const v = { idx: 0, pos: [P[400][0], P[400][1] + 1, P[400][2]] };
    expect(t._nearest(v)).toBe(400);
    // adjust_path_at_start_line: point 0 with z past the start -> last point and vice versa
    const at0 = { idx: 0, pos: [P[0][0], P[0][1], P[0][2] + 0.5] };
    expect([0, N - 1]).toContain(t._nearest(at0));
    const fake = Object.create(Traffic.prototype);
    fake.path = [[0, 0, 0], [10, 0, 0], [20, 0, 0], [30, 0, 0]];
    expect(fake._nearest({ idx: 1, pos: [0, 0, 1] })).toBe(3);
    expect(fake._nearest({ idx: 1, pos: [30, 0, -1] })).toBe(0);
  });

  it('knocks a kart inside a vehicle\'s console hit box into the air (handle_vehicle_interactions)', async () => {
    const items = { hit: vi.fn() };
    const t = new Traffic(new THREE.Scene(), track, def('toad'), { items });
    await t.ready;
    t.update(TICK * 2);   // vehicles moving (a standing vehicle hits nothing)
    const kart = makeKart(track);
    // a point at `along` down the vehicle's motion and `across` to its side
    const at = (v, along, across, up = 0) => {
      const n = Math.hypot(v.vel[0], v.vel[2]), ux = v.vel[0] / n, uz = v.vel[2] / n;
      kart.world.set((v.pos[0] + ux * along + uz * across) * 0.1, (v.pos[1] + up) * 0.1, (v.pos[2] + uz * along - ux * across) * 0.1);
    };
    // is_collide_with_vehicle: a bus is 70 along x 12.5 across, a box truck / tanker 55 x 12.5, a car 11.5 x 8.5,
    // the kart's position a point (no kart radius; the drawn bus is 16 wide, the old box + 5.5 hit karts 21 off)
    const bus = t.vehicles.find(v => v.kind === 'bus'), truck = t.vehicles.find(v => v.kind === 'truck'), car = t.vehicles.find(v => v.kind === 'car');
    const cases = [[bus, 0, 12, 1], [bus, 0, 13, 0], [bus, 0, 21, 0], [bus, 69, 0, 1], [bus, -69, 0, 1], [bus, 71, 0, 0],
      [truck, 54, 12, 1], [truck, 56, 0, 0], [car, 11, 8, 1], [car, 12, 0, 0], [car, 0, 9, 0], [bus, 0, 0, 1, 19], [bus, 0, 0, 0, 21]];
    for (const [v, along, across, hits, up] of cases) {
      items.hit.mockClear();
      at(v, along, across, up);
      t._collide([kart, null]);
      expect(items.hit, `${v.kind} ${along} along, ${across} across, ${up ?? 0} up`).toHaveBeenCalledTimes(hits);
      if (hits) expect(items.hit).toHaveBeenCalledWith(kart, 'star');
    }
    // a star / boo / tumbling kart is left alone
    at(bus, 0, 0);
    for (const k of ['star', 'boo']) { items.hit.mockClear(); kart[k] = 5; t._collide([kart]); expect(items.hit).not.toHaveBeenCalled(); kart[k] = 0; }
    items.hit.mockClear(); kart.tumble = true; t._collide([kart]); expect(items.hit).not.toHaveBeenCalled(); kart.tumble = false;
    // a vehicle that is not moving hits nothing
    items.hit.mockClear(); const vel = bus.vel; bus.vel = [0, 0, 0]; t._collide([kart]); expect(items.hit).not.toHaveBeenCalled(); bus.vel = vel;
  });
});
