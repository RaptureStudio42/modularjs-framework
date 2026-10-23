# 15 · Éléments spéciaux

> 📚 Tuto interactif correspondant : **Éléments spéciaux** — `<@window>`, liaisons `<@window>`, `<@head>`, `<@element>`, `<@module>`, `<@failed>`. Les encarts 🎓 *Pour débutants* dépliables donnent l'explication pas-à-pas ; le corps de la page reste la référence dense.

Les **balises spéciales** `<@…>` ne produisent pas de DOM à leur emplacement : elles donnent accès à des cibles globales (`window`, `document`, `body`, `<html>`, `<head>`), choisissent un tag au runtime, ou interceptent les erreurs. Elles vivent et meurent avec le composant (attache/détache automatiques au montage/démontage).

## Les raccourcis `<@nom>` et `<@@nom>` — composants et modules cœur

Au-delà des douze balises réservées détaillées dans ce chapitre, deux écritures invoquent un composant, chacune dans son propre espace de noms :

| Écriture | Désigne | Balise produite |
|---|---|---|
| `<@nom>` | un composant du **projet** — le fichier `nom.mjs` du `sourceDir`, ou l'un de ses alias courts | `<mjs-nom>` |
| `<@@nom>` | un **module cœur** — la petite bibliothèque livrée avec le framework : `select`, `field`, `checkbox`, `code`, `img`, `carousel`, `tabs`… (la liste complète : [30 · Modules cœur](30-modules-coeur.md)) | `<mjs-core-nom>` |

Un module cœur entre au bundle **automatiquement** dès qu'une balise le référence — rien à importer, rien à déclarer. Les deux espaces ne se mélangent jamais : un composant du projet peut s'appeler `select` sans toucher au module cœur, et `<@select>` (le vôtre) côtoie `<@@select>` (celui du framework) dans la même page. Introuvable → **erreur de compilation** (cf. *Une faute de frappe se voit tout de suite*, plus bas).

```html
<@cart>
<@@select value=!{$country}>
```

L'inspecteur du navigateur montre `<mjs-cart>` pour `<@cart>` et `<mjs-core-select>` pour `<@@select>` : c'est ce tag qui sert à cibler l'élément depuis l'extérieur (une feuille CSS globale, `document.querySelector('mjs-core-select')`, les outils de développement).

Les balises du langage — `<@window>`, `<@slot>`, `<@include>` et les autres de ce chapitre — gardent **un seul** `@`.

### Forme nue ou fermée

`<@nom>` (comme `<@@nom>`) **nue**, sans rien après, est la forme canonique dès que l'élément ne prend pas d'enfants : le compilateur repère l'absence de balise fermante et émet lui-même la paire complète, `<mjs-nom></mjs-nom>`. Dès que l'élément projette du contenu (des enfants, un slot), il se referme explicitement, `<@nom>…</@nom>` (`<@@select>…</@@select>`) :

```html
<@cart>

<@cart>
  <p>Contenu projeté dans le composant</p>
</@cart>
```

`<@include>`, `<@element>`, `<@module>`, `<@failed>` et `<@view>` suivent la même règle — nus sans contenu, fermés explicitement avec — mais pour ces cinq-là seulement, il n'y a aucune autre possibilité : ils refusent l'auto-fermeture, une erreur de compilation le signale aussitôt.

### Prendre la main sur un module cœur

Pour contrôler entièrement un module cœur, copiez son fichier source dans le projet : il devient un composant du projet comme un autre, écrit avec **un seul** `@`. Sous le même nom (`select.mjs`), `<@select>` désigne votre version et `<@@select>` reste celle du framework : vous choisissez, balise par balise, laquelle vous voulez. C'est le troisième levier de personnalisation (cf. [30 · Modules cœur](30-modules-coeur.md) § *Personnaliser*).

### Les douze balises réservées gardent leur sens

`<@include>`, `<@slot>`, `<@fill>`, `<@head>`, `<@body>`, `<@html>`, `<@document>`, `<@window>`, `<@element>`, `<@module>`, `<@failed>` et `<@view>` (le sujet du reste de ce chapitre, plus [Blocs](05-blocs.md) → `<@include>`, [12 · Snippets](12-snippets.md) → `<@fill>` et [Router](17-router.md) → `<@view>`) ne sont **jamais** résolues comme un raccourci de composant, quel que soit le contenu du projet. Un composant du projet ne peut d'ailleurs pas **porter un nom réservé** (erreur de compilation, fichier à renommer), ni commencer par `core-` (réservé aux modules cœur, dont la balise est `mjs-core-nom`). Écrite avec deux `@` (`<@@slot>`), une balise du langage est refusée : elle n'en prend qu'un.

