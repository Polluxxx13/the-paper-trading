import { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '../../api';
import type { Anchor, Drawing, Style, ToolId } from './model';

export interface DrawingsApi {
  drawings: Drawing[];
  create: (tool: ToolId, anchors: Anchor[], style: Style) => Promise<Drawing | null>;
  update: (id: string, patch: { anchors?: Anchor[]; style?: Style }) => void;
  remove: (id: string) => void;
  clear: () => void;
  error: string;
}

/** Dessins d'un symbole, chargés depuis le serveur ; les modifications sont appliquées tout de suite puis sauvegardées. */
export function useDrawings(symbol: string): DrawingsApi {
  const [drawings, setDrawings] = useState<Drawing[]>([]);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    setDrawings([]);
    api<Drawing[]>(`/api/drawings?symbol=${encodeURIComponent(symbol)}`)
      .then((d) => { if (!cancelled) { setDrawings(d); setError(''); } })
      .catch((e) => !cancelled && setError(e.message));
    return () => { cancelled = true; };
  }, [symbol]);

  const create = useCallback(async (tool: ToolId, anchors: Anchor[], style: Style) => {
    try {
      const d = await api<Drawing>('/api/drawings', { method: 'POST', body: { symbol, tool, anchors, style } });
      setDrawings((l) => [...l, d]);
      return d;
    } catch (e) { setError((e as Error).message); return null; }
  }, [symbol]);

  const update = useCallback((id: string, patch: { anchors?: Anchor[]; style?: Style }) => {
    setDrawings((l) => l.map((d) => (d.id === id ? { ...d, ...patch } : d)));
    api(`/api/drawings/${id}`, { method: 'PUT', body: patch }).catch((e) => setError(e.message));
  }, []);

  const remove = useCallback((id: string) => {
    setDrawings((l) => l.filter((d) => d.id !== id));
    api(`/api/drawings/${id}`, { method: 'DELETE' }).catch((e) => setError(e.message));
  }, []);

  const clear = useCallback(() => {
    setDrawings([]);
    api(`/api/drawings?symbol=${encodeURIComponent(symbol)}`, { method: 'DELETE' }).catch((e) => setError(e.message));
  }, [symbol]);

  // Objet stable tant que rien ne change : la cellule active le transmet à la barre d'outils sans boucle de rendu
  return useMemo(() => ({ drawings, create, update, remove, clear, error }), [drawings, create, update, remove, clear, error]);
}
