# 21 · Navigation (µ.ajax & UJS)

> 📚 Pas de chapitre de tuto interactif dédié (mécanisme de navigation **serveur**, hors de l'éditeur live) : cette page se suffit à elle-même. Les encarts 🎓 *Pour débutants* dépliables donnent l'explication pas-à-pas ; le corps de la page reste la référence dense.

Deux couches, complémentaires, pour parler au **serveur** (à ne pas confondre avec le [routeur client](17-router.md), qui échange des sous-vues `#/…` sans jamais toucher le réseau) :

- **`µ.ajax`** — un client de requêtes minimal (fetch enrobé), CSRF automatique.
- **UJS** (*Unobtrusive JavaScript*, façon Rails-UJS/Turbo) — intercepte **liens** et **formulaires** ordinaires pour les transformer en navigation SPA (pushState + swap de contenu, sans rechargement complet), avec cache de pages, annulation des requêtes périmées et accessibilité (focus, `aria-busy`).

## `µ.ajax` — requêtes HTTP

`µ.ajax.get/post/put/patch/delete` enrobent `fetch` avec les conventions du framework : en-tête `Accept` négocié (JSON préféré, HTML accepté — pour supporter aussi bien une API qu'une page complète), `X-Requested-With: XMLHttpRequest` vers l'origine de la page (jamais vers une autre origine : cet en-tête non standard y forcerait une requête préalable `OPTIONS`, que bien des API publiques refusent), et jeton **CSRF** relu et posé automatiquement sur toute méthode mutante.

```js
µ.ajax.get('/api/produits', (json)-> $produits = json)
µ.ajax.post('/api/produits', { nom: 'Stylo' }, (json)-> $produits.push(json))
µ.ajax.delete('/api/produits/42', -> $produits = $produits.filter (p)-> p.id != 42)
```

Signature commune : `(url, [data,] success, error, always, timeout, signal)` — `data` seulement pour `post`/`put`/`patch` (sérialisé en JSON, sauf `FormData`, `URLSearchParams`, un fichier ou des octets — `Blob`, `File`, `ArrayBuffer`, `Uint8Array`… — passés tels quels, sans `Content-Type` JSON). `error(err)` reçoit `{ status, body, url }` sur toute réponse non-2xx, même sans corps (un `head :forbidden` de Rails) ou au corps JSON illisible (`body` porte alors le texte reçu). `timeout` (ms, optionnel) borne la requête ; `signal` (`AbortSignal`, optionnel) permet un abandon piloté par l'appelant — c'est ce que la couche UJS utilise pour tuer une navigation périmée.

**CSRF automatique** : sur toute méthode ≠ `GET`/`HEAD`, le jeton est relu à **chaque requête** depuis `<meta name="csrf-token" content="…">` (convention Rails) et posé en en-tête `X-CSRF-Token` — relecture systématique (pas de mémoïsation) pour rester valide après une rotation de session (login/logout en SPA sans rechargement). Le jeton n'est **jamais** transmis vers une autre origine — un appel `µ.ajax` direct sur un hôte tiers (`µ.ajax.post('https://tiers.example/…')`) ne le reçoit pas, avec un avertissement en console. Le jeton suit la navigation : chaque page HTML reçue (clic, envoi de formulaire, `Précédent` redemandé au serveur) qui porte un `<meta name="csrf-token">` (et `<meta name="csrf-param">`) dans son `<head>` remplace celui de la page — après une connexion ou une déconnexion faite sans rechargement (le serveur fait alors tourner son jeton), `µ.ajax`, les liens `@method` et les formulaires partent avec le nouveau. Une page reçue sans cette balise laisse celle de la page en place.

## Interception des liens et formulaires

Dès que le runtime UJS est chargé (module `ujs`, cf. [aide-mémoire → runtime à la carte](22-aide-memoire.md)), **tout lien** et **tout formulaire** de même origine sont interceptés automatiquement — aucune configuration, c'est le principe *unobtrusive* : le HTML reste du HTML standard, MJS l'améliore silencieusement.

Deux modes de réponse coexistent, et le déclencheur est un simple en-tête de requête. **Sans l'en-tête `X-MJS-Nav`** — le cas que couvre cette section — le serveur répond en HTML et le client remplace le contenu de `<body>` par le fragment reçu (détail juste en dessous). **Avec cet en-tête**, un serveur qui le reconnaît répond en JSON et le client monte le composant désigné dans le contenant que porte la fiche : voir plus bas « Le protocole serveur » pour ce second mode, sa négociation, son contrat de réponse et son volet client.

- **Liens** — un clic sur `<a href="/produits">` (même origine, cible `_self`, pas de `download`, pas `mailto:`/`javascript:`) déclenche un `pushState` **immédiat** puis un `fetch` de la page ; en mode HTML, le contenu de `<body>` est **remplacé** par celui de la réponse. Un lien vers un `#ancre` non-route défile normalement (pas intercepté).
- **Formulaires** — une soumission (`GET`/`POST`/`PUT`/`PATCH`/`DELETE` via un champ caché `_method`) suit le même chemin : requête ajax, puis en mode HTML remplacement du contenu de `<body>` par la réponse. Un `DELETE` venu du champ `_method` garde les autres champs du formulaire dans son corps (paramètres, `authenticity_token`), comme le formulaire natif ; un lien `@method="delete"`, qui n'a que ce verbe, part sans corps. Un formulaire `GET` dont la réponse n'installe rien (`X-MJS-Method: none`, `204`) ou dont la requête échoue (panne réseau, erreur sans page HTML, refus `422` en JSON) laisse l'adresse sur la page affichée. Un bouton soumissionnaire (celui qui a réellement déclenché l'envoi) portant `formaction`/`formtarget`/`formmethod` prend le pas sur les attributs `action`/`target`/`method` du formulaire pour cette soumission précise ; repli sur ceux du formulaire en l'absence de ces attributs sur le bouton, ou pour une soumission par la touche Entrée. `method="dialog"`/`formmethod="dialog"`, elle, n'est **jamais** interceptée : cette méthode HTML n'envoie rien au réseau, elle ferme le `<dialog>` englobant — MJS laisse le navigateur s'en charger nativement (`@confirm` continue de jouer avant, comme pour toute autre soumission). Ce défaut natif ne vaut que pour l'attribut `method`/`formmethod` : un champ caché `_method=dialog`, lui, n'est pas une méthode HTML et est refusé explicitement, jamais traité comme un repli vers la fermeture native.
- **`<form method="delete">`** — le verbe peut aussi venir de l'attribut `method` du formulaire, que le HTML seul ne connaît pas : un `DELETE` ainsi déclaré garde lui aussi les autres champs du formulaire dans son corps, comme avec le champ `_method` ; sans aucun champ, il part sans corps.
- **L'ordre, pour un lien comme pour un formulaire** — la question de `@confirm` d'abord (un refus arrête tout, votre gestionnaire compris), puis votre gestionnaire (`@click`, `@submit`), puis la navigation. Un `.prevent` dans votre gestionnaire (ou `e.preventDefault()`) retient donc le lien ou l'envoi : `<form action="/inscription" method="post" @submit.prevent={verifier()}>` ne part jamais tout seul, c'est `verifier()` qui décide. `.stop` ne coupe pas la navigation.
- **Un écouteur qui coupe la propagation** — un écouteur natif de la page qui coupe la propagation d'un clic sur un lien ou de l'envoi d'un formulaire d'un composant (`stopPropagation()` en remontée ou en capture, `stopImmediatePropagation()`, sur le nœud, un conteneur ou le document) ne rend pas le lien ou le formulaire au navigateur : la navigation de MJS le prend quand même, sauf si un écouteur appelle `preventDefault()`, auquel cas il reste à l'auteur. Quand la coupure est posée sur le document, MJS ne décide qu'après le dernier écouteur de ce nœud. Limites : un envoi lancé par script (`requestSubmit()`, `bouton.click()`) coupé par `stopImmediatePropagation()` ou au niveau du document est envoyé par le navigateur ; sous Firefox, la touche Entrée dans un champ suit la même limite ; une coupure en capture sur `window` passe avant MJS. Le lien ou le formulaire d'une page ordinaire, hors composant, reste au navigateur. Un formulaire de la page glissé dans un composant à ombre est repris comme un formulaire du composant (pas un lien). Un lien d'un composant à ombre fermée dont un écouteur de votre page coupe la propagation en capture sur le document est suivi par le navigateur : MJS ne voit pas ce lien. Coupez en remontée, ou dans le composant.
- **Le contenant** — une navigation remplace le **contenu** d'un contenant, jamais le contenant lui-même par défaut. En mode HTML, ce contenant est `<body>`, sauf si la réponse porte les en-têtes `X-MJS-Target` (sélecteur CSS) et `X-MJS-Method` — appliqués exactement comme les clés `target`/`method` de la fiche JSON, alimentés côté `mjs serve` par les réglages globaux `render.target`/`render.method` : c'est la page qui arrive qui décide de son contenant. Le `<title>` et une partie ciblée du `<head>` suivent, eux, la navigation indépendamment du contenant visé — cf. « Le `<head>` suit la navigation » plus bas. En mode JSON, le contenant se désigne par la clé `target` de la fiche — détail complet, avec `method`, au paragraphe « Le protocole serveur » plus bas.
- **Opt-out** — la directive **`@noUJS`** (directive nue, sans valeur ; attribut compilé `mjs-no-ujs`) sur un `<a>` ou un `<form>` désactive l'interception pour cet élément précis : le navigateur reprend la navigation native (rechargement complet), utile pour un téléchargement, un endpoint qui répond du JSON brut, ou une page dont les scripts doivent réellement s'exécuter. `@confirm` continue de jouer sur un élément qui porte `@noUJS` : la confirmation est demandée, puis la navigation native suit. `@method`, lui, n'a plus de sens sur un élément `@noUJS` (une navigation native ne sait faire qu'un `GET`) : porter les deux fait perdre le verbe, MJS l'avertit en console une fois par élément concerné — sauf `@method="get"`, quelle que soit sa casse : la navigation native fait ce `GET`, rien n'est perdu, aucun avertissement.
- **Lien `@method` suivi par le navigateur** — avec Ctrl, Maj, Alt ou Cmd (nouvel onglet, nouvelle fenêtre, téléchargement), au clic du milieu, sur un lien qui porte `target` (autre que `_self`) ou `download`, ou vers une autre origine, le navigateur suivrait le lien lui-même, en `GET`, sans le verbe de `@method`. MJS retient le geste : rien ne part, ni navigation ni requête, et la console de développement dit pourquoi, une fois par lien. Sur un lien qui porte aussi `@confirm`, le geste est retenu avant la question : elle n'est pas posée. Seul un clic simple envoie la requête, après la question s'il y en a une. Exception : `@method="get"`, quelle que soit sa casse — le verbe même du navigateur, rien n'est perdu : sous ces gestes, le lien se comporte comme un lien ordinaire, le navigateur l'ouvre (onglet, fenêtre, téléchargement, page quittée) sans avertissement, et `@confirm` y pose sa question comme sur un lien ordinaire. Tout autre verbe, même inconnu, reste retenu. Limite : « Ouvrir dans un nouvel onglet », dans le menu contextuel du navigateur, échappe à la page — l'onglet s'ouvre en `GET`. Pour une action, préférez un formulaire.
- **Nouveau build (mode HTML)** — une réponse HTML peut porter l'en-tête `X-MJS-Version` ; une valeur différente de celle du bundle déjà chargé (`µ.version`) déclenche un rechargement complet plutôt qu'un remplacement de contenu — même règle que le champ `version` de la fiche JSON (cf. « Le protocole serveur » plus bas). `mjs serve` pose cet en-tête sur toutes ses réponses HTML.
- **Avertissement `<script>`** — un `<script>` présent dans le contenu échangé n'est jamais ré-exécuté par le navigateur (règle du DOM, pas un choix de MJS) : le client émet un avertissement en console à chaque script distinct détecté dans le contenu qui arrive (une fois par script — les `<script type="application/json">` et assimilés, non exécutables, n'en déclenchent aucun, un script dont le `src` est déjà chargé dans la page non plus). C'est le signal d'un anti-pattern classique en branchant MJS sur un site existant : le remède est de déplacer ce code dans un composant MJS (`µmount`), ou de poser `@noUJS` sur les liens qui mènent à cette page.

