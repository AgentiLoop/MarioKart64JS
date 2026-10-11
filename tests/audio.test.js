import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { AudioSys } from '../src/audio.js';
import { flush } from './helpers.js';

const param = () => ({ value: 0, setTargetAtTime: vi.fn(), setValueAtTime: vi.fn(), exponentialRampToValueAtTime: vi.fn() });
const node = () => ({ connect: vi.fn(), start: vi.fn(), stop: vi.fn(), gain: param(), frequency: param(), Q: param(), type: '' });

// the sequencer loads its ROM data through (real, file-backed) fetches: wait for that, then for the posted messages
const settle = async a => { await flush(); await a.seqNode; await flush(); };

let ctxs, workletPosts;
class FakeCtx {
  constructor() {
    this.state = 'suspended'; this.currentTime = 1; this.sampleRate = 100;
    this.destination = { channelCount: 2, maxChannelCount: 6 };
    this.resume = vi.fn(async () => { this.state = 'running'; });
    this.audioWorklet = { addModule: vi.fn(async () => {}) };
    ctxs.push(this);
  }
  createGain() { return node(); }
  createOscillator() { return node(); }
  createBiquadFilter() { return node(); }
  createBuffer(ch, len) { const d = new Float32Array(len); return { getChannelData: () => d }; }
  createBufferSource() { return node(); }
  decodeAudioData = vi.fn(async b => ({ decoded: b }));
}
class FakeWorkletNode {
  constructor() { this.port = { postMessage: (m) => workletPosts.push(m) }; this.connect = vi.fn(); }
}

beforeEach(() => {
  ctxs = []; workletPosts = [];
  localStorage.clear();
  window.AudioContext = FakeCtx;
  globalThis.AudioWorkletNode = FakeWorkletNode;
});
afterEach(() => { delete window.AudioContext; delete window.webkitAudioContext; delete globalThis.AudioWorkletNode; });

describe('AudioSys context and sound mode', () => {
  it('init creates the context once, with a quiet master gain', () => {
    const a = new AudioSys();
    const ctx = a.init();
    expect(ctx).toBe(a.ctx);
    expect(a.init()).toBe(ctx);
    expect(ctxs).toHaveLength(1);
    expect(a.master.gain.value).toBe(0.25);
  });
  it('init falls back to webkitAudioContext and returns null without any', () => {
    delete window.AudioContext;
    expect(new AudioSys().init()).toBeNull();
    window.webkitAudioContext = FakeCtx;
    expect(new AudioSys().init()).toBeInstanceOf(FakeCtx);
  });
  it('sound mode is saved and drives the output channel count (mono downmixes)', () => {
    const a = new AudioSys();
    expect(a.soundMode).toBe(0);
    a.setSoundMode(2);                      // no context yet: just saved
    expect(a.soundMode).toBe(2);
    a.init();
    expect(a.ctx.destination.channelCount).toBe(1);
    a.setSoundMode(1);
    expect(a.soundMode).toBe(1);
    expect(a.ctx.destination.channelCount).toBe(2);
    a.ctx.destination.maxChannelCount = 0;
    a.setSoundMode(0);
    expect(a.ctx.destination.channelCount).toBe(2);
  });
});

