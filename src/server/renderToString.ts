// SSR — rendu côté serveur d'un composant MJS en chaîne HTML.
//
// Stratégie « rendre puis remplacer » (render-then-replace) :
//   1. on compile les composants .mjs via le Bundler ;
//   2. on charge le runtime + les composants dans une Window happy-dom ;
//   3. on monte le composant racine et on laisse la réactivité se résoudre ;
//   4. on sérialise le Shadow DOM rendu en Declarative Shadow DOM
//      (`<template shadowrootmode>`), styles scopés inclus.
//
// Le HTML produit s'affiche IMMÉDIATEMENT côté navigateur (SEO + 1er rendu),
// sans JavaScript. Le client reprend ensuite la main (il reconstruit
// la vue interactive et remplace ce HTML statique).
//
// NB : les styles MJS sont appliqués via `adoptedStyleSheets` (constructable
// stylesheets), donc ABSENTS de `shadow.innerHTML`. On ré-inline le CSS du
// composant (`µ._ssrInfo(el)`, cf. `ssrInfo` plus bas) dans le `<template>` pour que le DSD
// transporte aussi les styles — sinon le rendu serveur serait non stylé.

import { mkdtempSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs'
import { join, basename } from 'node:path'
import { tmpdir } from 'node:os'
import * as acorn from 'acorn'
import * as walk from 'acorn-walk'
import { Bundler } from '../bundler/index.js'
import type { I18nConfig, resolveBundlerOpts } from '../bundler/config.js'
// (SSRF) — défense en profondeur : `isBlockedForwardTarget`
// est réappliquée ICI, au point de consommation, PAS seulement dans
// computeForwardedOrigin (render-request.ts) — un appelant qui invoque
// `renderToString`/`createSSRRenderer` DIRECTEMENT (API publique documentée,
// docs/19-ssr.md) et lui passe un `forwardedUrl` sans passer par
// `computeForwardedOrigin` ne doit PAS pouvoir router happy-dom vers une cible
// interne. Cf. forward-origin.ts pour le détail des plages bloquées.
import { isBlockedForwardTarget } from './forward-origin.js'
import { writeHashedAsset } from './ssr-head.js'
import { lightHostCss } from './light-host-css.js'
import { openRenderCompileDir } from './render-compile-dir.js'
import { t } from '../messages/index.js'

export interface SSRRendererOptions {
  /** Répertoire contenant les composants `.mjs` source. */
  sourceDir: string
  /** Répertoire de sortie de la compilation (défaut : dossier temporaire). */
  outputDir?: string
  /**
   * Garde-fou — chemin du bundle compilé
   * (`bundle_modular.js`/`bundle.js`). Défaut inchangé si absent :
   * `join(outputDir, 'bundle.js')` (comportement historique). À transmettre
   * EXPLICITEMENT par tout appelant qui doit respecter un `--manifest` CLI
   * (cf. prerender.ts) — sans ça, ce renderer re-dérive silencieusement son
   * propre chemin, ignorant l'override.
   */
  manifestPath?: string
  /** Langage de script par défaut des composants (défaut : bundler). */
  defaultScriptLang?: 'civet' | 'coffee' | 'ts' | 'js'
  /**
   * Grammaire des interpolations `{…}` du template ET des handlers inline —
   * transmise telle quelle au `Bundler`
   * interne (défaut `'civet'` appliqué côté transpiler). ENCORE INUTILISÉE :
   * la valeur circule jusqu'ici, rien ne la consomme pour l'instant.
   */
  templateLang?: 'civet' | 'js'
  /** `createSSRRenderer` ne transmettait NI `sigil`, NI `contextAlias`, NI
   * `stylesheetsDir` au `Bundler` qu'il construit : un projet configuré en
   * sigil `'mjs'`, ou avec `contextAlias: true`, ou avec des styles partagés
   * dans un dossier NON standard, obtenait un rendu SSR CASSÉ (sigil non
   * reconnu) ou NON STYLÉ (styles partagés introuvables) — alors que `mjs
   * build`/`mjs dev` (qui construisent LEUR PROPRE Bundler avec ces options
   * bien transmises, cf. cli.ts) fonctionnaient normalement. Incohérence
   * CSR/SSR silencieuse. */
  sigil?: 'µ' | 'mjs'
  contextAlias?: boolean
  stylesheetsDir?: string
  /** Même famille d'incohérence CSR/SSR que les trois clés ci-dessus, trouvée en
   *  testant `css: 'lazy'` : sans cette transmission, le Bundler interne du
   *  rendu serveur compile TOUJOURS en `'bundle'`, quel que soit le mode du projet —
   *  le HTML servi ne s'en trouvait pas faux (aucun mode n'inline les feuilles
   *  partagées), mais le rendu serveur écrivait ses propres artefacts de style dans
   *  `outputDir`, dans un mode que le projet n'avait pas choisi. */
  css?: 'bundle' | 'split' | 'lazy'
  /** Mode strict « politique de sécurité de contenu » (clé `csp`, défaut `false`) : le HTML rendu
   *  ne contient alors AUCUN `<style>` ni `<script>` en ligne — les feuilles passent par des
   *  `<link>` vers les fichiers émis, le drapeau d'hydratation par un attribut. Même famille de
   *  transmission que les clés ci-dessus : oubliée, l'option serait morte au rendu serveur. */
  csp?: boolean
  /** Seuil du lint « trop de variables d'état » (transmis au Bundler → transpiler ; 0 = désactivé, défaut 40). */
  maxStateVars?: number
  /** Lint d'accessibilité (`lint.a11y`, transmis au Bundler → transpiler ; défaut `true`). */
  a11y?: boolean
  /** Environnement du build (`mjs build --prod`). Défaut : développement. Ce renderer
   *  RECOMPILE — dans le vrai dossier de sortie quand l'appelant lui en donne un : sans
   *  cette clé, il repasserait le build de l'appelant en développement. */
  env?: 'dev' | 'prod'
  /** BUG D'INTÉGRATION — MANQUANT avant ce correctif : sans cette
   *  transmission, un projet avec `i18n/` + `mjs.config.json` → `i18n` ne
   *  voyait JAMAIS `µ._i18nData` dans le bundle SSR (le `Bundler` interne ne
   *  recevait pas le bloc) — les clés RACINE ne se résolvaient pas côté
   *  serveur, silencieusement. Cf. `MjsConfig.i18n` (config.ts) pour la
   *  sémantique complète. */
  i18n?: I18nConfig
  /**
   * OPTIONS RÉSOLUES du projet (`resolveBundlerOpts(config, configDir)`), transmises TELLES
   * QUELLES au `Bundler` interne — la voie recommandée pour tout appelant qui a déjà une
   * `MjsConfig` en main (prerender.ts, render-request.ts), exactement comme le fait
   * `createBrowserRenderer` (render-browser.ts).
   *
   * Les clés ci-dessus formaient une LISTE BLANCHE écrite à la main :
   * chaque option de config absente de cette liste était silencieusement PERDUE au rendu
   * serveur. Le prérendu de `mjs build` construit son propre Bundler sur le VRAI `outputDir`
   * et recompile par-dessus le build : toute clé manquante ici DÉFAIT le build principal.
   * la minification (`minify`) manquait — un projet configuré en prod voyait son prérendu
   * recompiler en mode DEV : code non minifié, manifeste `dev:true`, et fragments i18n
   * RENOMMÉS en clair (le hachage md5 du contenu est conditionné au mode prod) → le cache
   * navigateur servait une prose périmée sur un nom de fichier stable. Onze autres clés étaient
   * perdues de la même façon (`runtime`, `preload`,
   * `viewTransition`, `urlPrefix`, `defaultTheme`, `varPrefix`, `sourceMap`, `image`,
   * `runtimeDir`, `manifestExternal`, `templateLang`).
   *
   * Les clés explicites ci-dessus continuent de PRIMER quand elles sont renseignées
   * (rétro-compat stricte des appelants directs de l'API publique, cf. docs/19-ssr.md).
   */
  bundlerOpts?: Partial<ReturnType<typeof resolveBundlerOpts>>
}

export interface RenderOptions {
  /**
   * Props initiales, passées en attributs HTML sur la balise racine.
   * Scalaires → attribut direct ; objets/tableaux → attribut JSON, ré-hydraté
   * automatiquement au montage (serveur ET client) par parseProp.
   */
  props?: Record<string, unknown>
  /**
   * État du store global initial (`$$x` / µ.store), injecté avant le rendu
   * serveur et sérialisé inline pour réhydratation au boot client. Le résultat
   * expose `sharedScript`, à placer UNE fois dans la page.
   */
  store?: Record<string, unknown>
  /**
   * Stratégie de reprise en main côté client (défaut : 'replace') :
   *   'replace'    — render-then-replace : le client reconstruit la vue à côté
   *                  et remplace la « photo » serveur (rien à préparer au rendu).
   *   'markers'    — hydratation par marqueurs : le serveur étiquette les nœuds
   *                  réactifs ; le client les retrouve et les adopte (0 création).
   *   'positional' — hydratation par walk positionnel (sans marqueurs).
   *   'diff'       — hydratation par diff/réconciliation (plus robuste).
   */
  ssrMode?: 'replace' | 'markers' | 'positional' | 'diff'
  /** Mode du shadow root déclaratif émis (défaut : 'open'). */
  shadowMode?: 'open' | 'closed'
  /** Plafond d'attente du rendu, en ms (défaut : 1000). L'attente s'arrête dès
   *  que le rendu est stable (scheduler au repos + {await} résolus). */
  settleMs?: number
  /**
   * `render.forwardOrigin` (mjs.config.json, défaut SÛR — cf. forward-origin.ts)
   * — URL RÉELLE (origine + chemin) de la page en cours de rendu, transmise par
   * render-request.ts via `computeForwardedOrigin` (SSR PAR REQUÊTE UNIQUEMENT —
   * LIMITE documentée : le PRÉRENDU, au build, n'a aucune requête entrante, ne la
   * fournit jamais, reste sur 'http://localhost/').
   *   - happy-dom (CE fichier) : devient l'URL de la `Window` (localhost figé
   *     sinon) — les fetch RELATIFS de l'app ({await fetch('/api/x')}) atteignent
   *     alors le VRAI back plutôt qu'un localhost qui ne répond jamais.
   *   - navigateur (render-browser.ts) : la page continue de vivre sur l'origine
   *     FACTICE de l'amorçage (mjs-render.invalid, cf. son en-tête de fichier) —
   *     seule l'ORIGINE (`new URL(forwardedUrl).origin`) sert, comme cible du
   *     PROXY des chemins non-assets (cf. son routeHandler).
   * (SSRF) — une valeur ici pointant vers une cible réseau
   * interne (`isBlockedForwardTarget`) est REFUSÉE au point de consommation (cf.
   * plus bas) : jamais de confiance aveugle en cette option, même passée
   * directement par un appelant de l'API (hors render-request.ts).
   */
  forwardedUrl?: string
  /**
   * En-tête `Cookie` BRUT de la requête entrante (`'a=1; b=2'`), transmis avec
   * `forwardedUrl` (même garde `render.forwardOrigin`, même limite prérendu).
   * happy-dom : injecté via `document.cookie` (UNE paire par assignation — cf.
   * point d'usage, sondé empiriquement : une assignation brute multi-paires n'en
   * retient qu'UNE). Jamais transmis comme en-tête `fetch()` manuel : `Cookie`
   * est un en-tête INTERDIT côté script (happy-dom l'ignore silencieusement,
   * spec-conforme, vérifié empiriquement) — seule la voie `document.cookie`
   * fonctionne, mais suffit : happy-dom applique déjà la vraie politique
   * même-origine (CORS, `FetchCORSUtility`) à l'ENVOI, jamais de fuite
   * cross-origine (sondé, cf. commentaire au point d'usage).
   */
  forwardedCookie?: string
  /**
   * Racine montée en MODE LÉGER (`mjs-light`) : aucun Shadow DOM, le contenu rendu vit en ENFANTS
   * DIRECTS de la balise, et sa feuille scopée voyage avec le fragment (`:host` réécrit en nom de
   * balise — un léger n'a pas d'hôte réel). À poser quand la coquille monte déjà
   * `<mjs-x mjs-light>` : le HTML servi décrit alors le MÊME arbre que celui que le client rebâtit.
   * Vient de `render.routes[url].light` au prérendu (cf. bundler/config.ts).
   *
   * Le mode se décide AU CONSTRUCTEUR (runtime/mjs_element.ts) : ni l'attribut posé par le parseur
   * happy-dom ni celui posé après `document.createElement` n'y sont visibles à temps. On passe donc
   * par la propriété statique `mjsLight` de la classe du composant — la voie que ce constructeur
   * prévoit pour EXACTEMENT ce cas — plutôt que par le drapeau transitoire `_mjs_*` du code généré,
   * dont le nom est RACCOURCI dès que le bundle est minifié et donc innommable depuis ici.
   */
  light?: boolean
}

export interface RenderResult {
  /** HTML complet : `<tag><template shadowrootmode>…</template></tag>`. */
  html: string
  /** Contenu sérialisé du shadow (markup, hors le `<style>` DE LA RACINE — cf. `css` ci-dessous).
   *  Sérialisation RÉCURSIVE (`serializeShadow`) — un sous-composant à shadow propre
   *  imbriqué ici embarque le SIEN dans son propre `<template shadowrootmode>`, lui compris. */
  shadowHtml: string
  /** CSS scopé du composant (inliné dans le DSD). */
  css: string
  /** true si le composant est en mode `mjs-light` (pas de shadow). */
  light: boolean
  /** `<script>` JSON de l'état partagé global, à placer UNE fois dans la page
   *  (vide si aucun état partagé). Le runtime le réhydrate au boot. */
  sharedScript: string
  /** `<script>` activant l'hydratation côté client (vide si `hydratable` absent).
   *  À placer dans la page, avant le bundle. */
  hydrateScript: string
  /** Avertissements de compilation. */
  warnings: string[]
}

export interface SSRRenderer {
  /** Rend un composant déjà compilé en chaîne HTML (DSD). */
  renderToString(tag: string, options?: RenderOptions): Promise<RenderResult>
  /** Libère les ressources du bundler. */
  close(): Promise<void>
  /** Compte les appels au crochet `µ._i18nLoadSync` (lecture disque paresseuse d'une
   *  section i18n) depuis la création de ce renderer, tous rendus confondus. Diagnostic/tests :
   *  un appel par section RÉELLEMENT consultée par un composant, indépendant du cache mémoire
   *  interne (chemin, mtime) qui évite seulement la relecture PHYSIQUE d'un fichier inchangé. */
  i18nLoadCount: number
}

// Retire la syntaxe ESM pour permettre l'éval dans happy-dom (pas de loader
// module). Même traitement que le harness de conformance.
//
// Analyse par un VRAI parseur JS (acorn, déjà une dépendance du paquet — cf.
// bundler/index.ts, même motif `acorn.parse` + `acorn-walk`) plutôt que des
// expressions régulières sur le texte brut : une regex ne distingue jamais un
// mot-clé `import`/`export` RÉEL d'un texte qui lui ressemble — reproduit en
// pratique par un composant de doc qui AFFICHE un exemple de code
// (`"export default hello import.meta.url"`, en TEXTE, jamais exécuté) que la
// regex réécrivait quand même, ou par un `export` mentionné dans un
// COMMENTAIRE (`// export function clear() {}`) pris pour un vrai export →
// `ReferenceError` à l'éval pour un nom jamais déclaré. L'AST ne visite QUE
// les déclarations top-level (`Program.body` — la grammaire ES interdit
// `import`/`export` ailleurs) et les expressions réelles (`import.meta.url`,
// cherché par un walk) : une chaîne, un template literal ou un commentaire
// n'en font jamais partie, donc jamais touchés.
//
// Édition par TRANCHES DE POSITIONS (`node.start`/`node.end`, offsets acorn),
// jamais de régénération de code (codegen) : le texte hors des nœuds touchés
// reste identique OCTET POUR OCTET à l'entrée — même garantie que les
// anciennes regex, mécanisme différent. `stripEsm` et `ssrScopeFile`
// partagent les petits utilitaires ci-dessous.
type Edit = { start: number, end: number, text: string }

function applyEdits(src: string, edits: Edit[]): string {
  edits.sort((a, b) => a.start - b.start)
  let out = ''
  let pos = 0
  for (const e of edits) {
    out += src.slice(pos, e.start) + e.text
    pos = e.end
  }
  return out + src.slice(pos)
}

// `import.meta.url` : cherché par un walk COMPLET de l'AST (peut apparaître à
// n'importe quelle profondeur — `new URL('.', import.meta.url)` dans chaque
// composant compilé, pas seulement en tête de fichier). Un seul motif AST
// (MemberExpression dont l'objet est le MetaProperty `import.meta` et la
// propriété `url`) : par construction, ne matche jamais l'intérieur d'une
// chaîne/d'un commentaire qui en citerait le texte (absents de l'AST).
function findImportMetaUrlEdits(ast: any, edits: Edit[]): void {
  walk.simple(ast, {
    MemberExpression(node: any) {
      if (node.computed) return
      const obj = node.object
      if (obj?.type !== 'MetaProperty' || obj.meta?.name !== 'import' || obj.property?.name !== 'meta') return
      if (node.property?.type !== 'Identifier' || node.property.name !== 'url') return
      edits.push({ start: node.start, end: node.end, text: "'http://localhost/'" })
    },
  })
}

// Fin du préfixe `export` (ou `export default`) d'un nœud DÉJÀ identifié par
// l'AST — la petite regex ci-dessous mesure juste sa longueur EXACTE dans LA
// SOURCE (espaces variables) ; elle n'opère que sur la tranche d'un nœud déjà
// confirmé par le parseur, jamais sur du texte libre.
function exportPrefixEnd(src: string, node: any, withDefault: boolean): number {
  const re = withDefault ? /^export\s+default\s+/ : /^export\s+/
  const m = re.exec(src.slice(node.start, node.end))!
  return node.start + m[0].length
}

// Noms liés par une déclaration exportée (`export const/let/var/function/class …`)
// — walk minimal des formes de déclarateur (identifiant simple, déstructuration).
function declaredNames(decl: any): string[] {
  if (decl.type === 'FunctionDeclaration' || decl.type === 'ClassDeclaration') return decl.id ? [decl.id.name] : []
  if (decl.type !== 'VariableDeclaration') return []
  const names: string[] = []
  const collect = (pat: any): void => {
    if (!pat) return
    if (pat.type === 'Identifier') names.push(pat.name)
    else if (pat.type === 'ObjectPattern') for (const p of pat.properties) collect(p.type === 'RestElement' ? p.argument : p.value)
    else if (pat.type === 'ArrayPattern') for (const el of pat.elements) collect(el)
    else if (pat.type === 'AssignmentPattern') collect(pat.left)
    else if (pat.type === 'RestElement') collect(pat.argument)
  }
  for (const d of decl.declarations) collect(d.id)
  return names
}

export const stripEsm = (s: string): string => {
  let ast: any
  try {
    ast = acorn.parse(s, { ecmaVersion: 'latest', sourceType: 'module' })
  } catch {
    // le cœur compilé est TOUJOURS un module ES valide (sortie esbuild) — un
    // échec de parse ici trahit un AUTRE bug, en amont ; repli sûr : rien
    // retiré plutôt qu'une regex qui rouvrirait le risque texte/chaîne.
    return s
  }
  const edits: Edit[] = []
  findImportMetaUrlEdits(ast, edits)
  for (const node of ast.body) {
    if (node.type === 'ImportDeclaration' || node.type === 'ExportAllDeclaration') {
      edits.push({ start: node.start, end: node.end, text: '' })
      continue
    }
    if (node.type === 'ExportDefaultDeclaration') {
      edits.push({ start: node.start, end: exportPrefixEnd(s, node, true), text: '' })
      continue
    }
    if (node.type !== 'ExportNamedDeclaration') continue
    if (node.declaration) {
      edits.push({ start: node.start, end: exportPrefixEnd(s, node, false), text: '' })
      continue
    }
    // `export { a, b as µ } [from '...']` — stripEsm n'expose rien lui-même
    // (pas de `return {}`, contrairement à ssrScopeFile : le cœur tourne en
    // scope global) ; seul un binding RENOMMÉ vers `µ` (mangler, build
    // minifié — `export{i as µ}`) a besoin d'un pont, `µ` lui-même étant déjà
    // global une fois ce bloc retiré (`globalThis.µ = µ;`, posé par
    // l'appelant juste après). L'AST décode déjà la forme échappée du
    // mangler (`µ`) comme le VRAI caractère `µ` pour `.name` — aucun
    // distinguo à coder à la main entre les deux graphies.
    const reinject: string[] = []
    if (!node.source) {
      for (const spec of node.specifiers) {
        if (spec.exported.name === 'µ' && spec.local.name !== 'µ') reinject.push(`var µ = ${spec.local.name};`)
      }
    }
    edits.push({ start: node.start, end: node.end, text: reinject.join('') })
  }
  return applyEdits(s, edits)
}

// Nom de fichier compilé → identifiant JS unique et valide (portée de fichier SSR).
// Remplacer tout non-[\w$] par un
// simple `_` faisait COLLISIONNER `a-b.js` et `a.b.js` (même id `_mjsF_a_b`) →
// un fichier écrasait l'autre dans les maps par-id (codeById/idToFile), chargeant
// le mauvais code. On encode le CODE du caractère (`-`→`_45_`, `.`→`_46_`) :
// l'id reste un identifiant JS valide, mais devient distinct selon le séparateur.
// ENCODAGE NON INJECTIF — un underscore LITTÉRAL du nom d'origine est un
// caractère de mot (`\w`), donc jamais remplacé par le passage ci-dessus : il
// traverse tel quel, INDISTINGUABLE d'un underscore produit par l'encodage d'un
// séparateur. `a-b.js` (→ `a` + `_45_` + `b`) et `a_45_b.js` (déjà tout en
// caractères de mot, rien à remplacer) produisaient tous deux `_mjsF_a_45_b`.
// Fix : échapper AUSSI le caractère d'échappement lui-même (`_` littéral →
// `_u_`, jamais confondu avec un code — un code est TOUJOURS une suite de
// chiffres, jamais la lettre `u`) — l'ensemble des tokens (chars de mot restants
// en clair, `_u_`, `_<code>_`) redevient uniquement décodable, donc injectif.
export function fileToId(file: string): string {
  const stem = file.replace(/\.js$/, '')
  return '_mjsF_' + stem.replace(/[^\w$]|_/g, (ch) => ch === '_' ? '_u_' : '_' + ch.charCodeAt(0) + '_')
}

// Enveloppe UN fichier compilé (module OU composant) dans sa PROPRE portée au SSR
// (Option A — portée totale par module, façon vrai ESM).
//
// Le SSR concatène tous les `.js` dans UN SEUL contexte d'éval (happy-dom n'a pas
// de loader de modules). Sans isolation, deux fichiers déclarant/exportant un même
// nom (une variable privée `data`, ou deux exports `trapFocus`) se télescopent →
// l'éval plante, ou pire, le mauvais export gagne silencieusement. En vrai ESM
// chaque fichier a sa portée — on la RESTAURE ici, proprement :
//   - le corps part dans une IIFE (ses privés ET ses exports y restent locaux) ;
//   - ses exports ressortent par `const _mjsF_x = (function(){ … return {…} })()` ;
//   - chaque `import { a } from "y"` devient `const { a } = _mjsF_y` À L'INTÉRIEUR
//     de l'IIFE → les références nues résolvent LOCALEMENT, SANS réécrire les
//     occurrences (donc zéro risque de corrompre une chaîne/clé/propriété homonyme).
//
// `µ` (core) est un global posé avant l'éval → ses imports sont simplement retirés.
// Retourne le code enveloppé + les ids des fichiers dont il dépend (pour l'ordre).
//
// Détection par un VRAI parseur — même principe et même motivation que
// `stripEsm` (cf. son en-tête) : seules les déclarations `import`/`export`
// RÉELLES sont réécrites, jamais une chaîne ou un commentaire qui leur
// ressemble.
export function ssrScopeFile(
  raw: string,
  id: string,
  resolve: (url: string) => string | null,
): { code: string; deps: string[] } {
  const deps = new Set<string>()
  const preamble: string[] = []
  const exp = new Map<string, string>()

  let ast: any
  try {
    ast = acorn.parse(raw, { ecmaVersion: 'latest', sourceType: 'module' })
  } catch {
    // un composant/module compilé est TOUJOURS un module ES valide (sortie
    // esbuild) — un échec de parse ici trahit un AUTRE bug, en amont : repli
    // total (aucun import/export retiré) plutôt qu'un throw qui court-
    // circuiterait le nettoyage du compilateur appelant (`abandon()`, cf.
    // createSSRRenderer).
    return { code: `const ${id} = (function(){\n${raw}\n})();`, deps: [] }
  }

  const edits: Edit[] = []
  findImportMetaUrlEdits(ast, edits)

  // `imported: local` en destructuration ; nom seul quand identiques.
  const specText = (s: any): string => s.local.name === s.imported.name ? s.local.name : `${s.imported.name}: ${s.local.name}`

  for (const node of ast.body) {
    if (node.type === 'ImportDeclaration') {
      edits.push({ start: node.start, end: node.end, text: '' })
      const specs = node.specifiers
      if (specs.length === 0) {
        // 3. Import à EFFET DE BORD (`import "url"`) — rien à destructurer dans
        // le préambule, mais la dépendance compte quand même pour le tri
        // topologique : sans elle, une cible sans binding importé n'était
        // jamais garantie évaluée AVANT son importateur.
        const targetId = resolve(node.source.value)
        if (targetId) deps.add(targetId)
        continue
      }
      if (specs.some((sp: any) => sp.type === 'ImportNamespaceSpecifier')) continue   // forme jamais émise par le compilateur, laissée telle quelle
      const def = specs.find((sp: any) => sp.type === 'ImportDefaultSpecifier')
      const named = specs.filter((sp: any) => sp.type === 'ImportSpecifier')
      const targetId = resolve(node.source.value)
      if (def) {
        // 2. Import DÉFAUT (`import def from "url"`, + `, { a, b }` éventuel) —
        // `.default` si la cible en expose un, sinon son espace de noms entier
        // (cible externe/core non résolue : `undefined`, l'usage réel d'une lib
        // externe est côté client, court-circuité au SSR par `µ._isServer`).
        if (targetId) {
          deps.add(targetId)
          preamble.push(`const ${def.local.name} = (${targetId} && ${targetId}.default !== undefined) ? ${targetId}.default : ${targetId};`)
          if (named.length) preamble.push(`const { ${named.map(specText).join(', ')} } = ${targetId};`)
        } else {
          preamble.push(`const ${def.local.name} = undefined;`)
          if (named.length) preamble.push(`const { ${named.map((sp: any) => sp.local.name).join(', ')} } = {};`)
        }
        continue
      }
      // 1. Import NOMMÉ (`import { a, b as c } from "url"`).
      if (targetId) {
        deps.add(targetId)
        preamble.push(`const { ${named.map(specText).join(', ')} } = ${targetId};`)
      } else {
        // cible core/externe non résolue : seul un renommage DEPUIS `µ` (build
        // minifié, le mangler raccourcit le binding local) a besoin d'un pont ;
        // les autres noms sont des globaux ou des usages court-circuités.
        for (const sp of named) if (sp.imported.name === 'µ' && sp.local.name !== 'µ') preamble.push(`const ${sp.local.name} = µ;`)
      }
      continue
    }

    if (node.type === 'ExportAllDeclaration') {
      edits.push({ start: node.start, end: node.end, text: '' })   // jamais émis par le compilateur
      continue
    }

    if (node.type === 'ExportDefaultDeclaration') {
      // 4b. `export default <X>` → ré-exposé comme `default`. Une déclaration
      // NOMMÉE (function/class) garde son nom en portée (un composant fait
      // `customElements.define(tag, MjsFoo)` juste après) ; un défaut ANONYME
      // ou une expression est assigné à un local synthétique récupérable —
      // sans ça, `function(){}` nu en statement lève "Function statements
      // require a function name" à l'éval.
      const d = node.declaration
      const named = (d.type === 'FunctionDeclaration' || d.type === 'ClassDeclaration') && d.id
      const prefixEnd = exportPrefixEnd(raw, node, true)
      if (named) {
        edits.push({ start: node.start, end: prefixEnd, text: '' })
        exp.set('default', d.id.name)
      } else {
        edits.push({ start: node.start, end: prefixEnd, text: 'const __mjsDefault = ' })
        exp.set('default', '__mjsDefault')
      }
      continue
    }

    if (node.type !== 'ExportNamedDeclaration') continue

    if (node.declaration) {
      // `export const/let/var/function/class …` : la déclaration reste (le
      // nom doit rester en portée), seul le mot-clé `export` est retiré.
      edits.push({ start: node.start, end: exportPrefixEnd(raw, node, false), text: '' })
      for (const name of declaredNames(node.declaration)) exp.set(name, name)
      continue
    }

    if (node.source) {
      // 4a. Ré-export `export { a, b as c } from "url"` — exposé depuis la
      // cible résolue (`_mjsF_url.a`), jamais collecté comme une déclaration
      // locale. Latent (aucun composant MJS n'en émet à date), mais élimine un
      // tueur silencieux du window.eval() géant concaténé.
      const targetId = resolve(node.source.value)
      if (targetId) {
        deps.add(targetId)
        for (const sp of node.specifiers) exp.set(sp.exported.name, `${targetId}.${sp.local.name}`)
      }
      edits.push({ start: node.start, end: node.end, text: '' })
      continue
    }

    // `export { a, b as c }` — réexpose chaque binding local tel quel.
    for (const sp of node.specifiers) exp.set(sp.exported.name, sp.local.name)
    edits.push({ start: node.start, end: node.end, text: '' })
  }

  const body = applyEdits(raw, edits)
  const ret = exp.size
    ? `\nreturn { ${Array.from(exp).map(([k, v]) => (k === v ? k : `${k}: ${v}`)).join(', ')} };`
    : ''
  const head = preamble.length ? preamble.join('\n') + '\n' : ''
  return { code: `const ${id} = (function(){\n${head}${body}${ret}\n})();`, deps: [...deps] }
}

// Tri topologique : une cible d'import doit être évaluée AVANT son importateur
// (les `const _mjsF_x` ne sont pas hissés → TDZ). L'ordre d'entrée est préservé
// pour les fichiers indépendants.
//
// Un CYCLE d'`@import` (A importe B qui
// importe A, directement ou via une chaîne) n'a, PAR DÉFINITION, AUCUN ordre
// topologique valide : au moins un des deux fichiers doit s'évaluer AVANT
// celui dont il dépend. Comme chaque fichier destructure ENTIÈREMENT ses
// imports en TÊTE de sa propre IIFE (`const { fn } = _mjsF_B` avant tout le
// reste du corps), et que `_mjsF_B` est un `const` NON hissé (TDZ) tant que
// l'IIFE de B n'a pas terminé de s'exécuter, l'ancien repli ("reste d'un
// cycle, ordre d'origine") provoquait à coup sûr un
// `ReferenceError: Cannot access '_mjsF_x' before initialization` à l'éval —
// contrairement au VRAI ESM (bindings live, résolution paresseuse) qu'utilise
// le bundle CLIENT, qui supporte ce cas. Le crash est GARANTI ici (pas une
// simple heuristique) : dès qu'un id reste hors de `out` après la BFS de
// Kahn, c'est qu'il appartient à un cycle (ou en dépend) et plantera à coup
// sûr. Fix : détecter ce reste et lever une erreur EXPLICITE nommant les
// fichiers concernés, au lieu de laisser le ReferenceError natif (sans aucun
// rapport évident avec sa cause) atteindre l'éval.
export function topoSortFiles(ids: string[], depsById: Map<string, string[]>, idToFile: Map<string, string>): string[] {
  const indeg = new Map<string, number>()
  const adj = new Map<string, string[]>()
  for (const id of ids) { indeg.set(id, 0); adj.set(id, []) }
  for (const id of ids) {
    for (const d of depsById.get(id) || []) {
      if (!adj.has(d)) continue   // dépendance hors de cet ensemble (ex. runtime) → déjà placée
      adj.get(d)!.push(id)
      indeg.set(id, indeg.get(id)! + 1)
    }
  }
  // PERF — file traitée par POINTEUR (au lieu
  // de `queue.shift()` en O(n) sur un tableau) et test d'appartenance final via
  // Set (au lieu de `out.includes` en O(n²)) : Kahn en O(n + arêtes). Ordre de
  // sortie STRICTEMENT identique (mêmes règles d'ajout à la file).
  const queue = ids.filter(id => indeg.get(id) === 0)
  const out: string[] = []
  for (let qi = 0; qi < queue.length; qi++) {
    const id = queue[qi]
    out.push(id)
    for (const nxt of adj.get(id)!) {
      indeg.set(nxt, indeg.get(nxt)! - 1)
      if (indeg.get(nxt) === 0) queue.push(nxt)
    }
  }
  const outSet = new Set(out)
  const blocked = ids.filter(id => !outSet.has(id))
  if (blocked.length > 0) {
    const names = blocked.map(id => idToFile.get(id) || id).sort()
    throw new Error(t('server.ssr-import-circulaire', { names: names.join(', ') }))
  }
  return out
}

function escapeAttr(v: string): string {
  return String(v)
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
}

// Seul `</` était échappé. Le parsing HTML entre dans un état
// "script data (double) escaped" dès qu'un contenu SCRIPT contient `<!--` PUIS `<script` — dans cet
// état, un `</script>` LITTÉRAL (même le VRAI, posé juste après le JSON) n'est PLUS reconnu comme
// terminateur : le parseur avale tout le reste de la page (dont le `<script>` qui charge le bundle)
// comme simple texte — bundle jamais exécuté. Un contenu utilisateur portant `<!--` puis `<script`
// (ex. un commentaire stocké réactivement) suffit à déclencher ceci ; `</` seul ne protège pas contre
// `<!--`/`<script` isolés. Fix : échapper TOUT `<` en la séquence \u003c — échappement JSON
// VALIDE (round-trip exact via `JSON.parse` côté client, aucune perte d'info) qui élimine TOUT
// déclencheur possible de ces états spéciaux. Exportée : réutilisée par render-server.ts (µres au
// 1er chargement HTML) — même garantie, même fonction, pas de duplication de ce correctif.
export function escapeJsonForScript(json: string): string {
  return json.replace(/</g, '\\u003c')
}

// `hasPendingAwait`/`settleRender` ne
// regardaient QUE `_mjs_awaitStates` de la RACINE : un SOUS-COMPOSANT (imbriqué,
// shadow OU light) avec son PROPRE `{await}` encore pending était totalement
// invisible d'ici — `_mjs_awaitStates` est PAR INSTANCE, l'invalidation d'un
// await imbriqué se fait sur L'ENFANT, jamais remontée à la racine. Le
// serveur sérialisait alors le bloc {await} imbriqué encore figé sur son
// état "pending" (ex. un spinner de chargement) dans le HTML servi, alors
// que le VRAI contenu résolu n'apparaît qu'après hydratation client —
// divergence SSR/client visible (flash de contenu). Fix : walk récursif de
// TOUT l'arbre (shadow ET light DOM) collectant `_mjs_awaitStates` de CHAQUE
// composant rencontré, pas seulement la racine.
//
// PIÈGE (découvert en écrivant le test de régression) : mjs_element.ts attache
// le Shadow DOM en mode `'closed'` par défaut (attachShadow({mode:'closed'})) —
// la propriété NATIVE `el.shadowRoot` renvoie donc TOUJOURS null/undefined
// pour une instance MJS normale, c'est tout le POINT du mode closed. Le
// framework garde SA PROPRE référence dans `el._shadow` (posée par
// mjs_element.ts), exactement celle que ce fichier utilise déjà plus bas
// pour sérialiser la racine (`el._shadow?.innerHTML`). Un premier essai basé
// sur `el.shadowRoot` compilait sans erreur (`any`) mais ne traversait JAMAIS
// aucun sous-composant — silencieusement inopérant. En mode `mjs-light`,
// `_shadow === el` (pas de vrai shadow) : la garde `!== el` évite de
// descendre deux fois dans le même sous-arbre (explosion combinatoire sinon).
export function collectAwaitStates(el: any, out: any[] = []): any[] {
  if (!el) return out
  const core: any = ssrCoreOf(el)
  const states: any = core && core._ssrInfo ? core._ssrInfo(el).awaitStates : null
  if (states) out.push(states)
  if (el._shadow && el._shadow !== el && el._shadow.children) {
    for (const child of el._shadow.children) collectAwaitStates(child, out)
  }
  if (el.children) {
    for (const child of el.children) collectAwaitStates(child, out)
  }
  return out
}

// true tant qu'un bloc {await} DE TOUT L'ARBRE (racine OU imbriqué) est en
// statut 'pending'.
export function hasPendingAwait(el: any): boolean {
  for (const states of collectAwaitStates(el)) {
    if (!states || typeof states.forEach !== 'function') continue
    let pending = false
    states.forEach((st: any) => { if (st && st.status === 'pending') pending = true })
    if (pending) return true
  }
  return false
}

// Attend la fin du rendu : poll jusqu'à stabilité — aucun rendu planifié
// (`_mjs_render_scheduled`) ET aucun {await} en attente — avec un plafond de
// sécurité. Bien plus fiable qu'un délai fixe : s'arrête dès que c'est stable,
// patiente le temps qu'un contenu asynchrone ({await}) se résolve.
// Retournait `void` : au plafond
// `maxMs` avec un {await} encore pending (ou un rendu planifié), elle sortait
// EXACTEMENT comme si le rendu était stable → HTML figé sur un état transitoire
// (spinner/placeholder) sérialisé SANS le moindre signal. On retourne désormais
// un booléen (true = stabilisé avant le plafond, false = plafond atteint) pour
// que l'appelant AVERTISSE (warnings du RenderResult) au lieu de laisser une
// divergence SSR/client silencieuse.
// Exportée (import/export minime — cf. render-browser.ts) : le moteur navigateur
// réutilise CE MÊME critère de stabilité (scheduler + {await}), injecté tel quel
// (source de la fonction) dans la page réelle — un seul critère, deux moteurs.
export async function settleRender(el: any, maxMs: number): Promise<boolean> {
  const step = 5
  let elapsed = 0
  let stable = 0
  while (elapsed < maxMs) {
    await new Promise(r => setTimeout(r, step))
    elapsed += step
    const core: any = ssrCoreOf(el)
    const busy = (el && core && core._ssrInfo && core._ssrInfo(el).renderScheduled) || hasPendingAwait(el)
    if (busy) {
      stable = 0
    } else if (++stable >= 2) {
      return true
    }
  }
  return false
}

// Garde-fou — `el._shadow.innerHTML` (utilisé jusqu'ici pour
// sérialiser le shadow rendu) est le getter DOM STANDARD : par définition (encapsulation Shadow
// DOM), il ne traverse JAMAIS le shadow d'un DESCENDANT — un `<@sous-composant>`, même immédiat
// (1er niveau de composition, le cas normal d'une vraie app), ressortait comme une balise
// strictement VIDE (`<mjs-inner></mjs-inner>`) dans le HTML servi, perte totale de SEO/1er-paint
// pour tout ce qui est composé. `serializeShadow` walk récursivement : pour CHAQUE descendant qui
// porte SON PROPRE `_shadow` (custom element MJS monté, `_shadow !== soi-même` — cf.
// `collectAwaitStates` plus haut pour le même patron d'accès), réinjecte manuellement son
// `<template shadowrootmode>` + son `<style>` + son contenu, récursivement.

// Feuille scopée et mode light d'un composant monté, lus par l'accès à nom LONG que le runtime
// expose (`µ._ssrInfo`, runtime/mjs_element.ts). Les propriétés internes `_mjs_*` portent un nom
// RACCOURCI dès que le bundle est minifié (production, esbuild mangleProps) : nommées DEPUIS ICI —
// code qui n'a pas été compilé avec ce bundle — elles ne rendent rien, et le `<style>` du
// `<template shadowrootmode>` comme le mode light partiraient en silence. `baseCss` est rendu BRUT
// (le trim appartient à chaque point d'usage).
function ssrInfo(node: any): { baseCss: string; isLight: boolean; nodes: any; awaitStates: any; renderScheduled: boolean } {
  const info: any = ssrCoreOf(node)._ssrInfo(node)
  return { baseCss: info.baseCss == null ? '' : String(info.baseCss), isLight: info.isLight === true, nodes: info.nodes, awaitStates: info.awaitStates, renderScheduled: info.renderScheduled === true }
}

// Le cœur, vu d'un nœud, quel que soit le moteur : happy-dom le pose en `µ` dans la fenêtre de son
// bac à sable, la page réelle du moteur navigateur en `window.__mjsCore` (cf. render-browser.ts,
// page d'amorçage). Les trois fonctions de stabilité ci-dessous sont partagées TELLES QUELLES avec
// ce moteur (leur source est injectée dans la page) : elles ne peuvent nommer aucune propriété
// `_mjs_*` — raccourcie dès que le bundle est minifié — et passent donc toutes par cet accès.
export function ssrCoreOf(node: any): any {
  const win: any = (node && node.ownerDocument && node.ownerDocument.defaultView) || (typeof window === 'undefined' ? null : window)
  return win && (win.__mjsCore || win.µ)
}

// Marque chaque élément `mjs-*` de l'arbre rendu (attribut `mjs-ssr`, vide) : c'est ce que le
// bouclier anti-FOUC du cœur épargne (`:not(:defined):not([mjs-ssr])`, runtime/mjs_init.ts) — le
// balisage peint par le serveur reste à l'écran jusqu'à ce que le premier rendu client le remplace.
// Descend dans le light DOM ET dans chaque shadow (même patron d'accès que `collectAwaitStates` :
// `_shadow !== node` évite de redescendre deux fois en mode light). L'attribut n'a rien à retirer
// côté client : il DÉCRIT le balisage servi, il ne pilote aucun montage.
function markSsrTree(node: any): void {
  if (!node) return
  if (node.setAttribute && node.tagName && String(node.tagName).toUpperCase().startsWith('MJS-')) node.setAttribute('mjs-ssr', '')
  if (node._shadow && node._shadow !== node) { for (const child of Array.from(node._shadow.children) as any[]) markSsrTree(child) }
  if (node.children) { for (const child of Array.from(node.children) as any[]) markSsrTree(child) }
}

// true si CE noeud ou un de ses descendants est un composant MJS à shadow root propre — détermine
// s'il faut descendre à la main (sérialisation manuelle) ou si le natif suffit encore.
function hasNestedShadow(node: any): boolean {
  if (node._shadow && node._shadow !== node) return true
  if (node.children) {
    for (const child of node.children) if (hasNestedShadow(child)) return true
  }
  return false
}

/**
 * Comment la feuille scopée d'un composant voyage dans le HTML rendu : `<style>` en ligne par
 * défaut, `<link>` vers un fichier haché sous le mode strict (`csp`) — un `<style>` en ligne y
 * serait refusé par `style-src`, à TOUT niveau de composition (racine comme sous-composant), pas
 * seulement à la racine. Un seul emetteur, décidé une fois par renderer et transmis jusqu'au fond
 * de la sérialisation : une branche qui l'oublierait rouvrirait le trou.
 */
export type FeuilleBalise = (css: string, tag: string) => string

/** Défaut hors mode strict : la feuille voyage en ligne, `</style` neutralisé (round-trip exact). */
const feuilleEnLigne: FeuilleBalise = (css) => css ? `<style>${css.replace(/<\/(style)/gi, '<\\/$1')}</style>` : ''

// Sérialise UN noeud (texte, commentaire ou élément). Délègue ENTIÈREMENT au natif partout où
// AUCUN descendant ne porte de shadow propre — sortie BYTE IDENTIQUE à l'ancien `innerHTML` pour
// tout composant sans sous-composant à shadow (zéro régression sur l'existant, la composition de
// plusieurs sérialisations natives PAR NOEUD égale la sérialisation native du PARENT entier).
function serializeShadowNode(node: any, shadowMode: 'open' | 'closed', lightSeen: Set<string>, feuille: FeuilleBalise): string {
  if (node.nodeType === 1) {
    if (!hasNestedShadow(node)) return node.outerHTML
    return serializeShadowHost(node, shadowMode, lightSeen, feuille)
  }
  // texte/commentaire : pas d'`outerHTML` natif sur ces types — un wrapper jetable délègue
  // l'échappement au sérialiseur natif (identique à ce qu'`innerHTML` aurait produit ici).
  const wrapper = node.ownerDocument.createElement('div')
  wrapper.appendChild(node.cloneNode(true))
  return wrapper.innerHTML
}

// Ré-émet la balise ouvrante/fermante NATIVE (attributs compris, via un clone SANS enfants — donc
// forcément `<tag attrs></tag>`, jamais ambigu) autour du contenu recomposé : le sous-composant
// réinjecte son PROPRE `<template shadowrootmode>` + `<style>` s'il porte un shadow propre à LUI
// (`node._shadow !== node`), sinon (élément normal, ou composant `mjs-light` sans vrai shadow) la
// récursion continue directement sur ses enfants — c'est LÀ qu'un shadow plus profond sera trouvé.
function serializeShadowHost(node: any, shadowMode: 'open' | 'closed', lightSeen: Set<string>, feuille: FeuilleBalise): string {
  const tagName = String(node.tagName).toLowerCase()
  const emptyTag = node.cloneNode(false).outerHTML
  const closeTag = `</${tagName}>`
  const openTag = emptyTag.slice(0, emptyTag.length - closeTag.length)
  let inner = ''
  // Garde-fou — `_mjs_isLight` est décidé AU CONSTRUCTEUR
  // (mjs_element.ts) : happy-dom pose l'attribut `mjs-light` APRÈS, un sous-composant imbriqué
  // (jamais la racine, parsée via innerHTML) attache alors un VRAI shadow à tort malgré l'attribut
  // (piège jumeau : tests/mjs-layout-runtime.test.ts:225). On relit l'attribut ICI, au moment de
  // sérialiser (déjà posé) : hôte SANS <template>, contenu réel (piégé dans le shadow attaché à
  // tort) aplati comme du light DOM — même promesse que le contrat mjs-light (docs/19-ssr.md).
  const hasOwnShadow = node._shadow && node._shadow !== node
  const isLight = (node.hasAttribute && node.hasAttribute('mjs-light')) || (node.constructor && node.constructor.mjsLight === true)
  if (hasOwnShadow && !isLight) {
    const nestedCss = ssrInfo(node).baseCss.trim()
    const nestedStyleTag = feuille(nestedCss, tagName)
    let shadowContent = ''
    // NOUVELLE frontière <template> physique : dédoublonnage propre à ELLE
    const nestedSeen = new Set<string>()
    for (const child of Array.from(node._shadow.childNodes) as any[]) shadowContent += serializeShadowNode(child, shadowMode, nestedSeen, feuille)
    inner += `<template shadowrootmode="${shadowMode}">${nestedStyleTag}${shadowContent}</template>`
  } else if (hasOwnShadow && isLight) {
    // Garde-fou — le sous-composant light aplati perdait SA feuille (aucune des
    // deux branches ne la réinjectait) : elle voyage désormais avec son contenu, dans le MÊME
    // shadow hôte que celui où le contenu est aplati (document.head ne traverse jamais le shadow
    // réel d'un ancêtre, cf. correctif jumeau côté runtime, mjs_element.ts). Une seule fois par
    // balise (`lightSeen`, hérité de l'appelant) : plusieurs instances d'un même composant light
    // dans un `{for}` ne dupliquent pas la règle.
    // `:host` réécrit en nom de balise : un léger n'a pas de
    // host réel, la feuille aplatie voyage dans le shadow de l'ANCÊTRE, où `:host` ne désignerait
    // rien. Réutilise le runtime compilé si la fenêtre happy-dom du rendu le charge (cas réel de
    // `createSSRRenderer`/`renderToString`, cf. l'`eval` plus bas qui pose `globalThis.µ`) ; repli
    // sur la copie serveur (light-host-css.ts, même algorithme) sinon.
    const rawCss = ssrInfo(node).baseCss.trim()
    const win: any = node.ownerDocument && node.ownerDocument.defaultView
    const rewriteHost = (win && win.µ && typeof win.µ._lightHostCss === 'function') ? win.µ._lightHostCss : lightHostCss
    const nestedCss = rawCss ? rewriteHost(rawCss, tagName) : rawCss
    if (nestedCss && !lightSeen.has(tagName)) {
      lightSeen.add(tagName)
      inner += feuille(nestedCss, tagName)
    }
    for (const child of Array.from(node._shadow.childNodes) as any[]) inner += serializeShadowNode(child, shadowMode, lightSeen, feuille)
  }
  for (const child of Array.from(node.childNodes) as any[]) inner += serializeShadowNode(child, shadowMode, lightSeen, feuille)
  return `${openTag}${inner}${closeTag}`
}

/**
 * Sérialise le shadow DOM d'un composant MJS EN PROFONDEUR (racine `el` comprise) — remplace
 * `el._shadow.innerHTML`/`el.innerHTML` natifs partout où un descendant peut porter un shadow
 * propre. `shadowMode` : même choix (open/closed) que celui écrit pour la RACINE (pas
 * d'introspection du mode INTERNE de chaque sous-composant — toujours `'closed'` pendant le rendu
 * SSR lui-même, cf. mjs_element.ts, non pertinent pour ce que le DSD SERVEUR déclare).
 */
export function serializeShadow(el: any, shadowMode: 'open' | 'closed' = 'open', feuille: FeuilleBalise = feuilleEnLigne): string {
  const root = el._shadow ?? el
  let out = ''
  // dédoublonnage par tag des <style> de sous-composants light imbriqués — propre à CETTE
  // frontière shadow/light
  const lightSeen = new Set<string>()
  for (const child of Array.from(root.childNodes) as any[]) out += serializeShadowNode(child, shadowMode, lightSeen, feuille)
  return out
}

/**
 * Crée un renderer SSR : compile UNE fois les composants, puis permet de
 * rendre plusieurs fois (chaque rendu dans une Window happy-dom isolée).
 */
export async function createSSRRenderer(opts: SSRRendererOptions): Promise<SSRRenderer> {
  // Quand aucun `outputDir` n'est
  // fourni (helper one-shot / tests), on crée un dossier temp jamais supprimé →
  // fuite disque à chaque rendu ponctuel. On mémorise qu'on en est PROPRIÉTAIRE
  // pour le nettoyer dans `close()` (jamais un outputDir fourni par l'appelant).
  const ownsTempDir = opts.outputDir == null
  const projectDir = opts.outputDir ?? mkdtempSync(join(tmpdir(), 'mjs-ssr-'))
  mkdirSync(projectDir, { recursive: true })
  // Où CETTE compilation a le droit d'écrire (cf. render-compile-dir.ts) : le vrai dossier de
  // sortie quand le projet émet lui aussi des unités séparées, un dossier temporaire quand il émet
  // un FICHIER UNIQUE (`js: 'bundle'`) — la recompilation forcée en `split` ci-dessous écraserait
  // sinon ce fichier par un manifeste éclaté. Sans dossier de sortie fourni, on est déjà dans un
  // temporaire à nous : rien à détourner.
  const atelier = openRenderCompileDir({
    js: ownsTempDir ? undefined : opts.bundlerOpts?.js,
    outputDir: projectDir,
    manifestPath: opts.manifestPath ?? (ownsTempDir ? join(projectDir, 'bundle.js') : (opts.bundlerOpts?.manifestPath ?? join(projectDir, 'bundle.js'))),
    urlPrefix: opts.bundlerOpts?.urlPrefix,
  })
  const outputDir = atelier.outputDir
  // ABANDON — toute sortie en erreur de CETTE construction rend ce qu'elle a pris : le dossier de
  // travail de la compilation, et le dossier temporaire du renderer lui-même quand personne ne
  // nous a donné d'`outputDir`. Un seul geste, appelé par chaque `throw` ci-dessous : un chemin
  // d'erreur qui l'oublie laisse un dossier derrière lui, sans que rien ne le signale.
  const abandon = (): void => {
    atelier.cleanup()
    if (ownsTempDir) { try { rmSync(projectDir, { recursive: true, force: true }) } catch { /* best-effort */ } }
  }

  // MODE STRICT du projet — `opts.csp` (clé explicite de l'API) d'abord, sinon celui des options
  // RÉSOLUES du projet : le prérendu et le rendu par requête construisent leur renderer avec
  // `bundlerOpts`, jamais avec cette clé-là. Sans ce repli, un projet en `csp: true` compilait bien
  // en mode strict mais voyait le HTML rendu repartir avec des `<style>` en ligne — refusés par
  // `style-src` chez le visiteur, donc une page NON STYLÉE que rien ne signalait au build.
  const cspStrict = opts.csp ?? opts.bundlerOpts?.csp ?? false

  // Clés explicites de `SSRRendererOptions` — elles PRIMENT sur `bundlerOpts`, mais
  // seulement quand elles sont RENSEIGNÉES : les laisser telles quelles écraserait la
  // valeur résolue par un `undefined` (un appelant qui passe `bundlerOpts` ne renseigne
  // pas les clés héritées). D'où le filtrage avant le dernier spread.
  const explicites: Record<string, unknown> = { defaultScriptLang: opts.defaultScriptLang, templateLang: opts.templateLang, sigil: opts.sigil, contextAlias: opts.contextAlias, stylesheetsDir: opts.stylesheetsDir, css: opts.css, csp: opts.csp, maxStateVars: opts.maxStateVars, a11y: opts.a11y, i18n: opts.i18n, env: opts.env }
  for (const k of Object.keys(explicites)) if (explicites[k] === undefined) delete explicites[k]

  const bundler = new Bundler({
    // Options RÉSOLUES du projet en socle (cf. `SSRRendererOptions.bundlerOpts`) : le
    // rendu serveur compile alors À L'IDENTIQUE du build principal, jamais un sous-ensemble.
    ...opts.bundlerOpts,
    sourceDir: opts.sourceDir,
    outputDir,
    // Manifeste du dossier de travail ci-dessus. `opts.manifestPath` (si transmis) prime sur la
    // dérivation par défaut, sauf quand la compilation est détournée — un manifeste éclaté écrit
    // sur le fichier unique du projet est précisément ce que ce détournement évite. Sans
    // `outputDir` fourni, le repli reste LOCAL : reprendre le `manifestPath` de la CONFIG
    // écraserait un fichier RÉEL du projet par un manifeste pointant des assets temporaires,
    // supprimés au `close()`.
    manifestPath: atelier.manifestPath,
    ...explicites,
    // `js` forcé 'split' EN DERNIER (aucune clé, ni bundlerOpts ni explicites, ne peut
    // le recouvrir) : ce renderer recharge le cœur et chaque composant FICHIER PAR FICHIER
    // (cf. plus bas, coreCode/lire par basename), un contrat que `js: 'bundle'` (tout fusionné
    // dans manifestPath, plus de mjs_core-*.js séparé) casserait — quel que soit le réglage du
    // projet rendu.
    js: 'split',
    // Préfixe public du VRAI build imposé quand la compilation est détournée : les URLs d'assets
    // du HTML rendu (images `µasset`, feuilles `csp`, liens) désignent ce que sert le back, jamais
    // le dossier de travail. `undefined` hors détournement : le Bundler dérive comme avant.
    urlPrefix: atelier.urlPrefix,
  })
  let stats
  try {
    stats = await bundler.compile()
  } catch (e) {
    await bundler.close()
    abandon()
    throw e
  }
  const compileWarnings = stats.warnings.slice()
  if (stats.errors.length) {
    await bundler.close()
    abandon()
    throw new Error(t('server.ssr-erreurs-compilation', { errors: stats.errors.map(e => e.message).join('\n') }))
  }

  // Comment la feuille scopée d'un composant sort dans le HTML rendu, à TOUT niveau de composition
  // (cf. `FeuilleBalise`) : sous le mode strict, un fichier haché écrit dans le VRAI dossier de
  // sortie (celui que sert le back, jamais le dossier de travail de cette compilation) et un
  // `<link>` qui le désigne — un `<style>` en ligne y serait refusé par `style-src`. Le fichier est
  // CONTENU-ADRESSÉ : deux instances d'un même composant retombent sur le même nom, écrit une fois.
  const feuille: FeuilleBalise = cspStrict
    ? (css, tag) => css ? `<link rel="stylesheet" href="${writeHashedAsset(atelier.assetsDir, bundler.urlPrefix, 'mjs_ssr_style_' + tag, '.css', css)}">` : ''
    : feuilleEnLigne

  // Charge le core + TOUS les composants compilés (un composant racine peut en
  // référencer d'autres). ESM stripé pour l'éval.
  const jsFiles = readdirSync(outputDir).filter(f => f.endsWith('.js'))
  // `jsFiles.find` retenait le 1er
  // `mjs_core-*` selon l'ordre de `readdirSync` (NON garanti par POSIX) : sur un
  // outputDir RÉEL (prerender.ts) qui accumule d'anciens cores hachés, on pouvait
  // charger un core PÉRIMÉ, silencieusement. Sélection déterministe (tri stable)
  // + avertissement si plusieurs cores coexistent (artefacts de build à nettoyer).
  const coreFiles = jsFiles.filter(f => /^mjs_core-/.test(f)).sort()
  if (coreFiles.length === 0) {
    await bundler.close()
    abandon()
    throw new Error(t('server.ssr-core-introuvable'))
  }
  if (coreFiles.length > 1) {
    console.warn(t('server.ssr-plusieurs-core', { files: coreFiles.join(', '), first: coreFiles[0] }))
  }
  const coreFile = coreFiles[0]
  const coreCode = stripEsm(readFileSync(join(outputDir, coreFile), 'utf-8'))

  // Portée par fichier (Option A) : chaque module/composant part dans sa propre
  // IIFE, ses imports résolus en destructuration locale depuis les namespaces
  // `_mjsF_*`. Le core (`µ`) est global (évalué séparément ci-dessus).
  // `mjs_page-<slug>-<empreinte>.js` ÉCARTÉ comme `bundle.js` : ce n'est pas une unité mais
  // l'ASSEMBLAGE des composants d'une page prérendue (cf. bundler/startup.ts), dont chaque unité est
  // déjà chargée ici une par une. L'évaluer en plus rejouerait les mêmes `customElements.define` et,
  // son nom commençant par `mjs_`, il passerait AVANT le tri par dépendances (runtimeIds ci-dessous)
  // — donc avant les modules qu'il importe, qui n'existent pas encore : erreur d'initialisation
  // fatale à tout le rendu.
  // GARDE-FOU — `readdirSync(outputDir)` liste TOUT le dossier, pas seulement ce que CETTE
  // compilation vient d'émettre : un .js ÉTRANGER qui y traîne (artefact d'un autre outil, d'un
  // build antérieur, dossier de sortie partagé) était concaténé et évalué comme les autres — un
  // seul `throw` dedans faisait échouer le rendu de N'IMPORTE QUELLE page du même projet. Seuls
  // les fichiers du GRAPHE ÉMIS par CETTE compilation sont admis : `stats.manifest` (composants +
  // modules, cf. bundler/index.ts `manifest[baseName] = hashedPath`) couvre tout sauf le runtime
  // (`mjs_core`/`mjs_styles`/`mjs_anims`/`mjs_i18n-*`… — jamais une clé `manifest`, déjà repérés
  // par leur PRÉFIXE `mjs_`, cf. runtimeIds plus bas) : l'un ou l'autre suffit à admettre un fichier.
  const emittedBasenames = new Set(Object.values(stats.manifest as Record<string, string>).map(p => p.split('/').pop() || ''))
  const files = jsFiles.filter(f =>
    f !== coreFile && f !== 'bundle.js' && !/^mjs_page-[^/]*-[a-f0-9]{8}\.js$/.test(f) &&
    (/^mjs_/.test(f) || emittedBasenames.has(f)))
  const idByFile = new Map(files.map(f => [f, fileToId(f)]))
  // Résout une URL d'import (`/assets/.../x-hash.js`) vers l'id du fichier cible ;
  // null pour le core (µ global) ou tout externe → l'import est retiré.
  const resolve = (url: string): string | null =>
    idByFile.get(url.split('/').pop() || '') ?? null
  const scoped = files.map((f) => {
    const id = idByFile.get(f)!
    const { code, deps } = ssrScopeFile(readFileSync(join(outputDir, f), 'utf-8'), id, resolve)
    return { f, id, code, deps }
  })
  const depsById = new Map(scoped.map(s => [s.id, s.deps]))
  const codeById = new Map(scoped.map(s => [s.id, s.code]))
  const idToFile = new Map(scoped.map(s => [s.id, s.f]))
  // Runtime (`mjs_styles`/`mjs_anims`…) d'abord (effets de bord fondateurs), puis
  // le reste trié par dépendances (une cible d'import avant son importateur).
  //
  // `runtimeIds` venait de `scoped`,
  // lui-même dérivé de `jsFiles = readdirSync(outputDir)` : l'ORDRE de
  // `readdirSync` n'est PAS garanti par POSIX (dépend du système de fichiers,
  // peut varier entre 2 exécutions/machines/CI) alors que `restIds` (ci-
  // dessous) est, lui, remis en ordre par `topoSortFiles`. Aucune dépendance
  // RÉELLE entre fichiers runtime au chargement n'a été trouvée en pratique
  // (chacun construit puis étend SON PROPRE namespace `µ.xxx`, jamais celui
  // d'un autre fichier runtime, à date) — mais un ordre de concaténation qui
  // varie selon la machine reste une source de non-déterminisme évitable pour
  // un outil de build (reproductibilité du bundle généré). Tri alphabétique
  // (sur le NOM de fichier, pas l'id interne) pour un ordre stable, prévisible
  // et indépendant du système de fichiers.
  const runtimeIds = scoped.filter(s => /^mjs_/.test(s.f)).sort((a, b) => a.f.localeCompare(b.f)).map(s => s.id)
  // même raison que runtimeIds ci-dessus (déterminisme, readdirSync non garanti par POSIX)
  const restIds = scoped.filter(s => !/^mjs_/.test(s.f)).sort((a, b) => a.f.localeCompare(b.f)).map(s => s.id)
  let sortedRestIds: string[]
  try {
    sortedRestIds = topoSortFiles(restIds, depsById, idToFile)
  } catch (e) {
    await bundler.close()
    abandon()
    throw e
  }
  const componentCode = [...runtimeIds, ...sortedRestIds]
    .map(id => codeById.get(id)!)
    .join('\n')

  // (lecture disque PARESSEUSE) — AVANT ce correctif,
  // `loadLangDict` (cf. plus bas, disparu) préchargeait sur disque *toutes* les sections d'une
  // langue avant le premier montage : mesuré, 30 lectures/parsings pour un composant qui n'en
  // consomme qu'UNE, À CHAQUE rendu (le double quand la langue effective diffère de la langue
  // par défaut). Remplacé par ce crochet SYNCHRONE, posé sur le bac à sable (`window`) juste
  // avant l'eval — `mjs_i18n.ts` (`_ensure`, branche `µ._isServer`) l'appelle lui-même, section
  // par section, SEULEMENT pour celles qu'un composant consulte réellement (même paresse que le
  // fetch client, sans le round-trip réseau). Cache mémoire par (chemin, mtime) — POUR LA DURÉE
  // DE VIE DE CE RENDERER (`i18nDiskCache`, fermé sur cette closure, partagé entre tous les
  // appels `renderToString` suivants) : un fragment déjà lu reste servi sans retoucher le
  // disque tant que son fichier n'a pas changé (utile en `mjs dev`, qui réécrit les fragments à
  // chaud). `i18nLoadCount` (exposé sur le renderer retourné, cf. `SSRRenderer`) compte les
  // APPELS au crochet, pas les lectures physiques réellement effectuées.
  let i18nLoadCount = 0
  const i18nDiskCache = new Map<string, { mtimeMs: number, data: any }>()
  function i18nLoadSync(lang: string, section: string): any {
    i18nLoadCount++
    const manifest = bundler.i18nManifestData
    // valeur COMPACTE : le seul NOM du fragment (hash en prod, nom clair en dév), plus
    // son URL entière — le fichier sur disque porte ce nom, cf. scanI18n.
    const nom = manifest && manifest.sections[lang] && manifest.sections[lang][section]
    if (!nom) return null
    const filePath = join(outputDir, 'i18n', lang, `${basename(String(nom))}.json`)
    try {
      const mtimeMs = statSync(filePath).mtimeMs
      const cached = i18nDiskCache.get(filePath)
      if (cached && cached.mtimeMs === mtimeMs) { return cached.data }
      const data = JSON.parse(readFileSync(filePath, 'utf-8'))
      i18nDiskCache.set(filePath, { mtimeMs, data })
      return data
    } catch {
      return null // fragment absent/illisible : placeholder inchangé (même garde que l'ancien loadLangDict)
    }
  }

  // happy-dom est une dépendance optionnelle (utile seulement pour le SSR).
  // Import dynamique avec message clair si absent.
  let HappyDOM: any
  try {
    HappyDOM = await import('happy-dom')
  } catch {
    await bundler.close()
    abandon()
    throw new Error(t('server.ssr-happydom-manquant'))
  }
  const { Window } = HappyDOM

  async function renderToString(tag: string, options: RenderOptions = {}): Promise<RenderResult> {
    const { props = {}, store, shadowMode = 'open', settleMs = 1000, ssrMode = 'replace', forwardedUrl, forwardedCookie, light: lightRoot = false } = options

    // (SSRF) — défense en profondeur : un `forwardedUrl`
    // pointant vers une cible réseau interne est REFUSÉ ici, même s'il a déjà
    // traversé `computeForwardedOrigin` (render-request.ts) — protège aussi tout
    // appelant DIRECT de cette API (cf. RenderOptions.forwardedUrl). Refusé →
    // ignoré (comme absent) : repli sur l'origine locale câblée en dur, jamais
    // sur une valeur fournie par le client, aucun crash.
    let forwardBlockedWarning: string | null = null
    let safeForwardedUrl = forwardedUrl
    if (safeForwardedUrl) {
      try {
        if (isBlockedForwardTarget(new URL(safeForwardedUrl).host)) {
          forwardBlockedWarning = t('server.ssr-forward-refuse-interne', { tag, host: new URL(safeForwardedUrl).host })
          safeForwardedUrl = undefined
        }
      } catch {
        forwardBlockedWarning = t('server.ssr-forward-url-invalide', { tag })
        safeForwardedUrl = undefined
      }
    }
    // render.forwardOrigin (défaut SÛR, cf. RenderOptions.forwardedUrl) : sans
    // requête entrante à forwarder (prérendu, forwardOrigin désactivé/refusé, ou
    // défaut sûr sans autorisation d'hôte), on reste sur localhost — comportement
    // HISTORIQUE inchangé.
    const window: any = new Window({ url: safeForwardedUrl || 'http://localhost/' })
    const document = window.document
    // Cookies de la requête entrante → document.cookie AVANT tout eval/fetch de
    // l'app : SONDE empirique (happy-dom 20.9, cf. RenderOptions.forwardedCookie) —
    //   1. une SEULE assignation brute multi-paires ('a=1; b=2') ne retient QUE la
    //      1ʳᵉ ('a=1') — la suite est parsée comme des ATTRIBUTS de la 1ʳᵉ paire,
    //      pas comme une 2e paire (round-trip : `document.cookie` ne rendait que
    //      "a=1"). Fix : UNE assignation PAR paire (le setter ACCUMULE, il ne
    //      remplace pas — contrairement à innerHTML).
    //   2. `document.cookie` posé ainsi est ensuite envoyé AUTOMATIQUEMENT par
    //      `window.fetch()` sur les requêtes MÊME-HÔTE (comme un vrai navigateur,
    //      RFC 6265 — la portée cookie ignore le PORT, contrairement à l'origine
    //      Fetch/CORS) ; tenter d'injecter `Cookie` À LA MAIN via `fetch(url,
    //      {headers:{cookie:...}})` est en revanche TOUJOURS silencieusement
    //      ignoré (en-tête INTERDIT côté script, spec-conforme) — inutile
    //      d'enrober `window.fetch`, la seule voie qui fonctionne est celle-ci.
    //   3. jamais de fuite vers un AUTRE HÔTE : happy-dom applique la vraie
    //      politique même-origine à l'envoi (`Fetch.ts` retire `cookie`/`cookie2`
    //      dès que `FetchCORSUtility.isCORS` détecte un hôte/protocole différent,
    //      credentials par défaut `'same-origin'`) et, plus radicalement, REFUSE
    //      de livrer la RÉPONSE d'une requête cross-origine à l'app tant que la
    //      cible n'envoie pas les en-têtes CORS adéquats (Same Origin Policy).
    if (forwardedCookie) {
      for (const pair of forwardedCookie.split(';')) {
        const trimmed = pair.trim()
        if (trimmed) document.cookie = trimmed
      }
    }
    // try/finally : garantit `window.close()` sur TOUTES les sorties, y compris
    // une erreur survenant après la création de la Window (settleRender, walk
    // d'hydratation…). Sans ça, chaque rendu qui throw fuyait la Window happy-dom.
    let effectiveLang: string | undefined
    try {
      try {
        // `µ._isServer = true` : marque le contexte serveur pour que le runtime
        // court-circuite les hooks client (@mount/@awake) durant le SSR (ils
        // rejoueront à l'hydratation côté navigateur). `µ.server = true` juste à
        // côté : miroir PUBLIC (rune `µserver`, cf. mjs_store_globals.ts) — posé
        // ICI, AVANT `componentCode` (qui contient mjs_store_globals.ts et son
        // garde `if (µ.server === undefined)`), pour que ce garde voie déjà
        // `true` et ne le retombe jamais sur son défaut client `false`.
        // BUG D'INTÉGRATION — MANQUANT avant ce correctif : `µ._i18nData`
        // (émis par `scanI18n()`/`writeManifest()` dans le manifeste `bundle.js`
        // JAMAIS chargé ici, cf. le filtre `f !== 'bundle.js'` ci-dessus) n'était
        // donc jamais posé côté SSR, même avec `SSRRendererOptions.i18n` renseigné
        // (cf. son propre correctif juste au-dessus, nécessaire mais pas
        // suffisant) — toute clé i18n rendait silencieusement son placeholder au
        // rendu serveur. Injecté ICI, dans le MÊME script synchrone que le core
        // (même position relative que dans le manifeste client, `bundle.js`) —
        // `mjs_i18n.ts` (concaténé dans `coreCode`) l'amorce via son rattrapage
        // en microtask (cf. son en-tête de fichier), AVANT le premier rendu d'un
        // composant i18n.
        // `i18nPublicData()` : même bloc de RÉGLAGES que le manifeste client. Les
        // DICTIONNAIRES, eux, arrivent juste en dessous par `µ._i18nLang` — au navigateur
        // ils viennent d'un fichier PAR LANGUE (cf. scanI18n), ici ils sont déjà en
        // mémoire : rien à importer, rien à attendre, le démarrage reste SYNCHRONE.
        const i18nDataLine = bundler.i18nManifestData ? `µ._i18nData = ${JSON.stringify(bundler.i18nPublicData())};` : ''
        // `mjs_i18n.ts` `_ensure()` court-circuite tout fetch dès que
        // `µ._isServer` (cf. son commentaire) : sans injection ici, `µ._i18nData` (racine,
        // ci-dessus) résout les clés RACINE mais toute clé de SECTION rendait son placeholder au
        // SSR, même avec le fragment déjà écrit sur disque par `scanI18n()`/`writeManifest()`
        // (`outputDir/i18n/<langue>/<section>.json`). Langue EFFECTIVE : `store.__mjsLang`
        // (canal d'ENTRÉE, cf. l'injection de store plus bas) si fourni, sinon
        // `i18nManifestData.default` (même défaut que `<html lang>`).
        // CORRECTIF (repli langue par défaut MUET) — une section absente de la
        // langue effective (traduction pas encore faite, cas courant : `defLang` seule
        // traduite) doit pouvoir répliquer sur `defLang` DÈS le 1er rendu, exactement comme le
        // ferait le client après son fetch de repli (`_ensure`, § Repli de section) — jamais le
        // placeholder au SSR.
        // CORRECTIF — la RACINE des deux langues (`effectiveLang`
        // et, si distincte, `defLang`) reste embarquée ICI comme avant ; les FRAGMENTS DE
        // SECTION, eux, ne le sont PLUS (`loadLangDict` a disparu, cf. le crochet
        // `i18nLoadSync`/`i18nDiskCache` défini plus haut, avant ce renderer) — le repli de
        // section passe désormais par l'appel récursif DÉJÀ existant dans `_ensure` (« Repli de
        // section »), qui déclenche lui-même le crochet paresseux pour `defLang/section` au lieu
        // d'un préchargement à l'aveugle de TOUTES ses sections.
        // Ces deux langues passent par `µ._i18nLang` — le point d'entrée du RUNTIME pour
        // les données d'une langue (fichier de langue au navigateur) : racine ET table
        // des sections de la langue, sans quoi `_ensure` ne saurait plus quel fragment
        // lire. Gardé par un `typeof` : un build qui n'embarque pas le module i18n
        // optionnel n'a pas cette fonction, et cette ligne ne doit jamais tuer le rendu.
        let i18nSectionsLine = ''
        if (bundler.i18nManifestData) {
          const manifest = bundler.i18nManifestData
          effectiveLang = (store && (store as any).__mjsLang) || manifest.default
          const defLang = manifest.default
          const semees = (defLang && defLang !== effectiveLang) ? [effectiveLang, defLang] : [effectiveLang]
          const langLines = semees.map(l => `µ._i18nLang(${JSON.stringify(l)}, ${JSON.stringify({ root: manifest.root[l] ?? {}, sections: manifest.sections[l] ?? {} })});`)
          i18nSectionsLine = `if (typeof µ._i18nLang === 'function') { ${langLines.join(' ')} }\nµ._i18nLoadSync = window.__mjsI18nLoadSync;`
          ;(window as any).__mjsI18nLoadSync = i18nLoadSync
        }
        window.eval(`${coreCode}\nglobalThis.µ = µ;\n${i18nDataLine}\n${i18nSectionsLine}\nµ._isServer = true;\nµ.server = true;\n${componentCode}`)
      } catch (e: any) {
        throw new Error(t('server.ssr-eval-echec', { message: e.message }))
      }

      if (!window.customElements.get(tag)) {
        throw new Error(t('server.ssr-composant-non-enregistre', { tag }))
      }

      // Injecte l'état global AVANT le montage, pour que le rendu serveur l'utilise
      // (le composant pourra le lire et le compléter) : le store global (`$$`).
      // CORRECTIF — `Object.assign(µ.store, …)`
      // pose des propriétés PLATES pour toute clé jamais déclarée par un module
      // DÉJÀ chargé (aucun accesseur en attente) : un chunk lazy-chargé PLUS TARD
      // qui écrit cette clé ne notifie alors jamais rien (`_storeDeclare` skip une
      // clé déjà `hasOwnProperty`). Semer clé par clé via `µ._storeSet` (garde
      // anti prototype-pollution incluse) crée directement l'accesseur — AUCUN
      // composant n'est encore monté à ce stade (le montage a lieu plus bas, via
      // `document.body.innerHTML`), donc la notification déclenchée par
      // `_storeSet` n'a aucun abonné à ce moment : sans risque.
      // CORRECTIF (canal d'ENTRÉE) — `__mjsLang` doit
      // rester une clé store CACHÉE (cf. `_storeDeclare(keys, true)` côté
      // réhydratation client, mjs_store_globals.ts:242-269) même quand elle
      // arrive par `options.store` : la PRÉ-déclarer non-énumérable AVANT
      // `_storeSet`, sinon celui-ci l'auto-déclare ÉNUMÉRABLE faute d'accesseur
      // existant — et resterait ainsi visible pour de bon (`Object.keys(µ.store)`,
      // `{for k in $$}`, `JSON.stringify(µ.store)` exécutés côté serveur).
      if (store && Object.keys(store).length > 0) {
        try {
          window.eval(
            `(function(__s){ if (Object.prototype.hasOwnProperty.call(__s, '__mjsLang') && !Object.prototype.hasOwnProperty.call(µ.store, '__mjsLang')) { µ._storeDeclare(['__mjsLang'], true); } for (var __k in __s) { if (Object.prototype.hasOwnProperty.call(__s, __k)) { µ._storeSet(__k, __s[__k]); } } })(${JSON.stringify(store)})`,
          )
        } catch (e: any) {
          throw new Error(t('server.ssr-injection-store-echec', { message: e.message }))
        }
      }

      // Monte le composant avec ses props en attributs HTML. Les objets/tableaux
      // sont sérialisés en JSON (parseProp les ré-hydrate au montage) ; les
      // scalaires passent en valeur d'attribut directe.
      const serializeProp = (v: unknown): string =>
        (v !== null && typeof v === 'object') ? JSON.stringify(v) : String(v)
      // Le NOM de prop est concaténé dans le markup : le valider (sinon une clé
      // `x><img onerror=…>` injecterait du HTML — XSS réfléchi). Seule la valeur
      // était échappée jusqu'ici.
      const PROP_NAME_RE = /^[A-Za-z_][\w:.-]*$/
      let attrs = Object.entries(props)
        .map(([k, v]) => {
          if (!PROP_NAME_RE.test(k)) {
            console.warn(t('server.ssr-prop-invalide', { keyJson: JSON.stringify(k) }))
            return ''
          }
          return ` ${k}="${escapeAttr(serializeProp(v))}"`
        })
        .join('')
      // Racine en mode léger (cf. `RenderOptions.light`) : drapeau posé sur la CLASSE du composant
      // AVANT de construire l'élément — le constructeur décide là, et l'attribut que le parseur
      // pose ensuite arriverait trop tard. L'attribut voyage quand même dans le HTML servi : c'est
      // lui que lit le client au remontage.
      if (lightRoot) {
        const classe: any = window.customElements.get(tag)
        if (classe) classe.mjsLight = true
        attrs += ' mjs-light'
      }
      document.body.innerHTML = `<${tag}${attrs}></${tag}>`
      const el: any = document.body.firstElementChild

      // Attend la fin du rendu (stabilité du scheduler + résolution des {await}),
      // avec settleMs comme plafond de sécurité. `settled=false` → plafond atteint.
      const settled = await settleRender(el, settleMs)

      // Sérialise l'état global pour réhydratation client : µ.store, le store
      // global zéro-import (`$$x`). La balise JSON est réhydratée au boot par
      // le runtime. À placer UNE fois dans la page ; no-op si le store est vide.
      // échappement factorisé dans escapeJsonForScript (module-level, cf. son commentaire MAJEUR) :
      // réutilisée telle quelle par render-server.ts pour µres au 1er chargement HTML.
      // Garde-fou — AVANT ce correctif, `JSON.stringify(expr || {})`
      // était un SEUL appel atomique sur l'objet ENTIER : une référence circulaire créée par le
      // COMPOSANT LUI-MÊME pendant son rendu (`$$a.self = $$a`) faisait échouer l'appel, et
      // TOUT le store partait avec — y compris des clés parfaitement saines (`$$b`) — sans le
      // moindre signal dans `RenderResult.warnings` (seul un `console.warn` serveur, invisible de
      // l'appelant). Sérialisation CLÉ PAR CLÉ désormais (dans le bac à sable, pour que
      // `for...in`/`JSON.stringify` voient les getters réactifs tels que le composant les expose) :
      // la clé fautive est omise, les AUTRES survivent.
      const globalSerializeWarnings: string[] = []
      const serializeGlobal = (expr: string, id: string): string => {
        try {
          const probe = window.eval(`JSON.stringify((function() {
            var obj = (${expr}) || {}
            var parts = []
            var omitted = []
            for (var k in obj) {
              if (!Object.prototype.hasOwnProperty.call(obj, k)) continue
              try {
                var v = JSON.stringify(obj[k])
                if (v !== undefined) parts.push(JSON.stringify(k) + ':' + v)
              } catch (e) {
                omitted.push({ key: k, message: String((e && e.message) || e) })
              }
            }
            return { json: '{' + parts.join(',') + '}', omitted: omitted }
          })())`)
          const { json, omitted } = JSON.parse(probe) as { json: string, omitted: { key: string, message: string }[] }
          for (const o of omitted) {
            const msg = t('server.ssr-serialisation-echec', { expr: `la clé "${o.key}" de ${id}`, errMsg: o.message })
            console.warn(msg)
            globalSerializeWarnings.push(msg)
          }
          if (json !== '{}') {
            return `<script type="application/json" id="${id}">${escapeJsonForScript(json)}</script>`
          }
        } catch (e) {
          // Repli si `expr` LUI-MÊME échoue à s'évaluer
          // (hors périmètre clé par clé — l'expression racine, pas une de ses clés) : était avalé
          // en silence, balise vide, divergence SSR/client SILENCIEUSE (aucun signal en dev ni CI).
          console.warn(t('server.ssr-serialisation-echec', { expr, errMsg: e instanceof Error ? e.message : e }))
        }
        return ''
      }
      // Sème les sections i18n consultées pendant CE rendu (`µ._i18nUsed`, posé par `_ensure()` juste avant son repli ssr, cf mjs_i18n.ts) : calcul DANS le bac à sable (même principe que `serializeGlobal` ci-dessus), objet `null` (donc balise absente) si rien consulté
      // CORRECTIF — `sections` regroupée PAR LANGUE RÉELLE (`{lang:{section:…}}`),
      // plus seulement par section : une clé de `µ._i18nUsed` posée par le REPLI de `_ensure`
      // (mjs_i18n.ts, `_ensure(defLang, section)` récursif) porte `defLang/section`, jamais
      // `effectiveLang/section` — l'ancienne forme (filtrée sur `parts[0] === lang`) perdait donc
      // TOUJOURS cette clé-là, la graine sortait vide, le client refetchait ce que le serveur avait
      // déjà résolu. `lang` (racine de la balise) reste la langue EFFECTIVE de CE rendu ; chaque clé
      // de `used` lit son propre dictionnaire (`µ._i18nDict[sa langue à elle]`, peuplé pour
      // `effectiveLang` ET `defLang` par le préchargement disque ci-dessus).
      const i18nScript = effectiveLang ? serializeGlobal(
        `(function() {
          var used = µ._i18nUsed || {}
          var dicts = µ._i18nDict || {}
          var sections = {}
          var any = false
          for (var k in used) {
            if (Object.prototype.hasOwnProperty.call(used, k)) {
              var parts = k.split('/')
              var kLang = parts[0], kSection = parts[1]
              var dict = dicts[kLang] || {}
              if (!sections[kLang]) { sections[kLang] = {} }
              sections[kLang][kSection] = dict[kSection]
              any = true
            }
          }
          return any ? { lang: ${JSON.stringify(effectiveLang)}, sections: sections } : null
        })()`,
        '__mjs_i18n',
      ) : ''
      // `__mjsLang` (langue i18n courante, clé store CACHÉE non-
      // énumérable, cf. mjs_store_globals.ts _storeDeclare(keys, true)) est
      // EXCLUE de `JSON.stringify(µ.store)` PAR CONSTRUCTION (réserve laissée
      // précédemment, cf. l'ancien commentaire ici) : un rendu SSR dans
      // une langue non par défaut n'était alors JAMAIS réhydraté côté client
      // (le boot i18n re-partait sur la langue par défaut). `Object.assign`
      // ne copie que les clés ÉNUMÉRABLES de `µ.store` (les computed y
      // arrivent déjà déballés par le getter) — on rajoute `__mjsLang`
      // EXPLICITEMENT dans l'objet à sérialiser si le module i18n l'a posée
      // (accès direct par nom, insensible à l'énumérabilité). Le canal reste
      // le MÊME (#__mjs_store) ; côté client, mjs_store_globals.ts la
      // re-déclare CACHÉE avant de la réhydrater (cf. son propre commentaire).
      const sharedScript = serializeGlobal(
        '(µ.store && µ.store.__mjsLang !== undefined ? Object.assign({}, µ.store, { __mjsLang: µ.store.__mjsLang }) : µ.store)',
        '__mjs_store',
      ) + i18nScript

      const racine = ssrInfo(el)
      const light  = racine.isLight
      const css    = racine.baseCss.trim()

      // Hydratation (approche A — marqueurs) : annote les nœuds réactifs avec des
      // marqueurs persistants pour que le client les retrouve et les adopte.
      // Élément → attribut `mjs-h="<key>"` ; text node → commentaire
      // `<!--mjs-h:<key>-->` inséré juste avant. + un flag d'activation client.
      // 'replace' = render-then-replace (rien à préparer côté serveur). Les 3
      // hydratations émettent un flag d'activation (+ des marqueurs pour 'markers').
      const _modeMap: Record<string, string> = { markers: 'a', positional: 'b', diff: 'c' }
      const _mode = _modeMap[ssrMode]   // undefined pour 'replace'
      let hydrateScript = ''
      if (_mode && !light) {
        // 'markers' : marqueurs persistants sur les nœuds réactifs. 'positional' /
        // 'diff' : aucun marqueur (HTML propre), l'alignement se fait côté client.
        const hydrateNodes: any = ssrInfo(el).nodes
        if (_mode === 'a' && hydrateNodes) {
          const doc: any = window.document
          const nodes: any = hydrateNodes
          for (const key of Object.keys(nodes)) {
            const n: any = nodes[key]
            if (!n) continue
            if (n.nodeType === 1 && n.setAttribute) {
              n.setAttribute('mjs-h', key)
            } else if (n.nodeType === 3 && n.parentNode) {
              n.parentNode.insertBefore(doc.createComment('mjs-h:' + key), n)
            }
          }
        }
        // (mode `csp`) — un `<script>` en ligne est bloqué par `script-src` sans
        // 'unsafe-inline' : le flag voyage alors par un ATTRIBUT du nœud racine (relu par
        // mjs_init.ts au boot) au lieu d'un script inline. `csp: false` (défaut) : chemin
        // INCHANGÉ, hydrateScript garde sa forme historique.
        if (cspStrict) {
          attrs += ` data-mjs-ssr-hydrate="${_mode}"`
        } else {
          // Le flag porte le MODE d'hydratation (a/b/c) pour que le client dispatche.
          hydrateScript = '<script>window.__mjs_ssrHydrate=' + JSON.stringify(_mode) + '</' + 'script>'
        }
      }

      let shadowHtml: string
      let html: string
      const warnings = compileWarnings.slice()
      // Clé(s) omises pendant la sérialisation du store/i18n (cf. serializeGlobal ci-dessus).
      if (globalSerializeWarnings.length) warnings.push(...globalSerializeWarnings)
      if (forwardBlockedWarning) warnings.push(forwardBlockedWarning)
      // Rendu non stabilisé dans
      // settleMs : le HTML sérialisé peut être incomplet (état transitoire figé).
      // On l'annonce plutôt que de laisser une divergence SSR/client silencieuse.
      if (!settled) {
        warnings.push(t('server.ssr-non-stabilise', { tag, settleMs }))
      }
      // Garde-fou — un `{await}` rejeté SANS branche `{error}` pour le
      // consommer (mjs_element.ts, `_mjs_updAwait` : `targetFn` reste `null` faute de `errorFn`) retombe
      // sur un rendu VIDE, en silence total : `state.error` (l'objet Error RÉEL) est connu ICI, côté
      // serveur, mais ne ressortait nulle part de `RenderResult` — régression cliente muette (le
      // serveur avait toute l'info et ne la restituait pas). `collectAwaitStates` (déjà utilisé par
      // `hasPendingAwait`) couvre TOUT l'arbre (racine + descendants shadow/light), pas seulement la
      // racine. Promu au catalogue (`server.ssr-await-rejete-sans-branche`), la clé
      // manquait à `messages/fr.ts`/`messages/en.ts`.
      for (const states of collectAwaitStates(el)) {
        if (!states || typeof states.forEach !== 'function') continue
        states.forEach((st: any) => {
          // Garde-fou — `st.unhandled` (posé par `_mjs_updAwait` au moment du rejet,
          // mjs_element.ts) distingue un rejet VRAIMENT sans branche {error} d'un rejet déjà consommé
          // par elle : sans ce filtre, l'avertissement partait MÊME quand {error err}…{end} affichait
          // déjà le message.
          if (st && st.status === 'error' && st.unhandled) {
            const msg = st.error instanceof Error ? st.error.message : String(st.error)
            warnings.push(t('server.ssr-await-rejete-sans-branche', { tag, message: msg }))
          }
        })
      }
      // `shadowMode` interpolé dans un attribut :
      // typé 'open'|'closed' mais un appelant en `as any` pourrait injecter. Défensif : seul
      // 'closed' est retenu, tout le reste → 'open'. Calculé ICI (avant les 2 branches)
      // — `serializeShadow` en a besoin pour les <template> NESTED, pas seulement celui de la racine.
      const sm = shadowMode === 'closed' ? 'closed' : 'open'
      // balisage rendu par le serveur : marqué pour rester peint jusqu'au premier rendu client
      // (cf. `markSsrTree`). La racine porte l'attribut par sa chaîne d'attributs, seule source de
      // sa balise sérialisée.
      markSsrTree(el)
      attrs += ' mjs-ssr'
      if (light) {
        // Mode light : le contenu est directement dans l'élément (pas de shadow) — la récursion
        // couvre quand même un éventuel sous-composant À SHADOW imbriqué dans ce light DOM
        // (`el._shadow === el` en mode light, `serializeShadow` le traite pareil).
        // La feuille scopée, elle, n'est NULLE PART dans cet arbre : le runtime l'injecte dans le
        // `document.head` de la fenêtre de rendu (mjs_element.ts, hôte léger hors de tout shadow),
        // que le fragment n'emporte pas. Elle voyage donc ICI, en premier enfant, `:host` réécrit
        // en nom de balise — sans hôte réel, `:host` ne désignerait rien. Même réécriture que le
        // runtime : la sienne quand la fenêtre du rendu l'expose, la copie serveur sinon.
        const rewriteHost = (window.µ && typeof window.µ._lightHostCss === 'function') ? window.µ._lightHostCss : lightHostCss
        const lightCss = css ? String(rewriteHost(css, tag)) : ''
        const styleTag = feuille(lightCss, tag)
        shadowHtml = serializeShadow(el, sm, feuille)
        html = `<${tag}${attrs}>${styleTag}${shadowHtml}</${tag}>`
      } else {
        // Walk récursif (cf. `serializeShadow`) : un sous-composant à shadow propre
        // réinjecte son PROPRE <template shadowrootmode> + sa feuille, à tout niveau de composition
        // — et par le MÊME émetteur que la racine, donc en `<link>` sous le mode strict.
        shadowHtml = serializeShadow(el, sm, feuille)
        // Un CSS contenant `</style`
        // (ex. `content:"</style>"`) refermait PRÉMATURÉMENT la balise → tout le
        // reste du template avalé comme texte. On neutralise la séquence (`<\/style`
        // — `\/` est un échappement CSS valide, round-trip exact). `css` retourné
        // dans le RenderResult reste l'ORIGINAL (seul l'inline est protégé).
        // (mode `csp`) — un `<style>` en ligne DANS un `<template shadowrootmode>` est BLOQUÉ
        // par `style-src` sans 'unsafe-inline' (vérifié en navigateur) ; un `<link>`, lui,
        // s'applique dans une racine d'ombre — prouvé. `csp: false` (défaut) : chemin INCHANGÉ.
        const styleTag = feuille(css, tag)
        html = `<${tag}${attrs}><template shadowrootmode="${sm}">${styleTag}${shadowHtml}</template></${tag}>`
        // `shadowMode:'closed'` produit un
        // DSD `<template shadowrootmode="closed">` que le NAVIGATEUR attache tel
        // quel au parsing (Shadow DOM natif, hors du contrôle de MJS). Mais un
        // shadow `closed` n'expose JAMAIS son contenu via `el.shadowRoot` (null
        // par design/spec, même pour celui posé par le PARSEUR lui-même) — la
        // reprise en main cliente (mjs_element.ts, `else if (this.shadowRoot)`)
        // ne peut donc PAS le détecter ni l'adopter, et retombe sur
        // `attachShadow({mode:'closed'})`, qui ÉCHOUE ("already hosts a shadow
        // tree") puisqu'un shadow existe déjà — upgrade du custom element
        // définitivement cassé (composant mort). AUCUN mode d'hydratation
        // ('replace'/'markers'/'positional'/'diff') ne peut fonctionner ici :
        // le problème est dans le constructor, commun à tous. Averti ICI (au
        // rendu serveur, à la source) plutôt que de laisser découvrir le crash
        // client sans lien évident avec cette option — cf. aussi le message
        // d'erreur explicite ajouté côté client (mjs_element.ts).
        if (shadowMode === 'closed') {
          warnings.push(t('server.ssr-shadow-closed', { tag }))
        }
      }

      // `html.includes('mjs-fatal-error')` = FAUX POSITIF : une page dont la
      // PROSE cite littéralement cette classe (sans aucun crash) échouait quand même. Signal
      // STRUCTUREL désormais : le compteur posé par `_mjs_catchError` (mjs_element.ts, `µ._fatalErrors`,
      // incrémenté SEULEMENT quand l'overlay fatal est réellement construit, jamais par une frontière
      // <@failed> qui absorbe) relu via `window.µ` (cette fenêtre happy-dom l'expose toujours, cf.
      // `globalThis.µ = µ` plus haut) ; à défaut, un ÉLÉMENT réel `.mjs-fatal-error` dans le DOM
      // (jamais un test de texte).
      const hasFatalOverlay = (window.µ && window.µ._fatalErrors) || !!(document.querySelector && document.querySelector('.mjs-fatal-error'))
      if (hasFatalOverlay) {
        throw new Error(t('server.ssr-erreur-non-geree', { tag }))
      }

      return { html, shadowHtml, css, light, sharedScript, hydrateScript, warnings }
    } finally {
      // Garde-fou — `window.close()` (API DOM standard) est un NO-OP
      // pour toute Window happy-dom créée nue (`new Window()`, jamais via `window.open()`) : le
      // vrai nettoyage vit sous `window.happyDOM.close()` (DetachedWindowAPI, `node_modules/happy-dom/
      // lib/window/DetachedWindowAPI.js` — « aborts all async tasks and closes the window »). Sans ce
      // correctif, un `setInterval`/`setTimeout` posé par un `µeffect` pendant le rendu (`µeffect`
      // tourne bien au SSR, contrat documenté) fuyait INDÉFINIMENT (VRAI timer Node process-level,
      // happy-dom lie ses timers directement à ceux du host) — best-effort : ne doit jamais masquer
      // l'erreur/résultat du try.
      try { await window.happyDOM?.close?.() } catch { /* ignore */ }
    }
  }

  async function close(): Promise<void> {
    await bundler.close()
    abandon()
  }

  return { renderToString, close, get i18nLoadCount() { return i18nLoadCount } }
}

export interface RenderToStringOptions extends SSRRendererOptions, RenderOptions {
  /** Tag du composant racine à rendre, ex : `mjs-counter`. */
  tag: string
}

/**
 * Helper « tout-en-un » : compile, rend un composant, libère. Pratique pour un
 * rendu ponctuel ou les tests. Pour plusieurs rendus, préférez
 * `createSSRRenderer` (compile une seule fois).
 */
export async function renderToString(opts: RenderToStringOptions): Promise<RenderResult> {
  const renderer = await createSSRRenderer({
    sourceDir: opts.sourceDir,
    outputDir: opts.outputDir,
    // LISTE BLANCHE écrite à la main : `manifestPath`/`bundlerOpts` en
    // manquaient, silencieusement perdus pour tout appelant de ce wrapper — contrairement à
    // l'API interne (createSSRRenderer directement) qui les honore déjà.
    manifestPath: opts.manifestPath,
    defaultScriptLang: opts.defaultScriptLang,
    templateLang: opts.templateLang,
    sigil: opts.sigil,
    contextAlias: opts.contextAlias,
    stylesheetsDir: opts.stylesheetsDir,
    css: opts.css,
    csp: opts.csp,
    maxStateVars: opts.maxStateVars,
    a11y: opts.a11y,
    i18n: opts.i18n,
    env: opts.env,
    bundlerOpts: opts.bundlerOpts,
  })
  try {
    return await renderer.renderToString(opts.tag, {
      props: opts.props,
      store: opts.store,
      ssrMode: opts.ssrMode,
      shadowMode: opts.shadowMode,
      settleMs: opts.settleMs,
      // Même liste blanche incomplète côté RenderOptions : `light:true` rendait encore
      // `light:false` (+ un Shadow DOM déclaratif complet) sur ce wrapper, `forwardedUrl`/
      // `forwardedCookie` n'atteignaient jamais happy-dom.
      forwardedUrl: opts.forwardedUrl,
      forwardedCookie: opts.forwardedCookie,
      light: opts.light,
    })
  } finally {
    await renderer.close()
  }
}
