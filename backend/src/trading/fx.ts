import { TtlCache } from '../market/cache';
import { hub } from '../market/quoteHub';

export class TradingError extends Error {
  constructor(public statusCode: number, public code: string, message: string) {
    super(message);
  }
}

const cache = new TtlCache<number>(100);

/**
 * Multiplicateur "devise native du titre -> devise du compte", via les taux Yahoo (ex. USDCHF=X).
 * Gère les sous-unités (GBp/GBX = pence : ×0,01 GBP). Essaie la paire inverse si la directe n'existe pas.
 */
export async function fxToAccount(currency: string, account: string): Promise<number> {
  let cur = currency;
  let sub = 1;
  if (cur === 'GBp' || cur === 'GBX') { cur = 'GBP'; sub = 0.01; }
  else if (cur === 'ILA') { cur = 'ILS'; sub = 0.01; }
  if (cur === account) return sub;

  const rate = await cache.getOrLoad(`${cur}${account}`, 15_000, async () => {
    try {
      return (await hub.getQuote(`${cur}${account}=X`)).price;
    } catch {
      try {
        return 1 / (await hub.getQuote(`${account}${cur}=X`)).price;
      } catch {
        throw new TradingError(502, 'fx_unavailable', `Taux de change ${cur}/${account} indisponible`);
      }
    }
  });
  return rate * sub;
}
