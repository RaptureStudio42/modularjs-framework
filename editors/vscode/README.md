# ModularJS pour VS Code

Coloration syntaxique des composants ModularJS, et, pour les 117 effets `*nom`, les 200 alias que
ModularJS livre (`*filter.frosted_glass`) et les effets de votre appli (fichiers `*.effects.mjs`),
complétion pendant la frappe et aide au survol, en français ou en anglais. Un fichier `.mjs` du framework n'est pas un
module JavaScript de Node : c'est un composant qui réunit un script Civet, un gabarit, des
variables de thème et un style SASS. Sans cette extension, l'éditeur le lit comme du
JavaScript et le souligne en erreurs de la première à la dernière ligne.

## Ce qu'elle colore

- les blocs `<script module>`, `<script>`, `<theme>` et `<style>`, chacun dans le langage annoncé
  par son `lang="…"` (Civet et SASS par défaut — voir plus bas), y compris la forme nommée
  `<style name="…">` ;
- le bloc racine `<routes target="…">` : chemins, paramètres `:id`, segments facultatifs
  `(:an)` et `(fr)`, joker `*`, noms de composants et commentaires `#` ;
- la table **calculée** `@routes = {…}` d'un `<script>`, et l'ajout ciblé
  `@routes['vue']['/x'] = 'x-page'` : mêmes couleurs de chemin, mêmes noms de composants ;
- le bloc `<vars>` d'un composant et le bloc `<types>` d'un fichier `*.types.mjs` : types,
  plages, valeurs permises et interdites, formes `/…/`, champs d'objet, règles nommées ;
- le gabarit : balises, balises-directives `<@view>`, `<@slot>`…, composants du projet `<@panier>`
  et modules cœur `<@@select>` (même couleur de balise), attributs ;
- les directives d'attribut `@click={…}`, les liaisons `value=!{…}` ;
- les effets `*neon`, `*tilt(15, glare: true)` : l'effet, chacun de ses réglages ; les transitions
  `@in=*fly(up)`, `@out=*fade`, `@transition.global=*slide` ;
- le bloc `<effects>` d'un fichier `*.effects.mjs` : `*titre = *scramble(20)`, `*halo(size: 12px) =`
  puis ses déclarations CSS, `$size`, `@keyframes` et ses étapes ;
- les directives de premier niveau `@import`, `@css`, `@persist`, `@routes` ;
- les blocs de gabarit `{if}`, `{elsif}`, `{else}`, `{end}`, `{for … in …}`, `{await}`, et le bloc
  court d'un modèle `{? timer}`, `{? chrono, minuteur}` (le `?` et les noms des modèles) ;
