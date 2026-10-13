// Câmara das stories, ao estilo do Instagram: câmara ao vivo, galeria, enquadrar com os dedos,
// texto por cima da foto, música com escolha do trecho, e publicar.
const cam = document.querySelector('.cam');
const video = cam.querySelector('video');
const stage = cam.querySelector('.cam-edit');
const frame = cam.querySelector('.cam-frame');
const errorEl = cam.querySelector('.cam-error');
const gallery = cam.querySelector('.cam-gallery input');
const publishBtn = cam.querySelector('[data-act=publish]');
const OUT_W = 1080, OUT_H = 1920;
const CLIP = 15; // segundos de música por story

let stream = null, facing = 'environment';
let bitmap = null, zoom = 1, ox = 0, oy = 0, base = 1;

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
    clamp(); draw(); renderTexts();
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
  texts.length = 0; renderTexts();
  setMusic(null);
  setState('camera');
  startCamera();
});

// ---------- texto ----------
// Cada texto guarda posição (x, y) e tamanho como fração do enquadramento, para sair igual na imagem final.
const COLORS = ['#ffffff', '#111111', '#e8b64c', '#9f1d35', '#ff5c8a', '#4cc3ff', '#7be07b'];
const FONT = (px) => `800 ${px}px Archivo, system-ui, sans-serif`;
const MAX_TEXT_W = 0.86;
const textsLayer = cam.querySelector('.cam-texts');
const editor = cam.querySelector('.text-editor');
const editorInput = editor.querySelector('textarea');
const sizeInput = editor.querySelector('.text-size');
const bgBtn = editor.querySelector('[data-act=text-bg]');
const colorsEl = editor.querySelector('.text-colors');
const texts = [];
let editing = null; // texto a ser editado
const measureCtx = document.createElement('canvas').getContext('2d');

