// Préchargé avec `node -r tests/pg-mock.js dist/index.js` : remplace `pg.Pool` par PostgreSQL embarqué (pglite)
// pour lancer le vrai serveur sans base externe (tests de bout en bout uniquement).
const { PGlite } = require('@electric-sql/pglite');
const pg = require('pg');

const db = new PGlite();
const run = (sql, params) => (params ? db.query(sql, params) : db.exec(sql).then((r) => r[r.length - 1] ?? { rows: [] }));
const client = { query: run, release() {} };

pg.Pool = class MockPool {
  query(sql, params) { return run(sql, params); }
  async connect() { return client; }
  async end() { await db.close().catch(() => {}); }
  on() { return this; }
};