- les symboles : `$x` (état local), `$$x` (global et variables de thème), `§x` et `§§x`
  (contexte), `µx` (runes du framework), `@x` et `@@x` (l'instance).

## Le langage des blocs `<script>`

Le compilateur accepte quatre langages de script (`src/languages/index.ts`) et l'extension suit le
même `lang` :

| balise | coloration | accepté par le compilateur |
| --- | --- | --- |
| `<script>`, `<script module>`, `<script lang="coffee">` | CoffeeScript | oui |
| `<script lang="ts">` | TypeScript | oui |
| `<script lang="js">` | JavaScript | oui |
| `<script lang="civet">` | CoffeeScript, faute de grammaire Civet | oui |

Dans un bloc `coffee`, `ts`, `js` ou `civet` — donc dans TOUS les blocs `<script>`, `<script>` nu
compris — les symboles du framework (`$x`, `$$x`, `§x`, `µx`, `@x`) gardent leur couleur même au fond
d'une construction du langage hôte — `if (a) $etat = 1`, `{ k: $etat }`, `compte = if $etat then 1` —
sans jamais déteindre sur une chaîne ni sur un commentaire.

Civet n'a pas de grammaire dans VS Code — aucune extension installée ne publie `source.civet`. Ses
blocs reçoivent celle de CoffeeScript, la plus proche : affectations, fonctions `->`, chaînes,
nombres et commentaires `#` sortent juste ; les emprunts de Civet à TypeScript (annotations de type,
`class` moderne) non. C'est aussi ce que reçoit un `<script>` nu, dont le langage par défaut est
pourtant Civet côté compilateur.

## Le langage des blocs `<style>` et `<theme>`

Comme le compilateur, l'extension lit **SASS indenté par défaut** et suit l'attribut `lang` quand il
est là :

| balise | coloration | accepté par le compilateur |
| --- | --- | --- |
| `<style>`, `<style lang="sass">`, `<theme>` | SASS indenté (défaut) | oui |
| `<style lang="scss">`, `<theme lang="scss">` | SCSS | oui |
| `<style lang="css">`, `<theme lang="css">` | CSS | oui |
| `<style lang="less">`, `<theme lang="less">` | Less | **non** |
| `<style lang="stylus">`, `<theme lang="stylus">` | SASS indenté, faute de grammaire Stylus | **non** |

Les deux dernières lignes ne colorent que l'éditeur : `mjs build` n'accepte que `sass`, `scss` et
`css` (`src/transpiler/sections.ts`) et refusera un bloc en `less` ou en `stylus`. Elles sont là
pour un composant en cours de portage, où l'on veut déjà lire son style correctement.

Stylus n'a pas de grammaire dans VS Code — aucune extension installée ne publie `source.stylus`. Ses
blocs reçoivent donc la grammaire SASS, dont la syntaxe indentée est la plus proche : les propriétés
et les valeurs sortent juste, l'interpolation `{...}` et les mixins propres à Stylus non.

L'ordre des attributs est libre : `<style name="bandeau" lang="scss">` marche aussi. Un `lang` d'une
autre valeur retombe sur le SASS. Attention, `data-lang="css"` n'est pas un `lang=` et ne change rien.

Un `<theme>` ne contient que des déclarations (`--variable: valeur`), jamais de sélecteur : ses blocs
`scss`, `css` et `less` sont donc colorés par un sous-ensemble borné à la ligne, où le point-virgule final
reste facultatif. Un `<style>`, lui, est une feuille de style entière et reçoit la grammaire complète
du langage — avec sa contrepartie, la même que dans un fichier HTML ordinaire : une accolade laissée
ouverte fait déborder la coloration au-delà du `</style>`, jusqu'à ce que la règle soit refermée.

## Le bloc `<routes>`

La table de routes déclarative — `<routes target="…">`, une route par ligne — est colorée comme une
petite grammaire à elle seule :

| ce qui est écrit | scope TextMate | rôle |
| --- | --- | --- |
| `routes`, `target="…"` | `entity.name.tag.routes.html` | la balise, traitée comme `<script>` ou `<theme>` |
| `/agenda`, `/profil/plus` | `string.unquoted.route.segment.modularjs` | segment littéral du chemin |
| `:id`, `:onglet` | `variable.parameter.route.modularjs` | paramètre capturé |
| `(:an)`, `(fr)` | idem + `punctuation.definition.route.optional.*` | segment facultatif, capturant ou littéral |
| `*` | `constant.language.wildcard.route.modularjs` | attrape-tout, dernier segment |
| `foyer-page` | `entity.name.tag.route.modularjs` | le composant visé — la couleur de la balise qu'il produit |
| `#` en tête de ligne | `comment.line.number-sign.routes.modularjs` | commentaire de table |

Le bloc se **replie** comme les autres, et sa balise ouvrante doit commencer sa ligne : c'est la
condition qu'impose déjà le compilateur. Un `<routes>` posé en plein milieu d'une ligne ou enfermé
dans un commentaire HTML reste inerte des deux côtés — le compilateur l'ignore, l'extension ne le
colore pas.

### Ce que la table refuse

Une ligne que le compilateur rejetterait porte `invalid.illegal.…` : chemin sans `/` initial, trois
jetons sur la ligne (le commentaire de fin de ligne n'existe pas dans cette table), nom de composant
hors kebab-case ; et dans le chemin, `:12` ou `:id-bis` (paramètre mal formé), `(:x` non refermé, `*`
ailleurs qu'en dernier segment. Les motifs sont repris de `parseRoutesLines` et `validateRoutePath`
(`src/transpiler/sections.ts`) — même verdict des deux côtés. Une ligne en cours de frappe, le chemin
seul sans son composant, n'est **pas** signalée.

Beaucoup de thèmes — Monokai compris — ne peignent pas `invalid` : la ligne fautive garde alors la
couleur du texte ordinaire. Pour la voir, une règle dans les réglages :

```json
"editor.tokenColorCustomizations": {
  "textMateRules": [
    { "scope": "invalid.illegal", "settings": { "foreground": "#F92672", "fontStyle": "underline" } }
  ]
}
```

## La table calculée `@routes`

Une table qui se construit en boucle (un sommaire de documentation qui fabrique ses routes, par
exemple) ne peut pas s'écrire dans un bloc `<routes>` : elle vit dans le `<script>`, sous la forme
`@routes = {…}`. Elle est colorée avec **le même vocabulaire** que le bloc — chemin lu segment par
segment, nom de composant à la couleur de la balise qu'il produit :

```civet
  @routes =
    'app-view':
      '/':            'home-page'
      '/guide/:id':   'guide-page'
      '/docs/*':      'docs-shell'

  @routes['app-view']['/extra'] = 'extra-page'
```

Trois règles la délimitent, et elles comptent :

- seul un chemin **littéral** est lu comme un chemin. `"/#{page.slug}"` reste une chaîne ordinaire :
  l'extension ne devine pas ce que la boucle va produire ;
- la reconnaissance s'arrête au bloc — l'affectation `@routes =` et tout ce qui est **indenté sous
  elle**. La ligne suivante à la même colonne n'en fait plus partie ;
- **le même verdict qu'au bloc**. Une écriture se peint pareil où
  qu'elle soit posée : `/perdu/*/suite`, `/pas-ferme/(:x` ou `/mauvais/:id-bis` rougissent ici comme
  là-bas. Le compilateur, lui, ne relit toujours pas cette table — `validateRoutePath` n'est appelé
  que par `parseRoutesLines`. Le rouge y dit donc « cette route est fautive », pas « le build va
  échouer » : le routeur, seul juge au montage, y avale le reste après l'étoile, cherche les
  caractères `(:x` dans l'URL, et capture sous un nom qu'aucun `&param` ne sait relire.

  Le NOM DE COMPOSANT, lui, reste sans verdict : `'Mauvais-Composant'` fait échouer le bloc et ne
  déclenche rien ici — la paire ne se reconnaît même pas, faute de composant bien formé.

Le banc `tests/vscode-grammar-routes-parity.test.ts` tient les deux bouts : il tokenise chaque forme
avec le vrai moteur de VS Code, la passe à `parseRoutesLines`, et échoue au moindre écart.

## Les blocs `<vars>` et `<types>`

Le bloc `<vars>` d'un composant dit ce que chaque variable accepte (`$volume  int 0..100`) ; le
bloc `<types>` d'un fichier `*.types.mjs` nomme des règles valables dans toute l'appli
(`Percent  int 0..100`). Chaque morceau d'une règle a sa couleur :

| ce qui est écrit | scope TextMate | rôle |
| --- | --- | --- |
| `vars`, `types` | `entity.name.tag.vars.html`, `entity.name.tag.types.html` | la balise, comme `<routes>` |
| `$volume`, `$$cart` en tête de ligne | les scopes de `$x` et `$$x` du `<script>` | la variable, la prop ou le store réglé |
| `Percent` en tête de ligne d'un `<types>` | `entity.name.type.alias.modularjs` | la règle nommée définie |
| `Percent`, `Nick` dans une règle | `entity.name.type.modularjs` | une règle nommée citée |
| `int`, `float`, `string`, `bool` | `support.type.primitive.modularjs` | le type |
| `0`, `-10`, `0.5` · `..` | `constant.numeric.modularjs` · `keyword.operator.range.modularjs` | une plage |
| `'red'`, `"blue"` · `true`, `null` | `string.quoted.*.modularjs` · `constant.language.modularjs` | une valeur permise ou interdite |
| `\|` · `!` | `keyword.operator.union.modularjs` · `keyword.operator.negation.modularjs` | un choix · le début des interdits |
| `/^[a-z]+$/i` | `string.regexp.modularjs` | une forme de texte, drapeaux compris |
| `volume:`, `bass?:` | `variable.other.property.modularjs`, `?` en `keyword.operator.optional.modularjs` | un champ d'objet ; `?` = facultatif |
| `[]` · `{ }` | `meta.brace.square.modularjs` · `punctuation.definition.block.*.modularjs` | une liste · un objet |
| `#` hors d'une valeur | `comment.line.number-sign.vars.modularjs` (`….types.…`) | commentaire jusqu'en fin de ligne |

Un `#` dans une valeur (`'#'`) ou dans la classe d'une forme (`/^[#a-z]+$/`) reste à sa place, comme
pour le compilateur. La balise ouvrante commence sa ligne, comme `<routes>`. Le seul rouge est
un attribut sur la balise (`<vars lang="x">`) : le compilateur le refuse aussi. Le reste de ce que
le compilateur refuse — une plage sans `int` ni `float`, une règle nommée inconnue — demande de
lire la règle entière ou les autres fichiers : il ne se voit qu'au build.

Le banc `tests/vscode-grammar-vars-types.test.ts` tokenise un bloc complet avec le vrai moteur de
VS Code et vérifie chaque couleur.

## Les effets `*nom(…)`

Un effet se pose en un mot sur une balise (`<h1 *neon(#f0f, flicker: true)>`) ; ses réglages
s'écrivent entre parenthèses.

| ce qui est écrit | scope TextMate | rôle |
| --- | --- | --- |
| `*` · `neon` | `punctuation.definition.effect.modularjs` · `entity.name.function.effect.modularjs` | l'effet |
| `(` `)` | `punctuation.definition.arguments.*.modularjs` | ses réglages (le tout en `meta.effect.modularjs`) |
| `flicker:` | `variable.parameter.effect.modularjs` | un réglage nommé |
| `#f0f` · `true` · `15`, `200ms` · `'zoom'` | `constant.other.color…` · `constant.language.boolean…` · `constant.numeric…` · `string.quoted.*.modularjs` | une valeur |
| `$couleur`, `$$accent` | les scopes de `$x` et `$$x` du `<script>` | une variable, suivie par l'effet |
| `[` `]` | `punctuation.definition.list.*.modularjs` | une liste (`[#f0f, #0ff]`, `[Coder., 'Web']`), en `meta.list.effect.modularjs` |

Des parenthèses dans une valeur (`rgb(0, 255, 255)`) ou les crochets d'une liste ne referment pas l'effet, et une étoile dans le
texte d'une balise n'est pas un effet. Le rouge ne couvre que ce que le compilateur refuse aussi :
`*neon=…` (les réglages vont entre parenthèses) et une valeur calculée `{…}` entre les parenthèses.
Un effet inconnu ou une valeur hors de sa règle ne se voient qu'au build, qui dit quoi écrire.

Une transition, `@in=*fly(up, distance: 60)`, `@out=*fade`, `@transition.global=*slide(x)` : la
directive (et ses modificateurs `.global`, `.shared`) prend la couleur d'un attribut, l'effet celle
d'un effet posé. En rouge, `@in.fly` — le nom de l'effet après un point, que le build refuse.

Le squelette d'une attente, `{await $profil *skeleton(radius: 8)}`, a la couleur d'un effet posé ; ailleurs dans une
expression `{…}`, une étoile reste une multiplication.

Le bloc `<effects>` d'un fichier `*.effects.mjs` :

| ce qui est écrit | scope TextMate | rôle |
| --- | --- | --- |
| `*titre`, `*halo(color: #0ff)` en tête de ligne | `meta.effect.definition.modularjs` (étoile et nom comme un effet posé) | l'effet défini, ses réglages et leur défaut |
| `=` | `keyword.operator.assignment.modularjs` | la définition |
| `*scramble(20, on: click)` après le `=` | les scopes d'un effet posé | l'effet réglé |
| `box-shadow:` | `support.type.property-name.css` | une déclaration CSS |
| `$size` | `variable.parameter.effect.modularjs` | un réglage, dans une valeur |
| `@keyframes` · `50%`, `from`, `to` | `keyword.control.at-rule.keyframes.css` · `entity.other.keyframe-offset.css` | l'animation et ses étapes |

Un attribut sur `<effects>`, et `;`, `{`, `}` dans une valeur, passent en rouge : le compilateur les
refuse aussi.

Le banc `tests/vscode-grammar-effets.test.ts` tokenise ces formes avec le vrai moteur de VS Code.

## La complétion et l'aide au survol des effets

Pendant la frappe, l'extension propose :

- après `*` : les 117 effets, avec leur famille et ce qu'ils font (`*ne` → `neon`, `*fly` après
  `@in=`), puis les effets de votre appli (`*titre`, `*halo`) ;
- après `*effet.` : ses alias — ceux que ModularJS livre, avec ce qu'on voit (`*filter.` →
  `frosted_glass`, `gray_spot`…), et ceux de votre appli (`*filter.net`) ; un alias de votre appli
  remplace celui de ModularJS qui porte le même nom, comme au build ;
