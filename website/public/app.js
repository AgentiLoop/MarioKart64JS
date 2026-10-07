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
