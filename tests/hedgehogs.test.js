import { describe, it, expect, vi, beforeAll } from 'vitest';
import * as THREE from 'three';
import { Hedgehogs } from '../src/hedgehogs.js';
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

describe('Hedgehogs', () => {
  let track;
  beforeAll(async () => { track = await makeTrack('yoshi'); });

  it('a missing file builds nothing and update is a no-op', async () => {
    const h = new Hedgehogs(new THREE.Scene(), track, { dir: 'no-such-course' });
    h.update(1, []);
    h.reset();
    await h.ready;
    expect(h.list).toHaveLength(0);
  });

  it('puts the fifteen hedgehogs 6 above their spawns', async () => {
    const h = new Hedgehogs(new THREE.Scene(), track, def('yoshi'));
    await h.ready;
    expect(h.list).toHaveLength(15);
    const [x, y, z, , px, pz, speed] = h.data.spawns[0];
    expect(h.list[0]).toMatchObject({ origin: [x, 0, z], patrol: [px, pz], speed, state: 1, pos: [x, y + 6, z] });
    expect(h.geometries).toHaveLength(2);
  });

  it('waddles, walks to its patrol point, waits, walks back and starts over', async () => {
    const h = new Hedgehogs(new THREE.Scene(), track, def('yoshi'));
    await h.ready;
    const o = h.list[0];
    const quads = new Set(), aes = [];
    let atPatrol = null;
    for (let i = 0; i < 800; i++) {
      h.update(FRAME, []);
      quads.add(o.quad);
      if (aes[aes.length - 1] !== o.ae) aes.push(o.ae);
      if (o.ae === 2 && !atPatrol) atPatrol = [...o.pos];
    }
    expect(quads).toEqual(new Set([0, 1]));
    expect(o.mesh.geometry).toBe(h.geometries[o.quad]);
    expect(aes.slice(0, 5)).toEqual([1, 2, 3, 4, 1]);
    expect(Math.hypot(atPatrol[0] - o.patrol[0], atPatrol[2] - o.patrol[1])).toBeLessThan(1);
  });

  it('render flags: drawn within 1000 lifts it onto the ground, then the update clears them', async () => {
    const h = new Hedgehogs(new THREE.Scene(), track, def('yoshi'));
    await h.ready;
    const o = h.list[0];
    h.update(FRAME, []);
    const [x, , z] = o.pos;
    const cam = camAt(x + 100, o.pos[1] + 30, z, x, o.pos[1], z);
    o.mesh.onBeforeRender(null, null, cam);
    expect(o.rendered && o.drawn && o.near).toBe(true);
    expect(scale(o.mesh.matrixWorld)).toBeGreaterThan(0);
    h.update(FRAME, []);
    const g = track.groundBelow(o.pos[0] * 0.1, o.pos[2] * 0.1, 3);
    expect(g).toBeTruthy();
    expect(o.surface).toBeCloseTo(g.y / 0.1, 2);
    expect(o.pos[1]).toBeCloseTo(o.surface + 6, 4);
    expect(o.drawn || o.near || o.rendered).toBe(false);
    // 600-1000 away: drawn flag but not near; the quad itself is skipped past 580
    const mid = camAt(o.pos[0] + 700, o.pos[1] + 30, o.pos[2], o.pos[0], o.pos[1], o.pos[2]);
    o.mesh.onBeforeRender(null, null, mid);
    expect(o.drawn).toBe(true); expect(o.near).toBe(false);
    expect(scale(o.mesh.matrixWorld)).toBe(0);
    // beyond 1000 or looking away: nothing
    o.drawn = false; o.rendered = false;
    o.mesh.onBeforeRender(null, null, camAt(o.pos[0] + 1500, 0, o.pos[2], o.pos[0], 0, o.pos[2]));
    expect(o.drawn).toBe(false);
    o.mesh.onBeforeRender(null, null, camAt(o.pos[0] + 50, 0, o.pos[2], o.pos[0] + 500, 0, o.pos[2]));
    expect(o.drawn).toBe(false);
  });

  it('state 1 is never drawn; mirrored quads are flipped', async () => {
    const h = new Hedgehogs(new THREE.Scene(), track, def('yoshi'), { mirror: true });
    await h.ready;
    const o = h.list[0], [x, y, z] = o.pos;
    o.mesh.onBeforeRender(null, null, camAt(x + 100, y, z, x, y, z));
    expect(scale(o.mesh.matrixWorld)).toBe(0);
    h.update(FRAME, []);
    o.mesh.onBeforeRender(null, null, camAt(o.pos[0] + 50, y, o.pos[2], o.pos[0], y, o.pos[2]));
    expect(o.mesh.matrixWorld.determinant()).toBeLessThan(0);
  });

  it('spins out karts that touch it, unless protected', async () => {
    const items = { hit: vi.fn() };
    const h = new Hedgehogs(new THREE.Scene(), track, def('yoshi'), { items });
    await h.ready;
    const o = h.list[0];
    const k = makeKart(track);
    k.world.set(o.pos[0] * 0.1 + 0.5, 0, o.pos[2] * 0.1);
    h.update(0, [k]);   // no frame ran: no collision check
    expect(items.hit).not.toHaveBeenCalled();
    k.world.set(o.pos[0] * 0.1, 0, o.pos[2] * 0.1);
    h._collide(o, [k, null]);
    expect(items.hit).toHaveBeenCalledWith(k);
    items.hit.mockClear();
    k.star = 5;
    h._collide(o, [k]);
    k.star = 0;
    const far = makeKart(track);
    far.world.set(o.pos[0] * 0.1 + 100, 0, o.pos[2] * 0.1);
    h._collide(o, [far]);
    expect(items.hit).not.toHaveBeenCalled();
    h._collide(o, [{ world: k.world }]);   // default box size 5.5
    expect(items.hit).toHaveBeenCalledTimes(1);
  });

  it('reset rebuilds the list', async () => {
    const h = new Hedgehogs(new THREE.Scene(), track, def('yoshi'));
    await h.ready;
    h.update(FRAME * 10, []);
    const old = h.list[0];
    h.reset();
    expect(h.list[0]).not.toBe(old);
    expect(h.group.children).toHaveLength(15);
  });
});
