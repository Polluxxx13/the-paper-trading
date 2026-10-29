import { useEffect } from 'react';
import type { MenuAction } from './orderHelpers';

const TONE = { buy: 'text-tv-up', sell: 'text-tv-down', neutral: 'text-tv-text' };

/** Menu clic droit du graphique : ordres au marché / limite / stop au prix pointé, TP/SL de position. */
export default function ChartContextMenu({ x, y, price, qty, onQty, actions, onPick, onClose }: {
  x: number; y: number; price: number; qty: number; onQty: (n: number) => void;
  actions: MenuAction[]; onPick: (a: MenuAction) => void; onClose: () => void;
}) {
  useEffect(() => {
    const close = (e: Event) => { if (!(e.target as Element).closest?.('[data-ctxmenu]')) onClose(); };
    const key = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('pointerdown', close, true);
    window.addEventListener('keydown', key);
    return () => { document.removeEventListener('pointerdown', close, true); window.removeEventListener('keydown', key); };
  }, [onClose]);

  return (
    <div data-ctxmenu className="absolute z-40 w-64 bg-tv-panel border border-tv-border rounded-lg shadow-2xl py-1 text-sm" style={{ left: x, top: y }}>
      <div className="flex items-center gap-2 px-3 py-1.5 border-b border-tv-border text-xs text-tv-muted">
        Quantité
        <input type="number" min="0" step="any" value={qty} onChange={(e) => { const v = Number(e.target.value); if (v > 0) onQty(v); }}
          className="w-24 bg-tv-bg border border-tv-border rounded px-2 py-0.5 text-tv-text text-right outline-none focus:border-tv-blue" />
        <span className="ml-auto">@ {price.toPrecision(6)}</span>
      </div>
      {actions.map((a, i) => (
        <button key={i} onClick={() => onPick(a)} className={`w-full text-left px-3 py-1.5 hover:bg-tv-border ${TONE[a.tone]}`}>{a.label}</button>
      ))}
    </div>
  );
}
