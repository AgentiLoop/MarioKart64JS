// mk64js.gokart.games: static fan site + the multiplayer lobby (a Durable Object, see lobby.js).
// /play/ is the hosted game (npm run build:web -> public/play, every texture tier like the desktop apps), linked from the home page.
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
    if (res.ok && (url.pathname === "/play" || url.pathname.startsWith("/play/"))) {
      if (url.pathname.startsWith("/play/assets/")) h.set("cache-control", "public, max-age=31536000, immutable");   // hashed by vite
      else if (url.pathname === "/play/mk64-hd/manifest.json") h.set("cache-control", "no-cache");                 // tiers change between releases
      else if (url.pathname.startsWith("/play/mk64")) h.set("cache-control", "public, max-age=86400");            // ROM + HD textures, audio
    }
    return new Response(res.body, { status: res.status, statusText: res.statusText, headers: h });
  },
};
