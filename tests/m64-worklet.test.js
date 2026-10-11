import { describe, it, expect, vi, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const DIR = resolve(process.cwd(), 'public/mk64/audio');
const load = n => { const b = readFileSync(`${DIR}/${n}.bin`); return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength); };

let Processor, registeredName;
const registerProcessor = (name, cls) => { registeredName = name; Processor = cls; };

beforeAll(async () => {
  globalThis.AudioWorkletProcessor = class { constructor() { this.port = { postMessage: vi.fn(), onmessage: null }; } };
  globalThis.registerProcessor = registerProcessor;
  globalThis.sampleRate = 48000;
  await import('../src/m64-worklet.js');
});

const out = (n = 512, ch = 2) => [Array.from({ length: ch }, () => new Float32Array(n))];
const send = (proc, data) => proc.port.onmessage({ data });
const peak = a => a.reduce((m, v) => Math.max(m, Math.abs(v)), 0);

describe('m64 worklet', () => {
  it('registers the m64 processor', () => {
    expect(registeredName).toBe('m64');
    expect(typeof Processor).toBe('function');
    expect(new Processor()).toBeInstanceOf(globalThis.AudioWorkletProcessor);
  });
  it('ignores commands and outputs nothing before init', () => {
    const p = new Processor();
    send(p, { type: 'play', player: 0, seq: 3 });
    expect(p.engine).toBeUndefined();
    const [o] = out();
    expect(p.process([], [o])).toBe(true);
    expect(peak(o[0])).toBe(0);
  });
  it('init builds an engine at the worklet sample rate; play/stop/sfx/sfxStop drive it', () => {
    const p = new Processor();
    send(p, { type: 'init', data: { ctl: load('ctl'), tbl: load('tbl'), seq: load('seq'), banksets: load('banksets') } });
    expect(p.engine.outRate).toBe(48000);
    const e = p.engine;
    const spies = ['play', 'stop', 'sfx', 'sfxStop'].map(k => vi.spyOn(e, k));
    send(p, { type: 'play', player: 0, seq: 3 });
    expect(e.players[0].enabled).toBe(true);
    let pk = 0;
    for (let i = 0; i < 100; i++) { const [o] = out(); expect(p.process([], [o])).toBe(true); pk = Math.max(pk, peak(o[0]), peak(o[1])); }
    expect(pk).toBeGreaterThan(0.001);
    send(p, { type: 'sfx', bank: 4, id: 0x1d, vol: 0.5, pan: 30 });
    send(p, { type: 'sfxStop', bank: 4, id: 0x1d });
    send(p, { type: 'stop', player: 0, frames: 0 });
    send(p, { type: 'bogus' });
    expect(spies[0]).toHaveBeenCalledWith(0, 3);
    expect(spies[1]).toHaveBeenCalledWith(0, 0);
    expect(spies[2]).toHaveBeenCalledWith(4, 0x1d, 0.5, 30);
    expect(spies[3]).toHaveBeenCalledWith(4, 0x1d);
    expect(e.players[0].enabled).toBe(false);
    // mono output: the single channel is used for both sides
    const [mono] = out(256, 1);
    const r = vi.spyOn(e, 'render');
    p.process([], [mono]);
    expect(r).toHaveBeenCalledWith(mono[0], mono[0]);
  });
});
