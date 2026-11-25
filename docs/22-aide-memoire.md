# 22 · Aide-mémoire (fiche de référence)

> 🃏 **La carte de jeu de MJS.** Une page unique qui résume les symboles, l'API `µ`, les runes, les hooks, les balises spéciales et les blocs — comme la fiche d'aide qui rappelle les phases et les icônes sans rouvrir la règle du jeu. Chaque tableau renvoie au chapitre complet. Pour *comprendre*, lisez le chapitre ; pour *retrouver*, restez ici.

---

## Symboles réactifs

Le nerf de MJS : chaque symbole encode une **portée de réactivité** différente. Ne jamais les confondre.

| Symbole | Nom | Sens | Portée |
|---|---|---|---|
| `$x` | état local | réactif, propre au composant — **auto-déclaré** (pas de `$x=''`) | le composant |
| `&id` | param de route | ≡ `µ.url.params.id`, réactif, **toujours une chaîne** (sauf `&all` du joker `*` : **tableau** de segments — `&rest` en donne l'équivalent chaîne) | l'URL courante |
| `§clé` | contexte d'arbre | posé par un ancêtre, lu par ses descendants — **non réactif** | sous-arbre |
| `§§clé` | **contexte réactif de sous-arbre** | store local **abonnant** partagé parent→descendants ; les lecteurs re-rendent au changement | sous-arbre |
| `$$X` | store global | ≡ `µ.store.X`, réactif, **zéro import**, lisible partout | appli entière |
| `µ$$X` | déclare/importe/consomme un singleton | store léger `export`é depuis un module, **importé et consommé avec ce même `µ$$X`** | module → importeurs |
| `$$nom` | **variable de thème** | dans `<style>`/`<theme>` seulement — valeur de style qui cascade vers le bas, compile en `var(--mjs-nom)` (`$$x` reste le store global dans un `<script>`) | l'arbre depuis l'élément qui la déclare |
| `@@x` | propriété d'instance | référence à `this.x` **insensible au site d'appel** — là où `@x` nu perd son `this` une fois sorti du HTML | le composant |

> ⚠️ **`§§` n'est pas un récupérateur d'import.** C'est **toujours** un *store réactif local de sous-arbre* (`_mjs_getRCtx`, remontée d'ancêtres) : deux composants sans ancêtre déclarant commun ne partagent **rien** via `§§`. Un singleton `µ$$X` exporté par un module s'importe et se consomme avec ce **même** symbole `µ$$X` — jamais `§§X` (cette forme d'import est refusée à la compilation). Détails : [13 · Contexte](13-contexte.md) et [14 · Stores](14-stores.md).

> 🔗 `$$nom` (variable de thème) et `@@x` (propriété d'instance) : détails [31 · Thèmes](31-themes.md) et [3 · Réactivité](03-reactivite.md).

> ℹ️ **`@x` dans le rappel d'un observateur.** `new ResizeObserver(mesurer)` — comme `MutationObserver`, `IntersectionObserver` et `PerformanceObserver` — appelle `mesurer` avec l'observateur pour `this` : `@x` y lit l'observateur (`@disconnect()` l'arrête). Pour votre composant, écrivez `@@x`, comme dans toute fonction appelée nue. Détail : [3 · Réactivité](03-reactivite.md).

---

## Casse de l'API `µ` — la règle

