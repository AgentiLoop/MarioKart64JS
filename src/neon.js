// Rainbow Road neon signs (tools/extract-neon.py -> public/mk64/rainbow-road/neon.json).
// init_course_objects: init_object on the 10 signs (not in the credits); update_neon (once a frame = every other 60 Hz
// tick) runs update_object_neon, then points the sign at TLUT textureListIndex (update_neon_texture):
// - 0 the mushroom (func_80085CA0): count up 0-4 every 12 frames x5 (func_80072E54), blink 3/4 every 4 frames x10
//   (func_80072D3C), wait 20, count up x5, wait 20, blink 3/4 every frame x20, again;
// - 1 Mario (func_80085E38): count up 0-4 every 12 frames, blink 3/4 every 12 frames once, dark 12 (func_80072B48), again;
// - 2 the Boo (func_80085F74): count up 0-4 every 5 frames, wait 30, flash on/off every frame x7 (func_80072C00), wait 30,
//   count down 3-0 every 5 frames (func_80072F88), dark 15, again;
// - 3-9 Peach, Luigi, DK, Yoshi, Bowser, Wario, Toad (func_80086110): lit, never change.
// render_object_neon: each 64x64 CI8 sign at 8x scale turned to the camera (angle_between_object_camera, roll 0x8000),
// while it isn't dark (0x80000) and is in the camera's 0x2AAB view wedge (is_object_visible_on_camera); no distance limit.
// EXTRA: the console mirrors the positions; the port keeps them and flips each quad back in its own x, as the snowmen.
import * as THREE from 'three';
import * as HD from './hd.js';
import { NATIVE_SCALE } from './track.js';
import { inWedge } from './thwomp.js';
import { quadGeometry } from './snowmen.js';

const TICK = 1 / 60;
const S = NATIVE_SCALE;
const RAD = Math.PI / 32768;
const _v = new THREE.Vector3(), _q = new THREE.Quaternion(), _s = new THREE.Vector3(), _e = new THREE.Euler();

// update_objects.c helpers on one sign's object fields
const next = o => { o.timerActive = false; o.flag = false; o.state++; };   // object_next_state
const go = (o, s) => { o.timerActive = false; o.flag = false; o.state = s; };   // func_800726CC
function timer(o, t) {   // set_and_run_timer_object
  if (!o.timerActive) { o.timerActive = true; o.timer = t; }
  if (--o.timer < 0) next(o);
}
function count(o, from, to, step, wait, times, down = false) {   // func_80072E54 (up) / func_80072F88 (down)
  if (!o.flag) { o.tex = from; o.timer = wait; o.cc = times; o.timerActive = true; o.flag = true; return; }
  if (--o.timer > 0) return;
  o.timer = wait;
  o.tex += down ? -step : step;
  if (down ? o.tex < to : to < o.tex) {
    if (o.cc > 0) o.cc--;
    if (o.cc === 0) { o.tex = to; next(o); } else o.tex = from;
  }
}
function blink(o, a, b, wait, times, hide = false) {   // func_80072D3C (texture a / b) / func_80072C00 (shown / dark)
  if (!o.flag) { o.timer = wait; o.tex = a; o.d4 = 1; o.cc = times; o.flag = true; return; }
  if (--o.timer >= 0) return;
  o.timer = wait;
  o.d4--;
  if (hide) o.hidden = !(o.d4 & 1); else o.tex = o.d4 & 1 ? a : b;
  if (o.d4 < 0) {
    o.d4 = 1;
    if (o.cc > 0) o.cc--;
    if (o.cc === 0) next(o);
  }
}
function dark(o, t) {   // func_80072B48
  if (!o.timerActive) { o.timerActive = true; o.hidden = true; o.tex = 0; o.timer = t; }   // D_8018D140 = 0
  if (--o.timer < 0) { o.hidden = false; next(o); }
}

