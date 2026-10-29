import { useCallback, useEffect, useState } from 'react';
import { Account, api } from '../api';
import { fmtPrice } from '../market/types';
import { onTrade, useSubscription } from '../market/socket';
import { Position, livePnl } from '../trading/useAccount';
import { useQuoteTick } from '../trading/useQuoteTick';
import AllocationPie, { Slice } from './AllocationPie';
import EquityChart from './EquityChart';
import TradeHistory from './TradeHistory';

interface Summary { cash: number; positionsValue: number; unrealizedPnl: number; unrealizedPct: number; realizedPnl: number; equity: number; totalPnl: number; totalPnlPct: number; initialCapital: number }
interface Stats { trades: number; wins: number; losses: number; winRate: number | null; avgWin: number | null; avgLoss: number | null; profitFactor: number | null; bestTrade: number | null; worstTrade: number | null; expectancy: number | null; totalFees: number; maxDrawdown: number; maxDrawdownPct: number }
interface Portfolio { summary: Summary; positions: Position[]; allocation: Slice[] }

const Card = ({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: number }) => (
  <div className="bg-tv-panel border border-tv-border rounded-lg px-4 py-3">
    <div className="text-xs text-tv-muted">{label}</div>
    <div className={`text-xl font-semibold ${tone === undefined ? '' : tone >= 0 ? 'text-tv-up' : 'text-tv-down'}`}>{value}</div>
    {sub && <div className={`text-xs ${tone === undefined ? 'text-tv-muted' : tone >= 0 ? 'text-tv-up' : 'text-tv-down'}`}>{sub}</div>}
  </div>
);

function Row({ p, equity, money }: { p: Position; equity: number; money: (n: number) => string }) {
  useQuoteTick(p.symbol);
  const l = livePnl(p);
  return (
    <tr className="border-t border-tv-border/50">
      <td className="px-3 py-1.5 font-medium">{p.symbol}<div className="text-xs text-tv-muted font-normal">{p.name}</div></td>
      <td className={`px-3 py-1.5 ${p.quantity > 0 ? 'text-tv-up' : 'text-tv-down'}`}>{p.quantity > 0 ? 'Long' : 'Short'} {Math.abs(p.quantity)}</td>
      <td className="px-3 py-1.5">{fmtPrice(p.avgPrice)}</td>
      <td className="px-3 py-1.5">{fmtPrice(l.price)}</td>
      <td className="px-3 py-1.5">{money(l.marketValue)}</td>
      <td className={`px-3 py-1.5 ${l.pnl >= 0 ? 'text-tv-up' : 'text-tv-down'}`}>{money(l.pnl)} ({l.pct.toFixed(2)} %)</td>
      <td className="px-3 py-1.5">{equity ? ((l.marketValue / equity) * 100).toFixed(1) : '0'} %</td>
    </tr>
  );
}

