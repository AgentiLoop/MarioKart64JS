import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { Props, partMeshes } from '../src/props.js';
import { billboard } from '../src/foliage.js';
import { def } from './helpers.js';

// a camera at (x, y, z) course units looking at (tx, ty, tz)
const camAt = (x, y, z, tx = 0, ty = 0, tz = 0) => {
  const c = new THREE.PerspectiveCamera(40, 1, 0.1, 10000);
  c.position.set(x * 0.1, y * 0.1, z * 0.1);
  c.lookAt(tx * 0.1, ty * 0.1, tz * 0.1);
  c.updateMatrixWorld(true);
  return c;
};
const scaleOf = m => new THREE.Vector3().setFromMatrixScale(m).length();

describe('partMeshes', () => {
  const tri = [[0, 0, 0, 0, 0, 255, 0, 0], [10, 0, 0, 1024, 0, 0, 255, 0], [0, 10, 0, 0, 2048, 0, 0, 255]];
  const model = {
    parts: [
      { triangles: [tri], image: 'a.png', width: 32, height: 64, wrapS: 'mirror', wrapT: 'clamp', alphaTest: true },
      { triangles: [tri], image: 'a.png', width: 32, height: 64, wrapS: 'mirror', wrapT: 'clamp' },
      { triangles: [tri, tri], doubleSided: true },
    ],
  };

  it('builds positions, sRGB shade colours and S10.5 uvs', () => {
    const textures = {};
    const [a, b, c] = partMeshes(model, 'mario-raceway', textures);
    expect(Array.from(a.geometry.attributes.position.array)).toEqual([0, 0, 0, 10, 0, 0, 0, 10, 0]);
    const col = a.geometry.attributes.color.array;
    expect(col[0]).toBeCloseTo(1); expect(col[1]).toBe(0); expect(col[4]).toBeCloseTo(1); expect(col[8]).toBeCloseTo(1);
    const uv = a.geometry.attributes.uv.array;
    expect(uv[2]).toBeCloseTo(1024 / 32 / 32);   // 1
    expect(uv[5]).toBeCloseTo(2048 / 32 / 64);   // 1
    expect(a.material.alphaTest).toBe(0.5);
    expect(a.material.side).toBe(THREE.FrontSide);
    expect(a.material.map.wrapS).toBe(THREE.MirroredRepeatWrapping);
    expect(a.material.map.wrapT).toBe(THREE.ClampToEdgeWrapping);
    expect(a.material.map.flipY).toBe(false);
    // the second part shares the cached texture
    expect(b.material.map).toBe(a.material.map);
    expect(b.material.alphaTest).toBe(0);
    expect(Object.keys(textures)).toEqual(['a.png/mirror/clamp']);
    // untextured, double-sided part
    expect(c.material.map).toBeNull();
    expect(c.geometry.attributes.uv).toBeUndefined();
    expect(c.geometry.attributes.position.count).toBe(6);
    expect(c.material.side).toBe(THREE.DoubleSide);
  });

  it('doubleSided argument forces both sides', () => {
    const [a] = partMeshes(model, 'x', {}, true);
    expect(a.material.side).toBe(THREE.DoubleSide);
  });
});

describe('Props', () => {
  it('Mario Raceway signs spin one degree a tick and cull past 4000', async () => {
    const scene = new THREE.Scene();
    const p = new Props(scene, def('mario'));
    expect(scene.children).toContain(p.group);
    await p.ready;
    expect(p.data.kind).toBe('spin');
    expect(p.spinners).toHaveLength(2);
    const actor = p.spinners[0];
    expect(actor.position.x).toBeCloseTo(15);
    expect(actor.scale.x).toBeCloseTo(0.1);
    for (let i = 0; i < 30; i++) p.update(1 / 60 + 1e-9);
    expect(p.ticks).toBe(30);
    expect(actor.rotation.y).toBeCloseTo((30 * p.data.spinPerTick % 1) * Math.PI * 2, 5);
    // cull: near camera keeps the matrix, far camera collapses it
    const mesh = actor.children[0];
    scene.updateMatrixWorld(true);
    mesh.onBeforeRender(null, scene, camAt(150, 100, -1200, 150, 40, -1300));
    expect(scaleOf(mesh.matrixWorld)).toBeGreaterThan(0);
    mesh.onBeforeRender(null, scene, camAt(150, 100, 5000));
    expect(scaleOf(mesh.matrixWorld)).toBe(0);
    expect(mesh.matrixWorld.elements[12]).toBeCloseTo(15);
    // diagonal distance just over the radius (each axis inside)
    scene.updateMatrixWorld(true);
    mesh.onBeforeRender(null, scene, camAt(150 + 3000, 40, -1300 + 3000));
    expect(scaleOf(mesh.matrixWorld)).toBe(0);
  });

  it('mirrored signs are flipped in x and spin the other way', async () => {
    const p = new Props(new THREE.Scene(), def('wario'), { mirror: true });
    await p.ready;
    expect(p.spinners).toHaveLength(3);
    expect(p.spinners[0].scale.x).toBeCloseTo(-0.1);
    for (let i = 0; i < 10; i++) p.update(1 / 60 + 1e-9);
    expect(p.spinners[0].rotation.y).toBeLessThan(0);
  });

  it("D.K.'s Jungle Parkway trees face the camera, the palm stays unturned", async () => {
    const scene = new THREE.Scene();
    const p = new Props(scene, def('dk'));
    await p.ready;
    expect(p.data.kind).toBe('billboard');
    const turned = p.group.children.filter(c => c.isMesh);
    const groups = p.group.children.filter(c => !c.isMesh);
    expect(turned.length).toBeGreaterThan(0);
    expect(turned.every(m => m.onBeforeRender === billboard)).toBe(true);
    expect(turned[0].material.side).toBe(THREE.DoubleSide);
    const palms = p.data.actors.filter(a => a.model === '6').length;
    expect(groups).toHaveLength(palms);
    expect(p.spinners).toHaveLength(0);
    p.update(1);   // no spinners: nothing happens
    expect(p.ticks).toBe(0);
  });

  it('Koopa Troopa Beach palms are static groups', async () => {
    const p = new Props(new THREE.Scene(), def('koopa'));
    await p.ready;
    expect(p.group.children).toHaveLength(p.data.actors.length);
    expect(p.spinners).toHaveLength(0);
  });

  it('a course without props.json builds nothing', async () => {
    const p = new Props(new THREE.Scene(), { dir: 'no-such-course' });
    await p.ready;
    expect(p.data).toBeUndefined();
    expect(p.group.children).toHaveLength(0);
  });
});
