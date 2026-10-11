import { describe, it, expect, beforeAll } from 'vitest';
import * as THREE from 'three';
import { Foliage, billboard } from '../src/foliage.js';
import { makeTrack, def } from './helpers.js';

const camAt = (x, y, z, tx = 0, ty = 0, tz = 0) => {
  const c = new THREE.PerspectiveCamera(40, 1, 0.1, 10000);
  c.position.set(x * 0.1, y * 0.1, z * 0.1);
  c.lookAt(tx * 0.1, ty * 0.1, tz * 0.1);
  c.updateMatrixWorld(true);
  return c;
};

// a bare object carrying billboard as onBeforeRender at (x, y, z) scene units
const actor = (x, y, z, max) => {
  const o = new THREE.Object3D();
  o.position.set(x, y, z);
  o.userData.maxDistance = max;
  o.updateMatrixWorld(true);
  return o;
};

describe('billboard', () => {
  it('turns the model to the camera yaw at native scale', () => {
    const o = actor(10, 2, 0, 100);
    const cam = new THREE.PerspectiveCamera();
    cam.position.set(0, 2, 0);
    cam.rotation.y = Math.PI / 2;   // right vector = (0, 0, -1)
    cam.updateMatrixWorld(true);
    billboard.call(o, null, null, cam);
    const e = o.matrixWorld.elements;
    expect(e[0]).toBeCloseTo(0); expect(e[2]).toBeCloseTo(-0.1);   // x axis = camera right * 0.1
    expect(e[5]).toBeCloseTo(0.1);                                   // y axis up * 0.1
    expect(e[8]).toBeCloseTo(0.1); expect(e[10]).toBeCloseTo(0);     // z = right x up
    expect([e[12], e[13], e[14]]).toEqual([10, 2, 0]);
  });

  it('a mirrored camera negates the right vector', () => {
    const o = actor(10, 0, 0, 100);
    const cam = new THREE.PerspectiveCamera();
    cam.userData.mirror = true;
    cam.updateMatrixWorld(true);   // right = (1, 0, 0)
    billboard.call(o, null, null, cam);
    expect(o.matrixWorld.elements[0]).toBeCloseTo(-0.1);
  });

  it('collapses past the culling distance (axis or radius)', () => {
    const cam = new THREE.PerspectiveCamera(); cam.updateMatrixWorld(true);
    const far = actor(150, 1, 0, 100);
    billboard.call(far, null, null, cam);
    expect(far.matrixWorld.elements[0]).toBe(0);
    expect(far.matrixWorld.elements[12]).toBe(150);
    const diag = actor(80, 0, 80, 100);   // each axis within, radius beyond
    billboard.call(diag, null, null, cam);
    expect(diag.matrixWorld.elements[5]).toBe(0);
  });

  it('leaves the matrix alone when the camera right vector is vertical', () => {
    const o = actor(1, 0, 0, 100);
    const before = o.matrixWorld.clone();
    const cam = new THREE.PerspectiveCamera();
    cam.rotation.z = Math.PI / 2; cam.updateMatrixWorld(true);   // right = (0, 1, 0)
    billboard.call(o, null, null, cam);
    expect(o.matrixWorld.equals(before)).toBe(true);
  });
});

describe('Foliage', () => {
  let track;
  beforeAll(async () => { track = await makeTrack('mario'); });

  it('Mario Raceway trees: one billboard per actor, lifted onto the ground', async () => {
    const scene = new THREE.Scene();
    const f = new Foliage(scene, track, def('mario'));
    expect(f.group.name).toBe('foliage');
    expect(scene.children).toContain(f.group);
    await f.ready;
    expect(f.group.children).toHaveLength(f.data.actors.length);
    const m = f.group.children[0];
    expect(m.onBeforeRender).toBe(billboard);
    expect(m.userData.maxDistance).toBe(400);
    expect(m.frustumCulled).toBe(false);
    expect(m.material.alphaTest).toBe(0.5);
    expect(m.geometry.attributes.color.itemSize).toBe(4);
    // a ground lift never lowers the tree below its spawn height
    f.data.actors.forEach((a, i) => expect(f.group.children[i].position.y).toBeGreaterThanOrEqual(a.pos[1] * 0.1 - 1e-6));
    expect(f.group.children[0].position.x).toBeCloseTo(f.data.actors[0].pos[0] * 0.1);
    // the render hook turns it towards a nearby camera
    const a = f.data.actors[0].pos;
    m.updateMatrixWorld(true);
    m.onBeforeRender(null, scene, camAt(a[0] + 100, a[1] + 20, a[2], a[0], a[1], a[2]));
    expect(new THREE.Vector3().setFromMatrixScale(m.matrixWorld).x).toBeCloseTo(0.1);
  });

  it('skipped player counts hide the group (setScreens before and after loading)', async () => {
    const mmf = await makeTrack('moomoo');
    const f = new Foliage(new THREE.Scene(), mmf, def('moomoo'));
    f.setScreens(4);   // before the data: remembered
    expect(f.group.visible).toBe(true);
    await f.ready;
    expect(f.group.visible).toBe(false);
    f.setScreens(2);
    expect(f.group.visible).toBe(true);
    f.setScreens(4);
    expect(f.group.visible).toBe(false);
  });

  it('cows.json uses the same drawing without the ground snap', async () => {
    const mmf = await makeTrack('moomoo');
    const f = new Foliage(new THREE.Scene(), mmf, def('moomoo'), 'cows');
    expect(f.group.name).toBe('cows');
    await f.ready;
    expect(f.data.onGround).toBe(false);
    const parts = Object.values(f.data.models)[0].parts.length;
    expect(f.group.children.length).toBeGreaterThanOrEqual(f.data.actors.length);
    f.data.actors.forEach((a, i) => {
      if (Object.values(f.data.models).every(m => m.parts.length === parts)) {
        expect(f.group.children[i * parts].position.y).toBeCloseTo(a.pos[1] * 0.1);
      }
    });
  });

  it('a track without groundAt keeps the spawn height', async () => {
    const f = new Foliage(new THREE.Scene(), {}, def('mario'));
    await f.ready;
    f.data.actors.forEach((a, i) => expect(f.group.children[i].position.y).toBeCloseTo(a.pos[1] * 0.1));
  });

  it('a missing file builds nothing', async () => {
    const f = new Foliage(new THREE.Scene(), track, { dir: 'no-such-course' });
    await f.ready;
    expect(f.data).toBeUndefined();
    f.setScreens(1);
    expect(f.group.visible).toBe(true);
  });
});
