import * as THREE from 'three';

// Track defined as a closed 3D spline (x, y=elevation, z). Banking is derived
// automatically from horizontal curvature so hills, dips and camber all fall out
// of the control points.
export const TRACKS = [
  {
    id: 'meadow', name: 'Meadow Circuit', blurb: 'Rolling green hills, gentle banking. Good for learning.',
    control: [
      [0, 0, 0], [100, 0, 10], [200, 4, -20], [290, 14, -80], [330, 26, -170],
      [300, 30, -260], [220, 22, -320], [130, 8, -340], [40, 0, -310],
      [-30, -6, -250], [-120, -8, -230], [-210, 0, -250], [-290, 12, -200],
      [-320, 20, -110], [-280, 12, -30], [-190, 4, 20], [-100, 0, 30],
    ],
    padSpots: [[0.12, 0], [0.33, -4], [0.33, 4], [0.58, 0], [0.82, -5], [0.82, 5]],
    theme: {
      road: '#3b3d44', grass: '#3f8f3a', curbA: '#d8222b', curbB: '#fafafa', wallA: '#e9e9ee', wallB: '#2a63c8',
      skyTop: 0x3b8ee8, skyBot: 0xbfe3ff, hemiSky: 0xdff0ff, hemiGround: 0x4a6b3a, sun: 0xfff2d6,
      trunk: 0x6b4423, leaf: 0x1f6b2d, snowCap: false, trees: 380,
    },
  },
  {
    id: 'frost', name: 'Frost Ridge', blurb: 'Long climb to a snowy summit, then a fast plunge. Sweeping bends.',
    control: [
      [0, 0, 0], [120, 0, -15], [240, -6, -60], [320, -14, -150], [320, -8, -250],
      [250, 6, -330], [150, 22, -360], [60, 34, -410], [-30, 44, -450], [-140, 46, -430],
      [-235, 38, -360], [-275, 24, -260], [-285, 10, -150], [-235, 2, -60], [-130, 0, -10],
    ],
    padSpots: [[0.08, 0], [0.30, -4], [0.30, 4], [0.52, 0], [0.74, -5], [0.74, 5], [0.92, 0]],
    theme: {
      road: '#454a58', grass: '#e8f1fa', curbA: '#2a63c8', curbB: '#fafafa', wallA: '#cfe3f5', wallB: '#e0482f',
      skyTop: 0x5a7fb5, skyBot: 0xdce8f4, hemiSky: 0xe8f1ff, hemiGround: 0x8fa0b8, sun: 0xfff8ec,
      trunk: 0x4a3322, leaf: 0x2c6b52, snowCap: true, trees: 300,
    },
  },
  {
    id: 'dunes', name: 'Sunset Dunes', blurb: 'Hot desert sprint with tight hairpins and rolling dune jumps.',
    control: [
      [0, 0, 0], [110, 2, 20], [210, 8, 10], [290, 14, -40], [310, 10, -120],
      [260, 4, -180], [180, 0, -200], [120, 6, -250], [130, 16, -330], [200, 22, -390],
      [120, 20, -450], [10, 12, -430], [-70, 6, -370], [-60, 0, -290], [-150, -4, -250],
      [-250, 2, -270], [-320, 10, -210], [-300, 8, -110], [-220, 2, -50], [-110, 0, -20],
    ],
    padSpots: [[0.10, 0], [0.28, -4], [0.28, 4], [0.47, 0], [0.66, -5], [0.66, 5], [0.88, 0]],
    theme: {
      road: '#4a443f', grass: '#d9a55b', curbA: '#e8731c', curbB: '#fff1d6', wallA: '#f0d9a8', wallB: '#b8452a',
      skyTop: 0xe0703a, skyBot: 0xffd9a0, hemiSky: 0xffe2b8, hemiGround: 0xa87a40, sun: 0xffc27a,
      trunk: 0x5a3a1c, leaf: 0x4f7a2a, snowCap: false, trees: 90,
    },
  },
];

export const HALF_WIDTH = 11;   // drivable asphalt half-width
export const WALL_D = 19;       // lateral distance of guard walls
const SAMPLES = 900;

function canvasTex(w, h, draw, repeatX = 1, repeatY = 1) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(repeatX, repeatY);
  t.anisotropy = 1; t.generateMipmaps = false; t.minFilter = THREE.LinearFilter;   // N64-ish: no mipmaps
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function noise(ctx, w, h, n, alpha) {
  for (let i = 0; i < n; i++) {
    const g = Math.random() * 255 | 0;
    ctx.fillStyle = `rgba(${g},${g},${g},${alpha})`;
    ctx.fillRect(Math.random() * w, Math.random() * h, 2, 2);
  }
}

