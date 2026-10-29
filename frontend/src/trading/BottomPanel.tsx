import { useState } from 'react';
import { api } from '../api';
import type { Account } from '../api';
import { fmtPrice } from '../market/types';
import { useSubscription } from '../market/socket';
import OrderTicket from './OrderTicket';
import OrderBook from './OrderBook';
import NewsPanel from './NewsPanel';
import { AccountData, Order, Position, Transaction, livePnl } from './useAccount';
import { useQuoteTick } from './useQuoteTick';

const TYPE_LABEL: Record<string, string> = {
  market: 'Marché', limit: 'Limite', stop: 'Stop', stop_limit: 'Stop-limite', take_profit: 'Take-profit', stop_loss: 'Stop-loss', trailing_stop: 'Trailing stop',
};
const STATUS_LABEL: Record<string, string> = { working: 'En attente', pending: 'Lié (inactif)', filled: 'Exécuté', cancelled: 'Annulé', rejected: 'Rejeté', expired: 'Expiré' };
const money = (n: number, cur: string) => n.toLocaleString('fr-CH', { style: 'currency', currency: cur });
const pnlColor = (n: number) => (n >= 0 ? 'text-tv-up' : 'text-tv-down');

const Th = ({ children }: { children?: React.ReactNode }) => <th className="text-left font-normal text-tv-muted px-3 py-1.5 whitespace-nowrap">{children}</th>;
const Td = ({ children, cls = '' }: { children?: React.ReactNode; cls?: string }) => <td className={`px-3 py-1.5 whitespace-nowrap ${cls}`}>{children}</td>;

function PositionRow({ p, account, onClose }: { p: Position; account: Account; onClose: () => void }) {
  useQuoteTick(p.symbol); // re-rendu à chaque tick
  const l = livePnl(p);
  return (
    <tr className="border-t border-tv-border/50">
      <Td cls="font-medium">{p.symbol}</Td>
      <Td cls={p.quantity > 0 ? 'text-tv-up' : 'text-tv-down'}>{p.quantity > 0 ? 'Long' : 'Short'}</Td>
      <Td>{Math.abs(p.quantity)}</Td>
      <Td>{fmtPrice(p.avgPrice)}</Td>
      <Td>{fmtPrice(l.price)}</Td>
      <Td>{money(l.marketValue, account.baseCurrency)}</Td>
      <Td cls={pnlColor(l.pnl)}>{money(l.pnl, account.baseCurrency)} ({l.pct.toFixed(2)}%)</Td>
      <Td><button onClick={onClose} className="px-2 py-0.5 border border-tv-border rounded hover:border-tv-down text-xs">Fermer</button></Td>
    </tr>
  );
}

