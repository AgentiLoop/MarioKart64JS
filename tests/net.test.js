import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Net, VERSION } from '../src/net.js';
import { flush } from './helpers.js';

let sockets, pcs;
class FakeWS {
  static OPEN = 1;
  constructor(url) {
    if (FakeWS.throwOnNew) throw new Error('nope');
    this.url = url; this.readyState = 1; this.sent = []; this.closed = false; sockets.push(this);
  }
  send(s) { this.sent.push(JSON.parse(s)); }
  close() { this.closed = true; }
  receive(m) { this.onmessage({ data: typeof m === 'string' ? m : JSON.stringify(m) }); }
}
class FakeChannel {
  constructor(label) { this.label = label; this.readyState = 'connecting'; this.sent = []; }
  send(s) { if (this.throws) throw new Error('closed'); this.sent.push(s); }
  open() { this.readyState = 'open'; this.onopen?.(); }
}
class FakePC {
  constructor(cfg) {
    this.cfg = cfg; this.channels = []; this.connectionState = 'new'; this.closed = false; this.remote = []; this.cands = [];
    pcs.push(this);
  }
  createDataChannel(label, opts) { const c = new FakeChannel(label); c.opts = opts; this.channels.push(c); return c; }
  async createOffer() { return { type: 'offer', sdp: 'o' }; }
  async createAnswer() { return { type: 'answer', sdp: 'a' }; }
  async setLocalDescription(d) { this.localDescription = { ...d, toJSON: () => d }; }
  async setRemoteDescription(d) { if (this.failRemote) throw new Error('bad sdp'); this.remote.push(d); }
  async addIceCandidate(c) { this.cands.push(c); }
  close() { this.closed = true; }
}

beforeEach(() => {
  sockets = []; pcs = []; FakeWS.throwOnNew = false;
  globalThis.WebSocket = FakeWS;
  globalThis.RTCPeerConnection = FakePC;
  sessionStorage.clear();
  vi.useRealTimers();
});
afterEach(() => { vi.useRealTimers(); });

const events = (net, ...types) => {
  const got = [];
  for (const t of types) net.addEventListener(t, e => got.push([t, e.detail]));
  return got;
};
const players = [{ id: 2, name: 'B' }, { id: 5, name: 'C' }, { id: 9, name: 'D' }];

