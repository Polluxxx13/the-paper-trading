import { TtlCache } from './cache';
import { Candle, Timeframe, MarketError } from './types';
import { wrapYahooError, yf } from './yahoo';

const DAY = 86_400_000;

/** Intervalle Yahoo + fenêtre par défaut (limites Yahoo : 1m ≈ 7 j par requête, 5/15m ≈ 60 j, 1h ≈ 730 j). */
const TF: Record<Timeframe, { interval: string; lookbackMs: number; ttlMs: number }> = {
  '1m': { interval: '1m', lookbackMs: 7 * DAY, ttlMs: 15_000 },
  '5m': { interval: '5m', lookbackMs: 58 * DAY, ttlMs: 30_000 },
  '15m': { interval: '15m', lookbackMs: 58 * DAY, ttlMs: 30_000 },
  '1h': { interval: '1h', lookbackMs: 725 * DAY, ttlMs: 60_000 },
  '4h': { interval: '1h', lookbackMs: 725 * DAY, ttlMs: 60_000 }, // agrégé depuis 1h
  '1d': { interval: '1d', lookbackMs: 20 * 365 * DAY, ttlMs: 5 * 60_000 },
  '1w': { interval: '1wk', lookbackMs: 30 * 365 * DAY, ttlMs: 15 * 60_000 },
  '1M': { interval: '1mo', lookbackMs: 50 * 365 * DAY, ttlMs: 30 * 60_000 },
};

export const isTimeframe = (s: string): s is Timeframe => s in TF;

/** Regroupe des bougies 1h en bougies 4h (buckets alignés sur l'epoch UTC). */
export function aggregate(candles: Candle[], bucketSec: number): Candle[] {
  const out: Candle[] = [];
  for (const c of candles) {
    const t = Math.floor(c.time / bucketSec) * bucketSec;
    const last = out[out.length - 1];
    if (last && last.time === t) {
      last.high = Math.max(last.high, c.high);
      last.low = Math.min(last.low, c.low);
      last.close = c.close;
      last.volume += c.volume;
    } else {
      out.push({ time: t, open: c.open, high: c.high, low: c.low, close: c.close, volume: c.volume });
    }
  }
  return out;
}

const cache = new TtlCache<Candle[]>(200);

export function getHistory(symbol: string, tf: Timeframe): Promise<Candle[]> {
  const cfg = TF[tf];
  return cache.getOrLoad(`${symbol}|${tf}`, cfg.ttlMs, async () => {
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const res: any = await yf.chart(symbol, { period1: new Date(Date.now() - cfg.lookbackMs), interval: cfg.interval });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let candles: Candle[] = (res.quotes ?? [])
        .filter((q: any) => q.open != null && q.high != null && q.low != null && q.close != null)
        .map((q: any) => ({
          time: Math.floor(new Date(q.date).getTime() / 1000),
          open: q.open, high: q.high, low: q.low, close: q.close, volume: q.volume ?? 0,
        }));
      if (tf === '4h') candles = aggregate(candles, 4 * 3600);
      if (!candles.length) throw new MarketError(404, 'no_data', `Aucune donnée pour ${symbol} (${tf})`);
      return candles;
    } catch (e) {
      if (e instanceof MarketError) throw e;
      return wrapYahooError(e, symbol);
    }
  });
}
