// MK64 sequence player + software mixer, ported from n64decomp/mk64 src/audio (seqplayer.c, playback.c,
// effects.c). Plays the ROM's .m64 sequences with its own instruments: ctl/tbl/seq/banksets come from
// tools/extract-sounds.py. No DOM: runs in the AudioWorklet (m64-worklet.js) or in Node for offline renders.
// Timing is the NTSC engine's: 3 audio updates per 60 Hz frame; one tatum when tempoAcc passes
// gTempoInternalToExternal. Envelopes, vibrato and portamento advance once per update like process_notes.
// Assumptions: no note-pool limit or stealing, plain equal-power pan, one comb-filter stand-in for the
// RSP reverb (sReverbSettings[0]: 0x28 x 64-sample window, gain 0x4FFF), linear interpolation.

const N64_RATE = 26800;                          // gAudioSessionPresets[0].frequency
const UPDATES = 180;                             // updatesPerFrame (3) x 60 Hz
const TEMPO_INTERNAL = Math.floor(3 * 2880000 / 48 / 16.713);   // heap.c, NTSC
const RELEASE_SCALE = 0.001171875 / 3;           // unkUpdatesPerFrameScaled
const NOTE_FREQ = Array.from({ length: 128 }, (_, k) => (k < 117 ? 1 : 0.5) * 2 ** ((k - 39) / 12));
const PITCH_BEND = Array.from({ length: 256 }, (_, k) => 0.5 * 2 ** (Math.max(k - 1, 0) / 127));
const VEL_TABLE = [12, 25, 38, 51, 57, 64, 71, 76, 83, 89, 96, 102, 109, 115, 121, 127];
const DUR_TABLE = [229, 203, 177, 151, 139, 126, 113, 100, 87, 74, 61, 48, 36, 23, 10, 0];
const DEFAULT_ENV = { d: new Uint8Array([0, 4, 0x7d, 0, 0x03, 0xe8, 0x7d, 0, 0xff, 0xff, 0, 0]), o: 0 };
const SINE = Array.from({ length: 64 }, (_, i) => Math.round(Math.sin(i / 32 * Math.PI) * 32767));
// gWaveSamples: sawtooth, triangle, sine, square (64-sample cycles)
const WAVES = [
  i => i / 32 - 1, i => (i < 32 ? i / 16 - 1 : 3 - i / 16), i => SINE[i] / 32767, i => (i < 32 ? 1 : -1),
].map(f => Float32Array.from({ length: 64 }, (_, i) => f(i)));
const DISABLED = 0, INITIAL = 1, LOOP = 3, FADE = 4, HANG = 5, DECAY = 6, RELEASE = 7, SUSTAIN = 8;
const ACT_RELEASE = 0x10, ACT_DECAY = 0x20, ACT_HANG = 0x40;
const PRIO_STOPPING = 1, PRIO_MIN = 2;

const be = u8 => new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
const table = (dv, at) => Array.from({ length: dv.getUint16(at + 2) }, (_, i) => [dv.getUint32(at + 4 + 8 * i), dv.getUint32(at + 8 + 8 * i)]);

function vadpcm(tbl, at, size, book, order) {
  const frames = Math.floor(size / 9), out = new Float32Array(frames * 16), ins = new Int32Array(8);
  let h = new Int32Array(8), cur = new Int32Array(8), n = 0;
  for (let f = 0; f < frames; f++) {
    const p = at + f * 9, hdr = tbl[p], scale = 1 << (hdr >> 4), c = book[hdr & 15];
    for (let half = 0; half < 2; half++) {
      for (let i = 0; i < 4; i++) {
        const b = tbl[p + 1 + half * 4 + i], hi = b >> 4, lo = b & 15;
        ins[2 * i] = (hi >= 8 ? hi - 16 : hi) * scale; ins[2 * i + 1] = (lo >= 8 ? lo - 16 : lo) * scale;
      }
      for (let i = 0; i < 8; i++) {
        let acc = ins[i] * 2048;
        for (let k = 0; k < order; k++) acc += c[k][i] * h[8 - order + k];
        for (let j = 0; j < i; j++) acc += c[order - 1][i - 1 - j] * ins[j];
        const v = Math.max(-32768, Math.min(32767, acc >> 11));
        cur[i] = v; out[n++] = v / 32768;
      }
      [h, cur] = [cur, h];
    }
  }
  return out;
}

export class M64 {
  constructor({ ctl, tbl, seq, banksets }, outRate) {
    this.ctl = new Uint8Array(ctl); this.tbl = new Uint8Array(tbl);
    this.seq = new Uint8Array(seq); this.sets = new Uint8Array(banksets);
    this.cdv = be(this.ctl); this.sdv = be(this.seq);
    this.ctlTab = table(this.cdv, 0); this.tblTab = table(be(this.tbl), 0); this.seqTab = table(this.sdv, 0);
    this.outRate = outRate;
    this.banks = []; this.samples = new Map();
    this.players = Array.from({ length: 4 }, () => ({ enabled: false, channels: [] }));
    this.notes = [];
    this.updateFrac = 0; this.left = 0;
    this.master = 0.6;
    const rv = Math.round(0x28 * 64 * outRate / N64_RATE);
    this.rvBuf = [new Float32Array(rv), new Float32Array(rv)]; this.rvPos = 0; this.rvGain = 0x4fff / 0x8000;
  }

