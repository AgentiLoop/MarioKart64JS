import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';

const dir = new URL('../public/mk64/luigi-raceway/', import.meta.url);
const course = JSON.parse(readFileSync(new URL('course.json', dir)));

test('course batches reference valid vertices and extracted textures', () => {
  assert.equal(course.provenance.romSha1, '579c48e211ae952530ffc8738709f078d5dd215e');
  let tris = 0;
  for (const b of course.batches) {
    assert.equal(b.indices.length % 3, 0);
    tris += b.indices.length / 3;
    for (const i of b.indices) assert.ok(i >= 0 && i < course.vertices.length);
    if (b.texture) {
      assert.ok(course.textures[b.texture], b.texture);
      assert.ok(existsSync(new URL(course.textures[b.texture].image, dir)), b.texture);
    }
  }
  assert.equal(tris, 3022);
});

test('every route waypoint lies on native road surface', () => {
  const road = course.batches.filter(b => /^gLRTextureRoad/.test(b.texture ?? ''));
  assert.ok(road.length >= 2);
  const v = course.vertices;
  const surfaceY = (x, z) => {
    let best = null;
    for (const b of road) for (let k = 0; k < b.indices.length; k += 3) {
      const [a, c, d] = [v[b.indices[k]], v[b.indices[k + 1]], v[b.indices[k + 2]]];
      const det = (c[2] - d[2]) * (a[0] - d[0]) + (d[0] - c[0]) * (a[2] - d[2]);
      if (!det) continue;
      const l1 = ((c[2] - d[2]) * (x - d[0]) + (d[0] - c[0]) * (z - d[2])) / det;
      const l2 = ((d[2] - a[2]) * (x - d[0]) + (a[0] - d[0]) * (z - d[2])) / det;
      const l3 = 1 - l1 - l2;
      if (l1 < -1e-6 || l2 < -1e-6 || l3 < -1e-6) continue;
      const y = l1 * a[1] + l2 * c[1] + l3 * d[1];
      if (best === null || Math.abs(y) < Math.abs(best)) best = y;
    }
    return best;
  };
  let missing = 0, maxDy = 0;
  for (const [x, y, z] of course.path) {
    const s = surfaceY(x, z);
    if (s === null) { missing++; continue; }
    maxDy = Math.max(maxDy, Math.abs(s - y));
  }
  assert.equal(missing, 0, `${missing}/${course.path.length} waypoints off road`);
  assert.ok(maxDy <= 12, `max waypoint/road height gap ${maxDy}`);
});

test('route is a closed loop', () => {
  const p = course.path, a = p[0], b = p[p.length - 1];
  assert.ok(Math.hypot(a[0] - b[0], a[2] - b[2]) < 60);
});
