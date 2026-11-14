# 4 · Props & attributs

> 📚 Tuto interactif correspondant : **Chapitre 3 — Props**. Les encarts 🎓 *Pour débutants* dépliables donnent l'explication pas-à-pas ; le corps de la page reste la référence dense.

Une **prop** est une donnée passée d'un parent à un composant enfant, via un **attribut** de balise. Côté parent on écrit l'attribut ; côté enfant on le lit comme un `$` réactif. Aucune déclaration de prop n'est nécessaire.

## Passer une prop (parent → enfant)

Le parent pose l'attribut sur la balise enfant. La valeur entre **accolades `{ }`** est une expression ; entre **guillemets `" "`** c'est une chaîne littérale.

```html
<!-- parent : app.mjs -->
<@nested answer={42}>
<@nested titre="Bonjour">
```

Dans l'enfant, l'attribut `answer` se lit `$answer`, `titre` se lit `$titre` — préfixés par `$`, donc **réactifs** :

```html
<!-- enfant : nested.mjs -->
<p>La réponse est {$answer}</p>
```

> ⚠️ **Ne déclarez pas** `$answer = ''` (ou toute autre valeur vide) « pour annoncer la prop » par réflexe venu d'autres frameworks. Un `$answer` lu dans le HTML de l'enfant est **auto-déclaré** : il reçoit directement la valeur passée par le parent. Une initialisation à vide ne sert à rien et brouille la lecture.

<details>
<summary>🎓 <b>Pour débutants</b> — props, attributs : c'est la même chose&nbsp;?</summary>

Quand vous écrivez une balise HTML normale, vous lui donnez des **attributs** : `<img src="…" alt="…">`. Une **prop** (propriété), c'est exactement ça, mais pour un composant MJS : `<@nested answer={42}>`. Vous « branchez » une donnée sur l'enfant via la balise.

Côté enfant, cette donnée arrive sous forme de variable réactive : l'attribut `answer` devient `$answer`. L'enfant n'a rien à réclamer ni à déclarer — il lit `$answer` là où il en a besoin, et MJS se charge de le remplir avec ce que le parent a passé.

Différence accolades vs guillemets : `answer={42}` passe le **nombre** 42 (expression évaluée) ; `answer="42"` passerait la **chaîne** `"42"`. Pour autre chose qu'un texte (nombre, booléen, objet, variable), utilisez les accolades.

</details>