  // ---------- banks / samples (load.c patch_audio_bank) ----------
  bank(id) {
    if (this.banks[id]) return this.banks[id];
    const dv = this.cdv, [off] = this.ctlTab[id], base = off + 0x10;
    let [toff, tlen] = this.tblTab[id];
    if (tlen === 0) toff = this.tblTab[toff][0];
    const nInst = dv.getUint32(off), nDrums = dv.getUint32(off + 4);
    const env = p => ({ d: this.ctl, o: base + p });
    const sound = o => {
      const sp = dv.getUint32(o);
      return sp ? { sample: this.sample(base, base + sp, toff), tuning: dv.getFloat32(o + 4) } : null;
    };
    const insts = [];
    for (let i = 0; i < nInst; i++) {
      const p = dv.getUint32(base + 4 + 4 * i);
      if (!p) { insts.push(null); continue; }
      const o = base + p;
      insts.push({ lo: this.ctl[o + 1], hi: this.ctl[o + 2], releaseRate: this.ctl[o + 3], env: env(dv.getUint32(o + 4)),
        sounds: [sound(o + 8), sound(o + 16), sound(o + 24)] });
    }
    const drums = [], dp = dv.getUint32(base);
    for (let i = 0; dp && i < nDrums; i++) {
      const p = dv.getUint32(base + dp + 4 * i);
      if (!p) { drums.push(null); continue; }
      const o = base + p;
      drums.push({ releaseRate: this.ctl[o], pan: this.ctl[o + 1], sound: sound(o + 4), env: env(dv.getUint32(o + 12)) });
    }
    return (this.banks[id] = { insts, drums });
  }
  sample(base, o, toff) {
    if (this.samples.has(o)) return this.samples.get(o);
    const dv = this.cdv;
    const addr = dv.getUint32(o + 4), loopP = base + dv.getUint32(o + 8), bookP = base + dv.getUint32(o + 12), size = dv.getUint32(o + 16);
    const order = dv.getInt32(bookP), npred = dv.getInt32(bookP + 4), book = [];
    for (let p = 0; p < npred; p++) {
      book.push([]);
      for (let k = 0; k < order; k++) book[p].push(Array.from({ length: 8 }, (_, i) => dv.getInt16(bookP + 8 + ((p * order + k) * 8 + i) * 2)));
    }
    const pcm = vadpcm(this.tbl, toff + addr, size, book, order);
    const start = dv.getUint32(loopP), end = Math.min(dv.getUint32(loopP + 4), pcm.length), count = dv.getUint32(loopP + 8);
    const s = { pcm, loopStart: start, end: count ? end : pcm.length, loops: count !== 0 && end > start };
    this.samples.set(o, s);
    return s;
  }
  banksFor(seqId) {
    const off = (this.sets[seqId * 2] << 8) | this.sets[seqId * 2 + 1], n = this.sets[off];
    return Array.from({ length: n }, (_, i) => this.sets[off + 1 + i]);
  }

  // ---------- commands ----------
  play(player, seqId) {
    let [off, len] = this.seqTab[seqId];
    if (len === 0) [off, len] = this.seqTab[off];
    const banks = this.banksFor(seqId);
    banks.forEach(b => this.bank(b));
    const p = this.players[player];
    this.disablePlayer(p);
    Object.assign(p, {
      enabled: true, seqId, data: this.seq.subarray(off, off + len), defaultBank: banks[banks.length - 1],
      st: { pc: 0, stack: [], rem: [], depth: 0 }, delay: 0, state: 1, fadeRemaining: 0, fadeTimer: 0, tempoAcc: 0,
      tempo: 120 * 48, transposition: 0, velTable: VEL_TABLE, durTable: DUR_TABLE,
      fadeVolume: 1, fadeVolumeScale: 1, fadeVelocity: 0, applied: 1, recalc: true, channels: [], variation: -1,
    });
  }
  stop(player, frames = 0) {
    const p = this.players[player];
    if (!p.enabled) return;
    if (!frames) return this.disablePlayer(p);
    p.state = 2; p.fadeRemaining = frames * 3; p.fadeVelocity = -p.fadeVolume / p.fadeRemaining;
  }
  // Sound effect: sequence 0 runs on player 2 with one channel per bank slot; external.c func_800C4FE4 starts
  // a sound by writing io[3] = volume, io[0] = 1, io[4] = sound id to the bank's next channel.
  // Slots per bank are D_800EA188[0] (1P): 4, 2, 2, 2, 2, 1.
  sfx(bank, id) {
    const p = this.players[2];
    if (!p.enabled || p.seqId !== 0) this.play(2, 0);
    const slots = [4, 2, 2, 2, 2, 1], base = slots.slice(0, bank).reduce((a, b) => a + b, 0);
    this.sfxNext = this.sfxNext || [];
    const i = this.sfxNext[bank] = ((this.sfxNext[bank] ?? -1) + 1) % slots[bank];
    (this.sfxQueue = this.sfxQueue || []).push([base + i, id]);
  }

