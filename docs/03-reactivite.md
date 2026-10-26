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

- **Pendant la boucle**, l'état est à jour (`$total` relu dans la boucle donne la valeur du tour) ; seuls les textes et les attributs du DOM gardent l'état d'avant la boucle.
- Les **props des composants enfants** n'attendent pas : une prop est de l'état de l'enfant, pas un attribut du DOM. Une variable passée à un enfant (`<@panier x={$courant}>`, `x=!{$courant}`, `{...$o}`) lui arrive à chaque écriture, comme hors boucle : une méthode de l'enfant appelée dans la boucle (`panier.garder()`) lit la valeur du tour. Cette variable garde tout son chemin d'avant, comme une variable qui pilote un bloc : ses propres textes et attributs dans le composant se réécrivent aussi à chaque tour. Ceux des autres variables restent regroupés. Une exception : dès que le code en cours écrit une variable qui pilote un bloc (`$items.push(x)` sous un `{for}`, la condition d'un `{if}`), le composant attend le rendu de ce bloc, et les écritures suivantes de la variable passée à l'enfant l'attendent avec lui — l'enfant reçoit la valeur finale après la boucle, et une méthode de l'enfant appelée entre-temps lit la valeur d'avant.
- Les **blocs** (`{for}`, `{if}`, `{key}`, `{await}`) gardent leur heure : ils se redessinent juste après le code en cours, une fois, sur l'état final, comme après plusieurs écritures hors boucle. Une liste remplie dans une boucle (`for x in xs then $items.push(x)`) montre donc ses nouvelles lignes après ce passage, pas dès l'instruction qui suit la boucle. Les textes d'un composant dont la boucle écrit aussi un bloc attendent ce bloc : ils se mettent à jour avec lui, sur l'état final.
- Les **reffets** (`µeffect`) gardent aussi leur heure : un passage juste après le code en cours, sur l'état final.
- Toutes les boucles comptent : `for`, `for…in`, `for…of`, `while`, `do…while`, et celles qu'écrivent Civet et CoffeeScript (`for x in`, `loop`, `until`, compréhensions). Toutes les écritures aussi : `$x`, `$o.a.b`, `$$x` du magasin, une méthode qui modifie une liste (`$items.push(x)`), `delete $o.x` — y compris celles d'un rappel appelé par la boucle (`for g in groupes then g.forEach((x) -> $n += x)`).
- **Plusieurs composants** : une écriture `$$x` dans la boucle touche chaque composant qui l'affiche ; chacun écrit ses textes une fois, à la sortie.
- **Boucles imbriquées** : seule la sortie de la boucle la plus extérieure écrit le DOM, même quand la boucle intérieure est dans une fonction appelée par la boucle — pourvu que la boucle extérieure écrive elle-même l'état. Une boucle qui ne fait qu'appeler une fonction (`for x in xs then traiter(x)`) n'est pas regroupée : chaque boucle de `traiter` écrit le DOM à sa sortie.
- La sortie écrit le DOM **dans tous les cas** : fin de la boucle, `break`, `continue`, `return`, ou exception levée dans la boucle (dans le `catch`, les textes sont déjà à jour).
- Une boucle **qui attend** (`await`, `for await`, ou `yield` dans un générateur) n'est pas regroupée : elle écrit le DOM à chaque écriture, comme avant — pendant l'attente, le reste de la page doit pouvoir se redessiner. Une boucle sans attente écrite dans son corps l'est, elle.
- Une boucle **sans écriture** de l'état n'est pas touchée et ne coûte rien. Une appli dont aucune boucle n'écrit l'état n'embarque pas ce mécanisme : son fichier de départ n'en porte pas un octet.
- Ne sont pas regroupés : un `.forEach`, un `.map` ou un autre rappel écrit hors de toute boucle (chaque écriture met le DOM à jour, comme avant : écrivez un `for` pour regrouper), une boucle d'un module de script importé (`.civet`, `.coffee`), et une écriture que la compilation ne voit pas dans la boucle — par une variable qui garde un objet de l'état (`t = $todos[0]`, puis `t.fait = true` dans la boucle), ou dans une fonction appelée par une boucle qui n'écrit rien elle-même.

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

Une affectation `$y = expression(...$x...)` au niveau racine du `<script>` devient **automatiquement** un dérivé : après toute écriture du composant, il se recalcule quand on le lit, et ce que le gabarit en affiche suit les `$` qu'il lit. Aucun mot-clé spécial.

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

