// GIFs: escolher da GIPHY (se houver chave) ou enviar um do telemóvel, nas bocas e nos comentários.
{
  let dialog, grid, search, target, timer, last = null;

  function buildDialog() {
    dialog = document.createElement('dialog');
    dialog.className = 'gif-sheet';
    dialog.innerHTML = `
      <div class="gif-head">
        <input type="search" placeholder="Procurar GIFs" aria-label="Procurar GIFs" enterkeyhint="search">
        <button type="button" class="gif-close" aria-label="Fechar">✕</button>
      </div>
      <div class="gif-grid"></div>
      <p class="gif-credit">Powered by GIPHY</p>`;
    document.body.append(dialog);
    grid = dialog.querySelector('.gif-grid');
    search = dialog.querySelector('input');
    dialog.querySelector('.gif-close').addEventListener('click', () => dialog.close());
    search.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(load, 350); });
  }

  async function load() {
    const q = search.value.trim();
    if (q === last) return;
    last = q;
    grid.innerHTML = '<p class="gif-hint">A carregar…</p>';
    try {
      const gifs = await (await fetch(`/gifs?q=${encodeURIComponent(q)}`)).json();
      if (q !== last) return;
      if (!gifs.length) { grid.innerHTML = '<p class="gif-hint">Nada encontrado.</p>'; return; }
      grid.replaceChildren(...gifs.map((g) => {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'gif-item';
        b.style.aspectRatio = `${g.w} / ${g.h}`;
        b.append(Object.assign(document.createElement('img'), { src: g.preview || g.url, alt: g.title || 'GIF', loading: 'lazy' }));
        b.addEventListener('click', () => { choose(g.url); dialog.close(); });
        return b;
      }));
    } catch {
      grid.innerHTML = '<p class="gif-hint">Não foi possível carregar os GIFs.</p>';
    }
  }

  // Põe o GIF escolhido no formulário (e tira a foto, se houver: um de cada vez).
  function choose(url) {
    const form = target.closest('form');
    form.querySelector('input[name=gif_url]').value = url;
    const file = form.querySelector('input[type=file]');
    if (file) file.value = '';
    showPreview(form, url);
  }
  function showPreview(form, src) {
    const box = form.querySelector('.media-preview');
    if (!box) return;
    box.querySelector('img').src = src;
    box.hidden = false;
  }

  for (const btn of document.querySelectorAll('[data-gif-picker]')) {
    btn.addEventListener('click', () => {
      target = btn;
      if (!dialog) buildDialog();
      dialog.showModal();
      last = null;
      load();
      search.focus();
    });
  }

  // Foto/GIF enviado do telemóvel nos comentários: pré-visualização e botão para tirar.
  for (const form of document.querySelectorAll('form:has(.media-preview)')) {
    const file = form.querySelector('input[type=file]');
    const gif = form.querySelector('input[name=gif_url]');
    const box = form.querySelector('.media-preview');
    file?.addEventListener('cropped', () => { if (gif) gif.value = ''; showPreview(form, form.querySelector('.media-preview img').src); });
    box.querySelector('.media-del').addEventListener('click', () => {
      if (file) file.value = '';
      if (gif) gif.value = '';
      box.hidden = true;
    });
  }
}
