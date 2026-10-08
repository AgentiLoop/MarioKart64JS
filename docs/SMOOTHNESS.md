# Smoother karts, track, sound and music

How the game loop, karts, camera and audio work now, and the techniques that can make them smoother.

## What the code does now

- **Loop** (`src/main.js` `frame`): one `requestAnimationFrame` per display refresh. `dt` is capped at 0.05 s, and the race runs 2 physics substeps per frame (`steps = 2`). Kart meshes are set from the latest physics state on every frame, so motion follows the display rate with no fixed-tick stutter.
- **Camera** (`updateCamera`): position and up vector ease with `1 - exp(-dt * k)`, which is the same at any frame rate.
- **Online puppets** (`puppetStep`): other players' karts replay poses 0.1 s late and interpolate between the two poses around that time. Past the newest pose they extrapolate for up to 0.3 s.
- **Music / sound effects**: the ROM sequencer (`src/m64.js`) runs in an AudioWorklet (`src/m64-worklet.js`), off the main thread. Engine pitch and filter changes use `setTargetAtTime(…, 0.05)` (`src/audio.js`), which avoids zipper noise.

## Changes in this branch

1. **Ground tilt eases the same at every refresh rate.** `Kart.syncMesh` / `syncFree` blended the ground normal 25% per substep, so tilt settled twice as fast at 120 Hz as at 60 Hz. It now uses `1 - 0.75^(dt * 120)`, which equals 0.25 per 1/120 s substep (the 60 Hz feel).
2. **No garbage in the per-substep mesh sync.** `syncMesh` / `syncFree` built a new Vector3, Matrix4, Quaternion and two clones per kart per substep (about 960 objects a second with 8 karts at 60 Hz). They now reuse module-level temporaries, so the garbage collector has less work and fewer pauses.
3. **Puppet spins use real time.** Puppet spin angles grew `11/60` per frame (twice as fast at 120 Hz). They now grow `11 * dt`, like a local kart.
4. **`powerPreference: 'high-performance'`** on the WebGLRenderer asks laptops with two GPUs for the discrete GPU.

## Techniques not done yet

- **Fixed timestep + interpolation** ("Fix Your Timestep"): run physics at a fixed rate (for example 120 Hz) with an accumulator, and render each kart blended between its last two physics states. Physics then gives the same result at 60, 120 or 144 Hz, and a slow frame no longer slows the game (the 0.05 s cap does now). Cost: everything that reads `k.world` / `k.mesh` mid-step (items, Lakitu, camera, smoke) has to agree on which state it reads, and the render lags by up to one tick.
- **Smooth the camera look target.** `v.look` follows `k.world` exactly, so ground bumps reach the view at once. A short exponential ease (like `v.pos`) would soften it, but it also changes how the camera feels.
- **Fewer allocations elsewhere in the frame**: `updateCamera` (`clone()` ×2, `new Vector3` for the sun), `renderViews` / `updateClouds` (`new Vector2` every call), and the menu fly-along (`new Vector3` ×2 per frame in arenas).
- **Audio latency vs. glitches**: `new AudioContext()` uses the default `latencyHint: 'interactive'`. If music crackles on slow machines, `'balanced'` or `'playback'` gives the audio thread a bigger buffer, at the cost of later sound effects. Needs listening tests on real hardware.
- **Online puppets**: `PUPPET_DELAY` 0.1 s with poses every 1/30 s leaves about 3 poses of buffer. If puppets jump on bad connections, a delay based on measured jitter would help.
- **Antialiasing** is off on purpose (N64 pixel look); the HD presets (G key) change the render resolution.

## Sources

- Glenn Fiedler, "Fix Your Timestep!" (gafferongames.com).
- Bevy Cheat Book, "Transform Interpolation/Extrapolation".
- Chrome developers blog, "Audio Worklet is now available by default".
- Jeff Kaufman, "AudioWorklet Latency: Firefox vs Chrome" (`latencyHint` behaviour).
