import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { pool } from '../db';

const TOOLS = ['trend', 'ray', 'hline', 'vline', 'channel', 'fib', 'fibext', 'rect', 'text', 'arrow', 'measure', 'long', 'short'] as const;
const symbol = z.string().trim().min(1).max(30).regex(/^[A-Za-z0-9.\-=^_]+$/, 'Symbole invalide');
const anchors = z.array(z.object({ time: z.number().finite(), price: z.number().finite() })).min(1).max(3);
const style = z.object({
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/),
  width: z.number().min(1).max(6),
  text: z.string().max(200).optional(),
});
const id = z.string().uuid();

const COLS = `id, symbol, tool, anchors, style, created_at AS "createdAt"`;

/**
 * Dessins sauvegardés par symbole. Ils sont partagés entre les comptes Principal et Test
 * (ce sont des annotations de graphique, pas de l'état de trading) et visibles sur toutes les unités de temps.
 */
export async function drawingRoutes(app: FastifyInstance) {
  app.get('/api/drawings', async (req) => {
    const { symbol: s } = z.object({ symbol }).parse(req.query);
    const { rows } = await pool.query(`SELECT ${COLS} FROM drawings WHERE symbol = $1 ORDER BY created_at`, [s]);
    return rows;
  });

  app.post('/api/drawings', async (req, reply) => {
    const b = z.object({ symbol, tool: z.enum(TOOLS), anchors, style }).parse(req.body);
    const { rows } = await pool.query(
      `INSERT INTO drawings (symbol, tool, anchors, style) VALUES ($1,$2,$3,$4) RETURNING ${COLS}`,
      [b.symbol, b.tool, JSON.stringify(b.anchors), JSON.stringify(b.style)],
    );
    return reply.code(201).send(rows[0]);
  });

  app.put('/api/drawings/:id', async (req) => {
    const drawingId = id.parse((req.params as { id: string }).id);
    const b = z.object({ anchors: anchors.optional(), style: style.optional() }).parse(req.body);
    const { rows } = await pool.query(
      `UPDATE drawings SET anchors = COALESCE($2::jsonb, anchors), style = COALESCE($3::jsonb, style), updated_at = now()
       WHERE id = $1 RETURNING ${COLS}`,
      [drawingId, b.anchors ? JSON.stringify(b.anchors) : null, b.style ? JSON.stringify(b.style) : null],
    );
    if (!rows[0]) throw Object.assign(new Error('Dessin introuvable'), { statusCode: 404 });
    return rows[0];
  });

  app.delete('/api/drawings/:id', async (req) => {
    const { rowCount } = await pool.query('DELETE FROM drawings WHERE id = $1', [id.parse((req.params as { id: string }).id)]);
    if (!rowCount) throw Object.assign(new Error('Dessin introuvable'), { statusCode: 404 });
    return { ok: true };
  });

  // Efface tous les dessins d'un symbole
  app.delete('/api/drawings', async (req) => {
    const { symbol: s } = z.object({ symbol }).parse(req.query);
    const { rowCount } = await pool.query('DELETE FROM drawings WHERE symbol = $1', [s]);
    return { deleted: rowCount };
  });
}
