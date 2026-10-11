import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
import * as THREE from 'three';
import { Lakitu, fluidLevel, fluidAt } from '../src/lakitu.js';
import { NATIVE_SCALE as S, battleSpawn } from '../src/track.js';
import { makeTrack, makeKart, flush } from './helpers.js';

const K = 4.5 / 13.5;
const fakeTrack = (id, native) => ({ def: { id, native }, fluidY: -123 });
const tick = (lak, karts, n, laps = 3, each) => { for (let i = 0; i < n; i++) { each?.(i); lak.update(1 / 60, karts, laps); } };
const camFor = k => { const c = new THREE.PerspectiveCamera(60, 4 / 3, 0.1, 5000); c.position.set(k.world.x, k.world.y + 4, k.world.z + 12); c.lookAt(k.world); c.updateMatrixWorld(); return c; };
const fakeModel = () => { const g = new THREE.Group(); g.userData.setLayer = vi.fn(); g.userData.show = vi.fn(); return g; };

describe('fluidLevel', () => {
  it('is far below everything without native course data', () => {
    expect(fluidLevel(fakeTrack('x', null))).toBe(-1e4 * S);
  });
  it('uses the per-course fluid level table', () => {
    expect(fluidLevel(fakeTrack('sherbet', { vertices: [] }))).toBeCloseTo(-18 * S);
    expect(fluidLevel(fakeTrack('dk', { vertices: [] }))).toBeCloseTo(-475 * S);
    expect(fluidLevel(fakeTrack('rainbow', { vertices: [] }))).toBe(0);
  });
  it('else 10 under the lowest collision triangle, or the lowest vertex', () => {
    const vertices = [[0, 5, 0], [0, -40, 0], [0, -90, 0]];
    expect(fluidLevel(fakeTrack('mario', { vertices, collision: { indices: [0, 1] } }))).toBeCloseTo(-50 * S);
    expect(fluidLevel(fakeTrack('mario', { vertices }))).toBeCloseTo(-100 * S);
    expect(fluidLevel(fakeTrack('mario', { vertices: [[0, 50, 0]] }))).toBeCloseTo(-10 * S);   // min starts at 0
  });
  it('matches real course data', async () => {
    const t = await makeTrack('koopa');
    expect(fluidLevel(t)).toBeLessThan(0);
    const b = await makeTrack('bowser');
    expect(fluidLevel(b)).toBeCloseTo(-50 * S);
  });
});

describe('fluidAt', () => {
  it('uses the track level without native data or by default', () => {
    expect(fluidAt(fakeTrack('bowser', null), 0, 0)).toBe(-123);
    expect(fluidAt(fakeTrack('mario', {}), 0, 0)).toBe(-123);
  });
  it('Bowser\'s Castle moat by the drawbridge', () => {
    const t = fakeTrack('bowser', {});
    expect(fluidAt(t, 1700 * S, -1200 * S)).toBeCloseTo(20 * S);
    expect(fluidAt(t, 1900 * S, -1200 * S)).toBe(-123);
    expect(fluidAt(t, 1700 * S, -1500 * S)).toBe(-123);
  });
  it('Koopa Troopa Beach pool', () => {
    const t = fakeTrack('koopa', {});
    expect(fluidAt(t, 100 * S, 2300 * S)).toBeCloseTo(0.8 * S);
    expect(fluidAt(t, 0, 2300 * S)).toBe(-123);
  });
  it('Sherbet Land snow tunnel', () => {
    const t = fakeTrack('sherbet', { vertices: [[0, -30, 0]] });
    expect(fluidAt(t, 0, 0, { surface: 0x05 })).toBeCloseTo(-40 * S);
    expect(t.courseMinY).toBe(-30);
    expect(fluidAt(t, 0, 0, { surface: 1 })).toBe(-123);
    expect(fluidAt(t, 0, 0)).toBe(-123);
  });
  it('D.K.\'s Jungle Parkway river vs. cave', () => {
    const t = fakeTrack('dk', {});
    expect(fluidAt(t, 0, 0, { section: 0x14 })).toBeCloseTo(-475 * S);
    expect(fluidAt(t, 0, 0, { section: 0x10 })).toBeCloseTo(-33.9 * S);
    expect(fluidAt(t, 0, 0, { surface: 0x0F })).toBeCloseTo(-475 * S);
    expect(fluidAt(t, -400 * S, 0)).toBeCloseTo(-33.9 * S);
    expect(fluidAt(t, -900 * S, -800 * S)).toBeCloseTo(-475 * S);
    expect(fluidAt(t, -600 * S, -400 * S)).toBeCloseTo(-475 * S);
    expect(fluidAt(t, -600 * S, -1000 * S)).toBeCloseTo(-33.9 * S);
    expect(fluidAt(t, -600 * S, -700 * S)).toBeCloseTo(-475 * S);   // z < x
    expect(fluidAt(t, -700 * S, -600 * S)).toBeCloseTo(-33.9 * S);
  });
});

