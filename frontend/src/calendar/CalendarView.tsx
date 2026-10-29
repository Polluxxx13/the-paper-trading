import { useEffect, useMemo, useState } from 'react';
import { Account, api } from '../api';
import { fmtPrice } from '../market/types';
import { onTrade } from '../market/socket';

interface Day { date: string; equity: number; base: number; pnl: number; pct: number; trades: number; realized: number; active: boolean }
interface Summary { pnl: number; pct: number; winDays: number; loseDays: number; trades: number; bestDay: Day | null; worstDay: Day | null }
interface MonthData { month: string; days: Day[]; summary: Summary }
interface YearData { year: string; months: ({ month: string; hasData: boolean } & Summary)[]; summary: Summary }
interface DayDetail { date: string; day: Day | null; trades: { id: number; symbol: string; side: 'buy' | 'sell'; quantity: number; price: number; currency: string; fees: number; realizedPnl: number; isClose: boolean; executedAt: string }[] }

const MONTHS = ['Janvier', 'Février', 'Mars', 'Avril', 'Mai', 'Juin', 'Juillet', 'Août', 'Septembre', 'Octobre', 'Novembre', 'Décembre'];
const WEEKDAYS = ['Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam', 'Dim'];
const EPS = 0.005;

const pad = (n: number) => String(n).padStart(2, '0');
const sign = (n: number) => (n > 0 ? '+' : '');

/** Fond vert / rouge dont l'intensité suit l'amplitude du gain ou de la perte ; gris sans activité. */
function tint(pnl: number, max: number, active: boolean): React.CSSProperties {
  if (!active || Math.abs(pnl) <= EPS) return { background: '#2a2e39' };
  const a = 0.18 + 0.5 * Math.min(1, Math.abs(pnl) / (max || 1));
  return { background: pnl > 0 ? `rgba(38,166,154,${a})` : `rgba(239,83,80,${a})` };
}

