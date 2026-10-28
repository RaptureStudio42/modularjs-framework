# 19 · SSR — rendu côté serveur

> 📚 Pas de chapitre de tuto interactif pour le SSR (il s'exécute côté serveur, hors de l'éditeur live) : cette page se suffit à elle-même. Les encarts 🎓 *Pour débutants* dépliables donnent l'explication pas-à-pas ; le corps de la page reste la référence dense.

Le **SSR** (*Server-Side Rendering*) fait rendre un composant **en HTML côté serveur**, pour deux gains : la page s'affiche **immédiatement** (sans attendre le JavaScript) et son contenu est **visible des moteurs de recherche** (SEO).

MJS suit la stratégie **« rendre puis remplacer »** (*render-then-replace*) :

1. le serveur rend le composant en HTML, emballé en **Declarative Shadow DOM** (styles inclus) ;
2. le navigateur **affiche** ce HTML sans exécuter de JS ;
3. quand le bundle arrive, le composant **adopte** ce Shadow DOM puis **reconstruit** sa vraie vue interactive à la place (le *swap*) — l'interactivité reprend.

> Le SSR requiert le paquet **`happy-dom`**, en version **20.11.2 au moins** (le DOM serveur utilisé pour rendre). Il est importé dynamiquement : un projet **client-only** n'en a aucun besoin. Installez-le pour le SSR : `npm i happy-dom@^20.11.2`.

## 1. Rendre un composant — `renderToString`

```js
import { renderToString } from 'modularjs-framework'

const { html, sharedScript } = await renderToString({
  sourceDir: './app/mjs',     // dossier des composants .mjs
  tag: 'mjs-page',            // composant racine à rendre
  props:  { article },        // données LOCALES (→ attribut sur la balise)
  store:  { user, panier },   // état GLOBAL de l'appli ($$x / µ.store) → sérialisé inline
})
```

> ℹ️ **L'état global se passe par `store`** — c'est le vrai état global de l'appli (`$$x` → `µ.store`), lu côté client par le store zéro-import. Il n'y a **plus** d'option `shared`/`§§` côté SSR (retirée) : `§§` nu est **toujours** un **contexte réactif de sous-arbre**, pas un espace global — rien à sérialiser à l'échelle de la page (cf. [Contexte](13-contexte.md)). Pour un singleton `µ$$x` importé (déclaré, importé et consommé avec ce même symbole — cf. [Stores](14-stores.md)), passez sa valeur initiale par `store` sous la clé correspondante, ou laissez le module l'initialiser lui-même.

`renderToString` **compile** les composants, les **monte** dans un DOM serveur, attend la fin du rendu, puis renvoie :

| Champ | Contenu |
|---|---|
| `html` | la balise complète : `<mjs-page …><template shadowrootmode="open">…</template></mjs-page>` |
| `sharedScript` | le `<script>` JSON de l'état global (`store`), à placer **une fois** dans la page (vide si aucun `store`) |
| `hydrateScript` | le `<script>` qui active l'hydratation côté client, à placer **avant** le bundle (vide si `ssrMode` vaut `'replace'`, le défaut — voir §6 ; vide aussi pour tout composant `mjs-light`, quel que soit `ssrMode` — voir piège plus bas) |
| `shadowHtml` | le markup rendu du shadow (sans le wrapper), utile pour des tests |
| `css` | le CSS scopé du composant (déjà inliné dans `html`) |
| `light` | `true` si le composant est en mode `mjs-light` (pas de Shadow DOM) |
| `warnings` | avertissements de compilation |

#### Les feuilles dans le fragment

