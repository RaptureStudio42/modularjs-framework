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
  $settings  {
    volume: int 0..100,
    bass?:  int -10..10
  }
  $$cart     { quantity: int 1..99 }
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
| `{ volume: int 0..100, bass?: int }` | un objet dont le champ `volume` passe sa règle ; `bass` est facultatif ; les autres champs sont libres |
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

Entre accolades, chaque champ a sa règle. Un champ est **obligatoire**, sauf s'il porte un `?` juste après son nom : il devient **facultatif**. Un champ facultatif peut manquer ; s'il est là, il respecte sa règle.

```html
<vars>
  $settings  { volume: int 0..100, bass?: int -10..10 }
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

Un objet peut contenir une liste, une liste peut contenir des objets, et une règle d'objet peut s'écrire sur plusieurs lignes tant que l'accolade est ouverte :

```html
<vars>
  $playlist  {
    title:   string 1..40,
    tracks:  { name: string, length: int 1.. }[] ..100,
    shuffle?: bool
  }
</vars>
```

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

**Limite — la variable d'un `{for}` sur un store typé.** Dans un `{for}` sur un store typé, la variable de boucle est l'élément même de la liste : écrire par elle (`f.id = 'zz'`) n'est pas contrôlé par la règle du champ. Pour que l'écriture soit contrôlée, écrivez par le store (`$$flux[i].id = 'zz'`, ou `$$flux.find((f) -> f.id == id).id = 'zz'`).

Une **promesse** passe toujours (`$user = µfetch(…)`, lue par `{await}`) : sa vraie valeur arrive plus tard.

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
- **À la sortie du champ** (ou sur Entrée), une valeur hors de sa plage est ramenée à la borne (`300` → `120`, dans le champ ET dans la variable), une autre refusée rend la dernière bonne, avec la secousse et la bulle.
- Un store typé (`$$volume int 0..100`) aussi, même quand sa règle est posée par le `<vars>` d'un autre composant.
- Un `*guard` écrit garde ses réglages : `value=!{$age} *guard(text: 'Entre 18 et 120 ans', place: right)` (cf. [38 · Effets](38-effets.md), famille « En direct »).

Sans spectacle : `"effects": { "guard": false }` dans `mjs.config.json` (cf. [32 · CLI & configuration](32-cli-et-configuration.md)). Ces champs n'ont plus ni secousse ni bulle ; la frappe reste à l'abri (jamais réécrite en route) et la valeur est ramenée à la sortie du champ. Un `*guard` écrit garde son spectacle ; `*guard(silent: true)` rend un champ muet.

Une variable qui reçoit une **valeur animée** (`µspring`, `µinterpolate`) ne va **pas** dans `<vars>` : elle a déjà ses propres bornes, qu'on lui donne en la créant — `µspring(valeur, raideur, amortissement, min, max)`, `µinterpolate(valeur, durée, min, max)`. Une règle en plus ferait doublon : le build la refuse et dit où poser les bornes. Si une valeur animée arrive quand même dans une variable typée (renvoyée par une fonction), elle passe telle quelle, avec ses bornes à elle, et le développement le signale.

## Les règles nommées : fichiers `*.types.mjs`

Une règle qui revient partout s'écrit **une fois**, dans un fichier `*.types.mjs` : un bloc `<types>`, une règle nommée par ligne. Elle vaut dans toute l'appli. Le fichier se pose n'importe où dans le dossier des sources (`sourceDir`), sous n'importe quel nom qui finit par `.types.mjs` (`app.types.mjs`, `son.types.mjs`…) ; une appli peut en avoir plusieurs. Le nom d'une règle est un mot simple (lettres, chiffres et `_`, sans espace ni tiret) qui ne reprend aucun mot de la grammaire (`int`, `string`…) : l'habitude est une majuscule, `Percent`.

```html
<!-- app.types.mjs -->
<types>
  Percent    int 0..100
  Ratio      float 0..1
  Nick       string 3..20 ! 'admin' | 'root'
  Settings   { volume: Percent, bass?: int -10..10 }
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

En production, les deux se taisent. Avec `"error"`, le site ne se comporte donc pas pareil en développement (la fonction s'arrête) et en ligne (elle continue) : c'est le prix d'une faute impossible à rater.

Le panneau de développement (`µconsole`, [34 · Déboguer](34-deboguer.md)) montre la règle de chaque variable et de chaque store typés après leur valeur (`volume  number  50  · int 0..100`) ; une valeur changée dans le panneau passe par la règle, comme n'importe quelle écriture.

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
| `$x  { a: T, b?: U }` | `<vars>` | objet ; `b` facultatif |
| `$$x  règle` | `<vars>` | règle d'un store, pour toute l'appli |
| `<types>` `Nom  règle` `</types>` | fichier `*.types.mjs` | règle nommée, valable partout |
| `"types": "warn" \| "error"` | `mjs.config.json` | message d'une valeur ramenée ou refusée, en développement |
