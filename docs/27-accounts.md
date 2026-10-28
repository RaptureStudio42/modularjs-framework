# 27 · Comptes & identités — comptes persistés, prêts à l'emploi (au-dessus de MJS-WS)

> **Module optionnel.** Le paquet Comptes gère création de compte, connexion et identité **stable** — par-dessus [23 · MJS-WS](23-mjs-ws.md), sans le modifier, via le mécanisme des paquets activables (`app.use`). Tant que vous n'appelez pas `app.use(accountsPackage(...))`, son coût est **nul**.

```ts
// serveur — TypeScript classique (accountsPackage est une simple composition app.use(), comme
// chatPackage — pas de dialecte Civet dédié ici)
import { mjsWs, accountsPackage, accountsAuth } from 'modularjs-framework/ws'

const SECRET = process.env.MJS_COMPTES_SECRET!
const app = mjsWs({ auth: accountsAuth(SECRET) })   // PAS jwtAuth(SECRET) nu — cf. §5
app.use(accountsPackage({ secret: SECRET }))
await app.listen()
```

Côté client, `sock.account` suffit — création, connexion, élévation de la session et persistance locale du jeton sont **déjà gérées** :

```civet
account = sock.account

creer = ->
  try
    await account.create($name, $secret)
  catch
    // account.error reflète déjà le refus — rien de plus à faire ici
```
```html
{if account.loggedIn}
  <p>Bonjour {account.name}</p>
  <button @click={account.logout()}>Se déconnecter</button>
{else}
  <input value=!{$name} placeholder="pseudo">
  <input value=!{$secret} type="password">
  <button @click={creer()}>Créer un compte</button>
  {if account.error}<p class="erreur">{account.error}</p>{end}
{end}
```

---

## Sommaire

