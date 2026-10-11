import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { HotAirBalloon } from '../src/balloon.js';
import { def } from './helpers.js';

const camAt = (x, y, z, tx = 0, ty = 0, tz = 0) => {
  const c = new THREE.PerspectiveCamera(40, 1, 0.1, 10000);
  c.position.set(x * 0.1, y * 0.1, z * 0.1);
  c.lookAt(tx * 0.1, ty * 0.1, tz * 0.1);
  c.updateMatrixWorld(true);
  return c;
};
const scale = m => new THREE.Vector3().setFromMatrixScale(m).length();
const FRAME = 2 / 60 + 1e-9;

describe('HotAirBalloon', () => {
  it('a missing file builds nothing and update is a no-op', async () => {
    const b = new HotAirBalloon(new THREE.Scene(), { dir: 'no-such-course' });
    b.update(1, [], true);
    await b.ready;
    expect(b.obj.state).toBe(0);
  });

  it('waits for the first lap, then sinks from 300 and bobs up and down', async () => {
    const scene = new THREE.Scene();
    const b = new HotAirBalloon(scene, def('luigi'));
    await b.ready;
    expect(b.near.children).toHaveLength(4);
    expect(b.far.children).toHaveLength(4);
    expect(b.lit).toHaveLength(8);
    b.update(1, []);   // no lap yet: nothing
    expect(b.obj.state).toBe(0);
    b.update(FRAME, [], true);
    expect(b.obj.state).toBe(2);
    expect(b.obj.offsetY).toBeCloseTo(298);   // 300 - 2
    expect(b.obj.pos).toEqual([-176, b.obj.offsetY, -2323]);
    expect(b.near.position.y).toBeCloseTo(b.obj.offsetY * 0.1, 4);
    const subs = new Set(), ys = [];
    for (let i = 0; i < 1500; i++) { b.update(FRAME, []); subs.add(b.obj.sub); ys.push(b.obj.offsetY); }
    expect([...subs].sort((x, y) => x - y)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
    const late = ys.slice(500);
    expect(Math.min(...late)).toBeLessThan(Math.max(...late) - 50);   // rises and sinks about 90 units
    expect(Math.min(...ys)).toBeLessThan(18);
    expect(b.obj.rotY).not.toBe(0);
    // trigger again does nothing while flying
    b.trigger();
    expect(b.obj.state).toBe(2);
  });

  it('never flies in time trials', async () => {
    const b = new HotAirBalloon(new THREE.Scene(), def('luigi'), { timeTrial: true });
    await b.ready;
    b.update(1, [], true);
    expect(b.obj.state).toBe(0);
  });

  it('setScreens puts it back to waiting', async () => {
    const b = new HotAirBalloon(new THREE.Scene(), def('luigi'));
    await b.ready;
    b.update(FRAME * 10, [], true);
    b.setScreens(2);
    expect(b.screens).toBe(2);
    expect(b.obj).toMatchObject({ state: 0, sub: 0, offsetY: 0, vy: 0, rotY: 0 });
  });

  it('in 1P its spin is reset while seen from the far range', async () => {
    const b = new HotAirBalloon(new THREE.Scene(), def('luigi'));
    await b.ready;
    const far = camAt(-176 + 2000, 100, -2323, -176, 100, -2323);
    for (let i = 0; i < 10; i++) b.update(FRAME, [far], true);
    expect(b.obj.rotY).toBe(0);
    const near = camAt(-176 + 500, 100, -2323, -176, 100, -2323);
    for (let i = 0; i < 10; i++) b.update(FRAME, [near]);
    expect(b.obj.rotY).toBe(10 * 256);
    // the far model's shading is turned towards screen 1's camera
    expect(b.far.rotation.y).toBeCloseTo(Math.atan2(near.position.x - b.far.position.x, near.position.z - b.far.position.z));
    // 2P: never reset
    b.setScreens(2);
    for (let i = 0; i < 10; i++) b.update(FRAME, [far], true);
    expect(b.obj.rotY).not.toBe(0);
  });

  it('render hooks: near model under 1500, far model 1500-3000 turned to the camera', async () => {
    for (const mirror of [false, true]) {
      const scene = new THREE.Scene();
      const b = new HotAirBalloon(scene, def('luigi'), { mirror });
      await b.ready;
      expect(b.near.scale.x).toBeCloseTo(mirror ? -0.1 : 0.1);
      const n = b.near.children[0], f = b.far.children[0];
      // not flying: both hidden
      scene.updateMatrixWorld(true);
      const close = camAt(-176 + 500, 100, -2323, -176, 0, -2323);
      n.onBeforeRender(null, scene, close); f.onBeforeRender(null, scene, close);
      expect(scale(n.matrixWorld)).toBe(0); expect(scale(f.matrixWorld)).toBe(0);
      b.update(FRAME, [close], true);
      const y = b.obj.pos[1];
      const at = d => camAt(-176 + d, y, -2323, -176, y, -2323);
      scene.updateMatrixWorld(true);
      n.onBeforeRender(null, scene, at(500)); f.onBeforeRender(null, scene, at(500));
      expect(scale(n.matrixWorld)).toBeGreaterThan(0); expect(scale(f.matrixWorld)).toBe(0);
      scene.updateMatrixWorld(true);
      n.onBeforeRender(null, scene, at(2000)); f.onBeforeRender(null, scene, at(2000));
      expect(scale(n.matrixWorld)).toBe(0);
      expect(scale(f.matrixWorld)).toBeGreaterThan(0);
      // its front (+z) points at the camera
      const z = new THREE.Vector3(0, 0, 1).transformDirection(f.matrixWorld);
      expect(z.x).toBeCloseTo(1, 3);
      expect(f.matrixWorld.determinant() < 0).toBe(mirror);
      scene.updateMatrixWorld(true);
      f.onBeforeRender(null, scene, at(4000));
      expect(scale(f.matrixWorld)).toBe(0);
    }
  });
});
