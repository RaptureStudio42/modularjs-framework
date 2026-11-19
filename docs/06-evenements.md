# 6 · Événements

> 📚 Tuto interactif correspondant : **Chapitre 5 — Événements**. Les encarts 🎓 *Pour débutants* dépliables donnent l'explication pas-à-pas ; le corps de la page reste la référence dense.

On écoute un événement avec un attribut **`@<événement>`** : `@click`, `@input`, `@pointermove`, `@keydown`… Trois formes selon ce qu'on met à droite, plus une famille de **modificateurs** suffixés par un point. Sous le capot, MJS n'attache pas un `addEventListener` par nœud : il pose **un seul listener délégué** par type d'événement.

> 🔗 Sur une balise, `@` ne sert qu'aux événements : un mot de MJS s'écrit avec `:` (`:attach`, `:class{…}`, `:confirm`), un effet avec `*` (`*tilt`). La règle des trois signes : [Anatomie d'un composant](02-composant.md) § *Les trois signes d'une balise*.

> 🔤 Les corps de handlers (`@click={ … }`) sont compilés en **Civet** par défaut (comme le `<script>` du composant, cf. [Anatomie d'un composant](02-composant.md)) : le ternaire **espacé** `cond ? a : b` est accepté, `??` (opérateur existentiel) fonctionne, et un ternaire **collé** (`cond?a:b`) lève une erreur de compilation orientante plutôt qu'un comportement surprenant (`?` collé est l'opérateur d'existence Civet). Une expression régulière s'y passe aussi sans parenthèses, comme dans le `<script>` : dans `@click={ $v = $v.replace /"/g, ''; $n += 1 }`, le guillemet de l'expression n'ouvre aucune chaîne et `$n += 1` est bien exécuté (la règle : [Anatomie d'un composant](02-composant.md) § *Les commentaires*).

> ⚠️ **Pas de commentaire `#` dans une expression en ligne.** Un gestionnaire (`@click={ … }`), un callback de transition ou une interpolation `{ … }` sont chacun une expression isolée, pas un vrai fichier Civet/Coffee compilé dans son ensemble : un commentaire `#` écrit à l'intérieur n'est pas retiré et casse l'expression (erreur au runtime, ou pire, un JS silencieusement mal formé). Pour commenter à l'intérieur d'une de ces expressions, utilisez un commentaire JS `/* … */` (ou `// …` en toute fin d'expression) — celui-là est du JS valide, exécuté sans traitement particulier : `@click={$count += 1 /* incrément */}`.

## Les trois formes

### Corps de handler — `@click={ … }`

Entre accolades, on écrit **directement le corps** du handler — pas une fonction à part entière. L'événement DOM est disponible sous `e`, le nœud sous `el`.

```html
<div @pointermove={$m.x = e.clientX; $m.y = e.clientY}>
  The pointer is at {Math.round($m.x)} x {Math.round($m.y)}
</div>
```

On peut aussi mettre directement une expression : `@click={$count += 1}` ou `@click={$selected = color}`. Pas de currying ni de wrapping : c'est exécuté tel quel quand l'événement survient.

> ℹ️ **Inutile d'envelopper le corps dans une fonction** (`@pointermove={(event)-> …}`) : l'accolade attend le **corps exécuté**. Une fonction que le gestionnaire **renvoie** est appelée avec `(e, el)` — c'est ce qui fait marcher la référence ci-dessous —, donc `@click={(e)-> $count += 1}` fonctionne, mais c'est un détour. Écrivez le corps directement (`@click={$count += 1}`), et utilisez `e`/`el` — déjà en scope — plutôt que de redéclarer un paramètre. Une fonction **rangée** dans l'état (`@click={$rappel = -> …}`) est rangée, jamais appelée au passage. Rangée sur l'instance (`@click={@cb = -> …}`), elle est au contraire appelée aussitôt : l'affectation rend la fonction, et le gestionnaire appelle la fonction qu'il rend.