1. [Philosophie](#philosophie)
2. [Démarrer](#demarrer)
3. [Options — `accountsPackage(opts)`](#options)
4. [Le client — `sock.account`](#le-client)
5. [Élévation invité→compte — par **reconnexion**](#elevation)
6. [Sécurité](#securite)
7. [Rôles — `opts.roles` + `hasRole`](#roles)
8. [Limites v1 — honnêtement](#limites)
9. [Annexe — erreurs `compte-*` et protocole](#annexe)

---

<a id="philosophie"></a>
## 1. Philosophie

Une appli MJS-WS a tôt ou tard besoin d'une identité qui survit à une reconnexion, à un changement d'appareil — un **compte**. Le paquet Comptes la fournit **une fois**, avec le minimum honnête pour une v1 : pseudo + secret, hachage scrypt, anti-force-brute, jetons JWT qui réutilisent [23 · MJS-WS §7](23-mjs-ws.md#76-jetons--signervérifier-sans-dépendance-modularjs-frameworkws) (`token.ts`) — sans base de données obligatoire (adaptateur mémoire par défaut, adaptateur fichier réel fourni, n'importe quel autre au choix de l'appli). Une appli MJS **autonome, sans back Rails**, peut ainsi laisser ses visiteurs créer un compte, se connecter, rester connectés — et transmettre cette identité aux **autres** paquets (chat, jeu, lobby) via `client.identity`, la **même** monnaie que tout le reste de MJS-WS.

---

<a id="demarrer"></a>
## 2. Démarrer

```ts
// comptes.server.ts
import { mjsWs, accountsPackage, accountsAuth } from 'modularjs-framework/ws'

const SECRET = process.env.MJS_COMPTES_SECRET!

const app = mjsWs({
  auth: accountsAuth(SECRET),
})

app.use(accountsPackage({ secret: SECRET }))

await app.listen()
```

```civet
// composant .mjs — dialecte Civet des composants
account = sock.account

creer = ->
  try { await account.create($name, $secret) } catch {}

connecter = ->
  try { await account.login($name, $secret) } catch {}
```
```html
{if account.loggedIn}
  <p><strong>{account.name}</strong> — rôles : {account.roles.join(', ') or 'aucun'}</p>
  <button @click={account.logout()}>Se déconnecter</button>
{else}
  <input value=!{$name} placeholder="pseudo (3-24, lettres/chiffres/_/-)">
  <input value=!{$secret} type="password" placeholder="secret (8 caractères min.)">
  <button @click={creer()}>Créer un compte</button>
  <button @click={connecter()}>Se connecter</button>
  {if account.error}<p class="erreur">{account.error}</p>{end}
{end}
```

C'est tout ce qu'il faut — création, connexion, élévation de la session en cours, persistance locale du jeton et reconnexion automatique au retour sont **déjà gérées**. Le protocole `account:*` qui transporte tout ça reste **invisible** (cf. [§9](#annexe) pour l'inventaire bas niveau).

> ⚠️ **`auth: accountsAuth(SECRET)`, jamais `auth: jwtAuth(SECRET)` nu.** Cf. [§5](#elevation) — `jwtAuth` seul refuserait la connexion **anonyme** elle-même (aucun jeton au premier hello), avant même de pouvoir appeler `account:create`.

---

<a id="options"></a>
## 3. Options — `accountsPackage(opts)`

| Clé | Défaut | Effet |
|---|---|---|
| `secret` | — **requise** | Secret HMAC des jetons de compte (`signToken`/`token.ts`). **Doit** être le **même** secret que celui donné à `accountsAuth(secret)`/`mjsWs({ auth })` — cf. [§5](#elevation). Absente/vide → `throw` immédiat à la construction, jamais un démarrage à moitié fait. |
| `persist` | adaptateur **mémoire** | Stockage des comptes — cf. [§6](#securite) pour le contrat, [§8](#limites) pour l'avertissement au boot. `FileAccountsPersistAdapter` fourni pour un stockage disque réel ; n'importe quel adaptateur maison satisfaisant `{ load, save, remove, flush? }` convient. Un compte relu dont le nom sort du format des pseudos (base reprise d'un autre système : point, accent, plus de 24 caractères) se connecte comme les autres ; seul `account:create` impose le format. |
| `ttl` | `604800` (7 jours) | Durée de vie du jeton émis, en **secondes**. |
| `audience` | absent | Le site pour lequel les jetons émis sont faits, posé dans leur `aud` : une chaîne, ou une liste (le jeton porte alors la liste). À donner **aussi** à `accountsAuth` — cf. [§6](#securite) « Un jeton fait pour un autre site ». Absent : jetons sans `aud`. |
| `issuer` | absent | L'émetteur des jetons émis, posé dans leur `iss` : une chaîne, ou une liste (le jeton porte sa première valeur, un `iss` est une seule chaîne). À donner **aussi** à `accountsAuth`. Absent : jetons sans `iss`. |
| `roles` | absent | `(account) => string[] \| Promise<string[]>` — enrichit/recalcule les rôles portés par le jeton à **chaque** émission (`account:create` ET `account:login`), à partir de l'enregistrement **persisté** (`meta` inclus). Absent = `account.roles` tel que persisté. |
| `bruteForce` | `{ capacity: 5, windowMs: 60000 }` | Anti-force-brute (`account:login` seulement, cf. [§6](#securite)) — budget d'échecs **par adresse** (`capacity` ; une adresse IPv6 compte pour tout son préfixe /56) et **par nom de compte**, toutes adresses confondues (`capacity` aussi) : au-delà, une adresse qui a déjà raté ce compte est arrêtée, une adresse neuve a encore un essai (une IPv6 : un par /48) ; **dix fois** `capacity` par nom de compte le ferment à tous. |
| `createPerIp` | `{ capacity: 3, windowMs: 60000 }` | Anti-DoS création (`account:create` seulement, **par** IP, cf. [§6](#securite)) — `account:create` est accessible en hello **anonyme** et déclenche le même scrypt coûteux que `account:login`, sans limite jusque-là. |
| `nameCheckPerIp` | `{ capacity: 10, windowMs: 60000 }` | Anti-énumération (`account:create` seulement, **par** IP, cf. [§6](#securite)) — chaque demande qui arrive au contrôle d'unicité du pseudo en consomme un, pseudo pris ou libre ; au-delà, `account-throttled` **avant** toute réponse `account-name-taken`. |
| `maxAccounts` | absent (illimité) | Plafond **optionnel** du nombre total de comptes — au-delà, `account:create` refuse avec `account-limit-reached`. |
| `weakHashForTests` | absent (coût de production) | **Pour les tests seulement.** `true` hache les secrets à un coût réduit (scrypt N = 2^10, r = 8, p = 1, environ cent fois moins de calcul), pour qu'une suite de tests qui crée des comptes en rafale tienne sur une machine chargée. Ne l'activez jamais en production : un tel hachage se casse d'autant plus vite. Sous l'option, un compte déjà enregistré se vérifie tel quel et son hachage n'est jamais refait plus faible ; toute autre valeur que `true` laisse le coût de production. Un avertissement le rappelle au démarrage, une fois par paquet créé avec l'option, par `onLog` (la console sans lui). |
| `onLog` | console, préfixe `[mjs-ws:accounts]` | Callback de log — utilisé pour l'avertissement « adaptateur mémoire » (§8) et les échecs de `persist.load()`/adaptateur fichier. |

Une clé inconnue fait lever `accountsPackage` dès sa construction, avec la plus proche en suggestion et la liste des options valides : `accountsPackage({ secret, audiance: 'boutique' })` s'arrête sur « option 'audiance' inconnue — vouliez-vous dire 'audience' ? ».

---

<a id="le-client"></a>
## 4. Le client — `sock.account`

Posé par-dessus `µ.socket` (module runtime `comptes`, cf. [§8](#limites) pour la sélection du runtime) — **propriété**, pas un appel : une seule identité de compte par connexion, contrairement à `sock.chat(nom)`/`sock.game()`.

```civet
account = sock.account   # store réactif plat, SINGLETON par socket
```

| Clé | Type | Sens |
|---|---|---|
| `loggedIn` | booléen | `true` une fois l'élévation réussie (cf. [§5](#elevation)). |
| `name` | chaîne \| `null` | Décodé du jeton — `null` tant qu'aucune élévation n'a réussi. |
| `roles` | tableau de chaînes | Décodé du jeton — cf. `opts.roles` ([§3](#options)) et `hasRole` ([§7](#roles)). |
| `token` | chaîne \| `null` | Le jeton **courant**, en lecture — intégration back maison (ex. l'attacher à un appel `fetch()` applicatif). |
| `error` | chaîne \| `null` | Dernier refus — un code `compte-*` (cf. [§9](#annexe)) OU un refus d'élévation, **toujours** normalisé en chaîne affichable. |
| `create(pseudo, secret)` | fonction → Promise | Crée un compte + élève la session en cours (cf. [§5](#elevation)). |
| `login(pseudo, secret)` | fonction → Promise | Connecte un compte existant + élève la session en cours. |
| `logout()` | fonction → Promise | Ferme la session compte (cf. [§5](#elevation)) et purge le jeton local. |

### Persistance locale du jeton

`localStorage`, clé configurable (`µ.socket(url, { account: { key: 'my-token' } })`, défaut `'mjs-token'`), accès **toujours** gardé (`typeof localStorage !== 'undefined'` — absent en SSR/certains environnements de test, jamais un crash). Au premier accès à `sock.account` — avant même un `sock.connect()` explicite de l'appli — un jeton stocké déclenche **immédiatement** l'élévation : **reconnexion connectée d'office**, sans jamais rappeler `login()`. Un jeton mort (expiré, invalide, révoqué) est purgé automatiquement — jamais de nouvelle tentative sur un jeton qui ne marchera plus — et la connexion repart en invité (`account.error` dit le refus) : le temps réel de la page ne s'éteint pas avec le jeton. Ce que la page a demandé pendant l'essai du jeton ne part pas sous l'identité invitée, et rien ne se perd sans un mot : une requête qui attendait l'ouverture est rejetée avec `code: 'denied'` et la raison du refus (relancez-la en invité si elle a un sens pour lui), un message mis en file hors-ligne ou un envoi différé (`debounce`, `coalesce`) encore en attente n'est pas envoyé, et un avertissement dans la console le dit ; une création ou une connexion de compte (`create()`, `login()`) lancée pendant ce temps part sur la connexion invitée et aboutit. Seul un refus du serveur efface le jeton : un accueil plus lent que prévu (au-delà de 5 s) ne l'efface pas, `account.loggedIn` passe à `true` dès que l'accueil arrive ; et si l'appli ferme la connexion (`sock.close()`) pendant la reprise, elle reste fermée — le jeton gardé sert au `connect()` suivant.

---

<a id="elevation"></a>
## 5. Élévation invité→compte — par **reconnexion**

> Cette section documente une découverte faite EN **écrivant** ce module : l'intuition de départ — élever la session en cours via `sock.refresh(jeton)` ([23 · MJS-WS](23-mjs-ws.md)) — est en réalité **impossible**, pour une raison structurelle qui mérite d'être comprise avant de brancher ce paquet dans une appli qui ferait ses propres suppositions.

`µ:refresh`/`sock.refresh()` réinvoque la fonction `auth` de l'appli, mais **refuse tout changement d'identité** (`identityIdOf(nouvelle) !== identityIdOf(courante)` → refusé, invariant strict de `core.ts` : « une session ne change jamais d'identité en vol »). Passer d'anonyme (aucun `id`) à un compte (`id` généré à la création) **est** un tel changement — `sock.refresh(jeton)` renvoie donc **toujours** `refresh-denied` pour cet usage, quel que soit le jeton.

Un hello **frais** (une nouvelle connexion), en revanche, n'a **aucune** identité antérieure à comparer — c'est donc par là que passe l'élévation. `sock.account` orchestre ceci tout seul (`src/runtime/mjs_accounts.ts`) :

1. Le jeton reçu (`account:create`/`account:login`, ou relu du `localStorage` au boot) est posé comme `auth` du socket.
2. La connexion courante repart sur un fil neuf — **même** socket, salons/abonnements ré-abonnés automatiquement par le welcome suivant (cf. [20 · Temps réel](20-temps-reel.md)). Contrairement à `sock.close()`, rien n'est perdu : ni la file hors-ligne, ni les requêtes qui attendent l'ouverture (l'identité d'un salon de chat, l'entrée d'un hall, ouverts avant le premier accès à `sock.account`). Une requête déjà partie sur l'ancienne connexion n'y recevra pas sa réponse : elle est rejetée avec `code: 'unknown'` — le serveur a pu la servir, ne la rejouez pas sans vérifier (cf. [20 · Temps réel](20-temps-reel.md)). L'identité d'un salon de chat (`salon.me`) et celle d'un hall (`hall.me`) sont redemandées à chaque accueil : elles suivent l'élévation, même quand `sock.account` est lu pendant que leur première demande est en route.
3. Ce hello, tout neuf, porte le jeton — `client.identity` devient celle du compte.

**Conséquences pratiques :**
- Une fois élevé, `sock.opts.auth` reste posé sur ce jeton : une reconnexion **future** (coupure réseau) le réutilise automatiquement, sans repasser par ce module — et `account.state` (`loggedIn`/`token`/…) se resynchronise à **chaque** welcome authentifié avec ce jeton, même arrivé après un rejet de la promesse `creer()`/`connecter()` (filet timeout dépassé, reconnexion aboutie plus tard par le backoff normal du socket). `logout()` restaure l'`auth` d'**origine** de l'appli (celui d'avant toute élévation) — une reconnexion après déconnexion explicite ne ressuscite donc pas le compte. Un refus **explicite** de l'élévation (jeton refusé, `µ:denied`) restaure lui aussi l'`auth` d'origine — une reconnexion automatique ultérieure ne retente pas une identité déjà refusée. Ce refus peut aussi bien viser une reconnexion **automatique** survenue **après** une élévation déjà réussie (coupure réseau involontaire qui réutilise le jeton élevé, puis jeton révoqué entre-temps) : `account.state` redescend alors à l'état non connecté (`loggedIn:false`, `token:null`, `name:null`, `roles:[]`) — même remise à zéro que `logout()` — et `account.error` porte la raison du refus, comme à la reprise d'un jeton stocké au démarrage : le compte affiché ne reste jamais « connecté » avec un jeton que le serveur vient d'explicitement refuser, et l'application peut dire pourquoi. Dans tous ces cas, la connexion repart aussitôt en invité — jeton expiré page ouverte compris (le serveur coupe, la reconnexion est refusée) : le temps réel de la page ne s'éteint pas et `login()` reste possible sans recharger ; la file hors-ligne de l'identité refusée est vidée, ses envois différés encore en attente annulés et ses requêtes qui attendaient l'ouverture rejetées (`denied`) : rien de tout cela ne part sous l'identité invitée ; une création ou une connexion de compte en attente part, elle, sur la connexion invitée. Un `close()` de l'appli gagne toujours : ni l'élévation ni ce retour en invité ne rouvrent une connexion qu'elle a fermée.
- L'élévation entraîne une **vraie** reconnexion (visible réseau) — pas juste un aller-retour logique. Salons/flux sont réabonnés automatiquement, mais un état purement **local** à l'ancienne connexion (aucun ici, mais à garder en tête pour toute extension future) ne survivrait pas.
- `accountsAuth(secret)` (exportée à côté de `accountsPackage`) est le wrapper qui rend tout ça possible côté **serveur** : un hello **sans** jeton → identité anonyme **autorisée** (`undefined`, comme avant toute auth) ; un hello (ou un `µ:refresh` pour un usage qui n'est **pas** l'élévation, ex. renouveler un jeton avant expiration EN **gardant** le même `id`) **avec** jeton → délégué à `jwtAuth(secret, options)`. `accountsAuth(secret, { audience, issuer, clockTolerance })` prend les mêmes options que `jwtAuth` et les lui transmet telles quelles — cf. [§6](#securite) « Un jeton fait pour un autre site ». `jwtAuth(secret)` NU refuserait l'anonyme (renvoie `false` pour tout hello sans jeton) — d'où l'avertissement du [§2](#demarrer).

---

<a id="securite"></a>
## 6. Sécurité

**Secrets.** Hachage `scrypt` de Node (`crypto.scrypt`, zéro dépendance — cf. [23 · MJS-WS §7](23-mjs-ws.md#76-jetons--signervérifier-sans-dépendance-modularjs-frameworkws) pour `token.ts`, même ethos), sel aléatoire **par compte** (16 octets), comparaison à temps constant (`timingSafeEqual`). Le secret en clair, le sel et le hachage ne quittent **jamais** ce process — ni dans une trame réseau, ni dans un log, ni dans une erreur (vérifié par test).

**Réglages de hachage enregistrés.** Chaque hachage porte ses réglages scrypt dans le champ `hash` : `$scrypt$ln=15,r=8,p=3$…` (N = 2^15, r = 8, p = 3 — une des combinaisons conseillées par l'OWASP, 32 Mio de mémoire et environ 0,2 s de calcul par connexion). Un compte écrit par une version précédente (hachage hexadécimal nu, réglages de Node par défaut : N = 2^14, r = 8, p = 1) se connecte comme avant ; à sa première connexion réussie, son hachage est refait aux réglages actuels, sur un sel neuf, et enregistré avec la date de connexion. Personne n'a à se reconnecter ni à changer de secret. Un adaptateur de persistance maison garde le champ `hash` tel quel : il passe de 128 à 150 caractères. Les réglages lus avec un hachage sont bornés — au plus un cran au-dessus de ceux qu'écrit le framework : N ≤ 2^16, r ≤ 8, p ≤ 4, N < 2^(16·r) (exigence de scrypt), et un coût total (N·r·p) d'au plus deux connexions aux réglages actuels. Un hachage enregistré hors de ces bornes (modifié à la main, abîmé) refuse la connexion comme un mauvais secret (`account-denied`), au prix d'une connexion normale, jamais avec un message de la bibliothèque de chiffrement. Un compte écrit par un serveur d'essai monté avec `weakHashForTests: true` ([§3](#options)) porte `$scrypt$ln=10,r=8,p=1$…` : relu par un serveur de production, il se connecte, et son hachage est refait aux réglages actuels à sa première connexion réussie, comme celui d'une version précédente.

**Anti-énumération.** `account:login` renvoie le **même** message (`account-denied`) que le pseudo existe ou non. Pour qu'un pseudo **inexistant** ne réponde pas plus **vite** (ce qui révélerait son absence par le temps de réponse malgré le message identique), un hachage **factice** de coût identique est calculé même quand le pseudo n'existe pas. Un secret qui n'est pas une chaîne est refusé **tout de suite** (`account-denied`), avant même de chercher le compte : même réponse, même temps, que le pseudo existe ou non. À la création, la réponse `account-name-taken` dirait elle aussi qu'un compte existe : elle n'est donnée qu'après une limite **par** IP (cf. « Anti-DoS création » ci-dessous).

**Anti-force-brute.** Des budgets d'échecs (`account:login` uniquement), **même** patron que le limiteur du pont universel (`bridge.ts::createBridgeRateLimiter`, [23 · MJS-WS](23-mjs-ws.md)), réimplémenté ici (paquet WS pur, sans dépendre du pont HTTP) : un **par** adresse — défaut 5 échecs/minute, tous pseudos confondus ; une adresse IPv6 compte pour tout son préfixe /56, car un abonné en reçoit souvent un entier (256 préfixes /64, des milliards d'adresses qu'il pourrait faire tourner) — et un **par pseudo** (casse-insensible), toutes adresses confondues, 5 échecs/minute lui aussi. Ce budget du compte dépensé, le compte ne se ferme pas à tous : une adresse qui a déjà raté ce compte pendant la minute est arrêtée, et une adresse qui n'a encore rien raté n'a plus qu'**un** essai — une adresse IPv6 compte alors pour tout son /48, qu'un tunnel donne gratuitement : ses 256 préfixes /56 ne valent qu'un essai. Des échecs envoyés d'ailleurs ne verrouillent donc jamais le titulaire qui se connecte depuis une adresse propre, et un attaquant ne vérifie pas plus de 5 secrets par minute depuis une même adresse (ou un même /56), plus un par adresse neuve (un par /48 en IPv6) : 6 par minute au plus avec tout un /48. Seul un plafond dur par pseudo, **dix fois** plus haut (50 échecs par minute par défaut), arrête une attaque répartie sur de nombreuses sources — et, tant qu'il est atteint, le titulaire aussi ; il faut pour l'atteindre plus de 45 sources distinctes (adresses IPv4, ou /48 IPv6). Revers du regroupement : un attaquant du même /48 que le titulaire (même fournisseur, même bloc) peut lui prendre cet essai tant qu'il épuise le budget du compte. Chaque essai **réserve** sa place dans chaque budget **avant** tout calcul de hachage : des essais lancés en même temps ne passent jamais tous le contrôle avant que le premier échec ne soit compté (30 essais simultanés depuis une adresse : 5 vérifiés au plus, les autres refusés, même le bon secret). Une connexion réussie rend sa place. Au-delà du budget : `account-throttled`, sans aucun calcul de hachage. À savoir : derrière une même adresse, au plus autant de connexions **simultanées** que le budget restant (5 par défaut) sont vérifiées à la fois ; les suivantes reçoivent `account-throttled` et peuvent réessayer un instant plus tard.

**Anti-DoS création.** `account:create` est accessible en hello **anonyme** et déclenche le **même** scrypt coûteux que ci-dessus — il n'avait jusque-là **aucune** limite de débit (DoS CPU + croissance mémoire/disque non bornée depuis une seule IP). Un seau **séparé** (`opts.createPerIp`, **même** mécanisme `FailureBucket`/`TokenBucket`), clé = IP **seule** (une adresse IPv6 : son préfixe /56, comme ci-dessus ; le pseudo diffère à chaque tentative d'un attaquant qui en génère de nouveaux — une clé pseudo ne contiendrait rien) — défaut **conservateur**, 3 créations/minute/IP (plus strict que `bruteForce` : la création est une action rare, et scrypt coûte plus cher qu'une simple comparaison). Le seau est consulté **juste avant** le calcul scrypt, **après** les refus bon marché (format/unicité, sans hachage) — ceux-ci ne consomment pas le budget, seule une tentative qui atteindrait le hachage compte : exactement le chemin coûteux à protéger, sans pénaliser un client qui enchaîne des essais de format invalide. La tentative qui fait déborder le seau n'a donc payé **aucun** hachage. Clé de repli `'inconnue'` si l'IP n'est pas exposée par le transport — jamais un accès non limité. Au-delà : `account-throttled` (**même** code que l'anti-force-brute de `account:login` — un client ne distingue pas les deux causes). La réponse « pseudo déjà pris » passe, elle, par une limite **séparée** (`opts.nameCheckPerIp`, défaut 10 contrôles/minute/IP) : chaque demande qui arrive au contrôle d'unicité en consomme un, que le pseudo soit pris ou libre, **avant** toute réponse — au-delà, `account-throttled` pour tout pseudo. Une IP déjà arrêtée par le seau de création reçoit, elle aussi, `account-throttled` quel que soit le pseudo : aucune réponse ne distingue plus gratuitement un pseudo pris d'un pseudo libre.

**Persistance abîmée ou en panne.** Un enregistrement relu par `persist.load()` dont `id`, `name`, `hash` ou `salt` n'est pas une chaîne (fichier `{}`, champ renommé, édition à la main) est **écarté** avec un avertissement au journal (`onLog`) : les autres comptes restent chargés et `account:create` fonctionne. S'il porte encore un pseudo lisible, ce pseudo reste **réservé** (`account-name-taken` à la création, `account-denied` à la connexion) : un compte abîmé ne se reprend pas en recréant son nom. À la connexion, une écriture de la date de dernière connexion (`seenAt`) qui échoue (disque plein, base indisponible) ne refuse pas un bon secret : l'échec part au journal du serveur, jamais au client.

**Expiration.** Le jeton porte une échéance (`ttl`, [§3](#options)) — un jeton expiré est refusé **dès le hello** (`µ:denied`), qu'il soit utilisé pour une connexion fraîche ou pour l'élévation (qui **est** une connexion fraîche, cf. [§5](#elevation)). Un léger écart d'horloge entre serveurs se règle avec `accountsAuth(SECRET, { clockTolerance: 30 })` : une tolérance en secondes, appliquée à `exp` et à `nbf`, comme pour `jwtAuth`. Donnez alors au suivi de l'échéance au moins la même tolérance, en millisecondes (`mjsWs({ token: { slack: 30000 } })`, cf. [23 · MJS-WS §7.9](23-mjs-ws.md#79-expiration-et-rafraîchissement-du-jeton)) : sinon un jeton accepté de justesse au hello est fermé au balayage suivant.

**Un jeton fait pour un autre site.** Deux sites qui partagent le même secret acceptent, sans réglage, les comptes l'un de l'autre. Donnez le même site et le même émetteur aux **deux** réglages : `accountsPackage` les pose dans les jetons qu'il émet (`aud`, `iss`), `accountsAuth` les vérifie à chaque hello et à chaque `µ:refresh`.

```ts
import { mjsWs, accountsPackage, accountsAuth } from 'modularjs-framework/ws'

const SECRET = process.env.MJS_COMPTES_SECRET!
const SITE   = { audience: 'boutique', issuer: 'https://boutique.fr' }

const app = mjsWs({
  auth:  accountsAuth(SECRET, { ...SITE, clockTolerance: 30 }),
  token: { slack: 30000 },   // le suivi de l'échéance garde la même tolérance, en millisecondes
})

app.use(accountsPackage({ secret: SECRET, ...SITE }))

await app.listen()
```

Création, connexion, élévation et rafraîchissement marchent comme avant. Un jeton signé avec le même secret pour un autre site — celui des comptes du blog (`aud: 'blog'`), ou fabriqué ailleurs pour `'autre'` — est refusé dès le hello (`µ:denied`), comme un jeton émis par un autre émetteur ; le visiteur **sans** jeton reste accueilli en invité. `accountsAuth(secret, options)` prend les mêmes options que `jwtAuth` (`audience`, `issuer`, `clockTolerance`, cf. [23 · MJS-WS §7.6](23-mjs-ws.md#76-jetons--signervérifier-sans-dépendance-modularjs-frameworkws)). Une audience en liste part telle quelle dans le `aud` des jetons ; un émetteur en liste part par sa première valeur. Une valeur invalide (chaîne vide, liste vide, autre type) fait lever `accountsPackage` et `accountsAuth` dès le démarrage, avec le même message que `jwtAuth` ; une clé inconnue d'`accountsPackage` ou d'`accountsAuth` aussi, avec la plus proche en suggestion (`audiance` → `audience`).

**Activer `audience` ou `issuer` sur un site déjà en service.** Les jetons déjà émis ne portent ni `aud` ni `iss` : dès que `accountsAuth` vérifie l'un ou l'autre, il les refuse tous. Au redémarrage, chaque visiteur connecté, comme chaque visiteur qui revient plus tard avec un jeton gardé, repasse donc en invité — son jeton est refusé puis effacé, cf. [§4](#le-client) — jusqu'à sa prochaine connexion à son compte. Un jeton n'est émis qu'à la création du compte et à la connexion (`account:create`, `account:login`) : un visiteur qui revient sans repasser par `login()` garde le sien jusqu'à son échéance. Pour passer sans coupure, procédez en deux temps : donnez d'abord `audience` (et `issuer`) au seul `accountsPackage` — ses jetons portent dès lors `aud` (et `iss`), et `accountsAuth` sans option les accepte comme les anciens ; puis, une fois écoulée depuis ce premier temps la durée de vie des jetons (`ttl`, 7 jours par défaut), donnez les mêmes valeurs à `accountsAuth`.

**Unicité du pseudo.** Comparaison **toujours** en minuscules — `Zora`/`zora`/`ZORA` sont le **même** compte. La casse **d'origine** est conservée pour l'affichage (le jeton porte le pseudo tel que créé, pas tel que tapé pour se connecter).

---

<a id="roles"></a>
## 7. Rôles — `opts.roles` + `hasRole`

```ts
app.use(accountsPackage({
  secret: SECRET,
  roles: (account) => account.meta.moderator ? ['moderator'] : [],
}))
```

`hasRole(identity, role)` (exportée à côté de `accountsPackage`) lit `identity.roles` (le duck-type posé par le jeton) — utilisable par les hooks des **autres** paquets, par exemple pour brancher la modération du chat sur les rôles du compte :

```ts
import { accountsPackage, hasRole } from 'modularjs-framework/ws'
import { chatPackage } from 'modularjs-framework/ws'

app.use(accountsPackage({ secret: SECRET, roles: (c) => c.meta.moderator ? ['moderator'] : [] }))
app.use(chatPackage({ moderators: (identity) => hasRole(identity, 'moderator') }))
```

`opts.roles` est réévalué à **chaque** émission de jeton (`create`/`login`), à partir de l'enregistrement **persisté** — un changement de rôle (ex. `account.meta.moderator` basculé par un outil admin séparé) n'est donc visible qu'à la **prochaine** émission d'un jeton pour ce compte (prochaine connexion), jamais poussé en live à une session déjà élevée — cf. [§8](#limites).

---

<a id="limites"></a>
## 8. Limites v1 — honnêtement

- **Pas de courriel, pas de récupération de secret oublié, pas de 2FA.** Assumé pour v1 — un secret oublié = un compte perdu, aucun mécanisme de contournement n'existe.
- **Aucune révocation de jeton.** Les jetons sont des JWT **sans état** (cf. `token.ts`) — il n'existe pas de liste de comptes/jetons révoqués. `account:logout` ferme la connexion authentifiée **courante** (l'identité élevée ne survit pas à la fermeture) et le client purge son jeton local, mais une **autre** copie du même jeton — un autre onglet, un autre appareil — reste valide jusqu'à sa propre expiration naturelle.
- **Pour quel site, seulement si vous le dites.** Sans `audience` ni `issuer`, les jetons émis ne disent ni pour quel site ils sont faits, ni qui les a émis : deux sites qui partagent le même secret acceptent alors les comptes l'un de l'autre. Donnez `audience` (et `issuer`) à `accountsPackage` **et** à `accountsAuth`, ou un secret propre à chaque site — cf. [§6](#securite) « Un jeton fait pour un autre site ». Sur un site déjà en service, procédez en deux temps, sinon chaque visiteur connecté revient en invité — cf. [§6](#securite) « Activer `audience` ou `issuer` sur un site déjà en service ».
- **Anti-force-brute/anti-DoS en mémoire process, non répliqué.** Comme la modération du chat ([26 · Chat §7](26-chat.md#limites)) — sur un déploiement multi-processus, les seaux (échecs ET création) ne sont pas partagés entre processus ; un attaquant distribué sur plusieurs processus (répartition de charge) reste sous le radar de **chaque** seau individuellement.
- **Pas de suppression de compte au protocole.** `MjsWsAccountsPersistAdapter.remove()` existe (symétrie du contrat, outillage admin direct sur l'adaptateur) mais aucune trame `compte:*` ne l'appelle en v1.
- **Rôles recalculés à l'émission, jamais poussés en live.** Cf. [§7](#roles) — un changement de rôle n'est visible qu'à la prochaine connexion/reconnexion de ce compte.
- **L'élévation est une vraie reconnexion.** Cf. [§5](#elevation) — visible réseau, pas un simple aller-retour logique ; salons/flux sont réabonnés automatiquement, mais l'opération a un coût (un hello complet) plus élevé qu'un `sock.refresh()` simple.
- **Pas de page de démonstration dédiée** sur le site vitrine — laissé à une itération ultérieure.
- **Dans une liste `runtime`, `sock.account` exige son module.** Sans clé `runtime`, il est repéré dans le code (`sock.account`) et joint avec `socket`. Dans une liste, comme `sock.chat`/`sock.game`, il exige le module runtime `comptes` (cf. [§9](#annexe)) — absent de la liste, `sock.account` reste indéfini (avertissement du bundler à la construction, jamais un crash silencieux).

---

<a id="annexe"></a>
## 8bis. Migrer un dossier de comptes écrit par l'ancienne version

Le paquet s'appelait `comptes` et ses champs stockés portaient des noms français. Quatre clés de
l'enregistrement persisté ont changé — `id`, `hash`, `roles` et `meta`, eux, sont **inchangés** :
les secrets restent vérifiables tels quels, **personne n'a à se reconnecter**.

| Avant | Maintenant |
|---|---|
| `pseudo` | `name` |
| `sel` | `salt` |
| `cree` | `createdAt` |
| `vu` | `seenAt` |

Un script fait la traduction sur place, un fichier à la fois :

```bash
node scripts/migrate-accounts-fr-to-en.mjs ./data/comptes --dry-run   # montre, n'écrit rien
node scripts/migrate-accounts-fr-to-en.mjs ./data/comptes             # migre
```

Il est **idempotent** (un enregistrement déjà migré est laissé tel quel) et écrit **atomiquement**
(fichier temporaire + `rename`, même geste que l'adaptateur lui-même) — une coupure en cours de
route ne laisse jamais un compte à moitié écrit. Un adaptateur de persistance maison (base de
données) applique la même correspondance à sa façon.

---

## 9. Annexe — erreurs `account-*` et protocole

### Erreurs

| Code (`µ:error`/rejet de Promise) | Déclencheur |
|---|---|
| `account-name-invalid` | Pseudo absent/non-chaîne, ou hors du format `[a-z0-9_-]{3,24}` (insensible à la casse). |
| `account-secret-short` | Secret absent/non-chaîne, ou strictement inférieur à 8 caractères. |
| `account-name-taken` | Pseudo déjà utilisé (comparaison casse-insensible), ou réservé par un enregistrement abîmé (cf. [§6](#securite)) — donné seulement après la limite de contrôles par IP (`opts.nameCheckPerIp`). |
| `account-denied` | Pseudo inexistant OU secret incorrect OU secret qui n'est pas une chaîne — message **identique** dans tous les cas (anti-énumération, cf. [§6](#securite)). |
| `account-throttled` | `account:login` : budget d'échecs de l'adresse épuisé, budget du pseudo dépensé pour une adresse qui a déjà raté ce compte, plafond du pseudo atteint, ou places déjà réservées par des essais en vol. `account:create` : limite de contrôles de pseudo ou seau anti-DoS **par** IP épuisé. **Même** code dans tous les cas — cf. [§6](#securite). |
| `account-limit-reached` | `account:create` — `opts.maxAccounts` atteint, réservations en cours comprises (deux créations concurrentes ne peuvent jamais dépasser le plafond à elles deux). |
| `account-persist-failed` | `account:create` — l'adaptateur de persistance (`persist.save()`) a levé une exception (ou rendu une promesse rejetée, cf. `FileAccountsPersistAdapter`) : sauvegarde échouée, pseudo libéré (jamais inscrit en mémoire) ; le détail traduit part au journal serveur (`onLog`) seulement, jamais au client. |
| `account-load-failed` | `account:create` — le chargement initial des comptes déjà persistés (`persist.load()`) a échoué : rien n'est créé tant qu'un chargement n'a pas réussi. Un appel ultérieur (`account:create` ou `account:login`) retente automatiquement le chargement — `account:login`, lui, ne renvoie jamais ce code : un chargement en échec y est traité comme un pseudo introuvable (`account-denied`), cf. [§6](#securite) anti-énumération. |

### Le protocole `account:*` — préfixe de convention, pas une réservation

Comme `chat:` ([26 · Chat](26-chat.md#annexe)), `account:` n'est **pas réservé** — une simple convention de nommage.

| Trame | Sens | Charge `p` |
|---|---|---|
| `account:create` | CLIENT→SERVEUR (requête, `µ:ack`) | `{ name, secret }` → `{ ok, token }` |
| `account:login` | CLIENT→SERVEUR (requête, `µ:ack`) | `{ name, secret }` → `{ ok, token }` |
| `account:logout` | CLIENT→SERVEUR (requête, `µ:ack`) | `{}` → `{ ok: true }` |

Aucune de ces trames ne modifie `client.identity` directement (impossible depuis un paquet, cf. [§5](#elevation)) — elles ne font que **minter** un jeton ; l'élévation réelle passe par la reconnexion contrôlée décrite au [§5](#elevation).

---

*Voir aussi : [20 · Temps réel](20-temps-reel.md) pour le client `µsocket` de base, [23 · MJS-WS](23-mjs-ws.md) pour le protocole `µ:` et les jetons JWT (`token.ts`), [26 · Chat](26-chat.md) pour l'autre paquet applicatif de référence (branchement `hasRole`/`chat.moderators`).*
