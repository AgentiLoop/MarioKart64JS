import * as THREE from 'three';
import * as HD from './hd.js';
import { fluidAt, fluidLevel } from './lakitu.js';

export const NATIVE_SCALE = 0.1;   // MK64 course units -> scene units

// The 16 original race courses in cup order, converted by tools/extract-course.py.
// Course data is fetched on demand (loadNativeCourse) so the menu stays light.
const NATIVE_COURSES = [
  ['luigi', 'luigi-raceway', 'Luigi Raceway'], ['moomoo', 'moo-moo-farm', 'Moo Moo Farm'],
  ['koopa', 'koopa-troopa-beach', 'Koopa Troopa Beach'], ['kalimari', 'kalimari-desert', 'Kalimari Desert'],
  ['toad', 'toads-turnpike', "Toad's Turnpike"], ['frappe', 'frappe-snowland', 'Frappe Snowland'],
  ['choco', 'choco-mountain', 'Choco Mountain'], ['mario', 'mario-raceway', 'Mario Raceway'],
  ['wario', 'wario-stadium', 'Wario Stadium'], ['sherbet', 'sherbet-land', 'Sherbet Land'],
  ['royal', 'royal-raceway', 'Royal Raceway'], ['bowser', 'bowsers-castle', "Bowser's Castle"],
  ['dk', 'dks-jungle-parkway', "D.K.'s Jungle Parkway"], ['yoshi', 'yoshi-valley', 'Yoshi Valley'],
  ['banshee', 'banshee-boardwalk', 'Banshee Boardwalk'], ['rainbow', 'rainbow-road', 'Rainbow Road'],
];
// The four battle arenas (gCupCourseOrder[4], menus.c): open courses with no track path.
const BATTLE_COURSES = [
  ['big-donut', 'big-donut', 'Big Donut'], ['block-fort', 'block-fort', 'Block Fort'],
  ['double-deck', 'double-deck', 'Double Deck'], ['skyscraper', 'skyscraper', 'Skyscraper'],
];
// Battle start spots (spawn_players.c func_8003C0F0 / spawn_players_Np_battle): [x, z] per player slot in
// MK64 units, the common height, and the facing angle (u16 binary, kart faces (-sin, cos)) per slot.
// Players 1-2 take the first two spots in 2P, 1-4 all four in 3P/4P. The 'fall' height is D_8015F8E4
// (course_generate_collision_mesh): at or below it the kart is put back on its start spot. Block Fort's is
// gCourseMinY - 10 below its dark floor at -167; assumption: the kart is rescued once it has fallen off the
// arena (-160) rather than landing on that floor.
export const BATTLE_SPAWNS = {
  'block-fort': { y: 5, xz: [[0, 200], [0, -200], [-200, 0], [200, 0]], rot: [32768, 0, -16384, 16384], fall: -160 },
  skyscraper: { y: 480, xz: [[0, 400], [0, -400], [-400, 0], [400, 0]], rot: [32768, 0, -16384, 16384], fall: -480 },
  'double-deck': { y: 55, xz: [[0, 160], [0, -160], [-160, 0], [160, 0]], rot: [32768, 0, -16384, 16384], fall: null },
  'big-donut': { y: 200, xz: [[0, 575], [0, -575], [-575, 0], [575, 0]], rot: [-16384, 16384, 0, 32768], fall: 100 },
};

// Per-course sky gradients, verbatim from mk64-master yamls/courses/*_metadata.yml
// (sky_colors / sky_colors2 -> sTopSkyBoxColors / sBottomSkyBoxColors). Each entry is
// [topR, topG, topB, bottomR, bottomG, bottomB] as s16; the game stores them into u8
// vertex colours, so only the low byte is used (skybox_and_splitscreen.c:313-317, 410-440).
export const NATIVE_SKY = {
  mario: [[128, 4280, 6136, 216, 7144, 32248], [0, 0, 0, 0, 0, 0]],
  choco: [[255, 255, 255, 255, 255, 255], [255, 255, 255, 255, 255, 255]],
  bowser: [[48, 1544, 49528, 0, 0, 0], [0, 0, 0, 0, 0, 0]],
  banshee: [[0, 0, 0, 0, 0, 0], [0, 0, 0, 0, 0, 0]],
  yoshi: [[113, 70, 255, 255, 184, 99], [95, 40, 15, 0, 0, 0]],
  frappe: [[28, 11, 90, 0, 99, 164], [0, 99, 164, 0, 0, 0]],
  koopa: [[48, 1688, 54136, 216, 7144, 32248], [48, 1688, 54136, 0, 0, 0]],
  royal: [[238, 144, 255, 255, 224, 240], [255, 224, 240, 0, 0, 0]],
  luigi: [[128, 4280, 6136, 216, 7144, 32248], [216, 7144, 32248, 0, 0, 0]],
  moomoo: [[0, 18, 255, 197, 211, 255], [255, 184, 99, 0, 0, 0]],
  toad: [[0, 2, 94, 209, 65, 23], [209, 65, 23, 0, 0, 0]],
  kalimari: [[195, 231, 255, 255, 192, 0], [255, 192, 0, 0, 0, 0]],
  sherbet: [[128, 4280, 6136, 216, 7144, 32248], [216, 7144, 32248, 128, 4280, 6136]],
  rainbow: [[0, 0, 0, 0, 0, 0], [0, 0, 0, 0, 0, 0]],
  wario: [[20, 30, 56, 40, 60, 110], [0, 0, 0, 0, 0, 0]],
  dk: [[255, 174, 0, 255, 229, 124], [22, 145, 22, 0, 0, 0]],
  'big-donut': [[0, 0, 0, 0, 0, 0], [0, 0, 0, 0, 0, 0]],
  'block-fort': [[128, 4280, 6136, 216, 7144, 32248], [216, 7144, 32248, 0, 0, 0]],
  'double-deck': [[113, 70, 255, 255, 184, 99], [255, 224, 240, 0, 0, 0]],
  skyscraper: [[0, 0, 0, 0, 0, 0], [0, 0, 0, 0, 0, 0]],
};
// Above the horizon: top colour at the screen top fading to the bottom colour at the
// horizon. Below it (drawn behind the course): sky_colors2 top at the horizon to
// bottom at the screen bottom. Returns u8 RGB triples.
export function nativeSkyColors(id) {
  const e = NATIVE_SKY[id];
  if (!e) return null;
  const rgb = (a, i) => a.slice(i, i + 3).map(v => v & 0xff);
  return { top: rgb(e[0], 0), horizon: rgb(e[0], 3), below: rgb(e[1], 0), bottom: rgb(e[1], 3) };
}

