# 14 · Stores

> 📚 Tuto interactif correspondant : **ModularJS Avancé → Stores**. Les encarts 🎓 *Pour débutants* dépliables donnent l'explication pas-à-pas ; le corps de la page reste la référence dense.

Quand un état doit être partagé entre **plusieurs composants éloignés** (sans relation parent/enfant), le faire remonter/redescendre par props devient fastidieux. Un *store* est un conteneur d'état **global**, déclaré une fois dans un fichier dédié et consommable depuis n'importe quel composant.

MJS offre deux mécanismes, du plus léger au plus structuré : le **symbole store `µ$$`** et la **classe `µStore`** (importée et consommée, elle aussi, avec `µ$$`). Tous deux s'appuient sur le même moteur de réactivité universelle — toute mutation re-rend automatiquement les composants qui lisent la donnée.

## 1. Symbole store léger — `µ$$`

Le plus simple : une valeur ordinaire préfixée par `µ$$`, exportée depuis un module.

> 🔤 **Syntaxe.** Le store double le `$` de la variable réactive : `$x` (variable) → `$$x` (store). On écrit `µ$$x` en module externe (le `µ` = « on invoque le framework », comme `µ$x` pour les variables), et `$$x` nu en script/template de composant. Tout est en **ASCII** (clavier sans touche exotique).

```html
# tuto_count_shared.module.civet.mjs — le store, dans son fichier dédié
export µ$$count = { value: 0 }
```

La valeur de `export µ$$x =`, comme celle de `µ$x =`, s'écrit comme celle de toute affectation Civet : sur sa ligne, ou sur plusieurs lignes — liste ou objet ouverts en fin de ligne (`export µ$$liste = [` puis un élément par ligne), valeur écrite dessous, en retrait (`µ$x =` seul sur sa ligne), opérateur en fin de ligne, suite en `.` à la ligne d'après. La valeur entière, telle que Civet la lit pour `x =`, devient la valeur de départ. Dans un script écrit en CoffeeScript, TypeScript ou JavaScript (`lang`), écrivez-la sur une seule ligne : une valeur qui continue sous sa ligne y échoue, ou produit un code faux sans le signaler.

Dans le fichier du magasin, `µ$x` désigne l'objet du magasin : changez-le sur place (`µ$x.cle = valeur`, `Object.assign(µ$x, { … })`, `µ$x.liste.push(…)`). Le remplacer (`µ$x = { … }`, `µ$$x = { … }`, `µ$x ||= { … }`, `µ$x++`, `--µ$x`), même dans une fonction, est refusé à la construction, avec la ligne et ce qu'il faut écrire : les composants qui lisent `µ$$x` garderaient l'ancien objet. Un changement fait hors de MJS dans cet objet (une bibliothèque qui garde l'objet brut) se signale de même, sur place : écrivez une nouvelle valeur dans la clé qu'il a touchée (`µ$x.lignes = [...µ$x.lignes]`) ; `µrefresh` n'y signale qu'une clé du magasin (`µrefresh($$x)`), et `µrefresh(µ$x)` ou `µrefresh(µ$$x)` y est refusé à la construction.

On l'importe via `@import µ$$count` (le module, lui, **déclare/exporte** avec ce même symbole), puis on le **consomme dans le composant via ce même `µ$$count`** — on le lit et le mute **directement** :

```html
@import µ$$count 'tuto/10/10-5/tuto_count_shared.module.civet.mjs'

<button @click={µ$$count.value++}>
  clics : {µ$$count.value}
</button>
```

Trois `<@tuto-counter>` qui importent ce module partagent **la même valeur** : cliquer sur l'un incrémente le compteur de tous, parce qu'ils lisent et écrivent dans le même singleton.

> ⚠️ **Un seul symbole, un seul rôle** : le module **déclare** le store avec `µ$$count` (le `µ` = « on invoque le framework »), et le composant l'**importe et le consomme** avec ce **même** `µ$$count` — symétrie totale entre déclaration, import et usage. L'ancienne forme `@import §§count` lève une **erreur de compilation** explicite qui oriente vers `@import µ$$count` ; `@import $count` (dollar simple) est pareillement rejeté à la compilation ; consommer le singleton importé via `$count`, `$$count` ou `§§count` est également une erreur (seul `µ$$count` est valide). Ne confondez pas `§` (contexte d'arbre, non réactif), `§§` (contexte réactif de sous-arbre — jamais un import) et `µ$$` (déclaration, import et consommation d'un singleton, un seul et même symbole). Le store **zéro-import** `$$x` (→ `µ.store.x`) est une autre voie, sans `@import` ni `export`.

<details>
<summary>🎓 <b>Pour débutants</b> — pourquoi un fichier séparé&nbsp;?</summary>

Un store doit être **une seule et même valeur** pour tous les composants qui le partagent. En le mettant dans un module à part et en l'`export`-ant, le système de modules garantit qu'il n'est créé **qu'une fois** : chaque `@import` pointe vers la même instance. Si vous déclariez `µ$$count` à l'intérieur d'un composant, chaque instance du composant aurait *son propre* compteur — l'inverse de ce qu'on veut.

</details>

## 2. Classe `µStore` — état structuré, consommé via `µ$$`

Pour un état plus riche (plusieurs champs, objets imbriqués, méthodes intégrées), on instancie la classe `µStore` (alias `µ.Store`). On l'`export`-e depuis un module, et on accède à son contenu via la propriété **`.data`** (un proxy réactif) :

```html
# stores/feed.mjs
export feedStore = new µStore(version: 0)
```

```html
# stores/page.mjs — un store « page » maison
export pageStore = new µStore(url: window.location, params: {})

window.addEventListener 'popstate', ->
  pageStore.data.url = new URL(window.location)
```

Côté composant, on importe le store avec `@import µ$$feed 'chemin'` — le **même** symbole que le singleton léger — puis on lit/écrit ses champs directement avec `µ$$feed` :

```html
@import µ$$feed 'stores/feed.mjs'

<script>
  µ$$feed.version    # lu → dépendance enregistrée, le composant re-rend si version change
  µ$$feed.version++  # écrit → tous les abonnés à cette clé sont invalidés
</script>
```

```html
# déclarer un CONTEXTE partagé directement à la racine de l'appli (sans module ni `new µStore`), lu par tout composant descendant — ceci reste `§§`, ce n'est PAS un import :
§§cfg = await fetch('/api/config').then (r)-> r.json()
```

