import * as THREE from 'three';

// Original item system: item boxes, Turbo (self boost), Slick (oil puddle dropped behind),
// Seeker (orb that chases the kart ahead). Everything lives in track coordinates (s, d).
export const ITEM_LABELS = { turbo: '⚡ TURBO', slick: '● SLICK', orb: '◎ SEEKER' };
const BOX_SPOTS = [0.06, 0.22, 0.40, 0.55, 0.72, 0.90];   // fractions of track length
const BOX_D = [-6, 0, 6];
const BOX_RESPAWN = 4;

// 16x16 pixel-art item crystal, drawn procedurally and shown as a nearest-filtered billboard sprite.
function boxTex() {
  const c = document.createElement('canvas'); c.width = c.height = 16;
  const g = c.getContext('2d');
  const px = (x, y, w, h, col) => { g.fillStyle = col; g.fillRect(x, y, w, h); };
  px(2, 1, 12, 14, '#0b2a6b');          // outline
  px(3, 2, 10, 12, '#ffd23a');          // body
  px(3, 2, 10, 2, '#fff3a8');           // top light
  px(3, 12, 10, 2, '#e08a12');          // bottom shade
  px(1, 3, 1, 10, '#0b2a6b'); px(14, 3, 1, 10, '#0b2a6b');
  px(3, 2, 1, 10, '#fff3a8');           // left highlight
  // "?" glyph
  const q = ['..XXXX..', '.XX..XX.', '.....XX.', '....XX..', '...XX...', '........', '...XX...', '...XX...'];
  q.forEach((row, y) => [...row].forEach((ch, x) => { if (ch === 'X') px(4 + x, 4 + y, 1, 1, '#2a63c8'); }));
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  t.magFilter = THREE.NearestFilter; t.minFilter = THREE.NearestFilter; t.generateMipmaps = false;
  return t;
}

export class Items {
  constructor(track, scene, audio) {
    this.track = track; this.scene = scene; this.audio = audio;
    this.group = new THREE.Group(); scene.add(this.group);
    this.fr = { pos: new THREE.Vector3(), T: new THREE.Vector3(), U: new THREE.Vector3(), R: new THREE.Vector3(), k: 0 };
    const boxMat = new THREE.SpriteMaterial({ map: boxTex(), alphaTest: 0.5 });
    this.boxes = [];
    for (const u of BOX_SPOTS) for (const d of BOX_D) {
      const mesh = new THREE.Sprite(boxMat);
      mesh.scale.set(2.4, 2.4, 1);
      this.group.add(mesh);
      this.boxes.push({ s: u * track.length, d, mesh, cd: 0, spin: 0 });
    }
    this.orbGeo = new THREE.SphereGeometry(0.8, 16, 12);
    this.orbMat = new THREE.MeshBasicMaterial({ color: 0x35e0ff });
    this.slickGeo = new THREE.CircleGeometry(2.0, 20); this.slickGeo.rotateX(-Math.PI / 2);
    this.slickMat = new THREE.MeshLambertMaterial({ color: 0x120a1c, emissive: 0x2b0f55 });
    this.hazards = []; this.orbs = []; this.time = 0;
  }

  reset() {
    for (const h of this.hazards) this.group.remove(h.mesh);
    for (const o of this.orbs) this.group.remove(o.mesh);
    this.hazards = []; this.orbs = [];
    for (const b of this.boxes) { b.cd = 0; b.mesh.visible = true; }
  }