// Clouds and stars (course_init_cloud / course_update_clouds in code_8006E9C0.c and
// update_objects.c). CloudData/StarData entries [rotY, posY, scalePercent, subType] as u16,
// verbatim from src/data/some_data.c (the 0xffff terminator is dropped).
export const NATIVE_CLOUD_DATA = {
  luigi: [
    [0x04fa, 0xfff6, 0x0096, 0x0000], [0x4718, 0x003c, 0x007d, 0x0000], [0x5550, 0x0046, 0x0096, 0x0000], [0x954c, 0x002d, 0x004b, 0x0000],
    [0xae2e, 0x0028, 0x004b, 0x0000], [0x0e38, 0x001e, 0x0032, 0x0001], [0xa384, 0x0032, 0x0064, 0x0001], [0xd548, 0x001e, 0x0032, 0x0001],
    [0x31c4, 0x0032, 0x0064, 0x0002], [0x7ff8, 0x0037, 0x0064, 0x0002], [0xaaa0, 0x004b, 0x0096, 0x0002], [0xb8d8, 0xfff9, 0x0064, 0x0002],
    [0xee2a, 0x003c, 0x0050, 0x0002],
  ],
  yoshiMooMoo: [
    [0x00b6, 0x0050, 0x0041, 0x0000], [0x4718, 0x003c, 0x0064, 0x0000], [0x18e2, 0x0032, 0x004b, 0x0000], [0x7ff8, 0x0037, 0x0064, 0x0000],
    [0x9ff6, 0x002d, 0x0032, 0x0000], [0xc710, 0x0046, 0x003c, 0x0000], [0x0aaa, 0x001e, 0x0064, 0x0001], [0x5c6c, 0x0046, 0x0046, 0x0001],
    [0x31c4, 0x0028, 0x0050, 0x0002], [0xf1b8, 0x0028, 0x004b, 0x0002],
  ],
  koopa: [
    [0x1554, 0x001e, 0x00c8, 0x0000], [0xce2c, 0x001e, 0x00c8, 0x0000], [0xa384, 0x001e, 0x00c8, 0x0001], [0x070c, 0x001e, 0x00c8, 0x0001],
    [0x4718, 0x001e, 0x00c8, 0x0002], [0x8714, 0x001e, 0x00c8, 0x0003],
  ],
  royal: [
    [0x60b0, 0x003c, 0x007d, 0x0000], [0xb8d8, 0x0037, 0x0064, 0x0000], [0xd548, 0x000a, 0x0082, 0x0000], [0xf1b8, 0x0023, 0x0064, 0x0000],
    [0x04fa, 0x0046, 0x0096, 0x0001], [0x4718, 0x003c, 0x007d, 0x0001], [0x954c, 0x002d, 0x004b, 0x0001], [0x0e38, 0x001e, 0x0032, 0x0002],
    [0x8880, 0x0046, 0x0096, 0x0002], [0x31c4, 0x0032, 0x0064, 0x0003], [0x5056, 0x0028, 0x004b, 0x0003], [0x7ff8, 0x0037, 0x0064, 0x0003],
    [0xaaa0, 0x004b, 0x0096, 0x0003],
  ],
  sherbet: [
    [0x4718, 0x003c, 0x007d, 0x0000], [0x5550, 0x0046, 0x0096, 0x0000], [0x954c, 0x002d, 0x004b, 0x0000], [0xf546, 0x0028, 0x004b, 0x0000],
    [0x0e38, 0x001e, 0x0032, 0x0001], [0x0222, 0x0032, 0x0064, 0x0002], [0x1ffe, 0x0028, 0x004b, 0x0002], [0x31c4, 0x0032, 0x0064, 0x0002],
    [0x7ff8, 0x0037, 0x0064, 0x0002], [0xaaa0, 0x004b, 0x0096, 0x0002], [0xb8d8, 0x0037, 0x0064, 0x0002], [0xdff2, 0x001e, 0x0032, 0x0002],
  ],
  kalimari: [
    [0x1ffe, 0x0028, 0x004b, 0x0000], [0x60b0, 0x003c, 0x007d, 0x0000], [0xb8d8, 0x0037, 0x0064, 0x0000], [0x4718, 0x003c, 0x007d, 0x0001],
    [0x954c, 0x002d, 0x004b, 0x0001], [0xf546, 0x0028, 0x004b, 0x0001], [0x0e38, 0x001e, 0x0032, 0x0002], [0xa384, 0x0032, 0x0064, 0x0002],
    [0xddd0, 0x0046, 0x0096, 0x0002], [0x0222, 0x0032, 0x0064, 0x0003], [0x31c4, 0x0032, 0x0064, 0x0003], [0x7ff8, 0x0037, 0x0064, 0x0003],
    [0xaaa0, 0x004b, 0x0096, 0x0003],
  ],
  toadRainbowStars: [
    [0x0222, 0x0032, 0x000a, 0x0000], [0x04fa, 0x0046, 0x000f, 0x0000], [0x093e, 0x000a, 0x0014, 0x0000], [0x0e38, 0x001e, 0x000f, 0x0000],
    [0x11c6, 0x0028, 0x0014, 0x0000], [0x1554, 0xfff6, 0x000f, 0x0000], [0x1ddc, 0x000a, 0x0011, 0x0000], [0x1ffe, 0x0030, 0x0019, 0x0000],
    [0x271a, 0x0046, 0x0014, 0x0000], [0x27d0, 0xfff1, 0x0016, 0x0000], [0x2c14, 0x0014, 0x000f, 0x0000], [0x31c4, 0x0032, 0x0016, 0x0000],
    [0x327a, 0x0000, 0x000a, 0x0000], [0x3a4c, 0x000f, 0x0016, 0x0000], [0x3ffc, 0x002d, 0x0011, 0x0000], [0x40b2, 0xffdd, 0x0016, 0x0000],
    [0x4440, 0x0037, 0x0014, 0x0000], [0x4718, 0x003c, 0x000c, 0x0000], [0x4718, 0x0050, 0x000c, 0x0000], [0x4aa6, 0xfff6, 0x000f, 0x0000],
    [0x5056, 0x0028, 0x000a, 0x0000], [0x5550, 0x0046, 0x000f, 0x0000], [0x60b0, 0x003c, 0x0016, 0x0000], [0x6388, 0xffdd, 0x0019, 0x0000],
    [0x64f4, 0x0023, 0x0011, 0x0000], [0x6aa4, 0x004b, 0x0014, 0x0000], [0x7054, 0x002d, 0x0019, 0x0000], [0x7498, 0x0014, 0x0012, 0x0000],
    [0x7bb4, 0xfff1, 0x001b, 0x0000], [0x7ff8, 0x0037, 0x000a, 0x0000], [0x8386, 0x0041, 0x0014, 0x0000], [0x8880, 0x0046, 0x000f, 0x0000],
    [0x954c, 0x002d, 0x0011, 0x0000], [0x98da, 0x003c, 0x000f, 0x0000], [0x9dd4, 0x0000, 0x000a, 0x0000], [0xa384, 0x0046, 0x000f, 0x0000],
    [0xa43a, 0x0032, 0x0017, 0x0000], [0xaaa0, 0x004b, 0x000f, 0x0000], [0xae2e, 0x0028, 0x0011, 0x0000], [0xb1bc, 0x0023, 0x0014, 0x0000],
    [0xb8d8, 0xfff1, 0x000a, 0x0000], [0xbc66, 0xffe2, 0x000f, 0x0000], [0xc710, 0x001e, 0x000c, 0x0000],
  ],
  warioStars: [
    [0x0222, 0x0050, 0x000a, 0x0000], [0x04fa, 0x0064, 0x000f, 0x0000], [0x093e, 0x005a, 0x0014, 0x0000], [0x0e38, 0x003c, 0x000f, 0x0000],
    [0x11c6, 0x0046, 0x0014, 0x0000], [0x1554, 0x0078, 0x000f, 0x0000], [0x1c70, 0x001e, 0x0011, 0x0000], [0x1ffe, 0x0046, 0x0011, 0x0000],
    [0x271a, 0x0064, 0x0014, 0x0000], [0x2c14, 0x0032, 0x000f, 0x0000], [0x31c4, 0x0050, 0x000a, 0x0000], [0x3996, 0x0019, 0x000c, 0x0000],
    [0x3a4c, 0x0037, 0x0016, 0x0000], [0x3bb8, 0x0019, 0x000c, 0x0000], [0x3ffc, 0x004b, 0x0011, 0x0000], [0x4440, 0x0055, 0x0014, 0x0000],
    [0x4718, 0x005a, 0x000c, 0x0000], [0x4aa6, 0x003c, 0x000f, 0x0000], [0x5056, 0x0046, 0x000a, 0x0000], [0x5550, 0x0064, 0x000f, 0x0000],
    [0x60b0, 0x005a, 0x0016, 0x0000], [0x64f4, 0x0041, 0x0014, 0x0000], [0x6aa4, 0x0069, 0x0014, 0x0000], [0x7054, 0x004b, 0x0014, 0x0000],
    [0x71c0, 0x0078, 0x0012, 0x0000], [0x7498, 0x003c, 0x0012, 0x0000], [0x7ff8, 0x0055, 0x000a, 0x0000], [0x8714, 0x0073, 0x000a, 0x0000],
    [0x8880, 0x0064, 0x000f, 0x0000], [0x954c, 0x004b, 0x0011, 0x0000], [0x98da, 0x003c, 0x000f, 0x0000], [0x9dd4, 0x0032, 0x000a, 0x0000],
    [0xa384, 0x0050, 0x000a, 0x0000], [0xa43a, 0x006e, 0x000a, 0x0000], [0xaaa0, 0x0069, 0x000f, 0x0000], [0xae2e, 0x0046, 0x0011, 0x0000],
    [0xb1bc, 0x0041, 0x0014, 0x0000], [0xb8d8, 0x0055, 0x000a, 0x0000], [0xbc66, 0x003c, 0x000f, 0x0000], [0xc710, 0x0064, 0x000a, 0x0000],
  ],
};
// Per course: cloud texture block (gTextureExhaustN, loaded into D_8018D220 by
// track_minimap_settings), the list init_clouds reads (posY, scale, subType) and the list
// update_clouds reads (rotY). Mario Raceway really initialises from Kalimari Desert's list
// and positions from Luigi Raceway's. Frappe Snowland's slots are snowflakes, not clouds.
export const NATIVE_CLOUDS = {
  mario: { texture: 5, init: 'kalimari', update: 'luigi' },
  yoshi: { texture: 0, init: 'yoshiMooMoo', update: 'yoshiMooMoo' },
  koopa: { texture: 3, init: 'koopa', update: 'koopa' },
  royal: { texture: 4, init: 'royal', update: 'royal' },
  luigi: { texture: 2, init: 'luigi', update: 'luigi' },
  moomoo: { texture: 0, init: 'yoshiMooMoo', update: 'yoshiMooMoo' },
  kalimari: { texture: 5, init: 'kalimari', update: 'kalimari' },
  sherbet: { texture: 1, init: 'sherbet', update: 'sherbet' },
  toad: { stars: true, init: 'toadRainbowStars', update: 'toadRainbowStars' },
  rainbow: { stars: true, init: 'toadRainbowStars', update: 'toadRainbowStars' },
  wario: { stars: true, init: 'warioStars', update: 'warioStars' },
};
// update_stars: primAlpha ping-pongs between [min, max] in steps of 0xFF (func_80073CB0),
// so it alternates min/max on every object update; pair chosen by star index % 5.
export const STAR_TWINKLE = [[0x28, 0xB4], [0x80, 0xFF], [0x50, 0xC8], [0, 0x9B], [0x5A, 0x80]];
const s16 = v => v << 16 >> 16;
// Screen-space objects: rotY (u16 binary angle), posY (s16 pixels above the horizon row),
// scale (scalePercent / 100), frame (cloud frame = subType; stars have one frame).
export function nativeClouds(id) {
  const c = NATIVE_CLOUDS[id];
  if (!c) return null;
  const init = NATIVE_CLOUD_DATA[c.init], upd = NATIVE_CLOUD_DATA[c.update];
  return {
    stars: !!c.stars, texture: c.stars ? 'star' : `clouds-${c.texture}`,
    objects: init.map((e, i) => ({ rotY: upd[i][0], posY: s16(e[1]), scale: e[2] / 100, frame: e[3] })),
  };
}
// func_800788F8 with D_8018D200 = gCameraZoom + 40 (1P zoom 40) in the 320x240 frame:
// x = 160 + (1.7578125 / D_8018D200) * s16(camera->rot[1] + rotY).
export function cloudScreenX(cameraYaw, rotY, zoom = 40) {
  return 160 + (1.7578125 / (zoom + 40)) * s16((cameraYaw + rotY) & 0xffff);
}

export async function loadNativeCourse(def) {
  if (def.native || !def.dir) return def;
  const res = await fetch(`${import.meta.env?.BASE_URL ?? '/'}mk64/${def.dir}/course.json`);
  if (!res.ok) throw new Error(`Course data ${def.dir}: HTTP ${res.status}`);
  def.native = await res.json();
  if (def.id === 'yoshi') widenYoshiBridge(def.native.vertices);
  if (def.id === 'sherbet') widenSherbetPassages(def.native.vertices);
  if (def.id === 'dk') widenDKBridge(def.native.vertices);
  def.control = def.native.path.map(p => p.slice(0, 3).map(v => v * NATIVE_SCALE));
  return def;
}

// Yoshi Valley's rope bridge (course units (-2179, 743) -> 650 along (0.85, 0.53)) is 30 between the rails, narrower
// than two karts (Bowser's body 34): CPUs wedged on it. Not in MK64: a port change. Every vertex (mesh and collision
// share them) is pushed out from the bridge's centre line, 1.6x within 40 of it over the bridge, easing to none 100
// beyond its ends and 100 out to the sides so the land and canyon walls around it stay joined. The route runs down
// the centre line and is unchanged.
function widenYoshiBridge(vertices) {
  const X = -2179.3, Z = 743.15, tx = 0.8498, tz = 0.5270, LEN = 650, W = 1.6, IN = 40, OUT = 100, EASE = 100;
  for (const v of vertices) {
    const px = v[0] - X, pz = v[2] - Z, t = px * tx + pz * tz, n = pz * tx - px * tz, a = Math.abs(n);
    if (t <= -EASE || t >= LEN + EASE || a >= OUT) continue;
    const e = THREE.MathUtils.smoothstep(t < 0 ? t + EASE : LEN + EASE - t, 0, EASE);
    const push = (W - 1) * e * (a <= IN ? a : IN * (OUT - a) / (OUT - IN));
    v[0] = Math.round(v[0] - tz * Math.sign(n) * push);
    v[2] = Math.round(v[2] + tx * Math.sign(n) * push);
  }
}

// DK's Jungle Parkway's rope bridge over the river (course units (-1387, -600) -> 969 along (0.9525, 0.3044), the
// route's straight line moved 7 over to midway between the rails) is 48 between its rails, with a post either side of its mouth ~40 apart: the karts' bodies
// (Bowser's 34) filed through one at a time, a race piled up on the posts (100+ wall hits, Bowser stuck sideways at
// (-138, -57)) and on the far end (-50, -30). Not in MK64: a port change like widenYoshiBridge, 1.6x within 40 of the
// line, easing to none 100 out to the sides and 100 beyond its ends.
function widenDKBridge(vertices) {
  const X = -1387, Z = -600, tx = 0.9525, tz = 0.3044, LEN = 969, W = 1.6, IN = 40, OUT = 100, EASE = 100;
  for (const v of vertices) {
    const px = v[0] - X, pz = v[2] - Z, t = px * tx + pz * tz, n = pz * tx - px * tz, a = Math.abs(n);
    if (t <= -EASE || t >= LEN + EASE || a >= OUT) continue;
    const e = THREE.MathUtils.smoothstep(t < 0 ? t + EASE : LEN + EASE - t, 0, EASE);
    const push = (W - 1) * e * (a <= IN ? a : IN * (OUT - a) / (OUT - IN));
    v[0] = Math.round(v[0] - tz * Math.sign(n) * push);
    v[2] = Math.round(v[2] + tx * Math.sign(n) * push);
  }
}

// Sherbet Land's two ice passages are the course's narrowest stretches: the cave (path points 288-336) is 78-84
// between its walls, the passage after it (480-512) 93-99, against two karts side by side of up to 68 (Bowser 34).
// Not in MK64: a port change like widenYoshiBridge, along each passage's centre line (course units, midway between
// its walls; the route runs off-centre in places and is unchanged): 1.4x within 55 of it, easing to none 130 out to
// the sides (other track is 289 or more away) and 100 beyond its ends.
const SHERBET_PASSAGES = [
  [[-2450, 7], [-2469, 85], [-2493, 161], [-2521, 236], [-2548, 311], [-2581, 386], [-2623, 453], [-2666, 522],
    [-2709, 590], [-2767, 645], [-2826, 699], [-2886, 754], [-2932, 820]],
  [[-2412, 654], [-2361, 591], [-2311, 527], [-2243, 481], [-2173, 440], [-2104, 400], [-2045, 346], [-1985, 289],
    [-1909, 257]],
];
function widenSherbetPassages(vertices) {
  const W = 1.4, IN = 55, OUT = 130, EASE = 100;
  for (const line of SHERBET_PASSAGES) {
    const segs = [];
    let len = 0;
    for (let k = 0; k + 1 < line.length; k++) {
      const [x0, z0] = line[k], dx = line[k + 1][0] - x0, dz = line[k + 1][1] - z0, l = Math.hypot(dx, dz);
      segs.push({ x0, z0, tx: dx / l, tz: dz / l, l, s: len });
      len += l;
    }
    const moves = [];
    for (const v of vertices) {
      let best = null;
      segs.forEach((g, k) => {   // nearest point on the centre line, its first/last segment run on by EASE
        const px = v[0] - g.x0, pz = v[2] - g.z0;
        const u = Math.min(Math.max(px * g.tx + pz * g.tz, k ? 0 : -EASE), k < segs.length - 1 ? g.l : g.l + EASE);
        const d = Math.hypot(px - g.tx * u, pz - g.tz * u);
        if (!best || d < best.d) best = { d, g, t: g.s + u, n: pz * g.tx - px * g.tz };
      });
      const { g, t, n } = best, a = Math.abs(n);
      if (t <= -EASE || t >= len + EASE || a >= OUT) continue;
      const e = THREE.MathUtils.smoothstep(t < 0 ? t + EASE : len + EASE - t, 0, EASE);
      const push = (W - 1) * e * (a <= IN ? a : IN * (OUT - a) / (OUT - IN));
      moves.push([v, -g.tz * Math.sign(n) * push, g.tx * Math.sign(n) * push]);
    }
    for (const [v, dx, dz] of moves) { v[0] = Math.round(v[0] + dx); v[2] = Math.round(v[2] + dz); }
  }
}
// Start spot for player slot i (0-3) of a battle course: { x, y, z, h } in scene units, h the heading in
// radians with the kart facing (sin h, 0, cos h).
export function battleSpawn(id, i) {
  const b = BATTLE_SPAWNS[id], [x, z] = b.xz[i % 4];
  return { x: x * NATIVE_SCALE, y: b.y * NATIVE_SCALE, z: z * NATIVE_SCALE, h: -b.rot[i % 4] * Math.PI / 32768 };
}

