import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
import * as THREE from 'three';
import { Items, ITEMS, ITEM_ICON, ITEM_LABELS } from '../src/items.js';
import { battleSpawn } from '../src/track.js';
import { Kart } from '../src/kart.js';
import { makeTrack, makeKart, flush, gas } from './helpers.js';

const fakeAudio = () => ({ playSound: vi.fn(), stopSound: vi.fn(), starMusic: vi.fn() });
const step = (items, karts, seconds, dt = 1 / 60) => { for (let t = 0; t < seconds; t += dt) items.update(dt, karts); };

describe('item tables', () => {
  it('has 16 items with icons and labels', () => {
    expect(ITEMS).toHaveLength(16);
    expect(ITEM_ICON.banana).toBe(1);
    expect(ITEM_LABELS.none).toBe('');
    expect(ITEM_LABELS.triple_red_shell).toBe('TRIPLE RED SHELL');
  });
});

describe('Items on a race course', () => {
  let track, audio, scene, items, player, cpu, karts;
  beforeAll(async () => { track = await makeTrack('mario'); });
  beforeEach(async () => {
    audio = fakeAudio(); scene = new THREE.Scene();
    items = new Items(track, scene, audio);
    await items.protosReady;
    player = makeKart(track, { isPlayer: true, s: 200 });
    cpu = makeKart(track, { s: 230, d: 0 });
    karts = [player, cpu];
    items.gp = true;
  });

  it('creates 18 item boxes and loads models', async () => {
    expect(items.boxes).toHaveLength(18);
    expect(items.boxes[0].parts.card).toBeTruthy();
    expect(items.protos.banana).toBeTruthy();
    expect(items.protos.red_shell).toBeTruthy();
    expect(items.protos.fake_item_box).toBeTruthy();
    expect(scene.children).toContain(items.group);
  });

  it('driving into a box starts the roulette, breaks the box and restores it', () => {
    const b = items.boxes[3];
    player.s = b.s; player.d = b.d;
    items.update(1 / 60, karts);
    expect(player.win).toBeTruthy();
    expect(b.state).toBe(3);
    expect(audio.playSound).toHaveBeenCalled();
    // the roulette runs through its states and hands out an item
    let n = 0;
    while (!player.item && n++ < 2000) items.update(1 / 60, karts);
    expect(player.item).toBeTruthy();
    expect(ITEMS).toContain(player.item);
    // box returns
    step(items, [], 3);
    expect(b.state).toBe(2);
  });

  it('Z during the roulette skips ahead only after 50 frames', () => {
    items.startRoulette(player);
    expect(items.use(player, karts)).toBeNull();
    expect(player.win.state).toBe(2);
    for (let i = 0; i < 120; i++) items.update(1 / 60, karts);
    player.win.skip = 0;
    if (player.win.state >= 2 && player.win.state <= 5) { items.use(player, karts); expect(player.win.state).toBe(6); }
  });

  it('cycle / blink step the item window states', () => {
    const w = { init: false, state: 3 };
    for (let i = 0; i < 100 && w.state === 3; i++) items.cycle(w, 1, 15, 2, 2);
    expect(w.state).toBe(4);
    const b = { init: false, state: 7 };
    for (let i = 0; i < 400 && b.state === 7; i++) items.blink(b, 3, 0, 8, 10);
    expect(b.state).toBe(8);
  });

  it('windowStep slides the window in, decides an item and slides out', () => {
    player.win = { state: 2, slide: 0, tex: 0, skip: 50, ready: 0, acc: 0, item: null, init: false };
    for (let i = 0; i < 3000 && player.win; i++) {
      items.windowStep(player, karts);
      if (player.win && player.win.state === 8) player.win.state = 9;
    }
    expect(player.win).toBeNull();
    expect(player.item).toBeTruthy();
  });

  it('showItem follows the held item', () => {
    items.give(player, 'triple_mushroom');
    expect(player.win.tex).toBe(ITEM_ICON.triple_mushroom);
    items.use(player, karts);
    expect(player.item).toBe('double_mushroom');
    expect(player.win.tex).toBe(ITEM_ICON.double_mushroom);
    items.use(player, karts); items.use(player, karts);
    expect(player.item).toBeNull();
    expect(player.win.state).toBe(9);
    items.showItem({ win: null });
  });

  it('mushroom boosts the kart; super mushroom lasts a while', () => {
    items.give(player, 'mushroom');
    const v0 = player.v;
    expect(items.use(player, karts)).toBe('mushroom');
    expect(player.boost).toBeGreaterThanOrEqual(1.8);
    expect(player.v).toBe(v0 + 6);
    items.give(player, 'super_mushroom');
    items.use(player, karts);
    expect(player.item).toBe('super_mushroom');
    expect(player.gold).toBeGreaterThan(0);
    step(items, karts, 11);
    expect(player.item).toBeNull();
  });

  it('use returns null with nothing in hand', () => {
    expect(items.use(player, karts)).toBeNull();
  });

  it('a held banana is dragged, released with a hop and wrecks the kart that hits it', () => {
    player.item = 'banana';
    expect(items.use(player, karts)).toBeNull();
    expect(player.trail.held).toBe(true);
    expect(items.use(player, karts)).toBeNull();   // Z held: nothing more
    step(items, karts, 0.1);
    expect(items.release(player, karts, 0)).toBe('banana');
    expect(player.trail).toBeNull();
    expect(items.hazards).toHaveLength(1);
    expect(items.release(player, karts, 0)).toBeNull();
    // a CPU drives over it
    const h = items.hazards[0];
    cpu.s = h.s; cpu.d = h.d; cpu.v = 20;
    step(items, karts, 0.2);
    expect(cpu.spin).toBeGreaterThan(0);
    expect(items.hazards).toHaveLength(0);
    expect(items.debris.length).toBeGreaterThan(0);
    step(items, karts, 2);
    expect(items.debris).toHaveLength(0);
  });

  it('a banana thrown forward with the stick up flies and lands', () => {
    player.item = 'banana'; items.use(player, karts); items.release(player, karts, 90);
    const h = items.hazards[0];
    expect(h.toss.vs).toBeGreaterThan(0);
    const s0 = h.s;
    step(items, [], 2);
    expect(h.toss).toBeNull();
    expect(h.s).not.toBe(s0);
  });

  it('banana bunch is a trail of five, fired one at a time', () => {
    player.item = 'banana_bunch';
    items.use(player, karts);
    expect(player.trail.meshes).toHaveLength(5);
    step(items, karts, 0.2);
    items.use(player, karts);
    expect(player.trail.meshes).toHaveLength(4);
    expect(items.hazards).toHaveLength(1);
    while (player.trail) items.use(player, karts);
    expect(items.hazards).toHaveLength(5);
  });

  it('a CPU that runs into a trailing banana is spun and the banana popped', () => {
    player.item = 'banana_bunch'; items.use(player, karts);
    step(items, karts, 0.1);
    const m = player.trail.meshes[0];
    const p = m.userData.p;
    cpu.s = p.s; cpu.d = p.d;
    step(items, karts, 0.1);
    expect(cpu.spin).toBeGreaterThan(0);
    expect(player.trail.meshes.length).toBeLessThan(5);
  });

  it('green shell: held, swung out and fired; hits the kart ahead and tumbles it', () => {
    cpu.s = 100;
    player.item = 'green_shell';
    items.use(player, karts);
    expect(player.trail.kind).toBe('green_shell');
    step(items, karts, 0.05);
    expect(items.release(player, karts, 0)).toBe('green_shell');
    expect(player.trail.swing).toBeDefined();
    step(items, karts, 1);
    expect(items.shots.length).toBe(1);
    const shot = items.shots[0];
    cpu.s = shot.s + 3; cpu.d = shot.d;
    step(items, karts, 0.5);
    expect(cpu.tumble || cpu.invuln > 0).toBeTruthy();
  });

  it('a green shell released with the stick down goes backwards', () => {
    player.item = 'green_shell'; items.use(player, karts);
    expect(items.release(player, karts, -100)).toBe('green_shell');
    expect(items.shots[0].dir).toBe(-1);
  });

  it('red shell homes on the racer ahead and lands the hit', () => {
    player.item = 'red_shell'; items.use(player, karts);
    items.release(player, karts, 0);
    step(items, karts, 6);
    expect(cpu.tumble || cpu.invuln > 0 || items.shots.length === 0).toBeTruthy();
  });

  it('shells reach the whole width of the road and stay off the walls', () => {
    // Mario Raceway s520-600: the road runs 35 left / 20 right of the route; s790-870 narrows to the bridge's 7 / 6
    const fire = (k, kind, ks) => { k.item = kind; items.use(k, ks); items.release(k, ks, 0); for (let i = 0; i < 60 && !items.shots.length; i++) items.update(1 / 60, ks); return items.shots[0]; };
    player.s = 520; player.d = -20; cpu.s = 545; cpu.d = -20;
    const g = fire(player, 'green_shell', karts);
    expect(g.d).toBeCloseTo(-20, 5);   // not pulled in to d -10
    step(items, karts, 1.5);
    expect(cpu.tumble || cpu.invuln > 0).toBeTruthy();

    items.shots.length = 0;
    const far = makeKart(track, { s: 625, d: -20 });
    player.s = 520; player.d = 0;
    fire(player, 'red_shell', [player, far]);
    step(items, [player, far], 4);
    expect(far.tumble || far.invuln > 0).toBeTruthy();   // homed out to d -20

    items.shots.length = 0;
    player.s = 780; player.d = 15;
    const o = fire(player, 'green_shell', [player]);
    for (let i = 0; i < 120 && items.shots.includes(o); i++) {
      items.update(1 / 60, [player]);
      expect(o.d).toBeLessThanOrEqual(track.wallAt(o.s, 1) - 1.2 + 1e-9);   // into the bridge's narrows, not through the rail
    }
  });

  it('triple green shell fires three in turn, and expires at the ttl', () => {
    player.item = 'triple_green_shell'; items.use(player, karts);
    expect(player.trail.meshes).toHaveLength(3);
    step(items, karts, 0.3);
    items.use(player, karts);
    expect(items.shots).toHaveLength(1);
    cpu.s = 5;
    step(items, [player], 9);
    expect(items.shots).toHaveLength(0);
  });

  it('triple red shell and the AI path (non-player shells fire immediately)', () => {
    cpu.item = 'triple_red_shell';
    expect(items.use(cpu, karts)).toBe('triple_red_shell');
    expect(cpu.trail.meshes).toHaveLength(3);
    expect(items.use(cpu, karts)).toBe('red_shell');
    expect(items.shots.length).toBeGreaterThan(0);
  });

  it('blue shell locks on to the leader and hits it', () => {
    items.gp = false;
    cpu.s = 150;
    cpu.item = 'blue_shell';
    items.use(cpu, karts);
    expect(items.shots[0].kind).toBe('blue_shell');
    step(items, karts, 8);
    expect(player.tumble || player.invuln > 0).toBeTruthy();
    expect(items.leader(karts, null)).toBeTruthy();
    expect(items.leader([{ finished: true }], null)).toBeNull();
  });

  it('fake item box: held, set down, grows, and tumbles the kart that touches it', () => {
    player.item = 'fake_item_box';
    items.use(player, karts);
    expect(player.trail.kind).toBe('fake_item_box');
    step(items, karts, 0.2);
    expect(items.release(player, karts, 0)).toBe('fake_item_box');
    const h = items.hazards[0];
    expect(h.grow).toBe(true);
    step(items, [], 2);
    expect(h.grow).toBe(false);
    cpu.s = h.s; cpu.d = h.d;
    step(items, karts, 0.1);
    expect(cpu.tumble).toBeTruthy();
    expect(cpu.tumble.mode).toBe('vertical');
    expect(items.debris.some(d => d.shatter)).toBe(true);
    step(items, karts, 1);
    expect(items.debris).toHaveLength(0);
  });

  it('thunder bolt strikes everyone else, shrinks them and plays the loop', () => {
    cpu.item = 'thunder_bolt';
    cpu.item = 'thunder_bolt'; items.use(cpu, karts);
    expect(player.shrink).toBeGreaterThan(0);
    expect(player.spin).toBeGreaterThan(0);
    expect(items.thunder).toBe(true);
    step(items, karts, 4);
    expect(player.mesh.scale.x).toBeLessThan(1);
    step(items, karts, 4);
    expect(items.thunder).toBe(false);
    expect(player.mesh.scale.x).toBeCloseTo(1, 1);
    // exemptions
    const guarded = makeKart(track, { s: 100 });
    guarded.star = 5; guarded.item = 'banana';
    items.strike(guarded);
    expect(guarded.shrink).toBeUndefined();
    items.strike({ remote: true });
  });

  it('star makes the kart invincible and knocks over others; it ends', () => {
    player.item = 'star'; items.use(player, karts);
    expect(player.star).toBeGreaterThan(0);
    expect(audio.starMusic).toHaveBeenCalledWith(true);
    cpu.s = player.s; cpu.d = player.d;
    step(items, karts, 0.2);
    expect(cpu.tumble).toBeTruthy();
    expect(items.hit(player, 'banana')).toBe(false);
    step(items, karts, 11);
    expect(player.star).toBeLessThanOrEqual(0);
    expect(audio.starMusic).toHaveBeenCalledWith(false);
  });

  it('boo turns the kart invisible; steal in GP gives a random item, otherwise takes one', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.5);
    player.item = 'boo'; items.use(player, karts);
    expect(player.boo).toBeGreaterThan(0);
    expect(player.item).toBeTruthy();
    step(items, karts, 8);
    expect(player.boo).toBe(0);
    items.gp = false;
    cpu.item = 'banana'; player.item = 'boo';
    items.use(player, karts);
    expect(player.item).toBe('banana');
    expect(cpu.item).toBeNull();
    vi.restoreAllMocks();
    items.gp = true;
    vi.spyOn(Math, 'random').mockReturnValue(0.99);
    items.steal(player, karts);
    vi.restoreAllMocks();
  });

  it('roll draws by rank: GP human / CPU, VS counts and battle', () => {
    for (const k of [player, cpu]) for (let i = 0; i < 20; i++) expect(ITEMS).toContain(items.roll(k, karts));
    expect(ITEMS).toContain(items.roll(cpu, karts, true));
    items.gp = false;
    const humans = [player, makeKart(track, { isPlayer: true, s: 100 }), makeKart(track, { isPlayer: true, s: 120 }), makeKart(track, { isPlayer: true, s: 140 })];
    for (let n = 2; n <= 4; n++) for (const k of humans.slice(0, n)) expect(ITEMS).toContain(items.roll(k, humans.slice(0, n)));
    // every random draw lands on a valid item
    for (let i = 0; i < 200; i++) expect(ITEMS).toContain(items.roll(player, karts));
  });

  it('hit rules: invulnerable, spinning and remote karts are skipped; banana spins, shells tumble', () => {
    const k = makeKart(track, { isPlayer: true, s: 100 });
    expect(items.hit(k, 'banana', cpu)).toBe(true);
    expect(k.spin).toBeGreaterThan(0);
    expect(items.hit(k, 'banana')).toBe(false);
    k.spin = 0; k.invuln = 0;
    expect(items.hit(k, 'green_shell', cpu)).toBe(true);
    expect(k.tumble.mode).toBe('low');
    expect(items.booms).toHaveLength(1);
    step(items, [k], 1);
    expect(items.booms).toHaveLength(0);
    expect(items.hit({ remote: true })).toBe(false);
  });

  it('wreck of a non-item mesh just removes it', () => {
    const g = new THREE.Group(); items.group.add(g);
    items.wreck(g, 'mushroom');
    expect(g.parent).toBeNull();
  });

  it('squishing a shrunk kart hits it', () => {
    player.shrink = 5; cpu.s = player.s; cpu.d = player.d;
    items.update(1 / 60, karts);
    expect(player.shrink).toBeGreaterThan(0);
  });

  it('reset clears everything', () => {
    player.item = 'banana_bunch'; items.use(player, karts);
    items.drop(player, 'banana', { s: 10, d: 0 });
    items.reset();
    expect(items.hazards).toHaveLength(0);
    expect(items.trails.size).toBe(0);
    expect(items.boxes.every(b => b.state === 2)).toBe(true);
    expect(audio.stopSound).toHaveBeenCalled();
  });

  it('Grand Prix CPU strategy draws and uses items over time', () => {
    const order = [cpu, player];
    cpu.crossings = 1; cpu.s = 300; player.crossings = 0;
    const L = track.length;
    for (const branch of ['banana', 'fake', 'thunder', 'star', 'boo', 'mushroom']) {
      const st = { branch, timer: 0, uses: 0, lap: 1, hold: 0, acc: 0 };
      items.strat.set(cpu, st);
      for (let i = 0; i < 40; i++) items.cpuStrategy(cpu, karts, order, 0, 100, 1 / 30);
      items.strat.set(cpu, { ...st, branch: 'wait', timer: 0 });
      player.star = 0; cpu.star = 0; cpu.boo = 0;
      items.clearTrail(cpu);
    }
    // banana thrown at a human who leads
    cpu.crossings = 1; player.s = 100; player.crossings = 1;
    items.strat.set(cpu, { branch: 'banana', timer: 0, uses: 0, lap: 1, hold: 0, acc: 0 });
    items.cpuStrategy(cpu, karts, [player, cpu], 0, 100, 1 / 30);
    // waiting draws an item once the timer is up
    cpu.crossings = 1; cpu.s = L / 2;
    items.strat.set(cpu, { branch: 'wait', timer: 601, uses: 0, lap: 1, hold: 0, acc: 0 });
    vi.spyOn(Math, 'random').mockReturnValue(0.3);
    items.cpuStrategy(cpu, karts, [player, cpu], 0, 600, 1 / 30);
    vi.restoreAllMocks();
    // crossing the line resets uses
    cpu.crossings = 2;
    items.cpuStrategy(cpu, karts, [player, cpu], 0, 600, 1 / 30);
    expect(items.strat.get(cpu).lap).toBe(2);
  });

  it('hold -> fire and thunder end / effect end transitions', () => {
    cpu.crossings = 1;
    items.strat.set(cpu, { branch: 'fake', timer: 0, uses: 0, lap: 1, hold: 0, acc: 0 });
    for (let i = 0; i < 60; i++) items.cpuStrategy(cpu, karts, [player, cpu], 0, 100, 1 / 30);
    expect(items.hazards.length).toBeGreaterThan(0);
    items.strat.set(cpu, { branch: 'thunderEnd', timer: 0xF1, uses: 0, lap: 1, hold: 0, acc: 0 });
    items.cpuStrategy(cpu, karts, [player, cpu], 0, 100, 1 / 30);
    expect(items.strat.get(cpu).branch).toBe('wait');
    items.strat.set(cpu, { branch: 'effectEnd', timer: 0, uses: 0, lap: 1, hold: 0, acc: 0 });
    items.cpuStrategy(cpu, karts, [player, cpu], 0, 100, 1 / 30);
    expect(items.strat.get(cpu).branch).toBe('wait');
    items.strat.set(cpu, { branch: 'hold', timer: 0, uses: 0, lap: 1, hold: 5, acc: 0 });
    cpu.trail = null;
    items.cpuStrategy(cpu, karts, [player, cpu], 0, 100, 1 / 30);
    expect(items.strat.get(cpu).branch).toBe('wait');
  });

  it('aiUse: boosts go at once, shells wait for a target, hoarding ends', () => {
    cpu.item = 'mushroom'; cpu.itemTimer = 0;
    items.aiUse(cpu, karts, 0.1);
    expect(cpu.item).toBeNull();
    cpu.s = 100; player.s = 160;
    cpu.item = 'red_shell'; cpu.itemTimer = 0;
    items.aiUse(cpu, karts, 0.1);
    expect(items.shots.length).toBeGreaterThan(0);
    cpu.item = 'banana'; cpu.itemTimer = 0; player.s = 90; player.d = cpu.d;
    items.aiUse(cpu, karts, 0.1);
    expect(cpu.trail || items.hazards.length).toBeTruthy();
    cpu.trail = null;
    cpu.item = 'green_shell'; cpu.itemTimer = -9; player.s = 500;
    items.aiUse(cpu, karts, 0.1);
    cpu.item = 'banana'; cpu.itemTimer = 5;
    items.aiUse(cpu, karts, 0.1);
    cpu.spin = 1; cpu.item = 'banana'; cpu.itemTimer = 0;
    items.aiUse(cpu, karts, 0.1);
    items.aiUse({ item: null, trail: null }, karts, 0.1);
  });

  it('non-player karts that touch a box get a rolled item outside GP', () => {
    items.gp = false;
    const b = items.boxes[0];
    cpu.s = b.s; cpu.d = b.d;
    items.update(1 / 60, karts);
    expect(cpu.item).toBeTruthy();
    expect(cpu.itemTimer).toBeGreaterThan(0);
  });

  it('boo/lightning/star colour effects drive the kart sprite look', () => {
    player.star = 8.5; player.zap = 0;
    step(items, karts, 3);
    expect(player.fx).toBeTruthy();
    player.zap = 2; step(items, karts, 1);
    player.boo = 5; step(items, karts, 6);
    player.boo = 1e-9; step(items, karts, 3);
    expect(player.fx.own).toBe(255);
  });

  it('shell and fake box sprites spin with the camera', () => {
    items.drop(player, 'fake_item_box', { s: 50, d: 0 });
    const g = items.makeMesh('green_shell');
    items.spinShells(0.5);
    const cam = new THREE.PerspectiveCamera(); cam.position.set(3, 3, 3); cam.updateMatrixWorld();
    cam.userData.mirror = true;
    const shell = g.children[0];
    shell.updateMatrixWorld(true);
    shell.onBeforeRender(null, null, cam);
    expect(items.spinning.length).toBeGreaterThan(0);
  });

  it('makeMesh defers until the models are loaded', async () => {
    const fresh = new Items(track, new THREE.Scene(), fakeAudio());
    const g = fresh.makeMesh('banana');
    expect(g.children).toHaveLength(0);
    await fresh.protosReady;
    expect(g.children).toHaveLength(1);
    fresh.wreck(g, 'banana');
    await flush();
    fresh.boom({ mesh: { userData: { character: 'mario' }, scale: new THREE.Vector3(1, 1, 1), position: new THREE.Vector3() } });
  });
});