  place(mesh, s, d, h, yaw = 0) {
    const f = this.track.frameAt(s, this.fr);
    mesh.position.copy(f.pos).addScaledVector(f.R, d).addScaledVector(f.U, h);
    mesh.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(f.R, f.U, f.T.clone().negate()));
    if (yaw) mesh.rotateY(yaw);
  }

  delta(a, b) { const L = this.track.length; let ds = a - b; if (ds > L / 2) ds -= L; if (ds < -L / 2) ds += L; return ds; }

  roll(kart, karts) {
    const sorted = [...karts].sort((a, b) => b.progress - a.progress);
    const frac = karts.length > 1 ? sorted.indexOf(kart) / (karts.length - 1) : 0;   // 0 = leader
    const wTurbo = 0.3 + 0.15 * frac, wOrb = 0.15 + 0.4 * frac;
    const r = Math.random();
    return r < wTurbo ? 'turbo' : r < wTurbo + wOrb ? 'orb' : 'slick';
  }

  use(kart) {
    if (!kart.item) return;
    const L = this.track.length;
    if (kart.item === 'turbo') {
      kart.boost = Math.max(kart.boost, 1.8); kart.v += 6; this.audio.sfx('turbo');
    } else if (kart.item === 'slick') {
      const mesh = new THREE.Mesh(this.slickGeo, this.slickMat);
      mesh.receiveShadow = true;
      this.group.add(mesh);
      const s = (kart.s - 5 + L) % L;
      this.place(mesh, s, kart.d, 0.12);
      this.hazards.push({ s, d: kart.d, mesh, ttl: 30 });
      this.audio.sfx('drop');
    } else if (kart.item === 'orb') {
      const mesh = new THREE.Mesh(this.orbGeo, this.orbMat);
      this.group.add(mesh);
      this.orbs.push({ s: (kart.s + 4) % L, d: kart.d, owner: kart, mesh, ttl: 7 });
      this.audio.sfx('launch');
    }
    kart.item = null;
  }

  hit(kart) {
    if (kart.spin > 0 || kart.invuln > 0) return false;
    kart.spin = 1.1; kart.invuln = 2.2; kart.v *= 0.3; kart.drift = 0; kart.boost = 0;
    this.audio.sfx('hit');
    return true;
  }

  aiUse(kart, karts, dt) {
    if (!kart.item || kart.spin > 0) return;
    kart.itemTimer -= dt;
    if (kart.itemTimer > 0) return;
    if (kart.item === 'turbo') return this.use(kart);
    for (const o of karts) {
      if (o === kart) continue;
      const ds = this.delta(o.s, kart.s);
      if (kart.item === 'orb' && ds > 8 && ds < 90) return this.use(kart);
      if (kart.item === 'slick' && ds < -4 && ds > -25 && Math.abs(o.d - kart.d) < 6) return this.use(kart);
    }
    if (kart.itemTimer < -8) this.use(kart);   // don't hoard forever
  }

  update(dt, karts) {
    this.time += dt;
    for (const b of this.boxes) {
      if (b.cd > 0) { b.cd -= dt; b.mesh.visible = b.cd <= 0; }
      b.spin += 1.6 * dt;
      this.place(b.mesh, b.s, b.d, 1.6 + Math.sin(this.time * 2 + b.s) * 0.2, b.spin);
      if (b.cd > 0) continue;
      for (const k of karts) {
        if (k.item || k.spin > 0) continue;
        if (Math.abs(this.delta(k.s, b.s)) < 2.5 && Math.abs(k.d - b.d) < 2.5) {
          k.item = this.roll(k, karts); k.itemTimer = 0.8 + Math.random() * 2.2;
          b.cd = BOX_RESPAWN; b.mesh.visible = false;
          if (k.isPlayer) this.audio.sfx('pickup');
          break;
        }
      }
    }
    for (const k of karts) k.invuln = Math.max(0, k.invuln - dt);
    // slicks
    for (let i = this.hazards.length - 1; i >= 0; i--) {
      const h = this.hazards[i]; h.ttl -= dt; let gone = h.ttl <= 0;
      for (const k of karts) {
        if (!gone && Math.abs(this.delta(k.s, h.s)) < 2.2 && Math.abs(k.d - h.d) < 2.4 && this.hit(k)) gone = true;
      }
      if (gone) { this.group.remove(h.mesh); this.hazards.splice(i, 1); }
    }
    // seeker orbs
    for (let i = this.orbs.length - 1; i >= 0; i--) {
      const o = this.orbs[i]; o.ttl -= dt; let gone = o.ttl <= 0;
      let target = null, best = 120;
      for (const k of karts) {
        if (k === o.owner) continue;
        const ds = this.delta(k.s, o.s);
        if (ds > -2 && ds < best) { best = ds; target = k; }
      }
      o.s = (o.s + 75 * dt + this.track.length) % this.track.length;
      if (target) o.d += THREE.MathUtils.clamp(target.d - o.d, -18 * dt, 18 * dt);
      o.d = THREE.MathUtils.clamp(o.d, -10, 10);
      for (const k of karts) {
        if (k === o.owner || gone) continue;
        if (Math.abs(this.delta(k.s, o.s)) < 2.4 && Math.abs(k.d - o.d) < 2.2) { this.hit(k); gone = true; }
      }
      this.place(o.mesh, o.s, o.d, 1.0);
      if (gone) { this.group.remove(o.mesh); this.orbs.splice(i, 1); }
    }
  }
}