### `µderived` — dépendances déclarées

La dérivation automatique lit le **texte** de l'expression pour repérer les `$` dont elle dépend. Une valeur dérivée se recalcule quand on la lit, après toute écriture du composant : un gestionnaire ou un `µeffect` qui la lit reçoit la valeur du moment, même quand une partie de ses lectures est cachée — une fonction ou une méthode du `<script>` qui lit l'état, un accès calculé `$[k]`, la méthode, l'accesseur ou l'itérateur d'un objet de votre application (`$trad.get('titre')`, quand `get` lit `$dict`). Mais ce que le gabarit en affiche ne suit que les `$` qu'elle lit en toutes lettres, et un `µeffect` qui la lit ne se relance qu'avec ces `$` et les siens : l'écran peut garder l'ancienne valeur. Une variable sans `$` qu'une fonction change (`compteur += 1`), l'heure ou le hasard (`Date.now()`, `Math.random()`) ne préviennent rien : sans écriture du composant, la valeur lue reste celle du dernier calcul. `µderived $var = expression, $a, $b` nomme les dépendances que l'affichage doit suivre : l'**expression** d'abord, les **dépendances** ensuite, séparées par des virgules. L'écran, et un `µeffect` qui la lit, suivent dès que l'une d'elles change.

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

## Reffets — `µeffect`

`µeffect` pose un **reffet** — un effet réactif : du code exécuté **en réaction** aux `$` qu'il lit, une fois au montage, puis à chaque changement d'une de ses dépendances (« effet », seul, désigne un effet `*nom` posé sur une balise : cf. [38 · Effets](38-effets.md)). Un reffet qui ne lit aucune valeur réactive n'a pas de dépendance : il repart à chaque mise à jour du composant. C'est le pont vers le monde extérieur (log, `localStorage`, canvas, timers, abonnements…).

```html
<script>
  $heure = ''
  $delai = 1000
  µeffect ->
    id = setInterval (-> $heure = new Date().toLocaleTimeString()), $delai   # repart quand $delai change
    -> clearInterval id                                                      # dernière fonction retournée = nettoyage
</script>
<p>{$heure}</p>
```

En Civet, la **dernière instruction est retournée** : si c'est une fonction, MJS la garde comme **nettoyage**, exécuté avant la prochaine ré-exécution du reffet *et* à la destruction du composant. Un `µon` écrit en dernier (`µeffect -> µon 'scroll', suivre`) rend ainsi son nettoyage : l'écouteur part avant le passage suivant, au lieu de s'ajouter à celui du passage précédent.

`µeffect` (comme `µ.effect`) **rend une fonction qui retire le reffet**, sans attendre la destruction du composant : il ne repart plus, et son nettoyage, s'il en a un, joue une fois. Un deuxième appel ne fait rien. Appelée après la destruction, la fonction ne rejoue pas le nettoyage, déjà joué, et retire le reffet pour de bon : il ne repart pas quand le composant revient dans la page.

```html
<script>
  $heure = ''
  $delai = 1000
  arreter := µeffect ->
    id = setInterval (-> $heure = new Date().toLocaleTimeString()), $delai   # repart quand $delai change
    -> clearInterval id
  pause := -> arreter()                                                      # l'horloge s'arrête, le reffet ne repart plus
</script>
<p>{$heure}</p>
<button @click={pause}>Pause</button>
```

Le retrait est sûr pendant que les reffets tournent : demandé par un autre reffet, par le reffet lui-même ou par son nettoyage, il ne saute ni ne rejoue aucun autre reffet. Retiré pendant son propre passage, le reffet joue aussitôt le nettoyage qu'il vient de rendre.

`µeffect` (comme `µinspect`) s'appelle pendant l'**initialisation** du composant : au premier niveau du `<script>`, y compris sous un `if`, un `else` ou une boucle de premier niveau (`unless µserver` puis, en retrait, `µeffect -> …`), même quand sa condition tient sur plusieurs lignes. Dans le corps d'une fonction — gestionnaire, méthode, hook, minuterie —, écrit en retrait ou non, l'appel arriverait hors de l'initialisation et le reffet serait ignoré : la compilation le refuse.

