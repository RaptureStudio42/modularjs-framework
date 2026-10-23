# 7 · Bindings two-way

> 📚 Tuto interactif correspondant : **Chapitre 6 — Liaisons d'entrées** et **Chapitre 13 — Bindings avancés**. Les encarts 🎓 *Pour débutants* dépliables donnent l'explication pas-à-pas ; le corps de la page reste la référence dense.

Un **binding two-way** relie une valeur réactive à un attribut d'élément **dans les deux sens** : la variable met à jour le DOM, et l'interaction de l'utilisateur (frappe, clic, sélection) met à jour la variable. La syntaxe est le `!` collé au `=` :

```
attribut=!{$variable}
```

> ⚠️ Il n'y a **pas** de `@bind:value` ni `@bind:checked` en MJS. La seule forme officielle est `=!{…}` — le `!` se place entre le `=` et l'accolade ouvrante. À l'inverse, `attribut={…}` (sans `!`) est un binding **one-way** : la variable écrit dans le DOM, mais l'interaction ne remonte pas.

## Champ texte

Le binding le plus simple : `<input value=!{$x}>`. Frapper dans le champ écrit dans `$x`, et toute modification de `$x` réécrit le champ.

```html
<script>
  $name = 'world'
</script>

<input value=!{$name} />
<h1>Hello {$name}!</h1>
```

<details>
<summary>🎓 <b>Pour débutants</b> — « two-way », ça change quoi&nbsp;?</summary>

Avec un binding **one-way** (`value={$name}`), MJS écrit `$name` dans le champ — mais si vous tapez au clavier, la variable `$name` **ne bouge pas**. Vous devriez écouter l'événement `@input` et réaffecter `$name` vous-même.

Le `!` (`value=!{$name}`) fait les **deux** d'un coup : MJS pose l'écouteur pour vous, et tient la variable et le champ synchronisés en permanence. Vous déclarez le lien une fois, MJS gère la circulation dans les deux sens.

</details>

**Un bouton « réinitialiser » revient au premier affichage.** Pour une case `checked={…}` et une option `selected={…}`, l'état de départ du formulaire — celui où `form.reset()` revient — est la valeur liée au premier rendu.

**Le champ garde ce que vous tapez.** Avec ou sans `!`, un champ lié (`value={…}`, une case `checked={…}`, une option `selected={…}`) n'est réécrit que quand sa valeur liée change — jamais parce qu'autre chose se redessine dans le composant (une ligne de `{for}`, un compteur, la langue). Si votre gestionnaire refuse une frappe sans changer la variable, la lettre tapée reste donc affichée : pour la retirer, écrivez dans le champ vous-même (`e.target.value = $name`), ou laissez le garde des types (`*guard`, cf. [37 · Types](37-types.md)) corriger le champ quand on le quitte. Un `<select>` fait exception : il se réécrit à chaque rendu, ses options pouvant arriver après sa valeur.

**Un champ nombre garde sa frappe en cours.** Un champ `type="number"` lié (`value=!{$n}`) dont la saisie est incomplète (`1.`, `-`, `1e`) n'écrit rien : ni la variable, ni le champ. Un champ nombre lié se comporte comme un champ natif : une saisie que le navigateur refuse (`-`, `1e`, `1,5` dans Firefox) reste dans le champ à la sortie (focus ailleurs, touche Entrée) et la validation native bloque l'envoi ; seul le code la remplace : une écriture de la variable, même avec la valeur qu'elle a déjà (`$n = 3` quand `$n` vaut 3), réécrit le champ et débloque le formulaire, sauf pendant que vous tapez dans ce champ (il a le focus) : votre frappe reste. Un champ dont la saisie est valide n'est jamais réécrit par une écriture de la même valeur. Cette reprise vaut pour une variable nommée simplement (`value=!{$n}`). Vidé, il reste vide tant qu'on l'édite, et la variable prend 0 (avec `.int` ou `.float`, elle garde sa valeur). Avec `.number`, `.int` ou `.float` sur un champ texte, un texte qui n'est pas un nombre (`.`, `-`, `abc`) reste dans le champ et la variable ne reçoit jamais `NaN`.

## Cases à cocher — `checked=!`

Sur un `<input type="checkbox">`, on lie l'état coché à un booléen avec **`checked`** (pas `value`) :

```html
<script>
  $yes = false
</script>

<label>
  <input type="checkbox" checked=!{$yes} />
  Yes! Send me regular email spam
</label>

<button disabled={!$yes}>Subscribe</button>
```

Ici `disabled={!$yes}` est un binding **one-way** (calculé à partir de `$yes`) : on ne lie pas l'attribut `disabled` lui-même, on le dérive.

