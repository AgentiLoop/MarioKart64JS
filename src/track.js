import * as THREE from 'three';

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
  def.control = def.native.path.map(p => p.slice(0, 3).map(v => v * NATIVE_SCALE));
  return def;
}

// Track defined as a closed 3D spline (x, y=elevation, z). Banking is derived
// automatically from horizontal curvature so hills, dips and camber all fall out
// of the control points.
export const TRACKS = [
  ...NATIVE_COURSES.map(([id, dir, name]) => ({
    id, name, dir, blurb: 'Native MK64 geometry and ROM textures. Static scenery; prototype physics.',
    native: null, control: null, padSpots: [],
    theme: { skyTop: 0x508cff, skyBot: 0xd8e8f8, hemiSky: 0xffffff, hemiGround: 0xffffff, sun: 0xffffff },
  })),
  {
    id: 'meadow', name: 'Meadow Circuit', blurb: 'Rolling green hills, gentle banking. Good for learning.',
    control: [
      [0, 0, 0], [100, 0, 10], [200, 4, -20], [290, 14, -80], [330, 26, -170],
      [300, 30, -260], [220, 22, -320], [130, 8, -340], [40, 0, -310],
      [-30, -6, -250], [-120, -8, -230], [-210, 0, -250], [-290, 12, -200],
      [-320, 20, -110], [-280, 12, -30], [-190, 4, 20], [-100, 0, 30],
    ],
    padSpots: [[0.12, 0], [0.33, -4], [0.33, 4], [0.58, 0], [0.82, -5], [0.82, 5]],
    theme: {
      road: '#3b3d44', grass: '#3f8f3a', curbA: '#d8222b', curbB: '#fafafa', wallA: '#e9e9ee', wallB: '#2a63c8',
      skyTop: 0x3b8ee8, skyBot: 0xbfe3ff, hemiSky: 0xdff0ff, hemiGround: 0x4a6b3a, sun: 0xfff2d6,
      trunk: 0x6b4423, leaf: 0x1f6b2d, snowCap: false, trees: 380,
    },
  },
  {
    id: 'frost', name: 'Frost Ridge', blurb: 'Long climb to a snowy summit, then a fast plunge. Sweeping bends.',
    control: [
      [0, 0, 0], [120, 0, -15], [240, -6, -60], [320, -14, -150], [320, -8, -250],
      [250, 6, -330], [150, 22, -360], [60, 34, -410], [-30, 44, -450], [-140, 46, -430],
      [-235, 38, -360], [-275, 24, -260], [-285, 10, -150], [-235, 2, -60], [-130, 0, -10],
    ],
    padSpots: [[0.08, 0], [0.30, -4], [0.30, 4], [0.52, 0], [0.74, -5], [0.74, 5], [0.92, 0]],
    theme: {
      road: '#454a58', grass: '#e8f1fa', curbA: '#2a63c8', curbB: '#fafafa', wallA: '#cfe3f5', wallB: '#e0482f',
      skyTop: 0x5a7fb5, skyBot: 0xdce8f4, hemiSky: 0xe8f1ff, hemiGround: 0x8fa0b8, sun: 0xfff8ec,
      trunk: 0x4a3322, leaf: 0x2c6b52, snowCap: true, trees: 300,
    },
  },
  {
    id: 'dunes', name: 'Sunset Dunes', blurb: 'Hot desert sprint with tight hairpins and rolling dune jumps.',
    control: [
      [0, 0, 0], [110, 2, 20], [210, 8, 10], [290, 14, -40], [310, 10, -120],
      [260, 4, -180], [180, 0, -200], [120, 6, -250], [130, 16, -330], [200, 22, -390],
      [120, 20, -450], [10, 12, -430], [-70, 6, -370], [-60, 0, -290], [-150, -4, -250],
      [-250, 2, -270], [-320, 10, -210], [-300, 8, -110], [-220, 2, -50], [-110, 0, -20],
    ],
    padSpots: [[0.10, 0], [0.28, -4], [0.28, 4], [0.47, 0], [0.66, -5], [0.66, 5], [0.88, 0]],
    theme: {
      road: '#4a443f', grass: '#d9a55b', curbA: '#e8731c', curbB: '#fff1d6', wallA: '#f0d9a8', wallB: '#b8452a',
      skyTop: 0xe0703a, skyBot: 0xffd9a0, hemiSky: 0xffe2b8, hemiGround: 0xa87a40, sun: 0xffc27a,
      trunk: 0x5a3a1c, leaf: 0x4f7a2a, snowCap: false, trees: 90,
    },
  },
  {
    id: 'moonlit', name: 'Moonlit Raceway', blurb: 'Night circuit under a purple sky. Wide sweepers and a tight S-bend.',
    control: [
      [0, 0, 0], [120, 0, 0], [230, 0, -30], [300, 4, -100], [310, 8, -200],
      [260, 12, -280], [170, 14, -320], [110, 10, -380], [20, 6, -400], [-70, 2, -370],
      [-110, -2, -300], [-200, -4, -270], [-280, 0, -210], [-290, 4, -120], [-230, 2, -50], [-130, 0, -20],
    ],
    padSpots: [[0.10, 0], [0.30, -4], [0.30, 4], [0.50, 0], [0.70, -5], [0.70, 5], [0.90, 0]],
    theme: {
      road: '#2e2f3a', grass: '#2a3f5c', curbA: '#e23fd0', curbB: '#e8f4ff', wallA: '#8a7fd0', wallB: '#2a2160',
      skyTop: 0x0b0a2e, skyBot: 0x4a3a8c, hemiSky: 0x8a8cff, hemiGround: 0x1b2540, sun: 0xb8c4ff,
      trunk: 0x2b1d33, leaf: 0x2a5a58, snowCap: false, trees: 240,
    },
  },
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

export class Track {
  constructor(def = TRACKS[0]) {
    this.def = def; this.theme = def.theme;
    const pts = def.control.map(p => new THREE.Vector3(...p));
    this.curve = new THREE.CatmullRomCurve3(pts, true, 'centripetal');
    if (def.native) this.curve.arcLengthDivisions = pts.length * 8;
    this.length = this.curve.getLength();
    this.n = SAMPLES;
    this.ds = this.length / SAMPLES;
    this.pos = []; this.T = []; this.U = []; this.R = []; this.kU = [];
    this._build();
    this.group = new THREE.Group();
    if (def.native) this._buildNativeMeshes();
    else this._buildMeshes();
  }

  _build() {
    const n = this.n;
    for (let i = 0; i < n; i++) {
      this.pos.push(this.curve.getPointAt(i / n));
      this.T.push(this.curve.getTangentAt(i / n).normalize());
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
    const loader = new THREE.TextureLoader();
    const wrap = { repeat: THREE.RepeatWrapping, mirror: THREE.MirroredRepeatWrapping, clamp: THREE.ClampToEdgeWrapping };
    const color = new THREE.Color();
    this.boostPads = [];
    this.textures = [];
    for (const batch of course.batches) {
      const positions = [], colors = [], uvs = [];
      const [u0, v0] = batch.tileOrigin ?? [0, 0];   // gsDPSetTileSize upper-left, in texels
      for (const index of batch.indices) {
        const [x, y, z, s, t, r, g, b] = course.vertices[index];
        positions.push(x * NATIVE_SCALE, y * NATIVE_SCALE, z * NATIVE_SCALE);
        color.setRGB(r / 255, g / 255, b / 255, THREE.SRGBColorSpace);
        colors.push(color.r, color.g, color.b);
        uvs.push((s / 32 - u0) / batch.width, (t / 32 - v0) / batch.height);   // S10.5 texels; PNG rows stay top-down
      }
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
      geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
      geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
      let map = null;
      if (batch.texture) {
        map = loader.load(`${import.meta.env?.BASE_URL ?? '/'}mk64/${this.def.dir}/${course.textures[batch.texture].image}`);
        map.colorSpace = THREE.SRGBColorSpace;
        map.flipY = false;
        map.wrapS = wrap[batch.wrapS]; map.wrapT = wrap[batch.wrapT];
        map.magFilter = map.minFilter = THREE.NearestFilter;
        map.generateMipmaps = false;
        this.textures.push(map);
      }
      const mesh = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({
        map, vertexColors: true, side: THREE.DoubleSide, toneMapped: false, fog: false,
        alphaTest: batch.alphaTest ? 0.5 : 0,   // G_RM_AA_ZB_TEX_EDGE lists
        // G_RM_AA_ZB_XLU_* lists blend by texture alpha (course vertex alpha is always 0 in the ROM)
        transparent: !!batch.translucent, depthWrite: !batch.translucent,
      }));
      if (batch.translucent) mesh.renderOrder = 1;
      mesh.name = batch.texture || 'shade';
      this.group.add(mesh);
    }
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
