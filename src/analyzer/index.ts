// analyzer — port de la V1 Ruby, modular_js_analyzer.rb + ast_daemon.js (section script).
//
// Plus de daemon Node externe : acorn + magic-string sont appelés en direct.
// L'analyse se fait sur du JS (post-tokenize), donc indépendant du langage source.
//
// Responsabilités :
//   1. Détecter les `$.x` (state) et `$.x = expr` top-level (assignations).
//   2. Si RHS contient d'autres `$.y`, c'est un computed → wrap dans `{_mjs_c: true, f: () => (RHS)}`.
//   3. Skip si RHS est `µ.snap(...)` (snapshot via `=:`).
//   4. Auto-declare-from-template : scan HTML pour `$xxx`, ajoute aux state vars manquantes.
//   5. batchCalculateVars(snippets) : analyse chaque snippet, cache la liste des varNames
//      (closure transitive : si snippet utilise un computed, on remplace par ses deps state).
//   6. getEffectVars(snippet) : retourne UNION des state vars dont dépend l'expression.
//
// V2 — plus de bitmask :
//   - L'invalidation runtime n'utilise plus de mask Int32/BigInt. À la place, le
//     generator pousse les updates dans `effectsByVar: Map<varName, Code[]>` et
//     le runtime invoque UNIQUEMENT les effects abonnés à la var muée.
//   - Pour rétro-compat avec les stores universels (`µ.state`, `µ.store`) qui
//     lisaient `_mjs_var_bits[k] !== undefined`, on émet toujours `_mjs_var_bits`, mais
//     uniquement comme "registre de présence" (valeur 1 pour chaque var) — pas
//     un mask réel. L'objet est plus petit et plus simple.
//
// Closure transitive : un computed C qui dépend de A et B, et A dépend de X,
// renvoie pour C la liste [X, A, B] (toutes les state vars transitives).
// getEffectVars renvoie cette closure pour un snippet d'expression.

import * as acorn from 'acorn'
import * as walk from 'acorn-walk'
import MagicString from 'magic-string'
import { t } from '../messages/index.js'
import { maskInertSameLength } from '../lexer/index.js'
import { maskHtmlComments, replaceBlocks } from '../mask.js'
import { typedLine, printDiagnostic, type LintToggles } from '../diagnostics.js'
import { derivedToKnownReads, patternNames, blockScope, functionScope, type DerivedCandidate, type Receiver } from './derived-reads.js'
import { preciseDerived, doubtfulVariables } from './derived-classes.js'
import { rejectAwaitOutsideDerived, rejectSelfCitingWait, type WrittenScript } from './await-outside-derived.js'

export interface AnalyzeSnippetResult {
  deps: string[]
}

export interface AnalyzerOutput {
  state: string[]
  computed: Record<string, string[]>
  // nom de méthode (`@x = ->`) → lectures BRUTES de son corps ($.x,
  // deps store '$$x'/'$$*', et appels vers une AUTRE méthode connue marqués
  // '@nom' — point-fixés par resolveMethodReadsFixedPoint, cf. plus bas).
  methods: Record<string, string[]>
  // noms du premier niveau du `<script>` qu'une expression du gabarit peut appeler par leur nom (cf. scriptFunctions) ; absent
  // quand le script n'en déclare aucun
  scriptNames?: Map<string, boolean>
  // fonction du `<script>` que l'analyse sait lire → lectures BRUTES de son corps, comme `methods` (marqueurs '@nom' vers une
  // méthode, '%nom' vers une fonction du script) ; et, par méthode, les fonctions du script qu'elle appelle ou passe en valeur
  // ('%nom') — pour le gabarit seulement, `methods` reste ce que lisent les reffets
  functions?: Record<string, string[]>
  methodFunctions?: Record<string, string[]>
  // valeurs dérivées qui lisent l'état par une clé calculée (`$[$k]`) sans appeler de fonction : ce qui les affiche se
  // relance à toute écriture du composant (dépendance `*` du gabarit, cf. Analyzer.expandOneDep)
  all?: string[]
  // valeurs dérivées qui appellent une fonction : ce qui les lit garde ses dépendances connues, jamais `*`
  // (cf. Analyzer.resolveSnippetDeps)
  calls?: string[]
  // valeurs dérivées trouvées, avec le nœud de leur expression (classement de `mjs check --derived`, cf. derived-classes.ts)
  candidates?: DerivedCandidate[]
  modifiedCode: string
}

// ============================================================================
// Store universel ($$x → µ.store.x) — détection PARTAGÉE entre analyzeSnippet
// et analyze() (RHS des derived). Une lecture `µ.store.x` (nested) devient une
// dépendance PRÉFIXÉE '$$x' (namespace séparé, ne collisionne jamais avec un
// $ local homonyme). Une référence NUE à `µ.store` (Object.keys/values/entries,
// for…in, spread — bref : PAS suivie d'un `.prop` qui la consomme) est une
// dépendance STRUCTURELLE '$$*' (l'ensemble des clés, pas une clé précise).
// ============================================================================
function isStoreRootMember(node: any): boolean {
  return !!node && node.type === 'MemberExpression' && !node.computed &&
    node.object?.type === 'Identifier' && node.object.name === 'µ' &&
    node.property?.type === 'Identifier' && node.property.name === 'store'
}

/** Marque le node `µ.store.x`/`µ.store` dans `deps` (ancestor-aware — sert à
 * distinguer un accès PROPRIÉTÉ (`.x` dessus) d'une référence BRUTE). */
export function collectStoreMemberDep(node: any, ancestors: any[], deps: Set<string>): void {
  // `µ.store.x` (nested) → '$$x'
  if (!node.computed && isStoreRootMember(node.object) && node.property?.type === 'Identifier') {
    deps.add(`$$${node.property.name}`)
    return
  }
  // `µ.store` référencé BRUT (pas suivi d'un `.x` qui le consomme) → '$$*'
  if (isStoreRootMember(node)) {
    const parent = ancestors[ancestors.length - 2]
    const isPropertyAccessRoot = parent && parent.type === 'MemberExpression' && !parent.computed && parent.object === node
    if (!isPropertyAccessRoot) deps.add('$$*')
  }
}

// un nom lu dans une fonction écrite sur place (expression du gabarit, corps d'une fonction du `<script>`) est masqué par un
// paramètre ou une déclaration d'une fonction ou d'un bloc qui l'englobe (`total := …` dans une autre fonction), ou par le
// paramètre d'un `catch`
function isShadowed(name: string, ancestors: any[]): boolean {
  for (const a of ancestors) {
    if ((a.type === 'ArrowFunctionExpression' || a.type === 'FunctionExpression' || a.type === 'FunctionDeclaration') && functionScope(a).has(name)) return true
    if (a.type === 'BlockStatement' && blockScope(a.body).has(name)) return true
    if (a.type === 'CatchClause' && a.param) {
      const seen: string[] = []
      patternNames(a.param, seen)
      if (seen.includes(name)) return true
    }
  }
  return false
}

// marqueur d'un nom du `<script>` (cf. scriptFunctions) lu par une expression du gabarit ou par le corps d'une fonction :
// '%nom' pour une fonction que l'analyse sait lire, appelée (`fmt()`) ou passée en valeur (`liste.map(fmt)`) ; '!nom' pour un
// autre nom du premier niveau, appelé ; `null` pour tout le reste
function nameMark(node: any, ancestors: any[], script: ReadonlyMap<string, boolean>): string | null {
  const readable = script.get(node.name)
  if (readable === undefined || isShadowed(node.name, ancestors)) return null
  if (readable) return `%${node.name}`
  const parent = ancestors[ancestors.length - 2]
  return parent?.type === 'CallExpression' && parent.callee === node ? `!${node.name}` : null
}

// ============================================================================
// Analyse standalone d'un snippet de JS (utilisée par batchCalculateVars)
//
// `analyzeSnippetOrNull` distingue l'ÉCHEC de parse
// (`null`) de « aucune dépendance » (`[]`) ; `analyzeSnippet` garde le
// contrat HISTORIQUE ([] dans les deux cas, tous ses appelants existants —
// batchCalculateVars, l'export public, les tests — comptent dessus) et
// délègue simplement ici. Sert au repli Civet de `getEffectVars`
// (generator/state.ts) : décider s'il faut RETENTER avant de conclure à
// l'absence de dépendance, plutôt que d'avaler l'échec en silence.
// ============================================================================
// `script` : noms du premier niveau du `<script>` (cf. scriptFunctions), absent pour les appelants qui n'en ont pas
export function analyzeSnippetOrNull(jsCode: string, key = false, script?: ReadonlyMap<string, boolean> | null): string[] | null {
  const deps = new Set<string>()
  // avec `cle` : accès calculé `$[expr]` lu, appel d'une fonction (cf. fin de la fonction)
  let reads  = false
  let call = false
  let ast: acorn.Node
  try {
    ast = acorn.parse(jsCode, { ecmaVersion: 'latest', sourceType: 'module' })
  } catch {
    return null
  }
  walk.ancestor(ast, {
    MemberExpression(node: any, _state: any, ancestors: any[]) {
      // `!node.computed` : `$[cle]` (accès calculé) n'est PAS une state
      // var `$.cle` ; sans ce test il polluait les deps du snippet d'une var
      // fantôme `cle`. `$['x']` (Literal) était déjà exclu par le test Identifier.
      if (node.object.type === 'Identifier' && node.object.name === '$' && !node.computed) {
        if (node.property.type === 'Identifier') deps.add(node.property.name)
        return
      }
      // `$[expr]` : la variable lue n'est connue qu'à l'exécution (cf. fin de la fonction)
      if (key && node.object.type === 'Identifier' && node.object.name === '$') {
        reads = true
        return
      }
      // Store universel `$$x` (→ `µ.store.x`) — namespace préfixé '$$'.
      // NB : `µ._mjs_storeRaw.x` (µread $$x) et `µ._mjs_storeRawWrite.x` (µwrite $$x) ne matchent jamais (property
      // du membre intermédiaire = '_mjs_storeRaw…', pas 'store') — non tracké,
      // par construction, exactement comme voulu (accès brut, non réactif).
      collectStoreMemberDep(node, ancestors, deps)
    },
    // `@fmt()` dans un snippet de template compile en `this.fmt()`
    // (reader/expression.ts, lecture par l'arbre — couvre aussi `_mjsThis.fmt()`,
    // forme de `@@fmt()`, par robustesse). Marqueur '@fmt' résolu PLUS TARD
    // par resolveSnippetDeps (classe Analyzer, via this.methodReads) — jamais
    // émis tel quel : aucune var '@fmt' n'existe côté runtime.
    CallExpression(node: any) {
      call = true
      const callee = node.callee
      if (!callee || callee.type !== 'MemberExpression' || callee.computed) return
      if (callee.object?.type !== 'ThisExpression' &&
          !(callee.object?.type === 'Identifier' && callee.object.name === '_mjsThis')) return
      if (callee.property?.type !== 'Identifier') return
      deps.add(`@${callee.property.name}`)
    },
    NewExpression() { call = true },
    TaggedTemplateExpression() { call = true },
    // nom du `<script>` lu par l'expression (nameMark) : '%fmt' résolu comme '@fmt' par resolveSnippetDeps, '!nom' dit par
    // generator/state.ts ; sans `script`, rien de plus
    Identifier(node: any, _state: any, ancestors: any[]) {
      if (!script) return
      const mark = nameMark(node, ancestors, script)
      if (mark !== null) deps.add(mark)
    },
  })
  // expression du gabarit (`cle`, cf. Analyzer.batchCalculateVars) : qui lit `$[expr]` sans rien appeler, dépendance `*`
  // — toute écriture du composant la relance (`_mjsAll`, runtime/mjs_element.ts) ; qui appelle une fonction, marque
  // `()` — elle garde ses dépendances connues, une requête n'est pas refaite à chaque écriture (resolveSnippetDeps)
  if (key) {
    if (call) deps.add('()')
    else if (reads) deps.add('*')
  }
  return Array.from(deps)
}

