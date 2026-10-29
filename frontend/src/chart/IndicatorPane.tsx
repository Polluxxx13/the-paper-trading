import { useEffect, useRef } from 'react';
import { ColorType, CrosshairMode, createChart, IChartApi } from 'lightweight-charts';
import { ChartGroup, valueAtTime } from './chartGroup';
import { IndicatorHandle, createIndicator } from './indicators/indicatorSeries';
import { IndicatorInstance, label } from './indicators/registry';
import type { CandleFeed } from './useCandles';

const THROTTLE_MS = 400;

interface Props {
  inst: IndicatorInstance;
  feed: CandleFeed;
  group: ChartGroup;
  showTimeAxis: boolean;
  onEdit: () => void;
  onRemove: () => void;
}

/** Panneau d'indicateur (RSI, MACD...) sous le graphique : graphique à part synchronisé avec le principal. */
export default function IndicatorPane({ inst, feed, group, showTimeAxis, onEdit, onRemove }: Props) {
  const box = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const handle = useRef<IndicatorHandle | null>(null);

  useEffect(() => {
    const chart = createChart(box.current!, {
      autoSize: true,
      layout: { background: { type: ColorType.Solid, color: '#131722' }, textColor: '#d1d4dc' },
      grid: { vertLines: { color: '#1e222d' }, horzLines: { color: '#1e222d' } },
      crosshair: { mode: CrosshairMode.Normal },
      rightPriceScale: { borderColor: '#2a2e39', minimumWidth: 72 }, // même largeur que le graphique principal : barres alignées
      timeScale: { borderColor: '#2a2e39', timeVisible: true, secondsVisible: false, visible: showTimeAxis },
    });
    chartRef.current = chart;
    const leave = group.add({
      chart,
      series: () => handle.current?.anchor ?? null,
      valueAt: (t) => valueAtTime(handle.current?.anchorData() ?? [], t),
    });
    return () => { leave(); handle.current = null; chart.remove(); chartRef.current = null; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [group]);

  useEffect(() => { chartRef.current?.applyOptions({ timeScale: { visible: showTimeAxis } }); }, [showTimeAxis]);

  // (Re)construction : historique chargé ou paramètres modifiés
  const paramKey = JSON.stringify(inst.params);
  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;
    handle.current?.remove();
    handle.current = null;
    const bars = feed.candles.current;
    if (!bars.length) return;
    handle.current = createIndicator(chart, inst, { intraday: feed.intraday, overlay: false });
    handle.current.setData(bars);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [feed.loaded, paramKey, inst.type]);

  useEffect(() => {
    let last = 0, timer: ReturnType<typeof setTimeout> | undefined;
    const refresh = () => { last = Date.now(); handle.current?.updateLast(feed.candles.current); };
    const off = feed.subscribe((newBar) => {
      if (newBar || Date.now() - last > THROTTLE_MS) refresh();
      else if (!timer) timer = setTimeout(() => { timer = undefined; refresh(); }, THROTTLE_MS);
    });
    return () => { off(); clearTimeout(timer); };
  }, [feed]);

  return (
    <div className="relative border-t border-tv-border" style={{ height: showTimeAxis ? 170 : 140 }}>
      <div ref={box} className="absolute inset-0" />
      <div className="absolute top-1 left-2 z-10 flex items-center gap-2 text-xs bg-tv-bg/70 rounded px-1.5 py-0.5">
        <span className="text-tv-text font-medium">{label(inst)}</span>
        <button onClick={onEdit} className="text-tv-muted hover:text-tv-text" title="Paramètres">⚙</button>
        <button onClick={onRemove} className="text-tv-muted hover:text-tv-down" title="Retirer">✕</button>
      </div>
    </div>
  );
}
