import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { M64 } from '../src/m64.js';

const RATE = 48000;
const DIR = resolve(process.cwd(), 'public/mk64/audio');
const load = n => { const b = readFileSync(`${DIR}/${n}.bin`); return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength); };
let data;
beforeAll(() => { data = { ctl: load('ctl'), tbl: load('tbl'), seq: load('seq'), banksets: load('banksets') }; });

const mk = (rate = RATE) => new M64(data, rate);
const block = (m, n = 4096) => { const L = new Float32Array(n), R = new Float32Array(n); m.render(L, R); return [L, R]; };
const peak = a => a.reduce((m, v) => Math.max(m, Math.abs(v)), 0);
const allFinite = a => a.every(Number.isFinite);
// render `seconds` of audio, returning the overall peak (and asserting finiteness)
function renderFor(m, seconds, n = 2048) {
  let pk = 0;
  for (let i = 0; i < Math.ceil(seconds * m.outRate / n); i++) {
    const [L, R] = block(m, n);
    if (!allFinite(L) || !allFinite(R)) throw new Error('non-finite sample');
    pk = Math.max(pk, peak(L), peak(R));
  }
  return pk;
}

describe('M64 construction and banks', () => {
  it('parses the ctl/tbl/seq tables', () => {
    const m = mk();
    expect(m.ctlTab.length).toBeGreaterThan(0);
    expect(m.tblTab.length).toBeGreaterThan(0);
    expect(m.seqTab.length).toBeGreaterThan(0x11);
    expect(m.players).toHaveLength(4);
    expect(m.rvBuf[0].length).toBe(Math.round(0x28 * 64 * RATE / 26800));
  });
  it('banksFor lists the banks of a sequence and bank() decodes instruments and caches', () => {
    const m = mk();
    const banks = m.banksFor(3);
    expect(banks.length).toBeGreaterThan(0);
    const b = m.bank(banks[0]);
    expect(Array.isArray(b.insts)).toBe(true);
    expect(m.bank(banks[0])).toBe(b);
    const inst = b.insts.find(i => i && i.sounds[1]);
    expect(inst.sounds[1].sample.pcm).toBeInstanceOf(Float32Array);
    expect(inst.sounds[1].sample.pcm.length).toBeGreaterThan(0);
    expect(Number.isFinite(inst.sounds[1].tuning)).toBe(true);
    // sample() cache
    expect(m.samples.size).toBeGreaterThan(0);
  });
  it('decodes every bank including drums', () => {
    const m = mk();
    let drums = 0;
    for (let i = 0; i < m.ctlTab.length; i++) drums += m.bank(i).drums.filter(Boolean).length;
    expect(drums).toBeGreaterThan(0);
    for (const s of m.samples.values()) expect(s.end).toBeLessThanOrEqual(s.pcm.length);
  });
});

describe('M64 music', () => {
  it('renders silence with nothing playing', () => {
    const m = mk();
    const [L, R] = block(m);
    expect(peak(L)).toBe(0); expect(peak(R)).toBe(0);
  });
  it('plays a course sequence: audible finite output, notes allocated, sequence advancing', () => {
    const m = mk();
    m.play(0, 3);
    const p = m.players[0];
    expect(p.enabled).toBe(true);
    expect(p.seqId).toBe(3);
    const pk = renderFor(m, 2);
    expect(pk).toBeGreaterThan(0.001);
    expect(p.st.pc).toBeGreaterThan(0);
    expect(p.channels.filter(c => c && c.enabled).length).toBeGreaterThan(0);
    expect(m.notes.length).toBeGreaterThan(0);
    expect(p.tempo).toBeGreaterThan(0);
  });
  it('stop() with no fade silences immediately; stop with frames fades out then disables', () => {
    const m = mk();
    m.play(0, 3);
    renderFor(m, 1);
    m.stop(0);
    expect(m.players[0].enabled).toBe(false);
    renderFor(m, 1.5);
    expect(m.notes.length).toBe(0);
    expect(peak(block(m)[0])).toBeLessThan(0.05);
    m.stop(0); // stopping a disabled player is a no-op
    m.play(0, 4);
    renderFor(m, 1);
    m.stop(0, 10);
    const p = m.players[0];
    expect(p.state).toBe(2);
    expect(p.fadeRemaining).toBe(30);
    expect(p.fadeVelocity).toBeLessThan(0);
    renderFor(m, 0.5);
    expect(p.enabled).toBe(false);
  });
  it('plays every sequence for a little while without producing NaNs', () => {
    const m = mk(32000);
    for (let s = 1; s < m.seqTab.length; s++) {
      m.play(0, s);
      renderFor(m, 0.6, 4096);
      m.stop(0);
    }
    expect(m.players[0].enabled).toBe(false);
  }, 30000);
  it('long plays of course music loop and keep sounding', () => {
    for (const s of [3, 5, 7, 9, 0x11, 0x12]) {
      const m = mk(16000);
      m.play(0, s);
      expect(renderFor(m, 6, 4096)).toBeGreaterThan(0);
    }
  }, 30000);
  it('replaying a player restarts it', () => {
    const m = mk();
    m.play(1, 0x11);
    renderFor(m, 0.5);
    const before = m.players[1].channels;
    m.play(1, 0x11);
    expect(m.players[1].channels).not.toBe(before);
    expect(m.players[1].st.pc).toBe(0);
  });
});

