# 41 · `µrefresh` — signaler un changement fait hors de MJS

MJS voit tout changement fait par une variable `$` du composant : `$sel.n = 5`, `$l.push(x)`, `Object.defineProperty($sel, 'n', { value: 5 })`. Il ne voit pas un changement fait **hors de MJS** dans l'objet ou la liste que tient `$x` : par une bibliothèque, par un script extérieur au composant, ou par votre propre code à travers une variable sans `$` qui garde le même objet. Juste après un tel changement, écrivez `µrefresh($x)` (ou `µrefresh $x`, seul sur son instruction) : ce qui affiche `$x` se redessine, et les valeurs dérivées qui le lisent se refont. Pour l'objet que tient une clé du magasin, écrivez de même `µrefresh($$x)` (cf. plus bas, « Ce que fait `µrefresh($$x)`, pour un magasin »). Avec le réglage `"proxy": false`, ce que MJS voit de lui-même se réduit aux écritures que le compilateur écrit en appels de MJS : cf. [plus bas](#le-réglage-proxy-false).

> 🔗 Le modèle de réactivité, les valeurs dérivées et l'option `derived` : [3 · Réactivité](03-reactivite.md). Le crochet où l'on branche une bibliothèque : [16 · Cycle de vie](16-cycle-de-vie.md). Toute la syntaxe en tableaux : [22 · Aide-mémoire](22-aide-memoire.md).

## La scène : un taux changé par un script extérieur

La page donne au composant un objet qu'un autre script garde aussi — un convertisseur de devises, par exemple —, et ce script change le taux lui-même : `o.taux = 2`.

```html
<script>
  $commande = { taux: 1, prix: [10, 20] }
  $vues = 0
  # calcul simple : reste à l'horloge
  $double = $commande.taux * 2
  # précise : elle appelle des méthodes de liste
  $lignes = $commande.prix.map((p) -> p * $commande.taux).join(' · ')
  @choisir = (o) -> $commande = o
  @compter = -> $vues += 1
</script>
<p>{$commande.taux + ' | ' + $double + ' | ' + $lignes + ' | ' + $vues}</p>
```

**Avant — sans `µrefresh` :**

1. La page appelle `choisir(o)`, avec `o = { taux: 1, prix: [10, 20] }` : l'écran montre `1 | 2 | 10 · 20 | 0`.
2. Le convertisseur écrit `o.taux = 2`. MJS n'en sait rien : l'écran ne bouge pas.
3. Un clic appelle `compter()` : le composant écrit `$vues` et redessine le paragraphe. `$commande.taux` se relit (2) ; `$double`, à l'horloge, se refait (4) ; `$lignes`, précise, sert son dernier calcul, car aucune variable qu'elle lit n'a été écrite. L'écran montre `2 | 4 | 10 · 20 | 1` : un taux de 2, et des lignes au taux de 1.

En production, rien de plus : l'utilisateur voit ces chiffres faux. En développement, le même écran, et, au clic, un avertissement dans la console :

> La valeur dérivée « $lignes » du composant `<mjs-commande>` a servi son dernier calcul alors que son recalcul donne autre chose : une donnée qu'elle lit a sans doute été changée hors de MJS (bibliothèque, script extérieur, objet gardé dans une variable sans `$`). Juste après ce changement, écrivez µrefresh($commande). Cet avertissement n'existe qu'en développement : la valeur servie reste celle de la production.

**Après — le convertisseur, juste après `o.taux = 2`, appelle une méthode du composant qui le signale :**

```html
<script>
  @signaler = -> µrefresh($commande)
</script>
```

L'écran suit : `2 | 4 | 20 · 40 | 0`, en développement comme en production, sans avertissement. Aucun `µeffect` n'est relancé. `$lignes` s'est refaite, et reste désormais à l'horloge (cf. plus bas, « Ce que fait `µrefresh($x)` »).

## Pourquoi la précision par défaut en a besoin

Par défaut, le compilateur classe chaque valeur dérivée (cf. [3](03-reactivite.md)) : **précise**, elle ne se refait que quand une variable `$` qu'elle lit est écrite ; **à l'horloge**, elle se refait à sa lecture après toute écriture du composant. La précision épargne les calculs inutiles : une boutique de 400 valeurs précises relues après chaque clic sur le panier passe de 160 à 250 ms à 1 à 1,5 ms pour 20 clics. Son revers : une valeur précise ne se périme que par une écriture que MJS voit. Une donnée changée hors de MJS ne la périme pas — elle garde son dernier calcul, même quand le composant écrit ensuite une autre variable. À l'horloge, la même valeur se serait refaite à cette autre écriture, sans rien dire et avec un temps de retard (`$double` dans la scène). `µrefresh($x)` remet tout d'aplomb, aussitôt après le changement.

`mjs check --derived` dit, pour chaque fichier, quelles valeurs dérivées sont précises (cf. [32](32-cli-et-configuration.md)).

## Le développement vérifie, la production va au plus vite

Les deux modes servent la même valeur ; seul le développement vérifie.

- **En production**, une valeur précise sert son dernier calcul tant qu'aucune de ses sources n'est écrite, sans rien vérifier : c'est tout son gain. Le code de la vérification n'est pas livré : le cœur de production ne le porte pas.
- **En développement**, MJS rend ce gain pour vous surveiller : chaque fois qu'une valeur précise va servir son dernier calcul alors que l'horloge l'aurait refaite (le composant a écrit une autre variable), il la refait à part, et compare les deux résultats. Égaux, rien. Différents, une donnée qu'elle lit a été changée hors de MJS, ou lue par un `Proxy` de votre application qui la prend dans un autre objet (cf. [03](03-reactivite.md), `µraw`) : l'avertissement nomme la valeur et le composant, et dit quoi écrire (`µrefresh($commande)` dans la scène) ; quand la valeur lit un accesseur propre à un objet (cf. `Object.defineProperty` plus bas) qui rend autre chose qu'à son dernier calcul, il nomme cet accesseur au lieu de parler d'un changement fait hors de MJS : ce qu'il lit a pu être écrit par MJS lui-même. La valeur servie reste celle de la production : l'écran du développement montre le défaut tel que l'utilisateur le verrait, l'avertissement dit d'où il vient.

L'idée : le contrôle se paie pendant que vous écrivez et essayez l'application, là où il sert ; l'application livrée garde toute la vitesse de la précision. Un `µrefresh` oublié se voit dès que vous essayez, en développement, le geste qui l'expose.

Ce que coûte et ce que voit la vérification :

- en développement, au plus le calcul que l'horloge aurait fait, plus la comparaison ; en production, rien ;
- la comparaison suit les listes, les objets, les `Map` et les `Set` sur 6 niveaux ; au-delà, et pour un objet qui se contient lui-même, elle tient deux objets pour égaux : aucun avertissement plutôt qu'un faux ;
- un avertissement par valeur et par composant ;
- elle ne part qu'à une écriture du composant : tant que rien n'est écrit, rien n'est comparé, et l'horloge n'aurait rien refait non plus ;
- une valeur à l'horloge (un calcul simple comme `$double`, ou une valeur précise repassée à l'horloge : objet tenu aussi par un autre composant, objet gelé, accesseur d'une classe…, cf. [3](03-reactivite.md)) suit à l'écriture suivante, sans avertissement.

## Ce que fait `µrefresh($x)`

- Il redessine ce qui affiche `$x`, et ce qui affiche une autre variable du composant qui tient le même objet ; sur une valeur primitive, ce qui l'affiche ; une liste qui affiche `$x` relit toutes ses lignes, brutes comprises (marquées `µraw`, une à une ou par `µraw(liste, true)`) : c'est ainsi qu'une ligne brute changée sur place se montre. Sans `µrefresh`, cette écriture reste invisible.
- L'enfant qui reçoit `$lignes` en prop relit lui aussi toutes ses lignes, brutes comprises.
- Il refait les valeurs dérivées qui lisent `$x` ; précises, elles repassent à l'horloge pour toujours : elles rendent toujours la bonne valeur, sans le gain de la précision.
- Le signal reste sur l'objet que tient `$x` : ce qui affiche une valeur à l'horloge qui lit une variable qui le tient (`$x`, ou une autre variable qui tient le même objet) suit ensuite les écritures profondes du composant, même faites par une autre variable — un accesseur posé sur l'objet avant que `$x` le reçoive, qui lit une ligne que le composant change par `$ligne.prix = 20` ; une `Map`, l'instance d'une classe ou un objet gelé rangés dans l'objet de `$x` (`$x = {m: new Map(…)}`), que MJS ne voit pas à cette profondeur : l'écran suit à chaque écriture, sans un second `µrefresh`. Un changement fait hors de MJS, lui, en demande un à chaque fois ; un nouvel objet rangé dans `$x` n'a pas de signal.
- Il ne relance aucun `µeffect` (ni `µeffect.before`), pas même un reffet qui lit une valeur dérivée de `$x` refaite par lui : pour relancer un effet, écrivez une nouvelle valeur (`$x = [...$x]`).
- Il ne prévient pas le parent lié par `!{…}`.
- L'enfant à qui le composant donne `$x`, ou un objet lu sous `$x` (prop, liaison, ligne d'un `{for}` : `item={$x}`, `item={$x.a}`, `item={r}`), se rafraîchit aussi : il se redessine et refait ses valeurs dérivées, sans relancer ses `µeffect`, et ses propres enfants de même, de proche en proche. `$x` n'est pas parcouru : seuls sont touchés les enfants à qui une liaison redonne un objet que `$x` atteint — pas celui qui tient l'objet d'une autre variable, même placé dans un bloc de `$x` (`{for r in $x.l}<@fiche item={$p}>{end}`) ou redonné dans le même rendu.
- Il sert avec la précision comme avec l'option `"derived": "clock"`, en développement comme en production.
- Il fait relire toutes les lignes des listes `{for}` de `$x` à leur prochaine passe, y compris celles qui gardent leur objet (voir plus bas).
- Il fait refaire la recherche d'une entrée d'une `Map` ou d'un `Set` sous une autre forme (`µrefresh($$x)` de même) : une clé rangée sous son enveloppe par du code hors de MJS (`lib.set($rows[1], 2)` sur la collection gardée sans `$`) se retrouve ensuite par l'objet brut comme par toute enveloppe (cf. [3](03-reactivite.md)).
- Il fait regarder de nouveau ce que rangent les collections que lisent les valeurs à l'horloge (`µrefresh($$x)` de même) : après un changement fait hors de MJS dans une `Map` ou un `Set` — une entrée ajoutée sur la collection gardée sans `$`, un objet gelé après avoir été rangé —, `µrefresh($m)` remet l'écran à jour (cf. [3](03-reactivite.md)).

