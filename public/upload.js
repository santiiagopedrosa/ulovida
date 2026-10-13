// Ao escolher uma foto, abre um editor para a enquadrar (arrastar + zoom, com pinça no telemóvel).
// O resultado já recortado e reduzido substitui o ficheiro no formulário, por isso o envio fica leve.
// Sem JavaScript, o envio normal continua a funcionar e o servidor trata da foto.

function openCropper(bitmap, { aspect, ratio, round }) {
  return new Promise((resolve) => {
    const dialog = document.createElement('dialog');
    dialog.className = 'cropper';
    dialog.innerHTML = `
      <p class="cropper-title">Ajustar foto</p>
      <div class="cropper-stage ${round ? 'round' : ''}" style="aspect-ratio: ${aspect}; width: min(100%, calc(60vh * ${ratio})); margin: 0 auto">
        <canvas></canvas>
      </div>
      <label class="cropper-zoom"><span class="muted small">Zoom</span>
        <input type="range" min="1" max="4" step="0.01" value="1" aria-label="Zoom">
      </label>
      <p class="muted small cropper-tip">Arrasta para posicionar.</p>
      <div class="row cropper-actions">
        <button type="button" class="btn ghost" data-act="cancel">Cancelar</button>
        <button type="button" class="btn" data-act="ok">Usar foto</button>
      </div>`;
    document.body.append(dialog);
    const stage = dialog.querySelector('.cropper-stage');
    const canvas = dialog.querySelector('canvas');
    const range = dialog.querySelector('input[type=range]');
    const ctx = canvas.getContext('2d');
    dialog.showModal();

    let W, H, base, zoom = 1, ox = 0, oy = 0;
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
    requestAnimationFrame(layout);

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
    dialog.querySelector('[data-act=ok]').addEventListener('click', () => close({ W, H, ox, oy, s: scale() }));
  });
}

for (const input of document.querySelectorAll('input[type=file][data-max]')) {
  const preview = document.getElementById(input.dataset.preview);
  const original = preview?.getAttribute('src');
  const [aw, ah] = (input.dataset.aspect || '1').split('/').map(Number);
  const aspect = aw / (ah || 1);

  input.addEventListener('change', async () => {
    const file = input.files[0];
    if (!file || !file.type.startsWith('image/')) return;
    let bitmap;
    try { bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' }); } catch { return; }

    const crop = await openCropper(bitmap, { aspect: `${aw} / ${ah || 1}`, ratio: aspect, round: 'round' in input.dataset });
    if (!crop) {
      // Cancelado: limpa a escolha e repõe a foto anterior.
      input.value = '';
      if (preview) { if (original) preview.src = original; else preview.hidden = true; }
      return;
    }
    const outW = Number(input.dataset.max);
    const outH = Math.round(outW / aspect);
    const f = outW / crop.W;
    const canvas = document.createElement('canvas');
    canvas.width = outW; canvas.height = outH;
    canvas.getContext('2d').drawImage(bitmap, crop.ox * f, crop.oy * f, bitmap.width * crop.s * f, bitmap.height * crop.s * f);
    const blob = await new Promise((ok) => canvas.toBlob(ok, 'image/jpeg', 0.88));
    if (!blob) return;
    const dt = new DataTransfer();
    dt.items.add(new File([blob], 'foto.jpg', { type: 'image/jpeg' }));
    input.files = dt.files;
    if (preview) { preview.src = URL.createObjectURL(blob); preview.hidden = false; }
  });
}
