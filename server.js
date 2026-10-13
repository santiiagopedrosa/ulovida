import express from 'express';
import crypto from 'node:crypto';
import path from 'node:path';
import multer from 'multer';
import sharp from 'sharp';
import { db } from './db.js';
import { sendVerificationEmail } from './mail.js';

const app = express();
const PORT = Number(process.env.PORT || 3000);
// Na Vercel, sem APP_URL definido, usa o endereço de produção que a própria Vercel fornece.
const VERCEL_URL = process.env.VERCEL_PROJECT_PRODUCTION_URL && `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`;
const APP_URL = (process.env.APP_URL || VERCEL_URL || `http://localhost:${PORT}`).replace(/\/$/, '');
const ADMIN_EMAIL = (process.env.ADMIN_EMAIL || '').trim().toLowerCase();
const EMAIL_RE = /^[a-z0-9._%+-]+@ulo\.pt$/;
const TOKEN_TTL_MS = 60 * 60 * 1000;
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

export const PRAXE = { caloiro: 'Caloiro/a', praxista: 'Praxista', veterano: 'Veterano/a', nao: 'Não faço praxe' };
export const RELACAO = { solteiro: 'Solteiro/a', namorar: 'A namorar', complicado: 'É complicado' };
const ANOS = ['1º ano', '2º ano', '3º ano', '4º ano', '5º ano', 'Mestrado', 'Doutoramento'];
const TIPOS = { convivio: 'Convívio', pre: 'Pré' };

// O admin é sempre e só o email definido em ADMIN_EMAIL.
if (ADMIN_EMAIL) await db.run('UPDATE users SET is_admin = (email = ?)', ADMIN_EMAIL);

// ---------- helpers ----------
const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');
const newToken = () => crypto.randomBytes(32).toString('base64url');
const str = (v, max) => String(v ?? '').trim().slice(0, max);

