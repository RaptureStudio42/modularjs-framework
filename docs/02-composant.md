# 2 · Anatomie d'un composant

> 📚 Tuto interactif correspondant : **Chapitre 1 — Introduction**. Les encarts 🎓 *Pour débutants* dépliables donnent l'explication pas-à-pas ; le corps de la page reste la référence dense.

Un composant = **un fichier `.mjs`**. Il réunit plusieurs blocs de premier niveau, tous optionnels : un `<script module>` (code partagé, exécuté une seule fois), un `<script>` (logique de l'instance), du **markup HTML**, un ou plusieurs `<theme>` (variables de thème — voir [Thèmes](31-themes.md)), et un `<style>` (CSS scopé, avec son bloc nommé `<style name="…">` pour un variant). Le nom du fichier détermine la balise.

L'ordre conventionnel dans le fichier : `<script module>` puis `<script>` en tête, le HTML ensuite, puis les blocs `<theme>` éventuels, et le `<style>` en dernier.

## Fichier → balise : kebab-case obligatoire

Le compilateur dérive le nom de balise du nom de fichier : `tagName = "mjs-" + nom.toLowerCase()`.

| Fichier | Balise générée | Utilisation |
|---|---|---|
| `mon-bouton.mjs` | `<mjs-mon-bouton>` | `<mjs-mon-bouton />` |
| `nested.mjs` | `<mjs-nested>` | `<mjs-nested />` |

Les noms de fichiers composants sont donc en **kebab-case minuscule**, impérativement.

> ⚠️ Un nom de fichier en **camelCase** (`monBouton.mjs`) **casse l'autoloader** : la balise est construite en `.toLowerCase()` → `<mjs-monbouton>`, qui ne correspond à rien d'attendu. Toujours `mon-bouton.mjs`, jamais `monBouton.mjs`.

> ⚠️ La balise s'écrit **avec son préfixe** : `<mjs-mon-bouton>`, ou le raccourci `<@mon-bouton>`. Écrite sans (`<mon-bouton>`), elle n'est reliée à aucun composant et reste vide ; le build vous en avertit, une fois par fichier (`[lint.tagAlias]`).

<details>
<summary>🎓 <b>Pour débutants</b> — pourquoi le préfixe <code>mjs-</code> et le tiret&nbsp;?</summary>

Ce n'est pas une lubie de MJS : la **norme des Custom Elements** du navigateur exige qu'un nom de balise personnalisée contienne un **tiret** (`-`). C'est ce qui les distingue des balises natives (`<div>`, `<p>`…), qui n'en ont jamais. MJS préfixe donc tout par `mjs-`, ce qui garantit le tiret et évite les collisions de noms. Votre fichier `carte-produit.mjs` devient `<mjs-carte-produit>`.

</details>

## La section `<script>` — Civet par défaut

La logique vit dans `<script>`. Le langage par défaut est **Civet** (proche de CoffeeScript) : indentation significative, pas de `;`, pas de `{}` pour les blocs.

```html
<script>
  name = 'ModularJS'
  shout = -> name.toUpperCase()
</script>

<h1>{shout()}</h1>
```

### Méthodes en `->`

On définit les fonctions/méthodes avec la flèche **`->`** (style Coffee), pas `=>` :

```html
<script>
  greet = (who)-> "Bonjour #{who}"   # -> classique
</script>
```

> ⚠️ N'utilisez `=>` **que** si vous avez besoin de lier `this` (cas rare, ex. certains `µeffect` qui touchent le composant). Par défaut, **`->`**. Voir [Cycle de vie](16-cycle-de-vie.md) et [Pièges](18-pieges.md).

### Interpolation de chaîne : `"#{x}"`

En Civet, on interpole dans une chaîne avec **`#{ … }`** (guillemets doubles), à la CoffeeScript :

```html
<script>
  who = 'monde'
  msg = "Bonjour #{who} !"      # ✓ Civet
</script>
```

> ⚠️ **Évitez les backticks `` `${x}` ``** (chaînes à backticks JS) dans un `<script>` Civet : `` `Bonjour ${who}` `` **compile et fonctionne** (Civet les laisse passer tel quel), mais c'est **hors convention** ici — utilisez toujours `"#{who}"` (style Coffee, cohérent avec le reste du code MJS).

> 💡 **Dans un `<script>`, une chaîne `"…"` ou `'…'` peut courir sur plusieurs lignes**, comme une chaîne à trois guillemets ou un gabarit : ce qui s'écrit dedans reste du texte — un `#` ou un `//` n'y ouvre aucun commentaire, un `$total`, un `&id`, un `µajax` ou un `@x` n'y sont pas réécrits (`"un\n# deux\ntrois"` garde ses trois lignes). De même dans un module `.civet.mjs` ou `.coffee.mjs`, et dans une expression régulière étendue `///…///`, où seul un `#` précédé d'un blanc ouvre un commentaire ; en CoffeeScript, le code d'une interpolation `#{…}` y reste du code, Civet laisse `#{…}` en texte.
>
> Dans un gestionnaire du gabarit (`@click={-> …}`), une chaîne de plusieurs lignes garde son `#`, mais ses lignes suivantes y commencent par quatre espaces : `@click={-> $t = "un` puis `# deux` à la ligne donnent `"un\n    # deux"`. Pour le texte exact, écrivez `\n` dans une chaîne d'une ligne (`"un\n# deux"`), ou rangez la chaîne dans une méthode du script (`@montrer = -> $t = "…"`, puis `@click={-> @montrer()}`).

### Choisir un autre langage : `lang="…"`

Civet est le défaut, mais on peut écrire le `<script>` en `ts`, `coffee` ou `js` via l'attribut `lang` :

```html
<script lang="ts">
  const name: string = 'ModularJS'
</script>
```

En `ts` et en `js`, le script est du TypeScript ou du JavaScript ordinaire : le dialecte façon Coffee du Civet ne s'y applique pas (pas de déclaration automatique d'une variable affectée, pas d'interpolation `"#{…}"` : `"prix #{n} €"` reste une chaîne ; écrivez `` `prix ${n} €` ``).

Valeurs reconnues : `civet` (défaut), `coffee`, `ts`, `js`. Le défaut global est configurable dans `mjs.config.json` via `"defaultScriptLang"`, ou la forme à deux axes **`languages`** :

```json
{ "languages": { "script": "civet", "template": "civet" } }
```

- **`languages.script`** — même rôle que `defaultScriptLang` (langage par défaut des `<script>` sans `lang=`).
- **`languages.template`** — grammaire des **interpolations** `{…}` du template et des **handlers inline** (`@click={…}`) : `"civet"`, la seule valeur, et le défaut (ternaire espacé, existentiel `??`, `->`/`not`/`and`/`or` nativement compris — cf. [Événements](06-evenements.md)). `"js"` est refusé à la lecture de la configuration : retirez le réglage. Le JavaScript courant se lit tel quel en Civet, sauf : un ternaire collé (`a?b:c`) est refusé, écrivez `a ? b : c` ; une fléchée à paramètre nu (`v => v * 2`) est lue comme un appel de `v`, écrivez `(v) => v * 2` ; `==` et `!=` deviennent `===` et `!==` ; une barre précédée d'une espace et collée à ce qui la suit (`$a /2`) ouvre une expression régulière, écrivez `$a / 2` ; un opérateur précédé d'une espace et collé à ce qui le suit ne se lit pas comme en JavaScript : `$n -1`, `$n +1` et `$l [0]` sont lus comme un appel de `$n` ou de `$l`, `$n *2` et `$a <$b` sont refusés, écrivez `$n - 1`, `$l[0]`, `$n * 2` ; `#{…}` dans une chaîne entre guillemets doubles y est remplacé par sa valeur.

> ⚠️ Si `defaultScriptLang` **et** `languages.script` sont posées, `languages.script` prime — poser des valeurs **différentes** est une erreur de config (gardez une seule des deux clés).

> ℹ️ **CoffeeScript reste pris en charge.** Le langage `coffee` (`lang="coffee"`) s'emploie dans un composant, et un fichier `.coffee` s'importe comme un module (voir « Importer un module » plus bas), sans aucun avertissement ; Civet reste le langage par défaut et celui des exemples de cette documentation (même famille syntaxique, types optionnels). Le **manifeste externe** (fichier qui liste des scripts à bundler en plus des composants `.mjs`, clé `manifestExternal`) suit la même règle : `manifest.civet` est cherché en premier par défaut, `manifest.coffee` sert de repli.

> ⌨️ **Clavier non-AZERTY ? Le réglage `sigil`.** L'API du framework s'écrit sous le préfixe `µ` (la lettre grecque « Mu », pour **M**odularJS) : `µeffect`, `µ.state`, `µinspect`, `µ$count`… Sur un clavier **AZERTY** (français), `µ` a une touche dédiée ; ailleurs, il est peu accessible. Deux solutions :
>
> 1. **Saisir le caractère `µ`** via le système : `Alt`+`0181` (Windows), `⌥ Option`+`M` (macOS), `AltGr`+`M`/touche *Compose* (Linux), ou copier-coller.
> 2. **Régler `"sigil": "mjs"`** dans `mjs.config.json` et écrire **`mjs.`** à la place de `µ` :
>
> ```json
> { "sourceDir": "app/modularjs", "sigil": "mjs" }
> ```
> ```coffee
> mjs.inspect $count             # ≡ µinspect $count
> mjs.effect ->                  # ≡ µeffect ->
> incr = -> mjs.emit('change')   # ≡ µemit('change')
> ```
>
> Le **séparateur est obligatoire** : il n'existe pas de forme courte collée (`mjseffect`), afin de ne jamais corrompre un identifiant comme `mjsonp` ou `music`. Deux séparateurs seulement : le **point** (`mjs.effect`) et le **`$`** devant un symbole d'état ou de store (`mjs$count` ≡ `µ$count`, `mjs$$panier` ≡ `µ$$panier`). En interne, `µ` reste le symbole **canonique** (runtime, bundle) ; `mjs.` n'est qu'une commodité de saisie, réécrite en `µ` à la compilation — dans le **code** seulement (`<script>`, expressions `{…}`, lignes `@import`, et un appel `mjs.asset(…)` écrit dans un attribut) : le texte affiché, les liens et autres attributs, `<pre>`, les chaînes et les commentaires du script, la feuille de style gardent `mjs.` tel qu'écrit (`mjs.dev` reste `mjs.dev`, `.mjs.actif` reste un sélecteur). Valeurs : `"µ"` (défaut) ou `"mjs"`.

> ⚠️ **Pas d'`import … from`** JavaScript dans un `<script>`, quel que soit le langage. Les dépendances entre composants/modules passent par la directive **`@import`**, à la racine du fichier ou dans le `<script>` (`@import nom 'chemin'`). Voir [Pièges](18-pieges.md) et la section *Importer un module* ci-dessous.

<details>
<summary>🎓 <b>Pour débutants</b> — Civet, c'est quoi par rapport à JavaScript&nbsp;?</summary>

**Civet** est un langage qui se *compile vers* JavaScript : vous écrivez une syntaxe plus courte, MJS la traduit en JS standard. Concrètement, par rapport à JS :

- pas de point-virgule en fin de ligne ;
- pas d'accolades pour les blocs : c'est l'**indentation** qui structure (comme Python) ;
- les fonctions s'écrivent `nom = (args)-> corps` ;
- l'interpolation dans les chaînes utilise `"#{variable}"` au lieu des backticks.

Si vous connaissez CoffeeScript, vous êtes chez vous. Sinon, retenez les trois habitudes à prendre : `->` (pas `=>`), indentation propre, `"#{x}"` (convention du projet — préférée aux backticks `` `${x}` ``, qui compilent et fonctionnent aussi, mais sortent du style Coffee). Vous pouvez aussi écrire en JS pur avec `<script lang="js">` le temps de vous habituer.

</details>

### Importer un module — `@import`

Les dépendances entre composants/modules passent par la directive **`@import`**, à la **racine** du fichier, dans le code d'un `<script>` ou dans un module (jamais un `import … from` JavaScript). Ses formes :

```html
@import maFonction 'utils/helpers.civet'          <!-- export nommé -->
@import a b c 'utils/helpers.civet'                <!-- plusieurs exports nommés, séparés par un espace -->
@import default MonWidget 'widgets/mon-widget.civet'  <!-- export par défaut -->
@import { a b } 'utils/helpers.civet'              <!-- les mêmes noms, entre accolades -->
@import 'utils/Number.coffee'                      <!-- pour son seul effet (prototypes, enregistrements) -->
```

Le chemin est résolu comme un **asset local** (mêmes règles que `µasset('…')` : validé et réécrit vers son URL finale au build — chemin absent → erreur de build explicite) sauf s'il s'agit d'une URL complète (`http://…`/`https://…`), laissée telle quelle. Un nom préfixé par `$` (`@import $x 'module.civet'`) marque la variable importée comme **externe réactive** — utile pour un état importé qui doit rester suivi par le compilateur.

La cible est un **module** MJS (`.civet.mjs`, `.coffee.mjs`, `.js.mjs`) ou une **bibliothèque** `.civet` / `.coffee` (compilée par son seul langage, sans µ ni directive : celle qui s'en sert arrête la construction, et le message nomme chacune de ses écritures de MJS à sa ligne, dix au plus, et dit de la nommer `nom.civet.mjs` ; elle importe ses voisines par un import natif relatif, extension comprise — `import { draw } from './engines/rng.civet'` —, car un chemin sans extension, ou écrit depuis `sourceDir` sans `./` ni `../`, ne se chargerait pas dans le navigateur : la construction s'arrête, et le message dit le chemin à écrire), compilé au build dans son propre fichier à empreinte, ou un fichier `.js.mjs` (module MJS écrit en JavaScript, compilé de même : µ fourni, `@import`, `type:` et la forme appelable de `µajax`), ou un fichier `.js`, bibliothèque copiée telle quelle, sans µ, seuls ses imports d'autres bibliothèques de l'appli réécrits vers leur nom à empreinte — un `.js` qui lit `µ` ou une rune (`µajax`, `µafter`, `µt`…), écrite en clair ou par un échappement Unicode, sans la lier (aucune portée qui englobe cette lecture ne la déclare ; le nom d'une fonction ou d'une classe nommée est lié dans son propre corps : `const K = class µK { m () { return µK } }` passe) arrête la construction, en développement comme en production, et le message dit de le nommer `nom.js.mjs`. Un composant et un module `.civet.mjs` ou `.coffee.mjs` l'importent de la même façon, et le chemin part toujours de `sourceDir`, quel que soit le dossier du fichier qui importe : `@import toRoman 'utils/Number.coffee'` s'écrit pareil dans `page.mjs` et dans `mods/app.civet`. Entre accolades comme sans, les noms se séparent par un espace (une virgule est refusée au build). Sans aucun nom, le fichier est importé pour son seul effet (un fichier qui ajoute des méthodes aux prototypes, par exemple) et s'exécute **une fois**, même importé par plusieurs composants ou modules ; les imports s'exécutent dans l'ordre de leurs lignes. Une faute dans le fichier importé est citée à sa ligne (`Number.coffee:3:5`) ; en développement, modifier le fichier importé recompile les composants et modules qui l'importent. Un module `.js.mjs`, compilé et chargé comme un module, ne commence jamais par une ligne `#!` : la construction s'arrête, et son message dit de la retirer, ou de nommer le fichier `.js` s'il ne se sert pas de µ (une bibliothèque garde sa ligne `#!`).

Une directive `@import` tient sur **une seule ligne** : écrite sur plusieurs (`@import {` puis les noms aux lignes suivantes), elle arrête la construction, avec la ligne à écrire. Elle est lue à la racine du fichier, dans le code d'un `<script>` et dans le code d'un module ; dans le texte d'un élément du gabarit (entre sa balise ouvrante et sa fermante : `<p>`, `<doc-code>`…), dans un `<style>`, un `<pre>`, un `<code>`, un commentaire HTML, et dans un commentaire ou une chaîne d'un `<script>` ou d'un module, une ligne qui commence par `@import` reste du texte, affiché tel quel, quelle que soit sa forme (`@import $x …` et `@import §§x …` comprises). Une directive lisible écrite dans le texte d'un élément (hors `<pre>`, `<code>` et `<doc-code>`, qui montrent du code) déclenche un avertissement à la construction, avec sa ligne : pour importer, placez-la à la racine du fichier ou dans le `<script>`. Un export par défaut se nomme sans accolades et d'un seul nom : `@import default { MonWidget } '…'` et `@import default MonWidget Autre '…'` sont refusés, avec la forme à écrire ; des accolades vides (`@import {} '…'`) aussi. Le rendu serveur charge un `.js` importé comme un module compilé ; une entrée serveur (`mjs ws`, `mjs server`) lit les mêmes formes, avec les mêmes refus (un nom en `$` compris), un `.coffee` importé y étant compilé ([23 · MJS-WS §13.2](23-mjs-ws.md)). Limites : un `import … from` natif reste refusé, dans un composant comme dans un module (seule la directive `@import` importe, le message de refus montre la forme à écrire) ; un chemin relatif au fichier qui importe (`../utils/Number.coffee`) n'est pas résolu.

Le nom de fichier d'un module devient son adresse publiée : lettres (accents compris), chiffres, `_`, `.` et `-` seulement, et jamais le préfixe `mjs_`, réservé aux fichiers du framework. Un autre nom (`outil#2.civet`, `mon outil.civet`, `mjs_core.civet`) arrête la construction, avec une erreur qui nomme le fichier ; un composant qui l'importe échoue sur la même erreur. Un module qui porte le nom d'un composant (`cart.civet.mjs` et `cart.mjs`) est refusé de même (voir plus bas).

```html
<!-- module.civet.mjs -->
export trapFocus = (_node)-> …
export default class MonWidget
```

> 🔗 `@import µ$$X 'chemin'` est la forme spécifique aux **stores légers** (importe le singleton `export`é `µ$$X` par le module, consommé ensuite avec ce **même** `µ$$X` — jamais `$X`, `$$X` ni `§§X` directement en composant) : voir [Stores](14-stores.md).

> 🔗 Un module `.civet.mjs`/`.coffee.mjs` **autonome** peut lui-même `@import` un autre module (chaînage module→module, ex. `a.civet` importe `b.civet`) — le compilateur suit la chaîne à **n'importe** quelle profondeur (recompilation transitive : `b.civet` change → `a.civet` ET le `.mjs` qui l'importe recompilent) et refuse un cycle (`A → B → A`) avec une erreur de build explicite.