> ⚠️ Ne mettez **pas** un `setInterval`/listener directement à la racine du `<script>` : ce code tourne dans le *constructeur* du composant, **avant** son attachement au DOM → aucun nettoyage au démontage (fuite mémoire), et il démarre même sur un composant jamais affiché. Toujours passer par `µeffect` pour ce qui a besoin d'un cycle de vie.

Un `$$x` lu par le reffet — dans son corps, dans une fonction du `<script>` ou dans une méthode qu'il appelle — est une dépendance comme un `$x` : le reffet repart à chaque écriture de la clé, d'où qu'elle vienne. C'est le cas typique d'une bibliothèque tenue hors du gabarit (canvas, scène 3D, carte) qui doit suivre une donnée partagée :

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

Une écriture qui arrive **après** le passage du reffet — dans un rappel (minuterie, promesse, écouteur), dans une fonction passée comme valeur (`setTimeout(borne)`), ou après le premier `await` d'un reffet `async` — laisse dépendance une clé qu'il lit pendant ce passage : le reffet repart quand l'écriture arrive. C'est ainsi que fonctionne le message qui s'efface tout seul :

```html
<script>
  µeffect ->
    if $$toast
      setTimeout (-> $$toast = null), 3000    # le reffet repart sur null, et s'arrête là
</script>
```

Une clé qu'il n'écrit et ne lit que dans ce code différé n'est pas une dépendance : `µeffect -> setInterval (-> $$tick += 1), 1000` passe une fois, au montage, et ne pose qu'un intervalle. Dans un reffet `async`, ce qui précède le premier `await` fait partie du passage. Une écriture faite dans son corps, ou dans une fonction du `<script>` ou une méthode qu'il appelle, compte comme la sienne.

Les variables locales gardent leur règle : un reffet qui écrit un `$x` qu'il lit repart sur cette écriture, tant que la valeur change.

Un dérivé calculé d'une clé du store suit la règle de cette clé : un reffet qui lit `$d` (`$d = $$n + 1`) et écrit `$$n` se comporte comme s'il lisait `$$n` lui-même. Un bornage par le dérivé (`$$v = 5 if $d > 10`) repart quand un autre code écrit `$$v`, jamais sur sa propre écriture ; une écriture qui cumule par le dérivé (`$$n = $d`) cumule, comme `$$n += 1` : `$$n` n'est pas une dépendance, le reffet passe une fois. Un dérivé calculé de variables locales garde la règle des variables locales.

Garde-fou : un reffet qui relance sans fin son composant (`$x = Math.random()` dans un `µeffect` qui lit `$x`) s'arrête au bout de 10 000 rendus dans la même rafale. Un avertissement « Boucle réactive détectée » part dans la console, les reffets du composant sont suspendus jusqu'à la fin de la rafale, et l'affichage continue de montrer l'état.

### `@@x` — l'instance depuis une fonction appelée nue

`@x` est la propriété `x` du `this` que donne l'appelant. Une fonction `->` définie à la racine du `<script>` et appelée **nue** (`tick()`, sans receveur) n'a pas de `this` : `@x` y retombe sur l'instance. Mais un appelant qui pose son propre `this` l'impose, partout et pour tous les noms : `.call(objet)` donne l'objet, un écouteur posé à la main (`bouton.addEventListener 'click', -> …`) l'élément, `setTimeout` la fenêtre, un observateur l'observateur (plus bas). `@@x` lit toujours la propriété de l'instance, par une référence capturée une fois à l'initialisation, insensible au site d'appel. C'est aussi ce qu'il faut dans le corps d'un `µeffect`.

```html
<script>
  $count = 0

  tick = ->
    @@timer = setTimeout((-> $count++), 1000)   # @@timer : l'instance, d'où que tick soit appelé
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

<button @this=!{bouton}>Voir</button>
```

> ℹ️ **Dans le rappel d'un observateur.** `new ResizeObserver(mesurer)` — comme `MutationObserver`, `IntersectionObserver` et `PerformanceObserver` — appelle `mesurer` avec **l'observateur** pour `this` : `@x` y lit l'observateur (`@disconnect()` l'arrête). Pour lire votre composant, écrivez `@@x` (`@@_shadow`, `@@largeur`), comme dans un écouteur posé à la main ou un `setTimeout`.

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

