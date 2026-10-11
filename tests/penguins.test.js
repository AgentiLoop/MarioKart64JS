import { describe, it, expect, vi, beforeAll, afterEach } from 'vitest';
import * as THREE from 'three';
import { Penguins, limbMatrix, objectMatrix, placedSound } from '../src/penguins.js';
import { makeTrack, makeKart, flush } from './helpers.js';

const camAt = (x, y, z, tx = 0, ty = 0, tz = 0) => {
  const c = new THREE.PerspectiveCamera(40, 1, 0.1, 10000);
  c.position.set(x * 0.1, y * 0.1, z * 0.1);
  c.lookAt(tx * 0.1, ty * 0.1, tz * 0.1);
  c.updateMatrixWorld(true);
  return c;
};
const fakeAudio = () => ({ playSound: vi.fn(), stopSound: vi.fn(), starMusic: vi.fn() });
const TICK = 1 / 60 + 1e-9;
const loaded = async p => { for (let i = 0; i < 100 && !p.data; i++) await flush(); return p; };

afterEach(() => vi.restoreAllMocks());

describe('limbMatrix / objectMatrix', () => {
  it('limbMatrix: zero angles is a pure translation', () => {
    const m = limbMatrix([1, 2, 3], [0, 0, 0], new THREE.Matrix4());
    expect(m.equals(new THREE.Matrix4().makeTranslation(1, 2, 3))).toBe(true);
  });

  it('limbMatrix: 0x4000 about y sends x to -z (N64 row vectors)', () => {
    const m = limbMatrix([0, 0, 0], [0, 0x4000, 0], new THREE.Matrix4());
    const v = new THREE.Vector3(1, 0, 0).applyMatrix4(m);
    expect(v.x).toBeCloseTo(0); expect(v.z).toBeCloseTo(-1);
    const w = new THREE.Vector3(0, 0, 1).applyMatrix4(limbMatrix([0, 0, 0], [0x4000, 0, 0], new THREE.Matrix4()));
    expect(w.y).toBeCloseTo(-1);   // 90 degrees about x sends z to -y
    const z = new THREE.Vector3(1, 0, 0).applyMatrix4(limbMatrix([0, 0, 0], [0, 0, 0x4000], new THREE.Matrix4()));
    expect(z.y).toBeCloseTo(1);
  });

  it('objectMatrix scales by scale x 0.1 and translates by pos x 0.1', () => {
    const m = objectMatrix([10, 20, 30], [0, 0, 0], 2, new THREE.Matrix4());
    const p = new THREE.Vector3(), q = new THREE.Quaternion(), s = new THREE.Vector3();
    m.decompose(p, q, s);
    expect(p.toArray().map(v => +v.toFixed(6))).toEqual([1, 2, 3]);
    expect(s.x).toBeCloseTo(0.2); expect(s.y).toBeCloseTo(0.2);
    const r = objectMatrix([0, 0, 0], [0, 0x4000, 0], 10, new THREE.Matrix4());
    const v = new THREE.Vector3(0, 0, 1).applyMatrix4(r);
    expect(v.x).toBeCloseTo(1);   // yaw 90 degrees: +z faces +x
  });
});

describe('placedSound', () => {
  it('full volume, centred, right on the camera', () => {
    const audio = fakeAudio(), cam = camAt(0, 0, 0, 0, 0, -10);
    placedSound(audio, [cam], [0, 0, 0], 1, 0x49, false);
    expect(audio.playSound).toHaveBeenCalledWith(1, 0x49, 1, 64);
  });

  it('volume falls with distance and is silent past 2000', () => {
    const audio = fakeAudio(), cam = camAt(0, 0, 0, 0, 0, -10);
    placedSound(audio, [cam], [0, 0, -400], 1, 1, false);
    expect(audio.playSound.mock.calls[0][2]).toBeCloseTo(0.25);   // (0.5)^2 at the near edge
    placedSound(audio, [cam], [0, 0, -1200], 1, 1, false);
    expect(audio.playSound.mock.calls[1][2]).toBeCloseTo(0.0625);   // ((1 - 0.5) * 0.5)^2
    placedSound(audio, [cam], [0, 0, -2100], 1, 1, false);
    expect(audio.playSound).toHaveBeenCalledTimes(2);
    placedSound(audio, [cam], [0, 0, -100], 1, 1, false, 1000);
    expect(audio.playSound.mock.calls[2][2]).toBeCloseTo((0.9 * 0.5 + 0.5) ** 2);
    placedSound(null, [cam], [0, 0, 0], 1, 1, false);   // no audio: nothing thrown
  });

  it('1P pans by where the sound sits across the camera; mirrored flips it', () => {
    const audio = fakeAudio(), cam = camAt(0, 0, 0, 0, 0, -10);   // right = +x, forward = -z
    placedSound(audio, [cam], [100, 0, 0], 1, 1, false);       // hard right
    placedSound(audio, [cam], [-100, 0, 0], 1, 1, false);      // hard left
    placedSound(audio, [cam], [10, 0, -100], 1, 1, false);     // ahead, a little right
    placedSound(audio, [cam], [100, 0, 0], 1, 1, true);        // mirrored right -> left
    const pans = audio.playSound.mock.calls.map(c => c[3]);
    expect(pans[0]).toBe(Math.floor((1 - 100 / 1000) * 127 + 0.5));   // 1 - (200 - 100) / (5 x 200)
    expect(pans[1]).toBe(Math.floor((100 / 1000) * 127 + 0.5));
    expect(pans[2]).toBe(Math.floor((10 / 333.33333 + 0.5) * 127 + 0.5));
    expect(pans[3]).toBe(pans[1]);
  });

  it('more screens pan each camera hard left / right', () => {
    const audio = fakeAudio(), a = camAt(0, 0, 0, 0, 0, -10), b = camAt(0, 0, 0, 0, 0, -10);
    placedSound(audio, [a, b], [50, 0, 0], 1, 7, false);
    expect(audio.playSound.mock.calls.map(c => c[3])).toEqual([0, 127]);
  });
});

