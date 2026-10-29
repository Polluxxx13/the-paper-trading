import { TtlCache } from './cache';
import { yf } from './yahoo';

const cache = new TtlCache<number[]>(500);

/** ~30 dernières clôtures journalières pour la mini-courbe de la watchlist (cache 10 min). */
export function getSparkline(symbol: string): Promise<number[]> {
  return cache.getOrLoad(symbol, 10 * 60_000, async () => {
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const res: any = await yf.chart(symbol, { period1: new Date(Date.now() - 45 * 86_400_000), interval: '1d' });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return (res.quotes ?? []).map((q: any) => q.close).filter((c: unknown): c is number => typeof c === 'number').slice(-30);
    } catch {
      return []; // une sparkline manquante ne doit jamais faire échouer la watchlist
    }
  });
}