- entre les parenthèses de `*nom(` ou de `*effet.alias(` : ses réglages pas encore écrits, chacun avec
  sa règle et son défaut (`*neon(` → `color`, `where`, `size`…) — la première valeur sans nom compte
  pour le réglage principal ; au début, les mots permis du principal (`*loader(` → `bloom`…). Un alias,
  ou un effet de votre appli qui règle un effet de la bibliothèque, propose les réglages de cet effet,
  avec la valeur qu'il leur donne à la place du défaut (`*filter.gray_spot(` → `spot` … `(alias : 280)`) ;
  un effet CSS de votre appli, ceux qu'il déclare, puis `on`, `duration`, `delay` et `easing` ;
- après `réglage:` : ses mots permis (`*lift(on: ` → `hover`, `view`, `click`, `always`), y compris
  ceux d'une règle qui mêle un type et des mots (`*hologram(zoom: ` → `true`, `false`, `spin`).

Au survol d'un effet : sa famille, ce qu'il fait, son réglage principal et le tableau de ses réglages
(règle, défaut). Au survol d'un alias, sur l'effet comme sur l'alias (`*filter.frosted_glass` se lit
d'un seul tenant) : d'où il vient, ce qu'on voit, son écriture (`*filter(style: none, blur: 12, …)`)
et le tableau des réglages de son effet, la valeur de l'alias marquée `(alias)`. Au survol d'un effet
de votre appli : son fichier et sa ligne, et de même son écriture et ses réglages. Au survol d'un
réglage entre les parenthèses : sa règle et son défaut, ou la valeur de l'alias. Un effet donné en
réglage (`*delta(fx: *scramble(`) se complète comme les autres.

