# Passer de la 3.1 à la 4.0

Ce que la 4.0 change pour une application écrite en 3.1, et comment retrouver l'ancien comportement quand il le faut. Le détail de chaque changement est dans le [journal des modifications](CHANGELOG.md).

## Les mots de MJS prennent deux-points

Sur une balise, `@` ne désigne plus qu'un événement, `*` un effet, `:` un mot de MJS. Chaque mot garde sa forme, seul le signe change :

| Avant | Maintenant |
|---|---|
| `@lightDom`, `@noUJS`, `@permanent`, `@childtransition="all"` | `:lightDom`, `:noUJS`, `:permanent`, `:childtransition="all"` |
| `@flip` | `:flip` |
| `@class{$on}="vif"`, `@style.color={$c}` | `:class{$on}="vif"`, `:style.color={$c}` |
| `@in=*fly(up)`, `@transition=*crossfade(key: id)` | `:in=*fly(up)`, `:transition=*crossfade(key: id)` |
| `@this=!{ref}`, `@html=!{…}`, `@group.x=!{…}`, `@attach.once={…}`, `@emit.nom={…}` | même forme, avec `:` |
| `@confirm`, `@method`, `@preload` (sur une balise), `@callback`, `@flash`, `@title`, `@pageTransition`, `@viewTransition.nom` | même forme, avec `:` |
| `@disabled={$x}` et les 25 autres propriétés | `:disabled={$x}` |
| `<style @display="…" @css="…">` | `<style :display="…" :css="…">` |

`:size`, `:wake` et `:offscreen` sont neufs en 4.0 : ils s'écrivent d'emblée avec `:`. Les mots de tête de fichier (`@import`, `@persist`, `@i18n`…) ne changent pas. Une ancienne écriture est refusée à la construction, et le message de chaque refus donne la nouvelle. Un événement à vous qui portait le nom d'un mot (`open`, `title`…) s'écoute dans `µmount`.

## Le champ nombre `<@@number>`

Le champ écrit désormais sa valeur au séparateur de la langue entière de la page, région comprise, avec ou sans `decimals` : 64,3 s'écrit « 64,3 » dans une page en français (sans `decimals`, il s'écrivait « 64.3 »), « 64.3 » dans une page en anglais, et aussi en `de-CH` ou en `es-MX`, où il s'écrivait « 64,3 » avec `decimals`. Les libellés du grand pas le suivent (« Augmenter de 0,5 »). La variable liée, `@change`, `aria-valuenow` et le formulaire reçoivent toujours le nombre, au point. Pour garder le point dans toutes les langues, écrivez `separator="."` :

```html
<@@number value=!{$x} step="0.1" separator="."></@@number>
```

Avec `decimals`, la validité suit désormais l'unité des décimales, et un `step` écrit ne règle plus que les boutons et les flèches : sous `step="1" decimals="2"`, 7,50 est valide, alors qu'il était hors du pas et bloquait l'envoi du formulaire. Si votre formulaire n'acceptait que des multiples du pas, vérifiez-le à l'envoi, ou retirez `decimals` : sans lui, `step` valide comme un champ nombre natif.

Les moitiés s'arrondissent loin de zéro, sur le nombre tel qu'il s'écrit : « 1,005 » donne 1,01 (il donnait 1,00). Aucun réglage ne rend l'ancien arrondi.

Les options nouvelles (`precision`, `zero`, `strict`) ne changent rien tant qu'elles ne sont pas écrites ; elles couvrent ce que les champs nombre écrits à la main faisaient de plus (au plus deux décimales sans zéro final, « 0,00 » dans un champ vidé, la décimale de trop refusée à la frappe) : voir [30 · Modules cœur](docs/30-modules-coeur.md), section `<@@number>`.

## Les listes

Une liste dont vous modifiez un objet hors de MJS (variable ordinaire, objet gardé avant son ajout) ne le remontre plus au prochain ajout, retrait ou échange : écrivez `µrefresh($liste)` juste après. Scène : `tenu = { id: 7, label: 'h' }; $data.push(tenu)`, puis `tenu.label = 'h2'` et un échange : la ligne 7 montre `h` jusqu'à `µrefresh($data)`, et la console de développement le dit.

Une clé de liste garde son type : si vos identifiants arrivent tantôt en nombres, tantôt en textes, donnez-leur un même type (`Number(id)` à la réception), sinon la ligne est refaite au lieu d'être déplacée ; de même `true` et `'true'`, `1n` et `1`. En développement, un avertissement vous le signale.

`:offscreen` est un mot de MJS : une balise qui écoutait un événement nommé `offscreen` par `@offscreen={…}` est refusée à la construction ; posez l'écouteur dans `µmount`, ou renommez l'événement.

Un composant placé dans un `{if}` d'une ligne de `{for}` se réveille désormais avec ses props : un contournement qui retardait dans `µawake` la lecture de ces props devient inutile.

Ce que l'enfant d'une ligne ajoutée ou déplacée écrit à son réveil s'affiche désormais aussitôt dans sa ligne : un test qui attendait l'ancien texte juste après l'ajout ou le déplacement lit la valeur nouvelle. Un enfant qui change à chaque réveil la clé de sa propre ligne est signalé en développement comme une boucle : donnez à la ligne une clé qui ne change pas.

Une ligne de `{for}` n'est plus reprise pour une autre clé : chaque donnée garde ses nœuds. Un code qui comptait sur une ligne reprise (un élément gardé d'une clé à l'autre) doit relire l'élément de la nouvelle ligne.

Nouveau, facultatif : `<@@virtual>` ne dessine que les lignes visibles d'une très longue liste ; vos `{for}` n'ont rien à changer. Pour quelques milliers de lignes que la recherche du navigateur doit trouver, gardez un `{for}` avec `:offscreen`.

Nouveau, facultatif : une grande liste remplacée en bloc se marque en un appel, `µraw(données, true)`, au lieu d'un `µraw` par ligne ; la note ne suit pas une copie (`filter`, `map`, `slice`…) : marquez la copie à son tour.

## Les collections (`Map`, `Set`, `WeakMap`, `WeakSet`)

La clé objet d'une `Map` de l'état sort enveloppée : comparez-la à `$cle`, pas à l'objet brut.

Une `WeakMap` ou un `WeakSet` de l'état a désormais son enveloppe : une bibliothèque qui appelle ses méthodes natives (`WeakMap.prototype.get.call($vus, k)`) lève ; donnez-lui `µraw($vus)`. `µraw($vus)` ne marque plus une collection déjà rangée : `$b = µraw($vus)` et `$vus = µraw($vus)` gardent une enveloppe. Pour une collection brute, écrivez `µraw` à la première affectation (`$vus = µraw(new WeakMap())`).

Une `Map`, un `Set`, une `WeakMap` ou un `WeakSet` que seule une bibliothèque chargée à part fabrique (aucun fichier du projet ne nomme ces collections) : écrivez `"collections": true` dans `mjs.config.json` pour le suivi de leurs clés objets ; il s'ajoute sans toucher au repérage des autres modules. Si vous écrivez déjà une liste `runtime`, vous pouvez aussi y ajouter `"collections"`.

