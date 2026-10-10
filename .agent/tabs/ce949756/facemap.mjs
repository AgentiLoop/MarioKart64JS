// face map: '#' where a kart body (hw) at lane d is pushed by a steep face (the CPU lane probe's test); '|' wall limits
import fs from 'fs';
globalThis.Image = class { set src(v) {} };
globalThis.localStorage = { getItem: () => null, setItem() {} };
globalThis.fetch = async u => { const p = process.cwd() + '/public' + u.replace(/^\//, '/'); return { ok: true, json: async () => JSON.parse(fs.readFileSync(p)) }; };
const THREE = await import('three');
const { Track, TRACKS, loadNativeCourse } = await import(process.cwd() + '/src/track.js');
const [id, s0, s1, st = 2, dmin = -14, dmax = 14, hw = 1.4] = process.argv.slice(2).map((v, i) => i ? +v : v);
const t = new Track(await loadNativeCourse(TRACKS.find(d => d.id === id)));
const fr = { pos: new THREE.Vector3(), T: new THREE.Vector3(), U: new THREE.Vector3(), R: new THREE.Vector3(), k: 0 };
let hdr = '                      '; for (let d = dmin; d <= dmax; d++) hdr += d % 5 === 0 ? String(d).padEnd(1).slice(-1) : ' '; console.log(hdr);
for (let s = s0; s <= s1; s += st) {
  t.frameAt(s, fr); const wl = t.wallAt(s, -1), wr = t.wallAt(s, 1);
  let row = `s${String(s).padEnd(5)}(${fr.pos.x.toFixed(0)},${fr.pos.z.toFixed(0)})`.padEnd(22);
  for (let d = dmin; d <= dmax; d++) {
    if (d < -wl || d > wr) { row += '|'; continue; }
    const x = fr.pos.x + fr.R.x * d, z = fr.pos.z + fr.R.z * d, g = t.groundAt(x, z, fr.pos.y + 2);
    row += t.wallPush(x, z, x, z, g ? g.y : fr.pos.y, hw) ? '#' : (g && g.y > fr.pos.y + 0.6 ? '^' : '.');
  }
  console.log(row + ` wL${wl.toFixed(1)} wR${wr.toFixed(1)}`);
}