> ℹ️ **Une variable affectée dans un gestionnaire est la sienne**, comme en CoffeeScript, que le corps tienne sur une ligne (`@click={-> rang = $l.indexOf(2); $sel = rang}`) ou sur plusieurs : `rang` n'existe que le temps du gestionnaire, et la page n'y gagne aucune variable. Il en va de même pour `name`, `status`, `once` ou tout autre nom : `@click={-> name = 5; $t = typeof name}` donne `number`, et la fenêtre garde son nom. Une variable posée par la page qui porte le même nom n'est pas touchée : après `window.gx = 0`, `@click={-> gx = 1}` laisse `window.gx` à 0. Pour écrire celle de la page, écrivez `window.gx = 1`. En développement, un avertissement le dit au clic (une fois) quand ce nom est une globale ajoutée à la page, par l'appli, une bibliothèque ou le navigateur lui-même (`window.gx = 0`, `var gx` d'un script classique, `chrome` dans Chrome), jamais pour une propriété ordinaire de la fenêtre (`name`, `status`, `length`, `top`) ; rien en production. **Sauf trois sortes de globales du navigateur, dont l'affectation agit** : `location`, `opener` et les gestionnaires de la fenêtre (`onload`, `onresize`, `onhashchange`, `onpopstate`, `onbeforeunload`, `onerror`, `onmessage`, `onscroll`, `onstorage`… : ceux de la norme HTML que Chromium, Firefox et WebKit ont tous les trois) gardent leur effet, sur une ligne comme en bloc : `@click={-> location = '#aide'}` navigue, `@click={-> onresize = -> $n += 1}` pose le gestionnaire de la fenêtre. Un gestionnaire qu'un des trois n'a pas (`onpointerrawupdate`, `onpagereveal`, `ontouchstart`…) reste une variable du gestionnaire : écrivez `window.onpointerrawupdate = …`. Un nom que le gabarit donne au gestionnaire (variable d'un `{for location in $l}` qui l'entoure, `{const}`) reste le sien ; ailleurs dans le composant, `location = '#x'` navigue toujours.

> ℹ️ **Le contexte lu dans un gestionnaire est celui du composant qui l'écrit**, même dans une fonction appelée avec un autre `this` : `@click={$v = (function() { return §§theme.valeur }).call(enfant)}`, où `enfant` est un composant enfant, lit le `§§theme` du composant qui porte ce gestionnaire, pas celui de l'enfant.

> ⚠️ **Flèche sur une ligne qui affecte un `if … then … else`.** `@click={-> x = if a then 'b' else 'c'}` (de même avec `unless`, `switch`, `try` ou `for`) est refusé à la compilation : la flèche d'un gestionnaire devient une `=>`, que Civet compile ici en JavaScript invalide, et le message le dit. Écrivez le corps sans flèche (`@click={x = if a then 'b' else 'c'}`), mettez la valeur entre parenthèses (`-> x = (if a then 'b' else 'c')`), ou passez le corps de la flèche à la ligne suivante, indenté. Un `switch` s'écrit sur plusieurs lignes, chaque `when` à la sienne : écrit sur une seule (`-> x = switch $n when 0 then 'a' else 'b'`), Civet ne le lit pas, et la construction s'arrête sur son message.

> ⚠️ **Un gestionnaire resté ouvert est refusé.** Un corps qui s'arrête au milieu d'une expression — un opérateur, une virgule ou un mot comme `and` à sa fin (`@click={$x = 1 +}`), une parenthèse, un crochet ou une accolade jamais refermés (`@resize={f(1,}`) — arrête la construction, cité à son `}` dans le fichier qui l'écrit, partial compris, sur une balise comme sur `<@window>`, `<@document>` et `<@body>`. Le gestionnaire qui le suit, ou la suite du composant, ne le complète jamais : écrivez la fin de l'expression, ou retirez ce qui la laisse ouverte.

> ⚠️ **Une faute est citée au gestionnaire qui la porte.** Celui qui prend le gestionnaire suivant (`@click={$k ?}` suivi d'un autre, un gestionnaire resté ouvert dans un `{for}`) est cité à sa place, jamais à celle du voisin, cité `fichier.mjs:ligne:colonne`. Un `<script>` (celui du composant ou d'un partiel) qui s'arrête au milieu d'une expression (`a +`, `a and`, `f a,`) avant `<@failed>`, `<@window>`, `<@document>` ou `<@body>` est refusé, cité à son dernier signe : ce que ces balises lui ajoutent (la limite de réessai de `<@failed>`, un gestionnaire, une liaison `scrollY=!{$y}`, une classe `:class{$x}="actif"`) s'y collerait sans erreur et serait perdu.
>
> Une vraie faute de syntaxe dans un gestionnaire est dite par sa place (`fichier.mjs:ligne:colonne`) et par le message de Civet sur le texte que vous avez écrit ; la ligne fautive n'est pas recopiée dans le message. Un crochet de cycle de vie écrit dans un gestionnaire (`@click={@@µmount}`, comme `µmount`) est refusé sans sa ligne.

> Avec `=:` dans un gestionnaire, un commentaire va sur sa propre ligne (`$x =: v # note` est refusé), et `=:` ne prend pas de `if` en suffixe (`$x =: v if c` est refusé, comme avant).

> **`unless` dans un gestionnaire.** La forme en tête sur une ligne (`unless $ok then $x = 0`) est refusée : écrivez `$x = 0 unless $ok`. `return unless $v` (de même `return x unless $v`, `throw … unless $v`, `break` ou `continue` dans une boucle) quitte le gestionnaire sous sa condition, sur une ligne comme sur plusieurs ; ce qui suit un `;` sur la même ligne (`return unless $v; $x = 1`) s'exécute quand la condition le laisse passer. Devant un `;`, `unless` ne prend que l'instruction qui le précède (`$x = 1 unless $c; $y = 2` : `$y = 2` s'exécute toujours), sur toute ligne du corps, et dans un gestionnaire de `<@window>`, `<@document>` ou `<@body>` comme sur une balise. Dans le corps d'une flèche écrit sur sa ligne (`$l.forEach (z) -> $d += z unless z == 2`), `unless` ne prend que ce corps, comme en Civet et en CoffeeScript : la condition lit le paramètre de la flèche. Une virgule écrite après ce corps, à son niveau (`$x = $l.reduce (s, z) -> s + z, 0 unless $c` : `0` est l'argument suivant de l'appel), ou un `else` qu'aucun `then` du corps n'ouvre (`$x = if $v then -> 1 else 2 unless $c`), referment la flèche : `unless` prend alors toute l'instruction, comme en Civet. La condition se lit en entier, même quand elle commence par une regex ou une chaîne (`$x = 1 unless /a/.test($s)`, `$x = 1 unless 'a' == $s`). En fin de dernière ligne d'un corps de plusieurs lignes (`$a = 1`, puis `$b = 2 unless $c`), `unless` ne prend que la dernière instruction, comme en Civet et en CoffeeScript : les lignes d'avant s'exécutent toujours ; une instruction écrite sur plusieurs lignes (`$b = $a +`, puis `2 unless $c` en retrait ; une chaîne d'appels dont un rappel s'écrit en bloc, `.map (z) ->` et son corps, puis `.length unless $c`) passe en entier sous la condition. La condition peut commencer par une regex à drapeau (`unless /x/i.test($s)`).

> **Un corps sur plusieurs lignes.** L'accolade ouvrante peut finir sa ligne (`@click={`, le corps en retrait, puis `}`) ou porter la première instruction (`@click={$a = 1`, les suivantes en retrait, quel que soit ce retrait) : dans les deux écritures, les lignes qui suivent sont au niveau de la première. Une première ligne qui ouvre un bloc (`if $ok`, `f = ->`, `$l.forEach (z) ->`) a pour corps les lignes en retrait qui la suivent ; une ligne moins en retrait que la première d'entre elles est au niveau de la première ligne (`@click={if $ok`, puis `$a = 1` en retrait, puis `$b = 2` moins loin : `$b = 2` est hors du bloc et s'exécute toujours ; un `else` ou un `catch` à ce retrait suit le bloc). Une première ligne qui finit son bloc sur elle-même (`@click={if $ok then $a = 1`, `while … then …`) n'en ouvre pas : les lignes qui la suivent sont à son niveau et s'exécutent toujours. Une première ligne qui attend la suite (`$a = $b +`), et une ligne qui continue la précédente (`.length`, `id: 1`), gardent le sens de leur retrait. Les rappels de transition (`@introend={…}`) et les gestionnaires de `<@window>`, `<@document>` et `<@body>` s'écrivent de même.

### Référence de fonction — `@click={maMethode}`

Si l'accolade contient **un simple identifiant**, c'est traité comme une référence : la fonction est appelée avec `(e, el)`.

```html
<script>
  increment = -> $count += 1
</script>
<button @click={increment}>Clicked {$count}</button>
```

### Un nom seul — `@click=nom` (fonction) et `@click=@nom` (méthode)

La référence s'écrit sans accolades ou entre accolades (`@click=nom` et `@click={nom}` font le même appel), et le `@` devant le nom dit ce qui est appelé :

- `@click=nom` appelle la **fonction** `nom` : déclarée dans le `<script>` (`nom = -> …`, `nom := -> …`) ou le `<script module>`, importée (`@import nom 'chemin'`), fournie par le gabarit (variable ou indice d'un `{for}`, valeur d'un `{success}` ou d'un `{error}`, `reset` d'un `<@failed err reset>`), ou fonction du navigateur (`@click=alert`). Sans `@`, aucune méthode n'est cherchée.
- `@click=@nom` appelle la **méthode** `@nom` du composant (`@nom = -> …` dans le `<script>`, jusque dans `µmount`), ou une méthode de la balise (`@click=@focus`). La méthode reçoit le composant pour `this`, partout, fallback d'un `<@failed>` compris.

```html
<script>
  ajoute = -> $count += 1
  @remet = -> $count = 0
</script>
<button @click=ajoute>+1</button>
<button @click=@remet>Remettre à zéro</button>
```

Même règle pour tous les événements (`@input=filtre`, `@change=@valider`, `@keydown.once=touche`), avec ou sans modificateurs, dans un `{for}`, dans le fallback d'un `<@failed>` (`@click={reset}` relance le rendu, comme `@click=reset`) et sur les balises globales (`<@window @keydown=touche>`, `<@document @click=@fermer>`, `<@body>`). Dans le fallback d'un `<@failed>` et sur une balise globale, les écouteurs sont posés en direct, hors du routeur délégué : un modificateur n'y est pas géré et arrête la construction (`<button @click.once=reset>` dans un `<@failed>`, avec la ligne de l'attribut ; `<@window @resize.once=…>`) ; écrivez `@click={…}` et faites dans le corps ce que le modificateur ferait. Le nom qui suit un modificateur y est vérifié comme tout autre, avec la ligne de son attribut.

**Une fonction du navigateur passe**, hors celles que la fin de ce paragraphe refuse : `@click=alert` ouvre la boîte du navigateur, `@click=print` lance l'impression, même quand le composant a une méthode `@alert` ou `@print`. Elle est appelée comme toute fonction, jamais avec la balise pour `this` (le navigateur lèverait « Illegal invocation »), et elle reçoit l'événement, puis, sur un élément, l'élément : `@click=alert` fait `alert(event, élément)` ; dans le fallback d'un `<@failed>` et sur une balise globale, l'événement seul : `alert(event)`. **Une fonction du navigateur qui échoue quand elle reçoit l'événement est refusée à la construction** : `queueMicrotask`, `structuredClone`, `postMessage`, `requestAnimationFrame`, `atob`, `getComputedStyle` et `dispatchEvent`, qui lèvent une erreur à chaque fois, `createImageBitmap`, qui rend une promesse rejetée, `requestIdleCallback` et `cancelIdleCallback`, que WebKit ne fournit pas ; le message donne la bonne écriture, `@click={-> queueMicrotask(…)}`, avec les arguments que la fonction attend. `@click=setTimeout` et `@click=setInterval` sont refusés comme partout dans un composant : écrivez `µafter` ou `µevery`, que le framework arrête quand le composant disparaît. Ce sont les fonctions globales que TypeScript déclare pour le DOM (`alert`, `print`, `close`…) et celles de JavaScript (`parseInt`, `encodeURIComponent`…), plus `find`, hors des standards mais présente dans les trois navigateurs ; un nom propre à Node (`Buffer`, `process`) n'en est pas. Une fonction du `<script>` qui porte le même nom passe avant celle du navigateur.

**Un nom que le navigateur fournit sans être une fonction de gestionnaire** — un objet, un constructeur ou une valeur (`@click=Date`, `@click=console`, `@click=history`) — est refusé à la construction pour ce qu'il est, jamais dit absent : appelé avec l'événement, il ne ferait rien ou lèverait une erreur à chaque clic. Déclarez une fonction de ce nom dans le `<script>`, ou écrivez l'appel voulu entre accolades (`@click={history.back()}`).

**Un nom qui n'existe pas est refusé à la construction**, avec le fichier, la ligne de l'attribut dans le fichier (même quand la balise s'écrit sur plusieurs lignes, ou qu'un bloc `<@head>`, `<@failed>`, `<@window>` ou `<@element>` de plusieurs lignes, ou un commentaire qui cite une balise du langage, la précède) et la bonne écriture : `@click=nom` quand rien ne fournit `nom` (le message propose `@click=@nom` quand le composant a une méthode `@nom`), `@click=@nom` quand le composant n'a aucune méthode `@nom` (le message propose `@click=nom` quand une fonction `nom` existe : du `<script>`, du `<script module>`, importée ou fournie par le gabarit, variable d'un `{for}` et valeur d'un `{success}` ou d'un `{error}` comprises). Toutes les fautes d'un fichier sont données dans un seul arrêt, chacune une fois, avec sa ligne. Sans ce refus, le bouton serait mort : rien au clic, et « nom is not defined » en console seulement. **Refusés aussi, pour ce qu'ils sont** : un mot du langage que rien ne déclare (`@click=if`, `@click=return`, `@click=unless`, `@click=yes`… : les mots de JavaScript, de Civet et de CoffeeScript, `arguments` et `comptime` compris ; `yes`, `no`, `on`, `off`, `of`, `by`, `when` et `then`, que Civet accepte comme noms, sont appelés comme tout nom quand le `<script>` ou le gabarit les déclare : `on = -> …` puis `<@window @keyup=on>`), et une valeur écrite comme un nom (`null`, `undefined`, `true`, `false`, `this`, `NaN`, `Infinity`), qui lève une erreur à chaque événement sur un élément comme sur une balise globale ; pour n'écouter aucun événement, retirez l'attribut. Jamais vérifiée : une valeur qui n'est pas un nom seul — un appel (`@click={nom(1)}`), une prop qui reçoit une fonction (`@click=$rappel`), une fonction rangée sur `µ`, un chemin avec un point (`@click={o.valider}`). Dans un appel entre accolades (`@click={valider(1)}`, `<@window @keydown={valider()}>`), une méthode citée sans son `@` est signalée par un avertissement (`events`), sans bloquer.

### Forme nue — `@click`

`@<événement>` **sans valeur** appelle la **fonction du même nom** que fournit le `<script>` (`pointermove = (event)->`), le `<script module>`, un `@import` ou le gabarit, avec l'événement puis l'élément ; sans elle, la **méthode `@pointermove`** du composant, appelée de même (comme `@pointermove=@pointermove`). Quand les deux existent, c'est la fonction. Sans l'une ni l'autre, la construction refuse la balise, ligne du fichier nommée, comme `@click=nom` inconnu : une méthode de la balise elle-même (`@focus`, `@blur`) ou une fonction du navigateur ne compte pas. Sur `<@window>`, `<@document>`, `<@body>`, `<@html>` et `<@head>`, la forme nue appelle toujours la fonction du même nom, sans repli sur la méthode ni refus : pour une méthode, écrivez `@resize=@resize`.

```html
<script>
  pointermove = (event)->
    $m.x = event.clientX
    $m.y = event.clientY
</script>
<div @pointermove role="presentation">
  The pointer is at {Math.round($m.x)} x {Math.round($m.y)}
</div>
```

Ici `@pointermove` (nu) appelle `pointermove`. C'est le raccourci idiomatique quand le nom du handler = le nom de l'événement.

Un nom d'événement qui contient un **deux-points** (`mjs:load`, `commande:validee` — la convention des événements applicatifs, et celle du framework lui-même) s'écrit toujours **avec son corps** : `@commande:validee={@traiter(e)}`. La forme nue n'y est pas disponible — elle appellerait une fonction ou une méthode nommée `commande:validee`, ce qu'aucun langage n'accepte ; le compilateur la refuse avec un message explicite plutôt que de laisser passer un handler qui ne tirera jamais.

<details>
<summary>🎓 <b>Pour débutants</b> — quelle forme choisir&nbsp;?</summary>

- **Une ligne de logique simple** (incrémenter, basculer un booléen) → corps inline : `@click={$open = !$open}`.
- **Une méthode déjà nommée**, réutilisée ailleurs → référence : `@click={save}`.
- **Méthode dont le nom colle à l'événement** → forme nue : `@submit` appelle `submit`.

Dans les trois cas vous recevez `e` (l'événement) et `el` (l'élément). Pas besoin de `.bind(this)` ni de flèche `=>` : MJS lie le contexte pour vous (utilisez `->`, le style par défaut).

</details>

### Un gestionnaire natif — `onclick="…"`

Un `onclick="…"` (ou un autre `on…`) écrit en texte est posé tel quel, et c'est le navigateur qui l'exécute. S'il lit une expression — une accolade qui en ouvre une (`onclick="if (ok) { f() }"`, `onclick="{$x}"`) —, sa valeur devient calculée, et le filtre des attributs ne pose jamais un `on…` calculé : la balise le recevrait vide, la construction le refuse, avec le fichier, la ligne et la forme à écrire, `@click={…}`. Sur une balise HTML ou SVG, la forme calculée `onclick={$x}` est refusée de même ; un nom en « on » que MJS ne compte pas parmi les événements du navigateur (`one={$x}`, `onsearch={$x}`) aussi, et le message donne alors les deux voies, sans nom d'événement : `@…={…}`, avec le nom de l'événement après `@`, si c'est un événement (`@search={…}`), un autre nom (`data-one`) sinon. Une balise tierce (un nom à tiret, `<x-truc>`) reçoit la forme calculée en propriété : `<x-truc onclick={$f}>` se déclenche au clic, `<x-truc one={$x}>` lit `one`. Des accolades qui n'ouvrent aucune expression restent du texte, et le gestionnaire marche : des accolades vides (`onclick="window.o = {}"`), le quantifieur d'une expression régulière (`/^a{2}$/`), une accolade dans une chaîne (`'{'.length`). Un `$x` écrit sans accolade dans ce texte (`onclick="f($x)"`) est lu comme une variable : la valeur devient calculée, et la balise ne reçoit pas le gestionnaire ; la construction vous en avertit, avec le fichier, la ligne et la forme à écrire, `@click={…}`.

## Modificateurs

On enchaîne des suffixes `.mot` sur le nom de l'événement. Ils s'appliquent **au moment du dispatch**, avant votre code (sauf `.once`, géré au niveau de la route).

| Modificateur | Effet |
|---|---|
| `.prevent` | `e.preventDefault()` — sur un lien (`<a href>`) ou un formulaire (`@submit.prevent`), retient aussi la navigation de MJS : elle n'agit qu'une fois l'événement fini, comme sur un lien ou un formulaire natif — posé par un parent sur la balise d'un enfant, il retient aussi le lien écrit dans l'enfant |
| `.stop` | `e.stopPropagation()` — arrête la remontée |
| `.self` | n'exécute le handler que si `e.target` est bien **ce** nœud (pas un descendant) |
| `.once` | le handler ne se déclenche qu'**une seule fois** (la route est retirée après) |
| `.propagate` | placé **sur l'enfant** : laisse l'événement **continuer à remonter** vers les ancêtres |
| `.emit.<nom>` | n'exécute aucun code : **émet** l'événement `<nom>` vers le parent (cf. [Émettre depuis le geste](#émettre-depuis-le-geste--clickemitnom)) |

```html
<!-- le <div> ET l'<input> réagissent : .propagate laisse l'événement remonter -->
<div @keydown={alert("<div> " + e.key)}>
  <input @keydown.propagate={alert("<input> " + e.key)} />
</div>

<!-- ici l'input « avale » l'événement : seul l'input réagit -->
<div @keydown={alert("<div> " + e.key)}>
  <input @keydown={alert("<input> " + e.key)} />
</div>
```

La même règle vaut pour ce qu'on glisse dans un composant : le clic remonte du contenu glissé vers le composant qui le reçoit.

```html
<!-- carte.mjs : un cadre autour de ce qu'on lui glisse -->
<script>
  $choisie = false
</script>
<div class="cadre" role="button" tabindex="0" @click={$choisie = true}><@slot/></div>
```

```html
<!-- page.mjs -->
<script>
  $panier = 0
  $aime   = false
</script>
<@carte>
  <h3>Bougie noire</h3>                                <!-- clic : le cadre répond -->
  <button @click={$panier++}>Acheter</button>           <!-- clic : le bouton, seul -->
  <button @click.propagate={$aime = true}>♡</button>    <!-- clic : le bouton, puis le cadre -->
</@carte>
```

> ⚠️ **Une fenêtre qui se ferme au clic sur son fond** se ferme donc aussi au clic sur ce qu'on a glissé dedans : posez `@click.self` sur le fond (cf. [Pièges](18-pieges.md) § 13).

> ⚠️ **`return false` n'annule rien.** Contrairement à un `onclick` écrit à la main, `false` renvoyé par `@click` ou `@submit` n'empêche ni la case d'être cochée, ni le formulaire d'être envoyé. Pour annuler l'action par défaut, posez `.prevent`, ou appelez `e.preventDefault()` dans le gestionnaire. (Sur un lien interne, c'est la navigation de MJS qui prend la main : cf. [Routeur](17-router.md).)
>
> ```html
> <!-- à éviter : le gestionnaire s'exécute, mais la case se coche quand même -->
> <input type="checkbox" @click={-> false}>
>
> <!-- juste : .prevent annule l'action par défaut, la case reste décochée -->
> <input type="checkbox" @click.prevent={$ouvert = true}>
>
> <!-- de même pour l'envoi d'un formulaire -->
> <form @submit.prevent={$envoye = true}>…</form>
> ```

> ⚠️ **Un suffixe inconnu est une erreur de compilation.** `@click.stopp`, `@click.prevnet`, `@click.emit` (sans nom) : le build s'arrête et nomme le fautif, avec la suggestion quand la faute est proche d'un modificateur réel. Corollaire à connaître : **un nom d'événement ne peut pas contenir de point** — `@user.created` est lu comme l'événement `user` suffixé du modificateur `created`, donc refusé. Nommez l'événement `user-created`.

> ⚠️ **`.capture` n'existe pas** en MJS. La phase de capture n'est pas exposée. Le modificateur de remontée, c'est **`.propagate`** : par défaut le routeur s'arrête au premier handler trouvé (le plus proche de la cible) ; `.propagate` sur ce handler lui dit de *laisser l'événement poursuivre* vers les ancêtres. C'est l'inverse logique du `.stop` de la plupart des frameworks — ici on **n'a pas** à stopper, on choisit explicitement de propager.
>
> 🚪 **L'échappatoire, pour le cas rare.** Un vrai besoin de phase de capture — piéger le focus, pré-empter un handler tiers *avant* qu'il ne s'exécute — se pose à la main, hors du modèle délégué, dans `µmount` : `node.addEventListener('click', h, { capture: true })`, retiré dans `µdestroy`. On sort alors de la délégation en pleine conscience, pour ce seul nœud ; c'est assez rare pour ne pas mériter un modificateur dédié (qui imposerait un second pipeline délégué en phase de capture).

## Le modèle : un seul listener délégué

MJS ne pose pas un écouteur par bouton. Pour chaque **type** d'événement utilisé dans le composant, il enregistre **un seul routeur** sur la racine du composant. Quand l'événement survient, ce routeur remonte de `e.target` vers la racine et route vers le(s) handler(s) du nœud concerné. Un événement qui remonte (`click`, `input`, `keydown`…) est routé **à la remontée**, comme si chaque gestionnaire était un écouteur posé sur sa balise. Conséquences pratiques :

- **Coût constant** quelle que soit la taille des listes : 1 000 boutons `@click` = 1 routeur, pas 1 000 écouteurs.
- Les nœuds ajoutés dynamiquement (`{for}`, `{if}`) sont **immédiatement** écoutés, sans ré-attachement.
- **`.stop`** appelle `stopPropagation()` : les autres gestionnaires de la même balise jouent encore, les ancêtres non — ni les `µon` du composant, posés sur sa racine, ni les écouteurs de la page. Il ne prive jamais la balise cliquée de ses propres écouteurs : ils ont déjà joué.
- Un écouteur **natif** posé sur une balise du composant (une bibliothèque, `:attach`) joue avant les gestionnaires `@…` du composant ; s'il appelle `stopPropagation()`, aucun d'eux ne joue — y compris celui d'une balise plus profonde que la sienne (même règle que la délégation de React ou de Svelte).
- La délégation fonctionne **aussi pour les événements qui ne remontent pas** (`focus`, `blur`, `load`, `error`, `scroll`, un événement maison sans `bubbles`…) : ceux-là sont routés à la capture, le routeur les voit passer quand même.
- Exception : **`submit`** est routé à la capture, avant les écouteurs posés sur le formulaire. Un `@submit.prevent` retient donc toujours l'envoi, même si un script de la page coupe l'événement sur le formulaire : un envoi retenu ne doit jamais partir.
- Pour `touchstart` / `touchmove` / `wheel`, le listener est `passive` par défaut (scroll fluide) ; il bascule en non-passif automatiquement si le handler appelle `preventDefault` (via `.prevent` ou dans le corps).
- Chaque composant ne répond qu'aux éléments **qu'il a écrits**. Un composant léger (`:lightDom`, sans Shadow DOM) posé dans un autre partage pourtant ses balises avec lui : un clic sur le bouton `+1` du léger ne joue que le gestionnaire du léger, jamais celui d'un bouton du composant qui le contient. Seuls les éléments qui **entourent** le léger répondent aussi : le gestionnaire que le conteneur a posé sur la balise du léger elle-même (`<@compteur :lightDom @click={…}>`), ou sur une enveloppe qu'il a écrite autour de lui (`<div @click={…}><@compteur :lightDom></div>`). Celui-là joue **après** les gestionnaires du léger, comme un écouteur posé sur une balise qui l'entoure, et un `.stop` posé dans le léger l'arrête. Même règle pour un bouton qu'un composant écrit entre les balises d'un léger : seul son auteur y répond.
- Ce qu'on **glisse dans un composant** — écrit entre ses balises, affiché par son `<@slot>` — suit la règle de tous les événements : le premier gestionnaire trouvé en remontant joue, et la remontée s'arrête là. Elle traverse le composant qui reçoit : un titre glissé, sans gestionnaire, laisse le clic arriver au cadre que ce composant a écrit autour de son `<@slot>` ; un bouton glissé qui a son `@click` joue seul, le cadre n'en sait rien ; avec `.propagate`, son gestionnaire joue, puis celui du cadre. Le survol suit : pour `@mouseenter`, `@mouseleave`, `@pointerenter` et `@pointerleave`, ce qu'on glisse dans le cadre fait partie de son intérieur. Un composant glissé garde ses propres gestionnaires, et le cadre le voit comme une balise glissée. Ce contenu-là est routé une fois sa cible atteinte, derrière les écouteurs natifs de la balise cliquée : un `stopPropagation()` natif posé sur elle arrête ses gestionnaires `@…`, un `.stop` posé plus haut ne la prive pas des siens, un masque de saisie posé sur un champ glissé a réécrit sa valeur avant la liaison, et un composant glissé joue ses propres gestionnaires avant celui que son auteur pose sur sa balise (un `.stop` du composant glissé l'arrête). Limite, contraire à l'ordre du navigateur : ensuite, son auteur joue avant le cadre qui le reçoit — y compris le gestionnaire qu'il pose sur une balise qui entoure le composant cadre, que le navigateur ferait jouer après le cadre, plus proche de la cible ; et un écouteur natif posé sur une balise glissée qui entoure la cible (pas sur la cible elle-même) joue après ces gestionnaires `@…`, son `stopPropagation()` ne les arrête pas.
- La délégation manuelle `µon 'click', '.item', (e, el) -> …` cherche l'élément visé en remontant depuis la cible du clic, sans jamais sortir du composant : son ombre et ce qu'on lui glisse (un `.item` glissé est visé), jamais un `.item` de la page qui l'entoure. Écrite dans une fonction (`$brancher = -> µon 'click', '.item', …`, rangée dans l'état et appelée plus tard), elle se pose sur le composant dont le `<script>` la porte.
- `µon` (comme `µ.on`) **rend une fonction qui retire l'écouteur**, sans attendre la destruction du composant : `arreter := µon 'click', '.item', choisir`, puis `arreter()` quand les clics ne doivent plus être suivis. Un écouteur posé dans `µmount` part toujours de lui-même à la destruction ; retiré avant, il n'y laisse rien en attente. Un deuxième appel ne fait rien. Appelée après la destruction, la fonction retire l'écouteur pour de bon : revenu dans la page, le composant ne le fait plus jouer (un `µmount`, rejoué au retour, pose un nouvel écouteur). Le motif `@click={$brancher()}` reste valable : le gestionnaire renvoie alors la fonction de retrait, qui ne retire pas l'écouteur que ce même événement vient de poser ; renvoyée à un clic suivant (`@click={arreter}`), elle le retire.

<details>
<summary>🎓 <b>Pour débutants</b> — « délégation », concrètement&nbsp;?</summary>

Imaginez une liste de 500 lignes, chacune avec un bouton « supprimer ». L'approche naïve attache 500 écouteurs — lourd à créer, à nettoyer, et à maintenir quand la liste change. La délégation pose **un seul** écouteur sur le conteneur : quand vous cliquez, l'événement « remonte » jusqu'à lui, et MJS regarde *quel* élément a été cliqué pour appeler le bon handler. Vous n'avez rien à gérer : vous écrivez `@click` sur chaque ligne comme d'habitude, MJS optimise dessous.

</details>

## Événements de composant — `µemit`

Un composant enfant communique vers son parent en **émettant** un événement avec `µemit`, que le parent écoute comme un événement DOM via `@<nom>`.

```html
<!-- enfant : stepper -->
<script>
  inc := -> µemit 'increment'
  dec := -> µemit 'decrement'
</script>
<button @click={dec}>-</button>
<button @click={inc}>+</button>
```

```html
<!-- parent -->
<script>
  $value = 0
</script>
<p>The current value is {$value}</p>

<@stepper @increment={$value += 1} @decrement={$value -= 1}>
```

`µemit 'increment'` déclenche, côté parent, le handler `@increment`. On peut passer une charge utile en second argument (`µemit 'increment', payload`), récupérée via `e.data` côté parent (MJS expose la charge utile sur `e.data`, **pas** `e.detail` — le nom natif `CustomEvent.detail` a été volontairement abandonné).

### Émettre depuis le geste — `@click.emit.<nom>`

L'immense majorité des `µemit` ne fait qu'une chose : émettre, au clic, un nom fixe. Écrire un handler pour cette seule ligne est du bruit — d'où le suffixe `.emit.<nom>`, qui se pose sur **n'importe quel** événement écouté et n'exécute aucun autre code.

```html
<!-- enfant : stepper — sans une ligne de <script> -->
<button @click.emit.decrement>-</button>
<button @click.emit.increment>+</button>
```

C'est exactement l'équivalent du `µemit 'increment'` écrit plus haut : même événement, même remontée, même écoute côté parent (`@increment={…}`).

La **charge utile** se pose dans la valeur de l'attribut, comme partout ailleurs dans le framework — c'est une expression, pas un nom :

```html
<!-- un émetteur par ligne, chacun avec l'identifiant de SA ligne -->
{for row in rows}
  <li @click.emit.select={row.id}>{row.label}</li>
{end}
```

Le parent lit `e.data` (`row.id` ici), à l'identique de `µemit`. Les modificateurs se combinent, et se posent **avant** — le nom émis se lit toujours en dernier :

```html
<form @submit.prevent.emit.saved={$draft}>…</form>
```

> ⚠️ `emit.<nom>` **clôt** le nom d'attribut. `@click.emit.save.stop` est refusé à la compilation (le `.stop` se pose avant : `@click.stop.emit.save`), et le nom émis ne peut contenir ni point ni apostrophe — `row-selected` et `mjs:done` passent, `user.created` non.

**Quand rester sur `µemit`** : dès que le geste fait autre chose qu'émettre — valider, calculer, écrire un état. `@click.emit.<nom>` est le raccourci du cas où il n'y a *rien* d'autre à faire.

### Écriture déclarative — `:emit.`

`µemit` s'écrit dans un handler, à l'initiative d'un geste. Il existe une seconde écriture, purement déclarative, posée directement en attribut sur un nœud du template de l'enfant : `:emit.<nom>={valeur}` émet l'événement `<nom>` vers le parent **chaque fois que la valeur change** — sans le moindre handler à écrire.

```html
<!-- enfant : indicateur de présence -->
<script>
  $online = navigator.onLine
</script>
<div :emit.status={$online}>{$online ? 'en ligne' : 'hors ligne'}</div>
```

```html
<!-- parent -->
<@presence @status={console.log('statut reçu :', e.data)}>
```

Le parent écoute exactement comme pour `µemit` : `@status={…}`, charge utile dans `e.data`. `:emit.once.<nom>={valeur}` est la variante « une seule fois » : l'émission a lieu **au montage**, jamais ensuite, même si la valeur change plus tard.

```html
<script>
  $id = crypto.randomUUID()
</script>
<div :emit.once.created={$id}>…</div>
```

**Quand choisir quoi**, les trois écritures d'un seul coup d'œil :

| Écriture | L'émission est déclenchée par | Exemple |
|---|---|---|
| `@click.emit.<nom>` | un **geste**, et le geste ne fait rien d'autre | `<button @click.emit.increment>` |
| `µemit '<nom>'` | un **geste**, au milieu d'autre code (validation, calcul, écriture d'état) | `save := -> …; µemit 'saved', $id` |
| `:emit.<nom>={valeur}` | une **valeur qui change** — aucun geste, aucun handler | `<div :emit.status={$online}>` |

> ⚠️ Une forme qui n'est ni `:emit.<nom>={…}` ni `:emit.once.<nom>={…}` (un nom vide, un troisième segment, un `once` mal placé…) est une erreur de compilation.

### Portée de l'événement — `bubbles`, `composed`

`µemit` construit son `CustomEvent` avec **`bubbles: true`** et **`composed: true`** par défaut. `bubbles` le fait remonter le DOM comme n'importe quel événement natif ; `composed` le fait en plus traverser **toutes les frontières de shadow DOM ancêtres**, jusqu'au `document` — pas seulement celle du composant parent direct, mais chacune des frontières intermédiaires, quelle que soit la profondeur d'imbrication.

> ⚠️ **Piège du double relais.** Un composant petit-enfant qui émet `paint`, un parent qui écoute ce `paint` et **relaie** l'information en émettant lui-même un événement du même nom, et un écran grand-parent qui écoute `@paint` : ce dernier reçoit **les deux** événements — le relais du parent, et l'original du petit-enfant, qui continue sa remontée au-delà du parent sans s'arrêter au premier écouteur satisfait. Le second, à cet étage, arrive avec un `e.data` qui n'est plus le bon (celui du petit-enfant, pas celui recalculé par le relais).

```html
<!-- canvas.mjs — petit-enfant, émet paint tel quel -->
<script>
  paint := -> µemit 'paint', { x, y }
</script>
```

```html
<!-- panel.mjs — parent, relaie sous un nom DISTINCT, jamais le même que celui reçu -->
<script>
  onPaint := (e)-> µemit 'panel-paint', e.data
</script>
<@canvas @paint={onPaint}>
```

Le remède tient dans cet exemple : des noms distincts par étage (`paint` puis `panel-paint`), pour qu'un `@paint` plus haut ne capte jamais l'original en transit. L'autre option est de couper la portée à la source, avec le **troisième argument** de `µemit` — un objet d'options fusionné dans l'initialisation du `CustomEvent` : toute clé **sauf `detail`** (qui n'a pas cours côté MJS, cf. plus haut) y est acceptée, `bubbles`/`composed` inclus.

