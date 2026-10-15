// Face ID / impressão digital (passkeys). Os botões só aparecem se o aparelho tiver um leitor biométrico.
{
  const W = window.SimpleWebAuthnBrowser;
  const ua = navigator.userAgent;
  const iPad = /Macintosh/.test(ua) && navigator.maxTouchPoints > 1;
  const label = /iPhone/.test(ua) || iPad ? 'Face ID' : /Android/.test(ua) ? 'impressão digital'
    : /Macintosh/.test(ua) ? 'Touch ID' : /Windows/.test(ua) ? 'Windows Hello' : 'biometria';
  document.querySelectorAll('[data-bio-label]').forEach((el) => { el.textContent = label; });

  const showError = (from, msg) => {
    const el = from.closest('[data-bio]')?.querySelector('[data-bio-error]');
    if (el) { el.textContent = msg; el.hidden = !msg; }
  };
  // Cancelar no telemóvel não é erro: não se mostra nada.
  const cancelled = (err) => err?.name === 'NotAllowedError' || err?.name === 'AbortError';
  const getJson = async (url) => { const r = await fetch(url, { headers: { accept: 'application/json' } }); if (!r.ok) throw new Error(); return r.json(); };
  const postJson = async (url, body) => {
    const r = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json' }, body: JSON.stringify(body) });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) throw Object.assign(new Error(data.error || 'Não foi possível. Tenta outra vez.'), { server: true });
    return data;
  };
  // As opções são pedidas antes do toque: o Safari do iPhone só abre o Face ID se for logo a seguir ao toque.
  const prefetch = (url) => { let p = getJson(url); p.catch(() => {}); return { get: () => p, again: () => { p = getJson(url); p.catch(() => {}); } }; };

  (async () => {
    const ok = W?.browserSupportsWebAuthn() && await W.platformAuthenticatorIsAvailable().catch(() => false);
    if (!ok) { document.querySelectorAll('[data-bio-unsupported]').forEach((el) => { el.hidden = false; }); return; }
    const offer = document.querySelector('[data-bio-offer]');
    let dismissed = false;
    try { dismissed = localStorage.getItem('bio-dismissed') === '1'; } catch {}
    document.querySelectorAll('[data-bio]').forEach((el) => { el.hidden = el === offer && dismissed; });

    const login = document.querySelector('[data-bio-login]');
    if (login) {
      const opts = prefetch('/biometria/entrar/opcoes');
      login.addEventListener('click', async () => {
        showError(login, '');
        login.disabled = true;
        try {
          const optionsJSON = await opts.get();
          const answer = await W.startAuthentication({ optionsJSON });
          const { redirect } = await postJson('/biometria/entrar', answer);
          location.href = redirect;
        } catch (err) {
          if (!cancelled(err)) showError(login, err.server ? err.message : `Não foi possível usar o ${label}. Entra com a password.`);
          login.disabled = false;
          opts.again();
        }
      });
    }

    const registers = document.querySelectorAll('[data-bio-register]');
    if (registers.length) {
      const opts = prefetch('/biometria/registo/opcoes');
      for (const btn of registers) {
        btn.addEventListener('click', async () => {
          showError(btn, '');
          btn.disabled = true;
          try {
            const optionsJSON = await opts.get();
            const answer = await W.startRegistration({ optionsJSON });
            await postJson('/biometria/registo', answer);
            if (btn.closest('[data-bio-offer]')) {
              btn.closest('[data-bio-offer]').innerHTML = `<span class="bio-offer-icon">✓</span><span class="bio-offer-text"><strong>${label} ativado</strong><span class="muted small">Da próxima vez entra só com o ${label}.</span></span>`;
            } else location.reload();
          } catch (err) {
            if (!cancelled(err)) showError(btn, err.server ? err.message : err.name === 'InvalidStateError' ? 'Este aparelho já está ativado.' : `Não foi possível ativar o ${label}.`);
            btn.disabled = false;
            opts.again();
          }
        });
      }
    }

    document.querySelector('[data-bio-dismiss]')?.addEventListener('click', () => {
      try { localStorage.setItem('bio-dismissed', '1'); } catch {}
      offer.hidden = true;
    });
  })();
}
