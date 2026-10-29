import YahooFinance from 'yahoo-finance2';
import { TtlCache } from './cache';
import { AssetClass, Fundamentals, MarketError, MarketState, Quote } from './types';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const yf: any = new (YahooFinance as any)({ suppressNotices: ['yahooSurvey'] });
export { yf };

const QUOTE_TYPE: Record<string, AssetClass> = {
  EQUITY: 'equity', ETF: 'etf', MUTUALFUND: 'etf', INDEX: 'index', CURRENCY: 'forex',
  CRYPTOCURRENCY: 'crypto', FUTURE: 'commodity', OPTION: 'other',
};

export function assetClassOf(quoteType: string | undefined, symbol: string): AssetClass {
  const c = QUOTE_TYPE[quoteType ?? ''];
  // Les futures non-matières (ES=F, NQ=F) restent "future", les matières premières classiques "commodity"
  if (c === 'commodity') return /^(ES|NQ|YM|RTY|ZB|ZN|ZF|ZT)=F$/.test(symbol) ? 'future' : 'commodity';
  return c ?? 'other';
}

function stateOf(s: string | undefined): MarketState {
  if (s === 'REGULAR') return 'REGULAR';
  if (s === 'PRE' || s === 'PREPRE') return s === 'PRE' ? 'PRE' : 'CLOSED';
  if (s === 'POST') return 'POST';
  return 'CLOSED'; // CLOSED, POSTPOST, inconnu
}

/* eslint-disable @typescript-eslint/no-explicit-any */
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);

function fundamentalsOf(r: any): Fundamentals {
  const post = r.marketState === 'POST' || r.marketState === 'POSTPOST' || r.marketState === 'CLOSED';
  const pre = r.marketState === 'PRE' || r.marketState === 'PREPRE';
  const extPrice = pre ? num(r.preMarketPrice) : post ? num(r.postMarketPrice) : null;
  return {
    yearHigh: num(r.fiftyTwoWeekHigh),
    yearLow: num(r.fiftyTwoWeekLow),
    avgVolume: num(r.averageDailyVolume3Month) ?? num(r.averageDailyVolume10Day),
    marketCap: num(r.marketCap),
    pe: num(r.trailingPE),
    eps: num(r.epsTrailingTwelveMonths),
    dividendYield: num(r.trailingAnnualDividendYield) != null ? num(r.trailingAnnualDividendYield)! * 100 : null,
    extPrice,
    extChangePercent: extPrice == null ? null : num(pre ? r.preMarketChangePercent : r.postMarketChangePercent),
    extLabel: extPrice == null ? null : pre ? 'Pré-marché' : 'Après-bourse',
  };
}

export function normalizeQuote(r: any, source: Quote['source']): Quote {
  const t = r.regularMarketTime instanceof Date ? r.regularMarketTime.getTime() : Number(r.regularMarketTime ?? 0) * 1000;
  return {
    symbol: r.symbol,
    name: r.longName ?? r.shortName ?? r.symbol,
    price: r.regularMarketPrice ?? 0,
    change: r.regularMarketChange ?? 0,
    changePercent: r.regularMarketChangePercent ?? 0,
    prevClose: r.regularMarketPreviousClose ?? null,
    open: r.regularMarketOpen ?? null,
    high: r.regularMarketDayHigh ?? null,
    low: r.regularMarketDayLow ?? null,
    volume: r.regularMarketVolume ?? null,
    bid: r.bid || null,
    ask: r.ask || null,
    bidSize: r.bidSize ?? null,
    askSize: r.askSize ?? null,
    fundamentals: fundamentalsOf(r),
    currency: r.currency ?? 'USD',
    exchange: r.fullExchangeName ?? r.exchange ?? '',
    assetClass: assetClassOf(r.quoteType, r.symbol),
    marketState: stateOf(r.marketState),
    delayMinutes: r.exchangeDataDelayedBy ?? 0,
    time: t || Date.now(),
    updatedAt: Date.now(),
    source,
  };
}

/** Cotations en batch (1 appel pour N symboles). Les symboles inconnus sont simplement absents. */
export async function fetchQuotes(symbols: string[], source: Quote['source'] = 'poll'): Promise<Quote[]> {
  if (!symbols.length) return [];
  const res: any[] = await yf.quote(symbols, { return: 'array' });
  return res.filter((r) => r?.symbol && r.regularMarketPrice != null).map((r) => normalizeQuote(r, source));
}

// ── Recherche (cache 10 min) ──
export interface SearchHit {
  symbol: string;
  name: string;
  exchange: string;
  type: string;
  assetClass: AssetClass;
}
const searchCache = new TtlCache<SearchHit[]>(300);

export function searchSymbols(q: string): Promise<SearchHit[]> {
  const key = q.trim().toLowerCase();
  if (!key) return Promise.resolve([]);
  return searchCache.getOrLoad(key, 10 * 60_000, async () => {
    const res = await yf.search(q, { quotesCount: 12, newsCount: 0 });
    return (res.quotes ?? [])
      .filter((x: any) => x.symbol && x.isYahooFinance !== false)
      .map((x: any) => ({
        symbol: x.symbol,
        name: x.longname ?? x.shortname ?? x.symbol,
        exchange: x.exchDisp ?? x.exchange ?? '',
        type: x.quoteType ?? '',
        assetClass: assetClassOf(x.quoteType, x.symbol),
      }));
  });
}

export function wrapYahooError(e: unknown, symbol?: string): never {
  const msg = e instanceof Error ? e.message : String(e);
  if (/not found|no data found|delisted/i.test(msg)) throw new MarketError(404, 'symbol_not_found', `Symbole introuvable : ${symbol ?? ''}`);
  if (/429|too many/i.test(msg)) throw new MarketError(503, 'rate_limited', 'Yahoo limite temporairement les requêtes, réessayez dans un instant');
  throw new MarketError(502, 'upstream_error', `Erreur Yahoo Finance : ${msg}`);
}