// Track defined as a closed 3D spline (x, y=elevation, z). Banking is derived
// automatically from horizontal curvature so hills, dips and camber all fall out
// of the control points.
// Race courses 0-15 in cup order, then the battle cup (16-19) like gCupCourseOrder.
export const TRACKS = [
  ...NATIVE_COURSES.map(([id, dir, name]) => ({
    id, name, dir, blurb: 'Native MK64 geometry and ROM textures. Static scenery; prototype physics.',
    native: null, control: null, padSpots: [],
    theme: { skyTop: 0x508cff, skyBot: 0xd8e8f8, hemiSky: 0xffffff, hemiGround: 0xffffff, sun: 0xffffff },
  })),
  ...BATTLE_COURSES.map(([id, dir, name]) => ({
    id, name, dir, blurb: 'Battle arena: native MK64 geometry and ROM textures.', battle: true,
    native: null, control: null, padSpots: [],
    theme: { skyTop: 0x508cff, skyBot: 0xd8e8f8, hemiSky: 0xffffff, hemiGround: 0xffffff, sun: 0xffffff },
  })),
];

export const HALF_WIDTH = 11;   // drivable asphalt half-width
export const WALL_D = 19;       // lateral distance of guard walls
const SAMPLES = 900;

function canvasTex(w, h, draw, repeatX = 1, repeatY = 1) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(repeatX, repeatY);
  t.anisotropy = 1; t.generateMipmaps = false; t.minFilter = THREE.LinearFilter;   // N64-ish: no mipmaps
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function noise(ctx, w, h, n, alpha) {
  for (let i = 0; i < n; i++) {
    const g = Math.random() * 255 | 0;
    ctx.fillStyle = `rgba(${g},${g},${g},${alpha})`;
    ctx.fillRect(Math.random() * w, Math.random() * h, 2, 2);
  }
}

// EXTRA mirrors the frame in the camera, which leaves lettering and logos on course signs backwards. A flat
// sign is reflected in its own plane (left-right about its centre, so both halves of a two-part sign trade
// places) and the camera's flip reads it right again; a curved or bent one (the Luigi Raceway balloon, the
// Wario Stadium and Toad's Turnpike wall bands) keeps its shape and mirrors its texture instead (u -> 1 - u).
// Arrows, lane diagrams and plain sign backs stay mirrored so they still match the mirrored course.
// Returns Map<batch index, Map<first index of triangle, { p: reflected corners } | { flipU: true }>>.
const UNMIRROR_SIGN = /Sign|Number|Stainglass|gLRTexture66C7A8/, KEEP_MIRRORED = /Arrow|MergingLanes|FallingRocks|Backside|WoodenBack/;
function unmirroredSigns(course) {
  const tris = [], byVertex = new Map(), parent = [];
  const find = i => parent[i] === i ? i : (parent[i] = find(parent[i]));
  course.batches.forEach((batch, b) => {
    if (!batch.texture || !UNMIRROR_SIGN.test(batch.texture) || KEEP_MIRRORED.test(batch.texture)) return;
    for (let k = 0; k < batch.indices.length; k += 3) {
      const vs = [0, 1, 2].map(j => course.vertices[batch.indices[k + j]]);
      const p = vs.map(v => new THREE.Vector3(v[0], v[1], v[2]));
      const n = new THREE.Vector3().subVectors(p[1], p[0]).cross(new THREE.Vector3().subVectors(p[2], p[0]));
      if (n.lengthSq() === 0) continue;
      const t = tris.length;
      tris.push({ b, k, p, vs, area: n.length(), n: n.normalize() }); parent.push(t);
      for (const v of vs) {   // one sign = sign triangles sharing a corner (both halves of a two-part sign)
        const key = `${v[0]},${v[1]},${v[2]}`, list = byVertex.get(key) ?? [];
        for (const o of list) if (Math.abs(tris[o].n.dot(tris[t].n)) > 0.9) parent[find(o)] = find(t);
        list.push(t); byVertex.set(key, list);
      }
    }
  });
  const signs = new Map();
  tris.forEach((tri, t) => { const r = find(t); signs.set(r, [...(signs.get(r) ?? []), tri]); });
  const out = new Map();
  const set = (tri, v) => { if (!out.has(tri.b)) out.set(tri.b, new Map()); out.get(tri.b).set(tri.k, v); };
  for (const sign of signs.values()) {
    const n = sign[0].n;
    if (sign.some(tri => Math.abs(tri.n.dot(n)) < 0.98)) { for (const tri of sign) set(tri, { flipU: true }); continue; }
    // texture axes in the sign's plane (largest triangle): h = dP/ds runs along the lettering, k = dP/dt across it
    const { p, vs } = sign.reduce((a, tri) => tri.area > a.area ? tri : a);
    const e1 = p[1].clone().sub(p[0]), e2 = p[2].clone().sub(p[0]);
    const ds1 = vs[1][3] - vs[0][3], dt1 = vs[1][4] - vs[0][4], ds2 = vs[2][3] - vs[0][3], dt2 = vs[2][4] - vs[0][4];
    const det = ds1 * dt2 - ds2 * dt1;
    if (det === 0) continue;
    const h = e1.clone().multiplyScalar(dt2).addScaledVector(e2, -dt1).divideScalar(det);
    const k = e2.clone().multiplyScalar(ds1).addScaledVector(e1, -ds2).divideScalar(det);
    // reflect along h, keeping lines parallel to k: maps the sign's (possibly skewed) outline onto itself
    const hk = new THREE.Vector3().crossVectors(h, k).dot(n), along = q => new THREE.Vector3().crossVectors(q, k).dot(n) / hk;
    let lo = Infinity, hi = -Infinity;
    for (const tri of sign) for (const q of tri.p) { const a = along(q); lo = Math.min(lo, a); hi = Math.max(hi, a); }
    for (const tri of sign) set(tri, { p: tri.p.map(q => q.clone().addScaledVector(h, lo + hi - 2 * along(q))) });
  }
  return out;
}

export class Track {
  constructor(def = TRACKS[0], { mirror = false } = {}) {
    this.def = def; this.theme = def.theme; this.mirror = mirror;
    if (def.battle) {   // arena: no route, karts roam the collision mesh freely (src/kart.js free mode)
      this.arena = true; this.length = 0; this.n = 0; this.pos = []; this.boostPads = [];
      this.group = new THREE.Group();
      this._buildNativeMeshes();
      this._nativeBounds();
      const S = NATIVE_SCALE, v = def.native.vertices;
      this.bounds = { minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity, minZ: Infinity, maxZ: -Infinity };
      for (const [x, y, z] of v) {
        this.bounds.minX = Math.min(this.bounds.minX, x * S); this.bounds.maxX = Math.max(this.bounds.maxX, x * S);
        this.bounds.minY = Math.min(this.bounds.minY, y * S); this.bounds.maxY = Math.max(this.bounds.maxY, y * S);
        this.bounds.minZ = Math.min(this.bounds.minZ, z * S); this.bounds.maxZ = Math.max(this.bounds.maxZ, z * S);
      }
      const fall = BATTLE_SPAWNS[def.id].fall;
      this.fallY = fall === null ? this.bounds.minY - 1 : fall * S;   // gCourseMinY - 10 / D_8015F8E4
      return;
    }
    const pts = def.control.map(p => new THREE.Vector3(...p));
    // a control point under 0.5 from the one before (the closing point of the path, 0.1-0.2 on 5 courses) is put on
    // the line from that one to the next: a 0.1 sideways jog in so short a step swung the route's tangent 0.24 rad and
    // back (Kalimari Desert's start line, (0, 49.4)), and the frame's lateral line with it - a kart 34 out was
    // thrown 3-5 a frame there. The count stays, so path point i is still at curve parameter i / N.
    for (let i = 0, m = pts.length; i < m; i++) {
      const a = pts[(i + m - 1) % m], b = pts[(i + 1) % m], r = pts[i].distanceTo(a);
      if (r < 0.5) pts[i].subVectors(b, a).setLength(r).add(a);
    }
    this.curve = new THREE.CatmullRomCurve3(pts, true, 'centripetal');
    if (def.native) this.curve.arcLengthDivisions = pts.length * 8;
    this.length = this.curve.getLength();
    this.n = SAMPLES;
    this.ds = this.length / SAMPLES;
    this.pos = []; this.T = []; this.U = []; this.R = []; this.kU = [];
    this._build();
    this.group = new THREE.Group();
    if (def.native) { this._buildNativeMeshes(); this._nativeBounds(); this._cpuSections(); }
    else this._buildMeshes();
  }

  // Lateral wall distance at arc-length s on side sgn (+1 right, -1 left).
  wallAt(s, sgn) {
    const b = sgn > 0 ? this.wallR : this.wallL;
    return b ? this._lerpBound(b, s) : WALL_D;
  }

  // Not in MK64: wallAt, or nearer where the ground beside the route goes under the course's fluid level first (the
  // bank down into D.K.'s Jungle Parkway's river at (92, -188), which wallAt runs on across). CPUs keep their lane in
  // from it (Kart.think); the player can still drive into the water.
  dryAt(s, sgn) {
    const b = sgn > 0 ? this.dryR : this.dryL;
    return b ? this._lerpBound(b, s) : this.wallAt(s, sgn);
  }

  _lerpBound(b, s) {
    const n = this.n, f = (((s % this.length) + this.length) % this.length) / this.ds;
    const i = Math.floor(f) % n, t = f - Math.floor(f);
    return b[i] * (1 - t) + b[(i + 1) % n] * t;
  }