/** Contrat historique — `[]` que l'échec soit un parse invalide ou une
 * expression sans dépendance. Cf. `analyzeSnippetOrNull` pour la variante
 * qui distingue les deux. */
export function analyzeSnippet(jsCode: string, key = false, script?: ReadonlyMap<string, boolean> | null): string[] {
  return analyzeSnippetOrNull(jsCode, key, script) ?? []
}

// ============================================================================
// collectStoreReads(jsCode) — scan LECTURE-SEULE dédié pour storeKeysSet : un
// `$$x` lu DANS LE <script> (µeffect, méthode…),
// jamais mentionné par le GABARIT, n'ouvrait aucune subscription store —
// `storeKeysSet` (transpiler/index.ts) ne scannait que `effectsByVar`/
// `structVars`, tous deux issus de compileHtml() (le template). Variante
// RETENUE : scan DÉDIÉ, PAS de réutilisation de storeDeclareKeys
// (celui-ci sur-abonnerait sur les clés seulement ÉCRITES — un composant qui
// n'ÉCRIT que dans le store n'a rien à invalider chez lui, donc rien à ouvrir).
//
// Réutilise collectStoreMemberDep (même règle µ.store.x/µ.store nu) ; exclut
// les cibles d'écriture (cible `left` d'une affectation — tout opérateur — et
// argument d'un `++`/`--`), collectées d'abord dans un Set de nœuds (même
// motif que `pureWriteTargets` du handler µ.effect plus bas). Seul le nœud
// EXACT de la cible est exclu : une mutation profonde (`$$x.champ = …`) reste
// donc comptée en lecture (réactivité profonde par défaut, cf. store) — c'est
// le node du niveau `µ.store.x` qui matche la cible, pas celui d'un niveau
// plus bas. Retourne les clés dépréfixées ('$$x'→'x', '$$*'→'*'), triées.
// ============================================================================
export function collectStoreReads(jsCode: string): string[] {
  const deps = new Set<string>()
  let ast: acorn.Node
  try {
    ast = acorn.parse(jsCode, { ecmaVersion: 'latest', sourceType: 'module' })
  } catch {
    return []
  }
  const writeTargets = new Set<any>()   // cibles d'écriture pures — jamais des lectures
  walk.simple(ast, {
    AssignmentExpression(a: any) { writeTargets.add(a.left) },
    UpdateExpression(u: any) { writeTargets.add(u.argument) },
  })
  walk.ancestor(ast, {
    MemberExpression(node: any, _state: any, ancestors: any[]) {
      if (writeTargets.has(node)) return
      collectStoreMemberDep(node, ancestors, deps)
    },
  })
  return Array.from(deps).map(d => d.slice(2)).sort()
}

// ============================================================================
// Détection du mode @attach — port de ast_daemon.js attach_mode
// CallExpression avec arg `_node` → 'direct' ; sinon 'factory'
// ============================================================================
export function analyzeAttachMode(jsCode: string): 'direct' | 'factory' {
  try {
    const ast: any = acorn.parseExpressionAt(jsCode, 0, { ecmaVersion: 'latest' })
    if (ast.type === 'CallExpression') {
      const hasNode = ast.arguments.some((a: any) =>
        a.type === 'Identifier' && a.name === '_node'
      )
      return hasNode ? 'direct' : 'factory'
    }
    return 'factory'
  } catch {
    return 'direct'
  }
}

// ============================================================================
// scanReactiveReads(node) — scanne un sous-arbre RHS pour ses dépendances
// réactives (deps `$.y`, store universel, contexte, await). Factorisé :
// réutilisé À L'IDENTIQUE par le chemin `$.x = expr` normal
// ET par detectUnparenthesizedDerivedIf() (cf. plus bas) — appliqué
// à s1 (la structure if/switch/try) au lieu du RHS d'une simple assignation.
// ============================================================================
function scanReactiveReads(node: any): { deps: Set<string>; readsReactiveSource: boolean; hasAwait: boolean; key: boolean; call: boolean } {
  const deps = new Set<string>()
  // #4 — un RHS qui lit le contexte (`§x` → `this._mjs_getContext('x')`) mais
  // aucun `$.y` n'était PAS reconnu comme derived → assignation évaluée UNE
  // fois dans le constructeur, AVANT connectedCallback : `getContext` ne
  // trouve alors aucun ancêtre → `undefined`. La wrapper en computed la fait
  // évaluer LAZY au 1er render (post-connexion), où le contexte est
  // disponible. (Idiome du tuto officiel 15-1.)
  let readsReactiveSource = false
  let hasAwait = false
  // lecture par une clé calculée (`$[$k]`) : la variable lue n'est connue qu'à l'exécution
  let key = false
  // appel d'une fonction (hors marqueur de `µderived`) : la valeur garde ses dépendances connues (cf. AnalyzerOutput.appels)
  let call = false
  // cible d'une affectation simple (`$a = $b = 0` : `$.b` est ÉCRIT, jamais lu) — comptée en lecture, elle faisait
  // de `$a` un dérivé qui écrivait `$b` et valait le retour de l'écriture (même motif que pureWriteTargets, plus bas)
  const written = new Set<any>()
  walk.simple(node, { AssignmentExpression(a: any) { if (a.operator === '=') written.add(a.left) } })
  walk.ancestor(node, {
    // l'expression elle-même attend, hors des fonctions qu'elle contient : `$x = $l.map((i) -> await f(i))` n'attend rien
    AwaitExpression(_a: any, _s: any, ancestors: any[]) { if (!ancestors.some((p) => /Function/.test(p.type))) hasAwait = true },
    MemberExpression(c: any, _s: any, ancestors: any[]) {
      if (written.has(c)) return
      if (c.object.type === 'Identifier' && c.object.name === '$') {
        if (!c.computed) {
          if (c.property.type === 'Identifier') deps.add(c.property.name)
        }
        else key = true
      }
      // #7 — store universel (`$$x` → `µ.store.x`, ou tapé à la main en
      // `µ.store.x`) : source réactive sans `$.y`, donc même piège que le
      // contexte (assignation one-shot dans le constructeur). (`§§x`, lui,
      // compile en `_mjs_getRCtx(...)` — CallExpression détecté juste en
      // dessous — jamais en `µ.shared.x` : l'espace `µ.shared` n'existe
      // plus, retiré avec l'option SSR `shared`.)
      // Statisation $$ : `$$y` (nested `µ.store.y`) → dep préfixée '$$y'
      // (câble le recompute du derived sur l'écriture de la clé store, en
      // miroir du câblage des `$.y` locaux) ; `µ.store` référencé BRUT
      // (énumération) → '$$*'. Les deux marquent aussi readsReactiveSource.
      // la donnée d'un magasin chargé (`µload(url).data?.n`, `.pending`, `.error`) : une valeur qui la lit se recalcule à chaque arrivée
      // d'une réponse (runtime/mjs_load.ts) ; le magasin lui-même (`$me = µload(url)`), rangé tel quel, et tout autre membre
      // (`µload(url).refresh()`, qui relancerait une requête à chaque calcul) restent une variable
      const o = c.object
      const member = c.computed ? (c.property.type === 'Literal' ? c.property.value : null) : c.property.name
      if (o.type === 'CallExpression' && o.callee.type === 'MemberExpression' && !o.callee.computed && o.callee.object.type === 'Identifier' && o.callee.object.name === 'µ' && o.callee.property.type === 'Identifier' && o.callee.property.name === 'load' && (member === 'data' || member === 'pending' || member === 'error')) readsReactiveSource = true
      const before = deps.size
      collectStoreMemberDep(c, ancestors, deps)
      if (deps.size > before) readsReactiveSource = true
      else if (c.object.type === 'Identifier' && c.object.name === 'µ' &&
          c.property.type === 'Identifier' &&
          c.property.name === 'store') {
        readsReactiveSource = true
      }
    },
    NewExpression() { call = true },
    TaggedTemplateExpression() { call = true },
    CallExpression(c: any) {
      const m = c.callee
      if (!(m.type === 'MemberExpression' && m.object.type === 'Identifier' && m.object.name === 'µ' && m.property.type === 'Identifier' && m.property.name === '_mjs_forceDeps')) call = true
      // `§x` → this._mjs_getContext('x') (contexte NON réactif, lu 1×).
      // `§§x` → this._mjs_getRCtx('x') (contexte RÉACTIF de sous-arbre) : sans
      // le détecter ici, `$x = §§y` n'était PAS wrappé en computed → évalué
      // EAGER au constructeur (composant pas encore connecté → getRCtx ne
      // trouve aucun ancêtre → `undefined` figé). Le wrapper lazy le fait
      // évaluer au 1er render (contexte présent) ; et pour `§§y.champ`, la
      // lecture du champ passe par le proxy µ.state → dep universelle →
      // re-render au changement (faille §4 refermée).
      if (c.callee.type === 'MemberExpression' &&
          c.callee.property.type === 'Identifier' &&
          (c.callee.property.name === '_mjs_getContext' ||
           c.callee.property.name === '_mjs_getRCtx')) {
        readsReactiveSource = true
      }
    },
  })
  return { deps, readsReactiveSource, hasAwait, key, call }
}

