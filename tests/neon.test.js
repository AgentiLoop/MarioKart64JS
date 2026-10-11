import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { NeonSigns } from '../src/neon.js';
import { def } from './helpers.js';

const camAt = (x, y, z, tx = 0, ty = 0, tz = 0) => {
  const c = new THREE.PerspectiveCamera(40, 1, 0.1, 100000);
  c.position.set(x * 0.1, y * 0.1, z * 0.1);
  c.lookAt(tx * 0.1, ty * 0.1, tz * 0.1);
  c.updateMatrixWorld(true);
  return c;
};
const FRAME = 2 / 60 + 1e-9;   // one object frame = two 60 Hz ticks

// run `frames` object frames, recording each sign's (state, tex, hidden) history
function record(n, frames) {
  const hist = n.list.map(() => ({ states: new Set(), tex: new Set(), hidden: 0, visible: 0 }));
  for (let f = 0; f < frames; f++) {
    n.update(FRAME);
    n.list.forEach((o, i) => {
      const h = hist[i];
      h.states.add(o.state); h.tex.add(o.tex);
      if (o.hidden) h.hidden++;
      if (o.mesh.visible) h.visible++;
    });
  }
  return hist;
}

describe('NeonSigns', () => {
  it('a missing file builds nothing and update is a no-op', async () => {
    const n = new NeonSigns(new THREE.Scene(), { dir: 'no-such-course' });
    n.update(1);
    await n.ready;
    expect(n.list).toHaveLength(0);
  });

  it('builds the ten Rainbow Road signs hidden until their first frame', async () => {
    const scene = new THREE.Scene();
    const n = new NeonSigns(scene, def('rainbow'));
    await n.ready;
    expect(n.list).toHaveLength(10);
    expect(n.list[0].mesh.name).toBe('neon-mushroom');
    expect(n.list.every(o => o.state === 1 && !o.mesh.visible)).toBe(true);
    n.update(1 / 60 + 1e-9);   // even tick: nothing yet
    n.update(1 / 60 + 1e-9);
    expect(n.list.every(o => o.state === 2 && o.mesh.visible)).toBe(true);
  });

  it('runs the mushroom, Mario and Boo animations through all their states', async () => {
    const n = new NeonSigns(new THREE.Scene(), def('rainbow'));
    await n.ready;
    const [mush, mario, boo, peach] = record(n, 1500);
    expect([...mush.states].sort((a, b) => a - b)).toEqual([2, 3, 4, 5, 6, 7, 8]);   // 8 loops back to 2
    expect([...mush.tex].sort()).toEqual([0, 1, 2, 3, 4]);
    expect([...mario.states].sort((a, b) => a - b)).toEqual([2, 3, 4, 5]);
    expect(mario.hidden).toBeGreaterThan(0);          // dark 12 frames each loop
    expect(mario.visible).toBeGreaterThan(mario.hidden);
    expect([...boo.states].sort((a, b) => a - b)).toEqual([2, 3, 4, 5, 6, 7, 8]);
    expect(boo.hidden).toBeGreaterThan(0);            // flashing and dark
    expect(boo.tex.has(4)).toBe(true);
    // the static signs never change
    expect([...peach.states]).toEqual([2]);
    expect(peach.hidden).toBe(0);
    expect(n.list[3].mesh.material).toBe(n.list[3].materials[0]);
  });

  it('mesh material follows the texture index', async () => {
    const n = new NeonSigns(new THREE.Scene(), def('rainbow'));
    await n.ready;
    const o = n.list[0];
    for (let i = 0; i < 200 && o.tex === 0; i++) n.update(FRAME);
    expect(o.tex).toBeGreaterThan(0);
    expect(o.mesh.material).toBe(o.materials[o.tex]);
  });

  it('reset puts every sign back to state 1', async () => {
    const n = new NeonSigns(new THREE.Scene(), def('rainbow'));
    await n.ready;
    record(n, 50);
    n.reset();
    expect(n.list.every(o => o.state === 1 && o.tex === 0 && !o.hidden && !o.mesh.visible)).toBe(true);
    expect(n.ticks).toBe(0);
  });

  it('is drawn turned to the camera only inside its view wedge, flipped when mirrored', async () => {
    for (const mirror of [false, true]) {
      const n = new NeonSigns(new THREE.Scene(), def('rainbow'), { mirror });
      await n.ready;
      const o = n.list[0], [x, y, z] = o.sign.pos;
      const cam = camAt(x + 1000, y, z, x, y, z);
      o.mesh.onBeforeRender(null, null, cam);
      const s = new THREE.Vector3(), q = new THREE.Quaternion(), p = new THREE.Vector3();
      o.mesh.matrixWorld.decompose(p, q, s);
      expect(p.x).toBeCloseTo(x * 0.1, 3);
      expect(Math.abs(s.y)).toBeCloseTo(0.8);
      expect(o.mesh.matrixWorld.determinant() < 0).toBe(mirror);
      o.mesh.onBeforeRender(null, null, camAt(x + 1000, y, z, x + 3000, y, z));   // facing away
      expect(new THREE.Vector3().setFromMatrixScale(o.mesh.matrixWorld).length()).toBe(0);
    }
  });
});