### Classes globales — `Nom.class.mjs`

Un fichier `Nom.class.mjs` porte une classe de l'appli : constantes, méthodes et état d'un domaine, lus partout en `µNom` sans import — gabarit, script, module `.civet.mjs` ou `.coffee.mjs`, autre classe. Ce n'est pas un composant : le fichier ne contient que du code Civet (qui lit aussi le JavaScript), sans gabarit ni bloc, et déclare `class Nom` en tête de ligne ; le nom du fichier est celui de la classe, une majuscule d'abord. Les méthodes s'écrivent en camelCase.

```coffee
# App.class.mjs
class App
  NAME   = 'Heartwork'
  SLOGAN = 'Love, Deeper.'
  count  = 0

  fullName = -> NAME + ' — ' + SLOGAN
  inc      = -> count += 1
```

```html
<p>{µApp.NAME}</p>
<p>{µApp.fullName()}</p>
```

- `µApp` et `µ.App` désignent la même classe. Au premier retrait du corps, `NOM = …` (ou `NOM: Type = …`) déclare un membre de la classe (`static`) : dehors, il se lit et s'écrit en `µApp.NOM` (`µApp.count = 5`, `µApp.fullName()`). Les runes µ s'écrivent dans la classe comme dans un module.
- La portée de la classe vaut pour tout son corps : un membre s'y lit et s'y écrit par son nom, sans `@` — dans une méthode, une fonction imbriquée, un rappel (`liste.map (x) -> x + count`), la valeur d'un autre membre (`FULL = NAME + ' ' + SLOGAN`). Une méthode garde sa classe même détachée : `liste.map(µApp.fullName)`, `f = µApp.fullName; f()`.
- Dans une fonction, un paramètre ou une variable déclarée (`count := 1`) qui porte le nom d'un membre le cache ; une affectation sans déclaration (`count = 0`) écrit le membre. Une clé d'objet (`{ NAME: 1 }`), une propriété (`x.NAME`) et le texte d'une chaîne ne désignent pas le membre ; la propriété raccourcie `{ NAME }` et l'interpolation `"#{NAME}"`, si.
- Chargement à la demande : la construction relève qui cite `µApp` (un composant, gabarit compris ; un module ; une autre classe) et pose en tête de son code un import de la classe. La classe part avec le code de ceux qui la citent et s'exécute avant lui : sa lecture est synchrone, sans attente. Une page qui ne la cite pas ne la charge pas, et aucune classe n'est chargée au démarrage. En production en un seul fichier (`js: 'bundle'`), la classe entre dans ce fichier avec ceux qui la citent.
- En développement, une modification de la classe la recompile, avec ceux qui la citent. Au rendu du serveur comme au prérendu, la classe se charge avec le composant qui la cite, avant lui.
- Sous Node : chaque classe a aussi sa sortie `node/Nom.js` dans le dossier de sortie, qu'un `import` de Node charge sans navigateur (des tests `node --test`, par exemple : `import App from '../public/modularjs/node/App.js'`). `µ` y est `globalThis.µ`, créé au besoin : les classes chargées s'y enregistrent et se lisent entre elles. Une rune qui demande le navigateur (`µajax`, `µRouter`, `µlang`…) lève à son appel, sauf si le test pose lui-même sur `globalThis.µ` ce qu'elle lit.
- Refus à la construction : un nom que le framework pose déjà sur `µ` (`Autoloader`, `CSS`, `Element`, `LRUCache`, `Router`, `Store`, `Ticker`), deux classes de même nom, un nom qui ne commence pas par une majuscule, un fichier sans sa `class Nom` ou qui porte un bloc (`<script>`, `<style>`…), des classes qui se citent en boucle (`µA` lit `µB`, qui lit `µA`), une seconde classe dans le fichier (un fichier de classe ne déclare que sa classe : rangez l'autre dans son propre fichier ou dans un module), un `@` dans la classe (`@NAME = …`, `@NAME`, `@@NAME`, `@` seul) — le message nomme le fichier et la ligne et montre la bonne écriture (`NAME = …`, `NAME`, `App`) ; un `@` dans une chaîne, un commentaire, une expression régulière ou une ligne `@import` ne compte pas. Dans le corps, sont refusés aussi, à leur ligne : une liaison nommée comme la classe (paramètre, variable, boucle, `catch`, fonction : elle y cacherait la classe, par laquelle ses membres se lisent) et `delete NOM` (écrivez `delete µApp.NOM`).
- Limites : la classe s'écrit en Civet (le CoffeeScript n'y est pas lu) ; une mention de `µNom` dans un commentaire ou une chaîne compte comme une citation (la classe est alors importée) ; une classe se cite par `µ`, pas par l'alias ASCII (`sigil`) ; sous Node, un `@import` ou un `µasset` écrit dans la classe n'est pas résolu ; un fichier de classe ajouté ou retiré pendant `mjs dev` fait reconstruire toutes les sources.

