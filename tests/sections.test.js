import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { TrackSections } from '../src/sections.js';

// [section id, ax, ay, az, bx, by, bz, cx, cy, cz] in course units
const TRIS = [
  [5, 0, 0, 0, 100, 0, 0, 0, 0, 100],          // floor at y 0, section 5
  [6, 0, 20, 0, 100, 20, 0, 0, 20, 100],       // a floor above it at y 20, section 6
  [9, 0, 0, 0, 0, 0, 0, 50, 0, 50],            // degenerate: skipped
  [7, 1000, 0, 1000, 1600, 0, 1000, 1000, 0, 1600],   // spans several 256 cells
  [8, 3000, 0, 0, 3100, 0, 0, 3000, 0, 100],   // section 8 far away
  [255, 5000, 0, 0, 5100, 0, 0, 5000, 0, 100], // no section
];

const camAt = (x, y, z) => {
  const c = new THREE.PerspectiveCamera();
  c.position.set(x, y, z);
  c.updateMatrixWorld(true);
  return c;
};

describe('TrackSections', () => {
  const ts = new TrackSections(TRIS);

  it('buckets triangles by 256-unit cells', () => {
    expect(ts.grid.get(0)).toContain(TRIS[0]);
    // the 600-wide triangle covers cells 3..6 in x and z
    expect(ts.grid.get(3 * 65536 + 3)).toContain(TRIS[3]);
    expect(ts.grid.get(6 * 65536 + 6)).toContain(TRIS[3]);
  });

  it('floor picks the highest triangle at or below y', () => {
    expect(ts.floor(10, 5, 10)).toEqual({ id: 5, distance: 5 });
    expect(ts.floor(10, 25, 10)).toEqual({ id: 6, distance: 5 });
    // 20 is more than 1 above 10: only the lower floor
    expect(ts.floor(10, 10, 10)).toEqual({ id: 5, distance: 10 });
    // within 1 below counts (fy <= y + 1)
    expect(ts.floor(10, 19.5, 10).id).toBe(6);
    expect(ts.floor(10, -5, 10)).toBeNull();
  });

  it('floor misses outside the triangle and off the grid', () => {
    expect(ts.floor(90, 5, 90)).toBeNull();
    expect(ts.floor(-500, 5, -500)).toBeNull();
    expect(ts.floor(1300, 3, 1100)).toEqual({ id: 7, distance: 3 });
  });

  it('sectionOf reads cameras (matrixWorld) and karts (world) in scene units', () => {
    expect(ts.sectionOf(null)).toEqual({ id: 255, distance: Infinity });
    expect(ts.sectionOf({ world: new THREE.Vector3(1, 0.5, 1) })).toEqual({ id: 5, distance: 5 });
    const s = ts.sectionOf(camAt(1, 2.5, 1));
    expect(s.id).toBe(6);
    expect(s.distance).toBeCloseTo(5);
    expect(ts.sectionOf({ world: new THREE.Vector3(-90, 0, -90) })).toEqual({ id: 255, distance: Infinity });
  });

  it('pathCounter takes the camera section when it is close to the kart section', () => {
    const cam = camAt(1, 0.5, 1);
    cam.userData.kart = { world: new THREE.Vector3(1, 0.3, 1) };
    expect(ts.pathCounter(cam, 1)).toBe(5);
  });

  it('pathCounter falls back to the kart when the camera rides high over its floor', () => {
    const cam = camAt(1, 1.5 + 4, 1);       // 55 above the section-6 floor (> 30)
    cam.userData.kart = { world: new THREE.Vector3(1, 0.2, 1) };   // section 5, 2 above
    expect(ts.pathCounter(cam, 1)).toBe(5);
  });

  it('pathCounter falls back to the kart when the sections are far apart, or keeps prev', () => {
    const cam = camAt(301, 0.5, 1);          // section 8
    cam.userData.kart = { world: new THREE.Vector3(1, 0.3, 1) };   // section 5: d = 3
    expect(ts.pathCounter(cam, 1)).toBe(5);
    // camera with no section and no kart: keep the previous one
    const lost = camAt(-90, 0, -90);
    expect(ts.pathCounter(lost, 4)).toBe(4);
    // camera on 255 section -> kart; kart too far above its floor -> prev
    const none = camAt(501, 0.5, 1);
    none.userData.kart = { world: new THREE.Vector3(1, 10, 1) };
    expect(ts.pathCounter(none, 3)).toBe(3);
    // camera one section below the kart counts as near (d = -1)
    const c5 = camAt(1, 0.5, 1);
    c5.userData.kart = { world: new THREE.Vector3(1, 2.2, 1) };   // section 6
    expect(ts.pathCounter(c5, 1)).toBe(5);
  });
});