describe('Lakitu on Mario Raceway', () => {
  let track, scene, lak, kart, cam;
  beforeAll(async () => { track = await makeTrack('mario'); });
  beforeEach(() => {
    scene = new THREE.Scene();
    lak = new Lakitu(scene, track);
    kart = makeKart(track, { isPlayer: true, s: 200 });
    cam = camFor(kart);
    lak.setViews([{ kart, cam }]);
  });

  it('installs the fluid level and loads the sprite atlases', () => {
    expect(track.fluidY).toBe(fluidLevel(track));
    expect(track.fluidAt(0, 0)).toBe(track.fluidY);
    expect(Object.keys(lak.textures).sort()).toEqual(['countdown', 'finallap', 'fishing', 'flag', 'reverse', 'secondlap']);
    expect(lak.ice).toBeNull();
    expect(lak.referees).toHaveLength(1);
    expect(cam.layers.isEnabled(1)).toBe(true);
    expect(cam.layers.isEnabled(2)).toBe(false);
    expect(scene.children).toContain(lak.referees[0].mesh);
  });

  it('setViews replaces the referees, one layer per screen', () => {
    const old = lak.referees[0];
    const k2 = makeKart(track, { s: 220 }), c2 = camFor(k2);
    lak.setViews([{ kart, cam }, { kart: k2, cam: c2 }]);
    expect(scene.children).not.toContain(old.mesh);
    expect(lak.referees.map(r => r.layer)).toEqual([1, 2]);
    expect(c2.layers.isEnabled(2)).toBe(true);
    expect(c2.layers.isEnabled(1)).toBe(false);
  });

  it('runs the countdown: red, red, ready, green, then flies off', () => {
    const lights = [];
    lak.startCountdown(l => lights.push(l));
    const r = lak.referees[0];
    expect(r.mode).toBe('countdown');
    expect(r.seen).toEqual({ lap: 1, finished: false });
    tick(lak, [kart], 20);
    expect(r.visible).toBe(true);
    expect(r.mesh.visible).toBe(true);
    let maxFrame = 0;
    tick(lak, [kart], 60 * 8, 3, () => { maxFrame = Math.max(maxFrame, r.frame); });
    expect(lights).toEqual(['red', 'red', 'ready', 'green']);
    expect(maxFrame).toBe(27);
    expect(r.mode).toBeNull();
    expect(r.mesh.visible).toBe(false);
  });

  it('shows the lap signs and the finish flag', () => {
    lak.startCountdown(() => {});
    const r = lak.referees[0];
    tick(lak, [kart], 60 * 8);
    expect(r.mode).toBeNull();
    kart.crossings = 1;
    tick(lak, [kart], 1);
    expect(r.mode).toBe('secondlap');
    expect(r.seen.lap).toBe(2);
    let maxFrame = 0;
    tick(lak, [kart], 60 * 6, 3, () => { maxFrame = Math.max(maxFrame, r.frame); });
    expect(maxFrame).toBe(15);
    expect(r.mode).toBeNull();
    kart.crossings = 2;
    tick(lak, [kart], 1);
    expect(r.mode).toBe('finallap');
    tick(lak, [kart], 60 * 6);
    expect(r.mode).toBeNull();
    kart.finished = true;
    tick(lak, [kart], 1);
    expect(r.mode).toBe('flag');
    tick(lak, [kart], 60);
    expect(r.visible).toBe(true);
    tick(lak, [kart], 60 * 7);
    expect(r.mode).toBeNull();
    // already seen: no second flag
    tick(lak, [kart], 2);
    expect(r.mode).toBeNull();
  });

  it('a kart in Lakitu\'s hands gets no lap sign', () => {
    lak.startCountdown(() => {});
    tick(lak, [kart], 60 * 8);
    kart.rescue = { phase: 4, held: true, alpha: 1, road: 0, y: kart.world.y, count: 0, swing: 0, swingV: 0, swingDir: 1 };
    kart.crossings = 1;
    tick(lak, [kart], 1);
    expect(lak.referees[0].seen.lap).toBe(2);
    expect(lak.referees[0].mode).not.toBe('secondlap');
  });

  it('holds up the reverse sign while the kart drives the wrong way', () => {
    const hum = vi.fn();
    lak.onHum = hum;
    const r = lak.referees[0];
    kart.psi = Math.PI;
    tick(lak, [kart], 6, 3, () => { kart.s -= 0.5; });
    expect(kart.wrongWay).toBe(true);
    expect(r.mode).toBe('reverse');
    expect(hum).toHaveBeenLastCalledWith(true);
    tick(lak, [kart], 60);
    expect(r.mode).toBe('reverse');
    kart.psi = 0;
    tick(lak, [kart], 1);
    expect(kart.wrongWay).toBe(false);
    expect(hum).toHaveBeenLastCalledWith(false);
    tick(lak, [kart], 60 * 3);
    expect(r.mode).toBeNull();
  });

  it('wrongWay: wraps progress across the line and resets for finished karts', () => {
    const L = track.length;
    const k = { s: 1, psi: Math.PI, wrongS: L - 1, wrongCount: 0 };
    lak.wrongWay(k);   // ds = 2 - L -> +2 after wrap: progress, not wrong
    expect(k.wrongCount).toBe(0);
    k.s = L - 1; k.wrongS = 1;   // ds wraps to -2
    lak.wrongWay(k);
    expect(k.wrongCount).toBe(1);
    k.psi = 1;   // between the bands: unchanged
    k.wrongS = k.s + 1;
    lak.wrongWay(k);
    expect(k.wrongCount).toBe(1);
    k.finished = true;
    lak.wrongWay(k);
    expect(k).toMatchObject({ wrongWay: false, wrongCount: 0, wrongS: k.s });
  });

  it('fishes out a kart that fell into the void', () => {
    const hum = vi.fn();
    lak.onHum = hum;
    const r = lak.referees[0];
    const s0 = kart.s;
    kart.lastGroundS = s0;
    kart.fell = { kind: 'drop', base: kart.world.y - 20 };
    tick(lak, [kart], 1);
    expect(kart.fell).toBeNull();
    expect(kart.rescue).toMatchObject({ kind: 'drop', phase: 0 });
    expect(r.mode).toBe('fishing');
    expect(hum).toHaveBeenLastCalledWith(true);
    const phases = new Set();
    let minAlpha = 1;
    tick(lak, [kart], 60 * 12, 3, () => { if (kart.rescue) { phases.add(kart.rescue.phase); minAlpha = Math.min(minAlpha, kart.rescue.alpha); } });
    expect([...phases].sort()).toEqual([0, 1, 2, 3, 4]);
    expect(minAlpha).toBe(0);
    expect(kart.rescue).toBeNull();
    expect(kart.s).toBe(s0);
    expect(kart.mesh.userData.lean).toBe(0);
    expect(hum).toHaveBeenLastCalledWith(false);
    expect(r.mode).toBeNull();
  });

  it('a kart that fell into water sinks first; crossing the line backwards is undone', () => {
    const L = track.length;
    kart.s = L * 0.1; kart.lastGroundS = L * 0.9; kart.crossings = 1;
    kart.fell = { kind: 'water', base: kart.world.y - 5 };
    tick(lak, [kart], 1);
    tick(lak, [kart], 30);
    expect(kart.rescue.count).toBe(31);
    tick(lak, [kart], 60 * 15);
    expect(kart.rescue).toBeNull();
    expect(kart.crossings).toBe(0);
    expect(kart.s).toBeCloseTo(L * 0.9);
  });

  it('crossing the line forwards while falling counts the lap', () => {
    const L = track.length;
    kart.s = L * 0.9; kart.lastGroundS = L * 0.1; kart.crossings = 0;
    kart.fell = { kind: 'drop', base: kart.world.y };
    tick(lak, [kart], 60 * 12);
    expect(kart.crossings).toBe(1);
  });

  it('CPU karts are held at once without a referee; remote karts are skipped', () => {
    const cpu = makeKart(track, { s: 300 }), remote = makeKart(track, { s: 320 });
    remote.remote = true; remote.fell = { kind: 'drop', base: 0 };
    cpu.fell = { kind: 'drop', base: cpu.world.y };
    tick(lak, [kart, cpu, remote], 1);
    expect(cpu.rescue.held).toBe(true);
    expect(remote.fell).toBeTruthy();
    expect(lak.referees[0].mode).toBeNull();
    tick(lak, [kart, cpu], 60 * 10);
    expect(cpu.rescue).toBeNull();
  });

  it('mirrors the sprite UVs for a mirrored camera and flags offscreen', () => {
    lak.startCountdown(() => {});
    const r = lak.referees[0];
    tick(lak, [kart], 60 * 2);
    const uv = [...r.mesh.geometry.attributes.uv.array];
    cam.userData.mirror = true;
    tick(lak, [kart], 1);
    const uvm = [...r.mesh.geometry.attributes.uv.array];
    expect(uvm[0]).toBeGreaterThan(uvm[2]);
    expect(uv[0]).toBeLessThan(uv[2]);
    cam.position.set(1e4, 1e4, 1e4); cam.lookAt(2e4, 2e4, 2e4);
    tick(lak, [kart], 1);
    expect(r.offscreen).toBe(true);
  });

  it('exit() leaves at once when offscreen, else keeps flying', () => {
    const r = lak.referees[0];
    r.start('flag', kart);
    r.visible = true; r.offscreen = false;
    r.vel = [1, 0, 0];
    r.exit();
    expect(r.exiting).toBe(120);
    const x0 = r.offset[0];
    r.tick();
    expect(r.offset[0]).toBe(x0 + 1);
    r.offscreen = true;
    r.tick();
    expect(r.mode).toBeNull();
    r.start('flag', kart);
    r.exit();   // not visible yet
    expect(r.mode).toBeNull();
  });

  it('set3D swaps in a 3D model per referee and back to sprites', async () => {
    const build = vi.fn(async () => fakeModel());
    await lak.set3D(build);
    const r = lak.referees[0], m = r.model;
    expect(m).toBeTruthy();
    expect(m.userData.setLayer).toHaveBeenCalledWith(1);
    expect(scene.children).toContain(m);
    lak.startCountdown(() => {});
    tick(lak, [kart], 60);
    expect(m.visible).toBe(true);
    expect(r.mesh.visible).toBe(false);
    expect(m.userData.show).toHaveBeenLastCalledWith('countdown', expect.any(Number), 1, 1);
    expect(m.position.equals(r.mesh.position)).toBe(true);
    // new views rebuild the models
    lak.setViews([{ kart, cam }]);
    await flush();
    expect(build).toHaveBeenCalledTimes(2);
    expect(scene.children).not.toContain(m);
    expect(lak.referees[0].model).toBeTruthy();
    lak.referees[0].stop();
    expect(lak.referees[0].model.visible).toBe(false);
    tick(lak, [kart], 1);
    await lak.set3D(null);
    expect(lak.referees[0].model).toBeNull();
    expect(lak.build3D).toBeNull();
  });

  it('a superseded set3D build is dropped', async () => {
    let resolve;
    const slow = () => new Promise(r => { resolve = r; });
    const p = lak.set3D(slow);
    const fast = async () => fakeModel();
    await lak.set3D(fast);
    const m = lak.referees[0].model;
    resolve(fakeModel());
    await p;
    expect(lak.referees[0].model).toBe(m);
  });
});

