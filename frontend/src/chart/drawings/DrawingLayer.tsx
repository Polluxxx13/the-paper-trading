import { useCallback, useEffect, useRef, useState } from 'react';
import type { IChartApi, ISeriesApi, Logical, SeriesType } from 'lightweight-charts';
import type { CandleFeed } from '../useCandles';
import { Mapper, Shape, buildShapes, defaultStop } from './geometry';
import { Anchor, COLORS, Drawing, ToolId, toolDef } from './model';
import type { DrawingsApi } from './useDrawings';

export interface ChartHandle { chart: IChartApi; series: () => ISeriesApi<SeriesType> | null }

interface Props {
  feed: CandleFeed;
  handle: ChartHandle | null;
  store: DrawingsApi;
  symbol: string;
  tool: ToolId | null;
  onToolDone: () => void;
  /** Transforme une position dessinée (long/short) en ordre réel. */
  onPlaceOrder?: (d: Drawing) => void;
}

type Drag =
  | { kind: 'handle'; id: string; index: number }
  | { kind: 'body'; id: string; l0: number; p0: number; orig: Anchor[] };

/** Complète les ancres manquantes avec la position du curseur pour l'aperçu pendant la création. */
function provisional(tool: ToolId, placed: Anchor[], hover: Anchor): Anchor[] {
  if (tool === 'long' || tool === 'short') return [placed[0], hover, defaultStop(placed[0], hover)];
  const need = toolDef(tool).clicks;
  return [...placed, ...Array(Math.max(0, need - placed.length)).fill(hover)];
}

/** Cohérence interne d'une position (stop à la même date que la cible) après déplacement d'une ancre. */
function moveAnchor(d: Drawing, anchors: Anchor[], index: number, to: Anchor): Anchor[] {
  const a = anchors.map((x) => ({ ...x }));
  if (d.tool === 'long' || d.tool === 'short') {
    if (index === 1) { a[1] = to; a[2] = { time: to.time, price: a[2].price }; }
    else if (index === 2) a[2] = { time: a[1].time, price: to.price };
    else a[0] = to;
    return a;
  }
  if (d.tool === 'hline') a[0] = { time: a[0].time, price: to.price };
  else if (d.tool === 'vline') a[0] = { time: to.time, price: a[0].price };
  else a[index] = to;
  return a;
}

/**
 * Couche de dessin maison : un SVG transparent posé sur le graphique des prix. Les ancres sont stockées en
 * (instant UTC, prix) et converties en pixels via l'échelle de temps et de prix de Lightweight Charts à chaque
 * zoom / défilement. Les clics ne sont interceptés que par les dessins eux-mêmes ou pendant la création.
 */
