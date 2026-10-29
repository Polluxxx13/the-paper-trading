# Paper Trading

Application web de **trading simulé** : argent fictif, vraies cotations (Yahoo Finance), interface inspirée de TradingView.
Deux comptes totalement séparés — **Principal** (1 000 000 $) et **Test** (1 000 $) — avec graphiques, indicateurs, outils de dessin, ordres exécutés côté serveur, portfolio et calendrier des gains et pertes.

> Données de marché non officielles (Yahoo Finance) : usage personnel, sans garantie. Voir « Limites connues ».

## Ce que fait l'application

| | |
|---|---|
| **Marchés** | Actions, ETF, indices, forex, crypto, matières premières, futures. Recherche par symbole ou nom (`AAPL`, `NESN.SW`, `BTC-USD`, `EURUSD=X`, `GC=F`). Pastille **Live / Différé / Marché fermé** et heure de la dernière cotation. |
| **Temps réel** | Flux WebSocket Yahoo relayé au navigateur ; si le flux tombe, repli automatique par sondage toutes les 1,5 s (avec cache serveur). |
| **Graphiques** | Bougies, barres, ligne, aire, Heikin-Ashi ; 1m, 5m, 15m, 1h, 4h, 1J, 1S, 1M ; mises en page 1 / 2 / 4 graphiques, réticule synchronisé. |
| **Indicateurs** | SMA, EMA, WMA, VWAP, Bollinger, RSI, MACD, Stochastique, ATR, Ichimoku, Volume, OBV, ADX, Parabolic SAR, points pivots — paramètres modifiables. |
| **Dessin** | Tendance, rayon, horizontale, verticale, canal, Fibonacci (retracement + extension), rectangle, texte, flèche, règle, position longue/courte. Sauvegardés par symbole. |
| **Ordres** | Marché, limite, stop, stop-limite, take-profit / stop-loss (attachés ou sur position), trailing stop ; long et short ; fractions pour crypto et forex ; spread et frais réglables ; conversion de devises. Placement par le panneau, par clic droit sur le graphique, ou depuis une position dessinée ; TP/SL déplaçables à la souris. |
| **Exécution** | Les ordres en attente sont surveillés **par le serveur** : ils s'exécutent navigateur fermé. |
| **Portfolio** | Valeur, cash, investi, P&L latent / réalisé, positions en direct, courbe de valeur (1J → Tout), répartition, statistiques (réussite, gain/perte moyens, profit factor, drawdown), historique filtrable + export CSV. |
| **Calendrier** | Vue mensuelle (P&L du jour en $ et %, vert / rouge / gris), vue annuelle, détail des trades d'un jour, basé sur un snapshot quotidien de la valeur du compte. |
| **Isolation** | Chaque compte a ses propres soldes, positions, ordres, historique, courbe et calendrier, filtrés par `account_id` côté serveur **et** protégés par des clés étrangères composites en base. |

Raccourcis clavier : touche **`?`** dans l'application.

## Déployer sur Render