// ============================================================================
// detectUnparenthesizedDerivedIf(ast, ms, dependencies)
//
// Civet abaisse `$.x = if … then … else …` SANS parenthèses, AU TOP-LEVEL, en
// TROIS statements séparés (au lieu d'une seule ConditionalExpression) :
//   let ref;                                    ← s0 : déclaration, sans init
//   if ($.sel) ref = $.a; else ref = $.b;        ← s1 : branches qui affectent ref
//   $.x = ref                                    ← s2 : RHS = identifiant NU
// Le RHS de s2 est `ref`, pas `$.quelquechose` : le walk normal ci-dessous ne
// détecte aucune dep dessus (son propre scanReactiveReads(node.right) tombe
// sur un simple Identifier) → assignation évaluée UNE fois, jamais réévaluée,
// en silence. La forme PARENTHÉSÉE (`$.x = (if … else …)`) compile en une
// SEULE ConditionalExpression et passe déjà par le chemin normal — les deux
// écritures doivent produire le même wrap `{ _mjs_c: true, f: () => … }`.
//
// Pré-passe : ÉDITE `ms` directement, ne touche JAMAIS l'AST (celui-ci reste
// celui vu par le walk juste après, qui continue de voir s0/s1/s2 intacts —
// et n'y fait rien, vu qu'un RHS `ref` nu ne matche aucune de ses conditions).
// ============================================================================
function detectUnparenthesizedDerivedIf(ast: any, ms: MagicString, dependencies: Record<string, string[]>, candidates: DerivedCandidate[], closings: Closing[], all: Set<string>, calls: Set<string>, waits: Set<string>): void {
  const body = ast.body
  for (let i = 0; i + 2 < body.length; i++) {
    const s0 = body[i]
    const s1 = body[i + 1]

    // s0 — `let ref;`/`var ref;`, UN seul déclarateur, SANS init, nom /^ref\d*$/
    if (s0.type !== 'VariableDeclaration' || (s0.kind !== 'let' && s0.kind !== 'var')) continue
    if (s0.declarations.length !== 1) continue
    const decl0 = s0.declarations[0]
    if (decl0.init != null || decl0.id.type !== 'Identifier' || !/^ref\d*$/.test(decl0.id.name)) continue
    const refName = decl0.id.name

    // s1 — la structure de contrôle abaissée (if/switch/try), qui doit
    // RÉELLEMENT affecter refName dans au moins une branche
    if (s1.type !== 'IfStatement' && s1.type !== 'SwitchStatement' && s1.type !== 'TryStatement') continue
    let assignsToRef = false
    walk.simple(s1, {
      AssignmentExpression(a: any) {
        if (a.left.type === 'Identifier' && a.left.name === refName) assignsToRef = true
      },
    })
    if (!assignsToRef) continue

    // s2 — le PROCHAIN statement non-vide après s1. `if`/`else` consomment
    // déjà leur `;` (branches = ExpressionStatement complets) mais `switch`/
    // `try` non : leur grammaire ne prévoit aucun terminateur, donc un `;`
    // isolé après le `}` fermant devient un EmptyStatement À PART ENTIÈRE —
    // vérifié empiriquement (`@danielx/civet` émet bien `};$.x = ref`) — on
    // saute les éventuels EmptyStatement plutôt que d'exiger i+2 strict.
    let j = i + 2
    while (j < body.length && body[j].type === 'EmptyStatement') j++
    const s2 = body[j]
    if (!s2) continue

    // s2 — `$.<nom> = refName` (candidat) — `µ.snap(refName)` = opt-out `=:`
    if (s2.type !== 'ExpressionStatement') continue
    const assign = s2.expression
    if (!assign || assign.type !== 'AssignmentExpression' || assign.operator !== '=') continue
    if (assign.left.type !== 'MemberExpression' || assign.left.computed ||
        assign.left.object.type !== 'Identifier' || assign.left.object.name !== '$' ||
        assign.left.property.type !== 'Identifier') continue

    // instantané volontaire (`=:` côté lexer) — `$.x =: if … else …` → RHS
    // = `µ.snap(ref)` : ne rien faire du tout, ni ici ni dans le walk normal
    const isSnapOfRef =
      assign.right.type === 'CallExpression' &&
      assign.right.callee.type === 'MemberExpression' &&
      assign.right.callee.object.type === 'Identifier' && assign.right.callee.object.name === 'µ' &&
      assign.right.callee.property.type === 'Identifier' && assign.right.callee.property.name === 'snap' &&
      assign.right.arguments.length === 1 &&
      assign.right.arguments[0].type === 'Identifier' && assign.right.arguments[0].name === refName
    if (isSnapOfRef) continue
    if (assign.right.type !== 'Identifier' || assign.right.name !== refName) continue

    // garde — refName ne doit apparaître NULLE PART ailleurs dans le programme
    // (sinon ce n'est pas un temporaire jetable de ce seul abaissement)
    let usedElsewhere = false
    walk.simple(ast, {
      Identifier(idNode: any) {
        if (idNode.name === refName && (idNode.start < s0.start || idNode.end > s2.end)) usedElsewhere = true
      },
    })
    if (usedElsewhere) continue

    const varName = assign.left.property.name
    const { deps, readsReactiveSource, hasAwait, key, call } = scanReactiveReads(s1)
    // rien de réactif dedans → instantané légitime ; une valeur qui attend sans variable citée est appelée une fois
    if (deps.size === 0 && !readsReactiveSource && !hasAwait) continue

    if (deps.size > 0) dependencies[varName] = Array.from(deps)
    if (hasAwait) waits.add(varName)
    if (call) calls.add(varName)
    else if (key) all.add(varName)
    ms.appendLeft(s0.start, `$.${varName} = { _mjs_c: true, f: ${hasAwait ? 'async ' : ''}() => { `)
    ms.overwrite(s2.start, assign.right.start, 'return ')
    candidates.push({ name: varName, node: s1, locals: [refName] })
    closings.push({ name: varName, pos: s2.end, simple: ' } };', marquee: ' }, _mjs_s: 1 };' })
  }
}

// fin d'une enveloppe de valeur dérivée, posée une fois toutes les valeurs dérivées connues : `_mjs_s` marque celles dont toutes les lectures
// sont connues (cf. derived-reads.ts) ou, avec l'option `derived: "precise"`, porte les sources de celles que le compilateur prouve précises
// (cf. preciseDerived, derived-classes.ts), dans l'ordre où elles ont été trouvées
interface Closing { name: string; pos: number; simple: string; marquee: string }

// ============================================================================
// resolveMethodReadsFixedPoint(methods) — une méthode qui APPELLE une
// autre méthode connue (marqueur '@nom' posé par analyze()/analyzeSnippet)
// hérite de SES lectures. Même mécanique que resolveDependencyGraph
// (computeds), sur un graphe distinct (appels de méthode plutôt que
// chaînage de computeds) — garde ≤100 passes identique. Convergence par
// absorption idempotente (Set) : même un cycle A↔B se stabilise en 2 passes
// (chacune récupère l'union de l'autre), sans code de rupture dédié.
// Partagée entre analyze() (warning effet, table LOCALE brute) et
// Analyzer.analyzeAndBuild (methodReads exposé, APRÈS filtre externalVars) —
// une seule implémentation du point-fixe. `markers` : table du gabarit, aux
// clés '@nom' (méthode) et '%nom' (fonction du `<script>`), où chaque marqueur
// lu se cherche tel quel (cf. Analyzer.templateReads).
// ============================================================================
function resolveMethodReadsFixedPoint(methods: Record<string, string[]>, diag: { lint?: LintToggles; colorsEnabled?: boolean } = {}, markers = false): Record<string, string[]> {
  // Object.create(null), même remède que
  // `dependencies` plus bas (analyze()) : `out[k] = …` où `k === '__proto__'` sur un `{}`
  // ordinaire ne crée jamais de clé réelle (le setter hérité de Object.prototype.__proto__
  // redirige l'écriture vers le PROTOTYPE de l'objet), et une lecture ultérieure
  // `out['__proto__']` retombe sur Object.prototype (objet TRUTHY, non itérable).
  const out: Record<string, string[]> = Object.create(null)
  for (const [k, v] of Object.entries(methods)) out[k] = [...v]

  let changed = true
  let safety = 0
  while (changed) {
    changed = false
    safety += 1
    if (safety > 100) {
      const line = typedLine('reactivity', t('analyzer.resolve-dependency-not-convergent'), diag.lint)
      // eslint-disable-next-line no-console
      if (line !== null) printDiagnostic(line, diag.colorsEnabled ?? false)
      break
    }
    for (const [name, reads] of Object.entries(out)) {
      const newReads = new Set(reads)
      for (const r of reads) {
        if (r[0] !== '@' && !(markers && r[0] === '%')) continue
        const sub = out[markers ? r : r.slice(1)]
        if (sub) for (const x of sub) newReads.add(x)
      }
      if (newReads.size > reads.length) {
        out[name] = Array.from(newReads)
        changed = true
      }
    }
  }

  // Marqueurs `@nom` résolus (déjà absorbés dans les lectures ci-dessus) OU
  // inconnus (jamais résolus, méthode hors table) : aucun des deux cas ne
  // doit survivre dans la sortie — un `@nom` littéral n'est ni une state var
  // ni une clé store, effect-deps.ts/resolveSnippetDeps ne doivent JAMAIS le voir.
  for (const name of Object.keys(out)) out[name] = out[name].filter(d => d[0] !== '@' && d[0] !== '%')
  return out
}

// ============================================================================
// scriptFunctions(ast) — noms du premier niveau du `<script>` qu'une expression du gabarit peut appeler par leur nom
// (`{fmt()}`, `{liste.map(fmt)}`) : `true` pour une fonction écrite sur place et affectée une seule fois — déclaration
// (`function fmt`), variable (`fmt := ->`, `let fmt = ->`, forme émise pour `fmt = ->`) ou affectation nue après un `let`
// séparé —, dont l'expression suit les lectures comme celles d'une méthode ; `false` pour un nom affecté deux fois au premier
// niveau, ou dont la valeur est rendue par un appel (`sauver = differe(-> …)`) : appelé par le gabarit, il est signalé à la
// construction. Tout autre nom est retiré, ni suivi ni dit, comme un nom que le script ne déclare pas : fonction réaffectée dans
// une autre fonction (`µmount`), alias d'une fonction du langage ou du navigateur (`arrondi = Math.round`), donnée. Une variable du
// même nom déclarée dans une autre fonction, ou par `let` / `const` dans un bloc, est une autre variable.
// ============================================================================
function scriptFunctions(ast: any): { names: Map<string, boolean>; functions: Record<string, any> } {
  const names                          = new Map<string, boolean>()
  const functions: Record<string, any> = Object.create(null)  // même remède, cf. dependencies (analyze())
  for (const stmt of ast.body) {
    if ((stmt.type === 'FunctionDeclaration' || stmt.type === 'ClassDeclaration') && stmt.id) names.set(stmt.id.name, false)
    else if (stmt.type === 'VariableDeclaration') {
      for (const d of stmt.declarations) {
        const seen: string[] = []
        patternNames(d.id, seen)
        for (const name of seen) names.set(name, false)
      }
    }
    else if (stmt.type === 'ExpressionStatement' && stmt.expression.type === 'AssignmentExpression' && stmt.expression.left.type === 'Identifier') names.set(stmt.expression.left.name, false)
  }
  if (names.size === 0) return { names, functions: functions }
  // affectations de chaque nom : au premier niveau (`premier`, et sa valeur), dans une fonction qui ne le déclare pas (`dedans`) ;
  // `let nom` sans valeur ou à `undefined` (que la construction pose en tête quand un gestionnaire lit aussi le nom) : la
  // déclaration de l'affectation nue qui suit, pas une affectation de plus
  const first  = new Map<string, number>()
  const inside = new Map<string, number>()
  const values = new Map<string, any>()
  const fn     = (a: any): boolean => a?.type === 'FunctionExpression' || a?.type === 'ArrowFunctionExpression' || a?.type === 'FunctionDeclaration'
  const call   = (v: any): boolean => v?.type === 'CallExpression' || (v?.type === 'ChainExpression' && v.expression.type === 'CallExpression') || (v?.type === 'AwaitExpression' && call(v.argument))
  const record = (pattern: any, top: any[], value: any): void => {
    const seen: string[] = []
    patternNames(pattern, seen)
    for (const name of seen) {
      if (!names.has(name) || isShadowed(name, top)) continue
      if (top.some(fn)) inside.set(name, (inside.get(name) ?? 0) + 1)
      else {
        first.set(name, (first.get(name) ?? 0) + 1)
        values.set(name, pattern.type === 'Identifier' ? value : null)
      }
    }
  }
  ;(walk as any).fullAncestor(ast, (n: any, _st: any, anc: any[]) => {
    const top = anc.slice(0, -1)
    if (n.type === 'VariableDeclarator') {
      // déclarée dans une fonction, ou par `let` / `const` dans un bloc : une autre variable
      if (top.some(fn) || (top[top.length - 1]?.kind !== 'var' && top[top.length - 2]?.type !== 'Program')) return
      if (n.init && !(n.init.type === 'Identifier' && n.init.name === 'undefined')) record(n.id, top, n.init)
    }
    else if (n.type === 'AssignmentExpression') record(n.left, top, n.operator === '=' ? n.right : null)
    else if (n.type === 'UpdateExpression') record(n.argument, top, null)
    else if ((n.type === 'FunctionDeclaration' || n.type === 'ClassDeclaration') && n.id && top[top.length - 1]?.type === 'Program') record(n.id, top, n.type === 'FunctionDeclaration' ? n : null)
    else if ((n.type === 'ForOfStatement' || n.type === 'ForInStatement') && n.left.type !== 'VariableDeclaration') record(n.left, top, null)
  })
  for (const name of [...names.keys()]) {
    const p = first.get(name) ?? 0
    const v = values.get(name)
    if (p === 1 && !inside.get(name) && fn(v)) {
      names.set(name, true)
      functions[name] = v
    }
    else if (!(p >= 2 || (p === 1 && call(v)))) names.delete(name)
  }
  return { names, functions: functions }
}

