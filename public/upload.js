// Ao escolher uma foto, abre um editor para a enquadrar (arrastar + zoom, com pinça no telemóvel).
// O resultado já recortado e reduzido substitui o ficheiro no formulário, por isso o envio fica leve.
// Sem JavaScript, o envio normal continua a funcionar e o servidor trata da foto.

const ASPECT_LABELS = { '16/9': 'Horizontal', '1/1': 'Quadrada', '4/5': 'Vertical', '9/16': 'Vertical' };
const ratioOf = (a) => { const [w, h] = a.split('/').map(Number); return w / (h || 1); };

// aspects: lista de formatos possíveis (ex.: ['16/9', '1/1', '4/5']); start: o que aparece primeiro.
function openCropper(bitmap, { aspects, start, round }) {
  return new Promise((resolve) => {
    const dialog = document.createElement('dialog');
    dialog.className = 'cropper';
    dialog.innerHTML = `
      <p class="cropper-title">Ajustar foto</p>
      ${aspects.length > 1 ? `<div class="cropper-aspects" role="radiogroup" aria-label="Formato">${aspects.map((a) =>
        `<button type="button" role="radio" data-aspect="${a}"><i style="aspect-ratio: ${a.replace('/', ' / ')}"></i>${ASPECT_LABELS[a] || a}</button>`).join('')}</div>` : ''}
      <div class="cropper-stage ${round ? 'round' : ''}" style="margin: 0 auto">
        <canvas></canvas>
      </div>
      <label class="cropper-zoom"><span class="muted small">Zoom</span>
        <input type="range" min="1" max="4" step="0.01" value="1" aria-label="Zoom">
      </label>
      <p class="muted small cropper-tip">Arrasta para posicionar.</p>
      <div class="row cropper-actions">
        <button type="button" class="btn ghost" data-act="cancel">Cancelar</button>
        <button type="button" class="btn" data-act="ok" autofocus>Usar foto</button>
      </div>`;
    document.body.append(dialog);
    const stage = dialog.querySelector('.cropper-stage');
    const canvas = dialog.querySelector('canvas');
    const range = dialog.querySelector('input[type=range]');
    const ctx = canvas.getContext('2d');
    dialog.showModal();

    let W, H, base, zoom = 1, ox = 0, oy = 0, current = start;
    // Muda o formato do enquadramento e recomeça o enquadramento.
    const setAspect = (a) => {
      current = a;
      stage.style.aspectRatio = a.replace('/', ' / ');
      stage.style.width = `min(100%, calc(60vh * ${ratioOf(a)}))`;
      dialog.querySelectorAll('.cropper-aspects button').forEach((b) => b.setAttribute('aria-checked', String(b.dataset.aspect === a)));
      zoom = 1; range.value = 1;
      requestAnimationFrame(layout);
    };
    const scale = () => base * zoom;
    const clamp = () => {
      const s = scale();
      ox = Math.min(0, Math.max(W - bitmap.width * s, ox));
      oy = Math.min(0, Math.max(H - bitmap.height * s, oy));
    };
    const draw = () => {
      ctx.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0);
      ctx.clearRect(0, 0, W, H);
      ctx.drawImage(bitmap, ox, oy, bitmap.width * scale(), bitmap.height * scale());
    };
    const layout = () => {
      W = stage.clientWidth; H = stage.clientHeight;
      canvas.width = W * devicePixelRatio; canvas.height = H * devicePixelRatio;
      base = Math.max(W / bitmap.width, H / bitmap.height);
      ox = (W - bitmap.width * scale()) / 2; oy = (H - bitmap.height * scale()) / 2;
      clamp(); draw();
    };
    // Muda o zoom mantendo fixo o ponto (px, py) do enquadramento.
    const setZoom = (z, px = W / 2, py = H / 2) => {
      z = Math.min(4, Math.max(1, z));
      const s0 = scale();
      zoom = z;
      ox = px - (px - ox) * (scale() / s0);
      oy = py - (py - oy) * (scale() / s0);
      range.value = z; clamp(); draw();
    };
    setAspect(start);
    dialog.querySelectorAll('.cropper-aspects button').forEach((b) => b.addEventListener('click', () => setAspect(b.dataset.aspect)));

    range.addEventListener('input', () => setZoom(Number(range.value)));
    stage.addEventListener('wheel', (e) => {
      e.preventDefault();
      const r = stage.getBoundingClientRect();
      setZoom(zoom * (e.deltaY < 0 ? 1.08 : 1 / 1.08), e.clientX - r.left, e.clientY - r.top);
    }, { passive: false });

    // Arrastar com um dedo/rato, pinça com dois dedos.
    const pointers = new Map();
    let pinch = null;
    stage.addEventListener('pointerdown', (e) => {
      stage.setPointerCapture(e.pointerId);
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    });
    stage.addEventListener('pointermove', (e) => {
      const prev = pointers.get(e.pointerId);
      if (!prev) return;
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

    const close = (result) => { dialog.close(); dialog.remove(); resolve(result); };
    dialog.addEventListener('cancel', (e) => { e.preventDefault(); close(null); });
    dialog.querySelector('[data-act=cancel]').addEventListener('click', () => close(null));
    dialog.querySelector('[data-act=ok]').addEventListener('click', () => close({ W, H, ox, oy, s: scale(), aspect: current }));
  });
}

for (const input of document.querySelectorAll('input[type=file][data-max]')) {
  const preview = document.getElementById(input.dataset.preview);
  const original = preview?.getAttribute('src');
  // data-aspects="16/9,1/1,4/5" deixa escolher o formato; data-aspect fixa um só.
  const aspects = (input.dataset.aspects || input.dataset.aspect || '1/1').split(',').map((a) => a.trim());

  input.addEventListener('change', async () => {
    const file = input.files[0];
    if (!file || !file.type.startsWith('image/')) return;
    // GIFs não passam pelo recorte (perderiam a animação): vão tal como estão.
    if (file.type === 'image/gif') {
      if (file.size > 4 * 1024 * 1024) { alert('Esse GIF é demasiado grande (máximo 4 MB).'); input.value = ''; return; }
      if (preview) { preview.src = URL.createObjectURL(file); preview.hidden = false; preview.dataset.shape = 'gif'; }
      input.dispatchEvent(new CustomEvent('cropped', { bubbles: true }));
      return;
    }
    let bitmap;
    try { bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' }); } catch { return; }

    // Começa no formato mais parecido com a foto (vertical, quadrada ou horizontal).
    const photo = bitmap.width / bitmap.height;
    const start = aspects.reduce((best, a) => (Math.abs(ratioOf(a) - photo) < Math.abs(ratioOf(best) - photo) ? a : best), aspects[0]);
    const crop = await openCropper(bitmap, { aspects, start, round: 'round' in input.dataset });
    if (!crop) {
      // Cancelado: limpa a escolha e repõe a foto anterior.
      input.value = '';
      if (preview) { if (original) preview.src = original; else preview.hidden = true; }
      return;
    }
    const ratio = ratioOf(crop.aspect);
    // data-max é o lado maior da imagem final.
    const max = Number(input.dataset.max);
    const outW = Math.round(ratio >= 1 ? max : max * ratio);
    const outH = Math.round(ratio >= 1 ? max / ratio : max);
    const f = outW / crop.W;
    const canvas = document.createElement('canvas');
    canvas.width = outW; canvas.height = outH;
    canvas.getContext('2d').drawImage(bitmap, crop.ox * f, crop.oy * f, bitmap.width * crop.s * f, bitmap.height * crop.s * f);
    const blob = await new Promise((ok) => canvas.toBlob(ok, 'image/jpeg', 0.88));
    if (!blob) return;
    const dt = new DataTransfer();
    dt.items.add(new File([blob], 'foto.jpg', { type: 'image/jpeg' }));
    input.files = dt.files;
    if (preview) { preview.src = URL.createObjectURL(blob); preview.hidden = false; preview.dataset.shape = ratio < 0.95 ? 'tall' : ratio > 1.05 ? 'wide' : 'square'; }
    input.dispatchEvent(new CustomEvent('cropped', { bubbles: true }));
  });
}
