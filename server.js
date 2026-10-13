import express from 'express';
import crypto from 'node:crypto';
import path from 'node:path';
import multer from 'multer';
import sharp from 'sharp';
import { db } from './db.js';
import { sendVerificationCode } from './mail.js';
import { SCHOOLS, COURSES } from './courses.js';

const app = express();
const PORT = Number(process.env.PORT || 3000);
// Na Vercel, sem APP_URL definido, usa o endereço de produção que a própria Vercel fornece.
const VERCEL_URL = process.env.VERCEL_PROJECT_PRODUCTION_URL && `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`;
const APP_URL = (process.env.APP_URL || VERCEL_URL || `http://localhost:${PORT}`).replace(/\/$/, '');
const ADMIN_EMAIL = (process.env.ADMIN_EMAIL || '').trim().toLowerCase();
const EMAIL_RE = /^[a-z0-9._%+-]+@ulo\.pt$/;
const TOKEN_TTL_MS = 60 * 60 * 1000;
const CODE_TTL_MS = 15 * 60 * 1000;
const CODE_MAX_ATTEMPTS = 5;
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

export const PRAXE = { caloiro: 'Caloiro/a', praxista: 'Praxista', veterano: 'Veterano/a', nao: 'Não faço praxe' };
export const RELACAO = { solteiro: 'Solteiro/a', namorar: 'A namorar', complicado: 'É complicado' };
const ANOS = ['1º ano', '2º ano', '3º ano', '4º ano', '5º ano', 'Mestrado', 'Doutoramento'];
const TIPOS = { convivio: 'Convívio', pre: 'Pré' };
const VISIBILIDADE = { public: 'Todos', mutual: 'Seguidores mútuos', selected: 'Pessoas selecionadas' };
const STORY_TTL_MS = 24 * 60 * 60 * 1000;
const validCourse = (school, course) => Boolean(SCHOOLS[school]) && Object.values(COURSES[school]).some((list) => list.includes(course));

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
function nowLocal(date = new Date()) {
  return date.toLocaleString('sv-SE', { timeZone: 'Europe/Lisbon' }).replace(' ', 'T').slice(0, 16);
}
// Os eventos de um dia continuam visíveis até às 6:00 do dia seguinte (prés e convívios acabam tarde).
const eventsCutoff = () => nowLocal(new Date(Date.now() - 6 * 3_600_000)).slice(0, 10);
const dateFmt = new Intl.DateTimeFormat('pt-PT', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
const fmtDate = (s) => dateFmt.format(new Date(s));
// Partes da data para o bloco de data dos eventos.
const fmtParts = (s) => {
  const d = new Date(s);
  const f = (o) => new Intl.DateTimeFormat('pt-PT', o).format(d).replace('.', '');
  return { day: f({ day: 'numeric' }), month: f({ month: 'short' }), weekday: f({ weekday: 'short' }).slice(0, 3), time: f({ hour: '2-digit', minute: '2-digit' }) };
};

// Condição SQL (alias "e") para os eventos que o utilizador pode ver.
// O id vem da sessão (inteiro da BD), por isso pode ir diretamente na query.
function visibleTo(meId) {
  const me = Number(meId);
  return `(e.visibility = 'public' OR e.creator_id = ${me}
    OR (e.visibility = 'mutual'
        AND EXISTS (SELECT 1 FROM follows f WHERE f.follower_id = ${me} AND f.followee_id = e.creator_id)
        AND EXISTS (SELECT 1 FROM follows f WHERE f.follower_id = e.creator_id AND f.followee_id = ${me}))
    OR (e.visibility = 'selected' AND EXISTS (SELECT 1 FROM event_invites i WHERE i.event_id = e.id AND i.user_id = ${me})))`;
}
// "agora", "há 5 min", "há 3 h", ou a data.
function timeAgo(ms) {
  const min = Math.round((Date.now() - ms) / 60_000);
  if (min < 1) return 'agora';
  if (min < 60) return `há ${min} min`;
  if (min < 24 * 60) return `há ${Math.floor(min / 60)} h`;
  return new Intl.DateTimeFormat('pt-PT', { day: 'numeric', month: 'short', timeZone: 'Europe/Lisbon' }).format(ms);
}
const timeFmt = new Intl.DateTimeFormat('pt-PT', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Lisbon' });
const fmtTime = (ms) => timeFmt.format(ms);

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
// No Express 5, um POST sem corpo deixa req.body indefinido; assim as rotas podem ler campos sem rebentar.
app.use((req, res, next) => { req.body ??= {}; next(); });

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
    const old = await db.all('SELECT id, image_id FROM stories WHERE expires_at < ?', Date.now());
    for (const st of old) {
      await db.run('DELETE FROM story_views WHERE story_id = ?', st.id);
      await db.run('DELETE FROM story_likes WHERE story_id = ?', st.id);
      await db.run('DELETE FROM stories WHERE id = ?', st.id);
      await deleteImage(st.image_id);
    }
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
    unreadCount: req.me ? (await db.get('SELECT COUNT(*) AS n FROM messages WHERE recipient_id = ? AND read_at IS NULL', req.me.id)).n : 0,
    PRAXE, RELACAO, ANOS, TIPOS, VISIBILIDADE, SCHOOLS, COURSES, fmtDate, fmtParts, timeAgo, fmtTime,
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
  const sized = kind === 'avatar' ? img.resize(400, 400, { fit: 'cover' })
    : kind === 'story' ? img.resize(1080, 1920, { fit: 'inside', withoutEnlargement: true })
    : img.resize(1600, 1600, { fit: 'inside', withoutEnlargement: true });
  const data = await sized.webp({ quality: 80 }).toBuffer();
  const { lastInsertRowid } = await db.run('INSERT INTO images (data, mime) VALUES (?, ?)', data, 'image/webp');
  return lastInsertRowid;
}
const deleteImage = (id) => id && db.run('DELETE FROM images WHERE id = ?', id);

const requireAdmin = (req, res, next) => (req.me?.is_admin ? next() : res.status(403).render('message', { title: 'Sem acesso', heading: 'Sem acesso', text: 'Esta página é só para o administrador.' }));

// ---------- público: registo e login ----------
app.get('/', (req, res) => (req.me ? res.redirect('/eventos') : res.render('home', { title: 'Bem-vindo' })));

app.get('/registar', (req, res) => res.render('registar', { title: 'Registar', email: str(req.query.email, 120) }));

app.post('/registar', async (req, res) => {
  const email = str(req.body.email, 120).toLowerCase();
  if (!EMAIL_RE.test(email)) {
    return res.status(400).render('registar', { title: 'Registar', email, error: 'Só são aceites emails institucionais @ulo.pt.' });
  }
  if (!canSend(email, req.ip)) {
    return res.status(429).render('registar', { title: 'Registar', email, error: 'Espera um minuto antes de pedir outro código.' });
  }
  // Mesma resposta exista ou não conta, para não revelar quem está registado.
  // Envia um código de 6 dígitos em vez de um link: emails sem links são menos barrados pelos filtros do Outlook.
  if (!await db.get('SELECT 1 FROM users WHERE email = ?', email)) {
    const code = String(crypto.randomInt(0, 1_000_000)).padStart(6, '0');
    await db.run('UPDATE email_tokens SET used = 1 WHERE email = ? AND code_hash IS NOT NULL', email);
    await db.run('INSERT INTO email_tokens (token_hash, email, expires_at, code_hash) VALUES (?, ?, ?, ?)',
      sha(newToken()), email, Date.now() + CODE_TTL_MS, sha(`${email}:${code}`));
    await sendVerificationCode(email, code);
  }
  res.render('codigo', { title: 'Confirma o teu email', email, code: '' });
});

app.post('/confirmar', async (req, res) => {
  const email = str(req.body.email, 120).toLowerCase();
  const code = str(req.body.code, 12).replace(/\D/g, '');
  const fail = (error) => res.status(400).render('codigo', { title: 'Confirma o teu email', email, code, error });
  const t = await db.get(`SELECT * FROM email_tokens WHERE email = ? AND code_hash IS NOT NULL AND used = 0 AND expires_at > ?
                          ORDER BY expires_at DESC LIMIT 1`, email, Date.now());
  if (!t || t.attempts >= CODE_MAX_ATTEMPTS) return fail('Este código expirou ou teve demasiadas tentativas. Pede um novo.');
  const ok = code.length === 6 && crypto.timingSafeEqual(Buffer.from(sha(`${email}:${code}`)), Buffer.from(t.code_hash));
  if (!ok) {
    await db.run('UPDATE email_tokens SET attempts = attempts + 1 WHERE token_hash = ?', t.token_hash);
    const left = CODE_MAX_ATTEMPTS - t.attempts - 1;
    return fail(left ? `Código errado. ${left === 1 ? 'Resta 1 tentativa' : `Restam ${left} tentativas`}.` : 'Código errado. Pede um novo código.');
  }
  // Código certo: troca-o por um token de uso único para o formulário de criar conta.
  await db.run('UPDATE email_tokens SET used = 1 WHERE token_hash = ?', t.token_hash);
  const token = newToken();
  await db.run('INSERT INTO email_tokens (token_hash, email, expires_at) VALUES (?, ?, ?)', sha(token), email, Date.now() + TOKEN_TTL_MS);
  res.render('completar', { title: 'Criar conta', token, email, form: {} });
});

async function findValidToken(token) {
  if (!token) return;
  return db.get('SELECT * FROM email_tokens WHERE token_hash = ? AND code_hash IS NULL AND used = 0 AND expires_at > ?', sha(String(token)), Date.now());
}
const invalidLink = { title: 'Link inválido', heading: 'Link inválido ou expirado', text: 'Pede um novo código na página de registo.', link: { href: '/registar', label: 'Voltar ao registo' } };

app.get('/verificar', async (req, res) => {
  const t = await findValidToken(req.query.token);
  if (!t) return res.status(400).render('message', invalidLink);
  res.render('completar', { title: 'Criar conta', token: req.query.token, email: t.email, form: {} });
});

app.post('/verificar', async (req, res) => {
  const t = await findValidToken(req.body.token);
  if (!t) return res.status(400).render('message', invalidLink);
  const form = { name: str(req.body.name, 60), school: str(req.body.school, 20), course: str(req.body.course, 120), year: str(req.body.year, 20) };
  const password = String(req.body.password || '');
  const fail = (error) => res.status(400).render('completar', { title: 'Criar conta', token: req.body.token, email: t.email, form, error });
  if (form.name.length < 2) return fail('Escreve o teu nome.');
  if (!SCHOOLS[form.school]) return fail('Escolhe a tua escola.');
  if (!validCourse(form.school, form.course)) return fail('Escolhe o teu curso da lista.');
  if (!ANOS.includes(form.year)) return fail('Escolhe o teu ano.');
  if (password.length < 8) return fail('A password tem de ter pelo menos 8 caracteres.');
  if (await db.get('SELECT 1 FROM users WHERE email = ?', t.email)) return fail('Este email já tem conta. Faz login.');

  await db.run('UPDATE email_tokens SET used = 1 WHERE token_hash = ?', t.token_hash);
  const { lastInsertRowid } = await db.run('INSERT INTO users (email, name, password_hash, school, course, year, is_admin) VALUES (?, ?, ?, ?, ?, ?, ?)',
    t.email, form.name, hashPassword(password), form.school, form.course, form.year, t.email === ADMIN_EMAIL ? 1 : 0);
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
  const escola = SCHOOLS[req.query.escola] ? req.query.escola : '';
  const like = `%${q}%`;
  const people = await db.all(`SELECT id, name, school, course, year, praxe, relationship, photo_id FROM users
              WHERE (name LIKE ? OR course LIKE ?) AND (? = '' OR school = ?) ORDER BY name COLLATE NOCASE`, like, like, escola, escola);
  res.render('pessoas', { title: 'Pessoas', people, q, escola });
});

app.get('/u/:id', requireAuth, async (req, res) => {
  const user = await db.get('SELECT * FROM users WHERE id = ?', req.params.id);
  if (!user) return res.status(404).render('message', { title: 'Não encontrado', heading: 'Perfil não encontrado', text: '' });
  const today = eventsCutoff();
  const going = await db.all(`SELECT e.* FROM events e JOIN event_attendees a ON a.event_id = e.id
              WHERE a.user_id = ? AND e.status = 'approved' AND e.starts_at >= ? AND ${visibleTo(req.me.id)} ORDER BY e.starts_at`, user.id, today);
  const created = await db.all(`SELECT e.* FROM events e WHERE e.creator_id = ? AND e.status = 'approved' AND ${visibleTo(req.me.id)}
              ORDER BY e.starts_at DESC LIMIT 10`, user.id);
  const count = async (sql) => (await db.get(sql, user.id)).n;
  const iFollow = Boolean(await db.get('SELECT 1 FROM follows WHERE follower_id = ? AND followee_id = ?', req.me.id, user.id));
  const followsMe = Boolean(await db.get('SELECT 1 FROM follows WHERE follower_id = ? AND followee_id = ?', user.id, req.me.id));
  const canSeeStories = iFollow || user.id === req.me.id;
  const hasStory = canSeeStories && Boolean(await db.get('SELECT 1 FROM stories WHERE user_id = ? AND expires_at > ?', user.id, Date.now()));
  res.render('perfil', {
    title: user.name, user, going, created, iFollow, followsMe, hasStory,
    followers: await count('SELECT COUNT(*) AS n FROM follows WHERE followee_id = ?'),
    following: await count('SELECT COUNT(*) AS n FROM follows WHERE follower_id = ?'),
  });
});

app.get('/perfil/editar', requireAuth, (req, res) => {
  res.render('editar-perfil', { title: 'Editar perfil', form: req.me, novo: req.query.novo === '1' });
});

app.post('/perfil/editar', requireAuth, photoUpload, async (req, res) => {
  const form = {
    name: str(req.body.name, 60),
    school: str(req.body.school, 20),
    course: str(req.body.course, 120),
    year: str(req.body.year, 20),
    bio: str(req.body.bio, 500),
    praxe: str(req.body.praxe, 20),
    relationship: str(req.body.relationship, 20),
    instagram: str(req.body.instagram, 31).replace(/^@/, ''),
    photo_id: req.me.photo_id,
  };
  const fail = (error) => res.status(400).render('editar-perfil', { title: 'Editar perfil', form, novo: false, error });
  if (form.name.length < 2) return fail('Escreve o teu nome.');
  if (!SCHOOLS[form.school]) return fail('Escolhe a tua escola.');
  if (!validCourse(form.school, form.course)) return fail('Escolhe o teu curso da lista.');
  if (!ANOS.includes(form.year)) return fail('Escolhe o teu ano.');
  if (form.praxe && !PRAXE[form.praxe]) return fail('Opção de praxe inválida.');
  if (form.relationship && !RELACAO[form.relationship]) return fail('Opção de relação inválida.');
  if (form.instagram && !/^[A-Za-z0-9._]{1,30}$/.test(form.instagram)) return fail('Instagram inválido.');
  if (req.uploadError) return fail(req.uploadError);

  let photoId = req.body.remove_photo === '1' ? null : req.me.photo_id;
  if (req.file) {
    try { photoId = await saveImage(req.file, 'avatar'); } catch { return fail('Esse ficheiro não é uma imagem válida.'); }
  }
  await db.run(`UPDATE users SET name = ?, school = ?, course = ?, year = ?, bio = ?, praxe = ?, relationship = ?, instagram = ?, photo_id = ? WHERE id = ?`,
    form.name, form.school, form.course, form.year, form.bio, form.praxe, form.relationship, form.instagram, photoId, req.me.id);
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
              WHERE e.status = 'approved' AND e.starts_at >= ? AND (? = '' OR e.type = ?) AND ${visibleTo(req.me.id)}
              ORDER BY e.starts_at`, req.me.id, eventsCutoff(), tipo, tipo);
  await Promise.all(events.map(async (e) => {
    e.attendees = await db.all(`SELECT u.id, u.name, u.photo_id FROM event_attendees a JOIN users u ON u.id = a.user_id WHERE a.event_id = ? LIMIT 8`, e.id);
  }));
  // Pedidos ainda por aprovar ou rejeitados; somem quando a data passa ou quando a pessoa fecha o aviso.
  const mine = await db.all(`SELECT * FROM events WHERE creator_id = ? AND status != 'approved' AND dismissed = 0 AND starts_at >= ?
                             ORDER BY created_at DESC LIMIT 10`, req.me.id, nowLocal());
  // Barra de stories: as minhas e as de quem eu sigo, primeiro as que ainda não vi.
  const me = Number(req.me.id);
  const stories = await db.all(`SELECT u.id, u.name, u.photo_id, MAX(s.created_at) AS last,
                                  SUM(CASE WHEN v.user_id IS NULL THEN 1 ELSE 0 END) AS unseen
                                FROM stories s JOIN users u ON u.id = s.user_id
                                LEFT JOIN story_views v ON v.story_id = s.id AND v.user_id = ${me}
                                WHERE s.expires_at > ? AND (s.user_id = ${me} OR s.user_id IN (SELECT followee_id FROM follows WHERE follower_id = ${me}))
                                GROUP BY u.id ORDER BY u.id = ${me} DESC, unseen > 0 DESC, last DESC`, Date.now());
  // Sugestões de quem seguir: primeiro do mesmo curso, depois da mesma escola, depois quem tem mais seguidores.
  const suggestions = await db.all(`SELECT u.id, u.name, u.school, u.course, u.photo_id,
      (SELECT COUNT(*) FROM follows f WHERE f.followee_id = u.id) AS followers
    FROM users u
    WHERE u.id != ${me} AND u.id NOT IN (SELECT followee_id FROM follows WHERE follower_id = ${me})
    ORDER BY (u.course = ? AND u.course != '') DESC, (u.school = ? AND u.school != '') DESC, followers DESC, u.id DESC
    LIMIT 5`, req.me.course || '', req.me.school || '');
  res.render('eventos', { title: 'Eventos', events, mine, tipo, stories, suggestions, created: req.query.criado === '1' });
});

// Pessoas que podem ser convidadas para um evento privado: quem eu sigo e quem me segue.
const connectionsOf = (meId) => db.all(`SELECT id, name, photo_id, course FROM users WHERE id != ? AND (
    id IN (SELECT followee_id FROM follows WHERE follower_id = ?) OR id IN (SELECT follower_id FROM follows WHERE followee_id = ?))
  ORDER BY name COLLATE NOCASE`, meId, meId, meId);

app.get('/eventos/novo', requireAuth, async (req, res) => {
  res.render('evento-novo', {
    title: 'Novo evento', min: nowLocal(), people: await connectionsOf(req.me.id),
    form: { type: req.query.tipo === 'pre' ? 'pre' : 'convivio', visibility: 'public', invites: [] },
  });
});

app.post('/eventos/novo', requireAuth, photoUpload, async (req, res) => {
  const form = {
    type: str(req.body.type, 10),
    title: str(req.body.title, 80),
    description: str(req.body.description, 1000),
    location: str(req.body.location, 120),
    starts_at: str(req.body.starts_at, 16),
    visibility: VISIBILIDADE[req.body.visibility] ? req.body.visibility : '',
    invites: [].concat(req.body.invites || []).map(Number).filter(Boolean),
  };
  const people = await connectionsOf(req.me.id);
  const fail = (error) => res.status(400).render('evento-novo', { title: 'Novo evento', form, min: nowLocal(), people, error });
  if (!TIPOS[form.type]) return fail('Escolhe o tipo de evento.');
  if (form.title.length < 3) return fail('Dá um nome ao evento.');
  if (!form.location) return fail('Indica o local.');
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(form.starts_at) || isNaN(new Date(form.starts_at))) return fail('Data inválida.');
  if (form.starts_at < nowLocal()) return fail('A data tem de ser no futuro.');
  if (!form.visibility) return fail('Escolhe quem pode ver o evento.');
  const allowed = new Set(people.map((p) => p.id));
  form.invites = form.invites.filter((id) => allowed.has(id));
  if (form.visibility === 'selected' && !form.invites.length) return fail('Escolhe pelo menos uma pessoa para convidar.');
  if (req.uploadError) return fail(req.uploadError);

  let photoId = null;
  if (req.file) {
    try { photoId = await saveImage(req.file, 'event'); } catch { return fail('Esse ficheiro não é uma imagem válida.'); }
  }
  // Eventos públicos precisam de aprovação (exceto os do admin); os privados ficam logo visíveis para quem tem acesso.
  const needsApproval = form.visibility === 'public' && !req.me.is_admin;
  const { lastInsertRowid: eventId } = await db.run(`INSERT INTO events (creator_id, type, title, description, location, starts_at, status, photo_id, visibility)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    req.me.id, form.type, form.title, form.description, form.location, form.starts_at, needsApproval ? 'pending' : 'approved', photoId, form.visibility);
  if (form.visibility === 'selected') {
    for (const id of form.invites) await db.run('INSERT OR IGNORE INTO event_invites (event_id, user_id) VALUES (?, ?)', eventId, id);
  }
  res.redirect(needsApproval ? '/eventos?criado=1' : `/eventos#e${eventId}`);
});

