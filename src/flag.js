import * as THREE from 'three';

// Title-screen checkered flag: START_MENU_FLAG (menu_items.c render_checkered_flag + code_800AF9B0.c
// func_800B0004). A 12x10 grid of 84-unit quads (x -504..504, y -420..420) rippled in z by
// sins(phase - col*0x9C0) * 84 * col * 0.18 and drooping by -0.07*col^2; black/white in 2x2-quad
// cells ((col/2 + row/2) & 1). Lit (G_LIGHTING, PRIMITIVE*SHADE) by light D_800E8688 (white, dir
// 40,40,20) + ambient D_800E8680 (31), normals from row-0 face normals averaged with the
// neighbouring column strips (func_800AFF58). Placed with rotX -51, rotY -12, rotZ -18, scale 1,
// translate (-270, 750, 0); perspective 45deg 4:3 near 100 far 12800, eye (0,0,1800).
// Light direction is in eye space: the microcode brings it into model space through the inverse
// transpose of the modelview 3x3, which is what Three's normalMatrix does for the normal instead.
// Phase steps 0x9C0 per frame; assumption: 30 Hz like other menu animation.
export const FLAG_COLS = 12, FLAG_ROWS = 10, FLAG_STEP = 0x9C0;
const sins = a => Math.sin(((a & 0xffff) / 65536) * Math.PI * 2);

// Positions for one frame (func_800AF9E4): 4 verts per quad, quad (row,col) at (row*12+col)*4,
// vertex i: x = left/right (i%2), y = bottom (i<2) / top, z = res1 (even i) / res2 (odd i).
export function flagPositions(phase, out = new Float32Array(FLAG_COLS * FLAG_ROWS * 12)) {
  for (let row = 0; row < FLAG_ROWS; row++) for (let col = 0; col < FLAG_COLS; col++) {
    const res1 = Math.trunc(sins(phase - col * FLAG_STEP) * 84 * col * 0.18);
    const res2 = Math.trunc(sins(phase - (col + 1) * FLAG_STEP) * 84 * (col + 1) * 0.18);
    for (let i = 0; i < 4; i++) {
      const o = ((row * FLAG_COLS + col) * 4 + i) * 3;
      out[o] = (i % 2) * 84 + col * 84 - 504;
      let y = row * 84 - 420 + (i >= 2 ? 84 : 0);
      y += Math.trunc((i % 2 === 0 ? col * col : (col + 1) * (col + 1)) * -0.07);
      out[o + 1] = y;
      out[o + 2] = i % 2 === 0 ? res1 : res2;
    }
  }
  return out;
}

// func_800AFF58: face normal (v2-v1)x(v0-v2) of each column's row-0 quad, then each column's left
// verts get avg(n[col-1], n[col]) and right verts avg(n[col], n[col+1]) (clamped at the ends).
export function flagNormals(pos, out = new Float32Array(pos.length)) {
  const n = [];
  for (let col = 0; col < FLAG_COLS; col++) {
    const v = i => pos.subarray((col * 4 + i) * 3, (col * 4 + i) * 3 + 3);
    const a = v(1), b = v(2), c = v(0);
    const ab = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], bc = [c[0] - b[0], c[1] - b[1], c[2] - b[2]];
    const d = [ab[1] * bc[2] - ab[2] * bc[1], ab[2] * bc[0] - ab[0] * bc[2], ab[0] * bc[1] - ab[1] * bc[0]];
    const len = Math.max(Math.hypot(...d), 0.001);
    n.push(d.map(x => Math.trunc(x / len * 120)));
  }
  for (let col = 0; col < FLAG_COLS; col++) {
    const l = n[Math.max(col - 1, 0)], m = n[col], r = n[Math.min(col + 1, FLAG_COLS - 1)];
    const left = l.map((x, k) => Math.trunc((x + m[k]) / 2)), right = r.map((x, k) => Math.trunc((x + m[k]) / 2));
    for (let row = 0; row < FLAG_ROWS; row++) for (let i = 0; i < 4; i++) {
      out.set(i % 2 === 0 ? left : right, ((row * FLAG_COLS + col) * 4 + i) * 3);
    }
  }
  return out;
}

export const flagIsWhite = (row, col) => (((col >> 1) + (row >> 1)) & 1) !== 0;

export function createTitleFlag(canvas) {
  const renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: false });
  renderer.setPixelRatio(1);
  renderer.setSize(320, 240, false);
  renderer.setClearColor(0x000000, 0);
  const camera = new THREE.PerspectiveCamera(45, 4 / 3, 100, 12800);
  camera.position.set(0, 0, 1800); camera.lookAt(0, 0, 0);

  const quads = FLAG_COLS * FLAG_ROWS;
  const geo = new THREE.BufferGeometry();
  const pos = new THREE.BufferAttribute(new Float32Array(quads * 12), 3);
  const nrm = new THREE.BufferAttribute(new Float32Array(quads * 12), 3);
  const prim = new Float32Array(quads * 4), idx = [];
  for (let q = 0; q < quads; q++) {
    prim.fill(flagIsWhite(Math.floor(q / FLAG_COLS), q % FLAG_COLS) ? 1 : 0, q * 4, q * 4 + 4);
    idx.push(q * 4 + 1, q * 4 + 2, q * 4, q * 4 + 3, q * 4 + 2, q * 4 + 1);   // gSP1Triangle 1,2,0 / 3,2,1
  }
  geo.setAttribute('position', pos);
  geo.setAttribute('normal', nrm);
  geo.setAttribute('prim', new THREE.BufferAttribute(prim, 1));
  geo.setIndex(idx);
  const mesh = new THREE.Mesh(geo, new THREE.ShaderMaterial({
    side: THREE.DoubleSide,
    uniforms: { lightDir: { value: new THREE.Vector3(40, 40, 20).normalize() }, ambient: { value: 31 / 255 } },
    vertexShader: `attribute float prim; uniform vec3 lightDir; uniform float ambient; varying float v;
      void main(){
        float shade = clamp(ambient + max(dot(normalize(normalMatrix * normal), lightDir), 0.), 0., 1.);
        v = prim * shade;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.);
      }`,
    fragmentShader: 'varying float v; void main(){ gl_FragColor = vec4(vec3(v), 1.); }',
  }));
  mesh.frustumCulled = false;
  mesh.matrixAutoUpdate = false;
  const d = THREE.MathUtils.degToRad;
  mesh.matrix.makeRotationX(d(-51))
    .multiply(new THREE.Matrix4().makeRotationY(d(-12)))
    .multiply(new THREE.Matrix4().makeRotationZ(d(-18)))
    .multiply(new THREE.Matrix4().makeScale(1, 1, 1))
    .multiply(new THREE.Matrix4().makeTranslation(-270, 750, 0));
  const scene = new THREE.Scene();
  scene.add(mesh);

  let lastFrame = -1, phase = 0;
  const draw = () => renderer.render(scene, camera);
  return {
    mesh, camera, draw,
    setScale(s) { renderer.setPixelRatio(s); renderer.setSize(320, 240, false); draw(); },   // HD presets
    get phase() { return phase; },
    step(now) {
      const f = Math.floor(now / 1000 * 30);
      if (f === lastFrame) return;
      lastFrame = f;
      phase = (f * FLAG_STEP) & 0xffff;
      flagPositions(phase, pos.array);
      flagNormals(pos.array, nrm.array);
      pos.needsUpdate = nrm.needsUpdate = true;
      draw();
    },
  };
}
