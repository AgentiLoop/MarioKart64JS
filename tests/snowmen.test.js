import { describe, it, expect, vi, beforeAll } from 'vitest';
import * as THREE from 'three';
import { Snowmen, quadGeometry } from '../src/snowmen.js';
import { makeTrack, makeKart, def } from './helpers.js';

// camera at (x, y, z) course units looking at (tx, ty, tz), its kart 5 below it
const camAt = (x, y, z, tx = 0, ty = 0, tz = 0) => {
  const c = new THREE.PerspectiveCamera(40, 1, 0.1, 10000);
  c.position.set(x * 0.1, y * 0.1, z * 0.1);
  c.lookAt(tx * 0.1, ty * 0.1, tz * 0.1);
  c.updateMatrixWorld(true);
  c.userData.kart = { world: new THREE.Vector3(x * 0.1, y * 0.1 - 0.5, z * 0.1) };
  return c;
};
const scale = m => new THREE.Vector3().setFromMatrixScale(m).length();
const fakeAudio = () => ({ playSound: vi.fn(), stopSound: vi.fn(), starMusic: vi.fn() });
const FRAME = 2 / 60 + 1e-9;

describe('quadGeometry', () => {
  it('two triangles per four vertices, each strip 31 texture rows further down', () => {
    const verts = [[-1, -1, 0, 0, 0], [1, -1, 0, 64, 0], [1, 1, 0, 64, 31], [-1, 1, 0, 0, 31],
      [-1, 1, 0, 0, 0], [1, 1, 0, 64, 0], [1, 3, 0, 64, 31], [-1, 3, 0, 0, 31]];
    const g = quadGeometry(verts, 64);
    expect(Array.from(g.index.array)).toEqual([0, 2, 1, 0, 3, 2, 4, 6, 5, 4, 7, 6]);
    expect(g.attributes.position.count).toBe(8);
    const uv = g.attributes.uv.array;
    expect([uv[2], uv[3]]).toEqual([1, 0]);
    expect(uv[5]).toBeCloseTo(31 / 64);
    expect(uv[9]).toBeCloseTo(31 / 64);         // vertex 4: t 0 + 31
    expect(uv[13]).toBeCloseTo(62 / 64);        // vertex 6: t 31 + 31
  });
});

