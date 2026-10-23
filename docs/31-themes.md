# 31 · Thèmes, variables & modèles

> 📚 À lire après [8 · Classes & styles](08-class.md) : ce chapitre traite de ce qui *traverse* les composants — les valeurs de style partagées — là où le chapitre 8 traite du style d'un élément. Les encarts 🎓 *Pour débutants* dépliables donnent l'explication pas-à-pas ; le corps de la page reste la référence dense.

Trois idées, et tout le reste en découle :

1. **Une variable de thème** (`$$brand`) est une valeur de style qui a un nom.
2. **Un thème** est un paquet de variables posé sur un élément.
3. **Le plus proche gagne** : un composant lit la valeur du thème le plus proche au-dessus de lui.

Un thème peint **vers le bas**, jamais autour ni au-dessus. Poser un thème sur une section n'affecte que cette section et sa descendance — y compris les composants imbriqués, à travers les frontières Shadow DOM.

## Le bloc `<theme>` — les valeurs à part des règles

Un composant a deux blocs pour son apparence et son comportement : `<script>` et `<style>`. En voici un troisième, `<theme>`, pour les **valeurs** sur lesquelles cette apparence repose — une couleur de marque, un fond, un arrondi. Écrites une fois, lues partout en dessous.

```html
<theme>
  --panel-bg:     #1b2230
  --panel-fg:     #e8eaed
  --panel-accent: #3b82f6
</theme>

<style>
  :host
    background: var(--panel-bg)
    color: var(--panel-fg)
    border: 1px solid var(--panel-accent)
</style>
```

Un bloc **plat**, une déclaration par ligne, aucun sélecteur à écrire : c'est ModularJS qui accroche le bloc à l'hôte du composant. Et chaque ligne est une **variable CSS ordinaire** — deux tirets, un nom, une valeur : rien d'inventé, c'est le mécanisme que le navigateur connaît déjà, le bloc lui donne seulement un endroit à lui.

L'intérêt n'est pas la syntaxe, il est dans la **séparation** : les valeurs d'un côté, les règles de l'autre. Changer la palette d'un composant ne demande plus de relire une seule de ses règles.

> ℹ️ **Pourquoi pas simplement `:host` ?** Écrire `:host { --panel-bg: #1b2230 }` dans le `<style>` pose exactement la même variable. Le bloc `<theme>` gagne sa place plus loin : c'est *lui* qu'un **thème nommé** remplace (plus bas dans ce chapitre), et *lui* que contient un fichier de thème de document. Les valeurs vivant à part des règles, les échanger ne touche aucune règle.

### Ça descend — *y compris* dans les sous-composants

Une variable posée sur un élément cascade dans **toute** sa descendance. Le Shadow DOM arrête les *règles* venues du document ; il n'arrête pas les *valeurs* d'une variable. Une carte enfant qui écrit `background: var(--panel-bg)` dans son propre `<style>` reçoit donc la valeur posée par le parent, sans rien déclarer elle-même — c'est tout le mécanisme des thèmes. Et comme c'est une cascade, n'importe quel niveau intermédiaire peut la redéclarer pour lui et ses enfants.

> ⚠️ **Déclarations seulement.** Dans un `<theme>`, on écrit des déclarations, jamais un sélecteur ni une règle : une règle qui doit viser une *partie* du composant reste dans le `<style>`. Le bloc ne rend rien à l'écran — il ne fait que poser des valeurs.

## La variable de thème `$$nom`

Écrire `--panel-bg` puis `var(--panel-bg)` deux lignes plus bas est verbeux, et rien ne prévient d'une faute de frappe. ModularJS a une écriture pour ça : dans un contexte de style (un bloc `<style>` ou un bloc `<theme>`), `$$nom` est une **variable de thème** — le même mot pour déclarer et pour lire, et le build sait la recenser :

```html
<style>
  :host
    background: $$surface
    color: $$fg
    gap: $$gap-small
</style>
```

`$$surface` compile en `var(--mjs-surface)`. Le nom est repris tel quel, sans transformation de casse (`$$fg-muted` → `--mjs-fg-muted`), les tirets internes sont permis (jamais en fin de nom).

**Un seul préfixe pour tout le monde.** `$$gap` donne `--mjs-gap` quel que soit le composant qui l'écrit : deux composants qui déclarent `$$gap` parlent bien de la **même** variable. C'est voulu — une variable de thème n'appartient à personne, elle cascade, et chacun peut la redéfinir pour sa descendance.

> ⚠️ Dans un `<script>`, `$$x` reste le **store global** (chapitre [14 · Stores](14-stores.md)). Le sens dépend du bloc : style ou logique, jamais d'ambiguïté.

La réécriture a lieu **avant** le compilateur SASS, et elle respecte deux frontières : ce qui est dans une chaîne (`content: "$$literal"`) et ce qui est dans un commentaire n'est jamais touché.