Chaque racine d'ombre du fragment porte les feuilles qui la mettent en page, dans l'ordre où le navigateur les adopte : la remise à zéro (`mjs_reset`), les feuilles du thème (le thème clair/sombre embarqué, puis ceux de l'application), celles héritées d'une vue, celles que le composant déclare par `<style @css="a b">` dans l'ordre déclaré, puis sa feuille propre, qui garde le dernier mot. La page a ainsi la même géométrie avant et après le démarrage du JavaScript. Une racine d'ombre ne voit pas les feuilles d'une autre : chaque racine porte les siennes.

**En ligne ou liée.** Recopier une feuille dans chaque racine coûte cher : 300 composants identiques qui déclarent une feuille de 37 Ko feraient 11 Mo de HTML. La règle, feuille par feuille, sur le fragment entier :

- le surcoût de la répéter, `(nombre de racines − 1) × taille`, reste **sous 8 Ko** : la feuille reste en `<style>` en ligne, dans chaque racine. C'est le cas d'une page ordinaire (quelques racines, des feuilles de quelques Ko) : aucune requête de plus à la première visite ;
- au-delà, la feuille sort en `<link rel="stylesheet">` vers **un seul fichier**, nommé par l'empreinte de son contenu (`mjs_ssr_style_partagee-<nom>-<empreinte>.css`) et écrit une fois dans le dossier de sortie. Toutes les racines désignent la même URL : le navigateur la demande une fois, et la garde en cache pour les autres pages.

Un `<link>` dans une racine d'ombre ne fait pas sauter la mise en page (la racine n'est peinte qu'avec sa feuille), mais l'analyse du reste de la page attend l'arrivée du fichier : c'est pourquoi le petit surcoût reste en ligne. Sans dossier de sortie à vous (`renderToString` seul, sans `outputDir`), il n'y a aucun fichier à servir : tout reste en ligne. Le rendu à la requête (`mjs serve`, `ssr:*`) suit la même règle et écrit les fichiers dans le dossier de sortie du serveur ; ce dossier doit donc être servi avec le type `text/css` pour les `.css`. Sous `csp`, chaque feuille sort toujours en `<link>`, quelle que soit sa taille.

**Les fichiers liés et la purge.** Les fichiers écrits sont consignés dans `.mjs-outputs.json` (clé `ssrStyles`). À la fin de `mjs build`, la purge retire ceux que le prérendu de ce build n'a pas réécrits (une feuille modifiée, un composant retiré) et jamais un fichier absent du registre ; avec `"prune": false`, rien n'est retiré.

**Les modèles.** La feuille d'un **modèle** (`layout="alt"` avec `<style name="alt">`, ou un fichier `nom.alt.css`) est appliquée pendant le rendu, comme dans le navigateur : elle voyage dans la racine du composant, après sa feuille propre, et sa balise porte l'adresse de son fichier (`<style mjs-layout="…">`). Au démarrage, le composant repris la relit là, sans requête : la page servie montre déjà le bon modèle et le garde à la reprise, même quand le fichier tarde. Le bloc `{? alt}` et un modèle en fichier (`carte.alt.mjs`) sont rendus de même. Sous `csp`, la feuille du modèle sort en `<link>`, comme les autres.

**Ce qui n'est pas porté.** Un composant léger n'adopte pas de feuille partagée, ici comme dans le navigateur. Les feuilles du thème qui s'appliquent au **document** (hors de tout composant) ne voyagent pas non plus dans un fragment. En `css: 'lazy'`, les feuilles partagées sont des fichiers chargés à la demande : elles ne voyagent pas dans le fragment. Un `@import` écrit dans une feuille partagée est retiré du texte prérendu : le navigateur adopte ces feuilles par `replaceSync`, qui l'ignore, et la page prérendue applique donc les mêmes règles que la page démarrée.

Options : `ssrMode` (la stratégie de reprise en main — voir §6), `props`, `store`, `shadowMode` (`'open'` par défaut — **requis** pour la reprise en main), `settleMs` (plafond d'attente, défaut 1000 ms), `light` (racine sans Shadow DOM — §7), `outputDir`, `defaultScriptLang`.

<details>
<summary>🎓 <b>Pour débutants</b> — c'est quoi le Declarative Shadow DOM&nbsp;?</summary>

Un composant MJS vit dans un *Shadow DOM* (un mini-document isolé, avec ses styles à lui). Normalement ce Shadow DOM est créé **par le JavaScript**. Le **Declarative Shadow DOM** permet de l'écrire **directement en HTML**, avec une balise `<template shadowrootmode="open">` : le navigateur la rencontre au chargement et reconstruit le Shadow DOM **tout seul, sans JS**. C'est ce qui rend l'affichage instantané possible côté serveur.

</details>

#### Les champs de formulaire dans le fragment

Le fragment dit l'état **courant** de chaque champ de formulaire, pas seulement le balisage de départ. Un curseur lié à une variable (`<input type="range" value={$x}>`) sort avec sa valeur, une couleur avec son `#rrggbb`, une case ou un bouton radio avec son `checked`, une liste avec le `selected` de l'option choisie, une zone de texte avec son contenu. La page prérendue s'affiche donc, avant le démarrage du JavaScript, comme elle sera une fois démarrée : aucun curseur n'apparaît au milieu de sa course pour sauter à sa place au démarrage.

Le serveur recopie cet état au moment où il écrit la page, à toute profondeur (dans l'ombre de chaque sous-composant comme dans un composant léger), avec les deux moteurs de rendu ; le navigateur n'y change rien. Seul l'écart est écrit : un champ dont l'état est déjà celui que dit son balisage n'est pas touché (un curseur que personne n'a réglé, une liste dont l'option choisie est celle que le navigateur choisit seul — la première option utilisable —, une case dont l'attribut dit déjà l'état). Sur un `<select>` ou un `<textarea>`, l'attribut `value=""` que le gabarit déclare reste tel quel : il est sans effet, l'état est porté par `selected` et par le contenu.

Après la reprise d'une page préparée en mode `markers`, `positional` ou `diff`, la remise à zéro d'un formulaire (`reset`) ramène chaque champ à la valeur écrite par le serveur ; en mode `replace` (le défaut), la vue est reconstruite et `reset` ramène les valeurs du balisage du composant.

**Ce qui n'est jamais écrit.** La valeur d'un mot de passe (`type="password"`) et celle d'un fichier (`type="file"`) ne sortent pas du serveur : la page démarrée les retrouve dans l'état de l'application.

#### Les styles liés dans le fragment

Une valeur liée à une propriété de style — une variable CSS (`--teinte={$c}`), `@style.prop={…}`, la pastille de `<@@color>` — n'entre dans l'attribut `style` du fragment que si le navigateur l'accepterait. Une valeur qui ajouterait une déclaration ou avalerait la suivante (`red; background-image: url(…)`, un `!`, une accolade, une chaîne ou une parenthèse laissées ouvertes) est refusée, et la propriété reste ce qu'elle était — le navigateur refuse la même valeur, en silence, quand la page est rendue chez lui. Une donnée venue d'un visiteur ne peut donc pas faire appeler une adresse par la page rendue. Un `;` dans une chaîne (`"a;b"`) ou dans `url(data:image/png;base64,…)` reste permis.

## 2. Brancher le rendu dans une page

L'ordre dans la page compte : le `sharedScript` doit venir **avant** le bundle MJS (il est lu au démarrage du runtime). `sharedScript` porte en réalité **deux** balises JSON concaténées : `#__mjs_store` (l'état global, `store`) et `#__mjs_i18n` (langue + sections i18n **effectivement consultées** pendant CE rendu, et les textes racine lus, par langue — cf. [i18n](29-i18n.md) §2). Les deux se posent **avant** le bundle, dans cet ordre ; chacune est **absente** (chaîne vide) si elle n'a rien à transporter — aucun `store`, ou aucune section i18n consultée.

`hydrateScript` rejoint le même bloc, **avant** le bundle lui aussi, dès que `ssrMode` diffère de `'replace'` (§6 — `markers`/`positional`/`diff`) : c'est le `<script>` qui active l'hydratation choisie côté client. Sans lui, le client ne sait jamais qu'un mode d'hydratation a été demandé et retombe silencieusement en `replace` (les nœuds sont recréés plutôt qu'adoptés). Absent (chaîne vide) tant que `ssrMode` vaut `'replace'`, le défaut, et absent de la même façon pour tout composant `mjs-light`, quel que soit `ssrMode` : sans Shadow DOM, aucun mode d'hydratation n'a de nœud à reprendre en main (piège `mjs-light` plus bas).

```html
<!DOCTYPE html>
<html>
  <body>
    <!-- 1. le HTML rendu, à l'emplacement voulu -->
    <mjs-page mjs-ssr>
      <template shadowrootmode="open">…contenu pré-rendu…</template>
    </mjs-page>

    <!-- 2. l'état global ET la graine i18n, UNE fois chacune, AVANT le bundle -->
    <script type="application/json" id="__mjs_store">{"user":…}</script>
    <script type="application/json" id="__mjs_i18n">{"lang":"fr","sections":{"fr":{"panier":…}},"root":{"fr":{"titre":…}}}</script>

    <!-- 3. le bundle MJS : adopte le Shadow DOM, réhydrate $$ et les sections i18n semées, reprend la main -->
    <script src="/assets/mjs-bundle.js"></script>
  </body>
</html>
```

Côté serveur, on insère `html` à l'étape 1 et `sharedScript` (+ `hydrateScript`, si `ssrMode` n'est pas `'replace'`) à l'étape 2 — un seul bloc, les balises s'y concatènent dans le bon ordre. Tant que le bundle n'est pas chargé, la page est **affichée mais figée** ; dès qu'il s'exécute, elle devient interactive.

Le balisage rendu par le serveur **reste visible jusqu'au premier rendu client**, qui le remplace : chaque élément `mjs-*` rendu porte l'attribut `mjs-ssr` (posé par le rendu serveur, racine et imbriqués), et le masquage anti-FOUC du runtime — qui cache tout composant pas encore défini — épargne les éléments qui le portent. Un composant que le serveur n'a pas rendu reste, lui, masqué jusqu'à sa définition. Rien à faire côté page : l'attribut voyage avec le HTML, et le client n'a pas à le retirer.

`mjs-ssr` est **réservé au rendu serveur** : ne l'écrivez jamais à la main. Sur un composant `mjs-light`, il dit « ce contenu est la photo du serveur » — la balise qui le porte **remplace ses enfants** à la reprise en main du client, comme le ferait un Shadow DOM déclaratif. Posé à la main sur un léger qui porte des enfants écrits par l'auteur, il les fait donc disparaître au montage.

## 2-bis. Poser la balise soi-même, SANS SSR

La balise `#__mjs_store` **fonctionne sans aucun SSR** : une appli Rails qui ne rend jamais de composant côté serveur peut tout de même déposer ses données initiales de cette façon — le runtime la lit au boot (avant que les composants ne montent) et fusionne chaque clé dans `$$`, exactement comme après un `renderToString`. Deux règles s'appliquent, que le SSR soit utilisé ou non :

- **la balise précède le bundle** — même contrainte qu'à l'étape 1/2 ci-dessus : elle doit être lue **avant** que le JS du bundle ne démarre ;
- **l'échappement porte sur TOUT `<`**, pas seulement `</` : un `<` isolé dans une valeur (ex. `"a < b"`) peut lui aussi rouvrir une balise si le JSON est injecté tel quel dans le HTML — `renderToString`/`sharedScript` échappe déjà chaque `<` en `<` ; une génération manuelle (vue ERB, builder Ruby) doit faire la même chose, pas seulement sur `</script>`.

La même règle vaut pour une balise `#__mjs_i18n` posée à la main (forme `{"lang":"fr","sections":{"fr":{"panier":{…}}}}` — `sections` nichée par langue puis par section, `root` (facultative) portant de même, par langue, les textes racine lus, cf. [i18n](29-i18n.md) §2, même échappement) : elle se pose JUSTE APRÈS `#__mjs_store`, JUSTE AVANT le bundle — utile pour semer, sans SSR, les traductions qu'une page rend déjà côté serveur par un autre moyen (vue ERB, etc.). Les sections et `root` sont reprises toutes deux, quelle que soit la configuration du client : tout build qui traduit porte la reprise des textes racine, que la graine vienne d'un prérendu, d'une page rendue par l'API (`renderToString`, `createSSRRenderer`) ou de votre main.

```erb
<%# côté Rails, par exemple %>
<script type="application/json" id="__mjs_store"><%= raw({ user: @user, settings: @settings }.to_json.gsub('<', '\u003c')) %></script>
<script src="/assets/mjs-bundle.js"></script>
```

Voir [Stores](14-stores.md#lire-une-clé-que-le-serveur-na-peut-être-pas-garnie) pour lire, dans un composant, une clé que le serveur n'a peut-être pas envoyée.

## 3. Réutiliser un renderer — `createSSRRenderer`

`renderToString` recompile à chaque appel. Pour rendre **plusieurs** composants (ou servir plusieurs requêtes), compilez **une seule fois** avec `createSSRRenderer` :

```js
import { createSSRRenderer } from 'modularjs-framework'

const renderer = await createSSRRenderer({ sourceDir: './app/mjs' })

// à chaque requête — pas de recompilation :
const a = await renderer.renderToString('mjs-page', { props: { article } })
const b = await renderer.renderToString('mjs-card', { props: { item } })

await renderer.close()   // libère le bundler en fin de vie
```

## 4. Passer des données

MJS distingue deux portées, **transmises différemment** (voir aussi [Props](04-props.md) et [Stores](14-stores.md)) :

### Données locales → `props` (attribut)

Les props propres à un composant passent par sa balise, et le composant les reçoit **avec leur type**, côté serveur **et** côté client, comme celles qu'un parent lui passe (`<@card stock={12}>`). Une chaîne, un booléen ou `null` s'écrit en **attribut** ; les **objets et tableaux** aussi, sérialisés en **JSON** et ré-hydratés automatiquement au montage.

Un **nombre** ne tient pas dans le texte d'un attribut : `stock="12"` se lirait `"12"`, et `$stock + 1` donnerait `"121"`. Il voyage donc aussi dans l'attribut `mjs-props`, en JSON, avec les chaînes que la balise lirait autrement (`'true'`, `'null'`, un texte en JSON comme `'[1]'`, qui restent des chaînes). Le composant lit `mjs-props` à son montage, sur le serveur comme dans le navigateur : ces valeurs l'emportent sur leur attribut texte.

Un nom de prop en camelCase (`userId`) s'écrit en kebab-case sur la balise (`user-id="5"`) : le nom d'un attribut ne garde pas sa casse, et le composant relit `user-id` en `userId`.

```js
await renderToString({ sourceDir, tag: 'mjs-card',
  props: { title: 'Stylo', item: { price: 3, tags: ['neuf'] }, stock: 12 } })
// → <mjs-card title="Stylo" item="{…JSON…}" stock="12" mjs-props="{…JSON…}">…</mjs-card>
```

Comme ces attributs sont portés par la balise dans le HTML envoyé, le client les **relit gratuitement** lors de la reprise en main : la donnée locale n'a pas besoin d'un transport séparé. `mjs-props` est lu chaque fois que la balise entre dans la page : au **démarrage** du runtime comme **plus tard**, quand une navigation (UJS) ou votre propre code (un fragment reçu par `fetch`) y pose une page rendue par requête — un nombre y reste un nombre.

Une prop écrite en texte dans votre HTML (`<mjs-card stock="12">`) reste une chaîne, comme sans rendu serveur.

### État global → `store` (store `$$` inline)

L'état global de l'appli (`$$`, c.-à-d. `µ.store`) est injecté côté serveur via `store`, sérialisé dans `sharedScript`, et **réhydraté au démarrage** du runtime — avant que les composants ne montent.

```js
const { html, sharedScript } = await renderToString({ sourceDir, tag: 'mjs-header',
  store: { user: { name: 'Ada' }, theme: 'dark' } })
```

```html
<script>
  $$user.name     # lu côté composant → la valeur réhydratée du serveur
</script>
<header>Bonjour {$$user.name}</header>
```

Aucun appel réseau au montage : l'état voyage **dans la page** (la stratégie de Next.js / Nuxt). On ne re-fetch pas ce que le serveur connaît déjà.

<details>
<summary>🎓 <b>Pour débutants</b> — pourquoi pas un appel AJAX pour charger l'état&nbsp;?</summary>

Le serveur a **déjà** les données (il vient de s'en servir pour rendre le HTML). Refaire un appel réseau au démarrage du client, ce serait : attendre une réponse (la page « clignote »), refaire le travail, et charger le serveur pour rien. En **sérialisant l'état dans la page**, le client l'a immédiatement et reconstruit la vue à l'identique, sans aller-retour. On garde l'AJAX pour ce qui est chargé **plus tard** (défilement infini, données secondaires).

</details>

## 5. Comment la reprise en main fonctionne

Au chargement du bundle, chaque composant constate qu'un Shadow DOM (le DSD du serveur) **existe déjà** : au lieu d'en créer un nouveau (ce qui lèverait une erreur), il le **réutilise**, en vide le contenu pré-rendu, et y reconstruit sa vraie vue interactive. C'est le *swap* : un seul rendu visible, sans doublon, et l'interactivité (événements, réactivité) est branchée.

**La page démarre d'un seul geste.** Avec `js: 'split'` (le défaut : un fichier de code par composant), les fichiers partent tous ensemble mais n'arrivent pas au même instant. Si chaque composant prenait la main dès l'arrivée de son fichier, deux défauts se verraient à l'écran : un bloc qui démarre avant son sous-bloc jette la page du serveur pour bâtir la sienne, et son sous-bloc disparaît le temps que son fichier arrive ; un sous-bloc qui démarre avant son bloc s'affiche avec ses réglages par défaut — le serveur n'écrit pas dans la page ceux que le bloc lui passe — jusqu'à ce que le bloc le redessine. La page attend donc que les fichiers de **tous** les composants qu'elle affiche soient arrivés (enfants, petits-enfants, composants légers, enfants d'une seule des occurrences d'un composant), puis les démarre d'un seul geste, du parent vers les enfants : le parent bâtit sa vue et passe ses réglages à ses enfants, qui prennent la main dans la foulée, avant l'image suivante. La page du serveur reste affichée, intacte, pendant l'attente (elle ne répond pas encore au clic). L'attente est plafonnée à une demi-seconde : un fichier qui échoue ne retient personne (la console dit le fichier perdu) ; un fichier qui n'arrive pas retient la page jusqu'au plafond, qui part alors sans lui — il prend la main à son arrivée, s'il arrive. Rien ne change en `js: 'bundle'` (un seul fichier : les composants sont définis d'un coup), pour une page sans rendu serveur, ni pour un composant que la page du serveur n'affiche pas (inséré plus tard, ou écrit sans rendu serveur) : celui-là se charge seul et prend la main à l'arrivée de son fichier.

Le rendu serveur **attend** la fin du travail asynchrone avant de produire le HTML : un bloc `{await}` qui charge des données est rendu **résolu** (le contenu final), pas son état de chargement.

> ⚠️ En mode SSR le Shadow DOM est en **`open`** (pour que le client puisse récupérer le DSD du serveur). En rendu purement client, il reste `closed` comme d'habitude — le SSR ne change donc rien au comportement d'une appli non rendue côté serveur.

**Les libellés des modules cœur sont dans la page servie.** Le « Aucune valeur » d'un graphique vide, les noms de sa barre d'outils, le texte d'attente de `<@@select>`, les noms des boutons de `<@@number>`… s'écrivent dans la langue que la page reprise choisira : `µlang` (passez `store: { __mjsLang: 'en' }` au rendu), sinon la langue du module i18n, sinon celle du projet (`i18n.default`, sinon la clé `lang`). Vos surcharges `mjs.core.<clé>` du dictionnaire racine sont respectées et voyagent dans la graine `#__mjs_i18n` : la reprise ne change aucun de ces textes. Le rendu serveur ne voit pas le `<html lang>` de votre page : si elle n'est pas dans la langue du projet, donnez-la par `i18n.default` ou par `µlang`.

## 6. Choisir la stratégie de reprise en main — `ssrMode`

La reprise en main (rendre la page interactive au boot) peut suivre **quatre stratégies**, choisies via l'option `ssrMode` :

```js
await renderToString({ sourceDir, tag: 'mjs-page', ssrMode: 'markers' })
```

| `ssrMode` | Comment | Nœuds recréés au boot | Idéal pour |
|---|---|---|---|
| `'replace'` *(défaut)* | reconstruit la vue à côté et **remplace** la photo serveur | tous | le plus simple ; suffit dans la plupart des cas |
| `'markers'` | le serveur **étiquette** les nœuds réactifs ; le client les **adopte** | **0**\*\* | économiser le CPU au boot (le plus efficace) |
| `'positional'` | adopte par **position** (sans étiquette ; HTML propre) | tous\* | HTML serveur minimal, structure stable |
| `'diff'` | adopte en **comparant/corrigeant** (réconciliation) | tous\* | robustesse à un écart serveur/client |

\* `positional` et `diff` recréent un arbre temporaire pour s'aligner, puis le jettent : ils **réutilisent le DOM serveur** (état préservé : focus, défilement) mais n'économisent pas la création. Seul `markers` ne recrée rien.

\*\* Hors le contenu des blocs `{if}`, `{key}` et `{await}`, que le client refait au premier rendu (les lignes d'un `{for}`, elles, sont reprises : voir plus bas), un composant sans aucun nœud réactif (rien à adopter) et un composant que le parseur du navigateur a réarrangé (voir plus bas) : ceux-là sont reconstruits, pour le même résultat à l'écran.

> 💡 Les trois modes d'hydratation (`markers` / `positional` / `diff`) réutilisent les nœuds du serveur : ils **préservent l'état du DOM** (focus, scroll, champ en cours) et évitent tout clignotement. `replace` reconstruit tout — c'est le plus simple, et déjà sans flash visible (le remplacement est synchrone).

<details>
<summary>🎓 <b>Pour débutants</b> — laquelle choisir&nbsp;?</summary>

Commencez par **`replace`** (le défaut) : le plus simple, il marche partout. Passez à **`markers`** si vous voulez que la page se « réveille » sans rien refabriquer (le navigateur travaille moins au démarrage). `positional` et `diff` gardent un HTML serveur sans étiquettes ; `diff` est le plus tolérant si le rendu serveur et le rendu client diffèrent un peu.

</details>

> ℹ️ Périmètre actuel des trois hydratations : **éléments + interpolations de texte**. Les blocs `{if}`, `{for}`, `{key}` et `{await}` restent rendus par `replace` en attendant leur prise en charge : en `positional` et en `diff`, un composant qui porte l'un d'eux est reconstruit en entier, comme en `replace` (le HTML du serveur n'étiquette rien, il ne dit donc pas où le bloc commence ni où il finit) ; en `markers`, la page est reprise tout autour d'eux et leurs ancres sont reprises ; les lignes d'un `{for}` sont reprises elles aussi (ci-dessous), le contenu d'un `{if}`, d'un `{key}` ou d'un `{await}` est refait par le client au premier rendu, et tous restent vivants ensuite.
>
> **Les lignes d'un `{for}` en `markers`.** Le serveur repère chaque ligne (sa clé, ses nœuds réactifs) ; au premier rendu, le client reprend toute ligne dont la clé est celle de l'élément de même rang dans le navigateur, une fois les doublons écartés (deux éléments de même clé : seul le premier compte, comme à l'affichage) : ce sont les nœuds du serveur, aucun n'est recréé, et le visiteur garde le champ où il écrivait : son focus, et le texte tapé dans un champ que l'état ne remplit pas (un champ lié par `value={…}` reçoit la valeur de l'état). Une ligne qui ne correspond pas (autre clé à ce rang, donnée différente entre le serveur et le navigateur, repère déplacé par le parseur) est refaite, les autres restent. Une liste sans `by` se reprend par le rang : une liste d'objets (leur identité ne voyage pas du serveur au navigateur) comme une liste de valeurs simples. Il en va de même d'une ligne dont la clé `by` est vide (`null`, `undefined`) ou est un objet suivi par son identité (un objet ordinaire, gelé ou non), et des lignes d'une `Map` dont les clés sont des objets. Une clé que vous écrivez (un texte, un nombre, un objet qui s'écrit lui-même comme une date ou un tableau ; en `by` ou comme clé d'une `Map`) se compare telle quelle, quelle que soit sa forme (`mjs-1` compris) : une ligne n'est jamais reprise par le rang sous une autre clé, la saisie faite sur une ligne ne passe pas sur une autre. Une liste dans une ligne se reprend de la même façon, ligne à ligne ; un `{for}` placé dans un `{if}`, un `{key}` ou un `{await}` est refait avec son bloc. Une ligne qui porte un `{if}` est reprise, le contenu du `{if}` est refait. Les repères pèsent dans le HTML : une soixantaine d'octets par ligne pour une ligne de tableau à deux textes repris (+3,5 Ko compressés pour 1 000 lignes), retirés du DOM à la reprise.
>
> Les feuilles que le serveur écrit en tête de chaque racine d'ombre (§1 : `<style>` en ligne, ou `<link>` vers le fichier partagé) restent en place : elles ne comptent pas dans l'alignement de `positional` et de `diff`.

> ℹ️ Le navigateur relit le HTML du serveur avec son parseur HTML, qui range certains éléments autrement que le gabarit : un `<tr>` écrit directement sous un `<table>` reçoit un `<tbody>`, un `<div>`, une liste ou un `<table>` referme le `<p>` qui le contient, un `<li>` sous un `<li>`, une `<option>` sous une `<option>`, un `<a>` sous un `<a>` ou un `<button>` sous un `<button>` referment le premier, un texte écrit directement dans un `<table>` ou un `<tr>` sort du tableau. En `markers`, quand le parseur a séparé les deux ancres d'un bloc ou sorti le texte d'une interpolation, le composant n'est pas repris : sa vue est reconstruite, comme en `replace`, sans erreur. Pour garder la reprise, écrivez un HTML que le parseur ne modifie pas : un `<tbody>` explicite autour des `<tr>` d'un `{for}` ou d'un `{if}`, ni `<div>`, ni liste, ni tableau dans un `<p>`.
>
> Un contenu que le HTML refuse à cet endroit (un `<div>` directement sous un `<table>`) est sorti du tableau par le parseur sans que la reprise le sache : le serveur en laisse un exemplaire de trop à l'écran.

> ⚠️ **Le serveur et le navigateur doivent être construits à partir des mêmes pages.** Les repères du mode `markers` portent des numéros qui suivent le contenu de chaque module, et la construction en retire les parties qu'aucune page n'emploie : celles de `<@@editor>`, de `<@@select>`, de `<@@sortable>` ou de `<@@chart>` (`answer`, `other`, `group`, un outil de la barre, `toolbar`…), de la même façon en développement et en production. Un serveur en développement — c'est le défaut de `createSSRRenderer` — et un navigateur en production portent donc les mêmes parties ; mais un serveur construit sur d'autres pages que le navigateur n'a plus les mêmes numéros. Quand les repères d'un composant ne correspondent pas à ce que le navigateur attend, ce composant est **reconstruit, sans erreur**, comme en `replace` : il perd le gain de la reprise, jamais son fonctionnement, et un avertissement le dit une fois par balise (cause probable : le serveur et le navigateur ont été construits différemment). Cette vérification ne porte que sur les composants qui écrivent des événements dans leur gabarit : un composant qui n'en écrit aucun et dont les repères ne correspondent pas n'est pas reconnu. Pour garder la reprise, construisez les deux à partir des mêmes pages, et passez au renderer l'`env` du build du navigateur (le niveau de la console et les outils de débogage en dépendent) :
>
> ```js
> const renderer = await createSSRRenderer({ sourceDir: './app/mjs', env: 'prod' })   // le navigateur : mjs build --prod
> ```
>
> `positional` et `diff` comparent les structures, sans numéros : cet écart ne les concerne pas. Seul `markers` s'appuie sur les repères du serveur.

> ⚙️ **Le moteur d'hydratation n'est embarqué que s'il sert.** Le build lit le bloc `render` (§7) : dès qu'une page y demande `ssr:markers`, `ssr:positional` ou `ssr:diff` — par `render.default` ou par le `mode` d'une route — les trois approches d'adoption partent dans le cœur. `csr`, `prerender` et `ssr`/`ssr:replace` n'adoptent rien : elles n'en ont pas besoin, et le cœur est d'autant plus léger.
>
> Deux cas demandent le module explicitement, par `"runtime": ["hydrate"]` dans `mjs.config.json` (`["hydrate", "i18n"]` pour une application traduite : une liste sans `"i18n"` arrête alors la construction) : un serveur qui rend par l'**API** (`renderToString`/`createSSRRenderer`, avec `ssrMode`) sans bloc `render` dans la configuration ; et une route configurée `ssr`/`ssr:replace` dont les clients demandent une variante d'hydratation par l'en-tête `render.header` (le header peut changer de stratégie à coût égal, le build ne le voit pas).
>
> Si la page demande une hydratation que le cœur n'embarque pas, **rien ne casse** : un avertissement en console (une seule fois), puis la vue est reconstruite façon `replace` — même rendu, sans le gain.

## 7. Piloter le rendu par la config — le bloc `render`

Vous n'avez pas à appeler `renderToString` vous-même : **déclarez quelle URL rend quel composant, dans quel mode**, et MJS s'en charge. Le mode d'une page n'est **ni** un réglage du composant **ni** un drapeau global — c'est **ce que le serveur/build fait de la page**, piloté par `mjs.config.json` :

```json
{
  "sourceDir": "app/mjs",
  "outputDir": "public/mjs",
  "render": {
    "default": "prerender",
    "routes": {
      "/":            { "component": "mjs-landing" },
      "/blog":        { "component": "mjs-blog" },
      "/produit/:id": { "component": "mjs-produit", "mode": "ssr" },
      "/app":         { "component": "mjs-app", "mode": "csr" }
    }
  }
}
```

**Deux niveaux de routage, à ne pas confondre :**

- **Niveau 1 — les pages** (vraies URLs : `/`, `/blog`, `/produit/42`). Ce sont les points d'entrée (liens partagés, robots, premier chargement). C'est ce niveau que `render.routes` déclare, et **le seul** qui a besoin de SSR/prérendu.
- **Niveau 2 — la navigation in-app** (`#/…`). Une fois la page chargée, la navigation interne reste **100 % client** (routeur hash MJS) — le `#` n'est jamais envoyé au serveur, donc rien à rendre côté serveur pour ces routes.

**Les modes :**

| mode | ce qui se passe | serveur au runtime&nbsp;? |
|---|---|---|
| `csr` | le back sert le shell, le navigateur monte `<mjs-x>` | non |
| `prerender` | HTML figé au `mjs build`, servi tel quel | non (build) |
| `ssr` (= `ssr:replace`) | rendu serveur à la requête, client remplace | oui (`mjs serve`) |
| `ssr:markers` / `positional` / `diff` | rendu serveur + hydratation (cf. §6) | oui (`mjs serve`) |

Une route sans `mode` hérite de `render.default` (recommandé&nbsp;: `"prerender"`, pour le SEO + le cache). Une route paramétrée (`:id`) ou catch-all (`*`) ne peut pas être prérendue au build (les valeurs sont inconnues) → passez-la en `ssr`.

Au prérendu, la clé de route devient un chemin de fichier sous `render.outDir` (`/blog` → `blog.html`). Une clé qui en sortirait — un segment `..`, une barre inverse `\`, un chemin absolu (`C:/…`) — est refusée à la lecture de la configuration, par un message qui la nomme. Appelé directement sans cette validation, le prérendu n'écrit rien hors du dossier : la page est signalée en échec.

### Racine en mode léger — `light`

`"light": true` sur une route monte son composant racine **sans Shadow DOM** (`mjs-light`, cf. le piège `mjs-light` plus bas) : le HTML rendu est `<mjs-x mjs-light mjs-ssr>` avec le contenu en **enfants directs**, aucun `<template shadowrootmode>`, et la feuille scopée du composant voyage dans le fragment — `:host` y est réécrit en nom de balise, un léger n'ayant pas d'hôte réel à désigner.

```json
{
  "render": { "routes": { "/": { "component": "mjs-weather-app", "light": true } } }
}
```

À poser quand la page monte déjà sa racine en léger (`<mjs-weather-app mjs-light>` dans la coquille) : le fragment décrit alors **le même arbre** que celui que le client rebâtit, et le remontage se fait sur une racine qui porte déjà l'attribut. Sans la clé, la racine est rendue à Shadow DOM déclaratif, quel que soit le mode que la coquille demande — deux arbres différents pour la même page. La clé vaut pour le prérendu au build comme pour le rendu par requête. Défaut&nbsp;: `false`. Sur une route `csr`, où le serveur ne rend rien, elle n'a rien à décider : la configuration reste valide et la lecture du fichier le signale en une ligne.

Comme pour tout composant léger, `hydrateScript` reste vide (§1)&nbsp;: sans Shadow DOM, aucun mode d'hydratation n'a de nœud à reprendre en main — la racine est reconstruite par le client.

### Prérendu au build — `mjs build`

`mjs build` **prérend automatiquement** toutes les pages `prerender` **concrètes** de `render.routes` : il rend chaque composant en Declarative Shadow DOM et écrit le HTML dans `render.outDir` (défaut&nbsp;: `<outputDir>/../mjs_pages/`), une page par fichier (`/` → `index.html`, `/blog` → `blog.html`). Votre back sert ces fichiers pour les URLs correspondantes&nbsp;; le bundle client hydrate par-dessus (render-then-replace). **Vous n'écrivez aucun code de rendu.** Les routes non prérendables (paramétrées, `ssr`, `csr`) sont listées dans la sortie du build — jamais ignorées en silence.

**Chaque avertissement sort une fois.** Le prérendu recompile le projet pour rendre ses pages : les avertissements de la compilation que le bilan de `mjs build` vient d'écrire ne sont pas répétés sous les pages. Un avertissement de la compilation que le bilan n'a pas écrit (après une recompilation de `mjs dev`, ou par un appel direct de `prerenderPages`) y sort avec sa seule étiquette (`[lint.<type>]`, le type à couper), sans `[lint.prerender]` derrière. Un avertissement que plusieurs pages ou plusieurs langues partagent (ceux de la compilation reviennent dans le rendu de chaque page) tient sur une seule ligne, précédée des pages qui l'ont vu, chacune avec ses langues : `/a, /b [fr, en] : …`, ou `/a [fr], /b [en] : …` quand leurs langues diffèrent ; au-delà de trois pages, leur nombre : `8 pages [fr, en] : …`. Un avertissement propre à une page ne nomme qu'elle (`/blog [fr] : …`). Ces lignes suivent celles des pages écrites.

**Le fragment porte ce que sa page démarre.** En tête de chaque page écrite, sous la ligne de bandeau, `mjs build` pose un `<link rel="modulepreload">` par composant que cette page affiche — plus ceux dont ils dépendent directement, et les modules qu'ils importent. Le navigateur les récupère dès la première vague, sans attendre que le manifeste soit téléchargé puis exécuté pour les découvrir. En construction de production, `render.startup: "bundle"` va plus loin : les composants de la page sont assemblés en un fichier unique par page, et une fiche JSON dit au manifeste d'y pointer. Valeurs, arbitrages et surcharge par route : [32 · CLI & configuration](32-cli-et-configuration.md#renderstartup).

Avec `js: "bundle"` ([32 · CLI & configuration](32-cli-et-configuration.md#js)), il n'y a rien à démarrer page par page : le fichier unique que la coquille charge porte déjà le cœur et tous les composants. Les fragments ne reçoivent alors aucun en-tête de démarrage, et le build le dit en une ligne.

Cet en-tête est délimité par deux lignes de commentaire, `<!-- mjs:demarrage -->` et `<!-- /mjs:demarrage -->` : c'est la zone que le build possède dans le fichier, tout le reste étant le HTML rendu. Un fragment dont le HTML rendu ne change pas n'est **pas réécrit** — ni son corps, ni son en-tête quand il est déjà le bon : deux constructions de suite laissent les fichiers intacts, à la date près, et le watcher de `mjs dev` ne se redéclenche pas sur sa propre écriture.

Le build tient le dossier des pages figées, et n'y touche QUE ce qu'il a écrit : un fragment dont plus aucune route prérendue n'attend le fichier (route retirée, renommée, passée en `csr`/`ssr`, langue retirée de `locales` — jusqu'à la dernière page prérendue du projet) est supprimé à la construction suivante, avec une ligne de journal par fichier — un fragment absent est honnête, un fragment périmé qui pointerait des fichiers disparus ne l'est pas. Un fragment se reconnaît à sa **première ligne**&nbsp;: elle porte la marque `<!-- mjs:prerender` (les fragments des constructions antérieures à cette marque sont reconnus à leur ancien bandeau, `<!-- Page prérendue par MJS …`). Tout autre `.html` est intouchable — la coquille de votre application, une page écrite à la main, la sortie d'un autre outil — et `render.outDir` peut donc être un dossier public partagé, ou la racine du projet. La marque est le seul critère&nbsp;: un fichier étranger dont la première ligne l'imite est traité comme un fragment, et retiré comme tel. Le dossier doit rester **dans** le projet&nbsp;; un `..` ou un chemin absolu ailleurs est refusé à la lecture de la configuration. Le balayage couvre **tout le dossier**, sous-dossiers compris (le fragment d'une route imbriquée `/a/b` vit dans `a/b.html`), et un sous-dossier vidé de ses fragments part avec eux&nbsp;; `node_modules` et les dossiers cachés sont laissés de côté. Une construction dont le prérendu a échoué ne supprime rien.

### Rendu par requête — `mjs serve`

Pour le SSR **dynamique** (contenu qui change à chaque requête, ou routes paramétrées `/produit/:id`), il faut un serveur de rendu Node. MJS le fournit : lancez **`mjs serve`**. Il compile le projet, sert les assets, et pour chaque page applique le mode de `render.routes` — `prerender` (fichier figé), `ssr` (rendu à la volée), `csr` (le client monte). Les params d'URL (`:id`) sont passés au composant en `props` (lus via `&id`) — un joker `*` en fin de route pose de même `rest` (chaîne) et `all` (tableau), lus via `&rest`/`&all`.

**Override par requête (header).** Une requête peut forcer un mode via un en-tête HTTP (nom réglé par `render.header`, ex. `X-MJS-Render`). Pratique pour un appel AJAX qui veut le shell brut&nbsp;: `X-MJS-Render: csr`. La réponse indique le mode réellement appliqué dans `X-MJS-Mode`.

**Dans un back existant (Rails, Express…).** Plutôt que `mjs serve` en frontal, réutilisez le handler en **sidecar / middleware**&nbsp;: `createRenderHandler(config, dir)` retourne `handle(path, headers) → { kind, status, body }`. Votre back délègue le rendu des pages à MJS et garde la main sur le reste (layout, auth…). Un projet 100&nbsp;% prérendu/CSR n'a besoin d'aucun runtime Node.

> 🔎 **SEO — pourquoi prérendre&nbsp;?** Un robot d'indexation (Google…) qui charge une page en **CSR pur** reçoit un shell quasi vide (`<mjs-x></mjs-x>`)&nbsp;: il doit exécuter le JS pour voir le contenu, ce que tous les robots ne font pas correctement. En **prérendu/SSR**, le serveur renvoie le **HTML complet** immédiatement → contenu indexable **et** premier affichage instantané (bon pour le référencement comme pour la vitesse perçue). Corollaire du modèle à 2 niveaux&nbsp;: ce qui vit derrière `#/…` (niveau 2) n'est **pas indexé individuellement**. Mettez donc en **page déclarée** (niveau 1) tout ce qui doit être partagé/référencé (accueil, articles, fiches produit)&nbsp;; gardez en `#/…` le reste (panier, filtres, étapes internes).

### `mjs dev` sert aussi `render.routes`

Pas besoin de basculer sur `mjs serve` pour prévisualiser le rendu en développement : le serveur de `mjs dev` (watch + HMR) applique **aussi** `render.routes` — chaque page déclarée est servie dans son mode réel (`prerender`/`ssr`/`csr`), régénérée à **chaque recompilation** (les pages `prerender` ne restent jamais figées sur une ancienne version pendant que vous développez).

## 8. Le moteur de rendu — `render.engine` et `render.browserPool`

Le rendu HTML tourne sur un **moteur d'exécution**, choisi par `render.engine`, sur **deux axes indépendants** — le prérendu (`mjs build`, et les recompiles `mjs dev`) et le SSR par requête (`mjs serve`) n'ont pas forcément le même besoin de fidélité :

```json
{
  "render": {
    "default": "prerender",
    "engine": { "prerender": "browser", "request": "happy-dom" },
    "browserPool": { "size": 2, "keepAlive": true, "maxAgeMs": 300000 },
    "forwardOrigin": { "trustedHosts": ["exemple.com", "www.exemple.com"] },
    "routes": { "/produit/:id": { "component": "mjs-produit", "mode": "ssr", "settleMs": 2000 } }
  }
}
```

| Valeur | Moteur | Fidélité | Coût |
|---|---|---|---|
| `'happy-dom'` | DOM simulé en pur JS | correcte pour la majorité des composants | léger, aucune dépendance binaire |
| `'browser'` | vrai Chromium headless (Playwright) | maximale (CSS/JS complets, comme un vrai visiteur) | lance/maintient un processus navigateur |

Pendant un rendu `'happy-dom'`, la fenêtre de rendu ne charge **aucune ressource** : ni feuille liée (`<link rel="stylesheet">`), ni script externe (`<script src>`), ni page de cadre (`<iframe src>`) ou de fenêtre ouverte par `window.open`. Aucune requête ne part du serveur ; l'élément reçoit un événement `error`, et le navigateur du visiteur chargera ces ressources au montage.

**Défauts** (non appliqués dans la config, résolus à l'usage) : `request` → toujours `'happy-dom'` (jamais de navigateur implicite par requête, trop coûteux à lancer à la volée sans configuration explicite) ; `prerender` → `'browser'` **si Playwright est installé** (`npm i -D playwright`), sinon repli `'happy-dom'` (message informatif, une fois par process). Priorité de résolution : `route.engine` (par route, cf. table `render.routes` — `engine`/`settleMs` s'y règlent **par page**) > `render.engine.<axe>` (config globale) > défaut.

**Le pool de navigateurs** (`browserPool`, moteur `'browser'` seulement) réutilise des emplacements (contexte + page) entre rendus plutôt que de relancer un processus Chromium à chaque fois (~200-500&nbsp;ms de lancement). Options — défauts résolus à l'usage : `size` (2, nombre d'emplacements maintenus), `keepAlive` (`true`, processus navigateur réutilisé entre rendus), `maxAgeMs` (300000 = 5&nbsp;min, recyclage d'un emplacement trop ancien), `renderTimeoutMs` (15000 = 15&nbsp;s, durée maximale d'un rendu ; le lancement et la fermeture du navigateur sont bornés au double, la fermeture jamais sous 10&nbsp;s — un rendu réglé très bas n'abandonne pas un Chromium en train de se refermer). Chaque rendu ré-navigue sur son emplacement (nouveau Realm JS, `localStorage`/`sessionStorage` vidés) : l'isolation entre deux rendus du même emplacement est garantie sans relancer le processus. Après chaque rendu, l'emplacement est remis à neuf avant de servir un autre visiteur : tout le stockage de l'origine de rendu est effacé (IndexedDB, Cache Storage, service workers, `localStorage`, cookies), et `window.name` revient à vide à chaque nouvelle page. Un emplacement qui ne se laisse pas remettre à neuf est démonté puis remplacé, jamais rendu au réservoir. Des cookies de la requête entrante, la page ne voit que les paires valides — nom fait de caractères ASCII visibles, sans `=`, `;` ni `,`, valeur sans caractère de contrôle — que Chromium accepte sur l'origine de rendu : un nom à préfixe `__Host-`, `__Secure-` ou `__Http-` (réservé à https) et une paire de plus de 4&nbsp;Kio sont écartés, le rendu se fait avec les autres ; le proxy de `forwardOrigin` transmet, lui, l'en-tête `Cookie` entier.

### `render.forwardOrigin` — ⚠️ ne faites **jamais** confiance au `Host` du client

`render.forwardOrigin` transmet l'**origine et les cookies** au moteur de rendu, pour le **SSR par requête uniquement** (`mjs serve` — le prérendu au build n'a par définition aucune requête entrante à transmettre) : sans ça, un `{await fetch('/api/x')}` dans un composant rendu côté serveur partirait vers une origine par défaut qui ne répond jamais, et une page qui dépend de la session de l'utilisateur (cookie d'auth) rendrait un contenu anonyme.

> ⚠️ **Pourquoi ne jamais dériver l'origine du `Host` brut de la requête entrante.** Le `Host` HTTP est une donnée **client**, falsifiable à volonté (`curl -H "Host: 169.254.169.254" …`). Un serveur qui construit son origine de proxy directement à partir de ce `Host` (comportement d'une version antérieure de MJS, **corrigé** — faille SSRF) laisse un attaquant faire exécuter par le moteur de rendu (happy-dom ET moteur navigateur, tous deux de **vrais** clients HTTP) une requête sortante vers **n'importe quelle cible** — réseau interne de l'hébergeur, métadonnées cloud (`169.254.169.254`)… — et **réfléchir la réponse dans le HTML SSR**. `render.forwardOrigin` n'accepte donc **plus jamais** de dériver silencieusement une cible du `Host` client.

**Contrat (3 formes + défaut) :**

| Config | Comportement |
|---|---|
| absente (défaut), ou `true` | **sûr** — aucune dérivation depuis `Host`. Les moteurs retombent sur leur origine locale câblée en dur (`http://localhost/`), jamais influencée par le client. `true` **n'autorise aucun hôte** : ce n'est pas une bascule « faites confiance au Host », juste « activez le mécanisme, avec le défaut sûr ». |
| `false` | Désactivé — jamais de forwarding. |
| chaîne (`"https://back.exemple.com"`) | **Origine fixe** imposée par vous — toujours cette valeur, quel que soit le `Host` envoyé par le client (le `Host` client est totalement ignoré). |
| `{ "trustedHosts": [...] }` | **Allowlist** — seul un `Host` entrant qui figure **exactement** dans la liste autorise le forwarding (vers ce `Host`, avec `x-forwarded-proto`) ; tout `Host` absent de la liste retombe sur le défaut sûr. |

**Le proxy du moteur navigateur ne quitte jamais l'origine retenue.** Un `fetch` relatif de la page dont l'adresse, une fois composée, changerait d'hôte (`/%5Chote/x`, `/%2F%2Fhote/x`, `/api/..//hote/x`) répond `404` sans qu'aucune requête ne parte — le cookie du visiteur n'atteint jamais un autre serveur. Une adresse au pourcentage malformé (`/%zz`) répond `400`. Une ressource que le moteur ne parvient pas à servir (fichier du dossier de sortie illisible, supprimé pendant un build) répond `500` : le rendu continue, le processus aussi. Une redirection de l'origine retenue n'est suivie que sur cette **même** origine (5 au plus) ; une redirection vers ailleurs — serveur interne compris — répond `502` sans qu'aucune requête n'y parte.

**Défense en profondeur, même autorisée explicitement** : une cible qui résout vers une IP privée/loopback/lien-local (`10/8`, `172.16/12`, `192.168/16`, `127/8`, `169.254/16` — dont les métadonnées cloud —, `::1`, `fc00::/7`, `localhost`…) est **toujours refusée**, y compris si elle figure dans `trustedHosts` ou en origine fixe — protège contre une allowlist trop large ou une faute de frappe. Repli, dans tous les cas de refus : origine locale, le `fetch` relatif de l'app échoue proprement côté client (pas de crash serveur, pas de fuite) ; un avertissement est loggé (`warnings` du résultat de rendu).

> 💡 **Changement de défaut assumé (sécurité).** Avant ce correctif, le défaut (`forwardOrigin` absent, ou `true`) dérivait l'origine du `Host` de la requête entrante — pratique, mais c'était exactement le trou SSRF. Le nouveau défaut ne fait plus jamais confiance au `Host` : si votre app SSR a besoin d'atteindre un back réel via un fetch relatif, déclarez-le explicitement en `trustedHosts` (multi-hôtes légitimes, ex. domaines i18n) ou en origine fixe (un seul back connu).

> 💡 **Le moteur navigateur exécute `µmount`/`µawake` pour de vrai.** Contrairement à happy-dom (où `µ._isServer` court-circuite ces hooks), un vrai Chromium charge le bundle comme un visiteur réel : `µmount` s'exécute réellement pendant CE rendu. Corollaire à connaître : un composant dont `µmount` fait un vrai `fetch()` ou ouvre un vrai `WebSocket` le fera aussi **pendant le rendu serveur** (prérendu ou par requête) — comportement attendu d'un « vrai client », pas une fuite à corriger.

## `µserver` — savoir qu'on est côté serveur

La rune publique **`µserver`** (forme courte de `µ.server`) est un booléen : `true` pendant un rendu serveur (SSR/prérendu, **sur les deux moteurs** — happy-dom et navigateur), `false` côté client. Utile pour du code strictement client (accès à `localStorage`, mesure DOM, lib tierce qui suppose un vrai navigateur) qui planterait sinon pendant le rendu serveur :

```html
{if not µserver}
  <canvas @this=!{canvas}></canvas>
{end}
```

> ⚠️ `µserver` n'est **pas réactif** (l'environnement d'exécution ne change jamais en cours de vie d'une instance — un composant ne bascule pas serveur→client à chaud, il est **re-monté** côté client après hydratation) et n'est **pas** l'inverse d'un hook de cycle de vie : `µeffect` continue de **tourner** côté serveur (ce n'est pas court-circuité, contrairement à `µmount`/`µawake` en mode happy-dom) — un `µeffect` qui doit rester client-only doit lui aussi tester `µserver`.