Tout champ lu via `µ$$feed.x` enregistre le composant comme abonné à la clé `x` ; toute écriture `µ$$feed.x = …` (ou mutation d'un tableau/Map/Set, ou `++`) notifie précisément les abonnés de cette clé.

> ⚠️ **`§§` n'est jamais un « global ».** Le symbole `§§` est, sans exception, un **contexte réactif de sous-arbre** (même mécanisme que `§`, en réactif — chapitre [Contexte](13-contexte.md)) : deux composants sans ancêtre commun déclarant `§§clé` ne partagent **rien**. Ni le singleton léger du §1, ni une instance `µStore` importée, ne passent par `§§` : les deux s'importent et se consomment avec le **même** symbole `µ$$` (`@import µ$$feed 'chemin'` → `µ$$feed.version`), qu'ils viennent d'un `export µ$$X = …` ou d'un `export feedStore = new µStore(…)`. `§§` reste réservé à la déclaration/lecture de contexte (`§§clé = valeur` posé par un ancêtre, lu par ses descendants) — y compris la variante « racine d'appli » vue plus haut (`§§cfg`), qui n'est jamais un import.

### Un reffet dans le fichier du magasin

Un `µeffect` écrit au premier niveau du fichier qui déclare le magasin (`export µ$$panier = …` ou `new µStore(…)`) appartient à ce module, comme dans tout module `.civet.mjs` ou `.coffee.mjs` et dans le `<script module>` d'un composant : il tourne sans aucun composant, à la création puis à chaque changement de ce qu'il suit, et continue quand plus aucun composant n'affiche le magasin. La sauvegarde dans le navigateur s'écrit donc à côté de la donnée :

```civet
# panier.module.civet.mjs
sauve = if µserver then null else localStorage.getItem 'panier'
export µ$$panier = { articles: JSON.parse(sauve or '[]') }

µeffect ->
  localStorage.setItem 'panier', JSON.stringify µ$$panier.articles unless µserver
```

Il suit le magasin comme un composant qui le lit : un `µ$$x` en entier (cette sauvegarde repasse aussi quand une autre clé du panier change), d'un `µStore` chaque clé de ses données qu'il lit. Sa propre écriture ne le relance pas ; deux reffets qui s'écrivent l'un l'autre se relancent sans fin, jusqu'à la garde des 10 000 passages et son avertissement de développement « Boucle réactive détectée », et un composant qui lit ces magasins atteint aussi sa propre garde. Toutes ses règles (passage en microtâche, nettoyage quand le fichier est exécuté de nouveau, refus ailleurs) : [03 · Réactivité, « Le reffet d'un magasin »](03-reactivite.md).

Dans un composant, un reffet suit les clés `$$x` qu'il a lues à son dernier passage, où qu'il les ait lues (son corps, une fonction du `<script>`, une fonction rangée dans un objet) : une clé de la branche qu'il n'a pas prise ne le relance pas. Une clé qu'il écrit lui-même pendant son passage suit les règles de [03](03-reactivite.md) : bornée (`$$v = $max if $$v > $max`), elle le relance sur une écriture faite hors de tout reffet ; cumulée (`$$vus += 1`), elle ne le relance pas. Une clé qu'il lit et qu'une fonction écrite hors de son `<script>` écrit pendant son passage (l'aide d'un module, la méthode d'un autre composant) le relance comme une écriture venue d'ailleurs : il repasse une fois, sur la nouvelle valeur. Une clé qu'il lisait et que l'on supprime (`delete $$x`) reste suivie : il repart quand elle revient.

### Jeter un magasin — `destroy()`

Un `µStore` créé pour un moment (un salon de discussion, un assistant en plusieurs étapes) se jette quand il ne sert plus : `magasin.destroy()`. Ses reffets s'arrêtent, ceux de la racine `µeffect.root` qui l'a créé, ou du module qui l'a créé à son premier niveau (tous les reffets de ce premier niveau, même ceux qui lisent un autre magasin du même fichier : un magasin à jeter se crée dans une racine, comme ci-dessous) ; ses abonnés (composants, reffets) ne sont plus prévenus. Il reste lisible : une écriture y est rangée sans relancer personne, et un avertissement de développement le signale, une fois. Un deuxième appel ne fait rien.

```civet
# salon.module.civet.mjs — un magasin par salon
export ouvrirSalon = (id) ->
  salon = null
  µeffect.root ->
    salon = new µStore(messages: [], brouillon: '')
    µeffect ->
      sessionStorage.setItem "brouillon-#{id}", salon.data.brouillon unless µserver
  salon
```

```html
<script>
  @import ouvrirSalon 'salon.module.civet.mjs'
  salon = ouvrirSalon($id)
  µdestroy -> salon.destroy()
</script>
```

Jetez le magasin quand plus aucun composant affiché ne le lit : un composant qui le lit encore garde ce qu'il affiche et n'est plus prévenu de ses changements (avertissement de développement, avec sa balise). Les données vivent dans `.data` : une clé nommée `destroy` (`salon.data.destroy`) ne gêne pas la méthode, et l'inverse. `destroy()` est une méthode de `µStore` ; un `µ$$x` léger et le magasin `$$x` vivent avec la page.

### Méthodes et collections

`.data` enveloppe récursivement les objets imbriqués, et intercepte les **mutateurs** des collections natives (`push`, `pop`, `splice`, `shift`, `unshift`, `sort`, `reverse` sur les tableaux ; `set`, `add`, `delete`, `clear` sur `Map`/`Set` ; les `setX` des `Date`). Muter une collection du store via ces méthodes notifie donc les abonnés, sans réaffectation. Les vues binaires (`Int32Array`, `Uint8Array`… et les autres `TypedArray`, `DataView`, `ArrayBuffer`) se lisent et s'appellent normalement, y compris leurs méthodes (`.map()`, `.subarray()`, `.at()`, `.getInt32()`…) : tout s'exécute sur la vraie instance, jamais sur le proxy. Muter un **index** d'une `TypedArray` (`store.data.v[0] = x`) notifie comme un élément de tableau ; il en va de même pour ses méthodes qui modifient la vue en place (`set`, `fill`, `copyWithin`, `sort`, `reverse`) et pour les setters nommés d'une `DataView` (`setInt32`, `setUint8`…) — les méthodes de lecture, elles, ne notifient jamais personne.

```html
# layout.mjs — état de session chargé au montage, lisible par toutes les pages
@import sessionStore './stores/session.mjs'

<script>
  µmount ->
    res = await fetch('/api/me')
    sessionStore.data.user = await res.json()
</script>
```

> ⚠️ Comme partout ailleurs dans un composant MJS, l'import se fait par la directive **`@import nom 'chemin'`**, à la **racine** du fichier ou dans le `<script>` — jamais `import … from` JavaScript, qui est une erreur de compilation (cf. [Anatomie d'un composant](02-composant.md)).

