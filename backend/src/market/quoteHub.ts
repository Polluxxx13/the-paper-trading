import { EventEmitter } from 'node:events';
import { FeedStatus, MarketError, MarketState, Quote } from './types';
import { Tick, YahooStreamer } from './streamer';
import { fetchQuotes } from './yahoo';

const STREAM_STALE_MS = 15_000; // flux "muet" alors qu'un marché est ouvert -> repli
const FAST_POLL_MS = 1_500; // sondage en mode repli
const META_POLL_MS = 30_000; // rafraîchit marketState / retards même quand le flux marche
const LIVE_MAX_AGE_MS = 5_000;

const HOURS_TO_STATE: MarketState[] = ['PRE', 'REGULAR', 'POST', 'POST'];

/** Statut affiché : Live / Différé / Marché fermé. */
export function statusOf(q: Quote, now = Date.now()): FeedStatus {
  if (q.marketState === 'CLOSED') return 'closed';
  if (q.delayMinutes > 0) return 'delayed';
  return now - q.updatedAt <= LIVE_MAX_AGE_MS ? 'live' : 'delayed';
}

/**
 * Source unique des prix du serveur. Les clients WebSocket ET le moteur d'ordres (module 4)
 * s'y abonnent via l'événement 'quote'. Les symboles sont comptés par référence (retain/release).
 *
 * Mode normal : flux Yahoo. Mode repli : sondage toutes les 1,5 s dès que le flux est coupé
 * ou muet alors qu'un marché ouvert est suivi. Les requêtes Yahoo sont groupées en un seul appel.
 */
export class QuoteHub extends EventEmitter {
  private quotes = new Map<string, Quote>();
  private refs = new Map<string, number>();
  private streamer = new YahooStreamer();
  private fastTimer?: NodeJS.Timeout;
  private metaTimer?: NodeJS.Timeout;
  private polling = false;
  mode: 'stream' | 'polling' = 'polling';

  start() {
    this.streamer.on('tick', (t: Tick) => this.onTick(t));
    this.streamer.on('open', () => this.evaluateMode());
    this.streamer.on('close', () => this.evaluateMode());
    this.streamer.start();
    this.metaTimer = setInterval(() => void this.poll(), META_POLL_MS);
    this.fastTimer = setInterval(() => {
      this.evaluateMode();
      if (this.mode === 'polling') void this.poll();
    }, FAST_POLL_MS);
  }

  stop() {
    clearInterval(this.metaTimer);
    clearInterval(this.fastTimer);
    this.streamer.stop();
  }

  health() {
    return {
      mode: this.mode,
      streamConnected: this.streamer.connected,
      lastStreamMessageAgeMs: this.streamer.lastMessageAt ? Date.now() - this.streamer.lastMessageAt : null,
      symbols: this.refs.size,
    };
  }

  /** Dernière cotation connue (sans appel réseau). */
  peek(symbol: string): Quote | undefined {
    return this.quotes.get(symbol);
  }

  /** Cotation fraîche : retourne le cache hub si récent, sinon interroge Yahoo. Lève symbol_not_found. */
  async getQuote(symbol: string): Promise<Quote> {
    const known = this.quotes.get(symbol);
    if (known && Date.now() - known.updatedAt < 2_000) return known;
    const [q] = await fetchQuotes([symbol]);
    if (!q) throw new MarketError(404, 'symbol_not_found', `Symbole introuvable : ${symbol}`);
    this.merge(q);
    return this.quotes.get(symbol)!;
  }

  retain(symbol: string) {
    this.refs.set(symbol, (this.refs.get(symbol) ?? 0) + 1);
    if (this.refs.get(symbol) === 1) this.streamer.setSymbols(new Set(this.refs.keys()));
  }

  release(symbol: string) {
    const n = (this.refs.get(symbol) ?? 0) - 1;
    if (n > 0) return void this.refs.set(symbol, n);
    this.refs.delete(symbol);
    this.streamer.setSymbols(new Set(this.refs.keys()));
  }

  // ── interne ──
  private evaluateMode() {
    const now = Date.now();
    const anyOpen = [...this.refs.keys()].some((s) => (this.quotes.get(s)?.marketState ?? 'REGULAR') !== 'CLOSED');
    const silent = this.streamer.connected && anyOpen && this.refs.size > 0 && now - this.streamer.lastMessageAt > STREAM_STALE_MS;
    this.mode = this.streamer.connected && !silent ? 'stream' : 'polling';
  }

  private onTick(t: Tick) {
    const prev = this.quotes.get(t.symbol);
    if (!prev) return; // snapshot initial pas encore reçu : le sondage méta le fournira
    this.merge({
      ...prev,
      price: t.price,
      change: t.change || t.price - (prev.prevClose ?? t.price),
      changePercent: t.changePercent || prev.changePercent,
      volume: t.dayVolume ?? prev.volume,
      high: t.dayHigh ?? prev.high,
      low: t.dayLow ?? prev.low,
      marketState: HOURS_TO_STATE[t.marketHours] ?? prev.marketState,
      time: t.time,
      updatedAt: Date.now(),
      source: 'stream',
    });
  }

  private merge(q: Quote) {
    this.quotes.set(q.symbol, q);
    this.emit('quote', q);
  }

  private async poll() {
    const symbols = [...this.refs.keys()];
    if (this.polling || !symbols.length) return;
    this.polling = true;
    try {
      for (let i = 0; i < symbols.length; i += 50) {
        for (const q of await fetchQuotes(symbols.slice(i, i + 50))) {
          // En mode flux, le sondage méta ne doit pas écraser un prix plus récent venu du stream
          const cur = this.quotes.get(q.symbol);
          if (this.mode === 'stream' && cur && cur.source === 'stream' && cur.time > q.time) {
            this.quotes.set(q.symbol, { ...cur, marketState: q.marketState, delayMinutes: q.delayMinutes, name: q.name, prevClose: q.prevClose, open: q.open, bid: q.bid, ask: q.ask, bidSize: q.bidSize, askSize: q.askSize, fundamentals: q.fundamentals });
          } else this.merge(q);
        }
      }
    } catch (e) {
      console.warn('[quoteHub] polling échoué :', (e as Error).message);
    } finally {
      this.polling = false;
    }
  }
}

export const hub = new QuoteHub();
