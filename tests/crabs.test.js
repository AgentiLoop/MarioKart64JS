import { describe, it, expect, vi, beforeAll } from 'vitest';
import * as THREE from 'three';
import { Crabs } from '../src/crabs.js';
import { makeTrack, makeKart, def } from './helpers.js';

const camAt = (x, y, z, tx = 0, ty = 0, tz = 0) => {
  const c = new THREE.PerspectiveCamera(40, 1, 0.1, 10000);
  c.position.set(x * 0.1, y * 0.1, z * 0.1);
  c.lookAt(tx * 0.1, ty * 0.1, tz * 0.1);
  c.updateMatrixWorld(true);
  return c;
};
const scale = m => new THREE.Vector3().setFromMatrixScale(m).length();
const FRAME = 2 / 60 + 1e-9;

describe('Crabs', () => {
  let track;
  beforeAll(async () => { track = await makeTrack('koopa'); });

  it('a missing file builds nothing and update is a no-op', async () => {
    const c = new Crabs(new THREE.Scene(), track, { dir: 'no-such-course' });
    c.update(1, [], []);
    c.reset();
    await c.ready;
    expect(c.list).toHaveLength(0);
  });

  it('puts the ten crabs on their spawns, starting in state 1', async () => {
    const c = new Crabs(new THREE.Scene(), track, def('koopa'));
    await c.ready;
    expect(c.list).toHaveLength(10);
    expect(c.materials).toHaveLength(7);
    const [x, px, z, pz] = c.data.spawns[0];
    expect(c.list[0]).toMatchObject({ origin: [x, 0, z], patrol: [px, pz], state: 1, ae: 1 });
    c.update(FRAME, [], []);
    expect(c.list.every(o => o.state === 2)).toBe(true);
  });

  it('walks to its patrol point, then waits, backs off and walks forward, animating', async () => {
    const c = new Crabs(new THREE.Scene(), track, def('koopa'));
    await c.ready;
    const o = c.list[0];
    const frames = new Set(), aes = new Set();
    const dx = o.patrol[0] - o.origin[0], dz = o.patrol[1] - o.origin[2];
    let reached = false;
    for (let i = 0; i < 1500; i++) {
      c.update(FRAME, [], []);
      frames.add(o.frame); aes.add(o.ae);
      if (o.ae === 2 && !reached) {
        reached = true;
        // walked from the spawn to (patrolX, patrolZ), within one 1.5 step
        expect(Math.hypot(o.pos[0] - o.patrol[0], o.pos[2] - o.patrol[1])).toBeLessThan(2);
        expect(o.mesh.material).toBe(c.materials[o.frame]);
      }
    }
    expect(reached).toBe(true);
    expect(Math.hypot(dx, dz)).toBeGreaterThan(0);
    expect([...aes].sort()).toEqual([1, 2, 3, 4, 5]);
    expect([...frames].sort()).toEqual([0, 1, 2, 3, 4, 5, 6]);
    expect(o.speed).toBe(0.8);
    expect(o.pos[1]).toBe(0);   // never seen: stays at y 0
  });

  it('stands on the ground while a camera sees it within 500', async () => {
    const c = new Crabs(new THREE.Scene(), track, def('koopa'));
    await c.ready;
    const o = c.list[0], [x, , z] = o.origin;
    const cam = camAt(x + 200, 50, z, x, 0, z);
    c.update(FRAME, [cam], []);
    c.update(FRAME, [cam], []);
    expect(o.visible).toBe(true);
    const g = track.groundBelow(o.pos[0] * 0.1, o.pos[2] * 0.1, 3);
    if (g) expect(o.pos[1]).toBeCloseTo(g.y / 0.1 + 2.5, 3);
    const away = camAt(x + 200, 50, z, x + 1000, 0, z);
    c.update(FRAME, [away], []);
    expect(o.visible).toBe(false);
  });

  it('spins out karts that touch it, unless under a boo / star / spin', async () => {
    const items = { hit: vi.fn() };
    const c = new Crabs(new THREE.Scene(), track, def('koopa'), { items });
    await c.ready;
    c.update(FRAME, [], []);
    const o = c.list[0];
    const k = makeKart(track);
    k.world.set(o.pos[0] * 0.1 + 0.3, 0, o.pos[2] * 0.1);
    const away = makeKart(track);
    away.world.set(o.pos[0] * 0.1 + 50, 0, o.pos[2] * 0.1);
    c._collide(o, [k, away, null]);
    expect(items.hit).toHaveBeenCalledTimes(1);
    expect(items.hit).toHaveBeenCalledWith(k);
    items.hit.mockClear();
    for (const [key, val] of [['boo', 1], ['star', 1], ['spin', 1], ['remote', true], ['out', true]]) {
      const kk = makeKart(track);
      kk.world.copy(k.world);
      kk[key] = val;
      c._collide(o, [kk]);
    }
    expect(items.hit).not.toHaveBeenCalled();
    // boxSize missing: 5.5 default
    c._collide(o, [{ world: k.world }]);
    expect(items.hit).toHaveBeenCalledTimes(1);
  });

  it('is drawn turned to the camera within 800 and its view wedge', async () => {
    for (const mirror of [false, true]) {
      const c = new Crabs(new THREE.Scene(), track, def('koopa'), { mirror });
      await c.ready;
      const o = c.list[0];
      o.mesh.onBeforeRender(null, null, camAt(o.pos[0] + 100, 20, o.pos[2], o.pos[0], 0, o.pos[2]));
      expect(scale(o.mesh.matrixWorld)).toBe(0);   // state 1: hidden
      c.update(FRAME, [], []);
      const [x, , z] = o.pos;
      for (const d of [50, 150, 300]) {
        o.mesh.onBeforeRender(null, null, camAt(x + d, 20, z, x, 0, z));
        expect(scale(o.mesh.matrixWorld)).toBeGreaterThan(0);
        expect(o.mesh.matrixWorld.elements[12]).toBeCloseTo(x * 0.1, 3);
        expect(o.mesh.matrixWorld.determinant() < 0).toBe(mirror);   // flipped back in x when mirrored
      }
      o.mesh.onBeforeRender(null, null, camAt(x + 900, 20, z, x, 0, z));
      expect(scale(o.mesh.matrixWorld)).toBe(0);
      o.mesh.onBeforeRender(null, null, camAt(x + 100, 20, z, x + 500, 0, z));
      expect(scale(o.mesh.matrixWorld)).toBe(0);
    }
  });

  it('reset puts the crabs back on their spawns', async () => {
    const c = new Crabs(new THREE.Scene(), track, def('koopa'));
    await c.ready;
    for (let i = 0; i < 50; i++) c.update(FRAME, [], []);
    const old = c.list[0];
    c.reset();
    expect(c.list[0]).not.toBe(old);
    expect(c.group.children).toHaveLength(10);
    expect(c.list[0].state).toBe(1);
  });
});
