# Paper Trading — Architecture

## 1. Vue d'ensemble

```
┌────────────── Navigateur (React + Vite + TS + Tailwind) ──────────────┐
│ Lightweight Charts + couche de dessin (canvas/primitives)             │
│ Zustand (état UI, compte actif)  ·  TanStack Query (REST)            │
│ 1 seule connexion WebSocket  →  subscribe/unsubscribe de symboles    │
└───────────────┬───────────────────────────────┬──────────────────────┘
          REST /api (JSON)                WS /ws (ticks, ordres, positions)
┌───────────────▼───────────────────────────────▼──────────────────────┐
│                     Backend Node.js (Fastify + ws)                   │
│                                                                      │
│  market/   QuoteHub ◄── YahooStreamer (WS protobuf)  [primaire]      │
│              │      ◄── PollingFallback (1–2 s, batch)  [repli]      │
│              │      cache LRU (quotes, historique, recherche)        │
│              ├──► WS gateway → clients abonnés                       │
│              └──► OrderEngine.onTick(symbol, price)                  │
│  trading/  OrderEngine · FillService · FxService · RiskChecks        │
│  portfolio/ PositionService · PnL · Stats · Equity curve             │
│  jobs/     SnapshotJob (clôture) · EquitySampler (5 min) · Reconnect │
│  api/      routes REST, validation (zod), erreurs typées             │
└───────────────────────────────┬──────────────────────────────────────┘
                                │ SQL (pg, requêtes paramétrées)
                        ┌───────▼────────┐
                        │  PostgreSQL 16 │
                        └────────────────┘
```

Un seul conteneur backend, un seul processus : le `QuoteHub` est la source
unique des prix pour les clients WS **et** pour le moteur d'ordres. Le
navigateur fermé n'a aucun effet sur l'exécution des ordres.

## 2. Structure des dossiers

```
paper-trading/
├─ docker-compose.yml  ·  .env.example  ·  README.md
├─ db/schema.sql                    # schéma + migrations init
├─ backend/
│  └─ src/
│     ├─ index.ts · config.ts · db.ts
│     ├─ market/   yahooClient.ts  streamer.ts  polling.ts  quoteHub.ts
│     │            history.ts  marketStatus.ts  search.ts  cache.ts
│     ├─ trading/  orderEngine.ts  fills.ts  fx.ts  validation.ts
│     ├─ portfolio/ positions.ts  pnl.ts  stats.ts  equity.ts  calendar.ts
│     ├─ jobs/     dailySnapshot.ts  equitySampler.ts
│     ├─ ws/       gateway.ts  protocol.ts
│     ├─ api/      accounts.ts  orders.ts  portfolio.ts  calendar.ts
│     │            market.ts  watchlists.ts  drawings.ts  errors.ts
│     └─ repo/     *.ts            # TOUT accepte accountId en 1er paramètre
├─ frontend/
│  └─ src/
│     ├─ app/ (layout, routes, thème)  ·  store/  ·  api/  ·  ws/
│     ├─ chart/  ChartPane.tsx  seriesTypes.ts  heikinAshi.ts  layouts.ts
│     │          drawings/ (tools, hitTest, serialize)  indicators/ (calc + UI)
│     ├─ panels/ Watchlist  OrderBook  OrderTicket  Positions  Orders
│     ├─ portfolio/ Overview  EquityCurve  AllocationPie  Trades  Stats
│     └─ calendar/ MonthView  YearView  DayDetail
└─ shared/ types.ts                 # types partagés front/back (DTO, enums)
```

## 3. Données de marché (< 2 s)

| Besoin | Mécanisme |
|---|---|
| Temps réel | `streamer.finance.yahoo.com` (WS, messages protobuf base64). Un seul socket côté serveur, souscription à l'union des symboles demandés par les clients + symboles ayant des ordres en attente/positions ouvertes. |
| Repli | Si pas de tick depuis 5 s ou socket fermé : polling `yahooFinance.quote([...])` en batch toutes les 1–2 s ; reconnexion du streamer avec backoff exponentiel, retour automatique au flux. |
| Cache | Quotes : TTL 1 s. Historique : TTL selon unité (1m→30 s, 1J→1 h). Recherche : 10 min. Requêtes identiques concurrentes dédupliquées (single-flight). |
| Indicateur | `Live` = tick < 5 s et marché ouvert · `Différé` = `exchangeDataDelayedBy > 0` ou flux en repli · `Fermé` = `marketState != REGULAR`. Horodatage = `regularMarketTime`. |
| Historique | `chart()` de yahoo-finance2 : 1m, 5m, 15m, 1h natifs ; **4h agrégé côté serveur depuis 1h** ; 1J/1S/1M natifs. Limites Yahoo (1m ≈ 7 j, 5/15m ≈ 60 j, 1h ≈ 730 j) à afficher dans l'UI. |
| Fan-out | Le hub pousse `{s, p, t, v, chg%}` ; throttle par symbole à 250 ms max pour ne pas saturer le navigateur. |

