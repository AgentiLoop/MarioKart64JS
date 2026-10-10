// Wii kart test: the Mario Kart Wii Standard Kart with the MK64 driver in the seat, as a 3D model in place of the
// MK64 sprite (3 key in a race, Kart.set3D). Collada exports in public/wii/ (tools/build-wii-karts.py): the Wii's
// Small / Medium / Large weight classes are three kart meshes (Toad; Mario, Luigi, Peach, Yoshi; DK, Wario, Bowser)
// with one body texture per character. The body is Blender Z-up metres, the tires and drivers are Y-up centimetres
// facing +z; ColladaLoader puts them all in Y-up metres. The rear tires are the front tire meshes scaled up; tire
// placement is measured from each rip's assembled kart (menu.dae: body + 4 tires). Seats: see CHARS.
import * as THREE from 'three';
import { ColladaLoader } from 'three/examples/jsm/loaders/ColladaLoader.js';

const BASE = import.meta.env?.BASE_URL ?? '/';
const DIR = `${BASE}wii/`;
// Wii metres -> scene units: the kart about as wide as the MK64 sprite reads from behind (kart.js KART_HALF_WIDTH)
const SCALE = 1.9;
const BODY_Y = 0.2;                      // metres the body's origin sits over the ground (all three classes)
const STEER_ANGLE = 0.45;                // rad the front tires turn at full lock
// Per class: the body texture its body.dae names (swapped for the character's), the tire mesh's own radius, each
// axle's half-track / position / tire radius (= axle height) in metres from the body's origin.
const CLASSES = {
  small: { body: 'body_bmr.png', tireRadius: 0.152, tires: [{ x: 0.473, z: 0.25, r: 0.152 }, { x: 0.554, z: -0.53, r: 0.214 }] },
  medium: { body: 'body_mr.png', tireRadius: 0.21, tires: [{ x: 0.48, z: 0.55, r: 0.21 }, { x: 0.58, z: -0.43, r: 0.27 }] },
  large: { body: 'body_wr.png', tireRadius: 0.21, tires: [{ x: 0.635, z: 0.75, r: 0.21 }, { x: 0.708, z: -0.815, r: 0.317 }] },
};
// Per MK64 character: Wii class, body texture, eye texture repeat, seat. The eye textures are one eye; on the Wii a texture
// matrix doubles S and the sampler mirrors it (<wrap_s>MIRROR</wrap_s>) so u 0-0.5 is one eye and 0.5-1 its mirror.
// ColladaLoader drops both, which stretched a single eye across the face. Peach's UVs already run 0-2 and Bowser's
// texture holds both eyes, so they repeat once. seat: [y, z] where the driver's origin (the pose sits him) goes in the cockpit, measured
// so the driver rests in the reclined seat (bottom on the cushion, back on the seat back) instead of floating above it.
const CHARS = {
  mario: { cls: 'medium', body: 'body_mr.png', seat: [0.06, -0.12] },
  luigi: { cls: 'medium', body: 'body_lg.png', seat: [0.07, -0.14] },
  peach: { cls: 'medium', body: 'body_pc.png', eyeRepeat: 1, seat: [0.0, -0.06] },
  toad: { cls: 'small', body: 'body_ko.png', seat: [0.07, 0] },
  yoshi: { cls: 'medium', body: 'body_ys.png', seat: [0.11, -0.1] },
  donkeykong: { cls: 'large', body: 'body_dk.png', seat: [0.13, -0.02] },
  wario: { cls: 'large', body: 'body_wr.png', seat: [0.115, -0.12] },
  bowser: { cls: 'large', body: 'body_kp.png', eyeRepeat: 1, seat: [0.15, 0.06] },
};

const cache = new Map();
// textures: file name -> file name swaps (the class body.dae names one character's livery; black tires);
// eyeRepeat: the driver's eye texture repeat, see CHARS
function load(file, textures = {}, eyeRepeat = 2) {
  const key = `${file}|${JSON.stringify(textures)}`;
  if (cache.has(key)) return cache.get(key);
  const manager = new THREE.LoadingManager();
  manager.setURLModifier(url => {
    const name = url.slice(url.lastIndexOf('/') + 1);
    return textures[name] ? url.slice(0, url.lastIndexOf('/') + 1) + textures[name] : url;
  });
  const loader = new ColladaLoader(manager);
  const p = new Promise((resolve, reject) => loader.load(`${DIR}${file}`, c => resolve(prepare(c.scene, eyeRepeat)), undefined, reject));
  cache.set(key, p);
  return p;
}

