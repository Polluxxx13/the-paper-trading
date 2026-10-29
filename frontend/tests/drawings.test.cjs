// Tests de la géométrie des dessins (fonctions pures) avec un mapper linéaire simple.
const { execSync } = require('child_process');
const path = require('path');
const F = path.resolve(__dirname, '../src/chart/drawings');
execSync(`npx tsc ${F}/geometry.ts --outDir ${__dirname}/.build-draw-build --target ES2020 --module commonjs --skipLibCheck`, { cwd: path.resolve(F, '../../..'), stdio: 'inherit' });
const G = (require('fs').writeFileSync(__dirname + '/.build-draw-build/package.json', '{"type":"commonjs"}'), require('./.build-draw-build/geometry.js'));

let pass = 0, fail = 0;
const ok = (c, l, x = '') => { (c ? pass++ : fail++); console.log(c ? 'PASS' : 'FAIL', l, x); };
const near = (a, b, e = 1e-6) => Math.abs(a - b) < e;

// x = temps/10 ; y = 1000 − prix×2 (le prix monte vers le haut de l'écran)
const m = { w: 800, h: 600, px: (a) => ({ x: a.time / 10, y: 1000 - a.price * 2 }), bars: (t1, t2) => Math.abs(t2 - t1) / 60 };
const mk = (tool, anchors, style = {}) => ({ id: 'x', symbol: 'AAPL', tool, anchors, style: { color: '#2962ff', width: 2, ...style } });
const A = (time, price) => ({ time, price });

// Tendance / flèche
let s = G.buildShapes(mk('trend', [A(100, 100), A(500, 200)]), m);
ok(s.length === 1 && s[0].k === 'line' && s[0].x1 === 10 && s[0].y1 === 800 && s[0].x2 === 50 && s[0].y2 === 600, 'ligne de tendance : 1 segment aux bons pixels');
s = G.buildShapes(mk('arrow', [A(0, 100), A(400, 100)]), m);
ok(s.some((x) => x.k === 'poly' && x.points.startsWith('40,800')), 'flèche : pointe sur le 2e point');
ok(G.buildShapes(mk('trend', [A(100, 100), A(500, 200)]), { ...m, px: () => null }).length === 0, 'ancre hors échelle : aucune forme');

// Rayon : prolongé jusqu'au bord droit/haut
const e = G.extendRay(0, 500, 100, 400, 800, 600);
ok(near(e.x, 500) && near(e.y, 0), 'rayon montant : prolongé jusqu\'au bord haut (y = 0) avant le bord droit', `${e.x},${e.y}`);
const e0 = G.extendRay(0, 300, 100, 290, 800, 600);
ok(near(e0.x, 800) && near(e0.y, 220), 'rayon peu incliné : prolongé jusqu\'au bord droit', `${e0.x},${e0.y}`);
const e2 = G.extendRay(100, 100, 100, 50, 800, 600);
ok(near(e2.x, 100) && near(e2.y, 0), 'rayon vertical vers le haut : s\'arrête en y = 0');
const e3 = G.extendRay(10, 10, 20, 20, 800, 600);
ok(near(e3.y, 600) && near(e3.x, 600), 'rayon diagonal : touche le bord bas en premier');

// Horizontale / verticale
s = G.buildShapes(mk('hline', [A(300, 150)]), m);
ok(s[0].x1 === 0 && s[0].x2 === 800 && s[0].y1 === 700, 'horizontale : pleine largeur au bon prix');
s = G.buildShapes(mk('vline', [A(300, 150)]), m);
ok(s[0].y1 === 0 && s[0].y2 === 600 && s[0].x1 === 30, 'verticale : pleine hauteur au bon instant');

// Canal parallèle : même pente
s = G.buildShapes(mk('channel', [A(0, 100), A(1000, 150), A(0, 120)]), m);
const L = s.filter((x) => x.k === 'line');
const slope = (l) => (l.y2 - l.y1) / (l.x2 - l.x1);
ok(L.length === 2 && near(slope(L[0]), slope(L[1])) && near(L[1].y1, 1000 - 240), 'canal : parallèle de même pente passant par le 3e point');

