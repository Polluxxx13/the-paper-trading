export interface Slice { assetClass: string; value: number; pct: number }

const LABEL: Record<string, string> = { cash: 'Cash', equity: 'Actions', etf: 'ETF', index: 'Indices', forex: 'Forex', crypto: 'Crypto', commodity: 'Matières premières', future: 'Futures', other: 'Autre' };
const COLOR: Record<string, string> = { cash: '#787b86', equity: '#2962ff', etf: '#26a69a', index: '#9c27b0', forex: '#ff9800', crypto: '#f7931a', commodity: '#c0a060', future: '#ef5350', other: '#4dd0e1' };

/** Camembert (anneau SVG) de la répartition par classe d'actif, cash inclus. */
export default function AllocationPie({ slices, format }: { slices: Slice[]; format: (n: number) => string }) {
  const R = 60, r = 38, C = 80;
  let angle = -Math.PI / 2;
  const arcs = slices.map((s) => {
    const a0 = angle;
    angle += (s.pct / 100) * 2 * Math.PI;
    const a1 = s.pct >= 99.999 ? a0 + 2 * Math.PI - 0.0001 : angle;
    const p = (rad: number, a: number) => `${C + rad * Math.cos(a)} ${C + rad * Math.sin(a)}`;
    const large = a1 - a0 > Math.PI ? 1 : 0;
    return { s, d: `M ${p(R, a0)} A ${R} ${R} 0 ${large} 1 ${p(R, a1)} L ${p(r, a1)} A ${r} ${r} 0 ${large} 0 ${p(r, a0)} Z` };
  });
  return (
    <div className="bg-tv-panel border border-tv-border rounded-lg p-3 h-72 flex flex-col">
      <div className="text-sm font-medium mb-2">Répartition</div>
      <div className="flex-1 flex items-center gap-4">
        <svg width="160" height="160" viewBox="0 0 160 160" className="shrink-0">
          {arcs.map(({ s, d }) => <path key={s.assetClass} d={d} fill={COLOR[s.assetClass] ?? '#999'}><title>{`${LABEL[s.assetClass] ?? s.assetClass} : ${s.pct.toFixed(1)} %`}</title></path>)}
        </svg>
        <ul className="text-sm space-y-1.5 min-w-0">
          {slices.map((s) => (
            <li key={s.assetClass} className="flex items-center gap-2">
              <span className="w-3 h-3 rounded-sm shrink-0" style={{ background: COLOR[s.assetClass] ?? '#999' }} />
              <span className="truncate">{LABEL[s.assetClass] ?? s.assetClass}</span>
              <span className="ml-auto text-tv-muted pl-2">{s.pct.toFixed(1)} %</span>
              <span className="text-xs text-tv-muted w-24 text-right">{format(s.value)}</span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
