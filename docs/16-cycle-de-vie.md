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

Exécuté juste après le premier rendu, **une fois par vie** du composant : le Shadow DOM est en place, toutes les références `:this=!{ref}` (variables **sans `$`** — cf. [Directives DOM](09-directives-dom.md)) sont résolues, le nœud est mesurable (`getBoundingClientRect`, etc.). C'est l'endroit pour brancher une librairie tierce ou un observateur sur un nœud précis.

> 🔗 Une bibliothèque branchée ici qui change elle-même ce que tient une variable `$` (sa liste, son objet) ne prévient pas MJS : juste après chacun de ses changements, écrivez `µrefresh($x)` — cf. [41 · µrefresh](41-refresh.md).

Comme `µeffect` et `:attach`, **retourner une fonction l'enregistre comme nettoyage** : appelée une fois, à la destruction du composant — jamais à `µsleep`.

**Remis dans la page après sa destruction, le composant rejoue `µmount`.** Un composant qui quitte la page pour de bon est détruit à la microtâche suivante : le nettoyage de `µmount` et `µdestroy` tournent. Si votre script a gardé le nœud et le remet plus tard dans la page (panneau gardé en mémoire, défilement virtuel, déplacement après un `await`), c'est la même instance, son état gardé, et une nouvelle vie commence : `µawake`, puis `µmount`, qui repose ses nettoyages ; comme au premier montage, il joue après le rendu de ce retour, ses références `:this` déjà reposées. Un simple déplacement (retiré puis remis dans le même tour) et une page que le cache du routeur garde en mémoire ne sont pas des destructions : `µmount` n'y rejoue pas. Un composant qui n'a rien à défaire (aucun nettoyage, pas de `µdestroy`) n'est pas détruit à sa sortie : il garde son montage, et `µmount` ne rejoue pas à son retour.

```html
<script>
  canvas = null

  µmount ->
    context = canvas.getContext('2d')
    ro = new ResizeObserver(resize)
    ro.observe(canvas)
    -> ro.disconnect()
</script>

<canvas :this=!{canvas}></canvas>
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

Le code écrit directement à la racine du `<script>` s'exécute dans le **constructeur** du composant : **avant** que le nœud ne soit dans la page. Conséquences : `canvas` n'existe pas encore (la référence n'est posée qu'au montage), le DOM n'est pas mesurable, et rien n'est nettoyé au démontage. Un composant qui passe des props dynamiques aux composants de sa racine (`<@duel game={$game}>`) et qui est mis à niveau dans la page (balise posée par son parent, page chargée) n'a même pas encore son contenu à ce moment-là : il le reçoit une fois ses props reprises, pour que ses enfants aient les leurs dès leur arrivée.

`µmount` règle ça : il diffère son corps jusqu'à ce que le composant soit *réellement* dans la page et rendu une première fois. C'est le « top départ » fiable de votre composant.

</details>

> ℹ️ **Ce que `µmount` écrit s'anime.** Une transition d'entrée (`:in`, `:transition`) ne joue jamais sur le **premier** rendu — sinon la page entière clignoterait au chargement. Mais `µmount` s'exécute *après* ce premier rendu : un état écrit là déclenche donc un rendu **suivant**, et les nœuds que ce rendu crée jouent leur transition d'entrée normalement. C'est ce qui permet d'animer l'apparition d'un contenu dès l'arrivée sur la page, sans avoir à marquer la transition `.global`. La même chose vaut pour le premier tir de [`µevery`](#µevery--répéter-en-partant-tout-de-suite), qui a lieu au montage.

> ⚠️ **Une valeur mesurée au premier rendu peut arriver après `µmount`.** Une liaison de mesure, même seule (`clientWidth=!{$l}`), peut ne donner sa valeur qu'au rendu qui suit `µmount` ; de même pour chacune de plusieurs liaisons, sur une balise ou sur plusieurs (`<div clientWidth=!{$w} clientHeight=!{$h}>`). Un bloc que cette valeur ouvre (`{if $l > 0}`) joue alors sa transition d'entrée.

> ℹ️ **Cascade de montage : l'enfant avant le parent.** Dans un arbre de composants imbriqués, le `µmount` d'un enfant s'exécute avant celui de son parent — chaque connexion au DOM programme son propre montage, et celle de l'enfant a lieu pendant que celle du parent est encore en cours. Utile pour un parent qui doit lire, dès son propre `µmount`, un état ou une réf déjà posée par ses enfants. Un parent en Shadow DOM léger (`:lightDom`) fait exception : son `µmount` joue avant ceux de ses enfants, leurs `µawake` toujours avant le sien. Le parent pose leurs props avant de les faire entrer dans la page : un enfant les a dès son `µawake`, sans que cet ordre change. Restent trois limites : la reprise d'une page rendue par le serveur, quand le module d'un enfant est défini avant celui de son parent (cf. [`µawake`](#µawake--µsleep--connexion--déconnexion)), le code racine du `<script>` d'un parent mis à niveau dans la page, qui n'a pas encore son contenu (cf. plus haut), et la page qu'une navigation demandée pendant qu'une autre joue ses crochets (renvoi depuis un `µawake`, garde `µurlChange`) pose avant l'arrivée de son code : ses enfants déjà définis peuvent alors démarrer avant elle (`µawake` puis `µmount`), selon le code qui arrive le premier ; pour l'ordre d'avant, écrivez `"routes": { "preload": "on" }`.

> ⚠️ **Un `µmount` qui lève une erreur empêche les `µevery` écrits à la racine du `<script>` de démarrer** : ils partent juste après `µmount`, et ne partent jamais s'il lève. Attrapez l'erreur dans `µmount` (`try … catch`).

## `µdestroy` — nettoyage final

Appelé une fois par vie du composant, au démontage définitif (le composant quitte le DOM pour de bon : `{if}` qui passe à `false`, item retiré d'un `{for}`, changement de route). MJS nettoie **automatiquement** ses propres ressources — reffets (`µeffect`, qui cessent de suivre ce qu'ils lisaient ; un composant seulement déplacé dans la page garde les siens ; un reffet écrit au premier niveau du `<script module>` appartient au module du composant, pas à un exemplaire, et reste), abonnements aux stores, contextes, transitions en cours. `µdestroy` sert pour **ce que MJS ne connaît pas** : `WebSocket`, listeners posés sur `window`/`document`. Les minuteries n'y passent jamais : `µevery` et `µafter` (plus bas) s'arrêtent toutes seules.

```html
<script>
  surRedim = -> $largeur = window.innerWidth

  µmount ->
    window.addEventListener 'resize', surRedim

  µdestroy ->
    window.removeEventListener 'resize', surRedim
