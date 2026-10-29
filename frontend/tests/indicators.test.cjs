// Tests des indicateurs : comparaison à des implémentations naïves indépendantes + valeurs connues.
const { execSync } = require('child_process');
const path = require('path');
const F = path.resolve(__dirname, '..');
execSync(`npx tsc ${F}/src/chart/indicators/calc.ts --outDir ${__dirname}/.build-calc-build --target ES2020 --module commonjs --skipLibCheck`, { cwd: F, stdio: 'inherit' });
const C = (require('fs').writeFileSync(__dirname + '/.build-calc-build/package.json', '{"type":"commonjs"}'), require('./.build-calc-build/calc.js'));

let pass = 0, fail = 0;
const ok = (c, l, x = '') => { (c ? pass++ : fail++); console.log(c ? 'PASS' : 'FAIL', l, x); };
const near = (a, b, e = 1e-9) => a !== null && Math.abs(a - b) < e;
const allNear = (A, B, e = 1e-9) => A.length === B.length && A.every((v, i) => (v === null && B[i] === null) || (v !== null && B[i] !== null && Math.abs(v - B[i]) < e));

// Marche aléatoire déterministe (OHLCV)
let seed = 42; const rnd = () => ((seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296);
let p = 100;
const bars = Array.from({ length: 400 }, (_, i) => {
  const o = p, c = o * (1 + (rnd() - 0.48) * 0.03), h = Math.max(o, c) * (1 + rnd() * 0.01), l = Math.min(o, c) * (1 - rnd() * 0.01);
  p = c; return { time: 1700000000 + i * 3600, open: o, high: h, low: l, close: c, volume: Math.round(1000 + rnd() * 5000) };
});
const cl = bars.map((b) => b.close);

// SMA / WMA / EMA vs naïf
const naiveSma = (a, n) => a.map((_, i) => (i < n - 1 ? null : a.slice(i - n + 1, i + 1).reduce((s, x) => s + x, 0) / n));
ok(allNear(C.sma(cl, 20), naiveSma(cl, 20)), 'SMA = moyenne naïve');
ok(near(C.sma([1, 2, 3, 4, 5], 5)[4], 3) && C.sma([1, 2, 3, 4, 5], 5)[3] === null, 'SMA(1..5) = 3, null avant la période');
const naiveWma = (a, n) => a.map((_, i) => (i < n - 1 ? null : a.slice(i - n + 1, i + 1).reduce((s, x, j) => s + x * (j + 1), 0) / ((n * (n + 1)) / 2)));
ok(allNear(C.wma(cl, 10), naiveWma(cl, 10)), 'WMA = pondération linéaire naïve');
ok(near(C.wma([1, 2, 3], 3)[2], (1 + 4 + 9) / 6), 'WMA(1,2,3) = 14/6');
const naiveEma = (a, n) => { const k = 2 / (n + 1); const o = a.map(() => null); let e = a.slice(0, n).reduce((s, x) => s + x, 0) / n; o[n - 1] = e; for (let i = n; i < a.length; i++) { e = a[i] * k + e * (1 - k); o[i] = e; } return o; };
ok(allNear(C.ema(cl, 12), naiveEma(cl, 12)), 'EMA = récurrence naïve (amorcée par SMA)');

// RSI : exemple de référence de Wilder / StockCharts
const sc = [44.34, 44.09, 44.15, 43.61, 44.33, 44.83, 45.10, 45.42, 45.84, 46.08, 45.89, 46.03, 45.61, 46.28, 46.28, 46.00, 46.03, 46.41, 46.22, 45.64].map((c) => ({ time: 0, open: c, high: c, low: c, close: c, volume: 1 }));
const r = C.rsi(sc, 14);
ok(r[13] === null && Math.abs(r[14] - 70.46) < 0.2, 'RSI(14) premier point ≈ 70,5 (exemple StockCharts)', r[14].toFixed(2));
ok(Math.abs(r[15] - 66.25) < 0.3 && Math.abs(r[16] - 66.48) < 0.3, 'RSI points suivants ≈ 66,3 et 66,5 (lissage de Wilder)', `${r[15].toFixed(2)} ${r[16].toFixed(2)}`);
const rs = C.rsi(bars, 14);
ok(rs.filter((v) => v !== null).every((v) => v >= 0 && v <= 100), 'RSI toujours entre 0 et 100');
ok(C.rsi(Array.from({ length: 30 }, (_, i) => ({ time: i, open: i, high: i, low: i, close: i + 1, volume: 1 })), 14)[29] === 100, 'RSI = 100 sur une hausse continue');

// MACD
const m = C.macd(bars, 12, 26, 9);
const e12 = naiveEma(cl, 12), e26 = naiveEma(cl, 26);
ok(near(m.macd[100], e12[100] - e26[100]), 'MACD = EMA12 − EMA26');
ok(m.macd[24] === null && m.macd[25] !== null && m.signal[32] === null && m.signal[33] !== null, 'MACD défini à 26, signal à 26+9−1');
ok(near(m.hist[200], m.macd[200] - m.signal[200]), 'histogramme = MACD − signal');

// Bollinger
const b = C.bollinger(bars, 20, 2);
const i0 = 150, win = cl.slice(i0 - 19, i0 + 1), mean = win.reduce((s, x) => s + x, 0) / 20, sd = Math.sqrt(win.reduce((s, x) => s + (x - mean) ** 2, 0) / 20);
ok(near(b.upper[i0], mean + 2 * sd) && near(b.lower[i0], mean - 2 * sd) && near(b.mid[i0], mean), 'Bollinger = SMA ± 2σ (population)');
ok(b.upper.every((u, i) => u === null || (u >= b.mid[i] && b.mid[i] >= b.lower[i])), 'Bollinger : haute ≥ milieu ≥ basse');

// Stochastique
const st = C.stochastic(bars, 14, 3, 3);
const j = 200, w = bars.slice(j - 13, j + 1), hh = Math.max(...w.map((x) => x.high)), ll = Math.min(...w.map((x) => x.low));
const rawAt = (i) => { const ww = bars.slice(i - 13, i + 1); const h = Math.max(...ww.map((x) => x.high)), l = Math.min(...ww.map((x) => x.low)); return ((bars[i].close - l) / (h - l)) * 100; };
ok(near(st.k[j], (rawAt(j) + rawAt(j - 1) + rawAt(j - 2)) / 3), '%K = SMA3 du %K brut');
ok(near(st.d[j], (st.k[j] + st.k[j - 1] + st.k[j - 2]) / 3), '%D = SMA3 de %K');
ok(st.k.concat(st.d).every((v) => v === null || (v >= -1e-9 && v <= 100 + 1e-9)), 'stochastique entre 0 et 100');
void hh; void ll;

// ATR : naïf de Wilder
const trs = bars.map((x, i) => (i === 0 ? x.high - x.low : Math.max(x.high - x.low, Math.abs(x.high - bars[i - 1].close), Math.abs(x.low - bars[i - 1].close))));
let a14 = trs.slice(0, 14).reduce((s, x) => s + x, 0) / 14; const atrNaive = Array(400).fill(null); atrNaive[13] = a14;
for (let i = 14; i < 400; i++) { a14 = (a14 * 13 + trs[i]) / 14; atrNaive[i] = a14; }
ok(allNear(C.atr(bars, 14), atrNaive), 'ATR = lissage de Wilder naïf');

// OBV
let o = 0; const obvNaive = bars.map((x, i) => { if (i) o += x.close > bars[i - 1].close ? x.volume : x.close < bars[i - 1].close ? -x.volume : 0; return o; });
ok(allNear(C.obv(bars), obvNaive), 'OBV = cumul naïf');

// ADX
const ad = C.adx(bars, 14);
ok(ad.adx.filter((v) => v !== null).every((v) => v >= 0 && v <= 100) && ad.diPlus.filter((v) => v !== null).every((v) => v >= 0 && v <= 100), 'ADX et DI entre 0 et 100');
ok(ad.adx[26] === null && ad.adx[27] !== null, 'ADX défini à 2×période − 1', `premier index ${ad.adx.findIndex((v) => v !== null)}`);
const up = Array.from({ length: 80 }, (_, i) => ({ time: i, open: 100 + i, high: 101 + i, low: 99.5 + i, close: 100.8 + i, volume: 1 }));
const adUp = C.adx(up, 14);
ok(adUp.adx[79] > 80 && adUp.diPlus[79] > adUp.diMinus[79], 'ADX élevé et +DI > −DI sur tendance haussière pure', adUp.adx[79].toFixed(1));

// VWAP
const vw = C.vwap(bars, false);
const pv = bars.slice(0, 50).reduce((s, x) => s + ((x.high + x.low + x.close) / 3) * x.volume, 0), vv = bars.slice(0, 50).reduce((s, x) => s + x.volume, 0);
ok(near(vw[49], pv / vv), 'VWAP cumulatif = Σ(prix typique×vol)/Σvol');
const vd = C.vwap(bars, true), dayStart = bars.findIndex((x, i) => i && Math.floor(x.time / 86400) !== Math.floor(bars[i - 1].time / 86400));
ok(near(vd[dayStart], (bars[dayStart].high + bars[dayStart].low + bars[dayStart].close) / 3), 'VWAP intraday remis à zéro à chaque jour');

// Ichimoku
const ic = C.ichimoku(bars, 9, 26, 52);
const mid9 = (i) => { const ww = bars.slice(i - 8, i + 1); return (Math.max(...ww.map((x) => x.high)) + Math.min(...ww.map((x) => x.low))) / 2; };
const mid26 = (i) => { const ww = bars.slice(i - 25, i + 1); return (Math.max(...ww.map((x) => x.high)) + Math.min(...ww.map((x) => x.low))) / 2; };
ok(near(ic.tenkan[100], mid9(100)) && near(ic.kijun[100], mid26(100)), 'Ichimoku : Tenkan et Kijun = milieux des plus hauts/bas');
ok(near(ic.spanA[100], (mid9(74) + mid26(74)) / 2), 'Senkou A décalé de 26 barres');
ok(near(ic.chikou[100], bars[126].close) && ic.chikou[399] === null, 'Chikou = clôture 26 barres plus loin');

// Parabolic SAR
const ps = C.psar(up, 0.02, 0.2);
ok(ps.slice(2).every((v, i) => v < up[i + 2].low), 'SAR sous les plus bas en tendance haussière');
const down = up.concat(Array.from({ length: 40 }, (_, i) => ({ time: 100 + i, open: 180 - i * 3, high: 180.5 - i * 3, low: 178 - i * 3, close: 178.5 - i * 3, volume: 1 })));
const pd = C.psar(down, 0.02, 0.2);
ok(pd[119] > down[119].high && pd[100] > down[100].low, 'SAR bascule au-dessus du prix après le retournement');

// Pivots
const day1 = Array.from({ length: 24 }, (_, i) => ({ time: 86400 * 10 + i * 3600, open: 10, high: 12, low: 8, close: 11, volume: 1 }));
const day2 = Array.from({ length: 24 }, (_, i) => ({ time: 86400 * 11 + i * 3600, open: 11, high: 13, low: 9, close: 12, volume: 1 }));
const pv2 = C.pivots(day1.concat(day2), true);
const P = (12 + 8 + 11) / 3;
ok(pv2.pp[0] === null && near(pv2.pp[24], P) && near(pv2.r1[30], 2 * P - 8) && near(pv2.s1[30], 2 * P - 12) && near(pv2.r2[30], P + 4) && near(pv2.s2[30], P - 4), 'pivots du jour = niveaux calculés sur la veille');

console.log(`\n${pass} réussis, ${fail} échoués`);
process.exit(fail ? 1 : 0);
