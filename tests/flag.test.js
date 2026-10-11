import { describe, it, expect, vi } from 'vitest';
import * as THREE from 'three';
import { flagPositions, flagNormals, flagIsWhite, createTitleFlag, FLAG_COLS, FLAG_ROWS, FLAG_STEP } from '../src/flag.js';

vi.mock('three', async orig => {
  const real = await orig();
  class WebGLRenderer {
    constructor(o) { this.opts = o; this.calls = []; globalThis.__flagRenderer = this; }
    setPixelRatio(r) { this.calls.push(['ratio', r]); }
    setSize(w, h, s) { this.calls.push(['size', w, h, s]); }
    setClearColor(c, a) { this.calls.push(['clear', c, a]); }
    render(scene, cam) { this.calls.push(['render', scene, cam]); }
  }
  return { ...real, WebGLRenderer };
});

const N = FLAG_COLS * FLAG_ROWS * 12;

describe('flagPositions', () => {
  it('lays out a 12x10 grid of 84-unit quads', () => {
    const p = flagPositions(0);
    expect(p).toBeInstanceOf(Float32Array);
    expect(p).toHaveLength(N);
    // quad (0,0): x -504..-420, y -420..-336; left edge z 0 (col 0 amplitude 0), right edge rippled by col 1
    const r = Math.trunc(Math.sin(-FLAG_STEP / 65536 * Math.PI * 2) * 84 * 0.18);
    expect([...p.subarray(0, 12)]).toEqual([-504, -420, 0, -420, -420, r, -504, -336, 0, -420, -336, r]);
    // last quad right edge reaches 504, top edge (minus droop) near 420
    const last = (FLAG_ROWS * FLAG_COLS - 1) * 12;
    expect(p[last + 9]).toBe(504);
    expect(p[last + 10]).toBe(420 + Math.trunc(144 * -0.07));
  });
  it('ripples with the phase and writes into a given buffer', () => {
    const out = new Float32Array(N);
    const r = flagPositions(0x4000, out);
    expect(r).toBe(out);
    const zs = new Set(); for (let i = 2; i < N; i += 3) zs.add(out[i]);
    expect(zs.size).toBeGreaterThan(5);
    expect(flagPositions(0x4000 + 0x10000)).toEqual(out);   // phase wraps at 16 bits
    expect(flagPositions(FLAG_STEP)).not.toEqual(flagPositions(0));
  });
});

describe('flagNormals', () => {
  it('gives every vertex an integer normal of length about 120', () => {
    const n = flagNormals(flagPositions(0x1234));
    expect(n).toHaveLength(N);
    for (let i = 0; i < N; i += 3) {
      expect(Number.isInteger(n[i])).toBe(true);
      expect(Math.hypot(n[i], n[i + 1], n[i + 2])).toBeGreaterThan(100);
      expect(Math.hypot(n[i], n[i + 1], n[i + 2])).toBeLessThan(121);
    }
  });
  it('is the same for every row of a column and flat cloth faces +z', () => {
    const n = flagNormals(flagPositions(0));
    const col0 = [...n.subarray(0, 3)];
    expect([...n.subarray((5 * FLAG_COLS) * 12, (5 * FLAG_COLS) * 12 + 3)]).toEqual(col0);
    expect(col0[2]).toBeGreaterThan(100);
    const out = new Float32Array(N);
    expect(flagNormals(flagPositions(0), out)).toBe(out);
  });
});

describe('flagIsWhite', () => {
  it('checks in 2x2 cells', () => {
    expect(flagIsWhite(0, 0)).toBe(false);
    expect(flagIsWhite(1, 1)).toBe(false);
    expect(flagIsWhite(0, 2)).toBe(true);
    expect(flagIsWhite(2, 0)).toBe(true);
    expect(flagIsWhite(2, 2)).toBe(false);
  });
});

describe('createTitleFlag', () => {
  it('builds a lit mesh and redraws once per 30 Hz frame', () => {
    const canvas = document.createElement('canvas');
    const f = createTitleFlag(canvas);
    const r = globalThis.__flagRenderer;
    expect(r.opts).toMatchObject({ canvas, alpha: true, antialias: false });
    expect(r.calls.slice(0, 3)).toEqual([['ratio', 1], ['size', 320, 240, false], ['clear', 0, 0]]);
    expect(f.mesh).toBeInstanceOf(THREE.Mesh);
    expect(f.mesh.geometry.index.count).toBe(FLAG_COLS * FLAG_ROWS * 6);
    const prim = f.mesh.geometry.attributes.prim.array;
    expect(prim[0]).toBe(0); expect(prim[2 * 4]).toBe(1);
    expect(f.camera.position.z).toBe(1800);
    expect(f.mesh.matrixAutoUpdate).toBe(false);
    expect(f.mesh.matrix.elements[13]).not.toBe(0);

    r.calls.length = 0;
    f.step(100);   // frame 3
    expect(f.phase).toBe((3 * FLAG_STEP) & 0xffff);
    expect(r.calls.filter(c => c[0] === 'render')).toHaveLength(1);
    expect([...f.mesh.geometry.attributes.position.array]).toEqual([...flagPositions(f.phase)]);
    expect(f.mesh.geometry.attributes.normal.array[2]).not.toBe(0);
    f.step(110);   // still frame 3: no redraw
    expect(r.calls.filter(c => c[0] === 'render')).toHaveLength(1);
    f.step(1000);
    expect(f.phase).toBe((30 * FLAG_STEP) & 0xffff);
    expect(r.calls.filter(c => c[0] === 'render')).toHaveLength(2);

    r.calls.length = 0;
    f.setScale(2);
    expect(r.calls.map(c => c[0])).toEqual(['ratio', 'size', 'render']);
    expect(r.calls[0][1]).toBe(2);
    f.draw();
    expect(r.calls.at(-1)[0]).toBe('render');
  });
});