export class Track {
  constructor(def = TRACKS[0]) {
    this.def = def; this.theme = def.theme;
    const pts = def.control.map(p => new THREE.Vector3(...p));
    this.curve = new THREE.CatmullRomCurve3(pts, true, 'centripetal');
    this.length = this.curve.getLength();
    this.n = SAMPLES;
    this.ds = this.length / SAMPLES;
    this.pos = []; this.T = []; this.U = []; this.R = []; this.kU = [];
    this._build();
    this.group = new THREE.Group();
    this._buildMeshes();
  }

  _build() {
    const n = this.n;
    for (let i = 0; i < n; i++) {
      this.pos.push(this.curve.getPointAt(i / n));
      this.T.push(this.curve.getTangentAt(i / n).normalize());
    }
    // horizontal curvature -> bank angle (smoothed)
    let bank = new Array(n).fill(0);
    for (let i = 0; i < n; i++) {
      const a = this.T[(i + n - 3) % n], b = this.T[(i + 3) % n];
      const kappa = new THREE.Vector3().crossVectors(a, b).y / (6 * this.ds);
      bank[i] = THREE.MathUtils.clamp(kappa * 55, -0.4, 0.4);
    }
    for (let pass = 0; pass < 4; pass++) {
      const nb = bank.slice();
      for (let i = 0; i < n; i++) {
        let s = 0;
        for (let k = -12; k <= 12; k++) s += bank[(i + k + n) % n];
        nb[i] = s / 25;
      }
      bank = nb;
    }
    this.bank = bank;
    const Y = new THREE.Vector3(0, 1, 0);
    for (let i = 0; i < n; i++) {
      const T = this.T[i];
      const r0 = new THREE.Vector3().crossVectors(T, Y).normalize();
      const up0 = new THREE.Vector3().crossVectors(r0, T).normalize();
      const U = up0.clone().multiplyScalar(Math.cos(bank[i])).addScaledVector(r0, -Math.sin(bank[i])).normalize();
      this.U.push(U);
      this.R.push(new THREE.Vector3().crossVectors(T, U).normalize());
    }
    for (let i = 0; i < n; i++) {
      const dT = new THREE.Vector3().subVectors(this.T[(i + 1) % n], this.T[(i + n - 1) % n]).divideScalar(2 * this.ds);
      this.kU.push(dT.dot(this.R[i]));
    }
    this.minY = Math.min(...this.pos.map(p => p.y));
  }

  // Frame at arc-length s (meters): interpolated position/axes/curvature.
  frameAt(s, out) {
    const n = this.n;
    s = ((s % this.length) + this.length) % this.length;
    const f = s / this.ds, i = Math.floor(f) % n, j = (i + 1) % n, t = f - Math.floor(f);
    out.pos.lerpVectors(this.pos[i], this.pos[j], t);
    out.T.lerpVectors(this.T[i], this.T[j], t).normalize();
    out.U.lerpVectors(this.U[i], this.U[j], t).normalize();
    out.R.crossVectors(out.T, out.U).normalize();
    out.k = this.kU[i] * (1 - t) + this.kU[j] * t;
    return out;
  }

