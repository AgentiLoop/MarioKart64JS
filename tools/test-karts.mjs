import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { buildKartMesh, kartSpriteFrame } from '../src/kart.js';

const manifest = JSON.parse(readFileSync(new URL('../public/mk64/karts/manifest.json', import.meta.url)));
const normal = [...Array.from({ length: 21 }, (_, i) => 84 + i), ...Array.from({ length: 14 }, (_, i) => 235 + i)];
const spin = [84, ...Array.from({ length: 19 }, (_, i) => 230 + i)];

test('all 65536 N64 angle bins match neutral-slope view tables, including spinouts', () => {
  for (let u = 0; u < 65536; u++) {
    const angle = (u + 0.5) * Math.PI * 2 / 65536;
    let coarse = Math.floor(u / 128);
    const mirrored = coarse >= 257;
    if (mirrored) coarse = 513 - coarse;
    const folded = u >= 0x7ff9 ? (-u & 65535) : u;
    const selector = Math.min(34, Math.floor(folded / (coarse < 81 ? 520 : 1638)) + (coarse < 81 ? 0 : 15));
    assert.deepEqual(kartSpriteFrame(angle), { frame: normal[selector], mirrored });
    let spinning = Math.floor(folded / 1638);
    if (u >= 0x7ff9 && spinning === 0) spinning = 1;
    if (spinning >= 20) spinning = 0;
    assert.deepEqual(kartSpriteFrame(angle, true), { frame: spin[spinning], mirrored });
  }
});

test('cardinal views, mirrored side and angle wrap', () => {
  assert.deepEqual(kartSpriteFrame(0), { frame: 84, mirrored: false });
  assert.deepEqual(kartSpriteFrame(Math.PI / 2), { frame: 239, mirrored: false });
  assert.deepEqual(kartSpriteFrame(-Math.PI / 2), { frame: 239, mirrored: true });
  assert.deepEqual(kartSpriteFrame(Math.PI), { frame: 248, mirrored: false });
  for (const a of [0.3, 1.2, 2.5]) assert.deepEqual(kartSpriteFrame(a), kartSpriteFrame(a + 4 * Math.PI));
});

test('eight atlases, frame UVs, camera-relative yaw, independent textures and disposal', () => {
  const load = THREE.TextureLoader.prototype.load;
  THREE.TextureLoader.prototype.load = function (url) {
    const map = new THREE.Texture(); map.userData.url = url; return map;
  };
  try {
    const camera = new THREE.PerspectiveCamera();
    const groups = Object.keys(manifest.drivers).map(buildKartMesh);
    assert.equal(groups.length, 8);
    assert.equal(new Set(groups.map(g => g.children[0].material.map)).size, 8);
    for (const group of groups) {
      const sprite = group.children[0], map = sprite.material.map;
      assert.equal(sprite.isSprite, true);
      assert.equal(map.colorSpace, THREE.SRGBColorSpace);
      assert.equal(map.minFilter, THREE.NearestFilter);
      assert.equal(map.generateMipmaps, false);
      assert.equal(sprite.material.alphaTest, 0.5);
      assert.equal(sprite.material.depthWrite, true);
      assert.equal(sprite.material.toneMapped, false);
      assert.ok(map.userData.url.endsWith(`/${group.userData.character}.png`));
      for (const [x, z, frame, mirror] of [[0, 10, 84, false], [10, 0, 239, false], [-10, 0, 239, true], [0, -10, 248, false]]) {
        camera.position.set(x, 4, z);
        sprite.onBeforeRender(null, null, camera);
        assert.deepEqual(sprite.userData, { frame, mirrored: mirror });
        const asset = manifest.drivers[group.userData.character].frames[frame];
        assert.equal(asset.name, `${group.userData.character}_kart_frame${String(frame).padStart(3, '0')}`);
        assert.ok(Math.abs(map.offset.y - (1 - (asset.y + 64) / 1024)) < 1e-12);
        assert.ok(Math.abs(map.offset.x - (asset.x + (mirror ? 64 : 0)) / 1344) < 1e-12);
        assert.equal(map.repeat.x, (mirror ? -1 : 1) / 21);
      }
      group.rotation.y = Math.PI / 2;
      camera.position.set(10, 4, 0);
      sprite.onBeforeRender(null, null, camera);
      assert.equal(sprite.userData.frame, 84);
      let disposed = 0;
      map.addEventListener('dispose', () => disposed++);
      sprite.material.addEventListener('dispose', () => disposed++);
      group.userData.dispose();
      assert.equal(disposed, 2);
    }
  } finally {
    THREE.TextureLoader.prototype.load = load;
  }
});
