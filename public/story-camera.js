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
// Vídeo: o clip a editar (gravado ou da galeria) e se deve ser espelhado (câmara frontal).
let clip = null; // { url, el, mirror }
const VIDEO_MAX = 15; // segundos
const VIDEO_TYPES = ['video/mp4;codecs=avc1.42E01E,mp4a.40.2', 'video/mp4', 'video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm'];
const pickVideoType = () => (window.MediaRecorder ? VIDEO_TYPES.find((t) => MediaRecorder.isTypeSupported(t)) : null);

const setState = (s) => { cam.dataset.state = s; };

// ---------- câmara ----------
async function startCamera() {
  stopCamera();
  if (!navigator.mediaDevices?.getUserMedia) return showCameraError();
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: facing, width: { ideal: 1920 }, height: { ideal: 1080 } }, audio: false,
    });
    // O microfone (para os vídeos) é pedido à parte, para não atrasar a câmara; sem ele, os vídeos ficam sem som.
    const current = stream;
    navigator.mediaDevices.getUserMedia({ audio: true })
      .then((mic) => { if (stream === current) mic.getAudioTracks().forEach((t) => stream.addTrack(t)); else mic.getTracks().forEach((t) => t.stop()); })
      .catch(() => {});
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

// Disparo: toque = foto; manter carregado = vídeo (até 15 s).
const shutter = cam.querySelector('.cam-shutter');
let holdTimer = null, recorder = null, recStart = 0;
shutter.addEventListener('pointerdown', (e) => {
  if (!video.videoWidth || shutter.disabled) return;
  shutter.setPointerCapture(e.pointerId);
  holdTimer = setTimeout(startRecording, 350);
});
shutter.addEventListener('pointerup', () => {
  if (recorder) { stopRecording(); return; }
  if (holdTimer) { clearTimeout(holdTimer); holdTimer = null; takePhoto(); }
});
shutter.addEventListener('pointercancel', () => { clearTimeout(holdTimer); holdTimer = null; if (recorder) stopRecording(); });
shutter.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); takePhoto(); } });

function startRecording() {
  holdTimer = null;
  const type = pickVideoType();
  if (!type || !stream) { takePhoto(); return; }
  const chunks = [];
  recorder = new MediaRecorder(stream, { mimeType: type, videoBitsPerSecond: 4_000_000 });
  recorder.ondataavailable = (ev) => { if (ev.data.size) chunks.push(ev.data); };
  recorder.onstop = () => {
    const blob = new Blob(chunks, { type: type.split(';')[0] });
    recorder = null;
    shutter.classList.remove('recording');
    shutter.style.removeProperty('--p');
    editVideo(blob, facing === 'user');
  };
  recorder.start(250);
  recStart = performance.now();
  shutter.classList.add('recording');
  const ring = () => {
    if (!recorder) return;
    const p = (performance.now() - recStart) / (VIDEO_MAX * 1000);
    shutter.style.setProperty('--p', Math.min(1, p));
    if (p >= 1) stopRecording(); else requestAnimationFrame(ring);
  };
  requestAnimationFrame(ring);
}
function stopRecording() {
  if (recorder && recorder.state !== 'inactive') recorder.stop();
}

async function takePhoto() {
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
}

