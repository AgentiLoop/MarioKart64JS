// /stats: polls /api/stats (website/src/stats.js) and draws it. Everything goes in with textContent.
const REFRESH = 10000;
const KINDS = [['solo', 'Single-player games'], ['waiting', 'Waiting to play online'], ['racing', 'Racing online']];
const $ = id => document.getElementById(id);
const el = (tag, text, cls) => { const e = document.createElement(tag); if (text != null) e.textContent = text; if (cls) e.className = cls; return e; };
const dur = s => s < 60 ? `${s} s` : s < 3600 ? `${Math.floor(s / 60)} min` : `${Math.floor(s / 3600)} h ${Math.floor(s % 3600 / 60)} min`;
const when = t => new Date(t).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
const hour = h => new Date(h * 3600000).toLocaleTimeString([], { hour: 'numeric' });
const drivers = r => r.players.map(p => p.driver).join(', ');
const oldest = r => Math.max(0, ...r.players.map(p => p.secs));

// heads: a label, or [label] for a right-aligned number column. rows: arrays of cell text; total: an optional last row.
function table(id, heads, rows, empty, total) {
  const host = $(id);
  if (!rows.length) { host.replaceChildren(el('p', empty, 'none')); return; }
  const num = heads.map(Array.isArray), t = el('table'), head = el('tr');
  heads.forEach((h, i) => head.append(el('th', num[i] ? h[0] : h, num[i] ? 'num' : '')));
  t.append(head);
  const add = (cells, cls) => { const tr = el('tr', null, cls); cells.forEach((c, i) => tr.append(el('td', String(c), num[i] ? 'num' : ''))); t.append(tr); };
  rows.forEach(r => add(r));
  if (total) add(total, 'total');
  host.replaceChildren(t);
}

function chart(d, kind, label) {
  const hNow = Math.floor(d.now / 3600000), by = new Map(d.hours.map(r => [r.h, r]));
  const cols = [];
  for (let h = hNow - 47; h <= hNow; h++) cols.push({ h, avg: by.get(h)?.[kind] ?? 0, peak: by.get(h)?.[`${kind}Peak`] ?? 0 });
  const top = Math.max(1, ...cols.map(c => c.peak));
  const box = el('div', null, `chart k-${kind}`), head = el('div', null, 'chart-head'), bars = el('div', null, 'bars'), axis = el('div', null, 'axis');
  head.append(el('span', label), el('span', `scale 0 to ${top}`));
  for (const c of cols) {
    const bar = el('div', null, 'bar'), pk = el('i', null, 'pk'), av = el('i');
    pk.style.height = `${c.peak / top * 100}%`;
    av.style.height = `${c.avg / top * 100}%`;
    bar.title = `${when(c.h * 3600000)}: average ${c.avg}, most at once ${c.peak}`;
    bar.append(pk, av);
    bars.append(bar);
    axis.append(el('span', new Date(c.h * 3600000).getHours() % 6 === 0 ? hour(c.h) : ''));
  }
  box.append(head, bars, axis);
  return box;
}

function draw(d) {
  const live = d.live;
  $('nSolo').textContent = live.solo.count;
  $('nWaiting').textContent = live.waiting.count;
  $('nRacing').textContent = live.racing.count;
  $('updated').textContent = `Updated ${new Date(d.now).toLocaleTimeString()}. Refreshes every ${REFRESH / 1000} seconds.`;

  table('waiting', ['Cup', 'Course', 'Mode', 'Players', 'Who', 'Waiting for', 'Starts in'],
    live.waiting.rooms.map(r => [r.cup, r.name, r.mode, `${r.players.length} of ${r.max}`, drivers(r), dur(oldest(r)), r.players.length >= 2 ? `${r.countdown} s` : 'needs another player']),
    'Nobody is waiting right now.');
  table('racing', ['Cup', 'Course', 'Mode', ['Players'], 'Who', 'Racing for'],
    live.racing.rooms.map(r => [r.cup, r.name, r.mode, r.players.length, drivers(r), dur(r.secs)]),
    'No online race is running right now.');
  table('solo', ['Driver', 'Cup', 'Course', 'Mode', 'Class', 'Running for'],
    live.solo.games.map(g => [g.driver, g.cup, g.name, g.mode, g.cc || '–', dur(g.secs)]),
    'No single-player game is running right now.',
    live.solo.count > live.solo.games.length ? [`and ${live.solo.count - live.solo.games.length} more`, '', '', '', '', ''] : null);

  table('peaks', ['', ['Now'], ['Most at once, last 24 hours'], ['Most at once, all time'], 'Reached'],
    KINDS.map(([k, label]) => [label, live[k].count, d.peaks.day[k], d.peaks.all[k].n, d.peaks.all[k].n ? when(d.peaks.all[k].t) : '–']), '');

  $('charts').replaceChildren(...KINDS.map(([k, label]) => chart(d, k, label)));

  const sum = (f) => d.courses.reduce((a, c) => a + f(c), 0);
  table('courses', ['Cup', 'Course', ['Single-player games'], ['Minutes played'], ['Most at once'], ['Online players raced'], ['Minutes raced'], ['Most at once']],
    d.courses.map(c => [c.cup, c.name, c.solo.starts, c.solo.minutes, c.solo.peak, c.online.starts, c.online.minutes, c.online.peak]), '',
    ['All courses', '', sum(c => c.solo.starts), sum(c => c.solo.minutes), '', sum(c => c.online.starts), sum(c => c.online.minutes), '']);

  const l = d.lobby;
  $('lobbySum').textContent = l.visits
    ? `Of the last ${l.visits} ${l.visits === 1 ? 'player' : 'players'} who waited, ${l.raced} got a race (${Math.round(l.raced / l.visits * 100)}%). The average wait was ${dur(l.wait)}. The newest ${l.recent.length} are listed.`
    : '';
  table('lobby', ['When', 'Driver', 'Cup', 'Course', 'Mode', 'Room', 'Waited', 'Outcome'],
    l.recent.map(r => [when(r.t), r.driver, r.cup, r.name, r.mode, `${r.size} of ${r.max} players`, dur(r.waited), r.outcome === 'raced' ? 'Raced' : 'Left']),
    'Nobody has waited in the online lobby yet.');
}

async function refresh() {
  if (document.hidden) return;
  try {
    const r = await fetch('/api/stats', { cache: 'no-store' });
    if (!r.ok) throw new Error(r.status);
    draw(await r.json());
  } catch {
    $('updated').textContent = "Couldn't load the statistics. Trying again shortly.";
  }
}
refresh();
setInterval(refresh, REFRESH);
document.addEventListener('visibilitychange', refresh);