app.post('/eventos/:id/vou', requireAuth, async (req, res) => {
  const ev = await db.get(`SELECT e.id FROM events e WHERE e.id = ? AND e.status = 'approved' AND ${visibleTo(req.me.id)}`, req.params.id);
  if (ev) {
    const del = await db.run('DELETE FROM event_attendees WHERE event_id = ? AND user_id = ?', ev.id, req.me.id);
    if (!del.changes) await db.run('INSERT INTO event_attendees (event_id, user_id) VALUES (?, ?)', ev.id, req.me.id);
  }
  res.redirect(`/eventos#e${req.params.id}`);
});

app.post('/eventos/:id/fechar', requireAuth, async (req, res) => {
  await db.run(`UPDATE events SET dismissed = 1 WHERE id = ? AND creator_id = ? AND status = 'rejected'`, req.params.id, req.me.id);
  res.redirect('/eventos');
});

app.post('/eventos/:id/cancelar', requireAuth, async (req, res) => {
  const ev = await db.get(`SELECT photo_id FROM events WHERE id = ? AND creator_id = ? AND status = 'pending'`, req.params.id, req.me.id);
  if (ev) {
    await db.run('DELETE FROM event_invites WHERE event_id = ?', req.params.id);
    await db.run('DELETE FROM events WHERE id = ?', req.params.id);
    await deleteImage(ev.photo_id);
  }
  res.redirect('/eventos');
});