  // ---------- sequence player (seqplayer.c) ----------
  disablePlayer(p) {
    for (const c of p.channels) if (c) this.disableChannel(c);
    p.channels = []; p.enabled = false;
  }
  initChannel(p, i) {
    if (p.channels[i]) this.disableChannel(p.channels[i]);
    p.channels[i] = {
      player: p, enabled: false, finished: false, stopScript: false, hasInstrument: false, transposition: 0, largeNotes: false,
      changes: 0xff, newPan: 0x40, panWeight: 0x80, pan: 0, reverbVol: 0, notePriority: 3, delay: 0,
      adsr: { env: DEFAULT_ENV, releaseRate: 0x20, sustain: 0 }, vibRateTarget: 0x800, vibRateStart: 0x800, vibExtTarget: 0,
      vibExtStart: 0, vibRateDelay: 0, vibExtDelay: 0, vibDelay: 0, volume: 1, volumeScale: 1, freqScale: 1, appliedVolume: 1,
      io: new Int8Array(8).fill(-1), layers: [null, null, null, null], bankId: p.defaultBank, instOrWave: 0, instrument: null,
      st: { pc: 0, stack: [], rem: [], depth: 0 }, dynTable: 0,
    };
  }
  disableChannel(c) {
    for (let i = 0; i < 4; i++) this.freeLayer(c, i);
    c.enabled = false; c.finished = true;
  }
  enableChannel(p, i, pc) {
    const c = p.channels[i];
    if (!c) return;
    c.enabled = true; c.finished = false; c.st = { pc, stack: [], rem: [], depth: 0 }; c.delay = 0;
    for (let l = 0; l < 4; l++) this.freeLayer(c, l);
  }
  setLayer(c, i) {
    if (c.layers[i]) this.noteDecay(c.layers[i]);
    else c.layers[i] = {};
    Object.assign(c.layers[i], {
      chan: c, adsr: { ...c.adsr, releaseRate: 0 }, enabled: true, stopSomething: false, continuous: false, finished: false,
      ignoreDrumPan: false, porta: { mode: 0, cur: 0, speed: 0, extent: 0 }, portaTarget: 0, portaTime: 0,
      st: { pc: 0, stack: [], rem: [], depth: 0 }, status: 0, noteDuration: 0x80, pan: 0x40, transposition: 0, delay: 0,
      duration: 0, note: null, instrument: null, freqScale: 1, velocitySquare: 0, instOrWave: 0xff, sound: null,
      playPercentage: 0, defaultPlayPercentage: 0, propsInit: true, noteFreqScale: 1, noteVelocity: 0, notePan: 0x40,
    });
    return c.layers[i];
  }
  freeLayer(c, i) {
    const l = c.layers[i];
    if (!l) return;
    this.noteDecay(l); l.enabled = false; l.finished = true;
    c.layers[i] = null;
  }
  instrument(c, id) {
    const b = this.bank(c.bankId);
    return id < b.insts.length ? b.insts[id] : null;
  }
  bankFromSet(p, cmd) {
    const off = (this.sets[p.seqId * 2] << 8) | this.sets[p.seqId * 2 + 1];
    return this.sets[off + this.sets[off] - cmd];
  }

  processSequence(p) {
    p.tempoAcc += p.tempo;
    if (p.tempoAcc < TEMPO_INTERNAL) return;
    p.tempoAcc -= TEMPO_INTERNAL;
    const d = p.data, st = p.st;
    const u8 = () => d[st.pc++], s16 = () => { const v = (d[st.pc] << 8) | d[st.pc + 1]; st.pc += 2; return v; };
    const var16 = () => { let v = d[st.pc++]; if (v & 0x80) v = ((v << 8) & 0x7f00) | d[st.pc++]; return v; };
    let value = 0;
    if (p.delay > 1) p.delay--;
    else {
      p.recalc = true;
      for (;;) {
        const cmd = u8();
        if (cmd === 0xff) {
          if (st.depth === 0) { this.disablePlayer(p); return; }
          st.pc = st.stack[--st.depth];
        }
        if (cmd === 0xfd) { p.delay = var16(); break; }
        if (cmd === 0xfe) { p.delay = 1; break; }
        if (cmd >= 0xc0) {
          switch (cmd) {
            case 0xfc: { const t = s16(); st.stack[st.depth++] = st.pc; st.pc = t; break; }
            case 0xf8: st.rem[st.depth] = u8(); st.stack[st.depth++] = st.pc; break;
            case 0xf7: if (--st.rem[st.depth - 1] & 0xff) st.pc = st.stack[st.depth - 1]; else st.depth--; break;
            case 0xfb: case 0xfa: case 0xf9: case 0xf5: {
              const t = s16();
              if ((cmd === 0xfa && value !== 0) || (cmd === 0xf9 && value >= 0) || (cmd === 0xf5 && value < 0)) break;
              st.pc = t; break;
            }
            case 0xf4: case 0xf3: case 0xf2: {
              const t = (u8() << 24) >> 24;
              if ((cmd === 0xf3 && value !== 0) || (cmd === 0xf2 && value >= 0)) break;
              st.pc += t; break;
            }
            case 0xf1: u8(); break;
            case 0xdf: p.transposition = 0; // fallthrough
            case 0xde: p.transposition += (u8() << 24) >> 24; break;
            case 0xdd: case 0xdc: {
              const t = u8();
              p.tempo = cmd === 0xdd ? t * 48 : p.tempo + ((t << 24) >> 24) * 48;
              if (p.tempo > TEMPO_INTERNAL) p.tempo = TEMPO_INTERNAL;
              if (p.tempo <= 0) p.tempo = 1;
              break;
            }
            case 0xda: {
              const s = u8(), t = s16();
              if (s === 0 || s === 1) { if (p.state !== 2) { p.fadeTimer = t; p.state = s; } }
              else if (s === 2) { p.fadeRemaining = t; p.state = s; p.fadeVelocity = -p.fadeVolume / t; }
              break;
            }
            case 0xdb: {
              const v = u8();
              if (p.state === 2) break;
              if (p.state === 1) { p.state = 0; p.fadeVolume = 0; }
              p.fadeRemaining = p.fadeTimer;
              if (p.fadeTimer) p.fadeVelocity = (v / 127 - p.fadeVolume) / p.fadeRemaining;
              else p.fadeVolume = v / 127;
              break;
            }
            case 0xd9: p.fadeVolumeScale = ((u8() << 24) >> 24) / 127; break;
            case 0xd7: { const bits = s16(); for (let i = 0; i < 16; i++) if (bits & (1 << i)) this.initChannel(p, i); break; }
            case 0xd6: { const bits = s16(); for (let i = 0; i < 16; i++) if (bits & (1 << i) && p.channels[i]) { this.disableChannel(p.channels[i]); p.channels[i] = null; } break; }
            case 0xd5: case 0xd3: case 0xd0: u8(); break;
            case 0xd2: case 0xd1: {
              const t = s16(), tab = Array.from(d.subarray(t, t + 16));
              if (cmd === 0xd2) p.velTable = tab; else p.durTable = tab;
              break;
            }
            case 0xcc: value = u8(); break;
            case 0xc9: value &= u8(); break;
            case 0xc8: value -= u8(); break;
            default: break;
          }
        } else {
          const lo = cmd & 15;
          switch (cmd & 0xf0) {
            case 0x00: value = p.channels[lo] ? +p.channels[lo].finished : 1; break;
            case 0x50: value -= p.variation; break;
            case 0x70: p.variation = value; break;
            case 0x80: value = p.variation; break;
            case 0x90: { const t = s16(); this.enableChannel(p, lo, t); break; }
            default: break;
          }
        }
      }
    }
    for (const c of p.channels) if (c && c.enabled) this.processChannel(c);
  }