</script>
```

Équivalent au retour de `µmount` (ci-dessus) pour une ressource unique ; `µdestroy` reste préférable pour **regrouper** plusieurs nettoyages sans rapport entre eux dans un seul bloc.

> 💡 Une erreur dans `µdestroy` — levée, ou rejet d'un `µdestroy` asynchrone (après un `await`) — est écrite dans la console (avertissement « hook destroy en erreur : … ») sans arrêter la destruction, où que soit le composant : dans un `{if}`, un `{key}`, un contenu `{{…}}` ou une ligne de `{for}`.

> 💡 Pour une minuterie, rien à écrire dans `µdestroy` : [`µevery`](#µevery--répéter-en-partant-tout-de-suite) et [`µafter`](#µafter--un-seul-tir-plus-tard) s'arrêtent quand le composant disparaît, et `setTimeout` / `setInterval` sont [refusés dans un composant](#settimeout-et-setinterval--refusés-dans-un-composant).

> 💡 Pour une ressource attachée à un nœud précis du template (lib tierce, observateur d'intersection), préférez la directive **`:attach`** (chapitre [Directives DOM](09-directives-dom.md)) : elle co-localise mise en place et nettoyage sur l'élément, et se rejoue à chaque apparition/disparition (utile sous un `{if}`).

## `µeffect.root` — des reffets lancés à la demande

Un `µeffect` s'écrit au premier niveau du `<script>` : il vit avec le composant. Pour un reffet qui ne doit tourner que pendant un moment choisi (un panneau ouvert, un suivi lancé par un bouton), écrivez-le dans `µeffect.root -> …`, n'importe où : un gestionnaire, `µmount`, une méthode, une fonction d'un module appelée plus tard. Les reffets (`µeffect`, `µeffect.before`) écrits directement dans son rappel lui appartiennent ; la valeur rendue est la fonction qui les arrête tous, en jouant une fois le nettoyage de chacun. Un deuxième appel ne fait rien.

```html
<script>
  arret = null
  @ouvrir = ->
    $ouvert = true
    arret = µeffect.root ->
      µeffect ->
        $resume = "#{$$panier.length} article(s)"
  @fermer = ->
    $ouvert = false
    arret?()
