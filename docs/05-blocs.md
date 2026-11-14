# 5 · Blocs logiques

> 📚 Tuto interactif correspondant : **Chapitre 4 — Blocs logiques**. Les encarts 🎓 *Pour débutants* dépliables donnent l'explication pas-à-pas ; le corps de la page reste la référence dense.

Le template MJS ne contient pas de JavaScript de contrôle de flux : on décrit le rendu avec des **blocs** entre accolades. Cinq familles : `{if}` (conditionnel), `{for}` (liste), `{await}` (promesse), `{key}` (re-montage forcé), `{const}` (constante locale). Les quatre premiers se ferment par `{end}` — il n'y a pas de balise de fermeture nommée comme `{/if}` (écrite quand même, `{/if}`, `{/for}` ou `{/each}` est refusée à la construction par un message qui la cite, avec sa ligne, et donne `{end}` à la place) ; `{const}` ne s'ouvre pas de bloc, c'est une simple déclaration en ligne (voir plus bas).

## Conditionnel — `{if}` / `{elsif}` / `{else}`

```html
<script>
  $count = 0
  increment = -> $count += 1
</script>
<button @click={increment}>Clicked {$count}</button>

{if $count > 10}
  <p>{$count} is greater than 10</p>
{elsif $count < 5}
  <p>{$count} is less than 5</p>
{else}
  <p>{$count} is between 5 and 10</p>
{end}
```

Le mot-clé « sinon si » est **`{elsif}`** (un seul mot, comme en Ruby) — **pas** `{else if}`. `{else}` et chaque `{elsif}` sont facultatifs ; seul `{end}` est obligatoire. La condition est une expression Civet quelconque ; tout `$` qu'elle lit devient une dépendance, et la bonne branche est ré-affichée à chaque changement.

> ⚠️ N'utilisez pas `{else if}` (deux mots) ni `{elif}` : le seul mot-clé reconnu est `{elsif}`. Oublier le `{end}` final lève une erreur de compilation explicite (« unclosed block »).

> ⚠️ `{else}` et `{elsif}` ne suivent qu'un `{if}`, `{success}` et `{error}` qu'un `{await}`. Placés dans un `{for}`, un `{key}`, un autre bloc ou une balise, ils sont refusés à la construction, avec un message qui nomme le jeton et le bloc où il se trouve. Pour afficher un texte quand une liste est vide : `{if $liste.length}{for x in $liste}…{end}{else}<p>Rien à afficher.</p>{end}`.

<details>
<summary>🎓 <b>Pour débutants</b> — pourquoi des accolades et pas un vrai <code>if</code> JavaScript&nbsp;?</summary>

Dans beaucoup de frameworks vous écririez le `if` en JavaScript autour du HTML. En MJS, le template est compilé : MJS doit savoir *quel morceau de DOM dépend de quelle condition* pour ne mettre à jour que lui. Les blocs `{if …}…{end}` lui donnent exactement cette information. Vous décrivez « ce bloc n'apparaît que si la condition est vraie », et MJS se charge d'ajouter/retirer le DOM au bon moment, sans que vous touchiez à un seul `appendChild`.

</details>

## Listes — `{for … in …}`

```html
<script>
  colors = ['red', 'orange', 'yellow', 'green', 'blue']
  $selected = colors[0]
</script>

<div>
  {for i, color in colors}
    <button style="background: {color}" aria-current={$selected === color} @click={$selected = color}>{i + 1}</button>
  {end}
</div>
```

La forme générale est :

```
{for [index,] item in liste [by clé]}
```

- `item` est l'élément courant ; `index` (facultatif, **avant** la virgule) est sa position.
- `liste` est un tableau, un `Set` (ses éléments), une `Map` (ses paires `[clé, valeur]`, comme `for…of` ; sans `by`, chaque ligne est suivie par la clé de la `Map`) ou un objet (itéré sur `Object.values`).
- On itère avec **`in`**, jamais `of` : `{for x of arr}` lève une erreur de compilation (« utilisez « in », pas « of » »).
- L'en-tête peut tenir sur plusieurs lignes, comme la condition d'un `{if}` : `{for x in $items.filter((i) ->` puis `i.ok)}` à la ligne suivante.

> ⚠️ Muter `$liste[i].champ` re-rend le `{for}` — la mutation profonde est suivie, **d'où qu'elle vienne** : handler `@event` ou méthode ordinaire du `<script>` (voir [Réactivité](03-reactivite.md) → état profond).

> 🛑 **Dans un gestionnaire, `item` et `index` se lisent, ils ne se réaffectent pas.** Le gestionnaire en reçoit une copie : `@click={color = 'noir'}` n'écrirait que cette copie, perdue aussitôt — le build le refuse et dit quoi écrire à la place. Pour changer l'élément, écrivez dans la liste (`$liste[index] = …`) ou modifiez une de ses propriétés (`item.champ = …`). Même règle pour une liaison deux sens : `value=!{item}` est refusé, `value=!{$liste[index]}` écrit vraiment dans la liste. Et même règle pour un `{const}` et pour la valeur d'une branche `{await}` (plus bas).

