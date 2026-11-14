# 11 · État brut — `µraw`

> 📚 Tuto interactif correspondant : **Chapitre 10 — État brut**. Les encarts 🎓 *Pour débutants* dépliables donnent l'explication pas-à-pas ; le corps de la page reste la référence dense.

`µraw(données)` marque une structure comme **non réactive en profondeur** : MJS n'installe aucun suivi sur ses champs ni ses éléments. La **réassignation** de la variable, elle, reste pleinement réactive. C'est l'outil pour les données **remplacées en bloc** (un nouvel objet/tableau à chaque mise à jour) où tracer les mutations partielles serait du gaspillage — puisqu'il n'y en a jamais.

## Syntaxe

```html
<script>
  $data = µraw(poll())          # $data est une variable réactive…
                                # …mais le tableau qu'elle contient n'est pas tracé champ par champ

  µevery 200, immediate: false, ->
    $data = µraw(poll())        # on REMPLACE en bloc → re-rendu déclenché
</script>
```

À chaque tour, `poll()` renvoie un **nouveau tableau** qui remplace l'ancien. La réassignation `$data = …` est réactive et déclenche le re-rendu ; mais MJS ne perd pas de temps à envelopper chaque valeur du tableau dans un proxy de suivi.

<details>
<summary>🎓 <b>Pour débutants</b> — réactif « en profondeur », ça veut dire quoi&nbsp;?</summary>

Avec un `$` normal, MJS surveille **tout** : la variable elle-même, mais aussi chaque champ des objets et chaque case des tableaux qu'elle contient. Vous pouvez faire `$liste[3].nom = 'x'` et l'affichage suit. Ce suivi a un coût : MJS doit « emballer » chaque sous-valeur.

`µraw` dit : « cette donnée, je la remplacerai toujours en entier, jamais case par case — ne surveillez pas l'intérieur ». MJS ne surveille alors que la **variable** : dès que vous lui donnez une **nouvelle** valeur (`$data = …`), l'écran se met à jour. Mais modifier l'intérieur (`$data[0] = …`) ne déclenche rien. Vous gagnez en performance là où le suivi fin ne servait à rien.

</details>

## Réassigner, ne pas muter

C'est le point à retenir. `µraw` ne suit **pas** les mutations en place :

```html
<script>
  $prices = µraw([10, 20, 30])

  # ✗ ne re-rend PAS — mutation en place d'un raw :
  #   $prices.push(99)
  #   $prices[0] = 0

  # ✓ nouvelle référence → re-rendu :
  ajouter = -> $prices = µraw([...$prices, 99])
</script>
```

> ⚠️ Muter un `µraw` en place (`$prices.push(…)`, `$prices[0] = …`) ne met **pas** à jour le DOM : aucun suivi ne couvre ces changements. Pour rafraîchir l'affichage, créez une **nouvelle référence** et réaffectez. C'est exactement le pattern *immuable* (façon Redux).

### Listes `µraw` affichées par `{for}`

Quand une liste `µraw` est remplacée, MJS ne relit pas les lignes qui n'ont pas bougé. Une ligne est laissée telle quelle si toutes ces conditions sont réunies :

- l'élément est le **même** qu'avant, à la **même position** — ou à une autre quand la ligne n'affiche pas sa position (`{index}`) : une ligne qui ne fait que glisser (suppression, échange, insertion avant elle) n'est pas relue ;
- l'élément est une valeur simple (nombre, texte) ou un objet lui-même marqué `µraw` — ou la liste entière a été marquée avec ses lignes, par `µraw(liste, true)` (plus bas) ;
- la ligne ne lit que son élément et sa position : texte `{ligne.champ}`, `{index}`, attributs construits avec eux seuls, classe par sélection `:class{$choix === ligne.id}`.

Une ligne qui lit une variable du composant, appelle une fonction, ou contient un `{if}`, un `{for}` ou un composant est toujours relue. Laissée telle quelle ou non, ses gestionnaires (`@click`…) reçoivent l'élément de la ligne et sa position d'aujourd'hui.

```html
<script>
  $lignes = µraw([])

  # chaque élément est µraw, la liste aussi : seules les lignes remplacées sont relues
  charger = (donnees) -> $lignes = µraw(donnees.map((d) -> µraw(d)))
</script>

{for ligne in $lignes by id}
  <li>{ligne.nom}</li>
{end}
```

> ⚠️ Ne modifiez pas sur place un élément `µraw` d'une liste `µraw` en comptant sur la réaffectation de la liste pour le rafraîchir : sa ligne n'est pas relue. Remplacez l'objet par un nouveau.

### Toute une liste d'un coup — `µraw(liste, true)`

