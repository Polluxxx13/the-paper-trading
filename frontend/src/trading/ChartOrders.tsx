import { useRef, useState } from 'react';
import { api } from '../api';
import type { Account } from '../api';
import type { ChartHandle } from '../chart/useViewTick';
import { useViewTick } from '../chart/useViewTick';
import { fmtPrice } from '../market/types';
import { useQuoteTick } from './useQuoteTick';
import { Order, Position, livePnl } from './useAccount';

const TYPE_LABEL: Record<string, string> = { limit: 'LIMITE', stop: 'STOP', stop_limit: 'STOP-LIM', take_profit: 'TP', stop_loss: 'SL', trailing_stop: 'TRAIL' };

/** Prix affiché/déplaçable d'un ordre (null = non représentable par une ligne). */
export function orderLevel(o: Order): { price: number; field: 'limitPrice' | 'stopPrice' } | null {
  if (o.type === 'limit' || o.type === 'take_profit') return o.limitPrice ? { price: o.limitPrice, field: 'limitPrice' } : null;
  if (o.type === 'stop' || o.type === 'stop_loss' || o.type === 'stop_limit') return o.stopPrice ? { price: o.stopPrice, field: 'stopPrice' } : null;
  return null; // trailing : le niveau bouge tout seul
}

interface Props {
  handle: ChartHandle | null;
  account: Account;
  symbol: string;
  orders: Order[];
  positions: Position[];
  onChanged: () => void;
  onError: (msg: string) => void;
}

function PositionLine({ p, y, width, onClose }: { p: Position; y: number; width: number; onClose: () => void }) {
  useQuoteTick(p.symbol);
  const l = livePnl(p);
  const long = p.quantity > 0;
  const color = l.pnl >= 0 ? '#26a69a' : '#ef5350';
  return (
    <div className="absolute left-0" style={{ top: y, width }}>
      <div className="absolute left-0 right-0 border-t border-dashed" style={{ borderColor: color }} />
      <div className="absolute right-2 -translate-y-1/2 flex items-center text-xs rounded overflow-hidden pointer-events-auto" style={{ background: color }}>
        <span className="px-1.5 py-0.5 text-white font-medium">{long ? 'LONG' : 'SHORT'} {Math.abs(p.quantity)} @ {fmtPrice(p.avgPrice)} · {l.pnl >= 0 ? '+' : ''}{l.pnl.toFixed(2)} ({l.pct.toFixed(2)}%)</span>
        <button onClick={onClose} className="px-1.5 py-0.5 bg-black/30 hover:bg-black/50 text-white" title="Fermer la position au marché">Fermer</button>
      </div>
    </div>
  );
}

/**
 * Ordres en attente et position du symbole, tracés comme lignes horizontales sur le graphique.
 * Faire glisser une ligne verticalement modifie le prix de l'ordre (TP, SL, limite, stop) ; × l'annule.
 */
export default function ChartOrders({ handle, account, symbol, orders, positions, onChanged, onError }: Props) {
  useViewTick(handle);
  const [dragId, setDragId] = useState<number | null>(null);
  const [dragY, setDragY] = useState(0);
  const box = useRef<HTMLDivElement>(null);
  const series = handle?.series();
  if (!handle || !series) return <div ref={box} className="absolute inset-0 pointer-events-none z-10" />;

  const plotW = (box.current?.clientWidth ?? 0) - handle.chart.priceScale('right').width();
  const plotH = (box.current?.clientHeight ?? 0) - handle.chart.timeScale().height();
  const mine = orders.filter((o) => o.symbol === symbol && (o.status === 'working' || o.status === 'pending'));
  const pos = positions.find((p) => p.symbol === symbol);
  const yOf = (price: number) => series.priceToCoordinate(price);

  async function patch(o: Order, field: 'limitPrice' | 'stopPrice', price: number) {
    try {
      await api(`/api/accounts/${account.slug}/orders/${o.id}`, { method: 'PATCH', body: { [field]: Number(price.toPrecision(10)) } });
    } catch (e) { onError((e as Error).message); }
    onChanged();
  }
  async function cancel(o: Order) {
    try { await api(`/api/accounts/${account.slug}/orders/${o.id}`, { method: 'DELETE' }); } catch (e) { onError((e as Error).message); }
    onChanged();
  }
  async function closePos() {
    try { await api(`/api/accounts/${account.slug}/positions/${encodeURIComponent(symbol)}/close`, { method: 'POST' }); } catch (e) { onError((e as Error).message); }
    onChanged();
  }

  function startDrag(e: React.PointerEvent, o: Order, field: 'limitPrice' | 'stopPrice') {
    e.preventDefault();
    const el = e.currentTarget as HTMLElement;
    el.setPointerCapture(e.pointerId);
    const top = box.current!.getBoundingClientRect().top;
    setDragId(o.id);
    const move = (ev: PointerEvent) => setDragY(Math.max(0, Math.min(plotH, ev.clientY - top)));
    const up = (ev: PointerEvent) => {
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerup', up);
      const price = series!.coordinateToPrice(Math.max(0, Math.min(plotH, ev.clientY - top)));
      setDragId(null);
      if (price !== null) void patch(o, field, price as number);
    };
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up);
    move(e.nativeEvent);
  }

  return (
    <div ref={box} className="absolute inset-0 pointer-events-none z-10 overflow-hidden">
      <div className="absolute top-0 left-0" style={{ width: Math.max(0, plotW), height: Math.max(0, plotH) }}>
        {pos && yOf(pos.avgPrice) !== null && <PositionLine p={pos} y={yOf(pos.avgPrice)!} width={plotW} onClose={closePos} />}
        {mine.map((o) => {
          const lv = orderLevel(o);
          if (!lv) return null;
          const y = dragId === o.id ? dragY : yOf(lv.price);
          if (y === null || y < 0 || y > plotH) return null;
          const exit = o.type === 'take_profit' ? '#26a69a' : o.type === 'stop_loss' ? '#ef5350' : o.side === 'buy' ? '#2962ff' : '#ff9800';
          const shown = dragId === o.id ? series.coordinateToPrice(dragY) : lv.price;
          return (
            <div key={o.id} className="absolute left-0" style={{ top: y, width: plotW, opacity: o.status === 'pending' ? 0.6 : 1 }}>
              <div className="absolute left-0 right-0 border-t border-dashed" style={{ borderColor: exit }} />
              <div className="absolute left-16 -translate-y-1/2 flex items-center text-xs rounded overflow-hidden pointer-events-auto cursor-ns-resize select-none" style={{ background: exit }}
                onPointerDown={(e) => startDrag(e, o, lv.field)} title="Glisser pour modifier le prix">
                <span className="px-1.5 py-0.5 text-white font-medium">{TYPE_LABEL[o.type] ?? o.type} {o.side === 'buy' ? 'ACHAT' : 'VENTE'} {o.quantity} @ {shown !== null ? fmtPrice(shown as number) : ''}</span>
                <button onPointerDown={(e) => e.stopPropagation()} onClick={() => cancel(o)} className="px-1.5 py-0.5 bg-black/30 hover:bg-black/50 text-white" title="Annuler l'ordre">✕</button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