describe('Lakitu in a battle arena', () => {
  it('fishes his player out of the lava when Kart.updateFree sets the rescue timer', async () => {
    const track = await makeTrack('block-fort');
    const scene = new THREE.Scene(), lak = new Lakitu(scene, track);
    const kart = makeKart(track, { isPlayer: true, spawn: battleSpawn('block-fort', 0) });
    lak.setViews([{ kart, cam: camFor(kart) }]);
    expect(kart.free).toBe(true);
    kart.rescue = 1.5;
    tick(lak, [kart], 1, 0);
    const r = lak.referees[0];
    expect(r.mode).toBe('fishing');
    expect(r.offset[1]).toBe(29);   // comes down from 30
    tick(lak, [kart], 40, 0);
    expect(r.stage).toBe(2);
    kart.rescue = 0;
    tick(lak, [kart], 1, 0);
    expect(r.stage).toBe(3);
    tick(lak, [kart], 60 * 4, 0);
    expect(r.mode).toBeNull();
  });
});

describe('Lakitu on Sherbet Land (ice block)', () => {
  let track;
  beforeAll(async () => { track = await makeTrack('sherbet'); });

  async function setup(views = 1) {
    const scene = new THREE.Scene(), lak = new Lakitu(scene, track);
    const karts = Array.from({ length: views }, (_, i) => makeKart(track, { isPlayer: true, s: 200 + 20 * i }));
    lak.setViews(karts.map(kart => ({ kart, cam: camFor(kart) })));
    for (let i = 0; i < 20 && !lak.ice.data; i++) await flush();
    return { scene, lak, karts };
  }
  const freeze = k => { k.fell = { kind: 'water', base: track.fluidY }; k.world.y = track.fluidY - 5; };

  it('builds the ice block, mirror and shard meshes from iceblock.json', async () => {
    const { lak, scene } = await setup();
    expect(lak.ice).toBeTruthy();
    expect(lak.ice.data).toBeTruthy();
    expect(scene.children).toContain(lak.ice.mirror);
    expect(lak.ice.shardMeshes).toHaveLength(5);
  });

  it('freezes the kart, breaks the ice, thaws the frost and goes', async () => {
    const { lak, karts: [kart] } = await setup();
    const sounds = [];
    lak.onSound = (b, id) => sounds.push(id);
    const setCold = vi.spyOn(kart.mesh.userData, 'setCold');
    freeze(kart);
    tick(lak, [kart], 1);
    const r = lak.referees[0];
    expect(r.ice).toBe(true);
    expect(kart.rescue.frozen).toBe(true);
    expect(kart.cold.mode).toBe('frigid');
    let sawBlock = false, sawMirror = false, sawShards = false, maxRed = 0;
    tick(lak, [kart], 60 * 20, 3, () => {
      if (r.block) sawBlock = lak.ice.blocks[0]?.visible || sawBlock;
      if (lak.ice.mirror.visible) sawMirror = true;
      if (lak.ice.shards.length) sawShards = lak.ice.shardMeshes[0].count > 0 || sawShards;
      if (kart.cold) maxRed = Math.max(maxRed, kart.cold.env[0]);
    });
    expect(sounds).toEqual([0x55, 0x56]);
    expect(sawBlock).toBe(true);
    expect(sawMirror).toBe(true);
    expect(sawShards).toBe(true);
    expect(maxRed).toBeGreaterThan(100);
    expect(kart.rescue).toBeNull();
    expect(kart.cold).toBeNull();
    expect(r.mode).toBeNull();
    expect(setCold).toHaveBeenLastCalledWith([0, 0, 0], [0, 0, 0]);
    expect(lak.ice.shards).toHaveLength(0);
  });

  it('a new scene takes the frost off a held kart, or lets a released one go', async () => {
    const { lak, karts: [kart] } = await setup();
    freeze(kart);
    tick(lak, [kart], 1);
    const r = lak.referees[0];
    tick(lak, [kart], 100);
    expect(kart.rescue.held).toBe(true);
    r.start('countdown', kart);   // endIce while held
    expect(kart.rescue.frozen).toBe(false);
    expect(kart.cold).toBeNull();
    expect(r.ice).toBe(false);
    tick(lak, [kart], 60 * 10);
    expect(kart.rescue).toBeNull();   // not frozen: let go normally

    const { lak: lak2, karts: [k2] } = await setup();
    freeze(k2);
    tick(lak2, [k2], 1);
    const r2 = lak2.referees[0];
    tick(lak2, [k2], 60 * 20, 3, () => { if (k2.rescue?.released) r2.stop(); });
    expect(k2.rescue).toBeNull();
  });

  it('two screens: shards on every screen; four screens: on their own layer; extra blocks hidden', async () => {
    const { lak, karts } = await setup(2);
    lak.ice.shatter(karts[0], 2, 1);
    expect(lak.ice.shards).toHaveLength(40);
    expect(lak.ice.shards.every(s => s.l === 0)).toBe(true);
    lak.ice.shatter(karts[0], 4, 3);
    expect(lak.ice.shards).toHaveLength(70);
    expect(lak.ice.shards.at(-1).l).toBe(3);
    lak.ice.shatter(karts[0], 1, 1);
    expect(lak.ice.shards).toHaveLength(150);
    tick(lak, karts, 1);
    expect(lak.ice.shardMeshes[0].count).toBe(120);
    expect(lak.ice.shardMeshes[3].count).toBe(30);
    expect(lak.ice.blocks).toHaveLength(2);
    lak.setViews([{ kart: karts[0], cam: camFor(karts[0]) }]);
    tick(lak, [karts[0]], 1);
    expect(lak.ice.blocks[1].visible).toBe(false);
    tick(lak, [karts[0]], 120);
    expect(lak.ice.shards).toHaveLength(0);
  });

  it('a kart above the water is fished out without ice', async () => {
    const { lak, karts: [kart] } = await setup();
    kart.fell = { kind: 'drop', base: kart.world.y };
    tick(lak, [kart], 1);
    expect(lak.referees[0].ice).toBeFalsy();
    expect(kart.cold).toBeFalsy();
  });
});
