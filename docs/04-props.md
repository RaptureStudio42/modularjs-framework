# 4 · Props & attributs

> 📚 Tuto interactif correspondant : **Chapitre 3 — Props**. Les encarts 🎓 *Pour débutants* dépliables donnent l'explication pas-à-pas ; le corps de la page reste la référence dense.

Une **prop** est une donnée passée d'un parent à un composant enfant, via un **attribut** de balise. Côté parent on écrit l'attribut ; côté enfant on le lit comme un `$` réactif. Aucune déclaration de prop n'est nécessaire.

## Passer une prop (parent → enfant)

Le parent pose l'attribut sur la balise enfant. La valeur entre **accolades `{ }`** est une expression ; entre **guillemets `" "`** c'est une chaîne littérale.

```html
<!-- parent : app.mjs -->
<@nested answer={42}>
<@nested titre="Bonjour">
```

Dans l'enfant, l'attribut `answer` se lit `$answer`, `titre` se lit `$titre` — préfixés par `$`, donc **réactifs** :

```html
<!-- enfant : nested.mjs -->
<p>La réponse est {$answer}</p>
```

> ⚠️ **Ne déclarez pas** `$answer = ''` (ou toute autre valeur vide) « pour annoncer la prop » par réflexe venu d'autres frameworks. Un `$answer` lu dans le HTML de l'enfant est **auto-déclaré** : il reçoit directement la valeur passée par le parent. Une initialisation à vide ne sert à rien et brouille la lecture.

<details>
<summary>🎓 <b>Pour débutants</b> — props, attributs : c'est la même chose&nbsp;?</summary>

Quand vous écrivez une balise HTML normale, vous lui donnez des **attributs** : `<img src="…" alt="…">`. Une **prop** (propriété), c'est exactement ça, mais pour un composant MJS : `<@nested answer={42}>`. Vous « branchez » une donnée sur l'enfant via la balise.

Côté enfant, cette donnée arrive sous forme de variable réactive : l'attribut `answer` devient `$answer`. L'enfant n'a rien à réclamer ni à déclarer — il lit `$answer` là où il en a besoin, et MJS se charge de le remplir avec ce que le parent a passé.

Différence accolades vs guillemets : `answer={42}` passe le **nombre** 42 (expression évaluée) ; `answer="42"` passerait la **chaîne** `"42"`. Pour autre chose qu'un texte (nombre, booléen, objet, variable), utilisez les accolades.

</details>

## Attribut sans valeur

Sur une balise de composant, un attribut écrit sans valeur passe `true` — `<@@checkbox disabled>` équivaut à `disabled={true}`, exactement comme `<input disabled>` en HTML natif. `title=""` (valeur écrite mais vide) passe `''`.

```html
<@@checkbox disabled>   <!-- équivaut à disabled={true} -->
```

> ℹ️ Le runtime lit les textes `"true"` et `"false"` comme des booléens. Dans du HTML servi par un back, où aucun compilateur MJS ne passe, écrivez `disabled="true"` explicitement — un attribut nu y arrive comme `''`.

## `data-*` et `aria-*` : sur la balise

Un attribut `data-*` ou `aria-*` écrit sur un composant (`<@x>`, composant léger, `<@@x>` du cœur) se pose sur la balise du composant, comme sur une balise HTML. Fixe (`data-cle="abc"`), lié (`data-cle={$cle}`, `data-cle=!{$cle}`, store `$$cle`) ou sans valeur (`data-vide` donne `data-vide=""`), il arrive toujours sur la balise, et un attribut lié suit sa variable. Mêmes règles qu'en natif : `null` et `undefined` retirent l'attribut, `false` aussi pour un `data-*`, mais `aria-*` à `false` s'écrit `"false"` ; `true` s'écrit `"true"`.

Le composant lit la valeur sur sa propre balise : `@getAttribute('data-cle')`.

## Valeurs par défaut

Si le parent **omet** l'attribut, la prop est `undefined` côté enfant. On donne une valeur par défaut en **initialisant simplement la variable** dans le `<script>` de l'enfant :

```html
<!-- enfant : nested.mjs -->
<script>
  $answer = 'un mystère'
</script>

<p>La réponse est {$answer}</p>
```

Le parent peut alors fournir la valeur ou non :

```html
<!-- parent : app.mjs -->
<@nested answer={42}>     <!-- affiche : La réponse est 42 -->
<@nested>                 <!-- affiche : La réponse est un mystère -->
```

