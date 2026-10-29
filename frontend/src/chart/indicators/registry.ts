import * as C from './calc';
import type { Bar, Series } from './calc';

export interface ParamDef { key: string; label: string; default: number; min: number; max: number; step?: number }

export interface OutputDef {
  key: string;
  label: string;
  color: string;
  kind?: 'line' | 'histogram' | 'dots';
  width?: number;
  /** Couleur par barre (histogrammes : volume, MACD). */
  colorFn?: (value: number, index: number, bars: Bar[]) => string;
}

export interface IndicatorDef {
  id: string;
  name: string;
  /** overlay = sur le graphique des prix ; pane = panneau séparé sous le graphique. */
  placement: 'overlay' | 'pane';
  params: ParamDef[];
  outputs: OutputDef[];
  compute: (bars: Bar[], p: Record<string, number>, ctx: { intraday: boolean }) => Record<string, Series>;
  /** Lignes de repère horizontales (ex. RSI 30/70). */
  levels?: number[];
}

export interface IndicatorInstance { uid: string; type: string; params: Record<string, number> }

const UP = '#26a69a', DOWN = '#ef5350';
const len = (def = 20): ParamDef => ({ key: 'period', label: 'Période', default: def, min: 1, max: 500 });
const signed = (v: number) => (v >= 0 ? 'rgba(38,166,154,0.7)' : 'rgba(239,83,80,0.7)');

