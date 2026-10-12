import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { TRACKS, NATIVE_SCALE, NATIVE_SKY, nativeSkyColors, nativeClouds, cloudScreenX, battleSpawn, BATTLE_SPAWNS,
  STAR_TWINKLE, NATIVE_CLOUDS, loadNativeCourse, Track } from '../src/track.js';
import { makeTrack, loadDef } from './helpers.js';

describe('track tables', () => {
  it('lists 16 race courses followed by 4 battle arenas', () => {
    expect(TRACKS).toHaveLength(20);
    expect(TRACKS.slice(16).every(t => t.battle)).toBe(true);
    expect(new Set(TRACKS.map(t => t.id)).size).toBe(20);
  });
  it('every race course has sky colours', () => {
    for (const t of TRACKS.slice(0, 16)) expect(NATIVE_SKY[t.id], t.id).toBeTruthy();
  });
  it('nativeSkyColors masks to u8 and returns null for unknown courses', () => {
    const c = nativeSkyColors('mario');
    expect(c.top).toEqual([128, 4280 & 255, 6136 & 255]);
    expect(c.bottom.every(v => v >= 0 && v <= 255)).toBe(true);
    expect(nativeSkyColors('nope')).toBeNull();
  });
  it('nativeClouds builds screen objects, stars for toad, null for courses without', () => {
    const luigi = nativeClouds('luigi');
    expect(luigi.stars).toBe(false);
    expect(luigi.texture).toBe('clouds-2');
    expect(luigi.objects.length).toBe(13);
    expect(luigi.objects[0].posY).toBe(-10);   // 0xfff6 as s16
    expect(nativeClouds('toad').stars).toBe(true);
    expect(nativeClouds('toad').texture).toBe('star');
    expect(nativeClouds('bowser')).toBeNull();
    for (const id of Object.keys(NATIVE_CLOUDS)) expect(nativeClouds(id).objects.length).toBeGreaterThan(0);
    expect(STAR_TWINKLE).toHaveLength(5);
  });
  it('cloudScreenX centres at 160 and wraps s16', () => {
    expect(cloudScreenX(0, 0)).toBe(160);
    expect(cloudScreenX(0, 0x4000)).toBeGreaterThan(160);
    expect(cloudScreenX(0, 0xC000)).toBeLessThan(160);
    expect(cloudScreenX(0x8000, 0x8000)).toBe(160);
  });
  it('battleSpawn maps MK64 units to scene units', () => {
    const s = battleSpawn('block-fort', 0);
    expect(s).toEqual({ x: 0, y: 5 * NATIVE_SCALE, z: 200 * NATIVE_SCALE, h: -Math.PI });
    expect(battleSpawn('block-fort', 5)).toEqual(battleSpawn('block-fort', 1));
    expect(Object.keys(BATTLE_SPAWNS)).toHaveLength(4);
  });
});

describe('loadNativeCourse', () => {
  it('loads and caches course data and the control polyline', async () => {
    const d = { ...TRACKS[7], native: null };
    await loadNativeCourse(d);
    expect(d.native.vertices.length).toBeGreaterThan(100);
    expect(d.control.length).toBe(d.native.path.length);
    const same = await loadNativeCourse(d);
    expect(same).toBe(d);
  });
  it('returns defs that are already native or have no dir untouched', async () => {
    const d = { native: {} };
    expect(await loadNativeCourse(d)).toBe(d);
    const e = { dir: null };
    expect(await loadNativeCourse(e)).toBe(e);
  });
  it('throws on a missing course', async () => {
    await expect(loadNativeCourse({ dir: 'no-such-course' })).rejects.toThrow(/HTTP 404/);
  });
});