// ---------- seguir ----------
app.post('/u/:id/seguir', requireAuth, async (req, res) => {
  const user = await db.get('SELECT id FROM users WHERE id = ?', req.params.id);
  if (user && user.id !== req.me.id) {
    const del = await db.run('DELETE FROM follows WHERE follower_id = ? AND followee_id = ?', req.me.id, user.id);
    if (!del.changes) await db.run('INSERT INTO follows (follower_id, followee_id, created_at) VALUES (?, ?, ?)', req.me.id, user.id, Date.now());
  }
  const back = String(req.body.voltar || '');
  res.redirect(back.startsWith('/') && !back.startsWith('//') ? back : `/u/${req.params.id}`);
});

for (const [route, label, sql] of [
  ['seguidores', 'Seguidores', 'SELECT follower_id FROM follows WHERE followee_id = ?'],
  ['a-seguir', 'A seguir', 'SELECT followee_id FROM follows WHERE follower_id = ?'],
]) {
  app.get(`/u/:id/${route}`, requireAuth, async (req, res) => {
    const user = await db.get('SELECT id, name FROM users WHERE id = ?', req.params.id);
    if (!user) return res.status(404).render('message', { title: 'Não encontrado', heading: 'Perfil não encontrado', text: '' });
    const people = await db.all(`SELECT id, name, school, course, year, praxe, relationship, photo_id FROM users
                                 WHERE id IN (${sql}) ORDER BY name COLLATE NOCASE`, user.id);
    res.render('seguidores', { title: `${label} · ${user.name}`, user, people, route, label });
  });
}