**Un nom en camelCase écrit en clair** (`<@fiche userName="Léa">`) arrive à la prop que l'enfant déclare (`$userName`, écrite dans son script ou lue dans son gabarit) : le HTML met les noms d'attributs en minuscules, la balise porte donc `username="Léa"`, et la prop déclarée reçoit la valeur sous son nom, puis la suit quand la page change l'attribut ; en développement, en production comme au rendu serveur. Seule une prop déclarée est visée : un enfant qui n'a pas de `$userName` reçoit la valeur sous le nom en minuscules (`$username`). Un enfant qui déclare deux props qui ne diffèrent que par la casse (`$userName` et `$username`) la donne à celle dont le nom est exactement celui de l'attribut en minuscules, `$username`. Une exception : sur la balise d'un module du cœur (`<@@number lessLabel="Moins">`), cette écriture arrête la construction, qui donne l'écriture à tirets (`less-label`) — les attributs des modules du cœur n'en ont qu'une, celle de leur documentation (voir [30 · Modules cœur](30-modules-coeur.md)).
**Un attribut que l'enfant ne lit pas est signalé à la construction.** `<@fiche titel="Bonjour">` sur une fiche qui lit `$titre` : la valeur n'arriverait nulle part ; `mjs build` et `mjs check` le disent, avec le fichier, la ligne de la balise et le nom le plus proche (« vouliez-vous écrire « titre » ? »). C'est un avertissement, jamais une erreur, de type `propUnknown` ([32 · CLI](32-cli-et-configuration.md)), donné seulement quand c'est sûr. Comptent comme lus : une prop `$nom` de l'enfant (`user-name` et `userName` pour `$userName`) et un attribut qu'il lit par son nom (`@getAttribute('nom')`, `@matches('[nom]')`, sélecteur `[nom]` ou `attr(nom)` de son style) — dans son script, son gabarit, son style (les feuilles de ses modèles comprises, celles déposées à la main dans le dossier de sortie aussi : `fiche.alt.css`), ses partiels inclus et les modules qu'il importe, à toute profondeur ; pour une balise dont le modèle se choisit à l'exécution (`layout={$vue}`), ce que lisent la base et chacun de ses modèles ; pour un composant associé au formulaire (`@formAssociated`), `form`, `name`, `disabled`, `readonly` et `required`, que lisent le navigateur et le socle du formulaire ; enfin, sur toute balise, un attribut qu'une feuille du projet vise (`mjs-fiche[variante="large"]` dans le style du parent ou dans une feuille partagée) ou qu'un script du projet lit par son nom. Ne sont jamais signalés : les attributs natifs et globaux (`class`, `id`, `title`, `hidden`, `slot`…), `data-*`, `aria-*`, les directives (`@click`, `*skeleton`…), `layout`, `template` et `theme`, la balise d'un module du cœur ou d'une autre bibliothèque, une balise qui reçoit une propagation `{...obj}`, et un enfant qui lit ses attributs d'une façon que la construction ne nomme pas — un nom calculé (`@getAttribute(nom)`, `$[nom]`), la liste entière (`@attributes`, `@getAttributeNames()`), un module chargé depuis une adresse (`@import lib 'https://…'`) ou par `import(url)`. La ligne citée est celle de la balise dans le fichier, partiels et blocs retirés (`<@head>`) compris ; une balise venue d'un partiel inclus est signalée sans ligne.

## Attribut sans valeur

Sur une balise de composant, un attribut écrit sans valeur passe `true` — `<@@checkbox disabled>` équivaut à `disabled={true}`, exactement comme `<input disabled>` en HTML natif. `title=""` (valeur écrite mais vide) passe `''`.

```html
<@@checkbox disabled>   <!-- équivaut à disabled={true} -->
```

> ℹ️ Le runtime lit les textes `"true"` et `"false"` comme des booléens. Dans du HTML servi par un back, où aucun compilateur MJS ne passe, écrivez `disabled="true"` explicitement — un attribut nu y arrive comme `''`.

## `data-*` et `aria-*` : sur la balise

Un attribut `data-*` ou `aria-*` écrit sur un composant (`<@x>`, composant léger, `<@@x>` du cœur) se pose sur la balise du composant, comme sur une balise HTML. Fixe (`data-cle="abc"`), lié (`data-cle={$cle}`, `data-cle=!{$cle}`, store `$$cle`) ou sans valeur (`data-vide` donne `data-vide=""`), il arrive toujours sur la balise, et un attribut lié suit sa variable. Mêmes règles qu'en natif : `null` et `undefined` retirent l'attribut, `false` aussi pour un `data-*`, mais `aria-*` à `false` s'écrit `"false"` ; `true` s'écrit `"true"`.

Le composant lit la valeur sur sa propre balise : `@getAttribute('data-cle')`.

## Les attributs globaux : sur la balise aussi

`id`, `class`, `title`, `role`, `hidden`, `tabindex`, `lang`, `dir` et `slot` écrits sur un composant se posent sur sa balise, comme sur une balise HTML, fixes comme calculés (`id={'note-' + n.key}`), à la racine, dans un `{for}` ou dans un `{if}` : le navigateur et les autres composants les lisent là (`<@@toolbar for="…">`, `<label for>`, `aria-labelledby`, `getElementById`, un sélecteur CSS de la page). Une valeur calculée suit sa variable — `null` et `undefined` retirent l'attribut, `hidden` est un booléen que `false` retire — et le composant la reçoit aussi comme prop.

