// mk64js.gokart.games: static fan site + the multiplayer lobby (a Durable Object, see lobby.js).
export { Lobby } from "./lobby.js";

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === "/api/mp" || url.pathname === "/api/mp/status") {
      return env.LOBBY.get(env.LOBBY.idFromName("global")).fetch(request);
    }
    const res = await env.ASSETS.fetch(request);
    const h = new Headers(res.headers);
    h.set("x-content-type-options", "nosniff");
    h.set("referrer-policy", "strict-origin-when-cross-origin");
    return new Response(res.body, { status: res.status, statusText: res.statusText, headers: h });
  },
};