<details>
<summary>🎓 <b>Pour débutants</b> — pourquoi pas écrire <code>var(--mjs-surface)</code> directement&nbsp;?</summary>

Vous pouvez : `$$surface` n'est qu'une écriture plus courte de la même chose, et le CSS produit est identique. Mais le compilateur, lui, ne voit passer que ce qu'il reconnaît. Écrire `$$surface` lui permet de tenir un **registre** : qui déclare cette variable, qui la lit, et — surtout — de vous prévenir quand vous lisez un nom que *personne* ne déclare (une faute de frappe donne une valeur vide à l'écran, ce qui est très difficile à voir).

</details>

## Déclarer : le bloc `<theme>`

Une variable se **déclare** avec un `$$nom` en tête de ligne — rien d'autre que du blanc avant lui sur la ligne, et un `:` juste après ; partout ailleurs sur la ligne, c'est une lecture, ce qui permet de dériver une variable d'une autre. Ça vaut dans **tous** les contextes de style : un bloc `<theme>`, un bloc `<style>` (nommé ou non), un fichier `*.theme.mjs`. Le sens est celui du CSS : déclarer dans un sélecteur pose la variable sur ce qui matche ce sélecteur, et ça cascade vers le bas.

Le bloc `<theme>` est l'endroit naturel pour les valeurs de base d'un composant :

```html
<div class="card"><slot></slot></div>

<theme>
  $$gap:     12px
  $$brand:   #3b82f6
  $$hover:   $$brand
</theme>

<style>
  :host
    display: grid
    gap: $$gap
    border: 1px solid $$brand
</style>
```

Le bloc sans nom est le thème **de base** du composant : ses variables sont posées sur l'hôte, donc valables pour lui **et pour toute sa descendance**. Un composant enfant qui lit `$$brand` sans jamais l'avoir déclaré recevra celui-ci.

> ℹ️ Le CSS d'un `<theme>` sort **avant** celui du `<style>` du même composant, sur un sélecteur de spécificité nulle : vous pouvez surcharger sans jamais vous battre contre lui.

### Surcharger depuis `<style>`

La même écriture déclare tout aussi bien dans un `<style>` : un `$$nom:` en tête de ligne y pose `--mjs-nom` sur ce que matche le sélecteur au-dessus, et ça cascade vers sa descendance comme n'importe quelle déclaration CSS :

```html
<style>
  strong
    color: $$panel-accent

    &.alt-accent
      $$panel-accent: #f472b6
</style>
```

`.alt-accent` surcharge ici `$$panel-accent` pour lui-même et sa descendance ; ailleurs dans le composant, la variable garde la valeur reçue d'un thème de base ou de document.

> ⚠️ Une déclaration a besoin d'un **sélecteur** au-dessus d'elle. Écrite à la racine d'un `<style>`, sans rien devant, elle n'a rien sur quoi s'accrocher : le compilateur refuse le build et vous dit quoi faire — `$$gap est déclaré à la racine du <style> (ligne 2) — une surcharge a besoin d'un sélecteur (:host, une classe…) pour s'accrocher.` Rangez la ligne sous un sélecteur, ou déclarez la variable dans un `<theme>` si elle doit valoir pour tout le composant.

> ⚠️ Dans la **valeur** d'une déclaration, une variable SASS ordinaire (un seul `$`) n'est pas substituée : `$$brand: $primary` sort littéralement `$primary` dans le CSS produit. Il faut l'interpoler : `$$brand: #{$primary}`.

### Le même nom, un seul `$` : la valeur au build

Une variable déclarée dans le `<theme>` **sans nom** expose aussi son nom au SASS. Dans le `<style>` du même composant, `$accent` vaut alors ce que `$$accent` a été déclaré valoir :

```html
<theme>
  $$accent:  #3b82f6
  $$tailles: 4px, 8px
</theme>

<style>
  @each $t in $tailles        // une vraie liste SASS : deux tours
    .gap-#{$t}
      gap: $t

  .carte
    color: $accent            // #3b82f6, résolu au build
    border-color: $$accent    // var(--mjs-accent), résolu par le navigateur
</style>
```

Un seul `$` pour ce que le build doit **parcourir**, **comparer** ou passer à une fonction ; deux `$` pour ce qui doit rester **vivant** dans le navigateur. Le nom, lui, ne change pas.

Quatre bornes, toutes voulues :

- **La valeur est celle de la déclaration à la RACINE du bloc**, figée au build. Une surcharge — thème nommé, `&.chaud` *à l'intérieur du même `<theme>`*, thème de document, `µtheme` — ne la change pas : c'est précisément la différence entre les deux écritures.
- **Seul le bloc sans nom nourrit le `$`.** Un `<theme name="gold">` ne vaut que quand il est actif ; le figer au build donnerait une valeur arbitraire.
- **Une variable SASS déclarée à la racine du `<style>` garde la main.** `$gap: 2px` écrit sans rien au-dessus bat le `$$gap` du thème : c'est la portée SASS ordinaire. Le même `$gap: 2px` écrit *sous un sélecteur* reste local à ce sélecteur et ne prive pas le reste du bloc de la valeur du thème.
- **Un `$x` sans `$$x` derrière échoue comme avant** — *Undefined variable*. Rien de nouveau n'est silencieux.

