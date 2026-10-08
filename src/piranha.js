// Mario Raceway / Royal Raceway piranha plants (tools/extract-piranha.py -> public/mk64/<course>/piranha.json).
// spawn_piranha_plants puts one per spawn-list entry (not lifted onto the ground). render_actor_piranha_plant
// draws a 30x30 quad turned to the camera's yaw (D_801502C0) within 1000 x/z (distance_if_visible, which also
// skips plants outside the camera's +-FOV yaw wedge); the 32x64 CI8 frame is mirrored in S at 32 texels, so the
// quad shows the frame and its mirror image. Each camera has its own timer (update_actor_piranha_plant):
// + 1 a tick while the plant is within 300, > 60 -> 6, otherwise 0; frame = min(8, timer / 6), frame 0 past 300.
// Not ported: kart collisions (collision_piranha_plant) and a hit plant flying up (flag 0x400, y + 4 a tick).
import * as THREE from 'three';
import * as HD from './hd.js';
import { NATIVE_SCALE } from './track.js';
import { billboard } from './foliage.js';

const TICK = 1 / 60;

export class PiranhaPlants {
  constructor(scene, def) {
    this.group = new THREE.Group();
    this.group.name = 'piranha';
    scene.add(this.group);
    this.plants = [];
    this.timers = new Map();   // camera -> per-plant timers
    this.acc = 0;
    this.ready = fetch(`${import.meta.env?.BASE_URL ?? '/'}mk64/${def.dir}/piranha.json`)
      .then(r => (r.ok ? r.json().catch(() => null) : null))   // no file: the dev server answers with index.html
      .then(data => data && this._build(data, def.dir));
  }

  _build(data, dir) {
    this.data = data;
    const S = NATIVE_SCALE, pos = [], col = [], uv = [];
    for (const tri of data.triangles) for (const [x, y, z, s, t, r, g, b, a] of tri) {
      pos.push(x, y, z);
      col.push(r / 255, g / 255, b / 255, a / 255);
      uv.push(s / 32 / data.width, t / 32 / data.height);   // S10.5 texels; S runs 0-2: frame + mirror image
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geometry.setAttribute('color', new THREE.Float32BufferAttribute(col, 4));
    geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    this.frames = data.frames.map(f => {
      const map = HD.loadTexture(`${dir}/${f.image}`);
      map.colorSpace = THREE.SRGBColorSpace;
      map.flipY = false;
      map.wrapS = THREE.MirroredRepeatWrapping;   // G_TX_MIRROR | G_TX_WRAP, mask 5
      map.wrapT = THREE.ClampToEdgeWrapping;
      return map;
    });
    const max = data.maxDistance * S, plants = this.plants, timers = this.timers, frames = this.frames;
    data.actors.forEach(([x, y, z], i) => {
      // G_CC_MODULATEIDECALA + G_RM_AA_ZB_TEX_EDGE: texel x shade, alpha-tested
      const material = new THREE.MeshBasicMaterial({ map: frames[0], vertexColors: true, alphaTest: 0.5,
        side: THREE.DoubleSide, toneMapped: false, fog: false });
      const mesh = new THREE.Mesh(geometry, material);
      mesh.position.set(x * S, y * S, z * S);
      mesh.userData.maxDistance = max;
      mesh.frustumCulled = false;   // the matrix is rebuilt per camera
      mesh.onBeforeRender = function (renderer, scene, camera) {
        billboard.call(this, renderer, scene, camera);
        const t = timers.get(camera)?.[i] ?? 0;
        this.material.map = frames[Math.min(8, Math.floor(t / data.ticksPerFrame))];
      };
      this.group.add(mesh);
      plants.push(mesh);
    });
  }

  // distance_if_visible(camera, plant, yaw, 0, fov, 1000^2): -1 = unseen, 0 = seen past 300, 1 = within 300
  _state(camera, mesh) {
    const S = NATIVE_SCALE, c = camera.matrixWorld.elements, max = this.data.maxDistance * S;
    const dx = mesh.position.x - c[12], dz = mesh.position.z - c[14], d2 = dx * dx + dz * dz;
    if (Math.abs(dx) > max || Math.abs(dz) > max || d2 > max * max) return -1;
    const fx = -c[8], fz = -c[10], fl = Math.hypot(fx, fz), dl = Math.sqrt(d2);
    if (fl > 1e-6 && dl > 1e-6) {
      const angle = Math.acos(Math.max(-1, Math.min(1, (fx * dx + fz * dz) / fl / dl)));
      if (angle > THREE.MathUtils.degToRad(camera.fov ?? 40)) return -1;
    }
    const near = this.data.animateDistance * S;
    return d2 > near * near ? 0 : 1;
  }

  // update_course_actors runs once per game tick; cameras: one per local player screen
  update(dt, cameras) {
    if (!this.data) return;
    for (const cam of this.timers.keys()) if (!cameras.includes(cam)) this.timers.delete(cam);
    for (this.acc += dt; this.acc >= TICK; this.acc -= TICK) {
      for (const cam of cameras) {
        let t = this.timers.get(cam);
        if (!t) this.timers.set(cam, t = new Array(this.plants.length).fill(0));
        this.plants.forEach((mesh, i) => {
          if (this._state(cam, mesh) === 1) { if (++t[i] > this.data.timerWrap[0]) t[i] = this.data.timerWrap[1]; }
          else t[i] = 0;
        });
      }
    }
  }
}