gallery.addEventListener('change', async () => {
  const file = gallery.files[0];
  gallery.value = '';
  if (!file) return;
  if (file.type.startsWith('video/')) { editVideo(file, false); return; }
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
// Editar um vídeo: fica a repetir no enquadramento, com os textos e a música por cima.
function editVideo(blob, mirror) {
  if (!pickVideoType()) { alert('Este browser não consegue preparar vídeos. Experimenta com uma foto.'); return; }
  stopCamera();
  dropClip();
  const el = document.createElement('video');
  el.className = `cam-clip${mirror ? ' mirror' : ''}`;
  el.playsInline = true; el.loop = true; el.muted = Boolean(music);
  el.src = URL.createObjectURL(blob);
  frame.prepend(el);
  clip = { url: el.src, el, mirror };
  el.addEventListener('loadedmetadata', () => { if (el.duration > VIDEO_MAX + 0.5) clip.long = true; });
  // Mantém o vídeo dentro dos primeiros 15 s.
  el.addEventListener('timeupdate', () => { if (el.currentTime > VIDEO_MAX) el.currentTime = 0; });
  el.play().catch(() => {});
  bitmap = null;
  cam.dataset.kind = 'video';
  setState('edit');
  requestAnimationFrame(renderTexts);
}
function dropClip() {
  if (!clip) return;
  clip.el.pause(); clip.el.remove(); URL.revokeObjectURL(clip.url);
  clip = null;
}

function edit(bmp) {
  bitmap = bmp;
  cam.dataset.kind = 'photo';
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
  dropClip();
  texts.length = 0; renderTexts();
  setMusic(null);
  setState('camera');
  startCamera();
});

// ---------- texto ----------
// Cada texto guarda posição (x, y) e tamanho como fração do enquadramento, para sair igual na imagem final.
const COLORS = ['#ffffff', '#111111', '#e8b64c', '#9f1d35', '#ff5c8a', '#4cc3ff', '#7be07b'];
// Estilos de letra: a mesma definição serve para o ecrã e para a imagem final.
const FONTS = {
  classica: { label: 'Clássica', css: (px) => `800 ${px}px "Avenir Next", Avenir, Figtree, system-ui, sans-serif` },
  elegante: { label: 'Elegante', css: (px) => `400 ${px}px "DM Serif Display", Georgia, serif` },
  mao: { label: 'À mão', css: (px) => `700 ${px * 1.15}px Caveat, "Segoe Script", cursive` },
  maquina: { label: 'Máquina', css: (px) => `700 ${px * 0.85}px "Space Mono", "Courier New", monospace` },
  cartaz: { label: 'Cartaz', css: (px) => `400 ${px * 1.2}px "Bebas Neue", Impact, sans-serif`, upper: true },
  neon: { label: 'Néon', css: (px) => `800 ${px}px "Avenir Next", Avenir, Figtree, system-ui, sans-serif`, glow: true },
};
const fontOf = (t) => FONTS[t.font] || FONTS.classica;
const FONT = (px, t = {}) => fontOf(t).css(px);
const shown = (t) => (fontOf(t).upper ? t.text.toUpperCase() : t.text);
const MAX_TEXT_W = 0.86;
const textsLayer = cam.querySelector('.cam-texts');
const editor = cam.querySelector('.text-editor');
const editorInput = editor.querySelector('textarea');
const sizeInput = editor.querySelector('.text-size');
const bgBtn = editor.querySelector('[data-act=text-bg]');
const colorsEl = editor.querySelector('.text-colors');
const fontsEl = editor.querySelector('.text-fonts');
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
    el.className = `cam-text${t.bg ? ' bg' : ''}${fontOf(t).glow && !t.bg ? ' neon' : ''}`;
    const px = t.size * fw;
    measureCtx.font = FONT(px, t);
    for (const line of wrap(measureCtx, shown(t), MAX_TEXT_W * fw)) {
      const span = document.createElement('span');
      span.textContent = line || ' ';
      el.append(span);
    }
    el.style.font = FONT(px, t);
    Object.assign(el.style, {
      left: `${t.x * fw}px`, top: `${t.y * fh}px`, lineHeight: 1.3,
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
// Fila de estilos de letra, cada botão escrito na sua própria letra.
for (const [id, f] of Object.entries(FONTS)) {
  const b = document.createElement('button');
  b.type = 'button'; b.className = `font-chip${f.glow ? ' neon' : ''}`; b.dataset.font = id;
  b.setAttribute('role', 'radio');
  b.textContent = f.label;
  b.style.font = f.css(15);
  b.addEventListener('click', () => { editing.font = id; syncEditor(); });
  fontsEl.append(b);
}
function syncEditor() {
  const t = editing;
  const px = t.size * frame.clientWidth;
  editorInput.style.font = FONT(px, t);
  editorInput.style.textTransform = fontOf(t).upper ? 'uppercase' : 'none';
  editorInput.classList.toggle('neon', Boolean(fontOf(t).glow && !t.bg));
  editorInput.style.setProperty('--glow', t.color);
  Object.assign(editorInput.style, {
    lineHeight: 1.3,
    color: t.bg ? inkOn(t.color) : t.color,
    background: t.bg ? t.color : 'transparent',
  });
  bgBtn.setAttribute('aria-pressed', String(t.bg));
  sizeInput.value = t.size;
  colorsEl.querySelectorAll('.swatch').forEach((b, i) => b.setAttribute('aria-checked', String(COLORS[i] === t.color)));
  fontsEl.querySelectorAll('.font-chip').forEach((b) => b.setAttribute('aria-checked', String(b.dataset.font === (t.font || 'classica'))));
}
function openTextEditor(t) {
  editing = t || { text: '', color: '#ffffff', bg: false, size: 0.075, x: 0.5, y: 0.4, font: 'classica', isNew: true };
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
    ctx.font = FONT(px, t);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const lines = wrap(ctx, shown(t), MAX_TEXT_W * w);
    const neon = fontOf(t).glow && !t.bg;
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
      } else if (neon) {
        // Néon: várias passagens com brilho da mesma cor.
        ctx.fillStyle = t.color;
        ctx.shadowColor = t.color;
        for (const blur of [px * 0.9, px * 0.45, px * 0.2]) { ctx.shadowBlur = blur; ctx.fillText(line, t.x * w, cy); }
        ctx.fillStyle = '#ffffff';
        ctx.shadowBlur = px * 0.08;
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
// O autocolante fica onde a pessoa o arrastar (fração do enquadramento) e pode ser escondido.
function placeChip() {
  chip.hidden = !music || music.hidden;
  if (!music) return;
  chip.style.left = `${music.x * 100}%`;
  chip.style.top = `${music.y * 100}%`;
}
function setMusic(m) {
  music = m && { x: 0.5, y: 0.82, hidden: false, ...m };
  if (clip) clip.el.muted = Boolean(music);
  if (stickerToggle) stickerToggle.checked = !music?.hidden;
  placeChip();
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

// Arrastar o autocolante; um toque sem arrastar abre a escolha do trecho.
let chipDrag = null, chipMoved = false;
chip.addEventListener('pointerdown', (e) => {
  if (e.target.closest('[data-act=remove-music]')) return;
  chip.setPointerCapture(e.pointerId);
  chipDrag = { x: e.clientX, y: e.clientY, mx: music.x, my: music.y };
  chipMoved = false;
  chip.classList.add('dragging');
});
chip.addEventListener('pointermove', (e) => {
  if (!chipDrag) return;
  const dx = e.clientX - chipDrag.x, dy = e.clientY - chipDrag.y;
  if (Math.hypot(dx, dy) > 5) chipMoved = true;
  music.x = Math.min(0.95, Math.max(0.05, chipDrag.mx + dx / frame.clientWidth));
  music.y = Math.min(0.95, Math.max(0.05, chipDrag.my + dy / frame.clientHeight));
  placeChip();
});
const endChipDrag = () => { chipDrag = null; chip.classList.remove('dragging'); };
chip.addEventListener('pointerup', endChipDrag);
chip.addEventListener('pointercancel', endChipDrag);

// Mostrar/esconder o autocolante (a música toca na mesma).
const stickerToggle = sheet.querySelector('#music-sticker');
stickerToggle?.addEventListener('change', () => { if (music) { music.hidden = !stickerToggle.checked; placeChip(); } });

cam.querySelectorAll('[data-act=music]').forEach((b) => b.addEventListener('click', (e) => {
  if (e.target.closest('[data-act=remove-music]')) { setMusic(null); return; }
  if (b === chip && chipMoved) { chipMoved = false; return; }
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
// Prepara o vídeo final: 720×1280, até 15 s, com os textos gravados em cada fotograma.
// Reproduz o clip num elemento à parte e grava um canvas (o som original vai junto, exceto se houver música).
const V_W = 720, V_H = 1280, MAX_BYTES = 3.7 * 1024 * 1024;
async function encodeVideo(onProgress) {
  const type = pickVideoType();
  const src = document.createElement('video');
  src.playsInline = true; src.preload = 'auto'; src.src = clip.url;
  // Fica na página (invisível): alguns browsers não descodificam vídeos fora dela.
  Object.assign(src.style, { position: 'fixed', left: '0', top: '0', width: '2px', height: '2px', opacity: '0', pointerEvents: 'none' });
  document.body.append(src);
  await new Promise((ok, fail) => { src.onloadeddata = ok; src.onerror = () => fail(new Error('Não foi possível ler o vídeo.')); });
  const dur = Math.min(VIDEO_MAX, Number.isFinite(src.duration) ? src.duration : VIDEO_MAX);

  // Camada com os textos, desenhada uma vez.
  const overlay = document.createElement('canvas');
  overlay.width = V_W; overlay.height = V_H;
  drawTexts(overlay.getContext('2d'), V_W, V_H);

  const out = document.createElement('canvas');
  out.width = V_W; out.height = V_H;
  const ctx = out.getContext('2d');
  const paint = () => {
    const vw = src.videoWidth, vh = src.videoHeight;
    const k = Math.max(V_W / vw, V_H / vh);
    const dw = vw * k, dh = vh * k;
    ctx.save();
    if (clip.mirror) { ctx.translate(V_W, 0); ctx.scale(-1, 1); }
    ctx.drawImage(src, (V_W - dw) / 2, (V_H - dh) / 2, dw, dh);
    ctx.restore();
    ctx.drawImage(overlay, 0, 0);
  };

  // Capa: primeiro fotograma (com os textos).
  paint();
  const poster = await new Promise((ok) => out.toBlob(ok, 'image/jpeg', 0.85));

  const streamOut = out.captureStream(30);
  let audioCtx = null;
  if (!music) {
    try {
      audioCtx = new AudioContext();
      const dest = audioCtx.createMediaStreamDestination();
      audioCtx.createMediaElementSource(src).connect(dest);
      dest.stream.getAudioTracks().forEach((t) => streamOut.addTrack(t));
    } catch {}
  } else {
    src.muted = true;
  }
  const bps = Math.max(600_000, Math.min(2_500_000, Math.floor((MAX_BYTES * 8) / dur) - 160_000));
  const rec = new MediaRecorder(streamOut, { mimeType: type, videoBitsPerSecond: bps, audioBitsPerSecond: 96_000 });
  const chunks = [];
  rec.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
  const done = new Promise((ok) => { rec.onstop = ok; });

  src.currentTime = 0;
  rec.start(500);
  await src.play();
  await new Promise((ok) => {
    const step = () => {
      paint();
      onProgress(Math.min(1, src.currentTime / dur));
      if (src.ended || src.currentTime >= dur) { ok(); return; }
      requestAnimationFrame(step);
    };
    step();
  });
  src.pause();
  rec.stop();
  await done;
  audioCtx?.close();
  src.remove();
  const video = new Blob(chunks, { type: type.split(';')[0] });
  if (video.size > 4 * 1024 * 1024) throw new Error('O vídeo ficou demasiado grande. Experimenta um mais curto.');
  return { video, poster, ext: type.includes('mp4') ? 'mp4' : 'webm' };
}

publishBtn.addEventListener('click', async () => {
  if (!bitmap && !clip) return;
  if (!editor.hidden) closeTextEditor();
  publishBtn.disabled = true;
  const label = publishBtn.innerHTML;
  publishBtn.textContent = 'A publicar…';
  try {
    await document.fonts.ready;
    await Promise.all(texts.map((t) => document.fonts.load(FONT(40, t), shown(t)).catch(() => {})));
    const body = new FormData();
    if (clip) {
      clip.el.pause();
      audio.pause();
      const { video: vid, poster, ext } = await encodeVideo((p) => { publishBtn.textContent = `A preparar vídeo… ${Math.round(p * 100)}%`; });
      publishBtn.textContent = 'A publicar…';
      body.append('photo', vid, `momento.${ext}`);
      body.append('poster', poster, 'capa.jpg');
    } else {
      const out = document.createElement('canvas');
      out.width = OUT_W; out.height = OUT_H;
      const ctx = out.getContext('2d');
      const f = OUT_W / W();
      ctx.drawImage(bitmap, ox * f, oy * f, bitmap.width * scale() * f, bitmap.height * scale() * f);
      drawTexts(ctx, OUT_W, OUT_H);
      const blob = await new Promise((ok) => out.toBlob(ok, 'image/jpeg', 0.88));
      body.append('photo', blob, 'story.jpg');
    }
    if (music) {
      body.append('music_title', music.title);
      body.append('music_artist', music.artist);
      body.append('music_preview', music.preview);
      body.append('music_artwork', music.artwork);
      body.append('music_url', music.url || '');
      body.append('music_start', String(Math.round(music.start * 10) / 10));
      body.append('music_x', music.x.toFixed(3));
      body.append('music_y', music.y.toFixed(3));
      body.append('music_hidden', music.hidden ? '1' : '0');
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
    clip?.el.play().catch(() => {});
  }
});

document.addEventListener('visibilitychange', () => {
  if (document.hidden) { stopCamera(); audio.pause(); }
  else if (cam.dataset.state === 'camera') startCamera();
  else if (music) playClip();
});
startCamera();