  _strip(d0, d1, yOff0, yOff1, mat, vScale, uFlip = false) {
    const n = this.n, pos = [], uv = [], idx = [];
    for (let i = 0; i <= n; i++) {
      const k = i % n, p = this.pos[k], R = this.R[k], U = this.U[k];
      const a = p.clone().addScaledVector(R, d0).addScaledVector(U, yOff0);
      const b = p.clone().addScaledVector(R, d1).addScaledVector(U, yOff1);
      pos.push(a.x, a.y, a.z, b.x, b.y, b.z);
      const v = i * this.ds / vScale;
      uv.push(0, v, 1, v);
      if (i < n) { const o = i * 2; idx.push(o, o + 2, o + 1, o + 1, o + 2, o + 3); }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.setIndex(idx);
    g.computeVertexNormals();
    const m = new THREE.Mesh(g, mat);
    m.receiveShadow = true;
    return m;
  }

  _buildMeshes() {
    const th = this.theme;
    const roadTex = canvasTex(256, 256, (c, w, h) => {
      c.fillStyle = th.road; c.fillRect(0, 0, w, h);
      noise(c, w, h, 5000, 0.08);
      c.fillStyle = '#f2f2f2';
      c.fillRect(6, 0, 6, h); c.fillRect(w - 12, 0, 6, h);
      c.fillStyle = '#e8d34a';
      c.fillRect(w / 2 - 3, 0, 6, h * 0.5);
    });
    const road = this._strip(-HALF_WIDTH, HALF_WIDTH, 0, 0,
      new THREE.MeshLambertMaterial({ map: roadTex }), 16);
    this.group.add(road);

    const curbTex = canvasTex(64, 64, (c, w, h) => {
      c.fillStyle = th.curbA; c.fillRect(0, 0, w, h / 2);
      c.fillStyle = th.curbB; c.fillRect(0, h / 2, w, h / 2);
    });
    const curbMat = new THREE.MeshLambertMaterial({ map: curbTex });
    this.group.add(this._strip(-HALF_WIDTH - 1.5, -HALF_WIDTH, 0.05, 0.05, curbMat, 4));
    this.group.add(this._strip(HALF_WIDTH, HALF_WIDTH + 1.5, 0.05, 0.05, curbMat, 4));

    const grassTex = canvasTex(256, 256, (c, w, h) => {
      c.fillStyle = th.grass; c.fillRect(0, 0, w, h);
      noise(c, w, h, 6000, 0.12);
    });
    const grassMat = new THREE.MeshLambertMaterial({ map: grassTex });
    this.group.add(this._strip(-WALL_D, -HALF_WIDTH - 1.5, -0.05, -0.05, grassMat, 12));
    this.group.add(this._strip(HALF_WIDTH + 1.5, WALL_D, -0.05, -0.05, grassMat, 12));

    // sloped terrain skirt falling away outside the walls
    const skirtMat = new THREE.MeshLambertMaterial({ map: grassTex, side: THREE.DoubleSide });
    this.skirtDrop = 10; this.skirtOut = 80;
    for (const side of [-1, 1]) {
      const n = this.n, pos = [], uv = [], idx = [];
      for (let i = 0; i <= n; i++) {
        const k = i % n, p = this.pos[k], R = this.R[k];
        const hr = new THREE.Vector3(R.x, 0, R.z).normalize();
        const a = p.clone().addScaledVector(R, side * WALL_D).addScaledVector(this.U[k], -0.1);
        const b = p.clone().addScaledVector(hr, side * this.skirtOut); b.y = this.minY - this.skirtDrop - 4;
        pos.push(a.x, a.y, a.z, b.x, b.y, b.z);
        const v = i * this.ds / 12;
        uv.push(0, v, 4, v);
        if (i < n) { const o = i * 2; idx.push(o, o + 2, o + 1, o + 1, o + 2, o + 3); }
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
      g.setIndex(idx); g.computeVertexNormals();
      this.group.add(new THREE.Mesh(g, skirtMat));
    }

    // guard walls
    const wallTex = canvasTex(128, 64, (c, w, h) => {
      c.fillStyle = th.wallA; c.fillRect(0, 0, w, h);
      c.fillStyle = th.wallB; c.fillRect(0, 0, w / 2, h);
    }, 1, 1);
    const wallMat = new THREE.MeshLambertMaterial({ map: wallTex, side: THREE.DoubleSide });
    for (const side of [-1, 1]) {
      this.group.add(this._strip(side * WALL_D, side * WALL_D, 0, 1.6, wallMat, 8));
    }

    // far ground
    const gp = new THREE.Mesh(new THREE.PlaneGeometry(4000, 4000),
      new THREE.MeshLambertMaterial({ map: grassTex.clone() }));
    gp.material.map.repeat.set(300, 300); gp.material.map.needsUpdate = true;
    gp.rotation.x = -Math.PI / 2;
    gp.position.set(0, this.minY - this.skirtDrop - 4.5, -150);
    this.group.add(gp);

    // start/finish line
    const f = this.frameAt(0, { pos: new THREE.Vector3(), T: new THREE.Vector3(), U: new THREE.Vector3(), R: new THREE.Vector3() });
    const lineTex = canvasTex(128, 32, (c, w, h) => {
      for (let x = 0; x < 16; x++) for (let y = 0; y < 4; y++) {
        c.fillStyle = (x + y) % 2 ? '#111' : '#fff'; c.fillRect(x * 8, y * 8, 8, 8);
      }
    });
    const line = new THREE.Mesh(new THREE.PlaneGeometry(HALF_WIDTH * 2, 3),
      new THREE.MeshBasicMaterial({ map: lineTex }));
    const m = new THREE.Matrix4().makeBasis(f.R, f.T, f.U);
    line.quaternion.setFromRotationMatrix(m);
    line.position.copy(f.pos).addScaledVector(f.U, 0.08);
    this.group.add(line);
    const gantry = new THREE.Mesh(new THREE.BoxGeometry(HALF_WIDTH * 2 + 4, 1.4, 1),
      new THREE.MeshLambertMaterial({ map: lineTex }));
    gantry.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(f.R, f.U, f.T));
    gantry.position.copy(f.pos).addScaledVector(f.U, 9);
    this.group.add(gantry);
    for (const side of [-1, 1]) {
      const pole = new THREE.Mesh(new THREE.BoxGeometry(1, 9, 1), new THREE.MeshLambertMaterial({ color: 0xcccccc }));
      pole.position.copy(f.pos).addScaledVector(f.R, side * (HALF_WIDTH + 2)).addScaledVector(f.U, 4.5);
      this.group.add(pole);
    }

    // boost pads
    this.boostPads = [];
    const padTex = canvasTex(64, 128, (c, w, h) => {
      c.fillStyle = '#ff9d00'; c.fillRect(0, 0, w, h);
      c.fillStyle = '#fff3a0';
      for (let k = 0; k < 3; k++) {
        const y = 14 + k * 38;
        c.beginPath(); c.moveTo(w / 2, y); c.lineTo(w - 8, y + 28); c.lineTo(w - 22, y + 28);
        c.lineTo(w / 2, y + 10); c.lineTo(22, y + 28); c.lineTo(8, y + 28); c.closePath(); c.fill();
      }
    });
    const padMat = new THREE.MeshBasicMaterial({ map: padTex });
    const padSpots = this.def.padSpots;
    for (const [u, d] of padSpots) {
      const s = u * this.length;
      const fr = this.frameAt(s, { pos: new THREE.Vector3(), T: new THREE.Vector3(), U: new THREE.Vector3(), R: new THREE.Vector3() });
      const pad = new THREE.Mesh(new THREE.PlaneGeometry(5, 9), padMat);
      pad.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(fr.R, fr.T, fr.U));
      pad.position.copy(fr.pos).addScaledVector(fr.R, d).addScaledVector(fr.U, 0.1);
      this.group.add(pad);
      this.boostPads.push({ s, d, hw: 2.5, hl: 4.5 });
    }

    // trees on the skirt: pixel-art billboard sprites (always face the camera)
    const treeTex = pixelTreeTexture(th);
    const treeMat = new THREE.SpriteMaterial({ map: treeTex, alphaTest: 0.5 });
    const rng = mulberry(7);
    for (let i = 0; i < th.trees; i++) {
      const k = Math.floor(rng() * this.n), side = rng() < 0.5 ? -1 : 1;
      const out = WALL_D + 5 + rng() * 45;
      const p = this.pos[k], R = this.R[k];
      const hr = new THREE.Vector3(R.x, 0, R.z).normalize();
      const x = p.x + hr.x * side * out, z = p.z + hr.z * side * out;
      const t = (out - WALL_D) / (this.skirtOut - WALL_D);
      const yy = p.y + (this.minY - this.skirtDrop - 4 - p.y) * t - 0.1 * (1 - t);
      const sc = 0.8 + rng() * 0.9;
      const sp = new THREE.Sprite(treeMat);
      sp.center.set(0.5, 0);
      sp.scale.set(8 * sc, 12 * sc, 1);
      sp.position.set(x, yy, z);
      this.group.add(sp);
    }
  }
}

