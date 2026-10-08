// Course foliage actors: trees, Bowser's Castle bushes and Kalimari Desert cacti (tools/extract-foliage.py ->
// public/mk64/<course>/foliage.json). spawn_foliage (src/racing/actors.c) puts one actor per spawn-list entry,
// lifted onto the ground when the entry sits below it (check_bounding_collision / calculate_surface_height).
// render_course_actors draws each with D_801502C0: the model turned to the camera's yaw (rot[1] - 180 degrees),
// so every tree faces the screen the same way, and render_actor_tree_* skips it past its x/z culling distance
// (distance_if_visible). Combine G_CC_MODULATEIA / MODULATEIDECALA, G_RM_AA_ZB_TEX_EDGE: texel x shade, alpha-tested.
// Moo Moo Farm has no trees in 4P (spawn_course_actors). Not ported: the ground shadow (func_8029794C, D_0D007B20)
// and kart collisions with trees (actor bounding boxes).
import * as THREE from 'three';
import * as HD from './hd.js';
import { NATIVE_SCALE } from './track.js';

const _r = new THREE.Vector3(), _u = new THREE.Vector3(0, 1, 0), _z = new THREE.Vector3(), _p = new THREE.Vector3();

// onBeforeRender: D_801502C0 for this camera, or nothing drawn past the model's culling distance
function billboard(renderer, scene, camera) {
  const e = this.matrixWorld.elements, c = camera.matrixWorld.elements;
  _p.set(e[12], e[13], e[14]);
  const dx = _p.x - c[12], dz = _p.z - c[14], max = this.userData.maxDistance;
  if (Math.abs(dx) > max || Math.abs(dz) > max || dx * dx + dz * dz > max * max) {
    this.matrixWorld.makeScale(0, 0, 0).setPosition(_p);
    return;
  }
  _r.set(c[0], 0, c[2]);
  if (_r.lengthSq() < 1e-8) return;
  _r.normalize();
  if (camera.userData.mirror) _r.negate();   // EXTRA: the mirrored projection would show the texture backwards
  _z.crossVectors(_r, _u);
  this.matrixWorld.makeBasis(_r.multiplyScalar(NATIVE_SCALE), _u.set(0, NATIVE_SCALE, 0), _z.multiplyScalar(NATIVE_SCALE)).setPosition(_p);
  _u.set(0, 1, 0);
}

export class Foliage {
  constructor(scene, track, def) {
    this.group = new THREE.Group();
    this.group.name = 'foliage';
    scene.add(this.group);
    this.ready = fetch(`${import.meta.env?.BASE_URL ?? '/'}mk64/${def.dir}/foliage.json`)
      .then(r => (r.ok ? r.json() : null))
      .then(data => data && this._build(data, track, def.dir));
  }

  _build(data, track, dir) {
    this.data = data;
    const S = NATIVE_SCALE, meshes = {};
    for (const [name, model] of Object.entries(data.models)) {
      meshes[name] = model.parts.map(part => {
        const pos = [], col = [], uv = [];
        for (const tri of part.triangles) for (const [x, y, z, s, t, r, g, b, a] of tri) {
          pos.push(x, y, z);
          col.push(r / 255, g / 255, b / 255, a / 255);
          uv.push(s / 32 / part.width, t / 32 / part.height);   // S10.5 texels, PNG rows top-down
        }
        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
        geometry.setAttribute('color', new THREE.Float32BufferAttribute(col, 4));
        geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
        const map = HD.loadTexture(`${dir}/${part.image}`);
        map.colorSpace = THREE.SRGBColorSpace;
        map.flipY = false;
        map.wrapS = map.wrapT = THREE.ClampToEdgeWrapping;   // G_TX_CLAMP
        const material = new THREE.MeshBasicMaterial({ map, vertexColors: true, alphaTest: 0.5, side: THREE.DoubleSide,
          toneMapped: false, fog: false });
        return { geometry, material, maxDistance: model.maxDistance * S };
      });
    }
    for (const { model, pos: [x, y, z] } of data.actors) {
      const ground = track.groundAt?.(x * S, z * S, y * S);
      const py = ground && ground.y > y * S ? ground.y : y * S;
      for (const part of meshes[model]) {
        const mesh = new THREE.Mesh(part.geometry, part.material);
        mesh.position.set(x * S, py, z * S);
        mesh.userData.maxDistance = part.maxDistance;
        mesh.frustumCulled = false;   // the matrix is rebuilt per camera
        mesh.onBeforeRender = billboard;
        this.group.add(mesh);
      }
    }
    if (this.screens) this.setScreens(this.screens);
  }

  // screens: local player screens (gPlayerCountSelection1)
  setScreens(screens) {
    this.screens = screens;
    this.group.visible = !this.data?.skipPlayerCounts.includes(screens);
  }
}
