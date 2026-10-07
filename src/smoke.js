// Kart exhaust smoke: MK64's particlePool0 type-1 puffs (n64decomp/mk64 src/code_80057C60.c).
// Spawn func_80060504, update func_80062C74, draw func_8006538C; 10 slots per kart walked in order
// each frame by func_8006CEC0 (dead slot -> try to spawn, live slot -> update).
// Texture: common_texture_particle_smoke[0..2] (tools/extract-smoke.py), 32x32 I8, bilinear,
// combine colour = lerp(ENV, PRIM, TEXEL0), alpha = TEXEL0 * PRIM alpha, translucent, no Z write.
// Assumptions: ticks at 30 Hz (1P race frame rate); MK64 kart units are scaled so the 18-unit kart
// quad x MARIO_SIZE matches our 4.5-unit sprite; currentSpeed = v / MAX_SPEED(44) x 320 (150cc top
// speed); MUSHROOM_EFFECT = any boost; squish / shell-hit / explosion = spinning.
import * as THREE from 'three';
import * as HD from './hd.js';

const POOL = 10, LIFE = 12, TICK = 1 / 30, FRAMES = 3, MAX_KARTS = 8;
const K = 4.5 / (18 * 0.75);
const CURRENT_SPEED = 320 / 44;
// func_80062C74 sp48, by our character names (MK64 order Mario Luigi Yoshi Toad DK Wario Peach Bowser)
const HEIGHT = { wario: 5.5, bowser: 6.5 };
const PRIM = [[0xfb, 0xff, 0xfb], [0xff, 0xfb, 0x86]].map(c => c.map(v => v / 255));   // normal, mushroom
const ENV = [[0x89, 0x62, 0x8f], [0xfe, 0x01, 0x09]].map(c => c.map(v => v / 255));

