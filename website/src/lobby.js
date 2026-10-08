// MarioKart64JS multiplayer lobby: matchmaking + WebRTC signaling relay (same design as ../GoKart
// website/src/lobby.js). Clients open a WebSocket to /api/mp. The server only groups 2-4 players
// into a room and relays SDP offers/answers/ICE candidates between them; once the WebRTC mesh is
// up all racing traffic flows peer-to-peer and the game closes this socket.
//
// Client -> server
//   {t:"hello", name, version, course, char, players, mode}  quick match: a room for `players` (2-MAX_ROOM_PLAYERS) in `mode`
//   {t:"rejoin", room, id}                             after a page reload (course change), re-attach
//   {t:"ready"}                                        on the room's course page, ready to signal
//   {t:"sig", to, data}                                relay signaling data to a room member
// Server -> client
//   {t:"room", code, you, host, players:[{id,name,char}], countdown, max}  lobby state (secs or -1)
//   {t:"start", code, you, players, course, seed}      room locked: load `course` (reload if needed)
//   {t:"go", players}                                  everyone is on the course page: build the mesh
//   {t:"sig", from, data}                              relayed signaling data
//   {t:"error", message}

// Humans per room. Keep in step with MAX_ONLINE_KARTS in src/main.js (the CPU fills the rest of the grid up to it).
const MAX_ROOM_PLAYERS = 4;
const AUTO_START_SECS = 15; // a room starts this long after its first player arrives (if 2+ are in)
const READY_TIMEOUT_MS = 30_000; // players not back on the course page by then are dropped
const SIGNAL_GRACE_MS = 90_000; // sockets of a started room are closed after this

const clean = (s, n) => String(s ?? "").replace(/[\u0000-\u001f\u007f]/g, "").trim().slice(0, n);

export class Lobby {
  constructor(state, env) {
    this.state = state;
    this.members = new Map(); // ws -> {ws, id, name, char, room, ready}
    this.rooms = new Map(); // code -> {code, max, version, course, seed, members: [member], started, go, deadline, timer}
  }

  async fetch(request) {
    const url = new URL(request.url);
    if (url.pathname.endsWith("/status")) {
      let waiting = 0, racing = 0;
      for (const r of this.rooms.values()) (r.started ? (racing += r.members.length) : (waiting += r.members.length));
      return new Response(JSON.stringify({ waiting, racing, rooms: this.rooms.size }), {
        headers: { "content-type": "application/json", "cache-control": "no-store" },
      });
    }
    if (request.headers.get("upgrade") !== "websocket") return new Response("Expected WebSocket", { status: 426 });
    const pair = new WebSocketPair();
    const ws = pair[1];
    ws.accept();
    this.members.set(ws, { ws, id: 0, name: "", char: "", room: null, ready: false });
    ws.addEventListener("message", (ev) => this.onMessage(ws, ev.data));
    ws.addEventListener("close", () => this.drop(ws));
    ws.addEventListener("error", () => this.drop(ws));
    return new Response(null, { status: 101, webSocket: pair[0] });
  }

  send(m, o) {
    if (!m.ws) return;
    try { m.ws.send(JSON.stringify(o)); } catch { this.drop(m.ws); }
  }

  onMessage(ws, raw) {
    const c = this.members.get(ws);
    if (!c) return;
    if (typeof raw !== "string" || raw.length > 16384) return;
    let m;
    try { m = JSON.parse(raw); } catch { return; }
    if (!m || typeof m !== "object") return;
    if (m.t === "hello" && !c.room) return this.hello(c, m);
    if (m.t === "rejoin" && !c.room) return this.rejoin(c, m);
    const room = c.room && this.rooms.get(c.room);
    if (!room) return;
    if (m.t === "ready") {
      if (room.started && !room.go) { c.ready = true; this.checkReady(room); }
    } else if (m.t === "sig") {
      const to = room.members.find((p) => p.id === m.to);
      if (to) this.send(to, { t: "sig", from: c.id, data: m.data });
    }
  }

  hello(c, m) {
    c.name = clean(m.name, 16) || "Player";
    c.char = clean(m.char, 12);
    const version = clean(m.version, 16);
    const max = Math.min(MAX_ROOM_PLAYERS, Math.max(2, Number(m.players) || 2));
    const mode = clean(m.mode, 16) || "vs";
    let room = null;
    for (const r of this.rooms.values()) {
      if (!r.started && r.version === version && r.max === max && r.mode === mode && r.members.length < r.max) { room = r; break; }
    }
    if (!room) {
      room = { code: this.freshCode(), max, mode, version, course: clean(m.course, 40), seed: 0, members: [], started: false, go: false, deadline: 0, timer: null };
      this.rooms.set(room.code, room);
      room.deadline = Date.now() + AUTO_START_SECS * 1000;
    }
    const used = new Set(room.members.map((p) => p.id));
    c.id = 1;
    while (used.has(c.id)) c.id++;
    c.room = room.code;
    room.members.push(c);
    if (room.members.length >= room.max) return this.start(room);
    this.broadcastRoom(room);
    this.schedule(room);
  }

