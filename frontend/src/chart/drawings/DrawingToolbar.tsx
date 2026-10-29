import { useEffect } from 'react';
import { TOOLS, ToolId } from './model';

/** Barre d'outils verticale à gauche du graphique. Raccourcis : Alt + lettre (survolez un outil pour la voir). */
export default function DrawingToolbar({ tool, onPick, onClear, count }: { tool: ToolId | null; onPick: (t: ToolId | null) => void; onClear: () => void; count: number }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!e.altKey || e.ctrlKey || e.metaKey) return;
      const el = e.target as HTMLElement;
      if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT') return;
      const t = TOOLS.find((x) => x.key === e.key.toLowerCase());
      if (!t) return;
      e.preventDefault();
      onPick(tool === t.id ? null : t.id);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [tool, onPick]);

  const btn = (active: boolean) => `w-9 h-9 flex items-center justify-center rounded ${active ? 'bg-tv-blue text-white' : 'text-tv-muted hover:bg-tv-border hover:text-tv-text'}`;

  return (
    <div className="w-12 shrink-0 bg-tv-panel border-r border-tv-border flex flex-col items-center py-2 gap-1 overflow-y-auto">
      <button onClick={() => onPick(null)} className={btn(tool === null)} title="Curseur / sélection (Échap)">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M5 3 L19 12 L12 13.5 L9 20 Z" /></svg>
      </button>
      <span className="w-6 h-px bg-tv-border my-1" />
      {TOOLS.map((t) => (
        <button key={t.id} onClick={() => onPick(tool === t.id ? null : t.id)} className={btn(tool === t.id)} title={`${t.label} (Alt+${t.key.toUpperCase()})`}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d={t.icon} /></svg>
        </button>
      ))}
      <span className="w-6 h-px bg-tv-border my-1" />
      <button
        disabled={!count}
        onClick={() => { if (window.confirm(`Effacer les ${count} dessin(s) de ce symbole ?`)) onClear(); }}
        className={`${btn(false)} disabled:opacity-30`} title="Effacer tous les dessins du symbole"
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><path d="M4 7 H20 M9 7 V4 H15 V7 M6 7 L7 20 H17 L18 7" /></svg>
      </button>
    </div>
  );
}