Soumettre un `<form>` **désactive automatiquement** ses boutons de soumission (+ pose `aria-busy="true"` sur le formulaire) le temps de la requête — restauré dans tous les cas (succès, erreur, 422). Opt-out : `mjs-no-disable` sur le `<form>`.

Tant que sa requête est en vol, une nouvelle soumission d'un formulaire qui modifie (`POST`, `PUT`, `PATCH`, `DELETE`) est ignorée : la touche Entrée d'un formulaire sans bouton ou un `requestSubmit()` lancé par un script ne la font pas partir une seconde fois au serveur. Un formulaire `GET` (une recherche en direct, soumise par `requestSubmit()` à chaque frappe) n'a pas cette garde : chaque soumission part, abandonne celle encore en vol, et la dernière réponse gagne. `mjs-no-disable` lève aussi la garde : chaque soumission part alors.

```html
<a href="/export.csv" mjs-no-ujs download>Exporter en CSV</a>
```

<details>
<summary>🎓 <b>Pour débutants</b> — pourquoi intercepter des liens/formulaires « normaux »&nbsp;?</summary>

Sans interception, chaque clic sur un lien recharge la page entière : le navigateur retélécharge tout le CSS/JS, réexécute le boot, l'utilisateur voit un flash blanc. En interceptant le clic (`preventDefault` + fetch + remplacement du contenu), MJS obtient le confort d'une SPA (navigation instantanée, pas de flash) **sans** avoir à réécrire chaque lien en `<a @click={...}>` — le HTML généré côté serveur (Rails, tout backend classique) fonctionne tel quel.

</details>

### PRG et réponses 422 (validation)

La convention **Post/Redirect/Get** est suivie : après un `POST`/`PUT`/`PATCH`/`DELETE` qui **redirige**, l'URL affichée devient la **destination finale** (`response.url`, redirection suivie nativement par `fetch`) — un F5 après coup ne resoumet jamais le formulaire. Côté serveur, `mjs serve` répond **toujours `303 See Other`** (la forme stricte du PRG — cf. « Le protocole serveur » plus bas) ; face à un backend tiers qui répondrait `301`/`302`, `fetch` suit tout autant, et le navigateur ré-demande la destination en `GET` dans les trois cas.

En mode HTML, une réponse **422** (validation échouée, convention Rails/Turbo) est traitée comme un **succès de rendu** : le corps HTML reçu (le formulaire re-affiché avec ses erreurs) remplace la zone de montage, sans navigation — l'utilisateur corrige son formulaire sans avoir rien perdu. En mode protocole, la même situation reste un **422** mais le corps est le JSON du protocole, avec les erreurs ajoutées aux `props` de la page : cf. « Le protocole serveur » → *Formulaires*, plus bas, pour le détail exact.

### Un effet à la réussite, ou à l'échec

Un effet réglé `on: success` ou `on: error`, posé sur le formulaire, son bouton ou une balise à l'intérieur, se joue à la réponse du serveur : réponse acceptée (2xx) ou refus (422, page d'erreur), réseau coupé compris. Il part avant l'affichage de la réponse — il sert un formulaire qui reste à l'écran (réponse `method: none`, refus en JSON).

```html
<form action="/inscription" method="post" *shake(on: error)>
  …
  <button *confetti(on: success)>S'inscrire</button>
</form>
```

Détails : [38 · Effets](38-effets.md), « Réussite et échec ».

### Cache de pages — `µ.pageCache`

Les pages déjà visitées sont mises en cache (LRU, 10 entrées) : un retour arrière (`Précédent` du navigateur) ou un re-clic sur un lien déjà visité **restaure instantanément** le DOM caché, sans requête réseau. Le cache est **purgé automatiquement** après toute soumission mutante (`POST`/`PUT`/`PATCH`/`DELETE`) — un contenu obsolète après une suppression/création ne reste jamais affiché. Le cache fonctionne quel que soit le contenant, `<body>` compris : le **contenu** du contenant est mis en hibernation au départ, puis restauré tel quel dans ce même contenant. Une seule exception ne participe pas au cache : une page montée avec `method: "replace"` — son contenant a cédé sa place, il n'y a plus de contenant stable où reposer le contenu quitté ; elle est simplement re-demandée au serveur. Une page montée avec `method: "append"` participe au cache comme les autres, et c'est ce qu'on attend d'elle : ce qui est archivé, c'est l'état **accumulé** du contenant — un fil ou une pagination infinie retrouve au retour arrière tout ce qui avait été chargé. Ce que l'`append` fait en revanche, c'est retirer du cache l'entrée de la page qu'il vient de compléter : son contenu n'a jamais été détaché, il est toujours à l'écran.