// ---------- stories ----------
// Só quem segue a pessoa (ou a própria) vê as stories dela.
const canSeeStoriesOf = async (meId, userId) =>
  meId === userId || Boolean(await db.get('SELECT 1 FROM follows WHERE follower_id = ? AND followee_id = ?', meId, userId));

app.get('/stories/nova', requireAuth, (req, res) => res.render('story-nova', { title: 'Nova story' }));

// Pesquisa de músicas para as stories (API pública do iTunes; só dá excertos de 30 s).
app.get('/musica', requireAuth, async (req, res) => {
  const q = str(req.query.q, 80);
  if (q.length < 2) return res.json([]);
  try {
    const r = await fetch(`https://itunes.apple.com/search?${new URLSearchParams({ term: q, media: 'music', entity: 'song', limit: '20', country: 'PT' })}`,
      { signal: AbortSignal.timeout(6000) });
    const { results = [] } = await r.json();
    res.json(results.filter((t) => t.previewUrl).map((t) => ({
      title: t.trackName, artist: t.artistName, preview: t.previewUrl,
      artwork: (t.artworkUrl100 || '').replace('100x100bb', '200x200bb'), url: t.trackViewUrl,
    })));
  } catch {
    res.status(502).json({ error: 'Não foi possível pesquisar músicas agora.' });
  }
});