export default function CalendarView({ account }: { account: Account }) {
  const now = new Date();
  const [mode, setMode] = useState<'month' | 'year'>('month');
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth()); // 0-11
  const [data, setData] = useState<MonthData | null>(null);
  const [yearData, setYearData] = useState<YearData | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [detail, setDetail] = useState<DayDetail | null>(null);
  const [tick, setTick] = useState(0);
  const [error, setError] = useState('');
  const cur = account.baseCurrency;
  const money = (n: number) => `${sign(n)}${n.toLocaleString('fr-CH', { style: 'currency', currency: cur })}`;
  const key = `${year}-${pad(month + 1)}`;

  useEffect(() => onTrade((a) => a === account.slug && setTick((t) => t + 1)), [account.slug]);
  useEffect(() => { const t = setInterval(() => setTick((x) => x + 1), 30_000); return () => clearInterval(t); }, []);

  useEffect(() => {
    if (mode !== 'month') return;
    api<MonthData>(`/api/accounts/${account.slug}/calendar?month=${key}`).then((d) => { setData(d); setError(''); }).catch((e) => setError(e.message));
  }, [account.slug, mode, key, tick]);

  useEffect(() => {
    if (mode !== 'year') return;
    api<YearData>(`/api/accounts/${account.slug}/calendar/year?year=${year}`).then((d) => { setYearData(d); setError(''); }).catch((e) => setError(e.message));
  }, [account.slug, mode, year, tick]);

  useEffect(() => {
    if (!selected) return setDetail(null);
    api<DayDetail>(`/api/accounts/${account.slug}/calendar/day?date=${selected}`).then(setDetail).catch(() => setDetail(null));
  }, [account.slug, selected, tick]);

  function shiftMonth(delta: number) {
    const d = new Date(year, month + delta, 1);
    setYear(d.getFullYear()); setMonth(d.getMonth()); setSelected(null);
  }

  // Grille du mois, semaine commençant le lundi
  const cells = useMemo(() => {
    const first = new Date(year, month, 1);
    const lead = (first.getDay() + 6) % 7;
    const count = new Date(year, month + 1, 0).getDate();
    return [...Array(lead).fill(null), ...Array.from({ length: count }, (_, i) => `${year}-${pad(month + 1)}-${pad(i + 1)}`)];
  }, [year, month]);

  const byDate = useMemo(() => new Map((data?.days ?? []).map((d) => [d.date, d])), [data]);
  const maxAbs = Math.max(0, ...(data?.days ?? []).map((d) => Math.abs(d.pnl)));
  const s = mode === 'month' ? data?.summary : yearData?.summary;

  const navBtn = 'px-3 py-1 rounded border border-tv-border hover:border-tv-blue text-sm';

  return (
    <div className="flex-1 overflow-auto p-4 space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex gap-1">
          {(['month', 'year'] as const).map((m) => (
            <button key={m} onClick={() => { setMode(m); setSelected(null); }} className={`px-3 py-1 rounded text-sm ${mode === m ? 'bg-tv-blue text-white' : 'text-tv-muted hover:bg-tv-border'}`}>{m === 'month' ? 'Mois' : 'Année'}</button>
          ))}
        </div>
        <button className={navBtn} onClick={() => (mode === 'month' ? shiftMonth(-1) : setYear(year - 1))}>‹</button>
        <h2 className="text-lg font-semibold w-44 text-center">{mode === 'month' ? `${MONTHS[month]} ${year}` : year}</h2>
        <button className={navBtn} onClick={() => (mode === 'month' ? shiftMonth(1) : setYear(year + 1))}>›</button>
        <button className={navBtn} onClick={() => { setYear(now.getFullYear()); setMonth(now.getMonth()); setSelected(null); }}>Aujourd'hui</button>
        {error && <span className="text-sm text-tv-down">{error}</span>}
      </div>

      {s && (
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
          <div className="bg-tv-panel border border-tv-border rounded-lg px-4 py-3">
            <div className="text-xs text-tv-muted">{mode === 'month' ? 'Total du mois' : "Total de l'année"}</div>
            <div className={`text-xl font-semibold ${s.pnl >= 0 ? 'text-tv-up' : 'text-tv-down'}`}>{money(s.pnl)}</div>
            <div className={`text-xs ${s.pnl >= 0 ? 'text-tv-up' : 'text-tv-down'}`}>{sign(s.pct)}{s.pct.toFixed(2)} %</div>
          </div>
          <div className="bg-tv-panel border border-tv-border rounded-lg px-4 py-3"><div className="text-xs text-tv-muted">Jours gagnants</div><div className="text-xl font-semibold text-tv-up">{s.winDays}</div></div>
          <div className="bg-tv-panel border border-tv-border rounded-lg px-4 py-3"><div className="text-xs text-tv-muted">Jours perdants</div><div className="text-xl font-semibold text-tv-down">{s.loseDays}</div></div>
          <div className="bg-tv-panel border border-tv-border rounded-lg px-4 py-3"><div className="text-xs text-tv-muted">Meilleur jour</div><div className="font-semibold text-tv-up">{s.bestDay ? money(s.bestDay.pnl) : '–'}</div><div className="text-xs text-tv-muted">{s.bestDay?.date ?? ''}</div></div>
          <div className="bg-tv-panel border border-tv-border rounded-lg px-4 py-3"><div className="text-xs text-tv-muted">Pire jour</div><div className="font-semibold text-tv-down">{s.worstDay ? money(s.worstDay.pnl) : '–'}</div><div className="text-xs text-tv-muted">{s.worstDay?.date ?? ''}</div></div>
        </div>
      )}

      {mode === 'month' && (
        <div className="grid grid-cols-7 gap-1.5">
          {WEEKDAYS.map((w) => <div key={w} className="text-center text-xs text-tv-muted pb-1">{w}</div>)}
          {cells.map((date, i) => {
            if (!date) return <div key={`b${i}`} />;
            const d = byDate.get(date);
            const active = !!d?.active;
            const isSel = selected === date;
            return (
              <button
                key={date}
                onClick={() => setSelected(isSel ? null : date)}
                style={{ ...tint(d?.pnl ?? 0, maxAbs, active), outline: isSel ? `2px solid ${account.color}` : undefined }}
                className="h-24 rounded p-2 text-left flex flex-col hover:brightness-125 transition"
                title={d ? `Valeur du compte : ${d.equity.toLocaleString('fr-CH', { style: 'currency', currency: cur })}` : 'Pas de snapshot ce jour'}
              >
                <span className="text-xs text-tv-muted">{Number(date.slice(8))}</span>
                {active && d ? (
                  <>
                    <span className="mt-auto text-sm font-semibold">{money(d.pnl)}</span>
                    <span className="text-xs opacity-80">{sign(d.pct)}{d.pct.toFixed(2)} %{d.trades ? ` · ${d.trades} tr.` : ''}</span>
                  </>
                ) : <span className="mt-auto text-xs text-tv-muted">{d ? 'Aucune activité' : ''}</span>}
              </button>
            );
          })}
        </div>
      )}

      {mode === 'year' && yearData && (
        <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-4 gap-3">
          {yearData.months.map((m, i) => {
            const max = Math.max(0, ...yearData.months.map((x) => Math.abs(x.pnl)));
            return (
              <button
                key={m.month}
                onClick={() => { setMonth(i); setMode('month'); setSelected(null); }}
                style={tint(m.pnl, max, m.hasData)}
                className="rounded-lg p-4 text-left h-28 flex flex-col hover:brightness-125 transition"
              >
                <span className="text-sm font-medium">{MONTHS[i]}</span>
                {m.hasData ? (
                  <>
                    <span className="mt-auto text-lg font-semibold">{money(m.pnl)}</span>
                    <span className="text-xs opacity-80">{sign(m.pct)}{m.pct.toFixed(2)} % · {m.winDays}↑ {m.loseDays}↓</span>
                  </>
                ) : <span className="mt-auto text-xs text-tv-muted">Aucune donnée</span>}
              </button>
            );
          })}
        </div>
      )}

      {mode === 'month' && selected && (
        <div className="bg-tv-panel border border-tv-border rounded-lg" style={{ borderColor: account.color }}>
          <div className="flex items-center gap-4 p-3 border-b border-tv-border">
            <span className="font-medium">{new Date(selected + 'T12:00:00').toLocaleDateString('fr-CH', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}</span>
            {detail?.day && <span className={detail.day.pnl >= 0 ? 'text-tv-up' : 'text-tv-down'}>{money(detail.day.pnl)} ({sign(detail.day.pct)}{detail.day.pct.toFixed(2)} %)</span>}
            {detail?.day && <span className="text-xs text-tv-muted">Valeur du compte {detail.day.equity.toLocaleString('fr-CH', { style: 'currency', currency: cur })}</span>}
            <button onClick={() => setSelected(null)} className="ml-auto text-tv-muted hover:text-tv-text">✕</button>
          </div>
          <table className="w-full text-sm">
            <thead><tr className="text-tv-muted text-left">{['Heure', 'Symbole', 'Sens', 'Qté', 'Prix', 'Frais', 'P&L réalisé'].map((h) => <th key={h} className="font-normal px-3 py-1.5">{h}</th>)}</tr></thead>
            <tbody>
              {detail?.trades.map((t) => (
                <tr key={t.id} className="border-t border-tv-border/50">
                  <td className="px-3 py-1.5">{new Date(t.executedAt).toLocaleTimeString('fr-CH')}</td>
                  <td className="px-3 py-1.5 font-medium">{t.symbol}</td>
                  <td className={`px-3 py-1.5 ${t.side === 'buy' ? 'text-tv-up' : 'text-tv-down'}`}>{t.side === 'buy' ? 'Achat' : 'Vente'}</td>
                  <td className="px-3 py-1.5">{t.quantity}</td>
                  <td className="px-3 py-1.5">{fmtPrice(t.price)} {t.currency}</td>
                  <td className="px-3 py-1.5">{t.fees ? t.fees.toLocaleString('fr-CH', { style: 'currency', currency: cur }) : '–'}</td>
                  <td className={`px-3 py-1.5 ${t.realizedPnl >= 0 ? 'text-tv-up' : 'text-tv-down'}`}>{t.isClose || t.realizedPnl ? money(t.realizedPnl) : '–'}</td>
                </tr>
              ))}
              {detail && !detail.trades.length && <tr><td className="px-3 py-3 text-tv-muted" colSpan={7}>Aucun trade ce jour-là.</td></tr>}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