**Risque à connaître** : Yahoo n'a pas d'API officielle ; le flux streamer et
`yahoo-finance2` peuvent changer sans préavis, et leurs CGU limitent l'usage.
Acceptable pour un usage personnel de paper trading ; l'abstraction
`MarketDataProvider` permettra de brancher un autre fournisseur plus tard.

## 4. Moteur d'ordres

- Appelé à **chaque tick** par le QuoteHub (index en mémoire `symbol → ordres actifs`, rechargé au démarrage depuis la DB).
- Règles de déclenchement : Limit achat ≤ prix / vente ≥ prix ; Stop inverse ; Stop-Limit = stop puis limit ; Take-Profit / Stop-Loss = enfants OCO (annulation du frère à l'exécution) ; Trailing : le moteur recalcule le stop à chaque nouveau plus haut/bas.
- Exécution : une **transaction SQL** par fill, avec `SELECT … FOR UPDATE` sur le compte → mise à jour cash + position + transaction + statut ordre, de façon atomique et idempotente.
- Prix de fill = dernier prix ± spread paramétré ; frais = fixe + % (par compte).
- Short : quantité de position négative ; marge simple (refus si cash+equity insuffisants).
- Fractions : `NUMERIC(20,8)` partout ; pas de `float` pour l'argent côté serveur (decimal.js).
- Marché fermé : ordres Market refusés (erreur typée) sauf crypto/forex 24 h ; Limit/Stop acceptés et mis en attente.
- Devises : `FxService` utilise `EURUSD=X`, `USDCHF=X`, etc. Chaque transaction stocke `fx_rate` et la devise native pour garder un P&L reproductible.

## 5. Isolation stricte des comptes

1. **Aucune requête sans `account_id`** : couche `repo/` dont chaque fonction prend `accountId` ; pas de SQL ailleurs.
2. Le compte actif est porté par l'URL (`/api/accounts/:accountId/...`) et validé par un hook Fastify ; le WS authentifie le compte à l'abonnement.
3. **Au niveau DB** : clés étrangères composites `(account_id, order_id)` → impossible de rattacher une transaction du compte A à un ordre du compte B.
4. Tests automatisés : créer des données dans « Test », vérifier qu'aucune route « Principal » ne les renvoie.
5. Reset = transaction qui purge toutes les tables du compte concerné et recrée le solde initial (une ligne `account_resets` trace l'opération).

## 6. P&L, snapshots, calendrier

- `daily_snapshots(account_id, snap_date, equity, cash, invested, realized_pnl_cum)` écrit par un job (node-cron) à la clôture : 22:05 Europe/Zurich pour couvrir US + EU (configurable). Les marchés crypto/forex continuent : le P&L du jour = `equity(J) − equity(J−1)`.
- Première journée : base = capital initial. Les jours sans snapshot restent gris. Un reset repart d'un nouveau snapshot de base.
- `equity_samples` (toutes les 5 min, purge/agrégation > 90 j) alimente la courbe 1J/1S.
- Calendrier : mois = jointure snapshots (pour $ et %) ; clic sur un jour = transactions du jour filtrées par `account_id` ; vue annuelle = agrégat par mois.

## 7. Dessins & graphiques

Lightweight Charts n'a pas d'outils de dessin natifs : chaque outil est une **Series Primitive** (API officielle) qui rend sur le canvas du graphique avec des ancres `(time, price)`. Cela garantit zoom/défilement synchronisés. Sérialisation JSON `{tool, anchors[], style}` stockée par `(symbol)` dans `drawings`. Indicateurs calculés côté client (fonctions pures testables) ; panneaux séparés pour RSI/MACD/etc. Multi-graphiques : N instances + `subscribeCrosshairMove` pour la synchronisation.

## 8. Choix à valider

| Sujet | Proposition | Alternative |
|---|---|---|
| BDD | PostgreSQL (docker-compose) | SQLite si vous voulez 2 conteneurs |
| Backend | Fastify + `ws` | Express |
| Dessins / watchlists | Partagés entre comptes (pas du trading) | Séparés par compte |
| Heure de clôture snapshot | 22:05 Europe/Zurich | Une clôture par marché |
| Marge short | Simple (cash + equity) | Marge réelle par classe d'actif |

## 9. Déploiement en ligne sur Render

**Topologie** : un seul *Web Service* Docker (le backend sert aussi le frontend
compilé via `@fastify/static`, donc une seule URL, pas de CORS) + une base
*Render Postgres*. Le tout décrit dans un `render.yaml` (Blueprint) : « New →
Blueprint » sur le dépôt GitHub suffit. Le `docker-compose.yml` reste pour le
dev local / Synology.

Points d'attention spécifiques à Render :

| Sujet | Décision |
|---|---|
| **Plan du service** | Il faut un plan **payant (Starter, ~7 $/mois)**. Le plan gratuit s'endort après 15 min d'inactivité : le moteur d'ordres et le streamer s'arrêteraient, donc plus d'exécution navigateur fermé ni de snapshots. |
| **Postgres** | Le Postgres gratuit de Render expire au bout de 30 jours ; prévoir le plan Basic payant pour garder l'historique. |
| **Sécurité** | L'app étant publique, **authentification obligatoire** : un login (mot de passe défini par `APP_PASSWORD` + cookie JWT httpOnly), WS authentifié par le même cookie, rate limiting. Sans cela, n'importe qui pourrait passer des ordres sur vos comptes. |
| **WebSocket** | Supporté nativement par Render sur le Web Service (même port, chemin `/ws`). |
| **Port / santé** | Écoute `process.env.PORT`, endpoint `/healthz` pour le health check. |
| **Migrations** | Exécutées au démarrage (`db/schema.sql` idempotent) — pas de shell nécessaire. |
| **Fuseau / cron** | Le cron tourne dans le processus (node-cron, TZ `Europe/Zurich`) ; un seul instance (pas de scaling horizontal, sinon double exécution d'ordres). |
| **Yahoo** | ⚠️ Yahoo bloque parfois les IP de datacenters (erreurs 429/403). À tester dès le module 2 ; le repli polling + cache + l'abstraction `MarketDataProvider` limitent le risque. |
| **Variables** | `DATABASE_URL` (injectée par Render), `APP_PASSWORD`, `JWT_SECRET` (générée), `SNAPSHOT_CRON`, `TZ`. |

## 10. Feuille de route (modules)

1. **Squelette** : docker-compose, Fastify, DB + migrations, Vite/Tailwind thème sombre, types partagés
2. **Marché** : recherche, historique, QuoteHub (streamer + repli), WS, indicateur Live/Différé/Fermé
3. **Graphique** : séries, timeframes, Heikin-Ashi, watchlist avec sparklines
4. **Trading** : comptes, ordres, moteur, FX, panneau d'ordres, ordres depuis le graphique
5. **Portfolio** : positions live, courbe, camembert, historique CSV, statistiques
6. **Calendrier** : job de snapshot, vues mois/année, détail du jour
7. **Indicateurs**
8. **Outils de dessin** + sauvegarde
9. **Multi-graphiques**, raccourcis, responsive
10. **Auth + déploiement Render** (`render.yaml`, Dockerfile unique), **README Render + Synology**, tests d'isolation, durcissement


## 11. Écarts par rapport au plan initial (état final)

| Sujet | Plan | Réalisé |
|---|---|---|
| Accès aux données | dossier `repo/` ; toute fonction prend `accountId` | SQL dans les modules `trading/`, `portfolio/` et `routes/` ; **chaque requête sur une table de compte filtre `account_id`**, et un test automatique (`isolation.test.js`) parcourt le code source pour le garantir |
| Montants | `decimal.js` | nombres flottants, arrondis à 8 décimales à l'écriture (`NUMERIC(20,8)` en base) |
| Tâche de clôture | `node-cron` | planificateur interne (`SNAPSHOT_TIME` / `SNAPSHOT_TZ`) + mise à jour du snapshot du jour toutes les 5 min, donc robuste à un redémarrage |
| Courbe de valeur | snapshots uniquement | échantillons toutes les 5 min (`equity_samples`, gardés 90 jours) + snapshots quotidiens + valeur live |
| Outils de dessin | Series Primitives de Lightweight Charts | couche SVG posée sur le graphique, calée sur ses échelles (plus simple à tester et à rendre interactive) |
| Panneaux d'indicateurs | — | un graphique par panneau, synchronisé (zoom + réticule) avec le principal |
| Indicateurs, mise en page | base de données | `localStorage` du navigateur (par navigateur, pas par compte) |
| Watchlists | plusieurs, personnalisables | une watchlist éditable (l'API et le schéma supportent plusieurs listes) |
| Carnet d'ordres | carnet simplifié | meilleur acheteur / vendeur indicatifs de Yahoo + vos ordres en attente (pas de profondeur réelle) |
| Authentification | non prévue au départ | mot de passe unique, sessions signées, anti-force-brute, anti-CSRF (ajoutée pour l'hébergement public sur Render) |
| Tests | — | 9 suites automatiques, dont isolation des comptes et serveur réel de bout en bout |

Ce qui n'est **pas** vérifié automatiquement : le rendu et les interactions à la souris du frontend (build Vite non exécutable dans l'environnement de développement) et le build de l'image Docker.