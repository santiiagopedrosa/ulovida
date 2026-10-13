// Pequenas animações do ULOO: números a contar, cartão de membro com inclinação 3D e elementos a aparecer com o scroll.
// Num bloco próprio para as variáveis não colidirem com as dos outros scripts da página.
{
const calm = matchMedia('(prefers-reduced-motion: reduce)').matches;

// Números a contar até ao valor quando aparecem no ecrã.
const fmt = new Intl.NumberFormat('pt-PT');
function countUp(el) {
  const target = Number(el.dataset.count) || 0;
  if (calm || target === 0) { el.textContent = fmt.format(target); return; }
  const t0 = performance.now(), dur = 1300;
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
}, { rootMargin: '0px 0px -8% 0px' });

document.querySelectorAll('[data-count]').forEach((el) => { el.textContent = '0'; io.observe(el); });
if (!calm) {
  document.querySelectorAll(revealSel).forEach((el, k) => {
    if (el.getBoundingClientRect().top < innerHeight) return; // o que já se vê usa a animação de entrada
    el.style.animation = 'none';
    el.classList.add('reveal');
    el.style.setProperty('--d', `${(k % 4) * 60}ms`);
    io.observe(el);
  });
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
}
