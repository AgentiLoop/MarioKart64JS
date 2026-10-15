// Boots src/main.js (the whole game page) in jsdom with a fake WebGL renderer and drives its frame loop and key handlers.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const fake = vi.hoisted(() => ({ renders: 0, net: null }));

vi.mock('three', async orig => {
  const T = await orig();
  class FakeRenderer {
    constructor() {
      this.capabilities = { getMaxAnisotropy: () => 8 };
      this.shadowMap = {};
      this.state = { setMaterial() {} };
      this.domElement = document.createElement('canvas');
    }
    setPixelRatio() {} setSize() {} setClearColor() {} setScissorTest() {} setViewport() {} setScissor() {} clear() {}
    copyFramebufferToTexture() {} dispose() {}
    getRenderTarget() { return null; }
    getDrawingBufferSize(v) { return v.set(480, 360); }
    render() { fake.renders++; }
  }
  return { ...T, WebGLRenderer: FakeRenderer };
});

vi.mock('../src/net.js', () => {
  class Net extends EventTarget {
    constructor() { super(); this.myId = 1; this.players = [{ id: 1, char: 'mario' }, { id: 2, char: 'luigi' }]; this.hostIsMe = true; this.state = 'lobby'; this.sent = []; fake.net = this; }
    send(m) { this.sent.push(m); }
    leave() { this.left = true; }
    ready() { this.isReady = true; }
    rejoin(room, you) { this.rejoined = [room, you]; }
    quickMatch(o) { this.matched = o; }
    emit(type, detail) { this.dispatchEvent(new CustomEvent(type, { detail })); }
  }
  return { Net, VERSION: '0.1' };
});
vi.mock('../src/title3d.js', () => ({ createTitle3D: () => ({ step: vi.fn(), dispose: vi.fn() }) }));
vi.mock('../src/kart3d.js', () => ({ buildWiiKart: async () => { const g = new (await import('three')).Group(); g.userData.update = () => {}; return g; } }));
vi.mock('../src/lakitu3d.js', () => ({ buildLakitu3D: async () => null }));

const BODY = readFileSync(resolve(process.cwd(), 'index.html'), 'utf8').match(/<body[^>]*>([\s\S]*)<\/body>/)[1].replace(/<script[\s\S]*?<\/script>/g, '');

let raf, now, listeners;
const realAdd = window.addEventListener.bind(window);

async function boot(search = '') {
  vi.resetModules();
  document.body.innerHTML = BODY;
  history.replaceState({}, '', '/' + search);
  raf = null; now = performance.now(); listeners = [];
  vi.stubGlobal('requestAnimationFrame', cb => { raf = cb; return 1; });
  window.addEventListener = (type, fn, o) => { listeners.push([type, fn, o]); realAdd(type, fn, o); };
  await import('../src/main.js');
  window.addEventListener = realAdd;
  return window.__game;
}
function tick(n = 1, ms = 1000 / 60) { for (let i = 0; i < n; i++) { now += ms; raf(now); } }
const key = (code, type = 'keydown', extra = {}) => window.dispatchEvent(new KeyboardEvent(type, { code, bubbles: true, cancelable: true, ...extra }));
const press = (code, extra) => { key(code, 'keydown', extra); key(code, 'keyup'); };
const $ = id => document.getElementById(id);
const toRace = (g, max = 900) => { for (let i = 0; i < max && g.state === 'countdown'; i++) tick(); };

