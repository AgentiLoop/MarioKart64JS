import { describe, it, expect, beforeAll } from 'vitest';
import * as THREE from 'three';
import { PhysicsDebug } from '../src/physics-debug.js';
import { makeTrack, makeKart } from './helpers.js';
import { battleSpawn } from '../src/track.js';

const byType = (g, type) => g.children.filter(c => c.type === type);

describe('PhysicsDebug on a race course', () => {
  let track;
  beforeAll(async () => { track = await makeTrack('mario'); });

  it('builds a hidden overlay with wall faces, edges and the four wall-limit lines', () => {
    const scene = new THREE.Scene();
    const dbg = new PhysicsDebug(scene, track);
    expect(scene.children).toContain(dbg.group);
    expect(dbg.visible).toBe(false);
    expect(dbg.group.renderOrder).toBe(10);
    expect(track.wallTris.length).toBeGreaterThan(0);
    const [fill] = byType(dbg.group, 'Mesh');
    expect(fill.geometry.attributes.position.count).toBe(track.wallTris.length * 3);
    expect(fill.material.color.getHex()).toBe(0xff2020);
    const [edges] = byType(dbg.group, 'LineSegments');
    expect(edges.geometry.attributes.position.count).toBe(track.wallTris.length * 6);
    const lines = byType(dbg.group, 'Line');
    expect(lines).toHaveLength(4);
    expect(lines.map(l => l.material.color.getHex())).toEqual([0xffe000, 0xffe000, 0xff8000, 0xff8000]);
    for (const l of lines) {
      const a = l.geometry.attributes.position;
      expect(a.count).toBe(track.n + 1);
      expect(Array.from(a.array).every(Number.isFinite)).toBe(true);
      // closed loop: last point equals the first
      expect(a.getX(track.n)).toBeCloseTo(a.getX(0), 5);
    }
    // the outer (margin 0) left line sits further from the centre line than the margin-1.2 one
    const [p0, R0] = [track.pos[0], track.R[0]];
    const off = l => (l.geometry.attributes.position.getX(0) - p0.x) * R0.x + (l.geometry.attributes.position.getZ(0) - p0.z) * R0.z;
    expect(Math.abs(off(lines[0]))).toBeGreaterThan(Math.abs(off(lines[2])));
  });

  it('toggle shows/hides; update adds rings per kart, follows them and removes departed karts', () => {
    const scene = new THREE.Scene();
    const dbg = new PhysicsDebug(scene, track);
    const before = dbg.group.children.length;
    const a = makeKart(track), b = makeKart(track, { s: 40, character: 'bowser' });
    dbg.update([a, b]);   // hidden: nothing happens
    expect(dbg.rings.size).toBe(0);
    expect(dbg.toggle()).toBe(true);
    expect(dbg.visible).toBe(true);
    dbg.update([a, b]);
    expect(dbg.rings.size).toBe(2);
    expect(dbg.group.children.length).toBe(before + 6);
    const [lo, hi, bump] = dbg.rings.get(a);
    const p = a.mesh.position;
    expect(lo.type).toBe('LineLoop');
    expect(lo.position.toArray()).toEqual([p.x, p.y + 0.6, p.z]);
    expect(hi.position.y).toBeCloseTo(p.y + 2);
    expect(bump.position.y).toBeCloseTo(p.y + 0.1);
    expect(bump.material.color.getHex()).toBe(0xff40ff);
    // ring radius = visualHalfWidth / boxSize * 0.1
    const ra = lo.geometry.attributes.position;
    expect(Math.hypot(ra.getX(0), ra.getZ(0))).toBeCloseTo(a.visualHalfWidth, 5);
    expect(Math.hypot(bump.geometry.attributes.position.getX(0), bump.geometry.attributes.position.getZ(0))).toBeCloseTo(a.boxSize * 0.1, 5);
    a.mesh.position.set(10, 20, 30);
    dbg.update([a, b]);
    expect(lo.position.toArray()).toEqual([10, 20.6, 30]);
    expect(dbg.rings.get(a)[0]).toBe(lo);   // rings are reused
    dbg.update([b]);
    expect(dbg.rings.has(a)).toBe(false);
    expect(dbg.group.children).not.toContain(lo);
    expect(dbg.group.children.length).toBe(before + 3);
    expect(dbg.toggle()).toBe(false);
    expect(dbg.toggle(true)).toBe(true);
    expect(dbg.toggle(true)).toBe(true);
  });
});

describe('PhysicsDebug on a battle arena and an empty track', () => {
  it('arenas draw their wall faces but no route wall lines', async () => {
    const track = await makeTrack('block-fort');
    expect(track.arena).toBe(true);
    const dbg = new PhysicsDebug(new THREE.Scene(), track);
    expect(byType(dbg.group, 'Line')).toHaveLength(0);
    if (track.wallTris?.length) expect(byType(dbg.group, 'Mesh')).toHaveLength(1);
    dbg.toggle(true);
    const k = makeKart(track, { spawn: battleSpawn('block-fort', 0) });
    dbg.update([k]);
    expect(dbg.rings.get(k)).toHaveLength(3);
  });
  it('a track without wall data builds an empty overlay', () => {
    const dbg = new PhysicsDebug(new THREE.Scene(), { arena: false });
    expect(dbg.group.children).toHaveLength(0);
    const dbg2 = new PhysicsDebug(new THREE.Scene(), { wallTris: [], arena: true });
    expect(dbg2.group.children).toHaveLength(0);
  });
  it('wall lines fall back to the route height without groundAt', () => {
    const v = (x, y, z) => new THREE.Vector3(x, y, z);
    const track = { n: 2, pos: [v(0, 5, 0), v(10, 7, 0)], R: [v(0, 0, 1), v(0, 0, 1)], wallL: [3, 3], wallR: [4, 4] };
    const dbg = new PhysicsDebug(new THREE.Scene(), track);
    const lines = byType(dbg.group, 'Line');
    expect(lines).toHaveLength(4);
    const a = lines[0].geometry.attributes.position;   // margin 0, left
    expect(a.getX(0)).toBe(0); expect(a.getY(0)).toBeCloseTo(5.6); expect(a.getZ(0)).toBe(-3);
    const r = lines[3].geometry.attributes.position;   // margin 1.2, right
    expect(r.getZ(1)).toBeCloseTo(4 - 1.2);
    expect(r.getY(1)).toBeCloseTo(7.6);
  });
});
