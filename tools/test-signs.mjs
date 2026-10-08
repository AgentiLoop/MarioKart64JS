import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// Sign actors decoded by tools/extract-signs.py.
const load = dir => {
  const base = new URL(`../public/mk64/${dir}/`, import.meta.url);
  const data = JSON.parse(readFileSync(new URL('signs.json', base)));
  return { base, data };
};

function checkTextures({ base, data }) {
  assert.equal(data.romSha1, '579c48e211ae952530ffc8738709f078d5dd215e');
  for (const [symbol, t] of Object.entries(data.textures)) {
    const png = readFileSync(new URL(t.image, base));
    assert.equal(png.readUInt32BE(16), t.width, symbol);
    assert.equal(png.readUInt32BE(20), t.height, symbol);
  }
  for (const g of data.model) {
    assert.ok(g.triangles.flat().every(i => i >= 0 && i < g.vertices.length));
    if (g.texture) assert.ok(data.textures[g.texture], g.texture);
  }
}

test('mario raceway signs: 2 spinning actors, two 32x64 face textures plus the shade-only frame', () => {
  const s = load('mario-raceway');
  checkTextures(s);
  assert.deepEqual(s.data.positions, [[150, 40, -1300], [2520, 0, 1240]]);
  assert.equal(s.data.spin, true);
  assert.deepEqual(s.data.model.map(g => [g.texture, g.triangles.length]),
    [['gTextureMarioRacewaySignLeft', 8], ['gTextureMarioRacewaySignRight', 8], [null, 48]]);
  for (const t of Object.values(s.data.textures)) assert.deepEqual([t.width, t.height], [32, 64]);
});

test('wario stadium signs: 3 static actors, four 64x32 head textures', () => {
  const s = load('wario-stadium');
  checkTextures(s);
  assert.deepEqual(s.data.positions, [[-131, 83, 286], [-2353, 72, -1608], [-2622, 79, 739]]);
  assert.equal(s.data.spin, false);
  assert.equal(s.data.model.length, 4);
  for (const g of s.data.model) assert.equal(g.triangles.length, 12);
  for (const t of Object.values(s.data.textures)) assert.deepEqual([t.width, t.height], [64, 32]);
});