## 9. Clé en main : les chargeurs `serve.server.mjs`

Pour une pile **100&nbsp;% MJS**, `mjs serve` **et `mjs dev`** savent déjà parler le protocole de navigation décrit au chapitre [Navigation (UJS)](21-navigation.md) → *Le protocole serveur* : pas une ligne de code réseau à écrire, juste déclarer les **données** de chaque page. Les deux commandes partagent le même pipeline d'exécution des actions — un `serve.server.mjs` posé une fois marche à l'identique en développement (`mjs dev`) et une fois servi par requête (`mjs serve`).

### Où vit le fichier — `render.entry`

`mjs serve` et `mjs dev` cherchent par défaut **`serve.server.mjs`** à la racine du projet, puis **`server/serve.server.mjs`** ; un autre emplacement se déclare explicitement dans la config :

```json
{ "render": { "entry": "server/serve.server.mjs" } }
```

Le fichier compile dans le **même dialecte** que les `<script>` de composants (`languages.script`, Civet par défaut) et est **rechargé à chaud** dès qu'il change — aucun redémarrage du processus, aucune coupure des requêtes en cours. Aucun fichier trouvé à aucun des emplacements&nbsp;? La navigation-composant fonctionne quand même (`module` continue d'être résolu normalement par `render.routes`) — `props` est simplement vide.