</script>
```

Le panneau ne suit le panier que tant qu'il est ouvert : fermé, plus aucun passage. Ses règles :

- dans un composant, dans son `<script>` comme dans un gestionnaire de son gabarit (`@click={µeffect.root -> µeffect -> …}`, balises globales comprises), les reffets de la racine sont ceux du composant : ils suivent ce que suit un reffet du premier niveau (ses variables, lues directement ou par une fonction ou une méthode du `<script>` — et, pour la racine d'un gestionnaire, par une fonction écrite dans ce gestionnaire, `@click={lire = (-> $y); µeffect.root -> µeffect -> …}`, ou dans un `{const}` du gabarit —, les clés `$$x`, un `µ$$x`, les clés lues d'un `µStore`), passent une première fois juste après l'appel (en microtâche), et finissent avec le composant même si personne n'appelle l'arrêt ; ouverte pendant le premier rendu (au premier niveau du `<script>`), la racine passe avec les autres reffets du composant ;
- dans un module, le fichier d'un magasin ou le `<script module>`, chacun est mené comme le reffet d'un module (il suit un `µ$$x` en entier, les clés lues d'un `µStore`, les clés `$$x`) ; de même dans un fichier `.js` importé, qui reçoit `µ` de son appelant, sous le nom qu'il veut (`µ.effect.root(() => { µ.effect(…) })`, `(m) => m.effect(…)`) — la construction lit son code, pas ses commentaires ni ses textes : ses reffets y suivent les clés lues d'un `µStore`, jamais une clé lue par `µ.store`, que seul le compilateur relève ; une racine ouverte au premier niveau d'un module s'arrête quand son fichier est exécuté de nouveau (rechargement à chaud) ;
- une racine ouverte pendant une autre s'arrête avec elle ;
- seul un reffet écrit directement dans le rappel de la racine (dessous, sous un `if`, un `for`, ou sur sa ligne : `µeffect.root -> µeffect(-> a); µeffect(-> b)`) est accepté à la construction : écrit dans une fonction placée dans la racine (`forEach`, minuterie, promesse), il est refusé, et le refus montre la forme qui marche : le reffet directement dans la racine et la boucle dans le reffet (`µeffect.root -> µeffect -> liste.forEach (x) -> …`), ou une racine par élément (`liste.forEach (x) -> µeffect.root -> µeffect -> …`) ; à l'exécution, un `µeffect` lancé hors de toute racine et hors du premier niveau ne tourne pas, et l'avertissement de développement le dit ;
- un gestionnaire du gabarit (`@click={…}`, `<@window @resize={…}>`) tourne à l'événement, sans propriétaire : un `µeffect` écrit dedans est refusé à la construction, sauf un reffet écrit directement dans une racine (`@click={µeffect.root -> µeffect -> …}`), qui appartient au composant comme celle du `<script>` (premier point) ; un gabarit en `"js"` compile ses gestionnaires en CoffeeScript, et ce contrôle les lit de même. Renvoyée par le gestionnaire qui vient d'ouvrir la racine (la racine écrite dans l'accolade, `@click={@ouvrir()}` avec `@ouvrir = -> @arret = µeffect.root -> µeffect -> …`), la fonction d'arrêt n'est pas appelée et la racine reste ouverte, comme la main d'arrêt d'un `µevery` (plus bas) ; rangée puis donnée à un événement suivant (`@click={arret}`), elle est appelée comme toute fonction renvoyée, et arrête la racine. Pour garder la fonction d'arrêt, ouvrez la racine dans une méthode (`@ouvrir = -> @arret = µeffect.root -> µeffect -> …`, puis `@click=@ouvrir` ou `@click={@ouvrir()}`) ;
- une racine qui attend (un `await` dans son rappel) rend la main à sa première attente : les reffets écrits avant lui appartiennent, un reffet écrit après est refusé à la construction, comme un reffet écrit dans une boucle qui attend (au tour suivant, il passerait après l'attente). Écrivez les reffets avant le premier `await` et hors de la boucle qui attend, ou faites l'attente dans le reffet (`µeffect -> $liste = await charger($page)`) ; une attente dans une fonction écrite dans la racine ne gêne rien ;
- au rendu serveur, le rappel passe et aucun de ses reffets ne tourne, alors qu'un `µeffect` du premier niveau y tourne ([19](19-ssr.md)) : ce qu'une racine écrit n'est pas dans le HTML du serveur.

## `µevery` — répéter, en partant tout de suite

Une minuterie posée à la main demandait deux moitiés : la poser au montage, la couper dans `µdestroy` — et la seconde s'oubliait. `µevery` fait les deux d'un bloc :

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

**Renvoyée par un gestionnaire, la main d'arrêt n'est pas appelée.** Une fonction rend sa dernière ligne, en CoffeeScript comme en Civet : `demarrer = -> µevery 1000, -> …` rend la main d'arrêt, et `@click={demarrer()}` (ou `@click={@demarrer()}`, ou `µevery` écrit dans l'accolade même) la renvoie au gestionnaire. Une fonction renvoyée par un gestionnaire est d'ordinaire appelée (la forme `@click={choisir}` des événements) ; la main d'arrêt de la minuterie que ce même événement vient de lancer fait exception : la répétition part. Il en va de même pour `µafter`. Rangée puis donnée à un événement suivant (`@click={$arreter}`), la main d'arrêt est appelée comme toute fonction, et arrête sa minuterie.

### Partout dans le composant

`µevery` s'écrit **partout** dans le composant : à la racine du `<script>`, dans un gestionnaire, une méthode, un `µeffect`, `µmount`, après un `await`. Un module ou un magasin l'écrit aussi : la minuterie suit alors le composant qui s'exécute à l'appel, à défaut la **page** — appelée depuis un gestionnaire, au chargement du module ou après un `await`, elle tourne tant que la page vit, jusqu'à sa main d'arrêt, `times` ou `while` ; ses erreurs vont à la console en développement, et en production au niveau `'warn'` seulement (au niveau par défaut, rien ne s'affiche : attrapez-les dans la fonction). En production, ce niveau de la page et les noms (`id:`) n'existent que si la construction en a besoin, et la règle est un contrat : soit la construction lit l'appel, soit un avertissement le signale en développement, quand l'appel s'exécute. Elle lit les composants, les modules, les magasins, les modules `.js.mjs` et les bibliothèques `.js` importés (`@import`, `µimport`), où µ compte écrit en clair comme échappé (`\u00b5`, `\u{b5}`, et dans un texte `\xb5` ou l'octal `\265`, hors mode strict). Un appel écrit (`µafter 30, -> …`, `µ.after(30, f)`) fait entrer le niveau de la page s'il est hors composant, et les noms si ses options peuvent porter un `id` : clé `id` écrite, ou options passées par une variable, un paramètre, un appel, une condition ; une fonction donnée à la place des options (`µafter 30, tirer`, `tirer` étant lié à une fonction là où l'appel le lit) n'en fait pas entrer. Les autres formes qu'elle lit font entrer les deux, `id` ou non : hors de `µ.<nom>` écrit et de ces appels, une mention de µ — crochets (`µ['after']`), alias (`a = µafter`), déstructuration (`{ after } = µ`, `{ µ: m } = window`), `.call`, `.apply`, `.bind`, µ passé comme valeur, lu sur un objet (`window.µ`, `globalThis['µ']`) ou nommé par le texte `'µ'` (`Reflect.get(globalThis, 'µ')`) —, et le code fait d'un texte : `eval` et `Function` (`eval(…)`, `(0, eval)(…)`, `new Function(…)`), un membre `constructor` appelé (`Function.prototype.constructor('…')`), `setTimeout` / `setInterval` appelés avec un texte écrit dans l'appel, ou par `.call`, `.apply`, `.bind`. Un nom `after` / `every` écrit sous µ (`a = µafter`, `` µ[`after`] ``, `{ µ: { after } } = window`, `{ after } = window.µ || {}`) fait entrer le module des minuteries ; un accès qui ne le nomme pas (`µ[k]`, `m = µ`) ne l'emmène pas, comme pour les autres modules du cœur, et l'appel échoue, en développement comme en production. La construction ne voit pas un appel fait hors de ses sources (script de `public/`, script extérieur), par un accès entièrement calculé (`window[k]`, `Reflect.get(window, nom)`), ni par du code qu'un texte fait exécuter par une autre voie (texte rangé dans une variable ou rendu par un appel avant d'être donné à `setTimeout`, `eval.call(…)`, `new x.constructor(…)`, balise `<script>` fabriquée, attribut `onclick` écrit dans du HTML…) : un tel appel ne pose rien hors composant, et perd son `id` ; en développement, sa minuterie part, et un avertissement dans la console le signale quand il s'exécute. `window.µ` n'existe qu'en développement, sauf si votre appli le pose elle-même (`window.µ = µ` dans son script d'entrée). Posée pendant l'initialisation, elle part au montage ; ailleurs, elle part à l'appel (premier tir selon `immediate`). Elle suit toujours **son** composant, et trois cas se distinguent quand il quitte la page : **détruit** (bloc fermé, page quittée), plus rien ne part, jamais ; mis en **hibernation** par le cache de pages, il n'est pas détruit et la minuterie continue de tourner, sauf `pause: true` ; **retiré par votre script** puis remis, la minuterie posée par un passage (`µmount`, `:attach`, `µeffect`) est arrêtée au retrait et reposée par le passage rejoué au retour, une autre est suspendue au retrait puis repart au retour (encadré « Retiré, détruit, puis remis » plus bas). Comme `µmount`, elle ne part jamais pendant le rendu serveur ; posée sur un composant déjà retiré de la page (dans la suite d'un `await`), elle attend son retour. Un chronomètre :

```html
<p>{$secondes} s</p>
<button @click={-> arreter = µevery 1000, immediate: false, -> $secondes++}>Démarrer</button>
<button @click={-> arreter?()}>Arrêter</button>

