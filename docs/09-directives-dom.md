# 9 · Directives DOM

> 📚 Tuto interactif correspondant : **Chapitre 8 — La directive `@attach`** (et `@this`, vu au **Chapitre 13**). Les encarts 🎓 *Pour débutants* dépliables donnent l'explication pas-à-pas ; le corps de la page reste la référence dense.

Quand le déclaratif ne suffit pas — appeler une méthode native (`canvas.getContext()`, `input.focus()`, `video.requestFullscreen()`), mesurer une géométrie, brancher une lib tierce — deux directives donnent un accès direct au nœud DOM : **`@this`** (récupérer le nœud) et **`@attach`** (exécuter une action de cycle de vie sur ce nœud).

## Référence au nœud — `@this=!{ref}`

`@this=!{ref}` stocke une **référence vivante** au nœud dans une variable **simple** (sans `$`). Au montage, `ref` reçoit l'élément DOM ; avant montage, il vaut `null`. D'où l'usage de `µmount` (ou `µeffect`) pour le code qui dépend du nœud. Quand le composant quitte la page, la référence reste lisible pendant `µsleep`, `µdestroy` et le nettoyage rendu par `µmount` ; elle repasse à `null` après eux.

```html
<script>
  canvas = null

  µmount ->
    ctx = canvas.getContext('2d')
    ctx.fillStyle = 'crimson'
    ctx.fillRect(0, 0, 100, 100)
</script>

<canvas @this=!{canvas} width="300" height="200"></canvas>
```

> ⚠️ La directive s'écrit **`@this`**, pas `@bind:this` (cette dernière n'existe pas en MJS). La forme avec `!` (`@this=!{el}`) est l'usage idiomatique.

> 🔥 **Point d'attention (perf) — une ref n'a pas de `$`.** Dans MJS, `$` signifie **réactif**. Une référence DOM n'a aucune raison d'être réactive : vous voulez juste un *pointeur* vers le nœud. Si vous mettez un `$` (`@this=!{$canvas}`), la ref devient réactive et **chaque écriture de propriété** (`$canvas.style.width = …`, `$canvas.className = …`) passe par le système réactif (`µ._mjs_deepSet` → *notify* + *invalidate*) au lieu d'une écriture directe. Sur un *hot-path* (HUD de jeu, animation, boucle qui repeint à chaque frame), le surcoût est **massif**. **Déclarez donc vos refs sans `$`** — et le compilateur **vous avertit** à la compilation si vous mettez un `$` sur un `@this`. Réservez `$` aux **vraies données** affichées dans le template (`{$pv}`, `{$nom}`…).

<details>
<summary>🎓 <b>Pour débutants</b> — pourquoi <code>µmount</code> et pas directement dans le script&nbsp;?</summary>

Le corps du `<script>` s'exécute dans le **constructeur** du composant, **avant** que l'élément soit inséré dans la page. À ce moment, `canvas` vaut encore `null` : le `<canvas>` n'existe pas en tant que nœud DOM.

`µmount` se déclenche **après** l'insertion. C'est là, et seulement là, que `canvas` pointe sur un vrai `HTMLCanvasElement` sur lequel vous pouvez appeler `getContext()`. Demander le contexte trop tôt planterait sur `null`.

</details>

Au démontage (par exemple un `{if}` qui bascule), `ref` est **automatiquement remis à `null`** : pas de gestion manuelle, pas de référence fantôme en mémoire.

### `@this` sur un composant enfant → l'instance

Posé sur un composant (et non sur une balise HTML), `@this` capture **l'instance du composant**, ce qui permet d'appeler ses méthodes publiques :

```html
<script>
  let canvas        # référence à l'instance enfant
</script>

<@tuto-canvas @this=!{canvas} color={$selected} size={$size}>

<button @click={canvas.clear()}>clear</button>
```

Ici `canvas.clear()` invoque la méthode `@clear` exposée par le composant `<@tuto-canvas>`. Comme pour une référence de nœud, **n'utilisez pas de `$`** : une variable simple (`let canvas`) suffit et évite tout surcoût réactif — vous ne lisez sa valeur que depuis un handler.

## Actions sur un nœud — `@attach`

Un **attachement** est une fonction de cycle de vie **attachée à un élément précis** du template. Elle reçoit le nœud au montage, fait son travail (poser des écouteurs, instancier une lib, observer une intersection…), et **retourne une fonction de nettoyage** appelée au démontage.

