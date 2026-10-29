/**
 * Calculs d'indicateurs : fonctions pures, sans dépendance. Chaque fonction retourne des tableaux
 * alignés sur les bougies (même longueur) ; `null` tant que l'indicateur n'est pas défini.
 */
export interface Bar { time: number; open: number; high: number; low: number; close: number; volume: number }
export type Series = (number | null)[];

const nulls = (n: number): Series => new Array(n).fill(null);

export function sma(values: Series, period: number): Series {
  const out = nulls(values.length);
  let sum = 0, count = 0;
  for (let i = 0; i < values.length; i++) {
    const v = values[i];
    if (v === null) { sum = 0; count = 0; continue; }
    sum += v; count++;
    if (count > period) sum -= values[i - period]!;
    if (count >= period) out[i] = sum / period;
  }
  return out;
}

/** EMA amorcée par la SMA des `period` premières valeurs définies (convention TradingView / StockCharts). */
export function ema(values: Series, period: number): Series {
  const out = nulls(values.length);
  const k = 2 / (period + 1);
  let prev: number | null = null, sum = 0, count = 0;
  for (let i = 0; i < values.length; i++) {
    const v = values[i];
    if (v === null) continue;
    if (prev === null) {
      sum += v; count++;
      if (count === period) { prev = sum / period; out[i] = prev; }
    } else {
      prev = v * k + prev * (1 - k);
      out[i] = prev;
    }
  }
  return out;
}

export function wma(values: Series, period: number): Series {
  const out = nulls(values.length);
  const denom = (period * (period + 1)) / 2;
  for (let i = period - 1; i < values.length; i++) {
    let s = 0, ok = true;
    for (let j = 0; j < period; j++) {
      const v = values[i - period + 1 + j];
      if (v === null) { ok = false; break; }
      s += v * (j + 1);
    }
    if (ok) out[i] = s / denom;
  }
  return out;
}

/** Lissage de Wilder (RMA) : première valeur = moyenne simple, puis (prev×(n−1)+x)/n. */
function rma(values: Series, period: number): Series {
  const out = nulls(values.length);
  let prev: number | null = null, sum = 0, count = 0;
  for (let i = 0; i < values.length; i++) {
    const v = values[i];
    if (v === null) continue;
    if (prev === null) {
      sum += v; count++;
      if (count === period) { prev = sum / period; out[i] = prev; }
    } else {
      prev = (prev * (period - 1) + v) / period;
      out[i] = prev;
    }
  }
  return out;
}

const closes = (b: Bar[]): Series => b.map((x) => x.close);

export function rsi(bars: Bar[], period = 14): Series {
  const c = closes(bars);
  const gain: Series = nulls(c.length), loss: Series = nulls(c.length);
  for (let i = 1; i < c.length; i++) {
    const d = c[i]! - c[i - 1]!;
    gain[i] = Math.max(d, 0);
    loss[i] = Math.max(-d, 0);
  }
  const ag = rma(gain, period), al = rma(loss, period);
  return c.map((_, i) => (ag[i] === null || al[i] === null ? null : al[i] === 0 ? 100 : 100 - 100 / (1 + ag[i]! / al[i]!)));
}

export function macd(bars: Bar[], fast = 12, slow = 26, signal = 9) {
  const c = closes(bars);
  const ef = ema(c, fast), es = ema(c, slow);
  const line: Series = c.map((_, i) => (ef[i] === null || es[i] === null ? null : ef[i]! - es[i]!));
  const sig = ema(line, signal);
  const hist: Series = line.map((v, i) => (v === null || sig[i] === null ? null : v - sig[i]!));
  return { macd: line, signal: sig, hist };
}

export function bollinger(bars: Bar[], period = 20, mult = 2) {
  const c = closes(bars);
  const mid = sma(c, period);
  const upper = nulls(c.length), lower = nulls(c.length);
  for (let i = period - 1; i < c.length; i++) {
    let v = 0;
    for (let j = i - period + 1; j <= i; j++) v += (c[j]! - mid[i]!) ** 2;
    const sd = Math.sqrt(v / period); // écart-type de population, comme TradingView
    upper[i] = mid[i]! + mult * sd;
    lower[i] = mid[i]! - mult * sd;
  }
  return { upper, mid, lower };
}

export function stochastic(bars: Bar[], kPeriod = 14, kSmooth = 3, dPeriod = 3) {
  const raw: Series = nulls(bars.length);
  for (let i = kPeriod - 1; i < bars.length; i++) {
    let hh = -Infinity, ll = Infinity;
    for (let j = i - kPeriod + 1; j <= i; j++) { hh = Math.max(hh, bars[j].high); ll = Math.min(ll, bars[j].low); }
    raw[i] = hh === ll ? 50 : ((bars[i].close - ll) / (hh - ll)) * 100;
  }
  const k = sma(raw, kSmooth);
  return { k, d: sma(k, dPeriod) };
}

function trueRange(bars: Bar[]): Series {
  return bars.map((b, i) => (i === 0 ? b.high - b.low : Math.max(b.high - b.low, Math.abs(b.high - bars[i - 1].close), Math.abs(b.low - bars[i - 1].close))));
}

export function atr(bars: Bar[], period = 14): Series {
  return rma(trueRange(bars), period);
}

export function obv(bars: Bar[]): Series {
  let acc = 0;
  return bars.map((b, i) => {
    if (i > 0) acc += b.close > bars[i - 1].close ? b.volume : b.close < bars[i - 1].close ? -b.volume : 0;
    return acc;
  });
}

