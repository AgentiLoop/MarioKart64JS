import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';

// road: textures the decomp draws for the asphalt (route waypoints must sit on them).
// Courses without a road pattern only require every waypoint to lie over course geometry
// (jumps on Royal Raceway, Wario Stadium etc. put waypoints well above the surface).
const COURSES = [
  { dir: 'luigi-raceway', tris: 3022, road: /^gLRTextureRoad/ },
  { dir: 'mario-raceway', tris: 2549, road: /^gMRTexture(Road0|RoadFinish0|674354)$/ },
  { dir: 'moo-moo-farm', tris: 3195 }, { dir: 'koopa-troopa-beach', tris: 3602 },
  { dir: 'kalimari-desert', tris: 2932 }, { dir: 'toads-turnpike', tris: 3732 },
  { dir: 'frappe-snowland', tris: 3179 }, { dir: 'choco-mountain', tris: 2397 },
  { dir: 'wario-stadium', tris: 3637 }, { dir: 'sherbet-land', tris: 1276 },
  { dir: 'royal-raceway', tris: 3514 }, { dir: 'bowsers-castle', tris: 4788 },
  { dir: 'dks-jungle-parkway', tris: 3726 }, { dir: 'yoshi-valley', tris: 2456 },
  { dir: 'banshee-boardwalk', tris: 2668 }, { dir: 'rainbow-road', tris: 1634 },
];
for (const { dir: name, tris: expectedTris, road: roadName } of COURSES) {
const dir = new URL(`../public/mk64/${name}/`, import.meta.url);
const course = JSON.parse(readFileSync(new URL('course.json', dir)));

test(`${name}: course batches reference valid vertices and extracted textures`, () => {
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
  assert.equal(tris, expectedTris);
});

test(`${name}: every route waypoint lies on native ${roadName ? 'road surface' : 'course geometry'}`, () => {
  const road = course.batches.filter(b => roadName ? roadName.test(b.texture ?? '') : true);
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
  if (roadName) assert.ok(maxDy <= 12, `max waypoint/road height gap ${maxDy}`);
});

test(`${name}: route is a closed loop`, () => {
  const p = course.path, a = p[0], b = p[p.length - 1];
  assert.ok(Math.hypot(a[0] - b[0], a[2] - b[2]) < 60);
});
}
