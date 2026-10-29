import { useCallback, useEffect, useRef, useState } from 'react';
import type { Account } from './api';
import ChartCell from './chart/ChartCell';
import { crosshairBus } from './chart/crosshairBus';
import DrawingToolbar from './chart/drawings/DrawingToolbar';
import type { ToolId } from './chart/drawings/model';
import type { DrawingsApi } from './chart/drawings/useDrawings';
import IndicatorMenu from './chart/indicators/IndicatorMenu';
import { def, loadIndicators, saveIndicators } from './chart/indicators/registry';
import { Cell, LayoutId, allowedLayout, cellCount, resizeCells } from './chart/orderHelpers';
import { CHART_TYPES, ChartType, TIMEFRAMES, Timeframe, fmtPrice, priceDigits } from './market/types';
import { startSocket, useFeedMode, useQuote, useSubscription } from './market/socket';
import StatusBadge from './panels/StatusBadge';
import MarketStats from './panels/MarketStats';
import SymbolSearch from './panels/SymbolSearch';
import Watchlist from './panels/Watchlist';
import ShortcutsHelp from './ShortcutsHelp';
import BottomPanel from './trading/BottomPanel';
import { useAccountData } from './trading/useAccount';

interface LayoutState { layout: LayoutId; cells: Cell[]; active: number }

const KEY = 'pt.layout';
function loadLayout(): LayoutState {
  try {
    const s = JSON.parse(localStorage.getItem(KEY) ?? 'null') as LayoutState | null;
    if (s && ['1', '2', '4'].includes(s.layout) && Array.isArray(s.cells) && s.cells.length) return { ...s, cells: resizeCells(s.cells, s.layout, 0) };
  } catch { /* stockage indisponible */ }
  const one: Cell = { symbol: 'AAPL', tf: '1h', type: 'candles' };
  return { layout: '1', cells: [one], active: 0 };
}

function useWidth() {
  const [w, setW] = useState(window.innerWidth);
  useEffect(() => { const f = () => setW(window.innerWidth); window.addEventListener('resize', f); return () => window.removeEventListener('resize', f); }, []);
  return w;
}

