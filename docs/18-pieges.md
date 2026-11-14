# 18 · Pièges & bonnes pratiques

> 📚 Pas de chapitre de tuto unique : cette page est une **synthèse** des pièges récurrents, croisés à travers tout le parcours. Les encarts 🎓 *Pour débutants* dépliables donnent l'explication pas-à-pas ; le corps de la page reste la référence dense.

Chaque piège est présenté **symptôme → cause → solution**. La plupart viennent de la nature **compile-time** de MJS (la réactivité et le rendu sont résolus à la compilation, pas par un Proxy au runtime) ou des idiomes du langage **Civet**.

## 1. Réactivité statique — un `$` caché dans une fonction

**Symptôme** : un affichage ne se met pas à jour alors que la donnée a changé. Le binding semble correct, mais reste figé sur sa valeur de départ.

**Cause** : MJS détecte les dépendances réactives par **analyse statique** du binding — il lit les `$x` qui apparaissent **directement** dans l'expression. Un `$x` lu *à l'intérieur* d'une fonction appelée par le binding n'est **pas** vu : l'effet est alors classé « mount-only » (joué une fois au montage, jamais re-déclenché).

```html
<script>
  $hidden = 1
  compute = -> $hidden * 2     # $hidden lu DANS la fonction → invisible au compilateur
</script>

<!-- ✗ figé : {compute()} ne dépend (visiblement) d'aucun $ → mount-only -->
<p>{compute()}</p>

<!-- ✓ : $hidden apparaît en clair dans le binding → tracké -->
<p>{compute($hidden)}</p>
```

**Solution** : faites apparaître le `$` **en clair** dans le binding (en l'argument), ou utilisez une **valeur dérivée** `$resultat = compute($hidden)` (le dérivé, lui, voit le `$hidden` qu'il lit). La règle : *ce que le binding doit suivre doit être lisible dans le binding*.

<details>
<summary>🎓 <b>Pour débutants</b> — pourquoi MJS ne « regarde pas dans » la fonction&nbsp;?</summary>

D'autres frameworks enveloppent vos données dans un Proxy et notent *au moment de l'exécution* quelle donnée a été lue. MJS, lui, fait ce travail **à la compilation** : il lit le texte de votre binding et y repère les `$`. C'est ce qui le rend rapide (zéro surcoût au runtime).

Le revers : il ne peut voir que ce qui est **écrit dans le binding**. Si la donnée réactive est planquée dans le corps d'une fonction, le compilateur ne la « voit » pas et ne sait pas qu'il faut rafraîchir quand elle change. D'où la règle : montrez-lui le `$`.

</details>

## 2. Mutation imbriquée échappée — objet qui « sort » de la portée trackée

**Symptôme** : `$todos[0].fait = true` re-rend normalement le `{for}` (réactivité profonde, path-tracking compile-time) — mais une mutation faite **après que l'objet a transité par une fonction externe non trackée**, ou sur un **alias réassigné**, ne déclenche rien.

**Cause** : MJS réécrit à la **compilation** chaque mutation profonde écrite sur le `$` lui-même (`$todos[0].fait = true`) en appel direct au runtime (`µ._mjs_deepSet`/`µ._mjs_deepCall`) — pas de Proxy sur ce chemin. Une variable qui garde un objet de l'état (`t = $todos[0]`) tient l'**enveloppe réactive** de cet objet : ce qu'elle écrit va dans cet objet-là, même si `$todos` change entre-temps, et prévient tout ce qui l'affiche. Réassignée en dur (`t = { ...t }`, `t = {}`), elle ne tient plus l'objet de l'état : ce qu'elle écrit ensuite ne regarde plus que sa copie. Pour les échappements courants (appel de fonction externe, `.push` d'un alias…), le compilateur pose automatiquement un **Proxy ciblé** de secours à la frontière — la réactivité reste donc préservée dans l'immense majorité des cas, y compris échappés.

```html
<script>
  $todos = [{ fait: false, texte: 'a' }]

  # ✓ réactif — écrit sur le $ lui-même, réécrit à la compilation :
  cocher = -> $todos[0].fait = true

  # ⚠️ cas limite — alias RÉASSIGNÉ en dur avant mutation :
  cochePeutEtreRatee = ->
    t = $todos[0]
    t = { ...t }        # réassignation nue → `t` devient intraçable
    t.fait = true        # ne notifie PAS (mutation sur une copie détachée, de toute façon)
</script>

<ul>{for t in $todos}<li>{t.texte} — {t.fait}</li>{end}</ul>
```

**Solution** : dans le doute (alias qui transite par un helper externe complexe, structure de contrôle inhabituelle), **réaffectez la variable racine** (`$todos = $todos.map(...)`) — la réassignation est toujours reconnue sans ambiguïté. Pour une donnée que vous remplacez *systématiquement* en bloc plutôt que de muter, utilisez `µraw` ([État brut](11-etat-brut.md)) — c'est la seule forme d'état où la réaffectation est **obligatoire**, jamais suivie même en profondeur.

**Le magasin `$$x` n'a pas ce filet** : un `$$x` (ou un chemin dedans) donné en argument à une fonction qui l'écrit de son côté ne redessine rien — surtout quand la fonction vient d'un module `.js`, que MJS copie tel quel sans jamais le réécrire. Le build le signale (`reactivity`) quand la fonction du `.js` écrit directement dans le paramètre qui reçoit le magasin ; il ne voit pas une écriture faite plus loin par une autre fonction. La règle et les voies sûres sont dans [Stores — règle d'aliasing](14-stores.md#sous-le-capot-depuis-la-statisation).

## 3. Nommage des fichiers — kebab-case obligatoire

**Symptôme** : un composant ne s'affiche pas, aucune erreur claire — la balise `<mjs-...>` reste vide ou non définie.

**Cause** : l'autoloader résout `<mjs-mon-composant>` vers le fichier `mon-composant.mjs` via une clé **mise en minuscules**. Un fichier nommé en camelCase (`MonComposant.mjs`, `monComposant.mjs`) produit une clé qui ne correspond plus au tag attendu → l'autoloading échoue **silencieusement**.

**Solution** : nommez **tous** les fichiers composants en **kebab-case minuscule**.

```
✓ mon-composant.mjs     → <mjs-mon-composant>
✓ card-item.mjs         → <mjs-card-item>
✗ MonComposant.mjs      (casse cassée, non trouvé)
✗ monComposant.mjs      (idem)
```

## 4. Idiomes Civet — interpolation et constructeur

Le `<script>` d'un composant est écrit en **Civet** (dialecte proche de Coffee/TypeScript). Deux écueils fréquents :

**Interpolation** — utilisez `"#{expr}"` (style Coffee) : c'est la **convention maison**, à préférer aux backticks template-literal JS (qui compilent aussi, mais sortent du style Coffee — cf. l'encart débutant ci-dessous) :

```html
<script>
  # ✓ convention maison :
  message = "Bonjour #{$nom}, #{$age} ans"
  # ✓ compile et fonctionne aussi, mais DÉCONSEILLÉ (hors convention) : message = `Bonjour ${$nom}`
</script>
```

**Constructeur** — écrivez `constructor(args)` **explicitement**. Le raccourci `@(args)` (assignation automatique des arguments) **n'existe pas** ici :

