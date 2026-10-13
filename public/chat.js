// Conversa: envia sem recarregar a página e vai buscar mensagens novas a cada 4 s.
const chat = document.querySelector('.chat');
const log = chat.querySelector('.chat-log');
const form = chat.querySelector('.chat-form');
const input = form.querySelector('textarea');
const end = document.getElementById('fim');
let last = Number(chat.dataset.last) || 0;

const scrollDown = () => end.scrollIntoView({ block: 'end' });
function add(m) {
  if (m.id <= last && log.querySelector(`[data-id="${m.id}"]`)) return;
  log.querySelector('.chat-empty')?.remove();
  const div = document.createElement('div');
  div.className = `bubble${m.mine ? ' mine' : ''}`;
  div.dataset.id = m.id;
  const text = document.createElement('span');
  text.textContent = m.body;
  const time = document.createElement('time');
  time.textContent = m.time;
  div.append(text, time);
  log.insertBefore(div, end);
  last = Math.max(last, m.id);
}
async function poll() {
  if (document.hidden) return;
  try {
    const r = await fetch(`/mensagens/${chat.dataset.other}/novas?depois=${last}`, { headers: { accept: 'application/json' } });
    if (!r.ok) return;
    const msgs = await r.json();
    if (msgs.length) { msgs.forEach(add); scrollDown(); }
  } catch {}
}
form.addEventListener('submit', async (e) => {
  e.preventDefault();
  const body = input.value.trim();
  if (!body) return;
  input.value = ''; input.style.height = '';
  try {
    const r = await fetch(form.action, {
      method: 'POST',
      headers: { accept: 'application/json', 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ body }),
    });
    if (!r.ok) throw new Error();
    add(await r.json());
    scrollDown();
  } catch {
    input.value = body;
    alert('Não foi possível enviar. Tenta outra vez.');
  }
});
// Enter envia, Shift+Enter muda de linha; a caixa cresce com o texto.
input.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); form.requestSubmit(); }
});
input.addEventListener('input', () => { input.style.height = ''; input.style.height = `${Math.min(input.scrollHeight, 140)}px`; });
scrollDown();
setInterval(poll, 4000);
document.addEventListener('visibilitychange', poll);