### Une faute de frappe se voit tout de suite

- `<@typo>` inconnue (ni balise du langage, ni composant du projet) → **erreur de compilation**, avec une suggestion quand un nom proche existe : « balise `<@typo>` inconnue — ni balise du langage, ni composant du projet. Vouliez-vous dire `<@cart>` (composant du projet) ? » — un module cœur proche est proposé sous sa forme `<@@nom>`.
- `<@@typo>` : aucun module cœur de ce nom → **erreur de compilation**, avec la suggestion d'un module cœur proche ; `<@@cart>` alors que `cart` est un composant du projet → l'erreur dit d'écrire `<@cart>`.
- `<@select>` alors que le projet n'a **pas** de composant `select` → **erreur de compilation** ; quand le nom est celui d'un module cœur, le message donne l'écriture `<@@select>`.
- `<mjs-select>` littérale sans composant `select` au projet → **erreur de compilation** qui donne la balise du module cœur, `<mjs-core-select>` (écrite `<@@select>`) ; `<mjs-core-typo>` littérale sans module cœur de ce nom → **erreur de compilation** (le préfixe `mjs-core-` n'appartient qu'aux modules cœur).
- `<mjs-typo>` littérale (déjà écrite sous sa forme finale, sans `@`) qui ne correspond à rien du manifeste → simple **avertissement** (tag inerte au runtime — utile si c'est réellement voulu, par exemple un web component tiers).
- `<mjs-carte>` littérale dont l'alias court est **disputé** par deux composants (`doc/doc-carte.mjs` et `tuto/tuto-carte.mjs` le revendiquent tous les deux) → **avertissement** qui nomme les deux : personne ne publie cette clé, la balise courte n'est donc enregistrée par personne et reste inerte. Écrivez la balise complète, `<mjs-doc-carte>` ou `<mjs-tuto-carte>`.

## `<@window>` — événements globaux

`<@window>` attache des écouteurs et des liaisons à l'objet `window`, nettoyés automatiquement quand le composant est détruit. On y met les `@event` qu'on voudrait sur `window` :

```html
<script>
  $key = undefined
  $keyCode = undefined

  onkeydown = (event)->
    $key = event.key
    $keyCode = event.keyCode
</script>

<@window @keydown={onkeydown}>

<div>
  {if $key}
    <kbd>{$key === ' ' ? 'Space' : $key}</kbd>
    <p>{$keyCode}</p>
  {else}
    <p>Cliquez dans la fenêtre puis tapez une touche</p>
  {end}
</div>
```

Le suivi du scroll global est un cas typique — on stocke `window.scrollY` dans un `$` réactif :

```html
<script>
  $y = 0
</script>

<@window @scroll={$y = window.scrollY}>

<p>profondeur : {Math.round($y)}px</p>
```

> ⚠️ Placez `<@window>` au niveau racine du template, comme un élément normal — il ne s'imbrique pas dans un autre nœud (il ne *rend* rien à sa position). Les écouteurs sont posés au montage et **retirés au démontage** : pas de fuite, contrairement à un `window.addEventListener` posé à la main sans nettoyage.

> ⚠️ **Aucun modificateur sur ces macros** — ni `.prevent`/`.stop`/`.self`/`.once`/`.propagate`, ni le sucre `.emit.<nom>`. Ces écouteurs sont posés **en direct** sur la cible, hors du routeur délégué qui les implémente. Un suffixe y fait **échouer le build** avec un message explicite : écrivez `@event={…}` et faites le travail dans le corps (`e.preventDefault()`, `µemit '…'`).

### Liaisons `<@window prop=!{$v}>` — propriétés en deux-sens

Au-delà des événements, `<@window>` accepte des **liaisons** two-way (même idiome `=!` que [Bindings two-way](07-bindings.md)) sur certaines propriétés de `window` — les liaisons fenêtre disponibles :

```html
<script>
  $y = 0
  $w = window.innerWidth
</script>

<@window scrollY=!{$y} innerWidth=!{$w}>

<p>défilement : {Math.round($y)}px — largeur : {$w}px</p>
```

Propriétés liables : `scrollX`, `scrollY` (**two-way** — affecter `$y` fait aussi défiler la page), `innerWidth`, `innerHeight`, `outerWidth`, `outerHeight`, `devicePixelRatio`, `online` (ces dernières en lecture seule : la valeur suit `window`, mais l'affecter ne modifie rien côté navigateur). La valeur initiale est posée au setup, puis rafraîchie automatiquement sur l'événement natif pertinent (`scroll`, `resize`…).

Un nom absent de cette liste (une faute de frappe : `scrolY=!{$y}`) fait **échouer le build**, avec la liste des propriétés liables. Ces liaisons n'existent que sur `<@window>` : écrite sur `<@document>`, `<@body>`, `<@html>` ou `<@head>`, une liaison `nom=!{…}` fait aussi échouer le build.

> 💡 Pour l'état réseau seul, la rune [`µonline`](03-reactivite.md) (zéro balise, zéro `<@window>`) est plus directe que `<@window online=!{$en_ligne}>` — les deux lisent la même source.

<details>
<summary>🎓 <b>Pour débutants</b> — pourquoi ne pas faire <code>window.addEventListener</code> ?</summary>

Vous pourriez ajouter l'écouteur vous-même dans un `µmount` et le retirer dans un `µdestroy`. `<@window>` fait exactement ça, mais en déclaratif : vous écrivez l'écouteur une fois, MJS s'occupe de l'attacher *et* de le détacher au bon moment. Moins de code, et surtout impossible d'oublier le nettoyage (qui sinon laisse l'écouteur tourner même après que le composant a disparu).

</details>

## `<@document>` — événements au niveau document

Même principe, sur l'objet `document` — pour les événements qui n'existent que là (par exemple `selectionchange`). Forme `@event` nue : `@selectionchange` appelle la méthode/fonction du même nom :

```html
<script>
  $selection = ''
  selectionchange = -> $selection = document.getSelection().toString()
</script>

<@document @selectionchange>

<h1>Sélectionnez ce texte pour déclencher l'événement</h1>
<p>Sélection : {$selection}</p>
```

## `<@body>` — événements sur `<body>`

Idem, ciblant `document.body` — utile pour les événements de pointeur à l'échelle de la page :

```html
<script>
  $hereKitty = false
</script>

<@body @mouseenter={$hereKitty = true} @mouseleave={$hereKitty = false}>

<div class="kitten" @class{$hereKitty}="curious">🐱</div>
```

### Liaisons class/style sur `<@body>`

`<@body>` accepte aussi les **liaisons de classe et de style** du chapitre [8](08-class.md), appliquées à `document.body`. Le cas d'école : bloquer le scroll de la page tant qu'une modale est ouverte —

```html
<script>
  $modaleOuverte = false
</script>

<@body @class{$modaleOuverte}="no-scroll">
```

- `@class{cond}="classe"` — la classe suit la condition, réactivement.
- `@style.<prop>={expr}` et `--var={expr}` — propriété de style / custom property réactive sur `body` : `<@body @style.overflow={$open ? 'hidden' : ''}>`, `<@body --accent={$couleur}>`.
- `class="a b"` statique — classes ajoutées au **réveil** du composant, retirées à sa **mise en sommeil** (mêmes moments que l'attache/détache des écouteurs).

> ⚠️ `style="…"` statique sur `<@body>`/`<@html>` est une **erreur de compilation** (règle MJS zéro-CSS-inline) : utilisez `@style.prop={expr}`, `--var={expr}`, ou la feuille de style globale. Côté partage : `body` et `html` sont des éléments **communs à tous les composants** — les classes y sont **refcomptées et additives** (deux composants posant la même classe : elle reste tant que l'un des deux est éveillé ; des classes différentes s'additionnent — rien n'est jamais écrasé), tandis que `@style`/`--var` est **dernier-écrivain-gagnant** par propriété.

## `<@html>` — événements et liaisons sur `<html>`

Même contrat que `<@body>`, ciblant `document.documentElement` — la balise `<html>`, alias du sélecteur CSS `:root`. C'est la cible idiomatique du **theming global** : un dark-mode par classe sur `:root`, ou des custom properties de thème que toutes les feuilles de style (globales comme Shadow DOM) consomment via `var(…)` :

```html
<script>
  $sombre = false
</script>

<@html @class{$sombre}="dark" --accent={$sombre ? '#8be9fd' : '#0055aa'}>

<button @click={$sombre = !$sombre}>Basculer le thème</button>
```

Les événements y fonctionnent comme sur les autres cibles globales : `<@html @click={…}>`.

## `<@head>` — injection dans `document.head`

`<@head>…contenu…</@head>` injecte son contenu dans le `<head>` du document, de façon **réactive** : changer une variable lue à l'intérieur ré-injecte. Idéal pour un `<title>`, des `<meta>`, ou une feuille de style dépendant de l'état :

```html
<script>
  themes = ['margaritaville', 'retrowave', 'spaaaaace', 'halloween']
  $selected = themes[0]
</script>

<@head>
  <link rel="stylesheet" href={"/tuto-themes/" + $selected + ".css"}>
</@head>

<div class="stage">
  <h1>Bienvenue sur mon site !</h1>
  <select value=!{$selected}>
    {for theme in themes}
      <option>{theme}</option>
    {end}
  </select>
</div>
```

Le CSS injecté dans le `<head>` peut poser des **custom properties** (`--mjs-theme-*`) que le composant lit ensuite dans son propre `<style>` : les variables CSS **traversent le Shadow DOM**, ce qui permet à un thème global de styliser une scène encapsulée.

Dans une balise, une interpolation va **entre guillemets** (`href="/themes/{$selected}.css"`, ou la forme `href={expr}` que MJS quote pour vous) : une valeur nue (`href=/themes/{$selected}.css`), une expression posée à la place d'un attribut (`<meta {$attrs}>`) et un nom de balise calculé (`<{$tag}>`) sont des **erreurs de compilation**, qui citent la ligne du `.mjs` et la forme correcte. Sans guillemets, la valeur s'arrête au premier espace et ce qui suit devient un attribut de plus — un `"` dans une valeur nue est un caractère comme un autre, il ne protège rien ; avec un nom de balise calculé, c'est l'élément entier que la donnée fabrique. Dans un partial (`<@include>`), la ligne citée est celle du composant qui l'inclut.

Une valeur **déjà entre guillemets** accueille l'interpolation où l'on veut, paramètres d'URL et `k=v` compris (`href="/p?slug={$slug}&vue={$vue}"`, `data-cfg="k={$x}"`) : la donnée y est échappée et reste dans la valeur. L'attribut, lui, se **nomme** : un `=` sans nom devant lui (`<meta ={$x}>`, `<meta={$x}>`) n'ouvre aucune valeur — pour le navigateur, ce `=` est le premier caractère d'un nom d'attribut (ou du nom de balise) — et l'interpolation qui le suit est refusée. Les blancs admis entre le `=` et la valeur sont ceux du HTML — espace, tabulation, saut de ligne, saut de page, retour chariot : un espace insécable ou un BOM y est un caractère ordinaire, donc le début d'une valeur nue. Et pour des accolades **littérales** dans une valeur (`href="data:text/css,body&#123;color:red&#125;"`), écrivez `&#123;` et `&#125;` : des accolades nues y seraient lues comme une interpolation.

Le **contenu** d'un `<style>` ou d'un `<script>` part tel quel, jamais interpolé : ses accolades sont du CSS ou du JavaScript. Leur balise ouvrante, elle, se lit comme les autres : `<style media={$media}>` reçoit la valeur de `$media`, échappée et entre guillemets.

> ⚠️ Un `<script>` écrit dans `<@head>` est bien ajouté au `<head>`, mais le navigateur ne l'exécute **jamais** : un script inséré comme contenu HTML reste inerte. La construction le signale par un avertissement, qui cite la ligne. Pour un script tiers (SDK, mesure d'audience), écrivez-le dans la page qui accueille l'application (`index.html`), importez-le dans le `<script>` du composant, ou créez-le au montage avec `document.createElement('script')`. Seul un script de **données** (`type="application/ld+json"`) a sa place dans `<@head>`.

### Le titre de la page

`<title>` est le seul contenu de `<@head>` qui n'est **pas** ajouté comme nœud : il écrit `document.title`.

```html
<@head>
  <title>{$article.titre} — Mon site</title>
</@head>
```

La raison tient à la spécification HTML : le titre du document est celui du **premier** `<title>` de l'arbre, et toute page en a déjà un. Un second, ajouté par le framework, serait **inerte** — l'onglet ne bougerait pas. MJS écrit donc la propriété, dont le setter vise justement ce premier élément.

Deux conséquences utiles :

- **Le titre revient quand la page part.** MJS mémorise le titre trouvé à la première écriture et le rend au démontage du composant (ou à sa mise en sommeil par le [cache de pages](21-navigation.md)) : une page quittée n'emporte pas son titre sur la suivante. Deux composants empilés se dépilent dans l'ordre — le second rend le titre du premier, le premier celui du site.
- **Un titre écrit à la main n'est jamais écrasé.** La restauration n'a lieu que si le titre affiché est encore celui que le composant avait posé. Un `document.title = …` venu d'ailleurs entre-temps est laissé tranquille.

> ⚠️ Ce titre est posé **côté navigateur**, comme tout le contenu d'un `<@head>` : le rendu serveur (SSR) n'en tient pas compte, le HTML initial porte le titre de votre page hôte jusqu'à l'hydratation. Pour un titre vu par un robot d'indexation qui n'exécute pas de JavaScript, écrivez-le dans le HTML servi.

### Polices (`@font-face`)

Un `@font-face` déclaré dans le `<style>` (Shadow DOM) d'un composant **ne charge jamais** la police : le CSS compilé d'un composant part en `adoptedStyleSheets` sur le shadow root — une feuille *construite*, et `@font-face` n'y enregistre rien (limite navigateur, aucune erreur). L'idiome : déclarez la police au niveau document, via `<@head>` — son contenu est injecté **tel quel** (pas du SASS : de vraies accolades CSS), donc `@font-face` s'y comporte normalement :

```html
<@head>
  <style>
    @font-face {
      font-family: 'Ma Police';
      src: url(µasset('fonts/ma-police.woff2')) format('woff2');
    }
  </style>
</@head>

<style>
  :host
    font-family: 'Ma Police', sans-serif
</style>
```

- `µasset('…')` référence un fichier **local** : résolu et copié (hashé) au **build** — chemin absent → erreur de build explicite, jamais un lien mort silencieux.
- Deux composants qui déclarent la **même police** (même `<@head>` ou deux `<@head>` différents) ne déclenchent qu'**un seul téléchargement** : le navigateur déduplique par URL de fichier.
- Feuille externe (Google Fonts…) : pas de `@font-face` à écrire à la main, juste `<@head><link rel="stylesheet" href="https://fonts.googleapis.com/…"></@head>`.
- Un `@font-face` (ou un `@import`) laissé dans le `<style>` d'un composant déclenche un **avertissement de compilation** (non bloquant, le build continue) qui pointe vers cet idiome.

<details>
<summary>🎓 <b>Pour débutants</b> — pourquoi la police ne charge pas si je la mets dans le <code>&lt;style&gt;</code> du composant ?</summary>

Le `<style>` d'un composant vit dans son **Shadow DOM** : le navigateur l'encapsule pour que ses règles ne fuitent jamais vers le reste de la page (et inversement). Cette isolation a un effet de bord sur `@font-face` : une police déclarée dans une feuille *encapsulée* n'est tout simplement jamais enregistrée, sans le moindre message d'erreur — elle échoue en silence. `<@head>`, lui, injecte directement dans le `<head>` du **document** : hors Shadow DOM, `@font-face` y fonctionne exactement comme sur une page HTML classique.

</details>

## `<@element $tag>` — balise dynamique

`<@element $tag>…</@element>` rend un élément dont **le tag est la valeur de la variable**, choisie au runtime. La première valeur après `<@element` *est* la variable qui porte le nom de balise — il n'y a **pas** d'attribut `tag=` ni de chaîne en dur :

```html
<script>
  options = ['h1', 'h2', 'h3', 'p', 'marquee']
  $tag = options[0]
</script>

<select value=!{$tag}>
  {for opt in options}
    <option value={opt}>{opt}</option>
  {end}
</select>

<@element $tag>
  Je suis un élément <code>&lt;{$tag}&gt;</code>
</@element>
```

Changer `$tag` re-rend l'élément avec la nouvelle balise, en conservant son contenu.

> ⚠️ La syntaxe est `<@element $tag>` — le tag **est** la variable, et elle vient toujours **en premier**, avant les attributs éventuels. N'écrivez pas `<@element tag={$tag}>` ni `<@element "h1">` : il n'y a pas d'attribut `tag`, et une balise en dur n'aurait aucun intérêt (autant écrire la balise directement). `<@element accept="iframe" $tag>` (un attribut — avec ou sans valeur, `hidden $tag` y compris — avant la variable) est une erreur de compilation. Une expression entre accolades comme tag (`<@element {a || 'div'}>`) est une erreur de compilation elle aussi : seules une variable seule (`$tag`), un accès de membre (`$tag.x`) ou un identifiant nu sont acceptés ; calculez la valeur dans une dérivée (`$tag = a || 'div'`).

> ⚠️ Une liaison réactive (`@style.prop={…}`, attribut) posée sur `<@element>`/`<@module>` suit le nœud courant à chaque changement de balise. Ne pilotez pas `display` via `@style.display={…}` sur ces balises : une valeur falsy (`$tag`/`$comp`) masque déjà l'élément, et une liaison `@style.display` qui s'exécute après ce masquage peut l'écraser (dernier écrivain gagnant, comme deux effets qui écriraient la même propriété) — laissez la valeur falsy porter seule la visibilité. Les propriétés reflétées en attribut (`style`, `title`, `class`…) survivent à un changement de balise ; une propriété IDL non reflétée (`value`, `checked`) posée par un effet AVANT le changement ne l'est pas et doit être réappliquée par sa propre liaison réactive après coup — elle suit à la prochaine mutation, y compris au premier rendu, quand le placeholder initial est déjà remplacé (`$tag`/`$comp` différent du tag codé en dur, le cas quasi général) : ce n'est pas réservé à une bascule ultérieure.

> ⚠️ `@this=!{ref}` sur `<@element>`/`<@module>` capture le nœud initial, pas le nœud courant : lire la référence après une bascule n'est pas fiable ; posez `@this` sur un enfant stable ou passez par un identifiant.

<details>
<summary>🎓 <b>Pour débutants</b> — à quoi sert une balise dynamique&nbsp;?</summary>

Parfois la *nature* de l'élément dépend des données : un composant « titre » qui rend `<h1>`, `<h2>` ou `<h3>` selon un niveau ; un bloc de contenu dont la balise vient d'un **cms**. Plutôt que d'écrire un `{if}` par balise possible, `<@element $tag>` vous laisse mettre le nom de balise dans une variable et le changer librement.

</details>

## `<@module $comp>` — composant dynamique

`<@module $comp>…</@module>` monte le composant dont **le nom (ou la classe) est la valeur de la variable**, choisie au runtime. Même syntaxe que `<@element>` : la première valeur après `<@module` *est* la variable, pas un attribut `component=`, et elle vient elle aussi toujours en premier, avant les attributs.

```html
<script>
  options = ['tuto-card-a', 'tuto-card-b', 'tuto-card-c']
  $comp = options[0]
</script>

<select value=!{$comp}>
  {for opt in options}
    <option value={opt}>{opt}</option>
  {end}
</select>

<@module $comp titre="Démo">
  Contenu projeté dans le composant monté
</@module>
```

`$comp` accepte soit un **nom de composant** en chaîne, soit une **classe/constructeur**. Le nom s'écrit comme ailleurs dans le framework, **sans le préfixe** : `'tuto-card-a'` monte `<mjs-tuto-card-a>`. Le nom complet (`'mjs-tuto-card-a'`) est accepté tel quel. Règle de reconnaissance : un nom reçoit le préfixe `mjs-` quand le projet connaît ce composant (déjà défini, ou présent au manifeste, donc chargé à la demande au premier affichage) ; sinon il reste tel quel — balise HTML native (`'section'`), élément personnalisé tiers (`'mon-widget'`). Une **balise HTML connue reste native**, même quand le projet a un composant du même nom : `'section'` crée `<section>`, jamais `<mjs-section>` ; ce composant-là s'écrit par son nom complet, `'mjs-section'`.

Les attributs posés sur `<@module>` sont transmis comme les attributs d'un composant écrit en dur : une valeur fixe (`titre="Démo"`) arrive en chaîne, une valeur entre accolades (`ids={$trouvees}`, `badge={true}`, `rappel={$fn}`) arrive **avec son type** — tableau, objet, nombre, `false`, `null`, fonction —, les événements (`@copier={…}`) remontent, et `class`, `style`, `id`, `data-*`, `aria-*` restent des attributs de la balise du composant. Les enfants sont déplacés vers les slots du composant monté (light DOM → slots). Changer `$comp` **re-monte** un nouveau composant (démontage de l'ancien, montage du nouveau — pas de mise à jour en place), qui reçoit les valeurs courantes. Ensuite, chaque prop suit ses propres variables, comme sur un composant écrit en dur : changer `$t` repose `titre={$t}` seule — `ids` et `opts={ { u: $u } }` ne sont pas reposées, leurs effets dans le composant monté ne repartent pas. Les attributs globaux dynamiques (`title`, `hidden`, `slot`, `is`, `lang`, `layout`) arrivent eux aussi en props, pas en attributs de la balise — exactement comme sur un composant écrit en dur.

### Dans une boucle ou une condition

La première valeur est évaluée là où la balise est écrite : dans un `{for}`, elle peut lire la variable de la ligne, son index ou un champ — une variable, un accès de membre ou une expression sans espace (`f.comp`, `noms[i]`, `'tuto-card-'+f.k`) ; calculez une expression plus longue dans une dérivée. Les attributs voient eux aussi la ligne.

```html
<script>
  familles = [{ comp: 'tuto-card-a', nom: 'Un' }, { comp: 'tuto-card-b', nom: 'Deux' }]
  $trouvees = ['a', 'b']
</script>

{for f in familles}
  <@module f.comp titre={f.nom} ids={$trouvees}></@module>
{end}
```

Chaque ligne monte son composant ; un `<@module>` dans un `{if}` s'affiche à l'ouverture du bloc, même si sa variable ne change jamais. Une liaison `@class{…}` ou `@style.…` posée sur un `<@module>` ne suit pas le remplacement du nœud — ni dans une ligne, ni ailleurs : écrivez `class={…}` ou `style={…}`. Une ligne dont le composant change reste une ligne de la liste : ajout, retrait, déplacement et tri la suivent, avec ou sans clé (`by`).

> ⚠️ Une valeur **falsy** (`$comp = null`, `''`, `undefined`) ne monte **rien** : `<@module>` reste un espace vide, sans erreur — pratique pour un composant optionnel piloté par une condition (`$comp = $afficher ? 'tuto-card-a' : null`).

### Balises refusées

`<@element $tag>`/`<@module $comp>` ne créent jamais huit balises, même si la variable les désigne : `script`, `iframe`, `object`, `embed`, `base`, `link`, `meta`, `style` — leur contenu s'exécuterait ou chargerait une ressource externe dès que le texte des enfants s'y trouve déplacé. Le nœud existant reste en place et un avertissement est émis :

```
[ModularJS] <@element>/<@module> : balise « iframe » refusée — un élément dynamique ne peut pas devenir iframe ; pour l'autoriser explicitement : accept="iframe".
```

L'attribut `accept="…"` remplace ce pool par une **liste fermée** — une liste de noms séparés par des espaces, écrite en dur sur la balise (jamais une expression) : présent, seul un nom qu'il contient est créé, `iframe`/`script`… compris. Une balise absente de la liste est refusée, `div` inclus, avec un avertissement qui nomme la balise et la liste :

```html
<@element $tag accept="iframe">
  <iframe src={$url}></iframe>
</@element>
```

`accept="iframe"` autorise `iframe` et refuse tout le reste (`div` compris) ; sans `accept`, tout est créé sauf les huit balises du pool. `accept="iframe style"` autorise les deux noms à la fois ; la casse de `accept` comme des noms qu'il contient n'a pas d'importance (`accept="IFRAME"` fonctionne). Une valeur vide, une expression (`accept={$x}`) ou un nom qui n'est pas un nom de balise valide est une erreur de compilation.

Une balise hors de la liste avertit ainsi :

```
[ModularJS] <@element>/<@module> : balise « div » refusée — hors de la liste accept="iframe" ; quand accept est présent, seuls les noms qu'il liste sont créés.
```

Sur `<@module>`, la liste nomme des **tags de composants** plutôt que des balises HTML : `<@module $comp accept="mjs-graphique mjs-tableau">` ne monte que ces deux composants, utile quand le nom du composant vient de données. Le nom court et le nom complet valent la même chose, des deux côtés : `accept="graphique"` et `accept="mjs-graphique"` autorisent le même composant, que `$comp` vaille `'graphique'` ou `'mjs-graphique'`.

## `<@failed err reset>` — error boundary

`<@failed err reset>…fallback…</@failed>` est une **frontière d'erreur** : si un composant descendant plante (et n'a pas sa propre frontière), l'erreur **remonte** jusqu'ici et le fallback s'affiche à la place de l'arbre en échec. C'est un vrai bloc template compilé — `@click=reset` est donc un gestionnaire natif (plus de marqueur spécial) :