// Every part is skinned to a single joint with no pose of its own, so the skin is dropped: a plain mesh under its
// node's transforms. (Skinned, the body came out in the armature's space at 100x: Blender wrote the armature's
// 0.01 scale into the inverse bind matrix, so the skin cancelled the node's scale.)
function prepare(scene, eyeRepeat) {
  const skinned = [];
  scene.traverse(o => { if (o.isSkinnedMesh) skinned.push(o); });
  for (const s of skinned) {
    const m = new THREE.Mesh(s.geometry, s.material);
    m.position.copy(s.position); m.quaternion.copy(s.quaternion); m.scale.copy(s.scale);
    s.parent.add(m); s.parent.remove(s);
  }
  scene.traverse(o => {
    if (!o.isMesh) return;
    o.castShadow = true;   // a real shadow on the course (main.js sun, Track.setShadowCatchers) instead of the sprite's blob
    for (const m of Array.isArray(o.material) ? o.material : [o.material]) {
      m.side = THREE.DoubleSide;
      if (m.map) { m.map.colorSpace = THREE.SRGBColorSpace; m.map.magFilter = THREE.LinearFilter; }
      if (m.map && m.name.endsWith('_eye_tx')) { m.map.wrapS = THREE.MirroredRepeatWrapping; m.map.repeat.x = eyeRepeat; }
      // the body's front bumper runs v below 0 and relies on the Wii's mirrored T wrap to stay red with the white
      // stripe (ColladaLoader repeats it, which pulled the texture's top rows of other parts onto the bumper)
      if (m.map && m.name === 'mat_body') m.map.wrapT = THREE.MirroredRepeatWrapping;
    }
    // the side pods' UVs (u 1-1.32, v 0.5-0.78 in all three classes) put the emblem against the panel's top edge with a
    // band of livery below it: move them 10 texels up the texture so the emblem sits in the middle of the panel
    const uv = o.geometry.attributes.uv;
    if (uv && [].concat(o.material).some(m => m.name === 'mat_body')) {
      for (let i = 0; i < uv.count; i++) {
        const u = uv.getX(i), v = uv.getY(i);
        if (u > 1 && u < 1.32 && v > 0.5 && v < 0.78) uv.setY(i, v + 10 / 128);
      }
      uv.needsUpdate = true;
    }
  });
  return scene;
}

// Resolves to a Group at the kart's ground point, facing -z (the kart meshes' forward), with
// userData.update(steer, v, dt) for the tire spin and front steering.
export async function buildWiiKart(character = 'mario') {
  const ch = CHARS[character] ?? CHARS.mario, cls = CLASSES[ch.cls];
  const kart = `kart/${ch.cls}/`, textures = { [cls.body]: ch.body, 'tire.png': 'tire_black.png' };
  const [body, tireL, tireR, driver] = (await Promise.all([
    load(`${kart}body.dae`, textures), load(`${kart}tire_fl.dae`, textures), load(`${kart}tire_fr.dae`, textures),
    load(`${character}/model.dae`, {}, ch.eyeRepeat ?? 2),
  ])).map(s => s.clone(true));
  const g = new THREE.Group();
  const wii = new THREE.Group();   // Wii metres, facing +z
  wii.rotation.y = Math.PI;
  wii.scale.setScalar(SCALE);
  g.add(wii);
  body.position.y = BODY_Y;
  wii.add(body);
  const tires = [], fronts = [];
  for (const [i, axle] of cls.tires.entries()) {
    // tire_fl's hub faces +x, the kart's left (facing +z)
    for (const [side, src] of [[1, tireL], [-1, tireR]]) {
      const steer = new THREE.Group();   // yaws about the king pin
      steer.position.set(side * axle.x, axle.r, axle.z);
      const spin = new THREE.Group();    // rolls about the axle
      spin.scale.setScalar(axle.r / cls.tireRadius);
      spin.add(i === 0 ? src : src.clone(true));
      steer.add(spin);
      wii.add(steer);
      tires.push({ spin, r: axle.r });
      if (i === 0) fronts.push(steer);
    }
  }
  driver.position.set(0, ...ch.seat);
  wii.add(driver);
  g.userData.update = (steer, v, dt) => {
    for (const t of tires) t.spin.rotation.x += v * dt / (t.r * SCALE);
    for (const f of fronts) f.rotation.y = -steer * STEER_ANGLE;
  };
  // wall body (Kart.routeWallPush): a capsule, one circle over each axle's 70% (the circles' ends then reach about the
  // nose and tail), as wide as the rear track plus the tire's half-width; scene units along the heading
  const [fa, ra] = cls.tires;
  g.userData.capsule = { front: fa.z * SCALE * 0.7, rear: ra.z * SCALE * 0.7, r: ra.x * SCALE + 0.15 };
  return g;
}