> ⚠️ Dans l'autre sens, SASS ne **lit** jamais un `$$` : il n'en voit que la chaîne `var(--mjs-…)`. Comme **valeur**, ça marche partout — imbriqué, répété dans une boucle, glissé dans un `calc()` ou une interpolation. Comme **donnée du build**, non : `@each $t in $$tailles` tourne un SEUL tour avec la chaîne pour tout contenu (muet tant que `$t` reste une valeur ; `expected selector` dès qu'il sert à construire un sélecteur, `.badge-#{$t}`), et `@if $$accent == #3b82f6` est toujours faux — la règle entière disparaît du CSS, sans un mot. Seul un appel de fonction de couleur échoue franchement (`var(--mjs-accent) is not a color`). **Le remède tient en un caractère** : retirez un `$`.

> ⚠️ Un commentaire `//` en **fin de ligne de déclaration** est retiré par ModularJS avant dart-sass. Il le fallait : dart-sass ne parse pas la valeur d'une custom property, le commentaire y survivait, la valeur devenait invalide et le `var()` qui la lisait retombait muettement à sa valeur initiale. Un commentaire `/* … */`, lui, est du CSS valide et reste dans le fichier produit — c'est le navigateur qui l'écarte.

## Les thèmes nommés d'un composant : `theme="…"`

> ⚠️ **Le même mot peut désigner deux mécanismes, et c'est le document qui gagne.** `theme="gold"` sur un composant qui déclare AUSSI un `<theme name="gold">` déclenche les deux : le thème nommé du composant (dans une feuille du shadow) et le thème de document (dans la feuille du document). Pour toute variable déclarée des deux côtés, **c'est celle du document qui s'applique** — mesuré Chromium et Firefox. Ce n'est pas une affaire de spécificité (les deux sélecteurs sont en `:where()`, spécificité nulle des deux côtés) mais d'**ordre d'arbre** : entre deux déclarations normales qui visent le même élément, celle de l'arbre extérieur gagne, quelles que soient les spécificités. Le thème propre du composant devient sans effet visible, sans un mot. Deux issues : deux noms distincts, ou poser le thème de document sur une zone autour du composant.
>
> **Pourquoi l'encapsulation ne protège pas ici.** La balise `<mjs-carte>` **appartient au document** — le Shadow DOM ne contient que son *contenu*. Une règle de la page peut donc toujours viser l'hôte (`mjs-carte { … }`, `[theme='gold'] { … }`), et c'est exactement ce que fait un thème de document. Le `:host(…)` du composant vise le **même élément**, mais depuis l'arbre intérieur : entre les deux, le navigateur départage par contexte d'arbre, pas par précision. Mesuré Chromium et Firefox sur cinq formes de sélecteur : `:where()`, sélecteur nu, spécificité triplée, `@layer` — le document gagne les quatre ; seul `!important` renverse. La feuille des thèmes de document est bien adoptée *aussi* dans chaque Shadow DOM (c'est ce qui fait marcher un `<div theme="sombre">` **écrit à l'intérieur** d'un composant), mais cette copie-là ne peut pas viser l'hôte : un sélecteur de shadow ne franchit jamais la frontière vers le haut. Et si la variable finit quand même par descendre dans le shadow, c'est par **héritage** — une variable CSS se transmet de parent à enfant, frontière comprise.

> Le nom peut être **dynamique** : `theme={$x}` posé en prop par le parent est reflété sur l'attribut de l'hôte, exactement comme `layout={$x}` l'est sur le variant de forme. Une valeur vide retire l'attribut et rend la main au bloc sans nom. Un composant qui déclare lui-même un état `$theme` (un usage métier, sans rapport avec le style) garde la main : rien n'est reflété.

Un composant peut déclarer des paquets alternatifs, activés par l'attribut `theme` sur l'instance :

```html
<theme>
  $$brand: #3b82f6
</theme>

<theme name="gold">
  $$brand: #d4af37
</theme>
```

```html
<mjs-card>une carte ordinaire</mjs-card>
<mjs-card theme="gold">une carte dorée</mjs-card>
```

Autant de blocs nommés que vous voulez, un seul par nom, un seul bloc sans nom. Les noms s'écrivent en minuscules, chiffres et tirets (ils finissent en sélecteur d'attribut).