describe('M64 sound effects', () => {
  it('sfx starts sequence 0 on player 2, cycles slots and plays audible sound', () => {
    const m = mk();
    m.sfx(4, 0x01);
    const p = m.players[2];
    expect(p.enabled).toBe(true);
    expect(p.seqId).toBe(0);
    expect(m.sfxQueue).toEqual([[10, 1, 1, undefined]]);
    m.sfx(4, 0x02, 0.5, 20);
    expect(m.sfxQueue[1]).toEqual([11, 2, 0.5, 20]);
    m.sfx(4, 0x00);
    expect(m.sfxQueue[2][0]).toBe(10); // wraps around the 2 slots of bank 4
    expect(renderFor(m, 1)).toBeGreaterThan(0.001);
    expect(m.sfxQueue.length).toBe(0);
  });
  it('plays every bank 0-5 sound briefly', () => {
    const m = mk(16000);
    let pk = 0;
    // ids the game uses (out-of-range ids index past a bank's sound table, as on the console)
    const used = [[0, 0], [0, 3], [0, 0x10], [0, 0x28], [1, 0x0b], [1, 0x10], [1, 0x46], [1, 0x51], [2, 0x0e], [2, 0x1e],
      [2, 0x2f], [3, 2], [3, 8], [4, 0], [4, 2], [4, 3], [4, 7], [4, 0x10], [4, 0x16], [4, 0x1d], [5, 3], [5, 12]];
    for (const [bank, id] of used) { m.sfx(bank, id, 0.8, 30); pk = Math.max(pk, renderFor(m, 0.3, 1024)); }
    expect(pk).toBeGreaterThan(0);
  }, 30000);
  it('sfxStop stops a looping sound only if it still owns a channel', () => {
    const m = mk();
    m.sfx(0, 0x05);
    renderFor(m, 0.2);
    m.sfxStop(0, 0x05);
    expect(m.sfxIds[0]).toBeUndefined();
    expect(m.sfxQueue).toEqual([[0, -1]]);
    const ch = m.players[2].channels[0], seen = [];
    // the channel script reads io[0] (and resets it) in the same update: record the write
    let v = ch.io;
    ch.io = new Proxy(v, { set: (t, k, x) => { if (k === '0') seen.push(x); t[k] = x; return true; }, get: (t, k) => t[k] });
    m.update();
    expect(seen[0]).toBe(0);
    expect(m.sfxQueue).toEqual([]);
    m.sfxStop(0, 0x77); // not playing: nothing queued
    expect(m.sfxQueue).toEqual([]);
    const fresh = mk();
    fresh.sfxStop(1, 3);
    expect(fresh.sfxQueue).toBeUndefined();
  });
  it('sfx with music running mixes both', () => {
    const m = mk();
    m.play(0, 2);
    m.sfx(2, 0x0e);
    expect(renderFor(m, 1)).toBeGreaterThan(0.001);
    expect(m.players[0].enabled && m.players[2].enabled).toBe(true);
  });
});

