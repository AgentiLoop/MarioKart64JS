import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { neonTrace } from '../src/track.js';

// Rainbow Road neon signs decoded by tools/extract-neon.py (update_objects.c:7701-7860).
const base = new URL('../public/mk64/rainbow-road/', import.meta.url);
const neon = JSON.parse(readFileSync(new URL('neon.json', base)));

test('neon signs: ten sprites, positions from the decomp', () => {
  assert.equal(neon.romSha1, '579c48e211ae952530ffc8738709f078d5dd215e');
  assert.equal(neon.scale, 8);
  assert.deepEqual(neon.signs.map(s => s.name),
    ['mushroom', 'mario', 'boo', 'peach', 'luigi', 'donkeykong', 'yoshi', 'bowser', 'wario', 'toad']);
  assert.deepEqual(neon.signs.map(s => s.position), [
    [-1431, 827, -2957], [799, 1193, -5891], [-2013, 555, 0],
    [1443, 1044, -5478], [1678, 1012, -4840], [-3924, 921, 2566], [-3311, 790, 3524],
    [-1284, 1341, 4527], [2268, 1041, 4456], [2820, 1109, 1985]]);
  assert.deepEqual(neon.signs.map(s => s.frames.length), [5, 5, 5, 1, 1, 1, 1, 1, 1, 1]);
});

test('neon signs: hedgehog quad halves and 64x64 frames', () => {
  assert.deepEqual(neon.vertices.map(v => v.slice(0, 3)),
    [[-32, -31, 0], [31, -31, 0], [31, 0, 0], [-32, 0, 0], [-32, 0, 0], [31, 0, 0], [31, 31, 0], [-32, 31, 0]]);
  for (const s of neon.signs) for (const f of s.frames) {
    const png = readFileSync(new URL(f, base));
    assert.deepEqual([png.readUInt32BE(16), png.readUInt32BE(20)], [64, 64], f);
  }
});

const runs = trace => {
  const out = [];
  for (const { state, frame, visible } of trace) {
    const key = `${state}:${frame}${visible ? '' : 'h'}`, last = out[out.length - 1];
    if (last && last.key === key) last.n++; else out.push({ key, n: 1 });
  }
  return out;
};

test('neon mushroom: 5 palette sweeps, 10 flashes, pause, 5 sweeps, 20 quick flashes, loop', () => {
  const t = runs(neonTrace('mushroom', 1200));
  assert.deepEqual(t.slice(0, 5), [{ key: '2:0', n: 13 }, { key: '2:1', n: 12 }, { key: '2:2', n: 12 }, { key: '2:3', n: 12 }, { key: '2:4', n: 12 }]);
  const states = [...new Set(t.map(r => r.key.split(':')[0]))];
  assert.deepEqual(states.slice(0, 7), ['2', '3', '4', '5', '6', '7', '8']);
  assert.ok(t.some(r => r.key === '4:3' && r.n === 21));
  assert.ok(t.filter(r => r.key.startsWith('3:') && r.n === 5).length >= 19);
  assert.ok(t.filter(r => r.key.startsWith('7:') && r.n === 1).length >= 39);
});

test('neon mario: sweep, one flash, 13 hidden ticks, loop', () => {
  const t = runs(neonTrace('mario', 330));
  const hidden = t.filter(r => r.key.endsWith('h'));
  assert.deepEqual(hidden.map(r => r.n), [12, 12, 12]);
  assert.equal(t.filter(r => r.key === '5:0').length, 3);
});

test('neon boo: sweep, 30 ticks, 7 flickers, 30 ticks, down sweep, hidden 15, loop', () => {
  const t = neonTrace('boo', 200);
  const blink = t.filter(x => x.state === 4);
  assert.equal(blink.filter(x => !x.visible).length, 7);
  assert.equal(blink.at(-1).visible, true);
  assert.equal(t.filter(x => x.state === 7 && !x.visible).length, 15);
  assert.equal(t.filter(x => x.state === 8).length, 1);
  assert.deepEqual(t.filter(x => x.state === 6).map(x => x.frame).filter((f, i, a) => a[i - 1] !== f), [4, 3, 2, 1, 0]);
});