<script>
  $secondes = 0
  arreter   = null
</script>
```

> ⚠️ Seule l'interpolation `{…}` la refuse, à la construction : recalculée à chaque rendu, elle poserait une minuterie par rendu.

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
| `always: true` | N'appartient pas au passage qui la pose (`µeffect`, attache, `µmount`) : le passage suivant ne l'arrête pas, et une horloge posée par un reffet garde sa cadence quand il repart. Elle s'arrête **pour de bon** à la destruction du composant (`onStop` part) et ne repart pas à son retour, où le passage rejoué peut en poser une autre. Chaque passage qui l'écrit en pose une de plus : gardez sa main d'arrêt et ne la reposez pas tant qu'elle court. |
| `id: 'nom'` | **Une seule** minuterie de ce nom : la poser arrête d'abord celle qui court encore, `µafter` compris (détail et exemple sous [`µafter`](#µafter--un-seul-tir-plus-tard)). |

`times` et `while` remplacent la main d'arrêt écrite à la main dans les deux cas courants — le compte à rebours et le sondage « jusqu'à ce que ce soit fini ».

Une **clé inconnue** (faute de frappe) est signalée dans la console, et une valeur du mauvais type retombe sur le défaut de sa clé : dans les deux cas le timer tourne quand même.

Le corps peut être **`async`** : un échec après un `await` part vers la frontière d'erreur du composant, exactement comme un échec immédiat. La condition `while`, elle, doit rendre un **booléen synchrone** — une fonction `async` rend une promesse, toujours vraie, ce qui ne s'arrêterait jamais ; MJS le signale et arrête la répétition.

> ⚠️ « Au démontage » veut dire **au démontage définitif**, comme le nettoyage de `µmount`. Une page mise en **hibernation** par le cache du routeur (elle quitte le DOM mais garde son état pour un retour instantané) n'est pas détruite : sans `pause: true`, son `µevery` **continue de tourner** jusqu'à l'éviction du cache.

> ℹ️ `pause: true` **reprend** la répétition, il ne la redémarre pas : la fraction de période déjà écoulée au moment de la mise en veille est perdue, et le retour dans le DOM ne provoque pas de tir de rattrapage.

> ℹ️ **Retiré, détruit, puis remis plus tard dans la page** (un nœud gardé par votre script : panneau gardé en mémoire, défilement virtuel, déplacement après un `await`) : la répétition qui tournait encore **repart** au retour, comme `µmount` — un tir au montage (sauf `immediate: false`), puis toutes les `délai` ms. Elle reprend là où elle en était : `times` continue son compte (jamais plus de *n* tirs au total), et `onStop`, déjà appelé à la destruction, le sera de nouveau à l'arrêt suivant. Une répétition **finie** (`times` épuisé, `while` tombé) ou arrêtée par sa **main d'arrêt** ne repart pas. Une répétition lancée pendant la partie synchrone d'un `µmount`, d'une attache (`:attach`) ou d'un passage d'un `µeffect` appartient à ce passage : elle s'arrête au retrait (`onStop` part), et le passage, rejoué au retour, en lance une neuve — jamais deux pour une ; celle d'une attache s'arrête aussi quand la balise est détachée, celle d'un `µeffect` quand le passage suivant commence. **Limite** : lancée après un `await` (dans un `µmount` comme dans un `µeffect`), elle n'appartient plus au passage, car rien ne la suit après un `await` : elle suit la règle ci-dessus, suspendue au retrait puis relancée au retour, à côté de celle que pose le passage rejoué, qui la double ; dans un `µeffect`, le passage suivant ne l'arrête pas non plus. Parade : posez-la avant l'`await` ; sinon rangez sa main d'arrêt (`arret = µevery …`) et appelez-la vous-même, dans `µdestroy` ou dans le nettoyage que rend un `µmount` resté synchrone, en tête du passage suivant d'un `µeffect` (`arret?()`). **Limite**, pour une attache : elle prend toute minuterie posée pendant sa partie synchrone, quel que soit le code qui la pose — une fonction d'un autre composant ou d'un module qu'elle appelle comprise. Cette minuterie s'arrête quand la balise est détachée, et la prochaine attache en pose une neuve si elle rappelle ce code. Pour qu'une minuterie vive avec le composant qui la possède, posez-la hors de l'attache, par exemple dans le `µmount` de ce composant.

> ℹ️ Le délai est borné à **2 147 483 647 ms** (24,8 jours), la limite des minuteries du navigateur : au-delà, `Infinity` compris, la fonction tire au montage puis tous les 24,8 jours — un délai plus grand était ramené à 0 par le navigateur et la fonction tournait en boucle.

<details>
<summary>🎓 <b>Pour débutants</b> — pourquoi le premier tir est-il si important&nbsp;?</summary>

Un `setInterval(f, 2500)` n'appelle **jamais** `f` immédiatement : il attend 2,5 secondes, puis commence. Pour une horloge ou un carrousel, ça veut dire un écran vide (ou figé sur une valeur de départ bidon) pendant tout le premier délai — le défaut saute aux yeux, et le remède naïf (appeler `f()` juste avant) s'écrit une fois sur deux au mauvais endroit : dans un `µeffect`, l'appel lit *et* écrit la même variable, le reffet se relance lui-même, et la page part en boucle.

`µevery` tire d'abord, répète ensuite. C'est le comportement qu'on veut dans la quasi-totalité des cas, et il n'y a plus rien à oublier.

</details>

## `µafter` — un seul tir, plus tard

`µafter` est la forme courte de `µevery` pour un tir **unique**, après le délai (`µevery 5000, immediate: false, times: 1, ->`). Même vie : il part à l'appel, partout dans le composant, rend sa main d'arrêt, et ne part jamais pendant le rendu serveur. Les trois cas de `µevery` valent pour lui : composant **détruit** (bloc fermé, page quittée), le tir ne part jamais ; page en **hibernation**, il part à son heure, sauf `pause: true` ; nœud **retiré par votre script** puis remis, le tir en attente est suspendu au retrait, puis réarmé avec son délai **complet** au retour, et un `µafter` posé pendant l'absence part au retour. Posé pendant la partie synchrone d'un `µmount`, d'une attache ou d'un passage d'un `µeffect`, il appartient à ce passage : arrêté au retrait, il est reposé par le passage rejoué au retour ; la balise détachée arrête celui de son attache, et le passage suivant d'un `µeffect` celui du passage d'avant (plus bas). Posé après un `await`, il n'appartient plus au passage (même limite que `µevery`).

```html
<p>{$etat}</p>
<button @click={-> envoyer()}>Envoyer</button>
<button @click={-> annuler?()}>Annuler</button>

