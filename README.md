# MarioKart64JS

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
- **Choose a look:** the original blurry 240p, or sharp HD textures up to full resolution.

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
| Music on/off | N |

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

## Credits

- Game logic, low-res graphics and sound come from the [n64decomp/mk64](https://github.com/n64decomp/mk64) decompilation.
- HD textures come from [GhostlyDark/MK64-Reloaded](https://github.com/GhostlyDark/MK64-Reloaded).

*This is a fan research project. Mario Kart 64 is © Nintendo. All game assets belong to Nintendo, and this project is
not affiliated with or endorsed by Nintendo.*