```html
<script>
  paint := -> µemit 'paint', { x, y }, { bubbles: false }
</script>
```

Avec `{ bubbles: false }`, l'événement n'est capté que par un `@paint` posé sur l'élément qui émet lui-même : la remontée s'arrête net à la source, sans dépendre d'un `.stop` côté écouteur.

### Traverser la frontière — un natif remonte tout seul

Un événement natif déclenché **dans** un composant enfant remonte jusqu'au parent sans le moindre relais à écrire. Poser `@click` sur la balise de l'enfant suffit : le handler du parent joue, que l'enfant déclare ou non un `@click` de son côté.

```html
<!-- parent : rien à ajouter dans l'enfant -->
<@stepper @click={onAnyClick}>
```

Deux étages se superposent. D'abord le **DOM natif** : `click` est `bubbles: true` *et* `composed: true`, il traverse donc toutes les frontières de shadow DOM — y compris les *closed* de MJS — et remonte jusqu'au `document`. Ensuite le **routeur MJS**, qui a posé son routeur sur le shadow root du composant, à la **remontée** : quand l'événement passe, il part de `e.target` et remonte vers sa racine pour trouver un nœud porteur d'un handler ; s'il n'en trouve pas, il rend la main sans jamais appeler `stopPropagation`. L'événement poursuit donc sa route intacte, d'où la remontée « gratuite ».