> ⚠️ Une clé **ajoutée après construction** (`store.data.nouvelle = x`) est réactive (le registre d'abonnés est créé à la volée). Mais déclarer dès le départ les champs connus dans le constructeur reste plus lisible et évite les surprises.

<details>
<summary>🎓 <b>Pour débutants</b> — <code>µ$$</code> ou <code>µStore</code>&nbsp;?</summary>

- `µ$$` : la valeur la plus simple possible, partagée. Parfait pour un compteur, un drapeau, une petite donnée. On la lit/mute directement (`µ$$count.value++`).
- `µStore` : une classe pour de l'état structuré — plusieurs champs, objets imbriqués, abonnement *par champ* (un composant qui ne lit que `µ$$feed.version` ne re-rend pas si une autre clé change). À privilégier pour le vrai état d'application (session, panier, page).

Les deux sont des sources de vérité globales ; choisissez selon la richesse de la donnée.

</details>

## 3. Le magasin qui se charge seul — `µload`

`µload(url, options)` rend un **magasin chargé** : la réponse JSON d'une adresse, lue par `µ.ajax.get`, avec son état. Il se lit comme un objet : `data` (la donnée, `undefined` avant la première réponse), `pending` (vrai tant qu'une requête est en vol), `error` (l'erreur de la dernière requête, `null` sinon) et `refresh()` (relire tout de suite, rend une promesse).

```html
<script>
  $me      = µload('/api/me', { refresh: 'focus' })
  $q       = ''
  $members = µload("/api/members?q=#{encodeURIComponent($q)}")
  rename   = (pseudo) -> µ.ajax.patch('/api/me', { pseudo })     # après l'envoi, /api/me se relit seul
</script>

{if $me.error}<p class="error">{$me.error.message}</p>{end}
<p class="hello">Bonjour {$me.data?.pseudo}</p>
<span class="busy" hidden={not $me.pending}>Mise à jour…</span>
<button @click={rename('Nouveau pseudo')}>Changer de pseudo</button>

<input value=!{$q} placeholder="Rechercher">
{for m in ($members.data or []) by id}<p>{m.pseudo}</p>{end}
```

Les règles :

- **Une seule requête par adresse.** La clé est l'adresse telle qu'elle est écrite, requête comprise (`/api/members?q=bob`). Les composants qui lisent `/api/me` partagent la même requête en vol et la même donnée : trois composants qui l'affichent font une requête. Une dérivée refaite après chaque écriture du composant (`$members` ci-dessus) retrouve le même magasin, sans nouvelle requête.
- **L'adresse change** (`$q` ci-dessus) : la donnée d'avant reste affichée, `pending` vrai, jusqu'à l'arrivée de la nouvelle — seulement pour un appel écrit directement dans l'expression d'une variable ou d'une dérivée du script (la même occurrence de `µload(` dans le code, hors de toute fonction et de toute boucle ; un `switch` ou un `try` écrits dans l'expression, entre parenthèses ou non, comme `$members = (try µload("/api/members?q=#{$q}") catch then null)?.data`, et un `do` dont l'expression lit le résultat, comme `$members = (do …)?.data`, n'en font pas une fonction), comme la frappe dans une recherche : `$members = µload("/api/members?q=#{$q}")` garde la liste de `bo` pendant qu'arrive celle de `bob`, dans un `<script>` Civet comme dans un `<script lang="ts">`. Un `do` qui forme toute l'expression (`$members = do …`, entre parenthèses ou non) ne fait pas une dérivée : la variable reçoit une seule fois, au démarrage du composant, le magasin de l'adresse d'alors, et ne suit pas `$q` — écrivez l'appel directement dans l'expression, ou lisez le résultat du `do` (`(do …)?.data`). Un appel fait dans une fonction — une aide (`chercher = (q) -> µload("/api/members?q=#{q}")`, puis `$members = chercher($q)`), une flèche, une boucle — ou dans le gabarit ne montre jamais la donnée d'une autre adresse : celle de sa propre adresse si elle est encore gardée (voir **Mémoire**), sinon `pending` sans donnée. La requête dépassée est annulée quand plus personne ne lit son adresse.
- **Le même appel pour chaque rang** d'une liste (`$ids.map((i) -> µload("/api/members/#{i}"))`, une boucle) : chaque rang montre le magasin de sa propre adresse — sa donnée si elle est encore gardée (voir **Mémoire**), sinon `pending` sans donnée —, jamais la donnée d'un autre rang, quand la liste change de contenu comme d'ordre. Écrit dans une boucle, dans une fonction passée à une méthode de tableau (`map`, `forEach`, `filter`…) ou dans une aide qu'elle appelle (`fiche = (i) -> µload("/api/members/#{i}")`, puis `$ids.map((i) -> fiche(i))`), l'appel ne garde jamais la donnée d'une adresse d'avant, même fait une seule fois : la liste d'un seul rang qui passe de `[1]` à `[3]` montre `pending` sans donnée, jamais celle de l'id 1.
- **Une valeur qui lit la donnée** d'un appel (`$n = µload('/api/stats').data?.n or 0`, `$m = µload(a).data?.n or µload(b).data?.n or 'att'`) est une dérivée : elle se recalcule à chaque arrivée d'une réponse qu'elle a lue, même vide ou sans le champ attendu. Seules `data`, `pending` et `error` font une dérivée : le magasin rangé tel quel (`$me = µload('/api/me')`) reste une variable, dont le gabarit lit la donnée (`{$me.data?.pseudo}`), comme ce que rend un autre membre (`$p = µload(url).refresh()` relit une fois, jamais à chaque calcul).
- **Deux appels écrits, deux magasins**, même dans la même dérivée (`[µload(a), µload(b)]`, `if $on then µload(a) else µload(b)`, `µload(a).data or µload(b).data`) : passer de l'un à l'autre montre le magasin de la nouvelle adresse — sa donnée si elle est encore gardée (voir **Mémoire**), sinon `pending` sans donnée —, jamais la donnée de l'autre appel. Une dérivée qui finit son calcul sans erreur lâche les adresses qu'elle n'a plus appelées (l'autre branche d'un ternaire, une condition devenue fausse) : leur requête en vol est annulée, elles ne sont plus relues après un envoi. Un calcul qui lève une erreur ne lâche rien : l'adresse affichée reste lue.
- **Dans le gabarit** — une liaison, à la racine comme dans un bloc (la branche d'un `{if}`, d'un `{key}` ou d'un `{await}`, la condition d'un `{if}`, la liste ou une ligne d'un `{for}`) —, écrivez l'appel dans une dérivée du script, puis lisez-la : `$membres = µload("/api/members?q=#{$q}")`, puis `<p>{$membres.data?.length}</p>` ou `{for m in ($membres.data or [])}`. La dérivée lâche l'adresse qu'elle quitte. Écrit dans le gabarit lui-même (`<p>{µload(…).data?.length}</p>`, `{for m in (µload(…).data or [])}`), l'appel marche — chaque adresse a son magasin, le composant se redessine à chaque arrivée de sa donnée, et une adresse qu'il affiche reste tant qu'il est monté, quel que soit leur nombre : jamais évincée du cache ni redemandée au redessin, même en erreur (l'erreur reste affichée jusqu'au départ du composant ou à `refresh()`), et relue une fois après un envoi qui la touche, tout de suite, jamais au redessin suivant ; l'adresse d'un bloc fermé qu'il n'a pas encore lâchée (voir **Mémoire**) est relue de même, et le bloc rouvert montre la donnée fraîche —, mais n'est pas suivi : le composant ne lit pas ces adresses, ses requêtes dépassées ne sont pas annulées, une adresse qui change ne garde jamais la donnée d'avant (écrivez l'appel dans le script), et sa donnée ne reste au cache qu'une fois qu'il ne l'affiche plus (voir **Mémoire**) ; le développement le dit (voir plus bas).
- **`refresh`** : `false` par défaut — la donnée n'est relue qu'après un envoi qui la touche, ou sur demande. Un nombre de secondes : relue en fond quand elle est lue et plus vieille que ce délai (aucune relecture si rien ne la lit). `'focus'` : relue au retour sur l'onglet, si elle a plus de 30 secondes. `'online'` : relue au retour du réseau. Les options s'écrivent en objet : `µload(url, 'focus')` ou `µload(url, 30)` écrit un avertissement (écrivez `µload(url, { refresh: 'focus' })`) et compte pour `false`, comme une autre valeur de `refresh` ou une autre option. Chaque appel garde sa règle : deux composants qui lisent la même adresse avec deux règles partagent la donnée et la requête, et chacun relit selon la sienne. `'focus'` et `'online'` s'écrivent en clair dans le code de l'appli : l'écoute du retour sur l'onglet et du réseau n'entre au cœur que si ces mots y figurent (une règle venue des données, sans ce mot dans le code, n'écoute rien). En production, au niveau de console `error` (défaut) ou `silent`, ces avertissements ne partent pas, ni le code qui les écrit.
- **Relue après un envoi.** Un `µ.ajax.post`, `put`, `patch` ou `delete` réussi relit les adresses gardées dont le chemin est celui de l'envoi, ou l'un de ses parents, sur la même origine : `PATCH /api/me` relit `/api/me` ; `DELETE /api/members/42` relit `/api/members?q=…` ; `/api/members` n'est pas sous `/api/me`, il n'est pas relu. La barre finale ne compte pas (`/api/me/` est `/api/me`) ; la racine `/` n'est le parent d'aucun chemin : seul un envoi à `/` la relit. Une adresse lue, ou qu'un gabarit affiche encore (voir **Mémoire**), est relue tout de suite, une fois (une requête déjà en vol est annulée et repart) ; une adresse qu'on ne lit ni n'affiche plus est relue à sa prochaine lecture — un bloc rouvert, un composant qui l'appelle à nouveau. `µload.refresh('/api/me')` suit la même règle, sur demande, et rend une promesse tenue quand les relectures sont arrivées.
- **Erreur** : `error` est posée, `data` garde la dernière donnée reçue, et aucun nouvel essai n'est fait seul — `refresh()`, un envoi qui la touche ou la règle `refresh` relancent la requête. Une réponse qui n'est pas du JSON (type autre que `application/json` : une page de connexion servie à la place de l'API, par exemple) est une erreur : `error.message` le dit avec l'adresse (« µload : la réponse de /api/me n'est pas du JSON. »), le même texte en développement et en production, dans la langue de la page (libellé `mjs.load.notJson`, que le dictionnaire du site peut remplacer, cf. [i18n](29-i18n.md)) ; `error.body` porte le texte reçu et `error.url` l'adresse finale, après une redirection ; `data` ne la reçoit jamais.
- **Mémoire** : une adresse vit tant qu'un composant la lit (il la tient dans son état, ou lit `data`, `pending` ou `error` pendant son rendu — sauf celle d'un appel écrit dans son gabarit, qu'il ne lit pas), ou que le gabarit d'un composant monté l'affiche, même au-delà de 50 adresses ; la dérivée qui ne l'appelle plus cesse de la lire ; le gabarit qui ne l'affiche plus — un bloc fermé, une liste raccourcie, une adresse qui change — la garde jusqu'au rendu complet suivant du composant, puis la laisse : l'arrivée d'une réponse qu'il affiche ou qu'il lit le redessine en entier, comme un `{await}` qui se résout ; la fermeture d'un bloc, non (une liste de 200 adresses raccourcie à 10 les garde toutes jusque-là, et un envoi qui touche l'une d'elles la relit) ; un composant qui quitte la page laisse tout ce qu'il lisait ou affichait : il n'est plus prévenu de rien. Quand plus personne ne la lit ni ne l'affiche, elle reste 5 minutes dans un cache de 50 adresses au plus, la plus ancienne partant la première : un composant qui la rouvre entre-temps affiche aussitôt la donnée gardée. Une adresse sans donnée (requête annulée, erreur seule) n'est pas gardée.
- **Rendu serveur** : la donnée que `µload` lit pendant le rendu est attendue comme un `{await}`, puis rangée dans la balise `#__mjs_store` (clé `__mjsLoad`, cf. [SSR](19-ssr.md)). Le client démarre avec elle, sans requête, en reprise (`markers`) comme en remplacement (`replace`) ; elle ne s'ajoute pas au magasin `$$`. Un échec pendant le rendu (réseau, réponse en erreur ou qui n'est pas du JSON) ne s'écrit jamais dans la page : elle part en attente (`pending` vrai), rien n'entre dans `#__mjs_store`, et le client refait la requête — `error` se pose chez lui si elle échoue encore. Un rendu qui dépasse `settleMs` en attendant `µload` le dit, avec les adresses attendues. Cette reprise part dans tout client qui appelle `µload`, même construit sans bloc `render` ni `hydrate` : la page peut venir d'un serveur qui rend par l'API, ce que la construction du client ignore. Le code que lit le rendu serveur lui-même (la donnée à ranger, l'échec qui ne s'écrit pas dans la page) n'entre au cœur que dans une construction qui peut rendre côté serveur : un bloc `render` qui n'est pas tout en `csr`, ou `hydrate` dans une liste `runtime`. Une route sans `mode` suit `render.default`, et sans `render.default` elle est prérendue (`prerender`).

`µload` s'écrit dans le `<script>` d'un composant — une variable, une dérivée, un gestionnaire d'événement, `µmount` — ou dans un module : hors d'une dérivée, un même appel rend le même magasin pour une même adresse et une même règle. Dans un gestionnaire ou `µmount`, rangez le magasin dans une variable (`$m = µload(…)`) : le composant lit le magasin que tient son état. Appelé ailleurs pendant que le composant se rend — dans le gabarit (une liaison, racine comprise, ou un bloc), dans un `µeffect`, ou dans une aide que le gabarit appelle (`{@aide($q).data}`) —, l'appel n'est pas suivi : le composant est prévenu de l'arrivée de la donnée et se redessine, mais il ne lit pas le magasin — ses requêtes dépassées ne sont pas annulées, une adresse qui change ne garde pas la donnée d'avant, et la donnée n'est gardée que tant qu'il l'affiche (jusqu'à son rendu complet suivant), puis au cache (5 minutes, 50 adresses) ; une adresse qu'il affiche est relue une fois après un envoi qui la touche. En développement, un avertissement le dit, une fois par lieu et par composant, avec l'adresse : écrivez l'appel dans une dérivée du script (`$membres = µload(…)`, l'adresse peut lire des `$`), puis lisez-la dans le gabarit ; pour une ligne de `{for}`, dans le script d'un composant enfant. Un gestionnaire d'événement et `µmount` ne sont pas visés, ni le script d'un composant enfant qu'un bloc crée. Aucune construction de production n'emporte cet avertissement ni le code qui le surveille, minifiée ou non, à tout niveau de console. Son module n'entre au cœur que si le code de l'appli appelle `µload`, et il emmène `ajax`, qui fait la requête. Une liste `"runtime"` écrite à la main doit nommer `ajax` : sinon la construction le signale (`runtimeHint`).

