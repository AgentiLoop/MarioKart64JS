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
## Cycle 1 — 2026-10-06 14:16
Committed 91ced6b: extracted actual kart artwork from your Downloads ROM—2,568 native 64×64 frames across all eight drivers, saved as PNG atlases in public/mk64/karts. Added a reproducible Python extractor and hash manifest. All decoded frames matched the upstream C decoder byte-for-byte; PNG validation and npm run build passed (large-chunk warning only).

Not yet a Mario Kart 64 replica: the game still renders procedural karts (src/kart.js:7–55,66). Next work is integrating the extracted sprites with correct view-angle selection; authentic courses and visual parity remain unverified. Extraction regeneration requires external metadata currently under /tmp/agent-mk64-source/mk64-master. No separate parity folder was specified or present in the tab registry. No ROM download or publication performed.

## Cycle 2 — native sprite renderer
Committed a3841f3 (renderer), 05b351a (eight-driver grid), fab90f5 (tests).
Replaced procedural kart models with native atlas billboards: camera-relative normal/spinout frame selection and horizontal mirroring, nearest filtering, sRGB, alpha test, depth writing. src/kart.js:7–55,58–65,190–194.
All eight named drivers race; restart disposes sprite maps/materials; ordinal suffixes support eight positions. src/main.js:42–67,139.
Assumptions: neutral-slope group 4 and fixed 4.5 world-unit sprite size; not verified original camera/scale parity. Angle mapping follows local upstream src/player_controller.c:724–834 and src/kart_dma.c:44–49,99–103,125–135.
Validation: npm run build PASS (large-chunk warning); node --test tools/test-karts.mjs PASS (all 65536 N64 angle bins normal/spin, atlas UVs, camera yaw, disposal). Browser check /tmp/mk64-browser-check/check.mjs PASS: all eight textures loaded, 32 GPU-rendered cardinal views matched source atlas pixels with RGB tolerance 1, transparency/mirroring correct, no GL/page/HTTP errors, eight textures disposed on restart, acceleration passed. Screenshot: /tmp/mk64-native-karts-race.png. Temporary Playwright installed outside repository.
Remaining: native course geometry/textures, slope-specific kart groups, wheel-palette cycling, authentic camera/scale/shadows, UI/items/audio and visual comparison against original. Full replica goal NOT reached. Metadata regeneration still depends on /tmp/agent-mk64-source/mk64-master. Registry has only primary workFolder; no parity folder to mirror. No push/publication or ROM download.


## Cycle 2 — 2026-10-06 14:24
Committed native kart rendering: a3841f3, 05b351a, fab90f5. The race now uses all eight extracted drivers instead of procedural kart models, with camera-relative sprite selection, mirrored sides and spinout views (src/kart.js:7–65; src/main.js:42–67).

Verified: build passed; all 65,536 angle bins tested for normal/spinout selection; 32 GPU-rendered views matched atlas pixels within one RGB level; all eight textures loaded; restart disposal and acceleration passed; no browser or GL errors. Screenshot saved to /tmp/mk64-native-karts-race.png.

Not yet a verified replica. Remaining: authentic courses, slope-specific frames, wheel animation, camera/scale parity and original-game visual comparison. This step assumes neutral-slope sprites at fixed scale. No parity folder is registered. Extraction regeneration still relies on temporary upstream metadata. No publication or push performed.

Session ended — Stop All (2026-10-06 14:34)

# Auto-pilot session — 2026-10-06 14:34
Goal: I said you had to match the graphics from MarioKart64. can you download its assets somewhere? or get them from the binary in downloads? we already have GoKart. we want a MarioKart64 replica. if you cannot match the assets then exist this exercise. this is a test how good your LLM is, not going to commericla or published, it's fair use. There is also this for reference: /Users/toddbruss/Downloads/mk64-master
Budget: no time limit, unlimited cycles