  processChannel(c) {
    const p = c.player, d = p.data;
    if (c.stopScript) { for (const l of c.layers) if (l) this.processLayer(l); return; }
    if (c.delay) c.delay--;
    const st = c.st;
    const u8 = () => d[st.pc++], s16 = () => { const v = (d[st.pc] << 8) | d[st.pc + 1]; st.pc += 2; return v; };
    const var16 = () => { let v = d[st.pc++]; if (v & 0x80) v = ((v << 8) & 0x7f00) | d[st.pc++]; return v; };
    const s8 = v => (v << 24) >> 24;
    const dyn = i => (d[c.dynTable + 2 * i] << 8) | d[c.dynTable + 2 * i + 1];
    let value = 0;
    out: if (c.delay === 0) {
      for (;;) {
        const cmd = u8();
        if (cmd > 0xc0) {
          switch (cmd) {
            case 0xff:
              if (st.depth === 0) { this.disableChannel(c); break out; }
              st.pc = st.stack[--st.depth]; break;
            case 0xfe: break out;
            case 0xfd: c.delay = var16(); break out;
            case 0xea: c.stopScript = true; break out;
            case 0xfc: { const t = s16(); st.stack[st.depth++] = st.pc; st.pc = t; break; }
            case 0xf8: st.rem[st.depth] = u8(); st.stack[st.depth++] = st.pc; break;
            case 0xf7: if (--st.rem[st.depth - 1] & 0xff) st.pc = st.stack[st.depth - 1]; else st.depth--; break;
            case 0xf6: st.depth--; break;
            case 0xf5: case 0xf9: case 0xfa: case 0xfb: {
              const t = s16();
              if ((cmd === 0xfa && value !== 0) || (cmd === 0xf9 && value >= 0) || (cmd === 0xf5 && value < 0)) break;
              st.pc = t; break;
            }
            case 0xf2: case 0xf3: case 0xf4: {
              const t = s8(u8());
              if ((cmd === 0xf3 && value !== 0) || (cmd === 0xf2 && value >= 0)) break;
              st.pc += t; break;
            }
            case 0xf1: u8(); break;
            case 0xf0: break;
            case 0xc2: c.dynTable = s16(); break;
            case 0xc5: if (value !== -1) c.dynTable = dyn(value); break;
            case 0xeb: { const b = this.bankFromSet(p, u8()); if (b < this.ctlTab.length) { this.bank(b); c.bankId = b; } } // fallthrough
            case 0xc1: this.setInstrument(c, u8()); break;
            case 0xc3: c.largeNotes = false; break;
            case 0xc4: c.largeNotes = true; break;
            case 0xdf: c.volume = u8() / 127; c.changes |= 1; break;
            case 0xe0: c.volumeScale = u8() / 128; c.changes |= 1; break;
            case 0xde: c.freqScale = s16() / 32768; c.changes |= 2; break;
            case 0xd3: c.freqScale = PITCH_BEND[(u8() + 127) & 0xff]; c.changes |= 2; break;
            case 0xdd: c.newPan = u8(); c.changes |= 4; break;
            case 0xdc: c.panWeight = u8(); c.changes |= 4; break;
            case 0xdb: c.transposition = s8(u8()); break;
            case 0xda: c.adsr.env = { d, o: s16() }; break;
            case 0xd9: c.adsr.releaseRate = u8(); break;
            case 0xd8: c.vibExtTarget = u8() * 8; c.vibExtStart = 0; c.vibExtDelay = 0; break;
            case 0xd7: c.vibRateStart = c.vibRateTarget = u8() * 32; c.vibRateDelay = 0; break;
            case 0xe2: c.vibExtStart = u8() * 8; c.vibExtTarget = u8() * 8; c.vibExtDelay = u8() * 16; break;
            case 0xe1: c.vibRateStart = u8() * 32; c.vibRateTarget = u8() * 32; c.vibRateDelay = u8() * 16; break;
            case 0xe3: c.vibDelay = u8() * 16; break;
            case 0xd4: c.reverbVol = u8(); break;
            case 0xc6: { const b = this.bankFromSet(p, u8()); if (b < this.ctlTab.length) { this.bank(b); c.bankId = b; } break; }
            case 0xc7: { const add = u8(), t = s16(); d[t] = (value + add) & 0xff; break; }
            case 0xc8: value = s8(value - u8()); break;
            case 0xc9: value = s8(value & u8()); break;
            case 0xcc: value = s8(u8()); break;
            case 0xca: u8(); break;
            case 0xcb: { const t = s16() + value; value = s8(d[t & 0xffff]); break; }
            case 0xd0: case 0xd1: case 0xe5: case 0xe6: case 0xe9: u8(); break;
            case 0xd2: c.adsr.sustain = u8(); break;
            case 0xe4:
              if (value !== -1) { const t = dyn(value); st.stack[st.depth++] = st.pc; st.pc = t; }
              break;
            case 0xe7: {
              const t = s16();
              c.notePriority = d[t + 2]; c.transposition = s8(d[t + 3]); c.newPan = d[t + 4]; c.panWeight = d[t + 5];
              c.reverbVol = d[t + 6]; c.changes |= 4; break;
            }
            case 0xe8: {
              u8(); u8(); c.notePriority = u8(); c.transposition = s8(u8()); c.newPan = u8(); c.panWeight = u8();
              c.reverbVol = u8(); u8(); c.changes |= 4; break;
            }
            case 0xec:
              c.vibExtTarget = c.vibExtStart = c.vibExtDelay = c.vibRateTarget = c.vibRateStart = c.vibRateDelay = 0;
              c.freqScale = 1; break;
            case 0xef: s16(); u8(); break;
            default: break;
          }
        } else {
          const lo = cmd & 15;
          switch (cmd & 0xf0) {
            case 0x00: value = c.layers[lo] ? +c.layers[lo].finished : -1; break;
            case 0x70: c.io[lo] = value; break;
            case 0x80: value = c.io[lo]; if (lo < 4) c.io[lo] = -1; break;
            case 0x50: value = s8(value - c.io[lo]); break;
            case 0x60: c.delay = lo; break out;
            case 0x90: { const t = s16(); this.setLayer(c, lo).st.pc = t; break; }
            case 0xa0: this.freeLayer(c, lo); break;
            case 0xb0: if (value !== -1) this.setLayer(c, lo).st.pc = dyn(value); break;
            case 0x10: { const t = s16(); this.enableChannel(p, lo, t); break; }
            case 0x20: if (p.channels[lo]) this.disableChannel(p.channels[lo]); break;
            case 0x30: { const i = u8(); if (p.channels[lo]) p.channels[lo].io[i] = value; break; }
            case 0x40: { const i = u8(); value = p.channels[lo] ? p.channels[lo].io[i] : -1; break; }
            default: break;
          }
        }
      }
    }
    for (const l of c.layers) if (l) this.processLayer(l);
  }

