// Wii Lakitu test: the Mario Kart Wii Lakitu (jugemu) as a 3D model in place of the MK64 referee sprite when the Wii
// karts are on (3 key, Lakitu.set3D). Collada rips in public/wii/lakitu/ (tools/build-wii-lakitu.py), centimetres
// facing +z, ColladaLoader puts them in Y-up metres. Unlike the karts the parts keep their skins: the body ships
// T-posed and the arms are posed here by turning their bones (left arm up holding the rod, right arm down, or up
// waving the flag). The start signal, lap boards and wrong-way sign hang from the rod's hook, the hair sits on
// ef_head. The referee's sprite frame (lakitu.js ANIMS) drives the lights, the boards' turn and the flag's wave.
import * as THREE from 'three';
import { ColladaLoader } from 'three/examples/jsm/loaders/ColladaLoader.js';
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js';

const BASE = import.meta.env?.BASE_URL ?? '/';
const DIR = `${BASE}wii/lakitu/`;
const SCALE = 1.9;                       // Wii metres -> scene units, as kart3d.js
const CENTRE_Y = 0.34;                   // metres: the middle of body + cloud (y -0.39..1.07) sits on the sprite's anchor
const LINE = 0.25;                       // the fishing line's length as a fraction of the rip's (1 m)
const ARM_L = new THREE.Vector3(-0.1, 0.9, 0.42).normalize();    // left arm: the rod up and forward, the hook over his head
const ARM_R = new THREE.Vector3(-0.4, -0.5, 0.77).normalize();   // right arm: down at his side
const ARM_R_FLAG = new THREE.Vector3(-0.25, 0.9, 0.35).normalize();
const RED = 0xff2a1a, BLUE = 0x2a6cff, OFF = 0x404040;
// lap board number texture: jg_lap.0 = "2", jg_lap.1 = "3" ...
const lapTexture = lap => `jg_lap.${Math.max(0, lap - 2)}.png`;

const cache = new Map();
function load(file, textures = {}) {
  const key = `${file}|${JSON.stringify(textures)}`;
  if (cache.has(key)) return cache.get(key);
  const manager = new THREE.LoadingManager();
  manager.setURLModifier(url => {
    const name = url.slice(url.lastIndexOf('/') + 1);
    return textures[name] ? url.slice(0, url.lastIndexOf('/') + 1) + textures[name] : url;
  });
  const loader = new ColladaLoader(manager);
  // parse() is synchronous: drop only the loader's harmless Z-UP warning and "File version" debug line while it runs
  const parse = loader.parse.bind(loader);
  loader.parse = (...a) => { const w = console.warn, d = console.debug; console.warn = (m, ...r) => { if (!String(m).includes('Z-UP')) w(m, ...r); }; console.debug = (m, ...r) => { if (!String(m).includes('File version')) d(m, ...r); }; try { return parse(...a); } finally { console.warn = w; console.debug = d; } };
  const p = new Promise((resolve, reject) => loader.load(`${DIR}${file}`, c => resolve(c.scene), undefined, reject));
  cache.set(key, p);
  return p;
}

// a fresh copy (skins re-bound to their copied bones) with its own materials
function instance(scene) {
  const s = cloneSkinned(scene);
  s.traverse(o => {
    if (!o.isMesh) return;
    o.frustumCulled = false;
    o.material = Array.isArray(o.material) ? o.material.map(m => m.clone()) : o.material.clone();
    for (const m of Array.isArray(o.material) ? o.material : [o.material]) {
      m.side = THREE.DoubleSide;
      if (m.map) { m.map.colorSpace = THREE.SRGBColorSpace; m.map.magFilter = THREE.LinearFilter; }
      if (m.name === 'jugem_glass') { m.transparent = true; m.depthWrite = false; }
      if (m.name.startsWith('lightb')) { m.transparent = true; m.depthWrite = false; m.blending = THREE.AdditiveBlending; }
      else o.castShadow = true;
    }
  });
  return s;
}

// the rotation that turns a bone so the direction `from` (in the model's space) becomes `to`, keeping its parents
const _q = new THREE.Quaternion(), _p = new THREE.Quaternion();
function aim(bone, root, bind, from, to) {
  _p.identity();
  for (let o = bone.parent; o && o !== root; o = o.parent) _p.premultiply(o.quaternion);
  _q.setFromUnitVectors(from, to);
  bone.quaternion.copy(bind).premultiply(_p.clone().invert().multiply(_q).multiply(_p));
}