### Le contrat — `props` et `actions`

```civet
// serve.server.mjs — dialecte Civet des composants
export default {
  props: {
    '/products/:id': (params, req) -> { id: params.id, name: 'Chair' }
  }
  actions: {
    '/products/:id': (params, body, req) ->
      if body.name is '' then { errors: { name: 'required' } }
      else { redirect: "/products/#{params.id}" }
  }
}
```

> ⚠️ Les accolades autour de `props` et `actions` ne sont pas décoratives : un hash Civet sans accolades portant deux clés fratries à valeurs multi-lignes compile en `{props: …}({actions: …})` — le premier objet « appelé » comme une fonction. Le chargeur reste alors inactif, sans un mot.

Deux tables, indexées par les mêmes **patterns de route** que `render.routes` et le routeur client (`:param` capturé, `(:opt)` segment facultatif, `*` sous-arbre — cf. [Router](17-router.md)) :

- **`props['<route>']`** — `(params, req) -> objet`, appelé sur un `GET` qui matche la route ; l'objet renvoyé rejoint la réponse de navigation. Un retour non-objet est **ignoré** (objet vide) plutôt que de casser la réponse.
- **`actions['<route>']`** — `(params, body, req) -> { redirect }` ou `{ errors }`, appelé sur un `POST` qui matche la route ; `redirect` produit le **303**, `errors` produit le **422** — fusionné dans les `props` rechargées de la page (cf. [Navigation](21-navigation.md) → *Le protocole serveur*). Une route sans `actions` déclarée répond **405**. Le corps d'un envoi est plafonné à 1 Mo : au-delà, **413**, avant toute action. `render.maxBody` règle ce plafond, en octets, de 1024 (1 Ko) à 104857600 (100 Mo) — `"render": { "maxBody": 8388608 }` pour 8 Mo ; une autre valeur est refusée à la lecture de la configuration.

