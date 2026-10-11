import { describe, it, expect, vi, beforeAll } from 'vitest';
import * as THREE from 'three';
import { Thwomps, inWedge } from '../src/thwomp.js';
import { makeTrack, makeKart, def } from './helpers.js';

// camera at (x, y, z) course units looking at (tx, ty, tz), its kart 5 below it
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
const FRAME = 2 / 60 + 1e-9;   // one object frame
const frames = (t, n, ...args) => { for (let i = 0; i < n; i++) t.update(FRAME, ...args); };
const SECTION6 = [933, 148, -1633];   // a point over track section 6 (the first hall)

describe('inWedge', () => {
  const cam = new THREE.PerspectiveCamera();
  cam.lookAt(0, 0, -1); cam.updateMatrixWorld(true);   // at the origin facing -z (yaw 0x8000)

  it('is true straight ahead and false behind', () => {
    expect(inWedge([0, 0, -100], cam, 0x4000)).toBe(true);
    expect(inWedge([0, 0, 100], cam, 0x4000)).toBe(false);
  });

  it('a point 90 degrees to the side is inside a 180 degree wedge only', () => {
    expect(inWedge([100, 0, 0], cam, 0x4000)).toBe(false);
    expect(inWedge([100, 0, 0], cam, 0x8000)).toBe(true);
    expect(inWedge([-100, 0, 0], cam, 0x8000)).toBe(true);
    expect(inWedge([100, 0, -100], cam, 0x4000)).toBe(true);    // 45 degrees off, wedge +-45
    expect(inWedge([100, 0, -90], cam, 0x4000)).toBe(false);
  });

  it('measures from the camera position in scene units', () => {
    const c = new THREE.PerspectiveCamera();
    c.position.set(100, 0, 0); c.lookAt(100, 0, -1); c.updateMatrixWorld(true);
    expect(inWedge([1000, 0, -100], c, 0x4000)).toBe(true);
    expect(inWedge([0, 0, -100], c, 0x4000)).toBe(false);
  });
});