// lectures BRUTES du corps d'une fonction du `<script>` (`tout`), comme celles d'une méthode (methodsRaw, analyze()) — `$.x`,
// magasin, marqueur '@nom' d'une méthode appelée — avec ses marqueurs '%nom' (fonction du script appelée ou passée en valeur,
// nameMark) ; sans `tout`, ces marqueurs seuls (corps d'une méthode, dont le reste est déjà relevé). Toute la chaîne d'objet
// de la cible d'une affectation simple est écrite, pas lue (`$o.a.b = …` écrit `$o`, `$$ui.locked = …` écrit `$$ui`, motifs de
// décomposition compris) ; la clé calculée d'un maillon (`$q[$k] = …`) reste lue, comme `+=`, `||=`, `??=`, `++` et `delete`
function bodyReads(fnNode: any, script: ReadonlyMap<string, boolean>, all: boolean): string[] {
  const reads   = new Set<string>()
  const clean   = functionScope(fnNode)
  const written = new Set<any>()
  if (fnNode.body?.type === 'BlockStatement') for (const name of blockScope(fnNode.body.body).keys()) clean.set(name, 'var')
  const write = (target: any): void => {
    if (!target) return
    if (target.type === 'MemberExpression') for (let m = target; m?.type === 'MemberExpression'; m = m.object) written.add(m)
    else if (target.type === 'ArrayPattern') for (const e of target.elements) write(e)
    else if (target.type === 'ObjectPattern') for (const p of target.properties) write(p.type === 'RestElement' ? p.argument : p.value)
    else if (target.type === 'AssignmentPattern') write(target.left)
    else if (target.type === 'RestElement') write(target.argument)
  }
  if (all) walk.simple(fnNode.body, { AssignmentExpression(a: any) { if (a.operator === '=') write(a.left) } })
  walk.ancestor(fnNode.body, {
    MemberExpression(m: any, _s: any, anc: any[]) {
      if (!all || written.has(m)) return
      if (m.object.type === 'Identifier' && m.object.name === '$' && !m.computed) {
        if (m.property.type === 'Identifier') reads.add(m.property.name)
        return
      }
      collectStoreMemberDep(m, anc, reads)
    },
    CallExpression(c: any) {
      const cc = c.callee
      if (all && cc.type === 'MemberExpression' && !cc.computed && (cc.object.type === 'ThisExpression' || (cc.object.type === 'Identifier' && cc.object.name === '_mjsThis')) && cc.property.type === 'Identifier') reads.add(`@${cc.property.name}`)
    },
    Identifier(node: any, _s: any, anc: any[]) {
      if (clean.has(node.name)) return
      const mark = nameMark(node, anc, script)
      if (mark !== null && mark[0] === '%') reads.add(mark)
    },
  })
  return Array.from(reads)
}

