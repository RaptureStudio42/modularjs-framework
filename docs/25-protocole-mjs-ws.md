# 25 · Protocole MJS-WS — spécification de référence

> Référence **bas niveau** du protocole `µ:` (et de son extension `µgame:*`) porté par [23 · MJS-WS](23-mjs-ws.md) — assez précise pour écrire un client MJS-WS dans un **autre** langage, dans l'esprit du protocole DDP de Meteor (« ce que le fil transporte, octet par octet »). Si vous écrivez une appli MJS ordinaire, vous n'avez **pas** besoin de cette page : le client `µsocket` ([20 · Temps réel](20-temps-reel.md)) et le serveur `mjsWs` ([23 · MJS-WS](23-mjs-ws.md)) parlent déjà ce protocole l'un à l'autre. Cette page rassemble et précise ce qui est autrement éparpillé entre [20 · Temps réel §7](20-temps-reel.md), [23 · MJS-WS](23-mjs-ws.md) et [24 · MJS-Server](24-mjs-server.md) — vérifié contre le code source (`src/mjs-ws/`, `src/mjs-server/`, `src/schema/core.ts`), jamais contre les docs elles-mêmes.

## Sommaire

0. [Version et conventions](#conventions)
1. [Trames de contrôle `µ:`](#controle)
2. [Flux à deltas — `stream`](#flux-spec)
3. [Trames de jeu `µgame:*`](#jeu-spec)
4. [Format binaire µschema](#binaire-spec)
5. [Sécurité du pont HTTP](#securite-spec)

---

<a id="conventions"></a>
## 0. Version et conventions

**Version du protocole.** Un seul champ de version existe à ce jour : `protocol` dans `µ:hello` (§1.1), qui doit valoir **exactement** le nombre `1` — c'est la **seule** version actuellement définie par `mjsWs`. Toute autre valeur (y compris absente, ou la chaîne `"1"`) est refusée (`µ:denied`) avant même de regarder le reste du hello. Il n'existe pas, séparément, de version de « protocole applicatif » (pub/sub, requêtes) — seule la charge µschema (§4) porte sa **propre** version (hash du registre de schémas, orthogonal à `protocol`).

**Enveloppe.** Toute trame **texte** (JSON) suit la même enveloppe minimale :

```
{ "t": "<type>", "p": <charge>, "id"?: <valeur> }
```

- `t` (`string`, obligatoire) — le **type** de la trame. Un `t` qui commence par `µ:` est une trame de **contrôle** réservée (§1) — en émettre un qui ne fait pas partie de la liste exhaustive du §1.1 est une erreur protocolaire (`µ:error`, cf. §1.1). Un `t` **sans** ce préfixe est un type **applicatif** (pub/sub §1.1 dernière ligne, ou delta de flux §2, ou trame de jeu `µgame:*` §3 — ce dernier préfixe est réservé par [24 · MJS-Server](24-mjs-server.md#philosophie), pas par `mjsWs` lui-même).
- `p` — la charge, structure propre à chaque `t` (détaillée §1/§2/§3). Absente ou non-objet selon les cas ; toujours présente en pratique côté trames connues.
- `id` (`string | number`, optionnel) — porté par une trame de type **requête** (§1.1 dernière ligne) et par son `µ:ack` de réponse (§1.2) ; **seule** exception parmi les trames de contrôle, `µ:refresh` (§1.1) honore aussi un `id` optionnel de la même façon. Valeur choisie par l'**émetteur** (la référence `mjs_socket.ts` utilise un compteur local croissant, mais **rien** dans le protocole n'impose ce choix) — le serveur ne lui donne **aucun** sens propre, il la restitue **telle quelle** dans le `µ:ack` correspondant. Un `id` n'a de sens que par rapport à l'**émetteur** qui l'a choisi ; deux clients peuvent réutiliser les mêmes valeurs sans collision (portée par connexion). Absent sur toutes les autres trames — y compris `µ:join`/`µ:leave`/`µ:sub-stream`/etc., qui ne déclenchent **jamais** de `µ:ack` même si un `id` leur était ajouté.

**Encodage.** Par défaut, toutes les trames sont du JSON UTF-8 envoyé en trame WebSocket **texte** (`JSON.stringify`/`JSON.parse`, personnalisables via `opts.parse`/`opts.serialize` — cf. [23 §1](23-mjs-ws.md#options), mais alors les **deux** côtés doivent s'accorder). Les trames de **contrôle** `µ:` restent **toujours** JSON, quel que soit le codec (§4) — le hello ne peut pas dépendre d'un schéma pas encore synchronisé. Seuls les messages **applicatifs** pub/sub (jamais les requêtes, jamais les deltas de flux, jamais `µgame:*`) peuvent voyager en trame WebSocket **binaire** à la place, si le `t` a un schéma déclaré ET que `ws.codec ≠ 'json'` — cf. §4 pour l'enveloppe binaire complète.

> ⚠️ **Pourquoi `µgame:*` est exclu — et où l'exclusion est tenue.** Elle ne tient **pas** à l'enveloppe : le choke point d'encodage (`sendRaw`) n'écarte que les types de **contrôle** `µ:` et les deltas de flux (repérés par leur `seq` de premier niveau, que les trames de jeu portent dans `p`). C'est une **garde explicite** de MJS-Server (§3) qui refuse le préfixe : `app.schema('µgame:…', …)` et une clé `µgame:` dans `opts.schemas` lèvent au démarrage. Motif : la charge d'une trame de jeu porte sa vue dans `view` (ou `delta`) — un **objet**, la seule forme que µschema v1 ne sait pas décrire (scalaires, `list()`, `bits()` — §4). Or un champ d'un type inattendu s'encode en valeur **zéro** sans lever : sans la garde, la trame partirait bien en binaire et l'état du jeu arriverait **vide**, en silence. Pour envoyer de l'état de jeu en binaire, il faut donc un type applicatif **à vous** (préfixe libre) dont la charge est **plate**, envoyé par `app.send` à côté de `µgame:state`.

**Transport.** Le protocole ci-dessous est indépendant du transport WebSocket concret — `mjsWs` l'expose au-dessus de `ws`, `uWebSockets.js`, ou tout transport maison implémentant `MjsWsTransport` (cf. [23 §12](23-mjs-ws.md#transport-facade)). Tout ce qui suit ne suppose rien de plus qu'une connexion full-duplex qui délivre des messages **texte** ou **binaires** dans l'ordre d'émission.

---

<a id="controle"></a>
## 1. Trames de contrôle `µ:`

Le namespace `µ:` est **réservé** au protocole lui-même — dix-sept trames au total, exhaustif. Un type qui commence par `µ:` et n'apparaît **pas** dans les deux tableaux ci-dessous n'existe pas : l'émettre déclenche `µ:error { message: "type inconnu '<t>'" }` côté receveur (jamais un routage silencieux vers de l'applicatif). Un serveur ou un client tiers ne doit donc **jamais** inventer un type `µ:xxx` applicatif — c'est le rôle des types **sans** préfixe (pub/sub, requêtes) ou du préfixe `µgame:` (§3, réservé séparément par MJS-Server).

<a id="controle-c2s"></a>
### 1.1 Client → Serveur

#### `µ:hello` — handshake d'ouverture

Premier message **obligatoire** de toute connexion — tout autre `t` reçu avant lui entraîne un refus immédiat (`µ:denied`, puis fermeture WebSocket code **4001**). Un `µ:hello` reçu une **seconde** fois sur une connexion déjà authentifiée est refusé (`µ:error { message: 'hello déjà reçu' }`, connexion inchangée) — pour rafraîchir une identité en vol, cf. `µ:refresh` plus bas.

| Champ | Type | Oblig. | Sens |
|---|---|---|---|
| `protocol` | `number` | oui | doit valoir **exactement** `1` (§0) — toute autre valeur, absence comprise → `µ:denied { message: 'protocole non supporté' }` |
| `auth` | `any` | non | opaque pour l'enveloppe elle-même — transmis **tel quel** à `opts.auth(hello, meta)` (fonction) ou au proxy de décisions (objet `{url,secret,...}`, [23 §7.11](23-mjs-ws.md#pont)) |
| `resub` | `string[]` | non | noms des types pub/sub actifs avant coupure — cf. note ⚠️ ci-dessous |
| `rooms` | `string[]` | non | noms des salons actifs avant coupure — cf. note ⚠️ ci-dessous |
| `session` | `{ id: string, key: string }` | non | reprise de session ([23 §8](23-mjs-ws.md#reprise-session)) — porte le `session` reçu au dernier `µ:welcome` |
| `schemaHash` | `string` | non | hash FNV-1a du registre µschema **client** (§4) — absent = client sans registre, aucun `µ:schema` ne sera jamais poussé en retour |

Déclenche, dans l'ordre : `opts.auth` (ou le proxy) → si `session` est fourni ET l'auth accueillie, tentative de reprise ([23 §8](23-mjs-ws.md#reprise-session)) qui court-circuite le reste sur succès → sinon `opts.welcome` → `µ:welcome` (§1.2, toujours envoyé sauf coupure en cours de route) → `µ:schema` (§1.2) si `schemaHash` diverge du registre serveur.

> ⚠️ **`resub`/`rooms` sont informatifs — le serveur `mjsWs` actuel ne les exploite pas.** La resynchronisation réelle passe par les messages **dédiés** que le client renvoie lui-même, explicitement, juste après avoir reçu `µ:welcome` : `µ:join` par salon d'abord, puis `µ:sub-stream` (ou `µ:resync` si ce flux avait déjà une séquence en cours, cf. §2) par flux repris, et `µ:sub-presence` pour la présence — un flux réservé à un salon, demandé avant d'y entrer, peut être refusé. Un client tiers peut donc omettre `resub`/`rooms` sans rien perdre côté `mjsWs` — ils documentent une **intention** (utile à un futur serveur, ou à un serveur maison qui choisirait de les exploiter), pas un contrat consommé aujourd'hui.

#### `µ:ping` — battement

`p = { ts: any }` — valeur libre (généralement un timestamp numérique), renvoyée **verbatim** par le serveur dans le `µ:pong` correspondant (même en cas de valeur non numérique — jamais recalculée côté serveur). Émis par le client à intervalle régulier (option cliente `heartbeat`, défaut 15000 ms — indépendante de l'option **serveur** du même nom, qui ne fixe qu'un seuil de watchdog, cf. [23 §3](23-mjs-ws.md#protections)). Déclenche `µ:pong` + met à jour `client.latency` côté serveur (mesuré entre deux `µ:ping` reçus, pas via `ts`), et l'échantillon `intervallesPing` de l'état du serveur ([23 §10](23-mjs-ws.md#etat-serveur)) : un **intervalle entre deux pings**, pas un aller-retour — l'aller-retour se mesure côté client, au `µ:pong`. Champ facultatif `early: true` : un `µ:ping` hors battement — le client de référence l'envoie pour prouver le départ d'un salon (cf. `µ:leave`), et son battement repart de lui. Le serveur y répond par un `µ:pong` comme à tout autre, mais n'en relève aucun intervalle (ni `client.latency`, ni `intervallesPing`) : l'intervalle suivant se mesure à partir de lui. Un serveur qui ignore ce champ relève l'intervalle qui le précède, plus court que la période du battement.

#### `µ:refresh` — rafraîchit le jeton en vol

`p = { auth: any }` — **même** forme que `hello.auth`. Re-vérifie via le **même** `opts.auth` que le hello, mais **refuse** tout changement de `identity.id` (une session ne change jamais d'identité en vol — casserait présence/salons). Réponse conditionnée à la présence d'un `id` sur la trame :

| Résultat | `id` fourni | `id` absent |
|---|---|---|
| Succès | `µ:ack { id, p: { exp: number \| null } }` — `exp` = nouvelle échéance en **secondes** epoch, ou `null` si le serveur ne suit aucune échéance | **rien** — succès silencieux |
| Échec (identité refusée, ou `identity.id` changé) | `µ:error { code: 'refresh-denied' }` **puis** `µ:ack { id, e: true, p: 'refresh-denied' }` | `µ:error { code: 'refresh-denied' }` **seul** |

Un `µ:refresh` raté ne ferme **jamais** la connexion — elle continue de vivre jusqu'à son échéance courante. Détail complet : [23 §7.9](23-mjs-ws.md#pont).

#### `µ:sub-stream` — abonnement à un flux

`p = { stream: string }` (obligatoire — une charge sans `stream` de type `string` est ignorée **silencieusement**, aucune trame en retour). Déclenche un abonnement + un delta `reset` immédiat (§2) — instantané complet même si le flux n'a jamais changé depuis l'abonnement précédent. Un flux jamais déclaré côté serveur (`app.stream(nom)` jamais appelé) répond honnêtement un `reset` **vide** (`seq: 0`) plutôt que de laisser le client sans réponse. Un flux fermé (déclaré sans `public`, `room` ni `canSubscribe` : un flux est fermé par défaut), un flux dont la garde refuse ce client (`canSubscribe`, `room` — [23 §5](23-mjs-ws.md#flux)), ou un flux écrit par le pont mais jamais déclaré par ce processus, répond `µ:error { message, code: 'stream-denied', stream }` (accès refusé, `stream` nomme le flux), sans abonnement. Une garde `canSubscribe` asynchrone sans réponse dans son délai (`guardTimeout`, 5 000 ms par défaut, [23 §5](23-mjs-ws.md#flux)) compte comme un refus : même forme, le `message` dit « sa garde n'a pas répondu à temps ». Un abonné qui perd le flux (garde posée après coup, vérification d'un départ ou d'une entrée) reçoit le même refus.

#### `µ:resync` — rattrapage après un trou

`p = { stream: string, from: number }` — `stream` obligatoire (même garde silencieuse que `µ:sub-stream`) ; `from` absent ou non-numérique-fini retombe sur `0` (rejeu complet si le journal le permet, sinon `reset`). Détail complet de la logique de rattrapage : §2.

#### `µ:unsub-stream` — désabonnement d'un flux

`p = { stream: string }` (obligatoire, même garde silencieuse que `µ:sub-stream`). La connexion cesse de suivre ce flux : plus aucun delta, **sans** trame en retour — comme pour `µ:leave`, le client sait déjà qu'il part. Rien de ce qu'elle attendait encore ne la réabonne : ni une demande dont la garde répond après coup, ni une vérification en vol, ni son retour dans un salon quitté (cf. `µ:join`). Désabonner un flux qu'elle ne suit pas (déjà désabonnée, jamais abonnée) ne fait rien. Un flux **inconnu** (jamais déclaré, ou détruit par `destroy()`) répond `µ:error { message }` (désabonnement refusé), sans rien créer ; un nom inconnu de plus de 200 caractères reçoit l'erreur courte « nom de flux trop long », sans son nom. Un `µ:sub-stream` (ou `µ:resync`) ultérieur la réabonne. **Jamais de `µ:ack`**, même si la trame portait un `id`. Une session reprise (`resumed: true`, [23 §8](23-mjs-ws.md#reprise-session)) garde ses abonnements : un client qui a quitté un flux pendant la coupure envoie son `µ:unsub-stream` après le `µ:welcome`, et ignore les trames de ce flux qui arrivent encore (tampon de la reprise rejoué, deltas partis avant le désabonnement) — le client de référence le fait, et renvoie le désabonnement à un serveur qui pousse encore un flux quitté, une fois par connexion.

#### `µ:sub-presence` — abonnement à la présence

`p = { room?: string }` — `room` absent (ou de type différent de `string`) = présence **globale** ; sinon présence du salon nommé (être **abonné** à la présence d'un salon ne rend pas **membre** de ce salon, cf. `µ:join` ci-dessous). Déclenche un `µ:presence { op: 'reset' }` immédiat (§1.2). La présence d'un salon n'est servie qu'à ses **membres** par défaut : celle d'un salon ouvert (`app.room(nom, { presence: 'public' })`) à tous, et la garde `rooms.canSeePresence`, si elle est posée, décide seule ([23 §4](23-mjs-ws.md#salons-presence)). Un refus répond `µ:error { message, code: 'presence-denied', room }`, sans abonnement ; un membre qui quitte un salon dont la présence lui était réservée (`µ:leave`, exclusion, déconnexion) en est désabonné. La présence **globale** est fermée par défaut : servie à tous les clients si le serveur l'ouvre (`mjsWs({ presence: 'public' })`), à personne sinon — refus `µ:error { message, code: 'presence-denied' }`, **sans** `room`, sans abonnement.

#### `µ:join` — rejoindre un salon

`p = { room: string }` (obligatoire, même garde silencieuse). Déclenche la garde `opts.rooms.join` (fonction ou proxy, [23 §7.11](23-mjs-ws.md#pont), async autorisée) puis, si acceptée : adhésion, delta de présence `join` (**seulement** si c'est la 1ʳᵉ connexion de cette identité dans ce salon — agrégation multi-onglets, [23 §4](23-mjs-ws.md#salons-presence)), et rejeu de l'historique du salon s'il en a un ([23 §4.1](23-mjs-ws.md#salons-presence)). Si cette connexion avait quitté ce salon en suivant un flux qui lui est réservé (ou dont la garde `canSubscribe` l'avait alors refusée), ce flux lui est rendu sans `µ:sub-stream` : `reset` au `seq` courant, puis les deltas ([23 §5](23-mjs-ws.md#flux)) — sauf un flux `salon/…` (le client du framework le redemande lui-même), un flux dont elle s'est désabonnée depuis (`µ:unsub-stream`), et au-delà des 50 derniers salons quittés par cette connexion. Un `µ:join` en double (déjà membre) est un no-op silencieux. Un refus (`false`/`throw` de la garde, nom trop long, plafond de salons) répond `µ:error { message, code: 'join-denied', room }`, throttlé à 1/s — `room` nomme le salon refusé : le client n'oublie que lui. **Jamais de `µ:ack`**, même si la trame portait un `id`.

#### `µ:leave` — quitter un salon

`p = { room: string }` (obligatoire, même garde silencieuse). Déclenche le retrait + delta de présence `leave` (dernière connexion de cette identité dans ce salon). Client-initié : contrairement à un `kick` serveur, **aucun `µ:left` n'est renvoyé à l'émetteur** — il sait déjà qu'il part. `µ:leave` d'un non-membre est un no-op silencieux. Le client du framework retient chaque départ jusqu'à la preuve que le serveur l'a traité : la réponse à une trame partie après lui sur la même connexion — le `µ:pong` d'un `µ:ping`, le `µ:ack` d'une requête — (le serveur traite les trames d'une connexion dans l'ordre et ne rejoue jamais un `µ:pong` ni un `µ:ack` à la reprise), ou un accueil neuf. Faute de quoi, le client envoie lui-même un `µ:ping` marqué `early: true`, un pour tous les départs en attente, une fois la connexion calme depuis une seconde (aucune trame partie), ou aussitôt dès dix départs qu'aucun `µ:ping` n'a suivis — avec ou sans battement (`heartbeat: 0`). Une session reprise ([23 §8](23-mjs-ws.md#reprise-session)) garde ses salons : il y redit `µ:leave` pour chaque départ encore retenu, une fois par reprise, suivi aussitôt d'un `µ:ping` — hors ligne, le départ n'avait pas pu partir ; parti, il a pu se perdre avec la connexion, celle d'une reprise précédente comprise — et le redire est sans effet sur un serveur qui l'avait reçu. Il retient au plus 50 départs : au-delà, le plus ancien est oublié. Les flux réservés à ce salon cessent aussitôt d'être envoyés à cette connexion, sans trame, comme ceux dont la garde `canSubscribe`, qui avait lu l'appartenance à ce salon, la refuse désormais (ils lui sont rendus à son retour, cf. `µ:join`).

#### *(requête applicative)* — **sans** préfixe `µ:`

`{ t: <type>, p, id }` — `t` ne commence **pas** par `µ:` (sinon cf. la garde générale en tête de §1). `id` présent ET un `app.serve(t, ...)` existe → traité comme une **requête**, réponse `µ:ack` garantie (§1.2). `id` absent, OU `id` présent mais **seul** un `app.on(t, ...)` existe (pas de `serve`) → traité comme du pub/sub, tous les `on(t)` sont invoqués, **aucun `µ:ack`** n'est jamais émis dans ce cas (une requête envoyée vers un type sans `serve()` expire donc côté émetteur, cf. [24 §14](24-mjs-server.md#limites) pour un cas réel). `t` sans **aucun** `serve()` ni `on()` enregistré → `µ:error { message: "type inconnu '<t>'" }`.

<a id="controle-s2c"></a>
### 1.2 Serveur → Client

#### `µ:welcome` — fin du handshake

`p` = fusion de trois sources, dans cet ordre : le retour libre de `opts.welcome(client)` (`{}` si absent, ou si `welcome()` a levé — l'erreur est loguée, jamais fatale) ; **puis** `schemaHash` (`string`) SI le registre µschema serveur n'est pas vide (§4) ; **puis**, **seulement** si `opts.resume` est actif côté serveur ([23 §8](23-mjs-ws.md#reprise-session)) : `session: { id: string, key: string }` (clé **tournée** à chaque welcome — y compris une reprise) et `resumed: boolean` (`true` = ce welcome clôt une reprise réussie). Sans `opts.resume`, `session`/`resumed` sont **absents** — pas même `resumed: false` — comportement byte-identique à avant l'existence de la reprise.

Obligatoire — envoyé quoi qu'il arrive dès l'authentification acceptée (sauf coupure de la connexion **pendant** `opts.welcome()`, cas limite où rien n'est envoyé à personne). Déclenche côté client : état → `open`, la file d'attente hors-ligne est rejouée, le heartbeat démarre, et le client renvoie lui-même ses abonnements (`µ:join` d'abord, puis `µ:sub-stream`/`µ:resync`/`µ:sub-presence`, cf. note ⚠️ du hello en §1.1). Sur un accueil repris (`resumed: true`), il redit avant eux les départs que la session a pu garder : `µ:unsub-stream` d'un flux quitté hors ligne, `µ:leave` de chaque salon quitté dont le départ n'a pas encore été traité, suivi d'un `µ:ping` marqué `early: true` dont la réponse le prouve (cf. `µ:leave` ci-dessus).

#### `µ:denied` — authentification refusée

`p = { message: string }` — toujours ce champ, jamais d'autre. Déclenche une fermeture WebSocket **définitive**, code **4001** — aucune reconnexion n'est tentée côté client de référence (`mjs_socket.ts`), contrairement à une simple coupure réseau.

**Exception, code 4004** — la session exclusive par identité en mode `'refuse'` (`sessionExclusive: 'refuse'`, [23 §8.5](23-mjs-ws.md#reprise-session)) refuse un `µ:hello` frais avec `µ:denied { message: 'session déjà active pour cette identité' }`, puis ferme avec le code **4004** (au lieu de 4001) — **seul** le code change, la connexion existante de cette identité n'est jamais touchée. Le client de référence (`mjs_socket.ts`) traite ce code comme **définitif** au même titre qu'un `µ:denied` ordinaire, y compris si la trame elle-même s'est perdue en route (`lastError` retombe alors sur `{ code: 'refused' }` — même filet de sécurité que le code 4003, cf. `µ:bye` plus bas).

#### `µ:pong` — réponse au battement

`p = { ts: <valeur reçue dans le µ:ping correspondant, verbatim> }`. Sert de corrélation pour calculer la latence côté récepteur — le serveur ne calcule ni n'interprète jamais `ts` lui-même.

#### `µ:ack` — réponse à une requête

| Champ | Type | Oblig. | Sens |
|---|---|---|---|
| `id` | `string \| number` | oui | **Même** valeur (type et contenu) que l'`id` de la requête correspondante — restituée telle quelle |
| `e` | `bool` | non | `true` = la requête a échoué (le `serve()` a levé ou rejeté) ; absent/`false` = succès |
| `p` | `any` | oui | valeur de retour du `serve()` si succès ; message d'erreur (généralement `string`) si `e: true` |

Une seule trame `µ:ack` par requête, jamais plus. `id` est le **seul** lien entre une requête et sa réponse — deux requêtes en vol avec le même `id` (mauvaise génération côté client) produiraient un comportement indéterminé côté émetteur, jamais côté serveur (qui traite chaque requête reçue indépendamment). Cette forme générique couvre les requêtes applicatives (`serve()`, §1.1) et `µgame:*` (§3) ; `µ:refresh` (§1.1) est la **seule** exception — sa charge `p` de succès a une forme dédiée (`{ exp }`), jamais un retour de `serve()`.

#### `µ:error` — erreur non fatale

Huit formes possibles, **jamais** combinées dans la même trame :

| Forme | Quand |
|---|---|
| `{ message: string, type: string }` | un message applicatif d'un **type inconnu** (ni `serve()` ni `on()` pour lui) — `type` le nomme : le client y reconnaît le paquet d'un effet en direct qui manque au serveur (`follow:…` → `followPackage`) et le dit en console |
| `{ message: string, code: 'join-denied', room: string }` | un `µ:join` refusé (garde `rooms.join`, nom trop long, plafond de salons) — `room` nomme le salon : le client l'oublie, lui seul, et ne le rejoint plus aux reconnexions |
| `{ message: string, code: 'stream-denied', stream: string }` | un `µ:sub-stream` ou `µ:resync` refusé (flux fermé, garde `canSubscribe` qui refuse ou ne répond pas dans son délai `guardTimeout`, salon `room`, flux du pont non déclaré), ou un abonné qui perd le flux — `stream` nomme le flux : le client l'oublie, lui seul, et ne le redemande plus aux reconnexions |
| `{ message: string, code: 'presence-denied', room: string }` | un `µ:sub-presence` de salon refusé (présence réservée aux membres, garde `rooms.canSeePresence`) — `room` nomme le salon ; aucun abonnement |
| `{ message: string, code: 'presence-denied' }` | un `µ:sub-presence` **global** (sans `room`) refusé : présence globale fermée (option `presence` du serveur absente) ; aucun abonnement |
| `{ message: string }` | forme **générique** — débit dépassé, `µ:refresh` refusé, `welcome()`/`on()` qui a levé, désaccord µschema en mode strict (§4)… tous les cas non listés ci-dessous |
| `{ code: 'token-expired' }` | l'échéance du jeton authentifié est dépassée ([23 §7.9](23-mjs-ws.md#pont)) — précède **toujours** une fermeture serveur **sans** `µ:bye` (reconnexion possible avec un jeton neuf) |
| `{ code: 'refresh-denied' }` | un `µ:refresh` a échoué — la connexion n'est **pas** affectée, elle continue de vivre jusqu'à son échéance courante |

Jamais fatal en lui-même — alimente `lastError` côté client, rien de plus. Plusieurs causes protocolaires partagent la **même** forme générique `{message}` avec un **texte** différent (throttlé à 1/s pour la plupart — débit, désaccord µschema) : un client tiers doit traiter `message` comme un texte **d'affichage**, jamais comme une clé de branchement (seuls les `code` ci-dessus, le `room` d'un `join` ou d'une présence refusés, le `stream` d'un flux refusé et le `type` d'un type inconnu sont des valeurs stables destinées à être testées par égalité).

#### `µ:presence` — delta de présence

`p.room` (`string | undefined`) : `undefined` (absent du JSON, jamais `null`) pour la présence **globale**, nom du salon sinon — **même** valeur que celle passée à `µ:sub-presence`. `p.op` distingue trois formes **disjointes** :

| `op` | Champs présents | Sens |
|---|---|---|
| `'reset'` | `peers: { [id: string]: meta }` — un **objet** clé→méta, **jamais un tableau** | instantané complet, envoyé immédiatement en réponse à `µ:sub-presence` |
| `'join'` | `id: string`, `meta: any` | un pair (agrégé par identité — cf. ci-dessous) vient d'apparaître |
| `'leave'` | `id: string` (pas de `meta`) | un pair vient de disparaître |

`id` est **toujours** une chaîne (`identity.id` coercé en `String(...)`, ou l'id de connexion en repli). `meta` = ce que `opts.rooms.meta(client)` a retourné (`{}` par défaut). **Agrégation multi-onglets** : la clé d'un pair est l'**identité** (`identity.id`), pas la connexion — deux onglets du même utilisateur ne produisent qu'un **seul** `join` (au premier onglet) et qu'un **seul** `leave` (au dernier), jamais un par onglet ; `meta` reflète alors la connexion la plus **récente**. Détail : [23 §4](23-mjs-ws.md#salons-presence).

> ⚠️ **La forme `peers` d'un `reset` ici (objet `{id: meta}`) diffère de celle du pont HTTP `GET /presence` ([23 §7.3](23-mjs-ws.md#pont)), qui renvoie un tableau `[{id, meta}, ...]`.** Deux représentations légitimes de la **même** donnée, choisies indépendamment (le WebSocket suit la forme interne, le pont HTTP une forme JSON plus déroulée) — un client qui consomme les deux voies doit les traiter séparément, jamais supposer la même forme.

#### `µ:left` — expulsion d'un salon (kick)

`p = { room: string, reason?: string }` — `reason` absent si aucune raison fournie à `.kick(client, reason?)`. Envoyé **uniquement** au client expulsé (jamais aux autres membres, qui reçoivent un delta de présence `leave` ordinaire) — la connexion elle-même reste **ouverte**, ce n'est pas un `µ:bye`. Ne survient **jamais** pour un `µ:leave` volontaire (cf. §1.1).

#### `µ:bye` — fermeture propre décidée par le serveur

`p = {}` si aucune raison, `p = { reason: string }` sinon. Déclenche une fermeture **définitive** — pas de reconnexion côté client de référence (même famille que `µ:denied`, mais après une session authentifiée plutôt qu'au handshake). Émis par `client.close(reason?)` (un client précis) ou `app.stop()` (tous, en boucle, avant de fermer le transport) — code de fermeture WebSocket **1000** dans ces deux cas.

**Exception, code 4003** — la session exclusive par identité en mode `'replace'` (`sessionExclusive: 'replace'` ≡ `true`, [23 §8.5](23-mjs-ws.md#reprise-session)) éjecte l'ancienne connexion d'une identité qui vient de rouvrir ailleurs avec `µ:bye { reason: 'replace' }`, puis ferme avec le code **4003** (au lieu de 1000) — jamais parquée ni reprise, quand bien même `resume` serait actif. Le client de référence (`mjs_socket.ts`) traite ce code comme **définitif** au même titre qu'un `µ:bye` ordinaire, y compris si la trame elle-même s'est perdue en route : le code de fermeture seul suffit à couper toute reconnexion (`lastError` retombe alors sur `{ code: 'replaced' }` — filet de sécurité, sans lui le client rejouerait un `µ:hello` que le serveur re-refuserait aussitôt). Mode inverse `'refuse'` : voir le code **4004**, sur `µ:denied` ci-dessus.

#### `µ:schema` — synchronisation du registre binaire

Poussée **immédiatement après** `µ:welcome` SI ET **seulement** SI le `schemaHash` annoncé dans `µ:hello` diverge du hash serveur (et qu'au moins un schéma existe côté serveur). `p.version` (`string`) = hash serveur courant. `p.definitions` porte la sérialisation **complète** du registre — **sa forme est celle de `definitions_json()`** (§4), donc à nouveau `{ hash, schemas }` (avec `p.definitions.hash === p.version`, redondant mais réel — les deux existent indépendamment dans le code source) :

```json
{
  "t": "µ:schema",
  "p": {
    "version": "1a2b3c4d",
    "definitions": {
      "hash": "1a2b3c4d",
      "schemas": [
        { "nom": "pos",  "champs": [["x", "i16"], ["y", "i16"]] },
        { "nom": "etat", "champs": [["hp", "u8"], ["tags", { "kind": "list", "of": "str8" }]] }
      ]
    }
  }
}
```

`fields` est un tableau de paires `[nom, type]` **dans l'ordre** fil (§4) — `type` est soit une chaîne scalaire (`"u8"`, `"str8"`…) soit un objet `{kind:'list', of: <scalaire>}` / `{kind:'bits', noms: [...]}`. Détail complet des types : §4.

#### *(delta de flux)* — `{ t: <nomFlux>, seq, p: {...} }`

**Sans** préfixe `µ:` — `t` est le **nom** du flux. Détail complet : §2.

#### *(trame binaire, µschema)*

Aucune enveloppe `{t,p}` — octets bruts `[u8 idSchéma][charge]`, en trame WebSocket **binaire**. Détail complet : §4.

---

<a id="flux-spec"></a>
## 2. Flux à deltas — `stream`

Source de vérité côté serveur : `app.stream(nom)` ([23 §5](23-mjs-ws.md#flux)) — un état courant (`clé → donnée`) dont chaque mutation est numérotée, diffusée et journalisée. Un flux existe **indépendamment** de toute connexion, créé par le code serveur ; un client s'y abonne, jamais ne le crée.

### Enveloppe

```
{ "t": "<nomFlux>", "seq": <number>, "p": { "op": "...", ... } }
```

`t` = nom du flux (**sans** préfixe `µ:`, choisi par l'appli). `seq` = entier **strictement** croissant, **propre** à ce flux (jamais un timestamp — un compteur dédié, potentiellement partagé entre process via l'adaptateur, cf. [23 §9.3](23-mjs-ws.md#adaptateur-redis)).

### Les 4 opérations — `p.op`

| `op` | Champs de `p` | Effet côté récepteur |
|---|---|---|
| `'reset'` | `values: { [id: string]: any }` | remplace l'état **complet** — nouvelle « époque », vide tout historique de rattrapage |
| `'add'` | `key: string`, `value: any` | ajoute/remplace l'entrée `key` |
| `'update'` | `key: string`, `patch: object` | fusion **1 niveau** (`{ ...existant, ...patch }`) — **pas** une fusion profonde : une clé absente de `patch` reste inchangée, une clé présente **remplace** (jamais fusionnée elle-même) |
| `'remove'` | `key: string` | retire l'entrée |

`reset` peut survenir à **n'importe quel** `seq` (aucune contrainte de contiguïté) — c'est le point de resynchronisation universel, et il **vide** le journal serveur (aucun rejeu ne traversera jamais un `reset`). `add`/`update`/`remove` doivent avoir un `seq` **contigu** par rapport au précédent vu sur CE flux ; un trou détecté côté récepteur déclenche un `µ:resync` (§1.1).

### Cycle de vie d'un abonnement

1. `µ:sub-stream { stream }` (§1.1) → réponse **immédiate** `{ op: 'reset', values: <état courant> }` au `seq` courant (état vide si le flux n'a encore rien reçu).
2. Chaque mutation serveur (`stream.add/update/remove/reset(...)`) diffuse `{ t, seq: ++compteur, p }` à **tous** les abonnés de ce flux, et journalise l'entrée dans un anneau borné (sauf `reset`, qui **vide** le journal — taille par défaut 200 deltas, réglable **par** flux).
3. Un abonné qui reçoit un `seq` ≠ (dernier `seq` vu + 1) — donc un **trou** — envoie lui-même `µ:resync { stream, from: dernierSeqVu }` (§1.1). Entièrement automatique côté client de référence : rien à coder.
4. `µ:unsub-stream { stream }` (§1.1) → plus aucun delta de ce flux pour cette connexion, sans trame en retour ; un nouveau `µ:sub-stream` repart de l'étape 1. Un refus (`µ:error { code: 'stream-denied', stream }`, §1.2) mène au même point, sans `µ:unsub-stream`.

### `µ:resync` — la décision serveur

| Situation au `µ:resync { from }` | Réponse |
|---|---|
| `from === seq` courant | **Rien** — zéro octet, le récepteur est déjà à jour |
| `from > seq` courant (serveur redémarré, compteur reparti à zéro) | `reset` complet, nouvelle époque |
| Tous les deltas `from+1 … seq` sont encore dans le journal | **Rejeu** de **ces** deltas **seuls**, avec leurs `seq` **d'origine** (jamais renumérotés) — un récepteur qui ignore tout `seq ≤` son dernier vu peut donc recevoir un doublon sans risque |
| Trou plus large que ce que couvre le journal | `reset` complet |

Un `µ:sub-stream`/`µ:resync` vers un nom de flux **jamais** déclaré côté serveur (`app.stream(nom)` jamais appelé) répond honnêtement `{ op: 'reset', values: {} }` au `seq: 0` — jamais une création fantôme, jamais un silence qui laisserait le récepteur sans réponse. Un flux écrit par le pont (`POST /stream`) mais jamais déclaré par ce processus répond `µ:error` (accès refusé), comme un flux dont la garde refuse, ou un flux déclaré sans accès : aucun flux n'est public par défaut (`public: true` l'ouvre).

### Hors de portée de µschema

Un delta de flux n'est **jamais** schématisable en binaire (§4) — sa forme porte un `seq` que µschema ne modélise pas. `t`/`seq`/`p` restent **toujours** en JSON, quel que soit `ws.codec`.

---

<a id="jeu-spec"></a>
## 3. Trames de jeu `µgame:*`

Préfixe **réservé** par [24 · MJS-Server](24-mjs-server.md), une couche composée **au-dessus** de `mjsWs` (pas `mjsWs` lui-même) — `app.serve`/`app.on` d'un type qui commence par `µgame:`, et `app.schema`/`opts.schemas` d'un **schéma** sous ce préfixe (cf. l'encart du §0), lèvent une erreur claire côté application hôte ; jamais improvisable en dehors de MJS-Server. Chaque trame `µgame:*` est un message **applicatif** ordinaire au sens du §1 (aucun statut protocolaire spécial dans `mjsWs`) : les 4 premières ci-dessous voyagent comme des **requêtes** `{t,p,id}` (§1.1), les autres comme du pub/sub.

<a id="jeu-c2s"></a>
### 3.1 Client → Serveur (requêtes, `µ:ack` en retour)

#### `µgame:play` — s'asseoir (file publique ou partie privée)

`p = { type: string, code?: true | string, snapshots?: true }` — `type` = nom du jeu déclaré (`app.game(type, def)`) ; `snapshots` : ci-dessous ; `code` discriminé par **type**, jamais par sa seule présence :

| `code` | Effet |
|---|---|
| absent | file d'attente **publique** — la partie se crée dès que `def.seats` joueurs sont accumulés |
| `true` (booléen) | crée une partie **privée** neuve (exige `def.code: true` à la déclaration, sinon erreur) — le code généré revient dans la réponse |
| `"XXXXX"` (chaîne) | rejoint la partie privée existant à ce code — code inconnu → erreur |

Réponse `µ:ack.p` — **deux** formes :

- **pas encore assis** (file publique, quota pas atteint) : `{ attente: number }` (position dans la file) ;
- **assis** : `{ game: string, seat: number, phase, turn, seq, code: string | undefined, ...infoMode }`, où `infoMode` vaut `{ view: any }` en mode `'authoritative'` (défaut), ou `{ seed: number, journal: [...] }` en mode `'lockstep'` ([24 §13](24-mjs-server.md#netcode)) — la graine déterministe + l'historique des ordres depuis la genèse, à rejouer côté client. Quand la partie garde des instantanés (`lockstepJournal.snapshotEvery`), `infoMode` porte en plus `snapshotEvery: number` (cadence en ticks) et `snapshotMax: number` (taille maximale d'une proposition, en octets du JSON `{ tick, state, rng }`), et, dès qu'un instantané est gardé, `snapshot: { tick: number, state: any, rng: number }` : `journal` ne porte alors que les ticks qui suivent `snapshot.tick` (au moins un), à rejouer à partir de cet état et de ce générateur.

`snapshots: true` dit que le client sait repartir de cet instantané : le client du framework l'envoie quand la page charge `µ.lockstep` (modules `'lockstep'` et `'det'`), ici comme dans `µgame:resync`. Une partie `'lockstep'` dont le journal est coupé (un instantané gardé) refuse la requête qui ne le porte pas — celle d'une page d'une version qui ne sait pas lire les instantanés, qui repartirait sinon d'un journal tronqué avec un état faux : `µ:ack` d'erreur `"cette page ne sait pas reprendre la partie : son journal a été coupé par un instantané, que seule une version plus récente de la page sait lire — rechargez la page pour la reprendre"`, sans siège pris ni retrouvé. Tant que le journal est entier, une requête sans `snapshots` est servie comme les autres.

Une reconnexion sur la **même** identité (déjà assise) via `code` est **idempotente** — renvoie la même réponse de siège, ne recrée rien.

#### `µgame:move` — jouer un coup

`p = { game: string, move: string, p?: any }` — `game`/`move` obligatoires (chaînes), `p` = charge libre du coup. Réponse `µ:ack.p = { ok: true, result: <retour de def.moves[move]/def.intents[move]> }` en succès ; un `throw` interne (coup illégal, partie introuvable) devient un `µ:ack` d'erreur — **même** mécanisme générique que n'importe quel `serve()` qui lève (§1.2).

> 🔗 **Extension `_n`/`_ack` (prédiction, `µ.predict`).** Quand `game.move()` est enveloppé par `µ.predict` ([24 §13](24-mjs-server.md#netcode)), `p._n` (compteur croissant **côté client**) se glisse **dans** la charge `p` — le serveur le détache **avant** `def.intents[move]` (jamais vu par la logique de jeu) et reflète le **plus grand** `_n` appliqué dans une méta `_ack` sur `µgame:state` (3.2). Uniquement pour `def.intents` (jamais `def.moves`) — un client qui n'utilise pas `µ.predict` n'a jamais à s'en soucier.

#### `µgame:leave` — quitter la partie (vide le siège)

`p = { game: string }`. Réponse `µ:ack.p = { ok: true }`. Sans `game`, `p = { type: string }` quitte la **file publique** de ce type (le joueur renonce avant d'être apparié) : son ticket part, même réponse — rien à faire s'il n'y est plus. Contrairement à une simple déconnexion (qui **garde** le siège, en attente de reconnexion), `µgame:leave` vide le siège immédiatement — déclenche `µgame:left` et `µgame:seat` (3.2) vers les autres sièges.

#### `µgame:resync` — vue fraîche complète (reconnexion)

`p = { game: string, snapshots?: true }` — `snapshots` comme pour `µgame:play` ci-dessus (refus d'une page qui ne sait pas lire l'instantané d'un journal coupé). Réponse `µ:ack.p = { game, seat, phase, turn, seq, code, ...infoMode }` — **même** forme que la réponse « assis » de `µgame:play` ci-dessus. **Toujours une vue complète**, jamais un delta même si `def.deltas: true` — ce qui vient d'être envoyé devient la nouvelle baseline pour le **prochain** delta (3.2).

#### `µgame:hash` — annonce de hash (lockstep seul) — **aucun** `µ:ack`

`p = { game: string, tick: number, h: string }` — trois champs obligatoires (sinon ignoré silencieusement, best-effort). **fire-and-forget** : jamais de réponse, même avec un `id`. Significatif **seulement** en mode `def.mode: 'lockstep'` ([24 §13](24-mjs-server.md#netcode)) — anti-triche par **quorum** (majorité absolue des sièges courants, jamais le premier hash vu) : la référence d'un tick se fige au premier hash qui atteint ce quorum, un siège en auto-contradiction (deux hash différents pour le même tick) est flaggé suspect immédiatement (cf. `µgame:event` de type `'divergence'`, 3.2).

#### `µgame:snapshot` — instantané proposé (lockstep, `snapshotEvery`) — **aucun** `µ:ack`

`p = { game: string, tick: number, state: any, rng: number }` — `tick` et `rng` entiers, `state` présent (sinon ignoré silencieusement). **fire-and-forget**, comme `µgame:hash`. Envoyé par chaque siège au tick `tick` de la cadence `snapshotEvery`, en direct seulement : `state` = l'état de sa simulation à la fin de ce tick, `rng` = l'état du générateur partagé (entier de 32 bits non signé). Le serveur ne garde la proposition que quand au moins deux joueurs assis et la majorité absolue des joueurs assis proposent exactement le même JSON pour ce tick — seuls comptent les votes des joueurs assis au moment du décompte, celui d'un joueur parti est oublié —, et jamais tant qu'une connexion assise n'a envoyé aucun `µgame:snapshot` (un client qui ne sait pas lire les instantanés). Une proposition est reçue tant que moins de deux secondes de ticks ont suivi son tick, ou toute la cadence si elle est plus longue, et un seul tick est en cours à la fois (le premier proposé depuis le dernier accord) ; le serveur ignore une proposition pour un tick hors de cette fenêtre ou autre que celui en cours, un second vote du même joueur, et toute proposition hors de ce mode. La trame entière tient dans `limits.maxPayload` (§0) : le client ne propose jamais plus que `snapshotMax` (3.1, `µgame:play`) — au-delà, MJS-WS couperait sa connexion.

<a id="jeu-s2c"></a>
### 3.2 Serveur → Client (poussées, sans `µ:ack`)

#### `µgame:state` — l'état du jeu, **pour CE joueur**

Base commune : `{ game: string, phase, turn, seq }`, plus `_ack: number` SI CE joueur a déjà fait appliquer au moins un `_n` (cf. `µgame:move` ci-dessus — absent sinon, jamais dans la vue du jeu elle-même). Puis **exactement** un des cas suivants :

| `def.deltas` | Champ ajouté | Quand |
|---|---|---|
| `false` (défaut) | `view: any` | à chaque diffusion — vue **complète**, calculée par `def.view(game, player)` |
| `true` | `delta: [{ p: 'chemin.a.b', v: <valeur> }, { p: 'chemin.c', x: 1 }, ...]` | changement normal — `v` pose/remplace la valeur au chemin `p` (à points) ; `x: 1` supprime la clé finale du chemin |
| `true`, repli | `view: any` | 1ʳᵉ diffusion à ce joueur, OU un `µgame:resync` (toujours vue complète), OU un delta dont le JSON dépasse 60 % de celui de la vue complète |
| `true`, rien n'a changé **pour CE joueur** | *(aucune trame)* | zéro octet, pas même une trame vide |

Diffusée par microtâche (mode événementiel, `tick: 0` — les mutations d'un même tour de boucle sont groupées) ou une fois par tick (mode action, `tick > 0`). Absente en mode `'lockstep'` — le serveur n'y simule rien, cf. `µgame:orders` plus bas. Détail des deltas : [24 §11](24-mjs-server.md#deltas).

#### `µgame:event` — événement applicatif libre

`p = { game: string, type: string, p: any }` — émis par `game.send(type, p)` côté jeu, forme et sens entièrement définis par l'application (aucune contrainte au-delà de l'enveloppe). Cas réservé : `type: 'divergence'` en mode lockstep, poussé par le serveur lui-même quand un `µgame:hash` (3.1) contredit la référence du tick (ou qu'un siège s'auto-contredit) — `p.p = { tick: number, suspects: number[], reason: string }` (même objet que `def.onDivergence`, [24 §13](24-mjs-server.md#netcode)).

#### `µgame:seat` — roster (places et connexions)

`p = { game: string, seats: number, seats: Array<{ seat: number, connected: bool } | null> }` — un élément par place déclarée (`def.seats`, longueur **fixe**), `null` = place vide. Poussé à **chaque** changement (arrivée, départ, (dé)connexion) — jamais fusionné avec `µgame:state`.

#### `µgame:start` — la partie démarre (places complètes)

`p = { game: string, seat: number, phase, turn, seq, code, ...infoMode }` — **même** forme que la réponse « assis » de `µgame:play` (3.1). Poussé **une seule** fois, la 1ʳᵉ fois que `seats` est atteint, à tous les sièges qui n'ont pas eux-mêmes déclenché la complétion via leur propre réponse `µgame:play`/`µgame:resync` (celui qui déclenche reçoit l'équivalent directement dans SA réponse — jamais un `µgame:start` en double pour lui).

#### `µgame:end` — fin de partie

`p = { game: string, result: any }` — **trois** origines, cycle de vie **différent** après l'envoi (la fin « entrée refusée » d'un joueur de la file publique porte deux champs de plus, `type: string` et `queue: true`, voir la dernière ligne) :

| Origine | `result` | Après l'envoi |
|---|---|---|
| `game.end(result)` (applicatif) | l'argument **tel quel** | la partie survit encore `def.endTtl` ms (`def.emptyTtl` si `endTtl` n'est pas déclaré) — un `µgame:resync` reçoit encore sa réponse habituelle avant destruction ; elle ne porte ni `ended` ni `result` : l'issue n'y figure que si le `state` ou la `view` de l'appli la contient |
| Annulation (fenêtre `seatTtl` expirée sans confirmation sur une partie non finie, [24 §6](24-mjs-server.md#appariement)) | `{ cancelled: true, reason: 'seat-expired' }` — v1 n'a qu'**une** seule raison connue | destruction **immédiate**, aucune grâce — un `µgame:resync` ultérieur trouve la partie introuvable |
| Entrée refusée (`hooks.onJoin` refuse le joueur, [24 §4](24-mjs-server.md#les-coups) et [§6](24-mjs-server.md#appariement)) | `{ refused: true, reason: 'join-refused' }` — v1 n'a qu'**une** seule raison connue | envoyée au **seul refusé**, qui ne reçoit plus aucune trame de la partie ; la partie ne finit pas pour les autres : elle continue (refus d'un joueur déjà assis : `p = { game, result }`, avec l'identifiant d'une partie que son client connaît, et cette fin part toujours **après** la réponse de sa requête `µgame:play`), ou n'a jamais été annoncée et disparaît sans bruit (refus d'un joueur de la file publique : `game` est alors un identifiant que le client n'a jamais vu, et la trame est `p = { game, type, queue: true, result }`, où `type` est le type de jeu de la file et `queue: true` dit qu'elle vient de la file). Côté client, la poignée de `sock.game()` passe en statut `'finished'` avec ce `result` ([24 §6](24-mjs-server.md#appariement)) : pour un refus de la file, c'est la poignée la plus ancienne encore en file **pour ce type de jeu** ; une fin « entrée refusée » sans `queue: true` n'est jamais rattachée à une poignée en file. Un `onJoin` qui rejette avant la réponse de sa requête n'envoie aucune fin : la requête échoue ([24 §4](24-mjs-server.md#les-coups)) |

#### `µgame:left` — un **autre** siège est parti

`p = { game: string, seat: number }` — envoyé à **tous** les sièges connectés à la suite d'un `µgame:leave` volontaire (3.1). Ne **pas** confondre avec `µ:left` (§1.2, expulsion d'un **salon** `mjsWs` générique) — préfixe différent, mécanisme différent, aucun rapport entre les deux.

#### `µgame:orders` — mode lockstep seul, à **chaque** tick clos

`p = { game: string, tick: number, orders: [{ player: string, move: string, p: any }, ...] }` — `orders` peut être **vide** (le tick lui-même est l'horloge commune, jamais sauté faute d'ordre). **Même** trame diffusée à l'**identique** à tous les sièges connectés — l'égalité d'entrée entre clients est le cœur du déterminisme lockstep ([24 §13](24-mjs-server.md#netcode)). Remplace `µgame:state` dans ce mode — un `def.mode: 'lockstep'` ne pousse **jamais** de `µgame:state`.

---

<a id="binaire-spec"></a>
## 4. Format binaire µschema

Couche opt-in qui remplace le JSON par des octets compacts pour un type applicatif **déclaré** — jamais les trames de contrôle `µ:`, jamais les requêtes, jamais les deltas de flux (§2), jamais `µgame:*` (garde de MJS-Server, cf. l'encart du §0). Vue d'ensemble et déclaration (`app.schema`/`µ.schema`) : [23 §3.1](23-mjs-ws.md#µschema). Ici : la forme **exacte** des octets, pour qui doit l'encoder/décoder hors JS.

### Enveloppe fil (WebSocket)

```
[u8 idSchéma][charge]
```

Trame WebSocket **binaire** entière — pas de `{t,p,id}` JSON autour. `idSchéma` (1 octet, 0-255) identifie le schéma, attribué dans l'**ordre** de déclaration (`app.schema`/`µ.schema`), **jamais** choisi à la main — deux registres déclarés dans le **même** ordre obtiennent les **mêmes** ids (condition du hash stable, plus bas). `fields` (à la déclaration) est un objet **ordonné** `{ nom: type, ... }` — l'**ordre des clés** fait foi sur le fil, figé à la déclaration, jamais recalculé.

### Types scalaires

| Type | Taille | Encodage |
|---|---|---|
| `u8` / `i8` | 1 octet | entier non signé / signé |
| `u16` / `i16` | 2 octets | entier non signé / signé, **little-endian** |
| `u32` / `i32` | 4 octets | entier non signé / signé, little-endian |
| `f32` | 4 octets | flottant simple précision IEEE 754, little-endian |
| `f64` | 8 octets | flottant double précision IEEE 754, little-endian |
| `bool` | 1 octet | `0x00` = `false` ; encodé `0x01` pour `true` (décodé : tout octet non nul = `true`) |
| `str8` | 1 (préfixe) + N octets | préfixe `u8` = longueur EN **octets** UTF-8 (max 255), puis les octets UTF-8 |
| `str16` | 2 (préfixe) + N octets | préfixe `u16` little-endian = longueur EN **octets** UTF-8 (max 65535), puis les octets |

**Toutes les valeurs multi-octets sont little-endian, sans exception** (u16/i16/u32/i32/f32/f64, et les préfixes de longueur u16 de `str16`/`list`).

### Types composites — `list()` / `bits()`

| Type | Encodage | Notes |
|---|---|---|
| `list(scalaire)` | `u16` (compteur, little-endian, max 65535) puis `scalaire` répété N fois | v1 : `scalaire` **uniquement** — pas de `list(list(...))`, pas de sous-schéma imbriqué |
| `bits([noms])` | 1 octet — bit `i` (`1 << i`) porte `noms[i]` | jusqu'à 8 noms ; décodé en objet `{ [nom]: bool, ... }` |

### Encodage d'une trame

```
octet 0     : idSchéma (u8)
octet 1..N  : fields, DANS L'ORDRE DE DÉCLARATION, chacun selon son type
```

Une valeur absente ou d'un type inattendu s'encode en valeur **zéro** (`0`, `false`, chaîne vide, liste vide) plutôt que de lever — **seules** les erreurs **structurelles** (schéma inconnu à l'encodage/décodage, chaîne ou liste trop longue pour son préfixe) déclenchent une exception.

**Exemple** — schéma `pos: { x: 'i16', y: 'i16' }` déclaré EN **premier** (id `0`), valeur `{x: 300, y: -20}` :

```
octet    0     1     2     3     4
valeur   0x00  0x2C  0x01  0xEC  0xFF
sens     id    x = 300 (i16 LE)  y = -20 (i16 LE, complément at deux : 0xFFEC)
```

5 octets au total (1 id + 2 × 2 octets) contre 18 pour `{"x":300,"y":-20}` en JSON.

### Garde d'évolution — **ajout-seul**

Un schéma déjà déclaré est **immuable** (mêmes champs, mêmes types, **même** ordre). Le ré-affirmer À **l'identique** (rechargement à chaud d'un entry) est un no-op silencieux, id inchangé ; le ré-affirmer sous une forme **différente** lève une erreur claire au boot. Faites évoluer votre protocole en déclarant un schéma à un **nom neuf**, jamais en mutant un schéma existant.

### Hash du registre — FNV-1a 32 bits

`hashRegistre()` calcule un FNV-1a 32 bits, rendu en **hex** sur **exactement** 8 caractères (zéros de tête inclus), sur la chaîne :

```
nom1:champA=type,champB=type|nom2:champC=type|...
```

— schémas dans l'ordre de **leur** id, champs dans l'ordre du fil, type décrit `u8`/`str8`/… tel quel, ou `list(u8)` / `bits(a+b+c)` pour un composite. Sert à détecter un **désaccord** entre deux registres (client/serveur, ou deux implémentations dans deux langages) — **pas** une preuve d'intégrité cryptographique (FNV-1a n'est pas conçu pour résister à une collision volontaire).

> ⚠️ **Suppose des noms ASCII.** L'algorithme diverge entre une implémentation JS (`charCodeAt`, unités UTF-16) et une implémentation Ruby/Python (`each_byte`, octets UTF-8) **seulement** si un nom de schéma ou de champ contient un caractère non-ASCII — jamais sur les **valeurs** des champs eux-mêmes (celles-ci suivent l'encodage scalaire ci-dessus, indépendant du hash).

### Sérialisation JSON du registre — `µ:schema` (§1.2) et rafraîchissement HTTP

```json
{
  "hash": "1a2b3c4d",
  "schemas": [
    { "nom": "pos",  "champs": [["x", "i16"], ["y", "i16"]] },
    { "nom": "etat", "champs": [["hp", "u8"], ["tags", { "kind": "list", "of": "str8" }], ["drapeau", { "kind": "bits", "noms": ["vivant", "arme", "vip"] }]] }
  ]
}
```

`fields` = tableau de paires `[nom, type]` **dans l'ordre** fil — `type` est une chaîne pour un scalaire, ou un objet `{kind:'list', of: <scalaire>}` / `{kind:'bits', noms: [...]}` pour un composite (déjà des objets **inertes**, JSON-safe — jamais une fonction embarquée). C'est **cette** forme, précisément, que porte `µ:schema.p.definitions` (§1.2) — un récepteur qui la reçoit peut reconstruire un registre complet sans connaître le code source de l'application.

### µschema-HTTP — même charge, 8 octets de version en préfixe

`µ.ajax.binary(url, opts)` (opt-in **par point d'accès**, [23 §3.2](23-mjs-ws.md#µschema)) réutilise **exactement** l'enveloppe ci-dessus, préfixée de 8 octets ASCII :

```
[8 octets ASCII — hash hex, LITTÉRAL, PAS un entier packé][u8 idSchéma][charge]
```

Les 8 octets sont `hashRegistre()` écrits **tels quels** en caractères ASCII (lisibles dans un dump hexa sans le moindre calcul bit à bit) — le reste de la trame est identique à l'enveloppe WebSocket ci-dessus. Une réponse dont la version diffère du registre local déclenche un rafraîchissement (un `GET` sur l'endpoint schéma, un seul aller-retour, jamais une boucle) plutôt qu'un échec. Détail complet + recette Rails `Array#pack`/`String#unpack1` (sans dépendance) : [23 §3.2](23-mjs-ws.md#µschema).

### Trois modes de transport — `ws.codec`

Détermine **quand** le binaire remplace le JSON pour un type **schématisé** — détail complet (y compris la garde de débit/taille partagée avec le texte) : [23 §3.1](23-mjs-ws.md#µschema).

| `codec` | Sortant (`send`/`sendUser`/`broadcast`/`room().send`) | Entrant |
|---|---|---|
| `'auto'` (défaut) | type schématisé → binaire ; sinon JSON, comme sans µschema | accepte texte ET binaire |
| `'binary'` (**strict**) | type schématisé → binaire ; type applicatif **sans** schéma → **lève** immédiatement, avant tout envoi | trame **texte** applicative (hors `µ:`) → **rejetée** (`µ:error` throttlé, jamais routée) |
| `'json'` | toujours JSON, même un type schématisé (coupe-circuit débogage) | accepte texte ET binaire |

Les trames de contrôle `µ:` (§1) restent **toujours** JSON, quel que soit `codec` — le bootstrap du hello ne peut pas dépendre d'un schéma pas encore synchronisé.

---

<a id="securite-spec"></a>
## 5. Sécurité du pont HTTP

Tout ce qui précède (§1-§4) ne couvre **que** la connexion WebSocket. Un second canal existe pour qu'un back **hors** `mjsWs` (Rails, PHP, un worker) pousse du temps réel ou reçoive des décisions déléguées : le **pont universel** ([23 §7](23-mjs-ws.md#pont)) — un serveur HTTP séparé, signé, embarqué dans le même process. Cette section **renvoie** au détail complet (endpoints, webhooks, jetons, proxy de décisions, recettes par langage) plutôt que de le dupliquer ; elle résume seulement la mécanique de signature, utile pour l'implémenter dans un langage sans recette déjà écrite.

### La chaîne canonique

Chaque requête **signée** (tout le pont **sauf** `GET /health`, et le proxy de décisions, [23 §7.11](23-mjs-ws.md#pont)) porte ces en-têtes :

| En-tête | Contenu |
|---|---|
| `x-mjs-ws-timestamp` | heure UNIX EN **secondes** au moment de la signature |
| `x-mjs-ws-nonce` | sur les commandes de votre back vers le pont : une chaîne **neuve** de 8 à 64 caractères, exigée par défaut ([23 §7.10](23-mjs-ws.md#pont)) ; les webhooks n'en portent pas |
| `x-mjs-ws-signature` | HMAC-SHA256 **hexadécimal** de la chaîne canonique, avec le secret partagé |

Chaîne canonique du pont admin/webhooks — champs encodés en **longueur-préfixée** (`{longueur}:{champ}`, injectif) et concaténés, `direction` en premier champ ([23 §7.2](23-mjs-ws.md#pont)) :

```
{lp(direction)}{lp(timestamp)}{lp(MÉTHODE)}{lp(chemin+query)}{lp(corps brut)}[{lp(nonce)}]
```

`direction` vaut `'in'` (commande admin, votre back → le pont) ou `'out'` (webhook, le pont → votre back) — **jamais** interchangeables, **même** secret partagé ; `{MÉTHODE}` en **majuscules** ; `{chemin+query}` tel qu'il apparaît dans l'URL (jamais domaine ni port) ; `{corps brut}` = le JSON envoyé **texte pour texte** (jamais re-sérialisé — l'ordre des clés compte), chaîne **vide** pour un `GET`. Le nonce ([23 §7.10](23-mjs-ws.md#pont)) s'ajoute en **dernier** champ des commandes de votre back (`'in'`), exigé par défaut ; les webhooks (`'out'`) n'en portent pas.

**Les longueurs se comptent en unités UTF-16**, comme `String.length` en JavaScript — ni en octets, ni en caractères : `é` compte 1, un émoji comme `🎉` compte 2. Une longueur en octets fait refuser toute requête dont le corps porte un accent (`401`). En Ruby : `champ.encode('UTF-16LE').bytesize / 2`.

### Vérification et fenêtre anti-rejeu

Comparaison en temps **constant** (`crypto.timingSafeEqual` ou équivalent — jamais une comparaison de chaînes naïve, qui fuiterait la validité par le temps de réponse). Fenêtre anti-rejeu par défaut : `|now − timestamp| > 300s` → `401`, même avec une signature juste. Le nonce, exigé par défaut sur les commandes de votre back ([23 §7.10](23-mjs-ws.md#pont)), ferme cette fenêtre : chaque requête ne sert qu'une fois (`bridge.nonce: false` le retire, la fenêtre seule protège alors du rejeu).

### Qui signe quoi

| Sens | Signataire | Vérificateur | `direction` |
|---|---|---|---|
| Votre back → pont (`/broadcast`, `/send`, `/room/send`, `/room/kick`, `/stream`, `/presence`) | votre back | le pont | `'in'` |
| Pont → votre back (webhooks, [23 §7.5](23-mjs-ws.md#pont)) | le pont | votre back | `'out'` |
| `mjsWs` → votre back (proxy de décisions `auth`/`rooms.join`, [23 §7.11](23-mjs-ws.md#pont)) | `mjsWs` | votre back | — (chaîne **historique**, pas de `direction` — cf. [23 §7.11](23-mjs-ws.md#pont)) |

**Même** algorithme longueur-préfixée pour les **deux** premiers sens (pont admin/webhooks) — seul `direction` change entre eux ; le proxy de décisions (3e ligne) reste sur la chaîne **historique** `'.'`-jointe, secret et canal séparés (`bridge.secret`/`webhooks.secret` ≠ secret du proxy). Votre back doit donc savoir signer (requêtes sortantes) ET vérifier (requêtes entrantes) — les **deux** formats s'il utilise le pont ET le proxy. Recettes par langage : jetons JWT ([23 §7.6](23-mjs-ws.md#pont), Ruby/PHP/Python sans dépendance + gem `jwt`), pont depuis Rails ([23 §7.7](23-mjs-ws.md#pont)), trois recettes combinées bout en bout ([23 §7.12](23-mjs-ws.md#pont)).

### Ce qui reste **hors** du pont

Les jetons `µ:hello`/`µ:refresh` (§1) sont un mécanisme **séparé** (JWT HS256, [23 §7.6](23-mjs-ws.md#pont)) — pas de chaîne canonique HMAC, pas de fenêtre anti-rejeu par requête (l'échéance `exp` du jeton joue ce rôle, suivie en continu côté serveur, [23 §7.9](23-mjs-ws.md#pont)). Les deux mécanismes de signature (pont HTTP, jetons WebSocket) sont **indépendants** et utilisent généralement des secrets **différents** — ne pas les confondre en déploiement (`bridge.secret` ≠ `auth`/`rooms.join` proxy secret ≠ secret de signature JWT applicatif).

---

*Voir aussi : [20 · Temps réel](20-temps-reel.md) pour le client `µsocket` (ce que ce protocole rend inutile à réécrire à la main), [23 · MJS-WS](23-mjs-ws.md) pour le serveur de référence qui l'implémente, [24 · MJS-Server](24-mjs-server.md) pour la couche de jeu composée par-dessus.*
