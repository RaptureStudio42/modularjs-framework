# 35 · Images (`µimage` & `<@@img>`)

> 📚 Leçon de tuto associée : [Images optimisées (<@@img> et µimage)](https://mjs.rapturestudio.fr/tuto#/images).

Sans rien faire, un téléphone télécharge la photo de 1920 pixels pour l'afficher dans 380 — quatre fois trop d'octets, sur la connexion la plus lente. Et une image sans dimensions déclarées fait **sauter la mise en page** dès qu'elle arrive : le navigateur ne connaît sa hauteur qu'après le premier octet de pixels, tout ce qui suit dans la page se décale au moment où elle apparaît. `µimage` et la forme courte `<@@img src="…">` répondent aux deux problèmes au **build**, jamais à l'exécution.

## `<@@img src="…">` — la forme courte, résolue au build

```html
<@@img src="hero.jpg" alt="Description utile">
```

Un `src` écrit en dur (chaîne entre guillemets, chemin relatif à `sourceDir` — ou à un dossier de `assetDirs`, cf. [Des images rangées ailleurs](#des-images-rangées-ailleurs-assetdirs)) est résolu au build comme un `µimage('hero.jpg')` : le fichier est lu, ses dimensions natives et ses variantes calculées, et la balise ressort complète :

```html
<@@img src="/assets/hero-3f2a91c8.jpg" srcset="/assets/hero-480-….webp 480w, …" sizes="100vw" width="1920" height="800" alt="Description utile">
```

- **Un attribut écrit à la main garde la main** : `sizes`, `width`, `height` ou `srcset` posés par l'auteur ne sont jamais remplacés — seuls les attributs absents sont remplis.
- **`widths="320 640"`** (espaces ou virgules) choisit les largeurs de variantes pour cette image seule, comme les largeurs littérales de `µimage` ; l'attribut ne survit pas dans le HTML émis.
- **Rien n'est résolu** pour un `src={…}` dynamique, un chemin absolu (`/images/x.png`, servi par le serveur) ou une URL (`https://…`, `data:`) : la balise passe telle quelle.
- **Fichier introuvable = build en échec**, en nommant la balise et le chemin — même contrat que `µimage` et `µasset`.
- **L'image est suivie comme dépendance** : la modifier recompile le composant.
- **Un `widths` calculé** (`widths={$w}`), ou un `src`/`widths` écrit **deux fois** sur la même balise, fait échouer le build : ces deux formes ne se résolvent pas au build, et rien ne disparaît en silence.

`µimage` garde sa place quand une résolution sert à plusieurs endroits (une vignette et son agrandissement), quand on affiche ses valeurs (`{photo.width} × {photo.height}`, le `srcset` produit), ou sur un `<img>` natif.

## `µimage('chemin'[, largeur…])`

```html
<script>
  photo = µimage('hero.jpg')
  vignette = µimage('hero.jpg', 320, 640)
</script>

<img src={photo.src} srcset={photo.srcset} sizes={photo.sizes} width={photo.width} height={photo.height} alt="Description utile">
```

L'appel est résolu au **build** et remplacé par un objet littéral — `{ src, srcset, sizes, width, height }` — le compilateur ne voit jamais un appel de fonction dans le code émis. Mêmes règles d'écriture que `µasset('…')` (cf. [15 · Éléments spéciaux](15-elements-speciaux.md)) : le chemin est un **littéral chaîne écrit en dur**, relatif à `sourceDir` (ou à un dossier de `assetDirs`), résolu au build — jamais une variable. Les largeurs, elles aussi littérales, sont facultatives et entières (`µimage('hero.jpg', 480, 960)`). Alias tolérés : `µ.image`, `mjsimage`, `mjs.image`.

Deux appels au **même fichier** avec des largeurs différentes sont deux entrées distinctes — chacune résolue et indexée séparément par le texte exact de l'appel.

## Deux niveaux, délibérément séparés

### 1. Les dimensions natives — sans aucune dépendance

La largeur et la hauteur natives sont lues directement dans l'**en-tête** du fichier, sans décoder la moindre image : PNG, JPEG, GIF, WebP (VP8/VP8L/VP8X), AVIF/HEIC (bloc `ispe` de l'ISOBMFF), et le SVG par les attributs `width`/`height` de sa balise `<svg>` quand ils sont en pixels (nombre nu ou `px`), sinon par son `viewBox` — `width="100%"` ou `10em` ne sont pas des pixels, et sans `viewBox` le SVG n'a alors pas de taille. Cette lecture ne lève jamais — un format inconnu rend simplement `null`, `width`/`height` valent alors `null` dans l'objet résolu. C'est ce niveau, universel, qui **supprime le saut de mise en page** : le gain le plus visible, et il marche chez tout le monde, aucune dépendance à installer.

### 2. Les variantes — qui exigent `sharp`, dépendance optionnelle

Produire plusieurs largeurs et des formats modernes (webp, avif…) demande un vrai encodeur d'images : `sharp`. C'est une dépendance **optionnelle**, jamais celle du framework — installée, elle vit dans le `node_modules` du **projet** :

```
npm i -D sharp
```

Absente, `µimage` ne casse jamais le build : l'image d'origine passe telle quelle (`srcset` vide, `src` seul), et un avertissement **unique** (une seule fois par build, quel que soit le nombre d'images concernées) le rappelle en console :

> `[bundler] µimage : 'sharp' n'est pas installé — les images passent telles quelles, sans variantes de largeur. Les dimensions natives, elles, sont bien écrites (pas de saut de mise en page). Pour produire les variantes : npm i -D sharp`

Même patron que le moteur de rendu `browser` (Playwright, cf. [19 · SSR](19-ssr.md)) : un poste qui ne peut pas compiler un binaire natif n'a jamais un build cassé pour autant.

## Les règles exactes

- **Jamais d'agrandissement** : une largeur demandée plus grande que l'original est écartée avant même d'appeler `sharp` — une variante plus large que la source n'apporterait rien.
- **Le SVG n'est jamais redimensionné** : une seule ressource, `srcset` reste vide — un vectoriel s'adapte tout seul à n'importe quelle taille d'affichage.
- **`src` reste toujours l'image d'origine**, même quand des variantes existent : c'est le repli d'un navigateur qui ne comprendrait pas `srcset`.
- **Une image donnée en réglage d'un effet** (`*blend`, `*gradient`, `*scratch`, `*peel`, `*ink`) s'écrit par son chemin, tel quel (`*gradient(image: 'photo.jpg')`) : le build la traite comme un `µimage('photo.jpg')`, sans rien de plus à écrire. Elle prend la plus petite variante qui couvre la largeur de la balise (× la densité de l'écran), sinon l'image d'origine (cf. « Quelle image charge un effet », plus bas).
- **Une image introuvable fait ÉCHOUER le build**, en nommant le fichier fautif — même contrat qu'un `µasset` absent : jamais un chemin cassé qui part en production.
- **L'image est suivie comme dépendance** : la modifier (même en gardant le même nom de fichier) invalide et recompile tout composant qui l'utilise, exactement comme un `.civet` importé.

## Le bloc de configuration `image`

| Clé | Type | Défaut | Rôle |
|---|---|---|---|
| `widths` | tableau d'entiers de 1 à 10 000, sans doublon | `[480, 960, 1920]` | largeurs de variantes à produire (bornées par `sharp`, jamais au-delà de la largeur native) |
| `formats` | tableau parmi `avif`/`webp`/`jpeg`/`png` | `['webp']` | formats de variantes à produire |
| `quality` | entier 1-100 | `78` | qualité d'encodage transmise à `sharp` |

```json
{
  "image": { "widths": [320, 640, 1280], "formats": ["avif", "webp"], "quality": 80 }
}
```

Validation **stricte**, comme le reste de `mjs.config.json` (cf. [32 · CLI & configuration](32-cli-et-configuration.md)) : une clé hors `widths`/`formats`/`quality`, une largeur qui n'est pas un entier de 1 à 10 000 ou qui figure deux fois, un format hors liste ou une qualité hors 1-100 font échouer le build avec un message qui nomme la valeur reçue. Un appel `µimage('chemin', 320, 640)` avec des largeurs **explicites** ignore `image.widths` pour cet appel précis — les largeurs littérales de l'appel priment.

Une variante émise porte un nom haché — `hero-960-3f2a91c8.webp` (`<base>-<largeur>-<empreinte>.<format>`) — et son `srcset` liste chaque largeur produite (`960w`) ; `sizes` vaut `100vw` dès qu'au moins une variante existe, chaîne vide sinon (SVG, `sharp` absent, ou toutes les largeurs demandées supérieures à l'original).

Dans le `srcset`, l'adresse de chaque variante est encodée : `photo de vacances.jpg` y devient `photo%20de%20vacances-960-3f2a91c8.webp 960w`. Une espace brute couperait l'adresse en deux, et le navigateur ignorerait tout le `srcset`. Le nom du fichier publié, lui, ne change pas.

**Quelle image charge un effet.** Pour une image donnée en réglage d'un effet (le chemin entre guillemets, ou `µimage('…')`), l'effet charge la plus petite variante qui couvre la largeur de la balise à l'écran (× la densité de l'écran). Quand aucune variante ne la couvre, il charge l'image d'origine, jamais une variante plus petite agrandie, donc floue : un sujet de 800 px affiché sur 800 px prend l'original, pas la variante de 480 px.

## Des images rangées ailleurs (`assetDirs`)

Par défaut, un composant ne lit que les images rangées dans le dossier de MJS (`sourceDir` — chez Rails, `app/assets/modularJS`). Or un projet range souvent ses images ailleurs : chez Rails, le pipeline d'assets garde les siennes dans `app/assets/images`, et vos vues les affichent déjà. La clé `assetDirs` de `mjs.config.json` ajoute des dossiers où `µimage`, `µasset` (et ses alias `µ.asset`, `mjsasset`, `mjs.asset`) et `<@@img>` cherchent une image que `sourceDir` ne porte pas — pour tout serveur (Rails, Laravel, un simple dossier).

```json
{
  "sourceDir": "app/assets/modularJS",
  "assetDirs": ["app/assets/images"]
}
```

Avec cette configuration, `<@@img src="logo.png" alt="Logo">` (ou `µimage('logo.png')`) trouve `app/assets/images/logo.png`. L'image est traitée comme une image de `sourceDir` : empreinte dans le nom, copie dans `outputDir`, adresse publique, dimensions natives et variantes sont les mêmes. Tout se passe au build : rien de plus n'est envoyé aux visiteurs.

Les règles :

- **Ordre de recherche** : `sourceDir` d'abord (comme sans la clé), puis chaque dossier de la liste, dans l'ordre où vous l'avez écrit. Le premier qui porte le fichier gagne.
- **Un même nom dans deux dossiers** : celui de `sourceDir` gagne, sinon celui du premier dossier de la liste, et le build **avertit** en nommant les deux fichiers (`[lint.image]`, que `"lint": { "image": false }` coupe). L'avertissement ne vient que si un composant cite ce chemin : un homonyme que personne ne cite reste silencieux.
- **Introuvable partout** : le build s'arrête, et le message nomme les dossiers fouillés, dans l'ordre.
- **Les chemins** sont relatifs au dossier de `mjs.config.json`, comme ceux des autres clés ; un chemin absolu est accepté. Une valeur qui n'est pas une liste de chaînes, ou un dossier absent, fait refuser la configuration avant tout build, avec un message qui nomme la clé et la valeur.
- **Des fichiers copiés tels quels** : les dossiers de la liste portent des images (mais aussi polices, sons… cités par `µasset`). Le code (`.mjs`, `.civet`, `.coffee`, `.js`) reste cherché sous `sourceDir` seul.
- **Chaque dossier garde ses chemins sous lui**, comme `sourceDir` : `µasset('../secret.png')` ne remonte pas hors d'un dossier de la liste, et un lien symbolique qui en sort fait échouer le build.
- **`mjs dev`** surveille aussi ces dossiers : une image ajoutée, modifiée ou retirée y est vue comme une image de `sourceDir`, et les composants qui l'utilisent sont recompilés avec la bonne image — y compris quand l'ajout change la priorité (une image ajoutée dans un dossier prioritaire prend la place de celle d'un dossier suivant). Un dossier de la liste est surveillé où qu'il vive, y compris sous `node_modules/` ou sous un dossier dont le nom commence par un point (`.assets/`) ; à l'intérieur, ce qui est caché (nom qui commence par un point), `node_modules` et `.git` restent ignorés.
- **`µasset` dans une feuille de style** : `url(µasset('fonts/ma-police.woff2'))` écrit dans un `<style>` de composant (sass, scss ou css), dans sa déclinaison nommée (`<style name="…">`) ou dans une feuille partagée de `stylesheetsDir` est remplacé par l'adresse à empreinte du fichier, cherché comme partout (`sourceDir`, puis les dossiers de la liste), et le fichier est copié dans `outputDir`. Un fichier introuvable arrête le build en nommant les dossiers fouillés.
- **Rendu serveur et prérendu** compilent avec les options du projet : même résolution que le build.
- **Sans la clé**, rien ne change : la sortie du build est la même, à l'octet.

> ⚠️ **Une limite à connaître.** Une même image affichée sur la **même page** par une vue Rails ET par un composant MJS est téléchargée **deux fois** : Rails la publie sous l'adresse de son pipeline d'assets, MJS sous la sienne (`urlPrefix`, avec l'empreinte de MJS) — deux adresses, que le navigateur ne peut pas rapprocher. Pour qu'une page ne la télécharge qu'une fois, affichez-la d'un seul côté.

## Le module cœur `<@@img>`

Forme courte, `src` littéral résolu au build (cf. plus haut) :

```html
<@@img src="hero.jpg" alt="Description utile">
```

Forme longue, appuyée sur un `µimage('chemin')` déjà résolu :

```html
<@@img src={$photo.src} srcset={$photo.srcset} sizes={$photo.sizes} width={$photo.width} height={$photo.height} alt="Description utile">
```

| Prop | Défaut | Rôle |
|---|---|---|
| `src` | `''` | URL de l'image (repli `srcset`) |
| `srcset` | `''` | variantes de largeur, format `url Nw` |
| `sizes` | `'100vw'` | indice de taille d'affichage pour le choix de variante |
| `alt` | `''` | texte alternatif — voir *Accessibilité* plus bas |
| `width` / `height` | `null` | dimensions natives, réservent l'espace avant chargement |
| `loading` | `'lazy'` | attribut natif `loading` |
| `decoding` | `'async'` | attribut natif `decoding` |
| `fit` | `'cover'` | posé en `object-fit` via `@style.objectFit` |

Compile en `<img>` nu avec ces mêmes attributs. Une variable de thème, `$$img-radius` (défaut `0`), arrondit les coins ; le style embarqué pose `max-width: 100%` / `height: auto` — l'image reste fluide sans rien écrire côté appelant.

## Accessibilité

Le lint `lint.a11y` (cf. [32 · CLI & configuration](32-cli-et-configuration.md) → `lint.a11y`) traite `<@@img>` **exactement comme un `<img>` natif** : sans attribut `alt` sous aucune forme, il déclenche le même avertissement de build (« sans attribut alt — ajoutez `alt="…"` … ou `alt=""` si l'image est purement décorative »), quel que soit celui des deux qui manque de l'attribut.

<details>
<summary>🎓 <b>Pour débutants</b> — pourquoi deux dimensions séparées des variantes ?</summary>

Parce qu'elles ne coûtent pas la même chose. Lire la largeur et la hauteur d'une image ne demande que quelques octets de son en-tête — aucun décodage, aucune dépendance, ça marche à l'instant sur n'importe quel poste. Produire une variante de 640 pixels d'un JPEG de 4000, en revanche, demande un vrai décodeur/encodeur d'image (`sharp`), qui compile un binaire natif selon le système — pas toujours possible ou souhaité partout. En séparant les deux, `µimage` garantit que le bénéfice le plus important (plus de saut de mise en page) est **toujours** acquis, et fait du reste (l'économie d'octets par variantes) un bonus qui s'active en une commande, sans jamais pouvoir casser un build.

</details>

---

📚 **Voir aussi** : [15 · Éléments spéciaux](15-elements-speciaux.md) pour `µasset` (assets génériques : polices, sons…) et son idiome CSS ; [30 · Modules cœur](30-modules-coeur.md) pour les autres composants prêts à l'emploi et leurs trois leviers de personnalisation ; [32 · CLI & configuration](32-cli-et-configuration.md) pour la table complète des clés racine et `lint.a11y`.