export default function BottomPanel({ account, symbol, data, onAccountChanged }: { account: Account; symbol: string; data: AccountData; onAccountChanged: () => void }) {
  const { cash, positions, orders, transactions, reload } = data;
  const [tab, setTab] = useState<'ticket' | 'book' | 'positions' | 'orders' | 'history' | 'news'>('ticket');
  const [err, setErr] = useState('');
  useSubscription(positions.map((p) => p.symbol)); // prix live des positions détenues
  void cash;

  const open = orders.filter((o) => o.status === 'working' || o.status === 'pending');
  const refresh = () => { reload().catch(() => {}); onAccountChanged(); };

  async function run(fn: () => Promise<unknown>) {
    setErr('');
    try { await fn(); } catch (e) { setErr((e as Error).message); }
    refresh();
  }

  const tabBtn = (id: typeof tab, label: string) => (
    <button onClick={() => setTab(id)} className={`px-3 py-1.5 text-sm border-b-2 ${tab === id ? 'border-tv-blue text-tv-text' : 'border-transparent text-tv-muted hover:text-tv-text'}`}>{label}</button>
  );

  return (
    <div className="h-64 shrink-0 border-t border-tv-border bg-tv-panel flex flex-col" style={{ borderTopColor: account.color }}>
      <div className="flex items-center border-b border-tv-border px-2">
        {tabBtn('ticket', 'Ordre')}
        {tabBtn('book', 'Carnet')}
        {tabBtn('positions', `Positions (${positions.length})`)}
        {tabBtn('orders', `Ordres (${open.length})`)}
        {tabBtn('history', 'Historique')}
        {tabBtn('news', 'Actualités')}
        {err && <span className="ml-3 text-sm text-tv-down">{err}</span>}
      </div>
      <div className="flex-1 overflow-auto text-sm">
        {tab === 'ticket' && <OrderTicket account={account} symbol={symbol} onDone={refresh} />}
        {tab === 'news' && <NewsPanel symbol={symbol} />}
      {tab === 'book' &&<OrderBook symbol={symbol} orders={orders} />}

        {tab === 'positions' && (
          <table className="w-full"><thead><tr><Th>Symbole</Th><Th>Sens</Th><Th>Qté</Th><Th>Prix moyen</Th><Th>Prix actuel</Th><Th>Valeur</Th><Th>P&amp;L latent</Th><Th /></tr></thead>
            <tbody>
              {positions.map((p) => <PositionRow key={p.symbol} p={p} account={account} onClose={() => run(() => api(`/api/accounts/${account.slug}/positions/${encodeURIComponent(p.symbol)}/close`, { method: 'POST' }))} />)}
              {!positions.length && <tr><Td cls="text-tv-muted">Aucune position ouverte.</Td></tr>}
            </tbody></table>
        )}

        {tab === 'orders' && (
          <table className="w-full"><thead><tr><Th>Symbole</Th><Th>Sens</Th><Th>Type</Th><Th>Qté</Th><Th>Limite</Th><Th>Stop / trailing</Th><Th>Statut</Th><Th /></tr></thead>
            <tbody>
              {orders.slice(0, 100).map((o: Order) => (
                <tr key={o.id} className="border-t border-tv-border/50">
                  <Td cls="font-medium">{o.symbol}</Td>
                  <Td cls={o.side === 'buy' ? 'text-tv-up' : 'text-tv-down'}>{o.side === 'buy' ? 'Achat' : 'Vente'}</Td>
                  <Td>{TYPE_LABEL[o.type] ?? o.type}{o.parentOrderId ? ' (lié)' : ''}</Td>
                  <Td>{o.quantity}</Td>
                  <Td>{o.limitPrice ? fmtPrice(o.limitPrice) : '–'}</Td>
                  <Td>{o.stopPrice ? fmtPrice(o.stopPrice) : o.trailAmount ? `±${o.trailAmount}` : o.trailPercent ? `±${o.trailPercent}%` : '–'}</Td>
                  <Td cls={o.status === 'rejected' ? 'text-tv-down' : o.status === 'filled' ? 'text-tv-up' : ''}>{STATUS_LABEL[o.status] ?? o.status}{o.rejectReason ? ` : ${o.rejectReason}` : ''}</Td>
                  <Td>{(o.status === 'working' || o.status === 'pending') && <button onClick={() => run(() => api(`/api/accounts/${account.slug}/orders/${o.id}`, { method: 'DELETE' }))} className="px-2 py-0.5 border border-tv-border rounded hover:border-tv-down text-xs">Annuler</button>}</Td>
                </tr>
              ))}
              {!orders.length && <tr><Td cls="text-tv-muted">Aucun ordre.</Td></tr>}
            </tbody></table>
        )}

        {tab === 'history' && (
          <table className="w-full"><thead><tr><Th>Date</Th><Th>Symbole</Th><Th>Sens</Th><Th>Qté</Th><Th>Prix</Th><Th>Frais</Th><Th>P&amp;L réalisé</Th></tr></thead>
            <tbody>
              {transactions.map((t: Transaction) => (
                <tr key={t.id} className="border-t border-tv-border/50">
                  <Td>{new Date(t.executedAt).toLocaleString('fr-CH')}</Td>
                  <Td cls="font-medium">{t.symbol}</Td>
                  <Td cls={t.side === 'buy' ? 'text-tv-up' : 'text-tv-down'}>{t.side === 'buy' ? 'Achat' : 'Vente'}</Td>
                  <Td>{t.quantity}</Td>
                  <Td>{fmtPrice(t.price)} {t.currency}</Td>
                  <Td>{t.fees ? money(t.fees, account.baseCurrency) : '–'}</Td>
                  <Td cls={pnlColor(t.realizedPnl)}>{money(t.realizedPnl, account.baseCurrency)}</Td>
                </tr>
              ))}
              {!transactions.length && <tr><Td cls="text-tv-muted">Aucune transaction.</Td></tr>}
            </tbody></table>
        )}
      </div>
    </div>
  );
}