export const INDICATORS: IndicatorDef[] = [
  { id: 'volume', name: 'Volume', placement: 'overlay', params: [],
    outputs: [{ key: 'v', label: 'Volume', color: '#787b86', kind: 'histogram', colorFn: (_v, i, b) => (b[i].close >= b[i].open ? 'rgba(38,166,154,0.4)' : 'rgba(239,83,80,0.4)') }],
    compute: (b) => ({ v: b.map((x) => x.volume) }) },
  { id: 'sma', name: 'SMA', placement: 'overlay', params: [len(20)], outputs: [{ key: 'v', label: 'SMA', color: '#2962ff' }],
    compute: (b, p) => ({ v: C.sma(b.map((x) => x.close), p.period) }) },
  { id: 'ema', name: 'EMA', placement: 'overlay', params: [len(20)], outputs: [{ key: 'v', label: 'EMA', color: '#ff9800' }],
    compute: (b, p) => ({ v: C.ema(b.map((x) => x.close), p.period) }) },
  { id: 'wma', name: 'WMA', placement: 'overlay', params: [len(20)], outputs: [{ key: 'v', label: 'WMA', color: '#e91e63' }],
    compute: (b, p) => ({ v: C.wma(b.map((x) => x.close), p.period) }) },
  { id: 'vwap', name: 'VWAP', placement: 'overlay', params: [], outputs: [{ key: 'v', label: 'VWAP', color: '#9c27b0' }],
    compute: (b, _p, ctx) => ({ v: C.vwap(b, ctx.intraday) }) },
  { id: 'bb', name: 'Bandes de Bollinger', placement: 'overlay',
    params: [len(20), { key: 'mult', label: 'Écarts-types', default: 2, min: 0.1, max: 10, step: 0.1 }],
    outputs: [{ key: 'upper', label: 'Haute', color: '#4dd0e1' }, { key: 'mid', label: 'Milieu', color: '#ff9800', width: 1 }, { key: 'lower', label: 'Basse', color: '#4dd0e1' }],
    compute: (b, p) => C.bollinger(b, p.period, p.mult) },
  { id: 'ichimoku', name: 'Ichimoku', placement: 'overlay',
    params: [{ key: 'tenkan', label: 'Tenkan', default: 9, min: 1, max: 200 }, { key: 'kijun', label: 'Kijun', default: 26, min: 1, max: 200 }, { key: 'senkou', label: 'Senkou B', default: 52, min: 1, max: 400 }],
    outputs: [{ key: 'tenkan', label: 'Tenkan', color: '#2962ff', width: 1 }, { key: 'kijun', label: 'Kijun', color: '#ef5350', width: 1 }, { key: 'spanA', label: 'Senkou A', color: '#26a69a', width: 1 }, { key: 'spanB', label: 'Senkou B', color: '#ff7043', width: 1 }, { key: 'chikou', label: 'Chikou', color: '#9c27b0', width: 1 }],
    compute: (b, p) => C.ichimoku(b, p.tenkan, p.kijun, p.senkou) },
  { id: 'psar', name: 'Parabolic SAR', placement: 'overlay',
    params: [{ key: 'step', label: 'Pas', default: 0.02, min: 0.001, max: 1, step: 0.01 }, { key: 'max', label: 'Maximum', default: 0.2, min: 0.01, max: 1, step: 0.01 }],
    outputs: [{ key: 'v', label: 'SAR', color: '#ffeb3b', kind: 'dots' }],
    compute: (b, p) => ({ v: C.psar(b, p.step, p.max) }) },
  { id: 'pivots', name: 'Points pivots', placement: 'overlay', params: [],
    outputs: [{ key: 'r3', label: 'R3', color: '#ef5350', width: 1 }, { key: 'r2', label: 'R2', color: '#ef5350', width: 1 }, { key: 'r1', label: 'R1', color: '#ef5350', width: 1 }, { key: 'pp', label: 'PP', color: '#ffb74d', width: 1 }, { key: 's1', label: 'S1', color: '#26a69a', width: 1 }, { key: 's2', label: 'S2', color: '#26a69a', width: 1 }, { key: 's3', label: 'S3', color: '#26a69a', width: 1 }],
    compute: (b, _p, ctx) => C.pivots(b, ctx.intraday) },

  { id: 'rsi', name: 'RSI', placement: 'pane', params: [len(14)], levels: [30, 70], outputs: [{ key: 'v', label: 'RSI', color: '#9c27b0' }],
    compute: (b, p) => ({ v: C.rsi(b, p.period) }) },
  { id: 'macd', name: 'MACD', placement: 'pane',
    params: [{ key: 'fast', label: 'Rapide', default: 12, min: 1, max: 200 }, { key: 'slow', label: 'Lente', default: 26, min: 1, max: 400 }, { key: 'signal', label: 'Signal', default: 9, min: 1, max: 200 }],
    outputs: [{ key: 'hist', label: 'Histogramme', color: UP, kind: 'histogram', colorFn: signed }, { key: 'macd', label: 'MACD', color: '#2962ff' }, { key: 'signal', label: 'Signal', color: '#ff9800' }],
    compute: (b, p) => C.macd(b, p.fast, p.slow, p.signal) },
  { id: 'stoch', name: 'Stochastique', placement: 'pane', levels: [20, 80],
    params: [{ key: 'k', label: '%K', default: 14, min: 1, max: 200 }, { key: 'smooth', label: 'Lissage %K', default: 3, min: 1, max: 50 }, { key: 'd', label: '%D', default: 3, min: 1, max: 50 }],
    outputs: [{ key: 'k', label: '%K', color: '#2962ff' }, { key: 'd', label: '%D', color: '#ff9800' }],
    compute: (b, p) => C.stochastic(b, p.k, p.smooth, p.d) },
  { id: 'atr', name: 'ATR', placement: 'pane', params: [len(14)], outputs: [{ key: 'v', label: 'ATR', color: '#ef5350' }],
    compute: (b, p) => ({ v: C.atr(b, p.period) }) },
  { id: 'obv', name: 'OBV', placement: 'pane', params: [], outputs: [{ key: 'v', label: 'OBV', color: '#4dd0e1' }],
    compute: (b) => ({ v: C.obv(b) }) },
  { id: 'adx', name: 'ADX', placement: 'pane', params: [len(14)], levels: [25],
    outputs: [{ key: 'adx', label: 'ADX', color: '#ff9800' }, { key: 'diPlus', label: '+DI', color: UP, width: 1 }, { key: 'diMinus', label: '−DI', color: DOWN, width: 1 }],
    compute: (b, p) => C.adx(b, p.period) },
];

export const def = (id: string) => INDICATORS.find((d) => d.id === id)!;

export const defaultParams = (d: IndicatorDef): Record<string, number> => Object.fromEntries(d.params.map((p) => [p.key, p.default]));

export const newInstance = (type: string): IndicatorInstance => ({ uid: Math.random().toString(36).slice(2, 9), type, params: defaultParams(def(type)) });

/** Libellé court, ex. « SMA (20) » ou « MACD (12, 26, 9) ». */
export const label = (i: IndicatorInstance) => {
  const d = def(i.type);
  return d.params.length ? `${d.name} (${d.params.map((p) => i.params[p.key]).join(', ')})` : d.name;
};

const KEY = 'pt.indicators';
export function loadIndicators(): IndicatorInstance[] {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? 'null');
    if (Array.isArray(raw)) return raw.filter((i) => INDICATORS.some((d) => d.id === i.type)).map((i) => ({ ...i, params: { ...defaultParams(def(i.type)), ...i.params } }));
  } catch { /* stockage indisponible */ }
  return [newInstance('volume')];
}
export function saveIndicators(list: IndicatorInstance[]) {
  try { localStorage.setItem(KEY, JSON.stringify(list)); } catch { /* ignoré */ }
}