```html
<!-- module : trapFocus reçoit le nœud, retourne le nettoyage -->
@import trapFocus 'tuto/8/8-1/directive-attach.module.civet'

<div class="menu" @attach={trapFocus}>
  …contenu focusable…
</div>
```

La fonction d'attachement, telle qu'on l'écrit dans un module :

```coffee
export trapFocus = (_node)->
  handleKeydown = (e)-> …                 # piège le focus dans _node
  _node.addEventListener('keydown', handleKeydown)

  ->                                       # ← dernière valeur = nettoyage
    _node.removeEventListener('keydown', handleKeydown)
```

Comme pour `µeffect`, **la dernière fonction retournée est le nettoyage** : MJS l'exécute juste avant une ré-exécution de l'attachement *et* au démontage final du nœud.

> ⚠️ Deux écritures équivalentes : passer la fonction telle quelle (`@attach={trapFocus}` — MJS l'appelle avec le nœud), ou l'appeler explicitement avec le nœud (`@attach={trapFocus(_node)}` ou `@attach={trapFocus(el)}` : `_node` et `el` sont deux noms du nœud courant, au choix, à la racine comme dans une ligne de `{for}` ou une branche de `{await}`, avec `@attach.once` comme sans). Les deux marchent ; la première est la plus directe quand l'action ne prend que le nœud. Écrire `_node` ou `el` dans l'expression, c'est faire l'attache vous-même : l'expression est exécutée telle quelle, avec le nœud, et sa valeur de retour est le nettoyage. Un paramètre que vous nommez `el` (`@attach={(el) -> …}`) est le vôtre, la fabrique reçoit le nœud sous le nom que vous lui donnez ; et si le `<script>` du composant déclare lui-même une variable `el` (ou la lie par `@this=!{el}`), `el` reste la vôtre dans l'expression : le nœud n'y est alors connu que sous `_node`. Un `el` déclaré dans le `<script module>` ou importé par `@import` n'est pas reconnu comme le vôtre : ne le nommez pas ainsi.

<details>
<summary>🎓 <b>Pour débutants</b> — pourquoi pas un simple <code>µmount</code> sur le composant&nbsp;?</summary>

`µmount` ne se déclenche **qu'une fois** par vie du composant, à sa première ouverture. Mais un élément peut apparaître et disparaître plusieurs fois pendant la vie du composant — par exemple un menu sous `{if $showMenu}`. À chaque réouverture, il vous faut **rejouer** l'action (piéger le focus) et, à chaque fermeture, **nettoyer**.

`@attach` est lié à **l'élément**, pas au composant : il se déclenche à chaque fois que l'élément est monté, et son nettoyage tourne à chaque fois qu'il est démonté. Toute la logique (mise en place + nettoyage) reste co-localisée sur la balise concernée.

</details>

### Quand l'attache se rejoue

Une attache est posée **une fois par balise**. Elle se rejoue — nettoyage, puis nouvelle pose — quand la balise quitte la page puis revient, ou quand une variable qu'elle lit change (`$x`, `$$x`, `µlang`, cf. la fabrique ci-dessous) ; pas pour un changement ailleurs dans le composant. Une attache qui lit une variable peut, au montage, être posée, nettoyée puis reposée : son nettoyage doit tout défaire. Deux cas se rejouent encore à **chaque rendu**, par prudence, parce que MJS ne sait pas suivre ce qu'ils lisent : une attache qui lit un paramètre de route (`&piece`) ou une valeur `µ…` — le code seul compte, pas une chaîne : `mark('Q&A')` ou `mark('prix en µ')` ne lisent rien —, et une attache posée dans une ligne de `{for}` qui lit sa ligne ou une variable, rejouée chaque fois que la ligne se redessine, même pour un changement étranger à l'attache. Elles restent ainsi à jour quand on navigue ou quand la ligne change.

**Une seule pose, `@attach.once`.** Quand l'attache ne doit jamais être rejouée, écrivez `@attach.once={fabrique(args)}` : la fabrique est appelée une fois, à l'apparition de la balise, et son nettoyage joue à sa disparition (ligne retirée, `{if}` fermé, composant détruit). Entre les deux, rien ne la relance : ni le redessin de la ligne, ni le changement d'une variable qu'elle lit (`$x`, `&piece`, `µ…`). Même règle à la racine, dans `{for}`, `{if}`, `{key}` et `{await}` ; dans un `{for}` à clé, une ligne déplacée garde son attache (ni retrait ni pose). Le cas typique est la carte qui suit la souris : son rappel écrit `$light`, que la carte affiche — sans `.once`, chaque mouvement redessine la ligne et rejoue l'attache (retrait, puis pose).

```html
<script>
  $light = 0
  $cartes = [{ key: 'a' }, { key: 'b' }]

  suivre = (key) -> (node) ->
    ecoute = -> $light++
    node.addEventListener('pointermove', ecoute)
    -> node.removeEventListener('pointermove', ecoute)
</script>

{for p in $cartes by key}
  <div class="carte" @attach.once={suivre(p.key)}>{p.key} {$light}</div>
{end}
```

Seul `.once` existe : un autre modificateur (`@attach.onec`) est refusé au build, qui propose `.once`. La variable lue par la fabrique n'est lue qu'à la pose : pour une attache qui doit suivre une variable (`tooltip($content)`), gardez `@attach` sans `.once`.

### Attachements paramétrés (factory)

Pour passer des arguments, on écrit une **fabrique** : une fonction qui prend les paramètres et **retourne** la fonction d'attachement `(node)-> …`. Comme l'argument est lu dans un effet, l'attachement se **rejoue** quand une variable réactive de l'argument change.

```html
<script>
  $content = 'Hello!'

  tooltip = (msg)-> (_node)->
    _node.dataset.tooltip = msg
    -> null                        # nettoyage no-op
</script>

<input value=!{$content} />

<button @attach={tooltip($content)}>
  Survole-moi
</button>
```

Ici `tooltip($content)` est ré-évalué à chaque mutation de `$content` : MJS exécute le nettoyage précédent puis ré-attache avec la nouvelle valeur.

> ⚠️ Distinguer les deux niveaux : `tooltip` est la **fabrique** (prend `msg`), elle retourne **l'attachement** (prend `_node`). C'est cet attachement, et lui seul, qui peut retourner un nettoyage. Si vous n'avez rien à nettoyer, retournez quand même une fonction (`-> null`) pour rester homogène.

> 🔗 Voir aussi : [Bindings two-way](07-bindings.md) → `@this=!{ref}` côté binding et bindings de composant ; [Cycle de vie](16-cycle-de-vie.md) → `µmount` / `µsleep` / `µdestroy`. Pour réagir à l'apparition d'un nœud sans `@attach`, l'équivalent manuel est un `@this` + un `µeffect` qui teste la présence du nœud — `@attach` co-localise simplement les trois morceaux.

## Nom de transition de vue — `@viewTransition.nom`

Posée sur une balise ordinaire, `@viewTransition.nom` donne un **nom de transition de vue** à l'élément — un raccourci compilé vers `@style.view-transition-name=…` (famille `@style.<prop>`, chapitre [Classes & styles](08-class.md)). Deux éléments portant le même nom de part et d'autre d'une navigation sont appariés : le navigateur les *morphe* l'un vers l'autre.

```html
<img src="…" @viewTransition.hero>
```

> ⚠️ L'étiquette se pose **après le point** : `@viewTransition.hero`, toujours **fixe**. La forme à guillemets `@viewTransition="hero"`, la forme calculée `@viewTransition={expr}` et la forme conditionnelle `@viewTransition{cond}="hero"` sont refusées à la compilation — pour un nom calculé ou conditionnel, écrivez `@style.view-transition-name={expr}` ou `@style.view-transition-name{cond}="hero"` (chapitre [Classes & styles](08-class.md)).

> 🔗 Simple raccourci de style : la cascade complète des transitions de page (config, composant routeur, `<@view>`) est documentée au chapitre [Router (client)](17-router.md).

## Monter sans Shadow DOM — `@lightDom`

Posée sur une balise de composant, `@lightDom` le monte **sans Shadow DOM** — le composant partage alors le CSS de la page, et son style scopé ne l'isole plus.

```html
<@big-red-button @lightDom>
```

C'est exactement l'équivalent de l'attribut HTML `mjs-light`, déjà documenté au chapitre [SSR](19-ssr.md) → *Pièges* : `@lightDom` est la forme à écrire depuis le HTML d'un composant MJS, `mjs-light` celle qu'on écrit dans du HTML servi par un back. Conséquences (isolation, thèmes, SSR) : voir ce même chapitre plutôt que de les redire ici.

Les clics, eux, restent séparés comme avec une ombre : un clic dans le composant léger ne joue que ses propres gestionnaires, jamais ceux des éléments du composant qui le contient — sauf ceux qui l'entourent (sa balise, une enveloppe), qui jouent avant les siens, un `.stop` du léger ne les arrêtant pas (cf. [Événements](06-evenements.md) § *Le modèle : un seul listener délégué*).

En mode léger, `:host` écrit dans le `<style>` du composant est réécrit au montage en nom de balise (`:host(.large)` → `mjs-big-red-button.large`) : le même `<style>` vaut dans les deux modes, et le composant léger est `display: block` comme en mode ombre. `:host-context(.dark)` suit la sémantique CSS complète de cette pseudo-classe — elle matche aussi bien un **ancêtre** porteur de la classe qu'un hôte **lui-même** porteur : la réécriture produit donc un groupe qui couvre les deux formes (`.dark mjs-big-red-button` **et** `mjs-big-red-button.dark`), à la même spécificité. Limite : plusieurs `:host-context` **chaînés** (`:host-context(.a):host-context(.c)`, rare) ne couvrent que les deux cas extrêmes — tout sur des ancêtres, ou tout sur l'hôte — pas les combinaisons mixtes (un contexte porté par un ancêtre, l'autre par l'hôte). Le cas « tout sur des ancêtres » suppose lui-même des ancêtres **distincts**, un par contexte (chaîne de descendance stricte, ex. `.a .c mjs-big-red-button`) : un **seul** ancêtre qui porte les deux classes à la fois (`<div class="a c">`) ne correspond pas à ce sélecteur. Piège propre à ce mode : `::slotted()` reste sans effet (pas de Shadow DOM, pas de `<slot>` à cibler).

## Un `@xxx` inconnu est un écouteur d'événement, toujours

Un attribut `@xxx` que le compilateur ne reconnaît pas comme directive devient un écouteur DOM sur l'événement `xxx`, sa valeur compilée comme du **code** (pas comme une chaîne littérale). Le compilateur ne juge JAMAIS un nom d'événement, ni sa casse ni sa proximité avec une directive : `@confirn` écoute un événement nommé `confirn`, `@confirm` est la directive. L'orthographe d'une directive est donc à votre charge sur un élément.

```html
<button @confirn="Supprimer">Supprimer</button>
```

Il en va autrement des balises de **SECTION** (`<style>`, `<script>`, `<theme>`, `<routes>`), qui n'atteignent jamais le DOM : un attribut que le compilateur ne connaît pas y arrête le build avec une suggestion (`<style @dsplay="inline">` → `@display`), et une directive racine mal écrite (`@improt`) aussi.

> ⚠️ Une directive à valeur entre guillemets (`@confirm`, `@title`…) écrite deux fois sur la même balise est refusée à la compilation, le message nomme la directive et la balise.

> 💡 **Un `@` devant un attribut booléen natif n'est ni une faute ni une directive.** Le compilateur tolère un `@` devant `value` et devant chacun des attributs booléens du HTML — `checked`, `disabled`, `open`, `readonly`, `required`, `selected`, `hidden`, `multiple`, `autofocus`, `muted`, `autoplay`, `loop`, `controls`, `allowfullscreen`, `async`, `default`, `defer`, `formnovalidate`, `inert`, `ismap`, `itemscope`, `nomodule`, `novalidate`, `playsinline`, `reversed`. `<details @open>` compile exactement comme `<details open>` ; `@open={$isOpen}` est une liaison unidirectionnelle ordinaire, et tous ces attributs, écrits avec ou sans `@`, se posent quand la valeur est vraie et se retirent quand elle est fausse. Ce n'est pas une écriture à privilégier — la forme sans `@` reste la bonne — mais si vous la croisez dans du code, ce n'est ni une coquille ni une directive obscure : juste la forme `@` des mêmes attributs qu'ailleurs.

---

📚 **Apprendre en pratiquant** : ce chapitre correspond au **Tuto interactif n°8 (`@attach`)** — attachement simple (`trapFocus`) et fabrique paramétrée (`tooltip`) — ainsi qu'à la leçon `@this` du **Tuto n°13** (référence à un nœud DOM et à une instance de composant).