Une mutation profonde sur un objet **partagé** avec un composant enfant (liaison `=!{}`, voir [Bindings two-way](07-bindings.md)) prévient aussi ce parent, à n'importe quelle profondeur : `$obj.x = v` comme `$obj.a.b = v`, dans l'enfant, redessinent le parent dès que celui-ci lit `$obj` dans son gabarit.

Deux variables d'état qui pointent le **même objet** (`shared := {…} ; $a = shared ; $b = shared`) se comportent pareil : une mutation faite via l'une — compilée (`$a.x = 1`) ou à la frontière d'échappement (Proxy) — prévient aussi un lecteur de l'autre, les deux désignent la même donnée. C'est aussi la **même valeur** : après `$sel = it` (choix d'une ligne d'un `{for it in $items}`), `it === $sel`, `$items.indexOf($sel)` rend son rang et `$items.splice($items.indexOf($sel), 1)` retire bien la ligne choisie.

Un objet **poussé** dans une liste d'état s'y retrouve aussi, qu'on le tienne tel qu'on l'a créé ou par l'élément relu dans la liste : après `b = { id: 2 } ; $list.push(b)`, `$list.indexOf(b)`, `$list.lastIndexOf(b)` et `$list.includes(b)` le trouvent, et `$list.splice($list.indexOf(b), 1)` retire bien `b`. `find`, `findIndex`, `findLast` et `findLastIndex` appellent leur prédicat **une fois par élément**, avec l'élément tel que la liste le rend (comme `filter` ou `map`) : `$items.find((x) -> x != $sel)` rend bien un autre élément que `$sel`. Comparé à l'objet tenu brut, ce prédicat ne le trouve pas : `$list.findIndex((x) -> x === b)` rend `-1` — cherchez-le par `$list.indexOf(b)`, par une donnée (`(x) -> x.id == b.id`) ou par l'élément relu (`(x) -> x === $list[1]`). Une affectation (`$list = $list.filter(…)`, `$list = [...$list, x]`) range toujours la donnée elle-même, jamais l'enveloppe réactive de ses éléments, dans une copie faite à chaque affectation quand la liste donnée en contient : la liste que vous avez passée n'est jamais modifiée (`favs` garde ses éléments après `$favs = favs`), une liste gelée donne une copie gelée, et deux variables qui reçoivent la même liste contenant des éléments enveloppés reçoivent chacune leur copie (`l = $items.filter(…) ; $a = l ; $b = l` : `$a.push(x)` ne change pas `$b`). Même règle pour une liste rangée dans un `µ.state` ou un `µStore`.

Un **objet** affecté, lui, est rangé tel quel : jamais copié ni parcouru. Deux variables d'un composant qui le reçoivent désignent la même donnée, un objet qui se désigne lui-même (`o.self = o`) se désigne toujours, un objet gelé reste gelé, ses accesseurs (`get total()`) restent des accesseurs, jamais lus à l'affectation, et une donnée neuve ou profonde (réponse JSON, liste chaînée) n'est pas parcourue — d'une liste affectée, seul le premier niveau est lu, pour y trouver des enveloppes. Entre deux composants, le partage ne prévient pas : une écriture faite par l'un change la donnée de l'autre sans le redessiner — donnez à chacun sa copie (`{...o}`), ou partagez la donnée par un magasin (`$$`, `µStore`).

> ⚠️ **Limite : une liste rangée dans un objet.** Une liste rangée DANS un objet garde les enveloppes reçues — cherchez par une donnée (`(x) -> x.id == …`) ou par l'élément relu dans la liste. Après `$o = {list: $items.filter(…)}` (ou `{list: [...$items]}`, `{a: {b: [$items[2]]}}`), `$o.list.indexOf($items[0])` rend `-1` et `includes` faux, même avec l'élément relu (`$o.list.indexOf($o.list[0])`) : écrivez `$o.list.findIndex((x) -> x.id == id)` ou `$o.list.findIndex((x) -> x == $o.list[1])`. Même chose pour une liste poussée telle quelle dans une liste (`$groupes.push(l)`) ou posée dans une `Map` (`$carte.set(k, l)`). Une liste affectée à sa propre variable (`$liste = $items.filter(…)`) n'a pas cette limite. Un objet gelé se lit tel quel (voir plus bas), sa liste aussi : sa recherche est celle de JavaScript, elle retrouve l'élément relu dans la liste d'origine (`$items[0]`), pas l'objet tenu brut.