### `µ.version`

L'identifiant de build renvoyé dans `version`/`X-MJS-Version` est un hash de 8&nbsp;caractères hexadécimaux du contenu du manifest, calculé une fois et exposé sous `µ.version` — un décalage entre deux navigations dit qu'un rebuild a eu lieu pendant que l'onglet restait ouvert.

## 10. Journal d'erreurs — le bloc `journal`

`mjs dev` et `mjs serve` tiennent chacun un **journal d'erreurs** à trois étages, avec exactement les mêmes routes et les mêmes réglages&nbsp;: le serveur consigne ses propres accidents, un navigateur peut lui signaler les siens, et une page dédiée permet de consulter l'ensemble — sans base de données ni service externe, juste deux fichiers NDJSON à côté du projet.

```json
{
  "journal": {
    "server": true,
    "client": false,
    "viewer": true,
    "maxEntries": 200,
    "maxBytes": 1048576,
    "maxDays": 30
  }
}
```

Les valeurs ci-dessus sont **les défauts**&nbsp;: un bloc `journal` absent de `mjs.config.json` produit exactement ce comportement. `server` (booléen, défaut `true`) coupe la capture serveur si passé à `false`&nbsp;; `client` (booléen, défaut `false`) ouvre le point d'entrée qui reçoit les erreurs envoyées par un navigateur&nbsp;; `viewer` (booléen ou chaîne, défaut `true`) contrôle qui peut consulter le journal, cf. l'étage&nbsp;3 ci-dessous&nbsp;; `maxEntries` (200) et `maxBytes` (1&nbsp;Mo) bornent chaque fichier&nbsp;; `maxDays` (30) est la durée de vie d'une entrée&nbsp;: une erreur qui ne s'est pas reproduite depuis ce nombre de jours est oubliée, sur le disque aussi. `trustProxy` (absent par défaut) sert derrière un proxy inverse, cf. l'étage&nbsp;2 ci-dessous. Comme le reste de `mjs.config.json`, ce bloc est validé strictement&nbsp;: une clé qui n'est pas parmi ces sept, ou une valeur du mauvais type, est refusée avec une erreur explicite qui rappelle les clés attendues.