## Cycle 3 — Luigi Raceway native course
Commits: 0156021 (extractor + 40 ROM textures + course.json), 7b9ef99 (render native course as track 1, no procedural scenery), 11f4565 (tools/test-course.mjs), latest (JSON import attribute fix; restores tools/test-karts.mjs under Node).
Validation: node --test karts+course 6/6 PASS (3022 tris, all batch textures exist, all 631 waypoints over native road tris, loop closed). npm run build PASS. Browser /tmp/mk64-browser-check/course.mjs PASS: 43 meshes, 40 textures loaded, 0 procedural objects, GPU-rendered Road1 pixels 100% within native palette, no page/GL/HTTP errors, karts accelerate. Screenshot /tmp/mk64-luigi-raceway.png.
Limitations: physics still follows spline route with flat banking and old HALF_WIDTH/WALL_D (not native collision); 0.1 scale assumed; no sky/background, animated flags/signs, item boxes or native camera. Other 4 tracks remain procedural. No parity folder.
## Cycle 1 — 2026-10-06 14:36
Luigi Raceway now uses the course geometry and textures pulled from the original game. It's track 1 in the selector, it races, and it builds cleanly. The whole game is still not a full Mario Kart 64 replica.

**What I did (commits 7b9ef99, 11f4565, 68c8723):**
- **Course rendering (`src/track.js`):** the course is built from the 3,022 triangles and 40 textures extracted earlier from your ROM (commit 0156021). The original vertex colours and texture wrapping are kept, and textures render with hard pixel edges. None of my hand-made scenery is added on top.
- **New test (`tools/test-course.mjs`):** checks that the course data and texture files are all present. It also checks that all 631 route points sit on road triangles and that the route forms a closed loop.
- **Fix:** loading the course data had broken the existing kart tests. I changed how the file is imported, and they pass again.

**Checks run:**
- All 6 tests pass (3 kart, 3 course), and `npm run build` succeeds (only the usual large-file warning).
- In a headless browser, all 40 textures loaded and nothing on the course is procedural. Every rendered pixel of a sampled road section matched the original road texture's colours. There were no page, graphics or network errors, and the karts accelerate.
- Screenshot: `/tmp/mk64-luigi-raceway.png`. I didn't look at it myself; a colour count shows grey road, green grass and blue/yellow signs. Please glance at it.

**Assumptions:** the course is scaled down by 10× to fit the scene, which I haven't checked against the original. Banking is turned off on this course.

**What's still missing:**
- Karts still drive along a smoothed route with the old road and wall widths, not the original collision surfaces.
- No sky or background, no animated flags or signs, no original item boxes, and the camera and kart size don't yet match the original.
- Karts don't use the uphill/downhill sprites and their wheels don't animate.
- The other 4 tracks are still my own procedural courses.
- HUD, items and audio aren't from the original game, and there's been no side-by-side comparison with real gameplay.

**Blockers:** none. Re-running the extraction still depends on reference data downloaded to `/tmp/agent-mk64-source`, which won't survive a restart. No parity folder is registered, so nothing was mirrored. Nothing was pushed or published.


## Cycle 2 (session 2) — Mario Raceway native course
Commits ab1a172 (generic extractor + Mario Raceway assets; Luigi regenerated identically apart from new alphaTest/edgeLists fields), 98adb6a (track 2 = Mario Raceway), c3d0c39 (tests for both courses).
Extraction now uses /Users/toddbruss/Downloads/mk64-master (source hashes identical to /tmp copy), no /tmp dependency.
Validation: node --test 9/9 PASS; npm run build PASS; browser mario.mjs PASS (31 meshes, 2549 tris, 29 textures, 0 procedural, road texels 0 non-native, no errors); luigi course.mjs still PASS. Screenshot /tmp/mk64-mario-raceway.png.
Remaining: 14 other courses, sky, actors (trees/piranha plants), native collision, camera parity, HUD/items/audio.
## Cycle 2 — 2026-10-06 14:40
Mario Raceway now uses the course geometry and textures from your ROM. It is track 2 in the selector, all tests and the build pass, and Luigi Raceway still renders correctly. The game is still not a full Mario Kart 64 replica.

**What I did (commits ab1a172, 98adb6a, c3d0c39):**
- **Extractor (`tools/extract-course.py`):** it now handles more than one course; you pick one with `--course luigi_raceway` or `--course mario_raceway`. For Mario Raceway it pulled 2,549 triangles, 29 textures and the 499-point route, all checked against the ROM.
- **No more temporary files:** extraction now reads from your `/Users/toddbruss/Downloads/mk64-master` folder instead of the copy in `/tmp`. The two copies have identical source files.
- **Luigi Raceway re-extracted:** the output matches the old version except for two new fields that mark which surfaces are see-through (like the flags).
- **Game (`src/track.js`):** Mario Raceway was added as track 2. See-through edges on flags and signs now come from the extracted data instead of a hard-coded texture name. The procedural tracks were kept and moved down the list.
- **Tests (`tools/test-course.mjs`):** both courses are now checked, including that every route point sits on the road texture and that the route forms a closed loop.