const RUN = {
  mushroom(o) {
    switch (o.state) {
      case 2: case 5: count(o, 0, 4, 1, 12, 5); break;
      case 3: blink(o, 3, 4, 4, 10); break;
      case 4: case 6: timer(o, 20); break;
      case 7: blink(o, 3, 4, 0, 20); break;
      case 8: go(o, 2); break;
    }
  },
  mario(o) {
    switch (o.state) {
      case 2: count(o, 0, 4, 1, 12, 1); break;
      case 3: blink(o, 3, 4, 12, 1); break;
      case 4: dark(o, 12); break;
      case 5: go(o, 2); break;
    }
  },
  boo(o) {
    switch (o.state) {
      case 2: count(o, 0, 4, 1, 5, 1); break;
      case 3: case 5: timer(o, 30); break;
      case 4: blink(o, 4, 0, 0, 7, true); break;   // func_80072C00(4, 0, 7): texture 4, flash every frame x7
      case 6: count(o, 3, 0, 1, 5, 1, true); break;
      case 7: dark(o, 15); break;
      case 8: go(o, 2); break;
    }
  },
};

export class NeonSigns {
  constructor(scene, def, { mirror = false } = {}) {
    this.group = new THREE.Group();
    this.group.name = 'neon';
    scene.add(this.group);
    this.mirror = mirror; this.ticks = 0; this.acc = 0;
    this.list = [];
    this.ready = fetch(`${import.meta.env?.BASE_URL ?? '/'}mk64/${def.dir}/neon.json`)
      .then(r => (r.ok ? r.json().catch(() => null) : null))   // no file: the dev server answers with index.html
      .then(data => data && this._build(data, def.dir));
  }

  _build(data, dir) {
    this.data = data;
    const geometry = quadGeometry(data.quad, 64);
    const self = this;
    this.list = data.signs.map(sign => {
      const materials = sign.frames.map(image => {
        const map = HD.loadTexture(`${dir}/${image}`);
        map.colorSpace = THREE.SRGBColorSpace;
        map.flipY = false;
        map.wrapS = map.wrapT = THREE.ClampToEdgeWrapping;   // G_TX_CLAMP, G_TF_BILERP
        // G_CC_DECALRGBA + G_RM_AA_ZB_TEX_EDGE: the texel as is, alpha-tested
        return new THREE.MeshBasicMaterial({ map, alphaTest: 0.5, side: THREE.DoubleSide, toneMapped: false, fog: false });
      });
      const mesh = new THREE.Mesh(geometry, materials[0]);
      mesh.name = `neon-${sign.name}`;
      mesh.matrixAutoUpdate = false;
      mesh.frustumCulled = false;   // the matrix is built per camera
      this.group.add(mesh);
      const o = { sign, mesh, materials };
      mesh.onBeforeRender = function (renderer, scene, camera) {
        if (!self._place(this, camera, sign.pos)) this.matrixWorld.makeScale(0, 0, 0);
      };
      return o;
    });
    this.reset();
  }

  // is_object_visible_on_camera(0x2AAB), then turned to the camera at (0, yaw, 0x8000) and sizeScaling 8
  _place(mesh, camera, p) {
    if (!inWedge(p, camera, this.data.viewAngle)) return false;
    const e = camera.matrixWorld.elements, m = this.mirror ? -1 : 1, k = this.data.scale * S;
    _q.setFromEuler(_e.set(0, Math.atan2(p[0] - e[12] / S, p[2] - e[14] / S), m * 0x8000 * RAD, 'YXZ'));
    mesh.matrixWorld.compose(_v.set(p[0] * S, p[1] * S, p[2] * S), _q, _s.set(m * k, k, k));
    return true;
  }

  // init_course_objects (init_object: state 1) for a new race
  reset() {
    this.acc = 0; this.ticks = 0;
    for (const o of this.list) {
      Object.assign(o, { state: 1, flag: false, timerActive: false, timer: 0, tex: 0, d4: 0, cc: 0, hidden: false });
      this._show(o);
    }
  }

  _show(o) {
    o.mesh.visible = o.state >= 2 && !o.hidden;
    o.mesh.material = o.materials[o.tex] ?? o.materials[0];
  }

  // update_neon
  _frame() {
    for (const o of this.list) {
      if (o.state === 1) { o.tex = 0; next(o); }   // init_texture_object + func_80085BB4
      else RUN[o.sign.anim]?.(o);
      this._show(o);
    }
  }

  update(dt) {
    if (!this.data) return;
    for (this.acc += dt; this.acc >= TICK; this.acc -= TICK) {
      this.ticks++;
      if (!(this.ticks & 1)) continue;   // objects update once a frame (two 60 Hz ticks)
      this._frame();
    }
  }
}