### Chargement paresseux — `µimport`

Un composant embarque parfois un **gros module** utile seulement à une minorité de visiteurs (éditeur avancé, visualisation 3D, lecteur vidéo…) : le charger au **boot** de la page pénaliserait tout le monde pour l'usage de quelques-uns. La rune **`µimport`** charge ce module **à l'usage** (typiquement un clic), pas au montage :

```html
<script>
  loadScene = ->
    THREE = await µimport('vendor/three.js')
    new THREE.Scene()
</script>
```

L'alias clavier **`mjsimport`** (sans `µ`) existe, comme pour `µasset`/`mjsasset`.

Le chemin suit exactement la convention de `µasset('…')` : un **littéral chaîne écrit en dur**, relatif à `sourceDir`, résolu au **build** — jamais une variable. La cible est un **module** : un fichier **`.js`** (bibliothèque, copiée telle quelle, sans µ) ou un module que MJS compile, **`.civet`**, **`.coffee`** ou **`.js.mjs`** — ceux que `@import` accepte comme module autonome. Un composant `.mjs` n'est pas un module : il se pose par sa balise `<@nom>`, et `µimport` le refuse au build.

Pour un fichier `.js`, au build, le fichier référencé est **copié avec une empreinte dans son nom** (`lib-a1b2c3d4.js`) — ses propres imports relatifs (`import … from './rng.js'`) sont réécrits vers les voisins publiés à leur tour avec leur empreinte ; un cycle d'imports entre fichiers copiés est une erreur de build. Seuls sont suivis les imports relatifs écrits en littéral (`import … from './x.js'`, `export … from`, `import './x.js'`, `import('./x.js')`) ; un voisin absent, hors de `sourceDir` ou compilé (`.civet`, `.coffee`, `.mjs`) reste tel quel — le build signale un voisin absent —, et rien n'est réécrit dans un `new URL('./x.js', import.meta.url)`, un `new Worker('./w.js')` ni un `import(variable)` : le chemin y garde le nom source, que le dossier publié ne contient pas. L'appel `µimport('…')` devient un **import dynamique** de ce chemin hashé : cache navigateur long (le nom ne change que si le contenu change), et le fichier ne pèse **rien** dans le chargement initial — il n'est téléchargé qu'au moment où la ligne s'exécute réellement.

