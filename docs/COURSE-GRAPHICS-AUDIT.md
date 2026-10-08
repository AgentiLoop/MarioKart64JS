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
| | Thwomps (`render_object_thwomps`, count by cc) | — |
| | statue fire breath (`render_object_bowser_flame`) | — |
| Banshee Boardwalk | trash bin, bat, Boos (`render_object_trash_bin` / `_bat` / `_boos`) | — |
| Yoshi Valley | trees (13) | **done** |
| | giant Yoshi egg (`ACTOR_YOSHI_EGG`, lit 3D egg near / flat egg far) | **done** (tools/extract-yoshi-egg.py, src/yoshi-egg.js) |
| | flag poles (`func_80055228`), hedgehogs (`render_object_hedgehogs`) | — |
| Frappe Snowland | trees (30) | **done** |
| | snowmen (`render_object_snowmans`), snowfall (`render_object_snowflakes_particles`, 1P) | — |
| Koopa Troopa Beach | palm trees (`spawn_palm_trees`, 12) | **done** (src/props.js) |
| | crabs, seagulls, hot-air-balloon item box | — |
| Royal Raceway | trees + castle-garden trees (32) | **done** |
| | piranha plants (`spawn_piranha_plants`, 16) | **done** (src/piranha.js) |
| Luigi Raceway | trees (20) | **done** |
| | hot-air balloon (`render_object_hot_air_balloon`) | — |
| Moo Moo Farm | trees (21, not in 4P) | **done** |
| | cows (`render_cows`, 37 from `d_course_moo_moo_farm_cow_spawn`, 5 kinds) | **done** (tools/extract-foliage.py → cows.json, src/foliage.js) |
| | moles (`render_object_moles`) | — |
| Toad's Turnpike | box trucks, school buses, tanker trucks, cars | — |
| Kalimari Desert | cacti (44, three kinds) | **done** |
| | train (engine, tender, carriages) and its smoke, railroad crossings ×4 | — |
| Sherbet Land | emperor penguin, swimming / sliding penguins, see-through ice | **done** (src/penguins.js) |
| Rainbow Road | neon signs (`render_object_neon`), Chain Chomps | — |
| Wario Stadium | Wario signs (`ACTOR_WARIO_SIGN` ×3) | **done** (src/props.js) |
| D.K.'s Jungle Parkway | trees and palm trees (`render_palm_trees`, 95) | **done** (src/props.js) |
| D.K.'s Jungle Parkway | paddle-boat ferry and its smoke, kiwano fruit, torches | — |
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
