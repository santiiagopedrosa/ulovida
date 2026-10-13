import { createClient } from '@libsql/client';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

// Com TURSO_DATABASE_URL usa a BD na cloud (Turso); sem ela, usa o ficheiro data.sqlite local.
const remote = Boolean(process.env.TURSO_DATABASE_URL);
const client = createClient({
  url: process.env.TURSO_DATABASE_URL || pathToFileURL(process.env.DB_PATH || path.join(import.meta.dirname, 'data.sqlite')).href,
  authToken: process.env.TURSO_AUTH_TOKEN,
});

// Mesma forma que a API antiga (get/all/run), mas assíncrona.
const toObj = (row) => ({ ...row });
export const db = {
  get: async (sql, ...args) => {
    const { rows } = await client.execute({ sql, args });
    return rows[0] && toObj(rows[0]);
  },
  all: async (sql, ...args) => (await client.execute({ sql, args })).rows.map(toObj),
  run: async (sql, ...args) => {
    const r = await client.execute({ sql, args });
    return { changes: r.rowsAffected, lastInsertRowid: Number(r.lastInsertRowid) };
  },
};

if (!remote) await client.executeMultiple('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');

await client.executeMultiple(`

  CREATE TABLE IF NOT EXISTS users (
    id            INTEGER PRIMARY KEY,
    email         TEXT NOT NULL UNIQUE,
    name          TEXT NOT NULL,
    password_hash TEXT NOT NULL,
    course        TEXT NOT NULL DEFAULT '',
    year          TEXT NOT NULL DEFAULT '',
    bio           TEXT NOT NULL DEFAULT '',
    praxe         TEXT NOT NULL DEFAULT '',
    relationship  TEXT NOT NULL DEFAULT '',
    instagram     TEXT NOT NULL DEFAULT '',
    is_admin      INTEGER NOT NULL DEFAULT 0,
    created_at    TEXT NOT NULL DEFAULT (datetime('now'))
  );

  -- Tokens guardados como hash SHA-256: uma fuga da BD não expõe links válidos.
  CREATE TABLE IF NOT EXISTS email_tokens (
    token_hash TEXT PRIMARY KEY,
    email      TEXT NOT NULL,
    expires_at INTEGER NOT NULL,
    used       INTEGER NOT NULL DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS sessions (
    token_hash TEXT PRIMARY KEY,
    user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expires_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS events (
    id          INTEGER PRIMARY KEY,
    creator_id  INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    type        TEXT NOT NULL CHECK (type IN ('convivio', 'pre')),
    title       TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    location    TEXT NOT NULL,
    starts_at   TEXT NOT NULL,
    status      TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
    created_at  TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS event_attendees (
    event_id INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
    user_id  INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    PRIMARY KEY (event_id, user_id)
  );

  -- Fotos já reduzidas (WebP), guardadas na própria BD para funcionar igual em local e na Vercel.
  CREATE TABLE IF NOT EXISTS images (
    id         INTEGER PRIMARY KEY,
    data       BLOB NOT NULL,
    mime       TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS follows (
    follower_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    followee_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at  INTEGER NOT NULL,
    PRIMARY KEY (follower_id, followee_id)
  );
  CREATE INDEX IF NOT EXISTS follows_followee ON follows (followee_id);

  -- Stories: uma foto que desaparece ao fim de 24h.
  CREATE TABLE IF NOT EXISTS stories (
    id         INTEGER PRIMARY KEY,
    user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    image_id   INTEGER NOT NULL REFERENCES images(id),
    created_at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS stories_user ON stories (user_id, expires_at);
  CREATE TABLE IF NOT EXISTS story_views (
    story_id INTEGER NOT NULL REFERENCES stories(id) ON DELETE CASCADE,
    user_id  INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    PRIMARY KEY (story_id, user_id)
  );

  CREATE TABLE IF NOT EXISTS messages (
    id           INTEGER PRIMARY KEY,
    sender_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    recipient_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    body         TEXT NOT NULL,
    created_at   INTEGER NOT NULL,
    read_at      INTEGER
  );
  CREATE INDEX IF NOT EXISTS messages_pair ON messages (sender_id, recipient_id, id);
  CREATE INDEX IF NOT EXISTS messages_unread ON messages (recipient_id, read_at);

  CREATE TABLE IF NOT EXISTS story_likes (
    story_id   INTEGER NOT NULL REFERENCES stories(id) ON DELETE CASCADE,
    user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at INTEGER NOT NULL,
    PRIMARY KEY (story_id, user_id)
  );

  -- "Bocas": publicações curtas de texto (até 280 caracteres).
  CREATE TABLE IF NOT EXISTS posts (
    id         INTEGER PRIMARY KEY,
    user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    body       TEXT NOT NULL,
    created_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS posts_recent ON posts (id DESC);
  CREATE TABLE IF NOT EXISTS post_likes (
    post_id    INTEGER NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
    user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at INTEGER NOT NULL,
    PRIMARY KEY (post_id, user_id)
  );

  -- Comentários em bocas ('post') e em eventos ('event').
  CREATE TABLE IF NOT EXISTS comments (
    id          INTEGER PRIMARY KEY,
    user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    target_type TEXT NOT NULL CHECK (target_type IN ('post', 'event')),
    target_id   INTEGER NOT NULL,
    body        TEXT NOT NULL,
    created_at  INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS comments_target ON comments (target_type, target_id, id);

  -- Convidados de eventos privados com visibilidade "selected".
  CREATE TABLE IF NOT EXISTS event_invites (
    event_id INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
    user_id  INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    PRIMARY KEY (event_id, user_id)
  );
`);

