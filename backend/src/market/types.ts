export type AssetClass = 'equity' | 'etf' | 'index' | 'forex' | 'crypto' | 'commodity' | 'future' | 'other';
export type MarketState = 'PRE' | 'REGULAR' | 'POST' | 'CLOSED';
export type FeedStatus = 'live' | 'delayed' | 'closed';

/** Chiffres de référence fournis par Yahoo (rafraîchis par le sondage méta, absents selon la classe d'actifs). */
export interface Fundamentals {
  yearHigh: number | null;
  yearLow: number | null;
  avgVolume: number | null;
  marketCap: number | null;
  pe: number | null;
  eps: number | null;
  dividendYield: number | null; // en %
  /** Cotation hors séance (pré-marché ou après-bourse) quand Yahoo la fournit. */
  extPrice: number | null;
  extChangePercent: number | null;
  extLabel: 'Pré-marché' | 'Après-bourse' | null;
}

/** Cotation normalisée, identique pour REST et WebSocket. */
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
  /** Meilleurs prix acheteur / vendeur indiqués par Yahoo (indicatifs, rafraîchis par le sondage). */
  bid: number | null;
  ask: number | null;
  bidSize: number | null;
  askSize: number | null;
  fundamentals: Fundamentals;
  currency: string;
  exchange: string;
  assetClass: AssetClass;
  marketState: MarketState;
  delayMinutes: number; // exchangeDataDelayedBy
  time: number; // horodatage de la dernière cotation (ms epoch)
  updatedAt: number; // dernière mise à jour reçue par NOTRE serveur (ms)
  source: 'stream' | 'poll';
}

export interface Candle {
  time: number; // secondes epoch (format Lightweight Charts)
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export type Timeframe = '1m' | '5m' | '15m' | '1h' | '4h' | '1d' | '1w' | '1M';

export class MarketError extends Error {
  constructor(public statusCode: number, public code: string, message: string) {
    super(message);
  }
}
