# 3 · Réactivité

> 📚 Tuto interactif correspondant : **Chapitre 2 — Réactivité**. Les encarts 🎓 *Pour débutants* dépliables donnent l'explication pas-à-pas ; le corps de la page reste la référence dense.

Une variable préfixée par `$` est **réactive** : toute lecture dans le template crée une dépendance, toute écriture met à jour précisément les nœuds concernés. Il n'y a ni `useState`, ni Proxy au runtime — la réactivité est résolue à la **compilation**.

Les formes courantes de la grammaire Civet employées dans une expression de template sont suivies — appel sans parenthèses (`fmt $prix`), tube `|>`, `unless` postfixé, interpolation `"...#{$prix}..."`, et les autres idiomes usuels du langage. Quand l'analyse échoue à parser une expression, la compilation avertit et nomme l'expression en cause plutôt que de laisser un affichage figé sans explication.

## État local

On déclare un état en l'affectant ; pas besoin de le pré-déclarer. La mutation est directe :

```html
<script>
  $count = 0
  increment = -> $count += 1
</script>

<button @click={increment}>
  Cliqué {$count} fois
</button>
```

> ⚠️ **Ne pas** initialiser un `$x` à vide « pour le déclarer » par réflexe hérité d'autres frameworks : un `$x` lu dans le template est auto-déclaré. `$nom = ''` inutile ne fait qu'ajouter de la confusion.

> ⚠️ Le nom d'un état commence par une lettre sans accent ou par `_` (`$age`, `$_x`) ; la suite du nom peut porter des accents (`$prénom`). `$âge` est refusé à la construction, avec le nom à écrire à la place. Seuls le script, les expressions `{…}` et les balises portent des variables : un `$US` ou un `$constructor` écrit dans le texte d'un paragraphe reste du texte, et ne déclare rien.

Dans un `<pre>` ou un `<code>`, le **texte** est affiché tel quel : un `$x` écrit en clair — un exemple de code montré à l'utilisateur — n'est ni lu ni déclaré. Une interpolation `{$x}` y reste en revanche un vrai lien, mis à jour comme partout ailleurs :

```html
<!-- affiché tel quel : $compteur n'est pas déclaré -->
<pre><code>$compteur = 0</code></pre>

<!-- vrai lien : l'affichage suit $nom -->
<p>Le paquet <code>{$nom}</code> est prêt.</p>
```

Un commentaire `<!-- … -->` écrit dans un `<pre>` ou un `<code>` reste un commentaire, comme en HTML : il n'est pas affiché. Pour montrer `<!--`, écrivez `&lt;!--`. Un `<pre>` ou un `<code>` cité dans un commentaire HTML (`<!-- <pre> -->`) n'ouvre aucun bloc : le balisage qui suit le commentaire reste du balisage, directives comprises. Un commentaire écrit dans une chaîne (`{"a<!-- voir <code>npm i</code> -->c"}`, une valeur d'attribut, un gestionnaire) est un texte comme un autre : il s'affiche tel qu'écrit.

Une affectation réactive **vaut ce qu'elle affecte**, exactement comme en JavaScript — utilisée comme valeur (`return $x = 5`, `$a = $b = v`, un argument d'appel, `$n++`/`--$n`…), elle donne la valeur assignée (ou l'ancienne valeur pour le suffixe `++`/`--`), jamais un signal interne. `$n++`/`--$n` convertissent aussi `$n` en nombre avant d'incrémenter, comme le ferait JavaScript sur une chaîne (`$n = "2"` puis `$n++` donne `3`, pas `"21"`).

<details>
<summary>🎓 <b>Pour débutants</b> — « réactif », ça veut dire quoi&nbsp;?</summary>

En JavaScript classique, si vous écrivez `count = 0` puis plus tard `count = 1`, le texte déjà affiché sur la page **ne bouge pas** : vous devez aller chercher l'élément DOM et le réécrire à la main.

En MJS, le `$` change tout : la variable et l'affichage sont **liés**. Vous écrivez `$count = 1`, et tout endroit du template qui montrait `{$count}` se met à jour **tout seul** — uniquement ces endroits, rien d'autre. C'est ça, « réactif » : vous manipulez des données, l'écran suit.

</details>

### Écrire dans une boucle — textes et attributs écrits une fois, à la sortie

Une boucle du script qui écrit l'état écrit les textes et les attributs qui l'affichent **une fois, à sa sortie**, au lieu d'une fois par écriture : `for i in [1..1000] then $o.a.b.c = i` écrit l'état mille fois et le DOM une fois. Juste après la boucle, ces textes et attributs sont à jour : l'instruction qui suit lit le DOM final.

```html
<script>
  $total = 0
  remplir = (lignes) ->
    for l in lignes
      $total += l.prix                               # l'état change à chaque tour, le texte attend la sortie
    @@_shadow.querySelector('.total').textContent    # déjà la somme finale
</script>

<p class="total">{$total}</p>
```

Un appel de liste qui écrit l'état par un rappel écrit en place fait de même : `$lignes.forEach((l) -> $total += l.prix)` écrit le texte de `$total` une fois, et l'instruction qui suit l'appel lit le DOM final. Comptent `.forEach`, `.map`, `.flatMap`, `.filter`, `.reduce`, `.reduceRight`, `.some`, `.every`, `.find`, `.findIndex`, `.findLast` et `.findLastIndex`, sur une liste comme sur une `Map` ou un `Set` (`forEach`). Le DOM est écrit à la fin de l'instruction qui porte l'appel (`$lignes.forEach(…)`, `n = $lignes.reduce(…)`, `return $lignes.map(…)`), ou juste après l'appel quand il est ailleurs (une déclaration `r := $lignes.map(…)`, une condition, le corps d'une fonction fléchée).

- **Pendant la boucle**, l'état est à jour (`$total` relu dans la boucle donne la valeur du tour) ; seuls les textes et les attributs du DOM gardent l'état d'avant la boucle.
- Les **props des composants enfants** n'attendent pas : une prop est de l'état de l'enfant, pas un attribut du DOM. Une variable passée à un enfant (`<@panier x={$courant}>`, `x=!{$courant}`, `{...$o}`) lui arrive à chaque écriture, comme hors boucle : une méthode de l'enfant appelée dans la boucle (`panier.garder()`) lit la valeur du tour. Cette variable garde tout son chemin d'avant, comme une variable qui pilote un bloc : ses propres textes et attributs dans le composant se réécrivent aussi à chaque tour. Ceux des autres variables restent regroupés. Une exception : dès que le code en cours écrit une variable qui pilote un bloc (`$items.push(x)` sous un `{for}`, la condition d'un `{if}`), le composant attend le rendu de ce bloc, et les écritures suivantes de la variable passée à l'enfant l'attendent avec lui — l'enfant reçoit la valeur finale après la boucle, et une méthode de l'enfant appelée entre-temps lit la valeur d'avant.
- Les **blocs** (`{for}`, `{if}`, `{key}`, `{await}`) gardent leur heure : ils se redessinent juste après le code en cours, une fois, sur l'état final, comme après plusieurs écritures hors boucle. Une liste remplie dans une boucle (`for x in xs then $items.push(x)`) montre donc ses nouvelles lignes après ce passage, pas dès l'instruction qui suit la boucle. Les textes d'un composant dont la boucle écrit aussi un bloc attendent ce bloc : ils se mettent à jour avec lui, sur l'état final.
- Les **reffets** (`µeffect`) gardent aussi leur heure : un passage juste après le code en cours, sur l'état final.
- Toutes les boucles comptent : `for`, `for…in`, `for…of`, `while`, `do…while`, et celles qu'écrivent Civet et CoffeeScript (`for x in`, `loop`, `until`, compréhensions), ainsi que les appels de liste ci-dessus. Toutes les écritures aussi : `$x`, `$o.a.b`, `$$x` du magasin, une méthode qui modifie une liste (`$items.push(x)`), `delete $o.x` — y compris celles d'un rappel appelé par la boucle (`for g in groupes then g.forEach((x) -> $n += x)`).
- **Plusieurs composants** : une écriture `$$x` dans la boucle touche chaque composant qui l'affiche ; chacun écrit ses textes une fois, à la sortie.
- **Prop liée à deux sens** (`<@enfant v=!{$x}>`) : écrite dans une boucle de l'enfant, elle remonte au parent une fois, à la sortie de la boucle, avec sa valeur finale — un seul événement `mjs-bind:v` par boucle. Juste après la boucle, `$x` et le DOM du parent sont à jour ; pendant la boucle, `$x` garde sa valeur d'avant. Hors boucle, chaque écriture de l'enfant remonte tout de suite.
- **Boucles imbriquées** : seule la sortie de la boucle la plus extérieure écrit le DOM, même quand la boucle intérieure est dans une fonction appelée par la boucle — pourvu que la boucle extérieure écrive elle-même l'état. Une boucle qui ne fait qu'appeler une fonction (`for x in xs then traiter(x)`) n'est pas regroupée : chaque boucle de `traiter` écrit le DOM à sa sortie.
- La sortie écrit le DOM **dans tous les cas** : fin de la boucle, `break`, `continue`, `return`, ou exception levée dans la boucle (dans le `catch`, les textes sont déjà à jour).
- Une boucle **qui attend** (`await`, `for await`, ou `yield` dans un générateur) n'est pas regroupée : elle écrit le DOM à chaque écriture, comme avant — pendant l'attente, le reste de la page doit pouvoir se redessiner. Une boucle sans attente écrite dans son corps l'est, elle.
- Une boucle **sans écriture** de l'état n'est pas touchée et ne coûte rien. Une appli dont aucune boucle n'écrit l'état n'embarque pas ce mécanisme : son fichier de départ n'en porte pas un octet.
- Ne sont pas regroupés : les écritures d'un gestionnaire d'événement ou d'une fonction faites hors de toute boucle et de tout appel de liste (chaque écriture met le DOM à jour : le DOM relu juste après l'écriture voit la valeur), un appel de liste dont le rappel est passé par son nom (`$lignes.forEach(ajouter)` : écrivez le rappel en place), un appel de liste qui attend lui-même (`await` dans ses arguments) ou les écritures d'un rappel `async` faites après son attente, une boucle d'un module de script importé (`.civet`, `.coffee`), et une écriture que la compilation ne voit pas dans la boucle — par une variable qui garde un objet de l'état (`t = $todos[0]`, puis `t.fait = true` dans la boucle), ou dans une fonction appelée par une boucle qui n'écrit rien elle-même.

### Types et valeurs permises — le bloc `<vars>`

Une variable peut dire ce qu'elle accepte. La règle s'écrit dans le bloc `<vars>`, **avant** le `<script>` ; la valeur de départ reste dans le script :

```html
<vars>
  $volume  int 0..100
  $color   'red' | 'green' | 'blue'
</vars>

<script>
  $volume = 150
  $color  = 'red'
</script>

<input type="range" value=!{$volume} min="0" max="100" />
<p>{$volume}</p>
```

`$volume` vaut `100` dès le premier rendu (`150` était hors de sa plage), le curseur ne peut plus la faire sortir de `[0, 100]`, et `$color = 'purple'` est refusé : `$color` garde sa valeur. Chaque écriture passe par la règle — champ lié, clé calculée, fonction qui reçoit l'objet, prop du parent, store. Tout est dans [37 · Types et valeurs permises](37-types.md).

## Valeurs dérivées

Une affectation `$y = expression(...$x...)` au niveau racine du `<script>` devient **automatiquement** un dérivé, et ce que le gabarit en affiche suit les `$` qu'il lit. Aucun mot-clé spécial. Par défaut, le compilateur classe chaque dérivé (cf. « Valeurs précises » plus bas) : précis, il suit ses sources, et une écriture qui ne les touche pas ne le refait pas, tant qu'il ne repasse pas à l'horloge ; à l'horloge, il se recalcule quand on le lit après toute écriture du composant, et une écriture coûte la même chose quel que soit le nombre de ces dérivés : elle ne les parcourt pas, chacun voit à sa lecture si le composant a écrit depuis son dernier calcul. L'option d'appli `"derived": "clock"` met tous les dérivés à l'horloge. Une écriture qui ne change pas la valeur ne compte pas : les dérivés gardent leur valeur. Une écriture qui change l'état compte quelle que soit sa forme : une affectation (`$x = v`, `$x++`, `$[$k] = v`), une écriture profonde ou une méthode qui modifie une liste, une suppression (`delete $x`, `delete $[$k]`), la variable d'une tête de boucle (`for ($x of liste)`), l'état passé tel quel (`Object.assign($, …)`, `Reflect.set($, …)`, `Object.defineProperty($, …)`, un alias `s = $` ou une fonction qui reçoit `$` et y écrit), une clé du magasin `$$` qu'il lit, et `µwrite $x, v` — qui ne redessine rien, cf. [11](11-etat-brut.md). Le dérivé relu juste après rend la valeur à jour, et l'écran suit.

```html
<script>
  $numbers = [1, 2, 3, 4]
  $total = $numbers.reduce((t, n)-> t + n, 0)   # dérivé auto, suit $numbers
</script>

<p>{$numbers.join(' + ')} = {$total}</p>
```

> ⚠️ Le dérivé auto doit être **une seule expression**. Un `if/else` multi-lignes n'est pas auto-dérivé — utilisez un ternaire, ou un `µeffect` si vous avez besoin de plusieurs instructions.

<details>
<summary>🎓 <b>Pour débutants</b> — pourquoi pas juste une fonction&nbsp;?</summary>

Vous pourriez écrire une fonction `total()` qui recalcule la somme. Mais alors le template appellerait `{total()}` à chaque rendu, et surtout MJS ne saurait pas *quand* le rafraîchir.

Avec `$total = ...`, MJS **lit** les `$` à l'intérieur (ici `$numbers`), retient que `$total` en dépend, et remet l'écran à jour **dès** que `$numbers` change. Vous décrivez le *quoi* (« le total, c'est la somme »), MJS gère le *quand*.

</details>

### Valeurs précises — l'option `derived`

Par défaut, le compilateur classe chaque valeur dérivée : précise, elle suit ses sources ; à l'horloge, elle se refait à sa lecture après toute écriture du composant. L'option d'appli `"derived": "clock"` (`mjs.config.json`, cf. [32](32-cli-et-configuration.md) ; après un changement de l'option, relancez `mjs dev`) met toutes les valeurs dérivées à l'horloge. En production, une appli dont aucun composant n'a de valeur dérivée garde le cœur de la règle de l'horloge, sans rien de la précision, quelle que soit l'option ; `µrefresh($x)` y fait ce qu'il fait en développement. `mjs check --derived` montre ce classement avec ou sans l'option, et dit le mode de l'appli — avec `"clock"`, le classement dit ce que la précision changerait :