// Tiny assembler for hand-written .m64 scripts: numbers are bytes, 'NAME:' defines a label, '@NAME' emits its
// 16-bit big-endian address.
function asm(items) {
  const labels = {}, out = [];
  for (let pass = 0; pass < 2; pass++) {
    out.length = 0;
    for (const it of items) {
      if (typeof it === 'number') out.push(it & 0xff);
      else if (it.endsWith(':')) labels[it.slice(0, -1)] = out.length;
      else { const a = labels[it.slice(1)] ?? 0; out.push(a >> 8, a & 0xff); }
    }
  }
  return { bytes: Uint8Array.from(out), labels };
}
const TEMPO_INTERNAL = Math.floor(3 * 2880000 / 48 / 16.713);
// player 0 running a custom script with seq 3's banks (bank set [1, 3], default bank 3)
function custom(m, script) {
  m.play(0, 3);
  const p = m.players[0];
  p.data = script.bytes; p.st = { pc: 0, stack: [], rem: [], depth: 0 }; p.tempo = TEMPO_INTERNAL;
  return p;
}
const TAB = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16];

const SCRIPT = [
  // ---- sequence script ----
  0xd7, 0x00, 0x07, 0xd7, 0x00, 0x01,            // init channels 0-2, re-init channel 0
  0x90, '@CH0', 0x91, '@CH1', 0x92, '@CH2', 0x93, '@CH0',   // channel 3 was never initialised
  0xfc, '@SUB', 0xf8, 2, 0xf1, 0, 0xf7,
  0xdf, 5, 0xde, 0xfe, 0xdc, 0x80, 0xdd, 0xff,
  0xda, 0, 0, 5, 0xdb, 100, 0xda, 1, 0, 0, 0xdb, 127,
  0xd9, 127, 0xd5, 0, 0xd3, 0, 0xd0, 0, 0xd2, '@TAB', 0xd1, '@TAB',
  0xcc, 5, 0xc9, 7, 0xc8, 1, 0xc0,
  0xcc, 0, 0xfa, '@A', 0xf1, 0,
  'A:', 0xf3, 2, 0xf1, 0, 0xcc, 1, 0xf3, 5, 0xf2, 0x7f, 0xf4, 2, 0xf1, 0,
  0xc8, 3, 0xf5, '@B', 0xf9, '@B', 0xf1, 0,
  'B:', 0xf2, 2, 0xf1, 0,
  0x00, 0x50, 0x70, 0x80, 0x01, 0x05, 0x30,
  0xfd, 2, 0xfe,
  0xfd, 0x80, 0xc8,                               // long var16 delay: 200 tatums
  0xd6, 0x00, 0x02,                               // disable channel 1
  0xda, 2, 0, 10, 0xdb, 16, 0xda, 0, 0, 5,        // fade out over 10 updates (later fades are ignored)
  0xfd, 40, 0xff,
  'SUB:', 0xf1, 0, 0xff,
  'TAB:', ...TAB,
  'DYN:', '@DYN2', 'DYN2:', '@CSUB', 'CSUB:', 0xff,
  'E7:', 0, 0, 3, 0, 0x40, 0x80, 0x10,
  'ENV:', 0, 10, 0x70, 0, 0xff, 0xff, 0, 0,
  'SCR:', 0,
  // ---- channel 0: every channel command ----
  'CH0:', 0xc1, 0x00, 0xc1, 0x85, 0xc1, 0x7f, 0xc1, 0x08, 0xeb, 1, 1, 0xc6, 1,
  0xc2, '@DYN', 0xcc, 0, 0xc5, 0xe4,
  0xde, 0x40, 0x00, 0xd3, 0x10, 0xdd, 0x20, 0xdc, 0x40, 0xdb, 2, 0xda, '@ENV', 0xd9, 0x10,
  0xd8, 4, 0xd7, 8, 0xe2, 1, 2, 3, 0xe1, 1, 2, 3, 0xe3, 1, 0xd4, 0x20,
  0xc7, 1, '@SCR', 0xc8, 1, 0xc9, 0x7f, 0xcc, 1, 0xca, 0, 0xcb, '@TAB',
  0xd0, 0, 0xd1, 0, 0xe5, 0, 0xe6, 0, 0xe9, 0, 0xd2, 0x10,
  0xe7, '@E7', 0xe8, 0, 0, 3, 0, 0x40, 0x80, 0x10, 0,
  0xec, 0xef, 0, 0, 0, 0xf0, 0xf1, 0, 0xc3, 0xc4, 0xc3, 0xdf, 0x7f, 0xe0, 0x80,
  0xf8, 2, 0xf7, 0xf8, 3, 0xf6, 0xfc, '@CSUB',
  0xcc, 0, 0xfa, '@X', 0xf0,
  'X:', 0xf3, 1, 0xf0, 0xcc, 0xff, 0xf5, '@Y', 0xf9, '@Y', 0xf0,
  'Y:', 0xf2, 1, 0xf0, 0xf4, 1, 0xf0, 0xfb, '@Z', 0xf0,
  'Z:', 0x00, 0x70, 0x80, 0x85, 0x53, 0xc0,
  0x90, '@L0', 0x90, '@L0',                     // set layer 0 twice
  0xcc, 0, 0xb1, 0xa1,                           // layer 1 from the dyn table, then freed
  0x13, '@CSUB', 0x23, 0x31, 2, 0x41, 2, 0x43, 2,
  0xcc, 0xff, 0xb2, 0xc5, 0xe4,
  0x62, 0xfd, 3, 0xea,
  // ---- layer on channel 0 ----
  'L0:', 0xf8, 2, 0xf7, 0xf4, 1, 0xf0, 0xc9, 0x80, 0xc3, 0x02, 0xca, 0x40, 0xc2, 0, 0xc1, 100,
  0xd5, 0xe5, 0xcc, 0xc8, 0xc6, 0x7f, 0xc6, 0xff, 0xc6, 0x70,
  0x20, 2,                                       // channel instrument
  0xc6, 0x85, 0x20, 2,                           // synthetic wave
  0xc7, 0x81, 0x30, 5, 0x60,                     // portamento (tempo-scaled time)
  0xc7, 0x05, 0x30, 2, 0xa0,                     // portamento mode 5
  0xc7, 0x01, 0xf0, 2, 0x22, 2,                  // portamento target out of range -> note 0
  0xc8, 0xc2, 0x7f, 0x30, 2, 0xc2, 0,            // note out of range
  0xc6, 0x7f, 0x05, 2, 0x14, 2, 0xcc, 0x03, 2,   // drums: present, missing, ignoring drum pan
  0xc6, 1, 0xc4, 0x05, 2, 0xc2, 0x40, 0x3f, 2, 0xc2, 0, 0xc5,   // continuous notes changing sound
  0xc0, 2, 0xfb, '@LEND', 0xf0,
  'LEND:', 0xcb, '@ENV', 0x10, 0xff,
  // ---- channel 1: large notes, first without an instrument ----
  'CH1:', 0xc4, 0x90, '@L1', 0xfd, 20, 0xc1, 1, 0x91, '@L1B', 0xfd, 40, 0xff,
  'L1:', 0x20, 2, 0x90, 0x10, 0x60, 2, 100, 0xa0, 100, 0x10, 0xff,
  'L1B:', 0x20, 2, 100, 0x80, 0x60, 2, 90, 0xa0, 80, 0x20, 0xff,
  // ---- channel 2: synthetic waves with vibrato ----
  'CH2:', 0xc1, 0x81, 0xe2, 0x10, 0x40, 2, 0xe1, 0x10, 0x40, 2, 0xe3, 1, 0xd4, 0x40, 0x92, '@L2', 0xfd, 60,
  0xd8, 0x20, 0xd7, 0x30, 0xfd, 60, 0xff,
  'L2:', 0x1e, 4, 0x2d, 4, 0x37, 4, 0xc2, 20, 0x32, 4, 0xc2, 0, 0xc7, 0x01, 0x10, 3, 0x30, 4, 0xc8, 0x30, 30, 0xff,
];

