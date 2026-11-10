// Play statistics behind /stats (page: public/stats.html + public/stats.js, API: GET /api/stats). They live in the
// Lobby Durable Object's SQLite storage, so they survive the object being evicted from memory or redeployed.
//
// Single-player games never talk to the lobby, so the game reports in (src/presence.js): POST /api/presence
// {id, n, mode, course, cc, char} every 30 s while its tab is visible and {id, bye:1} when the page goes away.
// A game counts as running until TTL after its last report. Online players are counted from the lobby's rooms.
//
// Tables
//   solo     one row per running single-player game (id = the game's random per-page id)
//   hours    one row per hour (h = unix hours): n minute samples, the summed counts (average = sum / minutes; a
//            minute nobody sampled had nobody playing) and the hour's peaks. m = the last minute sampled
//   peaks    the all-time peak per kind (solo | waiting | racing) and when it happened
//   courses  per course and kind (solo | online): games started, player-minutes, most players at once
//   joins    the last KEEP_JOINS lobby visits: driver, course, mode, room size, seconds waited, outcome (raced | left)

const CUPS = ["Mushroom Cup", "Flower Cup", "Star Cup", "Special Cup", "Battle"];
// Course ids as in src/track.js (NATIVE_COURSES then BATTLE_COURSES), four per cup in gCupCourseOrder order.
const COURSE_LIST = [
  ["luigi", "Luigi Raceway"], ["moomoo", "Moo Moo Farm"], ["koopa", "Koopa Troopa Beach"], ["kalimari", "Kalimari Desert"],
  ["toad", "Toad's Turnpike"], ["frappe", "Frappe Snowland"], ["choco", "Choco Mountain"], ["mario", "Mario Raceway"],
  ["wario", "Wario Stadium"], ["sherbet", "Sherbet Land"], ["royal", "Royal Raceway"], ["bowser", "Bowser's Castle"],
  ["dk", "D.K.'s Jungle Parkway"], ["yoshi", "Yoshi Valley"], ["banshee", "Banshee Boardwalk"], ["rainbow", "Rainbow Road"],
  ["big-donut", "Big Donut"], ["block-fort", "Block Fort"], ["double-deck", "Double Deck"], ["skyscraper", "Skyscraper"],
];
const COURSES = Object.fromEntries(COURSE_LIST.map(([id, name], i) => [id, { name, cup: CUPS[i >> 2] }]));
const DRIVERS = { mario: "Mario", luigi: "Luigi", peach: "Peach", toad: "Toad", yoshi: "Yoshi", donkeykong: "D. Kong", wario: "Wario", bowser: "Bowser" };
const MODES = { mario_gp: "Grand Prix", vs: "VS", time_trials: "Time Trials", battle: "Battle" };
const CCS = { 50: "50cc", 100: "100cc", 150: "150cc", extra: "Extra" };

const TTL = 75_000;        // a single-player game is running until this long after its last report (they come every 30 s)
const MAX_SOLO = 2000;     // reports for more games than this at once are dropped
const KEEP_JOINS = 1000;
const HOURS = 48;          // hours of history in the report
const LIST = 100;          // running games listed one by one in the report
const HISTORY_SECS = 60;   // the history half of the report is re-read from storage when it changed, or this often

const has = (o, k) => typeof k === "string" && Object.hasOwn(o, k);
const where = (id) => (has(COURSES, id) ? { course: id, name: COURSES[id].name, cup: COURSES[id].cup } : { course: "", name: "", cup: "" });
const round2 = (x) => Math.round(x * 100) / 100;

export class Stats {
  constructor(storage) {
    this.sql = storage.sql;
    for (const q of [
      "CREATE TABLE IF NOT EXISTS solo(id TEXT PRIMARY KEY, t INTEGER, since INTEGER, mode TEXT, course TEXT, cc TEXT, char TEXT) WITHOUT ROWID",
      "CREATE TABLE IF NOT EXISTS hours(h INTEGER PRIMARY KEY, m INTEGER DEFAULT 0, n INTEGER DEFAULT 0, solo INTEGER DEFAULT 0, waiting INTEGER DEFAULT 0, racing INTEGER DEFAULT 0, solo_peak INTEGER DEFAULT 0, waiting_peak INTEGER DEFAULT 0, racing_peak INTEGER DEFAULT 0)",
      "CREATE TABLE IF NOT EXISTS peaks(kind TEXT PRIMARY KEY, n INTEGER, t INTEGER) WITHOUT ROWID",
      "CREATE TABLE IF NOT EXISTS courses(course TEXT, kind TEXT, starts INTEGER DEFAULT 0, minutes INTEGER DEFAULT 0, peak INTEGER DEFAULT 0, PRIMARY KEY(course, kind)) WITHOUT ROWID",
      "CREATE TABLE IF NOT EXISTS joins(id INTEGER PRIMARY KEY, t INTEGER, char TEXT, course TEXT, mode TEXT, max INTEGER, size INTEGER, waited INTEGER, outcome TEXT)",
    ]) this.sql.exec(q);
    this.lastMin = this.sql.exec("SELECT max(m) AS m FROM hours").one().m || 0;
    this.best = { solo: 0, waiting: 0, racing: 0 };
    for (const r of this.sql.exec("SELECT kind, n FROM peaks")) this.best[r.kind] = r.n;
    this.hourBest = { h: 0 };
    this.history = null;
    this.historyAt = 0;
  }

