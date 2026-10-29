import { useEffect, useState } from 'react';
import type { IChartApi, ISeriesApi, SeriesType } from 'lightweight-charts';

export interface ChartHandle { chart: IChartApi; series: () => ISeriesApi<SeriesType> | null }

/**
 * Incrémente un compteur dès que la vue du graphique change (zoom, défilement, échelle des prix
 * auto-ajustée, redimensionnement) : les couches posées sur le graphique s'en servent pour se redessiner.
 */
export function useViewTick(handle: ChartHandle | null, extra: unknown = 0): number {
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (!handle) return;
    let raf = 0, last = '';
    const loop = () => {
      const s = handle.series();
      const r = handle.chart.timeScale().getVisibleLogicalRange();
      const sig = [r?.from, r?.to, s?.priceToCoordinate(0), s?.priceToCoordinate(1000), handle.chart.priceScale('right').width(), String(extra)].join('|');
      if (sig !== last) { last = sig; setTick((t) => t + 1); }
      raf = requestAnimationFrame(loop);
    };
    loop();
    return () => cancelAnimationFrame(raf);
  }, [handle, extra]);
  return tick;
}