## Ce que fait `µrefresh($$x)`, pour un magasin

Juste après un changement fait hors de MJS dans l'objet que tient une clé du magasin — par une bibliothèque, ou par `µread($$panier)` —, écrivez `µrefresh($$panier)` (ou `µrefresh $$panier`, seul sur son instruction).

- Il redessine ce qui affiche la clé, dans chaque composant qui la lit, et ce qui affiche une autre clé qui tient le même objet.
- L'enfant à qui l'un de ces composants donne un objet lu sous la clé (`item={$$panier.client}`) se rafraîchit aussi, comme après `µrefresh($x)`. Un nom pris sur un chemin fixe du magasin (`t := $$panier.client.adresse` puis `t.ville = 'Lyon'`) le prévient sans rien de plus, comme l'écriture directe (`$$panier.client.adresse.ville = 'Lyon'`) : le compilateur relit le chemin au moment de l'écriture et, s'il mène encore au même objet, écrit par lui. C'est le signal à écrire après une écriture faite par un nom que le compilateur ne suit pas, plus bas que l'objet que tient l'enfant : `t.n += 1`, `t.n++`, `delete t.n`, une méthode (`t.l.push(x)`) — seule l'affectation simple `t.ville = v` est suivie —, un nom réaffecté ou pris sur un appel (`t := $$l.find(f)`), une écriture faite dans un module `.civet` ou `.coffee` importé, ou un chemin qui ne mène plus à l'objet du nom (objet remplacé entre-temps : l'écriture va à l'objet que tient le nom). De même : une écriture plus profonde que le nom (`fiche.suite.champ = v` quand `fiche` est le nom pris), un nom pris sur une clé qui n'est plus à portée au moment de l'écriture (`trouve = $$s.items[k]` dans une boucle sur `k`, puis `trouve.c = 5` après elle), `t.n += f()`, `t.l.push(f())`.
- Il refait les valeurs dérivées qui lisent la clé.
- Il ne relance aucun `µeffect`, ni d'un composant ni du fichier d'un magasin : pour en relancer un, écrivez une nouvelle valeur (`$$panier = {...$$panier}`). Un reffet qui lit la clé et l'appelle ne se relance pas lui-même ; il repart quand une autre partie de l'appli écrit la clé.
- Il s'écrit dans le script, dans un gestionnaire d'événement, dans le `<script module>` ou dans le fichier d'un magasin, en développement comme en production.
- `$$panier = $$panier`, la clé écrite avec sa propre valeur, est refusé à la construction : écrivez `µrefresh($$panier)`. Une autre écriture du même objet (`$$panier = o`, `o` gardé ailleurs) ne prévient de rien.

