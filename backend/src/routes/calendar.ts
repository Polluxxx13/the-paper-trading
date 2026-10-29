import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { config } from '../config';
import { pool } from '../db';
import { getSummary } from '../portfolio/valuation';
import { accountIdFromSlug } from './accounts';

const EPS = 0.005; // en dessous d'un demi-centime, un jour est considéré sans variation

interface DayRow { date: string; equity: number; base: number; pnl: number; pct: number; trades: number; realized: number; active: boolean }

const localDate = () => new Intl.DateTimeFormat('en-CA', { timeZone: config.snapshotTz }).format(new Date());

/**
 * P&L de chaque jour = équité du snapshot du jour − équité du snapshot précédent
 * (capital initial pour le tout premier jour). La journée en cours utilise la valeur live.
 * Tout est filtré par account_id.
 */
async function dailyRows(accountId: number): Promise<DayRow[]> {
  const { rows: a } = await pool.query('SELECT initial_capital::float8 AS cap FROM accounts WHERE id = $1', [accountId]);
  const { rows: snaps } = await pool.query(
    'SELECT snap_date::text AS d, equity::float8 AS e FROM daily_snapshots WHERE account_id = $1 ORDER BY snap_date', [accountId]);
  const { rows: tx } = await pool.query(
    `SELECT (executed_at AT TIME ZONE $2)::date::text AS d, COUNT(*)::int AS n, COALESCE(SUM(realized_pnl), 0)::float8 AS r
     FROM transactions WHERE account_id = $1 GROUP BY 1`, [accountId, config.snapshotTz]);
  const perDay = new Map<string, { n: number; r: number }>(tx.map((t) => [t.d, t]));

  const today = localDate();
  const last = snaps[snaps.length - 1];
  const live = (await getSummary(accountId)).equity;
  if (last?.d === today) last.e = live;
  else if (!last || last.d < today) snaps.push({ d: today, e: live });

  let prev: number = a[0].cap;
  return snaps.map((s) => {
    const pnl = s.e - prev;
    const t = perDay.get(s.d);
    const row: DayRow = {
      date: s.d, equity: s.e, base: prev, pnl, pct: prev ? (pnl / prev) * 100 : 0,
      trades: t?.n ?? 0, realized: t?.r ?? 0, active: (t?.n ?? 0) > 0 || Math.abs(pnl) > EPS,
    };
    prev = s.e;
    return row;
  });
}

function summarize(rows: DayRow[]) {
  const pnl = rows.reduce((s, r) => s + r.pnl, 0);
  const base = rows[0]?.base ?? 0;
  const active = rows.filter((r) => r.active);
  return {
    pnl, pct: base ? (pnl / base) * 100 : 0,
    winDays: active.filter((r) => r.pnl > EPS).length,
    loseDays: active.filter((r) => r.pnl < -EPS).length,
    trades: rows.reduce((s, r) => s + r.trades, 0),
    bestDay: active.length ? active.reduce((b, r) => (r.pnl > b.pnl ? r : b)) : null,
    worstDay: active.length ? active.reduce((b, r) => (r.pnl < b.pnl ? r : b)) : null,
  };
}

export async function calendarRoutes(app: FastifyInstance) {
  // Vue mensuelle : un jour par case + totaux du mois
  app.get('/api/accounts/:slug/calendar', async (req) => {
    const id = await accountIdFromSlug(req);
    const { month } = z.object({ month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/) }).parse(req.query);
    const days = (await dailyRows(id)).filter((r) => r.date.startsWith(month));
    return { month, days, summary: summarize(days) };
  });

  // Vue annuelle : 12 mois avec P&L mensuel
  app.get('/api/accounts/:slug/calendar/year', async (req) => {
    const id = await accountIdFromSlug(req);
    const { year } = z.object({ year: z.string().regex(/^\d{4}$/) }).parse(req.query);
    const all = (await dailyRows(id)).filter((r) => r.date.startsWith(year));
    const months = Array.from({ length: 12 }, (_, i) => {
      const m = `${year}-${String(i + 1).padStart(2, '0')}`;
      const days = all.filter((r) => r.date.startsWith(m));
      return { month: m, hasData: days.length > 0, ...summarize(days) };
    });
    return { year, months, summary: summarize(all) };
  });

  // Détail d'une journée : variation de valeur + trades exécutés ce jour-là (heure locale)
  app.get('/api/accounts/:slug/calendar/day', async (req) => {
    const id = await accountIdFromSlug(req);
    const { date } = z.object({ date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) }).parse(req.query);
    const day = (await dailyRows(id)).find((r) => r.date === date) ?? null;
    const { rows } = await pool.query(
      `SELECT id, symbol, side, quantity::float8 AS quantity, price::float8 AS price, currency, fees::float8 AS fees,
              realized_pnl::float8 AS "realizedPnl", is_close AS "isClose", executed_at AS "executedAt"
       FROM transactions WHERE account_id = $1 AND (executed_at AT TIME ZONE $3)::date = $2::date ORDER BY id`,
      [id, date, config.snapshotTz],
    );
    return { date, day, trades: rows };
  });
}