### Étage 1 — la capture serveur

Une erreur imprévue sur une requête, une exception levée par une action `.server.mjs`, un échec de rendu SSR, un échec de chargement du fichier `serve.server.mjs` lui-même, ou un chargeur de props qui casse pendant le rendu HTML d'une page&nbsp;: dans chacun de ces cas, la réponse HTTP habituelle part sans changement (500, page d'erreur…) et, en plus, l'incident s'écrit dans `log/mjs-errors-server.ndjson` à la racine du projet. Le journal observe la requête, il n'y participe jamais.

Un composant qui LÈVE sans qu'aucune frontière `<@failed>` (cf. [Éléments spéciaux](15-elements-speciaux.md)) n'absorbe l'erreur est lui aussi un échec de rendu&nbsp;: en moteur `browser`, une exception non interceptée venant du projet compte pareil qu'un crash rattrapé par le panneau fatal du framework. À la volée (`mjs serve`), la réponse part en 500&nbsp;; au prérendu (`mjs build`), la page part en échec, le fichier HTML périmé est supprimé et la commande sort avec un code de sortie différent de zéro. Poser un `<@failed>` sur un ancêtre du composant qui peut lever est la façon de garder la page servie malgré l'erreur, avec un rendu de repli affiché à la place du panneau fatal.

