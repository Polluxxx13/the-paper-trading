// Test d'intégration du moteur d'ordres : PostgreSQL réel (pglite) + cours Yahoo réels.
process.env.DATABASE_URL = 'postgres://x'; process.env.APP_PASSWORD = 'test-password'; process.env.JWT_SECRET = 'test-secret-0123456789';
const fs = require('fs');
const path = require('path');
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
  const { fxToAccount } = require(B + '/dist/trading/fx.js');
  await engine.init();

  let pass = 0, fail = 0;
  const ok = (c, l, extra = '') => { (c ? pass++ : fail++); console.log(c ? 'PASS' : 'FAIL', l, extra); };
  const rej = async (p, code) => { try { await p; return null; } catch (e) { return e.code; } };
  const T = 2, M = 1; // compte Test (1000 $) / Principal
  const acct = async (id) => (await pg.query('SELECT cash::float8 AS cash FROM accounts WHERE id=$1', [id])).rows[0].cash;
  const pos = async (id, s) => (await pg.query('SELECT quantity::float8 q FROM positions WHERE account_id=$1 AND symbol=$2', [id, s])).rows[0];
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const q0 = await hub.getQuote('BTC-USD');
  console.log('BTC-USD', q0.price, q0.marketState);

  // 1. Market buy
  let o = await engine.place(T, 'test', { symbol: 'BTC-USD', side: 'buy', type: 'market', quantity: 0.005 });
  ok(o.status === 'filled', 'market buy rempli', `@${o.avgFillPrice}`);
  const cashAfter = await acct(T);
  ok(Math.abs(1000 - cashAfter - 0.005 * o.avgFillPrice) < 0.01, 'cash débité du bon montant', cashAfter.toFixed(2));
  ok((await pos(T, 'BTC-USD'))?.q === 0.005, 'position créée');

  // 2. Fonds insuffisants
  ok((await rej(engine.place(T, 'test', { symbol: 'BTC-USD', side: 'buy', type: 'market', quantity: 0.02 }))) === 'insufficient_funds', 'fonds insuffisants refusé');
  // 3. Fractions interdites sur actions + indices non négociables + symbole inconnu
  ok((await rej(engine.place(T, 'test', { symbol: 'AAPL', side: 'buy', type: 'limit', limitPrice: 1, quantity: 1.5 }))) === 'fractional_not_allowed', 'fraction refusée sur action');
  ok((await rej(engine.place(T, 'test', { symbol: '^GSPC', side: 'buy', type: 'market', quantity: 1 }))) === 'not_tradable', 'indice non négociable');
  ok((await rej(engine.place(T, 'test', { symbol: 'ZZZNOPE123', side: 'buy', type: 'market', quantity: 1 }))) === 'symbol_not_found', 'symbole introuvable');

  // 4. Limit loin du marché -> en attente, puis annulation
  o = await engine.place(T, 'test', { symbol: 'BTC-USD', side: 'buy', type: 'limit', limitPrice: Math.round(q0.price * 0.5), quantity: 0.001 });
  ok(o.status === 'working', 'limit non exécutable reste en attente');
  await engine.cancel(T, 'test', o.id);
  ok((await pg.query('SELECT status FROM orders WHERE id=$1', [o.id])).rows[0].status === 'cancelled', 'annulation');

  // 5. Isolation : le compte Principal ne voit rien
  ok(!(await pos(M, 'BTC-USD')) && (await acct(M)) === 1000000, 'isolation Principal / Test');
  const leak = (await pg.query('SELECT count(*)::int c FROM orders WHERE account_id=$1', [M])).rows[0].c;
  ok(leak === 0, 'aucun ordre dans Principal');

  // 6. Clôture : réalisé ≈ 0 (pas de frais ni spread), position supprimée
  o = await engine.closePosition(T, 'test', 'BTC-USD');
  ok(o.status === 'filled' && !(await pos(T, 'BTC-USD')), 'clôture de position');
  const rp = (await pg.query('SELECT realized_pnl::float8 r FROM transactions WHERE account_id=$1 ORDER BY id DESC LIMIT 1', [T])).rows[0].r;
  ok(Math.abs(rp) < 5, 'P&L réalisé plausible', rp.toFixed(3));

  // 7. Frais + spread paramétrés
  await pg.query('UPDATE accounts SET spread_bps=10, fee_fixed=1, fee_pct=0.1 WHERE id=$1', [T]);
  const c0 = await acct(T);
  o = await engine.place(T, 'test', { symbol: 'BTC-USD', side: 'buy', type: 'market', quantity: 0.002 });
  const px = o.avgFillPrice, mid = (await hub.getQuote('BTC-USD')).price;
  ok(px > mid * 1.0005, 'spread défavorable appliqué', `fill ${px} vs ${mid}`);
  const expectedFees = 1 + (0.002 * px * 0.1) / 100;
  ok(Math.abs(c0 - (await acct(T)) - (0.002 * px + expectedFees)) < 0.01, 'frais fixes + % débités');
  await pg.query('UPDATE accounts SET spread_bps=0, fee_fixed=0, fee_pct=0 WHERE id=$1', [T]);

  // 8. TP/SL attachés, déclenchement du SL, annulation du TP (OCO)
  const cur = (await hub.getQuote('BTC-USD')).price;
  o = await engine.place(T, 'test', { symbol: 'BTC-USD', side: 'buy', type: 'market', quantity: 0.001, takeProfit: Math.round(cur * 1.1), stopLoss: Math.round(cur * 0.9) });
  let kids = (await pg.query('SELECT type, status FROM orders WHERE parent_order_id=$1 ORDER BY id', [o.id])).rows;
  ok(kids.length === 2 && kids.every((k) => k.status === 'working'), 'TP et SL activés après le fill', JSON.stringify(kids.map((k) => k.type + ':' + k.status)));
  const sl = Math.round(cur * 0.9);
  engine.onQuote({ ...(await hub.getQuote('BTC-USD')), price: sl - 5 }); // chute simulée sous le SL
  await sleep(1500);
  kids = (await pg.query('SELECT type, status FROM orders WHERE parent_order_id=$1 ORDER BY id', [o.id])).rows;
  ok(kids.find((k) => k.type === 'stop_loss').status === 'filled' && kids.find((k) => k.type === 'take_profit').status === 'cancelled', 'SL exécuté, TP annulé (OCO)', JSON.stringify(kids.map((k) => k.type + ':' + k.status)));

  // 9. Stop-limit, trailing stop, limit exécutable sur tick simulé
  const base = await hub.getQuote('BTC-USD');
  const tick = (p) => engine.onQuote({ ...base, price: p });
  await engine.place(T, 'test', { symbol: 'BTC-USD', side: 'buy', type: 'market', quantity: 0.001 }); // position longue 0.002 (0.001 reste du test 7 + 0.001)
  const trail = await engine.place(T, 'test', { symbol: 'BTC-USD', side: 'sell', type: 'trailing_stop', trailAmount: 500, quantity: 0.001 });
  tick(base.price + 2000); tick(base.price + 2400); // le sommet monte -> stop remonte
  await sleep(300);
  ok((await pg.query('SELECT status FROM orders WHERE id=$1', [trail.id])).rows[0].status === 'working', 'trailing : pas déclenché en hausse');
  tick(base.price + 2400 - 450); await sleep(300);
  ok((await pg.query('SELECT status FROM orders WHERE id=$1', [trail.id])).rows[0].status === 'working', 'trailing : recul < distance, pas déclenché');
  tick(base.price + 2400 - 550); await sleep(1500);
  ok((await pg.query('SELECT status FROM orders WHERE id=$1', [trail.id])).rows[0].status === 'filled', 'trailing stop déclenché après recul > distance');

  const sl2 = await engine.place(T, 'test', { symbol: 'BTC-USD', side: 'sell', type: 'stop_limit', stopPrice: base.price - 1000, limitPrice: base.price - 1500, quantity: 0.001 });
  tick(base.price - 1100); await sleep(500); // stop touché mais prix > limite : devient limit, pas encore rempli ? (vente limit à 1500 sous : prix 1100 sous < limit -> non rempli)
  let st = (await pg.query('SELECT status, triggered FROM orders WHERE id=$1', [sl2.id])).rows[0];
  ok(st.triggered === true, 'stop-limit : stop touché, devient limit', JSON.stringify(st));
  // Stop-limit d'achat : stop touché mais prix au-dessus de la limite -> reste en attente
  const sl3 = await engine.place(T, 'test', { symbol: 'BTC-USD', side: 'buy', type: 'stop_limit', stopPrice: base.price + 1000, limitPrice: base.price + 1200, quantity: 0.001 });
  tick(base.price + 1500); await sleep(500);
  st = (await pg.query('SELECT status, triggered FROM orders WHERE id=$1', [sl3.id])).rows[0];
  ok(st.triggered === true && st.status === 'working', 'stop-limit achat : déclenché mais limite non atteinte, reste en attente', JSON.stringify(st));
  await engine.cancel(T, 'test', sl3.id);

  // 10. Vente à découvert + contrôle de marge
  const sPre = await pos(T, 'BTC-USD');
  if (sPre) await engine.closePosition(T, 'test', 'BTC-USD');
  o = await engine.place(T, 'test', { symbol: 'BTC-USD', side: 'sell', type: 'market', quantity: 0.002 });
  ok(o.status === 'filled' && (await pos(T, 'BTC-USD')).q === -0.002, 'short ouvert (quantité négative)');
  ok((await rej(engine.place(T, 'test', { symbol: 'BTC-USD', side: 'sell', type: 'market', quantity: 0.05 }))) === 'insufficient_margin', 'marge insuffisante refusée');
  await engine.closePosition(T, 'test', 'BTC-USD');

  // 11. Marché fermé : ordre au marché refusé sur une action, limite acceptée
  const aapl = await hub.getQuote('AAPL');
  console.log('AAPL marketState', aapl.marketState);
  if (aapl.marketState === 'CLOSED') {
    ok((await rej(engine.place(T, 'test', { symbol: 'AAPL', side: 'buy', type: 'market', quantity: 1 }))) === 'market_closed', 'ordre au marché refusé (marché fermé)');
  } else console.log('SKIP marché AAPL non fermé');
  o = await engine.place(M, 'main', { symbol: 'AAPL', side: 'buy', type: 'limit', limitPrice: 1, quantity: 5 });
  ok(o.status === 'working', 'limite acceptée hors séance');
  ok(engine.active.size >= 1, 'ordre actif indexé');

  // 12. FX
  const chf = await fxToAccount('CHF', 'USD'), gbp = await fxToAccount('GBp', 'USD');
  ok(chf > 0.8 && chf < 2 && gbp > 0.005 && gbp < 0.03, 'FX CHF->USD et GBp->USD', `CHF ${chf.toFixed(4)} · GBp ${gbp.toFixed(5)}`);
  const eur = await engine.place(T, 'test', { symbol: 'EURUSD=X', side: 'buy', type: 'market', quantity: 100.5 });
  ok(eur.status === 'filled', 'forex fractionnaire accepté');
  await engine.closePosition(T, 'test', 'EURUSD=X');

  // 13. Reset du compte Test n'affecte pas Principal
  const mainOrders = (await pg.query('SELECT count(*)::int c FROM orders WHERE account_id=$1', [M])).rows[0].c;
  ok(mainOrders === 1, 'ordre du Principal toujours présent après opérations sur Test');

  console.log(`\n${pass} réussis, ${fail} échoués`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('CRASH', e); process.exit(2); });
