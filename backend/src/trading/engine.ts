import { EventEmitter } from 'node:events';
import crypto from 'node:crypto';
import { z } from 'zod';
import { pool } from '../db';
import { hub } from '../market/quoteHub';
import type { Quote } from '../market/types';
import { TradingError, fxToAccount } from './fx';

export interface OrderRow {
  id: number;
  accountId: number;
  symbol: string;
  assetClass: string;
  side: 'buy' | 'sell';
  type: 'market' | 'limit' | 'stop' | 'stop_limit' | 'take_profit' | 'stop_loss' | 'trailing_stop';
  quantity: number;
  limitPrice: number | null;
  stopPrice: number | null;
  trailAmount: number | null;
  trailPercent: number | null;
  status: 'pending' | 'working' | 'filled' | 'cancelled' | 'rejected' | 'expired';
  parentOrderId: number | null;
  ocoGroup: string | null;
  filledQty: number;
  avgFillPrice: number | null;
  rejectReason: string | null;
  triggered: boolean;
  trailRef: number | null;
  createdAt: string;
}

export const ORDER_COLS = `id, account_id AS "accountId", symbol, asset_class AS "assetClass", side, type,
  quantity::float8 AS quantity, limit_price::float8 AS "limitPrice", stop_price::float8 AS "stopPrice",
  trail_amount::float8 AS "trailAmount", trail_percent::float8 AS "trailPercent", status,
  parent_order_id AS "parentOrderId", oco_group AS "ocoGroup", filled_qty::float8 AS "filledQty",
  avg_fill_price::float8 AS "avgFillPrice", reject_reason AS "rejectReason", triggered,
  trail_ref::float8 AS "trailRef", created_at AS "createdAt"`;

const price = z.number().positive();
export const orderInput = z.object({
  symbol: z.string().trim().min(1).max(30),
  side: z.enum(['buy', 'sell']),
  type: z.enum(['market', 'limit', 'stop', 'stop_limit', 'take_profit', 'stop_loss', 'trailing_stop']),
  quantity: z.number().positive().max(1e9), // bornes : NUMERIC(20,8) en base
  limitPrice: price.max(1e9).optional(),
  stopPrice: price.max(1e9).optional(),
  trailAmount: price.max(1e9).optional(),
  trailPercent: z.number().positive().max(100).optional(),
  takeProfit: price.max(1e9).optional(), // ordre TP attaché
  stopLoss: price.max(1e9).optional(), // ordre SL attaché
});
export type OrderInput = z.infer<typeof orderInput>;

const round8 = (n: number) => Math.round(n * 1e8) / 1e8;
const FRACTIONAL = new Set(['crypto', 'forex']);

/**
 * Moteur d'ordres : tourne dans le serveur, abonné au QuoteHub, donc indépendant du navigateur.
 * Les ordres actifs sont indexés en mémoire par symbole ; chaque exécution est une transaction SQL
 * qui verrouille la ligne du compte (FOR UPDATE) : cash, position, transaction et ordre sont atomiques.
 * Événement 'trade' { accountId, slug } émis à chaque changement (fill, annulation, rejet).
 */
export class OrderEngine extends EventEmitter {
  private active = new Map<number, OrderRow>();
  private bySymbol = new Map<string, Set<number>>();
  private busy = new Set<number>();
  private watched = new Set<string>();
  private lastPersist = new Map<number, number>();

  async init() {
    const { rows } = await pool.query(`SELECT ${ORDER_COLS} FROM orders WHERE status = 'working'`);
    rows.forEach((o: OrderRow) => this.index(o));
    await this.refreshWatch();
    hub.on('quote', (q: Quote) => this.onQuote(q));
  }

  // ── index mémoire ──
  private index(o: OrderRow) {
    this.active.set(o.id, o);
    if (!this.bySymbol.has(o.symbol)) this.bySymbol.set(o.symbol, new Set());
    this.bySymbol.get(o.symbol)!.add(o.id);
  }
  private unindex(id: number) {
    const o = this.active.get(id);
    if (!o) return;
    this.active.delete(id);
    this.bySymbol.get(o.symbol)?.delete(id);
    this.lastPersist.delete(id);
  }

  /** Abonne le hub à tous les symboles ayant un ordre actif ou une position ouverte. */
  async refreshWatch() {
    const { rows } = await pool.query(
      `SELECT symbol FROM orders WHERE status IN ('working','pending') UNION SELECT symbol FROM positions`,
    );
    const next = new Set<string>(rows.map((r) => r.symbol));
    next.forEach((s) => !this.watched.has(s) && hub.retain(s));
    this.watched.forEach((s) => !next.has(s) && hub.release(s));
    this.watched = next;
  }

