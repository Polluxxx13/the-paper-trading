import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { pool } from '../db';
import { engine } from '../trading/engine';

/**
 * Isolation : le compte est TOUJOURS résolu depuis l'URL (/api/accounts/:slug/...)
 * et chaque requête SQL en aval filtre sur account_id.
 */
export async function accountIdFromSlug(req: FastifyRequest): Promise<number> {
  const slug = (req.params as { slug?: string }).slug;
  const { rows } = await pool.query('SELECT id FROM accounts WHERE slug = $1', [slug]);
  if (!rows[0]) throw Object.assign(new Error('Compte introuvable'), { statusCode: 404 });
  return rows[0].id;
}

const ACCOUNT_COLS = `slug, name, color, base_currency AS "baseCurrency",
  initial_capital::float8 AS "initialCapital", cash::float8 AS cash,
  spread_bps::float8 AS "spreadBps", fee_fixed::float8 AS "feeFixed", fee_pct::float8 AS "feePct"`;

export async function accountRoutes(app: FastifyInstance) {
  app.get('/api/accounts', async () => {
    const { rows } = await pool.query(`SELECT ${ACCOUNT_COLS} FROM accounts ORDER BY id`);
    return rows;
  });

  app.get('/api/accounts/:slug', async (req) => {
    const id = await accountIdFromSlug(req);
    const { rows } = await pool.query(`SELECT ${ACCOUNT_COLS} FROM accounts WHERE id = $1`, [id]);
    return rows[0];
  });

  // Paramètres propres au compte : devise, spread, frais
  app.patch('/api/accounts/:slug', async (req) => {
    const id = await accountIdFromSlug(req);
    const body = z
      .object({
        baseCurrency: z.enum(['USD', 'CHF']),
        spreadBps: z.number().min(0).max(1000),
        feeFixed: z.number().min(0),
        feePct: z.number().min(0).max(10),
      })
      .partial()
      .parse(req.body);
    await pool.query(
      `UPDATE accounts SET base_currency = COALESCE($2, base_currency), spread_bps = COALESCE($3, spread_bps),
         fee_fixed = COALESCE($4, fee_fixed), fee_pct = COALESCE($5, fee_pct) WHERE id = $1`,
      [id, body.baseCurrency, body.spreadBps, body.feeFixed, body.feePct],
    );
    const { rows } = await pool.query(`SELECT ${ACCOUNT_COLS} FROM accounts WHERE id = $1`, [id]);
    return rows[0];
  });

  // Réinitialisation d'UN compte : purge uniquement ses lignes, dans une transaction.
  app.post('/api/accounts/:slug/reset', async (req, reply) => {
    const id = await accountIdFromSlug(req);
    const { confirm } = z.object({ confirm: z.literal(true) }).parse(req.body);
    void confirm;
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const { rows } = await client.query('SELECT cash FROM accounts WHERE id = $1 FOR UPDATE', [id]);
      await client.query('INSERT INTO account_resets (account_id, final_equity) VALUES ($1,$2)', [id, rows[0].cash]);
      // Ordre important : transactions -> ordres (FK composites)
      await client.query('DELETE FROM transactions WHERE account_id = $1', [id]);
      await client.query('DELETE FROM positions WHERE account_id = $1', [id]);
      await client.query('DELETE FROM orders WHERE account_id = $1', [id]);
      await client.query('DELETE FROM daily_snapshots WHERE account_id = $1', [id]);
      await client.query('DELETE FROM equity_samples WHERE account_id = $1', [id]);
      await client.query('UPDATE accounts SET cash = initial_capital, reset_at = now() WHERE id = $1', [id]);
      await client.query('COMMIT');
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
    await engine.onAccountReset(id); // vide les ordres actifs de ce compte en mémoire
    return reply.send({ ok: true });
  });
}
