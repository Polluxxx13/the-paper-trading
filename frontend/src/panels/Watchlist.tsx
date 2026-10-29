import { useCallback, useEffect, useState } from 'react';
import { api } from '../api';
import { fmtPrice } from '../market/types';
import { useQuote, useSubscription } from '../market/socket';
import StatusBadge from './StatusBadge';
import SymbolSearch from './SymbolSearch';

interface WL { id: number; name: string; symbols: string[] }

function Sparkline({ values }: { values: number[] }) {
  if (values.length < 2) return <svg width="64" height="24" />;
  const min = Math.min(...values), max = Math.max(...values);
  const pts = values.map((v, i) => `${(i / (values.length - 1)) * 64},${22 - ((v - min) / (max - min || 1)) * 20}`).join(' ');
  const up = values[values.length - 1] >= values[0];
  return (
    <svg width="64" height="24" className="shrink-0">
      <polyline points={pts} fill="none" stroke={up ? '#26a69a' : '#ef5350'} strokeWidth="1.5" />
    </svg>
  );
}

function Row({ symbol, spark, active, onSelect, onRemove }: { symbol: string; spark: number[]; active: boolean; onSelect: () => void; onRemove: () => void }) {
  const q = useQuote(symbol);
  const up = (q?.changePercent ?? 0) >= 0;
  return (
    <li onClick={onSelect} className={`group flex items-center gap-2 px-3 py-2 cursor-pointer border-b border-tv-border/50 hover:bg-tv-border/40 ${active ? 'bg-tv-border/60' : ''}`}>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5 text-sm font-medium">
          {q && <StatusBadge status={q.status} time={q.time} dotOnly />}
          <span className="truncate">{symbol}</span>
        </div>
        <div className="text-xs text-tv-muted truncate">{q?.name ?? '…'}</div>
      </div>
      <Sparkline values={spark} />
      <div className="w-20 text-right text-sm">
        <div>{q ? fmtPrice(q.price) : '–'}</div>
        <div className={up ? 'text-tv-up' : 'text-tv-down'}>{q ? `${up ? '+' : ''}${q.changePercent.toFixed(2)}%` : ''}</div>
      </div>
      <button onClick={(e) => { e.stopPropagation(); onRemove(); }} className="opacity-0 group-hover:opacity-100 text-tv-muted hover:text-tv-down text-lg leading-none" title="Retirer">×</button>
    </li>
  );
}

export default function Watchlist({ selected, onSelect }: { selected: string; onSelect: (s: string) => void }) {
  const [list, setList] = useState<WL | null>(null);
  const [spark, setSpark] = useState<Record<string, number[]>>({});
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    try {
      setList((await api<WL[]>('/api/watchlists'))[0] ?? null);
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);
  useEffect(() => { load(); }, [load]);

  const symbols = list?.symbols ?? [];
  useSubscription(symbols);

  // Mini-courbes : chargées une fois par composition de liste (cache serveur 10 min)
  const key = symbols.join(',');
  useEffect(() => {
    if (key) api<Record<string, number[]>>(`/api/market/sparklines?symbols=${encodeURIComponent(key)}`).then(setSpark).catch(() => {});
  }, [key]);

  async function add(symbol: string) {
    if (!list) return;
    await api(`/api/watchlists/${list.id}/items`, { method: 'POST', body: { symbol } }).catch((e) => setError(e.message));
    load();
  }
  async function remove(symbol: string) {
    if (!list) return;
    await api(`/api/watchlists/${list.id}/items/${encodeURIComponent(symbol)}`, { method: 'DELETE' });
    load();
  }

  return (
    <aside className="w-72 shrink-0 bg-tv-panel border-l border-tv-border flex flex-col">
      <div className="p-2 border-b border-tv-border space-y-2">
        <div className="text-xs uppercase tracking-wide text-tv-muted px-1">{list?.name ?? 'Watchlist'}</div>
        <SymbolSearch placeholder="Ajouter un symbole…" onPick={(h) => add(h.symbol)} />
      </div>
      {error && <p className="px-3 py-2 text-xs text-tv-down">{error}</p>}
      <ul className="flex-1 overflow-auto">
        {symbols.map((s) => (
          <Row key={s} symbol={s} spark={spark[s] ?? []} active={s === selected} onSelect={() => onSelect(s)} onRemove={() => remove(s)} />
        ))}
      </ul>
    </aside>
  );
}