describe('Track (mario raceway)', () => {
  it('builds a closed route with frames', async () => {
    const t = await makeTrack('mario');
    expect(t.length).toBeGreaterThan(100);
    expect(t.pos).toHaveLength(t.n);
    expect(t.group.children.length).toBeGreaterThan(5);
    const out = { pos: new THREE.Vector3(), T: new THREE.Vector3(), U: new THREE.Vector3(), R: new THREE.Vector3(), k: 0 };
    const f = t.frameAt(-5, out);
    expect(f).toBe(out);
    expect(f.T.length()).toBeCloseTo(1, 3);
    expect(t.frameAt(t.length + 5, out).pos.distanceTo(t.frameAt(5, { ...out, pos: new THREE.Vector3() }).pos)).toBeLessThan(1e-6);
  });
  it('has wall limits, ground lookups and wall pushes', async () => {
    const t = await makeTrack('mario');
    expect(t.wallAt(10, 1)).toBeGreaterThan(0);
    expect(t.wallAt(-10, -1)).toBeGreaterThan(0);
    const p = t.pos[10];
    const g = t.groundAt(p.x, p.z, p.y);
    expect(g).not.toBeNull();
    expect(Math.abs(g.y - p.y)).toBeLessThan(3);
    expect(t.groundBelow(p.x, p.z, p.y + 5).y).toBeLessThanOrEqual(p.y + 5);
    expect(t.groundBelow(1e6, 1e6, 0)).toBeNull();
    expect(t.groundAt(1e6, 1e6, 0)).toBeNull();
    expect(t.wallTris.length).toBeGreaterThan(0);
    // a push at an open spot on the route finds nothing
    expect(t.wallPush(p.x, p.z, p.x, p.z, p.y, 0.1)).toBeNull();
    // walk a kart sideways through the wall triangles: some face must stop it
    const w = t.wallTris[0];
    const cx = (w[0][0] + w[1][0] + w[2][0]) / 3, cz = (w[0][2] + w[1][2] + w[2][2]) / 3;
    expect(typeof t.blocked(cx - 3, cz - 3, cx + 3, cz + 3, w[0][1])).toBe('boolean');
    expect(t.cpuStraight).toHaveLength(t.n);
    expect(t.cpuStraight.some(v => v === 1)).toBe(true);
  });
  it('wallPush resolves a kart pushed into a wall face', async () => {
    const t = await makeTrack('mario');
    let hit = null;
    for (const [a, b, c] of t.wallTris.slice(0, 400)) {
      const n = new THREE.Vector3().subVectors(new THREE.Vector3(...b), new THREE.Vector3(...a)).cross(new THREE.Vector3().subVectors(new THREE.Vector3(...c), new THREE.Vector3(...a)));
      if (Math.hypot(n.x, n.z) < 1e-6) continue;
      n.y = 0; n.normalize();
      const cx = (a[0] + b[0] + c[0]) / 3, cz = (a[2] + b[2] + c[2]) / 3, y = (a[1] + b[1] + c[1]) / 3 - 0.3;
      hit = t.wallPush(cx + n.x * 1.5, cz + n.z * 1.5, cx + n.x * 0.05, cz + n.z * 0.05, y, 0.55);
      if (hit) break;
    }
    expect(hit).not.toBeNull();
    expect(Math.hypot(hit.nx, hit.nz)).toBeCloseTo(1, 3);
  });
  it('shadow catchers add and toggle twin meshes', async () => {
    const t = await makeTrack('mario');
    const before = t.group.children.length;
    t.setShadowCatchers(true);
    expect(t.group.children.length).toBeGreaterThan(before);
    expect(t.catchers.every(c => c.visible)).toBe(true);
    const n = t.group.children.length;
    t.setShadowCatchers(true);
    expect(t.group.children.length).toBe(n);
    t.setShadowCatchers(false);
    expect(t.catchers.every(c => !c.visible)).toBe(true);
  });
  it('builds mirrored tracks with un-mirrored signs', async () => {
    const t = await makeTrack('mario', { mirror: true });
    expect(t.mirror).toBe(true);
    expect(t.group.children.length).toBeGreaterThan(5);
  });
  it.each(['luigi', 'koopa'])('builds %s', async id => {
    const t = await makeTrack(id);
    expect(t.length).toBeGreaterThan(100);
    expect(t.wallL).toHaveLength(t.n);
  }, 30000);
});