describe('M64 hand-written scripts', () => {
  it('runs every sequence/channel/layer command', () => {
    const m = mk();
    const s = asm(SCRIPT), p = custom(m, s);
    m.update();
    expect(p.transposition).toBe(3);
    expect(p.tempo).toBe(TEMPO_INTERNAL);
    expect(p.velTable).toEqual(TAB);
    expect(p.durTable).toEqual(TAB);
    expect(p.fadeVolume).toBe(1);
    expect(p.fadeVolumeScale).toBe(1);
    expect(p.variation).toBe(1);
    expect(p.delay).toBe(2);
    expect(p.channels[3]).toBeUndefined();
    const c0 = p.channels[0];
    expect(c0.delay).toBe(2);
    expect(c0.bankId).toBe(1);
    expect(c0.freqScale).toBe(1);
    expect(c0.largeNotes).toBe(false);
    expect(c0.notePriority).toBe(3);
    expect(c0.reverbVol).toBe(0x10);
    expect(c0.adsr.sustain).toBe(0x10);
    expect(c0.adsr.releaseRate).toBe(0x10);
    expect(c0.adsr.env.o).toBe(s.labels.ENV);
    expect(s.bytes[s.labels.SCR]).toBe(1);
    expect(c0.layers[0]).toBeTruthy();
    expect(c0.layers[1]).toBeNull();
    expect(p.channels[1].largeNotes).toBe(true);
    const waves = new Set();
    let porta = false, maxNotes = 0, pk = 0, stopped = false, dropped = false;
    for (let i = 0; i < 400 && p.enabled; i++) {
      const [L, R] = block(m, 256);
      expect(allFinite(L) && allFinite(R)).toBe(true);
      pk = Math.max(pk, peak(L));
      for (const n of m.notes) { waves.add(n.wave); if (n.porta?.mode) porta = true; }
      maxNotes = Math.max(maxNotes, m.notes.length);
      if (c0.stopScript) stopped = true;
      if (p.channels[1] === null) dropped = true;
      if (i === 30) expect(p.channels[1]).toBeTruthy();
    }
    expect(stopped).toBe(true);
    expect(dropped).toBe(true);                // 0xd6 disabled channel 1
    expect(waves.has(-1)).toBe(true);
    expect([...waves].some(w => w >= 0)).toBe(true);
    expect(porta).toBe(true);
    expect(maxNotes).toBeGreaterThan(1);
    expect(pk).toBeGreaterThan(0);
    expect(p.enabled).toBe(false);            // the 0xda 2 fade disabled the player
  });
  it('0xff at the top level ends the sequence', () => {
    const m = mk();
    const p = custom(m, asm([0xff]));
    m.update();
    expect(p.enabled).toBe(false);
  });
  it('dummy (zero length) seq and tbl table entries point at another entry', () => {
    const m = mk();
    m.seqTab[5] = [3, 0];
    m.play(0, 5);
    expect(m.players[0].data.length).toBe(m.seqTab[3][1]);
    const m2 = mk();
    m2.tblTab[2] = [0, 0];
    expect(m2.bank(2).insts.length).toBeGreaterThan(0);
  });
});