  async onAccountReset(accountId: number) {
    [...this.active.values()].filter((o) => o.accountId === accountId).forEach((o) => this.unindex(o.id));
    await this.refreshWatch();
  }

  // ── déclenchement ──
  private onQuote(q: Quote) {
    const ids = this.bySymbol.get(q.symbol);
    if (!ids?.size) return;
    // Pas d'exécution sur un marché fermé (crypto/forex tournent 24 h)
    if (q.marketState === 'CLOSED' && q.assetClass !== 'crypto' && q.assetClass !== 'forex') return;
    for (const id of [...ids]) {
      const o = this.active.get(id);
      if (!o || this.busy.has(id) || !this.shouldFill(o, q.price)) continue;
      this.busy.add(id);
      this.fillOrder(o, q)
        .catch((e) => console.warn(`[engine] ordre ${id} :`, (e as Error).message))
        .finally(() => this.busy.delete(id));
    }
  }

  /** Conditions de déclenchement selon le type ; met aussi à jour stop-limit et trailing. */
  private shouldFill(o: OrderRow, p: number): boolean {
    const buy = o.side === 'buy';
    switch (o.type) {
      case 'limit':
      case 'take_profit':
        return buy ? p <= o.limitPrice! : p >= o.limitPrice!;
      case 'stop':
      case 'stop_loss':
        return buy ? p >= o.stopPrice! : p <= o.stopPrice!;
      case 'stop_limit': {
        if (!o.triggered) {
          if (!(buy ? p >= o.stopPrice! : p <= o.stopPrice!)) return false;
          o.triggered = true;
          void pool.query('UPDATE orders SET triggered = true WHERE id = $1 AND account_id = $2', [o.id, o.accountId]);
        }
        return buy ? p <= o.limitPrice! : p >= o.limitPrice!;
      }
      case 'trailing_stop': {
        const ref = o.trailRef ?? p;
        const next = buy ? Math.min(ref, p) : Math.max(ref, p);
        if (next !== o.trailRef) {
          o.trailRef = next;
          const now = Date.now();
          if (now - (this.lastPersist.get(o.id) ?? 0) > 2000) {
            this.lastPersist.set(o.id, now);
            void pool.query('UPDATE orders SET trail_ref = $3 WHERE id = $1 AND account_id = $2', [o.id, o.accountId, next]);
          }
        }
        const dist = o.trailAmount ?? (next * (o.trailPercent ?? 0)) / 100;
        return buy ? p >= next + dist : p <= next - dist;
      }
      default:
        return false;
    }
  }

