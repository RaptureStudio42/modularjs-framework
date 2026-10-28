// manifeste du Bundler (`µ.paths`, réglages posés avant les composants) et construction en fichier unique (`js: 'bundle'`, passage esbuild)
// fonctions sorties de la classe Bundler, qui garde ses méthodes (mêmes noms, mêmes signatures) et leur passe l'instance : un membre
// privé de la classe s'y lit `bundler['nom']`, et tout appel de méthode passe par l'instance, comme avant la découpe
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, realpathSync } from 'node:fs'
import { dirname, basename, join } from 'node:path'
import { build as esbuildBuild } from 'esbuild'
import { t } from '../messages/index.js'
import { normalizePreload } from './config.js'
import { FINGERPRINT_LENGTH } from './fingerprint.js'
import { runtimeCallsCut, buildPureList, withMangleCacheLock } from './minify.js'
import { MARQUE_SORTIE, bundleNeighborFiles } from './outputs.js'
import type { Bundler } from './index.js'

/**
 * TABLE DES FICHIERS COMPACTE (`µPaths`, production) — forme d'une valeur et règle de lecture.
 * Une valeur SANS point est compacte : ses 5 derniers caractères sont l'empreinte, ce qui précède
 * (souvent rien) est le préfixe de dossier ; le fichier est `<préfixe><clé>-<empreinte>.js`. Une valeur
 * AVEC point est le nom de fichier entier, lu tel quel (fichier de groupe ou de page, alias dont le
 * fichier ne porte pas la clé). Tout fichier se termine par `.js` : le point est donc le marqueur, il
 * ne peut apparaître ni dans une empreinte ni dans un préfixe (l'écriture refuse alors la forme
 * compacte). Le manifeste publié recopie cette règle (`µPath`, writeManifest) : la changer ici sans
 * l'y changer casse tous les chargements.
 */
export function decodePathValue(cle: string, valeur: string): string {
  return valeur.includes('.') ? valeur : `${valeur.slice(0, -FINGERPRINT_LENGTH)}${cle}-${valeur.slice(-FINGERPRINT_LENGTH)}.js`
}

/** forme la plus courte d'un nom de fichier (sans préfixe d'URL) ; garantie : decodePathValue la rend à l'identique */
export function encodePathValue(cle: string, fichier: string): string {
  const m = /^(.*)-([0-9a-z]{5})\.js$/.exec(fichier)
  if (!m || !m[1].endsWith(cle)) return fichier
  const compact = m[1].slice(0, m[1].length - cle.length) + m[2]
  return !compact.includes('.') && decodePathValue(cle, compact) === fichier ? compact : fichier
}

/**
 * Nombre d'entrées à partir duquel la table se compacte (production). Le décodeur du manifeste pèse
 * ~190 octets bruts ; chaque entrée compactée perd sa clé répétée et `-` + `.js`. Mesuré sur des sous-tables
 * tirées au hasard du manifeste du site de référence (manifeste entier compressé, `gzip -9`) : le
 * gain devient positif à ~40 entrées (−20 octets à 32, +25 à 48, +155 à 96) ; en brut, dès ~9.
 * En dessous du seuil, la table entière reste la plus légère à l'envoi.
 */
export const PATHS_ENCODE_MIN_ENTRIES = 40

// --------------------------------------------------------------------------
// manifestBodyLines(pathsLine) : lignes du CORPS partagées par writeManifest() (mode
// 'split') ET emitSingleFile() (mode 'bundle', cf. buildBundleSetupBody()) — tout ce que
// le manifeste pose AVANT que les composants ne s'exécutent, SAUF DEUX choses qui diffèrent
// selon le mode et restent du ressort de chaque appelant : `µ.paths` lui-même (`pathsLine`,
// JSON réel en split, `import.meta.url` partagé en bundle) et `µ.Autoloader.observe` (juste
// après cette liste en split, après TOUS les composants en bundle — l'Autoloader ne doit
// chercher des enfants qu'une fois leurs propres `customElements.define` exécutés).
// EXTRAITE ici (refactor pur, sortie de writeManifest() INCHANGÉE à l'octet près, cf.
// tests/bundler-js-bundle.test.ts « défaut split ») plutôt que dupliquée : ce corps est
// long et déjà abondamment commenté ligne par ligne, une seule définition à tenir à jour.
// --------------------------------------------------------------------------
export function manifestBodyLines(bundler: Bundler, pathsLine: string): string[] {
  return [
    // Mode strict « politique de sécurité de contenu » (clé `csp`) — RIEN émis hors de ce
    // mode. Le runtime le lit pour choisir une feuille constructible là où il créait un
    // `<style>` : c'est une décision de BUILD, jamais un réglage à basculer à chaud, d'où
    // la propriété interne plutôt qu'une clé de `µ.config` (qui peut être forgé à la main).
    bundler.csp ? `µ._csp = true;` : '',
    // chaque ancre d'une même page, une entrée d'historique (clé `anchorHistory`) — RIEN émis sans elle : la navigation
    // (mjs_ujs.ts) lit `µ._anchorHistory` à chaque clic d'ancre, absent = une vraie page
    bundler.anchorHistory ? `µ._anchorHistory = true;` : '',
    pathsLine,
    // table nom de feuille → URL du `.css` haché. RIEN émis hors du mode
    // 'lazy' : le runtime ne teste `µ._cssLazy` que lorsque `µ.CSS[nom]` est absent,
    // ce qui n'arrive jamais dans les deux autres modes.
    bundler.cssMode === 'lazy' && Object.keys(bundler.lazyStyleUrls).length > 0 ? `µ._cssLazy = ${JSON.stringify(Object.fromEntries(Object.entries(bundler.lazyStyleUrls).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)))};` : '',
    `µ.preload = ${JSON.stringify(normalizePreload(bundler.preload))};`,
    // Niveau EFFECTIF de la console (clé `logLevel`, cf. resolveLogLevel/config.ts), CELUI de
    // CET environnement (dev ou prod selon la commande) — ÉMIS INCONDITIONNELLEMENT, comme
    // `µ.preload` juste au-dessus : la clé a toujours un défaut, jamais de bloc absent à gérer.
    // Consommé par `µ.log`/`µ.warn`/`µ.error` (mjs_init.ts).
    `µ._logLevel = ${JSON.stringify(bundler['currentLogLevel']())};`,
    // Libellés par défaut (fr/en) des petits bouts d'UI runtime (mjs_modal.ts, mjs_router.ts,
    // mjs_ujs.ts) — contrairement à `µ._i18nData` juste en dessous, ÉMIS INCONDITIONNELLEMENT :
    // ces libellés doivent être dans TOUS les builds, y compris les apps qui n'utilisent jamais
    // le module i18n optionnel. TOUTES les langues sont émises, plus une
    // seule figée au build : c'est le runtime qui choisit celle AFFICHÉE (`µ._mjs_label`,
    // mjs_init.ts) — un site basculé en anglais montrait des toasts « Succès »/« Erreur ».
    // `µ._runtimeLabelsLang` = langue de repli : celle du projet (`i18n.default`), sinon la
    // clé `lang` de mjs.config.json (cf. labelsLang). Le rendu serveur pose la même langue et la même table, sans les messages de la console.
    `µ._runtimeLabels = ${JSON.stringify(bundler.manifestLabels())};`,
    `µ._runtimeLabelsLang = ${JSON.stringify(bundler.labelsLang())};`,
    // adresse du fichier de messages de chaque langue (production seulement) : lue par le cœur au
    // premier message de la console. Nom SANS `_mjs_` : le manifeste n'est pas raccourci avec le cœur
    bundler['msgUrlsLine'](),
    (bundler.viewTransition && bundler.viewTransition !== 'none') ? `µ.viewTransition = ${JSON.stringify(bundler.viewTransition)};` : '',
    // i18n — RIEN émis si `sourceDir/i18n/` est absent
    // (scanI18n() laisse `i18nManifestData` à `undefined`, cf. compile()).
    // `µ._i18nRecheck` (cascade de modules — mjs_i18n.ts ne peut plus compter sur un
    // timing de microtâche implicite pour redécouvrir `µ._i18nData`, cf. son bandeau
    // détaillé) : même patron que `µ._themeAdopt` juste en dessous pour `µ._themeCss`.
    // `i18nPublicData()` et pas `i18nManifestData` : les dictionnaires et la table des
    // sections vivent dans le fichier de LEUR langue (cf. scanI18n) — ne reste ici que
    // de quoi CHOISIR la langue (`langs`) et aller chercher son fichier (`files`).
    bundler.i18nManifestData ? `µ._i18nData = ${JSON.stringify(bundler.i18nPublicData())}; if (typeof µ._i18nRecheck === 'function') { µ._i18nRecheck(); }` : '',
    // Thèmes de l'application (`*.theme.mjs`) — RIEN émis quand il n'y en a aucun.
    // `µ._themes` autorise la rune `µtheme` à accepter ces noms ; `µ._themeCss` est
    // adopté par `µ._themeAdopt()` (mjs_init.ts), appelé ici ET au boot du runtime,
    // pour que l'ordre de chargement manifeste/runtime n'ait aucune importance.
    bundler.themeNames.length > 0 ? `µ._themes = ${JSON.stringify(bundler.themeNames)};` : '',
    bundler.themeCss !== '' ? `µ._themeCss = ${JSON.stringify(bundler.themeCss)}; if (typeof µ._themeAdopt === 'function') { µ._themeAdopt(); }` : '',
    // `µ._themeCssByName` : jumeau de `µ._themeCss` ci-dessus, mais PAR THÈME (nom →
    // son propre css, cf. `themeVarData`, rempli par compileThemeFiles() avec un
    // `css` par CompiledTheme, bundler/themes.ts) — le rendu serveur en a besoin pour
    // inliner UN SEUL thème dans le <head> d'une page rendue au serveur, sans le CSS
    // des thèmes non utilisés par cette page. N'écarte rien de `µ._themeCss`.
    bundler.themeNames.length > 0 ? `µ._themeCssByName = ${JSON.stringify(Object.fromEntries(bundler['themeVarData'].map(td => [td.name, td.css])))};` : '',
    // Types et valeurs permises : ce que fait une valeur ramenée ou refusée en DÉVELOPPEMENT (clé
    // `types`, 'warn' par défaut) — RIEN émis en production (le runtime s'y tait), ni pour un
    // projet sans <vars> ni effet (le moteur des effets s'en sert pour un réglage tenu par une
    // variable, `*neon(size: $s)`). Nom SANS `_mjs_` : le manifeste n'est pas raccourci avec le cœur.
    !bundler['isProd']() && (bundler['pendingFeatures'].has('types') || bundler['pendingFeatures'].has('fx')) ? `µ._typesMode = ${JSON.stringify(bundler.typesMode ?? 'warn')};` : '',
    // Effets que MJS pose de lui-même (clé `effects` : thème en cercle, effets économes) — rien
    // quand la clé n'est pas écrite : le runtime prend ses défauts. Nom SANS `_mjs_`, comme au-dessus.
    bundler.effectsConf && Object.keys(bundler.effectsConf).length > 0 ? `µ._fxConf = ${JSON.stringify(bundler.effectsConf)};` : '',
    // la silhouette des composants dont le code arrive (cf. componentSkeletons) ; rien sans elle
    (() => {
      const skels = bundler['componentSkeletons']()
      return Object.keys(skels).length > 0 ? `µ._skels = ${JSON.stringify(skels).replace(/</g, '\\u003c')};` : ''
    })(),
  ].filter(l => l.length > 0)
}

