import { fmtPrice } from '../market/types';
import { useQuote } from '../market/socket';
import { orderLevel } from './ChartOrders';
import type { Order } from './useAccount';

/**
 * Carnet simplifié : meilleur vendeur / dernier prix / meilleur acheteur (indicatifs, fournis par Yahoo) et,
 * sur la même échelle de prix, VOS ordres en attente. Yahoo ne donne pas la profondeur réelle du marché :
 * ce n'est pas un carnet complet, mais il montre où se situent vos ordres par rapport au marché.
 */
export default function OrderBook({ symbol, orders }: { symbol: string; orders: Order[] }) {
  const q = useQuote(symbol);
  if (!q) return <div className="p-3 text-sm text-tv-muted">En attente de cotation…</div>;

  type Row = { price: number; kind: 'ask' | 'last' | 'bid' | 'order'; label: string; size?: number | null; color: string };
  const rows: Row[] = [{ price: q.price, kind: 'last', label: 'Dernier', color: '#d1d4dc' }];
  if (q.ask) rows.push({ price: q.ask, kind: 'ask', label: 'Vendeur (ask)', size: q.askSize, color: '#ef5350' });
  if (q.bid) rows.push({ price: q.bid, kind: 'bid', label: 'Acheteur (bid)', size: q.bidSize, color: '#26a69a' });
  for (const o of orders) {
    if (o.symbol !== symbol || (o.status !== 'working' && o.status !== 'pending')) continue;
    const lv = orderLevel(o);
    if (lv) rows.push({ price: lv.price, kind: 'order', label: `${o.type.replace('_', '-')} ${o.side === 'buy' ? 'achat' : 'vente'} ${o.quantity}${o.status === 'pending' ? ' (lié)' : ''}`, color: o.side === 'buy' ? '#2962ff' : '#ff9800' });
  }
  rows.sort((a, b) => b.price - a.price);
  const spread = q.ask && q.bid ? q.ask - q.bid : null;

  return (
    <div className="p-3 max-w-xl text-sm">
      <div className="flex gap-4 mb-2 text-xs text-tv-muted">
        <span>Écart acheteur/vendeur : <b className="text-tv-text">{spread !== null ? fmtPrice(spread) : 'n/d'}</b></span>
        <span>Niveaux indicatifs (Yahoo, rafraîchis périodiquement) · pas de profondeur de marché réelle</span>
      </div>
      <table className="w-full">
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} className={r.kind === 'last' ? 'bg-tv-border/40' : ''}>
              <td className="py-1 pr-3 text-right font-mono" style={{ color: r.color }}>{fmtPrice(r.price)}</td>
              <td className="py-1 pr-3" style={{ color: r.color }}>{r.label}</td>
              <td className="py-1 text-tv-muted text-right">{r.size ? r.size.toLocaleString('fr-CH') : ''}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
