import { describe, it, expect, beforeEach, vi } from 'vitest';
import * as THREE from 'three';
import { flush } from './helpers.js';

// hd.js keeps its preset / manifest / texture set at module level: every test gets a fresh copy
async function fresh(stored) {
  vi.resetModules();
  localStorage.clear();
  if (stored) localStorage.setItem('mk64res', stored);
  const HD = await import('../src/hd.js');
  await HD.ready;
  return HD;
}

// a file the manifest has at 4x, and one it has at 2x only (if any)
const manifest = JSON.parse(await (await fetch('/mk64-hd/manifest.json')).text()).files;
const at4 = Object.keys(manifest).find(k => manifest[k] === 4);
const at2 = Object.keys(manifest).find(k => manifest[k] === 2);

beforeEach(() => { document.body.innerHTML = ''; window.innerHeight = 768; window.devicePixelRatio = 1; });

describe('presets', () => {
  it('defaults to 1x N64 with no stored preset', async () => {
    const HD = await fresh();
    expect(HD.PRESETS.map(p => p.id)).toEqual(['1x', '2x', '4x', 'native']);
    expect(HD.presetId()).toBe('1x');
    expect(HD.presetLabel()).toBe('1× N64 480p');
    expect(HD.renderLines()).toBe(480);
    expect(HD.tier()).toBe(1);
    expect(HD.smooth()).toBe(false);
    expect(document.documentElement.classList.contains('hd')).toBe(false);
  });

  it('restores the stored preset', async () => {
    const HD = await fresh('4x');
    expect(HD.presetId()).toBe('4x');
    expect(HD.tier()).toBe(4);
    expect(HD.smooth()).toBe(true);
    expect(document.documentElement.classList.contains('hd')).toBe(true);
  });

  it('ignores an unknown stored preset', async () => {
    const HD = await fresh('8k');
    expect(HD.presetId()).toBe('1x');
  });

  it('setPreset switches, persists and notifies; unknown or same id is a no-op', async () => {
    const HD = await fresh();
    const fn = vi.fn();
    HD.onChange(fn);
    HD.setPreset('2x');
    expect(HD.presetId()).toBe('2x');
    expect(HD.tier()).toBe(2);
    expect(localStorage.getItem('mk64res')).toBe('2x');
    expect(fn).toHaveBeenCalledTimes(1);
    HD.setPreset('2x');
    HD.setPreset('bogus');
    expect(fn).toHaveBeenCalledTimes(1);
    expect(HD.presetId()).toBe('2x');
  });

  it('cyclePreset walks every preset and wraps', async () => {
    const HD = await fresh();
    const seen = [];
    for (let i = 0; i < 4; i++) { HD.cyclePreset(); seen.push(HD.presetId()); }
    expect(seen).toEqual(['2x', '4x', 'native', '1x']);
    expect(localStorage.getItem('mk64res')).toBe('1x');
  });

  it('native follows the window height x devicePixelRatio', async () => {
    const HD = await fresh('native');
    window.innerHeight = 300;
    expect(HD.renderLines()).toBe(300);
    expect(HD.tier()).toBe(1);
    window.innerHeight = 480;
    expect(HD.tier()).toBe(2);
    window.devicePixelRatio = 2;
    expect(HD.renderLines()).toBe(960);
    expect(HD.tier()).toBe(4);
    expect(HD.presetLabel()).toBe('Native');
  });

  it('a resize refreshes only under the native preset', async () => {
    const HD = await fresh('native');
    const fn = vi.fn();
    HD.onChange(fn);
    window.dispatchEvent(new Event('resize'));
    expect(fn).toHaveBeenCalledTimes(1);
    HD.setPreset('2x');
    fn.mockClear();
    window.dispatchEvent(new Event('resize'));
    expect(fn).not.toHaveBeenCalled();
  });
});

describe('hdSource / setImg', () => {
  it('picks the highest built tier up to the preset', async () => {
    const HD = await fresh();
    expect(HD.hdSource(at4)).toEqual({ url: `/mk64/${at4}`, scale: 1 });
    HD.setPreset('2x');
    expect(HD.hdSource(at4)).toEqual({ url: `/mk64-hd/2x/${at4}`, scale: 2 });
    HD.setPreset('4x');
    expect(HD.hdSource(at4)).toEqual({ url: `/mk64-hd/4x/${at4}`, scale: 4 });
    if (at2) expect(HD.hdSource(at2)).toEqual({ url: `/mk64-hd/2x/${at2}`, scale: 2 });
    expect(HD.hdSource('nope/none.png')).toEqual({ url: '/mk64/nope/none.png', scale: 1 });
  });

  it('setImg tags an <img> and refresh() swaps its source', async () => {
    const HD = await fresh();
    const img = document.createElement('img');
    document.body.appendChild(img);
    HD.setImg(img, at4);
    expect(img.dataset.hd).toBe(at4);
    expect(img.getAttribute('src')).toBe(`/mk64/${at4}`);
    HD.setPreset('4x');
    expect(img.getAttribute('src')).toBe(`/mk64-hd/4x/${at4}`);
  });

  it('without a manifest every image is the ROM one', async () => {
    const f0 = globalThis.fetch;
    globalThis.fetch = vi.fn(async () => ({ ok: false, json: async () => ({}) }));
    try {
      const HD = await fresh('4x');
      expect(HD.hdSource(at4).scale).toBe(1);
    } finally { globalThis.fetch = f0; }
    globalThis.fetch = vi.fn(async () => { throw new Error('offline'); });
    try {
      const HD = await fresh('4x');
      expect(HD.hdSource(at4).url).toBe(`/mk64/${at4}`);
    } finally { globalThis.fetch = f0; }
  });
});