  setInstrument(c, id) {
    if (id >= 0x80) { c.instOrWave = id; c.instrument = null; }
    else if (id === 0x7f) { c.instOrWave = 0; c.instrument = 1; }
    else {
      const inst = this.instrument(c, id);
      if (!inst) { c.instOrWave = 0; c.hasInstrument = false; return; }
      c.instrument = inst; c.instOrWave = id + 1;
      c.adsr.env = inst.env; c.adsr.releaseRate = inst.releaseRate;
    }
    c.hasInstrument = true;
  }

  processLayer(l) {
    if (!l.enabled) return;
    if (l.delay > 1) {
      l.delay--;
      if (!l.stopSomething && l.delay <= l.duration) { this.noteDecay(l); l.stopSomething = true; }
      return;
    }
    if (!l.continuous) this.noteDecay(l);
    const pm = l.porta.mode & 0x7f;
    if (pm === 1 || pm === 2) l.porta.mode = 0;
    const c = l.chan, p = c.player, d = p.data, st = l.st;
    const u8 = () => d[st.pc++], s16 = () => { const v = (d[st.pc] << 8) | d[st.pc + 1]; st.pc += 2; return v; };
    const var16 = () => { let v = d[st.pc++]; if (v & 0x80) v = ((v << 8) & 0x7f00) | d[st.pc++]; return v; };
    l.propsInit = true;
    let cmd, sameSound = true;
    for (;;) {
      cmd = u8();
      if (cmd <= 0xc0) break;
      switch (cmd) {
        case 0xff:
          if (st.depth === 0) { this.noteDecay(l); l.enabled = false; l.finished = true; return; }
          st.pc = st.stack[--st.depth]; break;
        case 0xfc: { const t = s16(); st.stack[st.depth++] = st.pc; st.pc = t; break; }
        case 0xf8: st.rem[st.depth] = u8(); st.stack[st.depth++] = st.pc; break;
        case 0xf7: if (--st.rem[st.depth - 1] & 0xff) st.pc = st.stack[st.depth - 1]; else st.depth--; break;
        case 0xfb: st.pc = s16(); break;
        case 0xf4: { const t = (u8() << 24) >> 24; st.pc += t; break; }
        case 0xc1: { const v = u8(); l.velocitySquare = v * v / 16129; break; }
        case 0xca: l.pan = u8(); break;
        case 0xc2: l.transposition = (u8() << 24) >> 24; break;
        case 0xc9: l.noteDuration = u8(); break;
        case 0xc4: case 0xc5: l.continuous = cmd === 0xc4; this.noteDecay(l); break;
        case 0xc3: l.defaultPlayPercentage = var16(); break;
        case 0xc6: {
          const id = u8();
          if (id >= 0x7f) {
            if (id === 0x7f) l.instOrWave = 0; else { l.instOrWave = id; l.instrument = null; }
            if (id === 0xff) l.adsr.releaseRate = 0;
            break;
          }
          const inst = this.instrument(c, id);
          if (inst) { l.instrument = inst; l.instOrWave = id + 1; l.adsr.env = inst.env; l.adsr.releaseRate = inst.releaseRate; }
          else { l.instrument = null; l.instOrWave = 0xff; }
          break;
        }
        case 0xc7: {
          l.porta.mode = u8();
          let n = (u8() + c.transposition + l.transposition + p.transposition) & 0xff;
          if (n >= 0x80) n = 0;
          l.portaTarget = n;
          l.portaTime = l.porta.mode & 0x80 ? u8() : var16();
          break;
        }
        case 0xc8: l.porta.mode = 0; break;
        case 0xcb: l.adsr.env = { d, o: s16() }; l.adsr.releaseRate = u8(); break;
        case 0xcc: l.ignoreDrumPan = true; break;
        default:
          if ((cmd & 0xf0) === 0xd0) { const v = p.velTable[cmd & 15]; l.velocitySquare = v * v / 16129; }
          else if ((cmd & 0xf0) === 0xe0) l.noteDuration = p.durTable[cmd & 15];
      }
    }
    if (cmd === 0xc0) { l.delay = var16(); l.stopSomething = true; }
    else {
      l.stopSomething = false;
      let pct;
      if (c.largeNotes) {
        let vel;
        switch (cmd & 0xc0) {
          case 0x00: pct = var16(); vel = u8(); l.noteDuration = u8(); l.playPercentage = pct; break;
          case 0x40: pct = var16(); vel = u8(); l.noteDuration = 0; l.playPercentage = pct; break;
          default: pct = l.playPercentage; vel = u8(); l.noteDuration = u8(); break;
        }
        if (vel >= 0x80) vel = 127;
        l.velocitySquare = vel * vel / 16129;
      } else {
        switch (cmd & 0xc0) {
          case 0x00: pct = var16(); l.playPercentage = pct; break;
          case 0x40: pct = l.defaultPlayPercentage; break;
          default: pct = l.playPercentage; break;
        }
      }
      let semi = cmd & 0x3f;
      l.delay = pct;
      l.duration = (l.noteDuration * pct) >> 8;
      let w = l.instOrWave;
      if (w === 0xff) {
        if (!c.hasInstrument) return;
        w = c.instOrWave;
      }
      if (w === 0) {
        semi += c.transposition + l.transposition;
        const b = this.bank(c.bankId), drum = semi >= 0 && semi < b.drums.length ? b.drums[semi] : null;
        if (!drum || !drum.sound) { l.stopSomething = true; return; }
        l.adsr.env = drum.env; l.adsr.releaseRate = drum.releaseRate;
        if (!l.ignoreDrumPan) l.pan = drum.pan;
        l.sound = drum.sound; l.freqScale = drum.sound.tuning;
      } else {
        semi += p.transposition + c.transposition + l.transposition;
        if (semi < 0 || semi >= 0x80) l.stopSomething = true;
        else {
          const inst = l.instOrWave === 0xff ? c.instrument : l.instrument;
          const pick = (k) => {
            if (!inst || inst === 1) return null;
            return inst.sounds[k < inst.lo ? 0 : k <= inst.hi ? 1 : 2];
          };
          if (l.porta.mode !== 0) {
            const top = Math.max(semi, l.portaTarget), snd = pick(top);
            sameSound = snd === l.sound; l.sound = snd;
            const tuning = snd ? snd.tuning : 1;
            const f2 = NOTE_FREQ[semi] * tuning, f12 = NOTE_FREQ[l.portaTarget] * tuning;
            const mode = l.porta.mode & 0x7f, fs = mode === 1 || mode === 3 || mode === 5 ? f12 : f2;
            l.porta.extent = f2 / fs - 1;
            l.porta.speed = l.porta.mode & 0x80
              ? 32512 * p.tempo / (l.delay * TEMPO_INTERNAL * l.portaTime)
              : 127 / l.portaTime;
            l.porta.cur = 0;
            l.freqScale = fs;
            if (mode === 5) l.portaTarget = semi;
          } else {
            const snd = pick(semi);
            sameSound = snd === l.sound; l.sound = snd;
            l.freqScale = NOTE_FREQ[semi] * (snd ? snd.tuning : 1);
          }
          if (inst && inst !== 1 && !l.sound) l.stopSomething = true;
        }
      }
    }
    if (l.stopSomething) { if (l.note || l.continuous) this.noteDecay(l); return; }
    let fresh = false;
    if (!l.continuous || !l.note || l.status === 0) fresh = true;
    else if (!sameSound) { this.noteDecay(l); fresh = true; }
    else if (l !== l.note.layer) fresh = true;
    if (fresh) l.note = this.allocNote(l);
    if (l.note && l.note.layer === l) this.vibratoInit(l.note);
  }

