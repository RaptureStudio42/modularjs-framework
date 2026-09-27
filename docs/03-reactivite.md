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

Dans un `<pre>` ou un `<code>`, le **texte** est affiché tel quel : un `$x` écrit en clair — un exemple de code montré à l'utilisateur — n'est ni lu ni déclaré. Une interpolation `{$x}` y reste en revanche un vrai lien, mis à jour comme partout ailleurs :

```html
<!-- affiché tel quel : $compteur n'est pas déclaré -->
<pre><code>$compteur = 0</code></pre>

<!-- vrai lien : l'affichage suit $nom -->
<p>Le paquet <code>{$nom}</code> est prêt.</p>
```

Une affectation réactive **vaut ce qu'elle affecte**, exactement comme en JavaScript — utilisée comme valeur (`return $x = 5`, `$a = $b = v`, un argument d'appel, `$n++`/`--$n`…), elle donne la valeur assignée (ou l'ancienne valeur pour le suffixe `++`/`--`), jamais un signal interne. `$n++`/`--$n` convertissent aussi `$n` en nombre avant d'incrémenter, comme le ferait JavaScript sur une chaîne (`$n = "2"` puis `$n++` donne `3`, pas `"21"`).

<details>
<summary>🎓 <b>Pour débutants</b> — « réactif », ça veut dire quoi&nbsp;?</summary>

En JavaScript classique, si tu écris `count = 0` puis plus tard `count = 1`, le texte déjà affiché sur la page **ne bouge pas** : tu dois aller chercher l'élément DOM et le réécrire à la main.

En MJS, le `$` change tout : la variable et l'affichage sont **liés**. Tu écris `$count = 1`, et tout endroit du template qui montrait `{$count}` se met à jour **tout seul** — uniquement ces endroits, rien d'autre. C'est ça, « réactif » : tu manipules des données, l'écran suit.

</details>

### `µminmax` — borner une valeur réactive

`µminmax $x, min, max` — ou en forme parenthésée, `µminmax($x, min, max)` — enregistre une fois pour toutes les bornes d'une variable réactive : la valeur courante de `$x` est immédiatement ramenée dans l'intervalle, puis **toute écriture suivante est bornée à son tour**, y compris celle qui vient d'un binding `=!{$x}` ([Bindings two-way](07-bindings.md)).

```html
<script>
  $volume = 150
  µminmax $volume, 0, 100
</script>

<input type="range" value.number=!{$volume} min="0" max="100" />
<p>{$volume}</p>
```

`$volume` vaut `100` dès le premier rendu (`150` était hors bornes), et le curseur ne peut plus la faire sortir de `[0, 100]`.

> ⚠️ `µminmax` s'appelle **une seule fois**, au niveau racine du `<script>`, après avoir donné sa valeur initiale à la variable.

#### Borner une propriété d'un objet

`µminmax` borne aussi **une propriété** d'un objet réactif. Le chemin doit être **fixe** : `$x.volume`, `$x.son.volume`, `$x['cle']`, `$x.pistes[0].volume`.

```html
<script>
  $reglages = { volume: 150, basses: 3 }
  µminmax $reglages.volume, 0, 100

  monter = (r) -> r.volume += 30
</script>

<input type="range" value.number=!{$reglages.volume} min="0" max="100" />
<button @click={monter($reglages)}>+30</button>
<p>{$reglages.volume}</p>
```

`$reglages.volume` vaut `100` dès le premier rendu, et reste dans `[0, 100]` quoi qu'il arrive dans **ce composant** :

| Écriture | Bornée ? |
|---|---|
| `$reglages.volume = 500`, `+=`, `++`, le curseur lié `=!{$reglages.volume}` | oui |
| clé calculée : `$reglages[cle] = 500` (quand `cle` vaut `'volume'`) | oui |
| dans une fonction qui reçoit l'objet : `monter($reglages)` | oui |
| remplacement entier : `$reglages = { volume: 500 }` | oui — l'objet reçu est borné **sur place** |
| par un composant enfant lié en deux sens : `<@panneau data=!{$reglages}>` | oui — le parent est prévenu et reborne aussitôt |
| par un composant enfant qui reçoit l'objet en liaison simple : `<@panneau data={$reglages}>` | **non** |

Le dernier cas : l'enfant surveille l'objet de son côté, la règle du parent ne le suit pas. L'objet, partagé, garde alors `500` jusqu'à la prochaine écriture du parent sur `$reglages` (n'importe quelle propriété), qui le ramène à `100`.

```html
<!-- panneau.mjs — reçoit l'objet et le modifie -->
<button @click={$data.volume = 500}>À fond</button>

<!-- parent -->
<@panneau data={$reglages}></@panneau>     <!-- volume passe à 500 : pas borné -->
<@panneau data=!{$reglages}></@panneau>    <!-- volume revient à 100 : borné -->
```

Pour qu'il le soit, lie l'objet en deux sens (`data=!{$reglages}`), ou pose la règle dans l'enfant lui-même : `µminmax $data.volume, 0, 100`.

Seuls les **nombres** sont bornés : une autre valeur (texte, absence de la propriété) est laissée telle quelle. Un appel (`$x.volume()`), un index calculé (`$x[i]`) ou un espace (`$x . volume`) dans le chemin sont refusés à la compilation, comme un store (`µminmax $$x, 0, 10` : borne la valeur là où elle est écrite). Un composant qui n'utilise pas `µminmax` sur une propriété ne paie rien.

## Valeurs dérivées

Une affectation `$y = expression(...$x...)` au niveau racine du `<script>` devient **automatiquement** un dérivé : recalculé quand ses dépendances changent. Aucun mot-clé spécial.

```html
<script>
  $numbers = [1, 2, 3, 4]
  $total = $numbers.reduce((t, n)-> t + n, 0)   # dérivé auto, suit $numbers
</script>

<p>{$numbers.join(' + ')} = {$total}</p>
```

> ⚠️ Le dérivé auto doit être **une seule expression**. Un `if/else` multi-lignes n'est pas auto-dérivé — utilise un ternaire, ou un `µeffect` si tu as besoin de plusieurs instructions.

<details>
<summary>🎓 <b>Pour débutants</b> — pourquoi pas juste une fonction&nbsp;?</summary>

Tu pourrais écrire une fonction `total()` qui recalcule la somme. Mais alors le template appellerait `{total()}` à chaque rendu, et surtout MJS ne saurait pas *quand* le rafraîchir.

Avec `$total = ...`, MJS **lit** les `$` à l'intérieur (ici `$numbers`), retient que `$total` en dépend, et le recalcule **exactement** quand `$numbers` change. Tu décris le *quoi* (« le total, c'est la somme »), MJS gère le *quand*.

</details>

### `µderived` — dépendances déclarées

La dérivation automatique lit le **texte** de l'expression pour repérer les `$` dont elle dépend. Quand la vraie dépendance est cachée dans une fonction appelée, elle n'apparaît pas dans ce texte : le dérivé ne se recalcule jamais, sans la moindre erreur — l'écran reste simplement figé. `µderived $var = expression, $a, $b` force la liste : l'**expression** d'abord, les **dépendances** ensuite, séparées par des virgules.

```html
<script>
  computeTotal = -> $price * $quantity
  µderived $total = computeTotal(), $price, $quantity
</script>
```

> ⚠️ `µderived` ne se déclare qu'au niveau **racine** du `<script>` (jamais à l'intérieur d'une fonction, jamais dans une interpolation ou un handler). Chaque dépendance doit être un symbole `$` **nu** (`$price`, jamais `$order.price` ni un store `$$x`). Sans virgule après l'expression, l'écriture retombe sur une dérivation ordinaire.

> 🔗 **Dériver d'une source *partagée*.** Le membre de droite n'est pas limité aux `$` locaux : il peut lire un **contexte** (`§x`, `§§x`) ou un **store** universel (`$$x`, `µ$$x`, `µ.store`). `$prix = §§tva * $ht` est un dérivé parfaitement valide. MJS le repère et l'évalue **paresseusement au premier rendu** — une fois le composant branché à l'arbre, donc son contexte résolu — et non à la construction, puis le ré-évalue quand la source partagée change. C'est ce qui referme un piège subtil : un dérivé lu *uniquement* depuis une source partagée (aucun `$` local à droite) était sinon calculé trop tôt, dans le constructeur d'un composant pas encore connecté → contexte introuvable → valeur figée à `undefined`. Désormais il attend le bon moment tout seul.

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

## Effets — `µeffect`

`µeffect` exécute du code **en réaction** aux `$` qu'il lit : une fois au montage, puis à chaque changement d'une de ses dépendances. C'est le pont vers le monde extérieur (log, `localStorage`, canvas, timers, abonnements…).

```html
<script>
  $i = 0
  µeffect ->
    id = setInterval (-> $i++), 1000
    -> clearInterval id          # dernière fonction retournée = nettoyage
</script>
```

En Civet, la **dernière instruction est retournée** : si c'est une fonction, MJS la garde comme **nettoyage**, exécuté avant la prochaine ré-exécution de l'effet *et* à la destruction du composant.

> ⚠️ Ne mets **pas** un `setInterval`/listener directement à la racine du `<script>` : ce code tourne dans le *constructeur* du composant, **avant** son attachement au DOM → aucun nettoyage au démontage (fuite mémoire), et il démarre même sur un composant jamais affiché. Toujours passer par `µeffect` pour ce qui a besoin d'un cycle de vie.

Un `$$x` lu par l'effet — dans son corps, dans une fonction du `<script>` ou dans une méthode qu'il appelle — est une dépendance comme un `$x` : l'effet repart à chaque écriture de la clé, d'où qu'elle vienne. C'est le cas typique d'une bibliothèque tenue hors du gabarit (canvas, scène 3D, carte) qui doit suivre une donnée partagée :

```html
<script>
  $zoom = 1
  µeffect ->
    scene?.afficher($$papiers, $zoom)    # repart quand $$papiers OU $zoom change
</script>
```

Une clé que l'effet **écrit** lui-même n'en est jamais une : `$$vus += 1 if $$actif` repart quand `$$actif` change, pas sur sa propre écriture de `$$vus` — sinon il tournerait en boucle.

### `@@x` — l'instance depuis une fonction appelée nue

`@x` est la propriété `x` de l'instance, résolue via `this` — donc perdue dès qu'une fonction `->` définie à la racine du `<script>` est appelée **nue** (`tick()`, sans receveur) depuis un autre handler : `this` n'y vaut plus l'instance. `@@x` lit la **même** propriété par une référence capturée une fois à l'initialisation, insensible au site d'appel. C'est aussi ce qu'il faut dans le corps d'un `µeffect`, lui-même toujours appelé nu par le runtime.

```html
<script>
  $count = 0

  tick = ->
    @@timer = setTimeout((-> $count++), 1000)   # marche même appelé nu, @timer échouerait ici
</script>

<button @click={tick()}>Relancer ({$count})</button>
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

La clé effective est `mjs-<module>:<variable>` (suivie du résultat de `by:` quand il y en a un). La valeur est relue au montage, puis réécrite à chaque changement de la variable. Le transport passe par `JSON` (`JSON.stringify`/`JSON.parse`) : un `Date`, une `Map` ou un `Set` stocké dans une variable persistée revient donc comme un objet nu après rechargement, pas comme l'instance d'origine.

## État profond — mutation imbriquée

Muter une propriété imbriquée d'un `$` est réactif, **d'où qu'elle vienne** — handler `@event` ou fonction de `<script>` : MJS suit à la **compilation** les alias de `$x` dans la portée (analyse AST) et réécrit chaque mutation profonde reconnue en un appel direct au runtime (`µ._mjs_deepSet`/`µ._mjs_deepCall`), sans passer par un Proxy.

```html
<script>
  $todos = [{ fait: false, texte: 'a' }]

  # réactif : re-rend le {for}, suivi à la compilation (alias direct)
  cocher = -> $todos[0].fait = true

  # réactif aussi via un alias tracké dans la même portée :
  ajouterTag = ->
    t = $todos[0]
    t.tags ?= []
    t.tags.push('urgent')
</script>
```

Pour les cas que la compilation ne peut pas résoudre statiquement (l'objet **s'échappe** — passé à une fonction externe, stocké dans une structure tierce, alias réassigné…), MJS bascule automatiquement sur un **Proxy ciblé** à la frontière d'échappement : la réactivité reste préservée sans action de ta part. Le suivi statique couvre ~95&nbsp;% du code réel ; le Proxy comble le reste — jamais de trou silencieux.

Une mutation profonde sur un objet **partagé** avec un composant enfant (liaison `=!{}`, voir [Bindings two-way](07-bindings.md)) prévient aussi ce parent, à n'importe quelle profondeur : `$obj.x = v` comme `$obj.a.b = v`, dans l'enfant, redessinent le parent dès que celui-ci lit `$obj` dans son gabarit.

Deux variables d'état qui pointent le **même objet** (`shared := {…} ; $a = shared ; $b = shared`) se comportent pareil : une mutation faite via l'une, à la frontière d'échappement (Proxy), prévient aussi un lecteur de l'autre — les deux désignent la même donnée, la mutation les concerne toutes les deux.

> ⚠️ **La clé de `$x.y`/`$[clé]` reste sous garde.** `__proto__`, `constructor` et `prototype` sont refusés en ÉCRITURE quel que soit le chemin (compilé ou Proxy) ; en LECTURE à travers le Proxy (l'objet a échappé au suivi statique), ils rendent `undefined` sauf si l'état porte VRAIMENT une donnée sous ce nom (propriété propre) — jamais le prototype hérité du realm.

Une clé **calculée** est acceptée aussi bien en profondeur (`$obj[cle] = v`, `cle` une variable) qu'au premier niveau de l'état (`$[cle] = v`) — les deux écritures, les formes composées (`+=`…), `++`/`--` et `delete` compris.

> ⚠️ **La seule vraie exception : `µraw`.** Une donnée explicitement marquée `µraw(...)` ([État brut](11-etat-brut.md)) n'est **volontairement** suivie par aucun mécanisme (ni compile-time, ni Proxy) : muter son intérieur ne re-rend rien, il faut **réaffecter** une nouvelle référence. C'est un choix de perf pour les données remplacées en bloc — un `$` ordinaire n'a jamais besoin de ce contournement.

> 🔗 Voir aussi : [Pièges & bonnes pratiques](18-pieges.md) → *réactivité statique* (un `$` lu dans une méthode appelée par un binding n'est pas tracké — mettre le `$` en clair dans le binding).

## Environnement réactif — `µonline` / `µvisible` / `µready`

Trois booléens réactifs, lisibles partout sans import, reflètent l'état de l'environnement client : `µonline` (le navigateur a du réseau), `µvisible` (l'onglet est au premier plan), `µready` (le document a fini de charger). Lecture seule côté dev — seul le runtime les écrit.

```html
{if not µonline}
  <p class="banniere-offline">Connexion perdue — les changements seront synchronisés au retour du réseau.</p>
{end}
```

> 🔗 Côté serveur, la rune correspondante est **`µserver`** (vrai pendant un rendu SSR) — voir [SSR](19-ssr.md).

---

📚 **Apprendre en pratiquant** : ce chapitre correspond au **Tuto interactif n°2 (Réactivité)** — état, état profond, valeurs dérivées, inspection, effets, module partagé.
