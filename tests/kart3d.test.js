import { describe, it, expect, beforeAll, vi } from 'vitest';
import * as THREE from 'three';

// three's FileLoader builds a Request from a relative URL, which Node's Request rejects: a plain holder lets the
// setup's file-backed fetch read it (String(req) -> its url)
beforeAll(() => {
  globalThis.Request = class { constructor(url, o) { this.url = url; Object.assign(this, o); } toString() { return this.url; } };
});

const meshes = g => { const out = []; g.traverse(o => { if (o.isMesh) out.push(o); }); return out; };
const mats = g => meshes(g).flatMap(m => [].concat(m.material));

describe('buildWiiKart', () => {
  let buildWiiKart;
  beforeAll(async () => { ({ buildWiiKart } = await import('../src/kart3d.js')); });

  it('assembles body, four tires and the driver for Mario', async () => {
    const g = await buildWiiKart('mario');
    expect(g).toBeInstanceOf(THREE.Group);
    const wii = g.children[0];
    expect(wii.rotation.y).toBeCloseTo(Math.PI);
    expect(wii.scale.x).toBeCloseTo(1.9);
    // body + 4 steer groups + driver
    expect(wii.children).toHaveLength(6);
    const ms = meshes(g);
    expect(ms.length).toBeGreaterThan(4);
    expect(ms.every(m => m.castShadow)).toBe(true);
    expect(ms.some(m => m.isSkinnedMesh)).toBe(false);   // skins dropped
    expect(mats(g).every(m => m.side === THREE.DoubleSide)).toBe(true);
    expect(g.userData.capsule.front).toBeCloseTo(0.55 * 1.9 * 0.7);
    expect(g.userData.capsule.rear).toBeCloseTo(-0.43 * 1.9 * 0.7);
    expect(g.userData.capsule.r).toBeCloseTo(0.58 * 1.9 + 0.15);
  });

  it('update() spins the tires and steers only the front ones', async () => {
    const g = await buildWiiKart('mario');
    const wii = g.children[0];
    const steers = wii.children.slice(1, 5);
    g.userData.update(1, 10, 0.1);
    expect(steers[0].rotation.y).toBeCloseTo(-0.45);
    expect(steers[1].rotation.y).toBeCloseTo(-0.45);
    expect(steers[2].rotation.y).toBe(0);
    expect(steers[3].rotation.y).toBe(0);
    const spinFront = steers[0].children[0].rotation.x, spinRear = steers[2].children[0].rotation.x;
    expect(spinFront).toBeCloseTo(10 * 0.1 / (0.21 * 1.9));
    expect(spinRear).toBeCloseTo(10 * 0.1 / (0.27 * 1.9));
    expect(spinFront).toBeGreaterThan(spinRear);   // smaller tire turns faster
    g.userData.update(-1, 0, 0.1);
    expect(steers[0].rotation.y).toBeCloseTo(0.45);
  });

  it('scales the rear tires up from the front tire mesh', async () => {
    const g = await buildWiiKart('wario');
    const steers = g.children[0].children.slice(1, 5);
    expect(steers[0].children[0].scale.x).toBeCloseTo(0.21 / 0.21);
    expect(steers[2].children[0].scale.x).toBeCloseTo(0.317 / 0.21);
    expect(steers[2].position.x).toBeCloseTo(0.708);
    expect(steers[3].position.x).toBeCloseTo(-0.708);
  });

  it('builds every character, with class-specific capsules', async () => {
    const caps = {};
    for (const ch of ['luigi', 'peach', 'toad', 'yoshi', 'donkeykong', 'bowser']) {
      const g = await buildWiiKart(ch);
      expect(meshes(g).length).toBeGreaterThan(0);
      caps[ch] = g.userData.capsule;
    }
    expect(caps.toad.front).toBeCloseTo(0.25 * 1.9 * 0.7);
    expect(caps.bowser.r).toBeCloseTo(0.708 * 1.9 + 0.15);
    expect(caps.luigi).toEqual(caps.yoshi);
  });

  it('sets eye texture repeat / mirrored wrap and the body texture wrap', async () => {
    const g = await buildWiiKart('mario');
    const eye = mats(g).find(m => m.map && m.name.endsWith('_eye_tx'));
    expect(eye).toBeTruthy();
    expect(eye.map.wrapS).toBe(THREE.MirroredRepeatWrapping);
    expect(eye.map.repeat.x).toBe(2);
    const body = mats(g).find(m => m.name === 'mat_body');
    expect(body.map.wrapT).toBe(THREE.MirroredRepeatWrapping);
    expect(body.map.colorSpace).toBe(THREE.SRGBColorSpace);
    const peach = await buildWiiKart('peach');
    expect(mats(peach).find(m => m.map && m.name.endsWith('_eye_tx')).map.repeat.x).toBe(1);
  });

  it('falls back to Mario\'s class for an unknown character (and fails to find its driver)', async () => {
    await expect(buildWiiKart('nobody')).rejects.toBeTruthy();
  });

  it('caches loads: a second build clones the same parsed scenes', async () => {
    const spy = vi.spyOn(globalThis, 'fetch');
    spy.mockClear();
    await buildWiiKart('mario');
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore?.();
  });

  it('defaults to Mario', async () => {
    const g = await buildWiiKart();
    expect(g.userData.capsule.front).toBeCloseTo(0.55 * 1.9 * 0.7);
  });
});
