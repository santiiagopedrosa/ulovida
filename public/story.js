// Visualizador de stories: avança sozinho a cada 5 s, toque à direita/esquerda para navegar, toque longo para pausar.
const viewer = document.querySelector('.story-viewer');
const slides = [...viewer.querySelectorAll('.story-slide')];
const bars = [...viewer.querySelectorAll('.story-bars i')];
const timeEl = viewer.querySelector('.story-time');
const mine = viewer.dataset.mine === '1';
const DURATION = 5000;
let i = Number(viewer.dataset.start) || 0;
let started = 0, elapsed = 0, paused = false, raf;

function show(n) {
  if (n < 0) n = 0;
  if (n >= slides.length) { location.href = '/eventos'; return; }
  i = n; elapsed = 0; started = performance.now();
  slides.forEach((s, k) => { s.hidden = k !== i; });
  bars.forEach((b, k) => { b.style.width = k < i ? '100%' : '0%'; });
  const s = slides[i];
  timeEl.textContent = s.dataset.time;
  if (mine) {
    viewer.querySelector('.story-views b').textContent = `${s.dataset.views} ${s.dataset.views === '1' ? 'visualização' : 'visualizações'}`;
    viewer.querySelector('.story-delete').action = `/stories/${s.dataset.id}/apagar`;
  } else {
    fetch(`/stories/${s.dataset.id}/visto`, { method: 'POST' }).catch(() => {});
  }
}
function tick(now) {
  if (!paused) {
    const t = elapsed + (now - started);
    bars[i].style.width = `${Math.min(100, (t / DURATION) * 100)}%`;
    if (t >= DURATION) show(i + 1);
  }
  raf = requestAnimationFrame(tick);
}
const pause = () => { if (!paused) { paused = true; elapsed += performance.now() - started; } };
const resume = () => { if (paused) { paused = false; started = performance.now(); } };

viewer.querySelector('.story-nav.prev').addEventListener('click', () => show(i - 1));
viewer.querySelector('.story-nav.next').addEventListener('click', () => show(i + 1));
for (const el of viewer.querySelectorAll('.story-nav')) {
  el.addEventListener('pointerdown', pause);
  el.addEventListener('pointerup', resume);
  el.addEventListener('pointerleave', resume);
}
viewer.querySelector('.story-delete')?.addEventListener('submit', (e) => {
  if (!confirm('Apagar esta story?')) e.preventDefault();
});
addEventListener('keydown', (e) => {
  if (e.key === 'ArrowRight') show(i + 1);
  if (e.key === 'ArrowLeft') show(i - 1);
  if (e.key === 'Escape') location.href = '/eventos';
});
document.addEventListener('visibilitychange', () => (document.hidden ? pause() : resume()));
show(i);
raf = requestAnimationFrame(tick);
