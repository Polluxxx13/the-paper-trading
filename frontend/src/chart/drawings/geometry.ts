import { Anchor, Drawing, FIB_EXT_LEVELS, FIB_LEVELS } from './model';

/** Conversion fournie par la couche de dessin (graphique réel) ou par les tests. */
export interface Mapper {
  w: number; // largeur de la zone de tracé (hors échelle des prix)
  h: number;
  px(a: Anchor): { x: number; y: number } | null;
  /** Nombre de barres entre deux instants (valeur absolue). */
  bars(t1: number, t2: number): number;
}

export type Shape =
  | { k: 'line'; x1: number; y1: number; x2: number; y2: number; color: string; width: number; dash?: string; opacity?: number }
  | { k: 'rect'; x: number; y: number; w: number; h: number; fill: string; opacity: number; stroke?: string }
  | { k: 'poly'; points: string; fill: string }
  | { k: 'text'; x: number; y: number; text: string; color: string; anchor?: 'start' | 'end' | 'middle'; bg?: string; size?: number };

const fmt = (n: number) => (Math.abs(n) >= 10 ? n.toFixed(2) : Math.abs(n) >= 1 ? n.toFixed(4) : n.toFixed(6));

export function fmtDuration(sec: number): string {
  const s = Math.abs(sec);
  if (s < 3600) return `${Math.round(s / 60)} min`;
  if (s < 86400) return `${(s / 3600).toFixed(1)} h`;
  return `${(s / 86400).toFixed(1)} j`;
}

/** Prolonge le segment p1→p2 au-delà de p2 jusqu'au bord de la zone (rayon). */
export function extendRay(x1: number, y1: number, x2: number, y2: number, w: number, h: number): { x: number; y: number } {
  const dx = x2 - x1, dy = y2 - y1;
  if (dx === 0 && dy === 0) return { x: x2, y: y2 };
  const ts: number[] = [];
  if (dx > 0) ts.push((w - x1) / dx); else if (dx < 0) ts.push((0 - x1) / dx);
  if (dy > 0) ts.push((h - y1) / dy); else if (dy < 0) ts.push((0 - y1) / dy);
  const t = Math.max(1, Math.min(...ts));
  return { x: x1 + dx * t, y: y1 + dy * t };
}

