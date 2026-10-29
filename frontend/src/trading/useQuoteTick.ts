import { useSyncExternalStore } from 'react';
import { quoteStore } from '../market/socket';

/** Force un re-rendu à chaque nouvelle cotation du symbole (valeur retournée = dernier prix). */
export function useQuoteTick(symbol: string): number {
  return useSyncExternalStore(
    (l) => quoteStore.subscribe(symbol, l),
    () => quoteStore.get(symbol)?.price ?? 0,
  );
}
