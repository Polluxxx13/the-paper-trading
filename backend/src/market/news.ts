import { TtlCache } from './cache';
import { yf } from './yahoo';

export interface NewsItem {
  id: string;
  title: string;
  publisher: string;
  link: string;
  time: number; // ms epoch
  image: string | null;
  related: string[];
}

const NEWS_TTL_MS = 30 * 60_000; // renouvelé au plus tard 30 min après la dernière lecture : toujours le jour même
const IMAGE_TTL_MS = 24 * 3600_000; // une image trouvée sur la page d'un article ne change pas
const newsCache = new TtlCache<NewsItem[]>(300);
const imageCache = new TtlCache<string | null>(500);

/** Seules les adresses https vers un nom d'hôte public sont suivies (pas de localhost ni d'IP : pas de requête vers le réseau interne). */
function isPublicHttps(raw: string): boolean {
  try {
    const u = new URL(raw);
    if (u.protocol !== 'https:') return false;
    const h = u.hostname;
    return h.includes('.') && !/^[\d.]+$/.test(h) && !h.includes(':') && !h.endsWith('.local') && !h.endsWith('.internal');
  } catch {
    return false;
  }
}

function bestThumbnail(n: any): string | null {
  const res: { url: string; width?: number }[] = n?.thumbnail?.resolutions ?? [];
  const usable = res.filter((r) => r?.url && isPublicHttps(r.url));
  if (!usable.length) return null;
  // La plus petite image d'au moins 300 px de large, sinon la plus grande disponible
  const sorted = [...usable].sort((a, b) => (a.width ?? 0) - (b.width ?? 0));
  return (sorted.find((r) => (r.width ?? 0) >= 300) ?? sorted[sorted.length - 1]).url;
}

/** Repli : image de partage (og:image) trouvée sur la page de l'article, quand Yahoo n'en fournit pas. */
function pageImage(link: string): Promise<string | null> {
  return imageCache.getOrLoad(link, IMAGE_TTL_MS, async () => {
    if (!isPublicHttps(link)) return null;
    try {
      const res = await fetch(link, { signal: AbortSignal.timeout(4000), redirect: 'follow', headers: { 'user-agent': 'Mozilla/5.0 (compatible; PaperTrading/1.0)', accept: 'text/html' } });
      if (!res.ok || !(res.headers.get('content-type') ?? '').includes('html')) return null;
      const html = (await res.text()).slice(0, 300_000);
      const tag = html.match(/<meta[^>]+(?:property|name)=["'](?:og:image|twitter:image)["'][^>]*>/i)?.[0];
      const url = tag?.match(/content=["']([^"']+)["']/i)?.[1]?.replace(/&amp;/g, '&');
      if (!url) return null;
      const abs = new URL(url, res.url).toString();
      return isPublicHttps(abs) ? abs : null;
    } catch {
      return null;
    }
  });
}

export function getNews(symbol: string): Promise<NewsItem[]> {
  return newsCache.getOrLoad(symbol.toUpperCase(), NEWS_TTL_MS, async () => {
    const res: any = await yf.search(symbol, { quotesCount: 0, newsCount: 14 });
    const items: NewsItem[] = (res.news ?? [])
      .filter((n: any) => n?.title && isPublicHttps(n.link))
      .map((n: any) => ({
        id: String(n.uuid ?? n.link),
        title: String(n.title),
        publisher: String(n.publisher ?? ''),
        link: String(n.link),
        time: n.providerPublishTime instanceof Date ? n.providerPublishTime.getTime() : Number(n.providerPublishTime ?? 0) * 1000,
        image: bestThumbnail(n),
        related: Array.isArray(n.relatedTickers) ? n.relatedTickers.slice(0, 4).map(String) : [],
      }));
    // Recherche d'images sur le web pour les articles sans vignette (6 au plus, en parallèle)
    await Promise.all(items.filter((i) => !i.image).slice(0, 6).map(async (i) => { i.image = await pageImage(i.link); }));
    return items.sort((a, b) => b.time - a.time);
  });
}
