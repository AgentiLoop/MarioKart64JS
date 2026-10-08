import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// Start/finish gantry decoded from common_data by tools/extract-finish-line.py.
const dir = new URL('../public/mk64/finish-line/', import.meta.url);
const data = JSON.parse(readFileSync(new URL('finish-line.json', dir)));

test('finish line: ROM provenance and every texture exists with the stated size', () => {
  assert.equal(data.romSha1, '579c48e211ae952530ffc8738709f078d5dd215e');
  assert.deepEqual(Object.keys(data.images).sort(), [...Array(8)].map((_, i) => `banner${i + 1}`).concat('post1', 'post2').sort());
  for (const [name, { width, height }] of Object.entries(data.images)) {
    const png = readFileSync(new URL(`${name}.png`, dir));
    assert.equal(png.readUInt32BE(16), width);
    assert.equal(png.readUInt32BE(20), height);
  }
});

test('finish line: banner is 8 panels of a 4x2 grid, posts and white back quad', () => {
  const { banner, post, back } = data.model;
  assert.deepEqual(banner.groups.map(g => g.texture), [...Array(8)].map((_, i) => `banner${i + 1}`));
  for (const g of banner.groups) {
    assert.equal(g.triangles.length, 2);
    assert.equal(g.vertices.length, 4);
  }
  assert.equal(banner.cullCleared, false);
  assert.deepEqual(post.groups.map(g => [g.texture, g.vertices.length, g.triangles.length]), [['post1', 8, 4], ['post2', 16, 8]]);
  assert.equal(post.cullCleared, true);
  assert.equal(back.groups[0].texture, null);
  assert.equal(back.cullCleared, false);
  const all = [banner, post, back].flatMap(p => p.groups.flatMap(g => g.vertices));
  assert.ok(all.every(v => v[2] === 0), 'the gantry is flat in its own XY plane');
  const xs = banner.groups.flatMap(g => g.vertices.map(v => v[0]));
  assert.deepEqual([Math.min(...xs), Math.max(...xs)], [-80, 80]);
});