Les effets de votre appli sont lus dans les fichiers `*.effects.mjs` de l'espace de travail (hors
`node_modules`) à l'ouverture, relus à chaque enregistrement et oubliés quand le fichier disparaît :
une modification pas encore enregistrée n'est pas lue. Comme au build, un nom déjà pris par un effet
de la bibliothèque, ou déjà défini par un autre fichier (lus dans l'ordre de leur chemin), est écarté,
et une déclaration que le build refuserait est sautée sans gêner les autres.

L'aide suit la langue de VS Code : en français pour une langue française, en anglais pour toute
autre. Ce que fait un effet et ce qu'on voit d'un alias viennent du chapitre 38 de la documentation
en français, et des fiches du site du framework en anglais ; un effet ou un alias que le site ne
décrit pas garde sa phrase française dans l'aide anglaise.

Les effets viennent du catalogue du framework et du chapitre 38 de sa documentation, recopiés dans
`effects.json` avec les alias que ModularJS livre (`src/effects/aliases-mjs.ts`) ; `effects-app.json`
porte les réglages que tout effet CSS d'une appli reçoit. Un effet ou un alias ajouté, un réglage
changé : `node --import tsx/esm script/vscode-effects.mjs` les régénère (les tests
`tests/vscode-effects.test.ts` et `tests/vscode-effets-alias-appli.test.ts` échouent tant qu'ils ne
sont pas à jour). Les phrases anglaises sont recopiées du site dans `effects-help-en.json`, une par
effet ou par alias, puis dans `effects.json` : la construction de l'extension ne lit jamais le site.
Quand le site change ses textes, ou qu'un effet ou un alias s'ajoute,
`node --import tsx/esm script/vscode-effects.mjs --site <racine du site>` les recopie, puis régénère
`effects.json`.

## Les autres blocs — ce qui a été vérifié

Le même examen a été passé à `<theme>`, `<style name="…">` et aux macros `<@…>` : une règle du
compilateur sans reflet dans la grammaire est un piège muet. Trois trous comblés :

| ce qui est écrit | ce que fait le compilateur | ce que fait l'extension |
| --- | --- | --- |
| `$$or: gold` dans un `<theme>` ou un `<style>` | variable de **thème** → `--mjs-or` | `keyword.control.directive.store.modularjs` + `variable.other.readwrite.store.modularjs`, comme dans un `<script>` — avant, la grammaire SASS la peignait comme une variable `$sass` ordinaire, qui n'est pas la même chose |
| `<style name="Compact">`, `<theme name="Gold">` | **échoue** : `THEME_NAME_RE = /^[a-z][a-z0-9-]*$/` | `invalid.illegal.theme-name.modularjs` sur la valeur, la balise et le reste inchangés |
| `<@include "./x.html">` | la cible ne matche pas `INCLUDE_RE` : le tag reste **brut dans le DOM**, sans un mot | `invalid.illegal.include-cible.modularjs` ; une cible bien formée passe en `string.unquoted.include.modularjs` |
| `<style @css="…">`, `<theme @x>` | attribut de bloc | le `@` entre enfin dans le jeton (`punctuation.definition.symbol.modularjs`), comme sur `<@x @click={…}>` |

Deux écarts sont **assumés** et ne seront pas comblés : un doublon de chemin dans une table est un
état d'ensemble qu'une grammaire lisant ligne par ligne ne peut pas voir, et `@viewTransition` guillemeté
sur un `<style name="…">` demande de croiser deux attributs de la même balise — hors de portée d'un
motif TextMate.

## Installation

Sans passer par la place de marché — copiez le CONTENU du dossier dans les extensions de votre
éditeur, puis relancez-le ; la même commande met à jour une installation existante :

```
mkdir -p ~/.vscode/extensions/modularjs-syntax
cp -r editors/vscode/. ~/.vscode/extensions/modularjs-syntax/
```

`cp -r editors/vscode ~/.vscode/extensions/modularjs-syntax` (sans le `/.`) ne met rien à jour
quand le dossier existe déjà : il range une copie à l'intérieur, que l'éditeur ne lit pas.

(Sous VS Codium : `~/.vscode-oss/extensions/`. Sous Windows :
`%USERPROFILE%\.vscode\extensions\`.)

## Le cas de l'extension `.mjs`

`.mjs` est aussi l'extension des modules JavaScript de Node, et VS Code l'associe à
JavaScript par défaut. L'extension revendique `.mjs` de son côté ; dans un projet qui contient
les deux — des composants ModularJS **et** de vrais scripts Node — tranchez par chemin, dans
les réglages du projet (`.vscode/settings.json`) :

```json
{
  "files.associations": {
    "**/app/modularjs/**/*.mjs": "modularjs",
    "**/script/**/*.mjs": "javascript"
  }
}
```

Les motifs de `files.associations` priment toujours sur l'association par extension : ce que
vous écrivez là gagne.

## Ce que l'extension ne fait pas

Hors des effets, elle colore sans comprendre : ni complétion, ni navigation vers la définition, ni
diagnostics. Les erreurs de compilation restent celles du compilateur — `mjs dev` les affiche
au terminal et dans le journal d'erreurs (`/__mjs/errors`).