  // ---------- notes (playback.c / effects.c) ----------
  allocNote(l) {
    const c = l.chan;
    const n = {
      layer: l, prevLayer: null, priority: c.notePriority, finished: false, pos: 0, wave: -1, waveLen: 64,
      adsr: { action: 0, state: INITIAL, delay: 0, env: l.adsr.releaseRate === 0 ? c.adsr.env : l.adsr.env, envIndex: 0,
        sustain: 0, current: 0, target: 0, velocity: 0, fadeOutVel: 0 },
      attr: { freq: 0, vel: 0, pan: 64, reverb: 0 }, sound: l.sound, volL: 0, volR: 0, vib: null, porta: null,
      vibScale: 1, portaScale: 1,
    };
    l.propsInit = true; l.status = 1; l.noteVelocity = 0;
    let w = l.instOrWave;
    if (w === 0xff) w = c.instOrWave;
    if (w >= 0x80) this.syntheticWave(n, l, w);
    this.notes.push(n);
    return n;
  }
  syntheticWave(n, l, waveId) {
    let fs = l.freqScale;
    if (l.porta.mode !== 0 && l.porta.extent > 0) fs *= l.porta.extent + 1;
    const [idx, ratio] = fs < 1 ? [0, 1.0465] : fs < 2 ? [1, 0.52325] : fs < 4 ? [2, 0.26263] : [3, 0.13081];
    l.freqScale *= ratio;
    n.wave = Math.min(waveId - 0x80, WAVES.length - 1); n.waveLen = 64 >> idx;
  }
  vibratoInit(n) {
    const c = n.layer.chan;
    n.vibScale = 1; n.portaScale = 1;
    n.vib = {
      time: 0, extentTimer: c.vibExtDelay, extent: c.vibExtDelay ? c.vibExtStart : c.vibExtTarget,
      rateTimer: c.vibRateDelay, rate: c.vibRateDelay ? c.vibRateStart : c.vibRateTarget, delay: c.vibDelay, chan: c,
    };
    n.porta = { ...n.layer.porta };
  }
  noteDecay(l) { this.decayRelease(l, DECAY); }
  decayRelease(l, target) {
    const n = l && l.note;
    if (!n) return;
    if (n.layer !== l) {
      if (!n.layer && n.prevLayer === l && target !== DECAY) { n.adsr.fadeOutVel = 1 / 3; n.adsr.action |= ACT_RELEASE; }
      return;
    }
    l.status = 0;
    if (n.adsr.state !== DECAY) {
      n.attr.freq = l.noteFreqScale; n.attr.vel = l.noteVelocity; n.attr.pan = l.notePan; n.attr.reverb = l.chan.reverbVol;
      n.priority = PRIO_STOPPING; n.prevLayer = l; n.layer = null;
      if (target === RELEASE) { n.adsr.fadeOutVel = 1 / 3; n.adsr.action |= ACT_RELEASE; }
      else {
        n.adsr.action |= ACT_DECAY;
        n.adsr.fadeOutVel = (l.adsr.releaseRate === 0 ? l.chan.adsr.releaseRate : l.adsr.releaseRate) * RELEASE_SCALE;
        n.adsr.sustain = l.chan.adsr.sustain * n.adsr.current / 256;
      }
    }
  }
  adsrUpdate(a) {
    const action = a.action, state = a.state;
    const entry = i => {
      const e = a.env.d, o = a.env.o + i * 4;
      return [((e[o] << 8) | e[o + 1]) << 16 >> 16, ((e[o + 2] << 8) | e[o + 3]) << 16 >> 16];
    };
    switch (state) {
      case DISABLED: return 0;
      case INITIAL:
        if (action & ACT_HANG) { a.state = HANG; break; }
      // fallthrough
      case 2: a.envIndex = 0; a.state = LOOP;
      // fallthrough
      case LOOP: {
        for (let guard = 0; guard < 64; guard++) {
          const [delay, arg] = entry(a.envIndex);
          if (delay === 0) { a.state = DISABLED; break; }
          if (delay === -1) { a.state = HANG; break; }
          if (delay === -2) { a.envIndex = arg; continue; }
          if (delay === -3) { a.state = INITIAL; break; }
          a.delay = delay >= 4 ? Math.floor(delay * 3 / 4) : delay;
          if (a.delay <= 0) a.delay = 1;
          a.target = (arg / 32767) ** 2;
          a.velocity = (a.target - a.current) / a.delay;
          a.state = FADE; a.envIndex++;
          break;
        }
        if (a.state !== FADE) break;
      }
      // fallthrough
      case FADE:
        a.current += a.velocity;
        if (--a.delay <= 0) a.state = LOOP;
        break;
      case HANG: break;
      case DECAY: case RELEASE:
        a.current -= a.fadeOutVel;
        if (a.sustain !== 0 && state === DECAY) {
          if (a.current < a.sustain) { a.current = a.sustain; a.delay = 128; a.state = SUSTAIN; }
          break;
        }
        if (a.current < 0.00001) { a.current = 0; a.state = DISABLED; }
        break;
      case SUSTAIN:
        if (--a.delay === 0) a.state = RELEASE;
        break;
    }
    if (action & ACT_DECAY) { a.state = DECAY; a.action = action & ~ACT_DECAY; }
    if (action & ACT_RELEASE) { a.state = RELEASE; a.action = action & ~ACT_RELEASE; }
    return Math.max(0, Math.min(1, a.current));
  }
  vibratoScale(n) {
    const v = n.vib, c = v.chan;
    if (v.delay) { v.delay--; return 1; }
    if (v.extentTimer) {
      v.extent = v.extentTimer === 1 ? c.vibExtTarget : v.extent + Math.trunc((c.vibExtTarget - v.extent) / v.extentTimer);
      v.extentTimer--;
    } else if (c.vibExtTarget !== v.extent) {
      if ((v.extentTimer = c.vibExtDelay) === 0) v.extent = c.vibExtTarget;
    }
    if (v.rateTimer) {
      v.rate = v.rateTimer === 1 ? c.vibRateTarget : v.rate + Math.trunc((c.vibRateTarget - v.rate) / v.rateTimer);
      v.rateTimer--;
    } else if (c.vibRateTarget !== v.rate) {
      if ((v.rateTimer = c.vibRateDelay) === 0) v.rate = c.vibRateTarget;
    }
    if (v.extent === 0) return 1;
    v.time += v.rate;
    const pitch = SINE[(v.time >> 10) & 63] >> 8;
    return 1 + v.extent / 4096 * (PITCH_BEND[pitch + 128] - 1);
  }
  processSound(p) {
    if (p.fadeRemaining) {
      p.fadeVolume = Math.max(0, Math.min(1, p.fadeVolume + p.fadeVelocity));
      p.recalc = true;
      if (--p.fadeRemaining === 0 && p.state === 2) { this.disablePlayer(p); return; }
    }
    if (p.recalc) p.applied = p.fadeVolume * p.fadeVolumeScale;
    for (const c of p.channels) {
      if (!c || !c.enabled) continue;
      if ((c.changes & 1) || p.recalc) { const v = c.volume * c.volumeScale * p.applied; c.appliedVolume = v * v; }
      if (c.changes & 4) c.pan = c.newPan * c.panWeight;
      for (const l of c.layers) {
        if (!l || !l.enabled || !l.note) continue;
        if (l.propsInit) {
          l.noteFreqScale = l.freqScale * c.freqScale; l.noteVelocity = l.velocitySquare * c.appliedVolume;
          l.notePan = (c.pan + l.pan * (0x80 - c.panWeight)) >> 7; l.propsInit = false;
        } else {
          if (c.changes & 2) l.noteFreqScale = l.freqScale * c.freqScale;
          if ((c.changes & 1) || p.recalc) l.noteVelocity = l.velocitySquare * c.appliedVolume;
          if (c.changes & 4) l.notePan = (c.pan + l.pan * (0x80 - c.panWeight)) >> 7;
        }
      }
      c.changes = 0;
    }
    p.recalc = false;
  }
  processNotes() {
    const keep = [];
    for (const n of this.notes) {
      const l = n.layer;
      if (l) {
        if (!l.enabled && n.priority >= PRIO_MIN) { this.decayRelease(l, RELEASE); n.priority = PRIO_STOPPING; }
        else if (!l.chan.player.enabled) { this.decayRelease(l, RELEASE); n.priority = PRIO_STOPPING; }
      }
      if (n.priority === PRIO_STOPPING || n.finished) {
        if (n.adsr.state === DISABLED || n.finished) { if (n.layer && n.layer.note === n) n.layer.note = null; continue; }
      } else if (n.adsr.state === DISABLED) { if (n.layer && n.layer.note === n) n.layer.note = null; continue; }
      const scale = this.adsrUpdate(n.adsr);
      if (n.porta && n.porta.mode !== 0) {
        n.porta.cur += n.porta.speed;
        n.portaScale = 1 + n.porta.extent * (PITCH_BEND[Math.min(127, Math.floor(n.porta.cur)) + 128] - 1);
      }
      if (n.vib && n.layer) n.vibScale = this.vibratoScale(n);
      let freq, vel, pan, rev;
      if (n.priority === PRIO_STOPPING) ({ freq, vel, pan, reverb: rev } = n.attr);
      else { freq = n.layer.noteFreqScale; vel = n.layer.noteVelocity; pan = n.layer.notePan; rev = n.layer.chan.reverbVol; }
      n.step = Math.min(freq * n.vibScale * n.portaScale, 3.99992) * N64_RATE / this.outRate;
      const v = vel * scale, a = (pan & 0x7f) / 127 * Math.PI / 2;
      n.tL = v * Math.cos(a); n.tR = v * Math.sin(a); n.tRev = rev / 127;
      keep.push(n);
    }
    this.notes = keep;
  }