function hashPassword(pw) {
  const salt = crypto.randomBytes(16);
  return `${salt.toString('hex')}:${crypto.scryptSync(pw, salt, 64).toString('hex')}`;
}
function verifyPassword(pw, stored) {
  const [salt, hash] = stored.split(':');
  const calc = crypto.scryptSync(pw, Buffer.from(salt, 'hex'), 64);
  return crypto.timingSafeEqual(calc, Buffer.from(hash, 'hex'));
}
function getCookie(req, name) {
  for (const part of (req.headers.cookie || '').split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === name) return decodeURIComponent(v.join('='));
  }
}
// Hora de Portugal em "YYYY-MM-DDTHH:MM" (na Vercel o servidor está em UTC).
function nowLocal() {
  return new Date().toLocaleString('sv-SE', { timeZone: 'Europe/Lisbon' }).replace(' ', 'T').slice(0, 16);
}
const dateFmt = new Intl.DateTimeFormat('pt-PT', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
const fmtDate = (s) => dateFmt.format(new Date(s));
// Partes da data para o bloco de data dos eventos.
const fmtParts = (s) => {
  const d = new Date(s);
  const f = (o) => new Intl.DateTimeFormat('pt-PT', o).format(d).replace('.', '');
  return { day: f({ day: 'numeric' }), month: f({ month: 'short' }), weekday: f({ weekday: 'short' }).slice(0, 3), time: f({ hour: '2-digit', minute: '2-digit' }) };
};

async function startSession(res, userId) {
  const token = newToken();
  await db.run('INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)', sha(token), userId, Date.now() + SESSION_TTL_MS);
  res.cookie('sid', token, { httpOnly: true, sameSite: 'lax', secure: APP_URL.startsWith('https'), maxAge: SESSION_TTL_MS });
}

// Limite simples: 1 email por endereço a cada 60s, 100 por IP por hora (o Wi-Fi do campus partilha IP).
const lastSendByEmail = new Map();
const sendsByIp = new Map();
function canSend(email, ip) {
  const now = Date.now();
  if (now - (lastSendByEmail.get(email) || 0) < 60_000) return false;
  const recent = (sendsByIp.get(ip) || []).filter((t) => now - t < 3_600_000);
  if (recent.length >= 100) return false;
  lastSendByEmail.set(email, now);
  sendsByIp.set(ip, [...recent, now]);
  return true;
}

// ---------- app setup ----------
if (process.env.TRUST_PROXY) app.set('trust proxy', 1);
app.set('view engine', 'ejs');
app.set('views', path.join(import.meta.dirname, 'views'));
app.use(express.static(path.join(import.meta.dirname, 'public')));
app.use(express.urlencoded({ extended: false, limit: '20kb' }));

// Proteção CSRF: rejeita POSTs vindos de outros sites.
app.use((req, res, next) => {
  if (req.method !== 'POST') return next();
  const origin = req.get('origin');
  if (!origin) return next();
  try {
    if (new URL(origin).host === req.get('host')) return next();
  } catch {}
  res.status(403).send('Pedido bloqueado.');
});

// Limpeza de sessões e tokens expirados, no máximo uma vez por hora (na Vercel não há processo sempre ligado).
let lastCleanup = 0;
app.use(async (req, res, next) => {
  if (Date.now() - lastCleanup > 3_600_000) {
    lastCleanup = Date.now();
    await db.run('DELETE FROM sessions WHERE expires_at < ?', Date.now());
    await db.run('DELETE FROM email_tokens WHERE expires_at < ?', Date.now());
  }
  next();
});

app.use(async (req, res, next) => {
  const token = getCookie(req, 'sid');
  req.me = token
    ? await db.get(`SELECT u.* FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ? AND s.expires_at > ?`, sha(token), Date.now())
    : undefined;
  Object.assign(res.locals, {
    me: req.me,
    pendingCount: req.me?.is_admin ? (await db.get(`SELECT COUNT(*) AS n FROM events WHERE status = 'pending'`)).n : 0,
    PRAXE, RELACAO, ANOS, TIPOS, fmtDate, fmtParts,
    path: req.path,
    error: null,
  });
  next();
});

const requireAuth = (req, res, next) => (req.me ? next() : res.redirect('/entrar'));
// ---------- fotos ----------
// Até 4 MB por pedido (a Vercel recusa corpos acima de 4,5 MB); o browser já reduz a foto antes de enviar.
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 4 * 1024 * 1024, files: 1 } });
const photoUpload = (req, res, next) =>
  upload.single('photo')(req, res, (err) => {
    if (err) req.uploadError = err.code === 'LIMIT_FILE_SIZE' ? 'A foto é demasiado grande (máximo 4 MB).' : 'Não foi possível receber a foto.';
    next();
  });

// Reduz, roda segundo o EXIF e converte para WebP (o que também apaga metadados como a localização GPS).
async function saveImage(file, kind) {
  const img = sharp(file.buffer).rotate();
  const sized = kind === 'avatar'
    ? img.resize(400, 400, { fit: 'cover' })
    : img.resize(1600, 1600, { fit: 'inside', withoutEnlargement: true });
  const data = await sized.webp({ quality: 80 }).toBuffer();
  const { lastInsertRowid } = await db.run('INSERT INTO images (data, mime) VALUES (?, ?)', data, 'image/webp');
  return lastInsertRowid;
}
const deleteImage = (id) => id && db.run('DELETE FROM images WHERE id = ?', id);

const requireAdmin = (req, res, next) => (req.me?.is_admin ? next() : res.status(403).render('message', { title: 'Sem acesso', heading: 'Sem acesso', text: 'Esta página é só para o administrador.' }));

// ---------- público: registo e login ----------
app.get('/', (req, res) => (req.me ? res.redirect('/eventos') : res.render('home', { title: 'Bem-vindo' })));

app.get('/registar', (req, res) => res.render('registar', { title: 'Registar', email: '' }));

app.post('/registar', async (req, res) => {
  const email = str(req.body.email, 120).toLowerCase();
  if (!EMAIL_RE.test(email)) {
    return res.status(400).render('registar', { title: 'Registar', email, error: 'Só são aceites emails institucionais @ulo.pt.' });
  }
  if (!canSend(email, req.ip)) {
    return res.status(429).render('registar', { title: 'Registar', email, error: 'Espera um minuto antes de pedir outro email.' });
  }
  // Mesma resposta exista ou não conta, para não revelar quem está registado.
  if (!await db.get('SELECT 1 FROM users WHERE email = ?', email)) {
    const token = newToken();
    await db.run('INSERT INTO email_tokens (token_hash, email, expires_at) VALUES (?, ?, ?)', sha(token), email, Date.now() + TOKEN_TTL_MS);
    await sendVerificationEmail(email, `${APP_URL}/verificar?token=${token}`);
  }
  res.render('message', {
    title: 'Verifica o teu email',
    heading: 'Verifica o teu email',
    text: `Se ${email} ainda não tem conta, enviámos um link de confirmação. O link é válido durante 1 hora — vê também o spam.`,
  });
});