> ⚠️ **`aria-*` à `false` reste écrit, jamais retiré.** Un attribut `aria-*` lié à une valeur `false` s'écrit `aria-x="false"` : pour un lecteur d'écran, un panneau *replié* (`aria-expanded="false"`, l'attribut est bien présent) n'a pas le même sens qu'un élément qui *n'a pas cette propriété* (attribut absent). `null`/`undefined` retirent l'attribut normalement, `aria-*` compris — seule la valeur `false` fait exception, et seulement pour un nom d'attribut `aria-*`. Tout autre attribut (`disabled`, `hidden`, `data-*`…) retire bien l'attribut dès que sa valeur vaut `false`, `null` ou `undefined`.

> ℹ️ **Une valeur d'attribut ENTRE GUILLEMETS réduite à une seule expression suit la même règle.** `disabled="{$flag}"` (guillemets, rien d'autre que `{$flag}` à l'intérieur) se comporte EXACTEMENT comme la forme sans guillemets `disabled={$flag}` : `$flag` à `false` retire l'attribut, il ne pose pas le texte `"false"`. Sur un attribut non booléen, `href="{$x}"` avec `$x` à `null`/`undefined` retire l'attribut au lieu d'écrire le texte littéral `"null"`/`"undefined"`. Dès que la valeur quotée mélange du texte et une expression, ou en enchaîne plusieurs (`href="/x?p={$id}"`, `alt="{name} dances."`), le résultat reste une **chaîne** assemblée par concaténation — rien n'y est jamais retiré pour cette raison, seule une expression SEULE entre guillemets bénéficie de la règle ci-dessus.

## Casts de type — le suffixe sur le **nom** de l'attribut

Un `<input>` renvoie une **chaîne** — sauf `type="number"`/`"range"`, que MJS convertit d'office en nombre. Pour les autres types, ou pour un entier/flottant/booléen explicite, on ajoute un suffixe de cast **sur le nom de l'attribut**, avant le `=!` :

```html
<script>
  $a = 1
</script>

<input type="number" value.number=!{$a} min="0" max="10" />
<input type="range"  value.number=!{$a} min="0" max="10" />

<p>somme = {$a + 5}</p>
```

Casts reconnus (le suffixe vient **toujours** sur le nom, jamais sur l'accolade) :

| Suffixe | Conversion appliquée | Exemple |
|---|---|---|
| `.number` | `Number(v)` | `value.number=!{$prix}` |
| `.int` | `parseInt(v, 10)` | `value.int=!{$age}` |
| `.float` | `parseFloat(v)` | `value.float=!{$taux}` |
| `.string` | `String(v)` | `value.string=!{$txt}` |
| `.bool` / `.boolean` | vrai si `true`/`'true'`/`'1'`/`1` | `value.bool=!{$ok}` |

> ⚠️ Le suffixe se met sur le **nom de l'attribut** : `value.number=!{$n}` ✓. Les formes `value=!.number{$n}` ou `value=!{$n}.number` sont **incorrectes** et ne compilent pas comme un cast. Sur `type="number"`/`"range"`, `value=!{$a}` **sans** `.number` donne déjà un nombre ; sur les autres types, il reste une chaîne : `"3" + "5"` donnerait `"35"`.

Les mêmes suffixes valent sur une liaison de **composant** (`<mon-champ value.number=!{$n}>`) : le composant reçoit la propriété `value`, et c'est la valeur qu'il **remonte** qui est convertie. La conversion ne joue en effet que dans ce sens-là, ici comme sur une balise native — descendante, la valeur vient de votre modèle, elle est déjà du bon type ; montante, elle vient de ce que quelqu'un a tapé.

<details>
<summary>🎓 <b>Pour débutants</b> — pourquoi mon nombre se comporte comme du texte&nbsp;?</summary>

En HTML, la valeur d'un champ est une chaîne de caractères — sauf sur `type="number"` et `type="range"`, que MJS convertit d'office en nombre. Sur les autres types, si vous liez `value=!{$a}` puis que vous faites `$a + $b`, vous obtenez une concaténation (`"1" + "2"` = `"12"`) au lieu d'une addition.

Le suffixe `.number` dit à MJS : « quand vous remontez la valeur du champ vers la variable, convertissez-la d'abord en nombre ». Du coup `$a` contient bien `1` (le nombre), et `$a + $b` fait `3`.

</details>

## Boutons radio & cases groupées — `@group=!`

Quand plusieurs entrées partagent **une même variable**, on les lie avec **`@group=!{$x}`**. MJS adapte le comportement selon le type :

- **radios** → `$x` reçoit la `value` de l'entrée sélectionnée (valeur unique) ;
- **checkboxes** → `$x` est un **tableau** des `value` cochées.

```html
<script>
  $scoops = 1
  $flavours = []
  menu = ['cookies and cream', 'mint choc chip', 'raspberry ripple']
</script>

{for number in [1, 2, 3]}
  <label>
    <input type="radio" name="scoops" value={number} @group=!{$scoops} />
    {number} {number === 1 ? 'scoop' : 'scoops'}
  </label>
{end}

{for flavour in menu}
  <label>
    <input type="checkbox" name="flavours" value={flavour} @group=!{$flavours} />
    {flavour}
  </label>
{end}
```

Les casts s'appliquent aussi : `@group.number=!{$scoops}` remonterait des nombres au lieu de chaînes.

> ⚠️ La `value` de chaque entrée est posée en **one-way** (`value={number}`), c'est `@group` qui porte le `=!`. Ne mettez pas `value=!` sur des radios groupées.

## Listes déroulantes — `<select>`

Sur un `<select>`, `value=!{$x}` lie l'option choisie. Avec l'attribut `multiple`, `$x` devient un **tableau**.

```html
<script>
  $selectedId = 1
  $flavours = []
  questions = [{ id: 1, text: 'A' }, { id: 2, text: 'B' }]
</script>

<select value=!{$selectedId}>
  {for q in questions}
    <option value={q.id}>{q.text}</option>
  {end}
</select>

<select multiple value=!{$flavours}>
  {for flavour in ['vanille', 'fraise', 'menthe']}
    <option>{flavour}</option>
  {end}
</select>
```

> ⚠️ La valeur d'une `<option>` est une **chaîne** (`"1"`, pas `1`). Pour comparer à un identifiant numérique, forcez la conversion à la lecture (`questions.find (x)-> x.id == +$selectedId`) ou posez un cast `value.number=!{$selectedId}`.

## Zone de texte & contenu riche

`<textarea>` se lie comme un `<input>`, avec `value=!{$x}` (et non via le contenu entre les balises) :

```html
<textarea rows="8" value=!{$value}></textarea>
```

`@text=!{$x}` lie le `textContent` d'un nœud dans les deux sens : la variable écrit dans le nœud, et taper dans un `contenteditable` remonte la saisie vers la variable.

```html
<script>
  $note = 'Prends des notes ici'
</script>

<div @text=!{$note} contenteditable></div>
<p>{$note}</p>
```

Il n'existe pas de forme unidirectionnelle `@text={expr}` : pour simplement **afficher** une valeur sans la rendre éditable, l'interpolation `{expr}` suffit. `@text=!` est le choix sûr pour un contenu éditable — rien n'y est jamais interprété comme du HTML, à la différence de son jumeau ci-dessous.

Pour du HTML éditable, **`@html=!{$html}`** lie l'`innerHTML` du nœud dans les deux sens — frapper dans un `contenteditable` met à jour la variable :

```html
<script>
  $html = '<p>Écrivez du <strong>texte</strong> !</p>'
</script>

<div @html=!{$html} contenteditable></div>
<pre>{$html}</pre>
```

`@html=!` n'écrit le nœud que si la valeur a changé depuis la dernière fois : un HTML que le navigateur relit autrement (balise non fermée, attributs sans guillemets, `<img src=x onerror=…>`) est posé une fois par valeur, pas à chaque mise à jour de la page, et le curseur d'un `contenteditable` ne bouge pas. Ce que vous tapez remonte vers la variable tel que le navigateur le relit (`<p>un</p>` pour `<p>un`).

> ⚠️ Le HTML brut expose au **XSS** : `@html=!` pose l'`innerHTML` sans la moindre sanitisation, exactement comme `{{ }}` ci-dessous — un contenu utilisateur (commentaire relu depuis la base, par exemple) n'y va jamais sans nettoyage côté serveur.

`@html=!` convient à une zone `contenteditable` brute. Pour un vrai éditeur de texte riche — barre d'outils, listes à cocher, collage nettoyé, HTML propre et identique d'un navigateur à l'autre, champ de formulaire —, utilisez `<@@editor>` : voir [30 · Modules cœur](30-modules-coeur.md#editor-et-toolbar--éditeur-de-texte-riche).

### HTML brut en affichage — `{{ expr }}`

`@html=!` **édite** du HTML (deux sens). Pour seulement **afficher** du HTML sans l'échapper, utilisez l'interpolation à **double accolade** `{{ expr }}` — le simple `{ expr }` échappe toujours le texte :

```html
<div>{{ $articleHtml }}</div>
```

> ⚠️ Le HTML brut expose au **XSS**. N'utilisez `{{ }}` que sur du contenu de confiance, jamais une saisie utilisateur non assainie.

## Bindings sur une propriété d'objet

La cible d'un `=!` n'est pas forcément une variable nue : ce peut être un **champ d'objet** ou un **getter/setter d'instance**. Pratique dans un `{for}` où chaque ligne lie son propre élément :

```html
<script>
  $todos = [{ done: false, text: 'finir le tuto' }]
</script>

{for todo in $todos}
  <li @class{todo.done}="done">
    <input type="checkbox" checked=!{todo.done} />
    <input type="text" value=!{todo.text} />
  </li>
{end}
```

On peut aussi lier directement les propriétés d'une instance de classe : `value.number=!{$box.width}` écrit dans le setter `width` de l'objet `$box`.

## Dimensions de l'élément (lecture seule)

`clientWidth=!{$w}` et `clientHeight=!{$h}` exposent les dimensions **mesurées** du nœud dans des variables réactives — MJS installe un `ResizeObserver` qui réécrit `$w`/`$h` à chaque changement de taille. Ce sont des grandeurs **en lecture seule** : écrire dans `$w` ne redimensionne pas l'élément.

```html
<script>
  $size = 42
</script>

<input type="range" value.number=!{$size} min="10" max="100" />

<div clientWidth=!{$w} clientHeight=!{$h}>
  <span style="font-size: {$size}px" contenteditable>edit this text</span>
  <span>{$w} x {$h}px</span>
</div>
```

> ⚠️ Pas besoin de déclarer `$w` / `$h` dans le `<script>` : un `$` lu dans le template est auto-déclaré. Ils valent `0` avant le premier calcul de layout.

## Bindings de médias — `<audio>` / `<video>`

Sur un élément média, plusieurs propriétés sont bindables. La plupart sont **read-write** ; `duration` est **read-only** (le navigateur la fournit, on ne peut pas l'imposer).

```html
<audio src={$src} currentTime=!{$time} duration=!{$duration} paused=!{$paused}></audio>

<button @click={$paused = !$paused}>{$paused ? '▶' : '⏸'}</button>
```

| Binding | Sens | Effet |
|---|---|---|
| `currentTime=!` | read-write | position de lecture (secondes) |
| `paused=!` | read-write | écrire `false` appelle `play()`, `true` → `pause()` |
| `volume=!` `muted=!` `playbackRate=!` | read-write | volume / sourdine / vitesse |
| `duration=!` | **read-only** | durée totale (renseignée par le navigateur) |

## Bindings sur un composant enfant

`=!{…}` fonctionne aussi sur une **prop** de composant : la valeur circule dans les deux sens entre parent et enfant. Côté enfant, la prop est une variable `$` **ordinaire** — rien à déclarer.

```html
<!-- parent -->
<script>
  $pin = ''
</script>

<@tuto-keypad value=!{$pin} @submit>
```

```html
<!-- enfant tuto-keypad.mjs -->
<script>
  select = (digit)-> $value += digit
</script>
```

Le parent gagne toujours : c'est lui qui initialise sa variable (`$pin = ''`), et une valeur par défaut écrite dans le `<script>` de l'enfant ne remonte **jamais** dans `$pin`, même quand `$pin` est vide. Chaque écriture que l'enfant fait ensuite (un clic, son `µmount`, une minuterie, même quand le parent est détaché du document) remonte vers `$pin` côté parent, avec son type : un nombre reste un nombre. La référence à **l'instance** du composant (pour appeler ses méthodes) passe par `@this`, traité au chapitre [Directives DOM](09-directives-dom.md).

Dans un `{for}`, chaque ligne lie son composant à **son** élément :

```html
{for groupe in $menu by id}
  <@tuto-liste valeur=!{groupe.lignes} />
{end}
```

Inverser, déplacer, ajouter ou retirer des groupes ne mêle jamais leurs lignes : chaque enfant écrit dans l'élément de sa ligne. Cela vaut aussi pour ce qu'un enfant écrit à son réveil (son `µawake`, rejoué à chaque arrivée dans le DOM, donc quand sa ligne change de place) : l'écriture attend que la liste soit remise en ordre, puis remonte vers la ligne où l'enfant se trouve alors, jamais vers la place qu'il vient de quitter. Si le parent change la valeur de cette ligne au même moment, c'est la valeur du parent qui reste.

> 🔗 Voir aussi : [Directives DOM](09-directives-dom.md) → `@this=!{ref}` (référence au nœud / à l'instance, **sans `$`**) et `@attach` (actions DOM).

---

📚 **Apprendre en pratiquant** : ce chapitre correspond aux **Tutos interactifs n°6 (Liaisons d'entrées)** — texte, numériques, cases, `<select>`, groupes, `<select multiple>`, `<textarea>` — et **n°13 (Bindings avancés)** — `contenteditable`/`@html`, bindings dans un `{for}`, médias, dimensions, `@this`, bindings de composant.