describe('Net lobby connection', () => {
  it('defaults to the production lobby and remembers ?lobby= in sessionStorage', () => {
    expect(new Net().lobbyUrl).toBe('wss://mk64js.gokart.games/api/mp');
    sessionStorage.setItem('mk64lobby', 'ws://stored/api');
    expect(new Net().lobbyUrl).toBe('ws://stored/api');
    expect(new Net('ws://explicit').lobbyUrl).toBe('ws://explicit');
    window.history.pushState({}, '', '/?lobby=ws://localhost:8787/api/mp');
    expect(new Net().lobbyUrl).toBe('ws://localhost:8787/api/mp');
    expect(sessionStorage.getItem('mk64lobby')).toBe('ws://localhost:8787/api/mp');
    window.history.pushState({}, '', '/');
  });
  it('quickMatch sends hello once the socket opens and goes to the lobby state', () => {
    const n = new Net('ws://x');
    n.quickMatch({ name: 'A', course: 'mario', char: 1, players: 4, mode: 'gp' });
    expect(n.state).toBe('lobby');
    const ws = sockets[0];
    ws.onopen();
    expect(ws.sent[0]).toEqual({ t: 'hello', name: 'A', version: VERSION, course: 'mario', char: 1, players: 4, mode: 'gp' });
  });
  it('rejoin sends the room and id', () => {
    const n = new Net('ws://x');
    n.rejoin('ABCD', 3);
    sockets[0].onopen();
    expect(sockets[0].sent[0]).toEqual({ t: 'rejoin', room: 'ABCD', id: 3 });
  });
  it('room and start messages fill in the room state and the lowest id is the host', () => {
    const n = new Net('ws://x');
    const got = events(n, 'room', 'start');
    n.quickMatch({});
    const ws = sockets[0];
    ws.receive({ t: 'room', you: 2, host: 2, code: 'RM', players, countdown: 5, max: 8 });
    expect([n.myId, n.hostId, n.roomCode, n.hostIsMe]).toEqual([2, 2, 'RM', true]);
    ws.receive({ t: 'start', you: 5, code: 'RM', players, course: 'luigi', seed: 7 });
    expect(n.hostId).toBe(2);
    expect(n.hostIsMe).toBe(false);
    expect(got.map(g => g[0])).toEqual(['room', 'start']);
    expect(got[1][1].course).toBe('luigi');
  });
  it('ignores garbage and non-object messages', () => {
    const n = new Net('ws://x');
    n.quickMatch({});
    sockets[0].receive('not json');
    sockets[0].receive('42');
    sockets[0].receive('null');
    expect(n.state).toBe('lobby');
  });
  it('a lobby error message fails with the server message', () => {
    const n = new Net('ws://x');
    const got = events(n, 'error');
    n.quickMatch({});
    sockets[0].receive({ t: 'error', message: 'room full' });
    expect(got).toEqual([['error', { message: 'room full' }]]);
    expect(n.state).toBe('idle');
    expect(sockets[0].closed).toBe(true);
  });
  it('a WebSocket constructor failure, an error event and an unexpected close all fail while in the lobby', () => {
    const n = new Net('ws://x');
    const got = events(n, 'error');
    FakeWS.throwOnNew = true;
    n.quickMatch({});
    expect(got[0][1].message).toBe("Can't reach ws://x.");
    FakeWS.throwOnNew = false;
    n.quickMatch({});
    sockets[0].onerror();
    expect(got[1][1].message).toBe("Can't reach ws://x.");
    n.quickMatch({});
    sockets[1].onclose();
    expect(got[2][1].message).toBe('Lost connection to the lobby.');
    // a stale socket's events are ignored
    n.quickMatch({});
    const old = sockets[2];
    n.quickMatch({});
    old.onerror(); old.onclose();
    expect(got).toHaveLength(3);
    expect(n.state).toBe('lobby');
  });
  it('_send is silent without an open socket', () => {
    const n = new Net('ws://x');
    n.ready();
    n.quickMatch({});
    sockets[0].readyState = 3;
    n.ready();
    expect(sockets[0].sent).toEqual([]);
    sockets[0].readyState = 1;
    n.ready();
    expect(sockets[0].sent).toEqual([{ t: 'ready' }]);
  });
  it('leave closes everything and resets, even when close throws', () => {
    const n = new Net('ws://x');
    n.quickMatch({});
    sockets[0].close = () => { throw new Error('x'); };
    n.peers.set(1, { pc: { close() { throw new Error('y'); } } });
    n.myId = 3; n.roomCode = 'Z'; n.players = [1];
    n.leave();
    expect([n.state, n.myId, n.roomCode, n.players, n.peers.size]).toEqual(['idle', 0, '', [], 0]);
  });
});

