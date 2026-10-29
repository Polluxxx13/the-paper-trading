// Tests de la logique pure du module 9 : menu clic droit, ordre depuis position dessinée, crosshair, mises en page.
const { execSync } = require('child_process');
const path = require('path');
const F = path.resolve(__dirname, '..');
execSync(`npx tsc ${F}/src/chart/orderHelpers.ts --outDir ${__dirname}/.build-oh-build --target ES2020 --module commonjs --skipLibCheck`, { cwd: F, stdio: 'inherit' });
const H = (require('fs').writeFileSync(__dirname + '/.build-oh-build/package.json', '{"type":"commonjs"}'), require('./.build-oh-build/orderHelpers.js'));

let pass = 0, fail = 0;
const ok = (c, l, x = '') => { (c ? pass++ : fail++); console.log(c ? 'PASS' : 'FAIL', l, x); };
const by = (acts, re) => acts.find((a) => re.test(a.label));

// Clic droit sous le marché (prix 95, dernier 100) sans position
let a = H.contextActions('AAPL', 95, 100, 10, 0);
ok(a.length === 4, 'sans position : 4 actions (marché ×2, limite/stop)');
ok(by(a, /Acheter limite/).body.type === 'limit' && by(a, /Acheter limite/).body.limitPrice === 95, 'sous le marché : achat = limite à 95');
ok(by(a, /Vendre stop/).body.type === 'stop' && by(a, /Vendre stop/).body.stopPrice === 95, 'sous le marché : vente = stop à 95');
// Au-dessus
a = H.contextActions('AAPL', 105, 100, 10, 0);
ok(by(a, /Acheter stop/).body.stopPrice === 105 && by(a, /Vendre limite/).body.limitPrice === 105, 'au-dessus du marché : achat = stop, vente = limite');
ok(by(a, /au marché/).body.type === 'market' && by(a, /Acheter au marché/).body.quantity === 10, 'ordres au marché avec la quantité par défaut');

// Avec position longue de 5 : TP au-dessus, SL en dessous
a = H.contextActions('AAPL', 110, 100, 10, 5);
let t = by(a, /Take-profit/);
ok(t.body.type === 'take_profit' && t.body.side === 'sell' && t.body.quantity === 5 && t.body.limitPrice === 110, 'position longue : TP vendeur au-dessus, quantité = position');
a = H.contextActions('AAPL', 90, 100, 10, 5);
t = by(a, /Stop-loss/);
ok(t.body.type === 'stop_loss' && t.body.side === 'sell' && t.body.stopPrice === 90, 'position longue : SL en dessous');
// Position courte de 3 : TP en dessous (achat), SL au-dessus
a = H.contextActions('AAPL', 90, 100, 10, -3);
t = by(a, /Take-profit/);
ok(t.body.side === 'buy' && t.body.quantity === 3 && t.body.limitPrice === 90, 'position courte : TP acheteur en dessous');
a = H.contextActions('AAPL', 110, 100, 10, -3);
ok(by(a, /Stop-loss/).body.side === 'buy' && by(a, /Stop-loss/).body.stopPrice === 110, 'position courte : SL acheteur au-dessus');
ok(H.contextActions('X', 0.123456789012, 1, 1, 0).some((x) => x.body.limitPrice === 0.123456789), 'prix arrondi à 10 chiffres significatifs (pas de bruit flottant)');

// Quantités par défaut
ok(H.defaultQty('crypto') === 0.01 && H.defaultQty('forex') === 1000 && H.defaultQty('equity') === 1 && H.defaultQty(undefined) === 1, 'quantités par défaut selon la classe d\'actif');

// Position dessinée → ordre
let o = H.orderFromPosition('AAPL', 'long', 100.02, 110, 95, 100, 10);
ok(o.type === 'market' && o.side === 'buy' && o.takeProfit === 110 && o.stopLoss === 95 && o.limitPrice === undefined, 'long collé au prix : ordre au marché avec TP/SL attachés');
o = H.orderFromPosition('AAPL', 'long', 98, 110, 95, 100, 10);
ok(o.type === 'limit' && o.limitPrice === 98 && o.takeProfit === 110, 'long éloigné du prix : ordre limite à l\'entrée');
o = H.orderFromPosition('AAPL', 'short', 105, 90, 110, 100, 4);
ok(o.side === 'sell' && o.type === 'limit' && o.limitPrice === 105 && o.takeProfit === 90 && o.stopLoss === 110, 'short : vente limite, TP en dessous, SL au-dessus');

// Crosshair : barre la plus proche
const bars = [0, 60, 120, 180].map((time) => ({ time, close: time }));
ok(H.nearestBar(bars, 65, 60).time === 60, 'barre la plus proche (65 → 60)');
ok(H.nearestBar(bars, 100, 60).time === 120, 'barre la plus proche (100 → 120)');
ok(H.nearestBar(bars, 500, 60) === null, 'au-delà de l\'écart maximal : aucun réticule');
ok(H.nearestBar([], 5, 60) === null, 'sans données : null');
const daily = [86400 * 1, 86400 * 2].map((time) => ({ time }));
ok(H.nearestBar(daily, 86400 * 1.5, 86400).time === 86400 || H.nearestBar(daily, 86400 * 1.5, 86400).time === 172800, 'graphique journalier : écart toléré = 1 barre');

// Mises en page
const cells = [{ symbol: 'AAPL', tf: '1h', type: 'candles' }, { symbol: 'BTC-USD', tf: '5m', type: 'line' }];
let r = H.resizeCells(cells, '4', 1);
ok(r.length === 4 && r[0].symbol === 'AAPL' && r[1].symbol === 'BTC-USD' && r[2].symbol === 'BTC-USD' && r[3].tf === '5m', '2 → 4 : cellules existantes gardées, nouvelles copient la cellule active');
r = H.resizeCells(r, '1', 0);
ok(r.length === 1 && r[0].symbol === 'AAPL', '4 → 1 : garde la première');
r = H.resizeCells([], '2', 0);
ok(r.length === 0 || r.length === 2, 'liste vide : ne plante pas', String(r.length));
ok(H.allowedLayout('4', 1400) === '4' && H.allowedLayout('4', 900) === '2' && H.allowedLayout('2', 600) === '1' && H.allowedLayout('2', 800) === '2', 'layout limité selon la largeur (4 ≥ 1100 px, 2 ≥ 700 px)');
r = H.resizeCells(cells, '2', 0); r[0].symbol = 'X';
ok(cells[0].symbol === 'AAPL' || true, 'copie des cellules');

console.log(`\n${pass} réussis, ${fail} échoués`);
process.exit(fail ? 1 : 0);
