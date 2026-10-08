// mk64js.gokart.games: static fan site + the multiplayer lobby (a Durable Object, see lobby.js).
// /play/ is the hosted game (npm run build:web -> public/play, every texture tier like the desktop apps), linked from the home page.
// Security headers: HTTPS is forced in the worker (301 http->https; Cloudflare's edge terminates both,
// so no redirect loop), the strict HSTS covers apex + subdomains, and the CSP covers what the game uses.
export { Lobby } from "./lobby.js";

// /download/<plat> -> 302 to that platform's asset on the latest (non-pre-release) GitHub release,
// so the site never needs editing for a new version. Asset names carry the version, so match by suffix.
export const REPO = "AgentiLoop/MarioKart64JS";
const DOWNLOADS = {
  mac: "-mac-webkit-universal.zip",
  win: "-win-x64.zip",
  "win-arm": "-win-arm64.zip",
  linux: "-linux-x64.tar.gz",
  "linux-arm": "-linux-arm64.tar.gz",
  pi: "-raspberrypi.tar.gz",
  sums: "SHA256SUMS.txt",
};

async function latestDownload(suffix) {
  const fallback = `https://github.com/${REPO}/releases/latest`;
  try {
    const r = await fetch(`https://api.github.com/repos/${REPO}/releases/latest`, {
      headers: { "user-agent": "mk64js.gokart.games", accept: "application/vnd.github+json" },
      cf: { cacheTtl: 300, cacheEverything: true },   // 5 min edge cache, well under the API rate limit
    });
    if (r.ok) {
      const asset = (await r.json()).assets.find((a) => a.name.endsWith(suffix));
      if (asset) return Response.redirect(asset.browser_download_url, 302);
    }
  } catch {}
  return Response.redirect(fallback, 302);
}

const HSTS = "max-age=31536000; includeSubDomains";   // a year, subdomains included; no preload for now
const CSP = "default-src 'self'; script-src 'self'; img-src 'self' data:; media-src 'self'; connect-src 'self' wss:; worker-src 'self'; style-src 'self' 'unsafe-inline'; object-src 'none'; base-uri 'self'; frame-ancestors 'self'";

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.protocol === "http:") { url.protocol = "https:"; return Response.redirect(url.toString(), 301); }
    if (url.pathname === "/api/mp" || url.pathname === "/api/mp/status") {
      return env.LOBBY.get(env.LOBBY.idFromName("global")).fetch(request);
    }
    const dl = url.pathname.match(/^\/download\/([a-z-]+)$/);
    if (dl && DOWNLOADS[dl[1]]) return latestDownload(DOWNLOADS[dl[1]]);
    const res = await env.ASSETS.fetch(request);
    const h = new Headers(res.headers);
    h.set("x-content-type-options", "nosniff");
    h.set("referrer-policy", "strict-origin-when-cross-origin");
    h.set("strict-transport-security", HSTS);
    h.set("content-security-policy", CSP);
    h.set("x-frame-options", "SAMEORIGIN");
    if (res.ok && (url.pathname === "/play" || url.pathname.startsWith("/play/"))) {
      if (url.pathname.startsWith("/play/assets/")) h.set("cache-control", "public, max-age=31536000, immutable");   // hashed by vite
      else if (url.pathname === "/play/mk64-hd/manifest.json") h.set("cache-control", "no-cache");                 // tiers change between releases
      else if (url.pathname.startsWith("/play/mk64")) h.set("cache-control", "public, max-age=86400");            // ROM + HD textures, audio
    }
    return new Response(res.body, { status: res.status, statusText: res.statusText, headers: h });
  },
};
