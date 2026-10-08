// WebAudio: procedural engine hum, skid noise and countdown beeps; ROM voice samples and ROM music (src/m64.js).
import workletUrl from './m64-worklet.js?worker&url';

const BASE = import.meta.env?.BASE_URL ?? '/';

// play_sequence ids per course (race_logic.c:420-487)
const COURSE_SEQ = {
  mario: 3, royal: 3, luigi: 3, wario: 3, moomoo: 4, yoshi: 4, choco: 5, koopa: 6, banshee: 7,
  frappe: 8, sherbet: 8, bowser: 9, kalimari: 10, rainbow: 0x12, dk: 0x13, toad: 0x15,
};
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
      fetch(`${BASE}mk64/audio/${name}.wav`).then(r => r.arrayBuffer()).then(b => ctx.decodeAudioData(b)));
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
    ctx.resume();   // may have been created before a gesture (title voice / menu music)
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
    if (this.wantMusic && !this.muted) this.playMusic(this.wantMusic);
  }
  // ROM music: the .m64 sequences played by src/m64.js in an AudioWorklet (sequence player 0, like play_sequence)
  sequencer() {
    if (this.seqNode) return this.seqNode;
    const ctx = this.init();
    const get = n => fetch(`${BASE}mk64/audio/${n}.bin`).then(r => r.arrayBuffer());
    return (this.seqNode = Promise.all([ctx.audioWorklet.addModule(workletUrl), get('ctl'), get('tbl'), get('seq'), get('banksets')])
      .then(([, ctl, tbl, seq, banksets]) => {
        const node = new AudioWorkletNode(ctx, 'm64', { numberOfInputs: 0, outputChannelCount: [2] });
        node.port.postMessage({ type: 'init', data: { ctl, tbl, seq, banksets } }, [ctl, tbl, seq, banksets]);
        const g = ctx.createGain(); g.gain.value = 0.9;
        node.connect(g); g.connect(ctx.destination);
        return node;
      }));
  }
  // id: a seq id (SEQ_MENU_TITLE_SCREEN = 1, SEQ_MENU_MAIN_MENU = 2) or a course id (race_logic.c:420-487)
  playMusic(id) {
    this.wantMusic = id;
    if (this.muted || !this.init()) return;
    const seq = typeof id === 'number' ? id : COURSE_SEQ[id] ?? 3;
    this.sequencer().then(n => n.port.postMessage({ type: 'play', player: 0, seq }));
  }
  stopMusic() {
    if (this.seqNode) this.seqNode.then(n => {
      n.port.postMessage({ type: 'stop', player: 0, frames: 10 });
      n.port.postMessage({ type: 'stop', player: 1, frames: 10 });
    });
  }
  // A human's star (external.c func_800CA59C / func_800CA730, 1-2 players): the course music stops (0x100100FF,
  // 8-frame fade) and SEQ_EVENT_RACE_POWERUP_STAR 0x11 plays on sequence player 1 (play_sequence2); when the star
  // ends player 1 stops (0x110100FF) and play_sequence(D_800EA15C) restarts the course music on player 0
  starMusic(on) {
    if (!!this.star === on) return;
    this.star = on;
    if (this.muted || !this.init()) return;
    this.sequencer().then(n => {
      n.port.postMessage({ type: 'stop', player: on ? 0 : 1, frames: 8 });
      if (on) n.port.postMessage({ type: 'play', player: 1, seq: 0x11 });
    });
    if (!on && this.wantMusic) this.playMusic(this.wantMusic);
  }
  // ROM sound effect: sequence 0 on player 2 (include/sounds.h SOUND_ARG_LOAD(bank << 4 | 9, .., .., id))
  playSound(bank, id) {
    const ctx = this.init();
    if (!ctx) return;
    if (ctx.state !== 'running') ctx.resume();
    this.sequencer().then(n => n.port.postMessage({ type: 'sfx', bank, id }));
  }
  stopSound(bank, id) {
    if (this.seqNode) this.seqNode.then(n => n.port.postMessage({ type: 'sfxStop', bank, id }));
  }
  // bank 4: SOUND_MENU_CURSOR_MOVE 0x00, _SELECT 0x01, _GO_BACK 0x02, _OK_CLICKED 0x16
  menuSound(id) { this.playSound(4, id); }
  // driver picked (menus.c player_select_menu_act): bank 2, id = characterId * 0x10 + 0x0E
  voice(characterId) { this.playSound(2, characterId * 0x10 + 0x0e); }
  toggleMusic() {
    this.muted = !this.muted;
    if (this.muted) this.stopMusic();
    else if (this.star) this.sequencer().then(n => n.port.postMessage({ type: 'play', player: 1, seq: 0x11 }));
    else if (this.wantMusic) this.playMusic(this.wantMusic);
    return !this.muted;
  }
  update(speed01, skid, offroad, boost) {
    if (!this.eng) return;
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
