# 37 · Types et valeurs permises

> 📚 Pas de chapitre de tuto interactif dédié pour l'instant : cette page se suffit à elle-même. Les encarts 🎓 *Pour débutants* dépliables donnent l'explication pas-à-pas ; le corps de la page reste la référence dense.

Une variable, une prop ou un store peut dire **ce qu'il accepte** : un entier de 0 à 100, une couleur parmi trois, un texte de 3 à 20 lettres, tout sauf `'admin'`. La règle s'écrit une fois, dans le bloc `<vars>` du composant, et **chaque écriture** passe par elle, quelle que soit sa voie : le script, un bouton, un champ lié, une fonction qui reçoit l'objet, une clé calculée, une prop du parent.

```html
<vars>
  $volume   int 0..100
  $color    'red' | 'green' | 'blue'
  $nickname string 3..20 ! 'admin' | 'root'
</vars>

<script>
  $volume   = 50
  $color    = 'red'
  $nickname = 'ann'
</script>
```

La valeur de départ reste dans le `<script>`, comme avant : `<vars>` ne dit que la règle.

<details>
<summary>🎓 <b>Pour débutants</b> — à quoi ça sert&nbsp;?</summary>

Sans règle, rien n'empêche votre code d'écrire `$volume = 150` ou `$color = 'violet'` : la page affiche alors une valeur qui n'a pas de sens, et le bug se découvre plus tard, ailleurs.

Avec une règle, la variable se protège elle-même. Un volume de 150 devient 100 (le maximum). Une couleur inconnue est refusée : la variable garde sa couleur d'avant. Et pendant que vous développez, la console du navigateur vous dit ce qui s'est passé, avec la ligne fautive.

</details>

## Le bloc `<vars>`

- **Un seul** bloc par composant, **avant** le `<script>` (la règle se lit avant le code qui écrit la variable) ; placé après, le build s'arrête et le dit.
- Une ligne par variable : son nom, puis sa règle. `$nom` pour une variable ou une prop, `$$nom` pour un store.
- `#` commence un commentaire (hors d'un texte entre guillemets) ; une règle d'objet peut tenir sur plusieurs lignes tant que son accolade est ouverte.
- Aucun attribut sur la balise. Un partiel `<@include>` ne porte pas de `<vars>` : déclarez les types dans le composant qui l'inclut.

```html
<vars>
  # le son
  $volume    int 0..100
  $settings
    volume  int 0..100
    bass?   int -10..10
  $$cart
    quantity  int 1..99
</vars>
```

## Ce qu'une règle accepte

| Règle | Accepte |
|---|---|
| `int 0..100` | un entier de 0 à 100 |
| `float 0..1` | un nombre (à virgule ou non) de 0 à 1 |
| `int 0..` · `float ..10` | une seule borne : au moins 0, au plus 10 |
| `int` · `float` | n'importe quel nombre (pour `int`, arrondi à l'entier le plus proche) |
| `string 3..20` | un texte de 3 à 20 caractères (la plupart des émojis comptent pour un) |
| `string /^[a-z0-9_]+$/` | un texte qui a cette forme (`/…/i` accepté, jamais `g` ni `y`) |
| `bool` | `true` ou `false` |
| `'red' \| 'green' \| 1` | une de ces valeurs exactement |
| `string[] 0..10` | une liste de 0 à 10 textes |
| `int 1..5[]` | une liste d'entiers de 1 à 5 (la plage suit `int`, pas la liste) |
| le nom seul, puis un champ par ligne en retrait (`volume  int 0..100`, `bass?  int`) | un objet dont le champ `volume` passe sa règle ; `bass` est facultatif ; les autres champs sont libres |
| `int 0..10 \| 'auto'` | un entier de 0 à 10, ou `'auto'` |

**Une plage de nombres dit toujours `int` ou `float`** : `0..100` seul est refusé au build, le message propose les deux écritures.

### Les valeurs interdites : après le `!`

Tout ce qui suit un `!` est **interdit** ; tout ce qui le précède est permis. La partie permise peut être vide : tout est alors permis, sauf la liste.

```html
<vars>
  $role      ! 'admin' | 'root'              # tout, sauf admin et root
  $nickname  string 3..20 ! 'admin'           # un texte de 3 à 20 caractères, sauf « admin »
  $level     int 0..100 ! 40..60              # une plage entière peut être interdite
</vars>
```

Les interdits portent sur une valeur simple, pas sur une liste ni un objet : pour interdire des éléments, nommez leur règle (cf. *Les règles nommées*) — `Nick  string ! 'admin'`, puis `$tags  Nick[]`.

### Les listes : `[]`

`[]` après une règle dit « une liste de ». La plage qui suit `[]` compte les **éléments** ; celle qui précède `[]` s'applique à **chaque** élément.

```html
<vars>
  $tags     string[] ..5          # au plus 5 textes
  $notes    int 0..20[] 1..       # au moins une note, chacune de 0 à 20
</vars>
```

| Écriture | Résultat |
|---|---|
| `$notes = [12, 25]` | accepté : `25` est ramené à `20` |
| `$notes = ['15', 8.6]` | accepté : `'15'` devient `15`, `8.6` devient `9` |
| `$notes = []` | refusé : il faut au moins une note |
| `$tags.push('x')` alors qu'il y en a déjà 5 | refusé : la liste revient à ses 5 éléments |

Un nombre d'éléments hors plage n'est jamais « ramené » : couper une liste ou y inventer des éléments changerait son sens. L'écriture est refusée.

### Les objets : champs obligatoires, champs facultatifs

Un objet s'écrit en retrait sous son nom, un champ par ligne, chacun avec sa règle — jamais entre accolades. Un champ est **obligatoire**, sauf s'il porte un `?` juste après son nom : il devient **facultatif**. Un champ facultatif peut manquer ; s'il est là, il respecte sa règle.

```html
<vars>
  $settings
    volume  int 0..100
    bass?   int -10..10
</vars>
```

| Écriture | Résultat |
|---|---|
| `$settings = { volume: 50 }` | accepté : `bass` manque, il est facultatif |
| `$settings = { volume: 50, bass: 30 }` | accepté : `bass` est ramené à `10` |
| `$settings = { volume: 50, theme: 'dark' }` | accepté : un champ non déclaré reste libre |
| `$settings = { bass: 3 }` | refusé : `volume` manque, il est obligatoire |
| `delete $settings.bass` | accepté |
| `delete $settings.volume` | refusé |
| `$settings.volume = 150` | accepté : ramené à `100` |

<details>
<summary>🎓 <b>Pour débutants</b> — pourquoi un <code>?</code></summary>

Un réglage « volume » a toujours un sens : il est obligatoire. Un réglage « graves » peut ne pas exister (un appareil sans égaliseur) : il est facultatif. Le `?` le dit en un caractère, comme on le lit dans une phrase : « `bass`, s'il y en a un ». C'est la même marque qu'en TypeScript.

</details>

Un objet peut contenir un objet (son nom seul, ses champs un cran plus loin) et des listes. Une liste d'objets, ou un objet qui peut valoir `null`, passe par un type nommé, déclaré en retrait dans un fichier `*.types.mjs` ([plus bas](#les-règles-nommées--fichiers-typesmjs)) :

```html
<types>
  Track
    name    string
    length  int 1..
</types>
```

```html
<vars>
  $playlist
    title     string 1..40
    tracks    Track[] ..100
    shuffle?  bool
    owner
      name  string
  $current  Track | null
</vars>
```

### La valeur de départ d'un champ : `= valeur`

Avant la règle d'un champ, `= valeur` donne sa valeur de départ (`price = 0 int 0..` ; les espaces autour de `=` sont facultatifs : `price=0 int 0..`) : un champ **absent** — clé manquante, ou `undefined` — la prend, écrite dans l'objet. `null` n'est pas une absence : il passe par la règle du champ, comme toute valeur.

