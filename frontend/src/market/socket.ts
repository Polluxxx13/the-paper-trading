import { useEffect, useSyncExternalStore } from 'react';
import type { Quote } from './types';

/** Store de cotations (par symbole) alimenté par le WebSocket, lu par les composants. */
type Listener = () => void;
const quotes = new Map<string, Quote>();
const listeners = new Map<string, Set<Listener>>();

export const quoteStore = {
  get: (s: string) => quotes.get(s),
  set(q: Quote) {
    quotes.set(q.symbol, q);
    listeners.get(q.symbol)?.forEach((l) => l());
  },
  subscribe(s: string, l: Listener) {
    if (!listeners.has(s)) listeners.set(s, new Set());
    listeners.get(s)!.add(l);
    return () => listeners.get(s)?.delete(l);
  },
};

export function useQuote(symbol: string | undefined): Quote | undefined {
  return useSyncExternalStore(
    (l) => (symbol ? quoteStore.subscribe(symbol, l) : () => {}),
    () => (symbol ? quoteStore.get(symbol) : undefined),
  );
}

export interface FeedMode {
  connected: boolean; // WebSocket navigateur <-> serveur
  mode: 'stream' | 'polling' | null; // flux Yahoo ou repli côté serveur
}
let feed: FeedMode = { connected: false, mode: null };
const feedListeners = new Set<Listener>();
const setFeed = (f: FeedMode) => {
  feed = f;
  feedListeners.forEach((l) => l());
};
export const useFeedMode = () =>
  useSyncExternalStore((l) => (feedListeners.add(l), () => feedListeners.delete(l)), () => feed);

// Événements de trading poussés par le serveur (fill, annulation...) : { account: 'main' | 'test' }
const tradeListeners = new Set<(account: string) => void>();
export function onTrade(l: (account: string) => void) {
  tradeListeners.add(l);
  return () => { tradeListeners.delete(l); };
}

// ── Connexion unique, reconnexion automatique, souscriptions comptées par référence ──
const refs = new Map<string, number>();
let ws: WebSocket | null = null;
let backoff = 1000;

function send(o: unknown) {
  if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify(o));
}

function connect() {
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  ws = new WebSocket(`${proto}://${location.host}/ws`);
  ws.onopen = () => {
    backoff = 1000;
    setFeed({ ...feed, connected: true });
    if (refs.size) send({ type: 'subscribe', symbols: [...refs.keys()] });
  };
  ws.onmessage = (e) => {
    const m = JSON.parse(e.data);
    if (m.type === 'quote') quoteStore.set(m.quote);
    else if (m.type === 'mode') setFeed({ connected: true, mode: m.mode });
    else if (m.type === 'trade') tradeListeners.forEach((l) => l(m.account));
  };
  ws.onclose = () => {
    setFeed({ connected: false, mode: null });
    setTimeout(connect, backoff);
    backoff = Math.min(backoff * 2, 15000);
  };
}

export function startSocket() {
  if (!ws) connect();
}

function retain(s: string) {
  refs.set(s, (refs.get(s) ?? 0) + 1);
  if (refs.get(s) === 1) send({ type: 'subscribe', symbols: [s] });
}
function release(s: string) {
  const n = (refs.get(s) ?? 0) - 1;
  if (n > 0) return void refs.set(s, n);
  refs.delete(s);
  send({ type: 'unsubscribe', symbols: [s] });
}

/** S'abonne aux cotations temps réel tant que le composant est monté. */
export function useSubscription(symbols: string[]) {
  const key = symbols.join('|');
  useEffect(() => {
    const list = key ? key.split('|') : [];
    list.forEach(retain);
    return () => list.forEach(release);
  }, [key]);
}