describe('Penguins', () => {
  let track;
  beforeAll(async () => { track = await makeTrack('sherbet'); });

  it('the big penguin walks its spline round (-383, -690) even before the model loads', () => {
    const p = new Penguins(new THREE.Scene(), track);
    expect(p.small).toHaveLength(14);
    p.update(TICK, []);   // data not loaded yet
    const b = p.big;
    expect(b.spline.active).toBe(true);
    for (let i = 0; i < 200; i++) p.update(TICK, []);
    expect(Math.hypot(b.pos[0] + 383, b.pos[2] + 690)).toBeLessThan(25);
    expect(Math.hypot(b.pos[0] + 383, b.pos[2] + 690)).toBeGreaterThan(5);
    expect(b.dir).not.toBe(0);
    // the walk wraps round all 24 points and starts again
    for (let i = 0; i < 24 * 126; i++) p.walk(b);
    expect(b.spline.idx).toBeLessThan(24);
  });

  it('loads the armature, builds instances (sliders with reflections) and places them', async () => {
    const scene = new THREE.Scene();
    const p = await loaded(new Penguins(scene, track));
    expect(p.data).toBeTruthy();
    expect(p.big.view.group.children.length).toBeGreaterThan(0);
    expect(p.small.filter(o => o.mirrorView)).toHaveLength(6);
    const mesh = p.big.view.group.children[0];
    const pos = new THREE.Vector3().setFromMatrixPosition(mesh.matrix);
    expect(Math.hypot(pos.x + 38.3, pos.z + 69)).toBeLessThan(5);
    const colours = p.big.view.parts.values().next().value[0].color.array;
    expect(Math.max(...colours)).toBeGreaterThan(0);
  });

  it('swimmers circle, sliders turn, slide on their bellies and come back, squawking', async () => {
    const audio = fakeAudio();
    const p = await loaded(new Penguins(new THREE.Scene(), track, audio));
    const swim = p.small[0], slide = p.small[8];
    const cam = camAt(slide.pos[0], 50, slide.pos[2] + 100, slide.pos[0], 0, slide.pos[2]);
    const subs = new Set(), anims = new Set(), r = [];
    for (let i = 0; i < 300; i++) {
      p.update(5 / 60 + 1e-9, [cam]);   // five ticks per call
      subs.add(slide.sub); anims.add(slide.anim);
      r.push(Math.hypot(swim.pos[0] - swim.origin[0], swim.pos[2] - swim.origin[2]));
    }
    expect(Math.min(...r)).toBeCloseTo(swim.r, 3);
    expect(Math.max(...r)).toBeCloseTo(swim.r, 3);
    expect([...subs].sort()).toEqual([1, 2, 3, 4, 5, 6]);
    expect([...anims].sort()).toEqual([0, 1, 2]);
    // ice penguins squawk 0x49 when near enough to be heard
    expect(audio.playSound.mock.calls.some(c => c[1] === 0x49)).toBe(true);
    // the big penguin waddles one frame a tick and shows in 1P
    expect(p.big.view.group.visible).toBe(true);
    p.update(TICK, [cam, camAt(0, 0, 0)]);
    expect(p.big.view.group.visible).toBe(false);
  });

  it('reflections show only while a camera is near the slider', async () => {
    const p = await loaded(new Penguins(new THREE.Scene(), track));
    const o = p.small[8];
    p.update(TICK, [camAt(o.pos[0] + 100, 30, o.pos[2])]);
    expect(o.mirrorView.group.visible).toBe(true);
    p.update(TICK, [camAt(o.pos[0] + 3000, 30, o.pos[2])]);
    expect(o.mirrorView.group.visible).toBe(false);
  });

  it('bonks karts it touches; a star kart makes it spin instead', async () => {
    const audio = fakeAudio();
    const p = await loaded(new Penguins(new THREE.Scene(), track, audio));
    const o = p.small[8];
    const k = makeKart(track, { isPlayer: true });
    k.v = 40;
    k.world.set(o.pos[0] * 0.1, 0, o.pos[2] * 0.1);
    p.collide(o, [k]);
    expect(k.push).toBeTruthy();
    expect(audio.playSound).toHaveBeenCalledWith(1, 0x46);
    // a star kart: the penguin spins for 0x96 ticks and squawks every 16
    const star = makeKart(track);
    star.star = 5;
    star.world.copy(k.world);
    p.collide(o, [star]);
    expect(o.flags & 0x60).toBe(0x60);
    p.spinStep(o);
    expect(o.spinT).toBe(0x95);
    expect(o.yaw).toBe(0x2000 * (o.yaw / 0x2000));
    o.call = 0;
    p.call(o);
    expect(o.call).toBe(0x10);
    expect(o.flags & 0x80).toBe(0x80);
    p.call(o);
    expect(o.call).toBe(0x0F);
    for (let i = 0; i < 0x96; i++) p.spinStep(o);
    expect(o.flags & 0x20).toBe(0);
    expect(o.yaw).toBe(o.dir);
    // protected or far karts are skipped
    const boo = makeKart(track); boo.boo = 3; boo.world.copy(k.world);
    const far = makeKart(track); far.world.set(o.pos[0] * 0.1 + 100, 0, o.pos[2] * 0.1);
    p.collide(o, [boo, far]);
    expect(boo.push).toBeFalsy();
    expect(far.push).toBeFalsy();
  });

  it('the bounding box widens while sliding (flag 1) and for swimmers (flag 8)', async () => {
    const p = await loaded(new Penguins(new THREE.Scene(), track));
    const o = p.small[0];   // swimmer
    const k = makeKart(track);
    k.v = 10;
    k.world.set(o.pos[0] * 0.1, 0, o.pos[2] * 0.1);
    const spy = vi.spyOn(k, 'bonk');
    p.collide(o, [k]);
    expect(spy.mock.calls[0][4]).toBe(1.3);
    const s = p.small[8];
    s.flags |= 1;
    k.bonkWait = 0;
    k.world.set(s.pos[0] * 0.1, 0, s.pos[2] * 0.1);
    p.collide(s, [k]);
    expect(spy.mock.calls[1][4]).toBe(1.75);
    s.flags &= ~1;
    k.bonkWait = 0;
    p.collide(s, [k]);
    expect(spy.mock.calls[2][4]).toBe(1.5);
  });

  it('animate plays once then advances the state', async () => {
    const p = await loaded(new Penguins(new THREE.Scene(), track));
    const o = { animOn: false, state: 3, frame: 0, cc: 0 };
    p.animate(o, 0, 2, 1, 0);
    expect(o.frame).toBe(0);
    p.animate(o, 0, 2, 1, 0); p.animate(o, 0, 2, 1, 0); p.animate(o, 0, 2, 1, 0);
    expect(o.state).toBe(4);
    expect(o.frame).toBe(2);
    const loop = { animOn: false, state: 2, frame: 0, cc: 0 };
    p.animate(loop, 0, 1, 1, 2);
    for (let i = 0; i < 2; i++) p.animate(loop, 0, 1, 1, 2);
    expect(loop.frame).toBe(0);   // looped once (cc 2 -> 1)
    expect(loop.state).toBe(2);
    // state 4 clears the slide flag and goes to 5
    const s = { state: 4, flags: 3, anim: 0 };
    p.animateSmall(s);
    expect(s).toMatchObject({ state: 5, flags: 1 });
  });

  it('mirrored courses turn the swimmers the other way', async () => {
    const plain = new Penguins(new THREE.Scene(), track);
    const mir = new Penguins(new THREE.Scene(), { mirror: true, def: track.def });
    expect(mir.mirror).toBe(true);
    expect(mir.small[0].c6).toBe((-plain.small[0].c6) & 0xFFFF);
    expect(mir.small[8].c6).not.toBe(plain.small[8].c6);
  });

  it('a missing penguin.json leaves it unloaded', async () => {
    const p = new Penguins(new THREE.Scene(), { def: { dir: 'no-such-course' } });
    for (let i = 0; i < 5; i++) await flush();
    expect(p.data).toBeNull();
    p.update(TICK, []);
    expect(p.big.spline.active).toBe(true);
  });
});
