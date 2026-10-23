# 23 · MJS-WS — serveur compagnon (Node)

> **Module complet.** Contrat client : voir [20 · Temps réel](20-temps-reel.md) · prise en main pas à pas : leçon tuto [Le serveur officiel (mjs ws)](https://mjs.rapturestudio.fr/tuto#/serveur-mjs-ws).

`mjsWs` est le **serveur compagnon officiel** de `µsocket` : un moteur Node qui parle nativement le protocole `µ:` (handshake, ping/pong, requêtes/accusés de réception, pub/sub, salons, présence, flux à deltas numérotés, protections anti-abus…) pour que vous n'ayez plus jamais à le ré-écrire à la main derrière une `WebSocketServer` nue.

```js
import { mjsWs } from 'modularjs-framework/ws'

const app = mjsWs({
  auth:    (hello, meta) => hello.auth?.token === PROCESS_SECRET ? { id: hello.auth.userId, pseudo: hello.auth.pseudo } : false,
  welcome: (client) => ({ serverTime: Date.now(), userId: client.identity.id }),
  rooms:   { join: (room, client) => room !== 'vip' || client.identity.admin, meta: (client) => ({ pseudo: client.identity.pseudo }) },
})

app.serve('achat', (p, client) => {
  if (p.prix > 100) throw new Error('solde insuffisant')
  return { solde: 100 - p.prix }
})

app.on('chat', (p, client) => app.broadcast('chat', p, { except: client }))

const ennemis = app.stream('ennemis', { public: true })   // flux ouvert à tous (fermé sans cela) : état + deltas numérotés + rattrapage auto
ennemis.add('e1', { x: 10, y: 20 })

app.room('partie-42').kick(tricheur, 'triche')   // expulsion d'un salon (µ:left), connexion gardée

await app.listen()   // démarre le transport `ws` par défaut (port 8080)
```

C'est **tout** ce qu'il faut pour un serveur `µsocket` complet et protégé, conforme au contrat : le handshake (`µ:hello`/`µ:welcome`/`µ:denied`), le battement (`µ:ping`/`µ:pong`), les accusés de réception (`µ:ack`), les salons et la présence (`µ:join`/`µ:leave`/`µ:sub-presence`), les flux avec resynchronisation (`µ:sub-stream`/`µ:resync`) et la salve de re-souscription post-(re)connexion sont **déjà gérés**.

---

## Sommaire

1. [Options — `mjsWs(opts)`](#options)
2. [`app` — API](#app-api)
3. [Protections de série (« le videur »)](#protections)
4. [Salons & présence](#salons-presence)
5. [Les flux qui se rattrapent — `app.stream`](#flux)
6. [Lancer le serveur — `mjs ws`](#mjs-ws)
7. [Le pont universel](#pont)
8. [La reprise de session](#reprise-session)
9. [Plusieurs processus — l'adaptateur Redis](#adaptateur-redis)
10. [L'état du serveur](#etat-serveur)
11. [Contrat typé (optionnel)](#contrat-type)
12. [La façade transport : brancher uWebSockets.js (ou autre chose)](#transport-facade)
13. [Écrire son fichier serveur — le dialecte de vos composants](#civet-entry)
14. [Statut du module](#statut)
15. [Aller plus loin](#aller-plus-loin)

---

<a id="options"></a>
## 1. Options — `mjsWs(opts)`

| Option | Défaut | Rôle |
|---|---|---|
| `transport` | `'ws'` (bibliothèque `ws`) sur `port`/`host` | `'ws'` ou `'uws'` (uWebSockets.js intégré), ou une **instance** `MjsWsTransport` déjà construite (`MemoryTransport` en test, un transport maison). Cf. §12 « La façade transport » pour tout brancher soi-même. |
| `port` / `host` | `8080` / — | Ignorés si `transport` est une instance déjà construite. |
| `auth(hello, meta)` | — (aucune auth : `identity` vaut `undefined`) | `hello` = charge du `µ:hello` (`{ auth, protocol, resub, rooms }`), `meta` = `{ origin?, headers? }`. Le retour alimente `client.identity`. `false` ou `throw` → `µ:denied { message }` (fermeture définitive côté client). Accepte aussi un objet-proxy `{ url, secret, timeout?, cache? }` qui délègue la décision à un back HTTP signé — cf. §7.11 « Proxy de décisions ». |
| `welcome(client)` | `() => ({})` | Construit la charge du `µ:welcome`, envoyée **immédiatement** après l'auth — rien d'autre ne s'intercale (piège client documenté en [20 · Temps réel](20-temps-reel.md)). |
| `parse` / `serialize` | `JSON.parse` / `JSON.stringify` | (Dé)sérialisation personnalisée des trames. |
| `heartbeat` | `15000` ms | Période **attendue** des `µ:ping` client. `0` = watchdog serveur désactivé. |
| `limits` | cf. §3 | Quotas anti-abus par connexion. |
| `verifyOrigin` | désactivé | Vérification d'origine à l'admission, opt-in strict — tableau (allowlist d'origines exactes, insensible à la casse) OU fonction `(origin, remote) => boolean` (contrôle total). Refus = fermeture immédiate code **1008**, **avant** le hello. Cf. §3.3 « Vérification d'origine ». |
| `trustProxy` | désactivé | Derrière nginx ou un autre proxy inverse : `'loopback'`, ou une liste d'adresses et de plages (`['10.0.0.0/8', '192.168.1.5']`), pour lire l'adresse du vrai visiteur dans `X-Forwarded-For` / `X-Real-IP`. Sans cela, tous les visiteurs partagent l'adresse du proxy et les bornes par IP deviennent des bornes globales. `true` est **refusé**, comme toute plage plus large que `/8` en IPv4 ou que `/16` en IPv6. Appliquée par les transports `'ws'` et `'uws'`. Cf. §3.5. |
| `rooms.join(room, client)` | — (tout accepté) | Garde d'admission aux salons. `false` ou `throw` → refus (`µ:error { message, code: 'join-denied', room }`, throttlé), le client n'entre pas et oublie ce salon. Async autorisée. Accepte aussi un objet-proxy `{ url, secret, timeout?, cache? }` (§7.11). Cf. §4. |
| `rooms.meta(client)` | `() => ({})` | Méta de présence associée à une connexion (pseudo, avatar…), diffusée dans les deltas `µ:presence`. Cf. §4. |
| `rooms.canSeePresence(room, client)` | — (membres seuls) | Qui voit la présence d'un salon. Sans elle, seuls les membres du salon la voient ; avec elle, elle seule décide, membre ou non. `false` ou `throw` → refus (`µ:error { message, code: 'presence-denied', room }`, throttlé). Async autorisée. Cf. §4. |
| `presence` | — (fermée) | Présence **globale** (qui est connecté au serveur, `µ:sub-presence` sans salon) : `'public'` l'ouvre à tous les clients. Fermée, la demander vaut `µ:error { message, code: 'presence-denied' }` (throttlé), jamais la liste. Cf. §4. |
| `guardProcess` | `false` | Si `true`, pose des filets `uncaughtException`/`unhandledRejection` qui **loggent sans tuer** le process. |
| `onLog(niveau, message, meta?)` | `console` (format sobre) | `niveau` : `'debug' \| 'info' \| 'warn' \| 'error'`. |
| `resume` | désactivé | Reprise de session après micro-coupure — `true` (défauts : grâce 30 s, 500 trames, 256 Ko) ou `{ grace?, maxBuffered?, maxBytes? }`. Cf. §8. |
| `sessionExclusive` | `false` | Session exclusive par identité, **deux** modes — `true`/`'replace'` : un 2e `µ:hello` **frais** de la **même** identité éjecte proprement l'ancienne connexion (`µ:bye {reason:'replace'}` + fermeture code **4003**). `'refuse'` (inverse) : ce 2e `µ:hello` est **refusé** si une connexion vivante existe déjà (`µ:denied` + fermeture code **4004**). Cf. §8.5. |
| `ban` | active : 3 expulsions pour abus en 1 min → 5 min de refus du fautif : son compte, ou sans compte son IP | Mise au banc — `false` la désactive, un objet `{ after?, within?, duration?, by? }` la règle (`by` : `'account'` \| `'ip'` \| `'both'`). Cf. §3.4 « Qui compte pour qui ». |
| `onDisconnect(client, reason?)` | — | Rappelée à la déconnexion **définitive** d'un client (immédiate sans `resume`, différée à la fin de la grâce sinon) — **toujours** disponible, sans `opts.bridge`. Une erreur qu'elle lève, ou une promesse qu'elle rejette, est journalisée et n'interrompt pas la purge de la connexion. Cf. §8.2 point 5. |
| `stats` | désactivé | Expose GET /stats, /metrics, /state sur le pont (`bridge` requis pour les servir en HTTP). Le registre de compteurs (`app.stats()`) tourne **toujours**, quelle que soit cette valeur. Cf. §10. |
| `codec` | `'auto'` | `'auto'` (type schématisé → binaire, reste JSON) / `'binary'` (**strict**, refuse tout texte applicatif sans schéma) / `'json'` (coupe-circuit débogage, tout en JSON). Cf. §3.1 « µschema ». |
| `schemas` | — | Déclaration EN **masse** de schémas `{ nom: champs, ... }`, équivalent à autant de `app.schema(nom, champs)` avant `.listen()`. Cf. §3.1. |

<a id="app-api"></a>
## 2. `app` — API

| Méthode | Rôle |
|---|---|
| `.serve(type, (p, client) => résultat)` | Requêtes `{t,p,id}` → `µ:ack` **automatique** (retour → `p` ; `throw`/reject → `{e:true, p:message}`, cf. « Refus et erreurs » ci-dessous). |
| `.on(type, (p, client) => …)` | Pub/sub — aucune réponse attendue (une exception → `µ:error { message }`, même règle). |
| `.send(client, type, p)` | Envoi ciblé à **une** connexion précise (déjà en main, ex. dans un handler). |
| `.sendUser(id, type, p)` | Envoi à **toutes** les connexions d'un utilisateur (`identity.id` ; un visiteur sans compte : `anon:` suivi de son id de connexion) — même résolution que le pont universel (`POST /send { user }`, §7), cluster-aware. |
| `.broadcast(type, p, { except? })` | Diffusion à tous les clients authentifiés (`except` : un client ou un tableau de clients — seules ces connexions sont exclues ; avec plusieurs processus, les autres onglets du même compte reçoivent, où qu'ils soient servis). |
| `.error(client, message)` | Émet un `µ:error { message }` (non fatal côté client). |
| `.use(pkg)` | Installe un paquet activable (`app.use(a).use(b)`, chaînable — retourne toujours `app`) : enregistre les handlers/conventions du paquet sur cette app. Double installation du même nom de paquet : ignorée. Exemples : [26 · Chat](26-chat.md), [27 · Comptes](27-accounts.md), [28 · Lobby](28-lobby.md). |
| `.room(nom, { presence? })` | Poignée de salon — diffusion aux membres, présence, expulsion. `presence: 'public'` ouvre à tous la présence de ce salon, réservée à ses membres sinon. Cf. §4. |
| `.stream(nom, { public?, room?, canSubscribe?, journal? })` | Flux à journal borné — état + deltas numérotés + rattrapage. **Fermé par défaut** : `public: true` l'ouvre à tous, `room` ou `canSubscribe` le réservent. Cf. §5. |
| `.stats()` | Instantané JSON de l'état du serveur (connexions, messages, salons, flux, garde, pont, sessions, intervalles entre deux pings…) — **toujours** disponible, cf. §10. |
| `.schema(nom, champs)` | Déclare (ou ré-affirme à l'identique) un schéma binaire nommé — `champs` = objet **ordonné** `{ nom: type, ... }`. Cf. §3.1 « µschema ». |
| `.clients` | Itérable des clients **authentifiés** (le handshake en cours n'y figure pas). |
| `.listen()` | Démarre le transport. Promesse résolue une fois prêt. |
| `.stop()` | `µ:bye` à tous les clients, fermeture propre des connexions, puis du transport. |

`client` : `.id` (identifiant interne), `.identity` (retour de `auth`), `.latency` (dernier écart entre deux `µ:ping` reçus, ms), `.meta` (`{origin?, headers?}`), `.send(type, p)`, `.close(reason?)` (envoie `µ:bye` puis ferme — départ **définitif**, le client ne reconnecte pas).

**Refus et erreurs d'un `serve()` / `on()`.** Pour refuser volontairement, levez un code en `Error` nue — `throw new Error('commande-refusee')`, que le client traduit — ou une phrase faite pour le client en `MjsWsError` : `throw new MjsWsError('ce n’est pas votre tour')` (`import { MjsWsError } from 'modularjs-framework/ws'`, reconnue aussi par une appli [MJS-Server](24-mjs-server.md)). Leur message part tel quel au client (`µ:ack { e: true, p: … }`, ou `µ:error { message }` pour un `on()`). Toute autre exception — une phrase en `Error` nue, que des bibliothèques et du code d'appli lèvent aussi avec des détails internes (`connect ECONNREFUSED 10.0.3.4:5432 … user=app_prod`), une exception **interne** levée par le moteur JavaScript, une bibliothèque ou le système (`TypeError`, classe d'erreur d'un pilote de base, erreur système…) — est journalisée en erreur (`onLog('error', …)`, avec l'exception et sa pile) — un refus en `MjsWsError`, lui, en avertissement (`onLog('warn', …)`), sa phrase sans pile ; en développement, son message part aussi au client pour déboguer ; en production (`NODE_ENV=production`), le client ne reçoit que « erreur interne du serveur », jamais un détail interne (hôte d'une base, nom d'utilisateur, chemin d'un fichier…). Une erreur de bibliothèque que vous voulez montrer au client : attrapez-la et levez votre propre `MjsWsError`. Les parties [MJS-Server](24-mjs-server.md) gardent leur règle : le refus d'un coup, une `Error` nue de votre code de jeu comprise, est la réponse du joueur, en production aussi. Un code de la famille du message (`lobby:block` → `lobby-denied`, `commande:passer` → `commande-refusee`), la convention des paquets, est du trafic attendu : jamais journalisé en erreur ; toute autre exception l'est.

---

<a id="protections"></a>
## 3. Protections de série (« le videur »)

Actives par défaut, aucune configuration requise :

| Limite | Défaut | Effet au dépassement |
|---|---|---|
| `limits.rate` / `limits.burst` | 40 msg/s / 80 | Seau à jetons par connexion, consulté **à la réception de chaque trame** (avant même sa mise en file de traitement) : trame en trop **ignorée** + `µ:error` (throttlé — un seul message, pas un par trame jetée) ; expulsion après `limits.kickAfter` violations — un dépassement s'oublie après 10 s sans nouveau dépassement : seul un flot continu mène à l'expulsion, pas les petits débordements épars d'une longue session. Les effets en direct (`*cursors`, `*follow`…) n'y prennent que leur part : 4 trames/s à eux tous (réglable : `effects.rate`), côté navigateur. |
| `limits.maxQueued` | 200 trames en attente par connexion | Protège la mémoire même quand le débit ci-dessus resterait sous son seau (une étape lente en tête de file — `auth()` asynchrone, par exemple — ne laisse jamais un arriéré s'accumuler sans borne) : au-delà, expulsion immédiate. Chaque connexion (chaque onglet) a sa propre file. `null` explicite = illimité. |
| `limits.rateBy` | `'connection'` | Qui partage le seau de débit ci-dessus : chaque connexion (défaut), tous les onglets d'un compte (`'account'`), toutes les connexions d'une IP (`'ip'`), ou le compte **et** son IP (`'both'`). Cf. §3.4. |
| `limits.maxPayload` | 65536 octets | Trame surdimensionnée → connexion coupée sur-le-champ, la trame jamais traitée. Ce que voit le client dépend du transport : code **1009** avec `ws` (le défaut) ; avec `'uws'`, uWebSockets.js coupe la connexion sans trame de fermeture, et le client voit **1006** (§12.2) ; avec un transport passé en instance (`MemoryTransport`, transport maison), le serveur mesure le message et ferme en **1009**. |
| `limits.maxBuffered` | 1048576 octets | Contre-pression à l'émission : un envoi est jeté si le buffer du transport déborde déjà ; expulsion après 50 rejets **consécutifs**. |
| `limits.kickAfter` | 50 | Aussi réutilisé pour le JSON invalide (1 `warn` + compteur dédié par connexion). |
| `limits.maxConnections` | `null` (illimité, opt-in) | Plafond GLOBAL de connexions simultanées. Une connexion entrante au-delà est refusée avant authentification : fermeture immédiate, code **1013**. |
| `limits.maxConnectionsPerIp` | 100 | Plafond de connexions simultanées PAR IP. Même refus (code **1013**) ; une IP inconnue (transport sans `remoteInfo.address`) n'est jamais comptée par ce plafond. Derrière un proxy inverse, toutes les IP sont celle du proxy tant que `trustProxy` n'est pas réglé : cf. §3.5. |
| `limits.maxRoomsPerClient` | 50 | Plafond de salons qu'un même client a rejoints en même temps. Au-delà, `µ:join` est refusé (`µ:error`, throttlé) — la connexion, elle, reste ouverte. |
| `limits.maxPresencePerClient` | = `limits.maxRoomsPerClient` | Plafond d'abonnements de présence DE SALON (`µ:sub-presence`) qu'un même client a actifs en même temps — distinct de `maxRoomsPerClient` (celui-ci ne borne que les adhésions, `µ:join`). Au-delà, refusé (`µ:error`, throttlé). `null` explicite = illimité. |
| `heartbeat × 2.5` | 37,5 s par défaut | Watchdog serveur : une connexion muette (aucune trame reçue, `µ:ping` compris) au-delà de ce délai est expulsée. `heartbeat: 0` le désactive. |
| — | — | **Tout** handler applicatif (`auth`/`welcome`/`serve`/`on`) tourne sous garde : une exception ne fait jamais planter le process ni geler la connexion. |
| `guardProcess: true` | désactivé | Filet process entier (`uncaughtException`/`unhandledRejection`) — défense en profondeur au-delà des handlers connus. |
| `ban` | 3 expulsions en 1 min → 5 min | Mise au banc : un client expulsé pour abus à répétition est refusé un moment — son compte, ou sans compte son IP. Cf. §3.4. |

Ces réglages sont **vérifiés à la construction** de `mjsWs()`, comme `ban` et `limits.rateBy` : une valeur `NaN` (par exemple `Number(process.env.RATE)` quand la variable manque), négative, infinie ou d'un autre type que le nombre lève tout de suite une erreur claire, au lieu de couper la protection en silence. Une clé laissée à `undefined` garde son défaut. `limits.maxPayload` et `limits.maxBuffered` sont des entiers ≥ 1 (le transport `ws` lirait `0` comme « illimité ») ; les plafonds de connexions, de salons, de présence et de file acceptent aussi `null` (illimité) ; les autres réglages sont des nombres finis ≥ 0. Même contrôle pour `heartbeat` (`0` le désactive), `token` (`sweep` entier ≥ 1, `slack` ≥ 0), `resume` (`grace`, `maxBuffered`, `maxBytes` ≥ 0) et `antiEntropy` (entier ≥ 1, ou `false`).

Nuance importante : une expulsion de **protection** (débit, taille, contre-pression, watchdog) ferme la connexion **sans `µ:bye`** — le client peut reconnecter normalement, utile si la coupure était transitoire. Seuls `.stop()` et `client.close()` sont des départs **définitifs et annoncés** (`µ:bye`, aucune reconnexion cliente).

<a id="µschema"></a>
### 3.1 µschema — le binaire à schéma

Une trame WebSocket **binaire** (par opposition au texte JSON du protocole `µ:`) passe sous le **même videur** qu'un message texte — rien ne contourne la garde de débit (`limits.rate`/`limits.burst`) ni la garde de taille (`limits.maxPayload`, même coupure au dépassement : **1009** avec `ws`, **1006** côté client avec `'uws'`, cf. §3). `µschema` est la couche qui donne un **sens** à ces octets : un **registre de schémas** déclaré par votre code, une enveloppe fil `[u8 idSchéma][charge]`, et un encodage/décodage **transparent** — `app.on`/`app.serve` reçoivent le message décodé comme s'il était arrivé en JSON, sans rien savoir de la façon dont il a voyagé.

#### Déclarer un schéma — `app.schema(nom, champs)`

```js
import { mjsWs, list, bits } from 'modularjs-framework/ws'

const app = mjsWs({ codec: 'auto' })

app.schema('pos', { x: 'i16', y: 'i16' })
app.schema('etat', {
  hp:      'u8',
  pseudo:  'str8',                          // préfixe de longueur EN OCTETS UTF-8 (u8, max 255)
  tags:    list('str8'),                    // tableau homogène, compteur u16
  drapeau: bits(['vivant', 'arme', 'vip']),  // jusqu'à 8 booléens dans 1 octet — sous-objet en sortie
})
```

Même déclaration, en `ws.server.mjs` (dialecte Civet des composants, §6.1/§13) :

```civet
// ws.server.mjs
export default {
  codec: 'auto'

  setup: (app)->
    app.schema 'pos', { x: 'i16', y: 'i16' }
    app.schema 'etat', {
      hp:     'u8'
      pseudo: 'str8'
    }

    app.on 'pos', (p, client)-> app.broadcast('pos', p, { except: client })
}
```

`champs` est un objet **ordonné** `{ nom: type, ... }` — l'**ordre** des clés fait foi sur le fil (jamais recalculé). Types scalaires : `u8`/`i8`/`u16`/`i16`/`u32`/`i32`/`f32`/`f64` (numériques), `bool` (1 octet), `str8`/`str16` (chaîne UTF-8, préfixe de longueur u8/u16). `list(type)` (compteur u16 puis `type` répété — v1 : scalaire/chaîne **seulement**, pas de sous-schéma imbriqué) et `bits([noms])` (≤ 8 booléens, décodés en `{ nom: bool, ... }`) complètent la liste. Un id **u8** est attribué à chaque schéma **dans l'ordre de déclaration** (0, 1, 2…) — c'est cet id qui ouvre chaque trame binaire.

**Valeurs hors plage.** Un entier hors de la plage de son type (`u8` : 0 à 255, `i8` : -128 à 127, `u16` : 0 à 65 535, `i16` : -32 768 à 32 767, `u32` : 0 à 4 294 967 295, `i32` : -2 147 483 648 à 2 147 483 647) lève une erreur claire à l'encodage, qui nomme le schéma, le champ et la plage : il n'arrive jamais replié (300 en `u8` arrivait 44, -1 en `u32` arrivait 4 294 967 295, et la même donnée en `codec: 'auto'` dépendait du transport). Côté serveur, l'erreur remonte à l'appel (`app.send`, `broadcast`…), comme une chaîne trop longue pour son préfixe ; côté navigateur, le message part en JSON avec sa valeur exacte, et l'erreur s'affiche dans la console. Une fraction est tronquée vers zéro (3,9 → 3) ; `Infinity`, `-Infinity` et `NaN` lèvent la même erreur qu'une valeur hors plage ; dans un champ flottant (`f32`, `f64`), ils passent tels quels, le format IEEE 754 les écrit ; une valeur absente ou qui n'est pas un nombre vaut 0. Ce qu'`Object.prototype` prête à tout objet n'est jamais lu comme une valeur : un champ nommé `constructor` ou `toString`, absent de l'objet, vaut 0, faux ou une chaîne vide. Les noms de `bits([…])` suivent la règle des noms de champs : `__proto__` est refusé à la déclaration.

**Garde ajout-seul** : un schéma déjà déclaré est **immuable** (mêmes champs, mêmes types, même ordre). Le ré-affirmer à l'identique est un no-op silencieux (un entry rechargé à chaud, §6.5, peut ré-exécuter ses `app.schema(...)` sans planter) ; le ré-affirmer avec une forme **différente** lève une erreur claire au boot — faites évoluer votre protocole en déclarant un schéma à un **nom neuf**, jamais en mutant un schéma existant.

#### Les trois modes — `codec`

| `codec` | Comportement |
|---|---|
| `'auto'` (défaut) | Un type applicatif **avec** schéma déclaré part en binaire ; le reste (types non déclarés) part en JSON, comme avant `µschema`. |
| `'binary'` | **strict** — envoyer un type applicatif **sans** schéma déclaré **lève** immédiatement (`app.send`/`sendUser`/`broadcast`/`room().send`, erreur de dev claire, **avant** même de chercher un destinataire) ; recevoir une trame **texte** applicative (hors préfixe `µ:`) est **rejeté** (compté `app.stats().messages.texteRejete`, `µ:error` throttlé). |
| `'json'` | Coupe-circuit débogage — **tout** part en JSON, même un type schématisé (utile pour inspecter le trafic en clair pendant qu'on développe). |

Les trames de **contrôle** `µ:` (`µ:hello`, `µ:welcome`, `µ:ping`…) restent **toujours** en JSON, quel que soit `codec` — le bootstrap du hello ne peut pas dépendre d'un schéma pas encore synchronisé. Sans **aucun** schéma déclaré, la voie JSON reste **byte-identique** à avant `µschema` — activer `codec` ne change rien tant que rien n'est schématisé.

#### Synchronisation à chaud — hash + `µ:schema`

Chaque `µ:welcome` porte un `schemaHash` (dès qu'au moins un schéma est déclaré) — un hash **stable** du registre (noms + types + ordre, FNV-1a). Si le client annonce, dans son `µ:hello`, un `schemaHash` **différent** du serveur, celui-ci pousse **immédiatement après le welcome** une trame `µ:schema { version, definitions }` : `definitions` est la sérialisation JSON-safe complète du registre (`list()`/`bits()` sont déjà des objets inertes, jamais des fonctions embarquées) — de quoi régénérer un miroir local à la volée, sans redémarrage ni redéploiement du client. (Le décodage `µ:schema` côté client arrive avec le runtime, cf. [20 · Temps réel](20-temps-reel.md).)

#### Ce qui n'encode **jamais** en binaire

Les deltas de `app.stream()` (§5) restent inchangés — un flux n'est jamais schématisable (sa forme `{ t, seq, p }` porte un numéro de séquence que `µschema` ne connaît pas). Un `app.room(nom).send(type, p)` encode en binaire exactement comme `app.send`/`app.broadcast` dès que `type` a un schéma — c'est le **même** choix, au **même** endroit (`sendRaw`), pour tous les chemins d'envoi.

#### Id de schéma inconnu à la réception

Une trame binaire dont l'octet d'id ne correspond à **aucun** schéma connu (registre local en retard) est comptée `app.stats().messages.binaireIgnorees` ; en mode `'binary'`, elle déclenche en plus un `µ:error` throttlé (1/s) — en `'auto'`/`'json'`, silence volontaire (pas de canal de reconnaissance gratuit pour qui sonderait le protocole avant le hello).

#### Limite — pub/sub seulement, jamais une requête

L'enveloppe binaire `[u8 idSchéma][charge]` ne porte **aucun** id de corrélation : un frame avec `id` (`sock.request()`, accusés de réception) reste **toujours** en JSON côté client, quel que soit le schéma du type — µschema est un mécanisme **pub**/**sub**, jamais un transport de requêtes (cf. le tableau des 3 modes ci-dessus). Conséquence en `codec: 'binary'` **strict** : ce mode rejette aussi toute trame **texte** applicative hors `µ:`, id ou pas — une `sock.request()` vers un type sans schéma y expire donc systématiquement, sans jamais recevoir de `µ:ack` (cas réel : [24 · MJS-Server §14](24-mjs-server.md#limites), dont l'API cliente entière repose sur des requêtes id-bearing).

Chiffres (30 entités à 15 Hz, 2 clients) : des messages `µschema` binaires par entité coûtent ≈ 0,30× le volume JSON équivalent — tableau complet en [24 · MJS-Server §14](24-mjs-server.md#limites).

### 3.2 µschema-HTTP — AJAX binaire (opt-in)

Le binaire à schéma n'est pas réservé au WebSocket : `µ.ajax.binary(url, options)` (runtime `mjs_ajax.ts`) fait voyager une requête/réponse AJAX en octets µschema au lieu de JSON — **opt-in par point d'accès** (`options.schema`), jamais un défaut global. Sans cette option, `µ.ajax.get/post/put/patch/delete` restent **byte-identiques** à toujours : le JSON reste **recommandé par défaut**, parce que votre back est un monde ouvert (n'importe quel client, n'importe quel outil de debug HTTP doit pouvoir le lire) — µschema-HTTP cible les points d'accès **chauds**, à deux bouts maison (votre client MJS, votre back qui veut bien s'aligner sur le format).

```js
µ.schema('demandeProfil', { id: 'u32' })
µ.schema('profil', { id: 'u32', pseudo: 'str8', score: 'u16' })

µ.ajax.binary('/api/profil', {
  method:  'POST',
  schema:  'demandeProfil',     // nom déclaré — active le binaire pour CET appel, requête ET réponse
  data:    { id: 42 },
  success: (profil) => console.log(profil.pseudo, profil.score),
  error:   (err) => µ.error(err),
})
```

| Option | Rôle |
|---|---|
| `schema` | nom de schéma déclaré — **obligatoire** pour activer le binaire ; absent = comportement JSON inchangé |
| `codec` | registre explicite (sinon le singleton du module `'schema'`, rempli par `µ.schema(...)`) |
| `schemaUrl` | endpoint de rafraîchissement explicite (sinon `url` + `schema=1` en paramètre, cf. plus bas) |
| `data`/`method`/`success`/`error`/`always`/`timeout`/`signal` | identiques à `_request` — mêmes règles que le reste de `µ.ajax` |

Forme choisie plutôt qu'un paramètre de plus sur `µ.ajax.get/post/put/patch/delete` : ces cinq fonctions sont déjà **positionnelles** (6 à 7 paramètres selon le verbe) — y ajouter `schema` aurait été la forme la **plus** invasive possible, avec une arité différente par verbe. `µ.ajax.binary(url, options)` garde `url` en 1er paramètre (cohérent avec les cinq autres) et fait voyager tout le reste dans un objet unique — zéro paramètre ajouté aux fonctions existantes, zéro site d'appel existant à toucher.

#### Le contrat fil — 8 octets de version, puis l'enveloppe habituelle

```
[8 octets ASCII — hash hex du registre][u8 idSchéma][charge µschema, cf. §3.1]
```

Les 8 premiers octets sont `hashRegistre()` (FNV-1a, **toujours** 8 caractères hexadécimaux, cf. §3.1) écrits **tels quels** en ASCII — pas un entier packé : lisible dans un dump hexa, relisible dans n'importe quel langage sans le moindre calcul bit à bit (`bytes[0,8]` suffit). Le reste de la trame est **exactement** `[u8 idSchéma][charge]`, le même format que le binaire WebSocket (§3.1) — la version est un préfixe **additionnel**, jamais une réécriture.

#### Mise à jour à chaud

La **réponse** porte la version du registre **serveur**. Si elle diffère de celle du registre **client** :

1. la requête d'origine **n'échoue pas** — elle patiente ;
2. un `GET` est lancé en arrière-plan sur l'endpoint schéma (`options.schemaUrl`, ou par défaut la même URL + `schema=1` en paramètre) — réponse JSON attendue = **exactement** la forme de `serialiserDefinitions()` (§3.1, `{ hash, schemas: [...] }`, la **même** que la trame `µ:schema` du WebSocket) ;
3. le registre client est rechargé (remplace le singleton du module `'schema'` en place si `options.codec` n'a pas été fourni) ;
4. la charge **déjà reçue** est re-décodée avec le registre frais — un seul aller-retour de rafraîchissement, jamais de boucle : un second désaccord après rafraîchissement est une vraie erreur, routée vers `options.error`.

#### Dépendance au module runtime `'schema'`

µschema-HTTP réutilise le codec du module `'schema'` (`mjs_schema.ts`, déjà nécessaire pour `µ.schema()`/`µ.list()`/`µ.bits()`) — il n'est **jamais** réimplémenté une 3e fois dans `mjs_ajax.ts`. Si `'schema'` n'est pas dans votre sélection `runtime` (`mjs.config.json`) au moment où `µ.ajax.binary({ schema: '...' })` est appelé, l'appel échoue proprement (`options.error`, message explicite) **avant tout `fetch()`** — jamais un `ReferenceError` cru, jamais une requête réseau pour rien.

#### Recette back — Rails, sans dépendance (`String#pack`/`#unpack`)

Aucune gem : juste `Array#pack`/`String#unpack1` en little-endian, miroir exact des types de `src/schema/core.ts`. Les **deux** côtés doivent déclarer les **mêmes** schémas dans le **même** ordre (pas de fichier partagé possible entre Ruby et JS) — recopie manuelle, comme pour tout accord de protocole inter-langages (cf. les recettes JWT, §7.6). ⚠️ l'algorithme de hash suppose des noms de schéma/champ **ASCII** (le cas normal) — `charCodeAt` (JS, unités UTF-16) et `each_byte` (Ruby, octets UTF-8) ne peuvent diverger **que** sur des noms non-ASCII, jamais sur les **valeurs** des champs eux-mêmes.

```ruby
# app/lib/mj_schema_http.rb — recette : les 11 types scalaires sont couverts, list()/bits() restent
# à écrire à la main sur le MÊME principe (cf. src/schema/core.ts) si vous en avez besoin
require 'json'

module MjSchemaHttp
  # id u8 = position dans SCHEMAS, DANS L'ORDRE — miroir de la déclaration cliente
  # (µ.schema('demandeProfil', ...) PUIS µ.schema('profil', ...))
  SCHEMAS = [
    ['demandeProfil', { id: 'u32' }],
    ['profil',         { id: 'u32', pseudo: 'str8', score: 'u16' }],
  ].freeze

  def self.decrire_type(t)
    return t if t.is_a?(String)
    t[:kind] == 'list' ? "list(#{t[:of]})" : "bits(#{JSON.generate(t[:noms])})"
  end

  def self.fnv1a(chaine)
    h = 0x811c9dc5
    chaine.each_byte { |o| h ^= o; h = (h * 0x01000193) & 0xffffffff }
    h.to_s(16).rjust(8, '0')
  end

  def self.hash_registre(schemas = SCHEMAS)
    # une partie JSON par schéma, jamais une concaténation brute : un nom peut contenir n'importe quel séparateur
    parties = schemas.map { |nom, champs| JSON.generate([nom, champs.map { |c, t| [c.to_s, decrire_type(t)] }]) }
    fnv1a(parties.join('|'))
  end

  VERSION = hash_registre.freeze

  def self.lire_champ(bytes, offset, type)
    case type
    when 'u8'   then [bytes.getbyte(offset), offset + 1]
    when 'i8'   then [bytes.byteslice(offset, 1).unpack1('c'), offset + 1]
    when 'bool' then [bytes.getbyte(offset) != 0, offset + 1]
    when 'u16'  then [bytes.byteslice(offset, 2).unpack1('v'), offset + 2]
    when 'i16'  then [bytes.byteslice(offset, 2).unpack1('s<'), offset + 2]
    when 'u32'  then [bytes.byteslice(offset, 4).unpack1('V'), offset + 4]
    when 'i32'  then [bytes.byteslice(offset, 4).unpack1('l<'), offset + 4]
    when 'f32'  then [bytes.byteslice(offset, 4).unpack1('e'), offset + 4]
    when 'f64'  then [bytes.byteslice(offset, 8).unpack1('E'), offset + 8]
    when 'str8'
      len = bytes.getbyte(offset)
      [bytes.byteslice(offset + 1, len).force_encoding('UTF-8'), offset + 1 + len]
    when 'str16'
      len = bytes.byteslice(offset, 2).unpack1('v')
      [bytes.byteslice(offset + 2, len).force_encoding('UTF-8'), offset + 2 + len]
    else raise "[MjSchemaHttp] type de champ non géré : #{type} (list()/bits() : même principe, cf. src/schema/core.ts)"
    end
  end

  def self.decoder(bytes, schemas = SCHEMAS)
    version     = bytes.byteslice(0, 8)
    id          = bytes.getbyte(8)
    nom, champs = schemas[id]
    raise "[MjSchemaHttp] id de schéma inconnu (#{id})" if nom.nil?
    offset = 9
    objet  = {}
    champs.each { |c, t| valeur, offset = lire_champ(bytes, offset, t); objet[c] = valeur }
    { version: version, nom: nom, objet: objet }
  end

  def self.ecrire_champ(valeur, type)
    case type
    when 'u8'    then [valeur & 0xff].pack('C')
    when 'i8'    then [valeur].pack('c')
    when 'bool'  then [valeur ? 1 : 0].pack('C')
    when 'u16'   then [valeur].pack('v')
    when 'i16'   then [valeur].pack('s<')
    when 'u32'   then [valeur].pack('V')
    when 'i32'   then [valeur].pack('l<')
    when 'f32'   then [valeur].pack('e')
    when 'f64'   then [valeur].pack('E')
    when 'str8'  then o = valeur.to_s.b; [o.bytesize].pack('C') + o
    when 'str16' then o = valeur.to_s.b; [o.bytesize].pack('v') + o
    else raise "[MjSchemaHttp] type de champ non géré : #{type} (list()/bits() : même principe, cf. src/schema/core.ts)"
    end
  end

  def self.encoder(nom, objet, schemas = SCHEMAS, version = VERSION)
    id = schemas.index { |n, _| n == nom }
    raise "[MjSchemaHttp] schéma inconnu '#{nom}'" if id.nil?
    _, champs = schemas[id]
    corps = champs.map { |c, t| ecrire_champ(objet[c], t) }.join
    [version].pack('a8') + [id].pack('C') + corps
  end

  def self.definitions_json(schemas = SCHEMAS, version = VERSION)
    { hash: version, schemas: schemas.map { |nom, champs| { nom: nom, champs: champs.to_a } } }
  end
end
```

Utilisation dans un contrôleur :

```ruby
class ProfilsController < ApplicationController
  def show
    requete = MjSchemaHttp.decoder(request.body.read.b)
    profil  = Profil.find(requete[:objet][:id])
    corps   = MjSchemaHttp.encoder('profil', { id: profil.id, pseudo: profil.pseudo, score: profil.score })
    render body: corps, content_type: 'application/octet-stream'
  end

  # GET /api/profil?schema=1 — endpoint de rafraîchissement (convention par défaut du client)
  def schema
    render json: MjSchemaHttp.definitions_json
  end
end
```

**Honnête** : c'est nettement plus lourd qu'un `render json: ...`. La recette ci-dessus exige de garder les déclarations Ruby/JS en accord manuel, sans le filet des gardes **ajout-seul** de `defSchema` (§3.1) côté Ruby — une déclaration qui diverge silencieusement (ordre, type) produit un hash différent, jamais une erreur explicite côté Rails. Réservez µschema-HTTP à de vrais points chauds (payload répété à haute fréquence, ex. polling serré) où le gain d'octets/CPU JSON justifie l'entretien — le JSON classique (`µ.ajax.get/post`) reste le choix par défaut recommandé pour tout le reste.

### 3.3 Vérification d'origine

Absente (défaut), aucune connexion n'est refusée pour son origine — comportement historique **strict**, opt-in. Posée, `verifyOrigin` contrôle **chaque connexion entrante à l'admission**, **avant** le `µ:hello` (pas de `µ:denied`, une connexion refusée n'a même pas eu l'occasion de dire bonjour) :

- **Forme tableau** — allowlist stricte d'origines exactes (schéma+hôte+port, ex. `'https://exemple.com'`), comparaison **insensible à la casse** (compilée en `Set` minuscule une seule fois, jamais recalculée par connexion). Un `Origin` absent ou non listé est refusé.
- **Forme fonction** — contrôle total : `(origin, remote) => boolean`, reçoit l'`Origin` brut (`string | undefined`) et le `MjsWsRemoteInfo` de la connexion (`{origin?, headers?, address?}`), retourne `true` pour admettre. Une exception levée = refus (**fail-closed**).

Refus = fermeture immédiate, code **1008** (« Policy Violation », définitif — contrairement au **1013** des plafonds de connexions §3, ce n'est pas transitoire : réessayer avec la même origine échouera toujours). Compteur dédié `stats.connexions.refuseesOrigine` (cf. §10), qui compte chaque refus ; le journal, lui, est regroupé : une ligne `warn` au plus par minute (l'`Origin`, écrite par le visiteur, y est tronquée à 200 caractères), la suivante annonce combien de refus semblables ont été tus entre-temps. Même regroupement pour les refus des plafonds de connexions (§3).

```js
const app = mjsWs({
  verifyOrigin: ['https://mon-site.example', 'https://admin.mon-site.example'],
})
```

Avec `mjs ws` (§6), se configure aussi dans `mjs.config.json` (`ws.verifyOrigin`, **seule** la forme tableau y est représentable) ou dans l'entry (`verifyOrigin`, tableau OU fonction) — même règle que `heartbeat`/`limits` : si les **deux** sont posés, l'entry prime EN **bloc** (cf. §6.4).

> ⚠️ **Obligatoire avec l'authentification par cookie.** Si `opts.auth` rejoue le cookie de la requête d'upgrade (patron « `mjsWs` rejoue le cookie lui-même », §7.12) — le navigateur le joint tout seul, page tierce comprise — `verifyOrigin` n'est plus une option. Avec un jeton explicite (`hello.auth.token`, §7.6), il reste facultatif : une page tierce ne peut pas lire ce jeton.

<a id="qui-compte"></a>
### 3.4 Qui compte pour qui — connexion, compte, IP

Chaque onglet ouvre **sa** connexion. Ces réglages disent qui est compté ensemble :

| Question | Réglage | Défaut |
|---|---|---|
| Un compte peut-il ouvrir plusieurs connexions (onglets) ? | `sessionExclusive` : `false` = oui ; `'replace'` = une seule, la nouvelle remplace l'ancienne ; `'refuse'` = une seule, la nouvelle est refusée (§8.5) | plusieurs |
| Combien de connexions par IP ? | `limits.maxConnectionsPerIp` (§3) | 100 |
| Le débit se compte par… | `limits.rateBy` : `'connection'`, `'account'`, `'ip'` ou `'both'` | `'connection'` |
| Un abuseur expulsé est refusé par… | `ban.by` : `'account'`, `'ip'` ou `'both'` | `'account'` (mise au banc **active**) |
| Chat : le même message répété | `chatPackage({ duplicates })`, cf. [26 · Chat](26-chat.md) | désactivé |

**Compte ou IP ?** Le compte, c'est `identity.id` (le retour de `auth`). Un visiteur **sans compte** est compté par son **IP** ; sans IP connue non plus (transport qui ne l'expose pas), par sa connexion. `'both'` compte le compte **et** son IP : utile contre le multi-compte, au prix des IP partagées (réseau d'entreprise, école, opérateur mobile), où un abuseur pénalise ses voisins. Derrière nginx, toutes les « IP » valent celle du proxy tant que `trustProxy` n'est pas réglé : cf. §3.5.

#### Débit partagé — `limits.rateBy`

Par défaut, chaque connexion a son propre seau (`limits.rate`/`burst`) : un compte ouvert dans 10 onglets a 10 fois le débit. Avec `'account'`, tous les onglets d'un compte puisent dans **un seul** seau ; avec `'ip'`, toutes les connexions d'une IP ; avec `'both'`, chaque message prend un jeton dans le seau du compte **et** dans celui de l'IP. En `'account'`, une connexion garde son propre seau tant que son `µ:hello` n'est pas accepté : des comptes différents derrière une même IP ne se gênent jamais ; en `'ip'` et `'both'`, elle est comptée par IP dès l'arrivée. Les seaux sont propres à chaque processus et disparaissent avec la dernière connexion qui s'en sert.

#### Mise au banc — `ban`

Sans elle, une connexion expulsée pour **abus** revenait aussitôt, compteurs neufs. Abus = débit dépassé, messages invalides en série, file pleine, trame trop lourde (même coupée par le transport lui-même, avant d'arriver au serveur, avec `ws` comme avec `'uws'` : uWebSockets.js coupe sans trame de fermeture, la coupure compte de la même façon). Un silence (watchdog), un réseau lent (contre-pression) ou une connexion perdue (réseau coupé, onglet fermé) ne comptent jamais. Par défaut : **3 expulsions en 1 minute** valent **5 minutes** de refus.

```js
mjsWs({ ban: { after: 3, within: 60_000, duration: 300_000, by: 'account' } })   // les défauts
mjsWs({ ban: false })                                                          // désactivée
```

| `ban.by` | Qui est refusé | Où |
|---|---|---|
| `'account'` | le compte ; un visiteur sans compte, par son IP — un **compte** de la même IP reste bienvenu, même sans jeton avec le paquet [Comptes](27-accounts.md) (voir plus bas) | au `µ:hello` : `µ:denied` « mis au banc pour abus répétés — réessayez dans N min » |
| `'ip'` | toute l'IP | dès l'arrivée, avant le hello : fermeture **1008** |
| `'both'` | un compte fautif **et** son IP ; un visiteur sans compte, les seuls visiteurs sans compte de son IP | faute d'un compte : l'IP dès l'arrivée (1008), le compte au hello (`µ:denied`) ; faute d'un visiteur sans compte : les visiteurs sans compte de cette IP au hello (`µ:denied`), un **compte** de la même IP reste bienvenu |

- Par défaut (`'account'`), le banc vise le fautif : son compte, ou, sans compte, les seuls visiteurs sans compte de son IP. Un visiteur qui se fait expulser exprès ne peut donc pas faire refuser les comptes qui partagent son IP (école, entreprise, opérateur mobile).
- Avec le paquet [Comptes](27-accounts.md), un titulaire **sans jeton** (autre poste, salle informatique, jeton expiré) se connecte par un hello anonyme puis `account:login`. Depuis une adresse au banc pour la faute de visiteurs sans compte (`'account'`, ou `'both'` pour la faute d'un visiteur sans compte), ce hello est accueilli, mais réduit aux trames du paquet comptes (`account:login`, `account:create`, `account:logout`) : toute autre trame, y compris un `serve('account:…')` de votre appli (un « mot de passe oublié », par exemple), reçoit « adresse mise au banc pour abus répétés — connectez-vous à votre compte pour continuer, ou réessayez dans N min » (`µ:ack` en erreur pour une requête, `µ:error` sinon), jusqu'à la fin du banc. Le jeton reçu ouvre une connexion complète. Tant que dure le banc, ce hello accueilli ne se montre pas : votre fonction `welcome` ne tourne pas pour lui (son `µ:welcome` part sans votre charge), il n'entre pas dans la présence globale et le webhook `connect` ne part pas. Si le banc finit pendant la connexion, elle rejoint la présence globale et le webhook `connect` part à sa trame suivante ; `disconnect` ne part qu'après un `connect`. Sans paquet comptes, ce hello est refusé (`µ:denied`).
- En `'both'`, un visiteur **sans compte** ne ferme lui aussi l'IP qu'aux visiteurs sans compte ; la faute d'un **compte**, elle, ferme l'IP à tous (contre le multi-compte). À éviter si un visiteur peut se créer un compte sans effort (paquet [Comptes](27-accounts.md), comptes invités, inscription libre) : il s'en crée un en une requête, se fait expulser trois fois, et ferme l'adresse à tous ses voisins pendant `duration`.
- Les connexions **déjà ouvertes** ne sont pas coupées : seules les nouvelles sont refusées.
- La reprise de session (§8) ne contourne pas le banc : le refus passe avant elle.
- Le client µ.socket refusé à l'arrivée réessaie à son rythme habituel (environ 5 s entre deux essais) et revient seul à la fin du banc ; refusé au hello (`µ:denied`), il s'arrête, comme pour tout `µ:denied` : l'application le reconnecte (`connect()`) quand elle le souhaite.
- Plusieurs processus (§9) : chaque processus compte ses expulsions ; un refus prononcé est publié aux autres.
- Compteurs (§10) : `garde.misesAuBanc` (refus prononcés), `connexions.refuseesBan` (connexions refusées) ; chaque mise au banc est aussi journalisée (`warn`).

Dans `mjs.config.json` : `ws.ban` et `ws.limits.rateBy` (§6.3).

**IPv6 : un préfixe compte pour une adresse.** Pour toutes les limites par IP — `limits.maxConnectionsPerIp`, le débit partagé par IP (`limits.rateBy`), la mise au banc par IP, la limite de débit du pont (§7.8) et l'anti-force-brute des [comptes](27-accounts.md) —, une adresse IPv6 compte pour tout son préfixe `/56` : un abonné en reçoit souvent un entier (256 réseaux `/64`, des milliards d'adresses), qu'il pourrait faire tourner pour multiplier ses connexions et ses essais. Les visiteurs d'un même `/56` partagent donc ces bornes ; une adresse IPv4 compte seule, comme avant. Les journaux de refus et de mise au banc écrivent alors le préfixe (`2001:db8:aa:bb00::/56`).

<a id="proxy-inverse"></a>
### 3.5 Derrière un proxy inverse (nginx) — `trustProxy`

Derrière nginx, la socket du serveur ne voit que l'adresse **du proxy** — `127.0.0.1`, ou **rien du tout** sur une socket unix. Tous vos visiteurs partagent alors la même « adresse », et chaque réglage qui compte par IP (§3.4) devient une borne **globale** : `limits.maxConnectionsPerIp`, la mise au banc par IP, le débit par IP, l'anti-force-brute des [comptes](27-accounts.md), le verrou des codes de partie de [MJS-Server](24-mjs-server.md#configuration) (`antiCheat.codePerIp`). Concrètement : dix codes de partie faux d'**un** visiteur verrouillent **tout le monde** pendant une minute.

`trustProxy` dit à quels pairs croire quand ils annoncent l'adresse du vrai visiteur dans leurs en-têtes (`X-Forwarded-For`, `X-Real-IP`) :

| Valeur | Effet |
|---|---|
| absent, `false` (défaut), ou une liste vide | rien ne change : l'adresse est celle de la socket, les en-têtes ne sont jamais lus |
| `'loopback'` | croire les en-têtes quand le pair est une adresse de boucle : `127.0.0.0/8`, `::1`, ou une socket unix (aucune adresse) |
| `['10.0.0.0/8', '192.168.1.5']` | croire les en-têtes quand le pair fait partie de cette liste d'adresses ou de plages (IPv4 ou IPv6, `/bits` pour une plage, pas plus large que `/8` en IPv4 ni que `/16` en IPv6) |
| `true` | **refusé** dès la construction, avec un message qui donne les deux formes ci-dessus : croire n'importe quel pair laisserait tout visiteur choisir l'adresse qu'il veut. Une plage de 0 bit (`0.0.0.0/0`, `::/0`) est refusée pour la même raison, et plus généralement toute plage trop large (ci-dessous). |

```js
const app = mjsWs({ trustProxy: 'loopback', /* ...auth, rooms, limits... */ })
```

Côté nginx, le proxy **ajoute** l'adresse qu'il voit à `X-Forwarded-For` et pose `X-Real-IP` :

```nginx
location /ws {
  proxy_pass http://127.0.0.1:4000;
  proxy_http_version 1.1;
  proxy_set_header Upgrade $http_upgrade;
  proxy_set_header Connection "upgrade";
  proxy_set_header Host $host;
  proxy_set_header X-Real-IP $remote_addr;
  proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
}
```

**Comment l'adresse est lue**, quand le pair est de confiance. Deux en-têtes peuvent nommer le visiteur : `X-Real-IP`, et le visiteur de `X-Forwarded-For`, que l'on trouve en remontant la chaîne **de droite à gauche** jusqu'à la première entrée qui n'est pas elle-même un proxy de confiance. nginx écrit l'adresse qu'il voit **à droite** : ce qu'un visiteur ajoute lui-même à gauche (`X-Forwarded-For: 10.9.9.9`) n'est jamais retenu. Avec `X-Forwarded-For: 10.9.9.9, 203.0.113.7`, le visiteur de la chaîne est `203.0.113.7` ; quand toutes les entrées sont des proxies de confiance, c'est la plus à gauche, le début de la chaîne.

1. `X-Real-IP` lisible, qui n'est pas lui-même un proxy de confiance : c'est le visiteur **si** `X-Forwarded-For` est absent ou désigne le même. Si les deux se contredisent, ou si `X-Forwarded-For` est là mais illisible, l'un des deux a été écrit par le visiteur, et rien ne dit lequel : la connexion porte l'adresse du pair, c'est-à-dire celle du proxy, et un avertissement part sur la console (`console.warn`), une seule fois pour tout le processus.
2. `X-Real-IP` absent, illisible, ou adresse d'un proxy de confiance (un CDN placé devant nginx, par exemple) : le visiteur de `X-Forwarded-For`.
3. Ni l'un ni l'autre : l'adresse du pair.

> ⚠️ **Faites écrire les deux en-têtes par votre proxy, ou retirer celui qu'il n'écrit pas.** Un proxy qui n'en écrit qu'un laisse passer l'autre tel que le visiteur l'a envoyé, avec l'adresse de son choix : nginx avec la seule ligne `X-Real-IP` laisse passer le `X-Forwarded-For` du visiteur ; HAProxy (`option forwardfor`) ou un répartiteur AWS ALB, qui n'écrivent que `X-Forwarded-For`, laissent passer son `X-Real-IP`. Avec la règle ci-dessus, un visiteur qui forge l'un des deux ne choisit jamais son adresse : il prend celle du proxy, et les bornes par adresse le comptent avec tous ceux qui en font autant. Un visiteur honnête dont le navigateur passe par un proxy d'entreprise qui ajoute déjà `X-Forwarded-For` la prend aussi, si votre proxy ne pose que `X-Real-IP`. La configuration nginx ci-dessus écrit les deux. Avec HAProxy, ajoutez `http-request set-header X-Real-IP %[src]`, ou retirez celui du visiteur : `http-request del-header X-Real-IP`.

Une entrée **malformée** de `X-Forwarded-For`, atteinte en remontant la chaîne (texte qui n'est pas une adresse, port collé à l'adresse, entrée vide), donne l'adresse du pair ; un `X-Real-IP` malformé compte comme absent. Jamais d'erreur, jamais de connexion coupée. Les adresses s'écrivent comme sans l'option : IPv6 abrégée en minuscules, IPv4 mappée en IPv6 ramenée en IPv4 ; deux écritures de la même adresse dans les deux en-têtes ne se contredisent pas. `client.meta.address` porte l'adresse retenue, et c'est elle que lisent tous les plafonds ci-dessus.

Sans le réglage, un **avertissement unique** apparaît au journal du serveur dès que des en-têtes de proxy arrivent d'une adresse locale (« vous semblez être derrière un proxy… réglez `trustProxy: 'loopback'` »). `trustProxy: false` est un choix explicite : il garde le comportement par défaut et supprime l'avertissement.

À savoir :

- **Les transports `'ws'` et `'uws'` construits par `mjsWs()`** sont les seuls à appliquer l'option de `mjsWs()`. Avec une **instance** de transport (`transport: new UwsTransport({ socketPath })`, un transport maison), elle est ignorée, comme `port` et `host` : posez-la sur le transport lui-même, `new UwsTransport({ socketPath, trustProxy: 'loopback' })`. Un transport maison lit les en-têtes comme il l'entend.
- **Une plage trop large est refusée dès la construction.** Plus large que `/8` en IPv4 (`0.0.0.0/1`, `128.0.0.0/1`, `10.0.0.0/7`…) ou que `/16` en IPv6 (`2000::/3`, `fc00::/7`, `fd00::/8`…), elle contiendrait des visiteurs directs : crus sur parole comme un proxy, ils choisiraient l'adresse qu'ils veulent dans `X-Forwarded-For` et contourneraient toutes les bornes par adresse. Deux plages `/1` qui se partagent tout IPv4 reviennent à `true` : chacune est refusée. Une plage IPv6 qui contient l'espace IPv4 mappé en IPv6 (`::/16`, `::ffff:0:0/96`…) se mesure en IPv4, car la liste ne distingue pas `::ffff:10.0.0.1` de `10.0.0.1`. Le message nomme la plage et la limite. Listez vos proxies réels : `10.0.0.0/8`, `192.168.0.0/16`, `192.168.1.5` passent, et pour des adresses locales uniques IPv6, donnez le préfixe de votre site (`fd12:3456:789a::/48`) plutôt que `fd00::/8`.
- **Socket unix** : le pair n'a aucune adresse. `'loopback'` le tient pour local ; une liste ne le contient jamais.
- **`'loopback'` croit tout processus local.** N'écoutez que sur la boucle locale ou une socket unix (le défaut de `mjs ws`, §6.3) : seuls les processus de la machine peuvent alors annoncer l'adresse de leur choix, et ils y ont déjà accès.
- **Avec `mjs ws`**, `trustProxy` n'est pas une clé de `mjs.config.json` : posez-la dans l'entry, `export default { trustProxy: 'loopback', … }` (§6.1).
- **La carte de chaleur** (§4.5) lit en plus la première entrée de `X-Forwarded-For` pour son `exclude.ips`, avec ou sans cette option ; avec elle, l'adresse de la connexion est déjà celle du visiteur.
- **Le pont HTTP** (§7) ne lit jamais ces en-têtes : c'est votre back qui l'appelle, pas vos visiteurs, et sa limite par adresse reste celle de la socket.

---

<a id="salons-presence"></a>
## 4. Salons & présence

Un **salon** est un groupe nommé de connexions : le client demande à entrer (`sock.room('partie-42')` → `µ:join`), le serveur tient le registre, et l'application peut diffuser **aux seuls membres**. La **présence** est la liste réactive « qui est là » — globale (tout le serveur) ou par salon — que le client consomme telle quelle via `sock.presence()` (voir [20 · Temps réel §5](20-temps-reel.md)).

```js
const app = mjsWs({
  auth:  (hello) => ({ id: hello.auth.userId, pseudo: hello.auth.pseudo }),
  rooms: {
    join: async (room, client) => {                    // garde d'admission (async autorisée)
      if (room.startsWith('privé-')) return estInvité(client.identity.id, room)
      return true                                      // false ou throw → refus, µ:error côté client
    },
    meta: (client) => ({ pseudo: client.identity.pseudo }),   // ce que les autres voient de lui
  },
})

const partie = app.room('partie-42')
partie.send('partie-42/coup', { case: 12 })            // diffusion aux membres seulement
partie.send('partie-42/coup', { case: 12 }, { except: joueur })
partie.size                                            // nombre de connexions membres
partie.has(client)                                     // ce client est-il membre ?
partie.kick(client, 'triche')                          // expulsion du salon — la connexion reste ouverte

app.sendTo('partie-42', 'coup', { case: 12 })          // sucre : équivaut à la ligne app.room(...).send(...) ci-dessus

app.room('hall', { presence: 'public' })               // la présence du hall : visible de tous, membres ou non
```

| `app.room(nom)` | Rôle |
|---|---|
| `.send(type, p, { except? })` | Diffuse `{t: type, p}` aux membres (`except` : seules ces connexions sont exclues, comme pour `broadcast`). `type` est envoyé **tel quel** — pour viser les écouteurs scopés du client (`salon.on('coup')`), préfixez vous-même (`'partie-42/coup'`) : le préfixe de salon est une convention **cliente**, le serveur n'ajoute rien. |
| `.clients` / `.size` | Les connexions membres / leur nombre. |
| `.has(client)` | Appartenance d'une connexion. |
| `.kick(clientOuId, raison?)` | Expulse du salon : le visé reçoit **un unique** `µ:left { room, reason }` (→ son callback `onLeft(raison)`, purge locale du salon), les abonnés-présence reçoivent le delta `leave`. La **connexion reste ouverte** — c'est une expulsion de salon, pas un `µ:bye`. Par chaîne : l'id d'une personne — `identity.id` (expulse alors tous ses onglets du salon), ou `anon:` suivi de l'id de connexion d'un visiteur sans compte ; pour une seule connexion, passez l'objet client. |

**Raccourci `app.sendTo(salon, type, p)`** — sucre pour `app.room(salon).send(salon + '/' + type, p)` : évite la double mention du nom de salon pour un envoi ponctuel où vous n'avez pas besoin de garder la référence (pas d'`except`, pas de `.size`/`.kick`/`.has` ensuite — pour ça, gardez `app.room(salon)`).

Ce qui est géré sans que vous vous en occupiez :

- **Adhésions** : `µ:join` en double = silencieux (déjà membre) ; `µ:leave` d'un non-membre = silencieux ; une déconnexion quitte tous ses salons proprement.
- **Refus** : garde `join` qui rend `false` ou lève → le client n'entre pas et reçoit un `µ:error` (throttlé à un par seconde — une boucle de re-tentatives ne se fait pas mitrailler en retour).
- **Noms bornés** : un nom de salon reçu d'un client (`µ:join`, `µ:sub-presence`) fait 200 caractères au plus. Au-delà, le client reçoit un `µ:error` « nom de salon trop long » (throttlé de même) et rien n'est retenu. Les noms que **votre** code passe à `app.room(nom)` ne sont pas bornés.
- **Présence globale** (qui est connecté au serveur, demandée par un `µ:sub-presence` sans salon) : **fermée par défaut**, comme celle d'un salon l'est à ses non-membres — la demander vaut `µ:error { message, code: 'presence-denied' }` (sans `room`, throttlé de même), jamais la liste. Ouvrez-la à tous les clients d'une ligne : `mjsWs({ presence: 'public' })`. Ouverte, un client authentifié « apparaît » aux abonnés dès son `µ:welcome` et « disparaît » à sa déconnexion — indépendamment de tout salon. Votre back la lit toujours, ouverte ou non, par le pont (`GET /presence`, §7).
- **Agrégation multi-onglets** : la clé d'un pair de présence est `client.identity.id` (visiteur sans compte : `anon:` suivi de son id de connexion). Un même utilisateur ouvert dans **deux onglets = un seul pair** — le delta `join` ne part qu'à l'ouverture du **premier**, le delta `leave` qu'à la fermeture du **dernier**, et sa méta est celle de la connexion la plus récente. Personne ne « clignote » parce qu'il ouvre un deuxième onglet.
- **Id de connexion** (`client.id` ; la clé de pair d'un visiteur sans compte est `anon:` suivi de cet id) : `c` suivi d'un nombre amorcé à l'heure du démarrage du serveur (en millisecondes), puis +1 par connexion — jamais l'id d'une connexion d'un démarrage précédent (un siège anonyme d'une partie restaurée n'est pas repris par une autre connexion). Avec le pont ou plusieurs processus, il est préfixé de l'identifiant du processus (`<processus>.c<nombre>`). Ne lisez rien d'autre dans ce nombre.
- **Visiteur sans compte, compte : deux espaces de noms** — un visiteur sans compte est toujours `anon:` suivi de son id de connexion, un compte toujours son `identity.id`, partout où MJS-WS désigne une personne : présence, `sendUser`, `kick`, pont (`user`, `except`), webhooks, discussion, hall, réactions, suivi d'écran. Un id de connexion nu ne désigne jamais une personne : un compte peut porter le même (une appli où l'on choisit son pseudo). Un compte dont l'id commence par `anon:` est refusé dès le hello (`µ:denied` « identifiant de compte refusé : « anon: » est réservé aux visiteurs sans compte », et un `warn` au journal du serveur) : donnez à vos comptes des id sans ce préfixe.
- **Présence réservée aux membres** : par défaut, la présence d'un salon (qui est dedans, avec sa méta) n'est servie qu'à ses membres. Le `µ:sub-presence` d'un non-membre reçoit `µ:error { message, code: 'presence-denied', room }` (throttlé de même), jamais la liste ; et qui quitte le salon (`µ:leave`, `kick`, déconnexion) cesse de la recevoir. Côté client, rejoignez le salon avant de demander sa présence (`sock.room(nom)`, puis `salon.presence()`).
- **Ouvrir la présence d'un salon** : pour afficher « qui joue » sans jouer, ouvrez-la, salon par salon, d'une ligne — `app.room('partie-42', { presence: 'public' })` : tous les clients la voient, membres ou non, sans entrer (`presence: 'members'` la referme). Ou décidez au cas par cas avec la garde `rooms.canSeePresence(room, client)` : elle seule décide alors, membre ou non (`false` ou `throw` → le même refus) :

```js
const app = mjsWs({
  rooms: { canSeePresence: (room, client) => room.startsWith('partie-') || app.room(room).has(client) },   // les parties : à tous ; les autres salons : à leurs membres
})
```

### 4.1 Salon avec historique — `room(x).history(n)`

Le cas revient partout : un salon de chat (ou un fil de commentaires) où un **retardataire** qui rejoint veut voir les derniers échanges, pas repartir de zéro. `room(x).history(n)` adosse au salon un petit **journal borné** des `n` derniers `send()` — opt-in, coût nul tant qu'il n'est pas appelé.

```civet
salon = app.room('chat-42')
salon.history(50)                       // garde les 50 derniers messages — appel UNIQUE, avant ou après le 1er membre

app.on 'chat', (p, client)->
  salon.send('chat-42/message', { pseudo: client.identity.pseudo, texte: p.texte })
```

Dès cet appel, chaque `salon.send(type, p)` qui suit est **aussi** journalisé (anneau : au-delà de `n`, les plus vieux tombent). Un **nouvel arrivant** (`µ:join` accepté) reçoit automatiquement les `n` derniers messages, **avant** tout trafic live — rien à coder côté client, `sock.room('chat-42').on('message', cb)` les reçoit exactement comme un message live.

| `room(nom).history(n)` | Effet |
|---|---|
| `n > 0` | Active (ou redimensionne) le journal à `n` entrées. Rétrécir retaille tout de suite (les plus vieilles tombent) ; agrandir garde le contenu existant. |
| `n === 0` (ou tout `n` ≤ 0) | Purge et désactive — retour au comportement sans historique. |

**Le choix : rejeu transparent, pas de trame dédiée.** Au join, le serveur ne pousse pas un message spécial du genre `µ:history { messages: [...] }` — il **rejoue** chaque entrée du journal **exactement** comme au moment de son `send()` d'origine (`{t: type, p}`, aucune enveloppe). Le nouvel arrivant ne voit donc **aucune différence** entre un message d'historique et un message live : même écouteur (`sock.on(type)`), même forme, zéro code client à écrire pour gérer un rattrapage. Le prix : pas de marqueur « ceci est du passé » — une appli qui en a besoin l'ajoute elle-même à sa charge (ex. un champ `at: Date.now()` posé à l'envoi).

À savoir :

- **Opt-in par salon, pas par défaut** : un salon jamais configuré avec `.history()` se comporte **exactement** comme avant cette fonctionnalité (aucun journal, aucun coût, `send()` inchangé).
- **Un membre déjà présent ne reçoit jamais de rejeu** — seul le nouvel arrivant (même dédup que `µ:join`, ci-dessus).
- **Le journal disparaît avec le salon vide** : plus aucun membre → purge automatique, même sort que la présence de salon. Un salon qui repeuple après ça repart **sans** historique tant que `.history(n)` n'est pas rappelé.
- **Indépendant du rattrapage des flux** (`µ:resync`, §5 ci-dessous) — deux mécanismes séparés, l'un pour un salon événementiel (`room().send`), l'autre pour un état (`app.stream`) ; rien ne les mélange.
- **Purement local** : comme `stream().destroy()` (§5), l'historique d'un salon n'est pas répliqué entre plusieurs process (§9) — chaque process garde le sien.

### 4.2 Les curseurs des visiteurs — `cursorsPackage()`

L'effet `*cursors` (cf. [38 · Effets](38-effets.md), famille « En direct ») montre à chaque visiteur la souris, les clics, la sélection et la balise active des autres, en direct. Comme `*react`, `*follow` et `*heatmap`, il passe par la connexion de sa variable : `@sock` du composant (`@sock = µsocket 'wss://…'`, avec son `auth` : l'identité des visiteurs), ou celle qu'on lui donne (`*cursors($$sock)`, un store : une seule connexion pour toute l'appli). Côté serveur, une ligne :

```civet
import { mjsWs, cursorsPackage } from 'modularjs-framework/ws'
app = mjsWs({ auth: … })
app.use(cursorsPackage())
```

Chaque page est un salon `cursors:<nom>` (le chemin de la page, sauf `room` écrit sur l'effet) ; la présence du salon dit qui est là, et l'effet retire le curseur d'un visiteur parti. Le serveur ne fait que relayer, aux **autres** membres du salon, la trame `cursors:move` d'un visiteur (sa souris, sa sélection, sa balise active, le compte de ses clics) — après l'avoir vérifiée champ par champ (des chemins de nombres, des fractions entre 0 et 1, des rangs bornés, un compte entier : rien d'autre ne passe) et y avoir mis son identité (`from: { id, name }`, le nom étant `identity.name`, jamais reçu du client). Le texte d'une page ou d'un champ ne transite jamais, seulement des positions.

**Une page très fréquentée.** À partir de `groupFrom` membres (100 par défaut), le serveur regroupe les positions : au lieu d'une trame par position et par visiteur — à 100 visiteurs, chacun en recevrait des centaines par seconde —, une trame `cursors:moves` par quart de seconde à tout le salon, avec la dernière position de chacun, la plus récente en tête. Elle en porte autant que le plus grand `max` des visiteurs (chacun le dit au serveur en arrivant), 100 au plus, plus une : celle de qui la reçoit, qu'il écarte — elle ne prend la place d'aucun autre ; chaque écran en montre ses `max` (20 par défaut, `*cursors(max: 50)` : plus) — ceux qui ont bougé le plus récemment.

**Une identité au nom réservé.** Le serveur ne trie pas les noms : un visiteur dont l'identifiant vaut `__proto__`, `constructor` ou `prototype` est relayé comme les autres, dans les instantanés de présence comme par `cursorsPackage` et `followPackage` (`__proto__` y reste une clé comme une autre, jamais le prototype d'un objet du serveur). Le navigateur trie, une seule fois, au plus près de son état : le magasin de `presence()` refuse ces trois noms, et `*cursors` comme `*follow` ne dessinent que les visiteurs que tient la présence du salon : un tel curseur n'apparaît pas (l'effet ne touche au prototype d'aucun objet). Si vos identifiants viennent d'un choix de l'utilisateur (un pseudo), refusez ces trois noms à l'inscription.

| `cursorsPackage(opts)` | Défaut | Rôle |
|---|---|---|
| `prefix` | `'cursors:'` | le préfixe des salons |
| `rateLimit` | `{ rate: 30, burst: 60 }` | trames par seconde et par visiteur, dans un salon — au-delà, la trame est ignorée (un curseur en retard vaut mieux qu'une erreur) |
| `canJoin` | — | une garde réévaluée à chaque trame, même contrat que celle du chat ([26 · Chat](26-chat.md)) |
| `groupFrom` | `100` | à partir de combien de membres un salon reçoit ses positions regroupées (`cursors:moves`, quatre fois par seconde) |

**Un paquet oublié.** Si le serveur n'a pas le paquet d'un effet (`cursorsPackage`, `followPackage`, `reactionsPackage`, `heatmapPackage`), il répond « type inconnu » aux messages de l'effet ; l'effet le dit une fois dans la console du navigateur, avec la ligne à ajouter (`app.use(cursorsPackage())` ; `app.use(followPackage({ canLead: (client) => … }))` pour le suivi d'écran, qui dit qui peut mener ; `app.use(heatmapPackage({ origins: ['https://monsite.fr'] }))` pour la carte de chaleur), au lieu de ne rien faire.

### 4.3 Les réactions — `reactionsPackage()`

L'effet `*react` fait monter les émojis des visiteurs chez tous, comme pendant un direct (cf. [38 · Effets](38-effets.md)) : la scène (`<@document *react>`, ou une zone `*react(stage: true)`) prend la connexion de sa variable (`@sock` du composant, ou `sock: $$sock`), les boutons `*react(🎉)` lancent leur émoji par elle. Côté serveur :

```civet
import { mjsWs, reactionsPackage } from 'modularjs-framework/ws'
app.use(reactionsPackage())
```

Chaque page est un salon `reactions:<nom>`. Le serveur relaie l'émoji aux **autres** membres, avec l'identité de celui qui l'a lancé (`from`, jamais reçue du client) ; un émoji est un texte court, sans balise ni caractère de contrôle.

| `reactionsPackage(opts)` | Défaut | Rôle |
|---|---|---|
| `prefix` | `'reactions:'` | le préfixe des salons |
| `rateLimit` | `{ rate: 5, burst: 10 }` | émojis par seconde et par visiteur, dans un salon — au-delà, ignorés (le navigateur a sa propre limite, le réglage `rate` de l'effet : 5 par seconde) |
| `emojis` | — | la liste des émojis permis, texte compris (sans elle : tout pictogramme — émoji, drapeau, touche —, jamais de texte : un visiteur n'écrit pas à toute la page) |
| `canJoin` | — | une garde réévaluée à chaque émoji, même contrat que celle du chat |

### 4.4 Suivre celui qui mène — `followPackage()`

L'effet `*follow` : l'écran du public suit le défilement de celui qui mène (un cours, une démo). Le serveur relaie la position (la balise en haut de l'écran, et où elle est coupée — rien d'autre) et garde la dernière, qu'un retardataire reçoit en arrivant — sauf si le salon s'était vidé entre-temps : le premier arrivé du cours suivant ne saute pas à la fin du précédent. Il relaie aussi ce que montre celui qui mène (`follow:cursor`, tout par défaut ; `*follow(cursor, selection, focus)` le règle) : sa souris et sa sélection (même format que `*cursors`), la balise active (un chemin, comme la position) et le compte de ses clics (quand il monte, une onde bat chez ceux qui suivent) — dans un seul sens : seul qui peut mener est rediffusé. **Personne ne mène par défaut** : `canLead` dit qui, parmi les membres du salon (`canLead: () => true` pour tout membre) ; sans elle, le serveur ne relaie ni position ni souris.

```civet
import { mjsWs, followPackage } from 'modularjs-framework/ws'
app.use(followPackage({ canLead: (client) => client.identity?.role is 'prof' }))
```

| `followPackage(opts)` | Défaut | Rôle |
|---|---|---|
| `prefix` | `'follow:'` | le préfixe des salons |
| `rateLimit` | `{ rate: 20, burst: 40 }` | positions par seconde et par visiteur (la souris a son propre débit : 30 par seconde) |
| `canLead` | — (personne) | qui peut mener, parmi les membres du salon — sync ou async, `true` pour mener ; sans elle, personne ne mène |

### 4.5 La carte de chaleur — `heatmapPackage()`

L'effet `*heatmap` envoie chaque clic — ou l'événement choisi (`on: mousemove`…) : l'adresse de la page (son chemin et sa route `#/…` telle quelle, sans requête ni ancre ; un segment qui ressemble à un jeton ou à une donnée personnelle part remplacé par `_SECRET_ID_` : UUID, JWT, e-mail, numéro de 6 chiffres ou plus, même écrit en groupes séparés par des tirets, des points ou des espaces, avec un `+` en tête (`06-12-34-56-78`, `555.123.4567`, `+33 6 12 34 56 78` ; une date reste en clair : `2024-10-20`, `20.10.2024`, `2024-10` ; une suite d'années ou un numéro de version de 6 chiffres ou plus se masque : `2023-2024`, `120.0.6099.109`), hexadécimal de 8 caractères ou plus, 16 caractères ou plus de lettres, de chiffres, de `-` et de `_` quels qu'ils soient (sans chiffre, en lettres seules, avec un tiret : `dTpkbjlZy_NTPKpx`, `xkqzvbnmwrtplkjhgfds`), base64 de 20 caractères ou plus ; l'extension d'un fichier reste (`_SECRET_ID_.pdf`), et la valeur d'un paramètre de chemin aussi est jugée, son nom séparément (`;jsessionid=_SECRET_ID_`, ou `;_SECRET_ID_=_SECRET_ID_` quand le nom est lui aussi un jeton). Un nom qui se lit reste en clair : un slug à tirets (des mots en minuscules, dont un seul nom de marque ou mot rare de 10 lettres au plus : `github-actions-workflow`, `postgresql-performance-tips` ; au-delà, ou entre des `_`, rien ne le distingue d'un jeton tiré au hasard : `jsonwebtoken-explained`, `mon_projet_nodejs` se masquent), des mots prononçables, des mots courts et quelques sigles (un mot court qui ne se prononce pas : `php`, `vs`, `json` — moins d'un cinquième du segment, et un sigle de 4 lettres veut à côté un mot de 5 lettres ou plus, ou un nombre : `comment-installer-php-8`, `api-v2-rest-json-guide` ; une clé de licence, des groupes de lettres tirées au hasard, se masque : `xxxx-xxxx-xxxx-xxxx` ; toute clé de trois groupes ou plus de 4 à 6 lettres ou chiffres, tous de la même longueur, séparés par `-` ou `_`, en capitales comme en minuscules, seule ou au bout du segment derrière des mots, aussi (`xxxxx-xxxxx-xxxxx-xxxxx`, `XXXX_XXXX_XXXX_XXXX`, `key-xxxxx-xxxxx-xxxxx`, `order-1234-5678-9012`) : avec un chiffre, quelle que soit sa longueur (`1234-5678-9012`) ; de lettres, elle ne reste en clair qu'en quatre mots ou plus qui se prononcent, de deux voyelles au moins chacun (`salut-monde-pomme-poire`), et trois mots de même longueur se masquent même quand ils se lisent (`react-hooks-guide`) — un tirage au hasard s'y lirait trop souvent ; par prudence, un slug qui finit ainsi se masque aussi (`the-black-white-photo`, `how-to-make-your-site-fast`, `2024-best-tips`, `best-apps-2024` : mesuré sur des titres de blog qui finissent par une année, 14 sur 100 se masquent), et trois mots de 4 lettres seuls se lisent comme un slug, chaque mot prononçable (`best-food-ever` reste, `html-form-tips` se masque) ; un code court tiré au hasard, de trois groupes ou plus de 3 à 6 lettres ou chiffres de longueurs inégales, où une lettre touche un chiffre, se masque quand il ne se lit pas (`A7K2-9QXB4M-P3Z`, `c6h-suf-px7-hnh` ; `ps5-pro-review`, `rtx-4090-test` restent)), des dates compactes, des noms de fichier d'appareil photo (`Samsung_Galaxy_S23_Ultra`, `bootstrap5components`, `IMG20241003123456.jpg`, `20241003T101500Z`), et un hexadécimal de 9 à 11 caractères en forme de mot (`added2023`, `face2face`) ; un hexadécimal de 8 caractères reste masqué même quand il se lit (`abc12345`), et un seul mot de 16 lettres ou plus, sans tiret ni chiffre (`abcdefghijklmnop`), aussi : rien ne le distingue d'un jeton de lettres. Le serveur applique la même règle à ce qu'il reçoit : un jeton qu'un client enverrait en clair ne reste jamais), l'événement, la place du point dans la page et dans chaque composant qu'il traverse — rien d'autre (ni texte, ni identité) : ni jeton ni e-mail n'arrive sur la page d'admin. Les points qui attendent la connexion partent à son ouverture, même quand l'effet a été retiré entre-temps (dans les 10 secondes). Le serveur garde les points jusqu'à leur âge limite, sous des plafonds de sécurité (un script qui inventerait des adresses et des zones ne fait pas tomber le serveur temps réel, et ne fige pas vos vraies pages : au plafond, la moins récente part). Il dessine la carte :

```civet
import { mjsWs, heatmapPackage } from 'modularjs-framework/ws'
app.use(heatmapPackage({ origins: ['https://monsite.fr'], maxAge: 30, unit: 'day', file: 'heatmap.json' }))
```

- **La page d'admin** : `GET /heatmap` sur le pont (§7) — chaque page vue (son adresse, en direct dans un cadre), la chaleur par-dessus, et un choix de zone et d'événement : la page entière ou un composant, les clics ou les mouvements. Mêmes règles d'accès que `/state` (§10.2) : libre quand le pont écoute en local, signée sinon. `GET /heatmap.json` : les mêmes données ; `app.heatmap()` : dans votre code.
- **`origins` (obligatoire)** : les origines de vos pages (`https://monsite.fr`, sans chemin). Une trame dont l'en-tête Origin n'est pas dans la liste est écartée, et une connexion sans en-tête Origin (un script, pas un navigateur) ne compte pas : personne ne remplit votre carte avec d'autres adresses. Sans `origins`, le paquet refuse de démarrer, avec un message qui donne l'exemple. La page d'admin charge l'adresse gardée dans un cadre : une page dont un segment est devenu `_SECRET_ID_` s'y affiche sans son contenu.
- **Les points partent par lots.** Un point part tout de suite quand la connexion est ouverte et que la part des effets en direct le permet (`effects.rate`, 4 trames par seconde pour tous les effets de la page) ; sinon il attend, et ceux qui le suivent le rejoignent dans une même trame (20 points au plus attendent, les plus anciens s'oublient au-delà ; le serveur en prend 50 par trame, un jeton de débit par point). La connexion étant paresseuse, le premier point qui attend la fait ouvrir, sauf si l'appli l'a fermée, et part quand elle est ouverte.
- **Où c'est gardé** : dans la mémoire du processus du serveur temps réel. `file: 'heatmap.json'` la garde d'un redémarrage à l'autre : le fichier est relu au démarrage, écrit chaque minute s'il y a du nouveau, et à l'arrêt (`app.stop()`, fin du processus, `systemctl stop`) — rien à installer. Écrit d'un coup (jamais à moitié) ; un fichier illisible est mis de côté (`heatmap.json.bad-<date>`), jamais écrasé, et la carte repart de zéro. Les fichiers temporaires d'une écriture interrompue sont purgés au démarrage, et une page dont l'adresse n'est pas http(s), d'une origine absente de `origins`, au-delà de `maxPages` ou dont les zones dépassent `maxZones` est écartée à la relecture, seule (le journal le dit) : la relecture suit les mêmes bornes que la réception. Un seul processus par fichier : avec plusieurs serveurs, `onPoint` range chaque point dans une base.
- **La mémoire** grandit avec le trafic, jusqu'à l'âge limite et sous trois plafonds de sécurité : `maxPoints` (1 000 000 points en tout, de 85 à 190 octets chacun selon la variété des adresses et des zones — jusqu'à environ 190 Mo : au-delà, les plus anciens partent), `maxPages` (1 000 adresses) et `maxZones` (64 zones par page) — au-delà, la page (ou la zone de la page) la moins récente, celle dont le dernier point est le plus ancien, part pour faire place à la nouvelle : un script qui remplirait la carte d'adresses inventées ne fige pas vos vraies pages, elles reviennent dès qu'on les visite. Sur un site très fréquenté, un `maxAge` court (quelques heures pour `mousemove`), ou `onPoint` qui garde aussi les points dans une base.
- **Ne pas se compter soi-même** : `exclude: { ips: ['…'], accounts: ['…'] }` écarte les points de ces IP (celle de la connexion, ou la première de `X-Forwarded-For` derrière un proxy) et de ces comptes (l'`id` de l'identité rendue par `auth`), **à la capture** : ils n'entrent jamais dans la carte. Une fonction `exclude: (client) => …` décide au cas par cas.
- **La page d'admin** a un curseur « les plus récents » : de tous les points au seul dernier, avec la date du plus ancien affiché. Chaque point garde son heure (`ts` dans `GET /heatmap.json`).

| `heatmapPackage(opts)` | Défaut | Rôle |
|---|---|---|
| `maxAge` | `7` | l'âge au-delà duquel un point est effacé, en `unit` ; une page sans point part |
| `unit` | `'day'` | l'unité de `maxAge` : `second`, `minute`, `hour`, `day`, `week`, `month` (30 jours), `year` (365) |
| `origins` | — (obligatoire) | les origines de vos pages, sans chemin : une trame d'une autre origine est écartée |
| `rateLimit` | `{ rate: 10, burst: 20 }` | points par seconde et par connexion (dix au plus pour tous les `*heatmap` d'une même connexion, qui se les partagent, dans la part des effets en direct : quatre trames par seconde à eux tous par défaut ; une trame porte plusieurs points quand elle a attendu) |
| `addressRateLimit` | `{ rate: 100, burst: 200 }` | points par seconde et par adresse IP (une IPv6 compte pour son préfixe `/56`), que se partagent toutes les connexions de l'adresse — au-delà, ignorés : un script qui ouvre 100 connexions ne multiplie plus son débit par 100. Les visiteurs d'une même adresse (une entreprise, une école, derrière un proxy sans `trustProxy`) se partagent ce débit ; `false` : le seau de la connexion seul. Un nombre plus grand que 0, sinon `heatmapPackage()` lève une erreur qui nomme le réglage |
| `exclude` | — | des IP et des comptes qui ne comptent pas, ou une fonction `(client) => true` qui écarte — à la capture |
| `onPoint` | — | chaque point reçu, vérifié, avant les plafonds de mémoire — pour le garder ailleurs (une base) |
| `file` | — | un fichier où garder les points d'un redémarrage à l'autre (relatif au dossier de lancement) : relu au démarrage, écrit chaque `saveEvery` et à l'arrêt ; les fichiers temporaires d'une écriture interrompue sont purgés au démarrage |
| `saveEvery` | `60000` | l'écriture régulière de `file`, en millisecondes — seulement s'il y a du nouveau |
| `maxPoints` | `1000000` | plafond de sécurité : les points gardés en tout — au-delà, les plus anciens partent ; un entier plus grand que 0, sinon `heatmapPackage()` lève une erreur qui nomme l'option |
| `maxPages` | `1000` | plafond de sécurité : les adresses gardées — au-delà, la moins récente part pour la nouvelle ; un entier plus grand que 0, sinon `heatmapPackage()` lève une erreur qui nomme l'option |
| `maxZones` | `64` | plafond de sécurité : les zones (par événement) d'une page — au-delà, la moins récente de la page part pour la nouvelle ; un entier plus grand que 0, sinon `heatmapPackage()` lève une erreur qui nomme l'option |

---

<a id="flux"></a>
### 4.6 Un effet à la réponse — `on: success`, `on: error`

Chaque demande d'un client reçoit sa réponse de `.serve()` : « ok » (la promesse de `request()` tient parole) ou une erreur (elle est rejetée). Un effet réglé `on: success` ou `on: error` sur la balise qui envoie la demande se joue à cette réponse, sans rien poser de plus côté serveur :

```html
<button *confetti(on: success) *shake(on: error) @click={µsocket(url).request('vote', { choix: 2 })}>Voter</button>
```

Une écriture `µ.optimistic` aussi : refusée par le serveur, elle revient en arrière et joue `on: error`. Détails : [38 · Effets](38-effets.md), « Réussite et échec ».

## 5. Les flux qui se rattrapent — `app.stream`

Côté client, `sock.stream('ennemis')` est un store réactif alimenté par deltas numérotés ([20 · Temps réel §4](20-temps-reel.md)). Côté serveur, `app.stream('ennemis')` est la **source** de ce flux : un état courant (clé → valeur) dont chaque mutation est **numérotée** (`seq` strictement croissant, propre au flux), **diffusée** aux abonnés et **journalisée**.

```js
const ennemis = app.stream('ennemis', { public: true, journal: 200 })   // ouvert à tous ; garde les 200 derniers deltas (défaut)

ennemis.add('e1', { x: 10, y: 20 })      // delta {op:'add'} → seq++, diffusé + au journal
ennemis.update('e1', { x: 11 })          // fusion 1 niveau (y conservé), comme côté client
ennemis.remove('e1')
ennemis.reset({ e9: { x: 0, y: 0 } })    // remplacement COMPLET — nouvelle époque, journal vidé
ennemis.size                             // nombre d'éléments courants
ennemis.snapshot()                       // photo { clé → valeur } de l'état courant
ennemis.destroy()                        // retire le flux du registre — plus JAMAIS itéré (cf. note ci-dessous)
```

**`destroy()` — flux dynamiques (un par partie, par salon, par session…) :** un `app.stream(nom)` déclaré et jamais détruit reste en mémoire pour toujours (journal, abonnés, compteur `seq`) — pour un nom de flux **fixe** ce n'est jamais un problème, mais pour un flux créé **à la volée par identifiant** (`app.stream('partie-' + id)`), sans `destroy()` à la fin de sa vie utile, le registre grossit sans borne. Détruit, un flux redevient **exactement** comme s'il n'avait jamais existé : un `µ:sub-stream`/`µ:resync` ultérieur sur ce nom retombe sur le repli honnête (`reset` vide + `warn`). `destroy()` n'envoie rien aux abonnés courants — prévenez-les vous-même avant si besoin (dernier message applicatif) — et ils ne reçoivent plus rien ensuite. Une garde `canSubscribe` encore sans réponse n'y abonne plus personne : sa réponse est ignorée, et rien de ce flux ne reste en mémoire (ni abonnement, ni garde repassée qui attendait son tour). La poignée gardée n'agit plus : ses écritures (`add`, `update`, `remove`, `reset`) sont sans effet, sans exception (un avertissement dans `onLog`, une fois), et un second `destroy()` ne touche pas au flux recréé entre-temps sous le même nom ; pour servir ce nom de nouveau, déclarez-le (`app.stream(nom, { public: true })`, ou avec sa garde) et écrivez avec cette nouvelle poignée. Sans `adapter`, un flux déclaré après un `destroy()` numérote ses changements au-delà du plus grand numéro des flux détruits : un client resté sur l'ancien flux qui demande un rejeu (`µ:resync`) reçoit l'état complet du nouveau, jamais rien ni un rejeu mêlé à l'ancien état. Purement **local** : en cluster (§9), les autres process gardent leur propre état pour ce nom tant qu'ils ne le détruisent pas eux-mêmes chacun de leur côté. Détruit sur chaque process puis redéclaré, le flux reprend la numérotation là où l'ancien s'est arrêté (le compteur partagé de l'adaptateur continue d'un flux à l'autre) : le premier changement de la partie suivante passe sans attendre, et un client resté sur l'ancien flux qui demande un rejeu reçoit l'état complet du nouveau. Chaque process s'en souvient pour les 10 000 derniers flux détruits ; au-delà, le flux redéclaré repart comme un flux neuf : son premier changement peut attendre jusqu'à 2 secondes dans le tampon de réordonnancement (§9.3), avec un avertissement dans `onLog`, et un client resté sur l'ancien flux n'est pas recalé.

**Le principe, simplement :** le serveur numérote chaque changement (1, 2, 3…) et garde les `journal` derniers dans un carnet. Un client qui s'abonne (`µ:sub-stream`) reçoit d'abord une **photo complète** (`reset` au `seq` courant). Un client qui **décroche puis revient** annonce le dernier numéro qu'il a vu (`µ:resync { from }`) : si tout ce qu'il a raté est encore dans le carnet, le serveur **rejoue juste ces deltas-là**, dans l'ordre, **avec leurs numéros d'origine** — quelques dizaines d'octets au lieu d'une photo. S'il a raté plus que le carnet n'en garde, photo complète. S'il n'a rien raté, **rien** — pas un octet.

| Situation au `µ:resync { from }` | Réponse du serveur |
|---|---|
| Tous les deltas `from+1 … seq` sont au journal | **Rejeu** de ces deltas, seq d'origine (le client dédoublonne déjà tout `seq` ≤ dernier vu — rejouer avec les numéros d'origine est ce qui rend l'opération sûre même en cas de doublon). |
| Trou plus large que le journal, ou `reset` survenu entre-temps | `reset` complet au `seq` courant. |
| `from` = `seq` courant | Rien — le client est à jour. |
| `from` > `seq` courant (serveur redémarré, compteur reparti) | `reset` complet — le client raccroche à la nouvelle époque. |

**`reset()` = nouvelle époque.** Le remplacement complet vide le journal : aucun rejeu ne traversera jamais un `reset` (les deltas d'avant décrivent un monde qui n'existe plus). Le client, lui, accepte un `reset` à n'importe quel `seq` — c'est le point de re-synchronisation universel.

À savoir :

- Le rattrapage est **entièrement automatique** : le client détecte les trous en cours de flux et redemande, et après une reconnexion il envoie `µ:resync { from: dernierSeq }` de lui-même pour tout flux déjà entamé. Rien à coder, d'aucun côté.
- Les abonnements sont nettoyés à la déconnexion — pas de fantômes qui gonflent la diffusion.
- Un `µ:sub-stream` vers un flux **jamais déclaré** par l'application répond honnêtement un `reset` vide (`seq: 0`) + un `warn` dans `onLog`, sans créer d'abonnement : déclarez vos flux côté serveur (`app.stream(nom)`), c'est lui la source. Un nom inconnu de plus de 200 caractères (la borne des noms de salon) reçoit à la place un `µ:error` court (« nom de flux trop long »), sans son nom : la réponse ne renvoie jamais au client les 60 Ko qu'il a envoyés.
- Ces avertissements (flux inconnu, accès refusé, flux du pont non déclaré) sont regroupés : une ligne au plus par minute et par motif, le nom envoyé par le client tronqué à 200 caractères ; la ligne suivante dit combien de demandes semblables ont été tues. Une rafale de demandes ne remplit donc pas votre journal.
- `journal` se règle par flux : gros trafic + clients qui décrochent souvent → carnet plus grand ; flux paisible → 200 par défaut suffit largement.

**`snapshot()` rend toutes les clés, noms réservés compris.** Le serveur ne trie pas les clés d'un flux, pas plus que les identités (§4.2) : une clé `__proto__`, `constructor` ou `prototype` écrite par votre code ou par le pont est rendue comme les autres, et `__proto__` est une clé **propre** de l'objet rendu, jamais son prototype. Recopié dans un objet ordinaire par `Object.assign({}, snap)` ou par une boucle `for…in` qui affecte `copie[k] = snap[k]`, il change le prototype de la copie au lieu d'y ranger la donnée : la copie hérite alors de la valeur rangée sous `__proto__`. Recopiez dans un objet sans prototype, dans une `Map`, ou lisez la clé chez elle :

```js
const snap  = ennemis.snapshot()
const copie = Object.assign(Object.create(null), snap)   // objet sans prototype : `__proto__` y reste une clé comme une autre
const index = new Map(Object.entries(snap))             // ou une Map
if (Object.hasOwn(snap, id)) afficher(snap[id])         // ou la clé lue chez elle, jamais un nom hérité
```

**Un flux est fermé par défaut** : déclaré sans accès (`app.stream('partie-42')`), il n'est servi à **personne** — chaque `µ:sub-stream`/`µ:resync` reçoit un `µ:error` (accès refusé), et `onLog` dit pourquoi. Pendant le développement (hors `NODE_ENV=production`), la déclaration d'un flux fermé l'annonce aussi dans `onLog`, une fois, avec la ligne à écrire. Ouvrez-le à tous avec `public: true`, ou réservez-le avec l'une des deux gardes, combinables (§4) : le sucre `room: 'nom'` (exige l'appartenance au salon du même nom) ou `canSubscribe(client, name)` (fonction sync ou async, refus sur `false`/throw, MÊME contrat que `rooms.join`). Une garde reste maîtresse : `public: true` n'ouvre qu'un flux sans garde. L'ouverture peut suivre une première poignée prise sans option (`app.stream(nom)` pour écrire, `app.stream(nom, { public: true })` ensuite) : le flux est ouvert dès qu'une déclaration l'ouvre.

```js
app.stream('scores', { public: true })                                                     // ouvert à tous les clients
app.stream('partie-42', { room: 'partie-42' })                                             // réservé aux membres du salon
app.stream('partie-42', { canSubscribe: (client) => app.room('partie-42').has(client) })   // même effet, en plus long
```

`canSubscribe` est lue à l'abonnement, puis repassée quand une appartenance qu'elle a lue à sa dernière réponse (`app.room(nom).has(client)`) change : la connexion quitte un salon qu'elle y a lu dedans, ou entre dans un salon qu'elle y a lu dehors (une garde « spectateurs seulement », `app.room('tribune').has(c) && !app.room('joueurs').has(c)`, est repassée quand la connexion entre dans « joueurs »). Elle l'est aussi quand un `µ:refresh` change l'identité de la connexion (§7.9). Jusqu'à sa réponse, rien du flux ne part vers la connexion (voir « Retenue » ci-dessous) ; refusée, elle ne reçoit plus rien du flux. Le départ d'un autre salon, ou l'entrée dans un salon qu'elle n'a pas lu, ne la rappelle pas : une garde qui interroge votre base ou votre back n'est pas sollicitée à chaque `µ:join` ou `µ:leave`. Une connexion qui sort et rentre sans cesse du salon lu ne la fait pas appeler à chaque départ non plus : une seule vérification en vol par connexion et par flux (un départ pendant qu'elle attend sa réponse compte aussi, et sera vérifié après elle), deux d'avance puis une par seconde.

**Une seule règle pour toutes les réponses de la garde** — abonnement (`µ:sub-stream`, `µ:resync`), flux rendu au retour, garde posée après coup, vérification au départ ou au retour. Une réponse ne s'applique que si chaque salon qu'elle a lu est encore, à son arrivée, tel qu'elle l'a lu (la connexion toujours dedans, ou toujours dehors), et si elle vient de la dernière évaluation de la garde lancée pour cette connexion et ce flux ; un « oui » ne couvre pas non plus le départ d'un salon qu'il a lu, survenu avant son arrivée, même suivi d'un retour. Sinon la garde est repassée, au même rythme, et rien du flux ne part vers la connexion en attendant — un refus comme un « oui » : une garde asynchrone qui a lu un salon avant que la connexion n'y entre, et qui répond après son entrée, est repassée, et ce refus ne l'écarte pas. Une demande que `room` ou une garde synchrone traite avant le `µ:join` est, elle, refusée sur-le-champ (`µ:error`) : le client du framework entre donc dans ses salons avant de demander leurs flux, à la première connexion comme à chaque reconnexion ; une fois connecté, appelez `sock.room(nom)` avant `sock.stream(…)`. Une réponse dépassée par une évaluation plus récente (demande, redemande, garde posée après coup, vérification) est ignorée, quel que soit l'ordre d'arrivée des réponses, « oui » comme « non » : ni `µ:error`, ni état, ni delta. Ce qu'elle devait servir n'est pas perdu pour autant : la réponse qui s'applique sert toutes les demandes encore en attente, l'état complet pour un `µ:sub-stream`, le rejeu pour un `µ:resync`, même quand c'est la vérification d'un départ qui la donne. Une demande refusée reçoit un `µ:error` ; une connexion qui suivait déjà le flux et dont la redemande est refusée le perd : le `µ:error`, puis plus aucun delta ni rejeu.

**Retenue.** Quand une évaluation part alors que la précédente attend encore sa réponse, la connexion qui suivait le flux n'en reçoit plus rien jusqu'à la réponse de la dernière ; un « oui » lui rend ce qu'elle a manqué. Une garde qui ne répond jamais la retient ainsi jusqu'à sa déconnexion, sans erreur ni délai de notre part : donnez un délai à vos appels au back (un refus à son terme vaut mieux qu'une attente sans fin). De même, au départ d'un salon que la garde a lu, à l'entrée dans un salon qu'elle a lu en l'absence de la connexion, et après un `µ:refresh` qui change son identité, la connexion est retenue jusqu'à la réponse de la vérification, même d'une garde asynchrone, même différée faute de jeton : un « oui » lui rend ce qu'elle a manqué. Retenue après un départ ou une entrée, la connexion reçoit de nouveau si elle revient dans chaque salon que la réponse qui l'a abonnée a lu dedans, et reste hors de ceux qu'elle a lus dehors, avant qu'aucun delta ne lui ait été retenu : revenir dans un seul de ces salons ne suffit pas. Sinon, ce qu'elle a manqué lui est rejoué si la garde l'accepte. Refusée au départ alors qu'elle est hors du salon quitté, elle est écartée en silence : elle retrouve le flux à son retour dans ce salon, ou en entrant dans un autre salon que ce refus a lu en son absence (la garde est repassée au même rythme, un refus reçoit alors un `µ:error`) ; revenue dans le salon quitté avant le refus, elle reçoit le `µ:error`. Refusée par la vérification d'une entrée ou d'un changement d'identité, elle reçoit aussi un `µ:error`. Revenue dans le salon juste après un refus, elle peut attendre jusqu'à une seconde son état complet. `room` est en plus contrôlé à chaque envoi. Une garde qui lit l'appartenance autrement (votre propre registre de joueurs…) n'est pas repassée au départ : pour un flux réservé à un salon, préférez `room`.

**La garde tient quel que soit l'ordre.** Un flux peut exister avant que votre code le déclare avec sa garde : créé par `POST /stream` du pont (§7), par un premier `app.stream(nom)` sans garde, ou par le delta d'un autre process (§9.3). `app.stream(nom, { canSubscribe | room })` pose alors la garde sur ce flux, et les connexions déjà abonnées la repassent : jusqu'à sa réponse, elles ne reçoivent plus rien du flux ; un refusé reçoit un `µ:error` et plus aucun delta, un accepté ce qu'il a manqué. Comme pour un abonnement, le « oui » d'une garde asynchrone qui a lu un salon que la connexion quitte avant sa réponse ne compte pas : la garde est repassée, au même rythme, et la connexion ne reçoit plus rien du flux en attendant ; sur un « oui », l'état complet (`reset`) puis les deltas. Une règle déjà posée reste celle de la première déclaration (comme `journal`). Un flux créé par le pont n'est servi à **personne** tant que votre code ne l'a pas déclaré (`app.stream(nom, { public: true })` s'il est public, avec sa garde sinon) : chaque demande reçoit un `µ:error`, et `onLog` vous dit quelle déclaration manque.

**Quitter un salon, y revenir.** Une connexion qui quitte le salon (`µ:leave`, `kick`, déconnexion) est désabonnée sur-le-champ des flux réservés à ce salon (`room`), comme de ceux dont la garde `canSubscribe` la refuse désormais ; chaque envoi d'un flux `room` contrôle encore l'appartenance. Revenue dans le salon (`µ:join` accepté), elle retrouve ces flux sans rien redemander : l'état complet (`reset`), puis les deltas — la garde est repassée au même rythme qu'au départ (deux d'avance puis une par seconde, par connexion et par flux, quel que soit leur nombre), un refus reçoit un `µ:error`. Une connexion qui sort et rentre sans cesse peut donc attendre jusqu'à une seconde son état complet ; repartie avant, elle le retrouve à son retour suivant. Deux exceptions. Un flux dont le nom commence par celui du salon suivi d'une barre (`partie-42/main`, le nom que donne `sock.room('partie-42').stream('main')`) n'est pas rendu par le serveur : le client du framework l'oublie en quittant le salon et le redemande lui-même s'il en a besoin (un seul état complet au retour, rien pour une vue qui ne le rouvre pas). La connexion en est donc désabonnée en quittant le salon, même s'il est public : plus aucun delta ne lui part. Un flux détruit (`destroy()`) pendant l'absence n'est pas rendu non plus : rien n'est envoyé ni journalisé, comme pour un flux qui n'a jamais existé. Et une connexion ne garde ces reprises que pour les 50 derniers salons quittés : revenue dans un salon plus ancien, elle redemande le flux (`µ:sub-stream`).

---

<a id="mjs-ws"></a>
## 6. Lancer le serveur — `mjs ws`

Le module `mjsWs` (§1-§5) est une **librairie** — il faut un peu de code pour le brancher et l'écouter. La commande `mjs ws` évite d'écrire ce code vous-même : elle charge un **fichier d'entry** (le vôtre), y branche les protections/logs/rechargement, et démarre.

```bash
mjs ws                        # ws.server.mjs ou ws.js (résolution complète : §6.2), port 4000 par défaut
mjs ws --entry serveur/temps-reel.js --port 4010
mjs ws --root chemin/vers/le/projet
```

### 6.1 Le fichier d'entry

Un module qui exporte, **en défaut**, un **objet** — les mêmes options que `mjsWs()` (§1), moins `transport`/`port`/`host`/`onLog` (réservées au CLI, cf. §6.3 — présentes quand même dans l'entry : ⚠️ un avertissement les signale, puis elles sont ignorées), plus une fonction `setup(app)` optionnelle (sync ou async), appelée juste après la création de l'app et juste **avant** `listen()` : c'est là que vous déclarez `serve()`/`on()`/`stream()`.

**Format recommandé — `ws.server.mjs`** (ou `server/ws.server.mjs`) : compilé avec le **même dialecte Civet** que le `<script>` de vos composants — assignations nues auto-déclarées, interpolation Coffee `"…#{x}…"`, `isnt`, flèches `->`, hash sans accolades. Le JS classique (`ws.js`/`ws.mjs`/`ws.cjs`, importé tel quel, sans aucune compilation) reste bien sûr accepté ; le Civet **brut** (`ws.civet`, sans les pré-passes ci-dessous) reste une variante documentée (§13).

Exemple minimal complet — auth, un salon, un flux, et `setup`, en `ws.server.mjs` :

```civet
// ws.server.mjs — fichier d'entry du serveur temps réel (mjs ws), dialecte Civet des composants
@import soldeMax 'limites.civet'

export default {
  // auth/welcome/rooms/heartbeat/limits : mêmes options que mjsWs() (§1).
  auth: (hello)->
    return false unless hello.auth?.token is process.env.SECRET
    { id: hello.auth.userId, pseudo: hello.auth.pseudo }

  welcome: (client)-> { serverTime: Date.now(), userId: client.identity.id }

  rooms: {
    join: (room, client)-> room isnt 'vip' or client.identity.admin
    meta: (client)-> { pseudo: client.identity.pseudo }
  }

  setup: (app)->
    app.serve 'achat', (p, client)->
      throw new Error('solde insuffisant') if p.prix > soldeMax
      { solde: soldeMax - p.prix }

    app.on 'chat', (p, client)-> app.broadcast('chat', p, { except: client })

    ennemis = app.stream('ennemis', { public: true })
    ennemis.add('e1', { x: 10, y: 20 })
}
```

`@import soldeMax 'limites.civet'` importe une constante d'un fichier voisin (`limites.civet` à côté de l'entry) — la SEULE directive qui a un sens dans un fichier serveur, détaillée en §13.2 : un chemin relatif, un paquet npm, ou `node:*`, jamais autre chose.

> **Pourquoi un format dédié — les 3 pièges du Civet brut.** Un `.civet` ordinaire (§13) est compilé par le compilateur Civet **seul**, sans les pré-passes que le framework applique au `<script>` de vos composants — trois habitudes prises en composant y deviennent des pièges **silencieux** :
> 1. **Assignation nue** — `compteur = 0` ne déclare rien en Civet natif (seul `compteur := 0` déclare) → `ReferenceError: compteur is not defined` au chargement, à toute profondeur (top-level ou imbriquée dans une fonction).
> 2. **Interpolation Coffee** — `"salut-#{nom}"` reste un **littéral** : la chaîne envoyée contient `#{nom}` mot pour mot, jamais la valeur de `nom`.
> 3. **`isnt`** — Civet ne le connaît pas nativement : `a isnt b` se lit comme l'appel `a(isnt(b))` → crash.
>
> `ws.server.mjs` applique exactement les mêmes pré-passes que vos composants (assignations auto-déclarées, interpolation traduite en template literal, `isnt` traduit en `!==`…) — le code s'y comporte comme dans un `<script>`, sans surprise.

Un `.server.mjs` qui contient du **markup** de composant (`<template>`, `<style>`, une balise HTML en tête de fichier) est refusé avec une erreur claire dès la lecture — ce n'est pas un composant, juste du Civet/JS.

Si le default export est absent ou n'est pas un objet, `mjs ws` refuse de démarrer avec une erreur claire. Si **aucun** fichier d'entry n'est trouvé (cf. résolution ci-dessous), l'erreur imprime directement un squelette minimal à copier-coller pour démarrer.

### 6.2 Résolution de l'entry

| Source | Priorité |
|---|---|
| `--entry <chemin>` | 1 — toujours respecté tel quel ; erreur immédiate si le fichier n'existe pas (aucun repli sur la suite) |
| `ws.entry` (mjs.config.json) | 2 — même règle : erreur immédiate si absent |
| `ws.server.mjs` (racine du projet) | 3 — format **recommandé**, cf. §6.1 |
| `server/ws.server.mjs` | 4 |
| `ws.js` (racine du projet) | 5 |
| `ws.civet` (racine du projet) | 6 — cf. §13 « Écrire son fichier serveur — le dialecte de vos composants » |
| `server/ws.js` | 7 |
| `server/ws.civet` | 8 |

Les chemins se lisent depuis le dossier de `mjs.config.json` (à défaut `--root`, puis le répertoire courant) ; `--entry` depuis `--root` s'il est donné, sinon depuis le répertoire courant. Le premier trouvé dans cet ordre gagne : un `ws.server.mjs` prime donc **toujours** sur un `ws.js`/`ws.civet` du même dossier, eux-mêmes prioritaires sur tout ce qui vit dans `server/`. Un `--entry` pointant explicitement vers un `.server.mjs` (même hors des noms par défaut ci-dessus) suit exactement le même chemin de compilation.

### 6.3 Configuration — section `ws` de mjs.config.json

```json
{
  "ws": {
    "entry": "server/ws.server.mjs",
    "port": 4001,
    "host": "::",
    "heartbeat": 20000,
    "limits": { "rate": 60, "burst": 120 }
  }
}
```

| Clé | Type | Rôle |
|---|---|---|
| `entry` | chaîne | cf. §6.2 |
| `transport` | `'ws'` \| `'uws'` | cf. §12 « La façade transport » — une **instance** maison ne se met **que** dans l'entry (pas représentable en JSON), qui prime alors sur cette clé (cf. §6.4) |
| `port` | entier 1-65535 | port du serveur — priorité `--port` > `ws.port` > `4000` |
| `host` | chaîne | host du transport `ws` — défaut `127.0.0.1` (loopback, MÊME défaut que le pont §7) ; `--host ::` (ou `ws.host: "::"`) pour exposer sur toutes les interfaces |
| `codec` | `'auto'` \| `'binary'` \| `'json'` | cf. §3.1 « µschema » — définissable **ici** **ou** dans l'entry (cf. §6.4). **Pas** de pendant pour `schemas` : `list()`/`bits()` ne sont pas représentables en JSON, réservé à l'entry. |
| `heartbeat` | entier > 0 (ms) | cf. §1 — définissable **ici** **ou** dans l'entry (cf. §6.4) |
| `limits` | objet `{ rate?, burst?, kickAfter?, maxPayload?, maxBuffered?, … }` (entiers > 0 ; `rateBy` : `'connection'` \| `'account'` \| `'ip'` \| `'both'`) | cf. §3 — définissable **ici** **ou** dans l'entry (cf. §6.4) |
| `resume` | `true`, `false` ou objet `{ grace?, maxBuffered?, maxBytes? }` (entiers > 0) | reprise de session, cf. §8 — définissable **ici** **ou** dans l'entry (cf. §6.4). Actif : la bannière de `mjs ws` affiche « reprise de session : 30 s ». |
| `sessionExclusive` | booléen \| `'replace'` \| `'refuse'` | session exclusive par identité, **deux** modes, cf. §8.5 — définissable **ici** **ou** dans l'entry (cf. §6.4). |
| `verifyOrigin` | tableau de chaînes non vide | allowlist stricte d'origines exactes, cf. §1/§3.3 « Vérification d'origine » — **seule** la forme tableau est représentable en JSON (la forme fonction reste réservée à l'entry) — définissable **ici** **ou** dans l'entry (cf. §6.4). |
| `ban` | `true`, `false` ou objet `{ after?, within?, duration?, by? }` (entiers > 0 ; `by` : `'account'` \| `'ip'` \| `'both'`) | mise au banc, cf. §3.4 — active par défaut ; définissable **ici** **ou** dans l'entry (cf. §6.4). |

Validation stricte, comme le reste de `mjs.config.json` : une clé inconnue (dans `ws`, `ws.limits`, `ws.resume` ou `ws.ban`) lève une erreur avec une suggestion orthographique sur les fautes de frappe ; un type ou une plage invalide lève immédiatement, sans jamais démarrer sur une valeur bancale.

### 6.4 Qui décide, en cas de doublon ?

- **Port** : `--port` > `ws.port` (config) > `4000`.
- **Host** : `--host` > `ws.host` (config) > `127.0.0.1` (défaut, loopback — MÊME règle que le pont §7). Qui veut exposer le serveur le dit explicitement avec `--host ::`.
- **Transport / codec / heartbeat / limits / resume / bridge / verifyOrigin** : définissables dans l'entry ET dans `ws.*` — s'ils sont posés **aux deux endroits**, l'entry prime EN **bloc** (le code de l'appli l'emporte sur la config globale) et un avertissement vous le signale, pour ne jamais laisser un doublon passer inaperçu. Cas particulier de `transport` : la config ne peut exprimer qu'une **chaîne** (`'ws'`/`'uws'`, seule forme représentable en JSON) — une **instance** maison (§12) ne peut venir **que** de l'entry, qui prime alors systématiquement. Même limite pour `schemas` (§3.1) : `list()`/`bits()` ne sont pas représentables en JSON, réservé à l'entry (`app.schema(...)` dans `setup(app)`). Même limite pour `verifyOrigin` : la config ne peut exprimer qu'un **tableau** (allowlist), la forme fonction ne peut venir **que** de l'entry.

### 6.5 Rechargement à chaud

Dès qu'un fichier `.js`/`.mjs`/`.cjs`/`.json` change dans le **dossier** de l'entry, le serveur se recharge tout seul — pas besoin de le relancer à la main pendant que vous développez.

**Le principe, simplement :** à chaque changement détecté (fenêtre de 150 ms — plusieurs sauvegardes rapprochées ne déclenchent qu'UN seul rechargement), `mjs ws` réimporte l'entry **avant** de toucher au serveur en cours. Si le nouveau code a une erreur de syntaxe (ou lève à l'import), l'erreur est affichée et l'**ancien** serveur continue de tourner exactement comme avant — zéro coupure, aucune connexion perdue. C'est seulement si le nouveau code s'importe sans problème que l'ancien serveur s'arrête proprement (`µ:bye` à ses clients, cf. §2) et que le nouveau prend sa place, sur le même port.

À savoir :

- La surveillance porte sur le **dossier** de l'entry, À **plat** (pas les sous-dossiers) — et elle ne regarde que le dossier, pas les imports : un fichier `.js`/`.mjs`/`.cjs`/`.json` qui change dans ce dossier déclenche un rechargement même s'il n'a rien à voir avec l'entry.
- À l'inverse — limite **assumée** — un fichier importé **par** l'entry mais rangé EN **dehors** de son dossier n'est **pas** surveillé : gardez votre entry et ses dépendances proches les unes des autres si vous comptez sur le rechargement à chaud.
- Le rechargement réimporte l'**entry** elle-même à chaque fois ; les imports internes DE l'entry (vers d'autres modules) suivent le cache habituel de Node — un module annexe importé par l'entry n'est vraiment rafraîchi que si l'entry elle-même est réimportée après son propre changement.

### 6.6 Arrêt propre

`Ctrl-C` (**sigint**) ou un **sigterm** envoyé au process : le serveur prévient tous ses clients (`µ:bye`), ferme proprement ses connexions puis son transport, et quitte — 20 s au plus. Un 2ᵉ `Ctrl-C` plus d'une seconde après le premier coupe tout de suite (détail : [32 · CLI](32-cli-et-configuration.md#arrêter-un-serveur-ctrlc)).

### 6.7 Flags

| Flag | Rôle |
|---|---|
| `--entry <chemin>` | force le fichier d'entry (prioritaire sur tout, cf. §6.2) |
| `--port <n>` | force le port (prioritaire sur `ws.port`, cf. §6.4) |
| `--root <dir>` | dossier de départ (défaut : répertoire courant) : `mjs.config.json` y est cherché, puis dans les dossiers parents ; `ws.entry` et les noms par défaut se lisent depuis le dossier de ce fichier (à défaut, depuis `--root`), `--entry` depuis `--root` (cf. §6.2) |

Un entry qui déclare `app.game(...)` (salle de partie) veut la commande **sœur** `mjs serveur` — **même** contrat, résolution d'entry et rechargement à chaud, mais construite via `mjsServer()` : cf. [24 · MJS-Server §2](24-mjs-server.md#demarrer).

### 6.8 En service systemd — le chien de garde

`Restart=always` relance un serveur qui s'est arrêté, pas un serveur gelé : une boucle d'événements bloquée par un calcul sans fin ne s'arrête jamais d'elle-même. Pour ce cas, systemd a son chien de garde, et `app.listen()` le sert sans réglage (`mjs ws` et `mjs serveur` aussi) : quand l'unité porte `WatchdogSec`, le serveur bat depuis sa boucle d'événements à la **moitié de la fenêtre** (`WatchdogSec=30` : un battement toutes les 15 s). Si la boucle gèle, les battements cessent, et systemd relance le service au bout de la fenêtre. Sans `WatchdogSec`, rien n'est armé.

```ini
[Service]
WorkingDirectory=/srv/mon-appli
ExecStart=/usr/bin/npx mjs ws
Restart=always
WatchdogSec=30
NotifyAccess=all
LimitCORE=0
```

- **`NotifyAccess=all` est obligatoire.** Le battement passe par `systemd-notify`, un programme que le serveur lance : avec la valeur par défaut (`main`), systemd refuse le message d'un programme lancé par le service, et le chien de garde tue un service sain à chaque fenêtre. Le premier battement est donc vérifié : `systemd-notify` introuvable, ou qui échoue, arrête le serveur au démarrage, avec un message qui nomme la cause et rappelle `NotifyAccess=all`.
- **`LimitCORE=0`** : un service gelé est arrêté par `SIGABRT`, qui écrit sinon un fichier `core` de plusieurs Mo dans le dossier de l'application, à chaque gel.
- **Une fenêtre de moins de 200 ms** (un battement plus court que 100 ms) est acceptée, avec un avertissement au démarrage : `systemd-notify` est alors lancé au moins dix fois par seconde, et un retard de la boucle plus long qu'un battement fait relancer le service.
- Seul le processus que systemd surveille bat (`WATCHDOG_PID`) : un processus enfant qui démarre lui aussi un serveur ne bat pas à sa place.

---

<a id="pont"></a>
## 7. Le pont universel — n'importe quel back pousse du temps réel

Jusqu'ici, tout ce qui parle à `mjsWs` est un client `µ.socket` connecté en WebSocket. Mais la **logique** de votre application — commandes, paiements, notifications, tout ce qui décide **quoi** pousser — vit sans doute ailleurs : un contrôleur Rails, un script PHP, un worker Python, un autre service Node. Le **pont universel** évite de dupliquer cette logique ou de faire parler votre back en WebSocket : votre back garde SA logique telle quelle (Rails reste Rails, PHP reste PHP) et pousse du temps réel par un simple **POST HTTP signé** — un `curl`, une requête `net/http`, `requests`, peu importe le langage. En retour, `mjsWs` peut **prévenir** votre back par **webhooks** : un client se connecte, rejoint un salon, envoie un message — votre back le sait sans avoir à interroger `mjsWs` en boucle.

Le pont est un **second serveur HTTP**, embarqué dans le même process que `mjsWs`, sur un port **séparé** (par défaut le port du WebSocket + 1) et lié à `127.0.0.1` par défaut — c'est **votre** back qui l'appelle, pas Internet. Il ne dépend d'**aucun** paquet npm supplémentaire (`node:http` + `node:crypto` de la stdlib Node, rien d'autre).

### 7.1 Activer le pont — `opts.bridge`

```js
import { mjsWs } from 'modularjs-framework/ws'

const app = mjsWs({
  // ... auth/welcome/rooms/etc., comme d'habitude (§1) ...
  bridge: {
    secret: 'env:MJS_WS_BRIDGE_SECRET',   // OBLIGATOIRE — littérale, ou 'env:NOM_VAR' lue dans process.env
    // port: 4001,                       // défaut : port du WebSocket + 1
    // host: '127.0.0.1',                // défaut — loopback, jamais exposé sur Internet directement
    webhooks: {
      url:    'https://mon-back.example.com/mjs-ws/hook',
      events: ['connect', 'disconnect', 'join', 'leave', 'message:chat'],
      // secret: '...',                  // défaut : le même secret que le pont
      // timeoutMs: 5000,
      // forwardHeaders: ['x-remote-user'],   // en-têtes du visiteur à recopier en plus dans les webhooks (§7.5)
    },
  },
})

await app.listen()   // démarre le WebSocket ET le pont
```

| Option | Défaut | Rôle |
|---|---|---|
| `secret` | — (**obligatoire**) | Chaîne littérale, ou `'env:NOM_VAR'` résolue via `process.env.NOM_VAR` au démarrage. Absente/vide → erreur claire, immédiate (avant même `.listen()`). Moins de 32 caractères : accepté, avec un avertissement unique sur la console — préférez un secret long et aléatoire (`openssl rand -hex 32`). |
| `port` | port du WebSocket + 1 | Port TCP du serveur HTTP du pont. |
| `host` | `'127.0.0.1'` | Host d'écoute — loopback : c'est **votre** back qui appelle le pont, jamais l'inverse. |
| `webhooks.url` | — | URL de **votre** back qui reçoit les webhooks (§7.5). Absente = aucun webhook émis (le pont reste utilisable en lecture/écriture, juste muet). |
| `webhooks.secret` | celui du pont | Secret de signature des webhooks — même forme (littérale ou `env:NOM_VAR`). |
| `webhooks.events` | — (**obligatoire si `webhooks` est fourni**) | Liste d'événements à transmettre : `'connect'`, `'disconnect'`, `'join'`, `'leave'`, `'message:<type>'` (§7.5). |
| `webhooks.timeoutMs` | `5000` | Délai avant abandon d'**une** tentative de livraison. |
| `webhooks.forwardHeaders` | — | En-têtes du visiteur à recopier **en plus** dans le `meta` des webhooks `connect`/`disconnect` (§7.5), par leur nom, sans tenir compte de la casse : `['x-remote-user']`. Un nom listé part tel quel : n'y mettez ni cookie ni jeton. Autre chose qu'une liste de noms d'en-têtes HTTP → erreur claire au démarrage. |

`app.listen()` démarre les **deux** serveurs (WebSocket + pont) ; `app.stop()` les arrête tous les deux (le pont en premier, pour ne plus accepter de nouvelles requêtes pendant que les clients WebSocket reçoivent leur `µ:bye`).

Avec `mjs ws` (§6), le pont se configure aussi dans `mjs.config.json` (`ws.bridge`, **mêmes** clés) ou dans l'entry (`bridge: {...}`) — même règle que `heartbeat`/`limits` : si les **deux** sont posés, l'entry prime EN **bloc** et un avertissement vous le signale. La bannière de démarrage affiche l'URL du pont et les événements webhooks actifs.

### 7.2 La signature, pas à pas

Chaque requête (**sauf** `GET /health`) doit porter trois en-têtes :

| En-tête | Contenu |
|---|---|
| `x-mjs-ws-timestamp` | l'heure UNIX **en secondes**, au moment de la signature |
| `x-mjs-ws-nonce` | une chaîne **neuve** à chaque requête, de 8 à 64 caractères (`openssl rand -hex 16`, `SecureRandom.hex(16)`) — elle ne sert qu'une fois (§7.10) |
| `x-mjs-ws-signature` | HMAC-SHA256 **hexadécimal** de la « chaîne canonique » (ci-dessous), avec votre `secret` |

> ⚠️ **Changement de protocole** — la chaîne canonique décrite ci-dessous
> **Diffère** de la concaténation simple `'.'`-jointe des versions précédentes de cette page. Deux durcissements :
> **séparation de domaine** (un `direction` dédié empêche de rejouer la signature d'une commande admin entrante
> comme un webhook sortant, ou l'inverse, **même** secret partagé) et **injectivité** (l'ancien format permettait,
> en théorie, deux découpages `{chemin}`/`{corps}` distincts de produire la **même** chaîne s'il y avait un `.` au
> bon endroit — plus possible). Aucun back en production ne suivait encore l'ancienne recette au moment de ce
> changement — si le vôtre la suit déjà, adaptez-le à la recette ci-dessous (§7.3/§7.5/§7.7/§7.10).

La chaîne canonique est la concaténation de **champs encodés en longueur-préfixée** (`{longueur}:{champ}`,
comme un netstring — rend la concaténation **sans ambiguïté**, impossible à re-découper autrement) :

```
{longueur(direction)}:{direction}{longueur(ts)}:{ts}{longueur(MÉTHODE)}:{MÉTHODE}{longueur(chemin)}:{chemin}{longueur(corps)}:{corps}{longueur(nonce)}:{nonce}
```

- `{direction}` — `'in'` pour une commande admin **entrante** (votre back → le pont, §7.3), `'out'` pour un webhook
  **Sortant** (le pont → votre back, §7.5) ; **toujours** le **premier** champ — c'est lui qui sépare les deux domaines de
  signature ;
- `{ts}` — l'horodatage UNIX en secondes, tel qu'envoyé dans `x-mjs-ws-timestamp` ;
- `{MÉTHODE}` en **majuscules** (`POST`, `GET`) ;
- `{chemin}` avec la query string, tel qu'il apparaît dans l'URL (`/broadcast`, `/presence?room=zone-42`) — jamais le domaine, jamais le port ;
- `{corps}` = le JSON envoyé, **texte pour texte**, tel qu'il part sur le réseau (pas une re-sérialisation — l'ordre des clés compte) ; **chaîne vide** pour une requête `GET` (jamais de corps) ;
- `{nonce}` — la valeur de `x-mjs-ws-nonce`, en **dernier** champ, encodée de la même façon (§7.10 ; ce champ et l'en-tête disparaissent seulement avec `nonce: false`).

**Les longueurs se comptent en unités UTF-16**, comme `String.length` en JavaScript — ni en octets, ni en caractères : `é` compte 1 (2 octets en UTF-8), un émoji comme `🎉` compte 2 (4 octets). Tant qu'un champ reste en ASCII, les trois comptes coïncident ; dès qu'un corps porte un accent ou un émoji, une longueur en octets fait refuser la requête (`401 signature invalide`). La ligne équivalente en Ruby : `champ.encode('UTF-16LE').bytesize / 2` (jamais `champ.bytesize`) ; en bash : `printf '%s' "$champ" | iconv -f UTF-8 -t UTF-16LE | wc -c`, divisé par 2 (recette du §7.3).

Exemple pour `POST /broadcast` avec le corps `{"type":"annonce","p":{"texte":"salut"}}`, à l'instant `1735689600`, direction `'in'`, nonce `5f2b8c1e9a7d4f3b6c0e8a1d2b4f6e9c` :

```
2:in10:17356896004:POST10:/broadcast40:{"type":"annonce","p":{"texte":"salut"}}32:5f2b8c1e9a7d4f3b6c0e8a1d2b4f6e9c
```

Le pont recalcule la **même** chaîne à réception (avec `direction = 'in'` **toujours** côté vérification des commandes
admin) et compare les deux signatures en temps constant (`crypto.timingSafeEqual`) — jamais une comparaison de
chaînes naïve, qui fuiterait la validité par le temps de réponse. Deux protections de plus :

- **anti-rejeu** : si `|maintenant − timestamp| > 300 s`, la requête est refusée (401) même si la signature est juste — une requête interceptée et rejouée plus tard ne passe pas ; rejouée tout de suite non plus : son nonce a déjà servi (§7.10) ;
- **corps trop gros** : au-delà d'1 Mo, 413 immédiat.

Toute erreur de signature/format répond `401 {"ok": false, "error": "…"}` (message en français) ; un JSON invalide répond `400` ; un chemin inconnu répond `404`.

**Séparation de domaine du secret** — `webhooks.secret` (§7.1) reste la meilleure isolation (compromission d'un canal sans effet sur l'autre), mais grâce au préfixe `direction`, un secret **partagé** (`webhooks.secret` absent, valeur par défaut) est sûr aussi : une signature calculée pour `'in'` ne vérifie **jamais** comme `'out'`, ni l'inverse — même avec le **même** secret des deux côtés.

### 7.3 Les endpoints

Un petit script bash réutilisé par tous les exemples ci-dessous (adaptez `secret` et le port) :

```bash
secret='ton-secret-du-pont'
pont='http://127.0.0.1:4001'

lp() { local n=$(( $(printf '%s' "$1" | iconv -f UTF-8 -t UTF-16LE | wc -c) / 2 )); printf '%s' "$n:$1"; }   # encodage longueur-préfixée d'UN champ, longueur en unités UTF-16 comme String.length en JavaScript, cf. §7.2

signer_et_envoyer() {
  local methode="$1" chemin="$2" corps="$3"
  local ts=$(date +%s)
  local nonce=$(openssl rand -hex 16)   # neuf à chaque requête (§7.10)
  local canonique="$(lp 'in')$(lp "$ts")$(lp "$methode")$(lp "$chemin")$(lp "$corps")$(lp "$nonce")"   # direction 'in' — commande admin entrante ; le nonce en dernier
  local sig=$(printf '%s' "$canonique" | openssl dgst -sha256 -hmac "$secret" -hex | sed 's/^.* //')
  curl -s -X "$methode" "$pont$chemin" \
    -H "x-mjs-ws-timestamp: $ts" \
    -H "x-mjs-ws-nonce: $nonce" \
    -H "x-mjs-ws-signature: $sig" \
    ${corps:+-H "content-type: application/json"} \
    ${corps:+-d "$corps"}
}
```

**`POST /broadcast`** — diffuse à tous les clients authentifiés (`except` optionnel : une personne, en chaîne — son `identity.id`, ou `anon:` suivi de l'id de connexion d'un visiteur sans compte —, une seule connexion, en objet — `{ "client": "<id de connexion>" }`, comme pour `POST /room/kick` —, ou un tableau des deux mélangés : `["u42", { "client": "p1.c17" }]`). Une chaîne désigne toujours une personne, jamais la connexion qui porterait cet id : un compte peut porter le même. Avec plusieurs processus, l'id d'un compte exclut ses onglets où qu'ils soient servis, et `{ client }` la connexion désignée, quel que soit le processus qui la sert — de même pour l'`except` de `POST /room/send`. Toute autre forme est refusée (`400`).

```bash
signer_et_envoyer POST /broadcast '{"type":"annonce","p":{"texte":"maintenance dans 5 min"}}'
# → {"ok":true}
```

**`POST /send`** — un client précis (`client`, id de connexion) OU toutes les connexions d'un utilisateur (`user`, l'id de la personne : `identity.id` — pratique pour un utilisateur ouvert dans plusieurs onglets —, ou `anon:` suivi de l'id de connexion d'un visiteur sans compte). Fournissez **exactement** l'un des deux.

```bash
signer_et_envoyer POST /send '{"user":"42","type":"notif","p":{"texte":"commande expédiée"}}'
# → {"ok":true,"sent":2}   (2 connexions de l'utilisateur 42 — ex. 2 onglets ouverts)
```

**`POST /room/send`** — diffuse aux membres d'un salon **seulement**. `type` part **tel quel** (le préfixe `salon/type` est une convention côté client, le pont n'y touche pas — **même** règle que `app.room(nom).send()`, §4).

```bash
signer_et_envoyer POST /room/send '{"room":"partie-42","type":"partie-42/coup","p":{"case":12}}'
# → {"ok":true}
```

**`POST /room/kick`** — expulse un membre du salon (`client` : cette seule connexion ; `user` : toutes les connexions de cette personne, comme `/send`) ; `reason` optionnelle, transmise au visé (`µ:left {room, reason}`). La connexion reste ouverte — c'est une expulsion de **salon**, pas une déconnexion.

```bash
signer_et_envoyer POST /room/kick '{"room":"partie-42","user":"7","reason":"triche"}'
# → {"ok":true,"kicked":1}
```

**`POST /stream`** — pilote un flux à journal borné (§5) depuis le back : `op` vaut `'add'`, `'update'`, `'remove'` ou `'reset'`. Le flux est créé à la volée s'il n'existait pas encore (une écriture refusée en 400 — `id` manquant, valeur absente ou non sérialisable — ne crée rien), mais il n'est servi à **aucun** client tant que votre code ne l'a pas déclaré sur ce process : `app.stream('ennemis', { public: true })` pour un flux public, `app.stream(nom, { canSubscribe | room })` pour un flux privé (§5). Sans déclaration, chaque `µ:sub-stream` reçoit un `µ:error` (accès refusé) et `onLog` vous dit pourquoi : un flux écrit par le pont n'est jamais public par défaut.

| `op` | Champs requis | Effet |
|---|---|---|
| `add` | `id`, `value` | ajoute/remplace l'entrée `id` |
| `update` | `id`, `value` (objet — le PATCH) | fusion 1 niveau, comme `stream.update()` |
| `remove` | `id` | retire l'entrée |
| `reset` | `values` (objet complet) | nouvelle époque — remplace tout, journal vidé |

```bash
signer_et_envoyer POST /stream '{"name":"ennemis","op":"add","id":"e1","value":{"x":10,"y":20}}'
# → {"ok":true}
```

**`GET /presence`** — présence agrégée, telle que le serveur la tient : les identités au nom réservé (`__proto__`, `constructor`, `prototype`) y figurent comme les autres, alors que `sock.presence()` côté client les écarte (cf. « Une identité au nom réservé », §4.2). Sans `?room=`, c'est la présence **globale**.

```bash
signer_et_envoyer GET '/presence?room=partie-42' ''
# → {"ok":true,"peers":[{"id":"7","meta":{"pseudo":"Zora"}}]}
```

**`GET /heatmap`**, **`GET /heatmap.json`** — la carte de chaleur (§4.5), là seulement où `heatmapPackage()` est installé (sinon 404) ; même règle de signature que `/state` (§10.2). Servies par morceaux, la main rendue au serveur temps réel entre deux : même au plafond d'un million de points (des dizaines de Mo), la boucle n'est jamais gelée plus que quelques millisecondes. Un client qui lit lentement fait attendre la suite ; un client qui ne lit plus rien pendant 30 s voit sa réponse coupée. La réponse en cours garde les points de son instant : la carte, elle, continue d'oublier les points expirés, et sa mémoire reste sous `maxPoints`, quel que soit le client.

**`GET /health`** — **seul** endpoint **sans** signature, pour un simple contrôle de vie (load balancer, orchestrateur…) :

```bash
curl http://127.0.0.1:4001/health
# → 200, corps texte "ok"
```

### 7.4 Vérifier une signature reçue (le sens inverse)

Le pont applique le **même** algorithme (longueur-préfixée, §7.2) pour vérifier ce qu'il reçoit ET pour signer ce qu'il envoie (les webhooks, §7.5) — votre back doit donc savoir faire les **deux** : signer une requête sortante vers le pont (`direction = 'in'`), et vérifier une requête entrante (un webhook) venant du pont (`direction = 'out'`). **Seul** le champ `direction` change entre les deux sens — cf. les recettes par langage en §7.6.

### 7.5 Les webhooks — le pont vous prévient

Quand `webhooks` est configuré, `mjsWs` POST vers `webhooks.url` à chaque événement listé dans `events`, signé avec la **même** chaîne canonique que vos propres requêtes entrantes (§7.2), **sauf** le champ `direction` : `'out'` au lieu de `'in'` — c'est exactement ce qui empêche de rejouer la signature d'un webhook comme une commande admin, ou l'inverse. Mêmes en-têtes (`POST`, le **chemin** de votre URL de webhook, le corps JSON). C'est du **fire-and-forget** : la réponse de votre back n'est **jamais** renvoyée au client d'origine, et un échec ne bloque **jamais** le serveur temps réel.

| Événement | Payload | Quand |
|---|---|---|
| `connect` | `{event, at, client: {id, identity, meta}}` | une connexion franchit le `µ:welcome` (authentifiée) |
| `disconnect` | `{event, at, client: {id, identity, meta}, reason?}` | une connexion authentifiée se ferme |
| `join` | `{event, at, room, user: {id, meta}}` | un **utilisateur** (agrégé : `identity.id`, ou `anon:` suivi de l'id de connexion d'un visiteur sans compte) entre dans un salon — au premier onglet, pas à chaque connexion |
| `leave` | `{event, at, room, user: {id, meta}}` | un utilisateur **quitte** un salon — au dernier onglet fermé/parti |
| `message:<type>` | `{event: 'message', type, p, client: {id, identity}}` | un client envoie un message applicatif de CE type précis (ex. `message:chat`) — que le serveur ait un `serve()`/`on()` dessus ou non |

`join`/`leave` suivent **exactement** les mêmes règles que la présence de salon (§4) : deux onglets du même utilisateur ne déclenchent qu'un `join` (au premier) et qu'un `leave` (au dernier) — jamais de doublon par onglet.

**Les en-têtes du visiteur** — le `meta` de `connect`/`disconnect` est celui de la connexion (`origin`, `address`, `headers`), mais `headers` n'y garde qu'une courte liste d'en-têtes utiles et sans secret : `host`, `origin`, `user-agent`, `accept-language`, `x-request-id`, `x-forwarded-proto` et `sec-websocket-version`. Tous les autres ne partent jamais dans un webhook, quelle que soit leur casse : `cookie`, `authorization`, `sec-websocket-protocol` (le seul en-tête qu'un navigateur peut poser sur un WebSocket, où l'on met souvent un jeton), les jetons et l'identité qu'un proxy d'authentification pose devant votre appli (`x-forwarded-user`, `remote-user`, `x-forwarded-groups`, `x-userinfo`, `x-forwarded-client-cert`…), comme `x-forwarded-for` (l'adresse retenue est dans `address`). Pour en recevoir d'autres, nommez-les dans `webhooks.forwardHeaders` (§7.1) : ils partent tels quels. Côté serveur, `client.meta.headers` reste entier : `opts.auth` lit toujours le cookie.

**Livraison** — bornée et jamais bloquante : file d'attente de 1000 événements maximum (au-delà, l'événement en trop est abandonné, jamais une pile qui grossit sans fin : un avertissement dans `onLog` à la première perte, puis au plus un par minute avec le nombre d'événements perdus depuis, et le reste du compte à l'arrêt), 4 livraisons en vol au maximum en parallèle, 3 tentatives par événement (immédiate, puis +2 s, puis +10 s) avant abandon définitif (avec un avertissement). `app.stop()` coupe les retentatives en attente et interrompt les envois en cours : le processus peut sortir tout de suite. Un événement dont la charge ne s'écrit pas en JSON (un `BigInt`, comme les colonnes BigInt que rend Prisma, ou un objet cyclique dans l'identité ou la méta) est abandonné avec une erreur dans `onLog` et compté dans `webhooksAbandonnes` (§10) ; le serveur continue. Un événement absent de `events` n'est **jamais** calculé ni envoyé — configurez exactement ce dont votre back a besoin.

**Une retentative ne garde pas sa place.** Un événement qui attend sa retentative (2 s, puis 10 s) libère sa place parmi les 4 livraisons en vol : un back tombé une seconde ne retient pas les événements suivants, qui partent dès qu'il répond de nouveau. Les événements qui attendent leur retentative comptent dans les 1000 de la file.

Côté back, un webhook reçu ressemble à ceci (Node, exemple minimal) :

```js
import { createServer } from 'node:http'
import { createHmac, timingSafeEqual } from 'node:crypto'

const SECRET = process.env.MJS_WS_BRIDGE_SECRET

// encodage longueur-préfixée d'UN champ (§7.2)
const lp = (champ) => `${champ.length}:${champ}`

createServer((req, res) => {
  const chunks = []
  req.on('data', c => chunks.push(c))
  req.on('end', () => {
    const corps       = Buffer.concat(chunks).toString('utf8')
    // direction 'out' — c'est un webhook (le pont → vous), JAMAIS 'in' (une commande admin vous → le pont)
    const canonique    = ['out', req.headers['x-mjs-ws-timestamp'], 'POST', req.url, corps].map(lp).join('')
    const attendue     = createHmac('sha256', SECRET).update(canonique).digest('hex')
    const recueBuf     = Buffer.from(req.headers['x-mjs-ws-signature'], 'hex')
    const attendueBuf  = Buffer.from(attendue, 'hex')
    if (recueBuf.length !== attendueBuf.length || !timingSafeEqual(recueBuf, attendueBuf)) {
      res.writeHead(401); res.end(); return
    }
    const evt = JSON.parse(corps)
    console.log('événement MJS-WS reçu :', evt.event, evt)
    res.writeHead(200); res.end('ok')
  })
}).listen(3000)
```

### 7.6 Jetons — signer/vérifier sans dépendance (`modularjs-framework/ws`)

`mjsWs` fournit des jetons **JWT HS256** sans aucune dépendance (base64url + HMAC-SHA256, `node:crypto` seul) — interopérables avec les bibliothèques JWT standard de n'importe quel langage (même algorithme, même format).

```js
import { signToken, verifyToken, jwtAuth } from 'modularjs-framework/ws'

// émission (ex. après un login classique, côté votre API)
const jeton = signToken({ id: utilisateur.id, pseudo: utilisateur.pseudo }, process.env.JWT_SECRET, { ttl: 3600 })

// côté MJS-WS — jwtAuth() est une fonction opts.auth toute prête :
const app = mjsWs({
  auth: jwtAuth(process.env.JWT_SECRET),   // lit hello.auth.token (ou hello.auth si c'est déjà une chaîne)
  // ... reste des options ...
})
```

`jwtAuth` pose `client.identity = payload` (les clés du jeton), avec `identity.id = payload.id ?? payload.sub` — compatible des jetons émis par une lib tierce qui n'utilise que `sub` (convention JWT standard). Un jeton absent, mal signé, expiré ou pas encore valable → refus (`µ:denied`), comme n'importe quelle fonction `auth` qui retourne `false`.

**Le secret est obligatoire.** `jwtAuth`, `signToken` et `verifyToken` lèvent une erreur claire quand il est absent, vide ou n'est pas une chaîne : `jwtAuth(process.env.JWT_SECRET)` avec une variable oubliée s'arrête **dès le démarrage**, au lieu d'accepter tout jeton signé avec la clé vide. Un secret de moins de 32 caractères passe, avec un avertissement unique au journal : préférez un secret long et aléatoire (`openssl rand -hex 32`).

**L'en-tête et les dates.** `alg` doit valoir `HS256` (jamais `none`). `typ` est facultatif (la gem `jwt` de Ruby ne l'écrit pas) ; s'il est là, il vaut `JWT`, sans tenir compte de la casse. Un `exp` présent mais qui n'est pas un nombre refuse le jeton : il serait sinon éternel. `nbf` (« pas valable avant ») est respecté de la même façon, sans aucune option : un jeton dont le `nbf` est encore à venir est refusé, un `nbf` qui n'est pas un nombre aussi.

**Pour quel site, par qui — `jwtAuth(secret, options)`.** Sans option, `jwtAuth` vérifie la signature et les dates, mais ne regarde pas **pour quel site** le jeton est fait : deux sites qui partagent le même secret acceptent les jetons l'un de l'autre. Trois options ferment cette porte :

| Option | Défaut | Rôle |
|---|---|---|
| `audience` | — (non vérifié) | Le site pour lequel le jeton doit être fait : une chaîne, ou une liste de sites admis. Le `aud` du jeton (une chaîne ou une liste) doit en contenir un ; un jeton **sans** `aud` est refusé. |
| `issuer` | — (non vérifié) | Qui a émis le jeton : une chaîne, ou une liste d'émetteurs admis. Le `iss` du jeton doit en être un ; un jeton sans `iss` est refusé. |
| `clockTolerance` | `0` | Tolérance d'horloge, en **secondes**, appliquée à `exp` et à `nbf` : un léger écart d'heure entre le serveur qui émet et celui qui vérifie ne refuse pas un jeton encore bon. Aucun plafond n'est imposé : comptez quelques secondes à quelques minutes ; une tolérance énorme accepte des jetons expirés depuis aussi longtemps. |

```js
const app = mjsWs({
  auth:  jwtAuth(process.env.JWT_SECRET, { audience: 'boutique', issuer: 'https://boutique.fr', clockTolerance: 30 }),
  token: { slack: 30000 },   // le suivi de l'échéance garde la même tolérance, en millisecondes (cf. ci-dessous)
})

// côté émetteur : le jeton dit pour quel site il est fait, et qui l'a émis
const jeton = signToken({ id: utilisateur.id, aud: 'boutique', iss: 'https://boutique.fr' }, process.env.JWT_SECRET, { ttl: 3600 })
```

Un jeton signé avec le même secret mais fait pour un autre site (`aud: 'blog'`), ou émis par un autre service, est refusé (`µ:denied`), exactement comme un jeton mal signé. Les comparaisons tiennent compte de la casse : `'Boutique'` n'est pas `'boutique'`. Une option invalide (une liste vide, une chaîne vide, un nombre négatif, un type inattendu) lève une erreur claire **dès le démarrage**, une clé inconnue aussi, avec la plus proche en suggestion (`audiance` → « vouliez-vous dire 'audience' ? »). `verifyToken(jeton, secret, options)` prend les mêmes options, pour vérifier un jeton hors de `mjsWs` (une route HTTP, par exemple).

> ⚠️ **La tolérance vaut à la vérification** : au `µ:hello` et à chaque `µ:refresh`. Le suivi continu de l'échéance ([§7.9](#79-expiration-et-rafraîchissement-du-jeton)) garde la sienne, `token.slack` (5 s par défaut) : donnez-lui au moins la même valeur (`token: { slack: 30000 }` pour `clockTolerance: 30`), sinon un jeton accepté de justesse est fermé au balayage suivant.

> ⚠️ **Activer `audience` ou `issuer` sur un service déjà en route** : un jeton sans `aud` (ou sans `iss`) est refusé dès que l'option est posée — tous ceux déjà distribués, donc. Au redémarrage, chaque client qui se reconnecte avec l'un d'eux reçoit `µ:denied`, jusqu'à ce que votre émetteur lui en donne un neuf (avec `accountsAuth`, il revient en invité : cf. [27 · Comptes §6](27-accounts.md#securite)). Pour passer sans coupure : faites d'abord émettre les jetons avec `aud` (et `iss`) — `jwtAuth` sans option les accepte déjà —, attendez que ceux émis avant aient expiré (leur `ttl`), puis posez `audience` (et `issuer`) sur `jwtAuth`.

Émettre ce jeton peut se faire dans **n'importe quel** langage — le format est standard (`base64url(entête).base64url(corps).base64url(signature)`, HMAC-SHA256, sans padding). Quatre recettes :

**Ruby — sans gem (stdlib `openssl`/`base64`/`json`)**

```ruby
require 'openssl'
require 'base64'
require 'json'

def signer_jeton(payload, secret, ttl: nil)
  entete = { alg: 'HS256', typ: 'JWT' }
  iat    = Time.now.to_i
  corps  = payload.merge(iat: iat)
  corps[:exp] = iat + ttl if ttl
  b64 = ->(s) { Base64.urlsafe_encode64(s, padding: false) }
  entete_charge = "#{b64.call(entete.to_json)}.#{b64.call(corps.to_json)}"
  signature = OpenSSL::HMAC.digest('SHA256', secret, entete_charge)
  "#{entete_charge}.#{b64.call(signature)}"
end

jeton = signer_jeton({ id: current_user.id, pseudo: current_user.pseudo }, ENV.fetch('JWT_SECRET'), ttl: 3600)
```

**Ruby — avec la gem `jwt`** (si elle est déjà dans votre `Gemfile`)

```ruby
require 'jwt'
jeton = JWT.encode({ id: current_user.id, pseudo: current_user.pseudo, iat: Time.now.to_i }, ENV.fetch('JWT_SECRET'), 'HS256')
```

**PHP — sans dépendance (`hash_hmac`)**

```php
<?php
function signer_jeton(array $payload, string $secret, ?int $ttl = null): string {
  $entete = ['alg' => 'HS256', 'typ' => 'JWT'];
  $iat    = time();
  $corps  = $payload + ['iat' => $iat];
  if ($ttl !== null) $corps['exp'] = $iat + $ttl;
  $b64 = fn($s) => rtrim(strtr(base64_encode($s), '+/', '-_'), '=');
  $entete_charge = $b64(json_encode($entete)) . '.' . $b64(json_encode($corps));
  $signature = hash_hmac('sha256', $entete_charge, $secret, true);
  return $entete_charge . '.' . $b64($signature);
}

$jeton = signer_jeton(['id' => $utilisateur->id, 'pseudo' => $utilisateur->pseudo], getenv('JWT_SECRET'), 3600);
```

**Python — stdlib (`hmac`/`hashlib`/`base64`/`json`)**

```python
import base64, hashlib, hmac, json, os, time

def signer_jeton(payload: dict, secret: str, ttl: int | None = None) -> str:
    entete = {'alg': 'HS256', 'typ': 'JWT'}
    iat    = int(time.time())
    corps  = {**payload, 'iat': iat}
    if ttl is not None:
        corps['exp'] = iat + ttl
    b64 = lambda d: base64.urlsafe_b64encode(json.dumps(d).encode()).rstrip(b'=')
    entete_charge = b64(entete) + b'.' + b64(corps)
    signature     = hmac.new(secret.encode(), entete_charge, hashlib.sha256).digest()
    sig64         = base64.urlsafe_b64encode(signature).rstrip(b'=')
    return (entete_charge + b'.' + sig64).decode()

jeton = signer_jeton({'id': utilisateur.id, 'pseudo': utilisateur.pseudo}, os.environ['JWT_SECRET'], ttl=3600)
```

### 7.7 Recette « depuis Rails » — pousser sans toucher au process `mjsWs`

Un petit module qu'on appelle depuis n'importe quel contrôleur/job Rails — aucune gem HTTP exotique, juste `net/http` de la stdlib :

```ruby
require 'net/http'
require 'openssl'
require 'securerandom'
require 'json'
require 'uri'

module Realtime
  MJS_WS_URL    = ENV.fetch('MJS_WS_BRIDGE_URL', 'http://127.0.0.1:4001')
  MJS_WS_SECRET = ENV.fetch('MJS_WS_BRIDGE_SECRET')

  def self.rt_broadcast(type, payload = {}, except: nil)
    poster('/broadcast', { type: type, p: payload, except: except }.compact)
  end

  def self.rt_send(user:, type:, payload: {})
    poster('/send', { user: user.to_s, type: type, p: payload })
  end

  def self.rt_room(room:, type:, payload: {})
    poster('/room/send', { room: room, type: type, p: payload })
  end

  # encodage longueur-préfixée d'UN champ (§7.2) — longueur en unités UTF-16, comme String.length en JavaScript : bytesize compterait les octets, et un accent ferait refuser la signature
  def self.lp(champ)
    "#{champ.encode('UTF-16LE').bytesize / 2}:#{champ}"
  end

  def self.poster(chemin, corps_hash)
    corps = corps_hash.to_json
    ts    = Time.now.to_i
    nonce = SecureRandom.hex(16)   # neuf à chaque requête (§7.10) : la même requête ne passe qu'une fois
    # direction 'in' — c'est VOUS qui poussez vers le pont (commande admin entrante), jamais 'out' (réservé aux webhooks) ; le nonce en dernier
    chaine_canonique = [lp('in'), lp(ts.to_s), lp('POST'), lp(chemin), lp(corps), lp(nonce)].join
    signature = OpenSSL::HMAC.hexdigest('SHA256', MJS_WS_SECRET, chaine_canonique)

    uri = URI.join(MJS_WS_URL, chemin)
    req = Net::HTTP::Post.new(uri)
    req['content-type']      = 'application/json'
    req['x-mjs-ws-timestamp'] = ts.to_s
    req['x-mjs-ws-nonce']     = nonce
    req['x-mjs-ws-signature'] = signature
    req.body = corps

    Net::HTTP.start(uri.host, uri.port) { |http| http.request(req) }
  end
end
```

Utilisation, depuis n'importe où dans l'appli Rails (contrôleur, job Sidekiq, callback ActiveRecord…) — **aucune** connaissance du protocole `µ:`, juste un appel Ruby normal :

```ruby
# app/models/commande.rb
after_update_commit :notifier_expedition, if: :expediee?

def notifier_expedition
  Realtime.rt_send(user: user, type: 'notif', payload: { commande_id: id, statut: 'expediee' })
  Realtime.rt_broadcast('stats_maj', { total_commandes: Commande.count })
end
```

### 7.8 Limite de débit

La signature (§7.2) protège l'**intégrité** des requêtes — pas le matraquage : une boucle folle côté back, ou quelqu'un qui essaie de deviner votre secret à coups de signatures au hasard, passerait au travers. Le pont applique donc une limite de débit **par IP source, active par défaut** :

- un **seau général** : `120` requêtes / `10 s` par IP (`GET /health` reste toujours libre — c'est la sonde de votre orchestrateur/load-balancer). Chaque requête y prend un jeton à son arrivée ; une requête dont la signature est **vérifiée** le rend aussitôt : votre back qui signe pousse autant qu'il en a besoin, seul compte le nombre de ses requêtes en cours au même instant (`120` au plus par défaut). Un en-tête de signature faux ne dispense de rien : il garde son jeton. Les requêtes sans signature d'une adresse vident le seau pour toute cette adresse, votre back compris s'il la partage ;
- un **seau séparé, plus strict**, pour les échecs d'une requête signée : signature fausse ou absente, nonce rejoué, mais aussi corps trop gros (`413`) ou illisible (`400`) sous un en-tête de signature — `10` échecs / `60 s` par IP ; au-delà, `429` **immédiat**, sans même lire le corps ni vérifier la signature (protection contre le brute-force).

Dépassement (l'un ou l'autre seau) → `429 {"ok": false, "error": "rate-limited"}`, sans autre détail.

Une adresse IPv6 compte pour tout son préfixe `/56` (§3.4).

```js
bridge: {
  secret: 'env:MJS_WS_BRIDGE_SECRET',
  // rateLimit: false,                                       // désactive complètement
  // rateLimit: { perIp: [200, 10000], fails: [5, 60000] },   // ajuste un seau ou les deux
},
```

| Option | Défaut | Rôle |
|---|---|---|
| `rateLimit.perIp` | `[120, 10000]` | `[capacité, fenêtreMs]` du seau général. |
| `rateLimit.fails` | `[10, 60000]` | `[capacité, fenêtreMs]` du seau des échecs de signature. |
| `rateLimit` | actif (défauts ci-dessus) | `false` désactive les **deux** seaux. |

Même règle que le reste de `ws.bridge` en config (`mjs.config.json` `ws.bridge.rateLimit`, ou l'entry) : la bannière de `mjs ws` affiche l'état effectif (« limite de débit : 120 req/10s par IP (échecs de signature : 10/60s) », ou « limite de débit désactivée »).

### 7.9 Expiration et rafraîchissement du jeton

Un jeton (§7.6) porte une échéance (`exp`). Vérifiée **seulement** au `µ:hello`, elle ne fermerait jamais la socket d'un jeton qui expire **après** la connexion : le client resterait connecté indéfiniment avec une identité qui n'est plus censée être valide. `mjsWs` suit donc cette échéance en continu, dès que `opts.auth` (donc `jwtAuth`, ou toute fonction maison qui pose un `exp` numérique sur l'identity retournée) l'expose.

**Suivi automatique — rien à activer.** Dès qu'UN client authentifié porte une échéance, un balayage périodique **global** (jamais un minuteur par connexion) la surveille : passé l'échéance (+ une tolérance d'horloge), le client reçoit `µ:error { code: 'token-expired' }` puis sa connexion est fermée — **sans** `µ:bye` (le client peut reconnecter avec un jeton neuf, exactement comme un kick des protections de série, §3). Tant qu'**aucune** auth n'expose jamais d'échéance, ce balayage n'est jamais armé : zéro minuteur, zéro coût.

```js
const app = mjsWs({
  auth:  jwtAuth(process.env.JWT_SECRET),   // pose identity.exp — le suivi s'arme tout seul
  token: { sweep: 10000, slack: 5000 },     // valeurs par défaut — période du balayage / tolérance d'horloge
})
```

| Option `token.*` | Défaut | Rôle |
|---|---|---|
| `sweep` | `10000` ms | Période du balayage global. |
| `slack` | `5000` ms | Tolérance d'horloge — un jeton expiré depuis **moins** que ça n'est pas encore fermé. |

**Rafraîchir avant l'échéance — `µ:refresh`.** Plutôt que de laisser la connexion se faire fermer, le client peut envoyer un jeton neuf EN **vol** : le serveur re-vérifie par le **même** chemin que le hello (`opts.auth`), mais refuse tout changement d'identité (`identity.id`) — un rafraîchissement n'est jamais un moyen détourné de changer d'utilisateur, ça casserait présence/salons déjà établis sur l'ancienne identité. Un rafraîchissement raté (`µ:error { code: 'refresh-denied' }`) ne ferme **rien** — la connexion continue de vivre jusqu'à son échéance courante. Accepté avec une identité changée (même `identity.id`, autres champs : un rôle retiré, une échéance `exp` renouvelée…), il fait repasser la garde `canSubscribe` des flux que la connexion suit (§5), au même rythme qu'au départ d'un salon : rien de ces flux ne lui part jusqu'à la réponse, et un refus lui est annoncé par un `µ:error`. Un rafraîchissement qui rend exactement la même identité ne la rappelle pas.

Côté client, `sock.refresh(a)` — **même** contrat que l'option `auth` du constructeur (valeur ou fonction, sync/async) :

```civet
@sock = µsocket "wss://jeu/play", { auth: -> { token: $$session.token } }

try
  await @sock.refresh -> { token: $$session.token }   # nouveau jeton — même contrat que `auth`
catch e
  µ.error 'jeton refusé au rafraîchissement :', e   # connexion INCHANGÉE, vivante jusqu'à son échéance courante
```

> ⚠️ **Pas de minuterie côté client.** `sock.refresh` ne re-tente jamais tout seul et n'arme aucun minuteur — c'est à l'appli de décider quand rafraîchir (ex. depuis l'échéance connue de son propre jeton, ou un `setInterval` maison).

### 7.10 Nonce anti-rejeu

La fenêtre de ± 300 s (§7.2) ne suffit pas seule : une requête **capturée** y resterait rejouable. Le pont exige donc, par défaut, un nonce sur chaque requête signée : l'en-tête `x-mjs-ws-nonce`, une chaîne choisie par **votre** back, de 8 à 64 caractères, neuve à chaque requête (un identifiant aléatoire suffit), ajoutée en **dernier** champ de la chaîne canonique (encodée en longueur-préfixée, comme les autres — §7.2) :

```
{lp(direction)}{lp(ts)}{lp(MÉTHODE)}{lp(chemin+query)}{lp(corps brut)}{lp(nonce)}
```

Les recettes de §7.3 (`curl`) et §7.7 (Rails) l'envoient déjà. Fabriquer un nonce, côté back :

```ruby
nonce = SecureRandom.hex(16)   # 32 caractères hexadécimaux
```

```bash
nonce=$(openssl rand -hex 16)
```

```js
const nonce = randomBytes(16).toString('hex')   // import { randomBytes } from 'node:crypto'
```

Le pont retient chaque nonce vu pendant ± 300 s (store borné, éviction automatique — même esprit que la limite de débit, §7.8) :

| Cas | Réponse |
|---|---|
| en-tête `x-mjs-ws-nonce` absent | `401` — le message dit quoi ajouter : l'en-tête, et le nonce en dernier champ de la chaîne signée |
| nonce hors format (moins de 8 ou plus de 64 caractères) | `401` |
| nonce déjà vu dans la fenêtre ± 300 s (rejeu) | `401 {"ok":false,"error":"nonce-rejoué"}` |

Ces refus **créditent** le seau-échecs de la limite de débit (§7.8) — exactement comme une signature invalide, un flot de rejeux se fait donc aussi verrouiller en `429` au-delà du budget configuré.

Pour le couper (dans l'entry, ou `ws.bridge.nonce` dans `mjs.config.json`) :

```js
bridge: {
  secret: 'env:MJS_WS_BRIDGE_SECRET',
  nonce:  false,   // une requête sans nonce passe : seule la fenêtre de ± 300 s protège alors du rejeu
},
```

| Option | Défaut | Rôle |
|---|---|---|
| `nonce` | `true` | Exige `x-mjs-ws-nonce` sur chaque requête signée — **sauf** celles qui n'ont pas à l'être : `GET /health`, et les pages d'état servies en loopback (§10.2). `false` le désactive. |

### 7.11 Proxy de décisions (auth/join délégués)

`opts.auth` et `opts.rooms.join` sont des callbacks — rien n'empêchait déjà d'y appeler votre back à la main (`fetch`/`net/http`/…). Le **proxy de décisions** retire ce dernier bout de code : pointez une URL, `mjsWs` fait l'appel HTTP **signé** à votre place, avec timeout et cache courts intégrés. Façon Centrifugo « proxy ».

> ℹ️ **Format de signature — différent du pont admin/webhooks.** Le proxy de décisions garde volontairement la
> chaîne canonique **historique**, `'.'`-jointe **sans** le préfixe `direction` (§7.2) : `{ts}.POST.{chemin}.{corps}`,
> et, pour `verifyResponse`, `{ts}.RESPONSE.{chemin}.{signature de la requête}` suivi d'un saut de ligne et du corps
> de la réponse (le champ **méthode** joue déjà ce rôle de séparation ici). Ce n'est **pas** le même canal ni le même secret que `bridge.secret`/`webhooks.secret` — les recettes
> ci-dessous restent telles quelles, rien à changer côté back existant pour cette section.

```js
const app = mjsWs({
  // fonction historique — continue de marcher, RIEN ne change (rétro-compat totale)
  // auth: (hello, meta) => hello.auth?.token === SECRET ? { id: 1 } : false,

  // proxy de décisions — le dev ne code plus l'appel HTTP lui-même
  auth: {
    url:    'https://mon-back.example.com/mjs-ws/connect',
    secret: 'env:MJS_WS_PROXY_SECRET',   // littérale, ou 'env:NOM_VAR' — MÊME patron que bridge.secret
    // timeout: 5000,                   // ms, défaut 5000 — au-delà : décision de REFUS, jamais bloquant
    // cache:   { ttl: 2000 },          // ms, optionnel — évite de marteler le back sur des reconnexions rapprochées
  },
  rooms: {
    join: { url: 'https://mon-back.example.com/mjs-ws/subscribe', secret: 'env:MJS_WS_PROXY_SECRET' },
  },
})
```

| Option | Défaut | Rôle |
|---|---|---|
| `url` | — (**obligatoire**) | URL de **votre** back qui décide. |
| `secret` | — (**obligatoire**) | Chaîne littérale, ou `'env:NOM_VAR'` — **même** forme que `opts.bridge.secret`. |
| `timeout` | `5000` ms | Au-delà : décision de **refus**, jamais bloquant/pendant — le client reçoit un `µ:denied`/`µ:error` tout à fait normal, comme n'importe quel refus. |
| `cache.ttl` | — (pas de cache) | Cache court, par requête — une reconnexion/un rejoin identique dans la fenêtre ne repart **jamais** vers votre back, la décision précédente est réutilisée telle quelle. Absent = chaque appel repart vers votre back (comportement par défaut, rien de caché). |
| `verifyResponse` | `false` | Exige que la **réponse** du back soit elle-même signée (mêmes en-têtes, `RESPONSE` à la place de `POST`, et la signature de la requête, qui la lie à sa requête) — cf. « Durcissement — signer la réponse » plus bas. |

**Un refus de panne ne se garde pas.** Avec `cache.ttl`, seule une réponse de votre back se garde : un refus dû à une panne (délai dépassé, back injoignable, statut non 2xx, réponse illisible ou mal signée) n'est jamais réutilisé, et le visiteur entre dès que votre back répond de nouveau, sans attendre la fin du `ttl`. Pendant la panne, chaque connexion ou entrée en salon refait donc l'appel.

**Le contrat HTTP** — un POST signé, **mêmes** en-têtes que le pont (`x-mjs-ws-timestamp` / `x-mjs-ws-signature`), mais chaîne canonique **historique** (cf. note ci-dessus — **pas** celle, longueur-préfixée + dirigée, du pont admin/webhooks §7.2) : `{ts}.POST.{chemin}.{corps}`, où `{chemin}` est le chemin de l'`url` **avec** sa query string (`/mjs-ws/connect?site=2`) — `request.fullpath` côté Rails, pas `request.path`, qui la retire.

| Événement | Corps envoyé | Réponse attendue |
|---|---|---|
| `connect` (`opts.auth`) | `{event:'connect', hello, cookie?}` — `hello` = charge **exacte** du `µ:hello` reçu ; `cookie` = en-tête `Cookie` **brut** de la requête d'upgrade, **clé absente** s'il n'y en a pas | `{ok:true, identity}` → `client.identity`, `µ:welcome` ; `{ok:false, raison?}` → `µ:denied {message: raison}` |
| `subscribe` (`rooms.join`) | `{event:'subscribe', room, identity}` | `{ok:true}` → adhésion ; tout le reste (`{ok:false}`, statut non-2xx, JSON invalide, timeout) → refus (`µ:error`, throttlé comme d'habitude, §4) |

Un statut non-2xx, une réponse JSON invalide, ou le délai `timeout` dépassé sont **tous** traités comme `{ok:false}` — jamais un `throw` qui ferait pendre le handshake, toujours une décision (de refus).

> ℹ️ **`cookie` — c'est ce qui rend le patron « `mjsWs` rejoue le cookie » (§7.12) compatible avec ce proxy.** Le
> `connect` porte l'en-tête `Cookie` **brut** de la requête d'upgrade : votre back peut donc décider sur la **session**
> du visiteur, sans jeton intermédiaire, tout en gardant la signature, le `timeout` et le cache de cette section.
> C'est le **seul** en-tête transmis — ni `authorization`, ni `user-agent`, ni le reste : un back n'a pas à recevoir
> ce qu'il n'a pas demandé. Sans cookie sur l'upgrade, la clé est **absente** du corps (jamais une chaîne vide) :
> un back déjà en place ne voit **aucun** changement. Le cookie fait partie de la **clé de cache** (`cache.ttl`) —
> le cache est donc par **visiteur**, jamais partagé entre deux identités. Et la garde TLS ci-dessous (`http://`
> hors loopback refusé sauf `allowInsecure`) reste ce qui empêche ce cookie de voyager en clair.

**Vérifier la signature côté Rails** — mêmes en-têtes qu'un webhook du pont (§7.5), mais **pas** la même chaîne signée : le proxy de décisions signe la forme simple `timestamp.POST.chemin.corps` — champs joints par des points, le chemin avec sa requête (`?…`), sans le champ `direction` ni les longueurs de §7.2. La recette ci-dessous la vérifie telle quelle.

```ruby
ts, sig  = request.headers['x-mjs-ws-timestamp'], request.headers['x-mjs-ws-signature']
corps    = request.raw_post
attendue = OpenSSL::HMAC.hexdigest('SHA256', ENV.fetch('MJS_WS_PROXY_SECRET'), "#{ts}.POST.#{request.fullpath}.#{corps}")   # fullpath : query string comprise
head :unauthorized and return unless ActiveSupport::SecurityUtils.secure_compare(attendue, sig.to_s)

evt = JSON.parse(corps)
case evt['event']
when 'connect'   then render json: autoriser_connexion(evt['hello'])   # { ok:true, identity: {...} } ou { ok:false, raison: '...' }
when 'subscribe' then render json: { ok: peut_rejoindre?(evt['room'], evt['identity']) }
end
```

**Rétro-compat totale** : `auth` en proxy et `rooms.join` en fonction locale (ou l'inverse) se mélangent librement, rien n'impose de tout migrer d'un coup — les deux formes cohabitent sans réglage supplémentaire.

> **Pas dans `mjs.config.json`.** Contrairement à `bridge`/`resume` (purement déclaratifs), `auth`/`rooms.join` restent réservés à l'entry/`mjsWs()` (fonction OU objet-proxy) — pas de `ws.auth`/`ws.rooms` dans la config JSON pour l'instant. Rien ne l'empêche techniquement plus tard si le besoin se confirme.

#### Durcissement — signer la réponse (`verifyResponse: true`)

La recette ci-dessus fait confiance à la réponse HTTP telle quelle dès que le statut est 2xx — la garde TLS (loopback ou `https://`, cf. `resolveProxyOptions`) protège le **transport**, pas le **contenu** de la réponse elle-même : un maillon compromis en aval (proxy, back mal isolé…) pourrait en théorie forger une réponse `{ok:true}`. `verifyResponse: true` ferme cette dernière fenêtre : la réponse doit à son tour porter les **deux** en-têtes habituels, **même** secret, mais avec `RESPONSE` à la place de `POST` dans la chaîne canonique (jamais `POST` — pour ne jamais confondre la signature de la requête avec celle de sa propre réponse) :

```
{timestamp}.RESPONSE.{chemin avec la query string}.{signature de la REQUÊTE}
{corps de la RÉPONSE}
```

La signature de la requête est la valeur de son en-tête `x-mjs-ws-signature`, telle que reçue, suivie d'un saut de ligne (`\n`) puis du corps de la réponse. Elle lie la réponse à **cette** requête : un intermédiaire qui a vu passer une réponse `{ok:true, identity}` ne peut pas la rejouer pour le hello de quelqu'un d'autre pendant la fenêtre anti-rejeu.

```js
auth: {
  url:    'https://mon-back.example.com/mjs-ws/connect',
  secret: 'env:MJS_WS_PROXY_SECRET',
  verifyResponse: true,   // défaut false — COMPATIBILITÉ : la recette ci-dessus (réponse NON signée)
                          // continue de marcher SANS aucun changement tant que cette option reste absente
},
```

Côté Rails — calculer `ts`/`sig` sur le corps de la **réponse** (pas celui de la requête) et poser les deux en-têtes **avant** `render` — la chaîne signée doit être **exactement** le corps envoyé, jamais reconstruite après coup :

```ruby
corps = autoriser_connexion(evt['hello']).to_json   # { ok:true, identity: {...} } ou { ok:false, raison: '...' }
ts    = Time.now.to_i
sig   = OpenSSL::HMAC.hexdigest('SHA256', ENV.fetch('MJS_WS_PROXY_SECRET'), "#{ts}.RESPONSE.#{request.fullpath}.#{request.headers['x-mjs-ws-signature']}\n#{corps}")
response.set_header('x-mjs-ws-timestamp', ts.to_s)
response.set_header('x-mjs-ws-signature', sig)
render plain: corps, content_type: 'application/json; charset=utf-8'
```

| Cas (réponse reçue par MJS-WS) | Décision |
|---|---|
| en-têtes `x-mjs-ws-timestamp`/`x-mjs-ws-signature` absents | refus (`null`, journalisé via `onLog('warn', …)`) |
| `x-mjs-ws-timestamp` hors fenêtre ± 300 s (§7.2) | refus |
| signature invalide (mauvais secret, corps altéré en chemin…) | refus |
| réponse signée pour une **autre** requête (rejouée) | refus |
| signature valide | réponse traitée normalement — `JSON.parse` puis la décision habituelle (`connect`/`subscribe`) |

`verifyResponse` est optionnel et **rétro-compatible** : **absent** (défaut `false`), la réponse est acceptée telle quelle — **exactement** la recette non signée ci-dessus, rien ne change tant que le back n'est pas mis à jour pour signer sa réponse.

### 7.12 Recettes côté serveur applicatif

Trois patrons éprouvés (application Rails hôte : chaîne Ruby stdlib → pont HMAC → deux navigateurs) — la manière de combiner §7.6 (jetons), §7.7 (pont) et §7.11 (proxy) côté back applicatif.

**a) Session héritée → jeton (Rails/PHP déjà authentifié).** Votre appli a **déjà** une session (cookie Rails/Devise, `$_SESSION` PHP) — `mjsWs` ne connaît rien de cette session, il ne parle **que** `µ:hello`/jeton. Deux façons d'y raccorder, **même** jeton produit par §7.6 (`signer_jeton`, jamais réinventé) :

*Le client échange son cookie contre un jeton (recommandé — le plus simple).* Une route Rails **ordinaire**, protégée par le middleware d'auth habituel (le navigateur y envoie donc déjà le cookie de session, sans rien faire de spécial), renvoie un jeton :

```ruby
# app/controllers/mjs-ws_tokens_controller.rb
class MjsWsTokensController < ApplicationController
  before_action :authenticate_user!   # middleware Devise/Rails habituel — rien de spécifique à MJS-WS

  def create
    jeton = signer_jeton({ id: current_user.id, pseudo: current_user.pseudo }, ENV.fetch('JWT_SECRET'), ttl: 3600)   # §7.6, réutilisée telle quelle
    render json: { token: jeton }
  end
end
```

```ruby
# config/routes.rb
post '/mjs-ws/token', to: 'mjs_ws_tokens#create'
```

Côté client, un `fetch` ordinaire **avant** d'ouvrir la socket (le cookie part tout seul, même origine) :

```civet
reponse       = await fetch('/mjs-ws/token', { method: 'POST' })
{ token }     = await reponse.json()
@sock         = µsocket "wss://jeu/play", { auth: { token } }
```

Côté serveur `mjsWs`, **rien** de plus que §7.6 : `auth: jwtAuth(process.env.JWT_SECRET)`.

*Alternative — `mjsWs` rejoue le cookie lui-même (`/auth-session`).* Si le client ne doit **jamais** voir de jeton (une seule requête, le handshake WS lui-même), `opts.auth` peut transmettre le cookie de la requête d'upgrade à une route Rails dédiée — `meta.headers` (§1) porte les en-têtes **bruts** de cette requête, `cookie` compris :

```js
const app = mjsWs({
  auth: async (hello, meta) => {
    const cookie = meta.headers?.cookie
    if (!cookie) return false
    const res = await fetch('https://mon-rails.example.com/auth-session', { headers: { cookie } })
    if (!res.ok) return false
    return await res.json()   // { id, pseudo, ... } — devient client.identity
  },
})
```

```ruby
# app/controllers/auth_session_controller.rb — vérifie la session Rails NORMALE (Devise/warden),
# ne réémet même pas de jeton : MJS-WS n'a besoin que de l'identité, pas d'un JWT ici
class AuthSessionController < ApplicationController
  before_action :authenticate_user!

  def show
    render json: { id: current_user.id, pseudo: current_user.pseudo }
  end
end
```

**Honnête** : ce 2ᵉ patron suppose que `mjsWs` et Rails partagent le **même** domaine (un cookie n'est scopé ni par port ni par sous-domaine par défaut — `wss://exemple.com:8080` reçoit bien le cookie posé par `https://exemple.com:3000`, `SameSite` compris tant que le site reste le même) ; sur deux domaines séparés, repassez par le 1ᵉʳ patron (jeton explicite, aucune dépendance à un cookie).

> ⚠️ **Ce patron exige `verifyOrigin`.** Le cookie part **tout seul** avec la requête d'upgrade, y compris depuis une page tierce (une ouverture WebSocket n'obéit pas à la politique des requêtes ordinaires) — sans `verifyOrigin`, n'importe quel site peut ouvrir une connexion authentifiée au nom du visiteur. Armez `verifyOrigin: ['https://mon-site.example']` (§3.3) avant de déployer ce patron.

*Le même patron, par le proxy de décisions (§7.11) — recommandé.* Le `connect` du proxy porte le `cookie` de la requête d'upgrade : la fonction `auth` ci-dessus devient une **option**, et vous récupérez au passage la signature HMAC, le `timeout` et le cache court sans écrire une ligne de crypto.

```js
const app = mjsWs({
  auth: {
    url:    'https://mon-rails.example.com/mjs-ws/connect',
    secret: 'env:MJS_WS_PROXY_SECRET',
    cache:  { ttl: 30000 },   // 30 s — une reconnexion en rafale (wifi qui saute) ne martèle pas Rails ; clé = hello + cookie, donc PAR visiteur
  },
  verifyOrigin: [ 'https://mon-site.example' ],   // §3.3 — OBLIGATOIRE avec ce patron, cf. l'avertissement ci-dessus
})
```

```ruby
# Rails — MÊME route que §7.11, la session se lit dans le cookie transmis
evt = JSON.parse(request.raw_post)
if evt['event'] == 'connect'
  user = User.from_session_cookie(evt['cookie'])   # votre propre lecture de session, à partir du Cookie brut
  return render(json: { ok: false, raison: 'session inconnue' }) unless user

  render json: { ok: true, identity: { id: user.id, pseudo: user.pseudo } }
end
```

**b) Salons dérivés d'un attribut d'identité (équipe, guilde…).** `client.identity` porte déjà ce qu'`auth` a retourné (§7.6/§7.11) — par exemple `equipe`. Le salon `equipe-<id>` n'a besoin d'**aucun** choix manuel côté utilisateur : c'est l'appli qui calcule le nom depuis l'identité, ET le serveur qui vérifie qu'elle n'en usurpe pas un autre :

```js
const app = mjsWs({
  auth:  jwtAuth(process.env.JWT_SECRET),   // identity.equipe vient du jeton (§7.6) — posé au login
  rooms: {
    join: (room, client) => {
      const m = room.match(/^equipe-(.+)$/)
      if (!m) return true                              // salons hors convention 'equipe-*' : libres (ou une autre garde)
      return m[1] === String(client.identity.equipe)    // seule SON équipe — jamais celle d'un autre
    },
  },
})
```

```civet
# côté client — le nom se CALCULE, l'utilisateur ne choisit jamais de salon
salon = @sock.room "equipe-#{identity.equipe}"
salon.on 'coup', (p)-> …
```

Si la décision vit dans Rails (roster d'équipe qui change en cours de partie, logique métier trop riche pour vivre dans `mjsWs`) : remplacez la fonction locale par le proxy de décisions (§7.11), **même** convention de nom de salon — la garde part côté back :

```js
rooms: { join: { url: 'https://mon-back.example.com/mjs-ws/subscribe', secret: 'env:MJS_WS_PROXY_SECRET' } },   // §7.11, inchangé
```

```ruby
# évt reçu : { event: 'subscribe', room: 'equipe-42', identity: { id: 7, equipe: 42, ... } } — §7.11
when 'subscribe' then render json: { ok: evt['room'] == "equipe-#{evt.dig('identity', 'equipe')}" }
```

**c) Pousser depuis un job Sidekiq/worker (hors requête web).** Le moteur de combat tourne dans un job — aucune connexion WS, aucune requête HTTP en cours. Il pousse par le pont (§7.7, `Realtime`, réutilisé **tel quel**, jamais une 2ᵉ implémentation) :

```ruby
# app/jobs/resolution_combat_job.rb
class ResolutionCombatJob
  include Sidekiq::Job

  def perform(partie_id)
    resultat = MoteurCombat.resoudre(partie_id)   # logique métier — hors sujet ici
    Realtime.rt_room(room: "partie-#{partie_id}", type: "partie-#{partie_id}/resultat", payload: { vainqueur: resultat.vainqueur_id, score: resultat.score })   # §7.7
    Realtime.rt_send(user: resultat.vainqueur_id, type: 'notif', payload: { texte: 'victoire !' })   # §7.7
  end
end
```

Rien de spécifique à Sidekiq dans `Realtime` (§7.7) — juste `Net::HTTP` + HMAC, appelable depuis **n'importe quel** contexte Ruby hors requête (job, rake task, console, callback ActiveRecord déjà illustré en §7.7).

---

<a id="reprise-session"></a>
## 8. La reprise de session — une micro-coupure ne perd rien

Le scénario que tout le monde connaît : votre utilisateur passe sous un tunnel, son wifi saute dix secondes, il verrouille son téléphone dans l'ascenseur. Sans reprise, c'est une **déconnexion complète** : il « part » (les autres le voient disparaître de la présence), il « revient » (delta join, webhook connect), et tout ce que le serveur lui a envoyé entre-temps — un message de chat, une notification, une expulsion de salon — est **perdu à jamais**. Avec la reprise : **l'utilisateur ne voit rien**, et les autres non plus. Il n'est jamais parti.

### 8.1 Activer — `resume`

```js
const app = mjsWs({
  // ... auth/welcome/rooms, comme d'habitude (§1) ...
  resume: true,                 // défauts : grâce 30 s, tampon 500 trames / 256 Ko
  // resume: { grace: 60000, maxBuffered: 1000, maxBytes: 524288 },   // ou réglé finement
})
```

| Réglage | Défaut | Rôle |
|---|---|---|
| `grace` | `30000` ms | Durée pendant laquelle un client coupé peut revenir reprendre sa session. |
| `maxBuffered` | `500` trames | Trames retenues au maximum pendant son absence. |
| `maxBytes` | `262144` (256 Ko) | Octets retenus au maximum (sérialisation comprise). |

**Opt-in strict** : sans `resume`, rien ne change — pas un octet de différence dans les trames, pas un timer de plus. Avec `mjs ws`, la clé se pose dans `mjs.config.json` (`ws.resume`, cf. §6.3) ou dans l'entry (`resume`), l'entry primant en bloc en cas de doublon (§6.4).

### 8.2 Comment ça marche, simplement

1. **Au `µ:welcome`**, le serveur glisse une carte de visite : `session: { id, key }` (aléatoire crypto). Le client `µ.socket` la range — **rien à coder côté client**.
2. **À la coupure** (peu importe la cause, sauf un `µ:bye`), le client n'est pas purgé : il est **parqué**. Ses salons et sa présence sont **conservés** — pour tout le monde, il est encore là (`app.clients`, `GET /presence` du pont et les webhooks `join`/`leave` le comptent toujours). Une minuterie de grâce démarre.
3. **Pendant la grâce**, tout ce qui lui est destiné (`app.send`, `room().send`, `broadcast`, et même le `µ:left` d'un kick de salon) est **tamponné** au lieu d'être envoyé.
4. **À son retour**, le client rejoue `{ id, key }` dans son `µ:hello`. L'auth normale tourne **d'abord** (une reprise n'est jamais un contournement — le jeton est re-vérifié comme toujours), puis la clé est comparée à temps constant et l'identité doit être la même. Tout est bon ? Le **même** client est recyclé : `µ:welcome` avec `resumed: true`, le même `session.id`, une **clé neuve** (la clé tourne à chaque welcome — une clé volée hier ne vaut rien aujourd'hui), puis le tampon est rejoué **dans l'ordre**, juste après le welcome. Aucun delta de présence n'est émis, aucun webhook `connect`/`disconnect` : il n'est jamais parti.
5. **Sans retour à temps** : à l'expiration de la grâce seulement, la purge historique complète a lieu — leave de présence (agrégé : si l'utilisateur a un autre onglet vivant, rien ne part), purge des salons, et webhook `disconnect` du pont, **différé à ce moment-là**. `opts.onDisconnect` (§1) tire **au même instant** — c'est le seul signal générique d'une déconnexion vraiment définitive.

Échec de reprise (session inconnue ou expirée, clé fausse, identité différente, tampon débordé) → accueil **frais** classique, `resumed: false`, sans erreur ni fuite d'information — exactement comme un premier arrivant.

> Côté client, lisez l'accueil via `sock.on('welcome', …)` et `sock.resumed` — la charge complète du `µ:welcome` (sans la carte de session) et le booléen de reprise, cf. [20 · Temps réel](20-temps-reel.md).

### 8.3 Ce qui est rejoué, et ce qui ne l'est pas

| Pendant l'absence | Au retour |
|---|---|
| Messages applicatifs (`app.send`, `room().send`, `broadcast`) | **Rejoués**, dans l'ordre, juste après le `µ:welcome`. |
| `µ:left` (kick de salon d'un parqué) | **Rejoué** — une expulsion pendant l'absence doit arriver. |
| Deltas de flux (`app.stream`, trames à `seq`) | **Jamais tamponnés** : le client redemande lui-même la suite (`µ:resync { from }`, cf. §5) — les rejouer en plus créerait des doublons. Le journal du flux fait le travail, au numéro près. |
| État complet d'un flux (`reset`) accordé pendant l'absence | **Rejoué** — un abonnement accepté pendant la grâce (garde asynchrone qui a répondu entre-temps) : sans lui, le client repris n'aurait aucun état de départ pour ce flux. |
| `µ:presence` | **Jamais tamponné** : le `µ:sub-presence` du retour renvoie une photo complète — plus simple et toujours juste. |
| `µ:ping` / `µ:pong` / `µ:error` | Jamais tamponnés — battement et erreurs n'ont de sens qu'en direct. |

**Le tampon est borné** (`maxBuffered` trames OU `maxBytes` octets) : au débordement, la session devient **non reprenable** — au retour, accueil frais. Jamais de rejeu partiel : la moitié d'une histoire est pire que pas d'histoire du tout (l'application croirait avoir tout reçu).

### 8.4 La limite à connaître

Les sessions vivent **en mémoire, par processus** : un client qui revient doit retomber sur le **même** process `mjsWs`. Sur une machine unique, rien à faire. En multi-processus/multi-machines (répartition de charge), il faut l'adaptateur Redis (§9) — mais la reprise elle-même reste **locale** au process : cf. §9.6 pour le détail (répartiteur collant).

### 8.5 Session exclusive par identité — `sessionExclusive`

Un utilisateur ouvre un 2e onglet, ou reconnecte depuis un autre appareil, **avec la même identité** (`identity.id`) — par défaut, MJS-WS laisse cohabiter les deux connexions (comme n'importe quel autre utilisateur : rien ne change). Certaines applications (jeux compétitifs, ressources limitées par utilisateur, anti-triche) veulent l'inverse : **une seule connexion par identité**. Deux logiques opposées, **deux** modes opt-in :

- **`'replace'`** (≡ `true`) — la nouvelle connexion gagne, l'ancienne est évincée. Comportement historique.
- **`'refuse'`** (inverse) — l'existant gagne, la nouvelle connexion est refusée tant que l'ancienne vit.

```js
const app = mjsWs({
  auth: (hello) => ({ id: hello.auth.userId }),   // sessionExclusive a besoin d'un identity.id
  sessionExclusive: 'replace',                    // ou 'refuse' (inverse) ; désactivé par défaut ; true ≡ 'replace'
})
```

#### Mode `'replace'` (≡ `true`) — la nouvelle connexion gagne

Au `µ:hello` **frais** (jamais sur une reprise, §8 — un retour de session n'est jamais un « 2e hello ») d'une identité déjà connue :

1. Toute **autre** connexion **vivante** de cette identité reçoit `µ:bye { reason: 'replace' }` puis une fermeture **définitive**, code **4003** — jamais parquée ni reprise, même si `resume` est actif. Son nettoyage (salons, présence) suit le chemin normal d'un départ définitif.
2. Si `resume` est actif et qu'une session de cette identité est encore **parquée** (l'ancien onglet a coupé mais sa grâce n'a pas expiré), elle est révoquée elle aussi — sinon l'ancien onglet pourrait « reprendre » sa place en douce à sa reconnexion (la révocation la rend simplement introuvable : accueil frais, jamais `resumed: true`).
3. Multi-processus (§9) : l'éviction se propage aux autres process via l'adaptateur — même patron que `room().kick()`.

#### Mode `'refuse'` (inverse) — l'existant gagne

Au `µ:hello` **frais** d'une identité déjà connue :

1. S'il existe déjà une connexion **vivante** de cette identité, le nouveau hello est **refusé** tel quel : `µ:denied { message: 'session déjà active pour cette identité' }` puis fermeture **définitive**, code **4004**. La connexion existante n'est **jamais** touchée — elle continue d'échanger normalement.
2. S'il n'existe **que** des sessions **parquées** de cette identité (ou aucune connexion du tout), le nouveau hello est accueilli normalement, et les sessions parquées sont révoquées (même mécanisme qu'en mode `'replace'`) — sinon l'ancien onglet parqué pourrait « reprendre » sa place en douce à sa reconnexion.
3. Multi-processus (§9) : `sessionExclusive: 'refuse'` garantit l'exclusivité **par process** seulement — `clientsByIdentity` (l'index qui sait « qui est vivant ») est une structure **locale** à chaque process `mjsWs`, jamais répliquée. Derrière un répartiteur de charge multi-process, un hello frais qui atterrit sur un **autre** process que la connexion vivante n'est actuellement **pas** refusé (aucune requête cluster synchrone n'a été ajoutée — limite v1 assumée, sur-ingénierie évitée) : il est **accueilli** normalement, comme au point 2. **Ce hello accueilli ne touche cependant jamais une session vivante ailleurs dans le cluster** — seules les sessions **parquées** de cette identité, sur **n'importe** quel process, sont purgées à travers le canal `identity:kick` (même garde-fou que le nettoyage local du point 2, propagée). Une connexion vivante distante, elle, continue d'échanger sans interruption — le pire cas observable est donc « deux connexions vivantes coexistent, une par process », jamais « une session vivante tuée à distance ». Sur une machine unique (un seul process), l'exclusivité reste totale.

Une identité **anonyme** (`auth` qui ne pose jamais `id`, cf. `identityIdOf`) n'est **jamais** concernée, quel que soit le mode : `sessionExclusive` n'a d'effet qu'entre connexions d'une **même** identité connue.

> ⚠️ Présence **agrégée par identité** (§4) : en mode `'replace'`, si la nouvelle connexion rejoint la présence globale avant que l'ancienne ne soit purgée (c'est le cas), l'identité ne « disparaît » jamais aux yeux des autres — comme n'importe quel changement d'onglet. Seules les présences de **salon** auxquelles seule l'ancienne connexion avait adhéré émettent un vrai `leave`. En mode `'refuse'`, la connexion refusée n'a jamais rejoint quoi que ce soit (refusée avant le `µ:welcome`) — aucun impact sur la présence.

Avec `mjs ws` (§6), la clé se pose aussi dans `mjs.config.json` (`ws.sessionExclusive`, booléen ou `'replace'`/`'refuse'`) ou dans l'entry (`sessionExclusive`), l'entry primant en bloc en cas de doublon (§6.4).

---

<a id="adaptateur-redis"></a>
## 9. Plusieurs processus — l'adaptateur Redis

Jusqu'ici, tout ce chapitre suppose **un seul process** `mjsWs`. En pratique, dès que le trafic grossit, on fait tourner **plusieurs process** derrière un répartiteur de charge — PM2 en mode cluster, plusieurs conteneurs, plusieurs machines. Problème : chaque process ne connaît que **ses propres connexions WebSocket**. Sans coordination, `app.broadcast()` posé sur le process A n'atteint **que** les clients connectés à A — ceux connectés à B ou C ne voient rien. L'**adaptateur** résout ça : chaque process publie ce qu'il fait sur un canal partagé (Redis), et rejoue ce que les **autres** process publient — comme si tout le monde tournait dans le même process.

### 9.1 Activer — `opts.adapter`

```js
const app = mjsWs({
  // ... auth/welcome/rooms/etc., comme d'habitude (§1) ...
  adapter: {
    redis:  'redis://127.0.0.1:6379',   // ou 'redis://:motDePasse@hôte:port/base', 'redis://utilisateur:motDePasse@…'
    // prefix: 'mjs-ws',                 // défaut — espace de noms des canaux/clés Redis
  },
})

await app.listen()   // démarre le WebSocket, LE CLUSTER, puis le pont si activé
```

| Option | Défaut | Rôle |
|---|---|---|
| `redis` | — (**obligatoire**) | URL Redis complète : `redis://[[utilisateur]:motDePasse@]hôte[:port][/base]`. L'utilisateur (ACL de Redis 6 et plus) part dans `AUTH` avec le mot de passe ; un Redis antérieur à la version 6 refuse un nom : la connexion se fait alors avec le mot de passe seul, avec un avertissement. |
| `prefix` | `'mjs-ws'` | Espace de noms des canaux/clés — changez-le si **plusieurs** applis différentes partagent le **même** Redis (sinon leurs flux/présences se mélangeraient). |

`opts.adapter` accepte aussi directement une **instance** déjà construite (un `MemoryAdapter` en test, ou un adaptateur maison qui implémente l'interface `MjsWsAdapter`) — utile pour les tests d'appli (2+ apps `mjsWs` dans le même process, reliées par un bus en mémoire au lieu d'un vrai Redis).

Avec `mjs ws` (§6), ça se configure aussi dans `mjs.config.json` (`ws.adapter`, **mêmes** clés) ou dans l'entry (`adapter: {...}`) — même règle que `bridge`/`resume` : si les **deux** sont posés, l'entry prime EN **bloc** et un avertissement vous le signale. La bannière de démarrage affiche `multi-processus : redis://... (préfixe MJS-WS)`.

**Aucune dépendance ajoutée** : ni `redis`, ni `ioredis`. Le client Redis est un mini-client RESP écrit à la main sur `node:net`/`node:crypto` — le protocole texte de Redis (`PING`, `PUBLISH`, `SUBSCRIBE`, `INCR`, `SET`/`GET`/`DEL`, `SCAN`) est simple, et MJS-WS n'en a besoin que d'un sous-ensemble minuscule.

### 9.2 Ce qui traverse, simplement

| Action | Comportement multi-processus |
|---|---|
| `app.broadcast(type, p)` | Chaque process diffuse à **ses** clients authentifiés. |
| `app.room(nom).send(...)` | Chaque process diffuse à **ses** membres **locaux** de ce salon. |
| `app.room(nom).kick(...)` | Le membre visé est expulsé sur **quel que** process il se trouve. |
| `POST /send` (pont, `user`) | Toutes les connexions de cet utilisateur reçoivent, sur **tous** les process. |
| `app.stream(nom).add/update/remove/reset(...)` | Numéroté **globalement** (§9.3), appliqué et diffusé sur **chaque** process. |
| Présence (`µ:presence`, `GET /presence`) | **Fusionnée** — montre les pairs de **tous** les process (§9.4). |
| Sessions (reprise, §8) | Restent **locales** — jamais partagées entre process (§9.5). |

**Le principe, simplement :** chaque process applique **d'abord** localement (ses propres clients voient l'effet immédiatement, sans même passer par Redis), **puis** publie un petit message sur Redis pour dire aux autres process « fais pareil ». Les autres process reçoivent ce message et l'appliquent à **leurs** propres clients — jamais à celui qui a produit le message (chaque message porte l'identité du process qui l'a émis, et ce process s'ignore lui-même). Le pont universel (§7) profite de tout ça **gratuitement** : un `POST /broadcast` reçu par **n'importe quel** process touche toute la flotte, puisque `app.broadcast()` lui-même est déjà multi-processus.

### 9.3 Les flux à travers plusieurs process — le numéro doit rester **unique**

Un flux (§5) numérote chaque mutation (`seq`, strictement croissant). Avec un seul process, un simple compteur local suffit. Avec **plusieurs** process qui peuvent tous les deux appeler `.add()` au même instant, un compteur local ferait des **doublons** (A et B produiraient chacun leur propre « seq 12 ») — le client ne saurait plus s'y retrouver.

**La solution :** le seq devient un compteur **partagé** dans Redis (`INCR`). Avant d'appliquer sa mutation, un process demande à Redis « donne-moi le prochain numéro » — Redis répond un nombre **unique**, jamais donné deux fois, même si dix process le demandent à la même microseconde. Le process applique ensuite localement **avec** ce numéro, et le publie aux autres.

Conséquence pratique : `add()`/`update()`/`remove()`/`reset()` restent des méthodes qu'on appelle sans `await`, mais avec l'adaptateur actif, leur effet n'est plus instantané — il attend l'aller-retour Redis (quelques millisecondes). Sans adaptateur, rien ne change (compteur local, toujours instantané).

**Et si deux messages arrivent dans le désordre ?** Le réseau ne garantit pas l'ordre d'arrivée entre deux publications de **deux** process différents. Chaque process garde donc un petit **tampon de réordonnancement** (100 deltas en attente au maximum, par flux) : un delta qui arrive « trop tôt » (un trou avant lui) est mis de côté jusqu'à ce que le trou se comble. Si le trou ne se comble pas sous 2 secondes (ou si le tampon déborde), le process applique quand même ce qu'il a, dans l'ordre, en sautant le trou — avec un avertissement dans `onLog`. Le client qui détecte un saut de numéro (`seq` en avance sur ce qu'il attendait) redemande automatiquement un rattrapage (`µ:resync`, §5) — le système s'auto-corrige. Un flux détruit sur chaque process puis redéclaré (§5) reprend la numérotation de l'ancien : son premier delta n'attend pas dans ce tampon.

Un `µ:resync` couvre aussi bien les deltas produits localement que ceux venus d'un **autre** process : une fois appliqué, un delta distant rejoint le **même** journal que les deltas locaux.

**Un flux gardé le reste sur toute la flotte.** Chaque delta publié annonce la garde de son flux : le salon exigé (`room`, que chaque process contrôle sur **ses** membres) et l'existence d'une fonction `canSubscribe` (une fonction ne voyage pas). Un process qui reçoit les deltas d'un flux gardé par `canSubscribe` sans l'avoir déclaré refuse donc tout abonnement, tant que son code ne déclare pas ce flux avec sa propre `canSubscribe` : déclarez vos flux gardés de la même façon sur chaque process. L'ouverture voyage de même : un flux ouvert (`public: true`) est servi par tous les process, déclaré ou non ; un flux fermé (déclaré sans accès) ne l'est par aucun. Exception : un flux écrit par le pont sur un process qui ne l'a pas déclaré (§7) est annoncé comme tel avec ses deltas, et tout process qui ne le déclare pas lui-même le refuse — déclarez sur chaque process les flux que votre back écrit par le pont.

**Pendant une mise à jour progressive.** Quand vous remplacez vos processus un à un, d'anciens et de nouveaux tournent un temps sur le même Redis. Un processus d'une version antérieure à la 3.0.0 ne lit pas cette annonce (`declared: false`) : il sert un flux écrit par le pont à tous ses clients, comme un flux public, si son propre code ne le déclare pas avec sa garde. Et un flux qu'un ancien processus écrit (par le pont ou par son code) part sans annonce : les nouveaux ne le servent à personne tant que leur code ne le déclare pas, ouvert ou avec sa garde. Avant de commencer, déclarez donc au démarrage de chaque processus, dans l'ancienne version comme dans la nouvelle, tous les flux que votre back écrit par le pont : `app.stream(nom, { room | canSubscribe })` pour un flux privé, `app.stream(nom, { public: true })` pour un flux public (une version antérieure à la 3.0.0 ignore l'option : un flux sans garde y est public) — chaque processus applique alors sa propre garde, sans dépendre de l'annonce. Si l'ancienne version ne peut plus changer, n'écrivez aucun flux privé par le pont tant qu'un ancien processus tourne, ou arrêtez-les tous avant de démarrer les nouveaux.

### 9.4 La présence fusionnée — qui est là, sur **toute** la flotte

Chaque process connaît la présence de **ses** propres clients (§4). Pour savoir qui est là sur **toute** la flotte, chaque process publie ses propres arrivées/départs (`join`/`leave`, globaux et par salon) et écoute ceux des autres — il tient alors une vue **fusionnée** : la sienne (réelle, liée à ses connexions) plus celle des autres (un miroir, alimenté par ce qu'ils publient). `GET /presence` (pont) et les abonnements `µ:presence` lisent cette vue fusionnée — un client connecté au process A voit apparaître/disparaître les utilisateurs connectés au process B exactement comme s'ils étaient sur A.

**Même identité sur plusieurs process à la fois** (deux onglets, chacun routé vers un process différent par le répartiteur de charge) : même garantie que l'agrégation multi-onglets d'un seul process (§4) — un `join`/`leave` n'est publié qu'à la transition **0↔1** de la présence FUSIONNÉE de cette identité, jamais à chaque source individuelle. Le départ de l'onglet connecté à B ne fait donc jamais « clignoter » quelqu'un qui reste connecté sur A.

**Et si un process meurt brutalement** (crash, kill -9, machine coupée) — sans prévenir personne ? Ses pairs resteraient « fantômes » indéfiniment dans la vue des autres. Le **bail de vie** règle ça : chaque process pose une petite clé dans Redis avec une durée de vie de 10 secondes (`SET ... EX 10`), et la renouvelle toutes les ~3 secondes tant qu'il est vivant. Les autres process vérifient périodiquement (même cadence, ~3 s) que les process dont ils connaissent des pairs distants ont **toujours** un bail vivant. Dès qu'un bail a expiré (le process n'a pas renouvelé — mort, ou réseau coupé), ses pairs distants sont purgés **partout** ailleurs, avec les `leave` correspondants envoyés aux abonnés locaux — exactement comme une vraie déconnexion.

### 9.4bis Anti-entropie de présence

Le bail ci-dessus ne corrige que la mort d'un process **entier** — un pair fantôme ou manquant sur un process resté **vivant** (coupure Redis brève, message pub/sub perdu) peut y survivre indéfiniment, puisque rien ne le détecte. Chaque process publie donc, toutes les **15 secondes** (configurable), un instantané compact de sa présence **locale** ; les autres le comparent à leur vue distante de ce process précis et corrigent les écarts EN **silence** (pair inconnu → `join`, pair disparu → `leave`, avec les **mêmes** trames `µ:presence` que d'habitude) — un instantané déjà conforme à la vue locale ne produit ni trame ni mutation.

Se désactive avec `antiEntropy: false` (racine des options `mjsWs()`, ou `ws.adapter.antiEntropy` dans `mjs.config.json`/l'entry) — comportement alors identique à avant ce mécanisme.

### 9.5 Sessions et reprise — restent **locales**

La reprise de session (§8) vit **en mémoire, par process** — l'adaptateur ne la rend **pas** globale. Un client qui revient après une coupure doit retomber sur le **même** process pour que sa session soit reconnue ; s'il retombe sur un **autre** process (répartiteur qui l'envoie ailleurs), ce process ne connaît pas sa session → accueil **frais**, automatiquement et sans erreur (c'est déjà le comportement par défaut d'une session inconnue, §8.2 — rien à coder de plus).

**Pour profiter de la reprise en multi-processus :** configurez votre répartiteur de charge en **sessions collantes** (« sticky sessions » — chaque client WebSocket est ré-envoyé au **même** process tant que sa connexion tient). Nginx (`ip_hash` ou un cookie), HAProxy, la plupart des load balancers cloud savent le faire. Sans ça, la reprise ne casse rien (elle échoue juste silencieusement, accueil frais) — mais elle ne sert à rien non plus.

### 9.6 Coupure Redis — la limite honnête

L'adaptateur reconnecte tout seul en cas de coupure Redis (backoff 1 s, 2 s, 5 s, 10 s — puis reste à 10 s). Pendant la coupure :

- Les **publications** (broadcast, salon, présence…) échouent silencieusement côté émetteur — un avertissement dans `onLog`, jamais un crash ni un blocage. Les clients **locaux** du process ne sont pas affectés (l'application locale a déjà eu lieu **avant** la publication, §9.2).
- Les **deltas de flux** produits par un **autre** process **pendant** la coupure ne sont jamais reçus — à la reconnexion, rien ne les rattrape automatiquement (Redis pub/sub n'a pas de mémoire : un message publié pendant que vous n'écoutiez pas est perdu pour toujours, contrairement au journal **local** d'un flux, §5, qui lui ne connaît pas Redis). **Conséquence honnête : une divergence est possible** entre les process pendant/après une coupure Redis.
- **Le remède pratique :** un `stream.reset(valeurs)` (n'importe quel process, une fois Redis revenu) republie l'état complet et fait repartir tout le monde de la **même** photo — la façon la plus simple de refermer une divergence.
- **La solution complète** (aucune perte, même pendant une coupure) demanderait un journal **persistant** côté Redis (Redis Streams, avec relecture depuis le dernier point vu) — hors périmètre de cette étape, notée comme piste pour plus tard.

### 9.7 Zéro dépendance — le mini-client Redis maison

Les baux de vie (§9.4) se listent par `SCAN`, lot après lot, jamais par `KEYS` : `KEYS` parcourt toute la base d'un bloc et fige Redis pendant ce temps, un vrai coût sur un Redis partagé avec d'autres usages (sessions, files de tâches…). Un message mal formé reçu sur un canal de l'adaptateur (autre application sur le même Redis, outil d'administration, version voisine pendant une mise à jour) est ignoré, avec un avertissement dans `onLog` au plus une fois par minute et par canal, qui compte ceux ignorés entre-temps : jamais un arrêt du process.

Aucun paquet `redis`/`ioredis`/`node-redis` n'est ajouté. `src/mjs-ws/adapter-redis.ts` parle directement le protocole texte de Redis (RESP) sur une connexion `node:net` brute : encodage des commandes (`PING`, `PUBLISH`, `SUBSCRIBE`, `INCR`, `SET ... EX`, `GET`, `DEL`, `SCAN`), et un petit parseur **incrémental** qui sait reconstituer une réponse même arrivée en plusieurs morceaux sur le réseau (TCP ne respecte pas les frontières de message). Deux connexions par process — une dédiée aux abonnements (`SUBSCRIBE`), une aux commandes — parce que Redis l'exige (une connexion abonnée ne peut plus parler qu'un sous-ensemble limité de commandes).

### 9.8 Tester sans Redis — `MemoryAdapter`

Comme `MemoryTransport` (transport en mémoire, pour les tests) a son pendant : `MemoryAdapter`, un bus **partagé** en mémoire, à donner à plusieurs `mjsWs()` **dans le même** process de test — simule fidèlement plusieurs process réels (même filtrage « je m'ignore moi-même », même compteur global pour les flux, même mécanique de bail de vie avec horloge injectable pour simuler une expiration sans vrai délai).

```js
import { mjsWs, MemoryAdapter, createMemoryAdapterBus } from 'modularjs-framework/ws'

const bus  = createMemoryAdapterBus()
const appA = mjsWs({ adapter: new MemoryAdapter({ bus }), /* ... */ })
const appB = mjsWs({ adapter: new MemoryAdapter({ bus }), /* ... */ })
// appA.broadcast(...) est reçu par les clients connectés à appB, et réciproquement
```

Comme l'adaptateur Redis, `MemoryAdapter` rattrape un rappel d'abonnement qui lève : les autres rappels reçoivent le message, et un avertissement part dans son option `onLog` (la console par défaut), regroupé par canal (un par minute au plus) — passez-lui le même `onLog` que votre app (`new MemoryAdapter({ bus, onLog })`).

---

<a id="etat-serveur"></a>
## 10. L'état du serveur

Un registre de compteurs **léger** — connexions, messages, salons, flux, garde, pont, adaptateur, sessions, intervalles entre deux pings, erreurs/avertissements — tourne **en permanence** dans `mjsWs`, sans configuration : `app.stats()` renvoie un instantané JSON à tout moment (uptime, id de processus, mémoire, et toutes les familles ci-dessus). Le coût est négligeable (des `++` sur des compteurs déjà là), donc ce registre n'a **pas d'interrupteur** — seule son **exposition en HTTP** (sur le pont, §7) est une option.

### 10.1 Activer — `opts.stats`

```js
const app = mjsWs({
  bridge: { secret: 'env:MJS_WS_BRIDGE_SECRET' },   // requis pour SERVIR les endpoints en HTTP
  stats:  true,
})
```

`stats: true` ajoute trois endpoints au pont (§7) :

| Endpoint | Rôle |
|---|---|
| `GET /stats` | Le même instantané que `app.stats()`, en JSON. |
| `GET /metrics` | Le même instantané, au format texte **Prometheus** (`# TYPE mjs_ws_x gauge` puis `mjs_ws_x 3`, tous les noms préfixés `mjs_ws_`, intervalle entre deux pings en `mjs_ws_ping_interval_p50_ms`/`mjs_ws_ping_interval_p95_ms`). |
| `GET /state` | Une page HTML **sombre**, autonome (aucune ressource externe), qui affiche une grille de cartes par famille et se rafraîchit toute seule toutes les 2 s (`fetch('/stats')`, même origine). Pratique pour un coup d'œil en dev, sans outil externe. |

La famille `intervallesPing` (`p50`, `p95`, `echantillon`, en ms) mesure l'**intervalle entre deux `µ:ping`** reçus d'une même connexion, c'est-à-dire à peu près la période du battement du client (15 000 ms par défaut) — **pas** un aller-retour : le serveur seul ne peut pas mesurer l'aller-retour, le client ne répondant pas à un ping du serveur. L'aller-retour se lit côté client (`sock.latency`, [20 · Temps réel](20-temps-reel.md)).

Sans `opts.bridge`, `stats: true` n'a **aucun effet observable** : il n'y a pas de serveur HTTP pour servir ces trois routes. Sans `opts.stats` (défaut), ces trois routes répondent **404** (même pont, mêmes autres endpoints) — mais `app.stats()` fonctionne quand même, tout le temps.

### 10.2 La règle de signature — loopback = libre, distant = signé

Ces trois endpoints suivent la **même** règle de signature que le reste du pont (§7.2, HMAC-SHA256) — **sauf un cas** : si le pont écoute sur `127.0.0.1` ou `::1` (le défaut), `/stats`, `/metrics` et `/state` répondent **sans aucune signature**. C'est un outil de dev local : sur votre machine, un simple `curl http://127.0.0.1:4001/state` ou un onglet de navigateur suffit, pas besoin de fabriquer une requête signée à la main.

Sans signature, ces pages (et `/heatmap`, `/heatmap.json`, §4.5) ne répondent qu'à un en-tête `Host` qui nomme la machine elle-même : `localhost`, `127.0.0.1` ou `[::1]`, quel que soit le port (un tunnel `ssh -L` garde son nom local). Tout autre nom, ou aucun, reçoit un **403** : une page web ouverte dans votre navigateur ne peut pas lire l'état du serveur en faisant pointer son propre nom de domaine vers 127.0.0.1 (rebinding DNS).

Le pont est **interne** : il a son propre port (par défaut celui du WebSocket + 1, §7), il écoute sur `127.0.0.1`, et seul votre back l'appelle. Votre proxy (nginx, §3.5) ne transmet aux visiteurs que le port du WebSocket, celui où se connectent les navigateurs ; jamais celui du pont. Un proxy de la même machine qui relaierait le pont serait, vu du pont, un appel local : ces pages répondraient alors sans signature à n'importe qui.

Dès que le pont écoute ailleurs (`host` configuré à autre chose que loopback — accessible depuis le réseau), la signature redevient **obligatoire partout**, sans exception : ces trois endpoints exposent l'état interne du serveur, jamais sans preuve d'identité en dehors de la machine elle-même. Cette question (« le host est-il loopback ? ») est tranchée à un **seul** endroit (`isLoopbackHost`, exportée), réutilisé pour la gate de signature ET pour la bannière de `mjs ws` (qui n'affiche le lien `état : http://…/state` que lorsqu'il est vraiment cliquable sans signature).

### 10.3 Stats par processus — la limite honnête avec l'adaptateur

Le registre est **local à chaque processus** — il ne connaît que ce que CE process a vu passer. Avec l'adaptateur multi-processus (§9), chaque process `mjsWs` a le **sien**, jamais fusionné automatiquement : `app.stats()` (ou `GET /stats`) sur le process A ne montre **que** l'activité de A, pas celle de B ou C. Pour une vue de toute la flotte, votre back interroge `GET /stats` sur **chaque** process (round-robin derrière le répartiteur, ou une adresse directe par process) et additionne côté back — exactement comme `GET /presence` (§9.4) le ferait s'il n'était pas, lui, fusionné en interne. Deux compteurs de la famille `adaptateur` (`ignoresOrigin`, `reconnexions`) restent à `0` avec l'adaptateur Redis à ce stade (câblés pour `MemoryAdapter`, dont le bus en mémoire les expose directement ; l'instrumentation du mini-client Redis pour ces deux-là reste à faire) — `publies`, `recus` (pub/sub cross-process) et `reordonnances` (tampon de réordonnancement des flux, §9.3) sont, eux, exacts avec les deux adaptateurs.

<a id="contrat-type"></a>
## 11. Contrat typé (optionnel) — auto-complétion + erreurs de compilation

`serve`/`on`/`send`/`request` acceptent un nom de type en **chaîne libre** — pratique, mais rien
n'empêche un `.server.mjs` et un composant `.mjs` de diverger silencieusement (un `prix` renommé
`prixTTC` côté serveur, l'ancien nom continue de compiler côté client, l'erreur n'apparaît qu'au
run). `src/mjs-ws/contract.ts` ajoute une **surcouche de typage optionnelle** — patron [tRPC](https://trpc.io)
adapté à MJS : l'appli déclare UN contrat TypeScript partagé, importé **en type** des deux côtés.
Toucher un mauvais payload, un nom de type inconnu, ou un mauvais type de retour devient une
erreur `tsc`, avant même d'ouvrir le navigateur.

### 11.1 La réalité, honnêtement

Un `.server.mjs` et un composant `.mjs` sont compilés **séparément** (dialecte Civet propre à
chacun, cf. §6.1/§13) — il n'existe **aucun lien runtime** entre les deux. Le contrat ne change
rien à ça : c'est un fichier `.ts` **ordinaire**, importé `import type { ... }` des deux côtés au
moment où **l'outillage TypeScript de votre appli** (votre éditeur, votre `tsc` à vous, pas celui de
ModularJS) type-checke vos fichiers — jamais exécuté, jamais bundlé. `asTypedApp`/`asTypedSocket`
sont des fonctions qui **renvoient leur argument tel quel** :

```ts
export function asTypedApp<C extends MjsWsContract>(app: MjsWsApp, contract?: C): TypedApp<C> {
  return app as TypedApp<C>
}
```

Zéro branche nouvelle, zéro octet ajouté au bundle client, zéro coût serveur — seulement des
`type`/`interface`/generics, effacés à la compilation comme n'importe quelle annotation TS.

### 11.2 Le contrat partagé

```ts
// contrat.ts — partagé entre ws.server.mjs et vos composants, importé EN TYPE des deux côtés
import type { MjsWsContract } from 'modularjs-framework/ws'

export interface MonContrat extends MjsWsContract {
  serves: {
    achat: (p: { prix: number }) => { solde: number }
  }
  sends: {
    chat: { texte: string; auteur: string }
  }
}
```

Les trois clés de `MjsWsContract` (`serves`, `sends`, `presences`) sont **optionnelles** —
adoption incrémentale : un contrat qui ne déclare que `sends` laisse `serve`/`request` aussi
libres qu'aujourd'hui. `extends MjsWsContract` n'est même pas obligatoire, le typage structurel de
TS suffit — une interface qui a la même forme convient.

### 11.3 Côté serveur — `ws.server.mjs`

```civet
import type { MonContrat } from './contrat.ts'
@import asTypedApp 'modularjs-framework/ws'

export default {
  auth: (hello)-> hello.auth?.token is process.env.SECRET and { id: hello.auth.userId }

  setup: (app)->
    typed = asTypedApp<MonContrat>(app)
    typed.serve 'achat', (p, client)->
      throw new Error('solde insuffisant') if p.prix > 100
      { solde: 100 - p.prix }                      # p.prix inféré number, retour vérifié {solde}

    typed.on 'chat', (p, client)-> typed.broadcast('chat', p, { except: client })
}
```

### 11.4 Côté client — un composant `.mjs`

```civet
<script>
  import type { MonContrat } from '../contrat.ts'
  import { asTypedSocket } from 'modularjs-framework/ws'

  sock  = µ.socket('wss://jeu/play')
  typed = asTypedSocket<MonContrat>(sock)

  achete = ->
    try
      resp = await typed.request('achat', { prix: 40 })   # résultat inféré {solde: number}
      µ.log "nouveau solde : #{resp.solde}"
    catch e
      µ.error 'achat refusé :', e
</script>
```

### 11.5 Ce que `tsc` attrape

Renommez `achat` en `achatTTC` côté serveur (ou changez la forme de `p`) sans toucher au client :

```ts
await typed.request('achat', { prix: 40 })
//                   ~~~~~~~
// error TS2345: Argument of type '"achat"' is not assignable to parameter of type '"achatTTC"'.
```

Un mauvais payload (`{ pri: 40 }` au lieu de `{ prix: 40 }`) ou un mauvais type de retour côté
`serve` (`{ sold }` au lieu de `{ solde }`) donnent le même genre d'erreur, **avant** de lancer
quoi que ce soit — cf. `tests/contract-types.test.ts` pour la liste vérifiée (chaque cas y est
prouvé par un `// @ts-expect-error` que `tsc --noEmit` doit valider).

`TypedApp<C>`/`TypedSocket<C>` ne bornent que `serve`/`on`/`send`/`sendUser`/`request`/`presence`
— `room`/`stream`/`broadcast`/`schema`/`stats`… traversent **inchangés**, aussi libres qu'avant.
Pour le contrat d'un jeu (`app.game`/`sock.game`), cf. [24 · MJS-Server « Contrat typé »](24-mjs-server.md#contrat-type-jeu).

---

<a id="transport-facade"></a>
## 12. La façade transport : brancher uWebSockets.js (ou autre chose)

Tout ce que `mjsWs` fait avec le réseau passe par **une** interface, `MjsWsTransport` — le cœur du protocole (§1-§10) ne connaît **jamais** `ws` ni un socket natif directement. `opts.transport` (§1) accepte trois formes :

| Forme | Résultat |
|---|---|
| absent, ou `'ws'` | `WsTransport` — bibliothèque [`ws`](https://github.com/websockets/ws), déjà une dépendance de ModularJS, rien à installer. **Le défaut.** |
| `'uws'` | `UwsTransport` — [uWebSockets.js](https://github.com/uNetworking/uWebSockets.js), pour les très gros volumes de connexions (§12.1). Paquet natif à installer À **part** (§12.3) — **pas** une dépendance de ModularJS. |
| une instance déjà construite | Utilisée **telle quelle** — `MemoryTransport` en test (§2, aucun socket réseau), ou un transport **maison** (§12.4) qui parle un tout autre canal bas niveau. |

```js
import { mjsWs } from 'modularjs-framework/ws'

const app = mjsWs({ transport: 'uws', /* ...auth/welcome/rooms, comme d'habitude (§1)... */ })
await app.listen()
```

Avec `mjs ws` (§6), le choix se fait aussi dans `mjs.config.json` (`ws.transport: 'ws'|'uws'`, validation stricte avec suggestion orthographique sur une faute de frappe) ou dans l'entry (`transport: new MonTransport()`, une **instance** — la config JSON ne peut exprimer qu'une chaîne) : même règle que `heartbeat`/`limits` (§6.4), l'entry prime EN **bloc** en cas de doublon. La bannière de démarrage affiche le transport actif (`transport : ws (bibliothèque 'ws')`, `transport : uws (uWebSockets.js)`, ou `transport : personnalisé (instance fournie par l'entry)`).

### 12.1 Pourquoi changer de transport ?

`ws` est une bibliothèque JS pure, simple et largement éprouvée — le bon choix par défaut. `uWebSockets.js` est écrit en C++ (binding natif) et vise **une** chose : encaisser **beaucoup** plus de connexions simultanées avec **beaucoup** moins de mémoire et de CPU par connexion. La différence ne se voit qu'à partir de dizaines de milliers de connexions concurrentes — en dessous, `ws` suffit largement et évite d'installer un paquet natif (compilation binaire propre à chaque plateforme).

### 12.2 Activer uWebSockets.js — `transport: 'uws'`

```js
const app = mjsWs({
  transport: 'uws',
  // port/host s'appliquent pareil qu'avec 'ws' (§1)
})
```

Transparent pour l'application — le protocole `µ:`, les protections (§3), les salons (§4), les flux (§5)… tout est **identique**, `meta.address` compris : uWS livre l'adresse d'un visiteur IPv4 sous sa forme IPv6 longue (`0000:0000:0000:0000:0000:ffff:7f00:0001`), ramenée à la forme du système (`127.0.0.1`) comme sous `ws`. Trois réglages internes sont nécessairement différents, et déjà câblés pour vous :

| Réglage uWS natif | Valeur posée | Pourquoi |
|---|---|---|
| `maxBackpressure` | `limits.maxBuffered` (§3, 1048576 par défaut) | Au-delà de ce volume en attente d'envoi, uWS **abandonne** lui-même une trame. Sans ce câblage, son propre défaut (64 Ko) jetait en silence les trames d'un client lent bien avant la garde de contre-pression de MJS-WS. Une trame abandonnée par uWS est de toute façon **comptée rejetée**, comme une trame jetée par la garde, et mène à la même expulsion pour engorgement (§3) qu'avec `ws`. |
| `maxPayloadLength` | `limits.maxPayload` (§3, 65536 par défaut) | uWS refuse nativement une trame plus grande que ce réglage, en coupant la connexion sans trame de fermeture : le client voit **1006**, là où `ws` envoie **1009** ; la coupure compte pourtant pour la mise au banc (§3.4), comme avec `ws` — sans ce câblage, son propre défaut (16 Ko) serait **plus petit** que celui de MJS-WS et rejetterait des trames que `ws` aurait acceptées telles quelles. |
| `idleTimeout` | `0` (désactivé) | MJS-WS a **déjà** son propre Watchdog applicatif (`heartbeat × 2.5`, §3) — **seule** autorité d'inactivité pour **tous** les transports (`ws` non plus n'a pas de kill natif). Garder le timeout natif de uWS EN **plus** ferait doublonner la protection avec une fermeture hors du contrat `µ:` (code natif, pas de raison lisible, compteurs de garde faussés). Alignement retenu : une seule autorité, un comportement **identique** quel que soit le transport — y compris `heartbeat: 0` (jamais de kick, des deux côtés). |

### 12.3 Installer le paquet

```bash
npm install uNetworking/uWebSockets.js#v20.52.0
```

uWebSockets.js n'est **pas** une dépendance de ModularJS (paquet natif, une release par version de Node/OS — l'installer systématiquement alourdirait **tous** les projets ModularJS, même ceux qui n'en ont jamais besoin). Sans lui, `transport: 'uws'` échoue au démarrage (`.listen()`) avec un message clair, jamais un crash silencieux :

```
le paquet uWebSockets.js est requis pour transport: 'uws' — npm install uNetworking/uWebSockets.js#v20.52.0
```

### 12.4 Brancher **autre chose** — l'interface `MjsWsTransport`

```ts
interface MjsWsConnection {
  readonly bufferedAmount: number
  readonly remoteInfo: { origin?: string; headers?: Record<string, string | string[] | undefined> }
  send(data: string): void | boolean   // false = trame abandonnée par le transport lui-même : comptée rejetée (§3)
  close(code?: number, reason?: string): void
  onMessage: ((data: string) => void) | null
  onClose: ((code: number, reason: string) => void) | null
}

interface MjsWsTransport {
  onConnection(handler: (conn: MjsWsConnection) => void): void
  start(): Promise<void>
  stop(): Promise<void>
}
```

C'est **tout** ce que `mjsWs` demande à un transport — trois méthodes, une poignée de connexion. Squelette d'adaptateur maison (un canal **ipc**, un pont vers un autre protocole bas niveau, une queue de messages…) :

```ts
import type { MjsWsConnection, MjsWsRemoteInfo, MjsWsTransport } from 'modularjs-framework/ws'

class MonTransportMaison implements MjsWsTransport {
  private handler: ((conn: MjsWsConnection) => void) | null = null

  onConnection(handler: (conn: MjsWsConnection) => void): void {
    this.handler = handler   // core.ts appelle ceci UNE fois, avant start()
  }

  async start(): Promise<void> {
    // ... branchez votre canal bas niveau ici (écoute, upgrade, whatever) ...
    // à CHAQUE nouvelle connexion entrante :
    const remoteInfo: MjsWsRemoteInfo = { origin: undefined, headers: {} }
    const conn: MjsWsConnection = {
      // getter — pas une constante figée : DOIT refléter la mesure COURANTE de votre
      // canal à chaque lecture (0 si votre canal n'a pas de notion de tampon)
      get bufferedAmount() { return 0 },
      remoteInfo,
      send(data) { /* ... envoyez `data` (une chaîne JSON) au pair ... */ },
      close(code, reason) { /* ... fermez proprement, informez le pair si votre protocole le permet ... */ },
      onMessage: null,   // core.ts POSE ce callback juste après — jamais avant
      onClose: null,     // idem
    }
    this.handler?.(conn)
    // ... et quand une trame arrive vraiment : conn.onMessage?.(texteRecu) ...
    // ... et quand ça se ferme vraiment (peu importe qui a fermé) : conn.onClose?.(code, raison) ...
  }

  async stop(): Promise<void> {
    // ... arrêtez d'accepter de nouvelles connexions ...
  }
}

const app = mjsWs({ transport: new MonTransportMaison() })
```

Contrat à respecter (core.ts s'appuie dessus **sans** vérification défensive supplémentaire) :

- `onConnection(handler)` est appelé **une** fois, avant `start()` — stockez juste `handler`.
- `start()` ne résout **que** quand le transport est prêt à accepter des connexions (`app.listen()` attend cette promesse).
- Pour **chaque** connexion entrante, appelez `handler(conn)` — c'est core.ts qui pose **ensuite** `conn.onMessage`/`conn.onClose` : votre transport ne fait que les **appeler** quand un événement survient, jamais les définir lui-même.
- `send()`/`close()` ne doivent **jamais** lancer d'exception — ni pour un envoi normal, ni pour un envoi sur une connexion qui vient de se fermer (le silence est attendu : `guard.ts`, le videur, compte déjà lui-même la contre-pression et les échecs au niveau applicatif).
- `bufferedAmount` doit rester lisible à tout moment (`0` si votre canal n'a pas de notion de tampon).

### 12.5 Le piège spécifique à uWebSockets.js (pour qui lirait/adapterait transport-uws.ts)

⚠️ **Un objet `ws` uWebSockets.js devient invalide dès l'instant où sa connexion se ferme** — le toucher après (même juste **lire** une propriété comme `getBufferedAmount()`) fait planter le **process Node entier**, pas juste lever une exception JavaScript rattrapable. `transport-uws.ts` pose donc un drapeau `_closed` sur chaque connexion, réglé **avant** tout appel natif de fermeture et vérifié en tête de `send()`/`close()`/`bufferedAmount` — jamais un accès direct à l'objet natif ailleurs. Ce piège n'existe **pas** avec `ws` (bibliothèque JS pure, tolère un appel tardif — silencieusement ou via une exception normale) : c'est spécifique aux bibliothèques natives/bindings C++, à garder en tête pour tout **autre** transport natif qu'on brancherait un jour.

---

<a id="civet-entry"></a>
## 13. Écrire son fichier serveur — le dialecte de vos composants

L'entry de `mjs ws` (§6.1) est compilée À LA **volée**, sans étape de build séparée — que ce soit au format **recommandé** `ws.server.mjs` (dialecte Civet des composants, exemple complet en §6.1) ou dans la variante Civet brut `ws.civet` (§13.3 ci-dessous).

### 13.1 Comment ça marche, simplement

À chaque (re)chargement de l'entry, `mjs ws` lit le fichier et le compile en JavaScript via le compilateur Civet **déjà utilisé par ModularJS** pour vos composants `.mjs` (`@danielx/civet` — **même** API, **aucune** dépendance de plus) — pour un `.server.mjs`, en appliquant **d'abord** les mêmes pré-passes de dialecte que le `<script>` de vos composants (assignations nues auto-déclarées, interpolation `"#{x}"`, `isnt`… — cf. l'encadré des 3 pièges, §6.1), **aucune** transformation de symbole réactif ($x/@x/§/µ-runes) : un fichier serveur n'a ni réactivité ni DOM. Le résultat est écrit dans un **vrai fichier**, sous `<root>/node_modules/.cache/mjs/server/` (repli `os.tmpdir()` si `<root>/node_modules` n'existe pas), puis importé par une URL `file://`. Le rechargement à chaud (§6.5) fonctionne **pareil** qu'avec un entry `.js` : cache-busting explicite (`?v=n` sur l'URL, incrémenté à chaque recompilation).

Une erreur de syntaxe est rapportée clairement, avec le nom du fichier :

```
[mjs ws] erreur de compilation dans '/chemin/vers/ws.server.mjs' : ws.server.mjs:3:5 Failed to parse …
```

Au démarrage, cette erreur empêche `mjs ws` de partir (comme un entry `.js` invalide). En rechargement à chaud, **même** comportement que pour du JS cassé (§6.5) : l'erreur est loguée et l'**ancien** serveur continue de tourner, zéro coupure.

Un `.server.mjs` qui contient du **markup** de composant (`<template>`, `<style>`, une balise HTML en tête de fichier) est refusé avant même la tentative de compilation, avec une erreur qui nomme la balise trouvée : un fichier serveur n'est pas un composant.

### 13.2 Importer quelque chose — la grammaire `@import`

Le fichier compilé vit dans le dossier de **cache** ci-dessus, pas à côté de votre entry — un `import … from` **natif** (JS/Civet standard), un ré-export `export … from '…'`, ou un `import('…')` **dynamique** d'un chemin littéral sont refusés à la compilation, avec un message qui nomme votre entry et la cible visée (`import(variable)`, calculé à l'exécution, reste possible). La seule façon d'importer un fichier du **projet** est la directive `@import`, celle-là même qu'utilisent vos composants `.mjs` — seule directive qui ait un sens hors DOM dans un fichier serveur :

| Cible `@import` | Résolution |
|---|---|
| `@import x './un-fichier.civet'` (relatif), ou `@import x 'lib/un-fichier.civet'` (SANS préfixe mais présent à côté de l'entry ou sous `--root` — forme **composant**) | ✅ Résolue à côté de l'entry, puis sous `--root` — compilée récursivement (même dialecte ; des `@import` imbriqués sont suivis, avec détection de cycle). |
| `@import default x 'un-paquet-npm'` (nu, par nom — AVEC ou SANS sous-chemin/`@scope` : `un-paquet-npm/sous-chemin`, `@scope/pkg`, `@scope/pkg/sous-chemin`) | ✅ Résolue par Node depuis le dossier de cache — fonctionne dès que `<root>/node_modules` existe (le cache y vit justement, sous `.cache/mjs/server/`) ; repli `os.tmpdir()` sinon, alors introuvable. Un `/` dans le spécificateur ne le fait pas basculer en chemin de projet à lui seul — seule une extension `.civet`/`.mjs` SANS préfixe (ligne ci-dessus) compte comme telle. |
| `@import x 'node:fs'` (et tout `node:*`) | ✅ Toujours — résolution spéciale de Node, indépendante de l'emplacement du fichier. |
| `@import x 'https://…'` | ✅ Laissée telle quelle (aucune résolution : à vous de fournir une URL que Node sait charger). |
| toute autre directive (`@i18n`, `@routes`, `@css`…) | ❌ Erreur de compilation explicite. |

Un commentaire (`#…`, `###…###`, `//…`, `/*…*/`) ou une chaîne (multi-lignes comprise, `'…'`/`"…"`/`'''…'''`/`"""…"""`/`` `…` ``) qui contiendrait du texte ressemblant à une directive (`@param`, `@foo`…) n'est **jamais** lu comme telle — seul du code réel en colonne 0 déclenche la détection.

**En pratique :** un besoin de paquet npm dans l'entry marche directement dès que `npm install` a été lancé dans le projet (`node_modules` présent) — plus besoin d'un entry `.js`/`.mjs` à part ni d'une URL `file://` absolue à la main.

### 13.3 Variante — Civet brut (`ws.civet`)

`ws.civet`/`server/ws.civet` (résolution complète : §6.2) restent une variante documentée : du [Civet](https://civet.dev/) **standard**, compilé **sans** les pré-passes de dialecte du format `.server.mjs` (§6.1, §13.1) — ni assignation nue auto-déclarée, ni interpolation `"#{x}"`, ni `isnt` (les 3 pièges de l'encadré, §6.1), et sans la grammaire `@import` (§13.2) : seuls des imports **natifs** JS/Civet standard sont possibles — un chemin relatif échoue quand même en pratique (le fichier compilé vit dans le dossier de cache, pas à côté du vôtre), un paquet npm nu ou un `node:*` fonctionnent. Une ligne en colonne 0 qui commence par une directive MJS (`@import`, `@css`, `@routes`…) reste une erreur de compilation explicite, ces directives n'existant que dans le dialecte `.server.mjs` ; une propriété suivie d'un opérateur ou d'un mot-opérateur (`@lang or "fr"`, `@display if @display?`) est du Civet ordinaire, comme dans un `.server.mjs`. À réserver à qui veut du Civet nu, sans magie ajoutée par le framework, et connaît ces limites.

```civet
// ws.civet
export default {
  auth: (hello)->
    return false unless hello.auth?.token is process.env.SECRET
    { id: hello.auth.userId, pseudo: hello.auth.pseudo }

  welcome: (client)-> { serverTime: Date.now() }

  setup: (app)->
    app.serve 'achat', (p, client)->
      throw new Error('solde insuffisant') if p.prix > 100
      { solde: 100 - p.prix }

    app.on 'chat', (p, client)-> app.broadcast('chat', p, { except: client })
}
```

(Les accolades du hash **racine** restent nécessaires dès que plusieurs clés portent des fonctions à
**Corps multi-lignes** — l'écriture indentée sans accolades, réservée aux hash simples, redevient
ambiguë pour le parseur au-delà — **même** règle pour `.server.mjs` (cf. l'exemple §6.1, deux clés dont
`setup` à corps multi-lignes). `app.serve`/`app.on` internes, eux, restent en `->` normal.)

---

<a id="statut"></a>
## 14. Statut du module

`mjsWs` couvre :

- le **cœur du protocole `µ:`** — handshake, ping/pong, requêtes/accusés de réception, pub/sub, diffusion ;
- les **protections de série** (§3, « le videur ») — seau à jetons, taille de trame, contre-pression, watchdog, garde process ;
- les **salons et la présence agrégée** (§4 : garde d'admission, méta, expulsion `µ:left`, agrégation multi-onglets par utilisateur) ;
- les **flux à journal borné** (§5 : deltas numérotés, resynchronisation incrémentale, rejeu aux numéros d'origine, `reset` = nouvelle époque) ;
- la **commande `mjs ws`** (§6 : fichier d'entry, section `ws` de la config, rechargement à chaud sans coupure, arrêt propre) ;
- le **pont universel** (§7 : API HTTP signée HMAC-SHA256 anti-rejeu, webhooks sortants à tentatives bornées, jetons JWT HS256 sans dépendance) ;
- la **reprise de session** (§8 : opt-in, client parqué pendant la grâce, tampon borné rejoué dans l'ordre, clé tournée à chaque welcome, présence et webhook disconnect différés) ;
- l'**adaptateur multi-processus** (§9 : mini-client Redis RESP maison zéro dépendance, broadcast/salon/ciblé/flux/présence traversent les process, seq global par `INCR` + tampon de réordonnancement, présence fusionnée à bail de vie, `MemoryAdapter` pour les tests) ;
- l'**état du serveur** (§10 : registre de compteurs toujours actif, `app.stats()`, `GET /stats` JSON + `GET /metrics` Prometheus + page `GET /state` sombre auto-rafraîchie, signés comme le reste du pont sauf en loopback, stats par processus avec l'adaptateur) ;
- **`µschema`** (§3.1) — registre de schémas binaires (`app.schema`/`opts.schemas`, types scalaires/`list`/`bits`, garde d'évolution ajout-seul), trois modes `codec` (`auto`/`binary` strict/`json`), encodage/décodage transparent sur `send`/`sendUser`/`broadcast`/`room().send`, hash stable du registre synchronisé à chaud via `µ:schema` sur désaccord ;
- le **contrat typé** (§11) — surcouche TypeScript optionnelle (`TypedApp`/`TypedSocket`), auto-complétion et erreurs de compilation sur `serve`/`request`/`on`/`send`, coût nul à l'exécution ;
- le **proxy de décisions** (§7.11) — `auth`/`rooms.join` acceptent aussi un objet `{ url, secret, timeout?, cache? }` délégant la décision à un back HTTP signé (façon Centrifugo « proxy »), fonction et objet-proxy cohabitant librement ;
- la **session exclusive par identité** (§8.5) — option opt-in à **deux** modes qui garantit une **seule** connexion par identité : `'replace'` (≡ `true`) — la nouvelle connexion remplace l'ancienne (`µ:bye {reason:'replace'}` + fermeture 4003), y compris les sessions parquées et à travers plusieurs process ; `'refuse'` (inverse) — la connexion existante gagne, la nouvelle est refusée (`µ:denied` + fermeture 4004) tant que l'ancienne vit ; exclusivité par process seulement dans ce 2e mode.

Le tout derrière une **façade de transport ouverte** (`ws` par défaut, `uws`/uWebSockets.js intégré en option, `MemoryTransport` en test, ou un adaptateur maison — cf. §12) et un fichier d'entry qui peut s'écrire dans le **dialecte Civet de vos composants** (`.server.mjs`, **recommandé**), en Civet brut ou en JS classique (§13), testé en boucle complète contre le vrai client `µ.socket` — reconnexions réelles comprises — et contre un vrai Redis local pour l'adaptateur.

---

<a id="aller-plus-loin"></a>
## 15. Aller plus loin

Le module couvre l'usage courant de bout en bout. Pistes **non couvertes**, honnêtes, pour qui voudrait pousser plus loin :

- **Journal Redis Streams contre la divergence en coupure** (cf. §9.6) — la solution complète (aucune perte de delta multi-process pendant une coupure Redis) demande un journal persistant côté Redis, hors périmètre actuel.
- **Topics typés TS — comblé partiellement** (§11) — `serve`/`request`, `send`/`on` (MJS-WS) et `move`/`state` (MJS-Server, [24 · MJS-Server](24-mjs-server.md#contrat-type-jeu)) ont un contrat TypeScript optionnel, à coût nul à l'exécution. Restent en nom de canal **libre**, non bornés au contrat : `stream`/`presence` côté MJS-WS, `room().send`, et les intentions du mode action (MJS-Server `def.intents`).
- **Codec binaire** — `parse`/`serialize` sont personnalisables (§1) mais aucun codec binaire clé-en-main (MessagePack, Protobuf…) n'est fourni.
- **Compensation de latence côté client** — `µsmooth` ([20 · Temps réel §6](20-temps-reel.md)) lisse déjà l'affichage par interpolation, mais une vraie compensation (extrapolation, réconciliation serveur) reste à la charge de l'application.
- **Module serveur de jeu** — boucle de simulation, autorité serveur, zones d'intérêt : hors périmètre de `mjsWs`, qui reste un transport temps réel générique, pas un moteur de jeu. Le tour par tour événementiel (appariement, sièges, vue par joueur), lui, est couvert par [24 · MJS-Server](24-mjs-server.md), une couche optionnelle composée par-dessus — la boucle à tick/simulation continue reste hors périmètre pour l'un comme pour l'autre.

👉 Pour voir tout ça tourner : la leçon tuto **[Le serveur officiel (mjs ws)](https://mjs.rapturestudio.fr/tuto#/serveur-mjs-ws)**.
