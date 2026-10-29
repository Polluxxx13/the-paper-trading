import { pool } from '../db';
import { fullSeries } from './equity';

/**
 * Statistiques de performance. Un « trade » = une exécution qui réduit ou ferme une position
 * (is_close) ; son P&L réalisé inclut ses frais. Les frais des ouvertures sont comptés à part.
 */
export async function computeStats(accountId: number) {
  const { rows } = await pool.query(
    'SELECT realized_pnl::float8 AS r FROM transactions WHERE account_id = $1 AND is_close ORDER BY id', [accountId]);
  const pnl: number[] = rows.map((r) => r.r);
  const wins = pnl.filter((x) => x > 0);
  const losses = pnl.filter((x) => x < 0);
  const sum = (a: number[]) => a.reduce((s, x) => s + x, 0);
  const grossWin = sum(wins);
  const grossLoss = Math.abs(sum(losses));

  const { rows: f } = await pool.query('SELECT COALESCE(SUM(fees),0)::float8 AS fees, COUNT(*)::int AS fills FROM transactions WHERE account_id = $1', [accountId]);

  // Drawdown maximum sur la courbe de valeur
  const series = await fullSeries(accountId);
  let peak = -Infinity, maxDd = 0, maxDdPct = 0;
  for (const p of series) {
    peak = Math.max(peak, p.value);
    const dd = peak - p.value;
    if (dd > maxDd) { maxDd = dd; maxDdPct = peak > 0 ? (dd / peak) * 100 : 0; }
  }

  return {
    trades: pnl.length,
    wins: wins.length,
    losses: losses.length,
    winRate: pnl.length ? (wins.length / pnl.length) * 100 : null,
    avgWin: wins.length ? grossWin / wins.length : null,
    avgLoss: losses.length ? -grossLoss / losses.length : null, // négatif
    profitFactor: grossLoss > 0 ? grossWin / grossLoss : null, // null = non défini (aucune perte)
    bestTrade: pnl.length ? Math.max(...pnl) : null,
    worstTrade: pnl.length ? Math.min(...pnl) : null,
    expectancy: pnl.length ? sum(pnl) / pnl.length : null,
    totalFees: f[0].fees,
    fills: f[0].fills,
    maxDrawdown: maxDd,
    maxDrawdownPct: maxDdPct,
  };
}