```html
<types>
  Reward
    id        int 1..
    price = 0 int 0..
    surprise = false bool
    tags = [] string[] ..5
</types>
```

| Écriture (sous `$reward  Reward`) | Résultat |
|---|---|
| `$reward = { id: 1 }` | accepté : `{ id: 1, price: 0, surprise: false, tags: [] }` |
| `$reward = { id: 1, price: undefined }` | accepté : `price` prend `0` |
| `$reward = { id: 1, price: null }` | refusé : `int 0..` n'accepte pas `null` (écrivez `price = 0 int 0.. \| null` pour le permettre) |
| `$reward.price = undefined` | `price` reprend `0` |

- La valeur de départ est un nombre, un texte entre guillemets, `true`, `false`, `null` ou une liste vide `[]` — une liste neuve pour chaque objet, jamais partagée.
- Elle passe la règle de son champ **telle quelle** : ni conversion, ni borne, rien d'interdit. `price = 0 int 1..` arrête le build, qui cite la ligne et la règle.
- Elle s'écrit dans la forme en retrait, d'un bloc `<types>` comme d'un `<vars>`, avant la règle : écrite après (`price  int 0.. = 0`), elle arrête le build, qui montre la forme à écrire (`price = 0 int 0..`). Dans le texte d'une règle que montre un message, le champ garde sa valeur de départ, à sa place (`price = 0  int 0..`).

## Ce qui arrive à une valeur

| La valeur écrite | Ce qui se passe |
|---|---|
| passe la règle | elle est écrite telle quelle |
| est d'un autre type, mais se **convertit** sans perte de sens | elle est convertie, sans bruit : `'42'` → `42` pour un `int` ou un `float`, `42` → `'42'` pour un `string`, `'true'` → `true` pour un `bool`, `'2'` → `2` si `2` est permis |
| est un nombre à virgule écrit dans un `int` | arrondie **au plus près** (`50.7` → `51`), sans bruit |
| est un nombre hors de sa plage | **ramenée** à la borne la plus proche (`150` → `100`) |
| ne passe pas, et ne se convertit pas | **refusée** : rien n'est écrit, la variable garde sa valeur d'avant |

L'ordre compte : conversion, puis plage, puis interdits. `int 0..10 ! 10` refuse donc `15` (ramené à `10`, et `10` est interdit).

Une liste ou un objet est contrôlé **en entier** : si un seul élément est refusé, toute l'écriture l'est, et rien n'est modifié à moitié. Accepté, il est corrigé **sur place** (l'objet reçu lui-même) : ses nombres ramenés, ses conversions faites.

### `strict` : la valeur exacte

`strict` en fin de règle demande la valeur exacte : ni conversion, ni nombre ramené à sa borne — une valeur qu'il faudrait corriger est refusée.

```html
<vars>
  $volume  int 0..100 strict
</vars>
```

| `$volume = …` | Sans `strict` | Avec `strict` |
|---|---|---|
| `50` | `50` | `50` |
| `'50'` | `50` (converti) | refusé |
| `150` | `100` (ramené) | refusé |
| `4.5` | `5` (arrondi) | refusé |

`strict` vaut pour la règle de sa ligne : une variable, un champ d'objet (sa valeur de départ en tête : `gain = 5 int 0..10 strict`), une règle nommée (`Percent  int 0..100 strict`). Il s'écrit dans le texte de la règle des messages (`permis : int 0..100 strict`). Son code n'entre dans l'appli que si une règle l'écrit, comme celui des valeurs de départ.

Une valeur de départ n'est pas une conversion : un champ absent la prend, puis `strict` juge les valeurs données. Avec une règle `Reward` dont le champ `price = 0 int 0..` a sa valeur de départ, `$r  Reward strict` accepte `{ id: 1, title: 'Thé' }` et lui donne `price: 0`, mais refuse `{ id: 1, title: 'Thé', price: '5' }`, qu'il faudrait convertir.

## Toutes les écritures passent