// --------------------------------------------------------------------------
// pathsCompaction() : forme des valeurs de `µ.paths` — préfixe commun factorisé (`compact:
// true`, chaque valeur réduite à son basename) ou chemins entiers. Décision UNIQUE, partagée par
// writeManifest() (qui l'applique) et par bundler/startup.ts (dont la fiche `__mjs_page` doit
// poser des valeurs de la MÊME forme, sinon l'Autoloader recollerait le préfixe deux fois ou pas
// du tout). Repli PRUDENT sur la forme entière : préfixe vide ou réduit à `/` (les suffixes
// deviendraient des URLs RELATIVES à la page, plus du tout la même cible), ou une seule valeur
// qui n'en relève pas — rien à factoriser sans risque, on n'y touche pas.
// --------------------------------------------------------------------------
export function pathsCompaction(bundler: Bundler): { prefix: string; compact: boolean } {
  const prefix = `${bundler.urlPrefix}/`
  const values = Object.entries(bundler.manifest).filter(([k]) => k !== '__animations' && k !== '__styles' && k !== '__external').map(([, v]) => v)
  return { prefix, compact: bundler.urlPrefix.length > 1 && values.every(v => v.startsWith(prefix)) }
}

// --------------------------------------------------------------------------
// writeManifest() : écrit l'entrypoint `bundle_modular.js`
// --------------------------------------------------------------------------
export function writeManifest(bundler: Bundler): void {
  const animsPath = bundler.manifest['__animations']
  const stylesPath = bundler.manifest['__styles']
  const externalPath = bundler.manifest['__external']
  // mode 'bundle' (défaut) : chemin historique intact, `stylesPath`
  // (posé par bundleSharedStyles() dans this.manifest['__styles']) inchangé. Mode
  // 'split' : bundleSharedStyles() ne tourne jamais (cf. compile(), étape 2c) —
  // `stylesPath` reste undefined — le manifeste importe seulement mjs_root (toujours
  // eager) et les feuilles forcées eager par les DEUX filets de sécurité (aucun module
  // ne les déclare, OU un `<@view css="…">` les réclame — cf. finalizeSplitStyles) ;
  // chaque module qui déclare une feuille l'importe en plus lui-même (cf.
  // prependSplitCssImports, _compileMjsInner) — pour une feuille forcée eager PAR
  // AILLEURS DÉCLARÉE (raison 2 ci-dessus), les deux imports pointent le MÊME chemin
  // haché : l'ESM du navigateur ne l'exécute qu'une fois, `µ.CSS[nom]` posé une seule
  // fois (garde `if (!µ.CSS[nom])` en prime côté fichier émis).
  // en 'lazy', le manifeste n'importe QUE la feuille racine (adoptée sur
  // le document, personne ne la déclare) : les autres n'arrivent que quand un composant
  // les réclame, par leur URL publiée juste en dessous (`µ._cssLazy`).
  // TABLEAU (plus une seule chaîne `import '…';`) : chaque chemin sert AUSSI de
  // href de préchargement (cf. bloc `document` plus bas), en plus de son
  // `await import(…);` après le cœur.
  const stylesPaths: string[] = bundler.cssMode === 'split'
    ? [bundler.splitRootHashedPath, ...bundler.splitEagerHashedPaths].filter((p): p is string => !!p)
    : bundler.cssMode === 'lazy'
    ? (bundler.splitRootHashedPath ? [bundler.splitRootHashedPath] : [])
    : (stylesPath ? [stylesPath] : [])
  // On retire les clés internes du manifest exposé
  const rawPublicManifest = { ...bundler.manifest }
  delete rawPublicManifest['__animations']
  delete rawPublicManifest['__styles']
  delete rawPublicManifest['__external']
  // les fichiers d'effets (`mjs_fx_<nom>`, cf. compileFxChunks) : préchargés avec les composants qui
  // les importent (µDeps), importés à la demande par le moteur
  for (const [k, path] of bundler.fxChunkPaths) rawPublicManifest[k] = path
  // un composant groupé (`bundles`) se charge par le fichier de son groupe
  for (const [k, path] of bundler.groupPaths) rawPublicManifest[k] = path
  // ORDRE STABLE — les modules cœur entrent au manifeste dans l'ordre d'ARRIVÉE des
  // compilations PARALLÈLES (chaque fichier terminé annonce ce qu'il réclame) : deux
  // builds du même code produisaient un `µ.paths` identique au contenu près mais
  // PERMUTÉ, d'où un diff git bruyant à chaque build sur une ligne de 90 000
  // caractères. On y cherche toujours par nom, jamais par rang — le tri n'a aucun
  // effet fonctionnel. Comparaison par point de code (pas `localeCompare`, dépendant
  // de la locale de la machine : le tri doit être le MÊME partout)
  const publicManifest = Object.fromEntries(Object.entries(rawPublicManifest).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0))
  // PRÉFIXE FACTORISÉ — toutes les valeurs commencent par le même `<urlPrefix>/`
  // (writeHashed), répété autant de fois qu'il y a de composants : 1 398 entrées sur un
  // vrai site, 37 Ko de préfixe recopié dans une ligne servie sur CHAQUE page. Publié une
  // seule fois (`µ.pathsPrefix`, posé juste avant `µ.paths`), les valeurs ne gardent que
  // leur suffixe ; qui lit un CHEMIN recolle les deux (Autoloader, bloc de préchargement
  // ci-dessous). Les CLÉS ne bougent pas — c'est tout ce que lit mjs_ujs.ts.
  // La décision elle-même (et son repli prudent) vit dans pathsCompaction() ci-dessus : le
  // fichier de page d'une route prérendue (bundler/startup.ts) doit poser la MÊME forme.
  const { prefix: pathsPrefix, compact: compactable } = bundler.pathsCompaction()
  const basenamePaths = compactable
    ? Object.fromEntries(Object.entries(publicManifest).map(([k, v]) => [k, v.slice(pathsPrefix.length)]))
    : publicManifest
  // forme COMPACTE des valeurs (cf. encodePathValue) : production seulement, et seulement quand la
  // table est assez grosse pour payer le décodeur `µPath` (PATHS_ENCODE_MIN_ENTRIES) ; sinon table entière
  const encodedPaths = compactable && bundler['isProd']() && Object.keys(basenamePaths).length >= PATHS_ENCODE_MIN_ENTRIES
  const emittedPaths = encodedPaths
    ? Object.fromEntries(Object.entries(basenamePaths).map(([k, v]) => [k, encodePathValue(k, v)]))
    : basenamePaths
  // même tri, même raison — `this.manifestDeps` (buildManifestDeps) est déjà trié
  // clé par clé, mais chaque VALEUR (tableau de noms) l'est aussi (cf. son commentaire) :
  // rien à refaire ici, JSON.stringify respecte l'ordre d'insertion des deux.
  const manifestDeps = bundler.manifestDeps

  // cascade de modules à 3 niveaux et plus (mesuré sur l'appli météo du banc : 8 niveaux,
  // le navigateur découvrait le cœur PUIS chaque composant un par un, à la file) —
  // `bundle.js` n'importe donc plus le cœur STATIQUEMENT : un import statique aurait
  // forcé le navigateur à résoudre TOUT le graphe ESM (cœur, feuilles, animations,
  // manifeste externe) avant d'exécuter la moindre ligne de ce fichier, la découverte des
  // composants de la page (Autoloader) ne démarrant qu'ENSUITE, en série avec chaque import
  // suivant. `µCore` reste un littéral de chaîne (le layout Rails du site le cherche par
  // regex, cf. tête de fichier) : le cœur est désormais `import()`é DYNAMIQUEMENT, APRÈS
  // avoir posé des `<link rel="modulepreload">` pour lui, les feuilles/animations/manifeste
  // externe (toujours eager, quelle que soit la page) ET les composants DÉJÀ présents dans
  // le document au moment de l'exécution + la FERMETURE de leurs dépendances directes
  // (`µDeps`, cf. buildManifestDeps) — le navigateur télécharge tout ça EN PARALLÈLE pendant
  // que le cœur s'exécute, au lieu de le découvrir un par un après coup. Sans `document`
  // (moteur de rendu serveur sans DOM, cf. renderToString.ts qui n'exécute d'ailleurs jamais
  // CE fichier tel quel) : aucun préchargement, seul l'import du cœur reste inconditionnel.
  const eagerHrefsLiteral = [bundler.coreHashedPath, ...stylesPaths, ...(animsPath ? [animsPath] : []), ...(externalPath ? [externalPath] : [])]
    .map(p => JSON.stringify(p)).join(', ')
  // Fiche du FICHIER DE PAGE (`render.startup: 'bundle'`, cf. bundler/startup.ts) : le fragment
  // prérendu porte, quand il en a un, un `<script type="application/json" id="__mjs_page">`
  // nommant le fichier qui assemble LES COMPOSANTS DE CETTE PAGE et les noms qu'il définit. Chaque
  // nom est repointé sur ce fichier AVANT le bloc de préchargement juste en dessous (qui ne
  // redemande donc aucun fichier séparé déjà assemblé) et avant `µ.paths` plus bas (l'Autoloader
  // importe alors le fichier de page, déjà en cache, qui définit tous ces composants d'un coup).
  // Fiche absente (autre mode, autre page, rendu sans DOM) ou JSON abîmé : rien de posé, la table
  // reste celle du manifeste — jamais d'exception, la page doit démarrer quoi qu'il arrive.
  const pageBlock = [
    `let _mjs_page = null;`,
    `if (typeof document !== 'undefined') {`,
    `  const _mjs_pageTag = document.getElementById('__mjs_page');`,
    `  try { _mjs_page = _mjs_pageTag ? JSON.parse(_mjs_pageTag.textContent) : null; } catch (e) { _mjs_page = null; }`,
    `}`,
    // la fiche ne peut désigner qu'un fichier de page du site : jamais une adresse à schéma ni `//hôte`
    `if (_mjs_page && typeof _mjs_page.file === 'string' && /^(?!\\/\\/)[\\w.\\/-]*mjs_page-[\\w.-]+\\.js$/.test(_mjs_page.file) && Array.isArray(_mjs_page.names)) { _mjs_page.names.forEach((n) => { µPaths[n] = _mjs_page.file; }); }`,
  ].join('\n')
  const preloadBlock = [
    `if (typeof document !== 'undefined') {`,
    `  const µHrefs = new Set([${eagerHrefsLiteral}]);`,
    `  const µSeen = new Set();`,
    `  const µWalkDeps = (name) => {`,
    `    if (µSeen.has(name)) return;`,
    `    µSeen.add(name);`,
    // valeurs COMPACTES (préfixe factorisé, cf. `pathsPrefix` plus haut) : un href se
    // recolle ici, comme l'Autoloader le fait de son côté (`µPath` quand la table est encodée).
    ...(encodedPaths ? [
      `    const path = µPath(name);`,
      `    if (path) µHrefs.add(path);`,
    ] : [
      `    const path = Object.prototype.hasOwnProperty.call(µPaths, name) && µPaths[name];`,
      `    if (path) µHrefs.add(µPathsPrefix + path);`,
    ]),
    // les dépendances propres d'une balise : une balise inconnue n'en a aucune, jamais une valeur héritée d'un prototype pollué
    `    (Object.prototype.hasOwnProperty.call(µDeps, name) ? µDeps[name] : []).forEach(µWalkDeps);`,
    `  };`,
    // même sélecteur/même critère que µ.Autoloader.observe (mjs_autoloader.ts) : les
    // tags CUSTOM ELEMENT `mjs-*` déjà présents dans le document (HTML statique ou
    // rendu serveur) au moment où ce script s'exécute — jamais ceux qu'un `{for}`/`{if}`
    // insérera PLUS TARD (l'Autoloader, plus bas, les rattrape normalement).
    `  document.body.querySelectorAll(':not(:defined)').forEach((node) => {`,
    `    if (node.tagName && node.tagName.startsWith('MJS-')) µWalkDeps(node.tagName.slice(4).toLowerCase());`,
    `  });`,
    `  µHrefs.forEach((href) => {`,
    `    const link = document.createElement('link');`,
    `    link.rel = 'modulepreload';`,
    `    link.href = href;`,
    `    document.head.appendChild(link);`,
    `  });`,
    `}`,
  ].join('\n')
  // `µ.Autoloader.preload(nom)` : charge d'avance, sans l'exécuter, le fichier d'un composant et ceux de toute
  // sa descendance (`µDeps`, fichiers d'effets compris). Émise SEULEMENT quand le build voit l'appel dans le
  // projet (signaux AUTOLOADER_MENTION et PRELOAD_MENTION) : une appli qui n'appelle jamais `preload` ne paie rien. Même
  // lecture du nom que `load` (minuscules, `mjs-` retiré) ; un nom inconnu ne fait rien. Un fichier déjà
  // demandé — par un appel précédent, ou par un lien `modulepreload` déjà dans la page (en-tête de page
  // prérendue, bloc de préchargement ci-dessus) — n'est pas redemandé ; un composant déjà défini non plus.
  // Les valeurs de `µPaths` sont COMPACTES : le préfixe se recolle ici, comme le fait l'Autoloader.
  const preloadFn = bundler['preloadCalled'] ? [
    `const µAsked = new Set();`,
    `const µPreload = (name) => {`,
    `  if (typeof document === 'undefined') return;`,
    `  const µHas = (table, key) => Object.prototype.hasOwnProperty.call(table, key);`,
    `  const raw = String(name);`,
    `  const key = raw.toLowerCase().replace(/^mjs-/, '');`,
    `  const root = µHas(µPaths, key) ? key : (µHas(µPaths, raw) ? raw : null);`,
    `  if (root === null) return;`,
    `  const present = new Set(Array.from(document.querySelectorAll('link[rel="modulepreload"]')).map((l) => l.href));`,
    `  const seen = new Set();`,
    `  const walk = (n) => {`,
    `    if (seen.has(n)) return;`,
    `    seen.add(n);`,
    `    if (µHas(µPaths, n) && !(typeof customElements !== 'undefined' && customElements.get('mjs-' + n.toLowerCase()))) {`,
    encodedPaths ? `      const path = µPath(n);` : `      const path = µPathsPrefix + µPaths[n];`,
    `      const href = new URL(path, document.baseURI).href;`,
    `      if (!µAsked.has(href) && !present.has(href)) {`,
    `        µAsked.add(href);`,
    `        const link = document.createElement('link');`,
    `        link.rel = 'modulepreload';`,
    `        link.href = path;`,
    `        document.head.appendChild(link);`,
    `      }`,
    `    }`,
    `    if (µHas(µDeps, n)) µDeps[n].forEach(walk);`,
    `  };`,
    `  walk(root);`,
    `};`,
  ].join('\n') : ''
  // `import '<chemin>';` STATIQUE → `import('<chemin>')` DYNAMIQUE : ces fichiers
  // importent eux-mêmes le cœur (déjà résolu à ce point, l'ESM du navigateur ne l'exécute
  // qu'une fois, cf. tête de fichier) — les laisser statiques aurait réintroduit l'attente
  // du cœur avant tout le reste. Styles + animations en `Promise.all` (PAS un `await`
  // par fichier, séquentiel) : régression mesurée (tests/render-browser.test.ts, rendu
  // Chromium réel) — un `await` par chemin sérialise leurs ALLERS-RETOURS réseau, quand
  // le graphe ESM statique d'avant les résolvait tous EN PARALLÈLE (déjà préchargés par
  // le bloc `modulepreload` plus haut de toute façon ; la sérialisation était donc un
  // pur coût ajouté par CE fichier, pas un besoin réel — aucune dépendance entre eux).
  const eagerAsyncPaths = [...stylesPaths, ...(animsPath ? [animsPath] : [])]
  const stylesImport = eagerAsyncPaths.length > 0
    ? `await Promise.all([${eagerAsyncPaths.map(p => `import(${JSON.stringify(p)})`).join(', ')}]);`
    : ''
  const externalImport = externalPath ? `await import(${JSON.stringify(externalPath)});` : ''

  const bodyLines = [
    stylesImport,
    // Préfixe commun des chemins (cf. `pathsPrefix` plus haut) — posé AVANT `µ.paths`,
    // donc avant que le moindre consommateur ne tourne : l'Autoloader recolle
    // `µ.pathsPrefix + µ.paths[nom]` (mjs_autoloader.ts). Rien d'émis quand la
    // factorisation n'est pas sûre : le runtime lit alors un préfixe absent (chaîne
    // vide) et les valeurs sont déjà des chemins entiers.
    compactable ? `µ.pathsPrefix = ${JSON.stringify(pathsPrefix)};` : '',
    // `µPaths` (déjà posé plus haut, réutilisé pour le préchargement) plutôt qu'un
    // 2e JSON.stringify — la ligne reste `µ.paths = …;`, cherchée par ce nom précis
    // ailleurs (recoverFailedComponentManifest ci-dessous, readBuildVersion,
    // extractJsonAfter côté ssr-head.ts, splice de µ.version juste plus bas).
    ...bundler['manifestBodyLines'](`µ.paths = µPaths;`),
    // le cœur lit les chemins par µ.pathOf : même décodeur que le manifeste (table encodée)
    encodedPaths ? `µ.pathOf = µPath;` : '',
    // les dépendances directes, lues par l'Autoloader : les fichiers d'effets d'un composant partent
    // en même temps que lui (cf. µ._mjs_fxPrefetch, mjs_fx.ts)
    bundler.fxChunkPaths.size > 0 ? `µ.deps = µDeps;` : '',
    externalImport,
    bundler['preloadCalled'] ? `if (µ.Autoloader) { µ.Autoloader.preload = µPreload; }` : '',
    `if (µ.Autoloader) { µ.Autoloader.observe(document.body); }`,
  ].filter(l => l.length > 0)
  // Utilisait `NODE_ENV` directement
  // (2e définition de "prod", divergente de `isProd()`/`shouldEmitSourceMap()`
  // ci-dessus) : cf. le commentaire détaillé de `isProd()`.
  if (!bundler['isProd']()) {
    bodyLines.push(`window.µ = µ;`)
  }
  // DÉPART DE LA PAGE PENDANT LE DÉMARRAGE — le cœur, et ce que le corps importe après lui (feuilles, animations, manifeste
  // externe), coupé parce que le visiteur s'en va n'est pas une panne : Firefox et Safari coupent ce qui est en vol dès que
  // la navigation part (juste après `beforeunload`), la page restant affichée jusqu'à la réponse de la suivante, et
  // l'échec non rattrapé de `µReady` s'écrivait en erreur (« error loading dynamically imported module … mjs_core-….js »).
  // L'aide du cœur (`µ._mjs_loadFailed`, mjs_init.ts) ne peut rien pour le cœur lui-même : la règle est appliquée ici.
  // Départ annoncé par `beforeunload`, écouté seulement tant que le démarrage est en vol (en permanence, il priverait la
  // page du cache de navigation de Firefox), ou par `pagehide`. Échec après l'annonce d'un départ : rien, quel que soit le
  // temps que met la page suivante — rien ne distingue une page suivante lente d'un départ resté sans suite (réponse 204,
  // téléchargement), et une erreur écrite au bout d'un délai fixe l'était sous un visiteur parti ; sans départ, l'échec se
  // dit tout de suite, la même erreur qu'avant (rejet non rattrapé). Posées APRÈS `µReady`, dans la même tâche (aucun
  // événement ne passe entre les deux) : le prologue et le corps de `µReady` restent tels qu'on les découpe ailleurs
  const departLines = [
    `if (typeof addEventListener === 'function') {`,
    `  let µLeft = false;`,
    `  const µLeave = () => { µLeft = true; };`,
    `  addEventListener('beforeunload', µLeave);`,
    `  addEventListener('pagehide', µLeave);`,
    `  µReady.then(() => removeEventListener('beforeunload', µLeave), (err) => {`,
    `    removeEventListener('beforeunload', µLeave);`,
    `    if (!µLeft && !(err && err.name === 'AbortError')) throw err;`,
    `  });`,
    `}`,
  ]
  // Le corps entier (styles/anims/csp/paths/…/Autoloader.observe) tourne APRÈS la
  // résolution du cœur, dans un `.then()` — JAMAIS un top-level `await` : `bundle.js`
  // resterait alors évaluable tel quel dans un script CLASSIQUE (`eval`, harnais de
  // test — stripEsm/renderToString.ts, tests qui `window.eval()` core+manifest en
  // happy-dom) — un top-level `await` y est une ERREUR DE SYNTAXE (grammaire réservée
  // aux vrais modules ES, `eval()` évalue toujours en grammaire "script"). Une fonction
  // ASYNC ordinaire passée à `.then()` reste, elle, valide PARTOUT.
  // `µReady` exposée sur `window` (SEULEMENT s'il existe) : un IMPORTEUR STATIQUE de ce
  // fichier (`import '/__mjs/bundle.js';`, cf. render-browser.ts) voit son évaluation
  // reprendre dès la fin du corps SYNCHRONE de bundle.js (l'appel `.then()` posé, pas la
  // promesse résolue) — sans ce signal explicite, un tel importeur ne peut pas savoir
  // quand le cœur + les composants de la page sont réellement prêts.
  const lines = [
    `const µCore = '${bundler.coreHashedPath}';`,
    `const µPathsPrefix = ${JSON.stringify(compactable ? pathsPrefix : '')};`,
    `const µPaths = ${JSON.stringify(emittedPaths)};`,
    // décodeur de la table encodée (règle : cf. decodePathValue) — total : clé inconnue, clé du prototype → '' ;
    // une clé propre seulement : un nom posé par un prototype pollué est inconnu, jamais une adresse importée
    ...(encodedPaths ? [`const µPath = (n) => { const v = Object.prototype.hasOwnProperty.call(µPaths, n) ? µPaths[n] : null; return typeof v === 'string' ? µPathsPrefix + (v.includes('.') ? v : v.slice(0, -5) + n + '-' + v.slice(-5) + '.js') : ''; };`] : []),
    `const µDeps = ${JSON.stringify(manifestDeps)};`,
    pageBlock,
    preloadBlock,
    ...(preloadFn ? [preloadFn] : []),
    `const µReady = import(µCore).then(async ({ µ }) => {`,
    ...bodyLines.map(l => `  ${l}`),
    `});`,
    `if (typeof window !== 'undefined') { window.__mjsBundleReady = µReady; }`,
    ...departLines,
  ]
  // (protocole de navigation) — id de build GLOBAL, dérivé du CONTENU
  // assemblé ci-dessus (SAUF la ligne de version elle-même) : même style que
  // writeHashed (md5), jamais une horloge → même build = même id, un seul
  // asset qui change = id différent. La garde skip-si-identique juste plus bas
  // reste cohérente par construction (contenu identique ⇒ id identique ⇒ ligne
  // insérée identique). `lastBuildId` posé à CHAQUE writeManifest, y compris
  // quand l'écriture est skippée (id déjà correct, recalculé à l'identique).
  const buildId = createHash('md5').update(lines.join('\n')).digest('hex').slice(0, 8)
  bundler.lastBuildId = buildId
  // `.trim()` : la ligne vit maintenant DANS le corps indenté de 2 espaces (cf. bodyLines.map ci-dessus).
  const pathsLineIdx = lines.findIndex(l => l.trim().startsWith('µ.paths = '))
  lines.splice(pathsLineIdx + 1, 0, `  µ.version = "${buildId}";`)
  if (!existsSync(dirname(bundler.manifestPath))) {
    mkdirSync(dirname(bundler.manifestPath), { recursive: true })
  }
  // Écrivait INCONDITIONNELLEMENT, à
  // CHAQUE compile, même si le contenu généré est BYTE-POUR-BYTE identique
  // à ce qui est déjà sur disque. Cas concret : `manifestPath` configuré
  // (par erreur, ou par nécessité selon l'hébergement) SOUS `sourceDir` —
  // sous `watch()`, cette écriture-sans-changement touche quand même le
  // fichier (nouveau mtime/inode), le watcher la détecte comme une
  // modification, redéclenche un compile(), qui réécrit le manifest à
  // l'identique, qui redéclenche le watcher… boucle de recompilation
  // infinie. Fix : lit le contenu existant et skip l'écriture si identique
  // (comportement fonctionnel inchangé pour tout le reste — seul le
  // TOUCHER inutile du fichier est évité).
  // construction qui écrit dans le dossier des sources : la marque en première ligne (cf. sortieDuBuild), hors de l'id de build
  const newContent = (bundler['ecritDansSources']() ? `${MARQUE_SORTIE}\n` : '') + lines.join('\n')
  if (existsSync(bundler.manifestPath)) {
    const current = readFileSync(bundler.manifestPath, 'utf-8')
    if (current === newContent) return
  }
  // garde-fou ESM (cf. assertValidEsm) — bundle_modular.js est lui aussi du
  // JS émis, même exposé au risque « build vert qui ment ».
  bundler['assertValidEsm'](newContent, basename(bundler.manifestPath))
  bundler['writeFileAtomicAlways'](bundler.manifestPath, newContent)
}