// ============================================================================
// analyze(jsCode) : full script analysis (state + computed + modifiedCode)
// ============================================================================
// `preAst` : l'AST de `jsCode` déjà analysé ; absent ou `null` (analyse échouée en amont), le texte est relu — et l'erreur
// d'analyse levée comme avant
// `moduleVars` : noms du premier niveau du `<script module>` ; `externalVars` : variables externes (`$nom`)
export function analyze(jsCode: string, diag: { lint?: LintToggles; colorsEnabled?: boolean; moduleVars?: string[]; externalVars?: string[]; raw?: boolean; precise?: boolean; written?: WrittenScript } = {}, preAst?: acorn.Node | null): AnalyzerOutput {
  const stateVariables = new Set<string>()
  // Object.create(null) sur TOUS les dicts de ce
  // fichier indexés par un nom UTILISATEUR (méthode/état/computed) : un `{}` ordinaire
  // redirige silencieusement toute écriture `dict['__proto__'] = x` vers le SETTER hérité
  // de Object.prototype (change le PROTOTYPE de dict au lieu d'y créer une clé) — la
  // valeur est perdue, et une lecture `dict['__proto__']` ultérieure retombe sur
  // Object.prototype (objet TRUTHY, non itérable) au lieu d'undefined. Défense en
  // profondeur : la garde `RESERVED_STATE_NAMES` (assertStateNameAllowed/rejet inline
  // ci-dessous) reste la protection PRIMAIRE, celle-ci couvre tout chemin qui l'aurait
  // contournée.
  const dependencies: Record<string, string[]> = Object.create(null)
  // valeurs dérivées qui lisent l'état par une clé calculée, ou qui appellent une fonction (cf. AnalyzerOutput)
  const all   = new Set<string>()
  const calls = new Set<string>()
  // méthodes du composant (`@x = ->`) : nom → nœud fonction (RHS),
  // collectées par le handler AssignmentExpression plus bas. Sert à la garde
  // état/méthode homonymes (transpile(), après auto-déclaration template) ET
  // au calcul des lectures héritées (methodsRaw, après le walk, plus bas).
  const methodNames = new Set<string>()
  const methodNodes: Record<string, any> = Object.create(null)  // même remède, cf. dependencies plus haut
  // Effets `µeffect` collectés PENDANT le walk (nœud complet, pas encore de
  // verdict) : la table des méthodes n'est complète qu'APRÈS le walk ENTIER
  // (une méthode peut être déclarée textuellement APRÈS l'effet qui l'appelle)
  // — le warning « lit ET écrit » est donc émis plus bas, post point-fixe.
  const pendingEffectWarnings: { reads: Set<string>; writes: Set<string>; calledMethods: Set<string> }[] = []

  let ast: acorn.Node
  if (preAst) ast = preAst
  else {
    try {
      ast = acorn.parse(jsCode, { ecmaVersion: 'latest', sourceType: 'module' })
    } catch (e: any) {
      throw new Error(`[analyzer] parse error: ${e.message}`)
    }
  }

  const ms = new MagicString(jsCode)

  // pré-passe DÉDIÉE, AVANT le walk : édite `ms` directement, ne
  // mute jamais `ast` (le walk ci-dessous continue de voir s0/s1/s2 intacts,
  // cf. detectUnparenthesizedDerivedIf() plus haut pour le détail du motif)
  const candidates: DerivedCandidate[] = []
  const closings: Closing[] = []
  // valeurs dérivées qui attendent (`$x = await f($q)`, transpiler/await-derived.ts)
  const waits = new Set<string>()
  detectUnparenthesizedDerivedIf(ast, ms, dependencies, candidates, closings, all, calls, waits)

  walk.ancestor(ast, {
    MemberExpression(node: any) {
      // voir analyzeSnippet : `$[cle]` (computed) ≠ state var `$.cle`.
      if (node.object.type === 'Identifier' && node.object.name === '$' && !node.computed) {
        if (node.property.type === 'Identifier') stateVariables.add(node.property.name)
      }
    },
    AssignmentExpression(node: any, _state: any, ancestors: any[]) {
      // `@x = ->` (transpilé
      // `this.x = function…`, ou `_mjsThis.x = function…` pour `@@x`, cf.
      // lexer/index.ts §3.4) : une MÉTHODE publique du composant. Relevée ICI,
      // AVANT le filtre `insideFunction` juste en dessous — périmètre
      // TOUTE-PROFONDEUR délibéré, symétrique des états `$.x` (le walker
      // MemberExpression qui les collecte, plus haut, n'a lui non plus aucun
      // filtre) : les deux tables doivent se comparer sur le MÊME périmètre,
      // sinon la garde de collision (posée dans transpile(), pas ici — cf.
      // AnalyzerOutput.methods) laisserait passer une méthode imbriquée.
      // Le RHS DOIT être une fonction : `this.x = 1` dans un corps de méthode
      // écrit une propriété, il ne déclare pas de méthode du composant.
      if (node.left.type === 'MemberExpression' &&
          !node.left.computed &&
          (node.left.object.type === 'ThisExpression' ||
           (node.left.object.type === 'Identifier' && node.left.object.name === '_mjsThis')) &&
          node.left.property.type === 'Identifier' &&
          (node.right.type === 'FunctionExpression' || node.right.type === 'ArrowFunctionExpression')) {
        // rejette `@__proto__`/`@constructor`/
        // `@prototype` ICI, AVANT `methodNodes[...] = ...` : cette écriture sur un dict
        // ORDINAIRE `{}` ne crée jamais de clé réelle pour ce nom précis (setter hérité de
        // Object.prototype.__proto__, redirige vers le PROTOTYPE) — la méthode entière
        // disparaît en silence, et `this.methodReads['__proto__']` (classe Analyzer, plus
        // bas) retombe alors sur Object.prototype (objet TRUTHY, non itérable) →
        // « reads is not iterable », sans jamais nommer la cause. Même liste que les state
        // vars (`Analyzer.RESERVED_STATE_NAMES`, référence AVANT sa propre définition —
        // sûr : `analyze()` n'est jamais appelée avant la fin de l'évaluation du module).
        if (Analyzer.RESERVED_STATE_NAMES.includes(node.left.property.name)) {
          throw new Error(t('analyzer.name-method-reserved', { name: node.left.property.name }))
        }
        methodNames.add(node.left.property.name)
        methodNodes[node.left.property.name] = node.right
      }

      // On ne wrappe que les assignations top-level (pas dans une fonction).
      const insideFunction = ancestors.some(a =>
        a !== node && (
          a.type === 'FunctionExpression' ||
          a.type === 'ArrowFunctionExpression' ||
          a.type === 'FunctionDeclaration' ||
          a.type === 'MethodDefinition'
        )
      )
      if (insideFunction) return
      // Seule l'assignation SIMPLE `=` est candidate au wrap auto-derived.
      // Les composées (`+=`, `||=`, `-=`)… wrappées produisaient
      // `$.total += { _mjs_c: true, f: … }` → "[object Object]"/NaN silencieux.
      if (node.operator !== '=') return

      // `!node.left.computed` : `$[cle] = …` (accès calculé) n'est PAS
      // une écriture de state var `$.cle` ; sans ce test le RHS était wrappé en
      // auto-derived et le slot recevait l'objet-marqueur au lieu de la valeur.
      if (node.left.type === 'MemberExpression' &&
          !node.left.computed &&
          node.left.object.type === 'Identifier' &&
          node.left.object.name === '$' &&
          node.left.property.type === 'Identifier') {
        const varName = node.left.property.name

        // warn si user déclare `$._mjs_X` (collision avec props internes
        // utilisées par le framework : `_mjs_inline`, `_mjs_binds`,
        // `_mjs_is_router_aware`, etc.). Le mangleCache esbuild mangle tout
        // ce qui matche `/^_mjs_/`, donc le state user `$._mjs_foo` serait
        // manglé avec le risque de collision.
        if (typeof varName === 'string' && varName.startsWith('_mjs_')) {
          const line = typedLine('naming', t('analyzer.prefix-mjs-reserved', { varName, shortName: varName.slice(5) }), diag.lint)
          // eslint-disable-next-line no-console
          if (line !== null) printDiagnostic(line, diag.colorsEnabled ?? false)
        }

        // Snapshot : `=:` côté lexer wrappe le RHS dans `µ.snap(...)`.
        const isSnapshot =
          node.right.type === 'CallExpression' &&
          node.right.callee.type === 'MemberExpression' &&
          node.right.callee.object.type === 'Identifier' &&
          node.right.callee.object.name === 'µ' &&
          node.right.callee.property.type === 'Identifier' &&
          node.right.callee.property.name === 'snap'
        if (isSnapshot) return

        // µderived — le lexer enveloppe le RHS dans µ._mjs_forceDeps(expr, $a, $b, …).
        // Repéré ICI puis EFFACÉ (ms.remove) avant le wrap computed → zéro artefact dans
        // le bundle. `effectiveRight` = l'expr RÉELLE (1er argument) ; le scan de deps
        // juste en dessous continue de parcourir `node.right` EN ENTIER (INCHANGÉ) — ce
        // qui fait que $a/$b (arguments 2+ du marqueur) sont détectés SANS code dédié.
        let effectiveRight = node.right
        const isForceDepsMarker =
          node.right.type === 'CallExpression' &&
          node.right.callee.type === 'MemberExpression' &&
          node.right.callee.object.type === 'Identifier' &&
          node.right.callee.object.name === 'µ' &&
          node.right.callee.property.type === 'Identifier' &&
          node.right.callee.property.name === '_mjs_forceDeps' &&
          node.right.arguments.length >= 1
        if (isForceDepsMarker) {
          effectiveRight = node.right.arguments[0]
          ms.remove(node.right.start, effectiveRight.start)
          ms.remove(effectiveRight.end, node.right.end)
        }

        // Collecte des `$.y` dans le RHS — scanReactiveReads() (réutilisé
        // par detectUnparenthesizedDerivedIf() ci-dessus) ;
        // PARCOURT node.right EN ENTIER, marqueur µ._mjs_forceDeps compris —
        // c'est ce qui fait détecter $a/$b (arguments 2+ du marqueur) SANS
        // code dédié, cf. commentaire isForceDepsMarker plus haut
        const { deps, readsReactiveSource, hasAwait, key, call } = scanReactiveReads(node.right)

        // `$moi = await charger()`, sans aucune variable citée : une valeur qui attend aussi, appelée une fois
        if (deps.size > 0 || readsReactiveSource || hasAwait) {
          if (deps.size > 0) dependencies[varName] = Array.from(deps)
          // `µderived` : les dépendances nommées sont celles que l'affichage suit, accès calculé compris
          if (call) calls.add(varName)
          else if (key && !isForceDepsMarker) all.add(varName)
          const isAlreadyFunction =
            effectiveRight.type === 'FunctionExpression' ||
            effectiveRight.type === 'ArrowFunctionExpression'
          if (!isAlreadyFunction) {
            if (hasAwait) waits.add(varName)
            // un derived dont le RHS contient `await` doit être une flèche
            // ASYNC, sinon `() => (await …)` est une SyntaxError.
            ms.appendLeft(effectiveRight.start, hasAwait ? '{ _mjs_c: true, f: async () => (' : '{ _mjs_c: true, f: () => (')
            const force = isForceDepsMarker && node.right.arguments.length >= 2
            const named = force ? node.right.arguments.slice(1).map((a: any) => a.type === 'MemberExpression' && !a.computed && a.object.type === 'Identifier' && a.object.name === '$' && a.property.type === 'Identifier' ? a.property.name : '') : []
            candidates.push({ name: varName, node: effectiveRight, force, ...(force && !named.includes('') ? { named: named } : {}) })
            closings.push({ name: varName, pos: effectiveRight.end, simple: ') }', marquee: '), _mjs_s: 1 }' })
          }
        }
      }
    },
    // Boucle réactive : un `µeffect` qui LIT et ÉCRIT la même `$var` se
    // re-déclenche lui-même. WARNING compile (jamais erreur : un effet
    // CONVERGENT — `$n = clamp($n, 0, 100)` — est légitime et atteint un point
    // fixe). Le garde-fou runtime (10 000 flushs / 20 passes) reste le filet réel.
    CallExpression(node: any) {
      const callee = node.callee
      // `analyze()` tourne sur scriptJs POST-applyMjsSugarToScript, où
      // `µeffect` est TOUJOURS déjà devenu `µ.effect(...)` (callee MemberExpression).
      // L'ancienne garde `Identifier µeffect/effect` ne matchait donc JAMAIS un
      // composant réel (code mort). On accepte les deux formes.
      const isEffectCall =
        (callee?.type === 'Identifier' && (callee.name === 'µeffect' || callee.name === 'effect')) ||
        (callee?.type === 'MemberExpression' && !callee.computed &&
         callee.object?.type === 'Identifier' && callee.object.name === 'µ' &&
         callee.property?.type === 'Identifier' && callee.property.name === 'effect')
      if (!isEffectCall) return
      const fn = node.arguments && node.arguments[0]
      if (!fn || (fn.type !== 'ArrowFunctionExpression' && fn.type !== 'FunctionExpression')) return
      const reads = new Set<string>()
      const writes = new Set<string>()
      const pureWriteTargets = new Set<any>()   // `$.x` cible d'un `=` PUR : à exclure des lectures (`+=`/`++` lisent, eux)
      walk.simple(fn.body, {
        AssignmentExpression(a: any) {
          const l = a.left
          // `!l.computed` : `$[k] = …` n'écrit pas la state var `$.k`.
          if (l.type === 'MemberExpression' && !l.computed && l.object.type === 'Identifier' && l.object.name === '$' && l.property.type === 'Identifier') {
            writes.add(l.property.name)
            if (a.operator === '=') pureWriteTargets.add(l)
          }
        },
        UpdateExpression(u: any) {
          const arg = u.argument
          if (arg.type === 'MemberExpression' && !arg.computed && arg.object.type === 'Identifier' && arg.object.name === '$' && arg.property.type === 'Identifier') {
            writes.add(arg.property.name)   // `$n++` : l'argument reste compté en lecture (pas exclu)
          }
        },
      })
      walk.simple(fn.body, {
        MemberExpression(m: any) {
          if (pureWriteTargets.has(m)) return
          if (m.object.type === 'Identifier' && m.object.name === '$' && !m.computed && m.property.type === 'Identifier') reads.add(m.property.name)
        },
      })
      // méthodes APPELÉES dans le corps de l'effet (`this.fmt()`/
      // `_mjsThis.fmt()`) : leurs lectures HÉRITÉES comptent aussi pour ce
      // warning (un effet qui écrit `$n` et lit `$n` SEULEMENT via une méthode
      // appelée doit warner pareil) — écritures inchangées, résolution post-walk
      // (cf. pendingEffectWarnings plus haut : la table des méthodes n'est
      // complète qu'une fois le script entier parcouru).
      const calledMethods = new Set<string>()
      walk.simple(fn.body, {
        CallExpression(c: any) {
          const cc = c.callee
          if (cc.type === 'MemberExpression' && !cc.computed &&
              (cc.object.type === 'ThisExpression' || (cc.object.type === 'Identifier' && cc.object.name === '_mjsThis')) &&
              cc.property.type === 'Identifier') {
            calledMethods.add(cc.property.name)
          }
        },
      })
      pendingEffectWarnings.push({ reads, writes, calledMethods })
    },
  })

  // `await` hors d'une valeur dérivée, au premier niveau du script, et valeur qui attend qui se cite : refusés avec la forme juste
  // (await-outside-derived.ts), avant l'avertissement du cycle réactif, qui proposerait `=:` ; `diag.ecrit` : le texte écrit du script, où
  // chaque refus lit sa ligne
  rejectAwaitOutsideDerived(ast, candidates.map((c) => c.node), diag.written)
  rejectSelfCitingWait(dependencies, waits, diag.written)

  // lectures BRUTES de chaque méthode : `$.x` (état), deps store
  // ('$$x'/'$$*', collectStoreMemberDep) et appels vers une AUTRE méthode
  // connue (marqueur '@nom', point-fixé par la classe Analyzer — cf.
  // resolveMethodReadsFixedPoint). `µread $x`/`µwrite $x` compilent en
  // `µ._stateRaw.x`/`µ._mjs_storeRaw.x` : objet 'µ', jamais '$' — invisibles ici
  // PAR CONSTRUCTION (aucun code dédié, opt-out gratuit).
  const methodsRaw: Record<string, string[]> = Object.create(null)  // même remède, cf. dependencies plus haut
  for (const [name, fnNode] of Object.entries(methodNodes)) {
    const mReads = new Set<string>()
    walk.ancestor((fnNode as any).body, {
      MemberExpression(m: any, _s: any, anc: any[]) {
        if (m.object.type === 'Identifier' && m.object.name === '$' && !m.computed) {
          if (m.property.type === 'Identifier') mReads.add(m.property.name)
          return
        }
        collectStoreMemberDep(m, anc, mReads)
      },
      CallExpression(c: any) {
        const cc = c.callee
        if (cc.type === 'MemberExpression' && !cc.computed &&
            (cc.object.type === 'ThisExpression' || (cc.object.type === 'Identifier' && cc.object.name === '_mjsThis')) &&
            cc.property.type === 'Identifier') {
          mReads.add(`@${cc.property.name}`)
        }
      },
    })
    methodsRaw[name] = Array.from(mReads)
  }

  // fonctions du `<script>` (cf. scriptFunctions) : lectures BRUTES de leur corps, et fonctions du script appelées ou passées
  // en valeur par chaque méthode — pour le gabarit seulement (cf. Analyzer.templateReads)
  const script = scriptFunctions(ast)
  let functions: Record<string, string[]> | undefined
  let methodFunctions: Record<string, string[]> | undefined
  if (script.names.size > 0) {
    functions       = Object.create(null)  // même remède, cf. dependencies plus haut
    methodFunctions = Object.create(null)
    for (const [name, fnNode] of Object.entries(script.functions)) functions![name] = bodyReads(fnNode, script.names, true)
    for (const [name, fnNode] of Object.entries(methodNodes)) methodFunctions![name] = bodyReads(fnNode, script.names, false)
  }

  // Warning boucle réactive — émis ICI (après le point-fixe local des méthodes,
  // pas dans le CallExpression handler ci-dessus) : un effet qui APPELLE une
  // méthode lisant la MÊME $var qu'il écrit doit warner aussi.
  if (pendingEffectWarnings.length > 0) {
    const methodsResolved = resolveMethodReadsFixedPoint(methodsRaw, diag)
    for (const { reads, writes, calledMethods } of pendingEffectWarnings) {
      const allReads = new Set(reads)
      for (const m of calledMethods) {
        const sub = methodsResolved[m]
        if (sub) for (const r of sub) allReads.add(r)
      }
      // une variable lue par un dérivé (`$e = $n + 1` lu par `$n = $e`) relance l'effet comme une lecture directe
      const toVisit = [...allReads]
      for (let i = 0; i < toVisit.length; i++) {
        for (const r of dependencies[toVisit[i]] ?? []) { if (!allReads.has(r)) { allReads.add(r); toVisit.push(r) } }
      }
      const looped = Array.from(writes).filter(w => allReads.has(w))
      if (looped.length > 0) {
        const line = typedLine('reactivity', t('analyzer.effect-reads-writes-loop', { list: looped.map(v => '$' + v).join(', ') }), diag.lint)
        // eslint-disable-next-line no-console
        if (line !== null) printDiagnostic(line, diag.colorsEnabled ?? false)
      }
    }
  }

  // lectures connues en sommeil (`KNOWN_READS`, derived-reads.ts) : aucune valeur marquée, aucun receveur enveloppé
  const receivers = new Map<string, Receiver[]>()
  const known = derivedToKnownReads(ast, candidates, dependencies, diag.moduleVars ?? [], diag.externalVars ?? [], receivers)
  // option `derived: "precise"` : les valeurs précises (preciseDerived, derived-classes.ts) portent leurs sources sur l'enveloppe, que le
  // runtime compare ; sans elle, la règle de l'horloge
  const precises = diag.precise === true ? preciseDerived(candidates, diag.externalVars ?? [], doubtfulVariables(ast, diag.raw === true)).sources : null
  for (const f of closings) ms.appendRight(f.pos, precises === null ? (known.has(f.name) ? f.marquee : f.simple) : precises.has(f.name) ? f.marquee.replace('_mjs_s: 1', '_mjs_s: ' + JSON.stringify(precises.get(f.name))) : f.simple)
  // receveur d'une méthode ordinaire, ou itérable d'un parcours (`Symbol.iterator`), d'une valeur connue : vérifié à chaque
  // calcul (`_mjs_rcv`, runtime/mjs_element.ts) — la méthode ou l'itérateur d'un objet de l'utilisateur peut lire l'état par
  // une fermeture, la valeur passe alors à « toute écriture la périme »
  for (const [name, list] of receivers) {
    for (const r of list) {
      ms.appendLeft(r.node.start, '_mjsThis._mjs_rcv(')
      ms.appendRight(r.node.end, `, ${r.method === null ? 'Symbol.iterator' : `'${r.method}'`}, '${name}')`)
    }
  }
  const modifiedCode = ms.toString()

  // µderived hors racine — l'AssignmentExpression handler ci-dessus retourne
  // tôt (`if (insideFunction) return`) pour toute affectation À L'INTÉRIEUR
  // d'une fonction : le marqueur µ._mjs_forceDeps(...) n'y est alors JAMAIS
  // repéré/effacé, et survivrait tel quel dans le bundle final (violation
  // zéro-artefact + ReferenceError runtime, la méthode n'existe pas côté
  // runtime). Filet en dernier ressort : refuse la compilation avec un
  // message explicite plutôt que de laisser passer un crash cryptique.
  // Test sur le code MASQUÉ (chaînes/commentaires neutralisés) : un simple texte
  // mentionnant "_mjs_forceDeps(" dans une chaîne littérale n'est PAS le marqueur — sans ce
  // masquage, il faisait échouer tout le build avec ce même message trompeur.
  if (maskInertSameLength(modifiedCode).includes('_mjs_forceDeps(')) {
    throw new Error(t('analyzer.derived-outside-root'))
  }

  return {
    state: Array.from(stateVariables),
    computed: dependencies,
    methods: methodsRaw,
    ...(script.names.size > 0 ? { scriptNames: script.names, functions: functions, methodFunctions } : {}),
    all: Array.from(all),
    calls: Array.from(calls),
    candidates: candidates,
    modifiedCode,
  }
}