La position de **scroll** est sauvegardée par page et restaurée à la reprise (cache-hit ou re-fetch), et dans une même page par route hash : un `Précédent` d'une fiche `#/item` vers la liste `#/list` quittée par un lien ou par `µ.Router.navigate` la retrouve à sa position — dès que la navigation est chargée, le défilement natif du navigateur est coupé pour toute la page ; le **focus** est déplacé après chaque swap vers le nouveau contenu (`[autofocus]` > premier `<h1>` > le conteneur) — accessibilité pour un lecteur d'écran, qui ne suit pas un remplacement de DOM silencieux.

Entre les ancres ordinaires d'une même page (`<a href="#section">`, suivies par le navigateur lui-même), `Précédent` et `Suivant` rendent aussi la position de chaque entrée : celle qu'elle avait quand l'utilisateur l'a quittée par une autre ancre, sinon l'ancre elle-même, comme le navigateur seul.

> ⚠️ **À la déconnexion, appelez `µ.pageCache.clear()`.** Le cache garde l'arbre **vivant** des pages
> visitées : après une déconnexion, un `Précédent` les ressort **sans aucune requête** — nom, adresse,
> montants, fil de messages, tout ce qui était affiché reste lisible, et le serveur n'a jamais
> l'occasion de refuser puisqu'on ne lui demande rien. Les *actions*, elles, sont bien refusées (le
> jeton de session est mort) : le risque n'est pas qu'on fasse quelque chose, c'est qu'on **lise**.
> Sur un poste partagé, la personne suivante n'a qu'à appuyer sur `Précédent`.
>
> ```civet
> seDeconnecter = ->
>   await µ.ajax.post('/logout')
>   µ.pageCache.clear()     # purge complète, démontages compris
>   µRouter.to('/')
> ```
>
> `clear()` purge tout, teardowns compris. Corollaire propre à MJS : les pages en cache gardent leurs
> minuteries et leurs abonnements — sans cette purge, une page privée mise en cache peut continuer à
> interroger le serveur en tâche de fond bien après la déconnexion.

### Politique de cache par page

La page qu'on affiche choisit ce qu'il advient d'elle une fois quittée, parmi trois valeurs :

| Valeur | Comportement |
|---|---|
| `cache-first` *(défaut)* | La page hiberne normalement (cf. ci-dessus) : le retour arrière restitue le DOM archivé, sans requête. |
| `revalidate` | La page hiberne normalement, MAIS le retour arrière affiche le DOM archivé **immédiatement** (même vitesse qu'un `cache-first`) puis lance une vérification en fond, silencieuse (pas de barre de progression, pas de nouvelle entrée d'historique) : si la réponse diffère du contenu affiché, il est remplacé ; sinon rien ne bouge, aucun clignotement. La comparaison reste bon marché — une version de build ou le HTML du contenant, jamais un diff d'arbres DOM. |
| `no-cache` | La page n'est **jamais** archivée : le retour arrière re-demande toujours la page au serveur. La position de **scroll**, elle, reste mémorisée comme pour toute page — seul le DOM n'est pas conservé. |

La vérification `revalidate` compare la page reçue à celle reçue la fois précédente pour la même adresse, jamais au DOM affiché : ce qu'un composant pose sur sa balise (prop reflétée, `theme`, état) ne passe pas pour un changement du serveur, et la page n'est remplacée que si le serveur en envoie vraiment une autre.

Trois canaux annoncent cette politique, avec une précédence fixe :

