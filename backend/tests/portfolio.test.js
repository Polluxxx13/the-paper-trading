// Test d'intégration portfolio : PostgreSQL réel (pglite) + routes Fastify via inject().
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
  const { engine } = require(B + '/dist/trading/engine.js');
  const { hub } = require(B + '/dist/market/quoteHub.js');
  const { sampleAccount } = require(B + '/dist/portfolio/equity.js');
  const Fastify = require(B + '/node_modules/fastify');
  const app = Fastify();
  app.setErrorHandler((e, _q, r) => r.code(e.name === 'ZodError' ? 400 : e.statusCode || 500).send({ error: e.code, message: e.message }));
  await app.register(require(B + '/dist/routes/trading.js').tradingRoutes);
  await app.register(require(B + '/dist/routes/portfolio.js').portfolioRoutes);
  await engine.init();

  let pass = 0, fail = 0;
  const ok = (c, l, x = '') => { (c ? pass++ : fail++); console.log(c ? 'PASS' : 'FAIL', l, x); };
  const get = async (u) => { const r = await app.inject({ url: u }); return { status: r.statusCode, body: r.body, json: () => JSON.parse(r.body) }; };
  const T = 2;
  const bump = async (f) => { const q = await hub.getQuote('BTC-USD'); hub.merge({ ...q, price: q.price * f, updatedAt: Date.now() }); };

  // Trades : 1 gagnant (+2 %), 1 perdant (-1 %)
  await engine.place(T, 'test', { symbol: 'BTC-USD', side: 'buy', type: 'market', quantity: 0.004 });
  await bump(1.02);
  await engine.place(T, 'test', { symbol: 'BTC-USD', side: 'sell', type: 'market', quantity: 0.004 });
  await bump(1 / 1.02);
  await engine.place(T, 'test', { symbol: 'BTC-USD', side: 'buy', type: 'market', quantity: 0.004 });
  await bump(0.99);
  await engine.place(T, 'test', { symbol: 'BTC-USD', side: 'sell', type: 'market', quantity: 0.004 });
  await bump(1 / 0.99);
  await engine.place(T, 'test', { symbol: 'BTC-USD', side: 'buy', type: 'market', quantity: 0.001 }); // reste une position ouverte
  await sampleAccount(T);

  const st = (await get('/api/accounts/test/stats')).json();
  console.log('stats', JSON.stringify(st));
  ok(st.trades === 2 && st.wins === 1 && st.losses === 1, '2 trades clôturés : 1 gagnant, 1 perdant');
  ok(st.winRate === 50, 'taux de réussite 50 %');
  ok(st.avgWin > 0 && st.avgLoss < 0 && st.profitFactor > 1, 'gain moyen > 0, perte moyenne < 0, profit factor > 1', `PF ${st.profitFactor?.toFixed(2)}`);
  ok(st.maxDrawdown >= 0 && st.maxDrawdownPct >= 0, 'drawdown calculé', `${st.maxDrawdownPct.toFixed(2)} %`);

  const pf = (await get('/api/accounts/test/portfolio')).json();
  const s = pf.summary;
  ok(Math.abs(s.equity - (s.cash + s.positionsValue)) < 1e-6, 'équité = cash + positions');
  ok(Math.abs(s.totalPnl - (s.equity - 1000)) < 1e-6 && Math.abs(s.totalPnl - (s.realizedPnl + s.unrealizedPnl)) < 0.5, 'P&L total = réalisé + latent', `${s.totalPnl.toFixed(3)} = ${s.realizedPnl.toFixed(3)} + ${s.unrealizedPnl.toFixed(3)}`);
  ok(pf.positions.length === 1 && Math.abs(pf.positions[0].weightPct - (pf.positions[0].marketValue / s.equity) * 100) < 1e-9, 'poids de la position');
  const sumPct = pf.allocation.reduce((a, x) => a + x.pct, 0);
  ok(Math.abs(sumPct - 100) < 1e-6 && pf.allocation.some((a) => a.assetClass === 'cash') && pf.allocation.some((a) => a.assetClass === 'crypto'), 'répartition cash + crypto = 100 %', JSON.stringify(pf.allocation.map((a) => a.assetClass + ':' + a.pct.toFixed(1))));

  for (const r of ['1d', '1w', '1m', '1y', 'all']) {
    const c = (await get('/api/accounts/test/equity-curve?range=' + r)).json();
    const inc = c.every((p, i) => i === 0 || p.time > c[i - 1].time);
    ok(c.length >= 2 && inc && Math.abs(c[c.length - 1].value - s.equity) < 1, `courbe ${r}`, `${c.length} pts, fin ${c[c.length - 1].value.toFixed(2)}`);
  }
  const bad = await get('/api/accounts/test/equity-curve?range=xx');
  ok(bad.status === 400, 'période invalide refusée', bad.status + ' ' + bad.body.slice(0, 120));

  // Transactions : filtres, pagination, CSV
  const all = (await get('/api/accounts/test/transactions')).json();
  ok(all.total === 5, '5 transactions', String(all.total));
  ok((await get('/api/accounts/test/transactions?side=sell')).json().total === 2, 'filtre sens=vente');
  ok((await get('/api/accounts/test/transactions?symbol=btc')).json().total === 5 && (await get('/api/accounts/test/transactions?symbol=AAPL')).json().total === 0, 'filtre symbole');
  ok((await get('/api/accounts/test/transactions?limit=2&offset=4')).json().rows.length === 1, 'pagination');
  ok((await get('/api/accounts/test/transactions?from=2099-01-01')).json().total === 0, 'filtre date');
  const csv = await get('/api/accounts/test/transactions.csv?side=sell');
  const lines = csv.body.replace('﻿', '').split('\r\n');
  ok(csv.body.startsWith('﻿Date;Symbole') && lines.length === 3 && lines[1].includes('Vente'), 'CSV (BOM, séparateur ;, filtre appliqué)', lines[0]);

  // Isolation : le compte Principal n'a rien
  const m = (await get('/api/accounts/main/portfolio')).json();
  ok(m.positions.length === 0 && m.summary.equity === 1000000 && (await get('/api/accounts/main/transactions')).json().total === 0, 'isolation : Principal vide et intact');
  ok((await get('/api/accounts/main/stats')).json().trades === 0, 'isolation : stats Principal à zéro');
  ok((await get('/api/accounts/nope/portfolio')).status === 404, 'compte inconnu : 404');

  console.log(`\n${pass} réussis, ${fail} échoués`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('CRASH', e); process.exit(2); });
