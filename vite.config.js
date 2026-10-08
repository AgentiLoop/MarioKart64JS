import { defineConfig } from 'vite';

// `vite build --mode web` (npm run build:web) is the hosted copy at mk64js.gokart.games/play/: it lands in
// website/public/play so `wrangler deploy` ships it with the site's static assets. Every texture tier goes online
// (same resolutions as the desktop apps); tools/build-web-assets.mjs copies public/mk64 and public/mk64-hd.
export default defineConfig(({ mode }) => mode === 'web'
  ? { base: '/play/', build: { outDir: 'website/public/play', emptyOutDir: true, copyPublicDir: false } }
  : { server: { watch: { ignored: ['**/.agent/**', '**/website/**'] } } });
