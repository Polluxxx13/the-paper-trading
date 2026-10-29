import { useEffect, useRef } from 'react';
import { ColorType, CrosshairMode, createChart, IChartApi, ISeriesApi, SeriesType, UTCTimestamp } from 'lightweight-charts';
import { ChartType, priceDigits } from '../market/types';
import { ChartGroup } from './chartGroup';
import { haNext, toHeikinAshi } from './heikinAshi';
import { IndicatorHandle, createIndicator } from './indicators/indicatorSeries';
import type { IndicatorInstance } from './indicators/registry';
import type { CandleFeed } from './useCandles';

const UP = '#26a69a';
const DOWN = '#ef5350';
const THROTTLE_MS = 400;

interface Props {
  type: ChartType;
  feed: CandleFeed;
  /** Indicateurs superposés au prix (SMA, Bollinger, volume...). */
  overlays: IndicatorInstance[];
  group: ChartGroup;
  showTimeAxis: boolean;
  /** Appelé quand le graphique est créé : la couche de dessin s'y branche. */
  onReady?: (h: { chart: IChartApi; series: () => ISeriesApi<SeriesType> | null } | null) => void;
}

/** Graphique des prix : série principale (5 types), indicateurs superposés, mises à jour live. */
export default function ChartPane({ type, feed, overlays, group, showTimeAxis, onReady }: Props) {
  const box = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const mainRef = useRef<ISeriesApi<SeriesType> | null>(null);
  const ha = useRef<ReturnType<typeof toHeikinAshi>>([]);
  const handles = useRef<IndicatorHandle[]>([]);
  const typeRef = useRef(type);
  typeRef.current = type;

  // Création / destruction du graphique
  useEffect(() => {
    const chart = createChart(box.current!, {
      autoSize: true,
      layout: { background: { type: ColorType.Solid, color: '#131722' }, textColor: '#d1d4dc' },
      grid: { vertLines: { color: '#1e222d' }, horzLines: { color: '#1e222d' } },
      crosshair: { mode: CrosshairMode.Normal },
      rightPriceScale: { borderColor: '#2a2e39', minimumWidth: 72 },
      timeScale: { borderColor: '#2a2e39', timeVisible: true, secondsVisible: false },
    });
    chartRef.current = chart;
    const closeAt = (t: number) => {
      const d = feed.candles.current;
      let lo = 0, hi = d.length - 1;
      while (lo <= hi) { const m = (lo + hi) >> 1; if (d[m].time === t) return d[m].close; if (d[m].time < t) lo = m + 1; else hi = m - 1; }
      return undefined;
    };
    const leave = group.add({ chart, series: () => mainRef.current, valueAt: closeAt });
    onReady?.({ chart, series: () => mainRef.current });
    return () => { onReady?.(null); leave(); handles.current = []; chart.remove(); chartRef.current = null; mainRef.current = null; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [group]);

  useEffect(() => { chartRef.current?.applyOptions({ timeScale: { visible: showTimeAxis } }); }, [showTimeAxis]);

  /** (Re)construit la série principale selon le type de graphique. */
  function drawMain() {
    const chart = chartRef.current;
    const data = feed.candles.current;
    if (!chart) return;
    if (mainRef.current) { chart.removeSeries(mainRef.current); mainRef.current = null; }
    if (!data.length) return;
    const digits = priceDigits(data[data.length - 1].close);
    const priceFormat = { type: 'price' as const, precision: digits, minMove: 1 / 10 ** digits };
    const t = (c: { time: number }) => c.time as UTCTimestamp;
    if (type === 'candles' || type === 'heikin') {
      const s = chart.addCandlestickSeries({ upColor: UP, downColor: DOWN, borderVisible: false, wickUpColor: UP, wickDownColor: DOWN, priceFormat });
      ha.current = type === 'heikin' ? toHeikinAshi(data) : [];
      s.setData((type === 'heikin' ? ha.current : data).map((c) => ({ ...c, time: t(c) })));
      mainRef.current = s;
    } else if (type === 'bars') {
      const s = chart.addBarSeries({ upColor: UP, downColor: DOWN, priceFormat });
      s.setData(data.map((c) => ({ time: t(c), open: c.open, high: c.high, low: c.low, close: c.close })));
      mainRef.current = s;
    } else if (type === 'line') {
      const s = chart.addLineSeries({ color: '#2962ff', lineWidth: 2, priceFormat });
      s.setData(data.map((c) => ({ time: t(c), value: c.close })));
      mainRef.current = s;
    } else {
      const s = chart.addAreaSeries({ lineColor: '#2962ff', topColor: 'rgba(41,98,255,0.4)', bottomColor: 'rgba(41,98,255,0)', priceFormat });
      s.setData(data.map((c) => ({ time: t(c), value: c.close })));
      mainRef.current = s;
    }
  }

  function drawOverlays() {
    const chart = chartRef.current;
    if (!chart) return;
    handles.current.forEach((h) => h.remove());
    handles.current = [];
    const bars = feed.candles.current;
    if (!bars.length) return;
    handles.current = overlays.map((inst) => {
      const h = createIndicator(chart, inst, { intraday: feed.intraday, overlay: true });
      h.setData(bars);
      return h;
    });
  }

  // Historique (re)chargé ou type changé : tout redessiner
  const overlayKey = JSON.stringify(overlays);
  useEffect(() => {
    drawMain();
    drawOverlays();
    if (feed.loaded) chartRef.current?.timeScale().fitContent();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [feed.loaded]);
  useEffect(() => { drawMain(); drawOverlays(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [type]);
  useEffect(() => { drawOverlays(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [overlayKey]);

  // Mises à jour live : série principale à chaque tick, indicateurs au plus toutes les 400 ms
  useEffect(() => {
    let last = 0, timer: ReturnType<typeof setTimeout> | undefined;
    const refreshOverlays = () => { last = Date.now(); handles.current.forEach((h) => h.updateLast(feed.candles.current)); };
    const off = feed.subscribe((newBar) => {
      const data = feed.candles.current;
      const cur = data[data.length - 1];
      const s = mainRef.current;
      if (!cur || !s) return;
      const time = cur.time as UTCTimestamp;
      const ty = typeRef.current;
      if (ty === 'candles' || ty === 'bars') (s as ISeriesApi<'Candlestick'>).update({ time, open: cur.open, high: cur.high, low: cur.low, close: cur.close });
      else if (ty === 'heikin') {
        const arr = ha.current;
        const sameBar = arr.length && arr[arr.length - 1].time === cur.time;
        const h = haNext(cur, sameBar ? arr[arr.length - 2] ?? null : arr[arr.length - 1] ?? null);
        if (sameBar) arr[arr.length - 1] = h; else arr.push(h);
        (s as ISeriesApi<'Candlestick'>).update({ ...h, time });
      } else (s as ISeriesApi<'Line'>).update({ time, value: cur.close });

      if (newBar || Date.now() - last > THROTTLE_MS) refreshOverlays();
      else if (!timer) timer = setTimeout(() => { timer = undefined; refreshOverlays(); }, THROTTLE_MS);
    });
    return () => { off(); clearTimeout(timer); };
  }, [feed]);

  return (
    <div className="relative flex-1 min-h-0">
      <div ref={box} className="absolute inset-0" />
      {(feed.loading || feed.error) && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <span className={feed.error ? 'text-tv-down' : 'text-tv-muted'}>{feed.error || 'Chargement…'}</span>
        </div>
      )}
    </div>
  );
}