async function findValidToken(token) {
  if (!token) return;
  return db.get('SELECT * FROM email_tokens WHERE token_hash = ? AND used = 0 AND expires_at > ?', sha(String(token)), Date.now());
}
const invalidLink = { title: 'Link inválido', heading: 'Link inválido ou expirado', text: 'Pede um novo link na página de registo.', link: { href: '/registar', label: 'Voltar ao registo' } };

app.get('/verificar', async (req, res) => {
  const t = await findValidToken(req.query.token);
  if (!t) return res.status(400).render('message', invalidLink);
  res.render('completar', { title: 'Criar conta', token: req.query.token, email: t.email, form: {} });
});

app.post('/verificar', async (req, res) => {
  const t = await findValidToken(req.body.token);
  if (!t) return res.status(400).render('message', invalidLink);
  const form = { name: str(req.body.name, 60), course: str(req.body.course, 80), year: str(req.body.year, 20) };
  const password = String(req.body.password || '');
  const fail = (error) => res.status(400).render('completar', { title: 'Criar conta', token: req.body.token, email: t.email, form, error });
  if (form.name.length < 2) return fail('Escreve o teu nome.');
  if (!form.course) return fail('Indica o teu curso.');
  if (!ANOS.includes(form.year)) return fail('Escolhe o teu ano.');
  if (password.length < 8) return fail('A password tem de ter pelo menos 8 caracteres.');
  if (await db.get('SELECT 1 FROM users WHERE email = ?', t.email)) return fail('Este email já tem conta. Faz login.');

  await db.run('UPDATE email_tokens SET used = 1 WHERE token_hash = ?', t.token_hash);
  const { lastInsertRowid } = await db.run('INSERT INTO users (email, name, password_hash, course, year, is_admin) VALUES (?, ?, ?, ?, ?, ?)',
    t.email, form.name, hashPassword(password), form.course, form.year, t.email === ADMIN_EMAIL ? 1 : 0);
  await startSession(res, lastInsertRowid);
  res.redirect('/perfil/editar?novo=1');
});

app.get('/entrar', (req, res) => res.render('entrar', { title: 'Entrar', email: '' }));

app.post('/entrar', async (req, res) => {
  const email = str(req.body.email, 120).toLowerCase();
  const user = await db.get('SELECT * FROM users WHERE email = ?', email);
  if (!user || !verifyPassword(String(req.body.password || ''), user.password_hash)) {
    return res.status(400).render('entrar', { title: 'Entrar', email, error: 'Email ou password errados.' });
  }
  await startSession(res, user.id);
  res.redirect('/eventos');
});

app.post('/sair', async (req, res) => {
  const token = getCookie(req, 'sid');
  if (token) await db.run('DELETE FROM sessions WHERE token_hash = ?', sha(token));
  res.clearCookie('sid');
  res.redirect('/');
});

// ---------- pessoas e perfis ----------
// As fotos só são visíveis para quem tem sessão; o id nunca muda de conteúdo, por isso pode ficar em cache.
app.get('/img/:id', requireAuth, async (req, res) => {
  const img = await db.get('SELECT data, mime FROM images WHERE id = ?', req.params.id);
  if (!img) return res.status(404).end();
  res.set({ 'Content-Type': img.mime, 'Cache-Control': 'private, max-age=31536000, immutable' });
  res.send(Buffer.from(img.data));
});

app.get('/pessoas', requireAuth, async (req, res) => {
  const q = str(req.query.q, 60);
  const like = `%${q}%`;
  const people = await db.all(`SELECT id, name, course, year, praxe, relationship, photo_id FROM users
              WHERE name LIKE ? OR course LIKE ? ORDER BY name COLLATE NOCASE`, like, like);
  res.render('pessoas', { title: 'Pessoas', people, q });
});

