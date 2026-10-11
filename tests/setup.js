// Test environment: jsdom plus a file-backed fetch (public/), an Image that "loads" instantly and a recording 2D canvas.
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { vi } from 'vitest';

const PUBLIC = resolve(process.cwd(), 'public') + '/';

globalThis.fetch = vi.fn(async (url) => {
  const path = String(url).split('?')[0].replace(/^\//, '');
  try {
    const buf = await readFile(PUBLIC + path);
    const text = buf.toString('utf8');
    return {
      ok: true, status: 200,
      json: async () => JSON.parse(text),
      text: async () => text,
      arrayBuffer: async () => buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength),
    };
  } catch {
    return { ok: false, status: 404, json: async () => { throw new Error('404'); }, text: async () => '', arrayBuffer: async () => new ArrayBuffer(0) };
  }
});

globalThis.Image = class {
  constructor() { this.width = 64; this.height = 64; this.dataset = {}; }
  set src(v) { this._src = v; queueMicrotask(() => this.onload?.()); }
  get src() { return this._src; }
};

const ctx = () => new Proxy({ canvas: null }, {
  get: (t, k) => k in t ? t[k] : k === 'getImageData' ? (x, y, w, h) => ({ data: new Uint8ClampedArray(w * h * 4) })
    : k === 'createLinearGradient' || k === 'createRadialGradient' ? () => ({ addColorStop() {} })
    : k === 'measureText' ? () => ({ width: 10 }) : () => {},
  set: (t, k, v) => { t[k] = v; return true; },
});
HTMLCanvasElement.prototype.getContext = function () { return this._ctx ??= ctx(); };

if (!globalThis.localStorage?.getItem) {
  const store = new Map();
  globalThis.localStorage = { getItem: k => store.get(k) ?? null, setItem: (k, v) => store.set(k, String(v)), removeItem: k => store.delete(k), clear: () => store.clear() };
}