Le composant que monte `<@module $comp>` suit la même règle pour `title`, `role`, `hidden`, `tabindex`, `lang`, `dir` et `slot` : la valeur calculée arrive en prop et se pose sur sa balise, et un composant chargé à la demande la reçoit sur sa balise dès qu'il est défini ; `id` et `class` y sont des attributs de la balise seulement (voir [15 · Éléments spéciaux](15-elements-speciaux.md#module-comp--composant-dynamique)).

Une balise de composant qui porte `hidden` est cachée, comme une balise HTML, l'attribut écrit en clair (`<@carte hidden>`) comme calculé (`hidden={$replie}`), avec ou sans Shadow DOM, module du cœur compris (`<@@select hidden={…}>`). Comme pour une balise HTML, le style de la page passe devant : un `display` que la page pose sur la balise la montre. `hidden="until-found"` reste au navigateur, comme sur une balise HTML : la balise garde son affichage, le navigateur cache son contenu, et la recherche de la page le trouve et le révèle en retirant l'attribut.

**Un composant qui déclare lui-même une prop de ce nom la garde pour lui** (`$title` d'une carte qui l'affiche, `$hidden` de `<@@chart>`, la liste des séries cachées) : une valeur calculée ne lui arrive qu'en prop, sans attribut sur sa balise — `<@@chart hidden={['tour']}>` ne cache pas le graphique, une carte `title={$t}` ne reçoit pas de bulle. Le nom se compare sans la casse, comme un attribut HTML : `tabIndex={$t}` va à une prop `$tabindex`, `tabindex={$t}` à une prop `$tabIndex`. Écrite en dur (`title="Bonjour"`), la valeur est un attribut de la balise dans tous les cas, puisque le HTML l'y pose, et une prop déclarée la reçoit aussi, sans la casse elle aussi : `tabIndex="3"` pose `tabindex="3"` sur la balise (le HTML écrit le nom en minuscules) et donne `"3"` à la prop `$tabIndex`, puis la prop suit l'attribut quand la page le change ; une balise qui déclare `$hidden` n'est pas cachée par l'attribut : `<@@chart hidden>` reste affiché. La liaison à deux sens (`id=!{$x}`) ne livre que la prop ; la donnée étalée (`{...p}`) suit la règle de la valeur calculée, `class` comprise (voir « Propagation (spread) » plus bas).

## Valeurs par défaut

Si le parent **omet** l'attribut, la prop est `undefined` côté enfant. On donne une valeur par défaut en **initialisant simplement la variable** dans le `<script>` de l'enfant :

```html
<!-- enfant : nested.mjs -->
<script>
  $answer = 'un mystère'
</script>

<p>La réponse est {$answer}</p>
```

Le parent peut alors fournir la valeur ou non :

```html
<!-- parent : app.mjs -->
<@nested answer={42}>     <!-- affiche : La réponse est 42 -->
<@nested>                 <!-- affiche : La réponse est un mystère -->
```

> 🔎 **Le parent gagne toujours, sans précaution particulière.** Le `<script>` s'exécute au *constructeur* ; les valeurs du parent, elles, arrivent au *montage* (`connectedCallback`), donc **après**. Une affectation simple `=` ne peut donc pas écraser la valeur du parent — y compris quand celle-ci est `0`, `false` ou `''`, qui arrivent intactes, avec leur type : le nombre `7` reste un nombre, une date reste une date.
>
> Le parent gagne aussi **dans sa propre variable**. Avec une liaison à deux sens (`answer=!{$x}`, voir [Bindings](07-bindings.md)), la valeur par défaut de l'enfant ne remonte **jamais** dans `$x`, même quand `$x` est vide : c'est le parent qui initialise sa variable. Cela vaut à chaque étage : un composant du milieu, qui reçoit sa valeur de son parent et la lie à son tour à son propre enfant, ne fait jamais remonter sa valeur par défaut dans la variable du premier parent, quel que soit l'ordre dans lequel les fichiers sont définis. Ce qui remonte, ce sont les écritures que l'enfant fait **lui-même** une fois les valeurs de son parent reçues — un clic, son `µmount`, une minuterie, et aussi son `µsleep` ou son `µdestroy` quand le parent est retiré avec lui.