> 🔎 **Le parent gagne toujours, sans précaution particulière.** Le `<script>` s'exécute au *constructeur* ; les valeurs du parent, elles, arrivent au *montage* (`connectedCallback`), donc **après**. Une affectation simple `=` ne peut donc pas écraser la valeur du parent — y compris quand celle-ci est `0`, `false` ou `''`, qui arrivent intactes, avec leur type : le nombre `7` reste un nombre, une date reste une date.
>
> Le parent gagne aussi **dans sa propre variable**. Avec une liaison à deux sens (`answer=!{$x}`, voir [Bindings](07-bindings.md)), la valeur par défaut de l'enfant ne remonte **jamais** dans `$x`, même quand `$x` est vide : c'est le parent qui initialise sa variable. Cela vaut à chaque étage : un composant du milieu, qui reçoit sa valeur de son parent et la lie à son tour à son propre enfant, ne fait jamais remonter sa valeur par défaut dans la variable du premier parent, quel que soit l'ordre dans lequel les fichiers sont définis. Ce qui remonte, ce sont les écritures que l'enfant fait **lui-même** une fois les valeurs de son parent reçues — un clic, son `µmount`, une minuterie, et aussi son `µsleep` ou son `µdestroy` quand le parent est retiré avec lui.

<details>
<summary>🎓 <b>Pour débutants</b> — pourquoi pas <code>?=</code>&nbsp;?</summary>

`$answer ?= 'un mystère'` (« assigne seulement si vide ») est du Civet parfaitement valide, et on le croise dans du code plus ancien. Mais ici il ne change **rien** : au moment où le `<script>` tourne, la prop du parent n'est pas encore arrivée — `$answer` est toujours vide, la condition est toujours vraie. Autant écrire `=`, plus court et plus simple à lire.

</details>

## Les props sont réactives

Une prop n'est pas une copie figée au montage : si la donnée **change chez le parent**, l'enfant se met à jour automatiquement. Le lien parent → enfant est vivant, exactement comme un `$` interne. Rien de spécial à faire côté enfant : il lit `$answer`, et tout endroit du HTML qui l'affiche suit les changements.

## Propagation (spread) : `{...obj}`

Quand un enfant attend beaucoup de props, les énumérer une à une devient verbeux. La syntaxe **spread `{...obj}`** développe un objet en une série d'attributs :

```html
<script>
  pkg = {
    name: 'modularjs'
    version: 2
    description: 'ultra rapide'
    website: 'https://mjs.rapturestudio.fr'
  }
</script>

<@info {...pkg}>
```

L'enfant reçoit `$name`, `$version`, `$description`, `$website`. La propagation est **réactive bit à bit** : remplacer tout l'objet ou une seule de ses clés propage le changement.

On peut **mélanger** spread et attributs nommés. Comme avec `Object.assign`, l'ordre décide : un attribut explicite **après** le spread l'écrase ; **avant**, il est écrasé par l'objet.

```html
<@info {...pkg} version="1.7-beta">   <!-- version reste "1.7-beta" -->
```

> ℹ️ Le spread marche aussi sur une **balise HTML native** (`<input {...attrs} />`) : chaque clé est passée à `setAttribute` — pratique pour relayer un lot d'attributs de formulaire ou d'accessibilité (`aria-*`) stockés dans un objet. Deux spreads qui posent la même clé (`<div {...base} {...choix}>`) : le dernier qui la pose l'emporte, toujours. Une clé qui quitte l'objet quitte la balise, sauf si un autre spread la pose encore ; si vous avez écrit une valeur fixe pour cet attribut sur la balise (`<div class="carte" {...extra}>`), elle revient.

> ⚠️ Sur un élément SVG, les clés d'un spread se posent telles quelles, à l'exécution : écrivez-les avec leur casse SVG (`viewBox`, `preserveAspectRatio`, pas `viewbox`) et préférez `href` à `xlink:href`, qui y serait posé sans son espace de noms (l'icône d'un `<use>` n'apparaîtrait pas).

> ℹ️ Dans une branche `{success fiche}` ou `{error err}` d'un `{await}`, le spread peut lire la valeur de la branche (`<div {...fiche.attrs}>`) : les attributs sont posés quand la branche s'affiche, et un `{...$attrs}` suit `$attrs` (cf. [5 · Blocs](05-blocs.md)).

---

📚 **Apprendre en pratiquant** : ce chapitre correspond au **Tuto interactif n°3 (Props)** — déclaration d'attributs, valeurs par défaut, propagation (spread). Voir aussi [Réactivité](03-reactivite.md) (les `$` côté enfant) et [Anatomie d'un composant](02-composant.md) (interpolation d'attributs et composants imbriqués).