describe('M64 envelopes, vibrato and notes', () => {
  const env = (...pairs) => { const d = new Uint8Array(pairs.length * 2); const dv = new DataView(d.buffer); pairs.forEach((v, i) => dv.setInt16(i * 2, v)); return { d, o: 0 }; };
  const adsr = (o) => ({ action: 0, state: 1, delay: 0, envIndex: 0, sustain: 0, current: 0, target: 0, velocity: 0, fadeOutVel: 0, ...o });
  it('adsrUpdate walks fades, gotos, restarts, hangs and disables', () => {
    const m = mk();
    const a = adsr({ env: env(2, 0x7fff, -4, 0, -2, 4, 0, 0, -3, 0) });
    expect(m.adsrUpdate(a)).toBeCloseTo(0.5, 5);
    expect(m.adsrUpdate(a)).toBeCloseTo(1, 5);
    expect(m.adsrUpdate(a)).toBeCloseTo(0, 5);
    expect(m.adsrUpdate(a)).toBe(0);
    expect(a.state).toBe(1);                   // -3: back to INITIAL
    const h = adsr({ env: env(-1, 0) });
    m.adsrUpdate(h); expect(h.state).toBe(5);  // HANG
    m.adsrUpdate(h); expect(h.state).toBe(5);
    const z = adsr({ env: env(0, 0) });
    m.adsrUpdate(z); expect(z.state).toBe(0);
    expect(m.adsrUpdate(z)).toBe(0);
    const hang = adsr({ action: 0x40, env: env(0, 0) });
    m.adsrUpdate(hang); expect(hang.state).toBe(5);
  });
  it('decay into sustain, sustain into release, release to silence; release/decay actions', () => {
    const m = mk();
    const a = adsr({ state: 6, current: 0.5, fadeOutVel: 0.2, sustain: 0.4 });
    expect(m.adsrUpdate(a)).toBeCloseTo(0.4, 5);
    expect(a.state).toBe(8); expect(a.delay).toBe(128);
    a.delay = 2; m.adsrUpdate(a); expect(a.state).toBe(8);
    m.adsrUpdate(a); expect(a.state).toBe(7);
    a.current = 0.1;
    expect(m.adsrUpdate(a)).toBe(0); expect(a.state).toBe(0);
    const r = adsr({ state: 5, current: 0.5, action: 0x10 });
    m.adsrUpdate(r); expect(r.state).toBe(7); expect(r.action).toBe(0);
    const d = adsr({ state: 5, current: 0.5, action: 0x20 });
    m.adsrUpdate(d); expect(d.state).toBe(6); expect(d.action).toBe(0);
  });
  it('vibratoScale ramps extent and rate and honours its delay', () => {
    const m = mk();
    const c = { vibExtTarget: 100, vibExtDelay: 0, vibRateTarget: 0x800, vibRateDelay: 0 };
    const n = { vib: { time: 0, extentTimer: 2, extent: 0, rateTimer: 2, rate: 0, delay: 1, chan: c } };
    expect(m.vibratoScale(n)).toBe(1); expect(n.vib.delay).toBe(0);
    expect(Number.isFinite(m.vibratoScale(n))).toBe(true);
    expect(n.vib.extent).toBe(50); expect(n.vib.rate).toBe(0x400);
    m.vibratoScale(n);
    expect(n.vib.extent).toBe(100); expect(n.vib.rate).toBe(0x800);
    c.vibExtTarget = 200; c.vibRateTarget = 0x400; c.vibRateDelay = 3;
    const v = m.vibratoScale(n);
    expect(n.vib.extent).toBe(200); expect(n.vib.rateTimer).toBe(3);
    expect(v).not.toBe(1);
    c.vibExtTarget = 0; c.vibExtDelay = 0;
    expect(m.vibratoScale(n)).toBe(1);
  });
  const layer = (o = {}) => ({ enabled: true, status: 1, noteFreqScale: 1, noteVelocity: 0.5, notePan: 64, adsr: { releaseRate: 0 },
    chan: { reverbVol: 0, adsr: { releaseRate: 8, sustain: 0 }, player: { enabled: true } }, ...o });
  const note = (l, o = {}) => ({ layer: l, prevLayer: null, priority: 3, finished: false, wave: 0, waveLen: 64, pos: 0, volL: 0, volR: 0,
    adsr: adsr({ state: 5, current: 0.5 }), attr: { freq: 0, vel: 0, pan: 64, reverb: 0 }, vibScale: 1, portaScale: 1, ...o });
  it('decayRelease releases a note held by the layer or still remembering it', () => {
    const m = mk();
    const l = layer(), n = note(l); l.note = n;
    m.decayRelease(l, 7);
    expect(n.layer).toBeNull(); expect(n.prevLayer).toBe(l); expect(n.priority).toBe(1);
    expect(n.adsr.fadeOutVel).toBeCloseTo(1 / 3); expect(n.adsr.action & 0x10).toBeTruthy();
    expect(n.attr.vel).toBe(0.5);
    n.adsr.action = 0; n.adsr.fadeOutVel = 0;
    m.decayRelease(l, 7);                      // note already let go, but prevLayer is l
    expect(n.adsr.action & 0x10).toBeTruthy();
    n.adsr.action = 0;
    m.decayRelease(l, 6);                      // a decay request does nothing then
    expect(n.adsr.action).toBe(0);
    m.decayRelease({ note: null }, 6);
  });
  it('processNotes releases notes of disabled layers/players and drops finished ones', () => {
    const m = mk();
    const l1 = layer({ enabled: false }), n1 = note(l1); l1.note = n1;
    const l2 = layer(); l2.chan.player.enabled = false; const n2 = note(l2); l2.note = n2;
    const l3 = layer(), n3 = note(l3, { adsr: adsr({ state: 0 }) }); l3.note = n3;
    m.notes = [n1, n2, n3];
    m.processNotes();
    expect(m.notes).toEqual([n1, n2]);
    expect(l3.note).toBeNull();
    expect(n1.priority).toBe(1); expect(n2.priority).toBe(1);
    expect(n1.adsr.state).toBe(7);
    expect(Number.isFinite(n1.step)).toBe(true);
  });
  it('mix skips notes without a sample and renders synthetic waves', () => {
    const m = mk();
    m.notes = [{ wave: -1, sound: null }];
    const L = new Float32Array(64), R = new Float32Array(64);
    m.mix(L, R, 0, 64);
    expect(peak(L)).toBe(0);
    m.notes = [{ wave: 3, waveLen: 32, pos: 0, step: 0.5, volL: 0.5, volR: 0.5, tL: 0.5, tR: 0.5, tRev: 0.5 }];
    m.mix(L, R, 0, 50);
    expect(peak(L)).toBeGreaterThan(0.1);
    expect(m.notes[0].pos).toBeGreaterThan(0);
  });
});

