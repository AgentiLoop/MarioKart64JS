// Online multiplayer transport, the same shape as ../GoKart scripts/net.gd: mk64js.gokart.games only does the
// matchmaking (website/src/lobby.js) and relays the WebRTC handshake (SDP offer/answer + ICE candidates) over a
// WebSocket; the race itself runs over a WebRTC full mesh, every game talking directly to every other one.
//
// Flow: quickMatch() -> 'room' updates -> server 'start' (everyone loads the room's course; a page reload comes
// back with rejoin()) -> ready() -> server 'go' -> mesh built -> 'mesh' once every data channel is open -> race.
// Events (CustomEvent.detail): room {code, you, host, players, countdown, max} · start {code, you, players,
// course, seed} · mesh · data {from, msg} · left {id} · error {message}.
// The lowest id in the room is the host: it decides anything that must agree (the start).

const DEFAULT_LOBBY = 'wss://mk64js.gokart.games/api/mp';
const ICE_SERVERS = [
  { urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] },
  { urls: ['stun:stun.cloudflare.com:3478'] },
  // TURN relay servers for strict/symmetric NATs arrive from the lobby server in its 'go' message (see
  // website/src/lobby.js iceServers), so every build (vite, deployed site, WebKit app) gets them without bundling secrets.
];
const DISCONNECT_GRACE = 8000;   // a 'disconnected' ICE state often recovers by itself
const MESH_TIMEOUT = 25000;
export const VERSION = '0.1';

export class Net extends EventTarget {
  constructor(lobbyUrl) {
    super();
    // ?lobby=ws://localhost:8787/api/mp (kept in sessionStorage so it survives the course reload)
    const q = new URLSearchParams(location.search).get('lobby');
    if (q) sessionStorage.setItem('mk64lobby', q);
    this.lobbyUrl = lobbyUrl || sessionStorage.getItem('mk64lobby') || DEFAULT_LOBBY;
    this.state = 'idle';   // idle | lobby | signaling | racing
    this.myId = 0; this.hostId = 0; this.roomCode = '';
    this.players = [];     // [{id, name, char}] sorted by id, including me
    this.peers = new Map(); // id -> {pc, r, u, open}
    this.ws = null; this.meshTimer = 0;
    this.ice = ICE_SERVERS;
    this.earlySigs = [];   // signals that arrived before our own 'go' built the mesh
  }

  get isOnline() { return this.state === 'racing' || this.state === 'signaling'; }
  get hostIsMe() { return this.myId === this.hostId; }

  quickMatch({ name, course, char, players, mode }) {
    this._connect({ t: 'hello', name, version: VERSION, course, char, players, mode });
  }
  rejoin(room, id) { this._connect({ t: 'rejoin', room, id }); }
  ready() { this._send({ t: 'ready' }); }

  leave() {
    if (this.ws) { try { this.ws.close(); } catch {} }
    this.ws = null;
    for (const p of this.peers.values()) { try { p.pc.close(); } catch {} }
    this.peers.clear();
    clearTimeout(this.meshTimer);
    this.earlySigs = [];
    this.state = 'idle'; this.myId = 0; this.hostId = 0; this.roomCode = ''; this.players = [];
  }

  _connect(hello) {
    this.leave();
    this.state = 'lobby';
    let ws;
    try { ws = new WebSocket(this.lobbyUrl); } catch (e) { this._fail(`Can't reach ${this.lobbyUrl}.`); return; }
    this.ws = ws;
    ws.onopen = () => ws.send(JSON.stringify(hello));
    ws.onmessage = ev => { let m; try { m = JSON.parse(ev.data); } catch { return; } if (m && typeof m === 'object') this._onLobby(m); };
    ws.onclose = () => { if (this.ws === ws) { this.ws = null; if (this.state === 'lobby') this._fail('Lost connection to the lobby.'); } };
    ws.onerror = () => { if (this.ws === ws && this.state === 'lobby') this._fail(`Can't reach ${this.lobbyUrl}.`); };
  }

  _send(msg) { if (this.ws && this.ws.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(msg)); }
  _emit(type, detail) { this.dispatchEvent(new CustomEvent(type, { detail })); }
  _fail(message) { this.leave(); this._emit('error', { message }); }

  _onLobby(m) {
    switch (m.t) {
      case 'room':
        this.myId = m.you; this.hostId = m.host; this.roomCode = m.code; this.players = m.players;
        this._emit('room', m); break;
      case 'start':
        this.myId = m.you; this.roomCode = m.code; this.players = m.players; this.hostId = m.players[0].id;
        this._emit('start', m); break;
      case 'go':
        this.players = m.players; this.hostId = m.players[0].id;
        this.ice = Array.isArray(m.ice) ? [...ICE_SERVERS, ...m.ice] : ICE_SERVERS;
        this._buildMesh(); break;
      case 'sig': this._onSignal(m.from, m.data); break;
      case 'error': this._fail(m.message); break;
    }
  }

