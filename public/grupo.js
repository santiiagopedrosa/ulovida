// Grupos: filtrar pessoas, contar quantas estão escolhidas e abrir os detalhes do grupo.
{
  for (const box of document.querySelectorAll('.invites')) {
    const filter = box.querySelector('.invite-filter');
    filter?.addEventListener('input', () => {
      const q = filter.value.trim().toLowerCase();
      for (const el of box.querySelectorAll('.invite')) el.hidden = q && !el.dataset.name.includes(q);
    });
  }
  const picked = document.getElementById('picked');
  if (picked) {
    const count = () => {
      const n = document.querySelectorAll('#members input[type=checkbox]:checked').length;
      picked.textContent = n ? `${n} ${n === 1 ? 'escolhida' : 'escolhidas'}` : '';
    };
    document.getElementById('members').addEventListener('change', count);
    count();
  }
  const sheet = document.querySelector('.group-sheet');
  if (sheet) {
    document.querySelector('.group-open').addEventListener('click', () => sheet.showModal());
    sheet.querySelector('[data-close]').addEventListener('click', () => sheet.close());
    // Fecha ao tocar fora da janela.
    sheet.addEventListener('click', (e) => { if (e.target === sheet) sheet.close(); });
  }
}