export default function Workspace({ account, onAccountChanged }: { account: Account; onAccountChanged: () => void }) {
  const [st, setSt] = useState<LayoutState>(loadLayout);
  const [tool, setTool] = useState<ToolId | null>(null);
  const [store, setStore] = useState<DrawingsApi | null>(null);
  const [indicators, setIndicators] = useState(loadIndicators);
  const [help, setHelp] = useState(false);
  const [drawer, setDrawer] = useState(false);
  const [sync, setSync] = useState(true);
  const [toast, setToast] = useState<{ text: string; ok: boolean } | null>(null);
  const feed = useFeedMode();
  const width = useWidth();
  const data = useAccountData(account.slug);

  useEffect(startSocket, []);
  useEffect(() => saveIndicators(indicators), [indicators]);
  useEffect(() => { try { localStorage.setItem(KEY, JSON.stringify(st)); } catch { /* ignoré */ } }, [st]);
  useEffect(() => crosshairBus.setEnabled(sync), [sync]);
  useEffect(() => { if (!toast) return; const t = setTimeout(() => setToast(null), 4500); return () => clearTimeout(t); }, [toast]);

  // Largeur disponible → nombre de graphiques réellement affichés (4 ≥ 1100 px, 2 ≥ 700 px)
  const eff = allowedLayout(st.layout, width);
  const n = cellCount(eff);
  const shown = st.cells.slice(0, n);
  const active = Math.min(st.active, n - 1);
  const cur = shown[active];
  const wide = width >= 1100;

  useSubscription([...new Set(shown.map((c) => c.symbol))]);
  const q = useQuote(cur.symbol);
  const up = (q?.change ?? 0) >= 0;

  const patchActive = useCallback((p: Partial<Cell>) => setSt((s) => ({ ...s, cells: s.cells.map((c, i) => (i === Math.min(s.active, cellCount(allowedLayout(s.layout, window.innerWidth)) - 1) ? { ...c, ...p } : c)) })), []);
  const setLayout = useCallback((l: LayoutId) => setSt((s) => ({ ...s, layout: l, cells: resizeCells(s.cells, l, s.active), active: Math.min(s.active, cellCount(l) - 1) })), []);
  const notify = useCallback((text: string, ok: boolean) => setToast({ text, ok }), []);
  const onTrade = useCallback(() => { data.reload().catch(() => {}); onAccountChanged(); }, [data, onAccountChanged]);
  const pickTool = useCallback((t: ToolId | null) => setTool(t), []);
  useEffect(() => setTool(null), [cur.symbol, active]);

  // Raccourcis : Alt+1..8 unités de temps, Alt+Maj+1/2/4 mise en page, Alt+←/→ graphique actif, / recherche, ? aide
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement;
      const typing = el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT';
      if (e.key === '?' && !typing) { setHelp((h) => !h); return; }
      if (e.key === '/' && !typing && !e.altKey) { e.preventDefault(); document.querySelector<HTMLInputElement>('[data-symbol-search]')?.focus(); return; }
      if (!e.altKey || e.ctrlKey || e.metaKey || typing) return;
      const m = /^(?:Digit|Numpad)(\d)$/.exec(e.code);
      if (m && e.shiftKey && ['1', '2', '4'].includes(m[1])) { e.preventDefault(); setLayout(m[1] as LayoutId); return; }
      if (m && !e.shiftKey && Number(m[1]) >= 1 && Number(m[1]) <= TIMEFRAMES.length) { e.preventDefault(); patchActive({ tf: TIMEFRAMES[Number(m[1]) - 1].id }); return; }
      if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
        e.preventDefault();
        setSt((s) => ({ ...s, active: (Math.min(s.active, n - 1) + (e.key === 'ArrowRight' ? 1 : n - 1)) % n }));
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [n, patchActive, setLayout]);

  const layoutBtn = (l: LayoutId, label: string, icon: string) => (
    <button key={l} onClick={() => setLayout(l)} disabled={allowedLayout(l, width) !== l} title={`${label} (Alt+Maj+${l})`}
      className={`w-8 h-7 flex items-center justify-center rounded ${st.layout === l ? 'bg-tv-blue text-white' : 'text-tv-muted hover:bg-tv-border'} disabled:opacity-30`}>
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4"><path d={icon} /></svg>
    </button>
  );

  const gridCls = n === 1 ? 'grid-cols-1' : n === 2 ? 'grid-cols-2' : 'grid-cols-2 grid-rows-2';
  const watch = <Watchlist selected={cur.symbol} onSelect={(s) => { patchActive({ symbol: s }); setDrawer(false); }} />;

  return (
    <div className="flex-1 min-h-0 flex relative">
      <DrawingToolbar tool={tool} onPick={pickTool} onClear={() => store?.clear()} count={store?.drawings.length ?? 0} />

      <section className="flex-1 min-w-0 flex flex-col">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2 border-b border-tv-border">
          <div className="w-56"><SymbolSearch onPick={(h) => patchActive({ symbol: h.symbol })} /></div>
          <div className="flex gap-0.5">
            {TIMEFRAMES.map((t) => (
              <button key={t.id} onClick={() => patchActive({ tf: t.id })} className={`px-2 py-1 rounded text-sm ${cur.tf === t.id ? 'bg-tv-blue text-white' : 'text-tv-muted hover:bg-tv-border'}`}>{t.label}</button>
            ))}
          </div>
          <select value={cur.type} onChange={(e) => patchActive({ type: e.target.value })} className="bg-tv-bg border border-tv-border rounded px-2 py-1 text-sm">
            {CHART_TYPES.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
          </select>
          <IndicatorMenu indicators={indicators} onChange={setIndicators} />
          <div className="flex gap-0.5 items-center border-l border-tv-border pl-3">
            {layoutBtn('1', '1 graphique', 'M2 2h12v12H2z')}
            {layoutBtn('2', '2 graphiques', 'M2 2h12v12H2z M8 2v12')}
            {layoutBtn('4', '4 graphiques', 'M2 2h12v12H2z M8 2v12 M2 8h12')}
            {n > 1 && (
              <label className="flex items-center gap-1 ml-2 text-xs text-tv-muted cursor-pointer" title="Réticule synchronisé entre les graphiques">
                <input type="checkbox" checked={sync} onChange={(e) => setSync(e.target.checked)} /> Réticule lié
              </label>
            )}
          </div>
          <div className="ml-auto flex items-center gap-2">
            <span className="text-xs text-tv-muted hidden md:inline" title="Flux temps réel Yahoo ou repli par sondage">
              {!feed.connected ? 'Reconnexion…' : feed.mode === 'stream' ? 'Flux temps réel' : 'Repli : sondage 1,5 s'}
            </span>
            <button onClick={() => setHelp(true)} className="w-7 h-7 rounded border border-tv-border text-tv-muted hover:text-tv-text" title="Raccourcis clavier (?)">?</button>
            {!wide && <button onClick={() => setDrawer(!drawer)} className="px-3 py-1 rounded border border-tv-border text-sm hover:border-tv-blue">Watchlist</button>}
          </div>
        </div>

        <div className="flex flex-wrap items-baseline gap-x-3 px-3 py-1.5">
          <h2 className="text-lg font-semibold">{cur.symbol}</h2>
          <span className="text-sm text-tv-muted truncate max-w-[16rem]">{q?.name}</span>
          {q && (
            <>
              <span className="text-xl">{fmtPrice(q.price)}</span>
              <span className={up ? 'text-tv-up' : 'text-tv-down'}>{up ? '+' : ''}{fmtPrice(Number(q.change.toFixed(priceDigits(q.price))))} ({up ? '+' : ''}{q.changePercent.toFixed(2)}%)</span>
              <span className="text-xs text-tv-muted">{q.currency}</span>
              <StatusBadge status={q.status} time={q.time} />
              <span className="text-xs text-tv-muted">{new Date(q.time).toLocaleTimeString('fr-CH')}</span>
            </>
          )}
        </div>
        {q && <MarketStats q={q} />}

        <div className={`flex-1 min-h-0 grid ${gridCls} gap-px bg-tv-border`}>
          {shown.map((c, i) => (
            <ChartCell
              key={`${n}-${i}`} id={`cell-${i}`} symbol={c.symbol} tf={c.tf as Timeframe} type={c.type as ChartType}
              active={i === active} multi={n > 1} onActivate={() => i !== active && setSt((s) => ({ ...s, active: i }))}
              indicators={i === active ? indicators : indicators.filter((x) => def(x.type).placement === 'overlay')}
              onIndicators={setIndicators}
              tool={tool} onToolDone={() => setTool(null)}
              account={account} data={data} onTrade={onTrade} notify={notify}
              onStore={setStore}
            />
          ))}
        </div>

        <BottomPanel account={account} symbol={cur.symbol} data={data} onAccountChanged={onAccountChanged} />
      </section>

      {wide ? watch : drawer && <div className="absolute right-0 top-0 bottom-0 z-30 shadow-2xl flex">{watch}</div>}

      {toast && (
        <div className={`fixed bottom-6 left-1/2 -translate-x-1/2 z-50 px-4 py-2 rounded-lg shadow-xl text-sm text-white ${toast.ok ? 'bg-tv-up' : 'bg-tv-down'}`} onClick={() => setToast(null)}>{toast.text}</div>
      )}
      {help && <ShortcutsHelp onClose={() => setHelp(false)} />}
    </div>
  );
}
