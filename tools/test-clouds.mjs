import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { inflateSync } from 'node:zlib';
import { NATIVE_CLOUD_DATA, NATIVE_CLOUDS, STAR_TWINKLE, nativeClouds, cloudScreenX } from '../src/track.js';

const SOURCE = '/Users/toddbruss/Downloads/mk64-master';
const ROM = '/Users/toddbruss/Downloads/Mario Kart 64 (USA).z64';
const C_NAMES = {
  luigi: 'gLuigiRacewayClouds', yoshiMooMoo: 'gYoshiValleyMooMooFarmClouds', koopa: 'gKoopaTroopaBeachClouds',
  royal: 'gRoyalRacewayClouds', sherbet: 'gSherbetLandClouds', kalimari: 'gKalimariDesertClouds',
  toadRainbowStars: 'gToadsTurnpikeRainbowRoadStars', warioStars: 'gWarioStadiumStars',
};
const EXHAUST = [0x717A84, 0x717F00, 0x718388, 0x71887C, 0x718C44, 0x71903C];

function mio0(rom, off) {
  assert.equal(rom.toString('latin1', off, off + 4), 'MIO0');
  const size = rom.readUInt32BE(off + 4);
  let comp = off + rom.readUInt32BE(off + 8), raw = off + rom.readUInt32BE(off + 12), bit = 0;
  const out = Buffer.alloc(size); let n = 0;
  while (n < size) {
    if (rom[off + 16 + (bit >> 3)] & (0x80 >> (bit & 7))) out[n++] = rom[raw++];
    else {
      const p = rom.readUInt16BE(comp); comp += 2;
      for (let len = (p >> 12) + 3, d = (p & 0xfff) + 1; len--; n++) out[n] = out[n - d];
    }
    bit++;
  }
  return out;
}
function readPng(path) {   // our extractor writes RGBA8, filter 0 on every row
  const b = readFileSync(path);
  const w = b.readUInt32BE(16), h = b.readUInt32BE(20);
  const idat = [];
  for (let o = 8; o < b.length;) {
    const len = b.readUInt32BE(o), type = b.toString('latin1', o + 4, o + 8);
    if (type === 'IDAT') idat.push(b.subarray(o + 8, o + 8 + len));
    o += 12 + len;
  }
  const raw = inflateSync(Buffer.concat(idat)), px = Buffer.alloc(w * h * 4);
  for (let y = 0; y < h; y++) { assert.equal(raw[y * (w * 4 + 1)], 0); raw.copy(px, y * w * 4, y * (w * 4 + 1) + 1, (y + 1) * (w * 4 + 1)); }
  return { w, h, px };
}
const i4Matches = (png, bytes) => {
  for (let i = 0; i < bytes.length * 2; i++) {
    const v = (i & 1 ? bytes[i >> 1] & 15 : bytes[i >> 1] >> 4) * 17;
    if (png.px[i * 4 + 3] !== v || png.px[i * 4] !== 255) return false;
  }
  return true;
};

test('cloud/star lists match src/data/some_data.c', { skip: !existsSync(SOURCE) && 'mk64-master not present' }, () => {
  const c = readFileSync(`${SOURCE}/src/data/some_data.c`, 'utf8');
  for (const [js, name] of Object.entries(C_NAMES)) {
    const body = c.match(new RegExp(`${name}\\[\\] = \\{([\\s\\S]*?)\\n\\};`))[1];
    const rows = [...body.matchAll(/\{ (0x[0-9a-f]+), (0x[0-9a-f]+), (0x[0-9a-f]+), (0x[0-9a-f]+) \}/g)].map(m => m.slice(1).map(Number));
    assert.deepEqual(NATIVE_CLOUD_DATA[js], rows.slice(0, rows.findIndex(r => r[0] === 0xffff)), js);
  }
});

test('every list (with its 0xffff terminator) exists verbatim in the ROM', { skip: !existsSync(ROM) && 'ROM missing' }, () => {
  const rom = readFileSync(ROM);
  for (const [js, rows] of Object.entries(NATIVE_CLOUD_DATA)) {
    const buf = Buffer.alloc((rows.length + 1) * 8);
    [...rows, [0xffff, 0, 0, 0]].forEach((r, i) => r.forEach((v, j) => buf.writeUInt16BE(v, i * 8 + j * 2)));
    assert.ok(rom.indexOf(buf) > 0, `${js} not found in ROM`);
  }
});

test('extracted cloud and star PNGs equal the ROM I4 texels', { skip: !existsSync(ROM) && 'ROM missing' }, () => {
  const rom = readFileSync(ROM);
  EXHAUST.forEach((off, i) => {
    const data = mio0(rom, off), png = readPng(`public/mk64/sky/clouds-${i}.png`);
    assert.deepEqual([png.w, png.h], [64, data.length / 32]);
    assert.ok(i4Matches(png, data), `clouds-${i}`);
  });
  const common = mio0(rom, 0x132B50);
  assert.ok(i4Matches(readPng('public/mk64/sky/star.png'), common.subarray(0x293D8, 0x293D8 + 128)), 'star');
  // quad vertices D_0D005FB0 (clouds, 64x32) and common_vtx_rectangle (stars, 16x16) used by main.js
  const xy = off => [0, 1, 2, 3].map(i => [common.readInt16BE(off + i * 16), common.readInt16BE(off + i * 16 + 2)]);
  assert.deepEqual(xy(0x5FB0), [[-32, -16], [31, -16], [31, 15], [-32, 15]]);
  assert.deepEqual(xy(0x5770), [[-8, -8], [7, -8], [7, 7], [-8, 7]]);
});

test('course wiring follows course_init_cloud / course_update_clouds', () => {
  assert.deepEqual(Object.keys(NATIVE_CLOUDS).sort(),
    ['kalimari', 'koopa', 'luigi', 'mario', 'moomoo', 'rainbow', 'royal', 'sherbet', 'toad', 'wario', 'yoshi']);
  for (const id of Object.keys(NATIVE_CLOUDS)) {
    const set = nativeClouds(id), c = NATIVE_CLOUDS[id];
    assert.equal(NATIVE_CLOUD_DATA[c.init].length, NATIVE_CLOUD_DATA[c.update].length, id);
    // clouds index D_8018D220 as u8[1024] frames: 0xC00 blocks hold 3, 0x1000 blocks 4
    if (!set.stars) assert.ok(Math.max(...set.objects.map(o => o.frame)) < [3, 3, 3, 4, 4, 4][c.texture], id);
  }
  const mario = nativeClouds('mario').objects[0];   // init from Kalimari, rotY from Luigi
  assert.deepEqual(mario, { rotY: 0x04fa, posY: 0x28, scale: 0.75, frame: 0 });
  assert.equal(nativeClouds('luigi').objects[0].posY, -10);   // 0xfff6 is s16
  assert.equal(nativeClouds('frappe'), null);
  assert.equal(STAR_TWINKLE.length, 5);
});

test('func_800788F8 screen x', () => {
  assert.equal(cloudScreenX(0, 0), 160);
  assert.equal(cloudScreenX(0x10000 - 0x4000, 0x4000), 160);           // u16 wrap
  assert.equal(Math.round(cloudScreenX(0, 0x1C71)), 160 + 160 * 40 / 40); // +40 deg -> right screen edge
  assert.ok(cloudScreenX(0, 0xC000) < 160);                             // s16: 0xC000 is -90 deg
});