// ============================================================================
// Analyzer class — équivalent de ModularJS::Analyzer (Ruby)
// V2 — bitmask retiré, dispatch direct par varName.
// ============================================================================
export class Analyzer {
  stateVars: string[] = []
  /** Closure transitive des deps des computeds : si `c = a + b` et `a = x + 1`,
   * computedDeps.c = ['x', 'a', 'b']. Construite par resolveDependencyGraph.
   * Object.create(null) — même remède que dependencies (analyze()). */
  computedDeps: Record<string, string[]> = Object.create(null)
  /** Valeurs dérivées qui lisent l'état par une clé calculée (`$[$k]`, cf. AnalyzerOutput.toute) : une expression du
   * gabarit qui en lit une reçoit la dépendance `*` (expandOneDep). Hors de `computedDeps` : les valeurs dérivées du
   * runtime (`_mjs_computedDeps`) et les dépendances des µeffect n'en savent rien */
  computedAll: Set<string> = new Set()
  /** Valeurs dérivées qui appellent une fonction (cf. AnalyzerOutput.appels) : une expression du gabarit qui en lit une
   * ne reçoit jamais `*` (resolveSnippetDeps) */
  computedCall: Set<string> = new Set()
  // valeurs dérivées du script, avec le nœud de leur expression (cf. AnalyzerOutput.candidats)
  derivedCandidates: DerivedCandidate[] = []
  /** Registre de présence des vars (valeur 1 par var). Pas un bitmask, juste
   * un objet permettant aux stores universels de tester `_mjs_var_bits[k] !== undefined`.
   * Pour rétro-compat avec mjs_store.ts et mjs_runes.ts.
   * Object.create(null) — même remède que dependencies (analyze()). */
  varBitsDict: Record<string, number> = Object.create(null)
  allDependencies: string[] = []
  modifiedCode = ''
  /** noms des méthodes du composant (`@x = ->`), pour la garde
   * état/méthode homonymes (transpile(), après auto-déclaration template). */
  methodNames: Set<string> = new Set()
  /** lectures ($x/$$x) de chaque méthode, point-fixées (une méthode qui
   * en appelle une autre hérite de SES lectures) — cf. resolveMethodReadsFixedPoint.
   * Consommé par resolveSnippetDeps (`@nom` dans un snippet de template) et par
   * effect-deps.ts (`@nom` appelée dans un `µeffect`).
   * Object.create(null) — même remède que dependencies (analyze()) : c'est ICI
   * que `this.methodReads['__proto__']` retombait sur Object.prototype (objet TRUTHY, non
   * itérable) → « reads is not iterable » dans resolveSnippetDeps, sans jamais nommer la
   * cause. */
  methodReads: Record<string, string[]> = Object.create(null)
  /** noms du premier niveau du `<script>` qu'une expression du gabarit peut appeler par leur nom : `true` pour une fonction que
   * l'analyse sait lire, `false` sinon (cf. scriptFunctions) ; `null` quand le script n'en déclare aucun */
  scriptNames: Map<string, boolean> | null = null
  /** lectures de chaque méthode ('@nom') et de chaque fonction du `<script>` ('%nom') pour le gabarit, point-fixées ensemble :
   * locale → locale, locale → méthode, méthode → locale (cf. resolveMethodReadsFixedPoint) ; `null` sans nom du script, le
   * gabarit lit alors `methodReads`, que les reffets lisent toujours (effect-deps.ts) */
  private templateReads: Record<string, string[]> | null = null
  /** dépendances BRUTES des snippets qui lisent un nom du `<script>` ('%nom', '!nom') : relues quand le gabarit masque ce nom
   * (getEffectVars) et pour l'avertissement d'un nom que l'analyse ne sait pas lire (unreadableFunctions) */
  private snippetNames: Map<string, string[]> = new Map()

  /** Cache des varNames par snippet — clé du dispatch direct. Pour un snippet
   * donné, on stocke l'UNION des state vars dont il dépend transitivement
   * (closure des computeds inclus). Le runtime n'a plus besoin que de cette liste. */
  private batchVarsCache: Map<string, string[]> = new Map()
  // reçus au constructeur, PAR INSTANCE (jamais un état partagé entre deux compilations
  // concurrentes — une instance par compile, cf. transpiler/index.ts) : coupure/couleur des
  // avertissements `naming`/`reactivity` émis pendant l'analyse.
  private lint?: LintToggles
  private colorsEnabled = false
  // cycles réactifs déjà signalés : un par nom, jamais répété d'une passe de resolveDependencyGraph à l'autre
  private reportedCycles = new Set<string>()
  private externalVars: string[] = []
  private moduleVars: string[] = []
  // le composant écrit l'état sans MJS : aucune valeur précise (cf. RAW_WRITE, derived-classes.ts)
  raw: boolean
  // option `derived: "precise"` : les valeurs que le compilateur prouve précises portent leurs sources (cf. analyze)
  precise: boolean
  // miroirs Set des `includes` chauds (`stateVars`/`externalVars` testés
  // en boucles snippets×deps). Les arrays publics restent la façade ; ces Set
  // sont reconstruits à CHAQUE mutation de stateVars (analyzeAndBuild + autoDeclare).
  private externalVarsSet: Set<string> = new Set()
  private stateVarsSet: Set<string> = new Set()

  // Aucun nom réservé. `store`/`props` l'étaient historiquement mais ne
  // protégeaient AUCUNE structure runtime (jamais de `_state.store`/`_state.props`) :
  // une prop devient un `$NOM` individuel, le store global vit dans `µ.store`/`$$`.
  // Réservation retirée → `$store`/`$props` sont des state vars réactives normales,
  // pour que `$xxx` ait UN seul sens. Point d'extension gardé si un vrai besoin surgit.
  static RESERVED_VARS: string[] = []

  // `$__proto__`/`$constructor`/`$prototype` ne polluent
  // rien (jamais de `_state.__proto__` réel) mais font planter `expandOneDep` EN
  // SILENCE : `computedDeps['__proto__']` résout au PROTOTYPE JS lui-même (objet
  // `{}` ordinaire, pas `Object.create(null)`), `sub` devient non-itérable →
  // `TypeError: sub is not iterable`, sans jamais nommer la cause. Rejetés
  // AVANT l'analyse plutôt que corrigés après coup dans expandOneDep (hors
  // périmètre — generator/, jamais analyzer/).
  static RESERVED_STATE_NAMES: string[] = ['__proto__', 'constructor', 'prototype']

