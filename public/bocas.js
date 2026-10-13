// Bocas: contador de caracteres, caixas que crescem com o texto e 🔥 sem recarregar a página.
// Num bloco próprio para as variáveis não colidirem com as dos outros scripts da página.
{
const counter = document.querySelector('.composer-count');
const composer = document.querySelector('.composer textarea');
if (composer && counter) {
  const max = Number(counter.dataset.max);
  const update = () => {
    const left = max - composer.value.length;
    counter.textContent = left;
    counter.classList.toggle('warn', left <= 20);
  };
  composer.addEventListener('input', update);
  update();
}
for (const t of document.querySelectorAll('.composer textarea, .comment-form textarea')) {
  const grow = () => { t.style.height = ''; t.style.height = `${Math.min(t.scrollHeight, 220)}px`; };
  t.addEventListener('input', grow);
  // Ctrl/Cmd + Enter envia.
  t.addEventListener('keydown', (e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) t.form.requestSubmit(); });
}

// Foto na boca: mostra a pré-visualização depois de ajustada e deixa tirá-la.
const photoInput = document.querySelector('.composer input[type=file]');
const photoBox = document.querySelector('.composer-photo');
if (photoInput && photoBox) {
  photoInput.addEventListener('cropped', () => { photoBox.hidden = false; });
  photoBox.querySelector('.composer-photo-del').addEventListener('click', () => {
    photoInput.value = '';
    photoBox.hidden = true;
  });
}

const calm = matchMedia('(prefers-reduced-motion: reduce)').matches;
for (const form of document.querySelectorAll('.fogo-form')) {
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = form.querySelector('.fogo');
    const count = btn.querySelector('span');
    const on = !btn.classList.contains('on');
    btn.classList.toggle('on', on);
    btn.setAttribute('aria-pressed', String(on));
    count.textContent = Number(count.textContent) + (on ? 1 : -1);
    if (on && !calm) {
      btn.classList.remove('pop'); void btn.offsetWidth; btn.classList.add('pop');
      for (let k = 0; k < 5; k++) {
        const f = Object.assign(document.createElement('span'), { className: 'mini-burst', textContent: '🔥' });
        f.style.setProperty('--bx', `${(Math.random() - 0.5) * 60}px`);
        f.style.setProperty('--by', `${-30 - Math.random() * 50}px`);
        btn.append(f);
        setTimeout(() => f.remove(), 600);
      }
    }
    try {
      const r = await fetch(form.action, { method: 'POST', headers: { accept: 'application/json' } });
      const data = await r.json();
      btn.classList.toggle('on', data.on);
      btn.setAttribute('aria-pressed', String(data.on));
      count.textContent = data.fogos;
    } catch {}
  });
}
}