<script>
  $etat   = ''
  annuler = null

  envoyer = ->
    $etat   = 'Envoi dans 5 s'
    annuler = µafter 5000, ->
      $etat = 'Envoyé'
      expedier()
</script>
```

« Annuler » appelle la main d'arrêt : rien ne part. Si la bulle disparaît avant les 5 s (fermée, page quittée), le tir est annulé lui aussi.

Options, entre le délai et la fonction : `pause: true` (page gardée par le cache des pages : suspendu hors de l'écran, le délai repart de zéro au retour), `onStop: ->` (appelé une fois, après le tir ou à l'annulation), `always: true` et `id: 'nom'` (plus bas).

**`always: true` — le tir part même si le composant a disparu** : l'annonce « Enregistré » après la fermeture d'une fenêtre. Seul le rendu serveur ne le lance pas. Sa main d'arrêt l'annule toujours ; `always` l'emporte sur `pause`. Rendue en dernière ligne par `µmount`, par `:attach` ou par un `µeffect`, cette main d'arrêt n'est pas prise pour leur nettoyage : le tir part quand même. Sans `always`, `µmount` et `:attach` la prennent pour leur nettoyage, et la minuterie s'arrête quand le composant ou la balise disparaît. Le tir écrit alors hors du composant disparu (un magasin `$$x`, une fonction partagée) :

```html
<script>
  fermer = ->
    µafter 2000, always: true, -> $$annonce = 'Enregistré'
    $ouverte = false
