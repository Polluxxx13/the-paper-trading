import { useCallback, useEffect, useState } from 'react';
import { api } from '../api';

interface NewsItem {
  id: string;
  title: string;
  publisher: string;
  link: string;
  time: number;
  image: string | null;
  related: string[];
}

const REFRESH_MS = 30 * 60_000;

function ago(ms: number): string {
  const min = Math.max(0, Math.round((Date.now() - ms) / 60_000));
  if (min < 60) return `il y a ${min} min`;
  if (min < 1440) return `il y a ${Math.round(min / 60)} h`;
  return new Date(ms).toLocaleDateString('fr-CH', { day: 'numeric', month: 'short', year: 'numeric' });
}

/** Actualités du symbole affiché, avec images ; rechargées toutes les 30 min et à chaque changement de symbole. */
export default function NewsPanel({ symbol }: { symbol: string }) {
  const [items, setItems] = useState<NewsItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loadedAt, setLoadedAt] = useState<number | null>(null);

  const load = useCallback(async () => {
    try {
      setItems(await api<NewsItem[]>(`/api/market/news?symbol=${encodeURIComponent(symbol)}`));
      setError(null);
      setLoadedAt(Date.now());
    } catch (e) {
      setError((e as Error).message);
    }
  }, [symbol]);

  useEffect(() => {
    setItems(null);
    void load();
    const t = setInterval(load, REFRESH_MS);
    return () => clearInterval(t);
  }, [load]);

  if (error && !items) return <div className="p-3 text-sm text-tv-down">Actualités indisponibles : {error}</div>;
  if (!items) return <div className="p-3 text-sm text-tv-muted">Chargement des actualités…</div>;

  return (
    <div className="p-2">
      <div className="flex items-center justify-between px-1 pb-2 text-xs text-tv-muted">
        <span>{items.length} actualités · {symbol}{loadedAt ? ` · mis à jour à ${new Date(loadedAt).toLocaleTimeString('fr-CH', { hour: '2-digit', minute: '2-digit' })}` : ''}</span>
        <button onClick={load} className="px-2 py-0.5 rounded border border-tv-border hover:text-tv-text">Actualiser</button>
      </div>
      {!items.length && <div className="p-2 text-sm text-tv-muted">Aucune actualité récente pour ce symbole.</div>}
      <div className="grid gap-2 grid-cols-[repeat(auto-fill,minmax(260px,1fr))]">
        {items.map((n) => (
          <a key={n.id} href={n.link} target="_blank" rel="noopener noreferrer" className="flex gap-3 p-2 rounded border border-tv-border hover:border-tv-blue">
            {n.image ? (
              <img src={n.image} alt="" loading="lazy" referrerPolicy="no-referrer" className="w-24 h-16 object-cover rounded shrink-0 bg-tv-border"
                onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = 'none'; }} />
            ) : (
              <div className="w-24 h-16 rounded shrink-0 bg-tv-border grid place-items-center text-tv-muted text-xs">Pas d'image</div>
            )}
            <div className="min-w-0">
              <div className="text-sm leading-snug line-clamp-3">{n.title}</div>
              <div className="text-xs text-tv-muted mt-1 truncate">{n.publisher} · {ago(n.time)}</div>
            </div>
          </a>
        ))}
      </div>
    </div>
  );
}