**Checks run:**
- All 9 tests pass and `npm run build` succeeds (only the usual large-file warning).
- In a headless browser, Mario Raceway loads 2,549 triangles and 29 textures with nothing procedural. Every rendered pixel of a sampled road section matched the original texture's colours. There were no page or graphics errors, and the karts accelerate. The Luigi Raceway browser check still passes.
- Screenshot: `/tmp/mk64-mario-raceway.png`. I couldn't view the image, only count its colours: mostly blue, then red/yellow, green and grey. The blue is probably the background showing where there is no sky yet, but please take a look.

**What's still missing:**
- The other 14 original courses (adding each one needs its own display-list entries in the extractor).
- No sky, and no course objects such as Mario Raceway's trees and Piranha Plants, animated signs or item boxes.
- Karts still follow a smoothed route instead of the original collision surfaces, and the camera, scale and slope sprites don't match the original.
- HUD, items and audio aren't from the original game.

**Blockers:** none. No parity folder is registered, so nothing was mirrored. Nothing was pushed or published.


## Cycle 3 — all 16 race courses native
Commits 4d76cc3 (extractor walks render_course_segments section arrays + course_data wrappers for render mode/texture state; IA16; tile origins; XLU pass; collision/credits-only lists excluded; all 16 courses extracted), 602c720 (track.js fetches course.json on demand, 16 courses in cup order, translucent batches, tileOrigin UVs; tests for all 16).
Mario Raceway: 266 road tris now use gMRTextureRoad0 (state set by course_data wrapper) instead of stale RoadFinish0/674354.
Validation: node --test 51/51; npm run build OK (bundle 571 kB, course JSON no longer bundled); browser all.mjs: 16/16 courses load expected tris, 0 broken textures, 0 procedural, 0 errors, karts reach 32.8 m/s; mario.mjs/course.mjs still PASS. Screenshots /tmp/mk64-course-<id>.png.
Remaining: sky/backgrounds, actors (trees, piranha plants, cows, trains, item boxes), animated textures, 4 battle courses, native collision/physics, camera/HUD/audio parity.
## Cycle 3 — 2026-10-06 14:53
All 16 original Mario Kart 64 race courses now use the geometry and textures from your ROM, and every one can be picked and raced. All tests and the build pass, and each course loaded cleanly in a browser check. The game is still not a full replica: there's no sky, and the trees, item boxes and other course objects are still missing.

**What changed (commits 4d76cc3, 602c720):**
- **Extractor (`tools/extract-course.py`):** it now follows the same per-section display lists the original game draws during a race, instead of one combined list per course. That fixes several things:
  - Textures and draw modes set by the game's wrapper lists are now applied.
  - It reads two more texture types used by water and signs.
  - See-through surfaces are flagged, such as Rainbow Road's surface, Koopa Troopa Beach's water and Sherbet Land's ice.
  - Invisible collision-only geometry and geometry only used in the credits are left out. Every course is checked against the ROM as before.
- **Mario Raceway fix:** 266 road triangles were previously showing a leftover finish-line or other texture. They now show the correct road texture.
- **Game (`src/track.js`, `src/main.js`):** all 16 courses are in the menu in cup order, from Luigi Raceway to Rainbow Road, with my own procedural tracks after them. Course data now loads only when you pick a course, so it's no longer bundled into the game code. The JavaScript bundle is now 571 kB.
- **Tests (`tools/test-course.mjs`):** every course is checked for triangle and texture integrity, that each route point sits over the course, and that the route closes into a loop. Luigi and Mario Raceway also keep the stricter on-the-road check.

**Checks run:**
- All 51 tests pass and `npm run build` succeeds (only the usual large-file warning).
- In a headless browser, all 16 courses loaded the expected number of triangles with no broken textures, no procedural fill-ins and no page errors, and the karts accelerated on each one.
- The existing detailed checks on Luigi and Mario Raceway still pass: every rendered road pixel matched the original texture colours.
- Screenshots are at `/tmp/mk64-course-<id>.png`, for example `/tmp/mk64-course-rainbow.png`. I didn't look at them, so please do.

