# 20 · Temps réel (µsocket)

> 📚 Tuto interactif correspondant : **Temps réel → Réseau réactif** (client) et **Temps réel → Côté serveur** (protocole `µ:`). Les encarts 🎓 *Pour débutants* dépliables donnent l'explication pas-à-pas ; le corps de la page reste la référence dense.

`µsocket` est une couche **WebSocket réactive** : on ouvre une connexion, et l'état de cette connexion (`state`, `latency`, `connected`, `lastError`) ainsi que les données qu'elle transporte (**flux**, **présence**) sont des valeurs **réactives** — elles re-rendent les composants qui les lisent, sans `µeffect` ni abonnement manuel.

Un `µsocket(url)` est un **singleton par URL**, référence-compté : deux composants qui ouvrent la même URL partagent la **même** connexion. La connexion est **paresseuse** — elle ne s'ouvre qu'au premier `on`/`send`/`request`/`stream`, ou explicitement via `.connect()`.

```html
<script>
  @sock = µsocket "wss://jeu/play"
</script>

<p>État : {@sock.state} · latence : {@sock.latency} ms</p>
```

> 🔤 **Syntaxe.** `µsocket url` est le sucre sans point de `µ.socket(url)`. `µsmooth` de même pour `µ.smooth`. Les deux formes sont équivalentes.

---

## 1. État réactif de la connexion

| Propriété | Type | Sens |
|---|---|---|
| `state` | `'closed' \| 'connecting' \| 'reconnecting' \| 'open'` | Cycle de vie. `open` n'est atteint **qu'après le handshake** `µ:welcome`. |
| `connected` | `bool` | Raccourci `state === 'open'`. |
| `latency` | `number \| null` | Aller-retour du dernier `µ:ping`/`µ:pong`, en ms. |
| `lastError` | `object \| null` | Dernière erreur (`µ:error`, `µ:denied`, coupure réseau…). |

Toutes sont réactives : `<span class="dot" @class{@sock.connected}="on">` bascule tout seul.

---

## 2. Publier / s'abonner — `send` / `on`

```html
off = @sock.on 'chat', (p)-> $messages.push(p)   # abonnement, renvoie un dé-abonnement
@sock.send 'chat', { texte: 'salut' }             # publication
```

`on(type, handler)` renvoie une fonction de **dé-abonnement**. Le type est ré-envoyé au serveur en `resub` après une reconnexion (rien à re-brancher à la main). 3ᵉ argument optionnel `{ owner: @ }` : dé-abonnement **automatique** à la destruction du composant appelant (même mécanisme que `owner` de `µsmooth`, § 6) — sans lui, `off()` (ou la fonction rendue) reste à rappeler à la main.

### Anti-spam à l'envoi

`send` accepte un 3ᵉ argument d'options :

| Option de `.send(type, p, opts)` | Rôle |
|---|---|
| `cooldown` | Millisecondes minimales entre deux envois du **même type** ; un envoi trop tôt est **jeté** (retourne `false`). |
| `coalesce` | **Millisecondes** minimales entre deux envois du même type (ou `true` → `coalesceMs`) : ne garde que le **dernier** payload et l'émet à cette cadence. Idéal pour un curseur, un joystick, une position. Même unité que `cooldown`. `0` = au prochain tour de boucle ; une valeur négative vaut 0. |
| `debounce` | **Millisecondes** de silence sur le même type avant émission (ou `true` → `debounceMs`) : à la différence de `coalesce` (cadence fixe même sous activité continue), rien ne part tant que les envois s'enchaînent — seul le **dernier** payload part, à la première pause. Idéal pour un champ de recherche, un curseur qu'on relâche. `0` = au prochain tour de boucle ; une valeur négative vaut 0. |
| `key` | Une clé qui range l'envoi à part des autres envois du même type pour `coalesce` et `debounce` (un salon, une zone) : deux salons du même type ne s'écrasent pas. |
| `volatile` | `true` : une trame qui ne vaut que maintenant (une position, un émoji) — **jamais mise en file hors ligne** : sans connexion ouverte, elle est jetée. Elle ne chasse pas les messages de l'appli de la file, et n'est pas rejouée d'un coup à la reconnexion. Les effets en direct (`*follow`, `*cursors`, `*react`, `*heatmap`) envoient ainsi. Un envoi `volatile` **regroupé** (`coalesce`) prend sa place dans la part des effets en direct, que tous les effets et tous ces envois de l'appli se partagent : 4 trames par seconde (`"effects": { "rate": 4 }` de `mjs.config.json`) ; au-delà, la dernière valeur attend de la place et part dès qu'il y en a. |

Une chaîne numérique est acceptée (`'300'`) ; toute autre valeur non numérique est ignorée avec un avertissement.

Les deux options sont exclusives sur un même envoi : si `debounce` est présent, il l'emporte et `coalesce` est ignoré.

```html
@sock.send 'curseur', { x, y }, { coalesce: 33 }   # au plus 1 envoi / 33 ms (~30 trames/s), la dernière gagne
```

### L'accueil du serveur — `sock.on('welcome', …)` / `sock.resumed`

Le serveur peut joindre des données à son accueil (option `welcome(client)` côté `mjsWs`, cf. [23 · MJS-WS](23-mjs-ws.md)) — un horodatage, une identité validée, ou `resumed` après une reprise de session (§8 de [23 · MJS-WS](23-mjs-ws.md)). Ça se lit ainsi, côté client :

```html
@sock.on 'welcome', (p)->
  µ.log 'accueil serveur :', p.serverTime
  µ.log 'reprise à chaud :', @sock.resumed
```

`@sock.resumed` (bool, `false` par défaut) dit si **ce** `µ:welcome` clôt une reprise de session réussie (`true`) ou un accueil neuf (`false`) — mis à jour à chaque welcome. `p` reçu par le handler `'welcome'` est une copie de la charge envoyée par le serveur, **sans** le champ `session` (la carte de session est de la plomberie interne à la reprise — id et clé n'ont rien à faire dans les mains de l'appli).

