import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { YoshiEgg } from '../src/yoshi-egg.js';
import { def } from './helpers.js';

const camAt = (x, y, z, tx = 0, ty = 0, tz = 0) => {
  const c = new THREE.PerspectiveCamera(40, 1, 0.1, 10000);
  c.position.set(x * 0.1, y * 0.1, z * 0.1);
  c.lookAt(tx * 0.1, ty * 0.1, tz * 0.1);
  c.updateMatrixWorld(true);
  c.userData.kart = { world: new THREE.Vector3(x * 0.1, y * 0.1 - 0.5, z * 0.1) };   // its kart 5 below
  return c;
};
const scale = m => new THREE.Vector3().setFromMatrixScale(m).length();
const TICK = 1 / 60 + 1e-9;

describe('YoshiEgg', () => {
  it('a missing file builds nothing and update is a no-op', async () => {
    const e = new YoshiEgg(new THREE.Scene(), { dir: 'no-such-course' });
    e.update(1, []);
    await e.ready;
    expect(e.data).toBeUndefined();
  });

  it('builds the near and far eggs at the spawn', async () => {
    const scene = new THREE.Scene();
    const e = new YoshiEgg(scene, def('yoshi'));
    await e.ready;
    expect(scene.children).toContain(e.group);
    expect(e.egg.children).toHaveLength(1);
    expect(e.normals).toHaveLength(e.data.near.triangles.length * 3);
    expect(e.egg.position.x).toBeCloseTo(-230);
    expect(e.egg.position.z).toBeCloseTo(63.4);
    expect(e.far.position.equals(e.egg.position)).toBe(true);
    expect(e.state.center).toEqual([-2300, 0, 704]);
    // shading is filled in (ambient 100 at least)
    expect(Math.min(...e.shade.array)).toBeGreaterThan(0.1);
  });

  it('circles its path centre and spins every tick', async () => {
    const e = new YoshiEgg(new THREE.Scene(), def('yoshi'));
    await e.ready;
    const shade0 = Array.from(e.shade.array);
    for (let i = 0; i < 100; i++) e.update(TICK, []);
    const st = e.state, d = e.data;
    expect(st.pathRot).toBe((100 * d.pathRotPerTick) & 0xffff);
    expect(st.eggRot).toBe((100 * d.eggRotPerTick) & 0xffff);
    const r = Math.hypot(st.pos[0] - st.center[0], st.pos[2] - st.center[2]);
    expect(r).toBeCloseTo(d.pathRadius, 5);
    expect(st.pos[0]).toBeCloseTo(st.center[0] + Math.sin(st.pathRot * Math.PI * 2 / 65536) * 70, 5);
    expect(e.egg.rotation.y).toBeCloseTo(st.eggRot * Math.PI * 2 / 65536, 5);
    expect(Array.from(e.shade.array)).not.toEqual(shade0);   // the light stays put while the egg turns
    // no whole tick: nothing changes
    const rot = st.pathRot;
    e.update(0.001, []);
    expect(st.pathRot).toBe(rot);
  });

  it('mirrored: flipped in x, circling and turning the other way', async () => {
    const e = new YoshiEgg(new THREE.Scene(), def('yoshi'), { mirror: true });
    await e.ready;
    expect(e.egg.scale.x).toBeCloseTo(-0.1);
    for (let i = 0; i < 50; i++) e.update(TICK, []);
    const st = e.state;
    expect(st.pos[0]).toBeCloseTo(st.center[0] - Math.sin(st.pathRot * Math.PI * 2 / 65536) * 70, 5);
    expect(e.egg.rotation.y).toBeCloseTo(-st.eggRot * Math.PI * 2 / 65536, 5);
  });

  it('draws the lit 3D egg from sections 13-19 and the flat egg elsewhere', async () => {
    const scene = new THREE.Scene();
    const e = new YoshiEgg(scene, def('yoshi'));
    await e.ready;
    const [sx, , sz] = e.data.spawn;
    const near = camAt(-2884, 0, -538, sx, 0, sz);     // over section 15
    const far = camAt(-69, 190, 448, sx, 0, sz);        // over section 1
    e.update(TICK, [near, far]);
    const sNear = e.sections.get(near), sFar = e.sections.get(far);
    expect(sNear).toBeGreaterThanOrEqual(13); expect(sNear).toBeLessThanOrEqual(19);
    expect(sFar === undefined || sFar < 13 || sFar > 19).toBe(true);
    const nearMesh = e.egg.children[0];
    scene.updateMatrixWorld(true);
    nearMesh.onBeforeRender(null, scene, near);
    expect(scale(nearMesh.matrixWorld)).toBeGreaterThan(0);
    e.far.onBeforeRender(null, scene, near);
    expect(scale(e.far.matrixWorld)).toBe(0);
    scene.updateMatrixWorld(true);
    nearMesh.onBeforeRender(null, scene, far);
    expect(scale(nearMesh.matrixWorld)).toBe(0);
    e.far.onBeforeRender(null, scene, far);
    expect(scale(e.far.matrixWorld)).toBeGreaterThan(0);
    // beyond 4000 even a near-section camera sees nothing of the 3D egg
    e.sections.set(far, 15);
    scene.updateMatrixWorld(true);
    const away = camAt(sx + 5000, 0, sz);
    e.sections.set(away, 15);
    nearMesh.onBeforeRender(null, scene, away);
    expect(scale(nearMesh.matrixWorld)).toBe(0);
    // cameras no longer passed are forgotten
    e.update(TICK, [near]);
    expect(e.sections.has(far)).toBe(false);
    expect(e.sections.has(away)).toBe(false);
  });
});