  // A player that reloaded onto the room's course re-attaches to its member slot.
  rejoin(c, m) {
    const room = this.rooms.get(clean(m.room, 8));
    const slot = room && room.started && !room.go && room.members.find((p) => p.id === Number(m.id));
    if (!slot) return this.send(c, { t: "error", message: "Room is gone." });
    if (slot.ws) { try { slot.ws.close(1000, "rejoined"); } catch {} this.members.delete(slot.ws); }
    slot.ws = c.ws;
    slot.ready = false;
    this.members.set(c.ws, slot);
    this.send(slot, this.startMsg(room, slot));
  }

  freshCode() {
    const abc = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
    for (;;) {
      let s = "";
      for (let i = 0; i < 4; i++) s += abc[Math.floor(Math.random() * abc.length)];
      if (!this.rooms.has(s)) return s;
    }
  }

  hostOf(room) {
    return Math.min(...room.members.map((p) => p.id));
  }

  players(room) {
    return room.members.map((p) => ({ id: p.id, name: p.name, char: p.char })).sort((a, b) => a.id - b.id);
  }

  broadcastRoom(room) {
    const countdown = room.deadline ? Math.max(0, Math.ceil((room.deadline - Date.now()) / 1000)) : -1;
    const players = this.players(room);
    const host = this.hostOf(room);
    for (const p of room.members) this.send(p, { t: "room", code: room.code, you: p.id, host, players, countdown, max: room.max });
  }

  // Re-broadcast the countdown once a second; when it runs out start with 2+ players, else keep waiting.
  schedule(room) {
    clearTimeout(room.timer);
    if (room.started || !room.deadline) return;
    room.timer = setTimeout(() => {
      if (!this.rooms.has(room.code) || room.started) return;
      if (Date.now() >= room.deadline) {
        if (room.members.length >= 2) return this.start(room);
        room.deadline = Date.now() + AUTO_START_SECS * 1000;
      }
      this.broadcastRoom(room);
      this.schedule(room);
    }, 1000);
  }

  startMsg(room, p) {
    return { t: "start", code: room.code, you: p.id, players: this.players(room), course: room.course, seed: room.seed };
  }

  start(room) {
    clearTimeout(room.timer);
    room.started = true;
    room.seed = Math.floor(Math.random() * 2147483647);
    for (const p of room.members) this.send(p, this.startMsg(room, p));
    room.timer = setTimeout(() => this.go(room), READY_TIMEOUT_MS);
  }

  checkReady(room) {
    if (room.members.every((p) => p.ready)) this.go(room);
  }

  // Everyone is on the course page (or the ready timeout passed): drop the stragglers, build the mesh.
  go(room) {
    clearTimeout(room.timer);
    if (room.go) return;
    for (const p of room.members.filter((p) => !p.ready)) {
      if (p.ws) { try { p.ws.close(1000, "not ready"); } catch {} this.members.delete(p.ws); }
      p.ws = null;
    }
    room.members = room.members.filter((p) => p.ready);
    if (room.members.length === 0) { this.rooms.delete(room.code); return; }
    room.go = true;
    const players = this.players(room);
    for (const p of room.members) this.send(p, { t: "go", players });
    room.timer = setTimeout(() => {
      for (const p of [...room.members]) { if (p.ws) { try { p.ws.close(1000, "signaling done"); } catch {} } this.drop(p.ws); }
    }, SIGNAL_GRACE_MS);
  }

  drop(ws) {
    const c = ws && this.members.get(ws);
    if (!c) return;
    this.members.delete(ws);
    c.ws = null;
    const room = c.room && this.rooms.get(c.room);
    if (!room) return;
    // Between "start" and "go" a member may be reloading onto the course page: keep its slot.
    if (room.started && !room.go) return;
    room.members = room.members.filter((p) => p !== c);
    if (room.members.length === 0) {
      clearTimeout(room.timer);
      this.rooms.delete(room.code);
      return;
    }
    if (!room.started) {
      this.broadcastRoom(room);
      this.schedule(room);
    }
    // Once the mesh is up, peers close this socket themselves; WebRTC reports real disconnects.
  }
}