// --------------------------------------------------------------------------
// bundleUnitOrder() : mode 'bundle' — ordre d'import des unités dans `mjs:entry`, ENFANTS
// AVANT PARENTS (tri topologique inverse de `this.manifestDeps`, cf. buildManifestDeps()) :
// un parent se définit APRÈS ses enfants, l'upgrade d'un élément déjà présent dans la page
// (rendu serveur, HTML statique) trouve alors ses enfants déjà définis. Post-ordre DFS,
// départ trié par stem (déterministe) ; `mjs_external` EXCLU (importé séparément, à part,
// juste après styles/animations — cf. buildBundleEntry()) ; une dep absente de
// `this.pendingUnits` (échouée, ou résolue autrement) est simplement ignorée, jamais suivie.
// --------------------------------------------------------------------------
export function bundleUnitOrder(bundler: Bundler): string[] {
  const stems = [...bundler['pendingUnits'].keys()].filter(s => s !== 'mjs_external').sort((a, b) => a < b ? -1 : a > b ? 1 : 0)
  const order: string[] = []
  const done = new Set<string>()
  const visiting = new Set<string>()
  const visit = (stem: string): void => {
    if (done.has(stem) || visiting.has(stem)) return  // déjà placé, ou cycle (rompu ailleurs) : jamais revisité
    visiting.add(stem)
    for (const dep of [...(bundler.manifestDeps[stem] ?? [])].sort((a, b) => a < b ? -1 : a > b ? 1 : 0)) {
      if (bundler['pendingUnits'].has(dep)) visit(dep)
    }
    visiting.delete(stem)
    done.add(stem)
    order.push(stem)
  }
  // un module chargé à la demande n'est pas importé d'office par l'entrée : un composant qui l'`@import`e le tire
  // par ses dépendances (visit ci-dessus), sinon il sort dans son propre fichier (cf. runBundleEsbuild) ; de même un module que
  // seuls des modules chargés à la demande importent
  const reserves = bundler['bundleLazyOnlyModules']()
  for (const stem of stems) if (!bundler['bundleLazyStems'].has(stem) && !reserves.has(stem)) visit(stem)
  return order
}