## Sous le capot depuis la statisation

Le store zéro-import (`$$x` → `µ.store.x`, cf. §1) est **dispatché finement, clé par clé** : un
composant qui lit `$$score` ne se re-rend **que** quand la clé `score` change — jamais quand une **autre**
clé du store est mutée à côté (`$$autreChose`, par exemple). Fini le re-rendu global qu'un store
générique imposerait à tous ses lecteurs.

`$$` se suit toujours d'un nom écrit dans le code (`$$score`, puis `$$score[k]` pour une clé calculée sous ce nom) : `$$[k]` n'est
pas une clé du magasin, et la construction le refuse, à sa ligne. Rangez ces valeurs sous une clé nommée (`$$valeurs[k]`), écrivez
`µ.store[k]`, ou servez-vous d'un `µStore`.

Un objet du magasin passé à un enfant par une prop (`item={$$liste[0]}`, ou `item={r}` dans une ligne de `{for r in $$liste}`) suit
les écritures de ses champs, quel que soit le composant qui les fait : `$$liste[0].nom = v`, `r.nom = v`, `$$cfg.l.push(x)`, `delete`
— l'enfant montre la valeur écrite, comme les composants qui lisent la clé.

Une écriture du store faite dans un module `.civet.mjs` ou `.coffee.mjs` importé prévient ses lecteurs
comme dans un composant, imbriquée comprise (`$$droits.compte.n = 5`, `+=`, `.push(…)`, `delete`),
ou faite à travers un élément trouvé (`$$taches.find((t) -> t.id == id).fait = true`, voir plus bas).

