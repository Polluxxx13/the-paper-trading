import { config } from '../config';
import { sampleAll } from '../portfolio/equity';

/** Date et heure locales (fuseau SNAPSHOT_TZ) sous la forme { date: 'YYYY-MM-DD', hm: 'HH:MM' }. */
function localNow(now = new Date()) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-CA', { timeZone: config.snapshotTz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
      .formatToParts(now).map((p) => [p.type, p.value]),
  );
  return { date: `${parts.year}-${parts.month}-${parts.day}`, hm: `${parts.hour}:${parts.minute}` };
}

/**
 * Snapshot de clôture : à SNAPSHOT_TIME (22:05 Europe/Zurich par défaut, après la clôture US/EU),
 * enregistre la valeur de chaque compte dans daily_snapshots. Vérifie chaque 30 s ; une seule exécution par jour.
 * Si le serveur était éteint à cette heure, le rattrapage se fait au premier passage après l'heure prévue.
 */
export function startDailySnapshotJob() {
  let lastRun = '';
  const tick = () => {
    const { date, hm } = localNow();
    if (lastRun !== date && hm >= config.snapshotTime) {
      lastRun = date;
      sampleAll().then(() => console.log(`[snapshot] clôture ${date} enregistrée`)).catch((e) => { lastRun = ''; console.warn('[snapshot] échec :', e.message); });
    }
  };
  setInterval(tick, 30_000);
  tick();
}
