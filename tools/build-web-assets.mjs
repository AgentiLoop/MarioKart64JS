// Second half of `npm run build:web`: copy the ROM assets (public/mk64) and the HD tiers (public/mk64-hd: 2x, 4x and
// the manifest) into website/public/play, so the hosted game has the same resolutions as the desktop apps.
import { cpSync, readFileSync, rmSync } from 'node:fs';

const out = new URL('../website/public/play/', import.meta.url);
const pub = new URL('../public/', import.meta.url);
rmSync(new URL('mk64', out), { recursive: true, force: true });
rmSync(new URL('mk64-hd', out), { recursive: true, force: true });
// Skip submodule .git files so they aren't deployed.
const filter = (src) => !/[\\/]\.git$/.test(src);
cpSync(new URL('mk64', pub), new URL('mk64', out), { recursive: true, filter });
cpSync(new URL('mk64-hd', pub), new URL('mk64-hd', out), { recursive: true, filter });
const m = JSON.parse(readFileSync(new URL('mk64-hd/manifest.json', pub), 'utf8'));
console.log(`${Object.keys(m.files).length} HD textures (tiers ${m.tiers}) + public/mk64 -> website/public/play`);
