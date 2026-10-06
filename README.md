# Kart Racer (Three.js)

Original arcade kart racer built on Three.js + Vite.

- `npm install && npm run dev` → http://localhost:5173
- Controls: arrows/WASD, Space = drift (release for mini-turbo), R = restart.

Engine choice: Three.js (WebGL, runs in any browser, no install, easy to ship).
Track = closed 3D spline with elevation; banking derived from curvature; karts
move in the track's Frenet frame so hills, dips and camber work automatically.
All art/audio is procedural and original.