Accès **non réactif** : `µread $$x` (lecture brute, n'enregistre aucun abonnement) et
`µwrite $$x, v` (écriture brute, ne notifie personne) — utiles pour poser une valeur de départ ou
lire ponctuellement sans provoquer de re-rendu. Après `µwrite $$x, v`, les valeurs dérivées des
composants qui lisent `$$x`, ou qui énumèrent le store, se recalculent à leur prochaine lecture :
relues aussitôt, elles rendent la valeur à jour ; seul l'écran attend la prochaine écriture ordinaire.
Un changement fait dans l'objet que tient une clé par la lecture brute (`µread($$x).n += 1`), ou hors
de MJS (une bibliothèque), se signale juste après par `µrefresh($$x)` : ce qui lit la clé se redessine
et les valeurs dérivées qui la lisent se refont, sans relancer de reffet (cf. [41 · µrefresh](41-refresh.md)).

> ⚠️ **Règle d'aliasing.** Une mutation écrite **en clair** sur `$$obj.a.b` est suivie, **même** via un
> alias local direct assigné dans le même bloc (`sous = $$obj.a` puis `sous.b = 5` reste tracké et
> notifie, en Civet comme en CoffeeScript). Mais dès que la référence traverse la frontière d'un **appel de fonction** (le
> sous-objet du store passé en argument à une fonction qui le mute de son côté), plus rien ne
> notifie : le store n'a pas de filet de rattrapage à l'exécution (contrairement à l'état local
> d'un composant, qui en a un).
>
> Un alias du magasin écrit dans l'**objet qu'il tient**, comme en JavaScript, puis prévient les
> lecteurs de la clé, et ceux des clés qui rangent l'objet écrit : `$$pb = $$pa`, puis `sb := $$pa`,
> `$$pa = { x: 100 }` et `sb.x = 12` écrivent l'ancien objet, que range encore `pb` — le lecteur de
> `$$pb` suit ; `$$autre = $$cfg.a`, puis `sous := $$cfg.a` et `sous.b = 1` (ou `$$cfg.a.b = 1`) — le
> lecteur de `$$autre` suit. Une clé qui range un objet **parent** de l'objet écrit est prévenue par
> une écriture faite par le chemin (`$$cfg.a.l.push(x)` prévient `$$autre`), pas par un alias de
> l'objet écrit (`l := $$cfg.a.l`, puis `l.push(x)`) : écrivez alors par le chemin. Si la clé, ou une liste avant
> l'élément, change entre la prise de l'alias et l'écriture, l'écriture va toujours à l'objet tenu :
> `ancien := $$cfg`, puis `$$cfg = $$autre`, puis `ancien.on = false` écrit dans l'ancien objet, et
> `$$cfg` garde celui de `$$autre` ; `p := $$items[0]`, puis `$$items.unshift(neuf)`, puis
> `p.fait = true` coche l'ancien premier, pas `neuf`. Un alias jamais pris (`sous = $$cfg.a if c`,
> `c` faux, ou un `return` avant l'affectation) lève à l'écriture la `TypeError` de JavaScript
> (« Cannot set properties of undefined »). La règle est la même pour toute variable qui prend sa
> valeur dans le magasin : déclaration Civet (`sous := $$cfg.a`, `let sous = $$cfg.a`), variable
> déclarée sans valeur puis affectée une fois (`let sous`, puis `sous = $$cfg.a`), alias CoffeeScript
> (`sous = $$cfg.a`), variable prise par un indice (`p := $$items[i]`), variable qui garde un élément
> trouvé (ci-dessous) — et une variable qui garde un objet de l'état local garde de même l'objet
> qu'elle tenait (cf. [Réactivité — état profond](03-reactivite.md#état-profond--mutation-imbriquée)).
> Pour écrire là où la clé pointe au moment de l'écriture, écrivez par le chemin (`$$cfg.on = false`).
>
> Le suivi est prudent : un nom déclaré plus d'une fois dans le `<script>` (même dans deux
> fonctions différentes), réassigné, ou paramètre d'une fonction n'est jamais pris pour un alias du
> magasin, ni pour une variable qui garde un élément trouvé (ci-dessous). Dès que ce nom reçoit
> quelque part une lecture du magasin, dans une fonction ou une autre — déclaration ou affectation
> (`lu := $$prefs[section]`, `lu ||= $$prefs[section]`, `&&=`, `??=`, `?=`), variable d'une boucle
> (`for t of $$taches`, `for (const k in $$prefs)`, ou sur une copie de ses objets : `for t of $$taches.filter(…)`),
> élément d'une copie (`t := $$taches.filter(…)[0]`), nom tiré d'une déstructuration
> (`{ meta } := $$taches[0]`, `[t] := $$taches`), paramètre par sa valeur par défaut
> (`(t = $$taches[0]) ->`), valeur attendue (`t := await $$cfg.a`) —, ce qu'il écrit passe pourtant
> par l'aide gardée : un prototype et les noms réservés restent refusés, même par un paramètre ou une
> variable du même nom dans une autre fonction. L'écriture prévient la clé que lit la variable dans
> sa fonction : deux fonctions qui déclarent chacune leur `x` sur deux clés préviennent chacune la
> leur. Une même variable qui lit deux clés différentes — déclarée hors des fonctions et affectée
> dans deux d'entre elles sur deux clés, ou faite d'une expression qui en lit deux
> (`z := $$carte.get(k) or $$liste[0]`, `??`, ternaire, `if` de Civet) — reste gardée mais ne
> prévient rien (la valeur change, l'écran non). En CoffeeScript, où une variable s'écrit `sous = …`
> sans mot de déclaration, la première affectation vaut déclaration : un nom affecté une seule fois
> dans sa fonction, hors d'une boucle, est un alias ; affecté deux fois, ou sous le même nom dans deux
> fonctions, il ne l'est pas, et ses écritures suivent la règle ci-dessus. Donnez à chaque alias son
> propre nom, ou écrivez par le chemin (`$$items[0].fait = true`).
>
> **Un élément trouvé est suivi aussi.** Une écriture qui passe par l'élément que rend `find`,
> `findLast`, `at` (liste) ou `get` (`Map`) prévient les lecteurs de la clé, comme l'écriture par le
> chemin : affectation (`=`, `+=`, `||=`, `&&=`, `??=`, et `?=` en CoffeeScript), `++` et `--`,
> `delete`, méthode qui modifie (`.push(…)`, `.splice(…)`…), cible plus profonde (`.meta.vu = true`),
> clé calculée (`[champ]`), chaîne optionnelle (`$$carte.get(k)?.tags.push(x)`,
> `$$carte.get(k)?.n += 1`, `delete $$carte.get(k)?.note` : élément absent, rien n'est écrit), dans un
> composant Civet ou CoffeeScript comme dans un module `.civet.mjs` ou `.coffee.mjs` importé. Un reffet
> (`µeffect`) qui lit la clé repart sur une telle écriture faite ailleurs. L'élément n'est cherché
> qu'une fois par écriture : le prédicat n'est pas rappelé pour `+=` ou `++`. Un `find` qui ne trouve
> rien lève l'erreur de JavaScript, celle de l'écriture (`TypeError: Cannot set properties of
> undefined`), comme sans MJS. Sur un magasin typé, la règle contrôle l'écriture faite par `find`
> comme celle faite par le chemin. `delete` rend `true`, comme en JavaScript.
>
> **Sécurité.** Une clé venue de **données** — l'adresse de la page, un champ de formulaire, le message d'un autre
> utilisateur, un JSON reçu — peut valoir `'__proto__'`, `'constructor'` ou `'prototype'`. Une écriture du magasin par
> un chemin qui part de sa racine (`$$prefs[section][champ] = v`, `$$taches[0][champ][k] = v`, avec `+=`, `||=`, `++`,
> `delete` ou une méthode : `$$liste[champ].push(x)`) refuse ces trois noms, à n'importe quel rang : rien n'est écrit,
> et la console nomme le segment refusé (« chemin d'état refusé (segment « __proto__ ») — mutation ignorée. »). Sans ce
> refus, avec `section` valant `'__proto__'`, l'écriture irait dans le modèle commun de tous les objets de la page
> (`Object.prototype`), et `champ` apparaîtrait sur chacun d'eux, les vôtres comme ceux des bibliothèques (« pollution
> de prototype »). Une clé convertie en texte compte comme ce texte (`['__proto__']`, un objet dont `toString` rend
> `'__proto__'`) : convertie une seule fois, elle est comparée puis écrite telle quelle. Un indice ou un symbole ne sont
> jamais refusés. Un `µStore` (`store.data`) et un `µ.state` maniés en JavaScript refusent aussi d'écrire dans un prototype qu'une telle clé y a rangé (`Array.prototype`, `Object.prototype`) : `push`, `splice`, une affectation, `Object.assign`, `delete` n'y écrivent rien, avec le même message, comme l'état d'un composant ([03 · Réactivité](03-reactivite.md)) ; retiré d'une liste (`pop`, `shift`, `splice`), il sort muré de même. Limites de ce refus : une valeur lue par un descripteur (`Object.getOwnPropertyDescriptors(store.data)`) ou sous un objet gelé sort brute. Le comparateur d'un `sort` reçoit les éléments bruts. Un objet dont la lecture de `constructor` lève (une fenêtre d'une autre origine) ne se range pas dans un `µ.state` ni dans un `µStore`. Un objet bâti pour que `o.constructor.prototype === o` est pris pour un prototype, et rien ne s'y écrit par eux.
>
> Les autres formes lisent d'abord l'objet écrit, comme JavaScript le lit : après un élément trouvé
> (`$$taches.find(f)[champ][k] = v`), derrière `?.` (`$$prefs[section]?[champ] = v`), dans la variable de travail de
> CoffeeScript (`$$prefs[section][champ] ?= v`, `or=`, `and=`), par une clé faite d'une expression
> (`$$prefs[req.section][champ] = v`), par une variable ou un alias qui garde un objet du magasin (`lu := $$prefs[section]`,
> puis `lu[champ] = v`), par le paramètre d'un rappel ou la variable d'une boucle, sur le magasin comme sur une copie de
> ses objets (`for p of Object.values($$prefs)`, puis `p[section][champ] = v`), par l'élément d'une telle copie
> (`$$taches.filter(f)[0]`, ou atteint par `find`, `findLast`, `at`, `pop`, `shift` : `actives.find(g)[champ][k] = v`), dans un objet fait d'une expression (`($$prefs[section] || {})[champ] = v`), ou dans un objet
> qu'une lecture a rangé dans le magasin (`$$o.p = $$o[k]`, puis `$$o.p.x = v`). Là, `'__proto__'` mène au prototype et
> `'constructor'` à la fonction `Object` du navigateur : l'écriture refuse alors l'objet atteint — elle n'écrit jamais
> dans un prototype ni dans une fonction du navigateur (`Object`, `Array`, `Map`…, reconnue à son code natif), n'y appelle
> aucune méthode, n'y supprime rien —, rien n'est écrit, et la console nomme le segment qui mène au prototype (« chemin
> d'état refusé (segment « __proto__ ») — mutation ignorée. »), ou explique le piège d'une fonction du navigateur :
> `$$sel = $$series[cle]` puis `$$sel.values = [1]` affiche « $$sel.values : $$sel contient la fonction Object du
> navigateur, sans doute amenée par une clé venue de l'extérieur (adresse, formulaire, données reçues) ; rien n'est écrit.
> Vérifiez cette clé. » Quand `constructor` est écrit dans le code de l'écriture même (`$$taches.find(f).constructor.x = v`), la console le dit : « $$taches.….x : `constructor`, écrit dans le code, mène à la fonction Object du navigateur, que partage toute la page ; rien n'est écrit. Écrivez dans l'objet lui-même, sans `constructor`. » Une clé calculée écrite après lui (`$$equipes.find(f).constructor[cle].x = v`, `constructor` étant alors un champ de vos données) garde l'avertissement de la clé venue de l'extérieur. `'prototype'` y mène à `undefined`, comme en JavaScript : `?.` s'arrête, une autre forme lève la
> `TypeError` de JavaScript, et rien n'est écrit non plus. Une fonction de votre appli rangée dans le magasin reçoit, elle,
> l'écriture, comme dans un composant : `$$outils.format.appels += 1` écrit dans la fonction, et ce qui lit
> `$$outils.format.appels` suit.
> Une fonction rangée dans un `µ.Store` se lit par `store.data` comme dans l'état d'un composant : `f := store.data.outil.format`,
> puis `f.appels = 10`, écrit dans la fonction et prévient les lecteurs de la clé ; appelée seule, son `this` reste l'objet du
> magasin. Une fonction du navigateur y reste une copie liée, sans lien vers elle.
>
> Vérifiez tout de même une clé venue de données avant de l'employer — une écriture refusée est une donnée perdue, et
> vos autres objets (ceux de vos bibliothèques, les vôtres hors de `$` et `$$`) n'ont pas ce refus : comparez-la à la
> liste des clés permises, vérifiez que l'objet la porte déjà en propre (`Object.hasOwn`), ou rangez ces données dans
> une `Map`, dont les clés ne touchent aucun prototype. L'état local d'un composant refuse les mêmes noms
> (`$reglages[section][nom] = v`, cf. [03 · Réactivité](03-reactivite.md)).
>
> ```civet
> # refusé, rien n'est écrit, si section ou champ vaut '__proto__', 'constructor' ou 'prototype'
> $$prefs[section][champ] = valeur
>
> # refusé aussi : derrière `?.`, la section est lue comme JavaScript la lit, puis le prototype atteint est refusé
> $$prefs[section]?[champ] = valeur
>
> # correct : seules les clés connues passent
> SECTIONS := ['affichage', 'sons']
> if SECTIONS.includes(section) and Object.hasOwn($$prefs[section], champ)
>   $$prefs[section][champ] = valeur
>
> # correct aussi : une Map de Map, dont les clés ne sont pas des propriétés
> $$prefs.get(section)?.set(champ, valeur)
> ```
>
> **Ce que permet un prototype pollué.** Une propriété posée sur `Object.prototype` ne fait pas qu'apparaître : tout
> code qui lit une option **absente** reçoit cette valeur à la place de « rien » — le vôtre, celui d'une bibliothèque,
> et même le navigateur, qui lit de cette façon les options de `fetch` (`credentials`, `mode`, `body`…). Quand la valeur
> finit dans du HTML, une adresse ou un en-tête, c'est l'auteur des données qui choisit ce que fait la page : avec
> `champ` valant `'html'`, une fenêtre ouverte ensuite par un code qui lit `options.html` pose ce HTML, et le script
> qu'il contient s'exécute dans la page, avec les droits de l'utilisateur. Les modules du cœur qui reçoivent des
> options — `µ.modal.fire` et ses raccourcis, `µ.modal.notify`, `µ.ajax`, `µ.socket` — ne lisent que celles que vous
> leur passez, jamais une valeur héritée. Le cœur ne prend rien non plus sur le prototype quand il lit ses propres
> tables par un nom — la table des fichiers des composants (une balise `<mjs-…>` inconnue n'importe rien), les balises
> que le chargeur attend et les dépendances que le manifeste précharge au démarrage, les silhouettes des composants, les
> réglages des effets (recopiés aussi quand un réglage tenu par une variable change, et passés à l'animation d'un effet
> de l'appli), le type d'un toast, les langues chargées (une langue inconnue choisie par une donnée reste vide : ses
> textes retombent sur la langue par défaut, aucun fichier n'est demandé pour elle) — ni dans les requêtes qu'il envoie de
> lui-même (le journal d'erreurs, le rafraîchissement du schéma de `µ.ajax.binary`). Votre code et vos bibliothèques,
> eux, héritent. Pour vous protéger d'une pollution venue d'ailleurs — une bibliothèque, votre code hors de `$` et `$$` — :
> vérifiez la clé avant d'écrire ; dans votre code, lisez une option seulement si l'objet la porte en propre
> (`Object.hasOwn(opts, 'html')`), ou rangez vos options dans une table sans prototype (`Object.create(null)`), qui
> n'hérite de rien.
>
> Une **lecture** rend aussi ce que JavaScript rend : `lu := $$o[k]` rend `Object.prototype` pour `k`
> valant `'__proto__'`, `Object` pour `'constructor'`, `undefined` pour `'prototype'` ; l'écriture
> qui suit (`lu.x = v`, `lu.push(x)`, `delete lu.x`) refuse un prototype ou une fonction (« Sécurité » plus haut), et
> va dans tout autre objet. Une méthode absente lève la
> `TypeError` de JavaScript (« push is not a function »). Une variable qui garde le prototype d'un objet du magasin
> (`p := Object.getPrototypeOf($$o.m)`, ou `Reflect.getPrototypeOf`) se lit de même, tel quel, et son écriture est
> refusée de la même façon. Un objet du magasin que modifie une fonction — son premier argument (`Object.assign($$o.constructor, …)`,
> `Object.defineProperty`, `Reflect.set`…), écrit tel quel, premier élément d'une liste écrite étalée (`Object.assign(...[x], …)`) ou
> passé par `call`, `apply` ou `Reflect.apply` (`Object.assign.apply(null, [x, …])`), et l'objet sur lequel `call` ou `apply` appelle une
> méthode d'une liste qui la modifie (`Array.prototype.push.call($$l.find(f)[k], v)`, `[].splice.call`) — passe le même refus : un prototype ou une fonction du navigateur ne reçoit rien (la
> fonction reçoit un objet gelé : `Object.assign` lève une `TypeError`, `Reflect.set` rend `false`). `Object.freeze`,
> `Object.seal` et `Object.preventExtensions` (`Object.freeze($$m.__proto__)`) passent le même refus : ni `Object` ni
> `Object.prototype` ne sont figés. L'élément d'une copie faite par `map` ou `flatMap` (`$$l.map(f)[0][k].x = v`, sans
> prévenir de clé), la valeur que rend une méthode qui modifie la liste (`$$l.pop()`, `shift()`, `splice(i, 1)[0]`, sans
> prévenir de clé ; `sort(f)[0]`, `reverse()`, `fill(o)`), la valeur lue par `Reflect.get($$l.find(f), k)`, le champ d'un
> objet étalé (`({ ...$$o }).a`), les deux éléments d'un rappel de comparaison (`$$l.sort((a, b) => …)`, `toSorted`) et
> l'accumulateur de `reduce` ou `reduceRight` sans valeur de départ passent le même refus ; de même la valeur que rend l'itérateur
> d'une copie (`$$l.values().next().value`), un accesseur défini sur l'objet (`$$l.find(f)[k].__defineGetter__('x', g)`,
> `__defineSetter__`) et le nom qui reçoit un élément par un motif de liste sur une liste écrite (`[t] = [$$l.find(f)]`, en
> JavaScript, CoffeeScript et Civet). Une clé calculée de la chaîne (`$$l.find(f)[k].x = v`, `?.[k]` compris) est jugée : une clé
> `constructor`, `__proto__` ou `prototype` que l'objet lu n'a pas en propre et qui mène à une classe de votre appli ou à son prototype
> est refusée, comme par l'enveloppe d'un composant — la chaîne lit `undefined`, l'écriture lève la `TypeError` de JavaScript ; vers une
> fonction ou un prototype du navigateur, l'écriture est refusée sans erreur, comme plus haut. `constructor` écrit dans le code y écrit
> (`$$l.find(f).constructor.compte = 0`). Écrivent comme JavaScript, sans refus — vérifiez alors une clé venue de l'extérieur : la clé
> calculée d'un motif (`const { [k]: c } = $$l.find(f)`, puis `c.x = v`), les deux éléments que reçoit une fonction de comparaison
> nommée (`$$l.sort(cmp)`, puis `a[k].x = v` dans `cmp`), une fonction appelée sous un autre nom
> (`const { assign } = Object`, `Object['assign']`, `globalThis.Object.assign`), et un objet du magasin que votre code passe à une fonction de votre appli (`ecrire($$l.find(f), k)`, `t = $$l.pop()` puis `ecrire(t, k)`, un gabarit étiqueté compris) ou rend par `return` (`g = () => $$l.find(f)`, puis `g()[k].x = v`). Une écriture relue dont la valeur attend un `yield` (`$$l.find(f)[k].x ||= yield v`) reçoit l'objet gelé à la place
> d'un prototype ou d'une fonction du navigateur, et s'écrit sans prévenir la clé.
>
> Une **autre variable du même nom** n'est pas celle-là. Le `t` d'une autre boucle, d'un autre rappel ou d'une autre
> fonction, qui ne tient pas un objet du magasin, écrit comme JavaScript : le prototype d'une classe de votre appli
> reçoit sa méthode, la clé `constructor` d'un objet ordinaire s'écrit, un accesseur est appelé même pour une valeur
> égale (`img.src = img.src`), et aucune clé du magasin n'est prévenue. Quand ce nom est celui d'une variable déclarée
> ou affectée (`=`) d'une lecture du magasin (`lu := $$prefs[section]`), une autre variable de ce nom (un paramètre,
> dans une autre fonction) refuse seulement d'écrire dans le prototype d'une classe du langage (`Object.prototype`,
> `Array.prototype`, `Function.prototype`…, ceux d'une autre page compris) ou dans une classe du langage (`Object`), où
> mènent `'__proto__'` et `'constructor'` venus de données — avec le même message.
>
> Une variable qui garde cet élément est suivie de même : en Civet, sa déclaration
> (`tache := $$taches.find(…)`, ou `tache = …` à sa première apparition, dans un bloc compris) ; en CoffeeScript, où chaque
> variable s'écrit `tache = …`, celle qui n'est affectée qu'une seule fois dans sa fonction, hors
> d'une boucle. Les règles prudentes ci-dessus valent pour elle. Elle vise l'**objet** qu'elle tient :
> `tache.fait = true` écrit dans cet objet, même après un `unshift`, puis prévient la clé, comme
> tout alias du magasin.
>
> ```civet
> # NOTIFIE : écriture à travers l'élément trouvé, la clé racine 'taches' est prévenue
> $$taches.find((t) -> t.id == id).fait = true
> $$carte.get(k)?.vus += 1
> tache := $$taches.find((t) -> t.id == id)
> tache.tags.push('urgent')
> ```
>
> La variable d'un `{for t in $$taches}` du gabarit prévient la clé de même : `@click={t.fait = true}`
> écrit dans l'élément, puis redessine ; sur un store typé, l'écriture passe par la règle du champ
> (cf. [37 · Types](37-types.md)). La variable d'une boucle du `<script>` aussi, dans les trois
> langues : Civet `for t of $$taches` (ou `for t in $$taches`), JavaScript `for (const t of $$taches)`,
> CoffeeScript `for t in $$taches`. Elle n'est suivie que là où elle vit — sa boucle en Civet et en JavaScript, sa
> fonction en CoffeeScript, qui la déclare en tête de fonction : le `t` d'une autre boucle, sur une liste hors du
> magasin, écrit comme JavaScript (« Sécurité » plus haut). CoffeeScript lit la liste par une variable qu'il nomme lui-même
> (`ref`, comme pour un `?.`) et qu'il déclare dans chaque fonction : deux boucles sur deux stores,
> dans deux fonctions, préviennent chacune leur clé. Une variable affectée dans une boucle
> (`u = $$taches[0]`) prévient la clé aussi.
>
> **Le paramètre d'un rappel est suivi aussi.** Le paramètre qui reçoit l'élément d'un rappel écrit
> sur place (`$$taches.forEach((t) -> t.fait = true)`, de même `map`, `filter`, `some`, `every`,
> `flatMap`, `find`, `findLast`, `findIndex`, `findLastIndex`, le second paramètre de `reduce` et de
> `reduceRight`, le `forEach` d'une `Map` ou d'un `Set`) écrit dans l'élément, puis prévient la clé du
> store d'où vient l'élément. De même le rappel de `Array.from($$taches, f)`, celui de
> `Array.prototype.forEach.call($$taches, f)` et une méthode écrite en clé littérale (`$$taches['forEach'](f)`).
> Il n'est suivi que dans son rappel : un paramètre du même nom, dans un rappel sur une liste hors du
> magasin, écrit comme JavaScript (« Sécurité » plus haut).
>
> **Une copie garde les objets du magasin.** `filter`, `slice`, `concat`, `flat`, `toSorted`,
> `toReversed`, `toSpliced`, `with`, `values()` et `entries()` (d'une liste ou d'une `Map`),
> `Object.values($$prefs)`, `Object.entries($$prefs)`, `Array.from($$taches)` et `[...$$taches]` rendent
> une liste neuve : l'écrire (`copie.push(x)`, `copie.splice(0, 1)`) n'écrit qu'elle, et ne redessine
> rien. Ses éléments, eux, sont ceux du magasin : la variable d'une boucle sur la copie
> (`for t of $$taches.filter(…)`, `for [cle, p] of Object.entries($$prefs)`, `for v of $$carte.values()`),
> le paramètre d'un rappel sur elle (`$$taches.filter(…).forEach((t) -> …)`) et son élément
> (`$$taches.filter(…)[0].fait = true`, ou atteint par `find`, `findLast`, `at`, `pop`, `shift` :
> `actives.find((t) -> t.id == id).fait = true`, `while t = copie.shift()`) écrivent dans l'objet du magasin, puis préviennent sa clé,
> même quand une variable tient la copie (`actives := $$taches.filter(…)`, puis `for t of actives`). Le
> résultat de `map` et de `flatMap` n'est pas suivi : leur rappel rend souvent des objets neufs
> (`$$taches.map((t) -> ({ ...t, vu: true }))`), qu'on écrit comme en JavaScript, sans prévenir de clé — mais il peut
> rendre les objets mêmes (`map((t) -> t)`) : une écriture par son élément refuse un prototype ou une fonction du
> navigateur. Une copie retournée ou triée sur place (`$$taches.slice().reverse()`) reste une copie. Une copie profonde
> (`structuredClone($$taches)`, `JSON.parse(JSON.stringify($$taches))`) n'est plus le magasin non plus.
>
> Ces formes valent dans les trois langues, dans un composant comme dans un module `.civet` ou
> `.coffee` importé : la clé de données qui mène au prototype est refusée (« Sécurité » plus bas), et,
> sur un store typé, la règle du champ contrôle l'écriture (cf. [37 · Types](37-types.md)).
>
> Un objet du magasin gardé dans une variable `$` d'un composant suit toujours les écritures faites par le magasin, quelle que soit
> la façon dont la variable l'a reçu : `@click={$sel = $$liste[0]}`, `$sel = $$liste.find(f)`, la liste entière (`$l = $$liste`), une
> prop (`item={$$liste[0]}`, la ligne `r` d'un `{for r in $$liste}`), la ligne gardée par son gestionnaire (`@click={$sel = r}`), un
> élément d'une valeur dérivée (`$visibles = $$liste.filter(f)`), l'objet rendu par une fonction d'un module (`$sel = premier()`). Un
> champ écrit par le magasin (`$$liste[0].nom = v`), ou plus bas (`$$liste[0].adresse.ville = v`), par le composant, par un autre
> composant ou par une fonction du fichier du magasin, redessine chaque composant qui le garde : le second de deux composants qui
> gardent le même objet, l'enfant qui le range dans une autre variable (`$sel = $item`), un composant retiré puis remis, l'enfant lié
> qui le tient (`v=!{$sel}`), avec l'enveloppe comme sans elle (`"proxy": false`). L'objet d'un état de module (`µ$$panier`) gardé
> dans une variable suit de même. Une écriture redessine une fois chaque composant qui garde l'objet, et aucun autre ; le parent qui
> repose ensuite le même objet à un enfant ne le redessine pas une seconde fois.
>
> Un nom pris sur un chemin fixe du magasin (`t := $$s.a.b`, `sheet = $$liste[slot]` en CoffeeScript, `f = $$flame`) puis écrit par
> une affectation simple (`t.c = 5`) prévient comme l'écriture directe `$$s.a.b.c = 5` : l'enfant qui tient `$$s.a` se redessine. Le
> chemin est relu au moment de l'écriture ; s'il ne mène plus au même objet (objet remplacé, `slot` changé entre-temps), l'écriture
> va à l'objet que tient le nom, comme en JavaScript. Ne suivent pas ce chemin, et gardent l'écriture d'aujourd'hui (`µrefresh($$s)`
> pour l'enfant qui tient un objet plus haut, cf. [41](41-refresh.md)) : `t.c += 1`, `t.c++`, `delete t.c`, une méthode (`t.l.push(x)`),
> un nom réaffecté ou pris sur un appel (`t := $$l.find(f)`), une clé qui agit, une écriture faite dans un module `.civet` ou
> `.coffee` importé. Ne sont pas prises non plus, et demandent `µrefresh($$s)` :
> une écriture plus profonde que le nom (`fiche.suite.champ = v` quand `fiche` est le nom pris), un nom pris sur une clé qui n'est plus à portée au moment de l'écriture (`trouve = $$s.items[k]` dans une boucle sur `k`, puis `trouve.c = 5` après elle), `t.n += f()`, `t.l.push(f())`. De même, une écriture plus bas par la variable d'une boucle (`for t in $$liste` puis `t.adresse.ville = v`) ne redessine pas : `µrefresh($$liste)` reste requis.
>
> Ce suivi n'entre dans l'appli que si l'un de ses fichiers range un objet du magasin, ou d'un état de module, là où une variable
> peut le prendre : une variable ou une prop qui le lit, un nom qui le garde (`t := $$liste.find(f)`), une valeur dérivée ou une
> fonction qui le rend, une boucle du script, une fonction de l'appli qui le reçoit (`garder($$liste[0])`), la ligne d'un `{for}` du
> magasin passée à un composant ou gardée par son gestionnaire. Une valeur simple lue dans le magasin (`$n = $$liste.length`, un
> calcul, une comparaison, `µlang`) n'en est pas ; une valeur dont la sorte ne se lit pas dans le code (`count={$$compte}`,
> `{fmt($$prix)}`) l'y fait entrer. Une appli qui lit le magasin pour l'écran et en écrit les champs, sans ranger aucun de ses objets,
> n'en paie ni un octet ni une opération.
>
> Trois écritures ne préviennent que certains détenteurs :
>
> - par la variable d'un composant (`$sel.nom = v`) : ce composant, et le parent lié qui le lui a donné (`v=!{$sel}`), pas les autres
>   composants qui gardent le même objet — un objet de l'état d'un composant se conduit ainsi dans toutes les applis ; pour qu'ils
>   suivent tous, écrivez par le magasin (`$$liste[i].nom = v`) ;
> - par un élément trouvé puis plus bas (`$$liste.find(f).adresse.ville = v`, ou `t := $$liste.find(f)` puis `t.adresse.ville = v`) :
>   le composant qui garde l'objet écrit (l'adresse) ou la liste entière, pas celui qui garde l'élément trouvé ; pour lui, écrivez
>   par le chemin (`$$liste[i].adresse.ville = v`) ;
> - dans un état de module, plus bas que l'objet gardé (`µ$$panier.items[0].adresse.ville = v`) : le composant qui garde l'objet
>   écrit, la valeur de la clé (`items`) ou l'état entier, pas celui qui garde `items[0]` ; pour lui, écrivez un champ de l'objet
>   qu'il garde (`µ$$panier.items[0].adresse = { ...µ$$panier.items[0].adresse, ville: v }`).
>
> Restent hors de ce suivi, et n'y redessinent rien (la valeur change, l'écran non) :
>
> - un élément passé à une fonction nommée qui l'écrit de son côté (`marquer = (t) -> t.fait = true`,
>   puis `marquer($$taches[0])`, ou `$$taches.forEach(marquer)`) : MJS ne suit pas une valeur d'une
>   fonction à l'autre — écrivez dans un rappel posé sur place, ou par le chemin ;
> - le troisième paramètre d'un rappel, qui tient la liste elle-même
>   (`$$taches.forEach((t, i, liste) -> liste[i].fait = true)`) ;
> - la variable du `<script>` écrite par un gestionnaire ou une liaison du gabarit
>   (`@click={tache.fait = true}`, `value=!{tache.nom}`) ;
> - le résultat de `map` ou de `flatMap`, même quand le rappel rend l'élément tel quel
>   (`$$taches.map((t) -> t)[0].fait = true`), et `+=` ou `++` dont la clé calculée est une expression
>   (`[i + 1]` : un nom ou un littéral seulement).
>
> Écrivez alors par le chemin (`$$taches[i].fait = true`), ou par `find` à l'endroit même de
> l'écriture.
>
> ```civet
> # NOTIFIE : mutation écrite en clair, la clé racine 'panier' est suivie
> $$panier.articles.push(article)
>
> # NE NOTIFIE PAS : la mutation a lieu DANS une fonction, sur un simple paramètre
> ajouterArticle = (liste, item)-> liste.push(item)
> ajouterArticle($$panier.articles, article)   # panier réellement muté, mais aucun re-rendu
> ```
>
> La voie sûre : muter `$$obj.a` en clair, à l'endroit même où c'est lu — jamais passer un
> sous-objet du store à une fonction qui le mute de son côté.
>
> **Un fichier `.js` est une bibliothèque, copiée telle quelle**, sans µ, seuls ses imports d'autres bibliothèques de l'appli réécrits vers leur nom à empreinte ; un module qui se sert de `µ` ou d'une rune (`µajax`, `µafter`…), écrite en clair ou par un échappement Unicode, s'écrit `nom.js.mjs`, compilé comme un module `.civet` (µ fourni, la forme appelable de `µajax` réécrite) : un magasin reçu en argument y
> est un objet ordinaire, et une écriture faite là-bas change la valeur sans rien redessiner —
> pour le magasin entier (`$$ui`) comme pour un sous-objet (`$$ui.a`). Le build et les tests
> restent verts, la vue ne bouge plus. Un module `.civet.mjs` ou `.coffee.mjs` n'y change rien quand le
> magasin lui est passé en argument : l'écriture n'y est suivie que si `$$x` est écrit en clair
> dans le module lui-même.
>
> ```civet
> # fx.js : export function raiseFx(ui, spec) { ui.coinFx = spec }
> raiseFx($$ui, 'etincelle')   # NE NOTIFIE PAS : $$ui part brut, l'écriture a lieu DANS le .js
> $$ui.coinFx = 'etincelle'    # NOTIFIE : écrite en clair, dans le composant
> ```
>
> Trois voies sûres : écrire dans le magasin depuis le composant ; faire **renvoyer** la valeur par
> la fonction et l'écrire dans le composant (`$$ui.coinFx = fxOf('etincelle')`) ; ou écrire le
> module en `.civet` / `.coffee` et y écrire `$$ui.coinFx = spec` en clair, sans recevoir le
> magasin en argument.
>
> Le build prévient quand la fonction du `.js` écrit directement dans le paramètre qui reçoit le
> magasin : il relit le fichier, et un `$$x` (ou un chemin dedans) donné en argument à une fonction
> qui fait `ui.coinFx = spec`, `ui.items.push(x)`, `delete ui.a` ou `Object.assign(ui, …)` — sur le
> paramètre, sur un de ses membres, sur un alias simple (`const u = ui`) ou sur un paramètre
> déstructuré (`({ items }) => items.push(x)`) — sort un avertissement `reactivity`, une ligne par
> magasin écrit, qui nomme la fonction, le magasin, le fichier `.js` et la ligne de l'écriture
> (cf. [32 · CLI et configuration](32-cli-et-configuration.md)). Une fonction qui ne fait que lire
> son argument, ou qui rend une valeur neuve, ne donne rien : `$$ui = regler($$ui, v)` reste muet
> tant que `regler` n'écrit pas dans `ui`.
>
> Le build ne devine pas : il ne voit pas une écriture faite plus loin, par une autre fonction à
> laquelle la première passe son paramètre, ni une écriture faite sur un élément pris en parcourant
> le paramètre (`for (const x of ui.items) x.done = true`), et se tait quand le fichier ne se lit
> pas ou ne s'analyse pas, quand il pèse plus de 1 Mo (un module de cette taille n'est pas lu),
> quand la fonction n'y figure pas (ré-export depuis un autre fichier, valeur calculée), ou quand
> le nom du paramètre est lié ou réaffecté ailleurs dans la fonction.
> `"lint": { "reactivity": false }` coupe l'avertissement, avec les autres cas de ce type. Ne sont
> pas signalés non plus : un magasin rangé dans un objet ou un tableau littéral, un magasin passé
> par une variable intermédiaire, `µlang` et `µtheme`.

> ⚠️ **Ne jamais `Object.assign` un JSON externe dans un store.** `Object.assign($$cfg, JSON.parse(texte))` copie toutes ses clés, comme JavaScript : une clé `__proto__` dans le JSON remplace le prototype de `$$cfg` lui-même. Ne copiez que les clés permises (cf. « Sécurité » plus haut).

> ⚠️ **Lire `__proto__`/`constructor`/`prototype` à travers un `µStore` (`µ$$x`, `store.data`) ou un `µ.state` rend `undefined` sauf si cette clé a été posée explicitement dans les données** (ex. `{ constructor: 'Ferrari' }`, qui reste lisible et réactive normalement) — une clé HÉRITÉE de ce nom ne fuite jamais telle quelle hors de leurs données. Ce n'est PAS le cas du magasin `$$` : `$$o[k]` rend ce que rend JavaScript (`Object.prototype` pour `'__proto__'`, `Object` pour `'constructor'`, cf. « Sécurité » plus haut) ; l'état local d'un composant (`$o[k]`) rend `undefined`, comme un `µ.state` ([03 · Réactivité](03-reactivite.md)). Cette même garde masque `.constructor` à travers un objet réactif d'un `µStore` ou d'un `µ.state` : pour connaître le nom de la CLASSE réelle d'une instance qui y est rangée, utilisez `instanceof` ou `Object.getPrototypeOf(...)`, jamais `.constructor.name` directement sur la valeur lue. L'instance `µStore` elle-même (`store[k]`) est un objet ordinaire : `store.constructor` est sa classe.

> ⚠️ **Un même objet rangé sous deux clés racines** (`new µStore({a: partage, b: partage})`, `µ.state({a: partage, b: partage})`) : muter via une clé notifie aussi les lecteurs de l'AUTRE clé — les deux pointent le même objet, la mutation les concerne toutes les deux. Ce qui NE change pas d'un mécanisme à l'autre : l'**identité** des proxys rendus. `µStore` construit un proxy **distinct par clé** (`store.data.a !== store.data.b`, même s'ils enveloppent le même objet brut) ; `µ.state` construit un proxy **unique par objet**, partagé (`state.a === state.b`). Un objet qui n'est atteint que par une seule clé ne reçoit toujours qu'une notification par mutation, dans les deux cas. Un **même composant** abonné aux DEUX clés à la fois n'est, lui non plus, invalidé qu'**une seule fois** par mutation — jamais une fois par clé partagée — dans les deux mécanismes.

## Ne pas exporter de `$foo` réactif

Les variables réactives d'instance (`$foo`) sont liées à **une instance** d'un composant, pas au module : ne les `export`-ez pas pour faire du partage d'état. Pour partager, utilisez un `µ$$`, un `µStore`, ou un `§` contexte selon la portée voulue.

## Lire une clé que le serveur n'a peut-être pas garnie

Le store zéro-import `$$x` (→ `µ.store.x`) se remplit typiquement au boot depuis la balise
`<script type="application/json" id="__mjs_store">` (cf. [SSR](19-ssr.md#2-bis-poser-la-balise-soi-même-sans-ssr) —
fonctionne aussi **sans SSR**, une appli Rails classique peut la poser à la main). Cette fusion a
lieu **avant que le moindre composant ne monte** : aucune déclaration n'est nécessaire nulle part,
`$$me` et `$$settings` sont lisibles depuis n'importe quel module dès la première ligne.

Une clé que le serveur n'a pas envoyée vaut `undefined`, et `$$settings.theme` lève alors une vraie
erreur. C'est le comportement voulu : mieux vaut planter franchement que rendre une page à moitié
garnie sur des données absentes. La parade est **au point de lecture**, avec l'accès optionnel :

```html
<p>Thème : {$$settings?.theme ?? 'clair'}</p>
<p>Bonjour {$$me?.pseudo}</p>
```

Les trois situations où une clé manque, et où l'accès optionnel s'impose :

- le composant est ouvert **hors du serveur** qui pose la balise — aperçu de tutoriel, banc, page
  d'essai ;
- la page est **prérendue** puis servie en fichier figé, sans application derrière ;
- le serveur **rend la page pour un visiteur non connecté** : l'utilisateur courant est nul, la clé
  n'est pas émise.

## Récapitulatif des symboles partagés

| Forme | Mécanisme | Déclaration | Consommation |
|---|---|---|---|
| `µ$$x` | Symbole store léger (valeur unique partagée) | `export µ$$x = …` dans un module | `µ$$x` (lecture/écriture directes) |
| `µStore` / `µ.Store` | Classe d'état structuré | `export s = new µStore({…})` | `µ$$x` (après import, lecture/écriture des champs) |
| `µload(url, { refresh })` | Magasin chargé : la réponse d'une adresse, `data` / `pending` / `error` | `$x = µload(url)` dans un composant, ou dans un module | `$x.data`, `$x.pending`, `$x.error`, `$x.refresh()` ; `µload.refresh(url)` |
| `§§x` | Symbole de lecture/écriture réactive — contexte de sous-arbre, toujours (cf. [Contexte](13-contexte.md)) ; jamais un import de singleton, ni léger ni `µStore` (voir `µ$$x` ci-dessus) | `§§x = …` (déclaré par un ancêtre) | `§§x` (lecture = abonnement, écriture = invalidation) |

> 🔗 À ne pas confondre avec `§` (contexte d'arbre, scopé à un ancêtre — chapitre [Contexte](13-contexte.md)) ni avec `µ$` (variable réactive universelle, même moteur que `µ$$` mais sémantique « variable » et non « store »).

Après un point, `$$x` n'est pas le store mais une propriété : `obj.$$x` lit la propriété `$$x` de `obj`, dans le `<script>` comme dans le gabarit, comme `obj.$x` lit sa propriété `$x`. Une plage ou une décomposition (`[1..$$n]`, `[...$$liste]`) lit bien le store.

---

📚 **Apprendre en pratiquant** : ce chapitre correspond à la section **Stores** du tuto interactif (chapitre *ModularJS Avancé*) — plusieurs composants partageant un même compteur via un module dédié.