describe('Thwomps', () => {
  let track;
  beforeAll(async () => { track = await makeTrack('bowser'); });

  it('a missing file builds nothing and update is a no-op', async () => {
    const t = new Thwomps(new THREE.Scene(), { dir: 'no-such-course' });
    t.update(1, []);
    t.setScreens(2);
    await t.ready;
    expect(t.list).toHaveLength(0);
  });

  it('spawns 8 / 11 / 12 Thwomps by cc (the extra cc uses the 100cc list)', async () => {
    const counts = [];
    for (const cc of [0, 1, 2, 3, 9]) {
      const t = new Thwomps(new THREE.Scene(), def('bowser'), { cc });
      await t.ready;
      counts.push(t.list.length);
    }
    expect(counts).toEqual([8, 11, 12, 11, 12]);
  });

  it('builds each Thwomp with a face material and lit body, placed at its spawn', async () => {
    const t = new Thwomps(new THREE.Scene(), def('bowser'));
    await t.ready;
    const o = t.list[0];
    expect(o.face).toBeTruthy();
    expect(o.face.map).toBe(t.faces[0]);
    expect(o.lit).toHaveLength(2);
    expect(o.group.position.x).toBeCloseTo(80);
    expect(o.group.position.z).toBeCloseTo(-175);
    expect(t.faces).toHaveLength(6);
    expect(t.lights[1].dir).toEqual([0, 1, 0]);
    const col = o.lit[1].mesh.geometry.attributes.color.array;
    expect(Math.max(...col)).toBeGreaterThan(0);
  });

  it('first frame runs every init by kind', async () => {
    const t = new Thwomps(new THREE.Scene(), def('bowser'));
    await t.ready;
    frames(t, 1, []);
    const by = k => t.list.filter(o => o.kind === k);
    expect(t.list.every(o => o.state >= 2)).toBe(true);
    expect(by(1)[0]).toMatchObject({ rotY: 0xC000, section: 6, type: 0 });
    expect(by(3)[0]).toMatchObject({ rotY: 0x4000, section: 8 });
    expect(by(4).map(o => o.type)).toEqual([2, 2, 2]);
    expect(by(6)[0]).toMatchObject({ scale: 1.5, type: 1 });
    expect(by(5)[0]).toMatchObject({ section: 10, surfaceHeight: 70 });
    expect(by(5)[0].vel[2]).toBe(-1);
    expect(by(5)[1].vel[2]).toBe(-1.5);
    expect(by(6)[0].group.scale.x).toBeCloseTo(0.15);
  });

  it('kind 4 slams every 60 frames: rises, drops, pulls faces and climbs back', async () => {
    const t = new Thwomps(new THREE.Scene(), def('bowser'));
    await t.ready;
    const o = t.list.find(x => x.kind === 4);
    const ys = [], texs = new Set(), states = new Set();
    for (let i = 0; i < 400; i++) { frames(t, 1, []); ys.push(o.offset[1]); texs.add(o.tex); states.add(o.state); }
    expect(Math.max(...ys)).toBe(45);   // u01c 30 + 15
    expect(Math.min(...ys.slice(10))).toBe(0);
    expect(texs).toEqual(new Set([0, 1, 2, 3]));
    for (const s of [0x32, 0x33, 0x34, 0x35, 0x36]) expect(states.has(s)).toBe(true);
    expect(o.face.map).toBe(t.faces[o.tex]);
    expect(o.group.position.y).toBeCloseTo(o.pos[1] * 0.1);
  });

  it('kind 2 walks a square, slamming at each corner', async () => {
    const t = new Thwomps(new THREE.Scene(), def('bowser'));
    await t.ready;
    const [a, b] = t.list.filter(x => x.kind === 2);
    const xs = [[], []], zs = [[], []], subs = new Set();
    for (let i = 0; i < 500; i++) {
      t.update(FRAME * 5, []);   // five frames a call (the corners hold while it turns and slams)
      [a, b].forEach((o, k) => { xs[k].push(o.offset[0]); zs[k].push(o.offset[2]); });
      subs.add(a.sub);
    }
    expect(Math.max(...xs[0])).toBe(200);
    expect(Math.min(...zs[0])).toBe(-100);
    expect(Math.min(...xs[1])).toBe(-200);
    expect(Math.max(...zs[1])).toBe(100);
    expect(subs.size).toBeGreaterThan(10);
  });

  it('kind 5 floats 250 out in z and back, faces animating, humming every 64 frames', async () => {
    const audio = fakeAudio();
    const t = new Thwomps(new THREE.Scene(), def('bowser'), { audio });
    await t.ready;
    const o = t.list.find(x => x.kind === 5);
    const cam = camAt(o.origin[0], 100, o.origin[2] + 200, o.origin[0], 70, o.origin[2]);
    const zs = [], texs = new Set();
    for (let i = 0; i < 700; i++) { frames(t, 1, [cam]); zs.push(o.offset[2]); texs.add(o.tex); }
    expect(Math.min(...zs)).toBe(-250);
    expect(zs.slice(300).some(z => z === 0)).toBe(true);
    expect(o.pos[1]).toBe(70);
    for (const k of [3, 4, 5]) expect(texs.has(k)).toBe(true);
    expect([...texs].every(k => k === 0 || (k >= 3 && k <= 5))).toBe(true);
    expect(audio.playSound.mock.calls.some(c => c[1] === 0x45)).toBe(true);
  });

  it('kind 6 pulls faces when a screen comes within 100 in front of it', async () => {
    const audio = fakeAudio();
    const t = new Thwomps(new THREE.Scene(), def('bowser'), { audio });
    await t.ready;
    const o = t.list.find(x => x.kind === 6);
    frames(t, 2, []);
    expect(o.state).toBe(2);
    const far = camAt(o.origin[0] + 500, 50, o.origin[2], o.origin[0], 0, o.origin[2]);
    frames(t, 5, [far]);
    expect(o.state).toBe(2);
    const behind = camAt(o.origin[0] + 50, 50, o.origin[2], o.origin[0] + 200, 0, o.origin[2]);
    frames(t, 2, [behind]);
    expect(o.state).toBe(2);
    expect(o.status & 0x20000).toBeTruthy();   // close, but not in its wedge
    const near = camAt(o.origin[0] + 50, 50, o.origin[2], o.origin[0], 0, o.origin[2]);
    frames(t, 1, [near]);
    expect(o.state).toBe(3);
    expect(audio.playSound).toHaveBeenCalledWith(1, 0x45, expect.any(Number), expect.any(Number));
    const texs = new Set();
    for (let i = 0; i < 300 && o.state === 3; i++) { frames(t, 1, []); texs.add(o.tex); }
    expect(texs).toEqual(new Set([0, 3, 4, 5]));
    expect(o.state).toBe(4);
    frames(t, 302, []);
    expect(o.state).toBe(2);
  });

  it('kind 1 turns round after a player comes near in front of the camera', async () => {
    const t = new Thwomps(new THREE.Scene(), def('bowser'));
    await t.ready;
    const o = t.list.find(x => x.kind === 1);
    frames(t, 1, []);
    const player = makeKart(track, { isPlayer: true });
    player.world.set((o.origin[0] + 100) * 0.1, 0, o.origin[2] * 0.1);
    // the camera looks towards the Thwomp from behind the player
    const cam = camAt(o.origin[0] + 200, 30, o.origin[2], o.origin[0], 0, o.origin[2]);
    let turned = false;
    for (let i = 0; i < 300 && !turned; i++) { frames(t, 1, [cam], [player], [player]); turned = o.state === 0x12C; }
    expect(turned).toBe(true);
    for (let i = 0; i < 40 && o.state === 0x12C; i++) frames(t, 1, [cam], [player]);
    expect(o.rotY).toBe((0xC000 + 0x8000) & 0xFFFF);
    expect(o.state).toBe(2);
    expect(o.flags & 4).toBe(0);
    // a player far away or behind the camera doesn't turn it
    expect(t._playerNear(o, [{ world: new THREE.Vector3(1000, 0, 0) }], [cam])).toBe(false);
    expect(t._playerNear(o, [null], [cam])).toBe(false);
    const away = camAt(o.origin[0] + 200, 30, o.origin[2], o.origin[0] + 1000, 0, o.origin[2]);
    expect(t._playerNear(o, [player], [away])).toBe(false);
  });

  it('kind 3 chases a player alongside through the corridor, then steps to their x', async () => {
    const t = new Thwomps(new THREE.Scene(), def('bowser'));
    await t.ready;
    const chasers = t.list.filter(x => x.kind === 3);
    frames(t, 1, []);
    const player = makeKart(track, { isPlayer: true });
    player.v = 30;
    player.world.set(1000 * 0.1, 0, -2650 * 0.1);
    // a path whose point 0xAC is the player's
    const path = Array.from({ length: 300 }, (_, i) => [i * 1000 + 50000, 0, 0]);
    path[0xAC] = [1000, 0, -2650];
    vi.spyOn(Math, 'random').mockReturnValue(0.99);   // the longest wait: 99 frames of weaving
    frames(t, 1, [], [player], [], path);
    vi.restoreAllMocks();
    expect(chasers[0].u048).toBe(99);
    expect(chasers.every(o => o.flags & 8 && o.dd === 1 && o.player === player)).toBe(true);
    // runs alongside at 1.25 x the player's speed, weaving in z, turning round, then back home
    const xs = [], zs = [], texs = new Set();
    for (let i = 0; i < 300; i++) {
      frames(t, 1, [], [player], [], path);
      xs.push(chasers[0].offset[0]); zs.push(chasers[0].offset[2]); texs.add(chasers[0].tex);
    }
    // the player leaves the corridor: the chasers finish their run and go home
    path[0xAC] = [9e6, 0, 0];
    for (let i = 0; i < 400 && chasers.some(o => o.flags & 8); i++) frames(t, 1, [], [player], [], path);
    expect(Math.max(...xs)).toBeGreaterThan(100);
    expect(Math.max(...zs)).toBeGreaterThan(0);
    expect(Math.min(...zs)).toBeLessThan(0);
    expect(texs.has(1)).toBe(true);
    expect(chasers[0].offset[0]).toBe(0);
    // a second pass from the far end: the 0xD7 zone steps across to the player's x
    path[0xD8] = [1000, 0, -2650];
    player.world.set(1150 * 0.1, 0, -2650 * 0.1);
    frames(t, 1, [], [player], [], path);
    expect(chasers[0].dd).toBe(2);
    expect(chasers[0].u01c[0]).toBeCloseTo(1150 - chasers[0].origin[0], 3);
    const xs2 = [];
    for (let i = 0; i < 300; i++) { frames(t, 1, [], [], [], path); xs2.push(chasers[0].offset[0]); }
    expect(Math.min(...xs2)).toBeCloseTo(1150 - chasers[0].origin[0], 3);
    expect(chasers[0].offset[0]).toBe(0);
    expect(chasers[0].flags & 8).toBe(0);
    // no path: no trigger
    expect(t._pathPoint(player)).toBeGreaterThanOrEqual(0);
    t.path = null;
    expect(t._pathPoint(player)).toBe(-1);
  });

  it('slams are heard by karts within 500 when a screen is near its section', async () => {
    const audio = fakeAudio();
    const t = new Thwomps(new THREE.Scene(), def('bowser'), { audio });
    await t.ready;
    const cam = camAt(...SECTION6, SECTION6[0] - 300, 0, SECTION6[2]);
    const kart = makeKart(track);
    kart.world.set(SECTION6[0] * 0.1, 0, SECTION6[2] * 0.1);
    for (let i = 0; i < 200 && !audio.playSound.mock.calls.some(c => c[1] === 0x0F); i++) frames(t, 1, [cam], [], [kart]);
    expect(t.sections.get(cam)).toBe(6);
    expect(audio.playSound.mock.calls.some(c => c[1] === 0x0F)).toBe(true);
    // 3 screens: never
    audio.playSound.mockClear();
    t.setScreens(3);
    frames(t, 200, [cam], [], [kart]);
    expect(audio.playSound.mock.calls.some(c => c[1] === 0x0F)).toBe(false);
  });

  it('render hook draws a Thwomp only near the screen section and inside the camera wedge', async () => {
    const scene = new THREE.Scene();
    const t = new Thwomps(scene, def('bowser'));
    await t.ready;
    const o = t.list.find(x => x.kind === 1), mesh = o.lit[1].mesh;
    const cam = camAt(...SECTION6, o.origin[0], 30, o.origin[2]);
    scene.updateMatrixWorld(true);
    mesh.onBeforeRender(null, scene, cam);
    expect(scale(mesh.matrixWorld)).toBe(0);   // state 1
    t.update(FRAME, [cam]);
    scene.updateMatrixWorld(true);
    mesh.onBeforeRender(null, scene, cam);
    expect(scale(mesh.matrixWorld)).toBeGreaterThan(0);
    const away = camAt(...SECTION6, SECTION6[0] + 500, 30, SECTION6[2]);
    t.sections.set(away, 6);
    mesh.onBeforeRender(null, scene, away);
    expect(scale(mesh.matrixWorld)).toBe(0);
    scene.updateMatrixWorld(true);
    t.sections.set(cam, 12);   // section too far
    mesh.onBeforeRender(null, scene, cam);
    expect(scale(mesh.matrixWorld)).toBe(0);
    // cameras dropped from the update are forgotten
    t.update(0, []);
    expect(t.sections.size).toBe(0);
  });

  it('mirrored: models flipped in x, light x negated; the type 0 light swirls', async () => {
    const t = new Thwomps(new THREE.Scene(), def('bowser'), { mirror: true });
    await t.ready;
    expect(t.list[0].group.scale.x).toBeCloseTo(-0.1);
    expect(t._dir([3, 0, 4])).toEqual([-0.6, 0, 0.8]);
    expect(t._dir([0, 0, 0])).toEqual([-0, 0, 0]);
    const o = t.list.find(x => x.type === 0);
    const before = Array.from(o.lit[1].mesh.geometry.attributes.color.array);
    frames(t, 20, []);
    expect(t.lightRot).toEqual([(20 * 0x100) & 0xFFFF, (20 * 0x200) & 0xFFFF]);   // one turn a frame
    expect(Array.from(o.lit[1].mesh.geometry.attributes.color.array)).not.toEqual(before);
  });
});
