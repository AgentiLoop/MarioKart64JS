import * as THREE from 'three';
import { TRACKS, Track, loadNativeCourse } from '../src/track.js';
import { Kart } from '../src/kart.js';

export const def = id => TRACKS.find(t => t.id === id);

// a fresh copy of a TRACKS entry with its native course data loaded
export async function loadDef(id) {
  const d = { ...def(id), native: null, control: null };
  return loadNativeCourse(d);
}

export async function makeTrack(id, opts) {
  return new Track(await loadDef(id), opts);
}

export function makeKart(track, o = {}) {
  return new Kart(track, { color: 0xff0000, s: 20, d: 0, ...o });
}

export const idle = { throttle: 0, brake: 0, steer: 0, drift: false };
export const gas = { throttle: 1, brake: 0, steer: 0, drift: false };

export function run(kart, seconds, input, dt = 1 / 60, karts = [kart]) {
  for (let t = 0; t < seconds; t += dt) kart.update(dt, typeof input === 'function' ? input(t) : input, karts);
}

export const flush = () => new Promise(r => setTimeout(r, 0));
export { THREE };
