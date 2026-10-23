# 24 · MJS-Server — la salle de partie (au-dessus de MJS-WS)

> **Module optionnel.** MJS-Server compose une couche « salle de partie » — appariement, sièges, tour par tour, vue par joueur — **par-dessus** [23 · MJS-WS](23-mjs-ws.md), sans le modifier. Tant que vous n'importez pas `modularjs-framework/mjs-server`, son coût est **nul** : zéro octet, zéro `Map`, zéro minuterie.

```civet
// serveur — dialecte Civet des composants (§12 doc 23)
import { mjsServer } from 'modularjs-framework/mjs-server'

app = mjsServer({ auth: (hello)-> { id: hello.auth?.id } })

app.game('morpion', {
  seats: 2
  state: (game)-> { grille: Array(9).fill(null) }
  moves: {
    jouer: (game, player, p)->
      game.state.grille[p.i] = player.id
      game.next()
  }
})

await app.listen()
```

Côté client, un simple `sock.game('morpion')` suffit — file d'attente, sièges, vue par joueur et reconnexion sont **déjà gérés** :

```civet
game = sock.game('morpion')
```
```html
{if game.state.status === 'playing'}
  {game.state.grille[0]}…
{end}
```

C'est tout ce qu'il faut pour une salle de partie tour par tour complète — appariement, sièges à expiration, tour par tour, vue filtrée par joueur, reconnexion avec rattrapage, et une persistance optionnelle. Les trames `µgame:*` qui transportent tout ça restent **invisibles** : ni l'appli serveur ni l'appli cliente n'y touchent directement.

---

## Sommaire

