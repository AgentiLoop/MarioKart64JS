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

// Promo banner under the nav: alternate the slides, pause on hover/focus, the segments jump to a slide (from agent.xcf.ai promo.js).
(() => {
  const promo = document.getElementById('promo');
  if (!promo) return;
  const slides = promo.querySelectorAll('.promo-slide'), dots = promo.querySelectorAll('.promo-dot');
  const ms = 7000;
  let cur = 0, timer = null, left = ms, started = 0;
  const schedule = () => {
    clearTimeout(timer);
    if (promo.classList.contains('is-paused')) return;
    started = Date.now();
    timer = setTimeout(() => show(cur + 1), left);
  };
  const show = (i) => {
    cur = (i + slides.length) % slides.length;
    slides.forEach((s, n) => {
      const on = n === cur;
      s.classList.toggle('is-active', on);
      s.setAttribute('aria-hidden', on ? 'false' : 'true');
      s.querySelectorAll('a').forEach((a) => { a.tabIndex = on ? 0 : -1; });
    });
    dots.forEach((d, n) => {
      d.classList.remove('is-active');
      void d.offsetWidth; // restart the progress animation
      d.classList.toggle('is-active', n === cur);
      d.classList.toggle('is-done', n < cur);
      d.setAttribute('aria-selected', n === cur ? 'true' : 'false');
      d.title = d.getAttribute('aria-label') || '';
    });
    left = ms;
    schedule();
  };
  const pause = () => {
    if (promo.classList.contains('is-paused')) return;
    promo.classList.add('is-paused');
    clearTimeout(timer);
    left = Math.max(0, left - (Date.now() - started));
  };
  const resume = () => {
    if (promo.contains(document.activeElement) && promo.matches(':focus-within')) return;
    promo.classList.remove('is-paused');
    schedule();
  };
  dots.forEach((d, n) => d.addEventListener('click', () => show(n)));
  promo.addEventListener('mouseenter', pause);
  promo.addEventListener('mouseleave', resume);
  promo.addEventListener('focusin', pause);
  promo.addEventListener('focusout', () => setTimeout(resume, 0));
  show(0);
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
