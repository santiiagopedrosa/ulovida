// Câmara das stories, ao estilo do Instagram: câmara ao vivo, galeria, enquadrar com os dedos, música e publicar.
const cam = document.querySelector('.cam');
const video = cam.querySelector('video');
const stage = cam.querySelector('.cam-edit');
const frame = cam.querySelector('.cam-frame');
const errorEl = cam.querySelector('.cam-error');
const gallery = cam.querySelector('.cam-gallery input');
const sheet = cam.querySelector('.music-sheet');
const search = sheet.querySelector('input');
const list = sheet.querySelector('.music-list');
const chip = cam.querySelector('.music-chip');
const publishBtn = cam.querySelector('[data-act=publish]');
const OUT_W = 1080, OUT_H = 1920;

let stream = null, facing = 'environment';
let bitmap = null, zoom = 1, ox = 0, oy = 0, base = 1;
let music = null;
const audio = new Audio();
audio.loop = true;

const setState = (s) => { cam.dataset.state = s; };

// ---------- câmara ----------
async function startCamera() {
  stopCamera();
  if (!navigator.mediaDevices?.getUserMedia) return showCameraError();
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: facing, width: { ideal: 1920 }, height: { ideal: 1080 } }, audio: false,
    });
    video.srcObject = stream;
    video.classList.toggle('mirror', facing === 'user');
    errorEl.hidden = true;
    await video.play().catch(() => {});
  } catch {
    showCameraError();
  }
}
function stopCamera() {
  stream?.getTracks().forEach((t) => t.stop());
  stream = null;
}
function showCameraError() {
  errorEl.hidden = false;
  cam.querySelector('.cam-shutter').disabled = true;
}

cam.querySelector('[data-act=flip]').addEventListener('click', () => {
  facing = facing === 'user' ? 'environment' : 'user';
  startCamera();
});

cam.querySelector('.cam-shutter').addEventListener('click', async () => {
  if (!video.videoWidth) return;
  const c = document.createElement('canvas');
  c.width = video.videoWidth; c.height = video.videoHeight;
  const ctx = c.getContext('2d');
  // Com a câmara frontal guarda a imagem como a pessoa a vê (em espelho).
  if (facing === 'user') { ctx.translate(c.width, 0); ctx.scale(-1, 1); }
  ctx.drawImage(video, 0, 0);
  frame.classList.add('flash');
  setTimeout(() => frame.classList.remove('flash'), 300);
  edit(await createImageBitmap(c));
});

gallery.addEventListener('change', async () => {
  const file = gallery.files[0];
  gallery.value = '';
  if (!file) return;
  try { edit(await createImageBitmap(file, { imageOrientation: 'from-image' })); } catch { alert('Não foi possível abrir essa imagem.'); }
});

// ---------- enquadrar (arrastar + pinça) ----------
const W = () => stage.clientWidth, H = () => stage.clientHeight;
const scale = () => base * zoom;
function clamp() {
  const s = scale();
  ox = Math.min(0, Math.max(W() - bitmap.width * s, ox));
  oy = Math.min(0, Math.max(H() - bitmap.height * s, oy));
}
function draw() {
  const ctx = stage.getContext('2d');
  ctx.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0);
  ctx.clearRect(0, 0, W(), H());
  ctx.drawImage(bitmap, ox, oy, bitmap.width * scale(), bitmap.height * scale());
}
function setZoom(z, px = W() / 2, py = H() / 2) {
  z = Math.min(4, Math.max(1, z));
  const s0 = scale();
  zoom = z;
  ox = px - (px - ox) * (scale() / s0);
  oy = py - (py - oy) * (scale() / s0);
  clamp(); draw();
}
function edit(bmp) {
  bitmap = bmp;
  stopCamera();
  setState('edit');
  requestAnimationFrame(() => {
    stage.width = W() * devicePixelRatio; stage.height = H() * devicePixelRatio;
    base = Math.max(W() / bitmap.width, H() / bitmap.height);
    zoom = 1;
    ox = (W() - bitmap.width * base) / 2; oy = (H() - bitmap.height * base) / 2;
    clamp(); draw();
  });
}
const pointers = new Map();
let pinch = null;
stage.addEventListener('pointerdown', (e) => { stage.setPointerCapture(e.pointerId); pointers.set(e.pointerId, { x: e.clientX, y: e.clientY }); });
stage.addEventListener('pointermove', (e) => {
  const prev = pointers.get(e.pointerId);
  if (!prev || !bitmap) return;
  pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
  if (pointers.size === 2) {
    const [a, b] = [...pointers.values()];
    const dist = Math.hypot(a.x - b.x, a.y - b.y);
    const r = stage.getBoundingClientRect();
    if (pinch) setZoom(pinch.zoom * (dist / pinch.dist), (a.x + b.x) / 2 - r.left, (a.y + b.y) / 2 - r.top);
    else pinch = { dist, zoom };
    return;
  }
  ox += e.clientX - prev.x; oy += e.clientY - prev.y;
  clamp(); draw();
});
const up = (e) => { pointers.delete(e.pointerId); if (pointers.size < 2) pinch = null; };
stage.addEventListener('pointerup', up);
stage.addEventListener('pointercancel', up);
stage.addEventListener('wheel', (e) => {
  e.preventDefault();
  const r = stage.getBoundingClientRect();
  setZoom(zoom * (e.deltaY < 0 ? 1.08 : 1 / 1.08), e.clientX - r.left, e.clientY - r.top);
}, { passive: false });

