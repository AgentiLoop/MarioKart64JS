# MarioKart64JS

> **⚠️ Work in progress. This is not a finished game.** Expect bugs, missing features and rough edges.
> Please report any problems you find at https://github.com/AgentiLoop/MarioKart64JS/issues

Mario Kart 64, rebuilt to run in a web browser. It isn't an emulator. The courses, karts, music and sounds are pulled
out of the original N64 ROM and redrawn with Three.js.

We built it as a test of how closely AI tools can recreate a classic game.

- **▶ Play now:** https://mk64js.gokart.games/play
- **⬇ Desktop apps** (Mac, Windows, Linux, Raspberry Pi): [Releases](https://github.com/AgentiLoop/MarioKart64JS/releases/latest)

| | |
|---|---|
| ![Title](docs/screenshots/hires/title.jpg) | ![Game select](docs/screenshots/hires/game-select.jpg) |
| ![Course select](docs/screenshots/hires/course-select.jpg) | ![Character select](docs/screenshots/hires/character-select.jpg) |
| ![Mario Raceway](docs/screenshots/hires/race-mario.jpg) | ![Royal Raceway](docs/screenshots/hires/race-royal.jpg) |
| ![Koopa Troopa Beach](docs/screenshots/hires/race-koopa.jpg) | ![Sherbet Land](docs/screenshots/hires/race-sherbet.jpg) |
| ![D.K.'s Jungle Parkway](docs/screenshots/hires/race-dk.jpg) | ![Bowser's Castle](docs/screenshots/hires/race-bowser.jpg) |
| ![Banshee Boardwalk](docs/screenshots/hires/race-banshee.jpg) | ![Rainbow Road](docs/screenshots/hires/race-rainbow.jpg) |

## What you can do

- **Race** any of the 16 courses at 50cc, 100cc, 150cc or Extra (mirror mode).
- **Grand Prix, VS and Time Trials** modes. Your best times are saved.
- **Battle** in all four arenas: Big Donut, Block Fort, Double Deck and Skyscraper.
- **Play online with 2 to 4 people** in split screen, just like the console.
- **Use all 15 items**, from bananas and shells to stars, Boos and lightning.
- **Hear the original music and voices**, played from the game's own sound data.
- **Watch the courses come alive:** the Moo Moo Farm cows, the Kalimari Desert trains, Toad's Turnpike traffic, the Bowser's Castle Thwomps, the Rainbow Road Chain Chomps and more.
- **Switch to Wii 3D karts** with the 3 key: a 3D title screen, 3D Wii-style karts and Lakitu with real shadows, and 3D finish fly-overs. [See below.](#wii-3d-karts-press-3)
- **Choose a look:** the original blurry 240p, or sharp HD textures up to full resolution.

## Wii 3D karts (press 3)

Press **3** on the title screen and the N64 title becomes a 3D scene: Mario, Wario, Bowser, Peach and Toad in Wii-style
Standard Karts driving at you down a scrolling road. In a race, **3** swaps every kart (each driver in their own kart)
and the referee Lakitu for 3D models with real shadows. Press **3** again to go back to the original art. Your choice is
remembered for the next race.

**3D title screen and game select**

| | |
|---|---|
| ![3D title screen](docs/screenshots/hires/title3d.jpg) | ![Game select over the 3D scene](docs/screenshots/hires/game-select3d.jpg) |

**Racing in 3D**

| | |
|---|---|
| ![Mario Raceway](docs/screenshots/hires/race3d-mario.jpg) | ![Luigi Raceway](docs/screenshots/hires/race3d-luigi.jpg) |
| ![Koopa Troopa Beach](docs/screenshots/hires/race3d-koopa.jpg) | ![Royal Raceway](docs/screenshots/hires/race3d-royal.jpg) |
| ![Sherbet Land](docs/screenshots/hires/race3d-sherbet.jpg) | ![D.K.'s Jungle Parkway](docs/screenshots/hires/race3d-dk.jpg) |
| ![Bowser's Castle](docs/screenshots/hires/race3d-bowser.jpg) | ![Rainbow Road](docs/screenshots/hires/race3d-rainbow.jpg) |
| ![Wario Stadium](docs/screenshots/hires/race3d-wario.jpg) | |

**Fly-overs after the finish**

Cross the line on the last lap and the camera swings round the kart to its nose, then cuts to roadside shots, a high crane and
a low tail shot, as on the console. With the Wii karts on, they show your 3D kart.

| | |
|---|---|
| ![Orbit round the kart, Mario Raceway](docs/screenshots/hires/fly3d-orbit-mario.jpg) | ![Head-on, Mario Raceway](docs/screenshots/hires/fly3d-nose-mario.jpg) |
| ![High crane, Mario Raceway](docs/screenshots/hires/fly3d-crane-mario.jpg) | ![Orbit round the kart, Royal Raceway](docs/screenshots/hires/fly3d-orbit-royal.jpg) |
| ![High crane, Royal Raceway](docs/screenshots/hires/fly3d-crane-royal.jpg) | ![Low tail shot, Royal Raceway](docs/screenshots/hires/fly3d-tail-royal.jpg) |

## Controls

| Action | Key |
|---|---|
| Gas / brake | ↑ / ↓ (or W / S) |
| Steer | ← / → (or A / D) |
| Drift (let go for a boost) | Space |
| Use item | Shift or E |
| Throw a banana forward | Q |
| Restart race | Delete |
| Change resolution | G |
| Wii 3D karts on/off (title screen and races) | 3 |
| Music on/off | N |
| Show physics bodies (walls red, kart bodies cyan) | P |

Gamepads work too.

## Playing online

1. On the game select screen, pick **2P, 3P or 4P GAME**.
2. Choose a course and a driver.
3. Wait in the lobby. The race starts 15 seconds after the first player arrives, or right away once the room is full.

You don't need codes or accounts. Everyone who picks the same player count around the same time ends up in the same race.

Players connect directly to each other. A few very strict home or office networks block that kind of connection, and
then the game can't connect.

## Roadmap

**Done**
- All 16 courses and the 4 battle arenas
- Every menu: title, game select, cc, course, character, options and records
- All 15 items, Lakitu, CPU rivals and the original music
- Online play for 2 to 4 players, plus battle
- Course hazards and animals on most tracks
- Desktop apps for Mac, Windows, Linux and Raspberry Pi

**Next up**
- **A full Grand Prix cup:** four races in a row with points and a trophy. For now each race is a single course.
- **Hazards that hit back:** piranha plants, trains, traffic and Thwomps can't knock you around yet.
- **Time Trial ghosts:** race against a replay of your best lap.
- **Small details:** object shadows, the Frappe Snowland snowfall, train and ferry smoke.
- **More reliable online play:** a relay server for players on strict networks.

## For developers

```sh
npm install
npm run dev        # http://localhost:5173
```

- You need your own copy of the Mario Kart 64 (USA) ROM (SHA-1 `579c48e211ae952530ffc8738709f078d5dd215e`). The scripts in `tools/` pull the assets out of it.
- **Optional HD textures:** `python3 tools/build-hd-textures.py /path/to/MK64-Reloaded`
- **Graphics check:** `node tools/qc-graphics.mjs` drives every course in a headless browser and reports missing textures and flicker.
- **Website and lobby** (`website/`): a Cloudflare Worker. Publish it with `npm run deploy:web`.
- **Desktop apps** (`desktop/`): run `npm run game` first, then `webkit/build.sh` for Mac, `npm run dist:win` or `dist:linux` for Windows and Linux, or `raspberrypi/build.sh` for the Pi.

### Assets

The game's assets are not stored in this repo. They live in two git submodules that both point to
[MarioKart64JS-assets](https://github.com/AgentiLoop/MarioKart64JS-assets):

| Folder | Branch | Contents |
| --- | --- | --- |
| `public/mk64` | default | Assets extracted from the ROM by the `tools/extract-*.py` scripts |
| `public/mk64-hd` | `hd` | HD textures (2x and 4x tiers plus `manifest.json`) from `tools/build-hd-textures.py` |

Fetch them with `git submodule update --init`.

The [n64decomp/mk64](https://github.com/n64decomp/mk64) decompilation does **not** ship any PNG textures, models or
sounds. It is source code only, and it needs your own ROM to rebuild its assets. The `tools/extract-*.py` scripts use the
decomp only as a map (offsets, sizes, formats, display lists) and decode every texture to PNG straight from your ROM.

`npm run build:web` builds the game, then runs `tools/build-web-assets.mjs` to copy both folders into
`website/public/play/` (skipping submodule `.git` files). That folder is in `.gitignore`. `npm run deploy:web` runs the
build and uploads `website/public` to Cloudflare as Workers Static Assets, so the game at `/play` has the same textures
and resolutions as the desktop apps.

## Credits

- Game logic and the layout of the ROM data come from the [n64decomp/mk64](https://github.com/n64decomp/mk64)
  decompilation. The low-res graphics and sound are decoded from your own ROM, not taken from the decomp.
- HD textures come from [GhostlyDark/MK64-Reloaded](https://github.com/GhostlyDark/MK64-Reloaded).

*This is a fan research project. Mario Kart 64 is © Nintendo. Game assets, not included in this repo, belong to Nintendo, and this
project is not affiliated with or endorsed by Nintendo.*