// Colunas acrescentadas depois da primeira versão: adiciona-as se a BD ainda não as tiver.
const migrations = [
  ['users', 'photo_id', 'INTEGER REFERENCES images(id) ON DELETE SET NULL'],
  ['events', 'photo_id', 'INTEGER REFERENCES images(id) ON DELETE SET NULL'],
  // 1 quando quem pediu o evento fechou o aviso de "Rejeitado".
  ['events', 'dismissed', 'INTEGER NOT NULL DEFAULT 0'],
  // Códigos de 6 dígitos enviados por email (hash) e tentativas falhadas.
  ['email_tokens', 'code_hash', 'TEXT'],
  ['email_tokens', 'attempts', 'INTEGER NOT NULL DEFAULT 0'],
  ['users', 'school', "TEXT NOT NULL DEFAULT ''"],
  // 'public' (precisa de aprovação), 'mutual' (seguidores mútuos) ou 'selected' (convidados).
  ['events', 'visibility', "TEXT NOT NULL DEFAULT 'public'"],
  // Música da story (pré-visualização de 30 s da Apple Music).
  ['stories', 'music_title', 'TEXT'],
  ['stories', 'music_artist', 'TEXT'],
  ['stories', 'music_preview', 'TEXT'],
  ['stories', 'music_artwork', 'TEXT'],
  ['stories', 'music_url', 'TEXT'],
  // Segundo do excerto onde começa o trecho de 15 s escolhido.
  ['stories', 'music_start', 'REAL NOT NULL DEFAULT 0'],
  // Quando cada pessoa viu a story (para a lista "visto por").
  ['story_views', 'viewed_at', 'INTEGER NOT NULL DEFAULT 0'],
  // Mensagem enviada como resposta a uma story.
  ['messages', 'story_id', 'INTEGER'],
  // Imagem opcional numa boca.
  ['posts', 'image_id', 'INTEGER'],
];
for (const [table, column, type] of migrations) {
  const { rows } = await client.execute(`SELECT 1 FROM pragma_table_info('${table}') WHERE name = '${column}'`);
  if (!rows.length) await client.execute(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`);
}
