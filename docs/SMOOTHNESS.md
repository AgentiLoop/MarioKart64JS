# Smoother karts, track, sound and music

How the game loop, karts, camera and audio work now, and the techniques that can make them smoother.

## What the code does now

- **Loop** (`src/main.js` `frame`): one `requestAnimationFrame` per display refresh, `dt` capped at 0.05 s. The race steps physics at a fixed 120 Hz (`STEP`) from an accumulator; see change 5.
- **Camera** (`updateCamera`): position and up vector ease with `1 - exp(-dt * k)`, which is the same at any frame rate.
- **Online puppets** (`puppetStep`): other players' karts replay poses 0.1 s late and interpolate between the two poses around that time. Past the newest pose they extrapolate for up to 0.3 s.
- **Music / sound effects**: the ROM sequencer (`src/m64.js`) runs in an AudioWorklet (`src/m64-worklet.js`), off the main thread. Engine pitch and filter changes use `setTargetAtTime(…, 0.05)` (`src/audio.js`), which avoids zipper noise.

## Changes in this branch

1. **Ground tilt eases the same at every refresh rate.** `Kart.syncMesh` / `syncFree` blended the ground normal 25% per substep, so tilt settled twice as fast at 120 Hz as at 60 Hz. It now uses `1 - 0.75^(dt * 120)`, which equals 0.25 per 1/120 s substep (the 60 Hz feel).
2. **No garbage in the per-substep mesh sync.** `syncMesh` / `syncFree` built a new Vector3, Matrix4, Quaternion and two clones per kart per substep (about 960 objects a second with 8 karts at 60 Hz). They now reuse module-level temporaries, so the garbage collector has less work and fewer pauses.
3. **Puppet spins use real time.** Puppet spin angles grew `11/60` per frame (twice as fast at 120 Hz). They now grow `11 * dt`, like a local kart.
4. **`powerPreference: 'high-performance'`** on the WebGLRenderer asks laptops with two GPUs for the discrete GPU.
5. **Fixed timestep + interpolation.** Physics used to run 2 substeps of `dt / 2`, so the step size followed the display (1/120 s at 60 Hz, 1/288 s at 144 Hz, 1/60 s at 30 Hz). It now always steps 1/120 s (the old 60 Hz substep, so 60 Hz play is unchanged), as many steps as the accumulator holds. `snapPose` stores each local kart's mesh pose and `world` / `fwd` / `up` before every step. At render, `blendKarts` puts each mesh between its last two steps by `alpha` (leftover time / step), and `unblendKarts` puts the real pose back afterwards, so physics, items and Lakitu never read a blended value. The chase camera follows the same blended pose (`drawPose`), so the kart does not shake against the camera at refresh rates that aren't a multiple of 120 Hz. `raceTime` advances per step. Not blended: online puppets (they already interpolate), karts held by Lakitu, and any step that moves a kart more than 8 units (a teleport). Items, exhaust smoke and battle balloons still use the latest step, at most 1/120 s ahead of the drawn kart. The 0.05 s cap stays, so a frame slower than that still slows the game.
6. **Camera aim eased in height, no per-frame allocations.** The look point `v.look` keeps the kart's side-to-side position exactly but its height follows with `1 - exp(-dt * 12)` (about 80 ms), so road bumps and landings no longer jolt the view while steering stays immediate. `updateCamera`, `renderViews` and `updateClouds` reuse module-level vectors instead of `clone()` / `new Vector3` / `new Vector2` each frame (less garbage, fewer GC hitches).

## Techniques not done yet

- **Fewer allocations elsewhere**: the menu fly-along (`new Vector3` ×2 per frame in arenas, `clone()` ×2 on courses). Only the menus run it.
- **Audio latency vs. glitches**: `new AudioContext()` uses the default `latencyHint: 'interactive'`. If music crackles on slow machines, `'balanced'` or `'playback'` gives the audio thread a bigger buffer, at the cost of later sound effects. Needs listening tests on real hardware.
- **Online puppets**: `PUPPET_DELAY` 0.1 s with poses every 1/30 s leaves about 3 poses of buffer. If puppets jump on bad connections, a delay based on measured jitter would help.
- **Antialiasing** is off on purpose (N64 pixel look); the HD presets (G key) change the render resolution.

## Sources

- Glenn Fiedler, "Fix Your Timestep!" (gafferongames.com).
- Bevy Cheat Book, "Transform Interpolation/Extrapolation".
- Chrome developers blog, "Audio Worklet is now available by default".
- Jeff Kaufman, "AudioWorklet Latency: Firefox vs Chrome" (`latencyHint` behaviour).
