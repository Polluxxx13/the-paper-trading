import { pool } from '../db';
import { hub, statusOf } from '../market/quoteHub';
import { fxToAccount } from '../trading/fx';

/** Positions valorisées au dernier prix et au taux de change courant (devise du compte). */
export async function loadPositions(accountId: number) {
  const { rows: acct } = await pool.query('SELECT base_currency FROM accounts WHERE id = $1', [accountId]);
  const { rows } = await pool.query(
    `SELECT symbol, asset_class AS "assetClass", currency, quantity::float8 AS quantity, avg_price::float8 AS "avgPrice",
            avg_fx_rate::float8 AS "avgFxRate", opened_at AS "openedAt"
     FROM positions WHERE account_id = $1 ORDER BY symbol`,
    [accountId],
  );
  return Promise.all(
    rows.map(async (p) => {
      const q = await hub.getQuote(p.symbol).catch(() => hub.peek(p.symbol));
      const fx = await fxToAccount(p.currency, acct[0].base_currency).catch(() => p.avgFxRate);
      const px = q?.price ?? p.avgPrice;
      const marketValue = p.quantity * px * fx;
      const cost = p.quantity * p.avgPrice * p.avgFxRate;
      return {
        ...p, name: q?.name ?? p.symbol, price: px, fx, marketValue,
        unrealizedPnl: marketValue - cost,
        unrealizedPct: cost !== 0 ? ((marketValue - cost) / Math.abs(cost)) * 100 : 0,
        status: q ? statusOf(q) : 'closed',
      };
    }),
  );
}

export type ValuedPosition = Awaited<ReturnType<typeof loadPositions>>[number];

/** Résumé du compte : cash, valeur des positions, P&L latent / réalisé, équité. */
export async function getSummary(accountId: number, positions?: ValuedPosition[]) {
  const { rows } = await pool.query(
    `SELECT slug, base_currency AS "baseCurrency", initial_capital::float8 AS "initialCapital", cash::float8 AS cash, reset_at AS "resetAt"
     FROM accounts WHERE id = $1`,
    [accountId],
  );
  const pos = positions ?? (await loadPositions(accountId));
  const { rows: r } = await pool.query('SELECT COALESCE(SUM(realized_pnl),0)::float8 AS realized FROM transactions WHERE account_id = $1', [accountId]);
  const positionsValue = pos.reduce((s, p) => s + p.marketValue, 0);
  const unrealizedPnl = pos.reduce((s, p) => s + p.unrealizedPnl, 0);
  const equity = rows[0].cash + positionsValue;
  const totalPnl = equity - rows[0].initialCapital;
  return {
    ...rows[0], positionsValue, unrealizedPnl, realizedPnl: r[0].realized, equity, totalPnl,
    totalPnlPct: (totalPnl / rows[0].initialCapital) * 100,
    unrealizedPct: positionsValue !== 0 ? (unrealizedPnl / Math.abs(positionsValue - unrealizedPnl)) * 100 : 0,
  };
}