## Où l'écrire

Dans le script — la méthode qu'appelle la page ou la bibliothèque, l'écouteur qu'elle pose (`µon`, `addEventListener` dans `:attach` ou dans `µmount`) — ou dans un gestionnaire d'événement du gabarit : `@click={µrefresh($x)}`, `@blur={…}`. Toujours juste après le changement fait hors de MJS.

```html
<script>
  # Carte : une bibliothèque qui crée son objet, le garde et le change elle-même
  $carte = Carte.creer()
  Carte.surDeplacement -> µrefresh($carte)
</script>
<p>{$carte.centre.lat}, {$carte.centre.lng}</p>
```

## Un objet de liste changé hors de MJS

Une liste `{for}` dont tout changement de contenu passe par MJS ne relit, à un échange, un retrait ou un ajout, que les lignes qui changent d'objet ([3 · Réactivité](03-reactivite.md), « Une liste propre ») : une ligne dont l'objet a été changé hors de MJS garde son ancienne valeur à l'écran.

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

- Sans `µrefresh` : `@ajouter`, `@changer`, `@echanger` — la ligne de clé 7 montre `h`.
- Avec `µrefresh` : `@changer = -> tenu.label = 'h2'; µrefresh($data)` — toutes les lignes sont relues, `h2` paraît.

