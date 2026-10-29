import fs from 'node:fs';
import Fastify from 'fastify';
import cookie from '@fastify/cookie';
import rateLimit from '@fastify/rate-limit';
import websocket from '@fastify/websocket';
import fastifyStatic from '@fastify/static';
import { ZodError, z } from 'zod';
import { config } from './config';
import { migrate, pool } from './db';
import { COOKIE, issueToken, passwordMatches, requireAuth, verifyToken } from './auth';
import { accountRoutes } from './routes/accounts';
import { marketRoutes } from './routes/market';
import { watchlistRoutes } from './routes/watchlists';
import { tradingRoutes } from './routes/trading';
import { portfolioRoutes } from './routes/portfolio';
import { startEquitySampler } from './portfolio/equity';
import { startDailySnapshotJob } from './jobs/dailySnapshot';
import { calendarRoutes } from './routes/calendar';
import { drawingRoutes } from './routes/drawings';
import { engine } from './trading/engine';
import { wsGateway } from './ws/gateway';
import { hub } from './market/quoteHub';
import { applySecurityHeaders, originAllowed } from './security';

async function main() {
  const app = Fastify({ logger: true, trustProxy: true, bodyLimit: 256 * 1024 }); // Render est derrière un proxy
  await app.register(cookie);
  // Limite globale généreuse sur l'API (l'interface ne l'atteint jamais) ; le login a sa propre limite stricte
  await app.register(rateLimit, { global: true, max: 600, timeWindow: '1 minute', allowList: (req) => !req.url.startsWith('/api') });
  await app.register(websocket, { options: { maxPayload: 64 * 1024 } });

  app.addHook('onSend', async (req, reply) => { applySecurityHeaders(req, reply); });
  app.addHook('onRequest', async (req, reply) => {
    // Requêtes qui modifient l'état : l'origine doit être la nôtre (défense en plus de SameSite=Strict)
    if (req.url.startsWith('/api') && !['GET', 'HEAD', 'OPTIONS'].includes(req.method) && !originAllowed(req))
      return reply.code(403).send({ error: 'bad_origin', message: 'Origine refusée' });
  });

  // Erreurs typées et uniformes : { error, message }
  app.setErrorHandler((err, _req, reply) => {
    if (err instanceof ZodError) return reply.code(400).send({ error: 'invalid_request', message: err.issues[0]?.message });
    const status = (err as { statusCode?: number }).statusCode ?? 500;
    if (status >= 500) app.log.error(err);
    reply.code(status).send({ error: (err as { code?: string }).code ?? (status === 404 ? 'not_found' : 'error'), message: status >= 500 ? 'Erreur interne' : err.message });
  });

  // ── Public ──
  app.get('/healthz', async () => {
    await pool.query('SELECT 1');
    return { ok: true };
  });

  app.post('/api/auth/login', { config: { rateLimit: { max: 5, timeWindow: '1 minute' } } }, async (req, reply) => {
    const { password } = z.object({ password: z.string() }).parse(req.body);
    if (!passwordMatches(password)) return reply.code(401).send({ error: 'bad_credentials', message: 'Mot de passe incorrect' });
    reply.setCookie(COOKIE, issueToken(), {
      httpOnly: true, sameSite: 'strict', secure: config.cookieSecure, path: '/', maxAge: config.sessionHours * 3600,
    });
    return { ok: true };
  });

  app.post('/api/auth/logout', async (_req, reply) => {
    reply.clearCookie(COOKIE, { path: '/' });
    return { ok: true };
  });

  app.get('/api/auth/me', async (req) => ({ authenticated: verifyToken(req.cookies[COOKIE]) }));

  // ── Protégé : tout le reste de /api ──
  await app.register(async (secured) => {
    secured.addHook('onRequest', requireAuth);
    await secured.register(accountRoutes);
    await secured.register(marketRoutes);
    await secured.register(watchlistRoutes);
    await secured.register(tradingRoutes);
    await secured.register(portfolioRoutes);
    await secured.register(calendarRoutes);
    await secured.register(drawingRoutes);
  });

  // WebSocket de marché (authentifié par le même cookie)
  await app.register(wsGateway);

  // Frontend compilé (SPA) servi par le même service
  if (fs.existsSync(config.staticDir)) {
    await app.register(fastifyStatic, {
      root: config.staticDir,
      cacheControl: false,
      // Fichiers Vite hachés : cache longue durée ; index.html : toujours revalidé (nouvelle version = nouveaux hachés)
      setHeaders: (res, filePath) => res.setHeader('Cache-Control', filePath.endsWith('index.html') ? 'no-cache' : 'public, max-age=31536000, immutable'),
    });
    app.setNotFoundHandler((req, reply) =>
      req.url.startsWith('/api') ? reply.code(404).send({ error: 'not_found', message: 'Route inconnue' }) : reply.sendFile('index.html'),
    );
  }

  await migrate();
  await app.listen({ port: config.port, host: '0.0.0.0' });
  hub.start();
  await engine.init(); // recharge les ordres en attente : ils s'exécutent même navigateur fermé
  startEquitySampler();
  startDailySnapshotJob();

  // Arrêt propre (Render envoie SIGTERM à chaque déploiement) : stoppe le flux, ferme HTTP puis la base
  let closing = false;
  const shutdown = (signal: string) => {
    if (closing) return;
    closing = true;
    app.log.info(`${signal} reçu : arrêt en cours`);
    setTimeout(() => process.exit(1), 10_000).unref();
    hub.stop();
    app.close().then(() => pool.end()).then(() => process.exit(0)).catch(() => process.exit(1));
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

// Une erreur inattendue dans une tâche de fond (sondage, échantillonnage...) ne doit pas tuer le serveur
process.on('unhandledRejection', (e) => console.error('[unhandledRejection]', e));

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
