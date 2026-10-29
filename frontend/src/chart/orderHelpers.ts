/** Logique pure des ordres passés depuis le graphique (clic droit, position dessinée) et des mises en page. */

export interface OrderBody {
  symbol: string;
  side: 'buy' | 'sell';
  type: 'market' | 'limit' | 'stop' | 'take_profit' | 'stop_loss';
  quantity: number;
  limitPrice?: number;
  stopPrice?: number;
  takeProfit?: number;
  stopLoss?: number;
}

export interface MenuAction { label: string; body: OrderBody; tone: 'buy' | 'sell' | 'neutral' }

const fmt = (n: number) => (Math.abs(n) >= 10 ? n.toFixed(2) : Math.abs(n) >= 1 ? n.toFixed(4) : n.toFixed(6));

/** Quantité proposée par défaut : fractions pour crypto/forex, entiers sinon. */
export function defaultQty(assetClass: string | undefined): number {
  return assetClass === 'crypto' ? 0.01 : assetClass === 'forex' ? 1000 : 1;
}

/**
 * Actions du menu clic droit à un prix donné. Achat/vente à cours limité ou stop selon le côté du prix
 * actuel ; si une position existe, propose aussi TP et SL sur toute la position (ordres « réduction seule »).
 */
export function contextActions(symbol: string, price: number, last: number, qty: number, position: number): MenuAction[] {
  const p = Number(price.toPrecision(10));
  const acts: MenuAction[] = [
    { label: `Acheter au marché · ${qty}`, tone: 'buy', body: { symbol, side: 'buy', type: 'market', quantity: qty } },
    { label: `Vendre au marché · ${qty}`, tone: 'sell', body: { symbol, side: 'sell', type: 'market', quantity: qty } },
  ];
  // Un prix sous le marché : achat = limite, vente = stop ; au-dessus : achat = stop, vente = limite
  const below = p < last;
  acts.push(
    below
      ? { label: `Acheter limite @ ${fmt(p)}`, tone: 'buy', body: { symbol, side: 'buy', type: 'limit', quantity: qty, limitPrice: p } }
      : { label: `Acheter stop @ ${fmt(p)}`, tone: 'buy', body: { symbol, side: 'buy', type: 'stop', quantity: qty, stopPrice: p } },
    below
      ? { label: `Vendre stop @ ${fmt(p)}`, tone: 'sell', body: { symbol, side: 'sell', type: 'stop', quantity: qty, stopPrice: p } }
      : { label: `Vendre limite @ ${fmt(p)}`, tone: 'sell', body: { symbol, side: 'sell', type: 'limit', quantity: qty, limitPrice: p } },
  );
  if (position !== 0) {
    const long = position > 0, size = Math.abs(position);
    const exit = long ? 'sell' : 'buy';
    const tpOk = long ? p > last : p < last;
    acts.push(tpOk
      ? { label: `Take-profit position @ ${fmt(p)}`, tone: 'neutral', body: { symbol, side: exit, type: 'take_profit', quantity: size, limitPrice: p } }
      : { label: `Stop-loss position @ ${fmt(p)}`, tone: 'neutral', body: { symbol, side: exit, type: 'stop_loss', quantity: size, stopPrice: p } });
  }
  return acts;
}

/** Ordre issu d'une position dessinée (entrée, cible, stop) : au marché si l'entrée est collée au prix, sinon limite. */
export function orderFromPosition(symbol: string, tool: 'long' | 'short', entry: number, target: number, stop: number, last: number, qty: number): OrderBody {
  const atMarket = Math.abs(entry - last) / last < 0.0005;
  return {
    symbol, side: tool === 'long' ? 'buy' : 'sell', type: atMarket ? 'market' : 'limit', quantity: qty,
    ...(atMarket ? {} : { limitPrice: Number(entry.toPrecision(10)) }),
    takeProfit: Number(target.toPrecision(10)), stopLoss: Number(stop.toPrecision(10)),
  };
}

/** Bougie la plus proche d'un instant (pour recaler le réticule d'un graphique sur un autre). */
export function nearestBar<T extends { time: number }>(bars: T[], time: number, maxGapSec: number): T | null {
  if (!bars.length) return null;
  let lo = 0, hi = bars.length - 1;
  while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (bars[mid].time <= time) lo = mid; else hi = mid; }
  const best = Math.abs(bars[lo].time - time) <= Math.abs(bars[hi].time - time) ? bars[lo] : bars[hi];
  return Math.abs(best.time - time) <= maxGapSec ? best : null;
}

// ── Mises en page ──
export type LayoutId = '1' | '2' | '4';
export interface Cell { symbol: string; tf: string; type: string }

export const cellCount = (l: LayoutId) => Number(l);

/** Ajuste la liste de cellules au nombre voulu : les nouvelles copient la cellule active ; on garde l'ordre existant. */
export function resizeCells(cells: Cell[], layout: LayoutId, active: number): Cell[] {
  const n = cellCount(layout);
  const out = cells.slice(0, n);
  while (out.length < n) out.push({ ...(cells[active] ?? cells[0]) });
  return out;
}

/** Layout autorisé selon la largeur disponible : 4 graphiques nécessitent ≥ 1100 px, 2 nécessitent ≥ 700 px. */
export function allowedLayout(wanted: LayoutId, width: number): LayoutId {
  if (width < 700) return '1';
  if (width < 1100 && wanted === '4') return '2';
  return wanted;
}