```html
<script>
  class Box
    # ✓ correct :
    constructor(width, height)
      @width  = width
      @height = height
    # ✗ n'existe pas : @(width, height)
</script>
```

> ⚠️ Rappel de style : dans le code MJS, on utilise la flèche **`->`** (style Coffee) ; `=>` n'est réservé qu'aux cas où la liaison de `this` est nécessaire (typiquement un `µeffect` qui doit toucher le composant via `@`).

> ⚠️ **Flèche sur une ligne qui affecte un `if … then … else`.** Dans le `<script>` comme dans le `<script module>`, `f = => x = if a then 'b' else 'c'` (de même avec `unless`, `switch`, `try`, `for` ou `while`) est refusé à la compilation : Civet compile cette forme en JavaScript invalide, et le message le dit, avec la ligne produite. Mettez la valeur entre parenthèses (`f = => x = (if a then 'b' else 'c')`), ou écrivez le corps de la flèche à la ligne suivante, indenté.

<details>
<summary>🎓 <b>Pour débutants</b> — pourquoi pas les backticks, j'en fais en JS&nbsp;?</summary>

En JavaScript moderne, on écrit `` `Bonjour ${nom}` `` avec des accents graves (backticks) et `${...}`. C'est l'habitude, mais le `<script>` MJS n'est **pas** du JS : c'est du Civet, qui suit la tradition CoffeeScript. Là, l'interpolation se note `"#{...}"` à l'intérieur de guillemets normaux.

Les backticks compilent en réalité tout aussi bien (Civet les laisse passer tel quel, `${...}` y fonctionne normalement, sigils `$var` compris) — ce n'est donc **pas** une erreur de compilation. Mais la convention de ce projet reste `"#{...}"`, pour rester dans l'esprit CoffeeScript et cohérent avec le reste du code MJS. Réflexe à prendre : guillemets `"…"` + `#{…}`, même si `` `${...}` `` fonctionnerait aussi.

</details>

## 5. Footguns de cast — la position du suffixe compte

**Symptôme** : vous placez le suffixe de cast après le `=!` → **le compilateur s'arrête** avec un message clair : *« Liaison two-way mal formée… le suffixe va sur le NOM de l'attribut »*.

**Cause** : le suffixe de cast doit être collé **au nom de l'attribut**, *avant* `=!`. Placé après le `=!`, il ne fait pas partie d'une liaison valide.

```html
<!-- ✓ correct — le cast est sur le NOM, avant =! -->
<input type="range" value.number=!{$stiffness} min="0" max="1" step="0.01">
<input type="checkbox" checked.bool=!{$accepte} />

<!-- ✗ erreur de compilation — suffixe de cast mal placé (après le =!) -->
<input value=!.number{$stiffness}>
```

**Solution** : écrivez le suffixe **sur le nom de l'attribut** : `value.number=!{$n}`, `checked.bool=!{$ok}`. Casts disponibles : `.number`, `.int`, `.float`, `.string`, `.bool` (alias `.boolean`).

> 💡 Sans cast, un `value=!{$x}` two-way renvoie toujours une **chaîne** (la valeur d'un `<input>` l'est nativement). Pour un nombre, `value.number=!{$x}` est quasi toujours ce que vous voulez sur un `type="number"`/`type="range"`.

## 6. Auto-derived — une seule expression

**Symptôme** : une valeur dérivée censée se recalculer ne réagit pas, ou le compilateur ne la reconnaît pas comme dérivé.

**Cause** : un `$y = ...` au niveau racine du `<script>` ne devient un **dérivé automatique** que si sa partie droite est **une seule expression**. Un bloc `if/else` multi-lignes n'est pas auto-dérivé.

```html
<script>
  $n = 5
  # ✓ dérivé auto (une expression, ternaire) :
  $parite = if $n % 2 == 0 then 'pair' else 'impair'
  # ✗ pas auto-dérivé (bloc multi-instructions) :
  #   $label =
  #     if $n > 10
  #       msg = 'grand'
  #       msg.toUpperCase()
  #     else 'petit'
</script>
```

**Solution** : ramenez le calcul à **une expression** (ternaire, appel de fonction pure). Si plusieurs instructions sont vraiment nécessaires, passez par un **`µeffect`** qui écrit dans le `$` cible.

> ⚠️ **Lectures cachées.** Une valeur dérivée se recalcule quand on la lit, après toute écriture du composant : un gestionnaire qui la lit reçoit la valeur du moment, même quand elle lit l'état en cachette (fonction ou méthode du `<script>`, accès calculé `$[k]`, méthode, accesseur, conversion ou itérateur d'un objet de votre application). Mais le gabarit ne la réaffiche qu'avec les `$` qu'elle lit en toutes lettres, et un `µeffect` qui la lit ne se relance qu'avec ces `$` et les siens : l'écran peut garder l'ancienne valeur. Un accès calculé `$[$k]` lu par le gabarit (ou par une valeur dérivée qu'il affiche) qui ne lit que l'état se relance, lui, à toute écriture du composant ; s'il appelle une fonction, il ne suit que ses dépendances connues : nommez-les avec `µderived`. Une variable sans `$` que votre code change, l'heure ou le hasard ne préviennent rien : sans écriture du composant, la valeur lue reste celle du dernier calcul. Nommez la dépendance : `µderived $v = expression, $x` ; l'écran suit dès que `$x` change.

> 🔗 Voir [Réactivité](03-reactivite.md) pour les valeurs dérivées et `µeffect`.

## 7. `@font-face` / `@import` dans le `<style>` d'un composant

**Symptôme** : la police déclarée ne s'affiche jamais (repli silencieux sur la police système), ou une feuille externe `@import`-ée ne s'applique jamais — dans les deux cas, **aucune erreur**, aucun avertissement dans la console du navigateur.

**Cause** : le `<style>` d'un composant est compilé puis adopté en `adoptedStyleSheets` sur son **Shadow DOM** — une feuille *construite*. Une feuille construite **ignore** ses propres `@import` (interdits par le navigateur dans ce type de feuille), et un `@font-face` déclaré dans une feuille shadow **n'enregistre jamais** la police (limite navigateur). Le composant continue de fonctionner, juste sans la police ou la feuille attendue.

```html
<!-- ✗ n'enregistre jamais la police, aucune erreur -->
<style>
  @font-face { font-family: 'Ma Police'; src: url(µasset('fonts/x.woff2')) }
  :host { font-family: 'Ma Police', sans-serif }
</style>
```

**Solution** : déclarez `@font-face` (ou la feuille externe) au niveau **document**, via `<@head>` — son contenu échappe au Shadow DOM :

```html
<@head>
  <style>
    @font-face { font-family: 'Ma Police'; src: url(µasset('fonts/x.woff2')) format('woff2') }
  </style>
</@head>

<style>
  :host { font-family: 'Ma Police', sans-serif }
</style>
```

Feuille externe (Google Fonts…) : même principe, avec un `<link>` au lieu d'un `@font-face` — `<@head><link rel="stylesheet" href="…"></@head>`.

