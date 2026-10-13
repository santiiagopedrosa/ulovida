// Visualizador de stories: avança sozinho a cada 5 s, toque à direita/esquerda para navegar, toque longo para pausar.
const viewer = document.querySelector('.story-viewer');
const slides = [...viewer.querySelectorAll('.story-slide')];
const bars = [...viewer.querySelectorAll('.story-bars i')];
const timeEl = viewer.querySelector('.story-time');
const mine = viewer.dataset.mine === '1';
// 5 s por foto; com música, 15 s (o trecho escolhido), como no Instagram.
const duration = (s) => (s.dataset.music ? 15000 : 5000);
const CLIP = 15;
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
let clipStart = 0;
// Mantém o som dentro do trecho de 15 s escolhido por quem publicou.
audio.addEventListener('timeupdate', () => {
  if (audio.currentTime >= clipStart + CLIP || audio.currentTime < clipStart - 0.5) audio.currentTime = clipStart;
});
audio.addEventListener('ended', () => { audio.currentTime = clipStart; audio.play().catch(() => {}); });
audio.addEventListener('loadedmetadata', () => { audio.currentTime = clipStart; });
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
  clipStart = Number(s.dataset.musicStart) || 0;
  if (audio.src !== src) audio.src = src;
  audio.currentTime = clipStart;
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
    const likes = viewer.querySelector('.story-likes');
    likes.hidden = s.dataset.likes === '0';
    likes.querySelector('i').textContent = s.dataset.likes;
    viewer.querySelector('.story-delete').action = `/stories/${s.dataset.id}/apagar`;
  } else {
    fetch(`/stories/${s.dataset.id}/visto`, { method: 'POST' }).catch(() => {});
    setLiked(s.dataset.liked === '1');
  }
}
function tick(now) {
  if (!paused) {
    const t = elapsed + (now - started);
    const d = duration(slides[i]);
    bars[i].style.width = `${Math.min(100, (t / d) * 100)}%`;
    if (t >= d) show(i + 1);
  }
  raf = requestAnimationFrame(tick);
}
// Pausa enquanto houver pelo menos um motivo (dedo no ecrã, a escrever, lista aberta, separador escondido).
const holds = new Set();
function hold(reason) {
  holds.add(reason);
  if (!paused) { paused = true; elapsed += performance.now() - started; audio.pause(); }
}
function release(reason) {
  holds.delete(reason);
  if (paused && !holds.size) { paused = false; started = performance.now(); if (slides[i].dataset.music) playMusic(); }
}

viewer.querySelector('.story-nav.prev').addEventListener('click', () => show(i - 1));
viewer.querySelector('.story-nav.next').addEventListener('click', () => show(i + 1));
for (const el of viewer.querySelectorAll('.story-nav')) {
  el.addEventListener('pointerdown', () => hold('press'));
  el.addEventListener('pointerup', () => release('press'));
  el.addEventListener('pointerleave', () => release('press'));
}

// ---------- gosto e resposta (stories dos outros) ----------
const likeBtn = viewer.querySelector('.story-like');
function setLiked(on) {
  if (!likeBtn) return;
  likeBtn.setAttribute('aria-pressed', String(on));
  likeBtn.setAttribute('aria-label', on ? 'Retirar fogo' : 'Reagir com fogo');
}
likeBtn?.addEventListener('click', async () => {
  const s = slides[i];
  const on = s.dataset.liked !== '1';
  s.dataset.liked = on ? '1' : '0';
  setLiked(on);
  if (on) {
    likeBtn.classList.remove('pop'); void likeBtn.offsetWidth; likeBtn.classList.add('pop');
    // Pequeno estouro de chamas a partir do botão.
    if (!matchMedia('(prefers-reduced-motion: reduce)').matches) {
      const r = likeBtn.getBoundingClientRect(), v = viewer.getBoundingClientRect();
      for (let k = 0; k < 7; k++) {
        const f = Object.assign(document.createElement('span'), { className: 'flame-burst', textContent: '🔥' });
        f.style.left = `${r.left - v.left + r.width / 2 - 11}px`;
        f.style.top = `${r.top - v.top}px`;
        f.style.setProperty('--bx', `${(Math.random() - 0.5) * 120}px`);
        f.style.setProperty('--by', `${-60 - Math.random() * 140}px`);
        f.style.setProperty('--br', `${(Math.random() - 0.5) * 60}deg`);
        viewer.append(f);
        setTimeout(() => f.remove(), 900);
      }
    }
  }
  try {
    const r = await fetch(`/stories/${s.dataset.id}/gosto`, { method: 'POST' });
    const data = await r.json();
    s.dataset.liked = data.liked ? '1' : '0';
    setLiked(data.liked);
  } catch {}
});