**majuscule = un type** (classe / objet-namespace à méthodes). &nbsp; **minuscule = une valeur** (store, booléen d'environnement, ou fabrique que vous appelez). La forme courte « sans point » compile vers la forme pointée. Le symbole et sa rune s'écrivent d'un seul tenant, sur une seule ligne : `µ` puis `.setContext(…)` à la ligne suivante, ou `µ .emit`, est refusé à la compilation.

| Forme courte | ≡ pointé | Nature | Usage |
|---|---|---|---|
| `µRouter` | `µ.Router` | objet-namespace | `µRouter.to('/x')`, `.back()` |
| `µStore` | `µ.Store` | classe | type de store |
| `µElement` | `µ.Element` | classe | type d'élément |
| `µsocket(url)` | `µ.socket` | **fabrique** | crée un socket réactif |
| `µsmooth(src)` | `µ.smooth` | **fabrique** | lisse un flux |
| `µurl` | `µ.url` | store réactif | `µurl.path`, `.params`, `.query`, `.hash` |
| `µonline` / `µvisible` / `µready` | `µ.online`… | booléens réactifs | réseau / onglet visible / DOM prêt |
| `µserver` | `µ.server` | booléen, **non réactif** | `true` en rendu SSR (2 moteurs), `false` côté client |
| `µnav` | `µ.nav` | store réactif | `µnav.active`/`.href` — navigation UJS en vol |
| `µmodal` | `µ.modal` | objet-namespace | `µmodal.fire(…)`, `.success`/`.error`/`.info`/`.warn`, `.notify`, `.wait`, `.close` |
| `µtheme` | `µ.store.__mjsTheme` (clé cachée) | valeur réactive | `µtheme` (lecture), `µtheme = 'dark'` (écriture) — thème clair/sombre |
| `µlayout` | la prop `layout` (`default` sans rien) | valeur réactive, **lecture seule** | le modèle choisi sur la balise ; chaque nom comparé (`µlayout is 'timer'`) est un modèle connu |
| `µpending` | — (état du bloc `{await}`) | booléen réactif, **lecture seule** | sans parenthèses, dans les branches d'un `{await}` : vrai tant que la lecture en cours n'est pas arrivée (`hidden={not µpending}` sous `{await.keep …}`) ; hors d'un `{await}`, `undefined` — à ne pas confondre avec `µpending($x)`, ligne suivante |
| `µpending($x)` | — (valeur qui attend) | booléen réactif, **lecture seule** | vrai tant que la demande la plus neuve de `$x = await …` attend, avant la première réponse aussi ; dans le gabarit comme dans le script (`$occupe = µpending($x)`) ; la variable seule entre les parenthèses, sinon refusé à la construction ([3](03-reactivite.md)) |
| `µfailed($x)` | — (valeur qui attend) | l'erreur, ou `null` | l'erreur de la dernière demande de `$x = await …` ; la valeur d'avant reste, la réponse suivante efface l'erreur ; sans parenthèses, `µfailed (err, reset)->` est la frontière d'erreur ([16](16-cycle-de-vie.md)) |
| `µsignal` | — (lecture du bloc `{await}` ou de la valeur qui attend) | `AbortSignal` | dans l'expression d'un `{await}` ou d'une valeur qui attend seulement : `{await charger($id, µsignal)}`, `$fiche = await charger($id, µsignal)` ; coupé quand la lecture suivante commence ou quand le bloc ou le composant quitte la page ; ailleurs, refusé à la construction |
| `µconfirm` | `µ.confirm` | fonction, réassignable | `µconfirm(message, el)` → booléen/promesse, pilote `:confirm` |
| `µajax` | `µ.ajax` | objet-namespace (ses verbes, ses rappels par défaut) ; s'appelle directement (`µajax(…)`, `µajax '/url', …`, `µajax?.(…)`), jamais pris comme valeur : passé en argument, rangé, décomposé, lu par `µ['ajax']` ou appelé par `.call` / `.bind` / `.apply`, il arrête la construction ; une garde d'existence (`typeof µajax`, `µajax?`, `if µajax`, `µ.ajax and …`, `µ.ajax ? … : …`) est permise |
| `µtypes` | `µ.types` | objet | `µtypes.onError (e) -> …` : le gestionnaire des valeurs refusées par une règle, qui rend `'throw'`, `'warn'` ou rien ; s'il lève, le signal part quand même (cf. [37](37-types.md)) |
| `µerror` | `µ.error` | fonction | journalise une erreur applicative (varargs, comme `console.error`) |
| `µconfig` | `µ.config` | objet-namespace | sac de réglages du framework (`.notifyMax`, `.modalSound`, `.title`, `.confirm`…) |
| — | `µ.elementAt(x, y)` | fonction | l'élément le plus profond sous un point de la fenêtre, à travers les composants ; `null` hors de la fenêtre ([18](18-pieges.md) § 12) |
| — | `µ.adoptSheet(balise, feuille)` | fonction | colle une feuille de style (texte CSS ou CSSStyleSheet) dans l'ombre d'un composant, après les siennes ; elle reste quand le composant sort de la page et y revient ; rend la fonction qui la retire ([2](02-composant.md), « Coller une feuille pendant que la page tourne ») |

> 🔗 La règle est à deux étages dans le lexer : une règle **générique** « toute capitale après `µ` » pour les types (`µRouter`/`µStore`/`µElement`), et une **allowlist stricte énumérée** pour les globales minuscules (`µurl`/`µonline`/`µvisible`/`µready`/`µsocket`/`µsmooth`). Les runes minuscules (ci-dessous) ne suivent **pas** ce régime.

> ⚠️ Seul doublet où la même racine vit dans les deux casses : `µ.Store` (la **classe**) vs `µ.store` (l'**instance** globale, alias de `$$`).

---

## Classes globales — `Nom.class.mjs`

| Écriture | Effet |
|---|---|
| `App.class.mjs` : `class App`, `NAME = 'Heartwork'`, `fullName = -> NAME + …` | une classe de l'appli : du code Civet seul, ni gabarit ni bloc |
| dans le corps de la classe | un membre se lit et s'écrit par son nom, sans `@` ; un paramètre ou une variable déclarée du même nom le cache |
| `µApp.NAME`, `µApp.fullName()`, `µ.App` | lue partout sans import : gabarit, script, module, autre classe |
| chargement | avec le code de ceux qui la citent, avant lui ; jamais au démarrage |
| Node | `node/App.js` dans le dossier de sortie, chargé par `import` ; `µ` y est `globalThis.µ` |
| refusé à la construction | nom du framework (`Router`…), nom en double, minuscule en tête, fichier sans `class App` ou avec un bloc, classes qui se citent en boucle, une seconde classe dans le fichier, un `@` dans la classe, une liaison nommée comme la classe, `delete NOM` |

## Runes (mots du langage, compilation dédiée)

| Rune | Rôle | Chapitre |
|---|---|---|
| `µeffect` | un reffet (effet réactif), ré-exécuté quand ses `$` changent ; au premier niveau du fichier d'un magasin (`export µ$$x`, `new µStore`), il appartient au magasin et tourne sans composant | [3](03-reactivite.md) |
| `µeffect.before` | un reffet qui voit l'écran d'avant la mise à jour : juste avant les blocs et les liaisons ; ses écritures ne le relancent pas | [3](03-reactivite.md) |
| `µeffect.root ->` | lance des reffets à la demande, n'importe où (gestionnaire, `µmount`, fonction d'un module, fichier `.js` importé) ; ses reffets s'écrivent directement dans son rappel, avant tout `await` et hors d'une boucle qui attend (un reffet écrit ailleurs dans un gestionnaire du gabarit est refusé) ; rend la fonction qui les arrête tous, que le gestionnaire qui vient d'ouvrir la racine peut renvoyer sans l'arrêter (`@click={µeffect.root -> µeffect -> …}`) ; dans un composant (son `<script>` comme ses gestionnaires), ce sont ses reffets : ils suivent ses variables et finissent avec lui | [16](16-cycle-de-vie.md) |
| `magasin.destroy()` | jette un `µStore` : ses reffets s'arrêtent, ses abonnés ne sont plus prévenus, il reste lisible | [14](14-stores.md) |
| `µspring` | ressort animé (scalaire, objet ou tableau) | [10](10-transitions.md) |
| `µeasing` | courbe d'interpolation | [10](10-transitions.md) |
| `µanim` | animation impérative | [10](10-transitions.md) |
| `µsnap` | fige une valeur hors réactivité | [3](03-reactivite.md) |
| `$y = expr` | valeur dérivée : précise (refaite quand une de ses `$` change, sauf quand elle repasse à l'horloge : objet que le compilateur ne voyait pas, cf. 03 ; un accesseur propre à un objet, posé avant que la variable le reçoive, ne se regarde pas : écrivez `µrefresh($x)` quand ce qu'il lit change, même par MJS, la relecture du développement vous le rappelle) si le compilateur prouve ce qu'elle lit — variables `$`, littéraux, opérateurs, champs, liste courte de méthodes — et que son calcul coûte (appel de méthode, appel sur une liste étalée `Math.max(...$l)`, liste ou objet bâti, ou lue par une valeur précise) ; sinon à l'horloge (refaite après toute écriture du composant) ; toutes à l'horloge avec l'option `"derived": "clock"` de `mjs.config.json` ; `mjs check --derived` | [3](03-reactivite.md) |
| `µderived $x = expr, $a, $b` | dérivé à dépendances déclarées ; écrit par votre code, il garde la valeur écrite jusqu'à ce que `$a` ou `$b` change (`$y = expr` écrit devient une variable ordinaire) | [3](03-reactivite.md) |
| `µtoggle($x, 'a', 'b')` | bascule / cycle — la liste des valeurs EST le cycle (0 valeur = booléen, 1 valeur = présent/absent) ; cible = tout chemin assignable (`$x`, `$$x`, `§x`, `µtheme`, `@prop`, variable nue, `$o.a.b`) | [3](03-reactivite.md) |
| `µevery 2500, ->` | répète le corps toutes les N ms, **en tirant tout de suite** ; s'écrit partout dans le composant (`<script>`, gestionnaire, méthode, `µeffect`) et dans un module ou un magasin (suit le composant qui s'exécute à l'appel, à défaut la page — en production, seulement si la construction lit un appel de ce genre, ou une forme qu'elle ne sait pas suivre — mention de µ autre que `µ.<nom>`, même échappée, `eval`, `Function`, texte écrit dans un appel de `setTimeout` — ; un appel qu'elle ne voit pas, script de `public/`, script extérieur, accès entièrement calculé (`window[k]`), code qu'un texte fait exécuter par une autre voie (texte rangé dans une variable, `new x.constructor(…)`), n'y pose rien, averti en développement quand il s'exécute) ; coupé quand le composant est détruit (en hibernation dans le cache de pages : continue, sauf `pause: true` ; retiré puis remis par votre script : repart au retour) ; posé par un passage de `µeffect` ou par une `:attach`, arrêté au passage suivant ou au détachement ; rend une main d'arrêt ; `id: 'nom'` comme `µafter` | [16](16-cycle-de-vie.md) ; `always: true` : n'appartient pas au passage qui la pose (un `µeffect` qui repart ne l'arrête pas), s'arrête à la destruction du composant |
| `µafter 2000, ->` | **un seul** tir après le délai, même vie que `µevery` (dans un `µeffect`, le passage suivant annule le tir en attente : anti-rebond) ; `always: true` : part même composant disparu ; sans fonction, `await µafter 300` attend (terminé au retour d'un composant retiré puis remis, jamais s'il disparaît pour de bon) ; `id: 'nom'` : une seule minuterie de ce nom, la neuve arrête d'abord l'ancienne (`µafter 2000, id: 'sauver', -> …` sauve 2 s après la dernière frappe ; nom partagé avec `µevery` ; portée : le composant, la page pour un module ou un magasin (en production, le code des noms entre dès que la construction lit un appel qui peut porter un `id` — clé écrite, options passées par une variable, un paramètre, un appel — ou une mention de µ autre que `µ.<nom>` et ces appels : `µ['after']`, alias, `.call`, µ passé comme valeur, `{ µ: m } = window` (`window.µ` n'existe qu'en développement, sauf si l'appli le pose), `Reflect.get(globalThis, 'µ')`, `window['\xb5']`, de même que `eval`, `new Function`, un membre `constructor` appelé, un texte écrit dans un appel de `setTimeout`, `setTimeout.call` ; un appel qu'elle ne voit pas, script de `public/`, script extérieur, accès entièrement calculé (`window[k]`), code qu'un texte fait exécuter par une autre voie (texte rangé dans une variable, `new x.constructor(…)`), perd son `id`, averti en développement quand il s'exécute) ; `await µafter 300, id: 'n'` : seule la dernière attente reprend, la suite d'une attente remplacée, `finally` compris, ne tourne jamais) | [16](16-cycle-de-vie.md) |
| `µclone el` | copie indépendante d'un composant : une balise neuve qui monte avec une copie des données de son état (variables `$`, props — ni fonction, ni instance de classe, ni élément du DOM), puis vit seule ; `µ.clone(el)` en JavaScript | [16](16-cycle-de-vie.md) |
| `µclone el, mirror: true` | miroir vivant d'un composant : une balise neuve qui **partage l'état** de l'original — une écriture faite dans n'importe quelle instance les redessine toutes ; DOM, écouteurs, script et cycle de vie propres à chacune ; `@@isMirror` vrai dans un miroir ; `µ.clone(el, { mirror: true })` en JavaScript | [16](16-cycle-de-vie.md) |
| `µload(url, { refresh })` | magasin chargé : la réponse JSON d'une adresse, `data` / `pending` / `error` / `refresh()` ; une requête par adresse pour tous ses lecteurs ; l'appel écrit dans l'expression d'une variable ou d'une dérivée (hors fonction et boucle) dont l'adresse change garde la donnée d'avant pendant l'attente (la frappe d'une recherche) ; fait dans une aide, une flèche, une boucle ou le gabarit, jamais celle d'une autre adresse ; un autre appel (ternaire, `or`) montre le magasin de sa propre adresse, jamais la donnée d'un autre ; une dérivée lâche les adresses qu'elle n'appelle plus ; relu après un `µ.ajax.post/put/patch/delete` réussi de même chemin (barre finale comprise ; `/` relu par un envoi à `/` seulement) ou sur `µload.refresh(url)` ; `refresh` : `false` (défaut), secondes, `'focus'`, `'online'`, toujours dans un objet, chaque appel garde sa règle ; une réponse qui n'est pas du JSON pose `error` (même texte en production) ; s'écrit dans le script (variable, dérivée, gestionnaire, `µmount`) ou dans un module ; une valeur qui lit la donnée (`µload(u).data?.n or 0`, `.pending`, `.error` ; `refresh()` non) est une dérivée, recalculée à chaque arrivée ; le même appel pour chaque rang (`map`, boucle) : chaque rang sa donnée, jamais celle d'un autre, même seul ; dans le gabarit (une liaison, racine comprise, branche d'un `{if}`, d'un `{key}` ou d'un `{await}`, condition, liste ou ligne d'un `{for}`), un `µeffect` ou une aide du gabarit, l'appel marche, le composant se redessine à chaque arrivée et garde ce qu'il affiche (jamais évincé ni redemandé ; une erreur reste affichée jusqu'à son départ ou `refresh()`), mais il n'est pas suivi : requêtes dépassées non annulées, adresse qui change sans la donnée d'avant ; une adresse affichée est relue une fois après un envoi (bloc fermé pas encore lâché compris), jamais au redessin — le développement conseille une dérivée du script lue dans le gabarit (`$membres = µload(…)`) ; gardé 5 min dans un cache de 50 adresses quand plus personne ne le lit ni ne l'affiche (le gabarit lâche ce qu'il n'affiche plus à son rendu complet suivant) ; un composant parti n'est plus prévenu | [14](14-stores.md) |
| `µrules(@)` | les règles des variables et des props du `<vars>` en schémas standard (`~standard`) : `validate(valeur)` rend `{ value }` converti ou `{ issues }` (message en vouvoiement, chemin) ; l'ensemble est lui-même un schéma, qui reçoit aussi un formulaire ou un `FormData` ; `µrules()` sans composant : les règles des stores ; au serveur, `modularjs-framework/rules` contrôle les mêmes règles sans navigateur | [37](37-types.md) |
| `µraw(données)` · `µraw(liste, true)` | état brut, non réactif ; avec `true`, la liste est marquée et ses lignes tenues pour brutes dans son `{for}`, en un seul appel (la note ne suit pas une copie : marquez-la à son tour) | [11](11-etat-brut.md) |
| `µrefresh($x)` — ou `µrefresh $x`, seul sur son instruction | signale un changement fait hors de MJS dans ce que tient `$x` (bibliothèque, script extérieur, objet gardé sans `$`) : redessine ce qui l'affiche — une liste qui l'affiche relit toutes ses lignes, brutes comprises (marquées `µraw`, une à une ou par `µraw(liste, true)`) — et refait les valeurs dérivées qui le lisent, sans relancer d'effet, avec la précision comme à l'horloge (`"derived": "clock"`) ; une variable `$` que le composant déclare (pas une valeur dérivée), ou une clé du magasin — `µrefresh($$x)` —, dans le script ou un gestionnaire d'événement (ailleurs dans le gabarit, refusé) ; hors d'un composant (`<script module>`, fichier d'un magasin), une clé du magasin seulement ; appelé pendant un rendu ou le calcul d'une valeur dérivée, appliqué juste après (écouteur que le rendu déclenche : `blur` du champ qu'il retire, `focus` d'un `el.focus()` dans `:attach` — gestionnaire du gabarit, `µon`, écouteur d'une bibliothèque) ; une fonction lue par le gabarit qui l'appelle boucle : le détecteur de boucle coupe le composant, un avertissement de développement nomme `µrefresh` et dit où l'écrire ; une valeur dérivée qui l'appelle l'applique à chacun de ses calculs (son calcul ne se périme pas lui-même), et deux valeurs dérivées dont chacune rafraîchit une source de l'autre se refont l'une l'autre en boucle (avertissement de développement) : ni une fonction lue par le gabarit ni une valeur dérivée ne doit l'appeler | [3](03-reactivite.md), [41](41-refresh.md) |
| `µread $x` — ou `µread($x)` | lit un slot d'état **sans s'y abonner** (≈ `untrack`) ; parenthèses optionnelles | [11](11-etat-brut.md) |
| `µwrite $x, v` — ou `µwrite($x, v)` | écrit un slot d'état **sans notifier** (pas de re-rendu) | [11](11-etat-brut.md) |
| `µdebug $x` | point d'arrêt réactif (log + `debugger`, à chaque changement) | [18](18-pieges.md) |
| `µinspect $x` | log console From/To à chaque mutation (sans pause) | [18](18-pieges.md) |
| `µinspect $x.foo` | même suivi, mais n'affiche que les changements de ce chemin | [18](18-pieges.md) |
| `µconsole` | ouvre le panneau d'inspection — dans un composant : sur lui ; `µconsole '.sel'` : sur ce composant ; `µconsole valeur` : l'inspecteur ; `µconsole false` : ferme ; en production : rien | [34](34-deboguer.md) |
| `µasset(chemin)` | résout un chemin d'asset (marche aussi en CSS), cherché sous `sourceDir` puis dans les dossiers de `assetDirs` (images, polices, sons — jamais du code) ; idiome polices : `<@head><style>@font-face{src:url(µasset('…'))}</style></@head>` | [35](35-images.md#des-images-rangées-ailleurs-assetdirs) |
| `µasset "a/#{n}.mp3"` | nom calculé : le build lit le motif (`a/*.mp3`) et n'emporte que la table des fichiers qui y répondent, dans le seul composant qui l'écrit ; une partie calculée ne contient jamais de `/` ; nom absent → adresse vide (avertie en développement) ; nom collé par `+` lu de même ; `µasset nom`, rune prise comme valeur, motif trop large ou sans fichier → build en échec ; table refaite sous `mjs dev` | [15](15-elements-speciaux.md) |
| `µimage('chemin'[, largeur…])` | image résolue au build : `{ src, srcset, sizes, width, height }` ; chemin sous `sourceDir` puis dans `assetDirs` — alias `mjsimage` | [35](35-images.md) |
| `µimport(chemin)` | chargement paresseux d'un module : bibliothèque `.js` copiée, ou module `.js.mjs`, `.civet.mjs` / `.coffee.mjs` compilé, bibliothèque `.civet` / `.coffee` compilée par son seul langage dans son propre fichier (littéral, hashé au build, instance unique avec le même module `@import`é ; retourne la promesse du module) — alias `mjsimport` | [2](02-composant.md) |
| `µtheme` | thème actif du document, lecture/écriture | [31](31-themes.md) |
| `µlayout` | le modèle choisi du composant (`layout="…"` sur sa balise), lecture seule | [31](31-themes.md) |

`µ.debugMode = true` (console) : télémétrie visuelle (outline vert au re-rendu) ; `µ.instances` : `Set` des composants montés.

---

## Cycle de vie

Forme **rune µ** (un appel qui reçoit le callback), toujours en `->`. Écrire `@mount ->` **lève une erreur de compilation** qui oriente vers la rune ; `@mount = ->` est une méthode utilisateur ordinaire — les noms sont libres.

| Hook | Quand |
|---|---|
| `µmount` | monté dans le DOM (1re fois) |
| `µawake` | à chaque arrivée dans la page, la première ouverture comprise, avant `µmount` (ne chargez pas vos données dans les deux) |
| `µsleep` | mis en veille |
| `µdestroy` | détruit / démonté |
| `µurlChange` | l'URL a changé (exige un composant router-aware) |

> Exemple : `µdestroy -> @sock.close()`. Détails : [16 · Cycle de vie](16-cycle-de-vie.md).
>
> Une minuterie s'écrit `µevery` ou `µafter` (ci-dessus), arrêtée toute seule quand le composant est détruit (en hibernation dans le cache de pages, elle continue, sauf `pause: true`) : `setTimeout` et `setInterval` sont refusés à la construction dans le `<script>` d'un composant, ses gestionnaires et les accolades de son gabarit (libres dans `<script module>`, les modules et les magasins).

---

## Balises `<@…>` prédéfinies

`<@nom>` invoque un composant **du projet** (balise `mjs-nom`), `<@@nom>` un **module cœur** (balise `mjs-core-nom`) — les douze premières lignes ci-dessous sont des **directives** du langage (un seul `@`, jamais un composant), les suivantes les **modules cœur** — détails : [15 · Éléments spéciaux](15-elements-speciaux.md) § *Les raccourcis `<@nom>` et `<@@nom>`* et [30 · Modules cœur](30-modules-coeur.md).

| Balise | Nature | Rôle |
|---|---|---|
| `<@view>` | directive | point d'injection du routeur ; peut vivre sous un `{if}` : la page de l'adresse paraît avec la vue, et la route en cours comme la page affichée sont gardées tant qu'elle est cachée |
| `<@slot>` | directive | contenu projeté (3 régimes) |
| `<@fill nom>` | directive | bloc — plusieurs éléments vers le même slot nommé (sucre de `slot="nom"`) |
| `<@include nom>` | directive | inline un partial `_nom.mjs` (fusion script/style/markup, compile-time) |
| `<@head>` | directive | injecte dans `document.head` |
| `<@window>` | directive | listeners / bindings fenêtre |
| `<@document>` | directive | idem sur `document` |
| `<@body>` | directive | idem sur `body` + liaisons `:class{…}` / `:style.prop` / `--var` / `class=` |
| `<@html>` | directive | idem sur `<html>` (`:root`) — theming global, dark-mode |
| `<@module $comp>` | directive | composant dynamique (nom évalué à l'exécution) |
| `<@element>` | directive | balise dynamique (`<@element $tag>`) |
| `<@failed>` | directive | error boundary (`err`, `reset`, `retry="N"` — défaut 1 réessai) |
| `<@@select>` | module cœur | liste déroulante — recherche, sélection multiple |
| `<@@option>` | module cœur | entrée d'un `<@@select>` |
| `<@@optgroup>` | module cœur | groupe titré d'options d'un `<@@select>`, comme `<optgroup>` |
| `<@@field>` | module cœur | enveloppe de champ, lit l'erreur `name` dans les réponses de son formulaire (`µres.errors[name]` hors de tout formulaire) |
| `<@@checkbox>` | module cœur | case à cocher stylée |
| `<@@radio>` | module cœur | bouton radio stylisé |
| `<@@switch>` | module cœur | interrupteur stylisé |
| `<@@color>` | module cœur | pastille de couleur, éditable |
| `<@@code>` | module cœur | bloc de code avec bouton « copier » |
| `<@@img>` | module cœur | image responsive, variantes calculées au build ([35 · Images](35-images.md)) |
| `<@@carousel>` | module cœur | carrousel en éventail 3D, flèches, molette (`index=!{$i}`) |
| `<@@deck>` | module cœur | paquet de cartes qui s'ouvre en éventail ou se déploie |
| `<@@tabs>` | module cœur | onglets à indicateur lumineux ou menu vertical en creux (`value=!{$x}`) |
| `<@@menu>` | module cœur | menu circulaire ou tiroir (`open=!{$o}`) |
| `<@@clock>` | module cœur | horloge en cadrans pointillés, minuteur |
| `<@@knob>` | module cœur | bouton rotatif (`value=!{$v}`) |
| `<@@number>` | module cœur | champ nombre, « − » et « + » dans ses bords (`value=!{$n}`) |
| `<@@gauge>` | module cœur | compteur à jauge : clic, molette (`wheel`), rouge à partir de `warn` (`value=!{$n}`) |
| `<@@progress>` | module cœur | cercle de progression, défilement de la page |
| `<@@cube>` | module cœur | cube lumineux qui tourne |
| `<@@sortable>` | module cœur | liste triable par glisser, au doigt ou au clavier (`value=!{$liste}`, `@sort`) ; deux listes de même `group` s'échangent leurs lignes, côte à côte ou l'une dans l'autre |
| `<@@virtual>` | module cœur | liste virtuelle : seules les lignes visibles sont dessinées (`items={$liste}`, `start=!{$debut} end=!{$fin}`, `{for x in $liste.slice($debut, $fin) by id}`), `scrollToIndex(place)` |
| `<@@editor>` | module cœur | éditeur de texte riche : HTML propre en `value=!{$x}`, titres, listes à puces, numérotées et à cocher, lien, couleur du texte (`colors="red green"` : `<span data-color>`), collage nettoyé ; `autofocus`, `caret="end"` : le focus dès son arrivée, le curseur à la fin du texte ; `answer` + `checked=!{$coches}` : texte figé, cases cochées par celui qui répond, retenues par le nom caché de leur ligne (`data-key`) |
| `<@@toolbar>` | module cœur | barre d'outils d'un `<@@editor>`, intégrée (`toolbar="bold italic ul check link"`) ou posée à part (`for="id"`) |
| `<@@chart>` | module cœur | graphiques : dix formes (`shape="line"`, `area`, `dots`, `bar`, `stack`, `histogram`, `pie`, `heatmap`, `radar`, `calendar`), données en lignes et en séries (`rows`, `series`), statistiques par série visible (`stats="mean median q1 q3 trend"`), regroupement par période (`step`), deux échelles (`axis: 'right'` dans une série), points reliés par-dessus une case vide (`bridge`), heures telles qu'écrites ou dans une zone (`timezone="Europe/Paris"`, `timezone="local"`), chiffres après la virgule (`decimals="2"`), `pickable` + `@pick`, barre d'outils (`toolbar="legend shapes stats step"`, `shapes` restreint le menu des formes) ; `shape`, `stats`, `step` et `hidden` à deux sens ([39 · Graphiques](39-graphiques.md)) |

> 🔗 Détails : [15 · Éléments spéciaux](15-elements-speciaux.md) (directives) et [30 · Modules cœur](30-modules-coeur.md) (modules cœur).

---

## Blocs de premier niveau (fichier `.mjs`)

Un composant réunit plusieurs blocs, tous optionnels — le nom du fichier détermine la balise.

| Bloc | Rôle |
|---|---|
| `<vars>` | types et valeurs permises des variables, props et stores (`$volume  int 0..100`) — toujours AVANT le `<script>` ; une variable dérivée réglée (`$total = $a + $b`) garde la valeur de son calcul : en développement, un avertissement quand elle sort de sa règle ; cf. [37](37-types.md) |
| `<script module>` | partagé entre toutes les instances |
| `<script>` | logique de l'instance |
| le HTML (le reste) | markup du composant |
| `<theme>` | variables de thème du composant |
| `<style>` | style scopé |
| `<style name="…">` | variant, chargé à la demande |

Un modèle qui change toute la structure a son fichier : `carte.compacte.mjs` à côté de `carte.mjs`, pris par `<@carte layout="compacte">` (cf. [31](31-themes.md)).

Ordre conventionnel : `<vars>` (imposé avant les scripts), `<script module>` puis `<script>` en tête, le HTML ensuite, puis les blocs `<theme>` éventuels, et le `<style>` en dernier. Un fichier `*.types.mjs` ne contient qu'un bloc `<types>` : les règles nommées de l'appli (`Percent  int 0..100`), cf. [37](37-types.md).

> 🔗 Détails : [2 · Anatomie d'un composant](02-composant.md) et [31 · Thèmes](31-themes.md).

---

## Directives, bindings & blocs

| Écriture | Rôle | Chapitre |
|---|---|---|
| `@import nom 'chemin'` · `@import { a b } 'chemin'` · `@import 'chemin'` | import MJS (jamais `import … from`) d'un module `.js.mjs`, `.civet.mjs` ou `.coffee.mjs` (compilé), d'une bibliothèque `.civet` ou `.coffee` (compilée par son seul langage) ou d'une bibliothèque `.js` (copiée telle quelle, seuls ses imports d'autres bibliothèques réécrits vers leur nom à empreinte ; elle arrête la construction si elle lit µ ou une rune en nom libre, écrite en clair ou par un échappement Unicode) ; sans nom : pour son seul effet, exécuté une fois ; une seule ligne ; dans le texte d'un élément du gabarit, reste du texte | [2](02-composant.md) |
| `import(variable)` | `import()` natif JS — URL connue seulement à l'exécution, jamais un littéral | [2](02-composant.md) |
| `@click`, `@input`… | événement (forme nue = la fonction du même nom, sinon la méthode `@click` du composant, sinon refusée à la construction ; sur `<@window>`, `<@document>`, `<@body>`, `<@html>`, `<@head>` : la fonction seule ; `={corps}` = handler) | [6](06-evenements.md) |
| `@click=nom` · `@click=@nom` | appelle la fonction `nom` (du `<script>`, importée, du gabarit ou du navigateur : `@click=alert`, qui reçoit l'événement, puis, sur un élément, l'élément ; refusés : un mot du langage que rien ne déclare, une valeur comme `null`, une fonction qui échoue quand elle reçoit l'événement, comme `queueMicrotask`, et `setTimeout` / `setInterval`, remplacés par `µafter` / `µevery`) · la méthode `@nom` du composant ; même règle entre accolades (`@click={nom}`), dans `<@failed>` et sur `<@window>`, `<@document>`, `<@body>` ; un nom qui n'existe pas est refusé à la construction, ligne du fichier nommée, toutes les fautes d'un fichier d'un coup, une fois chacune ; un objet ou un constructeur du navigateur (`@click=Date`) est refusé pour ce qu'il est | [6](06-evenements.md) |
| `@click.emit.nomEvent` · `@click.emit.nomEvent={charge}` | émission sur le GESTE, sans handler — modificateurs avant (`@submit.prevent.emit.saved`) | [6](06-evenements.md) |
| `:emit.nomEvent={valeur}` · `:emit.once.nomEvent={valeur}` | émission déclarative sur une VALEUR qui change (`.once` = seulement au montage) | [6](06-evenements.md) |
| `.prevent` `.stop` `.self` `.once` `.propagate` | les 5 modificateurs d'événement — tout autre suffixe est une **erreur** de compilation (donc pas de point dans un nom d'événement) | [6](06-evenements.md) |
| `change`, `submit` ne traversent pas un composant | `composed: false` (et `submit` ment sous Chrome) : le parent ne verra rien sans relais `µemit` | [6](06-evenements.md) |
| `@xxx` inconnu | sur un élément → écouteur d'événement, jamais vérifié ; sur `<style>`/`<script>`/`<theme>`/`<routes>`, ou en directive racine mal écrite → erreur de compilation avec suggestion | [9](09-directives-dom.md) |
| `value=!{$x}` | liaison bidirectionnelle (two-way) | [7](07-bindings.md) |
| `items={$items}` (sans `!`) | la prop passe l'objet lui-même, pas une copie : l'enfant qui le modifie, ou modifie un objet qu'il en atteint (`$items.push(x)`, `$items[0].nom = v`, par une autre variable ou une fonction comprises), le change sans prévenir le parent — dit en développement, une fois par composant et par prop, quoi que fasse le parent ensuite et d'où qu'il le prenne (magasin `$$` et `µ.state` compris) ; un enfant lié plus loin qui le modifie le fait dire au composant qui l'a reçu ; rien pour une prop liée, une copie que l'enfant garde, le magasin écrit par `$$`, ce que le gestionnaire du parent écrit dans `e.data` ; un objet se modifie là où il est rangé — l'état du composant qui l'a créé (`$`), ou le magasin (`$$`) — : un enfant le demande par un événement, ou reçoit la variable par une prop liée (`items=!{$items}`) et écrit directement par elle ; une copie ne partage rien (en surface, elle garde les éléments du parent ; `JSON.parse(JSON.stringify(…))` perd `Map`, `Set`, dates et classes) | [4](04-props.md) |
| `$x =: expr` | fige une valeur hors réactivité — opt-out ponctuel de la dérivation automatique | [3](03-reactivite.md) |
| `:class{$cond}="classe"` | classe conditionnelle | [8](08-class.md) |
| `:style.<prop>={expr}` · `--var={expr}` | style dynamique (jamais de CSS inline en dur) | [8](08-class.md) |
| `:this=!{ref}` · `:attach` | référence / greffe DOM | [9](09-directives-dom.md) |
| `*neon` · `*neon(#f0f)` · `*neon($couleur, size: 2)` | effet : une allure ou un mouvement en un mot (117 effets : `*glitch`, `*cycle`, `*tilt`, `*grid`, `*loader`, les transitions `*fade`, `*fly`, `*iris`…) ; réglages entre parenthèses, une valeur sans nom règle le réglage principal, les autres se nomment dans l'ordre qu'on veut ; valeur fixe (vérifiée à la compilation), liste `[a, b]`, variable suivie (`$x`, `item.id`) ; `direction` en mot ou en angle, `origin` un point, `order` l'ordre des lettres ; `on` : always, hover, view, click, load, success, error (une transition : view, scroll, load) ; sur `<@document>` : `*ripple`, `*lang`, `*offline`, `*cursors`, `*react`, `*follow`, `*heatmap` ; les effets en direct (`*cursors`, `*react`, `*follow`, `*heatmap`) prennent leur connexion dans `@sock`, ou `sock: $$sock` — sans l'un ni l'autre, erreur du build (un bouton `*react(🎉)` passe par sa scène) ; les effets de l'appli : fichier `*.effects.mjs` | [38](38-effets.md) |
| `:in=*fly(up, distance: 200)` · `:out=*fade` · `:transition=*slide` | une transition (ou un effet qui se joue une fois) à l'entrée, à la sortie, aux deux, d'une balise qu'un `{if}`/`{for}`/`{key}` ajoute ou retire ; modificateurs sur la directive : `:transition.global=*slide`, `:in.shared=*fade` | [10](10-transitions.md) |
| `*filter.frosted_glass` · `*filter.frosted_glass(blur: 20)` · `:in=*fade.lent` | alias d'effet : `*effet.nom = *effet(réglages)` dans un fichier `*.effects.mjs` règle une fois un effet de la bibliothèque ; `*effet.nom` le pose (un réglage se change à la pose) partout où l'effet se pose, balise, `:in=`/`:out=`/`:transition=` et `<@document>` ; le nom : minuscules, chiffres et `_` ; MJS en livre près de deux cents (`*filter.frosted_glass`, `*tilt.floating_layers`…, listés dans la doc des effets), celui de votre appli qui porte le même nom le remplace, avec un avertissement ; dès six usages, ses réglages ne sont écrits qu'une fois | [38](38-effets.md) |
| `:lightDom` | monte sans Shadow DOM (≡ attribut `mjs-light`) | [9](09-directives-dom.md) |
| `:offscreen` · `:offscreen=48` | la ligne d'une longue liste, hors de l'écran, n'est ni mise en page ni peinte ; la valeur : sa place réservée (24px sans valeur), exacte pour des lignes de même hauteur ; au-delà de 10 000 lignes, sur des blocs de 100 lignes (`:offscreen=4800`), le navigateur vérifiant chaque balise à chaque image défilée ; ce qui déborde de la ligne est rogné ; refusé sur une balise de tableau et sur un `<li>` (son numéro ou sa puce serait rogné) : une ligne en `<div>` | [5](05-blocs.md) |
| `:size="320x48"` · `:size="x48"` | sur la balise d'un composant de votre projet : la place que garde sa balise tant que son code n'est pas arrivé (fichiers séparés), vide ou avec la silhouette de `*skeleton` — ce qui la suit ne bouge pas à son arrivée ; largeur `x` hauteur, en px par défaut, ou px, %, em, rem, vw, vh ; en dur seulement | [2](02-composant.md) |
| `:wake=view` · `:wake=interaction` | sur la balise d'un composant rendu par le serveur : il ne se réveille qu'à la vue, ou, avec `interaction` (en `ssr`, `ssr:markers` ou `prerender`), au premier signe d'intention (le pointeur qui y entre, aussi par le défilement sous une souris immobile, un doigt posé, le focus clavier), la page du serveur restant affichée jusque-là ; avant, comme une page qui démarre, un geste n'y est pas pris, ni rejoué (avec `view`, il ne le réveille pas plus tôt ; avec `interaction`, un geste rapide le réveille sans être pris : un clic fait en entrant, sous Chrome et Edge, un toucher très bref, sous Firefox et Safari) ; avec `view`, la saisie connaît le sort du démarrage et peut être perdue (en `ssr:markers`, gardée seulement quand la vue reprend le champ) ; le focus clavier sur un composant `view` le fait paraître, donc le réveille, et le champ perd le focus ; avec `interaction`, ce que l'utilisateur a fait dans la page du serveur passe à la vue, chaque élément à sa place dans le gabarit (focus et curseur, saisie, fichiers, case, option, `<details>`, zone défilée, pas un `contenteditable` ; un élément rebâti l'apprend par `input` et `change`), aussi quand le focus y est déjà au moment où il peut se réveiller (code arrivé après le premier Tab, `interaction` dans `interaction`) ; un élément que la vue n'a pas à sa place, le même (balise, attributs, texte, options : un contenu qui diffère entre le serveur et le navigateur, une liste dans un autre ordre), perd ce qui y a été fait, dit par la console du développement ; une balise sans boîte (`display: contents`), ou qui la perd en attendant, se réveille quand ce qu'elle affiche paraît, tout de suite si elle n'affiche que du texte, seul ou avec des éléments tous cachés (dit par la console du développement) ; les crochets du parent et de ses enfants dans l'ordre d'une page sans `:wake` ; sans effet, et dit par la console du développement, quand le composant qui l'affiche est reconstruit au client (en `ssr`, `positional`, `diff`, `prerender`, tout composant hors de la racine et des composants qui attendent ; partout, un bloc `{if}`) ; sans rendu serveur, aucun effet ; `:wake=interaction` réveillé comme `view`, sans rien reporter, en `ssr:positional` et `ssr:diff` ; `:wake=idle` refusé (écrivez `view`) | [19](19-ssr.md) |
| `:checked`, `:disabled`, `:open`… (les attributs booléens du HTML) | `:` accepté devant `value` et devant `checked`/`disabled`/`open`/`readonly`/`required`/`selected`/`hidden`/`multiple`/`autofocus`/`muted`/`autoplay`/`loop`/`controls`/`allowfullscreen`/`async`/`default`/`defer`/`formnovalidate`/`inert`/`ismap`/`itemscope`/`nomodule`/`novalidate`/`playsinline`/`reversed` — le même attribut que sans `:`, pas la forme à privilégier | [9](09-directives-dom.md) |
| `:html={…}` | injecte du HTML | [7](07-bindings.md) |
| `:text=!{$x}` | jumeau de `:html=!` pour du texte brut (`textContent`, two-way) | [7](07-bindings.md) |
| `<style :display="…">` | mode d'affichage du `:host` (seulement si ≠ `block`) — attribut du `<style>` de base, pas une directive de racine | [2](02-composant.md) |
| `<style :css="nom [autre…]">` | rattache une ou plusieurs feuilles de style partagées — attribut du `<style>` de base, pas une directive de racine | [2](02-composant.md) |
| `layout="nom"` | choisit un variant (sur une balise de composant) | [31](31-themes.md) |
| `@persist [session:/local:] $x [$y…]` | garde un état d'une visite à l'autre (plusieurs variables : espaces, jamais de virgule) | [3](03-reactivite.md) |
| `@routes` | déclare les routes CALCULÉES (boucle) → rend router-aware | [17](17-router.md) |
| `<routes target="…">` | table de routes FIXES (une par ligne, hors du `<script>`) pour l'outlet visé — alternative déclarative à `@routes` | [17](17-router.md) |
| `:preload` | préchargement (module ou lien) — `off`/`hover`/`on` | [17](17-router.md) |
| `@formAssociated` | la balise du composant devient un élément du formulaire (`form.elements`, `<label for>`, validité) ; `@@internals` donne ses `ElementInternals`, `$formDisabled` suit un `<fieldset disabled>` | [2](02-composant.md) |
| `@i18n 'a' ['b'…]` | les sections de traduction du module : la première préfixe les clés relatives de `µt` ; plusieurs noms sur la **même ligne** se demandent ensemble (requêtes parallèles, attente commune en mode `wait`, un enfant qui déclare l'une d'elles la trouve déjà chargée) et une clé relative se cherche dans l'ordre écrit, la première section qui la porte gagne | [29](29-i18n.md#plusieurs-sections) |
| `µt 'clé'`, `µt 'clé', n: 3` | `µt('clé')` sans parenthèses (Civet, CoffeeScript, expressions du gabarit) : même code produit ; dans `:confirm={ text: µt 'q' }` et `:title={ text: µt 'aide' }`, la clé seule (une clé à paramètres y garde ses parenthèses) | [29](29-i18n.md) |
| `@i18nPlaceholder wait\|key\|*skeleton\|*loader(…)` | ce que le module montre en attendant ses textes : rien, il attend caché puis paraît d'un coup (`wait`, défaut ; sans réponse au bout de 3 s, réglable par `i18n.timeout`, ou dès qu'un chargement échoue, il paraît avec des barres grises, `⟦clé⟧` en développement), le nom de chaque texte (`key`), des barres grises (`*skeleton`, réglage `color`) ou un effet de chargement à sa place (`*loader(bloom)`) ; le même choix pour toute l'appli : `"i18n": { "placeholder": … }` ; `auto` n'existe plus (erreur qui donne `*skeleton`) | [29](29-i18n.md) |
| `<style :viewTransition[.<nom>[={ direction/dir, duration/dur, priority/p }]]>` | transitions de **page** (View Transitions), cascade config→composant routeur→`<@view>`→page routée — attribut du `<style>` de base aux niveaux composant/page, pas une directive de racine ; syntaxe **objet** `{ clé: valeur }`, clés **longues** ou **courtes** mixables (jamais la même 2×) ; config = `"none"` (défaut) ou nom de préréglage (13 bases dont 8 directionnelles, direction **uniquement** via la clé `direction`/`dir` ; `duration`/`dur` = nombre NU en ms façon `setTimeout`, aucune unité ; iris/swipe/bars/blocks = rideaux « à travers le noir » en vrai DOM) ; forme nue (sans valeur) = activer avec héritage, réservée à l'attribut du `<style>` de base ; `.none` = coupé, à tous les niveaux. À ne pas confondre avec l'entrée suivante | [17](17-router.md) |
| `:viewTransition.nomMorph` (sur une balise ordinaire, sans options) | nom de **morph** partagé entre deux pages — un raccourci compilé vers `:style.view-transition-name=…`, posé directement sur la balise (`<img :viewTransition.hero>`) : ne fait **aucune** animation seul, il ne fait qu'apparier deux éléments identiques de part et d'autre d'une navigation. À ne pas confondre avec l'entrée précédente (la transition de page elle-même) | [17](17-router.md) |
| `:pageTransition` (lien) | transition de page hors routeur (swap de la zone de montage, cf. UJS) — même bibliothèque de préréglages, syntaxe **objet** comprise (`nom={ direction/dir, duration/dur }`) ; suffixe `nom:direction` refusé (build) comme aux autres positions, `priority`/`p` refusé ICI (cascade à 2 niveaux seulement, lien puis config) | [21](21-navigation.md) |
| `on`/`off` littéraux, la forme à guillemets (`:viewTransition="cube"`), le suffixe `nom:direction`, l'étiquette calculée (`:viewTransition={expr}`), l'étiquette conditionnelle (`:viewTransition{cond}="nom"`), et la forme **nue** sur une `<@view>` (`<@view main :viewTransition>`) | **erreurs** de compilation sur `:viewTransition`, quel que soit le niveau — nom calculé/conditionnel sur balise ordinaire → `:style.view-transition-name` | [17](17-router.md) |
| `:confirm="msg"` / `:confirm={text:, ok:, cancel:}` | confirmation avant navigation/soumission (`µ.confirm` — branché par `µ.config.confirm` : `true` *(défaut)* = modale maison `µ.modal.fire`, `false` = `window.confirm`) → `mjs-confirm` ; forme objet = boutons habillés | [6](06-evenements.md), [21](21-navigation.md) |
| `:method="verbe"` | lien à verbe HTTP (delete/post/put/patch) → `mjs-method` | [6](06-evenements.md), [21](21-navigation.md) |
| `:callback="nom"` | rappel appelé sur une navigation qui aboutit (jamais 422/échec/popstate) → `mjs-callback` | [6](06-evenements.md), [21](21-navigation.md) |
| `:flash="popup"` / `"console"` / `"silent"` | politique d'affichage de `flash`/`error` PAR ÉLÉMENT (prime sur `µ.config.flash`) → `mjs-flash` | [21](21-navigation.md) |
| `:title="texte"` / `:title={…}` | info-bulle universelle (survol + focus clavier) → `mjs-title` | [30](30-modules-coeur.md) |
| `.global` · `.shared` | modificateurs d'une transition, sur la directive (`:transition.global=*slide`) : `.global` anime aussi quand c'est un bloc parent qui apparaît ou disparaît ; `.shared` mutualise l'animation (un seul `@keyframes` pour toutes les balises) | [10](10-transitions.md) |
| `:childtransition="all"` | cascade de sortie depuis un ancêtre — attend la sortie des descendants avant de retirer le DOM | [10](10-transitions.md) |
| `{if …}` · `{for … by}` · `{key}` · `{await}` · `{const}` | blocs template | [5](05-blocs.md) |
| `{await.keep expr}` | pendant une relecture, la branche `{success}` affichée reste avec sa valeur, puis se met à jour sur place (`µpending` vrai pendant ce temps) | [5](05-blocs.md) |
| `{? timer}` · `{? a, b}` · `{? default}` · `{else}` · `{end}` | un morceau du HTML réservé à un modèle (`layout`) du composant | [31](31-themes.md) |

---

## Commentaires

Tous retirés dès le début de la compilation, en développement comme en production ; seule exception, `//! texte` (script ou `<style>`), gardé dans le code produit — voir [02 · Les commentaires](02-composant.md#les-commentaires).

## Alias clavier ASCII (claviers sans `§`)

Option `contextAlias: true` dans `mjs.config.json` (désactivée par défaut) — les formes `§`/`§§` restent canoniques.

| Canonique | ASCII |
|---|---|
| `§theme` | `__context.theme` |
| `§§x` | `__shared.x` |
| `$$x` / `µ$$x` | *déjà en ASCII* |

---

## Sortes de fichiers

Tout le code que MJS compile finit par `.mjs` ; un `.civet`, un `.coffee` ou un `.js` ordinaire est une bibliothèque.

| Fichier | Ce que c'est | Ce que MJS en fait |
|---|---|---|
| `nom.mjs` | composant | compilé en `<mjs-nom>`, publié `nom-<empreinte>.js` |
| `_nom.mjs` | partiel | inclus par `<@include>`, jamais un composant |
| `nom.variante.mjs` | modèle du composant `nom` | posé à côté de `nom.mjs`, lu avec lui |
| `Nom.class.mjs` | classe globale | lue partout en `µNom`, sans import |
| `nom.types.mjs` | types déclarés | lus par `type:` dans tout le projet |
| `nom.theme.mjs` | thème | ses variables, choisies par `defaultTheme` |
| `nom.effects.mjs` | effets de l'appli | lus par les directives `*effet` |
| `nom.civet.mjs`, `nom.coffee.mjs` | module MJS en Civet, en CoffeeScript | µ, runes, `@import`, `type:` ; publié `nom-<empreinte>.js`, jamais un composant |
| `nom.js.mjs` | module MJS en JavaScript | µ, `@import`, `type:` ; publié `nom.js-<empreinte>.js` |
| `nom.server.mjs` | entrée serveur (`ws.server.mjs`, `game.server.mjs`) | compilée pour Node, jamais servie |
| `nom.civet`, `nom.coffee` | bibliothèque | compilée par son seul langage, publiée `nom-<empreinte>.js` ; µ, une directive ou le dialecte de MJS y arrêtent la construction, chacun nommé à sa ligne (nommez-la `nom.civet.mjs`) ; ses imports relatifs, extension comprise (`./rng.civet`), mènent au nom à empreinte ; un chemin sans extension, ou écrit depuis `sourceDir` sans `./`, arrête la construction |
| `nom.js` | bibliothèque | copiée telle quelle sous son nom à empreinte ; µ y arrête la construction (nommez-la `nom.js.mjs`) |
| `ws.civet`, `game.civet` | entrée serveur en Civet brut | compilée par Civet seul |
| `app/modularjs/manifest.civet` (`.coffee`) | manifeste externe | ses `#= require` concaténés |
| `.sass`, `.scss`, `.css` | styles | compilés, feuilles partagées publiées à part |
| `i18n/<langue>/*.yml` | traductions | lues par `µt` |
| images, polices, sons | assets | copiés sous leur nom à empreinte quand `µasset` les cite |
| `mjs.config.json` | configuration | lue par `mjs build`, `mjs dev`, `mjs check` |
| `node_modules/.cache/mjs/build/` | cache de `mjs build --cache` | ne recompile que les fichiers changés, production comprise, sortie identique à l'octet ; `--cache=verify` la compare à une construction complète ; se vide par `rm -rf node_modules/.cache/mjs/build` (cf. [32](32-cli-et-configuration.md)) |

## Langages source — `languages`

```json
{ "languages": { "script": "civet", "template": "civet" } }
```

`script` = langage des `<script>` sans `lang=` (≡ `defaultScriptLang`) ; `template` = grammaire des interpolations `{…}`/handlers inline (`"civet"`, la seule valeur ; `"js"` est refusé : retirez le réglage). `.coffee` est pris en charge, sans avertissement (script `lang="coffee"`, fichier importé par `@import`). Détails : [2 · Anatomie d'un composant](02-composant.md).

## SSR — moteur de rendu

```json
{ "render": { "engine": { "prerender": "browser", "request": "happy-dom" },
               "browserPool": { "size": 2, "keepAlive": true, "maxAgeMs": 300000 },
               "forwardOrigin": true, "target": "main", "method": "update", "cache": "revalidate" } }
```

`engine` : `'browser'` (Playwright, fidélité max) ou `'happy-dom'` (léger) — par axe (`prerender`/`request`) et surchargeable **par route**. `browserPool` : réutilisation des instances Chromium (moteur `'browser'`). `forwardOrigin` : transmet origine + cookies au SSR par requête (défaut `true`). `allowedOrigins` : origines admises à soumettre un `POST` — absent = same-origin strict, tableau = ces origines en plus, `["*"]` = tout accepter (comme `false`, qui coupe le contrôle). `target` (sélecteur CSS, absent → `<body>`), `method` (`'update'` défaut, `'replace'`, `'append'`) et `cache` (`'cache-first'` défaut, `'revalidate'`, `'no-cache'`) : contenant, méthode et politique de cache de la navigation, réglages GLOBAUX, aucun réglage par route — alimentent aussi bien la fiche JSON que les en-têtes `X-MJS-Target`/`X-MJS-Method`/`X-MJS-Cache` posés sur les réponses HTML. Détails : [19 · SSR](19-ssr.md).

**Champs de formulaire** : la page rendue (les deux moteurs) porte l'état courant de chaque champ — `value` des champs de saisie, `checked` des cases et radios, `selected` de l'option choisie, texte d'un `<textarea>` —, à toute profondeur ; seul l'écart avec le balisage est écrit, jamais un mot de passe ni un fichier. Un curseur lié à une variable s'affiche donc à sa place avant le démarrage du JavaScript, sauf si sa valeur n'existe qu'après `µmount`. Après la reprise (`markers`, `positional`, `diff`), `reset` ramène chaque champ à la valeur écrite par le serveur ; en `replace`, aux valeurs du balisage du composant. Un retour chariot dans une zone de texte s'écrit en saut de ligne.

**Navigation JSON** : l'en-tête `X-MJS-Nav` sur une requête de page renvoie `{ module, props, url, title, version, target, method, cache }` au lieu du HTML (`Vary: X-MJS-Nav`, `version` aussi en en-tête `X-MJS-Version`). `mjs serve` et `mjs dev` alimentent `props` et gèrent les soumissions via `render.entry` → `serve.server.mjs` (`props`/`actions` par route, mêmes patterns que `render.routes`). Formulaire : succès → **303** + `Location`, échec de validation → **422** (même JSON, `errors` dans `props`). Côté client : composant monté dans le contenant que désigne `target` (sélecteur CSS, sinon `<body>`), selon `method` : `'update'` (défaut, contenant vidé mais conservé), `'replace'` (le module prend la place du contenant), `'append'` (le module s'ajoute à la suite, l'état accumulé du contenant partant au cache comme les autres) ou `'none'` (rien n'est installé, `props` fusionnées dans `µres` au lieu de remplacer le sac) ; `title` devient le titre de l'onglet si renseigné, sauf dernier mot d'un `<@head><title>` de composant ; `props` exposées par la rune réactive `µres`. Le champ `reload` (ou l'en-tête `X-MJS-Reload`) fait partie du vocabulaire du protocole — il recharge la page entière plutôt que d'installer quoi que ce soit — mais seul un back applicatif l'émet : `mjs serve` ne le pose jamais. Détails : [21 · Navigation](21-navigation.md) (protocole, § *Le `<head>` suit la navigation* et § *Les cinq issues d'une réponse*), [19 · SSR](19-ssr.md) (chargeurs).

**Reprise en main avec `js: 'split'`** : la page rendue par le serveur attend que les fichiers de tous les composants qu'elle affiche (enfants, petits-enfants, composants légers) soient arrivés, puis les démarre d'un seul geste, du parent vers les enfants — aucune image sans sous-bloc, aucun enfant affiché avec ses réglages par défaut. Elle reste affichée en attendant, plafond d'une demi-seconde : un fichier en échec ne la retient pas, un fichier qui n'arrive pas la retient jusqu'au plafond et prend la main à son arrivée. Sans effet en `js: 'bundle'`, sans rendu serveur, ni pour un composant que la page du serveur n'affiche pas.

## Politique de cache de page — `render.cache`

| Valeur | Effet |
|---|---|
| `cache-first` *(défaut)* | La page hiberne normalement dans `µ.pageCache`. |
| `revalidate` | Cache-hit affiché immédiatement, vérifié en fond (contenu remplacé seulement si la réponse diffère). |
| `no-cache` | Jamais archivée : le retour arrière re-demande toujours la page (le scroll, lui, reste mémorisé). |

Trois canaux, précédence fixe : en-tête `X-MJS-Cache`/clé `cache` de la fiche (mode JSON) > balise `<meta name="mjs-cache" content="...">` lue dans le document reçu (mode HTML) > `render.cache` (défaut de config, déjà repris dans les deux canaux précédents par `mjs serve`). Juste avant d'archiver une page (hors `no-cache`), MJS émet sur `document` un `mjs:before-cache` (`detail: { path, zone }`) — dernier moment pour refermer ce qui ne doit pas ressortir hiberné (modale ouverte, menu déplié). Détails : [21 · Navigation](21-navigation.md).

## Événements de cycle de navigation

Trois événements de cycle, émis sur `document` (jamais le composant), pour toute navigation UJS — aucune émission sur une route hash `#/x`.

| Événement | Quand | Détail |
|---|---|---|
| `mjs:before-visit` | avant tout effet de bord — **seul annulable** (`e.preventDefault()`) | `path`, `url`, `via` |
| `mjs:visit` | la navigation est engagée | `path`, `url`, `via` + `cached` |
| `mjs:load` | le contenu est en place — aussi au premier chargement (`initial: true`, `via: 'initial'`) | `path`, `url`, `via`, `zone` + `initial` |

Ordre complet : `before-visit` → `visit` → `before-cache` → `load`. Détails : [21 · Navigation](21-navigation.md).

## Éléments permanents — `:permanent`

Directive nue (`:permanent`, compile en attribut `mjs-permanent` — l'écrire directement reste valide) posée, avec un `id` stable identique des deux côtés, sur un élément qui doit traverser une navigation sans être recréé (lecteur audio, chat, panneau à défilement propre) : le nœud vivant est transplanté à la place de son homologue dans la page qui arrive, `id` par `id` — jamais par une valeur (`:permanent="nom"` refusé au build). Sans `id` : ignoré, avertissement une fois par élément. Absent côté page qui arrive : détruit normalement avec le reste. Compatible `µ.pageCache` (retour arrière). Détails : [21 · Navigation](21-navigation.md).

## Barre de navigation — `µ.config.navProgress`

| Valeur | Effet |
|---|---|
| absent / `true` *(défaut)* | un trait de lumière en haut de la page si la navigation (lien, formulaire, page du routeur) dépasse 500ms |
| un nombre | même chose, avec ce seuil en ms |
| `{ delay, place }` | le seuil, et `place: 'bottom'` pour la barre en bas |
| `false` | rien n'est inséré, rien ne tourne |

Allure en CSS : `--mjs-nav-progress-color` (`#58a6ff`), `-height` (`3px`), `-speed` (`1.2s`), `-zindex` ; une règle sur `.mjs-nav-progress` l'emporte sur le défaut. `µnav.active` reste la primitive pour une barre construite à la main. Détails : [21 · Navigation](21-navigation.md).

## Le `<head>` suit la navigation — `µ.config.navHead`

Titre et métadonnées pilotées (`<title>`, `description`/`keywords`/`robots`/`author`, `og:*`/`twitter:*`/`article:*`, `canonical`) suivent la page affichée, réconciliées par clé — jamais les styles ni les scripts. Un composant qui déclare son propre `<@head><title>` garde le dernier mot sur celui du serveur.

| Valeur | Effet |
|---|---|
| `true` *(défaut)* | le `<head>` suit chaque navigation |
| `false` | rien du `<head>` n'est appliqué, ni titre ni métadonnées |

Détails : [21 · Navigation](21-navigation.md) § *Le `<head>` suit la navigation*.

## Garde anti-boucle sur un composant introuvable — `µ.config.staleReload`

Un import de composant qui échoue après un déploiement (fichier haché disparu du manifeste) déclenche un rechargement complet de la page, borné à un seul rechargement par version de build (drapeau `sessionStorage`). La preuve vient du serveur : le fichier redemandé revient sans module JavaScript (404, page HTML) ; un échec sans réponse (réseau, départ du visiteur) ne recharge jamais, ni un échec survenu après l'annonce d'un départ.

| Valeur | Effet |
|---|---|
| `true` *(défaut)* | un import qui échoue, et dont le serveur répond sans module (404, page HTML), recharge la page, une fois par version de build |
| `false` | l'échec d'import redevient un simple message en console, sans rechargement |

Détails : [21 · Navigation](21-navigation.md) § *Composant introuvable après un déploiement*.

## Sons de la modale — `µ.config.modalSound`

| Valeur | Effet |
|---|---|
| `false` *(défaut)* | silence total |
| `true` | 4 signatures WebAudio embarquées (`success`/`error`/`warning`/`info`) + un ping pour `notify()` |
| objet `{ type: 'fichier' }` | fichier par type ; type absent de l'objet → repli signature embarquée |

Surcharge par appel : `{ sound: false }` (silence), `{ sound: 'error' }` (signature nommée) ou `{ sound: '/chemin.mp3' }` (fichier) — prioritaire sur la config globale. Politique autoplay respectée : silencieux avant le premier geste utilisateur, jamais une erreur. Détails : [6 · Événements](06-evenements.md).

## Position des toasts — `µ.config.notifyPosition`

| Valeur | Effet |
|---|---|
| `'top-right'` *(défaut)* | coin haut-droit |
| `'top-left'` / `'bottom-right'` / `'bottom-left'` | les trois autres coins |
| `'quarter-top-right'` / `'quarter-top-left'` / `'quarter-bottom-right'` / `'quarter-bottom-left'` | ancré à 25&nbsp;% de la hauteur, côté haut ou bas |
| objet `{ top?, right?, bottom?, left? }` | placement libre, en longueurs CSS (`'80px'`, `'2rem'`…) |

Une pile ancrée en **bas** empile ses toasts vers le **haut** — l'inverse d'une pile ancrée en haut. Relu à chaud (un changement s'applique à la prochaine notification). Détails : [6 · Événements](06-evenements.md).

## Durée des toasts — `µ.config.notifyDuration`

| Valeur | Effet |
|---|---|
| `4000` *(défaut, ms)* | durée avant retrait automatique |
| `0` | tous les toasts deviennent permanents par défaut |

`opts.duration` posé sur un appel `notify()` précis prime sur ce réglage global ; `0`, au global comme par appel, retire barre de vie et auto-fermeture (seuls la croix, `close()`, le clic sur un toast cliquable ou le glisser retirent le toast). Détails : [6 · Événements](06-evenements.md).

## Pause du décompte des toasts — `µ.config.notifyPause`

| Valeur | Effet |
|---|---|
| `true` *(défaut)* | le survol (souris, stylet) et le focus dans le toast arrêtent le minuteur et la barre de vie ; ils repartent avec le temps restant |
| `false` | le décompte continue quoi qu'il arrive |

`pause` posé sur un appel `notify()` précis prime sur ce réglage global ; une valeur non booléenne vaut l'absence d'option. Un toast permanent (`duration: 0`) n'a rien à figer. Détails : [6 · Événements](06-evenements.md).

## Glisser pour fermer un toast — `µ.config.notifySwipe`

| Valeur | Effet |
|---|---|
| `true` *(défaut)* | on tire le toast à l'horizontale (doigt, souris, stylet) : au-delà de 80 px (ou 35 % de sa largeur, ou un lancer rapide) dans le sens de l'ancrage de la pile, il sort en glissant et se ferme comme par la croix ; en deçà, il revient |
| `false` | aucun glisser |

`swipe` posé sur un appel `notify()` précis prime sur ce réglage global ; une valeur non booléenne vaut l'absence d'option. Préréglage à droite : vers la droite ; à gauche : vers la gauche. Position libre : `left` et `right` posés à la fois, ou aucun : les deux ; un seul posé : les deux sens si le milieu de la pile est dans le tiers central de la fenêtre, sinon le bord le plus proche. Détails : [6 · Événements](06-evenements.md).

## File des toasts — `µ.config.notifyMax`

| Valeur | Effet |
|---|---|
| `5` *(défaut)* | 5 toasts affichés au plus en même temps |
| `false` / `0` / `Infinity` | aucun plafond de nombre — seule la place à l'écran borne la pile |
| un nombre | ce plafond, relu à chaque affichage |

Au-delà, les toasts suivants attendent en file FIFO et s'affichent quand une place se libère — zéro éviction, un toast déjà affiché n'est jamais chassé. La place réellement disponible dans la fenêtre est un **second plafond, toujours actif** : le plafond réel est le plus bas des deux, la pile ne déborde donc jamais de l'écran (un toast seul, lui, s'affiche même s'il dépasse). Détails : [6 · Événements](06-evenements.md).

## Sens du flux des toasts — `µ.config.notifyFlow`

| Valeur | Effet |
|---|---|
| `'auto'` *(défaut)* | le préréglage de position décide (ancrage bas = vers le haut, sinon vers le bas) |
| `'up'` | le nouveau toast arrive au-dessus des précédents |
| `'down'` | le nouveau toast arrive en dessous |

L'ordre d'empilement, pas le sens de croissance (dicté, lui, par l'ancrage). Utile surtout pour un placement libre `{ top, bottom… }`. Détails : [6 · Événements](06-evenements.md).

## Toast cliquable — `µmodal.notify(message, { href, onClick })`

`href: '#/badges'` : le toast entier est un lien (Tab, Entrée), fermé quand on le suit. `onClick: fn` : le toast entier est un bouton (Entrée, Espace), `fn(événement)` puis fermeture. Les deux : un lien, `onClick` d'abord (`event.preventDefault()` le retient). La croix ferme à part. États : `--mjs-toast-hover-bg`, `--mjs-toast-hover-border` (filet du survol, transparent par défaut), `--mjs-toast-active-bg`, `--mjs-toast-focus`. Une règle de balise de votre CSS (`button { … }`) n'y touche pas. Le second clic d'un double clic ne déclenche pas le toast qui remonte à la place du premier (400 ms, pas au clavier). `href` vide ou fait d'espaces : comme sans `href`. Détails : [6 · Événements](06-evenements.md).

## Le veilleur `flash`/`error` — `µ.config.flash`

| Valeur | Effet |
|---|---|
| `'popup'` *(défaut)* | `flash` → toast (`µ.modal.notify`), `error` → modale bloquante (`µ.modal.error`) |
| `'console'` | `console.info`/`console.error` |
| fonction `(type, message) -> …` | branchement personnalisé |
| `false` | veilleur coupé — les clés `flash`/`error` d'une réponse traversent intactes jusque dans `µres` |

Par élément : `:flash="popup"` / `"console"` / `"silent"` (attribut compilé `mjs-flash`), posée sur le lien ou le formulaire déclencheur — prime sur la config globale pour cette navigation précise. Détails : [21 · Navigation](21-navigation.md).

## Infobulle universelle — `µ.config.title`

```js
µconfig.title = { delay: 400, side: 'top', dur: 150, transition: 'fade' }
```

Défauts appliqués à tout `:title` du projet, surchargeables par élément via la forme objet de la directive. Détails : [30 · Modules cœur](30-modules-coeur.md).

## Runtime à la carte (taille du bundle)

Option `runtime` dans `mjs.config.json` — tree-shake du bundle core : les modules **optionnels** se choisissent par `"all"`, `"core"` ou une liste ; sans clé `runtime`, ceux dont le projet se sert sont repérés dans son code compilé (`easing` est en plus joint dès qu'une transition est écrite : voir son entrée plus bas) ; quarante-six éléments du cœur suivent chacun une règle propre, décrite juste après le tableau des valeurs :

| Valeur | Effet |
|---|---|
| *(clé absente)* | cœur + les modules optionnels repérés dans le code du projet (cf. juste dessous) |
| `"all"` | cœur + tous les modules optionnels ; les éléments du cœur qui suivent l'usage (cf. plus bas) le suivent encore, sauf quand leur entrée dit que `"all"` les garde |
| `"core"` | cœur seul : `init`, `runes`, `autoloader`, `element` (en `js: "bundle"`, l'autoloader n'en fait pas partie — cf. ci-dessous) |
| `["router", "ajax", …]` | cœur + ces modules optionnels |

`"all"` ne garde donc pas tout ce qu'un composant compilé par une autre construction pourrait appeler (`{if}`, `:attach`, une valeur dérivée…) : compilez un tel composant dans la même construction que l'appli.

Sans clé `runtime`, un module optionnel n'entre que si le code compilé du projet s'en sert : `µ.modal`, `µ.socket` (`socket`, qui emmène `schema` : un serveur temps réel qui déclare un schéma encode ses messages en binaire sans regarder ce que la page sait lire), `µ.ajax.binary` (`ajax` et `schema`), `sock.game`, `µspring`, `:flip`, `<@view>` (`router`, qui emmène `ujs`), un lien interne ou un formulaire d'un composant, `:method`, `:confirm` (`ujs`, qui emmène `router`, et `ajax` et `modal` quand le projet navigue vers le serveur : un lien ou un formulaire hors des routes `#/…`, du HTML brut, `location.assign(`, un attribut de la navigation, des vues serveur ou un réglage de navigation ; une appli à routes `#/` seules s'en passe, comme des rideaux de `:viewTransition`, qui n'entrent qu'avec une transition écrite ou la navigation vers le serveur), un effet en direct `*follow`, `*cursors`, `*react`, `*heatmap` (`socket`, même quand `server:` ouvre sa connexion), `*travel`, `*path`, `*flipcard` (`easing`, où se lit une courbe nommée comme `bounce-out`)… Le nom se lit après le point : un accès d'où il ne se tire pas — `µ[nom]`, `{ ajax } := µ`, `µ` passé à une fonction ou rangé dans une variable — garde tous les modules optionnels, comme `"all"`, et l'information `runtimeHint` donne le fichier et la ligne de cet accès. Un usage qui ne laisse aucune trace dans les sources — la navigation d'une vue serveur, `:confirm` écrit dans son HTML, un toast, une modale, une requête ou une traduction lancés par un script de la page — n'est pas vu : par prudence, `ujs`, `router`, `ajax`, `modal`, `vault` et `journal` restent dès que le projet a des vues serveur (un bloc `render`, ou un dossier `app/views`, `resources/views`, `templates` ou `views` à côté de `mjs.config.json`), et `ujs` (avec `router`, `ajax` et `modal`) dès qu'un réglage de navigation est écrit (`anchorHistory`, `viewTransition`, `preload`). Des liens vers le serveur posés par la page hôte ou un script extérieur ne sont pas lus : sans `ajax`, ils partent par le navigateur, et le développement vous dit une fois d'ajouter `"ujs"`, `"ajax"` et `"modal"` à la liste `"runtime"`. Un `href` dont le début écrit est `#` (`href="#/item/{$id}"`) est une route de la page ; un `href` dont le début ne se connaît qu'à l'exécution (`href={$url}`) compte comme une navigation vers le serveur. Une liste `runtime` écrite garde les rideaux. Un lien posé par `setAttribute('href', '/x')`, ou `µ.viewTransition` réglé par un script de la page, n'est pas vu : ajoutez `ajax`, `modal` ou `vt_presets` à la liste `runtime`. Ce qui reste de côté est nommé à chaque construction (information `runtimeHint` ; un module emmené par un autre, comme `easing` sous une transition, y compte comme gardé, et chaque module repéré dit pourquoi il est gardé), avec la liste gardée prête à coller (aucune quand rien n'est gardé : `"runtime": []` est un cœur nu, sans les outils de développement ; aucune non plus quand un module gardé ne s'écrit dans une liste que par le préréglage du même nom, qui en emmène un autre — `chat`, `accounts` et `lobby` emmènent `smooth` —, et l'information dit pourquoi) : si une page servie hors construction, ou un serveur temps réel qui parle à la page, se sert d'un module que le code de la page ne montre pas, écrivez cette liste complétée des modules qu'il faut en plus, ou `"runtime": "all"`, qui garde tous les modules optionnels.

`µload` (le magasin qui se charge seul) n'entre au cœur que si le code de l'appli l'appelle, et emmène `ajax` ; une liste `runtime` écrite à la main doit nommer `ajax`, sinon la construction le signale.

En production, les aides d'écriture du cœur n'entrent que si un composant de la construction, ou un module du cœur qu'elle emporte, s'en sert : la mise à jour d'un attribut calculé (`title={…}`, `class={…}`, la valeur d'un `<select>`, d'un champ ou d'une case) et le filtre des attributs à risque qu'elle appelle, la prop posée sur un composant enfant pas encore défini, le texte calculé à la racine du gabarit, l'appel et la suppression profonds (`$l.push(x)`, `delete $o.a`) avec l'état lu comme une valeur (`Object.assign($, …)`), la défaite des attaches et des références (`:attach`, `:this`), la plus longue suite croissante des listes, la copie des écouteurs d'une balise remplacée (`<@element>`), l'index des liaisons filtrées quand plusieurs lignes portent la même valeur, la copie d'avant de `µinspect`, la case écrite sans rendu (`µwrite`) ; ce que le rendu serveur relit d'un composant n'entre qu'avec une construction qui peut rendre côté serveur. Une application qui n'écrit qu'une liste de textes et des classes basculées (`:class{…}`) n'en garde qu'une : la plus longue suite croissante, dont se sert sa liste. Le développement les garde toutes ; `"runtime": "all"` aussi, sauf les écritures profondes, que garde `"runtime": ["deep"]`, et l'index des liaisons filtrées, qui suivent toujours ce que le code compilé écrit.

Neuf éléments du cœur ne sont embarqués que s'ils servent : `title` (bulles `:title` — embarqué dès qu'une source du projet, `.mjs`/`.civet`/`.coffee`, pose `:title` ou l'attribut `mjs-title` ; un attribut posé uniquement côté serveur, par une vue Rails par exemple, n'est pas vu : le demander explicitement, `"runtime": ["title"]`) ; `vt_presets` (préréglages de `:viewTransition` — embarqué avec `router` ou `ujs`, à demander explicitement sinon) ; `nav_progress` (la barre de navigation, le trait de lumière d'un changement de page qui tarde — même règle : embarquée avec `router` ou `ujs`, `"runtime": ["nav_progress"]` sinon) ; `store` (la classe `µStore`/`µ.Store` — embarqué dès qu'une source du projet pose `new µStore(…)`/`new µ.Store(…)` ; un nom fabriqué à l'exécution, ou posé par un composant que la construction ne lit pas, se demande par `"runtime": ["store"]` ; un script de page, lui, ne trouve pas `µ` en production) ; `interpolate` (`µinterpolate`/`µ.interpolate` — même règle, `"runtime": ["interpolate"]` dans les mêmes cas) ; `lazy_css` (`css: "lazy"` — signal de CONFIGURATION pure, jamais de scan) ; `page_cache` (cache de pages hibernées et libellés du routeur/UJS/modale — embarqué dès que `router`, `ujs` ou `modal` est sélectionné, signal de configuration lui aussi) ; `hydrate` (adoption du DOM rendu par le serveur — embarqué dès qu'une page du bloc `render` demande `ssr:markers`, `ssr:positional` ou `ssr:diff`, par `render.default` ou par le `mode` d'une route ; `csr`, `prerender` et `ssr`/`ssr:replace` n'adoptent rien. Un serveur qui rend par l'API, sans bloc `render`, le demande par `"runtime": ["hydrate"]`) ; `autoloader` (découverte des balises `mjs-*` et chargement à la demande de leur fichier — **du cœur en `js: "split"`**, retiré en `js: "bundle"` où le fichier unique définit lui-même tous les composants avant de rendre la main ; une balise `mjs-*` inconnue y est signalée en console par un contrôle unique. `"runtime": ["autoloader"]` le remet, par exemple pour une page qui insère des balises servies par un autre build).

Quarante autres (collections de l'état, balises globales, balises dynamiques, runes rares, `µinspect`, `µplay`, `µ.state`, registre de l'état partagé, champ nombre lié à saisie refusée, clic et survol du contenu glissé, `µ.elementAt`, `µ.adoptSheet`, `µclone`, remise à zéro des formulaires, calculs des graphiques, blocs structurels du HTML, crochets de cycle de vie, contexte, émission d'événement, variantes de mise en page, transitions/teardowns, interpolation brute, slots indexés, mutations profondes, échappement HTML, alias court de balise, types et valeurs permises, effets) suivent la même logique — jamais un faux négatif : dans le doute, le compilateur garde le module. Chacun, sauf `chart`, se demande aussi explicitement (`"runtime": ["head"]`, etc.), utile si l'usage échappe au scan de `sourceDir` (les cas sont détaillés sous le tableau) :

| Module | Embarqué dès que le projet écrit… |
|---|---|
| `head` | `<@head>` |
| `body` | `<@body>` ou `<@html>` |
| `dynamic` | `<@element>` ou `<@module>` — en production, chacune n'emmène que sa partie : une appli qui n'écrit que `<@element>` ne porte pas le code de `<@module>`, et l'inverse ; `runtime: "all"` ou `"dynamic"` dans la liste gardent les deux |
| `collections` | `Map`, `Set`, `WeakMap` ou `WeakSet` nommé dans le code d'un composant, d'un module ou d'un fichier `.js` importé — le suivi des clés objets des collections de l'état, et l'enveloppe des `WeakMap` et `WeakSet` quand l'un des deux est nommé ; une collection donnée par une bibliothèque chargée à part garde sans lui un comportement plus simple, sans erreur ([03](03-reactivite.md)) : demandez-le alors par `"collections": true` dans `mjs.config.json`, qui l'ajoute sans toucher au repérage des autres modules ; par son nom dans une liste `runtime`, seulement si vous en écrivez déjà une — écrit seul, il retirerait les modules optionnels repérés |
| `rare_runes` | `µraw`, `µsnap` (l'opérateur `=:`) ou `µimport` — un seul fichier pour les trois ; nommée dans la liste, elle garde aussi la part de `µraw(liste, true)`, que la construction ne joint sinon qu'à l'appli dont le code écrit cet appel |
| `inspect` | `µinspect` — le suivi d'une variable dans la console, et l'affichage de ses changements |
| `play` | `µplay` — jouer une classe d'animation sur un nœud ; un appel écrit dans un attribut `onclick="…"`, une adresse `javascript:…` ou un `setAttribute('onclick', …)` n'emmène pas le module, et `µ` n'y existe pas en production : appelez `µplay` depuis le `<script>` du composant ou un gestionnaire `@click` |
| `state` | `µ.state(…)` ou l'écriture `µ$x = …` — l'objet réactif ; joint aussi dès que le contexte réactif `§§`, le store global (`vault`, module cœur à libellé) ou l'un des modules `router`, `smooth`, `socket`, `game`, `chat`, `lobby`, `accounts`, `interp`, `predict`, `lockstep` est du bundle (ils en bâtissent un) |
| `runes` | `µ.state(…)` ou un store (`µ.Store`) — le registre des dépendances de l'état partagé, qui relit les composants abonnés quand une clé change ; il suit `state` et `store`, partout où ils partent |
| `refuse` | un champ lié `value=!{$x}` dont le type est `number`, ou donné par une variable — la saisie incomplète (« 1. », « - ») que le navigateur ne lit pas, retenue pour que l'écriture du code la remplace ; un champ au type fixe autre (`text`…), une case à cocher ou un champ sans `type` n'en ont pas besoin. Un `type` posé par un script de page que la construction ne lit pas : `"runtime": ["refuse"]` |
| `slot_events` | un `<slot>` dans un gabarit (`<@slot>` ou `<slot>`, y compris dans un `{if}`, un `{for}`, un `{await}` ou un `{key}`) — le routage du clic et du survol du contenu glissé dans un composant ; un projet sans aucun `<slot>` n'en a pas besoin. Un `<slot>` créé par un script de page que la construction ne lit pas : `"runtime": ["slot_events"]` |
| `boundary` | `@pointerenter`, `@pointerleave`, `@mouseenter` ou `@mouseleave` écrit dans un gabarit — l'entrée et la sortie de survol, lues sur l'événement jumeau qui remonte ; un projet qui n'en écrit aucun n'en a pas besoin. Un de ces événements posé par un script de page que la construction ne lit pas : `"runtime": ["boundary"]` |
| `element_at` | `µ.elementAt(x, y)` — l'élément le plus profond sous un point de la fenêtre, depuis le `<script>` d'un composant (`window.µ` n'est exposé qu'en développement : un script de page ne l'y trouve plus en production) ; joint aussi dès qu'un des effets `*follow`, `*heatmap` ou `*cursors` est écrit (ils s'en servent). Un appel dont le nom est fabriqué à l'exécution (`µ['element' + 'At']`) ou posé par un composant que la construction ne lit pas : `"runtime": ["element_at"]` |
| `adopt_sheet` | `µ.adoptSheet(balise, feuille)` — coller une feuille de style dans l'ombre d'un composant, depuis le `<script>` d'un composant (`window.µ` n'est exposé qu'en développement : un script de page ne l'y trouve plus en production). Un appel dont le nom est fabriqué à l'exécution (`µ['adopt' + 'Sheet']`) : `"runtime": ["adopt_sheet"]` |
| `clone` | `µclone el` ou `µ.clone(el)` — copier un composant avec son état, ou en poser un miroir vivant (`mirror: true`) ; le mot `clone` écrit par le projet suffit (une méthode `clone` d'une autre bibliothèque le joint aussi, sans autre effet que son poids). Un nom fabriqué à l'exécution (`µ['clo' + 'ne']`) : `"runtime": ["clone"]` |
| `form_reset` | un module de saisie du cœur : `<@@checkbox>`, `<@@switch>`, `<@@radio>`, `<@@number>`, `<@@gauge>`, `<@@knob>`, `<@@select>`, `<@@field>` ou `<@@editor>` — la remise à zéro d'un formulaire (bouton « Réinitialiser », `form.reset()`), écrite une seule fois pour ces neuf modules : un formulaire n'écoute qu'une fois, quel que soit le nombre de champs ; une appli sans module de saisie n'en a pas besoin |
| `types_select` | une `<@@select>` liée à une variable de règle (`value=!{$x}`, `$x` ayant un type dans le `<vars>`) — le jugement de chaque choix, le même que celui d'une liste native `<select>` ; une appli dont les listes du cœur sont liées à des variables libres, ou qui n'a que des listes natives, n'en a pas besoin |
| `types_ajax` | un appel `µajax url, type: Reward[]` — la réponse contrôlée une fois, à son arrivée, par la règle nommée (`µTypeError`, `typeError`) ; une appli qui n'écrit `type:` dans aucun appel n'en paie pas un octet |
| `chart` | `<@@chart>` — les calculs des graphiques : échelles, statistiques, tracés ([39](39-graphiques.md)). Le seul de la table qui ne se demande pas : seul le module de graphique s'en sert, et il les fait toujours venir ; `"runtime": ["chart"]` arrête la construction (module inconnu) |
| `on` | `µon` — délégation d'événement manuelle |
| `effect` | `µeffect` — ou une syntaxe qui s'appuie dessus SANS jamais écrire le mot « effect » : `@persist`, `µdebug $x`, `<@head>`, `<@body>`/`<@html>`, `<@element>`/`<@module>`, `<@window scrollX|scrollY=!{…}>` |
| `every` | `µevery`, `µafter` — minuteries de composant |
| `ticker` | `µ.Ticker` (boucle rAF partagée) — ou dès que `spring`/`smooth`/`interpolate` est du bundle : les trois s'en servent sans aucune garde |
| `failed` | `<@failed>`, ou `µfailed` écrite en RUNE NUE — toute la frontière d'erreur : affichage du repli, remontée de l'erreur d'un enfant vers l'ancêtre qui porte un repli, limite de réessai, bouton `mjs-reset` qui relance le composant |
| `for` | `{for item in liste}` — listes réactives ; ou dès que `flip` est du bundle (`:flip` a besoin de la réconciliation). L'index d'une liaison filtrée par valeur (`checked={x is $choix}` sur une ligne) ne part que si une source en écrit une |
| `if` | `{if condition}` — branches conditionnelles ; embarqué aussi dès que `key` ou `await` le sont (les deux s'appuient dessus) |
| `key` | `{key expression}` À LA RACINE — remonte tout le contenu (structure comprise) quand la clé change, quelle que soit sa valeur (`undefined` compris) |
| `await` | `{await promesse}` — branches `{success}`/`{error}` |
| `emit` | `µemit`, `:emit.nom=`/`:emit.once.nom=` ou le sucre `@geste.emit.nom` |
| `context` | `§clé` (contexte figé) ou `§§clé` (contexte réactif de sous-arbre), leurs formes ASCII `__context.clé`/`__shared.clé` (option `contextAlias`), ou les runes `µsetContext`/`µgetContext`, avec ou sans point |
| `lifecycle` | `µmount`, `µawake`, `µsleep`, `µdestroy`, `µurlChange` ou `µfailed` écrite en RUNE NUE (sans `<@failed>`), ou une balise globale `<@window>`, `<@document>`, `<@body>`, `<@html>`, `<@head>` (elles s'attachent et se détachent par ces crochets) — ou dès que `every`, `interpolate`, `smooth`, `socket`, `router`, `ujs` ou `modal` est du bundle : tous s'en servent pour défaire ce qu'ils ont posé |
| `layout_variant` | `<style name="…">` (un variant déclaré — la page qui le demande par `layout="…"` peut être servie hors du build), ou les mots `layout=`/`template=` (faux positif accepté) |
| `destroy_hooks` | `:transition`, `:in`, `:out`, `:attach`, `:this=!` ou `:flip` — le chemin lent de destruction (orchestration des transitions/teardowns), distinct du chemin rapide qui reste toujours dans le cœur, et avec lui la reprise d'un nœud encore en sortie quand sa branche revient (`{if}`, `{key}`, `{for}`) |
| `html` | `{{expression}}` — interpolation brute, à la racine, dans `{if}`/`{key}`, dans un `<@slot>`, dans le contenu passé à un composant enfant ou dans un partiel `<@include>` (dans un `{for}` ou un `{await}`, le bloc pose lui-même le contenu, sans ce module) |
| `slots` | `<@slot>` — le rangement `slot="N"` des enfants d'un composant à slots indexés (`{for i, t in $tabs}<@slot {i}/>{end}`) ; un composant qui n'écrit aucun `<@slot` n'en a pas besoin |
| `deep` | une mutation PROFONDE d'un état : `$o.x = v`, une méthode mutative (`$liste.push(v)`), `delete $o.x`, ou la rune `µproxy` — une écriture à la racine (`$x = v`) n'en a pas besoin |
| `esc` | une interpolation dans un `<@head>` ou dans le repli d'un `<@failed>` (les deux partent en HTML : la valeur est échappée) — un `<@head>` entièrement figé n'en a pas besoin. Toujours embarqué hors production : le panneau de développement s'en sert |
| `for_nested` | un `{for}` dans une autre liste, ou dans une branche `{await}` — la liste dont les ancres ne sont pas celles du composant ; à la racine, dans un `{if}` ou dans un `{key}`, `for` suffit |
| `alias` | un composant rangé dans un sous-dossier, donc porteur d'un nom COURT (`doc/doc-carte.mjs` → `<mjs-carte>` en plus de `<mjs-doc-carte>`) — un projet dont chaque fichier vit à la racine n'a pas d'alias à enregistrer |
| `types` | un bloc `<vars>` — le contrôle des types et valeurs permises à chaque écriture ; un projet sans `<vars>` n'en a pas besoin |
| `fx` | un effet `*nom` — le moteur des effets, plus le code de CHAQUE effet écrit : un projet qui n'écrit que `*neon` n'embarque que le néon ([38](38-effets.md)) |

Pour ces trente-neuf (hors `chart`, qui suit toujours le module de graphique), un usage que le scan de `sourceDir` ne voit jamais (un nom fabriqué à l'exécution, un composant que la construction ne lit pas, un attribut ou un nœud posé uniquement côté serveur) suit la même limite : à demander explicitement. Cinq blocs du cœur n'ont pas de nom à demander, et la clé `"runtime"` ne les fait pas venir : l'index des liaisons filtrées par valeur (`checked={x is $choix}` dans un `{for}`), la balise de `<@view>`, les aides `matches`/`animate` de la balise d'un composant (`<@@field>` s'en sert), la machinerie des valeurs dérivées (une variable calculée à partir d'autres, `$total = $prix * $quantite`, un `µderived` ou une dérivée qui lit un magasin `$$x` : leur calcul, leur cache et l'horloge qui les périme) et les réveils retenus des lignes (une ligne de `{for}` qui porte une directive qui lit sa balise dans le document, `:transition`, `:in`, `:out`, `:attach`, `:this`, un effet ou `:flip`, et qui livre des props à un composant enfant, ou un `{if}` de ligne dont une branche livre des props à un composant enfant). Ils suivent le seul code compilé par la construction : un composant compilé ailleurs qui s'en sert ne les apporte pas. Sans les réveils retenus, la ligne d'un tel composant s'affiche sans erreur : un composant enfant déjà défini quand elle entre dans la page s'y réveille avant de recevoir ses props (son `µawake` ne les voit pas encore, elles arrivent juste après), un enfant dont le fichier arrive plus tard les a déjà à son réveil. La balise de `<@view>` vient aussi avec `router` ou `ujs` (`"runtime": ["router"]`), et une construction de développement garde les trois premiers, sauf quand `"runtime"` ne retient aucun module optionnel (`"core"`). La machinerie des valeurs dérivées reste dans toute construction qui n'est pas de production (`mjs dev`, `mjs build` et `mjs serve` sans `--prod`), quelle que soit la clé `"runtime"`, `"core"` compris : l'atelier de thème (`/__mjs/theme`) et le journal d'erreurs (`/__mjs/errors`), compilés à la volée hors de la construction, en ont. En production, elle ne vient qu'avec une valeur dérivée compilée par la construction. Un appel à `µ` posé dans un script de page ne se rattrape pas par là : `window.µ` n'est exposé qu'en développement, ce script ne trouve pas `µ` en production, et la clé `"runtime"` n'y change rien — l'appel s'écrit dans le `<script>` d'un composant.

Les libellés par défaut du framework (boutons et messages de `modal`/`toast`, `router`, `ujs`, effets `*guard`/`*offline`/`*loader`/`*spoiler`, modules cœur à libellé) ne sont posés au manifeste que pour ce que le build embarque : un projet sans modale, sans routeur ni effet de ce genre ne paie pas leurs textes. Une page qui s'en sert sans que le scan de `sourceDir` le voie les demande par le module correspondant (`"runtime": ["modal"]`, etc.). Cette clé ne rend pas `µ` à un script de page : un appel comme `µ.modal.fire` s'écrit dans le `<script>` d'un composant, car `window.µ` n'est exposé qu'en développement.

Les **22 modules optionnels**, dans l'ordre où ils sont concaténés :

| Module | Ce qu'il apporte |
|---|---|
| `easing` | courbes d'accélération des transitions et animations — et le moteur qui joue les transitions : joint d'office, même avec `"core"`, dès qu'une source écrit `:in`, `:out` ou `:transition` |
| `spring` | `µspring` — ressorts physiques |
| `smooth` | `µsmooth` — lissage de valeurs distantes |
| `vault` | le global `$$` |
| `ajax` | `µ.ajax` (dont `µ.ajax.binary`, µschema-HTTP) |
| `socket` | `µsocket` — le client temps réel |
| `schema` | `µ.schema`/`.list`/`.bits` — codec binaire WS + AJAX |
| `optimistic` | `µ.optimistic` — mises à jour optimistes |
| `game` | `sock.game` — client MJS-Server |
| `chat` | `sock.chat` — salons et messages |
| `accounts` | `sock.account` — comptes et identités |
| `lobby` | `sock.lobby` — présence riche et salons d'attente |
| `interp` | `µ.interp` — interpolation d'états réseau |
| `predict` | `µ.predict` — prédiction côté client |
| `det` | `µ.det`/`µ.random` — déterminisme identique sur tous les moteurs |
| `lockstep` | `µ.lockstep` — simulation verrouillée tour par tour |
| `router` | le routeur `<@view>` |
| `modal` | `µ.modal.fire` — boîtes de dialogue, et le `:confirm` d'UJS |
| `ujs` | liens et formulaires en navigation SPA |
| `flip` | `:flip` — animation de déplacement de liste |
| `i18n` | `µt`/`@i18n` — traduction de l'application (embarque avec lui le magasin global dont dépend `µlang`) |
| `journal` | veilleur d'erreurs client — capture `window.onerror`/rejets, envoie au journal 3 étages |

Deux **préréglages** évitent d'énumérer les modules d'un usage courant : `"mjs-ws"` → `socket, schema, smooth` ; `"mjs-server"` → `socket, schema, smooth, game, interp, predict, det, lockstep, optimistic`. Trois autres ajoutent une brique par-dessus le socle temps réel : `"chat"`, `"accounts"` et `"lobby"` → `socket, schema, smooth` + le module du même nom. Un préréglage s'écrit dans le tableau comme un module : `"runtime": ["mjs-ws", "router"]`.

Une faute de frappe **lève une erreur** (jamais un module retiré en silence). `i18n` fait exception à `"all"` : il n'est embarqué que si le projet a une clé `i18n` en config ou un dossier `i18n/` — le demander explicitement passe outre. L'option vaut pour le bundle client (`mjs build`) comme pour le prérendu (`render`), qui charge le même cœur — un module absent du bundle l'est aussi côté serveur. Elle généralise l'ancien flag `minimalRuntime` (≡ `"core"`).

## Thèmes — `varPrefix` / `defaultTheme`

| Clé | Défaut | Effet |
|---|---|---|
| `varPrefix` | `mjs` | préfixe des variables de thème : `$$brand` → `--<varPrefix>-brand` |
| `defaultTheme` | `light` | thème qui vaut sans attribut `theme` |

Détails : [31 · Thèmes](31-themes.md).

## Langue des messages — `lang`

```json
{ "lang": "en" }
```

Langue des messages du CLI, du compilateur et des serveurs Node (`mjs dev`/`build`/`check`/`serve`/`ws`/`server`) : `"fr"` *(défaut)* ou `"en"`. Clé absente ou toute autre valeur → `fr`, silencieusement (aucune erreur de validation). La langue vaut pour tout le processus qui a lu la configuration (`findConfig`) : employés par leur API dans ce processus, `modularjs-framework/ws` et `modularjs-framework/mjs-server` parlent la même. Sans effet sur la langue du **site généré** (i18n applicatif) : voir [29 · i18n](29-i18n.md).

---

📚 **Apprendre en pratiquant** : cette fiche est un condensé de consultation ; le parcours d'apprentissage reste le [tuto interactif](README.md) et les 38 chapitres de cette doc.