1. [Philosophie](#philosophie)
2. [Démarrer](#demarrer)
3. [Déclarer un jeu — `app.game(type, def)`](#declarer-un-jeu)
4. [Les coups](#les-coups)
5. [La vue par joueur](#la-vue)
6. [L'appariement](#appariement)
7. [Le client — `sock.game`](#le-client)
8. [La persistance](#persistance)
9. [Configuration](#configuration)
10. [Le mode action : tick et intentions](#mode-action)
11. [Les deltas](#deltas)
12. [Les zones d'intérêt](#zones-interet)
13. [Le réseau des jeux d'action (netcode)](#netcode)
14. [Limites v1 — honnêtement](#limites)
15. [Annexe — le protocole `µgame:*`](#protocole)

---

<a id="philosophie"></a>
## 1. Philosophie

[23 · MJS-WS](23-mjs-ws.md) parle un protocole `µ:` générique — handshake, pub/sub, requêtes, salons, flux. Suffisant pour à peu près tout, mais un **jeu à sièges** (2 joueurs qui s'affrontent, 4 qui coopèrent…) redemande à chaque fois la même mécanique : appariement, qui a la main, qui voit quoi, ce que devient la partie si quelqu'un part. MJS-Server fournit cette mécanique **une fois**, composée par-dessus MJS-WS — jamais par réimplémentation : `app.game()` pose ses propres handlers `µgame:*` sur la **même** app MJS-WS, avec l'API publique (`app.serve`, `app.on`, `app.send`, `app.stop`…) exactement telle que documentée en [23 · MJS-WS §2](23-mjs-ws.md#app-api).

Deux conséquences directes de cette composition :

- **Optionnel, coût nul si absent.** Ne pas importer `modularjs-framework/mjs-server` = zéro impact sur une app MJS-WS classique (chat, présence, flux…).
- **Magique pour l'appli.** L'appli hôte ne voit jamais une trame `µgame:*` — le préfixe est **réservé** (`app.serve('µgame:x', …)` ou `app.on('µgame:x', …)` lèvent une erreur claire) —, seulement `app.game(type, def)` côté serveur et `sock.game(type)` côté client. Toute la plomberie (file d'attente, sièges, diffusion groupée par microtâche…) reste interne.

Le socle de MJS-Server reste **tour par tour événementiel** — un coup, une réaction, une diffusion, cf. [§4](#les-coups). Pour un monde qui bouge en continu (une arène, un jeu d'esquive, un espace partagé…), le **mode action** (`def.tick > 0`) ajoute une boucle à fréquence fixe, des intentions et des deltas ([§10](#mode-action), [§11](#deltas)), plus une zone d'intérêt optionnelle ([§12](#zones-interet)). Dans les deux modes, MJS-Server reste un **assemblage** de mécaniques **réseau** (appariement, sièges, diffusion) — jamais un moteur physique : détection de collision, pathfinding, autorité anti-triche fine restent entièrement à votre charge dans `def.simulate`/`def.moves`.

---

<a id="demarrer"></a>
## 2. Démarrer

La commande déclarative `mjs serveur` (commande **sœur** de [`mjs ws`](23-mjs-ws.md#mjs-ws), même contrat) évite d'écrire vous-même le script qui construit l'app et l'écoute : elle charge un **fichier d'entry**, y branche `mjsServer()`, le rechargement à chaud et l'arrêt propre, puis démarre.

```bash
mjs serveur                        # serveur.server.mjs ou serveur.js (résolution complète : §2.2), port 4001 par défaut
mjs serveur --entry arene.server.mjs --port 4110
mjs serveur --root chemin/vers/le/projet
```

### 2.1 Le fichier d'entry

Un fichier serveur MJS-Server se pose **exactement** comme un fichier serveur MJS-WS ([23 · MJS-WS §6.1](23-mjs-ws.md#mjs-ws)) — même dialecte Civet (assignations nues auto-déclarées, `->`, hash sans virgules entre lignes, `"…#{x}…"`…), même contrat `export default { …options, setup(app) }` (port/host/onLog réservées au CLI, ignorées avec un avertissement), même compilation vers un fichier réel sous le cache et même grammaire `@import` pour importer un fichier du projet ([23 · MJS-WS §13](23-mjs-ws.md#civet-entry)). La seule différence : `setup(app)` reçoit une app construite par `mjsServer()` (qui expose `.game()`), pas `mjsWs()` :

```civet
// arene.server.mjs — dialecte Civet des composants (§12 doc 23)
export default {
  auth: (hello)-> { id: hello.auth?.id, pseudo: hello.auth?.pseudo }

  setup: (app)->
    app.game 'morpion', {
      seats: 2
      state: (game)-> { grille: Array(9).fill(null) }
      moves: {
        jouer: (game, player, p)->
          throw new Error('case occupée') if game.state.grille[p.i]?
          game.state.grille[p.i] = player.id
          game.next()
      }
    }
}
```

Les accolades explicites du hash **racine** sont nécessaires ici : deux clés fratries (`auth`, `setup`) dont une à corps multi-lignes, sans elles, compilent en un objet **appelé** comme une fonction (« `{(intermediate value)} is not a function` » au chargement) plutôt qu'en un seul objet — même piège que l'exemple `.server.mjs` de [23 · MJS-WS §6.1](23-mjs-ws.md#mjs-ws).

Si le default export est absent ou n'est pas un objet, `mjs serveur` refuse de démarrer avec une erreur claire. Si **aucun** fichier d'entry n'est trouvé, l'erreur imprime directement un squelette minimal à copier-coller.

### 2.2 Résolution de l'entry

| Source | Priorité |
|---|---|
| `--entry <chemin>` | 1 — toujours respecté tel quel ; erreur immédiate si le fichier n'existe pas |
| `serveur.entry` (mjs.config.json) | 2 — même règle : erreur immédiate si absent |
| `serveur.server.mjs` (racine du projet) | 3 — format **recommandé** |
| `server/serveur.server.mjs` | 4 |
| `serveur.js` (racine du projet) | 5 |
| `serveur.civet` (racine du projet) | 6 |
| `server/serveur.js` | 7 |
| `server/serveur.civet` | 8 |

Ces défauts ne recoupent **jamais** ceux de `mjs ws` (`ws.server.mjs`/`ws.js`/…) — les deux commandes coexistent sans collision dans un même projet (ex. un chat MJS-WS sur un port, une salle de jeu MJS-Server sur un autre).

### 2.3 Configuration — section `serveur` de mjs.config.json

**Mêmes** clés que `ws` ([23 · MJS-WS §6.3](23-mjs-ws.md#mjs-ws)) — `mjsServer()` accepte **exactement** les mêmes options que `mjsWs()` — plus `antiCheat` ([§9](#configuration)) :

```json
{
  "serveur": {
    "entry": "server/arene.server.mjs",
    "port": 4110,
    "antiCheat": { "movesPerIdentity": [40, 1000], "codePerIp": [10, 60000] }
  }
}
```

Port : priorité `--port` > `serveur.port` > `4001` (**distinct** du `4000` de `mjs ws`). Hôte d'écoute : `127.0.0.1` par défaut, `--host ::` pour exposer sur toutes les interfaces. Chaque clé partagée avec `ws` (transport/codec/heartbeat/limits/token/bridge/resume/adapter/stats/sessionExclusive/verifyOrigin/ban), ainsi qu'`antiCheat`, est définissable **ici** **ou** dans l'entry — en cas de doublon, l'**entry prime EN bloc**, avec un avertissement (**même** règle que §6.4 doc 23). `persist` ([§8](#persistance)) reste **entry-only** : ses adaptateurs exposent des fonctions (`load`/`save`/`remove`), non représentables en JSON.

Rechargement à chaud et arrêt propre : **même** comportement que `mjs ws` ([23 · MJS-WS §6.5-§6.6](23-mjs-ws.md#mjs-ws)).

### 2.4 Lancement programmatique

Le fichier d'entry ci-dessus reste un module ordinaire — rien n'empêche de construire et d'écouter l'app vous-même, sans passer par `mjs serveur` (utile en dehors du CLI, ou pour composer avec un serveur HTTP existant) :

```civet
import { mjsServer } from 'modularjs-framework/mjs-server'

app = mjsServer({ auth: (hello)-> { id: hello.auth?.id } })
app.game('morpion', { seats: 2, state: (game)-> { grille: Array(9).fill(null) }, moves: { … } })
await app.listen()
```

---

<a id="declarer-un-jeu"></a>
## 3. Déclarer un jeu — `app.game(type, def)`

`app.game(type, def)` déclare un type de partie — throw immédiat si `type` est déjà déclaré, ou si `def` contient une clé inconnue ou mal typée (même validation stricte que `mjs.config.json` : suggestion orthographique incluse). Voici le morpion fil rouge de cette page, **champ par champ** :

```civet
app.game('morpion', {
  seats:   2                         # sièges requis pour démarrer — entier ≥ 1
  code:     true                      # autorise les parties privées par code court (§6)
  seatTtl:  15000                     # fenêtre de confirmation des sièges issus de la file (§6), défaut 10000
  emptyTtl: 60000                     # partie COMMENCÉE sans plus aucun siège connecté → détruite après ce délai, défaut 60000 (§6)
  endTtl:   30000                     # partie FINIE (game.end) → détruite après ce délai, défaut = emptyTtl (§6)

  state: (game)-> { grille: Array(9).fill(null), lettres: {}, secrets: {} }

  moves: {
    jouer: (game, player, p)->     # cf. §4
      throw new Error('case occupée') if game.state.grille[p.i]?
      game.state.grille[p.i] = game.state.lettres[player.id]
      game.next()
  }

  view: (game, player)-> game.state   # vue filtrée par joueur — défaut montré ici, cf. §5 pour l'exemple qui masque un champ

  phases: {
    attente: ['pret']
    jeu:     ['jouer']
    fin:     []
  }

  turns: {
    order:   'roundrobin'             # ou une fonction (game)-> player|id|null
    timeout: 30000                    # ms — minuterie 'µturn' réarmée à chaque game.next()
  }

  timers: {
    rappel: (game)-> game.send('rappel', { pour: game.turn })   # minuterie NOMMÉE — cf. §4
  }

  limits: {
    moves: [10, 10000]                # seau à jetons PAR SIÈGE — 10 coups / 10 s max
  }

  hooks: {
    onCreate:      (game)-> µ.log('partie créée', game.id)
    onJoin:        (game, player)-> µ.log('siège', player.seat, 'occupé')
    onLeave:       (game, player)-> µ.log('siège', player.seat, 'libéré')
    onEnd:         (game, result)-> µ.log('partie finie', result)
    onTurnTimeout: (game)-> game.next()   # défaut si non fourni (cf. §4)
  }
})
```

| Champ | Type | Défaut | Rôle |
|---|---|---|---|
| `seats` | entier ≥ 1 | — (requis) | sièges requis pour démarrer la partie |
| `code` | booléen | `false` | autorise les parties privées par code court (§6) |
| `seatTtl` | nombre > 0 (ms) | `10000` | fenêtre de confirmation des sièges issus de la **file** (§6) |
| `tick` | nombre ≥ 0 | `0` | `0` = tour par tour événementiel (§4) ; de `1` à `60` = mode **action**, boucle à tick (§10) |
| `state` | `(game)-> état` | — (requis) | état initial, appelé une fois à la création |
| `moves` | `{ nom: (game, player, p)-> résultat }` | — (requis) | les coups déclarés (§4) |
| `view` | `(game, player)-> view` | état entier, non filtré | vue par joueur (§5) |
| `phases` | `{ phase: [moves permis] }` | aucune restriction | coups autorisés par phase (§4) |
| `turns` | `{ order?, timeout? }` | pas de tour suivi | ordre + minuterie de tour (§4) |
| `timers` | `{ nom: (game)-> void }` | `{}` | minuteries **nommées** (§4) |
| `limits` | `{ moves?: [n, fenêtreMs], moveWaitMs?: ms }` | `[30, 1000]` (30 coups/s), `moveWaitMs` : `10000` | anti-abus par siège (réutilise le seau à jetons de MJS-WS) — mettre `null` pour un jeu action haute fréquence ; `n` entier ≥ 1 et `fenêtreMs` nombre fini > 0, sinon refus à la déclaration (un nombre seul, une fenêtre `NaN` — variable d'environnement absente — ou `Infinity` ne désactivent ni ne figent jamais le quota en silence) ; `moveWaitMs` : délai de garde d'un coup asynchrone qui ne se règle pas — passé ce délai, sa requête reçoit une erreur et les coups suivants du joueur sont refusés jusqu'à sa fin ([§4](#les-coups)) —, un nombre > 0 et au plus 2 147 483 647 (environ 24,8 jours, le plus long délai d'une minuterie Node), sinon refus à la déclaration |
| `emptyTtl` | nombre > 0 (ms) | `60000` | grâce avant destruction d'une partie **commencée** sans plus aucun siège connecté, le temps que ses joueurs reviennent ; une table jamais complète, ou dont plus aucun siège n'est occupé, est fermée dès le départ de son dernier joueur (§6) |
| `endTtl` | nombre > 0 (ms) | = `emptyTtl` | grâce avant destruction d'une partie **finie** (`game.end()`), qu'il reste des sièges connectés ou non — `emptyTtl` ne règle plus que la vie d'une partie vide non finie (§6) |
| `hooks` | `{ onCreate?, onJoin?, onLeave?, onEnd?, onTurnTimeout? }` | `{}` | points d'extension (§4) |

> 🔤 **Vocabulaire.** `game` est l'instance vivante (état, sièges, phase, tour…) ; `player` est un **siège** (`{ seat, id, connected }` — `id` = identité stable, cf. [§7](#le-client) sur la reconnexion) ; `p` est la charge libre envoyée par le client avec son coup.

> ⏱ **Durées.** `emptyTtl`, `endTtl`, `seatTtl`, `turns.timeout` et le délai de `game.timer()` sont en millisecondes : tout nombre fini > 0 est accepté, y compris au-delà de 24,8 jours (2³¹−1 ms, le plafond d'un `setTimeout` Node) — MJS-Server attend alors par tranches jusqu'à l'échéance, la minuterie ne part jamais avant. `Infinity` est refusé à la déclaration (`emptyTtl`, `endTtl`, `seatTtl`, `turns.timeout`), comme `NaN` et toute valeur qui n'est pas un nombre fini > 0 : l'erreur nomme l'option et dit la valeur reçue telle quelle (`game('morpion').endTtl doit être un nombre > 0 (ms), reçu : Infinity`) ; `game.timer(nom, Infinity)`, qui n'est pas validé, arme une attente sans fin — la sauvegarde (§8) la garde sous la forme d'une échéance finie, très lointaine. `limits.moveWaitMs` fait exception : au-delà de 2 147 483 647 ms, il est refusé à la déclaration (une minuterie Node plus longue partirait au bout d'1 ms et la garde des coups tomberait).

---

<a id="les-coups"></a>
## 4. Les coups

Un coup arrive par `µgame:move { game, move, p? }` (§15) — mais l'appli ne voit jamais cette trame, seulement l'appel à `def.moves[move](game, player, p)`. Avant cet appel, MJS-Server vérifie dans l'ordre :

1. **Assis ?** — la connexion doit occuper un siège de **cette** partie, sinon `"vous n'êtes pas assis dans cette partie"`.
2. **Phase ?** — si `def.phases` est déclaré, le coup doit figurer dans la liste de la phase courante, sinon `"coup '<x>' interdit en phase '<phase>'"`.
3. **Tour ?** — si `def.turns` est déclaré ET qu'un tour a déjà été établi (`game.turn !== null` — donc jamais bloquant **avant** le premier `.next()`, par exemple pendant une phase d'attente), le siège doit être celui dont c'est le tour, sinon `"ce n'est pas votre tour"`.
4. **Débit ?** — si `def.limits.moves` est déclaré, le seau à jetons DE CE **siège** doit avoir un jeton, sinon `"trop de coups, ralentissez"`.

Seulement alors `def.moves[move](game, player, p)` s'exécute. **Un `throw`** — dans une de ces 4 gardes internes OU dans le move lui-même — devient un refus : la `Promise` de `game.move(...)` côté client est **rejetée** avec le message, comme un `app.serve()` MJS-WS ordinaire qui lève ([23 · MJS-WS §1](23-mjs-ws.md#options)) — en production aussi pour une `Error` nue, qui est ici la réponse du joueur ; une exception interne (`TypeError`…) n'y donne que « erreur interne du serveur ». Aucun état n'est jamais modifié par un coup refusé.

Un coup **accepté** est journalisé (`{ move, player, at }`, borné à 200 entrées — usage interne, jamais diffusé aux clients ; la charge du coup n'est gardée ni dans ce journal ni dans la sauvegarde §8) puis déclenche une diffusion groupée : toute mutation de `game.state` (ou `.to()`/`.next()`) faite dans le même move est regroupée en **une seule** trame `µgame:state` par joueur, envoyée à la microtâche suivante — jamais une par ligne de code.

**Un coup asynchrone** (votre move rend une `Promise` : un appel à une base de données avant d'appliquer le coup, par exemple) est attendu : la requête du client reçoit sa valeur une fois la `Promise` réglée, ou l'erreur de son rejet. L'état part une première fois tout de suite, puis de nouveau à la fin du coup, qu'il aboutisse **ou** qu'il rejette : ce que le coup a changé avant de rejeter n'est pas défait, et les joueurs voient l'état réel du serveur (il est aussi sauvegardé). Les coups d'un **même joueur** passent un par un, même depuis deux onglets : tant que son coup asynchrone n'est pas réglé, le suivant attend sa fin, puis passe toutes les gardes ci-dessus comme s'il venait d'arriver — un joueur ne joue donc jamais deux fois dans son tour. Les coups des autres joueurs n'attendent pas. Un coup **trop lent**, ou qui ne se règle **jamais** (un appel externe sans délai qui pend, un bogue), ne bloque pas l'onglet du joueur : passé `limits.moveWaitMs` depuis son départ (10 s par défaut, un nombre > 0 en millisecondes, au plus 2 147 483 647), sa requête reçoit une erreur (`"votre coup 'x' est resté sans réponse pendant 10000 ms (limits.moveWaitMs) : il continue sur le serveur, et vos coups suivants sont refusés jusqu'à sa fin"`), et l'onglet peut de nouveau resynchroniser, quitter la partie ou discuter ; le serveur journalise un avertissement. Le coup continue : s'il finit par se régler, il s'applique et l'état est rediffusé comme d'habitude (sa valeur ne parvient plus au client, qui a déjà reçu l'erreur). Jusque-là, tout nouveau coup du même joueur, du même onglet comme d'une autre connexion, est refusé (`"votre coup précédent est encore en cours"`), celui qui attendait déjà derrière compris : deux coups du même joueur ne se chevauchent jamais. Un coup qui ne se règle jamais refuse donc les coups de ce joueur jusqu'à la fin de la partie : bornez vos appels externes à un délai plus court que `moveWaitMs`.

### Tour par tour — `turns` + `.next()`

`game.next()` fait tourner `game.turn` : `turns.order === 'roundrobin'` (défaut) prend le siège occupé suivant dans l'ordre des places (connecté ou non — v1 ne saute **jamais** un absent automatiquement, cf. [§14](#limites)) — quand le joueur qui a la main quitte la partie (départ, entrée refusée après coup), le tour passe au siège occupé qui suit le sien, en bouclant, jamais au premier ; une fonction `(game)-> player|id|null` calcule le tour vous-même. `.next()` sans `def.turns` déclaré ne fait rien. Chaque appel réarme aussi la minuterie de tour (`turns.timeout`, réservée en interne sous le nom `'µturn'`) : à l'échéance, `hooks.onTurnTimeout(game)` s'exécute si fourni (ce qu'il change dans `game.state` est diffusé et sauvegardé comme après un coup), sinon MJS-Server appelle `.next()` lui-même (le tour passe simplement au suivant). Sans `turns.timeout` déclaré, aucune minuterie n'est armée : un siège qui ne joue jamais son tour bloque la partie pour tous, sans filet automatique.

### Minuteries **nommées** — `timers` + `.timer()`

Au-delà du tour, `def.timers` déclare des échéances arbitraires — `game.timer('rappel', 5000)` arme (ou réarme) une minuterie nommée `'rappel'` ; à l'échéance, `def.timers.rappel(game)` s'exécute, et ce qu'elle change dans `game.state` est diffusé et sauvegardé comme après un coup (si elle rend une `Promise`, une seconde fois quand celle-ci se termine). Sérialisables par construction (`{ name, at }`, jamais une fermeture stockée — cf. §8) : elles survivent à une restauration depuis la persistance. **La fin de la partie les coupe toutes** (`game.end()`, voir « Finir » ci-dessous) : une minuterie armée après la fin — depuis `hooks.onEnd`, par exemple — n'est pas armée non plus, sans que `game.timer()` ne lève. Trois noms sont **réservés** à MJS-Server (`'µturn'`, `'µmatch'`, `'µempty'`) — les utiliser dans `def.timers` ou en argument de `.timer()` lève une erreur claire, avant comme après la fin. Un nom que `def.timers` ne déclare pas lève aussi, tout de suite (`game.timer('rapel', …) : minuterie non déclarée — déclarez-la dans timers (minuteries déclarées : rappel)`) : seuls les noms propres de `def.timers` comptent, un nom hérité comme `'toString'` n'en est pas un. Une minuterie restaurée d'une sauvegarde sous un nom que votre définition ne déclare plus ne lance rien à son échéance.

### `game.to(phase)`

Change `game.phase` — validé contre `def.phases` SI déclaré (phase inconnue → erreur), libre sinon. `.end()` n'impose **aucune** phase de fin : pour fermer les coups après la victoire, déclarez votre propre phase (`fin: []` dans l'exemple du §3) et atteignez-la vous-même via `.to('fin')`.

### Finir — `game.end(result)`

Diffuse `µgame:end { result }` à tous les sièges connectés, appelle `hooks.onEnd?.(game, result)`, puis arme la destruction après `def.endTtl` (`def.emptyTtl` si vous ne déclarez pas `endTtl`, [§6](#appariement)) — la partie reste interrogeable, un dernier `µgame:resync` fonctionne encore, le temps que les clients encaissent la fin. La fin coupe aussi toutes vos minuteries nommées (`game.timer()`), la minuterie de tour et la fenêtre `seatTtl` de la file : seule la destruction reste armée, aucune autre minuterie ne tire plus sur une partie finie. Une minuterie que vous armeriez ensuite, depuis `hooks.onEnd` par exemple, ne part pas.

### Refuser un joueur — `hooks.onJoin`

`hooks.onJoin(game, player)` s'exécute quand un nouveau joueur prend un siège (file, code, ou création de la partie par code). Le siège est déjà posé — `game.players` et `player.seat` se lisent — mais le roster n'a pas encore été diffusé. **Un `throw` dans `onJoin` refuse le joueur** : son siège est libéré, l'erreur remonte telle quelle à sa requête `µgame:play` (côté client : statut `'error'` et événement `'error'`, §7), et il ne reçoit plus rien de la partie — ni diffusion, ni `µgame:resync`, ni coup. Les autres joueurs ne reçoivent aucun roster le concernant, et le siège reste libre pour un invité légitime. Si le refusé est le créateur de la partie par code, la partie, vide et jamais complète, est fermée tout de suite (§6) : elle ne compte pas dans la borne de ses parties privées ; un refus sur une partie qui attend déjà le retour de ses joueurs (grâce `emptyTtl` en cours) ne repousse pas cette échéance.

Ce que `onJoin` a fait **avant** de lever — `game.state` modifié, `game.send()`, une phase changée… — n'est **pas** défait : vérifiez d'abord, modifiez ensuite. Vider soi-même le siège avant de lever (`game.players[player.seat] = null`) reste accepté et donne le même résultat. En **file publique**, un refus défait l'appariement du groupe sans que les autres joueurs voient rien : voir [§6](#appariement). Un `onJoin` qui rend une `Promise` rejetée refuse aussi le joueur (en partie privée, avant ou après sa réponse selon ce que le rejet a fait attendre), voir « Quand un crochet lève » ci-dessous.

### Quand un crochet lève

Une erreur levée par le code que vous fournissez à `app.game`, ou par l'option `onDisconnect` de l'application, ne fait pas tomber le serveur : elle est renvoyée à celui qui attend la réponse, ou journalisée quand personne n'attend. Quand l'appel répond à la requête d'un joueur (un coup, `onJoin`, `suspect`, `onSuspicion`…), l'erreur devient la réponse d'erreur de cette requête, comme ci-dessus. Pour les appels qui se font sans requête — minuteries, boucle de tick, diffusions — voici ce qui arrive :

| Votre code | Appelé pendant | Quand il lève |
|---|---|---|
| `timers.<nom>`, `hooks.onTurnTimeout` | une minuterie | journalisé, la partie continue ; ce que votre code a changé avant de lever est diffusé et sauvegardé comme après un coup ; une `Promise` rendue est attendue — son rejet est journalisé, et la partie est de nouveau diffusée à sa fin |
| `turns.order` (fonction) | `game.next()` | dans un coup, le coup est refusé ; au départ du joueur dont c'est le tour, comme `onLeave` ; quand `turns.timeout` expire sans `onTurnTimeout`, journalisé comme une minuterie |
| `simulate`, `intents.<nom>`, `slowTick.fn` | la boucle de tick ([§10](#mode-action)) | journalisé, la boucle continue au tick suivant |
| `view`, `spectatorView` | chaque diffusion | journalisé ; la trame du siège concerné (ou celle des spectateurs) est ignorée pour cette diffusion, les autres sièges reçoivent la leur |
| `history.extract` | chaque tick ([§13](#netcode)) | journalisé ; l'instantané de ce tick n'est pas gardé |
| `onEnd` | `game.end(result)` | l'erreur remonte à l'appelant de `game.end()` ; la destruction après `endTtl` est armée quand même ; une `Promise` rejetée est journalisée, la fin de partie a eu lieu |
| `onLeave` | `µgame:leave` d'un siège | l'erreur remonte à celui qui part ; le départ va quand même à son terme (ci-dessous) ; une `Promise` rejetée est journalisée |
| `onJoin` rendant une `Promise` | l'arrivée d'un joueur | un rejet est journalisé et le joueur est refusé : avant sa réponse si le rejet n'attend rien du dehors, après elle sinon (ci-dessous) |
| `onCreate` | la création d'une partie | l'erreur remonte à la requête qui crée la partie : elle est refusée et aucune partie n'est créée (en file publique, les autres joueurs du groupe reviennent en tête de la file, [§6](#appariement)) ; une `Promise` rejetée est journalisée, la partie est créée quand même |
| `onDisconnect` (option de l'application) | la fermeture définitive d'une connexion | journalisé, la purge de la connexion va à son terme ; une `Promise` rejetée est journalisée |

« Journalisé » désigne le journal du serveur (option `onLog`, la console par défaut), au niveau `error` : un `onLog` qui lève est ignoré, il ne fait pas tomber le serveur non plus. Chaque message nomme le crochet fautif (`hooks.onLeave`, `turns.order`, `def.spectatorView`…) et dit ce qui s'est passé ensuite ; `timer('<nom>')` ne désigne que vos minuteries `timers.<nom>`.

**Un `onJoin` qui rend une `Promise` refuse le joueur dès que le rejet est connu.** `onJoin` est synchrone : MJS-Server n'attend pas la `Promise` (sauf en file publique, [§6](#appariement)), mais il laisse passer un tour de la boucle d'événements avant de répondre à la requête du joueur. Un rejet qui n'attend rien du dehors (une fonction `async` qui lève sans `await`, `Promise.reject(…)`, quelques `await` de valeurs déjà prêtes) est connu avant cette réponse : c'est un refus synchrone. La requête `µgame:play` échoue avec `"votre entrée dans la partie a été refusée"` (le message de la `Promise` rejetée reste dans le journal du serveur), le siège est libéré sans que personne ne voie rien — ni roster, ni `µgame:left`, ni `µgame:start` pour l'hôte — et aucune fin de partie n'est envoyée : côté client, la poignée passe en statut `'error'`, comme pour un `throw`. Un rejet qui vient après une attente (une minuterie, une base de données, un appel réseau) est connu après la réponse : la requête du joueur a reçu sa réponse de siège — sa vue comprise —, puis le rejet est journalisé et le joueur est refusé comme s'il partait, sans appeler `onLeave` : son siège est libéré, les autres sièges et les spectateurs reçoivent `µgame:left`, le tour passe au siège suivant s'il avait la main (l'autre joueur n'attend pas l'échéance de `turns.timeout`), puis le roster mis à jour part, l'état est diffusé et sauvegardé, et une partie qui n'a plus aucun siège connecté est fermée tout de suite si elle n'a jamais été complète, détruite après `emptyTtl` sinon (§6). Le refusé, lui, reçoit une fin de partie « entrée refusée » : `µgame:end { result: { refused: true, reason: 'join-refused' } }` (même forme que l'annulation `{ cancelled: true, reason: 'seat-expired' }` : un drapeau et une raison ; côté client, sa poignée passe en statut `'finished'` avec ce `result`). Cette fin part après la réponse de sa requête, jamais avant, et ne part qu'à lui — ni aux autres sièges, ni aux spectateurs, pour qui la partie continue — puis il ne reçoit plus aucune trame de la partie, son prochain coup est refusé (`"vous n'êtes pas assis dans cette partie"`) et son `µgame:resync` aussi (`"vous n'êtes pas dans cette partie"`). Une `Promise` qui ne se règle jamais ne retient pas la requête : elle reçoit sa réponse après ce tour de boucle et le joueur reste assis. Ce que `onJoin` a fait avant de rejeter n'est pas défait. Pour refuser un joueur avant qu'il ne voie quoi que ce soit, levez une erreur synchrone dans `onJoin`, comme ci-dessus : son erreur est alors la réponse de sa requête, sans fin de partie.

**Un départ va toujours à son terme.** Au `µgame:leave`, le siège est vidé avant que votre code ne tourne. Que `onLeave` lève, ou `turns.order` quand c'était le tour de celui qui part, le départ continue : les autres sièges et les spectateurs reçoivent `µgame:left`, le roster suit, l'état est diffusé et sauvegardé comme après un coup, et une partie qui n'a plus aucun siège connecté est fermée tout de suite — jamais complète, ou plus aucun siège occupé — ou détruite après `emptyTtl` ([§6](#appariement)). Ce que votre code a changé avant de lever n'est **pas** défait. Celui qui part reçoit l'erreur, avec son message, comme réponse d'erreur de sa requête `µgame:leave` ; il ne reçoit aucune trame de la partie, comme sans erreur. Si `onLeave` et `turns.order` lèvent tous les deux, il reçoit l'erreur de `onLeave` et l'autre est journalisée. Un `onLeave` asynchrone dont la `Promise` est rejetée n'a personne à qui remonter : le rejet est journalisé, et celui qui part a déjà reçu `{ ok: true }`.

Les autres façons de quitter ne laissent pas non plus de partie orpheline : la fermeture d'un socket n'appelle pas `onLeave` (le siège reste occupé ; la partie sans plus aucun siège connecté est détruite après `emptyTtl`, tout de suite si elle n'a jamais été complète), et l'annulation d'une partie de la file à l'échéance de `seatTtl` n'appelle aucun de vos crochets.

MJS-Server ne réarme pas la minuterie de tour à votre place. Si `onTurnTimeout`, ou `turns.order` au passage de tour automatique, lève avant que `game.next()` ait abouti, le tour reste au même siège et aucune nouvelle échéance n'est armée : appelez `game.next()` d'abord, ou rattrapez l'erreur vous-même. Même règle au départ d'un joueur : si `turns.order` lève quand c'était son tour, `game.turn` reste sur le siège qui vient de se libérer et personne ne joue plus tant qu'un `game.next()` n'a pas abouti — appelez-le d'abord, dans `onLeave`, ou rattrapez l'erreur vous-même. Même chose au refus après coup d'un joueur qui avait la main, l'erreur de `turns.order` étant alors journalisée.

---

<a id="la-vue"></a>
## 5. La vue par joueur

`def.view(game, player)` calcule ce qu'UN siège voit — appelée à chaque diffusion, par joueur, jamais un envoi brut de `game.state`. Sans `view` fourni, le défaut renvoie `game.state` **entier, non filtré** — tout le monde voit tout. Le morpion fil rouge masque un champ privé :

```civet
state: (game)-> { grille: Array(9).fill(null), lettres: {}, secrets: {} }

hooks: {
  onJoin: (game, player)->
    lettre = if game.players.filter(Boolean).length == 1 then 'X' else 'O'
    game.state.lettres[player.id] = lettre
    game.state.secrets[player.id] = "c'est toi qui commences" if lettre == 'X'
}

view: (game, player)->
  { secrets, ...pub } = game.state
  { ...pub, monSecret: player ? secrets[player.id] : null }
```

X et O voient tous les deux `grille`/`lettres` (publics), mais `monSecret` diffère : X voit son mot, O voit `null` — et le champ brut `secrets` (la carte **complète**, avec le secret de l'autre) ne quitte **jamais** le serveur, puisque `view()` ne renvoie que `pub` (déstructuré **sans** `secrets`) plus `monSecret`. C'est le patron général pour tout état « caché » (main de cartes, rôle secret…) : gardez-le dans une clé à part de `game.state`, et ne le faites jamais transiter tel quel par `view()`.

> 🔤 `player` reçu par `view()` peut être `null` : c'est le cas d'un **spectateur** (`µgame:play { spectator: true }`, par code de partie), qui n'occupe pas de siège. La vue sûre du spectateur passe par `def.spectatorView(game)` si défini, sinon `view(game, null)` — jamais l'état brut par défaut. Cf. la couche anti-triche (§ anti-triche).

---

<a id="appariement"></a>
## 6. L'appariement

`sock.game(type, opts?)` peut viser trois destinations, discriminées par la **forme** de `opts.code` — **jamais** par sa seule présence :

| `opts.code` | Destination | Exige |
|---|---|---|
| absent | file d'attente **publique** du type | — |
| `true` | crée une partie **privée** neuve, code généré | `def.code === true` |
| `"ABCDE"` (chaîne) | rejoint la partie privée à ce code | `def.code === true` — code inconnu → erreur |

### La file publique

Chaque type a sa propre file FIFO. Un ticket s'ajoute à chaque `µgame:play` sans code ; tant que `seats` n'est pas atteint, le client reçoit `{ queue: n }` (sa position) — pas encore assis. Dès que `seats` est atteint, une partie **naît complète** : tous les tickets prennent siège d'un coup, passent par `hooks.onJoin` (une `Promise` rendue est attendue), et seulement alors la partie est annoncée. Le siège de la connexion dont la requête a complété le groupe est confirmé immédiatement (c'est sa propre réponse) ; les autres sièges — déjà en file, prévenus par une poussée `µgame:start` — ont `seatTtl` pour se manifester (un coup ou un `µgame:resync` suffit à confirmer). **Personne ne se manifeste ? La partie entière est annulée** (pas de re-complétion partielle depuis la file) : `µgame:end { result: { cancelled: true, reason: 'seat-expired' } }` à qui restait connecté, partie détruite. Une partie déjà **finie** n'est jamais annulée : sa fin ferme la fenêtre (voir « La grâce d'une partie finie » plus bas). C'est le choix le plus simple des deux envisagés au départ — documenté ici, pas de configuration plus fine en v1.

**Quitter la file.** `partie.leave()` d'une poignée encore en file prévient le serveur (`µgame:leave { type }`) : son ticket part, le joueur suivant n'est pas apparié avec elle (une autre poignée du même type sur la même connexion garde le ticket). Si la partie se forme pendant ce départ, le client rend aussitôt le siège (`µgame:leave { game }`).

**Un joueur refusé par `onJoin` défait l'appariement, sans que les autres voient rien.** Tant que tous les joueurs du groupe n'ont pas passé `hooks.onJoin`, la partie est muette : personne ne reçoit ni `µgame:start`, ni roster, ni état, et la requête de celui qui a complété le groupe attend (autant que durent vos `onJoin` asynchrones). Si l'un d'eux est refusé — par un `throw` (les suivants ne sont alors même plus assis) ou par une `Promise` rejetée —, la partie est annulée sans rien envoyer aux autres joueurs (pas de `µgame:end` d'annulation, aucun de vos crochets) et ces autres joueurs retournent **en tête de la file**, dans leur ordre d'arrivée : ils n'ont rien vu, ils attendent un autre adversaire, et le prochain joueur qui arrive est apparié avec eux (un groupe complet se reforme aussi tout de suite si des joueurs étaient arrivés pendant l'attente). Le refusé quitte la file et en est averti une fois : `µgame:end { result: { refused: true, reason: 'join-refused' } }`. S'il est celui qui a complété le groupe (le dernier arrivé), sa requête `µgame:play` est encore en cours : c'est elle qui échoue à la place (statut `'error'` côté client), avec l'erreur levée par `onJoin` si le refus est synchrone, ou `"votre entrée dans la partie a été refusée"` s'il vient d'une `Promise` — le message d'une `Promise` rejetée reste dans le journal du serveur. Côté client, la poignée `sock.game()` du refusé qui attendait en file passe en statut `'finished'`, avec ce `result` (`state.result.refused`) et l'événement `'end'` : elle n'a jamais reçu de siège, donc `state.gameId` et `state.seat` restent `null`, et sa position `state.queue` est effacée. L'identifiant de partie que porte la trame n'est connu d'aucun joueur (la partie défaite n'a jamais été annoncée) : elle porte donc aussi `type`, le type de jeu, et `queue: true`, qui dit qu'elle vient de la file (`{ game, type, queue: true, result }`). Le client la rattache à la poignée la plus ancienne encore en file **pour ce type de jeu** ([§7](#le-client), « Plusieurs parties à la fois »), et jamais à une poignée en file quand le drapeau manque : le refus tardif d'une partie par code, déjà finie, ne lui prend pas sa place. Cette poignée ne compte plus parmi celles qui attendent : elle n'est pas rejouée à la reconnexion, et le prochain `µgame:start` de la connexion va à la poignée suivante, pas à elle. Un joueur dont la connexion se ferme pendant l'attente n'est ni assis ni remis en file, et défait le groupe de la même façon. Un `hooks.onCreate` qui lève remet aussi les joueurs en tête de la file (sauf celui dont la requête reçoit l'erreur).

**Un `onJoin` qui termine la partie** (`game.end()` pendant l'appariement, un solde insuffisant par exemple) ne la défait pas : la partie est annoncée (`µgame:start`, et réponse de siège de celui qui a complété le groupe), puis `µgame:end` part à tous ses joueurs juste après, une fois que leur client la connaît. Aucune fenêtre de confirmation `seatTtl` n'est ouverte pour une partie déjà finie. Même chose en partie privée : quand le `onJoin` du joueur qui entre par code (ou du créateur) termine la partie, il reçoit sa réponse de siège, puis son `µgame:end` juste après.

Une **même connexion n'est jamais en file que pour un SEUL type à la fois** : retenter `µgame:play` sans code pour un **autre** type retire d'abord son ticket du premier (choix conservateur — une connexion ne peut viser qu'une file, jamais deux en parallèle).

### Les parties privées — `code: true`

`def.code: true` autorise deux usages : `opts.code: true` crée une partie **neuve** avec un code court généré (5 caractères, alphabet sans `0`/`O`/`1`/`I` — ambiguïté typographique — porté par la réponse) ; `opts.code: "ABCDE"` rejoint cette partie. Le fondateur d'une partie par code est confirmé par SA **propre** requête (rien à surveiller via `seatTtl` tant qu'il reste connecté) — un fondateur qui repart sans jamais recevoir personne (départ, onglet fermé ou rechargé) voit sa table fermée tout de suite, son code oublié. Rejouer `µgame:play` avec le même code depuis la **même** connexion déjà assise est **idempotent** (renvoie le siège existant, ne throw pas). Le **type** demandé doit correspondre à celui de la partie visée par ce code — un code valide pour un AUTRE type rend la même erreur `code inconnu` (jamais de confirmation qu'un code existe pour un type différent).

**Une partie privée en attente à la fois, par connexion.** Créer une nouvelle partie (`opts.code: true`) ferme la précédente que la même connexion a créée tant que ses places n'ont jamais été toutes prises **et que cette connexion y siège encore**, quel que soit le type de jeu : ses sièges — le créateur, et les joueurs déjà entrés dans un jeu à trois places ou plus — reçoivent `µgame:end { result: { cancelled: true, reason: 'replaced' } }`, la partie est détruite et son code oublié (`code inconnu` ensuite). Une partie dont les places ont été prises une fois est une vraie partie : elle continue ; une table que son créateur a quittée aussi, des joueurs y attendent peut-être encore.

**Cinq parties privées en cours au plus, par créateur.** Un même créateur ne garde que 5 parties privées pas encore finies où il siège encore (connecté ou non), toutes confondues : complétées ou non, créées depuis une connexion ou plusieurs, quel que soit le type de jeu. Une partie qu'il a quittée ne compte plus, même si d'autres joueurs y restent ; une table vide qu'il quitte est fermée tout de suite. La demande suivante est refusée (`"limite de parties privées en cours atteinte (5) : attendez qu'une de vos parties se termine avant d'en créer une autre"`) ; la partie en attente que la nouvelle remplace ne compte pas, une partie finie (`game.end()`, pendant sa grâce `endTtl`) non plus. Le créateur est son identité ; un joueur anonyme est compté par **adresse IP** (par connexion quand le transport ne donne pas d'adresse) : des joueurs anonymes derrière une même adresse — un même NAT, ou un proxy sans `trustProxy` ([§9](#configuration)) — partagent la borne. Réglable par `antiCheat.privateGamesPerCreator` ([§9](#configuration)), `null` la retire. Une partie restaurée au redémarrage ([§8](#persistance)) ne compte pas : son créateur n'est pas sauvegardé. Sans ces deux bornes, un jeu à une place, ou deux connexions qui se relaient (l'une crée, l'autre complète), gardaient vivantes autant de parties qu'elles en demandaient.

**Cinq parties privées en cours au plus, par joueur assis.** La même valeur borne aussi les parties privées où un même joueur siège, qu'il les ait créées ou rejointes par code : 5 parties pas encore finies où son siège est occupé (connecté ou non), tous types et toutes connexions confondus. Elle est vérifiée à la création comme à l'entrée par code : la demande suivante est refusée (`"vous siégez déjà dans 5 parties privées en cours (limite atteinte) : quittez-en une, ou attendez qu'une se termine, avant d'en créer ou d'en rejoindre une autre"`). La partie en attente que la nouvelle remplace ne compte pas, une partie finie (pendant sa grâce `endTtl`) non plus, et un 2e onglet de la même identité se rattache toujours à une partie où elle siège déjà. Le joueur est son identité ; un joueur anonyme, sa connexion. Une partie restaurée au redémarrage compte : ses sièges sont sauvegardés. `antiCheat.privateGamesPerCreator` règle les deux bornes, `null` les retire toutes les deux. Sans celle-ci, deux connexions qui se relaient (l'une crée, l'autre complète, puis la première quitte) gardaient vivantes autant de parties qu'elles en demandaient : la borne des créateurs ne compte que les parties où le créateur siège encore.

### La grâce des parties vides — `emptyTtl`

Indépendamment de `seatTtl` : dès qu'**aucun** siège n'est plus connecté (tout le monde a fermé son onglet), une partie **commencée** (file ou code : toutes ses places ont été prises une fois) est détruite après `emptyTtl` (défaut 60 s) — un retour d'un siège avant l'échéance désarme la destruction. C'est le filet qui évite qu'une partie orpheline vive indéfiniment en mémoire, tout en laissant à ses joueurs déconnectés le temps de revenir. Deux cas n'attendent pas. Une table **jamais complète** (une partie par code qui attend ses invités) dont le dernier joueur connecté s'en va — créateur refusé par `hooks.onJoin`, onglet fermé ou rechargé, `µgame:leave` — est fermée tout de suite, son code oublié. Une partie dont **plus aucun siège n'est occupé** (tous sont partis par `µgame:leave` ou ont été refusés, file publique comprise) aussi : personne ne peut plus la retrouver par `µgame:resync`. Une table d'attente ne survit donc pas à une coupure réseau de son créateur s'il y est seul : à la reconnexion, sa poignée reçoit `"partie introuvable"` (statut `'error'`) et il en crée une autre. Les spectateurs d'une partie non finie ainsi fermée (tout de suite ou à l'échéance d'`emptyTtl`) reçoivent `µgame:end { result: { cancelled: true, reason: 'abandoned' } }`. Une partie déjà **finie** (`game.end()`) n'est pas concernée : sa destruction suit `endTtl`, ci-dessous.

### La grâce d'une partie finie — `endTtl`

`emptyTtl` ne règle que la vie d'une partie **non finie**. Une fois `game.end(result)` appelé, la partie est détruite `endTtl` ms plus tard, que des sièges soient encore connectés ou non, et non plus après `emptyTtl` ; sans `endTtl`, cette grâce reste `emptyTtl` (rien ne change tant que vous ne le déclarez pas). Les deux durées se règlent donc séparément : une partie vide peut être gardée longtemps (un joueur peut revenir) sans garder longtemps une partie finie.

```civet
app.game('morpion', {
  seats:    2
  emptyTtl: 14 * 24 * 3600 * 1000     # partie vide gardée 14 jours : un joueur peut revenir
  endTtl:   10 * 60 * 1000            # partie finie libérée 10 minutes après la fin, le temps de voir le résultat
  …
})
```

Pendant la grâce, la partie reste interrogeable (un `µgame:resync` reçoit sa réponse habituelle) mais n'est plus jouable. Cette réponse ne dit pas que la partie est finie (elle n'a ni `ended` ni `result`) : l'issue n'y figure que si votre `state` ou votre `view` la porte, donc posez-la dans `game.state` avant d'appeler `game.end()` (un siège déconnecté à cet instant ne reçoit jamais le `µgame:end`). Un joueur de la file publique qui relance `µgame:play` pendant la grâce est remis en file (réponse `{ queue: n }`) : il ne retrouve pas la partie finie, où tous ses coups seraient refusés. Un nouveau venu qui a le code d'une partie privée finie est refusé (`"partie terminée"`) sans passer par `hooks.onJoin`, même si un départ a libéré un siège ; un joueur déjà assis, lui, peut toujours s'y resynchroniser ou y rattacher un 2e onglet. La fin ferme aussi la fenêtre `seatTtl` d'une partie de la file, la minuterie de tour (`turns.timeout`) et toutes vos minuteries nommées (`game.timer()`) : une partie finie n'est jamais « annulée » (un seul `µgame:end` part), son tour ne passe plus et un rappel récurrent de votre code s'arrête ; seule la grâce reste armée. Une minuterie armée après la fin — depuis `hooks.onEnd`, par exemple — ne part pas non plus. Le compte à rebours est armé une seule fois, par le premier `game.end()` : un second appel est sans effet, un siège qui revient ne l'annule pas, un siège qui part ne le remplace pas par `emptyTtl`, et une partie finie sauvegardée puis restaurée au redémarrage ([§8](#persistance)) le reprend à l'échéance qui lui restait. `endTtl` suit les mêmes règles que `emptyTtl` : un nombre fini > 0 en millisecondes, `Infinity` refusé (note « Durées », [§3](#declarer-un-jeu)).

Une partie finie restaurée depuis une sauvegarde qui ne porte pas sa grâce (écrite pendant un arrêt du serveur, ou par une version antérieure) repart avec une grâce `endTtl` entière : elle finit toujours par être détruite et retirée du stockage.

---

<a id="le-client"></a>
## 7. Le client — `sock.game`

Posé par-dessus `µ.socket` (module runtime `game`, cf. [§9](#configuration)) :

```civet
game = sock.game('morpion')                     # file publique
game = sock.game('morpion', { code: true })      # crée une partie privée (code généré)
game = sock.game('morpion', { code: 'ABCDE' })   # rejoint ce code (inconnu → statut 'error')
```

`sock.game()` renvoie la **poignée immédiatement** — jamais une Promise nue (même choix que `stream()`/`presence()`, [20 · Temps réel](20-temps-reel.md)) : l'appli affiche l'attente dès le premier tick, sans rien attendre.

### Le store réactif — À **plat**

`game.state` est un store réactif µ — les clés de LA **vue** (celle que `def.view` a calculée pour ce joueur, §5) sont fusionnées **telles quelles à la racine**, à côté de méta-clés réservées :

| Clé | Type | Sens |
|---|---|---|
| `gameId` | chaîne \| `null` | `null` tant que jamais assis |
| `seat` | nombre \| `null` | numéro de siège |
| `phase` | chaîne \| `null` | `game.phase` côté serveur |
| `turn` | chaîne \| `null` | identité stable du siège dont c'est le tour (joueur anonyme : `anon:` suivi de son id de connexion) |
| `seq` | nombre \| `null` | dernier numéro de séquence appliqué |
| `code` | chaîne \| `null` | code de partie privée si `def.code`, sinon `null` |
| `queue` | nombre \| `null` | position dans la file publique, `null` sinon |
| `status` | `'waiting'\|'playing'\|'finished'\|'left'\|'error'` | cycle de vie de LA **poignée** |
| `seats` | tableau \| `null` | dernier roster `µgame:seat` — `[{seat,connected}\|null, …]` ; connu dès que la poignée est assise (le roster que le serveur diffuse pendant votre arrivée est gardé, pas perdu), `null` avant |
| `result` | — \| `null` | résultat de `µgame:end` |
| `error` | chaîne \| `null` | message du dernier refus **serveur** |

Le reste — les clés propres à `def.view` (ici `grille`, `lettres`, `monSecret`) — se lit directement, sans indirection :

```html
{if game.state.status === 'waiting'}
  en file, position {game.state.queue}
{end}
{if game.state.status === 'playing'}
  {game.state.grille[0]}…
{end}
```

> ⚠️ **Collision de noms.** Si `def.view` renvoie une clé qui porte le **même** nom qu'une des méta-clés ci-dessus (par exemple un jeu qui aurait sa propre notion de `code` ou de `status`), elle est **écrasée** par la méta-clé — même compromis assumé que le `'reset'` d'un flux MJS-WS. À connaître avant de nommer les champs de votre vue.

### Jouer — `.move()`

```civet
try
  result = await game.move('jouer', { i: 4 })
catch e
  µ.error 'coup refusé :', e
```

`.move(nom, p)` renvoie une **Promise**, résolue par le `result` du move côté serveur, rejetée par le motif de refus (chaîne = refus applicatif du serveur ; objet `{code,message}` = refus transport, même contrat que `sock.request()`). Rejette aussi `{code:'not-seated'}` si appelée avant tout siège connu.

### Les 7 événements — `.on()`

```civet
off = game.on('end', (p)-> µ.log 'partie finie :', p.result)
```

`'state'` (à chaque mutation), `'seat'` (roster), `'event'` (`game.send()` libre, §4), `'start'` (assis — appel direct ou poussée), `'end'`, `'left'` (un **autre** siège est parti), et `'error'` — ce dernier n'est **pas** une trame serveur : c'est le seul moyen d'observer un refus de `play`/`resync`, puisque `sock.game()` ne renvoie pas de Promise.

### Reconnexion — resync **automatique**

Au `µ:welcome` d'une reconnexion (cf. [23 · MJS-WS §8](23-mjs-ws.md#reprise-session)) : chaque partie **déjà assise** (`status: 'playing'`) relance `µgame:resync` toute seule — siège retrouvé par identité **stable** (`opts.auth` de `µsocket`, cf. [§14](#limites)) ; chaque partie encore **en file** (`status: 'waiting'`) rejoue `µgame:play` depuis zéro (la file ne survit pas à une déconnexion côté serveur). Un refus **serveur** sur l'un ou l'autre chemin est **terminal** — jamais retenté en boucle, seulement `status: 'error'` + l'événement `'error'`. Rien à coder côté appli.

### Plusieurs parties à la fois

Chaque `sock.game()` renvoie une poignée **indépendante** — aucun singleton par type (contrairement à `stream()`/`presence()`). Limite connue : si le **même** socket met en file plusieurs types **simultanément** (plusieurs `sock.game()` pas encore assis en même temps), la correspondance entre une poussée `µgame:start` de complétion de **file** et LA **bonne** poignée en attente se fait par ordre FIFO (la plus ancienne poignée non assise) — fiable tant qu'un seul message est traité à la fois côté serveur (toujours vrai), moins évident à suivre visuellement si vous ouvrez beaucoup de files d'un coup. La fin « entrée refusée » d'un joueur de la file ([§6](#appariement)) n'a pas cette limite : elle nomme le type de jeu et va à la plus ancienne poignée en file de ce type.

### Dans un composant

Une partie n'est rattachée à aucun composant, même ouverte pendant qu'un composant s'exécute (son code d'initialisation, son `µmount`, un de ses effets) : elle vit jusqu'à `leave()` ou la fin de la partie. Une partie ouverte dans un composant n'est pas quittée quand il disparaît : le siège (ou la place en file) reste tenu, la poignée reçoit toujours ses événements, `state` reste à jour et la reconnexion la reprend ; si le composant revient dans la page, il retrouve la même poignée, la même partie et le même code, et une partie finie entre-temps garde son résultat. Appelez `leave()` pour la quitter, par exemple dans `µdestroy` :

```civet
partie = sock.game('morpion')
µdestroy -> partie.leave()
```

La discussion (`sock.chat()`, cf. [26](26-chat.md)) et le hall (`sock.lobby()`, cf. [28](28-lobby.md)), eux, se ferment avec le composant qui les ouvre.

### Interpoler côté client — `µsmooth`

En mode action ([§10](#mode-action)), les entités reçues par `µgame:state` sautent d'un tick à l'autre (15-20 Hz typique) — un mouvement saccadé si `game.state` est affiché tel quel. `µsmooth` (cf. [20 · Temps réel](20-temps-reel.md) §6 « Lissage réseau ») interpole entre les dernières positions reçues, à la fréquence d'affichage (60 fps), indépendamment de la cadence réseau :

```civet
game = sock.game('arene', { code: true })
$$fluide = µsmooth game.state.entites, { delay: 100, owner: @ }
```
```html
{if game.state.status === 'playing'}
  {for id, e in $$fluide}
    <@entity x={e.x} y={e.y}>
  {end}
{end}
```

`game.state.entites` (ou tout champ de votre vue qui est un dictionnaire `{id: {x, y, …}}`) sert directement de **source** — `µsmooth` ne demande aucun câblage supplémentaire côté MJS-Server, que la vue soit complète ou reconstruite à partir de deltas ([§11](#deltas), transparent pour le client). `owner: @` (le composant appelant) permet à `$$fluide` de s'auto-disposer à la destruction du composant — sans lui, sa boucle d'interpolation tourne À **vie**.

> 🔗 Ce lissage générique suffit pour un affichage simple. Pour un vrai jeu d'action sous latence (mouvement distant + tir + éventuellement un mode déterministe), [§13 « Le réseau des jeux d'action »](#netcode) va plus loin : `µ.interp` (période auto-mesurée, extrapolation puis gel), `µ.predict` (réponse immédiate sur votre propre entité) et la compensation de lag côté serveur (`def.history`/`game.rewind`).

<a id="contrat-type-jeu"></a>
### Contrat typé (optionnel)

**Même** surcouche de typage optionnelle que MJS-WS ([23 · MJS-WS §11](23-mjs-ws.md#contrat-type) — lisez-la
d'abord pour la **réalité** complète : compilation séparée `.server.mjs`/`.mjs`, coût nul à
l'exécution), appliquée ici à `app.game`/`sock.game` : `src/mjs-server/contract.ts` fournit
`MjsServerGameContract` (la forme de `view`/`moves` **vue du client**) et `TypedGame<G>` — `game.state`
et `game.move()` typés, sans rien changer au protocole `µgame:*`.

```ts
// contrat.ts — partagé entre ws.server.mjs et le composant qui affiche le morpion
import type { MjsServerGameContract } from 'modularjs-framework/mjs-server'

export interface MorpionContrat extends MjsServerGameContract {
  view: { grille: Array<string | null> }
  moves: {
    jouer: (p: { i: number }) => boolean   // result renvoyé par def.moves.jouer
  }
}
```

Côté composant — `sock.game()` reste identique, `asTypedGame` ne fait que caster la poignée :

```civet
<script>
  import type { MorpionContrat } from '../contrat.ts'
  import { asTypedGame } from 'modularjs-framework/mjs-server'

  game = asTypedGame<MorpionContrat>(sock.game('morpion'))
</script>
```
```html
{if game.state.status === 'playing'}
  {game.state.grille[0]}…           <!-- 'grille' inféré Array<string|null>, méta RÉSERVÉES aussi typées -->
{end}
```
```civet
result = await game.move('jouer', { i: 4 })   # résultat inféré boolean
```

Un `game.move('jouer', { j: 4 })` (mauvaise clé) ou un `game.state.gril` (typo) sont des erreurs
`tsc`, pas des bugs à l'exécution — cf. `tests/contract-types.test.ts` pour la liste vérifiée.

`TypedGameDef<G>`/`defineTypedGame(def)` bordent symétriquement le bout **serveur** (`app.game(type,
def)`) sur le MÊME contrat — `def.view`/`def.moves[...]` typés contre `G`, `game`/`player`
restent les vrais types serveur (`Game`/`MjsServerSeat`). `.on()` (les 7 événements, ci-dessus)
reste en dehors du contrat — payload `any`, comme aujourd'hui.

---

<a id="persistance"></a>
## 8. La persistance

Optionnelle — `opts.persist` absent = **aucun** hook armé (pas une `Map`, pas une minuterie créées). Le contrat, par duck-typing **strict** (n'importe quel objet qui expose ces fonctions convient) :

```ts
interface MjsServerPersistAdapter {
  load(): Promise<Array<{ id: string; data: MjsServerGameSnapshot }>>   // lu UNE FOIS au boot
  save(id: string, data: MjsServerGameSnapshot): void | Promise<void>  // attendu : une écriture à la fois par partie, abandonnée sans réponse en 30 s
  remove(id: string): void | Promise<void>
  flush?(): void | Promise<void>                                          // appelé par app.stop(), après la rafale finale
}
```

```civet
app = mjsServer({ persist: { adapter: new MemoryPersistAdapter(), debounce: 150, snapshotEvery: 0 } })
```

`opts.persist` accepte l'adaptateur NU (défauts appliqués) ou `{ adapter, debounce?, snapshotEvery? }`. **Débounce** (défaut 150 ms) : chaque mutation diffusée d'une partie réarme une minuterie — N mutations rapprochées → UN seul `save()`, celui qui capture l'état après la dernière. Sous mutation continue (une partie d'action : chaque coup réarme le débounce avant qu'il n'expire), une partie est sauvée au plus tard **10 débounces** après sa première mutation non sauvée (1,5 s par défaut). **`snapshotEvery`** (défaut `0` = désactivé) force en plus un `save()` des parties encore sales à intervalle fixe. Une seule écriture en vol par partie : celles qui arrivent pendant ce temps se regroupent en une seule, avec le dernier état — les adaptateurs fournis rendent la promesse de leur écriture.

**Une écriture qui répond trop tard.** Une écriture sans réponse après 30 secondes est abandonnée : la partie continue de se sauver sans l'attendre, mais l'écriture peut encore aboutir plus tard. Quand elle aboutit alors qu'une écriture plus récente a été lancée (ou a abouti), elle a pu la remplacer dans le stockage : l'état courant de la partie est réécrit. Chaque écriture abandonnée coûte au plus une réécriture. La sauvegarde tardive d'une partie oubliée, puis recréée sous le même identifiant, réécrit l'état de la partie vivante.

Au démarrage, `app.listen()` **charge avant d'écouter** — aucun client ne peut arriver sur une partie pas encore restaurée. À l'arrêt, `app.stop()` sauve une dernière fois les parties encore sales **puis** `flush()` l'adaptateur, **puis** coupe les minuteries — un ordre inversé perdrait les minuteries en cours au prochain redémarrage. Détruire une partie pour un **arrêt serveur** ne l'efface **jamais** du stockage (elle revit au prochain boot via `load()`) — seule une **vraie** fin (`.end()`, `emptyTtl`, fermeture d'une table abandonnée, annulation de sièges) appelle `remove()`.

**Rien ne part vers l'adaptateur après son `flush()`.** Dès que `app.stop()` commence, les coups sont refusés (`"le serveur s'arrête : votre coup n'a pas été joué — rejouez-le après son redémarrage"`) — acquitté, un coup reçu à ce moment aurait été perdu au redémarrage — et plus aucune sauvegarde n'est programmée : une autre mutation pendant l'arrêt (boucle de tick, minuterie, coup asynchrone déjà en cours) n'est pas sauvée, la dernière sauvegarde reste celle de la rafale finale, minuteries comprises. Avant le `flush()`, l'arrêt attend aussi le `remove()` d'une partie finie juste avant ou pendant l'arrêt : il aboutit avant que vous ne fermiez votre stockage.

**Identifiants.** Le compteur des parties neuves part de l'heure du démarrage (`game1792416537596`, puis `+1` par partie) : une partie neuve ne reprend jamais l'identifiant d'un démarrage précédent, même quand sa sauvegarde n'a pas été restaurée (`load()` en échec, type de jeu retiré, instantané invalide). Tout identifiant `game<n>` lu au chargement, restauré ou non, relève encore ce compteur : il ne resservira pas, même si l'horloge de la machine a reculé. Deux sauvegardes du **même** identifiant (une copie de sauvegarde laissée dans le dossier de stockage, un back qui rend un doublon) : la première rendue par `load()` est restaurée, la suivante ignorée avec un avertissement.

Une entrée restaurée dont la **forme** est inattendue (champ manquant, type inattendu — au-delà de la simple corruption JSON déjà couverte par chaque adaptateur, cf. tableau ci-dessous) est elle aussi **ignorée avec un avertissement** plutôt que de bloquer le boot des autres parties : `id`/`type` non vides, `journal`/`seats`/`timers` tableaux, chaque siège/minuterie de la forme attendue. De même pour une entrée `null` rendue par un adaptateur maison. Un `load()` maison qui ne rend pas un tableau (`{}`, `null`, une chaîne…) est traité comme un `load()` qui échoue : un avertissement dit ce qu'il a reçu, et le serveur démarre sans restauration.

### Les adaptateurs fournis

| Adaptateur | Fichier | Stockage |
|---|---|---|
| `MemoryPersistAdapter` | `persist.ts` | en mémoire — tests, ou dev sans rien installer |
| `FilePersistAdapter({ dir })` | `persist-file.ts` | un fichier JSON par partie, écriture **atomique** (tmp + rename) ; fichier corrompu au `load()` → ignoré + `warn`, jamais un crash de boot ; seul `<id>.json` est chargé : une copie laissée dans le dossier (`game7 - copie.json`, même id dans son contenu) → ignorée + `warn`, jamais restaurée en doublon, laissée sur le disque |
| `BridgePersistAdapter({ url, secret })` | `persist-bridge.ts` | **Pousse** vers un back HTTP par requêtes signées HMAC-SHA256 (même machinerie que le pont MJS-WS) — le back garde la vraie base ; 3 tentatives puis abandon + `warn`, jamais bloquant |
| `RedisPersistAdapter({ url\|host/port, prefix? })` | `persist-redis.ts` | UN hash Redis pour tout le process (`HSET`/`HDEL`/`HGETALL`) — cf. ci-dessous |
| `SqlPersistAdapter({ query, table?, dialect? })` | `persist-sql.ts` | **Une** table SQL générique, pilote injecté par l'appli — cf. ci-dessous |
| instance maison | — | n'importe quel objet `{ load, save, remove, flush? }` |

### La règle — du **texte**, encodé par l'adaptateur lui-même

Aucun adaptateur ne confie le typage de `data` au moteur de stockage : il encode **lui-même** et stocke du **texte** — une colonne `data` texte dans le DDL SQL (`LONGTEXT` sous MySQL/MariaDB, `TEXT` sous PostgreSQL), un champ de hash Redis, un fichier `.json`. Jamais une colonne `JSON`/`JSONB` typée. La raison est mesurée, pas théorique : le **même** schéma déclarant une colonne `json` rend un objet sous MySQL et une **chaîne** sous MariaDB (où `json` n'est qu'un alias de `LONGTEXT` + `CHECK json_valid`) — un back qui délègue son typage au moteur change de comportement en changeant de machine, sans qu'une ligne de code ait bougé. Le texte, lui, se relit pareil partout : c'est aussi pourquoi `dialect` ne sert **qu'à** la syntaxe des paramètres bind (`?` contre `$1`) et à la taille de cette colonne texte, jamais au typage.

La paire d'encodage est exportée — un adaptateur **maison** utilise exactement la même que les nôtres, et hérite du jour où l'un des trois devra traiter un cas particulier (valeur cyclique, `Date`, très gros payload) :

```ts
import { mjsServer, encodeSnapshot, decodeSnapshot } from 'modularjs-framework/mjs-server'

const store = new Map<string, string>()                                                       // que du TEXTE
const app   = mjsServer({ persist: {
  save(id, data) { store.set(id, encodeSnapshot(data)) },
  remove(id)     { store.delete(id) },
  async load()   { return [...store].map(([id, raw]) => ({ id, data: decodeSnapshot(raw) })) }
}})
```

`decodeSnapshot` **lève** sur une entrée illisible : les adaptateurs fournis attrapent, journalisent un `warn` et **sautent** l'entrée — une partie corrompue n'empêche jamais les autres de revivre.

### La recette pont — pousser vers Rails (ou équivalent)

`BridgePersistAdapter` attend **une** URL, 3 opérations : `POST {op:'save', id, data}`, `POST {op:'remove', id}`, `GET` (corps vide) → `{ok:true, games:[{id,data}, …]}`. Côté back (n'importe quel langage qui sait vérifier une HMAC ; Ruby/Rails ci-dessous, pseudo-code fidèle à l'en-tête de `persist-bridge.ts`) :

```ruby
SECRET = ENV.fetch('MJS_SERVEUR_PERSIST_SECRET')                # même secret que { secret: … } côté TS

def verifie!(ts, corps)                                      # halt 401 si signature/horodatage invalides
  halt 401 if ts.nil? || (Time.now.to_i - ts.to_i).abs > 300
  attendue = OpenSSL::HMAC.hexdigest('SHA256', SECRET, "#{ts}.#{request.request_method}.#{request.fullpath}.#{corps}")   # fullpath : le chemin avec sa requête (?…)
  halt 401 unless Rack::Utils.secure_compare(attendue, request.env['HTTP_X_MJS_WS_SIGNATURE'].to_s)
end

post('/mjs-server/persist') do
  corps = request.body.read
  verifie!(request.env['HTTP_X_MJS_WS_TIMESTAMP'], corps)
  body = JSON.parse(corps)                                   # {op, id, data?} — APRÈS vérification
  case body['op']
  when 'save'   then Game.upsert(id: body['id'], data: body['data'].to_json)
  when 'remove' then Game.where(id: body['id']).delete_all
  end
end

get('/mjs-server/persist') do
  verifie!(request.env['HTTP_X_MJS_WS_TIMESTAMP'], '')        # GET = corps vide → même chaîne canonique
  { ok: true, games: Game.all.map { |p| { id: p.id, data: JSON.parse(p.data) } } }.to_json
end
```

La vérification ci-dessus suit la **même** recette que le pont MJS-WS (en-têtes `x-mjs-ws-timestamp`/`x-mjs-ws-signature`, chaîne canonique `${ts}.${MÉTHODE}.${chemin}.${corps}`, anti-rejeu ± 300 s) — cf. [23 · MJS-WS §7.5](23-mjs-ws.md#pont) pour le webhook (Node) et §7.11 pour la même vérification côté Rails. Copier le bloc ci-dessus **sans** `verifie!` expose save/remove/load de n'importe quelle partie à qui sait faire un POST.

### Redis et SQL

```civet
import { mjsServer, RedisPersistAdapter } from 'modularjs-framework/mjs-server'

app = mjsServer({ persist: new RedisPersistAdapter({ url: 'redis://localhost:6379', prefix: 'mjs-server:' }) })
```

`RedisPersistAdapter` réutilise le mini-client RESP maison de MJS-WS (**zéro** dépendance npm) — connexion **paresseuse** (rien d'ouvert avant le premier `save`/`remove`/`load`), un seul hash Redis pour tout le process (`<prefix>games`, un **champ** par partie : `HSET`/`HDEL`/`HGETALL`).

`SqlPersistAdapter` ne pilote **aucun** pilote lui-même — l'appli injecte SA fonction `query`, déjà branchée sur son propre pool :

```js
// mysql2 — dialecte '?' (paramètres positionnels), défaut
import mysql from 'mysql2'
import { mjsServer, SqlPersistAdapter } from 'modularjs-framework/mjs-server'

const pool  = mysql.createPool({ host: '…', database: '…' }).promise()
const query = async (sql, params) => { const [rows] = await pool.query(sql, params); return rows }

app = mjsServer({ persist: new SqlPersistAdapter({ query, dialect: '?' }) })
```

```js
// pg — dialecte '$' (paramètres numérotés $1 $2 …)
import pg from 'pg'
import { mjsServer, SqlPersistAdapter } from 'modularjs-framework/mjs-server'

const client = new pg.Client({ connectionString: '…' })
await client.connect()
const query = async (sql, params) => { const { rows } = await client.query(sql, params); return rows }

app = mjsServer({ persist: new SqlPersistAdapter({ query, dialect: '$' }) })
```

`SqlPersistAdapter` crée sa table (`CREATE TABLE IF NOT EXISTS <table> (id VARCHAR(64) PRIMARY KEY, data LONGTEXT, updated_at BIGINT)` en `?`, `data TEXT` en `$`) une seule fois à la construction — `LONGTEXT` parce qu'un `TEXT` MySQL/MariaDB s'arrête à 64 Ko alors qu'un journal lockstep peut atteindre 16 Mo ([§13](#netcode)). **SQLite n'est pas pris en charge** : la table s'y crée, mais l'upsert du dialecte `?` est celui de MySQL (`ON DUPLICATE KEY UPDATE`), que SQLite refuse — chaque `save()` échoue, et le journal le signale une fois en clair. Une table créée par une version antérieure garde son `TEXT` : passez-la en `LONGTEXT` (`ALTER TABLE mjs_server_games MODIFY data LONGTEXT`) avant d'y sauver de gros journaux, et vérifiez que le `max_allowed_packet` de votre serveur laisse passer leur taille. `save()` est un **upsert** en un aller-retour (`ON DUPLICATE KEY UPDATE` en `?`, `ON CONFLICT … DO UPDATE` en `$`). `updated_at` est posé à chaque `save()` (horodatage ms) et n'est jamais relu par le serveur : il est là pour vous, pour trier ou diagnostiquer.

> ⚠️ **Trois pièges à connaître avant de câbler l'un ou l'autre.**
> - **`opts.query` doit renvoyer un tableau de lignes pour un `SELECT`** (`rows`, jamais `{rows}` ni la paire `[rows, fields]` brute d'un pilote — désenveloppez-le vous-même dans votre fonction `query`, cf. les deux recettes ci-dessus qui le font déjà) : `load()` fait `Array.isArray(lignes) ? lignes : []` — un mauvais format ne throw **pas**, le serveur démarre juste **sans** restauration, silencieusement.
> - **`flush()` ferme la connexion Redis.** Appelé une seule fois par `app.stop()`, `RedisPersistAdapter.flush()` attend la file en vol **puis** coupe le socket — au-delà de ce qu'exige le contrat `MjsServerPersistAdapter` minimal, mais nécessaire : sans cette fermeture, le cycle de reconnexion à backoff de la connexion RESP tournerait indéfiniment après l'arrêt du serveur. Ne réutilisez jamais un `RedisPersistAdapter` après `app.stop()`.
> - **Redis injoignable → 5 s puis abandon, jamais un blocage.** Toute attente de connexion (au boot comme en cours de vie) est bornée à 5 s : passé ce délai, `save()`/`remove()` abandonnent avec un `warn` (« le prochain `save()` rattrapera l'état »), et `load()` démarre **sans** restauration plutôt que de geler `app.listen()` indéfiniment.

### Migrer un stockage écrit par une version antérieure

Une sauvegarde écrite par une version française de MJS-Server porte quatre noms français (cf. CHANGELOG) ; le script de migration les convertit ainsi :

| Dans une ancienne sauvegarde | Lu par le serveur |
|---|---|
| `minuteries: [{ nom, à }]` | `timers: [{ name, at }]` |
| `journal: [{ coup, joueur, p, à }]` | `journal: [{ move, player, p, at }]` |
| `lockstep.journal[].ordres: [{ joueur, coup, p }]` | `lockstep.journal[].orders: [{ player, move, p }]` |
| `id: 'partie<n>'` — **et le fichier**, nommé `<id>.json` | `id: 'game<n>'` |

`type`, `code`, `state`, `phase`, `turn`, `seq` et `seats` restent tels quels. Les trois minuteries réservées sont converties aussi (`'µtour'`/`'µappariement'`/`'µvide'` → `'µturn'`/`'µmatch'`/`'µempty'`) : une partie restaurée sans traduction ne réarmerait pas son tour.

L'**identifiant** est le seul de ces quatre à circuler aussi **sur le fil** (`µgame:*.game`) : le serveur le fabrique en `game<n>`, `n` parti de l'heure du démarrage (cf. « Identifiants » plus haut). Ne pas migrer ne casse rien — les deux formes ne se croisent jamais, le compteur ne réattribue qu'un `game<n>` — mais la base continue de parler français. Le script renomme le **fichier** en même temps que l'id ; il refuse d'écraser une cible déjà présente (avertissement, les deux fichiers restent) et laisse intact tout id d'une autre forme.

> ⚠️ **Lockstep — la graine dépend de l'id.** Elle n'est pas stockée : elle est re-dérivée de l'identifiant à chaque restauration (`deterministicSeed`). Renommer l'id d'une partie lockstep **en cours** change donc sa graine : au retour, les clients reçoivent `{seed, journal}` et rejouent le journal avec un autre flux d'aléatoire qu'avant l'arrêt. Sans conséquence pour un jeu lockstep sans hasard ; sinon, migrez entre deux parties plutôt qu'au milieu d'une partie vivante.

```bash
node scripts/migrate-games-fr-to-en.mjs ./data/parties --dry-run   # montre, n'écrit rien
node scripts/migrate-games-fr-to-en.mjs ./data/parties             # migre
```

Le script est **idempotent** (un instantané déjà à jour est laissé tel quel) et écrit de façon **atomique** (fichier temporaire puis `rename`, le même geste que `FilePersistAdapter`) : une coupure en cours de route ne laisse jamais une partie à moitié écrite.

Les autres adaptateurs demandent un geste de plus :
- **SQL** — trois gestes, et les **colonnes** sont obligatoires : le serveur écrit `data` et `updated_at`, une table restée en `donnees`/`maj` fera échouer chaque `save()` (avertissement, aucune sauvegarde) et repartira sans restauration.

  ```sql
  ALTER TABLE mjs_server_parties RENAME TO mjs_server_games;              -- 1. la table
  ALTER TABLE mjs_server_games RENAME COLUMN donnees TO data;              -- 2. les colonnes
  ALTER TABLE mjs_server_games RENAME COLUMN maj TO updated_at;
  UPDATE mjs_server_games SET id = REPLACE(id, 'partie', 'game') WHERE id LIKE 'partie%';   -- 3. les ids
  ```

  Le nom de **table**, lui, reste au choix (`new SqlPersistAdapter({ table: 'mjs_server_parties', … })` garde l'ancien) — les colonnes, non : elles sont écrites en dur dans les requêtes. `RENAME COLUMN` demande MySQL ≥ 8.0 ; en 5.7, écrivez `CHANGE donnees data LONGTEXT` et `CHANGE maj updated_at BIGINT`. La colonne de données contient le même JSON — le script ci-dessus s'applique à son contenu ; l'id vit là **aussi** en clé primaire, d'où la dernière ligne.
- **Pont** — le corps HTTP passe de `{op, id, données}` à `{op, id, data}`, et la réponse du `GET` de `{ok, parties}` à `{ok, games}`. Le back doit suivre **avant** la mise à jour du serveur, sinon `load()` repart d'un tableau vide (sans crash, mais sans restauration).
- **Redis** — la clé du hash passe de `<prefix>parties` à `<prefix>games` : `RENAME mjs-server:parties mjs-server:games`. Le hash contient le même JSON, migrez-le avec le même jeu de renommages. Le **champ**, lui, porte l'id : Redis n'a pas de « renommer un champ », relisez-le, réécrivez-le sous le nouveau nom, supprimez l'ancien (`HGET`/`HSET`/`HDEL`).

---

<a id="configuration"></a>
## 9. Configuration

`mjsServer(opts)` accepte **exactement** les mêmes options que `mjsWs(opts)` ([23 · MJS-WS §1](23-mjs-ws.md#options)) — `auth`, `welcome`, `rooms`, `heartbeat`, `limits`, `bridge`, `resume`, `onDisconnect`… — augmentées de deux clés propres à MJS-Server :

| Clé | Type | Rôle |
|---|---|---|
| `persist` | adaptateur ou `{ adapter, debounce?, snapshotEvery? }` | cf. [§8](#persistance) — absent = désactivé |
| `antiCheat` | `{ movesPerIdentity?, codePerIp?, privateGamesPerCreator? }` | trois garde-fous anti-abus : `[n, fenêtreMs]` pour les deux premiers, un entier ≥ 1 pour le troisième, `null` désactive — absent = défaut |

`antiCheat.movesPerIdentity` plafonne les coups d'une **même identité**, toutes parties confondues (absent = désactivé). `antiCheat.codePerIp` plafonne les tentatives de **partie par code** venues d'une même adresse IP — c'est le verrou qui empêche de balayer l'espace des codes à cinq caractères ; son défaut actif est `[10, 60000]` (dix tentatives par minute), et `null` le désactive franchement. `antiCheat.privateGamesPerCreator` borne les parties privées en cours d'un même créateur et, de la même valeur, celles où un même joueur siège, créées ou rejointes par code ([§6](#appariement)) : son défaut actif est `5`, `null` retire les deux bornes. Les trois clés sont représentables en JSON, donc définissables dans `mjs.config.json` aussi bien que dans l'entry (en cas de doublon, l'entry prime en bloc). Dans les deux paires, `n` est un entier ≥ 1 et `fenêtreMs` un nombre fini > 0 : une fenêtre `NaN` ou `Infinity` est refusée au démarrage, et le message rend la valeur passée telle quelle (`reçu : [5, NaN]`).

Côté client, le module runtime s'appelle **`game`** (à côté de `socket`, `router`, `ajax`…) :

```json
{ "runtime": ["socket", "game"] }
```

Sélectionner `'game'` sans `'socket'` compile quand même (le bundler avertit : `sock.game` restera `undefined`) — `'game'` patche `MjsSocket.prototype`, il lui faut donc le module `'socket'` déjà présent. Le défaut `"runtime": "all"` (pas de config du tout) inclut les deux, comme le reste du runtime.

```civet
import { mjsServer } from 'modularjs-framework/mjs-server'
```

### Derrière nginx — `trustProxy`

En production, MJS-Server tourne presque toujours derrière nginx. Sans réglage, la socket du serveur ne voit que l'adresse **du proxy** (`127.0.0.1`, ou rien du tout sur une socket unix) : **tous vos joueurs partagent la même adresse**, et les bornes par adresse deviennent des bornes **globales**. Deux sont à surveiller ici :

- **`antiCheat.codePerIp`**, le verrou des codes de partie privée (par défaut, dix codes faux, puis 60 s de refus) : dix codes faux d'**un** joueur bloquent alors la jonction par code de **tous** les joueurs pendant une minute ;
- **`limits.maxConnectionsPerIp`**, le plafond de connexions par adresse (100 par défaut) : il devient un plafond pour le site entier.

L'option `trustProxy` de MJS-WS ([23 · MJS-WS §3.5](23-mjs-ws.md#proxy-inverse)) règle les deux. `mjsServer()` la reçoit **telle quelle**, comme toutes les options de `mjsWs()` :

```js
import { mjsServer } from 'modularjs-framework/mjs-server'

const app = mjsServer({
  trustProxy: 'loopback',                  // nginx tourne sur la même machine : croire X-Forwarded-For quand le pair est local
  antiCheat: { codePerIp: [10, 60000] },   // compté par joueur, pas pour tout le monde à la fois
  /* ...auth, limits, persist... */
})
```

Côté nginx, le proxy doit **ajouter** l'adresse qu'il voit à `X-Forwarded-For`, et poser `X-Real-IP` :

```nginx
location /jeu {
  proxy_pass http://127.0.0.1:4001;
  proxy_http_version 1.1;
  proxy_set_header Upgrade $http_upgrade;
  proxy_set_header Connection "upgrade";
  proxy_set_header Host $host;
  proxy_set_header X-Real-IP $remote_addr;
  proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
}
```

Avec ces deux lignes, nginx écrit les deux en-têtes, et ils désignent le même joueur : c'est lui que l'on retient. Un joueur qui écrit lui-même un `X-Forwarded-For` voit sa ligne complétée par nginx : l'entrée retenue est la plus à **droite** qui n'est pas elle-même un proxy de confiance, et son adresse forgée reste à gauche, ignorée ; le `X-Real-IP` qu'il enverrait est remplacé. Gardez **les deux** lignes : `X-Real-IP` n'est cru que si `X-Forwarded-For` est absent ou désigne le même joueur. Quand les deux se contredisent (votre proxy n'en écrit qu'un, l'autre vient du joueur), le joueur prend l'adresse du proxy, jamais celle qu'il a forgée, et un avertissement unique part sur la console. Toutes les règles (liste d'adresses ou de plages à la place de `'loopback'`, chaîne de plusieurs proxies, CDN devant nginx, en-tête malformé, `true` et plages trop larges refusés) sont au [chapitre 23 §3.5](23-mjs-ws.md#proxy-inverse).

- **Listez vos proxies, pas un morceau d'Internet.** Une plage plus large que `/8` en IPv4 (`10.0.0.0/7`, `0.0.0.0/1`…) ou que `/16` en IPv6 (`2000::/3`, `fc00::/7`…) est refusée au démarrage, avec un message qui le dit : elle contiendrait des visiteurs directs, crus sur parole, qui choisiraient l'adresse qu'ils veulent dans `X-Forwarded-For` et contourneraient le verrou des codes de partie. Deux plages `/1` qui se partagent tout IPv4 reviennent à `true` : elles sont refusées aussi. Nommez les proxies eux-mêmes (`'10.0.0.0/8'`, `'192.168.1.5'`, `'fd12:3456:789a::/48'`).
- Avec `mjs serveur`, `trustProxy` n'est pas une clé de `mjs.config.json` : posez-la dans l'entry, `export default { trustProxy: 'loopback', … }`.
- Sur une socket unix (transport `'uws'` avec `socketPath`), le pair n'a aucune adresse : `'loopback'` le tient pour local. Le transport étant alors une **instance**, posez l'option sur lui : `new UwsTransport({ socketPath, trustProxy: 'loopback' })`.
- **Pour vérifier le réglage**, journalisez l'adresse retenue dans `auth` : `auth: (hello, meta) => { console.log('adresse retenue :', meta.address); return hello.auth }`. Vous devez y lire l'adresse de chaque joueur, jamais `127.0.0.1` pour tous.
- Sans le réglage, un avertissement unique au journal vous prévient dès que des en-têtes de proxy arrivent d'une adresse locale.

---

<a id="mode-action"></a>
## 10. Le mode action : tick et intentions

Le socle de MJS-Server (§3-§9) est **tour par tour événementiel** — un coup, une réaction, une diffusion groupée par microtâche (§4). Pour un jeu où des entités bougent en continu (une arène, un espace partagé, un jeu d'esquive…), `def.tick` bascule la partie en **mode action** : une boucle qui tourne à fréquence **fixe**, qui applique les intentions reçues puis simule le monde.

```civet
app.game('arene', {
  seats: 8
  tick:   20                          # Hz — de 1 à 60, boucle réelle (setInterval)

  state: (game)-> { entites: {} }

  intents: {
    bouger: (game, player, p)->    # même signature qu'un move — mais jamais exécuté à réception
      e = game.state.entites[player.id]
      e.x += p.dx; e.y += p.dy
  }

  simulate: (game, dt)->           # une fois PAR TICK, après les intentions — dt = ms RÉELLES écoulées
    for id in Object.keys(game.state.entites)
      ent = game.state.entites[id]
      ent.pv = Math.min(100, ent.pv + dt * 0.001)   # regen lente

  moves: {
    chat: (game, player, p)-> game.send('chat', { de: player.id, texte: p.texte })   # move classique — immédiat, hors boucle
  }
})
```

`def.tick` (nombre, défaut `0`) n'accepte que `0` (socle événementiel) ou une valeur DE 1 À 60 (Hz) — toute autre valeur lève une erreur claire à la déclaration. `def.intents`, `def.simulate` et `def.slowTick` exigent tous les trois `tick > 0` (sans boucle, rien ne les appellerait jamais) — throw clair à la déclaration si vous les fournissez avec `tick: 0`.

### Intentions — `def.intents`, dernière valeur gagne

Un coup envoyé sur un nom déclaré dans `def.intents` (au lieu de `def.moves`) n'est **jamais exécuté à réception** — il est mis en **file**, une par joueur et par **nom** : trois `bouger` envoyés dans la même fenêtre de tick ne s'accumulent **pas**, seule la **dernière** valeur compte. La file est vidée à chaque tick (ordre des **sièges**, jamais l'ordre d'arrivée réseau) juste avant `def.simulate`. Un nom ne peut pas être À LA **fois** un move classique et une intention (`def.intents.bouger` + `def.moves.bouger` → erreur à la déclaration). Une intention qui termine la partie (`game.end()`) arrête là le tick : les intentions suivantes et `def.simulate` ne tournent pas, l'état final part aux joueurs.

### `simulate(game, dt)` — une fois par tick

Appelée **après** les intentions en file, `dt` est l'écart **réel** (ms, mesuré) depuis le tick précédent — jamais la période nominale figée (`1000/tick`) : le `setInterval` sous-jacent peut dériver légèrement, `simulate` reçoit quand même le temps **vraiment** écoulé.

### `slowTick` — une deuxième cadence, indépendante

```civet
slowTick: { hz: 1, fn: (game)-> game.state.vagueSpawn() }   # 1×/s, indépendant de `tick`
```

Utile pour tout ce qui n'a pas besoin de la cadence complète (régénération, spawn, IA lente) sans polluer `simulate` d'un compteur de frames maison.

### Diffusion — une trame par tick, jamais par mutation

En mode événementiel (`tick: 0`), chaque mutation de `game.state` planifie une diffusion groupée à la **microtâche** suivante (§4). En mode action, cette planification est **suspendue** : la cadence de diffusion appartient exclusivement à la boucle — `µgame:state` part à chaque siège **une fois par tick**, après `simulate`, quel que soit le nombre de mutations survenues pendant ce tick (intentions de plusieurs joueurs comprises). Les **moves classiques** restent eux **immédiats** (§4) — utile pour un `chat` ou une action ponctuelle qui n'a pas besoin d'attendre le prochain tick pour partir.

> 🔤 Boucle démarrée dès le 1ᵉʳ siège **connecté** (pas besoin que `seats` soit atteint), coupée à la vidange complète, à `.end()` et à la destruction — jamais de `setInterval` résiduel.

---

<a id="deltas"></a>
## 11. Les deltas

Par défaut, `µgame:state` porte la vue **complète** à chaque diffusion — correct pour un état léger (une grille de morpion), coûteux pour un monde de plusieurs dizaines d'entités qui ne bougent qu'en partie à chaque tick. `def.deltas: true` fait calculer, **par joueur**, un diff entre la vue qui vient d'être calculée et la **dernière** vue effectivement **envoyée** à ce joueur — seuls les champs qui ont changé partent sur le fil.

```civet
app.game('arene', {
  tick:   20
  deltas: true                        # orthogonal à tick — utilisable aussi en mode événementiel (tick: 0)
})
```

### Ce que reçoit le client — transparent

Le client (`sock.game`, §7) n'a **rien à faire de spécial** : `game.state` reste le **même** store réactif À **plat** (§7), qu'il soit alimenté par une vue complète ou par un delta — l'application du delta sur le store local est **interne**, invisible pour votre code applicatif. Sur le fil, seule la **charge** change de forme :

| Situation | Charge `µgame:state` |
|---|---|
| `deltas: false` (défaut) | `{ game, view, phase, turn, seq }` — inchangé depuis le socle v1 |
| `deltas: true`, changement normal | `{ game, phase, turn, seq, delta: [{p:'chemin.a.b', v}, {p:'chemin.c', x:1}, …] }` — `v` pose/remplace la valeur au chemin `p` (à points), `x: 1` supprime la clé finale du chemin |
| `deltas: true`, repli (cf. ci-dessous) | `{ ..., view }` — vue complète, comme si `deltas` était `false` pour cette trame |
| `deltas: true`, phase/tour/`_ack` changent mais PAS la vue | `{ game, phase, turn, seq }` (+ `_ack` s'il y a lieu) — **méta seule**, sans `view` ni `delta` ; le client garde la vue qu'il avait |
| `deltas: true`, rien n'a changé pour CE joueur (ni la vue NI la méta) | **aucune trame** — zéro octet, pas même une trame vide |

### Repli vue complète

Trois situations retombent sur une vue **complète** plutôt qu'un delta, **jamais** un delta partiel : la **1ʳᵉ diffusion** pour un joueur donné (rien à comparer) ; **`µgame:resync`**, **toujours** une vue complète — ce qui vient d'être envoyé devient la nouvelle baseline pour le prochain delta ; et un **delta trop gros** — si son JSON dépasse 60 % du JSON de la vue complète, MJS-Server envoie la vue complète à la place (un état qui a presque tout changé ne gagne rien à être décrit champ par champ).

### Méta seule — un changement de phase/tour sans changement de vue part quand même

`phase`/`turn`/`_ack` (netcode) sont suivis **indépendamment** de la vue : un `game.to(...)`/`game.next()` qui ne touche **aucun** champ de `game.state` déclenche quand même une trame `{ game, phase, turn, seq }` (sans `view` ni `delta`) — sinon un changement de phase ou de tour resterait **invisible** côté client tant que la vue elle-même ne bouge pas. Suivi **par connexion**, comme la vue (cf. ci-dessous) — un `µgame:resync` pose aussi la nouvelle baseline **méta**.

### Deux onglets, une identité — baseline par CONNEXION

`def.deltas` suit la dernière vue (et la dernière méta) envoyée **par connexion**, jamais par identité de joueur : si le **même** compte est ouvert dans deux onglets sur le **même** siège, chacun a sa propre baseline de delta. Un `µgame:resync` de l'un (au retour d'un onglet en arrière-plan, par exemple) ne fait donc **jamais** sauter de trame à l'autre — chacun continue de recevoir ses propres deltas, indépendamment de ce que l'autre onglet vient de resynchroniser.

### Clés à point

Le chemin `p` d'une opération de delta est une chaîne à **points** (`'entites.e3.x'`, jamais échappés). Une clé de votre vue qui contient elle-même un point (un pseudo `'jean.dupont'`, une adresse `'127.0.0.1'`) ne s'écrit pas dans un tel chemin : l'objet qui la porte part **en bloc** (`{ p: 'scores', v: {…} }`), et à la racine de la vue, c'est la vue complète qui part. Le store du client reste juste, mais chaque changement de cet objet coûte l'objet entier : pour un dictionnaire qui change souvent, un id opaque (`e3`) reste préférable.

`deltas` est **orthogonal** à `tick` — utilisable aussi bien en mode tour par tour événementiel (`tick: 0`, un état qui change rarement mais gagne quand même à ne transmettre que la différence) qu'en mode action.

---

<a id="zones-interet"></a>
## 12. Les zones d'intérêt

Pour un monde qui dépasse la poignée d'entités (une arène à 50 joueurs, une carte ouverte…), envoyer À **chaque** joueur la position de **tout le monde** gaspille de la bande passante pour des entités hors de vue. `def.space: { cell }` déclare un index spatial **optionnel** — un simple **utilitaire**, sans magie imposée : c'est votre `def.simulate`/`def.view` qui décide quand et comment s'en servir.

```civet
app.game('arene', {
  tick:  20
  space: { cell: 100 }                # taille de cellule (mêmes unités que vos x/y) — grille CARRÉE

  state: (game)-> { entites: {} }

  simulate: (game, dt)->
    for id in Object.keys(game.state.entites)
      ent = game.state.entites[id]
      game.space.set(id, ent.x, ent.y)   # à vous de tenir l'index à jour à chaque déplacement

  view: (game, player)->
    moi = game.state.entites[player.id]
    return { entites: {} } unless moi
    voisins = game.space.query(moi.x, moi.y, 300)   # rayon 300 — mêmes unités que `cell`
    entites = {}
    for id in voisins
      entites[id] = game.state.entites[id]
    { entites }

  moves: {}
})
```

`game.space` (`null` si `def.space` absent) expose trois méthodes : `.set(id, x, y)` pose ou déplace une entité (retire de son ancienne cellule si besoin, no-op si elle reste dans la **même** cellule), `.remove(id)` la retire, `.query(x, y, rayon)` renvoie les ids dans le carré de cellules couvrant ce rayon — filtré finement à la distance de Tchebychev (`max(|dx|,|dy|)`, pas un cercle euclidien, cohérent avec le balayage grossier en cellules carrées). Coût de `.query()` proportionnel aux **cellules** couvertes, jamais au nombre total d'entités.

> ⚠️ **`.query()` face à une entrée invalide.** Des coordonnées/un rayon **non finis** (`Infinity`, `NaN` — typiquement un rayon venu tel quel d'un client sans validation applicative) rendent un tableau **vide** + un avertissement (au plus une fois par partie), jamais une exception ni un blocage. Un rayon **fini** mais démesuré est en plus **plafonné** en interne (nombre de cellules parcourues borné) — résultat potentiellement partiel plutôt qu'un balayage sans fin.

> ⚠️ **Limite — non repeuplé après restauration.** `game.space` est un index **dérivé**, jamais sérialisé par la persistance (§8) : une partie restaurée depuis `load()` repart avec un `game.space` **vide**, même si `game.state` contient déjà des positions. À votre jeu de le repeupler lui-même (typiquement au premier `simulate`/`view` qui suit une reprise, en rappelant `.set()` pour chaque entité de `game.state`) — aucune magie de repopulation automatique ici.

---

<a id="netcode"></a>
## 13. Le réseau des jeux d'action (netcode)

Le mode action ([§10](#mode-action)) diffuse l'état à la cadence du tick — parfait en local, mais un vrai aller-retour réseau (100-200 ms n'a rien d'exceptionnel) expose deux symptômes très reconnaissables : les entités des **autres** sautent d'un tick à l'autre, et un tir qui semblait bien ajusté **rate** quand même. Cette section couvre trois techniques **client**/**serveur** pour vivre avec cette latence sans la faire disparaître — interpolation, prédiction, compensation de lag — puis un **mode de partie** entier, le lockstep déterministe, pour les jeux où l'autorité serveur classique ne convient pas.

| Technique | Où | Symptôme réglé | Module runtime |
|---|---|---|---|
| Interpolation — `µ.interp` | Client, entités **distantes** | Le mouvement saute | `'interp'` |
| Prédiction — `µ.predict` | Client, SA **propre** entité | La réponse au clavier accuse la latence | `'predict'` |
| Compensation de lag — `def.history` | Serveur | Le tir rate | déjà inclus dans `'game'` |
| Lockstep — `def.mode:'lockstep'` | Serveur + client | Coût réseau d'un monde à beaucoup d'entités déterministes | `'lockstep'` + `'det'` |

### Le problème — 200 ms, et ça se voit

`µgame:state` part une fois par tick ([§10](#mode-action)) — à 15-20 Hz, c'est déjà 50-65 ms entre deux trames **sans** compter le réseau. Ajoutez un aller-retour de 200 ms (une connexion mobile, un pair loin géographiquement) et deux choses se voient à l'œil nu :

- **Le mouvement saute.** `game.state.entites[id]` affiché tel quel avance par à-coups : la position reste figée entre deux trames puis **saute** à la valeur suivante — d'autant plus visible que le tick est lent.
- **Le tir rate.** Le tireur vise la position qu'il **voit** — déjà vieille du temps de trajet aller (son propre rendu) — puis son tir met un aller-retour **entier** à atteindre le serveur, qui compare (naïvement) contre la position **courante**, déjà avancée depuis. Une cible qui bouge à seulement 100 px/s peut ainsi se décaler de 20-40 px entre ce que le tireur a visé et ce que le serveur valide.

Les techniques qui suivent répondent chacune à UN symptôme précis : l'interpolation répare le premier (visuel, sur les entités **distantes**) ; la prédiction répare l'input lag local (pas un symptôme visible chez l'adversaire, mais chez **soi**) ; la compensation de lag répare le second (le tir).

### Interpolation à tampon — `µ.interp`

Sur les entités **distantes** (celles des autres joueurs), affichez un peu dans le passé plutôt que la dernière valeur brute reçue — le mouvement redevient continu au prix d'un léger retard assumé. `µ.interp` (module runtime `'interp'`, cf. [§9](#configuration)) se pose **par-dessus** `sock.game()` :

```civet
game = sock.game('arene', { code: true })
$view   = µ.interp(game, { fields: ['entites'], delay: 2 })   # 2 périodes de retard (défaut)
```
```html
{for id, e in $view.entites}
  <@entity x={e.x} y={e.y}>
{end}
```

`fields` liste les clés de `game.state` qui sont des **dicts** `{id: entité}` (la forme de `def.view`, cf. [§5](#la-vue)) — **seules** ces clés sont interpolées ; le reste (statut, phase, tour…) se lit directement sur `game.state`. `delay` (en **périodes**, défaut 2) fixe l'ancienneté affichée : `µ.interp` mesure **lui-même** la période réseau (moyenne glissante des écarts d'arrivée) — rien à deviner en millisecondes. Un trou d'arrivée (paquet perdu, `def.deltas` sans changement) **extrapole** sur la vélocité mesurée pendant ~1 période, puis **gèle** plutôt que de projeter indéfiniment. Seuls les champs **numériques** sont lissés (lerp) ; le reste (chaînes, booléens…) recopie la valeur la plus récente — v1 volontairement simple, pas d'angles (cf. [§14](#limites)).

Écrit dans un composant, `µ.interp` s'arrête seul à la destruction de ce composant (sa boucle d'images et ses abonnements à la partie) et repart s'il revient dans la page. Ailleurs (un module, un magasin), appelez `$view.stop()` quand le miroir ne sert plus ; arrêté ainsi, il ne repart jamais.

> 🔗 Besoin de lisser un simple dictionnaire de positions, sans les autres mécaniques de cette section ? La recette générique `µsmooth` ([§7](#le-client)) suffit toujours. `µ.interp` est la version bâtie spécifiquement pour `sock.game()` : elle mesure sa propre période, expose un miroir dédié aux champs déclarés, extrapole puis gèle plutôt que de simplement lisser vers la dernière valeur connue.

### Prédiction du mouvement propre — `µ.predict`

Sur VOTRE **propre** entité (jamais celle des autres), appliquez chaque intention **localement**, avant même l'aller-retour serveur — les touches répondent immédiatement, quelle que soit la latence :

```civet
appliquerDeplacement = (state, nom, p)->    # DOIT être la MÊME logique que def.intents.bouger
  return unless nom == 'bouger'             # côté serveur — cf. fichier partagé, note ci-dessous
  state.moi.x += p.dx
  state.moi.y += p.dy

game = sock.game('arene', { code: true })
$moi   = µ.predict(game, { fields: ['moi'], apply: appliquerDeplacement })

game.move('bouger', { dx: 4, dy: 0 })   # inchangé pour l'appelant — µ.predict enveloppe .move
```

> ⚠️ **`apply` doit être la même logique que `def.intents` côté serveur.** Un désaccord entre les deux — même minime (un clamp oublié, un ordre d'opérations différent) — fait **diverger** le fragment local de la vérité serveur à chaque frame, jusqu'à la prochaine réconciliation. Mettez cette fonction dans un fichier **partagé**, importé des deux côtés (`@import`, des deux côtés — composant ET fichier serveur, cf. [23 · MJS-WS §13](23-mjs-ws.md#civet-entry)).

Chaque `game.move()` enveloppé reçoit un numéro `_n` croissant, glissé dans le payload réseau ; le serveur le retire avant `def.intents[move]` et reflète le **dernier** `_n` appliqué dans une méta de trame `_ack` (**jamais** dans la vue du jeu). À chaque `µgame:state` : le fragment prédit repart de l'état **serveur** des champs déclarés, purge de sa file d'attente tout `_n <= _ack`, puis **rejoue** `apply` sur ce qui reste — une correction serveur (un clamp, un refus) n'est donc jamais « moyennée », le fragment **snappe** à la vérité puis rejoue par-dessus.

Un coup **refusé** — hors ligne (`offline`), coupure, refus du jeu — n'atteindra jamais le serveur : il sort aussitôt de la file des non-confirmés et le fragment repart de l'état serveur ; l'appelant reçoit le refus tel quel.

> ⚠️ **Limite connue — mélanger intentions et moves classiques sur la même poignée.** Seules les **intentions** (`def.intents`) reçoivent un `_ack` — un move classique (`def.moves`) enveloppé n'en reçoit jamais. Filet v1 : tant qu'**aucune** trame de cette partie n'a jamais porté `_ack`, la réconciliation vide la file en entier à chaque frame plutôt que de rejouer (correct pour un jeu 100 % moves classiques) — mais dès qu'un `_ack` est vu une 1ʳᵉ fois, ce filet se désarme **pour toujours**. Un jeu qui mélange les deux sur la même poignée prédite reste hors-scope v1 (cf. [§14](#limites)).

### Compensation de lag — `def.history` + `game.rewind`

Le tir se valide **côté serveur** — mais pas forcément contre la position **courante** : `def.history` déclare un tampon circulaire d'instantanés, `game.rewind` retrouve celui du passé, et le jeu y valide son tir **comme** SI aucun aller-retour n'avait eu lieu :

```civet
app.game('arene', {
  seats: 8
  tick:   20
  history:  { ticks: 40, interp: 100 }        # tampon ~2 s d'historique (extracteur par défaut : def.space)
  space:  { cell: 100 }

  state: (game)-> { entites: {} }
  moves: {}

  intents: {
    tirer: (game, player, p)->           # p = { cibleId, x, y } — la visée du tireur
      touché = game.rewind game.timeSeenBy(player), (positions)->
        target = positions[p.cibleId]
        target? and Math.hypot(p.x - target.x, p.y - target.y) <= 20
      game.send('touche', { par: player.id, target: p.cibleId }) if touché
  }
})
```

`def.history.ticks` fixe la profondeur du tampon (en **ticks**, pas en ms) ; `def.history.extract(game)` produit l'instantané léger `{id: {x, y}}` poussé à **chaque** tick — omis, il retombe sur un snapshot de `def.space` ([§12](#zones-interet)) si déclaré, sinon la déclaration lève une erreur claire. `def.history.interp` (ms, défaut `2 × period de tick`) est le retard de rendu que VOUS **déclarez** avoir côté client — gardez-le cohérent avec le `delay` réellement passé à `µ.interp` côté client : ce sont deux nombres séparés qui décrivent la **même** idée.

`game.rewind(instantMs, fn)` retrouve l'entrée la plus proche de `instantMs` (borné : trop ancien → la plus vieille entrée dispo, futur → l'entrée du tick courant) et passe à `fn` une **copie gelée** (`Object.freeze`) — jamais l'original mutable du tampon. Un `instantMs` qui n'est pas un nombre fini (`undefined`, `NaN` — horodatage client absent) lève une erreur claire, sans appeler `fn`. `game.timeSeenBy(player)` calcule l'instant que CE joueur voyait au moment d'agir : `Date.now() − (latence + def.history.interp)`, la latence étant lue sur `client.latency` (MJS-WS, réservoir ping/pong du 1ᵉʳ client connecté de ce siège) — `null`/déconnecté replient sur `0`, jamais un throw pour une mesure simplement absente.

> ⚠️ **`client.latency` a besoin d'un heartbeat client court.** `µsocket(url, opts)` n'hérite **pas** le `heartbeat` du serveur — sans le redéclarer explicitement côté client (`heartbeat: 300` par exemple), le heartbeat du client reste sur son défaut (15 000 ms) et `client.latency` ne se met À **peu près jamais** à jour dans la durée de vie réaliste d'un tir : `timeSeenBy` retombe alors sur `0 + def.history.interp` seulement (cf. [§14](#limites), constaté au banc de la démo ci-dessous).

### Le mode déterministe — lockstep

Une alternative **radicale** aux trois techniques ci-dessus : plutôt que masquer la latence, `def.mode: 'lockstep'` la rend **équitable** — le serveur NE **simule rien**, il se contente de regrouper et diffuser les **ordres** (chaque `µgame:move`) tick par tick, **identiques** pour tous ; chaque client simule **exactement** la même partie à partir des mêmes ordres, dans le même ordre.

```civet
app.game('rts', {
  seats: 2
  tick:   20
  mode:   'lockstep'
  moves:  {}                                # requis même vide — aucun coup n'est de toute façon exécuté ici
  onDivergence: (game, info)-> µ.log("divergence au tick #{info.tick}")
  lockstepJournal: { maxOrderBytes: 2048, maxBytes: 16777216 }   # bornes du journal d'ordres — ici leurs valeurs par défaut
})
```

Liste **fermée** d'interdits avec `mode: 'lockstep'` : `state`/`view`/`deltas`/`intents`/`simulate`/`space`/`history` — déclarer l'un d'eux lève une erreur claire à l'`app.game(...)`. `tick` devient obligatoire (> 0, cadence de regroupement des ordres) ; `onDivergence` n'a de sens QU'en lockstep (erreur sinon).

`lockstepJournal`, même contrainte de mode, borne le journal d'ordres — renvoyé **en entier** à chaque `µgame:start`/`resync` et à chaque sauvegarde. Trois clés facultatives, chacune un entier ≥ 1, les tailles en octets du JSON ; une autre valeur qu'un objet, une clé inconnue ou une valeur qui n'est pas un entier ≥ 1 lève une erreur claire à l'`app.game(...)` :

- `maxOrderBytes` — **2 048 octets** (2 Ko) par défaut : un ordre (`{ player, move, p }`) plus gros est refusé au joueur (`µ:ack` d'erreur « ordre trop volumineux ») et n'entre pas dans le journal ;
- `maxBytes` — **16 777 216 octets** (16 Mo) par défaut : quand le tick suivant ferait dépasser cette taille au journal, la partie **se termine** — `µgame:end` avec `result: { ended: true, reason: 'journal-full' }` pour tous les joueurs, `hooks.onEnd` reçoit le même résultat. Ce dernier tick n'est ni journalisé ni diffusé : chaque joueur garde l'état du dernier tick reçu, le journal n'est jamais tronqué. Repère : un tick vide pèse de 22 à 29 octets — sans aucun ordre, 16 Mo durent environ 8 h à 20 Hz et un peu moins de 3 h à 60 Hz ; chaque ordre ajoute sa propre taille. Une partie qui doit durer plus longtemps relève `maxBytes` ;
- `maxTicks` — aucun par défaut : anneau qui ne garde que les `maxTicks` derniers ticks (cf. « Limites v1 — honnêtement (netcode) » plus bas).

**Quand le choisir.** L'autorité serveur ([§3](#declarer-un-jeu)-[§12](#zones-interet), plus les trois techniques ci-dessus) **masque** la latence — le serveur reste la seule vérité, chaque client voit midi à sa porte mais le rendu reste fluide ; c'est le bon choix dès qu'un client ne doit **pas** voir à l'avance les décisions des autres (tir, main cachée), ou que la simulation n'est pas reproductible bit-à-bit (physique tierce, `Math.random` non maîtrisé). Le lockstep ne masque rien — le ressenti reste au rythme du tick, sans prédiction possible sur les actions des autres — mais coûte une **fraction** de la bande passante d'une diffusion d'état complet (les ordres sont minuscules comparés aux positions) : le bon choix pour un monde à beaucoup d'entités simulées **identiquement** partout (**rts**, wargame, replay compétitif).

Côté client, `µ.lockstep` (module `'lockstep'`, requiert aussi `'det'` ci-dessous, cf. [§9](#configuration)) déroule les ordres reçus :

```civet
game = sock.game('rts', { code: true })
$state  = µ.lockstep(game, {
  state0:     -> { unites: {} }
  apply: (state, ordre)->
    return unless ordre.move == 'bouger'
    state.unites[ordre.player] ?= { x: 0, y: 0 }
    u = state.unites[ordre.player]
    u.x += ordre.p.dx
    u.y += ordre.p.dy
  every: 30
})

game.move('bouger', { dx: 4, dy: 0 })   # émet l'ORDRE — inchangé, µ.lockstep n'enveloppe PAS .move
```

`µgame:orders { tick, orders }` arrive tick par tick, appliqué en séquence **stricte** (un tick en avance sur `nextTick` est mis en réserve, jamais un saut). La graine n'est jamais choisie par le jeu : `µgame:start`/`resync` la dérive **déterministiquement** de l'id de partie (hash FNV-1a) et la porte avec le **journal** complet des ordres depuis la genèse — `$state.rng` (un `µ.random(seed)` **partagé**) est prêt dès l'assise. La rejouabilité est donc **gratuite** : à la 1ʳᵉ assise comme à toute résync après coupure, le client **rejoue** le journal reçu avant de reprendre le direct — restaurer une partie côté serveur, c'est juste renvoyer le journal.

**Déterminisme cross-moteur — `µ.random`/`µ.det`.** `Math.random()` est banni (état global partagé, jamais reproductible) ; `Math.sin`/`cos`/`atan2` ne sont **pas** garantis identiques bit-à-bit d'un moteur JS à l'autre (fonctions transcendantes non spécifiées au bit près) — deux clients lockstep sur des moteurs différents pourraient calculer des trajectoires légèrement différentes et diverger sans qu'aucun bug applicatif ne soit en cause :

```civet
rng = µ.random(42)                     # graine → générateur INDÉPENDANT (jamais un état global)
de  = rng.int(1, 6)                    # entier BORNÉ INCLUSIF [1, 6] — un dé à 6 faces

angle = µ.det.atan2(dy, dx)            # RADIANS, même signature que Math.atan2 — déterministe cross-moteur
rayon = Math.sqrt(dx * dx + dy * dy)   # sqrt reste NATIF — déjà déterministe IEEE 754
```

`µ.det.sin/cos/atan2` n'utilisent que `+`/`-`/`×`/`÷`/`Math.imul`/`Math.floor` — déjà déterministes IEEE 754 — pour une précision **mesurée** d'environ 0,16 % d'erreur absolue max (sin/cos) et 0,086° (atan2) : largement suffisant pour une visée ou une orientation de jeu, pas pour un calcul scientifique. `Math.sqrt` (et les opérateurs `+ - × ÷`) restent volontairement **natifs** — déjà déterministes, aucune raison de les réapprocher.

**Détecter la divergence.** Toutes les `every` ticks (60 par défaut), chaque client hache son état (FNV-1a de `JSON.stringify(state)`) et l'annonce en `µgame:hash` — **fire-and-forget**, jamais de `µ:ack`. Le serveur ne retient **pas** le premier hash vu comme référence — durcissement anti-triche par **quorum** : la référence d'un tick ne se fige **que** quand un hash atteint la majorité absolue des sièges courants, un siège qui rapporte deux hash différents pour le même tick est en plus flaggé suspect immédiatement (auto-contradiction). Limite assumée du quorum à **deux** sièges exactement : la majorité absolue vaut 2, un désaccord 1 contre 1 ne fige donc jamais de référence — en duel, seule l'auto-contradiction d'un siège est détectable (à 3 sièges et plus, le quorum tranche). Un écart identifié déclenche `def.onDivergence(game, {tick, suspects, reason})` côté serveur ET diffuse `µgame:event` de type `'divergence'` à tous les clients — jamais deux fois pour le même siège/tick. Le jeu **décide** de la suite (log, resync forcé en renvoyant le journal, fin de partie) — rien d'automatique n'est imposé.

### Les chiffres de la démo

Mesurés sur un mini-jeu à 2 joueurs (tick 15 Hz, 200 ms d'aller-retour artificiel injecté par un shim `WebSocket`, 2 passes indépendantes) :

| Mode | Saut inter-frame moyen | Taux de touche |
|---|---|---|
| **Sans** netcode (position brute, tir sur position courante) | ≈ 6,0 px/échantillon | 0 % (0/8-9 tirs) |
| **Avec** netcode (`µ.interp` + `µ.predict` + `rewind`) | ≈ 1,5 px/échantillon | 100 % (8-9/8-9 tirs) |

Le mouvement distant devient ~4× plus lisse (saut divisé), et le tir passe de systématiquement raté à systématiquement touché — l'écart moyen entre la visée et la position validée serveur tombe d'environ 25 px à moins de 2 px. Reproductible : même sens de gain aux deux passes.

### Limites v1 — honnêtement (netcode)

- **`µ.interp` est scalaire — pas d'angles.** Seuls les champs numériques sont lerpés linéairement ; un champ d'**angle** (orientation, direction du regard) lerpé naïvement traverse le mauvais côté du cercle près de ±180°. Gérez les angles en delta courte-voie côté vue, ou n'interpolez pas ce champ.
- **Le journal lockstep est borné, jamais élagué en silence.** Aucun instantané d'état n'existe : le client rejoue le journal depuis le tick 1, le serveur ne peut donc pas en retirer le début sans fausser l'état d'un joueur. D'où les deux bornes par défaut de `lockstepJournal` (2 Ko par ordre, 16 Mo pour le journal, cf. plus haut) et une fin de partie `'journal-full'` plutôt qu'une troncature. En opt-in, `def.lockstepJournal: { maxTicks }` plafonne en plus le journal en **anneau** (éviction FIFO des ticks les plus anciens à chaque tick clos), plafond aussi appliqué à la restauration depuis la persistance. Trade-off honnête : un client qui a raté plus de `maxTicks` ticks (déconnexion longue) reçoit à la reconnexion un journal **tronqué** — la resync déterministe depuis le tick 1 n'est alors plus possible pour lui ; c'est la détection de divergence par hash (quorum, ci-dessus) qui finit par le signaler via `onDivergence`, aucun snapshot d'état de secours n'existe à ce jour. Le client détecte et signale ce journal tronqué **dès** le resync — sans attendre le quorum de hash : une erreur dans sa console (« journal tronqué au resync (tick 4 reçu, tick 1 attendu) — resync déterministe impossible, état local potentiellement faux ») et un événement `'divergence'` sur le même canal que la vraie divergence serveur (`game.on('event', fn)` reçoit `{ game, type: 'divergence', p: { tick, expected, reason: 'journal-truncated' } }`), propre à ce client, jamais envoyé au serveur ; le rejeu continue ensuite avec ce qu'il a reçu.
- **`µ.predict` : mélanger intentions et moves classiques sur la même poignée reste hors-scope** (cf. l'encart ⚠️ plus haut) — le filet v1 se désarme définitivement dès le premier `_ack` vu.
- **`client.latency` suit le heartbeat client, pas une mesure indépendante.** Redéclarez `heartbeat` dans les opts de `µsocket` (pas seulement côté serveur) pour une latence utilisable par `timeSeenBy` — un heartbeat par défaut (15 s) la laisse bien trop obsolète pour un jeu d'action ; visez 200-400 ms.

---

<a id="limites"></a>
## 14. Limites v1 — honnêtement

- **Intentions et simulation synchrones.** `def.intents`/`def.simulate` ([§10](#mode-action)) doivent faire leur travail directement — une fonction `async` « marche », mais la boucle de tick ne l'attend pas : ce qu'elle change après son premier `await` part au tick suivant, et un rejet est seulement journalisé. Un coup classique (`def.moves`), lui, peut être asynchrone ([§4](#les-coups)).
- **Appli anonyme = pas de reprise.** Sans `opts.auth` posant une identité **stable** côté MJS-WS, chaque reconnexion change d'`id` (repli sur l'id de connexion, préfixé `anon:` : un compte, quel que soit son id, ne prend jamais l'identité d'un anonyme ; un `identity.id` objet sans conversion en chaîne, qui donnerait `[object Object]` pour tous, compte aussi comme une absence d'identité) — `µgame:resync` ne retrouve alors **jamais** un siège après coupure. Une identité stable est le prix de la reprise.
- **`µgame:*` n'est jamais binaire.** Deltas ([§11](#deltas)) et zones d'intérêt ([§12](#zones-interet)) réduisent le volume, mais restent 100 % JSON — le protocole interne de MJS-Server ne passe jamais par `µschema` ([23 · MJS-WS §3.1](23-mjs-ws.md#µschema)) : ses trames (`view`/`delta` en particulier) ont une forme **dynamique**, propre à chaque jeu, que le registre à champs **fixes** de `µschema` ne sait pas décrire. Un état qui doit vraiment voyager en binaire se pousse en messages **custom**, à côté de `µgame:*`, via `app.schema(...)` — cf. le banc mesuré ci-dessous.
- **`ws.codec: 'binary'` strict casse tout `sock.request()` — donc tout MJS-Server.** L'API cliente de MJS-Server n'envoie **que** des requêtes id-bearing (`µgame:play`/`move`/`leave`/`resync`, [§15](#protocole)) — or l'enveloppe binaire de `µschema` ne porte **aucun** id de corrélation (une requête reste **toujours** en JSON côté client, cf. [20 · Temps réel](20-temps-reel.md) §7.4 « pub/sub seulement »), et le mode **strict** rejette en retour toute trame **texte** applicative hors `µ:`, id ou pas. Constat vérifié directement : en `codec: 'binary'`, `sock.request('µgame:move', …)` expire systématiquement (jamais de `µ:ack`) — `ws.codec: 'binary'` est donc **incompatible** avec MJS-Server en l'état ; réservez-le à une app MJS-WS pure, entièrement pub/sub.
- **Un `onJoin` asynchrone retarde la partie, en file publique.** L'appariement attend la fin de tous les `onJoin` du groupe avant d'annoncer la partie ([§6](#appariement)) : une `Promise` qui ne se termine jamais laisse le groupe en suspens — ses joueurs ne reçoivent rien et la requête de celui qui l'a complété ne répond pas. MJS-Server n'impose aucun délai : bornez vous-même vos vérifications. Un refus par `onJoin` défait le groupe sans bruit pour les autres joueurs, voir [§6](#appariement) ; en partie privée (`code`), le refus est net, cf. [§4](#les-coups).
- **Mode spectateur (ajouté par la couche anti-triche).** `µgame:play { spectator: true }` (par code de partie, le type demandé doit correspondre à celui de la partie visée par ce code) rejoint sans occuper de siège ; le spectateur reçoit `µgame:state` avec une vue **sûre** (`def.spectatorView(game)`, sinon `view(game, null)`, sinon `{}` + avertissement — jamais l'état brut), tout coup de sa part est rejeté ; si sa vue lève à l'entrée, la requête échoue et la connexion n'est pas inscrite. `µgame:end` et `µgame:left` lui sont **aussi** relayés (même charge que celle des sièges — `result`/`seat` ne sont pas des vues, aucun filtrage `spectatorView` dessus) ; une partie non finie qui disparaît le prévient aussi : la fin envoyée aux sièges quand elle est annulée (`replaced`, `seat-expired`), `µgame:end { result: { cancelled: true, reason: 'abandoned' } }` quand elle est fermée faute de joueurs (dernier siège parti d'une table jamais complète, grâce `emptyTtl` échue) ; `µgame:seat` (roster), lui, reste réservé aux sièges. Limite v1 : l'entrée se fait par code (pas via la file publique).
- **Le banc mesuré.** Mini-monde réaliste (30 entités dont 4 mobiles, 15 Hz, 2 clients) : ≈ 63 000 octets/s en JSON vue complète, ≈ 19 200 en messages `µschema` binaires par entité (≈ 0,30×), ≈ 8 100 en deltas JSON (`def.deltas: true`, **même** monde, ≈ 0,13×). Sur CE monde, ne transmettre que ce qui a changé bat l'encodage binaire de l'état entier — le rapport dépend directement de la part d'entités qui bougent réellement à chaque tick.

---

<a id="protocole"></a>
## 15. Annexe — le protocole `µgame:*`

Comme le protocole `µ:` de MJS-WS ([20 · Temps réel](20-temps-reel.md)), invisible en usage normal — utile pour déboguer, ou pour implémenter un client dans un autre langage. Préfixe `µgame:` **réservé** : `app.serve`/`app.on` d'un type qui commence par `µgame:` lève une erreur côté appli hôte.

### Client → Serveur (requêtes, `µ:ack` en retour)

| Trame | Charge `p` | Réponse (`µ:ack`) |
|---|---|---|
| `µgame:play` | `{ type, code? }` | `{ queue: n }` (file, pas encore assis) OU `{ game, seat, view, phase, turn, seq, code }` (assis) |
| `µgame:move` | `{ game, move, p? }` | `{ ok: true, result }` — throw interne ou du move → `µ:ack` d'erreur |
| `µgame:leave` | `{ game }` ou `{ type }` | `{ ok: true }` — vide le siège (≠ déconnexion, qui le garde) ; `{ type }` sans `game` : quitte la file publique de ce type |
| `µgame:resync` | `{ game }` | `{ game, seat, view, phase, turn, seq, code }` — vue fraîche **complète** |
| `µgame:hash` | `{ game, tick, h }` | **Aucune** — **fire-and-forget**, jamais de `µ:ack` (mode `'lockstep'` seul, [§13](#netcode) : annonce périodique du hash d'état pour la détection de divergence) |

`code` dans `µgame:play` est discriminé par **type**, jamais par sa seule présence : absent = file publique, `true` = crée une partie privée neuve, chaîne = rejoint ce code (§6).

### Serveur → Client (poussées, sans ack)

| Trame | Charge `p` | Quand |
|---|---|---|
| `µgame:state` | `{ game, view, phase, turn, seq }` (défaut) ou `{ game, phase, turn, seq, delta }` (`def.deltas:true`, [§11](#deltas)) | à chaque mutation, SA vue par joueur, groupée par microtâche (tour par tour, `tick:0`) — ou une fois par tick (mode action, [§10](#mode-action)) |
| `µgame:event` | `{ game, type, p }` | `game.send(type, p)` — libre, applicatif |
| `µgame:seat` | `{ game, seatCount, seats }` | roster, à chaque changement (`seats: [{seat,connected}\|null, …]`) |
| `µgame:start` | `{ game, seat, view, phase, turn, seq, code }` | 1ʳᵉ fois que `seats` est atteint — aux sièges qui n'ont pas eux-mêmes déclenché la complétion |
| `µgame:end` | `{ game, result }` | `game.end(result)`, ou annulation (`result: {cancelled:true, reason}`, raison `'seat-expired'` ou `'replaced'`, §6 ; `'abandoned'` aux seuls spectateurs, quand une partie non finie est fermée faute de joueurs), ou entrée refusée (`result: {refused:true, reason:'join-refused'}`, au seul refusé, §4 et §6 ; pour un joueur de la file publique, la trame porte en plus `type` et `queue: true`), ou journal lockstep plein (`result: {ended:true, reason:'journal-full'}`, [§13](#netcode)) |
| `µgame:left` | `{ game, seat }` | départ volontaire (`µgame:leave`) d'un **autre** siège |
| `µgame:orders` | `{ game, tick, orders }` | mode `'lockstep'` seul, [§13](#netcode) : à **chaque** tick clos, `orders: [{player, move, p}, …]` (groupe éventuellement vide — le tick lui-même est l'horloge commune) |

---

*Voir aussi : [20 · Temps réel](20-temps-reel.md) pour le client `µsocket` de base, [23 · MJS-WS](23-mjs-ws.md) pour le transport qui porte tout ça.*
