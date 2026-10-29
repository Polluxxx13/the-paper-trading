import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { COOKIE, verifyToken } from '../auth';
import { hub, statusOf } from '../market/quoteHub';
import type { Quote } from '../market/types';
import { engine } from '../trading/engine';
import { originAllowed } from '../security';

const FLUSH_MS = 250; // au plus 4 mises à jour/s par symbole et par client
const MAX_SYMBOLS = 100;

const msgSchema = z.object({
  type: z.enum(['subscribe', 'unsubscribe']),
  symbols: z.array(z.string().trim().min(1).max(30)).max(MAX_SYMBOLS),
});

/**
 * Protocole (JSON) :
 *   client -> {type:'subscribe'|'unsubscribe', symbols:[...]}
 *   serveur -> {type:'quote', quote:{...Quote, status}} | {type:'mode', mode, streamConnected} | {type:'error', message}
 */
export async function wsGateway(app: FastifyInstance) {
  app.get('/ws', { websocket: true }, (socket, req) => {
    if (!originAllowed(req)) return socket.close(4403, 'origin');
    if (!verifyToken(req.cookies[COOKIE])) return socket.close(4401, 'unauthorized');

    const subs = new Set<string>();
    const pending = new Map<string, Quote>();
    const send = (o: unknown) => socket.readyState === socket.OPEN && socket.send(JSON.stringify(o));

    const onQuote = (q: Quote) => {
      if (subs.has(q.symbol)) pending.set(q.symbol, q); // on ne garde que la dernière valeur
    };
    hub.on('quote', onQuote);
    // Fills, annulations, rejets : le navigateur recharge positions/ordres/solde
    const onTrade = (t: { slug: string }) => send({ type: 'trade', account: t.slug });
    engine.on('trade', onTrade);

    const flush = setInterval(() => {
      for (const q of pending.values()) send({ type: 'quote', quote: { ...q, status: statusOf(q) } });
      pending.clear();
    }, FLUSH_MS);

    const sub = async (symbol: string) => {
      if (subs.has(symbol) || subs.size >= MAX_SYMBOLS) return;
      subs.add(symbol);
      hub.retain(symbol);
      try {
        const q = await hub.getQuote(symbol); // snapshot immédiat
        if (subs.has(symbol)) send({ type: 'quote', quote: { ...q, status: statusOf(q) } });
      } catch (e) {
        send({ type: 'error', symbol, message: (e as Error).message });
      }
    };
    const unsub = (symbol: string) => {
      if (subs.delete(symbol)) hub.release(symbol);
    };

    socket.on('message', (raw: Buffer) => {
      try {
        const m = msgSchema.parse(JSON.parse(raw.toString()));
        for (const s of m.symbols) (m.type === 'subscribe' ? sub : unsub)(s);
      } catch {
        send({ type: 'error', message: 'Message invalide' });
      }
    });

    // Le mode (flux / repli) est diffusé toutes les 5 s pour l'indicateur de connexion
    const modeTimer = setInterval(() => send({ type: 'mode', ...hub.health() }), 5_000);
    send({ type: 'mode', ...hub.health() });

    socket.on('close', () => {
      clearInterval(flush);
      clearInterval(modeTimer);
      hub.off('quote', onQuote);
      engine.off('trade', onTrade);
      for (const s of [...subs]) unsub(s);
    });
  });
}
