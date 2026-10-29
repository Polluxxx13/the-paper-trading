import { useEffect } from 'react';
import { TIMEFRAMES } from './market/types';
import { TOOLS } from './chart/drawings/model';

const Key = ({ k }: { k: string }) => <kbd className="px-1.5 py-0.5 rounded bg-tv-bg border border-tv-border text-xs font-mono">{k}</kbd>;
const Row = ({ keys, text }: { keys: string; text: string }) => (
  <div className="flex items-center justify-between gap-4 py-1 text-sm"><span className="text-tv-muted">{text}</span><span className="flex gap-1 shrink-0">{keys.split(' ').map((k, i) => <Key key={i} k={k} />)}</span></div>
);

/** Fenêtre d'aide listant tous les raccourcis clavier (touche ? pour l'ouvrir). */
export default function ShortcutsHelp({ onClose }: { onClose: () => void }) {
  useEffect(() => {
    const k = (e: KeyboardEvent) => (e.key === 'Escape' || e.key === '?') && onClose();
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-tv-panel border border-tv-border rounded-lg shadow-2xl w-full max-w-3xl max-h-[85vh] overflow-auto p-5" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center mb-3"><h2 className="font-semibold">Raccourcis clavier</h2><button onClick={onClose} className="ml-auto text-tv-muted hover:text-tv-text">✕</button></div>
        <div className="grid md:grid-cols-2 gap-x-8">
          <div>
            <h3 className="text-xs uppercase text-tv-muted mt-1 mb-1">Outils de dessin</h3>
            {TOOLS.map((t) => <Row key={t.id} keys={`Alt ${t.key.toUpperCase()}`} text={t.label} />)}
            <Row keys="Échap" text="Annuler / désélectionner" />
            <Row keys="Suppr" text="Supprimer le dessin sélectionné" />
          </div>
          <div>
            <h3 className="text-xs uppercase text-tv-muted mt-1 mb-1">Unités de temps (graphique actif)</h3>
            {TIMEFRAMES.map((t, i) => <Row key={t.id} keys={`Alt ${i + 1}`} text={t.label} />)}
            <h3 className="text-xs uppercase text-tv-muted mt-3 mb-1">Mise en page</h3>
            <Row keys="Alt Maj 1" text="1 graphique" />
            <Row keys="Alt Maj 2" text="2 graphiques" />
            <Row keys="Alt Maj 4" text="4 graphiques" />
            <Row keys="Alt ←" text="Graphique précédent" />
            <Row keys="Alt →" text="Graphique suivant" />
            <h3 className="text-xs uppercase text-tv-muted mt-3 mb-1">Général</h3>
            <Row keys="/" text="Rechercher un symbole" />
            <Row keys="?" text="Cette aide" />
            <Row keys="Clic droit" text="Passer un ordre à ce prix (sur le graphique)" />
          </div>
        </div>
      </div>
    </div>
  );
}