### Étage 2 — le canal navigateur

Le module optionnel `journal` (inclus par `"runtime": "all"`, par une liste qui le nomme, ou, sans clé `runtime`, quand le projet a des vues serveur ou que son code écrit `µ.config.journal`) pose côté client une veille sur les erreurs JS non interceptées, les promesses rejetées sans `.catch`, et les appels à `µ.error` (qui continue par ailleurs son travail habituel). Cette veille reste inerte, sans le moindre écouteur posé sur la page, tant que l'application ne met pas explicitement `µ.config.journal = true` (le réglage peut changer à tout moment : la veille s'arme à `true`, se retire à `false`) — et même alors, le serveur doit *lui aussi* avoir `journal.client: true`&nbsp;: les deux portes s'ouvrent indépendamment, l'une sans l'autre ne laisse jamais rien fuiter. Une fois les deux ouvertes, chaque erreur détectée (au plus 20 par session de navigation, dédupliquée par signature&nbsp;: la même erreur répétée ne compte qu'une fois) part en un petit paquet plafonné à quelques Ko vers `/__mjs/errors`, via `sendBeacon` (repli automatique en `fetch`). Côté serveur, ce dépôt écrit dans `log/mjs-errors-client.ndjson`&nbsp;: le corps est plafonné, un seau à jetons par adresse limite le débit, et tout ce que le navigateur prétend sur sa provenance est ignoré — la source enregistrée est toujours forcée à `"client"`. Derrière un proxy inverse (nginx), toutes les requêtes arrivent de l'adresse du proxy et tous les visiteurs se partagent ce seau&nbsp;: `journal.trustProxy` prend alors les mêmes valeurs que `trustProxy` de MJS-WS ([23 · MJS-WS §3.5](23-mjs-ws.md#proxy-inverse))&nbsp;: `"loopback"` (le proxy tourne sur la même machine) ou la liste de vos proxies (`["10.0.0.0/8", "192.168.1.5"]`), et l'adresse du visiteur est lue dans `X-Forwarded-For` / `X-Real-IP`. `true`, ou une plage trop large, est refusé. Sans ce réglage, l'adresse de la connexion compte seule&nbsp;: un `X-Forwarded-For` envoyé par le visiteur lui-même n'est jamais cru.