1. **En-tête `X-MJS-Cache`** (mode HTML) ou clé **`cache`** de la fiche (mode JSON, cf. « Le protocole serveur » plus bas) — la valeur portée par la réponse, prioritaire sur tout le reste.
2. **Balise `<meta name="mjs-cache" content="...">`**, lue dans le document reçu (mode HTML uniquement, quand l'en-tête est absent) — un repli exploitable par une page purement statique, sans logique serveur dédiée.
3. **Défaut de configuration** — la clé `render.cache` de `mjs.config.json` (voir [aide-mémoire](22-aide-memoire.md)) : côté `mjs serve`, cette même valeur alimente l'en-tête et la fiche, il n'y a donc rien de plus à régler pour l'appliquer partout.

Une valeur inconnue retombe sur `cache-first`, avec un avertissement en console (une fois par valeur distincte rencontrée).

```json
{ "render": { "cache": "revalidate" } }
```

```html
<meta name="mjs-cache" content="no-cache">
```

### Événement `mjs:before-cache`

Juste avant d'archiver une page — pour toute politique sauf `no-cache`, qui n'archive rien — MJS émet sur `document` un événement `mjs:before-cache` :

```js
document.addEventListener('mjs:before-cache', (e)-> console.log(e.detail.path, e.detail.zone))
```

`detail.path` (chaîne) est le chemin de la page qui part en cache ; `detail.zone` est le contenant hiberné (l'élément lui-même, encore vivant à cet instant — rien n'a encore été détaché). L'événement informe, il ne s'oppose à rien (`bubbles: true`, `cancelable: false`). `mjs:before-cache` prend place dans la suite complète des événements de cycle de navigation, détaillée juste après cette section : il est émis pour la page qui part, entre `mjs:visit` (qui vient de démarrer la navigation) et `mjs:load` (qui installera la page suivante).

MJS archive un arbre **vivant** : une modale ouverte, un menu déplié, un tiroir sorti ressortent tels quels si l'utilisateur revient sur cette page par un `Précédent`. `before-cache` est le seul moment où l'application peut refermer ce qui doit l'être avant l'archivage :

```js
document.addEventListener('mjs:before-cache', (e)->
  document.querySelector('.modale-filtre')?.close()
)
```

### Événements de cycle de navigation

Une navigation UJS — clic sur un lien, soumission de formulaire, lien `@method`, retour `Précédent`/`Suivant` — traverse trois événements, émis sur `document`, `bubbles: true`, charge utile dans `detail` : même convention que `mjs:before-cache` ci-dessus. Une navigation interne par route hash (`#/x`) n'en émet aucun.

| Événement | Quand | Annulable |
|---|---|---|
| `mjs:before-visit` | avant de quitter la page, avant tout effet de bord | oui — seul de la suite |
| `mjs:visit` | la navigation est engagée | non |
| `mjs:load` | le contenu est en place | non |

**`mjs:before-visit`.** Émis avant de quitter la page, avant tout effet de bord : aucune URL poussée, aucune requête partie, rien n'est encore archivé. `e.preventDefault()` annule la navigation — on reste sur la page, dans l'état exact où on était. C'est le point d'accroche d'un garde-fou « quitter cette page ? » (un formulaire à moitié rempli, un brouillon non sauvé).

`detail` : `path` (chemin visé, pathname+search), `url` (destination complète, hash compris), `via` — `'link'` (clic sur un lien), `'form'` (soumission de formulaire), `'method'` (lien `@method`).

L'exemple qui suit s'appuie sur un store léger `µ$$draft` (cf. [Stores](14-stores.md)), déclaré à part et importé dans le composant :

```civet
export µ$$draft = { dirty: false }
```

```html
<script>
  @import µ$$draft 'draft.module.civet'

  document.addEventListener('mjs:before-visit', (e)->
    if µ$$draft.dirty and not confirm('Quitter sans enregistrer ?')
      e.preventDefault()
  )
</script>
```

Pas émis sur `Précédent`/`Suivant` : le navigateur a déjà changé l'URL quand le code s'exécute, une annulation serait un mensonge (l'URL affichée ne correspondrait plus au contenu) — c'est aussi le choix de Turbo. Un garde-fou qui doit couvrir l'historique passe par `beforeunload` natif.

**`mjs:visit`.** Émis juste après le feu vert, quand la navigation est engagée. Informatif.

`detail` : `path`, `url`, `via` (les trois valeurs ci-dessus + `'popstate'` pour `Précédent`/`Suivant`), et `cached` — booléen : `true` quand la page sera restituée depuis le cache de pages, sans la moindre requête réseau (donc affichage instantané), `false` quand une requête part.

**`mjs:load`.** Émis après l'installation du contenu et la resynchronisation du routeur, une seule fois par navigation réussie, quel que soit le chemin emprunté : contenu servi par le cache, réponse HTML, réponse JSON du protocole, panneau « page introuvable ».

`detail` : `path`, `url`, `via`, `zone` (le contenant qui a effectivement reçu le contenu — en mode `replace`, celui qui a accueilli le module, pas le contenant visé qui lui a cédé sa place), et `initial` — booléen.

`mjs:load` est aussi émis au premier chargement de la page, avec `initial: true` et `via: 'initial'` : un écouteur unique suffit alors à couvrir la première page et toutes les suivantes — c'est ce qui rend une mesure d'audience branchable en trois lignes, sans traiter le premier affichage à part. Pour ne réagir qu'aux navigations, testez `e.detail.initial`.

```js
document.addEventListener('mjs:load', (e)->
  analytics.page(e.detail.path)
)
```

Jamais émis quand rien n'est installé : formulaire refusé en 422 (seules les props changent), réponse `method: 'none'` (les `props` sont tout de même fusionnées dans `µres`, cf. « Les cinq issues d'une réponse » plus bas), réponse `reload` (la page s'en va entièrement), échec réseau, réponse illisible, rafraîchissement de fond de la politique `revalidate` (silencieux par nature), préchargement au survol, et rechargement complet forcé (version du bundle différente, ou composant introuvable après un déploiement, cf. plus haut).

**L'ordre**, pour une navigation qui va au bout : `mjs:before-visit` → `mjs:visit` → `mjs:before-cache` (émis pour la page quittée, qui part au cache) → `mjs:load`.

**Depuis un composant**, ces quatre événements s'écoutent comme n'importe quel événement global, avec `<@document>` — attaché au réveil, détaché au sommeil, sans rien à défaire à la main :

```html
<@document @mjs:load={@page(e)}>
```

Le nom porte un deux-points : le corps `={…}` est donc obligatoire (cf. [Événements](06-evenements.md) → *forme nue*).

### Éléments permanents — `@permanent`

Une navigation remplace le **contenu** du contenant (cf. ci-dessus) : par défaut, chaque nœud de la page quittée est détruit et chaque nœud de la page qui arrive est inséré — même quand un même élément visuel existe des deux côtés (un lecteur audio qui joue, un panneau de chat ouvert, une barre latérale avec son propre défilement). La directive **`@permanent`** (forme nue, sans valeur), combinée à un `id` stable, fait traverser la navigation à un élément précis **sans** qu'il soit recréé : le nœud **vivant** (avec son état DOM, sa réactivité, sa lecture en cours, son défilement) est **transplanté** à la place de son homologue dans la page qui arrive, avant l'échange.

```html
<audio id="radio-player" @permanent src="/radio.mp3" controls></audio>
```

`@permanent` compile vers l'attribut `mjs-permanent`, celui que le runtime lit réellement — l'écrire directement (`mjs-permanent`, sans le `@`) reste une forme valide, utile pour du HTML servi par le back sans passer par un composant MJS. L'appariement se fait **par `id`**, jamais par une valeur portée par la directive : `@permanent="nom"` est refusé au build, avec un message qui renvoie vers `id`.

Le même élément, avec le même `id` et la même directive (ou le même attribut plat), doit exister dans **chaque** page où il doit survivre — c'est l'appariement par `id` qui déclenche le transplant. Une page qui ne le porte pas ne le récupère simplement pas : il part avec le reste du contenu quitté, sans erreur. Un élément `@permanent` sans `id` ne peut être apparié à rien : il est ignoré (jamais transplanté), avec un avertissement en console (une fois par élément). Deux éléments permanents qui partagent le même `id` — ce que le HTML interdit déjà — ne peuvent pas traverser ensemble : le premier passe, les autres partent avec la page quittée, et un avertissement le signale (une fois par `id`). Un élément permanent **imbriqué** dans un autre élément permanent, en revanche, est un cas normal : il traverse avec son ancêtre, sans avertissement.

Le transplant est un déplacement, pas une reconstruction : les hooks de démontage (`µdestroy` en particulier) ne se déclenchent pas pour un élément retenu ainsi — contrairement à un élément qui ne survit pas, détruit normalement comme le reste de la page quittée. Un élément permanent restitué depuis `µ.pageCache` (retour arrière vers une page déjà hibernée) est transplanté de la même façon dans l'arbre archivé qu'on restaure.

### État réactif — `µnav`

`µnav` (forme courte de `µ.nav`) est un objet réactif : `µnav.active` passe à `true` au **début** d'une navigation qui part réellement en requête réseau (pas un cache-hit, instantané par nature), `µnav.href` porte la destination. Utile pour une barre de progression ou un spinner global :

```html
{if µnav.active}
  <div class="barre-progression"></div>
{end}
```

`µnav.active` est la primitive : elle suffit à construire n'importe quelle barre ou spinner à la main. Pour le cas courant, MJS pose **de lui-même** une barre de navigation : un trait de lumière qui court en haut de la page quand une navigation dure plus d'une demi-seconde — un lien, un formulaire, et une page du routeur dont le composant n'est pas encore arrivé (cf. [17 · Router](17-router.md)). Rien à écrire.

- Une navigation plus rapide que le seuil (cache, réseau local) n'affiche **rien** : pas de clignotement.
- La barre part à la fin de la navigation (succès, échec, abandon) ; côté routeur, quand le code des composants de la page est arrivé (ou que le chargement renonce, avec son erreur en console).
- Deux navigations qui s'enchaînent ne créent jamais deux barres.
- « Réduire les animations » (réglage du système) : un trait fixe, qui ne court pas.

Le réglage, dans votre code, avant le montage :

```js
µ.config.navProgress = 700                           // le seuil, en ms (défaut : 500)
µ.config.navProgress = { delay: 300, place: 'bottom' } // le seuil, et la barre en bas de la page
µ.config.navProgress = false                         // pas de barre
```

L'allure se règle en CSS, par ses variables — ou en variables de thème (`$$nav-progress-color`) :

| Variable | Défaut | Ce qu'elle règle |
|---|---|---|
| `--mjs-nav-progress-color` | `#58a6ff` | la couleur du trait et de sa lueur |
| `--mjs-nav-progress-height` | `3px` | l'épaisseur |
| `--mjs-nav-progress-speed` | `1.2s` | le temps d'une course d'un bord à l'autre |
| `--mjs-nav-progress-zindex` | `2147483000` | le plan (au-dessus de tout) |

```css
:root { --mjs-nav-progress-color: #e11d48; --mjs-nav-progress-height: 2px; }
```

La barre est un `<div class="mjs-nav-progress" role="progressbar" aria-hidden="true">` posé dans `<body>` (avec `data-place="bottom"` en bas). Ses règles par défaut n'ont aucun poids (`:where(…)`) : une règle de votre CSS sur `.mjs-nav-progress` l'emporte toujours, pour la dessiner tout autrement.

### Abandon des navigations périmées

Un clic sur un second lien pendant qu'une première navigation est encore en vol **abandonne réellement** le fetch précédent (`AbortController`, pas seulement une réponse ignorée) — la bande passante et le serveur ne sont pas sollicités pour un résultat qui de toute façon ne sera jamais affiché.

## Le `<head>` suit la navigation

Une navigation échange le contenu d'un contenant (cf. ci-dessus) — mais sans rien de plus, le titre de l'onglet et les métadonnées de la page resteraient éternellement ceux de la toute première page chargée. MJS applique donc, depuis la page reçue, un sous-ensemble **piloté** du `<head>` :

- le `<title>` ;
- `<meta name="description">`, `<meta name="keywords">`, `<meta name="robots">`, `<meta name="author">` ;
- tout `<meta name="…">` dont le nom commence par `og:` ou `twitter:` ;
- tout `<meta property="…">` dont la propriété commence par `og:`, `twitter:` ou `article:` ;
- `<link rel="canonical">`.

Cette liste est **fermée**. Tout le reste du `<head>` reste **intouché**, en particulier `<meta charset>`, `<meta name="viewport">`, tout `<meta http-equiv>`, `<meta name="mjs-cache">`, `<style>`, `<script>`, `<link rel="stylesheet">`, `<link rel="icon">`, `<base>`. Le jeton CSRF (`<meta name="csrf-token">`, `<meta name="csrf-param">`) n'est pas dans cette liste : il suit à part la page reçue, même avec `µ.config.navHead = false` — c'est du protocole, cf. « CSRF automatique » plus haut.

### Pourquoi styles et scripts n'en font pas partie

Trois raisons, pas une seule prudence de principe :

1. Un `<link rel="stylesheet">` retiré puis réinséré est **ré-évalué** par le navigateur : la page clignote à chaque navigation. Un `<script>` réinséré **rejoue** son code : écouteurs en double, minuteries doublées. C'est exactement là que les cadriciels qui fusionnent tout le `<head>` ont leurs bogues les plus subtils.
2. Ce n'est de toute façon pas nécessaire en MJS : **le style d'un composant vit avec le composant**. Compilé dans son bloc `<style>`, rendu dans son shadow root, il arrive et repart avec lui — il n'est jamais dans le `<head>`. Ce qui reste dans le `<head>` d'une application MJS, ce sont les feuilles **globales**, identiques sur toutes les pages d'un même build : les retirer puis les remettre reviendrait à payer un clignotement pour reposer exactement les mêmes octets.
3. Un `<style>` injecté par le `<@head>` d'un composant est déjà retiré quand le composant s'endort : rien ne s'accumule de ce côté-là non plus.

### Réconciliation par clé, pas un vidage

Chaque balise pilotée a une clé — le `name`, la `property`, ou `canonical`. Pour chaque clé :

| Situation | Effet |
|---|---|
| présente des deux côtés | le nœud **existant** est conservé, seul son `content` (ou son `href`) est réécrit |
| présente seulement côté page reçue | la balise est **ajoutée** |
| présente seulement côté page affichée | la balise est **retirée** — sinon l'`og:image` d'une fiche produit traînerait sur la page contact |

Une réponse dont le `<head>` est **vide** n'applique rien du tout : un `<head>` vide veut dire « aucune information », pas « effacez tout ». Un `<title>` absent ou vide dans la page reçue laisse le titre affiché **inchangé** — MJS n'efface jamais un titre.

### Retour arrière et rafraîchissement de fond

Le `<head>` est photographié en même temps que la page est archivée dans `µ.pageCache`, et restauré avec elle : un `Précédent` retrouve donc son titre et ses métadonnées, comme il retrouve son DOM. Pour la politique `revalidate` (cf. « Politique de cache par page » plus haut), le `<head>` n'est appliqué que si le contenu a effectivement changé — pas de clignotement pour une vérification silencieuse qui ne change rien.

### Mode JSON — le champ `title` de la fiche

En mode protocole, seul le `title` de la fiche est piloté (les autres métadonnées `<meta>`/`<link>` sont l'affaire du mode HTML — une réponse JSON ne transporte pas de `<head>`) :

- `title` renseigné → il devient le titre de l'onglet ;
- `title` à `null` ou absent → le titre affiché ne change pas ;
- un 404 du protocole (`module: null`) applique lui aussi son `title` s'il en porte un ;
- un 422 (formulaire refusé) n'installe rien et ne touche donc pas au titre ;
- une fiche `method: 'none'` n'installe rien non plus, même raison que le 422 : elle ne change pas de page, donc ne change pas de titre.

### Qui gagne — le composant ou le serveur

Si le composant qui arrive déclare son propre `<@head><title>`, **c'est lui qui a le dernier mot** : le titre venu du serveur n'est qu'un **défaut**, utile aux pages sans composant qui gère lui-même son titre. L'ordre est naturel : le serveur pose le titre au moment de l'échange, le composant écrit le sien juste après, à son premier rendu.

`µ.config.navHead = false` désactive complètement ce mécanisme : plus rien du `<head>` n'est appliqué par une navigation, ni titre ni métadonnées.

## Chargement du cœur et des composants de la page

Le fichier servi en premier (`bundle.js`) ne contient pas le cœur : il commence par poser des
indications de préchargement (`<link rel="modulepreload">`) pour le cœur et pour chaque composant
déjà présent dans la page au moment où ce fichier s'exécute — ainsi que, transitivement, pour tout
ce que ces composants utilisent eux-mêmes (balises écrites dans leur gabarit, modules importés par
`@import`). Le navigateur récupère tout ça en parallèle pendant que le cœur charge, plutôt que de
découvrir chaque composant l'un après l'autre au fil du montage. Une feuille de style partagée, un
fichier d'animations ou un manifeste externe suivent le même chemin quand le projet en a.

Un composant qui n'apparaît dans la page qu'après coup (dans un `{for}`/`{if}`, après une
navigation…) reste découvert normalement par l'autoloader, à la demande — le préchargement ne
concerne que ce qui est déjà visible au tout premier instant.

Ce préchargement-là part quand même **après** `bundle.js` : c'est ce fichier qui, en s'exécutant,
lit la page et pose les liens. Une page **prérendue** (`render.routes`, chapitre
[19 · SSR](19-ssr.md)) n'a pas besoin d'attendre : elle sait dès sa construction ce qu'elle affiche
et porte ses propres liens dans son HTML figé, en tête de fragment — première vague, en parallèle du
manifeste. La clé qui règle cela, jusqu'à l'assemblage des composants d'une page en un seul fichier,
est [`render.startup`](32-cli-et-configuration.md#renderstartup).

## Charger d'avance un composant et sa descendance — `µ.Autoloader.preload`

`µ.Autoloader.load(nom)` charge un composant, et lui seul. `µ.Autoloader.preload(nom)` charge d'avance, **sans rien exécuter** (liens `<link rel="modulepreload">`), le fichier du composant **et** ceux de toute sa descendance : les composants que son gabarit écrit, les modules qu'il importe, ses fichiers d'effets. Un onglet dont les cartes sont des composants se prépare ainsi au survol, et le clic les trouve déjà en cache.

```html
<script>
@chauffer = -> µ.Autoloader.preload('onglet')
</script>

<button @mouseover=@chauffer>Onglet</button>
```

Le nom s'écrit comme pour `load` : avec ou sans le préfixe `mjs-`, casse indifférente. Un fichier déjà demandé — par un appel précédent ou par un lien déjà présent dans la page — n'est pas redemandé, pas plus qu'un composant déjà défini ; un nom inconnu ne fait rien et ne lève aucune erreur. Avec un groupe de fichiers (clé [`bundles`](32-cli-et-configuration.md#bundles)), tous les composants du groupe partagent un même fichier : un seul lien le précharge.

La fonction n'existe que si le build la juge utile, et il la juge utile dès que le code de votre application (composants, modules, fichiers `.civet`) mentionne `Autoloader` **et** le mot `preload`, où que ce soit : un alias (`A = µ.Autoloader` puis `A.preload('onglet')`), une extraction (`{ preload } = µ.Autoloader`), un appel optionnel (`µ.Autoloader.preload?.('onglet')`) ou un appel rangé dans un module sont tous reconnus. La règle est volontairement large : il lui arrive de livrer la fonction à une application qui ne s'en sert pas (un composant qui écrit `Autoloader` d'un côté et `preload` de l'autre, sans rapport), et cela coûte environ 1,2 Ko de texte (350 octets compressés), uniquement dans le manifeste. Une application qui ne mentionne jamais les deux n'en porte aucun octet.

Un appel écrit ailleurs que dans un composant ou un module (le gabarit HTML de votre serveur, un fichier JavaScript servi à part, la console du navigateur) reste invisible au build, et n'a de toute façon pas `µ` sous la main en production : `window.µ` n'est exposé qu'en développement, un script de page ne l'y trouve pas. Si votre application ne contient alors nulle part l'appel, la fonction n'existe pas en production. Pour la garder, écrivez l'appel dans un composant ou un module qui sert de relais (`@chauffer = -> µ.Autoloader.preload(nom)`), puis déclenchez ce composant depuis votre page : le build lit le code compilé, pas les commentaires.

## Composant introuvable après un déploiement — `µ.config.staleReload`

Chaque reconstruction du site change le nom haché des fichiers de composants, et les anciens disparaissent du dossier servi. Un onglet resté ouvert avant la reconstruction — ou un visiteur arrivé pendant un déploiement — garde en mémoire l'ancien manifeste (`µ.paths`). Le prochain composant chargé à la demande par l'autoloader pointe alors un fichier qui n'existe plus : le navigateur refuse d'exécuter la réponse 404 de l'`import()`, le composant n'apparaît jamais, et la zone qui devait l'accueillir reste muette.

Quand un tel import échoue, MJS recharge la page — **une seule fois par version de build**. Un drapeau posé en `sessionStorage` (clé `mjs-stale-reload`, valeur : la version de build courante) borne la boucle : dans un même build, jamais deux rechargements de suite. Une fois la page rechargée, le client sert la nouvelle version ; le drapeau ne correspond plus à cette version, et une péremption future du bundle pourra de nouveau déclencher un rechargement.

Le message d'erreur de l'autoloader part **toujours** en console avant le rechargement : le diagnostic n'est jamais avalé.

Si `sessionStorage` est indisponible (navigation privée stricte, certains contextes embarqués), la garde se désarme d'elle-même : mieux vaut renoncer au rechargement automatique que recharger sans filet anti-boucle.

Ce mécanisme réagit à un **import qui échoue**, quelle que soit la cause du montage du composant — navigation UJS, route interne du routeur, ou simple apparition conditionnelle dans le DOM. Il est distinct du rechargement déclenché par un identifiant de build différent (`X-MJS-Version` en mode HTML, champ `version` en mode JSON, décrits plus bas) : celui-là compare deux identifiants de build **avant** de monter quoi que ce soit, celui-ci réagit **après coup** à un fichier introuvable.

`µ.config.staleReload = false` désactive complètement la garde : l'échec d'import redevient un simple message en console, sans rechargement.

## Préchargement au survol

La navigation UJS partage son moteur avec le préchargement des liens (`@preload`, section dédiée dans [Router (client)](17-router.md)) : un lien préchargé au survol (`hover`, le défaut serveur est `off` — opt-in explicite) a déjà son HTML en cache au moment du clic, rendant la navigation perçue comme instantanée. Le HTML préchargé porte les mêmes en-têtes de navigation qu'un clic normal : la page servie depuis ce cache suit donc les mêmes règles de nouveau build, de contenant, de méthode d'installation et de politique de cache qu'une page qui vient d'être demandée au serveur à l'instant du clic.

Le HTML préchargé n'est resservi qu'une fois, et seulement s'il a été reçu il y a moins de 10 secondes : passé ce délai, la page a pu changer au serveur, et le clic la redemande comme pour un lien jamais survolé ; un nouveau survol la précharge de nouveau.

## Le protocole serveur

Ce qui précède décrit le comportement du **client**. Ce qui suit spécifie le **contrat réseau** en lui-même, indépendamment de tout runtime particulier — n'importe quel back (Rails, PHP, Go…) peut l'implémenter pour devenir nativement compatible avec la navigation UJS.

### Négociation — l'en-tête `X-MJS-Nav`

Une requête de page qui porte l'en-tête **`X-MJS-Nav`** (n'importe quelle valeur non vide) reçoit du **JSON** au lieu du HTML complet — c'est l'en-tête que la couche UJS pose sur chaque navigation interceptée. Sans lui (premier chargement, robot, navigateur sans JS), le back répond en HTML comme d'habitude. La réponse porte **`Vary: X-MJS-Nav`** : une même URL a deux représentations distinctes, et tout cache intermédiaire doit les distinguer.

Le corps JSON :

```json
{
  "module": "mjs-product",
  "props": { "id": "42", "name": "Chair" },
  "url": "/products/42",
  "title": null,
  "version": "a3f9c21e",
  "target": "main",
  "method": "update",
  "cache": "revalidate"
}
```

| Champ | Type | Sens |
|---|---|---|
| `module` | chaîne ou `null` | balise du composant à monter pour cette URL ; `null` si aucune n'y correspond (pile MJS : résolu par `render.routes`) |
| `props` | objet | données à joindre à la page (pile MJS : l'objet renvoyé par le chargeur de la route — vide sans chargeur) |
| `url` | chaîne | URL de la page correspondant à cette réponse |
| `title` | chaîne ou `null` | titre de l'onglet si renseigné — un composant qui déclare son propre `<@head><title>` garde toujours le dernier mot, ce champ n'est qu'un défaut ; `null` ou absent → le titre affiché ne change pas (détail : « Le `<head>` suit la navigation » plus haut) |
| `version` | chaîne | identifiant de build courant (hash de 8&nbsp;caractères hexadécimaux) |
| `target` | chaîne, optionnel | sélecteur CSS du contenant à remplacer ; absent → `<body>` (pile MJS : `render.target`, réglage global, pas de réglage par route) |
| `method` | chaîne, optionnel | `'update'` (défaut, le contenant est vidé puis reçoit le module, le contenant survit), `'replace'` (le module prend la place du contenant, qui disparaît), `'append'` (le module s'ajoute à la suite du contenant, rien n'est retiré) ou `'none'` (rien n'est installé, cf. « Les cinq issues d'une réponse » plus bas) ; sans `target`, `replace` est dégradé en `update` (pile MJS : `render.method`, même portée globale — `'none'` n'est pas une valeur admise pour ce réglage global) |
| `cache` | chaîne, optionnel | politique de cache de la page pour `µ.pageCache` (cf. « Cache de pages » plus haut) : `'cache-first'` (défaut), `'revalidate'` ou `'no-cache'` ; absent → `'cache-first'` (pile MJS : `render.cache`, réglage global) |
| `reload` | booléen ou chaîne, optionnel | rechargement complet de la page plutôt qu'une installation de contenu ; valeurs sans effet : absent, `0`, `false` (cf. « Les cinq issues d'une réponse » plus bas) |

**404.** `module` à `null` signale qu'aucune route ne correspond à l'URL demandée : répondez avec le statut **404** et ce même JSON — le client affiche alors son panneau **Page introuvable** (le même que pour une route interne sans preneur, cf. [Router](17-router.md)).

**Version.** `version` est aussi renvoyé en en-tête **`X-MJS-Version`** : un client qui constate un décalage entre deux navigations sait qu'un nouveau build est disponible.

**Contenant en HTML.** Une réponse HTML (sans JSON) peut elle aussi désigner son contenant : les en-têtes **`X-MJS-Target`** (sélecteur CSS) et **`X-MJS-Method`** (une des valeurs de `method` ci-dessus) sont appliqués par le client exactement comme les clés `target`/`method` de la fiche. Côté `mjs serve`, ce sont les mêmes réglages globaux `render.target`/`render.method` qui les alimentent — c'est la page qui arrive qui décide de son contenant.

**Cache en HTML.** Même principe pour la politique de cache : l'en-tête **`X-MJS-Cache`** porte l'une des trois valeurs ci-dessus, appliquée comme la clé `cache` de la fiche. Sans en-tête, le client se rabat sur une balise `<meta name="mjs-cache" content="...">` lue dans le document reçu (cf. « Politique de cache par page » plus haut) — utile à une page qui ne pose pas cet en-tête elle-même.

Le contenant doit exister des **deux** côtés : la page affichée et la page reçue. S'il manque à la page **reçue** (structure différente : une page de connexion, une page héritée), les deux côtés retombent sur `<body>` — le corps reçu remplace le corps courant, avec son propre habillage, plutôt que d'être imbriqué dans une cible qui ne l'attendait pas — et un avertissement le signale en console, une fois par sélecteur. S'il manque à la page **affichée**, même repli `<body>` et même avertissement.

### Formulaires

Une soumission est un `POST` en **`application/x-www-form-urlencoded`** ou en **`multipart/form-data`**, plafonné à **1&nbsp;Mo**. Le client bascule automatiquement sur `multipart/form-data` dès qu'un champ `<input type="file">` porte un vrai fichier ; côté serveur, les champs texte d'une telle soumission sont transmis normalement, tandis que chaque champ fichier est retiré avant traitement, avec un avertissement en console — l'upload de fichier lui-même reste hors périmètre.

| Cas | Statut | Détail |
|---|---|---|
| Succès | **303** | en-tête `Location` vers la page suivante |
| Échec de validation | **422** | même JSON de protocole ; `errors` ajouté **dans** `props` |
| Aucune action déclarée pour cette route | **405** | — |
| `Content-Type` inattendu | **415** | seuls `application/x-www-form-urlencoded` et `multipart/form-data` sont acceptés |
| Corps trop volumineux | **413** | plafond 1&nbsp;Mo dépassé |
| `Origin` d'un autre hôte | **403** | garde same-origin, POST uniquement — élargissable, cf. juste dessous |

La garde d'origine se règle par `render.allowedOrigins` (dans `mjs.config.json`). Absente, elle est **stricte** : un `Origin` présent doit désigner le même hôte que la requête. Un `Origin` **absent** ne bloque jamais rien — beaucoup de clients légitimes n'en envoient pas sur un `POST` classique.

Sous `mjs dev`, une page locale passe aussi : son origine est `localhost` ou l'un de ses sous-domaines (`app.localhost`), `127.0.0.1` ou `[::1]`, sur n'importe quel port (une autre appli de la machine). Le nom de la machine, `<nom>.local` et les adresses du réseau n'en font pas une page locale : une page servie sous ces noms passe de même origine seulement. Passe aussi la page d'un tunnel qui a réécrit l'en-tête `Host` en `localhost`, quand son nom **exact** est déclaré dans `dev.allowedHosts` ; ni une entrée `.domaine` (sur un domaine partagé, elle admettrait aussi les pages de ses autres utilisateurs) ni `true` (qui admettrait toutes les pages) n'ouvrent une origine autre que `Host`, et le 403 dit le nom à écrire quand une entrée `.domaine` le couvre (cf. [32 · CLI & configuration](32-cli-et-configuration.md)). `mjs serve` n'applique aucune de ces deux ouvertures.

| `render.allowedOrigins` | Effet |
|---|---|
| absent | same-origin strict (défaut) |
| `["https://admin.exemple.fr"]` | ces origines **en plus** du same-origin ; comparaison sur l'origine normalisée `protocole://hôte:port`, jamais une sous-chaîne |
| `["*"]` | **toutes** les origines. Forme explicite du « j'accepte tout » : à n'écrire que sur un service qui n'a rien à protéger d'une soumission tierce |
| `false` | contrôle coupé en entier — même effet que `["*"]`, dit autrement |

Une étoile **collée** à autre chose (`"*.exemple.fr"`) n'est pas un motif : ce n'est pas une origine valide, elle ne correspondra jamais à rien. Une valeur qui n'est ni un tableau ni `false` retombe silencieusement sur le same-origin strict.

Le **422** réutilise exactement la forme ci-dessus, avec une clé `errors` dans `props` — le composant se ré-affiche donc avec ses erreurs, sans navigation supplémentaire. Les `props` d'un 422 sont **fusionnées** dans `µres` (cf. « `µres` — le sac de props serveur » plus haut) : renvoyer les seules erreurs suffit, le reste de l'état de la page n'a pas à être réémis. Un `POST` accepté redirige au sens strict (**303** + `Location`) : convention Post/Redirect/Get, un F5 sur la page d'arrivée ne resoumet jamais le formulaire.

### Le socle client

Cette réponse ne contient aucun HTML à interpréter : le client crée l'élément désigné par `module` et le monte dans le **contenant**. Le contenant est l'élément que désigne la clé `target` (sélecteur CSS) ; sans `target`, c'est `<body>`. Si le sélecteur ne trouve rien dans la page, ou n'est pas un sélecteur CSS valide, repli sur `<body>` et avertissement dans la console.

La clé `method` choisit le sort du contenant lui-même : `'update'` (défaut) le vide puis y insère le module comme contenu — le contenant **survit**, ce qui permet de viser `<main>` en gardant l'en-tête et la navigation autour ; `'replace'` fait prendre au module la **place** du contenant, qui disparaît — les navigations suivantes remplacent alors le module lui-même ; `'append'` ajoute le module à la **suite** de ce qui est déjà là, sans rien retirer — fil qui s'allonge, pagination infinie ; `'none'` n'installe **rien du tout** — ni contenant touché, ni `pushState`, ni changement d'adresse (cf. « Les cinq issues d'une réponse » plus bas). Sans `target`, `replace` est dégradé en `update` : `<body>` n'est jamais remplacé.

`props` remplit la rune réactive `µres` (détail juste plus bas). Le champ `title`, lui, est appliqué **avant** le montage du composant : renseigné, il devient le titre de l'onglet — un défaut, utile aux pages sans composant qui gère lui-même son titre. Un composant qui déclare son propre `<@head><title>` garde toujours le **dernier mot** : son titre s'écrit juste après le sien, à son premier rendu, et l'écrase. `title` à `null` ou absent laisse le titre affiché inchangé. Détail complet du `<head>` : « Le `<head>` suit la navigation » plus haut.

Un `version` différent de celui déjà chargé par la page (`µ.version`) déclenche un rechargement complet plutôt qu'un montage : un nouveau build a pu changer la forme compilée d'un composant, mélanger l'ancien JavaScript avec de nouvelles props est un terrain à risque. Même repli si `module` désigne une balise que le bundle courant ne connaît pas.

`module` à `null` affiche le panneau **Page introuvable** dans le contenant plutôt qu'un montage, en respectant `µ.config.routeNotFound` (`'error'` par défaut, `'warn'`, `'silent'` — les mêmes réglages que pour le routeur `#/…`).

Un **422** ne provoque ni remontage ni changement d'historique : seule `µres` est mise à jour (`props`, `errors` compris), en **fusion** — le composant déjà en place se ré-affiche par réactivité, comme pour n'importe quelle autre mutation de `µres`. Le back n'a donc à renvoyer que ce qui change (les erreurs, le plus souvent) : le reste du sac — panier, compteurs, pagination — traverse la validation sans bouger.

### `µres` — le sac de props serveur

`µres` (forme courte de `µ.res`) est un objet réactif, de la même famille que [`µurl`](17-router.md) : lisible partout, sans import, tout composant qui lit un de ses champs au rendu se re-rend quand il change. Il décrit les `props` de la page **affichée**.

La règle tient en une question : **une nouvelle page arrive-t-elle ?** Oui — chargement HTML, navigation JSON avec un `module` — le sac est **remplacé entièrement**, clé par clé : une clé du sac précédent absente du nouveau sac est supprimée, elle ne traîne jamais sur la page suivante. Non — une réponse `method: 'none'` ou un **422** qui refuse un formulaire (cf. « Les cinq issues d'une réponse » plus bas) — la page affichée reste montée, ses props doivent donc survivre : les `props` reçues sont **fusionnées** dans `µres`, clé par clé, et les clés non envoyées gardent leur valeur. C'est ce qui rend un vote ou un favori écrivable en une ligne côté back : `props: { favoris_total: 12 }` suffit, le reste du sac reste intact — sans cette règle, il faudrait renvoyer l'état complet de la page à chaque clic sur un cœur, et la moindre faute de saisie dans un formulaire viderait le panier affiché à côté. Conséquence à connaître : sur ces deux chemins, **effacer** une valeur demande un geste explicite, la clé envoyée à `null` — l'omettre ne l'efface pas. Un formulaire enfin accepté qui veut faire disparaître les erreurs affichées répond donc `errors: null`.

```html
<h1>{µres.name}</h1>   <!-- "Chair", pour l'exemple du JSON plus haut -->
```

Au premier chargement HTML d'une page, `µres` porte déjà les `props` du chargeur de la route : le serveur les sérialise dans le HTML servi, le client les lit avant qu'aucun composant ne monte — un composant qui lit une de ses clés dès le montage la voit donc immédiatement, sans attendre une navigation. Sur une route sans chargeur, `µres` reste vide (`{}`) ; lire une clé absente rend une valeur vide, sans erreur.

📚 **Pile 100&nbsp;% MJS** : `mjs serve` et `mjs dev` parlent ce protocole nativement — voir [19 · SSR](19-ssr.md) → *Clé en main : les chargeurs `serve.server.mjs`*.

## Le veilleur `flash`/`error` — messages automatiques du serveur

Deux clés particulières, `flash` et `error`, peuvent apparaître dans les `props` d'une réponse — un message de succès, un message d'échec. Le framework les repère tout seul, les affiche, puis les **consomme** : retirées du sac avant que le reste des `props` n'entre dans `µres`, elles n'y apparaissent donc jamais. `errors` (au pluriel — les erreurs *par champ* d'un formulaire, cf. « Formulaires » plus haut) n'a rien à voir et n'est jamais touché par ce mécanisme.

```ruby
render json: { module: nil, props: { flash: 'Article ajouté au panier' }, method: 'none' }
```

Ce veilleur agit à **chaque** point où un sac de `props` serveur peut entrer dans le store : le chemin nominal (page ou fiche appliquée), `method: 'none'`, un **422** (le formulaire refusé garde `errors` dans `props`/`µres` pour l'affichage inline — inchangé par ce mécanisme), et le **premier chargement HTML** d'une page (props du chargeur exposées façon flash de session, à la Post/Redirect/Get). Un **échec de transport** — le serveur ne répond pas — déclenche lui aussi un message, synthétique cette fois, sur le même canal : « Échec de l'envoi — le serveur n'a pas répondu. » (le statut HTTP suit entre parenthèses s'il est connu).

Sur ce même 422, évitez d'envoyer aussi une clé `error` globale en plus des `errors` par champ : les deux s'affichent en même temps — la modale du veilleur **et** les messages en affichage inline sous les champs — pour une seule et même faute. Les `errors` par champ suffisent ; réservez `error` aux échecs qui n'ont pas de champ précis à blâmer.

**Réglages**, du global au particulier :

- `µ.config.flash` — `'popup'` *(défaut)* : `flash` part en toast (`µ.modal.notify`), `error` en modale bloquante (`µ.modal.error`) ; `'console'` : `console.info`/`console.error` ; une **fonction** `(type, message) -> …` (`type` ∈ `'flash'`/`'error'`) pour brancher son propre affichage ; `false` : veilleur **coupé** — les clés ne sont plus consommées, elles traversent intactes jusque dans `µres`.
- la directive **`@flash="popup"`/`"console"`/`"silent"`** (attribut compilé `mjs-flash`), posée sur le lien ou le formulaire déclencheur, prime sur `µ.config.flash` pour **cette** navigation précise (`'silent'` consomme quand même la clé — affichée nulle part, mais pas laissée dans `µres` pour autant). L'attribut `mjs-flash` compilé marche aussi bien écrit à la main dans du HTML servi par le back que posé par la directive sur un composant MJS, comme `mjs-confirm`/`mjs-method`.

```html
<form method="post" action="/cart" @flash="console">…</form>
```

Sans le module `modal` au bundle (sélection `runtime` explicite qui l'exclut), le veilleur retombe sur `alert`/`console` et signale une fois en console qu'ajouter `modal` retrouverait le rendu habituel.

## `@callback` — un rappel après navigation

`@callback="methodName"`, posée sur un lien ou un formulaire, appelle une méthode du composant après une navigation qui **aboutit** — jamais ailleurs :

| Issue | `@callback` appelé ? |
|---|---|
| fiche nominale appliquée (page/composant monté) | oui |
| `method: 'none'` | oui |
| **422** (formulaire refusé) | non — c'est le veilleur `flash`/`error` ci-dessus qui parle |
| échec de transport | non — idem |
| retour `Précédent`/`Suivant` (popstate) | non |

La méthode reçoit un seul argument, `{ path, url, status, via }` — le vocabulaire des événements de cycle de navigation (cf. plus haut). La recherche remonte depuis l'élément qui **porte** l'attribut (lui-même, ou son plus proche ancêtre via `closest`) vers le premier nœud — lui compris — qui définit une méthode de ce nom ; elle traverse les frontières de Shadow DOM. Rien ne se passe si l'élément d'origine n'est plus monté au moment où la réponse arrive (son conteneur a été remplacé entre-temps par un swap plus récent) ; un avertissement en console signale une méthode introuvable.

```html
<form method="post" action="/cart" @callback="onAdded">…</form>
```

```civet
onAdded = ({ path, url, status, via })->
  $badge += 1
```

`@callback={…}` (une expression entre accolades) est une **erreur de compilation** : la directive attend un identifiant nu, jamais un corps à exécuter.

## Les cinq issues d'une réponse

Le protocole MJS ne donne pas d'ordres au navigateur : il décrit un **état**. Le serveur renvoie une page, ou une fiche, ou des erreurs de validation, et le client en tire les conséquences. Cinq issues, en tout :

| Issue | Ce qu'elle transporte | Effet côté client |
|---|---|---|
| une **page** (HTML) | le fragment qui remplace le contenant | contenu installé, historique mis à jour |
| une **fiche** (JSON) | `module`/`props`/`target`/`method`… | composant monté dans le contenant désigné |
| des **erreurs de validation** (422) | la fiche, `errors` ajouté dans `props` | le composant en place se ré-affiche, sans remontage |
| un **rechargement** (`reload`) | rien de plus qu'un ordre de repartir de zéro | page entière rechargée |
| un **« rien à échanger »** (`none`) | éventuellement des `props` | rien d'installé ; `µres` mis à jour si des `props` arrivent |

Les trois premières lignes sont détaillées plus haut. Les deux dernières complètent le vocabulaire.

### `X-MJS-Reload` — « j'ai traité, rechargez tout »

En-tête HTTP `X-MJS-Reload` sur la réponse (mode HTML), ou champ `reload: true` de la fiche (mode JSON) — valeurs reconnues : n'importe quelle valeur non vide, sauf `0` et `false`.

Effet : rechargement complet de la page. Si la réponse a redirigé ailleurs, le client va à cette destination ; sinon il recharge l'adresse courante. Aucun contenu n'est échangé, aucune entrée d'historique n'est ajoutée par MJS, et l'événement `mjs:load` n'est **pas** émis — la page s'en va.

Comme toute navigation complète de MJS, ce rechargement ne part que vers une adresse `http(s)` : une destination `javascript:` ou `data:` est refusée, avec un avertissement en console.

Cas d'usage : une action qui change quelque chose de global — déconnexion, changement de langue, bascule de rôle, purge de cache applicatif — où réécrire un morceau de page serait plus fragile que de repartir propre.

`mjs serve` ne pose jamais cet en-tête : c'est un vocabulaire pour les backs applicatifs.

### `X-MJS-Method: none` — « j'ai traité, ne bougez pas »

En-tête `X-MJS-Method: none` (mode HTML), ou `method: 'none'` dans la fiche (mode JSON), à côté des trois valeurs existantes `update` (défaut), `replace` et `append`.

Effet : **rien n'est installé**. Pas d'échange de contenu, pas de `pushState`, pas de changement d'adresse, pas d'événement `mjs:load`. En mode JSON, les `props` de la fiche sont quand même appliquées à `µres` — **fusionnées**, jamais en remplacement du sac entier (cf. « `µres` — le sac de props serveur » plus haut) : le serveur renvoie le nouvel état, la réactivité met la page à jour toute seule, sans qu'une seule ligne de code n'ait à décrire le changement. En mode HTML, le corps de la réponse est ignoré : le back peut répondre un `200` vide sans que MJS n'avertisse que la réponse n'est pas une page.

Cas d'usage : un vote, un favori, un « marquer comme lu », un compteur — tout ce qui change une donnée sans changer de page.

`none` n'est **pas** une valeur acceptée pour la clé de configuration `render.method` : un défaut global « ne rien installer » n'aurait aucun sens. C'est une valeur de réponse, décidée cas par cas.

### Un concern Rails prêt à copier

```ruby
# app/controllers/concerns/mjs_response.rb
module MjsResponse
  extend ActiveSupport::Concern

  private

  def mjs_nav?                                                          # navigation MJS en cours
    request.headers['X-MJS-Nav'].present?
  end

  def mjs_update(target = nil)                                          # remplace le CONTENU du contenant
    response.set_header('X-MJS-Target', target) if target
    response.set_header('X-MJS-Method', 'update')
  end

  def mjs_replace(target)                                               # le contenant CÈDE SA PLACE
    response.set_header('X-MJS-Target', target)
    response.set_header('X-MJS-Method', 'replace')
  end

  def mjs_append(target)                                                # ajoute À LA SUITE, sans rien retirer
    response.set_header('X-MJS-Target', target)
    response.set_header('X-MJS-Method', 'append')
  end

  def mjs_none                                                          # rien à échanger, le serveur a fait son travail
    response.set_header('X-MJS-Method', 'none')
  end

  def mjs_reload                                                        # recharge la page entière
    response.set_header('X-MJS-Reload', '1')
  end
end
```

Et l'usage, à montrer en regard :

```ruby
class FavoritesController < ApplicationController
  include MjsResponse

  def create
    @article = Article.find(params[:id])
    current_user.favorites.create!(article: @article)
    mjs_none                                                            # la page ne bouge pas
    render json: { module: nil, props: { favorites_count: current_user.favorites.count }, method: 'none' }
  end

  def destroy_session
    reset_session
    mjs_reload                                                          # tout repart propre
    head :ok
  end
end
```

`FavoritesController#create` illustre directement la règle de fusion de `µres` vue plus haut : seule la clé `favorites_count` est renvoyée, et c'est justement pour ça que ça marche — le reste du sac de props de la page reste intact, sans qu'il faille réémettre l'état complet de la page à chaque clic sur un cœur.

---

📚 **Voir aussi** : [Router (client)](17-router.md) pour la navigation `#/…` (100&nbsp;% client, sans réseau) et le préchargement des liens ; [SSR](19-ssr.md) pour le rendu des pages elles-mêmes ; [Événements](06-evenements.md) pour `@confirm`/`@method` (directives posées sur un lien/formulaire, converties en attributs `mjs-confirm`/`mjs-method` lus par cette couche).