> ⚠️ `theme` est un **nom d'attribut réservé par convention** : il reste lisible comme prop, mais le framework s'en sert déjà — lui donner un autre sens dans votre composant marchera en apparence, puis se mettra en travers du jour où l'instance porte un vrai thème. Rien ne vous en empêche à la compilation : c'est une règle d'usage, pas une garde.

## Les thèmes du document : `*.theme.mjs`

Un fichier dont le nom finit par `.theme.mjs` n'affiche jamais rien : ce n'est pas un composant. C'est un pot de variables tout prêt, à poser où on veut sur la page — un **thème de document**. Il ne contient qu'un bloc `<theme>`, et son nom **vient du nom du fichier** : `dark.theme.mjs` donne un thème qui s'appelle `dark`, sans rien écrire de plus.

```html
<!-- app/modularjs/dark.theme.mjs -->
<theme>
  $$surface:  #232936
  $$fg:       #e8eaed
  $$fg-muted: #9aa3af
  $$border:   #3a4150
</theme>
```

Ce fichier ne fait qu'une chose : **préparer** un jeu de couleurs sous le nom `dark`. Pour l'utiliser, on pose l'attribut `theme="dark"` sur un élément de la page — n'importe lequel, pas seulement `<html>`. Tout ce que cet élément contient en hérite, comme une pièce qu'on repeint : la couleur change pour la pièce entière, murs et meubles compris (les composants imbriqués aussi) :

```html
<body>
  <p>page claire</p>
  <section theme="dark">
    <p>cette section est sombre — et tout ce qu'elle contient</p>
    <mjs-card>y compris les composants imbriqués</mjs-card>
  </section>
</body>
```

On peut donc imbriquer les thèmes autant qu'on veut : une section sombre dans une page claire, une carte dorée dans cette section sombre — chacun repeint sa propre zone, sans toucher au reste de la page.

Le thème **par défaut** (`defaultTheme`, `light` sauf réglage) vaut en plus **sans attribut** : c'est ce que voit une page nue, sans qu'on ait rien à écrire.

