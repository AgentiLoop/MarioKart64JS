import { describe, it, expect } from 'vitest';
const mods = import.meta.glob('../src/*.js');
describe('imports', () => {
  for (const [p, load] of Object.entries(mods)) {
    if (p.endsWith('main.js') || p.endsWith('m64-worklet.js')) continue;
    it(p, async () => { expect(await load()).toBeTruthy(); });
  }
});