export default function DrawingLayer({ feed, handle, store, symbol, tool, onToolDone, onPlaceOrder }: Props) {
  const box = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [, setTick] = useState(0);
  const [selected, setSelected] = useState<string | null>(null);
  const [creating, setCreating] = useState<Anchor[]>([]);
  const [hover, setHover] = useState<Anchor | null>(null);
  const [drag, setDrag] = useState<Drag | null>(null);
  const [draft, setDraft] = useState<{ id: string; anchors: Anchor[] } | null>(null);
  const dragMoved = useRef(false);

  const shift = feed.intraday ? -new Date().getTimezoneOffset() * 60 : 0;

  // ── Conversions temps ↔ index logique (extrapolées au-delà des données avec la durée d'une barre) ──
  const toLogical = useCallback((utc: number): number | null => {
    const c = feed.candles.current;
    const n = c.length;
    if (!n) return null;
    const t = utc + shift;
    if (t <= c[0].time) return (t - c[0].time) / feed.tfSec;
    if (t >= c[n - 1].time) return n - 1 + (t - c[n - 1].time) / feed.tfSec;
    let lo = 0, hi = n - 1;
    while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (c[mid].time <= t) lo = mid; else hi = mid; }
    return lo + (t - c[lo].time) / (c[hi].time - c[lo].time);
  }, [feed, shift]);

  const fromLogical = useCallback((l: number): number => {
    const c = feed.candles.current;
    const n = c.length;
    let t: number;
    if (l <= 0) t = c[0].time + l * feed.tfSec;
    else if (l >= n - 1) t = c[n - 1].time + (l - (n - 1)) * feed.tfSec;
    else { const i = Math.floor(l); t = c[i].time + (l - i) * (c[i + 1].time - c[i].time); }
    return Math.round(t - shift);
  }, [feed, shift]);

  const plot = () => {
    const w = size.w - (handle?.chart.priceScale('right').width() ?? 0);
    return { w: Math.max(0, w), h: Math.max(0, size.h - (handle?.chart.timeScale().height() ?? 0)) }; // hors axe du temps
  };

  const mapper = (): Mapper | null => {
    if (!handle) return null;
    const s = handle.series();
    if (!s) return null;
    const p = plot();
    return {
      w: p.w, h: p.h,
      px: (a) => {
        const l = toLogical(a.time);
        if (l === null) return null;
        const x = handle.chart.timeScale().logicalToCoordinate(l as Logical);
        const y = s.priceToCoordinate(a.price);
        return x === null || y === null ? null : { x, y };
      },
      bars: (t1, t2) => Math.abs((toLogical(t2) ?? 0) - (toLogical(t1) ?? 0)),
    };
  };

  /** Position du pointeur → ancre (instant aimanté sur la barre la plus proche, prix libre). */
  const anchorAt = (cx: number, cy: number): Anchor | null => {
    const s = handle?.series();
    if (!handle || !s || !feed.candles.current.length) return null;
    const l = handle.chart.timeScale().coordinateToLogical(cx);
    const price = s.coordinateToPrice(cy);
    if (l === null || price === null) return null;
    return { time: fromLogical(Math.round(l)), price: price as number };
  };

  const local = (e: React.PointerEvent | PointerEvent) => {
    const r = box.current!.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };

  // Taille du conteneur
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setSize({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    setSize({ w: el.clientWidth, h: el.clientHeight });
    return () => ro.disconnect();
  }, []);

  // Redessine dès que la vue change (zoom, défilement, échelle des prix auto-ajustée)
  useEffect(() => {
    if (!handle) return;
    let raf = 0, last = '';
    const loop = () => {
      const s = handle.series();
      const r = handle.chart.timeScale().getVisibleLogicalRange();
      const sig = [r?.from, r?.to, s?.priceToCoordinate(0), s?.priceToCoordinate(1000), handle.chart.priceScale('right').width(), feed.loaded, feed.candles.current.length].join('|');
      if (sig !== last) { last = sig; setTick((t) => t + 1); }
      raf = requestAnimationFrame(loop);
    };
    loop();
    return () => cancelAnimationFrame(raf);
  }, [handle, feed]);

  // Changement de symbole / d'outil : abandonne la création en cours
  useEffect(() => { setCreating([]); setHover(null); setSelected(null); }, [symbol]);
  useEffect(() => { setCreating([]); setHover(null); if (tool) setSelected(null); }, [tool]);

  // Clavier : Échap annule, Suppr efface le dessin sélectionné
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement;
      if (el.tagName === 'INPUT' || el.tagName === 'SELECT' || el.tagName === 'TEXTAREA') return;
      if (e.key === 'Escape') { setCreating([]); setHover(null); setSelected(null); if (tool) onToolDone(); }
      else if ((e.key === 'Delete' || e.key === 'Backspace') && selected) { store.remove(selected); setSelected(null); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [selected, tool, store, onToolDone]);

  // Clic ailleurs : désélection
  useEffect(() => {
    const onDown = (e: PointerEvent) => {
      const t = e.target as Element;
      if (!t.closest('[data-did]') && !t.closest('[data-dbar]') && !tool) setSelected(null);
    };
    document.addEventListener('pointerdown', onDown, true);
    return () => document.removeEventListener('pointerdown', onDown, true);
  }, [tool]);

  const current = (d: Drawing): Anchor[] => (draft && draft.id === d.id ? draft.anchors : d.anchors);

  // ── Interactions ──
  async function finish(t: ToolId, placed: Anchor[]) {
    const def = toolDef(t);
    const anchors = t === 'long' || t === 'short' ? [placed[0], placed[1], defaultStop(placed[0], placed[1])] : placed;
    let text: string | undefined;
    if (t === 'text') {
      const v = window.prompt('Texte :', '');
      if (!v) { setCreating([]); onToolDone(); return; }
      text = v;
    }
    setCreating([]); setHover(null);
    onToolDone();
    const d = await store.create(t, anchors, { color: def.color, width: 2, ...(text ? { text } : {}) });
    if (d) setSelected(d.id);
  }

  function onPointerDown(e: React.PointerEvent) {
    const { x, y } = local(e);
    if (tool) {
      const a = anchorAt(x, y);
      if (!a) return;
      e.preventDefault();
      const placed = [...creating, a];
      if (placed.length >= toolDef(tool).clicks) void finish(tool, placed);
      else setCreating(placed);
      return;
    }
    const el = (e.target as Element).closest('[data-did]') as SVGElement | null;
    if (!el) return;
    const id = el.getAttribute('data-did')!;
    const d = store.drawings.find((x) => x.id === id);
    if (!d) return;
    e.preventDefault();
    setSelected(id);
    (e.currentTarget as Element).setPointerCapture(e.pointerId);
    dragMoved.current = false;
    const handleIdx = el.getAttribute('data-handle');
    if (handleIdx !== null) setDrag({ kind: 'handle', id, index: Number(handleIdx) });
    else {
      const s = handle?.series();
      const l0 = handle?.chart.timeScale().coordinateToLogical(x);
      const p0 = s?.coordinateToPrice(y);
      if (l0 != null && p0 != null) setDrag({ kind: 'body', id, l0, p0: p0 as number, orig: d.anchors });
    }
  }

  function onPointerMove(e: React.PointerEvent) {
    const { x, y } = local(e);
    if (tool) { if (creating.length) setHover(anchorAt(x, y)); return; }
    if (!drag || !handle) return;
    const d = store.drawings.find((z) => z.id === drag.id);
    const s = handle.series();
    if (!d || !s) return;
    dragMoved.current = true;
    if (drag.kind === 'handle') {
      const a = anchorAt(x, y);
      if (a) setDraft({ id: d.id, anchors: moveAnchor(d, current(d), drag.index, a) });
    } else {
      const l = handle.chart.timeScale().coordinateToLogical(x);
      const p = s.coordinateToPrice(y);
      if (l === null || p === null) return;
      const dl = Math.round(l - drag.l0), dp = (p as number) - drag.p0;
      setDraft({
        id: d.id,
        anchors: drag.orig.map((a) => {
          const la = toLogical(a.time);
          return { time: la === null ? a.time : fromLogical(la + dl), price: a.price + dp };
        }),
      });
    }
  }

  function onPointerUp() {
    if (drag && draft && dragMoved.current) store.update(draft.id, { anchors: draft.anchors });
    setDrag(null); setDraft(null);
  }

  // ── Rendu ──
  const m = mapper();
  const p = plot();
  const sel = store.drawings.find((d) => d.id === selected) ?? null;
  const preview: Drawing | null = tool && creating.length && hover
    ? { id: 'preview', symbol, tool, anchors: provisional(tool, creating, hover), style: { color: toolDef(tool).color, width: 2 } }
    : null;

  const hitStyle = { pointerEvents: 'stroke' as const, cursor: 'pointer' };

  function renderShape(s: Shape, i: number, d: Drawing, interactive: boolean) {
    const did = interactive ? { 'data-did': d.id } : {};
    switch (s.k) {
      case 'line':
        return (
          <g key={i}>
            <line x1={s.x1} y1={s.y1} x2={s.x2} y2={s.y2} stroke={s.color} strokeWidth={s.width} strokeDasharray={s.dash} opacity={s.opacity ?? 1} style={{ pointerEvents: 'none' }} />
            {interactive && <line x1={s.x1} y1={s.y1} x2={s.x2} y2={s.y2} stroke="transparent" strokeWidth={12} style={hitStyle} {...did} />}
          </g>
        );
      case 'rect': {
        const solid = interactive && d.tool !== 'fib';
        return <rect key={i} x={s.x} y={s.y} width={s.w} height={s.h} fill={s.fill} fillOpacity={s.opacity} stroke={s.stroke} strokeWidth={1} style={{ pointerEvents: solid ? 'all' : 'none', cursor: 'pointer' }} {...(solid ? did : {})} />;
      }
      case 'poly':
        return <polygon key={i} points={s.points} fill={s.fill} style={{ pointerEvents: interactive ? 'all' : 'none' }} {...did} />;
      case 'text': {
        const size = s.size ?? 12;
        const w = s.text.length * size * 0.58 + 8;
        const x = s.anchor === 'end' ? s.x - w + 4 : s.anchor === 'middle' ? s.x - w / 2 : s.x - 4;
        return (
          <g key={i} {...did} style={{ pointerEvents: interactive && d.tool === 'text' ? 'all' : 'none', cursor: 'pointer' }} onDoubleClick={() => { if (d.tool === 'text') { const v = window.prompt('Texte :', d.style.text ?? ''); if (v) store.update(d.id, { style: { ...d.style, text: v } }); } }}>
            {s.bg && <rect x={x} y={s.y - size} width={w} height={size + 6} rx={3} fill={s.bg} />}
            <text x={s.anchor === 'end' ? s.x : s.anchor === 'middle' ? s.x : s.x} y={s.y} fill={s.color} fontSize={size} textAnchor={s.anchor ?? 'start'}>{s.text}</text>
          </g>
        );
      }
    }
  }

  const anchorsOf = (d: Drawing) => current(d);

  return (
    <div ref={box} className="absolute inset-0 pointer-events-none z-10" style={{ cursor: tool ? 'crosshair' : undefined }}>
      <svg
        width={size.w} height={size.h} className="absolute inset-0"
        style={{ pointerEvents: tool ? 'all' : 'none', touchAction: 'none' }}
        onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp}
      >
        <defs><clipPath id="plot-clip"><rect x={0} y={0} width={p.w} height={p.h} /></clipPath></defs>
        <g clipPath="url(#plot-clip)">
          {m && store.drawings.map((d) => {
            const dd = { ...d, anchors: anchorsOf(d) };
            return <g key={d.id} opacity={selected === d.id ? 1 : 0.95}>{buildShapes(dd, m).map((s, i) => renderShape(s, i, dd, !tool))}</g>;
          })}
          {m && preview && buildShapes(preview, m).map((s, i) => renderShape(s, i, preview, false))}
          {m && creating.map((a, i) => { const pt = m.px(a); return pt ? <circle key={i} cx={pt.x} cy={pt.y} r={4} fill="#fff" stroke={toolDef(tool!).color} strokeWidth={2} /> : null; })}
        </g>
        {m && sel && !tool && anchorsOf(sel).map((a, i) => {
          const pt = m.px(a);
          if (!pt) return null;
          const x = sel.tool === 'hline' ? p.w / 2 : pt.x, y = sel.tool === 'vline' ? p.h / 2 : pt.y;
          return <circle key={i} cx={x} cy={y} r={5.5} fill="#131722" stroke={sel.style.color} strokeWidth={2} data-did={sel.id} data-handle={i} style={{ pointerEvents: 'all', cursor: 'grab' }} />;
        })}
      </svg>

      {sel && !tool && (
        <div data-dbar className="pointer-events-auto absolute top-2 left-1/2 -translate-x-1/2 flex items-center gap-2 bg-tv-panel border border-tv-border rounded-lg shadow-xl px-2 py-1.5">
          <span className="text-xs text-tv-muted pr-1">{toolDef(sel.tool).label}</span>
          {COLORS.map((c) => (
            <button key={c} onClick={() => store.update(sel.id, { style: { ...sel.style, color: c } })} className="w-4 h-4 rounded-full border" style={{ background: c, borderColor: sel.style.color === c ? '#fff' : 'transparent' }} />
          ))}
          <span className="w-px h-4 bg-tv-border" />
          {[1, 2, 3, 4].map((w) => (
            <button key={w} onClick={() => store.update(sel.id, { style: { ...sel.style, width: w } })} className={`w-6 h-6 flex items-center justify-center rounded ${sel.style.width === w ? 'bg-tv-border' : ''}`} title={`Épaisseur ${w}`}>
              <span className="block w-4 bg-tv-text" style={{ height: w }} />
            </button>
          ))}
          {sel.tool === 'text' && <button onClick={() => { const v = window.prompt('Texte :', sel.style.text ?? ''); if (v) store.update(sel.id, { style: { ...sel.style, text: v } }); }} className="text-xs px-2 py-0.5 border border-tv-border rounded hover:border-tv-blue">Modifier</button>}
          {(sel.tool === 'long' || sel.tool === 'short') && onPlaceOrder && (
            <button onClick={() => onPlaceOrder(sel)} className="text-xs px-2 py-0.5 rounded text-white" style={{ background: sel.tool === 'long' ? '#26a69a' : '#ef5350' }} title="Passer cet ordre avec TP et SL attachés">Passer l'ordre…</button>
          )}
          <button onClick={() => { store.remove(sel.id); setSelected(null); }} className="text-xs px-2 py-0.5 border border-tv-border rounded hover:border-tv-down hover:text-tv-down" title="Supprimer (Suppr)">Supprimer</button>
        </div>
      )}
      {tool && <div className="absolute top-2 left-1/2 -translate-x-1/2 text-xs bg-tv-panel/90 border border-tv-border rounded px-3 py-1 text-tv-muted">{toolDef(tool).label} : cliquez {creating.length ? 'pour placer le point suivant' : 'pour placer le premier point'} · Échap pour annuler</div>}
    </div>
  );
}