> 💡 Le compilateur détecte lui-même un `@font-face`/`@import` oublié dans le `<style>` d'un composant et pousse un **warning de compile** (non-fatal, le build continue) qui pointe vers cet idiome — plus besoin de le découvrir à l'usage.

> 🔗 Voir [Éléments spéciaux](15-elements-speciaux.md) — section `<@head>` — pour l'idiome complet (`µasset`, dédup navigateur, feuilles externes).

## 8. Outils de débogage — `µdebug`, `µinspect`, `µ.debugMode`

Trois outils, tous **dev-only** : aucun ne doit rester dans du code livré, car la minification de production n'en retire qu'une partie. Au-dessus du niveau `'log'` de la clé `logLevel` (le défaut de production est `'error'`), elle retire les appels `console.log`, `console.info` et `console.debug`, mais pas le `debugger` de `µdebug`, ni sa trace `µ.log` — un `µ.log` de composant, que ce niveau rend seulement muet à l'exécution —, ni les `console.group` et `console.groupEnd` de `µinspect`, qui ouvrent encore un groupe vide à chaque changement. Les `console.error` restent aussi, sauf au niveau `'silent'` (détail des niveaux : [34 · Déboguer](34-deboguer.md), « Le niveau de la console »).

**`µdebug $x`** — point d'arrêt **réactif** : sucre pur, réécrit en reffet qui `console.log` la valeur **et** pose un `debugger;` à **chaque** changement de `$x`.

```html
<script>
  µdebug $count   # à chaque changement de $count : log + pause debugger
</script>
```

**`µinspect $x`** — appelé à l'initialisation du composant, active un suivi console (`console.group`) qui affiche **From**/**To** à chaque mutation de `$x`, y compris les mutations profondes (`_mjs_deepSet`/`_mjs_deepCall`) — pratique pour traquer *où* une valeur change sans poser de `debugger` qui bloque l'exécution.

```html
<script>
  µinspect $todos   # chaque mutation de $todos loggée (avant/après), sans pause
</script>
```

**`µinspect $x.chemin`** — variante avec un chemin **fixe** (`.a.b`, `[0]`, `['clé']`, imbriqués) : suit toujours `$x` **entier** (même abonnement que `µinspect $x`), mais n'affiche que les changements de **ce chemin précis** — une portée d'affichage, pas un changement de ce qui est observé. Un appel (`.f()`) ou un index calculé (`[i]`) n'ont pas de sens ici et sont refusés à la compilation, comme un store (`µinspect $$x`) : `µinspect` suit l'état d'un composant. Il s'appelle dans le `<script>` : écrit dans le gabarit (`{µinspect($x)}`), il suit encore `$x` dans la console, mais l'écran n'affiche rien d'utile.

```html
<script>
  µinspect $utilisateur.profil.avatar   # loggé seulement quand .profil.avatar change, le reste de $utilisateur est ignoré
</script>
```

**`µ.debugMode`** (booléen, `false` par défaut — se met à `true` depuis la console du navigateur) active une **télémétrie visuelle** : chaque composant qui se re-rend est brièvement entouré (outline vert, ~300&nbsp;ms) — utile pour repérer à l'œil les re-rendus superflus. `µ.instances` (un `Set`) recense, en mode introspection, toutes les instances de composants MJS actuellement montées dans la page.

> 💡 Dans les DevTools du navigateur, les instances de composants (`<mjs-…>`) s'affichent avec un **formatter personnalisé** : `console.log(el)` sur un élément MJS déplie directement son état réactif (`_state`), ses nœuds DOM référencés et ses props/masques — sans avoir à naviguer `el._state` à la main.

## 9. `isnt` — identifiant réservé (opérateur Coffee/Civet)

**Symptôme** : `ParseError` Civet cryptique à la compilation (par exemple *« Found: "not" »*), sans rapport apparent avec le code écrit.

**Cause** : `isnt` est un opérateur Coffee/Civet (`a isnt b` → `a !== b`) — la pré-passe qui le convertit en `is not` réécrit le **texte**, aveuglément. Un `isnt` utilisé comme **identifiant** (`isnt = 5`, `$isnt`) est donc mangé de la même façon (`isnt = 5` devient `is not = 5`) avant même d'atteindre Civet.

```html
<script>
  # ✗ identifiant réservé — erreur de compilation explicite :
  isnt = 5
  $isnt = 5

  # ✓ usage OPÉRATEUR — jamais concerné :
  actif = etat isnt 'ferme'
</script>
```

**Solution** : MJS refuse ces deux formes à la compilation (message explicite qui cite `isnt` et précise « identifiant réservé ») — renommez (`isnt_`, `estPas`…). L'opérateur `a isnt b` reste, lui, disponible sans restriction.

> 💡 Même mécanisme d'auto-déclaration du `<script>` : ModularJS déclare lui-même une variable affectée sans déclaration (Civet compile le script sans `autoVar` ni `autoLet`), avec la portée qu'aurait `"civet autoVar"` : la fonction entière. La première affectation déclare la variable, sur place quand c'est une instruction du corps de la fonction, sinon en tête de cette fonction. `x =` suivi du membre droit, plus indenté, à la ligne **suivante** (objet sur plusieurs lignes, appel long) est déclaré comme la forme sur une ligne, au premier niveau comme dans une fonction ; une réaffectation plus bas (`x = {v: x.v + 1}`) ne déclare rien de plus. Une affectation écrite dans une expression (`String(o = 1)`, `if m = /a(b)/.exec(s)`), dans une branche, une boucle ou un bloc `do` déclare sa variable en tête de la fonction : la variable vaut encore après le bloc, et une fonction créée dans une boucle voit la dernière valeur (`[3, 3, 3]`), comme avec `autoVar` (avec `autoLet`, la variable vaudrait pour le bloc seul). Un nom lié dans un bloc (variable d'une boucle `for x in liste` ou d'un `catch e`, `if x := …`, motif d'un `switch`, classe ou fonction écrite dans un `if`) n'existe que dans ce bloc, comme le lit Civet : `x =` écrit après ce bloc déclare une nouvelle variable, sur une ligne comme sur deux. La structure du script est lue dans l'arbre de Civet, jamais sur le texte : un champ de classe (`x = 1` dans une `class`, quelle que soit la forme de l'en-tête : `class A`, `new class`, `enregistre class`, classe rendue par une fonction, classe décorée…) reste une propriété de la classe et ne crée pas de variable du script, même quand le même nom est affecté dans une autre fonction, écrite avant ou après la classe, dans une branche ou non (il y est une variable de cette fonction) : une valeur globale du même nom (`location`, `NaN`) garde sa valeur dans le script, et le mot `class` écrit dans une chaîne ne compte pas. Une variable affectée dans le corps d'une `function` ou d'une méthode de classe appartient à cette fonction, comme avec `autoVar` : deux appels qui se chevauchent (une `function` qui s'appelle elle-même, deux appels `async` en même temps, une `function` qui en appelle une autre affectant le même nom) ont chacun la leur, une autre fonction ne la voit pas, et un paramètre réaffecté dans le corps ne masque aucune valeur globale du même nom ; quand la portée qui entoure la fonction affecte aussi ce nom, la variable est celle de cette portée, partagée. Une déclaration que vous écrivez vous-même (`x .= undefined`) est toujours gardée. Deux écarts avec `autoVar` demeurent : une variable lue **avant** l'instruction du corps qui l'affecte la première fois (depuis une fonction appelée plus haut) lève « Cannot access 'x' before initialization » au lieu de valoir `undefined` ; une fonction intérieure dont le corps est écrit sur ses propres lignes, et qui affecte un nom avant que sa fonction l'affecte plus bas, garde sa propre variable, là où `autoVar` partagerait celle de la fonction (écrit sur la ligne de la flèche, `g = -> o = 1`, son corps la partage). Dans ces deux cas, déclarez la variable vous-même, plus haut (`x .= undefined`).

