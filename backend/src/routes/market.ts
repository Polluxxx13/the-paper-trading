import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { getHistory, isTimeframe } from '../market/history';
import { hub, statusOf } from '../market/quoteHub';
import { fetchQuotes, searchSymbols, wrapYahooError } from '../market/yahoo';
import { MarketError } from '../market/types';
import { getSparkline } from '../market/sparkline';
import { getNews } from '../market/news';

const symbolSchema = z.string().trim().min(1).max(30).regex(/^[A-Za-z0-9.\-=^_]+$/, 'Symbole invalide');

export async function marketRoutes(app: FastifyInstance) {
  // Recherche universelle par symbole ou nom
  app.get('/api/market/search', async (req) => {
    const { q } = z.object({ q: z.string().trim().min(1).max(60) }).parse(req.query);
    try {
      return await searchSymbols(q);
    } catch (e) {
      return wrapYahooError(e);
    }
  });

  // Cotations (batch) avec statut Live / Différé / Fermé
  app.get('/api/market/quotes', async (req) => {
    const { symbols } = z.object({ symbols: z.string() }).parse(req.query);
    const list = [...new Set(symbols.split(',').map((s) => symbolSchema.parse(s)))].slice(0, 100);
    try {
      const quotes = await fetchQuotes(list);
      return quotes.map((q) => ({ ...q, status: statusOf(q) }));
    } catch (e) {
      return wrapYahooError(e);
    }
  });

  app.get('/api/market/quote/:symbol', async (req) => {
    const symbol = symbolSchema.parse((req.params as { symbol: string }).symbol);
    try {
      const q = await hub.getQuote(symbol);
      return { ...q, status: statusOf(q) };
    } catch (e) {
      if (e instanceof MarketError) throw e;
      return wrapYahooError(e, symbol);
    }
  });

  // Actualités du symbole, avec images (cache 30 min côté serveur)
  app.get('/api/market/news', async (req) => {
    const { symbol } = z.object({ symbol: symbolSchema }).parse(req.query);
    try {
      return await getNews(symbol);
    } catch (e) {
      return wrapYahooError(e, symbol);
    }
  });

  // Historique : 1m, 5m, 15m, 1h, 4h, 1d, 1w, 1M
  app.get('/api/market/history', async (req) => {
    const { symbol, tf } = z.object({ symbol: symbolSchema, tf: z.string() }).parse(req.query);
    if (!isTimeframe(tf)) throw new MarketError(400, 'invalid_timeframe', `Unité de temps inconnue : ${tf}`);
    return getHistory(symbol, tf);
  });

  // Mini-courbes de la watchlist : { "AAPL": [clôtures...], ... }
  app.get('/api/market/sparklines', async (req) => {
    const { symbols } = z.object({ symbols: z.string() }).parse(req.query);
    const list = [...new Set(symbols.split(',').map((s) => symbolSchema.parse(s)))].slice(0, 50);
    const entries = await Promise.all(list.map(async (s) => [s, await getSparkline(s)] as const));
    return Object.fromEntries(entries);
  });

  // Santé du flux (utile au diagnostic sur Render)
  app.get('/api/market/health', async () => hub.health());
}