Conséquence directement observable : **l'enfant est prévenu avant le parent**, comme dans le DOM. L'événement remonte et croise le shadow root de l'enfant avant celui du parent. Un `.stop` posé **dans l'enfant** coupe donc le handler du parent, et ce qui vient après (le `document` et les écouteurs tiers). La navigation d'un lien écrit dans l'enfant, elle, n'agit qu'une fois l'événement fini, comme l'action par défaut d'un lien natif : un `@click.prevent` que le parent pose sur la balise de l'enfant retient ce lien, comme un écouteur de la page qui appelle `preventDefault()` sur cette balise ou au-dessus d'elle, jusqu'au `document`. Seule exception à l'ordre : un événement né dans du contenu **glissé** (`<@slot>`) suit la règle décrite plus haut — après les écouteurs de sa cible, son auteur joue, puis le cadre qui le reçoit.

Cas d'usage typique : un composant « habillage » dont on veut simplement récupérer le clic sans lui faire déclarer quoi que ce soit.

```html
<script>
  audio = new Audio()
  audio.src = µasset('tuto/5/5-5/horn.mp3')   # µasset('chemin') résout un asset LOCAL (copié/hashé au build)
  honk = ->
    audio.load()
    audio.play()
</script>
<@big-red-button @click={honk}>
```

> 💡 **`µasset('chemin')`** résout un fichier **local** (image, son, police…) référencé depuis le script ou un attribut : le chemin est validé et remplacé par l'URL **hashée** finale au **build** (chemin absent → erreur de build explicite, jamais un lien mort silencieux). Marche aussi dans le `<style>` (`url(µasset('…'))`, cf. [Pièges](18-pieges.md) → polices). ⚠️ L'argument doit être un **littéral chaîne écrit en dur** (`µasset('x.png')`) — c'est une résolution **compile-time** (avant même la compilation du langage), pas un appel runtime : `µasset(variable)` n'est **pas** reconnu et part tel quel dans le JS compilé, où `µasset` n'existe pas.

> ⚠️ **Ça remonte — mais le parent ne sait pas *quoi* a été touché.** À cause du *retargeting* du shadow DOM, l'événement qui arrive chez le parent porte `e.target` = **l'hôte** (`<mjs-stepper>`), et son `composedPath()` commence à l'hôte : les nœuds internes de l'enfant sont invisibles (le shadow DOM est clos). Le parent apprend donc « on a cliqué quelque part là-dedans », jamais « on a cliqué sur le bouton + ». C'est exploitable pour fermer un menu, marquer un panneau actif, poser un focus — et rien de plus. **Dès qu'il faut distinguer un geste d'un autre, ou lire une donnée, c'est `µemit`** : un nom sémantique par geste, la charge utile dans `e.data`.

### Les natifs qui ne traversent pas — `composed: false`

Tous les événements natifs ne sont pas `composed`. Ceux qui ne le sont pas **meurent à la frontière du shadow DOM** : le parent ne voit rien, et aucun `@…` posé sur la balise de l'enfant ne se déclenchera jamais.

| `composed` | Événements | Le parent les reçoit-il ? |
|---|---|---|
| `true` | `click`, `mousedown`, `mouseover`, `pointerdown`, `wheel`, `contextmenu`, `input`, `keydown`, `keyup`, `focus`, `focusin`, `focusout`, `copy` | ✅ oui |
| `false` | `change`, `reset`, `select`, `invalid`, `load`, `error`, `scroll`, `play`, `pause`, `animationend`, `transitionend` | ❌ non — ils s'arrêtent dans l'enfant |
| *le drapeau ment* | `submit` — `composed: false` sous Firefox, **`composed: true` sous Chrome** | ❌ non — il ne sort ni de l'un ni de l'autre |

Le cas qui pique le plus est `change` : `bubbles: true` mais `composed: false`, il remonte donc bien **à l'intérieur** de l'enfant, où un `@change` local fonctionne parfaitement, mais il ne sort pas du shadow DOM. Même effet pour `submit` — un `@submit` posé sur la balise d'un composant qui contient le `<form>` ne partira jamais — mais pour une raison différente : là, Chrome annonce `composed: true` et retient quand même l'événement dans le shadow DOM (Firefox, lui, annonce `false`). Sur ce type précis, c'est le comportement qui fait foi, pas le drapeau. Le remède est un relais explicite côté enfant :

```html
<!-- enfant -->
<input value=!{$v} @change={-> µemit 'change', $v}>
```

```html
<!-- parent -->
<@@field @change={console.log('valeur validée :', e.data)}>
```

> 🔎 **Diagnostic en une ligne.** Un `@…` du parent qui ne part jamais, alors que le geste a bien lieu dans l'enfant : coller `console.log e.composed` dans un handler de l'enfant. Si c'est `false`, aucun réglage côté parent n'y changera rien — il faut relayer par `µemit`. **Une exception connue : `submit`**, qui répond `true` sous Chrome sans pour autant traverser ; s'il s'agit de ce type, ne cherchez pas plus loin et relayez.

> 🙋 **`mouseenter` / `mouseleave` : l'exception qui trompe.** Ils sont `composed: false` *et* `bubbles: false`, et pourtant un `@mouseenter` posé sur la balise de l'enfant se déclenche bien. Ce n'est pas l'événement interne qui a traversé : le navigateur en émet un **deuxième, distinct**, directement sur l'hôte, quand le pointeur entre dans l'élément. Le parent est donc prévenu que le pointeur est entré **dans le composant** — jamais qu'il est entré dans tel ou tel élément interne.

> 🙋 **Dans le composant lui-même**, `@mouseenter`, `@mouseleave`, `@pointerenter` et `@pointerleave` posés sur ses propres balises marchent : ces événements ne remontent pas, MJS les lit sur leurs jumeaux qui remontent (`mouseover`/`mouseout`, `pointerover`/`pointerout`) — un événement par élément, l'élément pour cible, jamais deux.

> 🔗 Voir aussi : [Bindings two-way](07-bindings.md) (`value=!`, `:group` — qui s'appuient sur le même système d'événements) et [Binding de classe](08-class.md) (un cas de dispatch « filtré » dérivé du même moteur).

## Navigation — `:confirm`, `:method` et `:callback`

Trois directives posées sur un lien (`<a>`) ou un formulaire (et, pour `:confirm`, sur un bouton) branchent du comportement de **navigation** — elles sont converties à la compilation en attributs `mjs-confirm`/`mjs-method`/`mjs-callback`, lus par la couche [Navigation (UJS)](21-navigation.md) qui intercepte clics et soumissions. Les attributs `mjs-*` compilés fonctionnent aussi tels quels dans du **HTML servi par le back** (pas de composant MJS requis) — la couche UJS les lit au niveau du DOM, pas du composant.

```html
<a href="/posts/42" :method="delete" :confirm="Supprimer ce billet ?">Supprimer</a>
```