  // `preAst` : l'AST du script déjà analysé par le transpileur (partagé, jamais modifié ici)
  // `moduleVars` : noms du premier niveau du `<script module>` (leurs fonctions ne voient pas l'état de l'instance)
  // `ecrit` : le texte écrit du script, où les refus de la valeur qui attend lisent leur ligne (await-outside-derived.ts)
  constructor(jsScriptCode: string, externalVars: string[] = [], lint?: LintToggles, colorsEnabled = false, preAst?: acorn.Node | null, moduleVars: string[] = [], raw = false, precise = false, written?: WrittenScript) {
    this.externalVars = externalVars
    this.moduleVars = moduleVars
    this.raw = raw
    this.precise = precise
    this.externalVarsSet = new Set(externalVars)
    this.lint = lint
    this.colorsEnabled = colorsEnabled
    this.analyzeAndBuild(jsScriptCode, preAst, written)
  }

  // ------------------------------------------------------------------------
  // Analyse principale + registre de présence des vars
  // ------------------------------------------------------------------------
  private analyzeAndBuild(jsScriptCode: string, preAst?: acorn.Node | null, written?: WrittenScript): void {
    const out = analyze(jsScriptCode, { lint: this.lint, colorsEnabled: this.colorsEnabled, moduleVars: this.moduleVars, externalVars: this.externalVars, raw: this.raw, precise: this.precise, written }, preAst)
    this.modifiedCode = out.modifiedCode

    this.stateVars = out.state.filter(v => !this.externalVarsSet.has(`$${v}`))
    for (const v of this.stateVars) this.assertStateNameAllowed(v)
    this.stateVarsSet = new Set(this.stateVars)

    this.computedDeps = Object.create(null)  // même remède, cf. dependencies (analyze())
    for (const [k, v] of Object.entries(out.computed)) {
      if (this.externalVarsSet.has(`$${k}`)) continue
      this.computedDeps[k] = v.filter(d => !this.externalVarsSet.has(`$${d}`))
    }
    this.computedAll = new Set((out.all ?? []).filter(k => !this.externalVarsSet.has(`$${k}`)))
    this.computedCall = new Set((out.calls ?? []).filter(k => !this.externalVarsSet.has(`$${k}`)))
    this.derivedCandidates = out.candidates ?? []

    // méthodes du composant : filtre externalVars (même partition
    // que computedDeps ci-dessus), PUIS point-fixe (méthode qui en appelle une
    // autre → hérite de SES lectures), cf. resolveMethodReadsFixedPoint.
    const methodsFiltered: Record<string, string[]> = Object.create(null)  // même remède, cf. dependencies (analyze())
    for (const [k, v] of Object.entries(out.methods)) {
      if (this.externalVarsSet.has(`$${k}`)) continue
      methodsFiltered[k] = v.filter(d => !this.externalVarsSet.has(`$${d}`))
    }
    this.methodNames = new Set(Object.keys(methodsFiltered))
    this.methodReads = resolveMethodReadsFixedPoint(methodsFiltered, { lint: this.lint, colorsEnabled: this.colorsEnabled })
    if (out.scriptNames && out.functions) {
      this.scriptNames = out.scriptNames
      const table: Record<string, string[]> = Object.create(null)  // même remède, cf. dependencies (analyze())
      for (const [k, v] of Object.entries(methodsFiltered)) table[`@${k}`] = v.concat(out.methodFunctions?.[k] ?? [])
      for (const [k, v] of Object.entries(out.functions)) table[`%${k}`] = v.filter(d => !this.externalVarsSet.has(`$${d}`))
      this.templateReads = resolveMethodReadsFixedPoint(table, { lint: this.lint, colorsEnabled: this.colorsEnabled }, true)
    }

    this.allDependencies = [...this.stateVars]
    this.resolveDependencyGraph()
    this.buildVarBitsDict()
  }

  // POINT UNIQUE appelé par les DEUX sources de state
  // vars (déclaration explicite ci-dessus, auto-déclaration depuis le template
  // ci-dessous) : rejette `__proto__`/`constructor`/`prototype` AVANT que
  // l'analyse ne s'appuie dessus, message orienté citant le nom. Sans cette
  // garde, `expandOneDep` (generator/, hors périmètre) plante en silence sur
  // `computedDeps['__proto__']` (résout au PROTOTYPE JS, pas une entrée
  // absente) — `TypeError: sub is not iterable`, sans jamais nommer la cause.
  private assertStateNameAllowed(name: string): void {
    if (Analyzer.RESERVED_STATE_NAMES.includes(name)) throw new Error(t('analyzer.name-state-reserved', { name }))
  }

  // ------------------------------------------------------------------------
  // Auto-déclaration des state vars depuis le HTML
  //   - Pattern : `$xxx` non précédé de `\w`/`.`/`$`
  //   - Skip noms réservés et external vars
  //
  // le 1er caractère après
  // `$` était restreint à `[a-zA-Z]` (le RESTE du nom acceptait déjà `_` sans
  // problème) : un `$_privee` (underscore juste après le sigil — convention
  // courante pour signaler un état "privé", comme `_foo` en JS/Python) n'était
  // JAMAIS reconnu par cette regex, donc JAMAIS auto-déclaré depuis le
  // template. **Vérifié empiriquement** : `<p>{$_secret}</p>` SANS déclaration
  // explicite dans `<script>` compilait sans erreur (l'interpolation elle-même
  // fonctionne, `$._secret` est un JS parfaitement valide) mais produisait
  // `_mjs_effectsByVar = {}` — VIDE, la clé `_secret` n'y figurant jamais — donc
  // le texte s'affichait UNE fois au mount puis restait figé À VIE : toute
  // mutation ultérieure de `$_secret` (même via `µ._set` correct) ne trouvait
  // aucun effect associé à invalider. `_` est un premier caractère
  // d'identifiant JS parfaitement valide ; aucune raison de le traiter
  // différemment d'une lettre ici.
  // ------------------------------------------------------------------------
  autoDeclareFromTemplate(htmlRaw: string): void {
    const found = new Set<string>()
    // retire commentaires HTML ET blocs <pre>/<code> AVANT le scan : un
    // `$xxx` mentionné dans `<!-- ... -->` n'est jamais lu par un vrai binding,
    // mais la regex tournait sur le HTML BRUT et l'auto-déclarait quand même
    // (state var fantôme, jamais dans aucun effect). Même chose pour <pre>/<code> — un exemple
    // de documentation qui AFFICHE `$__proto__` en texte (nom réservé, cf. RESERVED_STATE_NAMES
    // juste en dessous) faisait échouer la compilation de la page qui l'explique, alors qu'aucun
    // vrai binding n'existe. Même politique que preprocessHtml (transpiler/index.ts, qui masque
    // ces mêmes zones avant de réécrire les directives) : <pre>/<code> = verbatim, jamais du code.
    // Seul le TEXTE y est verbatim : une interpolation `{…}` dans un <pre>/<code> reste compilée
    // comme partout (le gabarit la rend vivante), ses `$x` sont de vrais liens — gardée, pour que
    // la variable soit déclarée et suivie. Dans l'interpolation, une accolade écrite DANS une chaîne
    // ne compte pas (même règle que maskInterpolations, transpiler/index.ts) ; dans le texte, une
    // apostrophe reste du texte.
    const blank = (s: string): string => {
      let out   = ''
      let depth = 0
      let str   = ''
      for (let i = 0; i < s.length; i++) {
        const c = s[i]
        if (depth === 0) {
          if (c === '{') depth = 1
          out += c === '{' || c === '\n' ? c : ' '
          continue
        }
        if (str) {
          if (c === '\\') { out += c + (s[i + 1] ?? ''); i++; continue }
          if (c === str) str = ''
        }
        else if (c === '"' || c === "'" || c === '`') str = c
        else if (c === '{') depth++
        else if (c === '}') depth--
        out += c
      }
      return out
    }
    // fin de l'expression `{…}` ouverte en `i` (même lecture des chaînes que blank)
    const braceEnd = (s: string, i: number): number => {
      let depth = 0
      let str   = ''
      for (let k = i; k < s.length; k++) {
        const c = s[k]
        if (str) {
          if (c === '\\') k++
          else if (c === str) str = ''
        }
        else if (c === '"' || c === "'" || c === '`') str = c
        else if (c === '{') depth++
        else if (c === '}' && --depth === 0) return k + 1
      }
      return s.length
    }
    // fin de la balise ouverte en `i` : son `>`, hors valeurs entre guillemets et hors `{…}`
    const tagEnd = (s: string, i: number): number => {
      let k = i + 1
      while (k < s.length) {
        const c = s[k]
        if (c === '>') return k + 1
        if (c === '{') { k = braceEnd(s, k); continue }
        if (c === '"' || c === "'") {
          const f = s.indexOf(c, k + 1)
          k = f < 0 ? s.length : f + 1
          continue
        }
        k++
      }
      return s.length
    }
    // le TEXTE est verbatim partout, pas seulement dans <pre>/<code> : seuls les `{…}` et l'intérieur des balises
    // (attributs, sous toutes leurs formes, gardés tels quels) portent du code — un `$constructor` cité dans un <p>
    // faisait échouer la construction, « 5 $US » déclarait un état fantôme `US`
    const blankOutsideTags = (s: string): string => {
      let out  = ''
      let text = 0
      let i    = 0
      while (i < s.length) {
        if (s[i] === '{') { i = braceEnd(s, i); continue }
        if (s[i] === '<' && /[a-zA-Z@\/]/.test(s[i + 1] ?? '')) {
          const end = tagEnd(s, i)
          out += blank(s.slice(text, i)) + s.slice(i, end)
          text = i = end
          continue
        }
        i++
      }
      return out + blank(s.slice(text))
    }
    // `<pre>` puis `<code>`, aux bornes de leurs regex, d'ouverture en ouverture (replaceBlocks) : un `<pre x` sans `>` ou un
    // `<pre>` sans fermante ne fait pas relire la fin du texte depuis chacun
    const withoutPreCode = replaceBlocks(replaceBlocks(htmlRaw, ['pre'], blank), ['code'], blank)
    const withoutComments = blankOutsideTags(maskHtmlComments(withoutPreCode))
    // nom ENTIER, lettres accentuées comprises : `$prénom` déclarait aussi une variable fantôme `pr` (une première
    // lettre accentuée, `$âge`, est refusée à la construction, cf. rejectAccentedState dans sigils.ts)
    const regex = /(?<![\p{L}\p{N}_.$])\$([\p{L}_][\p{L}\p{M}\p{N}_]*)/gu
    let m: RegExpExecArray | null
    while ((m = regex.exec(withoutComments)) !== null) found.add(m[1])

    const newVars: string[] = []
    for (const v of found) {
      if (this.stateVarsSet.has(v)) continue
      if (Analyzer.RESERVED_VARS.includes(v)) continue
      if (this.externalVarsSet.has(`$${v}`)) continue
      this.assertStateNameAllowed(v)
      newVars.push(v)
    }
    if (newVars.length === 0) return

    this.stateVars.push(...newVars)
    this.stateVarsSet = new Set(this.stateVars)
    this.allDependencies.push(...newVars)
    this.buildVarBitsDict()
    this.batchVarsCache.clear()
    this.snippetNames.clear()
  }