- **précise** — son expression n'est faite que de variables `$` du composant (d'autres valeurs précises comprises), de littéraux, d'opérateurs, de champs lus sur ces valeurs, et d'appels de la liste courte : les méthodes de liste et de chaîne qui ne changent pas leur receveur (`filter`, `map`, `reduce`, `reduceRight`, `some`, `every`, `find`, `findIndex`, `findLast`, `findLastIndex`, `flatMap`, `includes`, `indexOf`, `lastIndexOf`, `join`, `slice`, `concat`, `at`, `flat`, `toUpperCase`, `toLowerCase`, `trim`, `trimStart`, `trimEnd`, `startsWith`, `endsWith`, `padStart`, `padEnd`, `repeat`, `substring`, `charAt`, `split`, `toFixed`), `Math.abs`, `ceil`, `floor`, `round`, `trunc`, `sign`, `min`, `max`, `pow`, `sqrt`, et `String`, `Number`, `Boolean`, `parseInt`, `parseFloat`, `isNaN`, `isFinite`. Une fonction écrite sur place n'y entre qu'en argument d'une méthode de liste, faite des mêmes briques. Elle suit ses sources, sauf quand elle repasse à l'horloge (cf. plus bas) : elle est refaite quand une des variables `$` qu'elle lit est écrite. Seulement là où la précision peut épargner un calcul coûteux : son expression appelle une méthode (`filter`, `map`, `join`, `toUpperCase`…), appelle une fonction sur une liste étalée (`Math.max(...$notes)`) ou bâtit une liste ou un objet (`[$a, $b]`, `{ n: $n }`, dont la précision garde aussi l'identité), ou une valeur précise la lit ;
- **à l'horloge** — tout le reste : une fonction ou une constante du `<script>` ou du `<script module>`, un magasin `$$x`, un contexte, une rune, une lecture par `µread` à côté d'autres `$` (`µread($n) + $m`), `this`, `new`, l'heure, le hasard, une méthode hors de la liste… Elle est refaite à sa lecture après toute écriture du composant. Ce qui l'affiche se redessine quand une variable `$` qu'elle lit en toutes lettres est écrite. Quand l'une de ces variables tient un objet que MJS ne suit pas et qui peut cacher la lecture d'un autre objet — une fonction, l'instance d'une classe, un objet ou une liste gelés ou scellés, une collection (`Map`, `Set`, `WeakMap`, `WeakSet`) que MJS ne suit pas en entier — ou un objet signalé par `µrefresh`, la valeur est aussi refaite après toute écriture profonde du composant (`$ligne.prix = 20`, `$l.push(x)`), même faite par une autre variable, et ce qui l'affiche se redessine si elle a changé (une liste, un objet : toujours) : une fonction rangée dans une `Map`, l'objet que lit l'accesseur d'une classe, l'objet d'une `Map` sans enveloppe (réglage `"proxy": false`) changés par leur propre variable, l'écran montre la valeur qu'on relit. Une `Map` ou un `Set` dont chaque entrée — clé, valeur, élément — est une valeur simple, un objet ou une liste ordinaires est suivi en entier, comme un objet ordinaire : MJS suit ses clés, ses valeurs et ses éléments (cf. « État profond — mutation imbriquée », plus bas) ; un `WeakSet` de même. Seule l'entrée elle-même est regardée, pas ce qu'elle range à son tour : une fonction ou un accesseur rangés dans un objet ou une liste de la collection (`new Map([['a', {g: f}]])`, `new Set([[f]])`) sont « plus loin », comme dans l'objet d'une variable — l'écran garde l'ancienne valeur, `µrefresh($m)` le remet (cf. la fin de ce paragraphe). Ce suivi demande la part des collections du cœur (cf. plus bas, « Ce suivi des clés objets ») : dans une appli qui ne nomme aucune collection, aucune n'est suivie en entier. Une collection n'est pas suivie en entier quand elle range — en clé, en valeur ou en élément — une fonction, l'instance d'une classe, un objet gelé ou scellé, un objet signalé ou une autre collection qui en range ; quand un champ est posé sur elle (`m.meta = …`) ; quand c'est l'instance d'une sous-classe, ou une collection rangée brute (`µraw`). Une `WeakMap` ne l'est jamais : elle ne se parcourt pas, MJS ne peut pas savoir ce qu'elle range. Avec le réglage `"proxy": false`, aucune collection ne l'est. MJS regarde ce que range une collection une fois — un parcours, qui s'arrête à la première entrée qu'il ne suit pas —, puis garde sa réponse : une frappe sans rapport ne la reparcourt pas. Il la regarde de nouveau quand MJS a écrit la collection elle-même (`set`, `add`, `delete`, `clear`, un champ posé sur elle) et après `µrefresh`. Ce qu'il ne voit pas suit la règle de tout changement fait hors de MJS, `µrefresh($m)` : une entrée ajoutée ou retirée sur la collection gardée sans `$` ou par une bibliothèque, un objet gelé, scellé, fermé aux ajouts ou dont le prototype a été changé après avoir été rangé, une collection rangée dans une autre et écrite par un autre composant, par `µ.state` ou par un `µStore`. Une valeur qui fait une requête et lit un tel objet repart donc à chaque écriture profonde, une frappe dans un champ comprise : faites-lui lire des valeurs simples, un objet ordinaire ou une collection suivie en entier. Celle qui ne lit que des valeurs simples, des objets et des listes ordinaires, une collection suivie en entier, une `Date`, une expression régulière ou un autre objet du navigateur (`URL`, `DOMRect`, liste typée, `dataset` ou `attributes` d'une balise…) n'est pas refaite par une écriture profonde sans rapport. Si le calcul refait lève, l'écriture va au bout et l'erreur passe par le rendu, comme pour toute valeur affichée. Rangé plus loin dans un objet ou une liste (`$d = {m: new Map(…)}`, `$l = [instance]`), un tel objet n'est pas vu : l'écran garde l'ancienne valeur ; écrivez une fois `µrefresh($d)` après une écriture qu'il doit suivre, l'écran suit alors aussi les suivantes, tant que `$d` tient le même objet. MJS ne reconnaît pas non plus l'instance d'une classe qui porte une étiquette (`Symbol.toStringTag`) ou qui étend `Date`, `Error` ou un objet du navigateur : l'écran garde l'ancienne valeur ; même remède, `µrefresh($x)` une fois, à refaire quand `$x` reçoit un nouvel objet. Une expression qui ne lit l'état que par `µread` (`$taille = µread($l).length`) n'est pas une valeur dérivée : `µread` lit sans suivre, la valeur est prise une fois, à la création du composant, comme une valeur de départ. Une valeur faite seulement de lectures, de `.length`, d'opérateurs, de `Math.*` et des conversions (`String`, `Number`…) y reste aussi, quand aucune valeur précise ne la lit : la refaire coûte moins que vérifier ses sources (`mjs check --derived` dit « calcul simple »).

```html
<script>
  $articles = charger()
  $recherche = ''
  $panier = 0
  # précise : suit $articles et $recherche (un clic sur le panier ne la refait pas), sauf quand elle repasse à l'horloge
  $trouves = $articles.filter((a) -> a.nom.includes($recherche))
  # à l'horloge, calcul simple : une lecture et une addition coûtent moins que leur vérification
  $resume = $trouves.length + $panier
  # à l'horloge : appelle une fonction du <script>, refaite après toute écriture du composant
  $total = calculerTotal($articles)
</script>
```

Ce que la précision rapporte et ce qu'elle coûte (bancs de MJS sur une machine chargée : des ordres de grandeur ; Chromium, Firefox et WebKit) : une boutique de 400 valeurs précises relues après chaque clic sur le panier passe de 160 à 250 ms à 1 à 1,5 ms pour 20 clics (×160 à ×190) ; une valeur qui filtre une liste de 10 000 lignes, refaite après chaque écriture d'une de ses sources, prend 2,1 ms par calcul sur Chromium, précise comme à l'horloge (128 ms contre 130 ms pour 60 calculs, mesures alternées) : la liste étant parcourue d'un bloc pendant son calcul, la précision ne coûte rien de plus quand la valeur doit être refaite. En échange, le suivi des écritures se paie quand les sources changent avant chaque lecture : sur une liste de 10 000 lignes, 40 écritures d'une ligne suivies chacune de la lecture d'une valeur précise qui filtre la liste prennent 5 à 11 % de plus ; 2 000 écritures suivies chacune de la lecture d'une valeur simple durent 2,5 à 5,5 ms en tout, de ×0,90 à ×1,38 selon le navigateur, dans la marge de la mesure (horloge de 1 ms sur Firefox et WebKit) ; le redessin de 10 000 lignes affichées que demande un changement fait hors de MJS (`µrefresh($rows)`) coûte 3 à 7 ms (cf. ⚠️ plus bas). En production, la précision ne coûte rien à une application sans valeur dérivée : son cœur est celui de l'horloge, à l'octet (appli du banc de l'accueil : 39 831 octets, 15 728 compressés). Dès qu'un composant a une valeur dérivée, même classée à l'horloge, la machinerie de la précision entre au cœur de production : une petite appli dont la seule valeur dérivée est `$d = $a * 2` pèse 3 434 octets de plus qu'avec `"clock"` (3 637 quand cette valeur lit un magasin ; tailles non compressées). Avec `"clock"`, rien de tout cela : le code produit et le cœur sont ceux de la règle de l'horloge, à l'octet pour une construction neuve ; une construction de production reprend les noms courts que garde `.mangle-cache.json` (cf. [32](32-cli-et-configuration.md)), ceux qu'y a laissés une construction faite avec la précision compris : retirez ce fichier pour retrouver la sortie d'une construction neuve.