app.get('/u/:id', requireAuth, async (req, res) => {
  const user = await db.get('SELECT * FROM users WHERE id = ?', req.params.id);
  if (!user) return res.status(404).render('message', { title: 'Não encontrado', heading: 'Perfil não encontrado', text: '' });
  const today = nowLocal().slice(0, 10);
  const going = await db.all(`SELECT e.* FROM events e JOIN event_attendees a ON a.event_id = e.id
              WHERE a.user_id = ? AND e.status = 'approved' AND e.starts_at >= ? ORDER BY e.starts_at`, user.id, today);
  const created = await db.all(`SELECT * FROM events WHERE creator_id = ? AND status = 'approved' ORDER BY starts_at DESC LIMIT 10`, user.id);
  res.render('perfil', { title: user.name, user, going, created });
});

app.get('/perfil/editar', requireAuth, (req, res) => {
  res.render('editar-perfil', { title: 'Editar perfil', form: req.me, novo: req.query.novo === '1' });
});

app.post('/perfil/editar', requireAuth, photoUpload, async (req, res) => {
  const form = {
    name: str(req.body.name, 60),
    course: str(req.body.course, 80),
    year: str(req.body.year, 20),
    bio: str(req.body.bio, 500),
    praxe: str(req.body.praxe, 20),
    relationship: str(req.body.relationship, 20),
    instagram: str(req.body.instagram, 31).replace(/^@/, ''),
    photo_id: req.me.photo_id,
  };
  const fail = (error) => res.status(400).render('editar-perfil', { title: 'Editar perfil', form, novo: false, error });
  if (form.name.length < 2) return fail('Escreve o teu nome.');
  if (!ANOS.includes(form.year)) return fail('Escolhe o teu ano.');
  if (form.praxe && !PRAXE[form.praxe]) return fail('Opção de praxe inválida.');
  if (form.relationship && !RELACAO[form.relationship]) return fail('Opção de relação inválida.');
  if (form.instagram && !/^[A-Za-z0-9._]{1,30}$/.test(form.instagram)) return fail('Instagram inválido.');
  if (req.uploadError) return fail(req.uploadError);

  let photoId = req.body.remove_photo === '1' ? null : req.me.photo_id;
  if (req.file) {
    try { photoId = await saveImage(req.file, 'avatar'); } catch { return fail('Esse ficheiro não é uma imagem válida.'); }
  }
  await db.run(`UPDATE users SET name = ?, course = ?, year = ?, bio = ?, praxe = ?, relationship = ?, instagram = ?, photo_id = ? WHERE id = ?`,
    form.name, form.course, form.year, form.bio, form.praxe, form.relationship, form.instagram, photoId, req.me.id);
  if (photoId !== req.me.photo_id) await deleteImage(req.me.photo_id);
  res.redirect(`/u/${req.me.id}`);
});

// ---------- eventos ----------
app.get('/eventos', requireAuth, async (req, res) => {
  const tipo = TIPOS[req.query.tipo] ? req.query.tipo : '';
  const events = await db.all(`SELECT e.*, u.name AS creator_name,
                (SELECT COUNT(*) FROM event_attendees a WHERE a.event_id = e.id) AS going,
                EXISTS (SELECT 1 FROM event_attendees a WHERE a.event_id = e.id AND a.user_id = ?) AS im_going
              FROM events e JOIN users u ON u.id = e.creator_id
              WHERE e.status = 'approved' AND e.starts_at >= ? AND (? = '' OR e.type = ?)
              ORDER BY e.starts_at`, req.me.id, nowLocal().slice(0, 10), tipo, tipo);
  await Promise.all(events.map(async (e) => {
    e.attendees = await db.all(`SELECT u.id, u.name, u.photo_id FROM event_attendees a JOIN users u ON u.id = a.user_id WHERE a.event_id = ? LIMIT 8`, e.id);
  }));
  const mine = await db.all(`SELECT * FROM events WHERE creator_id = ? AND status != 'approved' ORDER BY created_at DESC LIMIT 10`, req.me.id);
  res.render('eventos', { title: 'Eventos', events, mine, tipo, created: req.query.criado === '1' });
});

