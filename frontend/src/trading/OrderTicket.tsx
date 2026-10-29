import { useState } from 'react';
import { api } from '../api';
import type { Account } from '../api';
import { fmtPrice } from '../market/types';
import { useQuote } from '../market/socket';

const TYPES = [
  { id: 'market', label: 'Marché' },
  { id: 'limit', label: 'Limite' },
  { id: 'stop', label: 'Stop' },
  { id: 'stop_limit', label: 'Stop-limite' },
  { id: 'trailing_stop', label: 'Trailing stop' },
  { id: 'take_profit', label: 'Take-profit (position)' },
  { id: 'stop_loss', label: 'Stop-loss (position)' },
];

const num = (s: string) => (s.trim() === '' ? undefined : Number(s.replace(',', '.')));

const Field = ({ label, value, onChange, step = 'any' }: { label: string; value: string; onChange: (v: string) => void; step?: string }) => (
  <label className="flex flex-col gap-1 text-xs text-tv-muted">
    {label}
    <input type="number" step={step} value={value} onChange={(e) => onChange(e.target.value)} className="w-28 bg-tv-bg border border-tv-border rounded px-2 py-1 text-sm text-tv-text outline-none focus:border-tv-blue" />
  </label>
);

/** Formulaire d'ordre pour le symbole affiché : tous les types, TP/SL attachés, trailing. */
export default function OrderTicket({ account, symbol, onDone }: { account: Account; symbol: string; onDone: () => void }) {
  const q = useQuote(symbol);
  const [side, setSide] = useState<'buy' | 'sell'>('buy');
  const [type, setType] = useState('market');
  const [qty, setQty] = useState('1');
  const [limit, setLimit] = useState('');
  const [stop, setStop] = useState('');
  const [trailAmt, setTrailAmt] = useState('');
  const [trailPct, setTrailPct] = useState('');
  const [tp, setTp] = useState('');
  const [sl, setSl] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const fractional = q?.assetClass === 'crypto' || q?.assetClass === 'forex';
  const needLimit = type === 'limit' || type === 'stop_limit' || type === 'take_profit';
  const needStop = type === 'stop' || type === 'stop_limit' || type === 'stop_loss';
  const reduceOnly = type === 'take_profit' || type === 'stop_loss';
  const ref = num(limit) ?? num(stop) ?? q?.price ?? 0;
  const estimate = (num(qty) ?? 0) * ref;

  async function submit() {
    setBusy(true);
    setMsg(null);
    try {
      const o = await api<{ status: string; avgFillPrice: number | null }>(`/api/accounts/${account.slug}/orders`, {
        method: 'POST',
        body: {
          symbol, side, type, quantity: num(qty),
          limitPrice: needLimit ? num(limit) : undefined,
          stopPrice: needStop ? num(stop) : undefined,
          trailAmount: type === 'trailing_stop' ? num(trailAmt) : undefined,
          trailPercent: type === 'trailing_stop' ? num(trailPct) : undefined,
          takeProfit: !reduceOnly ? num(tp) : undefined,
          stopLoss: !reduceOnly ? num(sl) : undefined,
        },
      });
      setMsg({ ok: true, text: o.status === 'filled' ? `Exécuté à ${fmtPrice(o.avgFillPrice ?? 0)}` : 'Ordre placé (en attente)' });
      onDone();
    } catch (e) {
      setMsg({ ok: false, text: (e as Error).message });
      onDone();
    } finally {
      setBusy(false);
    }
  }

  const sideBtn = (s: 'buy' | 'sell', label: string, color: string) => (
    <button onClick={() => setSide(s)} className="px-4 py-1.5 rounded text-sm font-semibold border" style={side === s ? { background: color, borderColor: color, color: '#fff' } : { borderColor: '#2a2e39', color: '#787b86' }}>{label}</button>
  );

  return (
    <div className="flex flex-wrap items-end gap-3 p-3">
      <div className="flex flex-col gap-1">
        <span className="text-xs text-tv-muted">Compte <b style={{ color: account.color }}>{account.name}</b> · {symbol}</span>
        <div className="flex gap-1">{sideBtn('buy', 'Acheter', '#26a69a')}{sideBtn('sell', 'Vendre', '#ef5350')}</div>
      </div>
      <label className="flex flex-col gap-1 text-xs text-tv-muted">
        Type
        <select value={type} onChange={(e) => setType(e.target.value)} className="bg-tv-bg border border-tv-border rounded px-2 py-1 text-sm text-tv-text">
          {TYPES.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
        </select>
      </label>
      <Field label="Quantité" value={qty} onChange={setQty} step={fractional ? '0.00000001' : '1'} />
      {needLimit && <Field label="Prix limite" value={limit} onChange={setLimit} />}
      {needStop && <Field label="Prix stop" value={stop} onChange={setStop} />}
      {type === 'trailing_stop' && (<><Field label="Distance (montant)" value={trailAmt} onChange={setTrailAmt} /><Field label="ou distance (%)" value={trailPct} onChange={setTrailPct} /></>)}
      {!reduceOnly && (<><Field label="Take-profit (opt.)" value={tp} onChange={setTp} /><Field label="Stop-loss (opt.)" value={sl} onChange={setSl} /></>)}
      <button disabled={busy || !num(qty)} onClick={submit} className="px-5 py-1.5 rounded font-semibold text-white disabled:opacity-50" style={{ background: side === 'buy' ? '#26a69a' : '#ef5350' }}>
        {side === 'buy' ? 'Acheter' : 'Vendre'} {q ? `@ ${fmtPrice(q.price)}` : ''}
      </button>
      <span className="text-xs text-tv-muted pb-2">≈ {estimate.toLocaleString('fr-CH', { maximumFractionDigits: 2 })} {q?.currency}</span>
      {msg && <span className={`text-sm pb-1.5 ${msg.ok ? 'text-tv-up' : 'text-tv-down'}`}>{msg.text}</span>}
    </div>
  );
}
