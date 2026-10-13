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
`);
