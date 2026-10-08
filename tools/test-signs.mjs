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

// collision_mario_sign (query_and_resolve_collision_player_actor): a sphere of radius 7 padded by the kart box 5.5.
test('bumpActor: no contact outside 12.5 units or in height, otherwise pushed half the overlap out and slowed', async () => {
  const { bumpActor } = await import('../src/track.js');
  const near = { t: 1.0, r: 0, y: 0 }, fast = { t: 40, r: 0 };
  assert.equal(bumpActor({ t: 1.3, r: 0, y: 0 }, fast, 5.5), null);                 // 13 units > 12.5
  assert.equal(bumpActor({ t: 0.6, r: 0, y: 1.2 }, fast, 5.5), null);               // 3D distance 13.4
  assert.equal(bumpActor({ t: 0, r: 0, y: 0 }, fast, 5.5), null);                   // exactly on the sign: ignored (< 0.1)
  const hit = bumpActor(near, fast, 5.5);
  assert.ok(Math.abs(hit.dt - (-0.25 * 0.5)) < 1e-9 && hit.dr === 0, 'half of the 0.25 overlap, away from the sign');
  assert.ok(Math.abs(hit.vt - (40 - 40 * 0.8 * 1.3)) < 1e-9 && hit.vr === 0, 'the into-sign speed is cut by 0.8 x 1.3');
  assert.ok(bumpActor(near, fast, 6)?.dt < hit.dt, 'a bigger kart box reaches further');
  const slow = bumpActor(near, { t: 0.5, r: 0.2 }, 5.5);                           // below 0.25 native units per frame
  assert.deepEqual([slow.vt, slow.vr], [0, 0]);
  assert.ok(Math.abs(1.0 - slow.dt - 1.25 * 1.2) < 1e-9, 'snapped to 1.2 x the contact distance from the sign');
});
