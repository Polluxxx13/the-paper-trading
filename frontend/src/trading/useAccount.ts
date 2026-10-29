import { useCallback, useEffect, useState } from 'react';
import { api } from '../api';
import { onTrade, quoteStore } from '../market/socket';
import { useSyncExternalStore } from 'react';

export interface Position {
  symbol: string;
  name: string;
  assetClass: string;
  currency: string;
  quantity: number;
  avgPrice: number;
  avgFxRate: number;
  price: number;
  fx: number;
}

export interface Order {
  id: number;
  symbol: string;
  side: 'buy' | 'sell';
  type: string;
  quantity: number;
  limitPrice: number | null;
  stopPrice: number | null;
  trailAmount: number | null;
  trailPercent: number | null;
  status: string;
  parentOrderId: number | null;
  rejectReason: string | null;
  createdAt: string;
}

export interface Transaction {
  id: number;
  symbol: string;
  side: 'buy' | 'sell';
  quantity: number;
  price: number;
  currency: string;
  fees: number;
  realizedPnl: number;
  executedAt: string;
}

/** Valorisation d'une position au dernier prix reçu en direct (repli : prix du chargement). */
export function livePnl(p: Position) {
  const price = quoteStore.get(p.symbol)?.price ?? p.price;
  const marketValue = p.quantity * price * p.fx;
  const cost = p.quantity * p.avgPrice * p.avgFxRate;
  return { price, marketValue, pnl: marketValue - cost, pct: cost !== 0 ? ((marketValue - cost) / Math.abs(cost)) * 100 : 0 };
}

export type AccountData = ReturnType<typeof useAccountData>;

/**
 * Données du compte actif (cash, positions, ordres, transactions). Rechargées à chaque événement
 * 'trade' du serveur (fill, annulation...) et toutes les 30 s ; le P&L, lui, est recalculé en direct côté navigateur.
 */
export function useAccountData(slug: string) {
  const [cash, setCash] = useState(0);
  const [positions, setPositions] = useState<Position[]>([]);
  const [orders, setOrders] = useState<Order[]>([]);
  const [transactions, setTransactions] = useState<Transaction[]>([]);

  const reload = useCallback(async () => {
    const base = `/api/accounts/${slug}`;
    const [s, p, o, t] = await Promise.all([
      api<{ cash: number }>(`${base}/summary`),
      api<Position[]>(`${base}/positions`),
      api<Order[]>(`${base}/orders?status=all`),
      api<{ rows: Transaction[] }>(`${base}/transactions?limit=100`),
    ]);
    setCash(s.cash); setPositions(p); setOrders(o); setTransactions(t.rows);
  }, [slug]);

  useEffect(() => {
    reload().catch(() => {});
    const off = onTrade((acc) => acc === slug && reload().catch(() => {}));
    const t = setInterval(() => reload().catch(() => {}), 30_000);
    return () => { off(); clearInterval(t); };
  }, [slug, reload]);

  return { cash, positions, orders, transactions, reload };
}

/** Re-rendu à chaque tick des symboles détenus (pour l'équité live). */
export function useEquity(cash: number, positions: Position[]) {
  const key = positions.map((p) => p.symbol).join('|');
  const version = useSyncExternalStore(
    (l) => {
      const offs = positions.map((p) => quoteStore.subscribe(p.symbol, l));
      return () => offs.forEach((o) => o());
    },
    () => positions.reduce((s, p) => s + (quoteStore.get(p.symbol)?.price ?? 0), 0) + key.length,
  );
  void version;
  return cash + positions.reduce((s, p) => s + livePnl(p).marketValue, 0);
}