## Les données chargées `µload`

Nouveau : écrivez `$membres = µload('/api/membres')` dans le script, puis lisez `{$membres.data}` dans le gabarit. Un appel écrit dans le gabarit marche, mais le développement vous avertit et conseille de l'écrire dans le script.

## L'attente des données `{await}`

Rien ne change sans option. Pour une recherche à la frappe, écrivez `{await.keep chercher($q, µsignal)}` et passez le signal à `fetch` : la liste reste affichée pendant la relecture et la requête dépassée est annulée. `{await *skeleton}` ou `{await }` sans expression sont désormais refusés : écrivez l'expression devant le squelette, par exemple `{await charger($id) *skeleton}`.

## La liste `<@@select>`

Le panneau est dans la couche du dessus : un style `::part(panel)` qui posait `position`, `top`, `left` ou `z-index` n'a plus d'effet (y compris dans une boîte `position: fixed` ou transformée, où le script le place). La liste, la bulle et le menu des formes ancrés se ferment quand le conteneur qui défile cache leur élément : un test qui fait défiler un conteneur, liste ouverte, la retrouve fermée.

Une `<@@select multiple>` liée à une variable de règle perd au choix suivant une valeur qu'aucune option ne porte, comme la liste native (`[2, 7]` sans option `7` : cocher « 5 » écrit `[2, 5]`) : si votre code y range des valeurs hors des options, donnez-lui `other`, qui les garde comme réponses libres.

## La modale `µ.modal`

Une modale qui s'ouvre ferme les menus de MJS ouverts (liste d'un `<@@select>`, bulle `:title`, menu des formes d'un `<@@chart>`). Rien à changer, sauf si votre code comptait sur un de ces menus resté ouvert pendant la modale. Quand une liste ou un menu est ouvert dans la modale, Échap le ferme d'abord : il faut un second Échap pour fermer la fenêtre.

## Le graphique `<@@chart>`

Le graphique écrit désormais ses nombres et ses dates dans la langue entière de la page : une page en `de-CH` ou en `es-MX` écrit « 72.46 » (elle écrivait « 72,46 »), une page en `en-GB` écrit ses dates dans l'ordre britannique.

Nouveau, facultatif : la variable CSS `--mjs-chart-font` règle la taille de tous ses textes (11 px par défaut) ; posez-la sur la balise ou plus haut, au lieu de retoucher ses textes un par un.

## Les objets reçus par une prop

En développement, la console signale désormais un enfant qui modifie un objet reçu par une prop simple : un objet se modifie là où il est rangé (la variable `$` du composant qui l'a créé, ou le magasin `$$`) ; un enfant le demande par un événement, ou écrit par une prop liée (`!{…}`). Rien ne change en production.

## L'étalement

Une clé `class` étalée sur un composant (`<@carte {...attrs}>`) pose maintenant la classe sur sa balise, comme `class={…}`, à côté des classes que vous y écrivez et des bascules `:class{…}` ; la 3.1.0 ne la donnait qu'en prop. Sur `<@module $comp class="carte" {...attrs}>`, elle était déjà sur la balise mais y remplaçait `carte` : les deux restent maintenant. Si votre style ne s'attendait pas à ces classes, vérifiez le rendu ; un composant qui déclare `$class` n'est pas concerné, il la reçoit en prop comme avant. Une bascule et la donnée étalée qui posent le même jeton n'en ont qu'une part pour les deux : donnez-leur des jetons différents.

Un attribut écrit sur la balise gagne désormais sur la même clé de l'objet étalé, dans les deux ordres d'écriture. Une appli qui comptait sur l'étalement pour remplacer une valeur écrite (`<input value="a" {...$x}>`, `<@carte titre="a" {...$x}>`) doit retirer la valeur écrite (sauf le `value` écrit en dur d'un `<textarea>` ou d'un `<select>`, que le navigateur ne lit pas : l'objet l'emporte toujours, rien à changer) ; la classe étalée s'ajoute à la classe écrite au lieu de la remplacer. Sur un composant, `title`, `id`, `role`, `hidden`, `tabindex`, `lang`, `dir`, `slot`, `data-*` et `aria-*` étalés se posent aussi sur sa balise (une bulle `title` peut apparaître) : retirez la clé de l'objet ; pour `title`, `id`, `role`, `hidden`, `tabindex`, `lang`, `dir` et `slot`, vous pouvez aussi déclarer la prop dans le composant, qui la garde alors pour lui ; `data-*` et `aria-*` vont toujours sur la balise.

## La navigation

Navigateurs : la 4.0 suit les versions récentes de Chrome, Edge, Firefox et Safari ; les navigateurs d'avant 2022 environ (cible `es2022`) ne sont pas suivis — voir le chapitre 32, « Navigateurs suivis ».

Avec l'API Navigation du navigateur (Chrome, Edge, Firefox et Safari récents), un écouteur `navigate` de votre page qui annule le `pushState` d'un lien retient désormais le lien : en 3.1.0, la page demandée arrivait quand même. Sans l'API, ou avec une cale ou un polyfill, rien ne change.

Une page qui hiberne dans un layout ne se réveille plus sous une adresse qui n'est pas la sienne, même quand la garde `µurlChange` du layout renvoie ailleurs : un contournement comme `return unless &id` en tête de `µawake` devient inutile. Vous pouvez le retirer, ou le garder sans risque. Les pages qu'un layout gardait en mémoire reçoivent `µdestroy` quand ce layout est détruit : dès sa sortie de la mémoire du routeur ou, s'il était encore affiché, quand il quitte la page. Un composant retiré avant que son arrivée ne joue (par le `µawake` de son parent, par une garde) ne se réveille plus hors de la page ; resté dehors, il reçoit `µdestroy`, comme en 3.1.0, sauf une page que le routeur garde en mémoire. Un layout retiré de la page à la main puis remis recrée ses pages au lieu de les réveiller.

Une `<@view>` peut vivre sous un `{if}` et porter un contenu (`<@view nom> … </@view>`) : plus besoin de la sortir du bloc ni de la glisser dans un composant de mise en page. Une route dont la vue n'existe nulle part dans l'appli est désormais un refus de construction : écrivez la `<@view>` qui lui manque, ou retirez la route ; une table `@routes` posée sans vue pour remplir `µ.url.params` est refusée de même (donnez-lui une vue, une page vide suffit).

Une appli à routes `#/` qui ne navigue pas vers le serveur ne charge plus `ajax` : un lien vers le serveur que la construction ne voit pas (écrit dans la page hôte, hors de vos composants) part alors par le navigateur, et le développement vous dit une fois quoi ajouter à `"runtime"`. Pour que ces liens passent de nouveau par MJS, ajoutez à `"runtime"` ce que ce message nomme.

Le défaut change : les pages de vos tables de routes sont préchargées au repos, après l'affichage et l'arrivée des données de la page, sans être exécutées, et non plus toutes chargées à l'ouverture. Une page non visitée n'est donc plus définie d'avance : `customElements.get('mjs-<page>')` reste vide jusqu'à sa visite ; un code qui comptait sur sa définition doit attendre `customElements.whenDefined('mjs-<page>')`. Pour retrouver l'ancien comportement, écrivez `"routes": { "preload": "on" }` dans `mjs.config.json`. Une table rangée dans une constante pour éviter le chargement à l'ouverture (`@routes = main: MAIN_ROUTES`) n'est plus utile. Une page visitée avant son tour se charge aussitôt, et l'ancienne page reste à l'écran pendant ce chargement, 1,5 s au plus (au-delà, la vue est vide le temps qu'il finisse) : pendant l'attente, la barre d'adresse montre déjà la nouvelle adresse, alors que `µ.url` garde celle de la page affichée. Une navigation demandée pendant qu'une autre joue ses crochets (renvoi depuis un `µawake`, garde `µurlChange`) vers une page dont le code n'est pas encore arrivé pose cette page aussitôt : ses enfants déjà définis peuvent alors démarrer avant elle (`µawake` puis `µmount`), selon le code qui arrive le premier ; pour l'ordre d'avant, écrivez `"routes": { "preload": "on" }`. Sous `"on"`, les pages partent toutes à l'ouverture, et une page visitée avant l'arrivée de son code est attendue de même : l'ancienne page reste à l'écran. Après une coupure du réseau, une page ratée est redemandée à la visite suivante sous une adresse neuve : la demande `?mjs-retry=<n>` peut apparaître dans les journaux de votre serveur, qui doit servir le fichier sans tenir compte de ce paramètre.