// --------------------------------------------------------------------------
// bundleLazyOnlyModules() : mode 'bundle' avec des modules chargés à la demande — les modules (.civet/.coffee) que SEULS des
// modules chargés à la demande atteignent par un `import` statique. L'entrée ne les importe pas d'office : ils partent avec ceux
// qui les importent, téléchargés et évalués à l'appel. Un module que l'entrée atteint aussi — par un composant qui l'`@import`,
// par un module importé d'office — reste dans l'entrée ou dans le morceau partagé : une seule instance, comme avant. Lu sur le
// code final des unités (`import … from 'mjs:unit/<stem>'` est un lien statique ; `import('mjs:unit/<stem>')` est l'appel à la
// demande, pas un lien).
// --------------------------------------------------------------------------
export function bundleLazyOnlyModules(bundler: Bundler): Set<string> {
  const reserves = new Set<string>()
  if (bundler['bundleLazyStems'].size === 0) return reserves
  const re        = /(\bimport\s*\(\s*)?(['"])mjs:unit\/([^'"]+)\2/g
  const statiques = new Map<string, string[]>()
  const liens     = (stem: string): string[] => {
    let l = statiques.get(stem)
    if (!l) {
      l = []
      for (const m of (bundler['bundleVirtualSources'].get(stem) ?? '').matchAll(re)) if (!m[1]) l.push(m[3])
      statiques.set(stem, l)
    }
    return l
  }
  const fermeture = (depart: Iterable<string>): Set<string> => {
    const vus  = new Set<string>()
    const pile = [...depart]
    while (pile.length > 0) {
      const s = pile.pop()!
      if (vus.has(s)) continue
      vus.add(s)
      for (const d of liens(s)) pile.push(d)
    }
    return vus
  }
  const estModule = (stem: string): boolean => /\.(?:civet|coffee)$/.test(bundler['pendingUnits'].get(stem)?.file ?? '')
  const candidats = new Set([...fermeture(bundler['bundleLazyStems'])].filter(s => !bundler['bundleLazyStems'].has(s) && estModule(s)))
  const atteints  = fermeture([...bundler['bundleVirtualSources'].keys()].filter(s => !bundler['bundleLazyStems'].has(s) && !candidats.has(s)))
  for (const s of candidats) if (!atteints.has(s)) reserves.add(s)
  return reserves
}

// --------------------------------------------------------------------------
// buildBundleSetupBody() : mode 'bundle' — corps du module virtuel 'mjs:setup' (importe
// 'mjs:core', pose tout ce que le manifeste éclaté pose AVANT ses composants), SAUF
// `µ.Autoloader.observe` (déplacé dans `mjs:entry`, APRÈS l'import de tous les composants —
// cf. buildBundleEntry()) ET sans la ligne `µ.version` (posée par l'appelant, cf.
// writeBundleManifest() : dépend du hash de TOUT le contenu, elle-même comprise). `µ.paths` :
// CHAQUE nom du projet pointe vers `import.meta.url` — le fichier lui-même (un fichier UNIQUE
// sert tout le monde ; un `import()` d'une URL déjà chargée est un no-op pour le navigateur) —
// SEUL l'ensemble des CLÉS compte, jamais les valeurs de `this.manifest` (repères résolus en
// spécificateurs virtuels par emitSingleFile(), plus jamais lus après ce point).
// --------------------------------------------------------------------------
export function buildBundleSetupBody(bundler: Bundler): string {
  const publicNames = Object.keys(bundler.manifest)
    .filter(k => k !== '__styles' && k !== '__animations' && k !== '__external')
    .sort((a, b) => a < b ? -1 : a > b ? 1 : 0)
  const pathsLine = `const µSelfUrl = import.meta.url;\nµ.paths = { ${publicNames.map(n => `${JSON.stringify(n)}: µSelfUrl`).join(', ')} };`
  const lines = bundler['manifestBodyLines'](pathsLine)
  if (!bundler['isProd']()) lines.push(`window.µ = µ;`)
  return lines.join('\n')
}

// --------------------------------------------------------------------------
// buildBundleEntry(unitOrder) : mode 'bundle' — corps du module virtuel 'mjs:entry' (SEUL
// point d'entrée réel du fichier assemblé, `entryPoints: ['mjs:entry']` d'esbuild.build(),
// cf. runBundleEsbuild() — jamais un `stdin` qui l'IMPORTERAIT : esbuild ne garde les EXPORTS
// d'un module que s'il est LUI-MÊME le point d'entrée, un simple `import 'mjs:entry';` depuis
// un stdin wrapper les aurait fait passer pour un intermédiaire inutilisé et les aurait
// supprimés au tree-shaking — `export { µ };` disparaissait entièrement, mesuré). Importe le
// cœur (pour `µ.Autoloader`/l'export final), le setup,
// styles/animations/manifeste externe s'ils existent, PUIS chaque unité du projet dans
// `unitOrder` (enfants avant parents) — TOUT est statique et eager, contrairement au manifeste
// éclaté (plus de cascade à découvrir : un seul fichier, déjà tout chargé). Le corps ne
// s'exécute jamais dans un `.then()` : rien n'est plus async à attendre (le cœur n'est plus un
// import DYNAMIQUE d'un AUTRE fichier, cf. bandeau de bundleRuntime()) — `__mjsBundleReady`
// est donc directement une promesse déjà résolue (contrat lu par render-browser.ts).
// --------------------------------------------------------------------------
export function buildBundleEntry(bundler: Bundler, unitOrder: string[]): string {
  const lines: string[] = [`import { µ } from 'mjs:core';`, `import 'mjs:setup';`]
  if (bundler.manifest['__styles']) lines.push(`import 'mjs:styles';`)
  if (bundler.manifest['__animations']) lines.push(`import 'mjs:anims';`)
  if (bundler['pendingUnits'].has('mjs_external')) lines.push(`import 'mjs:unit/mjs_external';`)
  for (const stem of unitOrder) lines.push(`import 'mjs:unit/${stem}';`)
  // µ.Autoloader n'est du cœur qu'en 'split' (cf. resolveRuntimeFiles) : ici il n'y est que
  // demandé explicitement (`runtime: ['autoloader']`), et on garde alors son observer. Sans lui,
  // un contrôle UNIQUE remplace son seul apport dans ce mode — signaler une balise `mjs-*` que
  // ce fichier ne définit pas (faute de frappe, composant oublié du projet) : tous les
  // `customElements.define` ont déjà tourné au-dessus, tout ce qui reste `:not(:defined)` avec
  // ce préfixe est inconnu pour de bon. Les balises insérées PLUS TARD ne sont pas suivies (pas
  // d'observer) : il n'y aurait rien à charger pour elles non plus. Ce contrôle ne sert qu'à un avertissement : aux niveaux de
  // production qui retirent ceux du framework ('error', 'silent', cf. runtimeCallsCut), il ne s'écrit pas
  const warns = !(bundler['isProd']() && bundler.shouldMinify() && runtimeCallsCut(bundler['prodLogLevel']()).includes('warn'))
  lines.push(`if (typeof document !== 'undefined') {`)
  lines.push(`  if (µ.Autoloader) { µ.Autoloader.observe(document.body); }`)
  if (warns) lines.push(`  else { document.querySelectorAll(':not(:defined)').forEach((n) => { if (n.tagName.indexOf('MJS-') === 0) µ.warn('[ModularJS] <' + n.tagName.toLowerCase() + '> inconnue : aucun composant de ce nom dans le fichier unique'); }); }`)
  lines.push(`}`)
  lines.push(`if (typeof window !== 'undefined') { window.__mjsBundleReady = Promise.resolve(); }`)
  lines.push(`export { µ };`)
  return lines.join('\n')
}

// --------------------------------------------------------------------------
// runBundleEsbuild() : mode 'bundle' — assemble `this.bundleVirtualSources` (cœur, styles,
// animations, manifeste externe, setup, entry, chaque unité) en UN SEUL module ES, via
// esbuild.build() EN MÉMOIRE (`write: false`, jamais le disque). Plugin `onResolve`/`onLoad` :
// tout spécificateur `mjs:...` est résolu dans le namespace `mjsv` et servi depuis
// `this.bundleVirtualSources` — un spécificateur SANS entrée est un bogue du bundler (aucun
// ne devrait jamais atteindre ce point, `emitSingleFile()` en garantit l'existence pour
// chaque unité), jamais une 404 silencieuse. Options MIROIR de `minifyJs()` (cf. minify.ts) :
// même `define`/`pure`/`mangleProps`, `mangleCache` PARTAGÉ sous le MÊME verrou
// (`withMangleCacheLock`) que les minifications de phase A — cohérence du mangle de props
// `_mjs_*` garantie même si rien de neuf ne reste à mangler ici (déjà fait par unité).
// --------------------------------------------------------------------------
export async function runBundleEsbuild(bundler: Bundler): Promise<{ code: string; map?: string; chunks: Array<{ name: string; code: string; map?: string }> }> {
  const sources = bundler['bundleVirtualSources']
  const virtualPlugin = {
    name: 'mjs-virtual-bundle',
    setup: (b: any) => {
      b.onResolve({ filter: /^mjs:/ }, (args: any) => ({ path: args.path, namespace: 'mjsv' }))
      b.onLoad({ filter: /.*/, namespace: 'mjsv' }, (args: any) => {
        const key = args.path === 'mjs:core' ? 'mjs_core'
          : args.path === 'mjs:styles' ? 'mjs_styles'
          : args.path === 'mjs:anims' ? 'mjs_anims'
          : args.path === 'mjs:setup' ? 'mjs_setup'
          : args.path === 'mjs:entry' ? 'mjs_entry'
          : args.path.startsWith('mjs:unit/') ? args.path.slice('mjs:unit/'.length)
          : null
        const contents = key !== null ? sources.get(key) : undefined
        if (contents === undefined) {
          throw new Error(t('bundler.index.js-bundle-module-virtuel-introuvable', { specificateur: args.path }))
        }
        return { contents, loader: 'js' }
      })
    },
  }
  const shouldMinify = bundler.shouldMinify()
  const wantsMap = bundler.shouldEmitSourceMap()
  // des modules chargés à la demande (µimport d'un module, cf. lazyModuleImports) : esbuild coupe l'assemblage à chaque import
  // dynamique — l'entrée garde le nom du manifeste, chaque module chargé à la demande sort dans son fichier, et le code que
  // l'entrée et ces modules partagent (le cœur, un module `@import`é des deux côtés) dans un fichier à part, importé par les
  // deux : une seule instance de chaque module. Sans eux, un seul fichier, comme toujours
  const lazy      = bundler['bundleLazyStems'].size > 0
  const entryName = basename(bundler.manifestPath).replace(/\.js$/, '')
  const runOnce = () => esbuildBuild({
    entryPoints: lazy ? { [entryName]: 'mjs:entry' } : ['mjs:entry'],
    absWorkingDir: bundler['root'],
    ...(lazy ? { outdir: 'mjs-bundle', splitting: true, entryNames: '[name]', chunkNames: '[name]-[hash]' } : { outfile: basename(bundler.manifestPath) }),
    bundle: true,
    write: false,
    format: 'esm',
    target: 'es2022',
    // Sans ceci, esbuild échappe TOUT non-ASCII en `\uXXXX` (y compris le sigil `µ` lui-même,
    // qu'il minifie ou non) — un manifeste 'bundle' ne contenait alors plus jamais le
    // caractère littéral `µ`, cassant tout lecteur regex du manifeste (readBuildVersion,
    // server/build-version.ts) et rendant la sortie visuellement méconnaissable face au
    // manifeste éclaté (jamais échappé, cf. writeManifest()). `charset: 'utf8'` aligne les deux.
    charset: 'utf8',
    treeShaking: true,
    minify: shouldMinify,
    define: { 'µ.debug': 'false' },
    // en développement, minifié ou non, rien n'est retiré : le niveau de la console s'applique à l'exécution
    pure: bundler['isProd']() ? buildPureList(bundler['prodLogLevel']()) : [],
    mangleProps: shouldMinify ? /^_mjs_/ : undefined,
    mangleCache: shouldMinify ? bundler.mangleCache : undefined,
    keepNames: false,
    legalComments: 'none',
    // Filet pour server/build-version.ts (readBuildVersion) : en prod, esbuild MINIFIE aussi
    // les IDENTIFIANTS — le sigil `µ` porté par `mjs:setup` (`µ.version = "…";`) devient un nom
    // court QUELCONQUE (`n.version="…"`, cf. son bandeau), le texte littéral `µ.version` ne
    // survit alors nulle part. Un `footer` esbuild est ajouté APRÈS la passe de minification,
    // donc JAMAIS renommé/compacté : sert de repère STABLE, lisible sans exécuter le fichier,
    // quel que soit le nom que `µ` a fini par prendre à l'intérieur. Coupé en morceaux, le pied ne va QUE sur l'entrée
    // (ajouté plus bas) : sur chaque morceau il changerait à chaque build et renommerait, avec l'empreinte du contenu, un
    // module qu'aucune édition n'a touché.
    footer: lazy ? undefined : { js: `//# mjsVersion=${bundler.lastBuildId ?? ''}` },
    sourcemap: wantsMap ? 'external' : false,
    logLevel: 'silent',
    plugins: [virtualPlugin],
  })
  let result: Awaited<ReturnType<typeof esbuildBuild>>
  try {
    result = shouldMinify ? await withMangleCacheLock(bundler.mangleCache, runOnce) : await runOnce()
  } catch (e: any) {
    throw new Error(t('bundler.index.js-bundle-echec', { raison: e?.message ?? String(e) }))
  }
  // esbuild N'AJOUTE PAS ses nouvelles entrées AU mangleCache passé — il ne fait que les
  // RENDRE dans `result.mangleCache` (mesuré, même contrat que transform()/minifyJs()) :
  // sans ce merge, chaque compile() reparlerait de zéro, un `_mjs_*` pourrait recevoir un nom
  // court DIFFÉRENT d'un build à l'autre pour un projet pourtant inchangé.
  if (shouldMinify && result.mangleCache) Object.assign(bundler.mangleCache, result.mangleCache)
  if (!lazy) {
    const jsFile = result.outputFiles!.find(f => f.path.endsWith('.js')) ?? result.outputFiles![0]
    const mapFile = result.outputFiles!.find(f => f.path.endsWith('.map'))
    return { code: jsFile.text, map: mapFile?.text, chunks: [] }
  }
  // fichier unique coupé : chaque sortie autre que l'entrée prend un nom `<base>-<8 hexadécimaux>.js` de la famille des
  // fichiers du projet (l'empreinte d'esbuild, déterministe, en est la graine) et chaque renvoi d'un fichier à l'autre suit
  const sorties = result.outputFiles!
  const js      = sorties.filter(f => f.path.endsWith('.js'))
  const noms    = new Map<string, string>()
  for (const f of js) {
    const nom = basename(f.path)
    if (nom === `${entryName}.js`) continue
    noms.set(nom, `${nom.replace(/-[A-Z0-9]{8}\.js$/, '').replace(/\.js$/, '')}-${createHash('md5').update(nom).digest('hex').slice(0, 8)}.js`)
  }
  const renomme = (texte: string): string => { let out = texte; for (const [ancien, nouveau] of noms) out = out.split(ancien).join(nouveau); return out }
  const carteDe = (f: { path: string }): string | undefined => { const c = sorties.find(o => o.path === `${f.path}.map`); return c ? renomme(c.text) : undefined }
  const entree  = js.find(f => basename(f.path) === `${entryName}.js`)
  if (!entree) throw new Error(t('bundler.index.js-bundle-echec', { raison: `${entryName}.js` }))
  const texteEntree = renomme(entree.text)
  return {
    code:   `${texteEntree}${texteEntree.endsWith('\n') ? '' : '\n'}//# mjsVersion=${bundler.lastBuildId ?? ''}\n`,
    map:    carteDe(entree),
    chunks: js.filter(f => f !== entree).map(f => ({ name: noms.get(basename(f.path))!, code: renomme(f.text), map: carteDe(f) })),
  }
}

export function writeBundleChunks(bundler: Bundler, chunks: Array<{ name: string; code: string; map?: string }>): void {
  const dir      = dirname(bundler.manifestPath)
  const sameDir  = (a: string, b: string): boolean => { try { return realpathSync(a) === realpathSync(b) } catch { return a === b } }
  const enSortie = sameDir(dir, bundler.outputDir)
  const courants = new Set<string>()
  if (chunks.length > 0 && !existsSync(dir)) mkdirSync(dir, { recursive: true })
  for (const c of chunks) {
    bundler['assertValidEsm'](c.code, c.name)
    const contenu = c.map ? `${c.code}\n//# sourceMappingURL=${c.name}.map\n` : c.code
    if (c.map) bundler['writeFileAtomic'](join(dir, `${c.name}.map`), c.map)
    bundler['writeFileAtomic'](join(dir, c.name), contenu)
    courants.add(c.name)
    if (c.map) courants.add(`${c.name}.map`)
    if (enSortie) bundler['emittedThisCompile'].add(c.name)
  }
  // Ce que ce build a écrit avant — lui-même, ou un build d'un autre processus que le registre a consigné — et qu'il n'écrit plus
  // part après la publication du manifeste s'il est REMPLACÉ (un morceau de même base y prend sa place) ou s'il vient de cette
  // instance. Un fichier que personne n'a consigné n'est jamais retiré, quelle que soit la forme de son nom (`chunk-deadbeef.js`
  // d'un auteur) ; un module disparu sans successeur laisse ses fichiers à la purge de `mjs build` (cf. pruneBundleChunks).
  const base   = (n: string): string => n.replace(/-[a-f0-9]{8}\.js(?:\.map)?$/, '')
  const bases  = new Set([...courants].map(base))
  const avant  = new Set([...bundler['bundleChunkFiles'], ...bundleNeighborFiles(bundler.manifestPath)])
  for (const f of avant) {
    if (courants.has(f)) continue
    if (bundler['bundleChunkFiles'].has(f) || bases.has(base(f))) bundler['pendingHashCleanup'].push(join(dir, f))
  }
  bundler['bundleChunkFiles'] = courants
}

// --------------------------------------------------------------------------
// writeBundleManifest() : mode 'bundle' — même point d'appel que writeManifest() (étape « 4.
// Manifest entrypoint » de compile(), que cette méthode remplace dans ce mode). `µ.version` :
// dérivé du md5 de TOUT le contenu AVANT assemblage (chaque source virtuelle triée par nom +
// le corps du setup + le texte de l'entrée) plutôt que du texte assemblé lui-même (comme
// writeManifest()) — deux constructions esbuild identiques en ENTRÉE produisent une sortie
// identique (déterminisme déjà garanti par le mangleCache partagé/trié, cf. bandeau de
// pendingMinifyTasks), la belle propriété recherchée (même build ⇒ même id) tient donc tout
// autant, sans le coût d'un 2e passage esbuild pour connaître l'id AVANT de l'injecter dans le
// texte qu'on hache. Écriture : skip-si-identique, comme writeManifest() (jamais de `touch`
// inutile sous watch).
// --------------------------------------------------------------------------
export async function writeBundleManifest(bundler: Bundler): Promise<void> {
  const unitOrder = bundler['bundleUnitOrder']()
  const setupBody = bundler['buildBundleSetupBody']()
  const entryText = bundler['buildBundleEntry'](unitOrder)
  const hashInput = [...bundler['bundleVirtualSources'].entries()].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)
    .map(([k, v]) => `${k}\0${v}`).join('\0\0')
    + '\0\0setup\0' + setupBody
    + '\0\0entry\0' + entryText
  const buildId = createHash('md5').update(hashInput).digest('hex').slice(0, 8)
  bundler.lastBuildId = buildId
  bundler['bundleVirtualSources'].set('mjs_setup', `import { µ } from 'mjs:core';\nµ.version = ${JSON.stringify(buildId)};\n${setupBody}`)
  bundler['bundleVirtualSources'].set('mjs_entry', entryText)

  const { code, map, chunks } = await bundler['runBundleEsbuild']()
  bundler['writeBundleChunks'](chunks)
  // dossier du manifeste d'abord : la carte s'y écrit
  if (!existsSync(dirname(bundler.manifestPath))) {
    mkdirSync(dirname(bundler.manifestPath), { recursive: true })
  }
  // construction qui écrit dans le dossier des sources : la marque en première ligne (cf. sortieDuBuild), et la carte suit ce
  // décalage d'une ligne (un `;` de plus en tête de `mappings`)
  const marque   = bundler['ecritDansSources']()
  let newContent = marque ? `${MARQUE_SORTIE}\n${code}` : code
  if (map) {
    const mapName = `${basename(bundler.manifestPath)}.map`
    newContent = `${newContent}\n//# sourceMappingURL=${mapName}\n`
    let carte = map
    if (marque) {
      const lue = JSON.parse(map)
      lue.mappings = `;${lue.mappings}`
      carte = JSON.stringify(lue)
    }
    // carte identique non retouchée : sous un dossier surveillé, chaque écriture relançait une construction
    bundler['writeIfChanged'](join(dirname(bundler.manifestPath), mapName), carte)
  }
  // même garde skip-si-identique que writeManifest() (cf. son commentaire détaillé) : un
  // `mjs dev` dont rien n'a changé ne doit pas toucher le fichier (mtime stable, jamais de
  // boucle de recompilation).
  if (existsSync(bundler.manifestPath)) {
    const current = readFileSync(bundler.manifestPath, 'utf-8')
    if (current === newContent) return
  }
  // garde-fou ESM (cf. assertValidEsm) — même exigence que writeManifest().
  bundler['assertValidEsm'](newContent, basename(bundler.manifestPath))
  bundler['writeFileAtomicAlways'](bundler.manifestPath, newContent)
}
