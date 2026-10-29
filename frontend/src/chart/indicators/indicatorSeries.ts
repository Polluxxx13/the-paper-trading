import type { IChartApi, ISeriesApi, SeriesType, UTCTimestamp } from 'lightweight-charts';
import type { Candle } from '../../market/types';
import type { Series } from './calc';
import { IndicatorDef, IndicatorInstance, OutputDef, def as getDef } from './registry';

type Point = { time: UTCTimestamp; value?: number; color?: string };

export interface IndicatorHandle {
  /** Série d'ancre (première sortie), utilisée pour le réticule synchronisé. */
  anchor: ISeriesApi<SeriesType>;
  /** Données de l'ancre, pour retrouver la valeur à un instant donné. */
  anchorData: () => { time: number; value?: number }[];
  /** Recalcule tout et redessine (chargement de l'historique, changement de paramètres). */
  setData: (bars: Candle[]) => void;
  /** Recalcule tout et ne pousse que la dernière valeur (tick live). */
  updateLast: (bars: Candle[]) => void;
  remove: () => void;
}

/**
 * Crée les séries d'un indicateur sur un graphique. Les valeurs non définies deviennent des points
 * « blancs » ({time} seul) : chaque série couvre toutes les bougies, ce qui garde les index
 * logiques identiques entre graphiques et permet la synchronisation du zoom.
 */
export function createIndicator(chart: IChartApi, inst: IndicatorInstance, ctx: { intraday: boolean; overlay: boolean }): IndicatorHandle {
  const d: IndicatorDef = getDef(inst.type);
  const priceFormat = d.id === 'volume' || d.id === 'obv' ? ({ type: 'volume' } as const) : undefined;

  const handles = d.outputs.map((o: OutputDef) => {
    let s: ISeriesApi<SeriesType>;
    if (o.kind === 'histogram') {
      s = chart.addHistogramSeries({
        color: o.color, lastValueVisible: false, priceLineVisible: false,
        priceFormat: priceFormat ?? { type: 'price', precision: 4, minMove: 0.0001 },
        ...(d.id === 'volume' ? { priceScaleId: 'volume' } : {}),
      });
      if (d.id === 'volume') chart.priceScale('volume').applyOptions({ scaleMargins: { top: 0.8, bottom: 0 } }); // bas du graphique
    } else {
      s = chart.addLineSeries({
        color: o.color, lineWidth: (o.width ?? 2) as 1 | 2, priceLineVisible: false, lastValueVisible: !ctx.overlay,
        crosshairMarkerVisible: false, title: ctx.overlay ? '' : o.label,
        ...(o.kind === 'dots' ? { lineVisible: false, pointMarkersVisible: true, pointMarkersRadius: 2 } : {}),
        ...(priceFormat ? { priceFormat } : {}),
      } as never);
    }
    return { o, s };
  });

  if (!ctx.overlay && d.levels) d.levels.forEach((price) => handles[0].s.createPriceLine({ price, color: '#4c525e', lineWidth: 1, lineStyle: 2, axisLabelVisible: false, title: '' }));

  let cache: Record<string, Series> = {};
  const toPoints = (bars: Candle[], o: OutputDef, values: Series): Point[] =>
    bars.map((b, i) => {
      const v = values[i];
      if (v === null || v === undefined || !Number.isFinite(v)) return { time: b.time as UTCTimestamp };
      return o.colorFn ? { time: b.time as UTCTimestamp, value: v, color: o.colorFn(v, i, bars) } : { time: b.time as UTCTimestamp, value: v };
    });

  const compute = (bars: Candle[]) => (cache = d.compute(bars, inst.params, { intraday: ctx.intraday }));
  let anchorPoints: Point[] = [];

  return {
    anchor: handles[0].s,
    anchorData: () => anchorPoints,
    setData(bars) {
      compute(bars);
      handles.forEach(({ o, s }, k) => {
        const pts = toPoints(bars, o, cache[o.key] ?? []);
        if (k === 0) anchorPoints = pts;
        (s as ISeriesApi<'Line'>).setData(pts as never);
      });
    },
    updateLast(bars) {
      if (!bars.length) return;
      compute(bars);
      const i = bars.length - 1;
      handles.forEach(({ o, s }, k) => {
        const p = toPoints([bars[i]], o, [cache[o.key]?.[i] ?? null].concat([]))[0];
        const withColor = o.colorFn && p.value !== undefined ? { ...p, color: o.colorFn(p.value, i, bars) } : p;
        (s as ISeriesApi<'Line'>).update(withColor as never);
        if (k === 0) {
          if (anchorPoints.length && anchorPoints[anchorPoints.length - 1].time === withColor.time) anchorPoints[anchorPoints.length - 1] = withColor;
          else anchorPoints.push(withColor);
        }
      });
    },
    remove() {
      handles.forEach(({ s }) => { try { chart.removeSeries(s); } catch { /* graphique détruit */ } });
    },
  };
}
