// AudioWorklet host for the M64 sequence player (src/m64.js); the main thread posts ROM data and commands.
import { M64 } from './m64.js';

class M64Processor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.port.onmessage = ({ data: m }) => {
      if (m.type === 'init') this.engine = new M64(m.data, sampleRate);
      else if (!this.engine) return;
      else if (m.type === 'play') this.engine.play(m.player, m.seq);
      else if (m.type === 'stop') this.engine.stop(m.player, m.frames);
      else if (m.type === 'sfx') this.engine.sfx(m.bank, m.id, m.vol, m.pan);
      else if (m.type === 'sfxStop') this.engine.sfxStop(m.bank, m.id);
    };
  }
  process(_, [out]) {
    if (this.engine) this.engine.render(out[0], out[1] || out[0]);
    return true;
  }
}
registerProcessor('m64', M64Processor);
