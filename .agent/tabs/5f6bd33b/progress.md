# Auto-pilot session — 2026-10-06
Goal: Match Mario Kart 64 graphics using assets extracted from the supplied local ROM.

## Cycle 1: native kart sprite extraction
Added tools/extract-karts.py (Python standard library only).
Input: /Users/toddbruss/Downloads/Mario Kart 64 (USA).z64.
Verified SHA-1: 579c48e211ae952530ffc8738709f078d5dd215e.
Extracted 321 native 64x64 CI8 frames for each of eight drivers (2,568 total), with stitched body/wheel RGBA5551 palettes and transparency.
Outputs: public/mk64/karts/{mario,luigi,peach,toad,yoshi,donkeykong,wario,bowser}.png and manifest.json. Atlases are 1344x1024; manifest includes source metadata, image and individual decoded-frame hashes.
Metadata and decoder reference downloaded from n64decomp/mk64 master to /tmp/agent-mk64-source/mk64-master. Regeneration currently requires this external metadata directory (--metadata).
Validation: all 2,568 decompressed CI8 frames byte-identical to upstream libmio0.c decoder compiled locally as a dylib. Eight PNG CRCs/decompressed dimensions and dist copies verified. Known RGBA5551 colors and invalid MIO0 rejection passed.
npm run build: PASS (large-chunk warning).
Upstream make tools target unavailable in downloaded archive; direct cc compilation of libmio0.c + utils.c succeeded for independent validation.
Parity: registry.json contains only this primary workFolder; no separate parity folders specified. No mirror performed.
This cycle supplies actual assets, NOT a verified replica. src/kart.js still constructs procedural models; renderer integration, camera-angle/frame mapping, wheel animation, authentic course geometry/textures, UI and visual comparison remain.
No ROM downloaded or committed. No publish/push performed.
