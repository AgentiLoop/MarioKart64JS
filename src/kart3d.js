// Wii kart test: the Mario Kart Wii Standard Kart (Medium) in red with Mario in the seat, as a 3D model in place of
// the MK64 sprite (3 key in a race, Kart.set3D). Collada exports in public/wii/: the body is Blender Z-up metres, the
// tires and Mario are Y-up centimetres facing +z; ColladaLoader puts all three in Y-up metres. The rear tires reuse
// the front tire meshes. Positions are tuned by eye (the export carries no wheel bones).
import * as THREE from 'three';
import { ColladaLoader } from 'three/examples/jsm/loaders/ColladaLoader.js';

const BASE = import.meta.env?.BASE_URL ?? '/';
const DIR = `${BASE}wii/`;
// Wii metres -> scene units: the kart about as wide as the MK64 sprite reads from behind (kart.js KART_HALF_WIDTH)
const SCALE = 1.9;
const TIRE_RADIUS = 0.21;                // metres, the tire mesh's own radius
const TIRE_X = 0.58, TIRE_Z = [0.82, -0.78];   // metres from the body's origin: axle half-track, front / rear axle
const BODY_Y = 0.2;                      // metres the body's origin sits over the ground
const DRIVER = new THREE.Vector3(0, 0.26, -0.22);   // Mario's origin (his seat, the pose sits him) in the cockpit
const STEER_ANGLE = 0.45;                // rad the front tires turn at full lock
const TEXTURES = { 'body_mr.png': 'body_red.png', 'tire.png': 'tire_black.png' };

let cached = null;
function loadParts() {
  if (cached) return cached;
  const manager = new THREE.LoadingManager();
  manager.setURLModifier(url => {
    const name = url.slice(url.lastIndexOf('/') + 1);
    return TEXTURES[name] ? url.slice(0, url.lastIndexOf('/') + 1) + TEXTURES[name] : url;
  });
  const loader = new ColladaLoader(manager);
  const load = file => new Promise((resolve, reject) => loader.load(`${DIR}${file}`, c => resolve(prepare(c.scene)), undefined, reject));
  cached = Promise.all([load('kart/body.dae'), load('kart/tire_fl.dae'), load('kart/tire_fr.dae'), load('mario/model.dae')]);
  return cached;
}

// Every part is skinned to a single joint with no pose of its own, so the skin is dropped: a plain mesh under its
// node's transforms. (Skinned, the body came out in the armature's space at 100x: Blender wrote the armature's
// 0.01 scale into the inverse bind matrix, so the skin cancelled the node's scale.)
function prepare(scene) {
  const skinned = [];
  scene.traverse(o => { if (o.isSkinnedMesh) skinned.push(o); });
  for (const s of skinned) {
    const m = new THREE.Mesh(s.geometry, s.material);
    m.position.copy(s.position); m.quaternion.copy(s.quaternion); m.scale.copy(s.scale);
    s.parent.add(m); s.parent.remove(s);
  }
  scene.traverse(o => {
    if (!o.isMesh) return;
    for (const m of Array.isArray(o.material) ? o.material : [o.material]) {
      m.side = THREE.DoubleSide;
      if (m.map) { m.map.colorSpace = THREE.SRGBColorSpace; m.map.magFilter = THREE.LinearFilter; }
      // The eye texture is one eye (32px wide). On the Wii a texture matrix doubles S and the sampler mirrors it
      // (<wrap_s>MIRROR</wrap_s>), so u 0-0.5 is one eye and 0.5-1 its mirror; ColladaLoader drops both, which
      // stretched a single eye across the face.
      if (m.map && m.name === 'mario_eye_tx') { m.map.wrapS = THREE.MirroredRepeatWrapping; m.map.repeat.x = 2; }
    }
  });
  return scene;
}

// Resolves to a Group at the kart's ground point, facing -z (the kart meshes' forward), with
// userData.update(steer, v, dt) for the tire spin and front steering.
export async function buildWiiKart() {
  const [body, tireL, tireR, mario] = (await loadParts()).map(s => s.clone(true));
  const g = new THREE.Group();
  const wii = new THREE.Group();   // Wii metres, facing +z
  wii.rotation.y = Math.PI;
  wii.scale.setScalar(SCALE);
  g.add(wii);
  body.position.y = BODY_Y;
  wii.add(body);
  const tires = [], fronts = [];
  for (const [i, z] of TIRE_Z.entries()) {
    for (const [side, src] of [[-1, tireL], [1, tireR]]) {
      const steer = new THREE.Group();   // yaws about the king pin
      steer.position.set(side * TIRE_X, TIRE_RADIUS, z);
      const spin = new THREE.Group();    // rolls about the axle
      spin.add(i === 0 ? src : src.clone(true));
      steer.add(spin);
      wii.add(steer);
      tires.push(spin);
      if (i === 0) fronts.push(steer);
    }
  }
  mario.position.copy(DRIVER);
  wii.add(mario);
  g.userData.update = (steer, v, dt) => {
    const roll = v * dt / (TIRE_RADIUS * SCALE);
    for (const t of tires) t.rotation.x += roll;
    for (const f of fronts) f.rotation.y = -steer * STEER_ANGLE;
  };
  return g;
}