```html
<@flaky-component>

<!-- Si un descendant crashe sans frontière propre, l'erreur remonte ici. -->
<@failed err reset>
  <p class="boom">Oups ! {err.message}</p>
  <button @click=reset>Réinitialiser</button>
</@failed>
```

- `err` : l'objet d'erreur capturé (on lit `err.message`, etc.). Une valeur jetée qui n'est pas une `Error` arrive telle quelle : avec `throw 'texte'`, `err` est le texte et `err.message` vaut `undefined`. Seule une valeur vide (`throw null`, `throw undefined`, une promesse rejetée sans raison) arrive en `Error` dont le message est `null` ou `undefined` : `{err.message}` ne fait donc jamais échouer le repli.
- `reset` : une fonction qui **re-monte** l'arbre protégé (nouvelle tentative) ; à câbler typiquement sur `@click=reset`. Limite : un composant protégé posé dans une ligne d'un `{for}` de son parent (une liste de cartes) revient, après `reset`, sans la prop que le parent lui donnait, et ne la suit plus ensuite. Contournement : posez la frontière sur le composant qui contient le `{for}` (la liste) plutôt que sur la carte. L'erreur d'une carte remonte jusqu'à elle, et son `reset` remonte toute la liste, dont chaque carte retrouve sa prop et suit de nouveau la liste ; la liste repart, elle, de son état initial.

