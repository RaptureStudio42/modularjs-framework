# 10 · Transitions & animations

> 📚 Tuto interactif correspondant : **Transitions** (directive, réglages, entrée et sortie, CSS & JS, événements, global), **Animation** (interpolations, ressorts) et **Transitions avancées** (transitions différées, cross-fade, `@flip`). Les encarts 🎓 *Pour débutants* dépliables donnent l'explication pas-à-pas ; le corps de la page reste la référence dense.

MJS anime un élément quand il **entre** ou **sort** du DOM (au gré d'un `{if}`, d'un `{for}`, d'un `{key}`). Une transition est un **effet** ([38 · Effets](38-effets.md)) — `*fade`, `*fly`, `*slide`… — que l'on accroche au **cycle de vie** de la balise : `@in=*…` à son entrée, `@out=*…` à sa sortie, `@transition=*…` aux deux. MJS joue l'animation aux bons moments et la nettoie tout seul.

> 💡 Ici, on anime des **éléments**. Pour animer un changement de **page** (la permutation des vues du routeur), c'est `@viewTransition` → [17 · Router](17-router.md).

## Entrer et sortir : `@transition`, `@in`, `@out`

`@transition=*nom` joue l'effet **à l'entrée et à la sortie** : à l'entrée, la balise part de l'état caché de l'effet et arrive à son état normal ; à la sortie, le même chemin à l'envers.

```html
<script>
  $visible = true
</script>

<label>
  <input type="checkbox" checked=!{$visible} /> visible
</label>

{if $visible}
  <p @transition=*fade>
    Apparaît et disparaît en fondu
  </p>
{end}
```

Pour dissocier les deux sens, `@in=*nom` (entrée seule) et `@out=*nom` (sortie seule), chacun avec ses réglages :

```html
{if $visible}
  <p @in=*fly(up, distance: 200, duration: 2s) @out=*fade>
    Vole en entrant, s'estompe en sortant
  </p>
{end}
```

`@in` ou `@out` à côté de `@transition` reprend son sens : `@transition=*fade @in=*fly` entre en volant et sort en fondu.

> ⚠️ Une transition ne se joue que sur un élément qui **entre ou sort** réellement du DOM. Un élément déjà présent au montage n'anime rien : il faut le révéler/masquer via `{if}`, `{for}`, ou `{key}`. Pour animer une balise qui est là dès le départ — quand elle arrive à l'écran, au défilement —, posez l'effet directement sur elle (cf. [Apparaître au défilement](#apparaître-au-défilement--leffet-posé-sur-la-balise)).

<details>
<summary>🎓 <b>Pour débutants</b> — pourquoi un <code>{if}</code> autour&nbsp;?</summary>

Une transition d'entrée/sortie a besoin d'un *avant* et d'un *après* : l'élément doit naître ou mourir pour qu'il y ait quelque chose à animer. Le `{if $visible}` est ce qui le fait apparaître/disparaître ; `@transition=*fade` ne fait qu'habiller ce passage. Sans bloc conditionnel autour, l'élément reste là en permanence et il n'y a rien à animer.

</details>

## Les réglages

Ils s'écrivent comme ceux de tout effet ([38 · Effets](38-effets.md)) : entre parenthèses, le **réglage principal** sans son nom, les autres nommés, dans l'ordre qu'on veut ; une durée en `ms` ou en `s` (`300ms`, `2s`) ; une direction en mot (`up`, `down-left`…) ou en angle (`45` : vers le haut à droite).

```html
<p @in=*fly(up, distance: 200, duration: 2s)>…</p>
<p @in=*fly(135, distance: 60px, easing: back-out)>…</p>
<p @out=*scale(.5, origin: top-left, duration: 250ms)>…</p>
```

Trois réglages communs à toutes les transitions :

| Réglage | Rôle |
|---|---|
| `duration` | la durée du passage |
| `delay` | l'attente avant de partir (`0s`) |
| `easing` | la courbe du mouvement : `linear`, `ease`, `ease-in`, `ease-out`, `ease-in-out`, `cubic-bezier(…)`, ou une courbe de `µeasing` écrite avec des tirets — `bounce-out`, `elastic-out`, `back-in-out`, `cubic-out`, `quint-out`, `expo-out`, `sine-in-out`… (familles `back`, `bounce`, `circ`, `cubic`, `elastic`, `expo`, `quad`, `quart`, `quint`, `sine`, suivies de `-in`, `-out` ou `-in-out`) |

Une valeur est fixe, vérifiée à la compilation, ou une **variable** écrite telle quelle — `$x`, ou une variable de la boucle qui entoure la balise (`item.id`) —, lue au moment où la balise entre.

```html
{for todo in $todos by id}
  <li @in=*fly(left, distance: $decalage)>{todo.text}</li>
{end}
```

## Les transitions

| Transition | Réglages propres (défaut) | Durée · courbe | Effet |
|---|---|---|---|
| `*fade` | **`duration`** | 400ms · `linear` | un fondu |
| `*fly` | **`direction`** (`up`), `distance` (40, en px ou `%`), `opacity` (0 : l'opacité de départ), `blur` (0 : le flou de départ, en px), `skew` (0 : l'inclinaison de départ, en degrés), `rotate` (0 : la rotation de départ, en degrés) | 400ms · `cubic-out` | la balise arrive en allant vers `direction` — elle part de l'autre côté, à `distance` —, et repart par où elle est venue ; floue, penchée et tournée, elle arrive « à toute vitesse » |
| `*slide` | **`axis`** (`y`, ou `x`) | 400ms · `cubic-out` | un accordéon : la balise se déplie en hauteur (ou en largeur), marges et bordures comprises |
| `*scale` | **`start`** (0 : l'échelle de départ), `opacity` (0), `origin` (`center`), `axis` (`both`, ou `x`, `y`) | 400ms · `cubic-out` | la balise grandit depuis `origin` (un coin, un bord, `20% 80%`) ; `start` au-dessus de 1 : elle retombe de plus grand ; `axis: x` : elle s'étire de côté seulement |
| `*rotate` | **`angle`** (-200, en degrés), `start` (1 : l'échelle de départ), `opacity` (0), `origin` (`center`) | 600ms · `cubic-out` | la balise arrive en tournant sur elle-même (autour de `origin`) ; `start: 0` : elle grandit en tournant |
| `*blur` | **`amount`** (5, en px), `opacity` (0) | 400ms · `cubic-in-out` | la balise sort du flou |
| `*draw` | **`duration`**, `speed` (en px par seconde : la durée suit la longueur du tracé) | 800ms · `cubic-in-out` | un tracé SVG (`<path>`, `<line>`…) se dessine |
| `*iris` | **`origin`** (`center`, ou `pointer` : le point où la souris a cliqué ou survolé en dernier, ramené au bord de la balise s'il est dehors), `shape` (`circle`, ou `box`, `diamond`, `cross`, `ellipse`), `start` (0 : l'ouverture de départ, de 0 à 1), `angle` (0 : l'inclinaison de la fenêtre fermée, en degrés) | 380ms · `ease-out` | une ouverture grandit depuis `origin` et découvre la balise : un rond, un rectangle, un losange, une croix, un ovale, déjà entrouvert ou penché si l'on veut |
| `*wheel` | **`spokes`** (1 : le nombre de rayons), `origin` (`center`), `reverse` (non : l'autre sens) | 700ms · `linear` | un rayon balaie la balise comme l'aiguille d'une horloge et la découvre |
| `*volet` | **`direction`** (`down`) | 380ms · `ease-out` | le contenu entre en glissant dans sa propre boîte, comme un store |
| `*reveal` | **`direction`** (`up`) | 380ms · `ease-in` | l'entrée remonte de l'ombre ; la sortie glisse hors champ dans le sens choisi, par-dessus |
| `*flip` | **`direction`** (`left`) | 550ms · `ease-in-out` | un retournement en place, comme une carte |
| `*cube` | **`direction`** (`left`) | 600ms · `cubic-bezier(.45, .05, .55, .95)` | les faces tournent comme celles d'un cube |
| `*turn` | **`direction`** (`left`) | 600ms · `linear` | un pli pivote sur son bord ; la nouvelle face remonte de l'ombre |
| `*swipe` | **`direction`** (`right` ; un mot ou un angle) | 320ms · `ease-out` | un front doux balaie la balise et la découvre |
| `*bars` | **`direction`** (`down`), `count` (8) | 640ms · `linear` | des bandes révèlent la balise l'une après l'autre |
| `*blocks` | **`cols`** (6), `rows` (4), `order` (`diagonal`, `random`, `rows`, `columns`, `center`, `edges`), `seed` (3 : le tirage de `random`, et le désordre de `rows` et `columns`) | 620ms · `linear` | des tuiles s'assemblent en tournant : en vague diagonale, au hasard, rangée par rangée, colonne par colonne, du centre vers les bords ou des bords vers le centre |
| `*shatter` | **`size`** (20 : le côté d'une tuile, en px), `spread` (400 : la dispersion), `rotate` (360) | 1.2s · `cubic-out` | l'image se reconstitue à partir de tuiles éparpillées ; à la sortie, elle vole en éclats |
| `*pixelate` | **`size`** (48 : le côté d'un carreau au départ, en px), `steps` (8 : au plus ce nombre de paliers) | 900ms · `ease-out` | l'image arrive en gros carreaux qui rétrécissent par paliers jusqu'à devenir nets ; à la sortie, le chemin inverse |
| `*ink` | **`style`** (`blots`, `brush`, `wash`, `smoke`, `drip`, `dots`, `shards`, `swirl`, `tear`), `image`, `soft`, `count`, `seed`, `direction`, `origin`, `invert` | 1.8s · `linear` | la balise apparaît à travers un masque qui s'étale : encre, pinceau, fumée… ou votre image |
| `*typewriter` | **`speed`** (30 : en ms par caractère) | — · `linear` | le texte se tape à la machine, puis s'efface |
| `*crossfade` | **`key`**, `group`, `fallback` (`scale`) | — · `cubic-out` | la balise vole d'une liste à l'autre (cf. [Cross-fade](#cross-fade--une-balise-qui-vole-dune-liste-à-lautre)) |

- `*volet`, `*reveal`, `*flip`, `*cube`, `*turn`, `*bars` vont dans quatre sens (`right`, `left`, `up`, `down`) ; `*fly` et `*swipe`, dans tous (un mot ou un angle).
- `*shatter` découpe l'image de la balise — une `<img>`, ou l'image de fond de la balise ; sans image, c'est un fondu. Jamais plus de 2 500 tuiles : sur une grande image, les tuiles sont plus grandes que `size`.
- `*typewriter` exige que la balise ne contienne que du texte (pas de balise dedans) ; les blancs d'indentation autour d'une interpolation sont tolérés.
- `*draw` ne s'applique qu'à un tracé SVG.

`*reveal`, `*flip`, `*cube` et `*turn` sont appariés : leur entrée et leur sortie sont deux animations différentes, la sortie ne rejoue pas l'entrée à l'envers. Dans un `{key}` ou un `{if}`, le framework insère le nouveau nœud à côté de l'ancien pendant que celui-ci joue sa sortie ; l'ancien est alors épinglé à sa place, hors du flux, pour que les deux se superposent le temps de l'effet — mais l'épinglage ne joue que si un remplaçant est bien arrivé, un `{if}` qui se referme seul joue sa sortie comme d'habitude, sans épinglage. La perspective 3D de `*cube`, `*flip` et `*turn` vit entièrement dans le `transform` de chaque face ; rien n'est posé sur le parent.

```html
{key $k}
  <div @transition=*cube>
    Une face, puis l'autre
  </div>
{end}
```

<details>
<summary>🎓 <b>Pour débutants</b> — pourquoi la sortie <em>rejoue</em>-t-elle l'entrée à l'envers&nbsp;?</summary>

La plupart des transitions sont symétriques : `*iris` qui s'ouvrait au centre pour l'entrée se referme au centre pour la sortie, `*volet` qui descendait remonte. C'est la même animation que MJS joue simplement à l'envers — pas la peine d'écrire une version « sortie » séparée, `@transition=*nom` suffit ; `@in`/`@out` restent là pour choisir une paire différente de chaque côté. Seules `*reveal`, `*flip`, `*cube` et `*turn` ont deux animations distinctes : seules, elles ne jouent que leur moitié ; c'est dans un `{key}`, où l'ancien et le nouveau coexistent un instant, que les deux moitiés se superposent et donnent l'illusion d'un seul mouvement continu.

</details>

> ⚠️ `*swipe` repose sur les propriétés `mask-*` sans préfixe : Chromium 120+, Firefox, Safari 15.4+.

## Un autre effet sur le cycle de vie

`@in`, `@out` et `@transition` accrochent aussi un effet qui **se joue une fois** — ceux dont le réglage `on` connaît `load` ([38 · Effets](38-effets.md)) : `*scramble`, `*stagger`, `*count`, `*dissolve`, `*confetti`, `*shake`, un tour de `*glitch` ou de `*bounce`… À l'entrée, l'effet se joue quand la balise arrive ; à la sortie, la balise attend la fin de son jeu avant de partir.

```html
{if $message}
  <p @in=*scramble(speed: 30) @out=*dissolve(duration: 1.5s, delay: 0s)>{$message}</p>
{end}
```

Un effet continu ou à état (`*neon`, `*tilt`, `*lift`…) ne se joue pas « une fois » : le build le refuse dans `@in`/`@out` et dit de le poser directement sur la balise. Le déclencheur, c'est la directive : `on`, `once`, `range` et `zone` n'y ont pas de sens (le build le dit aussi).

## Apparaître au défilement : l'effet posé sur la balise

Posée **directement** sur une balise, sans `@in`, une transition se joue selon son réglage `on` :

| `on` | La balise… |
|---|---|
| `view` (défaut) | attend, dans son état caché, d'arriver à l'écran, puis entre ; `once: false` la fait ressortir quand elle quitte l'écran, et rentrer quand elle revient. Elle est jugée à sa place, jamais là où l'emporte son mouvement : quand la première image la déplace ou la découpe (`*fly`, `*volet`, `*iris`…), elle attend invisible à sa place ; quand elle la déplace (`*fly`, `*volet`, `*scale`…), une sortie commencée va jusqu'au bout avant que l'écran ne soit regardé de nouveau (une balise posée juste au-delà d'un bord sort une fois et s'arrête) |
| `scroll` | suit le défilement : l'animation avance quand on descend, recule quand on remonte |
| `load` | entre dès son apparition |
| `hover` | est cachée au repos, sans quitter la mise en page, et entre quand la souris arrive sur son parent (ou sur l'ancêtre que `of` désigne), sort quand elle le quitte ; le focus du clavier compte, au toucher un appui sur le parent la fait entrer et un appui ailleurs la fait sortir |

```html
<section *fly(up, distance: 60, on: view)>…</section>
<img src="photo.jpg" *shatter(on: scroll) alt="…">
<section *iris(on: scroll, range: 0 1000px)>…</section>
<h2 *fly(up, on: scroll, zone: 70% 40%)>…</h2>
```

`on: scroll` sans `range` suit le passage de la balise dans la zone visible : l'animation commence quand son haut atteint le bas de la zone et finit quand son milieu en atteint le milieu. `zone: début fin` choisit la bande de la zone où elle se joue — deux hauteurs, en % (`0%` en haut, `100%` en bas) ou en mots (`top`, `center`, `bottom`) : elle commence quand le haut de la balise passe la première et finit à la seconde ; `zone: 70% 40%` la joue autour du milieu. `range: début fin` la lie à une plage de défilement (en px, ou en `vh`) : `range: 0 1000px` l'étale sur les mille premiers pixels. La zone, c'est la fenêtre, ou le conteneur qui défile autour de la balise s'il y en a un (`overflow: auto`).

```html
<article class="carte"><img src="…"><p class="legende" *fly(up, on: hover)>Une légende</p></article>
<li class="ligne"><span>Nom</span><div class="actions"><button *scale(on: hover, of: '.ligne')>Retirer</button></div></li>
```

`on: hover` joue l'entrée de la transition, puis sa sortie (la même, à l'envers), avec ses réglages `duration`, `delay` et `easing` ; la souris qui revient en route repart d'où elle en est. `of: '.ligne'` désigne l'ancêtre le plus proche qui vérifie ce sélecteur à la place du parent ; `once`, `range` et `zone` n'y changent rien. Cachée, la balise garde sa place mais ne reçoit ni clic ni focus et n'est pas lue : le parent doit porter autre chose de focalisable (un lien) pour qu'un bouton caché entre au clavier. `*slide` et `*typewriter` ne gardent pas leur place : leur première image n'a pas la taille de la balise (une hauteur nulle, un texte vide), et c'est celle qu'elles ont au repos. Avec « réduire les animations », elle apparaît et disparaît d'un coup.

Avec « réduire les animations » (réglage du système), la balise reste à sa place, visible, sans mouvement ; ses événements `@introstart`, `@introend`, `@outrostart` et `@outroend` partent tout de suite.

## Ses propres transitions

**Dans le fichier d'effets de l'appli** (`*.effects.mjs`, cf. [38 · Effets](38-effets.md)) : une transition réglée une fois pour toutes, ou une transition CSS à soi — ses déclarations sont l'**état caché** : la balise entre en partant d'elles, sort en y allant.

```html
<effects>
  *entree = *fly(up, distance: 30px, duration: 250ms)

  *monte(y: 20px) =
    opacity: 0
    transform: translateY($y)
</effects>
```

```html
{if $ouvert}<div @in=*entree @out=*monte(y: 40px)>…</div>{end}
```

**En JavaScript**, pour ce que le CSS ne sait pas faire : `µanim.create nom, config` enregistre une transition, qui se pose ensuite comme les autres — `@in=*nom(…)`. Son nom ne doit pas être celui d'un effet de la bibliothèque.

**Un nom que rien ne définit arrête la construction.** `@in=*titre`, `@out=*titre` et `@transition=*titre` (avec `.global` ou `.shared`) n'acceptent qu'un effet de la bibliothèque, un effet de votre fichier `*.effects.mjs` (un script qui le cite par `µ.anim.titre` ne le rend pas inconnu), ou une transition que votre code crée par `µanim.create 'titre', …` (ou `µanim.crossfade 'base', …`, qui crée la paire `baseSend` et `baseReceive`), dans un composant ou dans un module `.civet` ou `.coffee` du dossier source. La construction lit l'appel **écrit tel quel** — `µanim.create` ou `µ.anim.create`, le nom en toutes lettres entre guillemets (un gabarit sans substitution, `` `titre` ``, en tient lieu) — et rien d'autre : un nom calculé (`µanim.create(nom, …)`), un appel fait par une variable qui contient `µ.anim` (`a = µ.anim`, puis `a.create 'titre'`), une déstructuration (`{ create } = µ.anim`), `globalThis.µ.anim` ou `µ['anim']` ne sont pas lus, et la transition est alors une erreur. Sinon l'erreur dit où le nom est écrit (le fichier et la ligne), propose le nom le plus proche parmi ceux que la directive accepte et rappelle comment créer la transition : `*titre = *fade(…)` dans un `*.effects.mjs`, ou `µanim.create 'titre', …`. Tant qu'un autre fichier du projet est en erreur de compilation, aucun nom introuvable n'est accusé : ce fichier peut être celui qui crée la transition, sa faute est dite d'abord.

### La forme `css`

La config fournit `duration`, `easing`, et une fonction `css(t, u)` qui renvoie un **objet de styles** ; `t` va de 0→1 (entrée) et `u = 1 - t` :

```html
<script>
  $visible = true

  µanim.create 'tourbillon',
    duration: 8000
    easing: µeasing.elasticOut
    css: (t, u)->
      transform: "scale(#{t}) rotate(#{t * 1080}deg)"
      color: "hsl(#{Math.trunc(t * 360)}, #{Math.min(100, 1000 * u)}%, #{Math.min(50, 500 * u)}%)"
</script>

{if $visible}
  <div @in=*tourbillon(duration: 8s) @out=*fade>
    <span>transitions !</span>
  </div>
{end}
```

Les réglages écrits à la pose (`duration`, `delay`, `easing`) l'emportent sur ceux de la config ; les autres réglages arrivent tels quels (une durée en millisecondes).

> ⚠️ `css` renvoie un **objet de propriétés** (`{ transform: …, color: … }`), pas une chaîne CSS.

### La forme `tick`

Quand l'animation a besoin de muter le DOM image par image (texte, canvas…), on passe à `µanim.create` une **fonction de setup** `(node, params)-> config`. Le setup s'exécute par nœud (capture en closure), et la config expose un `tick(t)` appelé à chaque frame :

```html
<script>
  $visible = false

  # setup par nœud : capture le texte, renvoie { duration, tick }
  µanim.create 'frappe', (node, {speed = 1} = {})->
    valid = node.childNodes.length is 1 and node.childNodes[0].nodeType is Node.TEXT_NODE
    throw new Error('Cette transition exige un unique nœud texte') unless valid

    text = node.textContent

    duration: text.length / (speed * 0.01)
    tick: (t)->
      i = Math.trunc(text.length * t)
      node.textContent = text.slice(0, i)
</script>

{if $visible}
  <p @transition=*frappe(speed: 2)>
    Le vif zéphyr jubile sur les kumquats du clown gracieux
  </p>
{end}
```

`*typewriter` applique exactement le même contrat : elle aussi exige un texte seul, et refuse le reste avec une erreur explicite plutôt que de continuer sur une structure qu'elle ne saurait pas restituer proprement.

<details>
<summary>🎓 <b>Pour débutants</b> — <code>css</code> ou <code>tick</code>&nbsp;?</summary>

`css` est préférable quand c'est possible : MJS génère de vraies keyframes CSS, l'animation tourne sur le compositeur du navigateur (fluide, hors du thread JS). `tick` est l'échappatoire pour ce que le CSS ne sait pas faire — réécrire du texte, dessiner dans un `<canvas>`, etc. — au prix d'un appel JS par frame.

</details>

## Événements de transition

Quatre événements DOM sont émis sur l'élément pendant ses transitions : `@introstart`, `@introend`, `@outrostart`, `@outroend`.

```html
<script>
  $visible = true
  $status = 'en attente…'
</script>
<p>statut : {$status}</p>

{if $visible}
  <p @transition=*fly(up, distance: 200, duration: 2s) @introstart={$status = 'intro démarrée'} @outrostart={$status = 'outro démarrée'} @introend={$status = 'intro terminée'} @outroend={$status = 'outro terminée'}>
    Vole en entrant et en sortant
  </p>
{end}
```

## Transitions globales — `.global`

Par défaut une transition ne se joue que si **son propre bloc** est ajouté/retiré. Avec le modificateur `.global`, posé sur la directive, l'élément s'anime aussi quand c'est un **bloc parent** qui apparaît/disparaît :

```html
{if $showItems}
  {for item in items.slice(0, $i)}
    <div @transition.global=*slide>
      {item}
    </div>
  {end}
{end}
```

> ⚠️ Sans `.global`, masquer le `{if $showItems}` entier ferait disparaître les `<div>` **sans transition** (seul leur ancêtre change, pas eux). `.global` est exactement fait pour ce cas : « animez-moi même quand c'est un parent qui bouge ».

### Le premier rendu n'anime pas — mais le montage, si

Aucune transition d'entrée ne joue sur le **premier** rendu d'un composant : sans cette règle, la page entière clignoterait au chargement. La frontière est le **rendu**, pas le chargement : tout ce qui vient après ce premier rendu anime normalement, y compris ce qui part du montage lui-même.

Concrètement, un état écrit depuis [`µmount`](16-cycle-de-vie.md#µmount--initialisation-unique) ou depuis le premier tir de [`µevery`](16-cycle-de-vie.md#µevery--répéter-en-partant-tout-de-suite) — tous deux exécutés *après* le premier rendu — déclenche un rendu suivant, et les nœuds que ce rendu crée jouent bien leur `@in`. C'est ce qui permet d'animer l'apparition d'un contenu dès l'arrivée sur la page **sans** marquer la transition `.global` :

```html
<script>
  $i =: -1

  µevery 2500, ->
    $i = ($i + 1) % $messages.length
</script>

{key $i}
  <p @in=*typewriter(speed: 100)>{$messages[$i] or ''}</p>
{end}
```

Le premier message se tape, comme les suivants.

## `.shared` — animation mutualisée

`.shared` se cumule avec `.global`, dans n'importe quel ordre — `@transition.global.shared=*fly(down, distance: 10)` est valide. Il bascule l'animation sur un `@keyframes` CSS injecté **une seule fois** et partagé par tous les nœuds qui l'utilisent, au lieu d'une animation par nœud : pensé pour la grosse volumétrie, des dizaines d'éléments qui apparaissent ensemble.

```html
{for item in items}
  <li @transition.shared=*fade>{item}</li>
{end}
```

> ⚠️ En mode `.shared`, une transition ne sait pas reprendre une interruption à mi-course : une nouvelle valeur affectée pendant l'animation ne prolonge pas le mouvement depuis sa position actuelle, elle redémarre à 0. Pour un élément qui bascule souvent, le mode standard (sans `.shared`) reste le bon choix.

> ⚠️ `.shared` posé sur `@in` vaut aussi pour le `@out` du même nœud : le mode se décide **pour le nœud**, pas directive par directive.

## `@childtransition` — cascade de sortie

Posé sur l'élément qui **enveloppe** un `{if}`/`{for}`/`{key}`, `@childtransition="all"` fait que le retrait de son contenu **attend** la sortie des descendants porteurs d'une transition, avant de les retirer du DOM. C'est une cascade de **sortie**, et rien d'autre : ça ne déclenche aucune entrée au premier rendu — ce rôle-là reste celui de `.global`, par élément. Les deux mécanismes sont distincts et se complètent.

```html
<div @childtransition="all">
  {if $visible}
    {for item in items.slice(0, $i)}
      <div @transition=*fade>
        {item}
      </div>
    {end}
  {end}
</div>
```

> ⚠️ Sans `@childtransition`, la fermeture de `{if $visible}` retirerait les `<div>` intérieurs **sans laisser jouer** leur transition (seul un descendant `.global` y échapperait, comme au paragraphe précédent). `@childtransition="all"` étend cette attente à **tous** les descendants porteurs d'une transition, sans avoir à marquer chacun `.global` individuellement.

`@childtransition` accepte `"all"`, `"out"` et `"transition"` — les trois valeurs se comportent à l'identique, `"all"` est la forme à écrire. Toute autre valeur ne fait **rien**, en silence.

## Transitions et `{key}`

Un bloc `{key expr}` re-monte son contenu à chaque changement de `expr` : l'ancien sort, le nouveau entre. C'est la combinaison idiomatique pour rejouer une transition d'entrée à chaque valeur :

```html
{key $i}
  <p @in=*typewriter(speed: 100)>
    {messages[$i] or ''}
  </p>
{end}
```

## `@flip` — réordonnancement de liste

`@flip` anime le **déplacement** d'un élément quand sa position change dans un `{for}` (technique FLIP : First-Last-Invert-Play). Forme courte `@flip=durée`, ou objet `@flip={duration: …}` :

```html
{for todo in $todos.filter((t)-> not t.done) by id}
  <li @flip=200>
    <span>{todo.description}</span>
  </li>
{end}
```

`mjs-flip-delay="600"` (attribut) ajoute un délai avant le glissement — utile pour laisser un cross-fade se terminer avant de réarranger :

```html
<li @transition=*crossfade(key: todo.id) @flip=200 mjs-flip-delay="600">…</li>
```

Côté liste qui **reçoit** l'élément, ce délai est ignoré et ramené à `0` — le trou d'accueil s'ouvre immédiatement, pour laisser le cross-fade atterrir sans attendre ; seule la liste qui **perd** l'élément respecte réellement `mjs-flip-delay`.

L'easing est une courbe CSS (`ease-out`, `cubic-bezier(…)`…) : une valeur que le navigateur refuse (le nom d'une courbe de `µeasing`, comme `elasticOut`) est remplacée par la courbe par défaut, une durée négative par la durée par défaut (200 ms), et les autres lignes glissent quand même. La durée, le délai et l'easing acceptent une **expression** — relue à chaque animation, donc pilotable en direct :

```html
<li @flip={duration: 200 * $ralenti}>…</li>
```

Une ligne placée sous un `{if}` à la racine de la boucle s'anime comme les autres, qu'elle soit là dès le départ ou qu'elle apparaisse plus tard :

```html
{for todo in $todos by id}
  {if todo.visible}
    <li @flip=200>{todo.description}</li>
  {end}
{end}
```

> ⚠️ `@flip` ne fonctionne que dans un `{for … by clé}` **keyé** : la clé du `by` reconnaît chaque ligne d'un rendu à l'autre. C'est elle qui dit à MJS qu'une ligne s'est *déplacée* (et non détruite puis recréée), et chaque ligne glisse depuis sa propre place. Sans `by`, la ligne est reconnue par l'`id` de son élément, à défaut par son rang à sa création : une ligne ajoutée plus tard peut alors partir de la place d'une autre.

Une ligne peut porter plusieurs balises `@flip`, à n'importe quelle profondeur de son gabarit : côte à côte, l'une dans l'autre, sous une même balise, sous un même `{if}` ou chacune sous le sien. Chacune est reconnue par la clé de la ligne et par sa place dans le gabarit de la ligne, et glisse depuis sa propre place, que les autres balises de la ligne soient là ou non :

```html
{for todo in $todos by id}
  <tr @flip=200>…</tr>
  {if todo.open}
    <tr @flip=200 class="detail">…</tr>
  {end}
{end}
```

```html
{for todo in $todos by id}
  <section>
    <h4 @flip=200>{todo.title}</h4>
    <p @flip=200>{todo.description}</p>
  </section>
{end}
```

Les branches d'un même `{if}` … `{else}` se partagent la place de leur balise : celle qui arrive part de la place de celle qui s'en va. Un `{for}` placé dans la ligne a ses propres lignes, donc ses propres places.

Dans un `{for}` placé dans un `{for}`, la ligne intérieure est reconnue par sa clé **et** par celle de chaque ligne qui l'enveloppe : deux groupes peuvent porter des lignes de même clé, et quand les groupes changent d'ordre, chaque ligne glisse depuis sa propre place, avec son groupe :

```html
{for groupe in $groupes by id}
  <div>
    {for ligne in groupe.lignes by id}
      <p @flip=200>{ligne.texte}</p>
    {end}
  </div>
{end}
```

Deux éléments de même clé dans un `{for … by clé}` n'ont pas d'identité sûre : la console l'avertit et seul le premier de chaque clé est rendu, la ligne qui porte une clé en double ne glisse pas et les autres glissent comme d'habitude. Donnez à chaque élément une clé unique pour que chaque ligne glisse.

## Cross-fade — une balise qui vole d'une liste à l'autre

Un cross-fade fait *voler* un élément d'un endroit vers un autre : il sort d'une liste et **réapparaît** dans une autre, à sa nouvelle position. `*crossfade` se pose sur le cycle de vie, avec une **clé** qui reconnaît l'élément d'une liste à l'autre :

```html
{for todo in $todos.filter((t)-> not t.done) by id}
  <li @transition=*crossfade(key: todo.id) @flip=200 mjs-flip-delay="600">…</li>
{end}

{for todo in $todos.filter((t)-> t.done) by id}
  <li @transition=*crossfade(key: todo.id) @flip=200 mjs-flip-delay="600">…</li>
{end}
```

Quand une todo passe de la liste « à faire » à « fait », elle a la **même clé** dans les deux listes : MJS apparie sa sortie d'un côté avec son entrée de l'autre et l'anime en vol d'une position à l'autre. La balise qui arrive reste invisible le temps de l'appariement (deux images) : une seule balise se voit à chaque image. Dans une liste triable `<@@sortable group>`, la ligne qu'on passe d'une liste à l'autre vole de la même façon (cf. [30 · Modules cœur](30-modules-coeur.md#sortable--liste-triable-par-glisser)). Sans homologue (une simple suppression, un simple ajout), c'est `fallback` qui joue : `scale` (elle rétrécit vers son centre en s'estompant, ou grandit depuis lui), `fade`, ou `none`.

| Réglage | Rôle |
|---|---|
| `key` | ce qui reconnaît l'élément d'une liste à l'autre : une variable de la boucle (`todo.id`), une variable (`$choix`), ou une valeur |
| `group` | les listes qui échangent leurs éléments : deux paires de listes indépendantes prennent deux groupes (`group: todos`, `group: photos`) ; sans groupe, toute la page n'en fait qu'un |
| `fallback` | `scale` (défaut), `fade`, `none` |
| `duration`, `delay`, `easing` | la durée suit la distance du vol quand elle n'est pas donnée |

<details>
<summary>🎓 <b>Pour débutants</b> — le rôle de la clé dans un cross-fade</summary>

Le cross-fade a besoin de savoir *quel* élément sortant correspond à *quel* élément entrant. La clé (`key: todo.id`) est ce lien : l'élément qui sort avec la clé `4` cherche un élément qui entre avec la clé `4` aussi, et MJS anime le vol entre les deux. Si personne ne « réceptionne » cette clé (l'élément a juste été supprimé), MJS joue le `fallback` à la place.

</details>

Pour une animation de secours faite main, `µanim.crossfade nom, config` crée la paire à la main : deux transitions `nomSend` (à poser sur `@out`) et `nomReceive` (sur `@in`), avec un `fallback` qui est une fonction `(node, params, isIntro)-> config` (forme `css`) :

```html
<li @in=*todoReceive(key: todo.id) @out=*todoSend(key: todo.id)>…</li>
```

## Animations fluides : `µinterpolate` et `µspring`

Au-delà des transitions d'entrée/sortie, deux **runes** animent en continu une valeur réactive. On les lit via `.current` (la valeur animée du moment) et on les pilote en **affectant** la rune (`$x = nouvelleCible`) — l'affectation est interceptée et anime *vers* la cible.

### `µinterpolate` — interpolation à durée fixe

`µinterpolate(valeurInitiale, duréeMs, min, max)` : transition à durée fixe vers chaque nouvelle cible (équivalent d'un *tween*). `min` et `max` (facultatifs) bornent la cible : `$progress = 150` avec `µinterpolate(0, 400, 0, 100)` anime vers `100`.

```html
<script>
  # $progress = X est intercepté → anime vers X ; .current = valeur courante
  $progress = µinterpolate(0, 400)
</script>

<div class="track">
  <div class="bar" @style.width="{$progress.current}%"/>
</div>

<button @click={$progress = 0}>0%</button>
<button @click={$progress = 25}>25%</button>
<button @click={$progress = 100}>100%</button>
```

### `µspring` — ressort (physique)

`µspring(valeurInitiale, raideur, amortissement, min, max)` : anime via un modèle de ressort (rebond naturel), idéal pour suivre un pointeur ou réagir à une saisie. `min` et `max` (facultatifs) bornent la valeur animée, pour une valeur simple (un nombre) — une valeur animée porte ses bornes elle-même : elle ne se déclare pas dans le bloc `<vars>` ([37 · Types](37-types.md)). La rune accepte une valeur **scalaire** (un nombre) **ou composite** (un objet `{x, y}`, ou un tableau) — dans les deux cas, **un seul ressort** pilote toutes les composantes avec une raideur/amortissement **partagés** : pas besoin d'un ressort par axe. `.stiffness` et `.damping` sont modifiables à chaud.

```html
<script>
  # UN ressort pour les deux axes — {x, y}
  $ball = µspring({ x: 120, y: 120 }, 0.1, 0.25)

  $stiffness = 0.1
  $damping = 0.25

  # propager les réglages live au ressort
  µeffect ->
    $ball.stiffness = $stiffness
    $ball.damping = $damping

  track = (e)->
    $ball = { x: e.offsetX, y: e.offsetY }   # affecter la cible : le ressort tend vers elle
</script>

<div class="field" @mousemove={track}>
  <div class="ball" @style.left="{$ball.current.x}px" @style.top="{$ball.current.y}px"/>
</div>
```

> ⚠️ On lit **toujours** `.current` dans le HTML du composant (`$ball.current`, ou `$ball.current.x` pour une composante d'un objet/tableau), jamais `$ball` directement : `$ball` est l'objet rune, `.current` est la valeur animée. Et on **affecte** `$ball = …` pour fixer une nouvelle cible — c'est l'affectation qui déclenche l'animation, pas une mutation de `.current`. Une valeur **scalaire** simple (`$x = µspring(120, 0.1, 0.25)`, `.current` = un nombre) reste parfaitement valide quand un seul axe suffit.

<details>
<summary>🎓 <b>Pour débutants</b> — interpolation ou ressort&nbsp;?</summary>

`µinterpolate` met *exactement* la durée demandée pour aller à la cible, en suivant une courbe (easing) : parfait pour une barre de progression, une valeur chiffrée, un timing maîtrisé. `µspring` n'a pas de durée fixe : il *poursuit* la cible avec une inertie de ressort (accélère, dépasse un peu, revient) — c'est ce qui donne le côté vivant quand on suit la souris ou qu'on réagit à un geste.

</details>

## Easing — `µeasing`

L'objet `µeasing` (alias `µ.easing`) fournit les courbes standard : `linear`, `cubicIn/Out/InOut`, `quintOut`, `elasticOut`, `bounceOut`, `backInOut`, `circOut`, `expoOut`, etc. On les passe au paramètre `easing` d'un `µanim.create`, d'un `µinterpolate`… Dans les réglages d'une transition, elles s'écrivent en mots avec des tirets : `*fly(up, easing: elastic-out)`.

> ⚠️ **Dans un attribut du HTML**, employez la forme **pointée** `µ.easing.X` : `@click={µ.easing.cubicOut(0.5)}`. La forme courte `µeasing` (sans point) n'est réécrite en `µ.easing` que dans un `<script>` ; dans une interpolation `{…}` elle resterait littérale → `ReferenceError`.

`easing` accepte aussi une **chaîne CSS** — `'linear'`, `'ease'`, `'ease-in'`, `'ease-out'`, `'ease-in-out'`, ou `'cubic-bezier(x1, y1, x2, y2)'` — partout où une courbe `µeasing` est attendue. `µ.easing.bezier(x1, y1, x2, y2)` rend la fonction JS équivalente. Dans les deux cas, `x1`/`x2` hors de l'intervalle [0, 1] retombe sur `cubicOut`, avec un avertissement en mode debug.

---

📚 **Apprendre en pratiquant** : ces notions se répartissent sur trois sections du tuto interactif — **Transitions** (directive, réglages, entrée et sortie, CSS & JS, événements, transitions globales), **Animation** (valeurs interpolées, ressorts) et **Transitions avancées** (transitions différées, cross-fade, `@flip`).