describe('AudioSys samples and engine', () => {
  it('playSample does nothing without audio support', () => {
    delete window.AudioContext;
    const a = new AudioSys();
    a.playSample('welcome', [[0, 1]]);
    expect(a.samples.welcome).toBeUndefined();
  });
  it('playSample on a running context fetches once, caches and starts a source per hit', async () => {
    const a = new AudioSys();
    a.init().state = 'running';
    a.playSample('welcome', [[0.5, 0.2], [1, 0.4]]);
    await a.samples.welcome; await flush();
    expect(a.ctx.decodeAudioData).toHaveBeenCalledTimes(1);
    a.playSample('welcome', [[0, 1]]);
    await a.samples.welcome; await flush();
    expect(a.ctx.decodeAudioData).toHaveBeenCalledTimes(1);   // cached promise
    expect(typeof a.samples.welcome.then).toBe('function');
  });
  it('playSample on a blocked context waits for the first gesture, then plays once', async () => {
    const a = new AudioSys();
    const ctx = a.init();
    ctx.resume = vi.fn(async () => {});       // autoplay blocked: stays suspended
    a.playSample('welcome', [[0, 1]]);
    await flush();
    expect(ctx.state).toBe('suspended');
    ctx.resume = vi.fn(async () => { ctx.state = 'running'; });
    window.dispatchEvent(new Event('pointerdown'));
    await a.samples.welcome; await flush();
    expect(ctx.resume).toHaveBeenCalled();
    window.dispatchEvent(new Event('keydown'));   // listeners removed; nothing more happens
    await flush();
    expect(ctx.resume).toHaveBeenCalledTimes(1);
  });
  it('playSample unlocks by itself when resume() succeeds', async () => {
    const a = new AudioSys();
    a.init();
    a.playSample('welcome', [[0, 1]]);
    await a.samples.welcome; await flush();
    expect(a.ctx.state).toBe('running');
    expect(a.ctx.decodeAudioData).toHaveBeenCalled();
  });
  it('welcome plays the two-layer echo sample', () => {
    const a = new AudioSys();
    a.playSample = vi.fn();
    a.welcome();
    const [name, hits] = a.playSample.mock.calls[0];
    expect(name).toBe('welcome');
    expect(hits).toHaveLength(2);
    expect(hits[0][0]).toBeCloseTo(100 / 96);
  });
  it('start builds the engine voice once and update steers its pitch and noise', () => {
    const a = new AudioSys();
    a.start();
    expect(a.eng.type).toBe('sawtooth');
    expect(a.eng2.type).toBe('square');
    expect(a.eng.start).toHaveBeenCalled();
    expect(a.noise.loop).toBe(true);
    const eng = a.eng;
    a.start();
    expect(a.eng).toBe(eng);
    a.update(0.5, false, false, false);
    expect(a.eng.frequency.setTargetAtTime.mock.calls[0][0]).toBeCloseTo(55 + 75);
    a.update(2, true, false, true);   // speed clamps to 1.2, boost adds 25
    expect(a.eng.frequency.setTargetAtTime.mock.calls[1][0]).toBeCloseTo(55 + 180 + 25);
    expect(a.noiseGain.gain.setTargetAtTime.mock.calls[1][0]).toBe(0.5);
    a.update(1, false, true, false);
    expect(a.noiseGain.gain.setTargetAtTime.mock.calls[2][0]).toBeCloseTo(0.25);
    a.update(1, false, false, false);
    expect(a.noiseGain.gain.setTargetAtTime.mock.calls[3][0]).toBe(0);
  });
  it('start without audio support and update before start are no-ops', () => {
    const a = new AudioSys();
    a.update(1, false, false, false);
    delete window.AudioContext;
    a.start();
    expect(a.eng).toBeUndefined();
  });
  it('start plays the music that was wanted before the engine existed', () => {
    const a = new AudioSys();
    a.playMusic = vi.fn();
    a.wantMusic = 'mario';
    a.start();
    expect(a.playMusic).toHaveBeenCalledWith('mario');
    const b = new AudioSys();
    b.playMusic = vi.fn();
    b.wantMusic = 'mario'; b.muted = true;
    b.start();
    expect(b.playMusic).not.toHaveBeenCalled();
  });
  it('sfx plays an oscillator blip per kind and ignores calls before init', () => {
    const a = new AudioSys();
    a.sfx('pickup');                 // no context yet
    expect(ctxs).toHaveLength(0);
    a.init();
    const osc = vi.spyOn(a.ctx, 'createOscillator');
    for (const k of ['pickup', 'turbo', 'drop', 'launch', 'hit']) a.sfx(k);
    expect(osc).toHaveBeenCalledTimes(5);
  });
});

