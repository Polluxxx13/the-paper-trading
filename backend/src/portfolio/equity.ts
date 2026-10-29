import { pool } from '../db';
import { config } from '../config';
import { engine } from '../trading/engine';
import { getSummary } from './valuation';

const SAMPLE_EVERY_MS = 5 * 60_000;
const KEEP_SAMPLES_DAYS = 90;

/**
 * Enregistre la valeur du compte (equity_samples) et met à jour le snapshot du jour (daily_snapshots).
 * Le dernier échantillon de la journée fait donc office de clôture même si le job de clôture (module 6) est manqué.
 */
export async function sampleAccount(accountId: number) {
  const s = await getSummary(accountId);
  await pool.query(
    'INSERT INTO equity_samples (account_id, ts, equity) VALUES ($1, now(), $2) ON CONFLICT DO NOTHING',
    [accountId, s.equity],
  );
  await pool.query(
    `INSERT INTO daily_snapshots (account_id, snap_date, equity, cash, invested, realized_pnl_cum)
     VALUES ($1, (now() AT TIME ZONE $6)::date, $2, $3, $4, $5)
     ON CONFLICT (account_id, snap_date) DO UPDATE
       SET equity = $2, cash = $3, invested = $4, realized_pnl_cum = $5`,
    [accountId, s.equity, s.cash, s.positionsValue, s.realizedPnl, config.snapshotTz],
  );
}

export async function sampleAll() {
  const { rows } = await pool.query('SELECT id FROM accounts');
  for (const a of rows) await sampleAccount(a.id).catch((e) => console.warn('[equity] échantillon échoué :', (e as Error).message));
  await pool.query(`DELETE FROM equity_samples WHERE ts < now() - make_interval(days => $1)`, [KEEP_SAMPLES_DAYS]);
}

/** Échantillonne toutes les 5 min et 3 s après chaque trade (anti-rebond), pour que la courbe montre les paliers. */
export function startEquitySampler() {
  void sampleAll();
  setInterval(() => void sampleAll(), SAMPLE_EVERY_MS);
  const timers = new Map<number, NodeJS.Timeout>();
  engine.on('trade', ({ accountId }: { accountId: number }) => {
    clearTimeout(timers.get(accountId));
    timers.set(accountId, setTimeout(() => void sampleAccount(accountId).catch(() => {}), 3000));
  });
}

export type Range = '1d' | '1w' | '1m' | '1y' | 'all';
const RANGE_MS: Record<Range, number> = { '1d': 86_400_000, '1w': 7 * 86_400_000, '1m': 30 * 86_400_000, '1y': 365 * 86_400_000, all: Infinity };

export interface CurvePoint { time: number; value: number }

/** Série complète : point de départ (capital initial), snapshots quotidiens plus anciens que les échantillons, échantillons. */
export async function fullSeries(accountId: number): Promise<CurvePoint[]> {
  const { rows: acct } = await pool.query(
    'SELECT initial_capital::float8 AS cap, extract(epoch FROM reset_at)::float8 AS t FROM accounts WHERE id = $1', [accountId]);
  const { rows: samples } = await pool.query(
    'SELECT extract(epoch FROM ts)::float8 AS t, equity::float8 AS v FROM equity_samples WHERE account_id = $1 ORDER BY ts', [accountId]);
  const firstSample = samples[0]?.t ?? Infinity;
  const { rows: snaps } = await pool.query(
    `SELECT extract(epoch FROM ((snap_date::timestamp + interval '22 hours') AT TIME ZONE $2))::float8 AS t, equity::float8 AS v
     FROM daily_snapshots WHERE account_id = $1 ORDER BY snap_date`, [accountId, config.snapshotTz]);
  const pts: CurvePoint[] = [{ time: Math.floor(acct[0].t), value: acct[0].cap }];
  for (const s of snaps) if (s.t < firstSample && s.t > acct[0].t) pts.push({ time: Math.floor(s.t), value: s.v });
  for (const s of samples) pts.push({ time: Math.floor(s.t), value: s.v });
  return pts;
}

/** Courbe de valeur d'un compte sur une période, ≤ maxPoints points, terminée par la valeur live. */
export async function equityCurve(accountId: number, range: Range, maxPoints = 800): Promise<CurvePoint[]> {
  const all = await fullSeries(accountId);
  const live = (await getSummary(accountId)).equity;
  const since = range === 'all' ? 0 : Date.now() / 1000 - RANGE_MS[range] / 1000;
  let pts = all.filter((p) => p.time >= since);
  // Garde le dernier point avant la fenêtre pour que la courbe commence à la bonne valeur
  if (range !== 'all') {
    const before = [...all].reverse().find((p) => p.time < since);
    if (before) pts.unshift({ time: Math.floor(since), value: before.value });
  }
  pts.push({ time: Math.floor(Date.now() / 1000), value: live });
  if (pts.length > maxPoints) {
    const step = Math.ceil(pts.length / maxPoints);
    pts = pts.filter((_, i) => i % step === 0 || i === pts.length - 1);
  }
  // Lightweight Charts exige des temps strictement croissants
  return pts.filter((p, i) => i === 0 || p.time > pts[i - 1].time);
}
