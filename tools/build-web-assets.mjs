// Second half of `npm run build:web`: copy the ROM assets (public/mk64) and the 2x HD tier (public/mk64-hd/2x)
// into website/public/play, with a manifest that only knows about the 2x tier (the 4x tier stays offline).
import { cpSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';

const out = new URL('../website/public/play/', import.meta.url);
const pub = new URL('../public/', import.meta.url);
rmSync(new URL('mk64', out), { recursive: true, force: true });
rmSync(new URL('mk64-hd', out), { recursive: true, force: true });
cpSync(new URL('mk64', pub), new URL('mk64', out), { recursive: true });
mkdirSync(new URL('mk64-hd', out), { recursive: true });
cpSync(new URL('mk64-hd/2x', pub), new URL('mk64-hd/2x', out), { recursive: true });
const m = JSON.parse(readFileSync(new URL('mk64-hd/manifest.json', pub), 'utf8'));
m.tiers = [2];
for (const k of Object.keys(m.files)) m.files[k] = Math.min(m.files[k], 2);
writeFileSync(new URL('mk64-hd/manifest.json', out), JSON.stringify(m, null, 1) + '\n');
console.log(`${Object.keys(m.files).length} 2x textures + public/mk64 -> website/public/play`);
