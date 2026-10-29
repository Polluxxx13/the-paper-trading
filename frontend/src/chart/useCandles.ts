import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../api';
import { quoteStore } from '../market/socket';
import { Candle, TIMEFRAMES, Timeframe } from '../market/types';

export type LiveListener = (newBar: boolean) => void;

export interface CandleFeed {
  /** Bougies courantes (tableau muté en place par les ticks live). Temps déjà décalés en heure locale pour l'intraday. */
  candles: React.MutableRefObject<Candle[]>;
  /** Incrémenté à chaque (re)chargement de l'historique : les graphiques se redessinent entièrement. */
  loaded: number;
  loading: boolean;
  error: string;
  intraday: boolean;
  /** Décalage appliqué aux temps (secondes) pour l'affichage en heure locale en intraday. */
  shift: number;
  tfSec: number;
  /** Abonnement aux mises à jour live : le callback reçoit `true` quand une nouvelle bougie s'ouvre. */
  subscribe: (l: LiveListener) => () => void;
}

/**
 * Source unique des bougies pour le graphique des prix et tous les panneaux d'indicateurs :
 * charge l'historique puis applique les cotations temps réel à la dernière bougie.
 */
export function useCandles(symbol: string, tf: Timeframe): CandleFeed {
  const candles = useRef<Candle[]>([]);
  const listeners = useRef(new Set<LiveListener>());
  const lastTick = useRef(0);
  const [loaded, setLoaded] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const intraday = tf !== '1d' && tf !== '1w' && tf !== '1M';
  const shift = intraday ? -new Date().getTimezoneOffset() * 60 : 0; // Lightweight Charts affiche en UTC
  const tfSec = TIMEFRAMES.find((t) => t.id === tf)!.seconds;

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError('');
    api<Candle[]>(`/api/market/history?symbol=${encodeURIComponent(symbol)}&tf=${tf}`)
      .then((raw) => {
        if (cancelled) return;
        candles.current = raw.map((c) => ({ ...c, time: c.time + shift }));
        lastTick.current = 0;
        setLoaded((n) => n + 1);
      })
      .catch((e) => { if (!cancelled) { candles.current = []; setError(e.message); setLoaded((n) => n + 1); } })
      .finally(() => !cancelled && setLoading(false));
    return () => { cancelled = true; };
  }, [symbol, tf, shift]);

  useEffect(() => {
    const apply = () => {
      const q = quoteStore.get(symbol);
      const data = candles.current;
      const last = data[data.length - 1];
      if (!q || !last || q.time <= lastTick.current) return;
      lastTick.current = q.time;
      const ts = Math.floor(q.time / 1000) + shift;
      if (ts < last.time) return;
      let newBar = false;
      if (intraday && ts >= last.time + tfSec) {
        const open = q.price;
        data.push({ time: last.time + Math.floor((ts - last.time) / tfSec) * tfSec, open, high: open, low: open, close: open, volume: 0 });
        newBar = true;
      } else {
        last.high = Math.max(last.high, q.price);
        last.low = Math.min(last.low, q.price);
        last.close = q.price;
      }
      listeners.current.forEach((l) => l(newBar));
    };
    const off = quoteStore.subscribe(symbol, apply);
    return () => { off(); };
  }, [symbol, intraday, shift, tfSec]);

  const subscribe = useCallback((l: LiveListener) => {
    listeners.current.add(l);
    return () => { listeners.current.delete(l); };
  }, []);

  return { candles, loaded, loading, error, intraday, shift, tfSec, subscribe };
}
