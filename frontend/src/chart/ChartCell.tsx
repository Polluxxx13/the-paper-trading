import { useEffect, useState } from 'react';
import { api } from '../api';
import type { Account } from '../api';
import { quoteStore } from '../market/socket';
import type { ChartType, Timeframe } from '../market/types';
import ChartOrders from '../trading/ChartOrders';
import type { AccountData } from '../trading/useAccount';
import ChartContextMenu from './ChartContextMenu';
import ChartStack from './ChartStack';
import type { Drawing, ToolId } from './drawings/model';
import { DrawingsApi, useDrawings } from './drawings/useDrawings';
import type { IndicatorInstance } from './indicators/registry';
import { MenuAction, OrderBody, contextActions, defaultQty, orderFromPosition } from './orderHelpers';

interface Props {
  id: string;
  symbol: string;
  tf: Timeframe;
  type: ChartType;
  active: boolean;
  multi: boolean;
  onActivate: () => void;
  indicators: IndicatorInstance[];
  onIndicators: (n: IndicatorInstance[]) => void;
  tool: ToolId | null;
  onToolDone: () => void;
  account: Account;
  data: AccountData;
  onTrade: () => void;
  notify: (text: string, ok: boolean) => void;
  /** La cellule active expose son magasin de dessins à la barre d'outils. */
  onStore: (s: DrawingsApi) => void;
}

/** Une cellule de la mise en page : graphique + indicateurs + dessins + ordres sur le graphique. */
export default function ChartCell(p: Props) {
  const store = useDrawings(p.symbol);
  const [menu, setMenu] = useState<{ x: number; y: number; price: number } | null>(null);
  const [qty, setQty] = useState(1);

  const { active, onStore } = p;
  useEffect(() => { if (active) onStore(store); }, [active, store, onStore]);

  const quote = () => quoteStore.get(p.symbol);
  const posQty = () => p.data.positions.find((x) => x.symbol === p.symbol)?.quantity ?? 0;

  async function place(body: OrderBody) {
    try {
      const o = await api<{ status: string; avgFillPrice: number | null }>(`/api/accounts/${p.account.slug}/orders`, { method: 'POST', body });
      p.notify(o.status === 'filled' ? `Exécuté : ${body.side === 'buy' ? 'achat' : 'vente'} ${body.quantity} ${p.symbol} @ ${o.avgFillPrice}` : 'Ordre placé (en attente)', true);
    } catch (e) { p.notify((e as Error).message, false); }
    p.onTrade();
  }

  function openMenu(c: { x: number; y: number; price: number }) {
    setQty(defaultQty(quote()?.assetClass));
    setMenu(c);
  }

  function placeFromDrawing(d: Drawing) {
    const q = quote();
    if (!q || (d.tool !== 'long' && d.tool !== 'short')) return;
    const n = defaultQty(q.assetClass);
    const body = orderFromPosition(p.symbol, d.tool, d.anchors[0].price, d.anchors[1].price, d.anchors[2].price, q.price, n);
    const txt = `${body.side === 'buy' ? 'Acheter' : 'Vendre'} ${n} ${p.symbol} ${body.type === 'market' ? 'au marché' : `limite @ ${body.limitPrice}`}\nTake-profit ${body.takeProfit} · Stop-loss ${body.stopLoss}\nCompte : ${p.account.name}`;
    if (window.confirm(txt)) void place(body);
  }

  return (
    <div onPointerDownCapture={p.onActivate} className={`relative flex flex-col min-h-0 min-w-0 ${p.multi ? 'border' : ''}`} style={{ borderColor: p.multi ? (p.active ? '#2962ff' : '#2a2e39') : undefined }}>
      {p.multi && (
        <div className="absolute top-1 right-20 z-20 text-xs px-2 py-0.5 rounded bg-tv-panel/90 border border-tv-border text-tv-muted pointer-events-none">
          <b className="text-tv-text">{p.symbol}</b> · {p.tf}
        </div>
      )}
      <ChartStack
        cellId={p.id} symbol={p.symbol} tf={p.tf} type={p.type}
        indicators={p.indicators} onChange={p.onIndicators}
        drawings={store} tool={p.active ? p.tool : null} onToolDone={p.onToolDone}
        onContext={openMenu} onPlaceOrder={placeFromDrawing}
        overlay={(handle) => (
          <>
            <ChartOrders handle={handle} account={p.account} symbol={p.symbol} orders={p.data.orders} positions={p.data.positions} onChanged={p.onTrade} onError={(m) => p.notify(m, false)} />
            {menu && quote() && (
              <ChartContextMenu
                x={menu.x} y={menu.y} price={menu.price} qty={qty} onQty={setQty}
                actions={contextActions(p.symbol, menu.price, quote()!.price, qty, posQty())}
                onPick={(a: MenuAction) => { setMenu(null); void place(a.body); }}
                onClose={() => setMenu(null)}
              />
            )}
          </>
        )}
      />
    </div>
  );
}