Une valeur précise note, à chaque calcul, les sources qu'elle lit vraiment : dans `$vue = if $mode then $a.map(…) else $b.map(…)`, une écriture de `$b` ne refait pas `$vue` tant que `$mode` est vrai. Refaite à l'identique (une valeur simple égale selon `Object.is` ; un objet compte toujours pour refait, même quand c'est le même objet : il a pu changer en place, comme `$sel = $l.find(…)` après `$l[0].nom = …`), elle ne fait pas refaire les valeurs précises qui la lisent : dans une chaîne de 40 valeurs précises dont la première retombe sur sa valeur, une seule est refaite. Une source lue dans un rappel (`filter`, `map`…) est notée une fois pour tout le calcul, même quand le rappel n'est pas appelé (liste vide) : au pire, un calcul de trop. Une source écrite avant chaque lecture (dans une boucle par exemple) ne la fait jamais repasser à l'horloge : relue après une écriture sans rapport, elle sert sa valeur.

Dans le doute à l'exécution, une valeur précise repasse à l'horloge pour toujours, et rend la même valeur qu'une valeur à l'horloge : quand elle lit ce que l'enveloppe de MJS ne suit pas sûrement — une valeur qui n'est pas une donnée propre de l'objet (un accesseur ou un champ venus d'une classe ou d'un prototype, `Object.create(base)`, même quand ils rendent `undefined` au départ, un accesseur de symbole d'une classe comme `Symbol.toStringTag`, la taille d'une `Map` ou d'un `Set`, un `Proxy` de votre application dont une lecture ne vient pas de l'objet), une méthode ou une conversion propres à l'objet, ou héritées d'un prototype qui n'est pas celui du langage (le `toString` ou le `Symbol.toPrimitive` d'une classe ou d'un prototype fait par `Object.create`, le `join` d'une sous-classe de liste : du code de votre application, qui peut lire un autre objet), un objet ou une liste gelés, un objet que MJS rend tel quel (une erreur, un objet du navigateur, un objet étiqueté par `Symbol.toStringTag`, un objet rangé dans un champ d'une `Map` ou d'un `Set` comme `$m.meta`, ou qui en sort ainsi par `get`, `for…of` ou `forEach`, une fonction rangée dans une `Map` ou un `Set`, en clé comme en valeur), un objet tenu aussi par un autre composant, par `µ.state`, `µ.Store` ou un magasin, un objet brut (`µraw`), une donnée posée sur un prototype du langage, un accesseur posé par la variable (`Object.defineProperty($l, 0, { get: … })`). Ces lectures se regardent à chaque calcul, en production comme en développement : une autre variable du composant qui écrit l'objet atteint par l'un de ces chemins (`$sel = $rows[1]` dans une liste gelée, puis `$sel.nom = 'Zoé'`) ne laisse pas la valeur sur un ancien calcul. La clé objet d'une `Map` n'en est pas : elle sort enveloppée, comme la valeur, et `[...$choix].map((e) -> e[0].nom)`, après `$choix.set($rows[0], 1)`, reste précise — `$rows[0].nom = 'z'` la refait, et l'écran suit. Seule une clé d'une `Map`, ou un élément d'un `Set`, rangés sous l'enveloppe d'un autre composant, de `µ.state` ou de `µ.Store` (la collection faite là, puis donnée : la `Map` qu'un enfant reçoit de son parent, celle d'un magasin) sortent tels quels et font repasser la valeur à l'horloge. Ne se regarde pas : un accesseur propre à l'objet, posé sur l'objet lui-même avant que la variable le reçoive (`Object.defineProperty(o, 'p', { get: -> ligne.prix })`, ou `get p()` dans un objet littéral), sur un objet de l'état comme sur une ligne d'une liste — le voir demanderait de passer en revue chaque objet lu. Quand ce qu'il lit change, hors de MJS ou même par MJS — une autre variable `$` du composant qui écrit l'objet qu'il lit, ou la variable `$` qu'il lit lui-même (`get: -> $n * 2`) —, la valeur précise garde son dernier calcul : écrivez `µrefresh($l)` juste après le changement, ou rangez la valeur dans un champ plutôt que dans un accesseur ; en développement, un avertissement nomme l'accesseur que la valeur lit (cf. `µrefresh`, plus bas). Une donnée définie par la variable (`Object.defineProperty($l[1], 'sel', {value: true})`) est une écriture, comme `$l[1].sel = true` : les valeurs qui lisent `$l` se refont et l'écran suit, avec la précision comme à l'horloge. `µrefresh($l)` fait repasser à l'horloge les valeurs précises qui lisent `$l` (cf. ⚠️ plus bas). Un `Proxy` de votre application qui transforme un champ que l'objet porte (`get: (t, k) -> t[k] * taux`), ou qui rend `undefined` pour un champ que l'objet n'a pas avant de rendre autre chose (`get: (t, k) -> autre[k]`), ne se reconnaît pas : JavaScript ne dit pas qu'un objet est un `Proxy`, et le seul moyen de le savoir (`structuredClone`) copie toutes les données à chaque calcul — marquez un tel objet `µraw(objet)` : la valeur qui le lit garde alors la règle de toujours. Le compilateur laisse aussi à l'horloge toutes les valeurs dérivées d'un composant qui écrit son état sans passer par MJS (`µread($x) += 1`, `@_state`, le composant passé à une fonction, qui peut écrire son `_state`) : ces écritures contournent la variable. `µread($l).push(3)` n'en est pas une : `µread` rend la liste que tient la variable, telle que MJS la tient (dans son enveloppe), et la méthode la change par elle ; MJS voit l'écriture, `$t = $l.map(…)` reste précise, se refait à sa lecture suivante, et l'écran suit. Il laisse de même à l'horloge celles qui lisent une variable écrite par `$x = nom`, quand `nom` n'est pas un paramètre de la fonction qui écrit : votre code garde l'objet, et peut le changer sans que MJS le voie.

Une erreur levée pendant le calcul d'une valeur précise est celle de la règle de toujours, au même moment : `$l.filter($f)`, `$f` à `null`, lève l'erreur de la méthode, liste vide comprise. Sous Firefox, dont le message nomme l'expression du code qui appelle la méthode, ce nom est alors celui d'une variable interne de MJS.

Le parcours d'une liste pendant le calcul d'une valeur précise (`filter`, `map`, `find`…) rend ce que rend la méthode à l'horloge, liste gelée par le rappel ou constructeur des listes remplacé par votre page compris ; seules restent deux différences sans effet sur les valeurs : la méthode lue (`$l.filter`, la même d'une lecture à l'autre, et jamais `Array.prototype.filter`, dans les deux modes) n'a ni le `name` ni la `length` de celle que rend MJS à l'horloge, et un `Function.prototype.call` remplacé par votre page est appelé par les vérifications du calcul (12 fois pour un recalcul qui filtre 4 lignes, 3 fois à l'horloge), jamais pour appeler le rappel.

> ⚠️ Un objet que votre code garde ailleurs et change directement (`o.n = 5`, ou un accesseur posé par `Object.defineProperty(o, 'n', …)`, sur l'objet passé à `@choisir(o)`) ne prévient pas MJS : une valeur précise qui le lit (`$noms = $sel.l.map((x) -> x * $sel.n).join(',')`) garde son dernier calcul ; un calcul simple, laissé à l'horloge (`$double = $sel.n * 2`), suit à l'écriture suivante du composant, comme une valeur précise déjà repassée à l'horloge : un objet donné aussi à un autre composant, ou à une autre instance du même, l'y fait passer (cf. plus haut), et la valeur suit alors à l'écriture suivante, sans avertissement. La règle : un changement fait hors de MJS demande `µrefresh($sel)`, juste après lui (cf. `µrefresh`, plus bas) ; en développement, un avertissement le rappelle (cf. plus bas). Ou changez l'objet par la variable : `$sel.n = 5`, `Object.defineProperty($sel, 'n', …)` — une définition y est une écriture, comme l'affectation. Seule une définition qui ne change rien ne refait rien, comme l'affectation à valeur égale : la propriété est déjà une donnée propre de l'objet, et chaque attribut donné (`value`, `writable`, `enumerable`, `configurable`) y est déjà le même, selon `Object.is` (la comparaison de JavaScript pour une définition) : `NaN` défini sur `NaN` ne change rien, `-0` défini sur `0` change la donnée. Une clé absente créée à `undefined`, un indice au-delà de la longueur d'une liste, un attribut changé seul (`{ enumerable: false }`, `{ writable: false }`) ou un accesseur sont des écritures : l'écran suit. Pour relancer un effet après un changement fait hors de MJS, écrivez une nouvelle valeur (`$x = [...$x]`) ; une poignée de `µload` ou une promesse, que MJS n'enveloppe pas, se réécrit comme toute écriture : les effets qui la lisent repartent.

### `µrefresh` — signaler un changement fait hors de MJS

> 📄 La page complète, avec une scène avant / après, ce que vérifie le développement et ce que la production ne vérifie plus, les formes refusées et les mauvais usages : [41 · µrefresh](41-refresh.md).

MJS voit les changements faits par une variable `$` (`$sel.n = 5`, `$l.push(x)`). Un changement fait hors de MJS dans ce que tient `$x` — par une bibliothèque, par un script extérieur, ou par un objet gardé dans une variable sans `$` — ne le prévient pas. Juste après un tel changement, écrivez `µrefresh($x)` (ou `µrefresh $x`, seul sur son instruction) : ce qui affiche `$x`, et ce qui affiche une autre variable du composant qui tient le même objet, se redessine, et les valeurs dérivées qui le lisent se refont — précises, elles repassent à l'horloge pour toujours. Le signal reste sur l'objet que tient `$x` : ce qui affiche une valeur à l'horloge qui lit une variable qui le tient suit ensuite les écritures profondes du composant, même faites par une autre variable (`$ligne.prix = 20`, quand un accesseur posé sur l'objet de `$x` avant que la variable le reçoive lit cette ligne) ; chaque changement fait hors de MJS, lui, demande son `µrefresh`. `$x = $x`, la variable écrite avec sa propre valeur, est refusée à la construction, à sa place, par un message qui dit d'écrire `µrefresh($x)` ; une autre écriture du même objet (`$x = o`, `o` gardé ailleurs) ne prévient de rien. Aucun `µeffect` ne repart (ni `µeffect.before`), le parent lié par `!{…}` n'est pas prévenu : pour relancer un effet, écrivez une nouvelle valeur (`$x = [...$x]`). L'enfant qui reçoit l'objet (prop ou liaison) ne l'est pas non plus : `µrefresh($x)` écrit dans le parent redessine le parent ; l'enfant garde son écran et ses valeurs dérivées, avec ou sans l'option, jusqu'à sa prochaine écriture — écrivez `µrefresh` dans l'enfant, ou donnez-lui une nouvelle valeur. `µrefresh` sert avec la précision comme à l'horloge (`"derived": "clock"`) ; sur une valeur primitive, il redessine ce qui l'affiche. Il n'accepte qu'une variable `$` que le composant déclare, ou une clé du magasin (`$$x`, plus bas) : un chemin (`$x.a`, `$$x.a`), une variable sans `$`, un état de module (`µ$$x`, un `µStore` compris) ou un contexte (`§§x`), une valeur dérivée (elle se refait d'elle-même : signalez la variable qu'elle lit), un nom que le composant ne déclare pas, aucun ou plusieurs arguments (`µrefresh $x, $y` compris) sont refusés à la construction, par un message qui dit quoi écrire. Hors d'un composant — dans le `<script module>` ou dans un module importé, le fichier d'un magasin compris —, seule une clé du magasin se signale : `µrefresh($x)` et `µrefresh(µ$$x)` y sont refusés à la construction, à leur ligne ; pour un état de module, écrivez une nouvelle valeur dans la clé que le changement a touchée (`µ$$x.lignes = [...µ$$x.lignes]`, `µ$x.lignes = [...µ$x.lignes]` dans le fichier du magasin). Pour un magasin, écrivez `µrefresh($$x)` (ou `µrefresh $$x`, seul sur son instruction), juste après le changement fait hors de MJS dans l'objet que tient la clé (par une bibliothèque, ou par `µread($$x)`) : ce qui affiche la clé, dans chaque composant qui la lit, et ce qui affiche une autre clé qui tient le même objet, se redessine, et les valeurs dérivées qui la lisent se refont ; aucun reffet ne repart, ni d'un composant ni du fichier d'un magasin — pour en relancer un, écrivez une nouvelle valeur (`$$x = {...$$x}`) ; un reffet qui lit la clé et la signale ne se relance pas lui-même, et repart quand une autre partie de l'appli l'écrit. `µrefresh($$x)` s'écrit dans le script, dans un gestionnaire d'événement, dans le `<script module>` ou dans le fichier d'un magasin, en développement comme en production. `$$x = $$x`, la clé écrite avec sa propre valeur, est refusée de même : écrivez `µrefresh($$x)` ; une autre écriture du même objet (`$$x = o`, `o` gardé ailleurs) ne prévient de rien. Sans parenthèses, `µrefresh $x` s'écrit seul sur son instruction (rien après `$x`, sinon `;` ou un commentaire) : suivi d'un opérateur ou d'une autre expression (`µrefresh $x or $y`, que Civet lirait `µrefresh($x or $y)`, ou `µrefresh $x if …`), il est refusé à la construction, par un message qui conseille les parenthèses. Il s'écrit dans le script ou dans un gestionnaire d'événement (`@click={µrefresh($x)}`, `@blur={…}`) ; ailleurs dans le gabarit (interpolation, valeur d'attribut, `:attach`, expression d'un bloc `{if}`, `{key}`, `{for}` ou `{await}`), c'est le rendu qui l'évalue, et le redessin qu'il demande relancerait ce rendu — une boucle de rendu : il y est refusé à la construction. Appelé pendant un rendu ou pendant le calcul d'une valeur dérivée, `µrefresh` n'est jamais ignoré : il est appliqué juste après ce rendu, comme une écriture faite par un effet. C'est le cas d'un écouteur que le rendu déclenche — sous Chromium, le rendu qui retire le champ qui a le focus émet `blur` et `focusout` ; `el.focus()` dans `:attach` émet `focus` et `focusin` ; un `el.click()` lancé par une fonction du gabarit émet `click` —, qu'il soit un gestionnaire du gabarit (`@blur={…}`), un écouteur `µon` ou l'écouteur qu'une bibliothèque pose elle-même (`addEventListener`, par exemple dans `:attach`), même quand il déplace le focus ou attend (`await`) avant de l'appeler, et quel que soit le nombre d'écouteurs du même événement : l'écran suit. Une fonction du script que lit le gabarit (`@g = -> µrefresh($x)` et `{@g()}`) ne doit pas l'appeler : chaque appel redessine ce qui la relit, qui le rappelle — une boucle de rendu, comme avec toute écriture faite là (`$x = …`) ; une valeur dérivée non plus : seule, son appel ne boucle pas (une écriture faite par son propre calcul ne la périme pas) mais redessine à chacun de ses calculs, et deux valeurs dérivées dont chacune rafraîchit une source de l'autre se refont l'une l'autre en boucle — en développement, un avertissement nomme `µrefresh` et la valeur dérivée. Après 10 000 rendus dans la même rafale, MJS cesse de rendre le composant pour garder la page vivante ; en développement, un avertissement nomme `µrefresh` et dit où l'écrire. La production coupe la boucle de même, sans avertissement.

```html
<script>
  $sel = { n: 1 }
  @choisir = (o) -> $sel = o
  # la page garde l'objet donné à @choisir, le change elle-même (o.n = 5), puis appelle @signaler()
  @signaler = -> µrefresh($sel)
</script>
<p>{$sel.n}</p>
```

La règle : un changement fait hors de MJS demande `µrefresh($x)` ; en développement, un avertissement le rappelle. Une valeur précise qui va servir son dernier calcul alors que l'horloge l'aurait refaite (le composant a écrit une autre variable) est refaite à part et comparée à ce dernier calcul. La comparaison suit les listes, les objets, les `Map` et les `Set` sur 6 niveaux ; au-delà, et pour un objet qui se contient lui-même, elle tient deux objets pour égaux : aucun avertissement plutôt qu'un faux. Une différence dit qu'une donnée qu'elle lit a été changée hors de MJS : un avertissement, un par valeur et par composant, nomme la valeur et le composant, et dit quoi écrire (`µrefresh($sel)`). La valeur servie reste celle de la production, où ce contrôle n'existe pas : le code de production ne le porte pas. En développement, il coûte au plus le calcul que l'horloge aurait fait, plus la comparaison ; chaque calcul d'une valeur précise y note aussi les accesseurs propres qu'il lit, et ce qu'ils rendent. C'est le seul contrôle que le développement ajoute : la lecture d'une valeur précise regarde les mêmes objets dans les deux modes (cf. « Dans le doute » plus haut), si bien que la valeur servie est la même. Quand la valeur lit un accesseur propre à un objet, que la lecture ne regarde pas, et qu'il rend autre chose qu'au dernier calcul, l'avertissement nomme cet accesseur (`$l[0].p`) au lieu de parler d'un changement fait hors de MJS : ce qu'il lit a pu être écrit par MJS lui-même ; il dit de même quoi écrire. Un accesseur qui rend ce qu'il rendait (une constante, lue à côté d'un champ changé hors de MJS) n'est pas accusé : l'avertissement parle d'un changement fait hors de MJS.

### `µderived` — dépendances déclarées

La dérivation automatique lit le **texte** de l'expression pour repérer les `$` dont elle dépend. Une valeur dérivée à l'horloge se recalcule quand on la lit, après toute écriture du composant : un gestionnaire ou un `µeffect` qui la lit reçoit la valeur du moment, même quand une partie de ses lectures est cachée — une fonction ou une méthode du `<script>` qui lit l'état, un accès calculé `$[k]`, la méthode, l'accesseur ou l'itérateur d'un objet de votre application (`$trad.get('titre')`, quand `get` lit `$dict`). Mais ce que le gabarit en affiche ne suit que les `$` qu'elle lit en toutes lettres (et les écritures profondes du composant quand l'un d'eux tient ce que MJS ne suit pas, cf. plus haut), et un `µeffect` qui la lit ne se relance qu'avec ces `$` et les siens : l'écran peut garder l'ancienne valeur. Seule exception, l'accès calculé `$[$k]` lu par le gabarit, ou par une valeur dérivée qu'il affiche, qui ne lit que l'état (des `$`, `$[…]`, des littéraux et des opérateurs, sans appel de fonction) : il se relance à toute écriture du composant, et l'écran suit la variable que nomme `$k`. S'il appelle une fonction, il ne suit que ses dépendances connues : nommez-les avec `µderived`. Une variable sans `$` qu'une fonction change (`compteur += 1`), l'heure ou le hasard (`Date.now()`, `Math.random()`) ne préviennent rien : sans écriture du composant, la valeur lue reste celle du dernier calcul. `µderived $var = expression, $a, $b` nomme les dépendances que l'affichage doit suivre : l'**expression** d'abord, les **dépendances** ensuite, séparées par des virgules. L'écran, et un `µeffect` qui la lit, suivent dès que l'une d'elles change.

```html
<script>
  computeTotal = -> $price * $quantity
  µderived $total = computeTotal(), $price, $quantity
</script>
```

> ⚠️ `µderived` ne se déclare qu'au niveau **racine** du `<script>` (jamais à l'intérieur d'une fonction, jamais dans une interpolation ou un handler). Chaque dépendance doit être un symbole `$` **nu** (`$price`, jamais `$order.price` ni un store `$$x`). Sans virgule après l'expression, l'écriture retombe sur une dérivation ordinaire.

> 🔗 **Dériver d'une source *partagée*.** Le membre de droite n'est pas limité aux `$` locaux : il peut lire un **contexte** (`§x`, `§§x`) ou un **store** universel (`$$x`, `µ$$x`, `µ.store`). `$prix = §§tva * $ht` est un dérivé parfaitement valide. MJS le repère et l'évalue **paresseusement au premier rendu** — une fois le composant branché à l'arbre, donc son contexte résolu — et non à la construction, puis le ré-évalue quand la source partagée change. C'est ce qui referme un piège subtil : un dérivé lu *uniquement* depuis une source partagée (aucun `$` local à droite) était sinon calculé trop tôt, dans le constructeur d'un composant pas encore connecté → contexte introuvable → valeur figée à `undefined`. Désormais il attend le bon moment tout seul.

### Écrire une valeur dérivée

Une valeur dérivée `$x = expr` que votre code écrit devient une variable ordinaire : elle garde la valeur écrite et ne suit plus ses `$`. C'est ce qui fait marcher une valeur de départ qui devient un compteur (`$uid = $todos.length + 1`, puis `$uid++`) ou une sélection (`$sel = $items[0]`, puis `$sel = item`).

Une valeur déclarée par `µderived $x = expr, $a, $b` que votre code écrit garde la valeur écrite jusqu'à ce que `$a` ou `$b` change, puis se recalcule : le choix est oublié. Les autres écritures du composant ne la touchent pas. `µclone` copie un choix qui tient encore ; la copie suit ensuite ses propres dépendances.

```html
<script>
  products = [{ name: 'Robe', sizes: ['S', 'M', 'L'] }, { name: 'Veste', sizes: ['XS', 'XL'] }]
  $product = products[0]
  µderived $size = $product.sizes[0], $product   # la première taille du produit
  pick = (s) -> $size = s                         # le choix du visiteur, gardé tant que $product ne change pas
  next = -> $product = if $product.name is 'Robe' then products[1] else products[0]
</script>

{for s in $product.sizes}<button @click={pick(s)}>{s}</button>{end}
<p>Taille : {$size}</p>
<button @click={next()}>Produit suivant</button>
```

Le visiteur choisit « L » : la taille reste « L », quoi que le composant écrive d'autre. Au produit suivant, `$size` repart de la première taille, « XS ».

> ⚠️ Le choix tient quand le composant écrit la valeur dans une fonction du `<script>` ou dans un gestionnaire du gabarit. Une `µderived` qu'il n'écrit nulle part ailleurs (écrite seulement au premier niveau du `<script>`, ou depuis un autre composant), ou dont une dépendance nommée n'est pas une variable `$` du composant, devient une variable ordinaire à sa première écriture, comme `$x = expr`.

### `µtoggle` — basculer un état

Faire alterner un état entre deux valeurs se paie d'un ternaire qui répète son nom trois fois : `@click={$layout = ($layout == 'banner') ? '' : 'banner'}`. La rune **`µtoggle`** l'écrit une seule fois.

```html
<button @click={µtoggle($ouvert)}>plier / déplier</button>
<button @click={µtoggle($layout, 'banner')}>bandeau</button>
<button @click={µtoggle($theme, 'gold', 'dark')}>changer de thème</button>
```

**La liste des valeurs EST le cycle**, dans l'ordre écrit, en boucle :

| Écriture | Ce que fait un clic |
|---|---|
| `µtoggle($ouvert)` | `false` ⇄ `true` |
| `µtoggle($layout, 'banner')` | `''` ⇄ `'banner'` — une seule valeur, donc présent / absent |
| `µtoggle($theme, 'gold', 'dark')` | `gold` → `dark` → `gold` → … **jamais par le vide** |
| `µtoggle($theme, '', 'gold', 'dark')` | `''` → `gold` → `dark` → `''` → … le vide y entre parce qu'il est écrit |
| `µtoggle($n, 1, 2, 3)` | `1` → `2` → `3` → `1` → … |

Un cycle à deux valeurs ou plus reste **fermé** sur les états écrits : c'est ce qui sépare `µtoggle($theme, 'gold', 'dark')` (deux thèmes qui alternent) de `µtoggle($theme, '', 'gold')` (un thème qu'on met et qu'on retire). Une valeur courante hors liste — un état jamais initialisé, une valeur venue d'ailleurs — retombe sur le **premier** de la liste.

`µtoggle` est un sucre de **compilation** : la rune disparaît du code livré, remplacée par l'affectation qu'on aurait écrite à la main. Elle marche donc partout où une affectation marche — un handler, une méthode, un `µeffect` — pas seulement dans un attribut d'événement.

#### Ce que `µtoggle` sait basculer

Le premier argument est **ce qu'on réaffecte** : n'importe quel chemin qu'on pourrait écrire à gauche d'un `=`, pourvu que le **relire** soit sans conséquence. La bascule relit en effet la cible une fois par test de la chaîne — un appel, un `++` ou un index calculé y seraient évalués plusieurs fois, effet de bord multiplié en douce : ils sont refusés.

| Cible | Bascule | Re-rend l'affichage |
|---|---|---|
| `$x`, `$o.a.b`, `$arr[0]` | ✅ | ✅ |
| `$$x`, `µtheme`, `µlang` | ✅ | ✅ |
| `§§x` (contexte réactif) | ✅ | ✅ |
| `@prop`, `§x` (contexte simple), variable ordinaire | ✅ | ❌ — la valeur change, rien ne se redessine |
| `f()`, `$x++`, `$arr[$i]` | ❌ refusé à la compilation | |

Les trois dernières lignes du ✅ sont utiles pour de la **logique interne** — un sens de tri, un mode qu'on relit plus tard — jamais pour piloter l'affichage : pour ça, il faut un `$`.

```html
<script>
  sens = 'asc'   # variable ordinaire : pas un état, rien ne se redessine tout seul
</script>
<button @click={µtoggle(sens, 'asc', 'desc'); trier(sens)}>trier</button>
```

> ⚠️ Une variable ordinaire doit être **déclarée dans le `<script>`**. Un nom qui n'existe nulle part est refusé au build, avec le message qui va bien : dans un gestionnaire, il serait recréé à chaque appel et lèverait un « Cannot access … before initialization » au premier clic. C'est la signature du `$` oublié.

> ⚠️ Les valeurs du cycle sont **littérales** (chaîne, nombre, `true`/`false`, `null`) : une expression serait évaluée deux fois par la bascule, elle est refusée à la compilation. Une même valeur écrite deux fois dans un cycle est refusée aussi (le cycle s'y arrêterait pour de bon).

## Figer une valeur — `=:` / `µsnap`

`$x =: expression` affecte la valeur **sans** que `$x` devienne un dérivé : c'est l'opt-out ponctuel de la dérivation automatique décrite plus haut. `µsnap(expression)` est la forme explicite équivalente — les deux écritures produisent exactement le même effet.

```html
<script>
  $tabs = ['infos', 'options', 'avancé']
  $activeTab =: $tabs[0]
</script>
```

`$activeTab` part de la valeur du premier onglet au moment de l'affectation, et n'y **revient plus** ensuite quand `$tabs` change — à l'inverse d'un `$y = $tabs[0]` ordinaire, qui resuivrait `$tabs` comme un dérivé.

> ⚠️ À l'exécution, `µ.snap` ne fait **aucune** copie : c'est l'identité, la même référence est assignée telle quelle — pas un instantané profond. Son seul rôle est de marquer l'affectation pour le compilateur, qui saute alors la mise en dérivé. Ne pas confondre avec `:=`, réservé par Civet au `const` : le symbole MJS pour figer une valeur est `=:`, jamais l'inverse. Réaffecter nu un nom lié par `:=` (simple, déstructuré, ou depuis une fonction imbriquée) refuse de compiler, avec un message qui nomme l'identifiant et la solution : `.=` (au lieu de `:=`) donne un `let`, réaffectable.

## Reffets — `µeffect`

`µeffect` pose un **reffet** — un effet réactif : du code exécuté **en réaction** aux `$` qu'il lit, une fois au montage, puis à chaque changement de ce qu'il a lu à son dernier passage (« effet », seul, désigne un effet `*nom` posé sur une balise : cf. [38 · Effets](38-effets.md) ; ce qu'il suit : plus bas). C'est le pont vers le monde extérieur (log, `localStorage`, canvas, timers, abonnements…).

```html
<script>
  $heure = ''
  $delai = 1000
  µeffect ->
    couper = µevery $delai, -> $heure = new Date().toLocaleTimeString()   # repart quand $delai change
    -> couper()                                                           # dernière fonction retournée = nettoyage
</script>
<p>{$heure}</p>
```

En Civet, la **dernière instruction est retournée** : si c'est une fonction, MJS la garde comme **nettoyage**, exécuté avant la prochaine ré-exécution du reffet *et* à la destruction du composant. Un `µon` écrit en dernier (`µeffect -> µon 'scroll', suivre`) rend ainsi son nettoyage : l'écouteur part avant le passage suivant, au lieu de s'ajouter à celui du passage précédent.

### Ce qu'un reffet suit

Un reffet suit ce qu'il a **vraiment lu à son dernier passage** : chaque `$x` lu dans son corps et dans toute fonction du `<script>` qu'il appelle pendant ce passage — méthode, fonction rangée dans un objet ou passée comme valeur, rappel d'un `forEach` ou d'un `map` —, chaque valeur dérivée de son composant qu'il lit, et chaque clé du magasin (`$$x`) lue pendant ce passage, où qu'elle soit lue. La liste est refaite à chaque passage :

- une variable ou une clé du magasin de la branche qu'il n'a pas prise n'est pas suivie : `µeffect -> console.log(if $mode then $a else $$b)` ne repart pas quand `$$b` change tant que `$mode` est vrai, et suit `$$b` dès qu'il passe par cette branche ;
- une valeur dérivée refaite à l'identique ne le relance pas : un reffet qui lit `$bas`, faite de `$g` et `$d`, elles-mêmes faites de `$src`, ne repart pas quand `$src` change sans changer `$g` ni `$d`. Une valeur dérivée à l'horloge (`"derived": "clock"`, ou classée à l'horloge, cf. plus haut) compte comme les variables qu'elle lit : il repart à leur écriture ;
- une variable lue après coup — après un `await`, dans une promesse, une minuterie, un écouteur ou un rappel que le reffet passe, dans une méthode `async` qu'il appelle — reste suivie comme le code la nomme : le reffet repart à son écriture, lue ou non à son dernier passage, même quand le passage la lit aussi dans une branche qu'il n'a pas prise (`µeffect -> r = await charger($id) ; $liste = filtrer(r, $filtre)` repart quand `$filtre` change) ;
- une fonction d'un autre composant appelée pendant le passage — une méthode d'un enfant — lit pour ce composant-là : ses variables et ses valeurs dérivées ne relancent pas le reffet ;
- un gestionnaire déclenché pendant le passage — le gestionnaire du parent qui reçoit un `µemit`, celui du composant lui-même ou son écouteur `µon` quand le reffet clique un bouton ou donne le focus à un champ, le gestionnaire d'un `<@window>` ou d'un `<@document>` de n'importe quel composant, avec ou sans reffet, quand le reffet y déclenche un événement — lit pour lui seul : ses lectures ne relancent pas le reffet (un gestionnaire qui écrit ce qu'il lit ne le fait pas tourner en rond) ;
- une variable qu'il écrit puis lit dans le même passage (`µeffect -> $c = 5 ; console.log $c`) ne le relance pas pour cette écriture : il en a déjà lu la nouvelle valeur, et passe une fois (la 3.1 le faisait passer deux fois) ;
- un passage qui lève une erreur suit ce qu'il a lu avant l'erreur.

Ce que le passage ne note pas reste au relevé fait à la construction : une clé du magasin que le reffet écrit lui-même (règles plus bas), l'énumération du magasin (`for k in $$`), une clé lue après coup ; un `µ$$x`, un `µStore` et un contexte `§§x` gardent l'abonnement de leur composant, qui se redessine en entier à leur changement et fait alors passer tous ses reffets ; et un reffet qui, à son dernier passage, n'a lu ni variable `$` du composant ni clé du magasin (il ne lit qu'un `µ$$x`, un `µStore`, un contexte `§§x`, le DOM, une clé calculée `$[k]`) repart à chaque écriture d'une variable que son code nomme, et, s'il n'en nomme aucune, à chaque mise à jour du composant. Des écritures groupées — une boucle, un gestionnaire qui écrit trois variables — le font passer une fois, sur l'état final. `µrefresh($x)` ne le relance pas, même par une valeur dérivée qui lit `$x` (cf. [41](41-refresh.md)).

`µeffect` (comme `µ.effect`) **rend une fonction qui retire le reffet**, sans attendre la destruction du composant : il ne repart plus, et son nettoyage, s'il en a un, joue une fois. Un deuxième appel ne fait rien. Appelée après la destruction, la fonction ne rejoue pas le nettoyage, déjà joué, et retire le reffet pour de bon : il ne repart pas quand le composant revient dans la page.

```html
<script>
  $heure = ''
  $delai = 1000
  arreter := µeffect ->
    couper = µevery $delai, -> $heure = new Date().toLocaleTimeString()   # repart quand $delai change
    -> couper()
  pause := -> arreter()                                                   # l'horloge s'arrête, le reffet ne repart plus
</script>
<p>{$heure}</p>
<button @click={pause}>Pause</button>
```

Le retrait est sûr pendant que les reffets tournent : demandé par un autre reffet, par le reffet lui-même ou par son nettoyage, il ne saute ni ne rejoue aucun autre reffet. Retiré pendant son propre passage, le reffet joue aussitôt le nettoyage qu'il vient de rendre.

`µeffect` (comme `µinspect`) s'appelle pendant l'**initialisation** du composant : au premier niveau du `<script>`, y compris sous un `if`, un `else` ou une boucle de premier niveau (`unless µserver` puis, en retrait, `µeffect -> …`), même quand sa condition tient sur plusieurs lignes. Dans le corps d'une fonction — gestionnaire, méthode, hook, minuterie —, écrit en retrait ou non, l'appel arriverait hors de l'initialisation et le reffet serait ignoré : la compilation le refuse.

> ⚠️ Ne mettez **pas** un écouteur posé à la main (`addEventListener`) directement à la racine du `<script>` : ce code tourne dans le *constructeur* du composant, **avant** son attachement au DOM → aucun nettoyage au démontage (fuite mémoire), et il démarre même sur un composant jamais affiché. Toujours passer par `µeffect` pour ce qui a besoin d'un cycle de vie. Une minuterie s'écrit [`µevery`](16-cycle-de-vie.md#µevery--répéter-en-partant-tout-de-suite) ou [`µafter`](16-cycle-de-vie.md#µafter--un-seul-tir-plus-tard), à la racine comme ailleurs : elle part au montage et s'arrête quand le composant disparaît.

Un `$$x` lu par le reffet — dans son corps, dans une fonction du `<script>`, dans une méthode qu'il appelle ou dans une fonction rangée dans un objet — est une dépendance comme un `$x` : le reffet repart à chaque écriture de la clé, d'où qu'elle vienne, tant qu'il l'a lue à son dernier passage. C'est le cas typique d'une bibliothèque tenue hors du gabarit (canvas, scène 3D, carte) qui doit suivre une donnée partagée :

```html
<script>
  $zoom = 1
  µeffect ->
    scene?.afficher($$papiers, $zoom)    # repart quand $$papiers OU $zoom change
</script>
```

Une clé que le reffet lit **et écrit** reste une dépendance pour les écritures faites **hors de tout reffet** : un bouton, un gestionnaire, une minuterie ou une réponse réseau qui l'écrit le relance ; sa propre écriture, ou celle d'un autre reffet, jamais. Un bornage suit donc la clé quand la valeur vient d'une action :

```html
<script>
  $max = 10
  µeffect ->
    $$volume = $max if $$volume > $max    # un bouton qui pose $$volume = 50 est ramené à 10
</script>
```

Deux reffets qui écrivent la même clé ne se relancent jamais l'un l'autre par elle : la dernière écriture gagne, chacun passe une fois. Deux exemplaires d'un composant qui alignent une clé partagée sur leur propre valeur (`$$filtre = $f if $$filtre != $f`) se règlent ainsi sans boucle : le dernier qui écrit l'emporte, et les deux affichent la valeur du store. Une valeur posée par le reffet d'un autre composant n'est donc pas bornée par celui-ci : si un reffet écrit `$$volume = $$base * 10`, le bornage ne repart pas et `$$volume` reste à 70 ; bornez la valeur là où elle est calculée.

Une exception : quand l'écriture **cumule**, c'est-à-dire que la valeur écrite part de la clé elle-même (`$$vus += 1`, `$$vus++`, `$$ouvert = not $$ouvert`, `$$volume = Math.min($$volume, $max)`, `$$liste.push(x)`), la clé n'est **pas** une dépendance, et le reffet ne repart pas quand un autre code l'écrit. `$$vus += 1 if $$actif` repart quand `$$actif` change, jamais quand `$$vus` change : deux reffets qui cumulent sur la même clé (deux compteurs, ou deux exemplaires du même composant) se relanceraient l'un l'autre sans fin. Seul (`µeffect -> $$vus += 1`), le reffet passe une fois, au montage. Pour un bornage, préférez donc `$$volume = $max if $$volume > $max` à `Math.min`.

Une écriture qui arrive **après** le passage du reffet — dans un rappel (minuterie, promesse, écouteur), dans une fonction passée comme valeur (`µafter 100, borne`), ou après le premier `await` d'un reffet `async` — laisse dépendance une clé qu'il lit pendant ce passage : le reffet repart quand l'écriture arrive. C'est ainsi que fonctionne le message qui s'efface tout seul :

```html
<script>
  µeffect ->
    if $$toast
      couper = µafter 3000, -> $$toast = null    # le reffet repart sur null, et s'arrête là
      -> couper()                                # nettoyage : un nouveau message annule la minuterie du précédent
</script>
```

Une clé qu'il n'écrit et ne lit que dans ce code différé n'est pas une dépendance : `µeffect -> µevery 1000, immediate: false, -> $$tick += 1` passe une fois, au montage, et ne pose qu'un intervalle. Dans un reffet `async`, ce qui précède le premier `await` fait partie du passage. Une écriture faite dans son corps, ou dans une fonction du `<script>` ou une méthode qu'il appelle, compte comme la sienne.

Les variables locales gardent leur règle : un reffet qui écrit un `$x` qu'il lit repart sur cette écriture, tant que la valeur change.

Un dérivé calculé d'une clé du store suit la règle de cette clé : un reffet qui lit `$d` (`$d = $$n + 1`) et écrit `$$n` se comporte comme s'il lisait `$$n` lui-même. Un bornage par le dérivé (`$$v = 5 if $d > 10`) repart quand un autre code écrit `$$v`, jamais sur sa propre écriture ; une écriture qui cumule par le dérivé (`$$n = $d`) cumule, comme `$$n += 1` : `$$n` n'est pas une dépendance, le reffet passe une fois. Un dérivé calculé de variables locales garde la règle des variables locales.

Garde-fou : un reffet qui relance sans fin son composant (`$x = Math.random()` dans un `µeffect` qui lit `$x`) s'arrête au bout de 10 000 à 10 100 rendus dans la même rafale. Un avertissement « Boucle réactive détectée » part dans la console, les reffets du composant sont suspendus jusqu'à la fin de la rafale, et l'affichage continue de montrer l'état.

### Avant l'écran — `µeffect.before`

`µeffect.before` pose un reffet qui voit l'écran **tel qu'il était avant** la mise à jour que causent ses dépendances : il passe juste avant les blocs et les liaisons de son composant. C'est la place d'une mesure à prendre avant que le DOM change. Une discussion qui descend toute seule vers le dernier message, seulement si l'on était déjà en bas :

```html
<script>
  $messages = []
  enBas .= true

  µeffect.before ->
    $messages.length                                                          # repart à chaque message
    enBas = not fil or fil.scrollTop + fil.clientHeight >= fil.scrollHeight - 4

  µeffect ->
    $messages.length
    fil.scrollTop = fil.scrollHeight if fil and enBas                         # après la mise à jour du DOM
</script>

<div class="fil" :this=!{fil}>{for m in $messages by id}<p>{m.texte}</p>{end}</div>
```

- **Quand** : une fois au montage, avant le premier rendu des blocs (une référence `:this` peut encore y valoir `null`), puis à chaque écriture d'une de ses dépendances, dans la même voie que l'écran : sur-le-champ quand l'écriture met l'écran à jour sur-le-champ (une variable lue seulement par des liaisons de texte ou d'attribut, écrite dans un gestionnaire), sinon dans la passe en microtâche, juste avant les blocs. Sur-le-champ, il passe avant chaque écriture (trois écritures dans un gestionnaire, trois passages) ; dans la passe en microtâche, une fois. Le DOM relu juste après une écriture voit toujours la valeur, que le reffet d'avant écrive ou non : il passe avant l'écriture du DOM, jamais à sa place.
- **Ordre d'un passage** : reffets `µeffect.before`, blocs `{if}` `{for}` `{await}`, liaisons, reffets `µeffect`, puis `µmount` au montage ; deux reffets du même temps passent dans l'ordre où ils sont écrits.
- **Ses écritures** entrent dans le passage qui l'a fait passer : les blocs et les liaisons les montrent en même temps que l'écriture qui l'a lancé, et les reffets `µeffect` qui les lisent passent avec ceux de ce passage, une fois. Aucune passe de plus : rien n'est perdu, et l'écriture suivante d'un gestionnaire met encore l'écran à jour sur-le-champ. Elles ne relancent aucun reffet `µeffect.before` du composant : un reffet d'avant qui écrit ce qu'il lit ne boucle pas.
- Le reste suit la règle de `µeffect` : dépendances, nettoyage (la dernière fonction rendue), fonction rendue qui le retire, premier niveau du `<script>` seulement, garde des 10 000 rendus, « Crash intercepted » sur une erreur, rendu serveur. Une construction de production qui n'en écrit aucun n'en porte pas un octet.

### Le reffet d'un magasin ou d'un module

Un `µeffect` écrit au **premier niveau d'un module** — un fichier `.civet.mjs` ou `.coffee.mjs`, qu'il déclare un magasin (`export µ$$x = …`, `new µStore(…)`) ou non, ou le `<script module>` d'un composant — appartient à ce module, pas à un composant : il tourne sans aucun composant, à la création du magasin puis à chaque changement de ce qu'il suit, et survit au départ de tous les composants qui lisent le magasin. La sauvegarde d'un panier s'écrit donc avec le panier :

```civet
# panier.module.civet.mjs
sauve = if µserver then null else localStorage.getItem 'panier'
export µ$$panier = { articles: JSON.parse(sauve or '[]') }

µeffect ->
  localStorage.setItem 'panier', JSON.stringify µ$$panier.articles unless µserver
```

- **Ce qu'il suit** : le magasin qu'il lit, comme un composant qui le lit. Un `µ$$x` est suivi en entier : l'écriture de n'importe laquelle de ses clés le relance, même une clé qu'il ne lit pas (la sauvegarde ci-dessus repasse aussi quand une autre clé du panier change). D'un `µStore`, chaque clé de ses données qu'il lit (`stock.data.pieces`), avec ce qu'elle contient ; une clé `$$x`, en entier.
- **Quand** : en microtâche, quand le fichier a fini de s'exécuter, puis chaque fois qu'un changement de ce qu'il suit le prévient ; les avis reçus avant qu'il passe se réunissent en un seul passage. `µ$$x` et les clés `$$x` le préviennent au moment de l'écriture, un `µStore` en microtâche, une fois réunies ses écritures de la tâche : les écritures d'un gestionnaire dans des `µ$$x` le font passer une fois, celles dans des `µStore` aussi. Un gestionnaire qui écrit un `µ$$x` puis un `µStore` qu'il lit tous deux le fait passer deux fois (il passe pour le `µ$$x` avant que l'avis du `µStore` arrive) ; dans l'ordre inverse, une fois. L'écriture d'un autre reffet est un changement comme un autre, dès la création.
- **Sa propre écriture ne le relance pas**, que le magasin prévienne ses lecteurs sur-le-champ (`µ$$x`, clés `$$x`) ou en microtâche (`µStore`) : un reffet qui écrit ce qu'il lit (un compteur de sauvegardes, une date de mise à jour) passe une fois par changement venu d'ailleurs. Les autres lecteurs, composants et reffets, voient son écriture comme toute autre.
- **Deux reffets qui s'écrivent l'un l'autre** — chacun écrit dans ce que suit l'autre : deux `µ$$x` dont les reffets se lisent, ou deux reffets qui écrivent dans le `µ$$x` qu'ils lisent tous les deux — se relancent sans fin. La garde des 10 000 passages dans la même rafale les arrête, et en développement l'avertissement « Boucle réactive détectée » le signale ; chaque changement suivant les relance jusqu'à la garde. Un composant qui lit ces magasins est prévenu à chaque passage : il atteint aussi sa propre garde des 10 000 rendus, avec son avertissement. Rangez ce qu'écrit l'un hors de ce que suit l'autre (une variable non exportée du fichier, un magasin qu'il ne lit pas), ou faites-en un seul reffet.
- Un module ne finit pas pendant la vie de la page, son reffet non plus. Seul son fichier exécuté de nouveau (rechargement à chaud) le nettoie d'abord : son nettoyage joue, il ne suit plus rien, et le reffet de la nouvelle exécution prend sa place. La fonction que rend `µeffect` le retire, comme dans un composant.
- `µeffect.before` y est un reffet du magasin comme un autre : un magasin n'a pas d'écran.
- Une erreur dans son corps s'affiche dans la console (« Crash intercepted in panier.module.civet ») ; il repart au changement suivant de ce qu'il lisait à son dernier passage réussi (s'il n'en a eu aucun, de ce qu'il a lu avant l'erreur).
- Ailleurs, un reffet n'a pas de propriétaire et ne tourne pas : dans une fonction appelée plus tard ou dans le corps d'un reffet, même écrits dans un module ; en développement, un avertissement dit où l'écrire. Au premier niveau du `<script module>` d'un composant, il appartient au module du composant, avec les mêmes règles qu'ici : il passe une fois à l'import du composant, qu'aucun exemplaire ne soit encore dans la page ou qu'il y en ait dix, puis à chaque changement de ce qu'il suit, et vit avec la page ; dans une fonction de ce bloc, la compilation le refuse. Un module qui lève une erreur avant sa fin garde les reffets écrits avant l'erreur et n'adopte rien de ce qui s'exécute ensuite.
- Rendu serveur : même règle que `µeffect`, il tourne aussi côté serveur ; testez `µserver` pour ce qui ne vit qu'au navigateur (`localStorage`), comme le panier ci-dessus.

### `@@x` — l'instance depuis une fonction appelée nue

`@x` est la propriété `x` du `this` que donne l'appelant. Une fonction `->` définie à la racine du `<script>` et appelée **nue** (`tick()`, sans receveur) n'a pas de `this` : `@x` y retombe sur l'instance. Mais un appelant qui pose son propre `this` l'impose, partout et pour tous les noms : `.call(objet)` donne l'objet, un écouteur posé à la main (`bouton.addEventListener 'click', -> …`) l'élément, une fonction de module à qui vous passez la vôtre le `this` qu'elle choisit (la fenêtre, si elle la confie à `setTimeout`), un observateur l'observateur (plus bas) ; `µafter` et `µevery`, eux, appellent la leur avec le composant pour `this`. `@@x` lit toujours la propriété de l'instance, par une référence capturée une fois à l'initialisation, insensible au site d'appel. C'est aussi ce qu'il faut dans le corps d'un `µeffect`.

```html
<script>
  $count = 0

  tick = ->
    @@timer = µafter 1000, -> $count++   # @@timer : l'instance, d'où que tick soit appelé
</script>

<button @click={tick()}>Relancer ({$count})</button>
```

Dans un écouteur posé à la main, `@x` est l'élément qui reçoit l'événement, même pour un nom que le `<script>` pose sur l'instance ; l'instance s'y écrit `@@x` :

```html
<script>
  @vus = 0

  µmount ->
    bouton.addEventListener 'click', ->
      @@vus++                 # @@x : votre composant
      @classList.add('vu')    # @x : le bouton qui a reçu le clic
</script>

<button :this=!{bouton}>Voir</button>
```

> ℹ️ **Dans le rappel d'un observateur.** `new ResizeObserver(mesurer)` — comme `MutationObserver`, `IntersectionObserver` et `PerformanceObserver` — appelle `mesurer` avec **l'observateur** pour `this` : `@x` y lit l'observateur (`@disconnect()` l'arrête). Pour lire votre composant, écrivez `@@x` (`@@_shadow`, `@@largeur`), comme dans un écouteur posé à la main ou une fonction rappelée par un module.

```html
<script>
  @largeur = 0

  mesurer = ->
    @@largeur = @@_shadow.querySelector('nav').clientWidth   # @@x : votre composant
    @disconnect() if @@largeur > 0                           # @x : l'observateur, qu'on arrête

  µmount ->
    new ResizeObserver(mesurer).observe(@_shadow.querySelector('nav'))
</script>
```

## Persistance — `@persist`

`@persist` reconstitue automatiquement une variable réactive depuis le stockage du navigateur au montage, et la réécrit à chaque changement — pratique pour un brouillon, un thème ou une étape de formulaire qui doivent survivre à un rechargement. Sans préfixe, le stockage par défaut est le `localStorage` :

```html
@persist $draft

<script>
  $draft = ''
</script>

<textarea value=!{$draft}></textarea>
```

Un préfixe choisit explicitement le stockage :

```html
@persist session: $step
@persist local: $theme
```

Plusieurs variables sur une même ligne se séparent par des **espaces**, jamais par une virgule :

```html
@persist local: $darkMode $volume
```

> ⚠️ La virgule (`@persist local: $darkMode, $volume`) ne compile pas : chaque nom de variable est validé isolément, et c'est le nom lui-même qui reçoit alors la virgule collée — la compilation échoue sur ce nom-là.

Pour une clé de stockage qui dépend d'un contexte (un panier par utilisateur, par exemple), `by:` ajoute le résultat d'une expression à la clé — cette forme n'accepte **qu'une seule** variable :

```html
@persist $cart by: $userId
```

La clé effective est `mjs-<module>:<variable>` (suivie du résultat de `by:` quand il y en a un). La valeur est relue au montage, puis réécrite à chaque changement de la variable. Le transport passe par `JSON` (`JSON.stringify`/`JSON.parse`) : un `Date` stocké dans une variable persistée revient donc en texte après rechargement (sa date au format ISO, `'2026-10-20T08:00:00.000Z'`), une `Map` ou un `Set` en objet vide — jamais comme l'instance d'origine.

La valeur relue n'est reprise que si elle a la **même forme** que la valeur de départ : même type, et une liste pour une liste, un objet pour un objet. Une valeur d'une autre forme — laissée par une version précédente de l'appli (un objet là où la variable de la version en ligne part d'une liste), ou un `null` — est ignorée : la variable garde sa valeur de départ, rien ne casse au premier rendu. Une variable qui part de `null` (rien encore) reprend un objet ou une liste enregistrés.

Si le stockage est inaccessible (navigation privée, accès bloqué), la variable garde sa valeur de départ et fonctionne le temps de la visite. Si le quota est plein, la valeur déjà enregistrée est relue et les changements qui ne tiennent plus ne sont pas enregistrés ; dans les deux cas, aucune erreur n'est signalée.

## État profond — mutation imbriquée

Muter une propriété imbriquée d'un `$` est réactif, **d'où qu'elle vienne** — handler `@event` ou fonction de `<script>`. Une mutation écrite sur le `$` lui-même (`$todos[0].fait = true`) est réécrite à la **compilation** en un appel direct au runtime (`µ._mjs_deepSet`/`µ._mjs_deepCall`), sans passer par un Proxy. Une variable qui garde un objet de l'état (`t = $todos[0]`, `ancien := $a`) tient l'**enveloppe réactive** de cet objet : ce qu'elle écrit va dans cet objet-là, même si `$todos` ou `$a` change entre-temps (un `unshift`, une nouvelle liste, `$a = $b`), et tout ce qui l'affiche est prévenu. Le magasin `$$` suit la même règle : un alias écrit dans l'objet qu'il tient, puis prévient les lecteurs de la clé et ceux des clés qui rangent cet objet — voir [Stores — règle d'aliasing](14-stores.md#sous-le-capot-depuis-la-statisation).

Une méthode d'un objet de votre application qui porte le nom d'une méthode de liste, de `Map` ou de `Set` (`$panier.add(x)`, `$file.push(x)`, `$o.clear()` : `push`, `pop`, `shift`, `unshift`, `splice`, `sort`, `reverse`, `fill`, `copyWithin`, `set`, `delete`, `clear`, `add`) est appelée comme JavaScript l'appelle, sur l'enveloppe de l'objet : tout ce qu'elle écrit dans `this`, après un `await` compris, prévient ce qui l'affiche. L'appel direct au runtime reste celui d'une vraie liste, d'une `Map`, d'un `Set` ou d'une liste typée, et celui d'un objet dont la classe définit `Symbol.toStringTag`, compté parmi eux : ce que sa méthode écrit après un `await` demande alors `µrefresh(…)`. Avec `"proxy": false`, l'objet n'a pas d'enveloppe : l'appel prévient après la méthode, ce qu'elle écrit avant son premier `await` se voit, la suite est un changement fait hors de MJS (`µrefresh($panier)`).

```html
<script>
  $todos = [{ fait: false, texte: 'a' }]

  # réactif : re-rend le {for}, réécrit à la compilation
  cocher = -> $todos[0].fait = true

  # réactif aussi par une variable qui garde l'objet (son enveloppe réactive) :
  ajouterTag = ->
    t = $todos[0]
    t.tags ?= []
    t.tags.push('urgent')
</script>
```

Pour les cas que la compilation ne peut pas résoudre statiquement (l'objet **s'échappe** — passé à une fonction externe, stocké dans une structure tierce, alias réassigné…), MJS bascule automatiquement sur un **Proxy ciblé** à la frontière d'échappement : la réactivité reste préservée sans action de votre part. Le suivi statique couvre ~95&nbsp;% du code réel ; le Proxy comble le reste — jamais de trou silencieux.

Une liste de l'état donnée à une fonction qui la change (`trier($rows)` avec `trier = (x) -> x.sort()`, ou `x.pop()`, `shift`, `unshift`, `splice`, `reverse`, `fill`, `copyWithin`, `push`) est suivie comme si l'opération était écrite dans le composant : la méthode change toute la liste, puis l'écran suit en une fois, et elle rend ce que rend JavaScript. Il en va de même pour une liste rangée dans un objet (`$o.liste`), tenue par un enfant, ou d'un `µ.state`. Avec le réglage `"proxy": false`, la liste n'a pas d'enveloppe : la donnée change, et l'écran suit après `µrefresh($rows)` ([41](41-refresh.md)). Dans un comparateur, comparez un champ (`a.id === $choisi.id`), pas un objet de l'état, et n'y écrivez pas.

Un composant enfant qui **tient un objet de l'état** (`<@fiche item={$o.a}>`) suit toute écriture faite dans cet objet ou plus bas : directe (`$o.a.b.c = 5`), ou faite par un nom, une fonction, une méthode (`t = $o.a.b` puis `t.c = 5`, `regler($o.a.b)`, `l = $o.a.liste` puis `l.push(x)`). Chaque objet lu dans l'état garde les objets par lesquels le composant l'a lu, et l'écriture prévient, de proche en proche, ceux qu'un enfant tient : quelques opérations par écriture, quelle que soit la taille des données. Un objet rangé à plusieurs endroits (`$o.liste[0]` et `$o.courant`, une ligne dans trois listes), relu ailleurs entre la prise du nom et l'écriture, gardé à travers un `await`, ou qui se contient lui-même, garde ainsi tous ses chemins. Le nom peut être pris avant que le premier enfant existe. De même sous un état partagé (`st = µ.state({…})`) et sous un magasin (`p = new µ.Store({…}).data`) : l'enfant qui tient `st.o.a` ou `p.o.a` suit `t = st.o.a.b` puis `t.c = 5`, `p.o.a.b.c = 5`, `l = p.o.a.liste` puis `l.push(x)`, avec ou sans le réglage `"proxy": false` (leurs objets sont toujours lus par leur enveloppe), et les limites ci-dessous valent aussi pour eux : là où les chemins ne se suivent plus, ce sont les composants qui lisent l'état ou le magasin qui redisent leurs liaisons. Une variable du composant qui reçoit un objet d'un état partagé ou d'un magasin (`$courant = st.rows[1]`) écrit pour lui : `$courant.label = 'x'` prévient ceux qui lisent l'état, comme `st.rows[1].label = 'x'`. Une variable qui reçoit l'état entier (`$s = st`) ou une valeur dérivée de l'état (`$sel = st.rows.find(…)` déclarée en tête du script) n'écrit pas pour lui : écrivez par l'état. Un enfant qui écrit l'objet reçu de la variable de son parent (`<@fiche item={$courant}>`) ne prévient ni l'état ni son parent. Avec `"proxy": false`, `Object.assign($courant, …)` et une fonction qui reçoit `$courant` ne préviennent personne : écrivez `µrefresh($courant)`.

- Restent figés, comme sous l'écriture directe : un composant frère qui tient le même objet, un composant placé au-dessus à qui l'objet n'est pas lié, et l'enfant qui tient un autre endroit où le même objet est rangé quand le composant qui écrit n'a jamais lu l'objet par cet endroit (avec `$o = { a: { ref: m }, z: { m: m } }`, écrire par `$o.z.m` ne prévient pas l'enfant qui tient `$o.a` tant que le composant n'a pas lu `$o.a.ref`).
- Un endroit que l'objet a quitté ne compte plus : une ligne recopiée (`$rows[i] = { ...$rows[i], k }`), une liste remplacée (`$rows = $rows.filter(…)`, `$o.rows = $o.rows.filter(…)`). MJS le note au moment de l'écriture et le vérifie, quand il lui faut la place, en regardant la liste, la collection ou l'objet quittés, jusqu'à 2 048 éléments, entrées ou champs : une ligne recopiée à chaque frappe ne redessine que son enfant. Une ligne échangée avec une autre, ou retirée puis remise dans sa liste, y est toujours : elle garde ses chemins. Dans une liste de plus de 2 048 éléments, l'ancienne copie d'une ligne recopiée compte encore jusqu'au passage du ramasse-miettes.
- Là où ces chemins ne peuvent pas se suivre — un objet que votre composant a lu par plus de huit endroits de l'état (le dictionnaire commun à toutes les lignes d'une table ; une carte glissée de liste en liste dans neuf listes ou plus, les listes quittées comptant tant qu'elles restent dans l'état), une écriture qui remonte par plus de 32 objets, un objet atteint à travers un objet gelé, un navigateur sans `WeakRef` —, l'écriture par un nom redit toutes les liaisons de sa variable, et chaque enfant qui tient un objet de cette variable se redessine : davantage de rendus, jamais un écran figé.
- Comptent encore, jusqu'au passage du ramasse-miettes, les endroits qu'une écriture vide sans dire ce qu'elle retire — une liste vidée par `length = 0`, `fill` ou `copyWithin`, une collection vidée par `clear`, puis remplies de copies : écrivez `$rows = copies`, ou `$rows.splice(0, $rows.length, ...copies)` — et les anciennes versions d'un état de plus de trois niveaux refait en entier (`$app = { ...$app, e: { ...$app.e, p: { … } } }`) quand votre code les garde (historique d'annulation). Passé huit endroits, l'écriture par un nom redit les liaisons de la variable : davantage de rendus, jamais un écran figé.
- Un nom gardé après un déplacement suit les endroits où le composant a lu l'objet, pas celui où il a été rangé depuis sans être relu (`x = $o.a.b`, puis `$o.z.m = x` et `delete $o.a.b` : `x.c = 5` ne prévient pas l'enfant qui tient `$o.z`, alors que `$o.z.m.c = 5` le prévient). Relisez l'objet par son nouvel endroit (`x = $o.z.m`), ou écrivez `µrefresh($o)`. De même pour un nom gardé plus bas qu'un objet recopié (`t = $o.p.a.b`, puis `$o.p = { ...$o.p }` ; `t = $rows[0].s`, puis `$rows[0] = { ...$rows[0] }`) : la copie range les mêmes sous-objets, que le composant n'a pas encore lus par elle — `t.c = 5` ne prévient pas l'enfant qui tient la copie, alors que l'écriture directe (`$o.p.a.b.c = 5`), ou le nom repris après la copie, le préviennent.
- Demandent `µrefresh` ([41](41-refresh.md)) : le réglage `"proxy": false`, où MJS ne voit pas l'écriture par un nom qui ne suit pas un chemin fixe (`µrefresh($o)`) ; un objet atteint sans passer par l'état (variable sans `$`, objet gelé) ; le magasin `$$`, lu sans enveloppe — une écriture par un nom faite plus bas que l'objet que tient l'enfant, quand le nom ne suit pas un chemin fixe ou que l'écriture n'est pas une affectation simple (`t.c += 1`), se signale par `µrefresh($$o)`. L'écriture directe `$$o.a.b.c = 5`, l'écriture par un nom dans l'objet tenu lui-même, et l'affectation par un nom pris sur un chemin fixe (`t := $$o.a.b` puis `t.c = 5`, comme `t := $o.a.b` avec `"proxy": false`) préviennent sans rien de plus : le chemin est relu au moment de l'écriture, et l'écriture passe par lui s'il mène encore au même objet.

Une mutation profonde sur un objet **partagé** avec un composant enfant (liaison `=!{}`, voir [Bindings two-way](07-bindings.md)) prévient aussi ce parent, à n'importe quelle profondeur : `$obj.x = v` comme `$obj.a.b = v`, dans l'enfant, redessinent le parent dès que celui-ci lit `$obj` dans son gabarit.

Deux variables d'état qui pointent le **même objet** (`shared := {…} ; $a = shared ; $b = shared`) se comportent pareil : une mutation faite via l'une — compilée (`$a.x = 1`) ou à la frontière d'échappement (Proxy) — prévient aussi un lecteur de l'autre, les deux désignent la même donnée. C'est aussi la **même valeur** : après `$sel = it` (choix d'une ligne d'un `{for it in $items}`), `it === $sel`, `$items.indexOf($sel)` rend son rang et `$items.splice($items.indexOf($sel), 1)` retire bien la ligne choisie.

Un objet rangé dans une variable `$` de **deux composants** — la ligne d'une liste puis la page de son détail, une page quittée puis reprise, deux composants posés côte à côte — est noté pour cet objet seul : le composant qui ne l'écrit pas voit le changement dès que l'objet lui est redonné (prop reposée, liaison, `$x = o`), que l'autre soit encore dans la page ou en soit sorti, les écritures des autres objets de la page gardent leur précision, et un composant retiré de la page n'est jamais gardé en mémoire par les objets qu'il a tenus (dans un navigateur sans `WeakRef`, il l'est, comme avant). Une limite : en production, l'objet redonné sans prop ne fait pas voir une écriture faite par un nom local dans un de ses sous-objets (`m = $d.meta`, puis `m.n = 2`) ; écrivez-la par la variable (`$d.meta.n = 2`).

Un objet **poussé** dans une liste d'état s'y retrouve aussi, qu'on le tienne tel qu'on l'a créé ou par l'élément relu dans la liste : après `b = { id: 2 } ; $list.push(b)`, `$list.indexOf(b)`, `$list.lastIndexOf(b)` et `$list.includes(b)` le trouvent, et `$list.splice($list.indexOf(b), 1)` retire bien `b`. `find`, `findIndex`, `findLast` et `findLastIndex` appellent leur prédicat **une fois par élément**, avec l'élément tel que la liste le rend (comme `filter` ou `map`) : `$items.find((x) -> x != $sel)` rend bien un autre élément que `$sel`. Comparé à l'objet tenu brut, ce prédicat ne le trouve pas : `$list.findIndex((x) -> x === b)` rend `-1` — cherchez-le par `$list.indexOf(b)`, par une donnée (`(x) -> x.id == b.id`) ou par l'élément relu (`(x) -> x === $list[1]`). Une affectation (`$list = $list.filter(…)`, `$list = [...$list, x]`) range toujours la donnée elle-même, jamais l'enveloppe réactive de ses éléments, dans une copie faite à chaque affectation quand la liste donnée en contient : la liste que vous avez passée n'est jamais modifiée (`favs` garde ses éléments après `$favs = favs`), une liste gelée donne une copie gelée, et deux variables qui reçoivent la même liste contenant des éléments enveloppés reçoivent chacune leur copie (`l = $items.filter(…) ; $a = l ; $b = l` : `$a.push(x)` ne change pas `$b`). Même règle pour une liste rangée dans un `µ.state` ou un `µStore`.

Un **objet** affecté, lui, est rangé tel quel : jamais copié ni parcouru. Deux variables d'un composant qui le reçoivent désignent la même donnée, un objet qui se désigne lui-même (`o.self = o`) se désigne toujours, un objet gelé reste gelé, ses accesseurs (`get total()`) restent des accesseurs, jamais lus à l'affectation, et une donnée neuve ou profonde (réponse JSON, liste chaînée) n'est pas parcourue — d'une liste affectée, seul le premier niveau est lu, pour y trouver des enveloppes. Entre deux composants, le partage ne prévient pas : une écriture faite par l'un change la donnée de l'autre sans le redessiner — donnez à chacun sa copie (`{...o}`), ou partagez la donnée par un magasin (`$$`, `µStore`).

> ⚠️ **Limite : une liste rangée dans un objet.** Une liste rangée DANS un objet garde les enveloppes reçues — cherchez par une donnée (`(x) -> x.id == …`) ou par l'élément relu dans la liste. Après `$o = {list: $items.filter(…)}` (ou `{list: [...$items]}`, `{a: {b: [$items[2]]}}`), `$o.list.indexOf($items[0])` rend `-1` et `includes` faux, même avec l'élément relu (`$o.list.indexOf($o.list[0])`) : écrivez `$o.list.findIndex((x) -> x.id == id)` ou `$o.list.findIndex((x) -> x == $o.list[1])`. Même chose pour une liste poussée telle quelle dans une liste (`$groupes.push(l)`) ou posée dans une `Map` (`$carte.set(k, l)`). Une liste affectée à sa propre variable (`$liste = $items.filter(…)`) n'a pas cette limite. Un objet gelé se lit tel quel (voir plus bas), sa liste aussi : sa recherche est celle de JavaScript, elle retrouve l'élément relu dans la liste d'origine (`$items[0]`), pas l'objet tenu brut.

Un objet rangé dans une `Map` ou un `Set` d'état — variable de composant, `µ.state` ou `µStore` — reste réactif par toutes les voies de lecture : `get`, `forEach`, `values()`, `entries()`, `for…of` — le modifier pendant une itération redessine le composant. La clé objet d'une `Map` sort enveloppée de même, par toutes ces voies (`keys()`, le deuxième paramètre de `forEach`, `[...$m]`, `Array.from` compris) : la modifier (`for k of $m.keys()`, puis `k.nom = 'z'`) redessine le composant. `get`, `has`, `set` et `delete` la retrouvent sous toutes ses formes, brute ou enveloppée, d'ici ou d'ailleurs, et `set` ou `add` d'une clé que la collection ne tient pas encore range la forme brute : une seule entrée par objet, `size` juste. Une `Map` ou un `Set` rangé dans l'état (`$m = new Map([[$rows[0], 1]])`, `$o = {m: …}`, `st.m = …` dans `µ.state` ou `µ.Store`, `$$m = …`, la prop d'un enfant) reste la même collection, jamais copiée ni parcourue à l'affectation : les variables, les composants, les magasins et les bibliothèques qui la tiennent voient les mêmes écritures, et elle garde ses champs et son gel. Quand elle tient un objet sous une enveloppe (`new Map($m)`, `new Map([[$rows[0], 1]])` faits dans un composant, la `Map` qu'un enfant reçoit de son parent), l'objet brut ou une autre enveloppe y retrouvent son entrée : au premier objet qu'il n'y trouve sous aucune de ses deux formes, MJS fait un index de la collection, en un seul parcours. Cet index suit les écritures de MJS : `delete` en retire l'entrée, `clear` l'oublie en entier, et il ne garde en mémoire aucun objet que la collection ne tient plus, même retiré hors de MJS. Une entrée rangée sous son enveloppe par du code hors de MJS, sur la collection gardée sans `$`, s'y retrouve ainsi après `µrefresh($m)`, la règle de tout changement fait hors de MJS. Une clé sortie est l'enveloppe : `[...$m.keys()][0] === $cle` est vrai quand `$cle` tient le même objet, faux contre l'objet brut gardé hors de l'état, qui retrouve pourtant l'entrée par `get`, `has` ou `delete`. Une clé rangée sous l'enveloppe d'un autre composant, de `µ.state` ou de `µ.Store` en sort telle quelle : une écriture faite par cette autre famille ne redessine pas ce qui lit la clé par la collection, valeur dérivée comprise — écrivez `µrefresh($m)` après elle, ou partagez la donnée par un magasin (`$$`). Une collection qui tient le même objet sous ses deux formes (faite hors de MJS) garde deux entrées : `get`, `set`, `add` et `delete` par l'enveloppe prennent la sienne, un parcours rend l'objet deux fois, et le développement vous en avertit. Un élément de `Set` obtenu par une itération se retrouve par `has` et se retire par `delete` ; `add` d'un objet que le `Set` tient déjà, brut ou sous son enveloppe, n'ajoute rien. Une `WeakMap` ou un `WeakSet` de l'état — variable de composant, `µ.state` ou `µStore` — a son enveloppe, comme une `Map` ou un `Set` : `get`, `has`, `set`, `delete` et `add` y retrouvent l'objet par son enveloppe comme brut (`$vus.set($rows[0], 1)` range l'objet brut, `$vus.get($rows[0])` l'y retrouve), et ce que `get` rend est enveloppé : le modifier redessine le composant. Une clé qu'elle tient sous son enveloppe ne s'y retrouve que par cette enveloppe : MJS ne la parcourt pas. Une méthode native appelée sur l'enveloppe lève une `TypeError` (`WeakMap.prototype.get.call($vus, k)`, ce que font certaines bibliothèques) : donnez-leur `µraw($vus)`, qui rend la vraie collection sans la marquer — `$vus` garde son enveloppe, et ses écritures redessinent —, ou la collection gardée sans `$`. Rangée dans une autre variable `$`, la collection rendue reprend une enveloppe (`$b = µraw($vus)`). `µraw` de la collection rendue la rend telle quelle, sans la marquer : `µraw(µraw($vus))` laisse à `$vus` son enveloppe. Après `µraw($vus)`, `µraw` de cette même collection ne la marque donc plus : rangée dans une autre variable `$`, elle y reprend une enveloppe — donnez `µraw($b)` aux méthodes natives. Avec `"proxy": false`, la variable d'un composant tient déjà la vraie collection : donnez `$vus` tel quel — `µraw($vus)` la marquerait, et ses écritures ne redessineraient plus. Une écriture que la bibliothèque y fait passe hors de MJS : écrivez `µrefresh($vus)` juste après.

Ce suivi des clés objets et l'enveloppe des `WeakMap` et des `WeakSet` n'entrent dans le cœur que si le code du projet nomme une de ces collections — `Map`, `Set`, `WeakMap` ou `WeakSet` pour le suivi des clés, `WeakMap` ou `WeakSet` pour leur enveloppe —, dans un composant, un module ou un fichier `.js` importé, hors des chaînes et des commentaires. Une appli qui n'en nomme aucune ne porte pas ce suivi, en développement comme en production. Si une collection lui arrive quand même (une bibliothèque chargée à part, par une balise `<script>`, la lui donne), rien ne lève : une `Map` ou un `Set` garde son enveloppe et ses écritures redessinent, mais la clé objet d'une `Map` sort brute et `get` ne retrouve une entrée que sous la forme où elle a été rangée ; aucune collection n'y est suivie en entier — une valeur à l'horloge qui la lit est refaite après toute écriture profonde du composant, et une valeur précise qui lit une `Map` y passe à l'horloge ; une `WeakMap` ou un `WeakSet` reste sans enveloppe dans un composant (`$vus.get($rows[0])` cherche l'enveloppe de la ligne, et ne trouve pas l'entrée rangée sous l'objet brut), et `µraw` marque ce qu'il reçoit ; dans `µ.state` ou un `µStore`, ils ont leur enveloppe, sans le suivi des clés. Le développement vous en avertit, une fois par page — sauf avec `"runtime": "core"` ou une liste `runtime` sans module optionnel, dont le cœur part sans les avertissements du développement, et sauf pour une `WeakMap` ou un `WeakSet` qui n'arrive que dans `µ.state` ou un `µStore` d'un projet qui nomme `Map` ou `Set` sans nommer `WeakMap` ni `WeakSet`. Pour le suivi complet, écrivez `"collections": true` dans `mjs.config.json` ([32 · CLI et configuration](32-cli-et-configuration.md)) : la part est ajoutée au cœur, et le repérage des autres modules reste le même. Avec une liste `runtime` déjà écrite, ajouter `"collections"` à cette liste revient au même ; sans clé `runtime`, n'en écrivez pas une pour cela : une liste remplace le repérage des modules optionnels, et `"runtime": ["collections"]` écrit seul les retirerait sans un mot.

> ⚠️ **Une clé venue de données dans une écriture profonde.** Une écriture profonde de l'état (`$o[a][b] = v`, `delete $o[a][b]`, `$o[a].push(x)`, sur un chemin de toute longueur) refuse une clé qui vaut `'__proto__'`, `'constructor'` ou `'prototype'`, à n'importe quel rang du chemin : rien n'est écrit, et la console nomme le segment refusé (« chemin d'état refusé (segment « __proto__ ») — mutation ignorée. »). Avec `section` venue de l'adresse de la page et valant `'__proto__'`, `$reglages[section][nom] = v` ne touche donc pas le modèle commun de tous les objets de la page (`Object.prototype`). Une clé convertie en texte compte comme ce texte (`['__proto__']`, un objet dont `toString` rend ce nom) : elle est convertie une seule fois, puis comparée et écrite telle quelle. Un indice (`$l[0]`) ou un symbole ne sont jamais refusés.
>
> Un chemin de l'état écrit dans le code (`$loc.p.x = v`, `$loc.p.push(x)`, `delete $loc.p.x`) passe le même refus quand l'objet qu'il atteint y a été rangé par une lecture (`$loc.p = $$o[k]`, `$racine = $$o[k]`) : là, `'__proto__'` mène au prototype et `'constructor'` à la fonction `Object` du navigateur. L'écriture n'écrit alors jamais dans un prototype ni dans une fonction du navigateur (`Object`, `Array`, `Map`…, reconnue à son code natif), n'y appelle aucune méthode, n'y supprime rien ; rien n'est écrit. Pour un prototype, la console nomme le segment qui y mène (le même message) ; pour une fonction du navigateur, elle explique le piège : avec `cle` venue de l'adresse de la page et valant `'constructor'`, `$serie = $$series[cle]` puis `$serie.values = [1]`, qui remplacerait `Object.values` pour toute la page, affiche « $serie.values : $serie contient la fonction Object du navigateur, sans doute amenée par une clé venue de l'extérieur (adresse, formulaire, données reçues) ; rien n'est écrit. Vérifiez cette clé. »
>
> Une fonction de votre appli rangée dans l'état reçoit ces écritures, comme un objet : avec `$format = (n) -> n.toFixed(2)`, `$format.appels = 0`, `+= 1`, `++`, `||=` (en CoffeeScript `or=`, `?=`, `and=`) et `delete $format.appels` écrivent dans la fonction, et ce qui lit `$format.appels` suit — le gabarit (`{$format.appels}`), une valeur dérivée, un reffet —, avec ou sans le réglage `"proxy": false`. Toute fonction écrite par votre appli ou par une bibliothèque en est : flèche, `function`, classe, `async`, génératrice, fonction liée (`f.bind(…)`). Rangée dans un objet de l'état (`$outil = { format: (n) -> n.toFixed(2) }`), elle se lit par l'enveloppe comme un objet : un champ s'y lit et s'y écrit par le chemin comme par toute variable qui la garde — `f := $outil.format`, puis `f.appels = 10`, écrit dans la fonction, `{$outil.format.appels}` montre 10 et `$outil.format.appels += 1` repart de là ; `delete` et `Object.defineProperty` aussi. Appelée seule ou passée en rappel (`g := $outil.double`, puis `g()` ; `liste.map($outil.double)`), son `this` reste l'objet de l'état, et `this.n += 1` y redessine ; `$outil.format === $outil.format`, et `typeof`, `name`, `length`, `call`, `apply`, `bind`, `new`, `instanceof` sont ceux de la fonction. Son prototype (`$outil.format.__proto__`, `Object.getPrototypeOf($outil.format)`) est la fonction elle-même : une clé `__proto__` venue de l'extérieur n'atteint pas `Function.prototype`. Une classe qui en hérite (`class Caniche extends $outil.Chien`) garde le sens de JavaScript : `Caniche.compte = 0` s'écrit sur `Caniche`, pas sur `Chien`. Remplacée par le chemin (`$outil.format = g`), la fonction relue est la nouvelle. Avec le réglage `"proxy": false`, la construction signale `f.appels = 10` à sa ligne, comme l'écriture par une variable qui garde un objet de l'état : écrivez `µrefresh($outil)` juste après. Une fonction du navigateur rangée dans un objet de l'état ou d'un `µ.Store` (`$outil.f = $$series[cle]`, `$outil.charge = fetch`, `$outil.tranche = [].slice`) se lit par une copie, la même à chaque lecture, qui s'appelle comme en JavaScript : appelée seule (`t := $outil.charge`, puis `t(url)`), elle ne reçoit aucun `this` ; par `call`, `apply` ou `bind`, celui que vous donnez (`$outil.tranche.call(liste, 1)`) ; comme méthode de l'objet, l'objet ; une fonction propre à la fenêtre (`fetch`, `requestAnimationFrame`) appelée comme méthode de l'objet qui la range (`$outil.charge(url)`) reçoit le `this` d'un appel seul, et marche, là où JavaScript lève « Illegal invocation » ; tout autre `this` donné par `call`, `apply` ou `bind` lui est passé tel quel. `new`, `instanceof`, `name` et `length` sont ceux de l'originale. Avec le réglage `"proxy": false`, et dans un `$$magasin` ou un `µ.state`, la fonction rangée est l'originale : `$outil.charge(url)` lève, comme `o.charge(url)` en JavaScript, parce que `fetch` refuse tout autre `this` que la fenêtre ; rangez une flèche (`$outil.charge = (url) -> fetch(url)`), ou écrivez `t := $outil.charge` puis `t(url)`. La copie n'est pas l'originale (`$outil.f === Object` est faux) : `$outil.f.prototype` vaut `undefined`, une classe n'en hérite pas (`class extends $outil.f` lève), et ce qu'on écrit par une variable qui la garde reste dans cette copie, sans atteindre l'originale. `String($outil.charge)` montre le code de MJS, pas `[native code]`. La copie est la même dans toute la page, pour chaque fonction du navigateur : une propriété posée dessus se voit dans tout autre objet de l'état qui range cette fonction. Rangée dans une `Map`, un `Set` ou un objet gelé de l'état, elle se lit aussi telle quelle, comme en JavaScript. Lue dans un champ d'une fonction rangée dans l'état, en revanche, une fonction ou un objet du navigateur (`Object`, `Promise`, `Array`, `Math`, une méthode comme `Object.keys`) est l'original, pas une copie — à toute profondeur, prototype compris (`$format.k`, `$outil.format.k`, `$outil.format.g.h` ; `$outil.Pt.prototype.__proto__` est `Object.prototype`) : `n := $outil.format.k`, puis `n.x = 1`, `Object.assign(n, …)`, `Object.defineProperty(n, …)` ou `Reflect.set(n, …)`, l'écrit pour toute la page ; l'écriture par le chemin (`$outil.format.k.x = 1`) n'écrit rien. Rangez à sa place une fonction de votre appli qui l'appelle (`$format.cles = (o) -> Object.keys(o)`) : c'est elle qui reçoit l'écriture, `Object.keys` reste intact ; et comparez à la liste des clés permises toute clé venue de l'extérieur avant de lire un champ par elle (`$outil.format[cle]` : `constructor` y rend la fonction `Function` du navigateur). Une clé venue de l'extérieur peut aussi mener à une classe de votre appli : `constructor` d'une instance (`$serie = $$fiches.chien[cle]`) range la classe `Chien`, qui reçoit l'écriture (`$serie.values = [1]` écrit `Chien.values`) ; vérifiez la clé.
>
> Les écritures qui passent par l'état enveloppé suivent la même règle quand cet objet est un prototype : une forme qui lit avant d'écrire (`$loc.p.x += 1`, `++`, `||=`, `&&=`, `??=`, et en CoffeeScript `?=`, `or=`, `and=`), une variable qui le garde (`t := $loc.p`, puis `t.x = v` ou `delete t.x`), `Object.assign($loc.p, …)`, la rune `µproxy $loc.p`. Rien n'y est écrit, défini ni supprimé, sans erreur, et la console affiche le même message ; seul `Object.defineProperty` lève sa `TypeError`, comme pour un de ces trois noms.
>
> Un prototype qui porte une étiquette, rangé de même dans l'état (`$racine = $$o.m[k]`, `k` valant `'__proto__'` : `Map.prototype`, ou `Set.prototype`), sort enveloppé comme `Object.prototype` : son identité change, et une méthode lue par l'enveloppe s'applique à l'enveloppe, pas au prototype (`$racine.isPrototypeOf(new Map())` rend `false`, `$racine.valueOf()` rend l'enveloppe) ; rien ne s'y écrit par l'état — les mêmes formes, le même message. L'enveloppe d'un prototype ne le laisse ni geler, ni sceller, ni fermer aux ajouts : `Object.freeze`, `Object.seal` et `Object.preventExtensions` lèvent leur `TypeError`, `Reflect.preventExtensions` rend `false`, et la console affiche le même message ; `Object.setPrototypeOf` est refusé comme pour tout objet de l'état (« état : changement de prototype refusé »).
>
> Un `µ.state` et un `µStore` (`store.data`) maniés en JavaScript refusent comme l'état d'un composant : un prototype qui y est rangé (`Array.prototype`, `Object.prototype`, `Map.prototype`, le prototype d'une classe, lu avec une clé venue de données) ne reçoit rien par eux — ni écriture, ni suppression, ni définition, ni méthode qui modifie une liste (`push`, `splice`, `sort`…), ni fermeture aux ajouts, ni changement de prototype, pas même par une fonction du navigateur appelée avec lui pour `this` (`[].push.call(etat.x, 7)`). La console affiche le même message ; `Object.defineProperty`, `Object.freeze` et `Object.setPrototypeOf` lèvent leur `TypeError`. Avec ou sans le réglage `"proxy": false` : leurs enveloppes restent des Proxy. Un objet ordinaire et une vraie liste qui y sont rangés reçoivent toutes leurs écritures.
>
> Restent hors de portée, et suivent JavaScript : une fonction du moteur rangée à la racine de l'état (`$racine = $$o['constructor']`, la fonction `Object`) reçoit les écritures qui passent par l'état enveloppé (une variable qui la garde, `Object.assign($racine, …)`, `Object.freeze($racine)`) ; le `prototype` d'une telle fonction (`$racine.prototype`) ; le prototype d'une valeur simple (`String.prototype`, `Number.prototype`, `Boolean.prototype`, `Symbol.prototype`, `BigInt.prototype`), rangé tel quel pour que ses lectures marchent (`String($racine)`, `{$racine}` dans la vue) ; `Function.prototype` rangé à la racine (une fonction de l'état reste brute) ; le prototype d'un élément de la page (`HTMLDivElement.prototype`) ; le prototype que rend `Object.getPrototypeOf($o)` sur l'état ; une valeur du magasin passée à une fonction (`Object.assign($$o.constructor, …)`) ; ce qu'on atteint depuis une fonction de votre appli (`$cb.constructor`) ; une méthode du navigateur lue par une clé venue de données (`$o[a][b][c][d] = v`, avec `a` valant `'toString'` ou `'push'`, puis `'__proto__'`) : c'est une fonction du navigateur, et son `__proto__` mène hors du mur, jusqu'à `Object.prototype`. Là, l'écriture va où JavaScript l'envoie : vérifiez la clé venue de données avant de lire l'objet (cf. ci-dessous).
>
> Ces trois noms sont refusés aussi au premier niveau de l'état (`$[clé] = v`, un attribut de balise, un objet étalé `{...$data}`), et en écriture à travers un objet de l'état qui a échappé au suivi statique (passé à une fonction). `Object.defineProperty($, nom, …)` sous l'un d'eux pose une propriété propre de l'état, comme sur un objet ordinaire : aucun prototype n'est touché, aucune variable n'est prévenue. En LECTURE à travers l'état (`$o[k]` lu dans une expression, ou par une fonction qui a reçu l'objet), ils rendent `undefined` sauf si l'état porte VRAIMENT une donnée sous ce nom (propriété propre) — jamais le prototype hérité du realm : une forme que le compilateur laisse passer par l'état enveloppé — qui lit avant d'écrire (`$o[a][b] += v`, `||=`, `++`, et en CoffeeScript `?=`, `or=`), ou dont une clé est faite d'une expression (`$o[req.a][b] = v`) — lit alors `undefined` et lève une `TypeError`, sans rien écrire non plus, et sans message ; un de ces noms en dernière clé (`$o.a[k] += v`) n'écrit rien, sans erreur ni message. Hors de l'état — les objets de vos bibliothèques, les vôtres hors de `$` et `$$` —, une clé venue de données reste à vérifier avant d'écrire : liste de clés permises, `Object.hasOwn`, ou une `Map` ([14 · Stores](14-stores.md), « Sécurité » ; [18 · Pièges](18-pieges.md), § 18).

Une clé **calculée** est acceptée aussi bien en profondeur (`$obj[cle] = v`, `cle` une variable) qu'au premier niveau de l'état (`$[cle] = v`) — les deux écritures, les formes composées (`+=`…), `++`/`--` et `delete` compris.

> ⚠️ **La seule vraie exception : `µraw`.** Une donnée explicitement marquée `µraw(...)` ([État brut](11-etat-brut.md)) n'est **volontairement** suivie par aucun mécanisme (ni compile-time, ni Proxy) : muter son intérieur ne re-rend rien, il faut **réaffecter** une nouvelle référence. C'est un choix de perf pour les données remplacées en bloc — un `$` ordinaire n'a jamais besoin de ce contournement.
>
> Une fenêtre d'une autre origine (celle d'une `<iframe>` d'un autre site, ou rendue par `window.open`) ne se range pas dans une variable `$`, même marquée `µraw` : le navigateur refuse qu'on y lise autre chose que quelques propriétés, et l'affectation lève une `SecurityError`. Gardez-la dans une variable ordinaire.
>
> Une instance à champs privés (`#n`) rangée dans l'état ne s'appelle pas à travers son enveloppe : `$c = new Compteur()` puis `$c.inc()` lève `TypeError`, de même `$o.c.inc()` quand un objet de l'état la tient — un champ privé ne se lit pas à travers un Proxy ; ses accesseurs, eux, se lisent (`$c.n`). Rangez-la marquée `µraw` (`$c = µraw(new Compteur())`) ou gardez-la dans une variable ordinaire : ses méthodes s'appellent, et `µrefresh($c)` redessine après elles. Avec `"proxy": false`, elle se range telle quelle.
>
> Dans un `µ.state`, une fonction du navigateur rangée garde le comportement de JavaScript : appelée comme méthode (`µ.state.planifier(f)` avec `planifier = queueMicrotask`), elle lève `TypeError: Illegal invocation`. Rangez une flèche (`planifier = (f) -> queueMicrotask(f)`). L'état d'un composant et un `µStore`, eux, l'appellent comme méthode sans erreur.
>
> Les méthodes statiques d'une classe du navigateur rangée dans l'état ne se lisent pas à travers elle : avec `$o.D = Date`, `$o.D.now` ne rend rien. Appelez `Date.now()` directement.

> ⚠️ **Un objet gelé (`Object.freeze`) se lit tel quel.** JavaScript exige qu'une propriété figée — propre, ni modifiable ni configurable, comme toutes celles d'un objet gelé — rende sa propre valeur à une lecture par un Proxy : MJS la rend donc brute, sans Proxy, dans l'état d'un composant comme dans un `µ.state` ou un `µStore`. L'objet s'affiche normalement (champs, `{for}`, méthodes), qu'il soit gelé avant d'entrer dans l'état ou après. Y écrire lève l'erreur du navigateur (`TypeError: Cannot assign to read only property…`), comme sans MJS. Un sous-objet **non gelé** atteint à travers lui redessine quand le script du composant l'écrit en clair (`$rows[0].info.v = 5`), mais pas quand une fonction le reçoit et le modifie (`bump($rows[0].info)`, ou `bump(row.info)` dans un gabarit) : remplacez alors l'objet gelé, ou réaffectez la liste. Même règle pour une propriété figée d'un objet scellé (`Object.seal`) ou fermé aux ajouts (`Object.preventExtensions`) ; ses autres propriétés restent suivies comme celles d'un autre objet. **Limite :** la propriété figée d'un objet resté ouvert aux ajouts — celle que pose `Object.defineProperty(o, k, {value: …})` (ni modifiable ni configurable par défaut), `Object.create(null, {k: {value: …}})` ou une classe qui définit ainsi un champ — fait lever sa lecture quand elle tient un objet ou une fonction (`'get' on proxy: property … is a read-only and non-configurable data property…`) : gelez l'objet (`Object.freeze`) ou fermez-le aux ajouts (`Object.preventExtensions`), ou définissez la propriété avec `writable: true` ou `configurable: true`.

> 🔗 Voir aussi : [Pièges & bonnes pratiques](18-pieges.md) → *réactivité statique* (un `$` lu dans une méthode appelée par un binding n'est pas tracké — mettre le `$` en clair dans le binding).

### Ce qui est redessiné — le champ écrit, seulement

Une écriture compilée du champ d'un objet de l'état (`$o.f7 = v`, `$o.f7 += 1`, `delete $o.f7`) ou du champ d'un élément de liste (`$data[i].label = v`) ne rejoue que les liaisons du gabarit qui lisent ce champ, quand toutes celles qui lisent la variable lisent des champs nommés (`{$o.f7}`, `{row.label}` dans `{for row in $data}`) :

- **un objet** : les textes et attributs qui lisent `$o.f7`, tout de suite, ou une fois chacun à la sortie d'une boucle qui écrit l'état ; ceux des autres champs ne repassent pas ;
- **une liste** : la seule ligne qui montre l'élément écrit, et dans cette ligne les seules liaisons qui lisent le champ, à la microtâche, l'heure à laquelle la liste aurait repassé ; plusieurs écritures d'une même ligne dans le même tour la rappellent une fois.

Les valeurs dérivées et les reffets voient la variable changer comme pour toute écriture. Tout le reste prévient la variable entière, comme une écriture ordinaire : l'élément remplacé ou retiré (`$data[i] = x`, `$data.splice(…)`), une écriture plus profonde (`$o.a.b = v`, `$data[i].tags.push(x)`), le champ de la clé `by`, un objet tenu aussi par une autre variable ou deux fois dans la liste, une liste qui n'est pas affichée (bloc fermé), une variable liée à un parent (`=!{}`) ou inspectée (`µinspect`), une écriture faite par l'enveloppe d'un alias que la compilation ne suit pas, un composant qui a un miroir (`µclone el, mirror: true`), un objet à accesseurs (instance d'une classe, `get total()`, `set x(v)` : un champ peut en lire ou en écrire un autre). La variable entière est aussi prévenue quand un lecteur du gabarit lit plus que des champs nommés : l'élément entier (`JSON.stringify(row)`, `row[k]`, `row?.x`), ce qui est sous le champ d'une ligne (`row.parent.label`), une fonction du script, l'horloge ou le hasard (`Date.now()`, `new Date()`, `Math.random()`), une prop de composant enfant, une liste lue hors de son `{for}` (`{$data.length}`), une valeur dérivée ou un reffet qui lit la variable, une valeur dérivée à l'horloge dans le composant, ou une passe de structure qui lit une fonction ou une variable du script (`{for r in premiers()}`, `{if voir()}`), qu'elle relit à chacun de ses tours. Une liaison qui lit sous un champ de l'objet (`{$o.user.nom}`, `{$o.prix.toFixed(2)}`) repasse à l'écriture de chacun de ses champs : l'objet atteint peut être l'objet lui-même (`$o.self = $o`). L'écran est le même dans tous les cas, seul le travail change : mettre à jour une ligne sur dix d'une liste de 1 000 rappelle 100 lignes et 100 liaisons, au lieu de repasser 1 000 lignes et 3 000 liaisons.

### Une liste propre — les lignes qui gardent leur objet ne sont pas relues

Une liste `{for row in $data}` dont la variable a sa table (un champ d'un élément écrit par un chemin compilé, comme `$data[i].label = v`, et des lignes qui ne lisent que des champs nommés de leur élément) reste **propre** tant que tout changement du contenu de ses lignes passe par MJS : écrit champ par champ, il est déjà à l'écran. Un changement de structure — `$data[i] = x`, `$data.splice(…)`, `$data.push(…)`, `sort`, `reverse` — ne relit alors que les lignes qui changent d'objet, ou d'index quand la ligne le lit : échanger deux lignes de 1 000, en retirer une ou en ajouter 1 000 ne relit aucune ligne gardée. Toute autre écriture de la variable salit la liste, et sa passe suivante relit toutes ses lignes : écriture entière (`$data = …`), écriture par une fonction qui reçoit la liste, `µrefresh($data)`, objet à accesseurs ou instance de classe, objet tenu aussi par une autre variable, composant qui a un miroir. Une ligne qui lit autre chose que son élément et son index (une variable, un appel, un bloc, un composant) est relue à chaque passe ; une liste `µraw` garde sa règle ; une variable sans table (aucun champ d'élément écrit par un chemin compilé) relit toutes ses lignes à chaque passe.

**Un objet de la liste changé hors de MJS demande `µrefresh($data)`.** Cela vaut aussi pour une liste écrite à côté d'une liste dans une ligne (un `{for}` imbriqué ailleurs dans le composant). Dans cette scène, `@changer` modifie un objet que le script garde dans une variable ordinaire : MJS n'en voit rien.

```html
<script>
  tenu = null
  $data = [{ id: 1, label: 'a' }, { id: 2, label: 'b' }]
  @renommer = -> $data[0].label += '!'
  @ajouter = ->
    tenu = { id: 7, label: 'h' }
    $data.push(tenu)
  @changer = -> tenu.label = 'h2'
  @echanger = ->
    t = $data[0]
    $data[0] = $data[1]
    $data[1] = t
</script>
<ul>{for row in $data by id}<li>{row.label}</li>{end}</ul>
```

- `@ajouter`, `@changer`, puis `@echanger` : la ligne de clé 7 montre toujours `h`. La liste est propre, sa ligne garde son objet : elle n'est pas relue.
- `@changer = -> tenu.label = 'h2'; µrefresh($data)` : la liste est salie, sa passe relit toutes ses lignes, `h2` paraît tout de suite.
- `@renommer` passe par MJS : sa ligne est mise à jour champ par champ, la liste reste propre.
- Un objet de la liste écrit par MJS ailleurs — par un magasin (`$$items[3].label = v`, quand `$data = $$items`), par un autre composant qui tient le même tableau, par un enfant à qui l'objet est passé, ou, avec `"proxy": false`, par une autre variable du composant (`$sel = $data[3]`, puis `$sel.label = v`) — paraît à la passe suivante : après une telle écriture, la liste relit toutes ses lignes une fois.

En développement, la passe d'une liste propre compare quand même les lignes qu'elle saute à ce qu'elles montrent, sans toucher à l'écran, et dit le premier écart, une fois par liste et par composant : « [ModularJS] <@liste> : la ligne de clé 7 de $data a changé sans passer par MJS : écrivez µrefresh($data) après ce changement. » (pour une liste sans `by` : « la ligne $data[2] »). La construction de production n'emporte ni la comparaison ni le message. Voir [41 · µrefresh](41-refresh.md).

## Environnement réactif — `µonline` / `µvisible` / `µready`

Trois booléens réactifs, lisibles partout sans import, reflètent l'état de l'environnement client : `µonline` (le navigateur a du réseau), `µvisible` (l'onglet est au premier plan), `µready` (le document a fini de charger). Lecture seule côté dev — seul le runtime les écrit.

```html
{if not µonline}
  <p class="banniere-offline">Connexion perdue — les changements seront synchronisés au retour du réseau.</p>
{end}
```

> 🔗 Côté serveur, la rune correspondante est **`µserver`** (vrai pendant un rendu SSR) — voir [SSR](19-ssr.md).

---

📚 **Apprendre en pratiquant** : ce chapitre correspond au **Tuto interactif n°2 (Réactivité)** — état, état profond, valeurs dérivées, inspection, reffets, module partagé.