- **`:confirm="message"`** — au clic, la question s'affiche et **rien ne part** tant que l'utilisateur n'a pas répondu. Refus → rien du tout : aucune requête, l'URL ne bouge pas, le formulaire n'est pas envoyé, et un `@click` de composant posé sur le même élément ne s'exécute pas non plus — ni, sur un bouton, les écouteurs de clic de la page (composant léger et HTML servi par le back compris). Acceptation → l'action repart d'elle-même, comme si la question n'avait pas existé. La boîte affichée est la **modale maison** du framework, aux couleurs de votre CSS ; on peut lui préférer celle du navigateur, ou brancher la sienne (ci-dessous).

  `:confirm` accepte aussi une **forme objet**, pour habiller les boutons de la modale maison sans toucher à `µ.config.confirm` : `:confirm={ text: 'Message', ok: 'Oui, supprimer', cancel: 'Garder' }` — clés `text`/`ok`/`cancel`, valeurs en chaîne littérale ou en appel `µt(…)`, aucune autre expression. Pour un site à plusieurs langues, écrivez `:confirm={ text: µt('archiver_question'), ok: µt('archiver') }` (ou `µt('clé', { n: 2 })` avec des variables) : le texte suit la langue, et après un changement de langue, le prochain clic montre la nouvelle. Les deux écritures se mêlent dans le même objet (`{ text: µt('archiver_question'), ok: 'OK' }`) ; une variable, une concaténation ou l'appel d'une autre fonction y sont refusés à la construction. `ok`/`cancel` habillent respectivement le bouton de confirmation et le bouton Annuler (`confirmButtonText`/`cancelButtonText` de `µ.modal.fire`, ci-dessous) ; omis, les libellés par défaut du framework s'appliquent.

  Une troisième forme, **expression** — `:confirm={$message}`, `:confirm={$a || $b}`, `:confirm={calculerMessage()}` — passe l'attribut tel quel dans le pipeline générique (même mécanisme que `title={$expr}` natif) : le message est **réactif**, relu à chaque clic (le framework lit l'attribut au moment du clic, jamais figé à celui du montage). Se distingue de la forme objet par son contenu : un hash d'options porte toujours au moins une `clé:` en tête, tout le reste est une expression.

