# 16 · Cycle de vie

> 📚 Tuto interactif correspondant : **Chapitre 2 — Reffets** (les hooks de cycle de vie y sont présentés comme alternative explicite à `µeffect`, le reffet). Les encarts 🎓 *Pour débutants* dépliables donnent l'explication pas-à-pas ; le corps de la page reste la référence dense.

Un composant MJS a une vie : il est **créé**, **monté** dans le DOM, parfois déplacé (donc déconnecté puis reconnecté), enfin **détruit**. Six hooks permettent de brancher du code sur ces moments, en **runes µ** — la rune, suivie directement du callback `->` — comme le reste des runes du framework. À la différence d'une rune telle que `µraw`/`µurl` (valable aussi dans une expression du gabarit), ces six hooks, eux, ne s'écrivent que **dans le `<script>`** du composant : les citer dans une interpolation `{…}` ou un attribut lève une erreur de compilation qui oriente vers le `<script>`.

| Hook | Quand | Combien de fois |
|------|-------|-----------------|
| `µmount ->` | après le **premier** rendu, nœud attaché au DOM ; de nouveau si le composant, détruit, est remis dans la page | 1× par vie |
| `µawake ->` | à **chaque** arrivée dans la page, la **première ouverture comprise**, **avant** `µmount` | ≥ 1× |
| `µsleep ->` | à **chaque** déconnexion du DOM | ≥ 0× |
| `µdestroy ->` | au **teardown définitif** (nettoyage final) | 1× par vie |
| `µurlChange (path, params)->` | à chaque navigation (composant *router-aware*) | ≥ 0× |
| `µfailed (err, reset)->` | quand un **descendant** plante (frontière d'erreur) | ≥ 0× |

> 💡 **Pourquoi µ et pas `@` ?** Le préfixe dit qui parle : `µ` = **le framework** (le hook est une API MJS), `@` = **votre instance** (`@clear = ->` est une méthode à vous, `@_interval` un rangement à vous). Les noms `mount`, `awake`, `sleep`, `destroy`, `urlChange`, `failed` sont donc des noms de méthodes **libres** — `@mount = ->` est une méthode utilisateur ordinaire, sans lien avec le hook. Écrire `@mount ->` (sans `=`) déclenche une **erreur de compilation** explicite qui oriente vers `µmount ->`.

> ⚠️ **Un seul hook de chaque nom par composant.** Écrire deux fois `µmount ->` (ou tout autre hook de ce tableau) ne cumule pas les deux corps : la compilation refuse le fichier et nomme le hook en double — un seul corps par hook, la logique commune se factorise dans une fonction appelée par ce corps.

> **Écrit dans une fonction**, un crochet se range sur le composant dont le `<script>` le porte : `$armer = -> µdestroy -> …`, rangée dans l'état et appelée `$armer()`, prépare le nettoyage du composant.

> ⚠️ **Un nom de crochet mal écrit est refusé.** `µmounted ->`, `µonDestroy ->` ou `µdestory ->` ne sont pas des crochets : la construction s'arrête à la ligne de la faute et propose le crochet le plus proche (`µmount`, `µdestroy`). Seuls les noms proches d'un des six crochets, suivis d'une fonction, sont jugés ainsi ; les autres runes (`µeffect ->`, `µevery 1000, ->`) ne sont pas concernées.

## `µmount` — initialisation unique

Exécuté juste après le premier rendu, **une fois par vie** du composant : le Shadow DOM est en place, toutes les références `@this=!{ref}` (variables **sans `$`** — cf. [Directives DOM](09-directives-dom.md)) sont résolues, le nœud est mesurable (`getBoundingClientRect`, etc.). C'est l'endroit pour brancher une librairie tierce ou un observateur sur un nœud précis.

Comme `µeffect` et `@attach`, **retourner une fonction l'enregistre comme nettoyage** : appelée une fois, à la destruction du composant — jamais à `µsleep`.

**Remis dans la page après sa destruction, le composant rejoue `µmount`.** Un composant qui quitte la page pour de bon est détruit à la microtâche suivante : le nettoyage de `µmount` et `µdestroy` tournent. Si votre script a gardé le nœud et le remet plus tard dans la page (panneau gardé en mémoire, défilement virtuel, déplacement après un `await`), c'est la même instance, son état gardé, et une nouvelle vie commence : `µawake`, puis `µmount`, qui repose ses nettoyages. Un simple déplacement (retiré puis remis dans le même tour) et une page que le cache du routeur garde en mémoire ne sont pas des destructions : `µmount` n'y rejoue pas. Un composant qui n'a rien à défaire (aucun nettoyage, pas de `µdestroy`) n'est pas détruit à sa sortie : il garde son montage, et `µmount` ne rejoue pas à son retour.

```html
<script>
  canvas = null

  µmount ->
    context = canvas.getContext('2d')
    ro = new ResizeObserver(resize)
    ro.observe(canvas)
    -> ro.disconnect()
</script>

<canvas @this=!{canvas}></canvas>
```

> ℹ️ **Dans le rappel d'un observateur.** `new ResizeObserver(resize)` — comme `MutationObserver`, `IntersectionObserver` et `PerformanceObserver` — appelle `resize` avec **l'observateur** pour `this` : `@x` y lit l'observateur (`@disconnect()` l'arrête). De même, un écouteur posé à la main (`addEventListener`) reçoit l'élément et `setTimeout` la fenêtre : `@x` est toujours le `this` que donne l'appelant. Pour lire votre composant, écrivez `@@x` (`@@_shadow`, `@@largeur`). Détail : [Réactivité](03-reactivite.md).

