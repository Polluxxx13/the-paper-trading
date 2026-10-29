// Isolation stricte des comptes Principal / Test : API, moteur d'ordres, base de données et code source.
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
  for (const [file, fn] of [['accounts', 'accountRoutes'], ['trading', 'tradingRoutes'], ['portfolio', 'portfolioRoutes'], ['calendar', 'calendarRoutes']]) await app.register(require(`${B}/dist/routes/${file}.js`)[fn]);
  await engine.init();

  let pass = 0, fail = 0;
  const ok = (c, l, x = '') => { (c ? pass++ : fail++); console.log(c ? 'PASS' : 'FAIL', l, x); };
  const call = async (method, url, payload) => { const r = await app.inject({ method, url, payload }); return { status: r.statusCode, body: r.body, json: () => JSON.parse(r.body) }; };
  const get = (u) => call('GET', u);
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const events = [];
  engine.on('trade', (e) => events.push(e));
  const M = 1, T = 2;

  // ───────── 1. Schéma : toute table de données de compte porte account_id NOT NULL ─────────
  for (const t of ['orders', 'positions', 'transactions', 'daily_snapshots', 'equity_samples', 'account_resets']) {
    const c = (await pg.query(`SELECT is_nullable FROM information_schema.columns WHERE table_name=$1 AND column_name='account_id'`, [t])).rows[0];
    ok(c && c.is_nullable === 'NO', `schéma : ${t}.account_id existe et est NOT NULL`);
  }

  // ───────── 2. Données distinctes dans chaque compte ─────────
  const q = await hub.getQuote('BTC-USD');
  const t1 = (await call('POST', '/api/accounts/test/orders', { symbol: 'BTC-USD', side: 'buy', type: 'market', quantity: 0.004, takeProfit: Math.round(q.price * 1.2), stopLoss: Math.round(q.price * 0.8) })).json();
  const tLimit = (await call('POST', '/api/accounts/test/orders', { symbol: 'BTC-USD', side: 'buy', type: 'limit', limitPrice: Math.round(q.price * 0.5), quantity: 0.001 })).json();
  const m1 = (await call('POST', '/api/accounts/main/orders', { symbol: 'ETH-USD', side: 'buy', type: 'market', quantity: 2 })).json();
  const mLimit = (await call('POST', '/api/accounts/main/orders', { symbol: 'ETH-USD', side: 'sell', type: 'limit', limitPrice: 99999, quantity: 1 })).json();
  ok(t1.status === 'filled' && m1.status === 'filled' && tLimit.status === 'working' && mLimit.status === 'working', 'préparation : 2 comptes avec positions et ordres en attente');
  await pg.query(`INSERT INTO daily_snapshots (account_id, snap_date, equity, cash, invested) VALUES ($1,'2026-01-05',1010,1010,0),($2,'2026-01-05',990000,990000,0)`, [T, M]);
  await sampleAccount(T); await sampleAccount(M);

  // ───────── 3. Lectures : chaque compte ne voit que ses données ─────────
  const ids = (rows) => rows.map((r) => r.id);
  const tOrders = (await get('/api/accounts/test/orders?status=all')).json(), mOrders = (await get('/api/accounts/main/orders?status=all')).json();
  ok(tOrders.length >= 4 && mOrders.length === 3 + 0 || mOrders.length >= 2, 'ordres : chaque compte a les siens', `${tOrders.length} / ${mOrders.length}`);
  ok(!ids(tOrders).some((i) => ids(mOrders).includes(i)), 'ordres : aucun identifiant commun entre Test et Principal');
  ok(tOrders.every((o) => o.symbol === 'BTC-USD') && mOrders.every((o) => o.symbol === 'ETH-USD'), 'ordres : symboles propres à chaque compte');
  const tPos = (await get('/api/accounts/test/positions')).json(), mPos = (await get('/api/accounts/main/positions')).json();
  ok(tPos.length === 1 && tPos[0].symbol === 'BTC-USD' && mPos.length === 1 && mPos[0].symbol === 'ETH-USD', 'positions : BTC uniquement dans Test, ETH uniquement dans Principal');
  const tTx = (await get('/api/accounts/test/transactions')).json(), mTx = (await get('/api/accounts/main/transactions')).json();
  ok(tTx.total === 1 && mTx.total === 1 && tTx.rows[0].symbol === 'BTC-USD' && mTx.rows[0].symbol === 'ETH-USD' && tTx.rows[0].id !== mTx.rows[0].id, 'transactions : une par compte, symboles distincts');
  const tCsv = (await get('/api/accounts/test/transactions.csv')).body, mCsv = (await get('/api/accounts/main/transactions.csv')).body;
  ok(tCsv.includes('BTC-USD') && !tCsv.includes('ETH-USD') && mCsv.includes('ETH-USD') && !mCsv.includes('BTC-USD'), 'export CSV : chaque compte exporte uniquement ses lignes');
  const tPf = (await get('/api/accounts/test/portfolio')).json(), mPf = (await get('/api/accounts/main/portfolio')).json();
  ok(tPf.summary.initialCapital === 1000 && mPf.summary.initialCapital === 1000000 && tPf.positions.every((p) => p.symbol === 'BTC-USD') && mPf.positions.every((p) => p.symbol === 'ETH-USD'), 'portfolio : capital initial et positions propres');
  ok(tPf.summary.cash < 1000 && mPf.summary.cash < 1000000 && tPf.summary.cash > 0, 'portfolio : cash débité uniquement sur le compte concerné');
  const tCal = (await get('/api/accounts/test/calendar?month=2026-01')).json(), mCal = (await get('/api/accounts/main/calendar?month=2026-01')).json();
  ok(tCal.days[0].equity === 1010 && mCal.days[0].equity === 990000, 'calendrier : snapshots séparés (1010 vs 990000)');
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Zurich' }).format(new Date());
  const tDay = (await get(`/api/accounts/test/calendar/day?date=${today}`)).json(), mDay = (await get(`/api/accounts/main/calendar/day?date=${today}`)).json();
  ok(tDay.trades.every((t) => t.symbol === 'BTC-USD') && mDay.trades.every((t) => t.symbol === 'ETH-USD') && tDay.trades.length === 1 && mDay.trades.length === 1, 'calendrier : détail du jour séparé');
  const tCurve = (await get('/api/accounts/test/equity-curve?range=all')).json(), mCurve = (await get('/api/accounts/main/equity-curve?range=all')).json();
  ok(tCurve[0].value === 1000 && mCurve[0].value === 1000000 && tCurve.at(-1).value < 2000 && mCurve.at(-1).value > 900000, 'courbe de valeur : points de départ et d\'arrivée propres à chaque compte');
  const tSt = (await get('/api/accounts/test/stats')).json(), mSt = (await get('/api/accounts/main/stats')).json();
  ok(tSt.fills === 1 && mSt.fills === 1, 'statistiques : calculées par compte');

  // ───────── 4. Manipulation d'URL : agir sur l'objet d'un autre compte ─────────
  ok((await call('DELETE', `/api/accounts/main/orders/${tLimit.id}`)).status === 404, 'annuler un ordre du Test via /main : 404');
  ok((await call('DELETE', `/api/accounts/test/orders/${mLimit.id}`)).status === 404, 'annuler un ordre du Principal via /test : 404');
  ok((await call('PATCH', `/api/accounts/main/orders/${tLimit.id}`, { limitPrice: 1 })).status === 404, 'modifier un ordre du Test via /main : 404');
  ok((await call('PATCH', `/api/accounts/test/orders/${mLimit.id}`, { limitPrice: 1 })).status === 404, 'modifier un ordre du Principal via /test : 404');
  const stillWorking = (await pg.query(`SELECT id, status, limit_price::float8 AS p FROM orders WHERE id IN ($1,$2) ORDER BY id`, [tLimit.id, mLimit.id])).rows;
  ok(stillWorking.every((o) => o.status === 'working') && stillWorking.find((o) => o.id === mLimit.id).p === 99999, 'ces tentatives n\'ont rien modifié');
  ok((await call('POST', '/api/accounts/test/positions/ETH-USD/close')).status === 404, 'fermer la position du Principal via /test : 404 (aucune position)');
  ok((await call('POST', '/api/accounts/main/positions/BTC-USD/close')).status === 404, 'fermer la position du Test via /main : 404');
  ok((await get('/api/accounts/main/positions')).json().length === 1 && (await get('/api/accounts/test/positions')).json().length === 1, 'les positions sont intactes');
  ok((await call('POST', '/api/accounts/inconnu/orders', { symbol: 'BTC-USD', side: 'buy', type: 'market', quantity: 1 })).status === 404, 'compte inconnu : 404');
  ok((await call('POST', '/api/accounts/test/orders', { symbol: 'BTC-USD', side: 'buy', type: 'market', quantity: 1, account_id: 1, accountId: 1 })).status !== 500, 'un account_id glissé dans le corps est ignoré');
  ok((await pg.query('SELECT count(*)::int c FROM orders WHERE account_id=$1 AND quantity=1', [M])).rows[0].c <= 1, 'et ne redirige rien vers le Principal');

  // ───────── 5. Base de données : clés étrangères composites ─────────
  const trOrder = tLimit.id; // ordre du Test
  let err = null;
  try { await pg.query(`INSERT INTO transactions (account_id, order_id, symbol, side, quantity, price, currency) VALUES ($1,$2,'X','buy',1,1,'USD')`, [M, trOrder]); } catch (e) { err = e; }
  ok(err && /foreign key|violates/i.test(err.message), 'base : une transaction du Principal ne peut pas référencer un ordre du Test', err ? err.message.slice(0, 70) : 'aucune erreur !');
  err = null;
  try { await pg.query(`INSERT INTO orders (account_id, symbol, side, type, quantity, parent_order_id) VALUES ($1,'X','buy','market',1,$2)`, [M, trOrder]); } catch (e) { err = e; }
  ok(err && /foreign key|violates/i.test(err.message), 'base : un ordre du Principal ne peut pas avoir pour parent un ordre du Test');
  err = null;
  try { await pg.query(`INSERT INTO orders (symbol, side, type, quantity) VALUES ('X','buy','market',1)`); } catch (e) { err = e; }
  ok(err && /null value|not-null/i.test(err.message), 'base : un ordre sans account_id est refusé');

  // ───────── 6. Réglages par compte ─────────
  await call('PATCH', '/api/accounts/test', { spreadBps: 50, feeFixed: 2 });
  const accts = (await get('/api/accounts')).json();
  const aT = accts.find((a) => a.slug === 'test'), aM = accts.find((a) => a.slug === 'main');
  ok(aT.spreadBps === 50 && aT.feeFixed === 2 && aM.spreadBps === 0 && aM.feeFixed === 0, 'spread et frais : modifiés sur Test, Principal inchangé');
  ok(aT.color !== aM.color && aT.initialCapital === 1000 && aM.initialCapital === 1000000, 'identité distincte : couleur et capital de départ');
  await call('PATCH', '/api/accounts/test', { spreadBps: 0, feeFixed: 0 });

  // ───────── 7. Moteur : les événements et les déclenchements restent dans le bon compte ─────────
  events.length = 0;
  await call('POST', '/api/accounts/test/orders', { symbol: 'BTC-USD', side: 'sell', type: 'limit', limitPrice: Math.round(q.price * 3), quantity: 0.001 });
  ok(events.length > 0 && events.every((e) => e.slug === 'test' && e.accountId === T), 'événements « trade » : uniquement pour le compte Test');
  const base = await hub.getQuote('ETH-USD');
  events.length = 0;
  engine.onQuote({ ...base, price: 100000 }); // franchit la vente limite du Principal (99999)
  await sleep(1500);
  const mFill = (await pg.query('SELECT status FROM orders WHERE id=$1', [mLimit.id])).rows[0].status;
  ok(mFill === 'filled' && events.every((e) => e.slug === 'main'), 'un tick sur ETH-USD exécute l\'ordre du Principal et seulement lui');
  ok((await pg.query(`SELECT count(*)::int c FROM transactions WHERE account_id=$1`, [T])).rows[0].c === 1, 'le Test n\'a reçu aucune transaction de ce tick');

  // ───────── 8. Réinitialisation du Test : Principal intact ─────────
  const snapshot = async (id) => ({
    cash: (await pg.query('SELECT cash::float8 c FROM accounts WHERE id=$1', [id])).rows[0].c,
    ...Object.fromEntries(await Promise.all(['orders', 'positions', 'transactions', 'daily_snapshots', 'equity_samples'].map(async (t) => [t, (await pg.query(`SELECT count(*)::int c FROM ${t} WHERE account_id=$1`, [id])).rows[0].c]))),
  });
  const mBefore = await snapshot(M);
  const tPending = (await pg.query(`SELECT id FROM orders WHERE account_id=$1 AND status='working'`, [T])).rows.map((r) => r.id);
  ok((await call('POST', '/api/accounts/test/reset', {})).status === 400, 'réinitialisation sans confirmation : refusée (400)');
  ok((await call('POST', '/api/accounts/test/reset', { confirm: false })).status === 400, 'réinitialisation avec confirm:false : refusée');
  ok((await call('POST', '/api/accounts/test/reset', { confirm: true })).status === 200, 'réinitialisation confirmée du Test');
  const tAfter = await snapshot(T), mAfter = await snapshot(M);
  ok(tAfter.cash === 1000 && tAfter.orders === 0 && tAfter.positions === 0 && tAfter.transactions === 0 && tAfter.daily_snapshots === 0 && tAfter.equity_samples === 0, 'Test : tout est remis à zéro (cash 1000, aucune donnée)');
  ok(JSON.stringify(mBefore) === JSON.stringify(mAfter), 'Principal : strictement identique avant/après la réinitialisation du Test', JSON.stringify(mAfter));
  ok((await get('/api/accounts/main/portfolio')).json().positions.length === 1, 'Principal : position toujours visible');
  // Les ordres du Test supprimés ne doivent plus pouvoir se déclencher (index mémoire vidé)
  const baseBtc = await hub.getQuote('BTC-USD');
  engine.onQuote({ ...baseBtc, price: Math.round(q.price * 0.4) }); // aurait franchi la limite d'achat du Test
  await sleep(800);
  ok(tPending.length > 0 && (await snapshot(T)).transactions === 0 && (await snapshot(T)).positions === 0, 'ordres du Test supprimés : aucun déclenchement fantôme après la réinitialisation');
  ok((await pg.query('SELECT count(*)::int c FROM account_resets WHERE account_id=$1', [T])).rows[0].c === 1 && (await pg.query('SELECT count(*)::int c FROM account_resets WHERE account_id=$1', [M])).rows[0].c === 0, 'journal des réinitialisations : seulement pour le Test');

  // ───────── 9. Garde-fou sur le code source : tout SQL des tables de compte filtre sur account_id ─────────
  const exempt = [
    'SELECT symbol FROM orders WHERE status IN', // engine.refreshWatch : abonnements marché globaux
    "FROM orders WHERE status = 'working'", // engine.init : recharge tous les ordres actifs (chacun porte son accountId)
    'DELETE FROM equity_samples WHERE ts <', // purge de rétention
    'SELECT DISTINCT symbol',
  ];
  const tables = /(?:FROM|UPDATE|INTO|JOIN)\s+(orders|positions|transactions|daily_snapshots|equity_samples)\b/gi;
  const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : e.name.endsWith('.ts') ? [path.join(d, e.name)] : []));
  const offenders = [];
  for (const f of walk(path.join(B, 'src'))) {
    const src = fs.readFileSync(f, 'utf8');
    let m;
    while ((m = tables.exec(src))) {
      const window = src.slice(Math.max(0, m.index - 200), m.index + 700);
      const stmt = src.slice(m.index, m.index + 700).split(/`|\n\s*\n/)[0]; // jusqu'à la fin de la requête (backtick fermant)
      if (/account_id/.test(stmt) || exempt.some((x) => window.includes(x))) continue;
      // Requêtes de l'export / de la liste : le WHERE vient de txWhere(), vérifié séparément ci-dessous
      if (stmt.includes('${where}') && f.endsWith('portfolio.ts')) continue;
      offenders.push(`${path.relative(B, f)} : ${stmt.replace(/\s+/g, ' ').slice(0, 90)}`);
    }
  }
  ok(/const w = \['account_id = \$1'\];/.test(fs.readFileSync(path.join(B, 'src/routes/portfolio.ts'), 'utf8')), 'code source : le filtre des transactions / du CSV commence toujours par account_id = $1');
  ok(offenders.length === 0, 'code source : toute requête sur orders/positions/transactions/snapshots/samples filtre sur account_id', offenders.length ? '\n   ' + offenders.join('\n   ') : '');

  console.log(`\n${pass} réussis, ${fail} échoués`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('CRASH', e); process.exit(2); });
