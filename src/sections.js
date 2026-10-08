// A screen's track section (pathCounter, func_8029122C) from the course's TrackSections triangles
// ([section id, ax, ay, az, bx, by, bz, cx, cy, cz] in course units, tools/extract-yoshi-egg.py track_sections):
// the section id of the course triangle under the camera, or under its kart when the two are more than one section
// apart; a floor over 30 below or with no section (255) keeps the old one.
import * as THREE from 'three';
import { NATIVE_SCALE } from './track.js';

const CELL = 256, FLOOR = 30;
const _p = new THREE.Vector3();

export class TrackSections {
  constructor(sections) {
    // triangles bucketed by x/z cell
    this.grid = new Map();
    for (const t of sections) {
      const xs = [t[1], t[4], t[7]], zs = [t[3], t[6], t[9]];
      for (let x = Math.floor(Math.min(...xs) / CELL); x <= Math.floor(Math.max(...xs) / CELL); x++) {
        for (let z = Math.floor(Math.min(...zs) / CELL); z <= Math.floor(Math.max(...zs) / CELL); z++) {
          const key = x * 65536 + z;
          if (!this.grid.has(key)) this.grid.set(key, []);
          this.grid.get(key).push(t);
        }
      }
    }
  }

  // the floor triangle under (x, y, z) in course units: { id, distance } (the highest one at or below y), or null
  floor(x, y, z) {
    let best = null;
    for (const t of this.grid.get(Math.floor(x / CELL) * 65536 + Math.floor(z / CELL)) || []) {
      const [, ax, ay, az, bx, by, bz, cx, cy, cz] = t;
      const area = (bx - ax) * (cz - az) - (cx - ax) * (bz - az);
      if (Math.abs(area) < 1e-6) continue;
      const u = ((bx - x) * (cz - z) - (cx - x) * (bz - z)) / area;
      const v = ((cx - x) * (az - z) - (ax - x) * (cz - z)) / area;
      const w = 1 - u - v;
      if (u < -1e-6 || v < -1e-6 || w < -1e-6) continue;
      const fy = u * ay + v * by + w * cy;
      if (fy <= y + 1 && (!best || y - fy < best.distance)) best = { id: t[0], distance: y - fy };
    }
    return best;
  }

  sectionOf(obj) {
    if (!obj) return { id: 255, distance: Infinity };
    const S = NATIVE_SCALE, p = obj.isObject3D ? _p.setFromMatrixPosition(obj.matrixWorld) : obj.world;   // camera / kart
    return this.floor(p.x / S, p.y / S, p.z / S) ?? { id: 255, distance: Infinity };
  }

  // func_8029122C: the screen's pathCounter from the camera's and its player's floor triangles
  pathCounter(cam, prev) {
    const c = this.sectionOf(cam), p = this.sectionOf(cam.userData.kart), d = c.id - p.id;
    const kart = p.id === 255 || p.distance > FLOOR ? prev : p.id;
    // assumption: this chase camera rides about 42 units over the road (higher than the console's), so a camera
    // more than 30 over its floor takes its kart's section instead of keeping the old one
    if (d < 2 && d >= -1 && c.id !== 255) return c.distance > FLOOR ? kart : c.id;
    return kart;
  }
}