  soloCount(now) {
    return this.sql.exec("SELECT count(*) AS c FROM solo WHERE t > ?", now - TTL).one().c;
  }

  // A single-player game reporting in (bad reports are ignored). True for a game not seen before.
  beat(b, now) {
    if (typeof b.id !== "string" || !/^[a-z0-9]{8,32}$/.test(b.id)) return false;
    if (b.bye) { this.sql.exec("DELETE FROM solo WHERE id = ?", b.id); return false; }
    if (!has(COURSES, b.course) || !has(MODES, b.mode) || !has(DRIVERS, b.char)) return false;
    const known = this.sql.exec("SELECT 1 FROM solo WHERE id = ?", b.id).toArray().length > 0;
    if (!known && this.soloCount(now) >= MAX_SOLO) return false;
    this.sql.exec("INSERT INTO solo(id, t, since, mode, course, cc, char) VALUES(?, ?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET t = excluded.t",
      b.id, now, now, b.mode, b.course, has(CCS, b.cc) ? b.cc : "", b.char);
    // n counts the game's reports: 0 is a new game, anything later is one coming back (its tab was hidden for a while)
    if (!known && b.n === 0) this.course(b.course, "solo", 1, 0, 1);
    return !known;
  }

  course(id, kind, starts, minutes, peak) {
    if (!has(COURSES, id)) return;
    this.history = null;
    this.sql.exec("INSERT INTO courses(course, kind, starts, minutes, peak) VALUES(?, ?, ?, ?, ?) ON CONFLICT(course, kind) DO UPDATE SET starts = starts + excluded.starts, minutes = minutes + excluded.minutes, peak = max(peak, excluded.peak)",
      id, kind, starts, minutes, peak);
  }

  // n players of a kind (solo | waiting | racing) at once: raises the hour's peak and the all-time one.
  peak(now, kind, n) {
    const h = Math.floor(now / 3_600_000);
    if (this.hourBest.h !== h) this.hourBest = { h, solo: 0, waiting: 0, racing: 0 };
    if (n > this.hourBest[kind]) {
      this.hourBest[kind] = n;
      this.history = null;
      this.sql.exec(`INSERT INTO hours(h, ${kind}_peak) VALUES(?, ?) ON CONFLICT(h) DO UPDATE SET ${kind}_peak = max(${kind}_peak, excluded.${kind}_peak)`, h, n);
    }
    if (n > this.best[kind]) {
      this.best[kind] = n;
      this.sql.exec("INSERT INTO peaks(kind, n, t) VALUES(?, ?, ?) ON CONFLICT(kind) DO UPDATE SET n = excluded.n, t = excluded.t", kind, n, now);
    }
  }

  // Called on every report and lobby event. Once a minute: forget the games that stopped reporting and sample the
  // counts. lobby() is the Lobby's snapshot(), only asked for when a sample is due.
  tick(now, lobby) {
    const m = Math.floor(now / 60_000);
    if (m <= this.lastMin) return;
    this.lastMin = m;
    this.sql.exec("DELETE FROM solo WHERE t <= ?", now - TTL);
    const solo = this.sql.exec("SELECT course, count(*) AS c FROM solo GROUP BY course").toArray();
    const n = solo.reduce((a, r) => a + r.c, 0);
    const l = lobby();
    if (!n && !l.waiting && !l.racing) return;
    this.history = null;
    this.sql.exec("INSERT INTO hours(h, m, n, solo, waiting, racing) VALUES(?, ?, 1, ?, ?, ?) ON CONFLICT(h) DO UPDATE SET m = excluded.m, n = n + 1, solo = solo + excluded.solo, waiting = waiting + excluded.waiting, racing = racing + excluded.racing",
      Math.floor(m / 60), m, n, l.waiting, l.racing);
    this.peak(now, "solo", n);
    this.peak(now, "waiting", l.waiting);
    this.peak(now, "racing", l.racing);
    for (const r of solo) this.course(r.course, "solo", 0, r.c, r.c);
    for (const [id, c] of l.racingBy) this.course(id, "online", 0, c, c);
  }

