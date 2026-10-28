# 30 · Modules cœur & personnalisation

> 📚 Pas de chapitre de tuto interactif dédié : cette page se suffit à elle-même. Les encarts 🎓 *Pour débutants* dépliables donnent l'explication pas-à-pas ; le corps de la page reste la référence dense.

Une petite bibliothèque de composants **prêts à l'emploi**, livrée avec le framework : un menu déroulant, une enveloppe de champ, une case à cocher, un bouton radio, un interrupteur, une pastille de couleur, un éditeur de texte riche avec sa barre d'outils, une liste triable par glisser, un bloc de code à copier, une image (module à part, voir [35 · Images](35-images.md)), des graphiques (module à part, voir [39 · Graphiques](39-graphiques.md)), et des composants animés — un carrousel, un paquet de cartes, des onglets, un menu circulaire ou en tiroir, une horloge, un bouton rotatif, un compteur à jauge, un cercle de progression, un cube lumineux. Chacun gère lui-même le clavier, le lecteur d'écran et sa participation à un `<form>` natif — et chacun est **100&nbsp;% stylisable** depuis votre propre CSS, sans jamais avoir besoin d'un `!important`.

Leurs formes (un interrupteur en triangle, un minuteur, un tiroir…) se choisissent toutes par `layout="…"`, comme les modèles d'un composant du projet — cf. [31 · Thèmes & modèles](31-themes.md#layout--les-modèles-dun-composant).

## Le raccourci `<@@nom>`

Un module cœur s'écrit avec **deux** `@` : `<@@nom>`. Il compile en `<mjs-core-nom>` et entre au bundle **automatiquement** dès qu'une balise le référence — rien à importer, rien à déclarer. Un seul `@` (`<@nom>`) désigne toujours un composant **du projet** : les noms des modules cœur ne prennent donc aucune place dans votre projet, un composant `select.mjs` à vous et `<@@select>` coexistent. Détail complet du mécanisme (les deux espaces de noms, erreurs de frappe) : [15 · Éléments spéciaux](15-elements-speciaux.md) → *Les raccourcis `<@nom>` et `<@@nom>`*.

En fichiers séparés (`"js": "split"`, le défaut), un module cœur est un fichier comme un autre, chargé quand sa balise paraît : il peut arriver après sa page. En attendant, sa balise est invisible mais garde sa place — celle de son contenu, et celle que la page lui réserve (`mjs-core-number { display: block; height: 3rem }`) : rien ne bouge quand il paraît. Détail : [32 · CLI et configuration](32-cli-et-configuration.md) → *`js`*.

```html
<@@select name="country" value=!{$country}>
```

**Une prop en deux mots** s'écrit avec un tiret sur la balise : `empty-label="Rien"`, `ok-label="Valider"`. C'est la seule écriture des attributs des modules du cœur : écrite en dur en camelCase (`emptyLabel="Rien"`), une prop arrête la construction, qui donne la bonne écriture. Le module la recevrait pourtant : le HTML met les noms d'attributs en minuscules (`emptylabel`), et une prop déclarée reçoit l'attribut de son nom écrit en minuscules (voir [Props & attributs](04-props.md)) ; le refus garde une seule écriture :

```
[bundler] …/src/page.mjs : <@@field okLabel=…> — écrivez ok-label : sur un module du cœur, un attribut écrit en dur s'écrit à tirets, comme dans sa documentation. Écrit ainsi, okLabel arriverait en minuscules (oklabel) et le module le recevrait pourtant sous son nom : la construction n'en garde qu'une écriture.
```

Liée, `emptyLabel={$x}` marche aussi, comme `empty-label={$x}`. Les attributs `data-*` et `aria-*`, les attributs natifs (`tabIndex`) et vos propres composants ne sont pas concernés.

## Libellés par défaut et langue de la page

Les textes qu'un module cœur écrit lui-même (le nom d'un bouton pour un lecteur d'écran, le texte d'attente d'une liste, « Copié ! ») existent en français et en anglais. La langue de la page choisit : `<html lang="en">` (ou `µlang` à `en`) donne l'anglais ; `fr`, une autre langue ou aucune langue donne le français. Quand `µlang` change, les libellés par défaut suivent aussitôt, sans remonter le module.

Un libellé écrit sur la balise (`label="Copiez"`, `placeholder="Pays"`) l'emporte toujours, dans toutes les langues.

