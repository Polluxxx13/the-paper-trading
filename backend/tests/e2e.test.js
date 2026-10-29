// Test de bout en bout : lance le VRAI serveur compilé (dist/index.js) avec la base remplacée par pglite,
// puis l'interroge en HTTP et en WebSocket comme le ferait un navigateur ou Render.
const { spawn, spawnSync } = require('child_process');
const fs = require('fs'), os = require('os'), path = require('path');
const WebSocket = require(path.resolve(__dirname, '../node_modules/ws'));
const B = path.resolve(__dirname, '..');

const PORT = 20000 + Math.floor(Math.random() * 20000);
const BASE = `http://127.0.0.1:${PORT}`;
const PASSWORD = 'mot-de-passe-test';
let pass = 0, fail = 0;
const ok = (c, l, x = '') => { (c ? pass++ : fail++); console.log(c ? 'PASS' : 'FAIL', l, x); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Frontend factice servi par le backend
const staticDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pt-static-'));
fs.mkdirSync(path.join(staticDir, 'assets'));
fs.writeFileSync(path.join(staticDir, 'index.html'), '<!doctype html><title>Paper Trading</title><div id="root"></div>');
fs.writeFileSync(path.join(staticDir, 'assets', 'app-abc123.js'), 'console.log("app")');

const env = {
  ...process.env, NODE_ENV: 'production', PORT: String(PORT), DATABASE_URL: 'postgres://mock', APP_PASSWORD: PASSWORD,
  JWT_SECRET: 'secret-de-test-0123456789', STATIC_DIR: staticDir,
};

function start(extraEnv = {}) {
  return spawn(process.execPath, ['-r', path.join(__dirname, 'pg-mock.js'), path.join(B, 'dist/index.js')], { cwd: B, env: { ...env, ...extraEnv }, stdio: ['ignore', 'pipe', 'pipe'] });
}

// Petit client HTTP avec cookie manuel
let cookie = '';
async function req(method, url, { body, headers = {}, raw } = {}) {
  const r = await fetch(BASE + url, {
    method, redirect: 'manual',
    headers: { ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...(cookie ? { Cookie: cookie } : {}), ...headers },
    body: raw ?? (body !== undefined ? JSON.stringify(body) : undefined),
  });
  const text = await r.text();
  let json = null; try { json = JSON.parse(text); } catch { /* pas du JSON */ }
  return { status: r.status, headers: r.headers, text, json };
}

function wsOpen(headers) {
  return new Promise((resolve) => {
    const ws = new WebSocket(`ws://127.0.0.1:${PORT}/ws`, { headers });
    const msgs = [];
    const state = { ws, msgs, closed: null };
    ws.on('message', (d) => msgs.push(JSON.parse(d.toString())));
    ws.on('close', (code) => { state.closed = code; resolve(state); });
    ws.on('error', () => {});
    ws.on('open', () => resolve(state));
    setTimeout(() => resolve(state), 4000);
  });
}

(async () => {
  // ───── Démarrage refusé si la configuration est dangereuse ─────
  const bad = (extra, re, label) => {
    const r = spawnSync(process.execPath, ['-r', path.join(__dirname, 'pg-mock.js'), path.join(B, 'dist/index.js')], { cwd: B, env: { ...env, ...extra }, encoding: 'utf8', timeout: 20000 });
    ok(r.status === 1 && re.test(r.stderr + r.stdout), label, (r.stderr.split('\n').find((l) => /Error/.test(l)) ?? '').slice(0, 80));
  };
  bad({ JWT_SECRET: 'court' }, /JWT_SECRET/, 'démarrage refusé : JWT_SECRET trop court');
  bad({ APP_PASSWORD: '1234' }, /APP_PASSWORD/, 'démarrage refusé : mot de passe trop faible');
  bad({ APP_PASSWORD: '' }, /APP_PASSWORD/, 'démarrage refusé : mot de passe absent');
  bad({ DATABASE_URL: '' }, /DATABASE_URL/, 'démarrage refusé : DATABASE_URL absent');

  // ───── Démarrage du vrai serveur ─────
  const srv = start();
  let log = '';
  srv.stdout.on('data', (d) => (log += d)); srv.stderr.on('data', (d) => (log += d));
  let up = false;
  for (let i = 0; i < 80 && !up; i++) { await sleep(250); try { up = (await req('GET', '/healthz')).status === 200; } catch { /* pas encore prêt */ } }
  ok(up, 'le serveur démarre, applique le schéma et répond sur /healthz', up ? '' : log.slice(-400));
  if (!up) { srv.kill(); process.exit(1); }

  try {
    // ───── En-têtes de sécurité et fichiers statiques ─────
    const h = await req('GET', '/healthz');
    ok(h.json?.ok === true, '/healthz : {ok:true} (la base répond)');
    ok(h.headers.get('x-content-type-options') === 'nosniff' && h.headers.get('x-frame-options') === 'DENY' && h.headers.get('referrer-policy') === 'no-referrer', 'en-têtes nosniff, X-Frame-Options, Referrer-Policy');
    ok(/default-src 'self'/.test(h.headers.get('content-security-policy')) && /script-src 'self'/.test(h.headers.get('content-security-policy')) && /frame-ancestors 'none'/.test(h.headers.get('content-security-policy')), 'Content-Security-Policy stricte (scripts du même domaine uniquement)');
    ok(/max-age=\d+/.test(h.headers.get('strict-transport-security') ?? ''), 'HSTS actif en production');
    ok(!h.headers.get('x-powered-by'), 'pas d\'en-tête X-Powered-By');
    const idx = await req('GET', '/');
    ok(idx.status === 200 && idx.text.includes('id="root"') && idx.headers.get('cache-control') === 'no-cache', 'GET / : index.html servi, jamais mis en cache');
    const spa = await req('GET', '/portfolio/quelque-chose');
    ok(spa.status === 200 && spa.text.includes('id="root"'), 'route inconnue du frontend : repli SPA sur index.html');
    const asset = await req('GET', '/assets/app-abc123.js');
    ok(asset.status === 200 && /immutable/.test(asset.headers.get('cache-control')), 'fichier haché : cache longue durée (immutable)');
    const nf = await req('GET', '/api/inexistante');
    ok(nf.status === 404 && nf.json?.error === 'not_found', 'route d\'API inconnue : 404 JSON (pas la page HTML)');

    // ───── Authentification ─────
    for (const [m, u, b] of [['GET', '/api/accounts'], ['GET', '/api/market/search?q=apple'], ['GET', '/api/accounts/main/portfolio'], ['POST', '/api/accounts/main/orders', { symbol: 'AAPL', side: 'buy', type: 'market', quantity: 1 }], ['GET', '/api/drawings?symbol=AAPL'], ['GET', '/api/watchlists'], ['GET', '/api/accounts/main/calendar?month=2026-01'], ['POST', '/api/accounts/main/reset', { confirm: true }]]) {
      const r = await req(m, u, { body: b });
      ok(r.status === 401, `sans session : ${m} ${u.split('?')[0]} → 401`);
    }
    ok((await req('GET', '/api/auth/me')).json.authenticated === false, '/api/auth/me : non authentifié par défaut');
    const noAuthWs = await wsOpen({});
    await sleep(300);
    ok(noAuthWs.closed === 4401, 'WebSocket sans session : fermé (4401)', String(noAuthWs.closed));

    const wrong = await req('POST', '/api/auth/login', { body: { password: 'mauvais' } });
    ok(wrong.status === 401 && !wrong.headers.get('set-cookie'), 'mauvais mot de passe : 401, aucun cookie');
    const login = await req('POST', '/api/auth/login', { body: { password: PASSWORD } });
    const setCookie = login.headers.get('set-cookie') ?? '';
    ok(login.status === 200 && /pt_session=/.test(setCookie), 'bon mot de passe : session ouverte');
    ok(/HttpOnly/i.test(setCookie) && /SameSite=Strict/i.test(setCookie) && /Secure/i.test(setCookie) && /Path=\//.test(setCookie), 'cookie : HttpOnly + SameSite=Strict + Secure', setCookie.split(';').slice(1).join(';'));
    cookie = setCookie.split(';')[0];
    ok((await req('GET', '/api/auth/me')).json.authenticated === true, '/api/auth/me : authentifié avec le cookie');
    const forged = await req('GET', '/api/accounts', { headers: { Cookie: 'pt_session=' + cookie.split('=')[1].replace(/.$/, 'x') } });
    ok(forged.status === 401, 'cookie falsifié (signature modifiée) : 401');
    const expired = await req('GET', '/api/accounts', { headers: { Cookie: 'pt_session=MTAwMA.abc' } });
    ok(expired.status === 401, 'jeton mal formé : 401');

    // ───── API authentifiée ─────
    const accts = await req('GET', '/api/accounts');
    ok(accts.status === 200 && accts.json.length === 2 && accts.json[0].initialCapital === 1000000 && accts.json[1].initialCapital === 1000, 'comptes Principal (1 000 000) et Test (1 000) créés au démarrage');
    const quote = await req('GET', '/api/market/quote/BTC-USD');
    ok(quote.status === 200 && quote.json.price > 0 && ['live', 'delayed', 'closed'].includes(quote.json.status), 'cotation Yahoo BTC-USD avec statut', `${quote.json?.price} ${quote.json?.status}`);
    const hist = await req('GET', '/api/market/history?symbol=BTC-USD&tf=1h');
    ok(hist.status === 200 && hist.json.length > 100, 'historique 1h', String(hist.json?.length));
    ok((await req('GET', '/api/market/history?symbol=BTC-USD&tf=2x')).status === 400, 'unité de temps invalide : 400');
    ok((await req('GET', '/api/market/quote/ZZZNOPE123')).status === 404, 'symbole inconnu : 404');
    const wl = await req('GET', '/api/watchlists');
    ok(wl.json?.[0]?.symbols?.length >= 5, 'watchlist par défaut créée');

    // ───── Protection CSRF / origine ─────
    const evil = await req('POST', '/api/accounts/test/orders', { body: { symbol: 'BTC-USD', side: 'buy', type: 'market', quantity: 0.001 }, headers: { Origin: 'https://evil.example' } });
    ok(evil.status === 403 && evil.json?.error === 'bad_origin', 'requête modifiante depuis une autre origine : 403');
    ok((await req('POST', '/api/accounts/test/reset', { body: { confirm: true }, headers: { Origin: 'https://evil.example' } })).status === 403, 'réinitialisation depuis une autre origine : 403');
    ok((await req('GET', '/api/accounts', { headers: { Origin: 'https://evil.example' } })).status === 200, 'lecture (GET) non bloquée par la règle d\'origine (le cookie SameSite protège déjà)');

    // ───── WebSocket authentifié + événements de trading ─────
    const evilWs = await wsOpen({ Cookie: cookie, Origin: 'https://evil.example' });
    await sleep(300);
    ok(evilWs.closed === 4403, 'WebSocket depuis une autre origine : fermé (4403)', String(evilWs.closed));
    const w = await wsOpen({ Cookie: cookie, Origin: BASE });
    ok(w.closed === null, 'WebSocket avec session et bonne origine : ouvert');
    w.ws.send(JSON.stringify({ type: 'subscribe', symbols: ['BTC-USD'] }));
    for (let i = 0; i < 40 && !w.msgs.some((m) => m.type === 'quote'); i++) await sleep(250);
    ok(w.msgs.some((m) => m.type === 'mode'), 'WebSocket : message de mode (flux / repli) reçu');
    ok(w.msgs.some((m) => m.type === 'quote' && m.quote.symbol === 'BTC-USD' && m.quote.price > 0 && m.quote.status), 'WebSocket : cotation BTC-USD reçue après abonnement');
    w.ws.send('pas du json');
    await sleep(300);
    ok(w.msgs.some((m) => m.type === 'error'), 'message invalide : erreur renvoyée sans fermer la connexion');

    const order = await req('POST', '/api/accounts/test/orders', { body: { symbol: 'BTC-USD', side: 'buy', type: 'market', quantity: 0.002 }, headers: { Origin: BASE } });
    ok(order.status === 201 && order.json.status === 'filled', 'ordre au marché via HTTP avec la bonne origine : exécuté', `${order.json?.avgFillPrice}`);
    for (let i = 0; i < 20 && !w.msgs.some((m) => m.type === 'trade'); i++) await sleep(150);
    ok(w.msgs.some((m) => m.type === 'trade' && m.account === 'test'), 'WebSocket : événement « trade » du compte Test poussé au navigateur');
    const pos = await req('GET', '/api/accounts/test/positions');
    ok(pos.json.length === 1 && pos.json[0].quantity === 0.002, 'position visible dans le compte Test');
    ok((await req('GET', '/api/accounts/main/positions')).json.length === 0, 'et absente du compte Principal');
    ok((await req('POST', '/api/accounts/test/orders', { body: { symbol: 'BTC-USD', side: 'buy', type: 'market', quantity: 1e10 }, headers: { Origin: BASE } })).status === 400, 'quantité démesurée : 400 (pas d\'erreur 500)');
    w.ws.close();

    // ───── Robustesse des entrées ─────
    ok((await req('POST', '/api/accounts/test/orders', { raw: '{pas du json', headers: { 'Content-Type': 'application/json' } })).status === 400, 'JSON invalide : 400');
    const big = await req('POST', '/api/drawings', { raw: JSON.stringify({ symbol: 'AAPL', tool: 'text', anchors: [{ time: 1, price: 1 }], style: { color: '#ffffff', width: 1, text: 'x'.repeat(300_000) } }) });
    ok(big.status === 413, 'corps de requête trop volumineux (300 Ko) : 413');
    ok((await req('POST', '/api/accounts/test/orders', { body: { symbol: "'; DROP TABLE orders;--", side: 'buy', type: 'market', quantity: 1 }, headers: { Origin: BASE } })).status >= 400, 'symbole piégé : refusé, aucune injection');
    ok((await req('GET', '/api/accounts/test/orders?status=all')).status === 200, 'la table orders existe toujours après la tentative d\'injection');

    // ───── Déconnexion ─────
    await req('POST', '/api/auth/logout', { headers: { Origin: BASE } });
    cookie = '';
    ok((await req('GET', '/api/accounts')).status === 401, 'après déconnexion (cookie retiré) : 401');

    // ───── Limitation des tentatives de connexion (IP isolée par X-Forwarded-For) ─────
    const codes = [];
    for (let i = 0; i < 7; i++) codes.push((await req('POST', '/api/auth/login', { body: { password: 'essai' + i }, headers: { 'X-Forwarded-For': '203.0.113.7' } })).status);
    ok(codes.slice(0, 5).every((c) => c === 401) && codes.slice(5).every((c) => c === 429), 'force brute : 5 essais autorisés puis 429', codes.join(','));
    const other = await req('POST', '/api/auth/login', { body: { password: PASSWORD }, headers: { 'X-Forwarded-For': '198.51.100.9' } });
    ok(other.status === 200, 'la limitation est par adresse IP : un autre client peut se connecter');
  } finally {
    // ───── Arrêt propre (SIGTERM n'existe pas vraiment sous Windows : testé sous Linux/macOS et sur Render) ─────
    if (process.platform !== 'win32') {
      const exited = new Promise((r) => srv.on('exit', (code) => r(code)));
      srv.kill('SIGTERM');
      const code = await Promise.race([exited, sleep(8000).then(() => 'timeout')]);
      ok(code === 0, 'SIGTERM : arrêt propre, code de sortie 0', String(code));
    } else { srv.kill(); console.log('SKIP arrêt propre SIGTERM (non testable sous Windows)'); }
    fs.rmSync(staticDir, { recursive: true, force: true });
  }

  console.log(`\n${pass} réussis, ${fail} échoués`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('CRASH', e); process.exit(2); });