describe('Track (battle arena)', () => {
  it.each(['block-fort', 'big-donut', 'double-deck', 'skyscraper'])('%s is a free-roaming arena', async id => {
    const t = await makeTrack(id);
    expect(t.arena).toBe(true);
    expect(t.length).toBe(0);
    expect(Number.isFinite(t.fallY)).toBe(true);
    expect(t.bounds.maxX).toBeGreaterThan(t.bounds.minX);
    const s = battleSpawn(id, 0);
    expect(t.groundAt(s.x, s.z, s.y) || t.groundBelow(s.x, s.z, s.y + 0.5)).not.toBeNull();
  });
});

describe('Track (procedural spline course)', () => {
  const circle = Array.from({ length: 12 }, (_, i) => [Math.cos(i / 12 * Math.PI * 2) * 120, Math.sin(i * 0.9) * 2, Math.sin(i / 12 * Math.PI * 2) * 120]);
  const def = {
    id: 'test', name: 'Test', control: circle, native: null, padSpots: [[0.25, 2], [0.6, -3]],
    theme: { skyTop: 0x508cff, skyBot: 0xd8e8f8, hemiSky: 0xffffff, hemiGround: 0xffffff, sun: 0xffffff,
      road: '#555', curbA: '#f00', curbB: '#fff', grass: '#2a2', wallA: '#999', wallB: '#777', trees: 6, trunk: 0x553311, leaf: 0x228822, snowCap: true },
  };
  it('builds the road, curbs, grass, walls, start line, pads and trees', () => {
    const t = new Track(def);
    expect(t.length).toBeGreaterThan(500);
    expect(t.bank).toHaveLength(t.n);
    expect(t.boostPads).toHaveLength(2);
    expect(t.group.children.length).toBeGreaterThan(20);
    expect(t.group.children.filter(c => c.isSprite)).toHaveLength(6);
    expect(t.wallAt(10, 1)).toBe(19);   // no probed limits: the default wall distance
    for (let i = 0; i < t.n; i++) expect(Math.abs(t.bank[i])).toBeLessThanOrEqual(0.4 + 1e-9);
  });
  it('frameAt wraps and interpolates a unit frame', () => {
    const t = new Track(def);
    const out = { pos: new THREE.Vector3(), T: new THREE.Vector3(), U: new THREE.Vector3(), R: new THREE.Vector3(), k: 0 };
    t.frameAt(t.length * 1.25, out);
    expect(out.T.length()).toBeCloseTo(1, 5);
    expect(out.R.dot(out.T)).toBeCloseTo(0, 2);
  });
});

describe('widened narrow passages (port changes, not MK64)', () => {
  // DK's Jungle Parkway's rope bridge (widenDKBridge): 1.6x between the rails, so two karts pass on it and the
  // posts at its mouth stand clear of the route (they piled the race up at (-138, -57))
  it('DK\'s Jungle Parkway bridge lets two karts side by side', async () => {
    const t = await makeTrack('dk');
    for (let s = 1215; s <= 1280; s += 5) {
      expect(t.wallAt(s, -1)).toBeGreaterThanOrEqual(3);
      expect(t.wallAt(s, 1)).toBeGreaterThanOrEqual(3);
    }
    // the deck stays under the route all the way across, at the bridge's height
    const f = { pos: new THREE.Vector3(), T: new THREE.Vector3(), U: new THREE.Vector3(), R: new THREE.Vector3(), k: 0 };
    for (let s = 1210; s <= 1300; s += 10) {
      t.frameAt(s, f);
      for (const d of [-2.5, 0, 2.5]) {
        const g = t.groundAt(f.pos.x + f.R.x * d, f.pos.z + f.R.z * d, f.pos.y);
        expect(g && Math.abs(g.y - f.pos.y)).toBeLessThan(0.6);
      }
    }
  });
});