> ℹ️ **Une ligne qui part ou bouge pendant un rendu.** Quand la liste est remplacée, vidée ou réordonnée pendant qu'un champ d'une ligne a le focus, le navigateur peut envoyer `blur` et `focusout` à ce champ pendant que sa ligne quitte le document (Chromium le fait, même pour une ligne déplacée qui revient aussitôt). Le gestionnaire de la ligne (`@blur={-> enregistrer(row)}`), sur une balise de la ligne ou dans un de ses blocs (`{if}`…), reçoit alors l'élément de SA ligne, jamais celui de même rang dans la nouvelle liste ; dans des boucles imbriquées, il reçoit aussi l'élément de chaque ligne qui l'entoure. Une liaison deux sens (`value=!{row.label}`) n'écoute que la saisie : la ligne qui part n'écrit dans aucun autre élément.

### Suivi keyé — `by <clé>`

```html
<script>
  $things = [
    { id: 1, name: 'apple' }
    { id: 2, name: 'banana' }
    { id: 3, name: 'carrot' }
  ]
</script>
<button @click={$things.shift()}>Remove first thing</button>

{for thing in $things by id}
  <@thing name={thing.name}>
{end}
```

`by id` indique à MJS d'**identifier** chaque ligne par cette clé (ici la propriété `id` de chaque élément). Sans `by` (et hors d'une `Map`, suivie par ses clés, cf. plus haut), le suivi dépend de l'élément :