Tous les fichiers `*.theme.mjs` du projet sont réunis par le build en **un seul bloc CSS**, livré avec le manifeste et prêt dès le démarrage — aucune requête réseau, jamais un fichier séparé par thème. (Les thèmes nommés d'un composant, `<theme name="gold">`, voyagent dans le module du composant lui-même ; seuls les variants — `<style name="…">` + `layout=`, plus loin dans ce chapitre — sortent dans un fichier à part, chargés quand ils servent.)

### Un thème est un calque, pas une copie

Pensez à un rétroprojecteur : une feuille transparente posée sur une image de fond. La feuille ne porte que quelques traits ; là où elle est vide, on voit le fond à travers. Un thème fait pareil : il n'émet **que ce qu'il déclare lui-même**, jamais une copie de ce qui l'entoure — le reste continue de descendre depuis au-dessus, comme si la feuille était transparente à cet endroit.

```html
<!-- app/modularjs/gold.theme.mjs -->
<theme>
  $$brand: #d4af37
</theme>
```

Ici, `gold` ne déclare qu'une seule variable, `$$brand`. Posé sur une zone déjà sombre, il n'ajoute que l'accent doré ; le fond sombre, lui, continue de venir de `dark` :

```html
<body theme="dark">
  <article theme="gold">fond sombre hérité + accents or</article>
</body>
```

Un thème de trois lignes est donc un **calque d'accent posable sur n'importe quel fond** — et rien ne l'attache à un fond en particulier.

## Thèmes imbriqués

Les thèmes s'emboîtent sans limite, et **le plus proche gagne** :

```html
<body theme="dark">
  <section theme="light">
    <mjs-card>claire</mjs-card>
    <div theme="gold"><mjs-card>claire + accents or</mjs-card></div>
  </section>
</body>
```

Chaque cran redéfinit ce qu'il déclare, variable par variable. Les thèmes se superposent comme des calques : ils ne se remplacent pas en bloc.

## Ce qui traverse, et les deux surprises

- **L'héritage traverse le Shadow DOM.** Un composant qui n'a jamais entendu parler de `$$gap` reçoit la valeur posée par un ancêtre, même à travers plusieurs frontières d'encapsulation. C'est le mécanisme natif des variables CSS, pas une machinerie MJS.
- **Un élément « slotté » suit le composant qui l'accueille**, pas celui qui l'écrit. Le style suit l'arbre *aplati* :

  ```html
  <mjs-panel theme="dark">
    <p>ce paragraphe est peint par mjs-panel, même s'il est écrit ici</p>
  </mjs-panel>
  ```

- **Une règle du document bat une règle interne au composant**, quelles que soient les spécificités : le contexte d'encapsulation est un critère de cascade prioritaire. Concrètement, un thème de document qui déclare `$$brand` l'emporte sur le `<theme>` de base d'un composant qui déclare le même nom. Pour qu'une variable reste privée, ne lui donnez pas un nom que l'application utilise.

## `layout` : les modèles d'un composant

`layout="x"` choisit un **modèle** du composant — le même composant, une autre forme. Selon ce que le modèle change, il vit à trois endroits, du plus léger au plus lourd :

| Le modèle change… | Où il vit | Exemple |
|---|---|---|
| le style seulement | dans le fichier, un `<style name="x">` (un **variant**), chargé seulement s'il sert | `<@carte layout="banner">` |
| un détail du HTML | dans le fichier, un bloc `{? nom}` (lu aussi par `µlayout`) | `<@@clock layout="timer">` |
| toute la structure | son propre fichier, `carte.compacte.mjs` à côté de `carte.mjs` | `<@carte layout="compacte">` |

On écrit toujours un nom et un `layout` ; chaque fichier reste « un HTML, un style, un script » ; seul ce qui sert part dans la page. Les modules du cœur suivent la même règle : `layout` partout (`<@@switch layout="triangle">`, `<@@tabs layout="curve">`, `<@@menu layout="drawer">`…).

### Le style seulement : les variants, `<style name="…">`

Un thème porte des **valeurs** (couleurs, espacements, rayons). Un variant porte des **règles** — une grille différente, un ordre inversé, un élément masqué. Les deux axes sont perpendiculaires et cumulables :

```html
<style>
  :host
    display: grid
    grid-template-columns: 1fr
</style>

<style name="banner">
  :host
    grid-template-columns: 240px 1fr
    align-items: center
  .thumb
    aspect-ratio: 16 / 9
</style>
```

```html
<mjs-card layout="banner" theme="gold">forme bandeau, couleurs or</mjs-card>
```

Le build sort chaque variant dans un fichier à part, **chargé seulement quand il sert** — c'est là que le chargement à la demande a du sens : un variant pèse des kilo-octets de règles, là où une déclinaison de couleurs tient en quelques variables embarquées. Le fichier est mis en cache par URL, une seule fois pour toutes les instances.

Un nom de variant que le composant ne déclare pas n'est jamais laissé passer, mais le moment du refus dépend de l'écriture :

- **écrit en dur** (`layout="bannner"`) — le compilateur connaît la liste des variants du composant : le **build échoue**, en nommant le fichier fautif, le nom demandé et les noms connus. Rien ne part en production ;
- **calculé** (`layout={$forme}`) — invérifiable au build : à l'exécution, le composant **part en erreur** par le système d'erreur du framework (la boundary [`<@failed>`](15-elements-speciaux.md) la plus proche, ou le panneau fatal), sans **aucune requête réseau**. Une mise en page silencieusement fausse coûte plus cher qu'un crash visible.

> ⚠️ `layout` est, comme `theme`, un nom d'attribut réservé par convention — même règle, même absence de garde à la compilation.

### Un détail du HTML : `{? nom}`

Quand un modèle change un morceau du HTML, le bloc `{? nom}` le réserve à ce modèle :

```html
<script>
  $secondes = 60
</script>

{? timer}
  <b class="compte">{$secondes}</b>
{? chrono, minuteur}
  <b class="compte">{$secondes * 1000}</b>
{? default}
  <span class="cadrans">…</span>
{else}
  <span class="autre">…</span>
{end}
```

```html
<@horloge layout="timer"></@horloge>
```

- `{? a, b}` : plusieurs modèles ; `{? default}` : la balise ne choisit aucun modèle ; `{else}` : tous les autres. Dans le bloc, chaque `{? …}` ouvre la branche suivante ; placé dans un autre bloc (`{if}`, `{for}`…), il en ouvre un nouveau.
- Chaque nom est un modèle **connu** du composant, comme un variant : écrit en dur sur une balise, il est vérifié au build (un nom inconnu cite les noms connus) ; choisi, il ne charge aucun fichier.

Le script, lui, lit le modèle choisi dans `µlayout` — `default` quand la balise n'en choisit aucun : `@texte = -> if µlayout is 'timer' then 'minuteur' else 'horloge'`. `{? timer}` est l'écriture courte de `{if µlayout is 'timer'}`. `µlayout` suit la balise (`layout={$forme}` compris) et **se lit seulement** — le modèle se choisit sur la balise, jamais depuis le composant. Un composant qui a déjà sa propre variable `$layout` ne peut pas s'en servir : le build le dit.

### Toute la structure : un fichier par modèle

Quand un modèle change tout, il a **son fichier** : `carte.compacte.mjs` à côté de `carte.mjs`, un composant complet (HTML, style, script). `<@carte layout="compacte">` prend ce fichier — le build écrit à sa place la balise du modèle, `<mjs-carte--compacte>` ; `<@carte>` sans `layout` reste le composant de base. Les deux reçoivent les mêmes attributs ; ce qu'ils ont en commun (des fonctions, des règles) va dans un module que chacun importe (`@import ouvrir fermer 'carte-commun.civet'`, cf. [2 · Composant](02-composant.md)).

Choisi par une variable (`<@carte layout={$vue}>`), le compilateur écrit le `{if}` à votre place : la balise du modèle quand la valeur est son nom, sinon le composant de base. Quand la valeur change, la carte est **reposée** — ce qu'elle avait en cours (un texte tapé dedans, une animation) repart de zéro ; un modèle du même fichier (style nommé, `{? nom}`), lui, change sans rien reposer. Le build refuse un modèle sans son composant (`fiche.compacte.mjs` seul), un même nom à la fois fichier et `<style name>`, et un modèle nommé `default`, en fichier (`carte.default.mjs`) comme en style nommé (`<style name="default">`) : `default`, c'est le composant lui-même, celui de `{? default}`.

<details>
<summary>🎓 <b>Pour débutants</b> — thème ou variant, comment je choisis&nbsp;?</summary>

Posez-vous une seule question : *est-ce que je change des valeurs, ou est-ce que je change la structure&nbsp;?*

Une carte plus sombre, avec un accent doré et des coins plus ronds : ce sont des **valeurs**, donc un thème — et il repeindra aussi les composants qu'elle contient, ce qui est généralement ce que vous voulez.

La même carte affichée en bandeau horizontal, vignette à gauche, résumé masqué : ce sont des **règles de mise en page**, donc un variant — et il reste dans la carte, sans déborder sur ses enfants.

</details>

## Changer de thème à l'exécution : `µtheme`

```html
<button @click={µtheme = 'dark'}>passer en sombre</button>
```

La rune `µtheme` écrit l'attribut de thème sur la racine du document et retient le choix. Elle accepte tout thème **déclaré au build** (plus `light` et `dark`, toujours connus) ; un nom inconnu est refusé avec un avertissement qui liste les noms disponibles.

Quand la bascule suit un clic, le nouveau thème **s'ouvre en cercle** depuis le point cliqué (une demi-seconde, par une transition de vue du navigateur) ; sans geste (le système, votre code), il s'applique d'un coup. `"effects": { "theme": "none" }` dans `mjs.config.json` : toujours d'un coup — cf. [38 · Effets](38-effets.md#ce-que-mjs-fait-de-lui-même).

`light`/`dark` reposent sur 8 variables embarquées par le framework (`surface`, `fg`, `fg-muted`, `border`, `hover`, `selected`, `accent`, `shadow`) — le même mécanisme `--mjs-*` que `$$nom`, déjà posé pour vous. Ces variables ne sont jointes au bundle que si le projet les lit (`$$surface`, `var(--mjs-fg)`…), pose `µtheme`, déclare un fichier de thème, ou sélectionne une bulle/modale (`title`/`modal` — les deux seuls modules du framework qui en lisent une). Une page servie **hors construction** (vue serveur, HTML statique) qui les lit sans qu'aucune source compilée ne le révèle reste invisible au scan : `"runtime": ["theme"]` la force, comme pour `title`.

## Réglages (`mjs.config.json`)

| Clé | Défaut | Effet |
|---|---|---|
| `varPrefix` | `mjs` | Préfixe des variables : `$$brand` → `--<varPrefix>-brand` |
| `defaultTheme` | `light` | Thème qui vaut sans attribut |
| `effects.theme` | `circle` | Une bascule qui suit un clic s'ouvre en cercle ; `none` : d'un coup |

> ⚠️ Changer `varPrefix` **isole** les variables de votre application de celles du framework, qui restent en `--mjs-*` : vos thèmes cessent alors de repeindre les modules cœur. À laisser tel quel sauf raison précise.

## Ce que le build vous dit

À chaque compilation, le registre des variables produit deux niveaux de retour :

- **avertissement** — une variable lue que *personne* ne déclare (ni un composant, ni un thème, ni le framework) : c'est presque toujours une faute de frappe, et le symptôme est une valeur vide, difficile à repérer à l'œil ;
- **information** — une variable déclarée par au moins deux composants : rien d'anormal, juste un rappel que cette variable cascade et que le plus proche l'emporte.

## L'atelier des variables de thème

Deux routes, servies aussi bien par `mjs dev` que par `mjs serve`, donnent accès en direct au registre des variables du projet : `GET /__mjs/theme` (une page) et `GET /__mjs/theme.json` (les mêmes données en JSON). En clair : `http://127.0.0.1:3939/__mjs/theme` en `mjs dev`, `http://127.0.0.1:3000/__mjs/theme` en `mjs serve`.

> ⚠️ Outil de développement : ces routes sont fermées dès que la commande tourne avec `--prod`, et aussi quand `NODE_ENV=production` est posé, même sans `--prod` — disponibles partout ailleurs. Aucune clé de configuration à activer.

La page est compilée à la volée par le serveur de développement et partage le cœur de votre application. Un build de développement embarque donc ce qu'elle appelle (mutations profondes, listes, blocs `{if}`, crochets de vie), même si aucun de vos composants n'en a besoin ; un build `--prod` n'en prend rien, et un cœur nu (`runtime: []`) reste nu.

La page affiche, en tête, le nombre de sources, de variables, de déclarations, de valeurs par défaut de composants et, quand il y en a, de variables posées par un composant, puis un champ de recherche et un filtre par **nature** (`module`, `theme`, `framework`, `stylesheet`). En dessous, la liste est rangée **par source** : un groupe par endroit qui déclare — un fichier de thème, une variante de ce fichier, un composant, une feuille partagée, le framework — avec son étiquette de nature, son nom, sa variante s'il en a une, son chemin et le nombre de variables qu'il porte. Chaque ligne d'un groupe de déclarations est une déclaration : le nom de la variable, une pastille de sa couleur quand la valeur en est une (hexadécimal, `rgb`, `hsl`, `oklch`), la valeur, le numéro de ligne (« ligne inconnue » pour une déclaration de CSS brut dont la ligne n'est pas relevée), et combien d'endroits la lisent. Une variable déclarée à plusieurs endroits a une ligne dans chacun des groupes concernés, chacune indiquant combien d'autres déclarations existent ailleurs. Déplier une ligne montre le commentaire de documentation quand il y en a un, les autres déclarations du même nom avec leur fichier et leur ligne — c'est le plus proche qui gagne — et la liste complète des lecteurs.

**Les valeurs par défaut des composants.** Un composant qui lit une variable avec un défaut, `var(--mjs-check-size, 20px)`, sans la déclarer — c'est le cas de la case, de l'interrupteur, du radio, du sélecteur et de plusieurs autres modules du cœur — a son propre groupe, étiqueté « valeurs par défaut » et en lecture seule. Une ligne y porte le nom, le défaut tel qu'il est écrit (une cascade garde son texte entier : `var(--mjs-accent, #3b82f6)`), la mention « par défaut » à la place d'un numéro de ligne, et combien d'endroits la lisent : ce n'est pas une déclaration, il n'y a rien à réécrire dans un source. Déplier la ligne dit quel composant la lit, avec quel défaut, et comment la régler : déclarer le nom dans le thème de l'application, sur `:root` ou sur un ancêtre du composant. Quand le nom est aussi déclaré quelque part, ces déclarations sont listées, et la plus proche du composant l'emporte sur le défaut. 
**Les variables posées par le composant.** Un composant qui pose lui-même une variable qu'il lit — celle que son script écrit (`style.setProperty('--mjs-x', …)`), celle que son gabarit écrit (`--mjs-x={…}`, `style="--mjs-x: …"`), celle que son propre CSS pose sur un de ses éléments internes ou sur `::slotted(*)` — a un groupe « posées par le composant », replié au départ, en lecture seule, sans sélecteur de couleur. Un bouton dans l'en-tête du groupe le déplie ; une recherche en cours le déplie aussi. Une ligne y porte le nom et la valeur, et déplier la ligne dit que le composant pose cette variable lui-même : ce que vous déclarez dessus peut ne rien changer, quand la valeur posée par le composant l'emporte. Elle reste dans le registre parce que le thème de l'application peut parfois l'atteindre : le gabarit qui pose `--mjs-x={$w}` avec un `$w` non défini ne pose rien, et la valeur venue du dehors s'applique. Une variable posée sur l'hôte (`:host`, `:host(.on)`) n'est pas de ce groupe : le thème de l'application l'atteint, c'est une déclaration ordinaire.

La jumelle JSON renvoie, pour chaque variable, `declarations` (chacune avec `value`, `declaredBy`, `kind`, `variant`, `file`, `line`, `doc`) et `readBy` (la liste des lecteurs : les composants dont le CSS la lit, avec ou sans défaut, et ceux qui la lisent en `$$`). Une valeur par défaut lue par un composant est une entrée de `declarations` de plus — `kind` à `module`, `line` à 0, `doc` vide — qui porte en plus `read: true` ; une vraie déclaration n'a pas ce champ. Une entrée, lecture ou déclaration de CSS brut, que le composant pose lui-même porte `set: true`.

Le registre est calculé **au build** et déposé à côté des fichiers émis (`.mjs-theme-vars.json`), en développement seulement : il nomme les fichiers sources du projet, et un build de production ne l'écrit pas. Un module du cœur y est nommé `modularjs/core-modules/<nom>.mjs`, le même sur toutes les machines, jamais par le chemin où le framework est installé ; ce n'est pas un fichier du projet, et l'atelier n'y écrit pas. Celui qu'un `mjs dev` ou un build sans `--prod` a laissé dans le même dossier est retiré par le build de production, une fois réussi ; un fichier de ce nom qui n'a pas la forme du registre (un fichier à vous, peut-être) reste en place, et un avertissement le nomme. La page ne fait que le lire, aucun calcul à l'ouverture. Un projet qui ne déclare ni ne lit aucune variable de thème — ni bloc `<theme>`, ni `$$`, ni lecture avec défaut, celles des modules du cœur comprises — n'écrit aucun registre : la route renvoie `{}` et la page l'indique, ce qui est normal.

À quoi ça sert : voir d'un coup d'œil ce que le projet expose comme variables, retrouver qui déclare une couleur qu'on n'arrive pas à situer, et repérer une variable déclarée deux fois ou plus sans jamais être lue.

## Changer une couleur en direct

Quand l'atelier est servi par `mjs dev`, chaque variable dont la valeur est une couleur convertible en hexadécimal porte un sélecteur de couleur — une valeur par défaut de composant aussi, quand son défaut est une couleur (`#fff`, `rgba(…)`) ; une cascade comme `var(--mjs-accent, #3b82f6)` n'en porte pas. Choisir une teinte la pousse immédiatement à **toutes les pages ouvertes du projet** : pas de recompilation, pas de rechargement, pas de remplacement de feuille de style. La variable voyage sur le WebSocket du rechargement à chaud, par un canal distinct nommé `theme-vars`, qui ne transporte que des variables. Un témoin en tête de page indique si ce canal est vivant et combien de pages écoutent ; sans serveur de développement, l'atelier reste en lecture seule.

Tant que l'interrupteur **Enregistrer dans le source** est au repos, rien n'atteint le disque : fermer l'onglet remet tout en place, et le bouton « Rétablir » rend à chaque variable sa valeur compilée.

Armé, l'interrupteur envoie chaque couleur choisie dans le fichier qui la déclare, à la ligne exacte : seule la tranche de la valeur est réécrite, l'indentation, le commentaire de fin de ligne et le reste du fichier étant recollés octet pour octet. Attention, « Rétablir » ne défait alors que l'aperçu — ce qui est écrit reste écrit. La cible est la ligne **du groupe où l'on choisit la couleur** : une variable déclarée dans un thème clair et dans un thème sombre a une ligne dans chacun des deux, et chacune écrit dans la sienne. Déplier la ligne affiche la cible, fichier et numéro de ligne, avant d'écrire (quand la ligne n'est pas relevée, la cible dit que la ligne est cherchée dans le fichier, et l'écriture refuse s'il y a zéro ou plusieurs candidates) ; un groupe qui appartient au framework, ou qui ne porte que des valeurs par défaut de composants ou des variables posées par un composant, est en lecture seule et le dit : choisir une couleur sur une valeur par défaut repeint les pages ouvertes sans rien écrire. L'aperçu en direct, lui, travaille par **nom** : il repeint d'un coup toutes les déclarations d'une même variable, ce que la ligne rappelle dès qu'il y en a plus d'une.

