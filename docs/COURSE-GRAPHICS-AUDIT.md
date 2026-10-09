# Course 3D graphics audit

What the console draws on each course beyond the static course mesh, and what this port draws. Sources: the
decomp at `mk64-master` — `spawn_course_actors` (src/racing/actors.c), `init_actors_and_load_textures`,
`init_course_objects` (src/code_8006E9C0.c), `render_object_for_player` (src/code_80057C60.c) and
`spawn_course_vehicles` (src/cpu_vehicles_camera_path/vehicle_utils.inc.c).

Static course geometry (every packed display list the race renderer reaches) has been ported for all 20 courses
since tools/extract-course.py. Everything below is drawn by actors or objects and isn't part of that mesh.

Status: **done** = ported from ROM data; **—** = missing.

| Course | Actors / objects the console draws | Port |
|---|---|---|
| Mario Raceway | trees (`spawn_foliage`, 27) | **done** (tools/extract-foliage.py, src/foliage.js) |
| | piranha plants (`spawn_piranha_plants`, 10, 9-frame animation) | **done** (tools/extract-piranha.py, src/piranha.js) |
| | Mario signs (`ACTOR_MARIO_SIGN` ×2) | **done** (tools/extract-props.py, src/props.js) |
| | GP balloons (`render_object_grand_prix_balloons`) | — |
| Choco Mountain | falling rocks (`spawn_falling_rocks`) | — |
| Bowser's Castle | bushes (`ACTOR_BUSH_BOWSERS_CASTLE`, 27) | **done** |
| | Thwomps (`render_object_thwomps`, 8 / 11 / 12 by cc, six behaviours) | **done** (tools/extract-thwomp.py, src/thwomp.js) |
| | Thwomps squashing karts, slam dust, camera shake, Thwomp shadows | — |
| | statue fire breath (`render_object_bowser_flame`) | — |
| Banshee Boardwalk | trash bin, bat, Boos (`render_object_trash_bin` / `_bat` / `_boos`) | — |
| Yoshi Valley | trees (13) | **done** |
| | giant Yoshi egg (`ACTOR_YOSHI_EGG`, lit 3D egg near / flat egg far) | **done** (tools/extract-yoshi-egg.py, src/yoshi-egg.js) |
| | flag poles (`func_80055228`), hedgehogs (`render_object_hedgehogs`) | — |
| Frappe Snowland | trees (30) | **done** |
| | snowmen (`render_object_snowmans`, 19, with the snow puffs) | **done** |
| | snowfall (`render_object_snowflakes_particles`, 1P) | — |
| Koopa Troopa Beach | palm trees (`spawn_palm_trees`, 12) | **done** (src/props.js) |
| | crabs (`render_object_crabs`, 10: walk to a patrol point, then back and forth 48, 7-frame animation, spin karts out) | **done** (tools/extract-crabs.py, src/crabs.js) |
| | seagulls, hot-air-balloon item box | — |
| Royal Raceway | trees + castle-garden trees (32) | **done** |
| | piranha plants (`spawn_piranha_plants`, 16) | **done** (src/piranha.js) |
| Luigi Raceway | trees (20) | **done** |
| | hot-air balloon (`render_object_hot_air_balloon`, after a player's first lap, not in time trials) | **done** (tools/extract-balloon.py, src/balloon.js) |
| | the item box under the balloon (`ACTOR_HOT_AIR_BALLOON_ITEM_BOX`), the balloon's shadow | — |
| Moo Moo Farm | trees (21, not in 4P) | **done** |
| | cows (`render_cows`, 37 from `d_course_moo_moo_farm_cow_spawn`, 5 kinds) | **done** (tools/extract-foliage.py → cows.json, src/foliage.js) |
| | moles (`render_object_moles`) | — |
| Toad's Turnpike | box trucks, school buses, tanker trucks, cars (7 each) | **done** (tools/extract-traffic.py, src/traffic.js) |
| | engine hum / horns, karts tumbling when hit | — |
| Kalimari Desert | cacti (44, three kinds) | **done** |
| | train (engine, tender, carriages), railroad crossings ×4 | **done** (tools/extract-train.py, src/train.js) |
| | the locomotive's smoke | — |
| Sherbet Land | emperor penguin, swimming / sliding penguins, see-through ice | **done** (src/penguins.js) |
| Rainbow Road | neon signs (`render_object_neon`, 10: 3 animated, 7 character signs) | **done** (tools/extract-neon.py, src/neon.js) |
| | Chain Chomps (`render_object_chain_chomps`, 3 animated armatures + far sphere) | **done** (tools/extract-chomp.py, src/chomps.js) |
| Wario Stadium | Wario signs (`ACTOR_WARIO_SIGN` ×3) | **done** (src/props.js) |
| D.K.'s Jungle Parkway | trees and palm trees (`render_palm_trees`, 95) | **done** (src/props.js) |
| | paddle-boat ferry (`render_actor_paddle_boat`, 1-2 screens) | **done** (tools/extract-ferry.py, src/ferry.js) |
| | the ferry's smoke, kiwano fruit, torches | — |
| Battle arenas | bomb karts (`render_object_bomb_kart`, battle) | — |
| Every course | item boxes at the course's `item_box_spawns` | race courses place boxes at fractions of the track length (src/items.js `BOX_SPOTS`), not at the ROM spots; arenas use the ROM spots |

## Foliage (done)

`spawn_foliage` puts one actor per spawn-list entry, raised onto the ground when the entry sits under it.
`render_course_actors` draws them with D_801502C0, which turns the model to the camera's yaw, so every tree faces
the screen the same way. They aren't turned towards the camera's position. Each `render_actor_tree_*` stops
drawing past its own x/z distance:

| Course | Display list | Distance |
|---|---|---|
| Mario Raceway | d_course_mario_raceway_dl_tree | 4000 |
| Bowser's Castle | d_course_bowsers_castle_dl_bush | 800 |
| Moo Moo Farm | d_course_moo_moo_farm_dl_tree | 2500 |
| Royal Raceway, id 6 | d_course_royal_raceway_dl_castle_tree (drawn by `render_actor_tree_bowser_castle`) | 2000 |
| others | the course's `dl_tree` / `dl_FC70` (Luigi) / `dl_cactus1-3` | 2000 |

Textures go into segment 3 from 0x03009000, 0x800 apart, in `dma_textures` order, after 16 shell frames and
10 banner textures. CI8 textures use `common_tlut_trees_import`, or the TLUT the list loads itself (Frappe
Snowland, Kalimari Desert). Bowser's bush is the RGBA16 `gTextureShrub`.

Not ported yet: the ground shadow under each tree (`func_8029794C` → common `D_0D007B20`, drawn within 500 units),
karts bumping into trees (the actor bounding boxes), and HD replacements for the CI8 textures
(tools/build-hd-textures.py only matches RGBA16 / IA16 CRCs).

## Moo Moo Farm cows (done)
`render_course_actors` calls `render_cows` on Moo Moo Farm, which walks `d_course_moo_moo_farm_cow_spawn` itself
(37 entries; no actors are spawned, so there's no ground snap and no 4P skip). Each cow is drawn with D_801502C0
at its spawn position (x × `gCourseDirection`), `someId` 0-4 → `dl_cow1`-`dl_cow5`, within 2000
(`distance_if_visible` 4000000). Every list is two 20×40 quads with CI8 32×64 halves from segment 3: the cow
textures follow the two tree halves (`dma_textures` order, 0x0300A000 on). `dl_13B88` loads the 12×17
`d_course_moo_moo_farm_cow_tlut` with `gsDPLoadTLUT_pal256`, so the last 52 palette entries are whatever bytes follow
it in the segment, as on the console. tools/extract-foliage.py writes them to `cows.json`, and src/foliage.js draws
them with the tree code.
Not ported: the moo (sound 0x1901904D from the nearest cow within 400 units, at most every 240 ticks, player 1 only).
## Props from the course data segment (done)

tools/extract-props.py walks each model's display lists in `course_data.c`, checks every vertex array, spawn list
and RGBA16 texture against the ROM's course data segment, and writes `props.json`. src/props.js draws them:

| Course | Console code | Drawing | Distance |
|---|---|---|---|
| Koopa Troopa Beach | `spawn_palm_trees` / `render_actor_palm_tree`, 3 variants | unrotated, lit (`light2`, shaded at extraction: ambient + colour × max(0, n·l), light in world space) | 2000 |
| Mario Raceway | `ACTOR_MARIO_SIGN` ×2 at fixed spots / `update_actor_mario_sign` | + `DEGREES(1)` a tick about the up axis | 4000 |
| Wario Stadium | `ACTOR_WARIO_SIGN` ×3 / `update_actor_wario_sign` | the same | 4000 |
| D.K.'s Jungle Parkway | `func_80298D10` / `render_palm_trees` (y = `unk8`, id = `someId & 0xF`) | ids 0/4/5 face the camera like the foliage, the palm (6) unrotated | 1000 |

In EXTRA the console only negates x positions, so the port flips each model back in its own x (and spins the signs
the other way). Not ported yet: palm tree shadows, kart collisions, and signs / trees flying away when a kart hits
them (flag 0x400).

## Piranha plants (done)
tools/extract-piranha.py reads `d_course_<course>_dl_piranha_plant`, its 30x30 quad, its TLUT and the spawn list from
the course data segment (each verified byte-for-byte) and decodes `gTexturePiranhaPlant1-9` (MIO0, CI8 32x64) through
that TLUT into `piranha-1..9.png` plus `piranha.json`. src/piranha.js draws them like `render_actor_piranha_plant`:
- turned to the camera's yaw (D_801502C0), not lifted onto the ground, drawn within 1000 x/z;
- the list's tile mirrors S at 32 texels (`G_TX_MIRROR | G_TX_WRAP`, mask 5), so the 64-texel-wide quad shows the
  frame and its mirror image (the frames only fill their right half);
- each camera has its own timer (`update_actor_piranha_plant`): + 1 a tick while the plant is in the camera's
  view wedge within 300, > 60 -> 6, otherwise 0; frame = min(8, timer / 6).
Not ported yet: kart collisions (`collision_piranha_plant`) and a hit plant flying up (flag 0x400).
## Yoshi egg (done)
tools/extract-yoshi-egg.py reads `d_course_yoshi_valley_dl_16D70` (the 80-triangle lit egg, `gTextureYoshiValleyEggSpot`
32x32, `d_course_yoshi_valley_lights4`) and `dl_egg_lod0` (the flat far egg, `gTextureYoshiValleyEgg` 64x32) from
the course data segment (vertex arrays and textures verified byte-for-byte), plus the triangles of every
`d_course_yoshi_valley_addr` TrackSections list with their section id. src/yoshi-egg.js:
- `update_actor_yoshi_egg`: circles (-2300, 0, 704) at radius 70, pathRot + 0x5B a tick, eggRot - DEGREES(3) a tick;
- `render_actor_yoshi_egg`: within 4000 of the camera; the screen's track section (pathCounter, from the floor
  triangle under the camera / its kart, func_8029122C) 13-19 draws the 3D egg, F3DEX-lit with the light fixed in world
  space while it turns, otherwise the flat egg turned to the camera's yaw;
- EXTRA: the 3D egg is flipped back in its own x and turns the other way.
Assumption: the port's chase camera rides higher than the console's, so a camera over 30 above its floor takes its
kart's section. Not ported yet: the egg's ground shadow (D_0D007B20), kart collisions and the hop when hit (flag 0x400).
## Kalimari Desert trains and railroad crossings (done)
tools/extract-train.py walks the train and crossing display lists with the tools/extract-props.py walker (vertex arrays
and RGBA16 textures verified byte-for-byte; the `G_RM_AA_ZB_XLU_DECAL` re-draw of each wheel is skipped, it only
blends edges), verifies `d_course_kalimari_desert_train_path` (75 points) and runs `generate_2d_path` on it with the
console's single-precision steps: 465 points, the count the decomp's comment gives. src/train.js:
- `init_vehicles_trains`: two trains from 2D point (i × 465 / 2 + 160) % 465, five passenger cars 4 points apart, the
  tender 3 on, the locomotive 4 on, at the floor height under the first point (D_80162EB0); 1P runs every car, 2P
  outside Grand Prix the tender and car 4, otherwise the locomotive alone;
- `update_vehicle_trains` (once a frame = every other 60 Hz tick): `update_vehicle_following_path` heads 5 units at
  the mean of points + 3 / + 4 past the nearest one, the car turned to its motion; wheels turn - DEGREES(9) a tick
  (tender 7);
- `render_actor_train_*`: three levels of detail by x/z distance (engine 350 / 800, tender and cars 500 / 1000),
  nothing past 3000, the wheels (each pair at its own offset and phase) within 1200;
- `func_80013054` rings crossing 0 / 1 while a locomotive is within 0.42299348 / 0.72017354 of the path (- 0.1,
  + 0.01 + cars × 0.01); `render_actor_railroad_crossing` (4 actors from `spawn_course_actors`) shows
  `dl_crossing_right_active` for timer 1-19 and `_left_active` for 20-40, else `_both_inactive`, within 2000;
- sounds through the penguins' `placedSound` (func_800C98B8): crossing bell 0x19017016 at timer 1 / 20, locomotive bell
  0x1901800E at 2D points 190 / 320, whistle 0x1901800D one frame in 100 (all 500-unit near range).
EXTRA flips each model back in its own x and turns the crossings the other way, as the props.
Not ported yet: the locomotive smoke (`render_object_trains_smoke_particles`), karts tumbling when hit
(`handle_trains_interactions`) and CPU karts stopping at a rung crossing (`check_ai_crossing_distance`).
## Toad's Turnpike traffic (done)
tools/extract-traffic.py walks `render_actor_box_truck` / `_school_bus` / `_tanker_truck` / `_car`'s lists with the
tools/extract-props.py walker. The `toads_turnpike_dl_0`-`11` wrappers (courses/toads_turnpike/course_offsets.c) call
five common_data render-mode lists (0x0D005398-0x0D005418) that exist only as ROM bytes; the extractor checks their
F3DEX words in the common_data MIO0 block (0x132B50) and feeds the walker the matching macros (near / middle:
G_CC_MODULATEIA opaque body + G_CC_MODULATEIDECALA tex-edge parts; far: 2-cycle fog, drawn here without the fog). The
box trucks' three box textures are loaded by dl_23858 / 238A0 / 238E8 before the truck list (actor state 0-2,
D_802BA260 counting 0, 1, 2 as trucks spawn). src/traffic.js:
- route: track path 0 (course.json `path`, 912 points), edges 50 either side (`calculate_track_boundaries`,
  cpu_maximum_separation from yamls/courses/toads_turnpike_metadata.yml), stored as s16;
