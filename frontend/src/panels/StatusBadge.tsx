import { FeedStatus } from '../market/types';

const STYLE: Record<FeedStatus, { label: string; color: string }> = {
  live: { label: 'Live', color: '#26a69a' },
  delayed: { label: 'Différé', color: '#ff9800' },
  closed: { label: 'Marché fermé', color: '#787b86' },
};

/** Pastille Live / Différé / Marché fermé, avec l'heure de la dernière cotation en infobulle. */
export default function StatusBadge({ status, time, dotOnly = false }: { status: FeedStatus; time?: number; dotOnly?: boolean }) {
  const s = STYLE[status];
  const title = `${s.label}${time ? ` · dernière cotation ${new Date(time).toLocaleString('fr-CH')}` : ''}`;
  return (
    <span className="inline-flex items-center gap-1.5 text-xs" style={{ color: s.color }} title={title}>
      <span className={`w-2 h-2 rounded-full ${status === 'live' ? 'animate-pulse' : ''}`} style={{ background: s.color }} />
      {!dotOnly && s.label}
    </span>
  );
}
