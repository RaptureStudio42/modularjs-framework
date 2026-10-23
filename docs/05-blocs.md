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

`by id` indique à MJS d'**identifier** chaque ligne par cette clé (ici la propriété `id` de chaque élément) plutôt que par sa position. Sans clé, MJS suit les éléments **par index** : si vous retirez le premier élément d'une liste, l'index 0 contient maintenant l'ancien index 1, et MJS met à jour *le contenu* du premier nœud existant au lieu de retirer le bon — état interne, focus, transitions et composants enfants peuvent alors se retrouver « décalés » sur la mauvaise ligne. Avec `by id`, MJS retrouve chaque ligne par son identité, retire précisément la bonne, et **préserve** l'état des autres.

`by` attend le **nom** d'un champ de l'élément, sans préfixe : `by x.id` est refusé à la construction, avec la forme à écrire (`by id`).

La clé peut être un objet : un objet ordinaire, gelé (`Object.freeze`) ou non, est reconnu par son identité (deux objets distincts donnent deux lignes, le même objet retrouve sa ligne) ; un objet qui s'écrit lui-même, comme une date ou un tableau, par ce texte (`String()`), comme une chaîne. Deux éléments de même clé sont une erreur de la liste : seul le premier est affiché (avec un avertissement), et chaque ligne affichée garde son vrai `index` dans la liste — `$liste.splice(index, 1)` retire bien l'élément de cette ligne.

<details>
<summary>🎓 <b>Pour débutants</b> — quand est-ce que <code>by</code> change vraiment quelque chose&nbsp;?</summary>

Tant que votre liste ne fait que grandir par la fin, index et identité coïncident, et `by` ne change rien de visible. La différence apparaît dès que vous **insérez ou supprimez au milieu / au début**, ou que vous **réordonnez**. Exemple : une liste de composants avec un champ de saisie. Sans clé, supprimer la première ligne laisse le texte tapé « glisser » vers le haut, car MJS a recyclé les nœuds par position. Avec `by id`, c'est la ligne supprimée qui disparaît, les autres gardent leur saisie. Règle simple : dès que vos éléments ont une identité stable (`id`, `uuid`…), mettez un `by`.

</details>

## Promesses — `{await}` / `{success}` / `{error}`

```html
<script>
  roll = ->
    new Promise (fulfil, reject)->
      setTimeout(->
        if Math.random() < 0.5
          reject(new Error('Something went wrong'))
          return
        fulfil(Math.floor(Math.random() * 100))
      , 500)

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

Les mots-clés sont bien **`success`** et **`error`** — pas `then`/`catch`. Les noms liés (`number`, `err` ci-dessus) sont libres mais ne peuvent pas être des mots réservés. Réaffecter `$promise` (ici via le bouton) relance le cycle : on repasse par la branche d'attente. Une promesse remplacée pendant l'attente est ignorée quand elle se résout ou échoue : seule la dernière assignée peut encore faire basculer l'affichage.

> ⚠️ La branche d'attente (`{await …}` → `{success …}`) et les noms liés sont positionnels : `{success}` vient avant `{error}`, et chacun introduit *sa* variable, visible uniquement dans sa branche — **gestionnaires et liaisons compris** : `{success fiche}<button @click={enregistrer(fiche)}>` et `<input value=!{fiche.nom}>` lisent la valeur chargée, et un `{for x in fiche.lignes}` de la branche aussi. La variable elle-même ne se réaffecte pas dans un gestionnaire (le build le refuse : l'écriture serait perdue) ; ses propriétés, si.

> 💡 **Le contenu d'une branche `{await}` suit ses variables, comme à la racine.** Dans l'attente, `{success}` et `{error}`, tout ce qui lit une variable réactive la suit : une interpolation `{expr}` ou `{{expr}}`, un attribut `title={expr}` ou `class="carte {$ton}"`, la prop d'un composant enfant (`<@carte item={$x}>`), `@class{…}`, `@style.…`, `--variable={…}`, le spread `{...fiche.attrs}`, les liaisons (`value=!{…}`, `@group=!{…}`, `@text=!{…}`, `@html=!{…}`, `@attach={…}` — dans une branche nommée (`{success v}`, `{error e}`), sa fabrique est appelée une fois à l'apparition de la branche, puis à chaque changement des variables qu'elle lit —, `@emit.…={…}`, la liaison à double sens d'un composant, les props d'un `<@module>`), un `{for}` placé dans la branche (`{for x in $liste}` se refait quand `$liste` change, et quand une variable du dehors que ses lignes lisent change) et un texte traduit (`µt`, cf. [29 · i18n](29-i18n.md)), qui suit la langue sans relancer la promesse ni reconstruire la branche. Ils sont posés à l'affichage de la branche puis tenus à jour quand leurs variables changent (leur condition ou leur valeur peut lire la valeur de la branche et un `{const}` ; les variables que ce `{const}` lit comptent comme les leurs, et il est recalculé à chaque mise à jour : gardez-le sans effet de bord). Une expression qui ne lit que la valeur de la branche (`{success v}` puis `{v.titre}`) ou un `{const}` qui ne lit aucune variable est calculée une fois, à l'affichage de la branche : rien ne peut la changer tant que la promesse reste la même, et une nouvelle promesse refait la branche. Les blocs `{if}` / `{elsif}` / `{else}` et `{key}` placés dans une branche (un bloc dans un bloc aussi) suivent leurs variables de la même façon : leur condition ou leur clé peut lire une variable du dehors, la valeur de la branche et un `{const}` (les variables que ce `{const}` lit comptent comme les leurs), et quand le choix change le contenu du bloc est refait entre ses repères, avec la valeur de la branche et les `{const}` à jour ; l'attache (`@attach`) et l'événement (`@emit`) d'un contenu refait partent à ce moment-là. Une condition ou une clé qui ne lit que la valeur de la branche est calculée une fois, à l'affichage de la branche. Dans un texte, `null` et `undefined` n'écrivent rien (comme hors de la branche) ; `0` et `false` s'écrivent. Une branche qui n'est plus affichée (promesse remplacée, rejetée ou retirée) ne reçoit plus rien : ni écriture sur ses balises, ni appel de fabrique d'`@attach`, ni événement `@emit`, que la branche soit nommée ou non (l'attente comprise). Limite qui reste : le texte écrit directement dans un `<textarea>`, un `<title>`, un `<style>` ou un `<script>` d'une branche est calculé une fois, à l'affichage de la branche ; le navigateur n'y lit aucune balise, il n'y a pas de repère où le tenir à jour.

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