</script>
```

**`id: 'nom'` — une seule minuterie de ce nom.** Poser une minuterie sous un nom encore en cours arrête d'abord l'ancienne, comme sa main d'arrêt (son `onStop` part), puis pose la neuve ; si cet `onStop` pose lui-même une minuterie de ce nom, elle ne part pas (ni tir ni `onStop` ; une attente `await µafter …, id:` ne reprend jamais) : il n'en tourne jamais qu'une, la neuve. Une fois la neuve posée, une minuterie de ce nom la remplace à son tour, même posée pendant son premier tir (celui de `µevery`, tout de suite) : la dernière gagne. Sauver 2 s après la **dernière** frappe s'écrit donc en une ligne : chaque frappe relance la minuterie au lieu d'en ajouter une.

```html
<textarea @input={-> µafter 2000, id: 'sauver', -> enregistrerBrouillon()}></textarea>
```

- La main d'arrêt rendue est celle de la neuve ; celle de l'ancienne, appelée après coup, ne touche pas la neuve.
- `µafter` et `µevery` partagent les noms : un `µafter` posé sous le nom d'un `µevery` en cours l'arrête, et l'inverse.
- Portée : le **composant**. Deux composants, ou deux exemplaires du même, qui emploient le même nom ne se gênent pas. Appelée par un module ou un magasin, le nom vaut pour la **page** : la minuterie de ce nom posée depuis un autre composant, ou hors de tout composant (gestionnaire, chargement du module), s'arrête ; posée pendant qu'un composant s'exécute, elle s'arrête aussi pour de bon quand ce composant quitte la page, même s'il y revient ensuite.
- `always: true` n'y échappe pas : la neuve arrête quand même l'ancienne. Sans `id`, rien ne change, et le passage suivant d'un `µeffect` arrête toujours la minuterie du passage d'avant.
- Le nom se libère quand la minuterie finit : tir d'un `µafter`, arrêt par sa main, `times` atteint, `while` tombé, même pendant sa pose (`times: 1` et son tir immédiat, `while` faux dès le départ, `times: 0` : le nom reste libre) ; un composant détruit pour de bon emporte ses noms. Au rendu serveur, rien ne part, nom ou pas.
- Un `id` qui n'est pas une chaîne non vide est signalé dans la console en développement (en production, au niveau `'warn'`), puis ignoré : la minuterie part quand même, sans nom.
- En production, le nom vaut pour un appel que la construction lit, quelle que soit sa forme (`µafter`, `µ.after(…)`, alias, `.call`, µ échappé, `eval`… : les formes lues sont listées plus haut, « Partout dans le composant ») ; un appel qu'elle ne voit pas (script de `public/`, script extérieur, accès entièrement calculé comme `window[k]`, code qu'un texte fait exécuter par une autre voie, comme un texte rangé dans une variable puis donné à `setTimeout`…) perd son `id`, ce qu'un avertissement signale en développement, quand l'appel s'exécute.

**Dans un `µeffect`, la minuterie appartient au passage.** Une fonction rend sa dernière ligne, et un reffet prend la fonction qu'il rend pour son nettoyage, sauf la main d'arrêt d'un `µafter` ou d'un `µevery` : écrite en dernier ou non, la minuterie vit la même vie. Posée pendant un passage du reffet, elle appartient à ce passage, comme un nettoyage : le passage suivant l'arrête avant de commencer — un `µafter` reposé avant son tir ne part qu'une fois, des `µevery` ne s'empilent jamais —, l'arrêt du reffet par sa main (la fonction que rend `µeffect`) et le retrait du composant aussi, que le passage rende un nettoyage ou non, quel que soit son rang ; le passage rejoué au retour du composant en pose une neuve. `always: true` n'est jamais arrêté : chaque passage pose le sien, qui tire. Un aperçu qui suit la saisie s'écrit donc sans rien de plus :

```html
<script>
  µeffect ->
    texte = $saisie
    µafter 300, -> $apercu = texte
</script>
```

Quand `$saisie` change avant le tir, le passage suivant arrête le tir en attente et pose le sien : `$apercu` suit la saisie 300 ms après la dernière frappe. Il en va de même pour `µevery` : sa répétition s'arrête avant le passage suivant, qui en pose une nouvelle, sauf avec `always: true` (tableau des options de `µevery`). Un nettoyage écrit (`arret = µafter …` puis `-> arret()`) reste permis ; c'est lui qui annule un `always: true` quand le reffet repart ou disparaît. Posée après un `await` du reffet, la minuterie n'appartient plus au passage : le passage suivant ne l'arrête pas (limite et parade dans l'encadré « Retiré, détruit, puis remis »).

**Attendre.** Sans fonction, `µafter` rend une promesse : `await µafter 300` attend 300 ms. Si le composant quitte la page pendant l'attente, ou l'a déjà quittée quand elle commence (après un autre `await`), elle attend son retour : remis dans la page, elle se termine après le délai complet ; détruit pour de bon, elle ne se termine jamais, et la suite de la fonction ne tourne pas sur un composant disparu. Écrite dans la partie synchrone d'un `µmount` ou d'un `µeffect` (avant tout autre `await`), elle appartient à leur passage : le retrait l'arrête, et le passage rejoué au retour attend de nouveau ; dans un `µeffect`, le passage suivant l'arrête aussi, et la suite du passage d'avant ne tourne jamais. Avec `always: true`, elle se termine quand même. Avec `id: 'nom'` (`await µafter 300, id: 'secousse'`), seule la dernière attente de ce nom reprend : une attente remplacée ne se termine jamais, et le code écrit après son `await`, `finally` compris, ne tourne pas. Au rendu serveur, elle ne se termine pas (voir plus bas).

```html
<script>
  secouer = ->
    $secoue = true
    await µafter 300
    $secoue = false
