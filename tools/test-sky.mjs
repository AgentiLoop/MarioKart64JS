import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { NATIVE_SKY, nativeSkyColors } from '../src/track.js';

const SOURCE = '/Users/toddbruss/Downloads/mk64-master/yamls/courses';
const ROM = '/Users/toddbruss/Downloads/Mario Kart 64 (USA).z64';
const YAML = {
  mario: 'mario_raceway', choco: 'choco_mountain', bowser: 'bowsers_castle', banshee: 'banshee_boardwalk',
  yoshi: 'yoshi_valley', frappe: 'frappe_snowland', koopa: 'koopa_beach', royal: 'royal_raceway',
  luigi: 'luigi_raceway', moomoo: 'moo_moo_farm', toad: 'toads_turnpike', kalimari: 'kalimari_desert',
  sherbet: 'sherbet_land', rainbow: 'rainbow_road', wario: 'wario_stadium', dk: 'dks_jungle_parkway',
};
const readYaml = name => {
  const text = readFileSync(`${SOURCE}/${name}_metadata.yml`, 'utf8');
  const list = key => JSON.parse(text.match(new RegExp(`^\\s*${key}:\\s*(\\[[^\\]]*\\])`, 'm'))[1]);
  return { id: Number(text.match(/^\s*id:\s*(\d+)/m)[1]), sky: [list('sky_colors'), list('sky_colors2')] };
};

test('all 16 race courses have a sky entry', () => {
  assert.deepEqual(Object.keys(NATIVE_SKY).sort(), Object.keys(YAML).sort());
});

test('sky table matches decomp course metadata', { skip: !existsSync(SOURCE) && 'mk64-master not present' }, () => {
  for (const [id, name] of Object.entries(YAML)) assert.deepEqual(NATIVE_SKY[id], readYaml(name).sky, id);
});

test('sTopSkyBoxColors / sBottomSkyBoxColors tables exist verbatim in the ROM', { skip: (!existsSync(ROM) || !existsSync(SOURCE)) && 'ROM or source missing' }, () => {
  const byId = [];
  for (const f of ['podium_ceremony', 'block_fort', 'skyscraper', 'double_deck', 'big_donut', ...Object.values(YAML)]) {
    const { id, sky } = readYaml(f); byId[id] = sky;
  }
  assert.equal(byId.length, 21);
  const rom = readFileSync(ROM);
  for (const half of [0, 1]) {
    const buf = Buffer.alloc(21 * 12);
    byId.forEach((e, i) => e[half].forEach((v, j) => buf.writeInt16BE(v << 16 >> 16, i * 12 + j * 2)));
    assert.ok(rom.indexOf(buf) > 0, `table ${half} not found in ROM`);
  }
});

test('colours use the low byte like the u8 vertex colour store', () => {
  assert.deepEqual(nativeSkyColors('luigi'), { top: [128, 184, 248], horizon: [216, 232, 248], below: [216, 232, 248], bottom: [0, 0, 0] });
  assert.equal(nativeSkyColors('meadow'), null);
});
