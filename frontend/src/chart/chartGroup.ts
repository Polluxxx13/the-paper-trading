import type { IChartApi, ISeriesApi, SeriesType, Time } from 'lightweight-charts';

interface Member {
  chart: IChartApi;
  series: () => ISeriesApi<SeriesType> | null; // série servant d'ancre au réticule
  valueAt: (time: number) => number | undefined;
}

/**
 * Synchronise plusieurs graphiques (prix + panneaux d'indicateurs, bientôt les mises en page 2/4) :
 * même plage visible (zoom / défilement) et réticule commun.
 */
export class ChartGroup {
  private members = new Set<Member>();
  private syncing = false;
  private applying = false;
  /** Appelé quand le réticule bouge sous la souris (temps affiché ou null) : sert à synchroniser d'autres graphiques. */
  onCrosshair?: (time: number | null) => void;

  /** Place (ou efface) le réticule sur tous les membres, sauf `except`. */
  applyCrosshair(time: number | null, except?: Member) {
    this.applying = true;
    try {
      this.members.forEach((o) => {
        if (o === except) return;
        const s = o.series();
        const v = time === null || !s ? undefined : o.valueAt(time);
        if (v === undefined || !s || time === null) o.chart.clearCrosshairPosition();
        else o.chart.setCrosshairPosition(v, time as Time, s);
      });
    } finally { this.applying = false; }
  }

  add(m: Member): () => void {
    this.members.add(m);
    const onRange = (range: { from: number; to: number } | null) => {
      if (this.syncing || !range) return;
      this.syncing = true;
      this.members.forEach((o) => o !== m && o.chart.timeScale().setVisibleLogicalRange(range));
      this.syncing = false;
    };
    const onCross = (p: { time?: Time; sourceEvent?: unknown }) => {
      // Ignore les échos : positions posées par programme (pas d'événement souris) ou appliquées par le groupe
      if (this.applying || (p.time && !p.sourceEvent)) return;
      const t = p.time ? (p.time as number) : null;
      this.applyCrosshair(t, m);
      this.onCrosshair?.(t);
    };
    m.chart.timeScale().subscribeVisibleLogicalRangeChange(onRange);
    m.chart.subscribeCrosshairMove(onCross);
    // Aligne un nouveau membre sur la plage des autres
    const other = [...this.members].find((o) => o !== m);
    const r = other?.chart.timeScale().getVisibleLogicalRange();
    if (r) m.chart.timeScale().setVisibleLogicalRange(r);
    return () => {
      this.members.delete(m);
      try {
        m.chart.timeScale().unsubscribeVisibleLogicalRangeChange(onRange);
        m.chart.unsubscribeCrosshairMove(onCross);
      } catch { /* graphique déjà détruit */ }
    };
  }
}

/** Valeur d'une série {time,value} triée à un instant donné (recherche dichotomique). */
export function valueAtTime(data: { time: number; value?: number }[], time: number): number | undefined {
  let lo = 0, hi = data.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (data[mid].time === time) return data[mid].value;
    if (data[mid].time < time) lo = mid + 1; else hi = mid - 1;
  }
  return undefined;
}
