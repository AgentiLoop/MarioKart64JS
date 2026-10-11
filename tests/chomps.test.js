import { describe, it, expect, vi, beforeAll } from 'vitest';
import * as THREE from 'three';
import { Chomps } from '../src/chomps.js';
import { makeTrack, makeKart, def } from './helpers.js';

const camAt = (x, y, z, tx = 0, ty = 0, tz = 0) => {
  const c = new THREE.PerspectiveCamera(40, 1, 0.1, 100000);
  c.position.set(x * 0.1, y * 0.1, z * 0.1);
  c.lookAt(tx * 0.1, ty * 0.1, tz * 0.1);
  c.updateMatrixWorld(true);
  return c;
};
const scale = m => new THREE.Vector3().setFromMatrixScale(m).length();
const fakeAudio = () => ({ playSound: vi.fn(), stopSound: vi.fn(), starMusic: vi.fn() });
const FRAME = 2 / 60 + 1e-9;
// a camera `d` units from chomp c along +x, looking at it (or away)
const camNear = (c, d, away = false) => camAt(c.pos[0] + d, c.pos[1] + 20, c.pos[2], c.pos[0] + (away ? 2 * d + 500 : 0), c.pos[1], c.pos[2]);

describe('Chomps', () => {
  let track;
  beforeAll(async () => { track = await makeTrack('rainbow'); });

  it('a missing file builds nothing and update is a no-op', async () => {
    const c = new Chomps(new THREE.Scene(), track, { dir: 'no-such-course' });
    c.update(1, [], []);
    c.reset();
    await c.ready;
    expect(c.list).toHaveLength(0);
  });

  it('builds three chomps with track edges 50 either side of path 0', async () => {
    const c = new Chomps(new THREE.Scene(), track, def('rainbow'));
    await c.ready;
    expect(c.list).toHaveLength(3);
    expect(c.left).toHaveLength(c.path.length);
    const [x1, , z1] = c.path[0], [x2, , z2] = c.path[1];
    const d = Math.hypot(x2 - x1, z2 - z1);
    expect(c.left[0]).toEqual([Math.trunc(50 * (z2 - z1) / d + x1), Math.trunc(50 * -(x2 - x1) / d + z1)]);
    expect(c.list[0].state).toBe(1);
    expect(c.list[0].meshes.length).toBeGreaterThan(1);
  });

  it('first frame puts chomp i on path point i * 300 + 500, then it bounds along and weaves', async () => {
    const c = new Chomps(new THREE.Scene(), track, def('rainbow'));
    await c.ready;
    c.update(FRAME, [], []);
    c.list.forEach((ch, i) => {
      expect(ch.state).toBe(2);
      expect(Math.abs(ch.idx - (i * 300 + 500))).toBeLessThanOrEqual(8);
    });
    const ch = c.list[0], start = [...ch.pos], sides = new Set(), frames = new Set();
    for (let i = 0; i < 200; i++) { c.update(FRAME, [], []); sides.add(ch.side); frames.add(ch.frame); }
    expect(Math.hypot(ch.pos[0] - start[0], ch.pos[2] - start[2])).toBeGreaterThan(100);
    expect(Math.max(...sides)).toBeCloseTo(0.8, 5);
    expect(Math.min(...sides)).toBeCloseTo(-0.8, 5);
    expect(frames.size).toBe(c.data.animation.length);
    expect(ch.pos[1]).toBeCloseTo(ch.offset[1] - 15, 3);
    expect(ch.yaw).not.toBe(0);
  });

  it('rattles every 64th frame for a nearby camera', async () => {
    const audio = fakeAudio();
    const c = new Chomps(new THREE.Scene(), track, def('rainbow'), { audio });
    await c.ready;
    c.update(FRAME, [], []);
    for (let i = 0; i < 62; i++) c.update(FRAME, [], []);
    expect(audio.playSound).not.toHaveBeenCalled();
    c.update(FRAME, [camNear(c.list[0], 100)], []);
    expect(audio.playSound).toHaveBeenCalledWith(c.data.sound[0], c.data.sound[1], expect.any(Number), expect.any(Number));
  });

  it('tumbles a kart it runs into, but not a star kart or one high above', async () => {
    const items = { hit: vi.fn() };
    const c = new Chomps(new THREE.Scene(), track, def('rainbow'), { items });
    await c.ready;
    c.update(FRAME, [], []);
    const ch = c.list[0];
    const k = makeKart(track);
    k.world.set(ch.pos[0] * 0.1, ch.pos[1] * 0.1, ch.pos[2] * 0.1);
    c._collide(ch, [k, null]);
    expect(items.hit).toHaveBeenCalledWith(k, 'fake_item_box');
    items.hit.mockClear();
    k.star = 10;
    c._collide(ch, [k]);
    k.star = 0;
    k.world.y += 5;   // 50 above
    c._collide(ch, [k]);
    k.world.y -= 5; k.boo = 3;
    c._collide(ch, [k]);
    expect(items.hit).not.toHaveBeenCalled();
    const bowser = { world: new THREE.Vector3((ch.pos[0] + 15.8) * 0.1, ch.pos[1] * 0.1, ch.pos[2] * 0.1), mesh: { userData: { character: 'bowser' } } };
    c._collide(ch, [bowser]);
    expect(items.hit).toHaveBeenCalledTimes(1);
  });

  it('render hooks: the armature within 1500, the sphere picture to 2500', async () => {
    for (const mirror of [false, true]) {
      const c = new Chomps(new THREE.Scene(), track, def('rainbow'), { mirror });
      await c.ready;
      const ch = c.list[0], part = ch.meshes[0], sphere = ch.meshes[ch.meshes.length - 1];
      part.onBeforeRender(null, null, camNear(ch, 100));
      expect(scale(part.matrixWorld)).toBe(0);   // state 1: hidden
      c.update(FRAME * 2, [], []);
      expect(c._view(ch, camNear(ch, 50))).toBe(1);
      expect(c._view(ch, camNear(ch, 150))).toBe(1);
      expect(c._view(ch, camNear(ch, 1000))).toBe(1);
      expect(c._view(ch, camNear(ch, 2000))).toBe(2);
      expect(c._view(ch, camNear(ch, 3000))).toBe(0);
      expect(c._view(ch, camNear(ch, 100, true))).toBe(0);
      const near = camNear(ch, 300);
      part.onBeforeRender(null, null, near);
      expect(part.matrixWorld.equals(part.matrix)).toBe(true);
      expect(scale(part.matrixWorld)).toBeGreaterThan(0);
      sphere.onBeforeRender(null, null, near);
      expect(scale(sphere.matrixWorld)).toBe(0);
      const far = camNear(ch, 2000);
      part.onBeforeRender(null, null, far);
      expect(scale(part.matrixWorld)).toBe(0);
      sphere.onBeforeRender(null, null, far);
      expect(scale(sphere.matrixWorld)).toBeCloseTo(Math.sqrt(3) * c.data.sphere.scale * 0.1, 4);
      expect(sphere.matrixWorld.elements[13]).toBeCloseTo((ch.pos[1] + c.data.sphere.up) * 0.1, 3);
      expect(sphere.matrixWorld.determinant() < 0).toBe(mirror);
    }
  });

  it('_place sets limb matrices, reflection uvs and eye shading', async () => {
    const c = new Chomps(new THREE.Scene(), track, def('rainbow'));
    await c.ready;
    c.update(FRAME * 2, [], []);
    const ch = c.list[0];
    const all = [...ch.parts.values()].flat();
    const reflect = all.find(p => p.t.kind === 'reflect'), lit = all.find(p => p.t.kind === 'lit');
    const colour = all.find(p => p.t.kind === 'colour');
    expect(reflect && lit && colour).toBeTruthy();
    const uv = reflect.uv.array;
    expect(Math.max(...uv)).toBeLessThanOrEqual(31 / 32 + 1e-6);
    expect(Math.min(...uv)).toBeGreaterThanOrEqual(0);
    expect(Math.max(...lit.color.array)).toBeGreaterThan(0);
    expect(colour.color.array.length).toBe(colour.t.colors.length);
    const pos = new THREE.Vector3().setFromMatrixPosition(reflect.mesh.matrix);
    expect(Math.hypot(pos.x - ch.pos[0] * 0.1, pos.z - ch.pos[2] * 0.1)).toBeLessThan(5);
    const uv0 = Array.from(uv);
    for (let i = 0; i < 20; i++) c.update(FRAME, [], []);
    expect(Array.from(uv)).not.toEqual(uv0);   // it turned / animated
  });

  it('mirrored: lateral factor negated, light x flipped', async () => {
    const plain = new Chomps(new THREE.Scene(), track, def('rainbow'));
    const mir = new Chomps(new THREE.Scene(), track, def('rainbow'), { mirror: true });
    await Promise.all([plain.ready, mir.ready]);
    const [a] = plain._offset(10, 0.8), [b] = mir._offset(10, -0.8);
    expect(a).toBeCloseTo(b, 6);
    const lp = [...plain.templates.values()].flat().find(t => t.dl), lm = [...mir.templates.values()].flat().find(t => t.dl);
    expect(lm.dl.x).toBeCloseTo(-lp.dl.x);
    mir.update(FRAME * 4, [], []);
    expect(mir.list[0].state).toBe(2);
  });

  it('_nearest falls back to the closest point overall and wraps at the start line', async () => {
    const c = new Chomps(new THREE.Scene(), track, def('rainbow'));
    await c.ready;
    const P = c.path, N = P.length;
    expect(c._nearest({ idx: 0, offset: [P[700][0], P[700][1], P[700][2]] })).toBe(700);
    const fake = Object.create(Chomps.prototype);
    fake.path = [[0, 0, 0], [10, 0, 0], [20, 0, 0], [30, 0, 0]];
    expect(fake._nearest({ idx: 1, offset: [0, 0, 1] })).toBe(3);
    expect(fake._nearest({ idx: 1, offset: [30, 0, -1] })).toBe(0);
    expect(N).toBeGreaterThan(1000);
  });

  it('reset rebuilds the three chomps', async () => {
    const c = new Chomps(new THREE.Scene(), track, def('rainbow'));
    await c.ready;
    const n = c.group.children.length;
    c.update(FRAME * 10, [], []);
    c.reset();
    expect(c.group.children).toHaveLength(n);
    expect(c.list.every(ch => ch.state === 1)).toBe(true);
  });
});