describe('AudioSys sequencer, music and sound effects', () => {
  it('sequencer loads the worklet and ROM data once and returns the same node', async () => {
    const a = new AudioSys();
    a.init();
    const p = a.sequencer();
    expect(a.sequencer()).toBe(p);
    const n = await p;
    expect(n).toBeInstanceOf(FakeWorkletNode);
    expect(a.ctx.audioWorklet.addModule).toHaveBeenCalledTimes(1);
    expect(workletPosts[0].type).toBe('init');
    expect(Object.keys(workletPosts[0].data)).toEqual(['ctl', 'tbl', 'seq', 'banksets']);
  });
  it('playMusic maps course ids to sequences, numbers pass through, unknown courses get 3', async () => {
    const a = new AudioSys();
    a.playMusic('banshee'); await settle(a);
    a.playMusic(2); await settle(a);
    a.playMusic('nowhere'); await settle(a);
    const plays = workletPosts.filter(m => m.type === 'play');
    expect(plays.map(m => m.seq)).toEqual([7, 2, 3]);
    expect(a.wantMusic).toBe('nowhere');
  });
  it('playMusic is remembered but silent while muted or without audio', async () => {
    const a = new AudioSys();
    a.muted = true;
    a.playMusic('mario'); await settle(a);
    expect(workletPosts).toHaveLength(0);
    expect(a.wantMusic).toBe('mario');
    delete window.AudioContext;
    const b = new AudioSys();
    b.playMusic('mario');
    expect(b.seqNode).toBeUndefined();
  });
  it('stopMusic fades both sequence players, and is a no-op before the sequencer exists', async () => {
    const a = new AudioSys();
    a.stopMusic();
    expect(workletPosts).toHaveLength(0);
    a.playMusic('mario'); await settle(a);
    workletPosts.length = 0;
    a.stopMusic(); await settle(a);
    expect(workletPosts.filter(m => m.type === 'stop')).toEqual([{ type: 'stop', player: 0, frames: 10 }, { type: 'stop', player: 1, frames: 10 }]);
  });
  it('starMusic swaps the course music for the star theme and back', async () => {
    const a = new AudioSys();
    a.wantMusic = 'mario';
    a.starMusic(true); await settle(a);
    expect(workletPosts.filter(m => m.type !== 'init')).toEqual([
      { type: 'stop', player: 0, frames: 8 }, { type: 'play', player: 1, seq: 0x11 }]);
    workletPosts.length = 0;
    a.starMusic(true);                // already on
    await settle(a);
    expect(workletPosts).toHaveLength(0);
    a.starMusic(false); await settle(a);
    expect(workletPosts).toContainEqual({ type: 'stop', player: 1, frames: 8 });
    expect(workletPosts).toContainEqual({ type: 'play', player: 0, seq: 3 });
  });
  it('starMusic while muted only records the state', async () => {
    const a = new AudioSys();
    a.muted = true;
    a.starMusic(true); await settle(a);
    expect(a.star).toBe(true);
    expect(workletPosts).toHaveLength(0);
  });
  it('playSound resumes a suspended context and posts the sfx; no audio means nothing', async () => {
    const a = new AudioSys();
    a.playSound(4, 1, 0.5, 20); await settle(a);
    expect(a.ctx.resume).toHaveBeenCalled();
    expect(workletPosts).toContainEqual({ type: 'sfx', bank: 4, id: 1, vol: 0.5, pan: 20 });
    delete window.AudioContext;
    const b = new AudioSys();
    b.playSound(4, 1);
    expect(b.seqNode).toBeUndefined();
  });
  it('stopSound only posts once the sequencer exists', async () => {
    const a = new AudioSys();
    a.stopSound(0, 5);
    expect(workletPosts).toHaveLength(0);
    a.playSound(0, 5); await settle(a);
    a.stopSound(0, 5); await settle(a);
    expect(workletPosts).toContainEqual({ type: 'sfxStop', bank: 0, id: 5 });
  });
  it('menuSound and voice use banks 4 and 2', () => {
    const a = new AudioSys();
    a.playSound = vi.fn();
    a.menuSound(0x16);
    a.voice(3);
    expect(a.playSound.mock.calls).toEqual([[4, 0x16], [2, 0x3e]]);
  });
  it('toggleMusic mutes, then restores star music or course music', async () => {
    const a = new AudioSys();
    a.playMusic('mario'); await settle(a);
    workletPosts.length = 0;
    expect(a.toggleMusic()).toBe(false);
    await settle(a);
    expect(workletPosts.filter(m => m.type === 'stop')).toHaveLength(2);
    workletPosts.length = 0;
    expect(a.toggleMusic()).toBe(true);
    await settle(a);
    expect(workletPosts).toContainEqual({ type: 'play', player: 0, seq: 3 });
    a.toggleMusic();
    a.star = true;
    workletPosts.length = 0;
    expect(a.toggleMusic()).toBe(true);
    await settle(a);
    expect(workletPosts).toContainEqual({ type: 'play', player: 1, seq: 0x11 });
    const b = new AudioSys();
    expect(b.toggleMusic()).toBe(false);
    expect(b.toggleMusic()).toBe(true);   // nothing wanted: nothing to restore
  });
});
