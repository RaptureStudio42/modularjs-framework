// bundler — orchestrateur du cycle de compilation V2.
// Port simplifié d'un outillage de synchronisation interne antérieur (Ruby).
//
// Responsabilités :
//   1. Compile le runtime mjs_*.coffee → mjs_core.js
//   2. Compile les .mjs (composants) via transpiler → fichiers .js
//   3. Compile les .coffee (modules ES) via language adapter
//   4. Hash MD5 dans les filenames pour cache busting
//   5. Génère un manifest `µ.paths = {...}`
//   6. Watch mode via chokidar (re-compile au changement)
//   7. Résolution µasset() inline
//
// Pas encore : partial deps (extract_partial_deps).

import { readFileSync, writeFileSync, mkdirSync, readdirSync, statSync, existsSync, unlinkSync, renameSync, realpathSync } from 'node:fs'
import { resolve, basename, extname, dirname, relative, isAbsolute, join, sep, posix } from 'node:path'
import { createHash } from 'node:crypto'
import { shortFingerprintFromHex, FINGERPRINT_LENGTH } from './fingerprint.js'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'
import { AsyncLocalStorage } from 'node:async_hooks'
import * as acorn from 'acorn'
import * as walk from 'acorn-walk'
import { transpile, cssTrapWarnings } from '../transpiler/index.js'
import { findConstReassignment } from '../transpiler/const-reassign.js'
import { warnUnreachableCode } from '../transpiler/unreachable.js'
import { INCLUDE_RE, resolvePartial } from '../transpiler/macros.js'
import { scanImgTags, isResolvableSrc, parseWidths, rewriteImgTag, type ImgTag } from '../transpiler/img-tag.js'
import { scanEffectImages, imageCall, type EffectImage } from '../transpiler/effect-images.js'
import { getAdapter } from '../languages/index.js'
import { build as esbuildBuild } from 'esbuild'
import { minifyJs, stripMsgFallbacks, withMangleCacheLock, buildPureList, collectInstanceNames, reserveMangleNames, reserveDataMarkers, CORE_HELPER_NAMES, PLATFORM_NAMES, TRACE_READ_MESSAGES, levelCutsTraces, runtimeCallsCut, messagesWithoutTraces, traceMessages, traceKeysIn } from './minify.js'
import { readImageSize, generateVariants, animatedKind, type GeneratedVariant } from './image.js'
import { compileCss } from '../transpiler/css.js'
import { shiftGeneratedPosition, chainOverMap } from '../transpiler/source-map-chain.js'
import { compileThemeFile, assembleThemes, isThemeFile } from './themes.js'
import { chartProblems } from './core-chart.js'
import { coreCamelProps, camelAttrProblems } from './core-attrs.js'
import { isTypesFile, collectTypeDefs } from './types-files.js'
import { isEffectsFile, collectEffectDefs, countEffectUses, ALIAS_TABLE_MIN_USES } from './effects-files.js'
import { EFFECTS, devCatalog, fxRangesSource, withProjectEffects, effectSpec, fixedImages, imageValue, typoDistance, replacedThemeVar, type ProjectEffect } from '../effects/catalog.js'
import type { RuleAst } from '../transpiler/var-types.js'
import { withState } from '../generator/state.js'
import { applyPathTrackingMapped } from '../generator/path-tracker.js'
import { cpus } from 'node:os'
import { WorkerPool, resolveWorkerScript } from './worker-pool.js'
import { transpileFromMsg, tagSpans, effectDefsToWire, type TranspileMsg } from './transpile-msg.js'
import { normalizePreload, normalizeUrlPrefix, OPTIONAL_RUNTIME_MODULES, DETECTED_CORE_MODULES, levenshtein, resolveLogLevel, resolveTerminalLogLevel, logLevelAllows, dureeEnMs, verifierPlafondDuree, cheminDansDossier, refusManifestPath } from './config.js'
import type { PreloadConfig, RuntimeConfig, VtValue, I18nConfig, CssConfig, JsConfig, LogLevelConfig, RenderConfig, RenderMode, EffectsConfig, BundleGroupConfig } from './config.js'
import { normalizeMode } from '../server/render-routes.js'
import { feuillesConsignees, feuillesRenduPerimees } from '../server/sorties-rendu.js'
import { assembleGroups, type GroupReport } from './startup.js'
import { t, getMessagesLang } from '../messages/index.js'
import { MU_IMPORT_BODY, rewriteMuImportAst } from '../sigils.js'
import { runtimeLabelsFor, runtimeMessagesFor, coreLabelKeys, fxLabelKeys, RUNTIME_LANGS } from '../runtime-labels.js'
import { typedLine, printDiagnostic, resolveColorsEnabled, type LintType, type LintToggles } from '../diagnostics.js'
import { AT_RESERVED_NAMES, skeletonHtml, type TagRef, type TagRefKind } from '../parser/index.js'
import { extractSections } from '../transpiler/sections.js'
import { scanCompiledFeatures, fxAliasSignal, FX_KEYS, FX_CHUNK_KEYS, FX_NAMED, FX_NAMEABLE_KEYS, AUTOLOADER_MENTION, PRELOAD_MENTION, I18N_PAQUETS, I18N_LOADER, I18N_USED, BOUCLES } from './features.js'
import { parsePlaceholder, PLACEHOLDER_CONFIG, type Placeholder } from '../effects/placeholder.js'
import { selectFxSections, type FxClient } from './fx-sections.js'
import { selectCoreSections, TRANSITION_LABEL, RESUME_LABEL, TOOL_PREFIX, TOOL_GROUPS, STRICT_ATTRS } from './core-sections.js'
import { hologramClient, HOLOGRAM_FILE } from './hologram-styles.js'
import { HOLOGRAM_MOTIFS, hologramMotifsOf, injectHologramImages } from './hologram-motifs.js'
import { collectCoreCalls, missingCoreSymbols } from './core-contract.js'
import { relativeJsImports, type JsImportSpecifier } from './js-imports.js'
import { maskInertSameLength } from '../lexer/index.js'
import { FX_TOOLS, FX_TOOL_KEYS, fxToolsWanted, fxToolsCalled, fxToolsMissing } from './fx-tools.js'

// les fichiers d'effets dont les étiquettes de section ont leur vocabulaire, et leur passe de finition (cf. fx-sections.ts) ; les autres
// fichiers se filtrent sans client
const FX_CLIENTS: Record<string, FxClient> = { [HOLOGRAM_FILE]: hologramClient }

// un fichier d'effet ou d'outil (mjs_fx_<nom>.ts) : ceux dont la garde des outils lit les appels ; le moteur (mjs_fx.ts) n'en est pas, il
// cite la garde de cadence sans l'exiger (`if (µ._mjs_fxGauge)`)
const FX_MODULE = /^mjs_fx_[a-z0-9_]+\.ts$/

// un import relatif d'un .js copié tel quel dont le fichier n'existe pas : qui l'écrit, ce qu'il écrit, où il le cherche
interface MissingNeighbor { from: string, spec: string, abs: string }

// Pool global partagé entre tous les Bundlers du process (process-wide).
// Évite de créer/terminer un pool par instance — coût d'init non négligeable
// (esbuild compile + démarrage workers ~200ms). Le pool est lazy, créé au 1er
// usage, et `bundler.close()` le termine seulement si plus aucun Bundler ne
// l'utilise (refcount).
let _sharedWorkerPool: WorkerPool | null = null
// mémoïse la PROMESSE de création (pas
// seulement la valeur résolue `_sharedWorkerPool`) : cf. le commentaire détaillé
// dans ensureWorkerPool() plus bas, qui explique le TOCTOU que cette variable
// referme.
let _sharedWorkerPoolPromise: Promise<WorkerPool> | null = null
let _sharedWorkerPoolRefCount = 0

/** Force la fermeture du pool partagé. Utile pour les tests qui créent
 * plusieurs Bundlers et veulent un cleanup propre à la fin de la suite. */
export async function terminateSharedWorkerPool(): Promise<void> {
  if (_sharedWorkerPool) {
    await _sharedWorkerPool.terminate()
    _sharedWorkerPool = null
    _sharedWorkerPoolPromise = null
    _sharedWorkerPoolRefCount = 0
  }
}

/** Un pool de threads est-il VIVANT dans ce processus ? Sonde de test : « ce projet
 * a-t-il seulement démarré des threads ? » ne se lit nulle part ailleurs — un pool
 * jamais créé est indiscernable d'un pool créé puis inutilisé. */
export function isSharedWorkerPoolAlive(): boolean {
  return _sharedWorkerPool !== null
}

/**
 * Map parallèle avec limite de concurrence. Lance au plus `concurrency`
 * promesses simultanément ; les autres attendent qu'un slot se libère.
 *
 * Sans cette limite, `Promise.all(474 items)` lance 474 compilations en même
 * temps → sature l'I/O fichier, pression mémoire, V8 thrashing → BIEN plus
 * lent que séquentiel. Avec un cap raisonnable (~CPU count × 2), on garde
 * le throughput optimal.
 */
async function parallelMap<T, R>(
  items: T[],
  fn: (item: T) => Promise<R>,
  concurrency: number,
): Promise<PromiseSettledResult<R>[]> {
  const results: PromiseSettledResult<R>[] = new Array(items.length)
  let cursor = 0
  const worker = async () => {
    while (cursor < items.length) {
      const idx = cursor++
      try {
        results[idx] = { status: 'fulfilled', value: await fn(items[idx]) }
      } catch (reason) {
        results[idx] = { status: 'rejected', reason }
      }
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(concurrency, items.length) }, worker)
  )
  return results
}

// Concurrency cap : aligné sur le nombre de workers du pool.
//
// **Mémoire** : chaque worker_threads spawned charge le bundle worker (~700 MB
// quand bundle:true esbuild). Avec 8 workers, ça fait 5-6 GB de RAM rien que
// pour les workers. Sur un système 8 GB, ça déclenche OOM-kill et fait crasher
// le shell / l'éditeur. On dimensionne donc en fonction de la RAM dispo :
//   - système <= 8 GB : 2-4 workers
//   - système <= 16 GB : 4-6 workers
//   - système >= 16 GB : up to cpus().length, plafonné à 8.
import { totalmem } from 'node:os'
const _totalGb = totalmem() / 1024 / 1024 / 1024
const _maxWorkers = _totalGb < 8 ? 2 : _totalGb < 16 ? 4 : Math.min(8, cpus().length)
const PARALLEL_LIMIT = Math.max(2, _maxWorkers)

// Seuil en DESSOUS duquel la transpilation se fait dans le processus principal, sans
// aucun thread : un thread coûte ~570 ms de chargement (paquet worker, sass, civet) et le
// maître attend le pool ~190 ms, pour un travail qui dure quelques dizaines de ms par
// composant. Sous le seuil, le pool coûte donc plus cher que ce qu'il abat.
// Mesuré le 16/09/2026, 8 cœurs / 30 Go, construction `--prod` d'un projet dupliqué à
// partir d'une appli réelle — médiane de 5 constructions, en ms, direct vs threads :
//   8 comp. : 703 / 1292    16 : 790 / 1466    24 : 947 / 1649    40 : 1140 / 1892
// Le direct gagne partout dans la plage mesurée ; poussé plus loin (80/160/320 composants, mêmes
// 5 constructions), il gagne encore (1705/2778, 3002/4205, 4735/7214) — aucun point de
// croisement observé sur ces petits composants (styles vides, HTML court).
// Sur un site réel à composants lourds (SASS, HTML volumineux), 742 composants + 13 modules et des
// sous-ensembles fermés sur leurs dépendances, médianes de 3 à 5 constructions froides alternées,
// même machine, le croisement tombe entre 37 et 56 fichiers — direct / threads, en ms :
//   21 fichiers : 941 / 1216    29 : 1036 / 1396    37 : 1152 / 1419
//   56 : 3230 / 2751    101 : 3704 / 3069    213 : 5343 / 4124    755 : 12383 / 7728
// Le seuil de 40 tombe dans ce croisement : il est gardé. Le nombre de fichiers reste un indicateur
// grossier du travail (les petits composants croisent bien plus haut, au-delà de 320).
const INLINE_LIMIT = 40

export interface BundlerOpts {
  /** Répertoire racine des sources (.mjs/.coffee). */
  sourceDir?: string
  /** Répertoire racine du runtime CoffeeScript (mjs_*.coffee). */
  runtimeDir?: string
  /** Répertoire de sortie des fichiers compilés et hashés. */
  outputDir?: string
  /** Path du manifest entrypoint généré. */
  manifestPath?: string
  /** Path du manifest externe (format require/require_dir/require_tree). */
  manifestExternal?: string
  /** Lang par défaut pour `<script>` sans `lang=`. */
  defaultScriptLang?: 'civet' | 'coffee' | 'ts' | 'js'
  /**
   * Grammaire des interpolations `{…}` du template ET des handlers inline
   * (`@click={…}`). Défaut `'civet'`
   * (appliqué côté transpiler, pas ici) ; `'js'` = repli comportement
   * historique. ENCORE INUTILISÉ : l'option existe et circule, mais rien ne la
   * consomme — les briques handlers/interpolations n'existent pas encore.
   */
  templateLang?: 'civet' | 'js'
  /** Sigil tapé par le dev : `'µ'` (défaut) ou `'mjs'` (fallback ASCII). */
  sigil?: 'µ' | 'mjs'
  /** Alias ASCII contexte/partagé `__context.X`/`__shared.X` (opt-in, off déf.). */
  contextAlias?: boolean
  /** Mode strict « politique de sécurité de contenu » : zéro `<style>`/`<script>` en ligne (opt-in, off déf.). */
  csp?: boolean
  /** Émission des cartes de source : `'prod'` (défaut, historique), `'dev'`, `'always'`, `'never'`. */
  sourceMap?: 'never' | 'dev' | 'prod' | 'always'
  /** Seuil du lint « trop de variables d'état » (entier ≥ 0, 0 = désactivé ; défaut 40 côté transpiler). */
  maxStateVars?: number
  /** politique des variantes d'image produites par `µimage` (clé `image`
   *  de mjs.config.json). Défauts résolus au constructeur : `[480, 960, 1920]`,
   *  `['webp']`, qualité 78. */
  image?: { widths?: number[]; formats?: string[]; quality?: number }
  /** Lint d'accessibilité (a11y) au build — cf. transpiler/a11y.ts. Défaut `true`
   *  (activé) appliqué côté transpiler, pas ici ; `false` désactive tout le contrôle. */
  a11y?: boolean
  /** Lint « <form> sans action ni méthode » (ujsForm) — cf. transpiler/ujs-form.ts. Défaut
   *  `true` (activé) appliqué côté transpiler, pas ici ; `false` désactive tout le contrôle. */
  ujsForm?: boolean
  /** Coupe individuellement les AUTRES types d'avertissement de build (`lint.<type>` de
   *  mjs.config.json, hors `a11y`/`maxStateVars`/`ujsForm` ci-dessus, gérés par leur propre
   *  champ) — cf. src/diagnostics.ts pour la table complète des types et leur gravité. */
  lint?: LintToggles
  /** Le terminal accepte-t-il la couleur — calculé UNE fois par le CLI (`resolveColorsEnabled`,
   *  src/diagnostics.ts) et transmis ici. Défaut : recalculé au constructeur si absent (un
   *  appelant direct du Bundler, hors CLI, garde quand même un résultat cohérent). */
  colorsEnabled?: boolean
  /** Un composant qui échoue à compiler garde-t-il son ANCIENNE sortie référencée au manifeste ?
   *  `true` (défaut) en dev/serve : le site reste utilisable pendant qu'on corrige. `false` en
   *  build : la version repêchée peut importer un `mjs_core-<hash>` supprimé depuis — page morte
   *  au navigateur alors que rien ne le dit. */
  keepFailedComponents?: boolean
  /** `false` : le build ne retire aucun fichier du dossier de sortie — ni l'ancienne empreinte d'une sortie remplacée, ni un
   *  orphelin (`pruneOrphans()`). Défaut `true` : il ne retire que ce qu'un build de ce constructeur a écrit, tel que le
   *  registre `.mjs-outputs.json` le consigne, jamais un fichier sur la seule forme de son nom. */
  prune?: boolean
  /**
   * LEGACY (interne, tests/CI) — « build de prod minifié » d'un bloc : équivaut à
   * `env: 'prod'` + `minify: true`, et cède devant l'un ou l'autre s'il est posé.
   * La clé PUBLIQUE `minify` de mjs.config.json ne passe PLUS par ici :
   * elle ne décide que de la minification (cf. `minify` ci-dessous).
   */
  forceMinify?: boolean
  /**
   * ENVIRONNEMENT du build — SEULE source de vérité de `isProd()`. Défaut `'dev'`.
   * En CLI, c'est le DRAPEAU qui le pose : `mjs build` = dev, `mjs build --prod` = prod.
   * Décide du hachage i18n, du `dev:` du manifeste, de l'exposition de `window.µ`,
   * des cartes de source (via `sourceMap`) et de la présence des modules
   * d'inspection (`mjs_debug`/`mjs_devinspect`/`mjs_devpanel`).
   */
  env?: 'dev' | 'prod'
  /** `'auto'` (défaut) : on minifie là où `env` dit prod. `true`/`false` : imposé. */
  minify?: boolean | 'auto'
  /** Répertoire des styles partagés (référencés par `@css name` dans .mjs). */
  stylesheetsDir?: string
  /** Dossiers d'images EN PLUS de `sourceDir` (clé `assetDirs` de mjs.config.json, chemins absolus ou relatifs au cwd) :
   *  `µimage`, `µasset` et `<@@img>` y cherchent ce que `sourceDir` ne porte pas, dans l'ordre de la liste. */
  assetDirs?: string[]
  /** Préfixe des variables de thème : `$$brand` → `var(--<varPrefix>-brand)`. Défaut `mjs`. */
  varPrefix?: string
  /** Thème qui vaut sans attribut (posé aussi sur `:root`). Défaut `light`. */
  defaultTheme?: string
  /**
   * Mode "runtime minimal" : exclut les modules optionnels du bundle
   * `mjs_core.js`. Désactivés par défaut (`false`) pour rétrocompat ; activer
   * pour gagner ~10-20KB sur des apps simples (benchs, widgets isolés) qui
   * n'utilisent pas Router/UJS/AJAX/animations/flip/spring.
   *
   * Modules retirés en mode minimal :
   *   - mjs_easing (transitions)
   *   - mjs_flip (FLIP layouts)
   *   - mjs_spring (interpolation physique)
   *   - mjs_ajax (helpers HTTP)
   *   - mjs_router (Router)
   *   - mjs_ujs (intercepts links/forms)
   *
   * Modules conservés (toujours requis) :
   *   - mjs_init, mjs_interpolate, mjs_store, mjs_runes, mjs_debug,
   *     mjs_autoloader, mjs_element
   */
  minimalRuntime?: boolean
  /**
   * Sélection fine des modules runtime (généralise `minimalRuntime`). `'all'`
   * (défaut) / `'core'` / tableau de modules optionnels à ajouter au cœur.
   * Exposé dans mjs.config.json (clé `runtime`). Si fourni, prime sur
   * `minimalRuntime`.
   */
  runtime?: RuntimeConfig
  /**
   * Mode d'émission des styles partagés — cf. le JSDoc complet de `MjsConfig.css`
   * (bundler/config.ts). `'bundle'` (défaut, inchangé) / `'split'` (un fichier par
   * feuille, importé par les seuls modules qui la déclarent) / `'lazy'` (pas encore
   * implémenté, échec de build explicite). Exposé dans mjs.config.json (clé `css`).
   */
  css?: CssConfig
  /**
   * Mode d'émission des composants/modules/cœur — cf. le JSDoc complet de `MjsConfig.js`
   * (bundler/config.ts). `'split'` (défaut, inchangé) / `'bundle'` (un seul fichier JS pour
   * toute l'appli, exige `css: 'bundle'`). Exposé dans mjs.config.json (clé `js`).
   */
  js?: JsConfig
  /**
   * Préfixe URL public des fichiers émis (utilisé dans `µ.paths`, dirInject,
   * etc.). Si non fourni, dérivé automatiquement de `outputDir` en retirant
   * le préfixe `public/` (convention universelle : la doc-root du serveur HTTP).
   *
   * Exemples :
   *   outputDir='public/modularjs'                  → urlPrefix='/modularjs'
   *   outputDir='public/assets/modularJS_compiled'  → urlPrefix='/assets/modularJS_compiled'
   *   outputDir='public'                            → urlPrefix='' (la racine servie elle-même)
   *   outputDir='dist'                              → urlPrefix='/dist' ; `urlPrefix: '/'` si `dist` est servi à la racine
   * `'/'` et les slashs finaux se normalisent comme dans mjs.config.json (`'/'` → aucun préfixe).
   * Une adresse d'un autre hôte, absolue (`'https://cdn.example.com/m'`) ou protocole-relative (`'//cdn.example.com/m'`),
   * est publiée telle quelle, sans ses slashs finaux.
   */
  urlPrefix?: string
  /** Préchargement des liens : émis dans le manifeste (`µ.preload`) pour le client. */
  preload?: PreloadConfig
  /** Transitions de page : émis dans le manifeste (µ.viewTransition) pour le client —
   *  "none" (défaut, désactivé) ou nom de préréglage (cf. VT_PRESET_NAMES, config.ts) —
   *  aucun booléen, cf. `VtValue`. */
  viewTransition?: VtValue
  /**
   * Niveau de la console (navigateur ET build) — cf. le JSDoc de `MjsConfig.logLevel`
   * (config.ts) pour la sémantique complète. Défauts résolus au point de consommation
   * (`Bundler.currentLogLevel`/`prodLogLevel`), comme `preload`/`viewTransition` ci-dessus.
   */
  logLevel?: LogLevelConfig
  /** Clé `messages` (cf. `MjsConfig.messages`, config.ts) : `'idle'` = fichier de messages chargé d'avance. */
  messages?: 'demand' | 'idle'
  /**
   * Types et valeurs permises — ce que fait, en DÉVELOPPEMENT, une valeur ramenée dans sa plage ou
   * refusée : `'warn'` (défaut, un avertissement dans la console) ou `'error'` (une erreur qui
   * arrête l'écriture). Émis au manifeste de développement seulement (`µ._typesMode`) : en
   * production, rien ne s'affiche.
   */
  types?: 'warn' | 'error'
  /** Effets que MJS pose de lui-même (thème en cercle, effets économes) — cf. `MjsConfig.effects` ;
   * émis au manifeste (`µ._fxConf`) seulement quand la clé est écrite. */
  effects?: EffectsConfig
  /** Groupes de fichiers — cf. `MjsConfig.bundles` ; assemblés en production seulement. */
  bundles?: Record<string, BundleGroupConfig>
  /**
   * i18n façon Rails — cf. le JSDoc de `MjsConfig.i18n` (config.ts) pour la
   * sémantique complète. Scanné dans `sourceDir/i18n/` au build, émis dans le
   * manifeste (`µ._i18nData`) pour le runtime optionnel `mjs_i18n.ts`.
   */
  i18n?: I18nConfig
  /**
   * Bloc `render` du projet (pages → composant + mode) — cf. le JSDoc de `RenderConfig`
   * (config.ts). Le bundler n'en lit QUE les modes, et pour une seule décision : embarquer ou
   * non le module d'hydratation `mjs_hydrate.ts` (`ssr:markers`/`ssr:positional`/`ssr:diff` —
   * cf. `resolveRuntimeFiles`). Le prérendu et le serveur de rendu, eux, le lisent entier de
   * leur côté.
   */
  render?: RenderConfig
  /**
   * Filet de sécurité anti-interblocage pour la dédup de compiles concurrents
   * (cf. `compileWithDedup`) : délai max (ms) d'attente d'une compilation
   * DÉJÀ en vol avant d'abandonner avec une erreur explicite. Option interne
   * (pas dans `MjsConfig`/mjs.config.json — même statut que `minimalRuntime`),
   * exposée surtout pour les tests (permet un délai court plutôt que
   * d'attendre la vraie valeur de prod). Défaut : 12000ms.
   */
  dedupWaitTimeoutMs?: number
  /**
   * Répertoire du catalogue de modules cœur (invoqués via `<@mjs-nom>`),
   * résolu par défaut relativement au PAQUET ModularJS (`src/core-modules/`),
   * jamais au projet compilé. Option interne (pas dans `MjsConfig`/
   * mjs.config.json — même statut que `dedupWaitTimeoutMs`), exposée surtout
   * pour les tests (catalogue de test isolé, sans toucher au vrai dossier).
   */
  coreModulesDir?: string
  /**
   * Seuil de bascule « transpilation dans le processus principal » (cf. INLINE_LIMIT) :
   * un projet d'au plus N fichiers compilés ne démarre aucun thread. Option interne
   * (pas dans `MjsConfig`/mjs.config.json — même statut que `dedupWaitTimeoutMs`),
   * exposée pour les tests et les mesures : 0 force le chemin par threads, une valeur
   * très grande force le direct. Défaut : INLINE_LIMIT.
   */
  inlineTranspileLimit?: number
}

/**
 * Données i18n d'un build (contrat FIGÉ avec le runtime `mjs_i18n.ts`) — objet EN
 * MÉMOIRE, dont le manifeste ne publie qu'une PARTIE (`i18nPublicData()`) :
 * `root`/`sections` partent, eux, dans un fichier PAR LANGUE
 * (`mjs_i18n-<langue>-<hash>.js`, cf. `scanI18n`), téléchargé pour la seule langue
 * affichée — le manifeste est servi sur CHAQUE page et ne doit plus porter la
 * prose des langues qu'on ne voit pas. Le rendu serveur, lui, garde tout sous la
 * main (renderToString.ts sème chaque langue par `µ._i18nLang`).
 *   `root`     = dictionnaires racine (`sourceDir/i18n/<langue>.yml|.json`) ;
 *   `sections` = nom COMPACT du fragment de chaque section (hash en prod, nom
 *                clair en dév) — l'URL se reconstitue `prefix/<langue>/<nom>.json`,
 *                formule unique côté runtime (`__i18nSectionUrl`) ;
 *   `prefix`   = préfixe public des fragments (`<urlPrefix>/i18n`) ;
 *   `langs`    = langues SÉLECTIONNABLES (dictionnaire racine présent) ;
 *   `files`    = URL publique du fichier de chaque langue.
 * `dev: !isProd()` — jamais varié par `hash` (toujours faux hors prod).
 */
export interface I18nManifestData {
  dev: boolean
  default: string
  /** l'attente des textes : wait | key | *skeleton | *loader */
  placeholder: string
  /** les réglages écrits de l'effet d'attente (`*loader(bloom)` → `{ style: 'bloom' }`), seulement s'il y en a */
  fx?: Record<string, unknown>
  /** le délai de secours de `wait`, en millisecondes — seulement s'il diffère de 3000 (`i18n.timeout`) */
  timeout?: number
  persist: boolean
  detect: boolean
  urlParam: boolean
  prefix: string
  langs: string[]
  files: Record<string, string>
  root: Record<string, Record<string, any>>
  sections: Record<string, Record<string, string>>
}

/** Sous-ensemble RÉELLEMENT émis dans le manifeste (`µ._i18nData`) : tout sauf
 *  `root`/`sections`, partis dans les fichiers de langue. */
export type I18nPublicData = Omit<I18nManifestData, 'root' | 'sections'>

export interface CompileStats {
  written: number
  errors: Error[]
  /** Avertissements non-bloquants : collisions de noms de fichiers (deux `.mjs`
   * avec le même basename → conflit autoloader), assets ratés, etc. */
  warnings: string[]
  /** Lignes d'avertissement étiquetées `[lint.<type>]` imprimées par les transpilations de ce
   *  tour, threads de travail compris (cf. printDiagnostic, src/diagnostics.ts) : la CLI en
   *  déduit sa ligne d'aide quand aucune n'est passée par `warnings`. */
  lintPrinted?: number
  manifest: Record<string, string>
  sizes: SizeReport[]
  durationMs: number
  /**
   * Rechargement CSS à chaud (mode watch seulement — cf. `cssOnlyTracking`) :
   * `undefined` hors watch (`build`/`check`/`serve`, jamais calculé) ; `null` en watch
   * quand ce recompile n'est PAS qualifiable "css-only" (repli reload complet, au
   * moindre doute) ; un objet non vide quand CHAQUE fichier recompilé ce tour-ci est
   * soit un composant dont seul le CSS a changé, soit une feuille partagée de
   * `stylesheetsDir` — cf. `watch()`/`_compileMjsInner`/`bundleSharedStyles`.
   */
  cssOnly?: CssOnlyPayload | null
}

export interface SizeReport {
  /** Nom logique (basename sans hash). */
  name: string
  /** Path web complet. */
  path: string
  /** Taille en octets. */
  bytes: number
}

/** Subset de TranspileData utilisé par le bundler après le retour worker.
 * Pas besoin d'importer le type complet — worker_threads structuredClone
 * retourne un plain object. */
type TranspileDataLike = {
  usedAnimations: string[]
  // jumeau de usedAnimations côté anims DÉFINIES
  // dynamiquement (µanim.create/crossfade) ; cf. Bundler.definedAnimations.
  definedAnimations: string[]
  /** Noms de feuilles partagées `@css nom1 nom2…` référencées par ce composant
   * (crash-si-absent) — projeté par le worker (worker.ts) au même
   * titre que usedAnimations ; alimente `Bundler.requestedSharedSheets`
   * (cf. validateSharedSheets()). Optionnel (`?? []` partout où il est consommé)
   * par prudence — même style défensif que usedAnimations/definedAnimations
   * sur un CacheEntry, même si `this.cache` est un Map en mémoire pur (jamais
   * persisté sur disque, donc pas de vieux cache d'avant cette politique à redouter ici). */
  sharedCssNames?: string[]
  includedPartials: string[]
  /** Diagnostics de processIncludes
   * (partial introuvable, <@include> circulaire) remontés depuis le worker. */
  macroErrors: string[]
  /** 2e <script>/<style>
   * silencieusement jeté par extractSections (composant OU partial inclus),
   * remonté depuis le worker. Non fatal (contrairement à macroErrors) →
   * stats.warnings, pas stats.errors. */
  sectionWarnings: string[]
  lintPrinted?: number
  /** Références `<@nom>`/`<mjs-nom>`/`<mjs-core-nom>` (notation
   * unique, `<@mjs-nom>` est une erreur de migration) collectées par le
   * parseur pour ce fichier, remontées depuis le worker (cf. worker.ts) —
   * résolues par `resolveTagShortcuts` en fin de compile(). */
  tagRefs?: TagRef[]
  /** Dépendances DIRECTES de balises du gabarit (cf. collectDirectComponentDeps,
   * generator/compile.ts), remontées depuis le worker — table de préchargement
   * du manifeste (cf. Bundler.pendingComponentDeps/buildManifestDeps). */
  componentDeps?: string[]
  /** Tag custom element (`mjs-xxx`) — clé du payload `cssOnly.components`
   * (rechargement CSS à chaud, cf. dataEqualExceptBaseCss/computeScopedCss). */
  tagName: string
  /** Tag alias additionnel éventuel (même CSS que tagName) — cf. injectTemplate. */
  aliasTag?: string
  /** CSS brut compilé du `<style>` du composant (AVANT le préfixe `:host{display}`)
   * — le SEUL champ de `data` qui peut différer pour qu'un recompile soit
   * qualifié "css-only" (cf. dataEqualExceptBaseCss). */
  baseCss: string
  /** `@display` du composant — entre dans le CSS scopé final (computeScopedCss)
   * mais fait partie de l'empreinte "hors-baseCss" (restHash) : un changement
   * de @display n'est PAS un css-only (repli full, sans risque). */
  moduleDisplay: string
  /** CSS de chaque `<style name="…">`, par nom — écrit en fichier frère du module. */
  layoutCss?: Record<string, string>
  /** Variables de thème `$$` DÉCLARÉES par les blocs `<theme>` du composant — alimente le registre. */
  themeVars?: { name: string; variant: string; line: number; doc: string }[]
  /** Variables de thème `$$` LUES par le composant — sert à repérer un nom que personne ne déclare. */
  varsRead?: string[]
  /** Noms des variantes `<theme name="…">` déclarées. */
  themeVariants?: string[]
  /** le composant pose un effet d'un fichier `*.effects.mjs` : il dépend de ces fichiers (projeté par
   * transpile-msg.ts, sans quoi un effet modifié en `mjs dev` ne le recompilerait pas) */
  usesProjectEffects?: boolean
  /** EMPREINTE (SHA-256, 16 hex) de TOUT le TranspileData privé de baseCss,
   * calculée DANS LE WORKER (cf. worker.ts) : préserve l'optimisation (les gros
   * champs — surgicalHtml, createFnBody… — ne repassent jamais au master)
   * tout en permettant le test « hors-baseCss strictement identique ». */
  restHash: string
  // ... le reste passe via structuredClone mais on n'y accède pas dans le bundler
  [key: string]: any
}

/** Payload « rechargement CSS à chaud » — un recompile où SEUL le CSS a
 * changé (composants et/ou feuilles partagées de `stylesheetsDir`). Consommé par
 * `server/hmr.ts` (notifyCssUpdate) puis le runtime (`µ._hotCss`, mjs_element.ts). */
export interface CssOnlyPayload {
  /** tag custom element (`mjs-xxx`) → CSS scopé complet (déjà préfixé `:host{display}`). */
  components: Record<string, string>
  /** nom de feuille partagée (`@css nom`) → CSS compilé. */
  sheets: Record<string, string>
  /** CSS de `mjs_root.{sass,scss}` (adopté globalement), si présent ET changé. */
  root?: string
}

// dataEqualExceptBaseCss — compare deux TranspileData en ignorant `baseCss` (seul
// champ pouvant différer pour un recompile "css-only"), via
// l'empreinte `restHash` calculée dans le worker (SHA-256 du data privé de
// baseCss — cf. worker.ts : évite de ré-expédier les gros champs au master).
// Empreinte absente d'un côté (data hors pipeline worker) → jamais égal,
// repli reload complet (fail-safe).
function dataEqualExceptBaseCss(a: TranspileDataLike, b: TranspileDataLike): boolean {
  return typeof a.restHash === 'string' && a.restHash.length > 0 && a.restHash === b.restHash
}

// computeScopedCss — MÊME formule que injectTemplate() (transpiler/index.ts,
// `displayPrefix + data.baseCss`, ce qui alimente `this._mjs_baseCss` côté runtime)
// dupliquée ICI plutôt qu'importée de src/transpiler/**.
// DOIT rester en phase si cette formule change un jour côté transpiler.
function computeScopedCss(data: TranspileDataLike): string {
  return `:host{display:${data.moduleDisplay}}` + (data.baseCss ?? '')
}

// escapeRegex — échappe les métacaractères regex d'un fragment interpolé dans un `new
// RegExp(...)` (même besoin que `cleanupOldHashes` plus bas, trop loin dans ce fichier
// pour partager l'inline sans y perdre en lisibilité).
function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

// scanDeclaredVars — registre des variables de thème, source 4 : toute déclaration
// `--<prefix>-<nom>: valeur` d'un texte CSS DÉJÀ COMPILÉ, `$$` ou CSS brut confondus (les
// deux sortent identiques une fois compilés). Une déclaration = le nom suivi de `:` ;
// `var(--mjs-x)` est une LECTURE, jamais capturée ici (aucun `:` ne suit le nom).
function scanDeclaredVars(css: string, prefix: string): { name: string; value: string }[] {
  const re = new RegExp(`--${escapeRegex(prefix)}-([A-Za-z_][A-Za-z0-9_-]*)\\s*:\\s*([^;{}]+)`, 'g')
  const out: { name: string; value: string }[] = []
  let m: RegExpExecArray | null
  while ((m = re.exec(css)) !== null) out.push({ name: m[1], value: m[2].trim() })
  return out
}

// scanDefaultReads — registre des variables de thème, source 5 : toute LECTURE avec défaut
// `var(--<prefix>-<nom>, défaut)` d'un texte CSS DÉJÀ COMPILÉ. Le défaut est le texte du second argument tel qu'il
// est écrit, jusqu'à la parenthèse qui referme la lecture : une cascade `var(--mjs-a, var(--mjs-b, #fff))` garde son
// texte entier et la lecture de `--mjs-b` qu'elle porte n'est pas relevée à part. Une lecture sans défaut
// (`var(--mjs-x)`) ou à défaut vide n'a rien à afficher. La valeur d'une variable DÉCLARÉE est déjà au registre
// telle quelle : les lectures qu'elle porte (`--mjs-a: var(--mjs-b, #fff)`) n'en ressortent pas.
function scanDefaultReads(css: string, prefix: string): { name: string; value: string }[] {
  const text = css.replace(new RegExp(`--${escapeRegex(prefix)}-[A-Za-z_][A-Za-z0-9_-]*\\s*:\\s*[^;{}]+`, 'g'), '')
  const re   = new RegExp(`var\\(\\s*--${escapeRegex(prefix)}-([A-Za-z_][A-Za-z0-9_-]*)\\s*,`, 'g')
  const out: { name: string; value: string }[] = []
  let m: RegExpExecArray | null
  while ((m = re.exec(text)) !== null) {
    let depth = 1
    let quote = ''
    let i     = re.lastIndex
    for (; i < text.length && depth > 0; i++) {
      const c = text[i]
      if (quote) {
        if (c === '\\') i++
        else if (c === quote) quote = ''
      }
      else if (c === '"' || c === '\'') quote = c
      else if (c === '(') depth++
      else if (c === ')') depth--
    }
    if (depth > 0) break
    const value = text.slice(re.lastIndex, i - 1).trim()
    if (value) out.push({ name: m[1], value })
    re.lastIndex = i
  }
  return out
}

// scanReadNames — registre des variables de thème : les noms qu'un texte CSS DÉJÀ COMPILÉ lit, avec ou sans défaut
// (`var(--<prefix>-<nom>`), commentaires exclus. Sert à dire qui lit quoi (`readBy`) : ni les rappels ni le silence par défaut
// ne le consultent.
function scanReadNames(css: string, prefix: string): string[] {
  const text = css.replace(/\/\*[\s\S]*?\*\//g, '')
  return [...new Set([...text.matchAll(new RegExp(`var\\(\\s*--${escapeRegex(prefix)}-([A-Za-z_][A-Za-z0-9_-]*)`, 'g'))].map(m => m[1]))]
}

// scanPosedVars — registre des variables de thème : les variables que le composant POSE lui-même, relevées dans sa
// source brute. Trois écritures : `setProperty('--p-nom', …)` du script, la liaison `--p-nom={…}` (ou `@style.--p-nom`)
// d'une balise, l'attribut `style="--p-nom: …"`. Un nom construit (`'--p-' + k`) ne se relève pas : le composant qui
// pose ainsi garde ses lectures au registre.
function scanPosedVars(source: string, prefix: string): string[] {
  const p     = escapeRegex(prefix)
  const name  = '([A-Za-z_][A-Za-z0-9_-]*)'
  const found = new Set<string>()
  for (const m of source.matchAll(new RegExp(`setProperty\\s*\\(?\\s*(['"\`])--${p}-${name}\\1`, 'g'))) found.add(m[2])
  for (const m of source.matchAll(new RegExp(`(?<![\\w-])--${p}-${name}\\s*[={]`, 'g'))) found.add(m[1])
  for (const m of source.matchAll(/\bstyle\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) {
    for (const d of (m[1] ?? m[2]).matchAll(new RegExp(`--${p}-${name}\\s*:`, 'g'))) found.add(d[1])
  }
  return [...found]
}

// scanPrivateVars — registre des variables de thème : celles que le composant pose par son propre CSS sur un élément
// interne ET lit lui-même (`.face { --mjs-i: 1 }` puis `var(--mjs-i, 0)`) : posées par le composant, le registre les marque.
// Le sélecteur de la règle décide : `:host…` vise l'hôte, que le thème de l'application atteint ; tout autre sélecteur
// vise l'intérieur du composant, hors de portée du dehors. Un `:host(.a) .face` compte pour l'hôte (le doute garde
// la variable au registre). Une variable posée à la fois sur l'hôte et à l'intérieur reste réglable.
function scanPrivateVars(css: string, prefix: string): Set<string> {
  const text  = css.replace(/\/\*[\s\S]*?\*\//g, '')
  const decl  = new RegExp(`^\\s*--${escapeRegex(prefix)}-([A-Za-z_][A-Za-z0-9_-]*)\\s*:`)
  const read  = new RegExp(`var\\(\\s*--${escapeRegex(prefix)}-([A-Za-z_][A-Za-z0-9_-]*)`, 'g')
  const host  = new Set<string>()
  const inner = new Set<string>()
  const rules: string[] = []
  let start = 0
  let quote = ''
  let depth = 0
  const declare = (end: number) => {
    const m = decl.exec(text.slice(start, end))
    if (!m) return
    const rule   = [...rules].reverse().find(r => !r.trim().startsWith('@')) ?? ''
    const target = rule.includes(':host') ? host : inner
    target.add(m[1])
  }
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (quote) {
      if (c === '\\') i++
      else if (c === quote) quote = ''
    }
    else if (c === '"' || c === '\'') quote = c
    else if (c === '(') depth++
    else if (c === ')') depth--
    else if (depth > 0) continue
    else if (c === '{') { rules.push(text.slice(start, i)); start = i + 1 }
    else if (c === '}') { declare(i); rules.pop(); start = i + 1 }
    else if (c === ';') { declare(i); start = i + 1 }
  }
  const readNames = new Set([...text.matchAll(read)].map(m => m[1]))
  return new Set([...inner].filter(n => !host.has(n) && readNames.has(n)))
}

// buildVarDeclarations — jumelle chaque déclaration trouvée par scanDeclaredVars() avec
// sa ligne/son commentaire/sa VARIANTE quand elle vient d'un `$$nom` tracé par le transpiler
// (`themeMeta`, même ORDRE d'apparition des deux côtés : le compilateur CSS ne réordonne pas
// les déclarations d'une règle). Une déclaration en CSS brut, jamais passée par `$$`, reçoit
// ligne 0, doc vide et variant vide — toujours légitime, juste sans provenance $$ à documenter.
function buildVarDeclarations(css: string, prefix: string, themeMeta: { name: string; variant: string; line: number; doc: string }[]): { name: string; value: string; variant: string; line: number; doc: string }[] {
  const queues = new Map<string, { variant: string; line: number; doc: string }[]>()
  for (const meta of themeMeta) {
    const q = queues.get(meta.name) ?? []
    q.push({ variant: meta.variant, line: meta.line, doc: meta.doc })
    queues.set(meta.name, q)
  }
  return scanDeclaredVars(css, prefix).map(({ name, value }) => {
    const q = queues.get(name)
    const { variant, line, doc } = q && q.length > 0 ? q.shift()! : { variant: '', line: 0, doc: '' }
    return { name, value, variant, line, doc }
  })
}

// isMuIdentifier / isAnimNode — sorties de la méthode
// extractAnimationsFromAst (où elles vivaient en closures locales) pour être
// PARTAGÉES avec la nouvelle extractDefinedAnimationsFromAst (anims
// µanim.create/crossfade). Fonctions pures (pas de `this`), même
// convention que dataEqualExceptBaseCss/computeScopedCss ci-dessus.
// Reconnaît `µ` ou `µ?.` (Identifier sur `µ`).
function isMuIdentifier(n: any): boolean {
  return n?.type === 'Identifier' && n.name === 'µ'
}

// Reconnaît `µ.anim` ou `window.µ.anim` (MemberExpression, optionnel ou pas).
function isAnimNode(n: any): boolean {
  if (!n || (n.type !== 'MemberExpression' && n.type !== 'ChainExpression')) return false
  const me = n.type === 'ChainExpression' ? n.expression : n
  if (me.type !== 'MemberExpression') return false
  if (me.property?.type !== 'Identifier' || me.property.name !== 'anim') return false
  if (isMuIdentifier(me.object)) return true
  // `window.µ.anim`
  if (me.object?.type === 'MemberExpression' &&
      me.object.object?.type === 'Identifier' && me.object.object.name === 'window' &&
      isMuIdentifier(me.object.property)) {
    return true
  }
  return false
}

// le nom d'une animation que `µanim.create` / `µanim.crossfade` enregistre, quand il est fixe : une chaîne, ou un gabarit sans substitution (`titre`) ;
// tout autre premier argument (variable, expression, gabarit à substitution) est un nom calculé, que la construction ne lit pas
function literalName(arg: any): string | null {
  if (arg?.type === 'Literal' && typeof arg.value === 'string') return arg.value
  if (arg?.type === 'TemplateLiteral' && arg.expressions.length === 0) return arg.quasis[0].value.cooked ?? null
  return null
}

// `at` est-il dans la valeur d'un attribut (entre guillemets ou accolades) de la balise ouverte en `start` ? Une directive s'écrit au niveau de la balise,
// jamais dans la valeur d'un autre attribut (`title="@in=*titre"` est un texte) ; mêmes règles de guillemets et d'accolades que tagSpans (transpile-msg.ts)
function insideValue(text: string, start: number, at: number): boolean {
  let quote  = ''
  let braces = 0
  for (let i = start + 1; i < at; i++) {
    const c = text[i]
    if (quote) { if (c === quote) quote = ''; continue }
    if (c === '"' || c === '\'') quote = c
    else if (c === '{') braces++
    else if (c === '}' && braces > 0) braces--
  }
  return quote !== '' || braces > 0
}

// repère (placeholder) : chemin provisoire de LONGUEUR ÉGALE au chemin final, écrit
// tant que le cœur (ou une feuille split) n'est pas encore connu (phase A) — `writeHashed()`
// pose une empreinte de 5 caractères minuscules ou chiffres, `Z` majuscule n'en fait jamais partie : aucun vrai hash ne peut ressembler
// à un repère, la longueur égale préserve les cartes de source colonne par colonne (cf.
// `Bundler.placeholderPath()`).
const HASH_PLACEHOLDER = 'Z'.repeat(FINGERPRINT_LENGTH)

// variant de mise en page déposé À LA MAIN dans outputDir (`<module>.<nom>.css`) — seul
// signal de `collectUsedFeatures()` qui ne vienne pas d'une unité compilée par CE build (cf.
// bandeau de la méthode).
const REGEX_VARIANT_FILE = /^([^.]+)\.[^.]+\.css$/

// lecture du groupe `core` des libellés dans le texte d'un fichier du PROJET (la copie éjectée d'un module cœur garde son
// `µ._mjs_label('core', key)`) : cherchée sans l'objet (`µ`/`mjs` selon la config), cf. coreLabelModules()
const REGEX_CORE_LABEL_READ = /_mjs_label\(\s*['"]core['"]/

// une source du PROJET peut-elle donner l'attribut `attr` à une balise du module cœur `module` sans que le relevé des balises le voie (cf.
// coreAttrWrittenStrict) ? Un module .civet, .coffee, .js ou .ts (`script` vrai) : dès qu'il nomme la balise (`mjs-core-chart`, `@@chart`), il peut la
// fabriquer. Un composant .mjs : ses blocs <script> de même ; son gabarit, par une balise dynamique (<@element $tag>, <@module $comp>) qui écrit
// l'attribut, quelle que soit la forme de sa valeur, ou un étalement `{...p}` — ou qui ne se referme pas : dans le doute, oui
function coreTagDoubt(src: string, module: string, attr: string, script: boolean): boolean {
  const named = new RegExp(`(?:mjs-core-|@@)${module}(?![\\w-])`, 'i')
  if (script) return named.test(src)
  for (const m of src.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)) if (named.test(m[1])) return true
  const written = new RegExp(`\\s${attr}(?![\\w-])`, 'i')
  for (const m of src.matchAll(/<?@(?:element|module)(?![\w-])/gi)) {
    const end = tagEnd(src, m.index + m[0].length)
    if (end < 0) return true
    const head = src.slice(m.index, end)
    if (/\{\s*\.\.\./.test(head) || written.test(head)) return true
  }
  return false
}

// la fin d'une balise ouverte avant `from` (l'indice qui suit son `>`), valeurs entre guillemets et entre accolades sautées ; -1 quand elle ne se referme pas
function tagEnd(src: string, from: number): number {
  let depth = 0
  let quote = ''
  for (let i = from; i < src.length; i++) {
    const c = src[i]
    if (quote) {
      if (c === quote) quote = ''
    }
    else if (c === '"' || c === '\'') quote = c
    else if (c === '{') depth++
    else if (c === '}') depth--
    else if (c === '>' && depth <= 0) return i + 1
  }
  return -1
}

// fichiers du cœur que l'atelier de thème (/__mjs/theme, src/server/theme-viewer.mjs) appelle : ce que `scanCompiledFeatures`
// relève dans son code compilé, ni plus ni moins (tests/theme-atelier-coeur-developpement.test.ts le garde) — cf. resolveRuntimeFiles
const ATELIER_RUNTIME = ['mjs_deep.ts', 'mjs_destroy_hooks.ts', 'mjs_for.ts', 'mjs_for_nested.ts', 'mjs_if.ts', 'mjs_lifecycle.ts']

// modes de rendu qui ADOPTENT le DOM du serveur (mjs_hydrate.ts) — formes CANONIQUES, cf.
// `normalizeMode` (src/server/render-routes.ts) : `ssr` seul y devient `ssr:replace`, qui n'adopte
// rien (il jette la photo serveur et reconstruit la vue), comme `csr` et `prerender`.
const HYDRATING_MODES = new Set<string>(['ssr:markers', 'ssr:positional', 'ssr:diff'])

// unité en attente d'émission (phase A → phase C, cf. compile()). 'cold' : code
// fraîchement compilé (repères non résolus dans `code`), prêt à écrire dès que ses `deps`
// (stems) ont tous un chemin final. 'cached' : cache-hit CANDIDAT (contenu source inchangé
// depuis le tour précédent) — sa validité réelle ne se décide qu'en phase C, une fois le
// cœur/les feuilles split connus (cf. `CacheEntry.embeds`) ; si périmée, elle est recompilée
// au chemin froid et rejoint le pool 'cold'.
type PendingUnit =
  | { kind: 'cold'; file: string; stem: string; ext: string; code: string; map?: string; deps: string[]; features: string[]; cacheFields?: Omit<CacheEntry, 'hashedPath' | 'gen' | 'embeds' | 'features'> }
  | { kind: 'cached'; file: string; stem: string; cached: CacheEntry }

interface CacheEntry {
  hash: string
  /** Génération du compile() qui a écrit cette entrée (cf. `Bundler.compileGeneration`
   * et `cacheHitsThisCompile`) — distingue un cache-hit INTRA-compile (entrée posée PENDANT ce même
   * compile(), assets annexes déjà émis ce tour-ci, inoffensif) d'un hit INTER-compile (entrée d'un
   * compile() antérieur, assets annexes hors de `emittedThisCompile`). */
  gen: number
  // (champ `output` supprimé : jamais relu — il retenait en RAM le bundle
  // minifié de CHAQUE fichier pendant toute la vie d'un process watch.)
  hashedPath: string
  usedAnimations?: string[]
  // ceux de usedAnimations que l'appli définissait (un `*.effects.mjs`) quand le composant s'est compilé : le cache les compare aux noms définis d'un tour
  // ultérieur, un nom qui change de statut (défini ou non) recompile le composant
  appAnimations?: string[]
  definedAnimations?: string[]
  /** Jumeau CSS de usedAnimations (cf. TranspileDataLike.sharedCssNames) —
   * réinjecté dans `this.requestedSharedSheets` sur un cache-hit, sinon un
   * composant inchangé disparaîtrait de la validation au rebuild incrémental. */
  sharedCssNames?: string[]
  includedPartials?: string[]
  /** Modules `.civet` / `.coffee` importés via `@import name 'path'`. Tracked
   * pour que le watcher invalide les .mjs parents quand un module change. Avec eux, les fichiers que l'unité cite par
   * `µasset(…)` (un .js cité entraîne ses voisins) : ils entrent dans le hash, et le cache qui resert l'unité sait
   * quels fichiers publiés garder au précache (cf. keepCachedAssets). */
  importedModules?: string[]
  /** fichiers `*.types.mjs` dont dépend CE composant (il cite une règle nommée) — entrent dans le
   *  hash : une règle changée le recompile */
  typesDeps?: string[]
  /** fichiers `*.effects.mjs` dont dépend CE composant (il pose un effet de l'appli) — même rôle */
  effectsDeps?: string[]
  /** règles de ses stores (`$$x` dans son <vars>) — réinjectées sur un cache-hit, cf. pendingStoreTypes */
  storeTypes?: Record<string, string>
  /** avertissements de section de CE fichier (2e <script> jeté, composant sans HTML…) — redits sur un
   *  cache-hit : sans eux, `lint.emptyComponent: "error"` cessait d'échouer au tour suivant de `mjs dev` */
  sectionWarnings?: string[]
  /** Variables de thème $$ (registre du build) — jumeau de sharedCssNames
   * ci-dessus : réinjectés dans `this.pendingVarData` sur un cache-hit, sinon
   * un composant inchangé disparaîtrait du registre au rebuild incrémental. */
  baseCss?: string
  layoutCss?: Record<string, string>
  themeVars?: { name: string; variant: string; line: number; doc: string }[]
  varsRead?: string[]
  /** Références de tags `<@nom>` du fichier — jumeau de sharedCssNames/themeVars
   * ci-dessus, même raison, mais la conséquence est plus grave : sans réinjection
   * dans `this.pendingTagRefs` sur un cache-hit, les MODULES CŒUR réclamés par un
   * composant inchangé ne sont plus recompilés au rebuild incrémental et
   * DISPARAISSENT de `µ.paths` (resolveTagShortcuts ne voit plus la demande) — leur
   * balise 404 en silence jusqu'au prochain redémarrage. Invisible en `mjs build`
   * (cache froid à chaque process), fatal en `mjs dev` (Bundler.watch() garde la
   * MÊME instance toute la session). */
  tagRefs?: { name: string; kind: TagRefKind; layoutLiteral?: string; attrs?: TagRef['attrs'] }[]
  /** Jumeau de tagRefs ci-dessus, même raison : dépendances directes de balises
   * (cf. collectDirectComponentDeps, generator/compile.ts) — sans réinjection dans
   * `this.pendingComponentDeps` sur un cache-hit, un composant inchangé disparaît de
   * la table de préchargement au rebuild incrémental (writeManifest, µ_DEPS). */
  componentDeps?: string[]
  /** chemins RÉELS embarqués par CE fichier à sa dernière émission (cœur + feuilles
   * split et fichiers d'effets qu'il cite, triés) : un cache-hit n'est valide EN PHASE C que si
   * chacun de ces chemins est encore embarquable ce tour-ci et que le cœur courant y figure (sinon
   * périmé, recompilé au chemin froid, cf. emitPendingUnits()).
   * Remplace le sel de hash (cssSalt/coreHashedPath dans le hash lui-même, retiré). */
  embeds?: string[]
  /** signaux compilés (scanCompiledFeatures) de CE fichier, hydratés dans
   * `this.pendingFeatures` sur un cache-hit — jumeau de usedAnimations : sans réinjection, un
   * composant inchangé disparaîtrait de `collectUsedFeatures()` au rebuild incrémental. */
  features?: string[]
  /** symboles du CONTRAT appelés par CE fichier (collectCoreCalls, core-contract.ts), hydratés
   * dans `this.pendingCoreCalls` sur un cache-hit — jumeau exact de features ci-dessus. Sans
   * réinjection, un composant inchangé cesserait de réclamer ce qu'il appelle : la garde de
   * bundleRuntime() ne verrait plus son besoin, et laisserait passer le cœur amputé qui le tue. */
  coreCalls?: string[]
  /** mode 'bundle' SEULEMENT (jamais rempli en mode 'split', où l'unité vit sur disque et
   * `hashedPath` suffit à la relire) : code JS minifié final de CE fichier (repères déjà
   * résolus en spécificateurs virtuels 'mjs:...') et sa carte de source, gardés en RAM —
   * aucune unité n'étant écrite sur disque en mode bundle, un cache-hit ne peut rien relire
   * du filesystem. `embeds` reste `[]` pour ces entrées (cf. emitSingleFile()) : la validité
   * d'un cache-hit ne dépend plus du cœur/des styles, seulement de `hash` (contenu+deps). */
  code?: string
  map?: string
  /** noms courts que CE fichier peut porter par nom sur une instance (cf. collectInstanceNames,
   * minify.ts), relevés à sa dernière compilation froide — réinjectés dans la réservation du tour
   * sur un cache-hit, jumeau de usedAnimations. Vide hors minification. */
  reservedNames?: string[]
  /** génération du cache de raccourcissement (`Bundler.mangleGeneration`) au moment où CE code a
   * été minifié : un cache-hit n'est confirmé en phase C que si elle est encore la génération
   * courante — sinon une correspondance qu'il utilise a été retirée entre-temps, il est
   * recompilé au chemin froid comme une entrée périmée. */
  mangleGen?: number
}

// Fin (exclue) de la parenthèse/du crochet/de l'accolade ouvert en `s[openIdx]` — profondeur
// consciente de `(`/`[`/`{` mêlés (un appel dans une valeur par défaut compte), guillemets et
// gabarits traversés sans s'y arrêter. -1 si jamais refermé (motif abandonné proprement plutôt
// que de boucler dans le vide).
function matchingBracket(s: string, openIdx: number): number {
  const close = s[openIdx] === '{' ? '}' : ']'
  let depth = 0
  for (let i = openIdx; i < s.length; i++) {
    const c = s[i]
    if (c === '\'' || c === '"' || c === '`') { const e = skipQuotedOrTemplate(s, i, c); if (e < 0) return -1; i = e - 1; continue }
    if (c === '(' || c === '[' || c === '{') depth++
    else if (c === ')' || c === ']' || c === '}') { depth--; if (depth === 0 && c === close) return i }
  }
  return -1
}

/** Fin (exclue) d'une chaîne/d'un gabarit ouvert en `start` avec le délimiteur `quote` —
 *  un gabarit n'est PAS traversé caractère à caractère pour ses `${…}` (inutile ici : seule la
 *  position de la fermeture compte, jamais son contenu). */
function skipQuotedOrTemplate(s: string, start: number, quote: string): number {
  let i = start + 1
  let depthAccolade = 0   // à l'intérieur d'un ${…} de gabarit
  while (i < s.length) {
    const c = s[i]
    if (c === '\\') { i += 2; continue }
    if (quote === '`') {
      if (depthAccolade === 0 && c === '`') return i + 1
      if (c === '{') depthAccolade++
      else if (c === '}' && depthAccolade > 0) depthAccolade--
    } else if (c === quote) return i + 1
    i++
  }
  return -1
}

/** Position du premier `ch` de `s` à PROFONDEUR ZÉRO (jamais dans une chaîne/un gabarit, ni
 *  dans une paire `()`/`[]`/`{}` imbriquée) — -1 si absent. */
function topLevelIndexOf(s: string, ch: string): number {
  let depth = 0
  for (let i = 0; i < s.length; i++) {
    const c = s[i]
    if (c === '\'' || c === '"' || c === '`') { const e = skipQuotedOrTemplate(s, i, c); if (e < 0) return -1; i = e - 1; continue }
    if (c === '(' || c === '[' || c === '{') depth++
    else if (c === ')' || c === ']' || c === '}') depth--
    else if (depth === 0 && c === ch) return i
  }
  return -1
}

/** Éléments de `s` séparés par une virgule à PROFONDEUR ZÉRO. */
function splitTopLevelComma(s: string): string[] {
  const parts: string[] = []
  let depth = 0, start = 0
  for (let i = 0; i < s.length; i++) {
    const c = s[i]
    if (c === '\'' || c === '"' || c === '`') { const e = skipQuotedOrTemplate(s, i, c); if (e < 0) { i = s.length; break }; i = e - 1; continue }
    if (c === '(' || c === '[' || c === '{') depth++
    else if (c === ')' || c === ']' || c === '}') depth--
    else if (depth === 0 && c === ',') { parts.push(s.slice(start, i)); start = i + 1 }
  }
  parts.push(s.slice(start))
  return parts
}

/** Retire les espaces de tête/fin de `masked`/`raw` (même longueur, même intervalle appliqué
 *  aux deux) — décision prise sur `raw` : un espace introduit par le masquage (guillemet blanchi
 *  en tête d'élément, ex. `'a-b': x`) n'est pas un espace RÉEL, seul `raw` sait faire la
 *  différence ; trimmer sur `masked` mangerait ce guillemet sans retour possible. */
function trimAligned(masked: string, raw: string): [string, string] {
  let start = 0
  let end = raw.length
  while (start < end && /\s/.test(raw[start])) start++
  while (end > start && /\s/.test(raw[end - 1])) end--
  return [masked.slice(start, end), raw.slice(start, end)]
}

/**
 * Identifiants LIÉS par un motif de déstructuration (`pattern` commence par `{` ou `[`, ou est
 * un identifiant nu avec valeur par défaut facultative) — récursif pour l'imbrication. N'est
 * PAS un vrai parseur JS (une valeur par défaut avec ternaire imbriquant un `:` peut abuser la
 * détection de la clé d'un objet, cf. le garde-fou `cleValide` ci-dessous) : suffisant pour
 * reconnaître ce que Civet compile réellement pour `{...} := expr`/`[...] := expr`.
 * `pattern` (masqué, chaînes/gabarits/commentaires blanchis, même longueur) porte tout le
 * découpage structurel (accolades, virgules, `:` de tête) — un commentaire de fin de ligne avec
 * un `{`/`,`/`:` littéral ne doit pas fausser le comptage. `patternRaw` (texte réel, toujours
 * même longueur que `pattern`) ne sert qu'à relire un caractère que le masquage efface : une clé
 * littérale ENTRE GUILLEMETS, cf. `cleValide` ci-dessous.
 */
function bindingIdentifiers(pattern: string, patternRaw: string): string[] {
  const [trimmed, trimmedRaw] = trimAligned(pattern, patternRaw)
  if (trimmed === '') return []                                 // trou d'un tableau : [a, , b]
  if (trimmed.startsWith('...')) return bindingIdentifiers(trimmed.slice(3), trimmedRaw.slice(3))
  if (trimmed[0] === '{' || trimmed[0] === '[') {
    const close = matchingBracket(trimmed, 0)
    if (close < 0) return []
    const inner    = trimmed.slice(1, close)
    const innerRaw = trimmedRaw.slice(1, close)
    const isObjet  = trimmed[0] === '{'
    const idents: string[] = []
    let offset = 0
    for (const element of splitTopLevelComma(inner)) {
      // même intervalle que `element` reporté sur `innerRaw` (longueurs alignées) ; +1 pour la
      // virgule consommée par splitTopLevelComma entre deux éléments
      const elementRaw = innerRaw.slice(offset, offset + element.length)
      offset += element.length + 1
      const [el, elRaw] = trimAligned(element, elementRaw)
      if (el === '') continue
      if (!isObjet) { idents.push(...bindingIdentifiers(el, elRaw)); continue }
      // objet : `clé: cible` (renommage/nid) ou raccourci `clé` (+ défaut) — un `:` trouvé
      // n'est un vrai séparateur clé/cible QUE si ce qui le précède ressemble à une clé
      // (identifiant, chaîne, nombre, `[calculée]`) ; sinon (ex. un `?:` ternaire dans une
      // valeur par défaut) l'élément entier reste un raccourci. `cle` se lit sur `elRaw` (texte
      // réel) : sur la vue masquée, une clé entre guillemets (`'a-b'`) est blanchie guillemets
      // compris et ne matche plus jamais `(['"]).*\1`.
      const colon = topLevelIndexOf(el, ':')
      const cle = colon >= 0 ? elRaw.slice(0, colon).trim() : ''
      const cleValide = /^(?:[A-Za-z_$][\w$]*|(['"]).*\1|\d+|\[[\s\S]*\])$/.test(cle)
      idents.push(...bindingIdentifiers(
        colon >= 0 && cleValide ? el.slice(colon + 1) : el,
        colon >= 0 && cleValide ? elRaw.slice(colon + 1) : elRaw
      ))
    }
    return idents
  }
  // IDENT ou IDENT = défaut — seule la partie AVANT le `=` top-level est une cible de liaison,
  // le reste (valeur par défaut) n'est jamais une déclaration.
  const eq    = topLevelIndexOf(trimmed, '=')
  const ident = (eq >= 0 ? trimmed.slice(0, eq) : trimmed).trim()
  return /^[A-Za-z_$][\w$]*$/.test(ident) ? [ident] : []
}

// Civet préserve les assignations top-level bares (`foo = 1`) telles quelles.
// En module ESM (strict mode), c'est illégal — CoffeeScript en mode `bare`
// les déclare automatiquement avec `var`. On reproduit ce comportement.
//
// Heuristique : repère les lignes `^<indent?>IDENT = ...` au top-level du
// fichier (pas dans une fonction), où IDENT n'est pas déjà précédé d'un
// `var`/`let`/`const`/`export`/`function`/etc. Préfixe `var ` au premier
// usage de chaque identifier ; les ré-assignations restent intactes.
//
// Exportée (pas seulement pour usage interne) pour permettre un test direct
// de cette fonction pure sans dépendre du compilateur Civet réel — cf. son
// test de régression pour le pourquoi (reproduire empiriquement, via du VRAI
// code Civet, le scénario précis ci-dessous s'est avéré peu fiable : le
// compilateur Civet infère très bien la portée dans la plupart des cas
// simples, le bug ne se manifeste que sur un agencement précis de son
// SORTIE déjà compilée).
export function autoDeclareTopLevelBareAssignments(js: string, fileName = 'inline.civet'): string {
  const lines = js.split('\n')
  // décision sur une vue MASQUÉE (chaînes/gabarits/commentaires blanchis, même longueur,
  // `\n` gardés) : une ligne DE TEXTE (doc exportée en gabarit) qui ressemble à une
  // déclaration ou une affectation bare ne doit jamais en être une — sans ce masquage, un
  // `total = 0` cité en exemple DANS un template literal recevait un `var` en plein milieu de
  // la chaîne (texte affiché corrompu, aucune erreur de build). Le TEXTE réécrit reste
  // toujours celui de `lines` (jamais la vue masquée) : seul le CHOIX de réécrire se décide dessus.
  const masked      = maskInertSameLength(js)
  const maskedLines = masked.split('\n')
  const declared = new Set<string>()
  // Patterns prouvant qu'un identifiant a déjà une déclaration côté Civet :
  // `var x`, `let x`, `const x`, `export var x`, `export let x`, `export const x`,
  // `export function x`, `function x()`, `for (let|var|const x ...`, etc.
  // `class Foo`, `function* gen` (avec ou sans espace autour de `*`) lient aussi leur nom : sans eux, leur réaffectation
  // recevait un `var` en double, module invalide
  const declRe = /\b(?:(?:var|let|const|class)\s+|function(?:\s*\*\s*|\s+))([a-zA-Z_$µ][\w$]*)/g
  // `var|let|const` suivi directement d'un `{`/`[` : déclaration par DÉSTRUCTURATION —
  // invisible à `declRe` ci-dessus, qui n'admet qu'un identifiant nu juste après le mot-clé.
  // Sans elle, chaque identifiant LIÉ (ex. `width` de `const {width, height} = getSize()`)
  // restait absent de `declared` : sa réaffectation plus bas recevait un `var` EN TROP — double
  // déclaration du même identifiant, `SyntaxError`, build en échec.
  const destructureRe = /\b(?:var|let|const)\s*(?=[{[])/g
  // ce scan portait sur TOUTES les
  // lignes, y compris celles INDENTÉES (corps de fonction/bloc). Une
  // déclaration LOCALE à une fonction imbriquée (`let count = 5` dans
  // `tick`) peuplait `declared` au même titre qu'une déclaration RÉELLEMENT
  // top-level — si le fichier contient PAR AILLEURS une assignation bare
  // top-level HOMONYME (`count = 0` en tête de fichier, sur une ligne que
  // Civet a laissée sans déclaration), `declared.has('count')` répondait à
  // tort `true` : aucun `var` n'était préfixé, l'assignation top-level
  // restait bare → `ReferenceError: count is not defined` en strict mode
  // ESM au chargement, alors que le build ne signalait RIEN (silencieux,
  // vert). Fix : n'alimente `declared` qu'à partir des lignes NON indentées
  // — même heuristique que celle déjà utilisée juste en dessous pour repérer
  // les assignations bare elles-mêmes ; une déclaration DANS une fonction ne
  // peut de toute façon jamais satisfaire le besoin d'un `var` top-level
  // (portées distinctes).
  for (let li = 0; li < maskedLines.length; li++) {
    const line = maskedLines[li]
    if (/^\s/.test(line)) continue
    const rawLine = lines[li]
    let m: RegExpExecArray | null
    while ((m = declRe.exec(line)) !== null) declared.add(m[1])
    while ((m = destructureRe.exec(line)) !== null) {
      const start = m.index + m[0].length
      for (const ident of bindingIdentifiers(line.slice(start), rawLine.slice(start))) declared.add(ident)
    }
  }
  // noms liés par un `import` de premier niveau (défaut, `* as ns`, `{ a, b as c }`, sur une ou plusieurs lignes) : lus
  // sur la vue masquée entière, une liste entre accolades pouvant s'étaler sur des lignes indentées
  for (const m of masked.matchAll(/^import\s+([^;]*?)\s+from\b/gm)) {
    let clause = m[1]
    const accolades = clause.match(/\{([^}]*)\}/)
    if (accolades) {
      for (const spec of accolades[1].split(',')) {
        const nom = spec.trim().split(/\s+as\s+/).pop()!.trim()
        if (/^[a-zA-Z_$µ][\w$]*$/.test(nom)) declared.add(nom)
      }
      clause = clause.replace(accolades[0], '')
    }
    for (const part of clause.split(',')) {
      const nom = part.trim().replace(/^\*\s*as\s+/, '')
      if (/^[a-zA-Z_$µ][\w$]*$/.test(nom)) declared.add(nom)
    }
  }
  // Heuristique simple : on ne préfixe que les lignes top-level (indentation 0).
  // Une ligne `IDENT = expr` (sans var/let/const/return/throw/await/etc devant)
  // est une assignation bare → ajout de `var `.
  const bareAssignRe = /^([a-zA-Z_$µ][\w$]*)\s*=(?!=|>)/
  const result = lines.map((line, i) => {
    const maskedLine = maskedLines[i]
    // Ignore les lignes indentées (intérieur de fonction/bloc) : elles ne
    // posent pas le problème ESM strict (la fonction englobante crée son
    // scope ; bare assignment dedans est `implicit global` mais ne crashe
    // pas tant que le module ne tourne pas en strict — en pratique, Civet
    // émet des `var` automatiquement à l'intérieur des fonctions).
    if (/^\s/.test(maskedLine)) return line
    const m = maskedLine.match(bareAssignRe)
    if (!m) return line
    const ident = m[1]
    if (declared.has(ident)) return line
    declared.add(ident)
    return 'var ' + line
  }).join('\n')
  // réaffectation d'un identifiant lié par `:=` (const, simple ou déstructuré, réaffectation
  // simple/composée/++/--, depuis n'importe quelle portée) : contrôle UNIQUE par résolution de
  // portée exacte sur le JS ci-dessus, une fois tous les `var` top-level posés — cf.
  // const-reassign.ts pour ce qu'une détection ligne à ligne comme celle au-dessus ne peut pas
  // voir (réaffectation dans un bloc indenté, depuis une fonction imbriquée sans homonyme local).
  const violation = findConstReassignment(result)
  if (violation) throw new Error(t('bundler.index.civet-reaffectation-constante', { fichier: fileName, nom: violation.name, ligne: violation.line }))
  return result
}

// Extraction des directives `@import` :
// 2 défauts liés, mêmes 2 sites d'appel (preResolveAssets + suivi des
// dépendances .civet/.coffee dans _compileMjsInner), donc factorisés ici en
// UN SEUL endroit pour ne fixer/maintenir qu'une fois.
//
//   1. Même classe de bug qu'un correctif précédent (`preprocessHtml` du
//      transpiler, `@preload`/`@noUJS`) : la regex opère sur le CONTENU
//      BRUT du fichier, sans masquer les blocs `<pre>`/`<code>` — une
//      leçon/doc de tuto qui AFFICHE `@import foo 'bar.civet'` comme
//      EXEMPLE DE CODE (pas une vraie directive) se faisait quand même
//      extraire et tenter de résoudre comme un import réel.
//   2. La classe de caractères de l'identifiant contenait `\s` (PAS `[ \t]`)
//      — `\s` matche AUSSI le saut de ligne. Combiné à la quantification
//      paresseuse (`+?`) et au flag `m` (où `^`/`$` matchent à CHAQUE
//      frontière de ligne, pas seulement début/fin de fichier), un
//      `@import` mal formé (guillemet fermant manquant sur sa ligne) pouvait
//      voir son « nom d'identifiant » enjamber le saut de ligne et continuer
//      la recherche du guillemet fermant sur une ligne ULTÉRIEURE totalement
//      sans rapport, extrayant un chemin fantaisiste.
//
// Fix : (a) masque `<pre>`/`<code>` (mêmes octets non-`@`/non-guillemets,
// mais NEWLINES préservés — la fonction ne fait qu'extraire des paths, pas
// de restauration nécessaire, mais préserver les sauts de ligne reste plus
// sûr si une future logique s'appuyait sur les numéros de ligne) ; (b) `\s`
// → `[ \t]` dans la classe de caractères — un `@import` ne peut plus jamais
// s'étendre au-delà de SA PROPRE ligne, quelle que soit sa forme.
const IMPORT_DIRECTIVE_RE =
  /^[ \t]*@import[ \t]+(?:default[ \t]+)?[a-zA-Z0-9_$, \tµ§]+?[ \t]+['"](.+?)['"][ \t]*$/gm

// µimport('chemin.js')/mjsimport('chemin.js') LITTÉRAL, forme NUE (appel
// direct, sans passer par un `@import name 'chemin'` nommé) : regex SŒUR de
// IMPORT_CALL_RE (preResolveAssets), extraite ICI en constante de module pour être
// réutilisée par `collectTransitiveImportClosure` — sinon un module .civet/.coffee
// @import-é qui appelle lui-même µimport() sur un asset voit ce dernier absent de la
// fermeture transitive (hash + reverse-map watch), staleness silencieuse en mjs dev.
const MU_IMPORT_CALL_RE = new RegExp(`${MU_IMPORT_BODY}\\s*\\(\\s*['"]([^'"]+)['"]\\s*\\)`, 'g')

// µimport 'chemin.js' / mjsimport 'chemin.js' LITTÉRAL, forme NUE SANS
// PARENTHÈSES (appel Civet/CoffeeScript sans parenthèses, légal côté compilation,
// cf. sigils.ts) : invisible à MU_IMPORT_CALL_RE ci-dessus, qui exige la
// parenthèse ouvrante — même staleness silencieuse que la forme avec parenthèses ci-dessus, côté forme nue.
// Garde de tête `(?<![\w.µ])` (cf. sigils.ts ~131) : évite un faux positif sur un
// identifiant plus long se terminant par le motif (ex. `xmjsimport 'a'`).
const MU_IMPORT_BARE_RE = new RegExp(`(?<![\\w.µ])${MU_IMPORT_BODY}[ \\t]+['"]([^'"]+)['"]`, 'g')

// un fichier cité par µimport/µasset dont la fermeture est suivie : .js copié tel quel, ou module .civet/.coffee compilé
const MODULE_OU_JS_RE = /\.(?:js|civet|coffee)$/i

// du code : ses voisins, ses imports et ses noms de module se résolvent sous sourceDir, jamais dans un dossier de assetDirs
const ASSET_CODE_RE = /\.(?:mjs|civet|coffee|js)$/i

function maskCodeBlocks(html: string): string {
  const blank = (m: string) => m.replace(/[^\n]/g, ' ')
  return html
    .replace(/<pre\b[^>]*>[\s\S]*?<\/pre>/gi, blank)
    .replace(/<code\b[^>]*>[\s\S]*?<\/code>/gi, blank)
}

/** Comme `maskCodeBlocks`, PLUS `<script>`/`<style>`/commentaires HTML — nécessaire avant de
 *  chercher des balises `<@@img>` (scanImgTags, transpiler/img-tag.ts) : une balise `<@@img>`
 *  n'existe que dans le TEMPLATE, jamais dans du code ou un commentaire, contrairement à
 *  `µasset(...)`/`@import`/`µimage(...)`, qui vivent eux DANS `<script>` et restent scannés là
 *  (maskCodeBlocks seul, sans cette couche en plus). Sans ce masquage, un `<@@img src="…">` cité
 *  dans une chaîne de `<script>`, dans un `<style>` ou dans un commentaire HTML était traité
 *  comme une vraie balise (résolution tentée, échec de build si le fichier n'existe pas). */
function maskImgTagScanZones(html: string): string {
  const blank = (m: string) => m.replace(/[^\n]/g, ' ')
  return maskCodeBlocks(html)
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, blank)
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, blank)
    .replace(/<!--(?:-?>|[\s\S]*?--!?>)/g, blank)
}

/** Extrait les paths cités par `@import name 'path'`, en ignorant ceux
 * affichés comme simple exemple de code dans un bloc `<pre>`/`<code>`.
 * Exportée pour un test direct (fonction pure, sans dépendance à `this`). */
export function extractImportMatches(content: string): RegExpMatchArray[] {
  return [...maskCodeBlocks(content).matchAll(IMPORT_DIRECTIVE_RE)]
}

// ----------------------------------------------------------------------------
// VIEW_TAG_RE/VIEW_CSS_ATTR_RE : reconnaît `css="a b"` / `css='a b'`
// LITTÉRAL sur un `<@view …>`, dans le contenu BRUT d'un composant (avant transpile).
// Même forme que le groupe css du preprocess (generator/compile.ts, `<@view name
// [css="..."]…> → <metamjs-view id="name" css="..."…>`) — dupliquée à dessein plutôt que
// partagée entre les deux fichiers (même raison que emitSplitStyles()/bundleSharedStyles()
// plus bas : ce contrat est figé, un refactor inter-fichiers ferait courir un risque de
// régression pour un gain de factorisation mineur).
//
// Sert le filet de sécurité du mode css='split' (cf. Bundler.viewRequestedSheets,
// finalizeSplitStyles) : une feuille réclamée par cette voie SEULEMENT (jamais par `@css`)
// doit rester chargée d'office, exactement comme le runtime la charge (mjs_element.ts,
// `_mjs_applyLayout`, héritage `<metamjs-view css="…">`).
// ----------------------------------------------------------------------------
const VIEW_TAG_RE = /<@view\s+[\w-]+((?:\s+(?:css|data-mjs-vt|data-mjs-vt-p)=["'][^"']*["'])*)\s*\/?>/gi
const VIEW_CSS_ATTR_RE = /\bcss=(["'])([^"']*)\1/i

/** Noms de feuilles nommés par un `css="a b"` LITTÉRAL d'un `<@view>`, dans le contenu brut
 * d'un composant — masque `<pre>`/`<code>` (même garde qu'extractImportMatches ci-dessus :
 * une leçon de tuto qui AFFICHE `<@view x css="y">` en exemple ne doit rien réclamer).
 *
 * LIMITES ASSUMÉES (cf. finalizeSplitStyles, pas résolues ici) :
 *   - un `css={expression}` calculé (jamais entre guillemets) est invisible ICI par
 *     construction — seule la forme littérale se voit au build. Ce cas garde le
 *     comportement runtime actuel (avertissement à l'exécution si la feuille manque,
 *     cf. mjs_element.ts « Orphelin CSS hérité »), jamais forcé eager.
 *   - un `<@view>` posé dans un `<@include>` (partial, pas le composant lui-même) est
 *     également invisible ICI : cette fonction ne voit que le fichier .mjs tel qu'écrit,
 *     AVANT résolution des partials (même contenu que `_compileMjsInner` reçoit de
 *     `readFileSync`) — cas jugé marginal (`<@view>` cible un point de montage propre à
 *     UN composant, rarement partagé via partial).
 *
 * Exportée pour un test direct (fonction pure, sans dépendance à `this`), même esprit
 * qu'extractImportMatches. */
export function extractViewCssNames(content: string): string[] {
  const names: string[] = []
  for (const tagMatch of maskCodeBlocks(content).matchAll(VIEW_TAG_RE)) {
    const cssMatch = VIEW_CSS_ATTR_RE.exec(tagMatch[1])
    if (cssMatch) names.push(...cssMatch[2].split(/\s+/).filter(Boolean))
  }
  return names
}

// ----------------------------------------------------------------------------
// ASSET_RE — reconnaît `µasset(...)` / `µ.asset(...)` / `mjsasset(...)` /
// `mjs.asset(...)` dans un texte déjà compilé (composant, module, mjs_core).
// Utilisée par `resolveMagicAssets` (méthode d'instance, cf. plus bas) ;
// exportée à plat (constante pure, aucune dépendance à `this`) pour un test
// direct — verrou µasset-dans-<@head> (cf. son test dédié).
//
// `buildHeadInjection`
// (transpiler/macros.ts) émet le contenu d'un <@head> en chaîne Civet
// SIMPLE-QUOTE avec échappement `\'` : un `<@head><style>@font-face {
// src: url(µasset('fonts/x.woff2')) }</style></@head>` compile donc en
// `µasset(\'fonts/x.woff2\')` (guillemets ÉCHAPPÉS), pas `µasset('…')`.
// Une version antérieure de cette regex exigeait un guillemet NU juste après
// `(`/avant `)` — le `\` intercalé faisait échouer tout le match : substitution
// ratée SILENCIEUSEMENT, l'appel `µasset(...)` littéral partait tel quel dans
// le fichier écrit, la police jamais chargée.
// Fix : tolère un backslash optionnel de chaque côté du guillemet interne —
// CAPTURÉ (groupes 2 et 3, pas juste consommé) pour être RÉINJECTÉ à
// l'identique côté remplacement (sinon le remplacement, ignorant l'échappement
// d'origine, referme PRÉMATURÉMENT la chaîne Civet/JS ENGLOBANTE sur le
// premier guillemet nu injecté — cf. le replacer de `resolveMagicAssets`).
// Backreference `\2\3` en fermeture (même présence de backslash + même
// guillemet) : apparie symétriquement ouverture/fermeture, le groupe
// paresseux `(.+?)` s'arrête pile au bon endroit (un chemin d'asset ne
// contient lui-même ni guillemet ni backslash). Groupe 1 (guillemet
// EXTÉRIEUR, cf. `"µasset('…')"` généré par la directive @import) inchangé.
// ----------------------------------------------------------------------------
export const ASSET_RE = /(['"]?)(?:µasset|µ\.asset|mjsasset|mjs\.asset)\((\\?)(['"])(.+?)\2\3\)\1/g
/** `µimage('chemin')` ou `µimage('chemin', 480, 960)` : chemin littéral, largeurs entières facultatives. */
export const IMAGE_CALL_RE = /(?:µimage|µ\.image|mjsimage|mjs\.image)\s*\(\s*['"]([^'"]+)['"]((?:\s*,\s*\d+)*)\s*\)/g
/** pruneOrphans() — la famille des noms que LE BUNDLER LUI-MÊME
 * émet : `<base>-<empreinte5>.<ext>` et son `.map` (writeHashed : empreinte courte en base 36), `<base>-<empreinte8>.<ext>`
 * (copies brutes, ou fichiers d'un build d'avant l'empreinte courte), ou une variante
 * d'image `<base>-<largeur>-<empreinte8>.<format>` (image.ts, variantName). Un nom STABLE
 * (bundle.js, mjs-precache.json, card.wide.css…) ne la matche jamais. Aucune des deux formes ne
 * suffit à désigner une sortie du bundler : celle à 5 caractères est celle de n'importe quel mot
 * court (`theme-light.css`, `card-utils.js`), celle à 8 hexadécimaux celle d'un fichier déposé à la
 * main (`vendor-0123abcd.js`). Le ménage exige en plus que le registre la liste (cf. registeredOutputs). */
const HASHED_OUTPUT_RE = /-[a-f0-9]{8}\.[a-z0-9]+(?:\.map)?$/
/** forme d'un fichier à empreinte courte (`<base>-<5 caractères base 36>.<ext>`, `.map` compris) */
const SHORT_HASHED_RE = /-[0-9a-z]{5}\.[a-z0-9]+(?:\.map)?$/
/** nom de la famille qu'écrit le bundler, l'une ou l'autre forme d'empreinte */
const isHashedOutputName = (name: string): boolean => HASHED_OUTPUT_RE.test(name) || SHORT_HASHED_RE.test(name)
/** nom d'un fichier voisin du manifeste (un `.js` ou sa carte) : un nom simple, jamais un chemin ni un nom caché */
const BUNDLE_NEIGHBOR_RE = /^[^/\\\0.][^/\\\0]*\.js(?:\.map)?$/

/**
 * Les fichiers que des builds ont écrits à côté de `manifestPath` quand le fichier unique est coupé en morceaux (module chargé
 * à la demande, code qu'il partage avec le reste), tels que le registre `.mjs-outputs.json` les consigne (clé `chunks`) :
 * noms simples seulement, liste vide si le registre est absent ou illisible. C'est la seule liste de fichiers que le build
 * retire ou que les serveurs servent à côté du manifeste : jamais un nom reconnu à sa forme.
 */
export function bundleNeighborFiles(manifestPath: string): string[] {
  try {
    const registre = JSON.parse(readFileSync(join(dirname(manifestPath), '.mjs-outputs.json'), 'utf-8'))
    return Array.isArray(registre?.chunks) ? registre.chunks.filter((n: unknown): n is string => typeof n === 'string' && BUNDLE_NEIGHBOR_RE.test(n)) : []
  } catch {
    return []
  }
}

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

/** pruneOrphans() — les assets que le RENDU SERVEUR écrit lui-même dans le dossier de sortie
 * (`writeHashedAsset`, server/ssr-head.ts) : feuille scopée d'un composant sous le mode strict
 * `csp` (`mjs_ssr_style…`), feuille de `<@head>` (`mjs_ssr_head…`), module de la visionneuse
 * (`mjs_viewer_…`). Ils portent la même forme de nom hachée que les sorties du bundler mais ne
 * sortent d'AUCUN `compile()` — un `mjs build` les prendrait donc pour des orphelins et les
 * retirerait juste après que le prérendu les a écrits, laissant les `<link>` des fragments pointer
 * dans le vide. Protégés PAR LEUR NOM, comme le manifeste.
 *
 * Trois familles NOMMÉES, jamais un préfixe large : `mjs_style_…` est le stem des unités que CE
 * bundler émet pour les feuilles PARTAGÉES (`css: 'split'` → un `.js` par feuille, `css: 'lazy'` →
 * un `.css`). L'exempter aurait rendu ces unités-là impurgeables — une feuille retirée du projet
 * laissant son fichier compilé à vie. D'où la famille propre au rendu, `mjs_ssr_style…` : aucune
 * sortie du bundler ne commence par `mjs_ssr`. */
// `mjs_ssr_head` est un nom FIXE (server/ssr-head.ts) — ancré au tiret du suffixe haché
// (`mjs_ssr_head-<empreinte8>.ext`) depuis le 23/09/2026 : un asset PROJET nommé par ex.
// `mjs_ssr_headline-<empreinte8>.png` matchait à tort le préfixe non ancré (trouvé en revue),
// impurgeable pour toujours même orphelin réel. `mjs_ssr_style_`/`mjs_viewer_` gardent, eux, un
// suffixe LIBRE (nom de composant/module choisi par le projet) : un ancrage au tiret ne
// fermerait rien pour eux (le nom réel a lui aussi un tiret avant son empreinte) — la même
// collision résiduelle existe pour ces deux familles, non fermée, faute d'un marqueur qui les
// distinguerait d'un nom de projet coïncidant.
const SERVER_WRITTEN_RE = /^mjs_(?:ssr_style|viewer_)|^mjs_ssr_head-/

// --------------------------------------------------------------------------
// deriveUrlPrefix : convertit un outputDir système en path URL public.
//
// Convention : la majorité des hébergements servent leur doc-root depuis un
// dossier `public/` (Rails, Express, Vite, plain nginx avec root=public/...).
// Donc :
//   outputDir='public/modularjs'   → urlPrefix='/modularjs'
//   outputDir='public/assets/X'    → urlPrefix='/assets/X'
//   outputDir='dist'               → urlPrefix='/dist' (avec warning implicite)
//   outputDir='public'             → urlPrefix='' (la racine servie elle-même)
//
// Override possible via `BundlerOpts.urlPrefix` quand la convention ne tient
// pas (ex : path mounted ailleurs, basePath custom).
//
// EXPORTÉE : le rendu serveur compile dans un dossier de travail À LUI quand le projet émet un
// fichier unique (cf. server/render-compile-dir.ts) et doit alors imposer au Bundler interne le
// préfixe public du VRAI build — mêmes URLs d'assets dans le HTML rendu que celles que sert le
// back. Une seconde copie de cette convention dériverait de celle-ci sans prévenir.
// --------------------------------------------------------------------------
export function deriveUrlPrefix(outputDirRel: string): string {
  // Normalise les séparateurs et retire le slash final
  const normalized = outputDirRel.replace(/\\/g, '/').replace(/\/$/, '')
  // Convention 0 : le dossier de sortie EST la racine servie (`public`, `/var/www/app/public`) → aucun préfixe
  if (normalized === 'public' || normalized.endsWith('/public')) return ''
  // Convention 1 : si le path contient `/public/`, prendre ce qui suit.
  // Couvre les paths absolus `/var/www/myapp/public/modularjs` → `/modularjs`.
  const publicIdx = normalized.lastIndexOf('/public/')
  if (publicIdx >= 0) {
    return normalized.slice(publicIdx + '/public'.length)
  }
  // Convention 2 : path absolu sans `public/` (typique des tmpdir de tests,
  // hébergement custom) → prendre le basename seulement.
  if (normalized.startsWith('/')) {
    return '/' + basename(normalized)
  }
  // Convention 3 : path relatif. Strip `public/` du début s'il y est.
  const stripped = normalized.replace(/^public\//, '')
  return '/' + stripped
}

// dossier de `mjs.config.json` au-dessus de `depart` (lui compris), cherché comme le fait findConfig() ; sans fichier de
// config sur le chemin, `depart` lui-même
function dossierDuProjet(depart: string): string {
  for (let dossier = depart; ; dossier = dirname(dossier)) {
    if (existsSync(join(dossier, 'mjs.config.json'))) return dossier
    if (dirname(dossier) === dossier) return depart
  }
}

// --------------------------------------------------------------------------
// convention `.page.mjs` — même principe que
// `.theme.mjs` (cf. bundler/themes.ts, isThemeFile/themeNameOf) : le marqueur est un
// SUFFIXE du nom de fichier, retiré AVANT toute dérivation d'identité (tag, classe,
// alias court, clé de manifeste, sortie hachée). Un `.page.mjs` reste un composant
// ORDINAIRE par ailleurs (pas de liste à part comme les thèmes) — seule sa capacité à
// porter un bloc <routes>/une directive @routes/une balise <@view> en dépend, cf. la
// garde TranspileOpts.isPageModule (transpiler/index.ts).
// `isPageFile` sert cette garde ; `pageAwareBaseName` centralise le retrait du
// marqueur pour CE fichier (grep `basename(` : shortModuleName, registerLayoutNames,
// _compileMjsInner ×2, recoverFailedComponentManifest, la boucle de collision du
// manifeste, compileSingle) — un fichier sans le marqueur traverse inchangé.
// --------------------------------------------------------------------------
export function isPageFile(filePath: string): boolean {
  return basename(filePath, '.mjs').endsWith('.page')
}

// Pour PROPOSER un nom de
// fichier, jamais pour DÉCIDER si un fichier en est un (cf. isPageFile, strictement sensible à la
// casse et à un seul marqueur, INCHANGÉ) : replie tout suffixe `.page` traînant, n'importe quelle
// casse, un ou plusieurs à la suite (`x.PAGE` → `x`, `x.page.PAGE` → `x`). Sert la suggestion de
// renommage ICI (marqueur en double) et dans transpiler/index.ts (marqueur manquant/mal casé) —
// dupliqué à l'identique là-bas plutôt qu'importé : bundler/index.ts importe déjà transpiler/
// index.ts (transpile()), un import dans l'autre sens bouclerait le cycle.
function canonicalPageBaseName(name: string): string {
  let base = name
  while (/\.page$/i.test(base)) base = base.replace(/\.page$/i, '')
  return base
}

// Même contrainte que .theme.mjs (THEME_FILE_NAME_RE, bundler/themes.ts) :
// un nom de composant hors kebab-case compile aujourd'hui SANS UN MOT (majuscule : clé de
// manifeste en casse d'origine, autoloader toujours en minuscules → composant injoignable à vie ;
// espace/caractère invalide : customElements.define() lève seulement au CHARGEMENT). Aligné sur
// docs/02-composant.md (lettres minuscules/chiffres/tirets).
const COMPONENT_FILE_NAME_RE = /^[a-z][a-z0-9-]*$/

// les noms à tiret que HTML réserve (éléments SVG et MathML, jamais des éléments personnalisés) : une balise nue de ce nom
// n'est pas un composant écrit sans préfixe, même si le projet a un composant du même nom (cf. resolveTagShortcuts)
const NOMS_RESERVES_HTML = new Set(['annotation-xml', 'color-profile', 'font-face', 'font-face-src', 'font-face-uri', 'font-face-format', 'font-face-name', 'missing-glyph'])

// un modèle dans son propre fichier : `carte.compacte.mjs`, à côté de `carte.mjs` — son composant
// s'appelle `carte--compacte` (balise `mjs-carte--compacte` : un point casserait les sélecteurs)
const MODEL_FILE_NAME_RE = /^([a-z][a-z0-9-]*)\.([a-z][a-z0-9-]*)$/
function modelNameOf(base: string): string {
  const m = MODEL_FILE_NAME_RE.exec(base)
  // `x.page` restant (marqueur en double) : laissé tel quel, pageAwareBaseName le refuse
  return m && m[2] !== 'page' ? `${m[1]}--${m[2]}` : base
}

// les modèles en fichier d'une liste de composants : `{ carte: ['compacte'] }`, et les fautes (un
// modèle sans son composant, un modèle nommé « default »)
function collectFileModels(files: string[]): { models: Record<string, string[]>, problems: string[] } {
  const bases    = new Set(files.map(f => basename(f, '.mjs').replace(/\.page$/, '')))
  const models: Record<string, string[]> = {}
  const problems: string[] = []
  for (const f of files) {
    // le marqueur de page retiré d'abord, comme pour le nom du composant (pageAwareBaseName) :
    // `carte.compacte.page.mjs` est le modèle « compacte » de carte, qui a aussi droit à <routes>
    const m = MODEL_FILE_NAME_RE.exec(basename(f, '.mjs').replace(/\.page$/, ''))
    if (!m || m[2] === 'page') continue
    if (m[2] === 'default') { problems.push(t('bundler.modele-default', { fichier: basename(f) })); continue }
    if (!bases.has(m[1])) { problems.push(t('bundler.modele-sans-composant', { fichier: basename(f), base: m[1] })); continue }
    ;(models[m[1]] ??= []).push(m[2])
  }
  for (const k of Object.keys(models)) models[k].sort()
  return { models, problems }
}

// les stores typés d'une source, ceux que son bloc <vars> déclare (`$$volume int 0..100`) : un champ lié
// à l'un d'eux reçoit *guard d'office, même dans un autre composant — lecture rapide, les fautes de ces
// blocs sont dites par la compilation de leur composant (cf. Bundler.collectTypedStores)
function typedStoresOf(src: string): string[] {
  const m = /^[ \t]*<vars\b[^>]*>([\s\S]*?)<\/vars>/m.exec(src.replace(/<!--(?:-?>|[\s\S]*?--!?>)/g, ''))
  return m ? [...m[1].matchAll(/^[ \t]*\$\$([A-Za-z_]\w*)\b/gm)].map(l => l[1]) : []
}

// une balise qui demande la silhouette de son composant (`<@carte *skeleton>`) ; un module cœur
// (`<@@switch>`, `<mjs-core-switch>`) garde son préfixe : sa clé est `core-switch`, comme au manifeste
const SKELETON_TARGET_RE = /<(@@|@|mjs-core-|mjs-)([A-Za-z][\w-]*)\b[^>]*?\*skeleton\b/g
function skeletonTargetsOf(src: string): string[] {
  if (!src.includes('*skeleton')) return []
  return [...src.matchAll(SKELETON_TARGET_RE)].map(m => (m[1] === '@@' || m[1] === 'mjs-core-' ? 'core-' : '') + m[2].toLowerCase())
}

// suggestKebabCase() : 'MonComp' → 'mon-comp', 'mon comp' → 'mon-comp', 'café' → 'cafe' — sert
// UNIQUEMENT à proposer un nom dans le message d'erreur, jamais à corriger en silence.
function suggestKebabCase(name: string): string {
  return name
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')  // café -> cafe
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')             // MonComp -> Mon-Comp
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')                        // espaces/points/etc -> tiret
    .replace(/^-+|-+$/g, '')                            // tirets de bord retirés
}

// marque des sorties à nom fixe d'une construction qui écrit dans le dossier des sources : première ligne du manifeste et des
// feuilles de mise en page, clé de `mjs-precache.json` — la preuve, dans le fichier même, qu'il vient d'une construction ; seule
// source de la marque, relue aussi par les serveurs (cf. server/render-server.ts)
export const MARQUE_SORTIE        = '/* @generated by ModularJS */'
export const CLE_MARQUE_SORTIE    = '@generated'
export const VALEUR_MARQUE_SORTIE = 'ModularJS'

// sorties à nom fixe : manifeste, `mjs-precache.json`, feuille `<module>.<nom>.css`, `.mjs-theme-vars.json`, `.mangle-cache.json`,
// carte du fichier unique (`<manifeste>.map`), fragment de traduction à nom clair (`i18n/<langue>/<section>.json`)
type SorteSortie = 'manifeste' | 'precache' | 'feuille' | 'registre-theme' | 'noms-courts' | 'carte' | 'traduction'

// sortieDuBuild() : `chemin` vient-il d'une construction ? Il porte la marque, ou c'est le manifeste ou la liste de pré-cache
// d'une version qui ne marquait pas ses sorties (2.5.0) : manifeste ouvert par `const µCore = '…';` avec sa ligne
// `µ.version = "<empreinte>";` ou fichier unique qui finit par `//# mjsVersion=<empreinte>`, liste réduite à `{ version,
// assets }`. Une feuille sans marque n'a aucun signe sûr : jamais reconnue. Les autres sorties JSON ne portent pas de clé de
// marque (le registre et les fragments la liraient comme une donnée) : elles sont reconnues à leur forme, la même dans toutes
// les versions — registre `{ <variable>: { declarations, readBy } }`, noms courts (cf. cacheDeNoms), carte de version 3,
// fragment écrit d'un seul tenant (`JSON.stringify`, sans espace ni fin de ligne). Fichier illisible (dossier, droits) : pas
// une sortie
function sortieDuBuild(chemin: string, sorte: SorteSortie): boolean {
  let texte: string
  try {
    texte = readFileSync(chemin, 'utf-8')
  }
  catch {
    return false
  }
  if (sorte === 'noms-courts') return cacheDeNoms(texte)
  if (sorte === 'manifeste' || sorte === 'feuille') {
    if (texte.split('\n', 1)[0].replace(/\r$/, '') === MARQUE_SORTIE) return true
    if (sorte === 'feuille') return false
    return (/^const µCore = '[^'\r\n]*';\r?\n/.test(texte) && /^ *µ\.version = "[0-9a-f]{8}";\r?$/m.test(texte)) || /^\/\/# mjsVersion=(?:[0-9a-f]{8})?\r?$/m.test(texte)
  }
  let lu: any
  try {
    lu = JSON.parse(texte)
  }
  catch {
    return false
  }
  if (lu === null || typeof lu !== 'object' || Array.isArray(lu)) return false
  if (sorte === 'precache') {
    if (lu[CLE_MARQUE_SORTIE] === VALEUR_MARQUE_SORTIE) return true
    return Object.keys(lu).sort().join(',') === 'assets,version' && typeof lu.version === 'string' && Array.isArray(lu.assets) && lu.assets.every((a: unknown) => typeof a === 'string')
  }
  if (sorte === 'registre-theme') return Object.values(lu).every((v: any) => v !== null && typeof v === 'object' && Array.isArray(v.declarations) && Array.isArray(v.readBy))
  if (sorte === 'carte') return lu.version === 3 && typeof lu.mappings === 'string'
  return texte === JSON.stringify(lu)
}

// cacheDeNoms() : `texte` a-t-il la forme du cache des noms courts (`.mangle-cache.json`, cf. Bundler.saveMangleCache) ? Un objet
// dont chaque clé est une propriété `_mjs_…` (son nom court, ou une valeur abîmée que le chargeur écarte) ou un nom réservé
// (`false`). Versionné, il peut sortir d'une fusion git en conflit, illisible : marqueurs de conflit retirés (`<<<<<<<`, `|||||||`,
// `>>>>>>>` et la fin de leur ligne, `=======`, collés à l'accolade finale quand ils la suivent : le cache ne finit pas par un saut
// de ligne), chaque ligne y reste une accolade ou une paire de cette forme, une par ligne comme il est écrit. Coupé en cours
// d'écriture ou de copie, sa dernière ligne n'est qu'un début de paire : une clé coupée, ou une clé suivie d'un début de valeur
// (n'importe laquelle pour une propriété `_mjs_…`, un début de `false` pour un nom réservé)
function cacheDeNoms(texte: string): boolean {
  const entree = (cle: string, valeur: unknown): boolean => cle.startsWith('_mjs_') || valeur === false
  try {
    const lu = JSON.parse(texte)
    return lu !== null && typeof lu === 'object' && !Array.isArray(lu) && Object.entries(lu).every(([cle, valeur]) => entree(cle, valeur))
  }
  catch {
    const lignes = texte.split('\n').map(l => l.replace(/\r$/, '').replace(/(?:<{7}|\|{7}|>{7})(?: .*)?$|={7}$/, ''))
    return lignes.every((l, i) => {
      if (/^\s*(?:[{}],?)?\s*$/.test(l)) return true
      const paire = /^\s*"((?:[^"\\]|\\.)*)"\s*:\s*(.*?),?\s*$/.exec(l)
      if (paire !== null && entree(paire[1], paire[2] === 'false' ? false : paire[2])) return true
      const debut = i === lignes.length - 1 ? /^\s*"((?:[^"\\]|\\.)*)(")?(?:\s*:\s*(.*))?$/.exec(l) : null
      return debut !== null && (debut[2] === undefined || debut[3] === undefined || debut[1].startsWith('_mjs_') || 'false'.startsWith(debut[3]))
    })
  }
}

// fichierVide() : un fichier de 0 octet à la place du manifeste n'a rien à perdre (fichier créé d'avance, écriture interrompue) :
// il est remplacé sans refus. Un seul octet suffit à le protéger
function fichierVide(chemin: string): boolean {
  try {
    const st = statSync(chemin)
    return st.isFile() && st.size === 0
  }
  catch {
    return false
  }
}

// une seule erreur pour toutes les sorties à nom fixe qui tomberaient sur des fichiers de l'auteur (cf. Bundler.refusSortiesAuteur) ;
// `avant` : levée avant toute écriture de la construction, sinon au moment d'écrire ce fichier. La marque n'est réclamée que des
// sorties qui la portent : les sorties JSON reconnues à leur seule forme (cf. sortieDuBuild) ne la portent jamais
function erreurFichiersAuteur(fichiers: [string, SorteSortie][], sources: string, avant: boolean): Error {
  const sansMarque = fichiers.filter(([, sorte]) => ['registre-theme', 'noms-courts', 'carte', 'traduction'].includes(sorte)).length
  const raison     = sansMarque === 0 ? 'marque' : sansMarque === fichiers.length ? 'forme' : 'les-deux'
  return new Error(t('bundler.index.sorties-fichiers-auteur', { nb: fichiers.length, fichiers: fichiers.map(([f]) => `\n  - ${f}`).join(''), sources, marque: MARQUE_SORTIE, cle: CLE_MARQUE_SORTIE, avant, raison }))
}

function pageAwareBaseName(filePath: string): string {
  const base = modelNameOf(basename(filePath, '.mjs').replace(/\.page$/, ''))
  if (isPageFile(filePath)) {
    // Un fichier nommé JUSTE `.page.mjs`
    // (rien avant le marqueur) rendait une chaîne VIDE : `customElements.define("mjs-", …)` et une
    // clé de manifeste vide, sans un mot. Même garde que `bundler.theme-nom-fichier`
    // (bundler/themes.ts) pour `.theme.mjs` seul : refusé par une erreur de build qui nomme le
    // fichier, plutôt qu'un silence. Le `isPageFile(filePath)` ci-dessus (pas `base === ''` tout
    // court) borne la garde aux SEULS fichiers reconnus `.page.mjs` — un composant ordinaire, jamais
    // concerné par ce marqueur, garde son comportement inchangé quel que soit son nom.
    if (base === '') throw new Error(t('bundler.page-nom-fichier-vide', { fichier: basename(filePath) }))
    // Marqueur en DOUBLE (`x.page.page.mjs`, voire mélangé `x.PAGE.page.mjs`) :
    // un seul `.page` est retiré ci-dessus (le marqueur ACTUEL, sensible à la casse, cf. isPageFile) ;
    // si le reste finit ENCORE par `.page` (n'importe quelle casse), c'est un second marqueur oublié,
    // pas un nom voulu. DÉCISION : refusé plutôt que de retirer tous les marqueurs en boucle — un
    // point résiduel dans `base` n'est JAMAIS un nom de fichier légitime (kebab-case obligatoire,
    // docs/02-composant.md : lettres minuscules/chiffres/tirets, jamais de point), exactement la
    // même raison qui fait déjà échouer ce cas côté thèmes (THEME_FILE_NAME_RE, bundler/themes.ts,
    // n'accepte aucun point). Un retrait silencieux en boucle ferait en outre courir DEUX fichiers
    // distincts (`x.page.mjs` et `x.page.page.mjs`) vers la MÊME clé de manifeste 'x' sans que
    // l'auteur l'ait demandé — un doublon de plus à détecter, pas un problème en moins.
    if (/\.page$/i.test(base)) throw new Error(t('bundler.page-marqueur-double', { fichier: basename(filePath), reste: base, suggestion: `${canonicalPageBaseName(base)}.page.mjs` }))
  }
  // Un marqueur `.page` résiduel MINUSCULE reste du ressort de la garde ci-dessus
  // (isPageFile, même casse exacte) / du transpiler (opts.isPageModule) : jamais doublement
  // refusé ici, sous peine d'un message générique à la place du message précis (suggestion
  // x.page.mjs, cf. transpiler/index.ts:3957). Un PARTIAL (préfixe `_`, jamais un composant :
  // exclu du scan top-level par convention, cf. `mjsFiles`) n'est pas non plus concerné — atteint
  // SEULEMENT via µasset()/@import, jamais par un tag <mjs-…> à trouver (régression débusquée par
  // bundler-compile-dedup-cycle.test.ts : `_helper.mjs` cyclique).
  // L'exemption ci-dessous DOIT rester à la MÊME casse qu'isPageFile
  // (`.page` minuscule) : avec `/i`, un marqueur mal casé (`Truc.PAGE.mjs`) échappait aux DEUX
  // gardes (isPageFile refusait la casse, celle-ci l'exemptait quand même) — 0 erreur, clé de
  // manifeste 'Truc.PAGE' publiée, introuvable par l'autoloader (toujours en minuscules).
  if (!/\.page$/.test(base) && !base.startsWith('_') && !COMPONENT_FILE_NAME_RE.test(base)) {
    // le marqueur .page (reconnu ci-dessus, ou résiduel mal casé) est RÉINTÉGRÉ à la suggestion —
    // sinon elle proposait 'truc.mjs' pour 'Truc.page.mjs' et faisait perdre la capacité
    // <routes>/@routes du fichier d'origine (bogue annexe, même cause).
    const cleanBase = canonicalPageBaseName(base)
    const hadMarker = isPageFile(filePath) || cleanBase !== base
    throw new Error(t('bundler.composant-nom-fichier', { nom: base, fichier: basename(filePath), suggestion: `${suggestKebabCase(cleanBase)}${hadMarker ? '.page' : ''}.mjs` }))
  }
  return base
}

// assertSafeSvg() teste des motifs LITTÉRAUX
// (<script>/on*=/javascript:) : une entité HTML (`&#106;` = 'j') reconstitue `javascript:` sans
// jamais écrire le mot en clair. Décode AVANT de tester — décimal, hexadécimal, une poignée de
// nommées usuelles (assez pour reconstituer un schéma d'URL/nom d'attribut). UNE seule passe (pas
// de décodage récursif/imbriqué — hors périmètre de ce correctif).
const SVG_NAMED_ENTITIES: Record<string, string> = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: '\'',
  colon: ':', sol: '/', semi: ';', comma: ',', lpar: '(', rpar: ')', Tab: '\t', NewLine: '\n',
}
// entité numérique hors de la plage Unicode (`&#x110000;`) : refus nommant le fichier, jamais un RangeError brut
function decodeSvgEntities(s: string, filename: string): string {
  const point = (m: string, cp: number) => {
    if (cp > 0x10FFFF) throw new Error(t('bundler.index.svg-entite-hors-plage', { fichier: filename, entite: m.length > 24 ? m.slice(0, 24) + '…' : m }))
    return String.fromCodePoint(cp)
  }
  return s
    .replace(/&#x([0-9a-f]+);/gi, (m: string, hex: string) => point(m, parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (m: string, dec: string) => point(m, parseInt(dec, 10)))
    .replace(/&([a-zA-Z]+);/g, (m: string, name: string) => SVG_NAMED_ENTITIES[name] ?? m)
}

/** Nom d'un fragment de traduction en prod : préfixe de 12 hex (48 bits) de l'md5 du contenu
 *  sérialisé. Le nom est aussi le nom du fichier servi : `pris` (nom → contenu, partagé par
 *  tout le build) détecte un préfixe déjà porté par un AUTRE contenu et allonge le nom jusqu'à
 *  ce qu'il soit libre ; même contenu = même nom. `hacher` est injectable pour les tests. */
export function nommerFragmentI18n(serialized: string, pris: Map<string, string>, hacher: (s: string) => string = s => createHash('md5').update(s).digest('hex')): string {
  const complet = hacher(serialized)
  for (let longueur = 12; longueur <= complet.length; longueur++) {
    const nom = complet.slice(0, longueur)
    const porte = pris.get(nom)
    if (porte === undefined) {
      pris.set(nom, serialized)
      return nom
    }
    if (porte === serialized) return nom
  }
  throw new Error(t('bundler.index.i18n-fragment-collision', { empreinte: complet }))
}

export class Bundler {
  /** registre des variables de thème — racine du projet, capturée UNE FOIS à la construction (le
   * dossier de `mjs.config.json` en usage CLI normal : `--root` fait un `process.chdir` AVANT
   * cette construction, cf. cli.ts) : sert à PUBLIER des chemins relatifs dans `.mjs-theme-vars.json`,
   * jamais l'arborescence absolue de la machine de build. */
  private root: string
  /** dossier du projet : celui de `mjs.config.json`, cherché en remontant depuis le dossier courant comme le fait la CLI (lancée
   * d'un sous-dossier du projet, elle y trouve sa config), sinon le dossier courant — racine des fichiers que le manifeste externe
   * peut réunir (cf. projectRoots) */
  private projectDir: string
  sourceDir: string
  runtimeDir: string
  /** Catalogue de modules cœur (`<@mjs-nom>`), cf. BundlerOpts.coreModulesDir. */
  coreModulesDir: string
  /** Les images des motifs de *hologram, livrées par le paquet (`src/assets/hologram/`). */
  hologramImagesDir: string
  outputDir: string
  manifestPath: string
  manifestExternal: string
  stylesheetsDir: string
  /** dossiers d'images en plus de `sourceDir`, chemins absolus sans doublon ni `sourceDir` : cherchés dans cet ordre, après `sourceDir` */
  assetDirs: string[]
  varPrefix: string
  defaultTheme: string
  /** CSS agrégé des fichiers `*.theme.mjs` — écrit dans le manifeste, adopté au boot. */
  themeCss: string
  /** Noms des thèmes déclarés — la rune `µtheme` n'accepte qu'eux (plus light/dark). */
  themeNames: string[]
  urlPrefix: string
  preload: PreloadConfig | undefined
  viewTransition: VtValue | undefined
  /** Clé `logLevel` brute (mjs.config.json) — résolue par environnement via
   *  `currentLogLevel()`/`prodLogLevel()`, jamais lue directement ailleurs. */
  logLevel: LogLevelConfig | undefined
  /** clé `messages` (cf. BundlerOpts.messages) */
  messagesMode: 'demand' | 'idle'
  /** clé `types` (cf. BundlerOpts.types) */
  typesMode: 'warn' | 'error' | undefined
  effectsConf: EffectsConfig | undefined
  /** clé `bundles` (cf. BundlerOpts.bundles) */
  bundlesConf: Record<string, BundleGroupConfig> | undefined
  /** les modèles en fichier (`carte.compacte.mjs` → `{ carte: ['compacte'] }`), du projet et du cœur :
   *  relevés au début de chaque compile(), transmis à chaque transpilation (cf. ParseDiag.models) */
  componentModels: { dev: Record<string, string[]>, core: Record<string, string[]> } = { dev: {}, core: {} }
  /** les clés de `componentModels.dev` qui sont l'alias court d'un composant (cf. modelsWithShortAliases) */
  private modelAliasKeys = new Set<string>()
  /** les stores typés du projet (cf. collectTypedStores) — relevés même avec `effects.guard: false` : un
   *  champ lié à l'un d'eux reçoit alors le garde muet (sans effet ni bulle) */
  typedStores: string[] = []
  /** règles nommées des fichiers `*.types.mjs` — recalculées à chaque compile() par
   *  compileTypesFiles(), transmises à chaque transpilation (TranspileOpts.typeDefs) */
  typeDefs: Record<string, RuleAst> = {}
  /** les fichiers `*.types.mjs` du projet : dépendances de tout composant qui cite une règle nommée */
  typesFiles: string[] = []
  /** les effets des fichiers `*.effects.mjs` — recalculés à chaque compile() par
   *  compileEffectsFiles(), transmis à chaque transpilation (TranspileOpts.effectDefs). Au départ, les seuls alias que ModularJS
   *  livre : ils ne dépendent pas des fichiers de l'appli, une faute de ces fichiers ne les fait pas oublier */
  effectDefs: Record<string, ProjectEffect> = collectEffectDefs([], () => '')
  /** les alias d'effets écrits dans la table du cœur (cf. tableAliases), dans l'ordre de leur rang */
  aliasTable: string[] = []
  /** les fichiers `*.effects.mjs` du projet : dépendances de tout composant qui pose un de leurs effets */
  effectsFiles: string[] = []
  /** les fichiers image que ces effets fixent (`*fond = *behind('photo.jpg')`) : le composant qui pose l'effet en dépend */
  effectImageSources: string[] = []
  i18n: I18nConfig | undefined
  /** Bloc `render` du projet (cf. BundlerOpts.render) — lu SEULEMENT par `resolveRuntimeFiles`,
   *  pour les modes d'hydratation. */
  render: RenderConfig | undefined
  /** Bloc `µ._i18nData` calculé par `scanI18n()` (appelé dans `compile()`,
   *  AVANT `writeManifest()`) — `undefined` si `sourceDir/i18n/` est absent
   *  (aucune clé i18n émise dans le manifeste, zéro octet pour les apps sans i18n). */
  i18nManifestData: I18nManifestData | undefined
  /** Cache du parseur YAML chargé paresseusement (paquet `yaml`, optionnel —
   *  cf. peerDependencies) — tenté une SEULE fois, au premier fichier
   *  `.yml`/`.yaml` rencontré. Un projet 100% `.json` ne le charge jamais. */
  private _yamlParser: ((raw: string) => any) | undefined
  defaultScriptLang: BundlerOpts['defaultScriptLang']
  templateLang: BundlerOpts['templateLang']
  sigil: BundlerOpts['sigil']
  contextAlias: BundlerOpts['contextAlias']
  csp: boolean
  sourceMapMode: NonNullable<BundlerOpts['sourceMap']>
  maxStateVars: BundlerOpts['maxStateVars']
  a11y: BundlerOpts['a11y']
  ujsForm: BundlerOpts['ujsForm']
  lint: BundlerOpts['lint']
  /** résolu UNE fois au constructeur (opts.colorsEnabled ou recalculé) — jamais redéterminé
   *  ailleurs, cf. resolveColorsEnabled (src/diagnostics.ts). */
  colorsEnabled: boolean
  keepFailedComponents: boolean
  /** cf. BundlerOpts.prune */
  prune: boolean
  /** Environnement RÉSOLU du build — cf. isProd() */
  envMode: NonNullable<BundlerOpts['env']>
  /** Politique de minification RÉSOLUE — cf. shouldMinify() */
  minifyMode: NonNullable<BundlerOpts['minify']>
  minimalRuntime: boolean
  runtime: RuntimeConfig | undefined
  /** Mode d'émission des styles partagés (cf. BundlerOpts.css). `'bundle'` (défaut) =
   *  comportement historique, jamais retouché ci-dessous. `'split'`/`'lazy'` : cf.
   *  emitSplitStyles()/finalizeSplitStyles() et le garde-fou dans compile(). */
  cssMode: CssConfig
  /** Mode d'émission JS (cf. BundlerOpts.js). `'split'` (défaut) : comportement historique,
   *  intact plus bas (writeManifest()/emitPendingUnits(), jamais retouchés). `'bundle'` :
   *  cf. emitSingleFile() — remplace ces deux méthodes en phase C de compile(). */
  jsMode: JsConfig
  /** Mode split — chemin haché PAR feuille partagée nommée (hors mjs_root), connu
   *  AVANT la compilation des composants (cf. emitSplitStyles(), step précédent —
   *  même principe que coreHashedPath pour mjs_core) : c'est ce qui permet à
   *  _compileMjsInner d'injecter `import '<chemin>';` en tête du JS d'un module
   *  PENDANT sa propre compilation. Jamais lu hors mode split. */
  splitStyleHashedPaths: Record<string, string> = {}
  /** Mode split — chemin haché de mjs_root (adopté sur le document, jamais déclaré
   *  par un module) : toujours eager, importé par le manifeste. */
  splitRootHashedPath: string | undefined
  /** Mode split — chemins hachés des feuilles forcées eager, POUR DEUX RAISONS distinctes
   *  (cf. finalizeSplitStyles()) : (1) qu'AUCUN module ne déclare (`@css`) — le filet
   *  historique ; (2) qu'un `<@view css="nom">` LITTÉRAL réclame quelque part,
   *  MÊME si un module la déclare déjà ailleurs — une page qui charge la vue sans charger ce
   *  module en hériterait sinon vide (cf. runtime/mjs_element.ts, `_mjs_applyLayout`). Restent
   *  importées par le manifeste, comme en mode bundle. Calculé par finalizeSplitStyles(), APRÈS
   *  les composants (le seul point où `requestedSharedSheets`/`viewRequestedSheets` sont complets). */
  splitEagerHashedPaths: string[] = []
  /** nom de feuille partagée → URL publique de son `.css` haché (mode
   *  'lazy' SEULEMENT ; vide partout ailleurs). Écrite au manifeste sous `µ._cssLazy` :
   *  le runtime y résout un nom au montage du premier composant qui le déclare, va
   *  chercher le fichier une fois, et le garde en cache par URL. */
  lazyStyleUrls: Record<string, string> = {}
  /** politique de traitement des images (clé `image` de mjs.config.json), défauts résolus ICI. */
  imageConfig: { widths: number[]; formats: string[]; quality: number }
  /** L'avertissement « sharp absent » ne se dit qu'UNE fois par build, pas une fois par image. */
  private sharpWarned = false
  private animatedWarned = new Set<string>()
  // variantes d'image déjà encodées, par fichier source et réglages (cf. variantesDe) : une image citée par plusieurs composants,
  // ou recompilée en `mjs dev`, n'est encodée qu'une fois tant que son contenu (empreinte des octets) ne change pas
  private variantesMemo = new Map<string, { empreinte: string; variantes: Promise<GeneratedVariant[] | null> }>()
  /** assetDirs : les avertissements « même image dans deux dossiers » de CE compile (versés à `stats.warnings` en fin de tour) */
  private pendingAssetWarnings: string[] = []
  /** … et les couples (retenue, écartée) déjà dits ce tour-ci : une image citée par vingt composants n'avertit qu'une fois */
  private assetShadowsSeen = new Set<string>()
  dedupWaitTimeoutMs: number
  /** Seuil de bascule vers la transpilation en direct (cf. INLINE_LIMIT). */
  private inlineTranspileLimit: number
  /** Le compte de fichiers de CE compile tient-il sous le seuil ? Décidé à chaque
   *  `compile()` (phase A), watch compris : un projet qui grandit au-delà du seuil
   *  repasse aux threads au tour suivant. */
  private inlineTranspile = false
  cache: Map<string, CacheEntry>
  manifest: Record<string, string>
  /** Pour chaque clé du manifest, le chemin du source qui l'a écrite. Sert à
   * détecter les collisions de basename (deux .mjs au même nom). */
  manifestSources: Map<string, string> = new Map()
  // Kind par clé de manifest ('basename' autoritaire /
  // 'shortName' alias de confort / 'poisoned' alias court ambigu retiré).
  // Compagnon de manifestSources : distingue une VRAIE collision (basename vs
  // basename → warning) d'un simple recouvrement d'alias court (silencieux, sûr).
  manifestKinds: Map<string, 'basename' | 'shortName' | 'poisoned'> = new Map()
  /** Composants qui se disputent un alias court EMPOISONNÉ (clé → basenames, ordre de
   * compilation, sans doublon). La clé n'est publiée par personne et la balise courte n'est
   * jamais enregistrée : un gabarit qui l'écrit quand même doit s'entendre dire QUI se la
   * dispute (cf. resolveTagShortcuts, kind 'litteral-dev'). Réinitialisé à chaque compile(). */
  poisonedAliasSources: Map<string, string[]> = new Map()
  /** 2e <script>/<style>
   * silencieusement jeté (composant OU partial inclus). `_compileMjsInner`
   * n'a pas accès direct à `stats.warnings` (retourne juste le hashedPath,
   * consommé via parallelMap) — accumulé ici, fusionné dans `stats.warnings`
   * en fin de `compile()`. Réinitialisé à chaque compile() (comme manifest). */
  pendingSectionWarnings: string[] = []
  /** avertissements des modules de script (un voisin .js absent d'un fichier qu'ils citent), par fichier : les modules se
   *  compilent après la mise en commun des avertissements des composants, ils sont versés aux avertissements du build une fois
   *  compilés, dans l'ordre des fichiers. Remis à vide à chaque compile(). */
  private pendingModuleWarnings: Map<string, string[]> = new Map()
  /** cf. CompileStats.lintPrinted — additionné à chaque résultat de transpilation. */
  lintPrintedByTranspiles = 0
  /** Références de balises accumulées PAR FICHIER pendant le
   * parallelMap de compile() (dev ET modules cœur, ces derniers compilés
   * après coup par resolveTagShortcuts) — consommées puis remises à zéro par
   * resolveTagShortcuts() à chaque compile(). */
  pendingTagRefs: { file: string; name: string; kind: TagRefKind; layoutLiteral?: string; attrs?: TagRef['attrs'] }[] = []
  /** Les références des fichiers du PROJET sont toutes lues (fin de leur phase, juste avant resolveTagShortcuts) : avant, coreAttrWritten ne sait rien et
   * répond 'unknown'. Remis à faux au début de chaque compile(). */
  private tagRefsComplete = false
  /** Une page du PROJET écrit-elle une transition (`@in`, `@out`, `@transition`) ? Relevé avec tagRefsComplete, sur les signaux compilés des seuls
   * composants du projet, avant qu'aucun module cœur ne soit compilé (cf. coreTransitionWritten). Lu seulement une fois tagRefsComplete vrai. */
  private pageTransition = false
  /** Les outils que les barres des pages du projet nomment (`toolbar` de <@@editor>, `tools` de <@@toolbar>) ; `null` quand le build ne peut pas dire lesquels (une barre sans
   * liste, une liste calculée, un étalement, aucune barre). Relevé avec tagRefsComplete, sur les seules références du projet, avant qu'aucun module cœur ne soit compilé
   * (cf. coreToolShown) : la barre que l'éditeur écrit dans son propre gabarit ne compte pas. */
  private pageTools: ReadonlySet<string> | null = null
  /** Les parties des modules cœur que mjsSource a ôtées ce tour (`dropped`) et celles qu'un module emporté garde (`kept` : un modèle en fichier, un module
   * cité par le catalogue), nommées `<module>.<attribut>` (`chart.toolbar`, cf. STRICT_ATTRS) : les libellés propres à une partie (CORE_LABEL_PARTS) ne
   * partent pas quand elle est ôtée et qu'aucun module emporté ne la garde. Remises à zéro au début de chaque compile(). */
  private coreParts = { dropped: new Set<string>(), kept: new Set<string>() }
  /** Dépendances DIRECTES brutes accumulées PAR COMPOSANT (balises du gabarit +
   * modules `@import`-és), jumeau de pendingTagRefs ci-dessus — consommée par
   * buildManifestDeps() APRÈS resolveTagShortcuts() (seul point où l'union des
   * composants ET des modules cœur transitifs est connue), remise à zéro à
   * chaque compile(). Noms bruts, PAS encore résolus contre le manifeste. */
  pendingComponentDeps: { moduleName: string; deps: string[] }[] = []
  /** Les fichiers d'effets que chaque composant importe (`mjs_fx_<nom>`, cf. fxChunked), frais ET
   * cache-hit — ajoutés à ses dépendances directes par buildManifestDeps() (préchargés avec lui).
   * Remis à zéro à chaque compile(). */
  private pendingFxDeps: Map<string, string[]> = new Map()
  /** Le fichier de chaque effet écrit dans le projet (`mjs_fx_<nom>` → chemin public haché), écrit
   * par compileFxChunks() juste après le cœur — publié dans µ.paths, résolu dans le code des
   * composants en phase C. Vide en fichier unique (`js: 'bundle'`) : les effets restent au cœur. */
  fxChunkPaths: Map<string, string> = new Map()
  /** Les outils des effets (`fx_tool<nom>`) que le cœur du dernier bundleRuntime() embarque : les effets écrits à part (compileFxChunks) s'y mesurent. */
  private fxToolsEmbarked: ReadonlySet<string> | null = null
  /** Le cœur du dernier bundleRuntime() embarque le journal des erreurs (mjs_journal.ts, qui lit chaque µ.error) : les effets écrits à part et les
   *  animations, minifiés après lui, s'y mesurent (au niveau 'silent', leurs µ.error restent alors en place, cf. minifyJs). */
  private journalInCore: boolean | undefined = undefined
  /** Le fichier de groupe de chaque composant groupé (clé du manifeste → chemin public haché) : publié
   * dans µ.paths à la place du fichier séparé, qui reste écrit (rendu serveur, `prune`). Rempli par
   * compile() en production seulement, remis à zéro à chaque compile(). */
  groupPaths: Map<string, string> = new Map()
  /** Les groupes assemblés par le dernier compile() (nom, fichier, racines, composants). */
  groupReport: GroupReport[] = []
  /** Fragments de traduction écrits par CE compile(), par langue (noms avec `.json`) : le registre `.mjs-outputs.json` les retient pour que la purge ne retire que des fichiers du build. */
  i18nWritten: Map<string, Set<string>> = new Map()
  /** Lignes d'information sur les groupes (pas d'assemblage hors production), pour le journal du build. */
  groupInfo: string[] = []
  /** Un composant ou un module du projet appelle `µ.Autoloader.preload(…)` (signal du dernier compile()) :
   * le manifeste porte alors la fonction. Faux par défaut, jamais payé sans l'appel. */
  private preloadCalled = false
  /** Le fichier des messages de la console de chaque langue (langue → nom du fichier haché), écrit
   * en production seulement par compileMessageFiles() — jamais dans le précache. Remis à zéro à
   * chaque compile(). */
  private msgFileNames: Map<string, string> = new Map()
  /** Table des dépendances DIRECTES du manifeste (clé de manifest → clés de
   * manifest dont elle dépend), écrite par buildManifestDeps() en fin de
   * compile() — consommée par writeManifest() (µ_DEPS, préchargement). */
  manifestDeps: Record<string, string[]> = {}
  /** Variants de style — nom de module (basename ET alias court, même clé que manifestNames
   * plus bas) → noms de variants `<style name="…">` connus, alimentée par les DEUX
   * chemins de _compileMjsInner (froid ET cache-hit, même hygiène que pendingVarData
   * ci-dessous) — un module SANS variant n'y figure pas (repli historique du fichier CSS
   * déposé à la main). Consommée par resolveTagShortcuts() pour le croisement `layout="x"`
   * littéral, remise à zéro à chaque compile(), à l'image de pendingTagRefs. */
  private pendingLayoutNames: Map<string, Set<string>> = new Map()
  /** Registre des variables de thème — variables $$ par composant (fresh ET cache-hit,
   * même hygiène que pendingTagRefs ci-dessus), consommés par computeVarRegistry() en fin
   * de compile(). Réinitialisé à chaque compile(). */
  private pendingVarData: { file: string; moduleName: string; baseCss: string; layoutCss: Record<string, string>; themeVars: { name: string; variant: string; line: number; doc: string }[]; varsRead: string[]; posed: string[] }[] = []
  /** règles des stores déclarées par chaque composant (fresh ET cache-hit, même hygiène que
   * pendingTagRefs) — deux règles différentes pour le même store font échouer le build
   * (checkStoreTypes, fin de compile()). Réinitialisé à chaque compile(). */
  private pendingStoreTypes: { store: string; text: string; file: string }[] = []
  /** Variables de thème $$ des fichiers `*.theme.mjs` — recalculé À CHAQUE compile()
   * par compileThemeFiles() (pas de cache : ces fichiers sont peu nombreux et minuscules). */
  private themeVarData: { file: string; name: string; css: string; vars: { name: string; variant: string; line: number; doc: string }[]; read: string[] }[] = []
  /** Variables de thème $$ déclarées par le RUNTIME lui-même (`--mjs-surface:`, etc.) —
   * recalculé à chaque bundleRuntime() : rend `$$surface`/`$$fg`/… légitimes sans qu'aucun
   * thème projet n'ait besoin de les redéclarer. */
  private frameworkVarData: { file: string; line: number; name: string; value: string; doc: string }[] = []
  /** groupes de libellés du framework dont un lecteur part dans ce build (cf. runtimeLabelGroups) —
   *  `undefined` tant que le cœur n'a pas été choisi : le manifeste garde alors tous les groupes */
  private labelGroups: Set<string> | undefined = undefined
  /** modules cœur dont le manifeste pose les libellés par défaut (cf. coreLabelModules) — `undefined` tant que le cœur n'a pas
   *  été choisi, ou quand un fichier du projet lit lui-même le groupe `core` : il part alors entier */
  private labelCoreModules: Set<string> | undefined = undefined
  /** fichiers d'effet que le build emporte (noms sans `mjs_fx_`), dont le manifeste pose les libellés par défaut (groupe `fx`, cf.
   *  FX_LABEL_EFFECTS) — `undefined` tant que le cœur n'a pas été choisi : le groupe part alors entier */
  private labelFxEffects: Set<string> | undefined = undefined
  /** parties de modules cœur ôtées de ce build (cf. coreParts) : le manifeste ne pose pas leurs libellés (CORE_LABEL_PARTS) — vide tant que le cœur n'a pas été choisi */
  private labelCoreDropped: Set<string> = new Set()
  /** clés des textes de traces que le cœur du dernier bundleRuntime() nomme (cf. manifestLabels) — `undefined` tant que le cœur n'a pas été choisi */
  private traceKeys: string[] | undefined = undefined
  coreHashedPath: string
  /** unités compilées en mémoire en phase A (composant .mjs, module .civet/.coffee,
   * manifeste externe), en attente d'émission topologique en phase C (une fois le cœur
   * connu). Clé = stem (nom de module/basename/'mjs_external'). Remis à zéro à chaque
   * compile() — jamais lu pendant la phase A elle-même (cf. compile()). */
  private pendingUnits: Map<string, PendingUnit> = new Map()
  /** mode 'bundle' seulement : nom virtuel ('mjs_core', 'mjs_styles', 'mjs_anims', un stem
   * d'unité, 'mjs_setup', 'mjs_entry') → code JS déjà résolu (repères remplacés par des
   * spécificateurs 'mjs:...', jamais un chemin réel) — consommé par le plugin esbuild
   * d'emitSingleFile() (onLoad, jamais le disque). Remis à zéro à chaque compile(), au même
   * rythme que pendingUnits ; jamais peuplé en mode 'split'. */
  private bundleVirtualSources: Map<string, string> = new Map()
  /** mode 'bundle' : les unités (modules) que le code d'une autre unité charge par un import dynamique — emitSingleFile() les relève
   *  dans le code final de chaque unité. Non vide : le fichier unique est assemblé avec des points de coupure (cf. runBundleEsbuild()) et
   *  ces modules sortent dans leur propre fichier. Remis à zéro avec bundleVirtualSources, à chaque compile(). */
  private bundleLazyStems: Set<string> = new Set()
  /** union des signaux compilés (scanCompiledFeatures) de toutes les unités de CE
   * tour, fraîches ET cache-hit (jumeau de usedAnimations) — alimente collectUsedFeatures().
   * Remis à zéro à chaque compile(). */
  private pendingFeatures: Set<string> = new Set()
  /** les balises du tour qui demandent la silhouette de leur composant (`<@carte *skeleton>` → `carte`,
   *  `<@@switch *skeleton>` → `core-switch`), relevées dans la source que _compileMjsInner vient de lire
   *  — plus aucune relecture des sources pour les trouver (cf. componentSkeletons) */
  private pendingSkeletonTargets: Set<string> = new Set()
  /** union des symboles du CONTRAT (collectCoreCalls, core-contract.ts) appelés par toutes les
   * unités de CE tour, fraîches ET cache-hit — jumeau EXACT de pendingFeatures ci-dessus, même
   * rythme de remise à zéro, mêmes points d'alimentation. Consommé par bundleRuntime(), qui
   * REFUSE de finir un cœur auquel il manque un de ces symboles (cf. son bandeau). */
  private pendingCoreCalls: Set<string> = new Set()
  /** Minifications DIFFÉRÉES : `compileMjsCold`/`compileScriptModuleCold`/
   * `prepareExternalManifest` transpilent et résolvent en PARALLÈLE (workers), mais
   * n'appellent PAS `minifyJs` tout de suite — ils pousseraient sinon plusieurs
   * minifications CONCURRENTES sur `this.mangleCache` (état PARTAGÉ), dont l'ordre
   * d'achèvement réel (parallélisme, non déterministe) déciderait quelle unité réserve en
   * premier le nom court d'une propriété `_mjs_*` — deux builds identiques en source
   * produiraient alors des composants (et un cœur minifié après eux) byte-DIFFÉRENTS.
   * Chaque tâche ici garde tout ce qu'il faut pour minifier et compléter l'unité ; vidée et
   * exécutée par `flushPendingMinifyTasks()`, dans un ORDRE TRIÉ stable, SÉQUENTIELLEMENT.
   * `names` : noms courts que l'unité peut porter par nom sur une instance, relevés sur son code
   * NON minifié (vide hors minification) — réservés AVANT la première minification du tour
   * (cf. reserveInstanceNames()). */
  private pendingMinifyTasks: { stem: string; names: string[]; run: () => Promise<void> }[] = []
  usedAnimations: Set<string>
  // jumeau de usedAnimations : noms d'anim DÉFINIS
  // dynamiquement par le script user (µanim.create/crossfade, nom en
  // littéral). compileUsedAnimations() les exclut de `missing` — aucun
  // fichier runtime statique ne les décrit, c'est un faux positif sinon.
  definedAnimations: Set<string>
  /** (crash-si-feuille-absente) — noms de feuilles partagées
   * `@css` référencées par TOUS les composants compilés ce tour-ci (fresh ET
   * cache-hit, même hygiène que usedAnimations) ; validé en fin de compile()
   * par validateSharedSheets(), qui THROW (pas un warning) si l'une d'elles n'a
   * aucun fichier .sass/.scss/.css correspondant dans stylesheetsDir. */
  requestedSharedSheets: Set<string>
  /** jumeau de `requestedSharedSheets` ci-dessus, mais pour l'AUTRE voie
   * de réclamation d'une feuille : l'attribut `css="nom"` LITTÉRAL d'un `<@view>` (lu par le
   * runtime au montage, cf. runtime/mjs_element.ts `_mjs_applyLayout`), plutôt que la directive
   * `@css` d'un module. Alimenté en scannant le contenu BRUT de chaque composant (mode split
   * SEULEMENT, cf. extractViewCssNames) — jamais consultée hors split, coût nul en mode
   * 'bundle'. Consommée par finalizeSplitStyles() pour forcer eager une feuille réclamée
   * ainsi, MÊME si un module la déclare déjà par ailleurs (cf. splitEagerHashedPaths). */
  viewRequestedSheets: Set<string>
  /** Reverse-map "chemin absolu d'un partial" → "set de chemins absolus
   * des fichiers .mjs qui l'incluent via <@include>". Mis à jour à chaque
   * compileMjs pour permettre au watcher d'invalider les parents quand un
   * partial change. */
  partialDependents: Map<string, Set<string>>
  /** Chemins absolus de TOUS les
   * fichiers visités par `bundleExternalManifest` (le manifest externe
   * lui-même + chaque fichier `#= require`/`require_dir`/`require_tree`,
   * récursivement). `watch()` les ajoute au watcher : avant, ces fichiers
   * (souvent HORS sourceDir) n'étaient jamais surveillés — les éditer ne
   * déclenchait AUCUNE recompilation. */
  externalManifestDeps: Set<string>
  /** Mangle cache partagé entre tous les minifyJs() d'un compile, pour
   * mangler `_mjs_*` de manière cohérente inter-fichiers (cf. minify.ts). */
  mangleCache: Record<string, string | false>
  /** génération du cache de raccourcissement : avancée chaque fois qu'une réservation de noms
   * d'instance RETIRE une correspondance `_mjs_x → nom` (cf. reserveInstanceNames()). Une unité
   * en cache minifiée à une génération antérieure porte des noms désaccordés du cœur à venir :
   * elle est re-minifiée au même tour (cf. `CacheEntry.mangleGen`, emitPendingUnits()/
   * emitSingleFile()). Vit le temps de l'instance, comme `this.cache`. */
  private mangleGeneration = 0

  // ----------------------------------------------------------------------------
  // rechargement CSS à chaud (mode watch seulement). `watch()` arme
  // `cssOnlyTracking` ; `compile()`/`_compileMjsInner`/`bundleSharedStyles` y lisent
  // et écrivent. Jamais consulté par `build`/`check`/`serve` (compile() one-shot,
  // aucune continuité entre deux appels → resterait toujours "full" de toute façon).
  // ----------------------------------------------------------------------------
  private cssOnlyTracking = false
  /** Dernier TranspileData COMPLET par fichier .mjs (recompilé ce tour-ci, cache
   * miss) — sert à comparer "hors-baseCss identique ?" au recompile SUIVANT. */
  private lastComponentData: Map<string, TranspileDataLike> = new Map()
  /** Dernier CSS compilé par feuille partagée nommée (stylesheetsDir, hors mjs_root). */
  private lastSharedCss: Map<string, string> = new Map()
  /** Dernier CSS de mjs_root.{sass,scss} (adopté globalement), undefined si absent. */
  private lastRootCss: string | undefined = undefined
  /** Filet CENTRAL : hashedPath par nom logique de TOUT fichier émis via writeHashed
   * au compile PRÉCÉDENT — tout hash qui change sans être une émission ATTENDUE d'un
   * lot css-only (composant qualifié, mjs_styles) disqualifie : couvre mjs_core
   * (runtime édité), modules .civet/.coffee, mjs_anims, mjs_external, assets copiés. */
  private lastWrittenHashes: Map<string, string> = new Map()
  /** (protocole de navigation) — id de build GLOBAL du dernier manifest
   * écrit par writeManifest() (dérivé du CONTENU assemblé, jamais d'une horloge :
   * même build → même id, un seul asset qui change → id différent). Version de
   * build exposée au client (µ.version) ET au protocole de navigation — un
   * décalage entre l'id en mémoire du client et celui du serveur signale une
   * nouvelle version disponible. `null` avant le premier writeManifest(). */
  lastBuildId: string | null = null
  // Accumulateurs RÉINITIALISÉS en tête de chaque compile() (comme manifestSources) :
  private cssOnlyComponents: Record<string, string> = {}
  private cssOnlySheets: Record<string, string> = {}
  private cssOnlyRoot: string | undefined = undefined
  /** true dès qu'UN fichier recompilé ce tour-ci n'est pas qualifiable "css-only"
   * (script/template changé, fichier nouveau, fichier/feuille supprimé…). */
  private cssOnlyDisqualified = false
  /** Émissions writeHashed de CE compile (nom logique → hashedPath). */
  private cssOnlyWrites: Map<string, string> = new Map()
  /** nom de fichier haché (empreinte courte) → md5 COMPLET du contenu qui l'a reçu : deux contenus différents
   *  sous le même nom sont une collision de l'empreinte courte, refusée (cf. writeHashed). Gardé d'un compile()
   *  à l'autre : le même nom ne désigne jamais deux contenus. */
  private fingerprintOwners: Map<string, string> = new Map()
  /** Noms logiques dont un CHANGEMENT de hash est attendu dans un lot css-only. */
  private cssOnlyAllowedWrites: Set<string> = new Set()
  /** Noms de fichiers (avec hash, ex. 'comp-a1b2c3d4.js') faisant partie
   * de la sortie VALIDE de CE compile() : soit fraîchement écrits par
   * writeHashed()/resolveOneAsset() (copie raw), soit réutilisés tels quels sur
   * un cache hit de `this.cache` (_compileMjsInner/_compileScriptModuleInner —
   * contenu inchangé, écriture disque légitimement sautée). Réinitialisé en
   * tête de compile() (comme manifest) : filtre collectSizes() pour qu'un résidu
   * d'un tour précédent (composant en échec ce tour, jamais recompilé NI en
   * cache hit) ne soit plus jamais réaffiché comme s'il venait d'être produit. */
  private emittedThisCompile: Set<string> = new Set()
  /** Chemins ABSOLUS des anciens fichiers hachés mis en attente par
   *  cleanupOldHashes() : purgés pour de bon SEULEMENT après que writeManifest() ait réussi (cf.
   *  flushPendingHashCleanup), jamais avant — sinon le manifeste ENCORE PUBLIÉ sur disque peut
   *  nommer un fichier déjà supprimé, le temps du reste du build. */
  private pendingHashCleanup: string[] = []
  /** fichiers copiés tels quels (image, son, .js et ses voisins), par chemin ABSOLU de leur source : le
   *  nom publié sous outputDir, et les variantes d'image. Tenu d'un compile() à l'autre sur toute la vie
   *  de l'instance, comme `cache` : un composant resté en cache ne republie rien, et le ménage des
   *  anciennes empreintes (cleanupOldHashes balaie par nom de base) ne doit jamais retirer le fichier
   *  d'un homonyme d'un autre dossier (a/logo.png, b/logo.png) — seul l'ancien nom du MÊME chemin part. */
  private publishedAssets: Map<string, { name: string, variants: Set<string> }> = new Map()
  /** noms publiés des fichiers annexes (images, sons, .js voisins) des unités (composants, modules de script) que le
   *  cache a resservies CE tour-ci : avec `emittedThisCompile`, ils forment la liste du précache, et ce que le ménage
   *  des anciennes empreintes garde. Remis à vide à chaque compile(). */
  private cachedAssetNames: Set<string> = new Set()
  /** fichiers du paquet (et non de l'appli) copiés dans la sortie par CE compile() (cf. publishFrameworkAsset), par nom publié : leur taille en octets.
   *  Ils entrent dans le résumé des tailles (cf. collectSizes). Remis à vide à chaque compile(), comme `emittedThisCompile`. */
  private frameworkAssets: Map<string, number> = new Map()
  /** ce que le build apprend d'un .js copié tel quel (sa validité, ses imports relatifs), par chemin ABSOLU et
   *  empreinte de son contenu : une bibliothèque minifiée citée par vingt composants n'est analysée qu'une
   *  fois, un fichier modifié l'est de nouveau (jamais un mémo par le chemin seul). Tenu sur toute la vie de
   *  l'instance, comme `cache`. */
  private jsMemo: Map<string, { digest: string, parsable: boolean, specs: JsImportSpecifier[] | null }> = new Map()
  /** liste courante de `outputDir`, mémoïsée le temps d'UN compile() — `cleanupOldHashes()` y
   *  puise plutôt que de relister le dossier en entier à CHAQUE fichier écrit (des centaines
   *  d'appels sur un gros projet). Tenue à jour par `writeFileAtomic()` (ajoute le nouveau nom
   *  dès l'écriture) ; `null` = pas encore lue ce tour (lecture paresseuse, un compile() qui
   *  n'écrit rien ne relit jamais). Reset à `null` en tête de chaque compile() : un changement
   *  externe au dossier entre deux compiles doit être revu. */
  private outputDirListingCache: string[] | null = null
  /** les fichiers que des builds ont écrits (registre `.mjs-outputs.json`, clé `files`), lus une fois par compile() au premier
   *  besoin (cf. registeredOutputs) ; `null` = pas encore lus ce tour */
  private registryFilesCache: Set<string> | null = null
  /** composants en échec repris ce tour depuis l'ancien manifeste (clé → fichier de l'ancienne version), vérifiés avant la
   *  publication (cf. confirmRecoveries) */
  private recoveredFiles: Map<string, string> = new Map()
  /** pruneOrphans() — nombre d'erreurs du DERNIER compile(), `-1`
   * tant qu'aucun n'a encore tourné. Sert de garde : un build qui n'a jamais tourné, ou qui a
   * échoué (build partiel, cf. `recoverFailedComponentManifest`), ne doit jamais purger — sur un
   * ensemble d'émissions incomplet, la purge effacerait des fichiers ENCORE valides. */
  private lastCompileErrors = -1
  /** pruneOrphans() — numéro de génération du compile() EN COURS, incrémenté en
   * tête de chaque compile() (cf. son incrément ~1358) et JAMAIS remis à 0 (contrairement aux
   * accumulateurs voisins) : il doit rester distinct d'un compile() au suivant, sur toute la vie de
   * l'instance (watcher, API). Tague chaque entrée fraîche de `this.cache` (cf. les 2
   * `this.cache.set`) — cf. `cacheHitsThisCompile` pour l'usage. */
  private compileGeneration = 0
  /** pruneOrphans() — nombre de CACHE HITS INTER-compile
   * composant de CE compile() (cf. les 2 sites `_compileMjsInner`/`_compileScriptModuleInner`, qui
   * l'incrémentent à côté de leur `emittedThisCompile.add`, SEULEMENT quand `cached.gen !==
   * this.compileGeneration`) : un composant resservi depuis `this.cache` réinjecte son `.js` dans
   * `emittedThisCompile`, jamais ses assets annexes (`µasset`, variantes d'image — `resolveOneAsset`
   * non rappelé) — l'ensemble d'émissions de ce tour est donc PARTIEL, MAIS SEULEMENT si l'entrée
   * resservie vient d'un compile() ANTÉRIEUR : un hit sur une entrée posée PENDANT ce même compile()
   * (composant redemandé 2 fois dans le même tour — resolveTagShortcuts, une inclusion…) a déjà vu
   * ses assets annexes émis ce tour-ci, hit inoffensif. Sans ce filtre, un build FROID
   * d'un vrai projet (685 fichiers) comptait déjà 11 hits INTRA-compile de ce genre et bloquait la
   * garde en permanence (`skipped: 'cache'` systématique) : la purge ne tournait donc JAMAIS sur un
   * vrai projet. Sert de garde dans pruneOrphans() (cf. son commentaire). Remis à 0 en tête de
   * chaque compile(), comme `emittedThisCompile`. */
  private cacheHitsThisCompile = 0
  /** feuilles de mise en page et fragments de traduction à nom clair en attente de publication (cf. writeLayoutCss,
   *  writeI18nFragment) — vidée en tête de chaque compile() */
  private pendingLayoutWrites: { target: string; content: string }[] = []
  /** sorties à nom fixe refusées par CE compile() (fichier de l'auteur, cf. refusFichierAuteur) : chemin → erreur */
  private authorRefusals = new Map<string, Error>()

  constructor(opts: BundlerOpts = {}) {
    // Defaults universels — marche sur n'importe quel hébergement (Rails,
    // Express, nginx, Caddy, hébergement statique). Aucune dépendance à
    // l'asset pipeline d'un framework spécifique. Override via mjs.config.json.
    this.root = resolve('.')
    this.projectDir = dossierDuProjet(this.root)
    // un chemin non donné prend son défaut depuis le dossier de mjs.config.json (celui que lit la ligne de commande), jamais
    // depuis le sous-dossier d'où l'on construit — sans config, le dossier courant ; un chemin donné relatif part du dossier courant
    const duProjet = (chemin: string): string => resolve(this.projectDir, chemin)
    this.sourceDir = resolve(opts.sourceDir ?? duProjet('app/modularjs'))
    this.runtimeDir = resolve(opts.runtimeDir ?? this.locateRuntimeDir())
    this.coreModulesDir = resolve(opts.coreModulesDir ?? this.locateCoreModulesDir())
    this.hologramImagesDir = this.locateHologramImagesDir()
    this.outputDir = resolve(opts.outputDir ?? duProjet('public/modularjs'))
    this.manifestPath = resolve(opts.manifestPath ?? duProjet('public/modularjs/bundle.js'))
    this.manifestExternal = resolve(opts.manifestExternal ?? duProjet(this.resolveDefaultManifestExternal()))
    this.stylesheetsDir = resolve(opts.stylesheetsDir ?? duProjet('app/modularjs/styles'))
    // un dossier écrit deux fois, ou sourceDir lui-même, ne compte qu'une fois : il n'apporterait que de faux doublons
    this.assetDirs      = [...new Set((opts.assetDirs ?? []).map(d => resolve(d)))].filter(d => d !== this.sourceDir)
    this.varPrefix      = opts.varPrefix ?? 'mjs'
    this.defaultTheme   = opts.defaultTheme ?? 'light'
    this.themeCss       = ''
    this.themeNames     = []
    // même normalisation que mjs.config.json : `'/'` seul → aucun préfixe, jamais `//a-xxxxx.js` (URL vers un autre hôte) ;
    // une adresse d'un autre hôte passée à l'API, absolue (`https://cdn…/m`) ou protocole-relative (`//cdn…/m`), garde son `//`
    // et ne perd que ses slashs finaux
    const prefix    = opts.urlPrefix ?? deriveUrlPrefix(opts.outputDir ?? 'public/modularjs')
    const autreHote = /^[a-z][a-z0-9+.-]*:\/\//i.test(prefix) || (opts.urlPrefix !== undefined && /^\/\/[^\/]/.test(prefix))
    this.urlPrefix  = autreHote ? prefix.replace(/\/+$/, '') : normalizeUrlPrefix(prefix)
    this.defaultScriptLang = opts.defaultScriptLang ?? 'civet'
    this.templateLang = opts.templateLang  // défaut 'civet' appliqué dans transpile() — source unique
    this.sigil = opts.sigil ?? 'µ'
    this.contextAlias = opts.contextAlias ?? false
    this.csp = opts.csp ?? false           // mode strict OPT-IN : rien ne change tant qu'il n'est pas demandé
    this.sourceMapMode = opts.sourceMap ?? 'dev'    // défaut : la carte sert au développement, pas en prod où elle publie le source
    this.maxStateVars = opts.maxStateVars  // défaut (40) appliqué dans transpile() — source unique
    this.a11y = opts.a11y  // défaut (true) appliqué dans transpile() — source unique
    this.ujsForm = opts.ujsForm  // défaut (true) appliqué dans transpile() — source unique
    this.lint = opts.lint
    // pas de fallback conditionnel : un appelant direct du Bundler (hors CLI, ex. un test) garde
    // un résultat cohérent avec son PROPRE terminal plutôt qu'une couleur jamais désactivable
    this.colorsEnabled = opts.colorsEnabled ?? resolveColorsEnabled()
    this.keepFailedComponents = opts.keepFailedComponents ?? true
    this.prune = opts.prune ?? true
    this.preload = opts.preload
    this.viewTransition = opts.viewTransition
    this.logLevel = opts.logLevel
    this.messagesMode = opts.messages ?? 'demand'
    this.typesMode = opts.types
    this.effectsConf = opts.effects
    this.bundlesConf = opts.bundles
    this.i18n = opts.i18n
    // les durées de la config ont leur plafond par l'API comme par mjs.config.json (i18n.timeout : celui d'une minuterie ; effects.guard.delay : 24 h)
    const garde = opts.effects?.guard
    verifierPlafondDuree('i18n.timeout', opts.i18n?.timeout)
    verifierPlafondDuree('effects.guard.delay', typeof garde === 'object' && garde ? garde.delay : undefined)
    this.render = opts.render
    this.i18nManifestData = undefined
    // Deux axes désormais SÉPARÉS : `env` dit dev ou prod, `minify` dit
    // si on compacte. `forceMinify` (legacy, interne) reste le raccourci « les deux »,
    // et cède devant un `env`/`minify` explicite.
    this.envMode    = opts.env    ?? (opts.forceMinify ? 'prod' : 'dev')
    this.minifyMode = opts.minify ?? (opts.forceMinify ? true   : 'auto')
    this.minimalRuntime = opts.minimalRuntime ?? false
    this.runtime = opts.runtime
    this.cssMode = opts.css ?? 'bundle'
    this.jsMode = opts.js ?? 'split'
    // défauts résolus ICI, au point de consommation, comme le reste des politiques
    this.imageConfig = {
      widths:  opts.image?.widths  ?? [480, 960, 1920],
      formats: opts.image?.formats ?? ['webp'],
      quality: opts.image?.quality ?? 78,
    }
    this.dedupWaitTimeoutMs = opts.dedupWaitTimeoutMs ?? 12000
    this.inlineTranspileLimit = opts.inlineTranspileLimit ?? INLINE_LIMIT
    this.cache = new Map()
    this.manifest = {}
    this.coreHashedPath = ''
    this.usedAnimations = new Set()
    this.definedAnimations = new Set()
    this.requestedSharedSheets = new Set()
    this.viewRequestedSheets = new Set()
    this.partialDependents = new Map()
    this.externalManifestDeps = new Set()
    this.mangleCache = this.loadMangleCache()
    // marqueurs lus sur une donnée (cf. minify.ts) : réservés dès l'existence du cache — qu'il
    // vienne d'être créé ou d'être relu du disque. Une correspondance héritée d'un cache plus
    // ancien est retirée, et la génération avance comme pour les noms d'instance : tout code
    // minifié avec elle est désaccordé et sera recompilé. Sans minification, le cache reste vide
    // comme avant (rien n'est raccourci, et un build de dév n'écrit aucun `.mangle-cache.json`).
    const withdrawnMarkers = this.shouldMinify() ? reserveDataMarkers(this.mangleCache) : []
    // aides du cœur posées sur µ (`µ._p`, `µ._tm`, cf. minify.ts) : leur nom ne doit jamais
    // devenir le nom court d'une propriété interne, sans quoi le raccourcisseur écrase l'aide
    // elle-même. Le relevé des noms d'instance ne les couvre que si un gabarit les cite.
    const withdrawnHelpers = this.shouldMinify() ? reserveMangleNames(this.mangleCache, CORE_HELPER_NAMES) : []
    // noms que le navigateur porte déjà sur ses objets (`x` d'une image, `id` d'une balise, cf.
    // minify.ts) : une propriété interne posée sur un nœud sous un de ces noms écrirait dans la
    // propriété du navigateur. Une correspondance héritée d'un cache plus ancien est retirée.
    const withdrawnPlatform = this.shouldMinify() ? reserveMangleNames(this.mangleCache, PLATFORM_NAMES) : []
    if (withdrawnMarkers.length > 0 || withdrawnHelpers.length > 0 || withdrawnPlatform.length > 0) this.mangleGeneration++
  }

  // --------------------------------------------------------------------------
  // resolveDefaultManifestExternal : défaut de `manifestExternal` QUAND il
  // n'est pas configuré explicitement (mjs.config.json ou BundlerOpts — un
  // chemin explicite est toujours respecté tel quel, cette résolution n'entre
  // jamais en jeu dans ce cas). Priorité 'app/modularjs/manifest.civet' s'il existe ; sinon repli
  // 'app/modularjs/manifest.coffee' (dépréciée — cf. coffeeAdapter, avertit à
  // sa propre compilation) QUE ce fichier existe ou non — si aucun des deux
  // n'existe, bundleExternalManifest() no-op déjà sur un manifest absent
  // (comportement historique inchangé).
  // --------------------------------------------------------------------------
  private resolveDefaultManifestExternal(): string {
    const civetDefault = 'app/modularjs/manifest.civet'
    return existsSync(resolve(this.projectDir, civetDefault)) ? civetDefault : 'app/modularjs/manifest.coffee'
  }


  // --------------------------------------------------------------------------
  // Worker pool — partagé global au process (refcounted).
  //
  // Le pool de workers est coûteux à initialiser (esbuild compile worker.ts en
  // dev + N spawns de threads). Le réutiliser entre Bundlers évite N×200ms
  // d'overhead — important pour les tests qui créent un Bundler par test.
  // --------------------------------------------------------------------------
  private async ensureWorkerPool(): Promise<WorkerPool> {
    // TOCTOU async : l'ancien garde-fou
    // testait `_sharedWorkerPool` (la VALEUR déjà résolue). Entre ce test et
    // l'assignation `_sharedWorkerPool = new WorkerPool(...)` se trouve un
    // `await resolveWorkerScript()` — N appels concurrents (compilation en
    // parallelMap de N fichiers .mjs) voyaient TOUS `!_sharedWorkerPool`
    // AVANT que le premier n'ait fini : jusqu'à PARALLEL_LIMIT pools créés,
    // tous sauf le DERNIER à assigner `_sharedWorkerPool` orphelins (threads
    // jamais terminate(), fuite documentée jusqu'à l'OOM), et
    // `resolveWorkerScript()` (écrit worker-<hash>.mjs sur disque) appelé en
    // concurrence sur le MÊME fichier (troncature possible).
    //
    // Fix : mémoïse la PROMESSE de création (`_sharedWorkerPoolPromise`), pas
    // juste la valeur — tout appel concurrent qui arrive AVANT la résolution
    // attend la MÊME promesse en vol plutôt que d'en lancer une nouvelle.
    // Le nouveau pool n'est éligible au réemploi QUE si le pool RÉSOLU
    // (`_sharedWorkerPool`) n'est pas mort ; `_sharedWorkerPool` est remis à
    // `null` de façon SYNCHRONE (avant tout `await`) dès qu'une recréation
    // démarre, pour qu'un appelant concurrent qui arrive juste après voie
    // bien "recréation déjà en cours" plutôt que de retester l'ancien pool
    // (encore marqué mort) et en déclencher une DEUXIÈME.
    let pool: WorkerPool
    if (_sharedWorkerPoolPromise && (!_sharedWorkerPool || !_sharedWorkerPool.isDead())) {
      pool = await _sharedWorkerPoolPromise
    } else {
      const stalePool = _sharedWorkerPool
      _sharedWorkerPool = null
      const creating = (async () => {
        if (stalePool) {
          // Pool précédent mort : on le remplace (terminate best-effort).
          await stalePool.terminate().catch(() => {})
        }
        const spec = await resolveWorkerScript()
        // Taille du pool = PARALLEL_LIMIT (dérivé de RAM disponible cf. supra).
        // Chaque worker_threads consomme ~700 MB à cause du bundle esbuild,
        // donc 8 workers = 5-6 GB de RAM → OOM-kill sur système 8 GB. On
        // dimensionne donc en fonction de la RAM (cf. PARALLEL_LIMIT).
        const p = new WorkerPool(PARALLEL_LIMIT, spec)
        _sharedWorkerPool = p
        return p
      })()
      _sharedWorkerPoolPromise = creating
      // Une création qui échoue (ex. resolveWorkerScript() jette) ne doit PAS
      // "bricker" tous les appels futurs avec la même promesse rejetée à
      // vie — on libère la mémoïsation pour permettre une nouvelle tentative.
      creating.catch(() => { if (_sharedWorkerPoolPromise === creating) _sharedWorkerPoolPromise = null })
      pool = await creating
    }
    if (!this._poolUserRegistered) {
      _sharedWorkerPoolRefCount++
      this._poolUserRegistered = true
    }
    return pool
  }

  /** Marque ce Bundler comme utilisateur du pool partagé (incr refcount au 1er ensure). */
  private _poolUserRegistered = false

  /** Arrête l'observateur lancé par watch() (null hors surveillance) — appelé par close(). */
  private stopWatching: (() => Promise<void>) | null = null

  /** Termine le pool de workers s'il n'a plus d'utilisateurs.
   *
   * À appeler quand le Bundler n'est plus utilisé (sinon Node ne sort pas
   * tant que les workers sont actifs).
   */
  async close(): Promise<void> {
    // l'observateur de watch() : sans lui, les éditions relançaient des constructions après close() et le processus ne sortait plus
    if (this.stopWatching !== null) {
      const arreter = this.stopWatching
      this.stopWatching = null
      await arreter()
    }
    if (this._poolUserRegistered) {
      _sharedWorkerPoolRefCount--
      this._poolUserRegistered = false
      if (_sharedWorkerPoolRefCount <= 0 && _sharedWorkerPool) {
        await _sharedWorkerPool.terminate()
        _sharedWorkerPool = null
        _sharedWorkerPoolPromise = null
        _sharedWorkerPoolRefCount = 0
      }
    }
  }

  // --------------------------------------------------------------------------
  // preResolveAssets — extrait tous les `µasset('X')` / `µ.asset('X')`
  // littéraux du contenu source et les résout via `resolveOneAsset`. Le dict
  // résultant est envoyé au worker qui n'a pas accès au disque.
  //
  // CORRECTIF DE DOC — le commentaire affirmait
  // qu'un `µasset(varExpr())` DYNAMIQUE produirait un placeholder
  // `MISSING_MJS_ASSET:xxx` rattrapé plus tard par `resolveMagicAssets` :
  // FAUX, vérifié dans `replaceMagicAssets` (transpiler/index.ts) — sa regex
  // n'accepte QU'un argument entre guillemets littéraux ; un appel dynamique
  // ne matche jamais et traverse tel quel, résolu à l'exécution par
  // l'implémentation runtime de `µ.asset`. Le placeholder n'apparaît QUE pour
  // un chemin LITTÉRAL (donc statiquement résolvable en théorie) qui a
  // échoué — fichier absent du disque, ou (bug corrigé ci-dessous) sigil
  // alternatif non reconnu par CETTE regex. `resolveMagicAssets` reste utile
  // pour les patterns `µasset(...)` GÉNÉRÉS après ce point (templates,
  // mjs_core) et sert désormais aussi de garde-fou : un placeholder qui
  // survit jusqu'à son retour devient une ERREUR de build (cf. son propre
  // commentaire), plus un warning silencieux.
  // --------------------------------------------------------------------------
  private async preResolveAssets(content: string, baseDir?: string): Promise<{ dict: Record<string, string>; assetSources: string[]; images: Record<string, string> }> {
    // 1. `µasset('X')` / `µ.asset('X')` / `mjsasset('X')` / `mjs.asset('X')`
    // littéraux dans le code user. Cette
    // regex ne reconnaissait QUE la forme `µ` : un projet configuré en sigil
    // 'mjs' (`mjs.asset('X')`) ne voyait JAMAIS son asset pré-résolu ICI (le
    // dict envoyé au worker n'avait pas d'entrée pour ce logicalPath) — le
    // TRANSPILER (qui, lui, connaît le sigil configuré) reconnaît pourtant
    // bien `mjs.asset(...)` comme un appel d'asset valide, mais
    // `resolveAsset()` ne trouve rien dans le dict et retombe sur le
    // placeholder `/MISSING_MJS_ASSET:X` — qui SURVIT alors jusqu'au fichier
    // écrit sur disque, SANS AUCUNE erreur ni warning (build vert, asset
    // cassé en prod). Les deux formes sont reconnues INCONDITIONNELLEMENT
    // (pas seulement celle du sigil configuré) : un projet peut légitimement
    // mélanger les deux graphies (copié-collé de doc, migration en cours).
    // Masque `<pre>`/`<code>` AVANT
    // l'extraction : un `µasset('…')` AFFICHÉ en EXEMPLE de doc/tuto (pas une
    // vraie référence) n'est plus résolu ni copié comme un asset réel (même
    // masquage que `extractImportMatches` juste en dessous pour les `@import`).
    const ASSET_CALL_RE = /(?:µasset|µ\.asset|mjsasset|mjs\.asset)\s*\(\s*['"]([^'"]+)['"]\s*\)/g
    const masked = maskCodeBlocks(content)
    const muMatches = [...masked.matchAll(ASSET_CALL_RE)]
    // `µimport('X')`/`mjsimport('X')` LITTÉRAL : réécrit PLUS TARD, DANS
    // le worker, en `µ._mjs_import(µasset('X'))` (rewriteMuImport, sigils.ts) — le
    // µasset('X') qui en naît doit donc être pré-résolu ICI, côté master, comme
    // n'importe quel µasset(...) direct (sinon le worker, sans accès disque,
    // reçoit un dict sans entrée pour 'X' → MISSING_MJS_ASSET). Regex SŒUR
    // (pas fusionnée à ASSET_CALL_RE, qui reste focalisée sur µasset) sur le
    // corps PARTAGÉ sigils.ts ; même dict/même traitement en aval (m[1] = chemin).
    muMatches.push(...masked.matchAll(MU_IMPORT_CALL_RE))
    // Même chose pour la forme nue sans parenthèses
    muMatches.push(...masked.matchAll(MU_IMPORT_BARE_RE))
    // 2. Paths référencés par les directives `@import` (générés en `µasset(...)`
    //    par la directive, mais avant que le worker ne les voie). Sans cette
    //    pré-résolution, le worker écrit `/MISSING_MJS_ASSET:xxx` et le master
    //    ne rattrape plus (le pattern `µasset(...)` a déjà été substitué).
    //    Régression V2 — les tutos avec `@import` cassent silencieusement.
    //
    //    Le nom de var peut contenir `µ`, `$` et `§` (store `$$X`, var `µ$X`,
    //    singleton importé `@import µ$$X`). Sans ça, `@import µ$$count …` n'est
    //    pas reconnu et le path n'est jamais pré-résolu.
    //    Cf. `extractImportMatches` :
    //    masque `<pre>`/`<code>` (démo de tuto affichant `@import` comme
    //    exemple de code, pas une vraie directive) + la regex ne peut plus
    //    enjamber les lignes.
    const importMatches = extractImportMatches(content)

    // 3. Descend récursivement dans les `<@include>` : un `µasset(...)`/`@import`
    // qui ne vit QUE dans un partial (jamais dans le fichier top-level lui-même —
    // cas réel : le logo <img src="µasset('tuto/MModularJS.webp')"> de
    // tuto/_header.mjs et doc/_header.mjs) n'était JAMAIS vu ICI : cette
    // fonction tourne côté MASTER, AVANT l'inlining réel des partials (celui-ci
    // se fait DANS le worker, par le transpiler) — le dict transmis au worker
    // n'avait donc pas d'entrée pour ce logicalPath, et `resolveAsset()` (qui,
    // dans le worker, n'est qu'un lookup dans ce dict — aucun accès disque)
    // retombait sur `/MISSING_MJS_ASSET:X`, qui survivait jusqu'à
    // `resolveMagicAssets` (post-compile, cf. son commentaire) : ERREUR DE
    // BUILD. Le fix d'ordre des passes 4a-4d du transpiler (<@include> avant
    // µasset) règle le cas `transpile()` appelé DIRECT avec un `resolveAsset`
    // à accès disque immédiat (cf. tests/macros.test.ts) mais PAS le pipeline
    // réel de `mjs build` (worker pool) — d'où ce 2e correctif, complémentaire.
    // Réutilise `resolvePartial`/`INCLUDE_RE` du transpiler TELS QUELS (jamais
    // de logique de résolution dupliquée qui pourrait diverger) ; garde
    // anti-boucle par chemin absolu déjà visité (partial circulaire ou inclus
    // depuis plusieurs points).
    // Le même parcours relève aussi les images (µimage, `<@@img>`, réglages d'image des effets, cf. plus bas) : chaque partiel
    // est lu et masqué une seule fois par composant qui l'inclut, son texte masqué sert aussi à trouver ses propres `<@include>`.
    const partialMuMatches = [...muMatches]
    const partialImportMatches = [...importMatches]
    // `µimage('chemin'[, largeur…])` : cf. la résolution des images plus bas
    const imageMatches = [...masked.matchAll(IMAGE_CALL_RE)]
    // `<@@img src="…">` littéral : MÊME file que
    // les µimage(...) ci-dessus (contenu + partials <@include>), texte masqué par
    // maskImgTagScanZones pour ignorer un exemple affiché dans <pre>/<code>/<script>/<style>/un
    // commentaire HTML (scanImgTags, transpiler/img-tag.ts — pas d'accès disque là-bas, tout ici).
    const imgTagMatches: ImgTag[] = scanImgTags(maskImgTagScanZones(content))
    // chemins locaux écrits en clair dans un réglage d'image d'un effet (`*behind('photo.jpg')`) : résolus comme
    // `µimage('photo.jpg')`, avec les mêmes images — le transpileur récrit le littéral en cet appel (effect-images.ts) ;
    // un effet de l'appli qui règle un effet de la bibliothèque est lu avec les réglages de celui-ci
    const effectImages = (text: string): EffectImage[] => withProjectEffects(this.effectDefs, () => scanEffectImages(text))
    const effectImageMatches: EffectImage[] = effectImages(content)
    if (baseDir) {
      const visited = new Set<string>()
      const queue: Array<{ masque: string; dir: string }> = [{ masque: masked, dir: baseDir }]
      while (queue.length > 0) {
        const { masque, dir } = queue.shift()!
        for (const m of masque.matchAll(INCLUDE_RE)) {
          const resolved = resolvePartial(m[1], dir, this.sourceDir)
          if (!resolved || visited.has(resolved.key)) continue
          visited.add(resolved.key)
          let partialContent: string
          try {
            partialContent = readFileSync(resolved.path, 'utf-8')
          } catch {
            continue
          }
          const maskedPartial = maskCodeBlocks(partialContent)
          for (const pm of maskedPartial.matchAll(ASSET_CALL_RE)) partialMuMatches.push(pm)
          // µimport('X')/mjsimport('X') LITTÉRAL DANS un partial
          // manquait ici (seul ASSET_CALL_RE était scanné) : le build à froid restait
          // vert (filet resolveMagicAssets, master, post-compile, accès disque réel),
          // mais `assetSources`/le dict restaient sans cette entrée → cache de host.mjs
          // JAMAIS invalidé quand la cible du µimport change (mjs dev/watch), staleness
          // silencieuse constatée en conditions réelles. Même regex SŒUR qu'en tête de
          // fonction (ligne ~827), appliquée ici au texte du partial.
          for (const pm of maskedPartial.matchAll(MU_IMPORT_CALL_RE)) partialMuMatches.push(pm)
          // Même chose pour la forme nue sans parenthèses
          for (const pm of maskedPartial.matchAll(MU_IMPORT_BARE_RE)) partialMuMatches.push(pm)
          for (const pm of extractImportMatches(partialContent)) partialImportMatches.push(pm)
          for (const pm of maskedPartial.matchAll(IMAGE_CALL_RE)) imageMatches.push(pm)
          imgTagMatches.push(...scanImgTags(maskImgTagScanZones(partialContent)))
          effectImageMatches.push(...effectImages(partialContent))
          queue.push({ masque: maskedPartial, dir: dirname(resolved.path) })
        }
      }
    }

    // Filtre les URLs externes (https://...) qui ne sont pas des assets locaux.
    const localPaths: string[] = []
    for (const m of partialMuMatches) localPaths.push(m[1])
    for (const m of partialImportMatches) {
      const p = m[1]
      if (!/^https?:\/\//.test(p)) localPaths.push(p)
    }

    const dict: Record<string, string> = {}
    const unique = new Set(localPaths)
    await Promise.all(
      [...unique].map(async (logicalPath) => {
        dict[logicalPath] = await this.resolveOneAsset(logicalPath)
      })
    )
    // Chemins SOURCE des `µasset('…')`
    // LITTÉRAUX, remontés au parent pour être suivis comme DÉPENDANCES (hash de
    // cache + partialDependents), au même titre que les `@import` (ces derniers
    // déjà suivis séparément par _compileMjsInner). Sans ça, éditer un asset
    // (logo.png, ou un .civet référencé par µasset) en watch ne ré-invalidait
    // JAMAIS le .mjs parent → cache hit → ancien asset servi (voire un hashedPath
    // disparu après cleanupOldHashes → 404 silencieux). `resolve(sourceDir, …)`
    // pour matcher la clé du watcher (`resolve(changed)`) et des @import.
    // `partialMuMatches` (et non `muMatches` seul) : un asset référencé
    // UNIQUEMENT depuis un partial doit, lui aussi, invalider ses parents
    // quand il change (même raisonnement que le fix ci-dessus).
    const assetSources = [...new Set(partialMuMatches.map((m) => this.assetDep(m[1])))]

    // `µimage('chemin'[, largeur…])` : même mécanique de pré-résolution côté
    // MASTER (le worker n'a pas le disque, et il faut lire l'en-tête du fichier pour en
    // sortir les dimensions), mais la valeur résolue n'est pas une URL : c'est un OBJET
    // (`src`, `srcset`, `width`, `height`…). On indexe par le TEXTE EXACT de l'appel —
    // deux appels au même fichier avec des largeurs différentes sont deux entrées. Relevés (contenu + partials) par le
    // parcours des `<@include>` plus haut, avec les `<@@img>` et les réglages d'image des effets.
    const images: Record<string, string> = {}
    for (const m of imageMatches) {
      if (images[m[0]] !== undefined) continue
      const widths = (m[2] ?? '').split(',').map(s => s.trim()).filter(Boolean).map(Number)
      images[m[0]] = JSON.stringify(await this.resolveOneImage(m[1], widths))
      assetSources.push(this.assetDep(m[1]))
    }
    // … un fichier absent (ou hors du dossier source) fait échouer le build en nommant l'effet et le chemin
    for (const e of effectImageMatches) {
      // un réglage dont l'effet ne lit que l'adresse : l'image seule, sous empreinte (`µasset`), sans variante de largeur
      if (e.plain) {
        dict[e.chemin] ??= await this.resolveOneAsset(e.chemin)
        if (dict[e.chemin].startsWith('/MISSING_MJS_ASSET')) throw new Error(t('bundler.index.image-effet-introuvable', { effet: e.effet, reglage: e.reglage, chemin: e.chemin, dossiers: this.searchedDirs(e.chemin) }))
        assetSources.push(this.assetDep(e.chemin))
        continue
      }
      const appel = imageCall(e.chemin)
      if (images[appel] !== undefined) continue
      const resolved = await this.resolveOneImage(e.chemin)
      if (String(resolved.src).startsWith('/MISSING_MJS_ASSET')) throw new Error(t('bundler.index.image-effet-introuvable', { effet: e.effet, reglage: e.reglage, chemin: e.chemin, dossiers: this.searchedDirs(e.chemin) }))
      images[appel] = JSON.stringify(resolved)
      assetSources.push(this.assetDep(e.chemin))
    }
    // même mécanique que la boucle µimage ci-dessus, mais la valeur résolue
    // est la BALISE RÉÉCRITE (texte), pas un objet JSON : `<@@img>` reste `<@@img>`, seuls
    // ses attributs se remplissent (cf. replaceMagicImages, transpiler/index.ts, qui fait
    // un split/join texte→texte générique — aucune modification n'y était nécessaire).
    for (const tag of imgTagMatches) {
      if (images[tag.text] !== undefined) continue
      if (!isResolvableSrc(tag.src)) continue   // dynamique/absolu/URL/absent : passe-plat
      const src     = tag.src
      const extrait = Array.from(tag.text).slice(0, 80).join('').replace(/\n/g, ' ')
      // attribut écrit DEUX FOIS : la réécriture recopiait chaque
      // occurrence → deux `src` dans le HTML émis. Refus net, comme `accept` dupliqué
      // sur <@element> — jamais une sortie invalide en silence.
      for (const nom of ['src', 'widths']) {
        if (tag.attrs.filter(a => a.name === nom).length > 1) throw new Error(t('bundler.index.img-attribut-duplique', { attribut: nom, extrait }))
      }
      let widths: number[] = []
      if (tag.widthsDynamique !== null) throw new Error(t('bundler.index.img-widths-invalide', { valeur: tag.widthsDynamique, extrait }))
      if (tag.widthsRaw !== null) {
        const parsed = parseWidths(tag.widthsRaw)
        if (parsed === null) throw new Error(t('bundler.index.img-widths-invalide', { valeur: tag.widthsRaw, extrait }))
        widths = parsed
      }
      // confinement SOUS sourceDir (ou, à défaut, sous un dossier de assetDirs), le même que resolveOneAsset : sans
      // lui, un `../hors/x.png` qui EXISTE passait cette garde et n'était refusé qu'en
      // aval, par le filet générique dont le message ne nomme jamais la balise
      const found = this.locateAsset(src)
      if (!found) {
        throw new Error(t('bundler.index.img-src-introuvable', { chemin: src, extrait, dossiers: this.searchedDirs(src) }))
      }
      // Même confinement RÉEL que resolveOneAsset (le check LEXICAL
      // ci-dessus ne résout jamais un symlink) : un lien posé DANS sourceDir et pointant HORS
      // de sourceDir passait ce test (chemin textuel valide) puis sa cible réelle était copiée.
      const realAbs     = realpathSync(found.source)
      const realSrcRoot = realpathSync(found.root)
      if (realAbs !== realSrcRoot && !realAbs.startsWith(realSrcRoot + sep)) {
        throw new Error(t('bundler.index.img-src-symlink-hors-racine', { chemin: src, cible: realAbs, extrait, racine: found.root === this.sourceDir ? undefined : 'assetDirs' }))
      }
      const resolvedRaw = await this.resolveOneImage(src, widths)
      const resolved    = {
        src:    String(resolvedRaw.src ?? ''),
        srcset: String(resolvedRaw.srcset ?? ''),
        sizes:  String(resolvedRaw.sizes ?? ''),
        width:  (resolvedRaw.width as number | null)  ?? null,
        height: (resolvedRaw.height as number | null) ?? null,
      }
      images[tag.text] = rewriteImgTag(tag, resolved)
      assetSources.push(this.assetDep(src))
    }

    return { dict, assetSources: [...new Set(assetSources)], images }
  }

  // --------------------------------------------------------------------------
  // mangleCache persistance.
  //
  // Sans persistance, chaque `new Bundler()` repart d'un cache vide → l'ordre
  // de mangle des `_mjs_*` peut différer entre 2 builds prod du même code
  // (selon l'ordre de découverte). Conséquence : 2 builds prod du MÊME source
  // produisent 2 bundles à hash MD5 différents → cache navigateur invalidé
  // gratuitement à chaque déploiement.
  //
  // Solution : sérialiser le mangleCache dans `<outputDir>/.mangle-cache.json`
  // après chaque compile et le recharger au start du suivant. Garantit des
  // builds reproductibles → bundles binairement identiques pour un code
  // identique → cache navigateur stable.
  //
  // Format simple : `{ "_mjs_intro": "a", "_mjs_outro": "b", ... }`.
  // --------------------------------------------------------------------------
  private get mangleCachePath(): string {
    return join(this.outputDir, '.mangle-cache.json')
  }

  private loadMangleCache(): Record<string, string | false> {
    try {
      if (!existsSync(this.mangleCachePath)) return {}
      const raw = readFileSync(this.mangleCachePath, 'utf-8')
      // dans le dossier des sources, un fichier de ce nom qui n'a pas la forme du cache est peut-être un fichier de l'auteur :
      // jamais lu, la construction le refuse (cf. refusSortiesAuteur)
      if (this.ecritDansSources() && !cacheDeNoms(raw)) return {}
      const parsed = JSON.parse(raw)
      // objet plat clé → texte|false ; le fichier est versionné : une fusion git peut y laisser deux propriétés vers le
      // même nom court (esbuild les confondrait en silence) ou une valeur qui n'est pas un texte (minification en échec).
      // Ces entrées sont écartées, les deux clés d'un nom partagé comprises, et seront recalculées
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        const porteurs = new Map<string, number>()
        for (const v of Object.values(parsed)) if (typeof v === 'string') porteurs.set(v, (porteurs.get(v) ?? 0) + 1)
        const kept: Record<string, string | false> = {}
        const ecartees: string[] = []
        for (const [k, v] of Object.entries(parsed)) {
          if (v === false || (typeof v === 'string' && v !== '' && porteurs.get(v) === 1)) kept[k] = v
          else ecartees.push(k)
        }
        if (ecartees.length > 0) {
          this.mangleGeneration++
          this.buildWarn(t('bundler.index.mangle-cache-ecarte', { fichier: '.mangle-cache.json', cles: ecartees.join(', ') }))
        }
        return kept
      }
    } catch {
      // Cache corrompu / mal formé → on repart à zéro (perte de stabilité
      // sur ce build, mais le suivant écrira un nouveau cache propre).
    }
    return {}
  }

  private saveMangleCache(): void {
    if (Object.keys(this.mangleCache).length === 0) return
    try {
      if (!existsSync(this.outputDir)) mkdirSync(this.outputDir, { recursive: true })
      // Trie les clés pour stabilité du fichier (diff git lisible).
      const sorted: Record<string, string | false> = {}
      for (const k of Object.keys(this.mangleCache).sort()) {
        sorted[k] = this.mangleCache[k]
      }
      // FAILLE — `writeFileSync` DIRECT
      // sur le chemin final pouvait être DÉCHIRÉ par 2 builds concurrents (build
      // pendant dev, CI parallèle) : fichier partiel → `JSON.parse` raté au
      // prochain load → cache vidé → mangle instable. Écriture ATOMIQUE
      // (temp + rename). `writeFileAtomic` ne convient PAS ici (il skippe si la
      // cible existe — or le cache CHANGE à chaque build) : temp+rename inline.
      const tmp = `${this.mangleCachePath}.tmp-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}`
      writeFileSync(tmp, JSON.stringify(sorted, null, 2), 'utf-8')
      try {
        renameSync(tmp, this.mangleCachePath)
      } catch (e) {
        try { unlinkSync(tmp) } catch {}
        throw e
      }
    } catch {
      // Échec d'écriture (disque plein, permissions) → silencieux. Le build
      // a réussi, on perd juste la stabilité pour le prochain run.
    }
  }

  // --------------------------------------------------------------------------
  // compile() : cycle complet
  // --------------------------------------------------------------------------
  async compile(): Promise<CompileStats> {
    const errors: Error[] = []
    const warnings: string[] = []
    let written = 0
    const start = Date.now()
    // référence de fraîcheur pour depDigest (cf. son bandeau) : figée UNE fois ici, jamais
    // recalculée pendant le tour — un fichier édité avant CET instant reste fiable pour
    // toute la durée du compile(), aussi longue soit-elle.
    this.compileStartMs = start
    this.lintPrintedByTranspiles = 0
    // assetDirs : les doublons d'image se redisent à chaque tour, pour les composants qui recompilent
    this.pendingAssetWarnings = []
    this.assetShadowsSeen     = new Set()
    // Reset à chaque compile pour détecter les collisions sur ce run, sans
    // garder l'état d'un build précédent (cas du watcher).
    this.manifestSources = new Map()
    this.manifestKinds = new Map()
    this.poisonedAliasSources = new Map()
    // depDigest — la mémoïsation ne vit QUE le temps d'un tour de compilation : un partial
    // partagé par 30 composants est relu 1 fois au lieu de 30, mais AUCUNE décision de
    // fraîcheur ne franchit la frontière du tour. Sans ce reset, un fichier réécrit avec
    // la même taille ET la même mtime nanoseconde (rsync --times, restauration d'archive,
    // touch reposé) resservirait un contenu périmé — même bug déjà rencontré une fois,
    // reproduit pour de vrai.
    this.depDigestCache = new Map()
    // lectures rapides des sources (cf. scanSource) : celles du tour d'avant restent consultables,
    // seules celles servies CE tour-ci passent au suivant
    this.sourceScansPrev = this.sourceScans
    this.sourceScans     = new Map()
    // idem pour la liste mémoïsée de outputDir (cf. son bandeau) : un compile() qui commence
    // ne doit jamais partir sur l'instantané du tour précédent.
    this.outputDirListingCache = null
    this.registryFilesCache    = null
    // `cache` et `partialDependents`, EUX, survivent d'un compile() à l'autre PAR CONSTRUCTION
    // (c'est tout l'intérêt du cache incrémental d'une session `mjs dev`/`watch()` — UNE SEULE
    // instance de Bundler tourne toute la session, contrairement à `mjs build` qui repart d'un
    // process neuf à chaque fois) : sans purge, l'entrée d'un fichier renommé ou supprimé y
    // restait POUR TOUJOURS — une fuite qui grossit à chaque renommage/suppression sur une
    // session longue. Un simple stat() par entrée existante, négligeable devant le reste d'un
    // compile().
    for (const key of this.cache.keys()) {
      if (!existsSync(key)) this.cache.delete(key)
    }
    for (const [partial, parents] of this.partialDependents) {
      if (!existsSync(partial)) { this.partialDependents.delete(partial); continue }
      for (const parent of parents) {
        if (!existsSync(parent)) parents.delete(parent)
      }
      if (parents.size === 0) this.partialDependents.delete(partial)
    }
    // Reset AVANT l'étape 1 (runtime), pas au rythme de
    // `this.manifest` (repartait plus bas, ligne ~1040, APRÈS l'appel à
    // bundleRuntime()) : writeHashed('mjs_core', …) appelé PAR bundleRuntime
    // marquait déjà `mjs_core-<hash>.js` dans emittedThisCompile AVANT que ce
    // reset tardif ne l'efface aussitôt — le runtime disparaissait donc du
    // tableau des tailles sur CHAQUE build (pas seulement en cas d'échec),
    // repéré (build sain à 2 composants : mjs_core absent du
    // tableau malgré 752 916 octets écrits sur disque, written=4 vs sizes
    // n'en comptant que 2).
    this.emittedThisCompile = new Set()
    this.cachedAssetNames   = new Set()
    this.pendingLayoutWrites = []
    this.authorRefusals     = new Map()
    this.i18nWritten        = new Map()
    this.frameworkAssets    = new Map()
    // un fichier source supprimé ou renommé ne protège plus son ancien nom publié (cf. publishedAssets), sauf si une unité
    // en cache le cite encore : renommé puis remis, il est sur le disque et l'unité, servie du cache, ne le republie pas
    const missing = [...this.publishedAssets.keys()].filter(source => !existsSync(source))
    if (missing.length > 0) {
      const cited = new Set<string>()
      for (const entry of this.cache.values()) for (const dep of entry.importedModules ?? []) cited.add(dep)
      for (const source of missing) if (!cited.has(source)) this.publishedAssets.delete(source)
    }
    for (const source of this.jsMemo.keys()) {
      if (!existsSync(source)) this.jsMemo.delete(source)
    }
    // NE PLUS reset ici (contrairement à
    // emittedThisCompile ci-dessus) : un compile() précédent dont writeManifest() a ÉCHOUÉ laisse
    // des suppressions EN ATTENTE, jamais flushées (par construction, cf. flushPendingHashCleanup) —
    // les oublier ici les rendait orphelines POUR TOUJOURS si le compile() SUIVANT réussit mais fait
    // un cache-hit total (le composant fautif n'a pas changé, aucun nouveau cleanupOldHashes() ne le
    // requalifie). La file doit donc SURVIVRE d'un compile() à l'autre : elle n'est vidée que par
    // flushPendingHashCleanup() (writeManifest() réussi, cache-hit ou non), jamais par un simple
    // redémarrage de tour.
    // pruneOrphans() — reset au même rythme que emittedThisCompile ci-dessus.
    this.cacheHitsThisCompile = 0
    // pruneOrphans() — JAMAIS remis à 0 (contrairement à la ligne ci-dessus) :
    // incrémentée à CHAQUE compile(), elle doit rester distincte d'un tour au suivant sur toute la
    // vie de l'instance, pour que les 2 sites de cache-hit distinguent un hit posé CE tour-ci
    // (inoffensif) d'un hit posé par un compile() antérieur (cf. `cacheHitsThisCompile`).
    this.compileGeneration++
    // reset des accumulateurs "css-only" (comme manifestSources
    // ci-dessus). Pas de coût hors watch : cssOnlyTracking reste false.
    if (this.cssOnlyTracking) {
      this.cssOnlyComponents = {}
      this.cssOnlySheets = {}
      this.cssOnlyRoot = undefined
      this.cssOnlyDisqualified = false
      this.cssOnlyWrites = new Map()
      this.cssOnlyAllowedWrites = new Set()
      // mode css='split' — un module qui déclare une feuille embarque désormais son
      // chemin haché EN DUR (import en tête du JS émis, cf. _compileMjsInner) : éditer
      // cette feuille recompile donc CE module (cache salé, cf. splitStyleHashedPaths
      // dans le hash), un changement structurel que le payload replaceSync existant
      // (pensé pour mjs_styles.js unique) ne sait pas décrire fidèlement. Plutôt que de
      // le laisser mentir, on désarme proprement : tout tour de
      // watch en mode split retombe sur un reload complet.
      if (this.cssMode === 'split') this.cssOnlyDisqualified = true
    }

    // configuration qui ferait écrire ce build sur des fichiers de l'auteur : refusée AVANT toute écriture (ni dossier de
    // sortie, ni sorties, ni registre), cf. refusAvantEcriture
    const refusDepart = this.refusAvantEcriture()
    if (refusDepart.length > 0) {
      errors.push(...refusDepart)
      this.lastCompileErrors = errors.length
      return { written, errors, warnings, lintPrinted: 0, manifest: this.manifest, sizes: [], durationMs: Date.now() - start, cssOnly: this.cssOnlyTracking ? null : undefined }
    }

    if (!existsSync(this.outputDir)) mkdirSync(this.outputDir, { recursive: true })

    // PHASE A : compiler TOUTES les unités en mémoire, le cœur est encore INCONNU
    // (`this.coreHashedPath = ''`, jamais lu pendant cette phase — cf. placeholderPath()
    // partout où un chemin définitif manque). Reset des accumulateurs ci-dessous, au
    // même rythme que emittedThisCompile ci-dessus (jamais d'état d'un tour à l'autre).
    this.pendingUnits = new Map()
    this.bundleVirtualSources = new Map()
    this.bundleLazyStems = new Set()
    this.pendingFeatures = new Set()
    this.pendingSkeletonTargets = new Set()
    this.pendingCoreCalls = new Set()
    this.pendingMinifyTasks = []
    this.coreHashedPath = ''

    // 2. Composants .mjs — parallélisation via `parallelMap` AVEC limite stricte.
    //
    // **Pourquoi parallelMap, pas Promise.allSettled** : sans limite, on lance
    // 474 promesses en // qui retiennent toutes leurs payloads (file content,
    // preResolved assets, closures async). Sur 474 × ~100 KB par closure
    // ouverte → multi-GB de pression mémoire master → OOM-kill.
    //
    // `parallelMap(PARALLEL_LIMIT)` traite N à la fois ; les autres attendent
    // sans payload en mémoire. Mémoire bornée par ~N × taille fichier.
    this.manifest = {}
    this.recoveredFiles = new Map()
    this.usedAnimations.clear()
    this.definedAnimations.clear()
    this.requestedSharedSheets.clear()
    this.viewRequestedSheets.clear()
    this.pendingSectionWarnings = []
    this.pendingModuleWarnings  = new Map()
    this.pendingTagRefs = []
    this.tagRefsComplete = false
    this.pageTools       = null
    this.coreParts       = { dropped: new Set(), kept: new Set() }
    this.pendingComponentDeps = []
    this.pendingFxDeps = new Map()
    this.fxChunkPaths = new Map()
    this.groupPaths = new Map()
    this.groupReport = []
    this.groupInfo = []
    this.preloadCalled = false
    this.msgFileNames = new Map()
    this.manifestDeps = {}
    this.pendingLayoutNames = new Map()
    this.pendingVarData = []
    this.pendingStoreTypes = []
    // `*.theme.mjs` : ce ne sont PAS des composants (aucun custom element, aucun tag),
    // juste des paquets de variables posés sur un sélecteur d'attribut. Compilés à part,
    // dans le master : ils sont peu nombreux et minuscules, un aller-retour worker
    // coûterait plus cher que le travail lui-même.
    // findFiles() peut désormais lever (symlink évadé de sourceDir) :
    // capturé ici comme les autres étapes, tousMjs reste vide plutôt qu'un rejet non attrapé
    // de compile() entier — le build échoue quand même (errors non vide), jamais un silence.
    let tousMjs: string[] = []
    try {
      tousMjs = this.findFiles(this.sourceDir, ['.mjs'])
        .filter(f => !basename(f, '.mjs').startsWith('_'))
    } catch (e: any) {
      errors.push(e)
    }
    const themeFiles = tousMjs.filter(isThemeFile)
    const typesFiles   = tousMjs.filter(isTypesFile)
    const effectsFiles = tousMjs.filter(isEffectsFile)
    const mjsFiles     = tousMjs.filter(f => !isThemeFile(f) && !isTypesFile(f) && !isEffectsFile(f))
    // les modèles en fichier (`carte.compacte.mjs`), du projet et du cœur : connus AVANT toute
    // transpilation — `<@carte layout="compacte">` devient la balise du modèle
    {
      const dev  = collectFileModels(mjsFiles)
      let   core = { models: {} as Record<string, string[]>, problems: [] as string[] }
      try {
        core = collectFileModels(this.findFiles(this.coreModulesDir, ['.mjs']).filter(f => !basename(f, '.mjs').startsWith('_')))
      } catch {
        // pas de catalogue cœur lisible : la résolution des balises <@@x> le dira à son tour
      }
      this.componentModels = { dev: this.modelsWithShortAliases(mjsFiles, dev.models), core: core.models }
      if (dev.problems.length > 0) errors.push(new Error(dev.problems.join('\n')))
    }
    this.typedStores = this.collectTypedStores(mjsFiles)
    // une faute dans un *.theme.mjs (nom invalide, bloc manquant…) est une erreur du build, jamais un rejet de compile() :
    // `mjs dev` reçoit son rappel et affiche l'erreur, les thèmes du dernier tour réussi restent publiés
    try {
      this.compileThemeFiles(themeFiles)
    }
    catch (e: any) {
      errors.push(e)
    }
    // une faute dans un *.types.mjs est une erreur du build, jamais une exception qui arrête
    // `mjs dev` : les règles d'avant (s'il y en a) restent en place, les composants qui citent
    // une règle disparue le diront à leur tour
    try {
      this.compileTypesFiles(typesFiles)
    }
    catch (e: any) {
      errors.push(e)
    }
    // même contrat pour les *.effects.mjs : une faute est une erreur du build, jamais un arrêt
    try {
      errors.push(...this.compileEffectsFiles(effectsFiles, warnings))
      await this.resolveEffectsImages()
      this.tableAliases(mjsFiles)
    }
    catch (e: any) {
      errors.push(e)
    }
    // un composant SUPPRIMÉ depuis le dernier compile (son tag disparaît
    // du manifest) est un changement structurel, jamais "css-only" : au moindre
    // doute, on disqualifie le lot entier (repli reload complet).
    if (this.cssOnlyTracking) {
      const currentSet = new Set(mjsFiles)
      for (const prevFile of this.lastComponentData.keys()) {
        if (!currentSet.has(prevFile)) {
          this.cssOnlyDisqualified = true
          this.lastComponentData.delete(prevFile)
        }
      }
    }
    // découverte des modules autonomes REMONTÉE ici (leur compilation, elle, reste en
    // section 3 plus bas) : le compte de fichiers du projet doit être connu AVANT de
    // compiler le premier composant, pour savoir si ce compile démarre des threads ou non.
    // findFiles() peut lever (symlink évadé de sourceDir) : capturé comme tousMjs ci-dessus.
    let scriptFiles: string[] = []
    try {
      scriptFiles = this.findFiles(this.sourceDir, ['.civet', '.coffee'])
    } catch (e: any) {
      errors.push(e)
    }
    // Petit projet = transpilation dans le processus principal, aucun thread (cf. INLINE_LIMIT).
    // Décidé à CHAQUE compile, watch compris : un projet qui grandit bascule au tour suivant.
    this.inlineTranspile = (mjsFiles.length + scriptFiles.length) <= this.inlineTranspileLimit
    // le stem de chaque module, connu avant que le premier composant n'en `@import`e un (deux modules de même nom dans deux dossiers) ;
    // un module au nom refusé sort de la construction, avec une erreur qui le nomme
    const refusedModules = this.assignModuleStems(scriptFiles)
    if (refusedModules.length > 0) {
      for (const r of refusedModules) errors.push(new Error(t('bundler.index.module-nom-invalide', { fichier: r.file, nom: r.stem })))
      const refuses = new Set(refusedModules.map(r => r.file))
      scriptFiles = scriptFiles.filter(f => !refuses.has(f))
    }

    const mjsResults = await parallelMap(
      mjsFiles,
      async (file) => ({ file, hashedPath: await this.compileMjs(file) }),
      PARALLEL_LIMIT,
    )
    for (let i = 0; i < mjsResults.length; i++) {
      const r = mjsResults[i]
      const file = mjsFiles[i]
      if (r.status === 'fulfilled') {
        const { hashedPath } = r.value
        // `x.page.mjs` et `x.mjs` publient donc la MÊME clé 'x' : la collision
        // ci-dessous (claimBasename) les traite exactement comme deux basenames identiques.
        const baseName = pageAwareBaseName(file)
        const shortName = this.shortModuleName(file)
        // Détection de collision : deux .mjs qui publient la MÊME clé de
        // manifest (basename OU shortName) se disputent `µ.paths[clé]`.
        // L'autoloader ne pourra résoudre qu'UN des deux (le dernier écrit)
        // → l'autre composant ne s'upgradera jamais, silencieusement. Cas
        // typique basename : `tuto-canvas.mjs` dupliqué dans deux dossiers.
        //
        // Cette détection ne portait
        // QUE sur `baseName` : la clé `shortName` (préfixe de dossier ancêtre
        // strippé, cf. shortModuleName) était écrite dans `this.manifest`
        // SANS AUCUNE vérification. Exemple réel : `doc/doc-intro.mjs`
        // publie le shortName `intro` (préfixe `doc-` strippé) — si le projet
        // a AUSSI un `intro.mjs` authentique ailleurs (basename `intro` lui
        // aussi), les deux se disputent `manifest['intro']` SANS AUCUN
        // WARNING, celui compilé en dernier écrasant silencieusement l'autre.
        // Fix : un SEUL registre de "qui a publié quelle clé" (`manifestSources`,
        // déjà existant) est maintenant consulté pour LES DEUX clés — basename
        // ET shortName — peu importe laquelle des deux entre en collision
        // avec laquelle.
        // Basename AUTORITAIRE (collision réelle =
        // warning dur, inchangé) vs shortName = alias de confort qui CÈDE ou
        // s'AUTO-ANNULE (empoisonne) sur contention, jamais d'écrasement muet,
        // jamais de warning bloquant. Remplace l'ancien checkAndClaim qui
        // traitait les 2 clés à l'identique et criait sur un simple
        // recouvrement d'alias court (cas doc-search / tuto-search, latent).
        const claimBasename = (key: string) => {
          const prev     = this.manifestSources.get(key)
          const prevKind = this.manifestKinds.get(key)
          if (prev && prev !== file && prevKind === 'basename') {
            this.lintPush(warnings, 'collision', t('bundler.index.collision-basename-tag', { cle: key, prev, fichier: file }))
          }
          // un vrai composant reprend toujours la clé, même sur un alias cédé/empoisonné
          this.manifestSources.set(key, file)
          this.manifestKinds.set(key, 'basename')
          this.manifest[key] = hashedPath
        }
        const claimShortName = (key: string) => {
          const prevKind = this.manifestKinds.get(key)
          // déjà tenu par un vrai composant, ou déjà empoisonné → l'alias cède en silence
          // (un 3e prétendant sur une clé déjà empoisonnée rejoint quand même la liste des rivaux)
          if (prevKind === 'basename') return
          if (prevKind === 'poisoned') { this.notePoisonedAlias(key, file); return }
          const prev = this.manifestSources.get(key)
          if (!prev || prev === file) {
            this.manifestSources.set(key, file)
            this.manifestKinds.set(key, 'shortName')
            this.manifest[key] = hashedPath
            return
          }
          // 2 alias courts se disputent la clé → AMBIGU : on n'en publie AUCUN.
          // Les 2 composants restent joignables par leur tag qualifié mjs-<basename>.
          // Sûr par construction → PAS de warning ICI (seul un gabarit qui écrit VRAIMENT la
          // balise courte en reçoit un, cf. resolveTagShortcuts).
          delete this.manifest[key]
          this.notePoisonedAlias(key, prev)
          this.notePoisonedAlias(key, file)
          this.manifestSources.set(key, file)
          this.manifestKinds.set(key, 'poisoned')
        }
        claimBasename(baseName)
        if (shortName !== baseName) claimShortName(shortName)
        // PLUS de written++ ICI : `compileMjs` ne rend qu'un REPÈRE en phase A (rien
        // n'est encore RÉELLEMENT émis) — le compteur est désormais tenu par
        // emitPendingUnits() (phase C), au moment où l'unité obtient son chemin final
        // (cache-hit confirmé ou écriture réussie). Compter ici EN PLUS aurait doublé
        // `written` pour chaque composant du projet.
      } else {
        errors.push(new Error(t('bundler.index.erreur-fichier', { fichier: file, raison: r.reason?.message ?? r.reason })))
        // Composant en échec ce tour : tente de repêcher son entrée de
        // l'ancien manifeste (cf. commentaire détaillé de la méthode) plutôt
        // que de laisser le tag <mjs-baseName> pointer dans le vide.
        this.recoverFailedComponentManifest(file, warnings)
      }
    }
    // Fusion des warnings de section accumulés pendant
    // le parallelMap ci-dessus (composants ET partials <@include> inclus).
    warnings.push(...this.pendingSectionWarnings)
    // `"lint": { "emptyComponent": "error" }` : un composant sans HTML fait échouer le build
    if (this.lint?.emptyComponent === 'error') {
      const vides = warnings.filter(w => w.endsWith('[lint.emptyComponent]'))
      for (const w of vides) {
        warnings.splice(warnings.indexOf(w), 1)
        errors.push(new Error(w))
      }
    }

    // 2a-bis. Résolution du raccourci UNIQUE <@nom> (projet PUIS
    // cœur) : garde-fous sur le manifeste (noms réservés/core-), balises
    // littérales mjs-*/mjs-core-*, raccourcis inconnus et <@mjs-nom> (erreur
    // de migration), compilation transitive des modules cœur référencés.
    // APRÈS le manifeste complet (seul point où l'union de TOUS les
    // composants du projet est connue) — AVANT les modules (qui peuvent en
    // référencer transitivement, cf. étape suivante).
    try {
      // valeur de retour (nombre de modules cœur transitifs COMPILÉS) plus additionnée
      // à `written` : ces modules compilent désormais via compileMjs() → REPÈRE (rien de RÉEL
      // n'est encore émis en phase A) — ils rejoignent this.pendingUnits comme un composant
      // ordinaire et sont comptés par emitPendingUnits() en phase C. Les additionner ICI EN
      // PLUS aurait doublé `written` pour chaque module cœur transitif.
      await this.resolveTagShortcuts(errors, warnings)
    } catch (e: any) {
      errors.push(e)
    }
    // 2a-ter. Règles des stores (`$$x` dans un <vars>) : un store vaut pour toute l'appli, sa
    // règle aussi — APRÈS tous les composants, modules cœur transitifs compris
    this.checkStoreTypes(errors)

    // 3. Modules autonomes (.civet par défaut, .coffee accepté pour rétrocompat) —
    // DÉPLACÉE ici, AVANT le cœur (ancienne étape « 3 », après animations/styles/
    // computeVarRegistry) : les modules rendent désormais un REPÈRE, comme les composants
    // .mjs — leur compilation ne dépend d'aucune connaissance du cœur. Même protection
    // mémoire que pour les .mjs (cf. parallelMap supra). Même capture que tousMjs ci-dessus
    // (findFiles peut lever).
    const scriptResults = await parallelMap(
      scriptFiles,
      async (file) => {
        const ext = (file.endsWith('.civet') ? '.civet' : '.coffee') as '.civet' | '.coffee'
        return { file, ext, hashedPath: await this.compileScriptModule(file, ext) }
      },
      PARALLEL_LIMIT,
    )
    for (let i = 0; i < scriptResults.length; i++) {
      const r = scriptResults[i]
      const file = scriptFiles[i]
      if (r.status === 'fulfilled') {
        const { ext, hashedPath } = r.value
        const baseName = this.moduleStem(file, ext)
        // Détection de collision (mêmes règles que pour les .mjs en section 2).
        // Cas vécu : `attachments.module.civet` présent dans deux tutos → les
        // deux compiles concurrents partagent le mangleCache → 2 hashes
        // différents → écrasement disque + le .mjs qui @import-e via le
        // manifest référence un fichier supprimé → import 404 silencieux.
        const previousSource = this.manifestSources.get(baseName)
        // un composant du même nom (`cart.mjs` et `cart.civet`) : le module prendrait sa place, le composant ne serait jamais
        // écrit et sa balise resterait inerte — la construction s'arrête, l'erreur nomme les deux fichiers
        if (previousSource && previousSource !== file && this.manifestKinds.get(baseName) === 'basename') {
          errors.push(new Error(t('bundler.index.collision-composant-module', { nom: baseName, composant: previousSource, module: file })))
        }
        else if (previousSource && previousSource !== file) {
          this.lintPush(warnings, 'collision', t('bundler.index.collision-basename-module', { nom: `${baseName}${ext}`, precedent: previousSource, fichier: file }))
        }
        this.manifestSources.set(baseName, file)
        this.manifest[baseName] = hashedPath
        // PLUS de written++ ICI, même raison que pour les composants .mjs ci-dessus
        // (compileScriptModule ne rend qu'un REPÈRE en phase A ; emitPendingUnits compte en
        // phase C, au moment de l'émission réelle).
      } else {
        errors.push(new Error(t('bundler.index.erreur-fichier', { fichier: file, raison: r.reason?.message ?? r.reason })))
      }
    }

    // les avertissements des modules autonomes, compilés après la mise en commun de ceux des composants (cf. pendingModuleWarnings)
    for (const file of [...this.pendingModuleWarnings.keys()].sort()) warnings.push(...this.pendingModuleWarnings.get(file)!)

    // 3b. Manifest externe (require / require_dir / require_tree) : lecture des
    // directives + compilation coffee/civet en phase A (prepareExternalManifest, ex-
    // bundleExternalManifest) ; son émission rejoint l'unique boucle topologique de la
    // phase C (cf. plus bas), comme les composants et modules.
    try {
      await this.prepareExternalManifest()
    } catch (e: any) {
      errors.push(e)
    }

    // 3e. Feuilles partagées demandées : crash-si-feuille-absente, indépendant du
    // cœur (reste en phase A, comme avant) — une feuille manquante doit faire échouer le
    // build AVANT même de savoir quelles briques du cœur sont nécessaires.
    try {
      this.validateSharedSheets()
    } catch (e: any) {
      errors.push(e)
    }

    // Minification DIFFÉRÉE de toutes les unités de la phase A (composants, modules cœur
    // transitifs, modules .civet/.coffee, manifeste externe) — SÉQUENTIELLE, triée par
    // stem (cf. flushPendingMinifyTasks()) : le cœur (juste après) doit trouver le
    // mangleCache dans un état TOUJOURS identique d'un build à l'autre, peu importe l'ordre
    // réel d'achèvement des transpilations parallèles qui précèdent. Juste avant : les noms que
    // les unités portent par nom sur une instance sont réservés dans ce cache (première
    // minification du tour, cf. reserveInstanceNames()).
    try {
      if (this.shouldMinify()) this.reserveInstanceNames()
      await this.flushPendingMinifyTasks()
    } catch (e: any) {
      errors.push(e)
    }

    // une feuille de mise en page tomberait sur un fichier de l'auteur (cf. refusFichierAuteur) : ni le cœur ni les unités ne
    // sont écrits, rien n'est publié — le registre suit seulement ce que la phase A a pu écrire (copies d'images)
    if (this.authorRefusals.size > 0) {
      errors.push(...this.authorRefusals.values())
      this.authorRefusals.clear()
      try {
        this.writeOutputsRegistry()
      } catch (e: any) {
        errors.push(e)
      }
      warnings.push(...this.pendingAssetWarnings.sort())
      this.lastCompileErrors = errors.length
      return { written, errors, warnings, lintPrinted: this.lintPrintedByTranspiles, manifest: this.manifest, sizes: this.collectSizes(), durationMs: Date.now() - start, cssOnly: this.cssOnlyTracking ? null : undefined }
    }

    // PHASE B : le cœur, D'APRÈS LES SIGNAUX COMPILÉS de toutes les unités déjà en
    // mémoire (composants, modules, manifeste externe, cache-hits candidats) — PLUS le
    // signal fichier variant déposé à la main (cf. collectUsedFeatures(), qui remplace
    // l'ancien balayage textuel de sourceDir) : un motif dans un commentaire HTML ou une
    // chaîne ne peut plus faire illusion, et aucune forme compilée ne peut plus être ratée.
    try {
      const used = this.collectUsedFeatures()
      this.preloadCalled = used.has(AUTOLOADER_MENTION) && used.has(PRELOAD_MENTION)
      this.coreHashedPath = await this.bundleRuntime(used)
      written++
      // le code de chaque effet écrit, dans son propre fichier (cf. compileFxChunks) : il importe le
      // cœur, qu'on vient d'écrire
      written += await this.compileFxChunks(used)
      written += this.compileMessageFiles()
    } catch (e: any) {
      errors.push(e)
    }
    // cœur en échec (fichier du runtime absent, contrat rompu, module demandé introuvable…) : chaque unité importerait un cœur
    // qui n'existe pas. Rien de ce tour n'est émis ni publié, en développement comme en build — le manifeste et les fichiers
    // qu'il nomme restent ceux du dernier build réussi, les anciennes empreintes attendent le prochain. Seul le registre des
    // sorties suit ce que ce tour a pu écrire (copies d'images de la phase A)
    if (this.coreHashedPath === '') {
      try {
        this.writeOutputsRegistry()
      } catch (e: any) {
        errors.push(e)
      }
      warnings.push(...this.pendingAssetWarnings.sort())
      this.lastCompileErrors = errors.length
      return { written, errors, warnings, lintPrinted: this.lintPrintedByTranspiles, manifest: this.manifest, sizes: this.collectSizes(), durationMs: Date.now() - start, cssOnly: this.cssOnlyTracking ? null : undefined }
    }

    // PHASE C : émettre, dans l'ordre des dépendances. Le cœur est désormais CONNU
    // (`this.coreHashedPath`) — styles et animations gardent leur chemin réel EN DUR
    // (cf. leurs propres méthodes), ils n'embarquent jamais qu'un import
    // du cœur, jamais d'une autre unité. Composants/modules/manifeste externe, eux,
    // embarquent potentiellement le chemin d'une AUTRE unité (module @import-é) : ils
    // rejoignent l'émission topologique plus bas (cf. emitPendingUnits()).

    // 10. Styles partagés (référencés via @css name) — mode 'bundle' : bundleSharedStyles()
    // écrit directement mjs_styles-<hash>.js ; mode 'split'/'lazy' : emitSplitStyles()/
    // emitLazyStyles() (déplacées ici depuis l'ancienne étape « 1.5 », AVANT les
    // composants) PUIS finalizeSplitStyles()/finalizeLazyStyles() (ancienne étape « 2c »,
    // APRÈS les composants) — les deux moitiés tournent désormais l'une après l'autre,
    // `requestedSharedSheets` étant déjà complet depuis la phase A.
    try {
      if (this.cssMode === 'split' || this.cssMode === 'lazy') {
        const { warnings: emitWarnings } = this.cssMode === 'split' ? await this.emitSplitStyles() : await this.emitLazyStyles()
        warnings.push(...emitWarnings)
      }
      const { count: sharedCount, warnings: sharedCssWarnings } =
        this.cssMode === 'split' ? this.finalizeSplitStyles() :
        this.cssMode === 'lazy'  ? this.finalizeLazyStyles()  :
        await this.bundleSharedStyles()
      if (sharedCount > 0) written++
      warnings.push(...sharedCssWarnings)
    } catch (e: any) {
      errors.push(e)
    }

    // 11. Compile uniquement les animations utilisées — `this.usedAnimations` est complet
    // depuis la fin de la phase A (chaque composant/module l'a alimenté).
    try {
      const { written: animWritten, missing } = await this.compileUsedAnimations()
      written += animWritten
      // Cf. le commentaire détaillé de
      // compileUsedAnimations() : une anim référencée mais absente (typo)
      // était sautée en silence ; désormais signalée explicitement.
      // une transition posée par `@in=*titre`, `@out=*titre` ou `@transition=*titre` (`.global` et `.shared` compris) que rien ne définit arrête la construction :
      // l'erreur dit où la directive s'écrit (le fichier et la ligne de sa balise, un fichier inclus compris), propose le nom le plus proche et dit comment créer
      // la transition. Un nom que seule une expression cite (`µ.anim.fadde`) n'est écrit par aucune directive : il reste un avertissement du type `animation`.
      // Un nom que l'appli définit (un alias ou un effet d'un `*.effects.mjs`) n'est jamais inconnu, d'où qu'il soit cité. Tant qu'un fichier est en erreur de compilation
      // (un module, un composant ou un fichier d'effets qui ne se compile pas), il a pu définir le nom : sa faute est dite, aucun nom introuvable n'est accusé
      const failed  = errors.length > 0
      const sources = missing.length > 0 && !failed ? this.findFiles(this.sourceDir, ['.mjs']).filter(f => !isThemeFile(f) && !isTypesFile(f) && !isEffectsFile(f)) : []
      for (const name of missing) {
        if (Object.hasOwn(this.effectDefs, name)) continue
        // une transition de la bibliothèque dont le fichier d'animation manque (un dossier d'exécution incomplet) n'est pas un nom inconnu : l'avertissement nomme le dossier
        if (failed && !EFFECTS[name]) continue
        const lieux = EFFECTS[name] ? [] : this.transitionSites(name, sources)
        if (lieux.length === 0) {
          this.lintPush(warnings, 'animation', t('bundler.index.animation-inconnue', { nom: name, dossier: join(this.runtimeDir, 'animations') }))
          continue
        }
        const proche     = this.nearestEffectName(name)
        const suggestion = proche ? t('effets.suggestion', { nom: proche }) : ''
        errors.push(new Error(t('bundler.index.transition-inconnue', { nom: name }) + t('bundler.index.animation-inconnue-lieu', { lieux: lieux.join(', '), suggestion }) + t('bundler.index.transition-inconnue-creer', { nom: name })))
      }
    } catch (e: any) {
      errors.push(e)
    }

    // 12. Registre des variables de thème $$ — APRÈS composants, thèmes ET
    // feuilles partagées (bundleSharedStyles vient de rafraîchir this.lastSharedCss/
    // lastRootCss juste au-dessus) : c'est le premier point où la vue est COMPLÈTE.
    try {
      this.computeVarRegistry(warnings)
    } catch (e: any) {
      errors.push(e)
    }

    // 13-15. Émission topologique des unités en attente (composants, modules, manifeste
    // externe) : chaque unité s'émet dès que ses dépendances (cœur, feuilles split,
    // AUTRES unités @import/µasset-ées) ont un chemin final connu ; les cache-hits
    // CANDIDATS de la phase A sont confirmés (mêmes chemins embarqués qu'à leur dernière
    // émission) ou recompilés au chemin froid s'ils sont périmés. Garde-fou intégré :
    // aucun repère ne doit survivre à l'émission (cf. emitPendingUnits()). Mode 'bundle' :
    // emitSingleFile() (miroir en mémoire, jamais le disque, cf. son bandeau).
    try {
      const { written: unitsWritten } = this.jsMode === 'bundle'
        ? await this.emitSingleFile(errors, warnings)
        : await this.emitPendingUnits(errors, warnings)
      written += unitsWritten
    } catch (e: any) {
      errors.push(e)
    }

    // 15b. Garde-fou : après résolution des repères, toute valeur de `this.manifest` (hors
    // `__styles`/`__animations`, jamais un repère — bundleSharedStyles()/
    // compileUsedAnimations() gardent le chemin réel du cœur EN DUR, cf. leurs propres
    // méthodes) qui contient encore `-ZZZZZ.` est une unité dont l'émission a échoué
    // (dep jamais résolu, cf. emitPendingUnits()) — `__external` INCLUS dans cette
    // vérification (son repère, lui, PASSE par l'émission topologique) : un repère ne doit
    // JAMAIS atteindre `bundle.js`. La clé est retirée, jamais publiée.
    for (const [key, value] of Object.entries(this.manifest)) {
      if (key === '__styles' || key === '__animations') continue
      if (this.hasUnresolvedPlaceholder(value)) {
        errors.push(new Error(t('bundler.index.repere-jamais-resolu-manifeste', { cle: key })))
        delete this.manifest[key]
      }
    }

    // 3b-bis. Un composant repris de l'ancien manifeste ne reste que s'il tourne encore (cf. confirmRecoveries)
    this.confirmRecoveries(warnings)

    // 3c. i18n façon Rails — rien fait si `sourceDir/i18n/`
    // est absent (`this.i18nManifestData` reste `undefined`, cf. writeManifest()).
    try {
      const { warnings: i18nWarnings } = this.scanI18n()
      warnings.push(...i18nWarnings)
    } catch (e: any) {
      errors.push(e)
    }

    // 3d. Table des dépendances DIRECTES du manifeste (préchargement, cf.
    // writeManifest/µDeps) — APRÈS la section 3 (modules .civet/.coffee, `@import`-és
    // par les composants) ET resolveTagShortcuts (modules cœur transitifs) : c'est ICI
    // le premier point où `this.manifestSources` contient VRAIMENT tout ce qu'un
    // composant peut nommer (balise OU cible `@import`), jamais avant.
    try {
      this.manifestDeps = this.buildManifestDeps()
    } catch (e: any) {
      errors.push(e)
    }

    // 3e. groupes de fichiers (`bundles`) : assemblés ICI, après la table des dépendances qu'ils
    // parcourent et avant le manifeste qui repointe leurs composants. Production seulement.
    try {
      if (this.bundlesConf && Object.keys(this.bundlesConf).length > 0) {
        if (this.jsMode === 'bundle') {
          this.groupInfo.push(t('bundler.groupes.fichier-unique'))
        }
        else if (!this.isProd()) {
          this.groupInfo.push(t('bundler.groupes.hors-production'))
        }
        else {
          const { groups, warnings: groupWarnings } = await assembleGroups(this, this.bundlesConf)
          for (const g of groups) {
            this.groupReport.push(g)
            for (const n of g.keys) this.groupPaths.set(n, g.file)
            this.groupInfo.push(t('bundler.groupes.fichier-de-groupe', { groupe: g.name, fichier: basename(g.file), nb: g.names.length }))
          }
          warnings.push(...groupWarnings)
        }
      }
    } catch (e: any) {
      errors.push(e)
    }

    // 4. Manifest entrypoint — mode 'bundle' : writeBundleManifest() (esbuild.build() en
    // mémoire, cf. son bandeau) remplace writeManifest() ; jamais les deux.
    // Build en échec (`keepFailedComponents: false`, celui de `mjs build`) : rien n'est publié — le manifeste et les fichiers
    // qu'il nomme restent ceux du dernier build réussi, les anciennes empreintes attendent le prochain. En développement, un
    // composant en échec garde sa dernière version bonne (cf. recoverFailedComponentManifest) : le manifeste se publie.
    // feuille de mise en page refusée pendant l'émission (une unité du cache recompilée) : même erreur, rien de publié en build
    errors.push(...this.authorRefusals.values())
    try {
      if (this.keepFailedComponents || errors.length === 0) {
        for (const w of this.pendingLayoutWrites) this.writeIfChanged(w.target, w.content)
        if (this.jsMode === 'bundle') {
          await this.writeBundleManifest()
        } else {
          this.writeManifest()
        }
        // Purge différée des anciens hashes : SEULEMENT maintenant que le
        // nouveau manifeste est sur disque, jamais avant (cf. cleanupOldHashes/flushPendingHashCleanup) ;
        // le registre des sorties, consommé par pruneOrphans(), suit
        this.flushPendingHashCleanup()
        if (this.isProd()) this.retireRegistreTheme(warnings)
        written++
      }
      else {
        // rien de publié (feuilles de mise en page et fragments de traduction à nom clair compris) : le registre retient quand
        // même ce que ce tour a écrit, pour le ménage du suivant
        this.writeOutputsRegistry()
      }
    } catch (e: any) {
      errors.push(e)
    }

    // Persiste le mangleCache pour stabilité inter-builds (cache navigateur).
    this.saveMangleCache()

    // la liste des fichiers émis, avec leurs empreintes, écrite à côté
    // d'eux. Elle ne sert à RIEN au framework : elle sert à l'auteur qui veut rendre son
    // application installable. Un service worker doit savoir quoi mettre en cache, et
    // c'est le SEUL à ne pas pouvoir le deviner — les noms portent une empreinte qui
    // change à chaque build. Nous, on la connaît : autant la lui donner.
    //
    // On ne fournit AUCUN service worker : les stratégies de cache (réseau d'abord,
    // cache d'abord, péremption) sont des choix d'application, pas de framework. Cf. le
    // chapitre de doc, qui donne la recette.
    if (errors.length === 0) {
      try {
        this.writePrecacheManifest()
      } catch (e: any) {
        this.lintPush(warnings, 'precache', t('bundler.index.precache-echec', { raison: e?.message ?? String(e) }))
      }
    }

    // assetDirs : un même nom d'image dans deux dossiers (trié, l'ordre de compilation des composants n'y est pour rien)
    warnings.push(...this.pendingAssetWarnings.sort())
    const durationMs = Date.now() - start
    const sizes = this.collectSizes()
    // verdict "css-only" : jamais hors watch (undefined) ; en watch,
    // un objet non vide UNIQUEMENT si (a) zéro erreur, (b) rien n'a disqualifié
    // le lot (script/template changé, fichier/feuille ajouté-retiré…) et (c) au
    // moins un composant ou une feuille a effectivement changé ce tour-ci — un
    // lot "vide" (rien recompilé, ex. événement fs sans changement de contenu)
    // retombe sur `null` → reload complet, jamais un no-op silencieux.
    let cssOnly: CssOnlyPayload | null | undefined
    if (this.cssOnlyTracking) {
      // Filet CENTRAL (cf. lastWrittenHashes) : toute émission writeHashed dont le
      // hash a changé ce tour-ci et qui n'est PAS attendue dans un lot css-only
      // (composant qualifié, mjs_styles) disqualifie — mjs_core (runtime édité),
      // module .civet/.coffee, mjs_anims, mjs_external, asset copié… Un fichier
      // réémis à hash IDENTIQUE (contenu inchangé) n'est jamais un changement.
      for (const [name, hp] of this.cssOnlyWrites) {
        if (this.lastWrittenHashes.get(name) !== hp && !this.cssOnlyAllowedWrites.has(name)) {
          this.cssOnlyDisqualified = true
        }
        this.lastWrittenHashes.set(name, hp)
      }
      const nonEmpty = Object.keys(this.cssOnlyComponents).length > 0 ||
        Object.keys(this.cssOnlySheets).length > 0 ||
        this.cssOnlyRoot !== undefined
      cssOnly = (errors.length === 0 && !this.cssOnlyDisqualified && nonEmpty)
        ? { components: this.cssOnlyComponents, sheets: this.cssOnlySheets, ...(this.cssOnlyRoot !== undefined ? { root: this.cssOnlyRoot } : {}) }
        : null
    }
    // pruneOrphans() — posé au tout dernier moment, une fois
    // `errors` définitivement figé pour ce tour : c'est CETTE valeur que la garde de pruneOrphans()
    // relit, jamais un `errors.length === 0` recalculé ailleurs qui pourrait diverger.
    this.lastCompileErrors = errors.length
    return { written, errors, warnings, lintPrinted: this.lintPrintedByTranspiles, manifest: this.manifest, sizes, durationMs, cssOnly }
  }

  // --------------------------------------------------------------------------
  // flushPendingMinifyTasks() : exécute les minifications DIFFÉRÉES de `this.
  // pendingMinifyTasks` — triées par `stem` (JAMAIS l'ordre d'insertion, qui suit l'ordre
  // d'achèvement ALÉATOIRE des workers de transpilation), SÉQUENTIELLEMENT (jamais
  // `Promise.all` : le `mangleCache` esbuild est un état PARTAGÉ entre tous ces appels, un
  // même déterminisme d'ORDRE D'APPEL est ce qui rend le nom court d'une propriété `_mjs_*`
  // reproductible d'un build à l'autre). Appelée une fois à la fin de la phase A (avant que
  // le cœur ne soit minifié à son tour, phase B) et une fois pour chaque vague d'unités
  // périmées recompilées en phase C (cf. emitPendingUnits()).
  // --------------------------------------------------------------------------
  private async flushPendingMinifyTasks(): Promise<void> {
    const tasks = [...this.pendingMinifyTasks].sort((a, b) => a.stem < b.stem ? -1 : a.stem > b.stem ? 1 : 0)
    this.pendingMinifyTasks = []
    for (const task of tasks) await task.run()
  }

  // --------------------------------------------------------------------------
  // reserveInstanceNames() : réserve dans `this.mangleCache` les noms courts que les unités de CE
  // tour portent par nom sur une instance (clés d'état, props, méthodes — cf. le bandeau « noms
  // réservés » de minify.ts) : ceux des unités fraîches (tâches de minification en attente) ET
  // ceux des cache-hits candidats (`CacheEntry.reservedNames`) — un composant inchangé compte
  // autant qu'un composant retouché. Appelée une seule fois par compile(), en fin de phase A,
  // AVANT la première minification (unités, puis cœur, styles, animations, assemblage 'bundle',
  // qui trouvent tous le cache déjà réservé). Les unités périmées recompilées en phase C y sont
  // déjà : leur source n'a pas changé depuis leur passage en cache-hit candidat.
  //
  // Une correspondance retirée (cache pollué sur disque, ou nom apparu depuis le tour précédent en
  // surveillance) désaccorde tout code minifié AVANT avec elle : la génération avance, et chaque
  // cache-hit d'une génération antérieure est recompilé en phase C (emitPendingUnits()/
  // emitSingleFile()). Le cœur, les styles et les animations sont re-minifiés à chaque tour.
  // --------------------------------------------------------------------------
  private reserveInstanceNames(): void {
    const names = new Set<string>()
    for (const task of this.pendingMinifyTasks) {
      for (const name of task.names) names.add(name)
    }
    for (const unit of this.pendingUnits.values()) {
      if (unit.kind === 'cached') for (const name of unit.cached.reservedNames ?? []) names.add(name)
    }
    const withdrawn = reserveMangleNames(this.mangleCache, [...names].sort())
    if (withdrawn.length > 0) this.mangleGeneration++
  }

  // --------------------------------------------------------------------------
  // planColdEmissionOrder(coldQueue, finalPaths) : ordre d'émission topologique d'un pool
  // d'unités 'cold', PARTAGÉ par emitPendingUnits() et emitSingleFile() (miroirs, même
  // dépendance sur `.deps`/`finalPaths`).
  //
  // Remplace une boucle de Kahn qui rebalayait TOUTE la file à chaque ronde tant qu'au
  // moins une unité progressait (`while (coldQueue.size > 0 && progress)`) — O(n²) sur une
  // longue chaîne de dépendances (chaque ronde ne résout qu'une seule unité de plus dans le
  // pire cas, ex. u0→u1→u2→…→un). Ici : un numéro de « ronde » par unité, calculé UNE fois
  // par parcours en profondeur MÉMOÏSÉ ET ITÉRATIF — une pile EXPLICITE de frames simule
  // l'appel récursif `visit(stem)` (un frame par appel, `idx` pointant le prochain dep à
  // examiner de CE frame) plutôt que de recourir à la pile d'appels JS elle-même : sur une
  // longue chaîne dont l'ordre d'insertion s'oppose à l'ordre de dépendance (le pire cas
  // ci-dessus, justement — le tri par stem visite d'abord celle qui plonge le plus profond),
  // une version récursive descend à une profondeur proportionnelle au nombre d'unités et finit
  // par lever `RangeError: Maximum call stack size exceeded` — le tour ENTIER échoue alors,
  // avec un message qui ne nomme aucune unité, sur un volume que l'ancienne boucle O(n²)
  // traitait sans aucune limite de profondeur (juste plus lentement).
  //
  // Sémantique de round/blocked/visiting INCHANGÉE par ce passage à l'itératif — chaque frame
  // reproduit exactement les 3 vérifications de mémoïsation faites en tête de l'ancien
  // `visit(stem)` récursif, mais appliquées à CHAQUE dépendance avant de pousser un nouveau
  // frame plutôt que par un appel qui les referait lui-même : deps déjà en `finalPaths` →
  // aucune ronde requise ; dep 'cold' dont la POSITION dans `coldQueue` précède la nôtre →
  // même ronde que lui, la boucle d'origine le voyait déjà résolu en le croisant plus tôt dans
  // SON propre balayage ; dep 'cold' dont la position nous précède → une ronde de plus que lui,
  // la boucle d'origine ne le redécouvrait qu'au balayage SUIVANT. Un cycle (dep encore
  // `visiting`, sur la pile) ou une dépendance qui ne correspond à aucune unité ni à aucune
  // entrée de `finalPaths` rend l'unité — et tout ce qui en dépend, par propagation le long de
  // la pile — à jamais sans ronde : reportées en fin de liste, elles échoueront de toute façon
  // leur propre vérification `deps.every(...)` chez l'appelant. Trie enfin par (ronde,
  // position) : EXACTEMENT l'ordre observable de l'ancienne boucle (vérifié par
  // tests/bundler-emit-topological-order.test.ts, qui compare aussi l'itératif à l'ancienne
  // boucle O(n²) sur des centaines de graphes générés).
  // --------------------------------------------------------------------------
  private planColdEmissionOrder(
    coldQueue: Map<string, Extract<PendingUnit, { kind: 'cold' }>>,
    finalPaths: Map<string, string>
  ): string[] {
    const posOf = new Map<string, number>()
    let i = 0
    for (const stem of coldQueue.keys()) posOf.set(stem, i++)

    const round = new Map<string, number>()
    const blocked = new Set<string>()
    const visiting = new Set<string>()

    // un frame = un appel de l'ancien `visit(stem)` récursif : `idx` reprend au dep suivant à
    // chaque tour de la boucle `while`, `r`/isBlocked` sont les accumulateurs LOCAUX à cet appel
    // (équivalent des variables locales `r`/`isBlocked` de la version récursive).
    type Frame = { stem: string; deps: readonly string[]; idx: number; r: number; isBlocked: boolean }

    const visit = (start: string): void => {
      if (blocked.has(start) || round.has(start) || visiting.has(start)) return
      const stack: Frame[] = [{ stem: start, deps: coldQueue.get(start)!.deps, idx: 0, r: 1, isBlocked: false }]
      visiting.add(start)
      while (stack.length > 0) {
        const frame = stack[stack.length - 1]
        if (frame.idx >= frame.deps.length) {
          // tous les deps de CE frame examinés : finalise, comme la fin de l'ancienne boucle for
          stack.pop()
          visiting.delete(frame.stem)
          if (frame.isBlocked) blocked.add(frame.stem)
          else round.set(frame.stem, frame.r)
          continue
        }
        // PEEK (pas de ++ ici) : un dep encore non résolu pousse un nouveau frame plus bas SANS
        // avancer `idx` — ce même dep est réexaminé une fois ce frame de retour en haut de pile
        // (round/blocked alors renseigné), exactement comme le retour d'un appel `visit(d)`
        // récursif AVANT que la ligne appelante ne calcule sa contribution. Chaque AUTRE branche
        // résout `d` sur-le-champ (aucun frame poussé) : `idx` y avance immédiatement.
        const d = frame.deps[frame.idx]
        if (finalPaths.has(d)) { frame.idx++; continue }                              // déjà résolu avant ce tour
        if (!coldQueue.has(d)) { frame.isBlocked = true; frame.idx++; continue }       // dep jamais résolue
        if (blocked.has(d)) { frame.isBlocked = true; frame.idx++; continue }
        if (round.has(d)) {
          const contrib = posOf.get(d)! < posOf.get(frame.stem)! ? round.get(d)! : round.get(d)! + 1
          if (contrib > frame.r) frame.r = contrib
          frame.idx++
          continue
        }
        if (visiting.has(d)) { blocked.add(d); frame.isBlocked = true; frame.idx++; continue }   // cycle : reboucle sur un stem en cours
        visiting.add(d)
        stack.push({ stem: d, deps: coldQueue.get(d)!.deps, idx: 0, r: 1, isBlocked: false })
      }
    }

    for (const stem of coldQueue.keys()) visit(stem)

    return [...coldQueue.keys()].sort((a, b) => {
      const ra = blocked.has(a) ? Infinity : round.get(a)!
      const rb = blocked.has(b) ? Infinity : round.get(b)!
      return ra !== rb ? ra - rb : posOf.get(a)! - posOf.get(b)!
    })
  }

  // --------------------------------------------------------------------------
  // emitPendingUnits() : phase C, étapes § 3.13-3.14 de la conception. `this.
  // pendingUnits` contient TOUTES les unités de ce tour (composants .mjs, modules .civet/
  // .coffee, manifeste externe), chacune 'cold' (code prêt, repères non résolus) ou
  // 'cached' (cache-hit CANDIDAT posé en phase A, pas encore confirmé).
  //
  // 1. Chaque 'cached' est confirmée SI `cached.embeds` (chemins réels embarqués à sa
  //    dernière émission : cœur + feuilles split déclarées) est ÉGAL à la liste COURANTE
  //    (`embedsNow`, déjà connue — cœur et feuilles split viennent d'être émis avant
  //    l'appel) → rien à écrire, chemin final = `cached.hashedPath`. Sinon → PÉRIMÉE :
  //    recompilée ICI par le chemin froid (`compileMjsCold`/`compileScriptModuleCold`,
  //    `silent: true` — ne repousse pas les métadonnées déjà hydratées en phase A),
  //    rejoint le pool 'cold'.
  // 2. Tri topologique (planColdEmissionOrder ci-dessus) : une unité 'cold' s'émet
  //    (`writeHashed`) dès que tous ses `deps` (stems dont son code contient le repère) ont
  //    un chemin final connu. Une unité dont un dep n'est JAMAIS résolu (dep en échec, cycle
  //    qui aurait échappé à `compileWithDedup`) → erreur nommant l'unité et le dep manquant,
  //    et `recoverFailedComponentManifest` pour un composant — même sort qu'un échec de
  //    compilation classique.
  // --------------------------------------------------------------------------
  private async emitPendingUnits(errors: Error[], warnings: string[]): Promise<{ written: number }> {
    let written = 0
    const finalPaths = new Map<string, string>()
    // jamais un chemin vide : une unité qui dépend d'un cœur absent échoue nommément au lieu d'importer ''
    if (this.coreHashedPath !== '') finalPaths.set('mjs_core', this.coreHashedPath)
    // les fichiers d'effets, écrits juste après le cœur (cf. compileFxChunks)
    for (const [k, path] of this.fxChunkPaths) finalPaths.set(k, path)
    if (this.cssMode === 'split') {
      for (const [name, path] of Object.entries(this.splitStyleHashedPaths)) finalPaths.set(this.splitStyleStem(name), path)
      if (this.splitRootHashedPath) finalPaths.set('mjs_style_root', this.splitRootHashedPath)
    }
    // chemins réels EMBARQUABLES ce tour-ci (cœur, fichiers d'effets, feuilles split), par stem : un cache-hit CANDIDAT reste
    // valide tant que chaque chemin qu'il embarque (`cached.embeds`) en fait encore partie — une feuille retouchée ou un effet
    // apparu ne périme que les unités qui les citent, jamais les autres ; le cœur reste dans chaque liste
    const embeddable = new Map(finalPaths)
    const embedsNow  = new Set(finalPaths.values())

    const coldQueue = new Map<string, Extract<PendingUnit, { kind: 'cold' }>>()
    // tri par stem — jamais l'ordre d'insertion (qui suivrait l'ordre d'achèvement
    // ALÉATOIRE des transpilations de la phase A) : par cohérence avec
    // flushPendingMinifyTasks(), qui est le VRAI point où le déterminisme du mangling se
    // joue, mais aussi pour que la RECOMPILATION d'unités périmées ci-dessous (qui pousse
    // elle aussi des tâches dans pendingMinifyTasks) parte d'un ordre prévisible.
    const sortedPending = [...this.pendingUnits].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)
    const staleStems: string[] = []
    for (const [stem, unit] of sortedPending) {
      if (unit.kind === 'cold') { coldQueue.set(stem, unit); continue }
      const cachedEmbeds = unit.cached.embeds ?? []
      const same = cachedEmbeds.every(v => embedsNow.has(v)) && (this.coreHashedPath === '' || cachedEmbeds.includes(this.coreHashedPath))
      // noms courts accordés au cache de CE tour : une correspondance retirée depuis sa
      // minification (cf. reserveInstanceNames()) le rend périmé, même si le cœur, lui, garde
      // son chemin (propriété absente du cœur, partagée entre unités)
      const sameNames = unit.cached.mangleGen === this.mangleGeneration
      if (same && sameNames) {
        finalPaths.set(stem, unit.cached.hashedPath)
        this.emittedThisCompile.add(basename(unit.cached.hashedPath))
        this.keepCachedAssets(unit.cached)
        if (unit.cached.gen !== this.compileGeneration) this.cacheHitsThisCompile++ // pruneOrphans() — seul un hit INTER-compile compte
        written++
        continue
      }
      // PÉRIMÉE (cœur ou feuille split changé depuis sa dernière émission, ou correspondance de
      // nom court retirée) : recompilée au chemin froid, silent (métadonnées déjà hydratées en
      // phase A) — pousse une minification DIFFÉRÉE (cf. compileMjsCold/compileScriptModuleCold),
      // relue après le flush groupé ci-dessous, jamais avant.
      try {
        if (unit.file.endsWith('.mjs')) {
          await this.compileMjsCold(unit.file, stem, undefined, { silent: true })
        } else {
          await this.recompileScriptModuleCold(unit.file, stem)
        }
        staleStems.push(stem)
      } catch (e: any) {
        errors.push(e)
        if (unit.file.endsWith('.mjs')) this.recoverFailedComponentManifest(unit.file, warnings)
      }
    }
    // Minification DIFFÉRÉE des unités PÉRIMÉES recompilées ci-dessus — même flush
    // séquentiel trié par stem que la phase A (cf. flushPendingMinifyTasks()), AVANT de
    // relire `this.pendingUnits` : sans ce flush, `fresh` resterait encore l'ANCIENNE
    // entrée 'cached' (kind jamais mis à jour tant que la tâche différée n'a pas tourné).
    if (staleStems.length > 0) {
      await this.flushPendingMinifyTasks()
      for (const stem of staleStems) {
        const fresh = this.pendingUnits.get(stem)
        if (fresh && fresh.kind === 'cold') coldQueue.set(stem, fresh)
      }
    }

    // Tri topologique (cf. planColdEmissionOrder) : chaque unité est tentée dans CET ordre.
    // Un repère résiduel amont (dep qui a lui-même échoué juste en dessous) fait échouer en
    // cascade tous ses dépendants — ils ne rejoignent jamais `finalPaths`, donc échouent au
    // même test `deps.every(...)` sans qu'il faille les redétecter explicitement : l'ordre
    // calculé place TOUJOURS un dep avant son dépendant (cf. bandeau de la méthode).
    const reportedDirectly = new Set<string>()
    for (const stem of this.planColdEmissionOrder(coldQueue, finalPaths)) {
      const unit = coldQueue.get(stem)!
      if (!unit.deps.every(d => finalPaths.has(d))) continue
      const finalCode = this.resolvePlaceholders(unit.code, finalPaths)
      // garde-fou : un repère qui survivrait au remplacement (dep résolu mais mal formé,
      // défaut de cette méthode elle-même) ne doit JAMAIS partir sur disque.
      if (this.hasUnresolvedPlaceholder(finalCode)) {
        errors.push(new Error(t('bundler.index.repere-non-resolu-emission', { unite: stem })))
        reportedDirectly.add(stem)
        if (unit.file.endsWith('.mjs')) this.recoverFailedComponentManifest(unit.file, warnings)
        continue
      }
      const hashedPath = this.writeHashed(unit.stem, unit.ext, finalCode, unit.map)
      finalPaths.set(stem, hashedPath)
      if (unit.cacheFields) {
        const embeds = [...new Set(['mjs_core', ...unit.deps].map(d => embeddable.get(d)).filter((c): c is string => c !== undefined))].sort()
        this.cache.set(unit.file, { ...unit.cacheFields, hashedPath, embeds, features: unit.features, gen: this.compileGeneration })
      }
      written++
    }
    // dep jamais résolu (cycle échappé, unité dont la dépendance a échoué ailleurs) — erreur
    // nommant l'unité ET le dep manquant, jamais un composant silencieusement omis. Exclut les
    // unités déjà signalées ci-dessus (leur propre repère résiduel, pas une dépendance
    // manquante) — même distinction que l'ancienne file, qui les retirait de coldQueue au lieu
    // de les laisser retomber ici. Ordre de POSITION (celui de coldQueue), comme l'ancienne file
    // qui ne réordonnait jamais ses entrées restantes.
    for (const [stem, unit] of coldQueue) {
      if (finalPaths.has(stem) || reportedDirectly.has(stem)) continue
      const missing = unit.deps.filter(d => !finalPaths.has(d))
      errors.push(new Error(t('bundler.index.dep-jamais-resolue', { unite: stem, deps: missing.join(', ') })))
      if (unit.file.endsWith('.mjs')) this.recoverFailedComponentManifest(unit.file, warnings)
    }

    // Remplacement des repères dans this.manifest (valeurs) par leur chemin final — les
    // clés qui restent avec un repère non résolu sont retirées par le garde-fou de
    // compile(), juste après cet appel.
    for (const key of Object.keys(this.manifest)) {
      this.manifest[key] = this.resolvePlaceholders(this.manifest[key], finalPaths)
    }

    return { written }
  }

  // --------------------------------------------------------------------------
  // emitSingleFile() : mode js='bundle', même point d'appel qu'emitPendingUnits() (phase C,
  // que ce dernier remplace dans ce mode) — miroir de sa boucle de Kahn (mêmes repères, même
  // pool 'cold'/'cache'), mais la SORTIE d'une unité n'est JAMAIS un fichier écrit sur disque :
  // son code final rejoint `this.bundleVirtualSources` sous le spécificateur virtuel STABLE
  // 'mjs:unit/<stem>', que le plugin esbuild de writeBundleManifest() sert ensuite EN MÉMOIRE
  // (jamais le disque). « Stable » change la donne face à emitPendingUnits() : un cache-hit
  // (CacheEntry.code, cf. son bandeau) reste TOUJOURS valide, quel que soit le cœur/les styles
  // de CE tour — aucun hash d'aucune autre unité n'est jamais embarqué dans le texte d'une
  // unité, l'indirection ne se résout qu'à l'assemblage final. `CacheEntry.embeds` reste donc
  // toujours `[]` en mode bundle (rien à comparer, contrairement à son rôle en mode 'split') ;
  // la seule question est « ce cache-hit porte-t-il un `code` ? » — sinon (entrée posée par un
  // compile ANTÉRIEUR en mode 'split', ou par une instance qui vient de changer de mode),
  // recompilé au chemin froid comme une entrée périmée. Une seule exception à « TOUJOURS
  // valide » : les noms courts des propriétés `_mjs_*` SONT dans le texte de l'unité — un code
  // minifié avant qu'une réservation ne retire une de ses correspondances (`CacheEntry.mangleGen`
  // antérieur, cf. reserveInstanceNames()) appellerait le cœur de CE tour par d'anciens noms :
  // recompilé lui aussi.
  // --------------------------------------------------------------------------
  private async emitSingleFile(errors: Error[], warnings: string[]): Promise<{ written: number }> {
    let written = 0
    const finalPaths = new Map<string, string>()
    finalPaths.set('mjs_core', 'mjs:core')

    const coldQueue = new Map<string, Extract<PendingUnit, { kind: 'cold' }>>()
    // même tri par stem qu'emitPendingUnits() (jamais l'ordre d'insertion), même raison
    // (déterminisme du mangling, cf. flushPendingMinifyTasks()).
    const sortedPending = [...this.pendingUnits].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)
    const staleStems: string[] = []
    for (const [stem, unit] of sortedPending) {
      if (unit.kind === 'cold') { coldQueue.set(stem, unit); continue }
      if (unit.cached.code !== undefined && unit.cached.mangleGen === this.mangleGeneration) {
        this.bundleVirtualSources.set(stem, this.withInlineSourceMap(unit.cached.code, unit.cached.map))
        this.noteBundleLazyStems(unit.cached.code)
        finalPaths.set(stem, `mjs:unit/${stem}`)
        this.keepCachedAssets(unit.cached)
        if (unit.cached.gen !== this.compileGeneration) this.cacheHitsThisCompile++ // pruneOrphans() — cf. son propre bandeau (en bundle, seule la purge des fichiers consignés à côté du manifeste tourne)
        written++
        continue
      }
      try {
        if (unit.file.endsWith('.mjs')) {
          await this.compileMjsCold(unit.file, stem, undefined, { silent: true })
        } else {
          await this.recompileScriptModuleCold(unit.file, stem)
        }
        staleStems.push(stem)
      } catch (e: any) {
        errors.push(e)
        if (unit.file.endsWith('.mjs')) this.recoverFailedComponentManifest(unit.file, warnings)
      }
    }
    if (staleStems.length > 0) {
      await this.flushPendingMinifyTasks()
      for (const stem of staleStems) {
        const fresh = this.pendingUnits.get(stem)
        if (fresh && fresh.kind === 'cold') coldQueue.set(stem, fresh)
      }
    }

    // Tri topologique (cf. planColdEmissionOrder, PARTAGÉE avec emitPendingUnits()) : identique
    // à emitPendingUnits() dans son principe (émet dès que tous les deps ont un chemin final,
    // dans l'ordre calculé), la SORTIE seule diffère (spécificateur virtuel en mémoire, jamais
    // writeHashed).
    const reportedDirectly = new Set<string>()
    for (const stem of this.planColdEmissionOrder(coldQueue, finalPaths)) {
      const unit = coldQueue.get(stem)!
      if (!unit.deps.every(d => finalPaths.has(d))) continue
      const finalCode = this.resolvePlaceholders(unit.code, finalPaths)
      if (this.hasUnresolvedPlaceholder(finalCode)) {
        errors.push(new Error(t('bundler.index.repere-non-resolu-emission', { unite: stem })))
        reportedDirectly.add(stem)
        if (unit.file.endsWith('.mjs')) this.recoverFailedComponentManifest(unit.file, warnings)
        continue
      }
      this.bundleVirtualSources.set(stem, this.withInlineSourceMap(finalCode, unit.map))
      this.noteBundleLazyStems(finalCode)
      finalPaths.set(stem, `mjs:unit/${stem}`)
      if (unit.cacheFields) {
        this.cache.set(unit.file, { ...unit.cacheFields, hashedPath: `mjs:unit/${stem}`, embeds: [], features: unit.features, gen: this.compileGeneration, code: finalCode, map: unit.map })
      }
      written++
    }
    // même distinction qu'emitPendingUnits() : exclut les unités déjà signalées ci-dessus (leur
    // propre repère résiduel, pas une dépendance manquante).
    for (const [stem, unit] of coldQueue) {
      if (finalPaths.has(stem) || reportedDirectly.has(stem)) continue
      const missing = unit.deps.filter(d => !finalPaths.has(d))
      errors.push(new Error(t('bundler.index.dep-jamais-resolue', { unite: stem, deps: missing.join(', ') })))
      if (unit.file.endsWith('.mjs')) this.recoverFailedComponentManifest(unit.file, warnings)
    }

    // Résolution des repères dans this.manifest (valeurs) — même geste qu'emitPendingUnits(),
    // pour que le garde-fou générique de compile() (§15b) ne trouve plus rien à retirer : SEUL
    // l'ENSEMBLE des CLÉS sert en mode bundle (µ.paths, cf. buildBundleSetupBody()), la valeur
    // elle-même (un spécificateur virtuel) n'est plus jamais lue nulle part.
    for (const key of Object.keys(this.manifest)) {
      this.manifest[key] = this.resolvePlaceholders(this.manifest[key], finalPaths)
    }

    return { written }
  }

  // --------------------------------------------------------------------------
  // lazyModuleImports(code) : mode 'bundle' seulement — un `µimport` dont la cible est un module du projet
  // (.civet/.coffee : le chemin repère de SA propre unité) devient un import dynamique natif de cette unité.
  // C'est ce que l'assemblage du fichier unique sait couper : esbuild y voit un point de coupure et range le
  // module dans son propre fichier ; la phase C remplace le repère par le spécificateur virtuel de l'unité,
  // comme pour un `@import`. Un `µimport` d'un `.js` (chemin déjà à empreinte, copie brute) garde µ._mjs_import
  // — comme en fichiers séparés, où l'appel garde l'URL publiée du module. Appelée sur le code NON MINIFIÉ,
  // où l'appel porte encore son nom d'origine.
  // --------------------------------------------------------------------------
  private lazyModuleImports(code: string): string {
    if (this.jsMode !== 'bundle') return code
    const re = new RegExp(`µ\\._mjs_import\\(\\s*(['"])(${escapeRegex(this.urlPrefix)}/[^'"\\s]+?-${HASH_PLACEHOLDER}\\.js)\\1\\s*\\)`, 'g')
    return code.replace(re, (_tout, guillemet, chemin) => `import(${guillemet}${chemin}${guillemet})`)
  }

  // noteBundleLazyStems(code) : mode 'bundle' — relève les unités que ce code final charge par un import
  // dynamique (`import('mjs:unit/<stem>')`, cf. lazyModuleImports) : elles sortent du fichier unique
  // --------------------------------------------------------------------------
  private noteBundleLazyStems(code: string): void {
    for (const m of code.matchAll(/\bimport\(\s*(['"])mjs:unit\/([^'"]+)\1\s*\)/g)) this.bundleLazyStems.add(m[2])
  }

  // --------------------------------------------------------------------------
  // recoverFailedComponentManifest(file) : un composant .mjs qui échoue
  // à compiler CE tour n'obtient JAMAIS de nouvelle entrée this.manifest[baseName]
  // (reparti à `{}` en tête de compile()) — sans repli, µ.paths perd la clé alors
  // que le fichier hashé du build PRÉCÉDENT survit tel quel dans outputDir
  // (cleanupOldHashes ne se déclenche que sur un writeHashed RÉUSSI du même
  // baseName, jamais sur un composant en échec). Résultat AVANT ce fix : le tag
  // <mjs-baseName> reste dans le HTML, son import 404, écran blanc silencieux.
  //
  // Repêche l'entrée depuis l'ANCIEN bundle_modular.js écrit sur disque (même
  // mécanique d'extraction que le `pathsLineIdx` de writeManifest() : la ligne
  // `const µPaths = {...};` est TOUJOURS sur une seule ligne, JSON.stringify ne
  // produit aucun `\n`). `µ.paths = µPaths;` (plus loin dans le manifeste)
  // référence ce même objet — plus de JSON à CETTE ligne-là depuis la cascade de
  // modules (bundle.js n'importe plus le cœur statiquement, µPaths sert aussi au
  // préchargement AVANT que µ n'existe, cf. writeManifest). Réinjectée dans this.manifest AVANT que writeManifest()
  // ne génère publicManifest (section "4. Manifest entrypoint", plus loin dans
  // compile()) → survit naturellement à l'écriture.
  //
  // Recovery IMPOSSIBLE (pas d'ancien bundle, clé absente, fichier disparu du
  // disque, JSON illisible) → silencieux, comportement historique (entrée
  // absente), AUCUN crash, AUCUN message trompeur. Le composant récupéré n'est
  // volontairement PAS ajouté à `emittedThisCompile` : il n'apparaît donc pas
  // dans le tableau des tailles puisqu'il n'a rien produit ce tour (ni
  // écriture fraîche, ni cache hit — juste une lecture de l'ancien manifeste).
  // --------------------------------------------------------------------------
  private recoverFailedComponentManifest(file: string, warnings: string[]): void {
    // `pageAwareBaseName` peut
    // désormais REFUSER un nom de page vide (throw) : si c'est PRÉCISÉMENT pour cette raison que
    // `file` a échoué ce tour, cet appel planterait ICI, hors de tout try/catch (cf. l'appelant,
    // synchrone, dans la boucle principale de compile()) — le build ENTIER rejetterait au lieu de
    // rendre `stats.errors` proprement. Aucun repêchage n'a de sens sur un nom invalide de toute
    // façon (aucune ancienne entrée saine n'a jamais existé sous CE nom) : repli sur le basename
    // brut, pour le seul message qui suit.
    let baseName: string
    try { baseName = pageAwareBaseName(file) } catch { baseName = basename(file, '.mjs') }  // même clé que le compile réussi précédent
    // En build, aucun repêchage : l'ancienne sortie survit sur disque mais n'est plus
    // référencée, et l'erreur de compilation fait sortir le CLI en code non nul
    if (!this.keepFailedComponents) {
      this.lintPush(warnings, 'componentFailure', t('bundler.index.composant-echec-non-repeche', { nom: baseName }))
      return
    }
    try {
      if (!existsSync(this.manifestPath)) return
      const raw = readFileSync(this.manifestPath, 'utf-8')
      const pathsLine = raw.split('\n').find(l => l.startsWith('const µPaths = '))
      if (!pathsLine) return
      const jsonText = pathsLine.slice('const µPaths = '.length).replace(/;$/, '')
      const oldManifest = JSON.parse(jsonText) as Record<string, string>
      const oldRaw = oldManifest[baseName]
      if (!oldRaw) return
      const oldValue = decodePathValue(baseName, oldRaw)
      // Valeur attendue : `<baseName>-<empreinte>.js` (5 caractères base 36, ou 8 hexadécimaux d'un build d'avant l'empreinte courte), préfixée de `<urlPrefix>/` ou
      // non — la table publie des valeurs COMPACTES (préfixe factorisé une seule fois,
      // cf. writeManifest), mais un manifeste écrit AVANT cette factorisation porte
      // encore l'URL entière : les deux formes sont acceptées, `this.manifest` reçoit
      // toujours, lui, le chemin ENTIER (c'est writeManifest qui recompacte).
      const compact = oldValue.startsWith(`${this.urlPrefix}/`) ? oldValue.slice(this.urlPrefix.length + 1) : oldValue
      const prefix = `${baseName}-`
      if (!compact.startsWith(prefix) || !compact.endsWith('.js')) return
      const hashPart = compact.slice(prefix.length, -'.js'.length)
      if (!/^(?:[0-9a-z]{5}|[a-f0-9]{8})$/.test(hashPart)) return
      const oldFilename = `${baseName}-${hashPart}.js`
      if (!existsSync(join(this.outputDir, oldFilename))) return
      this.manifest[baseName] = `${this.urlPrefix}/${oldFilename}`
      // l'avertissement attend la fin du tour : la version reprise doit encore tourner (cf. confirmRecoveries)
      this.recoveredFiles.set(baseName, oldFilename)
    } catch {
      // ancien manifeste/JSON corrompu ou illisible → aucun repli, silencieux
    }
  }

  // --------------------------------------------------------------------------
  // confirmRecoveries() : une version reprise par recoverFailedComponentManifest() importe le cœur de SON build. Si le cœur a
  // changé ce tour-ci (un autre composant demande une fonction nouvelle), l'ancien cœur part au ménage qui suit la publication :
  // la reprendre publierait un composant mort au navigateur (et deux cœurs dans la page tant que l'ancien reste). Même sort si
  // elle importe un `.js` que ce ménage retire (module recompilé, feuille partagée, fichier d'effet) ; une image remplacée ne
  // l'arrête pas (elle s'affiche cassée, le composant tourne). Elle quitte alors le manifeste ; un
  // avertissement dit, pour chaque composant repris, si sa version précédente reste servie ou non. Appelée après l'émission
  // de toutes les unités (le ménage en attente est complet) et avant toute lecture du manifeste qui en dépend.
  // --------------------------------------------------------------------------
  private confirmRecoveries(warnings: string[]): void {
    if (this.recoveredFiles.size === 0) return
    const partants = this.pendingHashCleanup.map(f => basename(f)).filter(nom => nom.endsWith('.js') && this.flushWillRemove(nom))
    const coeur    = this.coreHashedPath === '' ? null : basename(this.coreHashedPath)
    for (const [nom, fichier] of this.recoveredFiles) {
      if (this.manifest[nom] !== `${this.urlPrefix}/${fichier}`) continue // clé reprise depuis par une autre unité
      let code = ''
      try {
        code = readFileSync(join(this.outputDir, fichier), 'utf-8')
      } catch {
        // illisible : traité comme une version qui ne tourne plus
      }
      if (coeur !== null && code.includes(coeur) && !partants.some(p => code.includes(p))) {
        this.lintPush(warnings, 'componentFailure', t('bundler.index.composant-echec-ancienne-version', { nom, fichier }))
        continue
      }
      delete this.manifest[nom]
      this.lintPush(warnings, 'componentFailure', t('bundler.index.composant-echec-reprise-impossible', { nom, fichier }))
    }
  }

  // --------------------------------------------------------------------------
  // writePrecacheManifest() : `<outputDir>/mjs-precache.json`, la liste
  // des URLs publiques de TOUT ce que ce build a émis, plus l'identifiant de build.
  //
  //   { "version": "a1b2c3d4", "assets": ["/modularjs/mjs_core-….js", …] }
  //
  // Écrit à chaque build réussi, et seulement s'il change (writeIfChanged) — un build
  // sans modification ne salit pas l'arbre de travail. La `version` est celle de
  // `µ.version` : un service worker qui la compare à la sienne sait exactement quand
  // vider son cache, sans deviner.
  // PUBLIC : bundler/startup.ts émet ses fichiers de page APRÈS compile() et republie cette liste
  // pour les y faire entrer (une sortie du build absente du précache serait la seule que le service
  // worker ne mettrait pas en cache).
  // --------------------------------------------------------------------------
  writePrecacheManifest(): void {
    // les fichiers de messages se chargent à la demande, jamais d'avance
    const lazy   = new Set(this.msgFileNames.values())
    // un composant dont la clé pointe vers un groupe (`bundles`) vit dans le fichier du groupe : son fichier séparé reste
    // écrit (rendu serveur) mais n'a pas à être mis en cache, le code serait téléchargé deux fois
    const groupes = new Set([...this.groupPaths.keys()].filter(k => this.manifest[k]).map(k => basename(this.manifest[k])))
    const assets = [...new Set([...this.emittedThisCompile, ...this.cachedAssetNames])].filter(f => !lazy.has(f) && !groupes.has(f)).sort((a, b) => a < b ? -1 : a > b ? 1 : 0).map(f => `${this.urlPrefix}/${f}`)
    // construction qui écrit dans le dossier des sources : la marque en tête (cf. sortieDuBuild), `version` et `assets` inchangés
    const marque  = this.ecritDansSources() ? { [CLE_MARQUE_SORTIE]: VALEUR_MARQUE_SORTIE } : {}
    const contenu = JSON.stringify({ ...marque, version: this.lastBuildId ?? '', assets }, null, 2) + '\n'
    const cible   = join(this.outputDir, 'mjs-precache.json')
    // déjà refusé en tête de compile() ; ici pour un appel après coup (bundler/startup.ts)
    const refus = this.refusFichierAuteur(cible, 'precache')
    if (refus) throw refus
    this.writeIfChanged(cible, contenu)
  }

  // --------------------------------------------------------------------------
  // collectSizes() : scan outputDir et retourne les tailles de chaque .js émis, plus celles des fichiers du paquet copiés dans la sortie (images)
  // --------------------------------------------------------------------------
  private collectSizes(): SizeReport[] {
    // mode 'bundle' — le manifeste EST la seule sortie JS (aucune unité n'est écrite à part,
    // cf. emitSingleFile()) : jamais dans emittedThisCompile (ni en mode 'split' d'ailleurs,
    // cf. writeManifest() — ce filet ne couvre que writeHashed()/resolveOneAsset()), donc jamais
    // vu par la boucle générique ci-dessous. Sans ce cas à part, `mjs build` en bundle annonçait
    // « N fichiers écrits » avec un tableau de tailles TOUJOURS VIDE — la seule sortie JS existante
    // ne méritait alors aucune ligne, quand elle est justement celle qui compte le plus ici.
    const out: SizeReport[] = []
    if (this.jsMode === 'bundle' && existsSync(this.manifestPath)) {
      const stat = statSync(this.manifestPath)
      if (stat.isFile()) {
        const sameDir = (a: string, b: string): boolean => { try { return realpathSync(a) === realpathSync(b) } catch { return a === b } }
        const name = basename(this.manifestPath).replace(/\.js$/, '')
        const path = sameDir(dirname(this.manifestPath), this.outputDir) ? `${this.urlPrefix}/${basename(this.manifestPath)}` : basename(this.manifestPath)
        out.push({ name, path, bytes: stat.size })
      }
    }
    if (!existsSync(this.outputDir)) return out
    // Itère `emittedThisCompile` (ce que CE tour a réellement écrit) plutôt que de relister
    // outputDir en entier pour ne garder ensuite QUE les noms qui y figurent déjà — sur un
    // rebuild incrémental (watch), outputDir accumule des centaines de fichiers (variantes
    // d'image, cœur, CSS…) quand un seul composant vient de changer : lire tout le dossier pour
    // n'en retenir qu'UN seul est un balayage inutile, répété à chaque compile().
    for (const f of this.emittedThisCompile) {
      if (!f.endsWith('.js')) continue
      const full = join(this.outputDir, f)
      // best-effort : un nom marqué émis mais absent du disque (théorique) ne doit pas faire
      // planter le rapport de tailles, simple filet.
      let stat: ReturnType<typeof statSync>
      try { stat = statSync(full) } catch { continue }
      if (!stat.isFile()) continue
      const name = f.replace(/-(?:[0-9a-z]{5}|[a-f0-9]{8})\.js$/, '').replace(/\.js$/, '')
      out.push({
        name,
        path: `${this.urlPrefix}/${f}`,
        bytes: stat.size,
      })
    }
    // les images du paquet copiées dans la sortie (cf. publishFrameworkAsset) pèsent dans le total comme le reste de ce que le build a écrit
    for (const [f, bytes] of this.frameworkAssets) {
      out.push({ name: f.replace(/-(?:[0-9a-z]{5}|[a-f0-9]{8})(\.[a-z0-9]+)$/, '$1'), path: `${this.urlPrefix}/${f}`, bytes })
    }
    out.sort((a, b) => b.bytes - a.bytes)
    return out
  }

  // --------------------------------------------------------------------------
  // locateRuntimeDir() : cherche `runtime/` à plusieurs emplacements possibles.
  // Couvre :
  //  - dev (tsx) : src/bundler/index.ts → ../runtime/ = src/runtime/
  //  - prod (dist bundlé) : dist/cli.js → ../src/runtime/ = src/runtime/
  //  - install npm : node_modules/<pkg>/dist/cli.js → ../src/runtime/
  // --------------------------------------------------------------------------
  private locateRuntimeDir(): string {
    // `URL.pathname` renvoie le chemin
    // PERCENT-ENCODÉ (un espace devient `%20`, un accent `é` devient
    // `%C3%A9`) — PAS le chemin filesystem décodé. Si ModularJS (ou le
    // projet qui l'installe, ex. `node_modules`) vit sous un chemin avec
    // espace/accent (courant : profil utilisateur "José Martínez", "Program
    // Files"), `existsSync(candidate)` ci-dessous testait une string bidon
    // qui ne correspond à AUCUN dossier réel → échouait TOUJOURS, même quand
    // le dossier existe vraiment. `fileURLToPath` décode correctement
    // (et gère aussi les differences de plateforme, ex. lettre de lecteur
    // Windows).
    const candidates = [
      fileURLToPath(new URL('../runtime/', import.meta.url)),
      fileURLToPath(new URL('../src/runtime/', import.meta.url)),
      fileURLToPath(new URL('../../src/runtime/', import.meta.url)),
    ]
    for (const c of candidates) {
      if (existsSync(c)) return c
    }
    // Fallback : retourne le premier (cohérent avec l'ancien comportement,
    // l'erreur sera plus claire au moment de bundleRuntime quand on listera 0 fichier)
    return candidates[0]
  }

  // --------------------------------------------------------------------------
  // locateCoreModulesDir() : cherche `core-modules/` (catalogue des
  // modules cœur `<@mjs-nom>`) — jumeau exact de locateRuntimeDir() (mêmes
  // 3 emplacements dev/prod/npm, même raison fileURLToPath), résolu
  // relativement au PAQUET ModularJS, jamais au projet compilé.
  // --------------------------------------------------------------------------
  private locateCoreModulesDir(): string {
    const candidates = [
      fileURLToPath(new URL('../core-modules/', import.meta.url)),
      fileURLToPath(new URL('../src/core-modules/', import.meta.url)),
      fileURLToPath(new URL('../../src/core-modules/', import.meta.url)),
    ]
    for (const c of candidates) {
      if (existsSync(c)) return c
    }
    return candidates[0]
  }

  // --------------------------------------------------------------------------
  // locateHologramImagesDir() : cherche `assets/hologram/` (les images des motifs de *hologram) —
  // mêmes 3 emplacements dev/prod/npm que locateCoreModulesDir(), relativement au PAQUET.
  // --------------------------------------------------------------------------
  private locateHologramImagesDir(): string {
    const candidates = [
      fileURLToPath(new URL('../assets/hologram/', import.meta.url)),
      fileURLToPath(new URL('../src/assets/hologram/', import.meta.url)),
      fileURLToPath(new URL('../../src/assets/hologram/', import.meta.url)),
    ]
    for (const c of candidates) {
      if (existsSync(c)) return c
    }
    return candidates[0]
  }

  // --------------------------------------------------------------------------
  // directImportDepKeys(content) : clés de manifest CANDIDATES pour les cibles
  // `@import nom 'chemin'` DIRECTES de ce fichier (jamais la fermeture transitive —
  // cf. collectTransitiveImportClosure, réservée au hash de cache) — basename du
  // chemin, extension `.civet`/`.coffee`/`.mjs` retirée (seules extensions qui
  // publient une clé `this.manifest[basename]`, cf. section 3 de compile() et
  // resolveOneAsset). Une clé qui ne correspond à AUCUNE entrée du manifeste
  // (extension différente, asset binaire, cible introuvable) est filtrée PLUS
  // TARD par buildManifestDeps() — jamais ici, qui reste un simple candidat.
  // Réutilise `extractImportMatches` (déjà masqué <pre>/<code>, même garde que
  // preResolveAssets) : aucune nouvelle logique de scan, une seule source de vérité.
  // --------------------------------------------------------------------------
  private directImportDepKeys(content: string): string[] {
    const keys: string[] = []
    for (const im of extractImportMatches(content)) {
      const target = im[1]
      if (/^https?:\/\//.test(target)) continue
      keys.push(this.moduleStems.get(resolve(this.sourceDir, target)) ?? basename(target).replace(/\.(civet|coffee|mjs)$/, ''))
    }
    return keys
  }

  // --------------------------------------------------------------------------
  // resolveTagShortcuts(errors, warnings) : post-passe de validation du
  // deux espaces de noms séparés — `<@nom>` : un composant du PROJET, `<@@nom>` : un
  // module de la bibliothèque CŒUR (l'ancienne notation <@mjs-nom> est une erreur de
  // migration) — et des balises littérales mjs-*/mjs-core-*, appelée APRÈS que
  // `this.manifestSources` contient tout le projet (seul point où l'union des composants
  // est connue — un fichier isolé ne la connaît pas, cf. `pendingTagRefs`). Compile
  // TRANSITIVEMENT les modules cœur référencés (catalogue coreModulesDir), sous la clé
  // `core-<nom>` (balise mjs-core-<nom>) — le préfixe `core-` est refusé aux fichiers du
  // projet, aucune collision de manifeste possible. Erreurs ACCUMULÉES puis
  // un seul throw agrégé (poussé dans `errors`, jamais un throw direct — même
  // politique que le reste de compile()) ; avertissements poussés un par un
  // dans `warnings` (patron animation-inconnue).
  // --------------------------------------------------------------------------
  private async resolveTagShortcuts(errors: Error[], warnings: string[]): Promise<number> {
    const problems: string[] = []
    let compiledCount = 0

    // a/b — garde-fous sur les fichiers du PROJET (basename OU alias court) :
    // AUCUNE balise réservée, AUCUN préfixe 'core-' (réservé aux modules cœur
    // ajoutés à this.manifestSources PLUS BAS, donc jamais vus par CETTE boucle).
    // Le BASENAME (manifestKinds === 'basename', nom de fichier réel,
    // non négociable) reste une ERREUR DURE, inchangé. Un ALIAS COURT (kind
    // 'shortName' ou 'poisoned', cf. claimShortName) n'est qu'un confort : il
    // CÈDE en silence (retiré du manifeste ET du pool de résolution
    // `manifestNames` construit juste plus bas) + un simple avertissement —
    // jamais une erreur qui bloquerait tout le projet pour un raccourci.
    // Le composant reste joignable par son basename complet (claimBasename,
    // jamais touché ici) ; côté aliasTag/customElements.define, le même repli
    // est déjà appliqué en amont (_compileMjsInner, isReservedShortcutName).
    for (const [key, file] of this.manifestSources) {
      if (!this.isReservedShortcutName(key)) continue
      const lower = key.toLowerCase()
      if (this.manifestKinds.get(key) === 'basename') {
        if (AT_RESERVED_NAMES.includes(lower)) {
          problems.push(t('bundler.index.tag-nom-reserve', { fichier: file, nom: key }))
        } else if (lower.startsWith('mjs-')) {
          problems.push(t('bundler.index.tag-nom-mjs-prefixe', { fichier: file, nom: key, propre: key.slice(4) }))
        } else {
          problems.push(t('bundler.index.tag-nom-core-prefixe', { fichier: file, nom: key }))
        }
      } else {
        delete this.manifest[key]
        this.manifestSources.delete(key)
        this.manifestKinds.delete(key)
        // préfixe `mjs-` : l'alias part SANS un mot. Il était de toute façon injoignable
        // (`<@mjs-x>` est une erreur de migration), et un fichier
        // légitimement nommé `tuto-mjs-window.mjs` en fabrique un à chaque fois : mesuré sur
        // le site de doc, 20 alias × 7 passes = 140 lignes d'avertissement sur lesquelles
        // l'auteur n'a rien à faire. Les autres cas (nom réservé, `core-`) parlent toujours.
        if (!lower.startsWith('mjs-')) this.lintPush(warnings, 'tagAlias', t('bundler.index.tag-alias-reserve-ignore', { fichier: file, nom: key }))
      }
    }

    // Union manifeste (basenames + alias courts), comparaison en minuscules.
    const manifestNames = new Set(Array.from(this.manifestSources.keys(), (k) => k.toLowerCase()))

    // Alias courts EMPOISONNÉS (deux composants se les disputent, claimShortName) : ils sont
    // dans `manifestSources` — donc dans `manifestNames` ci-dessus — mais PUBLIÉS PAR PERSONNE,
    // et le transpileur n'enregistre plus la balise courte quand le manifeste ne porte pas sa
    // clé. Une balise littérale qui l'écrit est donc aussi inerte qu'une faute de frappe : elle
    // mérite le même avertissement, en nommant les rivaux. Relevé APRÈS la boucle ci-dessus (un
    // alias au nom réservé y perd son kind, il parle déjà par sa propre voie).
    const aliasAmbigus = new Map<string, string[]>()
    for (const [key, noms] of this.poisonedAliasSources) {
      if (this.manifestKinds.get(key) === 'poisoned') aliasAmbigus.set(key.toLowerCase(), noms)
    }

    // Catalogue cœur — scan à plat de coreModulesDir (même filtre `_partial` que mjsFiles).
    const coreCatalogFiles = this.findFiles(this.coreModulesDir, ['.mjs'])
      .filter((f) => !basename(f, '.mjs').startsWith('_'))
    const coreCatalog = new Map<string, string>()  // nom (minuscule) → filePath
    for (const f of coreCatalogFiles) coreCatalog.set(modelNameOf(basename(f, '.mjs')).toLowerCase(), f)

    // Union de suggestion (règle d) : réservées + cœur + projet, avec leur nature
    // (codes internes consommés par la clé 'bundler.index.tag-suggestion' : un module cœur
    // se propose sous sa forme `<@@nom>`).
    type Candidate = { compareName: string; displayName: string; nature: 'reservee' | 'coeur' | 'projet' }
    // Départage à distance ÉGALE : projet d'abord (cas le plus probable), puis réservée, puis cœur
    const suggestionPool: Candidate[] = [
      ...Array.from(manifestNames, (n): Candidate => ({ compareName: n, displayName: n, nature: 'projet' })),
      ...AT_RESERVED_NAMES.map((n): Candidate => ({ compareName: n, displayName: n, nature: 'reservee' })),
      ...Array.from(coreCatalog.keys(), (n): Candidate => ({ compareName: n, displayName: n, nature: 'coeur' })),
    ]
    const suggestTagCandidate = (name: string, pool: Candidate[] = suggestionPool): Candidate | null => {
      let best: Candidate | null = null
      let bestDist = Infinity
      for (const c of pool) {
        const d = levenshtein(name, c.compareName)
        if (d < bestDist) { bestDist = d; best = c }
      }
      return best !== null && bestDist <= 2 ? best : null
    }

    // Modules cœur déjà compilés/en attente — la transitivité boucle jusqu'au
    // point fixe (un module cœur peut référencer <@autre>).
    const neededCore = new Set<string>()
    const compiledCore = new Set<string>()

    // processRefs — résout un lot de références (dev initial, puis chaque
    // module cœur nouvellement compilé) — MÊME résolution qu'elle vienne d'un
    // fichier projet ou d'un module cœur : `<@x>` cherche le projet seul, `<@@x>`
    // le catalogue cœur seul. Un composant du projet ne masque donc plus un module
    // cœur, et un module cœur ne réserve plus aucun nom au projet.
    const suggestionCoeur = suggestionPool.filter((c) => c.nature === 'coeur')
    const balisesNuesVues = new Set<string>()
    const processRefs = (refs: { file: string; name: string; kind: TagRefKind }[]): void => {
      for (const ref of refs) {
        const lname = ref.name.toLowerCase()
        switch (ref.kind) {
          case 'raccourci-mjs-retire': {
            // la bonne écriture dépend de qui porte ce nom : le projet d'abord, le cœur sinon ;
            // `<@mjs-core-x>` mêle l'ancienne notation et la balise du module cœur x
            const coeur = lname.startsWith('core-') && coreCatalog.has(lname.slice(5)) ? ref.name.slice(5) : null
            const forme = coeur !== null ? `<@@${coeur}>` : !manifestNames.has(lname) && coreCatalog.has(lname) ? `<@@${ref.name}>` : `<@${ref.name}>`
            problems.push(t('bundler.index.tag-raccourci-mjs-retire', { fichier: ref.file, nom: ref.name, forme }))
            break
          }
          case 'raccourci-coeur':
          case 'litteral-coeur':
            if (coreCatalog.has(lname)) {
              if (!compiledCore.has(lname)) neededCore.add(lname)
            } else if (ref.kind === 'litteral-coeur') {
              problems.push(t('bundler.index.tag-coeur-litteral-inconnu', { fichier: ref.file, nom: ref.name }))
            } else if (AT_RESERVED_NAMES.includes(lname)) {
              problems.push(t('bundler.index.tag-coeur-reservee', { fichier: ref.file, nom: ref.name }))
            } else if (manifestNames.has(lname)) {
              problems.push(t('bundler.index.tag-coeur-est-projet', { fichier: ref.file, nom: ref.name }))
            } else {
              const suggestion = suggestTagCandidate(lname, suggestionCoeur)
              const hint = suggestion ? t('bundler.index.tag-suggestion', { nom: suggestion.displayName, nature: suggestion.nature }) : ''
              problems.push(t('bundler.index.tag-coeur-inconnu', { fichier: ref.file, nom: ref.name }) + hint)
            }
            break
          case 'raccourci-dev':
            if (manifestNames.has(lname)) {
              // résolu par le projet — rien à faire
            } else if (coreCatalog.has(lname)) {
              // l'ancienne écriture d'un module cœur : il se nomme maintenant avec deux @
              problems.push(t('bundler.index.tag-coeur-sans-arobase', { fichier: ref.file, nom: ref.name }))
            } else {
              const suggestion = suggestTagCandidate(lname)
              const hint = suggestion ? t('bundler.index.tag-suggestion', { nom: suggestion.displayName, nature: suggestion.nature }) : ''
              problems.push(t('bundler.index.tag-dev-inconnu', { fichier: ref.file, nom: ref.name }) + hint)
            }
            break
          case 'litteral-dev':
            if (aliasAmbigus.has(lname)) {
              const rivaux = aliasAmbigus.get(lname) as string[]
              this.lintPush(warnings, 'tagAlias', t('bundler.index.tag-alias-ambigu', { fichier: ref.file, tag: `mjs-${ref.name}`, sources: rivaux.join(', '), premier: rivaux[0] }))
            } else if (manifestNames.has(lname)) {
              // résolu par le projet — rien à faire
            } else if (coreCatalog.has(lname)) {
              // `mjs-<nom>` était la balise du module cœur ; elle est maintenant `mjs-core-<nom>`
              problems.push(t('bundler.index.tag-litteral-coeur-migration', { fichier: ref.file, nom: ref.name }))
            } else {
              this.lintPush(warnings, 'tagAlias', t('bundler.index.tag-litteral-dev-inconnue', { fichier: ref.file, tag: `mjs-${ref.name}` }))
            }
            break
          case 'balise-nue': {
            // `<enfant-simple>` sans préfixe alors que le projet a ce composant : jamais enregistrée, la balise reste vide.
            // Une fois par fichier et par nom ; rien pour un élément sans composant du même nom (autre bibliothèque), un nom
            // réservé par HTML (SVG, MathML) ni un fichier du cœur
            const cle = ref.file + '\0' + lname
            if (!manifestNames.has(lname) || NOMS_RESERVES_HTML.has(lname) || balisesNuesVues.has(cle) || resolve(ref.file).startsWith(this.coreModulesDir + sep)) break
            balisesNuesVues.add(cle)
            this.lintPush(warnings, 'tagAlias', t('bundler.index.tag-sans-prefixe', { fichier: ref.file, nom: lname }))
            break
          }
        }
      }
    }

    // les références du projet sont toutes lues : coreAttrWritten répond, et mjsSource ôte les morceaux que nulle page ne demande
    this.tagRefsComplete = true
    this.pageTransition  = this.pendingFeatures.has('fx_transition')
    this.pageTools       = this.toolsOfPages()
    processRefs(this.pendingTagRefs)

    // Transitivité — compile chaque module cœur nouvellement requis (résolution
    // projet-puis-cœur : jamais atteint si le projet a déjà ce nom, donc aucune
    // collision possible sur la clé PLATE écrite plus bas), scanne SES propres
    // références (poussées dans this.pendingTagRefs par _compileMjsInner
    // pendant l'await juste en dessous), boucle jusqu'à ce qu'aucun nouveau nom
    // n'apparaisse (point fixe).
    while (neededCore.size > 0) {
      const batch = Array.from(neededCore)
      neededCore.clear()
      for (const name of batch) {
        if (compiledCore.has(name)) continue
        compiledCore.add(name)
        const coreFilePath = coreCatalog.get(name)!
        const beforeLen = this.pendingTagRefs.length
        try {
          // clé `core-<nom>` : balise mjs-core-<nom>, jamais en concurrence avec un composant
          // du projet (le préfixe core- lui est refusé)
          const cle = `core-${name}`
          const hashedPath = await this.compileMjs(coreFilePath, cle)
          this.manifest[cle] = hashedPath
          this.manifestSources.set(cle, coreFilePath)
          this.manifestKinds.set(cle, 'basename')
          compiledCount++
        } catch (e: any) {
          problems.push(t('bundler.index.erreur-fichier', { fichier: coreFilePath, raison: e?.message ?? e }))
          continue
        }
        processRefs(this.pendingTagRefs.slice(beforeLen))
      }
    }

    // variants — layout="x"/template="x" LITTÉRAL (jamais une valeur dynamique,
    // cf. TagRef.layoutLiteral posé par parser/index.ts) dont le nom n'est pas une
    // variant connu du module ciblé. Volontairement APRÈS le point fixe cœur
    // ci-dessus : this.pendingLayoutNames est ENTIER (modules cœur transitifs compris),
    // l'ordre des fichiers n'a donc aucune importance. Restreint aux kinds qui
    // désignent un composant et dont la balise résout réellement (projet pour <@x> et
    // mjs-x, cœur pour <@@x> et mjs-core-x) — sinon la validation de balise ci-dessus
    // s'en charge déjà, jamais de message en double. Silencieux aussi si le module cible
    // ne déclare AUCUN variant (repli historique du fichier CSS déposé à la main).
    for (const [coeur, models] of [[false, this.componentModels.dev], [true, this.componentModels.core]] as const) {
      for (const [base, noms] of Object.entries(models)) {
        // un alias court porte les modèles de son composant : la faute se dit une fois, sous le vrai nom
        if (!coeur && this.modelAliasKeys.has(base)) continue
        const styles = this.pendingLayoutNames.get(coeur ? `core-${base}` : base)
        for (const nom of noms) {
          if (styles?.has(nom)) problems.push(t('bundler.modele-double', { base, nom, fichier: `${base}.${nom}.mjs` }))
        }
      }
    }
    for (const ref of this.pendingTagRefs) {
      if (ref.layoutLiteral === undefined) continue
      if (ref.kind === 'raccourci-mjs-retire') continue
      const coeur = ref.kind === 'raccourci-coeur' || ref.kind === 'litteral-coeur'
      const lname = ref.name.toLowerCase()
      if (coeur ? !coreCatalog.has(lname) : !manifestNames.has(lname)) continue
      const known = this.pendingLayoutNames.get(coeur ? `core-${lname}` : lname)
      if (!known || known.has(ref.layoutLiteral)) continue
      const tagDisplay = { 'raccourci-dev': `@${ref.name}`, 'raccourci-coeur': `@@${ref.name}`, 'litteral-coeur': `mjs-core-${ref.name}`, 'litteral-dev': `mjs-${ref.name}` }[ref.kind]
      problems.push(t('bundler.index.tag-layout-litteral-inconnue', {
        fichier: ref.file,
        tag:     tagDisplay,
        nom:     ref.layoutLiteral,
        connus:  Array.from(known).join(', '),
      }))
    }

    // <@@chart> : ses valeurs écrites en dur (mots de shape, stats, step et axis, couleurs des séries, combinaisons), cf. core-chart.ts
    for (const ref of this.pendingTagRefs) {
      if ((ref.kind === 'raccourci-coeur' || ref.kind === 'litteral-coeur') && ref.name.toLowerCase() === 'chart') problems.push(...chartProblems(ref))
    }

    // les modules du cœur : un attribut écrit en dur en camelCase (`emptyLabel="…"`), que le HTML met en minuscules — les props d'un module
    // se lisent dans sa source, une fois par construction, cf. core-attrs.ts
    const camelProps = new Map<string, string[]>()
    for (const ref of this.pendingTagRefs) {
      if ((ref.kind !== 'raccourci-coeur' && ref.kind !== 'litteral-coeur') || !ref.attrs) continue
      const source = coreCatalog.get(ref.name.toLowerCase())
      if (!source) continue
      if (!camelProps.has(source)) camelProps.set(source, coreCamelProps(readFileSync(source, 'utf-8')))
      problems.push(...camelAttrProblems(ref, camelProps.get(source)!))
    }

    // dédup — une même faute de frappe référencée plusieurs fois (ou depuis
    // plusieurs fichiers avec exactement le même message) ne doit pas répéter
    // la ligne (même hygiène que `uniqueUpdates`, generator/compile.ts).
    const uniqueProblems = Array.from(new Set(problems))
    if (uniqueProblems.length > 0) {
      errors.push(new Error(uniqueProblems.join('\n')))
    }
    return compiledCount
  }

  // --------------------------------------------------------------------------
  // coreAttrWritten(module, attr) : l'attribut `attr` est-il écrit sur une référence au module cœur
  // `module` (`<@@module …>` ou `<mjs-core-module …>`), quelque part dans l'appli ? Quelle que soit la
  // forme de la valeur (`attr`, `attr="…"`, `attr={…}`, `attr=!{…}`) et la casse (le navigateur range les
  // noms d'attribut en minuscules). Trois réponses : 'yes' ; 'no' ; 'unknown' quand aucune référence ne
  // l'écrit mais que l'une porte un étalement `{...p}` (ce qu'il pose ne se sait pas au build) — ou n'a
  // pas rapporté ses attributs : pour qui décide, 'unknown' vaut 'yes'. Seules comptent les références
  // à CE module cœur : un attribut du même nom sur une autre balise, un composant du projet, un autre
  // module cœur, un texte ou un commentaire ne répond rien.
  // Lue sur `pendingTagRefs` (les références de tous les fichiers du tour, cache-hits compris, puis celles
  // des modules cœur déjà compilés), que chaque compile() remet à zéro : rien n'est retenu d'un tour à
  // l'autre, un attribut ajouté puis retiré entre deux tours de `mjs dev` se voit. À lire une fois les
  // références résolues (resolveTagShortcuts) ; un module cœur qui en référence un autre ne livre ses
  // références qu'une fois compilé. Avant que les références du projet soient toutes lues (avant le premier
  // compile(), ou pendant la phase des composants) la réponse est 'unknown', jamais 'no' : 'no' autorise un retrait.
  // --------------------------------------------------------------------------
  coreAttrWritten(module: string, attr: string): 'yes' | 'unknown' | 'no' {
    if (!this.tagRefsComplete) return 'unknown'
    const wanted = module.toLowerCase()
    const name   = attr.toLowerCase()
    let maybe    = false
    for (const ref of this.pendingTagRefs) {
      if (ref.kind !== 'raccourci-coeur' && ref.kind !== 'litteral-coeur') continue
      if (ref.name.toLowerCase() !== wanted) continue
      if (!ref.attrs) {
        maybe = true
        continue
      }
      if (ref.attrs.names.some(n => n.toLowerCase() === name)) return 'yes'
      if (ref.attrs.spread) maybe = true
    }
    return maybe ? 'unknown' : 'no'
  }

  // --------------------------------------------------------------------------
  // coreAttrWrittenStrict(module, attr) : la réponse de coreAttrWritten pour un attribut que le développement tranche comme la production (STRICT_ATTRS),
  // avec un doute plus large — son morceau part alors de toutes les constructions, serveur compris. 'yes' : une référence au module, ou à l'un de ses
  // modèles en fichier (`chart--x`), écrit l'attribut. 'unknown' : les références du projet ne sont pas toutes lues ; une référence porte un étalement ou n'a
  // pas rapporté ses attributs (un cache ancien) ; une source du projet peut donner l'attribut hors du relevé des balises (cf. coreTagDoubt : une balise
  // dynamique qui l'écrit ou qui étale, un script ou un module .civet / .coffee / .js / .ts qui nomme la balise du module), ou ne se lit pas. 'no' sinon, seule réponse
  // qui autorise un retrait. Les sources passent par scanSource (mémoïsée par date et taille) : un tour de `mjs dev` qui ajoute ou retire un doute change
  // la réponse.
  // --------------------------------------------------------------------------
  coreAttrWrittenStrict(module: string, attr: string): 'yes' | 'unknown' | 'no' {
    if (!this.tagRefsComplete) return 'unknown'
    const wanted = module.toLowerCase()
    const name   = attr.toLowerCase()
    let maybe    = false
    for (const ref of this.pendingTagRefs) {
      if (ref.kind !== 'raccourci-coeur' && ref.kind !== 'litteral-coeur') continue
      if (ref.name.toLowerCase().split('--')[0] !== wanted) continue
      if (!ref.attrs) {
        maybe = true
        continue
      }
      if (ref.attrs.names.some(n => n.toLowerCase() === name)) return 'yes'
      if (ref.attrs.spread) maybe = true
    }
    if (maybe) return 'unknown'
    return this.coreTagDoubted([[wanted, name]]) ? 'unknown' : 'no'
  }

  // --------------------------------------------------------------------------
  // coreTagDoubted(pairs) : une source du projet peut-elle donner l'un de ces attributs (`[module, attribut]`) à une balise de son module cœur sans que le
  // relevé des balises le voie (cf. coreTagDoubt) ? Une source qui ne se lit pas, ou un dossier qui ne se parcourt pas : oui. Doute commun à
  // coreAttrWrittenStrict et à coreToolShown.
  // --------------------------------------------------------------------------
  private coreTagDoubted(pairs: ReadonlyArray<readonly [string, string]>): boolean {
    let files: string[]
    try {
      // une déclaration de types (.d.ts) ne fabrique aucune balise
      files = this.findFiles(this.sourceDir, ['.mjs', '.civet', '.coffee', '.js', '.ts']).filter(f => !f.endsWith('.d.ts'))
    }
    catch {
      return true
    }
    return pairs.some(([module, attr]) => {
      const kind = 'coreTagDoubt\0' + module + '\0' + attr
      return files.some(f => this.scanSource(kind, f, true, (src) => coreTagDoubt(src, module, attr, !f.endsWith('.mjs'))))
    })
  }

  // --------------------------------------------------------------------------
  // coreTransitionWritten() : une page du projet écrit-elle une transition (`@in`, `@out` ou `@transition`, de quelque façon : valeur, réglage
  // tenu par une variable, alias d'un fichier d'effets, dans un `{if}`, un composant enfant, un partiel…) ? C'est le signal compilé `fx_transition`
  // (features.ts), celui qui fait partir le moteur des transitions : une transition ne joue pas sans lui, donc aucun faux négatif ; un faux positif
  // (une transition ailleurs que sur les lignes d'une liste) ne coûte que des octets. Mêmes trois réponses que coreAttrWritten : 'unknown' tant que
  // les composants du projet ne sont pas tous lus (jamais 'no', qui autorise un retrait). Relevé à la fin de leur phase, avant qu'aucun module
  // cœur ne soit compilé : une transition qu'un module cœur écrit lui-même n'y compte pas (l'ordre de leur compilation ferait varier la réponse).
  // --------------------------------------------------------------------------
  coreTransitionWritten(): 'yes' | 'unknown' | 'no' {
    if (!this.tagRefsComplete) return 'unknown'
    return this.pageTransition ? 'yes' : 'no'
  }

  // --------------------------------------------------------------------------
  // coreResumeWanted() : l'appli reprend-elle des pages rendues par le serveur ? C'est la décision même qui embarque le moteur de reprise (mjs_hydrate.ts,
  // cf. hydrateWanted) : une page rendue dans un mode qui adopte le DOM du serveur, ou le moteur demandé par `runtime: [..., 'hydrate']`. Réglage pur, connu
  // dès la construction : jamais 'unknown'. Sans le moteur, une page rendue par le serveur est reconstruite et non reprise : une appli qui reprend une page a
  // donc toujours ce code, et un faux positif (le moteur sans page reprise) ne coûte que des octets.
  // --------------------------------------------------------------------------
  coreResumeWanted(): 'yes' | 'no' {
    return this.hydrateWanted() ? 'yes' : 'no'
  }

  // --------------------------------------------------------------------------
  // toolsOfPages() : les outils que les barres du projet nomment. Une référence à <@@editor> (ou à un de ses modèles) lit son attribut `toolbar`, une référence à
  // <@@toolbar> son attribut `tools`, chacun en mots séparés par des blancs (`|` est un séparateur, `none` aucune barre : ni l'un ni l'autre n'est un outil). Dès
  // qu'une barre ne dit pas sa liste (attribut absent, vide, calculé, écrit deux fois, étalement, référence relevée sans le texte de ses attributs), le build ne sait pas
  // ce que l'appli peut afficher : null, tout reste. Aucune barre dans le projet : null aussi (le module n'est alors demandé que par un autre module cœur).
  // Un éditeur qui écrit `answer` tel quel (sans valeur, ou autre que « false », quelle que soit sa casse, comme le lit l'éditeur) n'affiche jamais sa barre : sa liste ne compte pas, il ne demande pas « tous les outils ».
  // `answer={…}`, `answer="{…}"` ou un étalement gardent la règle prudente ; le modèle d'un fichier du projet (`editor--compact`) a son propre gabarit : sa liste compte.
  // --------------------------------------------------------------------------
  private toolsOfPages(): ReadonlySet<string> | null {
    const named = new Set<string>()
    let seen    = false
    for (const ref of this.pendingTagRefs) {
      if (ref.kind !== 'raccourci-coeur' && ref.kind !== 'litteral-coeur') continue
      const module = ref.name.toLowerCase().split('--')[0]
      const attr   = module === 'editor' ? 'toolbar' : module === 'toolbar' ? 'tools' : null
      if (!attr) continue
      seen = true
      const answer = ref.attrs?.texts?.answer
      if (ref.name.toLowerCase() === 'editor' && !ref.attrs?.spread && typeof answer === 'string' && answer.toLowerCase() !== 'false') continue
      const text = ref.attrs?.spread ? null : ref.attrs?.texts?.[attr]
      if (text == null || !text.trim()) return null
      for (const word of text.trim().split(/\s+/)) named.add(word)
    }
    return seen ? named : null
  }

  // --------------------------------------------------------------------------
  // coreToolShown(tool) : l'appli peut-elle afficher cet outil de la barre de l'éditeur riche (`bold`, `link`, `check`…) ? 'yes' quand une barre le nomme ; 'unknown'
  // quand le build ne sait pas (cf. toolsOfPages) ou que les références du projet ne sont pas toutes lues ; 'no' quand toutes les barres disent leur liste et qu'aucune
  // ne le nomme. `tool` est un outil, un groupe d'outils (TOOL_GROUPS) ou `separator` : vrai dès que l'un des outils du groupe est nommé. Pour qui décide, 'unknown'
  // vaut 'yes' : 'no' autorise un retrait. La réponse tranche le développement comme la production (cf. mjsSource) : le doute y est celui d'un attribut de
  // STRICT_ATTRS (coreTagDoubted) — une source du projet qui peut fabriquer un éditeur ou une barre hors du relevé (un script qui nomme <@@editor> ou <@@toolbar>,
  // une balise dynamique qui écrit `toolbar`, `tools` ou un étalement) répond 'unknown'.
  // --------------------------------------------------------------------------
  coreToolShown(tool: string): 'yes' | 'unknown' | 'no' {
    if (!this.tagRefsComplete || !this.pageTools) return 'unknown'
    const shown = this.pageTools
    if ((Object.hasOwn(TOOL_GROUPS, tool) ? TOOL_GROUPS[tool] : [tool]).some(name => shown.has(name))) return 'yes'
    return this.coreTagDoubted([['editor', 'toolbar'], ['toolbar', 'tools']]) ? 'unknown' : 'no'
  }

  // --------------------------------------------------------------------------
  // mjsSource(filePath) : le texte d'un .mjs à compiler. Celui d'un module CŒUR est réduit aux morceaux que l'appli demande (repères
  // `@@`, cf. core-sections.ts ; l'étiquette d'un repère nomme l'attribut, le module est celui du fichier : `other` de select, `group` de
  // sortable ; `transition` nomme le fait « une page écrit une transition », coreTransitionWritten ; `reprise` le fait « l'appli reprend des pages rendues par
  // le serveur », coreResumeWanted ; `tool-<nom>` le fait « une barre de l'appli peut afficher cet outil », coreToolShown) : en PRODUCTION, les morceaux d'un attribut
  // que nulle page n'écrit (coreAttrWritten = 'no') sont ôtés
  // avant la compilation ; 'yes' et 'unknown' (étalement, références pas encore lues) gardent tout. Les morceaux d'un attribut de STRICT_ATTRS (`toolbar` de
  // <@@chart>, `other` de <@@select>, `answer` de <@@editor>, `group` de <@@sortable>) et ceux d'un outil de la barre de l'éditeur se tranchent partout comme
  // en production, sur coreAttrWrittenStrict et coreToolShown, pour que le rendu serveur et le navigateur emportent le même gabarit quel que soit leur
  // environnement ; mjsSource relève aussi les parties de STRICT_ATTRS, ôtées ou gardées (coreParts), pour les libellés du manifeste. Le DÉVELOPPEMENT garde
  // les autres morceaux (`transition`, `reprise`, un attribut hors de STRICT_ATTRS). L'avertissement du développement ne reste que lorsqu'aucune page n'écrit
  // l'attribut. Le texte réduit est ce qui entre dans l'empreinte du cache et dans le message du pool de threads : ajouter ou
  // retirer l'attribut dans une page, en mode veille, recompile le module. Un fichier du projet (une copie éjectée d'un module cœur
  // comprise), un modèle en fichier et un texte sans repère passent tels quels : les repères n'y sont que des commentaires.
  // --------------------------------------------------------------------------
  private mjsSource(filePath: string): string {
    const content = readFileSync(filePath, 'utf-8')
    const file    = resolve(filePath)
    if (!file.startsWith(this.coreModulesDir + sep)) return content
    const stem   = basename(file, '.mjs')
    const model  = modelNameOf(stem) !== stem
    const family = modelNameOf(stem).split('--')[0]
    const dev    = !this.isProd()
    const known  = new Map<string, boolean>()
    // un autre module du catalogue qui cite celui-ci (`<@@nom`, `<mjs-core-nom`) peut y écrire l'attribut dans son gabarit : ses références ne se
    // lisent qu'une fois compilé, après celui-ci (cf. coreAttrWritten) — dans le doute, tout reste
    let cited: boolean | undefined
    const citedByCatalog = (): boolean => {
      const tag = new RegExp(`<@@${stem}\\b|<mjs-core-${stem}\\b`, 'i')
      return cited ??= this.findFiles(this.coreModulesDir, ['.mjs']).some(f => resolve(f) !== file && tag.test(readFileSync(f, 'utf-8')))
    }
    // l'attribut est-il écrit nulle part (une réponse par attribut et par lecture) ; les étiquettes `transition`, `reprise` et `tool-<nom>` ne sont pas des attributs : aucune page
    // n'écrit de transition, l'appli ne reprend aucune page du serveur, aucune barre ne montre l'outil — `reprise` et `tool-<nom>` ne dépendent pas des modules qui citent celui-ci,
    // ce sont un réglage et un fait de l'appli
    // un attribut tranché partout pareil (STRICT_ATTRS), pour le module de base comme pour ses modèles ; un outil de la barre de l'éditeur aussi
    const strictAttr = (attr: string): boolean => Object.hasOwn(STRICT_ATTRS, family) && STRICT_ATTRS[family].includes(attr)
    const strict     = (attr: string): boolean => attr.startsWith(TOOL_PREFIX) || strictAttr(attr)
    const absent = (attr: string): boolean => {
      if (!known.has(attr)) {
        const tool = attr.startsWith(TOOL_PREFIX)
        const gone = !(model || (attr !== RESUME_LABEL && !tool && citedByCatalog())) && (attr === TRANSITION_LABEL ? this.coreTransitionWritten() : attr === RESUME_LABEL ? this.coreResumeWanted() : tool ? this.coreToolShown(attr.slice(TOOL_PREFIX.length)) : strictAttr(attr) ? this.coreAttrWrittenStrict(stem, attr) : this.coreAttrWritten(stem, attr)) === 'no'
        known.set(attr, gone)
        if (strictAttr(attr)) (gone ? this.coreParts.dropped : this.coreParts.kept).add(family + '.' + attr)
      }
      return known.get(attr)!
    }
    // le développement garde tout, sauf un attribut ou un outil tranché partout pareil
    const keep = (attr: string): boolean => dev && !strict(attr)
    return selectCoreSections(file, content, (kind, attr) => kind === 'dev' ? dev && absent(attr) : kind === 'alt' ? !keep(attr) && absent(attr) : keep(attr) || !absent(attr))
  }

  // --------------------------------------------------------------------------
  // buildManifestDeps() : résout `this.pendingComponentDeps` (noms bruts, un
  // par composant) contre `this.manifestSources` (union PROJET + modules cœur
  // transitifs, complète seulement APRÈS resolveTagShortcuts) — mêmes règles de
  // résolution que processRefs ci-dessus (comparaison en minuscules, clé RÉELLE
  // du manifeste conservée). Un nom candidat absent du manifeste (raccourci
  // inconnu, cible @import qui ne compile pas, faute de frappe dans un exemple
  // de doc non filtré) est silencieusement écarté ICI — resolveTagShortcuts()
  // (déjà passé à ce stade) a son propre avertissement/erreur pour ces cas, ce
  // n'est pas le rôle de la table de préchargement de les re-signaler.
  //
  // Entrées TRIÉES (clés ET valeurs, par point de code, même raison que
  // publicManifest en writeManifest()) : deux builds du même code doivent
  // produire la MÊME table, à l'octet près. Un composant SANS dépendance
  // n'entre pas dans la table (repli implicite = tableau vide côté runtime).
  // --------------------------------------------------------------------------
  private buildManifestDeps(): Record<string, string[]> {
    const lowerToKey = new Map<string, string>()
    for (const key of this.manifestSources.keys()) lowerToKey.set(key.toLowerCase(), key)
    const table: Record<string, string[]> = {}
    for (const entry of this.pendingComponentDeps) {
      const resolved = new Set<string>()
      for (const raw of entry.deps) {
        const real = lowerToKey.get(raw.toLowerCase())
        if (real && real !== entry.moduleName) resolved.add(real)
      }
      if (resolved.size === 0) continue
      table[entry.moduleName] = Array.from(resolved).sort((a, b) => a < b ? -1 : a > b ? 1 : 0)
    }
    // ses fichiers d'effets (cf. compileFxChunks) : préchargés avec lui
    for (const [name, keys] of this.pendingFxDeps) {
      const ks = keys.filter(k => this.fxChunkPaths.has(k))
      if (ks.length === 0 || !this.manifest[name]) continue
      table[name] = [...new Set([...(table[name] ?? []), ...ks])].sort((a, b) => a < b ? -1 : a > b ? 1 : 0)
    }
    return Object.fromEntries(Object.entries(table).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0))
  }

  // --------------------------------------------------------------------------
  // i18nAttente() : l'attente des textes traduits de la configuration (`i18n.placeholder`, `wait` quand rien n'est écrit), lue et vérifiée ;
  // rien sans configuration i18n
  // --------------------------------------------------------------------------
  private i18nAttente(): Placeholder | null {
    if (!this.i18n) return null
    return parsePlaceholder(this.i18n.placeholder ?? 'wait', PLACEHOLDER_CONFIG)
  }

  // --------------------------------------------------------------------------
  // hasI18nConfigured() : MÊMES signaux que scanI18n() (`config.i18n` renseigné
  // OU `sourceDir/i18n/` présent) — vérif bon marché (pas de parsing), utilisée
  // par resolveRuntimeFiles() pour décider si mjs_i18n.ts entre dans 'all'.
  // Appelée AVANT scanI18n() dans compile() (bundleRuntime précède scanI18n) :
  // ne dépend PAS de `this.i18nManifestData`, relit le disque directement.
  private hasI18nConfigured(): boolean {
    if (this.i18n !== undefined) return true
    const i18nDir = join(this.sourceDir, 'i18n')
    return existsSync(i18nDir) && statSync(i18nDir).isDirectory()
  }

  // --------------------------------------------------------------------------
  // resolveRuntimeFiles() : sélection des modules du bundle `mjs_core.js`
  // (tree-shake EXPLICITE, opt-in). Le CŒUR (4 modules, jamais retirables) est
  // toujours inclus ; les optionnels selon `runtime` (défaut 'all'), avec
  // rétrocompat `minimalRuntime` (≡ 'core'). Pure et testable : retourne la
  // liste ORDONNÉE de fichiers (hors mjs_debug, inséré à part par bundleRuntime)
  // + avertissements ergonomiques non-bloquants + `coreOnly` (aucun optionnel →
  // bundle taille-critique, pas de mjs_debug — ne regarde QUE les optionnels
  // classiques, cf. le calcul de `coreOnly` en fin de méthode).
  //
  // `mjs_vt_presets.ts`, `mjs_title.ts`, `mjs_store.ts` et `mjs_interpolate.ts`,
  // longtemps rattachés au CŒUR d'office, ne le sont PLUS : « on met tout,
  // c'est au build qu'on ne met que ce qu'on détecte ». Deux logiques
  // distinctes : `mjs_vt_presets.ts` suit une règle de CONFIGURATION pure,
  // AUCUN scan — inclus si `router` OU `ujs` est sélectionné (ses deux seuls
  // consommateurs, `µ._mjs_vtApplyPreset`), ou demandé explicitement (`runtime:
  // [..., 'vt_presets']`). `mjs_title.ts`, `mjs_store.ts` (classe `µStore`/
  // `µ.Store`) et `mjs_interpolate.ts` (`µinterpolate`/`µ.interpolate`) sont
  // DÉTECTÉS à l'usage : `used` (le Set rendu par
  // `collectUsedFeatures()`, union des signaux compilés de toutes les unités du tour) doit contenir
  // `'title'`/`'store'`/`'interpolate'` respectivement, ou le module est
  // demandé explicitement (`runtime: [..., 'title'|'store'|'interpolate']`) —
  // SANS argument (API directe, tests existants inclus), faits inconnus = on
  // GARDE. La doctrine « config-driven, pas d'auto-détection par scan de
  // code » (cf. `hasI18nConfigured()` plus bas, pour `mjs_i18n.ts`) reste
  // vraie pour i18n — ces trois-là en sont l'exception assumée, pas un
  // relâchement général de la règle. Aucun autre module (optionnel ou cœur)
  // n'appelle `µ.Store`/`µ.interpolate` en interne aujourd'hui (vérifié,
  // `µspring`/`µsmooth` partagent juste le registre `µ._mjs_interpolatorSet` de
  // mjs_init.ts, sans dépendre du FICHIER mjs_interpolate.ts) : le jour où
  // l'un en dépendrait, sa sélection devrait forcer la présence du dépendant,
  // même principe que `wantsVt` pour `router`/`ujs`.
  //
  // L'entrée utilisateur réelle (mjs.config.json → clé `runtime`) est validée
  // STRICTEMENT en amont (config.ts). Ici on reste défensif pour l'API directe
  // (tests, intégrations) : un nom inconnu est ignoré AVEC avertissement — jamais
  // un crash, jamais un module fantôme (fail-safe).
  // --------------------------------------------------------------------------
  resolveRuntimeFiles(used?: ReadonlySet<string>): { files: string[]; warnings: string[]; coreOnly: boolean } {
    const warnings: string[] = []
    // Ordre CANONIQUE de concaténation — porte aussi les gardes de patch
    // prototype : mjs_flip DOIT rester APRÈS mjs_element (qui définit µ.Element).
    // mjs_vt_presets (bibliothèque de préréglages @viewTransition) DOIT précéder
    // mjs_router ET mjs_ujs — ses deux consommateurs (routeur = <@view>, UJS =
    // permutation de PAGE) appellent tous deux `µ._mjs_vtApplyPreset` (plus
    // dans CORE, mais reste dans CANONICAL à cette position — sa présence
    // dépend de `wantsVt`, calculé après la sélection, en fin de méthode).
    // mjs_title (@title) reste à sa position historique juste APRÈS
    // mjs_element, comme mjs_flip : le hook d'attache par racine
    // (µ._mjs_titleAttach) est appelé par mjs_element.ts au constructor, mais la
    // garde `typeof µ._mjs_titleAttach === 'function'` le rend robuste à l'ordre —
    // sa présence dépend de `wantsTitle` (même fin de méthode). En 'all'
    // (avec router+ujs, i18n configuré) le résultat reste BYTE-identique à
    // l'historique.
    // mjs_dom.ts (µ._p/µ._tm/µ._def, navigation DOM et enregistrement de balise du code compilé)
    // juste après mjs_init.ts : le code émis pour la racine, pour les branches {if}/{await}/{key} et
    // pour la définition de N'IMPORTE quel composant peut les citer, aucun scan ne saurait donc le
    // rendre optionnel — toujours joint, comme le cœur.
    // mjs_alias.ts (µ._al, alias COURT d'un composant) juste derrière, à la position d'origine de
    // l'aide (elle vivait en fin de mjs_dom.ts) : elle n'est appelée que par le code émis d'un
    // composant qui porte un nom court, jamais par un autre module — seule sa présence compte.
    // mjs_deep.ts/mjs_textpool.ts/mjs_esc.ts (familles de fonctions `µ._x` détachées de
    // mjs_init.ts) juste après lui, à leur position d'origine : chacune est appelée par du code
    // ÉMIS (mutation profonde, placeholder impératif, interpolation de `<@head>`/`<@failed>`),
    // jamais par un autre module du runtime — l'ordre n'a donc aucune importance, seule leur
    // présence compte.
    // mjs_autoloader.ts (µ.Autoloader — découverte des balises `mjs-*` du document, import à la
    // demande du fichier haché de chaque composant) : du cœur en 'split', OÙ CHAQUE COMPOSANT EST
    // UN FICHIER À ALLER CHERCHER. En 'bundle' il n'a plus rien à charger — le fichier unique
    // exécute lui-même le `customElements.define` de CHAQUE composant du projet avant de rendre la
    // main, et `µ.paths` n'y pointe que ce même fichier. Retiré du cœur DANS CE SEUL MODE ;
    // `runtime: ['autoloader']` le remet (cf. `wantsByFile` en fin de méthode). La balise `mjs-*`
    // inconnue qu'il rejetait est signalée par le point d'entrée du fichier unique
    // (cf. buildBundleEntry()).
    const CORE = this.jsMode === 'bundle'
      ? ['mjs_init.ts', 'mjs_dom.ts', 'mjs_runes.ts', 'mjs_element.ts']
      : ['mjs_init.ts', 'mjs_dom.ts', 'mjs_runes.ts', 'mjs_autoloader.ts', 'mjs_element.ts']
    // Balises globales/dynamiques et runes détachées du cœur, chacune dans son propre
    // fichier : `mjs_ticker.ts` (µ.Ticker) tôt, avant ses 3 consommateurs possibles
    // (interpolate/spring/smooth) ; `mjs_rare_runes.ts`/`mjs_head.ts`/`mjs_body.ts`/
    // `mjs_dynamic.ts`/`mjs_effect.ts`/`mjs_every.ts` à la position historique de
    // mjs_runes.ts (dont ils viennent) ; `mjs_hydrate.ts`/`mjs_html.ts`/`mjs_slots.ts`/`mjs_on.ts` (patchs `µ.Element.prototype`,
    // même technique que mjs_flip) et `mjs_failed.ts` APRÈS mjs_element.ts. Les 4 blocs
    // structurels du gabarit (`mjs_for.ts`/`mjs_if.ts`/`mjs_key.ts`/`mjs_await.ts`, eux
    // aussi issus de mjs_element.ts) suivent, dans CET ordre : `if` d'abord (base commune
    // à `key`/`await`), puis `key`, puis `for` (indépendant), puis `await` — et TOUS AVANT
    // mjs_flip.ts, qui capture `_mjs_reconcileList` (mjs_for.ts) à son propre chargement.
    const CANONICAL = [
      // mjs_theme.ts juste après mjs_init.ts : sa position d'origine, avant que le bloc
      // n'en soit détaché (le thème embarqué vivait en fin de mjs_init.ts).
      // mjs_page_cache.ts DOIT précéder mjs_router.ts ET mjs_ujs.ts : mjs_ujs.ts construit
      // `µ.pageCache = new µ.LRUCache(10)` à SON PROPRE CHARGEMENT (top-level, pas dans une
      // fonction) — LRUCache doit déjà exister à cet instant.
      'mjs_init.ts', 'mjs_dom.ts', 'mjs_alias.ts', 'mjs_deep.ts', 'mjs_textpool.ts', 'mjs_esc.ts', 'mjs_theme.ts', 'mjs_lazy_css.ts', 'mjs_page_cache.ts', 'mjs_ticker.ts', 'mjs_vt_presets.ts', 'mjs_nav_progress.ts', 'mjs_easing.ts', 'mjs_interpolate.ts', 'mjs_spring.ts', 'mjs_smooth.ts',
      'mjs_store.ts', 'mjs_runes.ts', 'mjs_state.ts', 'mjs_rare_runes.ts', 'mjs_inspect.ts', 'mjs_play.ts', 'mjs_refuse.ts', 'mjs_head.ts', 'mjs_body.ts', 'mjs_dynamic.ts', 'mjs_effect.ts', 'mjs_every.ts', 'mjs_store_globals.ts', 'mjs_types.ts', 'mjs_fx.ts',
      ...FX_TOOL_KEYS.map(k => 'mjs_' + k + '.ts'),
      ...FX_KEYS.map(k => 'mjs_' + k + '.ts'), 'mjs_i18n.ts', 'mjs_journal.ts', 'mjs_ajax.ts', 'mjs_socket.ts', 'mjs_schema.ts', 'mjs_optimistic.ts', 'mjs_game.ts', 'mjs_chat.ts', 'mjs_accounts.ts', 'mjs_lobby.ts',
      'mjs_interp.ts', 'mjs_predict.ts', 'mjs_det.ts', 'mjs_lockstep.ts', 'mjs_router.ts',
      'mjs_modal.ts', 'mjs_ujs.ts', 'mjs_autoloader.ts', 'mjs_element.ts', 'mjs_hydrate.ts', 'mjs_html.ts', 'mjs_slots.ts', 'mjs_slot_events.ts', 'mjs_boundary.ts', 'mjs_element_at.ts', 'mjs_adopt_sheet.ts', 'mjs_clone.ts', 'mjs_title.ts', 'mjs_on.ts', 'mjs_emit.ts', 'mjs_context.ts', 'mjs_lifecycle.ts', 'mjs_form_reset.ts', 'mjs_form_associated.ts', 'mjs_chart.ts', 'mjs_layout_variant.ts', 'mjs_destroy_hooks.ts', 'mjs_failed.ts',
      'mjs_if.ts', 'mjs_key.ts', 'mjs_for.ts', 'mjs_for_nested.ts', 'mjs_await.ts', 'mjs_flip.ts',
    ]
    // Exception de nommage : la clé de config PUBLIQUE `runtime: ['vault']` reste
    // inchangée (rétrocompat mjs.config.json), mais le fichier qu'elle sélectionne
    // a été renommé mjs_vault.ts → mjs_store_globals.ts (contenu qui n'a plus rien
    // d'un « vault » depuis longtemps). Sans cette exception, la dérivation
    // générique `mjs_<clé>.ts` chercherait un fichier qui n'existe plus.
    const moduleFile = (m: string) => m === 'vault' ? 'mjs_store_globals.ts' : 'mjs_' + m + '.ts'
    const allOptional = () => new Set(OPTIONAL_RUNTIME_MODULES.map(moduleFile))
    // Fichiers de TOUS les modules DÉTECTÉS (title/vt_presets/store/interpolate et les
    // balises/runes détachées plus récemment) — DÉRIVÉ de DETECTED_CORE_MODULES (config.ts),
    // jamais une 2e liste à maintenir à la main.
    const DETECTED_FILES = new Set(DETECTED_CORE_MODULES.map(moduleFile))

    let selected: Set<string>
    // Noms DÉTECTÉS demandés EXPLICITEMENT (`runtime: [..., 'title'|'vt_presets']`) :
    // jamais dans `selected` (ni CŒUR ni optionnel classique), mais forcent `wantsTitle`/
    // `wantsVt` (et tous les équivalents des autres modules détectés) en fin de méthode
    // quelle que soit la sélection par ailleurs.
    const forced = new Set<string>()
    const rt = this.runtime
    if (rt === undefined) {
      // pas de `runtime` explicite → dérivé de `minimalRuntime` (rétrocompat).
      selected = this.minimalRuntime ? new Set() : allOptional()
      if (!this.minimalRuntime && !this.hasI18nConfigured()) { selected.delete('mjs_i18n.ts') }
    } else if (rt === 'all') {
      selected = allOptional()
      // mjs_i18n.ts est dans CANONICAL donc dans le cœur de
      // TOUT projet en 'all' par défaut, même sans i18n (+22 Ko constatés) : ça
      // casse l'invariant « all = byte-identique » pour les projets sans i18n.
      // Config-driven, PAS d'auto-détection par scan de code (doctrine du
      // projet) : exclu de 'all' seulement si NI config.i18n NI sourceDir/i18n/
      // n'existent (mêmes signaux que scanI18n()). Sélection EXPLICITE
      // (`runtime: ['i18n', …]`) plus haut/bas ignore ce filtre : l'explicite
      // gagne toujours, même sans dossier i18n/ (fallback runtime déjà inerte).
      if (!this.hasI18nConfigured()) { selected.delete('mjs_i18n.ts') }
    } else if (rt === 'core') {
      selected = new Set()
    } else if (rt.length > 0 && rt.every(m => FX_KEYS.includes(m) || FX_TOOL_KEYS.includes(m))) {
      // un tableau qui ne cite QUE des effets ou des outils d'effets (`runtime: ['fx_neon']`, `['fx_toolup']`, garder un
      // effet au cœur plutôt que dans son propre fichier) : ils s'AJOUTENT au cœur, la sélection reste celle d'un projet
      // sans clé `runtime` — sinon citer un effet retirerait en silence routeur, liens et requêtes
      selected = this.minimalRuntime ? new Set() : allOptional()
      if (!this.minimalRuntime && !this.hasI18nConfigured()) { selected.delete('mjs_i18n.ts') }
      for (const m of rt) forced.add(moduleFile(m))
    } else {
      selected = new Set()
      for (const m of rt) {
        const file = moduleFile(m)
        // Modules DÉTECTÉS explicites (title/vt_presets/store/interpolate et les balises/
        // runes détachées plus récemment) : traités À PART, AVANT le test CORE.includes
        // (ils n'y sont plus) — voir wantsVt/wantsTitle/wantsStore/wantsInterpolate (et tous
        // les autres) en fin de méthode.
        if (DETECTED_FILES.has(file)) { forced.add(file); continue }
        if (CORE.includes(file)) continue  // déjà dans le cœur, no-op
        if (CANONICAL.includes(file)) { selected.add(file); continue }
        this.lintPush(warnings, 'runtimeModule', t('bundler.index.runtime-module-inconnu-ignore', { module: m, modules: OPTIONAL_RUNTIME_MODULES.join(', ') }))
      }
      // Ergonomie : `ujs` pilote la nav via µ.Router/µ.ajax (refs GARDÉES → pas
      // de crash sans eux, mais interception inerte). On informe, on ne force rien.
      if (selected.has('mjs_ujs.ts') && !selected.has('mjs_router.ts')) {
        this.lintPush(warnings, 'runtimeHint', t('bundler.index.runtime-hint-ujs'))
      }
      // Ergonomie : `game` patche MjsSocket.prototype (mjs_game.ts, garde `typeof
      // MjsSocket !== 'undefined'` — jamais un crash sans lui) : sans 'socket', sock.game
      // reste indéfini pour de bon, aucun message ne peut jamais arriver côté client.
      if (selected.has('mjs_game.ts') && !selected.has('mjs_socket.ts')) {
        this.lintPush(warnings, 'runtimeHint', t('bundler.index.runtime-hint-game'))
      }
      // Ergonomie (mjs-ws/chat.ts) — MÊME esprit que 'game' ci-dessus : mjs_chat.ts
      // patche MjsSocket.prototype (garde `typeof MjsSocket !== 'undefined'` — jamais un crash sans
      // lui) : sans 'socket', sock.chat reste indéfini pour de bon, aucune trame chat:* ne peut
      // jamais arriver côté client.
      if (selected.has('mjs_chat.ts') && !selected.has('mjs_socket.ts')) {
        this.lintPush(warnings, 'runtimeHint', t('bundler.index.runtime-hint-chat'))
      }
      // Ergonomie (mjs-ws/accounts.ts) — MÊME esprit que 'chat'/'game'
      // ci-dessus : mjs_accounts.ts patche MjsSocket.prototype (garde `typeof MjsSocket !== 'undefined'`
      // — jamais un crash sans lui) : sans 'socket', sock.account reste indéfini pour de bon.
      if (selected.has('mjs_accounts.ts') && !selected.has('mjs_socket.ts')) {
        this.lintPush(warnings, 'runtimeHint', t('bundler.index.runtime-hint-accounts'))
      }
      // Ergonomie (mjs-ws/lobby.ts) — MÊME esprit que 'chat'/
      // 'accounts' ci-dessus : mjs_lobby.ts patche MjsSocket.prototype (garde `typeof MjsSocket !==
      // 'undefined'` — jamais un crash sans lui) : sans 'socket', sock.lobby reste indéfini pour de
      // bon, aucune trame lobby:* ne peut jamais arriver côté client.
      if (selected.has('mjs_lobby.ts') && !selected.has('mjs_socket.ts')) {
        this.lintPush(warnings, 'runtimeHint', t('bundler.index.runtime-hint-lobby'))
      }
      // Ergonomie — MÊME esprit que 'game' ci-dessus : mjs_schema.ts patche
      // MjsSocket.prototype ET quelques points d'extension de mjs_socket.ts (hello, binaire) pour
      // brancher µschema au réseau. Contrairement à mjs_game.ts, mjs_schema.ts n'est PAS gardé par
      // `typeof MjsSocket !== 'undefined'` — µ.schema()/µ.list()/µ.bits() (registre pur) restent
      // utilisables SEULS, cf. son en-tête — seul le branchement réseau reste inerte sans 'socket'.
      if (selected.has('mjs_schema.ts') && !selected.has('mjs_socket.ts')) {
        this.lintPush(warnings, 'runtimeHint', t('bundler.index.runtime-hint-schema'))
      }
      // Ergonomie — MÊME esprit que 'schema' ci-dessus : mjs_optimistic.ts
      // n'a AUCUNE dépendance dure à MjsSocket (`via` accepte n'importe quelle fonction -> Promise,
      // cf. sa tête de fichier) — reste utilisable SEUL (ex. via: -> fetch(...)) — mais son usage
      // TYPIQUE documenté est sock.request() : sans 'socket', µ.optimistic() reste utilisable mais
      // jamais branché au réseau MJS.
      if (selected.has('mjs_optimistic.ts') && !selected.has('mjs_socket.ts')) {
        this.lintPush(warnings, 'runtimeHint', t('bundler.index.runtime-hint-optimistic'))
      }
      // Ergonomie — MÊME esprit que 'game'/'schema' ci-dessus :
      // mjs_interp.ts/mjs_predict.ts n'ont AUCUNE dépendance dure (pas de patch prototype, cf. leurs
      // têtes de fichier), mais n'ont RIEN à observer sans une poignée sock.game() — 'game' absent
      // rend µ.interp()/µ.predict() inertes en pratique (aucun `partie` à leur passer).
      if (selected.has('mjs_interp.ts') && !selected.has('mjs_game.ts')) {
        this.lintPush(warnings, 'runtimeHint', t('bundler.index.runtime-hint-interp'))
      }
      if (selected.has('mjs_predict.ts') && !selected.has('mjs_game.ts')) {
        this.lintPush(warnings, 'runtimeHint', t('bundler.index.runtime-hint-predict'))
      }
      // Ergonomie — MÊME esprit que 'interp'/'predict' ci-
      // dessus : mjs_lockstep.ts n'a AUCUNE dépendance dure (patron 'schema'), mais n'a RIEN à piloter
      // sans une poignée sock.game() ('game' absent = µ.lockstep() inerte en pratique), NI de graine
      // déterministe sans µ.random (mjs_det.ts, module 'det' — garde `typeof µ.random === 'function'`
      // à l'exécution, cf. mjs_lockstep.ts tête de fichier : jamais un crash au CHARGEMENT, mais
      // µ.lockstep resterait indéfini pour de bon).
      if (selected.has('mjs_lockstep.ts') && !selected.has('mjs_game.ts')) {
        this.lintPush(warnings, 'runtimeHint', t('bundler.index.runtime-hint-lockstep-game'))
      }
      if (selected.has('mjs_lockstep.ts') && !selected.has('mjs_det.ts')) {
        this.lintPush(warnings, 'runtimeHint', t('bundler.index.runtime-hint-lockstep-det'))
      }
    }
    // Une appli qui se sert de la traduction (`µt`, `@i18n`) dont la sélection explicite n'embarque pas 'i18n' (liste qui l'omet, `'core'`) :
    // µ.t resterait indéfini et le premier texte traduit ferait planter le rendu. La liste explicite gagne toujours (rien n'est ajouté) : on refuse
    // la construction et on dit quoi écrire. Sans relevé de l'usage (`used` absent, appel direct), prudence : refusé aussi
    if (rt !== undefined && rt !== 'all' && !selected.has('mjs_i18n.ts') && this.hasI18nConfigured() && (used === undefined || used.has(I18N_USED))) {
      if (rt === 'core') throw new Error(t('bundler.index.runtime-sans-i18n-core'))
      throw new Error(t('bundler.index.runtime-sans-i18n-liste', { liste: '[' + [...rt, 'i18n'].map(m => `"${m}"`).join(', ') + ']' }))
    }
    // L'atelier /__mjs/theme est compilé à la volée par le serveur de développement : aucun build ne le voit, et il partage
    // le cœur de l'application. Ce que son code compilé appelle (mutations profondes, listes, blocs {if}, crochets de vie)
    // est donc joint à tout build de développement qui n'est pas un cœur nu, comme le panneau d'inspection — et jamais en
    // production, où l'atelier n'est pas servi. Passe par `forced` : aucune autre ligne de la méthode n'en dépend
    if (!this.isProd() && selected.size > 0) for (const f of ATELIER_RUNTIME) forced.add(f)
    // Conditions AJOUTÉES au filtre, indépendantes de `selected` (donc de
    // `coreOnly`, qui ne regarde QUE les optionnels classiques — cf. commentaire en tête de
    // méthode) : wantsVt = forcé explicitement, OU 'router'/'ujs' sélectionné (config pure) ;
    // le reste = forcé explicitement, OU faits INCONNUS (`used === undefined`, API directe
    // sans scan), OU le scan (`collectUsedFeatures()`, appelé par `bundleRuntime()`) a trouvé
    // le nom correspondant.
    const wantsVt          = forced.has('mjs_vt_presets.ts') || selected.has('mjs_router.ts') || selected.has('mjs_ujs.ts')
    // la barre de navigation : même règle de configuration pure — ses deux consommateurs, le routeur
    // et les liens/formulaires (mjs_ujs.ts)
    const wantsNavProgress = forced.has('mjs_nav_progress.ts') || selected.has('mjs_router.ts') || selected.has('mjs_ujs.ts')
    const wantsTitle       = forced.has('mjs_title.ts') || used === undefined || used.has('title')
    // wantsTheme : DÉTECTÉ (used.has('theme'), cf. collectUsedFeatures/scanCompiledFeatures
    // pour le CSS/JS compilé + le signal fichier `*.theme.mjs`), OU FORCÉ, OU consommateur
    // sélectionné — VÉRIFIÉ par grep `var\(--mjs-` dans src/runtime/*.ts (mjs_modal.ts/
    // mjs_title.ts lisent RÉELLEMENT une des 8 variables canoniques ; mjs_page_cache.ts/
    // mjs_vt_presets.ts/mjs_devpanel.ts ont chacun leur propre espace `--mjs-<module>-*`, aucun
    // des trois n'en lit une — écartés de cette liste, cf. bandeau de mjs_theme.ts). `wantsTitle`
    // déjà calculé juste au-dessus le couvre pour 'title' (forcé ou détecté, mêmes règles).
    const wantsTheme       = forced.has('mjs_theme.ts') || used === undefined || used.has('theme') || selected.has('mjs_modal.ts') || wantsTitle
    const wantsStore       = forced.has('mjs_store.ts') || used === undefined || used.has('store')
    // Store global (`µ.store`, `µ._storeDeclare`, mjs_store_globals.ts) : module optionnel `vault`, mais
    // un module qui lit ou écrit `µlang` en émet la déclaration de la clé cachée — c'est le cas des
    // modules cœur à libellé. Détecté seulement sur un scan (jamais sur des faits inconnus : la
    // sélection par défaut le porte déjà, et `runtime: []` en API directe reste un cœur nu).
    // La traduction (mjs_i18n.ts) en dépend aussi : la langue voulue (`?lang=`, préférence mémorisée, navigateur) et
    // la bascule du démarrage passent par la clé cachée `__mjsLang` et son guetteur. Elle l'emporte donc avec elle :
    // une liste `runtime` qui nomme 'i18n' sans 'vault' (`["hydrate", "i18n"]`, celle que la doc recommande) n'est pas
    // une appli dont la langue voulue est ignorée
    const wantsStoreGlobals = selected.has('mjs_i18n.ts') || (used !== undefined && used.has('lang'))
    const wantsInterpolate = forced.has('mjs_interpolate.ts') || used === undefined || used.has('interpolate')
    // Balises globales/dynamiques : chacune détectée par son propre nom (voir
    // collectUsedFeatures). `wantsHead`/`wantsBody`/`wantsDynamic` alimentent EN
    // PLUS `wantsEffect` juste plus bas : les 3 macros émettent elles-mêmes un `µeffect =>`
    // autour de leur appel runtime, aucun scan séparé n'est nécessaire pour cette dépendance.
    const wantsHead      = forced.has('mjs_head.ts') || used === undefined || used.has('head')
    const wantsBody      = forced.has('mjs_body.ts') || used === undefined || used.has('body')
    const wantsDynamic   = forced.has('mjs_dynamic.ts') || used === undefined || used.has('dynamic')
    const wantsRareRunes = forced.has('mjs_rare_runes.ts') || used === undefined || used.has('rare_runes')
    const wantsInspect   = forced.has('mjs_inspect.ts') || used === undefined || used.has('inspect')
    const wantsPlay      = forced.has('mjs_play.ts') || used === undefined || used.has('play')
    // champ nombre lié dont la saisie est refusée (mjs_refuse.ts) : le gestionnaire de saisie compilé d'un
    // `value=!{$x}` au type possiblement `number` l'appelle ; son rappel dans `_set` est gardé par un champ
    // que seul cet appel pose — détecté DIRECTEMENT, aucun forçage
    const wantsRefuse    = forced.has('mjs_refuse.ts') || used === undefined || used.has('refuse')
    // clic et survol du contenu glissé (mjs_slot_events.ts) : le routeur d'événements d'un composant les appelle
    // quand l'événement vient d'hors de son arbre, ce que seul un `<slot>` de son gabarit rend possible — détecté
    // DIRECTEMENT (un `<slot>` compilé, features.ts), aucun forçage
    const wantsSlotEvents = forced.has('mjs_slot_events.ts') || used === undefined || used.has('slot_events')
    // entrée/sortie de survol (mjs_boundary.ts) : `_mjs_bindEvents` n'y recourt que pour les quatre événements
    // `pointerenter`/`pointerleave`/`mouseenter`/`mouseleave` écrits dans un gabarit — détecté DIRECTEMENT, aucun forçage
    const wantsBoundary  = forced.has('mjs_boundary.ts') || used === undefined || used.has('boundary')
    const wantsOn        = forced.has('mjs_on.ts') || used === undefined || used.has('on')
    // Mutations PROFONDES (`µ._mjs_deepSet`/`_mjs_deepCall`/`_mjs_deepDelete`/`_mjs_makeDeepProxy`,
    // mjs_deep.ts) : appelées par le seul code émis au niveau du composant (suiveur de chemins,
    // rune `µproxy`), jamais par un autre module du runtime — détectées DIRECTEMENT.
    const wantsDeep      = forced.has('mjs_deep.ts') || used === undefined || used.has('deep')
    // Pool de nœuds texte (mjs_textpool.ts) : `µ._mjs_getTextNode(` n'est émis que par le mode
    // IMPÉRATIF du générateur. La LIBÉRATION part avec (`µ._mjs_recycleTextLeaves`, appelée sous
    // garde par `_mjs_destroyNodeAndChildren`) : remplir un pool où personne ne puise ne ferait que
    // retenir des nœuds morts.
    const wantsTextPool  = forced.has('mjs_textpool.ts') || used === undefined || used.has('textpool')
    // `_mjs_updHtml` (interpolation brute `{{…}}`) : appelée par le seul code émis au niveau du
    // composant, jamais par un autre module du runtime — détectée DIRECTEMENT, aucun forçage.
    const wantsHtml      = forced.has('mjs_html.ts') || used === undefined || used.has('html')
    // `_mjs_injectSlots` (slots indexés) : appelée par le seul constructeur compilé d'un composant qui
    // écrit `<@slot` — détectée DIRECTEMENT, aucun forçage.
    const wantsSlots     = forced.has('mjs_slots.ts') || used === undefined || used.has('slots')
    const wantsEvery     = forced.has('mjs_every.ts') || used === undefined || used.has('every')
    const wantsFailed    = forced.has('mjs_failed.ts') || used === undefined || used.has('failed')
    // wantsEffect : détecté DIRECTEMENT (µeffect/@persist/µdebug $x/<@window scrollX|scrollY>,
    // cf. collectUsedFeatures) OU FORCÉ par <@head>/<@body>/<@html>/<@element>/<@module>, qui
    // s'appuient tous sur `µ.effect` en silence (aucun des deux ne laisse le mot « effect »
    // dans le source du projet).
    const wantsEffect = forced.has('mjs_effect.ts') || used === undefined || used.has('effect') || wantsHead || wantsBody || wantsDynamic
    // wantsTicker : détecté DIRECTEMENT, OU FORCÉ dès que spring/smooth/interpolate est du
    // bundle — les trois appellent `µ.Ticker.add(...)` sans aucune garde (cf. mjs_ticker.ts).
    const wantsTicker = forced.has('mjs_ticker.ts') || used === undefined || used.has('ticker') || wantsInterpolate || selected.has('mjs_spring.ts') || selected.has('mjs_smooth.ts')
    // Les 4 blocs structurels (`{for}`/`{if}`/`{key}`/`{await}`) — briques les plus
    // élémentaires du gabarit, mêmes garanties fail-safe que le reste : jamais un faux négatif
    // (used === undefined OU la forme SOURCE trouvée par le scan). `wantsKey`/`wantsAwait`
    // FORCENT wantsIf EN PLUS : `_mjs_updKey` (mjs_key.ts) appelle `_mjs_tryReviveDying`/
    // `_mjs_resetNestedMemos`, `_mjs_updAwait` (mjs_await.ts) appelle `_mjs_updIf` — les deux vivent
    // dans mjs_if.ts. `wantsFor` est EN PLUS forcé dès que `flip` est du bundle (`selected`,
    // optionnel classique) : `mjs_flip.ts` capture `_mjs_reconcileList` (mjs_for.ts) à son PROPRE
    // chargement, même raison que `wantsTicker` forcé par spring/smooth ci-dessus.
    // `_mjs_updList` (mjs_for_nested.ts) : la variante d'un `{for}` dans une autre liste ou dans une
    // branche `{await}` — détectée DIRECTEMENT sur l'appel émis. Elle appelle
    // `_mjs_reconcileList` (mjs_for.ts) sans garde : elle FORCE donc `wantsFor` juste en dessous,
    // pour le cas d'une demande explicite `runtime: ['for_nested']` (un projet qui écrit un
    // `{for}` imbriqué écrit forcément `{for `, déjà détecté).
    const wantsForNested = forced.has('mjs_for_nested.ts') || used === undefined || used.has('for_nested')
    const wantsFor   = forced.has('mjs_for.ts') || used === undefined || used.has('for') || selected.has('mjs_flip.ts') || wantsForNested
    const wantsKey   = forced.has('mjs_key.ts') || used === undefined || used.has('key')
    const wantsAwait = forced.has('mjs_await.ts') || used === undefined || used.has('await')
    const wantsIf    = forced.has('mjs_if.ts') || used === undefined || used.has('if') || wantsKey || wantsAwait
    // `_mjs_emit` : self-contained (aucune méthode du cœur ne l'appelle elle-même), détecté
    // DIRECTEMENT (µemit/@emit.NOM/@click.emit.NOM, cf. collectUsedFeatures) — aucun forçage.
    const wantsEmit  = forced.has('mjs_emit.ts') || used === undefined || used.has('emit')
    // `µ._mjs_fetchLazyCss` : AUCUN scan — signal de CONFIG pure (comme `wantsVt` pour
    // router/ujs), `this.cssMode` connu dès l'appel (pas besoin d'attendre
    // `this.lazyStyleUrls`, rempli PLUS TARD dans le pipeline, étape 2 — cf.
    // `finalizeLazyStyles`). `css: 'lazy'` sans aucune feuille partagée réellement
    // paresseuse au final n'écrirait pas `µ._cssLazy` : embarquer quand même est le seul
    // sens sûr (faux positif accepté, jamais l'inverse).
    const wantsLazyCss = forced.has('mjs_lazy_css.ts') || this.cssMode === 'lazy'
    // Échappement HTML (`µ._esc`, mjs_esc.ts) : détecté DIRECTEMENT (une interpolation dans un
    // `<@head>` ou dans le repli d'un `<@failed>` émet l'appel), OU joint D'OFFICE dans un build
    // de DÉVELOPPEMENT non nu — mjs_devinspect.ts/mjs_devpanel.ts l'appellent sans garde pour
    // leur propre affichage, et ces trois-là ne sont insérés qu'aux MÊMES conditions
    // (`!coreOnly && !isProd()`, cf. bundleRuntime). `selected.size > 0` ≡ `!coreOnly`, calculé
    // ici comme en fin de méthode.
    const wantsEsc = forced.has('mjs_esc.ts') || used === undefined || used.has('esc') || (!this.isProd() && selected.size > 0)
    // Hydratation SSR par adoption (`_mjs_hydrate` + les 3 approches, mjs_hydrate.ts) : AUCUN
    // scan — signal de CONFIG pure, comme `wantsLazyCss` juste au-dessus. Le bloc `render` dit
    // le mode de chaque page ; seuls `ssr:markers`/`ssr:positional`/`ssr:diff` adoptent le DOM
    // du serveur. `csr`/`prerender` n'ont rien à adopter, `ssr`/`ssr:replace` (défaut) jette la
    // photo serveur et reconstruit la vue : aucun des trois n'appelle ces méthodes. Un serveur
    // qui rend par l'API SANS bloc `render` (ou une page qui demande un mode d'hydratation par
    // en-tête HTTP sur une route configurée `ssr`) le réclame par `runtime: ['hydrate']` — sans
    // lui, le cœur avertit une fois et reconstruit la vue (cf. `_mjs_mount`, mjs_element.ts).
    const wantsHydrate = forced.has('mjs_hydrate.ts') || this.hydrateWanted()
    // `µ.Autoloader` : AUCUN scan — signal de MODE pur (cf. le bandeau de `CORE` en tête de
    // méthode). En 'split' il est DANS le cœur, cette valeur n'y est jamais consultée ; en
    // 'bundle' il n'entre que sur demande EXPLICITE (`runtime: ['autoloader']`).
    const wantsAutoloader = forced.has('mjs_autoloader.ts')
    // Cache de pages (LRUCache/_mjs_isPageCached/_mjs_destroyEvictedTree/_mjs_routeErrorCss) : AUCUN
    // scan — signal de config pure, comme `wantsVt`. `router`/`ujs` en dépendent tous les deux
    // (mjs_ujs.ts construit `new µ.LRUCache(10)` À SON CHARGEMENT, sans garde) ; `modal` est
    // inclus aussi (faux positif accepté sur LRUCache si 'modal' est seul). Les libellés
    // (_mjs_label/_mjs_labelLang) vivent dans le cœur (mjs_init.ts) : les modules cœur les lisent.
    const wantsPageCache = forced.has('mjs_page_cache.ts') || selected.has('mjs_router.ts') || selected.has('mjs_ujs.ts') || selected.has('mjs_modal.ts')
    // Crochets de cycle de vie (runes µmount/µawake/µsleep/µdestroy/µurlChange/µfailed nu, balises
    // globales qui s'attachent par `@_mjs_hook`) : détecté DIRECTEMENT, OU FORCÉ par un appelant
    // de l'API de destruction — `every` (µ.every appelle `_mjs_onDestroy`/`_mjs_onSleep`/`_mjs_onAwake` SANS
    // garde `typeof`), `interpolate` (le composant qui reçoit un interpolateur en devient le
    // propriétaire, `_mjs_attachInvalidator`), `smooth`/`socket` (option `owner`) et le cache de pages
    // (l'éviction appelle `_mjs_runDestroyCallbacks`). Chez ces quatre-là la garde `typeof` évite le
    // crash, pas la fuite : sans ce fichier, rien n'est plus défait à la destruction.
    const wantsLifecycle = forced.has('mjs_lifecycle.ts') || used === undefined || used.has('lifecycle') || wantsEvery || wantsInterpolate || selected.has('mjs_smooth.ts') || selected.has('mjs_socket.ts') || wantsPageCache
    // Contexte §/§§ : self-contained (jamais appelé par le cœur lui-même — les deux
    // compteurs qu'il touche, `_mjs_rctx_cache`/`µ._mjs_rctxEpoch`, restent lus/écrits par
    // connectedCallback/disconnectedCallback SANS passer par ce fichier), détecté DIRECTEMENT.
    const wantsContext = forced.has('mjs_context.ts') || used === undefined || used.has('context')
    // `µ.state` (mjs_state.ts) : la rune publique, détectée sur l'appel écrit par le projet (`.state` dans
    // le code compilé) — ET jointe d'office avec ceux du runtime qui l'appellent : le contexte §§
    // (sans garde), le store global (µ.nav, µ.res, µ._mjs_env), le routeur (µ.url) et les modules de
    // jeu/messagerie/connexion/lissage, qui en bâtissent un état réactif. Ils partent avec `used === undefined`
    // dans tous les cas où le fichier part lui-même.
    const MODULES_A_STATE = ['mjs_router.ts', 'mjs_smooth.ts', 'mjs_socket.ts', 'mjs_game.ts', 'mjs_chat.ts', 'mjs_lobby.ts', 'mjs_accounts.ts', 'mjs_interp.ts', 'mjs_predict.ts', 'mjs_lockstep.ts', 'mjs_store_globals.ts']
    const wantsState = forced.has('mjs_state.ts') || used === undefined || used.has('state') || wantsContext || wantsStoreGlobals || MODULES_A_STATE.some(f => selected.has(f))
    // Variants de mise en page nommés (tail de _mjs_applyLayout) : détecté par la DÉCLARATION
    // (`<style name="…">` dans une source, fichier `<module>.<nom>.css` déposé dans le dossier de
    // sortie) ou par les mots `layout=`/`template=` — la demande seule peut venir d'une page que
    // le build ne lit pas, cf. collectUsedFeatures.
    const wantsLayoutVariant = forced.has('mjs_layout_variant.ts') || used === undefined || used.has('layout_variant')
    // Chemin LENT de destruction (transitions/@attach/@this=!/@flip) : détecté par les 5 SEULS
    // émetteurs compilateur de `hasDestroyHooks = true` — jamais de forçage nécessaire (aucun
    // autre module optionnel ne pose de transitions/teardowns lui-même ; `mjs_flip.ts`, seul
    // suspect, ne référence ni `_mjs_dying` ni `_mjs_destroyWithHooks`, vérifié).
    const wantsDestroyHooks = forced.has('mjs_destroy_hooks.ts') || used === undefined || used.has('destroy_hooks')
    // `µ._al` (alias COURT d'une balise) : appelée par le seul code émis d'un composant qui porte un
    // nom court, jamais par un autre module du runtime — détectée DIRECTEMENT, aucun forçage. Le nom
    // reste RÉSERVÉ au raccourcisseur même quand le module n'est pas du bundle (cf. CORE_HELPER_NAMES,
    // bundler/minify.ts) : rien ne doit pouvoir le donner à une propriété interne portée par µ.
    const wantsAlias = forced.has('mjs_alias.ts') || used === undefined || used.has('alias')
    // types et valeurs permises (mjs_types.ts) : appelé par le cœur (`_set`, mutations profondes,
    // stores) SEULEMENT derrière une règle posée par un composant qui écrit un `<vars>` — détecté
    // directement dans son code compilé, aucun forçage
    const wantsTypes = forced.has('mjs_types.ts') || used === undefined || used.has('types')
    // effets `*nom` (mjs_fx.ts, le moteur) et le fichier de chaque effet ÉCRIT dans un gabarit —
    // détectés directement dans le code compilé (`µ._mjs_fx(this, _mjs_fxn, "nom", …)`)
    const wantsFx = forced.has('mjs_fx.ts') || used === undefined || used.has('fx')
    const wantsFxFiles: Record<string, boolean> = {}
    for (const k of FX_KEYS) {
      const f = 'mjs_' + k + '.ts'
      wantsFxFiles[f] = forced.has(f) || used === undefined || used.has(k)
    }
    // le moteur qui joue les transitions (mjs_easing.ts : _mjs_whenLayouted, _mjs_playTransition, _mjs_runTransition, µ.anim) est celui du
    // module optionnel `easing`, que `runtime` le nomme ou non ; or le code émis pour `@in`/`@out`/`@transition` et le fichier des
    // transitions (mjs_fx_transition.ts) l'appellent, faute de quoi l'entrée échoue et la sortie est sautée : il suit ce fichier. Sur
    // un scan seulement (jamais sur des faits inconnus : la sélection par défaut le porte déjà, et `runtime: []` en API directe reste
    // un cœur nu)
    const wantsEasing = used !== undefined && wantsFxFiles['mjs_fx_transition.ts']
    // l'élément sous un point (mjs_element_at.ts) : le code écrit par le projet (`µ.elementAt(`) et les trois effets en
    // direct qui l'appellent (*follow, *heatmap, *cursors) — leurs fichiers l'entraînent, qu'ils soient au cœur ou
    // dans leur propre fichier en construction découpée
    const wantsElementAt = forced.has('mjs_element_at.ts') || used === undefined || used.has('element_at') || ['mjs_fx_follow.ts', 'mjs_fx_heatmap.ts', 'mjs_fx_cursors.ts'].some(f => wantsFxFiles[f])
    // coller une feuille dans l'ombre d'un composant (mjs_adopt_sheet.ts) : seul le code écrit par le projet (`µ.adoptSheet(`) l'appelle, aucun forçage
    const wantsAdoptSheet = forced.has('mjs_adopt_sheet.ts') || used === undefined || used.has('adopt_sheet')
    // copier un composant avec son état (mjs_clone.ts) : le code écrit par le projet (`µclone el`, `µ.clone(`) l'appelle, et la piste des enfants de *marquee,
    // dont la copie d'un composant est son miroir vivant — seulement si cette piste part dans ce build (cf. sortedEffect : une appli qui ne fait défiler que du
    // texte ne l'a pas) ; aucun forçage
    const wantsClone = forced.has('mjs_clone.ts') || used === undefined || used.has('clone') || (!!wantsFxFiles['mjs_fx_marquee.ts'] && this.effectCalls('mjs_fx_marquee.ts', used, '_mjs_mirrorOf'))
    // la remise à zéro d'un formulaire, écrite une fois pour les modules de saisie du cœur (mjs_form_reset.ts) : détectée DIRECTEMENT sur l'appel
    // `µ._mjs_formReset(` que ces modules écrivent à leur montage — aucun forçage, aucune dépendance à `ujs`
    const wantsFormReset = forced.has('mjs_form_reset.ts') || used === undefined || used.has('form_reset')
    // le socle des composants associés au formulaire (mjs_form_associated.ts) : détecté DIRECTEMENT sur l'appel `µ._mjs_formClass(` que le
    // compilateur écrit pour un composant `@formAssociated` — aucun forçage
    const wantsFormAssociated = forced.has('mjs_form_associated.ts') || used === undefined || used.has('form_associated')
    // les calculs des graphiques (mjs_chart.ts) : détectés DIRECTEMENT sur `µ._mjs_chart` que les modules de graphiques du cœur écrivent — aucun
    // forçage, aucun nom dans `runtime` : une application sans graphique ne les reçoit jamais
    const wantsChart = used === undefined || used.has('chart')
    // les outils partagés des effets (mjs_fx_tool<nom>.ts, bundler/fx-tools.ts) : seulement ceux que le code des effets de la page appelle, tel
    // qu'il part dans ce build (le fichier trié en production, entier en développement : cf. effectSource), au cœur comme dans son propre
    // fichier (un effet nommé à l'exécution, `fx: $effet`, peut être n'importe lequel de ceux qui se nomment : tous les fichiers partent alors
    // en entier et les outils de ceux-là viennent) ; demandés par leur nom (`runtime: ['fx_toolbox']`), ils viennent avec ce qu'ils demandent
    // et avec le moteur des effets (µ._mjs_dom) ; en 'all', ils viennent tous
    const named      = used !== undefined && used.has(FX_NAMED)
    const asked      = FX_TOOL_KEYS.filter(k => forced.has('mjs_' + k + '.ts'))
    const inPage     = (k: string) => (named && FX_NAMEABLE_KEYS.includes(k)) || !!wantsFxFiles['mjs_' + k + '.ts']
    const called     = used === undefined ? undefined : this.fxToolsCalledBy(FX_KEYS.filter(inPage), used)
    const wantsTools = fxToolsWanted(inPage, FX_TOOLS, asked, called)
    const wantsByFile: Record<string, boolean> = {
      ...wantsFxFiles,
      ...Object.fromEntries(Object.keys(FX_TOOLS).map(k => ['mjs_' + k + '.ts', forced.has('mjs_' + k + '.ts') || used === undefined || wantsTools.has(k)])),
      'mjs_fx.ts':          wantsFx || Object.values(wantsFxFiles).some(Boolean) || asked.length > 0,
      'mjs_easing.ts':      wantsEasing,
      'mjs_autoloader.ts':  wantsAutoloader,
      'mjs_vt_presets.ts':  wantsVt,
      'mjs_nav_progress.ts': wantsNavProgress,
      'mjs_title.ts':       wantsTitle,
      'mjs_theme.ts':       wantsTheme,
      'mjs_store.ts':       wantsStore,
      'mjs_store_globals.ts': wantsStoreGlobals,
      'mjs_interpolate.ts': wantsInterpolate,
      'mjs_head.ts':        wantsHead,
      'mjs_body.ts':        wantsBody,
      'mjs_dynamic.ts':     wantsDynamic,
      'mjs_rare_runes.ts':  wantsRareRunes,
      'mjs_inspect.ts':     wantsInspect,
      'mjs_play.ts':        wantsPlay,
      'mjs_refuse.ts':      wantsRefuse,
      'mjs_slot_events.ts': wantsSlotEvents,
      'mjs_boundary.ts':    wantsBoundary,
      'mjs_element_at.ts':  wantsElementAt,
      'mjs_adopt_sheet.ts': wantsAdoptSheet,
      'mjs_clone.ts':       wantsClone,
      'mjs_form_reset.ts':  wantsFormReset,
      'mjs_form_associated.ts': wantsFormAssociated,
      'mjs_chart.ts':       wantsChart,
      'mjs_on.ts':          wantsOn,
      'mjs_alias.ts':       wantsAlias,
      'mjs_types.ts':       wantsTypes,
      'mjs_deep.ts':        wantsDeep,
      'mjs_textpool.ts':    wantsTextPool,
      'mjs_esc.ts':         wantsEsc,
      'mjs_html.ts':        wantsHtml,
      'mjs_slots.ts':       wantsSlots,
      'mjs_effect.ts':      wantsEffect,
      'mjs_every.ts':       wantsEvery,
      'mjs_ticker.ts':      wantsTicker,
      'mjs_failed.ts':      wantsFailed,
      'mjs_for.ts':         wantsFor,
      'mjs_for_nested.ts':  wantsForNested,
      'mjs_if.ts':          wantsIf,
      'mjs_key.ts':         wantsKey,
      'mjs_await.ts':       wantsAwait,
      'mjs_emit.ts':        wantsEmit,
      'mjs_lazy_css.ts':    wantsLazyCss,
      'mjs_hydrate.ts':     wantsHydrate,
      'mjs_page_cache.ts':  wantsPageCache,
      'mjs_context.ts':     wantsContext,
      'mjs_state.ts':       wantsState,
      'mjs_lifecycle.ts':   wantsLifecycle,
      'mjs_layout_variant.ts': wantsLayoutVariant,
      'mjs_destroy_hooks.ts': wantsDestroyHooks,
    }
    const files = CANONICAL.filter(f => CORE.includes(f) || selected.has(f) || wantsByFile[f])
    return { files, warnings, coreOnly: selected.size === 0 }
  }

  // --------------------------------------------------------------------------
  // renderUsesHydration() : le projet déclare-t-il une PAGE rendue dans un mode qui ADOPTE le
  // DOM du serveur (cf. HYDRATING_MODES) ? Lit les modes du bloc `render` — `render.default` et
  // le `mode` de chaque route — sous leur forme CANONIQUE (`normalizeMode`, seule source de
  // vérité : `ssr` ≡ `ssr:replace`). Une route sans `mode` hérite de `render.default`, testé à
  // part : rien à dériver ici. Aucune lecture de disque, aucun scan de code — cette réponse ne
  // dépend que de la configuration, connue dès la construction du Bundler.
  // --------------------------------------------------------------------------
  private renderUsesHydration(): boolean {
    const render = this.render
    if (!render) return false
    const adopte = (mode: RenderMode | undefined): boolean => mode !== undefined && HYDRATING_MODES.has(normalizeMode(mode))
    if (adopte(render.default)) return true
    for (const route of Object.values(render.routes ?? {})) {
      if (adopte(route?.mode)) return true
    }
    return false
  }

  // --------------------------------------------------------------------------
  // hydrateWanted() : le moteur de reprise (mjs_hydrate.ts) part-il dans ce build ? Réglage pur : demandé par `runtime: [..., 'hydrate']` (un serveur qui rend par
  // l'API sans bloc `render`), ou une page rendue dans un mode qui adopte le DOM du serveur (renderUsesHydration). La décision du moteur et celle du code
  // d'état de départ des modules de saisie (coreResumeWanted) sont celle-ci, écrite une seule fois.
  // --------------------------------------------------------------------------
  private hydrateWanted(): boolean {
    return (Array.isArray(this.runtime) && this.runtime.includes('hydrate')) || this.renderUsesHydration()
  }

  // --------------------------------------------------------------------------
  // runtimeLabelGroups() : les groupes de libellés du manifeste (src/runtime-labels.ts) dont un
  // lecteur part dans ce build. modal/toast ↔ mjs_modal.ts ; router ↔ mjs_router.ts et mjs_ujs.ts
  // (le panneau 404 lit les libellés du routeur) ; ujs ↔ mjs_ujs.ts ; fx ↔ un fichier d'effet qui
  // écrit un texte (FX_LABEL_EFFECTS : garde, hors ligne, chargement, texte masqué, carte), dans le cœur comme à part ;
  // core ↔ un module cœur que le build emporte et qui a des libellés (CORE_LABEL_MODULES, cf. coreLabelModules),
  // ou un fichier du projet qui lit lui-même le groupe (`coreModules` indéfini).
  // `selectedFiles` contient aussi les effets partis dans leur propre fichier.
  // --------------------------------------------------------------------------
  private runtimeLabelGroups(selectedFiles: readonly string[], coreModules: ReadonlySet<string> | undefined, fxEffects: ReadonlySet<string>): Set<string> {
    const groups = new Set<string>()
    const has = (f: string) => selectedFiles.includes(f)
    if (has('mjs_modal.ts')) { groups.add('modal'); groups.add('toast') }
    if (has('mjs_router.ts') || has('mjs_ujs.ts')) groups.add('router')
    if (has('mjs_ujs.ts')) groups.add('ujs')
    if (fxLabelKeys(fxEffects).size > 0) groups.add('fx')
    if (coreModules === undefined || coreLabelKeys(coreModules).size > 0) groups.add('core')
    return groups
  }

  // --------------------------------------------------------------------------
  // coreLabelModules() : les modules cœur dont le manifeste pose les libellés par défaut (groupe `core`, cf.
  // CORE_LABEL_MODULES dans runtime-labels.ts) — ceux que CE build emporte : référencés par l'appli (<@@nom>,
  // <mjs-core-nom>), puis, jusqu'au point fixe, par les modules déjà emportés (<@@editor> pose <@@toolbar>).
  // resolveTagShortcuts() les a tous compilés sous la clé `core-<nom>` de manifestSources (`core-<nom>--<modèle>` pour un
  // modèle en fichier, qui lit les mêmes clés que son module) : aucun autre calcul de transitivité ici.
  // `undefined` = faits inconnus, le groupe part ENTIER : un fichier du PROJET lit lui-même le groupe `core` (la copie
  // éjectée d'un module cœur, qui garde ses `µ._mjs_label('core', …)`), et rien ne dit lesquelles de ses clés il lit.
  // Lecture rapide et mémoïsée de chaque source (cf. scanSource) ; les fichiers du catalogue cœur ne sont pas relus.
  // --------------------------------------------------------------------------
  private coreLabelModules(): Set<string> | undefined {
    const modules = new Set<string>()
    for (const [key, file] of this.manifestSources) {
      if (key.startsWith('core-')) {
        modules.add(key.slice(5).split('--')[0])
        continue
      }
      if (this.scanSource('coreLabelRead', file, false, (src) => REGEX_CORE_LABEL_READ.test(src))) return undefined
    }
    return modules
  }

  // --------------------------------------------------------------------------
  // collectUsedFeatures() (remplace l'ancien balayage TEXTUEL de sourceDir, supprimé) :
  // union des signaux compilés de TOUTES les unités du tour —
  // `this.pendingFeatures`, alimenté par CHAQUE unité fraîchement compilée (compileMjsCold/
  // compileScriptModuleCold/prepareExternalManifest, sur la sortie NON MINIFIÉE, cf.
  // src/bundler/features.ts) ET par chaque cache-hit CANDIDAT (`cached.features`
  // réinjecté par _compileMjsInner/_compileScriptModuleInner, jumeau de usedAnimations) —
  // PLUS le signal fichier variant déposé À LA MAIN dans outputDir (`<module>.<nom>.css`),
  // seule demande qui vienne d'un endroit que la construction ne compile JAMAIS.
  //
  // Le compilateur GÈNE ces symboles de façon stable (appel littéral, attribut posé, champ
  // de données) : les lire dans le CODE ÉMIS élimine tout faux positif de commentaire/chaîne
  // (`<!-- {for x in xs} -->`, `'µ.Store'`) SANS jamais risquer de faux négatif — un vrai
  // usage produit TOUJOURS la même forme compilée, quelle que soit l'écriture source (sigil
  // `µ`/`mjs`, {if}/{key} niché ou racine…). Appelée en PHASE B de compile(), une fois
  // TOUTES les unités compilées en mémoire (phase A) — jamais avant.
  // --------------------------------------------------------------------------
  private collectUsedFeatures(): Set<string> {
    const used = new Set(this.pendingFeatures)
    // variant déposé à la main (`<module>.<nom>.css`) : le runtime le réclame à l'URL du
    // dossier de sortie — noms seulement, aucun lien suivi, dossier absent = rien. Premier niveau seul (le runtime ne
    // lit jamais un sous-dossier) et `<module>` doit être une clé du manifeste : une feuille tierce
    // (`vendor/bootstrap.min.css`, `app.min.css`) n'est pas une variante
    if (!used.has('layout_variant') && existsSync(this.outputDir)) {
      const keys = new Set(Array.from(this.manifestSources.keys(), (k) => k.toLowerCase()))
      for (const name of readdirSync(this.outputDir)) {
        const m = REGEX_VARIANT_FILE.exec(name)
        if (m && keys.has(m[1].toLowerCase())) { used.add('layout_variant'); break }
      }
    }
    // signal fichier `*.theme.mjs` : posé par compileThemeFiles() (phase A, AVANT cet
    // appel, cf. compile()) dans this.themeNames — aucun composant n'a besoin de LIRE le thème
    // pour que le projet en ait un à servir (µtheme doit pouvoir l'accepter, la feuille
    // d'application doit exister pour le recevoir).
    if (this.themeNames.length > 0) used.add('theme')
    // l'attente des textes traduits écrite dans la configuration (`i18n.placeholder`) : l'indicateur de chargement (son fichier d'effet, le moteur
    // et l'accroche du cœur), même si aucune page ne l'écrit
    const attente = this.i18nAttente()
    if (attente?.mode === '*loader') {
      used.add(I18N_LOADER)
      used.add('fx')
      used.add('fx_loader')
    }
    // la silhouette des composants dont le code arrive (`effects.skeleton` ∋ 'components') : l'effet
    // qui la pose, et son moteur, même sans *skeleton écrit
    if (this.effectsConf?.skeleton?.includes('components')) {
      used.add('fx')
      used.add('fx_skeleton')
    }
    return used
  }

  // --------------------------------------------------------------------------
  // componentSkeletons() : la silhouette des composants dont le code arrive (µ._skels, au
  // manifeste) — pour chaque composant quand `effects.skeleton` cite 'components', sinon pour ceux
  // dont une balise porte `*skeleton` dans un gabarit du projet (`<@carte *skeleton>`). Tirée de son
  // gabarit par skeletonHtml ; un gabarit qui ne s'analyse pas n'en a pas (le composant arrive nu,
  // comme avant). Clés : le nom de la balise sans `mjs-`, en minuscules.
  // --------------------------------------------------------------------------
  private componentSkeletons(): Record<string, string> {
    const tous  = !!this.effectsConf?.skeleton?.includes('components')
    // les demandes du tour, relevées par _compileMjsInner dans les sources qu'il lit (cf. pendingSkeletonTargets)
    const vises = this.pendingSkeletonTargets
    if (!tous && vises.size === 0) return {}
    const out: Record<string, string> = {}
    for (const [key, f] of [...this.manifestSources.entries()].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)) {
      // une silhouette se tire d'un gabarit : un module .civet/.coffee n'en a pas
      if (!f.endsWith('.mjs')) continue
      const nom = key.toLowerCase()
      if (!tous && !vises.has(nom)) continue
      const html = this.scanSource('skeleton', f, '', (src) => {
        try {
          const sections = extractSections(src)
          return skeletonHtml(sections.html, sections.htmlStartLine)
        }
        catch {
          return ''   // un gabarit qui ne s'analyse pas n'en a pas : le composant arrive nu, comme avant
        }
      })
      if (html) out[nom] = html
    }
    return out
  }

  // --------------------------------------------------------------------------
  // collectTypedStores(files) : les stores typés du projet (cf. typedStoresOf), relevés AVANT toute
  // transpilation — chaque source n'est relue que si elle a changé depuis le tour précédent (cf. scanSource)
  // --------------------------------------------------------------------------
  private collectTypedStores(files: string[]): string[] {
    const out = new Set<string>()
    for (const f of files) {
      for (const s of this.scanSource('typedStores', f, [] as string[], typedStoresOf)) out.add(s)
    }
    return [...out].sort()
  }

  // --------------------------------------------------------------------------
  // scanSource(kind, file, fallback, scan) : ce qu'une lecture rapide tire d'une source (ses stores
  // typés, sa silhouette), mémoïsé d'un tour à l'autre par (mtimeNs, taille) — une source inchangée
  // n'est plus relue à chaque compile() de `mjs dev`. Même règle de fraîcheur que depDigest : un
  // fichier écrit à partir du début de CE tour est toujours relu. Illisible : `fallback`, jamais
  // mémoïsé. Seules les entrées servies ce tour-ci passent au suivant (cf. compile()) : un fichier
  // renommé ou supprimé ne reste pas en mémoire toute la session.
  // --------------------------------------------------------------------------
  private sourceScans     = new Map<string, { mtimeNs: bigint; size: bigint; value: unknown }>()
  private sourceScansPrev = new Map<string, { mtimeNs: bigint; size: bigint; value: unknown }>()

  private scanSource<T>(kind: string, file: string, fallback: T, scan: (src: string) => T): T {
    let st
    try {
      st = statSync(file, { bigint: true })
    }
    catch {
      return fallback
    }
    const key  = kind + '\0' + file
    const memo = this.sourceScans.get(key) ?? this.sourceScansPrev.get(key)
    if (memo && memo.mtimeNs === st.mtimeNs && memo.size === st.size && Number(st.mtimeNs / 1_000_000n) < this.compileStartMs) {
      this.sourceScans.set(key, memo)
      return memo.value as T
    }
    let src = ''
    try {
      src = readFileSync(file, 'utf-8')
    }
    catch {
      return fallback
    }
    const value = scan(src)
    this.sourceScans.set(key, { mtimeNs: st.mtimeNs, size: st.size, value })
    return value
  }

  // --------------------------------------------------------------------------
  // bundleRuntime(used) : concatène les mjs_*.ts → mjs_core.js
  // --------------------------------------------------------------------------
  // `used` prend désormais la place du scan textuel : appelé par compile() en PHASE
  // B avec `this.collectUsedFeatures()` (union des signaux compilés de toutes les unités déjà
  // en mémoire, cf. son bandeau). Paramètre par défaut `new Set()` (jamais `undefined`, cf.
  // resolveRuntimeFiles où `undefined` a un sens DIFFÉRENT — « tout inclus », API directe) :
  // préserve le comportement historique d'un appel HORS pipeline complet (tests qui
  // construisent un cœur sans composant, cf. bundler-runtime-selection.test.ts/bundler-
  // compile-dedup-cycle.test.ts) — `collectUsedFeatures()` sur un `sourceDir` sans aucune
  // unité compilée rendait déjà un Set VIDE, jamais « tout ».
  // --------------------------------------------------------------------------
  async bundleRuntime(used: ReadonlySet<string> = new Set()): Promise<string> {
    // V2 — mjs_element_int / mjs_element_bigint retirés : µ.Element gère tout
    // via le dispatch direct `_mjs_effectsByVar` (plus de bitmask Int/BigInt).
    //
    // Sélection des modules (cœur + optionnels selon `runtime`, défaut 'all' ;
    // rétrocompat `minimalRuntime` ≡ 'core'). mjs_flip reste en fin (patch
    // `µ.Element.prototype`, doit suivre mjs_element) ; mjs_debug est inséré
    // juste après, hors prod et hors cœur nu (splice ci-dessous).
    //
    // mjs_title.ts n'est plus BYTE-identique à l'historique en 'all'/'core' pour un projet SANS
    // aucun `@title`/`mjs-title` (il en sort désormais) — c'est le but recherché,
    // pas une régression. Un projet qui EN a au moins un reste identique à l'historique.
    const { files: selectedFiles, warnings: runtimeWarnings, coreOnly } = this.resolveRuntimeFiles(used)
    for (const w of runtimeWarnings) this.buildWarn(w)
    this.labelCoreModules = this.coreLabelModules()
    this.labelCoreDropped = new Set([...this.coreParts.dropped].filter(p => !this.coreParts.kept.has(p)))
    this.labelFxEffects   = new Set(selectedFiles.filter(f => /^mjs_fx_[a-z0-9_]+\.ts$/.test(f)).map(f => f.slice(7, -3)))
    this.labelGroups      = this.runtimeLabelGroups(selectedFiles, this.labelCoreModules, this.labelFxEffects)
    // les effets qui partent dans leur propre fichier (cf. compileFxChunks) sortent du cœur — leur
    // texte reste lu ci-dessous : variables de thème, garde du contrat
    const chunkFiles   = selectedFiles.filter(f => /^mjs_fx_[a-z0-9_]+\.ts$/.test(f) && this.fxChunked(f.slice(4, -3)))
    const orderedFiles = selectedFiles.filter(f => !chunkFiles.includes(f))

    // mjs_debug est un module d'INSPECTION dev-only : il wrappe
    // connect/disconnect (registre `µ.instances`), la télémétrie `µ.debugMode`
    // et pousse `devtoolsFormatters`, et porte les avertissements de développement
    // (prop à sens unique, @attach). En prod il n'apporte QUE du poids
    // (~1,5 Ko gzip) + ~200 ns par connect/disconnect, pour un outillage jamais
    // sollicité (aucun symbole cœur ne le référence : les `if (µ.debug)` du
    // cœur visent le BOOLÉEN de mjs_init, strippé par DCE). On ne l'inclut donc
    // qu'en build NON-prod (en cœur nu il est déjà absent). Insertion juste
    // avant mjs_flip pour rester APRÈS mjs_element (patch prototype).
    // mjs_devinspect (inspecteur d'objets générique) et mjs_devpanel (le panneau, qui s'en sert
    // pour ses onglets État/Contexte et pour `µconsole valeur`) suivent la MÊME règle et se suivent
    // immédiatement dans cet ordre : mjs_devpanel s'appuie sur le registre `µ.instances` de
    // mjs_debug ET sur `µ._mjs_diRender` de mjs_devinspect — il doit donc venir APRÈS les deux, et
    // jamais en prod. mjs_hotcss (rechargement CSS à chaud, `µ._hotCss` — appelé SEULEMENT par
    // le snippet HMR de `mjs dev`, server/hmr.ts) suit la MÊME règle : rien à échanger à chaud
    // dans un bundle qui ne sera jamais servi par `mjs dev`.
    // les effets de l'appli (avant ce qu'on ajoute pour le panneau) : leurs réglages partent avec lui,
    // ceux des effets qui ont leur propre fichier compris
    const appFiles = [...selectedFiles]
    if (!coreOnly && !this.isProd()) {
      const debugIdx = orderedFiles.indexOf('mjs_flip.ts')
      orderedFiles.splice(debugIdx >= 0 ? debugIdx : orderedFiles.length, 0, 'mjs_debug.ts', 'mjs_devinspect.ts', 'mjs_devpanel.ts', 'mjs_hotcss.ts')
      // « mises à jour » du panneau : l'éclair de *flash (µ._mjs_fxFlash), qui ne demande pas le
      // moteur des effets — seul, dans une appli sans effet ; *flash s'inscrit au moteur s'il est là
      if (!orderedFiles.includes('mjs_fx_flash.ts')) orderedFiles.splice(orderedFiles.indexOf('mjs_debug.ts'), 0, 'mjs_fx_flash.ts')
    }

    // Les fichiers runtime sont du TS sans syntaxe TS (issu de la migration
    // Coffee → TS) — du JS pur. On peut concaténer directement, esbuild
    // les passerait en mode ESM avec wrapping qui collisionne lors de la
    // concaténation. Le minifier en aval (esbuild minify) les avalera.
    const parts: string[] = []
    const missing: string[] = []
    // registre des variables de thème — recalculé à CHAQUE bundleRuntime() : ces fichiers sont
    // de toute façon lus en entier pour la concaténation ci-dessous, le scan ne coûte rien
    // de plus. C'est ce qui rend `$$surface`/`$$fg`/… légitimes sans redéclaration projet.
    this.frameworkVarData = []
    // les effets qui ont leur propre fichier : hors du cœur, mais au registre et à la garde du contrat
    const chunkTexts: string[] = []
    // les effets et les outils tels qu'ils partent, [fichier, texte] : la garde des outils les lit plus bas
    const fxModules: Array<[string, string]> = []
    for (const f of chunkFiles) {
      const path = join(this.runtimeDir, f)
      if (!existsSync(path)) { missing.push(f); continue }
      const src  = readFileSync(path, 'utf-8')
      const text = this.effectSource(f, src, used)
      chunkTexts.push(text)
      fxModules.push([f, text])
      this.scanFrameworkVars(f, src)
    }
    for (const f of orderedFiles) {
      const path = join(this.runtimeDir, f)
      if (!existsSync(path)) { missing.push(f); continue }
      const src  = readFileSync(path, 'utf-8')
      const text = this.effectSource(f, src, used)
      parts.push(`// === ${f} ===\n${text}`)
      // un effet nommé par une variable peut être donné en objet `{ fx, s }` : ses réglages passent les plages du catalogue (cf. fxRanges),
      // que le moteur ne connaît pas — leur table, une seule fois, juste après lui, et seulement quand une page nomme un effet par une variable :
      // tous les effets qui se nomment partent alors (au cœur ou dans leur fichier), les transitions avec leur fichier
      if (f === 'mjs_fx.ts' && used.has(FX_NAMED)) parts.push(`// === plages du catalogue (effets nommés par une variable) ===\nµ._mjs_fxRanges = ${fxRangesSource(Object.keys(EFFECTS).filter(n => EFFECTS[n].transition ? appFiles.includes('mjs_fx_transition.ts') : FX_NAMEABLE_KEYS.includes('fx_' + n.replace(/-/g, '_'))))};`)
      if (FX_MODULE.test(f)) fxModules.push([f, text])
      this.scanFrameworkVars(f, src)
      // l'onglet « Effets » du panneau règle les effets posés : il lui faut les réglages (règle,
      // défaut) des effets dont le code part dans CE cœur — et d'eux seuls, rien sans effet
      if (f === 'mjs_devpanel.ts') {
        const fxNames = Object.keys(EFFECTS).filter(n => appFiles.includes(EFFECTS[n].transition ? 'mjs_fx_transition.ts' : 'mjs_fx_' + n.replace(/-/g, '_') + '.ts'))
        if (fxNames.length > 0) parts.push(`// === réglages des effets (panneau d'inspection) ===\nµ._mjs_fxCatalog = ${JSON.stringify(devCatalog(fxNames))};`)
      }
    }
    // la table des alias d'effets utilisés plusieurs fois : dans le cœur de l'appli, et là seulement si une pose y renvoie
    const aliasTable = this.aliasSource(used)
    if (aliasTable) parts.push(aliasTable)
    // Motif dominant de ce genre de bogue :
    // « erreur avalée → build vert ». Un `runtimeDir` introuvable/mal résolu
    // (ex. le bug URL.pathname corrigé dans locateRuntimeDir ci-dessus, ou
    // une config `runtimeDir` explicite fausse) faisait sauter CHAQUE fichier
    // via le `continue` ci-dessus, SANS qu'aucune erreur ne remonte :
    // `mjs_core.js` s'écrivait VIDE (ou partiel si un SEUL module manque),
    // le build se terminait « avec succès », et l'app entière était
    // mort-née au premier chargement (`µ` undefined pour TOUT composant, ou
    // `µ.Router`/`µ.ajax`/etc. manquants selon le module sauté). On ne
    // tolère plus le moindre fichier runtime absent.
    if (missing.length > 0) {
      throw new Error(t('bundler.index.runtime-introuvable', { manquants: missing.length, total: orderedFiles.length, dossier: this.runtimeDir, liste: missing.join(', ') }))
    }
    // lectures `µ.debug` mortes en prod : `define: { 'µ.debug': 'false' }` ne peut rien (µ est une
    // variable LOCALE du cœur, esbuild n'applique pas un define derrière une déclaration locale, cf.
    // minify.ts) ; en prod minifiée, chaque LECTURE `µ.debug` (jamais une écriture `µ.debug = …`, exclue par
    // le lookahead) devient l'identifiant libre `MJS_DEBUG`, que `minifyJs` reçoit en
    // `define: { MJS_DEBUG: 'false' }` → chaque `if (µ.debug)` part en DCE réel. Hors prod, minifié ou non,
    // rien ne change : les sources gardent `µ.debug`, la bascule console `µ.debug = true` reste vivante,
    // et les tests qui évaluent ces fichiers bruts n'ont rien à connaître
    const debugMort    = this.isProd() && this.shouldMinify()
    const sansDebug    = debugMort
      ? parts.join('\n').replace(/(?<![\w$.])µ\.debug(?![\w$])(?!\s*=[^=])/g, 'MJS_DEBUG')
      : parts.join('\n')
    // en production, les messages de la console ne portent plus leur texte français de secours : ils
    // sortent du fichier de leur langue (cf. compileMessageFiles)
    // le chargement d'avance des messages (bloc balisé de mjs_init.ts) ne reste au cœur que si le
    // réglage `messages: 'idle'` le demande, en production
    const avecMessages = this.isProd() && this.messagesMode === 'idle' ? sansDebug : sansDebug.replace(/^\/\/ <msg-idle>\n[\s\S]*?^\/\/ <\/msg-idle>\n/m, '')
    // le code qui demande ensemble les sections d'un module (bloc balisé de mjs_i18n.ts, `@i18n 'a' 'b'`, et les lignes balisées de même que
    // `__i18nAskSection` porte pour lire les sections en plus et `__i18nBoot` pour son rejeu du démarrage) ne reste au cœur que si une unité
    // de ce build en écrit : sinon le cœur est identique, à l'octet, à celui d'avant ces blocs
    const avecPaquets  = used.has(I18N_PAQUETS) ? avecMessages : avecMessages.replace(/^\/\/ <i18n-paquets>\n[\s\S]*?^\/\/ <\/i18n-paquets>\n\n/m, '').replace(/^[ \t]*\/\/ <i18n-paquets-lecture>\n[\s\S]*?^[ \t]*\/\/ <\/i18n-paquets-lecture>\n/m, '').replace(/^[ \t]*\/\/ <i18n-paquets-demarrage>\n[\s\S]*?^[ \t]*\/\/ <\/i18n-paquets-demarrage>\n/m, '')
    // l'accroche de l'indicateur de chargement (`*loader`, bloc balisé de mjs_i18n.ts) : seulement si une unité de ce build, ou la configuration,
    // l'écrit ; sinon le cœur d'une appli traduite n'en porte pas un octet. Le rendu des barres grises (`*skeleton`) reste, lui, au cœur : le secours de `wait` s'en sert
    const avecChargeur  = used.has(I18N_LOADER) ? avecPaquets : avecPaquets.replace(/^\/\/ <i18n-loader>\n[\s\S]*?^\/\/ <\/i18n-loader>\n\n/m, '').replace(/^[ \t]*\/\/ <i18n-loader-appel>\n[\s\S]*?^[ \t]*\/\/ <\/i18n-loader-appel>\n/gm, '')
    // la file des boucles qui écrivent l'état (blocs balisés `<boucles>` de mjs_init.ts et de `_mjs_invalidate`, mjs_element.ts) : seulement si le
    // compilateur a enveloppé une boucle dans une unité de ce build (generator/loop-batch.ts) ; sinon le cœur est identique, à l'octet, à celui d'avant
    const avecBoucles  = used.has(BOUCLES) ? avecChargeur : avecChargeur.replace(/^[ \t]*\/\/ <boucles>\n[\s\S]*?^[ \t]*\/\/ <\/boucles>\n/gm, '')
    const concatenated = this.isProd() ? stripMsgFallbacks(avecBoucles) : avecBoucles
    this.traceKeys     = traceKeysIn(concatenated)
    // GARDE DU CONTRAT — dernier mot avant que ce cœur parte sur disque : chaque symbole interne
    // que les unités de ce build APPELLENT doit exister dans le texte qu'on vient d'assembler.
    // Sur `concatenated`, donc AVANT minification, pour la raison de toujours : le minifieur
    // raccourcit les `_mjs_*`/`_upd*` et les rendrait invisibles des deux côtés.
    //
    // Ce que ça rattrape : la sélection ci-dessus repose sur `scanCompiledFeatures`, qui reconnaît
    // un module à un marqueur DANS le code compilé. Un marqueur qui cesse de correspondre (un
    // renommage interne, comme `._updList(` → `._mjs_updList(` en septembre 2026) rend « personne
    // n'en a besoin » — mot pour mot ce que rend « rien à embarquer ». Le module sort du cœur, le
    // build reste vert, et l'application meurt au premier clic. Neuf vues y sont restées deux
    // jours. On ne détecte pas l'erreur de scan (impossible depuis le scan lui-même) : on
    // vérifie le RÉSULTAT, et on refuse de finir.
    //
    // `pendingCoreCalls` est vide hors pipeline complet (bundleRuntime appelée seule, API directe
    // ou tests) : rien de réclamé, rien à vérifier, comportement historique intact.
    const manquants = this.missingCoreSymbolsMemo(chunkTexts.length > 0 ? concatenated + '\n' + chunkTexts.join('\n') : concatenated, this.pendingCoreCalls)
    if (manquants.length > 0) {
      throw new Error(t('bundler.index.contrat-coeur-rompu', { manquants: manquants.join(', '), nb: manquants.length, modules: orderedFiles.length, core: this.runtime === 'core' }))
    }
    // outils des effets (cf. assertFxTools) : ceux que le cœur embarque, contre ce que les effets (au cœur ou à part) et les outils eux-mêmes appellent
    this.fxToolsEmbarked = new Set(FX_TOOL_KEYS.filter(k => orderedFiles.includes('mjs_' + k + '.ts')))
    this.journalInCore   = orderedFiles.includes('mjs_journal.ts')
    this.assertFxTools(fxModules)
    const minified = await minifyJs(concatenated, {
      force: this.shouldMinify(),
      filename: 'mjs_core.js',
      sourceMap: this.shouldEmitSourceMap(),
      mangleCache: this.mangleCache,
      logLevel: this.prodLogLevel(),
      dev: !this.isProd(),
      runtimeSource: this.isProd(),
      journal: this.journalInCore,
      define: debugMort ? { MJS_DEBUG: 'false' } : undefined,
    })
    // mode 'bundle' : le cœur ne devient JAMAIS un fichier sur disque — gardé en mémoire
    // (bundleVirtualSources), résolu par le plugin esbuild d'emitSingleFile() sous le
    // spécificateur virtuel STABLE 'mjs:core'. Stable = un cache-hit d'unité (CacheEntry.code)
    // reste valide quel que soit le CONTENU du cœur (plus de hash embarqué dans le texte des
    // unités, cf. bandeau de CacheEntry.embeds) — la carte de source suit en inline (cf.
    // emitSingleFile()) plutôt qu'en fichier `.map` séparé, ce cœur n'en ayant plus.
    if (this.jsMode === 'bundle') {
      this.bundleVirtualSources.set('mjs_core', this.withInlineSourceMap(minified.code, minified.map))
      return 'mjs:core'
    }
    const hashed = this.writeHashed('mjs_core', '.js', minified.code, minified.map)
    return hashed
  }

  // missingCoreSymbolsMemo() : la garde du contrat relit le cœur entier (blanchiment des commentaires et chaînes, ≈ 1 Mo) — près
  // d'une seconde par compile() en développement, même quand rien n'a bougé. Même texte et mêmes appels que le tour précédent :
  // même réponse, rendue sans relire
  private coreContractMemo: { text: string, appels: string, manquants: string[] } | null = null

  private missingCoreSymbolsMemo(text: string, appels: Iterable<string>): string[] {
    const cle = [...appels].sort().join('\n')
    const memo = this.coreContractMemo
    if (memo !== null && memo.appels === cle && memo.text === text) return [...memo.manquants]
    const manquants = missingCoreSymbols(text, cle === '' ? [] : cle.split('\n'))
    this.coreContractMemo = { text, appels: cle, manquants: [...manquants] }
    return manquants
  }

  // --------------------------------------------------------------------------
  // scanFrameworkVars(f, src) : registre des variables de thème, source 3 — une DÉCLARATION
  // `--<varPrefix>-<nom>:` dans le SOURCE du runtime (mjs_init.ts pose --mjs-surface,
  // --mjs-fg… pour les thèmes clair/sombre embarqués, mjs_modal.ts/mjs_title.ts posent
  // les points de personnalisation de leurs propres composants). `var(--mjs-x)` est une
  // LECTURE, jamais capturée ici (aucun `:` ne suit jamais le nom dans cette forme). Scan
  // sur le SOURCE (pas le bundle minifié) : lignes réelles, doc = commentaire précédent
  // s'il y en a un, exploitables telles quelles par le registre.
  //
  // Un commentaire ne documente que la déclaration qui le suit IMMÉDIATEMENT, et RIEN
  // d'autre — ex. mjs_init.ts pose 8 variables sur une SEULE ligne de template literal
  // (`--mjs-surface:…;--mjs-fg:…;…`) ; sans ce garde, les 8 héritaient TOUTES du même
  // commentaire, situé au-dessus de la feuille entière et sans rapport avec 7 d'entre
  // elles. `doc` n'est donc jamais rempli pour la 2e déclaration d'une même ligne (ou
  // plus loin) — mieux vaut vide que faux.
  // --------------------------------------------------------------------------
  private scanFrameworkVars(f: string, src: string): void {
    const lines = src.split('\n')
    for (let li = 0; li < lines.length; li++) {
      const re = new RegExp(`--${escapeRegex(this.varPrefix)}-([A-Za-z_][A-Za-z0-9_-]*)\\s*:\\s*([^;{}]+)`, 'g')
      const prevLine = li > 0 ? lines[li - 1].trim() : ''
      let doc = prevLine.startsWith('//') ? prevLine.replace(/^\/+\s*/, '') : ''
      let m: RegExpExecArray | null
      while ((m = re.exec(lines[li])) !== null) {
        this.frameworkVarData.push({ file: f, line: li + 1, name: m[1], value: m[2].trim(), doc })
        doc = ''   // consommé par la 1re déclaration — la suivante (même ligne) n'hérite pas
      }
    }
  }

  // --------------------------------------------------------------------------
  // isProd() : définition CANONIQUE et UNIQUE de "build de prod" — utilisée
  // partout où ce choix compte (source maps, exposition window.µ, etc.).
  //
  // Résolution : `env` vaut 'prod' ou 'dev', et rien d'autre. En CLI c'est le DRAPEAU
  // qui le pose — `mjs build` construit en développement, `mjs build --prod` en production.
  // Aucune variable d'ambiance n'entre ici : un `NODE_ENV` qui traîne dans un shell ne doit
  // pas changer ce que produit un build (avant, `'auto'` le consultait).
  //
  // AVANT ce fix, 2 définitions DIVERGENTES
  // coexistaient : `shouldEmitSourceMap()` considérait `forceMinify || NODE_ENV`,
  // l'exposition de `window.µ` ne regardait QUE `NODE_ENV`. Unifiées ici.
  //
  // `minify` NE DÉCIDE PLUS de l'environnement. L'ancienne règle
  // (`minify: true` ⇒ prod) faisait qu'un projet local avec un simple `"minify": true`
  // dans mjs.config.json construisait un build de PRODUCTION sans le savoir : pas de
  // `window.µ`, pas de carte de source, et surtout aucun module d'inspection — le
  // panneau `Ctrl+Shift+Espace` n'existait pas dans le bundle, sans le moindre message.
  // C'est `env` qui porte ce choix maintenant, et `minify` ne fait que minifier.
  // --------------------------------------------------------------------------
  private isProd(): boolean {
    return this.envMode === 'prod'
  }

  // shouldMinify() : politique de minification, INDÉPENDANTE de l'environnement.
  // `'auto'` (défaut) suit `isProd()` — un build de dév n'est donc PLUS
  // minifié, et un `minify: true` posé pour alléger un bundle local ne fait plus passer
  // tout le projet en prod (ce qui retirait le panneau d'inspection sans rien demander).
  // PUBLIC : bundler/startup.ts assemble le fichier de page d'une route prérendue APRÈS ce
  // compile, et doit le minifier selon la MÊME politique (une seule définition). La règle elle-même
  // est `Bundler.minifies()` : le bandeau de cli.ts l'applique avant que le Bundler n'existe.
  shouldMinify(): boolean {
    return Bundler.minifies(this.minifyMode, this.envMode)
  }

  static minifies(mode: boolean | 'auto', env: 'dev' | 'prod'): boolean {
    return mode === 'auto' ? env === 'prod' : mode
  }

  // currentLogLevel()/prodLogLevel() : niveau EFFECTIF de la console (clé `logLevel` de
  // mjs.config.json, cf. resolveLogLevel/config.ts — défauts dev 'log', prod 'error').
  // currentLogLevel() suit l'environnement RÉEL de CE build (émis au manifeste pour le
  // navigateur — cf. writeManifest — et gouverne buildWarn() ci-dessous). prodLogLevel()
  // vaut TOUJOURS le niveau de PROD, quel que soit l'environnement en cours : c'est lui qui
  // pilote la liste `pure` du minifieur en production (cf. tous les appels à minifyJs()). En
  // développement, minifié ou non, rien n'est retiré (`dev` de minifyJs) : minifier n'y fait que minifier.
  private currentLogLevel() {
    return resolveLogLevel(this.logLevel, this.isProd() ? 'prod' : 'dev')
  }

  private prodLogLevel() {
    return resolveLogLevel(this.logLevel, 'prod')
  }

  // buildWarn() : point de sortie UNIQUE des avertissements du bundler vers le terminal —
  // respecte le niveau du terminal (rien en dessous de 'warn') : celui que la clé fixe pour CET environnement,
  // sinon ses avertissements restent visibles, en production aussi (cf. resolveTerminalLogLevel, config.ts).
  // Remplace un `console.warn` direct
  // partout où le contexte a accès à `this` (compile-time — PAS la validation de
  // mjs.config.json elle-même, qui tourne avant que l'environnement dev/prod ne soit connu).
  // PUBLIC : cli.ts l'appelle aussi pour ses propres échos d'avertissements de build
  // (`stats.warnings`, purge d'orphelins) — même bundler, même niveau, un seul filtre.
  buildWarn(message: string): void {
    if (logLevelAllows(resolveTerminalLogLevel(this.logLevel, this.isProd() ? 'prod' : 'dev'), 'warn')) printDiagnostic(message, this.colorsEnabled)
  }

  // où s'écrivent `@in=*nom`, `@out=*nom` et `@transition=*nom` (avec leurs modificateurs) : « fichier (ligne N) », un par fichier. Une directive s'écrit dans l'ouverture
  // d'une balise (transpile-msg.ts : balise sur plusieurs lignes, `<` ou `>` dans une valeur ou dans une expression `{…}` du texte sans effet), hors commentaire HTML,
  // `<script>` et `<style>` : la ligne est celle où la directive est écrite, pas celle où la balise s'ouvre. Une vraie balise dans un `<pre>`, un `<code>` ou un `<@@code>`
  // est compilée, donc comptée ; un texte (exemple de code, chaîne du script, contenu d'un `<@@code>`, valeur d'un attribut) ne l'est pas. Un nom que seule une
  // expression cite (`µ.anim.fadde`) n'est écrit par aucune directive : aucun lieu à citer
  private transitionSites(name: string, files: string[]): string[] {
    const written = new RegExp('@(?:in|out|transition)(?:\\.\\w+)*\\s*=\\s*\\*' + name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '(?![\\w.-])', 'g')
    const sites: string[] = []
    for (const file of files) {
      let content: string
      try { content = readFileSync(file, 'utf-8') } catch { continue }
      const text  = content.replace(/<!--(?:-?>|[\s\S]*?--!?>)|<script\b[^>]*>[\s\S]*?<\/script>|<style\b[^>]*>[\s\S]*?<\/style>/gi, zone => zone.replace(/[^\n]/g, ' '))
      const spans = tagSpans(text, true)
      const found = new Set<number>()
      for (const m of text.matchAll(written)) {
        const at  = m.index ?? 0
        const tag = spans.find(([start, end]) => at > start && at <= end)
        if (tag && !insideValue(text, tag[0], at)) found.add(text.slice(0, at).split('\n').length)
      }
      if (found.size === 0) continue
      const lines = [...found].sort((a, b) => a - b)
      const ligne = lines.length === 1 ? t('bundler.transpile-msg.effet-ligne', { ligne: String(lines[0]) }) : lines.length <= 3 ? t('bundler.transpile-msg.effet-lignes', { lignes: lines.join(', ') }) : ''
      sites.push(file + ligne)
    }
    return sites
  }

  // le nom le plus proche de celui d'une transition inconnue (deux lettres au plus de différence, une seule mesure : celle du catalogue, où deux lettres interverties
  // comptent pour une) parmi les noms qu'une directive de transition accepte — une transition de la bibliothèque, un effet de l'appli, un effet qui se joue au chargement
  // (`*entree` pour `@in=*entreee`, jamais `*tilt`, que `@in` refuse) ; rien quand aucun n'approche
  private nearestEffectName(name: string): string {
    let nearest  = ''
    let distance = 3
    withProjectEffects(this.effectDefs, () => {
      for (const n of [...Object.keys(EFFECTS), ...Object.keys(this.effectDefs)]) {
        const spec = effectSpec(n)
        if (!spec || !(spec.transition || spec.custom || /'load'/.test(spec.settings.on?.rule ?? ''))) continue
        const d = typoDistance(name, n)
        if (d < distance) { distance = d; nearest = n }
      }
    })
    return nearest
  }

  // lintPush()/lintBuildWarn() : point d'entrée UNIQUE de l'étiquette `[lint.<type>]` côté
  // bundler — étiquette posée EN TEXTE (jamais de couleur ici, cf. printDiagnostic dans
  // buildWarn() ci-dessus et dans la relecture de stats.warnings, cli.ts), `null` si ce type
  // est coupé (`lint.<type>: false`, mjs.config.json) : l'appelant ne pousse alors rien.
  private lintPush(warnings: string[], type: LintType, message: string): void {
    const line = typedLine(type, message, this.lint)
    if (line !== null) warnings.push(line)
  }

  private lintBuildWarn(type: LintType, message: string): void {
    const line = typedLine(type, message, this.lint)
    if (line !== null) this.buildWarn(line)
  }

  // shouldEmitSourceMap() : gouverné par la clé `sourceMap` de mjs.config.json.
  // Défaut `'dev'` : la carte est émise là où elle sert — poser un point d'arrêt sur SA
  // ligne de `.mjs` pendant qu'on développe — et absente de la prod, où elle publierait
  // la forme lisible du source. `'prod'` pour l'ancien comportement, `'always'` les deux,
  // `'never'` aucune. PUBLIC pour la même raison que shouldMinify() ci-dessus.
  shouldEmitSourceMap(): boolean {
    const m = this.sourceMapMode
    return m === 'always' || (m === 'prod' && this.isProd()) || (m === 'dev' && !this.isProd())
  }

  // --------------------------------------------------------------------------
  // shortModuleName(filePath) : basename sans le préfixe du dossier ancêtre
  // s'il y est. Convention V1 :
  //   `<sourceDir>/tuto/11/11-1/tuto-snippets-card.mjs`  → `snippets-card`
  //   `<sourceDir>/tuto/tuto.mjs`                       → `tuto`  (cas root)
  //   `<sourceDir>/doc/doc-architecture.mjs`            → `architecture`
  //   `<sourceDir>/foo/bar.mjs`                         → `bar` (pas de préfixe)
  //
  // Le tag custom element devient `mjs-<shortName>`, et l'entrée manifest
  // utilise le shortName comme clé. L'autoloader (qui fait
  // `µ.paths[tag.replace('mjs-', '')]`) trouve donc le composant.
  // --------------------------------------------------------------------------
  private shortModuleName(filePath: string): string {
    const base = pageAwareBaseName(filePath)
    // Dossier parent direct (premier segment au-dessous de sourceDir)
    const rel = filePath.replace(this.sourceDir + '/', '')
    const topDir = rel.split('/')[0]
    // Cas root : le fichier est `<topDir>.mjs` lui-même → on garde tel quel
    if (base === topDir) return base
    // Si le basename commence par `<topDir>-`, strip ce préfixe
    if (base.startsWith(topDir + '-')) return base.slice(topDir.length + 1)
    return base
  }

  // --------------------------------------------------------------------------
  // modelsWithShortAliases() : les modèles en fichier publiés aussi sous l'alias court de leur
  // composant — `doc/doc-carte.mjs` s'écrit `<@carte>`, et `<@carte layout="compacte">` doit prendre
  // la balise de `doc/doc-carte.compacte.mjs` (son alias `carte--compacte`) comme `<@doc-carte …>`.
  // Rien sous un alias réservé, qu'un autre composant porte aussi (ambigu) ou qui est le nom d'un vrai
  // composant (c'est lui que la balise désigne) ; rien pour un modèle dont l'alias ne suit pas celui
  // de son composant (rangé dans un autre dossier), sa balise ne mènerait nulle part
  // --------------------------------------------------------------------------
  private modelsWithShortAliases(files: string[], models: Record<string, string[]>): Record<string, string[]> {
    this.modelAliasKeys = new Set()
    if (Object.keys(models).length === 0) return models
    const byBase  = new Map<string, string[]>()
    const byShort = new Map<string, string[]>()
    const shortOf = new Map<string, string>()
    for (const f of files) {
      let base  = ''
      let short = ''
      try {
        base  = pageAwareBaseName(f)
        short = this.shortModuleName(f)
      }
      catch {
        continue   // nom de fichier refusé : sa compilation le dit
      }
      shortOf.set(f, short)
      byBase.set(base, [...(byBase.get(base) ?? []), f])
      byShort.set(short, [...(byShort.get(short) ?? []), f])
    }
    const out = { ...models }
    for (const [base, noms] of Object.entries(models)) {
      const own = byBase.get(base)
      if (own?.length !== 1) continue
      const alias = shortOf.get(own[0])!
      if (alias === base || byBase.has(alias) || byShort.get(alias)!.length > 1 || this.isReservedShortcutName(alias)) continue
      const kept = noms.filter(nom => {
        const model = byBase.get(`${base}--${nom}`)
        const tag   = `${alias}--${nom}`
        return model?.length === 1 && shortOf.get(model[0]) === tag && !byBase.has(tag) && byShort.get(tag)!.length === 1
      })
      if (kept.length === 0) continue
      out[alias] = kept
      this.modelAliasKeys.add(alias)
    }
    return out
  }

  // variants — alimente pendingLayoutNames pour UN module tout juste compilé
  // (froid OU cache-hit, cf. les deux appels dans _compileMjsInner) : basename ET alias
  // court (mêmes clés que manifestSources/manifestNames), en minuscules. Aucune entrée si
  // le module ne déclare AUCUN variant — c'est ce vide qui, plus tard, dit à
  // resolveTagShortcuts de ne rien vérifier (repli historique du fichier CSS à la main).
  private registerLayoutNames(filePath: string, moduleNameOverride: string | undefined, layoutCss: Record<string, string> | undefined): void {
    const names = Object.keys(layoutCss ?? {})
    if (names.length === 0) return
    const moduleName = moduleNameOverride ?? pageAwareBaseName(filePath)
    const shortName  = moduleNameOverride ?? this.shortModuleName(filePath)
    for (const key of new Set([moduleName.toLowerCase(), shortName.toLowerCase()])) {
      const set = this.pendingLayoutNames.get(key) ?? new Set<string>()
      for (const n of names) set.add(n)
      this.pendingLayoutNames.set(key, set)
    }
  }

  // --------------------------------------------------------------------------
  // Un ALIAS COURT (shortModuleName, ci-dessus) qui retombe sur une des
  // 12 réservées ou le préfixe `core-` n'est JAMAIS publiable — même règle que
  // pour un basename (resolveTagShortcuts), mais un basename est le nom de
  // fichier réel (non négociable, erreur dure) alors qu'un alias n'est qu'un
  // confort (cède en silence + avertissement). Utilisée ICI (aliasTag,
  // _compileMjsInner juste plus bas — pour ne jamais émettre
  // `customElements.define('mjs-<réservé>', …)`) ET dans resolveTagShortcuts
  // (manifeste + pool de résolution manifestNames) — SEULE source de vérité.
  // --------------------------------------------------------------------------
  // `mjs-` — le préfixe appartient au framework, et il l'est
  // DÉJÀ à deux endroits : le tag d'un composant est toujours `mjs-<basename>`, et tout
  // attribut `mjs-*` est ignoré comme prop. Un fichier `mjs-carte.mjs` produirait le tag
  // `<mjs-mjs-carte>` et pourrait entrer en collision avec une variable du framework. La
  // règle bouche ce trou plutôt que d'ajouter une comparaison de listes.
  private isReservedShortcutName(name: string): boolean {
    const lower = name.toLowerCase()
    return AT_RESERVED_NAMES.includes(lower) || lower.startsWith('core-') || lower.startsWith('mjs-')
  }

  // --------------------------------------------------------------------------
  // notePoisonedAlias() : un prétendant de plus sur un alias court AMBIGU (claimShortName,
  // kind 'poisoned'). On garde le BASENAME de chaque rival — c'est ce que l'auteur devra
  // écrire (`<mjs-doc-carte>`), pas le chemin du fichier. Sans doublon, ordre de compilation.
  // --------------------------------------------------------------------------
  private notePoisonedAlias(key: string, file: string): void {
    const noms = this.poisonedAliasSources.get(key) ?? []
    const nom  = pageAwareBaseName(file)
    if (!noms.includes(nom)) noms.push(nom)
    this.poisonedAliasSources.set(key, noms)
  }

  // --------------------------------------------------------------------------
  // compileMjs() : .mjs → JS via transpiler V2.
  //
  // Wrappé dans `withState()` pour isoler le `CompilerState` par fichier →
  // permet `Promise.all([compileMjs(f1), compileMjs(f2), ...])` sans race
  // condition sur le state du generator.
  // --------------------------------------------------------------------------
  // `moduleNameOverride` : réservé aux modules cœur (resolveTagShortcuts),
  // compilés depuis `coreModulesDir` sous le nom PLAT `<nom>` (tag mjs-<nom>,
  // plus de préfixe `core-`) plutôt que le basename réel du fichier
  // catalogue. `undefined` en usage normal (composant projet) → comportement
  // inchangé (basename du fichier).
  async compileMjs(filePath: string, moduleNameOverride?: string): Promise<string> {
    return this.compileWithDedup(filePath, () => withState(() => this._compileMjsInner(filePath, moduleNameOverride)) as Promise<string>)
  }

  // Dédup des compiles concurrents +
  // détection de cycle, PARTAGÉES entre `.mjs` (compileMjs) et `.civet`/
  // `.coffee` (compileScriptModule) : un `.mjs` peut `@import`/`µasset()` un
  // `.civet`, qui peut lui-même référencer un `.mjs`, donc un cycle peut
  // traverser les deux — une dédup séparée par type ne le détecterait pas.
  //
  // Deux problèmes distincts, avant ce fix :
  //   1. COURSE : `compileMjs` n'avait AUCUNE dédup (contrairement à
  //      compileScriptModule, qui en avait déjà une) — le parallelMap
  //      principal ET une résolution `µasset()`/`@import` imbriquée pouvaient
  //      compiler le MÊME fichier CHACUN DE LEUR CÔTÉ → deux hashes pour le
  //      même fichier → le second écrase le premier sur disque → le `.mjs`
  //      qui avait la 1ʳᵉ résolution garde une référence à un fichier
  //      supprimé → import 404 au chargement, build vert.
  //   2. CYCLE : `@import`/`µasset()` circulaire (A → B → A). Sans dédup,
  //      chaque appel relance un compile INDÉPENDANT → récursion infinie
  //      (stack overflow). Avec seulement une dédup NAÏVE (l'ancienne
  //      approche de compileScriptModule) : la 2ᵉ demande pour A retourne la
  //      promesse DÉJÀ EN VOL de la 1ʳᵉ — qui ne peut JAMAIS résoudre
  //      puisqu'elle attend elle-même cette même chaîne → interblocage
  //      SILENCIEUX, build qui ne se termine jamais, sans aucun message.
  //
  // Fix : `AsyncLocalStorage` (même outil déjà utilisé par
  // generator/state.ts `withState`, pour la même famille de besoin — isoler
  // un contexte à travers une chaîne d'`await` imbriqués) trace la CHAÎNE de
  // résolution en cours. Si le fichier demandé y figure déjà, c'est un
  // cycle : throw immédiat et explicite (nommant la boucle) plutôt
  // que récursion ou interblocage. Sinon, dédup normale via Map d'in-flight,
  // et le registre des attentes (`compileWaits`) dit à l'instant où elle se ferme
  // une boucle entre deux fichiers chacun top-level ; le timeout reste le filet
  // de tout autre blocage.
  private compileChainStorage = new AsyncLocalStorage<string[]>()
  private compileInFlight: Map<string, Promise<string>> = new Map()
  // qui attend qui : un fichier → les fichiers dont sa compilation attend la fin, chaque demande imbriquée comptant jusqu'à ce que
  // la compilation demandée finisse. La chaîne ci-dessus ne voit que les demandes imbriquées d'UNE même racine : deux fichiers
  // atteints chacun seul par le scan (chacun sa propre racine) qui se demandent l'un l'autre n'y figurent pas — ce registre, lui,
  // les voit dès que la boucle se ferme
  private compileWaits: Map<string, Set<string>> = new Map()

  // `asker` attend la fin de `promise`, la compilation de `target`
  private noteCompileWait(asker: string | undefined, target: string, promise: Promise<string>): void {
    if (asker === undefined) return
    const waits = this.compileWaits.get(asker) ?? new Set<string>()
    this.compileWaits.set(asker, waits)
    waits.add(target)
    const release = (): void => { waits.delete(target) }
    promise.then(release, release)
  }

  // chemin d'attentes de `from` jusqu'à `to` (inclus), ou null : `from` attend-il, de proche en proche, la fin de `to` ?
  private compileWaitPath(from: string, to: string): string[] | null {
    const seen = new Set<string>()
    const walk = (node: string, path: string[]): string[] | null => {
      if (node === to) return path
      if (seen.has(node)) return null
      seen.add(node)
      for (const next of this.compileWaits.get(node) ?? []) {
        const found = walk(next, [...path, next])
        if (found) return found
      }
      return null
    }
    return walk(from, [from])
  }

  // la boucle en clair : chemins relatifs à sourceDir, tournée pour commencer par le plus petit (le même texte quel que soit
  // le fichier qui la ferme en premier), refermée sur son point de départ. `ring` : la boucle, premier et dernier identiques
  private cycleChain(ring: string[]): string {
    const names = ring.slice(0, -1).map(f => {
      const rel = relative(this.sourceDir, f)
      return rel !== '' && !rel.startsWith('..') && !isAbsolute(rel) ? rel.split(sep).join('/') : f
    })
    const first  = names.reduce((best, n, i) => n < names[best] ? i : best, 0)
    const turned = [...names.slice(first), ...names.slice(0, first)]
    return [...turned, turned[0]].join(' → ')
  }

  private compileWithDedup(filePath: string, run: () => Promise<string>): Promise<string> {
    const chain = this.compileChainStorage.getStore() ?? []
    if (chain.includes(filePath)) {
      throw new Error(t('bundler.index.cycle-import-detecte', { chaine: this.cycleChain([...chain.slice(chain.indexOf(filePath)), filePath]) }))
    }
    // le fichier dont la compilation fait cette demande (le dernier de la chaîne) ; aucun pour une demande de racine
    const asker    = chain[chain.length - 1]
    const existing = this.compileInFlight.get(filePath)
    if (existing) {
      // La compilation demandée attend-elle déjà, de proche en proche, celle qui la demande ? Alors la boucle se ferme ICI :
      // deux fichiers CHACUN indépendamment top-level (donc chacun avec sa PROPRE chaîne racine, invisible à l'autre) qui se
      // référencent mutuellement via @import/µasset. Ex. `a.civet` et `b.civet` sont TOUS DEUX découverts par le scan principal
      // ET s'importent l'un l'autre : la promesse "en vol" de `a` finirait par attendre celle de `b`, qui elle-même attend celle
      // de `a` — aucune des deux ne pourrait jamais résoudre. L'erreur nomme la boucle sur-le-champ, la construction s'arrête.
      if (asker !== undefined) {
        const back = this.compileWaitPath(filePath, asker)
        if (back) throw new Error(t('bundler.index.cycle-import-detecte', { chaine: this.cycleChain([asker, ...back]) }))
      }
      this.noteCompileWait(asker, filePath, existing)
      // Cas résiduel NON couvert par la détection de boucle ci-dessus : tout autre blocage d'une compilation déjà en vol.
      // Sans limite de temps, cet interblocage serait SILENCIEUX et ÉTERNEL (exactement le symptôme originel qu'on corrige).
      // Un timeout transforme le hang muet en échec explicite et borné, nommant la chaîne en cause.
      const timeoutMs = this.dedupWaitTimeoutMs
      let timer: ReturnType<typeof setTimeout> | undefined
      // le délai retient la boucle d'événements : dans un interblocage plus rien d'autre ne l'occupe, et un délai
      // qui ne la retiendrait pas laisserait le processus finir seul, code 0, sans un mot
      const timeout = new Promise<string>((_, reject) => {
        timer = setTimeout(() => reject(new Error(t('bundler.index.compilation-bloquee', {
          fichier: filePath, timeout: timeoutMs, chaine: [...chain, filePath].join(' → '),
        }))), timeoutMs)
      })
      return Promise.race([existing, timeout]).finally(() => { if (timer) clearTimeout(timer) })
    }
    const promise = this.compileChainStorage.run([...chain, filePath], run)
      .finally(() => {
        this.compileInFlight.delete(filePath)
        this.compileWaits.delete(filePath)
      })
    this.compileInFlight.set(filePath, promise)
    this.noteCompileWait(asker, filePath, promise)
    return promise
  }

  // --------------------------------------------------------------------------
  // cachedUnitStillOnDisk(cached) : ceinture + bretelles d'un cache-hit CANDIDAT (hash déjà
  // vérifié par l'appelant, cf. _compileMjsInner/_compileScriptModuleInner) — le SUPPORT du
  // contenu mis en cache doit encore exister. Mode 'split' (historique) : un vrai FICHIER sur
  // disque (cleanup concurrent, suppression manuelle — cachedDiskPath). Mode 'bundle' : RIEN
  // n'est jamais écrit sur disque pour une unité (cf. emitSingleFile()) — c'est `cached.code`,
  // en RAM, qui fait foi ; son absence (entrée posée par un compile ANTÉRIEUR en mode 'split',
  // ou par une instance qui vient de changer de mode) est le seul signe de péremption possible.
  // --------------------------------------------------------------------------
  private cachedUnitStillOnDisk(cached: CacheEntry): boolean {
    if (this.jsMode === 'bundle') return cached.code !== undefined
    return existsSync(join(this.outputDir, basename(cached.hashedPath)))
  }

  private async _compileMjsInner(filePath: string, moduleNameOverride?: string): Promise<string> {
    const cacheKey = filePath
    const cached = this.cache.get(cacheKey)
    const content = this.mjsSource(filePath)

    // mode split SEULEMENT (coût nul en mode 'bundle', gate ICI plutôt
    // que dans extractViewCssNames). Scanne la source BRUTE (juste lue ci-dessus), AVANT
    // transpile — donc valable aussi bien en cache-hit qu'en fresh-compile SANS plomberie
    // de cache supplémentaire (contrairement à sharedCssNames/usedAnimations : `content`
    // est relu à chaque appel, cache hit ou pas, ce scan l'est donc aussi).
    if (this.cssMode === 'split') {
      for (const name of extractViewCssNames(content)) this.viewRequestedSheets.add(name)
    }
    // les silhouettes demandées (`<@carte *skeleton>`) : même source brute, même raison (cache-hit ou non)
    for (const name of skeletonTargetsOf(content)) this.pendingSkeletonTargets.add(name)

    // Override : moduleName ET shortName IDENTIQUES (jamais d'aliasTag
    // parasite pour un module cœur, cf. `aliasTag: shortName !== moduleName`
    // plus bas — un alias court 'tst' concurrencerait un composant projet homonyme).
    const moduleName = moduleNameOverride ?? pageAwareBaseName(filePath)  // tag enregistré = full basename, marqueur .page retiré

    // Cache key : SHA-256 du contenu + hash concaténé des partials inclus.
    // Plus robuste que `mtime` (insensible à `touch`, aux copies préservant
    // mtime, aux checkouts git, aux rebuilds cross-machine). Invalide
    // automatiquement quand un partial change.
    //
    // PLUS de sel du cœur/CSS split dans ce hash (la sortie compilée en mémoire
    // n'embarque plus qu'un REPÈRE, identique d'un tour à l'autre tant que le SOURCE ne
    // change pas) : un cache-hit ICI n'est donc qu'un CANDIDAT — sa validité réelle (cœur/
    // feuilles split ACTUELS) ne se décide qu'en phase C (cf. compile(), `CacheEntry.embeds`).
    // Sans ce sel, un composant en cache hit garderait une sortie disque référençant un cœur
    // supprimé → 404 : c'est désormais `embeds` (comparé en phase C), pas le hash, qui l'évite.
    //
    // Stratégie : si on a un cache hit, on connaît les partials précédents
    // → on peut calculer le hash sans transpile. Si pas de cache, on calcule
    // après le transpile (qui découvre les partials).
    if (cached) {
      const expectedHash = this.hashWithDeps(content + this.modelsSalt(), [
        ...(cached.includedPartials ?? []),
        ...(cached.importedModules ?? []),
        ...(cached.typesDeps ?? []),
        ...(cached.effectsDeps ?? []),
      ])
      // Un nom d'animation que ce composant pose ou cite et dont le statut a changé depuis sa compilation (un effet ajouté à un `*.effects.mjs` ou retiré) : le
      // composant se recompile, il ne le fait pas seul (son empreinte ne suit les fichiers d'effets que s'il en posait un). Un nom dont le statut ne change pas
      // (un alias de l'appli que son script cite à chaque tour) ne recompile rien : on compare au statut du nom quand le composant s'est compilé
      const statusChanged = (cached.usedAnimations ?? []).some(a => Object.hasOwn(this.effectDefs, a) !== (cached.appAnimations ?? []).includes(a))
      // Ceinture + bretelles : le hit exige aussi que le fichier de sortie
      // existe encore sur disque (cleanup concurrent, suppression manuelle) — cf.
      // cachedUnitStillOnDisk() pour la contrepartie mode 'bundle' (rien sur disque,
      // c'est `cached.code` en RAM qui fait foi).
      if (cached.hash === expectedHash && this.cachedUnitStillOnDisk(cached) && !statusChanged) {
        // Cache hit CANDIDAT : il faut quand même réinjecter les animations détectées
        // pour ce fichier, sinon `compileUsedAnimations` (qui s'appuie sur le
        // Set partagé `this.usedAnimations`) ne verra que les fichiers
        // recompilés ce tour-ci → bundle anim manquant après une rebuild
        // incrémentale (HMR du watcher).
        for (const a of cached.usedAnimations ?? []) this.usedAnimations.add(a)
        // Même hygiène pour les anims DÉFINIES
        // dynamiquement, sinon un cache hit fait réapparaître
        // le faux "manquant" spin/todoSend/todoReceive au build incrémental.
        for (const a of cached.definedAnimations ?? []) this.definedAnimations.add(a)
        // (crash-si-feuille-absente) — même hygiène : un
        // composant en cache hit doit rester compté dans validateSharedSheets(),
        // sinon une feuille @css qui disparaît du disque APRÈS le 1ᵉʳ compile
        // (mais que ce composant précis n'a pas été retouché, donc jamais
        // recompilé) échapperait à la détection au build incrémental.
        for (const c of cached.sharedCssNames ?? []) this.requestedSharedSheets.add(c)
        // signaux compilés : même hygiène que usedAnimations, jumeau côté
        // collectUsedFeatures() — sinon un composant inchangé disparaîtrait des briques du
        // cœur détectées au rebuild incrémental.
        for (const f of cached.features ?? []) this.pendingFeatures.add(f)
        // ses fichiers d'effets : même hygiène (ses dépendances directes, préchargées avec lui)
        this.pendingFxDeps.set(moduleName, this.fxChunkKeys(cached.features ?? []))
        // symboles du CONTRAT : même hygiène, même raison (cf. CacheEntry.coreCalls).
        for (const c of cached.coreCalls ?? []) this.pendingCoreCalls.add(c)
        // registre des variables de thème — même hygiène : un composant en cache hit doit
        // rester compté dans computeVarRegistry(), sinon ses variables $$ (déclarées OU
        // lus) disparaîtraient du registre à chaque fichier NON touché par ce compile.
        // variants — même hygiène que ci-dessus, pour les satellites de variant :
        // un cache hit doit les RÉÉCRIRE lui aussi (writeIfChanged, jumeau exact du chemin froid
        // plus bas), sinon un ménage manuel du dossier de sortie pendant `mjs dev`
        // (Bundler.watch() réutilise la MÊME instance toute la session, contrairement à
        // `mjs build` qui repart d'un cache froid à chaque process) laisse le variant
        // manquante jusqu'à ce que ce composant précis soit retouché.
        for (const layoutName of Object.keys(cached.layoutCss ?? {})) {
          if (!cached.layoutCss![layoutName]) continue   // modèle du HTML seul (µlayout) : aucun style
          this.writeLayoutCss(join(this.outputDir, `${moduleName}.${layoutName}.css`), cached.layoutCss![layoutName])
        }
        // variants — jumeau exact du chemin froid plus bas, même raison que
        // pendingVarData juste en dessous : le croisement layout="x" a besoin des
        // variants de CE module même s'il n'a pas été recompilé ce tour-ci.
        this.registerLayoutNames(filePath, moduleNameOverride, cached.layoutCss)
        // Même hygiène, et c'est la plus coûteuse à rater : resolveTagShortcuts()
        // ne compile un module cœur que si QUELQU'UN le réclame CE tour-ci. Un composant
        // en cache hit ne repassait pas par _compileMjsInner, donc ne redéposait aucune
        // référence : au premier rebuild incrémental de `mjs dev`, <@@switch>/<@@checkbox>/
        // <@@radio>… quittaient `µ.paths` et leur balise 404ait en silence (écran blanc)
        // jusqu'au redémarrage. Invisible en `mjs build` (cache froid par process)
        for (const ref of cached.tagRefs ?? []) {
          this.pendingTagRefs.push({ file: filePath, name: ref.name, kind: ref.kind, layoutLiteral: ref.layoutLiteral, ...(ref.attrs ? { attrs: ref.attrs } : {}) })
        }
        // règles des stores : même hygiène, sinon un conflit avec un composant inchangé passerait
        for (const [store, text] of Object.entries(cached.storeTypes ?? {})) this.pendingStoreTypes.push({ store, text, file: filePath })
        // ses avertissements de section : même hygiène, sinon ils ne se disent qu'au tour qui le compile
        for (const w of cached.sectionWarnings ?? []) this.pendingSectionWarnings.push(t('bundler.index.erreur-fichier-detail', { fichier: filePath, detail: w }))
        // jumeau exact du bloc tagRefs ci-dessus, même raison (cache-hit qui ne
        // repasse pas par _compileMjsInner) — `content` est déjà lu inconditionnellement
        // en tête de méthode, le scan @import (masqué <pre>/<code>) reste donc bon marché
        // même sur un cache-hit (aucun besoin de le mettre lui aussi en cache).
        this.pendingComponentDeps.push({ moduleName, deps: [...(cached.componentDeps ?? []), ...this.directImportDepKeys(content)] })
        this.pendingVarData.push({
          file: filePath,
          moduleName,
          baseCss: cached.baseCss ?? '',
          layoutCss: cached.layoutCss ?? {},
          themeVars: cached.themeVars ?? [],
          varsRead: cached.varsRead ?? [],
          posed: scanPosedVars(content, this.varPrefix),
        })
        // PLUS de `emittedThisCompile.add`/`cacheHitsThisCompile++` ICI : ce cache-hit
        // n'est encore qu'un CANDIDAT (phase A) — sa confirmation (embeds identiques) ou son
        // invalidation (embeds différents, recompilation au chemin froid) se décide en phase
        // C (cf. compile()), seul endroit où ces deux compteurs sont mis à jour pour cette
        // unité désormais. Rend le REPÈRE, jamais le chemin final (pas encore sûr, cf. § 4 de
        // la conception : un composant froid qui embarquerait le chemin RÉEL d'un module en
        // cache-hit se retrouverait faux si ce module se révèle périmé en phase C).
        this.pendingUnits.set(moduleName, { kind: 'cached', file: filePath, stem: moduleName, cached })
        return this.placeholderPath(moduleName, '.js')
      }
    }

    return this.compileMjsCold(filePath, moduleName, moduleNameOverride, { silent: false })
  }

  // --------------------------------------------------------------------------
  // compileMjsCold() : chemin FROID de compilation d'un composant .mjs — extrait de
  // _compileMjsInner pour être réutilisé par la phase C de compile() quand un cache-hit
  // CANDIDAT se révèle PÉRIMÉ (cœur/feuilles split changés) et doit être recompilé APRÈS la
  // phase A. `opts.silent = true` = ne PAS re-pousser les métadonnées déjà hydratées en phase
  // A (tagRefs, componentDeps, varData, fichiers variants, warnings de section, reverse-map
  // des deps) — un composant périmé a DÉJÀ été vu une fois (cache-hit candidat), les
  // redéposer doublonnerait `this.pending*`. Rend le REPÈRE de l'unité (jamais le chemin
  // final, inconnu à ce stade) et l'enregistre en attente d'émission topologique (cf.
  // compile()) — plus aucun `writeHashed()`/`this.cache.set()` ici.
  // --------------------------------------------------------------------------
  private async compileMjsCold(filePath: string, moduleName: string, moduleNameOverride: string | undefined, opts: { silent: boolean }): Promise<string> {
    const content = this.mjsSource(filePath)
    const shortName = moduleNameOverride ?? this.shortModuleName(filePath)
    // Un alias réservé/core- (isReservedShortcutName) ne doit JAMAIS être
    // enregistré comme custom element : voir aussi le repli côté manifeste dans
    // resolveTagShortcuts (le composant reste joignable par son nom complet SEULEMENT).
    const aliasReserved = shortName !== moduleName && this.isReservedShortcutName(shortName)

    // Pre-résolution des µasset() littéraux côté master (le worker n'a pas
    // accès au disque). Les références dynamiques `µasset(expr)` ne sont
    // pas couvertes ici — le worker recevra MISSING_MJS_ASSET et le master
    // les rattrape via `resolveMagicAssets` en post-compile.
    const { dict: preResolvedAssets, assetSources, images: preResolvedImages } = await this.preResolveAssets(content, dirname(filePath))

    // Le message de transpilation, identique quel que soit le chemin : le corps exécuté
    // est le même (transpile-msg.ts), dans un thread ou ici même.
    const msg: TranspileMsg = {
      type: 'transpile',
      id: 0,
      content,
      moduleName,
      // déduit du VRAI nom de fichier (moduleName ci-dessus l'a déjà perdu, cf.
      // pageAwareBaseName) : seul point où la garde de compilation (transpiler/index.ts,
      // TranspileOpts.isPageModule) sait si CE fichier a le droit de porter <routes>/@routes/<@view>.
      isPageModule: isPageFile(filePath),
      defaultScriptLang: this.defaultScriptLang,
      templateLang: this.templateLang,
      sigil: this.sigil,
      contextAlias: this.contextAlias,
      varPrefix: this.varPrefix,
      maxStateVars: this.maxStateVars,
      a11y: this.a11y,
      ujsForm: this.ujsForm,
      lint: this.lint,
      colorsEnabled: this.colorsEnabled,
      lang: getMessagesLang(),
      baseDir: dirname(filePath),
      sourceDir: this.sourceDir,
      aliasTag: shortName !== moduleName && !aliasReserved ? `mjs-${shortName}` : undefined,
      dirInject: `${this.urlPrefix}/`,
      preResolvedAssets,
      preResolvedImages,
      typeDefs: this.typeDefs,
      // sans les alias que ModularJS livre tels quels : chaque thread les connaît déjà (cf. effectDefsToWire)
      effectDefsWire: effectDefsToWire(this.effectDefs),
      typesText: !this.isProd(),
      devWarnings: !this.isProd(),
      skeleton: this.effectsConf?.skeleton,
      guard: this.effectsConf?.guard,
      typedStores: this.typedStores,
      models: this.componentModels,
    }
    // Sous le seuil (`inlineTranspile`), on appelle transpile() ICI : `ensureWorkerPool` n'est
    // même pas touché, donc aucun thread n'est démarré pour un petit projet. Au-dessus, submit
    // au pool : transpile() en parallèle dans un thread séparé → 66% du temps de compilation
    // hors du thread principal. Un `throw` remonte pareil des deux côtés (stats.errors).
    const { output, data, sourceMap: transpileMap } = this.inlineTranspile
      ? await transpileFromMsg(msg) as { output: string; data: TranspileDataLike; sourceMap?: string }
      : await (await this.ensureWorkerPool()).submit<{ output: string; data: TranspileDataLike; sourceMap?: string }>(msg)
    // Motif dominant de ce genre de bogue (« erreur
    // avalée → build vert ») : `processIncludes` (macros.ts, `<@include>`)
    // ne faisait qu'un `console.error` DANS LE WORKER pour un partial
    // introuvable / une inclusion circulaire — jamais remonté dans
    // `stats.errors`, `mjs build` continuait de rapporter un succès (exit 0)
    // alors que le composant est réellement INCOMPLET. Un pipeline CI qui ne
    // grep pas les logs bruts (juste le code de sortie) ne voyait JAMAIS le
    // problème. Fix : throw ici — remonté par le caller (parallelMap) dans
    // `stats.errors`, même sévérité que les autres cas « asset introuvable »
    // de ce volet.
    this.lintPrintedByTranspiles += data.lintPrinted ?? 0
    if (data.macroErrors.length > 0) {
      throw new Error(t('bundler.index.erreur-fichier-detail', { fichier: filePath, detail: data.macroErrors.join(' ; ') }))
    }
    // `opts.silent` (recompilation d'un cache-hit périmé en phase C) : toutes les
    // métadonnées ci-dessous ont DÉJÀ été poussées dans this.pending* au premier passage
    // (cache-hit CANDIDAT, phase A) — les repousser doublonnerait tagRefs/componentDeps/
    // varData/warnings, et réécrirait pour rien les satellites de variant.
    if (!opts.silent) {
      // Non fatal (contrairement
      // à macroErrors) : accumulé pour fusion dans stats.warnings en fin de compile().
      for (const w of data.sectionWarnings) {
        this.pendingSectionWarnings.push(t('bundler.index.erreur-fichier-detail', { fichier: filePath, detail: w }))
      }
      // Accumulé pour résolution en post-passe (resolveTagShortcuts,
      // APRÈS le manifeste complet) : un seul fichier ne connaît pas les autres.
      for (const ref of data.tagRefs ?? []) {
        this.pendingTagRefs.push({ file: filePath, name: ref.name, kind: ref.kind, layoutLiteral: ref.layoutLiteral, ...(ref.attrs ? { attrs: ref.attrs } : {}) })
      }
      for (const [store, text] of Object.entries((data.storeTypes ?? {}) as Record<string, string>)) this.pendingStoreTypes.push({ store, text, file: filePath })
      // jumeau exact du bloc tagRefs ci-dessus — dépendances directes de CE composant
      // (balises du gabarit + modules `@import`-és), résolues contre le manifeste
      // APRÈS resolveTagShortcuts() par buildManifestDeps() (writeManifest, µ_DEPS).
      this.pendingComponentDeps.push({ moduleName, deps: [...(data.componentDeps ?? []), ...this.directImportDepKeys(content)] })
      // variants (`<style name="…">`) : chaque bloc part dans un
      // fichier satellite STABLE `<mod>.<nom>.css`, exactement le chemin que le runtime
      // construit lui-même (`${this._mjs_dir}${this._mjs_modName}.${name}.css`, cf.
      // template.ts + mjs_element.ts) — `moduleName` est ICI la MÊME valeur EXACTE que
      // `[[MOD_NAME]]`/`_mjs_modName` (basename complet, pas shortName). AUCUNE suppression
      // d'un satellite : le mécanisme historique autorise un fichier déposé À LA MAIN, et
      // un `.css` orphelin ne fait de mal à personne (un `layout=` qui ne le nomme plus ne
      // le charge simplement plus jamais) — supprimer romprait ce contrat en silence.
      for (const layoutName of Object.keys(data.layoutCss ?? {})) {
        if (!data.layoutCss![layoutName]) continue   // modèle du HTML seul (µlayout) : aucun style
        this.writeLayoutCss(join(this.outputDir, `${moduleName}.${layoutName}.css`), data.layoutCss![layoutName])
      }
      // variants — jumeau exact du chemin cache-hit plus haut.
      this.registerLayoutNames(filePath, moduleNameOverride, data.layoutCss)
      // registre des variables de thème — accumulé pour computeVarRegistry() en fin de
      // compile() (jumeau exact de pendingTagRefs ci-dessus, même raison : un seul
      // fichier ne connaît pas les autres composants du projet).
      this.pendingVarData.push({
        file: filePath,
        moduleName,
        baseCss: data.baseCss,
        layoutCss: data.layoutCss ?? {},
        themeVars: data.themeVars ?? [],
        varsRead: data.varsRead ?? [],
        posed: scanPosedVars(content, this.varPrefix),
      })
    }
    // Accumule les animations utilisées via @transition.X / @in.X / @out.X — les appels directs
    // `µ.anim.X` du script s'y ajoutent plus bas, relevés sur `resolved`
    const fileAnims = new Set<string>(data.usedAnimations)
    // (crash-si-feuille-absente) — accumule les feuilles @css
    // référencées par CE fichier (jumeau de fileAnims/usedAnimations juste
    // au-dessus) ; validateSharedSheets() (appelée en fin de compile(), étape 2c)
    // fait échouer le build si l'une d'elles n'a aucun fichier sur disque.
    const fileSharedCssNames = data.sharedCssNames ?? []
    for (const c of fileSharedCssNames) this.requestedSharedSheets.add(c)
    // Extraction des modules `.civet`/`.coffee` importés via `@import` —
    // ils ne sont PAS détectés par le worker (qui ne voit que les partials
    // `<@include>`) mais doivent être tracked pour que le watcher invalide
    // les .mjs parents quand le module change. Bug type : éditer le .civet
    // change son hash → le .mjs garde une référence figée à l'ancien hash
    // → import 404 au prochain chargement.
    // Même fix que preResolveAssets,
    // cf. `extractImportMatches` : masquage `<pre>`/`<code>` + regex qui ne
    // peut plus enjamber les lignes.
    const importedModules = this.importedModulesOf(content, false)
    // ÉCART SOLDÉ : ferme la TRANSITIVE des @import (pas seulement les
    // imports DIRECTS de ce fichier) — cf. `collectTransitiveImportClosure`,
    // mécanisme partagé avec `_compileScriptModuleInner`. Un import direct qui
    // lui-même @import-e un 3e fichier doit propager le sel jusqu'ici.
    const absentNeighbors: MissingNeighbor[] = []
    const transitiveImportedModules = this.collectTransitiveImportClosure(importedModules, absentNeighbors)
    // Fusionne les SOURCES des µasset()
    // littéraux (remontées par preResolveAssets) avec les @import (fermeture
    // transitive), dédupliquées : toutes ces deps alimentent le hash de cache
    // ET le reverse-map, pour que le watcher invalide le parent quand N'IMPORTE
    // laquelle change, à N'IMPORTE quelle profondeur de la chaîne @import.
    // un .js cité par µimport/µasset entraîne aussi ses voisins importés par chemin relatif (cf.
    // rewriteRelativeJsImports) ; un module .civet/.coffee cité de même (µimport charge un module compilé) entraîne
    // ses propres @import : fermés comme les @import, pour qu'un voisin ou un maillon modifié invalide ce parent
    const jsAssetDeps = this.collectTransitiveImportClosure(assetSources.filter(p => MODULE_OU_JS_RE.test(p)), absentNeighbors)
    const trackedDeps = [...new Set([...transitiveImportedModules, ...assetSources, ...jsAssetDeps])]
    // un .js cité qui importe un voisin absent : le build réussit (l'import reste tel quel), mais le dit, avec
    // le composant (préfixe du message) et le chemin — repris du cache à chaque tour, comme les autres avertissements
    const neighborWarnings = this.missingNeighborWarnings(absentNeighbors)
    if (!opts.silent) for (const w of neighborWarnings) this.pendingSectionWarnings.push(t('bundler.index.erreur-fichier-detail', { fichier: filePath, detail: w }))
    // un composant qui cite une règle nommée dépend des fichiers *.types.mjs : une règle changée
    // le recompile (hash), et le watcher le sait (reverse-map ci-dessous)
    const typesDeps = data.usesNamedTypes ? [...this.typesFiles] : []
    // … et un composant qui pose un effet de l'appli dépend des fichiers *.effects.mjs
    const effectsDeps = data.usesProjectEffects ? [...this.effectsFiles, ...this.effectImageSources] : []
    // Mise à jour du reverse-map "dep → parents" : chaque partial inclus, module
    // @import-é OU asset µasset() de ce fichier voit son entrée enrichie avec ce
    // parent. Permet au watcher d'invalider et recompiler les parents à tout changement.
    if (!opts.silent) this.updatePartialDependents(filePath, [...data.includedPartials, ...trackedDeps, ...typesDeps, ...effectsDeps])
    const resolved = this.lazyModuleImports(await this.resolveMagicAssets(output))
    // Définitions (µanim.create/crossfade, nom en littéral) : exclues du faux "manquant" par
    // compileUsedAnimations(), cf. extractDefinedAnimationsFromAst. Sur `resolved`, PAS `output` : `output`
    // brut contient encore le marqueur non résolu `µ.asset('mjs_core.js')` en
    // tête d'import (résolu par resolveMagicAssets juste au-dessus) — un JS
    // syntaxiquement INVALIDE (`from <expr>` au lieu de `from <string>`), qui
    // fait échouer acorn.parse à coup sûr, pour CHAQUE fichier compilé.
    // `extractAnimationsFromAst` encaisse ça via son fallback regex
    // (silencieux) ; cette méthode-ci n'en a délibérément PAS (cf. son propre
    // commentaire) — sur `output`, elle ne détecterait donc JAMAIS rien.
    // usage (`µ.anim.X` / `window.µ.anim.X`) ET définitions, en une passe acorn sur `resolved` (JS valide) : sur `output`, le parse
    // échouait à chaque fois et le repli par motif lisait le texte — un `µ.anim.x` écrit dans une chaîne ou un commentaire comptait
    // comme un usage (faux avertissement, animation embarquée pour rien)
    const scriptAnims = this.extractAnimationsFromAstCombined(resolved)
    for (const name of scriptAnims.used) fileAnims.add(name)
    for (const a of fileAnims) this.usedAnimations.add(a)
    const fileAppAnims = [...fileAnims].filter(a => Object.hasOwn(this.effectDefs, a))
    const fileDefinedAnims = new Set<string>(scriptAnims.defined)
    for (const a of fileDefinedAnims) this.definedAnimations.add(a)
    // mode split : les feuilles DÉCLARÉES par ce module (fileSharedCssNames, cf. plus
    // haut) reçoivent ICI le REPÈRE de leur propre stem (emitSplitStyles() tourne désormais en
    // phase C, APRÈS les composants — cf. prependSplitCssImports()). `resolved` en mode
    // 'bundle' : AUCUN changement, chemin historique intact.
    const withSplitCss = this.cssMode === 'split' ? this.prependSplitCssImports(resolved, fileSharedCssNames) : resolved
    // signaux compilés (SCAN_KEYS) : sur la sortie NON MINIFIÉE (le minifieur mangle
    // les propriétés _mjs_*/_upd* via mangleCache, les marqueurs y deviennent invisibles),
    // APRÈS résolution des assets/imports split (repères compris — aucun marqueur recherché
    // ne s'y trouve). Alimente collectUsedFeatures() en phase B de compile().
    const features = [...scanCompiledFeatures(withSplitCss, data, this.aliasTable.map(n => this.effectDefs[n].fixed ?? {}))]
    for (const f of features) this.pendingFeatures.add(f)
    // le code de ses effets, un fichier par effet (cf. fxChunked) : importé en tête, il arrive avec
    // le composant — REPÈRE résolu en phase C, comme celui d'une feuille split
    const fxDeps = this.fxChunkKeys(features)
    this.pendingFxDeps.set(moduleName, fxDeps)
    const withFx = fxDeps.length > 0 ? fxDeps.map(k => `import '${this.placeholderPath(k, '.js')}';\n`).join('') + withSplitCss : withSplitCss
    // symboles du CONTRAT appelés par cette unité (core-contract.ts) — même texte, même moment,
    // mêmes raisons que les signaux ci-dessus : non minifié, après résolution des assets.
    const coreCalls = [...collectCoreCalls(withSplitCss)]
    for (const c of coreCalls) this.pendingCoreCalls.add(c)
    // `deps` = stems dont ce code contient le repère (cœur, feuilles split, AUTRES unités
    // @import/µasset-ées) — calculé sur le code NON MINIFIÉ : un repère est un CHEMIN
    // LITTÉRAL dans un import, jamais touché par le mangling (qui ne renomme que des
    // propriétés `_mjs_*`/`_upd*') — pas besoin d'attendre la minification (différée
    // plus bas) pour le connaître, l'émission topologique de compile() les résout dans
    // l'ordre de leurs dépendances.
    const deps = this.extractPlaceholderDeps(withFx)
    // même sel qu'avant, mais SANS coreHashedPath/cssSalt (retirés du hash lui-même,
    // cf. bandeau de _compileMjsInner) : hash = contenu SOURCE + deps, un point c'est tout.
    const hash = this.hashWithDeps(content + this.modelsSalt(), [...data.includedPartials, ...trackedDeps, ...typesDeps, ...effectsDeps])
    // ce fichier vient d'être RECOMPILÉ (cache miss/périmé) : il fait donc partie du "lot" de
    // changements de ce compile(). S'il n'a QUE son CSS de différent vs la dernière fois →
    // éligible "css-only" ; sinon (ou 1ʳᵉ apparition, rien à comparer) → disqualifie tout le
    // lot. Comportement inchangé (indépendant du cœur/des chemins finaux) — et indépendant
    // de la minification, donc calculé ICI, pas dans la tâche différée plus bas.
    if (!opts.silent && this.cssOnlyTracking) {
      const prevData = this.lastComponentData.get(filePath)
      if (prevData && dataEqualExceptBaseCss(prevData, data)) {
        const scopedCss = computeScopedCss(data)
        this.cssOnlyComponents[data.tagName] = scopedCss
        if (data.aliasTag && data.aliasTag !== data.tagName) this.cssOnlyComponents[data.aliasTag] = scopedCss
        // Réémission attendue d'un lot css-only (baseCss entre dans le hash du
        // fichier) — exemptée du filet central de writeHashed (cf. compile()).
        this.cssOnlyAllowedWrites.add(`${moduleName}.js`)
      } else {
        this.cssOnlyDisqualified = true
      }
      this.lastComponentData.set(filePath, data)
    }
    // noms portés par nom sur une instance (état, props écrites sur un enfant, méthodes) : sur la
    // sortie NON MINIFIÉE, comme les signaux compilés ci-dessus — réservés avant toute
    // minification du tour (cf. reserveInstanceNames()), inutiles sans minification
    const reservedNames = this.shouldMinify() ? collectInstanceNames(withFx) : []
    // Minification DIFFÉRÉE (cf. bandeau de `pendingMinifyTasks`) : `minifyJs` ne tourne
    // plus ICI, en parallèle avec les autres unités de la phase A — seul
    // `flushPendingMinifyTasks()` l'appelle, séquentiellement, triée par stem.
    this.pendingMinifyTasks.push({
      stem: moduleName,
      names: reservedNames,
      run: async () => {
        const minified = await minifyJs(this.isProd() ? stripMsgFallbacks(withFx) : withFx, {
          force: this.shouldMinify(),
          filename: basename(filePath),
          sourceMap: this.shouldEmitSourceMap(),
          mangleCache: this.mangleCache,
          logLevel: this.prodLogLevel(),
          dev: !this.isProd(),
        })
        // carte de source ÉCRITE. Deux cas, une seule règle : ce qui est écrit
        // doit pointer le `.mjs`, jamais un état intermédiaire.
        //   • sans minification (le cas du développement) : la carte du transpileur EST
        //     celle du fichier écrit, au décalage près des imports ajoutés en tête (feuilles
        //     du mode `css: 'split'`, fichiers d'effets) ;
        //   • avec esbuild : sa carte parle du texte que NOUS lui avons donné — on la
        //     recompose par-dessus la nôtre pour retomber sur le `.mjs`.
        const emitMap = this.shouldEmitSourceMap()
        let writtenMap = minified.map
        if (emitMap && transpileMap) {
          const prefixLines = withFx.length - resolved.length > 0
            ? withFx.slice(0, withFx.length - resolved.length).split('\n').length - 1
            : 0
          const aligned = shiftGeneratedPosition(transpileMap, prefixLines, 0)
          writtenMap = minified.map ? chainOverMap(minified.map, aligned) : aligned
        }
        // PLUS de writeHashed()/this.cache.set() ICI : le chemin final n'existe pas
        // encore (le cœur/les feuilles split ne sont connus qu'en phase C). L'unité part
        // en attente d'émission topologique.
        this.pendingUnits.set(moduleName, {
          kind: 'cold',
          file: filePath,
          stem: moduleName,
          ext: '.js',
          code: minified.code,
          map: writtenMap,
          deps,
          features,
          cacheFields: {
            hash,
            usedAnimations: [...fileAnims],
            appAnimations: fileAppAnims,
            definedAnimations: [...fileDefinedAnims],
            sharedCssNames: [...fileSharedCssNames],
            includedPartials: [...data.includedPartials],
            importedModules: [...trackedDeps],
            typesDeps,
            effectsDeps,
            storeTypes: { ...(data.storeTypes ?? {}) },
            sectionWarnings: [...data.sectionWarnings, ...neighborWarnings],
            baseCss: data.baseCss,
            layoutCss: data.layoutCss ?? {},
            themeVars: data.themeVars ?? [],
            varsRead: data.varsRead ?? [],
            tagRefs: (data.tagRefs ?? []).map(r => ({ name: r.name, kind: r.kind, layoutLiteral: r.layoutLiteral, ...(r.attrs ? { attrs: r.attrs } : {}) })),
            componentDeps: [...(data.componentDeps ?? [])],
            reservedNames,
            coreCalls,
            // lue ICI, au moment où ce code vient d'être minifié (cf. CacheEntry.mangleGen)
            mangleGen: this.mangleGeneration,
          },
        })
      },
    })
    return this.placeholderPath(moduleName, '.js')
  }

  // --------------------------------------------------------------------------
  // hashWithDeps : SHA-256 contenu source + concat des contenus des deps
  // (partials inclus). 16 chars suffisent pour la collision en pratique (la
  // clé n'est pas utilisée comme identifiant cryptographique, juste pour
  // détecter un changement de contenu).
  // --------------------------------------------------------------------------
  // les modèles en fichier, dans l'empreinte de chaque composant (vide sans modèle : rien ne change
  // pour un projet qui n'en a pas) — un modèle ajouté ou retiré change la balise qu'écrit un parent
  private modelsSalt(): string {
    const { dev, core } = this.componentModels
    const models = Object.keys(dev).length + Object.keys(core).length > 0 ? '\0models:' + JSON.stringify(this.componentModels) : ''
    // les stores typés aussi : un store qui prend une règle ailleurs garde les champs liés à lui ; et le
    // garde d'office muet (`effects.guard: false`), qui change ce que le composant pose
    return models + (this.typedStores.length > 0 ? '\0typedStores:' + this.typedStores.join(',') : '') + (this.effectsConf?.guard === false ? '\0guard:silent' : '') + (this.aliasTable.length > 0 ? '\0alias:' + this.aliasTable.join(',') : '')
  }

  private hashWithDeps(content: string, deps: string[]): string {
    const h = createHash('sha256')
    h.update(content)
    // Tri pour stabilité — l'ordre de découverte des partials peut varier
    // entre exécutions, mais le hash doit être déterministe.
    for (const dep of [...deps].sort()) {
      try {
        h.update('\0')  // séparateur pour éviter collision content||dep
        h.update(this.depDigest(dep))
      } catch {
        // Dep introuvable (renommée/supprimée) : on inclut le path lui-même
        // pour invalider quand même.
        h.update(dep)
      }
    }
    return h.digest('hex').slice(0, 16)
  }

  // --------------------------------------------------------------------------
  // depDigest : SHA-256 du CONTENU d'une dépendance, mémoïsé par chemin et validé par
  // (mtimeNs, size) — PLUS la position par rapport à `compileStartMs` (l'instant où CE
  // compile() a commencé, figé une fois pour tout le tour, cf. son affectation) : un fichier
  // dont le mtime tombe À ou APRÈS cet instant n'est JAMAIS servi depuis le mémo, quels que
  // soient (mtimeNs, size). Sans cette garde, (mtimeNs, size) SEULS peuvent mentir : deux
  // écritures RÉELLES survenant PENDANT le même tour (un fichier resauvegardé alors que le
  // build tourne encore) peuvent tomber sur la même paire — `touch -d`, ou simplement la
  // granularité grossière de certains systèmes de fichiers (FAT32, deux secondes) — et le
  // mémo rendrait alors le digest de l'ANCIEN contenu (mécanisme cassé, prouvé par collision
  // forcée). Un fichier édité AVANT le début du tour, lui, n'a aucune raison de changer une
  // fois le tour lancé : rien dans compile() ne réécrit les sources qu'il lit. C'est
  // exactement le cas le plus courant en `mjs dev`/watch (le fichier qui vient de déclencher
  // CE tour a été écrit avant que `compile()` ne soit invoqué) — la mémoïsation y reste donc
  // pleinement active : un partial partagé par 30 composants est relu une seule fois par tour,
  // pas 30, même s'il vient d'être modifié à l'instant.
  // --------------------------------------------------------------------------
  private compileStartMs = Date.now()
  private depDigestCache = new Map<string, { mtimeNs: bigint; size: bigint; digest: Buffer }>()

  private depDigest(dep: string): Buffer {
    const st       = statSync(dep, { bigint: true })
    const mtimeMs  = Number(st.mtimeNs / 1_000_000n)
    const cached   = this.depDigestCache.get(dep)
    if(cached && cached.mtimeNs === st.mtimeNs && cached.size === st.size && mtimeMs < this.compileStartMs) return cached.digest
    const digest = createHash('sha256').update(readFileSync(dep)).digest()
    this.depDigestCache.set(dep, { mtimeNs: st.mtimeNs, size: st.size, digest })
    return digest
  }

  // --------------------------------------------------------------------------
  // collectTransitiveImportClosure : ferme récursivement l'ensemble des
  // modules `@import`-és — PAS seulement profondeur 1 (bogue réel vérifié :
  // A @import B, B @import C ; seul C change → B recompile et change de hash,
  // mais A ne relisait jusqu'ici QUE le contenu ACTUEL de B au moment du
  // hash — s'il faisait un cache-hit périmé sur SON PROPRE stamp stocké, la
  // propagation s'arrêtait à B et A rendait une valeur figée, silencieusement).
  //
  // Factorisée ICI (mécanisme PARTAGÉ, un seul point de vérité) : appelée par
  // `_compileMjsInner` (composants .mjs, `trackedDeps`) ET par
  // `_compileScriptModuleInner` (modules autonomes .civet/.coffee,
  // `importedModules`) — même extraction (`extractImportMatches`), même
  // résolution de chemin (`resolve(this.sourceDir, p)`) que l'existant en
  // profondeur 1, juste itérée sur le contenu de CHAQUE dépendance à son tour.
  //
  // `visited` coupe les cycles : un cycle A↔B via @import est déjà REJETÉ
  // ailleurs (compileWithDedup, détection dédiée) — ici on doit juste ne
  // jamais boucler ni jeter, `visited` (BFS) suffit.
  //
  // Pas de mémoïsation inter-appels : les fichiers changent PENDANT un build
  // incrémental (watcher) — un cache basé sur le path seul rouvrirait
  // exactement le bug qu'on corrige (contenu périmé). Le seul motif déjà en
  // place ici est le dédoublonnage par `visited` À L'INTÉRIEUR d'un même
  // appel, ce qui suffit à ne jamais relire deux fois le même fichier pour
  // une closure donnée.
  // --------------------------------------------------------------------------
  // confineImportedPath() — même garde que <@include>/les liens : un
  // `@import`/`µimport` relatif (`../dehors/x.civet`) résolvait n'importe où hors sourceDir,
  // SANS garde — content lu (hashWithDeps/depDigest) pour un fichier hors du projet, avant même
  // que resolveOneAsset (préresolution des assets, confinement déjà en place) ne refuse la
  // référence pour de bon. Confinement LEXICAL seul ici : ce chemin ne sert JAMAIS à publier du
  // contenu (juste au hash de cache et au reverse-map du watcher) — hors racine → ignoré.
  // `asset` : le chemin vient d'un `µasset(…)`, dont le fichier peut vivre dans un dossier de assetDirs quand sourceDir ne le porte pas
  // importedModulesOf() : chemins réels des modules que `src` importe — `@import nom 'chemin'` (cf. extractImportMatches) et, avec
  // `muImports`, les `µimport('chemin')` / `µimport 'chemin'` hors des blocs de code affichés ; adresses externes ignorées, chemins
  // confinés au projet (cf. confineImportedPath). Seul relevé des deux émetteurs et de la compilation des modules : le suivi des
  // dépendances ne peut plus diverger d'un mode à l'autre
  private importedModulesOf(src: string, muImports = true): string[] {
    const chemins = extractImportMatches(src).map(im => im[1])
    if (muImports) {
      const masque = maskCodeBlocks(src)
      for (const im of masque.matchAll(MU_IMPORT_CALL_RE)) chemins.push(im[1])
      for (const im of masque.matchAll(MU_IMPORT_BARE_RE)) chemins.push(im[1])
    }
    const importedModules: string[] = []
    for (const p of chemins) {
      if (/^https?:\/\//.test(p)) continue
      const abs = this.confineImportedPath(p)
      if (abs) importedModules.push(abs)
    }
    return importedModules
  }

  // recompileScriptModuleCold() : unité `.civet` / `.coffee` périmée, recompilée au chemin froid (cf. emitPendingUnits, emitSingleFile)
  private async recompileScriptModuleCold(file: string, stem: string): Promise<void> {
    const ext = (file.endsWith('.civet') ? '.civet' : '.coffee') as '.civet' | '.coffee'
    const src = readFileSync(file, 'utf-8')
    await this.compileScriptModuleCold(file, ext, stem, this.importedModulesOf(src), src)
  }

  private confineImportedPath(p: string, asset = false): string | null {
    const root = resolve(this.sourceDir)
    const abs  = resolve(this.sourceDir, p)
    if (asset && this.assetDirs.length > 0) {
      const found = this.locateAsset(p)
      if (found) return found.source
    }
    if (abs !== root && !abs.startsWith(root + sep)) return null
    return abs
  }

  private collectTransitiveImportClosure(seedPaths: string[], missing?: MissingNeighbor[]): string[] {
    const visited = new Set<string>()
    const queue = [...seedPaths]
    // les .js atteints par la citation d'un module (ou par leurs voisins) : un voisin absent n'est dit qu'au module qui les cite
    const viaModule = new Set<string>()
    while (queue.length > 0) {
      const depPath = queue.shift()!
      if (visited.has(depPath)) continue
      visited.add(depPath)
      let depSrc: string
      try {
        depSrc = readFileSync(depPath, 'utf-8')
      } catch {
        continue  // dep introuvable : hashWithDeps gère déjà ce cas (hash du path lui-même)
      }
      for (const im of extractImportMatches(depSrc)) {
        const p = im[1]
        if (/^https?:\/\//.test(p)) continue
        const resolved = this.confineImportedPath(p)
        if (resolved && !visited.has(resolved)) queue.push(resolved)
      }
      // Même fermeture pour la forme NUE `µimport('X')`/`mjsimport('X')`
      // (appel direct, sans `@import name 'chemin'`) : sans ce volet, un module
      // .civet/.coffee @import-é qui appelle lui-même µimport() sur un asset
      // voit sa cible absente de `visited` — hash + reverse-map watch jamais
      // mis à jour quand cet asset change (cf. commentaire de MU_IMPORT_CALL_RE).
      for (const im of maskCodeBlocks(depSrc).matchAll(MU_IMPORT_CALL_RE)) {
        const p = im[1]
        if (/^https?:\/\//.test(p)) continue
        const resolved = this.confineImportedPath(p)
        if (resolved && !visited.has(resolved)) queue.push(resolved)
      }
      // Même fermeture pour la forme nue sans parenthèses
      for (const im of maskCodeBlocks(depSrc).matchAll(MU_IMPORT_BARE_RE)) {
        const p = im[1]
        if (/^https?:\/\//.test(p)) continue
        const resolved = this.confineImportedPath(p)
        if (resolved && !visited.has(resolved)) queue.push(resolved)
      }
      // un module de script qui cite un fichier par `µasset('chemin')` porte son empreinte dans son nom publié (cf.
      // _compileScriptModuleInner) : ce fichier entre dans la fermeture de son importeur, sinon l'importeur reste en
      // cache sur l'ancien nom quand le fichier cité change. Un module ou un .js cité est parcouru à son tour (ses
      // propres citations, ses voisins) ; une image ou un son n'est pas lu, il n'a rien à suivre
      if (/\.(?:civet|coffee)$/i.test(depPath)) {
        for (const am of depSrc.matchAll(ASSET_RE)) {
          if (/^https?:\/\//.test(am[4])) continue
          const resolved = this.confineImportedPath(am[4], true)
          if (!resolved || visited.has(resolved)) continue
          if (/\.(?:js|civet|coffee)$/i.test(resolved)) { if (!seedPaths.includes(resolved)) viaModule.add(resolved); queue.push(resolved) }
          else visited.add(resolved)
        }
      }
      // .js copié tel quel : ses voisins importés par chemin relatif entrent dans son nom publié (cf.
      // rewriteRelativeJsImports) — un voisin modifié doit invalider le parent, à toute profondeur
      if (depPath.toLowerCase().endsWith('.js')) {
        const root = resolve(this.sourceDir)
        for (const s of this.importsOfJs(depPath, depSrc)) {
          const abs = resolve(dirname(depPath), s.value)
          // un voisin sous la racine qui n'existe pas : rapporté à l'appelant, qui sait quel composant cite ce .js
          if (missing && !viaModule.has(depPath) && abs.startsWith(root + sep) && !existsSync(abs)) missing.push({ from: depPath, spec: s.value, abs })
          if (viaModule.has(depPath) && !seedPaths.includes(abs)) viaModule.add(abs)
          if (abs.startsWith(root + sep) && !visited.has(abs)) queue.push(abs)
        }
      }
    }
    return [...visited]
  }

  // --------------------------------------------------------------------------
  // extractAnimationsFromAst : parse le JS compilé et extrait les noms
  // d'animations référencées via `µ.anim.X` ou `window.µ.anim.X`.
  //
  // Remplace l'ancienne regex `µ\??\.anim\??\.([a-zA-Z0-9_]+)` qui matchait :
  //   - dans les strings : `µ.log('µ.anim.fade utilisé')` → faux positif
  //   - dans les commentaires : `// voir µ.anim.fade` → faux positif
  //   - dans les template literals : idem
  //
  // Et qui ratait :
  //   - les alias : `const a = µ.anim; a.fade(...)` (mais pas pris en charge ici
  //     non plus — l'alias casse aussi en V1, c'est une convention user)
  //
  // L'analyse AST est cleanly insensible au contexte string/comment et fournit
  // des résultats fiables. Si le code ne parse pas (esoteric Civet runtime
  // output), on retombe sur la regex en safety.
  // --------------------------------------------------------------------------
  private extractAnimationsFromAst(js: string): string[] {
    const anims = new Set<string>()
    let ast: acorn.Node
    try {
      ast = acorn.parse(js, { ecmaVersion: 'latest', sourceType: 'module' })
    } catch {
      // Fallback regex si parse échoue
      const matches = js.match(/(?:window\.)?µ\??\.anim\??\.([a-zA-Z0-9_]+)/g) ?? []
      for (const m of matches) {
        const name = m.match(/anim\??\.([a-zA-Z0-9_]+)/)?.[1]
        if (name) anims.add(name)
      }
      return [...anims]
    }

    // isMuIdentifier/isAnimNode : fonctions module-level ci-dessus (partagées
    // avec extractDefinedAnimationsFromAst, cf. leur commentaire).
    walk.simple(ast, {
      MemberExpression(node: any) {
        // node = `<anim>.X` → on veut node.object être `µ.anim`
        if (node.property?.type !== 'Identifier') return
        if (isAnimNode(node.object)) {
          anims.add(node.property.name)
        }
      },
    })

    return [...anims]
  }

  // --------------------------------------------------------------------------
  // extractDefinedAnimationsFromAst : jumeau AST de
  // extractAnimationsFromAst ci-dessus, mais côté DÉFINITION plutôt qu'usage.
  // Détecte les appels `µ.anim.create('nom', …)` / `µ.anim.crossfade('nom', …)`
  // (ou `window.µ.anim.…`) avec un 1er argument littéral (chaîne, ou gabarit sans substitution), et renvoie
  // les noms d'anim que CE fichier enregistre dynamiquement à l'exécution :
  //   - create('X')    → 'X'
  //   - crossfade('X') → 'XSend' + 'XReceive' (cf. runtime/animations/crossfade.ts)
  //
  // Sans ça, `compileUsedAnimations` (détecteur STATIQUE, ne voit que les
  // fichiers `<runtimeDir>/animations/*.ts`) traite ces noms comme manquants
  // — faux positif : ils existent bel et bien, juste enregistrés au runtime
  // par le `<script>` du composant, avant le rendu qui les utilise.
  //
  // Même garde-fou que extractAnimationsFromAst : parse échoué → `[]` (le
  // fallback regex de la méthode sœur reste la seule voie de secours utile
  // ici — resterait alors un faux "manquant" pour ce fichier précis, non
  // bloquant : au pire un warning bruyant, jamais un crash).
  // --------------------------------------------------------------------------
  private extractDefinedAnimationsFromAst(js: string): string[] {
    const defined = new Set<string>()
    let ast: acorn.Node
    try {
      ast = acorn.parse(js, { ecmaVersion: 'latest', sourceType: 'module' })
    } catch {
      return []
    }

    walk.simple(ast, {
      CallExpression(node: any) {
        const callee = node.callee
        if (!callee || callee.type !== 'MemberExpression') return
        if (callee.property?.type !== 'Identifier') return
        const method = callee.property.name
        if (method !== 'create' && method !== 'crossfade') return
        if (!isAnimNode(callee.object)) return
        const nom = literalName(node.arguments?.[0])
        if (nom === null) return
        if (method === 'create') {
          defined.add(nom)
        } else {
          defined.add(`${nom}Send`)
          defined.add(`${nom}Receive`)
        }
      },
    })

    return [...defined]
  }

  // --------------------------------------------------------------------------
  // extractAnimationsFromAstCombined : UNE SEULE passe acorn pour usage (µ.anim.X) ET
  // définition (µ.anim.create/crossfade('X')) sur le MÊME texte — jumeau fusionné des deux
  // méthodes ci-dessus, pour les appelants qui lisent les deux sur un texte IDENTIQUE : un module
  // .civet/.coffee autonome, et le composant .mjs sur `resolved` (son `output` brut, marqueur µasset
  // non résolu, échouait au parse et retombait sur le repli par motif, qui lit aussi les chaînes).
  // --------------------------------------------------------------------------
  private extractAnimationsFromAstCombined(js: string): { used: string[]; defined: string[] } {
    const used = new Set<string>()
    const defined = new Set<string>()
    let ast: acorn.Node
    try {
      ast = acorn.parse(js, { ecmaVersion: 'latest', sourceType: 'module' })
    } catch {
      // même repli qu'extractAnimationsFromAst (usage) ; extractDefinedAnimationsFromAst ne
      // tente rien de plus sur un parse échoué (cf. son commentaire) — la combinée fait pareil.
      const matches = js.match(/(?:window\.)?µ\??\.anim\??\.([a-zA-Z0-9_]+)/g) ?? []
      for (const m of matches) {
        const name = m.match(/anim\??\.([a-zA-Z0-9_]+)/)?.[1]
        if (name) used.add(name)
      }
      return { used: [...used], defined: [] }
    }
    walk.simple(ast, {
      MemberExpression(node: any) {
        if (node.property?.type !== 'Identifier') return
        if (isAnimNode(node.object)) used.add(node.property.name)
      },
      CallExpression(node: any) {
        const callee = node.callee
        if (!callee || callee.type !== 'MemberExpression') return
        if (callee.property?.type !== 'Identifier') return
        const method = callee.property.name
        if (method !== 'create' && method !== 'crossfade') return
        if (!isAnimNode(callee.object)) return
        const nom = literalName(node.arguments?.[0])
        if (nom === null) return
        if (method === 'create') defined.add(nom)
        else { defined.add(`${nom}Send`); defined.add(`${nom}Receive`) }
      },
    })
    return { used: [...used], defined: [...defined] }
  }

  // --------------------------------------------------------------------------
  // updatePartialDependents : remplace les entrées du reverse-map pour ce
  // parent (on retire les vieilles deps puis on ajoute les nouvelles).
  // --------------------------------------------------------------------------
  private updatePartialDependents(parent: string, partials: string[]): void {
    // Retire `parent` de toutes les anciennes entrées (au cas où une @include
    // a été supprimée du fichier).
    for (const set of this.partialDependents.values()) set.delete(parent)
    // Ajoute `parent` aux entrées des partials actuellement inclus.
    for (const partial of partials) {
      let set = this.partialDependents.get(partial)
      if (!set) { set = new Set(); this.partialDependents.set(partial, set) }
      set.add(parent)
    }
  }

  // --------------------------------------------------------------------------
  // compileScriptModule() : .civet|.coffee → .js via adapter approprié.
  // Wrappé dans `withState()` comme compileMjs pour isolation parallèle.
  //
  // Dédup + détection de cycle : cf. le commentaire détaillé de
  // `compileWithDedup`/`compileMjs` — MÊME mécanisme partagé (un `.mjs` peut
  // référencer ce `.civet`, qui peut lui-même référencer un `.mjs`, donc un
  // cycle peut traverser les deux types de fichiers).
  // --------------------------------------------------------------------------
  async compileScriptModule(filePath: string, ext: '.civet' | '.coffee'): Promise<string> {
    return this.compileWithDedup(filePath, () => withState(() => this._compileScriptModuleInner(filePath, ext)) as Promise<string>)
  }

  // --------------------------------------------------------------------------
  // moduleStem(file, ext) : le stem d'un module autonome (.civet/.coffee) — la clé de son unité, de sa place au manifeste et de
  // son nom publié (`<stem>-<empreinte>.js`). C'est son nom de fichier ; quand deux modules du projet portent le même nom dans
  // deux dossiers (`a/outil.module.civet`, `b/outil.module.civet`), chacun prend son dossier devant (`a_outil.module`) : sinon
  // l'un reçoit le code de l'autre et leurs sorties s'écrasent. Calculé à chaque compile() sur l'ensemble des modules
  // (assignModuleStems), jamais selon l'ordre où ils se compilent : mêmes fichiers, mêmes noms.
  // --------------------------------------------------------------------------
  private moduleStems: Map<string, string> = new Map()
  /** modules au nom refusé (cf. MODULE_STEM_RE) : chemin → nom ; un composant qui les importe échoue sur la même erreur */
  private refusedModuleStems: Map<string, string> = new Map()

  private moduleStem(file: string, ext: string): string {
    return this.moduleStems.get(resolve(file)) ?? basename(file, ext)
  }

  /** le dossier d'un module sous sourceDir, séparateurs remplacés par `_` ; vide pour un module posé directement dans sourceDir */
  private moduleDir(file: string): string {
    return relative(this.sourceDir, dirname(file)).split(sep).filter(s => s !== '' && s !== '.').join('_')
  }

  // nom publié d'un module : il devient une adresse (`<prefix>/<stem>-<empreinte>.js`) lue dans un import — un `#` ou un `?` y
  // coupait l'adresse (404, tout le graphe de la page tombait), une espace cassait les repères internes ; `mjs_` est l'espace des
  // unités internes (`mjs_core`…) : un module `mjs_core.civet` prenait la place du cœur chez ses importeurs
  private static readonly MODULE_STEM_RE = /^[\p{L}\p{N}_][\p{L}\p{N}_.-]*$/u

  private assignModuleStems(files: string[]): { file: string, stem: string }[] {
    const cmp    = (a: string, b: string): number => a < b ? -1 : a > b ? 1 : 0
    const parNom = new Map<string, string[]>()
    for (const f of files) {
      const nom = basename(f, extname(f))
      const l   = parNom.get(nom)
      if (l) l.push(f)
      else parNom.set(nom, [f])
    }
    const stems = new Map<string, string>()
    const pris  = new Set<string>()
    // garde son nom : le module de nom unique, et, parmi des homonymes, celui qui est posé directement dans sourceDir
    for (const [nom, l] of parNom) {
      const garde = l.length === 1 ? l[0] : [...l].sort(cmp).find(f => this.moduleDir(f) === '')
      if (garde === undefined) continue
      stems.set(resolve(garde), nom)
      pris.add(nom)
    }
    for (const [nom, l] of [...parNom].sort(([a], [b]) => cmp(a, b))) {
      for (const f of [...l].sort(cmp)) {
        if (stems.has(resolve(f))) continue
        const dossier = this.moduleDir(f)
        let stem = dossier === '' ? nom : `${dossier}_${nom}`
        if (pris.has(stem)) stem = `${stem}_${createHash('md5').update(relative(this.sourceDir, f)).digest('hex').slice(0, 4)}`
        const depart = stem
        for (let n = 2; pris.has(stem); n++) stem = `${depart}_${n}`
        pris.add(stem)
        stems.set(resolve(f), stem)
      }
    }
    const refuses: { file: string, stem: string }[] = []
    for (const f of [...files].sort(cmp)) {
      const stem = stems.get(resolve(f))
      if (stem !== undefined && (!Bundler.MODULE_STEM_RE.test(stem) || stem.startsWith('mjs_'))) {
        refuses.push({ file: f, stem })
        stems.delete(resolve(f))
      }
    }
    this.moduleStems = stems
    this.refusedModuleStems = new Map(refuses.map(r => [resolve(r.file), r.stem]))
    return refuses
  }

  private async _compileScriptModuleInner(filePath: string, ext: '.civet' | '.coffee'): Promise<string> {
    const refusedStem = this.refusedModuleStems.get(resolve(filePath))
    if (refusedStem !== undefined) throw new Error(t('bundler.index.module-nom-invalide', { fichier: filePath, nom: refusedStem }))
    const cacheKey = filePath
    const cached = this.cache.get(cacheKey)
    const src = readFileSync(filePath, 'utf-8')
    const baseName = this.moduleStem(filePath, ext)
    // PLUS de sel du cœur dans ce hash (cf. bandeau jumeau de _compileMjsInner) : la
    // sortie compilée en mémoire n'embarque plus qu'un REPÈRE, identique d'un tour à l'autre
    // tant que le SOURCE ne change pas. Un cache-hit ICI n'est qu'un CANDIDAT, confirmé ou
    // périmé en phase C (cf. compile(), `CacheEntry.embeds`). Historique du bug que ce sel
    // corrigeait avant ce mécanisme : le hash de cache n'était calculé QUE sur `src`, sans sel du
    // core — or `autoImportMu()` plus bas embarque en dur
    // `import { µ } from '<coreHashedPath>'` dans la sortie compilée. En watch,
    // rebuild du runtime → nouveau mjs_core-<hash>, ANCIEN supprimé ; un module
    // .civet/.coffee dont le SOURCE n'a pas changé faisait un cache hit (même
    // stamp) → renvoyait un hashedPath dont le fichier sur disque pointe encore
    // l'ANCIEN core, disparu → 404 généralisé au chargement, jusqu'à toucher
    // manuellement le fichier. Ceinture + bretelles (même garde que _compileMjsInner) :
    // exige AUSSI que le fichier de sortie existe encore sur disque.
    // ÉCART SOLDÉ : le stamp est salé AVEC la fermeture TRANSITIVE des
    // modules `@import`-és — pas seulement les imports DIRECTS de ce fichier
    // (limite corrigée : A @import B, B @import C, seul C change → sans la
    // fermeture, B recompile et change de hash, mais A cache-hit sur SON
    // PROPRE stamp figé référençait encore l'ANCIEN hash de B, silencieusement).
    // MIROIR exact de `_compileMjsInner`/`trackedDeps` — même ingrédient
    // (contenu brut de chaque dépendance, relu par `hashWithDeps`, pas un
    // mtime/taille) et même résolution de chemin (`resolve(this.sourceDir,
    // p)`, IDENTIQUE à celle de `resolveOneAsset` — `join(this.sourceDir,
    // logicalPath)` — donc aucun risque de diverger de ce que `resolveMagicAssets`
    // résout réellement plus bas), la fermeture elle-même factorisée dans
    // `collectTransitiveImportClosure` (mécanisme PARTAGÉ avec les composants
    // .mjs). Extraction directe via `extractImportMatches(src)`, la même
    // fonction que côté composants (regex + masquage `<pre>`/`<code>`),
    // appliquée ici sur le SOURCE brut du module (pas sur `dir.pendingAutoImports`,
    // pour ne pas dupliquer la logique de directives.ts) ; la fermeture
    // récursive relit ensuite chaque dépendance à son tour. Un chemin `@import`
    // introuvable n'est PAS re-throw ici : `hashWithDeps` retombe sur son propre
    // filet (hash du path lui-même si `readFileSync` échoue, cf. son commentaire)
    // — l'erreur claire existante reste celle levée plus bas par `resolveMagicAssets`
    // (MISSING_MJS_ASSET) au moment de la résolution réelle.
    //
    // Stratégie ceinture + bretelles identique à `_compileMjsInner` : sur un
    // cache hit potentiel, on réutilise `cached.importedModules` (la fermeture
    // TRANSITIVE CONNUE au tour précédent) plutôt que de re-scanner `src` — si
    // un NOUVEL `@import` a été ajouté, le texte de `src` a changé, donc le
    // hash change de toute façon via le contenu ; si SEUL un module de la
    // chaîne (direct OU transitif) a changé, son contenu relu par
    // `hashWithDeps` diffère → hash différent → cache miss, recompilation,
    // nouvelle fermeture (et nouveau hash) propagés.
    // `µimport('X')` / `µimport 'X'` DIRECTS compris (cf. importedModulesOf) : sans eux, la cible n'entrait ni dans
    // `importedModules` (seed de `collectTransitiveImportClosure` plus bas) ni dans le cache hit de CE module — édition de
    // l'asset jamais répercutée
    const importedModules = this.importedModulesOf(src)
    if (cached) {
      const expectedHash = this.hashWithDeps(src, cached.importedModules ?? [])
      if (cached.hash === expectedHash && this.cachedUnitStillOnDisk(cached)) {
        // Cache hit CANDIDAT : réinjecte les animations détectées pour ce module — même
        // hygiène que _compileMjsInner (cf. son commentaire ci-dessus) : sinon
        // un module autonome inchangé disparaît du Set partagé `usedAnimations`
        // au prochain rebuild incrémental (watcher) qui ne le recompile pas.
        for (const a of cached.usedAnimations ?? []) this.usedAnimations.add(a)
        // Même hygiène pour les anims DÉFINIES
        // dynamiquement, cf. le commentaire jumeau de _compileMjsInner.
        for (const a of cached.definedAnimations ?? []) this.definedAnimations.add(a)
        // signaux compilés : même hygiène que usedAnimations (cf. _compileMjsInner).
        for (const f of cached.features ?? []) this.pendingFeatures.add(f)
        // symboles du CONTRAT : même hygiène (cf. CacheEntry.coreCalls).
        for (const c of cached.coreCalls ?? []) this.pendingCoreCalls.add(c)
        // ses avertissements (un voisin .js absent d'un fichier qu'il cite) : redits, comme ceux d'un composant resté en cache
        this.pendingModuleWarnings.set(filePath, (cached.sectionWarnings ?? []).map(w => t('bundler.index.erreur-fichier-detail', { fichier: filePath, detail: w })))
        // PLUS de `emittedThisCompile.add`/`cacheHitsThisCompile++` ICI : confirmé ou
        // invalidé seulement en phase C (cf. _compileMjsInner, même raisonnement). Rend le
        // REPÈRE, jamais le chemin final.
        this.pendingUnits.set(baseName, { kind: 'cached', file: filePath, stem: baseName, cached })
        return this.placeholderPath(baseName, '.js')
      }
    }
    return this.compileScriptModuleCold(filePath, ext, baseName, importedModules, src)
  }

  // --------------------------------------------------------------------------
  // compileScriptModuleCold() : chemin FROID de compilation d'un module .civet/
  // .coffee autonome — extrait de _compileScriptModuleInner pour être réutilisé par la phase
  // C de compile() quand un cache-hit CANDIDAT se révèle PÉRIMÉ. Contrairement à
  // compileMjsCold() (composants .mjs), aucune métadonnée n'est poussée dans `this.pending*`
  // pour un module autonome (pas de tagRefs/componentDeps/varData/layoutCss) : rien à
  // distinguer entre 1er passage et recompilation périmée, pas de paramètre `silent`.
  // --------------------------------------------------------------------------
  private async compileScriptModuleCold(filePath: string, ext: '.civet' | '.coffee', baseName: string, importedModules: string[], src: string): Promise<string> {
    // Apply MJS sugar (µ. routing, runes µ$X, µ.inspect) AVANT compile langage.
    // Permet aux modules user d'utiliser µ$X = ... etc.
    const { applyMjsSugarToScript, lintNoRawImport, lintSplitRune, sigilAliasCode, parseModuleAst, sourceLineOf } = await import('../transpiler/index.js')
    const { extractDirectives } = await import('../transpiler/directives.js')
    const { tokenize } = await import('../lexer/index.js')
    // Passer le lang au sucre : sans lui, un module .coffee autonome
    // était civet-isé (for-in→of, etc.) puis rejeté par le compilateur Coffee
    const langName = ext === '.civet' ? 'civet' : 'coffee'
    // Lève limite 1 (cf. ssr-topo-sort-cycle-detection.test.ts, commentaire
    // en tête) : `@import` À L'INTÉRIEUR d'un module autonome n'était pas
    // reconnu (Civet le parsait comme `this.import(...)`, absurde). Même
    // canal que les composants .mjs (extractDirectives → pendingAutoImports,
    // cf. transpiler/index.ts "3. Auto-imports") — `resolveMagicAssets`
    // ci-dessous réécrit ensuite le `µasset('chemin')` injecté vers le nom
    // HACHÉ, sans autre changement de pipeline. Un module autonome n'a pas de
    // <style>/<@include>/persist/i18n/viewTransition : seul `pendingAutoImports`
    // a un sens ici — les autres champs de `DirectivesResult` (sharedCssNames,
    // moduleDisplay, persist*, i18n*, viewTransition*) sont silencieusement
    // ignorés (aucune section HTML/style à laquelle les appliquer dans un module).
    //
    // `@import µ$$X` (singleton réactif EXPORTÉ, forme courante — ou son
    // ancienne écriture `§§X`) reste interdit dans un module : c'est un
    // mécanisme de COMPOSANT (rendu réactif), pas de module autonome. Ni `§`
    // ni `µ` ne sont dans le charset de la regex `@import` de directives.ts
    // (contrairement à `$`) — sans ce garde-fou dédié, la ligne resterait donc
    // non reconnue et repartirait telle quelle vers Civet/Coffee (retour à la
    // limite 1, erreur de parse cryptique). Détecté ICI sur le source brut,
    // avant extractDirectives, pour un message explicite.
    const singletonImportLine = src.match(/^[ \t]*@import[ \t]+(?:default[ \t]+)?[^\n]*(?:§§|µ\$\$)[a-zA-Z0-9_]+[^\n]*$/m)
    if (singletonImportLine) {
      throw new Error(t('bundler.index.singleton-import-module-ligne', { fichier: basename(filePath), ligne: singletonImportLine[0].trim() }))
    }
    // rune séparée de son symbole (`µ` puis `.toast(…)` à la ligne suivante) : même refus qu'un composant, situé
    // sur la ligne du fichier
    lintSplitRune(src, basename(filePath), { sigil: this.sigil, lang: langName })
    const dir = extractDirectives(src)
    // Ceinture + bretelles : capte aussi la forme `@import $nomLitéral 'chemin'`
    // (dollar en clair, charset autorisé par la regex de directives.ts) —
    // même verdict que la forme `µ$$X`/`§§X` ci-dessus.
    if (dir.externalReactives.size > 0) {
      throw new Error(t('bundler.index.singleton-import-module-dollar', { fichier: basename(filePath), noms: [...dir.externalReactives].join(', ') }))
    }
    // alias ASCII du symbole (`sigil: 'mjs'`) : `mjs.x`/`mjs$x` → `µ.x`/`µ$x`, comme pour le script d'un composant
    // (transpiler/index.ts, étape 4b) — sans lui, un module importé émettait `mjs.log(…)` tel quel, `mjs` inconnu à
    // l'exécution. Dans le code seul, comme le composant : une chaîne ou un commentaire (`'voir mjs.dev'`) gardent leur texte
    const aliased   = this.sigil ? sigilAliasCode(dir.cleaned, this.sigil, langName) : dir.cleaned
    const moduleSrc = dir.pendingAutoImports.length > 0
      ? dir.pendingAutoImports.join('\n') + '\n' + aliased
      : aliased
    // lignes du fichier : les imports ajoutés devant décalent le texte lu
    const premiereLigne = 1 - dir.pendingAutoImports.length
    const preProcessed = tokenize(applyMjsSugarToScript(moduleSrc, langName, undefined, '<script module>', premiereLigne), { moduleMode: true, fileName: basename(filePath), firstLine: premiereLigne })
    const adapter = getAdapter(langName)
    // l'adaptateur retourne `{ code, map }` ; ce chemin-ci
    // (module `@import`-é autonome) ne garde que le code — sa carte ne sert qu'à citer la ligne du
    // fichier, le fichier n'ayant ni gabarit ni bloc `<script>` à décaler
    const compiled = await adapter.compileToJs(preProcessed, { fileName: basename(filePath), bare: true })
    let js = compiled.code
    // code qui suit un `return`, un `throw`, un `break` ou un `continue` dans le même bloc (cf.
    // transpiler/unreachable.ts) : cité à sa ligne du fichier, quand le sucre a gardé les lignes —
    // imports ajoutés devant exclus
    const keepsLines = preProcessed.split('\n').length === src.split('\n').length + dir.pendingAutoImports.length
    warnUnreachableCode(this.lint?.unreachable === false ? null : parseModuleAst(compiled.code), offset => {
      const line = keepsLines ? sourceLineOf(compiled.code, compiled.map, offset) : null
      return line !== null && line > dir.pendingAutoImports.length ? line - dir.pendingAutoImports.length : null
    }, basename(filePath), this.lint, this.colorsEnabled)
    // Civet préserve les assignations top-level bares (`foo = 1`) telles
    // quelles. En ESM strict mode c'est illégal. CoffeeScript en mode `bare`
    // injecte des `var` automatiquement ; on reproduit ce comportement pour
    // Civet en post-process.
    if (langName === 'civet') js = autoDeclareTopLevelBareAssignments(js, basename(filePath))
    // Lève limite 2 (cf. ssr-topo-sort-cycle-detection.test.ts, commentaire en
    // tête) : un `import {x} from './y.module.civet'` NATIF compilait tel quel
    // SANS réécriture vers le nom haché → `x` undefined en prod, silencieusement,
    // même sans aucune circularité. Décision de design : pas de réécriture des
    // imports natifs — REJET explicite (même garde que les composants .mjs,
    // cf. lintNoRawImport et son appel sur `<script module>`), un seul canal
    // d'import partout. `allowedLeadingImports` exempte les N imports RÉELS
    // injectés juste au-dessus par `dir.pendingAutoImports` (résolution @import).
    lintNoRawImport(js, `<script module> (${basename(filePath)})`, dir.pendingAutoImports.length)
    // Voie AST (post-Civet) : ferme le trou du gabarit (µimport niché
    // dans une interpolation ${…}/#{…}) pour ce module .civet/.coffee
    // autonome — remplace l'ancienne réécriture par scanner (rewriteMuImport,
    // retirée d'applyMjsSugarToScript, transpiler/index.ts). AVANT
    // `resolveMagicAssets` (plus bas) : le `µasset(...)` qui en naît doit
    // encore lui être soumis pour se résoudre en chemin haché réel.
    js = rewriteMuImportAst(js, `<script module> (${basename(filePath)})`)
    // écritures du store `$$` : `$$x.a.b = v` compilait en `µ.store.x.a.b = v`, une mutation de l'objet brut qui ne
    // prévenait aucun lecteur — le composant `.mjs` passe par cette même réécriture (`µ._mjs_storeDeepSet`…), le module
    // autonome aussi désormais (racines `µ.store` seules : pas d'état de composant ici)
    js = applyPathTrackingMapped(js, { storeOnly: true }).code
    // Scanne aussi ce module autonome pour `µ.anim.X` (même détection que les
    // composants .mjs, cf. extractAnimationsFromAst plus bas et son appel
    // dans _compileMjsInner) : un helper `@import`-é qui enregistre une anim
    // par appel direct (ex. `µanim.crossfade('todo', ...)`, sans aucun
    // `@transition/@in/@out` DANS ce fichier) n'était jusqu'ici JAMAIS ajouté
    // à `usedAnimations` — cette détection ne portait que sur la sortie
    // compilée des .mjs. `compileUsedAnimations` n'émettait donc jamais
    // `µ.anim.crossfade`, laissé `undefined` → `µ.anim.crossfade is not a
    // function` au premier appel côté composant.
    // usage ET définition en UNE SEULE passe acorn : ce module autonome n'a
    // qu'un seul texte à lire pour les deux (contrairement au composant .mjs, cf. le bandeau de
    // extractAnimationsFromAstCombined) — deux parses séparés du même texte n'auraient rien
    // trouvé de plus.
    const { used: fileAnims, defined: fileDefinedAnims } = this.extractAnimationsFromAstCombined(js)
    for (const a of fileAnims) this.usedAnimations.add(a)
    for (const a of fileDefinedAnims) this.definedAnimations.add(a)
    // ORDRE CRITIQUE (bug trouvé en écrivant les tests de la levée limite 1) :
    // `resolveMagicAssets` DOIT tourner AVANT `autoImportMu`. Un `@import`
    // résolu ci-dessus injecte encore un placeholder LITTÉRAL
    // `"µasset('chemin')"` à ce stade (non résolu) — sa détection naïve
    // `code.includes('µ')` matchait ce placeholder (le caractère µ du MOT
    // "µasset", rien à voir avec le rune `µ` réel) et injectait un faux
    // `import { µ } from '<core>'` MÊME dans un module qui n'utilise jamais
    // µ → `mjs_core.js` chargé hors navigateur (Node/SSR) plante
    // (`CSSStyleSheet is not defined`, API DOM absente). Résoudre D'ABORD les
    // µasset() fait disparaître le placeholder ; `autoImportMu` ne voit alors
    // plus que les VRAIS usages de `µ` dans le code utilisateur.
    const assetSources = new Set<string>()
    const resolved = this.lazyModuleImports(await this.resolveMagicAssets(js, assetSources))
    const withImport = this.autoImportMu(resolved)
    // signaux compilés : aucun TranspileData ici (module autonome, jamais de
    // `<style name>`) — `layout_variant` retombe sur le seul texte compilé (cf.
    // scanCompiledFeatures). Sur `withImport`, AVANT minify (mêmes raisons que
    // compileMjsCold : le minifieur mangle les symboles `_mjs_*`/`_upd*`).
    const features = [...scanCompiledFeatures(withImport)]
    for (const f of features) this.pendingFeatures.add(f)
    // symboles du CONTRAT — jumeau de compileMjsCold (cf. core-contract.ts).
    const coreCalls = [...collectCoreCalls(withImport)]
    for (const c of coreCalls) this.pendingCoreCalls.add(c)
    // `deps` sur le code NON MINIFIÉ (cf. bandeau jumeau de compileMjsCold : un repère est
    // un chemin littéral, jamais touché par le mangling) — pas besoin d'attendre la
    // minification différée plus bas.
    const deps = this.extractPlaceholderDeps(withImport)
    // Fermeture TRANSITIVE calculée seulement ici (cache MISS/périmé confirmé, cf. le
    // commentaire en tête de méthode) — pas plus tôt, pour ne jamais relire
    // inutilement les dépendances sur un cache hit qui retourne avant ce point.
    const absentNeighbors: MissingNeighbor[] = []
    const transitiveImportedModules = this.collectTransitiveImportClosure(importedModules, absentNeighbors)
    // ce que le module cite par `µasset(…)` entre dans ses dépendances comme pour un composant (cf. trackedDeps de
    // _compileMjsInner) : un fichier cité qui change le recompile, et le cache qui le resert sait quels fichiers publiés
    // garder au précache (cf. keepCachedAssets) ; un .js cité entraîne ses voisins, qui n'ont pas tous à exister
    const jsAssetDeps = this.collectTransitiveImportClosure([...assetSources].filter(p => MODULE_OU_JS_RE.test(p)), absentNeighbors)
    const trackedDeps = [...new Set([...transitiveImportedModules, ...assetSources, ...jsAssetDeps])]
    // un voisin absent d'un .js cité : le build réussit, mais le dit, avec le module et le chemin — repris du cache à chaque tour
    const neighborWarnings = this.missingNeighborWarnings(absentNeighbors)
    this.pendingModuleWarnings.set(filePath, neighborWarnings.map(w => t('bundler.index.erreur-fichier-detail', { fichier: filePath, detail: w })))
    // même sel qu'avant, mais SANS coreHashedPath (retiré du hash lui-même).
    const hash = this.hashWithDeps(src, trackedDeps)
    // noms portés par nom sur une instance : un module peut écrire sur un composant (cf.
    // compileMjsCold, même relevé sur le code NON MINIFIÉ)
    const reservedNames = this.shouldMinify() ? collectInstanceNames(withImport) : []
    // Minification DIFFÉRÉE (cf. bandeau de `pendingMinifyTasks` sur compileMjsCold, même
    // raisonnement — mangleCache PARTAGÉ, doit rester séquentiel et trié par stem).
    this.pendingMinifyTasks.push({
      stem: baseName,
      names: reservedNames,
      run: async () => {
        const minified = await minifyJs(this.isProd() ? stripMsgFallbacks(withImport) : withImport, {
          force: this.shouldMinify(),
          filename: basename(filePath),
          sourceMap: this.shouldEmitSourceMap(),
          mangleCache: this.mangleCache,
          logLevel: this.prodLogLevel(),
          dev: !this.isProd(),
        })
        // PLUS de writeHashed()/this.cache.set() ICI (cf. compileMjsCold, même
        // raisonnement) : l'unité part en attente d'émission topologique.
        this.pendingUnits.set(baseName, {
          kind: 'cold',
          file: filePath,
          stem: baseName,
          ext: '.js',
          code: minified.code,
          map: minified.map,
          deps,
          features,
          cacheFields: {
            hash,
            usedAnimations: fileAnims,
            definedAnimations: fileDefinedAnims,
            importedModules: trackedDeps,
            sectionWarnings: neighborWarnings,
            reservedNames,
            coreCalls,
            mangleGen: this.mangleGeneration,
          },
        })
      },
    })
    return this.placeholderPath(baseName, '.js')
  }

  // --------------------------------------------------------------------------
  // autoImportMu() : si le code source utilise µ (mais ne l'importe pas déjà),
  // préfixe `import { µ } from '<core hashed path>';`. Utilisé pour tous les
  // modules ES qui pourraient référencer µ : mjs_anims, mjs_styles, .coffee,
  // composants .mjs, etc.
  //
  // Détection conservative : `\bµ` matche la lettre µ comme identifiant.
  // Idempotent : si l'import existe déjà, no-op.
  // --------------------------------------------------------------------------
  private autoImportMu(code: string): string {
    // µ (U+00B5) n'est pas un word-char en regex JS, on évite \b
    if (!code.includes('µ')) return code
    // Déjà importé ?
    if (/import\s+\{[^}]*µ[^}]*\}\s+from\s+/m.test(code)) return code
    // la garde `if (!this.coreHashedPath) return code` a disparu : elle rendait un
    // module qui utilise µ SANS import, silencieusement cassé. En phase A, le cœur est
    // encore inconnu → REPÈRE, résolu en phase C (cf. compile()).
    return `import { µ } from '${this.coreHashedPath || this.placeholderPath('mjs_core', '.js')}';\n${code}`
  }

  // --------------------------------------------------------------------------
  // --------------------------------------------------------------------------
  // compileThemeFiles() : les `*.theme.mjs` → une feuille de document unique.
  //
  // Un thème est un paquet de variables, pas un composant : rien à enregistrer comme
  // custom element, rien à hacher, rien à charger à la demande. Le CSS agrégé part dans
  // le manifeste (`µ._themeCss`) et la liste des noms avec lui (`µ._themes`) — c'est
  // elle qui autorise la rune `µtheme` à accepter autre chose que clair/sombre.
  // Une erreur ici FAIT ÉCHOUER le build : un thème qui ne compile pas donnerait une
  // page sans couleurs, exactement le genre de panne qu'on découvre en regardant.
  // --------------------------------------------------------------------------
  compileThemeFiles(files: string[]): void {
    // tout se compile avant la moindre affectation : un thème fautif laisse en place ceux du dernier tour réussi, que `mjs dev`
    // publie toujours — jamais un manifeste sans aucun thème
    const compiles = files.map(f => compileThemeFile(readFileSync(f, 'utf-8'), f, { varPrefix: this.varPrefix, defaultTheme: this.defaultTheme }))
    this.themeCss   = compiles.length === 0 ? '' : assembleThemes(compiles, this.defaultTheme)
    this.themeNames = compiles.map(th => th.name)
    // registre des variables de thème — CompiledTheme.vars/.read étaient jetés ici : c'est
    // TOUT ce qu'il manquait pour que computeVarRegistry() sache ce qu'un fichier de
    // thème déclare et lit (jumeau exact de ce que le transpiler remonte déjà par composant).
    this.themeVarData = compiles.map((th, i) => ({ file: files[i], name: th.name, css: th.css, vars: th.vars, read: th.read }))
  }

  // compileTypesFiles() : les `*.types.mjs` → la table des règles nommées de l'appli, transmise à
  // chaque transpilation (un composant qui en cite une l'embarque, résolue — rien au runtime).
  // Une erreur ici FAIT ÉCHOUER le build, comme un thème (un nom en double, une règle inconnue).
  // --------------------------------------------------------------------------
  compileTypesFiles(files: string[]): void {
    this.typesFiles = [...files].sort()
    this.typeDefs   = files.length === 0 ? {} : collectTypeDefs(this.typesFiles, f => readFileSync(f, 'utf-8'))
  }

  // compileEffectsFiles() : les `*.effects.mjs` → les effets de l'appli, transmis à chaque
  // transpilation (un effet réglé s'y résout, un effet CSS part avec le composant qui le pose).
  // Une erreur ici fait échouer le build (un nom en double, un effet réglé qui n'existe pas).
  // --------------------------------------------------------------------------
  // Une faute n'arrête pas la lecture : un nom défini deux fois (la première définition reste), une déclaration illisible (sautée), un effet qui ne
  // se résout pas (absent) — chaque faute est rendue (erreur du build), les alias valides du même fichier et des autres restent connus : les
  // composants qui les posent ne butent pas, en cascade, sur un alias qui n'existerait plus.
  compileEffectsFiles(files: string[], warnings: string[] = []): Error[] {
    this.effectsFiles = [...files].sort()
    const fautes: Error[] = []
    // les alias que ModularJS livre sont là même sans fichier d'effets
    this.effectDefs   = collectEffectDefs(this.effectsFiles, f => readFileSync(f, 'utf-8'), message => this.lintPush(warnings, 'collision', message), fautes)
    return fautes
  }

  // tableAliases() : un alias d'effet (`*titre`, `*filter.frosted_glass`) utilisé au moins ALIAS_TABLE_MIN_USES fois dans l'appli est
  // écrit UNE fois, dans une table du cœur de l'appli (cf. bundleRuntime) ; chaque usage y renvoie par son rang
  // (ProjectEffect.table). En dessous, chaque usage garde ses réglages écrits en clair. Les usages se comptent dans les
  // sources des composants (lecture mémoïsée par fichier), avant toute transpilation.
  // --------------------------------------------------------------------------
  private tableAliases(mjsFiles: string[]): void {
    this.aliasTable = []
    const noms = Object.entries(this.effectDefs).filter(([, d]) => d.base && d.fixed).map(([n]) => n)
    if (noms.length === 0) return
    const comptes: Record<string, number> = Object.create(null)
    for (const f of mjsFiles) {
      const vus = this.scanSource('effect-uses', f, {} as Record<string, number>, countEffectUses)
      for (const n of noms) if (vus[n]) comptes[n] = (comptes[n] ?? 0) + vus[n]
    }
    this.aliasTable = noms.filter(n => comptes[n] >= ALIAS_TABLE_MIN_USES).sort()
    this.aliasTable.forEach((n, i) => { this.effectDefs[n] = { ...this.effectDefs[n], table: i } })
  }

  // aliasSource() : la table des alias d'effets utilisés plusieurs fois, et sa fonction de lecture — `µ._mjs_alias(rang)` rend
  // un objet neuf (jamais celui de la table : un effet peut écrire dans ses réglages), `µ._mjs_alias(rang, { réglage: valeur })`
  // y fusionne les réglages changés à l'usage. Seuls les rangs que les poses compilées renvoient (`used`, cf. fxAliasSignal) sont
  // écrits : un alias dont tous les usages tiennent un réglage par une variable reste en clair partout et n'entre pas dans le
  // cœur (rendu vide quand aucun rang n'est renvoyé) ; un rang que personne ne renvoie, avant le dernier, vaut 0
  private aliasSource(used: ReadonlySet<string>): string {
    const renvoyes = this.aliasTable.map((n, i) => used.has(fxAliasSignal(i)))
    const dernier  = renvoyes.lastIndexOf(true)
    if (dernier < 0) return ''
    const lignes = this.aliasTable.slice(0, dernier + 1).map((n, i) => renvoyes[i] ? JSON.stringify(this.effectDefs[n].fixed) : '0')
    return `// === alias d'effets (table de l'appli) ===\nµ._mjs_alias = (function() {\n  var al = [\n    ${lignes.join(',\n    ')}\n  ];\n  return function(i, c) {\n    var o = {};\n    for (var k in al[i]) o[k] = al[i][k];\n    for (var j in c) o[j] = c[j];\n    return o;\n  };\n})();`
  }

  // resolveEffectsImages() : les chemins d'images que les effets réglés des fichiers `*.effects.mjs` fixent
  // (`*fond = *behind('photo.jpg')`) sont résolus comme ceux d'un gabarit : l'effet réglé porte ensuite l'adresse publiée
  // (ou ce que rend µimage), et les fichiers sont des dépendances du composant qui le pose. Un fichier absent fait
  // échouer le build en nommant l'effet, son fichier et sa ligne.
  // --------------------------------------------------------------------------
  async resolveEffectsImages(): Promise<void> {
    this.effectImageSources = []
    for (const [nom, def] of Object.entries(this.effectDefs)) {
      const trouves = def.base && def.fixed ? fixedImages(def.base, def.fixed) : []
      if (trouves.length === 0) continue
      const fixed: Record<string, any> = { ...def.fixed }
      for (const { key, index, path, plain } of trouves) {
        const absent = () => new Error(t('bundler.index.image-effet-fichier-introuvable', { effet: nom, reglage: key, chemin: path, fichier: basename(def.file), ligne: def.line, dossiers: this.searchedDirs(path) }))
        let valeur: any
        if (plain) {
          valeur = await this.resolveOneAsset(path)
          if (valeur.startsWith('/MISSING_MJS_ASSET')) throw absent()
        }
        else {
          const resolu = await this.resolveOneImage(path)
          if (String(resolu.src).startsWith('/MISSING_MJS_ASSET')) throw absent()
          valeur = index < 0 ? imageValue(JSON.stringify(resolu)) : JSON.stringify(resolu)
        }
        if (index < 0) fixed[key] = valeur
        else fixed[key] = Object.assign([...fixed[key]], { [index]: valeur })
        this.effectImageSources.push(this.assetDep(path))
      }
      this.effectDefs[nom] = { ...def, fixed }
    }
  }

  // checkStoreTypes() : deux composants qui donnent deux règles différentes au même store — une
  // erreur par store, qui cite les deux règles et leurs fichiers. Les textes se comparent tels quels : l'ordre des
  // alternatives d'un choix (`int | string`, `string | int`) change la valeur retenue (la première règle qui sait convertir
  // l'emporte), seuls une liste de valeurs littérales et les champs d'un objet, triés dans le texte, n'ont pas d'ordre
  // --------------------------------------------------------------------------
  private checkStoreTypes(errors: Error[]): void {
    const vus      = new Map<string, { text: string; file: string }>()
    const signales = new Set<string>()
    const rel      = (f: string) => relative(this.sourceDir, f) || f
    for (const e of [...this.pendingStoreTypes].sort((a, b) => a.file < b.file ? -1 : a.file > b.file ? 1 : 0)) {
      const prev = vus.get(e.store)
      if (!prev) { vus.set(e.store, e); continue }
      if (prev.text === e.text || signales.has(e.store)) continue
      signales.add(e.store)
      errors.push(new Error(t('bundler.types-store-conflit', { store: e.store, regle1: prev.text, fichier1: rel(prev.file), regle2: e.text, fichier2: rel(e.file) })))
    }
  }

  // resolveCssAssets() : remplace chaque `µasset('x')` d'une feuille partagée (stylesheetsDir) par l'adresse du fichier, avant la
  // compilation SASS — sourceDir d'abord, puis les dossiers de assetDirs, empreinte et copie comme partout. Le texte est du CSS, pas du
  // JavaScript : aucune lecture lexicale (un `#` ou une apostrophe ne cache pas l'appel), seule la forme de l'appel compte. Un fichier
  // introuvable arrête la construction, en nommant les dossiers fouillés ; une feuille sans appel sort telle qu'elle est entrée.
  private async resolveCssAssets(css: string): Promise<string> {
    const matches = [...css.matchAll(ASSET_RE)]
    if (matches.length === 0) return css
    const webPaths = new Map<string, string>()
    await Promise.all([...new Set(matches.map(m => m[4]))].map(async (logicalPath) => { webPaths.set(logicalPath, await this.resolveOneAsset(logicalPath)) }))
    let out    = ''
    let cursor = 0
    for (const m of matches) {
      const [outerQuote, bs, innerQuote, logicalPath] = [m[1], m[2], m[3], m[4]]
      const webPath = webPaths.get(logicalPath)!
      if (webPath.startsWith('/MISSING_MJS_ASSET:')) throw new Error(t('bundler.index.asset-introuvable', { chemin: logicalPath, dossiers: this.searchedDirs(logicalPath) }))
      out    += css.slice(cursor, m.index) + (outerQuote ? `${outerQuote}${webPath}${outerQuote}` : `${bs}${innerQuote}${webPath}${bs}${innerQuote}`)
      cursor  = m.index! + m[0].length
    }
    return out + css.slice(cursor)
  }

  // bundleSharedStyles() : compile les .sass/.scss/.css de stylesheetsDir et
  // les expose via `µ.CSS[name] = sheet`. Le runtime les consomme à la demande
  // via `_mjs_sharedCss`. Un fichier `mjs_root.{sass,scss}` est traité à part
  // et adopté globalement (comme en V1).
  // Retourne le nombre de stylesheets émis (0 si aucun) + les warnings
  // `cssTrapWarnings` accumulés sur les feuilles NOMMÉES.
  // --------------------------------------------------------------------------
  async bundleSharedStyles(): Promise<{ count: number; warnings: string[] }> {
    // CSS de ce tour-ci par feuille (hors mjs_root) / de mjs_root, pour
    // le diff "css-only" (trackSharedCssDiff, appelé à CHAQUE sortie de fonction
    // ci-dessous, y compris les replis précoces — un stylesheetsDir qui disparaît
    // ou se vide doit aussi pouvoir disqualifier un lot en cours).
    const newSharedCss = new Map<string, string>()
    let newRootCss: string | undefined
    if (!existsSync(this.stylesheetsDir)) {
      this.manifest['__styles'] = ''
      this.trackSharedCssDiff(newSharedCss, newRootCss)
      return { count: 0, warnings: [] }
    }

    // `readdirSync` NE GARANTIT AUCUN
    // ORDRE (dépend du filesystem/OS, peut différer entre deux machines ou
    // deux builds du même repo). Sans tri : (1) l'ORDRE DE CASCADE CSS entre
    // stylesheets partagés dépend de cet ordre arbitraire — deux règles
    // conflictuelles de même spécificité dans 2 fichiers différents peuvent
    // "gagner" différemment selon la machine, pour un SOURCE IDENTIQUE ;
    // (2) le hash de `mjs_styles-<hash>.js` (dérivé du JS concaténé DANS cet
    // ordre) devient non déterministe d'un build à l'autre — casse les
    // builds reproductibles. Même correctif déjà en place pour les
    // animations (`compileUsedAnimations`, tri explicite du Set avant
    // concaténation, cf. son propre commentaire) — mimé ici.
    const files = readdirSync(this.stylesheetsDir)
      .filter(f => /\.(sass|scss|css)$/.test(f))
      .sort()

    if (files.length === 0) {
      this.manifest['__styles'] = ''
      this.trackSharedCssDiff(newSharedCss, newRootCss)
      return { count: 0, warnings: [] }
    }

    let js = `import { µ } from '${this.coreHashedPath}';\n`
    let rootCount = 0
    let sharedCount = 0
    // `compileCss` throw désormais
    // sur une erreur SASS/SCSS (cf. son propre commentaire) au lieu de
    // l'avaler. Isolé PAR FICHIER ici : un stylesheet partagé cassé ne doit
    // pas empêcher la compilation des AUTRES (contrairement au cas
    // composant, où laisser l'erreur du worker remonter telle quelle est le
    // comportement voulu) — les erreurs sont collectées et jetées ENSEMBLE
    // à la fin, remontées par le try/catch déjà en place chez le caller de
    // bundleSharedStyles() dans stats.errors.
    const cssErrors: string[] = []
    // une feuille NOMMÉE (`@css name`) atterrit, une fois
    // consommée, dans le SHADOW ROOT du composant consommateur (`_mjs_sharedCss`,
    // runtime/mjs_element.ts) : même piège @font-face/@import qu'un <style> de
    // composant (cf. cssTrapWarnings). `mjs_root.{sass,scss}` échappe au piège
    // (adopté en `document.adoptedStyleSheets`, HORS Shadow DOM) — volontairement
    // exclu du scan (branche `if baseName === 'mjs_root'` ci-dessous).
    const cssWarnings: string[] = []

    for (const file of files) {
      const path = join(this.stylesheetsDir, file)
      const baseName = file.replace(/\.(sass|scss|css)$/, '')
      const ext = file.match(/\.(sass|scss|css)$/)![1] as 'sass' | 'scss' | 'css'
      // Même garde que macros.ts/transpiler/index.ts :
      // ce chemin (feuille PARTAGÉE, mjs_root compris) ne passait JAMAIS par le
      // strip \x00 posé pour <@include> — un NUL réel + un mot-clé sentinel dans
      // CE fichier faisait passer STYLE_BLOCK_RE (transpiler/css.ts) pour un
      // découpage multi-lang légitime et INJECTAIT le texte encadré tel quel
      // dans le CSS livré (confirmé en conditions réelles). Un NUL n'est jamais un
      // caractère utile en CSS/SASS (même raisonnement, aucune perte).
      // Confinement RÉEL (cf. assertRealUnder) : un symlink DANS stylesheetsDir
      // pointant HORS de lui était lu tel quel, son contenu publié dans mjs_styles-<hash>.js.
      this.assertRealUnder(path, this.stylesheetsDir)
      const src = readFileSync(path, 'utf-8').replace(/\x00/g, '')
      let css: string
      try {
        css = await this.compileSharedSheet(path, src, ext)
      } catch (e: any) {
        cssErrors.push(`${file} : ${e?.message ?? e}`)
        continue
      }
      if (css.trim() === '') continue

      // mjs_root.{sass,scss} → adopté globalement
      if (baseName === 'mjs_root') {
        js += `{\n` +
              `  const _root = new CSSStyleSheet();\n` +
              `  _root.replaceSync(${JSON.stringify(css)});\n` +
              `  document.adoptedStyleSheets = [...document.adoptedStyleSheets, _root];\n` +
              // handle sinon perdu (scope de bloc) : nécessaire à
              // µ._hotCss (dev) pour un replaceSync ultérieur en place.
              `  µ._mjs_rootStyleSheet = _root;\n` +
              `}\n`
        rootCount++
        newRootCss = css
      } else {
        for (const w of cssTrapWarnings(css, this.lint)) cssWarnings.push(`[bundler] ${file} : ${w}`)
        const safeVar = baseName.replace(/[^a-zA-Z0-9]/g, '_')
        // FAILLE — la CLÉ était injectée
        // brute entre apostrophes (`µ.CSS['${baseName}']`) : un nom de fichier
        // stylesheet contenant une `'` (ou `\`) sortait de la chaîne et injectait
        // du JS arbitraire dans mjs_styles.js. `JSON.stringify` échappe la clé
        // (la VALEUR css l'était déjà). safeVar reste sûr (déjà assaini ci-dessus).
        const keyLit = JSON.stringify(baseName)
        js += `µ.CSS = µ.CSS || {};\n` +
              `if (!µ.CSS[${keyLit}]) {\n` +
              `  const s_${safeVar} = new CSSStyleSheet();\n` +
              `  s_${safeVar}.replaceSync(${JSON.stringify(css)});\n` +
              `  µ.CSS[${keyLit}] = s_${safeVar};\n` +
              `}\n`
        sharedCount++
        newSharedCss.set(baseName, css)
      }
    }

    if (rootCount + sharedCount === 0) {
      this.manifest['__styles'] = ''
      this.trackSharedCssDiff(newSharedCss, newRootCss)
      // Si TOUS les fichiers ont échoué (aucun succès), pas de quoi écrire —
      // mais surtout ne PAS avaler l'erreur silencieusement.
      if (cssErrors.length > 0) {
        throw new Error(t('bundler.index.css-sass-erreurs', { erreurs: cssErrors.join('\n') }))
      }
      return { count: 0, warnings: cssWarnings }
    }

    const minified = await minifyJs(js, {
      force: this.shouldMinify(),
      filename: 'mjs_styles.js',
      mangleCache: this.mangleCache,
      logLevel: this.prodLogLevel(),
      dev: !this.isProd(),
    })
    // mode 'bundle' : jamais un fichier `mjs_styles-<hash>.js` — gardé en mémoire, résolu par
    // le plugin esbuild d'emitSingleFile() sous 'mjs:styles' (cf. bandeau de bundleRuntime()
    // pour la même logique côté cœur).
    let hashedPath: string
    if (this.jsMode === 'bundle') {
      this.bundleVirtualSources.set('mjs_styles', this.withInlineSourceMap(minified.code, minified.map))
      hashedPath = 'mjs:styles'
    } else {
      hashedPath = this.writeHashed('mjs_styles', '.js', minified.code)
    }
    this.manifest['__styles'] = hashedPath
    // diff sémantique feuille par feuille (avant le throw éventuel
    // ci-dessous : la baseline doit refléter ce qui vient d'être écrit, même
    // si un AUTRE fichier de stylesheetsDir a échoué — les erreurs, elles,
    // disqualifient déjà le verdict via stats.errors).
    this.trackSharedCssDiff(newSharedCss, newRootCss)
    // Écrit d'abord le sous-ensemble RÉUSSI (comme pour les composants .mjs,
    // un fichier cassé ne doit pas priver les autres de leur sortie), PUIS
    // signale l'échec — remonté par le try/catch déjà en place chez le
    // caller dans stats.errors (le build ENTIER n'est pas vert pour autant).
    if (cssErrors.length > 0) {
      throw new Error(t('bundler.index.css-sass-erreurs', { erreurs: cssErrors.join('\n') }))
    }
    return { count: rootCount + sharedCount, warnings: cssWarnings }
  }

  // compileSharedSheet() : une feuille partagée compilée (SASS) — reprise du tour précédent quand son texte, adresses µasset
  // résolues comprises, n'a pas bougé : chaque sauvegarde d'un composant recompilait sinon toutes les feuilles. Pur : sass n'y
  // résout aucun fichier voisin (compileString sans chemin de chargement), la sortie ne dépend que du texte et de la syntaxe
  private sharedSheetMemo: Map<string, { ext: string, src: string, css: string }> = new Map()

  private async compileSharedSheet(path: string, src: string, ext: 'sass' | 'scss' | 'css'): Promise<string> {
    const resolved = await this.resolveCssAssets(src)
    const memo     = this.sharedSheetMemo.get(path)
    if (memo !== undefined && memo.ext === ext && memo.src === resolved) return memo.css
    const css = compileCss(resolved, ext)
    this.sharedSheetMemo.set(path, { ext, src: resolved, css })
    return css
  }

  // --------------------------------------------------------------------------
  // trackSharedCssDiff : diff sémantique des feuilles partagées entre
  // le compile PRÉCÉDENT et celui-ci. Une feuille présente des deux côtés avec un
  // CSS différent est éligible au hot-swap (`µ.CSS[name].replaceSync` côté client) ;
  // une feuille qui APPARAÎT ou DISPARAÎT disqualifie le lot (µ.CSS[name] naît au
  // chargement de mjs_styles.js, un composant doit être recompilé pour la
  // référencer — repli reload complet, au moindre doute). Idem pour mjs_root.
  // Hors watch : simple mise à jour de baseline, aucun verdict.
  // --------------------------------------------------------------------------
  private trackSharedCssDiff(newSharedCss: Map<string, string>, newRootCss: string | undefined): void {
    if (this.cssOnlyTracking) {
      for (const [name, css] of newSharedCss) {
        const prev = this.lastSharedCss.get(name)
        if (prev === undefined) this.cssOnlyDisqualified = true
        else if (prev !== css) this.cssOnlySheets[name] = css
      }
      for (const name of this.lastSharedCss.keys()) {
        if (!newSharedCss.has(name)) this.cssOnlyDisqualified = true
      }
      if (newRootCss !== undefined && this.lastRootCss !== undefined) {
        if (newRootCss !== this.lastRootCss) this.cssOnlyRoot = newRootCss
      } else if (newRootCss !== this.lastRootCss) {
        this.cssOnlyDisqualified = true  // mjs_root apparu/disparu
      }
      // mjs_styles.js est RÉÉMIS dès qu'une feuille change : émission attendue
      // d'un lot css-only, exemptée du diff central de writeHashed (cf. compile()).
      this.cssOnlyAllowedWrites.add('mjs_styles.js')
    }
    this.lastSharedCss = newSharedCss
    this.lastRootCss = newRootCss
  }

  // --------------------------------------------------------------------------
  // emitSplitStyles() : mode css='split', étape « 1.5 » de compile()
  // (AVANT les composants, même précédent que mjs_core/coreHashedPath). Compile
  // CHAQUE feuille de stylesheetsDir dans SON PROPRE fichier `mjs_style_<nom>-<hash>.js`
  // (au lieu du `mjs_styles-<hash>.js` unique de bundleSharedStyles) — c'est ce qui
  // permet à un module de n'importer QUE les feuilles qu'il déclare (`@css`), plutôt
  // que de faire voyager tout stylesheetsDir avec chaque page.
  //
  // Duplique VOLONTAIREMENT la boucle de compilation par fichier de bundleSharedStyles()
  // (même lecture, même compileCss, même cssTrapWarnings, même gabarit `µ.CSS[nom] = …`)
  // plutôt que de factoriser : bundleSharedStyles() reste la seule responsable du mode
  // 'bundle' (défaut), et doit rester une sortie BYTE-IDENTIQUE à ce qu'elle a toujours
  // produit — un refactor partagé ferait courir un risque de régression sur ce contrat.
  //
  // Ne fait AUCUNE hypothèse sur `requestedSharedSheets` (rempli PAR les composants,
  // compilés APRÈS cette étape) : compile toutes les feuilles PRÉSENTES sur disque, sans
  // savoir encore lesquelles seront déclarées — c'est finalizeSplitStyles() (étape 2c,
  // après les composants) qui décide lesquelles restent eager.
  // --------------------------------------------------------------------------
  async emitSplitStyles(): Promise<{ warnings: string[] }> {
    this.splitStyleHashedPaths = {}
    this.splitRootHashedPath = undefined
    this.lastSharedCss = new Map()
    this.lastRootCss = undefined
    if (!existsSync(this.stylesheetsDir)) return { warnings: [] }
    const files = readdirSync(this.stylesheetsDir)
      .filter(f => /\.(sass|scss|css)$/.test(f))
      .sort()
    if (files.length === 0) return { warnings: [] }
    const cssErrors: string[] = []
    const cssWarnings: string[] = []
    // CSS de chaque feuille : le registre des variables (computeVarRegistry) les lit, comme en mode 'bundle'
    const newSharedCss = new Map<string, string>()
    let newRootCss: string | undefined
    for (const file of files) {
      const path = join(this.stylesheetsDir, file)
      const baseName = file.replace(/\.(sass|scss|css)$/, '')
      const ext = file.match(/\.(sass|scss|css)$/)![1] as 'sass' | 'scss' | 'css'
      // même garde \x00 que bundleSharedStyles() — cf. son commentaire.
      // Même confinement RÉEL que bundleSharedStyles() (cf. assertRealUnder).
      this.assertRealUnder(path, this.stylesheetsDir)
      const src = readFileSync(path, 'utf-8').replace(/\x00/g, '')
      let css: string
      try {
        css = await this.compileSharedSheet(path, src, ext)
      } catch (e: any) {
        cssErrors.push(`${file} : ${e?.message ?? e}`)
        continue
      }
      if (css.trim() === '') continue
      if (baseName === 'mjs_root') {
        // mjs_root : toujours eager (adopté sur le document, aucun composant ne le
        // déclare) — son propre fichier, importé par le manifeste dans TOUS les modes
        // qui splittent (jamais en mode 'bundle', où il reste dans mjs_styles.js).
        const js = `import { µ } from '${this.coreHashedPath}';\n` +
                   `{\n` +
                   `  const _root = new CSSStyleSheet();\n` +
                   `  _root.replaceSync(${JSON.stringify(css)});\n` +
                   `  document.adoptedStyleSheets = [...document.adoptedStyleSheets, _root];\n` +
                   `  µ._mjs_rootStyleSheet = _root;\n` +
                   `}\n`
        const minified = await minifyJs(js, { force: this.shouldMinify(), filename: 'mjs_style_root.js', mangleCache: this.mangleCache, logLevel: this.prodLogLevel(), dev: !this.isProd() })
        this.splitRootHashedPath = this.writeHashed('mjs_style_root', '.js', minified.code)
        newRootCss = css
      } else {
        for (const w of cssTrapWarnings(css, this.lint)) cssWarnings.push(`[bundler] ${file} : ${w}`)
        // safeVar sert AUSSI de base de nom de fichier ici (contrairement à
        // bundleSharedStyles, où il ne sert qu'à l'identifiant JS local) : un nom de
        // feuille avec espace/accent produirait sinon un chemin fragile.
        // MÊME DÉSAMBIGUÏSATION QU'EN 'lazy' : `dark-theme` et `dark_theme` se
        // normalisent tous deux en `mjs_style_dark_theme`. Ici le CONTENU diffère bien (le
        // module embarque `µ.CSS['<nom>']`), donc les hachages diffèrent — mais `writeHashed`
        // passe par `cleanupOldHashes`, qui balaie le STEM : écrire la seconde SUPPRIMAIT le
        // fichier de la première, le composant importait une URL morte (404 → tout le graphe
        // de modules de la page tombe), et le build annonçait 0 erreur, 0 avertissement.
        // Dès que la normalisation a changé le nom, on suffixe une empreinte du nom D'ORIGINE :
        // deux noms distincts ne peuvent plus jamais partager un stem.
        const safeVar = baseName.replace(/[^a-zA-Z0-9]/g, '_')
        const stem    = this.splitStyleStem(baseName)
        const keyLit = JSON.stringify(baseName)
        const js = `import { µ } from '${this.coreHashedPath}';\n` +
                   `µ.CSS = µ.CSS || {};\n` +
                   `if (!µ.CSS[${keyLit}]) {\n` +
                   `  const s_${safeVar} = new CSSStyleSheet();\n` +
                   `  s_${safeVar}.replaceSync(${JSON.stringify(css)});\n` +
                   `  µ.CSS[${keyLit}] = s_${safeVar};\n` +
                   `}\n`
        const minified = await minifyJs(js, { force: this.shouldMinify(), filename: `mjs_style_${baseName}.js`, mangleCache: this.mangleCache, logLevel: this.prodLogLevel(), dev: !this.isProd() })
        this.splitStyleHashedPaths[baseName] = this.writeHashed(stem, '.js', minified.code)
        newSharedCss.set(baseName, css)
      }
    }
    // baseline seulement : en 'split' et 'lazy', le suivi « css seul » de trackSharedCssDiff ne s'applique pas
    this.lastSharedCss = newSharedCss
    this.lastRootCss = newRootCss
    if (cssErrors.length > 0) {
      throw new Error(t('bundler.index.css-sass-erreurs', { erreurs: cssErrors.join('\n') }))
    }
    return { warnings: cssWarnings }
  }

  // --------------------------------------------------------------------------
  // finalizeSplitStyles() : mode css='split', étape « 2c » (même
  // position que bundleSharedStyles() en mode 'bundle') — APRÈS les composants, donc
  // `requestedSharedSheets` (feuilles déclarées par au moins un `@css`) ET
  // `viewRequestedSheets` (feuilles réclamées par au moins un `<@view css="…">` littéral,
  // cf. extractViewCssNames) sont désormais complets. DEUX FILETS DE SÉCURITÉ distincts,
  // chacun forçant eager pour une raison différente :
  //   1. une feuille compilée par emitSplitStyles() qu'AUCUN module ne déclare resterait
  //      invisible de tout le monde si elle n'était importée par personne.
  //   2. une feuille DÉCLARÉE par un module (donc PAS orpheline) mais réclamée AUSSI par
  //      un `<@view css="…">` d'un AUTRE module — la page qui charge cette vue peut très
  //      bien ne jamais charger le module déclarant, et hériterait alors d'un `µ.CSS[nom]`
  //      vide (cf. runtime/mjs_element.ts, `_mjs_applyLayout`, avertissement « Orphelin CSS
  //      hérité »). Rien ne relie ces deux modules au build : seul le fait de forcer la
  //      feuille eager referme ce trou.
  // Les deux restent importées par le MANIFESTE, exactement comme en mode 'bundle'. Deux
  // avertissements DISTINCTS (un par raison) : l'auteur doit comprendre pourquoi son gain
  // n'est pas total, et pourquoi ajouter `@css` ne suffit pas toujours (raison 2).
  // --------------------------------------------------------------------------
  finalizeSplitStyles(): { count: number; warnings: string[] } {
    const known = Object.keys(this.splitStyleHashedPaths).sort()
    // raison 1 — personne ne la déclare (@css) : le filet historique.
    const undeclared = known.filter(name => !this.requestedSharedSheets.has(name))
    // raison 2 — déclarée par un module, mais un <@view css="…">
    // la réclame AUSSI (disjoint de `undeclared` par construction : un nom ne peut pas
    // être à la fois « personne ne le déclare » et « un module le déclare »).
    const viewOnly = known.filter(name => this.requestedSharedSheets.has(name) && this.viewRequestedSheets.has(name))
    this.splitEagerHashedPaths = [...undeclared, ...viewOnly].sort().map(name => this.splitStyleHashedPaths[name])
    const warnings: string[] = []
    if (undeclared.length > 0) {
      this.lintPush(warnings, 'cssSplit', t('bundler.index.css-split-feuilles-eager', { feuilles: undeclared.join(', ') }))
    }
    if (viewOnly.length > 0) {
      this.lintPush(warnings, 'cssSplit', t('bundler.index.css-split-feuilles-eager-view', { feuilles: viewOnly.join(', ') }))
    }
    const count = known.length + (this.splitRootHashedPath ? 1 : 0)
    return { count, warnings }
  }

  // --------------------------------------------------------------------------
  // emitLazyStyles() : mode css='lazy', étape « 1.5 » de compile(),
  // à la même place que emitSplitStyles(). Différence de fond avec 'split' : la
  // feuille n'est PAS emballée dans un module JS importé statiquement par le
  // composant — elle devient un VRAI fichier `.css` haché, que le runtime va
  // chercher au montage du PREMIER composant qui la déclare (`@css`), et garde en
  // cache PAR URL : dix composants qui déclarent la même feuille = UNE requête.
  //
  // Conséquence sur la compilation des composants : rien à injecter en tête de
  // leur JS (contrairement à prependSplitCssImports), donc AUCUN sel de cache à
  // ajouter — le composant ne connaît que le NOM de la feuille, la table des URLs
  // vit au manifeste (`µ._cssLazy`, cf. writeManifest).
  //
  // `mjs_root` reste EAGER, comme en 'split' : personne ne le déclare, il est
  // adopté sur le document, et il porte typiquement les variables de thème — le
  // charger en différé ferait clignoter TOUTE la page, pas un composant.
  // --------------------------------------------------------------------------
  async emitLazyStyles(): Promise<{ warnings: string[] }> {
    this.lazyStyleUrls = {}
    this.splitRootHashedPath = undefined
    this.lastSharedCss = new Map()
    this.lastRootCss = undefined
    if (!existsSync(this.stylesheetsDir)) return { warnings: [] }
    const files = readdirSync(this.stylesheetsDir).filter(f => /\.(sass|scss|css)$/.test(f)).sort()
    if (files.length === 0) return { warnings: [] }
    const cssErrors: string[]   = []
    const cssWarnings: string[] = []
    // CSS de chaque feuille : le registre des variables (computeVarRegistry) les lit, comme en mode 'bundle'
    const newSharedCss = new Map<string, string>()
    let newRootCss: string | undefined
    for (const file of files) {
      const path     = join(this.stylesheetsDir, file)
      const baseName = file.replace(/\.(sass|scss|css)$/, '')
      const ext      = file.match(/\.(sass|scss|css)$/)![1] as 'sass' | 'scss' | 'css'
      // même garde \x00 que bundleSharedStyles()/emitSplitStyles()
      // Même confinement RÉEL que bundleSharedStyles() (cf. assertRealUnder).
      this.assertRealUnder(path, this.stylesheetsDir)
      const src = readFileSync(path, 'utf-8').replace(/\x00/g, '')
      let css: string
      try {
        css = await this.compileSharedSheet(path, src, ext)
      } catch (e: any) {
        cssErrors.push(`${file} : ${e?.message ?? e}`)
        continue
      }
      if (css.trim() === '') continue
      if (baseName === 'mjs_root') {
        const js = `import { µ } from '${this.coreHashedPath}';\n` +
                   `{\n` +
                   `  const _root = new CSSStyleSheet();\n` +
                   `  _root.replaceSync(${JSON.stringify(css)});\n` +
                   `  document.adoptedStyleSheets = [...document.adoptedStyleSheets, _root];\n` +
                   `  µ._mjs_rootStyleSheet = _root;\n` +
                   `}\n`
        const minified = await minifyJs(js, { force: this.shouldMinify(), filename: 'mjs_style_root.js', mangleCache: this.mangleCache, logLevel: this.prodLogLevel(), dev: !this.isProd() })
        this.splitRootHashedPath = this.writeHashed('mjs_style_root', '.js', minified.code)
        newRootCss = css
      } else {
        for (const w of cssTrapWarnings(css, this.lint)) cssWarnings.push(`[bundler] ${file} : ${w}`)
        // même normalisation de nom qu'en 'split' : un nom de feuille avec espace ou
        // accent produirait un chemin fragile. MAIS ici le fichier écrit est le CSS NU,
        // sans le nom dedans (en 'split' le module JS embarque `µ.CSS['<nom>']`, ce qui
        // écarte les hachages tout seul) : `dark-theme.sass` et `dark_theme.sass` au
        // contenu identique se réduisaient au MÊME fichier, donc à la même URL pour deux
        // noms — et le second nom n'obtenait jamais sa feuille, en silence (défaut mesuré).
        // Dès que la normalisation a changé le nom,
        // on désambiguïse par une empreinte du nom D'ORIGINE : deux noms distincts ne
        // peuvent plus jamais tomber sur le même chemin
        const stem = this.splitStyleStem(baseName)
        this.lazyStyleUrls[baseName] = this.writeHashed(stem, '.css', css)
        newSharedCss.set(baseName, css)
      }
    }
    // baseline seulement, comme en 'split'
    this.lastSharedCss = newSharedCss
    this.lastRootCss = newRootCss
    if (cssErrors.length > 0) {
      throw new Error(t('bundler.index.css-sass-erreurs', { erreurs: cssErrors.join('\n') }))
    }
    return { warnings: cssWarnings }
  }

  // --------------------------------------------------------------------------
  // finalizeLazyStyles() : étape « 2c », APRÈS les composants (donc
  // `requestedSharedSheets` est complet). Contrairement à 'split', il n'y a AUCUN
  // filet à poser :
  //   1. une feuille que personne ne déclare n'est tout simplement JAMAIS chargée
  //      (décision explicite : c'est le sens même du mode). Le fichier est écrit et
  //      son URL reste au manifeste — un `<@view css="…">` peut la réclamer à
  //      l'exécution — mais aucune requête ne part tant que personne ne la demande.
  //      Une information de build la nomme, pour que ce ne soit pas une surprise.
  //   2. le trou « orphelin CSS hérité » de 'split' (une feuille déclarée par un
  //      module A et réclamée par un `<@view css>` d'un module B jamais chargé) se
  //      referme tout seul ici : le runtime résout par NOM dans `µ._cssLazy`, il n'a
  //      besoin d'aucun module déclarant pour trouver l'URL.
  // --------------------------------------------------------------------------
  finalizeLazyStyles(): { count: number; warnings: string[] } {
    const known      = Object.keys(this.lazyStyleUrls).sort()
    const undeclared = known.filter(name => !this.requestedSharedSheets.has(name) && !this.viewRequestedSheets.has(name))
    const warnings: string[] = []
    if (undeclared.length > 0) {
      this.lintPush(warnings, 'cssSplit', t('bundler.index.css-lazy-feuilles-jamais-reclamees', { feuilles: undeclared.join(', ') }))
    }
    const count = known.length + (this.splitRootHashedPath ? 1 : 0)
    return { count, warnings }
  }

  // --------------------------------------------------------------------------
  // prependSplitCssImports() : mode css='split' — ajoute en tête du JS
  // d'un composant les `import '<chemin>';` des feuilles qu'il déclare (`@css`,
  // cf. sharedCssNames). `emitSplitStyles()` tourne désormais en PHASE C (après les
  // composants, le cœur connu) : `this.splitStyleHashedPaths` est encore VIDE ici (phase A).
  // Chaque nom demandé reçoit donc le REPÈRE de son propre stem (`splitStyleStem`, résolu en
  // chemin réel par l'émission topologique de la phase C) — jamais filtré sur une existence
  // qu'on ne peut pas encore connaître : une feuille demandée mais absente/en échec reste un
  // dep jamais résolu, détecté par le garde-fou de compile() (§ 3.13), même sort qu'avant
  // (validateSharedSheets()/erreurs SASS déjà couvertes par ailleurs). Tri alphabétique :
  // ordre déterministe, sans effet sur la cascade (l'ordre qui compte pour le navigateur est
  // celui de `_mjs_sharedCss`, posé par le transpiler — inchangé par cette méthode).
  // --------------------------------------------------------------------------
  private prependSplitCssImports(code: string, sharedCssNames: string[]): string {
    if (sharedCssNames.length === 0) return code
    const imports = [...sharedCssNames].sort()
      .map(name => `import '${this.placeholderPath(this.splitStyleStem(name), '.js')}';`)
      .join('\n')
    return imports === '' ? code : `${imports}\n${code}`
  }

  // --------------------------------------------------------------------------
  // Effets à la demande — en construction découpée (`js: 'split'`), le code de chaque effet écrit
  // dans le projet part dans son propre fichier (`mjs_fx_<nom>-<empreinte>.js`), importé par les
  // composants qui le posent : il arrive avec eux (préchargé avec les composants de la page, ou avec
  // un composant chargé plus tard), jamais dans le cœur de toutes les pages. Le moteur (mjs_fx.ts)
  // reste au cœur ; un effet nommé pendant l'exécution (`fx: $effet`) est importé par lui, à la
  // demande (µ.paths). Fichier unique : rien à découper, tout reste au cœur.
  // --------------------------------------------------------------------------
  // un effet dont le code part dans son propre fichier (cf. FX_CHUNK_KEYS) — sauf demandé au cœur
  // (`runtime: ['fx_neon']`) ; *flash reste au cœur de développement, où le panneau s'en sert
  private fxChunked(key: string): boolean {
    if (this.jsMode !== 'split' || !FX_CHUNK_KEYS.has(key)) return false
    if (key === 'fx_flash' && !this.isProd()) return false
    // l'indicateur de chargement demandé par la configuration sert tous les modules traduits : il reste au cœur, prêt avant le premier module
    if (key === 'fx_loader' && this.i18nAttente()?.mode === '*loader') return false
    return !(Array.isArray(this.runtime) && this.runtime.includes(key))
  }

  // le texte d'un fichier runtime tel qu'il part dans le build : en production, les sections marquées de l'effet que les pages de l'appli
  // ne demandent pas en sont ôtées (cf. fx-sections.ts ; tout est gardé quand le projet demande l'effet au cœur, `runtime: ['fx_nom']`) ;
  // un fichier sans marque passe tel quel. En développement le fichier part en entier (les marques seules sont ôtées) : le panneau
  // d'inspection allume n'importe quel réglage d'un effet posé, écrit ou non par les pages — le tri n'est que pour le poids de la production
  private effectSource(file: string, src: string, used: ReadonlySet<string>): string {
    const text = this.sortedEffect(file, src, used)
    return file === HOLOGRAM_FILE ? this.deliverHologramImages(text) : text
  }

  // le fichier d'un effet réduit (ou non) aux sections que les pages demandent, sans rien écrire ni publier : le texte dont on lit aussi les outils appelés
  private sortedEffect(file: string, src: string, used: ReadonlySet<string>): string {
    const forced = !this.isProd() || (Array.isArray(this.runtime) && this.runtime.includes(file.replace(/^mjs_|\.ts$/g, '')))
    return selectFxSections(file, src, used, forced, FX_CLIENTS[file])
  }

  // ce fichier d'effet, tel qu'il part dans ce build (cf. sortedEffect), appelle-t-il cette fonction du cœur (`µ.<nom>(`) ? Un fichier illisible : oui (le build
  // s'arrêtera sur ce fichier absent, plus loin)
  private effectCalls(file: string, used: ReadonlySet<string>, name: string): boolean {
    let src: string
    try {
      src = readFileSync(join(this.runtimeDir, file), 'utf-8')
    }
    catch {
      return true
    }
    return this.sortedEffect(file, src, used).includes('µ.' + name + '(')
  }

  // les outils du cœur que le code de ces effets appelle, tel qu'il part dans ce build (cf. sortedEffect) : en production, un outil que seules les sections
  // non demandées appellent n'est pas dans la liste. Un fichier illisible compte pour la liste de la table (le build s'arrêtera sur ce fichier absent, plus loin)
  private fxToolsCalledBy(keys: readonly string[], used: ReadonlySet<string>): Set<string> {
    const out = new Set<string>()
    for (const key of keys) {
      const file = 'mjs_' + key + '.ts'
      let src: string | undefined
      try {
        src = readFileSync(join(this.runtimeDir, file), 'utf-8')
      }
      catch {
        src = undefined
      }
      for (const tool of src === undefined ? fxToolsWanted(k => k === key) : fxToolsCalled(this.sortedEffect(file, src, used))) out.add(tool)
    }
    return out
  }

  // GARDE DES OUTILS DES EFFETS : chaque outil (mjs_fx_tool<nom>.ts) qu'un module d'effet, ou un autre outil, appelle doit être dans le cœur assemblé.
  // Même principe que la garde du contrat du cœur (core-contract.ts) : les outils sont déduits du code des effets (resolveRuntimeFiles) ; on ne
  // surveille pas la déduction, on regarde le RÉSULTAT et on refuse de finir un build dont un appel n'aurait plus son outil (« is not a function » à la
  // première pose de l'effet, build vert). Sans bundleRuntime() avant lui (`fxToolsEmbarked` vide), rien à mesurer
  private assertFxTools(modules: ReadonlyArray<readonly [string, string]>): void {
    if (this.fxToolsEmbarked === null) return
    const absents = fxToolsMissing(modules, this.fxToolsEmbarked)
    if (absents.length > 0) throw new Error(t('bundler.index.outil-effet-absent', { liste: absents.map(a => a.tool + ' (' + a.files.join(', ') + ')').join(', ') }))
  }

  // les images des motifs de *hologram copiées dans la sortie, sous empreinte comme les autres assets, et leur adresse écrite dans le
  // fichier de l'effet. En production : celles que le fichier, réduit aux styles écrits, lit (aucun style de carte, aucune image).
  // En développement : toutes, le fichier de l'effet y étant envoyé en entier, quel que soit le tri qu'on lui applique
  private deliverHologramImages(text: string): string {
    const dispo  = existsSync(this.hologramImagesDir) ? readdirSync(this.hologramImagesDir).filter(f => /\.(?:png|webp|jpg)$/.test(f)).sort() : []
    const motifs = this.isProd() ? hologramMotifsOf(text) : HOLOGRAM_MOTIFS
    const urls: Record<string, string> = {}
    for (const motif of motifs) {
      const file = dispo.find(f => f.slice(0, f.lastIndexOf('.')) === motif)
      if (file === undefined) throw new Error(t('bundler.hologram-motifs.image-introuvable', { motif, dossier: this.hologramImagesDir }))
      urls[motif] = this.publishFrameworkAsset(join(this.hologramImagesDir, file), 'mjs_hologram_' + motif)
    }
    return injectHologramImages(text, urls)
  }

  // un fichier du paquet (et non de l'appli) copié tel quel dans la sortie, sous empreinte : rend son adresse publique
  private publishFrameworkAsset(source: string, baseName: string): string {
    const bytes    = readFileSync(source)
    const ext      = extname(source)
    const filename = this.hashedName(baseName, ext, bytes)
    this.cleanupOldHashes(baseName, ext, [filename])
    this.writeFileAtomic(join(this.outputDir, filename), bytes)
    this.emittedThisCompile.add(filename)
    this.frameworkAssets.set(filename, bytes.length)
    this.notePublished(source, filename)
    return `${this.urlPrefix}/${filename}`
  }

  // les fichiers d'effets d'une unité, d'après ses signaux compilés : `mjs_fx_<nom>`, triés
  private fxChunkKeys(features: Iterable<string>): string[] {
    return [...features].filter(f => this.fxChunked(f)).sort().map(f => 'mjs_' + f)
  }

  /** chemin public d'une clé du manifeste — composant, module, ou fichier d'effet (`mjs_fx_<nom>`) */
  unitPath(name: string): string | undefined {
    return this.groupPaths.get(name) ?? this.manifest[name] ?? this.fxChunkPaths.get(name)
  }

  // compileFxChunks(used) : le fichier de chaque effet écrit (clés `fx_<nom>` de `used`) — il importe
  // le cœur, déjà écrit ; minifié avec le même cache de noms courts que lui, dans un ordre fixe (deux
  // constructions identiques donnent des fichiers identiques)
  private async compileFxChunks(used: ReadonlySet<string>): Promise<number> {
    this.fxChunkPaths = new Map()
    if (this.jsMode !== 'split') return 0
    // un effet choisi par une variable (`*delta(fx: $effet)`) peut nommer tout effet qui se joue une
    // fois, même écrit nulle part : chacun a son fichier, au manifeste, importé seulement s'il est nommé
    const named   = used.has(FX_NAMED) ? FX_NAMEABLE_KEYS : []
    const keys    = [...new Set([...used, ...named])].filter(k => this.fxChunked(k)).sort()
    const missing = keys.filter(k => !existsSync(join(this.runtimeDir, 'mjs_' + k + '.ts')))
    if (missing.length > 0) throw new Error(t('bundler.index.runtime-introuvable', { manquants: missing.length, total: keys.length, dossier: this.runtimeDir, liste: missing.map(k => 'mjs_' + k + '.ts').join(', ') }))
    // réglages qui changent le fichier produit : avec le texte de l'effet et l'état du cache de noms courts, la clé du mémo
    const reglages = JSON.stringify([this.isProd(), this.shouldMinify(), this.shouldEmitSourceMap(), this.prodLogLevel(), this.journalInCore, [...this.fxToolsEmbarked ?? []].sort()])
    const memos    = new Map<string, { src: string, entree: string, reglages: string, noms: string, code: string, map?: string }>()
    for (const k of keys) {
      const src    = this.effectSource('mjs_' + k + '.ts', readFileSync(join(this.runtimeDir, 'mjs_' + k + '.ts'), 'utf-8'), used)
      // le texte remis au minifieur, import du cœur compris : un cœur qui change d'empreinte change la clé, jamais un fichier
      // d'effet repris du tour d'avant qui importerait l'ancien cœur, retiré par le ménage
      const entree = this.autoImportMu(this.isProd() ? stripMsgFallbacks(src) : src)
      const noms   = this.shouldMinify() ? JSON.stringify(this.mangleCache) : ''
      // effet inchangé, mêmes réglages, même cache de noms : contrôle et minification du tour précédent repris tels quels. L'écriture
      // passe toujours par writeHashed (inscription au registre des sorties ; rien d'écrit si le fichier existe)
      let memo = this.fxChunkMemo.get(k)
      if (memo === undefined || memo.src !== src || memo.entree !== entree || memo.reglages !== reglages || memo.noms !== noms) {
        this.assertFxTools([['mjs_' + k + '.ts', src]])
        const minified = await minifyJs(entree, {
          force: this.shouldMinify(),
          filename: 'mjs_' + k + '.js',
          sourceMap: this.shouldEmitSourceMap(),
          mangleCache: this.mangleCache,
          logLevel: this.prodLogLevel(),
          dev: !this.isProd(),
          runtimeSource: this.isProd(),
          journal: this.journalInCore,
        })
        // clé prise sur le cache APRÈS minification : c'est l'état que le tour suivant retrouve quand rien n'a bougé
        memo = { src, entree, reglages, noms: this.shouldMinify() ? JSON.stringify(this.mangleCache) : '', code: minified.code, map: minified.map }
      }
      memos.set(k, memo)
      this.fxChunkPaths.set('mjs_' + k, this.writeHashed('mjs_' + k, '.js', memo.code, memo.map))
    }
    this.fxChunkMemo = memos
    return keys.length
  }

  /** mémo de compileFxChunks : par effet, le texte lu, le texte remis au minifieur (import du cœur compris), les réglages, l'état du cache de noms courts et le fichier produit */
  private fxChunkMemo: Map<string, { src: string, entree: string, reglages: string, noms: string, code: string, map?: string }> = new Map()

  // --------------------------------------------------------------------------
  // compileMessageFiles() : en production, les messages que le framework écrit dans la console du
  // navigateur (groupe `err` de la table, cf. runtime-labels.ts) quittent le manifeste : un fichier
  // JSON par langue, `mjs_err-<langue>-<empreinte>.json`, que le cœur va chercher quand un message doit
  // s'afficher (µ._mjs_txt, mjs_init.ts). Inscrits au registre des sorties (comme tout fichier haché,
  // nettoyés avec les périmés) mais hors de mjs-precache.json : personne ne les télécharge d'avance.
  // Rien en développement, où la table complète reste au manifeste. Quand le cœur n'a plus ses traces (cf. tracesCut),
  // les textes que seules des traces lisent n'y sont plus non plus ; aux niveaux 'error' et 'silent', ceux que seuls des
  // avertissements lisent non plus (les avertissements du runtime partent du code envoyé, cf. WARNING_ONLY_MESSAGES).
  // --------------------------------------------------------------------------
  private compileMessageFiles(): number {
    this.msgFileNames = new Map()
    if (!this.isProd()) return 0
    const cut = this.tracesCut()
    for (const lang of RUNTIME_LANGS) {
      const messages = runtimeMessagesFor(lang)
      const path     = this.writeHashed(`mjs_err-${lang}`, '.json', JSON.stringify(cut ? messagesWithoutTraces(messages, this.prodLogLevel()) : messages))
      this.msgFileNames.set(lang, path.slice(this.urlPrefix.length + 1))
    }
    return this.msgFileNames.size
  }

  // tracesCut() : le cœur de ce build n'a plus ses traces — production, minification, et un niveau de console qui
  // coupe `log` (même critère que minifyJs, cf. cutRuntimeTraces)
  private tracesCut(): boolean {
    return this.isProd() && this.shouldMinify() && levelCutsTraces(this.prodLogLevel())
  }

  // manifestLabels() : la table des libellés du manifeste. En production au niveau 'log', les traces du cœur écrivent :
  // leur texte part ici, dans un groupe `err` réduit à ces textes (ceux que le cœur nomme), pour que la première trace
  // sorte en texte sans attendre le fichier de messages, qui reste complet. Publique, comme labelsLang() : le rendu serveur
  // pose cette table (sans les messages de la console) dans sa fenêtre, qui n'évalue pas le manifeste (server/renderToString.ts)
  manifestLabels(): Record<string, any> {
    const labels = runtimeLabelsFor(this.isProd(), this.labelGroups, this.labelCoreModules, this.labelFxEffects, this.labelCoreDropped) as Record<string, any>
    const keys   = this.traceKeys ?? TRACE_READ_MESSAGES
    if (!this.isProd() || levelCutsTraces(this.prodLogLevel()) || keys.length === 0) return labels
    for (const lang of Object.keys(labels)) labels[lang] = { ...labels[lang], err: traceMessages(runtimeMessagesFor(lang), keys) }
    return labels
  }

  // labelsLang() : la langue de repli des libellés du runtime (`µ._runtimeLabelsLang`) — celle du projet (`i18n.default`),
  // sinon la clé `lang` de mjs.config.json (`getMessagesLang()`, posée par `setMessagesLang`)
  labelsLang(): string {
    return this.i18n?.default ?? getMessagesLang()
  }

  // msgUrlsLine() : la ligne du manifeste qui publie l'adresse de chaque fichier de messages — vide
  // en développement. Fichier JS unique (`js: 'bundle'`) servi à côté des fichiers de sortie : l'adresse
  // se lit depuis celle du fichier lui-même (`import.meta.url`), comme `µ.paths`, donc juste quelle que
  // soit la base de la page (appli servie sous un sous-dossier). Sinon (manifeste éclaté, ou posé
  // ailleurs que dans le dossier de sortie) : le chemin public `<urlPrefix>/<fichier>`, comme celui des
  // fichiers d'effets.
  private msgUrlsLine(): string {
    if (this.msgFileNames.size === 0) return ''
    const sameDir = (a: string, b: string): boolean => { try { return realpathSync(a) === realpathSync(b) } catch { return a === b } }
    const nextToManifest = this.jsMode === 'bundle' && sameDir(dirname(this.manifestPath), this.outputDir)
    const entries = [...this.msgFileNames].map(([lang, file]) => `${JSON.stringify(lang)}: ${nextToManifest ? `new URL(${JSON.stringify(file)}, import.meta.url).href` : JSON.stringify(`${this.urlPrefix.replace(/\/$/, '')}/${file}`)}`)
    return `µ._msgUrls = { ${entries.join(', ')} };${this.messagesMode === 'idle' ? ' µ._msgIdle();' : ''}`
  }

  // --------------------------------------------------------------------------
  // compileUsedAnimations() : compile uniquement les anims utilisées dans
  // `µ.anim = µ.anim || {};\nµ.anim.fade = (...);\n...` puis émet en
  // mjs_anims-<hash>.js. Si aucune anim utilisée → pas de fichier émis.
  //
  // Une anim référencée mais
  // INEXISTANTE (typo : `@transition.fadde` au lieu de `@transition.fade`)
  // était sautée en SILENCE (`continue`) — le composant qui l'utilise génère
  // quand même du code appelant `µ.anim.fadde`, jamais défini → échec
  // SILENCIEUX à l'exécution (`µ.anim.fadde is not a function`), le build ne
  // signalant RIEN. En prime, le compteur `written` du caller (basé sur
  // `usedAnimations.size`, PAS sur le nombre réellement émis) comptait cette
  // anim fantôme comme "écrite". Fix : retourne désormais `{written,
  // missing}` — le caller (étape 11 de compile()) signale chaque nom manquant, par une
  // erreur quand une directive l'écrit, par un warning quand seule une expression le cite, ET
  // n'incrémente `written` que du compte RÉEL.
  // --------------------------------------------------------------------------
  async compileUsedAnimations(): Promise<{ written: number; missing: string[] }> {
    if (this.usedAnimations.size === 0) {
      this.manifest['__animations'] = ''
      return { written: 0, missing: [] }
    }

    const animDir = join(this.runtimeDir, 'animations')
    if (!existsSync(animDir)) return { written: 0, missing: [...this.usedAnimations].sort() }

    // Animations runtime : également plain JS post-Coffee, lecture directe.
    // Tri du Set AVANT concaténation : son ordre d'itération dépend de l'ordre
    // de complétion concurrente des fichiers → sans tri, le hash de
    // `mjs_anims-<hash>.js` était non déterministe d'un build à l'autre.
    const parts: string[] = ['µ.anim = µ.anim || {};']
    const missing: string[] = []
    let emitted = 0
    // une animation peut en appeler une autre (µ.anim.<nom>), ou s'appuyer sur une pièce commune (animations/shared/<nom>.ts : l'enveloppe
    // de fade, fly… ; la lecture d'une longueur) qu'elle appelle par µ._mjs_anim<Nom> : celle-ci part avec elle, une seule fois, même si
    // l'appli ne la nomme pas. Une pièce commune n'est pas une animation : hors de µ.anim, ni `@in=*nom` ni `µanim.create 'nom'` ne l'atteignent
    const wanted = new Set(this.usedAnimations)
    const shared = new Set<string>()
    for (const animName of wanted) {
      const path = join(animDir, `${animName}.ts`)
      if (!existsSync(path)) continue
      const src = readFileSync(path, 'utf-8')
      for (const dep of this.extractAnimationsFromAst(src)) {
        if (existsSync(join(animDir, `${dep}.ts`))) wanted.add(dep)
      }
      for (const m of src.matchAll(/µ\._mjs_anim([A-Z]\w*)/g)) shared.add(m[1])
    }
    for (const piece of [...shared].sort()) {
      const path = join(animDir, 'shared', `${piece[0].toLowerCase()}${piece.slice(1)}.ts`)
      if (!existsSync(path)) continue
      const src = readFileSync(path, 'utf-8')
      parts.push(`µ._mjs_anim${piece} = ${(this.isProd() ? stripMsgFallbacks(src) : src).trim()};`)
      emitted++
    }
    for (const animName of [...wanted].sort()) {
      const path = join(animDir, `${animName}.ts`)
      if (!existsSync(path)) {
        // Anim définie dynamiquement (µanim.create /
        // crossfade, nom en littéral) : pas de fichier runtime à émettre, et
        // ce n'est PAS un « manquant ». Sinon (vrai typo) on signale comme avant.
        if (!this.definedAnimations.has(animName)) missing.push(animName)
        continue
      }
      const src = readFileSync(path, 'utf-8')
      parts.push(`µ.anim.${animName} = ${(this.isProd() ? stripMsgFallbacks(src) : src).trim()};`)
      emitted++
    }
    const concatenated = this.autoImportMu(parts.join('\n'))
    // texte du runtime (animations et pièces communes) : en production, ses avertissements partent comme ceux du cœur (cf. minifyJs, runtimeSource)
    const minified = await minifyJs(concatenated, {
      force: this.shouldMinify(),
      filename: 'mjs_anims.js',
      mangleCache: this.mangleCache,
      logLevel: this.prodLogLevel(),
      dev: !this.isProd(),
      runtimeSource: this.isProd(),
      journal: this.journalInCore,
    })
    // mode 'bundle' : jamais un fichier `mjs_anims-<hash>.js` — mêmes raisons que
    // bundleSharedStyles()/bundleRuntime() ci-dessus, sous 'mjs:anims'.
    let hashedPath: string
    if (this.jsMode === 'bundle') {
      this.bundleVirtualSources.set('mjs_anims', this.withInlineSourceMap(minified.code, minified.map))
      hashedPath = 'mjs:anims'
    } else {
      hashedPath = this.writeHashed('mjs_anims', '.js', minified.code)
    }
    this.manifest['__animations'] = hashedPath
    return { written: emitted, missing }
  }

  // --------------------------------------------------------------------------
  // validateSharedSheets() : jumeau structurel de
  // compileUsedAnimations() ci-dessus (même boucle triée, même vérif
  // existsSync par nom), mais pour les feuilles partagées `@css nom1 nom2…` — et avec un
  // verdict DIFFÉRENT : une anim que seule une expression cite (`µ.anim.nom`) n'est qu'un
  // warning (le script fautif échoue silencieusement à l'exécution, cf. animation-inconnue ;
  // une transition posée par une directive est, elle, une erreur de l'étape 11 de compile()),
  // alors qu'une feuille @css manquante DOIT faire échouer le build (throw), sur
  // décision explicite — avant cette validation, `bundleSharedStyles()`
  // se contentait d'énumérer les fichiers PRÉSENTS dans stylesheetsDir, sans
  // jamais savoir quelles feuilles avaient été DEMANDÉES par les composants : un
  // `@css nom-mal-orthographie` compilait avec succès, le composant demandeur
  // héritant silencieusement d'une feuille vide au runtime (cf. mjs_element.ts,
  // avertissement `Orphelin CSS local` — un simple µ.warn, jamais un échec).
  //
  // Cause racine du trou (cf. worker.ts + TranspileDataLike.sharedCssNames) :
  // `sharedCssNames` est calculé par composant DANS LE WORKER mais n'était
  // jusqu'ici JAMAIS renvoyé au process maître (projection postMessage) — sans
  // ce champ, `this.requestedSharedSheets` (alimenté en 3 points miroirs de
  // usedAnimations : cache-hit, fresh-compile, cache.set — cf. _compileMjsInner)
  // restait toujours vide, rendant cette validation structurellement impossible.
  // --------------------------------------------------------------------------
  validateSharedSheets(): void {
    if (this.requestedSharedSheets.size === 0) return
    const missing: string[] = []
    for (const sheetName of [...this.requestedSharedSheets].sort()) {
      const base = join(this.stylesheetsDir, sheetName)
      const found = existsSync(`${base}.sass`) || existsSync(`${base}.scss`) || existsSync(`${base}.css`)
      if (!found) missing.push(sheetName)
    }
    if (missing.length > 0) {
      throw new Error(t('bundler.index.feuille-partagee-manquante', { themes: missing.join(', '), dossier: this.stylesheetsDir }))
    }
  }

  // --------------------------------------------------------------------------
  // computeVarRegistry(warnings) : union des variables de thème $$ DÉCLARÉES
  // (blocs <theme> de chaque composant + leur CSS brut, fichiers *.theme.mjs, custom
  // properties du framework lui-même, CSS brut des feuilles partagées) contre les
  // variables LUES. Une variable lue que personne ne déclare ne casse RIEN à la compilation —
  // juste une valeur VIDE à l'écran, le pire des symptômes, muet : avertissement. Un
  // variable déclarée par au moins deux composants est un usage NORMAL (c'est l'esprit
  // CSS : ce qui est déclaré cascade) — simple information, jamais un reproche.
  //
  // SILENCE PAR DÉFAUT — un projet sans le moindre bloc <theme> (composant ou fichier
  // de thème), ni la moindre lecture $$, ni la moindre lecture avec défaut (`var(--mjs-x, 1px)`,
  // celle d'un composant du projet comme celle d'un module du cœur) ressort avant même de
  // consulter les variables du framework ou des feuilles partagées : ceux-ci ne comptent QUE
  // si le projet y touche, jamais tout seuls (sinon `$$surface` du framework suffirait à faire
  // naître un `.mjs-theme-vars.json` dans un projet qui n'utilise pas les thèmes).
  // --------------------------------------------------------------------------
  private computeVarRegistry(warnings: string[]): void {
    type Kind = 'module' | 'theme' | 'framework' | 'stylesheet'
    type Decl = { value: string; declaredBy: string; kind: Kind; variant: string; file: string; line: number; doc: string; read?: true; set?: true }

    const declaredByModule = new Map<string, Set<string>>()   // nom → composants qui le déclarent
    const declarations     = new Map<string, Decl[]>()
    const readers          = new Map<string, Set<string>>()   // nom → qui le lit (composants/thèmes)
    const defaultReads     = new Map<string, Decl[]>()        // nom → composants qui le LISENT avec un défaut : au registre seulement
    const plainReads       = new Map<string, Set<string>>()   // nom → composants dont le CSS le lit, avec ou sans défaut : `readBy` seulement
    // un artefact déposé dans public/ ne publie JAMAIS l'arborescence absolue de la machine de
    // build : tout chemin part relatif à `this.root` (le framework, source 3 plus bas, garde son
    // nom court tel quel — ex. 'mjs_init.ts', déjà hors de toute arborescence projet). Un module
    // du cœur n'est pas un fichier du projet : relatif à la racine, il remontait jusqu'à
    // l'installation du framework (`../../<installation>/src/core-modules/x.mjs`) — il est nommé
    // `modularjs/core-modules/x.mjs`, le même sur toutes les machines (l'écriture de l'atelier le
    // refuse comme hors du projet, cf. server/index.ts serveThemeWritePost)
    const rel = (f: string) => {
      const abs = resolve(f)
      if (abs.startsWith(this.coreModulesDir + sep)) return 'modularjs/core-modules/' + relative(this.coreModulesDir, abs).split(sep).join('/')
      return relative(this.root, f)
    }

    const addDecl = (name: string, decl: Decl) => {
      const arr = declarations.get(name) ?? []
      arr.push(decl)
      declarations.set(name, arr)
      if (decl.kind === 'module') {
        const mods = declaredByModule.get(name) ?? new Set<string>()
        mods.add(decl.declaredBy)
        declaredByModule.set(name, mods)
      }
    }
    const addRead = (name: string, who: string) => {
      const set = readers.get(name) ?? new Set<string>()
      set.add(who)
      readers.set(name, set)
    }

    // 1. composants — $$ des <theme> ET CSS brut (baseCss + chaque variant)
    for (const c of this.pendingVarData) {
      const componentCss = [c.baseCss, ...Object.values(c.layoutCss)]
      // posées sur un élément interne par le CSS du composant, qui les lit lui-même : marquées `set` (posées par le composant),
      // jamais cachées — le thème de l'application peut les atteindre. Une déclaration d'un bloc `<theme>` a sa ligne et reste
      // une déclaration ordinaire : une surcharge écrite pour la descendance
      const privates = scanPrivateVars(componentCss.join('\n'), this.varPrefix)
      for (const d of buildVarDeclarations(c.baseCss, this.varPrefix, c.themeVars)) {
        const decl: Decl = { value: d.value, declaredBy: c.moduleName, kind: 'module', variant: d.variant, file: rel(c.file), line: d.line, doc: d.doc }
        addDecl(d.name, decl)
        if (d.line === 0 && privates.has(d.name)) decl.set = true
      }
      for (const layoutName of Object.keys(c.layoutCss)) {
        for (const d of buildVarDeclarations(c.layoutCss[layoutName], this.varPrefix, [])) {
          const decl: Decl = { value: d.value, declaredBy: c.moduleName, kind: 'module', variant: d.variant, file: rel(c.file), line: d.line, doc: d.doc }
          addDecl(d.name, decl)
          if (privates.has(d.name)) decl.set = true
        }
      }
      for (const name of c.varsRead) addRead(name, c.moduleName)
      // qui lit quoi, pour `readBy` : tout `var(--mjs-nom` du CSS du composant, défaut ou non
      for (const css of componentCss) {
        for (const name of scanReadNames(css, this.varPrefix)) {
          const set = plainReads.get(name) ?? new Set<string>()
          set.add(c.moduleName)
          plainReads.set(name, set)
        }
      }
      // lectures avec défaut (`var(--mjs-nom, défaut)`) : une entrée par nom et par défaut, marquée `read`, sauf pour un
      // nom que ce composant déclare (la déclaration fait foi). Un nom que le composant pose lui-même par son script ou son
      // gabarit y est aussi, marqué `set` : il se règle peut-être de l'extérieur, et celui qui le déclare doit voir que le
      // composant le lit. Hors de `declarations` : ni themeShared, ni themeUnknown ne les regardent (lire un nom n'impose
      // rien à la descendance)
      const declared = new Set(componentCss.flatMap(css => scanDeclaredVars(css, this.varPrefix).map(d => d.name)))
      const posed    = new Set(c.posed)
      const seen     = new Set<string>()
      for (const css of componentCss) {
        for (const r of scanDefaultReads(css, this.varPrefix)) {
          if (declared.has(r.name) || seen.has(r.name + '\0' + r.value)) continue
          seen.add(r.name + '\0' + r.value)
          const lue: Decl = { value: r.value, declaredBy: c.moduleName, kind: 'module', variant: '', file: rel(c.file), line: 0, doc: '', read: true }
          if (posed.has(r.name)) lue.set = true
          const arr = defaultReads.get(r.name) ?? []
          arr.push(lue)
          defaultReads.set(r.name, arr)
        }
      }
    }
    // 2. fichiers *.theme.mjs — mêmes deux volets (déclarations + lectures)
    for (const th of this.themeVarData) {
      for (const d of buildVarDeclarations(th.css, this.varPrefix, th.vars)) {
        addDecl(d.name, { value: d.value, declaredBy: th.name, kind: 'theme', variant: d.variant, file: rel(th.file), line: d.line, doc: d.doc })
      }
      for (const name of th.read) addRead(name, th.name)
    }

    if (declarations.size === 0 && readers.size === 0 && defaultReads.size === 0) return   // silence par défaut

    // 3. le framework lui-même (rend $$surface/$$fg/… légitimes sans redéclaration)
    for (const f of this.frameworkVarData) {
      addDecl(f.name, { value: f.value, declaredBy: 'framework', kind: 'framework', variant: '', file: f.file, line: f.line, doc: f.doc })
    }
    // 4. feuilles partagées de stylesheetsDir — CSS brut uniquement, jamais de $$
    // (allowDeclare n'existe même pas côté feuille partagée)
    for (const [sheetName, css] of this.lastSharedCss) {
      for (const d of scanDeclaredVars(css, this.varPrefix)) {
        addDecl(d.name, { value: d.value, declaredBy: sheetName, kind: 'stylesheet', variant: '', file: rel(join(this.stylesheetsDir, sheetName)), line: 0, doc: '' })
      }
    }
    if (this.lastRootCss !== undefined) {
      for (const d of scanDeclaredVars(this.lastRootCss, this.varPrefix)) {
        addDecl(d.name, { value: d.value, declaredBy: 'mjs_root', kind: 'stylesheet', variant: '', file: rel(join(this.stylesheetsDir, 'mjs_root')), line: 0, doc: '' })
      }
    }

    // avertissement — la variable d'un effet fondu dans un autre avant la 3.0 (`$$shimmer-color`), posée par l'appli : plus aucun effet ne
    // la lit, elle nomme celle qui la remplace. Une appli qui a son propre effet de ce nom (`*aurora(…) =`) n'est pas avertie
    for (const name of [...declarations.keys()].sort()) {
      const fondu = replacedThemeVar(name)
      if (!fondu || Object.hasOwn(this.effectDefs, fondu.effet) || declarations.get(name)!.every(d => d.kind === 'framework')) continue
      this.lintPush(warnings, 'legacy', t(fondu.nouveau ? 'bundler.variable-effet-fondu' : 'bundler.variable-effet-fondu-sans', { nom: name, ...fondu }))
    }
    // avertissement — lu quelque part, déclaré nulle part : faute de frappe probable
    for (const name of [...readers.keys()].sort()) {
      if (declarations.has(name)) continue
      this.lintPush(warnings, 'themeUnknown', t('bundler.variable-inconnue', { nom: name, lus: [...readers.get(name)!].sort().join(', ') }))
    }
    // information — déclaré par au moins deux composants : rappel qu'il cascade.
    // Deux modules CŒUR qui partagent une variable (checkbox et radio ont le même habillage) ne
    // regardent pas l'auteur de l'application : il n'y peut rien, et ça lui ferait 7 lignes
    // à chaque build (mesuré sur le site de doc). L'information ne sort donc que si au moins
    // un composant du PROJET est dans le lot.
    const coeur = new Set(this.pendingVarData.filter(c => resolve(c.file).startsWith(this.coreModulesDir)).map(c => c.moduleName))
    for (const name of [...declaredByModule.keys()].sort()) {
      const mods = declaredByModule.get(name)!
      if (mods.size < 2) continue
      if ([...mods].every(m => coeur.has(m))) continue
      this.lintPush(warnings, 'themeShared', t('bundler.variable-partagee', { nom: name, modules: [...mods].sort().join(', ') }))
    }

    // registre pour l'atelier /__mjs/theme à venir — trié de façon STABLE (jamais de
    // rebuild fantôme d'un build à l'autre : l'ordre du parallelMap est arbitraire).
    const registry: Record<string, { declarations: Decl[]; readBy: string[] }> = {}
    for (const name of [...new Set([...declarations.keys(), ...defaultReads.keys()])].sort()) {
      // point de code, jamais `localeCompare` — même exigence que `publicManifest` plus bas :
      // un registre trié selon la locale de la machine n'est PAS reproductible
      const cp = (x: string, y: string) => (x < y ? -1 : x > y ? 1 : 0)
      const decls = [...(declarations.get(name) ?? []), ...(defaultReads.get(name) ?? [])].sort((a, b) =>
        a.kind !== b.kind ? cp(a.kind, b.kind) :
        a.declaredBy !== b.declaredBy ? cp(a.declaredBy, b.declaredBy) :
        a.file !== b.file ? cp(a.file, b.file) : a.line - b.line)
      // qui la lit : ceux qui l'écrivent en `$$` et les composants dont le CSS la lit, avec un défaut ou non
      const readerNames = new Set<string>([...(readers.get(name) ?? []), ...(plainReads.get(name) ?? [])])
      registry[name] = { declarations: decls, readBy: [...readerNames].sort() }
    }
    // l'atelier qui le lit est fermé en production, et le registre nomme les fichiers sources et recopie les commentaires des
    // composants : jamais dans un dossier publié par un build de production (les avertissements ci-dessus restent ; celui qu'un
    // build de développement a laissé part à la publication, cf. retireRegistreTheme)
    if (!this.isProd()) this.writeSortieDifferee(join(this.outputDir, '.mjs-theme-vars.json'), JSON.stringify(registry, null, 2) + '\n', 'registre-theme')
  }

  // retireRegistreTheme() : le registre des variables de thème qu'un build de développement, ou une version qui l'écrivait aussi
  // en production, a laissé dans le dossier de sortie est retiré par la construction de production qui publie (compile(), étape
  // 4) — un build en échec ne publie rien et le laisse. Seul un fichier qui a la forme du registre (cf. sortieDuBuild) est retiré :
  // un fichier de ce nom qui ne l'a pas est peut-être un fichier de l'auteur, laissé tel quel, et un avertissement le nomme
  private retireRegistreTheme(warnings: string[]): void {
    const registre = join(this.outputDir, '.mjs-theme-vars.json')
    if (!existsSync(registre)) return
    if (sortieDuBuild(registre, 'registre-theme')) unlinkSync(registre)
    else warnings.push(t('bundler.index.registre-theme-garde', { chemin: registre }))
  }

  // Écriture NON ATOMIQUE : un
  // `writeFileSync` direct sur le chemin FINAL peut être interrompu à
  // mi-chemin (crash process, OOM-kill, coupure d'alim) — le fichier reste
  // alors TRONQUÉ sur disque. Le nom étant dérivé du hash du CONTENU SOURCE
  // (jamais revérifié contre les octets RÉELLEMENT écrits), `existsSync
  // (target)` renvoie ensuite `true` pour ce fichier CORROMPU à CHAQUE build
  // suivant → l'écriture est skippée (« il existe déjà ») → le fichier
  // tronqué n'est JAMAIS réparé, à vie, jusqu'à suppression manuelle.
  // Fix : écriture dans un fichier temporaire PUIS `renameSync` — un rename
  // sur le même volume est ATOMIQUE au niveau filesystem (POSIX comme NTFS) :
  // soit l'ancien contenu reste intact, soit le nouveau le remplace
  // ENTIÈREMENT, jamais un état intermédiaire visible depuis `target`. Si
  // deux compilations concurrentes produisent par coïncidence le MÊME hash
  // (donc le même contenu, par construction), l'écriture atomique de l'une
  // ou l'autre suffit — inoffensif.
  private writeFileAtomic(target: string, content: string | Buffer): void {
    if (existsSync(target)) return // même hash = même contenu (collision négligeable)
    const tmp = `${target}.tmp-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}`
    writeFileSync(tmp, content, 'utf-8')
    try {
      renameSync(tmp, target)
    } catch (e) {
      try { unlinkSync(tmp) } catch {}
      throw e
    }
    // tient la liste mémoïsée de outputDir à jour (cf. son bandeau) : un fichier qui vient
    // d'apparaître doit être visible du PROCHAIN cleanupOldHashes() de CE tour, sans reforcer
    // une lecture disque. `dirname(target) === this.outputDir` : cette méthode sert aussi à
    // d'autres dossiers (aucun cas réel actuellement, filet).
    if (this.outputDirListingCache && dirname(target) === this.outputDir) {
      this.outputDirListingCache.push(basename(target))
    }
  }

  // currentOutputDirListing() : jumeau lazy de outputDirListingCache (cf. son bandeau) — lit
  // outputDir UNE fois par compile(), au premier besoin, jamais plus.
  private currentOutputDirListing(): string[] {
    if (this.outputDirListingCache === null) this.outputDirListingCache = readdirSync(this.outputDir)
    return this.outputDirListingCache
  }

  // writeIfChanged() : jumeau de la garde déjà en place dans writeManifest() (même motif
  // exact), généralisé ici pour tout fichier à nom STABLE dont le CONTENU varie d'un build
  // à l'autre (variants `<style name="…">`, registre `.mjs-theme-vars.json`).
  // `writeFileAtomic` NE CONVIENT PAS : il skippe dès que `target` existe, quel
  // que soit son contenu (pensé pour un nom HASHÉ, jamais pour un nom stable). Un build qui
  // ne change rien ne doit pas non plus TOUCHER le fichier (nouveau mtime → le watcher se
  // redéclencherait pour rien).
  // feuille de mise en page `<module>.<nom>.css` : nom stable, sans empreinte, donc lue tout de suite par le site servi.
  // En build (`keepFailedComponents: false`), elle attend la publication du manifeste (compile(), étape 4) : un build en
  // échec ne publie rien et laisse les feuilles du dernier build réussi
  // construction qui écrit dans le dossier des sources : la feuille porte la marque, et un fichier de l'auteur du même nom n'est
  // jamais réécrit (cf. refusFichierAuteur ; refusé dès la tête de compile() quand la recherche des variantes l'a trouvé)
  private writeLayoutCss(target: string, content: string): void {
    const refus = this.refusFichierAuteur(target, 'feuille')
    if (refus) {
      this.authorRefusals.set(target, refus)
      return
    }
    const texte = this.ecritDansSources() ? `${MARQUE_SORTIE}\n${content}` : content
    if (this.keepFailedComponents) this.writeIfChanged(target, texte)
    else this.pendingLayoutWrites.push({ target, content: texte })
  }

  // fragment de traduction à nom clair (`i18n/<langue>/<section>.json`) et registre des variables de thème : même règle que la
  // feuille de mise en page, le site servi (ou l'atelier du thème) les lit tout de suite — un build en échec laisse ceux du dernier
  // build réussi ; un fichier de l'auteur du même nom n'est jamais réécrit (cf. refusFichierAuteur)
  private writeSortieDifferee(target: string, content: string, sorte: SorteSortie): void {
    const refus = this.refusFichierAuteur(target, sorte)
    if (refus) {
      this.authorRefusals.set(target, refus)
      return
    }
    if (this.keepFailedComponents) this.writeIfChanged(target, content)
    else this.pendingLayoutWrites.push({ target, content })
  }

  private writeIfChanged(target: string, content: string): void {
    if (existsSync(target)) {
      const current = readFileSync(target, 'utf-8')
      if (current === content) return
    }
    this.writeFileAtomicAlways(target, content)
  }

  // Cette logique de nettoyage était
  // DUPLIQUÉE (quasi identique) 2 fois DANS writeHashed() lui-même, et
  // ABSENTE d'un 3e site qui en aurait eu tout autant besoin (copie
  // d'assets binaires, cf. resolveOneAsset ci-dessous) : un binaire
  // (logo.png, etc.) réédité au fil du temps voyait CHAQUE ANCIENNE
  // version (`logo-<vieuxhash>.png`) s'accumuler indéfiniment dans
  // outputDir, jamais nettoyée — contrairement au JS compilé (writeHashed),
  // qui purge déjà ses anciennes versions. Factorisé ici pour les 3 sites.
  // La suppression n'est plus IMMÉDIATE : elle est mise EN ATTENTE
  // (pendingHashCleanup), purgée pour de bon seulement après que writeManifest() ait republié le
  // manifeste (cf. flushPendingHashCleanup, appelée en fin d'étape 4 de compile()). Sans ce
  // report, un composant qui recompile supprimait son ancien fichier haché DÈS cette étape 2 —
  // AVANT que writeManifest() (étape 4) ne republie la nouvelle URL — fenêtre où le manifeste
  // ENCORE PUBLIÉ (celui qu'un navigateur/CDN a déjà chargé) nommait un fichier déjà disparu.
  // Seul un fichier qu'un build a écrit (registre, cf. registeredOutputs) est remplacé, jamais un fichier de l'auteur qui n'a
  // que la forme d'une sortie : `card-utils.js` à côté d'un composant `card.mjs`, `logo-white.png` à côté d'une image
  // `logo.png`, un fichier source quand le dossier de sortie est le dossier source. `prune: false` : rien n'est retiré.
  private cleanupOldHashes(baseName: string, ext: string, keepFilenames: string[]): void {
    if (!this.prune) return
    const re = new RegExp(`^${baseName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}-(?:[0-9a-z]{5}|[a-f0-9]{8})${ext.replace('.', '\\.')}(\\.map)?$`)
    const ecrits = this.registeredOutputs()
    // mémoïsée le temps du compile() (cf. currentOutputDirListing) plutôt que relue à CHAQUE
    // appel : un projet de plusieurs centaines d'unités relisait sinon outputDir en entier une
    // fois PAR fichier écrit.
    for (const f of this.currentOutputDirListing()) {
      if (re.test(f) && !keepFilenames.includes(f) && ecrits.has(f.replace(/\.map$/, ''))) {
        this.pendingHashCleanup.push(join(this.outputDir, f))
      }
    }
  }

  // registeredOutputs() : les fichiers que des builds de ce constructeur ont écrits, tels que le registre les consigne (clé
  // `files`) — la seule liste de ce que le ménage peut retirer. Lue une fois par compile(), comme la liste de outputDir
  private registeredOutputs(): Set<string> {
    if (this.registryFilesCache === null) this.registryFilesCache = new Set(this.readRegistryFiles())
    return this.registryFilesCache
  }

  // flushPendingHashCleanup() : supprime pour de bon les anciens fichiers hachés mis en attente
  // par cleanupOldHashes() ci-dessus. Appelée UNIQUEMENT après que writeManifest() ait réussi
  // (compile(), étape 4) : avant cet instant, l'ancien fichier peut encore être celui que le
  // manifeste PUBLIÉ sur disque promet à un visiteur/CDN.
  // PUBLIC : bundler/startup.ts écrit ses fichiers de page APRÈS compile() et suit la même
  // discipline — nouveau fichier écrit, fragment réécrit, ANCIEN supprimé seulement ensuite.
  // Le registre des sorties suit (cf. writeOutputsRegistry) : les fichiers retirés en sortent, ceux écrits depuis le compile()
  // (fichiers de page de startup.ts) y entrent — le ménage du build suivant les connaîtra.
  flushPendingHashCleanup(): void {
    for (const f of this.pendingHashCleanup) {
      if (this.flushWillRemove(basename(f))) try { unlinkSync(f) } catch {}
    }
    this.pendingHashCleanup = []
    this.writeOutputsRegistry()
  }

  // flushWillRemove() : un fichier en attente part-il au prochain flushPendingHashCleanup() ? Non s'il a été émis par CE compile
  // (homonyme d'un autre dossier, a/util.js et b/util.js, ou réémis depuis sa mise en attente), ou cité par une unité que le
  // cache a resservie CE tour-ci (un homonyme resté en cache, donc non réécrit) : encore référencé, jamais supprimé — sa carte
  // `.map` non plus. Un fichier dont la source existe toujours mais que plus personne ne cite n'est pas protégé : il part.
  // `prune: false` : rien ne part, quelle que soit la file qui l'a mis en attente (ménage des empreintes, fichiers voisins
  // du manifeste en mode 'bundle')
  private flushWillRemove(nom: string): boolean {
    return this.prune && !this.emittedThisCompile.has(nom) && !this.cachedAssetNames.has(nom) && !(nom.endsWith('.map') && this.emittedThisCompile.has(nom.slice(0, -4)))
  }

  // keepCachedAssets() : les images, sons et .js voisins d'une unité que le cache resert ne sont pas réécrits
  // ce tour-ci (cf. cachedAssetNames) : le précache les garde
  private keepCachedAssets(cached: CacheEntry): void {
    for (const dep of cached.importedModules ?? []) {
      const published = this.publishedAssets.get(dep)
      if (!published) continue
      this.cachedAssetNames.add(published.name)
      for (const variant of published.variants) this.cachedAssetNames.add(variant)
    }
  }

  // notePublished() : le nom que porte, sous outputDir, la copie de CETTE source — l'ancien nom du même
  // chemin cesse d'être protégé (il part au prochain ménage), le nom d'un autre chemin reste protégé
  private notePublished(source: string, filename: string): void {
    if (this.publishedAssets.get(source)?.name === filename) return
    this.publishedAssets.set(source, { name: filename, variants: new Set() })
  }

  // --------------------------------------------------------------------------
  // outputsRegistry — `.mjs-outputs.json`, à côté du manifeste, réécrit à
  // CHAQUE build réussi. Ne mémorise PAS les noms de fichiers (déjà couverts par
  // emittedThisCompile, qui ne survit pas d'un compile() à l'autre) mais les EXTENSIONS que ce
  // bundler sait produire : `.js`/`.css`/`.map` toujours, les formats image CONFIGURÉS
  // (imageConfig.formats, même si aucune image n'a encore été compilée), et toute extension
  // RÉELLEMENT vue dans emittedThisCompile (assets µasset() génériques : .png, .woff2, un .pdf
  // légitimement servi…) — le tout ACCUMULÉ avec ce qui était déjà dans le registre (une
  // extension vue un jour le reste, même si un rebuild n'y touche plus ou que la config change).
  //
  // Sert de garde-fou à pruneOrphans() (ci-dessous) : un fichier au nom hachage-compatible mais
  // dont l'extension n'y a JAMAIS figuré n'est pas un candidat, même s'il en a la forme — c'est
  // exactement le cas d'un fichier étranger déposé à la main (rapport-1a2b3c4d.pdf), que
  // docs/32-cli-et-configuration.md promet intact et que HASHED_OUTPUT_RE seul ne peut pas
  // distinguer d'une vraie sortie.
  // --------------------------------------------------------------------------
  private outputsRegistryPath(): string {
    return join(dirname(this.manifestPath), '.mjs-outputs.json')
  }

  private writeOutputsRegistry(): void {
    const known = new Set<string>(['.js', '.css', '.map'])
    for (const fmt of this.imageConfig.formats) known.add(`.${fmt}`)
    for (const f of this.emittedThisCompile) known.add(extname(f.endsWith('.map') ? f.slice(0, -4) : f))
    // fragments de traduction : ceux d'avant (que la purge n'a pas encore retirés) + ceux de ce build
    const fragments = new Map<string, Set<string>>()
    const ajoute    = (lang: string, nom: string): void => { (fragments.get(lang) ?? fragments.set(lang, new Set()).get(lang)!).add(nom) }
    try {
      const prev = JSON.parse(readFileSync(this.outputsRegistryPath(), 'utf-8'))
      if (Array.isArray(prev?.extensions)) for (const e of prev.extensions) if (typeof e === 'string') known.add(e)
      for (const [lang, noms] of Object.entries(prev?.i18nFragments ?? {})) if (Array.isArray(noms)) for (const nom of noms) if (typeof nom === 'string') ajoute(lang, nom)
    } catch { /* registre absent ou périmé : repart d'une base saine, réécrite juste après */ }
    for (const [lang, noms] of this.i18nWritten) for (const nom of noms) ajoute(lang, nom)
    // fichiers écrits par les builds, l'une ou l'autre forme d'empreinte : ceux d'avant + ceux de ce build — la seule liste de ce
    // que le ménage peut retirer (cf. registeredOutputs, pruneOrphans)
    // (ceux que le build a déjà remplacés n'existent plus : ils sortent de la liste, qui ne grossit pas à chaque édition)
    const fichiers = new Set<string>(this.readRegistryFiles().filter(f => existsSync(join(this.outputDir, f))))
    for (const f of this.emittedThisCompile) if (isHashedOutputName(f)) fichiers.add(f)
    // premier build en échec : le dossier du manifeste n'existe pas encore (writeManifest(), qui le crée, n'a pas tourné)
    mkdirSync(dirname(this.outputsRegistryPath()), { recursive: true })
    this.writeIfChanged(this.outputsRegistryPath(), this.serializeOutputsRegistry(known, fragments, fichiers, this.registryChunks()))
  }

  /** `chunks` du registre : les fichiers écrits à côté du manifeste (cf. bundleNeighborFiles) qui existent encore, avec ceux de ce build */
  private registryChunks(): Set<string> {
    const dossier = dirname(this.manifestPath)
    const voisins = new Set<string>(bundleNeighborFiles(this.manifestPath).filter(f => existsSync(join(dossier, f))))
    for (const f of this.bundleChunkFiles) voisins.add(f)
    return voisins
  }

  /** `files` du registre : les fichiers à empreinte que des builds ont écrits (liste vide si registre absent ou illisible) */
  private readRegistryFiles(): string[] {
    try {
      const prev = JSON.parse(readFileSync(this.outputsRegistryPath(), 'utf-8'))
      return Array.isArray(prev?.files) ? prev.files.filter((n: unknown): n is string => typeof n === 'string') : []
    } catch {
      return []
    }
  }

  // ecritDansSources() : le dossier de sortie ou le manifeste sont dans le dossier des sources. Les sorties à nom fixe y côtoient
  // les fichiers de l'auteur : elles portent la marque des fichiers produits, et seul un fichier qui la porte est remplacé
  // (cf. sortieDuBuild). Hors de ce cas, aucune marque
  private ecritDansSources(): boolean {
    return cheminDansDossier(this.outputDir, this.sourceDir) || cheminDansDossier(this.manifestPath, this.sourceDir)
  }

  // refusFichierAuteur() : dans une construction qui écrit dans le dossier des sources, une sortie à nom fixe tomberait sur un
  // fichier qui existe sans être une sortie du build (cf. sortieDuBuild) : c'est peut-être un fichier de l'auteur, jamais remplacé
  private refusFichierAuteur(target: string, sorte: SorteSortie): Error | null {
    if (!existsSync(target) || !this.ecritDansSources() || sortieDuBuild(target, sorte)) return null
    return erreurFichiersAuteur([[target, sorte]], this.sourceDir, false)
  }

  // refusSortiesAuteur() : la même règle pour toutes les sorties à nom fixe d'un coup — le manifeste, `mjs-precache.json` et
  // les feuilles de mise en page trouvées par feuillesAttendues() : une seule erreur les nomme toutes, avant toute écriture
  // Hors du dossier des sources, seul le manifeste peut tomber sur un fichier de l'auteur (`manifestPath` vise
  // `app/assets/javascripts/application.js`) : il ne porte jamais la marque, il est reconnu à sa forme, de cette version ou
  // d'une précédente (cf. sortieDuBuild) ; un dossier à sa place n'est pas un fichier à protéger, son écriture échoue d'elle-même.
  // Dans les sources comme dehors, un fichier vide à la place du manifeste est remplacé (cf. fichierVide), et un manifeste déjà
  // refusé (`manifeste` faux, cf. refusCheminManifeste) n'est pas nommé une seconde fois
  private refusSortiesAuteur(manifeste = true, fragments = true): Error | null {
    if (!this.ecritDansSources()) {
      if (!manifeste || !existsSync(this.manifestPath) || !statSync(this.manifestPath).isFile() || fichierVide(this.manifestPath) || sortieDuBuild(this.manifestPath, 'manifeste')) return null
      return new Error(t('bundler.index.manifeste-fichier-auteur', { chemin: this.manifestPath }))
    }
    const cibles: [string, SorteSortie][] = manifeste ? [[this.manifestPath, 'manifeste']] : []
    cibles.push([join(this.outputDir, 'mjs-precache.json'), 'precache'])
    if (!this.isProd()) cibles.push([join(this.outputDir, '.mjs-theme-vars.json'), 'registre-theme'])
    if (this.shouldMinify()) cibles.push([this.mangleCachePath, 'noms-courts'])
    if (this.jsMode === 'bundle' && this.shouldEmitSourceMap()) cibles.push([`${this.manifestPath}.map`, 'carte'])
    if (fragments) for (const f of this.fragmentsAttendus()) cibles.push([f, 'traduction'])
    const fichiers = cibles.filter(([f, sorte]) => existsSync(f) && !(sorte === 'manifeste' && fichierVide(f)) && !sortieDuBuild(f, sorte))
    for (const f of this.feuillesAttendues()) fichiers.push([f, 'feuille'])
    return fichiers.length > 0 ? erreurFichiersAuteur(fichiers, this.sourceDir, true) : null
  }

  // i18nHashed() : fragments de traduction sous empreinte (`i18n.hash`, `'auto'` = en production seulement) ou à nom clair
  private i18nHashed(): boolean {
    const hashMode = this.i18n?.hash ?? 'auto'
    return hashMode === 'auto' ? this.isProd() : hashMode
  }

  // fragmentsAttendus() : les fragments à nom clair que les traductions par sections (`i18n/<langue>/<section>.json|yml`)
  // feront écrire dans `outputDir/i18n/<langue>/` ; un fragment qui échapperait à cette liste reste refusé au moment de
  // l'écrire (cf. writeSortieDifferee)
  private fragmentsAttendus(): string[] {
    const i18nDir = join(this.sourceDir, 'i18n')
    if (this.i18nHashed() || !this.hasI18nConfigured()) return []
    const fragments: string[] = []
    try {
      for (const lang of readdirSync(i18nDir).sort()) {
        if (!statSync(join(i18nDir, lang)).isDirectory()) continue
        for (const f of readdirSync(join(i18nDir, lang)).sort()) {
          if (['.yml', '.yaml', '.json'].includes(extname(f))) fragments.push(join(this.outputDir, 'i18n', lang, `${basename(f, extname(f))}.json`))
        }
      }
    }
    catch {
      // dossier illisible : refusI18nSurPlace() rend son erreur
    }
    return fragments
  }

  // feuillesAttendues() : les feuilles `<module>.<nom>.css` que les `<style name="…">` des composants feront écrire dans outputDir
  // et qui y existent déjà sans être des sorties du build. Cherchées seulement si outputDir contient une feuille `<a>.<b>.css`
  // sans marque, en lisant les sections de chaque composant comme le transpileur ; un composant illisible est laissé à la
  // compilation, qui le signale. Une feuille qui échapperait à cette recherche reste refusée au moment de l'écrire (cf. writeLayoutCss)
  private feuillesAttendues(): string[] {
    let suspectes: Set<string>
    try {
      suspectes = new Set(readdirSync(this.outputDir).filter(f => /^.+\.[A-Za-z][\w-]*\.css$/.test(f) && !sortieDuBuild(join(this.outputDir, f), 'feuille')))
    }
    catch {
      return []
    }
    if (suspectes.size === 0) return []
    let composants: string[]
    try {
      composants = this.findFiles(this.sourceDir, ['.mjs']).filter(f => !isThemeFile(f) && !isTypesFile(f) && !isEffectsFile(f))
    }
    catch {
      return []
    }
    const trouvees = new Set<string>()
    for (const f of composants) {
      try {
        for (const ly of extractSections(readFileSync(f, 'utf-8')).layouts) {
          const nom = `${pageAwareBaseName(f)}.${ly.name}.css`
          if (ly.raw.trim() !== '' && suspectes.has(nom)) trouvees.add(join(this.outputDir, nom))
        }
      }
      catch {
        // composant illisible : la compilation le signale
      }
    }
    return [...trouvees].sort()
  }

  // refusAvantEcriture() : ce que compile() refuse avant d'écrire quoi que ce soit — un manifeste qui remplacerait un fichier source
  // (cf. refusCheminManifeste), le dossier des traductions comme dossier de sortie (cf. refusI18nSurPlace), et des sorties à nom fixe
  // sur des fichiers de l'auteur (cf. refusSortiesAuteur)
  private refusAvantEcriture(): Error[] {
    const manifeste = this.refusCheminManifeste()
    const i18n      = this.refusI18nSurPlace()
    // un manifeste ou des traductions déjà refusés ne sont pas nommés une seconde fois comme fichiers de l'auteur
    return [manifeste, i18n, this.refusSortiesAuteur(manifeste === null, i18n === null)].filter((e): e is Error => e !== null)
  }

  // refusCheminManifeste() : les refus de `manifestPath` que mjs.config.json et la ligne de commande appliquent déjà (cf.
  // refusManifestPath, config.ts), pour `new Bundler()` appelé par l'API — sinon le fichier visé était écrasé à chaque construction
  private refusCheminManifeste(): Error | null {
    const refus = refusManifestPath({ manifestPath: this.manifestPath, sourceDir: this.sourceDir, outputDir: this.outputDir, manifestExternal: this.manifestExternal })
    if (refus === null) return null
    if (refus.raison === 'extension') return new Error(t('bundler.index.manifeste-refuse-extension', { chemin: this.manifestPath, extension: refus.extension }))
    if (refus.raison === 'externe') return new Error(t('bundler.index.manifeste-refuse-externe', { chemin: this.manifestPath }))
    return new Error(t('bundler.index.manifeste-refuse-sources', { chemin: this.manifestPath, sourceDir: this.sourceDir, outputDir: this.outputDir }))
  }

  // refusI18nSurPlace() : traductions par sections (`i18n/<langue>/*.json|yml`) et dossier de sortie qui mène au dossier des
  // traductions — même règle que scanI18n(), qui ne tourne qu'après l'écriture des sorties. Une entrée illisible du dossier des
  // traductions ferait échouer scanI18n() : son erreur est rendue ici, avant toute écriture
  private refusI18nSurPlace(): Error | null {
    const i18nDir = join(this.sourceDir, 'i18n')
    try {
      if (!existsSync(i18nDir) || !statSync(i18nDir).isDirectory()) return null
      for (const lang of readdirSync(i18nDir).sort()) {
        const dossier = join(i18nDir, lang)
        if (!statSync(dossier).isDirectory()) continue
        if (!readdirSync(dossier).some(f => ['.yml', '.yaml', '.json'].includes(extname(f)))) continue
        const outDir = join(this.outputDir, 'i18n', lang)
        if (cheminDansDossier(outDir, i18nDir)) return new Error(t('bundler.index.i18n-sortie-dans-sources', { dossier: outDir, sources: i18nDir }))
      }
    } catch (e: any) {
      return e instanceof Error ? e : new Error(String(e))
    }
    return null
  }

  /** Forme écrite de `.mjs-outputs.json` : `extensions` toujours, `i18nFragments` (langue → noms) seulement s'il y en a. */
  private serializeOutputsRegistry(known: Set<string>, fragments: Map<string, Set<string>>, files: Set<string> = new Set(), chunks: Set<string> = new Set()): string {
    const body: { extensions: string[], i18nFragments?: Record<string, string[]>, files?: string[], chunks?: string[], ssrStyles?: string[] } = { extensions: [...known].sort() }
    if (files.size > 0) body.files = [...files].sort()
    // fichiers écrits à côté du manifeste quand le fichier unique est coupé en morceaux : la seule liste de ceux que le build peut retirer ou que les serveurs servent
    if (chunks.size > 0) body.chunks = [...chunks].sort()
    // feuilles partagées que le rendu serveur a écrites (cf. server/sorties-rendu.ts) : gardées d'un build au suivant, celles qui n'existent plus sortent de la liste
    const rendu = feuillesConsignees(dirname(this.manifestPath)).filter(f => existsSync(join(this.outputDir, f)))
    if (rendu.length > 0) body.ssrStyles = rendu
    const langs = [...fragments.keys()].filter(l => fragments.get(l)!.size > 0).sort()
    if (langs.length > 0) {
      body.i18nFragments = {}
      for (const l of langs) body.i18nFragments[l] = [...fragments.get(l)!].sort()
    }
    return JSON.stringify(body, null, 2) + '\n'
  }

  // retire de `i18n/<langue>/` les fragments que le registre dit écrits par un build et que CE build n'a pas
  // réécrits ; seuls des noms simples (jamais un chemin) sont suivis. Le registre est réécrit avec ce qui reste
  private pruneI18nFragments(knownExt: Set<string>, purged: Set<string>): { removed: string[], failed: string[] } {
    const removed: string[] = []
    const failed: string[]  = []
    let prev: any
    try {
      prev = JSON.parse(readFileSync(this.outputsRegistryPath(), 'utf-8'))
    } catch {
      return { removed, failed }
    }
    const simple  = (n: string): boolean => n !== '' && n !== '.' && n !== '..' && !n.startsWith('.') && !/[\\/\0]/.test(n)
    const restant = new Map<string, Set<string>>()
    for (const [lang, noms] of Object.entries(prev?.i18nFragments ?? {})) {
      if (!Array.isArray(noms) || !simple(lang)) continue
      const courants = this.i18nWritten.get(lang) ?? new Set<string>()
      for (const nom of noms) {
        if (typeof nom !== 'string' || !simple(nom) || !nom.endsWith('.json')) continue
        if (!courants.has(nom)) {
          const chemin = join(this.outputDir, 'i18n', lang, nom)
          // jamais une traduction de l'auteur (sortie = sources), même nommée par le registre : elle reste, et sort du registre
          if (cheminDansDossier(chemin, join(this.sourceDir, 'i18n'))) continue
          try {
            if (existsSync(chemin)) unlinkSync(chemin)
            removed.push(`i18n/${lang}/${nom}`)
            continue
          } catch {
            failed.push(`i18n/${lang}/${nom}`)
          }
        }
        ;(restant.get(lang) ?? restant.set(lang, new Set()).get(lang)!).add(nom)
      }
    }
    const fichiers = new Set(this.readRegistryFiles().filter(f => !purged.has(f)))
    this.writeIfChanged(this.outputsRegistryPath(), this.serializeOutputsRegistry(knownExt, restant, fichiers, this.registryChunks()))
    return { removed, failed }
  }

  // --------------------------------------------------------------------------
  // pruneBundleChunks() : la purge du mode 'bundle'. Le cœur est dans le fichier unique : `mjs_core-….js` n'existe pas, la garde
  // `no-core` de pruneOrphans() ne dit rien ici. Les seuls candidats sont les fichiers que le registre dit écrits à côté du
  // manifeste par un build (clé `chunks`) et que CE build n'a pas réécrits — un module retiré ou renommé laisse les siens d'un
  // processus à l'autre —, jamais un fichier reconnu à la forme de son nom : un fichier d'auteur nommé `chunk-deadbeef.js`, posé à
  // côté du manifeste (dans le dossier de sortie ou ailleurs), n'y figure pas. Un registre présent mais illisible bloque tout.
  // --------------------------------------------------------------------------
  private pruneBundleChunks(): { removed: string[], failed: string[], skipped?: 'registry-unreadable' } {
    const dossier = dirname(this.manifestPath)
    const chemin  = this.outputsRegistryPath()
    if (!existsSync(chemin)) return { removed: [], failed: [] }
    try {
      JSON.parse(readFileSync(chemin, 'utf-8'))
    } catch {
      return { removed: [], failed: [], skipped: 'registry-unreadable' }
    }
    const removed: string[] = []
    const failed: string[]  = []
    const manifeste = basename(this.manifestPath)
    for (const nom of bundleNeighborFiles(this.manifestPath)) {
      if (this.bundleChunkFiles.has(nom) || nom.replace(/\.map$/, '') === manifeste) continue // écrit ce tour-ci, ou le manifeste lui-même
      const fichier = join(dossier, nom)
      if (!existsSync(fichier)) continue
      try {
        unlinkSync(fichier)
        removed.push(nom)
      } catch {
        failed.push(nom)
      }
    }
    if (removed.length > 0) this.writeOutputsRegistry() // le registre ne consigne plus ce qui n'existe plus
    removed.sort((a, b) => a < b ? -1 : a > b ? 1 : 0)
    failed.sort((a, b) => a < b ? -1 : a > b ? 1 : 0)
    return { removed, failed }
  }

  // --------------------------------------------------------------------------
  // pruneOrphans() : purge — le build remplace déjà l'empreinte
  // d'un fichier qui CHANGE (cleanupOldHashes ci-dessus), mais jamais un NOM qui DISPARAÎT
  // (composant renommé ou supprimé) : mesuré sur un vrai projet, 893 fichiers / 17 Mo dans
  // outputDir pour 330 écrits par le dernier build. Rien n'est SERVI (le manifeste ne les
  // référence plus), mais le dossier MENT sur ce que le site contient réellement.
  //
  // Retire d'outputDir tout fichier qu'un build a écrit (registre `.mjs-outputs.json`, clé `files`, au nom de la famille
  // émise par CE bundler) qu'AUCUNE émission de ce compile() n'a produit (`emittedThisCompile`) — jamais un fichier sur la
  // seule forme de son nom, même à huit hexadécimaux (`vendor-0123abcd.js` déposé à la main). `prune: false` : rien.
  //
  // Dans `i18n/<langue>/`, seuls partent les fragments que le registre dit écrits par un build et que ce build
  // n'a pas réécrits (cf. pruneI18nFragments) : jamais un fichier de l'utilisateur, jamais d'après la forme du nom.
  //
  // JAMAIS touché : un SOUS-DOSSIER (i18n/, mjs_pages/… — readdirSync filtré à `isFile()`) ; un
  // DOTFILE (`.mangle-cache.json`, `.mjs-theme-vars.json`) ; un nom STABLE qui ne matche pas la
  // famille hachée (le manifeste, un CSS de layout `<module>.<layout>.css`, `mjs-precache.json`) ;
  // tout fichier ÉTRANGER au build ; ni sur un compile qui a resservi son cache. LE MANIFESTE, PAR
  // SON NOM, même s'il matche la famille hachée par collision de config
  // (`manifestPath`/`--manifest` en `<base>-<empreinte>.<ext>`) : `writeManifest()` écrit hors de
  // `emittedThisCompile`, un nom qui matche s'auto-détruisait sinon au build qui vient de l'écrire.
  //
  // Mode `js: 'bundle'` : le cœur est dans le fichier unique, le reste de cette méthode ne s'applique pas ; seule tourne la
  // purge des fichiers écrits à côté du manifeste que le registre consigne (cf. pruneBundleChunks).
  //
  // GARDES, sans exception (rendent `{ removed: [], failed: [], skipped: '…' }` sans rien lire ni
  // supprimer — `skipped` absent seulement quand la purge a tourné) :
  //  - aucun compile() n'a encore tourné, OU le dernier est EN ERREUR (`skipped: 'errors'`) : un
  //    build partiel garde tout (cf. recoverFailedComponentManifest) — purger sur un ensemble
  //    d'émissions incomplet effacerait des fichiers ENCORE valides.
  //  - `emittedThisCompile` est vide (`skipped: 'empty'`) : rien de fiable à quoi comparer.
  //  - AUCUNE entrée de `emittedThisCompile` n'est le runtime `mjs_core-<empreinte>.js`
  //    (`skipped: 'no-core'`) — il est émis par TOUT build sain ; son absence signale un
  //    ensemble non fiable plutôt qu'un site sans runtime — une garde MUETTE ici effacerait TOUT
  //    outputDir.
  //  - outputDir n'existe pas (`skipped: 'no-dir'`).
  //  - CE compile() a resservi au moins un composant depuis un compile() PRÉCÉDENT (`skipped:
  //    'cache'`, cf. `cacheHitsThisCompile`/
  //    `compileGeneration`) : `_compileMjsInner`/`_compileScriptModuleInner` réinjectent le `.js` du
  //    cache hit dans `emittedThisCompile` mais jamais ses assets annexes (`µasset`, variantes
  //    d'image — `resolveOneAsset` n'est rappelé QUE sur recompilation) ; purger sur cet ensemble
  //    partiel retirerait un asset encore référencé en dur par le `.js` resservi. NE COMPTE PAS un
  //    hit sur une entrée posée PENDANT ce même compile() (composant redemandé 2 fois dans le même
  //    tour — resolveTagShortcuts, une inclusion…) : ses assets annexes ont déjà été émis ce
  //    tour-ci, hit inoffensif (11 hits de ce genre mesurés sur un build FROID d'un site réel,
  //    685 fichiers — la garde se déclenchait alors sur CHAQUE `mjs build` d'un vrai
  //    projet, la purge n'y tournait donc JAMAIS). Cette garde ne vise plus que l'instance réutilisée
  //    entre au moins 2 `compile()` (watcher, `mjs dev`, API).
  // --------------------------------------------------------------------------
  pruneOrphans(): { removed: string[], failed: string[], skipped?: 'errors' | 'empty' | 'no-core' | 'no-dir' | 'cache' | 'registry-unreadable' | 'registry-empty' | 'disabled' } {
    if (!this.prune) return { removed: [], failed: [], skipped: 'disabled' } // `prune: false` : rien n'est retiré
    if (this.lastCompileErrors !== 0) return { removed: [], failed: [], skipped: 'errors' } // aucun compile, ou un compile en erreur
    if (this.jsMode === 'bundle') return this.pruneBundleChunks() // fichier unique : pas de cœur à part, seuls les fichiers consignés à côté du manifeste
    if (this.emittedThisCompile.size === 0) return { removed: [], failed: [], skipped: 'empty' } // rien à comparer
    if (![...this.emittedThisCompile].some(f => /^mjs_core-(?:[0-9a-z]{5}|[a-f0-9]{8})\.js$/.test(f))) return { removed: [], failed: [], skipped: 'no-core' } // ensemble non fiable
    if (!existsSync(this.outputDir)) return { removed: [], failed: [], skipped: 'no-dir' }
    if (this.cacheHitsThisCompile > 0) return { removed: [], failed: [], skipped: 'cache' } // assets annexes non réinjectés par le(s) cache hit(s)

    // Extensions que CE bundler sait produire (cf. writeOutputsRegistry) :
    // garde-fou EN PLUS de emittedThisCompile, pas à sa place — un fichier qui matche
    // HASHED_OUTPUT_RE par pure coïncidence de nom (rapport-1a2b3c4d.pdf déposé à la main) mais
    // dont l'extension n'a JAMAIS figuré au registre n'est pas un candidat. Registre absent (jamais
    // écrit encore) : base sûre minimale, rien de perdu — PRÉSENT mais illisible : garde muette
    // interdite, la purge ENTIÈRE est bloquée plutôt que de deviner.
    let knownExt: Set<string>
    const registryPath = this.outputsRegistryPath()
    if (existsSync(registryPath)) {
      try {
        const parsed = JSON.parse(readFileSync(registryPath, 'utf-8'))
        if (!Array.isArray(parsed?.extensions) || !parsed.extensions.every((e: unknown) => typeof e === 'string')) throw new Error('forme inattendue')
        knownExt = new Set<string>(parsed.extensions)
      } catch {
        return { removed: [], failed: [], skipped: 'registry-unreadable' }
      }
      // `{"extensions":[]}` est un JSON PARFAITEMENT valide
      // (tableau, `.every()` vacuement vrai sur un tableau vide) : sans cette garde, `knownExt`
      // restait VIDE, chaque fichier échouait silencieusement le test d'extension connue plus bas,
      // removed:[] était rendu SANS jamais poser `skipped` — même silhouette qu'un run sain « rien
      // à purger ». Un zombie survivait indéfiniment, indiscernable d'un build propre.
      if (knownExt.size === 0) return { removed: [], failed: [], skipped: 'registry-empty' }
    } else {
      knownExt = new Set<string>(['.js', '.css', '.map'])
      for (const fmt of this.imageConfig.formats) knownExt.add(`.${fmt}`)
    }
    const hashedOutputExt = (name: string): string => extname(name.endsWith('.map') ? name.slice(0, -4) : name)

    // le manifeste ne passe jamais par emittedThisCompile (écrit par writeManifest(), hors filet) :
    // protégé PAR SON NOM quand il est logé DANS outputDir, sans condition de motif — sur les chemins
    // RÉELS : un lien symbolique vers outputDir faisait échouer l'égalité de chaînes, manifeste retiré
    const sameDir      = (a: string, b: string): boolean => { try { return realpathSync(a) === realpathSync(b) } catch { return a === b } }
    const manifestName = sameDir(dirname(this.manifestPath), this.outputDir) ? basename(this.manifestPath) : null

    const removed: string[] = []
    const failed: string[]  = []
    const registreFichiers  = new Set(this.readRegistryFiles())
    // feuilles partagées du rendu serveur que ce processus n'a pas réécrites : celles que le dernier prérendu n'utilise plus
    const feuillesRenduInutiles = new Set(feuillesRenduPerimees(dirname(this.manifestPath)))
    const purgesCourtes     = new Set<string>()
    for (const entry of readdirSync(this.outputDir, { withFileTypes: true })) {
      if (!entry.isFile()) continue // jamais un sous-dossier (i18n/, mjs_pages/…)
      const name = entry.name
      if (name.startsWith('.')) continue // jamais un dotfile (.mangle-cache.json…, .mjs-outputs.json compris)
      if (manifestName !== null && name.replace(/\.map$/, '') === manifestName) continue // jamais le manifeste, ni son .map
      // seul un fichier qu'un build a écrit est candidat (registre, clé `files`), ou une feuille partagée que le registre dit
      // écrite par un prérendu : aucune forme de nom ne suffit, ni à cinq caractères (`theme-light.css`) ni à huit
      // hexadécimaux (`vendor-0123abcd.js` déposé à la main)
      const consigne = registreFichiers.has(name.replace(/\.map$/, '')) || feuillesRenduInutiles.has(name)
      if (!consigne || !isHashedOutputName(name)) continue // jamais un nom STABLE (bundle.js, mjs-precache.json, CSS de layout…)
      if (SERVER_WRITTEN_RE.test(name) && !feuillesRenduInutiles.has(name)) continue // jamais un asset écrit par le rendu serveur (cf. SERVER_WRITTEN_RE), sauf une feuille partagée que le registre dit écrite par un prérendu précédent et que celui-ci n'a pas réécrite
      if (this.emittedThisCompile.has(name)) continue // émis ce tour-ci
      if (name.endsWith('.map') && this.emittedThisCompile.has(name.slice(0, -4))) continue // .map d'un .js émis ce tour-ci
      if (!knownExt.has(hashedOutputExt(name))) continue // Extension jamais produite par CE bundler : jamais un candidat
      if (name.endsWith('.json') && !name.startsWith('mjs_err-')) continue // en JSON, ce bundler n'écrit que les fichiers de messages : tout autre nom est au projet
      try {
        unlinkSync(join(this.outputDir, name))
        removed.push(name)
        purgesCourtes.add(name)
      } catch {
        failed.push(name)
      }
    }
    if (existsSync(registryPath)) {
      const fragments = this.pruneI18nFragments(knownExt, purgesCourtes)
      removed.push(...fragments.removed)
      failed.push(...fragments.failed)
    }
    removed.sort((a, b) => a < b ? -1 : a > b ? 1 : 0)
    failed.sort((a, b) => a < b ? -1 : a > b ? 1 : 0)
    return { removed, failed }
  }

  // --------------------------------------------------------------------------
  // assertValidEsm() : garde-fou « build vert qui ment » — une parenthèse orpheline compilée
  // (RHS entièrement parenthésé) passait le build et ne cassait qu'à l'import navigateur,
  // silencieusement. Chaque JS émis doit désormais être de l'ESM syntaxiquement
  // valide : parse via acorn (déjà en dépendance et déjà importé plus haut,
  // cf. extractAnimationsFromAst), throw au build avec fichier:ligne:colonne +
  // la ligne fautive — même esprit que [bundler/minify] (minify.ts:152).
  // --------------------------------------------------------------------------
  private assertValidEsm(content: string, filename: string): void {
    try {
      acorn.parse(content, { ecmaVersion: 'latest', sourceType: 'module' })
    } catch (err: any) {
      const line = err?.loc?.line
      const col  = err?.loc?.column
      const src  = line ? (content.split('\n')[line - 1] ?? '').slice(0, 200) : ''
      throw new Error(`[bundler/esm-check] ${filename}${line ? `:${line}:${col}` : ''} — ${err?.message ?? err}\n  ${src}`)
    }
  }

  // --------------------------------------------------------------------------
  // assertParsableJs() : garde-fou ESM pour les assets .js copiés RAW — resolveOneAsset() copiait tout .js hors
  // .civet/.coffee/.mjs SANS AUCUNE validation (branche « Binaires ») : un
  // vendor .js cassé référencé via µasset() passait tel quel, stats.errors
  // restait vide. Dual-parse (module PUIS script) : un asset brut n'est pas
  // forcément de l'ESM (vendor UMD, script classique avec `with`, etc.) —
  // exiger strict module-only casserait des vendors légitimes. On ne bloque
  // QUE ce qui est illisible dans LES DEUX grammaires (fichier tronqué/corrompu).
  // --------------------------------------------------------------------------
  private assertParsableJs(content: string, filename: string, source?: string): void {
    const memo = source ? this.jsMemoFor(source, content) : null
    if (memo?.parsable) return
    try {
      acorn.parse(content, { ecmaVersion: 'latest', sourceType: 'module' })
    } catch (moduleErr: any) {
      try {
        acorn.parse(content, { ecmaVersion: 'latest', sourceType: 'script' })
      } catch {
        const line = moduleErr?.loc?.line
        const col  = moduleErr?.loc?.column
        const src  = line ? (content.split('\n')[line - 1] ?? '').slice(0, 200) : ''
        throw new Error(t('bundler.index.esm-check-ni-esm-ni-script', { filename, line, col, erreur: String(moduleErr?.message ?? moduleErr), src }))
      }
    }
    if (memo) memo.parsable = true
  }

  // missingNeighborWarnings() : un avertissement par voisin absent (sans doublon), chemins relatifs à sourceDir
  private missingNeighborWarnings(missing: MissingNeighbor[]): string[] {
    const rel                = (p: string) => relative(this.sourceDir, p).split(sep).join('/')
    const seen               = new Set<string>()
    const warnings: string[] = []
    for (const m of missing) {
      const key = `${m.from}\0${m.abs}`
      if (seen.has(key)) continue
      seen.add(key)
      warnings.push(t('bundler.index.voisin-js-absent', { fichier: rel(m.from), voisin: m.spec, chemin: rel(m.abs) }))
    }
    return warnings
  }

  // jsMemoFor() : l'entrée du mémo d'un .js (cf. jsMemo) pour CE contenu — neuve quand le fichier a changé
  private jsMemoFor(source: string, code: string): { digest: string, parsable: boolean, specs: JsImportSpecifier[] | null } {
    const digest = createHash('md5').update(code).digest('hex')
    const memo   = this.jsMemo.get(source)
    if (memo && memo.digest === digest) return memo
    const fresh = { digest, parsable: false, specs: null as JsImportSpecifier[] | null }
    this.jsMemo.set(source, fresh)
    return fresh
  }

  // importsOfJs() : les imports relatifs d'un .js copié tel quel, analysés une fois par chemin et par
  // empreinte ; sans `import` ni `export` dans le texte il n'y a rien à réécrire ni à suivre, aucune analyse
  private importsOfJs(source: string, code: string): JsImportSpecifier[] {
    if (!/\b(?:import|export)\b/.test(code)) return []
    const memo = this.jsMemoFor(source, code)
    return memo.specs ??= relativeJsImports(code)
  }

  // --------------------------------------------------------------------------
  // assertSafeSvg() : un SVG copié tel quel (resolveOneAsset, branche
  // « Binaires ») est servi depuis la MÊME origine que le reste du site : un <script> embarqué,
  // un attribut on*= (onload, onclick…) ou un javascript: en valeur d'attribut s'exécute au
  // chargement direct de l'URL du SVG (document top-level ou <object>/<iframe>). Ni µasset() ni
  // µimage() n'inspectaient le contenu avant ce fix — refus nommant le fichier et le motif trouvé,
  // AVANT toute écriture sur disque.
  // 3 motifs contournables tels quels : une entité HTML
  // (`&#106;avascript:`, `&#x6A;avascript:`) reconstitue `javascript:` SANS jamais écrire le mot en
  // clair ; l'injection SMIL (`<set attributeName="onclick" to="…">`, `<animate
  // attributeName="onmouseover" …>`) ne pose ni <script>, ni on*=, ni javascript: littéral ;
  // `<foreignObject><iframe src="…">` embarque une autre origine sans aucun des 3 motifs non plus.
  // Renforcé ci-dessous — animations SMIL sur d/opacity/transform… restent PERMISES (légitimes).
  // --------------------------------------------------------------------------
  private assertSafeSvg(content: string, filename: string): void {
    // DTD interne : ses entités (`<!ENTITY j "java">` puis `href="&j;…"`) reconstituent un schéma ou une balise que le
    // décodage ci-dessous ne connaît pas — refusée entière, un DOCTYPE qui ne cite qu'une DTD externe reste permis
    if (/<!DOCTYPE[^>]*\[/i.test(content) || /<!ENTITY/i.test(content)) throw new Error(t('bundler.index.svg-script-refuse', { fichier: filename, motif: '<!DOCTYPE […]>' }))
    const normalized = decodeSvgEntities(content, filename)
    // schéma d'URL (javascript:/data:) — copie DÉDIÉE : un navigateur retire TAB/LF/CR d'une URL
    // avant d'en reconnaître le schéma (java\tscript: reste javascript: à ses yeux), mais faire ce
    // retrait sur TOUT le document collerait <rect\nonclick="x"> en <rectonclick="x"> et ferait
    // perdre la frontière que le test on*= ci-dessous exige.
    const urlNormalized = normalized.replace(/[\t\r\n]/g, '')
    // balise écrite avec un préfixe d'espace de noms (`<svg:script>`, `<x:iframe>`) : la même pour le navigateur
    if (/<(?:[\w.-]+:)?script[\s>/]/i.test(normalized)) throw new Error(t('bundler.index.svg-script-refuse', { fichier: filename, motif: '<script>' }))
    const onAttr = normalized.match(/\son[a-z]+\s*=/i)
    if (onAttr) throw new Error(t('bundler.index.svg-script-refuse', { fichier: filename, motif: onAttr[0].trim() }))
    if (/javascript:/i.test(urlNormalized)) throw new Error(t('bundler.index.svg-script-refuse', { fichier: filename, motif: 'javascript:' }))
    // data:text/html embarque un document HTML complet — data:image/* (icône encodée, usage
    // légitime courant) n'est JAMAIS concerné, seul le type MIME text/html est visé.
    if (/data:text\/html/i.test(urlNormalized)) throw new Error(t('bundler.index.svg-script-refuse', { fichier: filename, motif: 'data:text/html' }))
    if (/<(?:[\w.-]+:)?foreignObject[\s>/]/i.test(normalized)) throw new Error(t('bundler.index.svg-script-refuse', { fichier: filename, motif: '<foreignObject>' }))
    const embed = normalized.match(/<(?:[\w.-]+:)?(iframe|embed|object)[\s>/]/i)
    if (embed) throw new Error(t('bundler.index.svg-script-refuse', { fichier: filename, motif: `<${embed[1]}>` }))
    // SMIL — attributeName visant on…/href/xlink:href sur <set>/<animate>/<animateTransform>/
    // <animateMotion> : injection sans <script>/on*=/javascript: littéral. Non scopé au NOM de la
    // balise porteuse (attributeName n'existe que sur les tags SMIL en pratique) — plus simple,
    // au moins aussi sûr. d/opacity/transform/fill… ne matchent jamais, restent permis.
    const smil = normalized.match(/attributeName\s*=\s*["']\s*(on[a-z]+|xlink:href|href)\s*["']/i)
    if (smil) throw new Error(t('bundler.index.svg-script-refuse', { fichier: filename, motif: `attributeName="${smil[1]}"` }))
  }

  // --------------------------------------------------------------------------
  // placeholderPath(stem, ext) : chemin REPÈRE (cf. HASH_PLACEHOLDER, même longueur
  // qu'un vrai `writeHashed()`) — utilisé en phase A tant que le chemin final d'une unité
  // (cœur, feuille split, composant, module, manifeste externe) n'est pas encore connu.
  // --------------------------------------------------------------------------
  placeholderPath(stem: string, ext: string): string {
    return `${this.urlPrefix}/${stem}-${HASH_PLACEHOLDER}${ext}`
  }

  // un repère encore présent : sa forme COMPLÈTE (`<urlPrefix>/<stem>-ZZZZZ.js|.css`, celle que pose placeholderPath()
  // et que lit resolvePlaceholders()), jamais la seule suite `-ZZZZZ.` qu'un texte de l'auteur peut contenir
  // (« Format de clé : ABCDE-ZZZZZ. », un modèle d'URL `photo-ZZZZZ.jpg`)
  private hasUnresolvedPlaceholder(s: string): boolean {
    if (!s.includes(`-${HASH_PLACEHOLDER}.`)) return false
    return new RegExp(`${escapeRegex(this.urlPrefix)}/[^'"\\s]+?-${HASH_PLACEHOLDER}\\.(?:js|css)`).test(s)
  }

  // --------------------------------------------------------------------------
  // splitStyleStem(baseName) : nom de fichier d'une feuille NOMMÉE en mode css=
  // 'split'/'lazy' (`mjs_style_<safeVar>` ou, en cas de collision de normalisation,
  // `mjs_style_<safeVar>_<empreinte du nom d'origine>`) — SEULE définition, partagée par
  // `emitSplitStyles()`/`emitLazyStyles()` (chemin réel, cœur déjà connu) et par
  // `prependSplitCssImports()` (repère, phase A, cœur pas encore connu). `mjs_root` (feuille
  // racine, jamais déclarée par un composant) garde son propre stem constant
  // `'mjs_style_root'`, HORS de cette fonction (cf. les deux appelants) : une feuille nommée
  // `root` reçoit donc l'empreinte de son nom, sinon elle prenait le fichier de la feuille racine.
  // --------------------------------------------------------------------------
  private splitStyleStem(baseName: string): string {
    const safeVar = baseName.replace(/[^a-zA-Z0-9]/g, '_')
    return safeVar === baseName && baseName !== 'root' ? `mjs_style_${safeVar}` : `mjs_style_${safeVar}_${createHash('md5').update(baseName).digest('hex').slice(0, 4)}`
  }

  // --------------------------------------------------------------------------
  // withInlineSourceMap(code, map) : mode 'bundle' seulement — un fragment gardé en mémoire
  // (jamais écrit en `.js`+`.map` séparés, cf. bundleVirtualSources) porte sa carte de
  // source EN LIGNE (`data:` base64) pour qu'esbuild.build() la lise à l'assemblage final
  // (emitSingleFile()) et compose une carte UNIQUE `<manifeste>.map`. `map`/`shouldEmitSourceMap()`
  // absent → code inchangé (aucun octet de carte quand personne n'en a besoin).
  // --------------------------------------------------------------------------
  private withInlineSourceMap(code: string, map?: string): string {
    if (!map || !this.shouldEmitSourceMap()) return code
    const b64 = Buffer.from(map, 'utf-8').toString('base64')
    return `${code}\n//# sourceMappingURL=data:application/json;base64,${b64}\n`
  }

  // --------------------------------------------------------------------------
  // extractPlaceholderDeps(code) : stems dont CE code contient le repère
  // (`<urlPrefix>/<stem>-ZZZZZ.js|.css`) — calculé UNE FOIS par unité fraîchement compilée
  // (phase A), consommé par l'émission topologique de la phase C (compile()) : une unité ne
  // s'émet que lorsque TOUS ses deps ont un chemin final connu.
  // --------------------------------------------------------------------------
  private extractPlaceholderDeps(code: string): string[] {
    const re = new RegExp(`${escapeRegex(this.urlPrefix)}/([^'"\\s]+?)-${HASH_PLACEHOLDER}(?:\\.js|\\.css)`, 'g')
    const deps = new Set<string>()
    let m: RegExpExecArray | null
    while ((m = re.exec(code)) !== null) deps.add(m[1])
    return [...deps]
  }

  // --------------------------------------------------------------------------
  // resolvePlaceholders(code, finalPaths) : remplace CHAQUE repère de `code` par le
  // chemin final connu (`finalPaths`, indexé par stem) — remplacement TEXTUEL de longueur
  // ÉGALE (l'empreinte réelle fait, comme le repère, 5 caractères) : les cartes de source déjà
  // écrites restent justes colonne par colonne, aucune retouche. Un stem absent de
  // `finalPaths` (dep jamais résolu — cycle échappé, unité en échec) laisse le repère TEL
  // QUEL : le garde-fou de compile() (§ 3.15) le détecte et refuse l'écriture.
  // --------------------------------------------------------------------------
  private resolvePlaceholders(code: string, finalPaths: Map<string, string>): string {
    const re = new RegExp(`${escapeRegex(this.urlPrefix)}/([^'"\\s]+?)-${HASH_PLACEHOLDER}(\\.js|\\.css)`, 'g')
    return code.replace(re, (full, stem) => finalPaths.get(stem) ?? full)
  }

  // --------------------------------------------------------------------------
  // writeHashed() : écrit `<base>-<md5>.<ext>` dans outputDir, return path web.
  // Nettoie les anciennes versions du même base. Si `map` fourni, écrit aussi
  // le .map à côté et appende sourceMappingURL au .js.
  // --------------------------------------------------------------------------
  // l'empreinte courte d'un contenu (cf. fingerprint.ts) avec son md5 complet, pour reconnaître une collision ;
  // une méthode d'instance pour qu'un test puisse forcer le hachage
  fingerprintOf(content: string | Buffer): { court: string, complet: string } {
    const complet = createHash('md5').update(content).digest('hex')
    return { court: shortFingerprintFromHex(complet), complet }
  }

  // nom `<base>-<empreinte><ext>` d'un contenu ; refuse (erreur nommée) un nom déjà donné à un AUTRE contenu
  private hashedName(baseName: string, ext: string, content: string | Buffer): string {
    const { court, complet } = this.fingerprintOf(content)
    const filename = `${baseName}-${court}${ext}`
    const proprietaire = this.fingerprintOwners.get(filename)
    if (proprietaire !== undefined && proprietaire !== complet) throw new Error(t('bundler.index.collision-empreinte', { fichier: filename }))
    this.fingerprintOwners.set(filename, complet)
    return filename
  }

  writeHashed(baseName: string, ext: string, content: string, map?: string): string {
    // ceinture + bretelles : garde-fou générique, en plus de celui d'emitPendingUnits
    // (qui vérifie AVANT d'appeler writeHashed pour les unités topologiques) — AUCUN appelant
    // de writeHashed() ne doit jamais écrire un repère non résolu sur disque, y compris un
    // futur appelant qui oublierait sa propre vérification.
    if (this.hasUnresolvedPlaceholder(content)) {
      throw new Error(t('bundler.index.repere-non-resolu-ecriture', { fichier: `${baseName}${ext}` }))
    }
    // filet central : enregistre CHAQUE émission de ce compile (le hash
    // dérive du contenu → « hash identique » = contenu identique, jamais un
    // changement). Le verdict css-only compare à `lastWrittenHashes` en fin de
    // compile(). Aucun coût hors watch (cssOnlyTracking false).
    if (this.cssOnlyTracking) {
      const h = createHash('md5').update(content).digest('hex').slice(0, 8)
      this.cssOnlyWrites.set(`${baseName}${ext}`, h)
    }
    // garde-fou ESM (cf. assertValidEsm) — scope .js uniquement, avant tout
    // ajout de sourceMappingURL (les deux branches ci-dessous en profitent).
    if (ext === '.js') this.assertValidEsm(content, `${baseName}${ext}`)
    let finalContent = content
    if (map) {
      // Hash sur le contenu AVANT ajout du sourceMappingURL pour stabilité
      const filename = this.hashedName(baseName, ext, content)
      finalContent = `${content}\n//# sourceMappingURL=${filename}.map\n`
      const target = join(this.outputDir, filename)
      const mapTarget = `${target}.map`

      this.cleanupOldHashes(baseName, ext, [filename, `${filename}.map`])
      this.writeFileAtomic(target, finalContent)
      // le nom vient du code seul : des lignes déplacées dans le .mjs changent la carte, pas le nom
      this.writeIfChanged(mapTarget, map)
      this.emittedThisCompile.add(filename)
      return `${this.urlPrefix}/${filename}`
    }

    const filename = this.hashedName(baseName, ext, content)
    const target = join(this.outputDir, filename)

    this.cleanupOldHashes(baseName, ext, [filename])
    this.writeFileAtomic(target, content)
    this.emittedThisCompile.add(filename)
    return `${this.urlPrefix}/${filename}`
  }

  // --------------------------------------------------------------------------
  // resolveOneAsset(logicalPath) : résout UN asset logique en chemin web hashé.
  // - .coffee → compile via coffee adapter, écrit en .js
  // - .mjs    → délègue à compileMjs (component complet)
  // - autres  → copie raw avec hash sur le contenu (webp, png, etc.)
  // - missing → /MISSING_MJS_ASSET:logicalPath
  // Exposable comme callback à transpile() pour résolution PRE-compilation.
  // --------------------------------------------------------------------------
  // --------------------------------------------------------------------------
  // resolveOneImage(chemin, largeurs) : rend l'objet que `µimage(…)`
  // devient dans le code compilé.
  //
  //   { src, srcset, sizes, width, height }
  //
  // DEUX NIVEAUX, séparés à dessein (cf. bundler/image.ts) :
  //   • les DIMENSIONS natives sont lues dans l'en-tête du fichier, sans aucune
  //     dépendance — c'est elles qui suppriment le saut de mise en page, et elles
  //     marchent partout ;
  //   • les VARIANTES (plusieurs largeurs, formats modernes) exigent `sharp`,
  //     dépendance OPTIONNELLE. Absent : l'image d'origine passe telle quelle, un
  //     avertissement UNIQUE le dit, et le build n'échoue jamais pour autant.
  // --------------------------------------------------------------------------
  // variantesDe() : les variantes de `source` aux largeurs `voulues`, encodées une seule fois pour un même contenu (cf.
  // variantesMemo) ; un échec n'est pas gardé, l'appel suivant retente comme avant
  private variantesDe(source: string, bytes: Buffer, voulues: number[]): Promise<GeneratedVariant[] | null> {
    const cle       = `${source}\0${voulues.join(',')}\0${this.imageConfig.formats.join(',')}\0${this.imageConfig.quality}`
    const empreinte = createHash('md5').update(bytes).digest('hex')
    const connue    = this.variantesMemo.get(cle)
    if (connue && connue.empreinte === empreinte) return connue.variantes
    const variantes = generateVariants({ bytes, baseName: basename(source, extname(source)), widths: voulues, formats: this.imageConfig.formats, quality: this.imageConfig.quality })
    this.variantesMemo.set(cle, { empreinte, variantes })
    variantes.catch(() => {
      if (this.variantesMemo.get(cle)?.variantes === variantes) this.variantesMemo.delete(cle)
    })
    return variantes
  }

  async resolveOneImage(logicalPath: string, widths: number[] = []): Promise<Record<string, unknown>> {
    const src = await this.resolveOneAsset(logicalPath)
    const source = this.locateAsset(logicalPath)?.source ?? join(this.sourceDir, logicalPath)
    if (src.startsWith('/MISSING_MJS_ASSET') || !existsSync(source)) {
      return { src, srcset: '', sizes: '', width: null, height: null }
    }
    const bytes  = readFileSync(source)
    const taille = readImageSize(bytes)
    const base   = { src, srcset: '', sizes: '', width: taille?.width ?? null, height: taille?.height ?? null }

    // le SVG n'a rien à redimensionner : une seule ressource, qui s'adapte toute seule
    if (extname(source).toLowerCase() === '.svg') return base

    const voulues = (widths.length > 0 ? widths : this.imageConfig.widths)
      .filter(w => !taille || w <= taille.width)   // jamais d'agrandissement : une variante plus large que l'original n'apporte rien
      .sort((a, b) => a - b)
    if (voulues.length === 0) return base

    // sharp refuse une largeur non finie avec un message INTERNE brut (anglais, sans nommer
    // l'image) : un format non reconnu par `readImageSize` (`taille` = null) laisse passer
    // N'IMPORTE QUELLE largeur au filtre ci-dessus, `Infinity` compris (un `widths="…"` de
    // centaines de chiffres convertit en `Infinity` via `Number(...)`). Refus clair ICI, qui
    // NOMME l'image et la largeur, indépendant de toute garde faite ailleurs (`<@@img
    // widths="…">` a la sienne, côté transpiler — celle-ci tient seule).
    const infinie = voulues.find(w => !Number.isFinite(w))
    if (infinie !== undefined) {
      throw new Error(t('bundler.index.img-largeur-infinie', { chemin: logicalPath, valeur: String(infinie) }))
    }

    let variantes: Awaited<ReturnType<typeof generateVariants>>
    try {
      variantes = await this.variantesDe(source, bytes, voulues)
    } catch (e: any) {
      // une image animée est lue image par image, et sharp compte les pixels de TOUTES ses images : un GIF ou un WebP
      // animé trop lourd pour lui (souvent quelques octets sur un grand écran logique) est refusé. Le build ne s'arrête
      // pas pour autant : l'image garde son fichier d'origine, sans variante, comme un PNG ou un AVIF animé, et un
      // avertissement dit pourquoi, une fois par image (la limite de pixels, ou ce que sharp dit d'autre : image abîmée…)
      if (animatedKind(bytes)) {
        if (!this.animatedWarned.has(logicalPath)) {
          this.animatedWarned.add(logicalPath)
          // « trop de pixels » seulement quand sharp le dit ; sinon (image abîmée…) la vraie raison, sans l'affirmer à sa place
          const cle = /pixel limit/i.test(e?.message ?? '') ? 'bundler.index.image-animee-trop-grosse' : 'bundler.index.image-animee-illisible'
          this.lintBuildWarn('image', t(cle, { chemin: logicalPath, erreur: e?.message ?? String(e) }))
        }
        return base
      }
      // sharp peut échouer pour d'autres raisons qu'une largeur infinie (fichier corrompu,
      // combinaison largeur/format refusée) : jamais son message brut tout seul, toujours
      // nommer l'image concernée (cf. le message jumeau de generateVariants, qui nomme lui
      // largeur et format).
      throw new Error(t('bundler.index.img-variante-echec', { chemin: logicalPath, erreur: e?.message ?? String(e) }))
    }
    if (!variantes) {
      if (!this.sharpWarned) {
        this.sharpWarned = true
        this.lintBuildWarn('image', t('bundler.index.image-sharp-absent'))
      }
      return base
    }
    // aucune variante (une image animée que sharp ne réécrit pas) : l'image d'origine passe seule
    if (variantes.length === 0) return base
    for (const v of variantes) {
      this.writeFileAtomic(join(this.outputDir, v.filename), v.bytes)
      this.emittedThisCompile.add(v.filename)
      this.publishedAssets.get(source)?.variants.add(v.filename)
    }
    // le `srcset` liste les largeurs ; le navigateur choisit. `src` reste l'image
    // d'origine : c'est le repli d'un navigateur qui ne comprendrait pas `srcset`.
    // Nom ENCODÉ : une espace (`photo de vacances.jpg`) coupe l'adresse et le navigateur
    // rejette tout le `srcset` ; une virgule couperait la liste
    const srcset = variantes.map(v => `${this.urlPrefix}/${encodeURIComponent(v.filename)} ${v.width}w`).join(', ')
    return { ...base, srcset, sizes: '100vw' }
  }

  // --------------------------------------------------------------------------
  // assetDirs — où se cherche un fichier cité par `µasset`, `µimage` ou `<@@img>` : sourceDir d'abord, comme avant la clé,
  // puis chaque dossier de assetDirs, dans l'ordre. Ces dossiers ne portent que des fichiers copiés tels quels (images,
  // polices, sons…) ; du code (.mjs, .civet, .coffee, .js) se cherche sous sourceDir seul, où ses voisins, ses imports et
  // ses noms de module se résolvent. Chaque dossier garde ses chemins sous lui, comme sourceDir : un chemin qui en sort n'y
  // est pas cherché, un lien qui en sort fait échouer le build (cf. resolveOneAsset).
  // --------------------------------------------------------------------------
  // findInAssetDirs() : le premier dossier de assetDirs qui porte ce chemin, et le fichier trouvé ; `null` si aucun, si la
  // liste est vide ou si le chemin désigne du code
  private findInAssetDirs(logicalPath: string): { source: string; root: string } | null {
    if (this.assetDirs.length === 0 || ASSET_CODE_RE.test(logicalPath)) return null
    for (const root of this.assetDirs) {
      const source = join(root, logicalPath)
      const abs    = resolve(source)
      if (abs !== root && !abs.startsWith(root + sep)) continue
      try { if (statSync(source).isFile()) return { source, root } } catch { /* absent, ou lien cassé : pas ici */ }
    }
    return null
  }

  // locateAsset() : le fichier que resolveOneAsset publie pour ce chemin et le dossier qui le porte — sourceDir s'il l'a (le
  // même test que resolveOneAsset), sinon le premier dossier de assetDirs ; `null` quand rien ne le porte
  private locateAsset(logicalPath: string): { source: string; root: string } | null {
    const source  = join(this.sourceDir, logicalPath)
    const srcRoot = resolve(this.sourceDir)
    const abs     = resolve(source)
    if ((abs === srcRoot || abs.startsWith(srcRoot + sep)) && existsSync(source)) return { source, root: this.sourceDir }
    return this.findInAssetDirs(logicalPath)
  }

  // searchedDirs() : les dossiers fouillés pour ce chemin, dans l'ordre, pour un message d'introuvable — vide sans assetDirs
  // (le message d'avant, mot pour mot) et pour du code, qui ne se cherche que sous sourceDir
  private searchedDirs(logicalPath: string): string {
    if (this.assetDirs.length === 0 || ASSET_CODE_RE.test(logicalPath)) return ''
    return [this.sourceDir, ...this.assetDirs].join(', ')
  }

  // assetDep() : le chemin absolu que ce fichier cité entre dans les dépendances d'un composant (empreinte du cache,
  // recompilation en `mjs dev`) — celui que locateAsset retient ; sous sourceDir comme avant quand rien ne le porte, ou sans assetDirs
  private assetDep(logicalPath: string): string {
    if (this.assetDirs.length === 0) return resolve(this.sourceDir, logicalPath)
    return this.locateAsset(logicalPath)?.source ?? resolve(this.sourceDir, logicalPath)
  }

  // assetTwins() : ce fichier et le même chemin logique sous chaque dossier d'images (sourceDir, puis assetDirs) — une image
  // ajoutée, modifiée ou retirée dans l'un concerne les composants qui l'ont résolue dans un autre (la priorité peut changer)
  private assetTwins(file: string): string[] {
    if (this.assetDirs.length === 0) return [file]
    const roots = [this.sourceDir, ...this.assetDirs]
    const twins = new Set<string>([file])
    for (const home of roots) {
      if (!file.startsWith(home + sep)) continue
      const rel = relative(home, file)
      for (const root of roots) twins.add(join(root, rel))
    }
    return [...twins]
  }

  // noteShadowedAssets() : `gagnant` est le fichier retenu pour ce chemin ; le même chemin dans un autre dossier (sourceDir ou
  // assetDirs) est écarté, et le build avertit en nommant les deux fichiers, une fois par couple et par tour. Le même fichier
  // vu par deux dossiers (un lien, un dossier dans un autre) n'est pas un doublon.
  private noteShadowedAssets(logicalPath: string, gagnant: string): void {
    if (this.assetDirs.length === 0 || ASSET_CODE_RE.test(logicalPath)) return
    let retenu: string
    try { retenu = realpathSync(gagnant) } catch { return }
    for (const root of [this.sourceDir, ...this.assetDirs]) {
      const autre = join(root, logicalPath)
      const abs   = resolve(autre)
      if (abs !== root && !abs.startsWith(root + sep)) continue
      let reel: string
      try {
        if (!statSync(autre).isFile()) continue
        reel = realpathSync(autre)
      } catch { continue }
      if (reel === retenu) continue
      const couple = `${gagnant}\0${autre}`
      if (this.assetShadowsSeen.has(couple)) continue
      this.assetShadowsSeen.add(couple)
      this.lintPush(this.pendingAssetWarnings, 'image', t('bundler.index.asset-doublon', { chemin: logicalPath, retenu: gagnant, ecarte: autre }))
    }
  }

  async resolveOneAsset(logicalPath: string): Promise<string> {
    let source = join(this.sourceDir, logicalPath)
    // le dossier qui porte le fichier : sourceDir, ou un dossier de assetDirs quand sourceDir ne l'a pas (cf. findInAssetDirs)
    let root   = this.sourceDir
    // FAILLE — path traversal :
    // `µasset('../../etc/passwd')` (ou `#= require ../../…`) résolvait HORS
    // sourceDir puis COPIAIT le fichier ciblé dans outputDir (exfiltration si
    // les sources ne sont pas 100% de confiance). Confinement strict : le
    // chemin résolu doit rester SOUS sourceDir — sinon « asset introuvable ».
    const srcRoot = resolve(this.sourceDir)
    const abs     = resolve(source)
    const inside  = abs === srcRoot || abs.startsWith(srcRoot + sep)
    // Special-case `mjs_core.js` AVANT le check d'existence : le runtime
    // est hashé séparément dans outputDir, il n'a pas de fichier source dans
    // sourceDir → existsSync renverrait false et on émettrait MISSING_MJS_ASSET.
    // `this.coreHashedPath` est encore vide en phase A (le cœur se décide APRÈS les
    // composants) : rend le REPÈRE, résolu en chemin réel en phase C (cf. compile()).
    if (inside && basename(source) === 'mjs_core.js') {
      return this.coreHashedPath || this.placeholderPath('mjs_core', '.js')
    }
    if (!inside || !existsSync(source)) {
      // sourceDir ne porte pas ce chemin : le premier dossier de assetDirs qui le porte (jamais du code) ; aucun, introuvable
      const other = this.findInAssetDirs(logicalPath)
      if (!other) return `/MISSING_MJS_ASSET:${logicalPath}`
      source = other.source
      root   = other.root
    }

    // Confinement RÉEL, en plus du contrôle LEXICAL ci-dessus :
    // celui-ci ne résout jamais un symlink — un lien posé DANS sourceDir et pointant HORS de
    // sourceDir passe le test textuel (le chemin écrit reste sous sourceDir) puis son contenu
    // RÉEL (hors projet) est lu/copié tel quel. realpathSync suit le lien jusqu'à sa cible ;
    // hors du realpath de sourceDir → build en échec, jamais une copie silencieuse.
    // Même garde pour le dossier de assetDirs qui porte le fichier.
    const realSource  = realpathSync(source)
    const realSrcRoot = realpathSync(root)
    if (realSource !== realSrcRoot && !realSource.startsWith(realSrcRoot + sep)) {
      throw new Error(t('bundler.index.symlink-hors-racine', { lien: source, cible: realSource, racine: root === this.sourceDir ? undefined : 'assetDirs' }))
    }
    // assetDirs : le même chemin dans un autre dossier est écarté, et dit
    this.noteShadowedAssets(logicalPath, source)

    const ext = extname(source)
    if (ext === '.civet')  return await this.compileScriptModule(source, '.civet')
    if (ext === '.coffee') return await this.compileScriptModule(source, '.coffee')
    if (ext === '.mjs')    return await this.compileMjs(source)

    // Binaires (webp/png/etc.) : copie raw avec hash
    const baseName = basename(source, ext)
    const fileBytes = readFileSync(source)
    // garde-fou ESM sur les assets .js bruts (cf.
    // assertParsableJs) — AVANT toute écriture/cleanup, même placement que
    // assertValidEsm en tête de writeHashed(). Scope .js uniquement : les
    // autres binaires ne sont jamais décodés en texte.
    if (ext.toLowerCase() === '.js') this.assertParsableJs(fileBytes.toString('utf-8'), `${baseName}${ext}`, source)
    // Même hygiène, scope .svg : un SVG copié tel quel est servi depuis
    // la MÊME origine que le reste du site — un <script>/on*=/javascript: embarqué s'exécute au
    // chargement direct de l'URL (ou via <object>/<iframe>). AVANT toute écriture, refus nommé.
    if (ext.toLowerCase() === '.svg') this.assertSafeSvg(fileBytes.toString('utf-8'), `${baseName}${ext}`)
    // .js : imports relatifs réécrits vers les noms publiés de ses voisins, AVANT l'empreinte
    const bytes = ext.toLowerCase() === '.js' ? this.rewriteRelativeJsImports(logicalPath, fileBytes, [], new Map()) : fileBytes
    const hash = createHash('md5').update(bytes).digest('hex').slice(0, 8)
    const filename = `${baseName}-${hash}${ext}`
    const target = join(this.outputDir, filename)
    // Même correctif que writeHashed()
    // (cf. son commentaire) : écriture atomique, sinon un crash à mi-écriture
    // laisserait un asset binaire TRONQUÉ jamais réparé par les builds
    // suivants (existsSync le trouve « déjà là »).
    //
    // Cf. le commentaire détaillé de
    // `cleanupOldHashes` : contrairement à `writeHashed` (JS compilé), cette
    // copie binaire ne nettoyait JAMAIS les anciennes versions du même
    // basename — un asset réédité au fil du temps (logo.png changé 50 fois)
    // laissait 50 fichiers `logo-<hash>.png` s'accumuler indéfiniment.
    this.cleanupOldHashes(baseName, ext, [filename])
    this.writeFileAtomic(target, bytes)
    this.emittedThisCompile.add(filename) // Équivalent raw de writeHashed() (peut émettre du .js, ex. vendor copié tel quel)
    this.notePublished(source, filename)
    return `${this.urlPrefix}/${filename}`
  }

  // --------------------------------------------------------------------------
  // rewriteRelativeJsImports : un .js copié tel quel qui importe un voisin par chemin relatif
  // (`import … from './rng.js'`, `export … from`, import nu, `import('./x.js')`) le chercherait sous
  // son nom source dans outputDir, où le voisin n'existe que sous son nom à empreinte : 404 à
  // l'exécution ; chaque voisin présent sous sourceDir est donc publié (publishJsNeighbor) et le
  // chemin réécrit vers `./<nom publié>`, tout étant à plat dans outputDir
  // laissés tels quels : voisin absent, hors sourceDir, compilé (.civet/.coffee/.mjs) ; aucun import
  // réécrit → octets d'origine rendus tels quels
  // `chain` : fichiers .js au-dessus de celui-ci (cycle) ; `published` : voisins déjà publiés pour
  // ce fichier racine, chacun traité une fois (un arbre de modules partagés, lodash-es, compte
  // bien plus de chemins que de fichiers)
  // --------------------------------------------------------------------------
  private rewriteRelativeJsImports(logicalPath: string, bytes: Buffer, chain: string[], published: Map<string, string | null>): Buffer {
    const code  = bytes.toString('utf-8')
    const specs = this.importsOfJs(join(this.sourceDir, logicalPath), code)
    if (specs.length === 0) return bytes
    const here  = posix.normalize(logicalPath)
    let out     = ''
    let cursor  = 0
    let changed = false
    for (const s of specs) {
      const filename = this.publishJsNeighbor(posix.join(posix.dirname(here), s.value), [...chain, here], published)
      // un nom qui fermerait la chaîne JS (guillemet, antislash, fin de ligne) n'est jamais injecté
      if (filename === null || /['"\\\n\r]/.test(filename)) continue
      const quote = code[s.start]
      out    += code.slice(cursor, s.start) + quote +'./'+ filename + quote
      cursor  = s.end
      changed = true
    }
    return changed ? Buffer.from(out + code.slice(cursor), 'utf-8') : bytes
  }

  // publishJsNeighbor : publie UN voisin importé par un .js copié, avec les gardes de resolveOneAsset
  // (confinement lexical puis réel, .js lisible, SVG sûr), ses propres imports relatifs réécrits
  // d'abord ; rend le nom publié, `null` quand l'import doit rester tel quel
  // cycle (a.js → b.js → a.js) : erreur de build, une empreinte de contenu ne peut pas nommer deux
  // fichiers qui se citent l'un l'autre
  private publishJsNeighbor(logicalPath: string, chain: string[], published: Map<string, string | null>): string | null {
    if (chain.includes(logicalPath)) throw new Error(t('bundler.index.cycle-import-js-copies', { chaine: [...chain, logicalPath].join(' → ') }))
    const known = published.get(logicalPath)
    if (known !== undefined) return known
    const filename = this.publishJsNeighborOnce(logicalPath, chain, published)
    published.set(logicalPath, filename)
    return filename
  }

  private publishJsNeighborOnce(logicalPath: string, chain: string[], published: Map<string, string | null>): string | null {
    const source  = join(this.sourceDir, logicalPath)
    const srcRoot = resolve(this.sourceDir)
    const abs     = resolve(source)
    if (abs !== srcRoot && !abs.startsWith(srcRoot + sep)) return null
    if (!existsSync(source) || !statSync(source).isFile()) return null
    const ext = extname(source)
    if (ext === '.civet' || ext === '.coffee' || ext === '.mjs' || basename(source) === 'mjs_core.js') return null
    const realSource  = realpathSync(source)
    const realSrcRoot = realpathSync(this.sourceDir)
    if (realSource !== realSrcRoot && !realSource.startsWith(realSrcRoot + sep)) {
      throw new Error(t('bundler.index.symlink-hors-racine', { lien: source, cible: realSource }))
    }
    const baseName  = basename(source, ext)
    const fileBytes = readFileSync(source)
    if (ext.toLowerCase() === '.js') this.assertParsableJs(fileBytes.toString('utf-8'), `${baseName}${ext}`, source)
    if (ext.toLowerCase() === '.svg') this.assertSafeSvg(fileBytes.toString('utf-8'), `${baseName}${ext}`)
    const bytes    = ext.toLowerCase() === '.js' ? this.rewriteRelativeJsImports(logicalPath, fileBytes, chain, published) : fileBytes
    const filename = `${baseName}-${createHash('md5').update(bytes).digest('hex').slice(0, 8)}${ext}`
    this.cleanupOldHashes(baseName, ext, [filename])
    this.writeFileAtomic(join(this.outputDir, filename), bytes)
    this.emittedThisCompile.add(filename)
    this.notePublished(source, filename)
    return filename
  }

  // resolveMagicAssets : applique resolveOneAsset sur tous les `µasset(...)` /
  // `µ.asset(...)` / `mjsasset(...)` / `mjs.asset(...)` d'un texte. Reste
  // utile en post-compilation pour les patterns générés (template, mjs_core).
  // Même élargissement que
  // preResolveAssets (cf. son commentaire) : reconnaît désormais aussi la
  // forme `mjs.asset(...)` (sigil alternatif), pas seulement `µ`. `sources` : l'appelant qui suit ce que le texte cite
  // comme dépendances y reçoit le chemin ABSOLU de chaque source résolue (cf. assetSources de preResolveAssets).
  async resolveMagicAssets(content: string, sources?: Set<string>): Promise<string> {
    // un `µasset(...)` cité en simple EXEMPLE dans un gabarit compilé en chaîne
    // (`export helpText = \`...µasset('x')...\``, doc/tuto d'un module) ne doit jamais être
    // résolu : sur la vue masquée (chaînes/gabarits/commentaires blanchis, même longueur), seul
    // le jeton de tête d'un VRAI appel reste visible tel quel — celui d'un exemple, avalé par le
    // gabarit qui l'entoure, disparaît avec le reste (blanchi). La forme à guillemet EXTÉRIEUR
    // (`"µasset('…')"`, émise par le compilateur lui-même pour `@import`) reste TOUJOURS résolue
    // sans cette garde : ce motif n'est jamais un texte d'exemple, et ses propres guillemets se
    // font eux aussi blanchir en bloc (rien à distinguer dessus).
    const masked  = maskInertSameLength(content)
    const matches = [...content.matchAll(ASSET_RE)].filter(m => m[1] !== '' || masked[m.index!] === content[m.index!])
    let result = content
    if (matches.length > 0) {
      // PERF — dédup par logicalPath :
      // resolveOneAsset (I/O disque + copie hashée) UNE seule fois par chemin,
      // pas une fois par occurrence.
      const uniquePaths = [...new Set(matches.map((m) => m[4]))]
      if (sources) for (const lp of uniquePaths) sources.add(this.assetDep(lp))
      const webPaths = new Map<string, string>()
      await Promise.all(uniquePaths.map(async (lp) => {
        webPaths.set(lp, await this.resolveOneAsset(lp))
      }))
      // Remplacement par POSITION (jamais un `.replace(ASSET_RE, fn)` global sur tout
      // `content` : il retrouverait aussi les occurrences filtrées ci-dessus) — un seul
      // passage, la valeur est CONCATÉNÉE (jamais passée à `.replace()`) : aucune
      // interprétation des patterns spéciaux (`$&`, `$1`, `` $` ``, `$'`, `$$`) qu'un
      // `webPath` contenant `$` (urlPrefix/outputDir inhabituel) pourrait sinon injecter.
      let out    = ''
      let cursor = 0
      for (const m of matches) {
        const [outerQuote, bs, innerQuote, logicalPath] = [m[1], m[2], m[3], m[4]]
        const webPath = webPaths.get(logicalPath)!
        out    += content.slice(cursor, m.index)
        // Guillemet EXTÉRIEUR présent (`"µasset('…')"` entier) → remplace TOUT
        // (guillemets externes inclus), comme avant. Sinon → ré-échappe le
        // webPath avec le MÊME guillemet/backslash que la source (cf.
        // commentaire de ASSET_RE ci-dessus).
        out    += outerQuote ? `${outerQuote}${webPath}${outerQuote}` : `${bs}${innerQuote}${webPath}${bs}${innerQuote}`
        cursor  = m.index! + m[0].length
      }
      result = out + content.slice(cursor)
    }
    // Motif dominant de ce genre de bogue :
    // « erreur avalée → build vert ». Un placeholder `/MISSING_MJS_ASSET:xxx`
    // qui survit JUSQU'ICI (dernier point de passage avant minify+écriture,
    // pour les 2 call-sites de cette fonction) signifie qu'un asset référencé
    // dans le code n'a JAMAIS pu être résolu — jusqu'ici, ce placeholder
    // partait tel quel dans le fichier écrit sur disque, SANS AUCUNE erreur
    // ni warning : un lien/image cassé en prod, découvert seulement par un
    // utilisateur qui clique dessus. Une compilation ne doit JAMAIS réussir
    // avec un asset non résolu — on throw pour que l'appelant (_compileMjsInner
    // / _compileScriptModuleInner) le remonte dans stats.errors.
    // Un `µasset('chemin')` AFFICHÉ en EXEMPLE dans un `<pre>`/`<code>` de doc/tuto reste
    // maintenant verbatim (filtré ci-dessus par le masquage, jamais résolu ni transformé en
    // placeholder) : le masquage `<pre>`/`<code>` ci-dessous protège désormais surtout le
    // jumeau côté transpiler (`replaceMagicAssets`, hors périmètre ici), qui peut encore
    // laisser fuir un `MISSING_MJS_ASSET` dans un bloc de doc à un stade antérieur du pipeline.
    // Un vrai asset manquant HORS `<pre>` reste, lui, fatal.
    const stillMissing = maskCodeBlocks(result).match(/\/MISSING_MJS_ASSET:([^\s'"]+)/)
    if (stillMissing) {
      throw new Error(t('bundler.index.asset-introuvable', { chemin: stillMissing[1], dossiers: this.searchedDirs(stillMissing[1]) }))
    }
    return result
  }

  // --------------------------------------------------------------------------
  // prepareExternalManifest() (ex-bundleExternalManifest) : lit le manifest externe
  // (directives `#= require` / `#= require_dir` / `#= require_tree`, dédupe (require_once),
  // compile .coffee/.civet en JS, concatène) — PHASE A (cœur encore inconnu, en-tête `import
  // { µ } from '<REPÈRE du cœur>';`). No-op (aucune unité, `manifest['__external'] = ''`) si
  // le fichier manifest est absent ou ne contient que du contenu vide. Sinon, part en attente
  // d'émission topologique (phase C, cf. compile()) — jamais de cache pour cette unité
  // (comportement identique à avant : recompilée en entier à CHAQUE compile()).
  // --------------------------------------------------------------------------
  async prepareExternalManifest(): Promise<void> {
    this.manifest['__external'] = ''
    // Même si le manifest externe est
    // absent, `externalManifestDeps` doit refléter "plus aucune dep" (sinon
    // un `watch()` qui a déjà ajouté d'anciens chemins au watcher continue
    // de les surveiller pour rien après suppression du manifest externe).
    if (!existsSync(this.manifestExternal)) { this.externalManifestDeps = new Set(); return }

    const visited = new Set<string>()
    const buffer: string[] = []
    await this._processManifestNode(this.manifestExternal, visited, buffer, true)
    // Capturé AVANT le early-return "buffer vide" ci-dessous : `visited`
    // inclut déjà le manifest externe lui-même (et ses require transitifs)
    // même si son contenu ne produit finalement aucun code (tout commenté,
    // etc.) — `watch()` doit quand même le surveiller pour détecter un futur
    // ajout de contenu.
    this.externalManifestDeps = visited
    if (buffer.length === 0) return

    // Le bundle s'exécute en module ES → on importe `µ` explicitement
    // (sinon les imports ne sont pas hoistés et le code ne voit que globalThis.µ). 
    // repère du cœur (pas encore connu en phase A), résolu en phase C.
    const header = `import { µ } from '${this.placeholderPath('mjs_core', '.js')}';`
    const concatenated = [header, ...buffer].join('\n')
    const features = [...scanCompiledFeatures(concatenated)]
    for (const f of features) this.pendingFeatures.add(f)
    // symboles du CONTRAT — jumeau de compileMjsCold (cf. core-contract.ts). Le manifeste externe
    // n'a pas d'entrée de cache : rien à réinjecter ailleurs, il est reconstruit à chaque tour.
    for (const c of collectCoreCalls(concatenated)) this.pendingCoreCalls.add(c)
    // sur le code NON MINIFIÉ (cf. bandeau de compileMjsCold) — pas besoin d'attendre la
    // minification différée plus bas.
    const deps = this.extractPlaceholderDeps(concatenated)
    this.manifest['__external'] = this.placeholderPath('mjs_external', '.js')
    // Minification DIFFÉRÉE (cf. bandeau de `pendingMinifyTasks` sur compileMjsCold), noms
    // d'instance relevés sur le code NON MINIFIÉ comme pour toute unité — jamais en cache, ils
    // sont relevés à chaque tour.
    this.pendingMinifyTasks.push({
      stem: 'mjs_external',
      names: this.shouldMinify() ? collectInstanceNames(concatenated) : [],
      run: async () => {
        const minified = await minifyJs(concatenated, {
          force: this.shouldMinify(),
          filename: 'mjs_external.js',
          mangleCache: this.mangleCache,
          logLevel: this.prodLogLevel(),
          dev: !this.isProd(),
        })
        this.pendingUnits.set('mjs_external', { kind: 'cold', file: this.manifestExternal, stem: 'mjs_external', ext: '.js', code: minified.code, deps, features })
      },
    })
  }

  private async _processManifestNode(
    filePath: string,
    visited: Set<string>,
    buffer: string[],
    isManifestRoot: boolean,
  ): Promise<void> {
    if (!existsSync(filePath)) return
    // chemin RÉEL : le même fichier vu par deux chemins (lien) n'est lu qu'une fois
    const real = realpathSync(filePath)
    if (visited.has(real)) return
    visited.add(real)

    const ext = extname(real)
    const content = readFileSync(real, 'utf-8')
    const fromDir = dirname(real)

    const codeLines: string[] = []
    const deps: string[] = []

    for (const line of content.split('\n')) {
      let m: RegExpMatchArray | null
      if ((m = line.match(/^\s*#=\s*require\s+(.+?)\s*$/))) {
        deps.push(...this._confineManifestDeps(this._resolveRequire(m[1], fromDir), line, real))
      } else if ((m = line.match(/^\s*#=\s*require_dir\s+(.+?)\s*$/))) {
        deps.push(...this._confineManifestDeps(this._resolveRequireDir(m[1], fromDir, false), line, real))
      } else if ((m = line.match(/^\s*#=\s*require_tree\s+(.+?)\s*$/))) {
        deps.push(...this._confineManifestDeps(this._resolveRequireDir(m[1], fromDir, true), line, real))
      } else {
        codeLines.push(line)
      }
    }

    // Dépendances d'abord (ordre topologique)
    for (const dep of deps) {
      await this._processManifestNode(dep, visited, buffer, false)
    }

    // Code restant de CE fichier (les directives ont été stripées)
    const code = codeLines.join('\n').trim()
    if (code === '') return

    // Si c'est le manifest racine et qu'il n'y a que des directives, le code
    // restant est typiquement vide → skip. Sinon on compile selon l'extension.
    // même remarque qu'au chemin des modules autonomes : seul `code` sert ici, ces fichiers étant
    // concaténés dans un buffer commun où aucune carte individuelle n'aurait de sens
    let js: string = code
    if (ext === '.coffee') {
      const adapter = getAdapter('coffee')
      js = (await adapter.compileToJs(code, { fileName: real })).code
    } else if (ext === '.civet') {
      const adapter = getAdapter('civet')
      js = (await adapter.compileToJs(code, { fileName: real })).code
      // constante `:=` réaffectée : même refus que pour un module `.civet` autonome
      const constante = findConstReassignment(js)
      if (constante) throw new Error(t('bundler.index.civet-reaffectation-constante', { fichier: real, nom: constante.name, ligne: constante.line }))
    } else if (ext === '.ts') {
      const adapter = getAdapter('ts')
      js = (await adapter.compileToJs(code, { fileName: real })).code
    }
    // .js : tel quel
    const label = isManifestRoot ? '(manifest)' : real.split('/').slice(-3).join('/')
    buffer.push(`// === ${label} ===\n${js}`)
  }

  private _resolveRequire(spec: string, fromDir: string): string[] {
    const cleaned = spec.replace(/^['"]|['"]$/g, '').trim()
    const candidates: string[] = []
    if (extname(cleaned)) {
      candidates.push(resolve(fromDir, cleaned))
    } else {
      for (const e of ['.js', '.coffee', '.civet', '.ts']) {
        candidates.push(resolve(fromDir, cleaned + e))
      }
    }
    for (const c of candidates) {
      if (existsSync(c)) return [c]
    }
    this.lintBuildWarn('require', t('bundler.index.require-introuvable', { spec, dossier: fromDir }))
    return []
  }

  private _resolveRequireDir(spec: string, fromDir: string, recursive: boolean): string[] {
    const cleaned = spec.replace(/^['"]|['"]$/g, '').trim()
    const dirPath = resolve(fromDir, cleaned)
    if (!existsSync(dirPath)) {
      this.lintBuildWarn('require', t('bundler.index.require-dir-introuvable', { spec, dossier: fromDir }))
      return []
    }
    const exts = ['.js', '.coffee', '.civet', '.ts']
    return this._listFiles(dirPath, exts, recursive).sort()
  }

  // racines du projet : le dossier de mjs.config.json (cf. projectDir), le dossier parent de sourceDir et celui du manifeste externe
  private projectRoots(): string[] {
    return [this.projectDir, dirname(this.sourceDir), dirname(this.manifestExternal)]
  }

  // _confineManifestDeps() : un fichier lu par le manifeste externe reste DANS le projet — sous une de ses racines (dossier de
  // mjs.config.json, même quand la commande est lancée d'un sous-dossier ; dossier parent de sourceDir ; dossier du manifeste).
  // Viser hors de sourceDir est voulu (vendor/, lib/),
  // hors du projet non : `#= require ../../…` lisait sinon n'importe quel fichier de la machine et le publiait en clair. Chemin
  // RÉEL : un lien posé dans le projet qui pointe dehors est refusé de même
  private _confineManifestDeps(deps: string[], line: string, manifestFile: string): string[] {
    const racines = [...new Set(this.projectRoots().filter(r => existsSync(r)).map(r => realpathSync(r)))]
    for (const dep of deps) {
      const real = realpathSync(dep)
      if (!racines.some(r => real === r || real.startsWith(r + sep))) {
        throw new Error(t('bundler.index.require-hors-projet', { directive: line.trim(), fichier: manifestFile, cible: real }))
      }
    }
    return deps
  }

  // dossiers RÉELS déjà parcourus : un lien vers soi-même ou vers un parent (arborescences pnpm, liens de travail) redescendait
  // sinon jusqu'à la limite du système (ELOOP après plusieurs secondes) — même garde que findFiles(). Entrée cassée : sautée
  private _listFiles(dir: string, exts: string[], recursive: boolean, seenRealDirs: Set<string> = new Set()): string[] {
    if (!existsSync(dir)) return []
    let realDir: string
    try {
      realDir = realpathSync(dir)
    } catch {
      return []
    }
    if (seenRealDirs.has(realDir)) return []
    seenRealDirs.add(realDir)
    const out: string[] = []
    const entries = readdirSync(dir)
    for (const entry of entries) {
      const p = join(dir, entry)
      let st
      try {
        st = statSync(p)
      } catch {
        continue
      }
      if (st.isDirectory()) {
        if (recursive) out.push(...this._listFiles(p, exts, true, seenRealDirs))
      } else if (exts.includes(extname(p))) {
        out.push(p)
      }
    }
    return out
  }

  // --------------------------------------------------------------------------
  // i18n façon Rails. Scanne `sourceDir/i18n/` :
  //   - fichiers racine <langue>.yml|.yaml|.json  → `root[langue]` (embarqué
  //     dans le manifeste, en clair) ;
  //   - sous-dossiers <langue>/<section>.yml|.yaml|.json → émis en JSON
  //     compact dans `outputDir/i18n/<langue>/<nom>.json` (fetchés par le
  //     runtime au 1er montage), `sections[langue][section]` = chemin public.
  // Contrat FIGÉ avec `mjs_i18n.ts` (runtime) : cf. `I18nManifestData`.
  // --------------------------------------------------------------------------

  /** Charge paresseusement le parseur YAML — le paquet `yaml` est une
   *  peerDependency OPTIONNELLE (cf. package.json) : un projet 100% `.json`
   *  ne le require jamais. Mémoïse le résultat (une seule tentative de
   *  require par process). Erreur de build explicite si le paquet est
   *  absent du node_modules de l'utilisateur. */
  private _loadYamlParser(path: string): (raw: string) => any {
    if (this._yamlParser) return this._yamlParser
    try {
      this._yamlParser = createRequire(import.meta.url)('yaml').parse
    } catch {
      const rel = relative(this.sourceDir, path)
      throw new Error(t('bundler.index.i18n-yaml-manquant', { fichier: rel }))
    }
    return this._yamlParser!
  }

  // --------------------------------------------------------------------------
  // assertRealUnder() : MÊME confinement RÉEL que
  // findFiles()/resolveOneAsset() (realpathSync, pas seulement lexical), factorisé ICI pour ses
  // deux nouveaux appelants (parseI18nFile, bundleSharedStyles/emitSplitStyles/emitLazyStyles) —
  // ceux-là énumèrent un dossier FIXE (i18nDir, stylesheetsDir) par readdirSync : le chemin
  // TEXTUEL de chaque entrée est déjà confiné par construction, seul un symlink posé DANS ce
  // dossier peut évader — au REALPATH. `root` est le dossier RÉELLEMENT scanné (i18nDir pour
  // l'i18n, stylesheetsDir pour les feuilles — jamais sourceDir en dur : stylesheetsDir peut être
  // configuré HORS de sourceDir, cf. BundlerOpts.stylesheetsDir, auquel cas c'est LUI la racine de
  // confinement légitime, comme findFiles(dir, …) confine à SON `dir`, jamais à sourceDir).
  // --------------------------------------------------------------------------
  private assertRealUnder(path: string, root: string): void {
    // Lien PENDANT (cible absente) :
    // realpathSync lève un ENOENT Node BRUT, jamais catalogué avant — le confinement ne se
    // prouve que si la cible EXISTE, sinon message nommant le lien fautif.
    let realPath: string
    try {
      realPath = realpathSync(path)
    } catch (e: any) {
      if (e && e.code === 'ENOENT') throw new Error(t('bundler.index.symlink-pendant', { lien: path }))
      throw e
    }
    const realRoot = realpathSync(root)
    if (realPath !== realRoot && !realPath.startsWith(realRoot + sep)) {
      throw new Error(t('bundler.index.symlink-hors-racine', { lien: path, cible: realPath }))
    }
  }

  /** Parse un fichier i18n (`.yml`/`.yaml` via le paquet `yaml`, `.json` via
   *  `JSON.parse`) — erreur claire (fichier + cause) si invalide. */
  private parseI18nFile(path: string): any {
    // sourceDir/i18n/<x> (racine ET fragments) est énuméré par readdirSync
    // (scanI18n), mais rien n'empêchait un symlink DANS ce dossier de pointer HORS de sourceDir —
    // son contenu réel était lu et publié en clair (bundle.js pour la racine, JSON émis dans
    // outputDir/i18n/<langue>/ pour un fragment de section).
    // Confinement à i18nDir (sourceDir/i18n), PAS sourceDir entier (le
    // commentaire d'assertRealUnder promet déjà i18nDir comme racine légitime pour cet appelant) :
    // un lien posé DANS i18n/ mais pointant vers un AUTRE fichier de sourceDir (hors i18n/)
    // passait ce garde à tort, accepté comme traduction légitime.
    this.assertRealUnder(path, join(this.sourceDir, 'i18n'))
    const raw = readFileSync(path, 'utf-8')
    const ext = extname(path)
    let data: any
    if (ext === '.json') {
      try {
        data = JSON.parse(raw)
      } catch (e: any) {
        throw new Error(t('bundler.index.i18n-fichier-invalide', { chemin: path, erreur: e.message ?? e }))
      }
    }
    else {
      const parseYaml = this._loadYamlParser(path)
      try {
        data = parseYaml(raw)
      } catch (e: any) {
        throw new Error(t('bundler.index.i18n-fichier-invalide', { chemin: path, erreur: e.message ?? e }))
      }
      // YAML vide (ou commentaires seuls) : dictionnaire vide, comme avant
      if (data === null || data === undefined) data = {}
    }
    // un dictionnaire, rien d'autre : un `null` JSON, une liste ou un scalaire tombaient plus loin sur un TypeError sans nom de fichier
    if (data === null || typeof data !== 'object' || Array.isArray(data)) {
      throw new Error(t('bundler.index.i18n-fichier-invalide', { chemin: path, erreur: t('bundler.index.i18n-pas-un-dictionnaire') }))
    }
    return data
  }

  /** Sérialisation CANONIQUE d'une valeur i18n analysée — clés d'objet triées
   *  RÉCURSIVEMENT avant `JSON.stringify` : deux dictionnaires qui disent la même
   *  chose en YAML et en JSON, ou dans un ordre de clés différent, tombent sur la
   *  MÊME chaîne. Seul un changement de TEXTE la fait bouger. */
  private canonicalizeI18n(value: any): any {
    if (Array.isArray(value)) return value.map(v => this.canonicalizeI18n(v))
    if (value !== null && typeof value === 'object') {
      const out: Record<string, any> = {}
      for (const k of Object.keys(value).sort()) out[k] = this.canonicalizeI18n(value[k])
      return out
    }
    return value
  }

  /** Empreinte d'un dictionnaire i18n source : 12 hex du MD5 de sa sérialisation
   *  canonique (cf. `canonicalizeI18n`) — c'est la valeur attendue dans `__source`
   *  côté traduction (contrôle d'empreinte, `i18n.source`). */
  private fingerprintI18n(data: any): string {
    return createHash('md5').update(JSON.stringify(this.canonicalizeI18n(data))).digest('hex').slice(0, 12)
  }

  /**
   * scanI18n() : peuple `this.i18nManifestData` (undefined si `sourceDir/i18n/`
   * est absent — aucune clé i18n émise, zéro octet pour les apps sans i18n).
   * `sourceDir/i18n/` présent SANS `i18n.default` (mjs.config.json) → erreur de
   * build explicite. `i18n` configuré SANS `sourceDir/i18n/` → warning non
   * bloquant (retourné, pas lancé). Nom de section invalide ou YAML/JSON
   * invalide → erreur de build claire (fichier + cause).
   */
  scanI18n(): { warnings: string[] } {
    const warnings: string[] = []
    const i18nDir = join(this.sourceDir, 'i18n')
    const dirExists = existsSync(i18nDir) && statSync(i18nDir).isDirectory()

    if (!dirExists) {
      this.i18nManifestData = undefined
      if (this.i18n !== undefined) {
        this.lintPush(warnings, 'i18n', t('bundler.index.i18n-dossier-absent', { dossier: i18nDir }))
      }
      return { warnings }
    }
    if (!this.i18n?.default) {
      throw new Error(t('bundler.index.i18n-default-manquant'))
    }

    const I18N_EXTS = ['.yml', '.yaml', '.json']
    const SECTION_NAME_RE = /^[a-z0-9_-]+$/
    // hash md5 DU CONTENU (pas aléatoire) — même contenu ⇒ même nom d'un build à l'autre
    // (cache navigateur préservé), contenu modifié ⇒ nom nouveau, orphelins purgés
    // (unlink des anciens .json avant écriture).
    // `i18n.hash` : `'auto'` (défaut) = en prod seulement, noms clairs en dév ; `true` = TOUJOURS,
    // y compris en dév — utile sur un site servi localement par un vrai serveur, où un nom clair
    // laisse le navigateur resservir une prose périmée ; `false` = jamais.
    const useHash = this.i18nHashed()

    const root: Record<string, Record<string, any>> = {}
    // chemin relatif RÉEL du fichier racine par langue (extension d'origine, pour les messages).
    const rootFile: Record<string, string> = {}
    // rawSections[langue][section] = { data, outDir, rel } — collectées AVANT écriture disque, le
    // contrôle d'empreinte (ci-dessous) doit pouvoir rejeter un fragment sans jamais l'émettre.
    // table interne sans prototype : un nom de section ne touche jamais Object.prototype
    const rawSections: Record<string, Record<string, { data: any, outDir: string, rel: string }>> = Object.create(null)
    // nom de langue : la forme d'une étiquette de langue (`fr`, `pt-BR`, `zh_Hant`, `reel-fr`), un premier sous-libellé de 2 à 8
    // lettres, puis des lettres et des chiffres après `-` ou `_` ; jamais `__proto__`, `..` ni une barre
    const LANG_NAME_RE = /^[A-Za-z]{2,8}(?:[-_][A-Za-z0-9]+)*$/

    // `readdirSync` NE GARANTIT
    // AUCUN ORDRE (cf. commentaire jumeau ~2209 `bundleSharedStyles`) : sans
    // `.sort()`, l'ordre des langues/sections alimente `i18nManifestData` →
    // `JSON.stringify` dans `bundle_modular.js` (nom FIXE, pas haché) de façon
    // non déterministe, en conflit avec le skip-write byte-identique de
    // `writeManifest` (~2998). Même correctif, même raison, tri explicite.
    for (const entry of readdirSync(i18nDir).sort()) {
      const entryPath = join(i18nDir, entry)
      const st = statSync(entryPath)
      if (st.isFile()) {
        const ext = extname(entry)
        if (!I18N_EXTS.includes(ext)) continue
        const lang = basename(entry, ext)
        if (!LANG_NAME_RE.test(lang)) throw new Error(t('bundler.index.i18n-langue-invalide', { langue: lang, chemin: entryPath }))
        root[lang] = this.parseI18nFile(entryPath)
        rootFile[lang] = `i18n/${entry}`
        continue
      }
      if (!st.isDirectory()) continue
      const lang = entry
      const sectionFiles = readdirSync(entryPath).filter(f => I18N_EXTS.includes(extname(f))).sort()
      if (sectionFiles.length === 0) continue
      if (!LANG_NAME_RE.test(lang)) throw new Error(t('bundler.index.i18n-langue-invalide', { langue: lang, chemin: entryPath }))
      const outDir = join(this.outputDir, 'i18n', lang)
      // dossier de sortie dans le dossier des traductions (sortie = sources, chemins réels) : chaque fragment y réécrirait la
      // traduction de l'auteur du même nom, et y serait relu comme une section au build suivant. Refusé avant toute écriture
      if (cheminDansDossier(outDir, i18nDir)) throw new Error(t('bundler.index.i18n-sortie-dans-sources', { dossier: outDir, sources: i18nDir }))
      // dossier de sortie : jamais vidé ici. Les anciens fragments que le BUILD a écrits sont retirés par
      // pruneOrphans() (registre `.mjs-outputs.json`), jamais un fichier posé là par l'utilisateur
      if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true })
      for (const sf of sectionFiles) {
        const sectionExt = extname(sf)
        const section = basename(sf, sectionExt)
        if (!SECTION_NAME_RE.test(section)) {
          throw new Error(t('bundler.index.i18n-section-invalide', { section, chemin: join(entryPath, sf) }))
        }
        const data = this.parseI18nFile(join(entryPath, sf))
        if (!rawSections[lang]) rawSections[lang] = Object.create(null)
        rawSections[lang][section] = { data, outDir, rel: `i18n/${lang}/${sf}` }
      }
    }

    // Contrôle d'empreinte (opt-in, `i18n.source`) — le français (ou toute langue choisie comme
    // source) fait foi ; une traduction en retard sur elle n'est ni émise ni servie, cf.
    // docs/29-i18n.md § Contrôle d'empreinte.
    const sourceLang = this.i18n.source
    if (sourceLang !== undefined) {
      const hasRootSource = Object.prototype.hasOwnProperty.call(root, sourceLang)
      const hasSectionSource = Object.keys(rawSections).includes(sourceLang)
      if (!hasRootSource && !hasSectionSource) {
        throw new Error(t('bundler.index.i18n-source-langue-inconnue', { langue: sourceLang }))
      }
      // racine — la source elle-même ne se scelle jamais
      if (hasRootSource && Object.prototype.hasOwnProperty.call(root[sourceLang], '__source')) {
        this.lintPush(warnings, 'i18n', t('bundler.index.i18n-source-scellee', { fichier: rootFile[sourceLang] }))
        delete root[sourceLang].__source
      }
      const rootSourceFingerprint = hasRootSource ? this.fingerprintI18n(root[sourceLang]) : null
      for (const lang of Object.keys(root)) {
        if (lang === sourceLang) continue
        const data = root[lang]
        const has = Object.prototype.hasOwnProperty.call(data, '__source')
        const seal = has ? data.__source : undefined
        delete data.__source
        if (rootSourceFingerprint === null) {
          this.lintPush(warnings, 'i18n', t('bundler.index.i18n-source-introuvable', { fichier: rootFile[lang], langue: sourceLang }))
          delete root[lang]
        } else if (!has) {
          this.lintPush(warnings, 'i18n', t('bundler.index.i18n-empreinte-absente', { fichier: rootFile[lang], attendu: rootSourceFingerprint }))
          delete root[lang]
        } else if (seal !== rootSourceFingerprint) {
          this.lintPush(warnings, 'i18n', t('bundler.index.i18n-empreinte-perimee', { fichier: rootFile[lang], attendu: rootSourceFingerprint }))
          delete root[lang]
        }
      }
      // sections — même sceau, section par section
      const sourceSections = rawSections[sourceLang] ?? {}
      if (rawSections[sourceLang]) {
        for (const section of Object.keys(rawSections[sourceLang])) {
          const secEntry = rawSections[sourceLang][section]
          if (Object.prototype.hasOwnProperty.call(secEntry.data, '__source')) {
            this.lintPush(warnings, 'i18n', t('bundler.index.i18n-source-scellee', { fichier: secEntry.rel }))
            delete secEntry.data.__source
          }
        }
      }
      for (const lang of Object.keys(rawSections)) {
        if (lang === sourceLang) continue
        for (const section of Object.keys(rawSections[lang])) {
          const entry = rawSections[lang][section]
          const data = entry.data
          const has = Object.prototype.hasOwnProperty.call(data, '__source')
          const seal = has ? data.__source : undefined
          delete data.__source
          const sourceEntry = sourceSections[section]
          const fichier = entry.rel
          if (!sourceEntry) {
            this.lintPush(warnings, 'i18n', t('bundler.index.i18n-source-introuvable', { fichier, langue: sourceLang }))
            delete rawSections[lang][section]
            continue
          }
          const attendu = this.fingerprintI18n(sourceEntry.data)
          if (!has) {
            this.lintPush(warnings, 'i18n', t('bundler.index.i18n-empreinte-absente', { fichier, attendu }))
            delete rawSections[lang][section]
          } else if (seal !== attendu) {
            this.lintPush(warnings, 'i18n', t('bundler.index.i18n-empreinte-perimee', { fichier, attendu }))
            delete rawSections[lang][section]
          }
        }
      }
    }

    // Émission des fragments retenus (RIEN d'écrit pour un fragment rejeté ci-dessus).
    // `sections[langue][section]` garde le seul NOM du fragment (hash en prod, nom clair
    // en dév), jamais son URL entière : le préfixe (`<urlPrefix>/i18n`) est publié UNE
    // fois dans le manifeste et l'URL se reconstitue côté runtime (__i18nSectionUrl,
    // mjs_i18n.ts) — 356 sections par langue répétaient sinon le même préfixe 356 fois.
    const sections: Record<string, Record<string, string>> = {}
    const nomsPris = new Map<string, string>()
    for (const lang of Object.keys(rawSections)) {
      for (const section of Object.keys(rawSections[lang])) {
        const { data, outDir } = rawSections[lang][section]
        const serialized = JSON.stringify(data)
        // hash DU CONTENU (pas aléatoire) — même contenu ⇒ même nom d'un build à
        // l'autre (cache navigateur préservé), contenu modifié ⇒ nom nouveau.
        const stem = useHash ? nommerFragmentI18n(serialized, nomsPris) : section
        // nom à empreinte : même nom = même contenu, l'écriture saute dès que le fichier existe ;
        // nom clair (la section) : stable alors que le contenu change, réécrit seulement s'il diffère (cf. writeI18nFragment)
        if (useHash) this.writeFileAtomic(join(outDir, `${stem}.json`), serialized)
        else this.writeSortieDifferee(join(outDir, `${stem}.json`), serialized, 'traduction')
        const ecrits = this.i18nWritten.get(lang) ?? new Set<string>()
        ecrits.add(`${stem}.json`)
        this.i18nWritten.set(lang, ecrits)
        if (!sections[lang]) sections[lang] = {}
        sections[lang][section] = stem
      }
    }

    // UN FICHIER PAR LANGUE — `root` + table des sections de CETTE langue seulement,
    // dans `outputDir/mjs_i18n-<langue>-<hash>.js` (module ES à export par défaut, haché sur
    // son contenu comme un composant : même nom tant que la prose ne bouge pas). Le
    // runtime l'importe une fois la langue décidée (mjs_i18n.ts) ; la coquille de l'hôte,
    // qui connaît la langue avant tout JS, peut le précharger dans la première vague.
    // Langues : union racine + sections — une langue qui n'a que des fragments garde sa
    // table (repli de section), même si elle n'est pas SÉLECTIONNABLE (cf. `langs`).
    // PRÉFIXE `mjs_` OBLIGATOIRE — une unité de sortie nommée `i18n-<langue>` était celle
    // qu'un composant `i18n-fr.mjs` porte aussi (même base, même extension) : la purge des
    // anciennes empreintes d'une unité (cleanupOldHashes) supprimait alors le composant
    // compilé, sans erreur ni avertissement, manifeste pointant dans le vide. Le souligné
    // est hors d'atteinte d'un nom de composant (COMPONENT_FILE_NAME_RE : minuscules,
    // chiffres et tirets), comme pour `mjs_core`/`mjs_styles`/`mjs_anims`.
    const files: Record<string, string> = {}
    const toutesLangues = [...new Set([...Object.keys(root), ...Object.keys(sections)])].sort((a, b) => a < b ? -1 : a > b ? 1 : 0)
    if (toutesLangues.length > 0 && !existsSync(this.outputDir)) mkdirSync(this.outputDir, { recursive: true })
    for (const lang of toutesLangues) {
      const contenu = `export default ${JSON.stringify({ root: root[lang] ?? {}, sections: sections[lang] ?? {} })};\n`
      files[lang] = this.writeHashed(`mjs_i18n-${lang}`, '.js', contenu)
    }

    const attente = parsePlaceholder(this.i18n.placeholder ?? 'wait', PLACEHOLDER_CONFIG)
    const secours = dureeEnMs(this.i18n.timeout)
    this.i18nManifestData = {
      dev: !this.isProd(),
      default: this.i18n.default,
      placeholder: attente.mode,
      ...attente.settings ? { fx: attente.settings } : {},
      ...secours !== null && Math.round(secours) !== 3000 ? { timeout: Math.round(secours) } : {},
      persist: this.i18n.persist ?? false,
      detect: this.i18n.detect ?? false,
      urlParam: this.i18n.urlParam ?? false,
      prefix: `${this.urlPrefix}/i18n`,
      // SÉLECTIONNABLES : dictionnaire racine présent — même domaine de validation
      // qu'avant pour `?lang=`/localStorage/navigator (le runtime testait `root`).
      langs: Object.keys(root).sort((a, b) => a < b ? -1 : a > b ? 1 : 0),
      files,
      root,
      sections,
    }
    return { warnings }
  }

  /** Part du bloc i18n RÉELLEMENT publiée dans le manifeste : tout sauf `root` et
   *  `sections`, partis dans les fichiers de langue (cf. `I18nManifestData`). */
  i18nPublicData(): I18nPublicData | undefined {
    if (!this.i18nManifestData) return undefined
    const { root: _root, sections: _sections, ...publie } = this.i18nManifestData
    return publie
  }

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
  private manifestBodyLines(pathsLine: string): string[] {
    return [
      // Mode strict « politique de sécurité de contenu » (clé `csp`) — RIEN émis hors de ce
      // mode. Le runtime le lit pour choisir une feuille constructible là où il créait un
      // `<style>` : c'est une décision de BUILD, jamais un réglage à basculer à chaud, d'où
      // la propriété interne plutôt qu'une clé de `µ.config` (qui peut être forgé à la main).
      this.csp ? `µ._csp = true;` : '',
      pathsLine,
      // table nom de feuille → URL du `.css` haché. RIEN émis hors du mode
      // 'lazy' : le runtime ne teste `µ._cssLazy` que lorsque `µ.CSS[nom]` est absent,
      // ce qui n'arrive jamais dans les deux autres modes.
      this.cssMode === 'lazy' && Object.keys(this.lazyStyleUrls).length > 0 ? `µ._cssLazy = ${JSON.stringify(Object.fromEntries(Object.entries(this.lazyStyleUrls).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)))};` : '',
      `µ.preload = ${JSON.stringify(normalizePreload(this.preload))};`,
      // Niveau EFFECTIF de la console (clé `logLevel`, cf. resolveLogLevel/config.ts), CELUI de
      // CET environnement (dev ou prod selon la commande) — ÉMIS INCONDITIONNELLEMENT, comme
      // `µ.preload` juste au-dessus : la clé a toujours un défaut, jamais de bloc absent à gérer.
      // Consommé par `µ.log`/`µ.warn`/`µ.error` (mjs_init.ts).
      `µ._logLevel = ${JSON.stringify(this.currentLogLevel())};`,
      // Libellés par défaut (fr/en) des petits bouts d'UI runtime (mjs_modal.ts, mjs_router.ts,
      // mjs_ujs.ts) — contrairement à `µ._i18nData` juste en dessous, ÉMIS INCONDITIONNELLEMENT :
      // ces libellés doivent être dans TOUS les builds, y compris les apps qui n'utilisent jamais
      // le module i18n optionnel. TOUTES les langues sont émises, plus une
      // seule figée au build : c'est le runtime qui choisit celle AFFICHÉE (`µ._mjs_label`,
      // mjs_init.ts) — un site basculé en anglais montrait des toasts « Succès »/« Erreur ».
      // `µ._runtimeLabelsLang` = langue de repli : celle du projet (`i18n.default`), sinon la
      // clé `lang` de mjs.config.json (cf. labelsLang). Le rendu serveur pose la même langue et la même table, sans les messages de la console.
      `µ._runtimeLabels = ${JSON.stringify(this.manifestLabels())};`,
      `µ._runtimeLabelsLang = ${JSON.stringify(this.labelsLang())};`,
      // adresse du fichier de messages de chaque langue (production seulement) : lue par le cœur au
      // premier message de la console. Nom SANS `_mjs_` : le manifeste n'est pas raccourci avec le cœur
      this.msgUrlsLine(),
      (this.viewTransition && this.viewTransition !== 'none') ? `µ.viewTransition = ${JSON.stringify(this.viewTransition)};` : '',
      // i18n — RIEN émis si `sourceDir/i18n/` est absent
      // (scanI18n() laisse `i18nManifestData` à `undefined`, cf. compile()).
      // `µ._i18nRecheck` (cascade de modules — mjs_i18n.ts ne peut plus compter sur un
      // timing de microtâche implicite pour redécouvrir `µ._i18nData`, cf. son bandeau
      // détaillé) : même patron que `µ._themeAdopt` juste en dessous pour `µ._themeCss`.
      // `i18nPublicData()` et pas `i18nManifestData` : les dictionnaires et la table des
      // sections vivent dans le fichier de LEUR langue (cf. scanI18n) — ne reste ici que
      // de quoi CHOISIR la langue (`langs`) et aller chercher son fichier (`files`).
      this.i18nManifestData ? `µ._i18nData = ${JSON.stringify(this.i18nPublicData())}; if (typeof µ._i18nRecheck === 'function') { µ._i18nRecheck(); }` : '',
      // Thèmes de l'application (`*.theme.mjs`) — RIEN émis quand il n'y en a aucun.
      // `µ._themes` autorise la rune `µtheme` à accepter ces noms ; `µ._themeCss` est
      // adopté par `µ._themeAdopt()` (mjs_init.ts), appelé ici ET au boot du runtime,
      // pour que l'ordre de chargement manifeste/runtime n'ait aucune importance.
      this.themeNames.length > 0 ? `µ._themes = ${JSON.stringify(this.themeNames)};` : '',
      this.themeCss !== '' ? `µ._themeCss = ${JSON.stringify(this.themeCss)}; if (typeof µ._themeAdopt === 'function') { µ._themeAdopt(); }` : '',
      // `µ._themeCssByName` : jumeau de `µ._themeCss` ci-dessus, mais PAR THÈME (nom →
      // son propre css, cf. `themeVarData`, rempli par compileThemeFiles() avec un
      // `css` par CompiledTheme, bundler/themes.ts) — le rendu serveur en a besoin pour
      // inliner UN SEUL thème dans le <head> d'une page rendue au serveur, sans le CSS
      // des thèmes non utilisés par cette page. N'écarte rien de `µ._themeCss`.
      this.themeNames.length > 0 ? `µ._themeCssByName = ${JSON.stringify(Object.fromEntries(this.themeVarData.map(td => [td.name, td.css])))};` : '',
      // Types et valeurs permises : ce que fait une valeur ramenée ou refusée en DÉVELOPPEMENT (clé
      // `types`, 'warn' par défaut) — RIEN émis en production (le runtime s'y tait), ni pour un
      // projet sans <vars> ni effet (le moteur des effets s'en sert pour un réglage tenu par une
      // variable, `*neon(size: $s)`). Nom SANS `_mjs_` : le manifeste n'est pas raccourci avec le cœur.
      !this.isProd() && (this.pendingFeatures.has('types') || this.pendingFeatures.has('fx')) ? `µ._typesMode = ${JSON.stringify(this.typesMode ?? 'warn')};` : '',
      // Effets que MJS pose de lui-même (clé `effects` : thème en cercle, effets économes) — rien
      // quand la clé n'est pas écrite : le runtime prend ses défauts. Nom SANS `_mjs_`, comme au-dessus.
      this.effectsConf && Object.keys(this.effectsConf).length > 0 ? `µ._fxConf = ${JSON.stringify(this.effectsConf)};` : '',
      // la silhouette des composants dont le code arrive (cf. componentSkeletons) ; rien sans elle
      (() => {
        const skels = this.componentSkeletons()
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
  pathsCompaction(): { prefix: string; compact: boolean } {
    const prefix = `${this.urlPrefix}/`
    const values = Object.entries(this.manifest).filter(([k]) => k !== '__animations' && k !== '__styles' && k !== '__external').map(([, v]) => v)
    return { prefix, compact: this.urlPrefix.length > 1 && values.every(v => v.startsWith(prefix)) }
  }

  // --------------------------------------------------------------------------
  // writeManifest() : écrit l'entrypoint `bundle_modular.js`
  // --------------------------------------------------------------------------
  writeManifest(): void {
    const animsPath = this.manifest['__animations']
    const stylesPath = this.manifest['__styles']
    const externalPath = this.manifest['__external']
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
    const stylesPaths: string[] = this.cssMode === 'split'
      ? [this.splitRootHashedPath, ...this.splitEagerHashedPaths].filter((p): p is string => !!p)
      : this.cssMode === 'lazy'
      ? (this.splitRootHashedPath ? [this.splitRootHashedPath] : [])
      : (stylesPath ? [stylesPath] : [])
    // On retire les clés internes du manifest exposé
    const rawPublicManifest = { ...this.manifest }
    delete rawPublicManifest['__animations']
    delete rawPublicManifest['__styles']
    delete rawPublicManifest['__external']
    // les fichiers d'effets (`mjs_fx_<nom>`, cf. compileFxChunks) : préchargés avec les composants qui
    // les importent (µDeps), importés à la demande par le moteur
    for (const [k, path] of this.fxChunkPaths) rawPublicManifest[k] = path
    // un composant groupé (`bundles`) se charge par le fichier de son groupe
    for (const [k, path] of this.groupPaths) rawPublicManifest[k] = path
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
    const { prefix: pathsPrefix, compact: compactable } = this.pathsCompaction()
    const basenamePaths = compactable
      ? Object.fromEntries(Object.entries(publicManifest).map(([k, v]) => [k, v.slice(pathsPrefix.length)]))
      : publicManifest
    // forme COMPACTE des valeurs (cf. encodePathValue) : production seulement, et seulement quand la
    // table est assez grosse pour payer le décodeur `µPath` (PATHS_ENCODE_MIN_ENTRIES) ; sinon table entière
    const encodedPaths = compactable && this.isProd() && Object.keys(basenamePaths).length >= PATHS_ENCODE_MIN_ENTRIES
    const emittedPaths = encodedPaths
      ? Object.fromEntries(Object.entries(basenamePaths).map(([k, v]) => [k, encodePathValue(k, v)]))
      : basenamePaths
    // même tri, même raison — `this.manifestDeps` (buildManifestDeps) est déjà trié
    // clé par clé, mais chaque VALEUR (tableau de noms) l'est aussi (cf. son commentaire) :
    // rien à refaire ici, JSON.stringify respecte l'ordre d'insertion des deux.
    const manifestDeps = this.manifestDeps

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
    const eagerHrefsLiteral = [this.coreHashedPath, ...stylesPaths, ...(animsPath ? [animsPath] : []), ...(externalPath ? [externalPath] : [])]
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
    const preloadFn = this.preloadCalled ? [
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
      ...this.manifestBodyLines(`µ.paths = µPaths;`),
      // le cœur lit les chemins par µ.pathOf : même décodeur que le manifeste (table encodée)
      encodedPaths ? `µ.pathOf = µPath;` : '',
      // les dépendances directes, lues par l'Autoloader : les fichiers d'effets d'un composant partent
      // en même temps que lui (cf. µ._mjs_fxPrefetch, mjs_fx.ts)
      this.fxChunkPaths.size > 0 ? `µ.deps = µDeps;` : '',
      externalImport,
      this.preloadCalled ? `if (µ.Autoloader) { µ.Autoloader.preload = µPreload; }` : '',
      `if (µ.Autoloader) { µ.Autoloader.observe(document.body); }`,
    ].filter(l => l.length > 0)
    // Utilisait `NODE_ENV` directement
    // (2e définition de "prod", divergente de `isProd()`/`shouldEmitSourceMap()`
    // ci-dessus) : cf. le commentaire détaillé de `isProd()`.
    if (!this.isProd()) {
      bodyLines.push(`window.µ = µ;`)
    }
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
      `const µCore = '${this.coreHashedPath}';`,
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
    ]
    // (protocole de navigation) — id de build GLOBAL, dérivé du CONTENU
    // assemblé ci-dessus (SAUF la ligne de version elle-même) : même style que
    // writeHashed (md5), jamais une horloge → même build = même id, un seul
    // asset qui change = id différent. La garde skip-si-identique juste plus bas
    // reste cohérente par construction (contenu identique ⇒ id identique ⇒ ligne
    // insérée identique). `lastBuildId` posé à CHAQUE writeManifest, y compris
    // quand l'écriture est skippée (id déjà correct, recalculé à l'identique).
    const buildId = createHash('md5').update(lines.join('\n')).digest('hex').slice(0, 8)
    this.lastBuildId = buildId
    // `.trim()` : la ligne vit maintenant DANS le corps indenté de 2 espaces (cf. bodyLines.map ci-dessus).
    const pathsLineIdx = lines.findIndex(l => l.trim().startsWith('µ.paths = '))
    lines.splice(pathsLineIdx + 1, 0, `  µ.version = "${buildId}";`)
    if (!existsSync(dirname(this.manifestPath))) {
      mkdirSync(dirname(this.manifestPath), { recursive: true })
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
    const newContent = (this.ecritDansSources() ? `${MARQUE_SORTIE}\n` : '') + lines.join('\n')
    if (existsSync(this.manifestPath)) {
      const current = readFileSync(this.manifestPath, 'utf-8')
      if (current === newContent) return
    }
    // garde-fou ESM (cf. assertValidEsm) — bundle_modular.js est lui aussi du
    // JS émis, même exposé au risque « build vert qui ment ».
    this.assertValidEsm(newContent, basename(this.manifestPath))
    this.writeFileAtomicAlways(this.manifestPath, newContent)
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
  private bundleUnitOrder(): string[] {
    const stems = [...this.pendingUnits.keys()].filter(s => s !== 'mjs_external').sort((a, b) => a < b ? -1 : a > b ? 1 : 0)
    const order: string[] = []
    const done = new Set<string>()
    const visiting = new Set<string>()
    const visit = (stem: string): void => {
      if (done.has(stem) || visiting.has(stem)) return  // déjà placé, ou cycle (rompu ailleurs) : jamais revisité
      visiting.add(stem)
      for (const dep of [...(this.manifestDeps[stem] ?? [])].sort((a, b) => a < b ? -1 : a > b ? 1 : 0)) {
        if (this.pendingUnits.has(dep)) visit(dep)
      }
      visiting.delete(stem)
      done.add(stem)
      order.push(stem)
    }
    // un module chargé à la demande n'est pas importé d'office par l'entrée : un composant qui l'`@import`e le tire
    // par ses dépendances (visit ci-dessus), sinon il sort dans son propre fichier (cf. runBundleEsbuild) ; de même un module que
    // seuls des modules chargés à la demande importent
    const reserves = this.bundleLazyOnlyModules()
    for (const stem of stems) if (!this.bundleLazyStems.has(stem) && !reserves.has(stem)) visit(stem)
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
  private bundleLazyOnlyModules(): Set<string> {
    const reserves = new Set<string>()
    if (this.bundleLazyStems.size === 0) return reserves
    const re        = /(\bimport\s*\(\s*)?(['"])mjs:unit\/([^'"]+)\2/g
    const statiques = new Map<string, string[]>()
    const liens     = (stem: string): string[] => {
      let l = statiques.get(stem)
      if (!l) {
        l = []
        for (const m of (this.bundleVirtualSources.get(stem) ?? '').matchAll(re)) if (!m[1]) l.push(m[3])
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
    const estModule = (stem: string): boolean => /\.(?:civet|coffee)$/.test(this.pendingUnits.get(stem)?.file ?? '')
    const candidats = new Set([...fermeture(this.bundleLazyStems)].filter(s => !this.bundleLazyStems.has(s) && estModule(s)))
    const atteints  = fermeture([...this.bundleVirtualSources.keys()].filter(s => !this.bundleLazyStems.has(s) && !candidats.has(s)))
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
  private buildBundleSetupBody(): string {
    const publicNames = Object.keys(this.manifest)
      .filter(k => k !== '__styles' && k !== '__animations' && k !== '__external')
      .sort((a, b) => a < b ? -1 : a > b ? 1 : 0)
    const pathsLine = `const µSelfUrl = import.meta.url;\nµ.paths = { ${publicNames.map(n => `${JSON.stringify(n)}: µSelfUrl`).join(', ')} };`
    const lines = this.manifestBodyLines(pathsLine)
    if (!this.isProd()) lines.push(`window.µ = µ;`)
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
  private buildBundleEntry(unitOrder: string[]): string {
    const lines: string[] = [`import { µ } from 'mjs:core';`, `import 'mjs:setup';`]
    if (this.manifest['__styles']) lines.push(`import 'mjs:styles';`)
    if (this.manifest['__animations']) lines.push(`import 'mjs:anims';`)
    if (this.pendingUnits.has('mjs_external')) lines.push(`import 'mjs:unit/mjs_external';`)
    for (const stem of unitOrder) lines.push(`import 'mjs:unit/${stem}';`)
    // µ.Autoloader n'est du cœur qu'en 'split' (cf. resolveRuntimeFiles) : ici il n'y est que
    // demandé explicitement (`runtime: ['autoloader']`), et on garde alors son observer. Sans lui,
    // un contrôle UNIQUE remplace son seul apport dans ce mode — signaler une balise `mjs-*` que
    // ce fichier ne définit pas (faute de frappe, composant oublié du projet) : tous les
    // `customElements.define` ont déjà tourné au-dessus, tout ce qui reste `:not(:defined)` avec
    // ce préfixe est inconnu pour de bon. Les balises insérées PLUS TARD ne sont pas suivies (pas
    // d'observer) : il n'y aurait rien à charger pour elles non plus. Ce contrôle ne sert qu'à un avertissement : aux niveaux de
    // production qui retirent ceux du framework ('error', 'silent', cf. runtimeCallsCut), il ne s'écrit pas
    const warns = !(this.isProd() && this.shouldMinify() && runtimeCallsCut(this.prodLogLevel()).includes('warn'))
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
  private async runBundleEsbuild(): Promise<{ code: string; map?: string; chunks: Array<{ name: string; code: string; map?: string }> }> {
    const sources = this.bundleVirtualSources
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
    const shouldMinify = this.shouldMinify()
    const wantsMap = this.shouldEmitSourceMap()
    // des modules chargés à la demande (µimport d'un module, cf. lazyModuleImports) : esbuild coupe l'assemblage à chaque import
    // dynamique — l'entrée garde le nom du manifeste, chaque module chargé à la demande sort dans son fichier, et le code que
    // l'entrée et ces modules partagent (le cœur, un module `@import`é des deux côtés) dans un fichier à part, importé par les
    // deux : une seule instance de chaque module. Sans eux, un seul fichier, comme toujours
    const lazy      = this.bundleLazyStems.size > 0
    const entryName = basename(this.manifestPath).replace(/\.js$/, '')
    const runOnce = () => esbuildBuild({
      entryPoints: lazy ? { [entryName]: 'mjs:entry' } : ['mjs:entry'],
      absWorkingDir: this.root,
      ...(lazy ? { outdir: 'mjs-bundle', splitting: true, entryNames: '[name]', chunkNames: '[name]-[hash]' } : { outfile: basename(this.manifestPath) }),
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
      pure: this.isProd() ? buildPureList(this.prodLogLevel()) : [],
      mangleProps: shouldMinify ? /^_mjs_/ : undefined,
      mangleCache: shouldMinify ? this.mangleCache : undefined,
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
      footer: lazy ? undefined : { js: `//# mjsVersion=${this.lastBuildId ?? ''}` },
      sourcemap: wantsMap ? 'external' : false,
      logLevel: 'silent',
      plugins: [virtualPlugin],
    })
    let result: Awaited<ReturnType<typeof esbuildBuild>>
    try {
      result = shouldMinify ? await withMangleCacheLock(this.mangleCache, runOnce) : await runOnce()
    } catch (e: any) {
      throw new Error(t('bundler.index.js-bundle-echec', { raison: e?.message ?? String(e) }))
    }
    // esbuild N'AJOUTE PAS ses nouvelles entrées AU mangleCache passé — il ne fait que les
    // RENDRE dans `result.mangleCache` (mesuré, même contrat que transform()/minifyJs()) :
    // sans ce merge, chaque compile() reparlerait de zéro, un `_mjs_*` pourrait recevoir un nom
    // court DIFFÉRENT d'un build à l'autre pour un projet pourtant inchangé.
    if (shouldMinify && result.mangleCache) Object.assign(this.mangleCache, result.mangleCache)
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
      code:   `${texteEntree}${texteEntree.endsWith('\n') ? '' : '\n'}//# mjsVersion=${this.lastBuildId ?? ''}\n`,
      map:    carteDe(entree),
      chunks: js.filter(f => f !== entree).map(f => ({ name: noms.get(basename(f.path))!, code: renomme(f.text), map: carteDe(f) })),
    }
  }

  // --------------------------------------------------------------------------
  // writeBundleChunks(chunks) : mode 'bundle' avec des modules chargés à la demande — écrit les fichiers que
  // le fichier unique importe (le code partagé, un fichier par module chargé à la demande) À CÔTÉ du manifeste :
  // l'entrée les cite par un chemin relatif (`./<fichier>`), qui se lit depuis l'adresse du manifeste, quelle
  // que soit la base de la page. Écrits AVANT l'entrée (jamais d'entrée qui cite un fichier absent). Leurs
  // anciennes versions partent après la publication du manifeste (cf. flushPendingHashCleanup) ; ceux de ce
  // tour rejoignent les sorties du build (précache, tailles) quand le manifeste est dans le dossier de sortie.
  // --------------------------------------------------------------------------
  private bundleChunkFiles: Set<string> = new Set()

  private writeBundleChunks(chunks: Array<{ name: string; code: string; map?: string }>): void {
    const dir      = dirname(this.manifestPath)
    const sameDir  = (a: string, b: string): boolean => { try { return realpathSync(a) === realpathSync(b) } catch { return a === b } }
    const enSortie = sameDir(dir, this.outputDir)
    const courants = new Set<string>()
    if (chunks.length > 0 && !existsSync(dir)) mkdirSync(dir, { recursive: true })
    for (const c of chunks) {
      this.assertValidEsm(c.code, c.name)
      const contenu = c.map ? `${c.code}\n//# sourceMappingURL=${c.name}.map\n` : c.code
      if (c.map) this.writeFileAtomic(join(dir, `${c.name}.map`), c.map)
      this.writeFileAtomic(join(dir, c.name), contenu)
      courants.add(c.name)
      if (c.map) courants.add(`${c.name}.map`)
      if (enSortie) this.emittedThisCompile.add(c.name)
    }
    // Ce que ce build a écrit avant — lui-même, ou un build d'un autre processus que le registre a consigné — et qu'il n'écrit plus
    // part après la publication du manifeste s'il est REMPLACÉ (un morceau de même base y prend sa place) ou s'il vient de cette
    // instance. Un fichier que personne n'a consigné n'est jamais retiré, quelle que soit la forme de son nom (`chunk-deadbeef.js`
    // d'un auteur) ; un module disparu sans successeur laisse ses fichiers à la purge de `mjs build` (cf. pruneBundleChunks).
    const base   = (n: string): string => n.replace(/-[a-f0-9]{8}\.js(?:\.map)?$/, '')
    const bases  = new Set([...courants].map(base))
    const avant  = new Set([...this.bundleChunkFiles, ...bundleNeighborFiles(this.manifestPath)])
    for (const f of avant) {
      if (courants.has(f)) continue
      if (this.bundleChunkFiles.has(f) || bases.has(base(f))) this.pendingHashCleanup.push(join(dir, f))
    }
    this.bundleChunkFiles = courants
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
  private async writeBundleManifest(): Promise<void> {
    const unitOrder = this.bundleUnitOrder()
    const setupBody = this.buildBundleSetupBody()
    const entryText = this.buildBundleEntry(unitOrder)
    const hashInput = [...this.bundleVirtualSources.entries()].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)
      .map(([k, v]) => `${k}\0${v}`).join('\0\0')
      + '\0\0setup\0' + setupBody
      + '\0\0entry\0' + entryText
    const buildId = createHash('md5').update(hashInput).digest('hex').slice(0, 8)
    this.lastBuildId = buildId
    this.bundleVirtualSources.set('mjs_setup', `import { µ } from 'mjs:core';\nµ.version = ${JSON.stringify(buildId)};\n${setupBody}`)
    this.bundleVirtualSources.set('mjs_entry', entryText)

    const { code, map, chunks } = await this.runBundleEsbuild()
    this.writeBundleChunks(chunks)
    // dossier du manifeste d'abord : la carte s'y écrit
    if (!existsSync(dirname(this.manifestPath))) {
      mkdirSync(dirname(this.manifestPath), { recursive: true })
    }
    // construction qui écrit dans le dossier des sources : la marque en première ligne (cf. sortieDuBuild), et la carte suit ce
    // décalage d'une ligne (un `;` de plus en tête de `mappings`)
    const marque   = this.ecritDansSources()
    let newContent = marque ? `${MARQUE_SORTIE}\n${code}` : code
    if (map) {
      const mapName = `${basename(this.manifestPath)}.map`
      newContent = `${newContent}\n//# sourceMappingURL=${mapName}\n`
      let carte = map
      if (marque) {
        const lue = JSON.parse(map)
        lue.mappings = `;${lue.mappings}`
        carte = JSON.stringify(lue)
      }
      // carte identique non retouchée : sous un dossier surveillé, chaque écriture relançait une construction
      this.writeIfChanged(join(dirname(this.manifestPath), mapName), carte)
    }
    // même garde skip-si-identique que writeManifest() (cf. son commentaire détaillé) : un
    // `mjs dev` dont rien n'a changé ne doit pas toucher le fichier (mtime stable, jamais de
    // boucle de recompilation).
    if (existsSync(this.manifestPath)) {
      const current = readFileSync(this.manifestPath, 'utf-8')
      if (current === newContent) return
    }
    // garde-fou ESM (cf. assertValidEsm) — même exigence que writeManifest().
    this.assertValidEsm(newContent, basename(this.manifestPath))
    this.writeFileAtomicAlways(this.manifestPath, newContent)
  }

  // même motif que writeFileAtomic ci-dessus, non réutilisable ici : le
  // manifest change de contenu à chaque build, alors que writeFileAtomic
  // skippe si `target` existe déjà — inadapté à un chemin FIXE dont le
  // contenu varie. Extrait de writeManifest() pour rester testable isolément
  // (cf. tests/bundler-manifest-atomic.test.ts).
  private writeFileAtomicAlways(target: string, content: string | Buffer): void {
    const tmp = `${target}.tmp-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}`
    writeFileSync(tmp, content, 'utf-8')
    try {
      renameSync(tmp, target)
    } catch (e) {
      try { unlinkSync(tmp) } catch {}
      throw e
    }
  }

  // --------------------------------------------------------------------------
  // watch() : surveille sourceDir + runtimeDir (+ stylesheetsDir + deps du
  // manifest externe) et recompile au changement. Effectue aussi le BUILD
  // INITIAL (voir commentaire détaillé plus bas — avant, c'était au caller
  // de le faire séparément, AVANT d'appeler watch()).
  // Optionnel : `onRecompile` est appelé après chaque (re)compile, initiale
  // incluse (pour HMR) — 2e argument : les CompileStats du tour (dont
  // `cssOnly`, pour router reload complet vs hot-swap CSS). Des fichiers modifiés
  // ensemble partent dans un seul tour : `onRecompile` reçoit alors le dernier.
  // --------------------------------------------------------------------------
  async watch(opts: { onRecompile?: (changedPath: string, stats?: CompileStats) => void } = {}): Promise<void> {
    // un seul observateur par instance : deux files de constructions indépendantes lanceraient deux compile() en même temps
    if (this.stopWatching !== null) throw new Error(t('bundler.index.watch-deja-actif'))
    const chokidar = await import('chokidar')
    // arme le suivi "css-only" (diff par fichier entre deux compiles
    // consécutifs). Uniquement en watch : hors watch, compile() est one-shot,
    // aucune continuité entre deux appels — le verdict resterait toujours null.
    this.cssOnlyTracking = true
    // `stylesheetsDir` n'était jamais
    // surveillé : éditer un style partagé (@css) ne déclenchait AUCUNE
    // recompilation, contrairement à un composant .mjs. Les deps du
    // manifest externe (souvent HORS sourceDir) sont ajoutées dynamiquement
    // plus bas, après le premier calcul de `externalManifestDeps`.
    // les dossiers d'images de assetDirs aussi : une image ajoutée ou modifiée y est vue comme une image de sourceDir
    // le runtime installé (sous node_modules/) ne bouge pas pendant une session : il n'est pas surveillé
    const runtimeInstalle = /(^|[\/\\])node_modules([\/\\]|$)/.test(this.runtimeDir)
    const watchPaths = [this.sourceDir, ...runtimeInstalle ? [] : [this.runtimeDir], this.stylesheetsDir, ...this.assetDirs]
    // exclusions : segment qui commence par un point, node_modules, .git. Chaque chemin se teste RELATIVEMENT au dossier surveillé qui le
    // contient : sur le chemin complet, un projet rangé sous `moi.github.io/` ou `~/.projets/` (ou un `node_modules/` plus haut) n'était
    // jamais surveillé, contenu compris. Seuls les fichiers cachés DU PROJET sont ignorés. Un chemin hors de tout dossier surveillé
    // (fichier du manifeste externe, un `vendor/` du projet) se teste relativement à la racine du projet qui le contient
    // (cf. projectRoots) ; hors du projet, sur le chemin complet
    const motifsIgnores   = [/(^|[\/\\])\../, /node_modules/, /\.git/]
    const racinesDuProjet = this.projectRoots()
    const ignore = (chemin: string): boolean => {
      const complet = resolve(chemin)
      let racine: string | null = null
      for (const racines of [watchPaths, racinesDuProjet]) {
        for (const r of racines) {
          if ((complet === r || complet.startsWith(r + sep)) && (racine === null || r.length > racine.length)) racine = r
        }
        if (racine !== null) break
      }
      const vu = racine !== null ? relative(racine, complet) : chemin
      return motifsIgnores.some(motif => motif.test(vu))
    }
    const watcher = chokidar.watch(watchPaths, {
      ignoreInitial: true,
      ignored: ignore,
      // Attendre la fin d'écriture : l'événement `change` part dès le truncate
      // (éditeurs non atomiques) → on lisait un fichier VIDE/partiel, compilé
      // et mis en cache ; si le 2e événement était coalescé, la sortie restait
      // figée jusqu'à un `touch` manuel (2e mécanisme du symptôme observé).
      awaitWriteFinish: { stabilityThreshold: 100, pollInterval: 20 },
    })
    // ENOSPC inotify (limite de watches) et autres erreurs étaient avalés
    // sans signal : dossiers non surveillés en silence.
    // poignée rendue à close() : l'observateur s'arrête, une construction en attente ne part plus
    let arrete = false
    this.stopWatching = async () => {
      arrete = true
      if (minuterie !== null) clearTimeout(minuterie)
      minuterie = null
      await watcher.close()
    }
    watcher.on('error', (err: unknown) => {
      // eslint-disable-next-line no-console
      console.error(t('bundler.index.watch-erreur'), err instanceof Error ? err.message : err)
    })

    // Le watcher n'est pas fiable À LA MILLISECONDE où il démarre. Deux
    // temps distincts : chokidar balaie d'abord l'arborescence (`ready`, 2-12ms
    // ici), puis `awaitWriteFinish` compare des `stat` pour décider qu'une
    // écriture est TERMINÉE. Une modification qui tombe dans le premier
    // `stabilityThreshold` après ce balayage court dans les pattes de cette
    // comparaison et peut être AVALÉE — mesuré : événement jamais livré, alors
    // qu'un simple `touch` sur le même fichier une seconde plus tard passe, et
    // que le dossier est bien resté surveillé. Symptôme exact du commentaire
    // ci-dessous, une couche plus bas : « j'ai sauvegardé, rien ne s'est
    // passé ». On ne rend donc la main (ni n'annonce « Watching ») qu'une fois
    // le seuil écoulé. Garde-fou : jamais de blocage indéfini si `ready` se
    // perd (watcher en erreur, dossier disparu).
    const SETTLE_MS = 100
    const watcherReady = new Promise<void>((res) => {
      const done = (): void => { setTimeout(res, SETTLE_MS).unref?.() }
      watcher.once('ready', done)
      setTimeout(done, 5000).unref?.()
    })

    // Sentinelle distincte de tout chemin de fichier réel — désigne le build
    // INITIAL (pas déclenché par un changement précis).
    const INITIAL = Symbol('initial-build')
    const runCompile = async (changed: string[] | typeof INITIAL) => {
      if (changed !== INITIAL) {
        // Si le fichier modifié est un partial (`_xxx.mjs`), on invalide le
        // cache de tous les parents qui le référencent (via `<@include>` OU
        // `@import` d'un module .civet/.coffee) — sinon leur cache mtime reste
        // valide et leur output figé sur l'ancien hash de la dépendance.
        // La compile() qui suit recompilera l'ensemble.
        // … et le même chemin sous les autres dossiers d'images (assetDirs) : une image ajoutée dans un dossier prioritaire,
        // ou retirée de sourceDir, change l'image que les composants qui la citent résolvent
        for (const chemin of changed) {
          for (const twin of this.assetTwins(resolve(chemin))) {
            const dependents = this.partialDependents.get(twin)
            if (dependents) {
              for (const parent of dependents) this.cache.delete(parent)
            }
          }
          // eslint-disable-next-line no-console
          console.log(t('bundler.index.watch-recompilation', { fichier: relative(process.cwd(), chemin) }))
        }
      } else {
        // eslint-disable-next-line no-console
        console.log(t('bundler.index.watch-build-initial'))
      }
      const start = Date.now()
      const stats = await this.compile()
      // eslint-disable-next-line no-console
      console.log(t('bundler.index.watch-build-termine', { ecrits: stats.written, duree: Date.now() - start, erreurs: stats.errors.length }))
      for (const e of stats.errors) console.error('  ', e.message)
      // Les deps de l'external manifest peuvent changer À CHAQUE compile
      // (nouveau `#= require` ajouté/retiré) — `watcher.add()` sur des
      // chemins déjà surveillés est un no-op sûr (chokidar dédoublonne).
      if (this.externalManifestDeps.size > 0) watcher.add([...this.externalManifestDeps])
      opts.onRecompile?.(changed === INITIAL ? '<initial>' : changed[changed.length - 1], stats)
    }
    // AVANT ce fix, le CALLER (cli.ts)
    // faisait `await bundler.compile()` (build initial) PUIS SEULEMENT
    // `await bundler.watch()` : fenêtre entre les deux où AUCUN watcher
    // n'existe encore. Un fichier modifié PENDANT le build initial (réaliste
    // — un dev commence à éditer dès que `mjs dev` démarre, avant que la 1ʳᵉ
    // compilation, potentiellement longue sur un gros projet, ne finisse) ne
    // déclenchait ALORS aucune recompilation, silencieusement, jusqu'à une
    // PROCHAINE édition — "j'ai sauvegardé mais rien ne s'est passé".
    // Fix : le watcher est créé et ARMÉ (listeners attachés) AVANT même de
    // lancer le build initial, qui passe désormais par LA MÊME file
    // `inFlight` que les recompiles — un changement survenant PENDANT le
    // build initial est mis en attente (pas perdu) et déclenche sa propre
    // recompile juste après, au lieu d'être silencieusement ignoré.
    let inFlight = runCompile(INITIAL)
    // Une rafale d'écritures (rechercher-remplacer, changement de branche, formateur) part en UN tour, au lieu d'une
    // construction complète et d'un rechargement par fichier : les chemins s'accumulent tant qu'ils arrivent à moins de
    // BATCH_MS les uns des autres (BATCH_MAX_MS au plus depuis le premier), et pendant une construction en vol ; le tour
    // suivant les prend tous, invalidations des parents comprises.
    const BATCH_MS     = 50
    const BATCH_MAX_MS = 1000
    let enAttente: Set<string> = new Set()
    let minuterie: ReturnType<typeof setTimeout> | null = null
    let debutLot = 0
    // `.catch` OBLIGATOIRE : sans lui, la première exception de recompile()
    // (statSync TOCTOU, symlink cassé…) laissait `inFlight` rejetée pour
    // toujours → plus aucune recompilation (watcher mort en silence) + crash
    // unhandledRejection sur Node ≥ 15.
    const lancer = (): void => {
      minuterie = null
      inFlight = inFlight.then(async () => {
        const lot = [...enAttente]
        enAttente = new Set()
        if (lot.length > 0 && !arrete) await runCompile(lot)
      }).catch((e) => {
        // eslint-disable-next-line no-console
        console.error(t('bundler.index.watch-recompilation-echouee'), e instanceof Error ? e.message : e)
      })
    }
    const enqueue = (p: string) => {
      if (arrete) return
      enAttente.add(p)
      if (minuterie !== null) clearTimeout(minuterie)
      else debutLot = Date.now()
      minuterie = setTimeout(lancer, Date.now() - debutLot >= BATCH_MAX_MS ? 0 : BATCH_MS)
    }
    watcher.on('change', enqueue)
    watcher.on('add', enqueue)
    watcher.on('unlink', enqueue)

    try {
      await watcherReady
      // eslint-disable-next-line no-console
      console.log(t('bundler.index.watch-watching', { chemins: watchPaths.join(' + ') }))
      await inFlight
    }
    catch (e) {
      // le premier build a rejeté : l'observateur se ferme avant que l'erreur ne remonte, l'appelant n'ayant aucune poignée
      // pour le faire
      this.stopWatching = null
      if (minuterie !== null) clearTimeout(minuterie)
      await watcher.close()
      throw e
    }
  }

  // --------------------------------------------------------------------------
  // compileSingle() : helper utilitaire pour compiler une source brute.
  // --------------------------------------------------------------------------
  async compileSingle(source: string, opts: { fileName: string }): Promise<string> {
    const { output } = await transpile(source, {
      moduleName: pageAwareBaseName(opts.fileName),
      isPageModule: isPageFile(opts.fileName),  // même garde que le chemin bundler
      defaultScriptLang: this.defaultScriptLang,
      templateLang: this.templateLang,
      sigil: this.sigil,
      contextAlias: this.contextAlias,
      varPrefix: this.varPrefix,
      maxStateVars: this.maxStateVars,
      a11y: this.a11y,
      ujsForm: this.ujsForm,
      lint: this.lint,
      colorsEnabled: this.colorsEnabled,
      typeDefs: this.typeDefs,
      effectDefs: this.effectDefs,
      typesText: !this.isProd(),
      devWarnings: !this.isProd(),
      skeleton: this.effectsConf?.skeleton,
      guard: this.effectsConf?.guard,
      typedStores: this.typedStores,
      models: this.componentModels,
    })
    return output
  }

  // --------------------------------------------------------------------------
  // findFiles() : récursif, garde l'extension matching.
  //
  // 3 défauts liés, même fonction :
  //   1. Symlink CASSÉ (cible inexistante) : `statSync` (qui SUIT les
  //      symlinks) throw ENOENT — une SEULE entrée pourrie faisait planter
  //      TOUT le build, sans indiquer laquelle.
  //   2. Cycle de symlinks (dossier qui se référence lui-même, directement
  //      ou via une chaîne) : sans suivi des dossiers déjà visités, la
  //      boucle redescend indéfiniment dans le même sous-arbre → `stack`
  //      grossit sans borne, le build ne se termine JAMAIS.
  //   3. `node_modules` jamais exclu : si `sourceDir` contient (ou est
  //      positionné pour englober) un `node_modules`, la recherche
  //      descendait DEDANS — des milliers de fichiers non pertinents
  //      scannés, potentiellement des `.mjs`/`.civet` internes à une
  //      dépendance ramassés par erreur.
  //
  // Fix : (a) `realpathSync` résout la cible RÉELLE de chaque dossier avant
  // de le marquer visité — détecte un cycle même à travers des symlinks
  // syntaxiquement différents pointant vers le même dossier réel ; un
  // `realpathSync`/`statSync` qui échoue (lien cassé, race de suppression
  // concurrente) fait sauter SEULEMENT cette entrée, jamais tout le build ;
  // (b) `node_modules` exclu explicitement de la descente.
  // --------------------------------------------------------------------------
  private findFiles(dir: string, exts: string[]): string[] {
    if (!existsSync(dir)) return []
    const out: string[] = []
    const stack = [dir]
    const visitedRealDirs = new Set<string>()
    // Confinement RÉEL, pas seulement lexical : un symlink de dossier
    // posé DANS `dir` et pointant HORS de `dir` était suivi normalement (readdirSync/statSync
    // résolvent les liens) — tout .mjs qu'il contenait finissait compilé et publié dans
    // outputDir. `realRoot` est calculé une seule fois sur la racine du scan ; chaque dossier
    // visité doit y rester confiné, sinon build en échec (jamais un silence).
    let realRoot: string
    try {
      realRoot = realpathSync(dir)
    } catch {
      return []  // racine elle-même disparue/cassée — rien à scanner
    }
    while (stack.length > 0) {
      const cur = stack.pop()!
      let realCur: string
      try {
        realCur = realpathSync(cur)
      } catch {
        continue  // dossier disparu / symlink cassé — ignore cette branche
      }
      if (realCur !== realRoot && !realCur.startsWith(realRoot + sep)) {
        throw new Error(t('bundler.index.symlink-hors-racine', { lien: cur, cible: realCur }))
      }
      if (visitedRealDirs.has(realCur)) continue  // cycle détecté — déjà descendu ici
      visitedRealDirs.add(realCur)
      for (const entry of readdirSync(cur)) {
        if (entry === 'node_modules') continue
        const p = join(cur, entry)
        let st
        try {
          st = statSync(p)
        } catch {
          continue  // symlink cassé — ignore CETTE entrée, pas tout le build
        }
        if (st.isDirectory()) stack.push(p)
        else if (exts.includes(extname(p))) out.push(p)
      }
    }
    // `readdirSync` ne garantit
    // AUCUN ordre (varie entre machines/FS). Sans tri : ordre de compilation
    // et « dernier compilé gagne » des collisions non déterministes, et surtout
    // le PREMIER build (sans `.mangle-cache.json`) découvre les props `_mjs_*`
    // dans un ordre variable → hashes différents pour un source identique. Tri
    // final → build reproductible (cohérent avec les tris déjà posés sur les
    // styles/anims/require_dir).
    return out.sort()
  }
}
