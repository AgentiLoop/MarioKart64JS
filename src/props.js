// Course prop actors drawn from the course data segment (tools/extract-props.py -> public/mk64/<course>/props.json):
// Koopa Troopa Beach palm trees (render_actor_palm_tree: unrotated, lit, within 2000), the Mario Raceway and
// Wario Stadium signs (update_actor_*_sign: + DEGREES(1) a tick about the up axis; drawn within 4000) and
// D.K.'s Jungle Parkway trees (render_palm_trees: ids 0/4/5 turned to the camera's yaw like the foliage, the
// palm id 6 unrotated; within 1000). Distances are x/z from the camera, as distance_if_visible.
// EXTRA: the console mirrors positions only, so each model is flipped back in its own x (and the signs spin the
// other way) to look like the console's under the mirrored projection.
// Not ported: palm tree shadows (func_8029794C), kart collisions, signs / trees flying away when hit (flag 0x400).
import * as THREE from 'three';
import * as HD from './hd.js';
import { NATIVE_SCALE } from './track.js';
import { billboard } from './foliage.js';

const TICK = 1 / 60;
const _p = new THREE.Vector3();

// onBeforeRender for unturned props: nothing drawn past the culling distance from this camera
function cull(renderer, scene, camera) {
  const e = this.matrixWorld.elements, c = camera.matrixWorld.elements, max = this.userData.maxDistance;
  const dx = e[12] - c[12], dz = e[14] - c[14];
  if (Math.abs(dx) > max || Math.abs(dz) > max || dx * dx + dz * dz > max * max) {
    _p.set(e[12], e[13], e[14]);
    this.matrixWorld.makeScale(0, 0, 0).setPosition(_p);
  }
}

export class Props {
  constructor(scene, def, { mirror = false } = {}) {
    this.group = new THREE.Group();
    this.group.name = 'props';
    scene.add(this.group);
    this.mirror = mirror;
    this.spinners = [];
    this.ticks = 0;
    this.acc = 0;
    this.ready = fetch(`${import.meta.env?.BASE_URL ?? '/'}mk64/${def.dir}/props.json`)
      .then(r => (r.ok ? r.json().catch(() => null) : null))   // no file: the dev server answers with index.html
      .then(data => data && this._build(data, def.dir));
  }

  _build(data, dir) {
    this.data = data;
    const S = NATIVE_SCALE, color = new THREE.Color(), textures = {}, models = {};
    for (const [id, model] of Object.entries(data.models)) {
      const turned = data.kind === 'billboard' && !data.static?.includes(Number(id));
      models[id] = { turned, parts: model.parts.map(part => {
        const pos = [], col = [], uv = [];
        for (const tri of part.triangles) for (const [x, y, z, s, t, r, g, b] of tri) {
          pos.push(x, y, z);
          color.setRGB(r / 255, g / 255, b / 255, THREE.SRGBColorSpace);   // vertex / F3DEX shade
          col.push(color.r, color.g, color.b);
          if (part.image) uv.push(s / 32 / part.width, t / 32 / part.height);   // S10.5 texels, PNG rows top-down
        }
        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
        geometry.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
        let map = null;
        if (part.image) {
          geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
          const key = `${part.image}/${part.wrapS}/${part.wrapT}`;
          map = textures[key];
          if (!map) {
            map = textures[key] = HD.loadTexture(`${dir}/${part.image}`);
            map.colorSpace = THREE.SRGBColorSpace;
            map.flipY = false;
            const wrap = { repeat: THREE.RepeatWrapping, mirror: THREE.MirroredRepeatWrapping, clamp: THREE.ClampToEdgeWrapping };
            map.wrapS = wrap[part.wrapS]; map.wrapT = wrap[part.wrapT];
          }
        }
        // texel x shade; G_RM_AA_ZB_TEX_EDGE alpha-tests the texel (vertex alpha unused: OPA_SURF or ..DECALA)
        const material = new THREE.MeshBasicMaterial({ map, vertexColors: true, toneMapped: false, fog: false,
          alphaTest: part.alphaTest ? 0.5 : 0, side: part.doubleSided || turned ? THREE.DoubleSide : THREE.FrontSide });
        return { geometry, material };
      }) };
    }
    const max = data.maxDistance * S;
    for (const { model, pos: [x, y, z] } of data.actors) {
      const { turned, parts } = models[model];
      if (turned) {   // D_801502C0: the matrix is rebuilt per camera
        for (const { geometry, material } of parts) {
          const mesh = new THREE.Mesh(geometry, material);
          mesh.position.set(x * S, y * S, z * S);
          mesh.userData.maxDistance = max;
          mesh.frustumCulled = false;
          mesh.onBeforeRender = billboard;
          this.group.add(mesh);
        }
        continue;
      }
      const actor = new THREE.Group();
      actor.position.set(x * S, y * S, z * S);
      actor.scale.set(this.mirror ? -S : S, S, S);
      for (const { geometry, material } of parts) {
        const mesh = new THREE.Mesh(geometry, material);
        mesh.userData.maxDistance = max;
        mesh.onBeforeRender = cull;
        actor.add(mesh);
      }
      this.group.add(actor);
      if (data.kind === 'spin') this.spinners.push(actor);
    }
  }

  // update_course_actors runs once per game tick
  update(dt) {
    if (!this.spinners.length) return;
    for (this.acc += dt; this.acc >= TICK; this.acc -= TICK) this.ticks++;
    const angle = (this.ticks * this.data.spinPerTick % 1) * Math.PI * 2 * (this.mirror ? -1 : 1);
    for (const actor of this.spinners) actor.rotation.y = angle;
  }
}
