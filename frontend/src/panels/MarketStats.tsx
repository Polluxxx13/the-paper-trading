import { Quote, fmtPrice } from '../market/types';

const dec = new Intl.NumberFormat('fr-CH', { maximumFractionDigits: 2 });
const price = (v: number | null | undefined) => (v == null ? null : fmtPrice(v));
/** Grands nombres en français : k, M, Md (milliard), Bn (billion = 10^12). */
const big = (v: number | null | undefined) => {
  if (v == null) return null;
  const a = Math.abs(v);
  if (a >= 1e12) return `${dec.format(v / 1e12)} Bn`;
  if (a >= 1e9) return `${dec.format(v / 1e9)} Md`;
  if (a >= 1e6) return `${dec.format(v / 1e6)} M`;
  if (a >= 1e3) return `${dec.format(v / 1e3)} k`;
  return dec.format(v);
};

/** Barre d'infos de marché : ouverture, extrêmes du jour et de l'année, volume, capitalisation, ratios. */
export default function MarketStats({ q }: { q: Quote }) {
  const f = q.fundamentals;
  const spread = q.bid != null && q.ask != null ? q.ask - q.bid : null;
  const items: [string, string | null][] = [
    ['Ouverture', price(q.open)],
    ['Plus haut', price(q.high)],
    ['Plus bas', price(q.low)],
    ['Clôture préc.', price(q.prevClose)],
    ['Volume', big(q.volume)],
    ['Vol. moyen', big(f?.avgVolume)],
    ['Achat / Vente', q.bid != null && q.ask != null ? `${fmtPrice(q.bid)} / ${fmtPrice(q.ask)}` : null],
    ['Écart', price(spread)],
    ['52 sem. haut', price(f?.yearHigh)],
    ['52 sem. bas', price(f?.yearLow)],
    ['Capitalisation', big(f?.marketCap)],
    ['PER', f?.pe == null ? null : f.pe.toFixed(2)],
    ['BPA', price(f?.eps)],
    ['Dividende', f?.dividendYield == null ? null : `${f.dividendYield.toFixed(2)} %`],
    ['Bourse', q.exchange || null],
  ];
  const shown = items.filter(([, v]) => v != null);
  const ext = f?.extPrice != null ? f : null;

  return (
    <div className="flex md:flex-wrap items-baseline gap-x-5 gap-y-1 px-3 pb-1.5 text-xs border-b border-tv-border overflow-x-auto md:overflow-visible whitespace-nowrap">
      {ext && (
        <span className="text-tv-muted">
          {ext.extLabel} <span className="text-tv-text">{fmtPrice(ext.extPrice!)}</span>
          {ext.extChangePercent != null && (
            <span className={ext.extChangePercent >= 0 ? 'text-tv-up' : 'text-tv-down'}> {ext.extChangePercent >= 0 ? '+' : ''}{ext.extChangePercent.toFixed(2)}%</span>
          )}
        </span>
      )}
      {shown.map(([label, value]) => (
        <span key={label} className="text-tv-muted whitespace-nowrap">
          {label} <span className="text-tv-text">{value}</span>
        </span>
      ))}
    </div>
  );
}