describe('Snowmen', () => {
  let track;
  beforeAll(async () => { track = await makeTrack('frappe'); });

  it('a missing file builds nothing and update is a no-op', async () => {
    const s = new Snowmen(new THREE.Scene(), { dir: 'no-such-course' });
    s.update(1, [], []);
    s.setScreens(2);
    await s.ready;
    expect(s.list).toHaveLength(0);
  });

  it('builds a head and a body per spawn plus a pool of puffs', async () => {
    const s = new Snowmen(new THREE.Scene(), def('frappe'));
    await s.ready;
    expect(s.list).toHaveLength(19);
    expect(s.puffMeshes).toHaveLength(128);
    const [x, y, z, section] = s.data.spawns[0];
    expect(s.list[0].section).toBe(section);
    expect(s.list[0].body.pos).toEqual([x, y + 3, z]);
    expect(s.list[0].head.pos).toEqual([x, y + 8, z]);
    expect(s.group.children).toHaveLength(128 + 38);
  });

  it('heads sway between -0x1000 and 0x1000', async () => {
    const s = new Snowmen(new THREE.Scene(), def('frappe'));
    await s.ready;
    const h = s.list[0].head, seen = new Set();
    for (let i = 0; i < 200; i++) { s.update(FRAME, [], []); seen.add(h.alpha); }
    expect(Math.max(...seen)).toBe(0x1000);
    expect(Math.min(...seen)).toBe(-0x1000);
    expect(h.rotZ).toBe((h.alpha + 0x8000) & 0xFFFF);
    // the idle timer runs out once (state 2 -> 3); the body stays drawn and hittable
    expect(s.list[0].body.state).toBe(3);
    expect(s.list[0].body).toMatchObject({ drawn: true, hit: false });
  });

  it('a kart hitting a body tumbles, the head flies and the snowman regrows', async () => {
    const items = { hit: vi.fn() };
    const s = new Snowmen(new THREE.Scene(), def('frappe'), { items });
    await s.ready;
    const o = s.list[0], b = o.body, [x, , z] = b.pos;
    const cam = camAt(x + 10, 20, z, x, 0, z);   // over the snowman's own section
    const kart = makeKart(track);
    kart.world.set(x * 0.1, 0, z * 0.1);
    s.update(FRAME, [cam], [kart]);
    const sec = s.sections.get(cam);
    expect(Math.abs(sec - o.section)).toBeLessThanOrEqual(1);
    expect(items.hit).toHaveBeenCalledWith(kart, 'fake_item_box');
    expect(b).toMatchObject({ hit: true, drawn: false, state: 10 });
    expect(o.head.ae).toBe(10);
    expect(s.puffs).toHaveLength(40);
    // puffs and head fly up
    for (let i = 0; i < 10; i++) s.update(FRAME, [cam], []);
    expect(o.head.offset[1]).toBeGreaterThan(20);
    expect(s.puffs[0].offset[1]).not.toBe(0);
    // puffs gone after 100 frames, head down at -7
    for (let i = 0; i < 100; i++) s.update(FRAME, [cam], []);
    expect(s.puffs).toHaveLength(0);
    expect(o.head.offset[1]).toBe(-7);
    expect(o.head.ae).toBe(12);
    // a kart there now doesn't hit it again
    items.hit.mockClear();
    s.update(FRAME, [cam], [kart]);
    expect(items.hit).not.toHaveBeenCalled();
    // after 300 frames the head climbs back, the body reappears and grows to 0.1
    let grew = false;
    for (let i = 0; i < 400 && b.hit; i++) {
      s.update(FRAME, [cam], []);
      if (b.state === 12 && b.scale > 0.001 && b.scale < 0.1) grew = true;
    }
    expect(grew).toBe(true);
    expect(b).toMatchObject({ hit: false, state: 2, drawn: true, scale: 0.1 });
    expect(o.head.offset[1]).toBe(0);
    expect(o.head.ae).toBeLessThanOrEqual(3);
  });

  it('a star kart drives through, the human hears it; protected karts are skipped', async () => {
    const items = { hit: vi.fn() }, audio = fakeAudio();
    const s = new Snowmen(new THREE.Scene(), def('frappe'), { items, audio });
    await s.ready;
    const b = s.list[0].body;
    const star = makeKart(track, { isPlayer: true });
    star.world.set(b.pos[0] * 0.1, 0, b.pos[2] * 0.1);
    star.star = 100;
    expect(s._collide(b, [star])).toBe(true);
    expect(audio.playSound).toHaveBeenCalledWith(1, 0x10);
    expect(items.hit).not.toHaveBeenCalled();
    const boo = makeKart(track); boo.world.copy(star.world); boo.boo = 5;
    const away = makeKart(track); away.world.set(b.pos[0] * 0.1 + 50, 0, b.pos[2] * 0.1);
    expect(s._collide(b, [boo, away, null])).toBe(false);
    // DK's bigger box reaches from 7.5 away
    const dk = { world: new THREE.Vector3((b.pos[0] + 7.8) * 0.1, 0, b.pos[2] * 0.1), mesh: { userData: { character: 'donkeykong' } } };
    expect(s._collide(b, [dk])).toBe(true);
    expect(items.hit).toHaveBeenCalledWith(dk, 'fake_item_box');
  });

  it('no camera near the section: no hit', async () => {
    const items = { hit: vi.fn() };
    const s = new Snowmen(new THREE.Scene(), def('frappe'), { items });
    await s.ready;
    const b = s.list[0].body;
    const kart = makeKart(track); kart.world.set(b.pos[0] * 0.1, 0, b.pos[2] * 0.1);
    s.update(FRAME, [], [kart]);
    expect(items.hit).not.toHaveBeenCalled();
  });

  it('fewer puffs with more screens', async () => {
    const s = new Snowmen(new THREE.Scene(), def('frappe'));
    await s.ready;
    s.setScreens(2);
    s._burst([0, 0, 0]);
    expect(s.puffs).toHaveLength(24);
    s.setScreens(4);
    s._burst([0, 0, 0]);
    expect(s.puffs).toHaveLength(16);
    for (let i = 0; i < 10; i++) s._burst([0, 0, 0]);
    expect(s.puffs).toHaveLength(128);   // capped by the pool
  });

  it('render hooks: body, head and puffs turned to a camera within range', async () => {
    for (const mirror of [false, true]) {
      const s = new Snowmen(new THREE.Scene(), def('frappe'), { mirror });
      await s.ready;
      const o = s.list[0], [x, y, z] = o.body.pos;
      const cam = camAt(x + 50, y + 10, z, x, y, z);
      o.bodyMesh.onBeforeRender(null, null, cam);
      expect(scale(o.bodyMesh.matrixWorld)).toBeGreaterThan(0);
      expect(o.bodyMesh.matrixWorld.elements[13]).toBeCloseTo(y * 0.1, 4);
      expect(o.bodyMesh.matrixWorld.determinant() < 0).toBe(mirror);
      o.headMesh.onBeforeRender(null, null, cam);
      expect(o.headMesh.matrixWorld.elements[13]).toBeCloseTo(o.head.pos[1] * 0.1, 4);
      // mid and far wedges
      for (const d of [150, 300]) {
        o.bodyMesh.onBeforeRender(null, null, camAt(x + d, y, z, x, y, z));
        expect(scale(o.bodyMesh.matrixWorld)).toBeGreaterThan(0);
      }
      // too far / looking away / hidden body
      o.bodyMesh.onBeforeRender(null, null, camAt(x + 700, y, z, x, y, z));
      expect(scale(o.bodyMesh.matrixWorld)).toBe(0);
      o.headMesh.onBeforeRender(null, null, camAt(x + 50, y, z, x + 500, y, z));
      expect(scale(o.headMesh.matrixWorld)).toBe(0);
      o.body.drawn = false;
      o.bodyMesh.onBeforeRender(null, null, cam);
      expect(scale(o.bodyMesh.matrixWorld)).toBe(0);
      // puffs: unused slots collapse, live ones are drawn
      s.puffMeshes[0].onBeforeRender(null, null, cam);
      expect(scale(s.puffMeshes[0].matrixWorld)).toBe(0);
      s._burst(o.body.pos);
      s.puffMeshes[0].onBeforeRender(null, null, cam);
      expect(scale(s.puffMeshes[0].matrixWorld)).toBeGreaterThan(0);
    }
  });
});
