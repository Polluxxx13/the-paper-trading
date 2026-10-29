import { useEffect, useRef, useState } from 'react';
import { ColorType, createChart, IChartApi, ISeriesApi, UTCTimestamp } from 'lightweight-charts';
import { api } from '../api';

const RANGES = [
  { id: '1d', label: '1J' }, { id: '1w', label: '1S' }, { id: '1m', label: '1M' }, { id: '1y', label: '1A' }, { id: 'all', label: 'Tout' },
];

/** Courbe de la valeur du compte dans le temps (aire), couleur selon gain/perte sur la période. */
export default function EquityChart({ slug, color, refreshKey }: { slug: string; color: string; refreshKey: number }) {
  const box = useRef<HTMLDivElement>(null);
  const chart = useRef<IChartApi | null>(null);
  const series = useRef<ISeriesApi<'Area'> | null>(null);
  const [range, setRange] = useState('1m');
  const [empty, setEmpty] = useState(false);

  useEffect(() => {
    const c = createChart(box.current!, {
      autoSize: true,
      layout: { background: { type: ColorType.Solid, color: '#1e222d' }, textColor: '#d1d4dc' },
      grid: { vertLines: { color: '#2a2e39' }, horzLines: { color: '#2a2e39' } },
      rightPriceScale: { borderColor: '#2a2e39' },
      timeScale: { borderColor: '#2a2e39', timeVisible: true, secondsVisible: false },
    });
    chart.current = c;
    series.current = c.addAreaSeries({ lineWidth: 2, priceFormat: { type: 'price', precision: 2, minMove: 0.01 } });
    return () => { c.remove(); chart.current = null; series.current = null; };
  }, []);

  useEffect(() => {
    let cancelled = false;
    api<{ time: number; value: number }[]>(`/api/accounts/${slug}/equity-curve?range=${range}`).then((pts) => {
      if (cancelled || !series.current) return;
      const shift = -new Date().getTimezoneOffset() * 60; // affichage en heure locale
      const up = pts.length < 2 || pts[pts.length - 1].value >= pts[0].value;
      const c = up ? '#26a69a' : '#ef5350';
      series.current.applyOptions({ lineColor: c, topColor: c + '66', bottomColor: c + '00' });
      series.current.setData(pts.map((p) => ({ time: (p.time + shift) as UTCTimestamp, value: p.value })));
      chart.current?.timeScale().fitContent();
      setEmpty(pts.length < 2);
    }).catch(() => {});
    return () => { cancelled = true; };
  }, [slug, range, refreshKey]);

  return (
    <div className="bg-tv-panel border border-tv-border rounded-lg p-3 flex flex-col h-72">
      <div className="flex items-center gap-1 mb-2">
        <span className="text-sm font-medium mr-3" style={{ color }}>Valeur du compte</span>
        {RANGES.map((r) => (
          <button key={r.id} onClick={() => setRange(r.id)} className={`px-2 py-0.5 rounded text-xs ${range === r.id ? 'bg-tv-blue text-white' : 'text-tv-muted hover:bg-tv-border'}`}>{r.label}</button>
        ))}
        {empty && <span className="ml-3 text-xs text-tv-muted">Pas encore assez de données : la courbe se construit au fil du temps.</span>}
      </div>
      <div ref={box} className="flex-1 min-h-0" />
    </div>
  );
}