</script>
```

**Rechargement à chaud** (`mjs dev`). Quand vous modifiez un composant, ses minuteries suivent l'ancienne instance : celles du `<script>` repartent avec le nouveau code, celles qu'un gestionnaire a lancées s'arrêtent (leur déclencheur, un clic par exemple, n'a pas eu lieu dans le nouveau code) ; l'état `$` reste tel quel. Une limite : quand une version est refusée à la construction (une minuterie à la main, par exemple) et que le composant refusé est le seul du projet à employer `µevery` ou `µafter`, la version corrigée recharge la page entière, et l'état `$` repart de zéro.

## `setTimeout` et `setInterval` — refusés dans un composant

Dans le `<script>` d'un composant et dans ses gestionnaires, `setTimeout` et `setInterval` — écrits nus, lus sur l'objet global (`window.`, `globalThis.`, `self.`, `top.`, `parent.`, `frames.`, `document.defaultView.`, le `ownerDocument.defaultView.` d'un nœud, une chaîne comme `window.window.`, un nom écrit en clair ou assemblé de morceaux fixes comme `window['set' + 'Timeout']` ou ``globalThis[`set${'Timeout'}`]``), ou tirés de lui par décomposition (`{ setTimeout } = window`) — arrêtent la construction, à leur ligne, avec la réécriture à faire. Dans une accolade du gabarit — interpolation, attribut lié, condition, qui se recalculent à chaque rendu, et `:attach`, rejoué à chaque pose de la balise —, ils sont refusés aussi, sous les mêmes formes, `document['default' + 'View']['set' + 'Timeout']` et le `ownerDocument` d'un nœud compris ; dans `:attach`, seul un nom écrit en clair est lu (`window.setTimeout`), pas un nom assemblé de morceaux (`window['set' + 'Timeout']`). Une minuterie posée à la main continue de tourner quand le composant disparaît : sans son `clearTimeout` dans `µdestroy`, l'action part en retard, sur un composant qui n'est plus là — la bulle « Envoi dans 5 s — Annuler », fermée entre-temps, envoie quand même. `µevery` et `µafter` sont arrêtés par le framework, ne partent jamais pendant le rendu serveur, et gardent l'état au rechargement à chaud.

| Au lieu de | Écrivez |
| --- | --- |
| `setTimeout (-> f()), 500` | `µafter 500, -> f()` |
| `t = setTimeout …` puis `clearTimeout t` | `t = µafter …` puis `t()` |
| `setInterval (-> f()), 1000` | `µevery 1000, immediate: false, -> f()` (premier tir après le délai, comme `setInterval`) |
| `await new Promise (r) -> setTimeout r, 300` | `await µafter 300` |
| une action qui doit partir même après la disparition du composant | `µafter 2000, always: true, -> …` |

Restent libres, parce que ce code est partagé et vit autant que la page : le `<script module>` d'un composant, les modules `.civet.mjs` et `.coffee.mjs`, les fichiers de magasin. Le mot dans une chaîne, un commentaire ou une propriété d'un autre objet (`minuteur.setTimeout`) n'est pas une minuterie : il n'est jamais refusé. `typeof setTimeout`, le test de présence (`!window.setTimeout`, `not setTimeout`) et le test d'existence (`setTimeout?`, `window.setTimeout?`, `setInterval != null`) ne posent rien : ils ne sont pas refusés non plus. Un nom que le composant déclare lui-même n'est ni la minuterie globale ni l'objet global : un paramètre ou une variable d'une fonction, dans cette fonction ; une variable ou une fonction de la racine du `<script>` ou du `<script module>`, un nom importé (`@import setTimeout './outils.js'`), dans tout le composant, gabarit compris ; un nom que le gabarit met en portée — variable et index d'un `{for}` (`{for top in $liste}` puis `{top.setTimeout()}`), `{const}` de la boucle, valeur d'une branche `{success}` ou `{error}`, noms de `<@failed err reset>` —, dans son bloc. Ailleurs, `setTimeout` reste la minuterie globale, refusée, et `top` l'objet global. Limites : un nom calculé pendant l'exécution (`window[nom]`) et l'objet global passé par une variable (`w = window` puis `w.setTimeout …`) ne se lisent pas à la construction et passent ; la minuterie ainsi posée garde le défaut d'une minuterie posée à la main.

`µevery` et `µafter` ne partent jamais pendant le rendu serveur, comme `µmount` : ni posés à la racine du `<script>`, ni dans un `µeffect`, ni après un `await`. Une promesse qui attend `await µafter …` ne s'y termine donc pas : le rendu serveur l'attend jusqu'à son plafond (`settleMs`, 1 000 ms par défaut), puis envoie le bloc `{await}` dans son état d'attente. Un délai qui doit y courir (la promesse d'un bloc `await` qui se résout plus tard, par exemple) se pose dans le `<script module>` ou dans un module, où `setTimeout` reste libre :

```coffee
<script module>
  plusTard = (valeur, ms) -> new Promise((tenir) -> setTimeout((-> tenir(valeur)), ms))
</script>

<script>
  $fiche = plusTard({ nom: 'Ada' }, 300)