**Assumptions:**
- See-through surfaces use the texture's own transparency. The extracted course data carries no per-vertex transparency (it's always zero), and I haven't found where the original game sets it.
- Every course still uses the same default sky colours, and karts follow a smoothed version of the original route.

**What's still missing:** sky and backgrounds; course objects (trees, Piranha Plants, cows, trains, item boxes) and animated textures; the 4 battle courses; driving on the original collision surfaces; and matching camera, HUD and audio.

**Blockers:** none. No parity folder is registered, so nothing was mirrored. Nothing was pushed or published.


## Cycle 4 — native skybox
Commit 7e6d3f1. src/track.js NATIVE_SKY (verbatim yamls/courses/*_metadata.yml sky_colors/sky_colors2) + nativeSkyColors() (low-byte u8 truncation per skybox_and_splitscreen.c:313-317,410-440). src/main.js: screen-space two-quad gradient split at projected y=0 horizon (30000 native units along camera heading — assumption vs original fixed +Z point), raw colour output; procedural tracks keep the dome.
Validation: tools/test-sky.mjs 4/4 (table == decomp yaml; both 21-entry s16 tables found verbatim in ROM; truncation). node --test tools/*.mjs 55/55. npm run build OK. Browser /tmp/mk64-browser-check/sky.mjs: all 16 courses, top-centre pixel == expected byte colour, 0 errors; screenshots /tmp/mk64-sky-<id>.png.
Remaining: clouds/stars (course_init_cloud, update_clouds/func_800788F8, cloud textures D_8018D220), item boxes/trees/actors, animated textures, battle courses, native collision, camera/far-plane parity (gCourseFarPersp), HUD/audio.
## Cycle 4 — 2026-10-06 14:58
All 16 courses now have their original Mario Kart 64 sky instead of the shared placeholder. In a browser check, each course's sky came out in the exact colours from the game. Clouds and stars aren't done yet, so the game is still not a full replica.

**What changed (commit 7e6d3f1):**
- **Sky colours (`src/track.js`):** each course gets its own sky colours, copied exactly from the reference project's course data in `/Users/toddbruss/Downloads/mk64-master`. The game only uses the last byte of each stored number, and I do the same. For example, Luigi Raceway fades from (128, 184, 248) at the top of the screen to (216, 232, 248) at the horizon.
- **Sky drawing (`src/main.js`):** like the original, the sky is drawn flat on the screen in two parts that meet at the horizon line, updated every frame from the camera. Colours go to the screen unchanged. My own procedural tracks keep their old sky.
- **New test (`tools/test-sky.mjs`):** checks that all 16 courses have colours and that they match the reference data. It also confirms both colour tables appear byte for byte in your ROM, so the colours are the game's own.

**Checks run:**
- All 55 tests pass and `npm run build` succeeds (only the usual large-file warning).
- In a headless browser, I compared the rendered sky on all 16 courses with the expected colours. The pixel at the top centre of the screen matched exactly on every course, with no page errors.
- Screenshots are at `/tmp/mk64-sky-<id>.png`, for example `/tmp/mk64-sky-luigi.png`. I only checked pixel values, so please take a look at them.

**Assumptions:**
- The original finds the horizon using a fixed point straight ahead in the world, which would put it in the wrong place when you face the other way. I use a point straight ahead of the camera instead.
- Koopa Troopa Beach comes out teal, (48, 152, 120), and Bowser's Castle purple, (48, 8, 120). That follows from how the game reads its stored colours, but I haven't compared it with real gameplay.

**What's still missing:** clouds and stars, the next step towards finishing the sky (the starting points in the reference code are noted in project memory); trees, Piranha Plants, cows, trains and item boxes; animated textures; the 4 battle courses; driving on the original collision surfaces; and matching draw distance, camera, HUD and audio.

**Blockers:** none. No parity folder is registered, so nothing was mirrored. Nothing was pushed or published.


## Cycle 5 — native clouds and stars
Commit 692c961. tools/extract-sky.py -> public/mk64/sky/clouds-0..5.png (gTextureExhaust0-5 MIO0 @ assets.json offsets, read as 64x32 I4 frames per D_8018D220 u8[1024]) + star.png (common_data MIO0 @0x132B50 +0x293D8, 16x16 I4); white RGB, alpha = I4*17. track.js NATIVE_CLOUD_DATA (verbatim some_data.c), NATIVE_CLOUDS wiring (Mario: init Kalimari, update Luigi), STAR_TWINKLE, nativeClouds(), cloudScreenX() (func_800788F8, zoom 40). main.js: screen-space quads, x=160+(1.7578125/80)*s16(yaw+rotY), y = horizon row - posY, scale/100, quads D_0D005FB0 / common_vtx_rectangle, custom alpha blend, discard below horizon except rainbow, 30 Hz min/max star alternation.
Validation: tools/test-clouds.mjs 5/5 (lists==decomp, lists+terminator verbatim in ROM, PNG texels==ROM I4, quad vertices==ROM); node --test 60/60; build OK. Browser /tmp/mk64-browser-check/clouds.mjs on 11 sky courses: isolated clouds per-pixel alpha vs CPU bilinear texture mean abs err <=0.0034, 0 changed pixels below horizon, stars present on toad/rainbow/wario, 0 errors. Screenshots /tmp/mk64-clouds-<id>[-race].png.
Assumptions: no ±50° cull (widescreen), 30 Hz twinkle, horizontal scale = height/240.
Remaining: Frappe snowflakes, item boxes/trees/actors, animated textures, battle courses, native collision, camera/far-plane parity, HUD/audio.
## Cycle 5 — 2026-10-06 15:20
The 8 cloudy courses now have their original Mario Kart 64 clouds, and Toad's Turnpike, Rainbow Road and Wario Stadium have their twinkling stars. Textures and positions come straight from your ROM and the reference project. All 60 tests pass, the build succeeds, and an automated browser check showed no page errors on any of the 11 courses. The game is still not a full replica: course objects (trees, item boxes and so on) aren't done yet.

**What changed (commit 692c961):**
- **New extractor (`tools/extract-sky.py`):** pulls the 6 cloud textures and the star texture out of your ROM into `public/mk64/sky/`. They're drawn white, with see-through edges as in the game.
- **Placement data (`src/track.js`):** each course's cloud and star list is copied unchanged from `/Users/toddbruss/Downloads/mk64-master`. Mario Raceway follows a quirk in the original: it takes cloud size and shape from Kalimari Desert's list but horizontal positions from Luigi Raceway's.
- **Drawing (`src/main.js`):** as in the original, clouds are flat images on the screen that slide sideways as the camera turns and sit at a fixed height above the horizon line. They're hidden below the horizon, except on Rainbow Road where stars show everywhere. Each star flickers between two brightness levels.
- **New test (`tools/test-clouds.mjs`):** checks that the lists match the reference code and appear byte for byte in the ROM, and that the extracted images and quad shapes match the ROM data.

**Checks run:**
- All 60 tests pass and `npm run build` succeeds (only the usual large-file warning).
- In a headless browser on all 11 courses, I hid everything except the sky and compared each cloud that was fully on screen and not overlapping another pixel by pixel with the expected result. The average error was at most 0.0034 (under one colour step), and nothing below the horizon changed.
- Koopa Troopa Beach had no cloud that met those conditions at the camera angle tested, so its pixel comparison didn't run (no pixels below its horizon changed). On the 3 star courses I only checked that star pixels appear.
- Screenshots are at `/tmp/mk64-clouds-<id>.png` (sky only) and `/tmp/mk64-clouds-<id>-race.png` (normal view). I couldn't view them myself, so please take a look.

**Assumptions:**
- The original hides clouds more than 50° off-centre, which would make them pop in and out inside a widescreen view, so I don't hide any.
- Stars flicker 30 times a second, which I believe is the game's update rate but haven't confirmed.
- Cloud and star sizes scale with screen height, matching the original's 320×240 frame.

**What's still missing:** Frappe Snowland's snowflakes; trees, Piranha Plants, cows, trains and item boxes; animated textures; the 4 battle courses; driving on the original collision surfaces; and matching camera, draw distance, HUD and audio.

**Blockers:** none. No parity folder is registered, so nothing was mirrored. Nothing was pushed or published.

Session ended — Stop All (2026-10-06 15:24)