- `initialize_toads_turnpike_vehicle`: vehicle i of 7 (8 in time trials, of which 7 spawn) at path point
  (i × 912 / n + 0 / 75 / 50 / 25) % 912 for trucks / buses / tankers / cars, lane type random_int(3) (i % 3 in time
  trials), speed cc × 90 / 216 + 4.5833 for type 2 above 50cc or in time trials, else + 2.9167; `spawn_vehicle_on_road`
  steps it once more and faces it DEGREES(180) (0 in EXTRA);
- `update_vehicle_follow_path_point` (every other 60 Hz tick): the lane factor moves 0.06 towards `func_80013C74`'s
  (point < 0x28A: -0.7 / 0 / 0.7, after: -0.5 / -0.5 / 0.5), `func_8000D6D0` heads `speed` units (3D) at the mean of
  `set_track_offset_position` at points + 3 / + 4 past the nearest (`update_path_index` - 3 .. + 6 within 400,
  `adjust_path_at_start_line`); EXTRA uses `func_8000D940`'s points - 3 / - 4, so traffic drives against the karts;
  yaw and pitch turn 100 angle units a step at most (`adjust_angle`), so a vehicle spawned facing the wrong way takes
  ~11 s to come round, as on the console;
- `render_actor_*`: 1P near < 400, middle < 800, far < 3000 (x/z); 2P-4P middle < 400, far beyond; cars scaled 0.1.
EXTRA runs the unmirrored path with the lane factor negated (the mirrored left edge is the mirror of the right one)
and flips each model back in its own x, as the train. Assumption: when no path point is within 400 the nearest point
overall is used (`func_8000D24C` searches the kart's track section). Not ported yet: engine hum and horns
(`func_800C9D80`, `handle_vehicle_interactions`), karts tumbling when hit (VERTICAL_TUMBLE_TRIGGER) and CPU karts
steering round traffic (`update_player_track_position_factor_from_*`).
## D.K.'s Jungle Parkway ferry (done)
tools/extract-ferry.py walks `d_course_dks_jungle_parkway_boat_dl` + `railings_dl` and `paddle_wheel_dl` with the
tools/extract-props.py walker (vertex arrays and RGBA16 textures verified byte-for-byte) in its normals mode: F3DEX
lights a vertex when it is loaded, so each lit vertex keeps its normal and the light in force then (the lists'
`gsSPSetLights1` / `gsSPLight` pairs, `unknown_light1-4`, else the render code's D_800DC610[1]). It verifies
`d_course_dks_jungle_parkway_ferry_path` (31 points), runs `generate_2d_path` on it (345 points) and writes the
`d_course_dks_jungle_parkway_addr` section triangles. src/ferry.js:
- `init_vehicles_ferry`: one boat at 2D point 0, y -40, speed 1.6666666, only with 1-2 screens;
  `spawn_course_vehicles` steps it once and heads it along that step;
- `update_vehicle_paddle_boats` (every other 60 Hz tick): `update_vehicle_following_path` at its speed, then it turns
  towards 2D point + 5 from its old position: more than 0x1770 off, speed - 0.04 (while over 0.2) and up to 0x3C a
  step, else speed + 0.02 (while under 2.0) and up to 0x1E; horn 0x19018047 / 48 one frame in 100;
- `update_actor_paddle_boat`: paddle wheel + DEGREES(5) a tick, drawn turned about x at (0, 16, -255) in the boat;
- `render_actor_paddle_boat`: hidden while the screen's pathCounter is 21-24 (src/sections.js, shared with the Yoshi
  egg) and past 3000 x/z; vertex colours re-lit (ambient + colour × max(0, n·l), light in world space) as it turns.
EXTRA flips the model back in its own x, as the train. Not ported yet: its smoke (`spawn_ferry_smoke`) and karts
tumbling when it hits them (`handle_paddle_boats_interactions`, HIT_PADDLE_BOAT_TRIGGER).
## Luigi Raceway hot-air balloon (done)
tools/extract-balloon.py walks `d_course_luigi_raceway_dl_F960` (balloon + basket) + `dl_F650` (ropes) and the low-detail
`dl_FBE0` + `dl_FA20` with the tools/extract-props.py walker in its normals mode (vertex arrays and RGBA16 textures
verified byte-for-byte; every list sets `d_course_luigi_raceway_light1`), and checks common_data `D_0D0077D0`, the render
setup `func_80043328` runs first (G_LIGHTING | G_CULL_BACK), as raw F3DEX words. src/balloon.js:
- D_80165898: set when a player's lap counter reaches 1 (the HUD lap code), never in time trials; until then nothing is
  updated or drawn;
- `update_hot_air_balloon` (once a frame = every other 60 Hz tick): `init_hot_air_balloon` origin (-176, 0, -2323)
  (x × xOrientation), offset y 300, velocity y -2; `func_80085534` sinks to offset 18, eases the velocity to 0 (± 0.05
  a frame), waits, eases to +1, rises 90 frames, eases to 0 then -1, sinks 90 frames, eases to 0 and holds 90, then
  repeats from the wait: offset 298 down to 16, then between -23 and 88 (the ground under it is at -50);
  direction_angle[1] + 0x100 a frame;
- `render_object_hot_air_balloon` / `func_80055CCC`: `func_8008A1D0(0x5DC, 0xBB8)`, the near model turned by
  direction_angle under 1500 x/z, the far model turned to face the camera (`func_800418AC` + 0x8000) out to 3000; in 1P
  the spin is put back to 0 while it is far; lit (F3DEX, light in world space) and re-shaded as it turns. The far
  model's shading follows screen 1's camera (assumption: one vertex colour set for every screen).
EXTRA flips the model back in its own x and turns it the other way, as the ferry. Not ported yet: the item box hanging
10 below it (`ACTOR_HOT_AIR_BALLOON_ITEM_BOX`, `update_actor_item_box_hot_air_balloon`) and its ground shadow
(`func_8004A6EC`, common `D_0D007B20` within 300, at the surface found by `func_800886F4`).
## Bowser's Castle Thwomps (done)
tools/extract-thwomp.py walks `d_course_bowsers_castle_dl_thwomp` (dl_8F38) with the tools/extract-props.py walker in its
normals mode (vertex arrays and the RGBA16 `gTextureThwompSide` verified byte-for-byte; common_data `D_0D007828`, which sets
G_LIGHTING | G_CULL_BACK, checked as raw F3DEX words). The list's first quad is the face: it takes the texture the render
code loads, the CI8 16x64 `d_course_bowsers_castle_thwomp_faces[textureListIndex]` (6 frames, decoded through
`gTLUTThwomp`), S mirrored at 16 texels and T clamped (`rsp_load_texture_mask`). It also reads the three object-type
lights from the ROM (`func_800534E8`: 0 `D_800E4638`, 1 `D_800E4650` yellow, 2 `D_800E4668`), the three spawn tables
(`gThomwpSpawns50CC` 8, `gThwompSpawns100CCExtra` 11, `gThomwpSpawns150CC` 12, verified in the ROM) and the
`d_course_bowsers_castle_addr` section triangles. src/thwomp.js runs `func_80081210` once a frame:
- behaviours (unk_0D5): 1 `func_8007ED6C` waits 60, slams, turns round when a screen's player is within 300 ahead of its
  camera; 2 `func_8007F5A8` walks a square (x 200 then z -100, mirrored for variant 1) slamming at each corner;
  3 `func_8007FFC0` chases: a human player at path point 170-180 sends every chaser alongside at 1.25 x their speed for
  160 frames (weaving +-40 in z after a random 50-99), 215-225 sends them to the player's x; 4 `func_800801FC` slams
  every 60 frames after a 2 / 60 / 120 / 180 first wait; 5 `func_800808CC` floats at 70, sliding to z -250 and back at
  1 / 1.5, faces 3-5 for ever; 6 `func_80080408` (x 1.5) pulls faces 6 times when a screen comes within 100;
- the slam `func_8007E63C` 0x32-0x36 (rise 1.5 to unk_01C[1] + 15, drop 2, faces 3 then 2, climb back at 0.5), the
  state stack (`func_80072568` / `func_8007266C`), `func_80073E18` turns and `func_800417B4` turn-towards as in the decomp;
- `render_object_thwomps`: drawn while the screen's track section (src/sections.js pathCounter, as the ferry) is within
  one of the Thwomp's unk_0DF and it is in the camera's 180-degree wedge; F3DEX re-lit every frame, type 0's light
  turned by `func_800419F8` ((0, 0, 120) by D_80165834, + 0x100 / + 0x200 a frame);
- sounds through `placedSound`: the slam 0x1900800F when a kart is within 500 (not with 3-4 screens; once per slam,
  assumption), the big one 0x19018045, the floaters 0x19036045 every 64 frames.
EXTRA: the console mirrors every spawn, angle and step, so the port runs the unmirrored behaviour and flips each model
back in its own x (light x negated). The type-3 trigger uses the nearest course path point to the kart (assumption for
`gNearestPathPointByPlayerId`). Not ported yet: squashing karts (`func_80080B28`, THWOMP_SQUISH_TRIGGER and the
0x64-0x6C / 0xC8 states), the slam dust (`func_80080FEC`), camera shake (`func_8001CA10`) and the shadow (`func_8004A7AC`).
## Frappe Snowland snowmen (done)
tools/extract-snowmen.py reads the 19 `gSnowmanSpawns` {x, y, z, section} (verified in the ROM), the common_data quads
`common_vtx_hedgehog` (body), `D_0D0061B0` (head, 12 nearer the camera) and `D_0D005AE0` (snow puff) and checks the render
setup as raw F3DEX words (`D_0D007C88` / `D_0D007D78`: G_TT_RGBA16, G_CC_DECALRGBA, gSPTexture 0x8000, G_TF_BILERP,
G_RM_AA_ZB_TEX_EDGE; `D_0D0069E0`, `common_rectangle_display`); the 64x64 CI8 head / body through `gTLUTSnowman` and the
32x32 CI8 snow through `gTLUTSnow` come from the course data segment, plus the `d_course_frappe_snowland_addr` section
triangles. src/snowmen.js runs `update_snowmen` once a frame:
- head (`func_80083948`, origin y + 8): sways by primAlpha (random start, +- 0x400 every other frame between -0x1000 and
  0x1000), drawn rolled by primAlpha + 0x8000; body (origin y + 3) rolled 0x8000;
- a kart within 2 + its boundingBoxSize (x/z) while a screen's track section is within one of the snowman's
  (`func_8008A8B0` / `func_80089B50`): VERTICAL_TUMBLE_TRIGGER through `Items.hit(kart, 'fake_item_box')` (a star kart
  only hears 0x19018010), the body vanishes, `func_800836F0` bursts 40 / 24 / 16 puffs by screens (4.5-5.4 out on even
  headings, 2.6-12.1 up, - 0.74 a frame for 100 frames, spinning, 0.05-0.149 scale), the head flies 72.5 up and falls to
  -7; after 300 frames the head climbs back at 0.2, 10 frames later the body regrows 0.001 -> 0.1 by 0.0025 a frame;
- `render_object_snowmans`: both turned to the camera from the body within 600 (`func_8008A364` view wedge 0x5555 /
  0x4000 / 0x2AAB by distance), the puffs within 500.
EXTRA flips each quad back in its own x (roll negated). Not ported yet: the snowfall (`gObjectParticle1`, 1P) and the
time-trial replay flag (`func_80072180`). Assumption: a kart already tumbling, out or in a Boo is not hit (EXPLOSION_CRASH
/ BOO effects); `Items.hit` also skips a kart that is spinning or invulnerable, though the snowman still breaks.
## Rainbow Road neon signs (done)
`tools/extract-neon.py` writes `public/mk64/rainbow-road/neon.json` and one PNG per sign and palette frame (22): the
64x64 CI8 textures from the course data segment through each TLUT, the `common_vtx_hedgehog` quad, and the 7 static
positions `D_800E6734` (checked in the ROM). The three animated signs' positions and every animation call are checked in
`update_objects.c`. `src/neon.js` (`update_neon`, once a frame):
- mushroom (`func_80085CA0`, -1431, 827, -2957): TLUTs 0-4 every 12 frames x5, blink 3/4 every 4 frames x10, wait 20,
  count x5, wait 20, blink 3/4 every frame x20 — a 787-frame loop (TLUT 4 is all black);
- Mario (`func_80085E38`, 799, 1193, -5891): count 0-4 every 12, blink 3/4 once, dark 12 (`func_80072B48`) — 102 frames;
- Boo (`func_80085F74`, -2013, 555, 0): count 0-4 every 5, wait 30, flash on/off every frame x7 (`func_80072C00`), wait
  30, count 3-0 every 5 (`func_80072F88`), dark 15 — 141 frames;
- Peach, Luigi, DK, Yoshi, Bowser, Wario, Toad (`func_80086074`): lit, never change.
`render_object_neon`: each turned to the camera (roll 0x8000) at 8x scale (512 units wide), alpha-tested
(G_RM_AA_ZB_TEX_EDGE), only inside the camera's 0x2AAB view wedge, with no distance limit. EXTRA flips each quad back in its
own x. Not in the credits sequence (the port has none).
## Rainbow Road Chain Chomps (done)
`tools/extract-chomp.py` writes `public/mk64/rainbow-road/chomp.json` and 5 PNGs: the armature `d_rainbow_road_unk4`
(7 limbs, 138 triangles: body halves `dl_15550` / `dl_15C68` metal and jaws `dl_151A8` / `dl_158C0` gold as
G_TEXTURE_GEN reflection maps, the tongue G_CC_MODULATEI with vertex colours, the eyes G_CC_MODULATEIA lit by `light1`),
its one 20-frame animation `d_rainbow_road_unk2`, and the far-away sphere picture (32x64 RGBA16 mirrored on S to 64x64,
quad `D_0D0062B0`). Every vertex array, the angle / limb tables and the animation header are checked in the course data
segment, the common_data display lists `D_0D0077D0` / `D_0D0079C8` / `D_0D0078F8` as raw F3DEX words, and every
constant in `update_objects.c` / `render_objects.c`. `src/chomps.js` (`update_chain_chomps`, once a frame):
- chomp i starts on track path point i * 300 + 500, origin (0, -15, 0), scale 0.03 (`func_80085878`);
- the animation steps a frame a frame (0..19); every 64th frame it rattles (0x19018057, heard from where it is);
- `func_80074344` swings its lateral factor -0.8 .. 0.8 by 0.03 a frame; `func_8000D940` moves it 4 units towards path
  points - 3 / - 4 (against the karts) at that factor between the path's 50-unit edges; it faces the way it moved;
- `func_80089CBC(30)`: a kart within 10 + its box (x/z) and 30 (y) tumbles (`Items.hit(kart, 'fake_item_box')`); a star
  kart drives through.
`render_object_chain_chomps` / `func_8008A1D0(1500, 2500)`, per screen: hidden past 2500 (x/z) or outside the view wedge;
within 1500 the armature, beyond it the sphere picture at 0.54, 16 up, turned to the camera and rolled 0x8000.
Assumption: G_TEXTURE_GEN uses the RSP's default lookat X (1, 0, 0) / Y (0, 1, 0) — the game never sets gSPLookAt — dotted
with the world-space normal. EXTRA runs the unmirrored path with the factor negated and flips the model in its own x.
Not ported: the time-trial replay flag (`func_80072180`).