<details>
<summary>🎓 <b>Pour débutants</b> — pourquoi pas <code>?=</code>&nbsp;?</summary>

`$answer ?= 'un mystère'` (« assigne seulement si vide ») est du Civet parfaitement valide, et on le croise dans du code plus ancien. Mais ici il ne change **rien** : au moment où le `<script>` tourne, la prop du parent n'est pas encore arrivée — `$answer` est toujours vide, la condition est toujours vraie. Autant écrire `=`, plus court et plus simple à lire.

</details>

## Les props sont réactives

Une prop n'est pas une copie figée au montage : si la donnée **change chez le parent**, l'enfant se met à jour automatiquement. Le lien parent → enfant est vivant, exactement comme un `$` interne. Rien de spécial à faire côté enfant : il lit `$answer`, et tout endroit du HTML qui l'affiche suit les changements.

Un objet ou une liste passés ainsi suivent aussi ce que le parent écrit dedans par sa variable, à n'importe quelle profondeur : avec `<@fiche item={$o.a}>`, l'écriture `$o.a.b.c = 5` chez le parent (de même `$o.a.l.push(x)`, `delete $o.a.b.c`) redessine la fiche, comme l'enfant d'une ligne `{for r in $rows}` qui reçoit `item={r.x}` quand le parent écrit `$rows[0].x.c.n = 1`. Une écriture ailleurs dans `$o` (`$o.z = 1`) ne redessine pas la fiche.

### L'enfant qui écrit lui-même une prop reçue

Le lien va du parent vers l'enfant, dans ce sens seulement. Quand l'enfant écrit lui-même une prop reçue ainsi (`$dialog = null` dans l'enfant, pour `dialog={$dialog}` chez le parent), seule la valeur de l'enfant change : le parent garde la sienne et n'en sait rien. Un `{if $dialog}` du parent laisse donc l'enfant affiché. C'est voulu, le parent garde la main, mais le piège est silencieux : en développement, MJS le signale dans la console, une fois par composant et par prop, sous la balise telle que vous l'écrivez (`<@fenetre>`, `<@@select>` pour un module cœur).

```
[ModularJS] <@fenetre> écrit sa prop « dialog » : cette valeur vient du parent ; liez-la par !{…} ou envoyez un événement. Le parent garde sa propre valeur, il ne voit pas ce changement.
```

Pour que le parent suive, liez la prop à deux sens (`dialog=!{$dialog}`, voir [Bindings](07-bindings.md)) : l'écriture de l'enfant remonte dans la variable du parent. Ou envoyez un événement que le parent écoute pour écrire lui-même sa variable (voir [Événements](06-evenements.md)).

Rien n'est dit pour une prop liée à deux sens, pour la valeur par défaut que le `<script>` de l'enfant pose (elle vient avant celle du parent, voir plus haut), pour une variable que le parent ne passe pas, pour une valeur fixe écrite en attribut (`titre="…"`), ni pour une liste réécrite avec les mêmes éléments (une copie, la remise à zéro d'un formulaire), ni quand la balise de l'enfant porte au moins un gestionnaire d'événement qui exécute du code (`@ferme={…}`, `@change={…}`, quel que soit l'événement, ceux des transitions compris : `@introstart={…}`) : le parent a alors un canal pour suivre, comme avec un module cœur piloté par la page (`<@@select value={$zone} @change={$zone = e.data}>`). Les directives écrites avec `:` (`:attach`, `:class{…}`, `:this`, `:emit.x`, `:lightDom`, `:preload`…) ne sont pas des gestionnaires, ni un `@…` écrit sans valeur, qui n'exécute rien. Une prop étalée (`{...obj}`, ci-dessous) compte comme les autres. La construction de production n'en garde rien : ni ce contrôle, ni son texte.

### Modifier un objet reçu

Une prop passe la valeur elle-même, jamais une copie : l'objet, la liste ou la date que le parent passe (`items={$items}`) est, chez l'enfant, le même objet que chez le parent. Sans `!`, la donnée ne fait que descendre ; l'enfant qui la modifie — `$items.push(x)`, `$items[0].nom = 'Léa'`, `$cfg.a = 1`, `delete $cfg.a`, `$items.sort()`, `$jour.setFullYear(2030)`, `$m.delete('a')` sur une Map, `Object.defineProperty($cfg, 'a', …)`, `Object.assign($items[0], …)`, ou par une autre variable qui garde l'objet (`$sel = $items[0]` puis `$sel.nom = 'Léa'`), une fonction qui le reçoit — change donc un objet du parent, et le parent n'en est pas prévenu : seul l'enfant se redessine. En développement, MJS le signale dans la console, une fois par composant et par prop, sous les balises telles que vous les écrivez, avec la pile d'appels de la modification (l'objet `Error` qui suit le message), qui mène à la ligne qui l'a faite :