En développement, la liste compare les lignes qu'elle saute à ce qu'elles montrent, sans toucher à l'écran, et dit le premier écart, une fois par liste et par composant : « [ModularJS] <@liste> : la ligne de clé 7 de $data a changé sans passer par MJS : écrivez µrefresh($data) après ce changement. » La production ne fait pas cette comparaison.

## Appelé pendant un rendu ou un calcul : appliqué juste après

`µrefresh` n'est jamais ignoré. Appelé pendant un rendu ou pendant le calcul d'une valeur dérivée, il est appliqué juste après ce rendu, comme une écriture faite par un effet. C'est le cas d'un écouteur que le rendu déclenche — sous Chromium, le rendu qui retire le champ qui a le focus émet `blur` et `focusout` ; `el.focus()` dans `:attach` émet `focus` et `focusin` ; un `el.click()` lancé par une fonction du gabarit émet `click` —, qu'il soit un gestionnaire du gabarit (`@blur={…}`), un écouteur `µon` ou l'écouteur qu'une bibliothèque pose elle-même, même quand il déplace le focus ou attend (`await`) avant de l'appeler, et quel que soit le nombre d'écouteurs du même événement : l'écran suit.

## Les formes refusées à la construction

`µrefresh` n'accepte qu'une variable `$` que le composant déclare, ou une clé du magasin (`$$x`) ; hors d'un composant — dans le `<script module>` ou dans un module importé, le fichier d'un magasin compris —, une clé du magasin seulement. Tout le reste arrête la construction, à sa ligne, par un message qui dit quoi écrire :