  // ── création d'ordre ──
  async place(accountId: number, slug: string, input: OrderInput): Promise<OrderRow> {
    const symbol = input.symbol;
    let q: Quote;
    try {
      q = await hub.getQuote(symbol);
    } catch {
      throw new TradingError(404, 'symbol_not_found', `Symbole introuvable : ${symbol}`);
    }
    if (q.assetClass === 'index') throw new TradingError(400, 'not_tradable', 'Les indices ne sont pas négociables : utilisez un ETF ou un future');
    if (!FRACTIONAL.has(q.assetClass) && !Number.isInteger(input.quantity))
      throw new TradingError(400, 'fractional_not_allowed', 'Quantité entière requise (fractions réservées à la crypto et au forex)');

    const need = (ok: unknown, msg: string) => { if (!ok) throw new TradingError(400, 'invalid_order', msg); };
    const t = input.type;
    need(t !== 'limit' && t !== 'stop_limit' && t !== 'take_profit' || input.limitPrice, 'Prix limite requis');
    need(t !== 'stop' && t !== 'stop_limit' && t !== 'stop_loss' || input.stopPrice, 'Prix stop requis');
    need(t !== 'trailing_stop' || input.trailAmount || input.trailPercent, 'Distance du trailing stop requise');
    const buy = input.side === 'buy';
    const isMarket = t === 'market';
    const isReduce = t === 'take_profit' || t === 'stop_loss';
    const marketClosed = q.marketState === 'CLOSED' && q.assetClass !== 'crypto' && q.assetClass !== 'forex';
    if (isMarket && marketClosed) throw new TradingError(409, 'market_closed', `Marché fermé pour ${symbol} : utilisez un ordre limite ou stop`);

    if (isReduce) {
      const { rows } = await pool.query('SELECT quantity::float8 AS q FROM positions WHERE account_id = $1 AND symbol = $2', [accountId, symbol]);
      const pq = rows[0]?.q ?? 0;
      if (!pq || (pq > 0) === buy) throw new TradingError(400, 'no_position', 'TP/SL autonome : aucune position à protéger dans ce sens');
    }

    const entryRef = input.limitPrice ?? input.stopPrice ?? q.price;
    if (input.takeProfit && (buy ? input.takeProfit <= entryRef : input.takeProfit >= entryRef)) throw new TradingError(400, 'invalid_order', 'Take-profit du mauvais côté du prix d\'entrée');
    if (input.stopLoss && (buy ? input.stopLoss >= entryRef : input.stopLoss <= entryRef)) throw new TradingError(400, 'invalid_order', 'Stop-loss du mauvais côté du prix d\'entrée');

    const c = await pool.connect();
    let order: OrderRow;
    let children: OrderRow[] = [];
    try {
      await c.query('BEGIN');
      const ins = (sql: string, params: unknown[]) => c.query(sql, params).then((r) => r.rows[0] as OrderRow);
      const sql = `INSERT INTO orders (account_id, symbol, asset_class, side, type, quantity, limit_price, stop_price,
        trail_amount, trail_percent, status, parent_order_id, oco_group, trail_ref)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) RETURNING ${ORDER_COLS}`;
      order = await ins(sql, [accountId, symbol, q.assetClass, input.side, t, input.quantity, input.limitPrice ?? null, input.stopPrice ?? null,
        input.trailAmount ?? null, input.trailPercent ?? null, 'working', null, null, t === 'trailing_stop' ? q.price : null]);
      const oco = crypto.randomUUID();
      const exit = buy ? 'sell' : 'buy';
      if (input.takeProfit)
        children.push(await ins(sql, [accountId, symbol, q.assetClass, exit, 'take_profit', input.quantity, input.takeProfit, null, null, null, 'pending', order.id, oco, null]));
      if (input.stopLoss)
        children.push(await ins(sql, [accountId, symbol, q.assetClass, exit, 'stop_loss', input.quantity, null, input.stopLoss, null, null, 'pending', order.id, oco, null]));
      await c.query('COMMIT');
    } catch (e) {
      await c.query('ROLLBACK');
      throw e;
    } finally {
      c.release();
    }

    if (isMarket) {
      this.busy.add(order.id);
      try {
        await this.fillOrder(order, q); // lève TradingError si rejeté (fonds insuffisants...)
      } finally {
        this.busy.delete(order.id);
      }
    } else {
      this.index(order);
      await this.refreshWatch();
      this.emit('trade', { accountId, slug });
      this.onQuote(q); // ordre déjà exécutable ? fill immédiat
    }
    const { rows } = await pool.query(`SELECT ${ORDER_COLS} FROM orders WHERE id = $1 AND account_id = $2`, [order.id, accountId]);
    return rows[0];
  }

  // ── annulation / modification ──
  async cancel(accountId: number, slug: string, id: number) {
    const { rows } = await pool.query(
      `UPDATE orders SET status = 'cancelled', updated_at = now()
       WHERE account_id = $1 AND (id = $2 OR (parent_order_id = $2 AND status = 'pending')) AND status IN ('working','pending')
       RETURNING id`,
      [accountId, id],
    );
    if (!rows.length) throw new TradingError(404, 'order_not_found', 'Ordre introuvable ou déjà terminé');
    rows.forEach((r) => this.unindex(r.id));
    await this.refreshWatch();
    this.emit('trade', { accountId, slug });
  }

  async modify(accountId: number, slug: string, id: number, patch: { limitPrice?: number; stopPrice?: number; quantity?: number }) {
    const { rows } = await pool.query(
      `UPDATE orders SET limit_price = COALESCE($3, limit_price), stop_price = COALESCE($4, stop_price),
         quantity = COALESCE($5, quantity), updated_at = now()
       WHERE id = $1 AND account_id = $2 AND status IN ('working','pending') RETURNING ${ORDER_COLS}`,
      [id, accountId, patch.limitPrice ?? null, patch.stopPrice ?? null, patch.quantity ?? null],
    );
    if (!rows[0]) throw new TradingError(404, 'order_not_found', 'Ordre introuvable ou déjà terminé');
    if (this.active.has(id)) this.active.set(id, { ...this.active.get(id)!, ...rows[0] });
    this.emit('trade', { accountId, slug });
    return rows[0] as OrderRow;
  }