describe('Net mesh', () => {
  const go = (n, ws, me = 5, extra = {}) => {
    ws.receive({ t: 'room', you: me, host: 2, code: 'RM', players });
    ws.receive({ t: 'go', players, ...extra });
  };
  it('go builds a peer connection per other player; the lower id offers', async () => {
    const n = new Net('ws://x');
    n.quickMatch({});
    go(n, sockets[0], 5, { ice: [{ urls: 'turn:t' }] });
    expect(n.state).toBe('signaling');
    expect(pcs).toHaveLength(2);
    expect(pcs[0].cfg.iceServers.at(-1)).toEqual({ urls: 'turn:t' });
    const [r, u] = pcs[0].channels;
    expect(r.opts).toEqual({ negotiated: true, id: 1 });
    expect(u.opts).toEqual({ negotiated: true, id: 2, ordered: false, maxRetransmits: 0 });
    await flush();
    // I'm 5: I offer to 9 only (peer 2 offers to me)
    const sigs = sockets[0].sent.filter(m => m.t === 'sig');
    expect(sigs).toHaveLength(1);
    expect(sigs[0].to).toBe(9);
    expect(sigs[0].data.sdp.type).toBe('offer');
  });
  it('go without an ice list uses just the built-in STUN servers', () => {
    const n = new Net('ws://x');
    n.quickMatch({});
    go(n, sockets[0]);
    expect(pcs[0].cfg.iceServers).toHaveLength(2);
  });
  it('answers an offer, applies candidates in order and ignores empty signals', async () => {
    const n = new Net('ws://x');
    n.quickMatch({});
    go(n, sockets[0]);
    sockets[0].receive({ t: 'sig', from: 2, data: { sdp: { type: 'offer', sdp: 'x' } } });
    sockets[0].receive({ t: 'sig', from: 2, data: { cand: { candidate: 'c1' } } });
    sockets[0].receive({ t: 'sig', from: 2 });
    await flush();
    const pc = pcs[0];
    expect(pc.remote[0].type).toBe('offer');
    expect(pc.cands).toEqual([{ candidate: 'c1' }]);
    const answer = sockets[0].sent.find(m => m.t === 'sig' && m.to === 2);
    expect(answer.data.sdp.type).toBe('answer');
    // an answer needs no reply
    const before = sockets[0].sent.length;
    sockets[0].receive({ t: 'sig', from: 9, data: { sdp: { type: 'answer', sdp: 'y' } } });
    await flush();
    expect(sockets[0].sent.length).toBe(before);
  });
  it('a failing signal is logged, not thrown', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const n = new Net('ws://x');
    n.quickMatch({});
    go(n, sockets[0]);
    pcs[0].failRemote = true;
    sockets[0].receive({ t: 'sig', from: 2, data: { sdp: { type: 'offer' } } });
    await flush();
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
  it('signals arriving before our own go are replayed once the mesh is built', async () => {
    const n = new Net('ws://x');
    n.quickMatch({});
    const ws = sockets[0];
    ws.receive({ t: 'sig', from: 2, data: { sdp: { type: 'offer' } } });
    ws.receive({ t: 'sig', from: 77, data: { cand: {} } });   // from someone not in the room: dropped at go
    expect(n.earlySigs).toHaveLength(2);
    go(n, ws);
    await flush();
    expect(pcs[0].remote).toHaveLength(1);
    expect(n.earlySigs).toEqual([]);
    // later signals from unknown peers are dropped once signaling
    ws.receive({ t: 'sig', from: 99, data: { cand: {} } });
    expect(n.earlySigs).toEqual([]);
  });
  it('ICE candidates are relayed to the right peer', () => {
    const n = new Net('ws://x');
    n.quickMatch({});
    go(n, sockets[0]);
    pcs[0].onicecandidate({ candidate: { toJSON: () => ({ c: 1 }) } });
    pcs[0].onicecandidate({ candidate: null });
    const sigs = sockets[0].sent.filter(m => m.t === 'sig' && m.data.cand);
    expect(sigs).toEqual([{ t: 'sig', to: 2, data: { cand: { c: 1 } } }]);
  });
  it('the mesh opens when every data channel of every peer is open: the socket closes and mesh fires', () => {
    const n = new Net('ws://x');
    const got = events(n, 'mesh');
    n.quickMatch({});
    const ws = sockets[0];
    go(n, ws);
    expect(n.isOnline).toBe(true);
    pcs[0].channels[0].open(); pcs[0].channels[1].open();
    expect(n.state).toBe('signaling');
    pcs[1].channels[0].open();
    expect(got).toHaveLength(0);
    pcs[1].channels[1].open();
    expect(n.state).toBe('racing');
    expect(got).toHaveLength(1);
    expect(ws.closed).toBe(true);
    expect(n.ws).toBeNull();
    n._checkMesh();                  // already racing: no second event
    expect(got).toHaveLength(1);
  });
  it('a heads-up with no other players races straight away', () => {
    const n = new Net('ws://x');
    const got = events(n, 'mesh');
    n.quickMatch({});
    sockets[0].receive({ t: 'room', you: 2, host: 2, code: 'R', players: [{ id: 2 }] });
    sockets[0].receive({ t: 'go', players: [{ id: 2 }] });
    expect(n.state).toBe('racing');
    expect(got).toHaveLength(1);
  });
  it('data channel messages are parsed and attributed; garbage is dropped', () => {
    const n = new Net('ws://x');
    const got = events(n, 'data');
    n.quickMatch({});
    go(n, sockets[0]);
    pcs[0].channels[1].onmessage({ data: JSON.stringify({ k: 1 }) });
    pcs[0].channels[0].onmessage({ data: 'junk' });
    expect(got).toEqual([['data', { from: 2, msg: { k: 1 } }]]);
  });
  it('send broadcasts on the reliable or unreliable channel of each open peer and survives a throwing channel', () => {
    const n = new Net('ws://x');
    n.quickMatch({});
    go(n, sockets[0]);
    const [a, b] = pcs;
    for (const c of [...a.channels, ...b.channels]) c.open();
    n.send({ hi: 1 });
    n.send({ pose: 1 }, false);
    expect(a.channels[0].sent).toEqual(['{"hi":1}']);
    expect(a.channels[1].sent).toEqual(['{"pose":1}']);
    b.channels[0].throws = true;
    n.send({ hi: 2 });
    expect(a.channels[0].sent).toHaveLength(2);
    b.channels[0].readyState = 'closed';
    n.send({ hi: 3 });
    expect(a.channels[0].sent).toHaveLength(3);
  });
  it('times out when the other players never connect', () => {
    vi.useFakeTimers();
    const n = new Net('ws://x');
    const got = events(n, 'error');
    n.quickMatch({});
    go(n, sockets[0]);
    vi.advanceTimersByTime(25001);
    expect(got[0][1].message).toMatch(/firewall or strict NAT/);
    expect(n.state).toBe('idle');
    expect(pcs.every(p => p.closed)).toBe(true);
  });
  it('the meshTimer does nothing once racing', () => {
    vi.useFakeTimers();
    const n = new Net('ws://x');
    const got = events(n, 'error');
    n.quickMatch({});
    go(n, sockets[0]);
    for (const p of pcs) for (const c of p.channels) c.open();
    vi.advanceTimersByTime(30000);
    expect(got).toHaveLength(0);
  });
});

describe('Net peer loss', () => {
  const race = () => {
    const n = new Net('ws://x');
    n.quickMatch({});
    sockets[0].receive({ t: 'room', you: 5, host: 2, code: 'RM', players });
    sockets[0].receive({ t: 'go', players });
    for (const p of pcs) for (const c of p.channels) c.open();
    return n;
  };
  it('a failed or closed connection drops that peer and promotes the next host', () => {
    const n = race();
    const got = events(n, 'left');
    pcs[0].connectionState = 'failed';
    pcs[0].onconnectionstatechange();
    expect(got).toEqual([['left', { id: 2 }]]);
    expect(n.players.map(p => p.id)).toEqual([5, 9]);
    expect(n.hostId).toBe(5);
    expect(n.hostIsMe).toBe(true);
    pcs[1].connectionState = 'closed';
    pcs[1].onconnectionstatechange();
    expect(n.players.map(p => p.id)).toEqual([5]);
    n._dropPeer(9);   // already gone
    expect(got).toHaveLength(2);
  });
  it('a disconnected peer gets a grace period to recover', () => {
    vi.useFakeTimers();
    const n = race();
    const got = events(n, 'left');
    pcs[0].connectionState = 'disconnected';
    pcs[0].onconnectionstatechange();
    vi.advanceTimersByTime(4000);
    pcs[0].connectionState = 'connected';
    pcs[0].onconnectionstatechange();   // recovered, timer cleared
    vi.advanceTimersByTime(10000);
    expect(got).toHaveLength(0);
    pcs[0].connectionState = 'disconnected';
    pcs[0].onconnectionstatechange();
    vi.advanceTimersByTime(8001);
    expect(got).toEqual([['left', { id: 2 }]]);
    // a stale timer on a replaced peer does nothing
    pcs[1].connectionState = 'disconnected';
    pcs[1].onconnectionstatechange();
    n.peers.set(9, {});
    vi.advanceTimersByTime(9000);
    expect(got).toHaveLength(1);
  });
  it('state changes of a peer we already dropped are ignored', () => {
    const n = race();
    const got = events(n, 'left');
    n.peers.delete(2);
    pcs[0].connectionState = 'failed';
    pcs[0].onconnectionstatechange();
    expect(got).toHaveLength(0);
  });
  it('losing a peer while still signaling fails the whole connection', () => {
    const n = new Net('ws://x');
    const got = events(n, 'error');
    n.quickMatch({});
    sockets[0].receive({ t: 'room', you: 5, host: 2, code: 'RM', players });
    sockets[0].receive({ t: 'go', players });
    pcs[0].connectionState = 'failed';
    pcs[0].onconnectionstatechange();
    expect(got).toHaveLength(1);
    expect(n.state).toBe('idle');
  });
  it('closing the lobby socket after signaling is harmless; _dropPeer tolerates a throwing close', () => {
    const n = race();
    pcs[0].close = () => { throw new Error('x'); };
    n._dropPeer(2);
    expect(n.peers.has(2)).toBe(false);
    expect(n.state).toBe('racing');
  });
});
