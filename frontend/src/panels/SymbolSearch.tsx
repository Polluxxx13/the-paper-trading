import { useEffect, useRef, useState } from 'react';
import { api } from '../api';
import type { SearchHit } from '../market/types';

/** Recherche universelle (symbole ou nom) avec liste déroulante. */
export default function SymbolSearch({ onPick, placeholder = 'Rechercher un symbole…' }: { onPick: (s: SearchHit) => void; placeholder?: string }) {
  const [q, setQ] = useState('');
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [open, setOpen] = useState(false);
  const [error, setError] = useState('');
  const seq = useRef(0);

  useEffect(() => {
    if (!q.trim()) return setHits([]);
    const id = ++seq.current;
    const t = setTimeout(() => {
      api<SearchHit[]>(`/api/market/search?q=${encodeURIComponent(q)}`)
        .then((r) => id === seq.current && (setHits(r), setError('')))
        .catch((e) => id === seq.current && setError(e.message));
    }, 250); // anti-rebond
    return () => clearTimeout(t);
  }, [q]);

  function pick(h: SearchHit) {
    onPick(h);
    setQ('');
    setHits([]);
    setOpen(false);
  }

  return (
    <div className="relative">
      <input
        data-symbol-search={placeholder.startsWith('Rechercher') ? '' : undefined}
        value={q}
        onChange={(e) => { setQ(e.target.value); setOpen(true); }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        onKeyDown={(e) => e.key === 'Enter' && hits[0] && pick(hits[0])}
        placeholder={placeholder}
        className="w-full bg-tv-bg border border-tv-border rounded px-3 py-1.5 text-sm outline-none focus:border-tv-blue"
      />
      {open && (hits.length > 0 || error) && (
        <ul className="absolute z-20 mt-1 w-80 max-h-80 overflow-auto bg-tv-panel border border-tv-border rounded shadow-xl">
          {error && <li className="px-3 py-2 text-sm text-tv-down">{error}</li>}
          {hits.map((h) => (
            <li key={h.symbol} onMouseDown={() => pick(h)} className="px-3 py-2 text-sm cursor-pointer hover:bg-tv-border flex items-baseline gap-2">
              <b className="shrink-0">{h.symbol}</b>
              <span className="text-tv-muted truncate">{h.name}</span>
              <span className="ml-auto text-xs text-tv-muted shrink-0">{h.exchange}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