| Écrit | Refusé parce que | Écrivez |
|---|---|---|
| `µrefresh($total)`, `$total` étant une valeur dérivée | elle se refait d'elle-même quand une variable qu'elle lit change | `µrefresh` sur la variable `$` qu'elle lit, celle que le changement a touchée |
| `µrefresh($nom)`, sans `$nom = …` dans le composant | le composant ne déclare aucune variable `$nom` | déclarez-la, ou corrigez son nom |
| `µrefresh($a.b)`, `µrefresh($$panier.lignes)` | un chemin | la variable ou la clé qui tient l'objet : `µrefresh($a)`, `µrefresh($$panier)` |
| `µrefresh(liste)` | une variable sans `$` : MJS ne la suit pas | gardez l'objet dans une variable `$`, et signalez-la |
| `µrefresh(µ$$panier)`, `µrefresh(§§cfg)` | un état de module (`µ$$x`, un `µStore` compris) ou un contexte (`§§x`) : `µrefresh` ne les signale pas | une nouvelle valeur, écrite dedans : `µ$$panier.lignes = [...µ$$panier.lignes]`, `§§cfg = {...§§cfg}` |
| `µrefresh($x)`, `µrefresh(µ$$panier)`, dans le `<script module>` ou dans un module importé (le fichier d'un magasin compris) | ce code n'appartient à aucun composant : il n'a pas de variable `$` à signaler, et un état de module ne se signale pas par `µrefresh` | `µrefresh($x)` dans le `<script>` ou un gestionnaire d'événement ; pour l'état de module, une nouvelle valeur écrite dans la clé touchée : `µ$$panier.lignes = [...µ$$panier.lignes]`, et dans le fichier du magasin, où l'objet ne se remplace pas, `µ$panier.lignes = [...µ$panier.lignes]` |
| `$x = $x`, `$$panier = $$panier` — avec ou sans espaces, `;`, parenthèses autour d'un côté —, dans le script, un gestionnaire, le `<script module>` ou le fichier d'un magasin | la variable ou la clé écrite avec sa propre valeur ne dit pas ce que vous attendez | `µrefresh($x)`, `µrefresh($$panier)` ; pour relancer les reffets, une nouvelle valeur (`$x = [...$x]`, `$$panier = {...$$panier}`) |
| `µ$$panier = µ$$panier` | un état de module ne se signale pas par `µrefresh` | une nouvelle valeur écrite dans la clé touchée : `µ$$panier.lignes = [...µ$$panier.lignes]` |
| `µrefresh()`, `µrefresh($a, $b)`, `µrefresh $a, $b` | aucun ou plusieurs arguments | une variable par appel : `µrefresh($a)`, puis `µrefresh($b)` |
| `µrefresh $x or $y`, `µrefresh $x if …` | sans parenthèses, Civet lirait `µrefresh($x or $y)` | les parenthèses : `µrefresh($x)` |
| `{µrefresh($x)}`, ou dans une valeur d'attribut, `:attach`, l'expression d'un bloc `{if}`, `{key}`, `{for}` ou `{await}` | c'est le rendu qui l'évalue, et le redessin qu'il demande relancerait ce rendu, sans fin | un gestionnaire d'événement (`@click={µrefresh($x)}`) ou le script |

## Les mauvais usages qui bouclent

**Une fonction que lit le gabarit.** `@g = -> µrefresh($x)` puis `{@g()}` : chaque appel redessine ce qui la relit, qui la rappelle — une boucle de rendu, comme avec toute écriture faite là (`$x = …`). Après 10 000 rendus dans la même rafale, MJS cesse de rendre le composant, pour garder la page vivante ; la production coupe la boucle de même, sans avertissement. En développement, un avertissement le dit :

> µrefresh($x) est appelé pendant chaque rendu du composant `<mjs-liste>` (une fonction que lit le gabarit, ou un écouteur que ce rendu déclenche à chaque fois), et chaque appel redessine ce que ce rendu affiche : une boucle, que MJS a coupée. Écrivez µrefresh($x) dans le script ou dans un gestionnaire d'événement, juste après le changement fait hors de MJS ; une fonction que lit le gabarit ou une valeur dérivée ne doit pas l'appeler. Cet avertissement n'existe qu'en développement : la production coupe la boucle de même.

**Une valeur dérivée.** Seule, une valeur dérivée qui l'appelle ne boucle pas — une écriture faite par son propre calcul ne la périme pas —, mais elle redessine à chacun de ses calculs. Deux valeurs dérivées dont chacune rafraîchit une source de l'autre se refont l'une l'autre en boucle ; au-delà de 1 000 appels dans la même rafale, un avertissement de développement le dit :

> µrefresh($x) est appelé par le calcul de la valeur dérivée $d du composant `<mjs-liste>`, plus de 1 000 fois dans la même rafale : deux valeurs dérivées dont chacune rafraîchit une source de l'autre se refont l'une l'autre en boucle. Une valeur dérivée ne doit pas appeler µrefresh : écrivez µrefresh($x) dans le script ou dans un gestionnaire d'événement, juste après le changement fait hors de MJS. Cet avertissement n'existe qu'en développement.

La règle tient en une ligne : `µrefresh($x)` s'écrit dans le script ou dans un gestionnaire d'événement, juste après le changement fait hors de MJS — jamais dans une fonction que lit le gabarit, jamais dans le calcul d'une valeur dérivée.

## `Object.defineProperty`

- **Par la variable**, une définition est une écriture, comme l'affectation : `Object.defineProperty($sel, 'n', { value: 5 })`, `Object.defineProperty($l[1], 'sel', { value: true })` — les valeurs qui lisent la variable se refont et l'écran suit, sans `µrefresh`. Une clé absente créée à `undefined`, un indice au-delà de la longueur d'une liste, un attribut changé seul (`{ enumerable: false }`, `{ writable: false }`) ou un accesseur sont des écritures. Seule une définition qui ne change rien ne refait rien : la propriété est déjà une donnée propre de l'objet, et chaque attribut donné y est déjà le même selon `Object.is` (`NaN` défini sur `NaN` ne change rien, `-0` défini sur `0` change la donnée).
- **Sur l'objet gardé ailleurs** (`Object.defineProperty(o, 'n', …)`, `o` étant l'objet que tient `$sel`), c'est un changement fait hors de MJS : écrivez `µrefresh($sel)` juste après.
- **Un accesseur** posé par la variable (`Object.defineProperty($l, 0, { get: … })`) fait repasser à l'horloge, pour toujours, les valeurs précises qui lisent la variable ; celui d'une classe aussi, à sa lecture, même quand il rend `undefined` au départ. Un accesseur propre à l'objet, posé sur l'objet lui-même avant que la variable le reçoive (sur l'objet brut gardé ailleurs, sur une ligne d'une liste reçue toute faite), ne se regarde pas : quand ce qu'il lit change, hors de MJS ou même par MJS (une autre variable `$` du composant qui écrit l'objet qu'il lit, ou la variable `$` qu'il lit lui-même), la valeur précise garde son dernier calcul. Écrivez `µrefresh($l)` juste après le changement, ou rangez la valeur dans un champ plutôt que dans un accesseur ; en développement, l'avertissement nomme l'accesseur que la valeur lit (`$l[0].p`) quand il rend autre chose qu'au dernier calcul, jamais un autre accesseur du même objet. `µrefresh($l)` fait repasser à l'horloge les valeurs précises qui lisent `$l`.