> ⚠️ **Nom réservé.** `'welcome'` devient un nom d'événement réservé côté client : un message applicatif serveur qui s'appellerait littéralement `welcome` déclencherait les **mêmes** handlers (même mécanisme `on`/`send` que n'importe quel autre type pub/sub).

### Le refus du serveur — `sock.on('denied', …)`

Miroir exact de `'welcome'` : le serveur refuse l'authentification (jeton absent, signature fausse, **jeton expiré**), envoie `µ:denied`, et le socket se ferme **définitivement** — plus de reconnexion automatique, le minuteur est annulé, `sock.state` reste `'closed'`. C'est voulu : réessayer avec le même laissez-passer donnerait le même refus, en boucle. Les requêtes qui attendaient l'ouverture (`waitForOpen`) sont rejetées avec `code: 'denied'` et la raison du refus, la file hors-ligne est vidée et les envois différés (`debounce`, `coalesce`) encore en attente sont annulés, avec un avertissement dans la console qui dit combien de messages ne partiront pas : rien de ce qui a été écrit pour l'identité refusée ne part sous une autre.

C'est donc à l'appli d'aller chercher un laissez-passer frais et de rouvrir. `'denied'` est le signal qui le lui dit :

```html
@sock.on 'denied', (p)->
  µ.error 'fil refusé :', p.message
  µ.ajax.get '/api/token', (res)->
    return unless res?.ok
    $$session.token = res.token   # relu par l'option `auth` à la prochaine ouverture
    @@sock.connect()              # le socket est déjà au repos : connect() rouvre pour de bon
```

Le handler tourne **après** la fermeture, exactement comme `'welcome'` tourne après l'ouverture : `connect()` appelé depuis là repart proprement. Prévoyez une **borne** au nombre de reprises (un secret changé côté serveur refusera aussi le jeton neuf) — remise à zéro au `'welcome'` suivant.

La file hors-ligne (les `send()` en attente) part avec l'identité refusée : elle est vidée, rien d'elle ne repart à la réouverture. Avec les comptes (`sock.account`, cf. [27 · Comptes](27-accounts.md)), un jeton de compte refusé fait repartir la connexion en invité, tout seul.

Pour renouveler un jeton **sans** fermer le fil (en vol, avant l'échéance), c'est `sock.refresh(auth)` — cf. [23 · MJS-WS](23-mjs-ws.md).

> ⚠️ **Nom réservé**, même réserve que `'welcome'` : un message applicatif serveur littéralement nommé `denied` déclencherait les mêmes handlers.

---

## 3. Requête / réponse — `request`

Contrairement à `send` (sans retour), `request` renvoie une **Promise** résolue par la réponse du serveur (`µ:ack`).

```html
try
  solde = await @sock.request 'achat', { item: 'épée' }
catch e
  µ.error e.code, e.message   # 'timeout' | 'offline' | 'denied' | 'unknown' | 'closed' | 'left' | erreur applicative
```

| Option de `.request(type, p, opts)` | Défaut | Rôle |
|---|---|---|
| `timeout` | `opts.timeout` du socket, sinon **5000** ms | Délai avant `reject({ code: 'timeout' })`. |
| `waitForOpen` | `false` | `false` = `reject({ code: 'offline' })` immédiat si le socket n'est pas `open`. `true` = ne rejette pas tout de suite (laisse courir jusqu'au `timeout`). |

Une requête que la connexion ne mène pas au bout est rejetée avec un `code` qui dit si elle est partie :

- `'denied'` : jamais partie — le serveur a refusé l'identité (`µ:denied`) pendant qu'elle attendait l'ouverture ; elle ne part sous aucune autre identité, `message` porte la raison du refus.
- `'unknown'` : partie, puis la connexion a été renouvelée par le runtime avant la réponse (élévation d'un compte, cf. [27 · Comptes](27-accounts.md)) : le serveur a pu la servir, sa réponse est perdue — ne la rejouez pas sans vérifier.
- `'closed'` : la connexion s'est fermée avant la réponse (coupure réseau, `close()`, `destroy()`) ; déjà partie, elle a pu être servie.
- `'left'` : jamais partie — demandée par une poignée de salon après son `leave()` (cf. les salons, plus bas).

**Changer le timeout :**

```html
# par requête (prioritaire)
await @sock.request 'achat', p, { timeout: 15000 }

# global, pour TOUTES les requêtes du socket
@sock = µsocket url, { timeout: 15000 }   # défaut 5000 ms
```

Côté serveur, une requête arrive **sans préfixe `µ:`**, sous la forme `{ t: <type>, p, id }`. Le serveur **doit** répondre `{ t: 'µ:ack', id, e?, p }` avec le **même `id`** — `e` vrai → la Promise `reject(p)`, sinon `resolve(p)`.

### UI optimiste — `µ.optimistic`

Pour une mutation qui **doit** paraître instantanée (incrémenter un compteur, poster un message qui apparaît tout de suite dans le fil) sans attendre l'aller-retour de `request` ci-dessus, `µ.optimistic` (module runtime `'optimistic'`) applique le changement **localement, tout de suite**, sur n'importe quel store — puis annule (**rollback**) si la requête échoue. Façon Meteor :

```html
<script>
  $compteur = µ.state({ n: 0 })

  incrementer = ->
    µ.optimistic $compteur, {
      apply: (state)-> state.n += 1                # brouillon — MUTE en place (ou renvoie un nouvel état)
      via:       -> @sock.request 'incrementer', {}    # la vraie requête, typiquement sock.request
    }
</script>

<button @click={incrementer}>{$compteur.n}</button>   <!-- bouge IMMÉDIATEMENT, avant tout retour serveur -->
```

`µ.optimistic(store, opts)` renvoie une **Promise** qui résout `{ ok: true, response }` en cas de succès, `{ ok: false, error }` sinon — **jamais un rejet** : pas de `try/catch` à écrire, juste lire `.ok`.

- **Succès** — la valeur optimiste est **gardée**. Avec un `after: (state, response)-> …` optionnel, ré-applique la **réponse** serveur par-dessus (utile si le serveur calcule une valeur différente de la devinette locale — un `id`/horodatage généré serveur, un compteur **partagé** entre plusieurs clients) :

  ```html
  µ.optimistic $messages, {
    apply: (state)-> state.liste.push { texte: texte, pending: true }   # apparaît TOUT DE SUITE
    via:       -> @sock.request 'poster', { texte: texte }
    after:      (state, response)-> state.liste[state.liste.length - 1] = response.message   # remplacé par la version serveur (id définitif…)
  }
  ```

- **Échec** (throw serveur, `µ:error`, timeout réseau — n'importe quel rejet de `via()`) — **rollback** automatique : le store revient **exactement** à l'état d'avant l'appel.
- **`apply` ou `after` qui lève** — compte comme un échec : la promesse résout `{ ok: false, error }`, l'effet de cet appel est retiré et le store reste sain pour les appels suivants. Un `apply` qui lève n'envoie rien : `via()` n'est pas appelé.

**Plusieurs `µ.optimistic` empilés sur le même store** (deux clics rapprochés) restent cohérents : chaque appel a sa propre entrée dans une file, rejouée par-dessus une base commune. Un échec ne retire **que** sa propre entrée — jamais l'effet d'une sœur encore en vol (cf. l'en-tête de `src/runtime/mjs_optimistic.ts` pour le détail de la stratégie, « snapshot chaîné + rejeu séquentiel »).

> 🔗 Pour un **jeu** (`sock.game()`), `µ.predict` ([24 · MJS-Server « Prédiction du mouvement propre »](24-mjs-server.md#prédiction-du-mouvement-propre--µpredict)) est le cousin **spécialisé** de `µ.optimistic` — même patron (snapshot + rejeu), pensé pour des **intentions** rejouées contre un état serveur autoritaire par tick plutôt qu'une requête/réponse générique.

---

## 4. Flux réactif — `stream`

Pour une liste que le **serveur** maintient (ennemis, positions, objets au sol), `stream(type)` renvoie un **store réactif** `{ id → donnée }` que le serveur remplit par petits **deltas numérotés**, avec **resynchronisation automatique** si un paquet manque.

```html
<script>
  @sock    = µsocket "wss://jeu/play"
  @ennemis = @sock.stream 'ennemis'
</script>

{for id, en in @ennemis}
  <circle cx={en.x} cy={en.y} r="6" />
{end}
```

Les **quatre opérations** de delta (champ `op`) :

| `op` | Charge | Sens |
|---|---|---|
| `reset` | `p.values = { id → donnée }` | Instantané complet (réponse à `µ:sub-stream` / `µ:resync`). |
| `add` | `p.key` + `p.value` | Nouvel élément. |
| `update` | `p.key` + `p.patch` | Fusion partielle sur un élément existant. |
| `remove` | `p.key` | Retrait d'un élément. |

Enveloppe : `{ t: 'ennemis', seq, p: { op, key?, value?, patch?, values? } }`. Chaque delta porte un **`seq` contigu** ; si le client détecte un trou, il émet **automatiquement** `µ:resync` et le serveur renvoie un `reset`. **Rien à coder côté client.**

Pour ne plus suivre un flux sans fermer la connexion ni quitter de salon : `@sock.unstream 'ennemis'`. Le serveur n'en envoie plus rien (`µ:unsub-stream`), il n'est plus redemandé à la reconnexion, et le magasin garde son dernier état. Appelé hors ligne, le désabonnement part à la reconnexion si le serveur reprend la session (elle garde ses abonnements, cf. [23 · MJS-WS §8](23-mjs-ws.md#reprise-session)) ; une session neuve n'en a aucun. Une trame de ce flux qui arrive encore (partie avant le désabonnement, rejouée par la reprise) ne va à personne, ni au magasin ni aux écouteurs `on('ennemis')`, et un serveur qui pousse encore ce flux reçoit de nouveau le désabonnement, une fois par connexion. Jusqu'à un accueil neuf ou un nouveau `stream('ennemis')`, ce nom n'est plus un message ordinaire pour `on()`. Ce magasin est partagé : tous ceux qui l'ont reçu de `stream('ennemis')` le perdent, et un `stream('ennemis')` ensuite repart d'un magasin neuf. Un type qui n'est pas suivi ne fait rien (aucune trame, aucune connexion ouverte). La poignée d'un salon a le sien : `salon.unstream('main')` ; partie (`leave()`), elle ne fait rien.

Côté serveur, un flux est **fermé par défaut** : il faut l'ouvrir pour que le client le reçoive — `app.stream('ennemis', { public: true })` pour tous, `room` ou `canSubscribe` pour le réserver ([23 · MJS-WS §5](23-mjs-ws.md#flux)). Un flux fermé répond `µ:error` (accès refusé, dans `lastError`), jamais ses données ; ce refus nomme le flux (voir « Flux refusé » au §9).

---

## 5. Présence & salons — `presence` / `room`

```html
@players = @sock.presence()          # présence globale (ou d'un salon rejoint : salon.presence())
salon    = @sock.room 'partie-42'    # rejoint un salon (µ:join)
salon.on 'coup', (p)-> …            # écoute scopée au salon
salon.send 'coup', { case: 12 }
salon.leave()                        # quitte (µ:leave)

@sock.sendTo 'partie-42', 'coup', { case: 12 }   # raccourci SANS rejoindre le salon (aucun µ:join)
```

`presence()` renvoie un store réactif `{ id → méta }` (`id` : l'`identity.id` d'un compte, ou `anon:` suivi de l'id de connexion d'un visiteur sans compte), alimenté par des deltas `join`/`leave`/`reset`. `room(name)` renvoie un objet scopé (`on`/`send`/`request`/`stream`/`unstream`/`presence`/`leave`) dont les types sont préfixés `name/`. Le serveur peut **exclure** un client (`µ:left`) → callback `salon.onLeft(fn)`. Un salon, un flux ou un type de message peut porter n'importe quel nom, même celui d'une méthode des objets JavaScript (`toString`, `constructor`, `__proto__`…) : il se rejoint, s'écoute et se quitte comme les autres. Il en va de même des identifiants venus du serveur : une réponse de requête, un message de discussion, une partie, une invitation, une annonce ou une entité lissée (`µ.smooth`) qui porte un tel nom est traitée comme les autres. Seule exception, les magasins réactifs : ceux de `presence()` et de `stream()`, comme celui que rend `µ.smooth`, sont des états réactifs (`µ.state`), qui refusent toujours `__proto__`, `constructor` et `prototype` comme clé ; un pair, une clé de flux ou une entité lissée de ce nom est écarté, et une trace le dit en console pendant le développement (une seule fois par nom pour une entité lissée). Les données, elles, gardent toutes leurs clés, ces trois noms compris : la méta d'un pair, la valeur d'une clé de flux, les champs d'une mise à jour (`update`), la charge de `welcome`, et les copies que font `µ.smooth`, `µ.interp`, `µ.predict`, `µ.optimistic` et `µ.spring` — un champ `__proto__` y reste un champ, il ne devient jamais le prototype de la copie.

**La présence d'un salon est réservée à ses membres** : rejoignez-le (`sock.room(nom)`) avant de la demander (`salon.presence()`, ou `presence(nom)`). Un non-membre reçoit un `µ:error { message, code: 'presence-denied', room }` (dans `lastError`), jamais la liste. Pour qu'elle se voie sans entrer (« qui joue » sans jouer), le serveur l'ouvre : `app.room(nom, { presence: 'public' })`, ou sa garde `rooms.canSeePresence` ([23 · MJS-WS §4](23-mjs-ws.md#salons-presence)).

**La présence globale (`presence()` sans salon : qui est connecté au serveur) est fermée par défaut** : le client reçoit un `µ:error { message, code: 'presence-denied' }`, sans `room` (dans `lastError`), et son magasin reste vide. Le serveur l'ouvre à tous d'une ligne : `mjsWs({ presence: 'public' })` ([23 · MJS-WS §4](23-mjs-ws.md#salons-presence)).

À l'ouverture de la connexion comme à chaque reconnexion, le client entre dans ses salons **avant** de redemander ses flux : un flux réservé à un salon côté serveur (option `room`, ou garde qui lit l'appartenance) est servi même ouvert avant que la connexion soit prête. Connexion déjà ouverte, rejoignez le salon avant d'ouvrir son flux (`sock.room(nom)` puis `sock.stream(…)`) : demandé avant, il peut être refusé (`µ:error`).

Plusieurs `room(nom)` du même salon sur une même connexion (deux composants, une discussion et un composant qui écoute ce salon) partagent une seule entrée dans le salon, qui compte ses poignées : le `leave()` de l'une ne retire que ses propres écoutes (et son `onLeft`), le salon n'est quitté (`µ:leave`, flux et présence du salon oubliés) qu'au départ de la dernière. Ce départ, appelé hors ligne ou parti juste avant une coupure, repart à la reconnexion si le serveur reprend la session (elle garde ses salons, cf. [23 · MJS-WS §8](23-mjs-ws.md#reprise-session)), avant les salons rejoints — sans quoi le serveur vous compterait encore dans le salon, les autres membres vous verraient présent et ses messages vous parviendraient. Le client retient ce départ jusqu'à la preuve que le serveur l'a pris en compte : la réponse du serveur à une trame partie après lui sur la même connexion — le serveur traite les trames d'une connexion dans l'ordre —, soit le `µ:pong` d'un battement de cœur, soit le `µ:ack` d'une requête (`request()`), ou un accueil neuf, qui n'a plus aucun salon. Faute d'une telle réponse, le client envoie lui-même un `µ:ping` de preuve, un seul pour tous les départs en attente, une fois la connexion calme depuis une seconde (aucune trame partie) — avec ou sans battement (`heartbeat: 0`) —, ou aussitôt dès dix départs qu'aucun `µ:ping` n'a suivis ; à une reprise, il part juste après les départs redits. Un échange suivi n'en reçoit donc aucune trame de plus : une boucle qui rejoint puis quitte un salon toutes les 300 ms envoie un `µ:join` et un `µ:leave` par tour, rien d'autre. Ce `µ:ping` porte `early: true` : le battement repart de lui, une période plus tard, et le serveur n'en relève aucun écart entre battements (`client.latency`, [23 · MJS-WS](23-mjs-ws.md)) ; avec un battement de moins d'une seconde, c'est lui qui prouve le départ, sans `µ:ping` de plus (hors dix départs à la suite). Un départ repart donc au plus une fois par reprise, tant qu'il n'est pas prouvé : perdu de nouveau avec la connexion d'une reprise, il repart à la suivante ; le redire est sans effet sur un serveur qui l'avait reçu. Le client retient au plus 50 départs (autant de salons qu'un client peut en tenir par défaut sur MJS-WS, `limits.maxRoomsPerClient`) : au-delà, le plus ancien est oublié et ne repart plus. Un `room(nom)` du même salon entre-temps l'annule. Chaque poignée a son propre `onLeft` (le poser de nouveau remplace le sien, jamais celui d'une autre) : une exclusion du salon les appelle tous. Un second `leave()` de la même poignée ne fait rien. Chaque appel de `room(nom)` est une poignée : gardez celle que vous recevez, c'est son `leave()` qui compte — `sock.room(nom).leave()` sur une poignée neuve ne fait pas quitter un salon qu'une autre poignée tient encore. Une poignée partie n'inscrit ni n'envoie plus rien : après son `leave()` (une réponse qui arrive après la destruction du composant, par exemple), un `on()` ou un `onLeft()` est sans effet, `stream()` et `presence()` rendent un magasin qui ne reçoit rien (aucun abonnement, rien de repris à la reconnexion), `send()` ne part pas (il rend `false`) et `request()` est rejetée avec `code: 'left'` ; une trace le dit en console pendant le développement. Pour reprendre ce salon, prenez une poignée neuve avec `sock.room(nom)`.

`sendTo(salon, type, p, opts?)` est le raccourci **sans cérémonie** pour un envoi ponctuel scopé à un salon : équivaut à `send(salon + '/' + type, p, opts)` (mêmes options `cooldown`/`coalesce`/`debounce` que `send`), mais **sans rejoindre** le salon — contrairement à `room(salon).send(...)`, qui joint d'abord (`µ:join`) s'il ne l'a pas déjà fait.

---

## 6. Lissage réseau — `µsmooth`

Les positions réseau arrivent par à-coups (10–20 Hz). `µsmooth(source, opts)` prend un store **multi-entités** `{ id → position }` (typiquement `stream()`, §4) et renvoie un store réactif du même type, qui affiche à chaque frame la position « il y a `retard` ms » en interpolant entre les deux échantillons horodatés qui l'encadrent :

```html
<script>
  @sock    = µsocket "wss://jeu/play"
  @ennemis = @sock.stream 'ennemis'
  @fluide  = µsmooth @ennemis, { retard: 100, owner: @ }
</script>

{for id, p in @fluide}
  <circle cx={p.x} cy={p.y} r="6" />
{end}
```

Le store renvoyé se consomme comme n'importe quel store réactif (`{for id, p in ...}`) — il n'a ni `.set()` ni `.value` : c'est la **source** (`@ennemis` ci-dessus) qu'on met à jour, `µsmooth` se charge de lisser l'affichage tout seul, à partir de ce qu'elle contient.

| Option de `µsmooth(source, opts)` | Défaut | Rôle |
|---|---|---|
| `retard` (alias `delay`) | `100` ms | Fenêtre de lissage — plus grand lisse davantage, au prix d'un peu plus de latence visuelle. |
| `maxSamples` | `30` | Taille max du tampon d'échantillons conservés par entité. |
| `owner` | — | Composant appelant (`@`) : auto-dispose à sa destruction. |

Sans `owner`, `@fluide` tourne **à vie** (boucle perpétuelle, contrairement à `µspring`/`µ.interpolate` qui se stabilisent seuls dès la cible atteinte) tant que `@fluide.dispose()` n'est pas appelé à la main.

---

## 7. Le protocole serveur `µ:`

Le client parle un protocole JSON dont **toutes les trames de contrôle** portent le préfixe réservé **`µ:`**. Les messages applicatifs (pub/sub, requêtes, deltas de flux) n'ont **pas** ce préfixe. Voici l'**inventaire exhaustif** — c'est le contrat qu'un serveur (Node `ws`, Rails ActionCable custom, Go…) doit implémenter.

> 🔌 **Vous n'avez pas à l'implémenter vous-même.** Côté serveur : voir [23 · MJS-WS](23-mjs-ws.md), le serveur compagnon officiel (Node) qui parle déjà ce protocole — `mjs ws` le lance en une commande. Prise en main pas à pas : leçon tuto [Le serveur officiel (mjs ws)](https://mjs.rapturestudio.fr/tuto#/serveur-mjs-ws). Besoin d'une salle de partie (appariement, tour par tour, vue par joueur) par-dessus ? Voir [24 · MJS-Server](24-mjs-server.md), une couche optionnelle composée sur MJS-WS.

### 7.1 Client → Serveur

| Trame | Charge `p` | Quand / rôle |
|---|---|---|
| `µ:hello` | `{ auth, protocol: 1, resub: [types], rooms: [noms], schemaHash? }` | Handshake d'ouverture, émis dès l'ouverture WS. L'état reste `connecting` tant que le serveur n'a pas répondu `µ:welcome`. `resub`/`rooms` = ré-abonnements après reconnexion. `schemaHash` (`µschema`, [23 · MJS-WS §3.1](23-mjs-ws.md#µschema)) = hash du registre **client** (miroir local) — différent du serveur → celui-ci pousse `µ:schema` juste après le welcome. |
| `µ:ping` | `{ ts }` | Battement, toutes les `heartbeat` ms (défaut 15 s). Le serveur doit renvoyer `µ:pong`. |
| `µ:sub-stream` | `{ stream }` | S'abonner à un flux → le serveur répond par un delta `reset`. |
| `µ:resync` | `{ stream, from: dernierSeq }` | Trou de séquence détecté → redemande la suite. **Automatique.** |
| `µ:unsub-stream` | `{ stream }` | Ne plus suivre un flux (`unstream()`) → plus aucun delta, sans réponse ; un flux inconnu répond `µ:error`. |
| `µ:sub-presence` | `{ room }` | S'abonner à la présence (globale si `room` absent — fermée par défaut, cf. plus haut). |
| `µ:join` | `{ room }` | Rejoindre un salon. |
| `µ:leave` | `{ room }` | Quitter un salon. |
| `µ:refresh` | `{ auth }` | Rafraîchit le jeton **en vol** (`sock.refresh(...)`), sans rouvrir la connexion — **même** charge que `hello.p.auth`. Ré-authentifie via `opts.auth` ; `identity.id` doit rester **identique** (sinon refusé). Porte toujours un `id` → répond par un `µ:ack` (charge `{ exp }`, échéance neuve en secondes epoch, ou absente si le serveur ne suit pas d'échéance). |
| *(requête)* | `{ t: <type>, p, id }` | **Pas de préfixe `µ:`.** Attend un `µ:ack` de même `id`. |
| *(binaire, `µschema`)* | `[u8 idSchéma][charge]` — **aucun** `t`/`p` JSON | Un message applicatif dont le `type` a un schéma déclaré côté serveur (`app.schema`) part encodé, si `ws.codec ≠ 'json'` — décodé et routé vers `app.on`/`app.serve` **comme un message texte normal**, couche invisible pour le code applicatif. Sous la **même** garde de débit/taille qu'un message texte (cf. [23 · MJS-WS §3.1](23-mjs-ws.md#µschema)). En mode `codec: 'binary'` **strict**, une trame **texte** applicative (hors préfixe `µ:`) est **rejetée** (comptée, `µ:error` throttlé) — le client doit alors tout envoyer schématisé. |

### 7.2 Serveur → Client

| Trame | Charge `p` | Effet côté client |
|---|---|---|
| `µ:welcome` | `{}` (libre) + `schemaHash?` | Fin du handshake → état `open`, vide la file hors-ligne. **Obligatoire.** `schemaHash` (`µschema`) présent dès qu'un registre existe côté serveur — hash stable (FNV-1a) du registre (noms+types+ordre). |
| `µ:schema` | `{ version, definitions }` | (`µschema`, [23 · MJS-WS §3.1](23-mjs-ws.md#µschema)) Poussée juste après `µ:welcome` SI `hello.schemaHash` différait du serveur — `definitions` = registre complet sérialisé (JSON-safe), à recharger pour régénérer le miroir local à la volée. |
| `µ:denied` | `{ message, … }` | Auth refusée → fermeture **définitive**, aucune reconnexion. |
| `µ:pong` | `{ ts }` | Réponse au ping → calcule `latency`, calme le watchdog. |
| `µ:ack` | `{ id, e?, p }` | Réponse à une requête. `e` vrai → `reject(p)` ; sinon `resolve(p)`. |
| `µ:error` | `{ message }` (générique) — ou `{ code: 'token-expired' \| 'refresh-denied' }` (causes dédiées), `{ message, code: 'join-denied', room }` (salon refusé), `{ message, code: 'stream-denied', stream }` (flux refusé) | Erreur applicative **non fatale** → alimente `lastError`. `'token-expired'` **précède** une fermeture par le serveur (jeton expiré côté suivi `opts.token` — reconnexion possible, pas un `µ:bye`) ; `'refresh-denied'` répond à un `µ:refresh` raté — la connexion n'est **pas** affectée. |
| `µ:presence` | `{ room, op: 'reset'\|'join'\|'leave', peers\|id\|meta }` | Delta de présence. |
| `µ:left` | `{ room, reason }` | Le serveur vous a exclu d'un salon (kick) → callback `onLeft`. |
| `µ:bye` | `{ … }` | Fermeture propre décidée par le serveur → close, pas de reconnexion. |
| *(delta de flux)* | `{ t: <flux>, seq, p: { op, … } }` | Voir §4. `t` = nom du flux, **pas** de préfixe `µ:`. **Jamais** schématisé (`seq` est le signal qui l'exclut de `µschema`, cf. 23 §3.1). |
| *(binaire, `µschema`)* | `[u8 idSchéma][charge]` | **Même** enveloppe que la direction Client → Serveur (§7.1) — tout `app.send`/`sendUser`/`broadcast`/`room().send` d'un type schématisé, si `ws.codec ≠ 'json'`. |

### 7.3 Serveur `ws` de référence (Node)

```js
import { WebSocketServer } from 'ws'
const wss = new WebSocketServer({ port: 8080 })
const monde = {}                       // état du flux 'ennemis'
let seq = 0

const diffuser = (op) => {
  const msg = JSON.stringify({ t: 'ennemis', seq: ++seq, p: op })
  for (const c of wss.clients) if (c.readyState === 1) c.send(msg)
}

wss.on('connection', (ws) => {
  ws.on('message', (buf) => {
    const m = JSON.parse(buf)
    switch (m.t) {
      case 'µ:hello':                   // 1. handshake → welcome (ou µ:denied)
        ws.send(JSON.stringify({ t: 'µ:welcome', p: {} }))
        break
      case 'µ:ping':                    // 2. battement
        ws.send(JSON.stringify({ t: 'µ:pong', p: { ts: m.p.ts } }))
        break
      case 'µ:sub-stream':              // 3. abonnement flux → instantané reset
        ws.send(JSON.stringify({ t: 'ennemis', seq: ++seq, p: { op: 'reset', values: monde } }))
        break
      case 'µ:resync':                  // 4. trou → on renvoie un reset complet
        ws.send(JSON.stringify({ t: 'ennemis', seq: ++seq, p: { op: 'reset', values: monde } }))
        break
      default:                          // 5. requête applicative → µ:ack (même id)
        if (m.id != null) ws.send(JSON.stringify({ t: 'µ:ack', id: m.id, p: { ok: true } }))
    }
  })
})

// 6. boucle de jeu : numérote et diffuse des deltas
setInterval(() => {
  const id = 'e' + Math.floor(Math.random() * 4)
  monde[id] = { x: Math.random() * 240, y: Math.random() * 120 }
  diffuser({ op: 'add', key: id, value: monde[id] })
}, 500)
```

### 7.4 µschema côté client — le binaire, invisible

`µ.schema(nom, champs)` déclare (côté navigateur) un registre binaire **miroir** de celui du serveur (`app.schema`, cf. [23 · MJS-WS §3.1](23-mjs-ws.md#µschema)) — même vocabulaire de types (`u8`…`f64`, `bool`, `str8`/`str16`, `µ.list(type)`, `µ.bits([noms])`). Dès qu'un type a un schéma déclaré des **deux** côtés, `send`/`on` (§2) l'encodent/décodent en binaire automatiquement, **sans rien changer au code applicatif** :

```html
<script>
  µ.schema 'pos', { x: 'i16', y: 'i16' }   # UNE FOIS (ou dans un fichier partagé, cf. plus bas)

  @sock = µsocket "wss://jeu/play"
</script>

@sock.send 'pos', { x, y }              # part en binaire — quelques octets au lieu d'un JSON verbeux
@sock.on 'pos', (p)-> …                # reçoit l'objet décodé — AUCUNE différence avec du JSON
```

**Déclaration partagée (recommandé).** Un fichier `.mjs`/`.civet`/`.js` commun à l'appli, importé à la fois par l'entry serveur (`app.schema(...)`) et un composant client (`µ.schema(...)`) — mêmes noms/types/ordre des deux côtés ⇒ même hash ⇒ **aucun** aller-retour `µ:schema` au handshake. Alternative paresseuse : ne rien déclarer côté client — le serveur pousse `µ:schema` dès la première connexion (1 aller-retour de plus, zéro fichier à tenir synchronisé à la main).

**Le module `schema` du cœur.** Le décodage vit dans le module `schema`. Sans clé `runtime` dans `mjs.config.json`, il part avec `socket`, même quand la page ne déclare rien : un serveur qui déclare un schéma (`app.schema`) encode ses messages en binaire sans regarder ce que la page sait lire. Avec une liste `runtime`, écrivez `"schema"` à côté de `"socket"` (le préréglage `"mjs-ws"` porte les deux) : sans lui, une trame binaire reçue est ignorée — le message n'arrive jamais à `on` — et la console de développement le dit une fois, avec le module à ajouter.

**Une valeur hors plage ne part pas en binaire.** Un entier hors de la plage de son type (300 en `u8`) n'est jamais replié : le message part en JSON avec sa valeur exacte, et une erreur dans la console nomme le champ et la plage (cf. [23 · MJS-WS §3.1](23-mjs-ws.md#µschema)).

**`binary: false` — coupe-circuit à l'envoi seulement.**

```html
@sock = µsocket url, { binary: false }   # sock.send() reste TOUJOURS en JSON, même pour un type schématisé
```

La **réception**, elle, continue de décoder toute trame binaire entrante — l'encodage sortant est une décision 100 % **serveur** (`ws.codec`, cf. [23 · MJS-WS §3.1](23-mjs-ws.md#µschema)), indépendante de ce que ce client précis annonce dans son hello. Un client qui arrêterait *aussi* de décoder deviendrait sourd aux messages légitimes dès que le serveur schématise — seul l'envoi est un choix local sûr à couper.

**Limite : pub/sub seulement.** L'enveloppe binaire ne porte **aucun id de corrélation** — `request()` (§3, accusés de réception) reste **toujours** en JSON, même vers un type schématisé. En `ws.codec: 'binary'` **strict** (serveur), ceci a une conséquence à connaître : le serveur rejette *toute* trame texte applicative hors `µ:`, id ou pas — une `request()` vers un type sans schéma y expire donc systématiquement (jamais de `µ:ack`), le `µ:error` retourné l'explique.

---

## 8. Options du socket — `µsocket(url, opts)`

| Option | Défaut | Rôle |
|---|---|---|
| `auth` | — | Fonction (sync/async) ou valeur → jeton envoyé dans `µ:hello`. Tant qu'une fonction async n'a pas rendu son jeton, rien d'autre ne part : un salon, un flux ou une présence demandés entre-temps partent au `µ:welcome`. Ex. `auth: -> { token: $$session.token }` (fonction) ou `auth: { token: '…' }` (valeur directe). |
| `protocols` | — | Sous-protocoles WebSocket. |
| `parse` / `serialize` | `JSON.parse` / `JSON.stringify` | (Dé)sérialisation personnalisée (binaire, MessagePack…). |
| `heartbeat` | `15000` ms | Intervalle des `µ:ping`. `0` = désactivé. |
| `timeout` | `5000` ms | Timeout **par défaut** des requêtes. |
| `reconnect` | `{ enabled: true, retries: ∞, backoff: [500,1000,2000,5000], jitter: 0.3 }` | Politique de reconnexion (backoff exponentiel + gigue). |
| `queueOffline` | `true` | Bufferise les `send` émis hors-ligne, rejoués au `µ:welcome`. |
| `maxQueue` | `1000` | Taille max de la file hors-ligne (les plus vieux sont jetés). |
| `coalesceMs` | `50` ms | Intervalle par défaut du `coalesce` (quand on passe `true`). |
| `debounceMs` | `200` ms | Silence par défaut du `debounce` (quand on passe `true`). |

**Une seule connexion par adresse.** Un second `µsocket` à une adresse déjà ouverte rend la connexion existante. Deux identités `auth` sont comparées par leur contenu : objets et tableaux clé par clé, dates, `Map`, `Set`, expressions régulières, erreurs, primitives encapsulées, `URL`, tampons binaires et tableaux typés par leur valeur (les clés d'une `Map` et les éléments d'un `Set` le sont par référence) ; deux `WeakMap` ou `WeakSet`, et deux fonctions, ne sont égaux que s'il s'agit du même objet ; en cas de doute (cycle, getter qui lève), vous êtes averti une fois et la connexion garde sa première identité.

`sock.refresh(a)` renvoie le jeton **même** contrat que l'option `auth` ci-dessus (valeur ou fonction, sync/async) — mais re-vérifie l'authentification EN **vol**, sans rouvrir la connexion. Utile face à un serveur `mjsWs` qui suit l'expiration du jeton (cf. [23 · MJS-WS § Expiration et rafraîchissement du jeton](23-mjs-ws.md)) : rafraîchir un peu avant l'échéance connue évite la fermeture. Renvoie une Promise (patron `request`, résolue/rejetée via `µ:ack`) — `'refresh'` n'est **pas** un nom d'événement réservé côté `on()`, seule la méthode existe.

```civet
try
  await @sock.refresh -> { token: $$session.token }   # nouveau jeton — même contrat que `auth`
catch e
  µ.error 'jeton refusé au rafraîchissement :', e   # connexion INCHANGÉE, vivante jusqu'à son échéance courante
```

---

## 9. Pièges

- **`open` ≠ WS ouvert.** L'état ne passe `open` qu'au `µ:welcome`. Un serveur qui n'envoie jamais `µ:welcome` laisse le client bloqué en `connecting` (les `send` sont mis en file, pas envoyés).
- **`seq` doit être contigu et strictement croissant** par flux. Un `seq` qui recule ou se répète est ignoré ; un trou déclenche un `µ:resync`. Utilisez **un compteur par flux**, pas un timestamp.
- **`close()` vs `destroy()`.** `close()` ferme mais garde le singleton (réutilisable via `connect()`). `destroy()` décrémente le ref-count et ne démonte qu'au **dernier** détenteur. Fermer le socket annule les envois `debounce`/`coalesce` en attente et vide la file hors-ligne (`queueOffline`) : rien ne repart au `connect()` suivant, pas même sous une autre identité (un `auth` qui suit l'utilisateur connecté).
- **Salon refusé.** Le serveur nomme le salon qu'il refuse (`µ:error { message, code: 'join-denied', room }`, dans `lastError`) : ce salon seul est oublié, plus rejoint aux reconnexions (`sock.room(nom)` retente). Une autre erreur — un message de chat refusé, un débit dépassé — ne fait oublier aucun salon.
- **Flux refusé.** Le serveur nomme le flux qu'il refuse (`µ:error { message, code: 'stream-denied', stream }`, dans `lastError`), quelle qu'en soit la cause : garde `canSubscribe` qui dit non, garde qui n'a pas répondu dans son délai (`guardTimeout`, 5 s par défaut, cf. [23 · MJS-WS §5](23-mjs-ws.md#flux)), flux réservé à un salon, flux fermé. Ce flux seul est oublié : plus redemandé aux reconnexions, aucun nouvel essai de lui-même. `sock.stream(nom)` le redemande, avec un magasin neuf ; l'ancien garde son dernier état. Un abonné qui perd son flux (garde posée ou resserrée après coup, trop lente) reçoit le même refus. Une autre erreur ne fait oublier aucun flux.
- **Connexion abandonnée = arrêt définitif.** Après un `close()` volontaire, un refus explicite du serveur (`µ:denied`), un adieu du serveur (`µ:bye`), une session exclusive perdue (fermeture `4003` remplacé, `4004` refusé), une adresse invalide (le constructeur `WebSocket` lève), une fois les `retries` épuisés, ou avec `reconnect.enabled: false`, aucune réouverture implicite : `send()`/`on()`/`request()`/`stream()` ne rouvrent pas de connexion (un `send()` pendant l'abandon est écarté, avec un seul `µ.warn` par socket ; `on()`/`stream()` s'enregistrent quand même, sans rien ouvrir). Seul un `connect()` explicite reprend la main, avec un compteur d'essais neuf — un message mis dans la file hors-ligne (`queueOffline`) **avant** que les essais ne s'épuisent (ou avec `reconnect.enabled: false`) y reste : il repart au `µ:welcome` de cette reconnexion explicite, comme n'importe quel autre message mis en file. Après un `close()`, un refus (`µ:denied`), un adieu (`µ:bye`) ou une session exclusive perdue (`4003`, `4004`), la file est **vidée** et les envois différés (`debounce`, `coalesce`) encore en attente sont annulés : ils appartiennent à l'identité qui les a écrits, rien d'eux ne part au `connect()` suivant, peut-être sous une autre identité (au refus, un avertissement dans la console le dit). Un `close()` de l'appli gagne toujours : le runtime lui-même (élévation d'un compte, retour en invité après un refus, cf. [27 · Comptes](27-accounts.md)) ne rouvre jamais une connexion qu'elle a fermée.
- **Sans `owner` ni `off()`, fuite.** Le socket est un singleton référence-compté PARTAGÉ entre plusieurs composants : `on(type, handler)` renvoie une fonction de dé-abonnement, mais rien ne la relie au cycle de vie de l'appelant sauf à passer `{ owner: @ }` (même mécanisme que `owner` de `µsmooth`). Un composant qui ne rappelle jamais cette fonction (ni `sock.off(type, handler)`, ni `owner`) laisse le handler — et les closures qu'il capture — enregistré à vie sur le socket. Forme recommandée : `@sock.on 'chat', ((p)-> …), { owner: @ }` — sinon, à la main : `@off = @sock.on 'chat', (p)-> …` dans le `<script>`, puis `µdestroy -> @off()`.
- **Discussion et hall : rattachés au composant qui s'exécute au moment de l'appel.** `sock.chat()` et `sock.lobby()` appelés pendant qu'un composant s'exécute (son code d'initialisation, son `µmount`, un de ses effets) sont rattachés à ce composant, y compris par une fonction d'un magasin ou d'un module appelée depuis là ; hors de tout composant (chargement d'un module, initialisation de l'appli, gestionnaire d'événement), à rien. À la destruction du composant, la discussion et le hall se ferment (cf. [26](26-chat.md), [28](28-lobby.md)).
- **Une partie ouverte dans un composant n'est pas quittée quand il disparaît.** `sock.game()` n'est rattaché à aucun composant : la partie vit jusqu'à `leave()` ou sa fin, et le composant qui revient dans la page retrouve la même. Appelez `leave()` pour la quitter, par exemple dans `µdestroy` (cf. [24](24-mjs-server.md)).
- **SVG dans `{for}`** (ex. `<circle>`) : rendu correctement (namespace SVG géré par `µ._mjs_cloneTpl`). Voir [18 · Pièges](18-pieges.md).
- **`µ.optimistic` redevient la seule source de vérité tant qu'un appel est en vol** sur un store donné : une mutation extérieure posée sur **ce même** store pendant la fenêtre (autre code, un autre flux réseau) est écrasée au rejeu suivant. Dédiez un petit store à ce que `µ.optimistic` pilote. Entre deux appels (rien en vol), c'est le store qui fait foi : l'appel suivant repart de sa valeur du moment, écritures extérieures comprises.
