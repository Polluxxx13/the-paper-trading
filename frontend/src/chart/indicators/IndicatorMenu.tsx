import { useState } from 'react';
import { INDICATORS, IndicatorInstance, newInstance } from './registry';

/** Bouton « Indicateurs » : liste des indicateurs disponibles, un clic l'ajoute (plusieurs instances possibles). */
export default function IndicatorMenu({ indicators, onChange }: { indicators: IndicatorInstance[]; onChange: (n: IndicatorInstance[]) => void }) {
  const [open, setOpen] = useState(false);
  const count = (id: string) => indicators.filter((i) => i.type === id).length;
  const group = (title: string, placement: 'overlay' | 'pane') => (
    <div>
      <div className="px-3 pt-2 pb-1 text-xs uppercase tracking-wide text-tv-muted">{title}</div>
      {INDICATORS.filter((d) => d.placement === placement).map((d) => (
        <button key={d.id} onMouseDown={() => onChange([...indicators, newInstance(d.id)])} className="w-full flex items-center px-3 py-1.5 text-sm text-left hover:bg-tv-border">
          {d.name}
          {count(d.id) > 0 && <span className="ml-auto text-xs text-tv-blue">{count(d.id)} actif{count(d.id) > 1 ? 's' : ''}</span>}
        </button>
      ))}
    </div>
  );
  return (
    <div className="relative">
      <button onClick={() => setOpen(!open)} onBlur={() => setTimeout(() => setOpen(false), 150)} className="px-3 py-1 rounded border border-tv-border text-sm hover:border-tv-blue">
        Indicateurs{indicators.length ? ` (${indicators.length})` : ''} ▾
      </button>
      {open && (
        <div className="absolute z-30 mt-1 w-64 max-h-96 overflow-auto bg-tv-panel border border-tv-border rounded-lg shadow-xl pb-1">
          {group('Sur le graphique', 'overlay')}
          {group('Panneaux séparés', 'pane')}
        </div>
      )}
    </div>
  );
}
