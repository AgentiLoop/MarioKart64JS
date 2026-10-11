import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as THREE from 'three';
import { Exhaust } from '../src/smoke.js';

const fakeKart = (o = {}) => ({
  v: 20, throttle: 1, spin: 0, tumble: false, boost: 0, psi: 0, phi: 0,
  frame: { T: new THREE.Vector3(0, 0, -1), R: new THREE.Vector3(1, 0, 0) },
  up: new THREE.Vector3(0, 1, 0), world: new THREE.Vector3(10, 0, 5),
  mesh: { userData: { character: 'mario' } }, ...o,
});
const camera = () => { const c = new THREE.PerspectiveCamera(); c.position.set(0, 5, 30); c.lookAt(0, 0, 0); return c; };
const TICK = 1 / 30;

describe('Exhaust', () => {
  let scene, ex, cam;
  beforeEach(() => { scene = new THREE.Scene(); ex = new Exhaust(scene); cam = camera(); });
  afterEach(() => vi.restoreAllMocks());

  it('adds one 80-quad mesh with the smoke texture', () => {
    expect(scene.children).toContain(ex.mesh);
    const a = ex.mesh.geometry.attributes;
    expect(a.position.count).toBe(8 * 10 * 4);
    expect(ex.mesh.geometry.index.count).toBe(8 * 10 * 6);
    expect(ex.mesh.material.uniforms.map.value.userData.hd.rel).toBe('particles/smoke.png');
    expect(ex.mesh.material.transparent).toBe(true);
    expect(ex.mesh.frustumCulled).toBe(false);
  });

  it('accumulates dt and ticks at 30 Hz', () => {
    const k = fakeKart();
    vi.spyOn(Math, 'random').mockReturnValue(0.3);   // roll 1 of 5: spawn
    ex.update(TICK / 2, [k], cam);
    expect(k.smoke).toBeUndefined();
    ex.update(TICK / 2 + 1e-6, [k], cam);
    expect(k.smoke).toHaveLength(10);
  });

  it('slot 0 starts the chain, each next slot follows a live one', () => {
    const k = fakeKart();
    vi.spyOn(Math, 'random').mockReturnValue(0.3);
    ex.update(TICK, [k], cam);
    // slot 0 spawns (slot 9 dead); slot 1 needs slot 0's timer > 0, which is still 0
    expect(k.smoke.map(s => s.alive)).toEqual([true, false, false, false, false, false, false, false, false, false]);
    expect(k.smoke[0]).toMatchObject({ scale: 0.5, rise: 0, frame: 0, idle: false, boost: 0, alpha: 0x70 });
    ex.update(TICK, [k], cam);
    expect(k.smoke[0].timer).toBe(1);
    expect(k.smoke[1].alive).toBe(true);
    expect(k.smoke[0].scale).toBeCloseTo(0.57);
    expect(k.smoke[0].rise).toBeCloseTo(0.3);
    expect(k.smoke[0].frame).toBe(1);
  });

  it('rolls outside 1..3 never spawn', () => {
    const k = fakeKart();
    vi.spyOn(Math, 'random').mockReturnValue(0);   // roll 0
    ex.update(TICK * 3, [k], cam);
    expect(k.smoke.some(s => s.alive)).toBe(false);
    Math.random.mockReturnValue(0.9);   // roll 4
    ex.update(TICK * 3, [k], cam);
    expect(k.smoke.some(s => s.alive)).toBe(false);
  });

  it('puffs fade after 3 ticks and die after 12', () => {
    const k = fakeKart();
    const rnd = vi.spyOn(Math, 'random').mockReturnValue(0.3);
    ex.update(TICK, [k], cam);
    rnd.mockReturnValue(0);   // no more spawns
    const s = k.smoke[0];
    for (let i = 0; i < 3; i++) ex.update(TICK, [k], cam);
    expect(s.timer).toBe(3);
    expect(s.alpha).toBe(0x70 - 3);
    for (let i = 0; i < 8; i++) ex.update(TICK, [k], cam);
    expect(s.timer).toBe(11);
    expect(s.alive).toBe(true);
    ex.update(TICK, [k], cam);
    expect(s.alive).toBe(false);
    expect(s.timer).toBe(0);
  });

  it('idle puffs (no throttle) grow faster and fade slower; boost puffs are brighter and swell', () => {
    const idle = fakeKart({ throttle: 0, v: 0 }), boost = fakeKart({ boost: 1 });
    const rnd = vi.spyOn(Math, 'random').mockReturnValue(1 / 14 + 0.001);   // roll 1 of 14 / 0 of 5
    ex.update(TICK, [idle, boost], cam);
    expect(idle.smoke[0]).toMatchObject({ alive: true, idle: true });
    expect(boost.smoke[0].alive).toBe(false);   // roll 0 of 5
    rnd.mockReturnValue(0.3);
    ex.update(TICK, [boost], cam);
    expect(boost.smoke[0]).toMatchObject({ alive: true, boost: 1, alpha: 0x80 });
    rnd.mockReturnValue(0);
    for (let i = 0; i < 6; i++) ex.update(TICK, [idle, boost], cam);
    expect(idle.smoke[0].scale).toBeCloseTo(0.5 + 6 * 0.1);
    expect(idle.smoke[0].alpha).toBe(0x70 - 4 * 2);
    expect(boost.smoke[0].scale).toBeCloseTo(0.5 + 6 * 0.07 + 0.06);
    expect(boost.smoke[0].alpha).toBe(0x80 - 4 * 3);
    expect(idle.smoke[0].back).toBeCloseTo(5.5 + 6 * 0.1);
    expect(boost.smoke[0].back).toBeGreaterThan(5.5 + 6 * 0.1);
  });

  it('spinning or tumbling karts make no new smoke', () => {
    const a = fakeKart({ spin: 1 }), b = fakeKart({ tumble: true });
    vi.spyOn(Math, 'random').mockReturnValue(0.3);
    ex.update(TICK * 2, [a, b], cam);
    expect(a.smoke.some(s => s.alive)).toBe(false);
    expect(b.smoke.some(s => s.alive)).toBe(false);
  });

  it('draws live puffs as camera-facing quads behind and above the kart', () => {
    const k = fakeKart(), w = fakeKart({ mesh: { userData: { character: 'wario' } } });
    vi.spyOn(Math, 'random').mockReturnValue(0.3);
    ex.update(TICK, [k, w], cam);
    const a = ex.mesh.geometry.attributes;
    const K = 4.5 / 13.5;
    // kart 0 slot 0 -> quad 0
    const xs = [0, 1, 2, 3].map(j => a.position.array[j * 3]), ys = [0, 1, 2, 3].map(j => a.position.array[j * 3 + 1]);
    const zs = [0, 1, 2, 3].map(j => a.position.array[j * 3 + 2]);
    const h = 2 * 0.5 * K;
    expect(Math.max(...xs) - Math.min(...xs)).toBeCloseTo(2 * h);
    expect((Math.max(...ys) + Math.min(...ys)) / 2).toBeCloseTo(K * 4.5);
    expect(zs[0]).toBeCloseTo(5 + K * 5.5);   // behind = +z (kart faces -z)
    expect(a.alpha.array[0]).toBeCloseTo(0x70 / 255);
    expect([...a.prim.array.slice(0, 3)]).toEqual([0xfb / 255, 1, 0xfb / 255].map(Math.fround));
    // quad 1 (kart 0 slot 1) is dead: zeroed
    expect(a.alpha.array[4]).toBe(0);
    // kart 1 slot 0 -> quad 10, Wario sits higher
    const wy = [0, 1, 2, 3].map(j => a.position.array[(40 + j) * 3 + 1]);
    expect((Math.max(...wy) + Math.min(...wy)) / 2).toBeCloseTo(K * 5.5);
    expect(a.position.version).toBeGreaterThan(0);
  });

  it('skips karts without smoke and draws at most 8 karts', () => {
    const karts = Array.from({ length: 9 }, () => fakeKart());
    vi.spyOn(Math, 'random').mockReturnValue(0.3);
    ex.update(TICK, karts, cam);
    expect(karts[8].smoke).toBeDefined();
    const a = ex.mesh.geometry.attributes;
    const live = [...a.alpha.array].filter(x => x > 0).length / 4;
    expect(live).toBe(8);
    ex.draw([{}], cam);   // no smoke yet: nothing drawn
    expect([...a.alpha.array].every(x => x === 0)).toBe(true);
  });
});