`µimport` retourne la **promesse du module** (son namespace ES), qu'on peut déstructurer ou garder en bloc :

```html
<script>
  loadScene = ->
    { WebGLRenderer } = await µimport('vendor/three.js')   # export nommé
    # ou
    THREE = await µimport('vendor/three.js')                # namespace entier
</script>
```

Utilisable dans un `<script>`, un `<script module>`, et les gestionnaires inline du HTML :

```html
<button @click={ THREE = await µimport('vendor/three.js') }>Charger la scène</button>
```

#### Un module MJS — `.civet.mjs`, `.coffee.mjs`, `.js.mjs`

Un module que MJS compile se charge de la même façon. Il est **compilé au build** comme pour `@import` et **publié dans son propre fichier à empreinte** (`bougie.module-k3x9a.js`) ; l'appel `µimport('…')` devient un import dynamique de ce fichier. Il n'est demandé qu'au moment où la ligne s'exécute : ni dans le chargement initial de la page, ni dans les fichiers qu'un composant fait précharger avec lui. La promesse rend le namespace du module, avec les exports que `@import` y voit — nommés et `default`.

Un moteur de dessin, par exemple, s'écrit en module et se charge quand le visiteur choisit. Chaque chemin est un littéral : le build connaît les modules et ne télécharge que celui qui est choisi.

```html
<!-- shared/flammes/bougie.module.civet -->
@import palette 'shared/palette.module.civet.mjs'

export dessiner = (ctx, t)-> …
export default { nom: 'bougie' }
```

```html
<script>
  bougie  := -> µimport('shared/flammes/bougie.module.civet.mjs')
  braise  := -> µimport('shared/flammes/braise.module.civet.mjs')
  moteurs := { bougie, braise }

  choisir = (nom)->
    moteur = await moteurs[nom]()
    moteur.dessiner(ctx, 0)
</script>
```

- **Les `@import` du module suivent**, à n'importe quelle profondeur (`bougie` importe `palette`, qui importe un autre module…), et chaque maillon est publié. Un module peut lui-même `µimport` un autre module. Un cycle (`a` importe `b`, `b` importe `a`, par `@import` comme par `µimport`) arrête `mjs build` dès qu'il se ferme : le message nomme la boucle (`lib/a.module.civet → lib/b.module.civet → lib/a.module.civet.mjs`, chemins relatifs à `sourceDir`), et la commande sort avec un code non nul, sans rien publier de ces modules.
- **Deux modules du même nom de fichier** dans deux dossiers (`a/outil.module.civet.mjs`, `b/outil.module.civet.mjs`) restent deux modules : chacun garde son code et son fichier publié, qu'on l'atteigne par `@import` ou par `µimport`.
- **Un module et un composant du même nom** (`cart.civet.mjs` et `cart.mjs`) arrêtent la construction, avec une erreur qui nomme les deux fichiers : ils publieraient le même fichier, et le composant ne serait jamais écrit. Renommez l'un des deux (`cart-logique.civet.mjs`).
- **Une seule instance.** Un module que le composant `@import` et que `µimport` charge aussi (ou que deux modules chargés à la demande importent) n'est évalué qu'une fois : ses exports, un magasin `µ$$X` compris, sont les mêmes objets des deux côtés. En fichiers séparés, les deux visent le même fichier publié.
- **En fichier unique (`js: 'bundle'`)**, le module sort dans son propre fichier et n'est téléchargé et évalué qu'à l'appel, comme un `.js` ; les modules que seuls des modules chargés à la demande importent partent avec lui, le fichier unique ne les contient pas. Le code que le fichier unique partage avec ces modules — le cœur, un module `@import`é des deux côtés — passe dans un fichier à part que les deux importent, pour que chaque module reste une instance unique. Ces fichiers sont écrits à côté de `manifestPath` et leur nom ne dépend que de leur contenu : une modification sans rapport ne les renomme pas. Un projet qui n'a aucun `µimport` de module garde son fichier unique.
- **En fichier unique (`js: 'bundle'`)**, un fichier `.js` copié tel quel ne s'importe pas par `@import` : la construction s'arrête (« Could not resolve »), en développement comme en production. Écrivez ce code en module `.js.mjs`, `.civet` ou `.coffee`, ou gardez `js: 'split'`.
- **Une modification se répercute** : changer un module, ou l'un des modules qu'il importe, change son nom publié, et le composant qui le charge est recompilé pour viser le nouveau nom.