// Resolves to a Group at the referee's anchor, facing +z, with userData.show(mode, frame, alpha, lap) and
// userData.setLayer(layer).
export async function buildLakitu3D() {
  const [body, hair, rod, signal, lap, lapf, flag, reverse] = (await Promise.all([
    load('jugemu.dae'), load('jugemu_hair.dae'), load('rod.dae'), load('jugemu_signal.dae'), load('jugemu_lap.dae'),
    load('jugemu_lapf.dae'), load('jg_flag.dae'), load('board_reverse.dae'),
  ])).map(instance);
  const g = new THREE.Group();
  const wii = new THREE.Group();   // Wii metres, facing +z
  wii.scale.setScalar(SCALE);
  wii.position.y = -CENTRE_Y * SCALE;
  g.add(wii);
  wii.add(body);
  const bone = n => body.getObjectByName(n);
  hair.scale.setScalar(1); rod.scale.setScalar(1);   // inside the body's bones, already in its centimetres (the loader's 0.01 is on the body)
  bone('ef_head').add(hair);
  // the rod continues the left arm (rod_1 at the hand, +x out along it); its line is turned to hang and shortened
  const hand = bone('CON_HAND_L'), armL = bone('arm_l_1'), armR = bone('arm_r_1');
  hand.add(rod);
  const bindL = armL.quaternion.clone(), bindR = armR.quaternion.clone();
  aim(armL, body, bindL, new THREE.Vector3(1, 0, 0), ARM_L);
  const line = rod.getObjectByName('line');
  body.updateMatrixWorld(true);
  const lineDir = new THREE.Vector3(1, 0, 0).transformDirection(line.matrixWorld).normalize();
  aim(line, body, line.quaternion.clone(), lineDir, new THREE.Vector3(0, -1, 0));
  line.scale.x *= LINE;
  g.updateMatrixWorld(true);
  const hook = wii.worldToLocal(rod.getObjectByName('ef_hook').getWorldPosition(new THREE.Vector3()));
  // the signs hang from the hook (their origins are their hanging points); the flag's pole stands in the right hand
  const boards = { countdown: signal, secondlap: lap, finallap: lapf, reverse };
  for (const b of Object.values(boards)) { b.position.copy(hook); b.visible = false; wii.add(b); }
  const flagPivot = new THREE.Group();
  flagPivot.rotation.y = -Math.PI / 2;   // pole up (+z -> +y), cloth (-y) out to his right (-x)
  flag.rotation.x = -Math.PI / 2;
  flagPivot.add(flag); flagPivot.visible = false;
  wii.add(flagPivot);
  const wrist = bone('wrist_r'), wristPos = new THREE.Vector3();
  // the signal's lamps and glows, left to right: red, red, blue
  const lamp = i => signal.getObjectByName(`polygon${[3, 1, 2][i]}`).material, glow = i => signal.getObjectByName(`polygon${[0, 5, 6][i]}`);
  const lampColor = [RED, RED, BLUE];
  const numberMat = lap.getObjectByName('polygon1').material, numberTex = new Map();
  const materials = [];
  g.traverse(o => { if (o.isMesh) materials.push(...(Array.isArray(o.material) ? o.material : [o.material])); });
  g.userData.show = (mode, frame, alpha = 1, lapNo = 2) => {
    for (const [m, b] of Object.entries(boards)) b.visible = m === mode;
    flagPivot.visible = mode === 'flag';
    aim(armR, body, bindR, new THREE.Vector3(-1, 0, 0), mode === 'flag' ? ARM_R_FLAG : ARM_R);
    switch (mode) {
      case 'countdown': {   // frames 8-15 one red, 16-23 two, 24+ the blue light
        const lit = frame < 8 ? 0 : frame < 16 ? 1 : frame < 24 ? 2 : 3;
        for (let i = 0; i < 3; i++) {
          const on = i < lit && (i < 2 || lit === 3);
          lamp(i).color.set(on ? lampColor[i] : OFF); lamp(i).emissive.set(on ? lampColor[i] : 0);
          glow(i).visible = on; glow(i).material.color.set(lampColor[i]);
        }
        break;
      }
      case 'secondlap': case 'finallap': {   // frames 0-15: the board turns to face the camera (and back)
        const b = boards[mode];
        b.rotation.y = (1 - Math.min(15, frame) / 15) * Math.PI / 2;
        if (mode === 'secondlap') {
          const file = lapTexture(lapNo);
          if (!numberTex.has(file)) {
            const t = new THREE.TextureLoader().load(`${DIR}${file}`);
            t.colorSpace = THREE.SRGBColorSpace; t.flipY = numberMat.map?.flipY ?? true; t.magFilter = THREE.LinearFilter;
            numberTex.set(file, t);
          }
          if (numberMat.map !== numberTex.get(file)) { numberMat.map = numberTex.get(file); numberMat.needsUpdate = true; }
        }
        break;
      }
      case 'reverse':   // frames 0-15 ping-pong: the sign swings on its hook
        reverse.rotation.z = (Math.min(15, frame) / 15 - 0.5) * 0.5;
        break;
      case 'flag': {   // frames 0-31: a wave about the hand
        body.updateMatrixWorld(true);
        flagPivot.position.copy(wii.worldToLocal(wrist.getWorldPosition(wristPos)));
        flagPivot.rotation.z = Math.sin(frame / 32 * Math.PI * 2) * 0.45;
        break;
      }
      case 'fishing':   // frames 0-3 ping-pong: he bobs on the cloud
        break;
    }
    wii.position.y = -CENTRE_Y * SCALE + (mode === 'fishing' ? frame * 0.03 : 0);
    for (const m of materials) {
      if (m.name.startsWith('lightb')) continue;
      const t = alpha < 1 || m.name === 'jugem_glass';
      if (m.transparent !== t) { m.transparent = t; m.depthWrite = !t; m.needsUpdate = true; }
      m.opacity = alpha;
    }
  };
  g.userData.setLayer = layer => g.traverse(o => o.layers.set(layer));
  return g;
}
