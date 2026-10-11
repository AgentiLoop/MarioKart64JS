import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { PiranhaPlants } from '../src/piranha.js';
import { def } from './helpers.js';

const camAt = (x, y, z, tx = 0, ty = 0, tz = 0) => {
  const c = new THREE.PerspectiveCamera(40, 1, 0.1, 10000);
  c.position.set(x * 0.1, y * 0.1, z * 0.1);
  c.lookAt(tx * 0.1, ty * 0.1, tz * 0.1);
  c.updateMatrixWorld(true);
  return c;
};
const ticks = (p, n, cams) => { for (let i = 0; i < n; i++) p.update(1 / 60 + 1e-9, cams); };

describe('PiranhaPlants', () => {
  it('ignores updates until loaded, and a missing file builds nothing', async () => {
    const p = new PiranhaPlants(new THREE.Scene(), { dir: 'no-such-course' });
    p.update(1, [camAt(0, 0, 0)]);
    await p.ready;
    expect(p.data).toBeUndefined();
    expect(p.plants).toHaveLength(0);
  });

  it('builds one quad per Mario Raceway plant with nine frames', async () => {
    const scene = new THREE.Scene();
    const p = new PiranhaPlants(scene, def('mario'));
    await p.ready;
    expect(p.plants).toHaveLength(p.data.actors.length);
    expect(p.frames).toHaveLength(9);
    expect(p.frames[0].wrapS).toBe(THREE.MirroredRepeatWrapping);
    const [x, y, z] = p.data.actors[0];
    expect(p.plants[0].position.toArray().map(v => +v.toFixed(4))).toEqual([x * 0.1, y * 0.1, z * 0.1].map(v => +v.toFixed(4)));
    expect(p.plants[0].geometry).toBe(p.plants[1].geometry);
  });

  it('animates a plant while the camera looks at it from within 300', async () => {
    const scene = new THREE.Scene();
    const p = new PiranhaPlants(scene, def('mario'));
    await p.ready;
    const [x, y, z] = p.data.actors[0];
    const cam = camAt(x + 100, y + 20, z, x, y, z);
    expect(p._state(cam, p.plants[0])).toBe(1);
    ticks(p, 30, [cam]);
    const t = p.timers.get(cam);
    expect(t[0]).toBe(30);
    // render hook picks frame floor(30 / 6) = 5 and billboards the quad
    const mesh = p.plants[0];
    mesh.updateMatrixWorld(true);
    mesh.onBeforeRender(null, scene, cam);
    expect(mesh.material.map).toBe(p.frames[5]);
    // the timer wraps past 60 back to 6
    ticks(p, 31, [cam]);
    expect(t[0]).toBe(6);
    // an unknown camera shows frame 0
    mesh.onBeforeRender(null, scene, camAt(x + 50, y, z, x, y, z));
    expect(mesh.material.map).toBe(p.frames[0]);
  });

  it('resets the timer when seen from past 300, behind the camera or beyond 1000', async () => {
    const p = new PiranhaPlants(new THREE.Scene(), def('mario'));
    await p.ready;
    const mesh = p.plants[0], [x, y, z] = p.data.actors[0];
    expect(p._state(camAt(x + 500, y, z, x, y, z), mesh)).toBe(0);
    expect(p._state(camAt(x + 100, y, z, x + 300, y, z), mesh)).toBe(-1);   // looking away
    expect(p._state(camAt(x + 2000, y, z, x, y, z), mesh)).toBe(-1);
    expect(p._state(camAt(x + 800, y, z + 800, x, y, z), mesh)).toBe(-1);   // radius
    // a camera straight above (no ground direction) is never outside the wedge
    const top = new THREE.PerspectiveCamera();
    top.position.set(x * 0.1, y * 0.1 + 5, z * 0.1); top.lookAt(x * 0.1, y * 0.1, z * 0.1); top.updateMatrixWorld(true);
    expect(p._state(top, mesh)).toBe(1);
    const near = camAt(x + 100, y, z, x, y, z), far = camAt(x + 500, y, z, x, y, z);
    ticks(p, 10, [near]);
    expect(p.timers.get(near)[0]).toBe(10);
    ticks(p, 2, [far]);
    expect(p.timers.has(near)).toBe(false);   // a camera that went away drops its timers
    expect(p.timers.get(far)[0]).toBe(0);
  });
});
