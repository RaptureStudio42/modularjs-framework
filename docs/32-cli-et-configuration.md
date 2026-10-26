# 32 · CLI & configuration (mjs.config.json)

> 📚 Pas de chapitre de tuto interactif dédié (la ligne de commande et son fichier de configuration vivent hors de l'éditeur live) : cette page se suffit à elle-même. Les encarts 🎓 *Pour débutants* dépliables donnent l'explication pas-à-pas ; le corps de la page reste la référence dense.

Les chapitres précédents documentent le langage MJS côté client — composant, réactivité, événements… Celui-ci documente l'autre moitié, tout aussi nécessaire dès la première minute passée sur un projet : la commande `mjs` et le fichier `mjs.config.json` qui la configure.

## 1. Les commandes

| Commande | Ce qu'elle fait |
|---|---|
| `mjs init` | scaffolde `mjs.config.json` et la structure de départ du projet |
| `mjs build` | compile une fois et sort |
| `mjs dev` | watch + rechargement à chaud (serveur HTTP+WS sur `--port`, défaut 3939) |
| `mjs check` | vérifie la config et liste les composants détectés (compile réellement, comme `build`) |
| `mjs serve` | sert le rendu SSR/prérendu par requête (`render.routes`) — bloc `render` requis dans `mjs.config.json` (port 3000 par défaut) |
| `mjs ws` | lance le serveur temps réel (MJS-WS) — fichier d'entry `ws.server.mjs`/`ws.js`/`server/ws.js`… |
| `mjs serveur` | lance le serveur de jeu (MJS-Server, `mjsServer` + `app.game`) — fichier d'entry `serveur.server.mjs`/`serveur.js`/`server/serveur.js`… |

### `mjs init`

Scaffolde un projet MJS **autonome** — aucune dépendance à Rails/Sprockets ni à un autre framework, le dossier de sortie est servi tel quel par n'importe quel serveur statique. Elle crée, à la racine du projet, huit éléments :

- les dossiers `app/modularjs/`, `app/modularjs/styles/`, `app/modularjs/examples/` et `public/modularjs/` ;
- le fichier `mjs.config.json` de départ ;
- le composant d'exemple `app/modularjs/hello.mjs` (un compteur, `<script>` en Civet + `<style lang="scss">`) ;
- dans `app/modularjs/examples/` : `hello-world.mjs` (un composant de référence qui montre les cinq blocs d'un fichier `.mjs` dans l'ordre canonique, et affiche cette liste lui-même) et `README.md` (la convention énoncée en clair).

Le `mjs.config.json` écrit est celui-ci, mot pour mot :

```json
{
  "sourceDir": "app/modularjs",
  "outputDir": "public/modularjs",
  "manifestPath": "public/modularjs/bundle.js",
  "stylesheetsDir": "app/modularjs/styles",
  "lang": "fr",
  "defaultScriptLang": "civet"
}
```

> **Développement ou production ?** C'est la **commande** qui tranche, pas le fichier : `mjs build` construit en développement, `mjs build --prod` en production. `minify` ne fait que minifier : un projet peut vouloir un bundle compact **en développement** sans rien perdre pour autant — le panneau d'inspection, les cartes de source, `µ.debug` et tout ce que la console écrit (`µ.log`, `µinspect`, les avertissements) restent comme sans minification.

`mjs init` n'écrase **jamais** un fichier ou un dossier déjà présent : elle le saute et l'annonce (« ↪️ … (existe déjà) ») plutôt que d'écrire par-dessus. En fin de commande, elle affiche les prochaines étapes telles quelles :

```
Pour démarrer :
  npx mjs dev
  → http://127.0.0.1:3939

Inclure le HMR client dans votre HTML :
  <script src="http://127.0.0.1:3939/__mjs_hmr/client.js"></script>
  <script type="module" src="/modularjs/bundle.js"></script>
  <mjs-hello></mjs-hello>
```

### `mjs check`

Imprime d'abord les chemins résolus :

```
Source dir   : …
Output dir   : …
Manifest     : …
Stylesheets  : …
Default lang : …
```

puis compile **pour de vrai** — ce n'est **pas** une compilation à blanc : les fichiers sont écrits dans le dossier de sortie, exactement comme `mjs build`, et la commande le rappelle elle-même avant de lancer la compilation (« 'mjs check' compile réellement (comme 'build') — les fichiers … seront écrits/écrasés »). Elle liste ensuite les composants détectés (les 20 premiers, puis un compte des suivants), et sort avec le code **1** à la moindre erreur de compilation, **0** sinon.

C'est la porte d'entrée naturelle d'un pipeline d'intégration continue : un `mjs check` qui sort en 1 casse le pipeline sans qu'il soit besoin de lancer le moindre serveur.

### `mjs build`, `mjs dev`, `mjs serve`

- **`mjs build`** — compile une fois, écrit les fichiers, sort.
- **`mjs dev`** — watch + rechargement à chaud, serveur HTTP+WS sur le port `--port` (défaut **3939**). Un seul `mjs dev` à la fois par projet : le verrou `.mjs-dev.lock` est posé à la racine du projet (le dossier de `mjs.config.json`), même lancé depuis un sous-dossier. `--output`, `--manifest` et `--prod` valent aussi pour le prérendu relancé à chaque sauvegarde.
- **`mjs serve`** — sert le rendu SSR/prérendu par requête (`render.routes`), bloc `render` requis dans `mjs.config.json`, port `--port` (défaut **3000**). Un fichier compilé dont le nom porte l'empreinte du build (`mjs_core-<empreinte>.js`, `<nom>-<empreinte>.css`…) part avec `Cache-Control: public, max-age=31536000, immutable` : son contenu ne change jamais sous ce nom (l'empreinte, cinq caractères ou huit hexadécimaux, est vérifiée sur le contenu du fichier : un nom qui lui ressemble seulement, `photo-2024a.jpg` ou `facture-20241019.pdf`, n'est pas mis en cache pour un an ; `mjs dev` applique la même règle). Tout autre fichier du dossier de sortie — manifeste, carte `.map`, fichier posé à la main — part avec `no-cache`. Un hôte IPv6 (`dev.host: "::1"` ou `"::"`) est accepté. Avec `"outputDir": "."`, `mjs serve` garde la racine du projet comme `mjs dev` (voir plus bas) : ses fichiers privés ne sortent pas, les sorties du build si.

> 🛑 **Une commande mal tapée est refusée.** `mjs biuld`, `mjs serv`… sortent en erreur (**code 1**) sans rien construire, avec la commande la plus proche (`Vouliez-vous dire : mjs build ?`). Un `--root` qui n'existe pas, ou qui désigne un fichier, est refusé de même, en nommant la racine demandée.

> 🛑 **`mjs build` refuse de construire le vide.** Si la racine visée n'a ni `mjs.config.json` ni dossier source — ou si le dossier source existe mais ne contient pas un seul `.mjs` — la commande **sort en erreur (code 1) sans rien écrire**, en nommant le dossier qu'elle a cherché. C'est la protection du **manifeste** : un build sans source écrivait un `µ.paths = {}` par-dessus celui d'un site en place — plus un composant connu, page blanche — en annonçant « ✅ 2 fichiers écrits », code 0. Le cas se produit dès qu'on lance la commande depuis le mauvais dossier, ou qu'on oublie `--root`.

> 🛑 **Un composant qui ne compile pas fait échouer le build.** `mjs build` sort en **code 1** sans rien publier : `bundle.js` n'est pas réécrit, ni les feuilles de mise en page `<composant>.<nom>.css`, ni les fragments de traduction à nom clair (`i18n/<langue>/<section>.json`, en développement ou avec `i18n.hash: false`), ni le registre des variables de thème `.mjs-theme-vars.json` (sans `--prod`), et aucun des fichiers qu'il nomme n'est retiré — le site déjà construit dans ce dossier reste servi tel quel, celui du dernier build réussi, jusqu'à ce que l'erreur soit corrigée. Même règle quand le cœur lui-même ne se construit pas (fichier du runtime absent, `runtime` qui omet un module nécessaire…), en build comme avec `mjs dev` : aucun fichier n'est écrit avec un cœur manquant. `mjs dev`, lui, continue de servir la dernière version valide d'un composant en échec, avec un avertissement (overlay HMR) : le temps de corriger une faute de frappe, le reste du site reste utilisable. Une exception : quand le cœur change au même tour (un autre composant demande une fonction nouvelle), cette version importe l'ancien cœur, que le build retire — elle n'est plus servie, un avertissement le dit. `mjs serve` n'a pas ce filet : la compilation tourne AVANT l'ouverture du port, et la moindre erreur sort en code 1 sans jamais écouter — rien n'est servi tant que l'erreur n'est pas corrigée.

**`mjs dev` surveille le projet où qu'il soit rangé.** Seuls les fichiers et dossiers cachés **du projet** (`.brouillon.mjs`, `.cache/`), `node_modules/` et `.git` sont ignorés : un projet rangé sous un dossier dont le nom commence par un point ou contient `.git` (`~/.projets/app`, un dépôt `moi.github.io`) est surveillé comme un autre, fichiers réunis par le manifeste externe compris (un `vendor/` du projet). Le runtime installé sous `node_modules/` n'est pas surveillé. Par l'API, `await bundler.close()` arrête la surveillance lancée par `bundler.watch()` ; un second `watch()` sur la même instance est refusé tant que le premier n'est pas fermé.

**Un thème fautif ne retire pas les autres.** Un fichier `*.theme.mjs` qui ne compile pas (nom invalide, bloc manquant) est une erreur de construction qui nomme le fichier : `mjs build` échoue sans rien publier, `mjs dev` affiche l'erreur et continue de publier les thèmes du dernier tour réussi, le temps de corriger.

**`mjs dev` regroupe les rafales.** Des fichiers modifiés ensemble (rechercher-remplacer, changement de branche, formateur) donnent une seule reconstruction et un seul rechargement, pas un par fichier.

**`mjs dev` sert aussi la page du projet.** Sans bloc `render`, tout chemin qui n'est pas un fichier compilé (`urlPrefix`) est cherché dans la racine du projet (le dossier de `mjs.config.json`, ou `--root`) : `/` et tout chemin finissant par `/` servent l'`index.html` de ce dossier, sinon le fichier demandé, avec son type MIME. Ce qu'un navigateur charge sort de la racine — pages, feuilles, scripts (`.js`, modules `.mjs`), données (`.json` rangé dans un dossier, `.csv`, `.md`, `.txt`, `.xml`), cartes `.map`, sous-titres `.vtt`, images, polices, modèles 3D (`.glb`, `.gltf`), sons, vidéos, `.wasm`, `.pdf`… —, les secrets d'une appli voisine jamais. Jamais servis : un fichier ou un dossier caché (`.git`, `.env`…) ; les dossiers `config/`, `log/`, `logs/`, `tmp/`, `db/`, `storage/`, `node_modules/` à toute profondeur, `app/` et `server/` à la racine (sources de l'appli et du serveur) ; les fichiers serveur `*.server.*`, `mjs.config.json`, `package.json` et les fichiers de configuration voisins (`package-lock.json`, `tsconfig.json`, `composer.json`…) ; à la racine même, tout `.json` (`secrets.json`, `credentials.json`, un `manifest.json` aussi : rangez dans un dossier, `public/` par exemple, le JSON que la page charge) ; les entrées serveur : `ws.js` et `serveur.js` à la racine (cherchées par `mjs ws` et `mjs serveur`), `server.js` et `server.mjs` à la racine (l'entrée habituelle d'une appli Node) et, rangées n'importe où sous n'importe quel nom, les entrées déclarées par `ws.entry`, `serveur.entry` et `render.entry` ; les clés et certificats (`.key`, `.pem`, `.p12`…), la configuration (`.env`, `.yml`, `.toml`, `.ini`, `.lock`…), les sources serveur (`.rb`, `.php`, `.py`, `.ts`, `.cjs`, `.civet`…), les journaux, bases et sauvegardes (`.log`, `.sql`, `.sqlite`, `.bak`…) ; un fichier sans extension (`Gemfile`, `id_rsa`). Les noms se comparent comme les lit un disque macOS ou Windows, sans la casse et sans les points ou espaces de fin : `/Config/default.json` est refusé comme `/config/default.json`. Un lien symbolique qui sortirait de la racine, ou qui mènerait à un fichier refusé, répond 404. Un module serveur qui n'est pas une entrée déclarée reste servi s'il est rangé ailleurs que sous `server/` (`lib/db.mjs`, par exemple), comme une entrée passée seulement par `--entry` : rangez-les sous `server/`. Une page HTML servie ainsi reçoit le client de rechargement quand il est actif ; il se connecte en `wss:` quand son script est chargé en https (un tunnel, par exemple), en `ws:` sinon. Avec un bloc `render`, `render.routes` garde la main. La même garde vaut pour les fichiers compilés quand `outputDir` est la racine du projet elle-même (`"outputDir": "."`) : `/modularjs/secrets.json` est refusé comme `/secrets.json` ; un dossier de sortie dédié (`public/modularjs`, le défaut) reste servi tel quel. Les sorties que le build écrit lui-même y restent servies, reconnues à leur contenu : la liste de pré-cache `mjs-precache.json`, les fichiers de messages `mjs_err-<langue>-<empreinte>.json` et tout fichier dont l'empreinte est vérifiée, le manifeste et les feuilles marqués `/* @generated by ModularJS */`. `mjs serve` applique la même garde.

**Un dossier de sortie qui contient la racine du projet est refusé.** `"outputDir": ".."` (ou `--output` vers un dossier parent) ferait servir par `mjs dev` et `mjs serve` tout ce dossier, les fichiers privés d'une application voisine compris : `mjs build`, `mjs dev` et `mjs serve` s'arrêtent dès le départ, avant toute compilation, avec un message qui nomme le dossier. Donnez à `outputDir` un dossier dans le projet (`public/modularjs`, le défaut) ; la racine elle-même (`"outputDir": "."`) reste permise.

**`mjs dev` ne répond qu'à ses propres noms.** Une requête dont l'en-tête `Host` n'est ni `localhost` ou l'un de ses sous-domaines (`app.localhost`, toujours en boucle locale), ni `127.0.0.1`, ni `[::1]`, ni le nom de la machine (ou `<nom>.local`), ni l'hôte de `dev.host` répond **403**, sur toutes les routes : c'est la parade au rebinding DNS (une page web dont le nom bascule vers `127.0.0.1` pour lire votre serveur de développement). Avec `dev.host: "0.0.0.0"` (ou `"::"`), les adresses de la machine sont acceptées aussi : un téléphone du réseau local ouvre `http://192.168.x.x:3939`. Le client de rechargement se connecte alors par l'adresse que la page a utilisée, et sa connexion est acceptée — une page du réseau local n'est jamais acceptée tant que le serveur n'écoute qu'en local. Le rechargement à chaud et les formulaires (actions `.server.mjs`) acceptent la page dont l'origine est la même que l'en-tête `Host` reçu (la page servie par cette connexion, sous l'un de ces noms), et toute page locale : une origine `localhost` ou l'un de ses sous-domaines (`http://app.localhost:3939`), `127.0.0.1` ou `[::1]`, sur n'importe quel port (une autre appli de la machine), même derrière un proxy local qui réécrit `Host`. Le nom de la machine, `<nom>.local` et les adresses du réseau ne font pas une origine locale : dans `Host`, ils disent que la requête arrive ici ; dans l'origine d'une page, ils ne prouvent pas qu'elle vient d'ici (un nom du réseau local se contrefait). Une page servie sous ces noms est donc acceptée de même origine, pas depuis un autre port ni derrière un proxy qui réécrit `Host`.

**Un tunnel ou un proxy s'ouvre par `dev.allowedHosts`, qu'il garde l'en-tête `Host` ou qu'il le réécrive.** Un tunnel (`abc.ngrok-free.app`) ou un proxy de développement qui garde l'en-tête `Host` (Caddy, Traefik, conteneur) reçoit 403 tant que son nom n'est pas déclaré : `"dev": { "allowedHosts": ["abc.ngrok-free.app"] }`. Un nom qui commence par un point couvre ce domaine et ses sous-domaines (`[".ngrok-free.app"]`) ; `true` accepte tous les noms dans `Host` et lève donc la parade. Le 403 cite le nom refusé et la ligne à écrire. La page servie sous un nom déclaré, par un tunnel qui garde `Host`, est acceptée par le rechargement à chaud et par les formulaires (actions `.server.mjs`), même quand le serveur n'écoute qu'en local : son origine est la même que `Host`. Une page dont l'origine diffère de `Host` reste refusée, `true` compris : `true` accepte tous les noms dans `Host`, pas toutes les origines — sans quoi n'importe quel site ouvert dans votre navigateur pourrait écouter le rechargement et envoyer vos formulaires. Un tunnel qui réécrit `Host` en `localhost` (`ngrok http 3939 --host-header=rewrite`, par exemple) passe la garde `Host` sans rien déclarer, mais la page qu'il sert garde le nom du tunnel pour origine : déclarez ce nom **exact**, `"dev": { "allowedHosts": ["abc.ngrok-free.app"] }`. Derrière un `Host` réécrit, ni `true` ni une entrée `.domaine` n'admettent l'origine : sur un domaine partagé (`.ngrok-free.app`), l'entrée admettrait aussi la page de n'importe quel autre utilisateur de ce domaine ouverte dans votre navigateur, qui pourrait écouter le rechargement et envoyer vos formulaires. `mjs dev` refuse alors la page ; quand l'en-tête `Host` reçu est local (`localhost`, `127.0.0.1`, `[::1]` : un tunnel l'a réécrit) et qu'une entrée `.domaine` couvre l'origine, son terminal (comme la réponse 403 d'un formulaire) dit le nom exact à écrire — pour vingt noms au plus dans le terminal, puis une ligne dit que les refus suivants n'y sont plus affichés. Sous un `Host` gardé, la page d'un autre utilisateur du domaine reçoit un refus simple, sans nom à écrire. Le client de rechargement se connecte à l'adresse d'où son script est chargé : derrière un tunnel, il passe par le tunnel. `mjs serve` ne lit pas `dev.allowedHosts` : ses formulaires s'ouvrent à une autre origine par `render.allowedOrigins` ([21 · Navigation](21-navigation.md)). Une valeur d'une autre forme (chaîne seule, `http://…`, nom suivi d'un port) est refusée à la lecture de la configuration.


Le rendu piloté par la config (`render`, SSR, prérendu) est détaillé au chapitre [19 · SSR](19-ssr.md) — pas repris ici.

### `mjs ws` et `mjs serveur`

- **`mjs ws`** — lance le serveur temps réel (MJS-WS). Détail complet : [23 · MJS-WS](23-mjs-ws.md).
- **`mjs serveur`** — lance le serveur de jeu (MJS-Server, composé par-dessus MJS-WS). Détail complet : [24 · MJS-Server](24-mjs-server.md).

### Arrêter un serveur (Ctrl+C)

`mjs dev`, `mjs serve`, `mjs ws` et `mjs serveur` s'arrêtent proprement sur **Ctrl+C** (ou un `SIGTERM`) : la page ou la réponse en cours se termine d'abord, **20 s** au plus, puis le programme sort en code 0. Sans rien en cours, l'arrêt est immédiat.

- **Forcer l'arrêt** : un **2ᵉ Ctrl+C**, plus d'une seconde après le premier, coupe tout de suite sans attendre les réponses en cours. Quand l'arrêt dure, le terminal le rappelle : `arrêt en cours — Ctrl+C à nouveau pour couper tout de suite`.
- Un 2ᵉ Ctrl+C **dans la même seconde** est ignoré : c'est souvent le même Ctrl+C reçu deux fois (`npm run` le relaie à son programme, `tsx` aussi quand on lance depuis les sources). Sans cette seconde de tolérance, un seul Ctrl+C couperait les pages en cours.

**Rechargement de `mjs ws` et `mjs serveur`.** Le fichier d'entrée est surveillé : une modification relance le serveur. Le `setup()` de la nouvelle version tourne **avant** l'arrêt de l'ancienne : s'il jette (variable d'environnement manquante, faute), l'ancienne version reste en service et l'erreur est affichée. En production (`NODE_ENV=production`), le fichier d'entrée n'est pas surveillé : un déploiement redémarre le service. Sans `node_modules` dans le projet, les fichiers serveur compilés vont dans `mjs-server-cache-<uid>` du dossier temporaire, créé en `0700` ; un dossier de ce nom qui n'est pas à vous, qui est un lien ou que d'autres peuvent écrire est refusé.

`mjs ws` et `mjs serveur` acceptent en plus `--host <adresse>` (ou `ws.host`/`serveur.host` dans `mjs.config.json` selon la commande, `--host` prioritaire) — sans l'un ni l'autre, le transport écoute en local (`127.0.0.1`, MÊME défaut que le pont). Qui veut exposer le serveur le dit explicitement avec `--host ::`. `--port` (comme `ws.port`/`serveur.port`) est validé **entier 1-65535** : hors bornes, la commande sort en erreur avant même de tenter d'ouvrir le port.

### Drapeaux communs

| Drapeau | Rôle |
|---|---|
| `--root <dossier>` | racine du projet (défaut : répertoire courant) |
| `--manifest <chemin>` | chemin du bundle (point d'entrée), remplace `manifestPath` — mêmes refus : jamais un fichier source, ni, quand la construction écrit dans le dossier des sources, un fichier existant qui ne porte pas la marque des fichiers produits (code 1, rien n'est écrit) |
| `--output <chemin>` | répertoire de sortie des fichiers compilés, remplace `outputDir` |
| `--entry <chemin>` | fichier d'entry du serveur ws/serveur (`mjs ws`/`mjs serveur`), défauts propres à chaque commande |
| `--host <adresse>` | hôte d'écoute — `mjs ws`/`mjs serveur` (défaut `127.0.0.1`, `--host ::` pour toutes les interfaces) |
| `--port <n>` | port du serveur — `mjs dev` (3939), `mjs serve` (3000), `mjs ws` (4000), `mjs serveur` (4001) |
| `--once` | force la commande sur `build` (compile et sort) |
| `--dev` | build de **développement** — panneau d'inspection embarqué, non minifié (sauf `"minify": true`), cartes de source (c'est le défaut) |
| `--prod` | build de **production** — minifié (sauf `"minify": false`), fragments i18n hachés, aucun outil de développement |
| `-v`, `--version` | affiche la version du paquet mjs (`mjs <version>`) et sort — répond depuis n'importe quel dossier, sans config ni projet |
| `-h`, `--help` | affiche l'aide et sort |

`mjs build`, `mjs check`, `mjs dev` et `mjs serve` annoncent en clair le mode retenu et d'où il vient — c'est cette ligne qu'on relit dans un journal de déploiement pour vérifier qu'on a bien construit ce qu'on croit.

### Sur ma machine, en développement ; sur le serveur, en production

**Un build est en développement, sauf si on demande le contraire.** Non minifié, panneau d'inspection embarqué, cartes de source, fragments i18n aux noms lisibles : c'est ce qu'on veut sur son poste, et c'est ce qu'on obtient sans rien configurer. Avec `"minify": true`, le fichier est minifié, et rien d'autre ne change.

Le **serveur**, lui, ne se devine pas. Le framework ne regarde ni le nom d'hôte, ni le port, ni l'adresse, ni aucune variable d'environnement : `mjs build` lancé par un script de déploiement sur un shell non interactif produit exactement ce qu'il produit sur un portable. **C'est au script de déploiement de le dire**, et il n'y a qu'une façon :

```bash
mjs build --prod
```

Une seule ligne, dans un seul fichier — celui qui déploie. Rien de versionné ne peut se tromper de machine, et aucune variable héritée d'un shell ne peut basculer un build sans qu'on l'ait demandé.

> ⚠️ Sans `--prod`, le déploiement pousse un build de développement en ligne : bundle non minifié (minifié avec `"minify": true`, le reste ne change pas), `window.µ` exposé, panneau d'inspection livré aux visiteurs, et **fragments i18n non hachés** — donc servis depuis le cache des navigateurs après une correction de traduction. Le bandeau imprimé par `mjs build` (« 🛠️ Build de DÉVELOPPEMENT… ») l'écrit noir sur blanc dans le journal de déploiement : c'est la ligne à relire en cas de doute.

Cette indifférence à l'environnement ne vaut que pour le CHOIX DU BUILD (minification, panneau d'inspection embarqué) — la garde des routes de développement, décrite juste en dessous, accepte elle aussi `NODE_ENV=production` comme signal, en plus de `--prod`.

Les routes de développement que `mjs dev`/`mjs serve` exposent — l'atelier de variables de thème (`GET /__mjs/theme`, [34 · Déboguer](34-deboguer.md) §3) et le journal d'erreurs (`GET /__mjs/errors`, [19 · SSR](19-ssr.md) § *Journal d'erreurs*) — suivent une garde complémentaire : ces routes sont fermées dès que la commande tourne avec `--prod`, et aussi quand `NODE_ENV=production` est posé, même sans `--prod`. Ces deux pages appellent des fonctions du cœur (crochets de vie, blocs `{if}` et `{for}`, mutations profondes) : si votre cœur est nu (`"runtime": "core"`), la page de la visionneuse les apporte elle-même, celles que votre cœur n'a pas, sans rien ajouter à votre cœur ni à son poids.

## 2. Le fichier `mjs.config.json`

Toutes les clés sont optionnelles ; les chemins qu'elles contiennent sont résolus relativement au dossier qui contient `mjs.config.json`, et les défauts des clés absentes aussi, même quand `mjs` est lancé depuis un sous-dossier du projet (sans `mjs.config.json`, ils partent du dossier courant). Trente-sept clés racine sont reconnues :

| Clé | Type | Défaut | Rôle |
|---|---|---|---|
| `sourceDir` | chaîne | `app/modularjs` | dossier des sources `.mjs` |
| `outputDir` | chaîne | `public/modularjs` | dossier de sortie des fichiers compilés |
| `manifestPath` | chaîne | `public/modularjs/bundle.js` | chemin du point d'entrée du bundle (le fichier chargé par la page), écrit à chaque construction — jamais un fichier source : un nom en `.mjs`, `.civet` ou `.coffee`, le fichier de `manifestExternal`, ou un chemin dans `sourceDir` quand `outputDir` n'y est pas, sont refusés, y compris par un lien symbolique ou, sur macOS et Windows, par une autre casse ; quand `outputDir` est dans `sourceDir`, le manifeste peut y être, mais un fichier qui existe déjà n'y est remplacé que s'il porte la marque des fichiers produits (première ligne `/* @generated by ModularJS */`) ou s'il est le manifeste d'une construction par la 2.5.0 — sinon la construction s'arrête avant d'écrire quoi que ce soit ; hors du dossier des sources, un fichier qui existe déjà n'est remplacé que s'il est reconnu comme un manifeste ModularJS, celui d'une construction précédente (de cette version ou de la 2.5.0, fichier unique compris) : un fichier à vous (`app/assets/javascripts/application.js`, par exemple) arrête la construction de la même façon, intact ; dans les sources comme dehors, un fichier vide (0 octet) à cet emplacement est remplacé sans refus : il n'a rien à perdre ; ce contrôle est fait à la construction, jamais à la lecture de la configuration (`mjs ws`, `mjs serveur` démarrent) ; le drapeau `--manifest` passe par la même garde, et `new Bundler()` appelé par l'API aussi : la construction s'arrête avant toute écriture, par une erreur qui nomme le chemin |
| `manifestExternal` | chaîne | `app/modularjs/manifest.civet` s'il existe, sinon `app/modularjs/manifest.coffee` | manifeste externe façon Sprockets (`#= require`, `require_dir`, `require_tree`) pour bundler du JS/Coffee/Civet hors composants |
| `urlPrefix` | chaîne | dérivé de `outputDir` — détail plus bas | préfixe URL public des fichiers émis |
| `defaultScriptLang` | `'civet'` \| `'coffee'` \| `'ts'` \| `'js'` | `civet` | langage par défaut des `<script>` sans `lang=` |
| `languages` | objet `{ script?, template? }` | aucun propre — `script` retombe sur `defaultScriptLang`, `template` sur `civet` | forme à deux axes qui remplace progressivement `defaultScriptLang` — [2 · Anatomie d'un composant](02-composant.md) |
| `minify` | booléen \| `'auto'` | `auto` | minification **seule** : `auto` suit le mode du build, `true` minifie même en développement (noms et espaces raccourcis, rien de retiré : les outils de débogage et la console restent), `false` ne minifie jamais — même en production. Ne décide pas de l'environnement : ça, c'est `--prod`. Le bandeau de `mjs build` dit si le fichier est minifié |
| `dev` | objet `{ port?, host?, allowedHosts? }` | aucun propre — `port` : 3939 en `mjs dev`, 3000 en `mjs serve` ; `host` : `127.0.0.1` | port/hôte du serveur de développement ; un `host` vide est refusé (le serveur écouterait sur toutes les adresses de la machine) ; `allowedHosts` : noms d'hôte acceptés en plus des siens dans l'en-tête `Host` (liste, `.domaine` pour ce domaine et ses sous-domaines, ou `true` pour tous) ; une page dont l'origine diffère de `Host` (derrière un tunnel qui le réécrit) n'est admise que par son nom exact — ni `.domaine` ni `true` n'ouvrent une origine, cf. « `mjs dev` ne répond qu'à ses propres noms » et « Un tunnel ou un proxy s'ouvre par `dev.allowedHosts` » |
| `stylesheetsDir` | chaîne | `app/modularjs/styles` | dossier des feuilles de style partagées — détail plus bas |
| `assetDirs` | liste de chaînes | aucune | dossiers d'images **en plus** de `sourceDir` : `µimage`, `µasset` et `<@@img>` y cherchent une image que `sourceDir` ne porte pas — détail plus bas |
| `runtimeDir` | chaîne | aucun (auto-détecté) | dossier du runtime du framework — détail plus bas |
| `sigil` | `'µ'` \| `'mjs'` | `µ` | symbole d'API tapé dans la source — [2 · Anatomie d'un composant](02-composant.md) |
| `contextAlias` | booléen | `false` | alias ASCII `__context`/`__shared` pour `§`/`§§` — [13 · Contexte](13-contexte.md) |
| `render` | objet | aucun (bloc absent = pas de rendu piloté par la config) | rendu par URL — [19 · SSR](19-ssr.md) |
| `render.startup` | `'preload'` \| `'bundle'` \| `'none'` | `'preload'` | ce qu'une page prérendue charge au démarrage — cf. [`render.startup`](#renderstartup) |
| `preload` | chaîne \| objet `{ view?, page? }` | `view: 'hover'`, `page: 'off'` | préchargement des liens — [17 · Router](17-router.md) |
| `viewTransition` | chaîne | `none` (désactivé) | transition de page par défaut — [17 · Router](17-router.md) |
| `lint` | objet — un type par avertissement de build, cf. la table plus bas | tout `true` (rien ne change sans config) | coupe individuellement chaque type d'avertissement de compilation — cf. § *Le bloc `lint`* |
| `types` | `'warn'` \| `'error'` | `'warn'` | ce que dit, en DÉVELOPPEMENT, une valeur ramenée dans sa plage ou refusée par une règle d'un bloc `<vars>` : un avertissement (le code continue) ou une erreur à la ligne qui écrit (la fonction s'arrête). En production, rien ne s'affiche — [37 · Types et valeurs permises](37-types.md) |
| `effects` | objet | — | les effets que MJS pose de lui-même. `theme` : une bascule de thème (`µtheme = 'dark'`) qui suit un clic s'ouvre en cercle depuis le point cliqué (`"circle"`, défaut) ou se fait d'un coup (`"none"`). `lite` : sur un appareil qui peine, les effets lourds (particules, fumée…) se calment d'eux-mêmes (`"auto"`, défaut), tout le temps (`"on"`) ou jamais (`"off"`). `skeleton` : ce qui montre un squelette gris en attendant — `"await"` (un `{await}` sans branche d'attente), `"components"` (un composant dont le code arrive) ; défaut `["await"]`, `[]` : rien. Les barres des textes traduits ne sont plus ici : `i18n.placeholder` et `i18n.timeout`. `guard` : un champ lié à une variable typée (`<input value=!{$age}>`) reçoit `*guard` d'office — la frappe hors de la règle retenue, une bulle qui dit ce qui est permis après une pause d'une seconde, la valeur ramenée à la sortie du champ (`true`, défaut) ; `{ "delay": "1.5s" }` : la pause de tous les champs gardés (un nombre de millisecondes, ou `"800ms"`, `"1.5s"`, au plus 24 h (86 400 000 ms), par le fichier comme par l'API `new Bundler({ … })`) ; `false` : ces champs-là sans secousse ni bulle, la frappe toujours à l'abri. `rate` : la part du débit des effets en direct (`*follow`, `*cursors`, `*heatmap`), en messages par seconde, à eux tous sur une connexion — `4` par défaut (un entier de 1 à 1000) ; le serveur MJS WS en permet 40 à un visiteur, le reste est pour l'appli — [38 · Effets](38-effets.md), [37 · Types](37-types.md) |
| `runtime` | `'all'` \| `'core'` \| tableau de chaînes | `all` | sélection des modules runtime embarqués au bundle — [22 · Aide-mémoire](22-aide-memoire.md). **Une application qui traduit (`µt`, `@i18n`) exige `i18n`** : un `runtime` en liste sans `"i18n"`, ou `"core"`, fait échouer la construction (`mjs build`, `mjs dev`, `mjs check`) avec le texte à écrire, par exemple `"runtime": ["hydrate", "i18n"]`. `"i18n"` embarque avec lui le magasin global (`vault`, le `$$`) dont dépend `µlang` — la langue voulue (`?lang=`, préférence mémorisée, navigateur) et la bascule du démarrage : inutile de l'ajouter à la liste. Le magasin vient avec ce qu'il porte : `µtheme` (l'attribut `data-mjs-theme` sur `<html>`, réglé sur le thème du système), `µ.online`, `µ.visible`, `µ.ready`, et la relecture des balises `#__mjs_store` et `#__mjs_res` (un rendu serveur en écrit la langue dans `#__mjs_store`). Une application qui ne traduit aucune page n'est pas concernée. Une liste qui ne cite que des effets ou des outils d'effets (`["fx_neon"]`, `["fx_toolup"]`) les ajoute au cœur sans rien retirer : routeur, liens, requêtes et modale restent |
| `css` | `'bundle'` \| `'split'` \| `'lazy'` | `bundle` | comment les feuilles partagées (`stylesheetsDir`) voyagent : `bundle` = un seul fichier pour toutes, chargé avec le manifeste ; `split` = un fichier par feuille, importé par le JavaScript des modules qui la déclarent (`@css`) ; `lazy` = un vrai `.css` par feuille, demandé au montage du premier composant qui la déclare et mis en cache par URL. Détail et critères de choix : [2 · Composant](02-composant.md) |
| `js` | `'split'` \| `'bundle'` | `split` | comment le cœur, les composants et les modules voyagent : `split` = un fichier haché par unité ; `bundle` = TOUT (cœur, styles, animations, manifeste externe, modules, composants) fusionné dans le seul fichier `manifestPath` — une requête JS au lieu d'une cascade. Exige `css: 'bundle'` — cf. `js` plus bas |
| `image` | objet `{ widths?, formats?, quality? }` | aucun propre — cf. `image` plus bas | politique des variantes produites par `µimage` — [35 · Images](35-images.md) |
| `ws` | objet | aucun | démarrage de `mjs ws` — [23 · MJS-WS](23-mjs-ws.md) |
| `serveur` | objet | aucun | démarrage de `mjs serveur` — [24 · MJS-Server](24-mjs-server.md) |
| `i18n` | objet | aucun (dossier `i18n/` absent ⇒ désactivé) | traduction — [29 · i18n](29-i18n.md) ; `i18n.timeout` : le délai de secours de l'attente des textes (3 s par défaut ; un nombre de millisecondes, ou `"800ms"`, `"1.5s"`, au plus 2 147 483 647 ms — le plafond d'une minuterie, par le fichier comme par l'API `new Bundler({ … })`) ; `i18n.source` (chaîne, facultative) active le contrôle d'empreinte des traductions — [29 · i18n](29-i18n.md#empreinte) |
| `lang` | chaîne | `fr` | langue des messages CLI/compilateur (`fr`, `en` ; toute autre valeur retombe sur `fr`) |
| `journal` | objet | aucun bloc — défauts internes `server: true`, `client: false`, `viewer: true`, `maxDays: 30` | journal d'erreurs à 3 étages — [19 · SSR](19-ssr.md) § *Journal d'erreurs* |
| `varPrefix` | chaîne | `mjs` | préfixe des variables de thème — [31 · Thèmes](31-themes.md) |
| `defaultTheme` | chaîne | `light` | thème qui vaut sans attribut — [31 · Thèmes](31-themes.md) |
| `csp` | booléen | `false` | compatibilité avec une politique de sécurité de contenu stricte : plus aucun `<style>` ni `<script>` en ligne dans ce que MJS écrit — cf. `csp` plus bas |
| `sourceMap` | `'never'` \| `'dev'` \| `'prod'` \| `'always'` | `dev` | quand émettre les cartes de source, qui font retomber un point d'arrêt sur la ligne du `.mjs` — cf. `sourceMap` plus bas |
| `prune` | booléen | `true` | après un `mjs build` sans erreur, retire d'`outputDir` les fichiers qu'un build a écrits et qu'aucun ne produit plus (composant renommé ou supprimé), jamais un fichier à vous — cf. `prune` plus bas |
| `bundles` | objet `{ "<nom>": ["<composant racine>", …] }` ou `{ "<nom>": { "roots": [...], "except": [...] } }` | aucun groupe | rassemble des composants, en production, en un seul fichier par groupe — cf. `bundles` plus bas |
| `logLevel` | chaîne \| objet `{ dev?, prod? }` | dev `log`, prod `error` | niveau de la console — navigateur ET build, réglés ensemble (côté build : ce que le minifieur retire du bundle et les avertissements de construction du terminal, pas les lignes écrites à la lecture de la configuration ou à la compilation d'un composant) — cf. `logLevel` plus bas |
| `messages` | `'demand'` \| `'idle'` | `demand` | quand télécharger, en production, le fichier des messages du framework : `demand` = au premier message écrit, `idle` = d'avance, page au repos — [29 · i18n](29-i18n.md) § *Messages de la console en production* |

Quelques clés méritent un mot de plus.

### `urlPrefix`

Préfixe URL public sous lequel les fichiers compilés sont servis (`<script src="{urlPrefix}/bundle.js">`). Absent, il est **dérivé** de `outputDir` (`deriveUrlPrefix`, `src/bundler/index.ts`) selon la convention « la plupart des hébergements servent leur racine documentaire depuis un dossier `public/` » :

| `outputDir` | `urlPrefix` dérivé |
|---|---|
| `public/modularjs` | `/modularjs` |
| `public/assets/X` | `/assets/X` |
| `public` | aucun préfixe (le dossier de sortie est la racine servie) |
| `dist` | `/dist` (convention non respectée, mais accepté quand même) |

Un `outputDir` **absolu** suit la même logique en cherchant `/public/` dans le chemin (ex. `/var/www/monapp/public/modularjs` → `/modularjs`) ; un chemin absolu qui ne contient `public/` nulle part retombe sur son seul nom de dossier final ; un chemin qui finit par `public` (`/var/www/monapp/public`) ne donne aucun préfixe. `"urlPrefix": "/"` (dossier servi à la racine) donne aussi des URL sans préfixe, `/a-<empreinte>.js` — par `mjs.config.json` comme en passant l'option au `Bundler`. Passée au `Bundler`, une adresse d'un autre hôte (un CDN) est publiée telle quelle, sans ses slashs finaux : avec son schéma (`urlPrefix: 'https://cdn.example.com/m'`) comme sans (`'//cdn.example.com/m'`, adresse protocole-relative).

### `stylesheetsDir`

Dossier des feuilles de style **partagées** — celles que l'attribut `@css="nom"` du `<style>` de base va chercher depuis un composant, par opposition au `<style>` scopé d'un `.mjs`, propre à ce seul composant. Défaut `app/modularjs/styles`.

En `css: "split"` ou `"lazy"`, une feuille nommée `root` (`root.scss`) cohabite avec la feuille racine `mjs_root` : chacune a son fichier.

### `manifestExternal`

Le manifeste externe réunit des fichiers par `#= require`, `#= require_dir` et `#= require_tree`, chemins relatifs au fichier qui les écrit. Viser hors de `sourceDir` est permis (un `vendor/` du projet), hors du projet non : un fichier dont le chemin réel (liens suivis) n'est ni sous le dossier de `mjs.config.json` (même quand la commande est lancée d'un sous-dossier du projet), ni sous le dossier parent de `sourceDir`, ni sous le dossier du manifeste arrête la construction, avec une erreur qui nomme la directive et le fichier visé. `require_tree` parcourt chaque dossier réel une fois : un lien vers le dossier lui-même ou vers un parent ne fait pas boucler la construction, et un fichier vu par deux chemins n'est réuni qu'une fois.

### Noms des modules `.civet` et `.coffee`

Le nom de fichier d'un module devient son adresse publiée (`<nom>-<empreinte>.js`) : lettres (accents compris), chiffres, `_`, `.` et `-` seulement, et jamais le préfixe `mjs_`, réservé aux fichiers du framework (`mjs_core`…). Un autre nom (`outil#2.civet`, `mon outil.civet`, `mjs_core.civet`) arrête la construction, avec une erreur qui nomme le fichier ; un composant qui l'importe échoue sur la même erreur. Un module ne porte pas non plus le nom d'un composant (`cart.civet` et `cart.mjs`, même dans deux dossiers) : les deux publieraient le même fichier et le composant ne serait jamais écrit — la construction s'arrête, avec une erreur qui nomme les deux fichiers ; renommez l'un des deux (`cart-logique.civet`).

### Les dictionnaires `i18n/`

Chaque fichier racine (`i18n/fr.yml`) et chaque dossier de sections (`i18n/fr/`) porte un nom de langue : `fr`, `en`, `pt-BR`, `zh_Hant`, `reel-fr`… (la forme d'une étiquette de langue : un premier sous-libellé de 2 à 8 lettres, puis des lettres et des chiffres après `-` ou `_`). Un nom d'une autre forme (`i18n/__proto__/`, `i18n/mes notes.yml`, `i18n/v1.0.yml`) arrête la construction, avec une erreur qui nomme le chemin. Un fichier de traduction contient un dictionnaire de clés : un YAML vide vaut un dictionnaire vide, un `null` JSON, une liste, un nombre ou un texte seul sont refusés avec le chemin du fichier. Un fragment de section modifié est réécrit au build suivant même quand son nom ne change pas (développement, ou `i18n.hash: false`). Le reste : [29 · i18n](29-i18n.md).

### `assetDirs`

Liste de dossiers d'images **en plus** de `sourceDir` : quand `sourceDir` ne porte pas une image citée par `µimage`, `µasset` (ou ses alias) ou `<@@img>`, le build la cherche dans ces dossiers, dans l'ordre. Chaque chemin est relatif au dossier de `mjs.config.json` et le dossier doit exister ; une valeur qui n'est pas une liste de chaînes, ou un dossier absent, fait refuser la configuration, avec un message qui nomme la clé et la valeur. Défaut : aucune liste, seul `sourceDir` est cherché. Exemple pour Rails, dont le pipeline d'assets garde ses images dans `app/assets/images` :

```json
{
  "sourceDir": "app/assets/modularJS",
  "assetDirs": ["app/assets/images"]
}
```

L'ordre de recherche, le doublon (un même nom dans deux dossiers), le comportement de `mjs dev` et la limite à connaître (une image montrée par une vue Rails ET par un composant sur la même page est téléchargée deux fois) : [35 · Images](35-images.md#des-images-rangées-ailleurs-assetdirs).

### `runtimeDir`

Dossier où trouver le runtime du framework (les fichiers `mjs_*` du cœur), si différent de l'emplacement auto-détecté (`Bundler.locateRuntimeDir`). Un projet qui consomme le paquet npm n'a normalement jamais besoin de le poser : le défaut suit l'installation.

### Le bloc `lint`

Chaque avertissement de compilation appartient à un **type**, et sa ligne se termine par une étiquette `[lint.<type>]`. Cette étiquette dit à la fois ce qui a déclenché la ligne et comment la faire taire : couper un type, c'est poser `"lint": { "<type>": false }` dans `mjs.config.json`. Tous les types valent `true` par défaut — rien ne change tant que rien n'est posé dans `mjs.config.json`. Un avertissement cite la ligne du fichier quand elle est sûre (chaque avertissement `syntax` du HTML en cite une) ; il n'en cite aucune pour une faute venue d'un partiel inclus, ni quand le compilateur a ajouté des lignes au script.

Trois gravités, visibles à la couleur du terminal :

- **erreur** (rouge) — fait échouer le build. Jamais un type de la table ci-dessous, jamais désactivable : seule sa couleur change — sauf `emptyComponent`, qu'on peut changer en erreur (plus bas).
- **avertissement** (jaune) — un défaut probable ou réel de l'application.
- **info** (cyan) — un rappel, sans défaut à corriger.

| type | gravité | ce que ça signale |
|---|---|---|
| `a11y` | avertissement | contrôle d'accessibilité — cf. `lint.a11y` plus bas |
| `ujsForm` | avertissement | `<form>` sans `action` ni méthode — cf. `lint.ujsForm` plus bas |
| `maxStateVars` | info | trop de variables d'état dans un composant — cf. `lint.maxStateVars` plus bas (reste un entier, `0` coupe) |
| `themeShared` | info | une variable de thème `$$x` déclarée par plusieurs composants — rappel qu'elle cascade, le partage est parfois voulu |
| `themeUnknown` | avertissement | une variable de thème `$$x` lue mais déclarée nulle part — faute de frappe probable |
| `runtimeHint` | info | un module runtime sélectionné dont le partenaire habituel manque (ex. `ujs` sans `router` : l'interception reste posée mais inerte) |
| `runtimeModule` | avertissement | une entrée de `runtime[]` ignorée — nom inconnu, ou préréglage pas encore implémenté |
| `i18n` | avertissement | dossier `i18n/` absent, `i18n.default` sans dictionnaire correspondant, sceau de contrôle d'empreinte manquant ou périmé, traduction en retard sur sa source — [29 · i18n](29-i18n.md) |
| `cssSplit` | info | une feuille de style partagée (`css: 'split'`/`'lazy'`) compilée mais jamais réclamée par un module ni une vue |
| `cssTrap` | avertissement | `@font-face`/`@import` dans le CSS compilé d'un composant — piège Shadow DOM, aucun des deux ne fonctionne dans une feuille construite |
| `collision` | avertissement | deux fichiers distincts publient la même clé de manifeste (basename ou balise) — le second écrase le premier ; deux effets d'une même balise dessinent dans le même pseudo-élément (`::before`, `::after`) — un seul apparaît |
| `tagAlias` | avertissement | un alias `<mjs-nom>` ambigu entre plusieurs sources, une balise de développement inconnue, ou la balise d'un composant du projet écrite sans préfixe (`<nom>` au lieu de `<mjs-nom>` ou `<@nom>`) |
| `animation` | avertissement | une animation citée par `µ.anim.nom` dans un script, que ni la bibliothèque ni un `µanim.create` ne définit — faute de frappe probable ; posée par `@in`, `@out` ou `@transition`, c'est une erreur de construction ([10 · Transitions](10-transitions.md)) |
| `componentFailure` | avertissement | un composant qui échoue à compiler — repêché (dev/serve) ou non (build) |
| `precache` | avertissement | `mjs-precache.json` n'a pas pu être écrit (le build reste valide) |
| `prerender` | avertissement | avertissement du RENDU pendant le prérendu du build (`render.routes` en mode `prerender`) — store non stabilisé, prop invalide… |
| `image` | avertissement | le paquet `sharp` (dépendance optionnelle) est absent : `µimage` garde l'image d'origine, sans variante générée ; ou une image citée existe sous le même nom dans deux des dossiers de `sourceDir` et `assetDirs` (la première de l'ordre de recherche sert) |
| `require` | avertissement | un `#= require`/`require_tree` (manifeste externe) introuvable sur le disque |
| `include` | avertissement | `<@include name>` compilé sans chemin de fichier connu (baseDir absent) : le partial ne peut pas être résolu |
| `routes` | avertissement | le `<script>` d'un composant réassigne `@routes` alors qu'un bloc `<routes>` existe déjà — la table déclarative est remplacée |
| `syntax` | avertissement | HTML du composant mal formé mais récupéré — balise refermée par une autre, jeton de bloc (`{end}`…) en trop, `#{ … }` dans une valeur d'attribut (le `#` s'affiche tel quel) ; une ligne `# …` hors du `<script>` (pas un commentaire : elle s'affiche à l'écran — un commentaire HTML s'écrit `<!-- … -->` ; un `#` seul sur sa ligne, `#1`, un `<pre>`, un `<code>` et un bloc `<@@code>` ne préviennent pas) ; `disabled="false"` et tout attribut booléen écrit à `"false"` (sa seule présence vaut vrai, règle du HTML : retirez-le, ou `disabled={false}`) |
| `reactivity` | avertissement | réactivité à risque — `µeffect` qui lit et écrit la même variable, cycle entre dérivés, dépendances impossibles à analyser (la vue ne suivra pas), `@this` lié à une variable `$` réactive, une fonction importée d'un module `.js` (copié tel quel) qui écrit directement dans le magasin `$$x` (ou le chemin dedans) qu'elle reçoit en argument — l'écriture change la valeur sans rien redessiner ; une fonction qui ne fait que lire, ou qui passe son paramètre à une autre fonction, n'est pas signalée ([14 · Stores](14-stores.md)) |
| `naming` | avertissement | une variable d'état qui commence par `_mjs_`, préfixe réservé au framework ; `@title = …`, `@id = …`, `@hidden = …`… en tête du `<script>` : c'est une propriété de la balise du composant, pas une donnée (cf. [18 · Pièges](18-pieges.md) § 11) |
| `events` | avertissement | `µemit 'x', e` qui relaie l'événement reçu au lieu de sa charge (le parent lira `e.data` sur le mauvais objet) ; une méthode du composant citée sans `@` dans un gestionnaire (`@click={envoyer}` alors que seul `@envoyer` existe : au clic, rien ne se passerait) |
| `legacy` | avertissement | forme retirée ou dépréciée — `@onUrlChange = ->` (remplacé par la rune `µurlChange`), source CoffeeScript, variable de thème d'un effet fondu dans un autre (`$$shimmer-color` → `$$shine-ink`, cf. [38 · Effets](38-effets.md)) |
| `config` | avertissement | réglage de `mjs.config.json` accepté mais sans effet ou risqué — hôte interne dans `render.forwardOrigin.trustedHosts`, `light` sur une route `csr` |
| `emptyComponent` | avertissement | un composant sans HTML (script ou style seuls, ou un commentaire) : il ne rend rien — `"error"` en fait une erreur de build |
| `unreachable` | avertissement | du code qui suit, dans le même bloc, un `return`, un `throw`, un `break` ou un `continue` : il ne s'exécutera jamais, et la construction de production le retire sans le dire. La ligne citée est celle du fichier source — `<script>`, `<script module>`, gestionnaire en ligne, module `.civet` ou `.coffee` importé. Ne sont pas lus : un `<script lang="js">` et les gestionnaires de `<@window>` et de `<@document>`. Une fonction déclarée plus bas (`function nom()`, remontée en tête) et la suite d'un autre bloc (`return if …`, puis le reste) ne sont pas signalées |

Exemple — un projet qui a des variables de thème partagées entre plusieurs composants, en connaissance de cause, et qui n'a plus besoin du rappel :

```json
{
  "lint": { "themeShared": false }
}
```

Un composant sans HTML peut faire échouer le build : `emptyComponent` est le seul type qui accepte aussi la valeur `"error"`.

```json
{
  "lint": { "emptyComponent": "error" }
}
```

Une clé inconnue dans `lint` (faute de frappe sur un nom de type) fait échouer le build comme toute clé inconnue de `mjs.config.json` — cf. § *Validation stricte*.

**Où les voir.** `mjs build` et `mjs check` finissent par le même bilan, suivi d'une ligne d'aide (« Pour couper un type… ») dès qu'une ligne étiquetée est sortie. `mjs dev` affiche les avertissements imprimés pendant la compilation (accessibilité, syntaxe, réactivité…), et ce bilan une fois, au démarrage ; les recompilations suivantes ne le répètent pas.

**Couleurs du terminal.** Les lignes ci-dessus sont colorées selon leur gravité (erreur en rouge, avertissement en jaune, info en cyan), l'étiquette `[lint.<type>]` en grisé. `stats.warnings` (consommé par les outils/tests) reste toujours du texte brut, sans couleur : elle ne s'ajoute qu'à l'impression dans le terminal. Mêmes règles que la console de Node : la variable d'environnement `FORCE_COLOR` tranche d'abord — vide, `1`, `2`, `3` ou `true` les allument, toute autre valeur (`0`, `false`) les éteint ; sinon `NO_COLOR` (non vide) et `TERM=dumb` les éteignent ; sinon elles ne s'allument que si la sortie est un vrai terminal — un build redirigé vers un fichier ou un pipe n'en reçoit donc aucune par défaut.

### `lint.maxStateVars`

Plafond d'alerte sur le nombre de variables d'état (`$x`) distinctes déclarées dans **un seul** composant. Défaut réel **40** (`src/transpiler/index.ts`, étalonnage constaté : modules sains 5-20 variables, monolithe pathologique observé à 182). `0` désactive le lint. Au-delà du seuil : un **avertissement** au build, jamais une erreur — un signal d'architecture, rien d'incorrect à l'exécution.

### `lint.a11y`

Contrôles d'accessibilité sur le HTML, **activés par défaut** (`true`). Comme le lint précédent : de simples **avertissements** au build, jamais une erreur. Sept contrôles, choisis pour ne parler que quand c'est vraiment un problème :

| ce qui est signalé | pourquoi |
| --- | --- |
| `<img>` sans `alt` sous aucune forme | une image sans alternative est muette pour un lecteur d'écran — `alt=""` est valide et ne dit rien (image décorative) |
| `<iframe>` sans `title` | rien n'annonce ce que contient le cadre |
| `tabindex` positif (`1` et plus) | casse l'ordre de tabulation de la page ; `0` et `-1` sont légitimes |
| `@click` sur `div`, `span`, `li`, `p`, `section`… sans `role` ni `tabindex` | ce qui se clique à la souris ne s'atteint ni au clavier ni au lecteur d'écran |
| `<button>` sans nom accessible | le bouton-icône : rien que du graphique dedans, ni `aria-label`, ni `aria-labelledby`, ni `title` |
| `<a>` sans nom accessible | même cas |
| champ de saisie sans étiquette | `<input>`, `<select>`, `<textarea>` sans `aria-label`/`aria-labelledby`/`title`, et sans `<label>` qui les désigne (son `for` est l'`id` du champ à la lettre près, majuscules comprises : le navigateur ne relie pas `for="Nom"` à `id="nom"`) — le premier champ qu'enveloppe un `<@@field label="…">` au libellé non vide compte comme nommé ; un second champ dans le même `<@@field>` garde son alerte ; un champ hors d'atteinte (`aria-hidden="true"` et un `tabindex` négatif écrits tous les deux sur le champ, comme le champ piège d'un formulaire contre les robots) n'en demande aucune ; les attributs sont lus comme le navigateur les lit (avec ou sans guillemets, `tabindex` comme un nombre entier), et un nom écrit dans la valeur d'un autre attribut ne compte pas |

Deux garde-fous volontaires, pour que le contrôle reste crédible :

- Les blocs `<pre>` sont ignorés entièrement, et les `<code>` ne sont pas inspectés comme du markup — une page qui **montre** du HTML dans ses exemples n'est pas punie pour ça. Le texte d'un `<code>` compte en revanche comme texte visible : `<a href="…"><code>&lt;@view&gt;</code></a>` est un lien correctement nommé.
- Les commentaires HTML et le contenu des valeurs d'attributs ne sont pas lus comme du balisage. Les attributs `{…}` sont lus comme du JavaScript (chaînes, gabarits, regex et commentaires sautés) ; une accolade ou un guillemet jamais refermés sont lus comme du texte, et les balises suivantes sont contrôlées quand même. Les avertissements citent la ligne du fichier, même quand le HTML du composant commence après des lignes vides.
- Sur les champs sans `id`, l'alerte ne tombe que si le HTML ne contient aucun `<label>` — un champ enveloppé dans son étiquette ne déclenche rien.

Pour couper : `"lint": { "a11y": false }`.

### `lint.ujsForm`

Avertissement sur un `<form>` qui n'a **ni** `action`, **ni** `@method`/`mjs-method`, **ni** `@noUJS` : le pont UJS l'intercepte quand même — le contrat reste « tout `<form>` est intercepté » — et sans destination déclarée, la soumission repart en navigation vers l'URL courante. `action=""` compte comme absente (même piège que l'absence pure et simple). Un formulaire retenu par `@submit.prevent` n'est pas signalé : le gestionnaire du composant joue avant l'envoi et le retient, le formulaire est local. **Activé par défaut** (`true`), simple **avertissement**, jamais une erreur. Même garde-fou que `lint.a11y` : les `<pre>`/`<code>` d'exemple sont ignorés, les commentaires HTML et le contenu des valeurs d'attributs ne sont pas lus comme du balisage, et les attributs `{…}` sont lus comme du JavaScript ; l'avertissement cite la ligne du fichier, même quand il commence par des lignes vides.

Pour couper : `"lint": { "ujsForm": false }`.

### `image`

Politique des variantes produites par `µimage` (cf. [35 · Images](35-images.md)) : `widths` (largeurs à produire, entiers de 1 à 10 000 sans doublon, défaut `[480, 960, 1920]`, jamais au-delà de la largeur native), `formats` (parmi `avif`/`webp`/`jpeg`/`png`, défaut `['webp']`), `quality` (1-100, défaut `78`). Ces variantes exigent `sharp`, dépendance **optionnelle** (`npm i -D sharp`) — absente, l'image d'origine passe telle quelle et un avertissement unique le dit ; les **dimensions natives**, elles, sont toujours lues (en-tête du fichier, aucune dépendance) et ne dépendent pas de ce bloc.

```json
{
  "image": { "widths": [320, 640, 1280], "formats": ["avif", "webp"], "quality": 80 }
}
```

### Ce que porte le manifeste

Le fichier `manifestPath` est servi sur **chaque** page : tout ce qu'il embarque est payé à chaque
visite. Il porte donc la table des composants et les réglages, jamais la prose du site.

- **Table des chemins** — `µ.paths`, un nom logique par composant/module. Les valeurs partagent
  toutes le même début d'URL (`urlPrefix`) : ce préfixe est publié **une seule fois**
  (`µ.pathsPrefix`) et chaque valeur ne garde que son suffixe (`about-<empreinte>.js`) ; qui lit un
  chemin recolle les deux. Sur un site à ~1 400 composants, c'est 37 Ko de préfixe recopié en moins
  sur chaque page. En production, à partir de 40 entrées, la valeur est réduite à ce que la clé ne dit
  pas déjà : l'empreinte seule (`"about":"k3x9a"`), ou le préfixe de dossier suivi de l'empreinte
  (`"ajax":"tuto-m81pz"`) ; un nom de fichier entier (fichier de groupe ou de page) garde son
  point. Aucun fichier n'est renommé. Pour obtenir le chemin entier d'un nom, lisez `µ.pathOf(nom)`
  (chaîne vide si le nom est inconnu) plutôt que `µ.paths[nom]`. En développement et sous 40 entrées,
  la table reste entière. En `js: 'bundle'`, la forme ne change pas (chaque nom pointe le fichier unique).
- **Réglages** — préchargement (`preload`), niveau de journal, libellés du framework, thèmes.
- **i18n** — les **réglages** seulement (langue par défaut, mode placeholder, détection…), plus la
  liste des langues et l'URL du **fichier de chaque langue** ; dictionnaires et table des sections
  vivent dans ces fichiers, chargés pour la seule langue affichée — cf.
  [29 · i18n](29-i18n.md) §2.

Conséquence pratique : le manifeste ne **porte** plus la prose du site (site de référence : 142 Ko
bruts, 33 Ko gzip de moins par page servie), et un visiteur ne télécharge que la langue affichée —
plus la langue par défaut si elle diffère, qui porte les replis. Ce fichier se paie **une** fois :
sur la première page le solde est de −16,6 Ko gzip en français et à peu près nul en anglais (deux
fichiers) ; dès la deuxième page il vient du cache et le gain est plein. Changer une **traduction**
change le fichier de sa langue **et** l'empreinte que le manifeste en garde : le manifeste change
donc encore, comme à chaque construction ; les fichiers des autres langues et le JavaScript des
composants, eux, ne bougent pas.

### `js`

Par défaut (`"js": "split"`, ou la clé absente), chaque composant, chaque module `.civet`/`.coffee` et le cœur du runtime deviennent leur propre fichier haché (`mjs_core-<empreinte>.js`, `mon-composant-<empreinte>.js`…) dans `outputDir` ; l'empreinte tient en 5 caractères (`0-9a-z`, tirés du contenu du fichier) : une chance sur 60 millions par fichier modifié que deux contenus partagent un nom, compromis assumé contre des noms plus courts (environ 2 Ko de moins sur un site réel) ; deux contenus qui recevraient le même nom font échouer le build, jamais un fichier écrasé sans bruit, et le manifeste (`manifestPath`) se contente de les orchestrer — un `import()` dynamique par unité, chargée quand sa balise apparaît dans la page (`µ.Autoloader`). Sur un site à nombreux composants répartis sur plusieurs pages, c'est ce qui permet à une page de ne charger QUE ce qu'elle affiche.

`"js": "bundle"` change cette stratégie du tout au tout : le cœur, les feuilles partagées, les animations utilisées, le manifeste externe, les modules et TOUS les composants du projet sont assemblés dans le seul fichier `manifestPath` — plus aucun autre `.js` dans `outputDir`, sauf ce que charge `µimport` : un `.js` cité, ou un module MJS chargé à la demande (lui et les modules que seuls des modules chargés à la demande importent ne sont téléchargés et évalués qu'à l'appel) avec le fichier du code qu'il partage avec le reste (le cœur, un module importé des deux côtés), que le fichier unique importe dès le démarrage (les satellites CSS de variants et les images restent des fichiers, inchangés). Ces fichiers sont écrits **à côté de `manifestPath`**, dans `outputDir` ou, si le manifeste est ailleurs, dans le dossier du manifeste : le fichier unique les cite par un chemin relatif, qui se lit depuis son adresse. Hors d'`outputDir`, ils ne figurent pas dans `mjs-precache.json`, dont les adresses se déduisent d'`urlPrefix` : le build ne connaît pas l'adresse publique du manifeste. Le build les consigne dans le registre `.mjs-outputs.json`, à côté du manifeste, et ne retire jamais que ceux-là. Une page ne fait plus qu'une seule requête JavaScript (deux quand un module MJS est chargé à la demande), tout est chargé et défini d'un coup, `µ.Autoloader` n'a plus rien à découvrir puisque rien n'arrive plus tard. C'est le choix pertinent pour une petite application ou une page unique où « tout charger tout de suite » coûte moins qu'une cascade de petites requêtes — pas pour un site qui étale ses composants sur de nombreuses pages, où ce serait l'inverse (chaque page paierait le poids de composants qu'elle n'affiche jamais).

Trois choses à savoir :

- **Le mode exige `css: 'bundle'`** (le défaut). C'est mécanique, à l'envers du raisonnement de `csp` ci-dessous : fusionner en un seul fichier un CSS déjà DÉCOUPÉ en fichiers séparés (`"css": "split"` ou `"css": "lazy"`) contredirait « un seul fichier JS ». Avec l'un de ces deux réglages, le build refuse de partir et le message nomme le correctif.
- **Incompatible avec `csp: true`** : le mode strict exige justement un CSS découpé (cf. `csp` plus bas), l'inverse de ce que `js: 'bundle'` impose — aucune valeur de `css` ne peut jamais satisfaire les deux à la fois, un message dédié le dit avant même de parler de `css`.
- **L'Autoloader n'est pas embarqué** : tout composant est défini dès le chargement du fichier unique, il n'a plus rien à découvrir. Un contrôle unique, après la définition de tous les composants, signale en console toute balise `mjs-…` présente dans la page et inconnue du projet (une faute de frappe, ou un web component tiers voulu). `"runtime": ["autoloader"]` le remet si un projet en a besoin.
- **Le rendu serveur et le rendu navigateur restent TOUJOURS en `'split'`**, quel que soit ce réglage : ils rechargent le cœur et chaque composant fichier par fichier pour leurs propres besoins internes (prérendu, tests Chromium). Sous `js: 'bundle'`, cette recompilation de service écrit dans un **dossier temporaire à elle**, retiré aussitôt : `outputDir` et son fichier unique sortent du prérendu intacts, à l'octet près. Les URLs d'assets du HTML rendu (images `µasset`, feuilles, liens) restent celles du vrai build — ce détail d'implémentation ne change jamais ce qu'un visiteur reçoit.

```json
{
  "js": "bundle"
}
```

> **Changer de mode purge peu.** Passer de `'split'` à `'bundle'` (ou l'inverse) sur un `outputDir` déjà construit laisse les anciennes sorties de l'AUTRE mode sur place (les `mjs_core-*.js`/`<composant>-*.js` d'un ancien `'split'` ne sont jamais reconnus comme orphelins par un build en `'bundle'`, qui n'écrit plus rien de tel) : `prune` ne les retire pas. Videz `outputDir` à la main après un changement de mode.

### `csp`

Certains hébergements — banque, santé, secteur public, ou simple politique interne — imposent une **politique de sécurité de contenu** stricte : l'en-tête `Content-Security-Policy` y interdit tout style et tout script écrits *en ligne* dans la page, du genre `script-src 'self'; style-src 'self'` sans la moindre échappatoire `'unsafe-inline'`. Le navigateur refuse alors purement et simplement d'exécuter un `<script>` sans `src`, et d'appliquer un `<style>` posé dans le HTML.

`"csp": true` met MJS en conformité avec une telle politique : à partir de là, **rien de ce que MJS écrit ne serait refusé**. Le CSS du thème part en fichier avec empreinte et arrive par un `<link>` ; les feuilles de composant rendues au serveur passent elles aussi par un `<link>`, à l'intérieur du shadow root — pour **chaque** composant du HTML rendu, racine comme sous-composant, à ombre comme léger ; le drapeau d'hydratation devient un attribut au lieu d'un script ; et les quelques endroits où le runtime fabriquait une balise `<style>` à la volée adoptent une feuille de style construite en mémoire, que la politique ne regarde pas.

Trois choses à savoir :

- **MJS n'impose aucune politique.** Il n'émet jamais d'en-tête `Content-Security-Policy` lui-même : écrire cet en-tête reste l'affaire de l'application ou du serveur de façade. La clé rend MJS *compatible*, elle ne décide rien à votre place.
- **Le mode exige un CSS découpé** (`"css": "split"` ou `"css": "lazy"`). C'est mécanique : remplacer un `<style>` en ligne par un `<link>` suppose qu'un fichier existe à pointer. Avec `"css": "bundle"`, le build refuse de partir et le message nomme le correctif — et donc, transitivement, `"csp": true` est aussi incompatible avec `"js": "bundle"` (cf. `js` plus haut), qui exige justement `css: 'bundle'`.
- **`mjs serve` et `mjs dev` les servent au préfixe DÉRIVÉ.** Ces feuilles sont référencées par leur URL publique, celle que le projet déclare dans `urlPrefix` ou, à défaut, celle que MJS dérive du dossier de sortie (`public/modularjs` → `/modularjs`, cf. [`urlPrefix`](#urlprefix)) — même règle côté écriture et côté service, donc rien à accorder à la main. Ne déclarez `urlPrefix` que si votre back monte le dossier ailleurs que ne le dit cette convention.
- **Les feuilles écrites par le rendu ne sont jamais purgées.** Celles-là (`mjs_ssr_style…`, `mjs_ssr_head…`) naissent au prérendu, pas à la compilation : `prune` les épargne par leur nom, sans quoi le build les retirerait aussitôt écrites et les `<link>` des fragments pointeraient dans le vide. En contrepartie, la feuille d'un composant **supprimé du projet** reste sur disque, orpheline — elle n'est plus référencée par aucun fragment, son nom porte l'empreinte de son contenu, elle ne peut donc rien écraser ni rien servir de faux. Videz `outputDir` à la main quand ce résidu vous gêne.
- **Le défaut reste `false`**, et le chemin par défaut ne change pas d'un octet. Ce n'est pas de la prudence de façade : une feuille adoptée en mémoire passe *après* les `<style>` et les `<link>` du document dans l'ordre de cascade. Basculer tout le monde changerait donc qui gagne un conflit de règles, et pourrait casser une surcharge d'application qui marche très bien aujourd'hui.

```json
{
  "csp": true,
  "css": "split"
}
```

### `sourceMap`

Une **carte de source** est le petit fichier `.map` qui relie le JavaScript livré au navigateur au fichier que vous avez écrit. Sans elle, un point d'arrêt tombe au milieu du code compilé ; avec elle, il tombe sur *votre* ligne, dans *votre* `.mjs`.

| Valeur | Émission |
|---|---|
| `'dev'` | en développement seulement — le défaut |
| `'prod'` | en build de production seulement |
| `'always'` | dans les deux |
| `'never'` | jamais |

Le défaut `'dev'` découle directement de là : la carte est émise là où elle sert — pendant que vous développez — et absente de la production, où elle publierait la forme lisible de votre code à qui ouvre les outils du navigateur. `'prod'` rétablit le comportement des versions précédentes.

> **Ce que la carte couvre.** Le `<script>` de votre composant, ligne par ligne : le navigateur vous affiche votre `.mjs` d'origine — Civet, Coffee ou TypeScript — et non le JavaScript assemblé, y compris sur un fichier minifié. Le source du `.mjs` est embarqué dans la carte, il n'a donc pas besoin d'être servi. Restent en dehors : le bloc `<script module>` (code de module, hors de la classe du composant) et les gestionnaires écrits directement dans le HTML (`@click={…}`), assemblés à part.

### `prune`

Le build remplace déjà l'empreinte d'un fichier qui **change** — `cleanupOldHashes` retire l'ancienne version une fois le nouveau manifeste publié. Un nom qui **disparaît** (composant renommé ou supprimé) est un cas différent : personne ne le retire, son fichier reste dans `outputDir` indéfiniment.

Rien ne le sert — le manifeste ne le référence plus — mais sa seule présence fait mentir le dossier sur ce que le site contient réellement : c'est ce qu'on relit six mois plus tard en se demandant pourquoi `outputDir` pèse dix fois ce que le dernier build a écrit.

Après un build **sans erreur** (jamais après un build partiel — cf. § *Validation stricte* ci-dessous), avant le prérendu, `mjs build` retire donc d'`outputDir` les fichiers qu'un build a écrits (`nom-<empreinte>.ext`, son `.map`, une variante d'image) et qu'il n'a pas produits ce tour-ci. Il le sait par le registre `.mjs-outputs.json`, à côté du manifeste, qui garde la liste des fichiers écrits par les builds (clé `files`).

> ℹ️ **Un dossier de sortie construit par la 2.5.0** n'est pas rangé après coup : la 2.5.0 ne notait pas les fichiers qu'elle écrivait, ils manquent donc au registre et la purge les laisse en place. Retirez-les une fois à la main (les `nom-<empreinte>.ext` et leurs `.map`), ou construisez dans un dossier vide ; ensuite, chaque build retire ce qu'un build précédent a écrit et qu'il ne produit plus.

**Jamais un fichier sur la seule forme de son nom.** Un fichier à vous posé dans le dossier de sortie — `card-utils.js` à côté d'un composant `card.mjs`, `logo-white.png` à côté d'une image `logo.png`, `theme-light.css`, `vendor-0123abcd.js` — n'est jamais retiré : ni par cette purge, ni quand le build remplace l'empreinte d'une de ses propres sorties. Le dossier de sortie peut même être le dossier source (ou un dossier dedans) : aucun fichier source n'est retiré ni réécrit. Les sorties à nom fixe — le manifeste, la feuille `<module>.<nom>.css` d'un `<style name="…">`, `mjs-precache.json` — y portent alors une marque : la première ligne `/* @generated by ModularJS */` pour le manifeste et les feuilles, la clé `"@generated": "ModularJS"` pour `mjs-precache.json` (à côté de `version` et `assets`, inchangés). Les autres sorties JSON à nom fixe — le registre `.mjs-theme-vars.json` (développement), les noms courts `.mangle-cache.json` (production), la carte `<manifeste>.map` du fichier unique, les fragments de traduction à nom clair `i18n/<langue>/<section>.json` — ne portent pas de clé de marque (le registre et les fragments la liraient comme une donnée) : elles sont reconnues à leur forme, la même depuis la 2.5.0, et un fichier à vous du même nom, d'une autre forme, est refusé de la même façon. Elles ne remplacent qu'un fichier qui porte cette marque : un fichier à vous du même nom arrête la construction avant toute écriture, par une seule erreur qui nomme tous les fichiers en cause, et reste intact. La preuve est dans le fichier même : un clone sans registre `.mjs-outputs.json`, un registre perdu ou un manifeste déplacé n'y changent rien. Après la mise à jour depuis la 2.5.0, son manifeste et son `mjs-precache.json` sont reconnus et réécrits ; ses feuilles `<module>.<nom>.css`, qui n'ont aucun signe sûr, sont refusées une fois, toutes dans la même erreur : supprimez-les puis relancez. Hors du dossier des sources, les sorties ne portent aucune marque. Un projet traduit fait exception : les fragments de traduction iraient dans `i18n/<langue>/`, le dossier même de vos traductions — le build le refuse par une erreur, avant d'écrire quoi que ce soit ; donnez alors à `outputDir` un dossier distinct. En contrepartie, un dossier de sortie laissé par une version qui ne tenait pas cette liste (la 2.5.0) n'est pas rangé rétroactivement : ses anciennes sorties restent, videz `outputDir` à la main une fois après la mise à jour ; seuls les fichiers écrits depuis par le build sont suivis.

En `"js": "bundle"`, le build ne se fie jamais à la forme d'un nom : il retire les fichiers écrits à côté du manifeste (module chargé à la demande, code partagé) que le registre dit écrits par un build et que ce build n'a pas réécrits — un module retiré ou renommé laisse donc ses fichiers jusqu'à ce `mjs build`, et un fichier à vous nommé `chunk-deadbeef.js`, posé à côté du manifeste, n'est jamais touché, que le manifeste soit dans `outputDir` ou ailleurs. Avec `"prune": false`, ces fichiers restent.

Chaque retrait est annoncé, jamais silencieux : `🧹 8 fichiers orphelins retirés de public/modularjs`, suivi du nom de chacun (vingt au plus, puis `+ N autres`).

Jamais touchés : les sous-dossiers de `outputDir` (hors les fragments de traduction, voir plus bas) et les pages de `render.outDir`, le manifeste, les feuilles `.css` de layout, les fichiers de travail du bundler (`.mangle-cache.json`…), tout fichier que le registre `.mjs-outputs.json` ne liste pas, et toute extension absente de ce registre (un `.pdf`/`.zip` posé à la main, par exemple).

**Les fragments de traduction** (`i18n/<langue>/*.json`) suivent la même règle, avec une précision : le build ne retire que les fichiers **qu'il a écrits lui-même** et qu'il n'a pas réécrits ce tour-ci (un texte modifié en production donne un nouveau nom, l'ancien fragment n'est plus servi ; une section supprimée ou une langue retirée des sources laisse le sien). Il le sait parce que le registre `.mjs-outputs.json` garde la liste des fragments écrits, langue par langue — jamais d'après la forme du nom : un `.json` que vous posez dans `i18n/<langue>/` (`notes.json`, un nom qui ressemble à une empreinte, le nom d'une section) n'est jamais retiré. Avec `"prune": false`, aucun fragment n'est retiré : les anciens restent à disposition des onglets restés ouverts. Un dossier de fragments laissé par une version qui les vidait à chaque build n'est pas rangé rétroactivement : seuls les fragments écrits depuis par le build sont suivis.

`"prune": false` désactive la purge, et aussi le retrait de l'ancienne empreinte d'un fichier qui change — le dossier accumule alors comme avant. `mjs dev` et `mjs serve` ne la déclenchent jamais : seul `mjs build` le fait.

À savoir : un onglet resté ouvert sur un build précédent peut perdre ses imports différés au rechargement, les empreintes changeant à chaque déploiement. Garder les anciens fichiers à disposition le temps qu'un onglet oublié se recharge, c'est `"prune": false`.

**`.mangle-cache.json`** (à côté des sorties, en production) garde les noms courts donnés aux propriétés internes, pour que deux builds du même code donnent les mêmes fichiers. Il peut être versionné. Relu à chaque build, il est contrôlé : une valeur qui n'est pas un texte, ou un même nom court donné à deux propriétés (ce que peut laisser une fusion git), est écartée avec un avertissement et recalculée — jamais transmise au minifieur. Un cache laissé en conflit par une fusion git (lignes `<<<<<<<`, `=======`, `>>>>>>>`) est recalculé en entier. Quand les sorties sont dans le dossier des sources, un cache abîmé de ces façons reste reconnu à ses clés (propriétés `_mjs_…`, noms réservés à `false`) et il est remplacé ; seul un fichier de ce nom qui n'a pas cette forme est refusé.

Le nom seul ne suffit pas à reconnaître une sortie du bundler : un fichier étranger déposé à la main peut, par pure coïncidence, prendre la forme `nom-<empreinte>.ext` (ex. `rapport-1a2b3c4d.pdf`) sans jamais avoir été écrit par un build — d'où la liste des fichiers écrits, ci-dessus. Un second filtre porte sur l'**extension** : à côté du manifeste, un registre `.mjs-outputs.json` liste les extensions que ce bundler a produites (`.js`/`.css`/`.map` toujours, les formats d'image configurés, plus toute extension effectivement rencontrée) — seul un fichier dont l'extension y figure est candidat à la purge. Registre absent : base minimale `.js`/`.css`/`.map` + formats d'image configurés. Registre présent mais illisible (JSON corrompu ou de forme inattendue) : la purge entière est sautée, aucun fichier retiré — mieux vaut ne rien purger que deviner sur un registre douteux.

### `bundles`

Une page qui contient des dizaines de petits composants (un onglet et ses cartes, par exemple) les charge un par un : autant de requêtes que de fichiers. `bundles` en fait un seul fichier par groupe.

```json
{
  "bundles": {
    "onglet-texte": ["fx-famille-text"],
    "onglet-fond":  ["fx-famille-background", "fx-famille-border"]
  }
}
```

Chaque clé est le nom d'un groupe (lettres minuscules, chiffres et tirets) ; sa valeur liste ses composants **racines**, par leur nom de fichier, avec ou sans le préfixe `mjs-`. En production (`--prod`), un groupe assemble ses racines **et toute leur descendance** — les composants que leurs gabarits écrivent, de proche en proche — dans `mjs_group-<nom>-<empreinte>.js`. Le manifeste fait pointer chaque composant du groupe vers ce fichier : charger l'un d'eux charge le groupe entier, une seule fois.

Pour laisser certains composants **dehors**, un groupe prend la forme objet :

```json
{
  "bundles": {
    "onglet-composants": { "roots": ["onglet-composants"], "except": ["core-field", "core-gauge", "core-tabs"] }
  }
}
```

Un composant listé dans `except`, **et la descendance qu'il est seul à atteindre**, restent en fichiers séparés : ils se chargent comme d'habitude quand la coquille du groupe les appelle, et une page qui n'utilise que l'un d'eux ne télécharge pas le groupe. Ils restent dans la table des dépendances : `µ.Autoloader.preload` de la racine les charge d'avance avec le groupe. `roots` est la liste que la forme courte donne directement ; `except` est facultatif, et `{ "roots": [...] }` seul équivaut à la forme courte.

Restent des fichiers à part, jamais recopiés dans le groupe : le cœur, les **modules** (`.civet`/`.coffee`, qui doivent rester une instance unique), les feuilles partagées, les animations, les fichiers de langue et les fichiers d'effets. Les fichiers séparés de chaque composant sont toujours écrits : le rendu serveur les lit un par un, et `prune` ne les retire pas. En développement, rien n'est regroupé — une ligne au journal du build le dit.

- **Un composant ne peut appartenir qu'à un seul groupe.** Un composant atteint par plusieurs groupes arrête le build, et l'erreur les relève **tous d'un coup** : pour chaque composant, les groupes qui l'atteignent (au-delà de trois, les deux premiers puis « … »), puis ce qu'il faut écrire pour les sortir de ces groupes : la ligne `"except"` exacte à ajouter aux groupes, et la liste complétée de chaque groupe qui a **déjà** un `except` — à écrire à la place de l'ancienne, car un second `"except"` dans le même groupe remplacerait le premier en silence. Un groupe écrit en liste prend la forme objet (`["racine"]` devient `{ "roots": ["racine"], "except": [...] }`), ce que le message rappelle quand l'un des groupes à modifier est une liste. Suivie à la lettre, la consigne fait passer la construction : pas de second tour.

  ```
     [bundler] ✗ 3 composants sont dans plusieurs groupes : core-checkbox, core-option, core-select
     core-checkbox : 3 groupes : onglet-carte, onglet-fond, onglet-texte
     core-option : 2 groupes : onglet-carte, onglet-texte
     core-select : 2 groupes : onglet-carte, onglet-texte
     Pour les sortir de ces groupes, ajoutez à chacun de ces groupes (onglet-carte, onglet-fond) :
     "except": ["core-checkbox", "core-option", "core-select"]
     Un groupe qui a déjà un "except" le complète, sans en ajouter un second qui remplacerait le premier :
     onglet-texte : "except": ["core-field", "core-checkbox", "core-option", "core-select"]
     Un groupe écrit en liste, ["racine"], devient { "roots": ["racine"], "except": [...] }.
  ```

  Une racine n'entre pas dans cette ligne (un groupe ne peut pas laisser dehors sa propre racine) : une consigne à part dit de l'ajouter à `except` des autres groupes (elle reste dans le sien) ou, quand deux groupes la déclarent racine, de la garder racine d'un seul et, dans chacun des autres, de la retirer de `roots` **et** de l'ajouter à `except` (un groupe qui l'atteint encore par une autre de ses racines ne s'en sortirait pas autrement), ou de réunir les groupes.
- **Un composant du groupe que lit aussi un composant extérieur** reste dans le groupe, et son chemin pointe vers le groupe : toute page qui l'utilise charge le groupe entier. Le build avertit en le nommant, pour que vous le sortiez du groupe ou assumiez ce chargement. Une racine appelée depuis l'extérieur est l'usage prévu, sans avertissement.
- **Un descendant atteint à la fois par un composant exclu et par un composant du groupe reste dans le groupe** : seul ce que l'exclu atteint seul sort avec lui. Si cet exclu appelle un tel composant, une page qui n'utilise que l'exclu charge le groupe par ce composant, et le build l'avertit en le nommant (l'exclu y figure parmi les appelants extérieurs).
- **L'avertissement « utilisé hors du groupe » propose la solution** : ajoutez le composant à `except` du groupe pour le laisser en fichier séparé. Un composant de `except` ne le déclenche jamais.
- **Un fichier de page l'emporte pour sa route.** Quand une route prérendue demande `render.startup: "bundle"`, son fichier de page assemble les composants de la page, y compris ceux d'un groupe ; la fiche de la route désigne ce fichier. Le groupe sert partout ailleurs.
- **Une racine inconnue, un module comme racine, un groupe vide, un nom de groupe invalide** sont refusés à la lecture de la configuration ou au build, avec le nom fautif ; de même, dans `except`, un nom qui n'est pas un composant du projet (un module compris), une racine du groupe (elle ne peut pas être laissée dehors), une clé inconnue de l'objet, ou une valeur qui n'est pas une liste de noms.
- Avec `js: "bundle"`, rien n'est regroupé : le fichier unique livre déjà tout le projet.

Pour charger un groupe d'avance, au survol d'un onglet par exemple, voir `µ.Autoloader.preload` dans [21 · Navigation](21-navigation.md).

### `render.renderQueue`

Plafond de **concurrence** sur le rendu SSR par requête (`mjs dev`/`mjs serve`, bloc `render` — cf. [19 · SSR](19-ssr.md) pour `render.engine`/`render.browserPool`, les autres réglages du moteur de rendu) : `concurrency` (entier ≥ 1, défaut **4**) borne le nombre de rendus EN MÊME TEMPS, `maxQueue` (entier ≥ 0, défaut **32**) le nombre de requêtes qui patientent derrière avant refus. Sans ce plafond, une route paramétrée (`/produit/:id`) ouvre un espace d'URLs quasi infini, chacune un rendu complet lancé sans limite.

```json
{
  "render": { "renderQueue": { "concurrency": 8, "maxQueue": 64 } }
}
```

Au-delà de `concurrency` + `maxQueue` requêtes simultanées, le serveur répond `503 Service Unavailable` plutôt que de laisser la file grossir sans borne ou de saturer le process — `mjs dev` et `mjs serve` posent tous deux l'en-tête `Retry-After` (secondes avant nouvel essai) sur ce `503`.

### `render.startup`

Ce que le HTML figé d'une page prérendue dit au navigateur de charger, **avant** que le manifeste (`bundle_modular.js`) n'ait été téléchargé puis exécuté. Le manifeste est le seul à savoir quels composants une page affiche : sans cette clé, ils ne partent qu'après lui, en seconde vague. La page prérendue, elle, le sait dès sa construction — c'est ce que cette clé exploite. Surchargeable par route (`render.routes["/"].startup`) ; ne concerne que les routes `prerender`.

| Valeur | Ce que le navigateur charge |
|---|---|
| `preload` (défaut) | le fragment porte un `<link rel="modulepreload">` par unité de son **ensemble de démarrage** — composants ET modules — en tête du fichier. Un fichier par composant, `µ.paths` intact : seule la date de départ change (première vague au lieu de la seconde) |
| `bundle` | en **plus**, un `mjs_page-<page>-<empreinte>.js` par page assemble ses composants : le fragment porte un lien vers ce fichier, un lien par module, et une fiche JSON que le manifeste relit pour y repointer `µ.paths`. Une requête de composants au lieu de N |
| `none` | aucun en-tête : la balise du composant racine et son HTML prérendu, rien devant |

Avec `js: "bundle"`, le fragment reste nu quelle que soit cette clé : le fichier unique livre déjà le cœur et tous les composants, il n'y a rien à précharger page par page. Le build le signale en une ligne.

L'**ensemble de démarrage** d'une page, ce sont les composants dont la balise est dans son HTML prérendu, plus la fermeture de leurs dépendances directes : un enfant qu'un `{if}` faux n'a pas rendu en fait partie (il s'affichera au premier clic sans aller-retour), les modules `@import`-és par ces composants aussi.

```json
{
  "render": { "default": "prerender", "startup": "bundle", "routes": { "/": { "component": "mjs-landing" } } }
}
```

Le fichier de page n'est assemblé qu'en **construction de production** (`mjs build --prod`) : en développement, `bundle` se comporte comme `preload`, avec une ligne d'information au journal du build — le rechargement à chaud n'est pas mêlé à un second assemblage. Restent **externes** au fichier de page : le cœur, les feuilles partagées, les animations, les fichiers de langue, le manifeste externe, et les **modules** — un module doit rester une instance unique, un store exporté par un module et dupliqué dans un fichier de page casserait l'état partagé. Les fichiers séparés de chaque composant existent toujours : une autre page les charge seuls, le rendu serveur les lit un par un.

Une page de moins de deux composants n'a rien à factoriser : elle reçoit le préchargement seul. `render.startup: "bundle"` avec `js: "bundle"` est refusé à la lecture de la configuration — le fichier unique livre déjà tout le projet, un fichier de page n'aurait rien à assembler.

Le nom du fichier de page vient de l'**URL de la route** : `/` donne `mjs_page-index-<empreinte>.js`, `/a/index` donne `mjs_page-a-index-<empreinte>.js` (tout ce qui n'est ni lettre ni chiffre devient un tiret). Deux routes qui arriveraient au même nom sont refusées à la lecture de la configuration, nommées toutes les deux : une seule garderait son fichier. Avec `render.locales`, les langues d'une même route partagent leur URL, donc leur fichier de page — il assemble l'**union** des composants de toutes les langues, et chaque fragment déclare dans sa fiche l'ensemble de démarrage de SA langue, fermé par les dépendances statiques du gabarit — un enfant déclaré dans une branche `{if}` sur la langue est donc déclaré dans les deux. Un composant qui n'apparaît qu'en anglais est déjà chargé quand la bascule de langue le fait entrer.

`csp: true` est compatible : la fiche est un `<script type="application/json">`, de la donnée qu'aucune politique de sécurité n'exécute — rien d'exécutable n'est ajouté au fragment. Les fichiers de page figurent dans `mjs-precache.json` comme le reste des sorties du build, cf. [36 · Application installable](36-application-installable.md).

`mjs serve` sur une route `prerender` dont le fichier figé n'existe pas encore rend la page à la volée : ce HTML-là n'a pas d'en-tête de démarrage — il se comporte comme `none`, les composants partent après le manifeste.

Ce que coûte `bundle` : un composant partagé par plusieurs pages est téléchargé une fois **par** fichier de page qui l'embarque (le cache ne le reconnaît pas d'un fichier à l'autre), et la moindre modification de l'un d'eux change l'empreinte de tout le fichier de page. C'est un arbitrage : une seule requête au démarrage contre une invalidation plus large. Les pages d'entrée, chargées « à froid » par un visiteur qui ne connaît rien du site, sont les premières à y gagner.

### `logLevel`

Le niveau de la console — **côté navigateur** (`µ.log`/`µ.warn`/`µ.error`) et **côté build** (ce que le minifieur retire du bundle, et les avertissements de construction du terminal, pas les lignes écrites à la lecture de la configuration ou à la compilation d'un composant) — réglé par la MÊME clé, du plus bavard au plus muet :

| Niveau | Montre |
|---|---|
| `'log'` | tout — traces, avertissements, erreurs |
| `'warn'` | avertissements et erreurs |
| `'error'` | erreurs seules |
| `'silent'` | rien |

Une chaîne (`"logLevel": "warn"`) pose le MÊME niveau dans les deux environnements. Un objet `{ dev?, prod? }` pose un niveau par environnement — chaque sous-clé absente retombe sur le défaut de SON environnement :

```json
{ "logLevel": { "dev": "log", "prod": "error" } }
```

Défauts : `dev` → `'log'` (tout, pendant qu'on développe), `prod` → `'error'` (les erreurs seules : les avertissements du framework ne s'écrivent plus ; dans un build minifié, ils sortent aussi du fichier construit, sauf ceux des modules cœur). Le niveau de PRODUCTION gouverne aussi ce que le minifieur retire du bundle de production (un build de développement minifié n'en retire rien, un build de production non minifié non plus) : au-dessus de `'log'`, les traces du framework (`µ.log`) ne sont pas envoyées, ni l'appel ni le texte qu'il aurait écrit ; aux niveaux `'error'` et `'silent'`, ses avertissements (`µ.warn`) non plus ; au niveau `'silent'`, ses erreurs (`µ.error`) non plus, sauf quand le journal des erreurs est embarqué. Les modules cœur (`<@@number>`, `<@@select>`…) gardent leurs avertissements et leurs erreurs, avec leurs textes : le niveau les rend muets à l'exécution, sans les retirer. Pour garder les avertissements en production : `{ "logLevel": { "prod": "warn" } }`. Le terminal de `mjs build`, `mjs dev` et `mjs check` suit le niveau de l'environnement du build — la production avec `--prod`, le développement sans : ses avertissements de construction s'écrivent, sauf quand la clé fixe ce niveau à `'error'` ou `'silent'`. Les lignes écrites à la lecture de la configuration ou à la compilation d'un composant (`[lint.config]`, `[lint.a11y]`…) ne lisent pas ce niveau : seul le bloc `lint` les coupe. Détail complet, et l'échappatoire `µ.debug` : [34 · Déboguer](34-deboguer.md).

## 3. Validation stricte

Comme pour chaque bloc imbriqué (`ws`, `ws.limits`, `render`, `lint`…), la validation de `mjs.config.json` est **stricte** : une clé absente de la liste ci-dessus fait échouer le build, avec un message qui nomme la clé fautive et rappelle la liste complète des clés valides. Une faute de frappe n'est donc jamais absorbée en silence.

Le fichier entier doit être un objet (`{ … }`) : un tableau ou `null` est refusé. Les valeurs aussi sont vérifiées à la lecture : `varPrefix` et `defaultTheme` sont des chaînes (un tableau `["dark"]` est refusé), une langue de `render.locales` ne sort pas du dossier du prérendu (segment `..`, barre inverse, chemin absolu), et `manifestPath`, `dev.host`, `image.widths` suivent les règles du tableau ci-dessus.

---

📚 **Voir aussi** : [19 · SSR](19-ssr.md) pour le bloc `render` et le journal d'erreurs ; [23 · MJS-WS](23-mjs-ws.md) et [24 · MJS-Server](24-mjs-server.md) pour `ws`/`serveur` ; [29 · i18n](29-i18n.md) pour `i18n` ; [31 · Thèmes, variables & modèles](31-themes.md) pour `varPrefix`/`defaultTheme` ; [35 · Images](35-images.md) pour `image`.