export class Exhaust {
  constructor(scene) {
    const n = MAX_KARTS * POOL;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 12), 3));
    geo.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(n * 8), 2));
    geo.setAttribute('prim', new THREE.BufferAttribute(new Float32Array(n * 12), 3));
    geo.setAttribute('env', new THREE.BufferAttribute(new Float32Array(n * 12), 3));
    geo.setAttribute('alpha', new THREE.BufferAttribute(new Float32Array(n * 4), 1));
    const idx = [];
    for (let i = 0; i < n; i++) idx.push(4 * i, 4 * i + 1, 4 * i + 2, 4 * i, 4 * i + 2, 4 * i + 3);
    geo.setIndex(idx);
    const map = HD.loadTexture('particles/smoke.png', { mipmaps: false, retroFilter: THREE.LinearFilter });
    const uniforms = THREE.UniformsUtils.merge([THREE.UniformsLib.fog]);
    uniforms.map = { value: map };   // merge() would clone the texture and break HD.loadTexture's image swap
    this.mesh = new THREE.Mesh(geo, new THREE.ShaderMaterial({
      uniforms, fog: true, transparent: true, depthWrite: false, side: THREE.DoubleSide,
      vertexShader: `#include <fog_pars_vertex>
        attribute vec3 prim, env; attribute float alpha; varying vec3 vPrim, vEnv; varying float vAlpha; varying vec2 vUv;
        void main(){ vUv = uv; vPrim = prim; vEnv = env; vAlpha = alpha;
          vec4 mvPosition = modelViewMatrix * vec4(position, 1.); gl_Position = projectionMatrix * mvPosition;
          #include <fog_vertex>
        }`,
      fragmentShader: `#include <fog_pars_fragment>
        uniform sampler2D map; varying vec3 vPrim, vEnv; varying float vAlpha; varying vec2 vUv;
        void main(){ float t = texture2D(map, vUv).r; gl_FragColor = vec4(mix(vEnv, vPrim, t), t * vAlpha);
          #include <fog_fragment>
        }`,
    }));
    this.mesh.frustumCulled = false;
    scene.add(this.mesh);
    this.acc = 0;
  }

  update(dt, karts, camera) {
    for (this.acc += dt; this.acc >= TICK; this.acc -= TICK) for (const k of karts) tick(k);
    this.draw(karts, camera);
  }

  draw(karts, camera) {
    const a = this.mesh.geometry.attributes;
    a.position.array.fill(0); a.alpha.array.fill(0);
    // func_8006538C rotates the quad about Y only, to the camera yaw
    camera.updateMatrixWorld();
    const right = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 0).setY(0).normalize();
    const p = new THREE.Vector3(), dir = new THREE.Vector3(), c = new THREE.Vector3();
    let q = 0;
    for (const k of karts.slice(0, MAX_KARTS)) {
      if (!k.smoke) continue;
      // func_80062B18: behind the kart along rotation - unk_0C0 / 2 (half the drift slip), above the ground
      const yaw = (k.psi + k.phi) / 2;
      dir.copy(k.frame.T).multiplyScalar(Math.cos(yaw)).addScaledVector(k.frame.R, Math.sin(yaw));
      dir.addScaledVector(k.up, -dir.dot(k.up)).normalize();
      const height = HEIGHT[k.mesh.userData.character] ?? 4.5;
      for (const s of k.smoke) {
        if (s.alive) {
          p.copy(k.world).addScaledVector(k.up, K * (height + s.rise)).addScaledVector(dir, -K * s.back);
          const h = 2 * s.scale * K, v0 = 1 - (s.frame + 1) / FRAMES + 0.5 / (32 * FRAMES), v1 = 1 - s.frame / FRAMES - 0.5 / (32 * FRAMES);
          [[1, 1, 1, v1], [1, -1, 1, v0], [-1, -1, 0, v0], [-1, 1, 0, v1]].forEach(([x, y, u, v], j) => {
            c.copy(p).addScaledVector(right, x * h); c.y += y * h;
            a.position.array.set([c.x, c.y, c.z], (q * 4 + j) * 3);
            a.uv.array.set([u, v], (q * 4 + j) * 2);
            a.prim.array.set(PRIM[s.boost], (q * 4 + j) * 3);
            a.env.array.set(ENV[s.boost], (q * 4 + j) * 3);
            a.alpha.array[q * 4 + j] = s.alpha / 255;
          });
        }
        q++;
      }
    }
    for (const key of ['position', 'uv', 'prim', 'env', 'alpha']) a[key].needsUpdate = true;
  }
}

function tick(k) {
  k.smoke ??= Array.from({ length: POOL }, () => ({ alive: false, timer: 0 }));
  const pool = k.smoke, unk098 = (k.v * CURRENT_SPEED) ** 2 / 25;
  pool.forEach((s, i) => {
    if (s.alive) {   // func_80062C74
      if (++s.timer === LIFE) { s.alive = false; s.timer = 0; return; }
      s.scale += s.idle ? 0.1 : 0.07;
      s.rise += 0.3;
      if (s.timer >= 3) s.alpha = Math.max(0, s.alpha - (s.idle ? 2 : 3));
      if (s.boost && s.timer >= 6) s.scale += 0.06;
      s.frame = (s.frame + 1) % FRAMES;
      s.back = 5.5 + s.timer * (unk098 / (s.idle ? 6000 : 5000) + 0.1);
      return;
    }
    if (k.spin > 0) return;   // func_8006CEC0 skips squish / shell hit / explosion
    // func_80060504: 3-in-5 chance on throttle, 3-in-14 idle; slot 0 also starts the chain when slot 9 is dead
    const roll = Math.floor(Math.random() * (k.throttle ? 5 : 14));
    const prev = pool[(i + POOL - 1) % POOL];
    if (roll < 1 || roll > 3 || !(prev.timer > 0 || (i === 0 && !prev.alive))) return;
    const boost = k.boost > 0 ? 1 : 0;
    Object.assign(s, { alive: true, timer: 0, scale: 0.5, rise: 0, frame: 0, back: 5.5, idle: !k.throttle, boost, alpha: boost ? 0x80 : 0x70 });
  });
}
