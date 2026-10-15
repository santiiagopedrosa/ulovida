// Pequenas animações do ULOO: números a contar, cartão de membro com inclinação 3D e elementos a aparecer com o scroll.
// Num bloco próprio para as variáveis não colidirem com as dos outros scripts da página.
{
const calm = matchMedia('(prefers-reduced-motion: reduce)').matches;

// Números a contar até ao valor quando aparecem no ecrã.
const fmt = new Intl.NumberFormat('pt-PT');
function countUp(el) {
  const target = Number(el.dataset.count) || 0;
  if (calm || target === 0) { el.textContent = fmt.format(target); return; }
  const t0 = performance.now(), dur = 800;
  const step = (now) => {
    const p = Math.min(1, (now - t0) / dur);
    el.textContent = fmt.format(Math.round(target * (1 - (1 - p) ** 3)));
    if (p < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

// Elementos abaixo da dobra aparecem quando se chega a eles.
const revealSel = '.event, .person, .convo, .mini, .suggest, .features > div';
const io = new IntersectionObserver((entries) => {
  for (const e of entries) {
    if (!e.isIntersecting) continue;
    io.unobserve(e.target);
    if (e.target.dataset.count !== undefined) countUp(e.target);
    else e.target.classList.add('in');
  }
}, { rootMargin: '0px 0px 6% 0px' });

document.querySelectorAll('[data-count]').forEach((el) => { el.textContent = '0'; io.observe(el); });
if (!calm) {
  document.querySelectorAll(revealSel).forEach((el, k) => {
    if (el.getBoundingClientRect().top < innerHeight) return; // o que já se vê usa a animação de entrada
    el.style.animation = 'none';
    el.classList.add('reveal');
    el.style.setProperty('--d', `${(k % 4) * 35}ms`);
    io.observe(el);
  });
}

// Momentos: o "Novo" desaparece logo ao abrir; ao voltar atrás a página já vem sem ele.
for (const m of document.querySelectorAll('.moment.new')) {
  m.addEventListener('click', () => {
    m.classList.replace('new', 'seen');
    m.querySelector('.moment-new')?.remove();
  });
}
// Se o browser repuser a página da memória (botão voltar), recarrega para os momentos ficarem certos.
addEventListener('pageshow', (e) => { if (e.persisted && document.querySelector('.moments')) location.reload(); });

// Botão com um olho para mostrar/esconder a password.
const EYE = '<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2.062 12.348a1 1 0 0 1 0-.696 10.75 10.75 0 0 1 19.876 0 1 1 0 0 1 0 .696 10.75 10.75 0 0 1-19.876 0"/><circle cx="12" cy="12" r="3"/></svg>';
const EYE_OFF = '<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M10.733 5.076a10.744 10.744 0 0 1 11.205 6.575 1 1 0 0 1 0 .696 10.747 10.747 0 0 1-1.444 2.49"/><path d="M14.084 14.158a3 3 0 0 1-4.242-4.242"/><path d="M17.479 17.499a10.75 10.75 0 0 1-15.417-5.151 1 1 0 0 1 0-.696 10.75 10.75 0 0 1 4.446-5.143"/><path d="m2 2 20 20"/></svg>';
for (const input of document.querySelectorAll('input[type=password]')) {
  const wrap = document.createElement('span');
  wrap.className = 'pw-field';
  input.replaceWith(wrap);
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'pw-toggle';
  const set = (show) => {
    input.type = show ? 'text' : 'password';
    btn.innerHTML = show ? EYE_OFF : EYE;
    btn.setAttribute('aria-label', show ? 'Esconder password' : 'Mostrar password');
    btn.setAttribute('aria-pressed', String(show));
  };
  btn.addEventListener('click', () => { set(input.type === 'password'); input.focus(); });
  wrap.append(input, btn);
  set(false);
}

// Cartão de membro: inclina com o rato/dedo e o brilho segue o ponteiro.
for (const card of document.querySelectorAll('[data-tilt]')) {
  if (calm) break;
  card.addEventListener('pointermove', (e) => {
    const r = card.getBoundingClientRect();
    const x = (e.clientX - r.left) / r.width, y = (e.clientY - r.top) / r.height;
    card.style.setProperty('--ry', `${(x - 0.5) * 16}deg`);
    card.style.setProperty('--rx', `${(0.5 - y) * 12}deg`);
    card.style.setProperty('--mx', `${x * 100}%`);
    card.style.setProperty('--my', `${y * 100}%`);
    card.classList.add('tilting');
  });
  card.addEventListener('pointerleave', () => {
    card.classList.remove('tilting');
    card.style.setProperty('--rx', '0deg'); card.style.setProperty('--ry', '0deg');
  });
}

// Formulários que não podem ir duas vezes (ex.: enviar código): o botão fica bloqueado enquanto o pedido segue.
for (const form of document.querySelectorAll('form[data-once]')) {
  const btn = form.querySelector('button:not([type=button])');
  const label = btn?.textContent;
  form.addEventListener('submit', (e) => {
    if (form.dataset.sending) { e.preventDefault(); return; }
    form.dataset.sending = '1';
    if (btn) { btn.disabled = true; btn.textContent = btn.dataset.busy || 'Aguarda…'; }
  });
  // Ao voltar atrás no browser, o botão fica outra vez ativo.
  addEventListener('pageshow', () => { delete form.dataset.sending; if (btn) { btn.disabled = false; btn.textContent = label; } });
}
// "Esqueci-me da password": leva o email já escrito para a página de recuperar.
document.getElementById('forgot')?.addEventListener('click', (e) => {
  const v = document.querySelector('form[action="/entrar"] input[name=email]')?.value.trim();
  if (v) { e.preventDefault(); location.href = `/recuperar?email=${encodeURIComponent(v)}`; }
});
// "Já recebeste o código?": leva o email escrito para a página do código.
document.getElementById('have-code')?.addEventListener('click', (e) => {
  const input = document.querySelector('form[action="/registar"] input[name=email]');
  e.preventDefault();
  if (!input.checkValidity() || !input.value) { input.reportValidity(); input.focus(); return; }
  location.href = `/confirmar?email=${encodeURIComponent(input.value.trim())}`;
});

// Puxar para baixo para atualizar, quando o ULOO está aberto como app (ecrã principal do iPhone/Android).
// No Safari normal o próprio browser já faz isto, por isso só se ativa no modo app.
const standalone = matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
if (standalone && !document.body.classList.contains('story-page')) {
  const MAX = 110, READY = 70;
  const ptr = document.createElement('div');
  ptr.className = 'ptr';
  ptr.setAttribute('aria-hidden', 'true');
  ptr.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a9 9 0 1 1-3-6.7L21 8"/><path d="M21 3v5h-5"/></svg>';
  document.body.append(ptr);
  let startY = null, dist = 0, busy = false;
  const set = (d) => {
    dist = d;
    ptr.style.setProperty('--pull', `${d}px`);
    ptr.style.setProperty('--turn', `${d * 3}deg`);
    ptr.style.opacity = Math.min(1, d / 40);
    ptr.classList.toggle('ready', d >= READY);
  };
  // Não começa dentro de janelas, conversas, caixas de texto ou zonas de arrastar.
  const blocked = (el) => el.closest('dialog, .chat-log, input, textarea, select, .cropper-stage, .trim-bar, [data-no-ptr]');
  addEventListener('touchstart', (e) => {
    if (busy || scrollY > 0 || e.touches.length !== 1 || blocked(e.target)) { startY = null; return; }
    startY = e.touches[0].clientY;
  }, { passive: true });
  addEventListener('touchmove', (e) => {
    if (startY === null) return;
    const dy = e.touches[0].clientY - startY;
    if (dy <= 0 || scrollY > 0) { if (dist) set(0); return; }
    e.preventDefault();
    ptr.classList.add('pulling');
    set(Math.min(MAX, dy * 0.5));
  }, { passive: false });
  const end = () => {
    if (startY === null) return;
    startY = null;
    ptr.classList.remove('pulling');
    if (dist >= READY) {
      busy = true;
      ptr.classList.add('loading');
      set(READY);
      location.reload();
    } else set(0);
  };
  addEventListener('touchend', end);
  addEventListener('touchcancel', end);
  // Ao voltar atrás para esta página, o indicador não fica preso.
  addEventListener('pageshow', () => { busy = false; ptr.classList.remove('loading'); set(0); });
}

// Roda dentada do menu: abre as definições numa janela por cima da página (a roda gira ao abrir).
const settings = document.querySelector('.settings-sheet');
const gear = document.querySelector('.dock a[data-settings]');
if (settings && gear) {
  gear.addEventListener('click', (e) => {
    e.preventDefault();
    gear.classList.remove('spin'); void gear.offsetWidth; gear.classList.add('spin');
    settings.showModal();
  });
  settings.querySelector('[data-close]').addEventListener('click', () => settings.close());
  settings.addEventListener('click', (e) => { if (e.target === settings) settings.close(); });
}

// Tema: muda logo e guarda em segundo plano. Língua: guarda e recarrega a página já traduzida.
for (const form of document.querySelectorAll('.prefs-form')) {
  form.addEventListener('change', async (e) => {
    const { name, value } = e.target;
    if (name === 'theme') {
      document.documentElement.dataset.theme = value;
      document.querySelectorAll(`.prefs-form input[name=theme][value="${value}"]`).forEach((i) => { i.checked = true; });
    }
    try {
      await fetch('/preferencias', { method: 'POST', headers: { accept: 'application/json', 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ [name]: value }) });
    } catch {}
    if (name === 'lang') location.reload();
  });
}
}
