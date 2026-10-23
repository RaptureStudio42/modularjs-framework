# 11 · État brut — `µraw`

> 📚 Tuto interactif correspondant : **Chapitre 10 — État brut**. Les encarts 🎓 *Pour débutants* dépliables donnent l'explication pas-à-pas ; le corps de la page reste la référence dense.

`µraw(données)` marque une structure comme **non réactive en profondeur** : MJS n'installe aucun suivi sur ses champs ni ses éléments. La **réassignation** de la variable, elle, reste pleinement réactive. C'est l'outil pour les données **remplacées en bloc** (un nouvel objet/tableau à chaque mise à jour) où tracer les mutations partielles serait du gaspillage — puisqu'il n'y en a jamais.

## Syntaxe

```html
<script>
  $data = µraw(poll())          # $data est une variable réactive…
                                # …mais le tableau qu'elle contient n'est pas tracé champ par champ

  µeffect ->
    timer = setInterval ->
      $data = µraw(poll())      # on REMPLACE en bloc → re-rendu déclenché
    , 200
    -> clearInterval(timer)
</script>
```

À chaque tour, `poll()` renvoie un **nouveau tableau** qui remplace l'ancien. La réassignation `$data = …` est réactive et déclenche le re-rendu ; mais MJS ne perd pas de temps à envelopper chaque valeur du tableau dans un proxy de suivi.

<details>
<summary>🎓 <b>Pour débutants</b> — réactif « en profondeur », ça veut dire quoi&nbsp;?</summary>

Avec un `$` normal, MJS surveille **tout** : la variable elle-même, mais aussi chaque champ des objets et chaque case des tableaux qu'elle contient. Vous pouvez faire `$liste[3].nom = 'x'` et l'affichage suit. Ce suivi a un coût : MJS doit « emballer » chaque sous-valeur.

`µraw` dit : « cette donnée, je la remplacerai toujours en entier, jamais case par case — ne surveillez pas l'intérieur ». MJS ne surveille alors que la **variable** : dès que vous lui donnez une **nouvelle** valeur (`$data = …`), l'écran se met à jour. Mais modifier l'intérieur (`$data[0] = …`) ne déclenche rien. Vous gagnez en performance là où le suivi fin ne servait à rien.

</details>

## Réassigner, ne pas muter

C'est le point à retenir. `µraw` ne suit **pas** les mutations en place :

```html
<script>
  $prices = µraw([10, 20, 30])

  # ✗ ne re-rend PAS — mutation en place d'un raw :
  #   $prices.push(99)
  #   $prices[0] = 0

  # ✓ nouvelle référence → re-rendu :
  ajouter = -> $prices = µraw([...$prices, 99])
</script>
```

> ⚠️ Muter un `µraw` en place (`$prices.push(…)`, `$prices[0] = …`) ne met **pas** à jour le DOM : aucun suivi ne couvre ces changements. Pour rafraîchir l'affichage, créez une **nouvelle référence** et réaffectez. C'est exactement le pattern *immuable* (façon Redux).

### Listes `µraw` affichées par `{for}`

Quand une liste `µraw` est remplacée, MJS ne relit pas les lignes qui n'ont pas bougé. Une ligne est laissée telle quelle si toutes ces conditions sont réunies :

- l'élément est le **même** qu'avant, à la **même position** ;
- l'élément est une valeur simple (nombre, texte) ou un objet lui-même marqué `µraw` ;
- la ligne ne lit que son élément et sa position : texte `{ligne.champ}`, `{index}`, attributs construits avec eux seuls, classe par sélection `@class{$choix === ligne.id}`.

Une ligne qui lit une variable du composant, appelle une fonction, ou contient un `{if}`, un `{for}` ou un composant est toujours relue.

```html
<script>
  $lignes = µraw([])

  # chaque élément est µraw, la liste aussi : seules les lignes remplacées sont relues
  charger = (donnees) -> $lignes = µraw(donnees.map((d) -> µraw(d)))
</script>

{for ligne in $lignes by id}
  <li>{ligne.nom}</li>
{end}
```

> ⚠️ Ne modifiez pas sur place un élément `µraw` d'une liste `µraw` en comptant sur la réaffectation de la liste pour le rafraîchir : sa ligne n'est pas relue. Remplacez l'objet par un nouveau.

## Quand l'utiliser — `µraw` vs `$`