## 10. `$`, `$$`, `µ`, `§`, `§§` — jamais comme nom de variable

**Symptôme** : une mutation censée toucher un élément (ou tout autre objet passé en paramètre) reste sans effet — **aucune erreur**, le build passe, rien ne bouge à l'écran. Ou bien une erreur de syntaxe cryptique du compilateur sous-jacent, sans rapport apparent avec le composant.

**Cause** : `$` (état du composant), `$$` (store), `µ` (runtime), `§` (contexte figé) et `§§` (contexte réactif) sont des symboles du framework. Un paramètre ou une variable qui porte le **même nom** que `$`/`$$`/`µ` masque le symbole dans tout le corps qui suit — le compilateur ne peut alors plus distinguer une vraie mutation d'état d'un accès à ce paramètre : les deux s'écrivent `$.xxx`. `§` et `§§`, eux, s'écrivent toujours suivis d'un nom (`§theme`, `§§count`) — utilisés seuls, ils ne forment aucun sucre reconnu et atteignent le compilateur sous-jacent tels quels.

```html
<script>
  $style = { color: 'black' }
  # ✗ le paramètre $ masque l'état — $.style.color part dans $style, pas dans l'élément voulu
  paint = ($) ->
    $.style.color = 'red'
</script>
```

**Solution** : le build refuse un paramètre, une variable, un import ou une écriture nue qui s'appellerait `$`, `$$` ou `µ` (message qui cite le nom et la ligne fautive), et refuse tout autant un `§`/`§§` isolé, non suivi d'un nom (message qui cite le symbole) — renommez (`el` pour un élément du DOM, `§theme`/`§§count` pour un contexte, par exemple). Le même refus couvre la variable et l'index d'un `{for}` (et tout autre nom introduit par le template — `{const}`, argument de `{success}`/`{error}`) : `{for $ in $list}` est refusé au même titre qu'un paramètre `$` dans le `<script>`.

```html
<script>
  $style = { color: 'black' }
  # ✓ el ne collisionne avec rien
  paint = (el) ->
    el.style.color = 'red'
</script>
```


## 11. `@nom` vit sur la balise du composant

**Symptôme** : un composant ne se crée plus (`document.createElement` rend un élément inconnu), plante au montage, ou cesse de marcher sans erreur claire.

**Cause** : dans un composant, `this` est sa balise : `@titre = …` pose `titre` sur l'élément HTML lui-même. Un nom qui existe déjà sur toute balise (`title`, `hidden`, `children`, `setAttribute`…) la masque.

