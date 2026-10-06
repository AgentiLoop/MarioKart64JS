// Tiny procedural WebAudio: engine hum, skid noise, countdown beeps.
export class AudioSys {
  constructor() { this.ctx = null; }
  start() {
    if (this.ctx) return;
    const C = window.AudioContext || window.webkitAudioContext;
    if (!C) return;
    const ctx = this.ctx = new C();
    this.master = ctx.createGain(); this.master.gain.value = 0.25; this.master.connect(ctx.destination);
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
  beep(go) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime, o = this.ctx.createOscillator(), g = this.ctx.createGain();
    o.type = 'square'; o.frequency.value = go ? 880 : 440;
    g.gain.setValueAtTime(0.3, t); g.gain.exponentialRampToValueAtTime(0.001, t + (go ? 0.7 : 0.25));
    o.connect(g); g.connect(this.master); o.start(t); o.stop(t + 0.8);
  }
}