```html
<script>
  resize = ->
    @@largeur = @@_shadow.querySelector('canvas').clientWidth   # @@x : votre composant
    @disconnect() if @@largeur > 0                              # @x : l'observateur, qu'on arrête
</script>
```

<details>
<summary>🎓 <b>Pour débutants</b> — pourquoi pas mettre ce code à la racine du <code>&lt;script&gt;</code>&nbsp;?</summary>

Le code écrit directement à la racine du `<script>` s'exécute dans le **constructeur** du composant : **avant** que le nœud ne soit dans la page. Conséquences : `canvas` n'existe pas encore (la référence n'est posée qu'au montage), le DOM n'est pas mesurable, et rien n'est nettoyé au démontage.

`µmount` règle ça : il diffère son corps jusqu'à ce que le composant soit *réellement* dans la page et rendu une première fois. C'est le « top départ » fiable de votre composant.

</details>

> ℹ️ **Ce que `µmount` écrit s'anime.** Une transition d'entrée (`@in`, `@transition`) ne joue jamais sur le **premier** rendu — sinon la page entière clignoterait au chargement. Mais `µmount` s'exécute *après* ce premier rendu : un état écrit là déclenche donc un rendu **suivant**, et les nœuds que ce rendu crée jouent leur transition d'entrée normalement. C'est ce qui permet d'animer l'apparition d'un contenu dès l'arrivée sur la page, sans avoir à marquer la transition `.global`. La même chose vaut pour le premier tir de [`µevery`](#µevery--répéter-en-partant-tout-de-suite), qui a lieu au montage.

> ℹ️ **Cascade de montage : l'enfant avant le parent.** Dans un arbre de composants imbriqués, le `µmount` d'un enfant s'exécute avant celui de son parent — chaque connexion au DOM programme son propre montage, et celle de l'enfant a lieu pendant que celle du parent est encore en cours. Utile pour un parent qui doit lire, dès son propre `µmount`, un état ou une réf déjà posée par ses enfants.

## `µdestroy` — nettoyage final

