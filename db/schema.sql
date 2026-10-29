-- Paper Trading : schéma PostgreSQL 16 (idempotent, rejoué à chaque démarrage).
-- Montants en NUMERIC(20,8) : jamais de float pour l'argent.
-- Isolation : chaque table "métier" porte account_id, et les FK sont COMPOSITES
-- (account_id, id) pour qu'une ligne du compte A ne puisse pas référencer le compte B.

DO $$ BEGIN
  CREATE TYPE order_type   AS ENUM ('market','limit','stop','stop_limit','take_profit','stop_loss','trailing_stop');
  CREATE TYPE order_side   AS ENUM ('buy','sell');
  CREATE TYPE order_status AS ENUM ('pending','working','filled','cancelled','rejected','expired');
  CREATE TYPE asset_class  AS ENUM ('equity','etf','index','forex','crypto','commodity','future','other');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ───────────── Comptes ─────────────
CREATE TABLE IF NOT EXISTS accounts (
  id               SERIAL PRIMARY KEY,
  slug             TEXT UNIQUE NOT NULL CHECK (slug IN ('main','test')),
  name             TEXT NOT NULL,
  color            TEXT NOT NULL,                       -- identité visuelle (Test = autre couleur)
  base_currency    CHAR(3) NOT NULL DEFAULT 'USD' CHECK (base_currency IN ('USD','CHF')),
  initial_capital  NUMERIC(20,8) NOT NULL,
  cash             NUMERIC(20,8) NOT NULL,
  spread_bps       NUMERIC(8,2)  NOT NULL DEFAULT 0,    -- spread simulé (points de base)
  fee_fixed        NUMERIC(20,8) NOT NULL DEFAULT 0,
  fee_pct          NUMERIC(8,5)  NOT NULL DEFAULT 0,
  reset_at         TIMESTAMPTZ NOT NULL DEFAULT now(),  -- début de la "vie" courante du compte
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
INSERT INTO accounts (slug,name,color,initial_capital,cash) VALUES
  ('main','Principal','#2962ff',1000000,1000000),
  ('test','Test','#ff9800',1000,1000)
ON CONFLICT (slug) DO NOTHING;

CREATE TABLE IF NOT EXISTS account_resets (            -- traçabilité des "Réinitialiser le compte"
  id SERIAL PRIMARY KEY,
  account_id INT NOT NULL REFERENCES accounts(id),
  reset_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  final_equity NUMERIC(20,8)
);

-- ───────────── Ordres ─────────────
CREATE TABLE IF NOT EXISTS orders (
  id              BIGSERIAL PRIMARY KEY,
  account_id      INT NOT NULL REFERENCES accounts(id),
  symbol          TEXT NOT NULL,
  asset_class     asset_class NOT NULL DEFAULT 'other',
  side            order_side NOT NULL,
  type            order_type NOT NULL,
  quantity        NUMERIC(20,8) NOT NULL CHECK (quantity > 0),  -- fractions autorisées
  limit_price     NUMERIC(20,8),
  stop_price      NUMERIC(20,8),
  trail_amount    NUMERIC(20,8),                       -- trailing : montant ou ...
  trail_percent   NUMERIC(8,4),                        -- ... pourcentage
  status          order_status NOT NULL DEFAULT 'working',
  parent_order_id BIGINT,                              -- TP/SL attachés à un ordre d'entrée
  oco_group       UUID,                                -- l'exécution d'un enfant annule son frère
  filled_qty      NUMERIC(20,8) NOT NULL DEFAULT 0,
  avg_fill_price  NUMERIC(20,8),
  reject_reason   TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (account_id, id),
  FOREIGN KEY (account_id, parent_order_id) REFERENCES orders(account_id, id)
);
-- Ajouts module 4 : stop-limit déclenché, référence du trailing stop
ALTER TABLE orders ADD COLUMN IF NOT EXISTS triggered BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS trail_ref NUMERIC(20,8);
CREATE INDEX IF NOT EXISTS orders_active_idx ON orders (account_id, symbol) WHERE status = 'working';

-- ───────────── Positions (nettes ; quantité négative = short) ─────────────
CREATE TABLE IF NOT EXISTS positions (
  account_id   INT NOT NULL REFERENCES accounts(id),
  symbol       TEXT NOT NULL,
  asset_class  asset_class NOT NULL DEFAULT 'other',
  currency     CHAR(3) NOT NULL,                       -- devise native du titre
  quantity     NUMERIC(20,8) NOT NULL,
  avg_price    NUMERIC(20,8) NOT NULL,                 -- en devise native
  avg_fx_rate  NUMERIC(20,10) NOT NULL DEFAULT 1,      -- native -> devise du compte à l'ouverture
  opened_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (account_id, symbol)
);

-- ───────────── Transactions (fills) : source de vérité du P&L réalisé ─────────────
CREATE TABLE IF NOT EXISTS transactions (
  id            BIGSERIAL PRIMARY KEY,
  account_id    INT NOT NULL REFERENCES accounts(id),
  order_id      BIGINT,
  symbol        TEXT NOT NULL,
  side          order_side NOT NULL,
  quantity      NUMERIC(20,8) NOT NULL,
  price         NUMERIC(20,8) NOT NULL,                -- devise native, spread inclus
  currency      CHAR(3) NOT NULL,
  fx_rate       NUMERIC(20,10) NOT NULL DEFAULT 1,
  fees          NUMERIC(20,8) NOT NULL DEFAULT 0,      -- devise du compte
  realized_pnl  NUMERIC(20,8) NOT NULL DEFAULT 0,      -- devise du compte, net des frais
  executed_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  FOREIGN KEY (account_id, order_id) REFERENCES orders(account_id, id)
);
-- Ajout module 5 : vrai si le fill réduit/ferme une position (sert aux statistiques de trades)
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS is_close BOOLEAN NOT NULL DEFAULT false;
CREATE INDEX IF NOT EXISTS tx_account_time_idx ON transactions (account_id, executed_at DESC);

-- ───────────── Snapshots quotidiens (calendrier P&L) ─────────────
CREATE TABLE IF NOT EXISTS daily_snapshots (
  account_id        INT NOT NULL REFERENCES accounts(id),
  snap_date         DATE NOT NULL,
  equity            NUMERIC(20,8) NOT NULL,            -- cash + valeur des positions
  cash              NUMERIC(20,8) NOT NULL,
  invested          NUMERIC(20,8) NOT NULL,
  realized_pnl_cum  NUMERIC(20,8) NOT NULL DEFAULT 0,
  PRIMARY KEY (account_id, snap_date)
);

-- Points intraday pour la courbe 1J / 1S (échantillonnés toutes les 5 min)
CREATE TABLE IF NOT EXISTS equity_samples (
  account_id INT NOT NULL REFERENCES accounts(id),
  ts         TIMESTAMPTZ NOT NULL,
  equity     NUMERIC(20,8) NOT NULL,
  PRIMARY KEY (account_id, ts)
);

-- ───────────── Watchlists, dessins (partagés entre comptes) ─────────────
CREATE TABLE IF NOT EXISTS watchlists (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  position INT NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS watchlist_items (
  watchlist_id INT NOT NULL REFERENCES watchlists(id) ON DELETE CASCADE,
  symbol TEXT NOT NULL,
  position INT NOT NULL DEFAULT 0,
  PRIMARY KEY (watchlist_id, symbol)
);

CREATE TABLE IF NOT EXISTS drawings (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  symbol     TEXT NOT NULL,
  tool       TEXT NOT NULL,                            -- trendline, fib_retracement, long_position...
  anchors    JSONB NOT NULL,                           -- [{time, price}, ...]
  style      JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS drawings_symbol_idx ON drawings (symbol);

-- Réglages UI (layout, indicateurs actifs et leurs paramètres)
CREATE TABLE IF NOT EXISTS user_settings (
  key TEXT PRIMARY KEY,
  value JSONB NOT NULL
);