</script>
```

## `µawake` / `µsleep` — connexion & déconnexion

`µmount`/`µdestroy` encadrent la vie **entière** du composant. `µawake`/`µsleep` encadrent **chaque** passage dans le DOM. Le couple est **symétrique** : ce que `µawake` met en place, `µsleep` le retire.

`µawake` joue à **chaque** arrivée du composant dans la page, **première ouverture comprise**. À la première ouverture, il joue **avant** `µmount` : les deux jouent, dans cet ordre. Aux arrivées suivantes — un nœud déplacé (réordonnancement de liste, animation FLIP entre conteneurs), une page hibernée que le cache du routeur réveille —, seul `µawake` rejoue : `µmount` ne se redéclenche pas.

Ses props sont déjà là à son `µawake`, comme à son `µmount` : ce que son parent lui passe (`<@duel game={$game}>`) lui est posé avant qu'il n'entre dans la page — à la racine du parent, dans une branche de `{if}`, sous une nouvelle clé de `{key}`, dans une branche de `{await}`, dans une ligne de `{for}`, par `<@module>` ou dans la page d'une route, parent en Shadow DOM léger (`:lightDom`) compris —, que son module soit déjà chargé ou qu'il arrive avec lui ; une prop que l'enfant passe à son tour aux composants de sa racine leur est posée de même. Un `µawake` qui lance une demande avec sa prop (`µ.ajax.get "/app/duels/#{$game}"`) la lance avec la valeur que le parent lui donne.

Une limite : la reprise dans le navigateur d'une page rendue par le serveur (`ssr:markers`), quand le module d'un enfant est défini avant celui de son parent. L'enfant, déjà dans la page, se réveille dès que son module est défini, avant que son parent n'existe : son `µawake` voit ses valeurs de départ, et ses props arrivent avec son parent.

`µawake` ne joue que dans la page. Un composant qui arrive avec d'autres (les enfants d'un parent, la page d'un layout) et que l'un d'eux retire avant son tour — la garde `µurlChange` d'un layout qui renvoie ailleurs, le `µawake` d'un parent qui le retire ou le pose hors de la page — ne se réveille pas : ni `µawake`, ni `µurlChange`, et ce retrait ne joue pas `µsleep`. Le reste de son cycle est celui de tout composant qui quitte la page : il a reçu ses props et, s'il reste dehors, il est détruit à la microtâche suivante (`µdestroy` et les nettoyages de son script jouent), sauf une page que le routeur garde en mémoire. Remis plus tard dans la page, il se réveille : `µawake`, puis un seul `µmount` s'il a été détruit entre-temps, ses références `:this` posées ; `µawake` seul pour une page gardée en mémoire.

Une page que le routeur garde en mémoire ne se réveille que sous une adresse qui la montre, avec les paramètres de cette adresse (`&id`). Un layout quitté pour un autre garde en mémoire la page qu'il affichait ; quand il revient pour une adresse dont ce n'est plus la page, elle reste en mémoire sans `µawake`, et la page de l'adresse paraît à sa place, après le `µurlChange` du layout. Quand ce `µurlChange` renvoie ailleurs (une garde : un visiteur déconnecté renvoyé vers une autre page), la page qu'il affichait ne se réveille pas non plus, même sous sa propre adresse : seule paraît la page de l'adresse où la garde renvoie. Elle se réveille quand une adresse la montre de nouveau, `Précédent` compris. Il en va de même pour un layout dans le layout.

Un composant **détruit** puis recréé repart de zéro : c'est une nouvelle instance, `µawake` puis `µmount` y jouent tous les deux. C'est le cas d'un composant sous un `{if}` qui se referme puis se rouvre, et d'une page que le routeur n'a plus en mémoire (il garde les 10 dernières pages visitées). Un layout détruit emporte les pages qu'il gardait en mémoire : `µdestroy` y joue aussi. Un layout qui sort de la mémoire du routeur est détruit aussitôt s'il n'était plus affiché ; encore affiché, il garde ses pages, et les emporte quand il quitte la page.

| Moment | Hooks joués, dans l'ordre |
|--------|---------------------------|
| première ouverture | `µawake`, puis `µmount` |
| sortie d'une page que le routeur garde en mémoire | `µsleep` |
| retour sur cette page | `µawake` seul |
| composant retiré pour de bon (un `{if}` qui se referme, une page sortie de la mémoire du routeur) | `µsleep`, puis `µdestroy` |
| composant retiré avant que son arrivée ne joue (une garde qui renvoie ailleurs, le `µawake` d'un parent qui le retire) | aucun au retrait ; `µdestroy` s'il reste hors de la page, sauf une page que le routeur garde en mémoire |
| le même, de retour | détruit entre-temps : `µawake`, puis `µmount` ; une page gardée en mémoire : `µawake` seul |
| un nœud gardé par votre script, retiré puis remis plus tard dans la page (après sa destruction) | au retrait `µsleep`, puis `µdestroy` ; au retour `µawake`, puis `µmount` (la même instance, son état gardé) |

```html
<script>
  µawake ->
    @_arret = µevery 2500, immediate: false, -> $i++

  µsleep ->
    @_arret()
</script>
```

> ⚠️ Comme `µawake`/`µsleep` peuvent se rejouer plusieurs fois, stockez la ressource sur l'instance (ici `@_arret`, la main d'arrêt de la minuterie) pour la retrouver côté `µsleep`. Une seule mise en place dans `µmount` + nettoyage dans `µsleep` ne se relancerait **pas** après une reconnexion (la ressource resterait perdue).

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

> `µfailed($resultats)`, une variable seule entre parenthèses, est une autre lecture : l'erreur d'une valeur qui attend (cf. [3](03-reactivite.md), « Une valeur qui attend »).

`µfailed (err, reset)->` est l'**équivalent script** de la balise spéciale `<@failed err reset>…</@failed>` ([Éléments spéciaux](15-elements-speciaux.md)) : si un composant **descendant** plante (et n'a pas sa propre frontière), l'erreur remonte jusqu'ici, quelle que soit la profondeur du descendant. `err` est l'erreur capturée, `reset` une fonction qui re-monte le composant (nouvelle tentative).

La nouvelle tentative repart d'un état neuf, mais garde ce que son parent lui donne : ses attributs, ses props (objets et tableaux compris, reposées avant son premier rendu), les écouteurs que le parent a posés sur sa balise (`@nom={…}`) et son contenu glissé ; le parent continue ensuite de lui envoyer ses mises à jour. Limite : un composant écrit dans une ligne de `{for}` de son parent reprend son état par défaut, la ligne gardant sa référence vers l'ancienne balise.

```html
<script>
  µfailed (err, reset)->
    "<p>Oups : #{err.message}</p><button mjs-reset>Réessayer</button>"
</script>
```

> ⚠️ Contrairement à `<@failed>` (un vrai bloc template compilé, `@click=reset` devient un listener réel), la forme script `µfailed` renvoie une **chaîne HTML brute** : pas d'interpolation `{…}`, ni d'événement `@…` ni de directive `:…` compilés dedans. Le bouton de reset s'y marque par l'attribut `mjs-reset` (câblé automatiquement au clic), pas par `@click=reset`. Pour un fallback avec du vrai markup MJS (réactif, événements typés), préférez `<@failed>` — `µfailed` reste l'échappatoire pour un fallback texte minimal composé dynamiquement.

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
    µevery 1000, immediate: false, -> $secondes++
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
