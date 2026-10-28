# 39 · Graphiques (`<@@chart>`)

> 📚 Tuto interactif correspondant : **Chapitre « Graphiques »** (sept leçons : courbe, statistiques, formes, carte et calendrier, radar, couleurs, barre d'outils), à partir de [la première leçon](https://mjs.rapturestudio.fr/tuto#/graphiques-courbe). La page du site montre chaque forme en vrai : [Graphiques](https://mjs.rapturestudio.fr/doc#/modules-coeur-graphique).

`<@@chart>` est le module cœur des graphiques. Une seule balise, dix formes : courbe, aire, points, barres, barres empilées, histogramme, anneau, carte d'intensité, radar et calendrier. Vous lui donnez des lignes (une par relevé) et des séries (une par mesure). Il dessine, calcule les statistiques, ouvre une bulle au pointeur et au clavier, et double le dessin d'un tableau pour les lecteurs d'écran. Le rendu serveur l'écrit dans la page servie. Une application qui n'écrit pas `<@@chart>` ne reçoit pas un octet de plus.

```html
<script>
  $pesees = [
    { id: 1, x: '2026-10-01', poids: 72.4 }
    { id: 2, x: '2026-10-03', poids: 72.9 }
    { id: 3, x: '2026-10-05', poids: 72.1 }
    { id: 4, x: '2026-10-07', poids: 73 }
  ]
  $series = [{ key: 'poids', name: 'Poids', unit: 'kg' }]
</script>

<@@chart rows={$pesees} series={$series} stats="mean trend"></@@chart>
```

## Les données : des lignes et des séries

Deux props portent les données : `rows` et `series`.

**`rows`, les lignes.** Une ligne par abscisse : un relevé, un jour, un libellé. Chaque ligne a son abscisse `x`, un `id` facultatif (celui que renvoie `@pick`) et ses mesures, rangées par clé de série. Les mesures s'écrivent dans `readings`, comme les envoie souvent un serveur, ou à plat, à côté de `x` et `id`. Les deux formes se lisent, même mêlées dans une liste :

```html
<script>
  $rows = [
    { id: 'r1', x: '2026-10-01', readings: { poids: 72.4, tour: 81 } }
    { id: 'r2', x: '2026-10-03', poids: 72.9, tour: 81.5 }
  ]
</script>
```

**`series`, les séries.** Une série par mesure à montrer :

| Clé | Rôle | Défaut |
|---|---|---|
| `key` | la clé de la mesure dans chaque ligne ; une série sans `key` est ignorée | — |
| `name` | le nom montré dans la bulle, la légende et le tableau | la clé |
| `unit` | l'unité, écrite après chaque valeur (« 72 kg ») | aucune |
| `color` | une teinte du thème (`1` à `6`, ou `blue`, `orange`, `green`, `pink`, `violet`, `gold`) ou une couleur CSS ; voir [Les couleurs](#les-couleurs) | les teintes dans l'ordre |
| `kind` | `'text'` pour une série de mots | une série de nombres |
| `axis` | `'right'` : la série prend sa propre échelle, graduée à droite ; voir [Deux échelles](#deux-échelles--axis-right) | `'left'` |

**Une mesure** est un nombre fini, ou un texte qui se lit tout entier en nombre, comme le `Float` de Ruby le lit côté serveur : des blancs autour, un signe, des décimales (`'12'`, `'.5'`, `'5.'`, `'1e3'`), un hexadécimal (`'0x1A'`, `'0x1.8p1'`), un souligné seul entre deux chiffres (`'1_000'`). Ne se lisent pas : la virgule décimale (`'1,5'`), le binaire (`'0b101'`), l'octal (`'0o17'`), `'Infinity'`, deux soulignés de suite. Toute autre valeur laisse la case vide : un mot, un texte vide, `null`, une clé absente. Une case vide coupe la courbe et retire la barre ; la bulle l'écrit « — ». Avec `bridge`, la courbe et l'aire passent par-dessus ([Relier par-dessus une case vide](#relier-par-dessus-une-case-vide--bridge)).

**Une série de mots** (`kind: 'text'`) porte une note par ligne (« bien », « fatigué »). Le dessin l'ignore, elle ne compte dans aucun calcul ; la bulle et le tableau montrent ses mots. Quand les lignes sont regroupées par période (`step`), elle quitte la bulle et le tableau : un mot ne se moyenne pas.

**L'axe x se devine** sur les valeurs de `x` : des jours `AAAA-MM-JJ` donnent un axe `date` ; des instants (`2026-10-05T08:30`, `2026-10-05 08:30:00 UTC`, `Mon, 05 Oct 2026 08:30:00 GMT` : voir [les écritures lues](#les-heures)) un axe `datetime` ; des nombres (`3`, `'2,5'`) un axe `number` ; tout le reste, un axe `category` (des libellés). `axis` impose la sorte d'axe ([plus bas](#laxe-x--axis-et-axis-unit)). Sur un axe de temps ou de nombres, les points se placent à leur vraie distance ; des libellés se placent à intervalles égaux. Un jour s'écrit pareil partout ; un instant suit la règle des [heures](#les-heures).

**L'ordre des lignes compte.** Le graphique prend les lignes dans l'ordre où vous les donnez, sans les trier : rangez-les dans l'ordre de l'axe x. Seul le regroupement par période range ses périodes dans l'ordre du temps.

## Les dix formes

`shape` choisit la forme. Sans `shape`, c'est une courbe.

| `shape` | Forme | Quand la prendre |
|---|---|---|
| `line` | courbe (défaut) | suivre une mesure dans le temps |
| `area` | aire | une évolution dont la quantité compte |
| `dots` | points | des relevés épars, que relier tromperait |
| `bar` | barres | comparer des valeurs par libellé ou par période |
| `stack` | barres empilées | des parts qui s'ajoutent en un total, colonne après colonne |
| `histogram` | histogramme | la répartition des valeurs d'une série |
| `pie` | anneau | le partage d'un tout |
| `heatmap` | carte d'intensité | des habitudes par jour et par heure, ou plusieurs séries côte à côte |
| `radar` | radar | un profil sur plusieurs axes |
| `calendar` | calendrier | une mesure par jour, sur des mois |

Les six premières formes sont des **graphiques à axes** : ils partagent le cadre, les graduations, le curseur, la bulle et le tableau des valeurs. Les quatre autres ont chacune leur dessin.

### `line` — courbe

```html
<@@chart rows={$pesees} series={$series}></@@chart>
```

Un trait par série visible, un point par ligne. Au-delà de 40 lignes affichées, la courbe garde son trait et perd ses points. L'axe y s'ajuste aux valeurs, sur des graduations rondes (quatre intervalles environ) : les multiples du pas, écrits justes (0,3 et non 0,30000000000000004), distincts à toute grandeur. Une graduation s'écrit court, avec tous ses chiffres : deux graduations voisines ne s'écrivent jamais pareil. Elle s'abrège dès 10 000 (« 12 k », « 1,25 M ») et passe en notation scientifique sous 0,0001 et dès 10^15 (« 3E-5 ») ; avec `decimals`, elle s'écrit en entier ([Les décimales](#les-décimales--decimals)). Les étiquettes de l'axe x restent entières et ne se chevauchent pas : elles se choisissent à la largeur réelle du tracé, relue à chaque changement de taille ; la première et la dernière restent.

**Des unités différentes** (`kg` et `cm`) ne partagent pas une échelle : chaque série prend la sienne. Les graduations disparaissent et une note le dit : « Une échelle par série : leurs unités diffèrent ». Ce choix vaut pour les courbes, les aires, les points et les barres. Pour garder des graduations, rangez une série à droite : elle prend sa propre échelle, graduée de son côté ([Deux échelles](#deux-échelles--axis-right)).

### `area` — aire

```html
<@@chart rows={$pesees} series={$series} shape="area"></@@chart>
```

La courbe, et la surface entre le trait et le zéro, teintée. L'axe y comprend toujours 0.

### `dots` — points

```html
<@@chart rows={$releves} series={$series} shape="dots"></@@chart>
```

Les points seuls, sans trait, plus gros que ceux d'une courbe. Ils restent quel que soit le nombre de lignes.

### `bar` — barres

```html
<@@chart rows={$ventes} series={$series} shape="bar"></@@chart>
```

Une case par ligne ; dans chaque case, une barre par série visible, côte à côte. L'axe y comprend toujours 0 ; une valeur négative descend sous le zéro. Les barres de la colonne survolée s'entourent d'un trait.

### `stack` — barres empilées

```html
<script>
  $semaine = [
    { x: '2026-10-05', lecture: 1, sport: 0.5, ecrans: 2 }
    { x: '2026-10-06', lecture: 0.5, sport: 1, ecrans: 3 }
    { x: '2026-10-07', lecture: 2, sport: 0, ecrans: 1.5 }
  ]
  $activites = [{ key: 'lecture', name: 'Lecture', unit: 'h' }, { key: 'sport', name: 'Sport', unit: 'h' }, { key: 'ecrans', name: 'Écrans', unit: 'h' }]
</script>

<@@chart rows={$semaine} series={$activites} shape="stack"></@@chart>
```

Une case par ligne ; les séries visibles se posent l'une sur l'autre, dans leur ordre. L'échelle part de 0 et couvre le plus haut total. Une valeur négative n'empile rien, mais la bulle la donne. La bulle liste chaque série puis le total ; le tableau a une colonne « Total ». Le total porte l'unité commune des séries ; sans unité commune, aucune. Les barres empilées ne tracent pas de statistiques : `stats` y est une faute ([Les statistiques](#les-statistiques--stats)). Des séries d'unités différentes partagent ici une seule échelle : un avertissement de développement le signale.

### `histogram` — histogramme

```html
<@@chart rows={$pesees} series={$series} shape="histogram" stats="mean median"></@@chart>
```

La répartition des valeurs de la **première série de nombres visible** : pour en montrer une autre, cachez les précédentes (`hidden`). Les valeurs se rangent en classes aux bornes rondes, écrites justes, de 3 à 12 classes selon leur nombre (règle de Sturges). Une barre par classe non vide ; l'axe y compte les valeurs, en nombres entiers ; les étiquettes du dessous sont les bornes des classes. Si toutes les valeurs sont égales, ou ne diffèrent que par la poussière des flottants (0,3 et 0,1 + 0,2), une seule classe, au milieu. La bulle dit la classe (« De 72 à 72,5 kg ») et le nombre de valeurs qu'elle compte. Deux bornes voisines ne s'écrivent jamais pareil, même pour des classes d'un millième autour de 1 (« De 1,001 à 1,002 »).

Les statistiques y deviennent des traits verticaux, à leur place sur l'étendue des classes, dans la teinte neutre ; `trend` n'y va pas, c'est une faute. L'histogramme lit toutes les lignes : `step` ne les regroupe pas.

### `pie` — anneau

```html
<script>
  $depenses = [
    { x: 'Loyer', montant: 820 }
    { x: 'Courses', montant: 410 }
    { x: 'Transport', montant: 95 }
    { x: 'Loisirs', montant: 160 }
  ]
</script>

<@@chart rows={$depenses} series={[{ key: 'montant', name: 'Montant', unit: '€' }]} shape="pie"></@@chart>
```

L'anneau compte les séries de nombres visibles qui ont une valeur ; une série visible sans aucune valeur ne compte pas :

- **deux séries ou plus, de même unité** : une part par série, quel que soit l'axe. La part d'une série est le total de ses valeurs sur toutes les lignes ;
- **une seule série, sur un axe de libellés** (`category`) : une part par libellé, la somme des valeurs de la série pour ce libellé ;
- **sinon** (une seule série sur un axe de dates ou de nombres, des unités différentes) : l'anneau reste vide, et une note le dit : « L'anneau ne convient pas à ces données : il compare plusieurs séries de même unité, ou des libellés ».

Le menu des formes de la barre d'outils grise l'anneau selon la même règle.

Seules les valeurs positives comptent. Une série sans total positif n'a pas de part, ni, par libellé, un libellé dont le total n'est pas positif ; un avertissement de développement le dit. Les parts se rangent de la plus grande à la plus petite. Sept parts au plus : les suivantes se réunissent en une part « Autres », dans la teinte neutre, éclaircie. Par libellé, la septième part reprend la première teinte, plus pâle. Au centre, le total ; la part survolée ou au focus y prend sa place, avec sa valeur, sa part du total et son nom. La légende, à côté (dessous quand la place manque), liste chaque part avec sa valeur et son pourcentage. L'anneau ne trace pas de statistiques (`stats` y est une faute), lit toutes les lignes (`step` ne les regroupe pas) et ne choisit pas de ligne.

### `heatmap` — carte d'intensité

```html
<script>
  $visites = [
    { x: '2026-10-05T08:30', duree: 12 }
    { x: '2026-10-05T12:10', duree: 25 }
    { x: '2026-10-06T08:45', duree: 9 }
  ]
</script>

<@@chart rows={$visites} series={[{ key: 'duree', name: 'Durée', unit: 'min' }]} shape="heatmap"></@@chart>
```

La carte dépend de l'axe x :

- **jour × heure**, sur un axe d'instants (`datetime`) : 7 lignes, du lundi au dimanche, et 24 colonnes, de 0 h à 23 h, à l'heure affichée (voir [Les heures](#les-heures)). Chaque case porte la moyenne de la première série de nombres visible pour ce jour et cette heure. Sans série de nombres visible (`series={[]}`), elle porte le nombre de relevés. Les étiquettes du dessous donnent les heures de trois en trois ;
- **par série**, sur un autre axe : une ligne par série de nombres visible, une colonne par ligne de données. Les étiquettes du dessous sont les abscisses. Des séries d'unités différentes partagent la même échelle : un avertissement de développement le signale.

Les cases prennent cinq niveaux d'intensité, sur une échelle commune aux bornes rondes (`bounds` les impose). Une case sans valeur garde la couleur de `$$chart-empty`, même quand la série porte sa propre couleur : elle ne se confond pas avec une case faible. Les niveaux 1 à 5 prennent la couleur de la série, de plus en plus couvrante. Une légende suit le dessin : « Aucune valeur », puis « Moins », les cinq niveaux, « Plus ». Elle prend la teinte de la série, ou la teinte neutre quand plusieurs séries se partagent la grille. La bulle d'une case dit le jour et l'heure (ou l'abscisse), la valeur et le nombre de relevés.

### `radar` — radar

```html
<script>
  $profil = [
    { x: 'Force', moi: 80, objectif: 90 }
    { x: 'Souplesse', moi: 50, objectif: 70 }
    { x: 'Endurance', moi: 70, objectif: 80 }
    { x: 'Vitesse', moi: 40, objectif: 60 }
  ]
  $joueurs = [{ key: 'moi', name: 'Moi' }, { key: 'objectif', name: 'Objectif' }]
</script>

<@@chart rows={$profil} series={$joueurs} shape="radar" bounds={[0, 100]}></@@chart>
```

Une branche par ligne, nommée par son abscisse : la première en haut, puis dans le sens des aiguilles d'une montre. Un polygone par série de nombres visible. L'échelle est commune : de 0 à la plus grande valeur, ou celle de `bounds` (`[0, 100]` pour des pourcentages). Une valeur absente revient au centre. Un nom de branche de plus de 18 signes s'abrège d'un « … ». La bulle d'une branche donne son nom et la valeur de chaque série.

Le radar accepte de 3 à 24 branches, une par ligne ; au-delà de 24 lignes, il garde les 24 dernières et le dit en développement. Avec 1 ou 2 lignes, une courbe le remplace. Jusqu'à 8 branches, chacune porte son nom ; au-delà, seuls s'écrivent les noms des branches du haut, de droite, du bas et de gauche (les plus proches quand le nombre de branches ne se divise pas par 4). Tous les noms restent dans la bulle et le tableau. Les noms gardent la taille des autres textes à toute largeur : la toile se resserre pour leur laisser la place. Les statistiques n'y vont pas.

```html
<script>
  $gouts = [
    { x: 'Cuisine', vous: 80, partenaire: 65 }
    { x: 'Voyages', vous: 70, partenaire: 90 }
    { x: 'Musique', vous: 85, partenaire: 75 }
    …
  ]
  $toiles = [{ key: 'vous', name: 'Vous' }, { key: 'partenaire', name: 'Partenaire', color: 'pink' }]
</script>

<@@chart rows={$gouts} series={$toiles} shape="radar" bounds={[0, 100]}></@@chart>
```

Seize lignes, dans cet ordre : Cuisine, Voyages, Musique, Cinéma, Lecture, Sport, Nature, Jeux, Danse, Photo, Jardin, Théâtre, Peinture, Musées, Concerts, Bricolage. Deux toiles : la vôtre et celle d'un partenaire. Seuls quatre noms s'écrivent autour de la toile : « Cuisine » en haut, « Lecture » à droite, « Danse » en bas et « Peinture » à gauche. Les douze autres se lisent dans la bulle et le tableau.

### `calendar` — calendrier

```html
<@@chart rows={$humeurs} series={[{ key: 'humeur', name: 'Humeur' }]} shape="calendar" bounds={[1, 5]}></@@chart>
```

Une case par jour, à la façon des « contributions » : une colonne par semaine, une ligne par jour du lundi au dimanche, les mois en tête, lundi, mercredi et vendredi à gauche. Le calendrier montre les 26 dernières semaines, jusqu'à celle du dernier relevé ; les jours qui suivent ce relevé ne se dessinent pas. `step="week"` donne une case par semaine (les 26 dernières), `step="month"` une case par mois (les 12 derniers). Un relevé plus ancien que cette fenêtre ne s'y voit pas, et le tableau caché suit la même fenêtre.

Chaque case porte la moyenne de la première série de nombres visible, ou le nombre de relevés quand aucune série de nombres n'est visible. Les cases prennent cinq niveaux, avec la même légende que la carte ; une case sans relevé reste au niveau 0. Une humeur notée de 1 à 5, avec `bounds={[1, 5]}`, tombe sur le niveau de son arrondi. La bulle d'une case dit le jour en toutes lettres (« lundi 5 octobre 2026 »), la semaine (« Semaine du 5 oct. 2026 ») ou le mois, puis la valeur et le nombre de relevés.

L'axe x doit être fait de dates (`date` ou `datetime`) ; un instant compte dans son jour, à l'heure affichée (voir [Les heures](#les-heures)). `step="year"` ne va pas avec le calendrier. Sur un écran étroit, le dessin se resserre. Les statistiques n'y vont pas.

## Les statistiques — `stats`

```html
<@@chart rows={$pesees} series={$series} stats="mean median q1 q3 trend"></@@chart>
```

`stats` liste les statistiques à tracer, séparées par des espaces ou des virgules (ou un tableau, `stats={['mean', 'trend']}`) :

| Mot | Statistique | Trait |
|---|---|---|
| `mean` | la moyenne | plein |
| `median` | la médiane | tirets |
| `q1` | le premier quartile | pointillés |
| `q3` | le troisième quartile | trait et point |
| `trend` | la tendance, et le point suivant estimé | tirets plus épais, un cercle au bout |

Chaque statistique se trace **sur chaque série visible**, dans la couleur de la série : la moyenne, la médiane et les quartiles en traits horizontaux, d'un bord à l'autre. La tendance est la droite des moindres carrés sur les valeurs de la série, prises dans leur ordre ; elle se prolonge d'une place après la dernière ligne, où un cercle marque le point suivant estimé. Une légende, sous le dessin, nomme chaque trait : « Tendance (le cercle : le point suivant estimé) ».

**Elles se calculent sur ce qui est affiché** : après le regroupement par période (`step`), sans les séries cachées (`hidden`). Une semaine regroupée compte pour une valeur, sa moyenne.

**Les quartiles se calculent par les moitiés exclusives**, sans interpolation. Le premier quartile est la médiane de la moitié basse des valeurs triées, le troisième celle de la moitié haute. Pour un nombre impair de valeurs, la médiane n'appartient à aucune des deux moitiés. Sur 1, 2, 3, 4, 5 : médiane 3, premier quartile 1,5 (la médiane de 1 et 2), troisième quartile 4,5 (celle de 4 et 5). Sous deux valeurs, pas de quartile ; la tendance demande aussi deux valeurs.

**Selon la forme.** `stats` se trace sur `line`, `area`, `dots`, `bar` et `histogram`, `trend` sur `line`, `area`, `dots` et `bar` :

- courbe, aire, points et barres : les traits décrits ci-dessus ;
- histogramme : des traits verticaux, à leur place sur l'étendue des classes, dans la teinte neutre ; sans tendance ;
- barres empilées, anneau, carte, radar et calendrier : aucune statistique.

Une statistique demandée à une forme qui ne la trace pas est une faute. Écrite dans le code, elle arrête la construction ; venue d'une variable, elle écrit une erreur une fois, et le graphique trace ce qu'il peut (voir [Les fautes](#les-fautes)). La barre d'outils grise ces cas et n'écrit rien en console.

## Regrouper par période — `step`

```html
<@@chart rows={$pesees} series={$series} step="week"></@@chart>
```

| `step` | Une colonne par |
|---|---|
| `auto` (défaut) | ligne : pas de regroupement |
| `day` | jour |
| `week` | semaine, du lundi au dimanche |
| `month` | mois |
| `year` | année |

Sur un axe de temps (`date` ou `datetime`), `step` regroupe les lignes : une colonne par période, la moyenne des valeurs de chaque série de nombres, l'abscisse au premier jour de la période. La moyenne se calcule sans la poussière des flottants, à quinze chiffres significatifs : celle de 0,1 et 0,2 vaut 0,15, et une petite valeur garde ses chiffres. La bulle dit la période (« Semaine du 31 août 2026 », « octobre 2026 ») et le nombre de lignes réunies (« Moyenne de 3 valeurs »). La première colonne du tableau devient « Période ». Une période d'une seule ligne garde son `id` pour `@pick` ; une période de plusieurs lignes n'en a pas, son clic ne choisit rien.

Une ligne dont la date n'existe pas (le 30 février, le 31 novembre) ou dont l'abscisse ne se lit pas ne se range dans aucune période : elle quitte le graphique, et une erreur le dit, une fois par abscisse ([Les fautes](#les-fautes)). Le calendrier fait de même. Sans regroupement, elle reste une colonne, écrite telle quelle ([Les heures](#les-heures)).

`step` regroupe les formes qui suivent les lignes : courbe, aire, points, barres et barres empilées. Sur un axe qui n'est pas le temps, il est sans effet. L'histogramme, l'anneau, la carte et le radar lisent les lignes telles quelles. Le calendrier se sert de `step` pour choisir ses cases : `day` (et `auto`), `week` ou `month`.

## Cacher des séries — `hidden`

```html
<@@chart rows={$rows} series={$series} hidden={['tour']}></@@chart>
```

Une liste de clés de séries, en tableau ou en texte (`'tour taille'`). Une série cachée quitte le dessin, les statistiques, la bulle et le tableau ; elle ne compte plus pour l'échelle. L'histogramme, l'anneau par libellé, la carte jour × heure et le calendrier lisent la première série de nombres visible : cacher les précédentes en montre une autre.

## L'échelle — `bounds`

```html
<@@chart rows={$notes} series={$series} bounds={[0, 20]}></@@chart>
```

`[min, max]` : des bornes que l'échelle garde, même quand les valeurs restent loin d'elles. Une valeur qui les dépasse élargit l'échelle. `null` d'un côté laisse ce côté libre : `bounds={[0, null]}` fixe le bas seulement. Une valeur qui n'est pas un tableau est ignorée. Sur une carte et un calendrier, `bounds` règle l'échelle des cinq niveaux ; sur un radar, l'échelle comprend toujours 0.

Sans `bounds`, les barres, les barres empilées, les aires et le radar partent de 0 ; la courbe et les points s'ajustent aux valeurs.

## Deux échelles — `axis: 'right'`

```html
<script>
  $meteo = [
    { x: '2026-10-01', temperature: 14.2, pluie: 3 }
    { x: '2026-10-02', temperature: 16.8, pluie: 0 }
    { x: '2026-10-03', temperature: 12.5, pluie: 11 }
  ]
  $series = [{ key: 'temperature', name: 'Température', unit: '°C' }, { key: 'pluie', name: 'Pluie', unit: 'mm', axis: 'right' }]
</script>

<@@chart rows={$meteo} series={$series} shape="bar"></@@chart>
```

Une série écrite `axis: 'right'` prend sa propre échelle, graduée à droite du tracé ; les autres (`axis: 'left'`, le défaut) gardent celle de gauche. Chaque côté s'ajuste à ses séries comme un graphique à lui seul : des grandeurs éloignées (des degrés et des millimètres, un poids et une note de 1 à 5) se lisent toutes les deux. L'unité d'un côté s'écrit au bout de sa plus haute graduation (« 20 °C », « 12 mm ») quand ses séries la partagent. L'axe de droite se dessine, ses graduations ont leur gouttière, à la mesure de la plus longue. La grille suit les graduations de gauche, celles de droite quand aucune série de gauche n'a de valeur. Tant qu'aucune série de droite n'a de valeur, le graphique garde une seule échelle.

- **Les formes** : la courbe, l'aire, les points et les barres. Sur des barres, les séries des deux côtés restent côte à côte dans chaque case, chacune depuis le zéro de son échelle.
- **`bounds`** règle l'échelle de gauche ; celle de droite s'ajuste à ses séries (elle comprend 0 pour les barres et les aires).
- **Des unités différentes d'un même côté** : ce côté prend une échelle par série, sans graduations, et la note « Une échelle par série » le dit, comme sur un graphique à une seule échelle.
- **Les statistiques et la tendance** d'une série se tracent sur son échelle.
- **La bulle** donne chaque série avec son unité, quel que soit son axe ; ses points allumés se posent sur l'échelle de leur série. **Le tableau caché** des lecteurs d'écran ne change pas : chaque valeur y est écrite avec son unité. **La légende** de la barre d'outils garde une pastille par série ; cacher toutes les séries de droite rend une seule échelle.
- **Les autres formes** (barres empilées, histogramme, anneau, carte, radar, calendrier) n'ont qu'une échelle, ou aucune : `axis: 'right'` y est ignoré, et un avertissement de développement le dit ([Les fautes](#les-fautes)), sauf quand la forme vient d'un choix de la barre d'outils ; quand la forme et la série sont écrites sur la balise, la construction le dit aussi. Une série de mots n'a pas d'axe.
- **Un autre mot** que `left` ou `right` est une faute : la série reste à gauche, et une erreur le dit.

## Relier par-dessus une case vide — `bridge`

```html
<@@chart rows={$pesees} series={$series} bridge></@@chart>
```

Sans `bridge`, une case vide (une mesure qui manque) coupe la courbe : le trait s'arrête au point d'avant et reprend au point d'après. Avec `bridge`, la courbe et l'aire passent d'un point au suivant par-dessus les cases vides : le trait et la surface restent d'un seul tenant. Aucun point ne se dessine sur une case vide, la bulle et le tableau l'écrivent toujours « — », et rien ne se prolonge avant le premier point ni après le dernier. Les points, les barres et les autres formes ne relient rien : `bridge` ne les change pas.

## L'axe x — `axis` et `axis-unit`

`axis` impose la sorte d'axe : `date`, `datetime`, `number` ou `category`. Sans `axis`, le module la devine (voir [Les données](#les-données--des-lignes-et-des-séries)). Des années ou des codes postaux se lisent comme des nombres ; `axis="category"` en fait des libellés, à intervalles égaux, et un anneau les lit alors par libellé.

Les abscisses s'écrivent dans la langue de la page : un jour « 1 sept. » sur l'axe et « 1 sept. 2026 » dans la bulle ; un instant avec son heure ; un nombre comme toute valeur du graphique (ci-dessous) ; un libellé tel quel.

`axis-unit` suit l'abscisse dans le titre de la bulle des graphiques à axes : avec `axis-unit="km"`, l'abscisse `12` s'écrit « 12 km ». Il n'est pas écrit pour une semaine regroupée.

**L'écriture des nombres.** Sans `decimals` (ci-dessous), une valeur s'écrit dans la langue de la page, avec deux décimales (« 72,46 »), dans la bulle, le tableau, la légende et le centre de l'anneau. Sous 0,1, elle garde trois chiffres significatifs, là où deux décimales n'en garderaient qu'un ou aucun (« 0,099 », « 0,0123 », « 0,004 »). Sous 0,0001, elle passe en notation scientifique, comme l'axe (« 3,2E-5 »). Un zéro négatif (« -0.0 », ce que Rails envoie pour `(-0.04).round(1)`) s'écrit « 0 », dans la bulle, le tableau et les graduations, comme avec `decimals`.

### Les décimales — `decimals`

```html
<script>
  $taux = [
    { x: '2026-09-01', taux: 1.5 }
    { x: '2026-09-02', taux: 2 }
    { x: '2026-09-03', taux: 1.125 }
    { x: '2026-09-04', taux: 2.75 }
    { x: '2026-09-05', taux: 3 }
  ]
</script>

<@@chart rows={$taux} series={[{ key: 'taux', name: 'Taux', unit: '%' }]} decimals="2"></@@chart>
```

`decimals="2"` (un entier de 0 à 10) écrit chaque mesure avec exactement ce nombre de chiffres après la virgule : 2 s'écrit « 2,00 % », 1,125 s'écrit « 1,13 % ». Le réglage vaut pour la bulle, le tableau, la légende, le centre de l'anneau, les graduations et les bornes d'un histogramme. Les graduations s'espacent d'au moins 10^-N (avec `decimals="0"`, jamais de graduation à 0,5) et s'écrivent en entier, sans abréviation ni notation scientifique ; la gouttière, à gauche du tracé, s'élargit à la mesure de la plus longue (« 1 000 000,00 ») : elles restent dans le cadre du graphique, même dans un conteneur qui coupe (`overflow: hidden`). Une petite valeur négative qui s'arrondit à zéro s'écrit sans signe : « 0,00 », jamais « -0,00 » (sans `decimals`, un zéro négatif s'écrit « 0 », jamais « -0 »). Les effectifs, les parts en pour cent et les abscisses d'un axe de nombres gardent leur écriture ; le calcul des statistiques ne change pas. Écrite en nombre, la valeur compte : `decimals={2.0}` vaut 2. Une valeur hors de 0 à 10 est une faute (voir [Les fautes](#les-fautes)).

### Les heures

```html
<@@chart rows={$visites} series={$series} timezone="Europe/Paris"></@@chart>
```

Sans `timezone`, une heure s'affiche telle qu'elle est écrite : son fuseau (`Z`, `+02:00`, `UTC`) est ignoré, sans conversion, et la page servie ne saute pas à la reprise. `timezone="local"` affiche l'heure de l'écran du visiteur ; la page servie peut alors changer à la reprise. `timezone="Europe/Paris"`, ou toute zone IANA (`UTC` compris), affiche l'heure de cette zone, au serveur comme au navigateur. Avec une zone IANA, une heure écrite sans fuseau est prise comme déjà dans cette zone.

| `x` | sans `timezone` | `timezone="Europe/Paris"` | `timezone="local"` |
|---|---|---|---|
| `2026-10-24T20:30:00Z` | 20:30 | 22:30 | l'heure du visiteur : 22:30 à Paris, 16:30 à New York |
| `2026-10-24T22:30` | 22:30 | 22:30 | 22:30 |
| `2026-10-24 20:30:00 UTC` | 20:30 | 22:30 | l'heure du visiteur |
| `Sat, 24 Oct 2026 20:30:00 GMT` | 20:30 | 22:30 | l'heure du visiteur |

**Les écritures lues.** Une heure se lit de la même façon dans tous les navigateurs et au serveur, sans `Date.parse` (sa lecture change d'un navigateur à l'autre), quand elle est écrite :

- en ISO 8601, avec ou sans fuseau, un `T` ou un blanc entre le jour et l'heure : `2026-10-19T08:15:00Z`, `2026-10-19T10:15:00.250+02:00`, `2026-10-19 08:15` ;
- comme `Time#to_s` de Ruby et de Rails : `2026-10-19 08:15:00 UTC`, `2026-10-19 10:15:00 +0200` ;
- en RFC 2822 (courriel, en-têtes HTTP) : `Mon, 19 Oct 2026 08:15:00 GMT`, `19 Oct 2026 10:15 +0200`.

Le fuseau s'écrit `Z`, `UTC`, `GMT`, `UT` ou en chiffres (`+02:00`, `+0200`, `+02`). Une autre écriture (`Oct 19 2026 08:15`, un fuseau nommé comme `CEST`) n'est pas une heure : elle s'affiche telle quelle, et sans `axis` l'axe devient un axe de libellés. Une date ou une heure impossible (le 31 novembre, le 30 février, `24:30`, 60 secondes, le mois 13, un fuseau de `+25:00` ou de `+02:60`) n'en est pas une non plus : elle s'affiche telle quelle, au lieu de devenir une autre date. Sur un axe de jours (`AAAA-MM-JJ`) aussi : `2026-11-31` ou `2026-13-01` s'affiche tel quel. `24:00`, la fin du jour, se lit comme minuit le lendemain.

Le réglage vaut pour les étiquettes, la bulle, le tableau, la grille jour × heure, les jours du calendrier et le regroupement par période. Un axe de jours (`AAAA-MM-JJ`) n'est pas concerné : un jour s'écrit pareil partout. Une zone inconnue est une faute (voir [Les fautes](#les-fautes)).

## Les textes — `label` et `empty-label`

- `label` nomme le graphique pour les lecteurs d'écran : c'est le titre du tableau caché. Défaut : « Graphique » (« Chart » en anglais).
- `empty-label` remplace « Aucune valeur » (« No values ») : le texte d'un graphique qui n'a rien à dessiner, et la première case de la légende d'intensité.

Les autres textes du module suivent la langue de la page, en français ou en anglais, comme ceux des autres modules cœur ([30 · Modules cœur](30-modules-coeur.md#libellés-par-défaut-et-langue-de-la-page)) : un texte écrit sur la balise passe avant, et le dictionnaire racine du projet les surcharge sous les clés `mjs.core.<clé>` :

| Clé | Français | Anglais |
|---|---|---|
| `chartLabel` | Graphique | Chart |
| `chartEmpty` | Aucune valeur | No values |
| `chartHint` | Flèches pour parcourir les points, Entrée pour choisir | Arrow keys to browse the points, Enter to choose |
| `chartBrowse` | Flèches pour parcourir les valeurs | Arrow keys to browse the values |
| `chartChoose` | Flèches pour parcourir les valeurs, Entrée pour choisir | Arrow keys to browse the values, Enter to choose |
| `chartGrouped` | Moyenne de {n} valeurs | Average of {n} values |
| `chartWeekOf` | Semaine du {date} | Week of {date} |
| `chartOwnScale` | Une échelle par série : leurs unités diffèrent | One scale per series: their units differ |
| `chartMean`, `chartMedian`, `chartQ1`, `chartQ3`, `chartTrend` | Moyenne, Médiane, Premier quartile, Troisième quartile, Tendance | Mean, Median, First quartile, Third quartile, Trend |
| `chartNext` | le cercle : le point suivant estimé | the circle: the next estimated point |
| `chartDate`, `chartTime`, `chartNumber`, `chartCategory`, `chartPeriod` | Date, Date et heure, Valeur, Libellé, Période | Date, Date and time, Value, Label, Period |
| `chartTotal`, `chartOthers`, `chartShare`, `chartSeries` | Total, Autres, Part, Série | Total, Others, Share, Series |
| `chartRange`, `chartCount`, `chartBin` | De {from} à {to}, Valeurs, Classe | {from} to {to}, Values, Range |
| `chartPieNone` | L'anneau ne convient pas à ces données : il compare plusieurs séries de même unité, ou des libellés | A ring does not suit this data: it compares several series with the same unit, or labels |
| `chartLess`, `chartMore`, `chartDayHour` | Moins, Plus, Jour et heure | Less, More, Day and time |

## Choisir une ligne — `pickable` et `@pick`

```html
<@@chart rows={$pesees} series={$series} pickable @pick={$choisie = e.data.id}></@@chart>
```

Avec `pickable`, un clic choisit une ligne et émet `pick` : `e.data.id` porte l'`id` de cette ligne.

- Graphiques à axes : la ligne de la colonne la plus proche du pointeur.
- Carte, radar et calendrier : la ligne que porte la case (ou l'axe), quand la case n'en porte qu'une.
- Histogramme et anneau : ils ne choisissent pas de ligne.

Rien n'est émis pour une ligne sans `id`, pour une période regroupée de plusieurs lignes, ni pour une case de plusieurs relevés. Au clavier, Entrée ou Espace choisit la colonne ou la case au focus. Un graphique qui se choisit se reconnaît : un curseur en forme de main, le trait du curseur dans la couleur d'accent (`$$accent`), le point qui grossit à l'appui.

## Lier dans les deux sens

`shape`, `stats`, `step` et `hidden` acceptent une liaison à deux sens, `!{…}`. La page change la variable : le graphique suit. Le graphique change la valeur : la variable de la page suit.

```html
<script>
  $forme   = 'line'
  $cachees = []
</script>

<button @click={$forme = 'bar'}>Barres</button>
<@@chart rows={$rows} series={$series} shape=!{$forme} hidden=!{$cachees}></@@chart>
```

C'est ainsi que la barre d'outils (ci-dessous) rend ses choix à la page.

## La barre d'outils — `toolbar`

```html
<@@chart rows={$pesees} series={$series} toolbar="legend shapes stats step" shape=!{$forme} stats=!{$stats} step=!{$pas} hidden=!{$cachees}></@@chart>
```

`toolbar` pose une barre d'outils au-dessus du dessin. Chaque mot ajoute un outil : `legend`, `shapes`, `stats`, `step`. Sans `toolbar`, pas de barre. Les outils se rangent toujours dans le même ordre, quel que soit l'ordre des mots : la légende, le menu des formes, les statistiques, le pas de temps. Sur un écran étroit, la barre passe à la ligne.

| Mot | Outil |
|---|---|
| `legend` | une pastille par série de nombres, pressée quand la série est visible : un clic la cache ou la montre ; la dernière série visible reste |
| `shapes` | un bouton qui montre la forme en cours et ouvre le menu des formes |
| `stats` | une case par statistique, qui montre son trait : cochée quand `stats` la demande |
| `step` | les pas de temps (`auto`, `day`, `week`, `month`, `year`), seulement sur un axe de temps ; le calendrier les propose sans `year` |

**Le menu des formes** liste les dix formes, dans l'ordre du module. `shapes` restreint la liste : `shapes="line bar pie"` ne propose que ces trois formes, toujours dans l'ordre du module ; sans mot connu, toutes les formes. Le menu s'ouvre sous son bouton, au-dessus quand la place manque en bas ; il ne sort jamais de l'écran, et sa hauteur se borne à la place disponible, même sous un `zoom` CSS (sur la page ou sur un conteneur). Il s'ouvre dans la couche du dessus de la page (`popover`) : un conteneur qui coupe (`overflow: hidden`, une carte à coins ronds) ne le rogne jamais ; quand la page défile, il suit son bouton, et il se ferme quand le bouton sort de l'écran (le focus revient au bouton). Un clic ailleurs dans la page le ferme. Un navigateur sans `popover` (avant Chrome 114, Firefox 125, Safari 17) l'ouvre dans le graphique, où un conteneur qui coupe peut le rogner. Au clavier : sur le bouton, Entrée ou Espace ouvre le menu, la flèche du bas l'ouvre sur la forme en cours, la flèche du haut sur la dernière ; dans le menu, les flèches vont d'une forme à l'autre (en boucle), Début et Fin à la première et à la dernière, Entrée choisit, Échap ferme et rend le focus au bouton, Tab ferme et repart du bouton. Choisir une forme ferme le menu et rend le focus au bouton.

**Les grisés.** Une forme impossible avec vos données est grisée dans le menu, et ne se choisit pas : le radar sous 3 lignes, le calendrier sans axe de dates, l'anneau quand il ne convient pas à vos données (même règle que [l'anneau](#pie--anneau)). Une case de statistique est grisée quand la forme en cours ne trace pas cette statistique. Les pas de temps sont grisés quand la forme ne suit pas les lignes (histogramme, anneau, carte, radar).

**La barre écrit les props elles-mêmes** : `shape`, `stats`, `step` et `hidden`, comme une liste écrit sa valeur. Liées par `!{…}`, la page suit chaque choix. Écrites en texte (`shape="line"`), elles donnent la valeur de départ, et la barre change le graphique seul. Liées à sens unique (`shape={$forme}`), la barre change aussi le graphique seul : la variable de la page garde sa valeur, et en développement le framework le rappelle :

```
<@@chart> écrit sa prop « shape » : cette valeur vient du parent ; liez-la par !{…} ou envoyez un événement. Le parent garde sa propre valeur, il ne voit pas ce changement.
```

Une liste garde sa forme : un texte reste un texte (`'mean trend'`), un tableau reste un tableau ; les statistiques gardent l'ordre du module.

**Rien en console après un choix de la barre.** Ce qu'entraîne un choix de l'utilisateur ne donne ni erreur ni avertissement des contrôles du module, en développement comme en production (seul le rappel d'une liaison à sens unique, ci-dessus, peut paraître en développement) : un radar choisi sur plus de 24 lignes, des séries d'unités différentes après une série montrée de nouveau, par exemple. Une valeur que le programme écrit ensuite reste contrôlée.

**Couleurs et parts.** La barre reprend les variables du graphique : `$$chart-text` pour son texte, `$$chart-grid` pour le contour des pastilles, `$$chart-neutral` pour leur halo au survol et le fond d'une pastille allumée, `$$chart-tip-fg` pour le texte d'une pastille allumée, `$$chart-tip-bg`, `$$chart-tip-fg` et `$$chart-tip-border` pour le menu, `$$accent` pour le contour du focus et la forme cochée, `$$shadow` pour l'ombre du menu. Une série garde sa teinte dans sa pastille. Pour `::part()` : `tools` (la barre) et `menu` (le menu des formes). Au survol, au focus clavier et à l'appui, une pastille s'allume ; avec `prefers-reduced-motion`, la barre n'a plus de transition.

**Une faute dans `toolbar` ou `shapes`.** Un mot inconnu écrit en texte arrête la construction ; venu d'une variable, il écrit une erreur dans la console, et le mot est ignoré (voir [Les fautes](#les-fautes)).

## Toutes les props

| Prop | Valeurs | Défaut |
|---|---|---|
| `rows` | les lignes : `{ id, x, readings }`, ou les mesures à plat | `[]` |
| `series` | les séries : `{ key, name, unit, color, kind, axis }` | `[]` |
| `shape` | `line`, `area`, `dots`, `bar`, `stack`, `histogram`, `pie`, `heatmap`, `radar`, `calendar` — à deux sens | `'line'` |
| `stats` | `mean`, `median`, `q1`, `q3`, `trend`, en texte ou en tableau — à deux sens | aucune |
| `step` | `auto`, `day`, `week`, `month`, `year` — à deux sens | `'auto'` |
| `hidden` | des clés de séries, en tableau ou en texte — à deux sens | `[]` |
| `bounds` | `[min, max]`, `null` d'un côté pour le laisser libre | aucune |
| `axis` | `date`, `datetime`, `number`, `category` | devinée sur `x` |
| `axis-unit` | l'unité de l'abscisse, dans la bulle | aucune |
| `label` | le nom du graphique pour les lecteurs d'écran | « Graphique » |
| `empty-label` | le texte d'un graphique vide | « Aucune valeur » |
| `timezone` | `local`, ou une zone IANA (`Europe/Paris`, `UTC`) : l'heure des instants affichés | l'heure telle qu'écrite |
| `decimals` | un entier de 0 à 10 : les chiffres après la virgule de chaque mesure | l'écriture automatique |
| `bridge` | relie les points d'une courbe ou d'une aire par-dessus une case vide | non |
| `pickable` | un clic ou Entrée choisit une ligne (`@pick`) | non |
| `toolbar` | les outils de la barre : `legend`, `shapes`, `stats`, `step` | pas de barre |
| `shapes` | les formes du menu de la barre, dans l'ordre du module | les dix formes |

Sur la balise, une prop en deux mots s'écrit avec un tiret : `axis-unit`, `empty-label`. Écrits `axisUnit="…"` ou `emptyLabel="…"`, ils arrêtent la construction, avec la bonne écriture. Liée, `emptyLabel={$texte}` marche aussi ([30 · Modules cœur](30-modules-coeur.md#le-raccourci-nom)).

Un événement : `pick`, avec `e.data.id`.

## Les couleurs

### Les six teintes

| N° | Nom | Variable | Sans réglage |
|---|---|---|---|
| 1 | `blue` | `$$chart-1` | `#3b82f6` |
| 2 | `orange` | `$$chart-2` | `#dd6b10` |
| 3 | `green` | `$$chart-3` | `#16a34a` |
| 4 | `pink` | `$$chart-4` | `#db2777` |
| 5 | `violet` | `$$chart-5` | `#8b5cf6` |
| 6 | `gold` | `$$chart-6` | `#b7860b` |

Chaque teinte par défaut garde un contraste d'au moins 3 contre un fond blanc comme contre un fond sombre.

Une série sans `color` prend les teintes dans l'ordre : la septième reprend la première. `color: 3` ou `color: 'green'` (la casse ne compte pas) donne la teinte 3 du thème : `green` nomme la teinte du thème, pas le vert du CSS. Un numéro au-delà de 6 reprend au début : `7` vaut `1`. Un nombre qui n'est pas un entier de 1 ou plus, en texte ou en nombre (`'0'`, `'1.5'`, `'1e-7'`, `0`, `-1`), n'est pas une couleur : il est refusé, comme une couleur que le navigateur ne sait pas lire. Un mot qui commence par un chiffre (`'0x10'`, `'12px'`) ne l'est pas non plus : la construction, le rendu serveur et le navigateur le refusent de même. Écrit en nombre, il compte par sa valeur : `color: 1.0` vaut `1`.

Une couleur CSS part telle quelle : `'#c0392b'`, `'rgb(192 57 43)'`, `'oklch(62% 0.19 30)'`, `'var(--ma-teinte)'`, `'oklch(from var(--marque) calc(l * 0.8) c h)'`. Elle ne porte jamais « ; », « : », un guillemet, une accolade, « < », « > », « \ », « /* » ni `url(` : une donnée ne peut glisser ni une autre règle de style, ni une requête vers une adresse. Le `*` passe.

À la construction, une couleur écrite dans une série sur la balise est aussi refusée quand le navigateur ne saurait pas la lire, à coup sûr : un mot qui n'est ni une teinte, ni une couleur nommée ou système du CSS (`'bleu'`) ; un `#` qui n'a pas 3, 4, 6 ou 8 chiffres ; une fonction qui n'est pas une couleur. Les fonctions de couleur sont `rgb`, `rgba`, `hsl`, `hsla`, `hwb`, `lab`, `lch`, `oklab`, `oklch`, `color`, `color-mix`, `light-dark` et `var`. Dans le doute (deux mots, une fonction suivie d'autre chose), rien n'est refusé à la construction. À l'exécution, une couleur venue d'une variable est vérifiée par le navigateur (`CSS.supports`) : une couleur qu'il ne sait pas lire est refusée comme les autres (voir [Les fautes](#les-fautes)).

### Les quatorze variables

Le reste se règle par quatorze variables de thème :

| Variable | Ce qu'elle colore | Sans réglage |
|---|---|---|
| `$$chart-grid` | les lignes de la grille, les anneaux de la toile du radar, le contour des pastilles de la barre d'outils | `$$border`, sinon la couleur du texte à 32 % |
| `$$chart-axis` | les deux axes du tracé, les rayons du radar | `$$border`, sinon la couleur du texte à 32 % |
| `$$chart-text` | les graduations, les étiquettes, les légendes, les notes, les noms des lignes d'une carte, le texte d'un graphique vide, le texte de la barre d'outils | `$$fg-muted`, sinon la couleur du texte |
| `$$chart-tip-bg` | le fond de la bulle et du menu des formes | `$$surface`, sinon `Canvas` |
| `$$chart-tip-fg` | le texte de la bulle, du menu des formes et d'une pastille allumée | `$$fg`, sinon `CanvasText` |
| `$$chart-tip-border` | le bord de la bulle et du menu des formes, le filet au-dessus du total | `$$border`, sinon la couleur du texte à 22 % |
| `$$chart-tip-title` | le titre de la bulle | la couleur du texte de la bulle |
| `$$chart-stat-mean` | le trait de la moyenne | la teinte de la série (la teinte neutre sur un histogramme) |
| `$$chart-stat-median` | le trait de la médiane | idem |
| `$$chart-stat-q1` | le trait du premier quartile | idem |
| `$$chart-stat-q3` | le trait du troisième quartile | idem |
| `$$chart-stat-trend` | la droite de tendance et son cercle | idem |
| `$$chart-empty` | une case sans valeur (carte, calendrier, légende d'intensité) | la couleur du texte à 12 % |
| `$$chart-neutral` | la teinte neutre : les traits de l'histogramme, la légende des niveaux d'une carte à plusieurs séries, la part « Autres » de l'anneau (éclaircie), la piste de l'anneau, le halo et le fond des pastilles de la barre, la forme survolée du menu | la couleur du texte |

Elles se règlent partout où se règle une variable de thème ([31 · Thèmes](31-themes.md)) : un thème du document (`light.theme.mjs`, `dark.theme.mjs`), le `<theme>` d'un composant, ou un `<style>`, sous un sélecteur. Sans réglage, chaque pièce suit les couleurs générales du thème, en clair comme en sombre.

```html
<div class="bilan">
  <@@chart rows={$pesees} series={$series} stats="mean"></@@chart>
</div>

<style>
  .bilan
    $$chart-1:         #0ea5e9
    $$chart-grid:      #e2e8f0
    $$chart-stat-mean: #f59e0b
</style>
```

### Taille, parts et autres variables

- `$$chart-grid-opacity` : l'opacité des lignes de la grille des graphiques à axes, de 0 à 1. Défaut : 0,5.
- `$$chart-height` : la hauteur du tracé des graphiques à axes, et le diamètre de l'anneau. Défaut : 180 px. La carte prend 26 px par ligne ; le radar et le calendrier ont leur taille, et se resserrent sur un écran étroit.
- `$$accent` colore le contour du focus et le curseur d'un graphique qui se choisit (`#3b82f6` sans réglage) ; `$$surface`, le liseré entre deux parts de l'anneau et autour des points allumés ; `$$shadow`, l'ombre de la bulle.
- **Parts**, pour `::part()` : `chart` (le tout), `tools` (la barre d'outils), `menu` (le menu des formes), `frame`, `plot`, `hit` (la zone qui reçoit le pointeur), `tip` (la bulle), `empty`, `note`, `keys` (la légende des statistiques), `pie`, `ring`, `center`, `legend`, `heat`, `radar`, `dial`, `calendar`, `ramp` (la légende d'intensité), `blank` (le cadre d'une carte, d'un radar ou d'un calendrier vides).

## Les fautes

Une valeur fausse ne passe pas en silence. Le moment où elle se voit dépend de l'endroit où elle s'écrit.

### Écrite dans le code : la construction s'arrête

Quand la valeur est écrite en texte sur la balise, la construction s'arrête, avec le chemin du fichier, le mot, l'attribut et les valeurs permises :

- un mot inconnu de `shape`, `stats`, `step`, `axis`, `toolbar` ou `shapes` ;
- une couleur refusée, dans une série écrite sur la balise (`series={[{ key: 'v', color: 'red;x' }]}`, `color: 'bleu'`, `color: '#12345'`, `color: '0'`, `color: 0` écrit en nombre) ;
- un axe de série qui n'est ni `left` ni `right`, dans une série écrite sur la balise (`series={[{ key: 'pluie', axis: 'droite' }]}`, `axis: 'Right'`) ;
- des statistiques que la forme ne trace pas : `stats` sur `stack`, `pie`, `heatmap`, `radar` ou `calendar`, `trend` sur `histogram` ;
- `step="year"`, ou un axe qui n'est pas une date, sur un calendrier ;
- un radar dont les lignes, écrites sur la balise, sont moins de 3 ;
- une zone inconnue dans `timezone` ;
- une valeur de `decimals` hors de 0 à 10, écrite en texte ou en nombre (`decimals="12"`, `decimals={2.5}`) ;
- une prop en deux mots écrite en camelCase (`emptyLabel="Rien"`).

```
[bundler] …/src/page.mjs : <@@chart shape="courbe"> — « courbe » n'est pas une valeur connue de shape (valeurs connues : line area dots bar stack histogram pie heatmap radar calendar). Corrigez la faute de frappe.
[bundler] …/src/page.mjs : <@@chart toolbar="legend tableau"> — « tableau » n'est pas une valeur connue de toolbar (valeurs connues : legend shapes stats step). Corrigez la faute de frappe.
[bundler] …/src/page.mjs : <@@chart series={…}> — la couleur « bleu » est refusée : écrivez un nom de teinte (blue orange green pink violet gold), un entier de 1 ou plus (au-delà de 6, on reprend au début) ou une couleur CSS que le navigateur sait lire, sans « ; », « : », guillemet, accolade, « < », « > », « \ », « /* » ni url(…).
[bundler] …/src/page.mjs : <@@chart series={…}> — axis « droite » d'une série n'est pas une valeur connue (valeurs connues : left right). Corrigez la faute de frappe.
[bundler] …/src/page.mjs : <@@chart shape="pie" stats="mean"> — la forme pie ne trace pas stats « mean » (formes qui tracent des statistiques : line area dots bar histogram ; trend : line area dots bar). Retirez « mean » de stats ou changez de forme.
[bundler] …/src/page.mjs : <@@chart shape="histogram" stats="mean trend"> — la forme histogram ne trace pas stats « trend » (formes qui tracent des statistiques : line area dots bar histogram ; trend : line area dots bar). Retirez « trend » de stats ou changez de forme.
[bundler] …/src/page.mjs : <@@chart shape="calendar" step="year"> — step="year" ne va pas avec la forme calendar (valeurs possibles : auto day week month).
[bundler] …/src/page.mjs : <@@chart shape="radar" rows={…}> — un radar demande au moins 3 lignes, une par axe : 2 sont écrites.
[bundler] …/src/page.mjs : <@@chart timezone="Europe/Pari"> — « Europe/Pari » n'est pas un fuseau connu : écrivez local (l'heure de l'écran du visiteur) ou le nom d'une zone IANA (Europe/Paris, America/New_York, UTC…), ou retirez timezone pour afficher les heures telles qu'elles sont écrites.
[bundler] …/src/page.mjs : <@@chart decimals="12"> — decimals attend un nombre entier de 0 à 10, le nombre de chiffres après la virgule : « 12 » ne convient pas.
[bundler] …/src/page.mjs : <@@chart emptyLabel=…> — écrivez empty-label : sur un module du cœur, un attribut écrit en dur s'écrit à tirets, comme dans sa documentation. Écrit ainsi, emptyLabel arriverait en minuscules (emptylabel) et le module le recevrait pourtant sous son nom : la construction n'en garde qu'une écriture.
```

Une combinaison ne se vérifie que si ses deux côtés sont écrits en texte, et qu'aucun étalement (`{...reglages}`) ne peut poser l'autre côté. Les lignes d'un radar ne se comptent que si `rows` est un tableau écrit sur la balise, objet par objet. Une valeur calculée (`shape={$forme}`, et dans une série un texte suivi d'autre chose : `axis: $mode == 'x' ? 'right' : 'left'`, `axis: 'droite' + $suffixe`, `color: 'bleu' + $nuance`) passe la construction : le module la vérifie à l'exécution. Un commentaire derrière la valeur (`// …`, `/* … */`), ou la fin de la ligne quand la suivante ouvre la clé suivante au même retrait, la laissent écrite seule : `axis: 'droite' // à revoir` arrête la construction. Une ligne suivante plus en retrait la continue (Civet en fait un appel de la valeur), comme un `#` derrière elle : le gabarit n'a pas de commentaire `#`.

Une série écrite `axis: 'right'` sur une forme écrite qui n'a qu'une échelle, ou aucune, n'arrête pas la construction : la série reste sur l'échelle du graphique, et un avertissement le dit ([Deux échelles](#deux-échelles--axis-right)) :

```
[bundler] …/src/page.mjs : <@@chart shape="stack" series={…}> — la forme stack n'a qu'une échelle, axis « right » est ignoré pour pluie (formes à deux échelles : line area dots bar). Retirez axis: 'right' ou changez de forme.
```

Il vient quand la forme est écrite en texte, sans étalement sur la balise, et que la série est un objet écrit dans le tableau `series={[…]}`, avec sa clé et `axis: 'right'` écrits, sans `kind: 'text'` (une série de mots n'a pas d'axe). Un radar dont les lignes écrites sont 1 ou 2 n'en a pas : une courbe le remplace. Une forme, une série ou une valeur calculée ne se lit pas à la construction : le module le dit à l'exécution.

### Venue d'une variable : une erreur dans la console

Le module vérifie la valeur qu'il reçoit. Une faute écrit une erreur (`µ.error`) dans la console, une fois par page, en développement comme en production (le niveau de console par défaut garde les erreurs). Puis le graphique prend la valeur par défaut et reste lisible :

| Faute | Ce que fait le graphique |
|---|---|
| un mot inconnu de `shape` | une courbe |
| un mot inconnu de `stats` | ce mot est ignoré, les autres restent |
| un mot inconnu de `step` | `auto` |
| un mot inconnu de `axis` | l'axe deviné |
| un mot inconnu de `toolbar` | ce mot est ignoré, les autres outils restent |
| un mot inconnu de `shapes` | ce mot est ignoré ; sans mot connu, le menu propose les dix formes |
| une couleur refusée, ou que le navigateur ne sait pas lire (`CSS.supports`) | la série prend sa teinte dans l'ordre |
| des statistiques que la forme ne trace pas | elles sont ignorées, les autres restent : sur un histogramme, `mean trend` garde la moyenne |
| `step="year"` sur un calendrier | `auto`, une case par jour |
| un axe qui n'est pas une date sur un calendrier | l'axe deviné sur les abscisses |
| une zone inconnue dans `timezone` | les heures telles qu'écrites |
| une valeur de `decimals` hors de 0 à 10 | l'écriture automatique |
| un mot inconnu de `axis` dans une série | la série reste sur l'axe de gauche |
| une ligne dont la date n'existe pas, quand `step` regroupe ou sur un calendrier | la ligne quitte le graphique |

```
<@@chart> : « courbe » n'est pas une valeur connue de shape, elle est ignorée — valeurs connues : line area dots bar stack histogram pie heatmap radar calendar.
<@@chart> : « tableau » n'est pas une valeur connue de toolbar, elle est ignorée — valeurs connues : legend shapes stats step.
<@@chart> : la couleur « bleu » de la série « v » est refusée, la série prend la teinte 1 — écrivez un nom de teinte (blue orange green pink violet gold), un entier de 1 ou plus (au-delà de 6, on reprend au début) ou une couleur CSS que le navigateur sait lire, sans « ; », « : », guillemet, accolade, « < », « > », « \ », « /* » ni url(…).
<@@chart> : la forme pie ne trace pas stats « mean », il est ignoré — formes qui tracent des statistiques : line area dots bar histogram ; trend : line area dots bar.
<@@chart> : step « year » ne va pas avec la forme calendar, il est ignoré — valeurs possibles : auto day week month.
<@@chart> : « Europe/Pari » n'est pas un fuseau connu, il est ignoré — écrivez local ou le nom d'une zone IANA (Europe/Paris, UTC…) ; sans fuseau, les heures s'affichent telles qu'elles sont écrites.
<@@chart> : decimals « 12 » est ignoré — écrivez un nombre entier de 0 à 10 ; sans decimals, les nombres gardent leur écriture automatique.
<@@chart> : axis « droite » de la série « pluie » n'est pas une valeur connue, la série reste sur l'axe de gauche — valeurs connues : left right.
<@@chart> : « 2026-02-30 » n'est pas une date qui existe, sa ligne ne se range dans aucune période et quitte le graphique — écrivez un jour possible (AAAA-MM-JJ) ou un instant qui se lit.
```

`axis` d'une série venue d'une variable se vérifie ici, à l'exécution ; écrite sur la balise, elle arrête la construction (voir plus haut). La date d'une ligne ne se contrôle que lorsqu'elle doit se ranger dans une période ; après un pas ou une forme choisis dans la barre d'outils, rien n'est écrit en console.

### Une limite des données : un avertissement en développement

Certaines données dépassent ce qu'une forme montre bien. Ce n'est pas une faute du code : un avertissement (`µ.warn`) le dit, une fois, en développement seulement (la production ne l'envoie pas, sauf `logLevel` à `warn`, voir [34 · Déboguer](34-deboguer.md)) :

```
<@@chart> : les séries de la forme stack n'ont pas la même unité (kg min) et partagent pourtant une même échelle.
<@@chart> : un radar montre 24 axes au plus, les 30 lignes reçues sont réduites aux 24 dernières.
<@@chart> : un radar demande au moins 3 lignes, une par axe ; il en reçoit 2, une courbe le remplace.
<@@chart> : la série « remboursements » n'a pas de total positif, l'anneau ne lui donne aucune part.
<@@chart> : le libellé « Bâle » n'a pas de total positif, l'anneau ne lui donne aucune part.
<@@chart> : la forme stack n'a qu'une échelle, axis « right » est ignoré pour pluie — formes à deux échelles : line area dots bar.
```

Le premier vient des barres empilées, du radar et de la carte par série, quand les séries visibles qui ont une valeur n'ont pas la même unité. Le deuxième vient d'un radar de plus de 24 lignes. Le troisième vient d'un radar qui reçoit 1 ou 2 lignes d'une variable : ce n'est pas une erreur, une courbe le remplace. Le quatrième vient d'un anneau par série : une série sans total positif n'y a pas de part. Le cinquième vient d'un anneau par libellé : un libellé dont le total n'est pas positif (des valeurs négatives, ou qui s'annulent) n'y a pas de part. Le sixième vient d'une série écrite `axis: 'right'` sur une forme qui n'a qu'une échelle, ou aucune : la série reste sur l'échelle du graphique ; écrites toutes deux sur la balise, la forme et la série le font dire aussi à la construction (voir plus haut). Aucun ne vient d'un choix fait dans la barre d'outils.

## Les limites

| Limite | Valeur | Au-delà |
|---|---|---|
| points d'une courbe ou d'une aire | 40 lignes affichées | le trait reste, les points partent ; `dots` les garde |
| branches d'un radar | 24 | les 24 dernières lignes ; un avertissement de développement |
| noms des branches d'un radar | 8 | seuls les noms du haut, de droite, du bas et de gauche s'écrivent ; tous restent dans la bulle et le tableau |
| lignes d'un radar | 3 au moins | une courbe le remplace ; un avertissement de développement quand elles viennent d'une variable |
| parts de l'anneau | 7 | les suivantes dans « Autres » |
| classes de l'histogramme | de 3 à 12 | selon le nombre de valeurs |
| niveaux d'intensité | 5, et le niveau 0 d'une case vide | — |
| calendrier | les 26 dernières semaines (par jour ou par semaine), les 12 derniers mois (par mois) | les périodes plus anciennes ne se dessinent pas, et le tableau caché ne les donne pas |
| carte jour × heure | 7 jours × 24 heures | — |
| nom de branche du radar | 18 signes | abrégé d'un « … » |
| bulle | 260 px de large au plus, 70 % de l'écran sur un écran étroit | le texte passe à la ligne |
| une faute ou un avertissement | une fois par page | — |

## Accessibilité

- **Un tableau caché double le dessin.** Les lecteurs d'écran lisent un tableau des valeurs affichées ; son titre est `label`. La première colonne donne l'abscisse (« Date », « Date et heure », « Valeur », « Libellé », ou « Période » après un regroupement), puis une colonne par série visible, avec son unité ; les séries de mots en font partie tant que rien n'est regroupé, et les barres empilées ajoutent « Total ». L'histogramme donne une ligne par classe ; l'anneau une ligne par part, avec sa valeur et son pourcentage ; la carte jour × heure et le calendrier, une ligne par case qui a des relevés. Le dessin et la bulle sont cachés aux lecteurs d'écran.
- **Le clavier.** Un graphique à axes se parcourt au clavier quand il est `pickable` ; l'histogramme, l'anneau, la carte, le radar et le calendrier se parcourent toujours. La zone reçoit le focus, avec un nom qui dit les touches (« Flèches pour parcourir les valeurs »). Les flèches gauche et droite vont d'une colonne, d'une part ou d'une case à l'autre ; sur une grille, haut et bas changent de ligne (sur la carte jour × heure, d'un jour à l'autre ; sur le calendrier par jour, gauche et droite changent de semaine, haut et bas de jour). Début et Fin vont au premier et au dernier ; Échap ferme la bulle ; Entrée ou Espace choisit, quand le graphique se choisit.
- **Deux échelles.** Le tableau caché donne chaque valeur avec son unité, que sa série soit graduée à gauche ou à droite.
- **Une région annoncée.** Pendant le parcours au clavier, chaque position s'annonce : le titre de la bulle, puis chaque ligne (« Poids 72 kg »).
- **Au doigt**, un appui ouvre la bulle, l'appui suivant ailleurs dans la page la ferme ; le défilement vertical reste libre sur le dessin.
- **La bulle** s'ouvre à droite du curseur, à gauche quand la place manque, sinon au mieux : jamais coupée par le cadre du graphique ni par l'écran.
- **Mouvement réduit** : avec `prefers-reduced-motion`, les transitions de la bulle, des points, des parts et des cases s'arrêtent.

## Le rendu serveur

Dans une page rendue par le serveur, le graphique est dessiné dans le HTML servi : le cadre, les graduations (des deux côtés avec `axis: 'right'`), les étiquettes, les séries, les statistiques et le tableau ; les barres empilées, l'histogramme et l'anneau avec son centre et sa légende ; le calendrier, le radar et la carte avec leurs cases, leurs axes et leur légende. Aucune teinte du thème n'est écrite en style dans les balises : elles passent par des classes. Le serveur ne connaît pas la largeur du tracé : il espace les étiquettes de l'axe x selon la plus longue, et règle les gouttières des graduations sur une estimation de leur largeur ; dans le navigateur, le graphique mesure son tracé et ses graduations, choisit de nouveau les étiquettes et ajuste la gouttière. La page reprise par le navigateur garde le dessin du serveur, sans saut, puis répond au pointeur. Les heures sont les mêmes des deux côtés, quelle que soit leur écriture (ISO 8601, `Time#to_s` de Ruby, RFC 2822), sauf avec `timezone="local"` : elles passent à l'heure du visiteur à la reprise (voir [Les heures](#les-heures)).

## Le poids

Le module et sa couche de calcul n'entrent dans le bundle que si une source du projet écrit `<@@chart>` (ou `<mjs-core-chart>`). Une application sans graphique ne paie rien : ni le module, ni ses calculs, ni ses textes. Une application qui écrit un graphique reçoit le module et ses dix formes. La barre d'outils ne part que si une page écrit `toolbar` sur une balise `<@@chart>`, en dur (`toolbar="legend shapes"`) ou liée (`toolbar={$outils}`) ; sans elle, son code, son style, ses icônes et ses textes sont retirés, en développement comme en production, au serveur comme au navigateur. Dans le doute (un étalement `{...props}`, une balise dynamique qui pose `toolbar`, un script qui nomme la balise du graphique : le `<script>` d'un composant, un module `.civet`, `.coffee`, `.js` ou `.ts` du projet), la barre reste. Un graphique qui reçoit `toolbar` d'un script alors qu'aucune page ne l'écrit n'a donc pas de barre, et la console du développement vous le signale : écrivez l'attribut dans le gabarit, lié à une variable si un script doit le changer.
