import { describe, it, expect, beforeAll, vi } from 'vitest';
import * as THREE from 'three';
import { flush } from './helpers.js';

// no WebGL under jsdom: a recording stand-in for the renderer
vi.mock('three', async orig => {
  const real = await orig();
  class FakeRenderer {
    constructor(o) { this.opts = o; this.shadowMap = { enabled: false, type: null }; this.renders = 0; this.sizes = []; this.disposed = false; }
    setSize(w, h) { this.sizes.push([w, h]); }
    setPixelRatio() {}
    setClearColor() {}
    render(scene, camera) { this.renders++; this.last = { scene, camera }; }
    dispose() { this.disposed = true; }
  }
  globalThis.__renderers = [];
  return { ...real, WebGLRenderer: class extends FakeRenderer { constructor(o) { super(o); globalThis.__renderers.push(this); } } };
});

beforeAll(() => {
  globalThis.Request = class { constructor(url, o) { this.url = url; Object.assign(this, o); } toString() { return this.url; } };
});

describe('createTitle3D', () => {
  let createTitle3D, title, renderer, canvas;
  beforeAll(async () => {
    ({ createTitle3D } = await import('../src/title3d.js'));
    canvas = document.createElement('canvas');
    canvas.width = 320; canvas.height = 240;
    title = createTitle3D(canvas);
    renderer = globalThis.__renderers.at(-1);
    // let the five Wii karts load
    for (let i = 0; i < 50 && title.karts.some(k => !k.userData.model); i++) await flush();
  });

  it('sets up the renderer, scene, camera and five kart holders', () => {
    expect(renderer.opts.canvas).toBe(canvas);
    expect(renderer.shadowMap.enabled).toBe(true);
    expect(renderer.shadowMap.type).toBe(THREE.PCFShadowMap);
    expect(title.camera.fov).toBe(64);
    expect(title.scene.fog).toBeInstanceOf(THREE.Fog);
    expect(title.karts).toHaveLength(5);
    expect(title.karts[0].position.x).toBeCloseTo(2.23);
    expect(title.karts[0].rotation.y).toBeCloseTo(Math.PI - 0.15);
    const sprites = title.scene.children.filter(o => o.isSprite);
    expect(sprites).toHaveLength(90);
    expect(sprites.every(s => !s.visible)).toBe(true);
    // sky, grass, road + two kerbs, two hills
    expect(title.scene.children.filter(o => o.isMesh).length).toBe(7);
  });

  it('loads a Wii kart into every holder', () => {
    for (const k of title.karts) {
      expect(k.userData.model).toBeTruthy();
      expect(k.children).toContain(k.userData.model);
    }
  });

  it('step() resizes on demand, scrolls the road and renders', () => {
    const road = title.scene.children.filter(o => o.isMesh)[2];
    const off0 = road.material.map.offset.y;
    title.step(1000, 320, 240);
    expect(renderer.sizes).toHaveLength(0);
    expect(renderer.renders).toBe(1);
    expect(renderer.last.camera).toBe(title.camera);
    expect(road.material.map.offset.y).toBe(off0);   // first frame dt = 0
    title.step(1040, 640, 480);
    expect(renderer.sizes).toEqual([[640, 480]]);
    expect(road.material.map.offset.y).toBeLessThan(off0);
    expect(renderer.renders).toBe(2);
  });

  it('karts judder and their tires spin', () => {
    const model = title.karts[0].userData.model;
    const steer = model.children[0].children[1];
    const spin0 = steer.children[0].rotation.x;
    title.step(1080, 320, 240);
    expect(steer.children[0].rotation.x).toBeGreaterThan(spin0);
    expect(title.karts.every(k => k.position.y >= 0 && k.position.y <= 0.03)).toBe(true);
  });

  it('puffs spawn behind the karts, drift, swell and fade out', () => {
    const sprites = title.scene.children.filter(o => o.isSprite);
    expect(sprites.some(s => s.visible)).toBe(true);
    const p = sprites.find(s => s.visible);
    const z0 = p.position.z, sc0 = p.scale.x;
    title.step(1120, 320, 240);
    if (p.visible) { expect(p.position.z).toBeLessThan(z0); expect(p.scale.x).toBeGreaterThan(sc0); expect(p.material.opacity).toBeLessThan(0.75); }
    // run 2 s more: puffs older than 0.9 s are hidden again, new ones keep coming
    for (let t = 1160; t < 3200; t += 40) title.step(t, 320, 240);
    const vis = sprites.filter(s => s.visible);
    expect(vis.length).toBeGreaterThan(0);
    expect(vis.length).toBeLessThan(90);
  });

  it('dt is capped at 50 ms', () => {
    const road = title.scene.children.filter(o => o.isMesh)[2];
    const o0 = road.material.map.offset.y;
    title.step(60000, 320, 240);
    expect(o0 - road.material.map.offset.y).toBeCloseTo(14 * 0.05 / 6, 6);
  });

  it('dispose() releases the renderer', () => {
    title.dispose();
    expect(renderer.disposed).toBe(true);
  });

  it('logs a kart that fails to load', async () => {
    const kart3d = await import('../src/kart3d.js');
    expect(kart3d.buildWiiKart).toBeTypeOf('function');
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    const fetch0 = globalThis.fetch;
    // a fresh module graph so the kart cache is empty, with every model missing
    vi.resetModules();
    globalThis.fetch = vi.fn(async () => ({ ok: false, status: 404, statusText: 'nf', text: async () => '', json: async () => ({}), arrayBuffer: async () => new ArrayBuffer(0) }));
    try {
      const { createTitle3D: fresh } = await import('../src/title3d.js');
      fresh(document.createElement('canvas'));
      for (let i = 0; i < 20 && !err.mock.calls.length; i++) await flush();
      expect(err).toHaveBeenCalled();
    } finally { globalThis.fetch = fetch0; err.mockRestore(); }
  });
});
