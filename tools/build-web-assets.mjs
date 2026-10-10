// Second half of `npm run build:web`: copy the ROM assets (public/mk64), the HD tiers (public/mk64-hd: 2x, 4x and
// the manifest), the Wii 3D karts / Lakitu (public/wii) and the 3D title's still (public/title3d) into
// website/public/play, so the hosted game has the same resolutions and 3D mode as the desktop apps.
import { cpSync, readFileSync, rmSync } from 'node:fs';

const out = new URL('../website/public/play/', import.meta.url);
const pub = new URL('../public/', import.meta.url);
// Skip submodule .git files so they aren't deployed.
const filter = (src) => !/[\\/]\.git$/.test(src);
for (const dir of ['mk64', 'mk64-hd', 'wii', 'title3d']) {
  rmSync(new URL(dir, out), { recursive: true, force: true });
  cpSync(new URL(dir, pub), new URL(dir, out), { recursive: true, filter });
}
const m = JSON.parse(readFileSync(new URL('mk64-hd/manifest.json', pub), 'utf8'));
console.log(`${Object.keys(m.files).length} HD textures (tiers ${m.tiers}) + public/mk64, wii, title3d -> website/public/play`);
