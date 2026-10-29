/**
 * Bus de réticule entre les graphiques d'une mise en page 2/4 : chaque graphique publie l'instant (UTC, secondes)
 * sous la souris ; les autres recalent leur réticule sur la bougie la plus proche, même avec un autre symbole
 * ou une autre unité de temps.
 */
type Listener = (sourceId: string, utc: number | null) => void;
const listeners = new Set<Listener>();
let enabled = true;

export const crosshairBus = {
  publish(sourceId: string, utc: number | null) { if (enabled) listeners.forEach((l) => l(sourceId, utc)); },
  subscribe(l: Listener) { listeners.add(l); return () => { listeners.delete(l); }; },
  setEnabled(v: boolean) { enabled = v; if (!v) listeners.forEach((l) => l('', null)); },
  isEnabled: () => enabled,
};