const luminance = (hex) => {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const inkOn = (hex) => (luminance(hex) > 0.6 ? '#111111' : '#ffffff');

// Parte o texto em linhas que caibam na largura (mesma regra no ecrã e na imagem final).
function wrap(ctx, text, maxW) {
  const lines = [];
  for (const para of text.split('\n')) {
    let line = '';
    for (const word of para.split(/\s+/).filter(Boolean)) {
      const tryLine = line ? `${line} ${word}` : word;
      if (ctx.measureText(tryLine).width <= maxW || !line) line = tryLine;
      else { lines.push(line); line = word; }
    }
    lines.push(line);
  }
  return lines;
}

function renderTexts() {
  const fw = frame.clientWidth, fh = frame.clientHeight;
  textsLayer.replaceChildren(...texts.filter((t) => t !== editing).map((t) => {
    const el = document.createElement('div');
    el.className = `cam-text${t.bg ? ' bg' : ''}`;
    const px = t.size * fw;
    measureCtx.font = FONT(px);
    for (const line of wrap(measureCtx, t.text, MAX_TEXT_W * fw)) {
      const span = document.createElement('span');
      span.textContent = line || ' ';
      el.append(span);
    }
    Object.assign(el.style, {
      left: `${t.x * fw}px`, top: `${t.y * fh}px`, fontSize: `${px}px`,
      color: t.bg ? inkOn(t.color) : t.color,
      '--bg': t.color,
    });
    dragText(el, t);
    return el;
  }));
}

function dragText(el, t) {
  let start = null;
  el.addEventListener('pointerdown', (e) => {
    e.stopPropagation();
    el.setPointerCapture(e.pointerId);
    start = { x: e.clientX, y: e.clientY, tx: t.x, ty: t.y, moved: false };
    el.classList.add('dragging');
  });
  el.addEventListener('pointermove', (e) => {
    if (!start) return;
    const dx = e.clientX - start.x, dy = e.clientY - start.y;
    if (Math.hypot(dx, dy) > 5) start.moved = true;
    t.x = Math.min(1, Math.max(0, start.tx + dx / frame.clientWidth));
    t.y = Math.min(1, Math.max(0, start.ty + dy / frame.clientHeight));
    el.style.left = `${t.x * frame.clientWidth}px`;
    el.style.top = `${t.y * frame.clientHeight}px`;
  });
  el.addEventListener('pointerup', () => {
    el.classList.remove('dragging');
    if (start && !start.moved) openTextEditor(t);
    start = null;
  });
}

for (const c of COLORS) {
  const b = document.createElement('button');
  b.type = 'button'; b.className = 'swatch'; b.style.background = c;
  b.setAttribute('role', 'radio'); b.setAttribute('aria-label', `Cor ${c}`);
  b.addEventListener('click', () => { editing.color = c; syncEditor(); });
  colorsEl.append(b);
}
function syncEditor() {
  const t = editing;
  const px = t.size * frame.clientWidth;
  Object.assign(editorInput.style, {
    fontSize: `${px}px`,
    color: t.bg ? inkOn(t.color) : t.color,
    background: t.bg ? t.color : 'transparent',
  });
  bgBtn.setAttribute('aria-pressed', String(t.bg));
  sizeInput.value = t.size;
  colorsEl.querySelectorAll('.swatch').forEach((b, i) => b.setAttribute('aria-checked', String(COLORS[i] === t.color)));
}
function openTextEditor(t) {
  editing = t || { text: '', color: '#ffffff', bg: false, size: 0.075, x: 0.5, y: 0.4, isNew: true };
  editorInput.value = editing.text;
  editor.hidden = false;
  cam.classList.add('texting');
  renderTexts();
  syncEditor();
  editorInput.focus();
}
function closeTextEditor() {
  const t = editing;
  t.text = editorInput.value.trim();
  if (t.isNew && t.text) { delete t.isNew; texts.push(t); }
  if (!t.text) { const i = texts.indexOf(t); if (i >= 0) texts.splice(i, 1); }
  editing = null;
  editor.hidden = true;
  cam.classList.remove('texting');
  renderTexts();
}
cam.querySelector('[data-act=text]').addEventListener('click', () => openTextEditor());
editor.querySelector('[data-act=text-done]').addEventListener('click', closeTextEditor);
bgBtn.addEventListener('click', () => { editing.bg = !editing.bg; syncEditor(); });
sizeInput.addEventListener('input', () => { editing.size = Number(sizeInput.value); syncEditor(); });
addEventListener('resize', () => { if (cam.dataset.state === 'edit') renderTexts(); });

// Desenha os textos na imagem final (mesmas proporções do ecrã).
function drawTexts(ctx, w, h) {
  for (const t of texts) {
    const px = t.size * w;
    ctx.font = FONT(px);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const lines = wrap(ctx, t.text, MAX_TEXT_W * w);
    const lh = px * 1.3;
    const top = t.y * h - (lines.length * lh) / 2;
    lines.forEach((line, i) => {
      const cy = top + lh * (i + 0.5);
      if (t.bg && line) {
        const tw = ctx.measureText(line).width + px * 0.6;
        ctx.fillStyle = t.color;
        ctx.beginPath();
        ctx.roundRect(t.x * w - tw / 2, cy - lh / 2, tw, lh, px * 0.25);
        ctx.fill();
        ctx.fillStyle = inkOn(t.color);
        ctx.shadowColor = 'transparent';
      } else {
        ctx.fillStyle = t.color;
        ctx.shadowColor = 'rgba(0,0,0,.35)';
        ctx.shadowBlur = px * 0.15;
      }
      ctx.fillText(line, t.x * w, cy);
      ctx.shadowColor = 'transparent'; ctx.shadowBlur = 0;
    });
  }
}

// ---------- música ----------
const sheet = cam.querySelector('.music-sheet');
const search = sheet.querySelector('input');
const list = sheet.querySelector('.music-list');
const chip = cam.querySelector('.music-chip');
const paneSearch = sheet.querySelector('[data-pane=search]');
const paneTrim = sheet.querySelector('[data-pane=trim]');
const trimBar = sheet.querySelector('.trim-bar');
const trimWindow = sheet.querySelector('.trim-window');
const trimProgress = sheet.querySelector('.trim-progress');
const trimTime = sheet.querySelector('.trim-time');
const audio = new Audio();
let music = null;     // música escolhida: { title, artist, preview, artwork, url, start }
let previewing = false; // a ouvir outra música na lista de pesquisa

const duration = () => (Number.isFinite(audio.duration) && audio.duration > 0 ? audio.duration : 30);
const clipLen = () => Math.min(CLIP, duration());
const mmss = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

// Mantém o som dentro do trecho escolhido.
audio.addEventListener('timeupdate', () => {
  if (!music || previewing) return;
  const end = music.start + clipLen();
  if (audio.currentTime >= end - 0.05 || audio.currentTime < music.start - 0.5) audio.currentTime = music.start;
  trimProgress.style.width = `${((audio.currentTime - music.start) / clipLen()) * 100}%`;
});
audio.addEventListener('loadedmetadata', () => { if (music && !previewing) updateTrim(); });
audio.addEventListener('ended', () => { if (music && !previewing) { audio.currentTime = music.start; audio.play().catch(() => {}); } });

function playClip() {
  previewing = false;
  if (!music) return;
  if (audio.src !== music.preview) audio.src = music.preview;
  audio.currentTime = music.start;
  audio.play().catch(() => {});
}
function setMusic(m) {
  music = m;
  chip.hidden = !m;
  audio.pause();
  if (!m) return;
  chip.querySelector('img').src = m.artwork;
  chip.querySelector('strong').textContent = m.title;
  chip.querySelector('small').textContent = m.artist;
  playClip();
}
function showPane(p) {
  paneSearch.hidden = p !== 'search';
  paneTrim.hidden = p !== 'trim';
  if (p === 'search') search.focus();
}
function openTrim() {
  paneTrim.querySelector('img').src = music.artwork;
  paneTrim.querySelector('strong').textContent = music.title;
  paneTrim.querySelector('small').textContent = music.artist;
  showPane('trim');
  updateTrim();
  playClip();
}
function updateTrim() {
  const d = duration();
  music.start = Math.min(Math.max(0, music.start), Math.max(0, d - clipLen()));
  trimWindow.style.left = `${(music.start / d) * 100}%`;
  trimWindow.style.width = `${(clipLen() / d) * 100}%`;
  trimTime.textContent = `${mmss(music.start)} – ${mmss(music.start + clipLen())}`;
}

// Barras decorativas (as pré-visualizações da Apple não deixam ler o áudio para desenhar a onda real).
const wave = sheet.querySelector('.trim-wave');
for (let i = 0; i < 48; i++) {
  const b = document.createElement('i');
  b.style.height = `${30 + Math.abs(Math.sin(i * 1.7) * 45) + (i % 3) * 8}%`;
  wave.append(b);
}

// Arrastar a janela do trecho.
let drag = null;
trimBar.addEventListener('pointerdown', (e) => {
  trimBar.setPointerCapture(e.pointerId);
  const r = trimBar.getBoundingClientRect();
  const winLeft = (music.start / duration()) * r.width;
  const winW = (clipLen() / duration()) * r.width;
  const x = e.clientX - r.left;
  // Se tocar fora da janela, centra-a nesse ponto.
  drag = { offset: x >= winLeft && x <= winLeft + winW ? x - winLeft : winW / 2 };
  moveTrim(e);
  audio.pause();
});
trimBar.addEventListener('pointermove', (e) => { if (drag) moveTrim(e); });
trimBar.addEventListener('pointerup', () => { drag = null; playClip(); });
function moveTrim(e) {
  const r = trimBar.getBoundingClientRect();
  music.start = ((e.clientX - r.left - drag.offset) / r.width) * duration();
  updateTrim();
}

cam.querySelectorAll('[data-act=music]').forEach((b) => b.addEventListener('click', (e) => {
  if (e.target.closest('[data-act=remove-music]')) { setMusic(null); return; }
  sheet.showModal();
  if (music) openTrim(); else showPane('search');
}));
sheet.querySelector('[data-act=close-music]').addEventListener('click', () => sheet.close());
sheet.querySelector('[data-act=trim-done]').addEventListener('click', () => sheet.close());
sheet.querySelector('[data-act=change-music]').addEventListener('click', () => { audio.pause(); showPane('search'); });
sheet.addEventListener('close', () => { if (music) playClip(); else audio.pause(); });

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
  // Ao escolher, passa para a escolha do trecho (começa a meio do excerto, como no Instagram).
  pick.addEventListener('click', () => { setMusic({ ...t, start: 7.5 }); openTrim(); });
  // Botão para ouvir antes de escolher.
  const play = document.createElement('button');
  play.type = 'button'; play.className = 'music-play'; play.setAttribute('aria-label', `Ouvir ${t.title}`);
  play.textContent = '▶';
  play.addEventListener('click', () => {
    const playing = previewing && audio.src === t.preview && !audio.paused;
    list.querySelectorAll('.music-play').forEach((b) => { b.textContent = '▶'; });
    if (playing) { audio.pause(); return; }
    previewing = true;
    audio.src = t.preview; audio.play().catch(() => {});
    play.textContent = '❚❚';
  });
  li.append(pick, play);
  return li;
}

// ---------- publicar ----------
publishBtn.addEventListener('click', async () => {
  if (!bitmap) return;
  if (!editor.hidden) closeTextEditor();
  publishBtn.disabled = true;
  const label = publishBtn.innerHTML;
  publishBtn.textContent = 'A publicar…';
  try {
    await document.fonts.ready;
    const out = document.createElement('canvas');
    out.width = OUT_W; out.height = OUT_H;
    const ctx = out.getContext('2d');
    const f = OUT_W / W();
    ctx.drawImage(bitmap, ox * f, oy * f, bitmap.width * scale() * f, bitmap.height * scale() * f);
    drawTexts(ctx, OUT_W, OUT_H);
    const blob = await new Promise((ok) => out.toBlob(ok, 'image/jpeg', 0.88));
    const body = new FormData();
    body.append('photo', blob, 'story.jpg');
    if (music) {
      body.append('music_title', music.title);
      body.append('music_artist', music.artist);
      body.append('music_preview', music.preview);
      body.append('music_artwork', music.artwork);
      body.append('music_url', music.url || '');
      body.append('music_start', String(Math.round(music.start * 10) / 10));
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
  else if (music) playClip();
});
startCamera();