Le défaut change aussi pour les composants cachés : un composant écrit seulement sous un `{if}` (ou un `{else}`) ne part plus au démarrage ; il est téléchargé au repos, après l'affichage, sans être exécuté, et l'ouverture de sa branche ne redemande rien (un composant qui importe un module ou porte un effet part, lui, à l'ouverture). Les composants d'un `{for}` ou d'un `{await}` restent préchargés. Pour ne demander un tel composant qu'à l'ouverture de sa branche, écrivez `"blocks": { "preload": "off" }` (posez alors `:size` sur la balise pour garder sa place) ; pour retrouver l'ancien comportement, `"blocks": { "preload": "on" }`.

## Le réveil paresseux `:wake`

Nouveau, facultatif : sur une page longue rendue par le serveur, `:wake=view` sur la balise d'un composant lointain le laisse en page du serveur jusqu'à ce qu'il paraisse ; sur une page rendue par le serveur (`ssr:markers`, `ssr`, `prerender`), `:wake=interaction` l'y laisse, même à l'écran, jusqu'au premier signe d'intention sur lui (le pointeur qui y entre, un doigt posé, le focus clavier). Sans `:wake`, rien ne change. Quand la vue rebâtit un élément au réveil, vos `@input` et `@change` sont appelés une fois pour ce que le visiteur y avait changé avant : rendez le même contenu côté serveur et côté navigateur. Un `mjs-wake="interaction"` écrit à la main demande `"runtime": ["wake"]`, même si vos gabarits écrivent déjà `:wake=view`. `:wake=idle` est refusé à la construction (écrivez `:wake=view`).

**`ssr:positional` et contenu glissé dans un composant léger** : la vue qui contient un composant léger (`:lightDom` ou `mjs-light`) auquel votre page glisse un contenu est rebâtie par le navigateur. Le contenu glissé reste à l'écran ; ce que le visiteur a tapé dans cette vue, ou le focus qu'il y avait posé, avant le chargement du script est perdu. Un composant léger par sa seule classe (`static mjsLight = true`) dont la classe arrive après la reprise peut perdre son contenu glissé : écrivez-le avec `:lightDom`.

Un composant léger par sa seule classe porte maintenant `mjs-light` dans le HTML du serveur (`markers`, `positional`, `diff`) et, en `markers`, sa page précède le contenu glissé : revoyez un sélecteur ou un test qui lisait l'ancien HTML.

**`ssr:markers` et page sans nœud à reprendre** : une page ou un composant qui n'a aucun nœud à reprendre en main (que des balises de composants, une seule `<slot>`) est repris tel que le serveur l'a écrit, au lieu d'être rebâti : votre visiteur garde le champ où il écrivait, et un serveur construit sur une autre version de cette page laisse la sienne à l'écran.

## La page servie en flux

Nouveau, facultatif : `render.stream` (ou `"stream": true` sur une route de `render.routes`) envoie la coquille de la page dès la requête, avant le chargeur de données. Sans la clé, réponses, octets et en-têtes restent les mêmes.

## La sécurité stricte (Trusted Types)

Si l'en-tête `Content-Security-Policy` de votre page liste ses politiques (`trusted-types …`), ajoutez-y `mjs`, la politique du framework : sans lui, la page se monte tant qu'elle n'exige pas Trusted Types, mais la console vous avertit et le navigateur relève une violation à chaque chargement (Chrome et WebKit envoient un rapport CSP à `report-uri`) ; sous `require-trusted-types-for 'script'`, le HTML du framework passe alors par la politique `default` de votre page si elle existe, qui peut le modifier, et sans elle aucun composant ne se monte. Sous cet en-tête, le HTML que vous écrivez (`{{…}}`, `:html`, `html` de `µ.modal`…) passe lui aussi par la politique `default` : sans elle, `{{…}}` et `:html` restent vides et la console dit quoi faire. Sans liste, rien à faire.

## Les types et `µajax`

Rien à changer : les appels `µajax.get` / `.post` / … gardent leurs rappels et leurs données, `type:` compris quand une liaison de ce nom englobe l'appel ; l'écriture `µ.ajax.error = …` reste permise.

À changer : (1) `µajax` pris comme valeur arrête désormais le build — appelez-le directement. Avant : `localGet = (ajax, round, url, ok, ko) -> ajax.get url, ok, ko` puis `localGet(µ.ajax, round, url, onRead, onFail)` ; après : `localGet = (round, url, ok, ko) -> µajax.get url, ok, ko` puis `localGet(round, url, onRead, onFail)`. (2) Une bibliothèque `.js` qui lit `µ` ou une rune (`µajax`, `µafter`, `µt`…) en nom libre : renommez-la `nom.js.mjs`, ses imports ES vers d'autres fichiers de l'appli en `@import`, et retirez une ligne `#!` en tête. (3) Dans la forme appelable, `onError:` devient `error:` (erreur du serveur) et `onTypeError:` devient `typeError:` (refus de type).

À essayer : `rewards = await µajax '/app/rewards', type: Reward[], typeError: (e) -> []` ; une erreur du serveur passe par `error:` de l'appel, comme pour les verbes, un abandon par `signal:` rend `undefined` ; `"types": "throw"`, `µtypes.onError` et `typesReport` traitent les refus à un seul endroit de l'appli.

Plus d'accolades dans les règles : un objet s'écrit en retrait sous son nom, un champ par ligne, aussi dans `<vars>` ; une liste d'objets, ou un objet qui peut valoir `null`, passe par un type nommé.

Avant :
```
<vars>
  $settings  { volume: int 0..100, bass?: int -10..10 }
  $items     { id: int, title: string }[]
</vars>
```
Après — dans un fichier `*.types.mjs` :
```
<types>
  Item
    id     int
    title  string
</types>
```
et dans le composant :
```
<vars>
  $settings
    volume  int 0..100
    bass?   int -10..10
  $items  Item[]
</vars>
```
Au serveur : `rules({ adr: '{ city: string, zip: int }' })` devient `rules({ adr: 'Adresse' }, { types: { Adresse: 'city  string\nzip  int' } })`. La construction s'arrête sur chaque `{` restant et montre la forme à écrire.

Une ligne de règle ne se poursuit plus sur la suivante : une forme `/…/` qui tenait sur deux lignes, grâce à une accolade restée ouverte, s'écrit sur sa ligne.

L'option vide d'une liste simple (`<option value="">`) liée à une variable dont la règle refuse le texte vide et accepte `null` (`int 1..12 | null`, `string 1..5 | null`) écrit maintenant `null`, « aucun choix », au lieu d'être refusée : revoyez un code qui comptait sur ce refus. Un champ texte vidé sous la même règle reste refusé.

## Les formulaires

Rien à changer. Nouveau, facultatif : `µrules(@)` rend les règles de vos variables en schémas standard, et `modularjs-framework/rules` les contrôle au serveur ; une action `.server.mjs` peut lire le formulaire entier dans `req.form`.

Nouveau, facultatif : `$form = µform(@)` remplace un suivi fait à la main (drapeaux « visité » et « modifié », indicateur d'envoi, lecture de `µres.errors`) ; une application qui ne l'écrit pas ne change pas, et un composant sans objet garde son comportement même dans un parent qui l'écrit. Une application qui écrit `<@@field>` avec une liste `runtime` sans `vault`, ou en cœur choisi seul, emporte désormais `vault` (environ 12 Ko) : son absence faisait planter le champ.

Plusieurs formulaires dans une page : rien à changer pour une page à un formulaire. Si vous donniez des noms distincts aux champs de chaque formulaire pour qu'une erreur ne s'affiche pas chez le voisin, ce n'est plus nécessaire. Un formulaire recréé par un `{if}` qui doit retrouver ses erreurs porte un `id` ; une liste `{for}` de formulaires écrit `id="f{it.id}"`, ou aucun `id` (un `id` répété leur fait partager leurs réponses, et la console le dit en développement). Un champ qui devait afficher la réponse d'un autre formulaire se place hors de tout formulaire (il lit `µres.errors`), ou votre code recopie l'erreur dans `µres.errors`.

Avec `µform`, chaque formulaire garde son propre refus : le refus d'un autre formulaire, du même composant ou d'un autre, ne l'efface plus. `µres.errors` reste le sac commun de la page : une page qui arrive, une réponse sans formulaire et vos écritures dans `µres.errors` valent pour tous les formulaires.

## Les fichiers choisis à l'exécution (`µasset`)

Fichiers choisis à l'exécution (sons, icônes, habillages) : écrivez `µasset "dossier/nom-#{x}.ext"` ou `µasset('dossier/nom-' + x + '.ext')` ; la construction emporte la table des fichiers du motif dans la page qui l'écrit. Une table « nom → adresse » fournie par le serveur, et la fonction maison qui la lit, deviennent inutiles : retirez-les. Un `µasset` que la construction ne sait pas lire (nom passé tel quel, motif sans extension, rune prise comme valeur) l'arrête désormais : écrivez l'appel direct, en motif.

## La construction

Un guillemet jamais refermé dans un attribut, que la 3.1 compilait sans rien dire avec une valeur fausse, arrête la construction : refermez-le à l'endroit cité.

`$$[k]` ne se construit plus : écrivez `$$valeurs[k]`, `µ.store[k]` ou un `µStore` (il levait déjà à l'exécution).

Fichiers serveur : une directive (`@css`, `@lang`…) écrite sous une regex qui porte un guillemet ou un accent grave est refusée à la compilation (elle cassait au chargement du fichier) ; retirez-la.

Dans le fichier d'un magasin, `µ$x = …` et `µ$$x = …` ne se construisent plus : ils remplaçaient l'objet dans ce seul fichier, et les composants gardaient l'ancien. Changez l'objet sur place : `µ$x.cle = valeur`, ou `Object.assign(µ$x, { … })` pour plusieurs clés.

Un gestionnaire dont le corps finit au milieu d'une expression, que le gestionnaire suivant complétait sans erreur avec un code faux, ne se construit plus : complétez l'expression. Une virgule finale compte : `@click={f 1,}` suivi d'un autre gestionnaire, ou `<@window @resize={f 1,} />`, est refusé. De même, un `<script>` qui finit au milieu d'une expression avant `<@failed>`, `<@window>`, `<@document>` ou `<@body>` est refusé : écrivez la fin de l'expression.

Un gestionnaire de plusieurs lignes qui finit par `… unless c` ne met plus que sa dernière instruction sous la condition : pour mettre tout le corps sous la condition, écrivez `unless c` en tête, le corps en retrait.

Un `unless` au bout d'une flèche écrite sur sa ligne (`$x = $l.filter (i) -> i.ok unless $c`) ne prend plus que le corps de la flèche, comme en Civet et en CoffeeScript : pour mettre toute l'instruction sous la condition, mettez la flèche entre parenthèses (`$x = $l.filter((i) -> i.ok) unless $c`).

Le code d'un rappel de transition (`@introend`…) s'écrit comme un gestionnaire, en Civet : un nom qu'il lie sans `$` (`t := …`) lui reste local, et un rappel qui réaffecte la variable d'un `{for}` est refusé.

Les messages citent `fichier.mjs:ligne:colonne` (le fichier tel qu'il est écrit, `accueil.page.mjs`, ou le partiel) au lieu de `nom.script:…` : un outil qui lisait ces positions dans le texte lit désormais le nom du fichier ; `mjs check --json` les donne dans `file`, `line`, `column`.

Avec `"proxy": false`, les formes désormais vues (clé ou indice calculés, `Date`, variable de boucle `{for x in $l}`, paramètre de rappel, `for ($o.k of l)`) redessinent seules : les `µrefresh` posés pour elles peuvent partir ; lisez les avertissements de construction pour les autres.

Un `<@include x>`, une balise du langage (`<@window>`, `<@head>`…) ou un mot de MJS écrits dans une valeur d'attribut, une chaîne d'une expression ou le texte d'un `<textarea>` restent du texte : si vous comptiez sur eux à cet endroit, écrivez la vraie balise dans le gabarit. Les lignes citées par une faute après un `<@include>` de plusieurs lignes deviennent celles de votre fichier, et une faute dans un partiel cite ce partiel ; rien à changer dans votre code.

Une balise du cœur citée seulement dans un commentaire, y compris d'un module `.js` ou `.ts`, n'apporte plus sa partie ni ses morceaux : si un script fabrique la balise, écrivez son nom dans une chaîne (ou une clé d'objet entre guillemets) ; s'il la fabrique par un nom calculé, écrivez la balise et ses attributs dans un gabarit, liés à une variable si un script doit les changer.

Réglage facultatif `"proxy": false` : rien à changer pour garder le comportement de la 3.1. Avec lui, `$o.n++`, `+=` et `||=` redessinent ; après un alias (`t = $o`), un élément rendu par une méthode (`$l.find(f)`), `Object.assign`, une méthode d'une classe à vous ou un changement fait hors de MJS, écrivez `µrefresh($o)`. Si vous posiez `µ._csp = true` à la main, déclarez `"csp": true`.

Trois avertissements neufs peuvent apparaître à la construction (`propUnknown`, `routeUnknown`, `i18nKeyUnknown`), jamais une erreur ; pour en couper un, posez `"lint": { "<type>": false }` dans `mjs.config.json`.

Un composant qui a une valeur dérivée, compilé hors de la construction de l'appli, ne trouve plus `_mjs_setComputed` en production si aucun composant de l'appli n'en a : compilez-le dans la même construction. Hors production (`mjs dev`, `mjs build` et `mjs serve` sans `--prod`), la machinerie reste au cœur, quelle que soit la clé `runtime`.

Un paramètre nommé `readonly`, `loop` ou `undefined` (ou `until`, `unless`, `not`, `is`, `and`, `or` dans une décomposition ou devant un type) arrête maintenant la construction, jusque dans les expressions du gabarit : renommez-le. Il cassait déjà votre code à l'exécution.

Une variable du `<script>` nommée `undefined`, `NaN` ou `Infinity` (`NaN := 1`, `undefined := valeurParDefaut()`, `[a, undefined] = liste`, `catch {NaN}`, `enum NaN`, `@import NaN 'lib/a.civet'`), acceptée jusqu'ici, arrête maintenant la construction, à sa ligne : renommez-la. `eval`, `arguments` et les mots réservés, que l'analyseur refusait déjà sur le JavaScript produit, le sont plus tôt, à la ligne du script. Un champ de classe (`NaN = 1` dans une `class`, quelle que soit la forme de l'en-tête : `class A`, `new class`, `enregistre class`…), une clé, une propriété ou le nom d'origine d'un import par défaut (`default` dans `@import default e 'x.mjs'`) restent acceptés. Une affectation écrite dans une expression (`String(o = 1)`, `if m = re.exec(s)`), qui laissait sa variable sans déclaration (« o is not defined » à l'exécution), la déclare maintenant en tête de la fonction, comme Civet seul avec `autoVar` ; une variable affectée dans un bloc `do` vaut désormais pour toute la fonction. Une déclaration écrite plus haut pour contourner ces erreurs (`o .= undefined`) reste valable. Un champ de classe ne crée plus de variable du même nom dans le script : une valeur globale du même nom (`location`, `NaN`) y garde sa valeur, au lieu de valoir `undefined`.

Une variable affectée dans le corps d'une `function` ou d'une méthode de classe appartient à cette fonction, comme avec `"civet autoVar"`. Un script qui la lisait ailleurs (au premier niveau, ou dans une autre fonction) sans l'y affecter lit désormais la valeur globale du même nom, ou lève « x is not defined » : pour partager la variable, déclarez-la au premier niveau (`x .= undefined`).

Un `<pre>` ou un `<code>` cité dans un commentaire HTML n'ouvre plus de bloc, comme dans le navigateur : une fermante qui le suit hors du commentaire (`<!-- <pre> --></pre><!-- -->`) n'est plus avalée avec lui et se signale (« BALISE FERMANTE ORPHELINE »). À faire : retirer la fermante orpheline, ou sortir l'exemple du commentaire.

Un `<pre>` écrit dans un `<code>` que la lecture prolonge jusqu'à lui (`<code x <pre>p</pre> y>z</code>`, ou un `<code x` sans `>` suivi d'un `<pre>`) : la 3.1.0 compilait ce gabarit avec une sortie fausse (texte du `<pre>` perdu, jeton interne dans le code) ; la 4.0 le refuse avec l'erreur du balisage. À faire : fermer la balise du `<code>` avant le `<pre>`, ou écrire le `<pre>` hors du `<code>`.

Commentaires : ils ne sortent plus dans le code, ni en développement ni en production. Pour garder une mention (licence, avertissement), écrivez-la `//! …` dans le script ou le `<style>`. Un `/*! … */`, un `/*#__PURE__*/` ou un `// @ts-…` écrit dans un composant est retiré comme les autres.

Le manifeste externe (`app/modularjs/manifest.civet`) n'est plus compilé, en plus, comme un module du dossier des sources : un code qui le chargeait comme un module (`@import`, `µimport`) doit passer par un module à part.

Un attribut dont le nom commence par un signe inconnu (`$foo`, `#foo`, `étiquette`…), ou deux attributs séparés par autre chose qu'un espace (`a="1", b="2"`) : la 3.1.0 jetait le signe en silence et l'attribut sortait sous un autre nom. La construction s'arrête maintenant, et le message montre l'attribut fautif : corrigez le nom ou retirez le signe.

Des `<@@img>` et des images d'effets que la 3.1.0 laissait sans préparation (après une section posée derrière un commentaire HTML ou dans un `<textarea>`, ou après un `<!--` cité dans un `<script>` du gabarit) sont maintenant préparées comme les autres. Si leur fichier manque, la construction s'arrête en le nommant. À faire : ajouter le fichier, ou corriger le chemin.

Une `<@@img>` écrite dans un `<@head>` arrête maintenant la construction, ligne citée : l'en-tête du document ne s'affiche jamais. À faire : la déplacer dans le gabarit.

Une balise du langage (`<@slot>`, `<@view>`, `<@head>`…) écrite dans le repli d'un `<@failed>` arrête maintenant la construction, ligne citée : elle s'y affichait en texte. À faire : la déplacer hors du `<@failed>`.

`<@element>`, `<@module>`, un bloc (`{if x}…{end}`, `{for}`…) ou une fermante d'une autre casse que son ouvrante, dans le repli d'un `<@failed>`, arrêtent maintenant la construction, ligne citée. À faire : les balises hors du `<@failed>` ; le bloc dans un composant posé dans le repli, ou une expression ; la fermante à la casse de son ouvrante. Un `{end}` qui nomme une variable du script y est refusé, comme dans le gabarit : écrivez `{ end }`.

Une chaîne écrite sur plusieurs lignes dans un script, qui porte un `#`, donne maintenant un avertissement `[lint.multilineString]` : suivez le message (une chaîne à trois guillemets, des chaînes d'une ligne ajoutées l'une à l'autre, ou `\x23` à la place du `#`), ou coupez-le par `"lint": { "multilineString": false }` dans `mjs.config.json`.

Dans la 4.1.0, cet avertissement est retiré : une chaîne écrite sur plusieurs lignes est lue correctement, son `#` reste du texte ; la clé `"multilineString"` de `"lint"` reste acceptée et ne fait plus rien.

Nouveau, sur demande : `mjs build --cache` ne recompile que les fichiers changés (sortie identique à l'octet, production comprise), et `mjs build --cache=verifier` le vérifie à l'octet ; dans un script de publication, ne publiez que si la commande sort en code 0. Le cache vit dans `node_modules/.cache/mjs/build/` du projet : un `npm ci` le vide, et la construction suivante est complète.

Un dossier de sortie bâti avant la 4.0 peut garder la feuille d'une déclinaison `<style name>` retirée depuis : elle reste prise pour une feuille déposée à la main, et le cœur garde le module des déclinaisons. À faire une fois : videz le dossier de sortie, ou retirez cette feuille.

## La taille du texte s'adapte à l'écran

Au passage, chaque `font-size` écrit en px au-dessus de 20 px devient plus petit sous 1 200 px de large ; au PC, rien ne bouge. Cela vaut pour le `<style>` et le `<theme>` des composants, les feuilles `@css` et `mjs_root`, dès la page rendue par le serveur. Un `41.5px` fait 28,4 px sur un téléphone de 390 px de large et 34,5 px sur 768.

À faire pour chaque appli :

- regardez ses pages sur un téléphone : les grands textes rapetissent, les textes de 20 px ou moins ne bougent pas ;
- une taille qui ne doit jamais bouger s'écrit en `rem` (`2.59375rem` pour `41.5px`) ;
- une appli qui adaptait déjà elle-même ses tailles à l'écran (une fonction SASS, des `@media` sur `font-size`) : retirez ce code, ou coupez celui de MJS par `"responsiveFontSize": false` dans `mjs.config.json` ;
- une appli dont la fonction SASS partait d'un seuil de 14 px : `{ "responsiveFontSize": { "base": 14 } }` garde ce seuil (le texte courant s'adapte aussi).

## Les transitions

`µanim.create` à `tick` : sur une balise qui entre par `:in` ou `:transition`, `tick` reçoit un premier appel, `tick(0)`, dès le départ de l'entrée, avant la première frame. Un `tick` qui compte ses appels en reçoit un de plus à chaque entrée neuve ; une sortie n'en reçoit aucun de plus. Avec `:in=*x :out=*x`, la sortie qui interrompt l'entrée reçoit un appel de `tick` de plus.

Une entrée `.shared` à `delay` reste cachée pendant son retard, comme sans `.shared` : une page qui comptait voir la balise pendant ce temps la voit paraître à la fin du retard.

Un effet de votre fichier d'effets écrit en simples déclarations, sans `@keyframes`, entre désormais en partant de ses déclarations (il allait de l'état normal à elles, puis sautait). Pour retrouver l'ancien trajet, écrivez-le en `@keyframes` avec `to`.

## L'apparition d'un composant

Les transitions d'un composant reprennent dès qu'il paraît. Une animation d'entrée lancée depuis `µmount` dans un `requestAnimationFrame` se joue ; une classe posée directement dans `µmount` est déjà en place à son apparition, sans fondu ; un composant qui attendait (ses textes, sa feuille, un composant qui le contient) paraît dans l'état où l'attente l'a laissé. À revoir : un style ou un test qui comptait sur le fondu d'une classe posée dans `µmount`. Les effets d'entrée (`:in=*…`) ne changent pas.

En fichiers séparés, une page n'attend pas ses composants enfants : chacun paraît à l'arrivée de son fichier. Pour que la page ne saute pas à leur arrivée, donnez leur place à leurs balises avec `:size` (`<@carte :size="320x48">`, ou `:size="x48"` pour la hauteur seule), ou construisez l'appli en un seul fichier (`"js": "bundle"`).

`:size` est un mot de MJS : une balise qui écoutait un événement nommé `size` par `@size={…}` est refusée à la construction ; posez l'écouteur dans `µmount`, ou renommez l'événement.

## Les imports (`@import`)

`<@include nom>` refuse désormais un partiel qui est un lien vers un fichier hors des sources (comme un chemin relatif le refusait déjà) : copiez le fichier dans les sources.

Une directive `@import` écrite sur plusieurs lignes est refusée : réécrivez-la sur une seule ligne (le message donne la ligne à écrire).

Une ligne `@import …` placée dans le texte d'un élément du gabarit s'affiche comme du texte, quelle que soit sa forme ; une directive lisible ainsi placée vous vaut un avertissement à la construction : pour importer, placez-la à la racine du fichier ou dans le `<script>`.

`@import default { a } 'chemin'` et `@import default a b 'chemin'` sont refusés : écrivez `@import default a 'chemin'` (ou `@import { a b } 'chemin'` pour des exports nommés) ; `@import default {} 'chemin'` aussi : écrivez `@import default nom 'chemin'`, ou `@import 'chemin'` ; `@import {} 'chemin'` est refusé : nommez les exports, ou écrivez `@import 'chemin'`.

Une entrée serveur refuse `@import $x 'chemin'`, comme un composant : importez le nom sans `$`. L'avertissement de dépréciation de CoffeeScript a disparu : rien à faire.

Renommez chaque `.civet` / `.coffee` qui se sert de µ, déclare une rune (`µ$$x`…), écrit une directive (`@import`…) ou le dialecte de MJS (commentaire `#` en Civet, `for … in`, affectation sans déclaration en Civet — CoffeeScript déclare lui-même ses variables) en `.civet.mjs` / `.coffee.mjs`, et réécrivez ses imports (`@import x 'outils/a.civet'` → `'outils/a.civet.mjs'`) ; la construction nomme chaque fichier à renommer, même quand un commentaire ou une chaîne y cite µ, et une affectation à un nom jamais déclaré avec ce nom ; un global du navigateur affecté par son nom (`location = …`) fait aussi refuser le fichier, sans que son nom soit cité. Exception : dans un fichier dont le code contient un nom écrit avec µ (`µt := …`, une propriété `µx`), la construction ne voit ni commentaire `#`, ni `for … in`, ni `isnt`, ni interpolation `#{…}` : cherchez-les vous-même dans ces fichiers.

## La grammaire js du gabarit est retirée

Avant : `"languages": { "template": "js" }` dans `mjs.config.json` faisait lire les accolades du gabarit et les gestionnaires (`@click={…}`) par l'ancienne grammaire, et compiler les gestionnaires par CoffeeScript. Après : le gabarit se lit toujours en Civet ; ce réglage arrête la construction, avec un message qui dit quoi faire. Retirez-le (`"template": "civet"`, le défaut, reste accepté). Le JavaScript courant se lit tel quel, sauf : un ternaire collé (`a?b:c`) est refusé, écrivez `a ? b : c` ; une fléchée à paramètre nu (`v => v * 2`) est lue comme un appel de `v`, écrivez `(v) => v * 2` ; `==` et `!=` deviennent `===` et `!==` ; une barre précédée d'une espace et collée à ce qui la suit (`$a /2`) ouvre une expression régulière, écrivez `$a / 2` ; un opérateur précédé d'une espace et collé à ce qui le suit ne se lit pas comme en JavaScript : `$n -1`, `$n +1` et `$l [0]` sont lus comme un appel de `$n` ou de `$l`, `$n *2` et `$a <$b` sont refusés, écrivez `$n - 1`, `$l[0]`, `$n * 2` ; `#{…}` dans une chaîne entre guillemets doubles y est remplacé par sa valeur. Un gestionnaire écrit en CoffeeScript se lit en Civet, qui en lit l'essentiel (`->`, `not`, `unless`, `@x`).

## Les gestionnaires d'événements

Les propriétés internes `_mjs_ids`, `_mjs_eo` et `_mjs_row` des balises n'existent plus : un script qui les lisait ne trouve plus rien.

`@evt=nom`, `@evt={nom}` et `@evt=@nom` (un nom seul, avec ou sans accolades, avec ou sans modificateur, `<@failed>` et balises globales compris) : un nom que rien ne fournit arrête la construction, toutes les fautes du fichier d'un coup. Écrivez `@click=@x` pour une méthode du composant (elle reçoit le composant pour `this`, `<@failed>` compris), ou déclarez `x = -> …` dans le `<script>`. Une fonction du navigateur (`@click=alert`) passe ; sont refusés un objet ou un constructeur du navigateur (`@click=Date`), une propriété que la fenêtre hérite (`@click=toString`, `@click=valueOf`), un mot du langage que rien ne déclare (`@click=if`, `@click=arguments` ; `on`, `yes`… restent appelés quand le `<script>` les déclare), une valeur (`@click=null` : retirez l'attribut) et une fonction du navigateur qui échoue quand elle reçoit l'événement (`@click=requestIdleCallback`, `@click=createImageBitmap` : écrivez `@click={-> requestIdleCallback(…)}`) ; `@click=setTimeout` et `@click=setInterval` tombent sous le refus des minuteries (`µafter`, `µevery`). Dans un `<@failed>`, `@click={reset}` relance maintenant le rendu, et un modificateur (`@click.once=reset`), qui n'y posait aucun écouteur, arrête la construction : écrivez `@click={…}`.

## Les minuteries

`setTimeout` et `setInterval` arrêtent la construction dans un composant (`<script>`, gestionnaires, accolades du gabarit, `:attach`), écrits nus ou lus sur l'objet global (`window.`, `globalThis.`, `self.`, `top.`, `parent.`, `frames.`, `document.defaultView.`, `ownerDocument.defaultView.`, nom assemblé de morceaux fixes comme `document['default' + 'View']['set' + 'Timeout']`, décomposition ; dans `:attach`, le nom écrit en clair seulement) : `setTimeout (-> f()), 500` → `µafter 500, -> f()` ; `t = setTimeout …` puis `clearTimeout t` → `t = µafter …` puis `t()` ; `setInterval (-> f()), 1000` → `µevery 1000, immediate: false, -> f()` ; `await new Promise (r) -> setTimeout r, 300` → `await µafter 300` ; une action qui doit partir même après la disparition du composant → `µafter 2000, always: true, -> …`. Restent libres : `<script module>`, modules, magasins (un délai qui doit courir au rendu serveur s'y pose).

Une poignée gardée pour arrêter une minuterie s'initialise à `null`, pas à `0` : `clearTimeout 0` ne faisait rien, alors qu'en Civet l'arrêt `t?()` d'une main de `µafter` ou de `µevery` devient `t?.()` et lève quand `t` vaut `0` (un nombre ne s'appelle pas). Écrivez `t = null`, puis `t = µafter …` et `t?()`.

Un délai qui n'est pas un nombre supérieur ou égal à 0 (`NaN` d'un `Date.parse` sur une date invalide, `undefined`, une chaîne comme `'300'`) ne pose plus rien, avec un avertissement en développement, là où `setTimeout` partait aussitôt (ou lisait la chaîne comme un nombre) : vérifiez le calcul du délai ; si un tir immédiat vous convient, ramenez-le vous-même à 0.

Un `µeffect` qui posait un `µafter` ou un `µevery` à chaque passage les empilait : le passage suivant arrête désormais ceux du passage d'avant, et l'arrêt du reffet par sa main aussi. Pour garder un tir par passage, posez la minuterie hors du reffet (gestionnaire, méthode appelée par un événement), ou avec `always: true` si le tir doit partir même composant disparu.

Une minuterie posée pendant la partie synchrone d'une attache (`:attach`) s'arrête quand la balise est détachée ; la prochaine attache en pose une neuve. Posée après un `await` de l'attache, elle ne lui appartient plus : posez-la avant l'`await`, ou rangez sa main d'arrêt et appelez-la vous-même (`µdestroy`).

Un `µevery` appelé hors de tout composant actif (module ou magasin appelé depuis un gestionnaire, au chargement du module, après un `await`) ne faisait rien, avec un avertissement : la minuterie part maintenant, au niveau de la page, et tourne tant que la page vit ; arrêtez-la par sa main d'arrêt, `times` ou `while`, ou retirez l'appel si votre code comptait sur ce silence. En production, seul un appel que la construction lit part ainsi ; un appel qu'elle ne voit pas (script de `public/`, script extérieur, accès entièrement calculé comme `window[k]`, code qu'un texte fait exécuter par une voie qu'elle ne lit pas) ne pose toujours rien, averti en développement quand il s'exécute.

Quand un composant quitte la page, ses minuteries suivent trois règles : détruit (bloc fermé, page quittée), plus rien ne part ; mis en hibernation par le cache de pages, elles continuent de tourner, sauf `pause: true` ; retiré par votre script puis remis, une minuterie posée par un passage (`µmount`, `:attach`, `µeffect`) est arrêtée au retrait et reposée par le passage rejoué au retour, une autre est suspendue puis repart (un `µafter` avec son délai complet).

## Les fonctions rangées dans l'état

La 3.1 refusait d'écrire un champ sur une fonction rangée dans l'état (`$format.appels = 0`) ; la 4.0 l'accepte pour vos fonctions, et l'écran suit. Seule une fonction du navigateur (`Object`, `Array`…), qui n'arrive dans l'état que par une clé venue de l'extérieur, reste refusée, avec un avertissement. Par `constructor`, une telle clé peut aussi atteindre une classe de votre appli : vérifiez les clés que vous recevez.

## Les reffets

Dans un composant, un `µeffect` écrit dans un gestionnaire ou une fonction appelée plus tard, refusé à la construction, s'écrit dans un `µeffect.root -> …`, qui rend la fonction qui l'arrête. Dans un gestionnaire du gabarit, écrivez `@click={µeffect.root -> µeffect -> …}` : la racine appartient au composant, ses reffets suivent ses variables et finissent avec lui. Un magasin créé à la volée se jette par `magasin.destroy()`.

Un `µeffect` laissé au premier niveau du fichier d'un magasin ne tournait pas en 3.1 (avertissement « µ.effect doit être appelé à l'initialisation ») : en 4.0 il tourne, à la création du magasin puis à chaque changement, même sans composant à l'écran. Relisez ceux que vous y aviez laissés (sauvegarde, journal, appel au serveur) : ils s'exécutent désormais. Deux reffets de magasins qui s'écrivent l'un l'autre se relancent jusqu'à la garde des 10 000 passages, et le composant qui lit ces magasins atteint aussi la sienne : rangez ce qu'écrit l'un hors de ce que suit l'autre. Nouveau, facultatif : `µeffect.before`, un reffet qui passe juste avant la mise à jour de l'écran.

À l'inverse, dans un module ou le fichier d'un magasin, un `µeffect` sans propriétaire — dans une fonction appelée plus tard, ou dans le corps d'un reffet de magasin — ne tourne plus ; l'avertissement de développement dit où l'écrire : dans le composant, ou au premier niveau du fichier du magasin ou du module. Au premier niveau d'un module `.civet` ou `.coffee`, même sans magasin, il appartient au module et tourne.

Un reffet suit ce qu'il lit vraiment pendant son passage. Avant, `µeffect -> console.log(if $mode then $a else $b)` repartait à chaque écriture de `$b` ; maintenant il ne repart pas tant que `$mode` est vrai : lisez dans le reffet ce qui doit le relancer. À l'inverse, un reffet qui lit `$x` par une fonction (`outils.lire()`) repart désormais quand `$x` change. Une lecture faite après un `await` ou dans un rappel le relance comme avant. De même pour les clés du magasin : `µeffect -> console.log(if $mode then $$a else $$b)` ne repart plus sur `$$b` tant que `$mode` est vrai. Un `µeffect` au premier niveau du `<script module>`, autrefois refusé, passe une fois à l'import du composant, et tourne aussi au rendu serveur.

**Un composant redessiné par `µurl` (ou `µnav`, `µonline`, un `µ$$x`, un `µStore`, un contexte `§§x`) ne fait passer que ses reffets qui ont lu cet état, et ceux pour qui MJS ne peut pas le savoir.** Un reffet qui comptait sur la navigation pour repartir sans lire `µurl` — il lit un titre, une mesure, un élément de la page — doit le lire : ajoutez `µurl.href` dans son corps. Si un reffet cesse de repartir après la montée de version, `"reffets": "all"` dans `mjs.config.json` rend l'ancien comportement (tous les reffets du composant repassent), le temps de lui faire lire l'état ; relancez `mjs dev` après avoir changé la clé ([03 · Réactivité](docs/03-reactivite.md)).

Un reffet qui écrit une variable puis la lit dans le même passage (`µeffect -> $c = 5 ; console.log $c`) passe une fois, là où la 3.1 le faisait passer deux fois : le second passage ne changeait rien. Rien à changer, sauf si votre code compte les passages.

## Les valeurs dérivées

Une valeur précise relue sans que ses sources aient changé rend le même objet : ne comptez pas sur un objet neuf à chaque lecture. Rien d'autre à changer dans votre code.

Avant de passer à la 4.0, `mjs check --derived` liste les valeurs dérivées qui garderont la règle de l'horloge, et pourquoi.

La précision devient le défaut. Pour garder la règle de la 3.1 (toute écriture du composant refait les valeurs dérivées), écrivez `"derived": "clock"` dans `mjs.config.json`, puis relancez `mjs dev`. Dans les deux modes, la règle est la même : un changement fait hors de MJS (bibliothèque, script extérieur, objet gardé dans une variable sans `$`) demande `µrefresh($x)` juste après lui ; en développement, un avertissement vous le rappelle. En production, la précision ne coûte rien à une appli sans valeur dérivée ; une appli qui en a porte sa machinerie (4 134 octets non compressés de plus qu'avec `"clock"` pour une seule valeur dérivée simple).

`$x = $x` et `$$x = $$x`, qui ne redessinaient rien en 3.1, sont refusés à la construction, à leur place : écrivez `µrefresh($x)` ou `µrefresh($$x)`. Une autre écriture du même objet (`$x = o`, `Object.assign($, …)`) ne redessine rien : remplacez-la par `µrefresh($x)`. Pour relancer les reffets, écrivez une nouvelle valeur ; une copie écrite seulement pour forcer le redessin (`$$x = {...$$x}`) peut devenir `µrefresh($$x)` quand aucun reffet ne doit repartir.

`µrefresh($x)` ou `µrefresh(µ$$x)` dans un `<script module>` ou un module importé est refusé à la construction, à sa ligne. Pour un magasin importé, écrivez une nouvelle valeur dans la clé touchée : `µ$$x.lignes = [...µ$$x.lignes]`, ou `µ$x.lignes = [...µ$x.lignes]` dans son fichier.

`$d = $d` sur une valeur dérivée, que la 3.1 construisait, est refusé à la construction : retirez-le ; si un changement fait hors de MJS est en cause, écrivez `µrefresh($x)` sur la variable qu'il a touchée, une de celles que lit `$d`.

`µrefresh($x)` appelé depuis un écouteur que le rendu déclenche : ignoré en 3.1, appliqué juste après le rendu en 4.0 ; un `queueMicrotask` ajouté pour le contourner peut être retiré.

`Object.defineProperty` sur une variable suivie : en 3.1.0, la définition ne comptait pas comme une écriture (l'écran et les valeurs dérivées attendaient la prochaine écriture du composant) ; en 4.0, c'est une écriture, comme `$sel.n = 5` : l'écran suit aussitôt, y compris celui de l'enfant qui reçoit l'objet par une prop (en 3.1.0 : personne ; l'avertissement de développement ne change pas). Seule une définition qui ne change rien ne refait rien, comme l'affectation à valeur égale : la propriété est déjà une donnée propre de l'objet et chaque attribut donné (`value`, `writable`, `enumerable`, `configurable`) y est déjà le même, selon `Object.is` (`NaN` défini sur `NaN` ne change rien, `-0` défini sur `0` change la donnée) ; une clé absente créée à `undefined`, un indice au-delà de la longueur d'une liste, un attribut changé seul ou un accesseur sont des écritures.

Une `µderived` écrite par votre code revient à son calcul dès qu'une dépendance nommée change, au lieu de rester figée. Pour garder une valeur figée, écrivez `$x = expr` sans `µderived`, ou `$x =: expr`.

## La traduction

Sous `@i18n 'section'`, `µt?.('cle')` et ses formes voisines cherchent désormais `section.cle`, comme `µt('cle')` ; pour une clé racine, écrivez `µt?.('/cle')`. Une appli dont le `runtime` omet `'i18n'` et qui appelle `µ?.t(…)` est désormais refusée à la construction (cet appel levait une erreur à l'affichage) : ajoutez `'i18n'`, ou écrivez `µt?.(…)`.

Dans un `<script lang="ts">`, une clé relative reçoit désormais elle aussi le préfixe de la section : si vous aviez écrit la clé entière pour contourner le défaut (`µt('section.cle')` sous `@i18n 'section'`), écrivez `µt('cle')`, ou `µt('/section.cle')`.

Clé absente : la 3.1.0 laissait vide en production un texte que ni la langue de la page ni la langue par défaut ne portaient ; la 4.0 montre `⟦clé⟧` partout, rendu serveur compris. Complétez le dictionnaire de la langue par défaut (`i18nKeyUnknown` nomme le fichier et la clé). Une clé qui manque seulement à la langue affichée prend le texte de la langue par défaut : un module en `wait` ou `*loader` attend ce fragment avant de paraître, au plus 3 secondes (`i18n.timeout`) ; un contournement qui recopiait les clés de la langue par défaut devient inutile.

## Les assistants d'IA

Au premier `mjs dev` ou `mjs check`, votre `AGENTS.md` reçoit en fin de fichier le bloc MJS, entre deux marqueurs ; le reste du fichier ne change pas. Sans `AGENTS.md`, rien n'est créé.
