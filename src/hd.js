// Resolution presets + HD texture tiers.
// G cycles 1x (N64 textures, 480 lines) / 2x (480p, Wii VC) / 4x (960p) / Native (window x devicePixelRatio).
// Every image under public/mk64 may have 2x/4x versions in public/mk64-hd/<N>x/ (built from the
// MK64 Reloaded pack by tools/build-hd-textures.py); the tier follows the preset (native picks
// 2x below 720 lines, else 4x) and falls back to the highest tier that exists, or the ROM image.
// 1x keeps hard N64 pixels; HD tiers use smooth filtering with mipmaps + anisotropy.
// The hosted build (vite --mode web, see vite.config.js) ships every tier too: same presets as the desktop apps.
import * as THREE from 'three';

const BASE = import.meta.env?.BASE_URL ?? '/';
export const PRESETS = [
  { id: '1x', label: '1× N64 480p', lines: 480 },   // N64 textures + hard pixels, at half the pixel size of true 240p
  { id: '2x', label: '2× 480p', lines: 480 },
  { id: '4x', label: '4× 960p', lines: 960 },
  { id: 'native', label: 'Native', lines: 0 },
];
let preset = Math.max(0, PRESETS.findIndex(p => p.id === globalThis.localStorage?.getItem('mk64res')));   // no storage under node tests
let files = {};            // 'mario-raceway/gMRTextureRoad0.png' -> highest tier built
let maxAniso = 1;
const textures = new Set();
const listeners = [];

export const presetLabel = () => PRESETS[preset].label;
export const presetId = () => PRESETS[preset].id;
export const renderLines = () => PRESETS[preset].lines || Math.round(innerHeight * devicePixelRatio);
export const tier = () => { if (preset === 0) return 1; const t = Math.round(renderLines() / 240); return t <= 1 ? 1 : t === 2 ? 2 : 4; };
export const smooth = () => tier() > 1;
export function onChange(fn) { listeners.push(fn); }
export function setRenderer(renderer) { maxAniso = renderer.capabilities.getMaxAnisotropy(); textures.forEach(applyFilter); }

export function cyclePreset() {
  preset = (preset + 1) % PRESETS.length;
  localStorage.setItem('mk64res', PRESETS[preset].id);
  refresh();
}

// URL + scale for a public/mk64-relative image at the current tier.
export function hdSource(rel) {
  const t = Math.min(tier(), files[rel] || 1);
  return { url: t > 1 ? `${BASE}mk64-hd/${t}x/${rel}` : `${BASE}mk64/${rel}`, scale: t };
}

// THREE.Texture that swaps its image when the tier changes. onLoad(texture, scale) runs after
// every (re)load; scale = image size / native size. Linear filtering in retro (1x) via retroFilter.
// '<course>/common/x.png' -> 'common/x.png': images a course JSON names as common/... are shared
// across courses and live in public/mk64/common/ (tools/dedupe-textures.py).
export function loadTexture(rel, { mipmaps = true, retroFilter = THREE.NearestFilter, onLoad } = {}) {
  rel = rel.replace(/^[^/]+\/(?=common\/)/, '');
  const tex = new THREE.Texture();
  tex.userData.hd = { rel, mipmaps, retroFilter, onLoad, url: null, scale: 1 };
  textures.add(tex);
  tex.addEventListener('dispose', () => textures.delete(tex));
  applyFilter(tex);
  loadImage(tex);
  return tex;
}

function loadImage(tex) {
  const hd = tex.userData.hd, { url, scale } = hdSource(hd.rel);
  if (url === hd.url) return;
  hd.url = url;
  const img = new Image();
  img.onload = () => {
    if (hd.url !== url) return;   // tier changed again while loading
    // New size: drop the GL texture so three reallocates it (2x -> 4x keeps the same filters,
    // so three would texSubImage2D into the old, smaller storage and fail).
    if (tex.image && (tex.image.width !== img.width || tex.image.height !== img.height)) { tex.dispose(); textures.add(tex); }
    tex.image = img; hd.scale = scale;
    tex.needsUpdate = true;
    hd.onLoad?.(tex, scale);
  };
  img.src = url;
}

function applyFilter(tex) {
  const hd = tex.userData.hd, on = smooth();
  tex.magFilter = on || preset === 0 ? THREE.LinearFilter : hd.retroFilter;   // 1x: bilinear magnification like the N64, so close-up texels don't turn into big blocks
  tex.minFilter = on ? (hd.mipmaps ? THREE.LinearMipmapLinearFilter : THREE.LinearFilter) : hd.retroFilter;
  tex.generateMipmaps = on && hd.mipmaps;
  tex.anisotropy = on && hd.mipmaps ? maxAniso : 1;
  if (tex.image) tex.needsUpdate = true;
}

// <img data-hd="menu/logo.png">: CSS fixes the on-screen size, so only the source changes.
export function setImg(img, rel) { img.dataset.hd = rel; img.src = hdSource(rel).url; }

function refresh() {
  for (const tex of textures) { applyFilter(tex); loadImage(tex); }
  for (const img of document.querySelectorAll('img[data-hd]')) img.src = hdSource(img.dataset.hd).url;
  document.documentElement.classList.toggle('hd', smooth());
  listeners.forEach(fn => fn());
}

const browser = typeof document !== 'undefined';   // tools/test-*.mjs import track.js under node
export const ready = browser && fetch(`${BASE}mk64-hd/manifest.json`, { cache: 'no-cache' })
  .then(r => (r.ok ? r.json() : {}))
  .catch(() => ({}))
  .then(m => { files = m.files || {}; refresh(); });
if (browser) {
  document.documentElement.classList.toggle('hd', smooth());
  addEventListener('resize', () => { if (PRESETS[preset].lines === 0) refresh(); });
}
