# Whole-game test report — 2026-10-08

Run with `node tools/test-everything.mjs` (visible Google Chrome windows, 4 at a time, ~17 min) plus
`LOBBY=ws://localhost:8787/api/mp node tools/test-everything.mjs online` against a local lobby
(`cd website && npx wrangler@4 dev --port 8787`). The earlier `tools/test-autopilot.mjs` run covers all 16 race
courses at 150cc (16/16 finished, no stalls, no falls). Tested on the working tree, including uncommitted changes.

**Result: 21/24 scenarios passed, no page errors, no failed requests (HTTP 4xx/5xx) in any window.**

| Scenario | Result | What was measured |
|---|---|---|
| menus-gp | PASS | title → GAME SELECT → L OPTION / Esc → R DATA / Esc → 1P MARIO GP 150cc → Flower Cup course 2 → Luigi → race `?track=frappe&char=luigi&cc=150&mode=mario_gp` |
| menus-modes | PASS | 1P BATTLE → arena 3 → `?track=double-deck&mode=battle`; M back to the title; 1P TIME TRIALS → `?track=luigi&cc=100&mode=time_trials` |
| keyboard | PASS | ↑ held 6 s: 181 units forward at 38.5 speed; G switches HD preset (`2× 480p · textures 2×`); N twice; Backspace restarts (countdown, time 0); M returns to the title |
| battle-big-donut | PASS | Luigi wins at 91.5 s, 10 balloons popped, **13 rescues** |
| battle-skyscraper | PASS | Toad wins at 89.1 s, 9 balloons popped, **18 rescues** |
| battle-block-fort | **FAIL** | no winner after 180 s (Mario 2, Luigi 1, Toad 2 balloons left; 7 popped) |
| battle-double-deck | **FAIL** | no winner after 180 s (Mario 1, Luigi 1, Peach 1 left; 9 popped) |
| mirror (EXTRA) luigi / koopa / banshee / bowser | PASS | canvas mirrored, 3 laps, 3rd / 4th / 4th / 3rd, no stalls or rescues |
| 50cc moomoo | PASS | laps 32.4 / 32.6 / 31.3 (150cc: ~25 s), 1st |
| 100cc kalimari | PASS | laps 39.2 / 37.8 / 41.0, 4th |
| time trials mario | **FAIL** | 8 karts on the grid (see fix 1) |
| VS yoshi (URL only) | PASS | 3 laps, 2nd |
| all 8 characters on Moo Moo Farm | PASS | Mario, Luigi, Yoshi, Toad, DK, Wario, Peach, Bowser each finish 3 laps in 73.6–78.6 s, places 1st–3rd |
| online (2 windows, local lobby) | PASS | both windows reach the race and see 2 humans + 2 CPU karts |

Screenshots of each window's last frame: `/tmp/mk64-test/<scenario>.png`, raw numbers in `/tmp/mk64-test/results.json`.

## What we should fix

1. ~~**Time trials races 7 CPU karts.**~~ Fixed: the player is alone in the middle of the first row
   (spawn_players.c TIME_TRIALS), with three mushrooms (func_8005995C) and no item boxes (actors.c skips them in
   TIME_TRIALS); the finish banner shows the race time. `tt-mario` now passes with 1 kart.
2. ~~**Battle on Block Fort and Double Deck doesn't finish.**~~ Fixed: the battle CPU chases the nearest kart it can
   drive straight to, otherwise goes via the item box spots towards one; a CPU pinned nose-first on a wall backs off
   and turns. All four arenas now end with a winner (re-run: Block Fort 61 s, Double Deck 76 s).
3. ~~**Battle falls cost nothing.**~~ Confirmed in the decomp and fixed: effects.c pops a balloon when Lakitu lets go
   of the kart in BATTLE (`pop_player_balloon`, which also plays 0x19009051 for a human).
4. ~~**Player is grid slot 2.**~~ The decomp puts player 1 *last* on a cup's first course (func_80039DA4:
   D_80165270 = 7, 6, .. 0), and every Grand Prix race here is a single course, so 1P Grand Prix now starts 8th.
   VS and an online room falling back to CPU karts keep the old order.
5. **Balloons** were plain coloured spheres. They are now the ROM's balloon (gTextureBalloon1 / 2 with the
   onomatopoeia TLUT, `tools/extract-items.py` -> `items/balloon.png`), coloured per driver with
   render_battle_balloon's prim / env colours, fanned, leaning with speed, distance-scaled, rising away when popped.
5. **Not covered by the automated run** (needs hands-on play): sound/music by ear, gamepad, how the HD textures
   look, 3–4 player online rooms, online battle, Mirror on the other 12 courses, and holding/throwing items by hand.
