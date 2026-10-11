import { describe, it, expect, beforeAll } from 'vitest';
import * as THREE from 'three';

// three's FileLoader builds a Request from a relative URL, which Node's Request rejects: a plain holder lets the
// setup's file-backed fetch read it (String(req) -> its url)
beforeAll(() => {
  globalThis.Request = class { constructor(url, o) { this.url = url; Object.assign(this, o); } toString() { return this.url; } };
});

const mats = g => { const out = []; g.traverse(o => { if (o.isMesh) out.push(...[].concat(o.material)); }); return out; };

describe('buildLakitu3D', () => {
  let buildLakitu3D, g, wii, boards;
  beforeAll(async () => {
    ({ buildLakitu3D } = await import('../src/lakitu3d.js'));
    g = await buildLakitu3D();
    wii = g.children[0];
    // body + 4 boards + flag pivot
    boards = wii.children.slice(1, 5);
  });

  it('builds the referee with the boards hidden on the hook', () => {
    expect(wii.scale.x).toBeCloseTo(1.9);
    expect(wii.position.y).toBeCloseTo(-0.34 * 1.9);
    expect(wii.children).toHaveLength(6);
    for (const b of boards) { expect(b.visible).toBe(false); expect(b.position.equals(boards[0].position)).toBe(true); }
    expect(wii.children[5].visible).toBe(false);
    expect(typeof g.userData.show).toBe('function');
    const glass = mats(g).find(m => m.name === 'jugem_glass');
    expect(glass.transparent).toBe(true);
    expect(glass.depthWrite).toBe(false);
    const light = mats(g).find(m => m.name.startsWith('lightb'));
    expect(light.blending).toBe(THREE.AdditiveBlending);
    expect(mats(g).every(m => m.side === THREE.DoubleSide)).toBe(true);
  });

  it('gives each instance its own materials', async () => {
    const g2 = await buildLakitu3D();
    const a = mats(g), b = mats(g2);
    expect(a.length).toBe(b.length);
    expect(a.some(m => b.includes(m))).toBe(false);
  });

  it('countdown lights red, red, then blue', () => {
    const signal = boards[0];
    const lamp = i => signal.getObjectByName(`polygon${[3, 1, 2][i]}`).material;
    const glow = i => signal.getObjectByName(`polygon${[0, 5, 6][i]}`);
    g.userData.show('countdown', 0);
    expect(signal.visible).toBe(true);
    expect(boards.slice(1).every(b => !b.visible)).toBe(true);
    expect([0, 1, 2].map(i => glow(i).visible)).toEqual([false, false, false]);
    expect(lamp(0).color.getHex()).toBe(0x404040);
    g.userData.show('countdown', 10);
    expect([0, 1, 2].map(i => glow(i).visible)).toEqual([true, false, false]);
    expect(lamp(0).color.getHex()).toBe(0xff2a1a);
    g.userData.show('countdown', 20);
    expect([0, 1, 2].map(i => glow(i).visible)).toEqual([true, true, false]);
    g.userData.show('countdown', 25);
    expect([0, 1, 2].map(i => glow(i).visible)).toEqual([true, true, true]);
    expect(lamp(2).color.getHex()).toBe(0x2a6cff);
    expect(lamp(2).emissive.getHex()).toBe(0x2a6cff);
  });

  it('lap boards turn to the camera and the second-lap board swaps the number texture', () => {
    const lap = boards[1], numberMat = lap.getObjectByName('polygon1').material;
    g.userData.show('secondlap', 0, 1, 2);
    expect(lap.visible).toBe(true);
    expect(lap.rotation.y).toBeCloseTo(Math.PI / 2);
    const t2 = numberMat.map;
    expect(t2.image ?? t2.source).toBeTruthy();
    g.userData.show('secondlap', 15, 1, 2);
    expect(lap.rotation.y).toBeCloseTo(0);
    expect(numberMat.map).toBe(t2);   // cached
    g.userData.show('secondlap', 30, 1, 3);
    expect(lap.rotation.y).toBeCloseTo(0);
    expect(numberMat.map).not.toBe(t2);
    g.userData.show('secondlap', 5, 1, 2);
    expect(numberMat.map).toBe(t2);
    g.userData.show('finallap', 0);
    expect(boards[2].visible).toBe(true);
    expect(lap.visible).toBe(false);
    expect(boards[2].rotation.y).toBeCloseTo(Math.PI / 2);
  });

  it('reverse sign swings and the flag waves in the right hand', () => {
    g.userData.show('reverse', 0);
    expect(boards[3].visible).toBe(true);
    expect(boards[3].rotation.z).toBeCloseTo(-0.25);
    g.userData.show('reverse', 15);
    expect(boards[3].rotation.z).toBeCloseTo(0.25);
    const pivot = wii.children[5];
    g.userData.show('flag', 8);
    expect(pivot.visible).toBe(true);
    expect(boards.every(b => !b.visible)).toBe(true);
    expect(pivot.rotation.z).toBeCloseTo(0.45);
    expect(pivot.position.length()).toBeGreaterThan(0);
    g.userData.show('flag', 0);
    expect(pivot.rotation.z).toBeCloseTo(0);
  });

  it('fishing bobs him on the cloud and alpha fades the materials', () => {
    g.userData.show('fishing', 3, 0.5);
    expect(wii.position.y).toBeCloseTo(-0.34 * 1.9 + 0.09);
    const ms = mats(g).filter(m => !m.name.startsWith('lightb'));
    expect(ms.every(m => m.transparent && m.opacity === 0.5 && !m.depthWrite)).toBe(true);
    g.userData.show('fishing', 0, 1);
    expect(wii.position.y).toBeCloseTo(-0.34 * 1.9);
    const opaque = ms.filter(m => m.name !== 'jugem_glass');
    expect(opaque.every(m => !m.transparent && m.depthWrite && m.opacity === 1)).toBe(true);
    expect(ms.find(m => m.name === 'jugem_glass').transparent).toBe(true);
  });

  it('setLayer moves every object to one layer', () => {
    g.userData.setLayer(3);
    let all = true;
    g.traverse(o => { if (!o.layers.isEnabled(3) || o.layers.isEnabled(0)) all = false; });
    expect(all).toBe(true);
  });
});