```
[ModularJS] <@liste> modifie un objet que <@page> lui a passé par sa prop « items » : <@page> n'en est pas prévenu. Lisez « Modifier un objet reçu » dans la documentation des props (04-props.md).
```

C'est la règle de Svelte 5 : la modification d'un objet reçu par une prop simple est dite, quoi que fasse le parent ensuite. Elle ne regarde que d'où vient l'objet : l'objet passé par la prop, et tout objet que l'enfant en atteint, à toute profondeur (l'élément d'une liste reçue, la ligne `r` d'un `{for r in $items}`, une valeur rangée dans un objet reçu, l'élément d'une copie en surface de la liste). Ce que fait le parent ensuite n'y change rien : qu'il garde l'objet, le lâche (`$items = await charger()`, `$sel = null`), le recalcule (valeur dérivée `$cfg = {a: $n}`), le recopie ou le recharge dans le même clic, l'objet que l'enfant a reçu et qu'il modifie est dit. D'où que le parent le prenne, aussi : son état, un objet qu'il fabrique pour l'enfant (`cfg={{a: 1}}`, `items={$items.filter(…)}` ; la modification se perd quand le parent recalcule la valeur), le magasin `$$` (`liste={$$panier}`, `item={$$panier[0]}`, la ligne d'un `{for p in $$panier}`, `{for}` imbriqués compris ; modifié par la prop, le magasin ne prévient pas ses lecteurs), un `µ.state`. Une prop étalée (`{...obj}`), une ligne de `{for}`, une balise qui porte un gestionnaire d'événement (`@change={…}`) comptent comme les autres, comme la modification faite pendant le rendu de l'enfant (`{$map ? plan() : '-'}`, où `plan()` écrit `$map.grid`). Une fonction que le parent passe en prop (`pris={prendre}`) et que l'enfant appelle avec l'objet reçu (`$pris($items)`) le modifie pour l'enfant : c'est dit sous son nom. Une copie que l'enfant donne au parent (`µemit 'valide', $mien`) et que le parent lui repasse par une prop (`cfg={$cfg}` après `$cfg = e.data`, ou rangée dans la liste qu'il passe) est devenue un objet reçu : la modifier est dit.

Une prop liée à deux sens (`!{…}`) n'avertit pas, comme `bind:` dans Svelte 5 : l'objet est partagé. Écrite par une prop simple, la modification est dite même quand une prop liée mène au même objet (`items=!{$items} sel={$items[0]}` : `$sel.nom = 'Léa'` est dit, et le parent n'est pas redessiné ; `$items[0].nom = 'Léa'` se tait). Ce qu'un enfant lié modifie par sa prop liée, il le modifie pour le composant qui la lui lie : quand celui-ci a reçu l'objet par une prop simple (`<@liste items={$l}>` chez la page, puis `<@ligne items=!{$items}>` ou `<@ligne item=!{$items[i]}>` dans `<@liste>`), c'est `<@liste>` qui est nommé, avec `<@ligne>` qui modifie, au bout d'une chaîne de liaisons comprise, dans une boucle ou par une autre variable. De même quand `<@liste>` lie à `<@ligne>` une copie en surface de la liste reçue (`$copie = [...$items]`, puis `<@ligne items=!{$copie}>`) : la copie partage les éléments reçus, et `<@ligne>` qui en modifie un (`$items[0].nom = 'Léa'`) modifie l'objet de la page :

```
[ModularJS] <@ligne>, lié à <@liste>, modifie un objet que <@page> a passé à <@liste> par sa prop « items » : <@page> n'en est pas prévenu. Lisez « Modifier un objet reçu » dans la documentation des props (04-props.md).
```

Le principe sûr : un objet appartient à l'endroit où il est rangé — l'état du composant qui l'a créé, ou le magasin. On le modifie là, par sa variable `$` ou `$$` ; un enfant qui veut le changer le demande par un événement, ou reçoit la variable elle-même par une prop liée. Trois exemples, que les tests du framework jouent tels quels (le parent et l'enfant montrent la modification, et rien n'est dit) :

```html
<!-- la page tient la liste : la ligne demande, le gestionnaire de la page modifie -->
{for r in $rows}
  <@ligne item={r} @renomme={r.nom = e.data}>
{end}
<!-- dans <@ligne> : µemit 'renomme', 'Léa' -->
```

```html
<!-- le magasin tient le panier : la page et l'enfant le lisent et l'écrivent par $$ -->
<p>{$$panier.length}</p>
<@ajout>
<!-- dans <@ajout> : $$panier.push(article), et {$$panier.length} pour l'afficher -->
```

```html
<!-- la page prête sa variable par une prop liée : l'enfant écrit directement par elle -->
<@liste items=!{$items}>
<!-- dans <@liste> : $items[0].nom = 'Léa' -->
```

Par une prop liée, ce que l'enfant écrit par la prop dans son script (`$items[0].nom = 'Léa'`, `$items.push(x)`), comme ce qu'il change plus bas par une autre variable ou par une fonction (`t = $items[0]` puis `t.nom = 'Léa'`), redessine le parent (voir [Bindings](07-bindings.md)) ; avec `"proxy": false`, seule l'écriture faite par la prop le redessine.

Un enfant qui tient un objet de l'état de son parent (`<@fiche item={$o.a}>`) se redessine quand le parent écrit dans cet objet ou plus bas, directement (`$o.a.b.c = 5`) ou par un nom, une fonction, une méthode (`t = $o.a.b` puis `t.c = 5`). Un objet que le parent range chez l'enfant en appelant une méthode de l'enfant, et non par une prop, n'y est pas suivi : l'enfant ne se redessine pas quand le parent y écrit ensuite. Passez-le par une prop. Les limites, et les cas qui demandent `µrefresh`, sont dans [3 · Réactivité](03-reactivite.md).

Les limites, sans détour : une copie ne partage rien. Une copie en surface (`[...$items]`, `{...$cfg}`, `$items.filter(…)`) garde les éléments du parent : les modifier, c'est encore modifier ceux du parent, et c'est dit. Une copie `JSON.parse(JSON.stringify(…))` perd les `Map`, les `Set`, les dates (devenues des textes) et les classes ; `structuredClone` refuse les objets suivis par MJS (des enveloppes) ; `µclone` copie un composant, pas une donnée. Et même juste, une copie est à celui qui l'a faite : le parent ne voit pas ce qu'on y change. Un objet du magasin reçu par une prop simple, puis modifié par l'enfant, ne prévient pas les lecteurs du magasin en développement ; en production, tant que votre projet ne contient aucune valeur dérivée, ils en sont encore prévenus. Ne comptez pas dessus : modifiez le magasin par `$$`.

Rien n'est dit pour :

- un objet que l'enfant a fait et qu'il garde : sa copie (en surface, tant qu'il ne change que la copie elle-même : `$mien.push(x)`), même rangée dans sa propre prop (`$items = [...$items]`, que l'avertissement précédent ne dit pas : mêmes éléments) et passée à son propre enfant, un objet neuf ;
- une modification par une prop liée, quand toute la chaîne de liaisons part de l'état d'un composant (sa variable, et non une prop simple qu'il a reçue ni une copie en surface de celle-ci) ;
- le magasin écrit par `$$` dans l'enfant (`$$panier.push(x)`) : il prévient ceux qui lisent `$$panier`, mais pas ce que l'enfant affiche par sa prop (`{$liste.length}`), qu'il lit alors par `$$panier` lui aussi ;
- ce que le gestionnaire du parent écrit dans l'objet que l'enfant lui envoie (`µemit 'choisi', $items`, puis `@choisi={e.data.push(x)}`), aussitôt ou plus tard (minuterie, après un `await`) : c'est l'écriture du parent. L'enfant qui a envoyé l'objet le modifie encore par son propre code (`$items[0].nom = 'Léa'`), et c'est dit, mais plus par une fonction ou une autre variable qui le garde : MJS n'y sépare plus son écriture de celle du gestionnaire, et se tait ;
- une réaffectation (`$items = …`) : elle reste à l'enfant, l'avertissement précédent la signale ;
- un objet [`µraw`](11-etat-brut.md), qui ne prévient personne (un objet qu'il contient, passé seul en prop, se suit chez l'enfant comme un autre : le modifier est dit ; de même la ligne d'une liste marquée `µraw(liste, true)`, qui ne porte pas de marque à elle) ;
- ce que le parent écrit lui-même dans son objet.

La lecture ne coûte presque rien de plus : une liste reçue se lit en développement avec les mêmes recherches qu'en production (une ou deux lectures de propriété de plus par objet lu) ; une modification coûte quelques recherches dans des tables faibles, quels que soient le nombre de composants de la page et la taille de l'état du parent, jamais parcourus. La construction de production n'en garde rien : ni ce contrôle, ni son texte.

## Propagation (spread) : `{...obj}`

Quand un enfant attend beaucoup de props, les énumérer une à une devient verbeux. La syntaxe **spread `{...obj}`** développe un objet en une série d'attributs :

```html
<script>
  pkg = {
    name: 'modularjs'
    version: 2
    description: 'ultra rapide'
    website: 'https://mjs.rapturestudio.fr'
  }
</script>

<@info {...pkg}>
```

L'enfant reçoit `$name`, `$version`, `$description`, `$website`. La propagation est **réactive bit à bit** : remplacer tout l'objet ou une seule de ses clés propage le changement.

On peut **mélanger** spread et attributs nommés. Un attribut écrit sur la balise gagne toujours sur la même clé de l'objet, quel que soit l'ordre d'écriture : l'objet ne le touche jamais, que la valeur soit écrite en dur (`version="1.7-beta"`), nue (`hidden`) ou calculée (`version={$v}`).

```html
<@info {...pkg} version="1.7-beta">   <!-- version reste "1.7-beta" -->
<@info version="1.7-beta" {...pkg}>   <!-- version reste "1.7-beta" aussi -->
```

Pour que l'objet décide d'une valeur, ne l'écrivez pas sur la balise : `<@info {...pkg}>` reçoit la `version` de `pkg`. Seule la classe fait l'union (voir plus bas).

Sur un composant, chaque clé de l'objet est une prop, et l'objet pose sur la balise ce qu'y poserait la même valeur écrite en clair : `data-*` et `aria-*` toujours ; `id`, `title`, `role`, `hidden`, `tabindex`, `lang`, `dir` et `slot`, sauf quand le composant déclare une prop de ce nom, qui les garde pour elle (voir plus haut) ; une clé qui quitte l'objet quitte la balise. `<@carte {...extra}>` avec `extra = {title: 'Aide', 'data-id': 7}` porte `title="Aide"` et `data-id="7"`, comme `<@carte title={…} data-id={…}>`. La clé `class` suit la règle de `class={…}` : la classe se pose sur la balise du composant, sauf s'il déclare lui-même une prop `$class`, qui la garde alors pour lui, sans rien sur la balise. Deux spreads qui posent `class` : le dernier qui la pose l'emporte, même quand le premier change.

La classe étalée s'ajoute aux autres classes de la balise, quel que soit l'ordre des attributs : celle que vous avez écrite, en dur (`class="carte"`), mêlée (`class="carte {$etat}"`) ou calculée (`class={$c}`), et les bascules `:class{…}`. Chacune garde sa part : `<@carte class="fixe {$c}" {...extra}>` avec `extra = {class: 'vive'}` et `$c = 'm1'` porte `fixe`, `m1` et `vive` ; `$c` qui change ne touche pas à `vive`, et quand la clé quitte l'objet, seul `vive` part — un jeton que la classe écrite porte aussi reste. Une bascule fait exception : un jeton qu'elle partage avec la classe étalée n'a qu'une part pour les deux. Avec `<@carte :class{$on}="vif" {...extra}>` et `extra = {class: 'vif'}`, l'objet qui perd `vif` le retire même quand `$on` est vrai, et `$on` qui devient faux le retire même quand l'objet le porte encore : donnez-leur des jetons différents. La règle vaut à la racine comme dans un `{for}` ou une branche `{await}` ; un composant pas encore défini (module chargé plus tard) la suit dès qu'il l'est, et le rendu serveur écrit la classe dans son HTML.

Sur `<@module $comp>`, la donnée étalée suit les règles de `<@module>` (voir plus haut), où `class` est un attribut de la balise seulement : la classe étalée s'y pose même quand le composant déclare `$class`. Elle s'ajoute elle aussi à la classe écrite en dur, qui reste : `<@module $comp class="carte" {...extra}>` avec `extra = {class: 'vive'}` porte `carte` et `vive`, à la racine comme dans un `{for}`, au rendu serveur comme dans la page, et les garde quand `$comp` passe à un autre composant.

> ℹ️ Le spread marche aussi sur une **balise HTML native** (`<input {...attrs} />`) : chaque clé est passée à `setAttribute` — pratique pour relayer un lot d'attributs de formulaire ou d'accessibilité (`aria-*`) stockés dans un objet. Deux spreads qui posent la même clé (`<div {...base} {...choix}>`) : le dernier qui la pose l'emporte, toujours. Une clé qui quitte l'objet quitte la balise, sauf si un autre spread la pose encore. Un attribut écrit sur la balise gagne là aussi, dans les deux ordres : `<input value="a" {...attrs}>` garde `a` même quand `attrs` porte `value`, comme un `style`, un attribut nu (`hidden`) ou calculé (`title={$t}`). Seul `value` écrit en dur sur un `<textarea>` ou un `<select>`, que le navigateur ne lit pas (le champ ne l'affiche pas), laisse la place : la `value` de l'objet s'y pose. La classe étalée s'ajoute à la classe écrite, en dur, mêlée ou calculée, et n'en retire jamais un jeton : `<div class="carte" {...extra}>` avec `extra = {class: 'vive'}` porte `carte` et `vive`, puis `carte` seule quand la clé quitte l'objet. La règle vaut dans un `{for}`, dans une branche `{await}`, sur `<@element $tag>` (même quand la balise change) et au rendu serveur.

> ⚠️ Sur un élément SVG, les clés d'un spread se posent telles quelles, à l'exécution : écrivez-les avec leur casse SVG (`viewBox`, `preserveAspectRatio`, pas `viewbox`) et préférez `href` à `xlink:href`, qui y serait posé sans son espace de noms (l'icône d'un `<use>` n'apparaîtrait pas).

> ℹ️ Dans une branche `{success fiche}` ou `{error err}` d'un `{await}`, le spread peut lire la valeur de la branche (`<div {...fiche.attrs}>`) : les attributs sont posés quand la branche s'affiche, et un `{...$attrs}` suit `$attrs` (cf. [5 · Blocs](05-blocs.md)).

---

📚 **Apprendre en pratiquant** : ce chapitre correspond au **Tuto interactif n°3 (Props)** — déclaration d'attributs, valeurs par défaut, propagation (spread). Voir aussi [Réactivité](03-reactivite.md) (les `$` côté enfant) et [Anatomie d'un composant](02-composant.md) (interpolation d'attributs et composants imbriqués).
