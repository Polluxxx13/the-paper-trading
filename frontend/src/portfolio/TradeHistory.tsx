import { useEffect, useState } from 'react';
import { api } from '../api';
import { fmtPrice } from '../market/types';

interface Tx { id: number; symbol: string; side: 'buy' | 'sell'; quantity: number; price: number; currency: string; fees: number; realizedPnl: number; isClose: boolean; executedAt: string }

const PAGE = 20;

/** Historique complet des transactions : filtres (symbole, sens, dates), pagination, export CSV. */
export default function TradeHistory({ slug, currency, refreshKey }: { slug: string; currency: string; refreshKey: number }) {
  const [symbol, setSymbol] = useState('');
  const [side, setSide] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [page, setPage] = useState(0);
  const [data, setData] = useState<{ total: number; rows: Tx[] }>({ total: 0, rows: [] });

  const qs = (extra = '') => {
    const p = new URLSearchParams();
    if (symbol.trim()) p.set('symbol', symbol.trim());
    if (side) p.set('side', side);
    if (from) p.set('from', from);
    if (to) p.set('to', to);
    return `${p.toString()}${extra}`;
  };

  useEffect(() => setPage(0), [symbol, side, from, to]);
  useEffect(() => {
    api<{ total: number; rows: Tx[] }>(`/api/accounts/${slug}/transactions?${qs(`&limit=${PAGE}&offset=${page * PAGE}`)}`).then(setData).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slug, symbol, side, from, to, page, refreshKey]);

  const money = (n: number) => n.toLocaleString('fr-CH', { style: 'currency', currency });
  const input = 'bg-tv-bg border border-tv-border rounded px-2 py-1 text-sm outline-none focus:border-tv-blue';
  const pages = Math.max(1, Math.ceil(data.total / PAGE));

  return (
    <div className="bg-tv-panel border border-tv-border rounded-lg">
      <div className="flex flex-wrap items-center gap-2 p-3 border-b border-tv-border">
        <span className="text-sm font-medium mr-2">Historique des transactions ({data.total})</span>
        <input placeholder="Symbole" value={symbol} onChange={(e) => setSymbol(e.target.value)} className={`${input} w-28`} />
        <select value={side} onChange={(e) => setSide(e.target.value)} className={input}>
          <option value="">Achats + ventes</option><option value="buy">Achats</option><option value="sell">Ventes</option>
        </select>
        <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className={input} title="Depuis" />
        <input type="date" value={to} onChange={(e) => setTo(e.target.value)} className={input} title="Jusqu'au" />
        <a href={`/api/accounts/${slug}/transactions.csv?${qs()}`} className="ml-auto px-3 py-1 rounded border border-tv-border text-sm hover:border-tv-blue" download>Exporter en CSV</a>
      </div>
      <div className="overflow-auto">
        <table className="w-full text-sm">
          <thead><tr className="text-tv-muted text-left">{['Date', 'Symbole', 'Sens', 'Qté', 'Prix', 'Frais', 'P&L réalisé'].map((h) => <th key={h} className="font-normal px-3 py-1.5 whitespace-nowrap">{h}</th>)}</tr></thead>
          <tbody>
            {data.rows.map((t) => (
              <tr key={t.id} className="border-t border-tv-border/50">
                <td className="px-3 py-1.5 whitespace-nowrap">{new Date(t.executedAt).toLocaleString('fr-CH')}</td>
                <td className="px-3 py-1.5 font-medium">{t.symbol}</td>
                <td className={`px-3 py-1.5 ${t.side === 'buy' ? 'text-tv-up' : 'text-tv-down'}`}>{t.side === 'buy' ? 'Achat' : 'Vente'}</td>
                <td className="px-3 py-1.5">{t.quantity}</td>
                <td className="px-3 py-1.5 whitespace-nowrap">{fmtPrice(t.price)} {t.currency}</td>
                <td className="px-3 py-1.5">{t.fees ? money(t.fees) : '–'}</td>
                <td className={`px-3 py-1.5 ${t.realizedPnl >= 0 ? 'text-tv-up' : 'text-tv-down'}`}>{t.isClose || t.realizedPnl ? money(t.realizedPnl) : '–'}</td>
              </tr>
            ))}
            {!data.rows.length && <tr><td className="px-3 py-3 text-tv-muted" colSpan={7}>Aucune transaction.</td></tr>}
          </tbody>
        </table>
      </div>
      {pages > 1 && (
        <div className="flex items-center justify-end gap-2 p-2 text-sm text-tv-muted">
          <button disabled={page === 0} onClick={() => setPage(page - 1)} className="px-2 py-0.5 border border-tv-border rounded disabled:opacity-40">‹</button>
          Page {page + 1} / {pages}
          <button disabled={page + 1 >= pages} onClick={() => setPage(page + 1)} className="px-2 py-0.5 border border-tv-border rounded disabled:opacity-40">›</button>
        </div>
      )}
    </div>
  );
}
