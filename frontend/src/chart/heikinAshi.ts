import type { Candle } from '../market/types';

type OHLC = Pick<Candle, 'time' | 'open' | 'high' | 'low' | 'close'>;

/** Bougie Heikin-Ashi suivante, calculée depuis la HA précédente (null pour la première). */
export function haNext(raw: Candle, prev: OHLC | null): OHLC {
  const close = (raw.open + raw.high + raw.low + raw.close) / 4;
  const open = prev ? (prev.open + prev.close) / 2 : (raw.open + raw.close) / 2;
  return { time: raw.time, open, close, high: Math.max(raw.high, open, close), low: Math.min(raw.low, open, close) };
}

export function toHeikinAshi(candles: Candle[]): OHLC[] {
  const out: OHLC[] = [];
  for (const c of candles) out.push(haNext(c, out[out.length - 1] ?? null));
  return out;
}
