// Boss-Man banners (nav bar + the big card): Pete chomps dots through a neon
// cubicle maze with the four bosses on his tail. Canvas 2D; falls back to CSS.
(function () {
  var cvs = [document.getElementById('bmb-cv')].concat([].slice.call(document.querySelectorAll('.bm-cv')));
  cvs.forEach(function (cv) { if (cv) run(cv, cv.classList.contains('bm-cv')); });
  function run(cv, big) {
  var g = cv.getContext('2d');
  if (!g) { cv.remove(); return; }
  var still = matchMedia('(prefers-reduced-motion: reduce)').matches;
  var bosses = ['#ff3b3b', '#ff7ad9', '#2ee6c5', '#ffa43a'];
  var W = 0, H = 0, dpr = 1, k = 1, t = 0, boost = 0, bb = 0, last = performance.now();
  var a = cv.closest('a') || cv.parentNode;
  a.addEventListener('mouseenter', function () { boost = 1; });
  a.addEventListener('mouseleave', function () { boost = 0; });
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
  function pete(x, y, r, open) {
    var m = (0.05 + 0.25 * open) * Math.PI;
    g.fillStyle = '#ffd23f'; g.shadowBlur = 12; g.shadowColor = '#ffd23f';
    g.beginPath(); g.moveTo(x, y); g.arc(x, y, r, m, Math.PI * 2 - m); g.closePath(); g.fill();
    g.shadowBlur = 0;
  }
  function boss(x, y, r, col, wob) {
    g.fillStyle = col; g.shadowBlur = 10; g.shadowColor = col;
    g.beginPath(); g.arc(x, y - r * .15, r, Math.PI, 0);
    var bot = y + r * .85, n = 4;
    g.lineTo(x + r, bot);
    for (var i = 0; i < n; i++) {
      var x1 = x + r - (i + .5) * (2 * r / n), x2 = x + r - (i + 1) * (2 * r / n);
      g.lineTo(x1, bot - r * .3 * (wob ? 1 : .5)); g.lineTo(x2, bot);
    }
    g.closePath(); g.fill(); g.shadowBlur = 0;
    // eyes looking right toward Pete
    g.fillStyle = '#fff';
    g.beginPath(); g.arc(x - r * .3, y - r * .25, r * .28, 0, 7); g.arc(x + r * .35, y - r * .25, r * .28, 0, 7); g.fill();
    g.fillStyle = '#1b2a7a';
    g.beginPath(); g.arc(x - r * .2, y - r * .22, r * .13, 0, 7); g.arc(x + r * .45, y - r * .22, r * .13, 0, 7); g.fill();
    // little tie
    g.fillStyle = '#fff'; g.fillRect(x - r * .07, y + r * .2, r * .14, r * .35);
  }
  function frame(now) {
    var dt = Math.min((now - last) / 1000, .1); last = now;
    bb += (boost - bb) * Math.min(dt * 4, 1);
    t += dt * (1 + bb * 1.8);
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
    // red stapler fleeing just ahead of Pete
    g.fillStyle = '#e8352e'; g.shadowBlur = 8; g.shadowColor = '#e8352e';
    g.fillRect(px + 34, y - 2 + Math.sin(t * 12) * 1.5, 14, 5); g.fillRect(px + 36, y - 6 + Math.sin(t * 12) * 1.5, 11, 3);
    g.shadowBlur = 0;
    pete(px, y, r, Math.abs(Math.sin(t * 14)));
    for (var b = 0; b < 4; b++) boss(px - 46 - b * 30, y + Math.sin(t * 6 + b) * 1.5, r * .95, bosses[b], Math.sin(t * 16 + b) > 0);
    if (!still) requestAnimationFrame(frame);
  }
  addEventListener('resize', function () { if (still) frame(performance.now()); });
  requestAnimationFrame(frame);
  }
})();
