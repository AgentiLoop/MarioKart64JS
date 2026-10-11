import { describe, it, expect, vi, afterEach } from 'vitest';
import * as THREE from 'three';
import { Ferry } from '../src/ferry.js';
import { def } from './helpers.js';

const camAt = (x, y, z, tx = 0, ty = 0, tz = 0) => {
  const c = new THREE.PerspectiveCamera(40, 1, 0.1, 10000);
  c.position.set(x * 0.1, y * 0.1, z * 0.1);
  c.lookAt(tx * 0.1, ty * 0.1, tz * 0.1);
  c.updateMatrixWorld(true);
  c.userData.kart = { world: new THREE.Vector3(x * 0.1, y * 0.1 - 0.5, z * 0.1) };
  return c;
};
const scale = m => new THREE.Vector3().setFromMatrixScale(m).length();
const fakeAudio = () => ({ playSound: vi.fn(), stopSound: vi.fn(), starMusic: vi.fn() });
const TICK = 1 / 60 + 1e-9;

afterEach(() => vi.restoreAllMocks());

describe('Ferry', () => {
  it('a missing file builds nothing and update is a no-op', async () => {
    const f = new Ferry(new THREE.Scene(), { dir: 'no-such-course' });
    f.update(1, []);
    await f.ready;
    expect(f.data).toBeUndefined();
  });

  it('starts at path point 0 on the water, one step along', async () => {
    const f = new Ferry(new THREE.Scene(), def('dk'));
    await f.ready;
    const b = f.boat, p0 = f.path[0];
    expect(b.active).toBe(true);
    expect(b.pos[1]).toBe(-40);
    expect(Math.hypot(b.pos[0] - p0[0], b.pos[2] - p0[1])).toBeCloseTo(b.speed, 3);
    expect(b.rotY).toBe(((Math.round(Math.atan2(b.vel[0], b.vel[1]) / (Math.PI / 32768)) + 0x8000) & 0xFFFF) - 0x8000);
    expect(f.boatGroup.position.x).toBeCloseTo(b.pos[0] * 0.1);
    expect(f.wheel.position.toArray()).toEqual(f.data.wheelOffset);
    expect(f.lit.length).toBeGreaterThan(0);
  });

  it('sails along the path, turning, changing speed, turning its wheel and sounding its horn', async () => {
    const audio = fakeAudio();
    const f = new Ferry(new THREE.Scene(), def('dk'), { audio });
    await f.ready;
    const b = f.boat, cam = camAt(f.path[0][0] + 200, 0, f.path[0][1]);
    const start = [...b.pos], speeds = new Set(), rots = new Set();
    for (let i = 0; i < 1200; i++) { f.update(TICK, [cam]); speeds.add(b.speed); rots.add(b.rotY); }
    expect(Math.hypot(b.pos[0] - start[0], b.pos[2] - start[2])).toBeGreaterThan(50);
    expect(b.idx).toBeGreaterThan(0);
    expect(speeds.size).toBeGreaterThan(2);
    expect(Math.max(...speeds)).toBeLessThanOrEqual(2.02);
    expect(rots.size).toBeGreaterThan(10);
    expect(b.wheelRot).toBe((1200 * Math.trunc(5 * 65536 / 360)) & 0xFFFF);
    expect(f.wheel.rotation.x).not.toBe(0);
    // horn heard one frame in 100 (random), so force it
    vi.spyOn(Math, 'random').mockReturnValue(0);
    const near = camAt(b.pos[0] + 100, 0, b.pos[2]);
    f.update(TICK * 2, [near]);
    expect(audio.playSound).toHaveBeenCalledWith(1, 0x47, expect.any(Number), expect.any(Number));
    vi.spyOn(Math, 'random').mockReturnValue(0.009);   // floor(0.9) = 0 -> horn, floor(0.018) = 0 -> 0x47 again
    Math.random.mockReturnValueOnce(0).mockReturnValueOnce(0.9);
    audio.playSound.mockClear();
    f.update(TICK * 2, [near]);
    expect(audio.playSound).toHaveBeenCalledWith(1, 0x48, expect.any(Number), expect.any(Number));
  });

  it('a slow turn steadily speeds up to 2, a sharp one slows towards 0.2', async () => {
    const f = new Ferry(new THREE.Scene(), def('dk'));
    await f.ready;
    const b = f.boat;
    b.speed = 1.0;
    // heading already at the target: speed up
    const q = f.path[(b.idx + 5) % f.path.length];
    b.rotY = ((Math.round(Math.atan2(q[0] - b.pos[0], q[1] - b.pos[2]) / (Math.PI / 32768)) + 0x8000) & 0xFFFF) - 0x8000;
    f._vehicle([]);
    expect(b.speed).toBeCloseTo(1.02, 5);
    // facing well away: slow down and turn by 0x3C
    const q2 = f.path[(b.idx + 5) % f.path.length];
    const target = ((Math.round(Math.atan2(q2[0] - b.pos[0], q2[1] - b.pos[2]) / (Math.PI / 32768)) + 0x8000) & 0xFFFF) - 0x8000;
    b.rotY = ((target + 0x6000 + 0x8000) & 0xFFFF) - 0x8000;   // well off the heading
    const before = b.rotY;
    f._vehicle([]);
    expect(b.speed).toBeLessThan(1.02);
    expect(Math.abs((((b.rotY - before) + 0x8000) & 0xFFFF) - 0x8000)).toBe(0x3C);
  });

  it('turns both ways round the path (positive and negative differences)', async () => {
    const f = new Ferry(new THREE.Scene(), def('dk'));
    await f.ready;
    const b = f.boat;
    for (const off of [0x2000, -0x2000, 0x7000, -0x7000, 0x100, -0x100]) {
      f.setScreens(1);
      const q = f.path[(b.idx + 5) % f.path.length];
      const target = Math.round(Math.atan2(q[0] - b.pos[0], q[1] - b.pos[2]) / (Math.PI / 32768));
      b.rotY = (((target - off) + 0x8000) & 0xFFFF) - 0x8000;
      const before = b.rotY;
      f._vehicle([]);
      expect(b.rotY).not.toBe(before);
    }
  });

  it('is hidden from sections 21-24 and past 3000, and absent with 3+ screens', async () => {
    const scene = new THREE.Scene();
    const f = new Ferry(scene, def('dk'));
    await f.ready;
    const b = f.boat, [bx, , bz] = b.pos;
    const hidden = camAt(-669, -160, -381, bx, -40, bz);   // over section 22
    const seen = camAt(bx + 300, 0, bz, bx, -40, bz);
    const far = camAt(bx + 4000, 0, bz, bx, -40, bz);
    f.update(TICK, [hidden, seen, far]);
    const s = f.sections.get(hidden);
    expect(s).toBeGreaterThanOrEqual(21); expect(s).toBeLessThanOrEqual(24);
    const mesh = f.boatGroup.children[0];
    scene.updateMatrixWorld(true);
    mesh.onBeforeRender(null, scene, seen);
    expect(scale(mesh.matrixWorld)).toBeGreaterThan(0);
    mesh.onBeforeRender(null, scene, hidden);
    expect(scale(mesh.matrixWorld)).toBe(0);
    scene.updateMatrixWorld(true);
    mesh.onBeforeRender(null, scene, far);
    expect(scale(mesh.matrixWorld)).toBe(0);
    // cameras dropped from the list are forgotten
    f.update(TICK, [seen]);
    expect(f.sections.has(hidden)).toBe(false);
    // 3 screens: no boat
    f.setScreens(3);
    expect(f.boatGroup.visible).toBe(false);
    const pos = [...b.pos];
    f.update(1, [seen]);
    expect(b.pos).toEqual(pos);
  });

  it('mirrored: flipped in x', async () => {
    const f = new Ferry(new THREE.Scene(), def('dk'), { mirror: true });
    await f.ready;
    expect(f.boatGroup.scale.x).toBeCloseTo(-0.1);
    expect(f.lights[0].dir[0]).toBeCloseTo(-f.data.lights[0].direction[0] / Math.hypot(...f.data.lights[0].direction));
  });
});