**Ce que fait le build** :
- une propriété en lecture seule (`@children`, `@dataset`, `@offsetWidth`…) ou une méthode dont le cadre se sert (`@setAttribute`, `@dispatchEvent`, `@querySelector`… vingt noms) : **erreur**, qui dit de renommer — le build lit ces écritures par leurs détours (`@['setAttribute'] = …`, `Object.assign @, { … }`, déstructuration, alias `self = @` dans sa fonction, dans `µmount ->`) ; il ne refuse pas ce qui s'écrit sur un autre objet que la balise (une fonction que le script appelle avec `new` ou avec un autre `this`, un champ ou un bloc statique de classe), `Object.defineProperty(@, 'children', …)` redéfinit sans écrire et n'est refusé que pour les vingt méthodes, et une clé calculée à l'exécution ne se voit pas ;
- une propriété reflétée en attribut (`@title`, `@id`, `@hidden`…) : avertissement `[lint.naming]` — le composant ne se crée plus par `createElement` ;
- un nom de méthode courant (`@remove`, `@contains`, `@replaceWith`, `@matches`, `@closest`, `@animate`, `@focus`, `@click`) reste libre : le cadre prend la méthode de la balise elle-même pour retirer, remplacer, reconnaître ou animer le composant, lui rendre le focus (après une navigation, à la fermeture d'une fenêtre) ou rejouer son clic confirmé, la vôtre ne la gêne pas — `@matches = -> $profils.filter(…)` dans une appli de rencontres ne détourne plus le focus d'après navigation.

**Solution** : un nom à vous (`@titreCarte`, `@envoyer`) — ou un état `$titre`, qui ne vit pas sur la balise.

---

## 12. L'élément sous un point s'arrête à la balise d'un composant

**Symptôme** : `document.elementFromPoint(x, y)` rend `<mjs-carte>` alors que le doigt est sur un bouton de la carte — un glisser-déposer, une bulle qui suit la souris ou un bouton « remonter en haut » ne savent pas sur quoi ils tombent.

**Cause** : l'intérieur d'un composant est fermé (Shadow DOM fermé) ; le navigateur s'arrête à sa balise.

**Solution** : `µ.elementAt(x, y)` — l'élément le plus profond sous le point (coordonnées de la fenêtre, comme `e.clientX`/`e.clientY`), à travers les composants imbriqués (32 niveaux au plus), jusque dans la racine d'ombre native d'un composant léger qui en porte une, si elle est ouverte (une racine fermée posée par un autre code reste close) ; `null` hors de la fenêtre, et pour une coordonnée qui n'est pas un nombre (`NaN`, `Infinity`, `undefined`, une chaîne). Hors des composants, le même résultat que le navigateur. Rien n'est ouvert : le reste de la page ne voit toujours pas l'intérieur des composants.

```civet
lacher = (e)->
  cible = µ.elementAt(e.clientX, e.clientY)
```

## 13. Une fenêtre maison se ferme quand on clique dedans

**Symptôme** : un composant « fenêtre » se ferme au clic sur son fond (`<div class="fond" @click={…}>` autour de son `<@slot>`) ; un clic sur le texte qu'on a glissé dedans la ferme aussi.

**Cause** : le texte glissé n'a pas de gestionnaire : le clic remonte jusqu'au premier trouvé, celui du fond — comme pour une balise que le composant aurait écrite lui-même (cf. [6 · Événements](06-evenements.md)).

**Solution** : `.self` sur le fond — il ne répond qu'à un clic sur lui-même.

```html
<script>
  $ouverte = true
</script>
<div class="fond" role="button" tabindex="0" @click.self={$ouverte = false}>
  <div class="boite"><@slot/></div>
</div>
```

## 14. `@click` qui renvoie `false` n'annule pas l'action par défaut

**Symptôme** : `<a href="/x" @click={-> false}>` suit quand même le lien ; un formulaire s'envoie malgré le `false` renvoyé.

**Cause** : un `false` renvoyé par un gestionnaire n'annule rien dans MJS : de ce qu'il renvoie, seule une fonction compte, et elle est appelée.

**Solution** : `@click.prevent={…}`, ou `e.preventDefault()` dans le gestionnaire (cf. [6 · Événements](06-evenements.md), § Modificateurs).

## 15. Le HTML du gabarit est lu comme le lit le navigateur

MJS calcule au build où se trouve chaque valeur `{…}` dans l'arbre que le navigateur bâtira : il suit donc ses règles, et refuse ce que le navigateur réarrangerait dans votre dos. Chaque refus cite la ligne du fichier `.mjs` où se trouve la balise ou le texte en cause, dans un bloc `{if}`/`{for}` comme ailleurs.

- **Éléments non refermés** : `<ul><li>a<li>b</ul>`, `<tr><td>a<td>b`, `<select><option>a<option>b`, `<dl><dt>a<dd>b` sont du HTML valide ; comme le navigateur, MJS fait de chaque `<li>` (`<td>`, `<option>`, `<dd>`…) le frère du précédent. De même pour `<button>` dans un `<button>`, `<h2>` dans un `<h1>`, `<a>` dans un `<a>`, `<rt>` après un `<rt>` ; un `<col>` posé dans un `<table>` reçoit son `<colgroup>`, et `<tbody>` referme un `<thead>` resté ouvert.
- **Fermantes en double** : la fermante d'un élément déjà refermé d'office (le `</li>` du premier `<li>` dans `<ul><li>a<li>b</li></li></ul>`) est ignorée, comme le fait le navigateur, au lieu de refermer aussi ce qui l'entoure ; un `</p>` arrivé après la fermeture d'office de son `<p>` donne un `<p>` vide.
- **`<p>` et éléments de bloc** : `<p>a<div>b</div></p>` (de même avec `<li>`, `<dd>`, `<dt>`) est refusé à la construction — le navigateur referme le `<p>` avant la `<div>`. Un `<button>`, une cellule `<td>` ou un `<template>` entre les deux arrêtent cette règle : `<p>Texte <button><div>…</div></button></p>` est permis.
- **`<template>`** : son contenu est rangé à part (`template.content`), hors de la page. Une valeur `{…}`, un bloc (`{if}`, `{for}`…) ou un gestionnaire placé dedans est refusé à la construction ; un `<template>` entièrement statique reste permis. Sortez la partie dynamique du `<template>`, ou affichez-la dans un sous-composant.
- **`<?…?>`, `<!…>`** : le navigateur en fait des commentaires ; ils comptent comme tels et ne décalent rien.
- **`<textarea>` et `<title>`** : leur contenu est du texte pour le navigateur, aucun commentaire n'y est lu — `<textarea>a<!-->b</textarea>` affiche `a<!-->b`, `<textarea><!-- x --></textarea>` affiche `<!-- x -->`. MJS les garde de même, tels qu'écrits (une valeur `{…}` écrite dans ce commentaire n'est pas lue), et la fermante `</textarea>` l'emporte sur un `-->` écrit plus loin. Une balise écrite dedans y est un texte aussi : `<textarea><b x={$v}>gras</b></textarea>` affiche `<b x={$v}>gras</b>`, sans élément ni liaison. Une valeur `{…}` écrite dans le contenu, elle, est lue : elle écrit le texte de l'élément, au premier rendu puis à chaque changement (`<title>{$titre}</title>`, `<textarea>Bonjour {$nom}</textarea>`). Pour un champ, ce texte est sa valeur de départ, que la saisie remplace : pour suivre la saisie, liez `value=!{$x}` (cf. [07 — Liaisons](07-bindings.md)). Dans un `<svg>` ou un `<math>`, `<title>` est un élément ordinaire : un commentaire y reste un commentaire.
- **`</script>` dans une valeur d'attribut** : permis entre guillemets, dans une expression `{…}` (chaînes comprises) et dans une valeur sans guillemets, qui va jusqu'au blanc ou au `>` comme dans le navigateur (`<p title=a</script>b>` donne le titre `a</script` et le texte `b>`). Dans le gabarit et les valeurs que pose le code produit, il est écrit `<\/script>` (même valeur) : il ne refermerait pas la balise `<script>` d'une page où ce code serait mis en ligne. Un `</script>` dans le texte reste refusé.
- **Un guillemet jamais refermé dans une valeur d'attribut** (`<a href="/contact>Nous écrire</a>`) : le navigateur lirait tout le reste du fichier comme cette valeur, et la balise disparaîtrait avec tout ce qui la suit. La construction s'arrête sur `[GUILLEMET JAMAIS REFERMÉ]`, avec le fichier, la ligne et la colonne du guillemet ouvrant (`main.mjs:12:9`) : refermez-le. Un guillemet de l'autre sorte dans la valeur (`title="l'été"`), dans une expression `{…}`, un gestionnaire, un texte, un commentaire, un `<textarea>` ou un `<title>` ne compte pas, ni une balise écrite dans le contenu d'un `<xmp>`, d'un `<iframe>`, d'un `<noembed>` ou d'un `<noframes>` : le navigateur n'y lit que du texte. Dans un `<noscript>`, il compte : un navigateur sans JavaScript y lit des balises.
- **Tableaux** : un élément (un composant compris) ou du texte placé directement dans un `<table>`, `<tbody>`, `<thead>`, `<tfoot>` ou `<tr>` est refusé à la construction — le navigateur le retire du tableau et le pose avant lui ; un `<form>`, lui, y reste, vide et refermé sur place, et son contenu sort du formulaire (refusé de même : placez le `<form>` autour du `<table>`, ou dans une cellule). Seuls les rangées, cellules, sections, `<caption>`, `<col>`/`<colgroup>`, `<template>` et `<input type="hidden">` y restent : placez le reste dans une cellule `<td>`.
- **`<form>` dans un `<form>`, `<select>` dans un `<select>`**, `<a>` dans un `<a>` à travers un bloc : refusés à la construction — le navigateur ignore le second, ou déplace ce qui les sépare.
- **SVG et MathML** : une balise HTML de texte ou de bloc (`<span>`, `<div>`, `<p>`, `<b>`…) posée dans un `<svg>` hors d'un `<foreignObject>` en fait sortir : le navigateur referme le `<svg>` et la pose après lui, MJS aussi. Un `<![CDATA[…]]>` y est un texte, jusqu'au `]]>` : un `<` ou une accolade n'y ouvrent ni balise ni valeur, et la section part telle qu'écrite ; sans `]]>`, elle avalerait toute la suite du composant, elle est refusée.
- **`<html>`, `<head>`, `<body>`** dans un gabarit sont ignorés, comme par le navigateur (leur contenu reste) ; `<image>` y devient `<img>`.

## 16. « Imbrication trop profonde » à la construction

**Symptôme** : la construction s'arrête sur « IMBRICATION TROP PROFONDE », vers une ligne du gabarit.

**Cause** : le gabarit est imbriqué sur des milliers de niveaux — balises dans des balises, ou blocs `{if}`/`{for}`/`{await}`/`{key}` dans d'autres blocs — et l'analyse a épuisé la pile d'appels.

**Solution** : réduisez l'imbrication à quelques centaines de niveaux au plus, par exemple en découpant cette partie en composants.

## 17. Une donnée d'un visiteur dans un attribut `style` écrit en entier

**Symptôme** : une couleur choisie par un visiteur (profil, réglage, message) ajoute ses propres déclarations. Avec `<p style="color: {$c}">` et `$c = 'red; background-image: url(https://pisteur.example/p.png)'`, la page appelle un serveur tiers à chaque affichage ; `red; position: fixed; inset: 0; background: white` recouvre toute la page.

**Cause** : un attribut `style` écrit en entier reçoit la valeur telle quelle, `;` compris, au navigateur comme dans le HTML du rendu serveur. MJS ne la filtre pas : c'est une injection CSS, et l'écarter est à votre charge.

**Solution** : une propriété par liaison, `:style.<prop>={…}` (cf. [8 · Classes & styles](08-class.md)), et une valeur vérifiée avant d'être liée — une liste de valeurs permises, ou une forme stricte (`/^#[0-9a-f]{6}$/i`).

```html
<!-- à éviter : la valeur d'un visiteur dans le style écrit en entier -->
<p style="color: {$c}">…</p>

<!-- une propriété par liaison -->
<p :style.color={$c}>…</p>
```

Au navigateur, la valeur liée passe par `style.setProperty`, qui la refuse en entier si elle n'est pas une valeur de cette propriété — sans juger ce qu'elle désigne : une adresse venue d'un visiteur dans `:style.background-image` appelle toujours le serveur de son choix. Le rendu serveur avec le moteur `'happy-dom'` (le moteur par défaut du rendu à la demande, cf. [19 · SSR](19-ssr.md), § 8) applique la même règle à toutes les propriétés et à toute variable CSS liée (`--couleur={$c}`) : une valeur qui ajouterait une déclaration ou une règle (un `;` ou une accolade hors d'une chaîne et hors de parenthèses, par exemple) est refusée en entier, et la propriété garde sa valeur d'avant. Il ne vérifie pas toujours, en revanche, que la valeur convient à la propriété : une valeur que le navigateur aurait refusée (`transform: red`) peut figurer dans le HTML, et le navigateur l'ignore en lisant la page.

## 18. Une clé venue de données dans une écriture du magasin `$$` ou de l'état `$`

**Symptôme** : la console affiche « chemin d'état refusé (segment « __proto__ ») — mutation ignorée. » après une écriture comme `$$prefs[section][champ] = v`, ou `$reglages[section][champ] = v` dans un composant, et rien n'est écrit. Ou, sans message : une propriété apparaît sur tous les objets de la page (`({})[champ]` vaut `v`), une bibliothèque se met à se tromper — ou pire, un HTML que personne n'a écrit s'affiche et son script s'exécute. `section` venait de l'adresse de la page, d'un formulaire ou du message d'un autre utilisateur, et valait `'__proto__'`.

**Cause** : `$$prefs['__proto__']` est le modèle commun de tous les objets (`Object.prototype`) ; `'constructor'` mène à la fonction `Object`. Une écriture profonde du magasin ou de l'état d'un composant refuse ces deux noms, et `'prototype'`, dans le chemin qu'elle reçoit (le message ci-dessus) ; une écriture du magasin dont votre code lit d'abord l'objet — un élément trouvé (`$$taches.find(f)[section][k] = v`), `?.`, la variable de travail de CoffeeScript (`?=`, `or=`), une clé faite d'une expression (`$$prefs[req.section][k] = v`), une variable qui garde un objet du magasin, une lecture (`lu := $$prefs[section]`, puis `lu[k] = v`) — refuse d'écrire dans le prototype ou la fonction du navigateur (`Object`, reconnue à son code natif) qu'elle atteint, avec le même message pour un prototype, et pour une fonction du navigateur un message qui explique le piège (« $serie.values : $serie contient la fonction Object du navigateur, sans doute amenée par une clé venue de l'extérieur… ») — une fonction de votre appli, elle, reçoit l'écriture ; un chemin de l'état aussi, quand une lecture y a rangé l'objet qu'il atteint (`$reglages.p = $$prefs[section]`, puis `$reglages.p[k] = v`), et, quand cet objet est un prototype, toute écriture qui passe par l'état enveloppé : une forme qui lit avant d'écrire (`$reglages.p[k] += v`, `||=`, `?=`, `or=`), une variable qui le garde (`t := $reglages.p`, puis `t[k] = v`), `Object.assign($reglages.p, …)`, la rune `µproxy` — de même pour un prototype qui porte une étiquette (`Map.prototype`), et l'enveloppe d'un prototype ne se laisse ni geler ni fermer (`Object.freeze`, `Object.preventExtensions` lèvent leur `TypeError`) ; une variable qui garde un objet du magasin ou son prototype (`lu := $$prefs[section]`, `p := Object.getPrototypeOf($$prefs.m)`) refuse aussi l'écriture, même réaffectée ou reprise dans une boucle, et qu'elle prenne cet objet par une affectation logique (`lu ||= $$prefs[section]`, `&&=`, `??=`, `?=`), comme variable d'une boucle (`for t of $$liste`, `for t in $$liste`, `for (const k in $$prefs)` : la clé, une chaîne, mène à `String.prototype`), d'une boucle sur une copie qui garde les objets du magasin (`for t of $$liste.filter(f)`, `slice()`, `concat(…)`, `toSorted()`, `for p of Object.values($$prefs)`, `for [k, p] of Object.entries($$prefs)`, `Array.from($$liste)`, `[...$$liste]`, `$$carte.values()`), comme élément d'une telle copie (`$$liste.filter(f)[0]`, ou atteint par `find`, `findLast`, `at`, `pop`, `shift`, `splice` : `$$liste.filter(f).find(g)`, `actives.at(0)`, `copie.pop()`, `while (t = copie.shift())`, `copie.splice(0, 1)[0]`), comme paramètre d'un rappel écrit sur place (`$$liste.forEach((t) -> t[section][k] = v)`, `map`, `filter`, `find`, `some`, `every`, l'élément de `reduce`, le `forEach` d'une `Map` ou d'un `Set`, le rappel de `Array.from($$liste, f)` et de `Array.prototype.forEach.call($$liste, f)`, une méthode écrite en clé littérale : `$$liste['forEach'](f)`), par une déstructuration (`{ a } := $$prefs`, `[t] := $$liste`, `for { meta } of $$fiches`), par la valeur par défaut d'un paramètre (`(t = $$prefs.a) ->`) ou par `await` (`t := await $$prefs.a`). Une autre variable du même nom (un paramètre, dans une autre fonction ou un autre bloc) n'est pas celle-là : elle écrit comme JavaScript, et, quand ce nom est celui d'une variable déclarée ou affectée (`=`) d'une lecture du magasin, refuse seulement d'écrire dans le prototype d'une classe du langage (`Object.prototype`, `Array.prototype`, `Function.prototype`…, ceux d'une autre page compris) ou dans une classe du langage (`Object`), avec le même message. Écrivent en revanche là où JavaScript écrit (« pollution de prototype ») : une bibliothèque, votre code hors de `$` et `$$`, une fonction du moteur rangée à la racine de l'état (`$racine = $$prefs[section]`, `section` valant `'constructor'` : la fonction `Object`) puis écrite par l'état enveloppé (`$racine[k] += v`, une variable qui la garde, `Object.assign($racine, …)`), son `prototype`, le prototype d'une valeur simple (`String.prototype`, `Number.prototype`…, rangé tel quel pour que ses lectures marchent), `Function.prototype` rangé à la racine, le prototype d'un élément de la page (`HTMLDivElement.prototype`), le prototype que rend `Object.getPrototypeOf` sur l'état, une valeur du magasin passée à une fonction (`Object.assign($$prefs.constructor, …)`), dont une fonction nommée qui écrit l'élément qu'on lui donne (`marquer = (t) -> t[section][k] = v`, puis `marquer($$liste[0])` ou `$$liste.forEach(marquer)` : MJS ne suit pas une valeur d'une fonction à l'autre), la liste reçue en troisième paramètre d'un rappel (`(t, i, l) -> l[i][section][k] = v`), le résultat de `map` ou de `flatMap`, un rappel appelé autrement (`[].forEach.call($$liste, f)`, `Reflect.apply`, une méthode dont la clé est calculée : `$$liste[nom](f)`, un appel optionnel : `$$liste.filter(f).find?.(g)`), l'élément retiré du magasin lui-même (`$$liste.pop()`, qui n'y est plus), une autre variable du même nom qu'une variable de boucle, de motif ou de rappel (`for t of [o]`, `autres.forEach((t) -> …)`), ce qu'on atteint depuis une fonction de votre appli (`$cb.constructor`), et une classe de votre appli atteinte par `constructor` d'une de ses instances (`$serie = $$fiches.chien[section]`, puis `$serie.x = v` écrit `Chien.x`). Une fois le prototype pollué, tout code qui lit une option absente reçoit la valeur posée — le vôtre, une bibliothèque, le navigateur (les options de `fetch`) : une option `html` lue ainsi puis posée dans la page fait exécuter le script choisi par l'auteur des données. Les modules du cœur qui reçoivent des options (`µ.modal.fire` et ses raccourcis, `µ.modal.notify`, `µ.ajax`, `µ.socket`) ne lisent que celles que vous leur passez ; les tables que le cœur lit par un nom (la table des fichiers des composants, les balises que le chargeur attend et les dépendances préchargées au démarrage, les silhouettes, les réglages des effets, recopiés compris, le type d'un toast, les langues chargées : une langue inconnue choisie par une donnée reste vide et retombe sur la langue par défaut) et les requêtes qu'il envoie de lui-même (journal d'erreurs, rafraîchissement du schéma) ne prennent rien sur le prototype ; votre code, lui, hérite.

**Solution** : vérifiez une clé venue de données avant de l'employer — une liste de clés permises, `Object.hasOwn`, ou une `Map`, dont les clés ne touchent aucun prototype (cf. [14 · Stores](14-stores.md), « Sécurité » ; [03 · Réactivité](03-reactivite.md)) : une écriture refusée est une donnée perdue, et vos objets hors de `$` et `$$` n'ont pas ce refus. Dans votre code, lisez une option seulement si l'objet la porte en propre (`Object.hasOwn(opts, 'html')`), ou rangez vos options dans une table sans prototype (`Object.create(null)`).

```civet
SECTIONS := ['affichage', 'sons']
if SECTIONS.includes(section) and Object.hasOwn($$prefs[section], champ)
  $$prefs[section][champ] = valeur
```


## 19. `from`, `of`, `async`, `then`, `when` comme noms de variable

En Civet, le `<script>` déclare une variable à sa première affectation (`total = 0`). `from`, `of`, `async`, `then` et `when` sont des noms comme les autres : `from = …` déclare `from` au premier niveau du `<script>` et du `<script module>`, dans un module `.civet` partagé, dans une fonction ou dans un `µeffect`.

**Symptôme** : une erreur de lecture de Civet (« Failed to parse ») sur une ligne `then = …`, ou sur un appel sans parenthèses comme `console.log then`.

**Cause** : `of`, `then` et `when` sont aussi des mots de Civet. `then` en tête de la première ligne du bloc d'un `if` (`if ok`, puis à la ligne `then = 1`) est lu comme le `then` de `if … then` ; `of`, `then` ou `when` après un appel sans parenthèses (`console.log then`) aussi. Civet s'arrête alors sur une erreur de lecture, avant même la compilation du composant.

**Solution** : écrivez l'appel avec ses parenthèses (`console.log(then)`), ou choisissez un autre nom (`ensuite`, `debut`…). En CoffeeScript (`lang="coffee"`), CoffeeScript déclare lui-même `from` et `async`, et refuse `of`, `then` et `when` avec son propre message.

## 20. `readonly`, `loop`, `undefined` comme noms de paramètre

**Symptôme** : la construction refuse une fonction avec le message « le paramètre « readonly » est lu par Civet comme un mot du langage, pas comme un nom de paramètre », qui cite la ligne du fichier (pour une expression venue d'un partiel inclus, le message le dit, sans ligne) et demande de renommer le paramètre — dans le `<script>`, le `<script module>`, un module `.civet`, une entrée serveur, un gestionnaire ou une expression du gabarit.

**Cause** : Civet ne lit pas ces noms comme des noms dans une liste de paramètres, et ne le dit pas. `readonly` est un mot de TypeScript : `(t, readonly) -> t` devient l'appel `(t, readonly)(function() { return t })`, de même avec `readonly?`, un défaut ou un type. `loop` est la boucle sans fin de Civet : `@jouer = (son, loop) -> son` ne crée aucune fonction, la ligne lance une boucle sans fin dès qu'elle s'exécute ; `({loop}) ->` et `(son, loop: boolean) ->` deviennent un appel. `undefined` (nu, avec un défaut, en reste, dans un tableau `([undefined]) ->` ou sous une clé `({a: undefined}) ->`) devient une affectation de `undefined` ; `({undefined}) ->` reste une fonction valide. Les mots de Civet `until`, `unless`, `not`, `is`, `and` et `or` deviennent un appel dans une décomposition (`({unless}) ->`) ou devant un type (`(t, not: number) ->`). Sans ce refus, l'erreur n'apparaîtrait qu'à l'exécution : au montage pour une méthode du composant, au clic pour un gestionnaire ou une fonction appelée plus tard, à l'appel de la fonction pour `undefined`.

```html
<script>
  # ✗ refusé à la construction :
  @show = (t, readonly) -> t

  # ✓ un autre nom :
  @show = (t, viewOnly) -> t
</script>
```

**Solution** : renommez le paramètre. Le même mot reste libre ailleurs : dans une chaîne, un commentaire, une clé (`{ readonly: true }`), une propriété (`o.readonly`, `$readonly`), un champ de classe, une décomposition (`({readonly}) ->`), un attribut du gabarit (`<input readonly>`) ou l'appel d'une fonction ainsi nommée (`readonly(1)`, `(readonly)(1)`). Une écriture se confond avec la forme refusée : l'appel d'une liste entre parenthèses qui contient le mot et reçoit une fonction pour unique argument (`(readonly)(-> 1)`, `(a, readonly)(-> 1)`) — écrivez `readonly(-> 1)`. En CoffeeScript (`lang="coffee"`), `(t, readonly) -> t` reste une fonction.

> ⚠️ **Non détecté** : `function m(t, readonly)` suivi de son corps. Civet en fait `function m() { return (t, readonly)(…) }`, que la construction ne sépare pas d'un appel voulu : la fonction perd ses paramètres sans aucun message. Renommez le paramètre.

> ⚠️ `(is) -> 1`, `(and) -> 1` et `(or) -> 1` : Civet retire le paramètre sans rien dire — la fonction reste une fonction, mais sans ce paramètre, et la construction ne le signale pas. Choisissez un autre nom.

## 21. `eval`, `arguments`, `undefined`, `NaN`, `Infinity` ou un mot réservé comme nom de variable

**Symptôme** : la construction refuse le composant avec le message « « eval » ne peut pas être le nom d'une variable », qui cite la ligne du fichier, la raison, et demande un autre nom.

**Cause** : le `<script>` et le `<script module>` d'un composant tournent en JavaScript strict. `eval`, `arguments` et les mots réservés (`await`, `yield`, `let`, `static`, `implements`, `interface`, `package`, `private`, `protected`, `public`, `class`, `default`…) n'y peuvent être ni déclarés ni affectés ; `undefined`, `NaN` et `Infinity`, déclarés dans le script, masqueraient la valeur de JavaScript dans tout le composant, code produit par ModularJS compris. Sont refusés, au premier niveau comme dans une fonction : l'affectation (`eval = 1`, `undefined ||= 0`, `NaN++`), la déclaration (`NaN := 1`, `undefined := 0`, `Infinity .= 0`), la décomposition, jusque dans un reste (`{implements} = o`, `[a, undefined] = liste`, `{a: undefined} = o`, `[a, ...Infinity] = liste`), le paramètre (`(eval) ->`, `({NaN}) ->`), la variable d'une boucle (`for NaN in liste`), d'un `catch` (`catch eval`, `catch {NaN}`, `catch [Infinity]`) ou d'un `if` / `while` qui déclare (`if NaN := lire()`), le motif d'un `switch` (`{NaN}`, `[NaN, ...reste]`), le nom d'une fonction, d'une classe ou d'un `enum` (`class Infinity`, `enum NaN`), le nom qu'importe une directive `@import` (`@import NaN 'lib/a.civet'`, `@import default undefined 'x.mjs'`), cité à la ligne de la directive.

```html
<script>
  # ✗ refusé à la construction :
  undefined := valeurParDefaut()

  # ✓ un autre nom :
  absent := valeurParDefaut()
</script>
```

**Solution** : choisissez un autre nom. Le contrôle lit le script comme le lit Civet : le même mot reste libre dans une chaîne, un commentaire, une expression régulière, une clé (`{ let: 1 }`, `{undefined: v} = o`), une propriété (`o.await`, `$undefined`, `@eval = 1`), un champ ou une méthode de classe (`NaN = 1`, `eval = 1`, `eval()` dans une `class`, quelle que soit la forme de l'en-tête : `new class`, `enregistre class`…), une valeur par défaut (`(a = undefined) ->`), une valeur que compare un `switch` (`when undefined`, `[undefined, b]`), le nom d'origine d'un import par défaut (`default` dans `@import default e 'x.mjs'`, où seul `e` devient une variable), une clé du bloc `<vars>` ou un argument du gabarit. Un mot que Civet refuse déjà lui-même (`await = 1`, `let = 1`, `static := 1`) garde l'erreur de lecture de Civet (« Failed to parse »), à la même ligne. La ligne citée est celle du fichier ; la colonne se compte dans le script tel que ModularJS le donne à Civet (retrait du bloc ôté, `x = 1` réécrit `x .= 1`), comme dans les erreurs de lecture de Civet, sauf pour une directive `@import`, où c'est la colonne du nom dans la directive. Ce contrôle vaut pour Civet, le langage par défaut du script.

> ⚠️ Civet lit certains mots autrement qu'un nom de variable : `true`, `false`, `null`, `this` ou `return` (`[true] = o`, `false := 1`), `yield` en paramètre (`(yield) -> 1` devient un appel). La construction les refuse alors sur le JavaScript produit, avec le message de son analyseur (« [analyzer] parse error »), qui cite la ligne du code compilé. Renommez la variable.

## 22. Un signe inconnu au début d'un nom d'attribut

**Symptôme** : la construction refuse le composant avec le message « `$titre` sur <div> (ligne 3) : « $ » ne peut ni commencer un nom d'attribut ni séparer deux attributs », qui cite le fichier, la ligne, la balise et l'attribut tel qu'il est écrit.

**Cause** : un nom d'attribut s'écrit avec des lettres sans accent, des chiffres et `-`, `_`, `.`, `:` (`aria-label`, `data-user_id`, `xlink:href`). Devant le nom, seuls `@` (événement : `@click`), `:` (mot de MJS : `:class{…}`, `:style.color`) et `*` (effet : `*tilt`, `*tilt(max: 10)`) ont un sens ; `{...objet}` étale un objet, et un `{expr}` seul ne vaut que sur `<@slot {…}>`. Tout autre signe en tête de nom (`$titre`, `µtitre`, `#titre`, `%titre`, `~titre`, `^titre`, `&titre`, `+titre`, `!titre`), une lettre accentuée (`étiquette="x"`) ou un signe entre deux attributs (une virgule `a="1", b="2"`, un guillemet perdu `title="a"b"`, un commentaire `<!-- … -->` écrit dans la balise) est refusé : c'est presque toujours une faute de frappe, que la construction montre au lieu de la laisser passer sous un autre nom.

```html
<!-- ✗ refusé à la construction -->
<div $titre="Accueil" class="carte", id="a">…</div>

<!-- ✓ -->
<div title={$titre} class="carte" id="a">…</div>
```

**Solution** : corrigez le nom ou retirez le signe, et séparez les attributs par des espaces ou des retours à la ligne. La valeur d'un attribut reste libre : `title="50 % — n° 1"`, `value=!{$x}`, une valeur sans guillemets.

## 23. Un `$` dans la déstructuration d'un paramètre

**Symptôme** : le composant s'arrête dès son démarrage et la console affiche « TypeError: {(intermediate value)} is not a function », pour une fonction écrite `f = ({$q}) -> $q`. La construction, elle, ne dit rien.

**Cause** : `$q` est une variable d'état du composant, pas un nom de paramètre. La construction récrit `{$q}` comme une lecture de l'état (`{q: $.q}`), qui n'est pas une liste de paramètres valide : Civet en fait l'appel d'un objet, `let f = ({q: $.q})(function() { return $.q })`, au lieu d'une fonction.

```html
<script>
  # ✗ le composant s'arrête au démarrage :
  f = ({$q}) -> $q

  # ✓ un nom de paramètre sans $ :
  f = ({q}) -> q

  # ✓ pour ranger la valeur dans l'état, écrivez-la dans le corps :
  f = ({q}) -> $q = q
</script>
```

**Solution** : nommez le paramètre sans `$` (`({q}) -> q`, ou `(o) -> o.q`) ; pour ranger la valeur dans l'état, écrivez-la dans le corps de la fonction (`$q = q`).

---

📚 **Apprendre en pratiquant** : ces pièges n'ont pas de chapitre dédié — ils se rencontrent au fil des **34 chapitres du tuto interactif**. Gardez cette page sous la main comme aide-mémoire de débogage.
