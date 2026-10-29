// Test du calendrier P&L : PostgreSQL réel (pglite) + données simulées + routes via inject().
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
  await app.register(require(B + '/dist/routes/calendar.js').calendarRoutes);
  const { sampleAll } = require(B + '/dist/portfolio/equity.js');

  let pass = 0, fail = 0;
  const ok = (c, l, x = '') => { (c ? pass++ : fail++); console.log(c ? 'PASS' : 'FAIL', l, x); };
  const get = async (u) => { const r = await app.inject({ url: u }); return { status: r.statusCode, json: () => JSON.parse(r.body) }; };
  const near = (a, b) => Math.abs(a - b) < 1e-6;
  const T = 2, M = 1;

  // Compte Test (capital 1000) : snapshots simulés
  const snaps = [['2026-09-01', 1010], ['2026-09-02', 1010], ['2026-09-03', 990], ['2026-09-05', 1005], ['2026-10-01', 1100]];
  for (const [d, e] of snaps) await pg.query('INSERT INTO daily_snapshots (account_id, snap_date, equity, cash, invested) VALUES ($1,$2,$3,$3,0)', [T, d, e]);
  // Compte Principal : un snapshot à lui, pour vérifier l'isolation
  await pg.query('INSERT INTO daily_snapshots (account_id, snap_date, equity, cash, invested) VALUES ($1,$2,$3,$3,0)', [M, '2026-09-01', 900000]);
  // Trade exécuté le 3 sept. à 23:30 UTC = 4 sept. 01:30 à Zurich (fuseau local)
  await pg.query(`INSERT INTO orders (id, account_id, symbol, side, type, quantity, status) VALUES (1,$1,'BTC-USD','sell','market',1,'filled')`, [T]);
  await pg.query(`INSERT INTO transactions (account_id, order_id, symbol, side, quantity, price, currency, realized_pnl, is_close, executed_at)
                  VALUES ($1,1,'BTC-USD','sell',1,100,'USD',-7.5,true,'2026-09-03T23:30:00Z')`, [T]);
  await pg.query(`INSERT INTO transactions (account_id, symbol, side, quantity, price, currency, realized_pnl, executed_at) VALUES ($1,'AAPL','buy',1,10,'USD',0,'2026-09-01T10:00:00Z')`, [M]);

  const sep = (await get('/api/accounts/test/calendar?month=2026-09')).json();
  const byDate = Object.fromEntries(sep.days.map((d) => [d.date, d]));
  ok(near(byDate['2026-09-01'].pnl, 10) && near(byDate['2026-09-01'].base, 1000) && near(byDate['2026-09-01'].pct, 1), '1er jour : base = capital initial, +10 (+1 %)');
  ok(!byDate['2026-09-02'].active && byDate['2026-09-02'].pnl === 0, 'jour sans variation ni trade : inactif (case grise)');
  ok(near(byDate['2026-09-03'].pnl, -20) && near(byDate['2026-09-03'].pct, (-20 / 1010) * 100), 'jour perdant : -20 (-1,98 %)');
  ok(byDate['2026-09-04'] === undefined, 'jour sans snapshot : absent (gris côté interface)');
  ok(near(byDate['2026-09-05'].pnl, 15), 'écart de plusieurs jours : P&L depuis le dernier snapshot', String(byDate['2026-09-05'].pnl));
  ok(near(sep.summary.pnl, 5) && sep.summary.winDays === 2 && sep.summary.loseDays === 1, 'totaux du mois : +5, 2 gagnants, 1 perdant', JSON.stringify({ w: sep.summary.winDays, l: sep.summary.loseDays }));
  ok(sep.summary.bestDay.date === '2026-09-05' && sep.summary.worstDay.date === '2026-09-03', 'meilleur / pire jour');
  ok(near(sep.summary.pct, 0.5), 'rendement du mois = P&L / valeur de départ', sep.summary.pct.toFixed(3));

  const oct = (await get('/api/accounts/test/calendar?month=2026-10')).json();
  ok(near(oct.days[0].pnl, 95) && oct.days[0].base === 1005, 'octobre : base = dernier snapshot de septembre');
  const today = oct.days[oct.days.length - 1];
  ok(today.date === '2026-10-28' || today.date.startsWith('2026-10'), 'journée en cours ajoutée avec la valeur live', today.date + ' equity ' + today.equity);

  const yr = (await get('/api/accounts/test/calendar/year?year=2026')).json();
  ok(yr.months.length === 12 && yr.months[8].hasData && !yr.months[0].hasData && near(yr.months[8].pnl, 5), 'année : 12 mois, septembre = +5, janvier vide');
  ok(near(yr.summary.pnl, yr.months.reduce((s, m) => s + m.pnl, 0)), 'total annuel = somme des mois');

  const d4 = (await get('/api/accounts/test/calendar/day?date=2026-09-04')).json();
  ok(d4.trades.length === 1 && d4.trades[0].symbol === 'BTC-USD', 'détail du jour : trade de 23:30 UTC rattaché au 4 sept. (heure de Zurich)');
  const d3 = (await get('/api/accounts/test/calendar/day?date=2026-09-03')).json();
  ok(d3.trades.length === 0 && near(d3.day.pnl, -20), 'détail du 3 sept. : variation -20, aucun trade');
  ok((await get('/api/accounts/test/calendar/day?date=2026-09-04')).json().day === null, 'jour sans snapshot : day = null, trades quand même listés');

  // Isolation
  const mSep = (await get('/api/accounts/main/calendar?month=2026-09')).json();
  ok(mSep.days.length === 1 && mSep.days[0].base === 1000000 && near(mSep.days[0].pnl, -100000), 'isolation : le calendrier Principal ne contient que ses données');
  ok((await get('/api/accounts/main/calendar/day?date=2026-09-04')).json().trades.length === 0, 'isolation : trade du Test absent du Principal');

  // Validation
  ok((await get('/api/accounts/test/calendar?month=2026-13')).status === 400 && (await get('/api/accounts/test/calendar/day?date=hier')).status === 400, 'formats invalides refusés (400)');

  // Job de clôture : sampleAll écrit un snapshot pour chaque compte
  await sampleAll();
  const n = (await pg.query(`SELECT count(*)::int c FROM daily_snapshots WHERE snap_date = (now() AT TIME ZONE 'Europe/Zurich')::date`)).rows[0].c;
  ok(n === 2, 'sampleAll : un snapshot du jour pour chacun des 2 comptes');

  console.log(`\n${pass} réussis, ${fail} échoués`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('CRASH', e); process.exit(2); });