- un **objet** est suivi par son identité : le même objet retrouve sa ligne où qu'il aille (retrait, tri, insertion), et `$things.shift()` retire bien la première ligne. Un objet *neuf*, même de contenu identique (liste rechargée du serveur, élément remplacé par une copie `{...item}`, tableau refait par un `map` qui copie ses éléments), est une autre identité : sa ligne est refaite, et ce qu'elle portait (saisie, focus, état d'un composant enfant) repart de zéro ;
- une **valeur simple** (nombre, chaîne, booléen) est suivie par sa position (par le nom de la propriété pour un objet itéré) : si vous retirez le premier élément, chaque ligne affiche la valeur suivante et c'est la dernière qui disparaît — état interne, focus, transitions et composants enfants restent sur leur ligne et se retrouvent « décalés » sur la mauvaise valeur.

Avec `by id`, MJS retrouve chaque ligne par sa clé, même quand l'objet est recréé : il retire précisément la bonne et **préserve** l'état des autres.

> ⚠️ Une liste suivie par une clé ne contient ni `undefined` ni trou (`[a, , b]`) : une telle case fait tomber le composant, qui se vide. Filtrez-la avant (`{for t in $l.filter(Boolean) by id}`).

Une ligne retirée qui joue une sortie animée (`:out`, `:transition`, ou celle d'une balise intérieure, `.global` ou sous `:childtransition`, cf. [10 · Transitions](10-transitions.md)) reste à l'écran le temps de cette sortie, et elle appartient toujours à sa clé : si l'élément revient dans la liste avant la fin de la sortie (même clé `by`, même objet sans `by`, même position pour une valeur simple), même après d'autres changements de la liste entre-temps, c'est cette ligne qui revient à sa place, avec ses nœuds, sa saisie, l'état de ses composants enfants et les lignes de son `{for}` interne. Sa sortie ne va pas à son terme : elle revient sur ses pas depuis là où elle en est, comme celles de ses balises intérieures (avec `:in` ou `:transition`, c'est l'entrée de la ligne qui repart de là) ; une sortie déjà finie (la ligne restait pour une sortie intérieure plus longue) repart de sa fin, la ligne invisible, à rebours avec `:out` seul, par son entrée jouée en entier avec `:in` ou `:transition`. Retirée de nouveau, même aussitôt, la ligne reprend sa sortie depuis là où elle en est ; une sortie déjà finie reste à sa dernière image, la ligne invisible, jusqu'à son retrait (cas par cas : [10 · Transitions](10-transitions.md), « Une balise remise pendant sa sortie »). La liste n'affiche jamais deux lignes pour une même clé. Revenu après la fin de la sortie, l'élément a une ligne neuve. Deux lignes ne reviennent pas : celle dont la racine porte, hors de toute balise, un texte ou un bloc (`{if}`, `{for}`…), qui a perdu ces nœuds-là à son retrait, et celle dont une sortie, la sienne ou celle d'une balise intérieure, se joue hors du moteur des transitions (une transition `µanim.create` à fonctions `intro` et `outro`, `*crossfade`, un effet qui se joue une fois) : rien ne la ramènerait sur ses pas. Ce qui reste d'elle part aussitôt et une ligne neuve prend sa place.

Une donnée garde ses propres nœuds : une ligne retirée d'une liste n'est jamais reprise pour une autre donnée. Une clé neuve (`by`, ou clés d'une `Map`) ou un objet neuf (sans `by`) a toujours sa ligne neuve, faite par son gabarit — au remplacement complet d'une liste, après un vidage comme après un retrait —, et ce que portait la ligne retirée (saisie, case cochée, `<details>` ouvert, état d'un composant enfant, ce qu'un script y a ajouté) part avec elle. Une donnée qui reste (même clé, ou même objet sans `by`) garde ses nœuds, déplacée ou non. Une ligne retirée n'est plus jamais affichée : n'en gardez pas de référence au-delà de sa donnée.

`by` attend le **nom** d'un champ de l'élément, sans préfixe : `by x.id` est refusé à la construction, avec la forme à écrire (`by id`).

Une clé garde son type : un nombre reste un nombre, un texte reste un texte, comme dans une `Map`. `1` et `'1'` sont donc deux clés différentes : une liste dont les identifiants arrivent tantôt en nombres, tantôt en textes (`{ id: 7 }` puis `{ id: '7' }` après un rechargement) refait ses lignes au lieu de les déplacer. En développement, une liste qui voit deux clés de types différents qui s'écrivent pareil (`7` et `'7'`, mais aussi `true` et `'true'`, `1n` et `1`), dans un même rendu ou d'un rendu au suivant, le dit une fois dans la console (« … reçoit la même clé sous deux types, 7 et '7' … ») : donnez à toutes ses clés le même type, des nombres partout ou des textes partout. La production ne fait pas ce contrôle. Une page rendue par le serveur reprend la ligne d'une clé numérique comme celle d'une clé texte : le serveur écrit la clé en texte, le navigateur la reconnaît.

La clé peut aussi être un objet : un objet ordinaire, gelé (`Object.freeze`) ou non, est reconnu par son identité (deux objets distincts donnent deux lignes, le même objet retrouve sa ligne) ; un objet qui s'écrit lui-même, comme une date ou un tableau, par ce texte (`String()`), comme une chaîne. Deux éléments de même clé sont une erreur de la liste : seul le premier est affiché (avec un avertissement), et chaque ligne affichée garde son vrai `index` dans la liste — `$liste.splice(index, 1)` retire bien l'élément de cette ligne. Une clé vide (`null` ou `undefined`) n'est pas une clé : la ligne est suivie comme sans `by` (un objet par son identité, une valeur simple par sa position), et deux lignes à clé vide ne partagent jamais rien, pas même les lignes d'un `{for}` placé dans la ligne — de même pour deux lignes d'un même objet rangé deux fois dans une liste sans `by`. Une `Map` sans `by` se suit par ses clés, comme une liste par sa clé `by` : une `Map` neuve aux mêmes clés (valeurs neuves comprises), un ordre changé, `$m.set` ou `$m.delete` gardent les lignes des clés restées, leur saisie et les lignes de leur `{for}` interne.

<details>
<summary>🎓 <b>Pour débutants</b> — quand est-ce que <code>by</code> change vraiment quelque chose&nbsp;?</summary>

Une liste d'objets que vous modifiez sur place (`push`, `splice`, `item.champ = …`) garde ses objets : chaque ligne suit le sien, même sans clé. La différence apparaît quand les objets sont **recréés** : liste rechargée du serveur, élément remplacé par une copie, tableau refait par `map` ou `filter` sur des copies. Exemple : une liste de composants avec un champ de saisie, rechargée chaque minute. Sans clé, chaque rechargement refait toutes les lignes, et le texte tapé disparaît. Avec `by id`, la ligne de même `id` est gardée, seul son contenu change, la saisie reste. Une liste de valeurs simples (nombres, chaînes) se suit, elle, par position : supprimer la première laisse le texte tapé « glisser » vers le haut. Règle simple : dès que vos éléments ont une identité stable (`id`, `uuid`…), mettez un `by`.

Écrire le champ d'un élément (`$data[i].label = v`) ne fait pas repasser la liste : seule la ligne de cet élément est rappelée, avec les seules liaisons qui lisent ce champ, à la microtâche, l'heure à laquelle la liste aurait repassé ; l'écran est le même. Le champ de la clé `by`, un élément remplacé, ajouté ou retiré, une ligne qui lit l'élément entier ou ce qui est sous un de ses champs (`row.parent.label`) font repasser la liste entière, comme toujours — détail dans [Réactivité — ce qui est redessiné](03-reactivite.md#ce-qui-est-redessiné--le-champ-écrit-seulement).

</details>

**Lignes propres.** Tant que tout changement du contenu des lignes passe par MJS (champ écrit par un chemin compilé), échanger, retirer ou ajouter des éléments ne relit que les lignes qui changent d'objet ; les autres gardent leur écran sans être relues. Un objet de la liste modifié hors de MJS (variable ordinaire, objet gardé avant son ajout) garde donc son ancienne valeur à l'écran : écrivez `µrefresh($data)` juste après ce changement — en développement, un avertissement nomme la liste et la ligne. La règle complète et ses limites : [3 · Réactivité](03-reactivite.md), « Une liste propre ».

### Longues listes — `:offscreen`

```html
<script>
  $joueurs = Array.from({ length: 10000 }, (_, n) -> ({ id: n + 1, nom: 'Joueur ' + (n + 1) }))
</script>

<div class="classement">
  {for i, joueur in $joueurs by id}
    <div class="ligne" :offscreen=48>{i + 1}. {joueur.nom}</div>
  {end}
</div>

<style>
  .ligne
    height: 48px
</style>
```

`:offscreen` se pose sur la balise qui forme la ligne. Tant que la ligne est hors de l'écran, le navigateur ne la met pas en page et ne la peint pas (`content-visibility: auto`), et le défilement dessine les autres à mesure qu'elles approchent : ce que la liste y gagne, et ce qu'une très longue liste y perd, est chiffré plus bas (« Pour quelles listes »). La ligne reste dans la page : `querySelector` la trouve, les lecteurs d'écran la lisent, la recherche de la page (Ctrl+F) la trouve, le focus et la touche Tab l'atteignent.

- **La valeur est la place réservée** à une ligne pas encore vue : un nombre de pixels (`:offscreen=48`) ou une longueur CSS fixe (`:offscreen="3rem"`), 24px sans valeur. Une fois vue, la ligne garde sa vraie taille, même revenue hors de l'écran : le navigateur la retient (`contain-intrinsic-size: auto 48px`), y compris quand la liste à clé se réordonne.
- **Des lignes de même hauteur** : fixez cette hauteur en CSS, comme ci-dessus (`height: 48px` l'emporte sur la place réservée), ou réservez-la exactement (`:offscreen=48` pour des lignes de 48px). La liste a sa vraie hauteur dès le départ : la barre de défilement ne bouge pas quand les lignes paraissent, et un saut tout en bas (touche Fin, barre tirée au bout) montre la dernière ligne.
- **Des lignes de hauteurs différentes** : la place réservée n'est qu'une estimation, réservez la hauteur moyenne d'une ligne. Chaque ligne vue prend sa vraie hauteur : la liste change de hauteur à mesure qu'elle paraît, la barre de défilement bouge, et un saut tout en bas (touche Fin, barre tirée au bout, `scrollIntoView()` sur la dernière ligne) peut s'arrêter avant la dernière ligne ; un nouveau saut s'en approche, jusqu'à l'atteindre. Une liste qui doit s'ouvrir sur sa dernière ligne, comme une conversation, demande des lignes de même hauteur.
- **Mesurer une ligne** : `getBoundingClientRect()` sur la balise d'une ligne sautée rend sa place réservée, sa vraie taille une fois vue. Mesurer une balise à l'intérieur d'une ligne sautée oblige le navigateur à mettre cette ligne en page : elle perd son gain.
- **Les effets** d'une ligne sautée réglés `on: view` attendent qu'elle soit à l'écran, comme ailleurs. Pour suspendre vous-même un travail coûteux tant que la ligne est sautée (un minuteur, un dessin), écoutez l'événement que le navigateur envoie à chaque bascule : `@contentvisibilityautostatechange={$visibles[joueur.id] = not e.skipped}`.
- **À la construction** : un attribut `mjs-offscreen` sur la balise et une règle dans le style du composant, rendus aussi par le serveur ; rien n'est ajouté à l'exécution, et un composant qui n'écrit pas `:offscreen` n'en porte rien.
- **Ce qui déborde de la balise est rogné**, même à l'écran : `content-visibility` arrête la peinture de la balise à ses bords. Un badge à cheval sur son bord, une bulle qui en sort ne se voient pas au-delà ; une balise en `position: fixed` placée dans la ligne se place par rapport à la ligne, et elle est rognée aussi. Posez ce qui doit dépasser sur une balise autour de celle qui porte `:offscreen` (`<div class="carte"><span class="badge"></span><div :offscreen=48>…</div></div>`) ; un menu ou une bulle qui doit sortir de la ligne s'ouvre dans la couche du dessus (`popover`), qui n'est pas rognée.
- **Numéros et puces : jamais sur un `<li>`** : le navigateur peint le numéro ou la puce d'un `<li>` hors de la balise, et la directive le rognerait. Elle est donc refusée sur un `<li>` à la construction, même dans une liste sans numéro ni puce (la construction ne voit pas le style de la page). Posée sur une balise à l'intérieur du `<li>`, elle le rognerait encore sous Safari, qui range le numéro dans cette balise. Faites la ligne d'une `<div>`, comme ci-dessus, et écrivez-y le numéro si la liste en montre un (`{i + 1}.`). Toute balise affichée en `display: list-item` perd de même son numéro ou sa puce.
- **Où la poser** : sur une balise affichée en bloc (`<div>`, `<article>`, un composant). Elle ne fait rien sur une balise en ligne (`<span>`, `<a>`) ni en `display: contents`. Sur une balise de tableau (`<table>`, `<thead>`, `<tbody>`, `<tfoot>`, `<tr>`, `<td>`, `<th>`, `<col>`, `<colgroup>`), elle est refusée à la construction : le navigateur ne saute jamais la mise en page d'un tableau ni de ses lignes. Faites alors la liste de `<div>` : une grille CSS (`display: grid`) en aligne les colonnes comme un tableau.
- **La valeur s'écrit telle quelle** : un calcul (`:offscreen={$h}`), zéro ou un pourcentage sont refusés à la construction.

**Pour quelles listes.** À chaque image où la liste défile, le navigateur vérifie, balise par balise, lesquelles des balises `:offscreen` approchent de l'écran. Ce travail grandit avec leur nombre, qu'elles soient à l'écran ou non, et ne dépend pas de la longueur du pas : la molette coûte autant qu'un saut. Il vient du navigateur, pas de ModularJS : `content-visibility: auto` écrit à la main coûte autant. Mesures sur des lignes de 40px dans une zone de 400px qui défile, une image par pas, constructions de production, données posées par `µraw` ; sans `:offscreen`, chaque pas tient dans une image (16,7 ms) :

| Liste | Chromium | Firefox | Safari (WebKit) |
|---|---|---|---|
| 10 000 lignes `:offscreen` : une image défilée | 21 ms | 16,7 ms | 16,1 ms |
| 100 000 lignes `:offscreen` : une image défilée | 275 à 300 ms | 65 à 77 ms | 125 à 155 ms |
| 100 000 lignes en 1 000 blocs `:offscreen` : une image défilée | 16,7 ms | 16,4 ms | 16,1 ms |
| 10 000 lignes de 13 balises : création sans, puis avec `:offscreen` | 630, puis 155 ms | 535, puis 840 à 960 ms | 960 à 1 240, puis 415 à 445 ms |
| 100 000 lignes : création en `{for}` seul, puis en blocs `:offscreen` | 960 à 1 030, puis 250 à 270 ms | 1 060 à 1 210, puis 640 à 720 ms | 1 520 à 1 960, puis 560 à 590 ms |

- **Jusqu'à quelques milliers de lignes**, `:offscreen` ne coûte rien au défilement, et la première mise en page gagne quand les lignes sont lourdes (plusieurs balises, du texte, des images), sauf sous Firefox, qui met d'abord toute la liste en page. Des lignes d'un simple texte n'y gagnent presque rien : sous Chromium et Firefox, elles se créent même plus lentement.
- **Au-delà de 10 000 lignes, posez `:offscreen` sur des blocs**, pas sur chaque ligne : sur 100 000 lignes, chaque image défilée coûte jusqu'à 300 ms dans Chromium (200 sauts : 56 s au lieu de 3,4 s), et, sous Chromium et Firefox, la création est plus lente qu'avec un `{for}` seul. Découpez la liste en tranches de 100 lignes et posez la directive sur la balise de chaque tranche, avec sa hauteur exacte (100 lignes de 48px : `:offscreen=4800`) : le navigateur ne vérifie plus que les blocs. Les lignes restent dans la page, comme ci-dessus.

```html
<script>
  $joueurs = Array.from({ length: 100000 }, (_, n) -> ({ id: n + 1, nom: 'Joueur ' + (n + 1) }))
  $blocs   = Array.from({ length: 1000 }, (_, b) -> $joueurs.slice(b * 100, b * 100 + 100))
</script>

<div class="classement">
  {for bloc in $blocs}
    <div :offscreen=4800>
      {for joueur in bloc by id}
        <div class="ligne">{joueur.id}. {joueur.nom}</div>
      {end}
    </div>
  {end}
</div>

<style>
  .ligne
    height: 48px
</style>
```

## Promesses — `{await}` / `{success}` / `{error}`

```html
<script>
  roll = ->
    new Promise (fulfil, reject)->
      µafter 500, ->
        if Math.random() < 0.5
          reject(new Error('Something went wrong'))
          return
        fulfil(Math.floor(Math.random() * 100))

  $promise = roll()
</script>

<button @click={$promise = roll()}>roll the dice</button>

{await $promise}
  <p>...rolling</p>
{success number}
  <p>you rolled a {number}!</p>
{error err}
  <p style="color: red">{err.message}</p>
{end}
```

Trois branches, dans cet ordre :

| Branche | Affichée… | Lie une variable |
|---|---|---|
| `{await $promesse}` | pendant que la promesse est en attente | — |
| `{success <nom>}` | quand elle se résout | la valeur résolue → `<nom>` |
| `{error <nom>}` | quand elle est rejetée | l'erreur → `<nom>` |

**Le nom est facultatif.** Une branche qui n'a pas de valeur à lire s'écrit `{success}` ou `{error}`, sans nom :

```html
{await $promise}
  <p>...rolling</p>
{success}
  <p>done!</p>
{error}
  <p>something went wrong</p>
{end}
```

**Quand l'expression est relue.** L'expression d'un `{await}` est lue à l'affichage du bloc, puis relue seulement quand une variable qu'elle cite change : `{await charger($id)}` rappelle `charger` quand `$id` change, et jamais à cause d'un autre rendu du composant (la résolution de la promesse comprise). Une expression qui lit un contexte (`{await charger(§§cfg.lang)}`) ou la propriété d'un état partagé (`{await partage.req}`, un `µ.state`) est relue aussi quand un contexte ou un état partagé que le composant lit change — ceux-là ne sont pas suivis clé par clé : un changement de l'un d'eux relit chacune de ces expressions du composant, une fois. Une variable lue seulement à l'intérieur d'une fonction du script ne compte pas : passez-la en argument (`charger($id)`) ; une méthode appelée avec `@` (`{await @charger()}`) compte, elle, les variables qu'elle lit. Une valeur qui n'est pas une promesse (un nombre, un objet déjà en cache) est le résultat, comme pour `await` en JavaScript : la branche `{success}` l'affiche avant que la page soit peinte, sans attente visible. Une valeur vide (`null`, `undefined`, `false`, `0`, `''`) n'affiche aucune branche. Une promesse rejetée sans branche `{error}` n'affiche rien ; en développement, une trace dans la console le signale à chaque rejet (le build de production la retire, comme les autres traces du framework) : ajoutez `{error err}` pour montrer l'erreur.

Au niveau des branches d'un `{await}`, `{success}` et `{error}` ouvrent toujours une branche (`{success }`, avec une espace avant l'accolade, aussi) — jamais la lecture d'une variable. Plus bas (dans une balise, un `{if}`, un `{for}` ou un `{key}` de la branche) comme hors de tout `{await}`, `{success}` reste l'affichage d'une variable de votre composant nommée `success`.

**Une attente à la forme du contenu.** `{await $profil *skeleton}` sans branche d'attente écrite : le build la tire de la branche `{success}` — les mêmes balises, chaque texte ou valeur remplacé par une barre qui scintille, l'image par sa boîte vide (cf. [38 · Effets](38-effets.md), famille Chargement).

**Garder le contenu pendant une relecture — `{await.keep …}`.** Sans option, chaque relecture de l'expression repasse par l'attente : la branche `{success}` est détruite, puis refaite à l'arrivée (la liste disparaît à chaque lettre tapée, un champ tapé dans la branche est perdu). Avec `.keep` écrit sur le mot du bloc (`{await.keep expr}`), la branche `{success}` affichée **reste** pendant la relecture, avec sa valeur d'avant, puis se met à jour **sur place** à l'arrivée :

```html
<script>
  $q = ''
  chercher = (q, signal) -> fetch("/api/membres?q=#{encodeURIComponent(q)}", { signal }).then((r) -> r.json())
</script>

<input aria-label="Rechercher un membre" value=!{$q}>

{await.keep chercher($q, µsignal)}
  <p>Chargement…</p>
{success membres}
  <p class="busy" hidden={not µpending}>Mise à jour…</p>
  {for m in membres by id}
    <p>{m.pseudo} <input aria-label="Note"></p>
  {end}
{error err}
  <p class="error">{err.message}</p>
{end}
```

- L'option s'écrit sur le mot du bloc, jamais dans l'expression : `{await.keep load keep}` attend `load(keep)`, comme `{await load keep}` sans l'option. Un mot écrit après l'expression en fait partie (un appel, un opérande).
- Une tête mal écrite est refusée à la construction, avec son message : un autre mot que `keep` après le point (`{await.kep …}`, `{await.KEEP …}` : le message cite le mot écrit et propose `.keep`), ou une expression qui manque (`{await}`, `{await.keep}`, `{await *skeleton}` sans l'expression devant le squelette). `*skeleton` finit la tête : pour `{await *skeleton $p}`, le message propose `{await $p *skeleton}`.
- Premier affichage : la branche d'attente, ou la silhouette `*skeleton`, comme sans `.keep` (`{await.keep $profil *skeleton}`).
- Relecture pendant que `{success}` est affichée : rien ne disparaît. À l'arrivée, `membres` prend la nouvelle valeur et tout ce qui la lit dans la branche suit — textes, attributs, props, conditions d'un `{if}` ou clé d'un `{key}`, liste `{for}` : une liste à clé (`by id`) ne bouge que les lignes changées, et un champ tapé dans la branche reste (dans la liste, celui d'une ligne gardée).
- Erreur pendant la relecture : la branche `{error}` remplace le contenu. Une relecture pendant que l'attente ou `{error}` est affichée repasse par l'attente. Une valeur vide n'affiche aucune branche, comme sans `.keep`.
- `µpending` : vrai dans le bloc tant que la lecture en cours n'est pas arrivée — dans `{success}`, pendant une relecture gardée ; toujours vrai dans la branche d'attente, toujours faux dans `{error}`. Il se lit dans les expressions des branches (textes, attributs, conditions, gestionnaires, lignes d'un `{for}`, `{const}` : `{const occupe = µpending}` suit la relecture comme lui), jusque dans l'interpolation d'une chaîne double d'un gestionnaire (`@click={journal "état #{µpending}"}`) ; seul le code compte : le mot cité dans un texte, une chaîne, un commentaire (`// …`, `/* … */`, et `# …` dans un gestionnaire) ou un attribut écrit en dur (`title="µpending"`) n'est pas une lecture et ne change rien au code construit. Hors d'un `{await}`, il ne vaut rien (`undefined`).
- `µsignal` : passé par l'expression à votre fonction, un `AbortSignal` neuf à chaque lecture, annulé quand la lecture suivante commence, quand le bloc quitte la page (un `{if}` qui se ferme) ou quand le composant la quitte. Donnez-le à `fetch` (`{ signal }`) ou à `µ.ajax` (cf. [21 · Navigation](21-navigation.md)) : la requête dépassée s'arrête au lieu d'être seulement ignorée. Le rejet d'une lecture annulée n'ouvre jamais `{error}`. Il ne se lit que dans l'expression du bloc, et sert avec ou sans `.keep`. Une fonction qui garde ses promesses en cache ne leur passe pas ce signal : la lecture suivante annulerait la promesse gardée. Un composant retiré puis remis dans la page pendant une telle lecture la refait à son retour.
- Une réponse dépassée n'écrase jamais la plus récente, avec ou sans `.keep`, avec ou sans `µsignal` : seule la dernière lecture peut encore changer l'affichage.
- Rendu serveur : le serveur rend le bloc résolu, comme sans `.keep`. À la reprise d'une page préparée en `markers`, le contenu servi reste à l'écran pendant la première lecture du navigateur, puis la branche du navigateur le remplace à son arrivée (sans `.keep`, il part aussitôt et l'attente s'affiche). Une relecture faite avant cette arrivée (une lettre tapée pendant la reprise) le retire et repasse par l'attente : seule une branche `{success}` construite par le navigateur reste pendant une relecture. En `replace`, la vue est reconstruite et l'attente s'affiche, avec ou sans `.keep` (cf. [19 · SSR](19-ssr.md)).
- Poids : en production, `.keep`, `µpending` et `µsignal` n'entrent dans le cœur de l'application que si l'un des composants de sa construction les écrit, chacun pour sa part ; une application dont aucun `{await}` ne s'en sert n'en porte pas un octet. Un cœur de développement les garde toutes : un composant compilé à part, à la volée, y trouve celles qu'il emploie. Construit pour le développement et chargé sur un cœur qui n'a pas l'une de ses options (le cœur de production d'une autre construction), un composant le dit dans la console, une fois par option (« {await.keep} est ignoré… ») : construisez-le avec la page, dans la même construction.

Les mots-clés sont bien **`success`** et **`error`** — pas `then`/`catch`. Les noms liés (`number`, `err` ci-dessus) sont libres mais ne peuvent pas être des mots réservés. Réaffecter `$promise` (ici via le bouton) relance le cycle : on repasse par la branche d'attente (sous `{await.keep …}`, la branche `{success}` reste, ci-dessus). Une promesse remplacée pendant l'attente est ignorée quand elle se résout ou échoue : seule la dernière assignée peut encore faire basculer l'affichage.

> ⚠️ La branche d'attente (`{await …}` → `{success …}`) et les noms liés sont positionnels : `{success}` vient avant `{error}`, et chacun introduit *sa* variable, visible uniquement dans sa branche — **gestionnaires et liaisons compris** : `{success fiche}<button @click={enregistrer(fiche)}>` et `<input value=!{fiche.nom}>` lisent la valeur chargée, et un `{for x in fiche.lignes}` de la branche aussi. La variable elle-même ne se réaffecte pas dans un gestionnaire (le build le refuse : l'écriture serait perdue) ; ses propriétés, si.

> 💡 **Le contenu d'une branche `{await}` suit ses variables, comme à la racine.** Dans l'attente, `{success}` et `{error}`, tout ce qui lit une variable réactive la suit : une interpolation `{expr}` ou `{{expr}}`, un attribut `title={expr}` ou `class="carte {$ton}"`, la prop d'un composant enfant (`<@carte item={$x}>`), `:class{…}`, `:style.…`, `--variable={…}`, le spread `{...fiche.attrs}`, les liaisons (`value=!{…}`, `:group=!{…}`, `:text=!{…}`, `:html=!{…}`, `:attach={…}` — dans une branche nommée (`{success v}`, `{error e}`), sa fabrique est appelée une fois à l'apparition de la branche, puis à chaque changement des variables qu'elle lit —, `:emit.…={…}`, la liaison à double sens d'un composant, les props d'un `<@module>`), un `{for}` placé dans la branche (`{for x in $liste}` se refait quand `$liste` change, et quand une variable du dehors que ses lignes lisent change) et un texte traduit (`µt`, cf. [29 · i18n](29-i18n.md)), qui suit la langue sans relancer la promesse ni reconstruire la branche. Ils sont posés à l'affichage de la branche puis tenus à jour quand leurs variables changent (leur condition ou leur valeur peut lire la valeur de la branche et un `{const}` ; les variables que ce `{const}` lit comptent comme les leurs, et il est recalculé à chaque mise à jour : gardez-le sans effet de bord). Une expression qui ne lit que la valeur de la branche (`{success v}` puis `{v.titre}`) ou un `{const}` qui ne lit aucune variable est calculée une fois, à l'affichage de la branche : rien ne peut la changer tant que la promesse reste la même, et une nouvelle promesse refait la branche (sous `{await.keep …}`, elle suit la valeur à chaque arrivée). Les blocs `{if}` / `{elsif}` / `{else}` et `{key}` placés dans une branche (un bloc dans un bloc aussi) suivent leurs variables de la même façon : leur condition ou leur clé peut lire une variable du dehors, la valeur de la branche et un `{const}` (les variables que ce `{const}` lit comptent comme les leurs), et quand le choix change le contenu du bloc est refait entre ses repères, avec la valeur de la branche et les `{const}` à jour ; l'attache (`:attach`) et l'événement (`:emit`) d'un contenu refait partent à ce moment-là. Une condition ou une clé qui ne lit que la valeur de la branche est calculée une fois, à l'affichage de la branche. Dans un texte, `null` et `undefined` n'écrivent rien (comme hors de la branche) ; `0` et `false` s'écrivent. Une branche qui n'est plus affichée (promesse remplacée, rejetée ou retirée) ne reçoit plus rien : ni écriture sur ses balises, ni appel de fabrique d'`:attach`, ni événement `:emit`, que la branche soit nommée ou non (l'attente comprise). Limite qui reste : le texte écrit directement dans un `<textarea>`, un `<title>`, un `<style>` ou un `<script>` d'une branche est calculé une fois, à l'affichage de la branche ; le navigateur n'y lit aucune balise, il n'y a pas de repère où le tenir à jour.

> ⚠️ Un `{await}` **imbriqué dans un `{for}`** n'est pas supporté et lève une erreur de compilation explicite — sortez-le du `{for}`. Un `{await}` imbriqué dans un `{if}` **à la racine** du template reste, lui, permis. En revanche, un `{await}` placé dans une branche d'un autre `{await}` (attente, `{success}`, `{error}`, même au fond d'un `{if}` ou d'un `{key}` de cette branche) est refusé par le build, comme dans un `{for}` : placez-le dans un sous-composant que la branche affiche.

## Re-montage forcé — `{key}`

```html
{key $valeur}
  <mon-composant prop={$x} />
{end}
```

`{key <expr>}` lie le bloc à une expression. **Tant que l'expression ne change pas**, rien de spécial. **Dès qu'elle change**, MJS **détruit entièrement** le contenu du bloc puis le **recrée à neuf** : les composants enfants repassent par leur cycle complet (destruction puis montage), et les transitions / animations d'entrée **rejouent**. C'est le seul bloc dont le rôle n'est pas de choisir *si* afficher, mais de forcer un **remplacement** plutôt qu'une mise à jour en place. Le bloc **construit toujours son contenu, quelle que soit la valeur de la clé** (`undefined`, `null`, `0`, `''` et `false` compris), à la racine comme dans un `{if}`, une ligne de `{for}`, une branche `{await}` ou un slot.

Usage typique : rejouer une animation d'entrée à chaque changement de valeur, ou repartir d'un état interne vierge dans un composant enfant quand une identité change.

> ⚠️ `{key}` est coûteux par nature (démontage + remontage complet). Ne l'employez que lorsque vous voulez *vraiment* repartir de zéro ; pour une simple mise à jour réactive, un `{if}` ou une liaison suffit.

> ⚠️ L'expression doit être une **valeur stable** : nombre, chaîne, identifiant. Un littéral objet ou tableau (`{key {a: $x}}`) fabrique une valeur **différente à chaque évaluation** — le bloc remonte à chaque passe, même quand `$x` ne change pas.

> 🔗 Voir aussi : [Transitions & animations](10-transitions.md) (les transitions d'entrée rejouées par `{key}`).

## Constante locale — `{const}`

`{const NOM = expr}` déclare une **constante locale**, réutilisable dans les interpolations qui suivent au sein du **même bloc**. Utile pour factoriser un calcul répété plusieurs fois dans une ligne d'un `{for}` :

```html
{for produit in $produits by id}
  {const prixTTC = produit.prixHT * 1.2}
  <li>{produit.nom} — {prixTTC.toFixed(2)}€ TTC (HT : {produit.prixHT}€)</li>
{end}
```

`prixTTC` est recalculé à chaque item, et re-recalculé si un `$` qu'il lit change (le `{for}` parent se reconcilie). Comme `{const}` ne produit aucun DOM, ce n'est pas un bloc à fermer par `{end}` — c'est une ligne, au même titre qu'un `{if}`/`{for}` dans le corps du bloc qui le contient.

Un gestionnaire situé **après** le `{const}`, dans le même bloc, le lit aussi : `<button @click={ajouter(prixTTC)}>` reçoit la valeur de sa ligne, recalculée au moment du clic (comme la variable de boucle, relue dans la liste, qu'elle soit un tableau, un `Set` ou une `Map`). Le réaffecter (`@click={prixTTC = 0}`) est refusé au build : c'est une constante.

> ⚠️ **`{const}` n'est supporté qu'à l'intérieur d'un `{for}` (ou d'une branche `{await}`)** — au **niveau racine** du template, il n'est **pas** supporté (V1) et lève une erreur de compilation explicite. Déclaré dans un `{if}` ou un `{key}` de ces blocs, il se lit dans ce `{if}` ou ce `{key}`. Pour une constante au niveau racine, déclarez plutôt une **dérivée réactive** dans le `<script>` : `$nom = expression` (auto-derived, cf. [Réactivité](03-reactivite.md)), puis lisez `{$nom}`.

---

📚 **Apprendre en pratiquant** : ce chapitre correspond au **Tuto interactif n°4 (Blocs logiques)** — `{if}`, `{else}`/`{elsif}`, listes `{for}`, listes keyées `by`, et `{await}`.