app.get('/eventos/novo', requireAuth, (req, res) => {
  res.render('evento-novo', { title: 'Novo evento', form: { type: req.query.tipo === 'pre' ? 'pre' : 'convivio' }, min: nowLocal() });
});

app.post('/eventos/novo', requireAuth, photoUpload, async (req, res) => {
  const form = {
    type: str(req.body.type, 10),
    title: str(req.body.title, 80),
    description: str(req.body.description, 1000),
    location: str(req.body.location, 120),
    starts_at: str(req.body.starts_at, 16),
  };
  const fail = (error) => res.status(400).render('evento-novo', { title: 'Novo evento', form, min: nowLocal(), error });
  if (!TIPOS[form.type]) return fail('Escolhe o tipo de evento.');
  if (form.title.length < 3) return fail('Dá um nome ao evento.');
  if (!form.location) return fail('Indica o local.');
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(form.starts_at) || isNaN(new Date(form.starts_at))) return fail('Data inválida.');
  if (form.starts_at < nowLocal()) return fail('A data tem de ser no futuro.');
  if (req.uploadError) return fail(req.uploadError);

  let photoId = null;
  if (req.file) {
    try { photoId = await saveImage(req.file, 'event'); } catch { return fail('Esse ficheiro não é uma imagem válida.'); }
  }
  // Eventos criados pelo admin ficam logo aprovados; os restantes esperam aprovação.
  await db.run(`INSERT INTO events (creator_id, type, title, description, location, starts_at, status, photo_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    req.me.id, form.type, form.title, form.description, form.location, form.starts_at, req.me.is_admin ? 'approved' : 'pending', photoId);
  res.redirect(req.me.is_admin ? '/eventos' : '/eventos?criado=1');
});

app.post('/eventos/:id/vou', requireAuth, async (req, res) => {
  const ev = await db.get(`SELECT id FROM events WHERE id = ? AND status = 'approved'`, req.params.id);
  if (ev) {
    const del = await db.run('DELETE FROM event_attendees WHERE event_id = ? AND user_id = ?', ev.id, req.me.id);
    if (!del.changes) await db.run('INSERT INTO event_attendees (event_id, user_id) VALUES (?, ?)', ev.id, req.me.id);
  }
  res.redirect(`/eventos#e${req.params.id}`);
});

app.post('/eventos/:id/cancelar', requireAuth, async (req, res) => {
  const ev = await db.get(`SELECT photo_id FROM events WHERE id = ? AND creator_id = ? AND status = 'pending'`, req.params.id, req.me.id);
  if (ev) {
    await db.run('DELETE FROM events WHERE id = ?', req.params.id);
    await deleteImage(ev.photo_id);
  }
  res.redirect('/eventos');
});

// ---------- admin ----------
app.get('/admin', requireAuth, requireAdmin, async (req, res) => {
  const q = (status, order) =>
    db.all(`SELECT e.*, u.name AS creator_name, u.email AS creator_email FROM events e JOIN users u ON u.id = e.creator_id
                WHERE e.status = ? ORDER BY ${order} LIMIT 30`, status);
  res.render('admin', {
    title: 'Admin',
    pending: await q('pending', 'e.starts_at'),
    recent: await q('approved', 'e.starts_at DESC'),
    userCount: (await db.get('SELECT COUNT(*) AS n FROM users')).n,
  });
});

app.post('/admin/eventos/:id/:acao', requireAuth, requireAdmin, async (req, res) => {
  const status = { aprovar: 'approved', rejeitar: 'rejected' }[req.params.acao];
  if (status) await db.run('UPDATE events SET status = ? WHERE id = ?', status, req.params.id);
  res.redirect('/admin');
});

app.use((req, res) => res.status(404).render('message', { title: 'Não encontrado', heading: 'Página não encontrada', text: '' }));

// Na Vercel a app é exportada; em local arranca o servidor.
export default app;

if (!process.env.VERCEL) {
  app.listen(PORT, () => {
    console.log(`ULO Vida a correr em ${APP_URL}`);
    if (!ADMIN_EMAIL) console.warn('Aviso: ADMIN_EMAIL não definido — ninguém pode aprovar eventos.');
  });
}