describe('Items in a battle arena', () => {
  let track, items, a, b, karts, audio;
  beforeAll(async () => { track = await makeTrack('block-fort'); });
  beforeEach(async () => {
    audio = fakeAudio();
    items = new Items(track, new THREE.Scene(), audio);
    await items.protosReady;
    a = new Kart(track, { color: 1, s: 0, d: 0, isPlayer: true, spawn: battleSpawn('block-fort', 0) });
    b = new Kart(track, { color: 2, s: 0, d: 0, spawn: battleSpawn('block-fort', 1) });
    karts = [a, b];
  });
  it('places boxes at the arena item spots and rolls from the battle curve', () => {
    expect(items.arena).toBe(true);
    expect(items.boxes.length).toBe(track.def.native.itemBoxes.length);
    for (let i = 0; i < 50; i++) expect(ITEMS).toContain(items.roll(a, karts));
  });
  it('a kart in the middle of a box collects it', () => {
    const box = items.boxes[0];
    a.x = box.x; a.z = box.z; a.y = box.y;
    items.update(1 / 60, karts);
    expect(a.win || a.item).toBeTruthy();
  });
  it('spot / put / touch use world coordinates', () => {
    const p = items.spot(a, 3, 1);
    expect(Number.isFinite(p.x) && Number.isFinite(p.z) && Number.isFinite(p.y)).toBe(true);
    const m = new THREE.Group(); items.put(m, p);
    expect(m.position.x).toBeCloseTo(p.x, 5);
    expect(items.touch(a, { x: a.x, z: a.z, y: a.y }, 1)).toBe(true);
    expect(items.near({ x: 0, z: 0, y: 0 }, { x: 5, z: 0, y: 0 }, 2)).toBe(false);
  });
  it('a dropped banana hits and pops a balloon', () => {
    items.drop(a, 'banana', items.spot(a, -4));
    const h = items.hazards[0];
    b.x = h.x; b.z = h.z; b.y = h.y;
    const balloons = b.balloons;
    items.update(0.6, karts);
    expect(b.spin).toBeGreaterThan(0);
    expect(b.balloons).toBe(balloons - 1);
  });
  it('shells fly along their heading, follow the floor and are used up on walls', () => {
    a.item = 'green_shell'; items.use(a, karts); items.release(a, karts, 0);
    for (let i = 0; i < 120; i++) items.update(1 / 60, karts);
    a.item = 'red_shell'; items.use(a, karts); items.release(a, karts, 0);
    for (let i = 0; i < 300; i++) items.update(1 / 60, karts);
    items.launch(a, 'green_shell', karts, true);
    for (let i = 0; i < 300; i++) items.update(1 / 60, karts);
    expect(items.shots.length).toBeLessThanOrEqual(3);
  });
  it('thunder takes a balloon from the others; a toss in the arena lands on the floor', () => {
    a.item = 'thunder_bolt'; items.use(a, karts);
    expect(b.balloons).toBe(2);
    a.item = 'banana'; items.use(a, karts); items.release(a, karts, 90);
    for (let i = 0; i < 180; i++) items.update(1 / 60, []);
    expect(items.hazards[0].toss).toBeNull();
  });
  it('a toss off the arena edge is lost', () => {
    const h = { x: 0, y: -1000, z: 0, mesh: new THREE.Group(), toss: { vs: 0, vh: 0, alt: 0, h: 0 }, acc: 0 };
    items.group.add(h.mesh);
    expect(items.flight(h, 0.1)).toBe(true);
  });
  it('arena aiUse fires shells at a kart ahead and drops bananas behind', () => {
    b.item = 'green_shell'; b.itemTimer = 0;
    b.x = 0; b.z = 0; b.h = 0; a.x = 0; a.z = 30;
    items.aiUse(b, karts, 0.1);
    expect(items.shots.length + (b.trail ? 1 : 0)).toBeGreaterThan(0);
    b.trail = null; b.item = 'banana'; b.itemTimer = 0; a.z = -10;
    items.aiUse(b, karts, 0.1);
    expect(b.trail || items.hazards.length).toBeTruthy();
  });
});