Un objet rangé dans une `Map` ou un `Set` d'état — variable de composant, `µ.state` ou `µStore` — reste réactif par toutes les voies de lecture : `get`, `forEach`, `values()`, `entries()`, `for…of` — le modifier pendant une itération redessine le composant. Les clés d'une `Map` sortent telles quelles ; un élément de `Set` obtenu par une itération se retrouve par `has` et se retire par `delete`.

> ⚠️ **Une clé venue de données dans une écriture profonde.** Une écriture profonde de l'état (`$o[a][b] = v`, `delete $o[a][b]`, `$o[a].push(x)`, sur un chemin de toute longueur) refuse une clé qui vaut `'__proto__'`, `'constructor'` ou `'prototype'`, à n'importe quel rang du chemin : rien n'est écrit, et la console nomme le segment refusé (« chemin d'état refusé (segment « __proto__ ») — mutation ignorée. »). Avec `section` venue de l'adresse de la page et valant `'__proto__'`, `$reglages[section][nom] = v` ne touche donc pas le modèle commun de tous les objets de la page (`Object.prototype`). Une clé convertie en texte compte comme ce texte (`['__proto__']`, un objet dont `toString` rend ce nom) : elle est convertie une seule fois, puis comparée et écrite telle quelle. Un indice (`$l[0]`) ou un symbole ne sont jamais refusés.
>
> Un chemin de l'état écrit dans le code (`$loc.p.x = v`, `$loc.p.push(x)`, `delete $loc.p.x`) passe le même refus quand l'objet qu'il atteint y a été rangé par une lecture (`$loc.p = $$o[k]`, `$racine = $$o[k]`) : là, `'__proto__'` mène au prototype et `'constructor'` à la fonction `Object`. L'écriture n'écrit alors jamais dans un prototype ni dans une fonction — une fonction rangée dans l'état comprise (`$loc.f.x = v`) —, n'y appelle aucune méthode, n'y supprime rien ; rien n'est écrit, et la console nomme le segment qui y mène (le même message).
>
> Les écritures qui passent par l'état enveloppé suivent la même règle quand cet objet est un prototype : une forme qui lit avant d'écrire (`$loc.p.x += 1`, `++`, `||=`, `&&=`, `??=`, et en CoffeeScript `?=`, `or=`, `and=`), une variable qui le garde (`t := $loc.p`, puis `t.x = v` ou `delete t.x`), `Object.assign($loc.p, …)`, la rune `µproxy $loc.p`. Rien n'y est écrit, défini ni supprimé, sans erreur, et la console affiche le même message ; seul `Object.defineProperty` lève sa `TypeError`, comme pour un de ces trois noms.
>
> Un prototype qui porte une étiquette, rangé de même dans l'état (`$racine = $$o.m[k]`, `k` valant `'__proto__'` : `Map.prototype`, ou `Set.prototype`), sort enveloppé comme `Object.prototype` : son identité change, et une méthode lue par l'enveloppe s'applique à l'enveloppe, pas au prototype (`$racine.isPrototypeOf(new Map())` rend `false`, `$racine.valueOf()` rend l'enveloppe) ; rien ne s'y écrit par l'état — les mêmes formes, le même message. L'enveloppe d'un prototype ne le laisse ni geler, ni sceller, ni fermer aux ajouts : `Object.freeze`, `Object.seal` et `Object.preventExtensions` lèvent leur `TypeError`, `Reflect.preventExtensions` rend `false`, et la console affiche le même message ; `Object.setPrototypeOf` est refusé comme pour tout objet de l'état (« état : changement de prototype refusé »).
>
> Restent hors de portée, et suivent JavaScript : une fonction du moteur rangée à la racine de l'état (`$racine = $$o['constructor']`, la fonction `Object`) reçoit les écritures qui passent par l'état enveloppé (`$racine.x += 1`, une variable qui la garde, `Object.assign($racine, …)`, `Object.freeze($racine)`) ; le `prototype` d'une telle fonction (`$racine.prototype`) ; le prototype d'une valeur simple (`String.prototype`, `Number.prototype`, `Boolean.prototype`, `Symbol.prototype`, `BigInt.prototype`), rangé tel quel pour que ses lectures marchent (`String($racine)`, `{$racine}` dans la vue) ; `Function.prototype` rangé à la racine (une fonction de l'état reste brute) ; le prototype d'un élément de la page (`HTMLDivElement.prototype`) ; le prototype que rend `Object.getPrototypeOf($o)` sur l'état ; une valeur du magasin passée à une fonction (`Object.assign($$o.constructor, …)`) ; ce qu'on atteint depuis une fonction de votre appli (`$cb.constructor`). Là, l'écriture va où JavaScript l'envoie : vérifiez la clé venue de données avant de lire l'objet (cf. ci-dessous).
>
> Ces trois noms sont refusés aussi au premier niveau de l'état (`$[clé] = v`, un attribut de balise, un objet étalé `{...$data}`), et en écriture à travers un objet de l'état qui a échappé au suivi statique (passé à une fonction). En LECTURE à travers l'état (`$o[k]` lu dans une expression, ou par une fonction qui a reçu l'objet), ils rendent `undefined` sauf si l'état porte VRAIMENT une donnée sous ce nom (propriété propre) — jamais le prototype hérité du realm : une forme que le compilateur laisse passer par l'état enveloppé — qui lit avant d'écrire (`$o[a][b] += v`, `||=`, `++`, et en CoffeeScript `?=`, `or=`), ou dont une clé est faite d'une expression (`$o[req.a][b] = v`) — lit alors `undefined` et lève une `TypeError`, sans rien écrire non plus, et sans message ; un de ces noms en dernière clé (`$o.a[k] += v`) n'écrit rien, sans erreur ni message. Hors de l'état — les objets de vos bibliothèques, les vôtres hors de `$` et `$$` —, une clé venue de données reste à vérifier avant d'écrire : liste de clés permises, `Object.hasOwn`, ou une `Map` ([14 · Stores](14-stores.md), « Sécurité » ; [18 · Pièges](18-pieges.md), § 18).

Une clé **calculée** est acceptée aussi bien en profondeur (`$obj[cle] = v`, `cle` une variable) qu'au premier niveau de l'état (`$[cle] = v`) — les deux écritures, les formes composées (`+=`…), `++`/`--` et `delete` compris.

> ⚠️ **La seule vraie exception : `µraw`.** Une donnée explicitement marquée `µraw(...)` ([État brut](11-etat-brut.md)) n'est **volontairement** suivie par aucun mécanisme (ni compile-time, ni Proxy) : muter son intérieur ne re-rend rien, il faut **réaffecter** une nouvelle référence. C'est un choix de perf pour les données remplacées en bloc — un `$` ordinaire n'a jamais besoin de ce contournement.

> ⚠️ **Un objet gelé (`Object.freeze`) se lit tel quel.** JavaScript exige qu'une propriété figée — propre, ni modifiable ni configurable, comme toutes celles d'un objet gelé — rende sa propre valeur à une lecture par un Proxy : MJS la rend donc brute, sans Proxy, dans l'état d'un composant comme dans un `µ.state` ou un `µStore`. L'objet s'affiche normalement (champs, `{for}`, méthodes), qu'il soit gelé avant d'entrer dans l'état ou après. Y écrire lève l'erreur du navigateur (`TypeError: Cannot assign to read only property…`), comme sans MJS. Un sous-objet **non gelé** atteint à travers lui redessine quand le script du composant l'écrit en clair (`$rows[0].info.v = 5`), mais pas quand une fonction le reçoit et le modifie (`bump($rows[0].info)`, ou `bump(row.info)` dans un gabarit) : remplacez alors l'objet gelé, ou réaffectez la liste. Même règle pour une propriété figée d'un objet scellé (`Object.seal`) ou fermé aux ajouts (`Object.preventExtensions`) ; ses autres propriétés restent suivies comme celles d'un autre objet. **Limite :** la propriété figée d'un objet resté ouvert aux ajouts — celle que pose `Object.defineProperty(o, k, {value: …})` (ni modifiable ni configurable par défaut), `Object.create(null, {k: {value: …}})` ou une classe qui définit ainsi un champ — fait lever sa lecture quand elle tient un objet ou une fonction (`'get' on proxy: property … is a read-only and non-configurable data property…`) : gelez l'objet (`Object.freeze`) ou fermez-le aux ajouts (`Object.preventExtensions`), ou définissez la propriété avec `writable: true` ou `configurable: true`.

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

📚 **Apprendre en pratiquant** : ce chapitre correspond au **Tuto interactif n°2 (Réactivité)** — état, état profond, valeurs dérivées, inspection, reffets, module partagé.
