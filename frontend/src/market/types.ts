export type FeedStatus = 'live' | 'delayed' | 'closed';
export type Timeframe = '1m' | '5m' | '15m' | '1h' | '4h' | '1d' | '1w' | '1M';
export type ChartType = 'candles' | 'bars' | 'line' | 'area' | 'heikin';

export interface Fundamentals {
  yearHigh: number | null;
  yearLow: number | null;
  avgVolume: number | null;
  marketCap: number | null;
  pe: number | null;
  eps: number | null;
  dividendYield: number | null;
  extPrice: number | null;
  extChangePercent: number | null;
  extLabel: 'Pré-marché' | 'Après-bourse' | null;
}

export interface Quote {
  symbol: string;
  name: string;
  price: number;
  change: number;
  changePercent: number;
  prevClose: number | null;
  open: number | null;
  high: number | null;
  low: number | null;
  volume: number | null;
  fundamentals?: Fundamentals;
  bid: number | null;
  ask: number | null;
  bidSize: number | null;
  askSize: number | null;
  currency: string;
  exchange: string;
  assetClass: string;
  marketState: 'PRE' | 'REGULAR' | 'POST' | 'CLOSED';
  delayMinutes: number;
  time: number; // ms
  updatedAt: number;
  status: FeedStatus;
}

export interface Candle {
  time: number; // secondes epoch
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface SearchHit {
  symbol: string;
  name: string;
  exchange: string;
  type: string;
  assetClass: string;
}

export const TIMEFRAMES: { id: Timeframe; label: string; seconds: number }[] = [
  { id: '1m', label: '1m', seconds: 60 },
  { id: '5m', label: '5m', seconds: 300 },
  { id: '15m', label: '15m', seconds: 900 },
  { id: '1h', label: '1h', seconds: 3600 },
  { id: '4h', label: '4h', seconds: 14400 },
  { id: '1d', label: '1J', seconds: 86400 },
  { id: '1w', label: '1S', seconds: 604800 },
  { id: '1M', label: '1M', seconds: 2592000 },
];

export const CHART_TYPES: { id: ChartType; label: string }[] = [
  { id: 'candles', label: 'Bougies' },
  { id: 'bars', label: 'Barres' },
  { id: 'line', label: 'Ligne' },
  { id: 'area', label: 'Aire' },
  { id: 'heikin', label: 'Heikin-Ashi' },
];

/** Nombre de décimales adapté au prix (forex 5, actions 2...). */
export function priceDigits(price: number): number {
  if (price >= 100) return 2;
  if (price >= 10) return 3;
  if (price >= 1) return 4;
  return 6;
}
export const fmtPrice = (p: number) => p.toLocaleString('fr-CH', { minimumFractionDigits: priceDigits(p), maximumFractionDigits: priceDigits(p) });
