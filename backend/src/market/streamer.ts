import { EventEmitter } from 'node:events';
import protobuf from 'protobufjs';
import WebSocket from 'ws';

/** Schéma protobuf du flux Yahoo (PricingData). Seuls les champs utiles sont lus ; les autres sont ignorés. */
const PROTO = `
syntax = "proto3";
message PricingData {
  string id = 1;
  float price = 2;
  sint64 time = 3;
  string currency = 4;
  string exchange = 5;
  int32 quoteType = 6;
  int32 marketHours = 7;
  float changePercent = 8;
  sint64 dayVolume = 9;
  float dayHigh = 10;
  float dayLow = 11;
  float change = 12;
  string shortName = 13;
  float openPrice = 15;
  float previousClose = 16;
}`;
const PricingData = protobuf.parse(PROTO).root.lookupType('PricingData');

export interface Tick {
  symbol: string;
  price: number;
  time: number; // ms
  change: number;
  changePercent: number;
  dayVolume: number | null;
  dayHigh: number | null;
  dayLow: number | null;
  marketHours: number; // 0 PRE, 1 REGULAR, 2 POST, 3 EXTENDED
}

const URL = 'wss://streamer.finance.yahoo.com/?version=2';

/**
 * Client WebSocket Yahoo avec reconnexion (backoff exponentiel) et re-souscription automatique.
 * Événements : 'tick' (Tick), 'open', 'close'.
 */
export class YahooStreamer extends EventEmitter {
  private ws: WebSocket | null = null;
  private symbols = new Set<string>();
  private backoff = 1000;
  private stopped = false;
  private timer?: NodeJS.Timeout;
  lastMessageAt = 0;

  get connected() {
    return this.ws?.readyState === WebSocket.OPEN;
  }

  start() {
    this.stopped = false;
    this.connect();
  }

  stop() {
    this.stopped = true;
    clearTimeout(this.timer);
    this.ws?.close();
  }

  setSymbols(next: Set<string>) {
    const added = [...next].filter((s) => !this.symbols.has(s));
    const removed = [...this.symbols].filter((s) => !next.has(s));
    this.symbols = new Set(next);
    if (this.connected) {
      if (added.length) this.ws!.send(JSON.stringify({ subscribe: added }));
      if (removed.length) this.ws!.send(JSON.stringify({ unsubscribe: removed }));
    }
  }

  private connect() {
    if (this.stopped) return;
    const ws = new WebSocket(URL, { headers: { Origin: 'https://finance.yahoo.com', 'User-Agent': 'Mozilla/5.0' } });
    this.ws = ws;

    ws.on('open', () => {
      this.backoff = 1000;
      this.lastMessageAt = Date.now();
      if (this.symbols.size) ws.send(JSON.stringify({ subscribe: [...this.symbols] }));
      this.emit('open');
    });

    ws.on('message', (raw) => {
      this.lastMessageAt = Date.now();
      try {
        const { message } = JSON.parse(raw.toString());
        if (!message) return;
        const d = PricingData.toObject(PricingData.decode(Buffer.from(message, 'base64')), { longs: Number }) as Record<string, number | string>;
        if (!d.id || !d.price) return;
        const tick: Tick = {
          symbol: String(d.id),
          price: Number(d.price),
          time: d.time ? Number(d.time) : Date.now(),
          change: Number(d.change ?? 0),
          changePercent: Number(d.changePercent ?? 0),
          dayVolume: d.dayVolume != null ? Number(d.dayVolume) : null,
          dayHigh: d.dayHigh ? Number(d.dayHigh) : null,
          dayLow: d.dayLow ? Number(d.dayLow) : null,
          marketHours: Number(d.marketHours ?? 1),
        };
        this.emit('tick', tick);
      } catch {
        /* message illisible : ignoré */
      }
    });

    const retry = () => {
      this.emit('close');
      if (this.stopped) return;
      this.timer = setTimeout(() => this.connect(), this.backoff);
      this.backoff = Math.min(this.backoff * 2, 30_000);
    };
    ws.on('close', retry);
    ws.on('error', () => ws.terminate()); // déclenche 'close' -> retry
  }
}