  // Native courses have no guard-wall tunnel: probe the course surface sideways from the
  // route at every sample and stop where it ends, steps sharply (cliffs, drops) or crosses a
  // steep face (rock walls, tree lines, fences) standing at kart height.
  // Assumption: approximates MK64's surface collision (translucent batches count: Rainbow Road, ice).
  _nativeBounds() {
    const course = this.def.native, S = NATIVE_SCALE, CELL = 4, grid = new Map(), tris = [];
    const wallGrid = new Map(), walls = [];   // steep faces (normal > 60 deg from up): [a, b, c]
    const bucket = (map, x0, x1, z0, z1, t) => {
      for (let x = Math.floor(x0 / CELL); x <= Math.floor(x1 / CELL); x++) for (let z = Math.floor(z0 / CELL); z <= Math.floor(z1 / CELL); z++) {
        const key = x * 65536 + z;
        if (!map.has(key)) map.set(key, []);
        map.get(key).push(t);
      }
    };
    const rampOf = new Map();   // BOOST_RAMP_* collision surfaces (extract-course.py "ramps"): sorted vertex triple -> kind
    for (const [kind, idx] of Object.entries(course.ramps || {})) {
      for (let i = 0; i + 2 < idx.length; i += 3) rampOf.set(idx.slice(i, i + 3).sort((p, q) => p - q).join(), kind);
    }
    // vertices with flag 2 (extract-course.py "lakitu"): a triangle of three is flagged 0x800 (add_collision_triangle),
    // ground Lakitu fishes a kart off (func_80079860: Yoshi Valley's canyon, the fields beyond the fences)
    // (drawn-only triangles are no collision: Frappe Snowland's flagged dip at (-126, -121) under the road)
    const lakituV = new Set(course.lakitu || []), lakituTri = new Set();
    const lci = lakituV.size && course.collision ? course.collision.indices : [];
    for (let i = 0; i + 2 < lci.length; i += 3) {
      if ([0, 1, 2].every(k => lakituV.has(lci[i + k]))) lakituTri.add(lci.slice(i, i + 3).sort((p, q) => p - q).join());
    }
    // Steep faces (walls) come from the course's collision surfaces where the extractor lists them (course.collision:
    // MK64's TrackSections table, which is all generate_collision_mesh reads): decorative geometry drawn but not
    // listed (Koopa Troopa Beach's arrow signs at (-93, -136) / (-34, -119), the scenery rocks at (-50, -115), palm
    // trunks) has no collision in MK64, and its faces held and turned the karts here. The ground stays what is drawn
    // (stacked visual surfaces, below). Without the list every drawn batch supplies the walls (battle courses).
    // ny: the largest |normal.y| that still blocks. Faces block from 45 deg (MK64 files a face whose normal is more
    // horizontal than vertical as a wall, collision.c; groundAt never climbs onto them, FLOOR_NY): at 75 the 45-75 deg
    // rock faces of Koopa Troopa Beach were neither ground nor wall and karts drove into them, and in Skyscraper the
    // 59 deg sides of the four covered bridges at (+-4, +-36) / (+-36, +-4) let a kart drive in under their roofs.
    const steep = (a, b, c, ny = 0.7) => {
      const area = (b[0] - a[0]) * (c[2] - a[2]) - (c[0] - a[0]) * (b[2] - a[2]);
      const nx = (b[1] - a[1]) * (c[2] - a[2]) - (b[2] - a[2]) * (c[1] - a[1]);
      const nz = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
      return Math.abs(area) < ny * Math.hypot(nx, area, nz);
    };
    const addWall = (a, b, c) => {
      const xs = [a[0], b[0], c[0]], zs = [a[2], b[2], c[2]];
      bucket(wallGrid, Math.min(...xs), Math.max(...xs), Math.min(...zs), Math.max(...zs), walls.push([a, b, c]) - 1);
    };
    const ci = course.collision ? course.collision.indices : [];
    for (let i = 0; i + 2 < ci.length; i += 3) {
      const [a, b, c] = [0, 1, 2].map(k => course.vertices[ci[i + k]].slice(0, 3).map(v => v * S));
      if (steep(a, b, c, 0.7)) addWall(a, b, c);
    }
    // Rock faces drawn but left out of the collision list (Koopa Troopa Beach's scenery rocks at (-50, -115), which
    // MK64 drives through) block too: course.extraWalls (extract-course.py rockWalls), steep CLIFF-textured faces
    const xw = course.extraWalls || [];
    for (let i = 0; i + 2 < xw.length; i += 3) {
      addWall(...[0, 1, 2].map(k => course.vertices[xw[i + k]].slice(0, 3).map(v => v * S)));
    }
    for (const batch of course.batches) {
      for (let i = 0; i + 2 < batch.indices.length; i += 3) {
        const [a, b, c] = [0, 1, 2].map(k => course.vertices[batch.indices[i + k]].slice(0, 3).map(v => v * S));
        const area = (b[0] - a[0]) * (c[2] - a[2]) - (c[0] - a[0]) * (b[2] - a[2]);
        const nx = (b[1] - a[1]) * (c[2] - a[2]) - (b[2] - a[2]) * (c[1] - a[1]);
        const nz = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
        const xs = [a[0], b[0], c[0]], zs = [a[2], b[2], c[2]];
        // embankments and banked turns are drivable
        if (!course.collision && steep(a, b, c)) addWall(a, b, c);
        if (Math.abs(area) < 1e-4) continue;   // vertical faces carry no ground height
        const sg = area > 0 ? -1 : 1, nl = Math.hypot(nx, area, nz);   // cross(b-a, c-a).y = -area; keep normal pointing up
        const normal = new THREE.Vector3(sg * nx / nl, sg * -area / nl, sg * nz / nl);
        const ramp = rampOf.get(batch.indices.slice(i, i + 3).sort((p, q) => p - q).join()) || null;
        const lakitu = lakituTri.size > 0 && lakituTri.has(batch.indices.slice(i, i + 3).sort((p, q) => p - q).join());
        bucket(grid, Math.min(...xs), Math.max(...xs), Math.min(...zs), Math.max(...zs), tris.push([a, b, c, area, normal, ramp, lakitu]) - 1);
      }
    }
    let hitNormal = null, hitRamp = null, hitLakitu = false;
    // Stacked surfaces (Wario Stadium's visible dirt lumps over its lower collision dirt): stay on top of the
    // highest one at most CLIMB above yRef, so the kart rides what is drawn; otherwise the nearest within 3.
    // A surface steeper than 45 deg is not climbed onto: MK64 files a triangle whose normal is more horizontal than
    // vertical as a wall (FACING_X/Z_AXIS, collision.c), never as ground. Climbing the 56-68 deg faces at the foot of
    // Mario Raceway's barrier at (90, 69) put a kart up between its two leaning walls, a gap narrower than its body,
    // where it bounced from one into the other a quarter of its width deep (tools/test-walls.mjs).
    const CLIMB = 0.6, FLOOR_NY = 0.7;
    const height = (x, z, yRef) => {
      let best = null, top = null, topN = null, topR = null, topL = false;
      for (const t of grid.get(Math.floor(x / CELL) * 65536 + Math.floor(z / CELL)) || []) {
        const [a, b, c, area, normal, ramp, lakitu] = tris[t];
        const u = ((b[0] - x) * (c[2] - z) - (c[0] - x) * (b[2] - z)) / area;
        const v = ((c[0] - x) * (a[2] - z) - (a[0] - x) * (c[2] - z)) / area;
        const w = 1 - u - v;
        if (u < -1e-6 || v < -1e-6 || w < -1e-6) continue;
        const y = u * a[1] + v * b[1] + w * c[1];
        if (Math.abs(y - yRef) < 3 && (best === null || Math.abs(y - yRef) < Math.abs(best - yRef))) { best = y; hitNormal = normal; hitRamp = ramp; hitLakitu = lakitu; }
        if (y - yRef > -3 && y - yRef <= CLIMB && (y - yRef <= 0.05 || normal.y >= FLOOR_NY) && (top === null || y > top)) { top = y; topN = normal; topR = ramp; topL = lakitu; }
      }
      if (top !== null) { hitNormal = topN; hitRamp = topR; hitLakitu = topL; return top; }
      return best;
    };
    // Ground under (x, z) nearest to yRef: { y, normal, ramp, lakitu } or null. Used by karts to ride slopes.
    this.groundAt = (x, z, yRef) => {
      const y = height(x, z, yRef);
      return y === null ? null : { y, normal: hitNormal, ramp: hitRamp, lakitu: hitLakitu };
    };
    // Highest ground at or below yTop under (x, z): { y, normal, ramp, lakitu } or null. Used by airborne karts.
    this.groundBelow = (x, z, yTop) => {
      let best = null, n = null, r = null, l = false;
      for (const t of grid.get(Math.floor(x / CELL) * 65536 + Math.floor(z / CELL)) || []) {
        const [a, b, c, area, normal, ramp, lakitu] = tris[t];
        const u = ((b[0] - x) * (c[2] - z) - (c[0] - x) * (b[2] - z)) / area;
        const v = ((c[0] - x) * (a[2] - z) - (a[0] - x) * (c[2] - z)) / area;
        const w = 1 - u - v;
        if (u < -1e-6 || v < -1e-6 || w < -1e-6) continue;
        const y = u * a[1] + v * b[1] + w * c[1];
        if (y <= yTop && (best === null || y > best)) { best = y; n = normal; r = ramp; l = lakitu; }
      }
      return best === null ? null : { y: best, normal: n, ramp: r, lakitu: l };
    };
    // does the probe step (x0,z0)->(x1,z1), swept at kart body height above ground y, hit a steep face? (crossed = its index)
    let crossed = -1;
    const blocked = (x0, z0, x1, z1, y) => {
      const dx = x1 - x0, dz = z1 - z0;
      for (const [x, z] of [[x0, z0], [x1, z1]]) {
        for (const t of wallGrid.get(Math.floor(x / CELL) * 65536 + Math.floor(z / CELL)) || []) {
          const [a, b, c] = walls[t];
          const e1 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], e2 = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
          for (const lift of [0.6, 2]) {   // Moller-Trumbore, segment (x0,y+lift,z0)->(x1,y+lift,z1)
            const h = [-dz * e2[1], dz * e2[0] - dx * e2[2], dx * e2[1]];
            const det = e1[0] * h[0] + e1[1] * h[1] + e1[2] * h[2];
            if (Math.abs(det) < 1e-9) continue;
            const s = [x0 - a[0], y + lift - a[1], z0 - a[2]];
            const u = (s[0] * h[0] + s[1] * h[1] + s[2] * h[2]) / det;
            if (u < 0 || u > 1) continue;
            const q = [s[1] * e1[2] - s[2] * e1[1], s[2] * e1[0] - s[0] * e1[2], s[0] * e1[1] - s[1] * e1[0]];
            const v = (dx * q[0] + dz * q[2]) / det;
            if (v < 0 || u + v > 1) continue;
            const k = (e2[0] * q[0] + e2[1] * q[1] + e2[2] * q[2]) / det;
            if (k >= 0 && k <= 1) { crossed = t; return true; }
          }
        }
      }
      return false;
    };
    // does the segment (x0,z0)->(x1,z1) at kart body height above ground y hit a steep face? (arena karts)
    this.blocked = blocked;
    // The nearest crossing of the step (x0,z0)->(x1,z1) at body height (0.6 and 2 over ground y) with a steep face:
    // { k: 0..1 along the step, nx, nz: the face's horizontal normal toward (x0, z0) }, or null. Race karts: a step
    // that went all the way through a face (more than the 1.6 wallPush looks behind it) is taken back to it.
    this.sweep = (x0, z0, x1, z1, y) => {
      const dx = x1 - x0, dz = z1 - z0, seen = new Set();
      let best = null;
      for (let cx = Math.floor(Math.min(x0, x1) / CELL); cx <= Math.floor(Math.max(x0, x1) / CELL); cx++)
        for (let cz = Math.floor(Math.min(z0, z1) / CELL); cz <= Math.floor(Math.max(z0, z1) / CELL); cz++)
          for (const t of wallGrid.get(cx * 65536 + cz) || []) {
            if (seen.has(t)) continue;
            seen.add(t);
            const [a, b, c] = walls[t];
            const e1 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], e2 = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
            for (const lift of [0.6, 2]) {
              const h = [-dz * e2[1], dz * e2[0] - dx * e2[2], dx * e2[1]];
              const det = e1[0] * h[0] + e1[1] * h[1] + e1[2] * h[2];
              if (Math.abs(det) < 1e-9) continue;
              const s = [x0 - a[0], y + lift - a[1], z0 - a[2]];
              const u = (s[0] * h[0] + s[1] * h[1] + s[2] * h[2]) / det;
              if (u < 0 || u > 1) continue;
              const q = [s[1] * e1[2] - s[2] * e1[1], s[2] * e1[0] - s[0] * e1[2], s[0] * e1[1] - s[1] * e1[0]];
              const v = (dx * q[0] + dz * q[2]) / det;
              if (v < 0 || u + v > 1) continue;
              const k = (e2[0] * q[0] + e2[1] * q[1] + e2[2] * q[2]) / det;
              if (k < 0 || k > 1 || (best && k >= best.k)) continue;
              let nx = e1[1] * e2[2] - e1[2] * e2[1], nz = e1[0] * e2[1] - e1[1] * e2[0];
              const l = Math.hypot(nx, nz);
              if (l < 1e-9) continue;
              if (nx * dx + nz * dz > 0) { nx = -nx; nz = -nz; }
              best = { k, nx: nx / l, nz: nz / l };
            }
          }
      return best;
    };
    // Faces the route itself drives through are no walls: Mario Raceway's hill is drawn with a grass fan across
    // both tunnel mouths (course_vertices 999,22,716 / 1000,-50,649 / 1000,-50,549), which held every kart that
    // reached them below full speed (CPUs piled up at the exit). Dropped from the grid, kept out of wallTris.
    if (!this.arena && this.pos && this.pos.length > 1) {
      const dead = new Set();
      for (let i = 0; i < this.pos.length; i++) {
        const p = this.pos[i], q = this.pos[(i + 1) % this.pos.length];
        for (let guard = 0; guard < 8 && blocked(p.x, p.z, q.x, q.z, p.y); guard++) {
          const t = crossed; dead.add(t);
          for (const list of wallGrid.values()) { const j = list.indexOf(t); if (j >= 0) list.splice(j, 1); }
        }
      }
      if (dead.size) {
        const kept = walls.filter((_, t) => !dead.has(t)), remap = new Map();
        walls.forEach((_, t) => { if (!dead.has(t)) remap.set(t, remap.size); });
        for (const list of wallGrid.values()) list.forEach((t, j) => { list[j] = remap.get(t); });
        walls.splice(0, walls.length, ...kept);
      }
    }
    this.wallTris = walls;   // steep faces [a, b, c] (physics overlay, tools/test-walls.mjs)
    // Not in MK64: the nearest crossing (0..1 along it) of the 3D segment p -> q with a steep face, or null. The chase
    // camera stops short of it so it never ends up behind a wall looking at its culled back (Sherbet Land's ice walls)
    this.sightHit = (p, q) => {
      const dx = q.x - p.x, dy = q.y - p.y, dz = q.z - p.z, seen = new Set();
      let best = null;
      for (let cx = Math.floor(Math.min(p.x, q.x) / CELL); cx <= Math.floor(Math.max(p.x, q.x) / CELL); cx++)
        for (let cz = Math.floor(Math.min(p.z, q.z) / CELL); cz <= Math.floor(Math.max(p.z, q.z) / CELL); cz++)
          for (const t of wallGrid.get(cx * 65536 + cz) || []) {
            if (seen.has(t)) continue;
            seen.add(t);
            const [a, b, c] = walls[t];
            const e1 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], e2 = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
            const h = [dy * e2[2] - dz * e2[1], dz * e2[0] - dx * e2[2], dx * e2[1] - dy * e2[0]];
            const det = e1[0] * h[0] + e1[1] * h[1] + e1[2] * h[2];
            if (Math.abs(det) < 1e-9) continue;
            const s = [p.x - a[0], p.y - a[1], p.z - a[2]];
            const u = (s[0] * h[0] + s[1] * h[1] + s[2] * h[2]) / det;
            if (u < 0 || u > 1) continue;
            const r = [s[1] * e1[2] - s[2] * e1[1], s[2] * e1[0] - s[0] * e1[2], s[0] * e1[1] - s[1] * e1[0]];
            const v = (dx * r[0] + dy * r[1] + dz * r[2]) / det;
            if (v < 0 || u + v > 1) continue;
            const k = (e2[0] * r[0] + e2[1] * r[1] + e2[2] * r[2]) / det;
            if (k >= 0 && k <= 1 && (best === null || k < best)) best = k;
          }
      return best;
    };
    // Kart against the wall faces, as check_bounding_collision + func_8003F734 do it: a sphere of radius r at body
    // height whose centre projects inside a face and is closer than r to it (or up to 16 MK64 units = 1.6 past
    // it) is pushed back out along the face normal by the overlap, onto the side the kart came from (x0, z0).
    // Beside a face (outer corners, wall ends: the Block Fort blocks, Big Donut's rim) the nearest point of its
    // outline at body height pushes the kart away instead, else it slid into the corner up to its centre.
    // Returns the corrected { x, z } and the outward horizontal normal { nx, nz } of the deepest face, or null.
    // yp: the body's height where it was (x0, z0), last frame's ground: a kart riding down a slope too steep to stand
    // on (Yoshi Valley's 67 deg cliff below the bound at (-307, -48), its ground dropping 1.5 a frame) and turning
    // across it read as moving into it when measured at one height (0.08 a step), so the face's whole overlap with the
    // upright body (1.45, it rides the face) went at once: 1.6 off the cliff in one step
    const wallN = walls.map(([a, b, c]) => {
      const e1 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], e2 = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
      const n = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
      const l = Math.hypot(...n) || 1;
      return [n[0] / l, n[1] / l, n[2] / l, e1, e2];
    });
    const wallTop = walls.map(tri => Math.max(tri[0][1], tri[1][1], tri[2][1]));
    // horizontally nearest point to (px, pz) of the triangle's outline where it stands within the kart's body,
    // y0..y1, so sloped edges count too (the sides of Bowser's Castle's ramp at (138, -268) rise from the road).
    // (mx, mz): the kart's move this step, r its body radius, behind: its centre is behind the face's plane, offTop:
    // it was behind it last step (on top of a ramp the face is the side of)
    const rim = (px, pz, y0, y1, tri, mx = 0, mz = 0, r = 0, behind = false, offTop = false) => {
      let best = null, bd = Infinity;
      for (let i = 0; i < 3; i++) {
        const A = tri[i], B = tri[(i + 1) % 3], ex = B[0] - A[0], ey = B[1] - A[1], ez = B[2] - A[2];
        let lo = 0, hi = 1;   // the part of the edge inside the body's height
        if (Math.abs(ey) < 1e-6) { if (A[1] < y0 || A[1] > y1) continue; }
        else {
          const ta = (y0 - A[1]) / ey, tb = (y1 - A[1]) / ey;
          lo = Math.max(0, Math.min(ta, tb)); hi = Math.min(1, Math.max(ta, tb));
          if (lo > hi) continue;
        }
        const hh = ex * ex + ez * ez, u = hh > 1e-9 ? ((px - A[0]) * ex + (pz - A[2]) * ez) / hh : lo;
        let s = Math.max(lo, Math.min(hi, u));
        const c0 = Math.abs(ey) < 1e-6 ? -1 : (y0 - A[1]) / ey;
        // a gently sloped edge (a ramp's side rising with its surface, Koopa Troopa Beach's wedge at (-97, 122)) met
        // end-on by a kart driving up beside it, short of where the body's height cuts it: the edge's line beside the
        // kart pushes it, sideways, once the body reaches past the cut. The cut point pushed the kart on the route
        // back off the ramp's corner, turning it ~1 rad and costing a third of its speed. Driven into from the side
        // the cut point still holds (Bowser's Castle's ramp at (195, -268))
        // Only along the edge itself: past its end (u over 1) there is no edge to run on (Koopa Troopa Beach's rock at
        // (-145, -79), its edge ending at the cut, put a point 1.6 past the end 0.26 from Bowser's centre: 1.4 in a step)
        // The line comes in no nearer than the cut point is: it took over from the cut point (no contact up to r away)
        // at its full depth, and Bowser driving up beside Koopa Troopa Beach's ramp at (-6, 73), 0.36 from the side's
        // line, went from no contact to 1.33 deep in one step and was shoved out sideways at once (1.1 a frame). Not
        // for a kart coming off the ramp's top over that side (Koopa's at (-57, 167)): there the line holds in full,
        // else the body sank 32% into the side (tools/test-walls.mjs)
        // A kart driving: a hair's move (under 0.02 a step) has no direction to speak of. Bowser stopped on Choco
        // Mountain's slope below the ledge at (-7, 14), creeping 0.008 a step, read as moving along the 58 deg face's
        // edge there, so the line beside him pushed 0.56 where the cut point last step pushed 0.84 less (1.25 a frame)
        let cut = 0;
        if (c0 > 0 && c0 < 1 && s === c0 && s !== u && ey * ey < hh) {
          const m = Math.hypot(mx, mz);
          if (m > 0.02 && (mx * ex + mz * ez) * Math.sign(ey) > 0.7 * m * Math.sqrt(hh)) {
            cut = Math.hypot(A[0] + ex * s - px, A[2] + ez * s - pz);
            if (cut >= r) continue;
            // (off the top: last step's centre was beside the edge, not past its low end: Frappe Snowland's bank face
            // at (-108, -105) rises from a tip on the ground, behind which the kart is only past the tip, and Bowser
            // crossing in front of the tip there was thrown the full line, 1.6 in a step)
            const u0 = ((px - mx - A[0]) * ex + (pz - mz - A[2]) * ez) / hh;
            if (offTop && (ey > 0 ? u0 > 0 : u0 < 1)) cut = 0;
            s = Math.max(0, Math.min(1, u));
          }
        }
        const qx = A[0] + ex * s, qz = A[2] + ez * s, dd = (qx - px) ** 2 + (qz - pz) ** 2;
        // the edge rims the ground the kart rides, within a climb of its height: Koopa Troopa Beach's ramp at (-86,
        // 128) landed on from the one before it, its lip corner 2.1 high pushed the kart riding up at 1.55 back off
        // sideways (turned ~1.6 rad, 42 -> 19). The ground just in from the edge toward the kart is level with it.
        // Gently sloped edges too (under ~24 deg) with the kart behind the face: a wedge ramp's side rising with its
        // top (Koopa Troopa Beach's start ramp at (-177, 18) stands at an angle to the route, and a kart cutting its
        // foot corner onto the top was pushed back off by the side's edge beside it, from inside the ramp); the
        // ground beside the edge on the kart's side is the ramp's top. From the road beside the ramp (in front of
        // the face), and along a steep ramp's edge (Bowser's Castle's 45 deg ramp at (198, -269), where the body
        // would hang off the side), a sloped edge pushes as before
        const qy = A[1] + ey * s;
        if ((ey * ey < 0.09 * hh || (behind && ey * ey < 0.2 * hh)) && qy < y0 - 0.55 + CLIMB && dd > 1e-12) {
          const dh = Math.sqrt(dd), g = height(qx + (px - qx) * 0.3 / dh, qz + (pz - qz) * 0.3 / dh, qy);
          if (g !== null && Math.abs(g - qy) < 0.15) continue;
        }
        // ... and a steeper edge (up to ~41 deg) that is the crest of the ground the kart rides along: Choco Mountain's
        // ledge at (-8, 8) runs down 37 deg to (-5, 16) with a steep fan below it on one side and the kart's ground,
        // level across, on the other. Riding down beside it, the body's height band cut the edge behind the kart,
        // which shoved it on down the ridge 1-1.3 a frame. Only where that cut point lies along the edge from the kart
        // (behind or ahead of it, not beside it, which keeps the body off the fan), the kart is on the far side of the
        // edge from the face and alongside the edge level with it (riding the crest's ground, not on the floor at its
        // foot: Koopa Troopa Beach's rock at (-78.6, -105.3)); the ground is probed square off the edge (toward the
        // kart it would run down the ridge and miss); off a ramp's side onto the road still pushes
        const ue = hh > 1e-9 ? ((px - A[0]) * ex + (pz - A[2]) * ez) / hh : -1;
        if (ey * ey < 0.75 * hh && qy < y0 - 0.55 + CLIMB && dd > 1e-12 && Math.abs((px - qx) * ex + (pz - qz) * ez) > 0.7 * Math.sqrt(dd * hh)
          && ue > 0.1 && ue < 0.9 && Math.abs(A[1] + ey * ue - (y0 - 0.55)) < 0.4) {
          const l = Math.sqrt(hh), sg = Math.sign((px - qx) * -ez + (pz - qz) * ex) || 1, C = tri[(i + 2) % 3];
          const g = (C[0] - A[0]) * -ez + (C[2] - A[2]) * ex < 0 === sg > 0 ? height(qx - ez / l * 0.3 * sg, qz + ex / l * 0.3 * sg, qy) : null;
          if (g !== null && Math.abs(g - qy) < 0.15) continue;
        }
        if (Math.max(dd, cut * cut) < bd) {
          bd = Math.max(dd, cut * cut);
          const k = dd < cut * cut && dd > 1e-12 ? cut / Math.sqrt(dd) : 1;
          best = [px + (qx - px) * k, pz + (qz - pz) * k];
        }
      }
      return best;
    };
    this.wallPush = (x0, z0, x, z, y, r, yp = y) => {
      let hit = null;
      for (let pass = 0; pass < 3; pass++) {   // a corner touches two faces: resolve them in turn
        let deepest = null;
        const seen = new Set();
        for (let cx = Math.floor((Math.min(x0, x) - r) / CELL); cx <= Math.floor((Math.max(x0, x) + r) / CELL); cx++)
          for (let cz = Math.floor((Math.min(z0, z) - r) / CELL); cz <= Math.floor((Math.max(z0, z) + r) / CELL); cz++)
            for (const t of wallGrid.get(cx * 65536 + cz) || []) {
              if (seen.has(t)) continue;
              seen.add(t);
              const a = walls[t][0], [nx, ny, nz, e1, e2] = wallN[t], h = Math.hypot(nx, nz);
              if (h < 1e-6) continue;
              for (const lift of [0.6, 1.2, 2]) {
                const p = [x - a[0], y + lift - a[1], z - a[2]];
                const d = p[0] * nx + p[1] * ny + p[2] * nz, d0 = (x0 - a[0]) * nx + (yp + lift - a[1]) * ny + (z0 - a[2]) * nz;
                const side = d0 !== 0 ? Math.sign(d0) : Math.sign(d) || 1, depth = r - side * d;
                if (depth <= 1e-4 || side * d < -1.6) continue;
                // a low face (a step's riser, at most 1.25 over the ground) the body already overlapped where it was
                // last frame (it came down off its top: Bowser's Castle's stairs at (158..133, -79), 1 high every 5,
                // or the side of Royal Raceway's ramp at (127, -226)) pushes out only the part the kart's own move
                // took it further in, plus 0.15 a frame (first pass only), its top edge too: the whole overlap shoved
                // the kart on by up to its body's width (1.7 for Bowser) in one frame, on every step
                // ... and so does a slope too steep to stand on (normal y over 0.35, under 70 deg) facing up at a kart
                // not moving into it: riding down Royal Raceway's 48 deg bank at (-78, -163) its ground sinks, so the
                // upright body's lower circles cut the slope it is on, then the slope behind it at its foot, and it was
                // shoved off 1-1.9 a frame. Driven into (up a bank from its foot) it pushes in full, as before - but
                // not for a hair's move into it (under 0.02 a step): stopped on the 55 deg slope below Choco Mountain's
                // ledge at (-6, 10), 0.001 into it at v 0.1 pushed the whole overlap out, 1.2 in one step
                // ... and so does any other face the kart is not moving into: coming down off Koopa Troopa Beach's rock
                // at (-48, 184) beside its 73 deg face (top 3.9), the ground dropped 1.4 in a frame, the face now cut the
                // body 1.2 deep and shoved it out sideways in one step. Beside a face its plane says nothing of the rim:
                // its overlap where the kart was, and whether the kart moves toward it, are the rim's own (driving past a
                // face's end, Koopa's at (-61, 168), moves off the plane and onto the corner)
                const into = side * (d - d0) < -0.02, was = r - side * d0, eased = cond => cond && was > 0 ? Math.max(0, depth - was) / h + (pass ? 0 : 0.15) : Infinity;
                const low = wallTop[t] < y + 1.25, most = eased(low || (side * ny > 0.35 && !into)), mostIn = eased(low || !into);
                // centre projected inside the triangle (barycentric)
                const q = [p[0] - d * nx, p[1] - d * ny, p[2] - d * nz];
                const d11 = e1[0] * e1[0] + e1[1] * e1[1] + e1[2] * e1[2], d12 = e1[0] * e2[0] + e1[1] * e2[1] + e1[2] * e2[2];
                const d22 = e2[0] * e2[0] + e2[1] * e2[1] + e2[2] * e2[2];
                const q1 = q[0] * e1[0] + q[1] * e1[1] + q[2] * e1[2], q2 = q[0] * e2[0] + q[1] * e2[1] + q[2] * e2[2];
                const den = d11 * d22 - d12 * d12;
                if (Math.abs(den) < 1e-9) continue;
                const u = (d22 * q1 - d12 * q2) / den, v = (d11 * q2 - d12 * q1) / den;
                let c = null;
                // beside the face: its outline within the body, 0.55 (lower lips are climbed) to 2 (higher edges hang
                // over the road: the kart drives under them, e.g. the face 2.2 over Mario Raceway's road at (59, 52))
                if (u < 0 || v < 0 || u + v > 1) {
                  const e = rim(x, z, y + 0.55, y + 2, walls[t], x - x0, z - z0, r, d < 0, d0 < 0);
                  if (!e) continue;
                  const dx = x - e[0], dz = z - e[1], dh = Math.hypot(dx, dz);
                  if (dh >= r || dh < 1e-6) continue;
                  let cap = most;
                  if (cap === Infinity && (x - x0) * dx + (z - z0) * dz >= -0.02 * dh) {
                    const e0 = rim(x0, z0, yp + 0.55, yp + 2, walls[t], x - x0, z - z0, r, d0 < 0, d0 < 0);
                    const wasR = e0 ? r - Math.hypot(x0 - e0[0], z0 - e0[1]) : 0;
                    if (wasR > 0) cap = Math.max(0, r - dh - wasR) + (pass ? 0 : 0.15);
                  }
                  c = { depth: Math.min(r - dh, cap), nx: dx / dh, nz: dz / dh };
                } else c = { depth: Math.min(depth / h, mostIn), nx: side * nx / h, nz: side * nz / h };
                if (!deepest || c.depth > deepest.depth) deepest = c;
              }
            }
        if (!deepest) break;
        // squeezed between opposite faces (a gap narrower than the body: Yoshi Valley's bridge at (-194, 89) for
        // Bowser): sit halfway between, overlapping both equally, instead of bouncing from one into the other
        if (hit && deepest.nx * hit.nx + deepest.nz * hit.nz < -0.5) {
          hit = { x: x + deepest.nx * deepest.depth / 2, z: z + deepest.nz * deepest.depth / 2, nx: hit.nx, nz: hit.nz };
          break;
        }
        x += deepest.nx * deepest.depth; z += deepest.nz * deepest.depth;
        hit = { x, z, nx: deepest.nx, nz: deepest.nz };
      }
      return hit;
    };
    if (this.arena) return;
    const STEP = 0.5, MAX = 40, RAMP = 8, GAP = 5, raw = { [-1]: [], [1]: [] }, dry = { [-1]: [], [1]: [] };
    const fluidY = fluidLevel(this), wetAt = (x, z, y) => y < fluidAt({ def: this.def, fluidY }, x, z);   // ground under the fluid (dryAt)
    // ground d out from route sample j (side sgn) nearest to yRef
    const across = (j, d, sgn, yRef) => {
      const q = this.pos[(j + this.n) % this.n], Q = this.R[(j + this.n) % this.n];
      return height(q.x + Q.x * d * sgn, q.z + Q.z * d * sgn, yRef);
    };
    const routeY = this.pos.map(p => height(p.x, p.z, p.y) ?? p.y);   // the route's ground
    const roadAt = (j, d, sgn, y) => {   // the ground d out from sample j, if it is level with the route's there
      const g = across(j, d, sgn, y), r = routeY[(j + this.n) % this.n];
      return g !== null && Math.abs(g - r) < 0.6 ? g : null;
    };
    // the road the ramps of Koopa Troopa Beach stand on ((-4, 69), (-4, 48), (-96, 124)): the ground d out from
    // sample i, level with the route's, RAMP or 2 RAMP samples back and ahead (ramps come in close pairs); or null
    // The pair back and ahead most level with each other: where the route itself climbs the next ramp of a pair
    // (Koopa Troopa Beach's at (-88, 128), RAMP ahead of the one at (-96, 121)) that ramp's top is "level with the
    // route" there and passed for the road, so the first ramp read as no ramp and its side face ended the bound at 3
    const roadNear = (i, d, sgn, y) => {
      const at = k => roadAt(i + k, d, sgn, y);
      const A = [at(-RAMP), at(-2 * RAMP)].filter(v => v !== null), B = [at(RAMP), at(2 * RAMP)].filter(v => v !== null);
      let a = null, b = null;
      for (const p of A) for (const q of B) if (a === null || Math.abs(p - q) < Math.abs(a - b) - 1e-6) { a = p; b = q; }
      return a === null ? null : Math.max(a, b);
    };
    // a ramp's top: ground at y, d out from sample i, 0.3 to 2.5 over that road (returns the road, or null)
    const ramp = (i, d, sgn, y) => {
      const road = roadNear(i, d, sgn, y);
      return road !== null && y - road > 0.3 && y - road < 2.5 ? road : null;
    };
    // a face of a wedge ramp standing on the road at y (Koopa Troopa Beach's narrow ramp at (10, 277), 7 high: its
    // sides and back cut the right bound 40 -> 3.5, so it could not be driven onto): its low corners on the road, and
    // each raised one a corner of the ramp's top, a gently sloped surface reaching down to the road. A wall's raised
    // corners belong to the wall's upper triangles or to ground on top of it
    const vkey = v => `${v[0].toFixed(3)},${v[1].toFixed(3)},${v[2].toFixed(3)}`, topFoot = new Map();   // corner -> lowest corner of a sloped top
    for (const [a, b, c, , normal] of tris) {
      if (normal.y <= 0.8) continue;
      const lo = Math.min(a[1], b[1], c[1]);
      for (const v of [a, b, c]) if (v[1] - lo > 0.6) { const k = vkey(v); topFoot.set(k, Math.min(topFoot.get(k) ?? Infinity, lo)); }
    }
    const rampFace = (t, y) => {
      const w = walls[t];
      if (w.some(v => v[1] - y < -0.6) || !w.some(v => v[1] - y >= 0.6)) return false;
      return w.every(v => v[1] - y < 0.6 || Math.abs((topFoot.get(vkey(v)) ?? Infinity) - y) < 0.6);
    };

    for (let i = 0; i < this.n; i++) {
      const p = this.pos[i], R = this.R[i];
      const y0 = routeY[i];
      for (const sgn of [-1, 1]) {
        // (not where the route's own ground is under it: no bank to keep off)
        let prev = y0, d = STEP, passed = 0, wet = wetAt(p.x, p.z, y0) ? -Infinity : Infinity, cliff = Infinity;
        for (; d <= MAX; d += STEP) {
          const x = p.x + R.x * d * sgn, z = p.z + R.z * d * sgn, x1 = p.x + R.x * (d - STEP) * sgn, z1 = p.z + R.z * (d - STEP) * sgn;
          const hit = d > 1.5 && blocked(x1, z1, x, z, prev);   // the route itself may graze ramp sides
          const y = height(x, z, prev);
          // a steep face or a step of > ~67 deg (cliff/drop) ends the course; a ramp's sides and back don't: the
          // bound pinned the karts driving past a ramp onto its side face, where they stuck and piled up (wallPush
          // still holds their bodies off its faces)
          if (y === null) break;
          if (wet === Infinity && wetAt(x, z, y)) wet = d;
          // the dry bound also ends where the ground drops away down a slope steeper than 45 deg, which a kart falls
          // off rather than drives down: Yoshi Valley's canyon side at (-297, -34), 65 deg (1.1 down a step), is no
          // wall (the player can still go over), so the wall limit ran 40 out at s913-931, CPU lanes reached 8.5 out
          // past the road's edge (5.5) and 1-2 karts a race went over into the canyon
          if (cliff === Infinity && y < prev - 0.3 && hitNormal.y < FLOOR_NY) cliff = d;
          // ... and so does a climb steeper than 45 deg, which groundAt never takes a kart up (FLOOR_NY): the bound
          // went up the 49 deg front of Koopa Troopa Beach's rock at (-171, 11) and on to 38, so CPUs steered into
          // the 3-wide gap between it and the ramp beside it, where Bowser wedged crosswise for 40 s
          if (Math.abs(y - prev) > 0.3 && (hit || Math.abs(y - prev) > 1.2 || (y > prev && hitNormal.y < FLOOR_NY && blocked(x1, z1, x, z, prev - 0.5)))) {
            // onto or off a ramp's top, the higher side of the step, which goes on 2 more across (a barrier's top is
            // narrower: Wario Stadium's between its lanes at (-251, -102)) with no face over it
            const up = y > prev, top = up ? d : d - STEP, ty = up ? y : prev, road = ramp(i, top, sgn, ty);
            const y2 = across(i, top + (up ? 2 : -2), sgn, ty), wide = y2 !== null && Math.abs(y2 - ty) < 1.2 && ramp(i, top + (up ? 2 : -2), sgn, y2) !== null;
            // and a ramp climbed onto comes back down to the road within 8 (a bank goes on up: Frappe Snowland's at (-12, 113))
            let back = !up;
            for (let e = d + STEP; !back && e <= d + 8; e += STEP) { const h = across(i, e, sgn, road); back = h !== null && Math.abs(h - road) < 0.6; }
            if (road === null || !wide || !back || Math.min(y, prev) < road - 0.6 || (hit && blocked(x1, z1, x, z, ty))) break;
          } else if (hit) {
            // a ramp's back face (its lip) crossed on the road beside or behind it (Koopa Troopa Beach's at (-109,
            // 116) and (-60, 172)): the face's top under 2.5 over the road is a wide ramp top a few samples back or
            // ahead at the same d
            const top = Math.max(...walls[crossed].map(v => v[1]));
            let lip = top - prev > 0.3 && top - prev < 2.5 && !blocked(x1, z1, x, z, prev + 1.9);
            if (lip) {
              lip = false;
              for (const k of [-1, -2, -3, 1, 2, 3]) for (const dd of [d, d - 1.5, d + 1.5]) {
                const h = across(i + k, dd, sgn, top);
                if (h === null || h - prev < 0.3 || h > top + 0.4 || ramp(i + k, dd, sgn, h) === null) continue;
                const side = e => { const h2 = across(i + k, dd + e, sgn, h); return h2 !== null && Math.abs(h2 - h) < 1.2 && ramp(i + k, dd + e, sgn, h2) !== null; };
                if (side(2) || side(-2)) { lip = true; break; }
              }
            }
            if (!lip && !rampFace(crossed, prev)) break;
          }
          if (hit || prev - y > 0.5) passed = d;   // through a face, or off a ramp's side edge
          prev = y;
        }
        // a ramp face passed less than a kart's width and some room to steer (Bowser's 3.4 + 1.6) before the end: the gap between is no way
        // through, so the bound stops at the face. Between Koopa Troopa Beach's start ramp and the rock beside it at
        // (-172, 14), 3 wide, karts wedged against the ramp's side for whole races, steering for the route beyond it
        if (d <= MAX && passed && d - passed < GAP) d = passed;
        raw[sgn].push(Math.max(2.5, d - STEP));
        dry[sgn].push(Math.max(2.5, Math.min(d, wet < 0 ? Infinity : wet, cliff) - STEP));
      }
    }
    // a wall is only as open as its narrowest neighbour (no slipping through single-sample gaps)
    const tighten = b => b.map((_, i) => Math.min(...[-2, -1, 0, 1, 2].map(k => b[(i + k + this.n) % this.n])));
    this.wallL = tighten(raw[-1]); this.wallR = tighten(raw[1]);
    this.dryL = tighten(dry[-1]); this.dryR = tighten(dry[1]);
  }

  // analyze_track_sections / analyze_curved_path (cpu_vehicles_camera_path/path_calc.inc.c): a path point is a curve
  // when calculate_track_curvature (cross of the chords 0 -> mid(1,2) and 3 -> mid(4,5), over their lengths) passes
  // +-0.1; every straight point before a curve becomes LEANING_CURVE (gTrackConsecutiveCurveCounts > 0, are_in_curve).
  // cpuStraight[sample] marks those points, where CPUs take cpu_CurveTargetSpeed.
  _cpuSections() {
    const p = this.def.native.path, N = p.length;
    const chord = i => { const a = p[i % N], b = p[(i + 1) % N], c = p[(i + 2) % N]; return [(b[0] + c[0]) / 2 - a[0], (b[2] + c[2]) / 2 - a[2]]; };
    const type = [];   // 0 STRAIGHT, 1 RIGHT/LEFT_CURVE, 2 *_LEANING_CURVE
    for (let i = 0; i < N; i++) {
      const [ax, az] = chord(i), [bx, bz] = chord(i + 3);
      const k = -(az * bx - ax * bz) / (Math.hypot(bx, bz) * Math.hypot(ax, az));
      type.push(Math.abs(k) > 0.1 ? 1 : 0);
    }
    for (let i = 0; i < N; i++) {
      if (type[i] !== 0) continue;
      for (let j = 1; j < N; j++) if (type[(i + j) % N]) { for (let k = 0; k < j; k++) type[(i + k) % N] = 2; i += j; break; }
    }
    // nearest path point to each sample; control point i sits at curve parameter i / N
    const lengths = this.curve.getLengths(N * 8), L = lengths[lengths.length - 1];
    this.cpuStraight = new Uint8Array(this.n);
    for (let m = 0, i = 0; m < this.n; m++) {
      const s = m * this.ds * L / this.length;
      while (i < N && lengths[(i + 1) * 8] <= s) i++;
      const near = i + 1 < N && lengths[(i + 1) * 8] - s < s - lengths[i * 8] ? i + 1 : i;
      this.cpuStraight[m] = type[near % N] === 2 ? 1 : 0;
    }
  }

  _build() {
    const n = this.n;
    for (let i = 0; i < n; i++) {
      this.pos.push(this.curve.getPointAt(i / n));
      this.T.push(this.curve.getTangentAt(i / n).normalize());
    }
    // Native courses: the tangent averaged over 3 samples either side (weights 4-3-2-1). The spline through MK64's path
    // points (0.1 apart across, ~2 along) wiggles its tangent up to 0.1-0.5 rad from one sample to the next, and the
    // frame's lateral lines swung with it: a kart 12-38 out had them crossing under it (Frappe Snowland at (20, -210)
    // and (-125, 60), 38 out: thrown 1.6-3.2 a frame, and no foot of the perpendicular for Kart.routeStep), its frame
    // step and curvature off. A steady bend keeps its tangent (the average is symmetric); the positions are the spline's.
    if (this.def.native) {
      const raw = this.T.map(v => v.clone()), W = 3;
      for (let i = 0; i < n; i++) {
        const v = this.T[i].set(0, 0, 0);
        for (let k = -W; k <= W; k++) v.addScaledVector(raw[(i + k + n) % n], W + 1 - Math.abs(k));
        v.normalize();
      }
    }
    // horizontal curvature -> bank angle (smoothed)
    let bank = new Array(n).fill(0);
    for (let i = 0; i < n; i++) {
      const a = this.T[(i + n - 3) % n], b = this.T[(i + 3) % n];
      const kappa = new THREE.Vector3().crossVectors(a, b).y / (6 * this.ds);
      bank[i] = this.def.native ? 0 : THREE.MathUtils.clamp(kappa * 55, -0.4, 0.4);
    }
    for (let pass = 0; pass < 4; pass++) {
      const nb = bank.slice();
      for (let i = 0; i < n; i++) {
        let s = 0;
        for (let k = -12; k <= 12; k++) s += bank[(i + k + n) % n];
        nb[i] = s / 25;
      }
      bank = nb;
    }
    this.bank = bank;
    const Y = new THREE.Vector3(0, 1, 0);
    for (let i = 0; i < n; i++) {
      const T = this.T[i];
      const r0 = new THREE.Vector3().crossVectors(T, Y).normalize();
      const up0 = new THREE.Vector3().crossVectors(r0, T).normalize();
      const U = up0.clone().multiplyScalar(Math.cos(bank[i])).addScaledVector(r0, -Math.sin(bank[i])).normalize();
      this.U.push(U);
      this.R.push(new THREE.Vector3().crossVectors(T, U).normalize());
    }
    for (let i = 0; i < n; i++) {
      const dT = new THREE.Vector3().subVectors(this.T[(i + 1) % n], this.T[(i + n - 1) % n]).divideScalar(2 * this.ds);
      this.kU.push(dT.dot(this.R[i]));
    }
    this.minY = Math.min(...this.pos.map(p => p.y));
  }

  // Frame at arc-length s (meters): interpolated position/axes/curvature.
  frameAt(s, out) {
    const n = this.n;
    s = ((s % this.length) + this.length) % this.length;
    const f = s / this.ds, i = Math.floor(f) % n, j = (i + 1) % n, t = f - Math.floor(f);
    out.pos.lerpVectors(this.pos[i], this.pos[j], t);
    out.T.lerpVectors(this.T[i], this.T[j], t).normalize();
    out.U.lerpVectors(this.U[i], this.U[j], t).normalize();
    out.R.crossVectors(out.T, out.U).normalize();
    out.k = this.kU[i] * (1 - t) + this.kU[j] * t;
    return out;
  }

  _strip(d0, d1, yOff0, yOff1, mat, vScale, uFlip = false) {
    const n = this.n, pos = [], uv = [], idx = [];
    for (let i = 0; i <= n; i++) {
      const k = i % n, p = this.pos[k], R = this.R[k], U = this.U[k];
      const a = p.clone().addScaledVector(R, d0).addScaledVector(U, yOff0);
      const b = p.clone().addScaledVector(R, d1).addScaledVector(U, yOff1);
      pos.push(a.x, a.y, a.z, b.x, b.y, b.z);
      const v = i * this.ds / vScale;
      uv.push(0, v, 1, v);
      if (i < n) { const o = i * 2; idx.push(o, o + 2, o + 1, o + 1, o + 2, o + 3); }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.setIndex(idx);
    g.computeVertexNormals();
    const m = new THREE.Mesh(g, mat);
    m.receiveShadow = true;
    return m;
  }

  // Static course batches converted by tools/extract-course.py. Render state follows
  // render_<course>: unlit shade colour * texture, opaque except alpha-edged flags.
  _buildNativeMeshes() {
    const course = this.def.native;
    const wrap = { repeat: THREE.RepeatWrapping, mirror: THREE.MirroredRepeatWrapping, clamp: THREE.ClampToEdgeWrapping };
    const color = new THREE.Color();
    this.boostPads = [];
    this.textures = [];
    const signs = this.mirror ? unmirroredSigns(course) : new Map();
    course.batches.forEach((batch, bi) => {
      const positions = [], colors = [], uvs = [], flipped = signs.get(bi);
      const [u0, v0] = batch.tileOrigin ?? [0, 0];   // gsDPSetTileSize upper-left, in texels
      // vertex alpha (find_vtx_and_set_colours, e.g. Sherbet Land's see-through ice); unpacked default 0xFF
      const rgba = batch.indices.some(i => course.vertices[i].length > 8);
      for (let k = 0; k < batch.indices.length; k += 3) {
        const sign = flipped?.get(k), p = sign?.p;
        for (const j of p ? [0, 2, 1] : [0, 1, 2]) {   // reflected sign: put the winding back
          const [x, y, z, s, t, r, g, b, a = 255] = course.vertices[batch.indices[k + j]];
          if (p) positions.push(p[j].x * NATIVE_SCALE, p[j].y * NATIVE_SCALE, p[j].z * NATIVE_SCALE);
          else positions.push(x * NATIVE_SCALE, y * NATIVE_SCALE, z * NATIVE_SCALE);
          color.setRGB(r / 255, g / 255, b / 255, THREE.SRGBColorSpace);
          colors.push(color.r, color.g, color.b);
          if (rgba) colors.push(a / 255);
          const u = (s / 32 - u0) / batch.width;   // S10.5 texels; PNG rows stay top-down
          uvs.push(sign?.flipU ? 1 - u : u, (t / 32 - v0) / batch.height);
        }
      }
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
      geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, rgba ? 4 : 3));
      geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
      let map = null;
      if (batch.texture) {
        const image = course.textures[batch.texture].image;
        map = HD.loadTexture(image.startsWith('common/') ? image : `${this.def.dir}/${image}`);   // 1x nearest, HD tiers mipmapped; common/ = shared across courses
        map.colorSpace = THREE.SRGBColorSpace;
        map.flipY = false;
        map.wrapS = wrap[batch.wrapS]; map.wrapT = wrap[batch.wrapT];
        this.textures.push(map);
      }
      const mesh = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({
        map, vertexColors: true, toneMapped: false, fog: false,
        // Not in MK64 (G_CULL_BACK unless the list clears it): both sides drawn, so a camera behind a wall sees the
        // wall instead of looking through its culled back (Sherbet Land's ice walls)
        side: THREE.DoubleSide,
        alphaTest: batch.alphaTest ? 0.5 : 0,   // G_RM_AA_ZB_TEX_EDGE lists
        // G_RM_AA_ZB_XLU_* lists blend by texture alpha (course vertex alpha is always 0 in the ROM)
        transparent: !!batch.translucent, depthWrite: !batch.translucent,
        // drawn over coplanar scenery: the RDP lets the later surface win at equal depth
        polygonOffset: !!batch.layer, polygonOffsetFactor: -(batch.layer || 0), polygonOffsetUnits: -2 * (batch.layer || 0),
      }));
      if (batch.translucent) mesh.renderOrder = 1;
      mesh.name = batch.texture || 'shade';
      mesh.userData.catcher = !batch.translucent;   // setShadowCatchers: the opaque surfaces (base and decal layers)
      this.group.add(mesh);
    });
  }

  // The native course lists are unlit (MeshBasicMaterial takes no shadow map). For the Wii 3D karts (castShadow,
  // src/kart3d.js) each opaque base surface gets a ShadowMaterial twin drawn over it, dark only where the sun's
  // shadow map says so; off, nothing is drawn. The route-plane courses' Lambert ground already receives.
  // The decal layers (polygon-offset grass / road patches over coplanar base surfaces, up to layer 4) get twins too,
  // all offset past the highest layer: a twin at layer 1's offset depth-fought layer 1's grass (flicker) and layers
  // 2+ hid the shadow (tools/test-shadows.mjs). Coplanar twins of a base and its decal would darken twice: the
  // stencil lets each pixel take the shadow once (the first twin to pass the depth test there).
  setShadowCatchers(on) {
    if (on && !this.catchers) {
      const mats = {};   // one ShadowMaterial per cull side
      this.catchers = [];
      const top = Math.max(0, ...this.group.children.map(m => -(m.material?.polygonOffsetFactor || 0))) + 1;
      for (const m of [...this.group.children]) {
        if (!m.userData.catcher) continue;
        const side = m.material.side;
        mats[side] ??= new THREE.ShadowMaterial({ opacity: 0.45, transparent: true, depthWrite: false, side, polygonOffset: true, polygonOffsetFactor: -top, polygonOffsetUnits: -2 * top,
          stencilWrite: true, stencilRef: 1, stencilFunc: THREE.NotEqualStencilFunc, stencilZPass: THREE.ReplaceStencilOp });
        const c = new THREE.Mesh(m.geometry, mats[side]);
        c.receiveShadow = true; c.frustumCulled = m.frustumCulled;
        this.catchers.push(c); this.group.add(c);
      }
    }
    for (const c of this.catchers ?? []) c.visible = on;
  }

  _buildMeshes() {
    const th = this.theme;
    const roadTex = canvasTex(256, 256, (c, w, h) => {
      c.fillStyle = th.road; c.fillRect(0, 0, w, h);
      noise(c, w, h, 5000, 0.08);
      // worn tire tracks and cracks
      c.fillStyle = 'rgba(0,0,0,0.12)';
      c.fillRect(w * 0.28, 0, 14, h); c.fillRect(w * 0.64, 0, 14, h);
      c.strokeStyle = 'rgba(0,0,0,0.25)'; c.lineWidth = 1;
      for (let i = 0; i < 6; i++) {
        let x = 30 + Math.random() * (w - 60), y = Math.random() * h;
        c.beginPath(); c.moveTo(x, y);
        for (let k = 0; k < 4; k++) { x += (Math.random() - 0.5) * 18; y += 6 + Math.random() * 10; c.lineTo(x, y); }
        c.stroke();
      }
      c.fillStyle = '#f2f2f2';
      c.fillRect(6, 0, 6, h); c.fillRect(w - 12, 0, 6, h);
      c.fillStyle = '#e8d34a';
      c.fillRect(w / 2 - 3, 0, 6, h * 0.5);
    });
    const road = this._strip(-HALF_WIDTH, HALF_WIDTH, 0, 0,
      new THREE.MeshLambertMaterial({ map: roadTex }), 16);
    this.group.add(road);

    const curbTex = canvasTex(64, 64, (c, w, h) => {
      c.fillStyle = th.curbA; c.fillRect(0, 0, w, h / 2);
      c.fillStyle = th.curbB; c.fillRect(0, h / 2, w, h / 2);
    });
    const curbMat = new THREE.MeshLambertMaterial({ map: curbTex });
    this.group.add(this._strip(-HALF_WIDTH - 1.5, -HALF_WIDTH, 0.05, 0.05, curbMat, 4));
    this.group.add(this._strip(HALF_WIDTH, HALF_WIDTH + 1.5, 0.05, 0.05, curbMat, 4));

    const grassTex = canvasTex(256, 256, (c, w, h) => {
      c.fillStyle = th.grass; c.fillRect(0, 0, w, h);
      noise(c, w, h, 6000, 0.12);
      // N64-style blotchy patches and tufts (wrapped so the tile repeats seamlessly)
      for (let i = 0; i < 70; i++) {
        const x = Math.random() * w, y = Math.random() * h, r = 6 + Math.random() * 16;
        c.fillStyle = Math.random() < 0.5 ? 'rgba(0,0,0,0.10)' : 'rgba(255,255,255,0.07)';
        for (const dx of [-w, 0, w]) for (const dy of [-h, 0, h]) {
          c.beginPath(); c.ellipse(x + dx, y + dy, r, r * 0.7, 0, 0, 7); c.fill();
        }
      }
      for (let i = 0; i < 700; i++) {
        const x = Math.random() * w, y = Math.random() * h;
        c.fillStyle = Math.random() < 0.5 ? 'rgba(0,0,0,0.22)' : 'rgba(255,255,255,0.14)';
        c.fillRect(x, y, 1, 3);
      }
    });
    const grassMat = new THREE.MeshLambertMaterial({ map: grassTex });
    this.group.add(this._strip(-WALL_D, -HALF_WIDTH - 1.5, -0.05, -0.05, grassMat, 12));
    this.group.add(this._strip(HALF_WIDTH + 1.5, WALL_D, -0.05, -0.05, grassMat, 12));

    // sloped terrain skirt falling away outside the walls
    const skirtMat = new THREE.MeshLambertMaterial({ map: grassTex, side: THREE.DoubleSide });
    this.skirtDrop = 10; this.skirtOut = 80;
    for (const side of [-1, 1]) {
      const n = this.n, pos = [], uv = [], idx = [];
      for (let i = 0; i <= n; i++) {
        const k = i % n, p = this.pos[k], R = this.R[k];
        const hr = new THREE.Vector3(R.x, 0, R.z).normalize();
        const a = p.clone().addScaledVector(R, side * WALL_D).addScaledVector(this.U[k], -0.1);
        const b = p.clone().addScaledVector(hr, side * this.skirtOut); b.y = this.minY - this.skirtDrop - 4;
        pos.push(a.x, a.y, a.z, b.x, b.y, b.z);
        const v = i * this.ds / 12;
        uv.push(0, v, 4, v);
        if (i < n) { const o = i * 2; idx.push(o, o + 2, o + 1, o + 1, o + 2, o + 3); }
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
      g.setIndex(idx); g.computeVertexNormals();
      this.group.add(new THREE.Mesh(g, skirtMat));
    }

    // guard walls
    const wallTex = canvasTex(128, 64, (c, w, h) => {
      c.fillStyle = th.wallA; c.fillRect(0, 0, w, h);
      c.fillStyle = th.wallB; c.fillRect(0, 0, w / 2, h);
    }, 1, 1);
    const wallMat = new THREE.MeshLambertMaterial({ map: wallTex, side: THREE.DoubleSide });
    for (const side of [-1, 1]) {
      this.group.add(this._strip(side * WALL_D, side * WALL_D, 0, 1.6, wallMat, 8));
    }

    // far ground
    const gp = new THREE.Mesh(new THREE.PlaneGeometry(4000, 4000),
      new THREE.MeshLambertMaterial({ map: grassTex.clone() }));
    gp.material.map.repeat.set(300, 300); gp.material.map.needsUpdate = true;
    gp.rotation.x = -Math.PI / 2;
    gp.position.set(0, this.minY - this.skirtDrop - 4.5, -150);
    this.group.add(gp);

    // start/finish line
    const f = this.frameAt(0, { pos: new THREE.Vector3(), T: new THREE.Vector3(), U: new THREE.Vector3(), R: new THREE.Vector3() });
    const lineTex = canvasTex(128, 32, (c, w, h) => {
      for (let x = 0; x < 16; x++) for (let y = 0; y < 4; y++) {
        c.fillStyle = (x + y) % 2 ? '#111' : '#fff'; c.fillRect(x * 8, y * 8, 8, 8);
      }
    });
    const line = new THREE.Mesh(new THREE.PlaneGeometry(HALF_WIDTH * 2, 3),
      new THREE.MeshBasicMaterial({ map: lineTex }));
    const m = new THREE.Matrix4().makeBasis(f.R, f.T, f.U);
    line.quaternion.setFromRotationMatrix(m);
    line.position.copy(f.pos).addScaledVector(f.U, 0.08);
    this.group.add(line);
    const gantry = new THREE.Mesh(new THREE.BoxGeometry(HALF_WIDTH * 2 + 4, 1.4, 1),
      new THREE.MeshLambertMaterial({ map: lineTex }));
    gantry.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(f.R, f.U, f.T));
    gantry.position.copy(f.pos).addScaledVector(f.U, 9);
    this.group.add(gantry);
    for (const side of [-1, 1]) {
      const pole = new THREE.Mesh(new THREE.BoxGeometry(1, 9, 1), new THREE.MeshLambertMaterial({ color: 0xcccccc }));
      pole.position.copy(f.pos).addScaledVector(f.R, side * (HALF_WIDTH + 2)).addScaledVector(f.U, 4.5);
      this.group.add(pole);
    }

    // boost pads
    this.boostPads = [];
    const padTex = canvasTex(64, 128, (c, w, h) => {
      c.fillStyle = '#ff9d00'; c.fillRect(0, 0, w, h);
      c.fillStyle = '#fff3a0';
      for (let k = 0; k < 3; k++) {
        const y = 14 + k * 38;
        c.beginPath(); c.moveTo(w / 2, y); c.lineTo(w - 8, y + 28); c.lineTo(w - 22, y + 28);
        c.lineTo(w / 2, y + 10); c.lineTo(22, y + 28); c.lineTo(8, y + 28); c.closePath(); c.fill();
      }
    });
    const padMat = new THREE.MeshBasicMaterial({ map: padTex });
    const padSpots = this.def.padSpots;
    for (const [u, d] of padSpots) {
      const s = u * this.length;
      const fr = this.frameAt(s, { pos: new THREE.Vector3(), T: new THREE.Vector3(), U: new THREE.Vector3(), R: new THREE.Vector3() });
      const pad = new THREE.Mesh(new THREE.PlaneGeometry(5, 9), padMat);
      pad.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(fr.R, fr.T, fr.U));
      pad.position.copy(fr.pos).addScaledVector(fr.R, d).addScaledVector(fr.U, 0.1);
      this.group.add(pad);
      this.boostPads.push({ s, d, hw: 2.5, hl: 4.5 });
    }

    // trees on the skirt: pixel-art billboard sprites (always face the camera)
    const treeTex = pixelTreeTexture(th);
    const treeMat = new THREE.SpriteMaterial({ map: treeTex, alphaTest: 0.5 });
    const rng = mulberry(7);
    for (let i = 0; i < th.trees; i++) {
      const k = Math.floor(rng() * this.n), side = rng() < 0.5 ? -1 : 1;
      const out = WALL_D + 5 + rng() * 45;
      const p = this.pos[k], R = this.R[k];
      const hr = new THREE.Vector3(R.x, 0, R.z).normalize();
      const x = p.x + hr.x * side * out, z = p.z + hr.z * side * out;
      const t = (out - WALL_D) / (this.skirtOut - WALL_D);
      const yy = p.y + (this.minY - this.skirtDrop - 4 - p.y) * t - 0.1 * (1 - t);
      const sc = 0.8 + rng() * 0.9;
      const sp = new THREE.Sprite(treeMat);
      sp.center.set(0.5, 0);
      sp.scale.set(8 * sc, 12 * sc, 1);
      sp.position.set(x, yy, z);
      this.group.add(sp);
    }
  }
}