Comme dans `<@head>`, une interpolation écrite dans une balise du repli va **entre guillemets** (`title="{err.message}"`, `href="/x?p={$id}"`) : une valeur nue, une expression posée à la place d'un attribut ou un nom de balise calculé sont des **erreurs de compilation**, qui citent la ligne du `.mjs` et la forme correcte.

Les erreurs remontent vers la frontière **ancêtre** la plus proche : un composant sans frontière propre voit son erreur attrapée par la première `<@failed>` au-dessus de lui.

En SSR, une erreur sans `<@failed>` pour l'absorber fait échouer le rendu de la page entière, pas seulement l'affichage du composant fautif&nbsp;: voir [SSR](19-ssr.md).

### `retry` — limiter les réessais

`reset()` re-monte une instance fraîche du composant protégé, qui peut retomber dans la même erreur si elle est déterministe (un bug de construction, une donnée toujours invalide). `<@failed>` limite donc le nombre de réessais :

```html
<@failed err reset retry="3">
  <p class="boom">Oups ! {err.message}</p>
  <button @click=reset>Réinitialiser</button>
</@failed>
```

- Par défaut (`retry` absent), **un seul réessai** est autorisé : le fallback s'affiche au premier crash, `reset()` fonctionne une fois, et si l'instance neuve replante, le fallback s'affiche sans plus proposer de réessai qui fonctionne (sauf après un rétablissement, ci-dessous).
- `retry="N"` autorise `N` réessais (`retry="0"` interdit tout réessai, y compris le premier).
- Une fois la limite atteinte, le fallback reste affiché avec l'erreur ; `reset` ne fait plus rien (aucune construction supplémentaire), et un message est écrit dans la console pour signaler l'abandon.
- Le compte de réessais déjà consommés est propre à **chaque instance** : deux `<mjs-x>` distincts sur la page suivent chacun leur propre limite.
- Le compte repart de zéro après un **rétablissement voulu** : `reset` appelé pendant un geste de l'utilisateur — pendant que le navigateur distribue son clic, sa touche ou son toucher, comme `@click=reset` ou `@click={reset()}` sur « Réinitialiser » —, puis **deux secondes** vécues par l'instance neuve sans replanter. Un plantage survenu plus tard (une autre action, des heures après) retrouve alors tous ses réessais. Un `reset` appelé hors de ce geste — le repli qui relance seul le composant (`setTimeout(reset, 10)`), même quand l'utilisateur vient de cliquer ailleurs dans la page, un `reset` différé après le clic (une minuterie, une attente), ou un clic simulé par le code (`.click()`, `dispatchEvent`) — compte toujours pour la limite et ne remet jamais le compte à zéro : une erreur qui revient, quelle que soit sa période (à la construction, juste après le premier rendu, ou plusieurs secondes après chaque montage), arrête la relance à la limite au lieu de reconstruire le composant sans fin. Pour qu'un bouton « Réinitialiser » marche encore des heures après, appelez donc `reset` dans son gestionnaire de clic, pas après une attente.

