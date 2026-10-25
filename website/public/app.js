// Point the hero button at this visitor's build and highlight its card.
(() => {
  const ua = navigator.userAgent, plat = navigator.userAgentData?.platform || navigator.platform || '';
  const arm = /arm|aarch64/i.test(ua + plat);
  let key = null, label = null;
  if (/Mac/i.test(plat) && !/iPhone|iPad/i.test(ua)) { key = 'mac'; label = 'macOS'; }
  else if (/Win/i.test(plat)) { key = arm ? 'win-arm' : 'win'; label = 'Windows'; }
  else if (/Linux/i.test(plat) && !/Android/i.test(ua)) { key = arm ? 'linux-arm' : 'linux'; label = 'Linux'; }
  const card = key && document.querySelector(`.dl-card[data-plat="${key}"]`);
  if (!card) return;
  card.classList.add('me');
  document.querySelector('[data-os]').textContent = label;
  document.getElementById('hero-dl').href = card.href;
})();

// Scale the hero card up to fill the viewport when there's room (never below 1x).
(() => {
  const card = document.querySelector('.mk-card');
  if (!card) return;
  const fit = () => {
    card.style.zoom = 1;
    const vw = document.documentElement.clientWidth;
    if (vw <= 900) return;
    const s = Math.min((vw - 44) / card.offsetWidth, (innerHeight - 220) / card.offsetHeight);
    if (s > 1) card.style.zoom = s;
  };
  addEventListener('resize', fit);
  addEventListener('load', fit);
  fit();
})();

// Open a collapsed "More about" section when its #hash is linked or clicked in the nav.
(() => {
  const open = () => {
    const t = location.hash.length > 1 && document.getElementById(decodeURIComponent(location.hash.slice(1)));
    const d = t && t.closest('details');
    if (d) { d.open = true; t.scrollIntoView(); }
  };
  open();
  addEventListener('hashchange', open);
})();

// Screenshot lightbox.
document.querySelectorAll('.gallery a').forEach((a) => a.addEventListener('click', (e) => {
  e.preventDefault();
  const box = document.createElement('div');
  box.className = 'lightbox';
  box.innerHTML = `<img src="${a.getAttribute('href')}" alt="">`;
  box.onclick = () => box.remove();
  document.addEventListener('keydown', function esc(k) { if (k.key === 'Escape') { box.remove(); document.removeEventListener('keydown', esc); } });
  document.body.append(box);
}));