  update() {
    const sp = this.players[2];
    if (this.sfxQueue?.length && sp.enabled && sp.channels.length) {
      for (const [ch, id] of this.sfxQueue.splice(0)) {
        const c = sp.channels[ch];
        if (c) { c.io[3] = 127; c.io[0] = 1; c.io[4] = id; }
      }
    }
    for (const p of this.players) if (p.enabled) { this.processSequence(p); if (p.enabled) this.processSound(p); }
    this.processNotes();
  }

  // Mix `len` frames into L/R starting at offset `at`; volumes ramp across the update to avoid zipper noise.
  mix(L, R, at, len) {
    const rl = this.rvBuf[0], rr = this.rvBuf[1], rn = rl.length;
    if (!this.send || this.send[0].length < len) this.send = [new Float32Array(len + 64), new Float32Array(len + 64)];
    const [sl, sr] = this.send;
    sl.fill(0, 0, len); sr.fill(0, 0, len);
    for (const n of this.notes) {
      const s = n.wave < 0 && n.sound ? n.sound.sample : null;
      if (n.wave < 0 && !s) continue;
      const dl = (n.tL - n.volL) / len, dr = (n.tR - n.volR) / len, step = n.step;
      let vl = n.volL, vr = n.volR, pos = n.pos;
      const rv = n.tRev;
      for (let i = 0; i < len; i++) {
        let x;
        if (s) {
          if (pos >= s.end) {
            if (s.loops) pos = s.loopStart + (pos - s.end) % (s.end - s.loopStart);
            else { n.finished = true; break; }
          }
          const ip = pos | 0, fr = pos - ip, pcm = s.pcm;
          const nx = ip + 1 < s.end ? pcm[ip + 1] : s.loops ? pcm[s.loopStart] : 0;
          x = pcm[ip] + (nx - pcm[ip]) * fr;
          pos += step;
        } else {
          const tab = WAVES[n.wave];
          x = tab[(Math.floor(pos) * (64 / n.waveLen)) & 63];
          pos = (pos + step) % n.waveLen;
        }
        vl += dl; vr += dr;
        L[at + i] += x * vl; R[at + i] += x * vr;
        if (rv) { sl[i] += x * vl * rv; sr[i] += x * vr * rv; }
      }
      n.pos = pos; n.volL = n.tL; n.volR = n.tR;
    }
    // comb echo: what was sent one window ago comes back, and keeps feeding back at rvGain
    for (let i = 0; i < len; i++) {
      const k = (this.rvPos + i) % rn, el = rl[k], er = rr[k];
      L[at + i] = (L[at + i] + el * 0.5) * this.master; R[at + i] = (R[at + i] + er * 0.5) * this.master;
      rl[k] = el * this.rvGain + sl[i]; rr[k] = er * this.rvGain + sr[i];
    }
    this.rvPos = (this.rvPos + len) % rn;
  }

  render(L, R) {
    L.fill(0); R.fill(0);
    let at = 0;
    while (at < L.length) {
      if (this.left <= 0) {
        this.update();
        this.updateFrac += this.outRate / UPDATES;
        this.left = Math.floor(this.updateFrac); this.updateFrac -= this.left;
      }
      const len = Math.min(this.left, L.length - at);
      this.mix(L, R, at, len);
      at += len; this.left -= len;
    }
  }
}
