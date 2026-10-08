// Yoshi Valley's giant Yoshi egg (tools/extract-yoshi-egg.py -> public/mk64/yoshi-valley/yoshi-egg.json).
// update_actor_yoshi_egg: it circles pathCenter (spawn + 70 z) at radius 70, pathRot + 0x5B a tick, and spins
// eggRot - DEGREES(3) a tick. render_actor_yoshi_egg draws it within 4000 x/z of the camera: while that screen's
// track section (pathCounter) is 13-19 the lit 3D egg (d_course_yoshi_valley_dl_16D70, F3DEX light fixed in world
// space while the egg turns), otherwise the flat far egg (dl_egg_lod0) turned to the camera's yaw (D_801502C0).
// pathCounter (func_8029122C): the section id of the course triangle under the camera, or under its kart when
// the two are more than one section apart; a floor over 30 below or with no section (255) keeps the old one.
// EXTRA: the console mirrors positions only, so the 3D egg is flipped back in its own x and turns the other way.
// Not ported: its ground shadow (func_8029794C, D_0D007B20), kart collisions and the hop when hit (flag 0x400).
import * as THREE from 'three';
import * as HD from './hd.js';
import { NATIVE_SCALE } from './track.js';
import { billboard } from './foliage.js';

const TICK = 1 / 60, BAM = Math.PI * 2 / 65536, CELL = 256, FLOOR = 30;
const _p = new THREE.Vector3(), color = new THREE.Color();

function texture(dir, image, wrap) {
  const map = HD.loadTexture(`${dir}/${image}`);
  map.colorSpace = THREE.SRGBColorSpace;
  map.flipY = false;
  map.wrapS = map.wrapT = wrap;
  return map;
}

export class YoshiEgg {
  constructor(scene, def, { mirror = false } = {}) {
    this.group = new THREE.Group();
    this.group.name = 'yoshi-egg';
    scene.add(this.group);
    this.mirror = mirror;
    this.sections = new Map();   // camera -> pathCounter
    this.acc = 0;
    this.ready = fetch(`${import.meta.env?.BASE_URL ?? '/'}mk64/${def.dir}/yoshi-egg.json`)
      .then(r => (r.ok ? r.json().catch(() => null) : null))   // no file: the dev server answers with index.html
      .then(data => data && this._build(data, def.dir));
  }

  _build(data, dir) {
    this.data = data;
    const S = NATIVE_SCALE, max = data.maxDistance * S, [lo, hi] = data.nearSections, sections = this.sections;
    const near = cam => { const s = sections.get(cam) ?? 1; return s >= lo && s <= hi; };
    const [sx, sy, sz] = data.spawn, [ox, oy, oz] = data.pathCenterOffset;
    this.state = { center: [sx, sy + oy, sz + oz], pos: [sx, sy, sz], pathRot: 0, eggRot: 0 };

    // near: the lit egg; normals kept to shade it each tick
    const n = data.near, pos = [], uv = [];
    this.normals = [];
    for (const tri of n.triangles) for (const [x, y, z, s, t, nx, ny, nz] of tri) {
      pos.push(x, y, z);
      uv.push(s / 32 / n.width, t / 32 / n.height);   // S10.5 texels
      this.normals.push([nx, ny, nz]);
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    this.shade = new THREE.Float32BufferAttribute(new Float32Array(pos.length), 3);
    geometry.setAttribute('color', this.shade);
    // G_CC_MODULATEIA + G_RM_AA_ZB_OPA_SURF, back faces culled (the course's default geometry mode)
    const nearMesh = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({
      map: texture(dir, n.image, THREE.RepeatWrapping), vertexColors: true, toneMapped: false, fog: false }));
    nearMesh.onBeforeRender = function (renderer, scene, camera) {
      const e = this.matrixWorld.elements, c = camera.matrixWorld.elements, dx = e[12] - c[12], dz = e[14] - c[14];
      if (!near(camera) || Math.abs(dx) > max || Math.abs(dz) > max || dx * dx + dz * dz > max * max) {
        _p.set(e[12], e[13], e[14]);
        this.matrixWorld.makeScale(0, 0, 0).setPosition(_p);
      }
    };
    this.egg = new THREE.Group();
    this.egg.scale.set(this.mirror ? -S : S, S, S);
    this.egg.add(nearMesh);
    this.group.add(this.egg);

    // far: the flat egg, unlit, alpha-tested
    const f = data.far, fpos = [], fcol = [], fuv = [];
    for (const tri of f.triangles) for (const [x, y, z, s, t, r, g, b] of tri) {
      fpos.push(x, y, z);
      color.setRGB(r / 255, g / 255, b / 255, THREE.SRGBColorSpace);
      fcol.push(color.r, color.g, color.b);
      fuv.push(s / 32 / f.width, t / 32 / f.height);
    }
    const fgeo = new THREE.BufferGeometry();
    fgeo.setAttribute('position', new THREE.Float32BufferAttribute(fpos, 3));
    fgeo.setAttribute('color', new THREE.Float32BufferAttribute(fcol, 3));
    fgeo.setAttribute('uv', new THREE.Float32BufferAttribute(fuv, 2));
    this.far = new THREE.Mesh(fgeo, new THREE.MeshBasicMaterial({ map: texture(dir, f.image, THREE.ClampToEdgeWrapping),
      vertexColors: true, alphaTest: 0.5, side: THREE.DoubleSide, toneMapped: false, fog: false }));
    this.far.userData.maxDistance = max;
    this.far.frustumCulled = false;   // the matrix is rebuilt per camera
    this.far.onBeforeRender = function (renderer, scene, camera) {
      billboard.call(this, renderer, scene, camera);
      if (near(camera)) {
        const e = this.matrixWorld.elements;
        _p.set(e[12], e[13], e[14]);
        this.matrixWorld.makeScale(0, 0, 0).setPosition(_p);
      }
    };
    this.group.add(this.far);

    // section triangles bucketed by x/z cell: [id, ax, ay, az, bx, by, bz, cx, cy, cz] in course units
    this.grid = new Map();
    for (const t of data.sections) {
      const xs = [t[1], t[4], t[7]], zs = [t[3], t[6], t[9]];
      for (let x = Math.floor(Math.min(...xs) / CELL); x <= Math.floor(Math.max(...xs) / CELL); x++) {
        for (let z = Math.floor(Math.min(...zs) / CELL); z <= Math.floor(Math.max(...zs) / CELL); z++) {
          const key = x * 65536 + z;
          if (!this.grid.has(key)) this.grid.set(key, []);
          this.grid.get(key).push(t);
        }
      }
    }
    this._place();
  }

