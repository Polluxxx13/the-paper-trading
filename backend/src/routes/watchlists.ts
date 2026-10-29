import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { pool } from '../db';

const DEFAULT_SYMBOLS = ['AAPL', 'MSFT', 'NESN.SW', '^GSPC', 'BTC-USD', 'EURUSD=X', 'GC=F'];
const symbol = z.string().trim().min(1).max(30).regex(/^[A-Za-z0-9.\-=^_]+$/, 'Symbole invalide');

/** Watchlists partagées entre les deux comptes (ce n'est pas de l'état de trading). */
export async function watchlistRoutes(app: FastifyInstance) {
  async function load() {
    const { rows } = await pool.query(
      `SELECT w.id, w.name, COALESCE(array_agg(i.symbol ORDER BY i.position) FILTER (WHERE i.symbol IS NOT NULL), '{}') AS symbols
       FROM watchlists w LEFT JOIN watchlist_items i ON i.watchlist_id = w.id
       GROUP BY w.id ORDER BY w.position, w.id`,
    );
    return rows;
  }

  app.get('/api/watchlists', async () => {
    let lists = await load();
    if (!lists.length) {
      // Première utilisation : watchlist par défaut
      const { rows } = await pool.query(`INSERT INTO watchlists (name) VALUES ('Ma watchlist') RETURNING id`);
      await pool.query(
        `INSERT INTO watchlist_items (watchlist_id, symbol, position) SELECT $1, s, ord FROM unnest($2::text[]) WITH ORDINALITY AS t(s, ord)`,
        [rows[0].id, DEFAULT_SYMBOLS],
      );
      lists = await load();
    }
    return lists;
  });

  app.post('/api/watchlists/:id/items', async (req) => {
    const id = z.coerce.number().int().parse((req.params as { id: string }).id);
    const { symbol: s } = z.object({ symbol }).parse(req.body);
    await pool.query(
      `INSERT INTO watchlist_items (watchlist_id, symbol, position)
       VALUES ($1, $2, COALESCE((SELECT MAX(position) + 1 FROM watchlist_items WHERE watchlist_id = $1), 0))
       ON CONFLICT DO NOTHING`,
      [id, s],
    );
    return { ok: true };
  });

  app.delete('/api/watchlists/:id/items/:symbol', async (req) => {
    const p = req.params as { id: string; symbol: string };
    await pool.query('DELETE FROM watchlist_items WHERE watchlist_id = $1 AND symbol = $2', [Number(p.id), p.symbol]);
    return { ok: true };
  });
}
