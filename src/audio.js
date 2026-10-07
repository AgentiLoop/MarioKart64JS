// Tiny procedural WebAudio: engine hum, skid noise, countdown beeps, original chiptune race music.
export class AudioSys {
  constructor() { this.ctx = null; this.samples = {}; }
  init() {
    if (this.ctx) return this.ctx;
    const C = window.AudioContext || window.webkitAudioContext;
    if (!C) return null;
    const ctx = this.ctx = new C();
    this.master = ctx.createGain(); this.master.gain.value = 0.25; this.master.connect(ctx.destination);
    return ctx;
  }
  // ROM sample from tools/extract-sounds.py, played once the browser allows audio (first gesture if autoplay is blocked)
  playSample(name, hits) {
    const ctx = this.init();
    if (!ctx) return;
    const buf = this.samples[name] || (this.samples[name] =
      fetch(`mk64/audio/${name}.wav`).then(r => r.arrayBuffer()).then(b => ctx.decodeAudioData(b)));
    let done = false;
    const go = () => {
      if (done) return;
      done = true;
      buf.then(b => {
        const t = ctx.currentTime;
        for (const [delay, gain] of hits) {
          const s = ctx.createBufferSource(), g = ctx.createGain();
          s.buffer = b; g.gain.value = gain; s.connect(g); g.connect(ctx.destination); s.start(t + delay);
        }
      });
    };
    if (ctx.state === 'running') return go();
    const unlock = () => {
      removeEventListener('pointerdown', unlock); removeEventListener('keydown', unlock);
      ctx.resume().then(go);
    };
    addEventListener('pointerdown', unlock); addEventListener('keydown', unlock);
    ctx.resume().then(() => { if (ctx.state === 'running') unlock(); });
  }
  // SOUND_INTRO_WELCOME (seq 0 bank 4 sound 9, script 0x1AEC): bank 0 instrument 0x7C on two layers,
  // delay 100 tatums at vel 100 and 112 tatums at vel 80 (120 BPM x 48 tatums = 96/s) for a short echo
  welcome() { this.playSample('welcome', [[100 / 96, (100 / 127) ** 2 * 0.8], [112 / 96, (80 / 127) ** 2 * 0.8]]); }
  start() {
    if (this.eng || !this.init()) return;
    const ctx = this.ctx;
    this.eng = ctx.createOscillator(); this.eng.type = 'sawtooth';
    this.eng2 = ctx.createOscillator(); this.eng2.type = 'square';
    this.engGain = ctx.createGain(); this.engGain.gain.value = 0.18;
    this.lp = ctx.createBiquadFilter(); this.lp.type = 'lowpass'; this.lp.frequency.value = 600;
    this.eng.connect(this.lp); this.eng2.connect(this.lp); this.lp.connect(this.engGain); this.engGain.connect(this.master);
    this.eng.start(); this.eng2.start();
    const buf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate), data = buf.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    this.noise = ctx.createBufferSource(); this.noise.buffer = buf; this.noise.loop = true;
    this.bp = ctx.createBiquadFilter(); this.bp.type = 'bandpass'; this.bp.frequency.value = 1800; this.bp.Q.value = 0.8;
    this.noiseGain = ctx.createGain(); this.noiseGain.gain.value = 0;
    this.noise.connect(this.bp); this.bp.connect(this.noiseGain); this.noiseGain.connect(this.master);
    this.noise.start();
    this.hat = ctx.createBuffer(1, 2205, ctx.sampleRate); const hd = this.hat.getChannelData(0);
    for (let i = 0; i < hd.length; i++) hd[i] = Math.random() * 2 - 1;
    if (this.wantMusic && !this.muted) this.playMusic(this.wantMusic);
  }
  // Original chiptune: seeded 8-bar loop (square lead, triangle bass, noise hats), per-course key/tempo.
  playMusic(id) {
    this.stopMusic();
    if (!this.ctx || this.muted) { this.wantMusic = id; return; }
    this.wantMusic = id;
    const T = {
      meadow: { bpm: 150, root: 60, sc: [0, 2, 4, 7, 9, 12], prog: [0, 5, 7, 5], seed: 7 },
      frost: { bpm: 138, root: 57, sc: [0, 3, 5, 7, 10, 12], prog: [0, 8, 5, 7], seed: 11 },
      dunes: { bpm: 144, root: 62, sc: [0, 1, 4, 5, 7, 8, 12], prog: [0, 0, 5, 1], seed: 23 },
      moonlit: { bpm: 126, root: 55, sc: [0, 3, 5, 7, 10, 12], prog: [0, 3, 8, 7], seed: 31 },
    }[id] || { bpm: 144, root: 60, sc: [0, 2, 4, 7, 9, 12], prog: [0, 5, 7, 5], seed: 3 };
    let r = T.seed; const rnd = () => (r = (r * 1664525 + 1013904223) >>> 0) / 4294967296;
    const step = 60 / T.bpm / 2, steps = 8 * 16 / 2;   // 8th notes, 64 steps
    const lead = [], bass = [];
    for (let i = 0; i < steps; i++) {
      const chord = T.prog[Math.floor(i / 16) % T.prog.length];
      bass.push(i % 2 === 0 ? chord - 12 + (i % 8 === 4 ? 7 : 0) : null);
      lead.push(rnd() < 0.7 ? chord + T.sc[Math.floor(rnd() * T.sc.length)] : null);
    }
    const first = lead.slice(0, 8);
    for (let i = 0; i < steps; i++) if (i % 16 < 8 && (i % 32) >= 16) lead[i] = first[i % 8];
    const ctx = this.ctx, hz = n => 440 * Math.pow(2, (n - 69) / 12);
    const note = (type, n, t, d, v) => {
      const o = ctx.createOscillator(), g = ctx.createGain();
      o.type = type; o.frequency.value = hz(n);
      g.gain.setValueAtTime(v, t); g.gain.exponentialRampToValueAtTime(0.001, t + d);
      o.connect(g); g.connect(this.musicGain); o.start(t); o.stop(t + d + 0.02);
    };
    this.musicGain = ctx.createGain(); this.musicGain.gain.value = 0.35; this.musicGain.connect(this.master);
    let i = 0, next = ctx.currentTime + 0.1;
    this.musicTimer = setInterval(() => {
      while (next < ctx.currentTime + 0.4) {
        const k = i % steps;
        if (lead[k] !== null) note('square', T.root + lead[k] + 12, next, step * 0.9, 0.12);
        if (bass[k] !== null) note('triangle', T.root + bass[k] - 12, next, step * 1.8, 0.35);
        if (k % 4 === 2) {
          const b = ctx.createBufferSource(); b.buffer = this.hat; const g = ctx.createGain();
          g.gain.setValueAtTime(0.06, next); g.gain.exponentialRampToValueAtTime(0.001, next + 0.05);
          b.connect(g); g.connect(this.musicGain); b.start(next);
        }
        next += step; i++;
      }
    }, 100);
  }
  stopMusic() {
    if (this.musicTimer) { clearInterval(this.musicTimer); this.musicTimer = null; }
    if (this.musicGain) { const g = this.musicGain; g.gain.setTargetAtTime(0, this.ctx.currentTime, 0.1); setTimeout(() => g.disconnect(), 800); this.musicGain = null; }
  }
  toggleMusic() {
    this.muted = !this.muted;
    if (this.muted) this.stopMusic(); else if (this.wantMusic) this.playMusic(this.wantMusic);
    return !this.muted;
  }
  update(speed01, skid, offroad, boost) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime, s = Math.max(0, Math.min(1.2, speed01));
    const f = 55 + s * 150 + (boost ? 25 : 0);
    this.eng.frequency.setTargetAtTime(f, t, 0.05);
    this.eng2.frequency.setTargetAtTime(f * 0.5, t, 0.05);
    this.lp.frequency.setTargetAtTime(350 + s * 900, t, 0.05);
    const n = skid ? 0.5 : offroad ? 0.25 * s : 0;
    this.noiseGain.gain.setTargetAtTime(n, t, 0.05);
  }
  sfx(kind) {
    if (!this.ctx) return;
    const [type, f0, f1, dur, vol] = {
      pickup: ['triangle', 600, 1200, 0.18, 0.3], turbo: ['sawtooth', 200, 700, 0.5, 0.3],
      drop: ['square', 300, 120, 0.15, 0.25], launch: ['sine', 500, 1400, 0.3, 0.3],
      hit: ['sawtooth', 500, 60, 0.6, 0.4],
    }[kind];
    const t = this.ctx.currentTime, o = this.ctx.createOscillator(), g = this.ctx.createGain();
    o.type = type; o.frequency.setValueAtTime(f0, t); o.frequency.exponentialRampToValueAtTime(f1, t + dur);
    g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g); g.connect(this.master); o.start(t); o.stop(t + dur + 0.05);
  }
  beep(go) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime, o = this.ctx.createOscillator(), g = this.ctx.createGain();
    o.type = 'square'; o.frequency.value = go ? 880 : 440;
    g.gain.setValueAtTime(0.3, t); g.gain.exponentialRampToValueAtTime(0.001, t + (go ? 0.7 : 0.25));
    o.connect(g); g.connect(this.master); o.start(t); o.stop(t + 0.8);
  }
}