/** ADX de Wilder avec +DI et −DI. */
export function adx(bars: Bar[], period = 14) {
  const n = bars.length;
  const plus: Series = nulls(n), minus: Series = nulls(n);
  for (let i = 1; i < n; i++) {
    const up = bars[i].high - bars[i - 1].high, down = bars[i - 1].low - bars[i].low;
    plus[i] = up > down && up > 0 ? up : 0;
    minus[i] = down > up && down > 0 ? down : 0;
  }
  const tr = trueRange(bars);
  tr[0] = null;
  const sTr = rma(tr, period), sPlus = rma(plus, period), sMinus = rma(minus, period);
  const diPlus: Series = nulls(n), diMinus: Series = nulls(n), dx: Series = nulls(n);
  for (let i = 0; i < n; i++) {
    if (sTr[i] === null || sTr[i] === 0) continue;
    diPlus[i] = (100 * sPlus[i]!) / sTr[i]!;
    diMinus[i] = (100 * sMinus[i]!) / sTr[i]!;
    const s = diPlus[i]! + diMinus[i]!;
    dx[i] = s === 0 ? 0 : (100 * Math.abs(diPlus[i]! - diMinus[i]!)) / s;
  }
  return { adx: rma(dx, period), diPlus, diMinus };
}

/** VWAP : remis à zéro à chaque journée (heure affichée) en intraday, cumulatif sinon. */
export function vwap(bars: Bar[], intraday: boolean): Series {
  let pv = 0, vol = 0, day = -1;
  return bars.map((b) => {
    const d = Math.floor(b.time / 86400);
    if (intraday && d !== day) { pv = 0; vol = 0; day = d; }
    const typical = (b.high + b.low + b.close) / 3;
    pv += typical * b.volume; vol += b.volume;
    return vol > 0 ? pv / vol : typical;
  });
}

export function ichimoku(bars: Bar[], tenkanP = 9, kijunP = 26, senkouP = 52) {
  const mid = (i: number, p: number) => {
    if (i < p - 1) return null;
    let hh = -Infinity, ll = Infinity;
    for (let j = i - p + 1; j <= i; j++) { hh = Math.max(hh, bars[j].high); ll = Math.min(ll, bars[j].low); }
    return (hh + ll) / 2;
  };
  const tenkan = bars.map((_, i) => mid(i, tenkanP));
  const kijun = bars.map((_, i) => mid(i, kijunP));
  const spanA0 = bars.map((_, i) => (tenkan[i] === null || kijun[i] === null ? null : (tenkan[i]! + kijun[i]!) / 2));
  const spanB0 = bars.map((_, i) => mid(i, senkouP));
  // Senkou décalés de `kijunP` barres vers l'avant (limités à la plage affichée), Chikou décalé vers l'arrière
  const shiftFwd = (s: Series): Series => s.map((_, i) => (i - kijunP >= 0 ? s[i - kijunP] : null));
  const chikou: Series = bars.map((_, i) => (i + kijunP < bars.length ? bars[i + kijunP].close : null));
  return { tenkan, kijun, spanA: shiftFwd(spanA0), spanB: shiftFwd(spanB0), chikou };
}

/** Parabolic SAR de Wilder. */
export function psar(bars: Bar[], step = 0.02, max = 0.2): Series {
  const n = bars.length;
  const out = nulls(n);
  if (n < 2) return out;
  let up = bars[1].close >= bars[0].close;
  let sar = up ? bars[0].low : bars[0].high;
  let ep = up ? bars[1].high : bars[1].low;
  let af = step;
  out[1] = sar;
  for (let i = 2; i < n; i++) {
    sar = sar + af * (ep - sar);
    if (up) {
      sar = Math.min(sar, bars[i - 1].low, bars[i - 2].low);
      if (bars[i].low < sar) { up = false; sar = ep; ep = bars[i].low; af = step; }
      else if (bars[i].high > ep) { ep = bars[i].high; af = Math.min(af + step, max); }
    } else {
      sar = Math.max(sar, bars[i - 1].high, bars[i - 2].high);
      if (bars[i].high > sar) { up = true; sar = ep; ep = bars[i].high; af = step; }
      else if (bars[i].low < ep) { ep = bars[i].low; af = Math.min(af + step, max); }
    }
    out[i] = sar;
  }
  return out;
}

/** Points pivots classiques calculés sur la journée précédente (intraday) ou la barre précédente. */
export function pivots(bars: Bar[], intraday: boolean) {
  const keys = ['pp', 'r1', 'r2', 'r3', 's1', 's2', 's3'] as const;
  const out = Object.fromEntries(keys.map((k) => [k, nulls(bars.length)])) as Record<(typeof keys)[number], Series>;
  let curDay = -1;
  let h = 0, l = 0, c = 0; // OHLC de la journée en cours
  let lv: number[] | null = null; // niveaux issus de la journée précédente
  const key = (b: Bar) => (intraday ? Math.floor(b.time / 86400) : b.time);
  bars.forEach((b, i) => {
    const d = key(b);
    if (d !== curDay) {
      if (curDay !== -1) {
        const p = (h + l + c) / 3;
        lv = [p, 2 * p - l, p + (h - l), h + 2 * (p - l), 2 * p - h, p - (h - l), l - 2 * (h - p)];
      }
      curDay = d; h = b.high; l = b.low;
    } else { h = Math.max(h, b.high); l = Math.min(l, b.low); }
    c = b.close;
    if (lv) keys.forEach((k, j) => (out[k][i] = lv![j]));
  });
  return out;
}
