# TarioKart 64

A browser clone of **Mario Kart 64** (built for testing purposes — to see how far AI/LLM tech can duplicate the game). Three.js + Vite, no emulator: the original N64 ROM's assets are extracted and re-used directly.

- `npm install && npm run dev` → http://localhost:5173
- Title screen → SELECT COURSE → race (Enter / click / arrows)
- Controls: ↑/W gas · ↓/S brake · ←→/AD steer · Space drift (release for mini-turbo) · Shift/E use item · R restart · G retro/HD · N music · M course menu. Gamepad supported.

## What's implemented

- **Title screen** — ROM-extracted Mario Kart 64 logo, "©1996 Nintendo" copyright, flashing PUSH START button (blink at the native `(gGlobalTimer / 8) % 3` cadence) over the TKMK00-decoded blue-sky background.
- **Course select** — 16 native MK64 courses with ROM course-preview thumbnails on the sunset menu background.
- **Native courses** — all 16 MK64 tracks reconstructed from the ROM's course geometry + textures (MIO0/CI8/RGBA16 decoders in `tools/`).
- **Driving** — kart physics in the track Frenet frame; karts ride the native course surface and can't drive through walls.
- **Items** — item boxes give MK64 items (shell, banana, mushroom…).
- **Presentation** — N64-style 240-line upscaled render (G toggles HD), native skybox gradients, clouds/stars.
- **HUD** — position, lap, race timer, speedometer, minimap.

## Asset extraction

`tools/` contains Python scripts that pull assets straight from a Mario Kart 64 (USA) ROM:

- `extract-karts.py` — kart sprite atlases (8 drivers)
- `extract-faces.py` — character-select face animation frames (17 per driver)
- `extract-previews.py` — course preview thumbnails (16 race + 4 battle)
- `tkmk00.py` — TKMK00 decoder (menu backgrounds)
- `extract-item-boxes.py` — item box sprites

ROM SHA-1: `579c48e211ae952530ffc8738709f078d5dd215e`

## Roadmap

- Character select with animated faces
- Battle mode (4 battle arenas)
- More gameplay parity (CC classes, AI personalities, Lakitu)

Reference: [n64decomp/mk64](https://github.com/n64decomp/mk64).

*This is a fan research project for AI-duplication testing. Mario Kart 64 is © Nintendo; assets belong to Nintendo and this repo is not affiliated with or endorsed by Nintendo.*