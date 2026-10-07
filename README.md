# MarioKart64JS

A browser clone of **Mario Kart 64** (built for testing purposes — to see how far AI/LLM tech can duplicate the game). Three.js + Vite, no emulator: the original N64 ROM's assets are extracted and re-used directly.

- `npm install && npm run dev` → http://localhost:5173
- Title screen → SELECT COURSE → race (Enter / click / arrows)
- Controls: ↑/W gas · ↓/S brake · ←→/AD steer · Space drift (release for mini-turbo) · Shift/E use item · R restart · G resolution (1× 240p / 2× 480p / 4× 960p / Native) · N music · M course menu. Gamepad supported.

## What's implemented

- **Title screen** — ROM-extracted Mario Kart 64 logo, "©1996 Nintendo" copyright, flashing PUSH START button (blink at the native `(gGlobalTimer / 8) % 3` cadence) over the TKMK00-decoded blue-sky background.
- **Course select** — 16 native MK64 courses with ROM course-preview thumbnails on the sunset menu background.
- **Native courses** — all 16 MK64 tracks reconstructed from the ROM's course geometry + textures (MIO0/CI8/RGBA16 decoders in `tools/`).
- **Driving** — kart physics in the track Frenet frame; karts ride the native course surface and can't drive through walls.
- **Items** — item boxes give MK64 items (shell, banana, mushroom…).
- **Presentation** — N64-style 240-line upscaled render, or 2×/4×/Native with smooth mipmapped textures and optional HD texture tiers (G cycles, remembered), native skybox gradients, clouds/stars.
- **HUD** — position, lap, race timer, speedometer, minimap.

## Asset extraction

`tools/` contains Python scripts that pull assets straight from a Mario Kart 64 (USA) ROM:

- `extract-karts.py` — kart sprite atlases (8 drivers)
- `extract-faces.py` — character-select face animation frames (17 per driver)
- `extract-previews.py` — course preview thumbnails (16 race + 4 battle)
- `tkmk00.py` — TKMK00 decoder (menu backgrounds)
- `extract-item-boxes.py` — item box model, "?" card texture and per-course spawns

ROM SHA-1: `579c48e211ae952530ffc8738709f078d5dd215e`

### Graphics QC

`node tools/qc-graphics.mjs [--course mario] [--presets 1x,4x] [--shots /tmp/mk64-qc]` starts Vite and drives
every course in headless Chromium (needs `playwright-core`; set `PLAYWRIGHT_CORE` to its path if it is not
installed locally). It fails on failed requests, console errors, textures not loaded at the expected HD
tier, and z-fighting: each view is rendered as a flat per-batch ID buffer and again with sub-millimetre
camera jitter, and pixels inside a surface that change batch are counted as flicker.

### HD textures (optional)

`python3 tools/build-hd-textures.py /path/to/MK64-Reloaded-master` (needs Pillow) builds 2×/4×
versions of every matching image into `public/mk64-hd/` (git-ignored) from the
[MK64 Reloaded](https://github.com/GhostlyDark/MK64-Reloaded) pack. Course textures are matched by their
Rice/GLideN64 CRC, menus/faces/karts/sky by decomp name via the pack's SpaghettiKart port. The 2×/4×
presets use the matching tier (Native uses 2× below 720 lines, else 4×); kart atlases stop at 2× to keep
VRAM sane. Missing images fall back to the ROM originals.

## Roadmap

- Character select with animated faces
- Battle mode (4 battle arenas)
- More gameplay parity (CC classes, AI personalities, Lakitu)

Reference: [n64decomp/mk64](https://github.com/n64decomp/mk64).

Hi-res graphics from [MK64-Reloaded](https://github.com/GhostlyDark/MK64-Reloaded).

*This is a fan research project for AI-duplication testing. Mario Kart 64 is © Nintendo; assets belong to Nintendo and this repo is not affiliated with or endorsed by Nintendo.*