| Module | Attribut | Français | Anglais |
|---|---|---|---|
| `<@@carousel>` | `prev-label`, `next-label` | « Précédent », « Suivant » | « Previous », « Next » |
| `<@@code>` | `label`, `copied-label` | « Copier le code », « Copié ! » | « Copy code », « Copied! » |
| `<@@select>` | `placeholder`, `search-placeholder`, `empty-label`, `other-label`, `other-placeholder` | « Choisir… », « Rechercher… », « Aucun résultat », « Autre… », « Précisez » | « Choose… », « Search… », « No results », « Other… », « Please specify » |
| `<@@number>` | `label`, `less-label`, `more-label`, `big-less-label`, `big-more-label` | « Nombre », « Moins », « Plus », « Diminuer de 10 », « Augmenter de 10 » | « Number », « Less », « More », « Decrease by 10 », « Increase by 10 » |
| `<@@gauge>` | `label` | « Nombre » | « Number » |
| `<@@knob>` | `label` | « Valeur » | « Value » |
| `<@@progress>` | `label` | « Progression » | « Progress » |
| `<@@color>` | `label` | « Couleur » | « Color » |
| `<@@editor>` | `label`, `placeholder` | « Éditeur de texte », « Écrivez ici… » | « Text editor », « Write here… » |
| `<@@toolbar>` | `label` | « Mise en forme » | « Formatting » |
| `<@@menu>` | `label` | « Menu » | « Menu » |
| `<@@clock>` | `labels` | « Heures, Minutes, Secondes » | « Hours, Minutes, Seconds » |
| `<@@chart>` | `label`, `empty-label` | « Graphique », « Aucune valeur » ; les autres textes : [39 · Graphiques](39-graphiques.md#les-textes--label-et-empty-label) | « Chart », « No values » |
| `<@@sortable>` | aucun (dictionnaire seulement) | « Ligne saisie, place 2 sur 5… », « Déplacée en place 3 sur 5 », « Déplacée dans la liste 2 sur 3, place 1 sur 4 », « Entrée dans la liste 2 sur 3, place 1 sur 3 », « Sortie vers la liste 1 sur 1, place 3 sur 5 », « Ligne posée en place 3 sur 5 », « Déplacement annulé… » | « Row grabbed, position 2 of 5… », « Moved to position 3 of 5 », « Moved to list 2 of 3, position 1 of 4 », « Entered list 2 of 3, position 1 of 3 », « Moved out to list 1 of 1, position 3 of 5 », « Row dropped at position 3 of 5 », « Move cancelled… » |

Pour une autre langue, ou pour changer un seul mot sans l'écrire sur chaque balise, le dictionnaire racine du projet surcharge ces textes sous les clés `mjs.core.<clé>` (cf. [29 · i18n](29-i18n.md#labels-framework)).

## `<@@select>` — liste déroulante

```html
<@@select name value=!{$x} search multiple sticky other disabled required placeholder search-placeholder empty-label other-label other-placeholder>
  <@@option value={…} icon={…}>libellé</@@option>
  <@@optgroup label="…">
    <@@option value={…}>libellé</@@option>
  </@@optgroup>
  …
</@@select>
```

| Attribut | Rôle |
|---|---|
| `name` | nom de champ posé sur le(s) `<input type="hidden">` internes, un par valeur sélectionnée |
| `value=!{$x}` | valeur sélectionnée, two-way — celle de l'option choisie, dans son type (`value={m.id}` remonte le nombre), ou un tableau de ces valeurs en mode `multiple` ; pour trouver l'option à montrer, les valeurs se comparent par leur forme texte : `value="18"` choisit l'option `18`, mais `0`, `""` et `false` restent trois valeurs distinctes |
| `search` | bascule la recherche : un champ de filtre apparaît en tête du panneau |
| `match` | mode de la recherche — `contains` (défaut), `starts`, `fuzzy` ou `starts-fuzzy` ; cf. « Les quatre modes de recherche » ci-dessous. `async` : la liste ne filtre pas d'elle-même, elle montre les options que votre page lui donne, par exemple après une recherche sur le serveur à chaque lettre tapée (`@search`) ; cf. « Chercher soi-même » ci-dessous |
| `sticky` | l'option choisie reste toujours visible dans le panneau ouvert, collée en haut ou en bas pendant qu'on fait défiler la liste ; sans effet avec `multiple` ; cf. « Garder l'option choisie en vue » ci-dessous |
| `multiple` | sélection multiple (coche plusieurs options, `value` devient un tableau) |
| `disabled` | désactive la liste, comme un `<select disabled>` : grisée, hors de la tabulation, elle ne s'ouvre ni à la souris ni au clavier et sa valeur ne part pas avec le formulaire ; `disabled={$x}` suit la variable (désactivée pendant qu'elle est ouverte, la liste se ferme) ; `disabled="false"` la laisse active |
| `required` | la liste est obligatoire, comme un `<select required>` : le formulaire ne part pas tant que rien n'est choisi, ou que le choix est une valeur vide (une option `value=""`, comme le texte d'attente d'une liste native) ; en `multiple`, tant que rien n'est coché ; `required={$x}` suit la variable ; cf. [Dans un formulaire](#dans-un-formulaire) |
| `icon-checked` | icône d'une option cochée, mode `multiple` seulement — texte échappé, jamais du HTML — défaut `✔` |
| `icon-unchecked` | icône d'une option non cochée, mode `multiple` seulement — texte échappé, jamais du HTML — défaut vide |
| `placeholder` | texte affiché quand rien n'est sélectionné — défaut « Choisir… » (« Choose… » en anglais) |
| `search-placeholder` | placeholder du champ de recherche — défaut « Rechercher… » (« Search… ») |
| `empty-label` | message quand le filtre ne trouve rien — défaut « Aucun résultat » (« No results ») |
| `other` | permet une réponse libre : une dernière ligne « Autre… » ouvre un champ de saisie. Seul, le texte compte 80 caractères au plus ; `other="42"` ou `other={42}` fixe le maximum ; une valeur qui n'est pas un entier d'au moins 1 (`other="abc"`, `other="0"`) donne 80 ; `other={false}` ou sans l'attribut : pas de réponse libre |
| `other-label` | texte de la ligne « Autre… » — défaut « Autre… » (« Other… ») |
| `other-placeholder` | texte d'invite du champ de réponse libre — défaut « Précisez » (« Please specify ») |

Choisir une option émet **`change`** (`e.data` = la valeur choisie, dans son type ; une copie du tableau en mode `multiple` : la modifier ne touche pas le choix), comme un `<select>` natif : rien quand on rechoisit la même option (comparaison stricte : de `0` à `''` puis à `false`, chaque choix s'annonce), ni quand la page pose elle-même la valeur. Le champ envoyé avec le formulaire est déjà à jour quand `@change` joue (et `@other`, plus bas) : `new FormData(form)`, lu dans le gestionnaire, posé sur la balise ou sur un `<form @change>`, montre le choix d'après le geste.

Chaque `<@@option value={…} icon={…}>` déclare une entrée ; `icon` est un texte affiché tel quel (emoji, caractère, petit mot) — rendu par une interpolation ÉCHAPPÉE, jamais du HTML (`<svg>`…) — ou une image : `icon={µimage('icones/euro.svg')}`, résolue au build comme toute `µimage` ([35 · Images](35-images.md)), s'affiche en `<img>` à 1,2 fois la taille du texte, dans la liste comme dans le bouton fermé ; image décorative (`alt=""`), le libellé nomme déjà l'option ; tout autre objet (`icon={{}}`) n'affiche rien. La valeur d'une option garde le type que lui donne la page : `<@@option value={m.id}>` fait remonter le nombre `18`, pas le texte « 18 » ; une option sans `value` prend son libellé pour valeur, comme une `<option>` native. Les options peuvent venir d'un `{for}` et arriver après coup (une liste chargée plus tard) : le bouton affiche alors le libellé de la valeur déjà posée dès qu'elles sont là, sans ouvrir le panneau. En choix simple, le bouton ne montre jamais qu'un libellé, et une valeur vide (`null`) n'en choisit aucun. La recherche filtre insensible aux accents et à la casse ; le clavier répond aux flèches Haut/Bas, `Enter` et Espace (choisir ; en `multiple`, cocher ou décocher, la liste reste ouverte ; dans le champ de recherche, Espace s'écrit), `Escape` (fermer), `Home`/`End` (première/dernière option), `PageUp`/`PageDown` (liste ouverte : une page visible plus haut ou plus bas, bornée à la première et à la dernière option) et les lettres (la saisie au vol, plus bas) ; le bouton porte `role="combobox"` et les attributs ARIA associés (`aria-expanded`, `aria-controls`, `aria-activedescendant`) se tiennent à jour tout seuls. Avec `search`, c'est le champ de recherche, qui a alors le focus, qui porte `role="combobox"` et `aria-activedescendant` : un lecteur d'écran annonce la ligne active à chaque flèche ; le champ est placé hors de la liste (`role="listbox"`). Deux options de même valeur s'affichent toutes les deux. Une valeur qu'aucune option ne porte (option retirée par la page, faute de frappe) laisse le bouton sur le texte d'attente et ne part pas avec le formulaire, comme avec un `<select>` natif ; tant que la liste n'a encore aucune option (options pas encore arrivées, page rendue par le serveur), la valeur posée part telle quelle. Une liste seule n'a pas de nom : donnez-lui `aria-label="…"` ou `aria-labelledby="id"` sur la balise, ou enveloppez-la dans `<@@field label="…">` ; le bouton reçoit ce nom et `aria-invalid`, et les suit s'ils changent.

**Ouvrir la liste au clavier.** Sur la liste fermée qui a le focus, la flèche haute l'ouvre comme la flèche basse, `Enter` et Espace : l'ouverture ne change pas le choix, et la ligne active est l'option choisie (la première tant que rien n'est choisi, « Autre… » quand une réponse libre est donnée). Le choix `multiple` s'ouvre de la même façon, sur la première des options choisies. Les flèches haute et basse ouvrent la liste avec ou sans Alt, Ctrl, Méta ou Maj enfoncé (Alt + flèche ouvre aussi une liste native). Une fois la liste ouverte, les flèches haute et basse déplacent la ligne active.

**Tab et Échap.** `Échap` ferme le panneau et rend le focus au bouton ; cet Échap ne remonte pas plus haut : un tiroir `<@@menu>` ou une fenêtre qui contient la liste reste ouvert (liste fermée, Échap remonte normalement). `Tab` (et `Maj+Tab`) ferme aussi le panneau, sans changer la valeur, mais laisse le focus partir où le navigateur le mène : vers le champ suivant, ou vers le bouton quand vous quittez le champ de recherche en arrière. Comme à toute fermeture, `search` part avec `''` si la recherche portait du texte. Dans le champ de réponse libre (`other`), `Tab` garde son rôle normal et passe d'un champ au bouton ✔.

**Saisie par composition (IME).** Pendant qu'une composition est en cours (de `compositionstart` à `compositionend`), le champ de recherche ne filtre pas et n'envoie pas `search` : le texte à moitié composé n'est pas encore une recherche. Le filtre et `search` partent une seule fois, à `compositionend`, avec le texte composé. Pendant la composition, aucune touche n'agit sur le panneau (Tab, Entrée, flèches, Échap appartiennent à l'IME) ; la saisie qui suit est toujours prise, même identique au texte composé.

**La ligne active reste en vue.** À l'ouverture, le panneau défile jusqu'à l'option choisie ; ensuite, aux flèches, à `Home` et `End`, et à chaque saisie dans la recherche, il ne défile que du nécessaire pour garder la ligne active visible — sous le champ de recherche, et avec le titre de son groupe quand c'est la première du groupe. Seul le panneau défile, jamais la page, et la souris ne le fait pas défiler : la ligne qu'un défilement du clavier amène sous un pointeur immobile ne devient pas la ligne active.

**Flèches droite et gauche, liste fermée.** Sur la liste fermée qui a le focus, la flèche droite choisit l'option suivante et la flèche gauche la précédente, sans ouvrir la liste : c'est un choix comme à la souris (la variable liée et le champ du formulaire sont à jour, `change` part une fois, le bouton montre le nouveau choix). Aux bords il ne se passe rien, la suite ne reboucle pas. Les options se suivent dans l'ordre de la liste, d'un groupe à l'autre ; tant que rien n'est choisi, la droite choisit la première option et la gauche ne fait rien ; une option de même valeur que celle qui est choisie est enjambée. La ligne « Autre… » n'est pas une étape : la flèche ne l'ouvre jamais, et une réponse libre déjà donnée reste en place (pour la remplacer, ouvrez la liste). En choix `multiple`, ces deux flèches ne font rien. Dans une page écrite de droite à gauche (`dir="rtl"`), elles gardent leur sens, comme sur un `<select>` natif : la droite choisit toujours la suivante. Liste ouverte, elles ne choisissent rien : elles déplacent le curseur du champ de recherche ou du champ de réponse libre. Avec Alt, Ctrl, Méta ou Maj enfoncé, la touche reste au navigateur (Alt et flèche gauche reviennent à la page précédente, par exemple).

**Saisie au vol.** Comme sur une liste native, une lettre tapée sur la liste qui a le focus va à la prochaine option dont le libellé commence par elle, sans tenir compte des accents ni de la casse (`e` trouve « Écorce »), ligatures comprises (`oe` trouve « Œuf », `fi` « ﬁn », `ss` « ß » ; la recherche de `search` aussi) ; la même lettre retapée passe à l'option suivante qui commence par elle, et reboucle au début. Des lettres tapées vite (moins d'une demi-seconde d'écart) cherchent le début du libellé, à partir de l'option où vous êtes (`bl` va à « Bleuet »), et Espace en fait alors partie (`new y` va à « New York ») ; hors d'une saisie, Espace garde son rôle. Liste fermée, l'option trouvée est choisie comme à la souris (la variable liée et le champ du formulaire sont à jour, `change` part une fois) ; une réponse libre déjà donnée reste en place, comme aux flèches ; en choix `multiple`, la liste s'ouvre sur l'option trouvée, sans rien cocher. Liste ouverte, la ligne active y va (`aria-activedescendant` la suit) et rien n'est choisi avant Entrée ; la ligne « Autre… » n'est pas une étape. Avec `search`, la liste ouverte laisse les lettres au champ de recherche, qui filtre comme avant ; fermée, elle répond à la saisie au vol comme les autres. Avec Ctrl, Alt ou Méta enfoncé, la touche reste au navigateur ; si aucune option ne commence par le texte tapé, rien ne change.

**Groupes — `<@@optgroup label="…">`**, comme `<optgroup>` en HTML : les options qu'il entoure s'affichent sous son titre, un peu en retrait, dans un groupe nommé pour les lecteurs d'écran (`role="group"`) ; une option hors groupe garde sa place. Les flèches passent d'un groupe à l'autre comme dans une seule liste, et la recherche cache un groupe dont aucune option ne correspond. Le titre suit une variable (`label={$titre}`). Un groupe sans titre (`label=""` ou sans `label`) n'a pas de ligne de titre ; ses options restent groupées.

```html
<@@select name="devise" value=!{$devise}>
  <@@optgroup label="Europe">
    <@@option value="eur" icon={µimage('icones/euro.svg')}>Euro</@@option>
    <@@option value="chf" icon="₣">Franc suisse</@@option>
  </@@optgroup>
  <@@optgroup label="Asie">
    <@@option value="jpy" icon="¥">Yen</@@option>
  </@@optgroup>
</@@select>
```

**Les quatre modes de recherche (`match`).** Accents et casse ne comptent jamais (« ALLEMA » trouve « Allemagne », « etats » trouve « États-Unis »). `contains` — le défaut — : les lettres tapées, collées et dans l'ordre, n'importe où dans l'étiquette (« lema » trouve « Allemagne », « lgq » ne trouve rien). `starts` : l'étiquette doit commencer par ce qui est tapé (« bel » trouve « Belgique », « elg » ne trouve rien). `fuzzy` : chaque lettre tapée doit se retrouver dans l'étiquette, dans l'ordre, des trous permis entre elles (« bgq » trouve « Belgique » — B·el·G·i·Q·ue ; « eqb » ne trouve rien, l'ordre est faux). `starts-fuzzy` : la première lettre tapée doit être la première de l'étiquette, le reste suit la règle `fuzzy` (« bgq » trouve « Belgique », « gq » ne trouve rien). Une valeur inconnue retombe sur `contains`.

```html
<@@select name="country" search match="starts-fuzzy">…</@@select>
```

**Chercher soi-même — `@search` et `match="async"`.** Un champ de recherche (`search`) annonce chaque saisie par l'événement **`search`** : `e.data` est le texte tapé, comme `e.data` de `change` est la valeur choisie. Quand le panneau se ferme alors que la recherche portait du texte, `search` part une dernière fois avec `''` : votre page peut remettre sa liste. Avec `match="async"`, la liste ne filtre pas d'elle-même : elle montre les options que votre page lui donne, par exemple après une recherche sur le serveur à chaque lettre tapée (`@search`). Elle sert aussi quand la page cherche dans des champs que la liste ne montre pas. Quand vous remplacez les options pendant que le panneau est ouvert, la ligne active reste valide : la première ligne si l'ancienne n'existe plus, aucune si la liste est vide. Les groupes `<@@optgroup>` se rendent comme d'habitude. Si l'option choisie n'est plus parmi les options que vous donnez, le bouton garde son libellé et son icône (en choix `multiple`, ceux de chaque valeur choisie), tels qu'on les a vus la dernière fois, tant que la valeur reste choisie (une valeur qui n'est plus choisie est oubliée, et seules les valeurs choisies sont retenues : une liste servie par un serveur ne s'accumule pas) ; quand l'option est visible, le bouton suit son texte ; une valeur dont l'option n'a jamais été vue montre le texte d'attente. Une liste qui n'écrit ni `@search` ni `match="async"` ne change pas.

```html
<script>
  $villes = []

  @cherche = (e)->
    $villes = await fetch("/villes?q=#{encodeURIComponent(e.data)}").then (r)-> r.json()
</script>

<@@select name="ville" search match="async" @search={@cherche(e)}>
  {for v in $villes by id}
    <@@option value={v.id}>{v.nom}</@@option>
  {end}
</@@select>
```

**Garder l'option choisie en vue — `sticky`.** Avec `sticky`, l'option choisie ne quitte plus le panneau ouvert. Si vous faites défiler la liste et qu'elle sort par le haut, elle reste collée en haut, juste sous le champ de recherche s'il y en a un. Si elle est plus bas que la vue, elle reste collée en bas. Elle garde son fond plein, reste cliquable et garde `aria-selected`. Cela marche aussi avec des groupes `<@@optgroup>` : l'option choisie colle dans tout le panneau, pas seulement dans son groupe (les lecteurs d'écran trouvent toujours `role="group"` et le nom du groupe). Aux flèches, la ligne active ne se cache jamais sous l'option collée. Quand le panneau est si petit qu'il ne garde pas la place d'une ligne en plus du champ de recherche et de l'option collée, l'option ne se colle plus : la ligne active reste toujours visible. Avec `multiple`, `sticky` ne fait rien.

```html
<@@select name="pays" search sticky value=!{$pays}>…</@@select>
```

**Réponse libre — `other`.** Avec `other`, la dernière ligne de la liste est « Autre… », séparée des autres par un filet ; elle est toujours là, même quand la recherche ne trouve rien et même sans aucune option. La choisir (au clic, ou avec `Enter` quand elle est la ligne active) met à sa place un champ de saisie qui prend le focus, avec un bouton ✔ pour valider, le rappel des touches et un compteur (« 12 / 80 »). `Enter` valide ; `Escape` revient à la liste sans rien changer, et « Autre… » redevient la ligne active ; toutes les autres touches n'agissent que sur le texte. Le texte est rogné puis coupé au maximum, jamais au milieu d'un caractère ; une réponse que votre page a posée et que vous n'avez pas modifiée reste telle quelle, même plus longue que le maximum. Vide, il ne fait rien. Égal au libellé d'une option (les accents et la casse ne comptent pas) ou à la forme texte de sa valeur (`18` pour l'option `{18}`), il choisit cette option, avec sa valeur. Sinon c'est une réponse libre. Le panneau d'une liste `other` mesure au moins 16rem (90 % de la fenêtre au plus) et ne sort jamais de la fenêtre : trop à droite, son bord droit suit celui de la balise, et la fenêtre le borne au besoin. Le bloc du champ (champ, ✔, indice, compteur) se voit toujours en entier : c'est le panneau qui défile pour le montrer, jamais la page.

```html
<@@select name="groupe" value=!{$groupe} other>
  <@@option value="a+">A+</@@option>
  <@@option value="o-">O-</@@option>
</@@select>

<@@select name="allergies[]" multiple other="42" other-label="Une autre allergie…">
  <@@option value="lait">Lait</@@option>
  <@@option value="oeuf">Oeuf</@@option>
</@@select>
```

Pendant la saisie, le champ et son bouton ✔ se placent sous la liste, dans le panneau, hors du `role="listbox"` (qui ne contient que des options) ; la ligne « Autre… » revient dans la liste quand la saisie se ferme. En choix simple, la réponse libre devient la valeur (`value` est le texte), la liste se ferme et le bouton montre le texte ; à la réouverture, la dernière ligne dit « Autre : le texte », cochée, et la choisir rouvre le champ avec ce texte. Choisir une option remplace la réponse libre. En choix `multiple`, chaque réponse validée est une ligne cochée de plus, après les options et avant « Autre… » ; le champ se vide et reste ouvert pour la suivante ; cliquer une ligne cochée (ou `Enter` dessus) la retire, et un texte déjà donné n'est pas ajouté deux fois. Avec `search`, ces lignes passent par le même filtre que les options, « Autre… » jamais. Les flèches parcourent les options, puis les réponses libres, puis « Autre… » ; `Home` et `End` vont à la première ligne et à « Autre… ».

Les réponses libres ne sont pas gardées à part : elles se déduisent de `value` et des options. Avec `other`, toute valeur qui n'est la valeur d'aucune option (même comparaison que pour cocher une option) est une réponse libre, qu'elle vienne d'une saisie ou que votre page l'ait posée (`value=!{$groupe}`) : l'affichage est le même. `null`, `''` et un texte fait seulement de blancs n'en sont jamais une. Sans `other`, une valeur inconnue ne choisit rien. `form.reset()` rend la valeur de départ, réponses libres comprises. Tant que les options d'une liste chargée plus tard ne sont pas là, une valeur posée par la page se montre comme une réponse libre.

`change` annonce chaque choix, une saisie validée comprise. L'événement **`other`** part ensuite quand les réponses libres changent par un geste de l'utilisateur (une saisie validée, une ligne décochée, une option qui remplace la réponse libre) : `e.data` est le texte, ou `null`, en choix simple ; une copie du tableau des réponses libres, éventuellement vide, en `multiple`. Il ne part jamais quand votre page pose elle-même la valeur, ni à la remise à zéro d'un formulaire.

Trois textes n'ont pas d'attribut : l'indice du champ (« Entrée pour valider · Échap pour revenir »), le nom du bouton ✔ (« Valider ») et le séparateur de « Autre : le texte ». Le dictionnaire du projet les change sous `mjs.core.selectOtherHint`, `mjs.core.selectOtherOk` et `mjs.core.selectOtherSep`. La jauge de largeur (voir plus bas) compte le libellé de la ligne « Autre… », pas les réponses libres : le bouton les coupe par des points de suspension, et le champ de saisie porte `maxlength`.

La partie « Autre » n'est envoyée que si l'une des listes de vos pages écrit l'attribut `other` (même `other={false}`), en dur ou lié (`other={$max}`), en développement comme en production, au serveur comme au navigateur. Dans le doute (un étalement `{...props}`, une balise dynamique qui pose `other`, un script qui nomme la balise de la liste : le `<script>` d'un composant, un module `.civet`, `.coffee`, `.js` ou `.ts` du projet), elle reste. Une liste qui reçoit `other` d'un script alors qu'aucune page ne l'écrit n'a donc pas de ligne « Autre », et la console du développement vous le signale : écrivez l'attribut dans le gabarit, lié à une variable si un script doit le changer.

**Parts** : `button`, `panel`, `search`, `option`, `other` (la ligne « Autre… »), `other-input` (le champ de réponse libre). **Variables** : `--mjs-select-bg`/`-fg`/`-border`/`-radius`/`-hover`/`-panel-bg`/`-panel-shadow`/`-selected`/`-placeholder`, plus `--mjs-select-max` (largeur préférée maximale, 22rem par défaut — cf. plus bas). `--mjs-select-placeholder` est la couleur du texte d'attente (« Choisir… » tant que rien n'est choisi, et l'invite des champs de recherche et de réponse libre) : sans elle, c'est la couleur du texte de la liste à 62 % de sa force (de quoi tenir un contraste de 4,5 pour 1 sur un fond blanc), donc elle suit le thème clair comme le sombre, et une valeur choisie garde la couleur normale. Une onzième, `--mjs-select-panel-max`, est **posée par le module lui-même** (rien à définir de votre côté) : hauteur maximale du panneau, recalculée à chaque ouverture **et à chaque redimensionnement de la fenêtre pendant qu'il est ouvert** (le clavier virtuel d'un mobile qui rétrécit la vue, typiquement), selon la place réellement disponible du côté choisi (haut ou bas), plafonnée à 280px — c'est ce qui évite qu'un panneau ouvert vers le haut dans un conteneur court sorte par le haut de l'écran, là où aucun défilement ne va le chercher. La place disponible fait toujours loi : quand elle est courte, le panneau rétrécit d'autant (deux options visibles et un défilement interne, plutôt qu'un sommet inatteignable). Le champ de recherche reste `position: sticky` en tête pendant le défilement des options.

**Le nom de la liste.** `aria-label` et `aria-labelledby` posés sur `<@@select>` (à la main, ou par `<@@field>`) nomment la liste ouverte. Une étiquette citée par `aria-labelledby` qui paraît après le montage (dans un `{if}`) est attendue ; retirée puis réaffichée (un `{if}` refermé puis rouvert), elle est un nouvel élément, et la liste le retrouve.

**La largeur suit la plus longue option.** Quand rien ne contraint le contrôle (une ligne en `flex`, une cellule qui s'ajuste à son contenu), il se dimensionne sur l'option la plus longue plutôt que sur celle qui se trouve affichée — sinon un select posé sur `3` se réduit à trois pixels et son panneau tronque `illimité`. Le calcul est purement CSS (une jauge invisible de hauteur nulle, qui empile dans la même cellule de grille le texte d'attente et les cinq étiquettes les plus longues en nombre de caractères, une icône comptant pour deux : une liste de mille options n'y garde pas mille éléments), donc il suit tout seul un ajout d'option, un changement de police ou une traduction. Limite : dans une police proportionnelle, une étiquette plus courte en caractères mais faite de lettres larges (« MMMM » contre « iiiiii ») peut dépasser de quelques pixels la largeur retenue ; elle est alors coupée par des points de suspension. Le select ne dépasse jamais la largeur de sa boîte : dans une boîte plus étroite que sa plus longue étiquette, il en prend la largeur et l'étiquette trop longue du bouton est coupée par des points de suspension (pour qu'il remplisse une boîte plus large que ses étiquettes, donnez-lui `width: 100%`). Refermé, son panneau ne compte plus dans la largeur de la page : une fenêtre réduite ensuite ne défile pas de côté. Le panneau ouvert, lui, n'est jamais moins large que le bouton et s'élargit pour ses étiquettes (les plus longues de la liste, si bien qu'il garde sa largeur pendant une recherche), dans la limite de la fenêtre : il part du bord gauche du bouton s'il tient, sinon son bord droit suit celui du bouton, et la fenêtre le borne ; seule une étiquette plus longue que la fenêtre y est coupée. Deux bornes évitent qu'une option à rallonge ne tire toute la page : la largeur préférée est plafonnée par `--mjs-select-max` (22rem par défaut, à vous de la relever), et le contrôle reste **compressible** — dans une ligne `flex` trop étroite il rétrécit au lieu de faire déborder la ligne.

## `<@@field>` — enveloppe de champ

```html
<@@field label="Email" help="On ne le partage jamais." ok-label="Disponible !">
  <input type="email" name="email" value=!{$email}>
</@@field>
```

Enveloppe n'importe quel champ (projeté par slot) et lit **toute seule** `µres.errors[name]` (le sac d'erreurs par champ d'un formulaire refusé en 422, cf. [21 · Navigation](21-navigation.md)) : une erreur affichée efface l'aide le temps qu'elle dure, puis s'efface elle-même à la réponse qui corrige le champ — le 422 devient entièrement **déclaratif**, rien à câbler à la main.

| Attribut | Rôle |
|---|---|
| `name` | clé lue dans `µres.errors` — **facultatif** : à défaut, le `name` du champ enveloppé fait foi (voir juste en dessous) |
| `label` | libellé au-dessus du champ (`for` posé automatiquement sur le premier élément projeté) ; il nomme aussi le champ enveloppé (`aria-label`, s'il n'a pas déjà de nom), et un clic dessus y met le focus |
| `help` | texte d'aide, masqué tant qu'une erreur est affichée |
| `ok-label` | message affiché à l'état succès — vide par défaut (rien ne s'affiche sans cette clé) |

**`name` ne s'écrit qu'une fois.** Le champ enveloppé porte déjà le sien — sans lui, aucun formulaire ne le ramasse — et `<@@field>` n'a qu'un seul enfant projeté : c'est forcément celui-là. L'enveloppe lit donc ce `name` toute seule (ou, si le champ est lui-même dans un conteneur, celui du premier descendant qui en porte un), et s'en sert comme clé dans `µres.errors`. Si l'enveloppe contient plusieurs champs, c'est le premier qu'elle nomme. L'écrire une seconde fois sur l'enveloppe reste possible et **prend le dessus** : c'est ce qu'il faut quand la clé du sac d'erreurs diffère du nom du champ (`user[email]` côté formulaire, `email` côté erreurs). L'erreur au montage ne se déclenche que si personne, ni l'enveloppe ni le champ, ne porte de nom.

L'état **succès** (bordure et message en vert, `--mjs-field-ok-color`) n'apparaît jamais au tout premier rendu — il faut une réponse du serveur. À partir de la première, tout champ sans erreur passe au vert, qu'il ait été refusé auparavant ou non : c'est un accusé de validité, daté de la dernière réponse reçue, pas seulement un accusé de correction.

L'état se lit aussi **sur votre champ** : `<@@field>` lui pose l'attribut `mjs-field="error"` ou `mjs-field="ok"` (aucun à l'état neutre). C'est lui qui colore la bordure, et votre feuille peut s'en servir : `input[mjs-field="error"] { … }`. En erreur, le champ porte aussi `aria-invalid="true"`, et le message est annoncé aux lecteurs d'écran (`role="alert"`).

**Parts** : `field`, `label`, `help`, `error`, `ok`.

**`layout="float"`** — le libellé est posé dans le champ et **monte** au-dessus quand on y entre ou qu'il est rempli — au clavier, par programme, ou vidé par la remise à zéro du formulaire ; un `<@@number>`, une `<@@gauge>` ou un `<@@knob>` enveloppé est rempli dès qu'il a une valeur, zéro compris, une `<@@select>` dès qu'une option est choisie (en `multiple`, au moins une), un `<@@editor>` dès qu'il a du texte — que la valeur vienne d'un geste ou de la page, et même quand le module du champ arrive avant le leur (la construction par défaut écrit un fichier par module) ; `icon` ajoute une pastille (un caractère, un emoji) qui monte avec lui. Variables : `--mjs-field-float-bg` (le fond du champ), `--mjs-field-float-accent` (la pastille).

```html
<@@field layout="float" label="Nom" icon="☺"><input name="nom"></@@field>
```

## `<@@checkbox>` / `<@@radio>` / `<@@switch>` — cases et interrupteurs

Trois habillages d'un contrôle **natif** (`<input type="checkbox">`/`radio`), entièrement restylisés — le comportement clavier, focus et formulaire reste celui du navigateur. `<@@radio>` : les flèches cochent le voisin du même groupe, et un seul arrêt de tabulation mène au groupe (le bouton coché ; s'il est désactivé, le premier bouton libre prend l'arrêt à sa place, comme dans un groupe natif). Une touche tenue avec Alt, Ctrl ou Méta reste au navigateur (Alt+← reste le « retour »). Remis à zéro (`form.reset()`, bouton `type="reset"`), un formulaire rend la case, l'interrupteur, le nombre et la liste à leur état de départ — celui du premier rendu — sans annoncer de `change`, et le groupe radio à son état de départ.

```html
<@@checkbox name="terms" checked=!{$accept}>J'accepte les conditions</@@checkbox>

<@@radio name="size" value="m" group=!{$size}>M</@@radio>
<@@radio name="size" value="l" group=!{$size}>L</@@radio>

<@@switch name="notify" checked=!{$notify}>Notifications</@@switch>
```

`<@@checkbox>` : `name`, `checked=!{$x}` (two-way), `value` (valeur du champ, défaut `'on'`), `disabled`, `required` (le formulaire ne part pas tant que la case n'est pas cochée), `indeterminate={$x}` (le tiret « une partie », transmis à la case native). `<@@radio>` : `name` (les boutons d'un même groupe partagent leur `name` et leur formulaire, qui les coordonnent), `value`, `group=!{$x}` (two-way — porte la valeur du bouton actuellement sélectionné dans le groupe), `disabled`, `required` (posé sur un bouton, il rend tout le groupe obligatoire : un de ses boutons doit être choisi). `<@@switch>` : mêmes attributs que la case à cocher, sans `indeterminate`, rôle ARIA `switch` au lieu de `checkbox` ; `required` : l'interrupteur doit être allumé. Les trois sont des éléments du formulaire, comme un champ natif : voir [Dans un formulaire](#dans-un-formulaire).

Chacun des trois émet **`change`** quand l'utilisateur change la valeur (souris, clavier ou doigt), comme `<@@select>` : `e.data` est l'état coché (`true` ou `false`) pour la case et l'interrupteur ; pour le radio, c'est le bouton qui vient d'être coché qui l'émet, et `e.data` est sa propre `value`. La variable liée (`checked=!{$x}`, `group=!{$x}`) et le champ envoyé avec le formulaire sont déjà à jour quand `@change` joue : `new FormData(form)`, lu dans le gestionnaire, montre l'état d'après le geste. Rien quand la page pose elle-même l'état, rien pour la remise à zéro d'un formulaire, rien quand on rechoisit le bouton radio déjà coché. L'événement remonte (`bubbles`, `composed`) : un `<form @change={…}>`, ou tout écouteur de `change` posé plus haut, le reçoit avec la balise du module pour `target`. Comme pour tout événement de MJS, le gestionnaire le plus proche joue seul : un `<form @change>` ne reçoit l'événement que si le module n'a pas son propre `@change`, ou si celui-ci porte `.propagate`. Sur `e.target`, la balise du module, `checked`, `value`, `name` et `type` ne se lisent pas : la valeur se lit sur `e.data`.

Une case d'en-tête posée au-dessus d'une liste porte les **trois états** de la case à cocher : vide quand rien n'est coché, cochée quand tout l'est, tiret (`indeterminate`) quand seule une partie de la liste l'est.

```html
<script>
  $all  = $mails.every (m)-> m.checked
  $some = $mails.some((m)-> m.checked) and not $all
</script>

<@@checkbox checked=!{$all} indeterminate={$some}>Tout sélectionner</@@checkbox>
```

| Composant | Parts |
|---|---|
| `<@@checkbox>` | `wrap`, `box`, `label` |
| `<@@radio>` | `wrap`, `dot`, `label` |
| `<@@switch>` | `wrap`, `pill`, `label` |

Variables : `--mjs-check-size`/`-radius`/`-accent`/`-color`/`-border` pour la case ; le radio, rond, lit `--mjs-check-size`, `-accent` (son point et sa bordure cochée) et `-border` ; `--mjs-switch-width`/`-height`/`-accent`/`-color`/`-border` pour l'interrupteur. Sans valeur posée, l'accent et la bordure suivent `--mjs-accent` et `--mjs-border` du thème général. Une variable posée sur la balise, sur un de ses ancêtres, dans le bloc `<theme>` de l'application ou sur `:root` agit sur tous les modules en dessous. Les deux modèles de l'interrupteur, `triangle` et `glow`, ont leur propre taille : `--mjs-switch-width` et `--mjs-switch-height` ne les changent pas.

**Anneau de focus.** Au clavier, le contrôle focalisé s'entoure d'un anneau de 3 px, bleu translucide par défaut : `--mjs-check-focus` (case et radio) et `--mjs-switch-focus` (interrupteur) en règlent la couleur, l'épaisseur reste de 3 px. Pour une autre épaisseur ou une autre forme, visez la pièce du module depuis votre feuille, avec `:focus-within` et `::part()` (`box`, `dot` ou `pill`). `:focus-within` ne distingue pas le clavier de la souris : cet anneau-là s'affiche aussi après un clic.

```css
mjs-core-checkbox:focus-within::part(box) { box-shadow: 0 0 0 4px #e5484d; }
mjs-core-radio:focus-within::part(dot)    { box-shadow: 0 0 0 4px #e5484d; }
mjs-core-switch:focus-within::part(pill)  { box-shadow: 0 0 0 4px #e5484d; }
```

L'interrupteur a deux modèles de plus, par `layout` :

- `<@@switch layout="triangle">` : un boîtier en parallélogramme où un triangle lumineux file d'un bord à l'autre en changeant de couleur ; `off` et `on` donnent les deux libellés (`Off`, `On`), `--mjs-switch-off` et `--mjs-switch-on` leurs couleurs.
- `<@@switch layout="glow">` : une piste en relief, un bouton qui glisse et un témoin qui s'allume en bleu ; ses couleurs sont celles du modèle, `--mjs-switch-accent`, `--mjs-switch-color` et `--mjs-switch-border` ne les changent pas.

```html
<@@switch layout="triangle" checked=!{$actif}></@@switch>
<@@switch layout="glow" checked=!{$lumiere}></@@switch>
```

## `<@@color>` — pastille de couleur

```html
<@@color value="#f472b6">

<@@color value=!{$c} editable>
```

Affiche le code de la couleur écrit tel quel, suivi de la pastille — **lecture seule par défaut**, sans la moindre option à poser. La couleur passe par la variable `--mjs-color-value`, jamais par un style inline sur le DOM (`background-color: var(--mjs-color-value)` vit dans le `<style>` du module) : `oklch(…)`, `color-mix(…)`, `rgb(…)`, un nom CSS ou un hexadécimal fonctionnent tous identiquement, c'est le navigateur qui peint. La pastille ne peint qu'une couleur : une valeur qui n'en est pas une — une image `url(…)`, un dégradé — ne peint rien, et aucune requête ne part vers l'adresse qu'elle nomme (une couleur venue d'une donnée, couleur de profil ou d'étiquette, ne peut pas servir de pixel de suivi).

| Attribut | Rôle |
|---|---|
| `value` | la couleur, dans n'importe quelle syntaxe CSS valide — obligatoire |
| `editable` | bascule la pastille en vrai sélecteur de couleur natif (`<input type="color">`) |
| `compact` | pastille seule, sans le code écrit à côté |
| `label` | étiquette accessible de l'`<input>` en mode `editable` — défaut « Couleur » (« Color » en anglais) |
| `before` | place la pastille **avant** le code plutôt qu'après |

**Édition, opt-in explicite.** Avec `editable`, la pastille devient un `<input type="color">` natif ; comme cet input n'accepte que `#rrggbb`, le module résout `value` en hexadécimal en le posant sur un élément jetable (créé, attaché à `document.body`, retiré aussitôt après lecture) et en lisant `getComputedStyle(...).backgroundColor` — ce qui couvre n'importe quelle syntaxe CSS, exactement comme en lecture seule. Si le navigateur ne sait pas résoudre la valeur (`oklch()`/`color-mix()` sur un moteur qui ne les connaît pas, syntaxe invalide…), le module retombe **silencieusement** sur la pastille en lecture seule plutôt que d'afficher un sélecteur menteur — aucune erreur, aucun `input` rendu. Choisir une nouvelle couleur émet **`change`** (`e.data` = la nouvelle valeur, au format `#rrggbb`) et met à jour `value`, ce qui rend la liaison two-way `value=!{$x}` opérante — comme sur `<@@select>`, dont le two-way porte lui aussi sur `value` (celui de `<@@checkbox>` et de `<@@switch>` porte sur `checked`). `@change` reste disponible pour tout ce qui n'est pas la simple recopie de la valeur.

**Accessibilité de la pastille en lecture seule.** Ce n'est pas un contrôle (aucun arrêt de tabulation), mais la couleur ne doit jamais être portée par la seule teinte. En mode normal, le code écrit à côté suffit — la pastille est alors retirée de l'arbre d'accessibilité (`aria-hidden="true"`) pour ne pas doubler l'annonce. En `compact`, il n'y a plus de code écrit : la pastille prend `role="img"` + `aria-label`/`title` portant la valeur, le patron standard pour exposer un élément purement graphique porteur de sens.

**Parts** : `swatch` (pastille en lecture seule), `picker` (`<input type="color">` en édition), `code` (le texte de la valeur). **Variables** : `--mjs-color-size`/`-radius`/`-border` (dimension, arrondi, bordure de la pastille et du picker — la dimension vaut `1em` par défaut, soit la hauteur du texte à côté duquel la pastille s'aligne) ; `--mjs-color-value` est posée par le module lui-même à partir de `value` — rien à en faire côté thème, c'est un canal de données, pas un réglage esthétique. `--mjs-color-line` règle la hauteur de ligne du code écrit (`1.26rem` par défaut : 1,4 fois la taille de sa police, `.9rem`) ; le module réserve toujours cette hauteur, même en `compact` où il n'y a plus de texte, pour qu'une pastille compacte reste alignée sur ses voisines et sur le texte qui l'entoure.

## `<@@editor>` et `<@@toolbar>` — éditeur de texte riche

```html
<@@editor name="contrat" value=!{$contrat}></@@editor>
```

Une zone de texte riche avec sa barre d'outils au-dessus : titres, gras, italique, souligné, barré, couleur du texte (avec `colors`), listes à puces, numérotées et **à cocher**, citation, lien, annuler et rétablir. La variable reçoit le HTML propre à chaque modification, et le formulaire envoie ce même HTML dans le champ `contrat`. Le navigateur garde la frappe, la sélection, le correcteur orthographique et les méthodes de saisie ; l'éditeur applique la mise en forme et reconstruit, à chaque modification, un HTML propre, identique d'un navigateur à l'autre.

| Attribut | Rôle |
|---|---|
| `name` | nom du champ envoyé avec le formulaire (un `<input type="hidden">` interne) ; sans `name`, aucun champ |
| `value=!{$x}` | le HTML, dans les deux sens ; une valeur venue de la page est nettoyée avant d'entrer, mais la variable de la page n'est réécrite qu'à la première modification (la page voit « non modifié » tant que rien n'a été tapé) |
| `toolbar` | les outils de la barre intégrée, séparés par des espaces, `\|` pour un séparateur, ou en tableau (`toolbar={['bold', 'italic']}`) ; absent, ou une liste vide : tous les outils ; `none` : pas de barre intégrée |
| `colors` | les couleurs du texte permises, séparées par des espaces ou en tableau, parmi `gray brown orange yellow green blue purple pink red` (`colors="red orange green"`) : le bouton `color` de la barre propose celles-là, dans cet ordre, et le HTML ne garde qu'elles ; sans `colors`, ni bouton ni couleur — voir « La couleur du texte », plus bas |
| `placeholder` | texte d'attente — défaut « Écrivez ici… » (« Write here… » en anglais) ; tant que la zone est vide, il est aussi donné aux lecteurs d'écran (`aria-placeholder`) |
| `label` | nom accessible de la zone — défaut « Éditeur de texte » (« Text editor ») |
| `paste` | `paste="text"` : seul le texte brut du presse-papiers (ou d'un contenu déposé) entre, en paragraphes ; sans lui, la structure permise est gardée |
| `autofocus` | le focus dans la zone dès que l'éditeur se montre, même posé par un `{if}`, après un clic comme sans geste (un minuteur, un message) — un `.focus()` appelé quand la page pose la balise arrive avant que l'éditeur soit affiché, et tombe ; un éditeur désactivé ne le prend pas ; plusieurs éditeurs `autofocus` qui se montrent ensemble : le premier de la page prend le focus, comme les champs natifs ; un éditeur `autofocus` qui se montre ensuite le prend à son tour, même à un autre éditeur |
| `caret` | `caret="end"` : quand la page donne le focus (`autofocus`, `.focus()` de la balise), le curseur se pose à la fin du texte, et un long texte défile jusqu'à lui — pour continuer un texte rouvert ; une valeur que la page pose dans la zone qui a le focus, même dans le même geste que `.focus()`, le met aussi à la fin du nouveau texte. Une zone qui a déjà le focus garde son curseur. Sans `caret`, le curseur va où le navigateur le pose : au début |
| `readonly` | lecture seule : même rendu, ni barre ni saisie, le champ reste envoyé ; la zone reste atteignable au clavier (Tab), comme une zone de texte en lecture seule, pour y sélectionner et copier |
| `disabled` | grisé, non éditable, aucun champ envoyé, hors de la tabulation même avec `readonly` (comme un champ natif) |
| `required` | obligatoire : le formulaire ne part pas tant que la zone est vide (rien qu'un blanc ou des balises vides) — voir « Dans un formulaire », plus bas |
| `answer`, `checked=!{$x}` | le mode « répondre », plus bas |

L'éditeur émet **`input`** à chaque modification (`e.data` = le HTML propre) et **`change`** quand il perd le focus après une modification (`e.data` = le HTML). Un `@input` posé sur l'éditeur ne reçoit que cet événement-là : une fois par modification, avec le texte et non la lettre tapée, et rien quand le HTML ne change pas (Entrée qui ne fait qu'ouvrir une ligne vide, par exemple). **Pour un grand texte** (plus de 20 000 caractères de HTML propre, soit une vingtaine de pages), la frappe attend une courte pause (150 ms) avant de reconstruire le document : une rafale de touches ne donne alors qu'un `input`, émis à la fin de la rafale, et la variable liée et le champ du formulaire retardent d'autant. Tout autre geste (mise en forme, collage et dépôt, annulation, Entrée) et la perte du focus reconstruisent tout de suite, si bien que `change` voit toujours le texte complet. Lire le formulaire fait de même : l'envoi (`submit`, `requestSubmit()`, le bouton) et aussi `form.submit()` et `new FormData(form)`, que l'événement `formdata` du formulaire signale à l'éditeur ; il met alors à jour sa propre entrée dans la liste des champs (celles des autres champs, et d'un second éditeur du même nom, ne bougent pas) et la variable liée est à jour. **Retiré de la page pendant la pause**, l'éditeur reconstruit avant de partir et émet son dernier `input` : une écoute posée sur la balise elle-même le reçoit partout, la variable liée aussi quand l'éditeur part avec le composant qui la porte. Quand la page retire seule l'éditeur (un `{if}` qui se ferme) dans les 150 ms qui suivent la dernière touche, la variable liée n'est mise à jour que sous Chromium : il envoie un `blur` au retrait, balise encore en place, alors que Firefox et Safari n'envoient rien, et un événement émis par une balise déjà retirée n'atteint plus le gabarit de la page. Pour garder la dernière frappe, lisez le formulaire (`new FormData(form)`) avant de retirer l'éditeur, ou retirez-le une fois qu'il a perdu le focus. Sous ce seuil, un `input` part à chaque touche, sans attente. L'`input` natif de la zone et celui du champ d'adresse du lien ne sortent pas de l'éditeur : le routeur d'événements de MJS ne les remet pas à la page, et une écoute posée à la main plus haut (`addEventListener('input', …)`) ne les entend pas non plus, sauf en phase de capture. Les autres événements natifs — `@click`, `@keydown`, `@focus`… — arrivent comme pour n'importe quel composant. Appeler `.focus()` sur la balise met le focus dans le texte, une fois l'éditeur affiché ; pour le focus dès son arrivée dans la page, écrivez `autofocus`.

### Les outils de la barre

Les noms sont ceux du code, **en anglais seulement**, comme les autres valeurs d'attributs du cœur (`layout="glow"`, `match="fuzzy"`) :

```html
<@@editor name="notes" value=!{$notes} toolbar="h2 h3 | bold italic ul check link"></@@editor>
```

| Nom | Bouton | Raccourci | HTML produit |
|---|---|---|---|
| `h2`, `h3` | H2, H3 | Ctrl+Alt+2, Ctrl+Alt+3 | `<h2>`, `<h3>` |
| `quote` | « | — | `<blockquote><p>…</p></blockquote>` |
| `bold`, `italic` | **B**, *I* | Ctrl+B, Ctrl+I | `<strong>`, `<em>` |
| `underline`, `strike` | U, S barré | Ctrl+U, Ctrl+Maj+X | `<u>`, `<s>` |
| `color` | A souligné de couleur | — | `<span data-color="red">` ; seulement pour un éditeur qui a `colors` |
| `ul`, `ol` | puces, numéros | Ctrl+Maj+8, Ctrl+Maj+7 | `<ul><li>`, `<ol><li>` |
| `check` | cases | Ctrl+Maj+9 | `<ul data-checklist><li data-key data-checked>` (le nom caché de chaque ligne, voir le mode « répondre ») |
| `link` | lien | Ctrl+K | `<a href>` |
| `undo`, `redo` | flèches | Ctrl+Z ; Ctrl+Maj+Z ou Ctrl+Y | — |
| `clear` | Tx | — | retire gras, italique… lien et titre |

Sans `toolbar`, la barre porte tous ces outils dans cet ordre, séparés en groupes (titres, marques, listes, lien, historique, effacer) ; le bouton `color` n'y est que pour un éditeur qui a une palette (`colors`), et une barre posée à part le montre ou non selon l'éditeur qu'elle vise. Un nom en double ne compte qu'une fois, un séparateur au bord ou en double tombe. **Un nom inconnu** — une faute de frappe, un mot français comme `gras` — est ignoré, et un avertissement le dit dans la console, une fois par nom, avec la liste des noms connus. Cmd remplace Ctrl sur Mac ; Ctrl+Alt+0 remet un paragraphe. **AltGr n'est jamais un raccourci** : Windows le transmet comme Ctrl+Alt, et « @ », « # », « ~ » d'un clavier français, belge, suisse, espagnol ou allemand se tapent normalement ; avec un tel clavier sous Windows, Ctrl+Alt+2 et Ctrl+Alt+3 tapent donc leur caractère au lieu de faire un titre (les boutons H2 et H3 restent là), que le navigateur y dise AltGr ou seulement Ctrl+Alt (Ctrl et Alt de gauche) : sous Windows, une touche qui donne un caractère avec Ctrl+Alt l'écrit, seul un chiffre (clavier anglais) reste un raccourci. Sous Linux et macOS, Ctrl+Alt n'écrit rien : Ctrl+Alt+2 fait le titre avec tout clavier. Les boutons de titre et de citation sont grisés dans une liste, le bouton gras dans un titre (un titre est déjà gras). **Deux raccourcis suivent la barre** : Ctrl+K (`link`) et Ctrl+Maj+9 (`check`) n'agissent que si la barre de CET éditeur — la sienne, ou la `<@@toolbar for="…">` qui le vise — montre l'outil ; sans lui dans la barre, la touche ne fait rien. Les autres raccourcis (gras, italique, souligné, barré, titres, listes) ne dépendent pas de la barre.

**Défaire et refaire.** Chaque éditeur a sa propre pile d'annulation : Ctrl+Z (Cmd+Z sur Mac) défait, Ctrl+Maj+Z, Ctrl+Y ou Cmd+Maj+Z refait, et les boutons `undo` et `redo` agissent sur **leur** éditeur. Avec deux éditeurs sur la page, défaire dans l'un ne touche jamais l'autre ; les boutons sont grisés tant qu'il n'y a rien à défaire ou à refaire. Les étapes sont celles d'un éditeur natif : une frappe continue en est une (le texte tapé, ou le texte effacé, sans déplacer le curseur), une composition aussi (méthode de saisie : japonais, chinois, clavier de téléphone — défaite entière, jamais lettre à lettre), Entrée en est une, une mise en forme (même « effacer la mise en forme », qui en enchaîne plusieurs), un collage, un dépôt, un glisser, une indentation en font chacun une ; défaire rend aussi la sélection d'avant. Une nouvelle modification efface ce qui restait à refaire, et la pile garde les 100 dernières étapes (20 pour un grand texte). Une valeur posée par la page et `form.reset()` vident la pile, comme pour une zone de texte native dont la page change la valeur. La pile du navigateur, commune à toute la page, ne sert plus : son menu « Annuler » agit sur la pile de l'éditeur qui a le focus (dans sa zone, sur un bouton de sa barre ou sur un lien de sa zone ; le focus ne bouge pas), et ne touche jamais un autre éditeur où l'on écrit, même quand un script de la page appelle `document.execCommand('undo')`. Quand le focus n'est dans aucun champ où l'on écrit (un bouton ou un lien de la page, le bouton ou la case d'un composant tiers caché dans son ombre fermée, un éditeur en lecture seule), Ctrl+Z défait l'éditeur qui a reçu la dernière frappe, puis, coup après coup, les frappes d'avant dans leur ordre, d'un éditeur à l'autre, comme le faisait la pile du navigateur, sans déplacer le focus. Une saisie hors des éditeurs faite entre deux de leurs frappes (dans le titre, par exemple) revient à son tour au navigateur : Chromium la défait, et le focus revient où il était (sauf dans l'ombre fermée d'un composant tiers, où Chromium le laisse dans le champ qu'il a défait) ; Firefox ne défait pas un champ de texte depuis un bouton, ce coup-là ne change rien ; sous Chromium, quand un même éditeur a reçu des frappes avant et après cette saisie, ses frappes d'avant ne se défont plus depuis la page, seulement dans sa zone. Ctrl+Maj+Z, Ctrl+Y ou Cmd+Maj+Z refait ensuite ce que Ctrl+Z vient d'y défaire, dans l'ordre inverse, d'un éditeur à l'autre (la saisie hors des éditeurs que Chromium a défaite, il la refait après eux, et y met le focus), jusqu'à la prochaine saisie dans la page ; WebKit n'y envoie aucun geste, rien ne bouge. Un éditeur sans ombre (`@lightDom`) suit les mêmes règles. Ctrl+Z dans un champ natif de la page (l'`<input>` d'un titre au-dessus du corps, une zone `contenteditable`, le champ d'un composant tiers caché dans son ombre fermée, dès qu'il a reçu une frappe) défait ce champ dès le premier coup, jamais le texte d'un éditeur, et aucun `input` ne sort alors de l'éditeur vers vos écouteurs (Firefox défait d'abord l'étape de l'éditeur, qui la remet aussitôt : sa valeur n'a pas changé).

**La liste à cocher.** Cliquer dans la marge gauche d'une ligne la coche, sans déplacer le curseur ; Ctrl+Entrée coche ou décoche la ligne du curseur ; Entrée crée une ligne **décochée** ; Tab imbrique une ligne, Maj+Tab la désimbrique (une sous-liste d'une liste à cocher est à cocher aussi) ; dans les autres cas Tab laisse le focus partir, il n'y a aucun piège clavier. Le bouton `check` bascule : dans un paragraphe il fabrique la liste, dans une liste à puces il la convertit, dans une liste à cocher il la retire. **Annuler ne décoche pas une case** : Ctrl+Z défait la frappe et la mise en forme, pas le cochage.

**Le lien** s'ouvre dans une ligne sous la barre (champ d'adresse, Appliquer, Retirer le lien, Annuler) : Entrée applique, Échap ferme et rend le focus au texte (sans refermer un tiroir ou une fenêtre qui contient l'éditeur). `exemple.fr` devient `https://exemple.fr`, `a@b.fr` devient `mailto:a@b.fr`, `javascript:…` est refusé sans bruit. Un curseur posé dans un lien existant préremplit l'adresse et propose de le retirer.

**La couleur du texte** (`colors="red orange green"`) se choisit dans une ligne sous la barre, comme le lien : un bouton par couleur de la palette, avec sa pastille et son nom (« Rouge », « Red »), puis « Aucune couleur » ; la couleur du texte choisi y est enfoncée et prend le focus. Les flèches, Début et Fin passent d'un bouton à l'autre, Entrée, Espace ou un clic colore la sélection, Échap ferme sans rien changer ; le focus revient au texte, et un lecteur d'écran entend le nom de la couleur posée. Un curseur sans sélection colore le mot où il se tient ; une partie d'un texte coloré prend la nouvelle couleur, le reste garde la sienne ; « Aucune couleur » et `clear` (« Effacer la mise en forme ») la retirent. Le bouton `color` est enfoncé quand la sélection est colorée. Les noms sont en anglais et la liste est fermée : `gray`, `brown`, `orange`, `yellow`, `green`, `blue`, `purple`, `pink`, `red` ; un autre nom est ignoré, et un avertissement le dit dans la console, une fois par nom. Chaque couleur est une variable du thème, `--mjs-editor-color-<nom>` (`--mjs-editor-color-red: #b91c1c`), lue par une règle du style de l'éditeur : le texte ne porte jamais de style en ligne. La ligne et ses boutons se stylent par `::part(colors)`, `::part(color-button)` et `::part(color-none)`.

**Titres, tableaux, images.** Seuls `h2` et `h3` existent (la page a déjà son `h1`) ; un `h1` collé devient `h2`, `h4` à `h6` deviennent `h3`. Il n'y a ni tableau ni image, ni `maxlength` : le serveur valide la longueur (`required`, lui, existe : voir plus haut).

### Une barre posée ailleurs

```html
<@@toolbar for="notes"></@@toolbar>
<@@editor id="notes" toolbar="none" value=!{$notes}></@@editor>
```

`<@@toolbar>` est le module que l'éditeur intègre pour sa propre barre ; il peut aussi vivre à part. `for` est l'`id` de l'éditeur visé (dans le même gabarit ; sans `for`, c'est l'éditeur qui enveloppe la barre), `tools` prend la même liste que `toolbar` (texte ou tableau), `label` nomme la barre (défaut « Mise en forme », « Formatting »), `disabled` la grise. Ses boutons à bascule portent `aria-pressed` et leur titre dit le raccourci (« Gras (Ctrl+B) »), avec le nom des touches dans la langue de la page : « Barré (Ctrl+Maj+X) » sur une page française, « Strikethrough (Ctrl+Shift+X) » sur une page anglaise ; ⌘, ⌥ et ⇧ sur Mac. C'est une barre d'outils au sens ARIA : un seul bouton dans l'ordre de tabulation, les flèches gauche et droite passent au voisin, Début et Fin vont aux extrémités. Quand l'éditeur visé est en lecture seule, désactivé ou en mode « répondre », tous ses boutons sont grisés ; « défaire » et « refaire » suivent la pile de l'éditeur visé, grisés quand elle n'a rien à défaire ou à refaire. L'éditeur visé peut paraître après la barre (dans un `{if}`, après un chargement) : la barre se branche dès qu'il est là, sans qu'il faille cliquer, et grise ses boutons quand il disparaît. `for` peut être calculé (`for={$id}`) et changer : la barre quitte l'éditeur d'avant et pilote celui qu'il désigne. Un `id` qui ne désigne pas un éditeur, ou une barre sans `for` posée hors d'un éditeur, laisse ses boutons grisés.

### Le formulaire et la valeur liée

Comme la case à cocher, l'éditeur écrit lui-même un `<input type="hidden">` dans sa balise, tenu à jour à chaque frappe : un `<form method="post">` classique l'envoie sans rien écrire, et `new FormData(form)` le porte. Il n'annonce aucun `change` pour `form.reset()`, qui rend la valeur de départ (celle du premier rendu) et vide sa pile d'annulation. C'est aussi un élément du formulaire, comme une zone de texte native (`required`, `<label for>`, `<fieldset disabled>`) : voir « Dans un formulaire », plus bas. Une page rendue par le serveur écrit la surface avec le HTML **nettoyé** (un `<script>` du texte n'y passe jamais) et le champ avec sa valeur : le formulaire s'envoie avant même le démarrage du JavaScript. Ce nettoyage-là reste sûr (rien d'exécutable, rien hors de la liste, y compris sur 98 charges hostiles essayées) mais son lecteur de HTML n'est pas celui du navigateur : sur un HTML mal formé (un octet nul dans une adresse, une balise coupée, `<xmp>`, `<plaintext>`), il peut produire un autre texte que celui du navigateur — 9 charges sur 98 —, jamais une balise hors liste. Aucun contournement n'est prévu : c'est la même liste des deux côtés, pas le même résultat à l'octet près.

Une valeur posée par la page remplace le contenu, même si elle a déjà été vue (« annuler les modifications » remet bien le texte d'origine) ; ce que l'éditeur vient lui-même d'envoyer ne réécrit jamais la surface, le curseur ne bouge pas sous la frappe. `@html=!{…}` ([07 · Bindings](07-bindings.md)) reste l'outil d'une zone `contenteditable` brute : il ne nettoie rien et ne gère ni barre ni cases, et son HTML sort tel que le navigateur le fabrique.

### Le HTML produit, et ce que le serveur doit en faire

Une seule forme possible, reconstruite à partir d'un petit modèle de blocs, quel que soit le navigateur qui a fabriqué le DOM :

| Balise | Attributs permis | Remarque |
|---|---|---|
| `p`, `h2`, `h3`, `blockquote` | aucun | `blockquote` contient des `p` |
| `strong`, `em`, `u`, `s` | aucun | `b`, `i`, `strike`, `del`, `ins` ou un style `font-weight` collés y sont ramenés |
| `a` | `href` | schémas permis : `http`, `https`, `mailto`, `tel`, adresses relatives |
| `ul`, `ol`, `li` | `data-checklist` sur `ul`, `data-checked` et `data-key` sur `li` | listes imbriquées permises ; `data-checked` présent = coché ; `data-key` est le nom caché d'une ligne d'une liste à cocher (voir le mode « répondre »), jamais gardé sur une liste ordinaire |
| `br` | aucun | retour à la ligne dans un bloc ; chaque ligne d'un `<pre>` collé en garde un |
| `span` | `data-color`, un nom de la palette de l'éditeur (`colors`) | la couleur du texte, dans un lien et autour des marques (`<a href><span data-color="red"><strong>…`) ; jamais de `span` sans couleur |

Rien d'autre : ni `class`, ni `style`, ni `id`, ni `target`, ni image, ni tableau. Les paragraphes vides, les espaces en trop, les balises en doublon et les balises en ligne vides disparaissent (une espace de queue en gras tombe avec sa balise, jamais de `<strong></strong>`) ; un document vide donne la chaîne vide. Nettoyer un HTML déjà propre ne le change pas : deux passages donnent la même chose qu'un seul.

```html
<ul data-checklist>
  <li data-checked>Confirmer la date</li>
  <li>Préparer le matériel
    <ul data-checklist><li>Ranger le tout</li></ul>
  </li>
</ul>
```

**Tout cela est un confort, pas une garantie.** Aucun script ne s'exécute dans l'éditeur (tout HTML qui entre — valeur, collage, dépôt — est lu dans un `<template>` inerte, puis reconstruit), mais un visiteur peut envoyer ce qu'il veut sans passer par lui : le serveur nettoie à l'enregistrement **et** à l'affichage, avec la même liste. Par exemple avec le `sanitize` de Rails (à régler selon la version, et sur les seuls schémas `http`, `https`, `mailto`, `tel` pour `href`) :

```ruby
sanitize(html, tags: %w[p h2 h3 blockquote ul ol li strong em u s a br], attributes: %w[href data-checklist data-checked data-key])
```

Sans `data-key` dans cette liste, le nettoyage du serveur retire le nom des lignes à cocher : le mode « répondre » ne les désigne plus alors que par leur position.

**Avec `colors`**, ajoutez `span` et `data-color` à la liste. `sanitize` ne regarde pas la valeur d'un attribut : un second passage retire chaque `span` dont la couleur n'est pas de la palette (son texte reste), la même liste que celle de `colors` :

```ruby
COLORS = %w[red orange green]
html = sanitize(html, tags: %w[p h2 h3 blockquote ul ol li strong em u s a br span], attributes: %w[href data-checklist data-checked data-key data-color])
fragment = Loofah.fragment(html)
fragment.scrub!(Loofah::Scrubber.new { |node| node.replace(node.children) if node.name == 'span' && !COLORS.include?(node['data-color']) })
fragment.to_s
```

**Afficher ce HTML ailleurs.** Hors de l'éditeur, le HTML produit est du HTML ordinaire ; seules les listes à cocher demandent du style, deux règles suffisent (un marqueur de liste par état) :

```css
ul[data-checklist] > li                { list-style: "☐  "; }
ul[data-checklist] > li[data-checked]  { list-style: "☑  "; }
```

Avec `colors`, une règle par couleur de la palette : `[data-color="red"] { color: #b91c1c; }`.

### Collage et dépôt

Un seul geste de nettoyage pour tout ce qui entre : le texte collé garde sa structure permise (titres, listes, gras, italique, souligné, barré, liens) et perd le reste. L'enveloppe `<b style="font-weight:normal">` que Google Docs pose autour de tout n'est pas lue comme du gras ; le gras, l'italique, le souligné et le barré écrits en `style` (Word, pages web) sont reconnus, et seules les propriétés `font-weight` et `font-style` elles-mêmes comptent : le `<b style="mso-bidi-font-weight:normal">` de Word reste du gras, et `mso-bidi-font-style:italic` ne met pas un texte en italique ; les couleurs écrites en `style` ou en `<font>`, les tailles, les polices, `class`, `id` disparaissent ; une couleur écrite `data-color` reste quand elle est de la palette de l'éditeur (`colors`), toute autre tombe et son texte reste ; un tableau devient une suite de paragraphes ; un bloc `<pre>` garde le retour à la ligne de chaque ligne (un `<br>` par retour, lignes vides comprises), ses retraits et ses espaces en série se replient en une espace ; le texte brut devient des paragraphes (ligne vide = nouveau paragraphe, simple retour = `<br>`) ; un seul paragraphe collé s'insère dans la ligne en cours. Avec `paste="text"`, seul le texte brut entre. Un contenu glissé depuis une autre page passe par le même nettoyage ; les fichiers déposés sont ignorés.

**Une différence entre navigateurs reste**, non corrigée : quand le collage contient plusieurs paragraphes, le premier est fusionné avec la ligne en cours sous Chromium et WebKit, alors que sous Firefox il démarre un paragraphe.

### Dans un `<@@field>`

```html
<@@field label="Contrat" help="Le texte est envoyé tel quel au serveur.">
  <@@editor name="contrat" value=!{$contrat}></@@editor>
</@@field>
```

`<@@field>` enveloppe l'éditeur comme n'importe quel champ : son libellé nomme la zone, l'erreur d'un 422 pose `aria-invalid="true"` sur la zone, et un clic sur le libellé met le focus dans le texte. Le libellé et l'erreur passent par la balise de l'éditeur (`aria-label`, `aria-invalid`), que la zone reprend et suit, qu'ils viennent de `<@@field>` ou de vous. `aria-labelledby` posé sur la balise n'est pas repris : donnez `label` ou `aria-label`.

### Le mode « répondre »

Le texte est un modèle écrit par un auteur ; ceux qui répondent ne le modifient pas, ils cochent. Avec `answer`, l'éditeur ne laisse plus rien taper : le texte est figé, seules les cases sont cliquables, et l'état coché de chaque joueur vit **dans une variable à part**, jamais dans le HTML du modèle.

```html
<script>
  $modele = '<p>Cochez ce que vous acceptez</p><ul data-checklist><li data-key="k3f9">Le bandeau</li><li data-key="p7a2">Les menottes<ul data-checklist><li data-key="m1c8">Les menottes en cuir</li></ul></li></ul>'
  $coches = ['p7a2']
</script>

<form method="post" action="/reponses">
  <@@editor name="reponses[]" answer value={$modele} checked=!{$coches}></@@editor>
  <button type="submit">Envoyer</button>
</form>
<p>{$coches.join(', ')}</p>
```

| Attribut | Rôle |
|---|---|
| `answer` | active le mode : texte figé, pas de barre, cases cliquables |
| `value={$modele}` | le modèle, avec le nom caché de chaque ligne à cocher (`data-key`) ; l'éditeur ne le réécrit jamais, un cochage non plus ; l'état coché qu'il porte (`data-checked`) n'est jamais lu |
| `checked=!{$coches}` | les cases cochées, par le **nom** de leur ligne : un tableau de textes. Dans l'exemple, `['p7a2']` coche « Les menottes ». Un nom que le texte ne porte pas est ignoré sans bruit, comme tout ce qui n'est ni un nom ni une position (une ligne sans nom se désigne par sa position, voir plus bas) |
| `name` | nom des champs du formulaire : **un `<input type="hidden">` par case cochée**, de valeur le nom de sa ligne (sa position pour une ligne sans nom), dans l'ordre du texte (comme `<@@select multiple>`) ; aucun pour une case décochée ; le texte du modèle n'est jamais envoyé |
| `readonly` | les réponses se voient et partent avec le formulaire, rien ne se coche |
| `disabled` | cases grisées hors de la tabulation, aucun champ envoyé |

**`change`** part à chaque geste de l'utilisateur (clic sur la case, touche Espace) : `e.data` est la copie du tableau des cases cochées, dans l'ordre du texte, par exemple `['k3f9', 'p7a2']`. La variable liée et les champs du formulaire sont déjà à jour quand `@change` joue. Rien quand la page pose elle-même `checked`, rien pour `form.reset()` (qui rend les noms de départ, ceux du premier rendu), jamais d'`input`. Au premier geste, les noms qui ne sont plus dans le texte (une ligne retirée depuis) tombent de la variable.

**Au clavier et au lecteur d'écran.** Chaque ligne à cocher est une case ARIA (`role="checkbox"`, `aria-checked`) placée en tête de sa ligne de liste, sur le carré de la marge (le contour du focus l'entoure), avec un arrêt de tabulation : Tab passe à la suivante, **Espace** bascule la case qui a le focus (une touche tenue ne bascule qu'une fois), Entrée ne fait rien, comme une case native. La zone est un groupe (`role="group"`), sans nom tant que vous ne donnez pas `label`. Un clic sur la case, dans la marge gauche de la ligne, la coche et lui donne le focus ; un clic sur le texte de la ligne ne coche rien, pour qu'on puisse y sélectionner du texte et suivre un lien. En `readonly`, chaque case porte `aria-readonly="true"` ; en `disabled`, `aria-disabled="true"`. La case ne contient pas le texte de sa ligne : il est posé à côté d'elle et lui donne son nom (`aria-labelledby`), si bien qu'un lien du texte reste un lien, jamais enfermé dans la case.

**Le nom de chaque ligne.** Chaque ligne d'une liste à cocher du modèle porte un nom caché, que le lecteur ne voit jamais : l'attribut `data-key` de la ligne dans le HTML du modèle, une lettre minuscule suivie de trois caractères `a` à `z` ou `0` à `9` (`k3f9`, `p7a2` : jamais que des chiffres), unique dans le texte. C'est l'éditeur de l'auteur — un `<@@editor>` ordinaire dont la barre montre l'outil `check` (la sienne, ou la `<@@toolbar for>` qui le vise ; la même règle que le raccourci Ctrl+Maj+9, en développement comme en production) — qui les écrit : dès le premier geste il donne un nom neuf à toute ligne qui n'en a pas (ligne créée, texte sans noms, texte collé) et renomme tout doublon. Entrée au milieu d'une ligne : la première moitié garde son nom, la nouvelle ligne en reçoit un neuf. Ligne copiée puis collée, ou texte collé qui porte déjà des noms : la ligne qui portait déjà le nom le garde, où qu'elle soit (au-dessus ou en dessous de la copie, et même si vous annulez le collage avec Ctrl+Z, ce qui laisse les coches des répondants sur leur ligne), la ligne collée en reçoit un neuf, un nom encore libre reste. Un texte reçu avec deux lignes de même nom, sans rien qui dise laquelle le portait : la plus haute le garde. Une ligne sans texte (celle qu'Entrée ouvre au début d'une ligne) ne porte le nom de personne. La variable liée (`value=!{…}`) et le champ du formulaire de l'auteur portent ces noms, et votre serveur doit les garder (voir « Le HTML produit »).

**La coche reste sur sa ligne.** La case est retenue par le nom de sa ligne, non par sa place : l'auteur peut ajouter une ligne en haut du modèle, en retirer une ou en déplacer une, les cases déjà cochées restent sur leurs lignes. Dans l'exemple, `['p7a2']` coche « Les menottes » même si une ligne est insérée au-dessus d'elle. Un nom qui n'est plus dans le texte (ligne retirée) est ignoré.

**Une ligne sans nom.** Un texte écrit sans l'outil `check` (un HTML venu d'ailleurs, une ligne qu'un éditeur sans cet outil a créée) a des lignes sans nom : elles se désignent par leur **position**, `0` pour la première ligne du texte, `1` pour la suivante, et ainsi de suite dans l'ordre du texte, sous-listes comprises (une ligne, puis ses sous-lignes, puis la ligne suivante) — un entier, ou son texte. Un texte sans aucun nom se règle donc par positions : `checked={[1]}` coche la deuxième ligne, `change` annonce `[0, 1]`, le formulaire envoie `0` et `1`. Dans un texte qui mêle les deux, la position d'une ligne sans nom compte toutes les lignes du texte, nommées ou non ; une ligne qui a un nom ne se désigne que par lui, jamais par sa position ; un nom porté par deux lignes ne désigne que la première, la seconde se désigne par sa position. La position d'une ligne suit l'ordre du texte : si l'auteur insère une ligne, les positions des lignes sans nom qui la suivent changent. Dès que l'auteur retouche le texte dans l'éditeur, toutes ses lignes reçoivent un nom, et les réponses données par position ne désignent plus rien : gardez avec chaque réponse la version du modèle qu'elle visait, ou remplacez les positions par les noms avant d'ouvrir le texte à la modification.

### Ce que la production envoie

L'éditeur n'est envoyé qu'aux pages qui écrivent `<@@editor>` ou `<@@toolbar>`, et la construction en retire ce que l'application n'utilise pas, en développement comme en production, au serveur comme au navigateur, comme pour `other` de `<@@select>` :

- **le mode « répondre »** (son code, ses lignes à cocher et leur style) ne part que si une page écrit `answer` ;
- **le nom caché des lignes à cocher** : sa lecture et son écriture avec le texte (`data-key`) partent avec `answer` ou avec l'outil `check`, la lecture de `checked` en noms avec `answer` seul, le nom neuf de chaque ligne et le renommage des doublons avec l'outil `check` seul. Une application qui n'écrit pas `answer` et dont aucune barre ne montre `check` n'envoie rien de plus : son éditeur ne garde pas le nom d'une ligne (le texte sort sans `data-key`) ;
- **chaque outil** (son bouton, son icône, et pour `link` la ligne d'adresse, pour `check` la fabrication d'une liste) ne part que si l'application peut l'afficher. Elle le peut quand une de ses balises `<@@editor>` n'a pas d'attribut `toolbar` (ou une `<@@toolbar>` pas de `tools`) : tous les outils ; quand sa valeur est calculée (`toolbar={$outils}`) ou que la balise porte un étalement `{...p}` : le build ne sait pas, tous les outils ; ou quand une de ses valeurs nomme l'outil. Avec `toolbar="bold italic"` partout, ni le lien, ni les cases, ni les icônes ne sont envoyés. **Un éditeur qui écrit `answer` tel quel** (`answer`, `answer="true"`) n'affiche jamais sa barre : sa liste `toolbar` ne compte pas, et une page qui n'a que des éditeurs « répondre » n'envoie aucun outil. Avec `answer={$x}`, `answer="false"` (quelle que soit sa casse) ou un étalement `{...p}`, le build ne sait pas si la barre s'affiche : la règle ci-dessus s'applique, comme pour un éditeur ordinaire. Un script qui retire ensuite `answer` à un éditeur qui l'écrit lui donne une barre sans les outils que cette règle a retirés, et une barre qui reçoit d'un script un outil qu'aucune page ne nomme ne l'affiche pas : la console du développement le signale, une fois par outil (écrivez l'outil dans la liste d'une barre de votre page), et un nom qui n'est pas un outil y est signalé comme inconnu ;
- **la couleur du texte** (le bouton `color`, sa ligne de couleurs et leurs noms) ne part que si un éditeur de l'application écrit `colors`, en clair ou calculé (`colors={$palette}`), et le bouton suit en plus la règle des outils : sans `colors` nulle part, l'outil `color` n'est pas envoyé, même nommé dans une liste (`toolbar="bold color"`), puisque la barre ne le montre qu'à un éditeur qui a une palette ;
- **dans le doute, la partie reste** : un étalement `{...props}` sur la balise, une balise dynamique qui pose `answer`, `colors`, `toolbar` ou `tools`, un script qui nomme la balise (`<@@editor>` pour le mode « répondre », la couleur du texte et les outils, `<@@toolbar>` pour les outils : le `<script>` d'un composant, un module `.civet`, `.coffee`, `.js` ou `.ts` du projet).

Ce que ce tri ne touche jamais : une liste à cocher déjà présente dans la valeur s'affiche et se coche (clic dans la marge, Ctrl+Entrée, mode « répondre » compris) même si `check` n'est dans aucune barre. Les raccourcis de `link` et de `check` suivent la barre de chaque éditeur (voir plus haut), **de la même façon en développement et en production** : Ctrl+K n'ouvre la ligne du lien et Ctrl+Maj+9 ne fabrique la liste à cocher que sur un éditeur dont la barre montre l'outil. Dans une application où un éditeur montre `link`, un autre éditeur à `toolbar="bold"` n'a donc pas Ctrl+K ; quand aucune barre de l'application ne montre l'outil, son code n'est de toute façon pas envoyé. Les raccourcis des autres outils (Ctrl+B, Ctrl+I, Ctrl+U, Ctrl+Maj+X, Ctrl+Maj+7, Ctrl+Maj+8, Ctrl+Alt+2, Ctrl+Alt+3) agissent toujours. Nommez l'outil dans la barre de l'éditeur (`toolbar="bold link"`) pour avoir son raccourci.

La construction ne lit que les balises écrites dans vos pages : un `<@@editor>` ajouté par du HTML chargé après coup, ou un `answer` posé par un script sur une balise qui ne l'écrit pas, n'est pas vu, et son code manque, en développement comme en production. Un `answer` posé ainsi par un script, alors qu'aucune page de l'application ne l'écrit, est signalé une fois dans la console du développement : écrivez `answer` sur l'éditeur dans votre page, lié à une variable si un script doit le changer.

**Page rendue par le serveur, mode `markers`.** Les repères que le serveur écrit suivent le contenu du module, que la construction réduit selon vos pages : construisez le serveur à partir des mêmes pages que le navigateur. Leur `env` ne change rien à l'éditeur, à sa barre, à `<@@select>` ni à `<@@sortable>` : ils sont réduits de la même façon en développement et en production, et une page rendue par un serveur en développement (le défaut de `createSSRRenderer`) est reprise par un navigateur en production (voir [19 · Rendu serveur](19-ssr.md)).

### Style et accessibilité

**Parts** de `<@@editor>` : `box`, `toolbar` (la balise de la barre intégrée), `toolbar-bar` et `toolbar-button` (sa barre et ses boutons : les parts `bar` et `button` de `<@@toolbar>`, sous le nom de l'éditeur), `surface`, `link` (la ligne du lien), `link-input` (son champ d'adresse), `link-button` (ses trois boutons) et `link-apply`, `link-remove`, `link-cancel` (chacun le sien) ; de `<@@toolbar>` : `bar`, `button`. **Un bouton de barre enfoncé** (souris, doigt, stylet) porte aussi la part `down`, de l'appui au relâchement, où que celui-ci ait lieu ; un bouton grisé ne s'enfonce pas. La barre annule le `mousedown` pour garder la sélection du texte, et Firefox n'allume alors jamais `:active` sur ses boutons : `::part(button down)` donne le même retour d'appui dans les trois moteurs.

```css
mjs-core-editor::part(toolbar-button):hover { border-color: currentColor }
mjs-core-editor::part(toolbar-button down) { transform: translateY(1px) }
mjs-core-toolbar::part(button down) { transform: translateY(1px) }
mjs-core-editor::part(link-apply) { font-weight: 700 }
``` **Variables** (toutes facultatives, elles suivent `--mjs-*` du thème général) : `--mjs-editor-border`, `-radius`, `-bg`, `-fg`, `-accent`, `-accent-fg`, `-focus` (l'anneau de focus), `-bar-bg`, `-btn-radius`, `-min-height`, `-max-height`, `-quote`, `-link`, `-check`, `-check-border`, `-check-fg`.

La zone est un `textbox` multiligne étiqueté, la barre une `toolbar` étiquetée. Dans une liste à cocher en saisie, chaque ligne reçoit un `aria-description` (« Case cochée », « Case non cochée », dans la langue de la page, bascule à chaud comprise) posé sur la surface seulement, jamais dans le HTML produit, et une zone `aria-live` annonce « Case cochée » ou « Case décochée » à chaque bascule. Les bordures suivent `currentColor` (mode contraste forcé), les transitions s'éteignent avec `prefers-reduced-motion`.

Les textes sans attribut (noms des boutons, ligne du lien, annonces des cases) se changent dans le dictionnaire du projet sous `mjs.core.<clé>` : `toolH2`, `toolH3`, `toolQuote`, `toolBold`, `toolItalic`, `toolUnderline`, `toolStrike`, `toolUl`, `toolOl`, `toolCheck`, `toolLink`, `toolUndo`, `toolRedo`, `toolClear`, `toolbarShift` (le nom de la touche Maj dans le titre des boutons : « Maj », « Shift »), `toolColor`, `linkLabel`, `linkApply`, `linkRemove`, `linkCancel`, `linkDone`, `colorsLabel` (le nom de la ligne des couleurs), `colorNone`, `colorGray`, `colorBrown`, `colorOrange`, `colorYellow`, `colorGreen`, `colorBlue`, `colorPurple`, `colorPink`, `colorRed`, `boxChecked`, `boxUnchecked`, `checked`, `unchecked`.

## `<@@sortable>` — liste triable par glisser

```html
<@@sortable value=!{$etapes}>
  {for et in $etapes by id}
    <div>{et.titre}</div>
  {end}
</@@sortable>
```

Chaque enfant du module est une ligne que l'on déplace en la glissant, à la souris, au doigt ou au clavier. Pendant le geste, les autres lignes s'écartent pour lui faire place ; au lâcher, la liaison `value=!{$etapes}` remet `$etapes` dans le nouvel ordre : rien d'autre à écrire. Mettez `by` (ici `by id`) sur la boucle, pour que chaque ligne garde son état en changeant de place.

**Liste calculée.** Une liste triée ou filtrée n'a pas de variable à remettre en ordre : n'écrivez pas `value`, écoutez `sort` et rangez vous-même.

```html
<@@sortable @sort={deplace(e.data.from, e.data.to)}>
  {for et in $visibles by id}
    <div>{et.titre}</div>
  {end}
</@@sortable>
```

**`sort`** part une seule fois, quand une ligne est posée à une autre place ; rien ne part pour un geste annulé ou une pose à la place de départ. Il ne se confond pas avec le `change` des champs placés dans les lignes. Sa charge, dans `e.data` :

| Champ | Contenu |
|---|---|
| `from` | la place de départ de la ligne (à partir de `0`), dans sa liste de départ |
| `to` | sa place d'arrivée, dans la liste où elle est posée, une fois la ligne déplacée |
| `item` | l'élément de `value` qui a bougé (absent sans liaison) |
| `order` | le nouvel ordre, en places d'avant : `[1, 2, 0]` veut dire que la 2ᵉ ligne passe en tête (absent quand la ligne change de liste) |
| `source` | la liste d'où vient la ligne, quand elle change de liste (absent sinon) |

| Attribut | Rôle |
|---|---|
| `value` | la liste, remise dans le nouvel ordre au lâcher (two-way, facultatif) ; elle doit compter autant d'éléments que de lignes |
| `handle` | un sélecteur : seul ce qui le porte, dans la ligne, la saisit (`handle=".poignee"`) |
| `group` | un nom : deux listes qui portent le même `group` s'échangent leurs lignes |

### Groupes

Deux listes du même `group` s'échangent leurs lignes : une ligne peut passer de l'une dans l'autre, à la souris, au doigt ou au clavier. Les listes peuvent être côte à côte, ou l'une dans une ligne de l'autre (deux niveaux) : une ligne entre alors dans un groupe, ou en sort.

Le code des groupes n'est envoyé que si l'une des listes de vos pages écrit l'attribut `group` (même `group={…}`), en développement comme en production, au serveur comme au navigateur. Dans le doute (un étalement `{...props}`, une balise dynamique qui pose `group`, un script qui nomme la balise de la liste : le `<script>` d'un composant, un module `.civet`, `.coffee`, `.js` ou `.ts` du projet), il reste. Une liste qui reçoit `group` d'un script alors qu'aucune page ne l'écrit n'échange donc pas ses lignes, et la console du développement vous le signale : écrivez l'attribut dans le gabarit, lié à une variable si un script doit le changer.

```html
<@@sortable value=!{$aFaire} group="taches">
  {for et in $aFaire by id}
    <div>{et.titre}</div>
  {end}
</@@sortable>
<@@sortable value=!{$faites} group="taches">
  {for et in $faites by id}
    <div>{et.titre}</div>
  {end}
</@@sortable>
```

```html
<@@sortable value=!{$menu} group="menu">
  {for d in $menu by id}
    <section>
      <h3>{d.nom}</h3>
      <@@sortable value=!{d.lignes} group="menu">
        {for l in d.lignes by id}
          <div>{l.nom}</div>
        {end}
      </@@sortable>
    </section>
  {end}
</@@sortable>
```

**Où la ligne se pose.** C'est la liste du groupe la plus proche du pointeur (à 24 pixels près), et la plus intérieure si le pointeur est dans plusieurs ; la place est celle que dit le milieu de la ligne tenue. Dans la liste de départ les autres lignes se referment sur le vide, dans celle d'arrivée elles s'écartent. Un lâcher hors de toute liste du groupe annule. Une liste vide est une cible, même sans hauteur : donnez-lui pourtant une hauteur minimale, pour que l'on voie où poser.

**Les deux `value`.** Au lâcher, la ligne quitte la `value` de sa liste de départ et entre dans celle de la liste d'arrivée : c'est le même objet, à la place `to`. Une liste sans `value` n'est pas touchée : écoutez `sort`. La ligne qui change de liste vient de la `value` de la liste de départ : sans elle, le module n'a rien à poser dans la `value` de la liste d'arrivée, et `item` est absent.

**`sort` part de la liste d'arrivée,** une seule fois pour tout le geste, avec `source` : la balise de la liste d'où vient la ligne. Pour la reconnaître, posez un attribut sur la balise (`data-id={d.id}`), puis lisez `e.data.source.dataset.id`. Une liste sans `value` se range donc seule avec `from`, `to` et `source` :

```html
<@@sortable data-id="a" group="colonnes" @sort={deplace('a', e.data)}>
```

Quand une liste est dans la ligne d'une autre, `sort` remonte au `@sort` de la liste extérieure comme tout événement de MJS : le gestionnaire le plus proche le prend, et `.propagate` (`@sort.propagate={…}`) le laisse continuer. `e.target` est la liste qui l'a émis.

**Deux niveaux.** Un appui dans la liste intérieure ne saisit que la ligne intérieure ; un appui ailleurs dans la ligne extérieure (l'en-tête du groupe) saisit le groupe. Une ligne qui porte elle-même des listes du groupe, comme un groupe, se range à son étage ou au-dessus : elle ne descend jamais dans les listes des autres lignes, ni dans les siennes. Une ligne qui n'en porte pas (une ligne de premier niveau, un élément) entre dans tous les groupes. Une ligne qui sort d'un groupe devient un élément de la liste extérieure : le gabarit de cette liste dessine ce qu'elle reçoit (un groupe ou une simple ligne, par un `{if}`).

**Clavier.** La liste n'a qu'un arrêt de tabulation : Tab y entre par la dernière ligne visitée (la première ligne visible au départ) et en ressort d'un coup ; hors saisie, les flèches haut et bas mènent de ligne en ligne, sans boucler, et sautent une ligne cachée. Sur la ligne qui a le focus, Espace la saisit, les flèches haut et bas la déplacent dans sa liste, Espace la pose, Échap annule. Une ligne que la page ajoute ou retire pendant la saisie ne fausse pas la place : Espace sans avoir bougé pose la ligne où elle est, sans `sort` ; déplacée, la ligne garde la place annoncée, entre les mêmes voisines, même si la ligne ajoutée ou retirée est entre sa place de départ et celle-ci, et `sort` dit cette place. Le focus reste sur la ligne ; s'il la quitte, elle et ses éléments (un bouton, un champ), la saisie est annulée. Pendant une saisie les flèches sont à la liste : gauche et droite ne font pas défiler la page, même sans groupe. Dans un groupe, gauche et droite changent de liste : gauche sort la ligne de sa liste, juste après la ligne qui la contient ; droite l'entre dans la liste du groupe qui suit sa place, sinon dans celle qui la précède. Une liste de premier niveau n'a ni groupe où entrer ni groupe d'où sortir : gauche et droite passent à la liste voisine, à la même place. Un lecteur d'écran annonce chaque pas, même quand le texte est celui du pas d'avant : « Ligne saisie, place 2 sur 5… », « Déplacée en place 3 sur 5 », « Déplacée dans la liste 2 sur 3, place 1 sur 4 », « Entrée dans la liste 2 sur 3, place 1 sur 3 », « Sortie vers la liste 1 sur 1, place 3 sur 5 », « Ligne posée en place 3 sur 5 », « Déplacement annulé… ». Quand la ligne passe dans une autre liste, l'annonce dit laquelle : son nom si elle en a un (`aria-labelledby` sur la balise de la liste, sinon `aria-label`), sinon sa place parmi les listes voisines (« la liste 2 sur 3 »). Les textes existent en français et en anglais (la langue de la page choisit) ; le dictionnaire du projet les surcharge sous les clés `mjs.core.sortableGrab`, `mjs.core.sortableGrabGroup` (la saisie dans un groupe, qui parle de gauche et de droite), `mjs.core.sortableMove`, `mjs.core.sortableHop` (le passage à une liste voisine), `mjs.core.sortableEnter`, `mjs.core.sortableLeave`, `mjs.core.sortableDrop` et `mjs.core.sortableCancel` (`{n}` : la place, `{total}` : le nombre de lignes de la liste où la ligne se trouve ; `{list}` : la liste où la ligne arrive, que disent `mjs.core.sortableNamed` (`{name}` : son nom) ou, sans nom, `mjs.core.sortableUnnamed` (`{n}` : sa place, `{total}` : le nombre de listes voisines)). La liste porte le rôle `list` et chaque ligne le rôle `listitem` ; une seule ligne porte `tabindex="0"`, celle qui tient l'arrêt de tabulation, et les autres `tabindex="-1"` (sauf si vous avez posé vous-même un `role` ou un `tabindex`). Une ligne cachée (`hidden`, `display: none`) ou à laquelle vous avez donné `tabindex="-1"` ne tient pas l'arrêt : il va à la première ligne visible, et une liste dont aucune ligne ne peut le tenir n'en a pas. Chaque ligne dit aussi aux lecteurs d'écran qu'elle se déplace (`aria-roledescription` : « ligne déplaçable ») et comment (`aria-description` : « Espace pour saisir la ligne et la déplacer »), dans la langue de la page (clés `mjs.core.sortableRole` et `mjs.core.sortableHint`) ; une ligne qui porte déjà son `role`, son `tabindex` ou l'un de ces attributs garde le sien.

Une ligne que la page cache après coup — un filtre qui pose `hidden`, une classe ou un style sur la ligne — rend aussitôt l'arrêt à la première ligne visible ; `visibility: hidden` et `inert` comptent aussi comme cachés. Une liste cachée tout entière par un parent garde son arrêt pour le moment où elle reparaît.

**Le geste.** À la souris, la ligne part après 5 pixels ; au doigt, après un appui de 250 ms sans bouger de plus de 10 pixels (un balayage plus rapide reste un défilement de la page). Toute la ligne se saisit, sauf ses boutons, liens et champs, qui gardent leur clic ; avec `handle`, seule la poignée la saisit. Un lâcher hors de la liste (au-delà de 24 pixels) annule, Échap aussi. Près d'un bord, la page — ou la zone qui contient la liste survolée, si elle défile — défile seule. Le clic qui suit un glisser est avalé. Ces seuils sont fixes. Le module n'ajoute aucun champ caché : il n'a pas de `name` et ne participe pas à un `<form>`.

**Style.** La ligne tenue porte `mjs-sortable="held"` et les lignes écartées `mjs-sortable="shift"` (le temps du geste seulement). Le décalage passe par les variables `--mjs-sortable-dy` (vertical) et `--mjs-sortable-dx` (horizontal, seulement pour la ligne tenue d'un groupe, qui suit alors le pointeur dans les deux sens), posées sur chaque ligne et lues en `translate` : `transform` reste libre pour `@flip` et pour vos effets. **Part** : `list`. **Variable** : `--mjs-sortable-shadow` (l'ombre de la ligne tenue). Avec `prefers-reduced-motion: reduce`, les lignes ne glissent plus.

**Limites.** Avec une liaison à sens unique (`value={$vue}` et non `value=!{$vue}`), c'est votre page qui range : son `@sort` doit réaffecter la liste à chaque geste, y compris quand elle refuse le déplacement (`$vue = [...$vue]` remet la liste du module dans l'ordre de la page) ; sans cela, `item` vient d'une liste périmée au geste suivant. Une ligne masquée par `display: none` garde sa place dans l'ordre et l'ordre final est juste, mais pendant le glisser les lignes visibles ne se placent pas toujours exactement à leur place d'arrivée, et si la ligne masquée tenait l'arrêt de tabulation, Tab saute la liste tant que ses lignes ne changent pas et qu'aucune ne prend le focus : retirez plutôt la ligne de la boucle (`{if}`). La liste ne doit pas avoir d'ancêtre mis à l'échelle (`transform: scale(…)`, `zoom`) : la ligne tenue ne suit plus le pointeur et les lignes écartées ne vont pas jusqu'à leur place.

### Fondu enchaîné

Posez `*crossfade` sur les lignes, avec une clé qui reconnaît la ligne d'une liste à l'autre : une ligne qui change de liste vole de sa place de départ à sa place d'arrivée. Le module n'a rien de plus à écrire, et sans `*crossfade` rien ne change.

```html
<@@sortable value=!{$aFaire} group="taches">
  {for et in $aFaire by id}
    <div @transition=*crossfade(key: et.id)>{et.titre}</div>
  {end}
</@@sortable>
<@@sortable value=!{$faites} group="taches">
  {for et in $faites by id}
    <div @transition=*crossfade(key: et.id)>{et.titre}</div>
  {end}
</@@sortable>
```

**Ce qui se joue.** À la souris et au doigt, la ligne est déjà sous le pointeur : elle vole de là où vous l'avez lâchée jusqu'à sa place, et une seule ligne se voit à chaque image (l'ancienne s'efface pendant que la neuve apparaît). Au clavier, la ligne a déjà rejoint sa place quand vous la posez : la neuve la remplace sans autre mouvement, et le focus la suit. Quand votre application déplace elle-même une ligne d'une liste à l'autre (un bouton qui réécrit les deux listes liées), la ligne vole de sa place de départ à sa place d'arrivée. Un réordre dans une même liste ne fait voler personne : la ligne glisse comme d'habitude.

**Les voisines.** Au lâcher, la ligne qui part quitte sa liste là où vous l'avez lâchée : la liste de départ reste refermée et la liste d'arrivée ouverte, sans saut ; dans deux niveaux, les sections qui suivent glissent à leur nouvelle place quand la hauteur d'une section change. Pour un déplacement par bouton, ajoutez `@flip` aux lignes (`<div @transition=*crossfade(key: et.id) @flip=200>`) si vous voulez que les voisines glissent ; sans lui, la liste de départ se referme à la fin du vol (cf. [10 · Transitions](10-transitions.md#flip--réordonnancement-de-liste)).

**À savoir.** C'est la transition de votre page qui joue : avec un `@out` seul, l'ancienne ligne s'estompe là où vous l'avez lâchée et la neuve apparaît à sa place, sans glisser. Avec « réduire les animations », la ligne passe d'un coup.

**En production.** Le code du fondu n'est envoyé que si l'une des pages de votre application écrit une transition (`@in`, `@out` ou `@transition`, sur les lignes ou ailleurs) ; sans transition, une application à groupes envoie le module sans lui. Une transition donnée seulement par un script ne l'allume pas : écrivez-la sur la ligne. En développement, tout est présent, et un avertissement vous le rappelle.

## Les composants animés

Des composants d'interface qui portent leur mouvement avec eux. Ceux qui ont une valeur la lient dans les deux sens (`value=!{$x}`, `index=!{$i}`, `open=!{$o}`) et émettent `change`.

### `<@@carousel>` — carrousel

```html
<@@carousel index=!{$i} width="200" height="300">
  {for a in $affiches}<img src={a.src} alt={a.titre}>{end}
</@@carousel>
```

Les enfants se rangent en éventail autour de celui du centre : ils glissent, rapetissent et pivotent en 3D selon leur écart au centre, avec un reflet au sol. Chacun porte l'attribut `mjs-carousel-pos` (son écart : `0` au centre, `-1` à sa gauche…), pour le styliser selon sa place.

| Attribut | Rôle |
|---|---|
| `index` | l'enfant au centre (two-way) — `0` ; sans boucle, un index hors du nombre d'enfants (trop grand, négatif, ou une liste qui rétrécit) montre le dernier ou le premier |
| `layout` | sans rien : en éventail, pivotés en 3D ; `flat` : à plat |
| `width`, `height` | la taille d'un enfant, en px — `200`, `300` |
| `wheel` | la molette de la souris fait tourner |
| `buttons` | les flèches précédent/suivant — oui ; `buttons="false"` les retire |
| `reflect` | le reflet au sol, sans `layout` (en éventail) — oui |
| `loop` | au bout, on repart de l'autre bout — oui |

Les flèches du clavier font tourner aussi. **Parts** : `carousel`, `stage`, `buttons`, `button`. **Variables** : `--mjs-carousel-button` (la couleur des deux flèches, `#fff`) et `--mjs-carousel-shadow` (l'ombre de chaque enfant, `0 0 50px rgba(0, 0, 0, .5)`).

### `<@@deck>` — paquet de cartes

```html
<@@deck>
  <div title="Star Lord">…</div>
  <div title="Iron Man">…</div>
  <div title="Groot">…</div>
</@@deck>
```

Les enfants s'empilent au même endroit. Sans `layout` : au survol du paquet, ils s'ouvrent en éventail (`gap`, `angle`) ; la carte survolée sort du rang, reprend ses couleurs, et son `title` monte au-dessus d'elle, avec une barre (`color`). `layout="spread"` : une pile de cartes inclinées qui se déploie en ligne au survol. `width` et `height` règlent la taille d'une carte. Le clavier fait comme la souris : le focus dans le paquet l'ouvre, et la carte qui le tient (une carte lien, ou un bouton dans la carte) se soulève comme celle qu'on survole.

### `<@@tabs>` — onglets

```html
<@@tabs value=!{$onglet}>
  <span value="accueil">⌂</span>
  <span value="profil">☺</span>
</@@tabs>
```

Chaque enfant est un onglet ; sa `value` (sinon son rang) est la valeur du composant. L'onglet actif porte l'attribut `active`. `change` part quand l'onglet actif change : un clic sur l'onglet déjà actif n'annonce rien. Au clavier : Tab mène à l'onglet actif ; les flèches passent d'un onglet à l'autre, Début et Fin au premier et au dernier ; une touche tenue avec Alt, Ctrl ou Méta reste au navigateur (Alt+← reste le « retour »). Sans `layout` : un trait lumineux (`color`) glisse sous l'onglet actif, `gap` règle l'écart entre les onglets, `--mjs-tabs-panel` le fond du panneau (`#182d3c`). `layout="curve"` : un menu vertical qui ne montre que les icônes au repos et s'élargit au survol pour montrer les libellés, l'onglet actif découpé en creux dans son bord (`accent`, `background`) — l'icône d'un onglet s'écrit dans son attribut `icon` (`<a value="accueil" icon="⌂">Accueil</a>`), ou c'est son premier élément (un `<svg>`, une `<img>`). Les flèches du clavier passent d'un onglet à l'autre.

### `<@@menu>` — menu circulaire ou tiroir

```html
<@@menu open=!{$ouvert}><a href="/">⌂</a><a href="/profil">☺</a>…</@@menu>
<@@menu layout="drawer"><a href="/profil" icon="☺">Profil</a>…</@@menu>
```

Sans `layout` : un bouton rond (+), qui vient avant les entrées au clavier ; Échap referme et rend le focus au bouton (un Échap déjà pris par un élément du menu, `preventDefault()` appelé, comme celui qui referme une liste `<@@select>` ouverte, laisse le menu ouvert). Ouvert, un anneau clair l'entoure et les enfants y apparaissent, sur place, le premier à gauche puis dans le sens des aiguilles d'une montre — `radius` (115) est la distance entre le centre du bouton et celui de chaque entrée, l'anneau suit. `layout="drawer"` : un tiroir qui s'ouvre par sa languette ; fermé, il ne montre que les icônes — l'icône d'une entrée s'écrit dans son attribut `icon` (`<a icon="☺">Profil</a>`), ou c'est son premier élément (un `<svg>`, une `<img>`). `color` et `background` règlent ses deux couleurs, `label` le nom annoncé du bouton. Dans le menu circulaire, `--mjs-menu-hover` règle le fond d'une entrée survolée (`#29fd53`).

### `<@@clock>` — horloge et minuteur

```html
<@@clock></@@clock>
<@@clock layout="timer" seconds="60"></@@clock>
```

Sans `layout` : l'heure en trois cadrans pointillés, le trait de l'instant s'allume (`colors` : les trois couleurs ; `labels` : les trois libellés, `Heures, Minutes, Secondes` (`Hours, Minutes, Seconds` en anglais) ; `ampm`). `layout="timer"` : un minuteur rond qui compte `seconds` secondes puis repart (`color`, `running="false"` l'arrête ; relancé, il reprend où il s'était arrêté, l'aiguille avec le chiffre) ; il émet `tick` à chaque seconde écoulée ; le chiffre se lit sur l'horloge, et un passage de l'intervalle en retard (page chargée, onglet ralenti) rattrape ses secondes, avec un `tick` pour chacune.

### `<@@knob>` — bouton rotatif

```html
<@@knob value=!{$volume} min="0" max="100" name="volume"></@@knob>
```

On le tourne à la souris (glisser), à la molette ou au clavier (flèches, Début, Fin). `value=!{$x}` suit chaque pas ; `@change` part une fois, à la fin du geste (pointeur relâché, touche relâchée, molette arrêtée), si la valeur a bougé, comme `<@@number>` et `<@@gauge>`. `min`, `max`, `step`, `arc` (l'arc parcouru, en degrés — `250`), `offset` (son départ, compté depuis midi — `-125`), `color`, `track`, `size`, `thickness`, `disabled` (désactivé, il n'est pas soumis) ; `name` le fait participer à un formulaire ; un `step` nul retombe sur 1. Rôle ARIA `slider`. C'est un élément du formulaire, comme une glissière native (`<input type="range">`) : il a toujours une valeur, `required` n'y a donc pas d'effet ; une `<label for>` met le focus sur son cadran, un `<fieldset disabled>` le désactive (voir [Dans un formulaire](#dans-un-formulaire)). Un `min` plus grand que le `max` bloque la valeur sur une borne : la console le signale.

### `<@@number>` — champ nombre

```html
<@@number value=!{$quantite} min="0" max="20"></@@number>
<@@number value=!{$prix} step="0.5" placeholder="libre" name="prix"></@@number>
<@@number value=!{$score} min="0" max="1000" big="100"></@@number>
<@@number value=!{$montant} decimals="2" min="0" name="montant"></@@number>
```

Un champ nombre sans les flèches du navigateur : une pilule, « − » dans le bord gauche, « + » dans le bord droit, la saisie au milieu. Un clic fait un pas (`step`, 1 par défaut) ; un bouton gardé appuyé accélère ; au clavier, les flèches haut et bas font un pas, Page haut et Page bas dix pas (le grand pas si `big` est écrit ; voir plus bas), Début et Fin mènent au `min` et au `max` quand ils sont écrits (sans eux, ou tenues avec Maj, Ctrl, Alt ou Méta, ces touches restent au texte : Maj + Début sélectionne jusqu'au début). À la borne (`min`, `max`), le bouton se grise ; une valeur tapée hors des bornes reste écrite telle quelle jusqu'à la sortie du champ, où elle y est ramenée — entre-temps, la variable liée, le formulaire et `aria-valuenow` ne reçoivent que la valeur bornée. La frappe ne garde que des chiffres, un signe en tête si `min` est négatif ou absent, et des séparateurs, virgule ou point — un seul sous un pas décimal, comme dans un champ nombre natif. Sous un pas entier (le défaut), un séparateur suivi d'exactement trois chiffres groupe des milliers : « 1,000 » et « 10.000 » valent 1000 et 10000, « 1.234,56 » vaut 1234,56, arrondi à 1235 ; tout autre séparateur est la virgule décimale : « 1.5 » tapé reste écrit tel quel et la valeur est arrondie (2), jamais lue 15. L'arrondi se fait aux décimales du pas, pas à son multiple : avec `step="5"`, « 7 » tapé vaut 7 ; les boutons et les flèches, eux, avancent d'un pas. Un pas très fin (`step="0.0000001"`) compte toutes ses décimales, et la valeur s'écrit en clair. Avec un `placeholder`, le champ peut rester vide (la valeur vaut alors `''`).

**Décimales fixes.** `decimals` fixe le nombre de décimales montrées, au format de la langue de la page : avec `decimals="2"`, 64,3 s'écrit « 64,30 » en français et « 64.30 » en anglais, 64 s'écrit « 64,00 » ; `decimals="0"` montre un entier (« 64 »). Le séparateur, virgule ou point, est celui que le navigateur écrit pour la langue de la page, la même qui choisit les libellés (voir [Libellés par défaut et langue de la page](#libellés-par-défaut-et-langue-de-la-page) ; sans langue, la virgule du français) : il suit `µlang` sans remonter le module. La variable liée, `@change` et le formulaire reçoivent toujours le nombre (64.3, envoyé « 64.3 »). La frappe, les flèches et les boutons arrondissent à ces décimales, la virgule et le point se tapent dans toutes les langues, et la sortie du champ remet la frappe au format (« 12,346 » devient « 12,35 »). Sans `step`, le pas est la plus petite unité de ces décimales (0,01 avec `decimals="2"`) : une valeur tapée reste dans le pas, que le formulaire valide comme un champ nombre natif. Un `step` écrit garde la main et valide de même : avec `step="1"`, « 64,30 » est hors du pas ; pour des centimes et des boutons d'une unité, laissez le pas aux décimales et ajoutez `big="1"`. Un pas, un grand pas ou une borne qui ont plus de décimales que `decimals` imposent les leurs (`decimals="1" step="0.05"` montre « 1,05 ») : la valeur montrée est toujours celle que tient le champ. Une valeur donnée par la page avec plus de décimales s'affiche arrondie ; la variable ne l'est qu'au premier geste. Sans `decimals`, la valeur s'écrit telle quelle, au point (« 64.3 »). `decimals` attend un entier de 0 à 100, écrit en chiffres (`decimals="2"`) ou en nombre (`decimals={2}`) ; une autre valeur (« abc », « -1 », « 2,5 », « 2.5 », « 101 ») est ignorée, la valeur s'écrit comme sans `decimals`, et la console le dit par une erreur, au montage puis à chaque changement qui la laisse fausse.

`value=!{$x}` lie la valeur dans les deux sens, pendant le geste ; `@change` part une fois, à la fin du geste (bouton relâché, flèche relâchée, sortie du champ), si la valeur a bougé. `name` le fait participer à un formulaire ; `disabled` le désactive (il n'est pas soumis) ; `required` le rend obligatoire, et `min`, `max`, `step` le valident comme un champ nombre natif : c'est un élément du formulaire (voir [Dans un formulaire](#dans-un-formulaire)) ; `label` le nomme pour un lecteur d'écran, `less-label` et `more-label` nomment ses boutons (« Moins », « Plus » ; « Less », « More » en anglais). `big` ajoute un grand pas : « −− » et « ++ » aux bords, autour de « − » et « + » (`<@@number big>` : un grand pas de 10 ; `big="100"` : de 100 ; `step="0.5" big="5"` : petit pas 0,5, grand pas 5). Sans `big`, les deux boutons du grand pas ne paraissent pas, et Page haut et Page bas font dix pas. Le grand pas a le même appui long qui accélère et les mêmes bornes ; `big-less-label` et `big-more-label` nomment ses boutons (« Diminuer de 10 », « Augmenter de 10 » : le nombre suit `big`). Sa largeur, son arrondi et ses couleurs : `--mjs-number-width` (160px ; 240px avec `big`, pour ses deux boutons de plus), `--mjs-number-radius`, `--mjs-number-border`, `--mjs-number-accent` (la bordure du champ qui a le focus), `--mjs-number-focus` (l'anneau de 3px autour du champ qui a le focus : bleu pâle, `rgba(59, 130, 246, .35)`), `--mjs-number-step-bg` (le fond de « − » et « + » : transparent, donc celui du champ), `--mjs-number-step-hover` (leur fond au survol et à l'appui : un voile gris, `rgba(127, 127, 127, .32)`). Un `min` plus grand que le `max` bloque la valeur sur une borne : la console le signale.

**Remplir son conteneur.** La balise est en ligne (`inline-block`) et le champ fait 160px : pour qu'il prenne toute la largeur de son conteneur, donnez-la à la balise (`display: block`, ou `flex: 1` dans une rangée flex) et au champ (`--mjs-number-width: 100%`), `big` compris. Dans le `<style>` du composant qui l'emploie, pour `<@@number class="montant">` :

```sass
.montant
  display: block
  --mjs-number-width: 100%
```

### `<@@gauge>` — compteur à jauge

```html
<@@gauge value=!{$places} max="10" warn="8" wheel></@@gauge>
```

Un compteur debout : le nombre, sa jauge verticale et deux boutons. Il mesure 44 px de large et 230 de haut. On clique « + » ou « − », on roule la molette (`wheel`), ou on prend les flèches du clavier, Début et Fin menant au `min` et au `max` — on n'y tape pas de nombre. La jauge passe à `warn-color` à partir de `warn`. `min` (0), `max` (10), `step` (un pas nul ou négatif retombe sur 1, et la console le signale), `color`, `name` (il participe à un formulaire), `label`, `disabled` (désactivée, elle ne répond ni au clavier, ni aux boutons, ni à la molette, et elle n'est pas soumise, comme un champ natif désactivé) ; `value=!{$x}` suit chaque pas, `@change` part à la fin du geste : un clic, une flèche relâchée, la molette arrêtée. Rôle ARIA `spinbutton`. Ce n'est pas un simple affichage, comme `<meter>` : on la règle et elle part avec le formulaire, c'est donc un élément du formulaire, comme une glissière native (`<input type="range">`) — elle a toujours une valeur, `required` n'y a pas d'effet ; une `<label for>` met le focus sur son compteur, un `<fieldset disabled>` la désactive (voir [Dans un formulaire](#dans-un-formulaire)). Un `min` plus grand que le `max` (celui par défaut compris : `min="20"` seul) bloque la valeur sur une borne : la console le signale.

Ce n'est pas un modèle de `<@@number>` : un modèle (`layout`) change l'allure d'un composant sans changer le geste ni les réglages. Ici le geste diffère (on ne tape rien), les bornes aussi (0 à 10 sans rien écrire, jamais vide), et les réglages (`warn`, `wheel`, `color`) n'ont pas de sens sur un champ : c'est un autre composant.

### `<@@progress>` — cercle de progression

```html
<@@progress value={$avance}></@@progress>
<@@progress scroll follow></@@progress>
```

Un cercle qui se remplit, le pourcentage au centre (`text="false"` le retire). `value` sur `max`, juste dès le chargement et au redimensionnement ; `scroll` : il suit le défilement de la page ; `follow` : il suit la souris, une fois par image, et se cache quand elle quitte la fenêtre ; sans l'un ni l'autre, il n'écoute pas la fenêtre. `size`, `color`, `track`, `thickness`.

### `<@@cube>` — cube lumineux

```html
<@@cube color="#ff0606">✕</@@cube>
```

Un cube qui tourne, son contenu (une icône, un caractère) sur le dessus, sa lumière au sol. `size`, `height`, `color`, `speed` (un tour, en secondes), `hue` (les couleurs tournent — oui).

## Tous compatibles `<form>` natif

Les modules de saisie — select, case, radio, interrupteur, éditeur de texte, et `<@@knob>`, `<@@number>`, `<@@gauge>` dès qu'ils portent un `name` ; la pastille `<@@color>`, elle, montre une couleur sans rien soumettre — maintiennent chacun un ou plusieurs `<input type="hidden">` internes qui reflètent leur valeur courante. Un `<form method="post">` classique les ramasse donc comme n'importe quel champ natif, sans un `µ.ajax` ni un `@submit` à écrire : c'est cette même mécanique qui rend `<@@field>` capable de lire `µres.errors[name]` — le `name` posé sur le module est le même que celui reçu côté serveur. Un `<@@select other>` garde le champ nommé `name` pour ses options, et envoie chaque réponse libre dans un champ caché nommé comme la liste suivi de `_other`, les crochets respectés : `groupe` donne `groupe_other`, `allergies[]` donne `allergies_other[]`, `profil[groupe]` donne `profil[groupe_other]`.

Dans une page rendue par le serveur, le champ caché de chaque module est déjà écrit dans sa balise (le formulaire s'envoie avant même le démarrage du JavaScript) : le module le reprend au démarrage au lieu d'en ajouter un second, et la reprise de la page (`ssr:markers`, `ssr:positional`, `ssr:diff`) le laisse en place, quel que soit l'ordre dans lequel le navigateur charge les morceaux. Le module ne reprend que le champ que le serveur a écrit pour lui (il porte l'attribut `mjs-f`, que seul le serveur écrit) : un champ caché que vous placez vous-même dans sa balise, sous le même nom, reste en place et part avec le formulaire, à côté du sien — c'est la forme d'un `check_box` de Rails, où la case est précédée d'un champ caché de valeur `0`. Dans le navigateur, le module garde la référence du champ qu'il crée et ne lui pose pas cette marque : une liste à choix multiple garde un champ par valeur choisie, et l'éditeur en mode « répondre » un champ par case cochée. La balise du module dit aussi son état de départ — `checked` pour la case, l'interrupteur et le radio, `group` pour un radio lié à un groupe, `value` pour le nombre, la jauge, le bouton rotatif et la liste —, même quand la page le pose par expression (`checked={…}`, `value={…}`) : un module chargé avant la page se monte sur cette balise et part du bon état, et `form.reset()` y revient. Un état faux (`false`), une valeur vide ou un objet n'écrivent aucun attribut, un zéro s'écrit (sauf celui de la jauge et le 50 du bouton rotatif, qui sont leur valeur par défaut : une balise sans `value` la dit déjà), et une liste à choix multiple n'écrit son `value` que pour un tableau de textes et de nombres. Seul le serveur écrit ces attributs, comme la marque `mjs-f` de ses champs : dans le navigateur, le module ne les écrit pas, et le code qui les écrit — avec celui qui retrouve les champs du serveur par leur marque — n'est envoyé en production qu'aux applications qui reprennent des pages rendues par le serveur — celles qui demandent le moteur de reprise, par un mode de rendu `ssr:markers`, `ssr:positional` ou `ssr:diff` (par défaut ou sur une route) ou par `runtime: ['hydrate']`. Une application sans rendu serveur, ou dont le navigateur refait les pages rendues par le serveur (`csr`, `prerender`, `ssr`), ne le reçoit pas (de 35 à 160 octets gzip de moins par module qu'une application qui reprend ses pages) ; le développement le garde toujours. Le formulaire envoie la valeur courante du module, en un seul champ ; la liste à choix multiple envoie un champ par valeur choisie (`m=a&m=c`), et vos propres champs cachés s'ajoutent à ceux des modules.

**`form.reset()`.** La case, l'interrupteur, le radio, `<@@number>`, `<@@gauge>`, `<@@knob>`, `<@@select>` et `<@@editor>` reviennent à l'état de départ de leur formulaire — celui que le formulaire suit, pas forcément celui du premier rendu —, même quand la remise à zéro est annulée après coup par un écouteur (`preventDefault()`) ; un radio monté tard ou réordonné rejoint son groupe et revient à son bon bouton. La jauge et le bouton rotatif retrouvent la valeur que la page leur a donnée (0 et 50 quand elle n'en dit rien), sans annoncer de `change` : la variable liée suit, et un geste en cours (flèche tenue, molette) s'arrête avec la remise. Dans une page rendue par le serveur et reprise par le navigateur (`ssr:markers`, `ssr:positional`, `ssr:diff`) dont le code des modules arrive avant celui de la page, l'état de départ est celui que le serveur a écrit dans la balise : quand le navigateur calcule un autre état que le serveur, `form.reset()` ramène l'état écrit par le serveur. Limite : dans un `{for}` réordonné, un champ natif lié par `value` se vide à la remise à zéro, et un `checked` natif revient à l'état de son premier rendu.

### Dans un formulaire

Les huit modules de saisie — la case, l'interrupteur, le radio, le nombre, le bouton rotatif, la jauge, la liste et l'éditeur — sont des **éléments du formulaire**, chacun comme le champ natif dont il tient la place : le navigateur les compte dans `form.elements`, et sur leur balise se lisent `checkValidity()`, `reportValidity()`, `setCustomValidity()`, `validity`, `validationMessage`, `willValidate` et `form`. Quand un module manque ou qu'il est invalide, `form.checkValidity()` et `form.reportValidity()` le disent, l'envoi s'arrête sur la bulle du navigateur, avec le message qu'il donne au champ natif (dans sa langue), et la balise du module porte `:invalid`, puis `:valid`. Une `<label for="id">` posée ailleurs dans la page vise le module par son `id` (`label.control` est sa balise), et donne son nom au champ de l'ombre — la case, la saisie du nombre, le cadran, le compteur, le bouton de la liste, la zone de l'éditeur —, celui que lit un lecteur d'écran ; le nom que porte la balise elle-même — son `aria-label`, ou les éléments que cite son `aria-labelledby`, posés dans la page, par un `<@@field>` autour d'elle ou plus tard (`setAttribute('aria-label', …)`) — passe de même au champ de l'ombre et l'emporte sur l'étiquette, comme la prop `label`, même posée ou changée après le montage : l'ordre est celui d'un champ natif, `aria-labelledby`, puis `aria-label` ou la prop `label`, puis l'étiquette. Un élément cité par `aria-labelledby` qui paraît après le montage (dans un `{if}`) nomme le champ dès qu'il est là. Un `<fieldset disabled>` désactive les modules qu'il contient — aucun geste ne les change, leur balise porte `:disabled`, leur validité ne compte plus, rien n'est envoyé — et les réactive avec lui. `form.reset()` ramène chacun à son état de départ (voir plus haut), et sa validité suit.

- **`<@@checkbox>`, comme une case native** : avec `required`, elle manque tant qu'elle n'est pas cochée, avec le message d'une case native ; une `<label for>` la coche, une fois, avec son `change`, comme un `click()` de la page sur sa balise ; un `<fieldset disabled>` la désactive, puis la réactive.
- **`<@@switch>`, comme une case native** : avec `required`, il manque tant qu'il n'est pas allumé, avec le message d'une case native ; une `<label for>` le bascule, une fois, avec son `change`, comme un `click()` de la page sur sa balise ; un `<fieldset disabled>` le désactive, puis le réactive.
- **`<@@radio>`, comme un bouton radio natif** : un groupe, ce sont les boutons de même `name` et de même formulaire — celui de la balise `<form>` autour d'eux, ou celui qu'ils rejoignent par `form="id"`, où qu'ils soient dans la page ; cocher l'un décoche les autres dans le geste même (deux `click()` de suite n'en laissent qu'un coché, une seule valeur part), et un bouton qui vise un autre formulaire, ou qui n'en a pas, n'est pas du groupe ; avec `required` sur un seul bouton du groupe, c'est tout le groupe qui l'est — tant qu'aucun bouton n'est coché, tous manquent et la bulle va au premier bouton du groupe, une seule fois ; le premier bouton coché, quel qu'il soit, la lève pour tout le groupe ; une `<label for>` choisit le bouton, une fois, avec son `change`, comme un `click()` de la page sur sa balise ; un `<fieldset disabled>` le désactive, puis le réactive.
- **`<@@number>`, comme `<input type="number">`** : avec `required`, il manque tant qu'il est vide, et sa saisie le dit aux lecteurs d'écran (`aria-required`) ; une valeur sous le `min` ou au-dessus du `max` (une valeur de départ, une valeur posée par la page : les boutons et la frappe, eux, restent dans les bornes), ou hors du pas, est invalide — le pas se compte depuis le `min`, sinon depuis la valeur de départ, comme celui d'un champ natif depuis son attribut `value` : sous `min="0" step="5"`, « 7 » tapé ne passe pas ; sans `min`, `step="5" value="2"` admet 7 et 12 ; `validity` (`valueMissing`, `rangeUnderflow`, `rangeOverflow`, `stepMismatch`) et `validationMessage` sont ceux d'un champ nombre natif aux mêmes règles, et la bulle s'ouvre sur la saisie, qui prend le focus ; une `<label for>` met le focus dans sa saisie, sans rien changer ni annoncer ; un `<fieldset disabled>` le désactive, puis le réactive.
- **`<@@knob>`, comme `<input type="range">`** : il a toujours une valeur, `required` n'y a donc pas d'effet, et il est toujours valide : il ne bloque jamais l'envoi ; une `<label for>` met le focus sur son cadran, sans rien changer ni annoncer ; un `<fieldset disabled>` le désactive, puis le réactive.
- **`<@@gauge>`, comme `<input type="range">`** : elle a toujours une valeur, `required` n'y a donc pas d'effet, et elle est toujours valide : elle ne bloque jamais l'envoi — ce n'est pas un simple affichage, comme `<meter>` : on la règle, elle part avec le formulaire ; une `<label for>` met le focus sur son compteur, sans rien changer ni annoncer ; un `<fieldset disabled>` la désactive, puis la réactive.
- **`<@@select>`, comme `<select>`** : avec `required`, elle manque tant que rien n'est choisi, ou que le choix est une valeur vide (en `multiple`, tant que rien n'est coché), avec le message d'un `<select required>` natif — la bulle s'accroche au bouton de la liste, qui reçoit le focus, et ce bouton porte `aria-required="true"` ; une `<label for>` met le focus sur son bouton, sans l'ouvrir ; un `<fieldset disabled>` la désactive (ouverte, elle se ferme), puis la réactive, et son propre `disabled` s'y ajoute : une liste `disabled` le reste quand le fieldset se réactive.
- **`<@@editor>`, comme `<textarea>`** : avec `required`, il manque tant que sa zone est vide — rien qu'un blanc ou des balises vides, une fois nettoyée —, avec le message d'une zone de texte native ; la bulle se pose sous la zone d'édition et le focus y va, sa zone dit `aria-required`, et en lecture seule ou désactivé, il ne compte pas ; une `<label for>` met le focus dans sa zone d'édition et lui donne son nom ; un `<fieldset disabled>` le rend non modifiable comme son attribut `disabled` — grisé, hors de la tabulation, sa barre retirée —, puis le lui rend ; `form.reset()` vide aussi sa pile d'annulation.

Un attribut booléen écrit sur la balise vaut vrai quelle que soit sa valeur, comme en HTML : `disabled=""` ou `required=""`, écrits dans la page ou posés plus tard (`setAttribute('required', '')`, `toggleAttribute('disabled')`), désactivent ou rendent obligatoire chaque module — une case cochée et désactivée n'envoie rien, comme une case native. Seule exception, la valeur `"false"`, quelle que soit sa casse (`"FALSE"`, `"False"`) : `disabled="false"`, `required="false"` et `readonly="false"` sont ôtés de la balise, au montage comme quand la page les pose plus tard (`setAttribute('required', 'FALSE')`), et tenus pour faux — le module reste actif, facultatif, modifiable ; sur l'éditeur, `answer="false"`, quelle que soit sa casse, laisse de même le mode « répondre » éteint ; toute autre valeur, vide comprise, vaut vrai, et `disabled={$x}`, `required={$x}`, `readonly={$x}` gardent leur sens (`disabled={$x ? true : null}` laisse le module actif tant que `$x` est faux ; sur l'éditeur, `disabled={…}`, `readonly={…}`, `required={…}` et `answer={…}` liés au texte `'false'`, quelle que soit sa casse, valent faux, comme l'attribut écrit). Le navigateur, lui, tient pour désactivé un élément du formulaire qui porte `disabled`, et ne valide plus celui qui porte `readonly`, quelle que soit leur valeur : c'est pour cela qu'ils sont ôtés. Quand un script ôte ensuite `disabled`, `readonly` ou `required` de la balise (`removeAttribute('required')`), le module redevient actif, modifiable ou facultatif, comme un champ natif. Une page rendue par le serveur les lit de même, avant le démarrage du JavaScript : l'éditeur avec `disabled="FALSE"` ou `readonly="FALSE"` y est actif et modifiable, son champ caché écrit. Un champ natif garde la règle du HTML : `<input type="checkbox" required="false">` reste obligatoire.

`readonly` agit comme sur le champ natif que chaque module remplace. L'éditeur, comme `<textarea readonly>`, passe en lecture seule et sort de la validation ; le nombre, comme `<input type="number" readonly>`, sort de la validation — écrit sur la balise comme lié (`readonly={$x}`) : vide et `required`, il ne bloque pas l'envoi — et se fige : sa saisie garde le focus et se laisse sélectionner, sa valeur part avec le formulaire, mais ni la frappe, ni les flèches, ni ses boutons « − » et « + », grisés, ne la changent. La case, l'interrupteur, le radio, le bouton rotatif et la jauge en `readonly` — écrit sur la balise comme lié (`readonly={$x}` : la balise le porte dès la page rendue par le serveur, que la reprise garde telle quelle, et le suit quand `$x` change) — sortent de la validation, comme une case, un bouton radio ou une glissière natifs (`willValidate` faux : une case `required readonly` décochée laisse partir le formulaire), sans que leur maniement change — la case se coche, le radio se choisit, le bouton rotatif et la jauge se règlent, comme ces champs natifs ; dans un groupe de radios, un bouton `required readonly` rend toujours le groupe obligatoire : les autres boutons manquent tant qu'aucun n'est coché, comme dans un groupe natif. La liste ignore `readonly`, comme `<select>` : il est ôté de sa balise, quelle que soit sa valeur, et elle reste validée et modifiable.

Sur ces cinq modules, une valeur liée (`readonly={$x}`) qui vaut `false`, `null` ou `undefined`, ou dont le texte est « false » quelle que soit sa casse (`'FALSE'`, et même `[false]`), laisse la balise sans `readonly` ; toute autre valeur l'y écrit, `''` et `0` compris. Écrits dans la page, `readonly="null"` et `readonly="undefined"` gardent l'attribut : seul le texte « false » l'ôte. Un champ natif lié, comme `<input type="checkbox" readonly={$x}>`, suit la règle de JavaScript : `''` et `0` n'y écrivent pas `readonly`, `'FALSE'` l'y écrit.

**`form="id"`.** Un module posé hors de la balise `<form>` la rejoint par son `id`, comme un champ natif : il compte dans ses `elements`, `required` bloque son envoi, sa valeur part avec lui (son champ caché porte le même `form`) et `form.reset()` le remet — la case, l'interrupteur, le radio, le nombre, le bouton rotatif, la jauge, la liste et l'éditeur ; un radio ainsi rattaché est du groupe des radios de même nom de ce formulaire. L'attribut est lu quand le module écrit son champ (un `form` changé ensuite suit au geste suivant, et la remise à zéro suit le formulaire visé au montage).

**`setCustomValidity()`.** La page pose son propre message sur la balise, comme sur un champ natif : `el.setCustomValidity('Choisissez un créneau')` rend le module invalide avec ce message, qui passe devant celui du module et reste après ses gestes ; `setCustomValidity('')` le lève. Une validité que la page écrit directement dans `internals` n'est pas suivie par le module : elle tient tant qu'il n'écrit pas la sienne, et il ne l'écrit que quand sa validité change — elle est donc remplacée quand il devient invalide (une case obligatoire décochée, un nombre hors de ses bornes) ou redevient valide après l'avoir été, et par un message que la page pose ensuite (`setCustomValidity('…')`) ; un module qui reste valide la garde, geste après geste.

**Un changement fait par le code.** Une valeur que le code de la page change — une variable liée au module (`checked={…}`, `group=!{…}`, `value={…}`) — change la valeur et le champ envoyé du module au prochain passage de la réactivité, et sa validité (pour le radio, celle de son groupe et son arrêt de tabulation) juste après : `checkValidity()`, `validity` ou `:invalid` lus dans la même tâche que le changement peuvent encore donner l'ancienne réponse. Ils sont à jour une fois cette tâche finie — dans un `setTimeout`, au geste suivant, à l'envoi du formulaire.

Ce qui ne bouge pas : la valeur part toujours par le champ caché du module (une paire par module coché, jamais deux ; le HTML propre de l'éditeur), une page rendue par le serveur s'envoie sans JavaScript, un module hors `<form>` (et sans `form="id"`) se comporte comme avant, les rôles sont ceux d'avant — s'y ajoutent `aria-required` sur la saisie du nombre, le bouton de la liste et la zone de l'éditeur, et le nom d'une `<label for>` passé au champ de l'ombre. Un navigateur qui ne connaît pas les éléments associés au formulaire (sans `attachInternals`) garde le comportement d'avant : le module envoie sa valeur, sans effet de `required`, des bornes du nombre ni de `<label for>` ; dans un `<fieldset disabled>`, le module reste actif, mais sa valeur ne part pas (son champ caché est désactivé avec le fieldset). Un composant de l'application devient un élément du formulaire de la même façon, par une ligne : `@formAssociated` ([Un composant de formulaire](02-composant.md#un-composant-de-formulaire--formassociated)).

## `<@@code>` — bloc de code à copier

```html
<@@code>const total = a + b</@@code>
```

Le code s'écrit **entre les deux balises, et rien d'autre** : ni `<pre>`, ni `<code>`. Le module pose lui-même le cadre, la fonte à chasse fixe et `white-space: pre`, et retire le décalage commun à toutes les lignes — celui du gabarit appelant — en conservant les retraits relatifs :

```html
<@@code>
  µmount ->
    console.log('prêt')
</@@code>
```

affiche `µmount ->` collé à gauche et `console.log('prêt')` indenté de deux espaces.

Le bouton « copier » se pose dans l'angle haut-droit, `position: sticky` : au repos, il reste dans l'angle du bloc ; quand le bloc défile sous le haut de la zone visible, il suit jusqu'au bas du bloc plutôt que de disparaître.

Un clic copie tout le texte affiché via `navigator.clipboard.writeText`. Sans cette API (page servie en http, hors localhost), repli sur `document.execCommand('copy')`. Une copie réussie affiche une coche pendant 1,6 s, le temps que le libellé annonce la copie.

### Fournir soi-même le bloc préformaté

Quand un `<pre>` est projeté — code déjà colorié par un moteur de coloration, mise en forme maison —, `<@@code>` le **laisse entièrement intact** : il n'ajoute ni cadre, ni fonte, ni retrait, et se contente du bouton. Plusieurs blocs dans le même `<@@code>` sont joints par un saut de ligne à la copie, blancs de fin retirés.

```html
<@@code>
  <pre><code><span class="kw">const</span> total = a + b</code></pre>
</@@code>
```

La bascule est automatique : `<pre>` projeté ⇒ enveloppe neutre ; rien de préformaté ⇒ le module habille le bloc.

| Attribut | Rôle |
|---|---|
| `label` | libellé du bouton au repos — sert d'`aria-label` et de `title` — défaut « Copier le code » (« Copy code » en anglais) |
| `copied-label` | libellé annoncé aux lecteurs d'écran pendant la confirmation, après une copie réussie — défaut « Copié ! » (« Copied! » en anglais) |

**Parts** : `box` (l'enveloppe), `code` (la zone de texte), `button`. **Variables du cadre** (mode sans `<pre>` seulement) : `--mjs-code-bg`/`-fg`/`-border`/`-radius`/`-pad`/`-font`/`-size`/`-line`. **Variables du bouton** : `--mjs-code-copy-bg`/`-fg`/`-border`/`-ok` (fond, texte, bordure, couleur de la coche) et `--mjs-code-copy-top` — la distance au haut de la zone visible où le bouton s'arrête en défilant, 0 par défaut. Une page qui défile sous un en-tête fixe règle cette variable à la hauteur de l'en-tête ; une boîte qui défile toute seule (`overflow: auto`) la remet à 0 sur elle-même, sinon elle hérite de la valeur de la page.

```css
:root {
  --mjs-code-copy-top: 56px;
}

.panel {
  --mjs-code-copy-top: 0;
}
```

Seuls les projets qui écrivent `<@@code>` l'embarquent au bundle.

## `<@@chart>` — graphiques

```html
<@@chart rows={$pesees} series={[{ key: 'poids', name: 'Poids', unit: 'kg' }]} stats="mean trend"></@@chart>
```

Dix formes dans une seule balise, choisies par `shape` : `line` (courbe, par défaut), `area`, `dots`, `bar`, `stack` (barres empilées), `histogram`, `pie` (anneau), `heatmap` (carte d'intensité), `radar` et `calendar`. Les données s'écrivent en lignes (`rows`, une par abscisse) et en séries (`series`, une par mesure). `stats` trace la moyenne, la médiane, les quartiles et la tendance de chaque série visible ; `step` regroupe par période ; une série écrite `axis: 'right'` prend sa propre échelle, graduée à droite ; `bridge` relie les points par-dessus une case vide ; `pickable` et `@pick` choisissent une ligne. `toolbar="legend shapes stats step"` ajoute une barre d'outils (la légende des séries, le menu des formes, que `shapes` restreint, les statistiques, le pas de temps) : elle écrit `shape`, `stats`, `step` et `hidden`, que la page suit par `!{…}`. Une bulle suit le pointeur et le clavier, un tableau caché double le dessin pour les lecteurs d'écran, et toutes les couleurs se règlent par le thème (`$$chart-1` à `$$chart-6`, et quatorze variables `$$chart-*`, plus l'opacité de la grille). Une application sans graphique ne reçoit pas un octet de plus. Tout est au chapitre [39 · Graphiques](39-graphiques.md).

## Thème clair/sombre — `µtheme`

Une globale réactive, `µtheme`, porte le thème courant du site — `'light'` ou `'dark'`. Elle se lit comme n'importe quelle rune (dans le HTML, un `µeffect`…) et s'écrit directement pour basculer :

```html
<button @click={µtheme = µtheme === 'dark' ? 'light' : 'dark'}>Changer de thème</button>

<p>Thème actuel : {µtheme}</p>
```

Au démarrage, deux sources possibles, la première trouvée gagne : si la page pose déjà `<html data-mjs-theme="…">` (rendu serveur, script inline…), cette valeur fait foi ; sinon la préférence système (`prefers-color-scheme`) initialise `µtheme` **et** l'attribut, et le framework **suit** les changements système jusqu'à la première écriture applicative de `µtheme`, qui fige le choix.

Toute mise à jour de `µtheme` répercute l'attribut `data-mjs-theme` sur `<html>` : c'est le canal CSS. Un `<style>` — global ou dans un composant, la custom property traverse le Shadow DOM — style le thème avec `:root[data-mjs-theme='dark']` ou les variables ci-dessous.

Une valeur autre que `'light'`/`'dark'` déclenche un avertissement console et n'est pas retenue.

### Variables de thème globales

Un jeu de custom properties **sémantiques**, dont la valeur bascule automatiquement avec le thème — ils traversent le Shadow DOM, sont consommés par les modules cœur, et se surchargent sur `:root` pour votre propre palette :

| Variable | Rôle |
|---|---|
| `--mjs-surface` | fond des surfaces (panneaux, champs) |
| `--mjs-fg` | texte principal |
| `--mjs-fg-muted` | texte secondaire, atténué |
| `--mjs-border` | bordures |
| `--mjs-hover` | fond au survol |
| `--mjs-selected` | fond d'un élément sélectionné/coché |
| `--mjs-accent` | couleur d'accent |
| `--mjs-shadow` | ombres portées |

```css
:root {
  --mjs-accent: #0055aa;
}
:root[data-mjs-theme='dark'] {
  --mjs-accent: #8be9fd;
}
```

## `@title` — infobulle universelle

Une info-bulle posable sur **n'importe quelle balise**, native ou composant — pas un module à part, une directive du cœur du langage.

```html
<button @title="Supprime définitivement cette ligne">🗑</button>

<span @title={$counter + ' éléments sélectionnés'}>{$counter}</span>

<button @title={ text: 'Version bêta', delay: 400, side: 'bottom', transition: 'slide' }>⚠</button>

<span @title={{ '<b>' + $counter + '</b> éléments sélectionnés' }}>{$counter}</span>
```

Quatre formes : une chaîne statique `@title="texte"` ; une expression réactive `@title={$expr}`, relue à chaque changement (texte toujours brut, jamais interprété comme HTML) ; un objet **statique** `@title={ text: '…', delay: 400, side: 'top'|'bottom', dur: 150, transition: 'fade'|'slide' }` (`text` obligatoire, `delay`/`dur` en millisecondes, aucune expression dans les clés, sauf `text` qui accepte aussi un appel `µt(…)` : `@title={ text: µt('aide'), side: 'top' }` — le texte suit la langue, et après un changement de langue, le prochain survol montre la nouvelle ; une variable, une concaténation ou un autre appel y sont refusés à la construction) ; une expression **HTML brut** `@title={{ expr }}` — même convention que `{{ }}`/`{ }` en interpolation de texte ([Bindings → HTML brut](07-bindings.md)), le contenu de la bulle est posé en `innerHTML`, réactif comme la forme `{$expr}`. Les deux accolades ouvrantes doivent être **accolées** (`{{`, sans espace) pour déclencher cette forme ; un objet littéral en tête de la forme simple reste écrivable en glissant un espace entre les deux accolades (`@title={ { text: '…' } }`, cas rare) — l'objet y est alors une expression ordinaire, pas la forme statique ci-dessus. Un élément qui porte à la fois `mjs-title` et `mjs-title-html` (deux directives `@title` sur la même balise) voit le **HTML gagner** : c'est la forme la plus riche, choisie explicitement par le développeur. **Sécurité** : porte ouverte volontaire, exactement comme `{{ }}` en interpolation de texte — aucune désinfection, ne l'alimentez jamais avec une saisie non maîtrisée. Un `<script>` posé dans le HTML reste inerte (règle du navigateur pour `innerHTML`), mais un attribut `onerror`/`onload` (`<img src=x onerror=…>`) s'exécute réellement : ce n'est pas un bac à sable.

La bulle apparaît au survol, au focus clavier (accessibilité) et à l'appui long tactile, après le délai configuré, bascule automatiquement en haut ou en bas selon la place disponible, glisse vers l'intérieur près d'un bord gauche ou droit de la fenêtre, et se ferme immédiatement en sortant ou à `Escape`. Elle ne sort jamais de la fenêtre : quand ni le haut ni le bas ne suffisent, elle prend le côté qui a le plus de place et se pose à 8 px du bord, quitte à couvrir son élément ; plus haute que la fenêtre entière, sa hauteur se borne à la fenêtre moins 16 px, et le surplus du texte est rogné. Sous un `zoom` CSS, posé sur `html` ou sur un conteneur, elle reste contre son élément. Au tactile, l'appui doit durer 500 ms (un glissement de plus de 10 px avant l'échéance annule l'apparition), la bulle survit 1,5 s après le relâcher, et le menu contextuel du navigateur reste neutralisé tant qu'elle est affichée pour cette cible. Un `aria-describedby` relie la bulle à l'élément pendant qu'elle est affichée, retiré à la fermeture. La bulle MJS **se substitue** au `title` natif de l'élément qu'elle décore, jamais les deux affichées ensemble : le `title` natif est mis de côté tant que `mjs-title`/`mjs-title-html` reste posé, et restitué à l'identique (chaîne vide comprise) dès que la bulle disparaît. Si ce retrait laissait l'élément sans aucun nom accessible (pas de texte visible, pas de `aria-label`/`aria-labelledby` déjà posé), un `aria-label` reprenant la valeur native prend le relais le temps de la substitution — jamais si l'auteur en a déjà un.

Détail utile pour le style : la bulle naît **dans l'arbre du composant survolé** (via l'API Popover du navigateur — la couche visuelle la plus haute, au-dessus de tout le reste de la page) — elle est donc stylable directement depuis le `<style>` de ce composant, comme n'importe quel élément qu'il rend. Posée sur une balise hors composant (light DOM), elle rejoint une bulle globale.

Thème par défaut : variables `--mjs-title-bg`/`-fg`/`-radius`/`-pad`/`-shadow`/`-offset`/`-dur`, et une config globale pour les délais/orientation par défaut :

```js
µconfig.title = { delay: 400, side: 'top', dur: 150, transition: 'fade' }
```

## Personnaliser — trois leviers, une règle de fair-play

Tout ce qui précède — modules cœur, `@title`, et [la modale maison](06-evenements.md) (`µ.modal.fire`) — se retouche de la même façon, à trois niveaux :

**1. Les variables `--mjs-*`** — le thème, y compris les variables globales clair/sombre décrites plus haut (§ *Thème clair/sombre*). Elles traversent le Shadow DOM (une variable posée sur `:root`, ou sur le composant lui-même, est lue par le module encapsulé) : c'est le levier le plus simple, celui à essayer en premier.

> 🔗 Ces variables sont exactement les **variables de thème** du chapitre [31 · Thèmes](31-themes.md) : `--mjs-select-radius` s'écrit `$$select-radius` dans un bloc `<theme>`, et un thème posé sur une section ne repeint que cette section — modules cœur compris.

```css
:root {
  --mjs-select-radius: 12px;
  --mjs-check-accent: #e5484d;
}
```

**2. `::part()`** — la retouche ciblée. Chaque zone marquante d'un module porte un attribut `part="…"` (listé plus haut, par module) ; `::part(nom)` la cible depuis n'importe quelle feuille de style, y compris depuis le `<style>` d'un **de vos propres composants** — dans ce cas, la règle ne s'applique qu'aux modules cœur présents dans **ce** composant précis, jamais au reste du site.

```html
<!-- dans le <style> de mon-formulaire.mjs -->
<style>
  mjs-core-field::part(label)
    text-transform: uppercase
    font-size: .8rem
</style>
```

**3. L'éjection** — le contrôle total. Le fichier source d'un module cœur (`select.mjs`, `field.mjs`…) est un `.mjs` ordinaire : copiez-le tel quel dans les sources de votre projet. Il devient aussitôt un composant du projet, qui s'écrit avec **un seul** `@` — `<@select>` pour une copie nommée `select.mjs`, `<@my-select>` pour `my-select.mjs` — pendant que `<@@select>` reste le module d'origine : vous remplacez `<@@select>` par votre version là où vous la voulez. Vous en modifiez le markup, le style ou la logique librement ; elle ne suit plus, en échange, les mises à jour du module d'origine. Le fichier d'un module cœur porte des repères `@@` (des commentaires, sans effet dans votre projet) autour de ce qui ne sert qu'à un attribut : laissez-les ou retirez-les.

**Deux régimes de style, selon où vit l'élément.** Un module cœur vit dans son **Shadow DOM** : son apparence lui appartient, et le CSS ambiant de la page ne la défait pas par accident — une règle `button { … }` écrite quelque part dans votre application ne repeint pas le bouton d'un `<@@select>`. Pour le personnaliser, vous passez par les trois leviers ci-dessus, qui visent le module explicitement.

Exception assumée — le contenu **projeté par slot** (`<@@field>`, qui enveloppe votre propre `<input>`/`<select>`/`<textarea>`) : cet élément vous appartient, il vit dans VOTRE feuille de style, pas dans celle du module — une règle `input { border: … }` de votre page peut donc, sans le vouloir, repeindre par-dessus la bordure d'état que `<@@field>` pose via `::slotted()` (le Shadow DOM ne protège que ce qu'un module écrit lui-même dans son propre HTML, pas ce que VOUS lui confiez). Pour que la bordure d'état (`mjs-field="error"`/`"ok"`) reste visible quoi que votre page déclare, `<@@field>` protège cette seule déclaration avec `!important` — les variables `--mjs-field-error-color`/`--mjs-field-ok-color` restent le levier de personnalisation normal, `!important` ne change que qui gagne la bordure, jamais la couleur qu'elle prend.

Les éléments **flottants** — modale, toasts, bulle `@title` — vivent au contraire dans la page elle-même, hors de tout Shadow DOM : leurs styles par défaut sont enveloppés dans `:where(…)`, un enrobage qui ramène leur poids dans la cascade à **zéro**. N'importe quelle règle à vous, même une classe seule, l'emporte alors sans `!important` ni sélecteur alambiqué. Les **variables de thème** (§ *Thème clair/sombre*) suivent la même règle : posées en `:where(:root)`, elles cèdent devant la moindre redéfinition venue de votre feuille de styles.

Dans les deux cas, les couleurs, tailles et formes par défaut ne sont là que tant que vous n'avez rien dit de plus précis.

---

📚 **Voir aussi** : [15 · Éléments spéciaux](15-elements-speciaux.md) pour les raccourcis `<@nom>` et `<@@nom>` en général ; [6 · Événements](06-evenements.md) pour la modale maison (`µ.modal.fire`, ses raccourcis, ses toasts) ; [21 · Navigation](21-navigation.md) pour `µres.errors`, que `<@@field>` consomme.
