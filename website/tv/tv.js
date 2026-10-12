// Hero: the animated title GIF playing on a 3D tube TV (Poly Haven "Television 01", CC0).
// Bundled by `npm run build:tv` into website/public/tv/tv.js. If WebGL or the model fails, the plain <img> stays.
import { WebGLRenderer, Scene, PerspectiveCamera, HemisphereLight, DirectionalLight, CanvasTexture, MeshBasicMaterial, SRGBColorSpace, Group } from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { parseGIF, decompressFrame } from 'gifuct-js';

// Glass of the CRT in model space (found from the mesh: a 4:3 domed grid in its own UV island).
const GLASS = { x0: -0.257, x1: 0.126, y0: 0.114, y1: 0.404, u0: 0.03, u1: 0.35, v0: 0.71, v1: 0.955 };

const link = document.querySelector('.mk-screen');
const img = link?.querySelector('img');
if (link && img) start().catch(() => {});

async function start() {
  const renderer = new WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.outputColorSpace = SRGBColorSpace;

  // The GIF is painted into this canvas every frame; scanlines are added in the glass shader.
  const screen = document.createElement('canvas');
  screen.width = 640; screen.height = 480;
  const ctx = screen.getContext('2d');
  const tex = new CanvasTexture(screen);
  tex.colorSpace = SRGBColorSpace;
  const nextFrame = await gifFrames(img.currentSrc || img.src);

  const gltf = await new GLTFLoader().loadAsync('/tv/Television_01_1k.gltf');
  const mesh = gltf.scene.getObjectByProperty('isMesh', true);
  const glassMat = new MeshBasicMaterial({ map: tex, toneMapped: false });
  const uTime = { value: 0 };
  // Scanlines + vertical-sync roll in the glass shader (like the BadTV shader's rollSpeed): the line
  // pattern crawls down and a brighter refresh band sweeps top to bottom every few seconds.
  glassMat.onBeforeCompile = (s) => {
    s.uniforms.uTime = uTime;
    s.fragmentShader = 'uniform float uTime;\n' + s.fragmentShader.replace('#include <map_fragment>', `#include <map_fragment>
      float y = 1.0 - vMapUv.y;
      float line = step(0.6, fract(y * 96.0 - uTime * 0.6));
      float d = fract(y - uTime * 0.18);
      float band = smoothstep(0.0, 0.12, d) * (1.0 - smoothstep(0.12, 0.2, d));
      diffuseColor.rgb *= (1.0 - 0.25 * line * (1.0 - 0.6 * band)) * (1.0 + 0.18 * band);`);
  };
  splitGlass(mesh, glassMat);

  const scene = new Scene();
  scene.add(new HemisphereLight(0xfff4e6, 0x3b1d4a, 1.6));
  const key = new DirectionalLight(0xffffff, 2.2); key.position.set(-1, 1.5, 2); scene.add(key);
  const rim = new DirectionalLight(0xec4899, 2.5); rim.position.set(1.5, 0.5, -1); scene.add(rim);
  const tv = new Group(); tv.add(gltf.scene); gltf.scene.position.set(0, -0.23, 0); scene.add(tv);
  const camera = new PerspectiveCamera(28, 4 / 3, 0.1, 10);
  camera.position.set(0, 0.02, 1.5);

  link.classList.add('tv');
  link.prepend(renderer.domElement);

  // Turn toward the pointer while hovered; idle sway otherwise.
  let aimX = 0, aimY = 0, hover = false;
  link.addEventListener('pointermove', (e) => {
    const r = link.getBoundingClientRect();
    aimX = (e.clientX - r.left) / r.width - 0.5; aimY = (e.clientY - r.top) / r.height - 0.5; hover = true;
  });
  link.addEventListener('pointerleave', () => { hover = false; });

  let w = 0, h = 0, rx = 0, ry = 0;
  renderer.setAnimationLoop((t) => {
    const cw = renderer.domElement.clientWidth, ch = Math.round(cw * 3 / 4);
    if (cw !== w || ch !== h) { w = cw; h = ch; renderer.setSize(w, h, false); }
    nextFrame(ctx, t);
    uTime.value = t / 1000;
    tex.needsUpdate = true;
    const ty = hover ? aimX * 0.6 : -0.28 + Math.sin(t / 2400) * 0.12;
    const tx = hover ? aimY * 0.3 : 0.06 + Math.sin(t / 3100) * 0.04;
    ry += (ty - ry) * 0.06; rx += (tx - rx) * 0.06;
    tv.rotation.set(rx, ry, 0);
    renderer.render(scene, camera);
  });
}

// Move the glass triangles into their own material group and give them a 0..1 planar UV for the GIF.
function splitGlass(mesh, glassMat) {
  const g = mesh.geometry, pos = g.attributes.position, uv = g.attributes.uv, idx = g.index.array;
  const isGlass = (v) => {
    const x = pos.getX(v), y = pos.getY(v), u = uv.getX(v), w = uv.getY(v);
    return x >= GLASS.x0 - 1e-3 && x <= GLASS.x1 + 1e-3 && y >= GLASS.y0 - 1e-3 && y <= GLASS.y1 + 1e-3 &&
      u >= GLASS.u0 && u <= GLASS.u1 && w >= GLASS.v0 && w <= GLASS.v1;
  };
  const body = [], glass = [];
  for (let i = 0; i < idx.length; i += 3) {
    const tri = [idx[i], idx[i + 1], idx[i + 2]];
    (tri.every(isGlass) ? glass : body).push(...tri);
  }
  // GLTFLoader textures use flipY=false, so the body keeps its UVs; the CanvasTexture is flipY=true, so v runs up with y.
  for (const v of new Set(glass)) uv.setXY(v, (pos.getX(v) - GLASS.x0) / (GLASS.x1 - GLASS.x0), (pos.getY(v) - GLASS.y0) / (GLASS.y1 - GLASS.y0));
  g.setIndex([...body, ...glass]);
  g.clearGroups();
  g.addGroup(0, body.length, 0);
  g.addGroup(body.length, glass.length, 1);
  mesh.material = [mesh.material, glassMat];
}

// Returns draw(ctx, timeMs) that paints the GIF frame due at that time. Decoded in JS (gifuct-js), one
// frame at a time onto a 640x480 composite: browsers won't hand WebGL an animated <img>'s current frame
// (Safari's drawImage always gives the first one).
async function gifFrames(src) {
  const gif = parseGIF(await (await fetch(src)).arrayBuffer());
  const frames = gif.frames.filter((f) => f.image);
  const comp = document.createElement('canvas');
  comp.width = gif.lsd.width; comp.height = gif.lsd.height;
  const cc = comp.getContext('2d');
  const patch = document.createElement('canvas'), pc = patch.getContext('2d');
  let index = -1, due = 0, prev = null;
  const step = () => {
    if (prev?.disposalType === 2) cc.clearRect(prev.dims.left, prev.dims.top, prev.dims.width, prev.dims.height);
    index = (index + 1) % frames.length;
    if (index === 0) cc.clearRect(0, 0, comp.width, comp.height);
    const f = decompressFrame(frames[index], gif.gct, true);
    patch.width = f.dims.width; patch.height = f.dims.height;
    pc.putImageData(new ImageData(f.patch, f.dims.width, f.dims.height), 0, 0);
    cc.drawImage(patch, f.dims.left, f.dims.top);
    prev = f;
    return f.delay || 100;
  };
  return (ctx, t) => {
    if (t >= due) due = t + Math.max(20, step());
    ctx.drawImage(comp, 0, 0, 640, 480);
  };
}