  // ------------------------------------------------------------------------
  // batchCalculateVars : analyse les snippets en lot, cache la closure
  // transitive des state vars (= deps d'expression réduites aux state purs
  // via expansion des computeds).
  // ------------------------------------------------------------------------
  batchCalculateVars(snippets: string[]): void {
    const unique = Array.from(new Set(snippets))
    const missing = unique.filter(s => !this.batchVarsCache.has(s))
    for (const snippet of missing) {
      const deps = analyzeSnippet(snippet, true, this.scriptNames)
      this.batchVarsCache.set(snippet, this.resolveSnippetDeps(deps))
      if (this.scriptNames && deps.some((d) => d[0] === '%' || d[0] === '!')) this.snippetNames.set(snippet, deps)
    }
  }

  /** Récupère la closure des state vars d'un snippet (dispatch direct V2).
   * Retourne [] si snippet inconnu ou aucune state var référencée.
   * `masques` : noms que le gabarit met en portée à cet endroit (variable d'un `{for}`, `{const}`, valeur d'une branche) — une
   * fonction du `<script>` du même nom n'est pas celle qu'appelle l'expression, ses lectures ne comptent pas. `withoutFunctions` :
   * aucune fonction du `<script>` n'y compte (une attache, qui agit sans s'afficher, garde son seul passage). */
  getEffectVars(snippetCode: string, masks?: ReadonlySet<string> | null, withoutFunctions = false): string[] {
    // attache : le snippet relu sans les noms du script, ses méthodes résolues par `methodReads` (sans les lectures des fonctions
    // du script qu'elles appellent), comme avant que le gabarit ne suive ces fonctions
    if (withoutFunctions && this.templateReads) return this.resolveSnippetDeps(analyzeSnippet(snippetCode, true), true)
    const rawNames = masks && masks.size > 0 ? this.snippetNames.get(snippetCode) : undefined
    const masked   = (d: string): boolean => (d[0] === '%' || d[0] === '!') && masks!.has(d.slice(1))
    if (rawNames && rawNames.some(masked)) return this.resolveSnippetDeps(rawNames.filter((d) => !masked(d)))
    return this.batchVarsCache.get(snippetCode) ?? []
  }

  /** Noms du premier niveau du `<script>` que l'expression appelle sans que l'analyse sache les lire ('!nom', cf.
   * scriptFunctions), hors des noms que le gabarit masque à cet endroit : l'expression ne suit pas ce qu'ils lisent. */
  unreadableFunctions(snippetCode: string, masks?: ReadonlySet<string> | null, withoutFunctions = false): string[] {
    const rawNames = this.snippetNames.get(snippetCode)
    if (!rawNames || withoutFunctions) return []
    return rawNames.filter((d) => d[0] === '!' && !masks?.has(d.slice(1))).map((d) => d.slice(1))
  }

  /** Étend UNE dep (state/computed/store) dans `out` — factorisé pour être
   * réutilisé aussi bien pour une dep directe que pour chaque lecture héritée
   * d'une méthode appelée (`@nom`, cf. resolveSnippetDeps juste en dessous). */
  private expandOneDep(d: string, out: Set<string>): void {
    // Store universel : `'$$x'`/`'$$*'` vivent dans un namespace SÉPARÉ des
    // state vars locales (jamais dans `stateVarsSet`/`computedDeps`, dont
    // les clés sont toujours nues) — passe-plat inconditionnel, sinon la
    // dep était silencieusement DROPPÉE ici (perdue avant d'atteindre
    // registerEffect → le fragment ne se réabonnait jamais à la clé store).
    if (d.startsWith('$$')) { out.add(d); return }
    // `*` : accès calculé `$[expr]` lu par l'expression (analyzeSnippetOrNull), ou par une valeur dérivée qu'elle lit —
    // celle-ci ou l'une de celles dont elle dépend (`computedDeps` est déjà une fermeture transitive)
    if (d === '*') { out.add(d); return }
    if (this.stateVarsSet.has(d)) out.add(d)
    if (this.computedAll.has(d)) out.add('*')
    const sub = this.computedDeps[d]
    if (sub) {
      out.add(d) // garder le nom du computed lui-même (utile pour _mjs_effectsByVar)
      for (const x of sub) {
        out.add(x)
        if (this.computedAll.has(x)) out.add('*')
      }
    }
  }

  /** Étend une liste de deps brutes (incluant des computeds et des appels de
   * méthode `@nom`) en closure transitive de state vars pures. Conserve les
   * computeds dans la liste pour permettre au store universel de matcher
   * `$$key` aussi — c'est sans effet sur le dispatch puisque _mjs_effectsByVar
   * n'aura d'entrée que pour les vars réellement émises. */
  // `methods` : les méthodes résolues par `methodReads`, sans les lectures des fonctions du script qu'elles appellent (attache)
  private resolveSnippetDeps(deps: string[], methods = false): string[] {
    const out = new Set<string>()
    // `()` : l'expression appelle une fonction (analyzeSnippetOrNull)
    let call = false
    for (const d of deps) {
      if (d === '()') {
        call = true
        continue
      }
      // `@fmt` (méthode appelée dans le snippet, cf. analyzeSnippet) :
      // jamais émise telle quelle (aucune var '@fmt' n'existe au runtime) —
      // étend CHACUNE de ses lectures (déjà point-fixées, cf.
      // resolveMethodReadsFixedPoint) comme une dep normale. Méthode INCONNUE
      // (jamais collectée dans <script>, ex. mixin externe) → ignorée en
      // silence, aucune contribution.
      if (d.startsWith('@')) {
        const reads = this.templateReads && !methods ? this.templateReads[d] : this.methodReads[d.slice(1)]
        if (reads) for (const r of reads) this.expandOneDep(r, out)
        continue
      }
      // `%fmt` : fonction du `<script>` appelée ou passée en valeur — ses lectures, point-fixées avec celles des méthodes, comme
      // `@fmt` ; `!nom` : nom du `<script>` que l'analyse ne sait pas lire, aucune lecture connue — jamais en silence, l'expression
      // est signalée à la construction (generator/state.ts, `generator.script-function-unreadable`), comme une dépendance
      // non analysable : une méthode inconnue, elle, ne contribue rien sans un mot (ci-dessus)
      if (d[0] === '%') {
        const reads = this.templateReads?.[d]
        if (reads) for (const r of reads) this.expandOneDep(r, out)
        continue
      }
      if (d[0] === '!') continue
      this.expandOneDep(d, out)
    }
    // `*` réservé à ce qui ne lit que l'état : une expression qui appelle une fonction, ou qui lit une valeur dérivée qui
    // en appelle une, garde ses dépendances connues — l'appel (une requête) serait refait à chaque écriture
    if (out.has('*') && (call || [...out].some((n) => this.computedCall.has(n)))) out.delete('*')
    return Array.from(out)
  }

  // ------------------------------------------------------------------------
  // l'ancienne API des masques de bits, gardée dans la classe exportée pour le code qui l'appelle encore : il n'y a plus de
  // masque (dispatch direct par variable, cf. en-tête), ces deux méthodes ne calculent rien de plus que leurs remplaçantes
  // ------------------------------------------------------------------------
  /** Ancien nom de `batchCalculateVars()` : analyse les snippets et garde en cache les variables d'état dont chacun dépend,
   * lues ensuite par `getEffectVars()`. Ne rend rien : il n'y a plus de masque à calculer.
   * @deprecated écrivez `batchCalculateVars(snippets)` */
  batchCalculateMasks(snippets: string[]): void {
    this.batchCalculateVars(snippets)
  }

  /** Rend toujours 0, quel que soit le snippet : il n'y a plus de masque de bits. Les variables d'état dont un snippet dépend se
   * lisent par `getEffectVars(snippet)`, après `batchCalculateVars()`.
   * @deprecated écrivez `getEffectVars(snippet)` */
  getMaskFromCache(_snippetCode: string): number {
    return 0
  }

  // ------------------------------------------------------------------------
  // toJsDict : émet un objet `{ "var": 1, ... }` pour `_mjs_var_bits`. Ce n'est
  // plus un bitmask mais un registre de présence — la valeur 1 sert juste
  // à ce que `_mjs_var_bits[k] !== undefined` reste vrai côté stores universels.
  // ------------------------------------------------------------------------
  toJsDict(): string {
    const parts = Object.entries(this.varBitsDict).map(
      ([k, v]) => `"${k}": ${v}`
    )
    return `{ ${parts.join(', ')} }`
  }

  // ------------------------------------------------------------------------
  // Closure transitive : si computed A dépend de B, et B dépend de C, alors
  // A dépend aussi de C. Itération jusqu'à stabilité, max 100 passes.
  // ------------------------------------------------------------------------
  private resolveDependencyGraph(): void {
    let changed = true
    let safety = 0
    while (changed) {
      changed = false
      safety += 1
      if (safety > 100) {
        // coupure de sécurité : sur un graphe pathologique (>100 niveaux
        // de chaînage), la closure transitive reste INCOMPLÈTE → certains effets
        // ne se réabonnent pas. Improbable, mais ne plus le taire.
        const line = typedLine('reactivity', t('analyzer.resolve-dependency-not-convergent'), this.lint)
        // eslint-disable-next-line no-console
        if (line !== null) printDiagnostic(line, this.colorsEnabled)
        break
      }
      for (const [func, deps] of Object.entries(this.computedDeps)) {
        const initialSize = deps.length
        const newDeps = new Set(deps)
        for (const d of deps) {
          const sub = this.computedDeps[d]
          if (sub) for (const x of sub) newDeps.add(x)
        }
        if (newDeps.has(func)) {
          // cycle réactif : signalé une fois par nom (la fermeture refait des passes tant qu'un autre nom grandit)
          if (!this.reportedCycles.has(func)) {
            this.reportedCycles.add(func)
            const line = typedLine('reactivity', t('analyzer.cycle-reactive-detected', { func }), this.lint)
            // eslint-disable-next-line no-console
            if (line !== null) printDiagnostic(line, this.colorsEnabled)
          }
          newDeps.delete(func)
        }
        if (newDeps.size > initialSize) {
          this.computedDeps[func] = Array.from(newDeps)
          changed = true
        }
      }
    }
  }

  // ------------------------------------------------------------------------
  // buildVarBitsDict : V2 — registre de présence (pas un bitmask).
  // Chaque state var et chaque computed reçoit la valeur 1. Sert uniquement
  // au check `_mjs_var_bits[k] !== undefined` côté stores universels.
  // ------------------------------------------------------------------------
  private buildVarBitsDict(): void {
    this.varBitsDict = Object.create(null)  // même remède, cf. dependencies (analyze())
    for (const v of this.stateVars) this.varBitsDict[v] = 1
    for (const c of Object.keys(this.computedDeps)) this.varBitsDict[c] = 1
  }

  /** Stub legacy — V2 n'a plus de mode BigInt. Toujours false. */
  get isBigInt(): boolean {
    return false
  }
}