<details>
<summary>🎓 <b>Pour débutants</b> — pourquoi attraper les erreurs&nbsp;?</summary>

Sans frontière, une erreur dans un composant peut casser tout l'affichage (écran blanc). Une `<@failed>` vous laisse afficher un message propre (« Oups ! ») et proposer un bouton « Réessayer » (`reset`) qui re-monte la partie en échec, sans recharger toute la page. Vous isolez ainsi les pépins à la sous-partie concernée.

</details>

## Récapitulatif

| Balise | Rôle |
|---|---|
| `<@window @event>` | Écouteurs/liaisons sur `window` (scroll, clavier global…), nettoyés au démontage |
| `<@document @event>` | Écouteurs sur `document` (ex. `selectionchange`) |
| `<@body @event>` | Écouteurs sur `document.body` + liaisons `@class{…}` / `@style.prop` / `--var` / `class=` statique |
| `<@html @event>` | Idem sur `document.documentElement` (`:root`) — theming global, dark-mode |
| `<@head>…</@head>` | Injection réactive dans `document.head` (titre, meta, styles, polices) |
| `<@element $tag>…</@element>` | Élément dont la balise = la variable (choisie au runtime) |
| `<@module $comp>…</@module>` | Composant dont le nom/la classe = la variable (choisie au runtime, falsy = rien) |
| `<@failed err reset retry="N">…</@failed>` | Frontière d'erreur ; `err` = l'erreur, `reset` re-monte l'arbre ; `retry` limite les réessais (défaut 1) |

---

📚 **Apprendre en pratiquant** : ce chapitre correspond à la section **Éléments spéciaux** du tuto interactif — `<@window>` (et ses liaisons), `<@document>`, `<@body>`, `<@html>`, `<@head>`, `<@element>`, `<@failed>`.
