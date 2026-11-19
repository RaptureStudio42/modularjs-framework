# ModularJS (MJS)

🇫🇷 *English below ⬇️*

**Un framework front compile-time : la réactivité est résolue à la compilation, pas au runtime.** Pas de Proxy ni de Virtual DOM — chaque composant est un *Custom Element* avec son *Shadow DOM*, et le compilateur génère des mises à jour DOM chirurgicales.

[![npm](https://img.shields.io/npm/v/modularjs-framework)](https://www.npmjs.com/package/modularjs-framework)
[![licence](https://img.shields.io/badge/licence-MIT-blue)](./LICENSE)
[![site](https://img.shields.io/badge/site-mjs.rapturestudio.fr-2f6df6)](https://mjs.rapturestudio.fr/)

```html
<script>
  $count = 0
  increment = -> $count += 1
</script>

<button @click={increment}>
  Cliqué {$count} fois
</button>
```

Tout tourne en ligne sur le site officiel — **[mjs.rapturestudio.fr](https://mjs.rapturestudio.fr/)** : la documentation, le tutoriel interactif et une vitrine de composants qui s'exécutent dans la page. Le site est lui-même écrit en MJS.

[![L'accueil de ModularJS](https://raw.githubusercontent.com/RaptureStudio42/modularjs-framework/main/docs/img/accueil-fr.png)](https://mjs.rapturestudio.fr/)

## Pourquoi MJS

- **Rapide.** Performances au niveau de Svelte (parité sur le benchmark officiel), et **meilleures sur la sélection de ligne et le vidage de liste** ; pas de Proxy au runtime → renders à liaisons lourdes ~10× plus légers.
- **Idiomatique.** Une syntaxe `.mjs` concise (Civet par défaut) : `$x` réactif, dérivés automatiques, blocs `{if}` / `{for}` / `{await}` / `{key}`, liaisons `value=!{$x}`, événements `@click`, transitions, stores, contexte, router.
- **Isolé par design.** Chaque composant vit dans son *Shadow DOM* : styles scopés, pas de collision.
- **Thémable.** Des variables de thème (`$$brand`) qui cascadent à travers les composants, même par-delà le Shadow DOM ; le plus proche gagne.
- **Équipé.** Une bibliothèque de modules cœur prêts à l'emploi (`<@@select>`, `<@@field>`, `<@@checkbox>`…), personnalisable sans forker le source.
- **International.** Traduction et pluriel intégrés (`µt`, `@i18n`), dictionnaires chargés à la demande.

## Installation

```bash
npm install modularjs-framework
```

npm 11 peut avertir, à l'installation, que les scripts d'installation d'`esbuild` et de `@parcel/watcher` ne sont pas couverts par `allowScripts` (« npm warn allow-scripts … »). Il n'y a rien à faire : MJS n'a besoin d'aucun de ces deux scripts. esbuild prend son exécutable dans son paquet de plateforme, `@parcel/watcher` le sien, déjà compilé : une installation qui les saute (`npm install --ignore-scripts`) construit (`mjs build`) et recompile (`mjs dev`) comme une autre. Pour ne plus voir l'avertissement : `npm approve-scripts esbuild @parcel/watcher` ; npm inscrit leur version sous `allowScripts`, dans `package.json`, et l'avertissement revient avec une nouvelle version de l'un d'eux.

Le paquet livre ses types TypeScript, en déclarations `.d.ts`, pour `modularjs-framework`, `modularjs-framework/cli`, `modularjs-framework/testing`, `modularjs-framework/ws` et `modularjs-framework/mjs-server` : un projet TypeScript les lit tels quels, en mode `strict` compris. Elles citent les types de Node.js : installez `@types/node` dans votre projet (`npm install --save-dev @types/node`), que le paquet déclare en dépendance pair facultative ; un projet JavaScript n'a rien à installer.

### Coloration dans l'éditeur

`.mjs` est aussi l'extension des modules JavaScript de Node : sans rien faire, l'éditeur lit un composant MJS comme du JavaScript et le souligne en erreurs de bout en bout. L'extension VS Code du dépôt règle ça, et complète les 117 effets pendant la frappe, avec leur aide au survol — installation et réglage par chemin dans [`editors/vscode/`](./editors/vscode/).

## Premiers pas

Un composant est un fichier `.mjs` en kebab-case (`mon-compteur.mjs` → balise `<mjs-mon-compteur>`) :

```html
<script>
  $count = 0
</script>

<button @click={$count++}>{$count}</button>

<style>
  button
    font-size: 1.4rem
</style>
```

Compiler un projet, ou lancer le serveur de dev avec rechargement à chaud (HMR) :

```bash
npx --no -- mjs build --root /chemin/vers/app      # compile .mjs → .js
npx --no -- mjs dev --port 3939                     # dev + HMR
```

`--no` interdit à npx d'installer quoi que ce soit : hors d'un projet où `modularjs-framework` est installé, npx irait sinon chercher sur npm un paquet nommé `mjs`, qui n'est pas ModularJS. `--` laisse à `mjs` les options écrites après lui.

```html
<!-- snippet HMR à inclure en mode dev -->
<script src="http://127.0.0.1:3939/__mjs_hmr/client.js"></script>
```

## Documentation

- 📖 **[Référence du langage](./docs/)** — 38 sections : le langage (réactivité, blocs, bindings, événements, transitions, stores, contexte, router, cycle de vie, SSR, temps réel, navigation, i18n, pièges…), une fiche d'aide-mémoire condensée, et l'outillage — ligne de commande et configuration, harnais de test des applications, panneau d'inspection, images, application installable. Chaque page : référence dense + encarts dépliables *Pour débutants*.
- 🎓 **[Tuto interactif](https://mjs.rapturestudio.fr/tuto)** — 144 leçons avec éditeur live (le parcours d'apprentissage pas-à-pas).

## Configuration — `mjs.config.json`

À la racine du projet (le bundler le cherche en remontant depuis le dossier courant) :

```json
{
  "sourceDir": "app/assets/modularJS",
  "outputDir": "public/assets/modularJS_compiled",
  "manifestPath": "app/assets/javascripts/bundle_modular.js",
  "lang": "fr",
  "defaultScriptLang": "civet",
  "minify": false
}
```

Les flags CLI (`--output`, `--manifest`) ont la priorité sur le fichier de config.

## Langages source

`<script lang="…">` accepte `civet` (défaut), `coffee`, `ts`, `js` ; `<style>` accepte SASS (indenté) ou SCSS.

```html
<script lang="ts">
  $count: number = 0
</script>

<button @click={$count++}>{$count}</button>
```

## Contribuer

```bash
git clone https://github.com/RaptureStudio42/modularjs-framework.git
cd modularjs-framework
npm install
npm run build:self   # construit le compilateur (dist/)
npm test             # suite de tests
```

Une faille de sécurité à signaler ? Voir [SECURITY.md](./SECURITY.md).

## Licence

[MIT](./LICENSE) © Matrix

---

## 🇬🇧 English

**A compile-time front-end framework: reactivity is resolved at compile time, not at runtime.** No Proxy, no Virtual DOM — every component is a *Custom Element* with its own *Shadow DOM*, and the compiler generates surgical DOM updates.

[![npm](https://img.shields.io/npm/v/modularjs-framework)](https://www.npmjs.com/package/modularjs-framework)
[![license](https://img.shields.io/badge/license-MIT-blue)](./LICENSE)
[![site](https://img.shields.io/badge/site-mjs.rapturestudio.fr-2f6df6)](https://mjs.rapturestudio.fr/?lang=en)

```html
<script>
  $count = 0
  increment = -> $count += 1
</script>

<button @click={increment}>
  Clicked {$count} times
</button>
```

Everything runs online on the official site — **[mjs.rapturestudio.fr](https://mjs.rapturestudio.fr/?lang=en)**: the documentation, the interactive tutorial and a showcase of components executing right in the page. The site itself is written in MJS.

[![The ModularJS home page](https://raw.githubusercontent.com/RaptureStudio42/modularjs-framework/main/docs/img/accueil-en.png)](https://mjs.rapturestudio.fr/?lang=en)

## Why MJS

- **Fast.** Svelte-level performance (parity on the official benchmark), and **better on row selection and list clearing** ; no runtime Proxy → heavily-bound renders ~10× lighter.
- **Idiomatic.** A concise `.mjs` syntax (Civet by default): reactive `$x`, automatic derived values, `{if}` / `{for}` / `{await}` / `{key}` blocks, `value=!{$x}` bindings, `@click` events, transitions, stores, context, router.
- **Isolated by design.** Every component lives in its own *Shadow DOM*: scoped styles, no collisions.
- **Themeable.** Theme variables (`$$brand`) that cascade through components, even across the Shadow DOM boundary; the closest one wins.
- **Batteries included.** A ready-to-use core module library (`<@@select>`, `<@@field>`, `<@@checkbox>`…), customizable without forking the source.
- **International.** Built-in translation and pluralization (`µt`, `@i18n`), dictionaries loaded on demand.

## Installation

```bash
npm install modularjs-framework
```

npm 11 may warn, during the install, that the install scripts of `esbuild` and `@parcel/watcher` are not covered by `allowScripts` ("npm warn allow-scripts …"). There is nothing to do: MJS needs neither of these two scripts. esbuild takes its executable from its platform package, `@parcel/watcher` its own, already compiled: an install that skips them (`npm install --ignore-scripts`) builds (`mjs build`) and recompiles (`mjs dev`) like any other. To stop seeing the warning: `npm approve-scripts esbuild @parcel/watcher`; npm records their version under `allowScripts`, in `package.json`, and the warning comes back with a new version of either of them.

The package ships its TypeScript types, as `.d.ts` declarations, for `modularjs-framework`, `modularjs-framework/cli`, `modularjs-framework/testing`, `modularjs-framework/ws` and `modularjs-framework/mjs-server`: a TypeScript project reads them as is, `strict` mode included. They refer to the Node.js types: install `@types/node` in your project (`npm install --save-dev @types/node`), which the package declares as an optional peer dependency; a JavaScript project has nothing to install.

### Editor syntax highlighting

`.mjs` is also Node's JavaScript module extension: out of the box, editors read an MJS component as plain JavaScript and underline it end to end with errors. The repo's VS Code extension fixes this, and completes the 117 effects as you type, with their help on hover — install and setup instructions in [`editors/vscode/`](./editors/vscode/).

## Getting started

A component is a kebab-case `.mjs` file (`my-counter.mjs` → tag `<mjs-my-counter>`):

```html
<script>
  $count = 0
</script>

<button @click={$count++}>{$count}</button>

<style>
  button
    font-size: 1.4rem
</style>
```

Compile a project, or start the dev server with hot module reload (HMR):

```bash
npx --no -- mjs build --root /path/to/app      # compiles .mjs → .js
npx --no -- mjs dev --port 3939                # dev + HMR
```

`--no` forbids npx from installing anything: outside a project where `modularjs-framework` is installed, npx would otherwise fetch from npm a package named `mjs`, which is not ModularJS. `--` leaves to `mjs` the options written after it.

```html
<!-- HMR snippet to include in dev mode -->
<script src="http://127.0.0.1:3939/__mjs_hmr/client.js"></script>
```

## Documentation

- 📖 **[Language reference](./docs/)** — 38 sections: the language (reactivity, blocks, bindings, events, transitions, stores, context, router, lifecycle, SSR, real-time, navigation, i18n, pitfalls…), a condensed cheat sheet, and the tooling — command line and configuration, app test harness, inspector panel, images, installable app. Each page: dense reference + collapsible *For beginners* boxes.
- 🎓 **[Interactive tutorial](https://mjs.rapturestudio.fr/tuto?lang=en)** — 144 lessons with a live editor (a step-by-step learning path).

## Configuration — `mjs.config.json`

At the project root (the bundler looks for it walking up from the current directory):

```json
{
  "sourceDir": "app/assets/modularJS",
  "outputDir": "public/assets/modularJS_compiled",
  "manifestPath": "app/assets/javascripts/bundle_modular.js",
  "lang": "fr",
  "defaultScriptLang": "civet",
  "minify": false
}
```

CLI flags (`--output`, `--manifest`) take priority over the config file.

## Source languages

`<script lang="…">` accepts `civet` (default), `coffee`, `ts`, `js` ; `<style>` accepts SASS (indented) or SCSS.

```html
<script lang="ts">
  $count: number = 0
</script>

<button @click={$count++}>{$count}</button>
```

## Contributing

```bash
git clone https://github.com/RaptureStudio42/modularjs-framework.git
cd modularjs-framework
npm install
npm run build:self   # builds the compiler (dist/)
npm test             # test suite
```

Found a security issue? See [SECURITY.md](./SECURITY.md).

## License

[MIT](./LICENSE) © Matrix
