// Boss-Man banners (nav bar + the big card): Pete chomps dots through a neon
// cubicle maze with the four bosses on his tail, drawn like the game's sprites. Canvas 2D; falls back to CSS.
(function () {
  var cvs = [document.getElementById('bmb-cv')].concat([].slice.call(document.querySelectorAll('.bm-cv')));
  cvs.forEach(function (cv) { if (cv) run(cv, cv.classList.contains('bm-cv')); });
  function run(cv, big) {
  var g = cv.getContext('2d');
  if (!g) { cv.remove(); return; }
  var still = matchMedia('(prefers-reduced-motion: reduce)').matches;
  var W = 0, H = 0, dpr = 1, k = 1, t = 0, last = performance.now();
  function size() {
    dpr = Math.min(devicePixelRatio || 1, 2);
    var w = Math.round(cv.clientWidth * dpr), h = Math.round(cv.clientHeight * dpr);
    if (cv.width !== w || cv.height !== h) { cv.width = w; cv.height = h; }
    // the big card draws the same 52px-tall scene, scaled up to its strip
    k = big ? cv.clientHeight / 52 : 1;
    W = cv.clientWidth / k; H = cv.clientHeight / k;
  }
  function maze(off) {
    // scrolling cubicle walls: neon blue rounded bars on a grid
    var cell = 26, cols = Math.ceil(W / cell) + 2, x0 = -(off % cell);
    g.lineWidth = 2; g.lineCap = 'round';
    g.shadowBlur = 8; g.shadowColor = '#3a7bff'; g.strokeStyle = 'rgba(58,123,255,.75)';
    g.beginPath();
    g.moveTo(0, 4); g.lineTo(W, 4); g.moveTo(0, H - 4); g.lineTo(W, H - 4);
    for (var i = 0; i < cols; i++) {
      var k = Math.floor((off) / cell) + i, x = x0 + i * cell;
      var h1 = (Math.sin(k * 12.9898) * 43758.5453) % 1; if (h1 < 0) h1 += 1;
      if (h1 > .55) { g.moveTo(x, 4); g.lineTo(x, 13); }
      if (h1 < .4) { g.moveTo(x, H - 4); g.lineTo(x, H - 13); }
      if (h1 > .85) { g.moveTo(x, 13); g.lineTo(x + cell * .6, 13); }
    }
    g.stroke(); g.shadowBlur = 0;
  }
  // Pete and the bosses as drawn by the game (Boss-Man PixelPerson.swift /
  // SpriteFactory.swift / BossBlueprint.swift): pixel office workers in
  // shirt, tie and slacks, here facing right toward the stapler.
  var SKIN = '#f5c79e';
  var PETE = { body: '#007aff', tie: '#ff9500', hair: '#40260f', shoe: '#ffffff', pants: '#b3732e', head: 0 };
  var BOSSES = [
    { body: '#ff3b30', tie: '#000000' },
    { body: 'rgba(255,45,85,.75)', tie: '#693183', back: true },
    { body: '#30b0c7', tie: '#0062cc' },
    { body: '#ff9500', tie: '#e6352b' }
  ].map(function (b) { b.hair = '#8c7359'; b.shoe = '#b38000'; b.pants = '#555555'; b.head = -1; return b; });
  // rect centred at (cx, cy) in sprite units, y up like SpriteKit
  function box(cx, cy, w, h, fill, stroke, lw) {
    g.fillStyle = fill; g.fillRect(cx - w / 2, -cy - h / 2, w, h);
    if (stroke) { g.lineWidth = lw; g.strokeStyle = stroke; g.strokeRect(cx - w / 2, -cy - h / 2, w, h); }
  }
  function person(x, y, s, p, step) {
    // walk cycle: legs lift 3 and arms swing 2 alternately, 0.16 s per step
    var a = Math.max(0, Math.sin(step)), b = Math.max(0, -Math.sin(step));
    g.save(); g.translate(x, y); g.scale(s, s);
    g.shadowBlur = 6; g.shadowColor = 'rgba(0,0,0,.6)';
    [[-4, a], [4, b]].forEach(function (l) {
      var ly = -14 + 3 * l[1];
      box(l[0], ly, 6, 8, p.pants);
      box(l[0] + 1.5, ly - 5, 8, 3, '#1f140d', p.shoe, 1);
    });
    g.shadowBlur = 0;
    if (p.back) { box(0, -2, 18, 16, '#fff'); box(-11, -2, 5, 14, '#fff'); box(11, -2, 5, 14, '#fff'); }
    box(0, -2, 18, 16, p.body, '#fff', 1.5);
    box(0, 3, 8, 3, '#fff');
    box(0, -2, 4, 12, p.tie);
    [[-11, -2 * b], [11, -2 * a]].forEach(function (r) {
      var ay = -2 + r[1];
      box(r[0], ay, 5, 14, p.body, '#fff', 1);
      g.fillStyle = SKIN; g.beginPath(); g.arc(r[0], -(ay - 8), 2.5, 0, 7); g.fill();
    });
    var hy = 13 + p.head;
    g.fillStyle = SKIN; g.beginPath(); g.roundRect(-7, -hy - 6, 14, 12, 2); g.fill();
    box(0, hy + 4, 14, 4, p.hair);
    box(-3, hy, 2, 2, '#000'); box(3, hy, 2, 2, '#000');
    g.restore();
  }
  var stapler = new Image(); stapler.src = '/img/red-stapler.png';
  function frame(now) {
    var dt = Math.min((now - last) / 1000, .1); last = now;
    t += dt;
    size();
    g.setTransform(dpr * k, 0, 0, dpr * k, 0, 0);
    if (big) g.clearRect(0, 0, W, H);
    else {
      var bg = g.createLinearGradient(0, 0, 0, H);
      bg.addColorStop(0, '#05061f'); bg.addColorStop(1, '#0d1440');
      g.fillStyle = bg; g.fillRect(0, 0, W, H);
    }
    maze(t * 40);
    var y = H / 2, r = Math.min(10, H * .2), span = W + 260;
    var px = ((t * 110) % span) - 60;
    // dots ahead of Pete, power pellet every 6th
    for (var dx = 14, i = 0; dx < W + 20; dx += 22, i++) {
      var dxx = dx - ((t * 40) % 22);
      if (dxx < px + r * .4 && dxx > px - 400) continue;
      var pel = ((i + Math.floor(t * 40 / 22)) % 6) === 0;
      g.fillStyle = pel ? '#ffffff' : '#ffd23f';
      g.globalAlpha = pel ? .6 + .4 * Math.sin(t * 8) : .9;
      g.beginPath(); g.arc(dxx, y, pel ? 3.5 : 1.8, 0, 7); g.fill();
    }
    g.globalAlpha = 1;
    // the red stapler (the game's own sprite) fleeing just ahead of Pete
    var sy = y - 12 + Math.sin(t * 12) * 1.5;
    if (stapler.complete && stapler.naturalWidth) g.drawImage(stapler, px + 36, sy, 24, 24);
    var st = t * Math.PI / .16, s = Math.min(.85, H / 52 * .85);
    person(px, y, s, PETE, st);
    for (var b = 0; b < 4; b++) person(px - 40 - b * 30, y, s, BOSSES[b], st + b * 1.3);
    if (!still) requestAnimationFrame(frame);
  }
  addEventListener('resize', function () { if (still) frame(performance.now()); });
  requestAnimationFrame(frame);
  }
})();