  // One RTCPeerConnection per other player with two pre-negotiated data channels: 'r' reliable/ordered for the
  // handshake, finishes and items, 'u' unordered + no retransmits for the 30 Hz kart poses. The lower id offers.
  _buildMesh() {
    this.state = 'signaling';
    for (const p of this.players) {
      if (p.id === this.myId) continue;
      const pc = new RTCPeerConnection({ iceServers: this.ice });
      const peer = { pc, r: pc.createDataChannel('r', { negotiated: true, id: 1 }),
        u: pc.createDataChannel('u', { negotiated: true, id: 2, ordered: false, maxRetransmits: 0 }), open: false };
      for (const ch of [peer.r, peer.u]) {
        ch.onopen = () => this._checkMesh();
        ch.onmessage = ev => { let msg; try { msg = JSON.parse(ev.data); } catch { return; } this._emit('data', { from: p.id, msg }); };
      }
      pc.onicecandidate = ev => { if (ev.candidate) this._send({ t: 'sig', to: p.id, data: { cand: ev.candidate.toJSON() } }); };
      pc.onconnectionstatechange = () => {
        clearTimeout(peer.dropTimer);
        const st = pc.connectionState;
        if (!this.peers.has(p.id) || this.peers.get(p.id) !== peer) return;
        if (st === 'failed' || st === 'closed') this._dropPeer(p.id);
        else if (st === 'disconnected') peer.dropTimer = setTimeout(() => { if (pc.connectionState === 'disconnected' && this.peers.get(p.id) === peer) this._dropPeer(p.id); }, DISCONNECT_GRACE);
      };
      peer.q = Promise.resolve();
      this.peers.set(p.id, peer);
      if (this.myId < p.id) {
        pc.createOffer().then(o => pc.setLocalDescription(o)).then(() => this._send({ t: 'sig', to: p.id, data: { sdp: pc.localDescription.toJSON() } }));
      }
    }
    clearTimeout(this.meshTimer);
    this.meshTimer = setTimeout(() => { if (this.state === 'signaling') this._fail("Couldn't connect to the other players (firewall or strict NAT)."); }, MESH_TIMEOUT);
    const early = this.earlySigs; this.earlySigs = [];
    for (const e of early) this._onSignal(e.from, e.data);
    this._checkMesh();
  }

  // Signals for one peer are handled strictly in order (a candidate must wait for the offer/answer before it).
  _onSignal(from, data) {
    if (!data) return;
    const peer = this.peers.get(from);
    if (!peer) {   // the other side's offer can beat our own 'go' over the internet: keep it for _buildMesh
      if (this.state === 'lobby') this.earlySigs.push({ from, data });
      return;
    }
    peer.q = peer.q.then(() => this._handleSignal(peer, from, data));
  }

  async _handleSignal(peer, from, data) {
    const pc = peer.pc;
    try {
      if (data.sdp) {
        await pc.setRemoteDescription(data.sdp);
        if (data.sdp.type === 'offer') {
          await pc.setLocalDescription(await pc.createAnswer());
          this._send({ t: 'sig', to: from, data: { sdp: pc.localDescription.toJSON() } });
        }
      } else if (data.cand) {
        await pc.addIceCandidate(data.cand);
      }
    } catch (e) { console.warn('signaling', from, e); }
  }

  _checkMesh() {
    if (this.state !== 'signaling') return;
    for (const p of this.peers.values()) {
      p.open = p.r.readyState === 'open' && p.u.readyState === 'open';
      if (!p.open) return;
    }
    this.state = 'racing';
    clearTimeout(this.meshTimer);
    if (this.ws) { try { this.ws.close(); } catch {} this.ws = null; }   // signaling done: peer-to-peer only from here
    this._emit('mesh', {});
  }

  _dropPeer(id) {
    const p = this.peers.get(id);
    if (!p) return;
    this.peers.delete(id);
    clearTimeout(p.dropTimer);
    try { p.pc.close(); } catch {}
    if (this.state === 'signaling') { this._fail("Couldn't connect to the other players (firewall or strict NAT)."); return; }
    this.players = this.players.filter(q => q.id !== id);
    if (this.players.length) this.hostId = this.players[0].id;
    this._emit('left', { id });
  }

  // Broadcast (reliable by default; unreliable for the kart poses).
  send(msg, reliable = true) {
    const s = JSON.stringify(msg);
    for (const p of this.peers.values()) {
      const ch = reliable ? p.r : p.u;
      if (ch.readyState === 'open') { try { ch.send(s); } catch {} }
    }
  }
}