function pixelTreeTexture(th) {
  const W = 32, H = 48;
  const c = document.createElement('canvas'); c.width = W; c.height = H;
  const g = c.getContext('2d');
  const hex = (n) => '#' + n.toString(16).padStart(6, '0');
  const shade = (n, f) => `rgb(${Math.min(255, (n >> 16 & 255) * f) | 0},${Math.min(255, (n >> 8 & 255) * f) | 0},${Math.min(255, (n & 255) * f) | 0})`;
  g.fillStyle = hex(th.trunk); g.fillRect(14, 38, 4, 10);
  g.fillStyle = shade(th.trunk, 0.7); g.fillRect(16, 38, 2, 10);
  // three stacked tiers of pixel foliage, lit from the left
  for (const [top, wid] of [[2, 12], [12, 20], [24, 28]]) {
    const hgt = 16;
    for (let y = 0; y < hgt; y++) {
      const w = Math.max(2, Math.round(wid * (y + 1) / hgt));
      const x0 = 16 - (w >> 1);
      for (let x = 0; x < w; x++) {
        const f = x < w * 0.35 ? 1.25 : x > w * 0.7 ? 0.7 : 1.0;
        const dither = ((x + y) & 1) && f !== 1.0 ? 0.92 : 1;
        g.fillStyle = shade(th.leaf, f * dither);
        g.fillRect(x0 + x, top + y, 1, 1);
      }
    }
    if (th.snowCap) {
      g.fillStyle = '#f4f8ff';
      for (let y = 0; y < 5; y++) { const w = Math.max(2, Math.round(wid * (y + 1) / hgt)); g.fillRect(16 - (w >> 1), top + y, w, 1); }
    }
  }
  const t = new THREE.CanvasTexture(c);
  t.magFilter = THREE.NearestFilter; t.minFilter = THREE.NearestFilter; t.generateMipmaps = false;
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function mulberry(a) {
  return () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
}
