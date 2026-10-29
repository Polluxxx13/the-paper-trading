import { useCallback, useEffect, useState } from 'react';
import { Account, api } from './api';
import Login from './Login';
import Workspace from './Workspace';
import PortfolioView from './portfolio/PortfolioView';
import CalendarView from './calendar/CalendarView';

const money = (n: number, cur: string) => new Intl.NumberFormat('fr-CH', { style: 'currency', currency: cur }).format(n);

export default function App() {
  const [authed, setAuthed] = useState<boolean | null>(null);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [active, setActive] = useState<Account['slug']>('main');
  const [error, setError] = useState('');
  const [view, setView] = useState<'trading' | 'portfolio' | 'calendar'>('trading');

  const load = useCallback(async () => {
    try {
      setAccounts(await api<Account[]>('/api/accounts'));
    } catch {
      setAuthed(false);
    }
  }, []);

  useEffect(() => {
    api<{ authenticated: boolean }>('/api/auth/me').then((r) => {
      setAuthed(r.authenticated);
      if (r.authenticated) load();
    });
  }, [load]);

  if (authed === null) return null;
  if (!authed) return <Login onSuccess={() => { setAuthed(true); load(); }} />;

  const account = accounts.find((a) => a.slug === active);

  async function reset() {
    if (!account) return;
    if (!window.confirm(`Réinitialiser le compte « ${account.name} » ?\nPositions, ordres, historique et calendrier seront effacés. Capital remis à ${money(account.initialCapital, account.baseCurrency)}.`)) return;
    try {
      await api(`/api/accounts/${account.slug}/reset`, { method: 'POST', body: { confirm: true } });
      await load();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  async function logout() {
    await api('/api/auth/logout', { method: 'POST' });
    setAuthed(false);
  }

  return (
    <div className="h-full flex flex-col">
      <header className="flex flex-wrap items-center gap-x-2 gap-y-1 px-3 py-1.5 min-h-12 bg-tv-panel border-b border-tv-border">
        {accounts.map((a) => (
          <button
            key={a.slug}
            onClick={() => setActive(a.slug)}
            className={`px-4 py-1.5 rounded text-sm font-medium border ${active === a.slug ? 'text-white' : 'text-tv-muted border-transparent'}`}
            style={active === a.slug ? { background: a.color + '33', borderColor: a.color } : undefined}
          >
            {a.name}
          </button>
        ))}
        <nav className="flex gap-1 ml-4 border-l border-tv-border pl-4">
          {(['trading', 'portfolio', 'calendar'] as const).map((v) => (
            <button key={v} onClick={() => setView(v)} className={`px-3 py-1 rounded text-sm ${view === v ? 'bg-tv-border text-white' : 'text-tv-muted hover:text-tv-text'}`}>{v === 'trading' ? 'Trading' : v === 'portfolio' ? 'Portfolio' : 'Calendrier'}</button>
          ))}
        </nav>
        {account && (
          <span className="ml-4 text-sm text-tv-muted">
            Cash <b className="text-tv-text">{money(account.cash, account.baseCurrency)}</b>
          </span>
        )}
        <div className="ml-auto flex gap-2">
          <button onClick={reset} className="text-sm px-3 py-1 rounded border border-tv-border hover:border-tv-down">Réinitialiser le compte</button>
          <button onClick={logout} className="text-sm px-3 py-1 rounded border border-tv-border">Déconnexion</button>
        </div>
      </header>
      {/* Bandeau de couleur : identifie le compte actif en un coup d'œil */}
      <div className="h-1" style={{ background: account?.color }} />
      {error && <p className="px-3 py-1 text-sm text-tv-down">{error}</p>}
      {account && view === 'trading' && <Workspace key={account.slug} account={account} onAccountChanged={load} />}
      {account && view === 'portfolio' && <PortfolioView key={account.slug} account={account} />}
      {account && view === 'calendar' && <CalendarView key={account.slug} account={account} />}
    </div>
  );
}