> ⚠️ Deux garde-fous, tous deux des **erreurs de compilation** : un argument qui n'est **pas un littéral chaîne** — le build ne peut pas connaître le fichier à l'avance — oriente vers `import(variable)` (ci-dessous, pour une URL connue seulement à l'exécution) ; une extension qui **n'est ni `.js`, ni `.civet`, ni `.coffee`** est également refusée, et le message d'un composant `.mjs` dit qu'un composant se pose par sa balise.

#### URL connue seulement à l'exécution — `import(variable)`

Quand l'adresse du module n'existe qu'au **runtime** (empreinte posée par le serveur de l'application, réponse d'API, valeur portée par un attribut), l'`import()` dynamique **natif** de JavaScript reste légal tel quel — à condition que son argument soit une **variable ou une expression**, jamais un chemin écrit en dur :

```html
<script>
  loadModule = (url)-> await import(url)
</script>
```

Un chemin **littéral** dans `import(...)` reste **refusé à la compilation** : un fichier connu d'avance doit passer par une directive que le compilateur peut suivre — `@import` (bundle principal) ou `µimport` (chargement paresseux) — pour que le graphe de dépendances le voie ; un `import('./x.js')` littéral y échapperait silencieusement.

> 🔗 **La règle de partage.** Chemin connu **au build** (fichier du projet, écrit en dur) → `@import` ou `µimport`. URL connue seulement **à l'exécution** (variable, expression) → `import(variable)` natif. Cas type : three.js (815 Ko) servi par le pipeline d'assets de l'application sous un nom qui change à chaque déploiement (`three-bundle-7ef951a4.js`) — l'URL vient d'un attribut ou d'une config, et `await import(url)` s'exécute au clic.

### Un composant de formulaire — `@formAssociated`

Une ligne, seule, en tête du fichier (ou dans le `<script>`), fait de la balise du composant un **élément du formulaire** — le mécanisme des champs natifs (`ElementInternals`), celui des huit modules de saisie du cœur (`<@@checkbox>`, `<@@switch>`, `<@@radio>`, `<@@number>`, `<@@knob>`, `<@@gauge>`, `<@@select>`, `<@@editor>`) :

```html
@formAssociated

<script>
  $oui          = false
  $formDisabled = false

  @basculer = -> $oui = not $oui

  µeffect ->
    $oui
    @@internals?.setFormValue(if $oui then 'oui' else null)
</script>

<button type="button" disabled={$formDisabled} @click={@basculer()}>{$oui}</button>
```

- La balise entre dans `form.elements`, une `<label for="id">` la vise (le clic sur l'étiquette arrive sur la balise, comme un `click`), et `checkValidity()`, `reportValidity()`, `validity`, `validationMessage`, `willValidate` et `form` s'y lisent comme sur un champ natif. `setCustomValidity('message')` y est aussi, pour la page : son message passe devant la validité que le composant avait posée par `@@internals.setValidity`, qu'il retrouve à `setCustomValidity('')` — la dernière qu'il a écrite, son `customError` compris (un `setValidity` du composant pendant ce temps remplace le message de la page, et `setCustomValidity('')` lui laisse cette validité-là, jamais l'ancienne).
- `disabled="false"` et `required="false"`, quelle que soit la casse, sont ôtés de la balise et tenus pour faux, comme sur les modules du cœur ; `readonly="false"` aussi, quand le composant déclare `$readonly`. Un script qui ôte ensuite `disabled`, `readonly` ou `required` de la balise rend faux `$disabled`, `$readonly` ou `$required`, quand le composant les déclare, comme un champ natif redevient actif, modifiable ou facultatif. Sans cette variable, `readonly` garde la règle du navigateur : la balise qui le porte, quelle que soit sa valeur, n'est plus validée.
- **`@@internals`** : les `ElementInternals` du composant. La valeur envoyée avec le formulaire se pose par `@@internals.setFormValue(valeur)` — le `name` de la balise la nomme, `null` n'envoie rien ; la validité par `@@internals.setValidity({ valueMissing: true }, 'message', ancre)`, puis `@@internals.setValidity({})`.
- **`$formDisabled`** : déclarée par le composant, cette variable suit l'état désactivé que le navigateur lui donne — un `<fieldset disabled>` autour de lui, ou son propre attribut `disabled`. Désactivé, le composant ne part pas avec le formulaire et sa validité ne compte plus.
- La remise à zéro (`form.reset()`) reste à la charge du composant : `@@internals.form` donne son formulaire, dont il peut écouter le `reset`.

Dans un navigateur sans `attachInternals`, rien de tout cela : `@@internals` vaut `undefined` (d'où le `?.`), et le composant reste un composant ordinaire. Un composant sans la directive n'en paie rien — le code commun n'entre au build que si un composant la déclare. Une valeur après la directive (`@formAssociated true`) est une erreur de compilation ; la directive écrite deux fois passe, avec un avertissement.

## Les commentaires

Le compilateur retire tous les commentaires dès le début de sa lecture, avant toute autre étape, en développement comme en production : les commentaires HTML du gabarit (`<!-- … -->`), ceux du `<script>` dans sa langue (Civet `#…`, `###…###`, `//…`, `/* … */` ; Coffee `#…`, `###…###` ; JS et TS `//…`, `/* … */`) et ceux du `<style>` (`/* … */`, et `//…` en SASS ou SCSS). Ils ne pèsent rien dans le code produit et rien de ce qu'ils contiennent n'est lu : une balise, une macro ou un `$x` écrits dans un commentaire sont sans effet. Les lignes indiquées par une erreur restent celles de votre fichier.

Ce qui n'est pas un commentaire reste tel quel : une chaîne (`"http://…"`, `"# 1"`), une interpolation `#{…}`, une expression régulière, un champ privé `#x`, la division entière `//` de Coffee, le texte d'un `<textarea>` ou d'un `<title>`, une valeur d'attribut, une interpolation du gabarit (`{"<!-- … -->"}`).

En Civet et en Coffee, une expression régulière passée sans parenthèses en est une aussi, comme ces deux langages la lisent : après un nom suivi d'une espace, une barre suivie d'autre chose qu'une espace ouvre une expression régulière (`s.replace /'/g, 'X' # fin`, `s.split /#/`) ; son apostrophe, son guillemet ou son `#` ne sont ni une chaîne ni un commentaire, et le `# fin` qui la suit est bien un commentaire. `a / b` et `a/b` divisent : écrivez une division avec une espace de chaque côté de la barre, ou sans aucune (Civet lit `x /2` comme le début d'une expression régulière et refuse la ligne). Dans une expression régulière étendue `///…///`, un `#` précédé d'un blanc ouvre un commentaire jusqu'à la fin de la ligne, et `\#` est un dièse. La même règle vaut dans le gabarit, pour un gestionnaire (`@click={ $v = $v.replace /"/g, '' }`) comme pour une interpolation (`{$v.replace /}/g, ''}`), tant que `languages.template` ne vaut pas `"js"` : en JavaScript, la barre qui suit un nom divise toujours.

**Seule exception, le commentaire MJS `//!`** : tout ce qui le suit jusqu'à la fin de la ligne est un commentaire que le compilateur ne lit pas, et qu'il **garde** dans le code produit, en développement comme en production (une mention de licence, par exemple) :

```html
<script>
//! Composant sous licence MIT
# ce commentaire-ci disparaît
$n = 0
</script>

<style>
//! Palette validée le 12 mars
p
  color: red
</style>
```

Dans un script Civet, JS ou TS, il sort tel quel (`//! …`) ; dans un script Coffee et dans un `<style>`, il sort en `/*! … */`. Dans le gabarit, `//!` est du texte.

Limites : un `<!--` jamais refermé reste du texte ; restent aussi les commentaires des `<script>` et `<style>` placés dans un `<@head>` ou un `<@failed>`, ceux des blocs `<types>`, `<vars>`, `<effects>`, `<theme>`, `<routes>` et ceux écrits dans une interpolation `#{…}` ou `${…}` ; après un commentaire posé en milieu de ligne, la colonne indiquée par une erreur recule de sa longueur.

## Le markup (le HTML du composant)

Tout ce qui n'est ni `<script>` (module ou non), ni `<style>`, ni `<theme>`, est le **HTML** affiché par le composant. C'est du HTML, avec deux ajouts :

- **interpolation `{ expr }`** dans le texte et les attributs ;
- **composants imbriqués** : on pose simplement une autre balise `<@…>` ;
- **commentaire HTML `<!-- … -->`** : ignoré à la compilation, jamais posé dans le DOM final, son contenu n'est jamais interprété (une `{expr}` qui y traînerait reste du texte mort). Ses bornes sont celles que lit le navigateur : `<!-->` et `<!--->` sont des commentaires vides, refermés sur place — ce qui les suit s'affiche —, et `--!>` referme un commentaire comme `-->`.

```html
<script>
  src = '/tutorial/image.gif'
  name = 'Rick Astley'
</script>

<img src={src} alt="{name} dances." />
<@nested>
```

`src={src}` pose l'attribut par son **nom** — la valeur vient de la variable `src` du script. `alt="{name} dances."` interpole dans une valeur d'attribut. `<@nested>` insère le composant du fichier `nested.mjs`.

> ℹ️ Pour insérer du **HTML brut** (non échappé) plutôt que du texte, on utilise la double accolade `{{ expr }}`. À manier avec prudence (XSS) — voir [Bindings → HTML brut](07-bindings.md).

### Ce qu'une valeur `{…}` attend

Une valeur `{…}` du gabarit, dans le texte comme dans un attribut, est une expression Civet :

- **Un commentaire `# …` ou `### … ###`** se lit comme un commentaire dans le texte `{…}` ; dans les blocs `{if}`, `{elsif}`, `{key}`, `{for … in …}`, `{await}` et `{const}` ; dans une valeur d'attribut calculée `nom={…}`, interpolée `nom="… {…} …"` ou `nom="{…}"` ; dans l'étalement `{...$o}`, la classe `:class{…}` et le style `:style.prop={…}`. Un `### … ###` écrit sur une ligne se ferme au `###` suivant ; quatre dièses ou plus (`{$a ###### + note}`, `{$a #### x ### + note}`) n'ouvrent aucun bloc et commentent, comme dans le script, la fin de leur ligne (`$a`). Dans un gestionnaire, `=:` suivi d'un `#` est refusé ; ailleurs, `@click={…}` accepte un `#` ; dans une liaison `value=!{…}`, un `#` est refusé à la construction.
- **`key`, `error` ou `success` en tête, suivi d'une espace** (`{key + 1}`, `{error ? 'oui' : 'non'}`) : la valeur est lue comme un bloc, et la construction s'arrête (bloc sans `{end}`, ou `{error}` hors d'un `{await}`). Renommez la variable. De même, `{if …}` ouvre un bloc : pour une valeur, écrivez un ternaire (`{$a ? 'oui' : 'non'}`).
- **Une accolade dans une valeur d'attribut entre guillemets ouvre toujours une valeur** : `placeholder="ex. {prenom}"` cherche une variable `prenom` (le composant tombe), `data-conf='{"a": 1}'` donne `[object Object]`. Pour des accolades de texte, écrivez `&#123;` et `&#125;` : `placeholder="ex. &#123;prenom&#125;"` affiche `ex. {prenom}`.
- **`&` collé à un nom est un paramètre de route** : `{$a &b}` se lit `$a(&b)` — un appel de `$a` avec le paramètre de route `b` —, et le composant tombe. Pour le « et » bit à bit, mettez une espace de chaque côté : `{$a & b}`.
- **`@x` dans une fonction écrite dans la valeur** (`{[1, 2].map((v) -> v * @k)}`) ne voit pas le composant (`this` est perdu, le composant tombe) : écrivez `@@k`, comme dans le script (cf. [3 · Réactivité](03-reactivite.md), « `@@x` »).
- **Un mot de MJS cité dans la valeur d'un mot de MJS ou d'un événement, ou dans une valeur sans guillemets** (`:title="tapez :noUJS ici"`, `@click="alert(':permanent')"`, `data-x=:noUJS`) est lu comme un mot : la valeur est réécrite ou la construction s'arrête. Rangez ce texte dans une variable du script (`hint = "tapez :noUJS ici"`), puis écrivez `:title={hint}`. Dans la valeur d'un autre attribut, entre guillemets ou entre accolades (`title="tapez :confirm='oui'"`, `title={"tapez :confirm='oui'"}`), un mot cité n'est qu'un texte : il reste tel qu'écrit.

La construction refuse aussi une expression qui finit par un opérateur (`{$a +}`) et un paramètre de rappel nommé `$nom` : voir [18 · Pièges](18-pieges.md), § 15.

### Les trois signes d'une balise — `@`, `*`, `:`

Sur une balise, trois signes ouvrent une écriture de MJS, et chacun dit ce qu'il pose :

| Signe | Ce qu'il pose | Exemples |
|---|---|---|
| `@` | un **événement** à écouter, natif ou émis par un composant | `@click={envoyer}`, `@input={…}`, `@status={…}` |
| `*` | un **effet** | `*tilt`, `*tilt(max: 10)`, `*skeleton` |
| `:` | un **mot de MJS**, avec sa valeur quand il en prend une | `:size="320x48"`, `:class{$actif}="vif"`, `:this=!{champ}`, `:in=*fly(up)`, `:disabled={$envoi}` |

```html
<button @click={envoyer} *tilt(max: 10) :class{$actif}="vif" :disabled={$envoi}>Envoyer</button>
```

`@click` écoute le clic, `*tilt` pose un effet, `:class{…}` et `:disabled` sont des mots de MJS. Un attribut sans signe reste un attribut HTML, ou la prop d'un composant (`title="…"`, `value={$x}`, `<@carte item={$x}>`).

- Un `@nom` écoute toujours un événement, et le compilateur ne juge jamais son nom : `@confirn` écoute un événement nommé `confirn`. Seul le nom d'un mot de MJS (`@title`, `@open`…) est refusé à la construction, et le message donne l'écriture en `:` ; pour écouter un événement de ce nom émis par un composant, posez l'écouteur dans `µmount`. Le nom se lit jusqu'au premier `.`, `{` ou `=` et doit être exactement celui du mot (`@in.global` est le mot `in`) : un événement dont le nom commence seulement par un mot (`@in:fade`, `@size:x`, `@title-change`, `@open-menu`) s'écoute comme les autres.
- Un `:nom` qui n'est pas un mot de MJS est refusé à la construction, avec la liste des mots : une faute de frappe ne passe jamais en silence. Le mot se lit de même, jusqu'au premier `.`, `{` ou `=` : `:in:fade` n'est pas un mot, il est refusé (l'événement nommé `in:fade` s'écoute par `@in:fade={…}`).
- Un mot de MJS ne reçoit pas de gestionnaire : `:preload={…}`, `:method={…}` ou `:html={…}` sont refusés à la construction, comme `:preload` d'une valeur qu'il ne connaît pas (`:preload="bientot"`), et le message donne la forme du mot ; un événement de ce nom émis par un composant s'écoute dans `µmount`.
- Les attributs du `<style>` de base suivent la même règle (`:css`, `:display`, `:viewTransition`). Les mots de tête de fichier (`@import`, `@persist`, `@i18n`…) et les balises du langage (`<@window>`, `<@slot>`…) gardent leur `@`.

### La place d'un composant dont le code arrive — `:size`

En fichiers séparés (`"js": "split"`, le défaut), le code d'un composant imbriqué se charge quand sa balise paraît : la page qui la contient se dessine sans l'attendre, et le composant paraît à l'arrivée de son fichier. Jusque-là, sa balise est invisible mais garde la place que la page lui donne ; vide, elle n'en a aucune, et ce qui la suit descend quand il paraît. `:size` lui donne sa taille en attendant :

```html
<@task-row :size="320x48">
<@task-row :size="x48" *skeleton>
```

- La valeur : la largeur puis la hauteur, séparées par un `x`. Un nombre seul compte en pixels ; une longueur s'écrit aussi en `px`, `%`, `em`, `rem`, `vw` ou `vh` (`100%x48`, `20remx3em`) ; `x48` donne la hauteur seule, la largeur suit la mise en page. La valeur s'écrit en dur : une variable, une valeur mal écrite ou nulle arrêtent la construction, avec la forme à écrire.
- Tant que le code du composant n'est pas arrivé, sa balise est un bloc de cette taille, vide ; avec `*skeleton`, la silhouette grise qui scintille s'y dessine, rognée à la place ([Effets](38-effets.md)). À son arrivée, la place s'efface : ce qui suit ne bouge pas si le composant a la taille annoncée.
- En développement, un composant arrivé à une autre hauteur que sa place est dit en console, avec les deux tailles (celle de la place, celle du composant) : ce qui le suit a bougé quand même. Une largeur annoncée se compare aussi : quand elle seule change, la console dit que ce qui est à côté de lui a pu bouger ; avec `x48`, seule la hauteur compte. Seules les balises du premier rendu du composant qui les écrit sont comparées.
- Seulement sur la balise d'un composant de votre projet : sur une balise HTML, sur une balise du langage (`<@window>`, `<@document>`, `<@element>`…) ou sur celle d'un module du cœur (`<@@…>`), la construction s'arrête et vous invite à donner la taille par votre feuille de style. Une balise rendue par le serveur montre déjà son contenu : la place ne s'y applique pas. En fichier unique (`"js": "bundle"`), tout arrive ensemble : `:size` ne change rien.
- Aucun CSS en ligne : la place est une règle de la feuille du composant qui écrit la balise, et une appli sans `:size` n'en paie pas un octet.
- `:size` est réservé à cette place, jamais l'écoute d'un événement : `:size={…}` et `:size` sans valeur sont refusés. Pour écouter un événement nommé `size` émis par un composant, posez l'écouteur dans `µmount`.
- La place est un bloc : dans une ligne de balises en ligne, les places s'empilent les unes sous les autres, puis se rangent sur une ligne à l'arrivée des composants.

## La section `<style>` — scopé par Shadow DOM

Le `<style>` d'un composant est **isolé** : ses règles ne s'appliquent qu'au composant (Shadow DOM), ne fuient pas, et ne sont pas écrasées par le CSS global. Par défaut, on écrit du **SASS indenté** (pas de `{}` ni `;`) :

```html
<style>
  p
    color: purple
    font-family: 'Comic Sans MS', cursive
    font-size: 2em
    margin: 0
</style>

<p>This is a paragraph.</p>
```

Le `<style>` accepte aussi `lang="scss"` (SCSS avec accolades) ou `lang="css"`.

**La taille du texte s'adapte à l'écran.** Écrivez la taille voulue au PC, en px : la construction la rend fluide sur les petits écrans (active par défaut, clé `responsiveFontSize` de `mjs.config.json`, cf. [CLI et configuration](32-cli-et-configuration.md)). Avec les réglages par défaut, `font-size: 41.5px` vaut 28,4 px sur un téléphone de 390 px de large, 34,5 px à 768 px et 41,5 px à partir de 1 200 px. Une taille de 20 px ou moins ne bouge pas ; une taille qui ne doit jamais bouger s'écrit en `rem`.

### Une feuille partagée par plusieurs composants — `:css`

Le style isolé est confortable, mais on ne veut pas recopier la même palette ou la même grille dans dix composants. `:css="nom"`, posé en **attribut du `<style>` de base** du composant (celui sans `name=`), rattache au composant une feuille commune :

```html
<div class="card">…</div>

<style :css="theme">
  .card
    padding: var(--gap)
</style>
```

Le nom se résout dans le dossier des feuilles partagées — clé `stylesheetsDir` de `mjs.config.json`, `app/modularjs/styles/` par défaut — et le fichier peut être `.sass`, `.scss` ou `.css`. Un nom qui ne correspond à aucun fichier fait échouer le build, avec le nom cherché : pas de style manquant en silence.

Plusieurs feuilles se déclarent dans le même attribut, séparées par des espaces :

```html
<style :css="theme grid">
```

La feuille partagée est adoptée **avant** le `<style>` du composant : le style local a donc toujours le dernier mot, sans qu'on ait à se battre en spécificité. Quand deux feuilles sont déclarées, la dernière l'emporte sur la première.

Tout autre attribut posé sur `<style>` (comme sur `<script>`, `<theme>` ou `<routes>`) est refusé à la compilation, avec une suggestion quand le nom est proche d'un attribut attendu.

### Comment ces feuilles arrivent au navigateur — la clé `css`

Une seule clé de `mjs.config.json` décide, pour tout le projet, de la façon dont les feuilles partagées voyagent. Le comportement de `:css` ne change jamais : ce qui change, c'est ce que le navigateur télécharge.

| valeur | ce qui part au navigateur | pour quel projet |
| --- | --- | --- |
| `'bundle'` *(défaut)* | **un seul** fichier qui contient TOUTES les feuilles de `stylesheetsDir`, chargé avec le manifeste | le cas courant : peu de feuilles, ou des feuilles utilisées presque partout |
| `'split'` | **un fichier par feuille**, importé par le JavaScript des composants qui la déclarent | plusieurs feuilles bien séparées : une page ne paie que celles de ses composants |
| `'lazy'` | **un vrai `.css` par feuille**, demandé au montage du premier composant qui la déclare | des feuilles lourdes que peu d'écrans utilisent : rien ne part tant que personne n'en a besoin |

En `'lazy'`, une feuille réclamée par dix composants ne fait qu'**une** requête : le résultat est mis en cache par URL, et les neuf autres montages le réutilisent. Le composant reste invisible, à sa place, le temps de l'aller-retour (le même bouclier anti-clignotement qui cache tout composant avant son premier rendu), puis apparaît habillé — jamais nu.

Trois choses à savoir avant de choisir `'lazy'` :

- La feuille `mjs_root` reste chargée d'emblée dans les deux modes découpés. Elle habille le document entier, personne ne la déclare, et elle porte souvent les variables de thème : la différer ferait clignoter toute la page.
- Une feuille que **personne** ne déclare n'est jamais chargée. Le fichier est écrit, son adresse reste connue, mais aucune requête ne part — le build vous la nomme pour que ce ne soit pas une surprise.
- En `'bundle'` et `'split'`, une page rendue au serveur porte déjà les feuilles partagées de ses composants (cf. [19 · Rendu serveur](19-ssr.md), « Les feuilles dans le fragment ») : elle a la même mise en page avant et après le démarrage du JavaScript. En `'lazy'`, les feuilles partagées ne sont pas dans le HTML servi : une requête part **après** le montage, et le composant reste masqué le temps de l'aller-retour. Sur une page prérendue que vous voulez habillée dès la première image, ce délai se voit : gardez `'bundle'` ou `'split'` pour ce projet.

> 🔗 La clé et ses voisines : [32 · Ligne de commande & configuration](32-cli-et-configuration.md).

> ⚠️ L'isolation Shadow DOM a des conséquences : un `@font-face` déclaré dans le `<style>` d'un composant **ne charge pas** la police (il faut l'injecter dans `document.head`). De même, le CSS global ne « descend » pas dans le composant, sauf via les **custom properties** (`--ma-var`) qui, elles, traversent la frontière. Voir [Pièges](18-pieges.md).

### Coller une feuille pendant que la page tourne — `µ.adoptSheet`

L'ombre d'un composant est fermée : de l'extérieur, on ne peut pas y poser une feuille de style. Quand un style n'est connu qu'à l'exécution (le cadre d'un avatar que votre serveur a vérifié, une couleur d'équipe), `µ.adoptSheet(balise, feuille)` le colle dans l'ombre de cette balise. L'appel s'écrit dans le `<script>` d'un composant — ici, un parent qui colle un cadre dans son enfant `<@avatar>` tant que `$verified` est vrai :

```html
<script>
  $verified = false
  avatar    = null

  µeffect ->
    return unless $verified
    removeFrame = µ.adoptSheet(avatar, '.frame { border: 3px solid gold }')
    -> removeFrame()
</script>

<@avatar :this=!{avatar}/>
<button @click={$verified = not $verified}>Vérifier</button>
```

`avatar` est la balise d'un composant ModularJS (ici posée par [`:this`](09-directives-dom.md)) ; la feuille est un texte CSS ou une `CSSStyleSheet`. La fonction rendue retire la feuille : retournée en dernière ligne du `µeffect`, elle devient son nettoyage, et la feuille part dès que `$verified` retombe.

- La feuille passe **après** celles du composant : elle les surcharge à spécificité égale, sans qu'on ait à se battre.
- Elle n'est collée qu'**une fois** par balise, même si vous rappelez avec la même `CSSStyleSheet` ou le même texte. Chaque appel rend sa propre fonction de retrait, et la feuille ne part qu'avec la **dernière** : une fonction rappelée plusieurs fois ne compte qu'une fois.
- Elle **reste** quand le composant sort de la page et y revient (ModularJS remet alors à zéro les feuilles du composant, celle-ci y échappe) et quand la variante de mise en page ou le thème change.
- La fonction rendue la retire de **cette** balise, et d'elle seule : une `CSSStyleSheet` construite une fois peut être collée dans dix balises, et retirée balise par balise.
- Une balise **sans ombre** (`mjs-light`) ou qui n'est pas un composant ModularJS ne reçoit rien : l'appel rend une fonction qui ne fait rien, sans erreur, et la console affiche un avertissement qui nomme la balise (une seule fois par nom de balise). Ce style s'écrit alors dans le `<style>` du composant, ou dans une feuille de la page : sans ombre, les feuilles de la page s'appliquent déjà à la balise, il n'y a rien à lui coller.
- Une balise dont le composant n'est pas encore défini ne reçoit rien non plus, sans erreur ni avertissement. Pour une balise déjà dans la page dont le composant arrive plus tard (chargement à la demande), attendez sa définition avant d'appeler : `await customElements.whenDefined('mjs-avatar')`. Un appel fait avant ne colle rien, et ne se rattrape pas à la mise à niveau.
- Une feuille que l'ombre refuse — celle d'un `<style>` du document (seule une feuille créée par `new CSSStyleSheet()` s'adopte), ou celle d'une autre fenêtre — est traitée de même, sans avertissement : rien n'est collé, la fonction rendue ne fait rien, aucune exception.

> ℹ️ **En dernière ligne d'un `µmount`, l'appel devient le nettoyage du composant.** Une fonction rend sa dernière expression, et ModularJS prend ce que rend `µmount` pour le nettoyage du composant ([cycle de vie](16-cycle-de-vie.md#µmount--initialisation-unique)) : `µmount -> µ.adoptSheet(@, css)` rend donc la fonction de retrait. La feuille part à la destruction du composant (il quitte la page pour de bon) et revient avec lui : remis plus tard dans la page, le composant rejoue `µmount`, qui la recolle. Pour qu'elle reste aussi pendant son absence, écrivez un `return` après l'appel, ou faites l'appel dans `µawake`, qui rejoue à chaque arrivée et dont le retour est ignoré.

```html
<script>
  µawake ->
    µ.adoptSheet(@, '.frame { border: 3px solid gold }')
</script>
```

L'outil ne pèse rien dans une application qui ne l'écrit pas : le build ne l'embarque que s'il lit `adoptSheet` dans le code de vos composants. Appelez-le depuis un composant : `window.µ` n'est exposé que par un build de développement, un script de page ne l'y trouve plus en production. Un nom fabriqué à l'exécution (`µ['adopt' + 'Sheet']`), que le build ne voit pas, se demande par `"runtime": ["adopt_sheet"]`.

<details>
<summary>🎓 <b>Pour débutants</b> — « style scopé », pourquoi c'est confortable&nbsp;?</summary>

Sur une page web classique, écrire `p { color: purple }` colore **tous** les paragraphes du site — y compris ceux que vous ne vouliez pas toucher. C'est la grande douleur du CSS : tout est global, tout peut s'entrechoquer.

Avec le Shadow DOM, le `<style>` d'un composant est enfermé dans une bulle : `p { color: purple }` ne colore que les `<p>` **de ce composant**. Vous pouvez donc écrire des sélecteurs simples et courts (`p`, `.title`, `button`) sans craindre d'effets de bord ailleurs, et sans inventer de noms de classes alambiqués.

</details>

---

📚 **Apprendre en pratiquant** : ce chapitre correspond au **Tuto interactif n°1 (Introduction)** — premier composant, dynamique, attributs, stylisation, composants imbriqués. Voir ensuite [Réactivité](03-reactivite.md) (`$x`) et [Props & attributs](04-props.md) (passer des données à un composant imbriqué).