Appelé une fois par vie du composant, au démontage définitif (le composant quitte le DOM pour de bon : `{if}` qui passe à `false`, item retiré d'un `{for}`, changement de route). MJS nettoie **automatiquement** ses propres ressources — reffets (`µeffect`), abonnements aux stores, contextes, transitions en cours. `µdestroy` sert pour **ce que MJS ne connaît pas** : timers, `WebSocket`, listeners posés sur `window`/`document`.

```html
<script>
  µmount ->
    @timer = setInterval(tick, 1000)

  µdestroy ->
    clearInterval(@timer)
</script>
```

Équivalent au retour de `µmount` (ci-dessus) pour une ressource unique ; `µdestroy` reste préférable pour **regrouper** plusieurs nettoyages sans rapport entre eux dans un seul bloc.

> 💡 Pour ce cas précis — **un timer qui se répète** — la rune [`µevery`](#µevery--répéter-en-partant-tout-de-suite) fait les deux moitiés d'un coup, et tire dès le montage.

> 💡 Pour une ressource attachée à un nœud précis du template (lib tierce, observateur d'intersection), préférez la directive **`@attach`** (chapitre [Directives DOM](09-directives-dom.md)) : elle co-localise mise en place et nettoyage sur l'élément, et se rejoue à chaque apparition/disparition (utile sous un `{if}`).

## `µevery` — répéter, en partant tout de suite

Le couple `µmount` + `µdestroy` ci-dessus, c'est **le** motif du timer : poser un `setInterval` au montage, le couper au démontage, et ne pas oublier la seconde moitié. `µevery` fait les deux d'un bloc :

```html
<script>
  $message = ''

  µevery 2500, ->
    $message = tirerUnMessage()
</script>
```

Trois choses, dans cet ordre :

1. **le premier tir a lieu tout de suite**, au montage — pas au bout de 2 500 ms. C'est la différence avec un `setInterval` nu, qui laisse l'écran vide le temps du premier délai ;
2. ensuite, le corps est rejoué **toutes les `2500` ms** ;
3. au démontage définitif du composant, l'intervalle est **coupé automatiquement**. Rien à écrire.

Le corps n'est **pas** un reffet : il ne s'abonne à rien, ne relit rien. C'est le **tir** qui est périodique. Les écritures `$x` qu'il fait, elles, restent parfaitement réactives — l'écran suit.

`µevery` **rend une main d'arrêt**, pour les cas où la répétition doit cesser avant le démontage :

```html
<script>
  $reste = 10

  arreter = µevery 1000, ->
    $reste = $reste - 1
    arreter() if $reste is 0
</script>
```

> ⚠️ `µevery` se déclare à la **racine du `<script>`**, comme les hooks : elle s'accroche au montage du composant. Dans une interpolation `{…}` ou un handler, c'est une **erreur de compilation**.

### Les options

Entre le délai et la fonction, `µevery` accepte un **hash d'options**, facultatif — la forme courte ci-dessus ne change pas :

```html
<script>
  $etat = 'en cours'

  µevery 3000, pause: true, while: (-> $etat is 'en cours'), ->
    $etat = await sonderLaConversion()
</script>
```

| Option | Effet |
| --- | --- |
| `immediate: false` | Pas de tir au montage : le premier tir a lieu **après** le délai, comme un `setInterval` nu. |
| `times: n` | **n** tirs, puis arrêt automatique. Le tir du montage compte pour un. |
| `while: -> cond` | La condition est évaluée **avant chaque tir** : dès qu'elle est fausse, la répétition s'arrête et ce tir-là n'a pas lieu. |
| `pause: true` | Suspend la répétition quand le composant **quitte le DOM sans être détruit** (hibernation du cache de pages, déplacement d'un nœud), reprend à son retour. |
| `onStop: ->` | Appelé **une seule fois**, à l'arrêt — main d'arrêt, `times` épuisé, `while` tombé, démontage ou crash du composant (et de nouveau à l'arrêt suivant si le composant, remis dans la page après sa destruction, a relancé la répétition). C'est l'endroit où relâcher une ressource ou prévenir le serveur. |

`times` et `while` remplacent la main d'arrêt écrite à la main dans les deux cas courants — le compte à rebours et le sondage « jusqu'à ce que ce soit fini ».

Une **clé inconnue** (faute de frappe) est signalée dans la console, et une valeur du mauvais type retombe sur le défaut de sa clé : dans les deux cas le timer tourne quand même.

Le corps peut être **`async`** : un échec après un `await` part vers la frontière d'erreur du composant, exactement comme un échec immédiat. La condition `while`, elle, doit rendre un **booléen synchrone** — une fonction `async` rend une promesse, toujours vraie, ce qui ne s'arrêterait jamais ; MJS le signale et arrête la répétition.

> ⚠️ « Au démontage » veut dire **au démontage définitif**, comme le nettoyage de `µmount`. Une page mise en **hibernation** par le cache du routeur (elle quitte le DOM mais garde son état pour un retour instantané) n'est pas détruite : sans `pause: true`, son `µevery` **continue de tourner** jusqu'à l'éviction du cache.

> ℹ️ `pause: true` **reprend** la répétition, il ne la redémarre pas : la fraction de période déjà écoulée au moment de la mise en veille est perdue, et le retour dans le DOM ne provoque pas de tir de rattrapage.

> ℹ️ **Retiré, détruit, puis remis plus tard dans la page** (un nœud gardé par votre script : panneau gardé en mémoire, défilement virtuel, déplacement après un `await`) : la répétition qui tournait encore **repart** au retour, comme `µmount` — un tir au montage (sauf `immediate: false`), puis toutes les `délai` ms. Elle reprend là où elle en était : `times` continue son compte (jamais plus de *n* tirs au total), et `onStop`, déjà appelé à la destruction, le sera de nouveau à l'arrêt suivant. Une répétition **finie** (`times` épuisé, `while` tombé) ou arrêtée par sa **main d'arrêt** ne repart pas.

> ℹ️ Le délai est borné à **2 147 483 647 ms** (24,8 jours), la limite des minuteries du navigateur : au-delà, `Infinity` compris, la fonction tire au montage puis tous les 24,8 jours — un délai plus grand était ramené à 0 par le navigateur et la fonction tournait en boucle.

<details>
<summary>🎓 <b>Pour débutants</b> — pourquoi le premier tir est-il si important&nbsp;?</summary>

Un `setInterval(f, 2500)` n'appelle **jamais** `f` immédiatement : il attend 2,5 secondes, puis commence. Pour une horloge ou un carrousel, ça veut dire un écran vide (ou figé sur une valeur de départ bidon) pendant tout le premier délai — le défaut saute aux yeux, et le remède naïf (appeler `f()` juste avant) s'écrit une fois sur deux au mauvais endroit : dans un `µeffect`, l'appel lit *et* écrit la même variable, le reffet se relance lui-même, et la page part en boucle.

`µevery` tire d'abord, répète ensuite. C'est le comportement qu'on veut dans la quasi-totalité des cas, et il n'y a plus rien à oublier.

</details>

## `µawake` / `µsleep` — connexion & déconnexion

`µmount`/`µdestroy` encadrent la vie **entière** du composant. `µawake`/`µsleep` encadrent **chaque** passage dans le DOM. Le couple est **symétrique** : ce que `µawake` met en place, `µsleep` le retire.

`µawake` joue à **chaque** arrivée du composant dans la page, **première ouverture comprise**. À la première ouverture, il joue **avant** `µmount` : les deux jouent, dans cet ordre. Aux arrivées suivantes — un nœud déplacé (réordonnancement de liste, animation FLIP entre conteneurs), une page hibernée que le cache du routeur réveille —, seul `µawake` rejoue : `µmount` ne se redéclenche pas.

Un composant **détruit** puis recréé repart de zéro : c'est une nouvelle instance, `µawake` puis `µmount` y jouent tous les deux. C'est le cas d'un composant sous un `{if}` qui se referme puis se rouvre, et d'une page que le routeur n'a plus en mémoire (il garde les 10 dernières pages visitées).

| Moment | Hooks joués, dans l'ordre |
|--------|---------------------------|
| première ouverture | `µawake`, puis `µmount` |
| sortie d'une page que le routeur garde en mémoire | `µsleep` |
| retour sur cette page | `µawake` seul |
| composant retiré pour de bon (un `{if}` qui se referme, une page sortie de la mémoire du routeur) | `µsleep`, puis `µdestroy` |
| le même, de retour | `µawake`, puis `µmount` (une nouvelle instance) |
| un nœud gardé par votre script, retiré puis remis plus tard dans la page (après sa destruction) | au retrait `µsleep`, puis `µdestroy` ; au retour `µawake`, puis `µmount` (la même instance, son état gardé) |

```html
<script>
  µawake ->
    @_interval = setInterval (-> $i++), 2500

  µsleep ->
    clearInterval(@_interval)
</script>
```

> ⚠️ Comme `µawake`/`µsleep` peuvent se rejouer plusieurs fois, stockez la ressource sur l'instance (`@_interval`) pour la retrouver côté `µsleep`. Une seule mise en place dans `µmount` + nettoyage dans `µsleep` ne se relancerait **pas** après une reconnexion (la ressource resterait perdue).

> 💡 Une erreur levée dans `µawake` ou `µsleep` est écrite dans la console (avertissement) sans interrompre le reste : le composant arrive quand même dans la page, ou la quitte quand même — `el.remove()` ne lève pas chez l'appelant, et la destruction qui suit a bien lieu.

> ⚠️ **Ne chargez pas vos données dans `µawake` ET dans `µmount`.** À la première ouverture, les deux jouent : la même demande part deux fois.

À ne pas écrire :

```html
<script>
  µawake -> @charger()

  µmount -> @charger()
</script>
```

Choisissez l'un des deux :

- **`µawake` seul** quand les données doivent être **fraîches à chaque retour** : il charge à la première ouverture, puis à chaque retour sur la page.
- **`µmount` seul** quand **une fois suffit** : il charge une fois par vie du composant, à la première ouverture, et pas au retour sur une page gardée en mémoire. Une page que le routeur a sortie de sa mémoire est recréée à son retour : `µmount` y rejoue.

<details>
<summary>🎓 <b>Pour débutants</b> — <code>µeffect</code>, <code>µmount</code>, <code>µawake</code> : lequel choisir&nbsp;?</summary>

- **`µeffect`** : pour un effet de bord qui doit **réagir à l'état** (`$x` qui change) et se nettoyer tout seul. C'est le choix par défaut, le plus concis (mise en place et nettoyage dans une même fermeture). En gros, `µeffect ≈ µawake + µsleep`, avec en bonus la sensibilité automatique aux `$`.
- **`µmount`** : pour de l'**init pure une fois** (brancher une lib tierce, mesurer le DOM) qui n'a pas à réagir à l'état.
- **`µawake` / `µsleep`** : style explicite cycle-de-vie, ou quand la mise en place et le nettoyage sont vraiment distincts et que vous préférez deux blocs séparés.

</details>

## `µurlChange` — réagir à la navigation

Appelé par le routeur (`µRouter`) à chaque changement d'URL, sur **tout composant qui déclare un objet `@routes`**. Signature : `(path, params)` où `path` est le chemin après le `#` (ex. `/posts/42`) et `params` l'objet des segments dynamiques capturés (ex. `{ id: '42' }`).

```html
<script>
  @routes =
    'main':
      '/posts/:id': 'post-page'

  µurlChange (path, params)->
    $id = params.id
</script>
```

> ⚠️ `µurlChange` n'est appelé **que** si le composant est *router-aware*. C'est la **présence de `@routes`** (ou du hook `µurlChange` lui-même) qui l'enregistre auprès du routeur. Sans `@routes`, le hook reste inerte — et les `<@view>` ne s'injectent jamais. Détails au chapitre suivant.

Ordre d'exécution à chaque navigation : URL détectée → `µurlChange` appelé sur chaque composant aware → le routeur injecte le composant-page dans son `<@view>` → ce nouveau composant joue **son propre** `µmount`.

> 🔗 Le routeur, l'objet `@routes`, les zones `<@view>` et les routes paramétrées sont détaillés au chapitre [Router (client)](17-router.md).

## `µfailed` — frontière d'erreur (forme script)

`µfailed (err, reset)->` est l'**équivalent script** de la balise spéciale `<@failed err reset>…</@failed>` ([Éléments spéciaux](15-elements-speciaux.md)) : si un composant **descendant** plante (et n'a pas sa propre frontière), l'erreur remonte jusqu'ici, quelle que soit la profondeur du descendant. `err` est l'erreur capturée, `reset` une fonction qui re-monte le composant (nouvelle tentative).

La nouvelle tentative repart d'un état neuf, mais garde ce que son parent lui donne : ses attributs, ses props (objets et tableaux compris, reposées avant son premier rendu), les écouteurs que le parent a posés sur sa balise (`@nom={…}`) et son contenu glissé ; le parent continue ensuite de lui envoyer ses mises à jour. Limite : un composant écrit dans une ligne de `{for}` de son parent reprend son état par défaut, la ligne gardant sa référence vers l'ancienne balise.

```html
<script>
  µfailed (err, reset)->
    "<p>Oups : #{err.message}</p><button mjs-reset>Réessayer</button>"
</script>
```

> ⚠️ Contrairement à `<@failed>` (un vrai bloc template compilé, `@click=reset` devient un listener réel), la forme script `µfailed` renvoie une **chaîne HTML brute** : pas d'interpolation `{…}` ni de directives `@` compilées dedans. Le bouton de reset s'y marque par l'attribut `mjs-reset` (câblé automatiquement au clic), pas par `@click=reset`. Pour un fallback avec du vrai markup MJS (réactif, événements typés), préférez `<@failed>` — `µfailed` reste l'échappatoire pour un fallback texte minimal composé dynamiquement.

## Copier un composant : `µclone`

`µclone` rend une balise **neuve** du même composant, pas encore dans la page, en deux versions :

- `µclone carte` — la **copie indépendante** : elle part d'une copie de l'état de l'original au moment de l'appel, puis les deux vivent chacun de leur côté ;
- `µclone carte, mirror: true` — le **miroir vivant** : un vrai composant qui **partage l'état** de l'original. Cliquer « +1 » dans un miroir fait monter le compteur partout ; le survol, le clic et la saisie y sont réels.

Depuis du JavaScript (`<script lang="js">`), la même fonction s'écrit `µ.clone(el)` et `µ.clone(el, { mirror: true })`.

### La copie indépendante

`µclone carte` rend une balise **neuve** du même composant, pas encore dans la page. Posée où vous voulez (`liste.append copie`), elle monte avec, dès son premier rendu, une **copie des données de l'état de l'original au moment de l'appel** — ses variables `$…` et ses props —, puis les deux vivent chacun de leur côté : une modification de l'un ne touche pas l'autre.

```html
<script>
  @dupliquer = ->
    copie = µclone @@_shadow.querySelector('mjs-carte')
    @@_shadow.querySelector('.liste').append copie
</script>
<@carte titre={$titre}><span>contenu glissé</span></@carte>
<div class="liste"></div>
```

La copie est une **vraie instance** : son script tourne, son `µmount` joue une fois, ses reffets suivent ses propres variables et voient l'état copié dès leur premier tour, ses écouteurs sont les siens. Le magasin `$$` reste celui de tous (il est global).

| Dans l'original | Dans la copie |
|---|---|
| valeur simple, objet simple, liste, `Map` (clés comprises), `Set`, `Date` : des données, de bout en bout | copie **profonde** : modifier la copie ne touche pas l'original, ni l'inverse |
| fonction, instance de classe (un ressort `µspring` compris), élément du DOM, promesse — ou une donnée qui en tient une, à quelque profondeur que ce soit | **pas copiés** : la variable garde la valeur que le script de la copie lui donne (`$valider = -> $n++`, appelée dans la copie, change la copie) |
| dérivé (`$total = $prix * $qte`) | recalculé par la copie, depuis ses propres variables |
| attributs de la balise | recopiés comme `cloneNode` — un `id` aussi : changez-le, sinon deux balises de la page portent le même |
| contenu glissé entre les balises | recopié comme `cloneNode(true)` |

Limites :

- **Une variable qui n'est pas une donnée repart de sa valeur de départ** dans la copie, celle que son script lui donne : un ressort `µspring` repart de sa valeur initiale, une prop fonction (un rappel donné par le parent) n'est pas reprise, et une donnée qui tient une fonction n'est pas copiée, même en partie. Recopiée telle quelle, une fonction de l'original remplacerait celle de la copie et la relierait à l'original.
- **Un composant rendu dans l'ombre de l'original** repart de son propre état de départ dans la copie, sauf ce qu'il reçoit d'elle par props.
- **Le parent de l'original ne pilote pas la copie** : elle garde la valeur de ses props au moment de l'appel, et les gestionnaires que le parent avait écrits sur la balise de l'original (`@nom={…}`) ne sont pas recopiés — la copie n'est pas écrite dans le gabarit du parent.
- Les variables du script sans `$` et les champs `@x` de l'instance repartent de leur valeur de départ : le script de la copie les pose.
- Un composant léger (`mjs-light`) a pour enfants sa propre vue : seule sa balise est copiée, la copie construit la sienne.
- **Une balise qui n'est pas un composant MJS** (balise ordinaire, ou composant dont la définition n'est pas encore chargée) : `µclone` lève une erreur plutôt que de rendre une copie sans état. Pour une copie ordinaire, écrivez `el.cloneNode(true)`.

### Le miroir vivant : `mirror: true`

```html
<script>
  @refleter = ->
    miroir = µclone @@_shadow.querySelector('mjs-carte'), mirror: true
    @@_shadow.querySelector('.vitrine').append miroir
</script>
<@carte titre={$titre}></@carte>
<div class="vitrine"></div>
```

Les variables `$…` du miroir **sont** celles de l'original : le même objet d'état. Une écriture faite par n'importe laquelle des instances — gestionnaire (`@click={$n++}`), script, reffet, saisie liée (`value=!{$texte}`) — redessine toutes celles qui partagent cet état, l'original comme chacun de ses miroirs, dans les deux sens. Le miroir naît avec l'état du moment : son script tourne, mais ses valeurs de départ (`$n = 0`) ne remettent pas l'état à zéro.

| | Partagé par l'original et ses miroirs | Propre à chaque instance |
|---|---|---|
| variables `$…`, listes et objets compris | un seul état : chaque écriture redessine toutes les instances | |
| props | quand le parent de l'original change une prop, tous les miroirs la voient | |
| dérivés (`$total = $prix * $qte`) | la même valeur partout, recalculée après chaque écriture | |
| DOM, ombre, feuilles de style, écouteurs, références `@@x` | | chaque instance a les siens |
| composant rendu dans le gabarit (`<@compteur base={$n}>`) | ses props viennent de l'état commun | une instance neuve : son propre état n'est pas partagé |
| `µawake`, `µmount`, reffets, `µsleep`, `µdestroy` | | jouent dans chaque instance, comme dans tout composant |

`@@isMirror` est vrai dans un miroir ; ailleurs, c'est une valeur fausse : `false`, ou `undefined` dans une application qui n'emploie ni `µclone` ni une bande `*marquee` de balises. Lisez-le tel quel (`if @@isMirror`, `unless @@isMirror`), sans le comparer à `false`. De l'extérieur, c'est la propriété `isMirror` de la balise. Il évite une requête ou une minuterie en double :

```html
<script>
  $secondes = 0
  µmount ->
    return if @@isMirror
    id = setInterval (-> $secondes++), 1000
    -> clearInterval id
</script>
<p>{$secondes} s</p>
```

La minuterie ne tourne que dans l'original ; chaque seconde écrite dans l'état commun s'affiche dans tous ses miroirs.

Un miroir fait partie de la page comme le reste : rien n'y est caché au clavier ni aux lecteurs d'écran.

Fin de vie :

- **retirer l'original n'arrête pas ses miroirs** : ils gardent l'état, écrivent et se préviennent entre eux ; remis dans la page, l'original reprend l'état du moment ;
- **retirer un miroir ne touche ni l'original ni les autres miroirs** ; aucune instance retirée n'est retenue : seules celles qui sont dans la page reçoivent les écritures ;
- le miroir d'un miroir (`µclone miroir, mirror: true`) rejoint le même état.

Limites :

- Les attributs de la balise sont recopiés comme `cloneNode` (un `id` aussi : changez-le), mais **ceux qui portent des props ne sont pas relus dans l'état commun** : le miroir montre l'état du moment, pas la valeur de départ écrite sur la balise. Pour la même raison, une prop posée en propriété sur la balise d'un miroir avant son montage (`miroir.titre = 'X'`) est ignorée : écrivez-la une fois le miroir monté.
- Le script d'un miroir tourne à sa naissance **sans écrire dans l'état commun** — ni ses valeurs de départ, ni ce qu'il fait au premier niveau sur une liste ou un objet (`$liste.push 1`). Ce qu'il écrit ensuite (gestionnaire, reffet, `µmount`, minuterie) touche l'état commun, comme dans l'original.
- Une écriture coûte autant de rendus qu'il y a d'instances dans la page qui partagent l'état. Une application sans miroir ne paie rien.
- **Une balise qui n'est pas un composant MJS** lève la même erreur que pour la copie ; **une option inconnue** (`µclone el, miroir: true`) en lève une qui rappelle la seule option, `mirror`.

La rune n'entre dans la construction que si l'application écrit `clone` (sans elle, pas un octet) ; un nom fabriqué à l'exécution (`µ['clo' + 'ne']`) se demande par `"runtime": ["clone"]`.

---

📚 **Apprendre en pratiquant** : les hooks sont introduits dans le **Tuto interactif n°2 (Reffets)** comme pendant explicite de `µeffect` ; `µmount`/`µsleep` sont mis en œuvre dans les chapitres canvas (n°13) et le hook `µurlChange` dans les chapitres de routage (n°19–20, 31).
