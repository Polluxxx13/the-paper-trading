import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { pool } from '../db';
import { ORDER_COLS, engine, orderInput } from '../trading/engine';
import { getSummary, loadPositions } from '../portfolio/valuation';
import { accountIdFromSlug } from './accounts';

/**
 * Toutes les routes ci-dessous résolvent le compte depuis l'URL et filtrent chaque requête
 * SQL sur account_id : le compte Test ne peut jamais voir ni toucher le compte Principal.
 */
export async function tradingRoutes(app: FastifyInstance) {
  app.get('/api/accounts/:slug/summary', async (req) => getSummary(await accountIdFromSlug(req)));

  app.get('/api/accounts/:slug/positions', async (req) => loadPositions(await accountIdFromSlug(req)));

  app.get('/api/accounts/:slug/orders', async (req) => {
    const id = await accountIdFromSlug(req);
    const { status } = z.object({ status: z.enum(['open', 'closed', 'all']).default('open') }).parse(req.query);
    const where = status === 'open' ? `AND status IN ('working','pending')` : status === 'closed' ? `AND status IN ('filled','cancelled','rejected','expired')` : '';
    const { rows } = await pool.query(`SELECT ${ORDER_COLS} FROM orders WHERE account_id = $1 ${where} ORDER BY id DESC LIMIT 200`, [id]);
    return rows;
  });

  app.post('/api/accounts/:slug/orders', async (req, reply) => {
    const id = await accountIdFromSlug(req);
    const input = orderInput.parse(req.body);
    const order = await engine.place(id, (req.params as { slug: string }).slug, input);
    return reply.code(201).send(order);
  });

  app.patch('/api/accounts/:slug/orders/:orderId', async (req) => {
    const id = await accountIdFromSlug(req);
    const orderId = z.coerce.number().int().parse((req.params as { orderId: string }).orderId);
    const patch = z.object({ limitPrice: z.number().positive(), stopPrice: z.number().positive(), quantity: z.number().positive() }).partial().parse(req.body);
    return engine.modify(id, (req.params as { slug: string }).slug, orderId, patch);
  });

  app.delete('/api/accounts/:slug/orders/:orderId', async (req) => {
    const id = await accountIdFromSlug(req);
    const orderId = z.coerce.number().int().parse((req.params as { orderId: string }).orderId);
    await engine.cancel(id, (req.params as { slug: string }).slug, orderId);
    return { ok: true };
  });

  app.post('/api/accounts/:slug/positions/:symbol/close', async (req) => {
    const id = await accountIdFromSlug(req);
    const p = req.params as { slug: string; symbol: string };
    return engine.closePosition(id, p.slug, decodeURIComponent(p.symbol));
  });

}
