import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { pool } from '../db';
import { equityCurve } from '../portfolio/equity';
import { computeStats } from '../portfolio/stats';
import { getSummary, loadPositions } from '../portfolio/valuation';
import { accountIdFromSlug } from './accounts';

const filters = z.object({
  symbol: z.string().trim().max(30).optional(),
  side: z.enum(['buy', 'sell']).optional(),
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  limit: z.coerce.number().int().min(1).max(1000).default(100),
  offset: z.coerce.number().int().min(0).default(0),
});

/** WHERE commun à l'API et à l'export CSV ; account_id est toujours le premier filtre. */
function txWhere(accountId: number, f: z.infer<typeof filters>) {
  const w = ['account_id = $1'];
  const p: unknown[] = [accountId];
  if (f.symbol) { p.push(`%${f.symbol}%`); w.push(`symbol ILIKE $${p.length}`); }
  if (f.side) { p.push(f.side); w.push(`side = $${p.length}`); }
  if (f.from) { p.push(f.from); w.push(`executed_at >= $${p.length}::date`); }
  if (f.to) { p.push(f.to); w.push(`executed_at < ($${p.length}::date + 1)`); }
  return { where: w.join(' AND '), params: p };
}

const TX_COLS = `id, order_id AS "orderId", symbol, side, quantity::float8 AS quantity, price::float8 AS price, currency,
  fx_rate::float8 AS "fxRate", fees::float8 AS fees, realized_pnl::float8 AS "realizedPnl", is_close AS "isClose", executed_at AS "executedAt"`;

const csvCell = (v: unknown) => {
  const s = v instanceof Date ? v.toISOString() : String(v ?? '');
  return /[;"\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

export async function portfolioRoutes(app: FastifyInstance) {
  // Vue d'ensemble : résumé, positions pondérées, répartition par classe d'actif
  app.get('/api/accounts/:slug/portfolio', async (req) => {
    const id = await accountIdFromSlug(req);
    const positions = await loadPositions(id);
    const summary = await getSummary(id, positions);
    const equity = summary.equity || 1;
    const buckets = new Map<string, number>();
    buckets.set('cash', Math.max(summary.cash, 0));
    for (const p of positions) buckets.set(p.assetClass, (buckets.get(p.assetClass) ?? 0) + Math.abs(p.marketValue)); // un short compte pour son exposition
    const total = [...buckets.values()].reduce((s, v) => s + v, 0) || 1;
    return {
      summary,
      positions: positions.map((p) => ({ ...p, weightPct: (p.marketValue / equity) * 100 })),
      allocation: [...buckets].filter(([, v]) => v > 0).map(([assetClass, value]) => ({ assetClass, value, pct: (value / total) * 100 })),
    };
  });

  app.get('/api/accounts/:slug/equity-curve', async (req) => {
    const id = await accountIdFromSlug(req);
    const { range } = z.object({ range: z.enum(['1d', '1w', '1m', '1y', 'all']).default('1m') }).parse(req.query);
    return equityCurve(id, range);
  });

  app.get('/api/accounts/:slug/stats', async (req) => computeStats(await accountIdFromSlug(req)));

  // Historique filtrable (paginé)
  app.get('/api/accounts/:slug/transactions', async (req) => {
    const id = await accountIdFromSlug(req);
    const f = filters.parse(req.query);
    const { where, params } = txWhere(id, f);
    const { rows } = await pool.query(
      `SELECT ${TX_COLS} FROM transactions WHERE ${where} ORDER BY id DESC LIMIT ${f.limit} OFFSET ${f.offset}`, params);
    const { rows: c } = await pool.query(`SELECT COUNT(*)::int AS n FROM transactions WHERE ${where}`, params);
    return { total: c[0].n, rows };
  });

  // Export CSV (séparateur « ; » et BOM UTF-8 : s'ouvre directement dans Excel en français/suisse)
  app.get('/api/accounts/:slug/transactions.csv', async (req, reply) => {
    const id = await accountIdFromSlug(req);
    const f = filters.parse({ ...(req.query as object), limit: 1000, offset: 0 });
    const { where, params } = txWhere(id, f);
    const { rows } = await pool.query(`SELECT ${TX_COLS} FROM transactions WHERE ${where} ORDER BY id DESC LIMIT 100000`, params);
    const head = ['Date', 'Symbole', 'Sens', 'Quantité', 'Prix', 'Devise', 'Taux de change', 'Frais', 'P&L réalisé', 'Clôture'];
    const lines = rows.map((r) => [r.executedAt, r.symbol, r.side === 'buy' ? 'Achat' : 'Vente', r.quantity, r.price, r.currency, r.fxRate, r.fees, r.realizedPnl, r.isClose ? 'oui' : 'non'].map(csvCell).join(';'));
    reply
      .header('Content-Type', 'text/csv; charset=utf-8')
      .header('Content-Disposition', `attachment; filename="transactions-${(req.params as { slug: string }).slug}.csv"`);
    return '﻿' + [head.join(';'), ...lines].join('\r\n');
  });
}