Avant toute écriture, le journal **masque les jetons, les identifiants et les courriels**&nbsp;: la valeur d'un paramètre d'adresse dont le nom désigne un secret (`token`, `access_token`, `api_key`, `password`, `session`, `code`, `state`, `code_verifier`…), la valeur des en-têtes `Cookie`, `Set-Cookie`, `Authorization` et `Proxy-Authorization` (écrits `Cookie: …` ou dans un objet JSON), un jeton `Bearer` ou `Basic`, la valeur d'une paire JSON au nom de secret (`"password": "…"`, `"api_key": …`), un JWT, et dans une adresse chaque segment du chemin qui ne se lit pas comme des mots (un jeton, un UUID&nbsp;: `/reinitialiser/***`&nbsp;; un slug lisible comme `mon-article-2024` reste en clair) deviennent `***`, la partie locale d'un courriel aussi, écrit avec `@` ou `%40` (`***@exemple.fr`, `***%40exemple.fr`). Ni le fichier, ni la signature, ni la visionneuse ne les voient. Le masquage reconnaît des formes, il ne comprend pas le texte&nbsp;: un secret glissé dans une phrase (un mot de passe cité dans un message d'erreur, un en-tête maison comme `X-Api-Key: …`) reste lisible — ne mettez pas de données sensibles dans vos messages d'erreur.

### Étage 3 — la visionneuse

`GET /__mjs/errors` sert une petite page (un composant MJS compilé à la volée, dans la langue des messages du framework, français ou anglais) qui liste les entrées des deux fichiers avec un filtre serveur/client, le détail de la pile par entrée, et des boutons de purge (serveur, client, ou tout). `GET /__mjs/errors.json` renvoie la même liste en JSON brut&nbsp;; `DELETE /__mjs/errors` purge. L'accès à ces trois routes dépend de `journal.viewer`&nbsp;: `true` (le défaut) ne les sert qu'en dehors de la production&nbsp;; une chaîne les transforme en jeton exigé en toute circonstance, développement compris (`?token=<jeton>`, comparé sans fuite de timing)&nbsp;; la page ouverte avec ce jeton le change en cookie de session réservé aux routes `/__mjs/` (HttpOnly, SameSite=Strict, sa valeur dérivée du jeton, jamais le jeton lui-même&nbsp;; `Secure` quand la page arrive en https, directement ou par un proxy de confiance — `journal.trustProxy` — qui l'annonce par `X-Forwarded-Proto: https`), le retire de la barre d'adresse et ne laisse partir aucun Referer&nbsp;; l'historique du navigateur, lui, peut garder l'adresse tapée avec son jeton (ouvrez-la dans une fenêtre de navigation privée pour qu'il n'en reste rien)&nbsp;: la visionneuse et un rechargement de la page passent ensuite par ce cookie (le navigateur doit accepter les cookies)&nbsp;; `false` les ferme complètement. Un accès refusé, quelle qu'en soit la raison, répond toujours par un 404 anodin, jamais par un 403 qui trahirait l'existence de la route.

Chaque entrée regroupe une **signature** d'erreur (même message, même pile, même URL) plutôt qu'une ligne par occurrence&nbsp;: une erreur qui se répète incrémente un compteur et met à jour sa date de dernière occurrence (et la version du build à ce moment-là), au lieu de faire grossir le fichier sans fin. Au-delà de `maxEntries`/`maxBytes`, l'entrée la plus ancienne (par date de dernière occurrence) est purgée pour faire de la place. L'écriture sur disque est atomique (fichier temporaire puis renommage) et regroupée&nbsp;: les écritures rapprochées patientent environ une seconde avant de s'exécuter, pour qu'une rafale d'erreurs ne déclenche pas une rafale d'écritures. Aucune opération du journal — enregistrer, lister, purger — ne peut faire planter le serveur qu'il surveille&nbsp;: une défaillance disque se traduit par un avertissement, jamais par une requête en échec. Le tampon en attente est vidé à la sortie normale du processus et sur un signal `SIGTERM` (l'arrêt d'un service via `systemctl stop`, par exemple)&nbsp;: redémarrer ou redéployer ne perd pas les dernières erreurs consignées.

**La version de build.** Chaque entrée porte l'identifiant du build en vigueur au moment de l'erreur — celui de la ligne `µ.version` du manifeste. Une erreur qu'on n'arrive plus à reproduire se lit donc avec la version qui l'a produite, et on voit tout de suite si elle vient d'un build périmé.

### `mjs dev` contre `mjs serve`

Les quatre routes, les cinq clés de config et les trois étages sont **identiques** dans les deux commandes. Ce qui diffère&nbsp;:

| Ce point | `mjs dev` | `mjs serve` |
|---|---|---|
| Port par défaut (clé `dev.port`) | 3939 | 3000 |
| Démarrage | fonctionne sans bloc `render` | exige un bloc `render`&nbsp;; refuse de démarrer sans lui |
| Journal disponible | seulement si un `mjs.config.json` a été trouvé (sinon aucune des quatre routes n'existe) | toujours |
| Capture serveur | le rendu de page | le rendu de page, **plus** les actions et les props des pages servies (module d'entrée `render.entry`, cf. §9) |

> 🔎 **Voir le journal en un clic.** `http://127.0.0.1:3939/__mjs/errors` en `mjs dev`, `http://127.0.0.1:3000/__mjs/errors` en `mjs serve`.

## Récapitulatif

| Besoin | API / mécanisme |
|---|---|
| Choisir le rendu par URL (sans code) | bloc `render` dans `mjs.config.json` : `default` + `routes[url] = { component, mode }` |
| Rendre un composant en HTML | `renderToString({ sourceDir, tag, … })` |
| Rendre plusieurs fois (1 compilation) | `createSSRRenderer({ sourceDir })` puis `.renderToString(tag, …)` |
| Données locales d'un composant | `props` → attributs (objets en JSON, auto-ré-hydratés ; un nombre garde son type par `mjs-props`) |
| État global partagé | `store` → `sharedScript` à placer une fois, réhydrate `$$` au boot |
| Stratégie de reprise en main | `ssrMode: 'replace'` (défaut) · `'markers'` · `'positional'` · `'diff'` |
| Mode du Shadow DOM | `shadowMode: 'open'` (défaut, requis pour la reprise en main) |
| Racine sans Shadow DOM | `light: true` — option de rendu, ou clé de route `render.routes[url].light` |
| Plafond d'attente du rendu | `settleMs` (défaut 1000 ms ; s'arrête dès que c'est stable) — surchargeable **par route** dans `render.routes` |
| Moteur de rendu | `render.engine.prerender` / `.request` : `'browser'` (Playwright) ou `'happy-dom'` — surchargeable **par route** |
| Pool de navigateurs (moteur `'browser'`) | `render.browserPool` : `size`, `keepAlive`, `maxAgeMs`, `renderTimeoutMs` |
| Origine + cookies transmis au SSR par requête | `render.forwardOrigin` : `false` / origine fixe (chaîne) / `{trustedHosts}` — défaut **sûr** (jamais dérivé du `Host` client) |
| Savoir si on rend côté serveur | `µserver` — vrai sur les deux moteurs, non réactif |

## Pièges

- **`happy-dom` manquant** → `renderToString` lève une erreur explicite. Installez-le (`npm i happy-dom`) ; c'est une dépendance du SSR uniquement (le moteur `'browser'` demande, lui, `npm i -D playwright`).
- **`happy-dom` plus ancien que 20.11.2** → la création du rendu (`createSSRRenderer`, donc aussi `renderToString`, le prérendu et le rendu par requête) lève une erreur qui dit la version trouvée, la version exigée et la commande pour monter : `npm i happy-dom@^20.11.2`. En dessous, happy-dom perd au ramasse-miettes le rappel d'un `MutationObserver` : un composant ne voit plus ses attributs changer, et le rendu varie d'un passage à l'autre, au hasard.
- **`sharedScript` placé après le bundle** → l'état global n'est pas réhydraté à temps. Mettez-le **avant** le `<script>` du bundle.
- **Props ET store partagent la même limite JSON** (fonctions et classes disparaissent silencieusement, `Map`/`Set` deviennent `{}`, `Date` devient une chaîne) → ce qui doit survivre au rendu serveur doit être sérialisable en JSON, sinon ça se recalcule au montage côté client. Changer de portée (`props` → `store`) n'échappe pas à cette limite. Une référence circulaire n'est PAS silencieuse comme les cas ci-dessus : fournie par l'appelant (dans `props` ou dans `store`), elle fait lever `renderToString` ; seule une référence circulaire créée par le composant LUI-MÊME pendant son rendu (ex. une écriture réactive `$$a.self = $$a`) est écartée clé par clé, avec un avertissement dans `warnings` — les autres clés survivent.
- **Composant en `mjs-light`** → pas de Shadow DOM, donc pas de Declarative Shadow DOM : `html` contient le markup en clair (pas de `<template>`). Le SSR fonctionne, mais sans isolation shadow. Ce mode s'active **par instance**, indépendamment du SSR :
  ```html
  <@foo>                <!-- défaut : Shadow DOM -->
  <@foo mjs-light>      <!-- light DOM : rendu à plat, pas de <template shadowrootmode> -->
  ```
  ou, en dur sur la classe (utile quand l'attribut n'est pas lisible avant le constructeur, ex. certains harnais de test) : `static mjsLight = true`. Pour la RACINE d'une page rendue, c'est la clé de route `light` qui le demande (§7) — le mode se décide au constructeur, avant que l'attribut de la balise racine soit lisible. Conséquences : `<slot>` ne fonctionne pas en light DOM (API Shadow-DOM-only), le CSS scopé du composant est injecté une seule fois comme `<style>` dans `document.head` (au lieu d'`adoptedStyleSheets`, qui n'existe pas sur un élément sans shadow). `hydrateScript` (§1) reste également vide pour ce mode, quel que soit `ssrMode` : sans Shadow DOM, aucun mode d'hydratation n'a de nœud à reprendre en main.
- **Route paramétrée (`/produit/:id`) en `prerender`** → impossible au build (les valeurs de `:id` sont inconnues) : `mjs build` la signale et la saute. Passez-la en `mode: "ssr"` (rendu par requête).
- **Modules partagés de même nom** → aucun souci. En SSR, tout est évalué dans un seul contexte, mais chaque fichier (module **et** composant) est isolé dans sa **propre portée** — comme un vrai module ES : ses variables privées **et** ses exports lui restent locaux. Deux modules peuvent déclarer une variable ou exporter un nom identiques sans se télescoper ; chaque importateur reçoit l'export du module qu'il a réellement importé.

---

📚 **Pour aller plus loin** : la portée des données est détaillée dans [Props](04-props.md) (local) et [Stores](14-stores.md) (`$$` global) ; les blocs `{await}` dans [Blocs logiques](05-blocs.md).
