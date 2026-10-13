# ULO Vida

Rede social da universidade, só para emails `@ulo.pt`.

## Como correr

1. `cp .env.example .env` e mete o teu email em `ADMIN_EMAIL`
2. `npm install`
3. `npm start` e abre http://localhost:3000

Sem SMTP configurado, o link de verificação aparece no terminal em vez de ser enviado.

## O que tem

- **Registo**: só aceita `@ulo.pt` → email com link (válido 1h) → nome, curso, ano e password
- **Perfil**: curso, ano, praxe, estado de relação, Instagram, bio. Praxe e relação podem ficar como "prefiro não dizer"
- **Pessoas**: lista com pesquisa por nome ou curso
- **Eventos**: convívios e prés. Os eventos que os outros criam ficam pendentes até o admin aprovar em `/admin`. Toda a gente pode marcar "Vou!"
- **Admin**: aprovar, rejeitar ou remover eventos

## Base de dados

Em local usa SQLite (`data.sqlite`), criado automaticamente.

Para produção usa a [Turso](https://turso.tech) (SQLite na cloud, plano grátis), porque Render/Railway/etc. apagam o ficheiro local a cada deploy:

1. Cria conta em turso.tech e instala a CLI: `brew install tursodatabase/tap/turso` → `turso auth login`
2. `turso db create ulo-vida`
3. `turso db show ulo-vida --url` → `TURSO_DATABASE_URL`
4. `turso db tokens create ulo-vida` → `TURSO_AUTH_TOKEN`

As tabelas são criadas sozinhas no primeiro arranque. Para levar os dados locais: `turso db create ulo-vida --from-file data.sqlite`.
# ulovida