- **`:method="get|delete|post|put|patch"`** — en HTML, un `<a>` ne sait que **demander** une page (`GET`) ; supprimer une ressource réclame un `DELETE`, qu'un lien nu ne peut pas envoyer — d'où les `<form>` invisibles écrits à la main dans les applications classiques. `:method` fait ce travail : au clic, requête au **verbe HTTP** demandé, form-encodée avec le jeton CSRF automatique (même chemin que la soumission d'un `<form>`). Le temps de la requête, le lien porte `aria-disabled="true"` et un second clic est ignoré — pas de double suppression sur une connexion lente. `:method="get"`, quelle que soit sa casse, ne change rien : c'est le verbe même d'un lien, qui reste un **lien ordinaire** — la navigation habituelle, sans avertissement, et préchargeable comme tout lien ([Router (client)](17-router.md) → *Préchargement des liens — `:preload`*). Seul un clic simple envoie la requête : avec Ctrl, Maj, Alt ou Cmd, au clic du milieu, sur un lien qui porte `target` ou `download`, ou vers une autre origine, le navigateur suivrait le lien lui-même, en `GET`, sans le verbe — rien ne part alors, et la console de développement dit pourquoi (sauf `get` : le navigateur ouvre ce lien ordinaire, sans avertissement) ; « Ouvrir dans un nouvel onglet » du menu contextuel échappe à la page (détail : [Navigation (UJS)](21-navigation.md)).
- **`:callback="methodName"`** — un rappel posé sur un lien ou un formulaire, appelé uniquement sur une navigation qui **aboutit** (nouvelle page installée, ou fiche `method: 'none'`) — jamais sur un 422, un échec de transport ou un retour `Précédent`/`Suivant` (le veilleur `flash`/`error` du chapitre [Navigation (UJS)](21-navigation.md) couvre ces cas-là). `:callback={…}` (une expression entre accolades) est une **erreur de compilation** : la directive attend un simple nom de méthode entre guillemets. Détail complet — recherche de la méthode, forme du rappel : [Navigation (UJS)](21-navigation.md) → *`:callback` — un rappel après navigation*.

**Modale personnalisée** — le point d'entrée est `µ.config.confirm` :

- `true` *(défaut)* → modale maison **`µ.modal.fire`** (ci-dessous), appelée avec `{ text: message, icon: 'question', showCancelButton: true }` — confirmé si `isConfirmed`. Module `modal` absent du build (sélection `runtime` explicite qui l'exclut) → repli `window.confirm` et un avertissement console (une seule fois).
- `false` → `window.confirm(message)`, la boîte grise du navigateur.
- toute autre valeur → même repli, avec le même avertissement (une seule fois) : seules `true`/`false` sont des valeurs valides.

Pour un contrôle total, `µ.confirm` est une fonction **remplaçable** qui prime sur la config, quelle qu'elle soit : réassignez-la (`µ.confirm = (message, el) -> …`) pour brancher directement votre propre modale. Retour booléen (décision immédiate) ou **promesse de booléen** (modale asynchrone) : le temps que la boîte s'affiche, le clic d'origine est annulé — puis, dès que la promesse répond `true`, le framework **rejoue l'action lui-même**, à l'identique (lien re-cliqué, formulaire re-soumis avec son bouton d'envoi d'origine). Rien à relancer à la main ; pendant l'attente, les clics répétés sur le même élément sont avalés.

### `µ.modal.fire` — la modale maison, API publique autonome

`µ.modal.fire(options) → Promise<{isConfirmed, isDenied, isDismissed, value, dismiss}>` ouvre directement la modale maison (au-dessus d'un élément en plein écran aussi : elle se pose dedans — dans son ombre quand c'est la balise d'un composant —, et suit l'entrée et la sortie du plein écran ; un élément qui n'affiche rien par-dessus lui, `video`, `audio`, `canvas`, `img`, `iframe`, `embed`, `object`, `input`, `textarea`, `select` ou un élément SVG, ne peut pas la recevoir : elle reste dans le corps de la page, donc invisible tant que dure ce plein écran) — utilisable par une appli **indépendamment** de `:confirm`/`µ.config.confirm`, partout où une confirmation, une saisie ou un message bloquant est utile. Zéro dépendance externe, zéro CSS inline (classes `mjs-modal-*` posées via une feuille adoptée). Ne rejette **jamais** : quelle que soit la cause de fermeture, la promesse se résout.

Les menus de MJS ouverts dans la page — la liste d'un `<@@select>`, une bulle `:title`, le menu d'un `<@@chart>` — s'affichent dans la couche du dessus du navigateur, devant tout `z-index` : ils se ferment à l'ouverture de la fenêtre, le focus qu'ils portaient revient à leur bouton, et la fenêtre le lui rend à sa fermeture. Ouverts dans la fenêtre, ils fonctionnent comme ailleurs. La liste d'un `<@@select>` ouverte dans la fenêtre s'affiche devant elle, entière, contre son bouton (couche du dessus, placée par le script : elle suit son bouton pendant l'animation d'ouverture de la fenêtre comme au défilement de son corps, et se ferme quand ce défilement cache son bouton) ; un clic dans la fenêtre hors de la liste ferme la liste seule, et la fenêtre qui se ferme l'emporte. Échap ferme d'abord la liste d'un `<@@select>` ou le menu d'un `<@@chart>` ouvert, seul, son focus rendu à son bouton, et la fenêtre seulement quand aucun ne l'est ; une bulle `:title` visible ne la retient pas : Échap la ferme avec la fenêtre.

> 🛡️ **Options vérifiées à l'appel.** Les options sont validées **et recopiées** avant que la promesse n'existe. Un appel malformé — mauvais type, valeur non convertible en texte, getter qui lève — provoque une `TypeError` **synchrone** dont le message nomme l'option fautive (`` `customClass.box` attend du texte, reçu symbol ``). Une erreur de programmation reste donc bruyante et pointe votre code, au lieu de se déguiser en « l'utilisateur a annulé ». Un nom **inconnu** d'`icon` ou d'`input`, lui, ne bloque rien : avertissement en console, puis repli (aucune icône / champ `text`).

| Option | Type | Défaut | Effet |
|---|---|---|---|
| `title` | chaîne | — | titre (texte brut, jamais interprété) |
| `text` | chaîne | — | contenu (texte brut) |
| `html` | chaîne | — | contenu HTML de confiance (interprété — même contrat que `:html`) ; prime sur `text` |
| `icon` | chaîne — `success`, `error`, `warning`, `info` ou `question` | — | icône SVG inline colorée ; absente/inconnue → aucune icône |
| `showConfirmButton` | booléen | `true` | affiche le bouton de confirmation ; `false` = boîte sans bouton (ex. `µ.modal.wait`, ci-dessous) — le focus initial retombe alors sur la boîte elle-même |
| `showCancelButton` / `showDenyButton` | booléen | `false` | affiche le bouton Annuler / Non |
| `confirmButtonText` / `cancelButtonText` / `denyButtonText` | chaîne | libellé framework (fr/en selon `lang`) | texte des boutons |
| `input` | chaîne — `text`, `textarea`, `select` ou `checkbox` | — | ajoute un champ de saisie dans la boîte |
| `inputValue` | chaîne ou booléen | — | valeur initiale (booléen pour `checkbox`) |
| `inputOptions` | objet ou `Map` | — | options du `select` (`{valeur: libellé}`) |
| `inputPlaceholder` | chaîne | — | placeholder du champ |
| `inputValidator(value)` | fonction → chaîne, `null` ou Promise | — | message d'erreur pour bloquer, faux/`null` pour valider |
| `preConfirm(value)` | fonction → valeur ou Promise | — | transforme la valeur finale ; renvoyer `false` annule (modale conservée ouverte) |
| `timer` | nombre (ms) | — | fermeture automatique (`dismiss: 'timer'`) |
| `allowOutsideClick` / `allowEscapeKey` | booléen | `true` | clic hors modale / touche Échap ferme (`dismiss: 'backdrop'` / `'esc'`) — pendant qu'un `preConfirm` ou un `inputValidator` attend sa réponse, ces deux fermetures sont ignorées : la fenêtre se ferme à la réponse, et seuls `µ.modal.close()`, un autre `fire()` ou le `timer` la ferment d'ici là. Le clic ne ferme que s'il est parti du fond : sélectionner le texte d'un champ et relâcher la souris à côté de la boîte ne ferme pas. Échap qui ferme s'arrête à la modale : un tiroir ou un menu ouvert en dessous ne se ferme pas avec elle |
| `customClass` | objet | — | classes CSS additionnelles par zone (`backdrop`, `box`, `icon`, `title`, `htmlContainer`, `input`, `validationMessage`, `actions`, `confirmButton`, `denyButton`, `cancelButton`) |

Le résultat distingue l'issue et sa cause exacte : un seul de `isConfirmed`/`isDenied`/`isDismissed` est `true` ; `value` porte la saisie (ou le retour de `preConfirm`) côté confirmation ; `dismiss` vaut `'cancel'`/`'esc'`/`'backdrop'`/`'timer'` sur une fermeture non confirmée, sinon `undefined`. Piège de focus actif tant que la modale est ouverte (Tab/Shift+Tab bouclent dans la boîte) ; à la fermeture, le focus revient automatiquement à l'élément qui l'avait avant l'ouverture — même s'il était dans l'ombre d'un composant : il revient à l'élément lui-même, pas à la balise du composant. Tab sur le dernier élément de la boîte passe au premier, sans appeler la méthode `@focus` d'un composant de la fenêtre. Une modale encore ouverte quand une navigation remplace le corps de la page (un lien dans son `html`, `µmodal.wait()` puis une navigation) part avec l'ancien corps : elle est fermée avec `dismiss: 'close'` à l'arrivée de la page, son piège de focus ne retient plus Tab, et le focus reste à la nouvelle page. Un retour par `Précédent` sur la page quittée ne la fait pas ressortir.

```html
<script>
  supprimer = ->
    result = await µmodal.fire
      title:            'Supprimer le compte ?'
      text:             'Cette action est irréversible.'
      icon:             'warning'
      showCancelButton: true
    if result.isConfirmed
      $supprime = true
</script>
<button @click={supprimer}>Supprimer mon compte</button>
```

### Personnalisation visuelle — variables CSS

La modale s'affiche via une feuille adoptée par `document` (`µ._mjs_modalSheet`) — donc APRÈS les `<style>` de la page dans la cascade. Aucune couleur n'y est en dur : chaque teinte, bordure, rayon et ombre passe par une variable CSS `--mjs-modal-*`, lue depuis `:root` (la modale vit en light DOM : sur `document.body`, ou, pendant un plein écran, dans l'élément en plein écran, ou dans son ombre quand il en a une). Une appli qui ne déclare rien voit exactement le rendu par défaut ci-dessous ; en déclarer une seule suffit à la retenir.

| Variable | Rôle | Repli |
|---|---|---|
| `--mjs-modal-bg` | fond de la boîte | `#fff` |
| `--mjs-modal-fg` | texte principal (titre, contenu par défaut) | `#222` |
| `--mjs-modal-muted` | texte secondaire (`.mjs-modal-content`) | `#444` |
| `--mjs-modal-radius` | arrondi de la boîte | `8px` |
| `--mjs-modal-shadow` | ombre portée de la boîte | `0 10px 40px rgba(0,0,0,.25)` |
| `--mjs-modal-backdrop` | fond du calque derrière la boîte | `rgba(0,0,0,.55)` |
| `--mjs-modal-border` | bordure du champ de saisie | `#d0d0d0` |
| `--mjs-modal-input-bg` | fond du champ de saisie (text/textarea/select/checkbox) | `transparent` |
| `--mjs-modal-input-fg` | texte du champ de saisie | `inherit` |
| `--mjs-modal-btn-radius` | arrondi partagé — champ de saisie, bandeau de validation, boutons | `4px` |
| `--mjs-modal-confirm-bg` / `--mjs-modal-confirm-fg` | bouton de confirmation | `#3085d6` / `#fff` |
| `--mjs-modal-deny-bg` / `--mjs-modal-deny-fg` | bouton « Non » | `#e0a020` / `#fff` |
| `--mjs-modal-cancel-bg` / `--mjs-modal-cancel-fg` | bouton Annuler | `#e8e8e8` / `#333` |
| `--mjs-modal-error-bg` / `--mjs-modal-error-fg` | bandeau d'erreur de validation | `color-mix(in srgb, var(--mjs-modal-icon-error) 14%, transparent)` / `var(--mjs-modal-icon-error)` — suit la teinte de l'icône d'erreur (`#d64545` par défaut), pas une valeur figée |
| `--mjs-modal-icon-success` | icône succès | `#2e9e5b` |
| `--mjs-modal-icon-error` | icône erreur | `#d64545` |
| `--mjs-modal-icon-warning` | icône avertissement | `#e0a020` |
| `--mjs-modal-icon-info` | icône information | `#3085d6` |
| `--mjs-modal-icon-question` | icône question (et teinte par défaut avant icône spécifique) | `#6b7280` |

Thème sombre complet, prêt à copier dans le CSS de la page (aucune classe à renommer, aucun `!important`) :

```css
:root {
  --mjs-modal-bg: #1c2230;
  --mjs-modal-fg: #e8ebf1;
  --mjs-modal-muted: #a7b0c0;
  --mjs-modal-radius: 10px;
  --mjs-modal-shadow: 0 10px 40px rgba(0,0,0,.6);
  --mjs-modal-backdrop: rgba(0,0,0,.7);
  --mjs-modal-border: #3a4254;
  --mjs-modal-input-bg: #131722;
  --mjs-modal-input-fg: #e8ebf1;
  --mjs-modal-btn-radius: 6px;
  --mjs-modal-confirm-bg: #3085d6;
  --mjs-modal-confirm-fg: #fff;
  --mjs-modal-deny-bg: #e0a020;
  --mjs-modal-deny-fg: #1c2230;
  --mjs-modal-cancel-bg: #2c3446;
  --mjs-modal-cancel-fg: #e8ebf1;
  --mjs-modal-error-bg: #3a1f22;
  --mjs-modal-error-fg: #f28b8b;
  --mjs-modal-icon-success: #4ade80;
  --mjs-modal-icon-error: #f87171;
  --mjs-modal-icon-warning: #fbbf24;
  --mjs-modal-icon-info: #60a5fa;
  --mjs-modal-icon-question: #9ca3af;
}
```

### Raccourci global — `µmodal`

`µmodal` est le raccourci global de `µ.modal` (même convention que `µRouter`/`µStore`) : les deux écritures sont strictement interchangeables pour tout ce qui suit.

### Raccourcis — `µmodal.success/error/info/warn`

Quatre fabriques prêtes à l'emploi, une par icône, chacune acceptant soit un **message** (chaîne), soit un **objet** d'options `µ.modal.fire` fusionné par-dessus ses défauts (l'objet gagne) :

```civet
µmodal.success('Enregistré')
µmodal.error({ title: 'Échec', text: 'Le serveur n\'a pas répondu.' })
```

| Raccourci | Icône | Défauts |
|---|---|---|
| `µmodal.success(arg)` | `success` | `timer: 2000`, `showConfirmButton: false` |
| `µmodal.info(arg)` | `info` | `timer: 2000`, `showConfirmButton: false` |
| `µmodal.warn(arg)` | `warning` | `timer: 2000`, `showConfirmButton: false` |
| `µmodal.error(arg)` | `error` | bloquante — ni `timer`, ni bouton masqué (`showConfirmButton` reste à son défaut `true`) |

Les trois premiers s'auto-ferment (2 secondes) sans réclamer de clic ; une erreur, elle, reste affichée jusqu'à ce que l'utilisateur la ferme lui-même. Les quatre rendent la **même promesse** que `µ.modal.fire` — ce sont de simples fabriques par-dessus.

### Toasts — `µmodal.notify`

```civet
µmodal.notify(message, options?) → { close() }
```

Une notification empilée, **en haut à droite** de l'écran par défaut (position réglable, cf. `µ.config.notifyPosition` ci-dessous — plusieurs toasts coexistent), avec une croix de fermeture et une barre de vie animée qui matérialise le décompte avant disparition automatique. On peut aussi le **tirer sur le côté** pour le fermer (voir « Glisser pour fermer » plus bas).

| Option | Type | Défaut | Effet |
|---|---|---|---|
| `type` | chaîne — `success`, `error`, `warning` ou `info` | `info` | choisit l'icône, le titre par défaut, la couleur du dégradé + de la barre de vie, et le rôle ARIA (`error` → `role="alert"` ; les trois autres → `role="status"` + `aria-live="polite"`) |
| `title` | chaîne ou valeur fausse | titre par défaut du `type` (`Succès`/`Erreur`/`Attention`/`Info`) | titre en gras au-dessus du message ; une chaîne l'impose, une valeur fausse (`false`, `''`, `null`) retire le titre — toast compact, une seule ligne |
| `icon` | chaîne SVG, adresse d'image, élément du document ou `false` | l'icône du `type` | remplace l'icône du type (voir « Une icône à vous » ci-dessous) ; `false` retire l'icône |
| `duration` | nombre (ms) | `µ.config.notifyDuration` (`4000` par défaut) | délai avant retrait automatique ; `0` = **permanent** (ni barre de vie, ni auto-fermeture — seuls la croix, `close()`, le clic sur un toast cliquable ou le glisser le retirent) |
| `pause` | booléen | `µ.config.notifyPause` (`true` par défaut) | `true` : le décompte (minuteur et barre de vie) s'arrête tant que le pointeur survole le toast ou que le focus est dedans, puis repart avec le temps **restant** ; `false` : il continue quoi qu'il arrive (voir « Pause du décompte » plus bas). Toute valeur non booléenne vaut l'absence d'option |
| `swipe` | booléen | `µ.config.notifySwipe` (`true` par défaut) | `true` : on peut tirer le toast sur le côté pour le fermer (doigt, souris ou stylet) ; `false` : aucun glisser (voir « Glisser pour fermer » plus bas). Toute valeur non booléenne vaut l'absence d'option |
| `sound` | booléen ou chaîne | — | surcharge ponctuelle de la couche sonore (ci-dessous) pour ce seul appel |
| `href` | chaîne | — | adresse : le toast **entier** devient un **lien** (voir « Un toast cliquable » ci-dessous) |
| `onClick` | fonction | — | le toast **entier** devient un **bouton** : `onClick(événement)` est appelée, puis le toast se ferme |

**Une icône à vous.** `icon` prend quatre formes :

- une **chaîne SVG** (elle commence par `<svg`), posée dans la case d'icône. Même venue d'un utilisateur (une adresse d'avatar qui commencerait par `<svg`), elle n'exécute jamais de code, ne pose aucun style sur la page et ne fait rien charger ailleurs : elle doit être un seul `<svg>`, rien avant ni après, sinon l'icône du type reste ; dans ce `<svg>` ne restent que les éléments de dessin d'une icône — formes (`path`, `circle`, `ellipse`, `line`, `polyline`, `polygon`, `rect`), groupes (`g`, `defs`, `symbol`, `use`), textes (`text`, `tspan`, `title`, `desc`), dégradés (`linearGradient`, `radialGradient`, `stop`), découpes et masques (`clipPath`, `mask`) ; tout le reste part avec son contenu (`<script>`, `<style>`, `<foreignObject>`, `<image>`, filtres, animations, éléments HTML glissés dedans). Un lien `<a>` reste un simple groupe, sans adresse. Sont retirés aussi les attributs `on…` et `style`, toute adresse qui ne vise pas le SVG lui-même (`href` ou `xlink:href` qui ne commence pas par `#`), et toute valeur en `javascript:`, avec `url(` hors `#nom`, `@import` ou une barre oblique inverse. Une icône ordinaire — traits, dégradés appelés par `url(#…)`, `<use href="#…">` — reste telle quelle ;
- une **adresse d'image**, posée en `<img alt="">` : toute autre chaîne est une adresse, jamais du HTML, et `javascript:`, `vbscript:` et `file:` sont refusés comme dans tout attribut d'adresse de MJS (l'image reste alors sans `src`) ;
- un **élément du document**, placé tel quel dans la case : un élément n'a qu'une place dans le document : pour le montrer dans plusieurs toasts, passez `el.cloneNode(true)` ;
- **`false`** : pas d'icône du tout. Le contenu prend la place de la case, et le toast porte la classe `mjs-toast-no-icon`.

```civet
µmodal.notify('Enregistré', { type: 'success', icon: '<svg viewBox="0 0 24 24"><path d="M5 12l5 5 9-10" fill="none" stroke="currentColor" stroke-width="2"/></svg>' })
µmodal.notify('Nouveau message', { icon: '/icones/message.svg' })
µmodal.notify('Copié', { icon: false })
```

Le SVG et l'image prennent la taille de `--mjs-toast-icon-size` (28&nbsp;px par défaut) ; un SVG qui peint en `currentColor` suit la couleur du type. Toute autre valeur (`null`, chaîne vide, nombre…) vaut l'absence d'option : l'icône du type reste.

**Un toast cliquable.** `href` ou `onClick` rend le toast **entier** cliquable — icône, texte, marges et barre de vie —, la croix exceptée :

```civet
µmodal.notify('Nouveau badge débloqué', { type: 'success', href: '#/badges' })
µmodal.notify('Brouillon supprimé', { duration: 8000, onClick: -> restoreDraft() })
```

- **`href`** en fait un **lien**. Il prend le focus au clavier (Tab), Entrée l'ouvre, et le toast se ferme quand on le suit. C'est un vrai lien du document : une adresse `#/…` ou de même origine passe par la navigation de MJS comme n'importe quel autre lien. L'adresse subit le filtre des adresses de MJS : `javascript:`, `vbscript:`, `file:`, `data:` et `blob:` sont refusées.
- **`onClick`** en fait un **bouton**. Entrée et Espace le déclenchent. `onClick` reçoit l'événement `click`, puis le toast se ferme — même si elle lève une erreur, qui remonte alors comme celle de n'importe quel gestionnaire d'événement.
- **Les deux ensemble** : le toast est un **lien**. `onClick` est appelée d'abord, avec l'événement ; le lien est ensuite suivi, sauf si elle appelle `event.preventDefault()`. Le toast se ferme dans tous les cas.
- **La croix reste à part** : elle ferme le toast sans suivre le lien ni appeler `onClick`. Au clavier, Tab atteint d'abord le toast, puis la croix.
- Une valeur inutilisable — `href` qui n'est pas une chaîne, qui est vide ou qui ne contient que des espaces, `onClick` qui n'est pas une fonction, adresse refusée — vaut l'absence d'option : avec une adresse refusée et un `onClick`, le toast est un bouton. Un toast sans `href` ni `onClick` n'est pas modifié.
- **États** : au survol, à l'appui et au focus visible au clavier (`:focus-visible`), le toast pose un voile ou un anneau, réglables par le thème avec `--mjs-toast-hover-bg`, `--mjs-toast-active-bg` et `--mjs-toast-focus` ; au survol, `--mjs-toast-hover-border` le borde en plus d'un filet de 1&nbsp;px, transparent par défaut : rien ne paraît tant que le thème ne le colore pas (tableau « Variables des toasts » plus bas).
- **Votre CSS** : la couverture (l'élément invisible posé sur le toast) résiste aux règles de balise de votre feuille — `button { … }`, `a:hover { … }`, `outline: none`. Elle pose en `!important` sa position, sa taille, son fond, sa bordure, son remplissage, sa marge, sa police, sa couleur, son apparence et ses trois états : le message reste lisible quel que soit le style global de vos boutons et de vos liens, et les variables ci-dessus sont le moyen de régler ses états. Le filet du survol (`--mjs-toast-hover-border`) est une ombre intérieure posée sans `!important` : une ombre (`box-shadow`) que votre feuille donne à `a:hover` ou `button:hover` passe devant lui, comme elle passe sur la couverture. La croix, elle, reste un bouton ordinaire que vos règles habillent comme les autres.
- **Double clic** : quand un clic au pointeur (souris, doigt ou stylet) ferme un toast cliquable, le toast suivant remonte à sa place, sous le pointeur. Pendant 400&nbsp;ms, un toast qui occupe l'endroit de ce clic ignore le clic suivant au pointeur — ni `onClick` ni lien —, de sorte que le second clic d'un double clic ne déclenche pas le toast qui vient de remonter. Le clavier (Entrée, Espace) et `element.click()` ne sont jamais concernés, pas plus qu'un toast situé ailleurs que sous le premier clic. Un test automatisé qui clique deux toasts de suite au même endroit attend donc 400&nbsp;ms entre les deux.
- **Durée** : le survol et le focus mettent le décompte en pause, comme pour tout toast (voir « Pause du décompte » plus bas) ; il repart avec le temps restant. Un toast qui demande une décision ou qu'il faut le temps de lire peut aussi se poser avec une `duration` longue, ou `0` (permanent).

`notify()` rend `{ close() }` — de quoi retirer la notification par code, en plus de la croix.

Au-dessus d'un élément en plein écran aussi, comme la modale : le navigateur n'affiche alors que cet élément et ce qu'il contient, quel que soit le `z-index` du reste de la page — la pile des toasts se pose donc **dans** l'élément, et le suit à l'entrée et à la sortie du plein écran, avec les toasts déjà affichés — même quand votre écouteur de `fullscreenchange` retire l'élément à la sortie. Seule une navigation qui remplace le corps de la page pendant le plein écran emporte ses toasts : ils rendent leur place et ne reviennent pas. Un élément plein écran que votre code retire sans navigation (le bouton « fermer » d'une lightbox) ne les emporte pas : ils reviennent dans le corps de la page, avec ceux affichés entre-temps. Une vidéo, une image ou un canevas en plein écran n'affichent rien par-dessus eux : les toasts restent alors dans la page.

### Position des toasts — `µ.config.notifyPosition`

```civet
µconfig.notifyPosition = 'top-right'                     # défaut
µconfig.notifyPosition = 'quarter-bottom-left'
µconfig.notifyPosition = { top: '80px', right: '12px' }   # placement libre, en longueurs CSS
```

Huit préréglages : `top-right` *(défaut)*, `top-left`, `bottom-right`, `bottom-left`, et leurs quatre variantes `quarter-top-right`/`quarter-top-left`/`quarter-bottom-right`/`quarter-bottom-left` — ancrées à 25&nbsp;% de la hauteur de l'écran (côté haut ou bas) plutôt que collées au bord. Un objet `{ top?, right?, bottom?, left? }` de longueurs CSS (`'80px'`, `'2rem'`…) place la pile au pixel près, hors de tout préréglage. Une pile ancrée en **bas** empile ses toasts vers le **haut** (le plus récent pousse les précédents) — l'inverse d'une pile ancrée en haut ; un placement libre, lui, n'a pas de préréglage pour le décider et suit `notifyFlow` ci-dessous. La valeur est relue à **chaud** : un changement s'applique à la prochaine notification, sans rien redémarrer.

### Sens du flux — `µ.config.notifyFlow`

```civet
µconfig.notifyFlow = 'auto'   # défaut — le préréglage de position décide
µconfig.notifyFlow = 'up'     # le nouveau toast arrive AU-DESSUS des précédents
µconfig.notifyFlow = 'down'   # le nouveau toast arrive EN DESSOUS
```

L'**ordre d'empilement**, à ne pas confondre avec le sens de croissance de la pile — celui-là est dicté par l'ancrage (une pile collée en bas grandit forcément vers le haut, quoi qu'on demande ici). `notifyFlow` répond seulement à : « le prochain toast, il apparaît de quel côté des précédents ? ». En `'auto'`, les ancrages bas empilent vers le haut et tous les autres vers le bas. Le réglage sert surtout au **placement libre** `{ top, bottom… }`, qui n'a aucun préréglage pour trancher. Relu à chaud comme les autres, valeur inconnue → avertissement et repli sur `'auto'`.

### Durée par défaut des toasts — `µ.config.notifyDuration`

```civet
µconfig.notifyDuration = 4000   # défaut, en ms
µconfig.notifyDuration = 0      # tous les toasts deviennent permanents par défaut
```

Durée par défaut d'un toast avant retrait automatique. `opts.duration`, posé sur un appel `notify()` précis, **prime** sur ce réglage global (cf. tableau ci-dessus). `0` — au global comme par appel — rend le toast **permanent** : ni barre de vie, ni auto-fermeture, seuls la croix, `close()`, le clic sur un toast cliquable ou le glisser le retirent.

### Pause du décompte — `µ.config.notifyPause`

```civet
µconfig.notifyPause = true    # défaut — le survol et le focus arrêtent le décompte
µconfig.notifyPause = false   # le décompte continue quoi qu'il arrive
µmodal.notify('Message important', { pause: false })   # un seul toast, quel que soit le réglage global
```

Tant que le pointeur (**souris ou stylet**) survole un toast, ou que le **focus est dans le toast** (la croix, la couverture d'un toast cliquable), son décompte est en pause : le minuteur de fermeture **et** la barre de vie s'arrêtent, puis repartent avec le temps **restant** quand le pointeur est sorti et que le focus a quitté le toast — jamais depuis zéro. Cela vaut pour tous les toasts, cliquables ou non, et chaque toast a sa propre pause.

- **Survol et focus se cumulent** : le décompte ne repart que lorsque le pointeur est parti **et** que le focus est sorti. Un focus qui passe d'un bouton du toast à un autre ne le relâche pas.
- **Le doigt ne survole rien** : toucher un toast ne met pas son décompte en pause.
- **Un toast permanent** (`duration: 0`) n'a pas de décompte : il n'y a rien à figer.
- **La marque** : pendant la pause, le toast porte la classe `mjs-toast-paused` (la barre s'arrête par `animation-play-state: paused`, jamais par un style inline) — de quoi y accrocher votre propre allure.
- **L'appel prime** : `pause`, posé sur un appel `notify()` précis, l'emporte sur `notifyPause`. Une valeur qui n'est pas un booléen (`null`, `0`, `'non'`…) vaut l'absence d'option, sans avertissement. Le réglage global est relu à chaque appel de `notify()`.

### Glisser pour fermer — `µ.config.notifySwipe`

```civet
µconfig.notifySwipe = true    # défaut — on peut tirer un toast pour le fermer
µconfig.notifySwipe = false   # aucun toast ne se tire
µmodal.notify('Fixe', { swipe: false })   # un seul toast, quel que soit le réglage global
```

En plus de la croix, un toast se ferme en le **tirant** sur le côté : on l'attrape (doigt, souris ou stylet) et on le tire à l'horizontale, il suit le pointeur. Lâché assez loin, il **sort de l'écran en glissant** (environ 200&nbsp;ms) puis se ferme exactement comme par la croix : la file de `notifyMax` avance, la poignée `close()` reste valable. Lâché trop près, il **revient à sa place** en glissant.

- **Le sens permis suit la place de la pile** : un préréglage à droite (`top-right`, `bottom-right`, `quarter-top-right`, `quarter-bottom-right`) se tire vers la droite seulement ; un préréglage à gauche, vers la gauche seulement. Pour une position libre, MJS lit les valeurs que votre feuille de style donne à vos variables — par exemple `{ bottom: 'var(--toasts-bottom)', left: 'var(--toasts-left)', right: 'var(--toasts-right)' }` — après résolution : `left` et `right` posés à la fois (ou aucun des deux), la pile est étirée, centrée ou sans ancre latérale, et se tire des deux côtés. Un seul côté posé (l'autre vaut `auto`, ou n'existe pas) : MJS regarde alors où se trouve réellement la pile **au moment où vous l'attrapez**. Si son milieu tombe dans le tiers central de la fenêtre — une pile centrée par `left: 50%` et `transform: translateX(-50%)`, par exemple —, elle se tire des deux côtés ; sinon, vers le bord le plus proche. Tirer vers le côté interdit ne déplace pas le toast.
- **Le seuil** : 80&nbsp;px, ou 35&nbsp;% de la largeur du toast s'il est plus étroit — ou un lancer rapide dans le sens permis (au moins 0,5&nbsp;px par milliseconde, sur au moins 24&nbsp;px).
- **Moins de 8&nbsp;px, c'est un clic** : la couverture d'un toast cliquable, la croix, un lien ou un bouton que vous avez posé dans le toast marchent comme avant. Après un vrai glisser, en revanche, le clic qui suit le lâcher est **avalé** : ni `onClick` appelée, ni lien suivi. Le clavier ne change pas (Tab, Entrée, Espace).
- **Le décompte est figé pendant qu'on tire** — minuteur et barre de vie, quelle que soit l'option `pause` : un toast qu'on tient en main ne se ferme pas sous le doigt — et repart avec le temps restant si le toast revient. À la souris, le pointeur survole encore le toast quand il revient : c'est alors la pause du survol qui tient le décompte, jusqu'au départ du pointeur.
- **Moins d'animations** : avec `prefers-reduced-motion: reduce`, le toast suit encore le pointeur, mais il se ferme sans mouvement au-delà du seuil et revient d'un coup en deçà.
- **Souris et stylet** : sur le texte et l'icône du toast, la prise est retenue (`pointerdown`), de sorte qu'il n'y a ni sélection de texte ni glisser natif d'une image pendant qu'on tire — en contrepartie, le texte d'un toast ne se sélectionne plus à la souris : `swipe: false` le rend. Sur un bouton ou un lien (la croix, la couverture d'un toast cliquable, les vôtres), rien n'est retenu : ils gardent leur focus et leur état `:active`, et le lien de la couverture porte `draggable="false"` pour que le toast glisse au lieu d'emporter l'adresse. Le glisser fait aussi lâcher le focus au bouton pressé, pour que la pause du focus ne retienne pas le toast après son retour. Le doigt garde le défilement vertical de la page (`touch-action: pan-y`) : seul un geste horizontal tire le toast.
- **Les marques** : un toast qui peut glisser porte la classe `mjs-toast-swipe` ; pendant qu'on le tire, `mjs-toast-dragging` ; pendant sa sortie ou son retour, `mjs-toast-sliding`. Le décalage passe par la propriété `translate` et par la variable CSS `--mjs-toast-dx`, posée sur le toast (dans son attribut `style`) le temps du geste, puis retirée ; l'animation d'entrée, sur `transform`, n'est pas touchée. Hors cette variable, le toast ne porte aucun style en ligne.
- **L'appel prime** : `swipe`, posé sur un appel `notify()` précis, l'emporte sur `notifySwipe`. Une valeur qui n'est pas un booléen vaut l'absence d'option, sans avertissement. Le réglage global est relu à chaque appel de `notify()`. `swipe: false` ne pose rien : ni classe, ni écouteur, ni `touch-action`.

### File des toasts — `µ.config.notifyMax`

```civet
µconfig.notifyMax = 5        # défaut — 5 toasts affichés au maximum en même temps
µconfig.notifyMax = false    # aucun plafond de NOMBRE — 0 ou Infinity itou
```

Passé ce plafond, les toasts suivants ATTENDENT en file FIFO plutôt que de s'afficher tout de suite — zéro éviction, un toast déjà affiché n'est jamais chassé pour faire de la place à un autre (un toast `duration: 0`, permanent, occupe ainsi sa place tant que la croix, `close()`, le clic sur un toast cliquable ou le glisser ne l'a pas fermé). Une place libérée fait avancer la file : le toast suivant s'affiche avec sa durée de vie PLEINE, jamais un reliquat — le son automatique de `notify()` joue à ce moment précis, jamais à la mise en file. La poignée `{ close() }` rendue par `notify()` reste valide pour un toast encore en attente : la fermer avant l'affichage le retire simplement de la file, il ne s'affichera jamais. Le plafond est relu à chaque affichage — un changement à chaud profite au prochain toast qui se présente, jamais rétroactivement. Les toasts qu'une navigation emporte avec le corps de la page rendent leur place : ceux qui attendaient en file s'affichent sur la nouvelle page, et les anciens ne reviennent jamais.

**La place à l'écran est un second plafond, toujours actif.** Un toast qui ferait sortir la pile de la fenêtre n'est pas affiché : il reste en file, exactement comme s'il avait buté sur `notifyMax`, et apparaît quand une place se libère. Le plafond réel est donc le plus bas des deux — `notifyMax` et ce que la fenêtre peut montrer —, ce qui rend `false` (« aucun plafond de nombre ») sûr même sur un petit écran : la pile ne déborde jamais, et rien n'est perdu. Ce sont les toasts eux-mêmes qui sont mesurés, jamais leur conteneur : un placement libre qui pose `top` **et** `bottom` donne à celui-ci une hauteur imposée par la fenêtre, que son contenu déborde ou non. Seul le bord **opposé à l'ancrage** est contrôlé — le bord ancré est votre choix, pas l'affaire du framework. Trois garde-fous, donc : un toast SEUL n'est jamais refusé, même s'il dépasse à lui tout seul (mieux vaut un toast qui dépasse qu'un écran vide) ; une pile dont le point d'ancrage est lui-même hors de l'écran (`{ top: '700px' }` dans une fenêtre de 300&nbsp;px) sort forcément avec lui, aucun calcul ne rattrape ça ; et sans mise en page mesurable (rendu serveur), seul `notifyMax` s'applique.

### Modale d'attente — `µmodal.wait`

```civet
µmodal.wait(message?) → { close() }
```

Une modale bloquante avec spinner, sans bouton, sans fermeture au clic hors modale ni à Échap (`allowOutsideClick`/`allowEscapeKey` à `false`) — seul le code appelant la referme, via le `close()` rendu ou `µ.modal.close()`. Argument optionnel : une chaîne (titre) ou un objet fusionné sur les défauts (`title: 'Veuillez patienter…'`, `spinner: true`).

### Fermeture programmatique — `µ.modal.close`

```civet
µmodal.close(result?)
```

Ferme la modale **courante** (une seule ouverte à la fois) sans attendre un clic, avec `dismiss: 'close'` — c'est ce qu'utilise `wait` en interne (`notify` a son propre retrait, via la poignée `{ close() }` qu'il rend), et ce qu'une appli peut appeler directement (un événement serveur qui rend une attente inutile, par exemple). `result` se fusionne par-dessus le résultat par défaut (`{ isConfirmed: false, isDenied: false, isDismissed: true, value: undefined, dismiss: 'close' }`) — les clés fournies l'emportent. Sans modale ouverte : ne fait rien.

### Sons — `µ.config.modalSound`

Une petite couche sonore, **coupée par défaut** :

```civet
µconfig.modalSound = false                                                    # défaut — silence total
µconfig.modalSound = true                                                     # 4 signatures embarquées (success/error/warning/info) : une modale joue celle de son icône, un toast celle de son type (info par défaut)
µconfig.modalSound = { success: '/sounds/ok.mp3', error: '/sounds/ko.mp3' }   # fichiers par type ; type absent → repli signature embarquée
```

`true` joue une courte signature synthétisée (oscillateurs WebAudio, zéro fichier à livrer) — une par icône pour une modale, une par TYPE pour un toast (`notify()`) : succès deux notes, avertissement deux bips, info une note, erreur la scie  — un toast sans `type` est un toast `info`, il joue donc la note d'info ; le ping `notify` ne sert qu'à `µsound()` sans argument. Un objet peut mélanger fichiers et repli : les types non couverts retombent sur leur signature embarquée. Surcharge **par appel**, prioritaire sur la config globale : `µmodal.error({ text: '…', sound: false })`, `sound: true` (joue la signature embarquée du type, même si la couche globale est coupée), ou un nom de signature (`sound: 'error'`), ou un chemin de fichier (`sound: '/autre.mp3'`). Politique **autoplay** des navigateurs respectée : un son avant le premier geste de l'utilisateur sur la page est simplement silencieux, jamais une erreur.

### Son à la demande — `µ.sound`

```civet
µsound('success')                # une des 5 signatures — success/error/warning/info/notify (défaut)
µsound('success', false)         # silence pour cet appel
µsound('success', '/ok.mp3')     # ce fichier précis, quel que soit µconfig.modalSound
```

`µ.sound(type?, override?)` (sucre global `µsound`) joue une des 5 signatures sonores de la couche modale n'importe où dans l'app — pas seulement au fil d'une modale ou d'un toast — et joue TOUJOURS, même avec `µ.config.modalSound: false` : ce réglage ne coupe que les sons **automatiques** des modales/toasts, jamais un appel direct à `µ.sound`. `type` vaut `'notify'` par défaut ; si `µ.config.modalSound` est un objet `{ type: 'fichier.mp3' }`, c'est le fichier du type demandé qui joue, sinon la signature WebAudio embarquée. `override`, par appel, prime sur tout le reste : `false` (silence), un chemin de fichier, ou le nom d'une autre signature. Un `type` qui ne correspond à aucune des 5 signatures avertit en console, sans rien jouer. Fonction du module `modal` : absente du bundle si l'app exclut ce module au tree-shake.

### Variables des toasts

En plus des `--mjs-modal-*` ci-dessus, les toasts posent leurs propres variables — certaines replient sur la `--mjs-modal-*` correspondante si elle n'est pas déclarée (`--mjs-toast-border`, `--mjs-toast-success`/`-error`/`-warning`/`-info`), `--mjs-toast-bg`/`--mjs-toast-fg`/`--mjs-toast-radius`/`--mjs-toast-shadow` exceptés (variables propres, sans équivalent modale) :

| Variable | Rôle | Repli |
|---|---|---|
| `--mjs-toast-bg` | fond du toast | dégradé du type vers `--mjs-toast-bg-base` (`#22242F`) |
| `--mjs-toast-fg` | texte du toast | `#fff` |
| `--mjs-toast-color` | couleur pilote — icône, dégradé de fond et barre de vie en même temps, posée automatiquement par le type (`success`/`error`/`warning`/`info`) | `--mjs-toast-border` |
| `--mjs-toast-border` | repli neutre de `--mjs-toast-color` (toast sans classe de type) | `--mjs-modal-border` |
| `--mjs-toast-success` / `--mjs-toast-error` / `--mjs-toast-warning` / `--mjs-toast-info` | teinte `--mjs-toast-color` selon `type` (icône, dégradé et barre suivent ensemble) | icône `--mjs-modal-icon-*` correspondante |
| `--mjs-toast-shadow` | ombre portée du toast — double couche à étalement négatif, resserrée sous la boîte plutôt qu'en halo débordant | `0 10px 30px -8px var(--mjs-shadow), 0 2px 8px -4px var(--mjs-shadow)` |
| `--mjs-toast-radius` | arrondi du toast | `5px` |
| `--mjs-toast-bg-base` | extrémité sombre du dégradé de fond | `#22242F` |
| `--mjs-toast-width` | largeur de la pile — bornée en plus par `calc(100vw - 32px)`, la pile ne déborde donc jamais d'une fenêtre étroite | `400px` |
| `--mjs-toast-cols` | colonnes de la grille du toast — icône, contenu, croix | `70px 1fr 70px` |
| `--mjs-toast-padding` | marge intérieure du toast | `10px` |
| `--mjs-toast-icon-size` | côté du carré de l'icône | `28px` |
| `--mjs-toast-title-size` | corps du titre | `x-large` |
| `--mjs-toast-entree-duree` | durée de l'animation d'entrée (glissé avec dépassement, depuis le bord d'ancrage) | `.3s` |
| `--mjs-toast-hover-bg` | voile posé sur un toast cliquable (`href` ou `onClick`) sous le pointeur | `color-mix(in srgb, var(--mjs-toast-fg) 10%, transparent)` — 10&nbsp;% du texte du toast |
| `--mjs-toast-hover-border` | filet de 1&nbsp;px qui borde un toast cliquable sous le pointeur, tracé à l'intérieur du toast (une ombre intérieure : la taille du toast ne change pas) | `transparent` — aucun filet |
| `--mjs-toast-active-bg` | voile du toast cliquable pendant l'appui | `color-mix(in srgb, var(--mjs-toast-fg) 18%, transparent)` — 18&nbsp;% du texte du toast |
| `--mjs-toast-focus` | couleur de l'anneau de focus (2&nbsp;px, tracé à l'intérieur du toast) d'un toast cliquable atteint au clavier | `--mjs-toast-fg` |

Sans déclaration de `--mjs-toast-radius`, le toast garde un rayon fixe de `5px`, indépendant de celui de la boîte modale (`--mjs-modal-radius`, `8px` par défaut).

`--mjs-toast-duration` existe aussi, mais c'est un canal **interne** (posé par `notify()` pour piloter la durée de la barre de vie) — rien à en attendre côté thème. Il en va de même de `--mjs-toast-dx`, le décalage du toast qu'on tire (voir « Glisser pour fermer »).

Le fond et le texte du toast sont fixes (dégradé vers `--mjs-toast-bg-base`, `#22242F` par défaut, texte `#fff`), indépendants du thème clair/sombre de la page ; seuls `--mjs-toast-border`/`--mjs-toast-shadow` suivent encore les variables `--mjs-border`/`--mjs-shadow` de la modale (cf. [30 · Modules cœur](30-modules-coeur.md) § *Thème clair/sombre*). Les accents par type (`success`/`error`/`warning`/`info`, `--mjs-modal-icon-*` ci-dessus) restent, eux, inchangés d'un thème à l'autre.

Soumettre un `<form>` **désactive automatiquement** ses boutons de soumission (+ pose `aria-busy="true"` sur le formulaire) le temps de la requête — restauré dans tous les cas (succès, erreur, 422). Opt-out : `mjs-no-disable` sur le `<form>`. Après tout remplacement de page (clic, formulaire, retour arrière), le **focus** est déplacé automatiquement vers le nouveau contenu (`[autofocus]` > premier `<h1>` > le conteneur lui-même) — un lecteur d'écran ne suit pas un remplacement de DOM sans ce geste explicite.

Une navigation UJS émet en plus trois événements de cycle — `mjs:before-visit`, `mjs:visit`, `mjs:load` — mais sur `document`, jamais sur le composant : ce chapitre couvre les événements du composant, pas ceux-là. Détail des noms, du contenu de `detail` et de l'ordre : [Navigation (UJS)](21-navigation.md) → *Événements de cycle de navigation*.

> 🔗 Détails complets de la couche de navigation (interception liens/formulaires, cache de pages, CSRF, `µnav` réactif) : [Navigation (UJS)](21-navigation.md).

---

📚 **Apprendre en pratiquant** : ce chapitre correspond au **Tuto interactif n°5 (Événements)** — handlers DOM, handlers inline, modificateurs, événements de composant (`µemit`), transfert d'événements.
