// Test de l'API des dessins : PostgreSQL réel (pglite) + routes via inject().
process.env.DATABASE_URL = 'postgres://x'; process.env.APP_PASSWORD = 'test-password'; process.env.JWT_SECRET = 'test-secret-0123456789';
const fs = require('fs'), path = require('path');
const B = path.resolve(__dirname, '..');
const { PGlite } = require('@electric-sql/pglite');

(async () => {
  const pg = new PGlite();
  await pg.exec(fs.readFileSync(path.resolve(B, '../db/schema.sql'), 'utf8'));
  const wrap = { query: (s, p) => pg.query(s, p), release() {} };
  const { pool } = require(B + '/dist/db.js');
  pool.query = wrap.query; pool.connect = async () => wrap;
  const Fastify = require(B + '/node_modules/fastify');
  const app = Fastify();
  app.setErrorHandler((e, _q, r) => r.code(e.name === 'ZodError' ? 400 : e.statusCode || 500).send({ error: e.code, message: e.message }));
  await app.register(require(B + '/dist/routes/drawings.js').drawingRoutes);

  let pass = 0, fail = 0;
  const ok = (c, l, x = '') => { (c ? pass++ : fail++); console.log(c ? 'PASS' : 'FAIL', l, x); };
  const call = async (method, url, payload) => { const r = await app.inject({ method, url, payload }); return { status: r.statusCode, json: () => JSON.parse(r.body) }; };
  const style = { color: '#2962ff', width: 2 };

  const a = (await call('POST', '/api/drawings', { symbol: 'AAPL', tool: 'trend', anchors: [{ time: 1700000000, price: 150.5 }, { time: 1700003600, price: 152 }], style })).json();
  ok(a.id && a.tool === 'trend' && a.anchors.length === 2 && a.anchors[0].price === 150.5, 'création : id, ancres et style conservés');
  const b = (await call('POST', '/api/drawings', { symbol: 'AAPL', tool: 'text', anchors: [{ time: 1700000000, price: 140 }], style: { ...style, text: 'Support é€' } })).json();
  ok(b.style.text === 'Support é€', 'texte avec accents et symboles conservé');
  await call('POST', '/api/drawings', { symbol: 'BTC-USD', tool: 'hline', anchors: [{ time: 1, price: 80000 }], style });

  const list = (await call('GET', '/api/drawings?symbol=AAPL')).json();
  ok(list.length === 2 && list.every((d) => d.symbol === 'AAPL'), 'liste filtrée par symbole (2 dessins AAPL, pas BTC)');
  ok((await call('GET', '/api/drawings?symbol=BTC-USD')).json().length === 1, 'dessins BTC-USD séparés');

  const up = (await call('PUT', `/api/drawings/${a.id}`, { anchors: [{ time: 1700000000, price: 151 }, { time: 1700007200, price: 155 }] })).json();
  ok(up.anchors[1].price === 155 && up.style.color === '#2962ff', 'mise à jour des ancres, style inchangé');
  const up2 = (await call('PUT', `/api/drawings/${a.id}`, { style: { color: '#ef5350', width: 4 } })).json();
  ok(up2.style.color === '#ef5350' && up2.anchors[0].price === 151, 'mise à jour du style, ancres inchangées');

  ok((await call('PUT', '/api/drawings/00000000-0000-4000-8000-000000000000', { style })).status === 404, 'dessin inconnu : 404');
  ok((await call('PUT', '/api/drawings/pas-un-uuid', { style })).status === 400, 'identifiant invalide : 400');
  ok((await call('POST', '/api/drawings', { symbol: 'AAPL', tool: 'dessin_inconnu', anchors: [{ time: 1, price: 1 }], style })).status === 400, 'outil inconnu refusé');
  ok((await call('POST', '/api/drawings', { symbol: 'AAPL', tool: 'trend', anchors: [], style })).status === 400, 'aucune ancre refusée');
  ok((await call('POST', '/api/drawings', { symbol: 'AAPL', tool: 'trend', anchors: [{ time: 1, price: 1 }], style: { color: 'rouge', width: 2 } })).status === 400, 'couleur invalide refusée');
  ok((await call('POST', '/api/drawings', { symbol: "AAPL'; DROP TABLE drawings;--", tool: 'trend', anchors: [{ time: 1, price: 1 }], style })).status === 400, 'symbole malformé refusé');

  ok((await call('DELETE', `/api/drawings/${b.id}`)).status === 200 && (await call('GET', '/api/drawings?symbol=AAPL')).json().length === 1, 'suppression d\'un dessin');
  ok((await call('DELETE', `/api/drawings/${b.id}`)).status === 404, 'suppression répétée : 404');
  const cleared = (await call('DELETE', '/api/drawings?symbol=AAPL')).json();
  ok(cleared.deleted === 1 && (await call('GET', '/api/drawings?symbol=AAPL')).json().length === 0 && (await call('GET', '/api/drawings?symbol=BTC-USD')).json().length === 1, 'effacer tout : AAPL vidé, BTC-USD intact');

  console.log(`\n${pass} réussis, ${fail} échoués`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('CRASH', e); process.exit(2); });