function pixelTreeTexture(th) {
  const W = 32, H = 48;
  const c = document.createElement('canvas'); c.width = W; c.height = H;
  const g = c.getContext('2d');
  const hex = (n) => '#' + n.toString(16).padStart(6, '0');
  const shade = (n, f) => `rgb(${Math.min(255, (n >> 16 & 255) * f) | 0},${Math.min(255, (n >> 8 & 255) * f) | 0},${Math.min(255, (n & 255) * f) | 0})`;
  g.fillStyle = hex(th.trunk); g.fillRect(14, 38, 4, 10);
  g.fillStyle = shade(th.trunk, 0.7); g.fillRect(16, 38, 2, 10);
  // three stacked tiers of pixel foliage, lit from the left
  for (const [top, wid] of [[2, 12], [12, 20], [24, 28]]) {
    const hgt = 16;
    for (let y = 0; y < hgt; y++) {
      const w = Math.max(2, Math.round(wid * (y + 1) / hgt));
      const x0 = 16 - (w >> 1);
      for (let x = 0; x < w; x++) {
        const f = x < w * 0.35 ? 1.25 : x > w * 0.7 ? 0.7 : 1.0;
        const dither = ((x + y) & 1) && f !== 1.0 ? 0.92 : 1;
        g.fillStyle = shade(th.leaf, f * dither);
        g.fillRect(x0 + x, top + y, 1, 1);
      }
    }
    if (th.snowCap) {
      g.fillStyle = '#f4f8ff';
      for (let y = 0; y < 5; y++) { const w = Math.max(2, Math.round(wid * (y + 1) / hgt)); g.fillRect(16 - (w >> 1), top + y, w, 1); }
    }
  }
  const t = new THREE.CanvasTexture(c);
  t.magFilter = THREE.NearestFilter; t.minFilter = THREE.NearestFilter; t.generateMipmaps = false;
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function mulberry(a) {
  return () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
}