Marquer chaque ligne coûte un appel par ligne. `µraw(liste, true)` marque la liste **et** note que toutes ses lignes sont brutes, sans en marquer aucune : un seul appel, quelle que soit la longueur. Dans le `{for}` qui parcourt cette liste, les conditions ci-dessus valent alors comme si chaque objet était marqué `µraw` — sauf pour une liste déjà affichée, voir le tableau : une ligne qui garde son objet (et sa position, si elle l'affiche) est laissée telle quelle.

Avant — un appel par ligne, plus un pour la liste :

```html
<script>
  charger = (donnees) -> $lignes = µraw(donnees.map((d) -> µraw(d)))
</script>
```

Après — un seul appel :

```html
<script>
  charger = (donnees) -> $lignes = µraw(donnees, true)

  # une ligne change : un objet neuf à sa place, dans une liste marquée à son tour
  renommer = (id, nom) -> $lignes = µraw($lignes.map((l) -> l.id === id ? { ...l, nom } : l), true)
</script>
```

**Quand vous en servir.** Pour une grande liste dont vous prévenez vous-même les changements : vous remplacez la liste, ou l'objet d'une ligne, à chaque mise à jour, et rien d'autre n'écrit dans ses lignes. Pour 1 000 lignes, ce sont 1 000 appels et 1 000 marques de moins à la création, aucune marque gardée en mémoire, et rien à chercher par ligne quand la liste repasse.

**Le piège de la copie.** La note est posée sur l'objet liste : une copie ne l'a pas. `$lignes = $lignes.filter(f)`, `.slice()`, `.map(f)`, `[...$lignes]` ou `.concat(x)` rangent une liste ordinaire — l'écran reste juste, mais la liste et chacune de ses lignes sont de nouveau suivies, et le gain est perdu sans un mot. Marquez la copie : `$lignes = µraw($lignes.filter(f), true)`.

**Ce qui diffère du marquage ligne à ligne.** Avec `true`, aucune ligne ne porte de marque : la note ne vaut que pour la liste qui la porte, dans son `{for}`.

| Situation | Chaque ligne marquée `µraw` | `µraw(liste, true)` |
|---|---|---|
| Ligne qui garde son objet, dans le `{for}` de la liste (à clé, sans clé, avec `{index}`) | laissée telle quelle | laissée telle quelle |
| Ligne ajoutée après coup (`push`, `splice`, `liste[i] = objet`) | à marquer elle aussi, sinon relue à chaque passe | couverte, rien à écrire |
| Liste remplacée par une copie non marquée | la liste est suivie, ses lignes restent brutes | la liste et ses lignes sont suivies |
| Ligne rangée dans une autre variable (`$choix = $lignes[3]`), puis écrite par elle | brute partout : rien ne se redessine | objet ordinaire hors de sa liste : ce qui affiche `$choix` se redessine, la ligne de la liste reste telle quelle |
| Ligne donnée à un composant enfant (`item={ligne}`), qui l'écrit | brute chez l'enfant : il ne se redessine pas | suivie chez l'enfant comme un autre objet |
| Liste dans une liste | chaque niveau se marque | `true` ne descend pas : une sous-liste n'est ni marquée ni notée, marquez-la à son tour |
| Liste d'abord rangée ordinaire dans une variable `$`, puis marquée (elle-même ou son filtre) | ses lignes restent suivies : une écriture sur place se voit | ses lignes sont laissées telles quelles : écrivez `µrefresh` de la variable, ou remplacez l'objet de la ligne |
| `Set`, `Map` ou objet parcouru par `{for}` | leurs éléments se marquent un à un | `true` y est sans effet : il ne vaut que pour un tableau |

Dans les deux cas, une ligne brute modifiée sur place n'est pas relue par une passe ordinaire de la liste : écrivez `µrefresh($lignes)` juste après (la liste relit alors toutes ses lignes, une fois), ou remplacez son objet par un neuf. Écrite par une autre variable ou par un enfant, la ligne d'une liste marquée avec `true` peut donc montrer sa nouvelle valeur ailleurs et l'ancienne dans sa liste : écrivez `µrefresh($lignes)`, remplacez l'objet, ou marquez cette ligne (`µraw(ligne)`) si elle doit rester brute partout.

Le second argument est `true`, et rien d'autre : `µraw(liste, 1)` ou `µraw(liste, 'oui')` marquent la liste sans la note. La note ne se retire pas : `µraw(liste)` ou `µraw(liste, false)`, appelé ensuite, la laisse. Sur autre chose qu'un tableau, `true` est ignoré, sans erreur : `µraw(x, true)` vaut `µraw(x)`. Avec le réglage `"proxy": false`, les mêmes règles valent.

En production, cette part du cœur n'est emportée que si le code du projet appelle `µraw` avec un second argument : une appli qui ne l'écrit pas ne porte pas un octet de plus. Si l'appel vient d'un script que la construction ne lit pas (une bibliothèque chargée à part), demandez cette part par la clé `runtime` de `mjs.config.json` — `"all"`, ou `rare_runes` dans votre liste (cf. [22 · Aide-mémoire](22-aide-memoire.md)) ; sans elle, `true` y reste sans effet : la liste est `µraw`, ses lignes sont relues ; de même par un autre nom (`r = µ.raw`) ou par une clé calculée (`µ[k]`) : écrivez l'appel en clair, `µraw(liste, true)` ou `µ.raw(liste, true)`.

Une `WeakMap` ou un `WeakSet` déjà rangé dans l'état (`$vus`, ou celui de `µ.state` ou d'un `µStore`) a son enveloppe : `µraw($vus)` rend la vraie collection, à donner à une bibliothèque qui appelle ses méthodes natives (`WeakMap.prototype.get.call(µraw($vus), k)`), sans rien marquer — `$vus` garde son enveloppe, et ses écritures redessinent. Rangée dans une autre variable `$`, la collection rendue reprend une enveloppe (`$b = µraw($vus)`). Avec `"proxy": false`, la variable d'un composant tient déjà la vraie collection : donnez `$vus` tel quel — `µraw($vus)` la marquerait, et ses écritures ne redessineraient plus. Pour ranger une collection brute, donnez-la à `µraw` à l'affectation : `$vus = µraw(new WeakMap())`. Cette enveloppe n'existe que dans l'appli dont le code nomme `WeakMap` ou `WeakSet`, ou qui la demande par `"collections": true` dans `mjs.config.json` ([03 · Réactivité](03-reactivite.md)). `µraw` ne lit aucune propriété de l'objet qu'on lui donne : un objet qui refuse les lectures (le `Proxy` strict d'une bibliothèque) se range comme un autre.

## Quand l'utiliser — `µraw` vs `$`

| Situation | Choix |
|---|---|
| État manipulé champ par champ, mutations fines attendues (`$todo.done = true`, `$liste.push(…)` depuis un handler) | `$` réactif |
| Donnée **remplacée en bloc** à chaque mise à jour (sondage d'API, flux temps réel) | `µraw` |
| Gros jeu de données figé après chargement, dont on ne lit qu'un sous-ensemble (table de 100 000 lignes affichée par `<@@virtual>`, cf. [30 · Modules cœur](30-modules-coeur.md#virtual--liste-virtuelle), dictionnaire) | `µraw` |
| Objet exigé **nu** par une lib tierce (Three.js, D3, contexte `<canvas>`, WebGL) qui n'attend pas de wrapper réactif | `µraw` |
| Valeur à passer à `structuredClone` (Worker, `postMessage`, IndexedDB) — un Proxy réactif n'est jamais clonable, même lu via `µread` | `µraw` |

<details>
<summary>🎓 <b>Pour débutants</b> — comment je choisis&nbsp;?</summary>

Posez-vous une seule question : **« est-ce que je vais modifier l'intérieur de cette donnée, ou la remplacer en entier&nbsp;? »**

- Vous cochez une case, vous ajoutez un élément, vous changez *un* champ → vous modifiez l'intérieur → gardez un `$` normal, qui suit ces changements.
- Vous recevez un nouveau tableau complet du serveur toutes les secondes, vous chargez une grosse table une fois pour toutes → vous remplacez (ou vous ne modifiez jamais) → `µraw`, plus léger.

Dans le doute, restez sur `$` : `µraw` est une **optimisation** pour un cas précis, pas le comportement par défaut.

</details>

## Le réglage `"proxy": false` — aucun objet enveloppé

Par défaut, chaque objet et chaque liste rangés dans une variable `$` sont enveloppés (un Proxy) : MJS voit ainsi toute écriture qui passe par la variable, et aussi un changement fait hors de son code. Avec `"proxy": false` dans `mjs.config.json` (cf. [32](32-cli-et-configuration.md)), rien n'est enveloppé : `$o` tient l'objet lui-même, comme une donnée `µraw`, et lire `$o.a.b` est une lecture JavaScript ordinaire. Le paquet ne porte plus le code de l'enveloppe, en développement comme en production : les deux se comportent de même.

Redessinent encore d'eux-mêmes, car le compilateur les écrit en appels de MJS — à toute profondeur, et par un indice ou une clé de toute forme : un nombre, une variable avec ou sans `$`, une expression (`$l[0].n`, `$l[i].n`, `$l[$i].n`, `$l[i + 1].n`, `$o[$k]`, `$l[$l.length]`) :

- l'affectation d'un champ : `$o.a.b = 2` ;
- les formes qui lisent avant d'écrire : `$o.n++`, `--$o.n`, `$o.a += 1` (comme `-=`, `*=`, `/=`, `%=`, `**=`, `<<=`, `>>=`, `>>>=`, `&=`, `|=`, `^=`), `$o.b ||= 5`, `&&=`, `??=` — leur valeur reste celle de JavaScript (`++` et `--` convertissent comme le langage : un `BigInt` reste un `BigInt`, `'5'` donne 6), un indice qui agit (`$l[k++].n += 1`) n'est calculé qu'une fois, et un `||=` qui n'a rien à écrire ne redessine rien ;
- les cibles d'un motif : `[$o.a, $o.b] = [$o.b, $o.a]` ;
- `delete $o.a` ;
- une méthode qui modifie une liste, une `Map`, un `Set` ou une `Date`, appelée par la variable : `$l.push(x)`, `$l.sort()`, `$m.set(k, v)`, `$s.add(x)`, `$d.setUTCDate(5)`, `$o.quand.setUTCHours(3)` ;
- la variable d'une boucle `{for x in $l}` du gabarit (`@click={x.n++}`, `@click={x.tags.push(1)}`) et le paramètre d'un rappel écrit sur place (`$l.forEach((x) -> x.n++)`, comme `map`, `filter`, `some`, `every`, `find`, `reduce`…), quand la liste est nommée par un chemin (`$l`, `$o.items`, ou l'élément d'une boucle qui l'entoure : `{for c in row.cells}`) : l'écriture passe par l'indice de l'élément, vérifié à chaque écriture — si la liste ne tient plus cet objet à cet indice (une `Map`, un `Set`, une liste changée entre-temps), l'écriture reste celle de JavaScript. De même la variable d'une boucle du gabarit sur une liste calculée qui garde les objets d'une liste de l'état, dans leur ordre ou non : `{for x in $l.filter(f)}`, comme `slice`, `toSorted`, `toReversed`, enchaînés (`$l.filter(f).slice(0, 5)`) — l'élément est retrouvé dans `$l` par son identité, dans un gestionnaire qui n'attend pas (`await`). Une valeur lue en tête d'instruction y passe aussi (`x.n++ || f()`) ;
- un champ écrit par un enfant lié à deux sens (`<@editeur items=!{$rows}>`, qui écrit `$items[0].nom = v`) : le parent, et chez lui ce qui montre l'objet (la ligne d'une liste, l'enfant qui le tient par une prop, un autre enfant lié au même objet), se redessinent ;
- la tête d'une boucle du script qui écrit dans un champ : `for ($o.k of l)`, `for ($o.k in o)` ;
- l'affectation de la variable elle-même : `$o = …` ;
- l'écriture par un nom pris sur un chemin fixe de l'état : `t := $o.a.b` (ou `const t = $o.a.b`, `let t` jamais réaffecté, `t = $o.a.b` unique en CoffeeScript), puis `t.c = 5`, `t.n++`, `delete t.c`, `t.l.push(x)` — le compilateur relit le chemin au moment de l'écriture et, s'il mène encore au même objet, écrit par lui, comme `$o.a.b.c = 5` ; s'il mène ailleurs (objet remplacé entre-temps), l'écriture est celle de JavaScript, faite dans l'objet que tient `t`. Ainsi, après `it := $rows[i]`, puis `i++`, puis `it.x = 1`, la ligne prise au départ reçoit bien `x = 1`, mais rien ne se redessine : écrivez `µrefresh($rows)` juste après. Une clé faite d'un nom compte comme un chemin fixe (`t := $o.a[i]`). Un nom réaffecté, tiré d'un motif, reçu en paramètre, pris sur `$o` seul (`t = $o`), sur un appel (`t := $o.get(k)`, `$l.find(f)`) ou sur une clé qui agit (`$o[k++]`) n'en est pas : il reste signalé, plus bas ; l'objet que tient le nom et qu'une fonction écrit (`ecrire(t)`) aussi.

Ne redessinent plus d'eux-mêmes — écrivez `µrefresh($o)` juste après (cf. [41](41-refresh.md)). À la construction, MJS signale celles qu'il repère, avec le fichier et la ligne (« avec le réglage "proxy": false, MJS ne voit pas ce changement : s'il modifie l'objet, écrivez µrefresh($o) juste après ») ; sans le réglage, aucun de ces avertissements :

- une variable sans `$` qui garde l'objet sans chemin fixe (`t = $o`, puis `t.c = 9` ; un nom réaffecté, pris sur un appel ou sur une clé qui agit), un nom tiré d'un motif (`{ a } = $o`, puis `a.c = 9`), un élément rendu par une méthode (`it = $l.find(f)`, puis `it.n = 1`) ou tenu par une copie qui garde les objets (`$l.filter(f)[0].n = 1`, `c = $l.filter(f)` puis `c[0].n = 1`, `Object.values($m)[0].n = 1`, `[...$l][0].n = 1`, `$l.slice().reverse()[0]`) — signalé ;
- un élément de liste tenu sans chemin : la variable d'une boucle du script (`for (const y of $l) y.n++`), le paramètre d'un rappel posé sur une liste calculée (`$l.filter(f).forEach((x) -> x.n++)`), la liste reçue en 3e paramètre d'un rappel (`$l.forEach((x, i, arr) -> arr[i].n = 1)`), la variable d'une boucle du gabarit sur une autre liste calculée (`{for x in $l.map(f)}` puis `@click={x.n++}`), sur une liste calculée d'un élément de boucle (`{for c in row.cells.filter(f)}`) ou écrite après une attente (`@click={await f(); x.n++}`), une écriture d'un tel élément par une clé qui agit (`x.tags[k++] = 1`, `x.t[k++] += 1`) — signalés ;
- dans un rappel de transition (`@introstart`, `@introend`, `@outrostart`, `@outroend`), les mêmes formes, et la variable d'une boucle `{for}` qui l'entoure (`{for x in $l}<p :transition=*fade @introend={x.n++}>`) — signalés à la ligne de sa balise ; un nom que le rappel déclare lui-même (`x := { n: 0 }`) ou le paramètre d'une de ses fonctions (`[…].forEach((x) => x.n++)`) masque cette variable : ce qu'il écrit n'est pas l'élément, rien n'est signalé pour lui ;
- une fonction qui modifie l'objet qu'elle reçoit : `Object.assign($o, …)`, `Object.defineProperty($o, …)`, `Reflect.set($o, …)` — signalé ;
- une méthode d'une classe à vous appelée par la variable, une fonction à vous ou venue d'ailleurs qui reçoit l'objet, un rappel venu d'ailleurs qui reçoit les éléments (`$panier.vider()`, `trier($l)`, `$l.forEach(maj)`) — signalés quand leur valeur n'est pas lue (appelés pour leur effet) : `$total = somme($l)` ne l'est pas. Une valeur que le compilateur sait simple n'est jamais signalée, rien ne pouvant la modifier : une variable de type chaîne, nombre ou booléen dans le `<vars>`, ou dont chaque écriture du composant (script et gestionnaires) pose une valeur simple — `$msg = 'bonjour'` puis `envoyer($msg)`, `ws.send($msg)`, `history.pushState($delai, '')`. Dans le doute (une écriture d'une valeur inconnue, une liaison `=!{$msg}`), l'avertissement reste ;
- un élément tenu par une vue de la liste, sans avertissement : `{for x in trier($l)}` puis `@click={x.n++}`, `{for x in $c.filter(f)}` quand `$c` n'est pas une liste (un objet à vous qui a sa méthode `filter`) ;
- un objet reçu par une prop et que le parent remplace par un autre objet : la règle de la valeur simple ne voit que les écritures du composant ;
- un changement fait par une bibliothèque ou un script extérieur au composant ;
- un objet atteint par une autre variable : après `$sel = $items[0]`, l'écriture `$sel.n = 'Z'` redessine ce qui affiche `$sel`, pas la liste — écrivez `µrefresh($items)`.

Ces écritures que le compilateur ne suit pas restent celles de JavaScript, toujours faites (le `set` d'une classe à vous est appelé même à valeur égale, `-0` s'écrit sur `0`), à un refus près : aucune enveloppe ne lit plus `constructor` ou `__proto__` pour vous, alors MJS garde l'écriture qu'il voit partir de l'état. Il la voit par un élément trouvé (`$taches.find(f)`, `at`, `findLast`, `Array.prototype.find.call($l, f)`), la valeur que rend une méthode qui modifie la liste, la Map ou le Set (`$pile.pop()`, `shift()`, `splice(i, 1)[0]`, `sort(f)[0]`, `reverse()`, `fill(o)`, `copyWithin(i, j)`, `$m.set(k, v)`, `$s.add(x)`), tirée d'une virgule ou d'une attente (`(0, $pile.pop())[k].x = v`), la valeur lue par `Reflect.get($o, k)`, un élément d'une copie qui garde les objets (`$l.filter(f)[0]`, `Object.values($m)[0]`, `Object.entries($m)`, `Array.from($l)`, `[...$l]`, `[].concat($l)`, `Array.of(...$l)`, `$l.slice().reverse()`, `$l.map(f)`, `$l.flatMap(f)`), le champ d'un objet étalé (`({ ...$o }).a`), une variable, un champ (`@t` de CoffeeScript) ou un nom tiré d'un motif qui en tient une partie (`=`, `||=`, `??=`, `&&=`, `[t] = [$l.find(f)]`, une suite de noms liés l'un à l'autre, jusqu'à huit, dans n'importe quel ordre), la variable ou le motif d'une boucle `for … of` du script, le paramètre d'un rappel qui reçoit un élément (`forEach`, `map`…, `Array.prototype.forEach.call($l, f)`, les deux éléments d'un rappel de comparaison de `sort` et `toSorted`, écrit en place ou déclaré dans le script (`$l.sort(cmp)`, `cmp` déclaré par `function` ou `const`), l'accumulateur de `reduce` et `reduceRight` sans valeur de départ), le prototype lu par `Object.getPrototypeOf` ou `Reflect.getPrototypeOf`, la cible d'un motif (`[$l.find(f)[k].x] = [v]`) ou la tête d'une boucle (`for ($l.find(f)[k].x of l)`). Une telle écriture — `=`, `||=`, `+=`, `++`, `delete`, `push`, `||= yield v` compris — n'atteint jamais un prototype ni une fonction du navigateur, que partage toute la page : `$taches.find(f)[k].x = v`, où `k` vient de l'extérieur (adresse, formulaire, données reçues : `'constructor'`, `'__proto__'`), est refusée comme par un chemin compilé, et un avertissement le dit — le segment refusé, le piège de la fonction du navigateur en développement. Chaque clé calculée écrite dans la chaîne est jugée, `?.[k]` compris : une clé qui vaut `constructor`, `__proto__` ou `prototype` sans que l'objet lu la porte en propre est refusée, même quand elle mène à une classe de votre appli (`$taches.find(f)[k].isAdmin = true` n'écrit pas dans la classe des tâches) ; la clé calculée d'un motif (`const { [k]: c } = $taches.find(f)`, dans une déclaration, une affectation, une boucle ou un rappel) qui vaut l'un de ces noms et mène à une fonction (`constructor` hérité : une classe de votre appli, `Object`) ou à un prototype (`__proto__`, `prototype`) est refusée, et le nom reçoit `undefined` ; un champ de données de ce nom (`{ constructor: 'Renault' }`) est lu. `constructor` écrit dans le code y écrit (`$taches.find(f).constructor.compte = 0`). L'objet que modifie ou fige une fonction — son premier argument (`Object.assign($taches.find(f)[k], …)`, `Object.defineProperty`, `Reflect.set`, `Object.freeze`, `Object.seal`, `Object.preventExtensions`…), écrit tel quel, premier élément d'une liste écrite étalée (`Object.assign(...[x], …)`) ou passé par `call`, `apply` ou `Reflect.apply` (`Object.assign.apply(null, [x, …])`, `Reflect.apply(Object.assign, null, [x, …])`), et l'objet sur lequel `call` ou `apply` appelle une méthode d'une liste qui la modifie (`Array.prototype.push.call(x, v)`, `[].splice.call(x, 0, 0, v)`) — passe le même refus (la construction signale l'appel d'une fonction qui le modifie) : la fonction reçoit alors un objet gelé et échoue comme avec l'enveloppe (`Object.assign` et `Object.defineProperty` lèvent une `TypeError`, `Reflect.set` rend `false`, `Object.freeze` ne fige ni `Object` ni `Object.prototype`). Une écriture dans un objet de données (`$taches.find(f).n = v`, `$pile.pop().fait = true`) va à l'objet, comme JavaScript l'écrit.

**Limite.** Avec `"proxy": false`, MJS ne peut pas garder une écriture qu'il ne voit pas partir de l'état : un objet de l'état passé à une fonction, qui l'écrit (`ecrire($taches.find(f))`), rendu par une fonction (`g()[k].x = v`), rangé dans un objet littéral (`{ t: $taches.find(f) }`), reçu par un nom d'une expression à virgule ou d'une attente (`t = (0, $taches.find(f))`, `t = await $taches.find(f)`), copié par `Object.assign({}, $o)` ou `Object.fromEntries`, reçu par une fonction appelée sous un autre nom (`const { assign } = Object`, puis `assign(x, …)` ; `Object['assign'](x, …)`, `globalThis.Object.assign(x, …)`), modifié par `x.__defineGetter__(k, g)` ou `__defineSetter__`, l'accumulateur d'un `reduce` qui part d'une valeur de départ (`$l.reduce((a, t) => t, null)`), ou l'élément d'une boucle `{for}` du gabarit sur une liste calculée (`{for x in Object.values($m)}`, puis `@click={x[k].n = 1}` : signalé à sa ligne, pas gardé) s'écrit comme JavaScript l'écrit, `Object` et `Object.prototype` compris ; la clé de `Reflect.get($o, k)` n'est pas jugée (l'objet atteint l'est). Une clé venue de l'extérieur s'y vérifie par votre code (`Object.hasOwn(o, k)`, liste des clés permises), ou l'appli garde l'enveloppe (sans le réglage), qui ne laisse lire ni `constructor` ni `__proto__` hérités par les objets de l'état qu'elle rend.

Des objets bruts échappent à l'enveloppe : le prototype lu par `Object.getPrototypeOf($o)`, l'élément que reçoit le rappel de comparaison de `$l.sort(f)`, et la valeur que rend une méthode qui modifie l'état — `$l.pop()`, `shift()`, `splice(i, 1)`, `sort(f)`, `reverse()`, `fill(o)`, `copyWithin(i, j)`, `$m.set(k, v)`, `$s.add(x)` rendent l'objet brut, comme JavaScript le rend (`$l.pop() === o` est vrai pour l'objet `o` que vous aviez rangé, `structuredClone($l.pop())` copie, une lib tierce le retrouve par `indexOf`). Avec l'enveloppe comme avec le réglage, MJS garde l'écriture qui part d'eux dans le code : directe (`$l.pop()[k].x = v`, `(0, $l.shift())[k].x = v`, `$m.set(k, v).get(k)[k2].x = v`), par un nom, un champ (`@t` de CoffeeScript) ou un motif qui les reçoit (`t = $l.pop()`, `const [a] = $l.splice(0, 1)`, `const { [k]: c } = $l.pop()`), la variable d'une boucle `for … of` (`for (const t of $l.splice(0, 2))`), le paramètre d'un rappel écrit en place (`$l.splice(0, 2).forEach((t) => …)`, `$s.add(x).forEach(…)`), d'une fonction appelée en place (`((o) => …)(t)`) ou d'une fonction de comparaison déclarée une seule fois dans le script (`$l.sort(cmp)`, avec `function cmp(a, b) {…}`, `const cmp = (a, b) => …`, `cmp := (a, b) => …` en Civet, `cmp = (a, b) -> …` en CoffeeScript), une copie qui garde ses objets (`Object.values($l.pop())[0]`, `Object.entries(…)`, `Array.from($l.splice(0, 1))[0]`, `Object.assign({}, $l.pop()).a`), une liste ou un objet écrits qui la tiennent (`[0, $l.pop()]`, `{ t: $l.pop() }`, `o.t = $l.pop()` pour un objet `o` du script) et le nom qui les reçoit. Avec l'enveloppe, une écriture qui part de la collection que rend `sort`, `reverse`, `fill`, `copyWithin`, `set` ou `add` (`$l.sort(f)[0].x = v`) passe par l'enveloppe et redessine l'écran ; par un nom qui la tient (`s = $l.sort(f)`, puis `s[0].x = v`), elle est gardée sans redessiner : écrivez `µrefresh($l)` juste après.

**Hors de la garde.** MJS ne garde que l'écriture qu'il voit partir de ces objets dans le code du composant, et la construction n'en dit rien. Il ne suit plus une telle valeur, ni un nom, un champ, une liste, un objet ou une copie qui la tiennent, quand elle sort de ce code : passée à une fonction (`ecrire($l.pop(), k)`, `t = $l.pop()` puis `ecrire(t, k)`, `ecrire({ t: $l.pop() })`, `this.ecrire(t)`, `Promise.resolve(t)`), une fonction du script comprise, sauf celle qu'on appelle en place ; rendue par `return` (`g = () => $l.pop()`, puis `g()[k].x = v` ; CoffeeScript et Civet rendent la dernière valeur de chaque fonction, une boucle en dernière ligne comprise) ; lancée par `throw` ou donnée par `yield` ; passée à un gabarit étiqueté (``ecrire`${$l.pop()}` ``) ou à `µ.emit` ; rangée dans un objet que MJS ne suit pas (`window.t = $l.pop()`) ; reçue par une fonction de comparaison venue d'ailleurs (`$l.sort(cmp)` quand `cmp` est un paramètre, un import, une méthode `this.cmp` ou un nom affecté plusieurs fois ; déclarée une seule fois dans le script, ou écrite en place, elle est lue et ses éléments sont gardés, ci-dessus). Là, une écriture par une clé venue de l'extérieur s'écrit comme JavaScript l'écrit, `Object` et `Object.prototype` compris : vérifiez la clé (`Object.hasOwn(o, k)`, liste des clés permises), ou passez une copie (`structuredClone($l.pop())`).

Limite, avec ou sans le réglage : une écriture que MJS compile en chemin (`x.m[0] = v` sur l'élément d'une boucle `{for}`, `$o.a[0] = v`) relit ce chemin après avoir calculé la valeur, quand JavaScript fixe l'objet visé avant. Une valeur qui réordonne ou remplace la liste ou l'objet du chemin (`x.m[0] = ($l.reverse(), 'V')`) écrit donc dans l'élément qui occupe la place après ce changement. Calculez une telle valeur dans l'instruction d'avant (`v = ($l.reverse(), 'V')`, puis `x.m[0] = v`).

Une valeur dérivée que le compilateur prouve précise et qui lit un objet ou une liste suit alors la règle de l'horloge (cf. [3](03-reactivite.md)) : elle se refait à sa lecture après toute écriture du composant — toujours la bonne valeur, sans le gain de la précision.

## Lire / écrire un slot d'état sans réactivité — `µread` / `µwrite`

`µraw` (ci-dessus) marque une **donnée** entière comme non tracée. `µread` / `µwrite`, eux, sont un **accès ponctuel** au *même* slot qu'un `$x`, mais **hors du circuit réactif** :

- **`µread $x`** — lit la valeur courante **sans poser de dépendance**. Dans un `µeffect` ou un dérivé, le reffet ne se ré-exécute **pas** quand `$x` change.
- **`µwrite $x, v`** — écrit le slot **sans déclencher de re-rendu**. Les valeurs dérivées qui lisent le slot se recalculent, elles, à leur prochaine lecture : `$total` relu juste après rend la valeur à jour, seul l'écran attend. Même règle pour le store : `µwrite $$x, v` écrit la valeur brute sans prévenir personne, et les valeurs dérivées des composants qui lisent `$$x` se recalculent à leur prochaine lecture.

Les **parenthèses sont optionnelles**, comme pour tout appel en Civet : `µread($x)` et `µread $x` compilent à l'identique, `µwrite($x, v)` et `µwrite $x, v` aussi. Ce qui n'est **pas** accepté : autre chose qu'un symbole d'état en premier argument, ou une valeur introduite par un signe égal plutôt qu'une virgule — `µread(compteur)`, `µwrite($x) = v` sont refusés au build.

```html
<script>
  µeffect ->
    envoyer(@panier, µread $tva)   # RÉAGIT au panier, LIT la TVA sans s'y abonner :
                                    # changer $tva NE relance PAS ce reffet
</script>
```

Ici le reffet dépend du panier mais ne fait que **consulter** `$tva` : sans `µread`, lire `$tva` normalement abonnerait le reffet et le relancerait à chaque changement de taux — rarement voulu.

> ⚠️ `µwrite` **désynchronise volontairement** la donnée et l'écran : le slot est mis à jour, mais aucun binding `{$x}` ne se rafraîchit tant qu'une écriture **réactive** (`$x = …`) n'a pas eu lieu. À réserver aux cas de perf mesurés. Pour un stockage simplement **jamais affiché**, préférez `@x` (→ `this.x`), qui vit hors de `_state` et n'a jamais été réactif.

<details>
<summary>🎓 <b>Pour débutants</b> — « lire sans s'abonner », ça sert à quoi&nbsp;?</summary>

Un `µeffect` re-tourne **tout seul** dès qu'une variable `$` qu'il **lit** change. C'est souvent l'effet recherché. Mais parfois vous voulez juste **jeter un œil** à une valeur au passage, sans que le reffet en devienne l'esclave.

Exemple : un reffet qui réagit au **panier**, mais a seulement besoin de **connaître** le taux de TVA courant. Avec `$tva` normal, changer la TVA relancerait le reffet pour rien. `µread $tva` dit : « donnez-moi la valeur maintenant, mais ne me réveillez pas si elle bouge ». `µwrite`, c'est le miroir : « changez la valeur, mais ne réveillez personne ».

Dans le doute, vous n'en avez **pas** besoin : un `$x` normal convient **99 %** du temps. `µread` / `µwrite` sont des outils de précision.

</details>

> 🔗 Voir aussi : [Réactivité](03-reactivite.md) → état profond et piège de mutation (réaffecter pour forcer le re-rendu d'un `{for}`). Le même réflexe « réaffectez une nouvelle référence » s'applique, mais pour une raison différente : avec `µraw` c'est *obligatoire* (rien n'est tracé à l'intérieur), avec un `$` c'est un contournement du suivi statique.

---

📚 **Apprendre en pratiquant** : ce chapitre correspond au **Tuto interactif n°10 (État brut)** — `µraw` sur un cours boursier sondé toutes les 200 ms, remplacé en bloc à chaque tour.