  // ── exécution ──
  private async fillOrder(o: OrderRow, q: Quote) {
    const { rows } = await pool.query(
      `SELECT slug, base_currency AS cur, spread_bps::float8 AS spread, fee_fixed::float8 AS "feeFixed", fee_pct::float8 AS "feePct"
       FROM accounts WHERE id = $1`,
      [o.accountId],
    );
    const acct = rows[0];
    const fx = await fxToAccount(q.currency, acct.cur); // réseau AVANT la transaction SQL
    return this.fillTx(o, q, acct, fx);
  }

  private async fillTx(
    o: OrderRow,
    q: Quote,
    acct: { slug: string; spread: number; feeFixed: number; feePct: number },
    fx: number,
  ) {
    const c = await pool.connect();
    const sign = o.side === 'buy' ? 1 : -1;
    let rejection: TradingError | null = null;
    try {
      await c.query('BEGIN');
      const a = (await c.query('SELECT cash::float8 AS cash FROM accounts WHERE id = $1 FOR UPDATE', [o.accountId])).rows[0];
      const cur = (await c.query(`SELECT ${ORDER_COLS} FROM orders WHERE id = $1 AND account_id = $2 FOR UPDATE`, [o.id, o.accountId])).rows[0] as OrderRow | undefined;
      if (!cur || cur.status !== 'working') { await c.query('ROLLBACK'); return null; }

      const pos = (await c.query(
        'SELECT quantity::float8 AS q, avg_price::float8 AS p, avg_fx_rate::float8 AS fx FROM positions WHERE account_id = $1 AND symbol = $2 FOR UPDATE',
        [o.accountId, o.symbol],
      )).rows[0] as { q: number; p: number; fx: number } | undefined;
      const pq = pos?.q ?? 0;

      let qty = cur.quantity;
      const reduceOnly = cur.type === 'take_profit' || cur.type === 'stop_loss';
      let cancelledNoPos = false;
      if (reduceOnly) {
        if (!pq || Math.sign(pq) === sign) cancelledNoPos = true; // plus de position à protéger
        else qty = Math.min(qty, Math.abs(pq));
      }
      if (cancelledNoPos) {
        await c.query(`UPDATE orders SET status = 'cancelled', reject_reason = 'Aucune position à protéger', updated_at = now() WHERE id = $1 AND account_id = $2`, [o.id, o.accountId]);
        await c.query('COMMIT');
        this.unindex(o.id);
        await this.refreshWatch();
        this.emit('trade', { accountId: o.accountId, slug: acct.slug });
        return null;
      }

      const px = q.price * (1 + (sign * acct.spread) / 10000); // spread toujours défavorable
      const s = sign * qty;
      const newQ = pq + s;
      let realized = 0;
      let newAvg = pos?.p ?? px;
      let newFx = pos?.fx ?? fx;
      if (pq !== 0 && Math.sign(pq) !== sign) {
        const closed = Math.min(qty, Math.abs(pq));
        realized = closed * Math.sign(pq) * (px * fx - pos!.p * pos!.fx); // P&L en devise du compte
      }
      if (pq === 0 || Math.sign(pq) === sign) {
        const w0 = Math.abs(pq), cost0 = w0 * (pos?.p ?? 0), cost1 = qty * px;
        newAvg = (cost0 + cost1) / (w0 + qty);
        newFx = (cost0 * (pos?.fx ?? 0) + cost1 * fx) / (cost0 + cost1);
      } else if (Math.abs(s) > Math.abs(pq)) {
        newAvg = px; newFx = fx; // retournement : le reliquat ouvre une nouvelle position
      }
      const fees = acct.feeFixed + (qty * px * fx * acct.feePct) / 100;
      const cashAfter = a.cash - s * px * fx - fees;
      realized -= fees;

      // Contrôles de fonds / marge uniquement si l'exposition augmente
      if (Math.abs(newQ) > Math.abs(pq)) {
        if (cashAfter < 0) rejection = new TradingError(400, 'insufficient_funds', 'Solde insuffisant pour cet ordre');
        else {
          const others = (await c.query(
            'SELECT symbol, quantity::float8 AS q, avg_price::float8 AS p, avg_fx_rate::float8 AS fx FROM positions WHERE account_id = $1 AND symbol <> $2',
            [o.accountId, o.symbol],
          )).rows as { symbol: string; q: number; p: number; fx: number }[];
          let equity = cashAfter + newQ * px * fx;
          let shorts = newQ < 0 ? -newQ * px * fx : 0;
          for (const r of others) {
            const v = r.q * (hub.peek(r.symbol)?.price ?? r.p) * r.fx; // taux d'ouverture comme approximation
            equity += v;
            if (v < 0) shorts -= v;
          }
          if (shorts > equity) rejection = new TradingError(400, 'insufficient_margin', 'Marge insuffisante pour cette vente à découvert (exposition short > capital)');
        }
      }

      if (rejection) {
        await c.query(`UPDATE orders SET status = 'rejected', reject_reason = $3, updated_at = now() WHERE id = $1 AND account_id = $2`, [o.id, o.accountId, rejection.message]);
        await c.query(`UPDATE orders SET status = 'cancelled', updated_at = now() WHERE account_id = $1 AND parent_order_id = $2 AND status = 'pending'`, [o.accountId, o.id]);
        await c.query('COMMIT');
        this.unindex(o.id);
        await this.refreshWatch();
        this.emit('trade', { accountId: o.accountId, slug: acct.slug });
        throw rejection;
      }

      await c.query('UPDATE accounts SET cash = $2 WHERE id = $1', [o.accountId, round8(cashAfter)]);
      if (Math.abs(newQ) < 1e-9) await c.query('DELETE FROM positions WHERE account_id = $1 AND symbol = $2', [o.accountId, o.symbol]);
      else
        await c.query(
          `INSERT INTO positions (account_id, symbol, asset_class, currency, quantity, avg_price, avg_fx_rate)
           VALUES ($1,$2,$3,$4,$5,$6,$7)
           ON CONFLICT (account_id, symbol) DO UPDATE SET quantity = $5, avg_price = $6, avg_fx_rate = $7`,
          [o.accountId, o.symbol, q.assetClass, q.currency, round8(newQ), round8(newAvg), round8(newFx)],
        );
      await c.query(
        `INSERT INTO transactions (account_id, order_id, symbol, side, quantity, price, currency, fx_rate, fees, realized_pnl, is_close)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
        [o.accountId, o.id, o.symbol, o.side, round8(qty), round8(px), q.currency, round8(fx), round8(fees), round8(realized), pq !== 0 && Math.sign(pq) !== sign],
      );
      await c.query(`UPDATE orders SET status = 'filled', filled_qty = $3, avg_fill_price = $4, updated_at = now() WHERE id = $1 AND account_id = $2`, [o.id, o.accountId, round8(qty), round8(px)]);

      // Un ordre d'entrée exécuté active ses TP/SL ; un TP/SL exécuté annule son jumeau (OCO)
      const activated = (await c.query(
        `UPDATE orders SET status = 'working', updated_at = now() WHERE account_id = $1 AND parent_order_id = $2 AND status = 'pending' RETURNING ${ORDER_COLS}`,
        [o.accountId, o.id],
      )).rows as OrderRow[];
      let siblings: { id: number }[] = [];
      if (o.ocoGroup && o.parentOrderId)
        siblings = (await c.query(
          `UPDATE orders SET status = 'cancelled', updated_at = now() WHERE account_id = $1 AND oco_group = $2 AND id <> $3 AND status IN ('working','pending') RETURNING id`,
          [o.accountId, o.ocoGroup, o.id],
        )).rows;
      await c.query('COMMIT');

      this.unindex(o.id);
      siblings.forEach((r) => this.unindex(r.id));
      activated.forEach((r) => this.index(r));
      await this.refreshWatch();
      this.emit('trade', { accountId: o.accountId, slug: acct.slug });
      return { qty, price: px, realized };
    } catch (e) {
      if (!rejection) await c.query('ROLLBACK').catch(() => {});
      throw e;
    } finally {
      c.release();
    }
  }

  /** Clôture au marché de toute une position (bouton « Fermer »). */
  async closePosition(accountId: number, slug: string, symbol: string) {
    const { rows } = await pool.query('SELECT quantity::float8 AS q FROM positions WHERE account_id = $1 AND symbol = $2', [accountId, symbol]);
    if (!rows[0]) throw new TradingError(404, 'no_position', 'Aucune position sur ce symbole');
    const q = rows[0].q as number;
    // Annule d'abord les TP/SL en cours sur ce symbole
    const { rows: open } = await pool.query(`SELECT id FROM orders WHERE account_id = $1 AND symbol = $2 AND status IN ('working','pending') AND type IN ('take_profit','stop_loss')`, [accountId, symbol]);
    for (const r of open) await this.cancel(accountId, slug, r.id).catch(() => {});
    return this.place(accountId, slug, { symbol, side: q > 0 ? 'sell' : 'buy', type: 'market', quantity: Math.abs(q) });
  }
}

export const engine = new OrderEngine();