/** Onglet Portfolio du compte actif : synthèse, positions live, courbe, répartition, statistiques, historique. */
export default function PortfolioView({ account }: { account: Account }) {
  const [pf, setPf] = useState<Portfolio | null>(null);
  const [stats, setStats] = useState<Stats | null>(null);
  const [tick, setTick] = useState(0); // incrémenté à chaque rechargement pour rafraîchir les sous-composants
  const [error, setError] = useState('');
  const cur = account.baseCurrency;
  const money = (n: number) => n.toLocaleString('fr-CH', { style: 'currency', currency: cur });

  const load = useCallback(async () => {
    try {
      const [p, s] = await Promise.all([api<Portfolio>(`/api/accounts/${account.slug}/portfolio`), api<Stats>(`/api/accounts/${account.slug}/stats`)]);
      setPf(p); setStats(s); setTick((t) => t + 1); setError('');
    } catch (e) { setError((e as Error).message); }
  }, [account.slug]);

  useEffect(() => {
    load();
    const off = onTrade((a) => a === account.slug && load());
    const t = setInterval(load, 15_000);
    return () => { off(); clearInterval(t); };
  }, [account.slug, load]);

  useSubscription(pf?.positions.map((p) => p.symbol) ?? []);

  if (!pf || !stats) return <div className="flex-1 flex items-center justify-center text-tv-muted">{error || 'Chargement…'}</div>;
  const s = pf.summary;
  const pct = (n: number | null, d = 1) => (n === null ? '–' : `${n.toFixed(d)} %`);

  return (
    <div className="flex-1 overflow-auto p-4 space-y-4">
      <div className="grid grid-cols-2 lg:grid-cols-6 gap-3">
        <Card label="Valeur totale" value={money(s.equity)} sub={`Capital initial ${money(s.initialCapital)}`} />
        <Card label="Cash disponible" value={money(s.cash)} />
        <Card label="Valeur investie" value={money(s.positionsValue)} />
        <Card label="P&L latent" value={money(s.unrealizedPnl)} sub={`${s.unrealizedPct.toFixed(2)} %`} tone={s.unrealizedPnl} />
        <Card label="P&L réalisé" value={money(s.realizedPnl)} sub={`${((s.realizedPnl / s.initialCapital) * 100).toFixed(2)} %`} tone={s.realizedPnl} />
        <Card label="P&L total" value={money(s.totalPnl)} sub={`${s.totalPnlPct.toFixed(2)} %`} tone={s.totalPnl} />
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        <div className="xl:col-span-2"><EquityChart slug={account.slug} color={account.color} refreshKey={tick} /></div>
        <AllocationPie slices={pf.allocation} format={money} />
      </div>

      <div className="bg-tv-panel border border-tv-border rounded-lg">
        <div className="p-3 text-sm font-medium border-b border-tv-border">Positions ouvertes ({pf.positions.length})</div>
        <div className="overflow-auto">
          <table className="w-full text-sm">
            <thead><tr className="text-tv-muted text-left">{['Symbole', 'Position', 'Prix moyen', 'Prix actuel', 'Valeur', 'P&L', 'Poids'].map((h) => <th key={h} className="font-normal px-3 py-1.5">{h}</th>)}</tr></thead>
            <tbody>
              {pf.positions.map((p) => <Row key={p.symbol} p={p} equity={s.equity} money={money} />)}
              {!pf.positions.length && <tr><td className="px-3 py-3 text-tv-muted" colSpan={7}>Aucune position ouverte.</td></tr>}
            </tbody>
          </table>
        </div>
      </div>

      <div className="bg-tv-panel border border-tv-border rounded-lg p-3">
        <div className="text-sm font-medium mb-2">Statistiques <span className="text-tv-muted font-normal">({stats.trades} trades clôturés)</span></div>
        <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-3 text-sm">
          {[
            ['Taux de réussite', pct(stats.winRate)],
            ['Gain moyen', stats.avgWin === null ? '–' : money(stats.avgWin)],
            ['Perte moyenne', stats.avgLoss === null ? '–' : money(stats.avgLoss)],
            ['Profit factor', stats.profitFactor === null ? (stats.wins ? '∞' : '–') : stats.profitFactor.toFixed(2)],
            ['Drawdown max', `${money(stats.maxDrawdown)} (${stats.maxDrawdownPct.toFixed(2)} %)`],
            ['Espérance / trade', stats.expectancy === null ? '–' : money(stats.expectancy)],
            ['Meilleur trade', stats.bestTrade === null ? '–' : money(stats.bestTrade)],
            ['Pire trade', stats.worstTrade === null ? '–' : money(stats.worstTrade)],
            ['Gagnants / perdants', `${stats.wins} / ${stats.losses}`],
            ['Frais totaux', money(stats.totalFees)],
          ].map(([k, v]) => <div key={k}><div className="text-xs text-tv-muted">{k}</div><div className="font-medium">{v}</div></div>)}
        </div>
      </div>

      <TradeHistory slug={account.slug} currency={cur} refreshKey={tick} />
    </div>
  );
}