const replyForm = viewer.querySelector('.story-reply');
const toast = document.querySelector('.story-toast');
function showToast(text) {
  toast.textContent = text;
  toast.hidden = false;
  clearTimeout(showToast.t);
  showToast.t = setTimeout(() => { toast.hidden = true; }, 2200);
}
if (replyForm) {
  const input = replyForm.querySelector('input');
  const send = replyForm.querySelector('.story-send');
  input.addEventListener('focus', () => hold('reply'));
  input.addEventListener('blur', () => release('reply'));
  input.addEventListener('input', () => { send.hidden = !input.value.trim(); });
  replyForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const body = input.value.trim();
    if (!body) return;
    send.disabled = true;
    try {
      const r = await fetch(`/stories/${slides[i].dataset.id}/responder`, {
        method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ body }),
      });
      if (!r.ok) throw new Error();
      input.value = ''; send.hidden = true;
      input.blur();
      showToast('Resposta enviada');
    } catch {
      showToast('Não foi possível enviar');
    }
    send.disabled = false;
  });
}

// ---------- quem viu (as minhas stories) ----------
const sheet = viewer.querySelector('.viewers-sheet');
if (sheet) {
  const list = sheet.querySelector('.viewers-list');
  const COLORS = ['var(--lime)', 'var(--mint)', 'var(--yellow)', 'var(--pink)', 'var(--coral)'];
  const avatar = (u) => {
    if (u.photo_id) return Object.assign(document.createElement('img'), { className: 'avatar', src: `/img/${u.photo_id}`, alt: '' });
    const el = document.createElement('span');
    el.className = 'avatar';
    el.style.setProperty('--av', COLORS[u.id % 5]);
    const parts = u.name.trim().split(/\s+/);
    el.textContent = (parts[0][0] + (parts.length > 1 ? parts.at(-1)[0] : '')).toUpperCase();
    return el;
  };
  viewer.querySelector('.story-views').addEventListener('click', async () => {
    hold('sheet');
    list.innerHTML = '<li class="viewers-empty">A carregar…</li>';
    sheet.showModal();
    try {
      const people = await (await fetch(`/stories/${slides[i].dataset.id}/vistas`)).json();
      if (!people.length) { list.innerHTML = '<li class="viewers-empty">Ainda ninguém viu este momento.</li>'; return; }
      list.replaceChildren(...people.map((p) => {
        const li = document.createElement('li');
        const a = document.createElement('a');
        a.href = `/u/${p.id}`; a.className = 'viewer';
        const name = document.createElement('span');
        const strong = document.createElement('strong'); strong.textContent = p.name;
        const when = document.createElement('small'); when.textContent = p.when;
        name.append(strong, when);
        a.append(avatar(p), name);
        if (p.liked) a.append(Object.assign(document.createElement('span'), { className: 'viewer-heart', textContent: '🔥', title: 'Reagiu com fogo' }));
        li.append(a);
        return li;
      }));
    } catch {
      list.innerHTML = '<li class="viewers-empty">Não foi possível carregar.</li>';
    }
  });
  sheet.querySelector('.viewers-close').addEventListener('click', () => sheet.close());
  sheet.addEventListener('close', () => release('sheet'));
}
viewer.querySelector('.story-delete')?.addEventListener('submit', (e) => {
  if (!confirm('Apagar esta story?')) e.preventDefault();
});
addEventListener('keydown', (e) => {
  if (e.target.closest('input, textarea, dialog')) return;
  if (e.key === 'ArrowRight') show(i + 1);
  if (e.key === 'ArrowLeft') show(i - 1);
  if (e.key === 'Escape') location.href = '/eventos';
});
document.addEventListener('visibilitychange', () => (document.hidden ? hold('hidden') : release('hidden')));
show(i);
raf = requestAnimationFrame(tick);
