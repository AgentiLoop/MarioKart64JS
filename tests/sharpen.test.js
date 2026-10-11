import { describe, it, expect, vi } from 'vitest';
import * as THREE from 'three';
import { createSharpen } from '../src/sharpen.js';

function fakeRenderer(w = 640, h = 480) {
  return {
    w, h,
    getDrawingBufferSize: vi.fn(function (v) { return v.set(this.w, this.h); }),
    copyFramebufferToTexture: vi.fn(),
    render: vi.fn(),
  };
}

describe('createSharpen', () => {
  it('copies the frame into a framebuffer texture and draws the sharpened quad', () => {
    const r = fakeRenderer();
    const apply = createSharpen(r);
    expect(apply).toBeTypeOf('function');
    apply();
    expect(r.copyFramebufferToTexture).toHaveBeenCalledTimes(1);
    const tex = r.copyFramebufferToTexture.mock.calls[0][0];
    expect(tex).toBeInstanceOf(THREE.FramebufferTexture);
    expect(tex.image.width).toBe(640);
    expect(tex.image.height).toBe(480);
    expect(r.render).toHaveBeenCalledTimes(1);
    const [scene, camera] = r.render.mock.calls[0];
    expect(scene).toBeInstanceOf(THREE.Scene);
    expect(camera).toBeInstanceOf(THREE.Camera);
    const quad = scene.children[0];
    expect(quad.material.uniforms.map.value).toBe(tex);
    expect(quad.material.uniforms.texel.value.x).toBeCloseTo(1 / 640);
    expect(quad.material.uniforms.texel.value.y).toBeCloseTo(1 / 480);
    expect(quad.material.uniforms.peak.value).toBeCloseTo(-1 / THREE.MathUtils.lerp(8, 5, 0.8));
    expect(quad.frustumCulled).toBe(false);
  });

  it('reuses the texture until the drawing buffer size changes', () => {
    const r = fakeRenderer();
    const apply = createSharpen(r, 0);
    apply(); apply();
    const [a, b] = r.copyFramebufferToTexture.mock.calls.map(c => c[0]);
    expect(a).toBe(b);
    const disposed = vi.fn();
    a.addEventListener('dispose', disposed);
    r.w = 1280;
    apply();
    const c = r.copyFramebufferToTexture.mock.calls[2][0];
    expect(c).not.toBe(a);
    expect(disposed).toHaveBeenCalled();
    expect(c.image.width).toBe(1280);
    const quad = r.render.mock.calls[2][0].children[0];
    expect(quad.material.uniforms.texel.value.x).toBeCloseTo(1 / 1280);
    expect(quad.material.uniforms.peak.value).toBeCloseTo(-1 / 8);
    r.h = 960;
    apply();
    expect(r.copyFramebufferToTexture.mock.calls[3][0]).not.toBe(c);
  });
});