  // the floor triangle under (x, y, z) in course units: { id, distance } (the highest one at or below y), or null
  _floor(x, y, z) {
    let best = null;
    for (const t of this.grid.get(Math.floor(x / CELL) * 65536 + Math.floor(z / CELL)) || []) {
      const [, ax, ay, az, bx, by, bz, cx, cy, cz] = t;
      const area = (bx - ax) * (cz - az) - (cx - ax) * (bz - az);
      if (Math.abs(area) < 1e-6) continue;
      const u = ((bx - x) * (cz - z) - (cx - x) * (bz - z)) / area;
      const v = ((cx - x) * (az - z) - (ax - x) * (cz - z)) / area;
      const w = 1 - u - v;
      if (u < -1e-6 || v < -1e-6 || w < -1e-6) continue;
      const fy = u * ay + v * by + w * cy;
      if (fy <= y + 1 && (!best || y - fy < best.distance)) best = { id: t[0], distance: y - fy };
    }
    return best;
  }

  _sectionOf(obj) {
    if (!obj) return { id: 255, distance: Infinity };
    const S = NATIVE_SCALE, p = obj.isObject3D ? _p.setFromMatrixPosition(obj.matrixWorld) : obj.world;   // camera / kart
    return this._floor(p.x / S, p.y / S, p.z / S) ?? { id: 255, distance: Infinity };
  }

  // func_8029122C: the screen's pathCounter from the camera's and its player's floor triangles
  _pathCounter(cam, prev) {
    const c = this._sectionOf(cam), p = this._sectionOf(cam.userData.kart), d = c.id - p.id;
    const kart = p.id === 255 || p.distance > FLOOR ? prev : p.id;
    // assumption: this chase camera rides about 42 units over the road (higher than the console's), so a camera
    // more than 30 over its floor takes its kart's section instead of keeping the old one
    if (d < 2 && d >= -1 && c.id !== 255) return c.distance > FLOOR ? kart : c.id;
    return kart;
  }

  _place() {
    const S = NATIVE_SCALE, st = this.state, dir = this.mirror ? -1 : 1;
    // console x = center x * gCourseDirection + sins * r; the port's course is never mirrored, only its projection
    this.egg.position.set(st.pos[0] * S, st.pos[1] * S, st.pos[2] * S);
    this.far.position.copy(this.egg.position);
    const angle = st.eggRot * BAM;
    this.egg.rotation.y = angle * dir;
    // F3DEX lighting: the light stays in world space, so the turned normal is lit
    const { ambient, color: lc, direction: [lx, ly, lz] } = this.data.near.light, ll = Math.hypot(lx, ly, lz) || 1;
    const sn = Math.sin(angle), cs = Math.cos(angle), a = this.shade.array;
    this.normals.forEach(([nx, ny, nz], i) => {
      const wx = nx * cs + nz * sn, wz = -nx * sn + nz * cs, nl = Math.hypot(nx, ny, nz) || 1;
      const d = Math.max(0, (wx * lx + ny * ly + wz * lz) / nl / ll);
      color.setRGB(...[0, 1, 2].map(k => Math.min(255, Math.round(ambient[k] + lc[k] * d)) / 255), THREE.SRGBColorSpace);
      a[i * 3] = color.r; a[i * 3 + 1] = color.g; a[i * 3 + 2] = color.b;
    });
    this.shade.needsUpdate = true;
  }

  // update_course_actors runs once per game tick; cameras: one per local player screen
  update(dt, cameras) {
    if (!this.data) return;
    for (const cam of this.sections.keys()) if (!cameras.includes(cam)) this.sections.delete(cam);
    const st = this.state, d = this.data, dir = this.mirror ? -1 : 1;
    let ticked = false;
    for (this.acc += dt; this.acc >= TICK; this.acc -= TICK) {
      st.pathRot = (st.pathRot + d.pathRotPerTick) & 0xffff;
      st.eggRot = (st.eggRot + d.eggRotPerTick) & 0xffff;
      st.pos[0] = st.center[0] + dir * Math.sin(st.pathRot * BAM) * d.pathRadius;
      st.pos[2] = st.center[2] + Math.cos(st.pathRot * BAM) * d.pathRadius;
      ticked = true;
    }
    if (ticked) this._place();
    for (const cam of cameras) this.sections.set(cam, this._pathCounter(cam, this.sections.get(cam) ?? 1));
  }
}