  // A lobby visit that ended: the room started (raced) or the player went away first (left).
  visit(now, c, room, outcome) {
    this.sql.exec("INSERT INTO joins(t, char, course, mode, max, size, waited, outcome) VALUES(?, ?, ?, ?, ?, ?, ?, ?)",
      c.joined, has(DRIVERS, c.char) ? c.char : "", has(COURSES, room.course) ? room.course : "", has(MODES, room.mode) ? room.mode : "",
      room.max, room.members.length, Math.round((now - c.joined) / 1000), outcome);
    this.sql.exec("DELETE FROM joins WHERE id <= (SELECT max(id) FROM joins) - ?", KEEP_JOINS);
    this.history = null;
  }

  // A room started its race.
  raceStart(now, room) {
    for (const c of room.members) this.visit(now, c, room, "raced");
    this.course(room.course, "online", room.members.length, 0, room.members.length);
  }

  // GET /api/stats. Drivers are named from the validated character id, never from a client's free-text name.
  report(now, lobby) {
    const secs = (t) => Math.max(0, Math.round((now - t) / 1000));
    const solo = this.sql.exec("SELECT course, mode, cc, char, since FROM solo WHERE t > ? ORDER BY since", now - TTL).toArray();
    const room = (r) => ({
      ...where(r.course), mode: has(MODES, r.mode) ? MODES[r.mode] : "", max: r.max, secs: secs(r.since), countdown: r.countdown,
      players: r.players.map((p) => ({ driver: has(DRIVERS, p.char) ? DRIVERS[p.char] : "Player", secs: secs(p.joined) })),
    });
    const live = {
      solo: {
        count: solo.length,
        games: solo.slice(0, LIST).map((g) => ({ ...where(g.course), mode: MODES[g.mode], cc: CCS[g.cc] ?? "", driver: DRIVERS[g.char], secs: secs(g.since) })),
      },
      waiting: { count: lobby.waiting, rooms: lobby.rooms.filter((r) => !r.started).map(room) },
      racing: { count: lobby.racing, rooms: lobby.rooms.filter((r) => r.started).map(room) },
    };
    if (!this.history || now - this.historyAt > HISTORY_SECS * 1000) { this.history = this.readHistory(now); this.historyAt = now; }
    return { now, live, ...this.history };
  }

  readHistory(now) {
    const hNow = Math.floor(now / 3_600_000);
    const hours = this.sql.exec("SELECT * FROM hours WHERE h > ? ORDER BY h", hNow - HOURS).toArray().map((r) => {
      const mins = r.h === hNow ? Math.floor(now / 60_000) % 60 + 1 : 60;
      return { h: r.h, solo: round2(r.solo / mins), soloPeak: r.solo_peak, waiting: round2(r.waiting / mins), waitingPeak: r.waiting_peak, racing: round2(r.racing / mins), racingPeak: r.racing_peak };
    });
    const peaks = { solo: { n: 0, t: 0 }, waiting: { n: 0, t: 0 }, racing: { n: 0, t: 0 } };
    for (const r of this.sql.exec("SELECT kind, n, t FROM peaks")) if (peaks[r.kind]) peaks[r.kind] = { n: r.n, t: r.t };
    const day = { solo: 0, waiting: 0, racing: 0 };
    for (const r of hours) if (r.h > hNow - 24) for (const k of Object.keys(day)) day[k] = Math.max(day[k], r[`${k}Peak`]);
    const by = new Map();
    for (const r of this.sql.exec("SELECT course, kind, starts, minutes, peak FROM courses")) by.set(`${r.course}/${r.kind}`, r);
    const part = (id, kind) => { const r = by.get(`${id}/${kind}`); return { starts: r?.starts ?? 0, minutes: r?.minutes ?? 0, peak: r?.peak ?? 0 }; };
    const courses = COURSE_LIST.map(([id]) => ({ ...where(id), solo: part(id, "solo"), online: part(id, "online") }));
    const tot = this.sql.exec("SELECT count(*) AS visits, sum(outcome = 'raced') AS raced, avg(waited) AS wait FROM joins").one();
    const recent = this.sql.exec("SELECT t, char, course, mode, max, size, waited, outcome FROM joins ORDER BY id DESC LIMIT 50").toArray().map((r) => ({
      t: r.t, driver: has(DRIVERS, r.char) ? DRIVERS[r.char] : "Player", ...where(r.course), mode: has(MODES, r.mode) ? MODES[r.mode] : "", max: r.max, size: r.size, waited: r.waited, outcome: r.outcome,
    }));
    return { hours, peaks: { all: peaks, day }, courses, lobby: { visits: tot.visits, raced: tot.raced ?? 0, wait: Math.round(tot.wait ?? 0), recent } };
  }
}
