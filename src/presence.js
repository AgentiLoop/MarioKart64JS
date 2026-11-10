// Single-player games report in to the lobby server, which keeps the play statistics shown on
// mk64js.gokart.games/stats (website/src/stats.js). Online races need no report: the lobby counts its own rooms.
// A report is a small POST every BEAT while the tab is visible, {id, n, mode, course, cc, char}: id is a random id
// made for this page load (it says nothing about the player or the machine) and n counts the reports. A hidden
// tab stops reporting (the game is paused there) and the server forgets a game 75 s after its last report;
// leaving the page says bye. A text/plain no-cors POST is a "simple" request, so the desktop apps and other
// origins reach the server without a CORS preflight.
import { DEFAULT_LOBBY } from './net.js';

const BEAT = 30000;
let started = false;

export function startPresence(info) {
  // vite dev (and the autopilot tests that run on it) stays out of the statistics unless a lobby is named with ?lobby=
  const lobby = new URLSearchParams(location.search).get('lobby') || sessionStorage.getItem('mk64lobby');
  if (started || (import.meta.env?.DEV && !lobby)) return;
  started = true;
  const url = (lobby || DEFAULT_LOBBY).replace(/^ws/, 'http').replace(/\/mp$/, '/presence');
  const id = Array.from(crypto.getRandomValues(new Uint8Array(12)), b => b.toString(36).padStart(2, '0')).join('');
  let n = 0;
  const beat = () => {
    if (document.hidden) return;
    fetch(url, { method: 'POST', mode: 'no-cors', keepalive: true, body: JSON.stringify({ id, n, ...info }) }).then(() => { n++; }, () => {});
  };
  beat();
  setInterval(beat, BEAT);
  document.addEventListener('visibilitychange', beat);
  addEventListener('pagehide', () => navigator.sendBeacon?.(url, JSON.stringify({ id, bye: 1 })));
}