describe('loadTexture', () => {
  it('1x: N64 image, linear mag / retro min filter, no mipmaps', async () => {
    const HD = await fresh();
    const onLoad = vi.fn();
    const tex = HD.loadTexture(at4, { onLoad });
    expect(tex).toBeInstanceOf(THREE.Texture);
    expect(tex.magFilter).toBe(THREE.LinearFilter);
    expect(tex.minFilter).toBe(THREE.NearestFilter);
    expect(tex.generateMipmaps).toBe(false);
    expect(tex.anisotropy).toBe(1);
    await flush();
    expect(onLoad).toHaveBeenCalledWith(tex, 1);
    expect(tex.image.src).toBe(`/mk64/${at4}`);
    expect(tex.userData.hd.scale).toBe(1);
  });

  it('HD tiers: mipmapped smooth filtering with the renderer\'s anisotropy, reloads on tier change', async () => {
    const HD = await fresh();
    const onLoad = vi.fn();
    const tex = HD.loadTexture(at4, { onLoad });
    const plain = HD.loadTexture(at4, { mipmaps: false, retroFilter: THREE.LinearFilter });
    HD.setRenderer({ capabilities: { getMaxAnisotropy: () => 16 } });
    await flush();
    HD.setPreset('4x');
    expect(tex.minFilter).toBe(THREE.LinearMipmapLinearFilter);
    expect(tex.generateMipmaps).toBe(true);
    expect(tex.anisotropy).toBe(16);
    expect(plain.minFilter).toBe(THREE.LinearFilter);
    expect(plain.anisotropy).toBe(1);
    await flush();
    expect(onLoad).toHaveBeenLastCalledWith(tex, 4);
    expect(tex.image.src).toBe(`/mk64-hd/4x/${at4}`);
    // same tier again: nothing reloads
    onLoad.mockClear();
    HD.setPreset('native'); window.innerHeight = 1200;
    window.dispatchEvent(new Event('resize'));
    await flush();
    expect(onLoad).not.toHaveBeenCalled();
  });

  it('drops the GL texture when the new image has a different size', async () => {
    const HD = await fresh();
    const tex = HD.loadTexture(at4);
    await flush();
    tex.image = { width: 16, height: 16 };   // pretend the N64 image was smaller than the next one
    const disposed = vi.fn();
    tex.addEventListener('dispose', disposed);
    HD.setPreset('2x');
    await flush();
    expect(disposed).toHaveBeenCalled();
    expect(tex.image.width).toBe(64);
    // still tracked after the size change: the next preset change reloads it
    HD.setPreset('4x');
    await flush();
    expect(tex.image.src).toBe(`/mk64-hd/4x/${at4}`);
  });

  it('a stale load (tier changed while loading) is ignored', async () => {
    const HD = await fresh();
    const onLoad = vi.fn();
    const tex = HD.loadTexture(at4, { onLoad });
    HD.setPreset('4x');   // before the 1x image arrives
    await flush();
    expect(onLoad).toHaveBeenCalledTimes(1);
    expect(onLoad).toHaveBeenCalledWith(tex, 4);
  });

  it('maps <course>/common/ paths to the shared common folder', async () => {
    const HD = await fresh();
    const tex = HD.loadTexture('mario-raceway/common/x.png');
    expect(tex.userData.hd.rel).toBe('common/x.png');
    expect(tex.userData.hd.url).toBe('/mk64/common/x.png');
  });

  it('a disposed texture is no longer refreshed', async () => {
    const HD = await fresh();
    const onLoad = vi.fn();
    const tex = HD.loadTexture(at4, { onLoad });
    await flush();
    tex.dispose();
    onLoad.mockClear();
    HD.setPreset('4x');
    await flush();
    expect(onLoad).not.toHaveBeenCalled();
    expect(tex.userData.hd.url).toBe(`/mk64/${at4}`);
  });
});