| Situation | Choix |
|---|---|
| État manipulé champ par champ, mutations fines attendues (`$todo.done = true`, `$liste.push(…)` depuis un handler) | `$` réactif |
| Donnée **remplacée en bloc** à chaque mise à jour (sondage d'API, flux temps réel) | `µraw` |
| Gros jeu de données figé après chargement, dont on ne lit qu'un sous-ensemble (table de 100 000 lignes virtualisée, dictionnaire) | `µraw` |
| Objet exigé **nu** par une lib tierce (Three.js, D3, contexte `<canvas>`, WebGL) qui n'attend pas de wrapper réactif | `µraw` |
| Valeur à passer à `structuredClone` (Worker, `postMessage`, IndexedDB) — un Proxy réactif n'est jamais clonable, même lu via `µread` | `µraw` |

<details>
<summary>🎓 <b>Pour débutants</b> — comment je choisis&nbsp;?</summary>

Posez-vous une seule question : **« est-ce que je vais modifier l'intérieur de cette donnée, ou la remplacer en entier&nbsp;? »**

- Vous cochez une case, vous ajoutez un élément, vous changez *un* champ → vous modifiez l'intérieur → gardez un `$` normal, qui suit ces changements.
- Vous recevez un nouveau tableau complet du serveur toutes les secondes, vous chargez une grosse table une fois pour toutes → vous remplacez (ou vous ne modifiez jamais) → `µraw`, plus léger.

Dans le doute, restez sur `$` : `µraw` est une **optimisation** pour un cas précis, pas le comportement par défaut.

</details>

## Lire / écrire un slot d'état sans réactivité — `µread` / `µwrite`

`µraw` (ci-dessus) marque une **donnée** entière comme non tracée. `µread` / `µwrite`, eux, sont un **accès ponctuel** au *même* slot qu'un `$x`, mais **hors du circuit réactif** :

- **`µread $x`** — lit la valeur courante **sans poser de dépendance**. Dans un `µeffect` ou un dérivé, le reffet ne se ré-exécute **pas** quand `$x` change.
- **`µwrite $x, v`** — écrit le slot **sans déclencher de re-rendu**.

Les **parenthèses sont optionnelles**, comme pour tout appel en Civet : `µread($x)` et `µread $x` compilent à l'identique, `µwrite($x, v)` et `µwrite $x, v` aussi. Ce qui n'est **pas** accepté : autre chose qu'un symbole d'état en premier argument, ou une valeur introduite par un signe égal plutôt qu'une virgule — `µread(compteur)`, `µwrite($x) = v` sont refusés au build.

```html
<script>
  µeffect ->
    envoyer(@panier, µread $tva)   # RÉAGIT au panier, LIT la TVA sans s'y abonner :
                                    # changer $tva NE relance PAS ce reffet
</script>
```

Ici le reffet dépend du panier mais ne fait que **consulter** `$tva` : sans `µread`, lire `$tva` normalement abonnerait le reffet et le relancerait à chaque changement de taux — rarement voulu.

> ⚠️ `µwrite` **désynchronise volontairement** la donnée et l'écran : le slot est mis à jour, mais aucun binding `{$x}` ne se rafraîchit tant qu'une écriture **réactive** (`$x = …`) n'a pas eu lieu. À réserver aux cas de perf mesurés. Pour un stockage simplement **jamais affiché**, préférez `@x` (→ `this.x`), qui vit hors de `_state` et n'a jamais été réactif.

<details>
<summary>🎓 <b>Pour débutants</b> — « lire sans s'abonner », ça sert à quoi&nbsp;?</summary>

Un `µeffect` re-tourne **tout seul** dès qu'une variable `$` qu'il **lit** change. C'est souvent l'effet recherché. Mais parfois vous voulez juste **jeter un œil** à une valeur au passage, sans que le reffet en devienne l'esclave.

Exemple : un reffet qui réagit au **panier**, mais a seulement besoin de **connaître** le taux de TVA courant. Avec `$tva` normal, changer la TVA relancerait le reffet pour rien. `µread $tva` dit : « donnez-moi la valeur maintenant, mais ne me réveillez pas si elle bouge ». `µwrite`, c'est le miroir : « changez la valeur, mais ne réveillez personne ».

Dans le doute, vous n'en avez **pas** besoin : un `$x` normal convient **99 %** du temps. `µread` / `µwrite` sont des outils de précision.

</details>

> 🔗 Voir aussi : [Réactivité](03-reactivite.md) → état profond et piège de mutation (réaffecter pour forcer le re-rendu d'un `{for}`). Le même réflexe « réaffectez une nouvelle référence » s'applique, mais pour une raison différente : avec `µraw` c'est *obligatoire* (rien n'est tracé à l'intérieur), avec un `$` c'est un contournement du suivi statique.

---

📚 **Apprendre en pratiquant** : ce chapitre correspond au **Tuto interactif n°10 (État brut)** — `µraw` sur un cours boursier sondé toutes les 200 ms, remplacé en bloc à chaque tour.