// Só aceita links da Apple (não deixa meter URLs arbitrários na story).
const appleUrl = (v, hosts) => {
  try {
    const u = new URL(String(v || ''));
    return u.protocol === 'https:' && hosts.some((h) => u.hostname === h || u.hostname.endsWith(`.${h}`)) ? u.href.slice(0, 500) : null;
  } catch { return null; }
};

app.post('/stories/nova', requireAuth, photoUpload, async (req, res) => {
  const wantsJson = (req.get('accept') || '').includes('application/json');
  const fail = (error) => (wantsJson ? res.status(400).json({ error }) : res.status(400).render('story-nova', { title: 'Nova story', error }));
  if (req.uploadError) return fail(req.uploadError);
  if (!req.file) return fail('Escolhe uma foto.');
  let imageId;
  try { imageId = await saveImage(req.file, 'story'); } catch { return fail('Esse ficheiro não é uma imagem válida.'); }
  const now = Date.now();
  const preview = appleUrl(req.body.music_preview, ['apple.com']);
  const music = preview ? [str(req.body.music_title, 120), str(req.body.music_artist, 120), preview,
    appleUrl(req.body.music_artwork, ['mzstatic.com']), appleUrl(req.body.music_url, ['apple.com']),
    Math.min(60, Math.max(0, Number(req.body.music_start) || 0))] : [null, null, null, null, null, 0];
  await db.run(`INSERT INTO stories (user_id, image_id, created_at, expires_at, music_title, music_artist, music_preview, music_artwork, music_url, music_start)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, req.me.id, imageId, now, now + STORY_TTL_MS, ...music);
  if (wantsJson) return res.json({ ok: true, redirect: '/eventos' });
  res.redirect('/eventos');
});

app.get('/stories/:userId', requireAuth, async (req, res) => {
  const user = await db.get('SELECT id, name, photo_id FROM users WHERE id = ?', req.params.userId);
  if (!user || !await canSeeStoriesOf(req.me.id, user.id)) return res.redirect('/eventos');
  const stories = await db.all(`SELECT s.*, (SELECT COUNT(*) FROM story_views v WHERE v.story_id = s.id) AS views,
                                  (SELECT COUNT(*) FROM story_likes l WHERE l.story_id = s.id) AS likes,
                                  EXISTS (SELECT 1 FROM story_likes l WHERE l.story_id = s.id AND l.user_id = ${Number(req.me.id)}) AS liked,
                                  EXISTS (SELECT 1 FROM story_views v WHERE v.story_id = s.id AND v.user_id = ?) AS seen
                                FROM stories s WHERE s.user_id = ? AND s.expires_at > ? ORDER BY s.created_at`, req.me.id, user.id, Date.now());
  if (!stories.length) return res.redirect('/eventos');
  // Começa na primeira que ainda não foi vista.
  const start = Math.max(0, stories.findIndex((st) => !st.seen));
  res.render('story', { title: `Stories · ${user.name}`, user, stories, start, mine: user.id === req.me.id });
});

app.post('/stories/:id/visto', requireAuth, async (req, res) => {
  const st = await db.get('SELECT user_id FROM stories WHERE id = ? AND expires_at > ?', req.params.id, Date.now());
  if (st && st.user_id !== req.me.id && await canSeeStoriesOf(req.me.id, st.user_id)) {
    await db.run('INSERT OR IGNORE INTO story_views (story_id, user_id, viewed_at) VALUES (?, ?, ?)', req.params.id, req.me.id, Date.now());
  }
  res.status(204).end();
});

// Story ativa que esta pessoa pode ver, mas que não é dela (para gostos e respostas).
async function othersStory(meId, storyId) {
  const st = await db.get('SELECT id, user_id FROM stories WHERE id = ? AND expires_at > ?', storyId, Date.now());
  return st && st.user_id !== meId && await canSeeStoriesOf(meId, st.user_id) ? st : null;
}

app.post('/stories/:id/gosto', requireAuth, async (req, res) => {
  const st = await othersStory(req.me.id, req.params.id);
  if (!st) return res.status(404).json({ error: 'Story não encontrada.' });
  const del = await db.run('DELETE FROM story_likes WHERE story_id = ? AND user_id = ?', st.id, req.me.id);
  if (!del.changes) await db.run('INSERT INTO story_likes (story_id, user_id, created_at) VALUES (?, ?, ?)', st.id, req.me.id, Date.now());
  res.json({ liked: !del.changes });
});

app.post('/stories/:id/responder', requireAuth, async (req, res) => {
  const st = await othersStory(req.me.id, req.params.id);
  const body = str(req.body.body, 1000);
  if (!st || !body) return res.status(400).json({ error: 'Não foi possível enviar.' });
  await db.run('INSERT INTO messages (sender_id, recipient_id, body, created_at, story_id) VALUES (?, ?, ?, ?, ?)', req.me.id, st.user_id, body, Date.now(), st.id);
  res.json({ ok: true });
});

// Lista de quem viu (só para quem publicou), com quem deu gosto.
app.get('/stories/:id/vistas', requireAuth, async (req, res) => {
  const st = await db.get('SELECT id FROM stories WHERE id = ? AND user_id = ?', req.params.id, req.me.id);
  if (!st) return res.status(404).json({ error: 'Story não encontrada.' });
  const rows = await db.all(`SELECT u.id, u.name, u.photo_id, v.viewed_at,
                               EXISTS (SELECT 1 FROM story_likes l WHERE l.story_id = v.story_id AND l.user_id = u.id) AS liked
                             FROM story_views v JOIN users u ON u.id = v.user_id
                             WHERE v.story_id = ? ORDER BY liked DESC, v.viewed_at DESC`, st.id);
  res.json(rows.map((r) => ({ id: r.id, name: r.name, photo_id: r.photo_id, liked: Boolean(r.liked), when: r.viewed_at ? timeAgo(r.viewed_at) : '' })));
});

app.post('/stories/:id/apagar', requireAuth, async (req, res) => {
  const st = await db.get('SELECT id, image_id FROM stories WHERE id = ? AND user_id = ?', req.params.id, req.me.id);
  if (st) {
    await db.run('DELETE FROM story_views WHERE story_id = ?', st.id);
    await db.run('DELETE FROM story_likes WHERE story_id = ?', st.id);
    await db.run('DELETE FROM stories WHERE id = ?', st.id);
    await deleteImage(st.image_id);
  }
  res.redirect('/eventos');
});

// ---------- mensagens ----------
function conversationsOf(meId) {
  const me = Number(meId);
  return db.all(`
    WITH c AS (
      SELECT CASE WHEN sender_id = ${me} THEN recipient_id ELSE sender_id END AS other_id, MAX(id) AS last_id
      FROM messages WHERE sender_id = ${me} OR recipient_id = ${me} GROUP BY other_id
    )
    SELECT c.other_id, u.name, u.photo_id, m.body, m.sender_id, m.created_at,
      (SELECT COUNT(*) FROM messages x WHERE x.sender_id = c.other_id AND x.recipient_id = ${me} AND x.read_at IS NULL) AS unread
    FROM c JOIN messages m ON m.id = c.last_id JOIN users u ON u.id = c.other_id
    ORDER BY c.last_id DESC LIMIT 50`);
}

app.get('/mensagens', requireAuth, async (req, res) => {
  res.render('mensagens', { title: 'Mensagens', conversations: await conversationsOf(req.me.id) });
});

// Inclui a story a que a mensagem responde (a miniatura só aparece enquanto a story existir).
const messagesBetween = (a, b, afterId = 0) => db.all(`SELECT m.id, m.sender_id, m.body, m.created_at, m.story_id, s.image_id AS story_image
  FROM messages m LEFT JOIN stories s ON s.id = m.story_id AND s.expires_at > ${Date.now()}
  WHERE ((m.sender_id = ? AND m.recipient_id = ?) OR (m.sender_id = ? AND m.recipient_id = ?)) AND m.id > ?
  ORDER BY m.id DESC LIMIT 100`, a, b, b, a, afterId).then((rows) => rows.reverse());
const markRead = (meId, otherId) =>
  db.run('UPDATE messages SET read_at = ? WHERE recipient_id = ? AND sender_id = ? AND read_at IS NULL', Date.now(), meId, otherId);
const messageJson = (m) => ({ id: m.id, mine: undefined, body: m.body, time: fmtTime(m.created_at), sender_id: m.sender_id,
  story_id: m.story_id || null, story_image: m.story_image || null });

app.get('/mensagens/:id', requireAuth, async (req, res) => {
  const other = await db.get('SELECT id, name, photo_id, course FROM users WHERE id = ?', req.params.id);
  if (!other || other.id === req.me.id) return res.redirect('/mensagens');
  const messages = await messagesBetween(req.me.id, other.id);
  await markRead(req.me.id, other.id);
  res.locals.unreadCount = (await db.get('SELECT COUNT(*) AS n FROM messages WHERE recipient_id = ? AND read_at IS NULL', req.me.id)).n;
  res.render('conversa', { title: other.name, other, messages, conversations: await conversationsOf(req.me.id) });
});

// Usado pela página da conversa para ir buscar mensagens novas a cada poucos segundos.
app.get('/mensagens/:id/novas', requireAuth, async (req, res) => {
  const otherId = Number(req.params.id);
  const messages = await messagesBetween(req.me.id, otherId, Number(req.query.depois) || 0);
  if (messages.some((m) => m.sender_id === otherId)) await markRead(req.me.id, otherId);
  res.json(messages.map((m) => ({ ...messageJson(m), mine: m.sender_id === req.me.id })));
});

app.post('/mensagens/:id', requireAuth, async (req, res) => {
  const other = await db.get('SELECT id FROM users WHERE id = ?', req.params.id);
  const body = str(req.body.body, 2000);
  const wantsJson = (req.get('accept') || '').includes('application/json');
  if (!other || other.id === req.me.id || !body) return wantsJson ? res.status(400).json({ error: 'Mensagem vazia.' }) : res.redirect(`/mensagens/${req.params.id}`);
  const now = Date.now();
  const { lastInsertRowid } = await db.run('INSERT INTO messages (sender_id, recipient_id, body, created_at) VALUES (?, ?, ?, ?)', req.me.id, other.id, body, now);
  if (wantsJson) return res.json({ ...messageJson({ id: lastInsertRowid, sender_id: req.me.id, body, created_at: now }), mine: true });
  res.redirect(`/mensagens/${other.id}#fim`);
});

// ---------- admin ----------
app.get('/admin', requireAuth, requireAdmin, async (req, res) => {
  const q = (status, order) =>
    db.all(`SELECT e.*, u.name AS creator_name, u.email AS creator_email FROM events e JOIN users u ON u.id = e.creator_id
                WHERE e.status = ? AND e.visibility = 'public' ORDER BY ${order} LIMIT 30`, status);
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
    console.log(`ULOO a correr em ${APP_URL}`);
    if (!ADMIN_EMAIL) console.warn('Aviso: ADMIN_EMAIL não definido — ninguém pode aprovar eventos.');
  });
}