Prérequis : un compte [Render](https://render.com) et un dépôt GitHub contenant ce dossier **à la racine** (`Dockerfile`, `render.yaml`, `backend/`, `frontend/`, `db/`).

1. **Pousser le code** sur GitHub (dépôt privé conseillé).
2. Render → **New → Blueprint** → choisir le dépôt. Render lit `render.yaml` et prévoit : un *Web Service* Docker `paper-trading` et une base PostgreSQL `paper-trading-db`, dans la même région (Francfort).
3. Render demande la valeur de **`APP_PASSWORD`** : c'est le mot de passe qui protège l'application (8 caractères minimum, choisissez-le solide : l'URL est publique). `JWT_SECRET` est généré automatiquement.
4. **Apply**. Le premier build prend quelques minutes. Quand le service est *Live*, ouvrez `https://paper-trading-xxxx.onrender.com`, connectez-vous.
5. Vérifiez que tout va bien : `https://…onrender.com/healthz` doit répondre `{"ok":true}`. Dans l'application, en haut du graphique, « **Flux temps réel** » doit s'afficher (voir Dépannage si c'est « Repli : sondage »).

À savoir sur Render :

- **Plan payant obligatoire pour le service** (Starter, environ 7 $/mois). Le plan gratuit met le service en veille après 15 min : le moteur d'ordres et le snapshot quotidien s'arrêteraient. La base *free* expire après 30 jours : le plan `basic-256mb` du blueprint garde l'historique.
- **Une seule instance** (`numInstances: 1`) : ne l'augmentez jamais, chaque instance exécuterait les ordres en double.
- Le schéma de base est **appliqué automatiquement au démarrage** (`db/schema.sql`, idempotent) : aucune migration manuelle.
- Chaque `git push` redéploie (arrêt propre sur SIGTERM, puis redémarrage ; les ordres en attente sont rechargés).
- **Domaine perso** : Settings → Custom Domains. Le HTTPS est géré par Render.
- **Sauvegardes** : les plans payants de Render Postgres font des sauvegardes automatiques (onglet *Recovery* de la base). Export manuel : `pg_dump "<URL externe>" > sauvegarde.sql`.

### Variables d'environnement

| Variable | Obligatoire | Rôle |
|---|---|---|
| `DATABASE_URL` | oui | Connexion PostgreSQL (injectée par Render ; fournie par `docker-compose` ailleurs). |
| `APP_PASSWORD` | oui | Mot de passe de connexion, 8 caractères minimum. |
| `JWT_SECRET` | oui | Clé de signature des sessions, 16 caractères minimum. La changer déconnecte tout le monde. |
| `PORT` | non | Port d'écoute (Render l'injecte ; 8080 par défaut). |
| `NODE_ENV` | non | `production` dans l'image Docker : active le cookie `Secure` et HSTS. |
| `COOKIE_SECURE` | non | `false` pour servir en HTTP (NAS sans HTTPS) ; `true` derrière un proxy HTTPS. |
| `DATABASE_SSL` | non | `true` si vous utilisez l'URL **externe** de Render Postgres. |
| `SESSION_HOURS` | non | Durée d'une session (168 h par défaut). |
| `SNAPSHOT_TIME` | non | Heure de clôture quotidienne, `22:05` par défaut. |
| `SNAPSHOT_TZ` | non | Fuseau de la clôture, `Europe/Zurich` par défaut. |
| `TZ` | non | Fuseau du processus (`Europe/Zurich`). |

## Installer sur un NAS Synology (Container Manager)

Prérequis : DSM 7.2+ avec **Container Manager**, accès SSH ou File Station.

1. Copiez le dossier du projet sur le NAS, par exemple dans `/volume1/docker/paper-trading/`.
2. Dans ce dossier, créez le fichier **`.env`** à partir de `.env.example` et remplissez `DB_PASSWORD`, `APP_PASSWORD`, `JWT_SECRET` (générez le secret avec `openssl rand -hex 32`).
3. **Container Manager → Projet → Créer** : nom `paper-trading`, chemin = le dossier ci-dessus ; DSM détecte `docker-compose.yml`. Lancez : la construction de l'image prend quelques minutes.
4. L'application répond sur `http://IP-DU-NAS:8080` (modifiable avec `APP_PORT` dans `.env`). Les données de la base vivent dans le volume Docker `pgdata`.
5. **HTTPS (recommandé si accessible hors du réseau local)** : *Panneau de configuration → Portail de connexion → Avancé → Proxy inversé* : créez une règle `https://trading.votredomaine → http://localhost:8080` avec un certificat Let's Encrypt, **activez les en-têtes WebSocket** (bouton *Personnalisé → Créer → WebSocket*), puis mettez `COOKIE_SECURE=true` dans `.env` et relancez le projet. Sans HTTPS, n'exposez pas l'application sur Internet.
6. **Sauvegarde** : `docker exec <conteneur-db> pg_dump -U papertrading papertrading > sauvegarde.sql`, à planifier avec le *Planificateur de tâches* DSM ; ou sauvegardez le volume avec Hyper Backup.
7. **Mise à jour** : remplacez les fichiers du projet puis *Projet → Générer* (reconstruit l'image). Le schéma se met à jour tout seul.

## Développement local

Prérequis : Node 22+, une base PostgreSQL 16 (ou `docker compose up db`).

```bash
# Backend
cd backend && npm install
DATABASE_URL=postgres://papertrading:motdepasse@localhost:5432/papertrading \
APP_PASSWORD=dev-password JWT_SECRET=dev-secret-0123456789 npm run dev

# Frontend (autre terminal ; proxy vers le backend sur :8080)
cd frontend && npm install && npm run dev
```

### Tests

```bash
cd backend  && npm test    # compile puis lance 6 suites : moteur d'ordres, portfolio, calendrier, dessins,
                           # ISOLATION des comptes, et serveur réel de bout en bout (HTTP + WebSocket)
cd frontend && npm test    # indicateurs, géométrie des dessins, logique des ordres depuis le graphique
```

Les tests utilisent PostgreSQL embarqué (`pglite`) : aucune base à installer. Plusieurs interrogent **Yahoo Finance pour de vrai** (BTC-USD, ETH-USD…) : il faut une connexion Internet.

## Sécurité

- Application **mono-utilisateur** protégée par un mot de passe ; toutes les routes `/api` et le WebSocket exigent une session (cookie `HttpOnly`, `SameSite=Strict`, `Secure` en production, signé HMAC, expiration).
- 5 essais de connexion par minute et par IP, puis `429`. Limite globale de 600 requêtes/min/IP sur l'API.
- Requêtes qui modifient l'état et WebSocket : l'en-tête `Origin` doit correspondre à votre domaine (anti-CSRF / détournement de WebSocket).
- En-têtes : CSP stricte (scripts de votre domaine uniquement), `X-Frame-Options: DENY`, `nosniff`, HSTS, pas de cache sur `/api`.
- Requêtes SQL toutes paramétrées ; corps de requête limités à 256 Ko ; quantités et prix bornés.
- Le conteneur ne tourne pas en root ; la base de Render n'est pas exposée publiquement.
- **La déconnexion ne révoque pas le jeton côté serveur** (sessions sans état) : pour invalider toutes les sessions, changez `JWT_SECRET`.
- Pas de gestion multi-utilisateurs : qui connaît le mot de passe voit et pilote les deux comptes.

## Limites connues

- **Yahoo Finance n'a pas d'API officielle.** Le flux et la bibliothèque peuvent changer sans préavis, et ses conditions d'utilisation limitent l'usage. Prévu pour un usage personnel.
- **Cotations différées** : de nombreuses places (actions US, Suisse…) sont retardées de 15 minutes chez Yahoo ; elles s'affichent « Différé ». La latence « < 2 s » vaut pour les sources en direct (crypto, forex, certains indices).
- **Yahoo peut bloquer les adresses d'hébergeurs** (erreurs 429/403) : si le flux ne fonctionne pas sur Render, voir Dépannage.
- **Historique** : limites de Yahoo (1m ≈ 7 jours, 5/15m ≈ 60 jours, 1h ≈ 2 ans). Le 4h est reconstruit à partir du 1h.
- **Indices non négociables** (utilisez un ETF ou un future). Marge des ventes à découvert simplifiée (exposition short ≤ capital).
- **Carnet** : Yahoo ne fournit pas la profondeur du marché ; l'onglet *Carnet* montre le meilleur acheteur/vendeur indicatifs et vos ordres en attente.
- **Montants calculés en nombres à virgule flottante**, arrondis à 8 décimales à l'écriture : suffisant pour un simulateur, pas pour de la comptabilité.
- Les **indicateurs actifs et la mise en page** sont mémorisés par navigateur (pas par compte). Les dessins et la watchlist sont partagés entre les deux comptes.
- Ichimoku : sans remplissage du nuage ni projection au-delà de la dernière bougie.
- Le frontend est testé par typage et par tests des calculs ; **les interactions à la souris (dessin, glisser des lignes, réticule synchronisé) n'ont pas pu être vérifiées automatiquement**. Signalez tout défaut visuel.

## Dépannage

| Symptôme | Cause probable / remède |
|---|---|
| En haut du graphique : « **Repli : sondage 1,5 s** » en permanence | Le flux WebSocket Yahoo est bloqué ou indisponible depuis votre hébergeur. L'application reste fonctionnelle (sondage toutes les 1,5 s, un peu moins fluide). Consultez `/api/market/health` (`streamConnected`, `lastStreamMessageAgeMs`) et les logs du service. |
| Erreurs « Yahoo limite temporairement les requêtes » | Trop de requêtes ou IP bloquée : réduisez le nombre de graphiques/symboles suivis, patientez quelques minutes. |
| Les ordres ne s'exécutent plus quand je ferme le navigateur | Plan Render gratuit (service en veille) : passez au plan Starter. |
| `429` à la connexion | 5 essais ratés en moins d'une minute : attendez 60 s. |
| Page blanche / déconnexion immédiate en HTTP sur le NAS | `COOKIE_SECURE` doit valoir `false` en HTTP. |
| Le service redémarre en boucle | Variable manquante ou trop courte (`APP_PASSWORD` < 8, `JWT_SECRET` < 16) : le message est dans les logs. |
| Calendrier vide au début | Normal : un point est enregistré chaque jour ; il se remplit au fil du temps. |
| Réticule ou dessins qui « décrochent » | Signalez-le (navigateur, mise en page, unité de temps) : couche de dessin non vérifiée visuellement. |

## Structure du projet

```
Dockerfile · render.yaml · docker-compose.yml · .env.example
db/schema.sql                 schéma PostgreSQL (idempotent, appliqué au démarrage)
backend/src/
  index.ts · config.ts · auth.ts · security.ts · db.ts
  market/     Yahoo : recherche, historique, cotations, flux WebSocket, repli, cache, statut Live/Différé/Fermé
  trading/    moteur d'ordres, exécution transactionnelle, change (FX)
  portfolio/  valorisation, échantillonnage de la valeur, statistiques
  jobs/       snapshot quotidien de clôture
  routes/     API REST (comptes, trading, portfolio, calendrier, marché, watchlists, dessins)
  ws/         passerelle WebSocket (cotations, événements de trading)
backend/tests/               6 suites (dont isolation et serveur de bout en bout)
frontend/src/
  chart/      graphique, indicateurs, dessins, mises en page, ordres depuis le graphique
  trading/    panneau d'ordres, positions, carnet
  portfolio/ · calendar/ · panels/ · market/
frontend/tests/              calculs des indicateurs, géométrie des dessins, logique des ordres
```

Architecture détaillée et écarts par rapport au plan initial : [ARCHITECTURE.md](ARCHITECTURE.md).
