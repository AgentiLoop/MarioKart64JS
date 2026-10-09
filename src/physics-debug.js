// Physics overlay (P in a race, or ?physics): the collision the karts use, drawn over the course.
// Red fill + outline: the steep faces that block karts (Track.wallTris, Track.wallPush in battle arenas).
// Race courses: yellow = the route's lateral wall limit (Track.wallAt), orange = where a kart's centre stops
// (wallAt - 1.2, Kart.update). Per kart: cyan rings = the wall body at the two body heights wallPush tests
// (0.6 and 2 above the ground, radius Kart.visualHalfWidth), magenta = the kart-to-kart bump radius (boxSize).
import * as THREE from 'three';

const RACE_MARGIN = 1.2;   // Kart.update: wall = wallAt - 1.2

export class PhysicsDebug {
  constructor(scene, track) {
    this.scene = scene; this.track = track; this.rings = new Map();
    this.group = new THREE.Group();
    this.group.visible = false;
    this.group.renderOrder = 10;
    scene.add(this.group);
    const W = track.wallTris || [];
    if (W.length) {
      const pos = new Float32Array(W.length * 9), edge = new Float32Array(W.length * 18);
      W.forEach(([a, b, c], i) => {
        pos.set([...a, ...b, ...c], i * 9);
        edge.set([...a, ...b, ...b, ...c, ...c, ...a], i * 18);
      });
      const fill = new THREE.BufferGeometry();
      fill.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      this.group.add(new THREE.Mesh(fill, new THREE.MeshBasicMaterial({ color: 0xff2020, transparent: true, opacity: 0.35,
        side: THREE.DoubleSide, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4, fog: false, toneMapped: false })));
      const lines = new THREE.BufferGeometry();
      lines.setAttribute('position', new THREE.BufferAttribute(edge, 3));
      this.group.add(new THREE.LineSegments(lines, new THREE.LineBasicMaterial({ color: 0xff6060, fog: false, toneMapped: false })));
    }
    if (!track.arena && track.wallL) {
      for (const [margin, color] of [[0, 0xffe000], [RACE_MARGIN, 0xff8000]]) {
        for (const sgn of [-1, 1]) {
          const pts = [];
          for (let i = 0; i <= track.n; i++) {
            const k = i % track.n, p = track.pos[k], R = track.R[k], d = sgn * ((sgn > 0 ? track.wallR : track.wallL)[k] - margin);
            const y = track.groundAt?.(p.x + R.x * d, p.z + R.z * d, p.y)?.y ?? p.y;
            pts.push(p.x + R.x * d, y + 0.6, p.z + R.z * d);
          }
          const g = new THREE.BufferGeometry();
          g.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
          this.group.add(new THREE.Line(g, new THREE.LineBasicMaterial({ color, fog: false, toneMapped: false })));
        }
      }
    }
  }

  get visible() { return this.group.visible; }
  toggle(on = !this.group.visible) { this.group.visible = on; return on; }

  ring(r, color) {
    const pts = [];
    for (let i = 0; i < 32; i++) pts.push(Math.cos(i / 32 * Math.PI * 2) * r, 0, Math.sin(i / 32 * Math.PI * 2) * r);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
    return new THREE.LineLoop(g, new THREE.LineBasicMaterial({ color, depthTest: false, fog: false, toneMapped: false }));
  }

  update(karts) {
    if (!this.group.visible) return;
    for (const [k, set] of this.rings) if (!karts.includes(k)) { set.forEach(m => { this.group.remove(m); m.geometry.dispose(); }); this.rings.delete(k); }
    for (const k of karts) {
      if (!this.rings.has(k)) {
        const body = this.track.arena ? k.visualHalfWidth : RACE_MARGIN;
        const set = [this.ring(body, 0x00e0ff), this.ring(body, 0x00e0ff), this.ring(k.boxSize * 0.1, 0xff40ff)];
        set.forEach(m => this.group.add(m));
        this.rings.set(k, set);
      }
      const p = k.mesh.position, [lo, hi, bump] = this.rings.get(k);
      lo.position.set(p.x, p.y + 0.6, p.z); hi.position.set(p.x, p.y + 2, p.z); bump.position.set(p.x, p.y + 0.1, p.z);
    }
  }
}