/** Transforme un dessin en formes pixel (lignes, rectangles, textes) prêtes à être rendues et testées au clic. */
export function buildShapes(d: Drawing, m: Mapper): Shape[] {
  const c = d.style.color, wd = d.style.width;
  const P = d.anchors.map((a) => m.px(a));
  if (P.some((p) => p === null)) return [];
  const p = P as { x: number; y: number }[];
  const a = d.anchors;
  const out: Shape[] = [];
  const line = (x1: number, y1: number, x2: number, y2: number, extra: Partial<Extract<Shape, { k: 'line' }>> = {}) =>
    out.push({ k: 'line', x1, y1, x2, y2, color: c, width: wd, ...extra });

  switch (d.tool) {
    case 'trend':
      line(p[0].x, p[0].y, p[1].x, p[1].y);
      break;
    case 'ray': {
      const e = extendRay(p[0].x, p[0].y, p[1].x, p[1].y, m.w, m.h);
      line(p[0].x, p[0].y, e.x, e.y);
      break;
    }
    case 'hline':
      line(0, p[0].y, m.w, p[0].y);
      out.push({ k: 'text', x: m.w - 4, y: p[0].y - 4, text: fmt(a[0].price), color: c, anchor: 'end' });
      break;
    case 'vline':
      line(p[0].x, 0, p[0].x, m.h);
      break;
    case 'arrow': {
      line(p[0].x, p[0].y, p[1].x, p[1].y);
      const ang = Math.atan2(p[1].y - p[0].y, p[1].x - p[0].x), L = 10 + wd * 2, s = 0.45;
      const hx = (da: number) => p[1].x - L * Math.cos(ang + da), hy = (da: number) => p[1].y - L * Math.sin(ang + da);
      out.push({ k: 'poly', points: `${p[1].x},${p[1].y} ${hx(s)},${hy(s)} ${hx(-s)},${hy(-s)}`, fill: c });
      break;
    }
    case 'rect': {
      const x = Math.min(p[0].x, p[1].x), y = Math.min(p[0].y, p[1].y);
      out.push({ k: 'rect', x, y, w: Math.abs(p[1].x - p[0].x), h: Math.abs(p[1].y - p[0].y), fill: c, opacity: 0.15, stroke: c });
      break;
    }
    case 'channel': {
      // Ligne de base p1→p2 ; la parallèle passe par p3 (même pente)
      line(p[0].x, p[0].y, p[1].x, p[1].y);
      const dx = p[1].x - p[0].x, dy = p[1].y - p[0].y;
      const slope = dx === 0 ? 0 : dy / dx;
      const yAt = (x: number) => p[2].y + slope * (x - p[2].x);
      line(p[0].x, yAt(p[0].x), p[1].x, yAt(p[1].x));
      out.push({ k: 'poly', points: `${p[0].x},${p[0].y} ${p[1].x},${p[1].y} ${p[1].x},${yAt(p[1].x)} ${p[0].x},${yAt(p[0].x)}`, fill: c + '26' });
      break;
    }
    case 'fib': {
      // 0 sur le 2e point, 1 sur le 1er (comme TradingView) ; prix = p2 + (p1 − p2) × niveau
      const x1 = Math.min(p[0].x, p[1].x), x2 = Math.max(p[0].x, p[1].x);
      line(p[0].x, p[0].y, p[1].x, p[1].y, { dash: '4 4', opacity: 0.6, width: 1 });
      FIB_LEVELS.forEach((lv, i) => {
        const price = a[1].price + (a[0].price - a[1].price) * lv;
        const y = m.px({ time: a[1].time, price })!.y;
        line(x1, y, x2, y, { opacity: 0.9, width: 1 });
        out.push({ k: 'text', x: x1 + 4, y: y - 3, text: `${lv} (${fmt(price)})`, color: c, size: 11 });
        if (i > 0) {
          const prev = m.px({ time: a[1].time, price: a[1].price + (a[0].price - a[1].price) * FIB_LEVELS[i - 1] })!.y;
          out.push({ k: 'rect', x: x1, y: Math.min(y, prev), w: x2 - x1, h: Math.abs(y - prev), fill: c, opacity: i % 2 ? 0.06 : 0.12 });
        }
      });
      break;
    }
    case 'fibext': {
      // Projection de l'amplitude p1→p2 à partir de p3 : prix = p3 + (p2 − p1) × niveau
      const x1 = Math.min(p[0].x, p[2].x), x2 = Math.max(p[1].x, p[2].x) + 80;
      line(p[0].x, p[0].y, p[1].x, p[1].y, { dash: '4 4', opacity: 0.6, width: 1 });
      line(p[1].x, p[1].y, p[2].x, p[2].y, { dash: '4 4', opacity: 0.6, width: 1 });
      FIB_EXT_LEVELS.forEach((lv) => {
        const price = a[2].price + (a[1].price - a[0].price) * lv;
        const y = m.px({ time: a[2].time, price })!.y;
        line(Math.min(x1, p[2].x), y, x2, y, { opacity: 0.9, width: 1 });
        out.push({ k: 'text', x: p[2].x + 4, y: y - 3, text: `${lv} (${fmt(price)})`, color: c, size: 11 });
      });
      break;
    }
    case 'text':
      out.push({ k: 'text', x: p[0].x, y: p[0].y, text: d.style.text ?? 'Texte', color: c, bg: '#1e222dcc', size: 13 });
      break;
    case 'measure': {
      const dp = a[1].price - a[0].price, pct = a[0].price ? (dp / a[0].price) * 100 : 0;
      const col = dp >= 0 ? '#26a69a' : '#ef5350';
      const x = Math.min(p[0].x, p[1].x), y = Math.min(p[0].y, p[1].y);
      out.push({ k: 'rect', x, y, w: Math.abs(p[1].x - p[0].x), h: Math.abs(p[1].y - p[0].y), fill: col, opacity: 0.12, stroke: col });
      line(p[0].x, p[0].y, p[1].x, p[1].y, { color: col, dash: '4 3', width: 1 });
      const n = Math.round(m.bars(a[0].time, a[1].time));
      out.push({
        k: 'text', x: (p[0].x + p[1].x) / 2, y: Math.min(p[0].y, p[1].y) - 8, anchor: 'middle', color: '#fff', bg: col + 'dd', size: 12,
        text: `${dp >= 0 ? '+' : ''}${fmt(dp)} (${pct >= 0 ? '+' : ''}${pct.toFixed(2)} %) · ${n} barres · ${fmtDuration(a[1].time - a[0].time)}`,
      });
      break;
    }
    case 'long':
    case 'short': {
      // a[0] = entrée, a[1] = (instant de fin, cible), a[2] = (instant de fin, stop)
      const entry = a[0].price, target = a[1].price, stop = a[2].price;
      const x1 = Math.min(p[0].x, p[1].x), x2 = Math.max(p[0].x, p[1].x);
      const yT = p[1].y, yS = p[2].y, yE = p[0].y;
      out.push({ k: 'rect', x: x1, y: Math.min(yE, yT), w: x2 - x1, h: Math.abs(yT - yE), fill: '#26a69a', opacity: 0.25 });
      out.push({ k: 'rect', x: x1, y: Math.min(yE, yS), w: x2 - x1, h: Math.abs(yS - yE), fill: '#ef5350', opacity: 0.25 });
      line(x1, yE, x2, yE, { color: '#d1d4dc', width: 1 });
      const gain = ((target - entry) / entry) * 100, loss = ((stop - entry) / entry) * 100;
      const rr = Math.abs(entry - stop) > 0 ? Math.abs(target - entry) / Math.abs(entry - stop) : 0;
      out.push({ k: 'text', x: x1 + 6, y: yT + (yT < yE ? 14 : -6), text: `Cible ${fmt(target)} (${gain >= 0 ? '+' : ''}${gain.toFixed(2)} %)`, color: '#26a69a', size: 11 });
      out.push({ k: 'text', x: x1 + 6, y: yS + (yS < yE ? 14 : -6), text: `Stop ${fmt(stop)} (${loss >= 0 ? '+' : ''}${loss.toFixed(2)} %)`, color: '#ef5350', size: 11 });
      out.push({ k: 'text', x: x1 + 6, y: yE - 5, text: `${d.tool === 'long' ? 'Long' : 'Short'} @ ${fmt(entry)} · R:R ${rr.toFixed(2)}`, color: '#d1d4dc', size: 11 });
      break;
    }
  }
  return out;
}

/** Stop par défaut d'une position : symétrique de la cible avec un ratio rendement/risque de 2. */
export function defaultStop(entry: Anchor, target: Anchor): Anchor {
  return { time: target.time, price: entry.price - (target.price - entry.price) / 2 };
}
