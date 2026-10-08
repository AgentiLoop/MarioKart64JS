import { defineConfig } from 'vite';

// `vite build --mode web` (npm run build:web) is the hosted copy at mk64js.gokart.games/play/: it lands in
// website/public/play so `wrangler deploy` ships it with the site's static assets. Only the 1x + 2x texture tiers
// go online (src/hd.js caps the presets in web mode), so the public dir is not copied wholesale —
// tools/build-web-assets.mjs copies public/mk64 and public/mk64-hd/2x instead.
export default defineConfig(({ mode }) => mode === 'web'
  ? { base: '/play/', build: { outDir: 'website/public/play', emptyOutDir: true, copyPublicDir: false } }
  : { server: { watch: { ignored: ['**/.agent/**', '**/website/**'] } } });