cam.querySelector('[data-act=back]').addEventListener('click', () => {
  bitmap = null;
  setMusic(null);
  setState('camera');
  startCamera();
});

// ---------- música ----------
function setMusic(m) {
  music = m;
  chip.hidden = !m;
  audio.pause();
  if (!m) return;
  chip.querySelector('img').src = m.artwork;
  chip.querySelector('strong').textContent = m.title;
  chip.querySelector('small').textContent = m.artist;
  audio.src = m.preview;
  audio.play().catch(() => {});
}
cam.querySelectorAll('[data-act=music]').forEach((b) => b.addEventListener('click', (e) => {
  if (e.target.closest('[data-act=remove-music]')) { setMusic(null); return; }
  sheet.showModal();
  search.focus();
}));
sheet.querySelector('[data-act=close-music]').addEventListener('click', () => { sheet.close(); });
sheet.addEventListener('close', () => { if (!music) audio.pause(); else audio.src !== music.preview ? setMusic(music) : audio.play().catch(() => {}); });

let timer, lastQuery = '';
search.addEventListener('input', () => {
  clearTimeout(timer);
  timer = setTimeout(findMusic, 350);
});
async function findMusic() {
  const q = search.value.trim();
  if (q === lastQuery) return;
  lastQuery = q;
  if (q.length < 2) { list.innerHTML = '<li class="music-hint">Escreve o nome de uma música ou artista.</li>'; return; }
  list.innerHTML = '<li class="music-hint">A procurar…</li>';
  try {
    const r = await fetch(`/musica?q=${encodeURIComponent(q)}`);
    const tracks = await r.json();
    if (q !== lastQuery) return;
    list.replaceChildren(...(tracks.length ? tracks.map(trackItem) : [Object.assign(document.createElement('li'), { className: 'music-hint', textContent: 'Nada encontrado.' })]));
  } catch {
    list.innerHTML = '<li class="music-hint">Não foi possível pesquisar. Tenta outra vez.</li>';
  }
}
function trackItem(t) {
  const li = document.createElement('li');
  const pick = document.createElement('button');
  pick.type = 'button'; pick.className = 'music-item';
  const img = document.createElement('img'); img.src = t.artwork; img.alt = ''; img.loading = 'lazy';
  const text = document.createElement('span');
  const title = document.createElement('strong'); title.textContent = t.title;
  const artist = document.createElement('small'); artist.textContent = t.artist;
  text.append(title, artist);
  pick.append(img, text);
  pick.addEventListener('click', () => { setMusic(t); sheet.close(); });
  // Botão para ouvir antes de escolher.
  const play = document.createElement('button');
  play.type = 'button'; play.className = 'music-play'; play.setAttribute('aria-label', `Ouvir ${t.title}`);
  play.textContent = '▶';
  play.addEventListener('click', () => {
    const playing = audio.src === t.preview && !audio.paused;
    list.querySelectorAll('.music-play').forEach((b) => { b.textContent = '▶'; });
    if (playing) { audio.pause(); return; }
    audio.src = t.preview; audio.play().catch(() => {});
    play.textContent = '❚❚';
  });
  li.append(pick, play);
  return li;
}

// ---------- publicar ----------
publishBtn.addEventListener('click', async () => {
  if (!bitmap) return;
  publishBtn.disabled = true;
  const label = publishBtn.innerHTML;
  publishBtn.textContent = 'A publicar…';
  try {
    const out = document.createElement('canvas');
    out.width = OUT_W; out.height = OUT_H;
    const f = OUT_W / W();
    out.getContext('2d').drawImage(bitmap, ox * f, oy * f, bitmap.width * scale() * f, bitmap.height * scale() * f);
    const blob = await new Promise((ok) => out.toBlob(ok, 'image/jpeg', 0.88));
    const body = new FormData();
    body.append('photo', blob, 'story.jpg');
    if (music) {
      body.append('music_title', music.title);
      body.append('music_artist', music.artist);
      body.append('music_preview', music.preview);
      body.append('music_artwork', music.artwork);
      body.append('music_url', music.url || '');
    }
    const r = await fetch('/stories/nova', { method: 'POST', body, headers: { accept: 'application/json' } });
    const data = await r.json();
    if (!r.ok) throw new Error(data.error);
    audio.pause();
    location.href = data.redirect;
  } catch (err) {
    alert(err.message || 'Não foi possível publicar. Tenta outra vez.');
    publishBtn.disabled = false;
    publishBtn.innerHTML = label;
  }
});

document.addEventListener('visibilitychange', () => {
  if (document.hidden) { stopCamera(); audio.pause(); }
  else if (cam.dataset.state === 'camera') startCamera();
});
startCamera();