// Fibonacci retracement : 0 sur le 2e point, 1 sur le 1er
s = G.buildShapes(mk('fib', [A(0, 100), A(1000, 200)]), m);
const lines = s.filter((x) => x.k === 'line' && x.width === 1 && x.dash === undefined);
const ys = lines.map((l) => l.y1);
ok(lines.length === 7 && near(ys[0], 1000 - 200 * 2) && near(ys[6], 1000 - 100 * 2), 'Fib : niveau 0 = 2e point (200), niveau 1 = 1er point (100)');
ok(near(ys[3], 1000 - 150 * 2), 'Fib : niveau 0,5 au milieu (150)');
ok(near(ys[4], 1000 - (200 + (100 - 200) * 0.618) * 2), 'Fib : niveau 0,618', String(ys[4]));
ok(s.some((x) => x.k === 'text' && x.text.startsWith('0.618 (')), 'Fib : étiquettes de niveaux avec prix');

// Fibonacci extension : prix = p3 + (p2 − p1) × niveau
s = G.buildShapes(mk('fibext', [A(0, 100), A(500, 150), A(1000, 130)]), m);
const ext = s.filter((x) => x.k === 'line' && x.dash === undefined && x.width === 1).map((l) => l.y1);
ok(ext.length === 7 && near(ext[0], 1000 - 130 * 2) && near(ext[2], 1000 - 180 * 2) && near(ext[3], 1000 - (130 + 50 * 1.618) * 2), 'Fib extension : 0 = p3, 1 = p3 + amplitude, 1,618', ext.slice(0, 4).join(','));

// Rectangle
s = G.buildShapes(mk('rect', [A(500, 200), A(100, 100)]), m);
ok(s[0].k === 'rect' && s[0].x === 10 && s[0].w === 40 && s[0].y === 600 && s[0].h === 200, 'rectangle : normalisé quel que soit le sens du tracé');

// Règle
s = G.buildShapes(mk('measure', [A(0, 100), A(600, 110)]), m);
const lab = s.find((x) => x.k === 'text').text;
ok(lab.includes('+10.00') && lab.includes('+10.00 %') && lab.includes('10 barres') && lab.includes('10 min'), 'règle : Δ prix, %, barres et durée', lab);
s = G.buildShapes(mk('measure', [A(0, 100), A(86400 * 3, 90)]), { ...m, bars: () => 3 });
ok(s.find((x) => x.k === 'text').text.includes('-10.00 %') && s.find((x) => x.k === 'text').text.includes('3.0 j'), 'règle : baisse en % et durée en jours', s.find((x) => x.k === 'text').text);

// Position longue / courte
const entry = A(0, 100), target = A(1000, 110), stop = G.defaultStop(entry, target);
ok(stop.price === 95 && stop.time === 1000, 'stop par défaut : symétrique, R:R = 2');
s = G.buildShapes(mk('long', [entry, target, stop]), m);
const txt = s.filter((x) => x.k === 'text').map((x) => x.text).join(' | ');
ok(txt.includes('R:R 2.00') && txt.includes('+10.00 %') && txt.includes('-5.00 %') && txt.includes('Long'), 'long : cible +10 %, stop −5 %, R:R 2', txt);
const rects = s.filter((x) => x.k === 'rect');
ok(rects.length === 2 && rects[0].fill === '#26a69a' && rects[1].fill === '#ef5350' && rects[0].y < rects[1].y, 'long : zone de gain au-dessus, zone de risque en dessous');
const st = G.defaultStop(entry, A(1000, 90));
s = G.buildShapes(mk('short', [entry, A(1000, 90), st]), m);
ok(st.price === 105 && s.filter((x) => x.k === 'text').some((x) => x.text.startsWith('Short') && x.text.includes('R:R 2.00')), 'short : stop au-dessus de l\'entrée, R:R 2', String(st.price));

// Texte
s = G.buildShapes(mk('text', [A(100, 100)], { text: 'Support' }), m);
ok(s[0].k === 'text' && s[0].text === 'Support' && s[0].x === 10, 'texte : contenu et position');

// Durées
ok(G.fmtDuration(300) === '5 min' && G.fmtDuration(7200) === '2.0 h' && G.fmtDuration(86400 * 2) === '2.0 j', 'formats de durée');

console.log(`\n${pass} réussis, ${fail} échoués`);
process.exit(fail ? 1 : 0);