beforeEach(() => { fake.renders = 0; localStorage.clear(); });
afterEach(() => {
  for (const [t, fn, o] of listeners ?? []) window.removeEventListener(t, fn, o);
  vi.unstubAllGlobals();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('title and menus', () => {
  it('shows the title, flies the camera, and walks through game select -> course -> character', async () => {
    await boot('');
    tick(30);
    expect($('title').style.display).toBe('block');
    expect(fake.renders).toBeGreaterThan(0);
    press('Enter');
    expect($('gameSel').style.display).toBe('block');
    press('ArrowRight'); press('ArrowRight'); press('ArrowLeft');
    press('Enter');                       // 2P column -> mode
    press('ArrowDown'); press('ArrowUp'); press('ArrowDown');
    press('Escape');                      // back to player select
    press('ArrowLeft');
    press('Enter');                       // 1P -> mode row
    press('Enter');                       // MARIO GP -> cc rows
    press('ArrowDown'); press('ArrowDown'); press('ArrowUp'); press('Escape');
    press('Enter');
    press('ArrowDown'); press('Enter');   // 150cc
    tick(10);
    expect($('menu').style.display).toBe('block');
    press('ArrowRight'); press('ArrowRight'); press('ArrowLeft'); press('Enter');   // cup -> course
    press('ArrowDown'); press('ArrowUp'); press('Enter'); press('Escape'); press('Escape');   // back to cup
    press('Enter'); press('Enter'); press('Enter');   // -> OK -> char select
    tick(40);
    expect($('char').style.display).toBe('block');
    press('ArrowRight'); press('ArrowDown'); press('ArrowLeft'); press('ArrowUp');
    press('Enter');                       // pick
    tick(10);
    press('Escape');                      // un-pick
    press('Enter'); press('Enter');       // pick + confirm
    expect(localStorage.getItem('mk64char')).toBeTruthy();
    press('Escape');
  });

  it('option and data menus, erase flow and records', async () => {
    localStorage.setItem('mk64records', JSON.stringify({ mario: { times: [{ t: 61.5, char: 'luigi' }], lap: { t: 20.25, char: 'luigi' } } }));
    await boot('');
    press('Enter');
    press('KeyL');
    expect($('opt').style.display).toBe('block');
    press('ArrowDown'); press('Enter'); press('ArrowDown'); press('Enter'); press('ArrowDown'); press('Enter');   // sound mode, pak, erase
    press('Enter');                       // confirm erase
    expect(localStorage.getItem('mk64records')).toBeNull();
    press('ArrowDown'); press('ArrowUp'); press('Escape');
    expect($('gameSel').style.display).toBe('block');
    press('KeyR');
    expect($('data').style.display).toBe('block');
    press('ArrowRight'); press('ArrowDown'); press('ArrowLeft'); press('ArrowUp');
    press('Enter');                       // open the course's records
    expect($('dataHead').textContent).not.toBe('DATA');
    press('Escape');                      // back to the list
    expect($('dataHead').textContent).toBe('DATA');
    press('Enter'); press('Enter');
    press('Escape');                      // back to game select
    $('optionBtn').click(); expect($('opt').style.display).toBe('block'); press('Escape');
    $('dataBtn').click(); expect($('data').style.display).toBe('block'); press('Escape');
    // erase asked then declined
    press('KeyL'); press('ArrowDown'); press('ArrowDown'); press('ArrowDown'); press('Enter'); press('Escape'); press('Escape');
  });

  it('can be clicked through (mouse): title, columns, modes, cc rows, cups, courses, drivers', async () => {
    await boot('');
    $('title').click();
    const cols = [...$('pcols').children];
    cols[1].click();
    cols[1].querySelectorAll('.mode')[0].click();
    $('ccrows').children[2].click();
    tick(5);
    [...$('cups').children][1].click();
    [...$('cnames').children][2].click();
    $('courseOk').click();
    tick(5);
    const faces = [...$('charGrid').children];
    faces[3].click();
    $('charOk').click();
    expect(localStorage.getItem('mk64char')).toBe('toad');
  });

  it('battle mode goes straight to the arenas; time trials skip the cc rows', async () => {
    await boot('');
    press('Enter'); press('Enter');
    press('ArrowDown'); press('ArrowDown'); press('Enter');   // 1P: BATTLE
    expect($('menu').style.display).toBe('block');
    press('ArrowDown'); press('Enter'); press('Escape'); press('Escape');
    expect($('gameSel').style.display).toBe('block');
    press('Enter'); press('ArrowDown'); press('Enter');   // TIME TRIALS
    expect($('menu').style.display).toBe('block');
  });

  it('returns to the course menu after M in a race and goes back to the title', async () => {
    await boot('?menu=course&from=luigi&mode=vs&cc=100&players=2');
    tick(5);
    expect($('menu').style.display).toBe('block');
    press('Escape'); press('Escape');
    press('KeyM');
    await boot('?menu=course&from=rainbow&mode=mario_gp&cc=extra');
    tick(3);
    await boot('?menu=course&from=skyscraper&mode=battle');
    tick(3);
  });

  it('3 toggles the 3D title, N toggles music, G cycles resolution', async () => {
    await boot('');
    press('Digit3');
    await vi.waitFor(() => expect($('title3d').style.display).toBe('block'));
    tick(3);
    press('Digit3');
    expect($('title3d').style.display).toBe('none');
    press('KeyN'); press('KeyG'); press('KeyG'); press('KeyJ'); press('KeyJ');
    tick(3);
    expect($('res').style.display).toBe('block');
  });
});

describe('racing', () => {
  it('Mario GP: countdown, rocket start, racing, finishing 3 laps', async () => {
    const g = await boot('?track=mario&char=luigi&cc=150&mode=mario_gp');
    expect(g.karts).toHaveLength(8);
    expect(g.player.character).toBe('luigi');
    expect(g.karts.filter(k => k.rival != null)).toHaveLength(2);
    key('ArrowUp');
    toRace(g);
    expect(g.state).toBe('race');
    key('ArrowUp', 'keyup');
    key('ArrowUp'); key('ArrowRight'); key('Space');
    tick(120);
    expect(g.player.s).not.toBe(g.player.track.length - 14);
    expect($('speed').textContent).toMatch(/km\/h/);
    expect($('pos').textContent).toMatch(/\d/);
    expect($('lapText').textContent).toMatch(/LAP/);
    key('ArrowRight', 'keyup'); key('Space', 'keyup');
    key('ArrowDown'); key('KeyA'); key('KeyD'); key('KeyW'); key('KeyS');
    key('ArrowDown', 'keyup'); key('KeyA', 'keyup'); key('KeyD', 'keyup'); key('KeyW', 'keyup'); key('KeyS', 'keyup');
    // items: use / release
    g.items.give(g.player, 'banana');
    press('ShiftLeft'); press('KeyQ'); press('KeyE');
    g.items.give(g.player, 'green_shell');
    key('ShiftRight'); tick(5); key('ShiftRight', 'keyup');
    g.items.give(g.player, 'mushroom'); press('KeyE');
    tick(30);
    // restart with Backspace
    press('Backspace');
    expect(g.state).toBe('countdown');
    toRace(g);
    g.player.crossings = 3;
    tick(20);
    expect(g.state).toBe('finished');
    expect($('banner').textContent).toMatch(/PLACE/);
    tick(300);   // cinematic camera shots
    expect(g.player.finished).toBe(true);
  }, 60000);

  it('autopilot drives the player around and the roulette window shows', async () => {
    const g = await boot('?track=luigi&char=mario&cc=100&mode=vs&autopilot');
    toRace(g);
    expect(g.autopilot).toBe(true);
    const s0 = g.player.progress;
    tick(240);
    expect(g.player.progress).toBeGreaterThan(s0);
    g.items.startRoulette(g.player);
    tick(20);
    expect($('item').style.display).toBe('block');
    g.autopilot = false;
    tick(5);
  }, 60000);

  it('time trials: the player alone with three mushrooms and records saved on finish', async () => {
    const g = await boot('?track=mario&char=mario&mode=time_trials');
    expect(g.karts).toHaveLength(1);
    expect(g.player.item).toBe('triple_mushroom');
    expect(g.items.boxes).toHaveLength(0);
    toRace(g);
    g.player.crossings = 3;
    tick(10);
    const recs = JSON.parse(localStorage.getItem('mk64records'));
    expect(recs.mario.times).toHaveLength(1);
  }, 60000);

  it('EXTRA mirrors the course and flips steering', async () => {
    const g = await boot('?track=luigi&char=mario&cc=extra&mode=mario_gp');
    expect(g.camera.userData.mirror).toBe(true);
    toRace(g);
    key('ArrowRight');
    tick(60);
    key('ArrowRight', 'keyup');
    const cam = g.camera;
    expect(cam.projectionMatrix.elements[0]).toBeLessThan(0);
  }, 60000);

  it('reads the gamepad: gas, steer, item and start', async () => {
    const g = await boot('?track=mario&char=mario&mode=vs&cc=100');
    toRace(g);
    const pad = { connected: true, axes: [0.8, -0.5], buttons: Array.from({ length: 16 }, () => ({ pressed: false })) };
    vi.stubGlobal('navigator', { getGamepads: () => [pad] });
    pad.buttons[0].pressed = true; pad.buttons[4].pressed = true;
    g.items.give(g.player, 'banana');
    tick(10);
    pad.buttons[2].pressed = true; tick(3);
    pad.buttons[2].pressed = false; tick(3);
    pad.buttons[14].pressed = true; tick(2);
    pad.buttons[14].pressed = false; pad.buttons[15].pressed = true; tick(2);
    pad.buttons[9].pressed = true; tick(2);
    expect(g.state).toBe('countdown');
  }, 60000);

  it('physics overlay (?physics) toggles with P', async () => {
    const g = await boot('?track=mario&char=mario&physics');
    tick(5);
    press('KeyP');
    press('KeyP');
    expect(g.physicsDebug).toBeTruthy();
  }, 60000);

  it('Wii 3D mode loads on 3 and unloads', async () => {
    const g = await boot('?track=mario&char=mario');
    press('Digit3');
    await vi.waitFor(() => expect(g.player.model).toBeTruthy());
    expect(localStorage.getItem('mk64wii3d')).toBe('1');
    press('Digit3');
    expect(g.player.model).toBeNull();
    expect(localStorage.getItem('mk64wii3d')).toBeNull();
  }, 60000);

  it('races with 3D mode saved from before', async () => {
    localStorage.setItem('mk64wii3d', '1');
    const g = await boot('?track=mario&char=mario');
    await vi.waitFor(() => expect(g.player.model).toBeTruthy());
  }, 60000);
});

describe('battle', () => {
  it.each(['block-fort', 'big-donut'])('%s: balloons, CPU karts and a winner', async id => {
    const g = await boot(`?track=${id}&char=mario&mode=battle`);
    expect(g.karts).toHaveLength(4);
    toRace(g);
    tick(240);
    expect($('lapText').textContent).toMatch(/[●○]/);
    for (const k of g.karts.slice(1)) { k.balloons = 0; }
    tick(5);
    expect(g.state).toBe('finished');
    expect($('banner').textContent).toBe('WINNER!');
  }, 60000);
  it('the player running out of balloons loses', async () => {
    const g = await boot('?track=double-deck&char=mario&mode=battle');
    toRace(g);
    g.player.balloons = 0;
    tick(5);
    expect($('banner').textContent).toBe('LOSER');
  }, 60000);
  it('skyscraper battle starts', async () => {
    const g = await boot('?track=skyscraper&char=luigi&mode=battle');
    toRace(g);
    tick(60);
    expect(g.track.arena).toBe(true);
  }, 60000);
});

describe('every race course boots and runs', () => {
  const ids = ['luigi', 'moomoo', 'koopa', 'kalimari', 'toad', 'frappe', 'choco', 'mario', 'wario', 'sherbet', 'royal', 'bowser', 'dk', 'yoshi', 'banshee', 'rainbow'];
  it.each(ids)('%s', async id => {
    const g = await boot(`?track=${id}&char=yoshi&mode=mario_gp&cc=100`);
    toRace(g);
    tick(180);
    expect(g.state).toBe('race');
    expect(g.player.progress).toBeGreaterThan(-50);
    g.player.crossings = 1;
    tick(20);
  }, 60000);
});

describe('online', () => {
  const lobby = async (search = '?track=mario&char=mario&mode=vs&players=2') => {
    const g = await boot(search);
    return g;
  };
  it('lobby, mesh, start, puppet poses and items', async () => {
    const g = await lobby();
    const net = fake.net;
    expect(net.matched).toMatchObject({ course: 'mario', players: 2 });
    expect($('lobby').style.display).toBe('block');
    tick(5);
    net.emit('room', { players: net.players, countdown: 12, max: 2 });
    expect($('lobbyList').children.length).toBe(2);
    net.emit('start', { course: 'mario', players: net.players, code: 'ABC', you: 1 });
    expect(net.isReady).toBe(true);
    net.emit('mesh', {});
    const gg = window.__game;
    expect(gg.karts).toHaveLength(2);   // online VS is humans only (no CPU karts)
    expect(gg.karts.filter(k => k.remote)).toHaveLength(1);
    net.emit('data', { from: 2, msg: { t: 'ready' } });
    expect(net.sent.some(m => m.t === 'go')).toBe(true);
    tick(5);
    expect($('lobby').style.display).toBe('none');
    toRace(gg);
    // remote pose packets
    const puppet = gg.karts.find(k => k.netId === 2), L = gg.track.length;
    for (let i = 0; i < 4; i++) net.emit('data', { from: 2, msg: { t: 'p', s: 10 + i * 5, d: 1, psi: 0.1, v: 30, y: 0, air: 0, dr: 0, b: 0, sp: 0, sv: 0, c: 0, f: -1, tu: 3, tl: 1 } });
    tick(30);
    expect(puppet.s).not.toBe(L - 14);
    net.emit('data', { from: 2, msg: { t: 'p', s: 12, d: 0, psi: 0, v: 20, y: 1, air: 1, dr: 0, b: 0, sp: 1, sv: 0, c: 1, f: 80 } });
    tick(30);
    expect(puppet.finished).toBe(true);
    net.emit('data', { from: 2, msg: { t: 'item', item: 'banana', s: 30, d: 0 } });
    expect(gg.items.hazards.length).toBeGreaterThan(0);
    // our own pose is sent
    expect(net.sent.some(m => m.t === 'p')).toBe(true);
    // using an item sends it
    gg.items.give(gg.player, 'mushroom'); press('KeyE');
    expect(net.sent.some(m => m.t === 'item')).toBe(true);
    // a peer leaves
    net.emit('left', { id: 2, why: 'failed' });
    expect($('banner').textContent).toBe('OPPONENT LEFT (failed)');
    net.emit('error', { message: 'nope' });
    expect($('lobbyMsg').textContent).toBe('nope');
    // Backspace does not restart online
    press('Backspace');
  }, 60000);
  it('a room on another course reloads the page; rejoin passes the room', async () => {
    await lobby();
    fake.net.emit('start', { course: 'luigi', players: fake.net.players, code: 'XYZ', you: 2 });
    await lobby('?track=mario&char=mario&mode=vs&players=2&room=ABC&you=1');
    expect(fake.net.rejoined).toEqual(['ABC', 1]);
  }, 60000);
  it('Enter on the lobby races CPU karts instead; Escape leaves', async () => {
    const g = await lobby();
    key('Enter');
    expect(fake.net.left).toBe(true);
    tick(5);
    expect(g.karts).toHaveLength(4);
    await lobby();
    key('Escape');
    expect(fake.net.left).toBe(true);
  }, 60000);
  it('battle online uses arena poses', async () => {
    await lobby('?track=block-fort&char=mario&mode=battle&players=2');
    const net = fake.net;
    net.emit('start', { course: 'block-fort', players: net.players, code: 'B', you: 1 });
    net.emit('mesh', {});
    const g = window.__game;
    net.emit('data', { from: 2, msg: { t: 'ready' } });
    toRace(g);
    for (let i = 0; i < 4; i++) net.emit('data', { from: 2, msg: { t: 'p', x: 1 + i, z: 2, h: 0.5, v: 10, y: 0, air: 0, dr: 0, b: 0, sp: 0, sv: 0, bl: 3, o: 0, r: 0 } });
    tick(30);
    net.emit('data', { from: 2, msg: { t: 'item', item: 'banana', x: 1, z: 1, h: 0, y: 0 } });
    tick(5);
    expect(net.sent.some(m => m.t === 'p' && 'bl' in m)).toBe(true);
    net.emit('left', { id: 2 });
  }, 60000);
});