## Le réglage `"proxy": false`

- Avec `"proxy": false` dans `mjs.config.json` (cf. [11](11-etat-brut.md#le-réglage-proxy-false--aucun-objet-enveloppé) et [32](32-cli-et-configuration.md)), aucun objet n'est enveloppé. Les écritures que le compilateur écrit en appels de MJS redessinent comme par défaut : `$o.a.b = 2`, `$o.n++`, `$o.a += 1`, `$o.b ||= 5`, `[$o.a, $o.b] = [$o.b, $o.a]`, `delete $o.a`, `$l.push(x)`, `$m.set(k, v)`, `$s.add(x)`, `$d.setUTCDate(5)`, à toute profondeur et par un indice ou une clé de toute forme (`$l[i].n++`, `$l[$i].n = 5`, `$l[i + 1].n = 1`, `$o[$k] = 1`, `$l[$l.length] = x`), par la variable d'une boucle `{for x in $l}`, ou d'une boucle sur une liste calculée qui en garde les objets (`{for x in $l.filter(f)}`, comme `slice`, `toSorted`, `toReversed`), ou le paramètre d'un rappel écrit sur place (`@click={x.n++}`, `$l.forEach((x) -> x.n++)`), y compris une valeur lue en tête d'instruction (`x.n++ || f()`), par la tête d'une boucle du script (`for ($o.k of l)`) ; un champ écrit par un enfant lié à deux sens (`items=!{$rows}`, `$items[0].nom = v`) se voit chez le parent et chez les autres enfants liés au même objet ; `++` et `--` y gardent la conversion de JavaScript (un `BigInt` reste un `BigInt`). Un nom pris sur un chemin fixe (`t := $o.a.b` puis `t.c = 5`) écrit par ce chemin, relu au moment de l'écriture. Si le chemin ne mène plus à l'objet du nom (`it := $rows[i]`, puis `i++`, puis `it.x = 1`), l'écriture se fait dans la ligne prise au départ sans rien redessiner : écrivez `µrefresh($rows)` juste après. Tout autre changement de l'objet attend `µrefresh($o)` : une variable sans `$` qui garde l'objet sans chemin fixe, un élément rendu par une méthode (`$l.find(f).n = 1`), un élément de liste tenu sans chemin (`for (const y of $l) y.n++`, `$l.filter(f).forEach((x) -> x.n++)`, `arr[i].n = 1` quand `arr` est la liste reçue en 3e paramètre d'un rappel, `{for x in $l.map(f)}`), un élément d'une boucle `{for}` écrit par un rappel de transition (`@introend={x.n++}`), par une clé qui agit (`x.tags[k++] = 1`) ou, sur une liste calculée, après une attente (`await`), `Object.assign($o, …)`, `Object.defineProperty($o, …)`, une méthode d'une classe à vous, une fonction qui reçoit l'objet, un changement fait hors de MJS. La construction signale ceux qu'elle repère, avec le fichier et la ligne, et conseille `µrefresh` ; jamais sans le réglage, ni pour une valeur qu'elle sait simple (type chaîne, nombre ou booléen du `<vars>`, ou valeur simple à chaque écriture du composant : `envoyer($msg)` n'est pas signalé).
- `µrefresh($x)` y fait ce qu'il fait par défaut : ce qui affiche `$x`, et ce qui affiche une autre variable du composant qui tient le même objet, se redessine ; l'enfant qui tient un objet lu sous `$x` se rafraîchit aussi. Un nom pris sur un chemin fixe de l'état (`t := $o.a.b` puis `t.c = 5`, `t.n++`, `delete t.c`) n'en a pas besoin : le compilateur relit le chemin au moment de l'écriture et, s'il mène encore au même objet, écrit par lui (cf. [11](11-etat-brut.md#le-réglage-proxy-false--aucun-objet-enveloppé)). C'est le signal d'une écriture faite par un autre nom, que MJS ne voit pas sans enveloppe : réaffecté, tiré d'un motif, reçu en paramètre, pris sur `$o` seul, sur un appel (`t := $o.get(k)`) ou sur une clé qui agit (`$o[k++]`), ou l'objet passé à une fonction qui l'écrit (`ecrire(t)`) — la construction les signale. La règle du chemin fixe s'abstient aussi, et `µrefresh($o)` reste requis, pour une écriture plus profonde que le nom (`fiche.suite.champ = v` quand `fiche` est le nom pris), un nom pris sur une clé qui n'est plus à portée au moment de l'écriture (`trouve = $o.items[k]` dans une boucle sur `k`, puis `trouve.c = 5` après elle), `t.n += f()`, `t.l.push(f())`. Sans enveloppe, MJS ne sait pas d'où vient un objet : l'enfant qui en reçoit un pendant ce rendu se rafraîchit aussi, même s'il vient d'une autre variable, ou qu'une autre variable du composant tient elle-même l'objet (`$sel = $rows[0]`, puis `µrefresh($rows)` : l'enfant de cette ligne suit).
- Une valeur dérivée précise qui lit un objet ou une liste y suit la règle de l'horloge : elle se refait après toute écriture du composant, et après `µrefresh($x)` ; la vérification du développement ne la concerne pas.

## L'option `"derived": "clock"`

- Dans `mjs.config.json` (cf. [32](32-cli-et-configuration.md)), `"derived": "clock"` met toutes les valeurs dérivées à l'horloge : elles se refont à leur lecture après toute écriture du composant. Après un changement de l'option, relancez `mjs dev`.
- Aucune valeur précise, donc aucune comparaison ni avertissement en développement.
- `µrefresh($x)` y sert de même : sans lui, l'écran ne suit un changement fait hors de MJS qu'à l'écriture suivante du composant (comme `$double` dans la scène) ; avec lui, aussitôt.
- `mjs check --derived` dit le mode de l'appli, et ce que la précision changerait.
- En production, une appli dont aucun composant n'a de valeur dérivée garde le cœur de la règle de l'horloge, quelle que soit l'option ; `µrefresh($x)` y fait ce qu'il fait en développement.