| Écriture | Contrôlée ? |
|---|---|
| `$volume = 150`, `+=`, `++`, la valeur de départ du `<script>` | oui |
| un champ lié `value=!{$volume}` (le texte tapé devient un nombre) | oui — à la sortie du champ (cf. [Un champ lié se garde de lui-même](#un-champ-lié-se-garde-de-lui-même)) |
| un champ ou un élément : `$settings.volume = 500`, `$tags[2] = 'x'` | oui, par la règle de son conteneur |
| une clé calculée : `$settings[cle] = 500` | oui, **à l'écriture**, avec la règle du champ `cle` |
| une fonction qui reçoit l'objet : `monter($settings)` | oui |
| une méthode d'une liste : `$tags.push(x)`, `splice`, `sort`… | oui — refusée, la liste revient à son état d'avant l'appel |
| `delete $settings.volume` (champ obligatoire) | refusé |
| le remplacement entier : `$settings = { volume: 500 }` | oui — l'objet reçu est corrigé sur place |
| une prop posée par le parent : `<@player volume={150}>` ou `volume="42"` | oui (le texte d'un attribut se convertit) |
| un composant enfant lié en deux sens : `<@panneau data=!{$settings}>` | oui — le parent est prévenu et corrige, des deux côtés |
| un composant enfant qui reçoit l'objet en liaison simple : `<@panneau data={$settings}>` | **non** — l'enfant surveille l'objet de son côté : liez en deux sens, ou déclarez le type dans le `<vars>` de l'enfant |

**La variable d'un `{for}` sur un store typé.** Dans un `{for}` sur un store typé, la variable de boucle est l'élément même de la liste, et elle écrit sous la règle du champ : `@click={f.id = 'zz'}` est refusé comme `$$flux[i].id = 'zz'` ou `$$flux.find((f) -> f.id == id).id = 'zz'`, avec le même message, et l'élément garde sa valeur d'avant. La variable d'une boucle du `<script>` aussi, dans les trois langues : Civet `for f of $$flux` (ou `for f in $$flux`), JavaScript `for (const f of $$flux)`, CoffeeScript `for f in $$flux`.

Le paramètre d'un rappel écrit sur place (`$$flux.forEach((f) -> f.id = 'zz')`, de même `map`, `filter`, `find`, `some`, `every`, l'élément de `reduce`), la variable d'une boucle sur une copie qui garde les éléments (`for f of $$flux.filter(…)`, `slice()`, `toSorted()`, `Array.from($$flux)`, `[...$$flux]`) et l'élément d'une telle copie (`$$flux.slice()[0].id = 'zz'`, ou atteint par `find`, `at`, `pop`, `shift` : `$$flux.filter(…).find(…).id = 'zz'`), comme le rappel de `Array.from($$flux, f)`, écrivent aussi sous la règle du champ, dans les trois langues. Une fonction nommée qui écrit l'élément qu'on lui passe (`regler = (f) -> f.id = 'zz'`, puis `regler($$flux[0])` ou `$$flux.forEach(regler)`) n'est pas suivie : MJS ne suit pas une valeur d'une fonction à l'autre. Écrivez alors dans un rappel posé sur place, ou par le chemin (`$$flux[i].id = v`).

Une **promesse** passe toujours (`$user = fetch('/api/user').then((r) -> r.json())`, lue par `{await}`) : sa vraie valeur arrive plus tard.

## Un champ lié se garde de lui-même

Un champ (`<input>`, `<textarea>`, `<select>`) lié à une variable typée reçoit **d'office** l'effet `*guard`, sans rien écrire :

```html
<vars>
  $age  int 18..120
</vars>

<input type="number" value=!{$age}>      ← se comporte comme <input value=!{$age} *guard>
```

- **Pendant la frappe**, une valeur hors de la règle ne part pas dans la variable : le champ garde ce qu'on tape. Taper « 120 » passe par « 1 » et « 12 » : le champ n'est pas réécrit « 18 » sous les doigts, `$age` garde sa dernière bonne valeur.
- **Une pause** (une seconde sans taper) sur une valeur hors de la règle : le champ fait « non » de la tête et une bulle dit ce qui est permis (« de 18 à 120 »), sans toucher à ce qui est tapé — on peut s'arrêter au milieu d'un nombre. `*guard(delay: 2s)` règle cette pause pour un champ, `"effects": { "guard": { "delay": "2s" } }` pour tous.
- **À la sortie du champ** (ou sur Entrée), une valeur hors de sa plage est ramenée à la borne (`300` → `120`, dans le champ ET dans la variable), une autre refusée rend le texte accepté en dernier, tel que vous l'aviez tapé (`007` reste `007`), ou la valeur de la variable quand votre code l'a écrite depuis (`$age = 40`), avec la secousse et la bulle.
- **Une liste simple** (`<select>`) liée à une variable de nombre (`int`, `float`) : une option qui écrit le même nombre autrement (`<option value="02">février</option>` sous `int 1..12`, `2.50` sous `float`) le porte — la choisir écrit `2`, sans bulle, et la variable qui vaut `2` la choisit, même quand l'option arrive après la liste (`{for}`). La variable choisit l'option qui écrit exactement son nombre : `2` ne choisit pas `2.4`, bien que `int` arrondisse à `2` le `2.4` qu'on choisit. Une variable libre choisit l'option de son texte exact (cf. [7 · Bindings two-way](07-bindings.md)). L'option vide (`<option value="">`) écrit `null` quand la règle refuse le texte vide et accepte `null` (`int 1..12 | null`, `string 1..5 | null`) : elle vaut « aucun choix », comme une liste à choix multiples sans choix et comme `µrules` sur un `FormData`, alors qu'un champ texte vidé puis quitté sous `string 1..5 | null` est refusé et revient à sa valeur, avec la bulle. Une règle qui accepte le texte vide (`string | null`) le reçoit tel quel ; sous une règle de nombre sans `null` (`int 1..12`), ce choix est refusé. Un choix refusé laisse la variable à sa valeur, et la liste revient sur le dernier texte accepté tant qu'il donne encore cette valeur (« 02 » sous `int 1..12` qui vaut 2), sinon sur l'option de cette valeur, celle que votre code a écrite en dernier comprise. Un nombre hors de sa plage est ramené à la borne, dans la variable et dans la liste, où l'option qui l'écrit est choisie (`05` pour `5`) ; sans option de la borne, la variable garde sa valeur et la liste revient à l'option de cette valeur (sans option de cette valeur non plus, écrite par votre code, la liste reste sans choix, comme la liaison la montre). La liste du cœur `<@@select>` liée à une variable de nombre choisit, garde et envoie avec le formulaire l'option qui écrit le nombre autrement selon la même règle, et ramène à la borne un nombre hors de sa plage (choisir `03` sous `int 5..12` écrit 5, et l'option `05` est choisie) ; elle juge chaque choix comme la liste native, par la même règle : un choix accepté, converti compris, reste montré et part tel quel (« 2.4 » sous `int` quand la variable vaut déjà 2 : elle reste à 2, la liste garde « 2.4 » et le formulaire envoie `2.4`) ; un choix que la variable refuse la laisse à sa valeur, et la liste revient sur le dernier texte accepté tant qu'il donne encore cette valeur, sinon sur l'option de cette valeur, que le formulaire envoie. Ainsi de `<@@option value="abc">` choisie sous `$k int 1..12`, qui vaut 2 : `$k` reste à 2, la liste revient à l'option de 2 et le formulaire l'envoie, ou sur « 02 » si vous veniez de choisir « 02 » ; de même pour son option vide sous une règle de nombre sans `null`. Son option vide vaut « aucun choix », comme celle d'une liste native : `null` sous `int 1..12 | null`, et la liste la garde, comme aucun choix d'une liste `multiple` sous une règle de liste qui accepte `null` ; une variable qui vaut `null`, au départ ou écrite par votre code, montre cette option vide, que le formulaire envoie (`""`), comme la liste native. En mode `multiple`, elle lit ses choix et montre la variable comme la liste native : chaque option une fois, dans l'ordre des options — sous `int 1..12[]` qui vaut `[2]`, cocher « 5 » puis « 02 » écrit `[2, 2, 5]`, et la liste montre et envoie « 2 » et « 5 », une fois chacune ; `[2, 1, 2]`, au départ ou écrit par votre code avant que les options n'arrivent (`{for}`), montre et envoie « 1 » puis « 2 » dès qu'elles sont là, et la variable reste `[2, 1, 2]` jusqu'au choix suivant, comme sous la liste native ; une valeur qu'aucune option ne porte (`[2, 7]`) n'est ni montrée ni envoyée et se perd au choix suivant (cocher « 5 » écrit `[2, 5]`), comme dans la liste native, sauf dans une liste qui accepte une réponse libre (`other`), qui la garde comme sa réponse libre (`[2, 5, 7]`). Un écart reste, voulu : tant que la liste n'a encore aucune option (options pas encore arrivées, page rendue par le serveur), la valeur posée part telle quelle avec le formulaire, `null` en texte vide (`""`) et chaque valeur d'une liste `multiple`, là où une liste native sans option n'envoie rien — la liste ne sait pas encore quelles valeurs ses options porteront, et le champ écrit par le serveur reste ainsi jusqu'à leur arrivée (cf. [30 · Modules cœur & personnalisation](30-modules-coeur.md)).
- **Une liste à choix multiples** (`<select multiple>`) liée à une variable de règle de liste (`$tags  string 1..20[] ..3`, `| null` permis) se juge sur la liste de ses choix, celle que la liaison écrit. Une option qui écrit le nombre autrement que l'élément (`<option value="01">janvier</option>` sous `int 1..12[]`) le porte : la choisir écrit `1`, et la variable `[1]` la choisit, même quand l'option arrive après la liste (`{for}`) ; une variable libre choisit l'option de son texte exact (cf. [7 · Bindings two-way](07-bindings.md)). Aucun choix vaut `null` quand la règle accepte `null`, comme le champ de liste vide d'un formulaire jugé par `µrules` ; une liste vide sinon. Un choix qui sort de la règle (un de trop, un texte trop long) est refusé aussitôt : la liste revient à la valeur de sa variable, avec la secousse et la bulle. Un nombre hors de sa plage (`int 0..20[]`) est ramené à la borne, dans la liste et dans la variable ; sans option de cette valeur, ce choix tombe. Une liste ramenée qui sort encore de la règle (`int 0..20[] 2..3`, 20 et 25 choisis : un seul choix reste) revient à sa variable, comme un choix refusé. Sous une règle qui n'est pas une liste (`$nom  string`), rien ne la retient : la variable refuse la liste que la liaison lui écrit et garde sa valeur, le développement le dit, la liste garde le choix fait.
- Un store typé (`$$volume int 0..100`) aussi, même quand sa règle est posée par le `<vars>` d'un autre composant.
- Un `*guard` écrit garde ses réglages : `value=!{$age} *guard(text: 'Entre 18 et 120 ans', place: right)` (cf. [38 · Effets](38-effets.md), famille « En direct »).

Sans spectacle : `"effects": { "guard": false }` dans `mjs.config.json` (cf. [32 · CLI & configuration](32-cli-et-configuration.md)). Ces champs n'ont plus ni secousse ni bulle ; la frappe reste à l'abri (jamais réécrite en route) et la valeur est ramenée à la sortie du champ. Un `*guard` écrit garde son spectacle ; `*guard(silent: true)` rend un champ muet.

Une variable qui reçoit une **valeur animée** (`µspring`, `µinterpolate`) ne va **pas** dans `<vars>` : elle a déjà ses propres bornes, qu'on lui donne en la créant — `µspring(valeur, raideur, amortissement, min, max)`, `µinterpolate(valeur, durée, min, max)`. Une règle en plus ferait doublon : le build la refuse et dit où poser les bornes. Si une valeur animée arrive quand même dans une variable typée (renvoyée par une fonction), elle passe telle quelle, avec ses bornes à elle, et le développement le signale.

## Les règles nommées : fichiers `*.types.mjs`

Une règle qui revient partout s'écrit **une fois**, dans un fichier `*.types.mjs` : un bloc `<types>`, une règle nommée par ligne — une règle d'objet sur plusieurs lignes, sans accolades (plus bas). Elle vaut dans toute l'appli. Le fichier se pose n'importe où dans le dossier des sources (`sourceDir`), sous n'importe quel nom qui finit par `.types.mjs` (`app.types.mjs`, `son.types.mjs`…) ; une appli peut en avoir plusieurs. Le nom d'une règle est un mot simple (lettres, chiffres et `_`, sans espace ni tiret) qui ne reprend aucun mot de la grammaire (`int`, `string`…) : l'habitude est une majuscule, `Percent`.

```html
<!-- app.types.mjs -->
<types>
  Percent    int 0..100
  Ratio      float 0..1
  Nick       string 3..20 ! 'admin' | 'root'
  Settings
    volume   Percent
    bass?    int -10..10
</types>
```

```html
<!-- player.mjs -->
<vars>
  $volume    Percent
  $settings  Settings
  $friends   Nick[] ..50
</vars>
```

- Un nom par appli : deux fichiers qui déclarent le même nom font échouer le build. Un nom inconnu aussi, avec une suggestion (`vouliez-vous dire « Percent » ?`).
- Une règle nommée peut en citer une autre ; deux règles qui se citent en boucle sont refusées.
- Les interdits écrits à l'usage s'ajoutent à ceux de la définition : `$chef  Nick ! 'boss'`.
- Un fichier `*.types.mjs` n'est pas un composant : il ne contient que son bloc `<types>` (et des commentaires). Un `<types>` dans un composant est refusé : le composant déclare ses variables dans son `<vars>`.
- Rien ne voyage au runtime : chaque composant embarque ses règles, déjà résolues. Changer une règle recompile les composants qui s'en servent (en `mjs dev` aussi).

### Une règle d'objet : un champ par ligne, en retrait

Dans un bloc `<types>`, une règle d'objet s'écrit sans accolades : son nom seul sur sa ligne, puis chaque champ sur sa ligne, en retrait — son nom, puis, s'il en a une, sa valeur de départ (`= valeur`), puis sa règle.

```html
<!-- app.types.mjs -->
<types>
  Reward
    id        int 1..
    title     string 1..80
    price = 0 int 0..
    surprise = false bool
    note?     string ..500
    seller
      name    string 1..40
      city?   string
</types>
```

- `nom?` : un champ facultatif.
- Un nom seul, suivi de lignes plus en retrait, est un objet à son tour (`seller`).
- Une clé qui n'est pas un nom simple (accent, tiret…) s'écrit entre guillemets : `'prénom'  string`, `"created-at"  string = ''`.
- Un champ porte toute règle d'une ligne : une règle nommée (`Percent`), une liste (`Track[] ..100`) ; un objet s'écrit sous son nom, en retrait (`seller`).
- `#` commence un commentaire ; une ligne vide ne compte pas. Une faute cite la ligne de son champ.
- Une règle d'objet ne s'écrit jamais entre accolades, ni dans un `<types>` ni dans un `<vars>` : un `{` qui ouvre un objet arrête la construction, en développement comme en production. Le message cite sa ligne et montre la forme à écrire : l'objet en retrait sous son nom ; dans une liste, une union ou avec `strict`, le type nommé à déclarer, puis la ligne qui s'en sert (`$items  Item[]`, `$challenge  Challenge | null`). Une accolade dans un texte (`'{x}'`), une forme (`/^[0-9]{5}$/`) ou un commentaire ne compte pas.
- Un message montre une règle d'objet par son nom ; sans nom, par ses champs en retrait, un par ligne.

## La réponse d'un appel `µajax` : `type:`

Une liste ou un objet reçu du serveur ne se range pas dans un `<vars>` pour être contrôlé : il le serait à chaque écriture, pour rien. Il se contrôle **une fois, à son arrivée**, par une règle nommée : `type:` dans les options de l'appel.

```civet
rewards = await µajax '/app/rewards', type: Reward[]
reward  = await µajax "/app/rewards/#{id}", type: Reward
created = await µajax '/app/rewards', method: 'POST', data: draft, type: Reward
```

- `µajax url, options` fait un `GET` (une autre méthode : `method: 'POST'`, avec `data:`) ; sa promesse rend le corps de la réponse. Les autres options sont celles des appels par verbe, sous leur nom : `timeout`, `headers`, `signal`, `success`, `error`, `always`. Avec `signal:`, `timeout:` est ignoré : le signal de l'appelant décide seul, comme pour les verbes. µajax s'appelle directement : son code n'entre dans l'appli que si elle écrit un appel direct — `µajax(…)`, `µajax '/url', …`, `µajax?(…)` ou `µajax?.(…)`, de même par `µ.ajax`. Pris comme valeur — passé en argument (`localGet(µ.ajax, …)`), rangé (`f = µajax`), décomposé (`{ ajax } = µ`, `{ ajax: r } = µ`), lu par `µ['ajax']`, appelé par `.call`, `.bind` ou `.apply` —, il arrête la construction, en développement comme en production, et le message montre l'appel direct à écrire ; les verbes (`µajax.get(…)`), l'écriture du gestionnaire global (`µ.ajax.error = …`) et une garde d'existence (`typeof µajax`, `µajax?`, `if µajax`, `µ.ajax and µ.ajax.get(…)`, `µ.ajax ? … : …`) restent permis, sans ce code. Un appel que la construction ne peut pas lire (`µ[k]`, `m = µ` puis `m.ajax()`, `{ ...reste } = µ`, `µ.ajax[k]`) échoue en production ; le développement le dit, une fois.
- `type: Reward[]` : une liste de `Reward` ; `type: Reward` : un seul. Le nom s'écrit tel quel, sans guillemets : le build le remplace par la règle, et un nom inconnu l'arrête, avec une suggestion (`vouliez-vous dire « Reward » ?`). Seule la clé `type:` du premier niveau des options de cette forme contrôle la réponse, ce premier niveau étant celui de l'objet tel que le langage le range (en CoffeeScript, `data: kind: 'a', type: Reward` met `type:` dans `data`) : dans `data:`, dans un objet imbriqué, dans un rappel ou dans un appel par verbe (`µajax.post '/x', {type: kind}, f`, dont les rappels gardent leur place), `type:` est une donnée, envoyée telle quelle. Dans les arguments d'un appel par verbe, `type: Reward[]`, qui ne peut pas être une donnée, et `type: Reward` quand `Reward` est un type déclaré que rien ne lie dans une portée qui englobe l'appel (il lèverait « Reward is not defined ») arrêtent le build et montrent la forme à écrire (`µajax '/url', type: Reward`) ; `type: Reward[]` écrit après un rappel l'arrête de même. Seule une liaison qui englobe l'appel fait de `Reward` une donnée — déclaration, affectation, paramètre, import, déstructuration, fonction ou classe, au premier niveau du fichier ou dans une fonction qui contient l'appel, lue sur le code compilé ; une liaison faite dans un rappel ou dans une autre fonction ne compte pas, un nom seulement écrit (`console.log Reward`, `[r, Reward]`) non plus. Il en va de même d'un nom de règle cité dans une expression : `type: [Reward]` ou `type: Reward.id`, que rien ne lie autour de l'appel, arrête le build. Pour envoyer une variable globale, écrivez `type: window.Reward`. Le corps d'un rappel passé à un verbe n'est pas un de ses arguments : la forme appelable s'y écrit comme ailleurs.
- La forme appelable et `type:` s'écrivent pareil dans un composant, un `<script module>`, un module `.coffee.mjs`, `.civet.mjs` ou `.js.mjs` importé et le fichier d'un magasin : un seul appel, où qu'il soit, suffit à joindre son code à l'appli. Un fichier `.js` est une bibliothèque, copiée telle quelle, sans µ ni réécriture de `µajax` ou de `type:` — seuls ses imports d'autres bibliothèques de l'appli sont réécrits vers leur nom à empreinte : s'il lit `µ` ou une rune (`µajax`, `µafter`, `µt`…), écrite en clair ou par un échappement Unicode, sans la lier (aucune portée qui englobe cette lecture ne la déclare ; le nom d'une fonction ou d'une classe nommée est lié dans son propre corps), la construction s'arrête, en développement comme en production, et dit de le nommer `nom.js.mjs`. Un `nom.js.mjs` est un module MJS écrit en JavaScript, compilé comme un module `.civet.mjs` ou `.coffee.mjs` — µ fourni par un import du cœur, même importé pour son seul effet (`@import 'effets.js.mjs'`), `@import`, la forme appelable et `type:`, recompilé quand un fichier `*.types.mjs` change ; jamais un composant ; les modules du cœur qu'il nomme (`µ.ajax.get`…) entrent dans l'appli.
- La réponse passe la règle comme une écriture : conversions (`'42'` → `42`), nombres ramenés à leur borne, valeurs de départ des champs absents. Puis plus rien : la liste reçue est une valeur ordinaire, sans contrôle à chaque écriture.
- Une erreur du serveur — pas de réponse, code 4xx ou 5xx, délai `timeout:` dépassé — va à l'option `error:` de l'appel, comme pour les verbes, sans passer par la règle : ce qu'elle rend devient le résultat de `await`. Sans `error:`, `µ.ajax.error` l'affiche (dans la console, par défaut) et `await` rend `undefined` : une erreur du serveur ne rejette jamais la promesse. Un abandon voulu par l'appelant (`signal:`, un `AbortController` arrêté) rend `undefined`, en silence, comme pour les verbes : ni `error:` ni `µ.ajax.error`.

**Une réponse refusée** — un champ qui ne passe pas sa règle et ne se convertit pas, un champ obligatoire absent — n'a pas de valeur d'avant à garder. L'option `typeError` de l'appel décide : ce qu'elle rend devient la réponse. Les anciens noms `onError:` et `onTypeError:` (toute casse, en raccourci `{ onError }` ou entre guillemets) et toute clé que cette forme ne lit pas arrêtent la construction — les clés se lisent sur l'objet tel que le langage le range (objets implicites de CoffeeScript et de Civet, raccourcis, clés entre guillemets), jamais sur le texte : `data: title: 'a', price: 2` n'a qu'une clé, `data` — : le message dit `error:` pour une erreur du serveur, `typeError:` pour un refus de type ; dans un objet d'options que la construction ne lit pas, un ancien nom est averti en développement.

```civet
rewards = await µajax '/app/rewards', type: Reward[], typeError: (e) ->
  $notice = "Liste illisible : #{e.path}"
  []
```

`e` est une `µTypeError` : `e.path` nomme la valeur refusée par son chemin dans la réponse (`[4].id` ; vide pour la réponse entière), jamais par l'adresse de la requête, `e.rule` sa règle (`int 1..` ; en production, une règle n'a pas de texte — avec `typesReport`, `e.rule` est le nom de la règle nommée : `Reward[]`), `e.value` la valeur reçue, `e.component` la balise du composant qui appelle (`mjs-boutique`). Sans `typeError`, le gestionnaire de l'appli décide (cf. « Le mode dur » plus bas) : `'warn'` écrit l'avertissement et la promesse rend `undefined` ; sinon, la promesse est rejetée par cette `µTypeError` — la suite de la fonction ne s'exécute pas, et la console du navigateur la montre. En développement, une valeur ramenée à sa borne le dit dans la console, comme pour une variable.

Le code de ce contrôle n'entre dans l'appli que si elle écrit `type:` dans un appel `µajax`, et celui de la forme appelable que si elle l'écrit : un seul appel suffit, en développement comme en production, sans rien déclarer dans `mjs.config.json` (cf. [32 · CLI & configuration](32-cli-et-configuration.md)).

## Les stores (`$$x`)

Un store se règle comme une variable, dans le `<vars>` de n'importe quel composant : la règle vaut **pour toute l'appli**, quel que soit le composant qui écrit (`$$cart.quantity = 500`, `µ.store.cart = …`). La valeur déjà présente la passe dès que la règle arrive. Deux composants qui donnent deux règles **différentes** au même store font échouer le build (la même règle répétée ailleurs est permise).

## En développement : avertissement ou erreur

En production, rien ne s'affiche : une valeur est ramenée ou refusée, c'est tout. En développement, une valeur **ramenée** ou **refusée** le dit dans la console du navigateur — jamais une conversion, qui est normale :

```
[ModularJS] $volume : 150 ramené à 100 — permis : int 0..100 (<mjs-player>)
[ModularJS] $color refuse 'purple' — permis : 'red' | 'green' | 'blue' (<mjs-palette>)
```

Un message qui nomme un élément de liste donne son chemin : `$messages[4].id`, `$board.rows[2].cells[0?].v`. Un chemin marqué `?` nomme la dernière position connue : l'élément a été retiré, ou sa liste a été remplacée ou ramassée depuis.

La clé `types` de `mjs.config.json` choisit la forme de ce message :

```json
{ "types": "warn" }
```

| `"types"` | En développement |
|---|---|
| `"warn"` (défaut) | un avertissement jaune ; le code continue |
| `"error"` | une erreur rouge, **à la ligne qui écrit** : la fonction s'arrête là, impossible à manquer |
| `"throw"` | une `µTypeError` levée à la ligne qui écrit — **en production aussi** (cf. « Le mode dur » ci-dessous) |

En production, les deux se taisent. Avec `"error"`, le site ne se comporte donc pas pareil en développement (la fonction s'arrête) et en ligne (elle continue) : c'est le prix d'une faute impossible à rater.

Le panneau de développement (`µconsole`, [34 · Déboguer](34-deboguer.md)) montre la règle de chaque variable et de chaque store typés après leur valeur (`volume  number  50  · int 0..100`) ; une valeur changée dans le panneau passe par la règle, comme n'importe quelle écriture.

## Le mode dur : `"types": "throw"` et `µtypes.onError`

Avec `"types": "throw"`, une valeur refusée lève une `µTypeError`, en développement **et en production** : l'écriture n'a pas lieu, la fonction s'arrête. Une valeur ramenée à sa borne ne lève rien.

L'appli décide elle-même de ce que devient une valeur refusée, à un seul endroit, sans rien changer là où elle écrit : `µtypes.onError` pose son gestionnaire, une fois, dans le script d'un composant chargé au départ.

```civet
µtypes.onError (e) ->
  $$notice = "Une valeur n'a pas été acceptée (#{e.path})"
  'warn'
```

Le gestionnaire reçoit chaque refus **avant tout**, avant même le signal au serveur (`typesReport`, plus bas) — écriture d'une variable, d'une prop, d'un store, d'un champ, ou réponse `µajax` sans `typeError` — et peut faire ce qu'il veut (journal, message, envoi au serveur) ; s'il lève, le signal part quand même, puis son erreur sort de l'écriture, ou rejette la promesse de l'appel. Ce qu'il rend décide de la suite :

| Il rend | Une écriture refusée | Une réponse `µajax` refusée |
|---|---|---|
| `'throw'` | la `µTypeError` est levée | la promesse est rejetée |
| `'warn'` | un avertissement dans la console, le code continue | un avertissement ; la promesse rend `undefined` |
| rien | le mode réglé : `"throw"` lève, sinon le message de développement | la promesse est rejetée |

Dans tous les cas, la valeur refusée n'est pas écrite. La `µTypeError` porte `path` (`$messages[4].id`), `rule` (le texte de la règle en développement ; en production, le nom de la règle nommée avec `typesReport`, sinon rien), `value` (la valeur refusée) et `component` (la balise du composant, `mjs-player` ; rien pour un store écrit hors d'un composant).

## Signaler les refus au serveur : `typesReport`

```json
{ "typesReport": "/errors/types" }
```

En production, chaque refus — écriture ou réponse `µajax` — part au serveur **une fois par page et par chemin**, après le gestionnaire `µtypes.onError`, par `navigator.sendBeacon` : un `POST` au corps JSON.

```json
{ "path": "[0].id", "rule": "Reward[]", "component": "mjs-boutique", "page": "/users/jean/boutique", "url": "/app/rewards", "type": "string" }
```

`path` est le chemin de la valeur refusée : dans la variable (`$volume`, `$rewards[2].id`) ou dans la réponse (`[0].id`). `rule` est le nom de la règle nommée qui a jugé la valeur (`Reward`, `Reward[]`), jamais son texte ; sans règle nommée — une règle écrite sur place, comme `$volume  int 0..100` —, `rule` manque : le chemin et le composant la situent. `type` est le type de la valeur refusée (`string`, `number`, `boolean`, `null`, `array`, `object`, `undefined`) : la valeur elle-même ne part jamais, elle peut porter des données personnelles. `page` est l'adresse réelle de la page (`location.pathname`), sans ce qui suit `?` ni `#` ; pour une réponse `µajax` refusée, `url` est l'adresse de la requête, coupée de même (`/app/rewards` pour `/app/rewards?page=2`), son origine comprise quand l'adresse est écrite en entier (`https://api.exemple.fr/v1/rewards`) ; une écriture refusée n'a pas d'`url`. Ce qui suit `?` ou `#` — un jeton, une recherche — ne part jamais. Une réponse refusée part une fois par page, par adresse de requête et par chemin. L'adresse est un chemin du site (`/errors/types`) ou une adresse `https` ; seuls les noms des règles nommées entrent alors dans la production, jamais le texte des règles. Rien ne part en développement, où la console le dit déjà.

Le code du gestionnaire, de la `µTypeError` et du signal n'entre dans l'appli que si elle écrit `µtypes.onError`, `µTypeError` ou `type:` dans un appel `µajax`, ou si `mjs.config.json` déclare `"types": "throw"` ou `typesReport`.

## Contrôler un formulaire avec les mêmes règles

Les règles du `<vars>` parlent la langue commune des validateurs JavaScript, [Standard Schema](https://standardschema.dev) : chaque règle expose `~standard` (`version: 1`, `vendor: 'mjs'`, `validate`). Un formulaire se contrôle ainsi dans la page par les règles mêmes de ses champs, et au serveur par des règles écrites de la même façon, avec les mêmes messages (le serveur ne lit pas les composants : ces règles s'y recopient) ; une bibliothèque qui lit ce standard (formulaires, routes d'API) les accepte telles quelles.

### Dans le composant : `µrules(@)`

```html
<vars>
  $age   int 18..120
  $nick  string 3..20 ! 'admin' | 'root'
</vars>

<script>
  rules = µrules(@)
  rules.age['~standard'].validate('42')    # { value: 42 }
  rules.age['~standard'].validate(150)     # { issues: [{ message: 'Saisissez un nombre entier de 18 à 120', path: [] }] }
  rules['~standard'].validate({ age: '150', nick: 'root' })
  # { issues: [{ message: 'Saisissez un nombre entier de 18 à 120', path: ['age'] },
  #            { message: 'Cette valeur n\'est pas permise', path: ['nick'] }] }
</script>
```

- `µrules(@)` rend une règle par variable et par prop du `<vars>` ; l'ensemble est lui-même un schéma, celui d'un objet dont chaque champ passe la règle de son nom (un champ absent est refusé). `µrules()`, sans composant, rend les règles des stores.
- `validate(valeur)` rend `{ value }` — la valeur telle que la variable l'écrirait, conversions faites (`'42'` → `42`) — ou `{ issues }` : chaque valeur refusée, avec son message et son chemin (`['tags', 2]`, `['settings', 'bass']`). Une liste ou un objet nomme chacun de ses champs refusés, pas seulement le premier.
- Un nombre hors de sa plage est refusé : la variable le ramènerait à la borne, un validateur le dit. De même, une règle `int` refuse un nombre non entier (`17.6`, `'42.5'`) que la variable arrondirait.
- `validate` de l'ensemble reçoit aussi un formulaire, `FormData` ou `URLSearchParams` (`rules['~standard'].validate(new FormData(form))`), lu champ par champ le long des règles : les valeurs d'un champ répété (cases d'un même nom, `<select multiple>`), nommé `tags` ou `tags[]`, forment la liste d'une règle `[]`, dans l'ordre du formulaire ; une case à cocher d'une règle `bool` vaut `true` cochée (`on`, `true`, `1`) et `false` absente ; un champ vide ou absent d'une règle qui accepte `null` vaut `null`, liste et case à cocher comprises (`bool | null` décochée vaut `null` ; une liste est vide quand chacune de ses valeurs l'est) ; tout autre champ prend sa dernière valeur, dont le texte d'un nombre devient un nombre. Les champs d'une règle objet se nomment après un point, à toute profondeur : `adr.city` et `adr.geo.lat` remplissent `adr` sous la règle `{ city: string, geo: { lat: float } }`. Limite : une liste d'objets ou de listes (`{ a: int }[]`, `int[][]`) n'a pas de forme dans un formulaire — `validate` d'un formulaire la refuse alors, seule, par « Un formulaire ne peut pas remplir ce champ (liste d'objets ou de listes) » ; contrôlez-la sur un objet que vous construisez. Un nom entre crochets (`adr[city]`) n'est pas lu : le champ reste tel quel, sous son nom. Un objet ordinaire, lui, passe tel quel : une chaîne n'y devient pas une liste, ni `'on'` un booléen.
- La valeur reçue n'est jamais modifiée : `value` en est une copie convertie ; un champ que la règle ne déclare pas y est gardé tel quel.
- Le contrôle est celui de chaque écriture, qui ne change pas. Le code de `µrules` n'entre dans l'appli que si elle l'écrit (un nom fabriqué à l'exécution se demande par `"runtime": ["rules"]`, cf. [32 · CLI & configuration](32-cli-et-configuration.md)).

Le message suit la langue de la page (français ou anglais ; une autre langue prend celle du build, sinon l'anglais), au vouvoiement :

| Règle | Message d'un refus |
|---|---|
| `int 18..120` | Saisissez un nombre entier de 18 à 120 |
| `float ..1` | Saisissez un nombre d'au plus 1 |
| `string 3..20` | Saisissez de 3 à 20 caractères |
| `string ..1` | Saisissez au plus 1 caractère |
| `string /^[a-z]+$/` | Ce texte n'a pas la forme attendue |
| `int 18..120`, valeur `17.6` | Saisissez un nombre entier de 18 à 120 |
| `'red' \| 'green' \| null` | Choisissez parmi : red ou green |
| `! 'admin'` | Cette valeur n'est pas permise |
| `string[] ..5` | Choisissez au plus 5 éléments |
| toute règle qui refuse `null`, valeur absente ou vide (`undefined`, `null`, `''`, `[]`) | Ce champ est obligatoire |
| `int 1..10 \| null`, valeur `''` (le champ est facultatif, jamais dit obligatoire) | Saisissez un nombre entier de 1 à 10 |

Un dictionnaire du projet remplace un message par la clé `mjs.rules.<clé>` (cf. [29 · i18n](29-i18n.md)) : `required`, `int`, `float` (`{r}` : la plage), `range`, `atLeast`, `atMost` (`{a}`, `{b}` : les bornes), `text`, `chars`, `charsMin`, `charsMax`, `format`, `bool`, `one` (`{v}` : les valeurs permises), `or`, `list`, `items`, `itemsMin`, `itemsMax`, `object`, `refused`, `form` ; dans `chars`, `charsMin`, `charsMax`, `items`, `itemsMin`, `itemsMax`, `{s}` est la marque du pluriel du nombre cité (`s` à partir de 2 en français, hors 1 dans une autre langue ; rien sinon).

### Au serveur : `modularjs-framework/rules`

Le même contrôle et les mêmes messages, sans navigateur : une règle s'écrit comme dans le `<vars>`, une règle nommée comme dans un bloc `<types>`. Le serveur ne lit pas les composants : les règles d'un formulaire s'écrivent dans l'entrée serveur, recopiées de son `<vars>`.

```civet
// serve.server.mjs — dialecte Civet des composants
@import rules 'modularjs-framework/rules'

signup = rules({ age: 'int 18..120', nick: 'Nick', tags: 'string 1..20[]', news: 'bool' }, { types: { Nick: "string 3..20 ! 'admin' | 'root'" } })

export default {
  actions: {
    '/signup': (params, body, req) ->
      r = signup['~standard'].validate(req.form)
      if r.issues then { errors: Object.fromEntries(r.issues.map((i) -> [i.path.join('.'), i.message])) }
      else { redirect: '/welcome' }
  }
}
```

| Écriture | Rend |
|---|---|
| `rule('int 18..120')` | un schéma |
| `rules({ age: 'int 18..120', nick: 'Nick' })` | un schéma par nom, et `~standard` : celui de l'objet qui les réunit |
| `{ types: { Nick: "string 3..20" } }` | les règles nommées que citent les règles ; un objet, en retrait, un champ par ligne (`{ types: { User: 'name  string\nage = 18  int 0..' } }`) ; un texte d'une ligne est une règle : un objet d'un seul champ commence par une fin de ligne (`'\nquantity  int 1..99'`) |
| `{ lang: 'en' }` | la langue des messages : `'fr'` (par défaut), `'en'` ; une autre langue parle anglais |

Une entrée serveur importe le module par la directive `@import`, comme un composant (un `import` natif y est refusé, cf. [23 · mjs ws](23-mjs-ws.md)) ; Node résout le paquet lui-même, comme pour un fichier du projet : dans le `node_modules` du projet puis dans celui de chaque dossier parent. L'action garde ses trois arguments ; le formulaire entier est `req.form` (un `URLSearchParams` : champs répétés compris, cf. [19 · SSR](19-ssr.md)) : `validate(req.form)` en tire la liste `tags`, la case `news` (`false` décochée) et les nombres. `body`, lui, ne garde que la dernière valeur de chaque champ, en texte.

Une règle mal écrite est refusée dès sa création, avec le même message qu'au build. Les erreurs ainsi rendues, clé par clé, sont celles qu'un formulaire refusé (422) renvoie à la page : `<@@field>` les affiche sous leur champ (cf. [21 · Navigation](21-navigation.md), [30 · Modules du cœur](30-modules-coeur.md)).

### L'objet formulaire : `µform(@)`

Les règles du `<vars>` donnent aussi un objet qui suit le formulaire du composant, champ par champ — son erreur, s'il a été touché, s'il a changé — et en entier : s'il est valide, s'il part au serveur, et sa remise à zéro. Il est facultatif : un composant qui ne l'écrit pas ne change en rien.

```html
<vars>
  $age   int 18..120
  $nick  string 3..20 ! 'admin' | 'root'
</vars>

<script>
  $age  = 30
  $form = µform(@)
</script>

<form action="/inscription" method="post">
  <@@field label="Âge"><input name="age" type="number" value=!{$age}></@@field>
  <@@field label="Pseudo"><input name="nick" value=!{$nick}></@@field>
  <button disabled={not $form.valid or $form.submitting}>S'inscrire</button>
  <button type="button" @click={$form.reset()}>Effacer</button>
</form>
```

| Écriture | Rend |
|---|---|
| `$form.age.error` | le message de la règle pour la valeur du champ (celui de `µrules`, plus haut), ou celui du serveur ; vide quand la valeur passe |
| `$form.age.touched` | `true` une fois le champ quitté, ou le formulaire qui l'emporte envoyé, même écrit par un autre composant (un autre formulaire du composant n'y touche pas) |
| `$form.age.dirty` | `true` quand la valeur n'est plus celle de départ, prise quand la saisie du champ est là : juste après le premier affichage, ou à l'arrivée du champ qu'un `{if}` ajoute plus tard |
| `$form.valid` | `true` quand aucun champ n'a d'erreur, touché ou non |
| `$form.submitting` | `true` pendant l'envoi d'un formulaire écrit par le composant, intercepté par la navigation (cf. [21 · Navigation](21-navigation.md)) |
| `$form.reset()` | les valeurs de départ, dans les variables et dans les champs ; plus rien de touché ni de modifié ; les erreurs du serveur oubliées |
| `$form.fields` | tous les champs, sous le nom de leur variable (`$form.fields.age` est `$form.age`) : le moyen de lire une variable que l'objet garde pour lui (plus bas) |

- Rangez l'objet dans une variable `$` (`$form = µform(@)`) : le gabarit qui la lit se relit à chaque changement de l'objet, et lui seul — les champs liés gardent ce qui est tapé. Un `µeffect` qui la lit (`$form.valid`, par exemple) repart à chaque changement de l'objet, comme à une écriture de la variable. Rangé dans une variable sans `$`, l'objet reste juste, mais le gabarit ne le relit pas. `µform(@)` rend le même objet à chaque appel. Les écritures d'un même tour (une boucle qui écrit mille fois une variable) ne le relisent qu'une fois.
- L'objet a un champ par variable et par prop du `<vars>`. Le champ de `$age` est l'élément nommé `age` que le gabarit du composant a écrit (le nom que le serveur reçoit ; `age[]` pour une liste) : donnez-lui ce `name`, ou posez-le sur son enveloppe (`<@@field name="age">`) — le champ est alors la saisie qu'elle enveloppe, jamais l'enveloppe. Sa valeur est le texte d'une saisie (`<input>`, `<textarea>`, `<select>` simple) — ce qui est tapé, même quand `*guard` le retient hors de la variable : « 150 » dans un âge de 18 à 120 a déjà son erreur —, sinon la variable elle-même (case à cocher, liste multiple, module du cœur — le champ caché qu'il pose pour l'envoi ne compte pas —, variable sans champ). Un module du cœur enveloppé (`<@@field><@@number name="qty">`) reste ainsi propre, `dirty` et `touched` faux, jusqu'au premier geste, même quand son code arrive après le composant.
- Un champ appartient au composant qui l'entoure de plus près : celui dans l'ombre duquel il est écrit, ou le composant léger (`mjs-light` : ses enfants sont sa vue) qui le contient, même quand c'est son parent qui l'a écrit entre ses balises ; un champ que le parent glisse dans un enfant à ombre (par son `<slot>`) reste au parent. L'objet d'un parent ne voit ni la saisie, ni l'envoi, ni les erreurs des champs d'un enfant, que l'enfant ait une ombre ou non, qu'il ait son propre objet ou non : un enfant qui nomme ses champs comme son parent ne lui prête ni sa frappe (`dirty`), ni ses champs quittés ou envoyés (`touched`), ni ses refus, et `submitting` ne suit que les formulaires que le composant a écrits. Un composant léger suit aussi les formulaires de l'arbre où il est posé (l'ombre de son parent, ou la page), jusqu'à sa destruction, puis de nouveau s'il revient dans la page ; déplacé dans un autre arbre sans être détruit, il ne suit pas ceux de son nouvel arbre : le formulaire qui l'y entoure emporte ses champs, mais cet envoi ne les touche pas, son `reset` ne les remet pas à zéro et le refus du serveur pour eux ne s'affiche pas — recréez-le dans son nouvel arbre (par un `{if}`) plutôt que de l'y déplacer.
- Une variable nommée `valid`, `submitting`, `reset` ou `fields` compte dans `valid` et dans `<@@field>`, mais ne se lit pas sous ce nom : lisez son champ par `fields` (`$form.fields.valid`). Le développement le signale dans la console, une fois par composant et par nom.
- Les erreurs d'un refus du serveur (réponse 422 : `errors`, une clé par nom de champ, un texte ou une liste de textes, cf. [21 · Navigation](21-navigation.md)) se fondent dans `error` du champ qu'elles nomment, pour les seuls champs que le formulaire refusé a emportés — ses champs activés et nommés, quelle que soit leur valeur (une case décochée, un groupe radio sans choix, une liste à choix multiples vide en sont : le serveur peut les refuser), mais ni un champ désactivé (par son attribut ou par son `<fieldset disabled>`), ni une saisie sans `name` (celui de son `<@@field>` ne part pas), ni un bouton autre que celui qui envoie —, dans l'objet du composant à qui chacun appartient : celui qui a écrit ce formulaire, jamais un ancêtre, ou le propriétaire d'un champ d'un autre composant que ce formulaire a emporté (le champ d'un enfant léger posé dans le formulaire de son parent, celui qu'un `form="…"` rattache au formulaire d'un autre composant). Deux composants d'une page, même imbriqués, ne se prêtent pas leurs erreurs, et une erreur qui nomme un champ que l'envoi n'a pas emporté (un champ hors de ce formulaire, un champ désactivé, une variable sans champ) ne s'affiche pas, même dans l'objet du composant qui a écrit le formulaire. Le nouvel envoi d'un formulaire remplace le relevé de l'envoi d'avant de ce même formulaire, même quand il n'emporte plus aucun champ de l'objet (un `{if}` les a tous retirés) : son refus ne s'affiche pas non plus. Chaque formulaire garde ses réponses : un champ lit celles du formulaire qui emporte sa saisie (une liste `tags[]` comprise), et la réponse à un autre formulaire de la page ne les efface pas (cf. [30 · Modules du cœur](30-modules-coeur.md), « Plusieurs formulaires dans une page »). Les champs emportés se comptent à l'événement `submit` du formulaire, avant ce que votre code change ensuite : un champ qu'un écouteur `formdata` retire de l'envoi, ou qu'un écouteur `submit` désactive pendant l'envoi, reste compté, et son refus s'affiche. Elles valent pour les valeurs que cet envoi a emportées, relevées au moment où l'envoi part — un envoi annulé, ou ignoré parce que le précédent est encore en vol, n'emporte rien ; un formulaire `mjs-no-disable` part à chaque envoi —, et un champ changé depuis reprend l'erreur de sa règle. Des erreurs qui ne répondent à aucun envoi de formulaire (une page affichée avec ses erreurs, un lien, une écriture de votre code dans `µres.errors`) valent pour chaque objet, aux valeurs du moment où il les lit. `valid` en tient compte : un bouton `disabled={not $form.valid}` se rouvre dès que le champ refusé change.
- La remise à zéro rend aussi à une variable une valeur de départ que sa règle refuse (un pseudo obligatoire encore vide) : la variable la reprend sans passer par sa règle, le gabarit la montre, un `µeffect` qui la lit repart, et l'erreur de la règle revient. Le `reset` d'un formulaire (`<button type="reset">`, `form.reset()`) remet à zéro de la même façon les seuls champs de ce formulaire ; `$form.reset()`, tous ceux de l'objet.
- `<@@field>` lit de lui-même l'objet du composant à qui son champ appartient (celui qui l'entoure de plus près, plus haut), jamais celui d'un ancêtre plus haut : l'erreur du serveur tout de suite, celle de la règle une fois le champ touché. Le `<@@field>` qu'un parent écrit entre les balises d'un enfant léger lit donc l'objet de cet enfant. Le `<@@field>` d'un composant sans objet lit les réponses de son formulaire (`µres.errors` hors de tout formulaire), comme sans objet, même posé dans un parent qui a l'objet et une variable du même nom (cf. [30 · Modules du cœur](30-modules-coeur.md)).
- L'objet ne change rien à l'existant : `*guard`, le contrôle de chaque écriture, la réponse 422 et la remise à zéro des modules du cœur gardent leur comportement. Son code n'entre dans l'appli que si elle écrit `µform` (un nom fabriqué à l'exécution se demande par `"runtime": ["form"]`). Il emmène avec lui la destruction des composants légers (`mjs_lifecycle.ts`) : une appli qui ne l'avait pas encore (une sélection `"runtime": "core"`, par exemple) reçoit environ 1,1 Ko de plus une fois minifiée (0,3 Ko en gzip).

## Aide-mémoire

| Écriture | Où | Sens |
|---|---|---|
| `<vars>` … `</vars>` | composant, avant `<script>` | les règles de ses variables, props et stores |
| `$x  int 0..100` | `<vars>` | entier de 0 à 100 |
| `$x  float ..1` | `<vars>` | nombre au plus égal à 1 |
| `$x  string 3..20 /…/` | `<vars>` | texte : longueur et forme |
| `$x  'a' \| 'b'` | `<vars>` | une de ces valeurs |
| `$x  ! 'a' \| 'b'` | `<vars>` | tout sauf ces valeurs |
| `$x  T[] 0..10` | `<vars>` | liste de 0 à 10 éléments de règle `T` |
| `$x`, puis `a  T` et `b?  U` en retrait | `<vars>` | objet, un champ par ligne ; `b` facultatif |
| `$x  Nom[]` · `$x  Nom \| null` | `<vars>` | liste d'objets, objet ou `null` : par un type nommé |
| `$$x  règle` | `<vars>` | règle d'un store, pour toute l'appli |
| `<types>` `Nom  règle` `</types>` | fichier `*.types.mjs` | règle nommée, valable partout |
| `Nom`, puis `champ  règle` en retrait | fichier `*.types.mjs` | règle d'objet, un champ par ligne ; `champ?` facultatif ; `'clé-x'` entre guillemets |
| `champ = valeur  règle` | champ d'objet, forme en retrait d'un bloc `<types>` | valeur de départ d'un champ absent (clé manquante ou `undefined`) |
| `$x  règle strict` | `<vars>`, champ, règle nommée | ni conversion ni borne : une valeur à corriger est refusée |
| `µajax url, type: Nom[]` | script du composant | un GET dont la promesse rend la réponse, contrôlée une fois à son arrivée ; `type:` au premier niveau des options seulement, tel que le langage les range ; `typeError: f` décide d'un refus |
| `"types": "warn" \| "error" \| "throw"` | `mjs.config.json` | message d'une valeur ramenée ou refusée, en développement ; `"throw"` lève une `µTypeError`, en production aussi |
| `µtypes.onError (e) -> …` | script d'un composant chargé au départ | le gestionnaire des refus : rend `'throw'`, `'warn'` ou rien |
| `"typesReport": "/errors/types"` | `mjs.config.json` | en production, chaque refus envoyé au serveur, une fois par page et par chemin : chemin, nom de la règle, composant, adresse de la page et, pour une réponse, de la requête (sans ce qui suit `?` ni `#`), type de la valeur — jamais la valeur |
| `µrules(@)` · `µrules()` | script du composant | les règles de ses variables et de ses props, ou des stores, en schémas standard (`~standard`) |
| `rule(…)` · `rules({…})` | `modularjs-framework/rules` | les mêmes règles au serveur, sans navigateur |
| `$form = µform(@)` | script du composant | l'objet formulaire : par champ `error`, `touched`, `dirty` ; `valid`, `submitting`, `reset()`, `fields` |
