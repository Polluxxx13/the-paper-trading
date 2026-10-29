import { useEffect, useRef, useState } from 'react';
import type { ChartType, Timeframe } from '../market/types';
import { crosshairBus } from './crosshairBus';
import { nearestBar } from './orderHelpers';
import ChartPane from './ChartPane';
import { ChartGroup } from './chartGroup';
import IndicatorPane from './IndicatorPane';
import { IndicatorInstance, def, label } from './indicators/registry';
import { useCandles } from './useCandles';
import DrawingLayer, { ChartHandle } from './drawings/DrawingLayer';
import type { Drawing, ToolId } from './drawings/model';
import type { DrawingsApi } from './drawings/useDrawings';

interface Props {
  symbol: string;
  tf: Timeframe;
  type: ChartType;
  indicators: IndicatorInstance[];
  onChange: (next: IndicatorInstance[]) => void;
  drawings: DrawingsApi;
  tool: ToolId | null;
  onToolDone: () => void;
  /** Identifiant de la cellule (mise en page 2/4) : sert à synchroniser le réticule entre graphiques. */
  cellId: string;
  /** Couches posées sur le graphique des prix (lignes d'ordres, menu clic droit...). */
  overlay?: (handle: ChartHandle | null) => React.ReactNode;
  /** Clic droit dans la zone de tracé : position pixel + prix pointé. */
  onContext?: (c: { x: number; y: number; price: number }) => void;
  onPlaceOrder?: (d: Drawing) => void;
}

/** Éditeur de paramètres d'un indicateur (modification appliquée en direct). */
function ParamEditor({ inst, onChange, onClose }: { inst: IndicatorInstance; onChange: (i: IndicatorInstance) => void; onClose: () => void }) {
  const d = def(inst.type);
  return (
    <div className="absolute z-30 top-10 left-2 w-60 bg-tv-panel border border-tv-border rounded-lg shadow-xl p-3 space-y-2">
      <div className="flex items-center"><b className="text-sm">{d.name}</b><button onClick={onClose} className="ml-auto text-tv-muted hover:text-tv-text">✕</button></div>
      {d.params.length === 0 && <p className="text-xs text-tv-muted">Cet indicateur n'a pas de paramètre.</p>}
      {d.params.map((p) => (
        <label key={p.key} className="flex items-center justify-between gap-2 text-sm">
          {p.label}
          <input
            type="number" min={p.min} max={p.max} step={p.step ?? 1} value={inst.params[p.key]}
            onChange={(e) => {
              const v = Number(e.target.value);
              if (Number.isFinite(v) && v >= p.min && v <= p.max) onChange({ ...inst, params: { ...inst.params, [p.key]: v } });
            }}
            className="w-20 bg-tv-bg border border-tv-border rounded px-2 py-1 text-right outline-none focus:border-tv-blue"
          />
        </label>
      ))}
    </div>
  );
}

/** Graphique des prix + panneaux d'indicateurs, avec légende (⚙ paramètres, ✕ retirer) sur le graphique. */
export default function ChartStack({ symbol, tf, type, indicators, onChange, drawings, tool, onToolDone, cellId, overlay, onContext, onPlaceOrder }: Props) {
  const feed = useCandles(symbol, tf);
  const [handle, setHandle] = useState<ChartHandle | null>(null);
  const group = useRef(new ChartGroup()).current;
  const mainBox = useRef<HTMLDivElement>(null);

  // Réticule synchronisé entre cellules : publie l'instant (UTC) sous la souris, recale sur celui des autres
  useEffect(() => {
    group.onCrosshair = (t) => crosshairBus.publish(cellId, t === null ? null : t - feed.shift);
    const off = crosshairBus.subscribe((src, utc) => {
      if (src === cellId) return;
      if (utc === null) return group.applyCrosshair(null);
      const bar = nearestBar(feed.candles.current, utc + feed.shift, feed.tfSec * 1.5);
      group.applyCrosshair(bar ? bar.time : null);
    });
    return () => { off(); group.onCrosshair = undefined; };
  }, [group, cellId, feed]);

  function contextMenu(e: React.MouseEvent) {
    e.preventDefault();
    const s = handle?.series();
    const el = mainBox.current;
    if (!handle || !s || !el || !onContext) return;
    const r = el.getBoundingClientRect();
    const x = e.clientX - r.left, y = e.clientY - r.top;
    const plotW = r.width - handle.chart.priceScale('right').width();
    const plotH = r.height - handle.chart.timeScale().height();
    const price = s.coordinateToPrice(y);
    if (x < 0 || x > plotW || y < 0 || y > plotH || price === null) return;
    onContext({ x, y, price: price as number });
  }
  const [editing, setEditing] = useState<string | null>(null);

  const overlays = indicators.filter((i) => def(i.type).placement === 'overlay');
  const panes = indicators.filter((i) => def(i.type).placement === 'pane');
  const edited = indicators.find((i) => i.uid === editing);
  const remove = (uid: string) => { setEditing(null); onChange(indicators.filter((i) => i.uid !== uid)); };

  return (
    <div className="relative flex-1 min-h-0 flex flex-col">
      <div ref={mainBox} onContextMenu={contextMenu} className="relative flex-1 min-h-0 flex flex-col">
        <ChartPane type={type} feed={feed} overlays={overlays} group={group} showTimeAxis={panes.length === 0} onReady={setHandle} />
        <DrawingLayer feed={feed} handle={handle} store={drawings} symbol={symbol} tool={tool} onToolDone={onToolDone} onPlaceOrder={onPlaceOrder} />
        {overlay?.(handle)}
      </div>

      {overlays.length > 0 && (
        <div className="absolute top-1 left-2 z-10 flex flex-col gap-0.5 text-xs">
          {overlays.map((i) => (
            <div key={i.uid} className="flex items-center gap-2 bg-tv-bg/70 rounded px-1.5 py-0.5 w-fit">
              <span className="text-tv-text">{label(i)}</span>
              <button onClick={() => setEditing(editing === i.uid ? null : i.uid)} className="text-tv-muted hover:text-tv-text" title="Paramètres">⚙</button>
              <button onClick={() => remove(i.uid)} className="text-tv-muted hover:text-tv-down" title="Retirer">✕</button>
            </div>
          ))}
        </div>
      )}

      {panes.map((i, k) => (
        <IndicatorPane
          key={i.uid} inst={i} feed={feed} group={group} showTimeAxis={k === panes.length - 1}
          onEdit={() => setEditing(editing === i.uid ? null : i.uid)} onRemove={() => remove(i.uid)}
        />
      ))}

      {edited && (
        <ParamEditor inst={edited} onClose={() => setEditing(null)} onChange={(n) => onChange(indicators.map((i) => (i.uid === n.uid ? n : i)))} />
      )}
    </div>
  );
}
