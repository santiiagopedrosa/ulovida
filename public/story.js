// Visualizador de stories: avança sozinho a cada 5 s, toque à direita/esquerda para navegar, toque longo para pausar.
const viewer = document.querySelector('.story-viewer');
const slides = [...viewer.querySelectorAll('.story-slide')];
const bars = [...viewer.querySelectorAll('.story-bars i')];
const timeEl = viewer.querySelector('.story-time');
const mine = viewer.dataset.mine === '1';
const DURATION = 5000;
let i = Number(viewer.dataset.start) || 0;
let started = 0, elapsed = 0, paused = false, raf;
// Música: os browsers só deixam tocar som depois de um toque, por isso começa sem som se for preciso.
const audio = new Audio();
audio.loop = true;
let muted = false, autoMuted = false;
const musicEl = viewer.querySelector('.story-music');
const soundBtn = viewer.querySelector('.story-sound');
const setSoundIcon = () => {
  soundBtn.replaceChildren(document.getElementById(muted ? 'icon-mute' : 'icon-volume').content.cloneNode(true));
  soundBtn.setAttribute('aria-label', muted ? 'Ligar som' : 'Desligar som');
};
function playMusic() {
  audio.muted = muted;
  audio.play().catch(() => { muted = autoMuted = true; audio.muted = true; audio.play().catch(() => {}); setSoundIcon(); });
}
// Primeiro toque no ecrã liga o som que o browser bloqueou.
document.addEventListener('pointerdown', (e) => {
  if (!autoMuted || soundBtn.contains(e.target)) return;
  autoMuted = muted = false;
  audio.muted = false;
  audio.play().catch(() => {});
  setSoundIcon();
}, { capture: true });
soundBtn.addEventListener('click', () => { autoMuted = false; muted = !muted; audio.muted = muted; if (!muted) audio.play().catch(() => {}); setSoundIcon(); });
function updateMusic(s) {
  const src = s.dataset.music;
  musicEl.hidden = soundBtn.hidden = !src;
  if (!src) { audio.pause(); return; }
  musicEl.href = s.dataset.musicUrl || '#';
  musicEl.querySelector('img').src = s.dataset.musicArtwork;
  musicEl.querySelector('strong').textContent = s.dataset.musicTitle;
  musicEl.querySelector('small').textContent = s.dataset.musicArtist;
  if (audio.src !== src) { audio.src = src; }
  playMusic();
  setSoundIcon();
}

function show(n) {
  if (n < 0) n = 0;
  if (n >= slides.length) { audio.pause(); location.href = '/eventos'; return; }
  i = n; elapsed = 0; started = performance.now();
  slides.forEach((s, k) => { s.hidden = k !== i; });
  bars.forEach((b, k) => { b.style.width = k < i ? '100%' : '0%'; });
  const s = slides[i];
  timeEl.textContent = s.dataset.time;
  updateMusic(s);
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
const pause = () => { if (!paused) { paused = true; elapsed += performance.now() - started; audio.pause(); } };
const resume = () => { if (paused) { paused = false; started = performance.now(); if (slides[i].dataset.music) playMusic(); } };

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