> ⚠️ Outil de développement, verrouillé de trois façons : la route d'écriture répond 404 dès que le serveur tourne en production, 403 quand la requête ne vient pas d'une origine locale, et la valeur passe un crible en **liste blanche de formes** : un hexadécimal de 3 à 8 chiffres, l'une des douze fonctions de couleur CSS (`rgb`, `rgba`, `hsl`, `hsla`, `hwb`, `lab`, `lch`, `oklab`, `oklch`, `color`, `color-mix`, `var`) avec des arguments d'un jeu de caractères restreint, ou un mot-clé d'un seul mot — 64 signes au plus. Ce qui n'entre dans aucune de ces trois formes est refusé, `url(…)` le premier : ce n'est pas une couleur, et une variable qui sert d'image de fond en ferait une requête réseau.

Une écriture qui n'aboutit pas le dit, avec son motif, à côté de la variable : déclaration introuvable dans le fichier, ligne indécidable, fichier hors du projet ou lien symbolique, valeur ou nom refusés par le crible. Jamais de silence.

## Aide-mémoire

| Écriture | Où | Effet |
|---|---|---|
| `$$brand` | `<style>`, `<theme>` | lit la variable (`var(--mjs-brand)`) |
| `$$brand: gold` | `<style>`, `<theme>`, sous un sélecteur | déclare ou surcharge la variable |
| `<theme>` | composant | variables de base, posées sur l'hôte et sa descendance |
| `<theme name="gold">` | composant | thème nommé, activé par `theme="gold"` sur l'instance |
| `<style name="banner">` | composant | variant, activé par `layout="banner"` |
| `µlayout` | composant | le modèle choisi (`default` sans `layout`) ; chaque nom comparé est un modèle connu |
| `carte.compacte.mjs` | fichier | modèle en fichier, pris par `<@carte layout="compacte">` |
| `nom.theme.mjs` | fichier | thème de document, activable par `theme="nom"` sur n'importe quel élément |
| `µtheme = 'dark'` | `<script>` | change le thème du document |
