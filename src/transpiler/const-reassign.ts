// const-reassign — contrôle UNIQUE de la réaffectation d'une constante Civet (`:=` → `const`),
// fait sur le JavaScript DÉJÀ compilé par Civet, par résolution de portée EXACTE (acorn +
// acorn-walk) — commun aux deux chemins de compilation (module .civet autonome du bundler,
// <script> de composant du transpiler).
//
// Remplace/complète deux contrôles ligne à ligne plus anciens (bundler/index.ts
// autoDeclareTopLevelBareAssignments, transpiler/index.ts applyCivetDialectSugar) qui ratent :
// une réaffectation dans un bloc INDENTÉ de la même fonction (accumulateur `for...of`), une
// réaffectation depuis une fonction IMBRIQUÉE sans homonyme local, et `x++`/`--` côté bundler.
// Ceux-ci restent en place pour ce qu'ils couvrent déjà avec un numéro de ligne au moins aussi
// bon (transpiler : ligne de la source Civet réelle, avant compilation) — ce module-ci se
// branche APRÈS eux, sur le JS déjà produit, pour fermer les trous restants.
//
// Sûr par construction vis-à-vis du code GÉNÉRÉ par le framework : appelé juste après la
// compilation Civet, avant toute réécriture propre à ModularJS (variables d'état `$x` → `$.x`
// membre, jamais un identifiant ; symboles µ ; path-tracking ; this-rebinding) — ce module ne
// voit donc jamais de `const` fabriqué par le framework lui-même, seulement la traduction directe
// du `:=`/`.=` de l'auteur.

import * as acorn from 'acorn'
import * as walk from 'acorn-walk'

export interface ConstReassignment {
  name: string
  line: number // 1-based, dans le texte JS analysé (celui passé à findConstReassignment)
  /** la liaison réaffectée est une copie qu'un gestionnaire recrée depuis le gabarit (variable ou
   *  index de `{for}`, `{const}`, valeur `{success}`/`{error}`) : l'écriture serait perdue */
  gabarit?: boolean
}

// ce que l'analyse a produit quand le texte ne s'analyse PAS — pour l'appelant qui garde une
// ÉMISSION : « rien vu » (aucune violation) et « rien pu voir » ne se confondent pas.
export interface ErreurAnalyse {
  message: string
  ligne: number   // 1-based, dans le texte analysé (0 quand acorn n'a pas donné de position)
  extrait: string // la ligne fautive, rognée
}

// une portée : liaisons visibles à CE niveau (nom → constante ? — `'gabarit'` pour la copie qu'un
// gestionnaire recrée depuis le gabarit, cf. estInitSquelette), portée mère (chaîne de résolution)
// et portée-cible du hissage `var` (la fonction/racine englobante — jamais un bloc).
type Liaison = boolean | 'gabarit'

interface Scope {
  parent: Scope | null
  names: Map<string, Liaison>
  varTarget: Scope
}

// noms que le gabarit met en portée des gestionnaires analysés (cf. analyserConstReassign) — posé
// le temps d'une analyse, synchrone
let localesGabarit: ReadonlySet<string> = new Set()

// valeur du squelette qui recrée un nom du gabarit en tête d'un gestionnaire (generator/attributes,
// squelettePortee) : `__arr_N[…]` (variable de boucle), `__idx_N` (index), `__cst_N` (`{const}`),
// `__aw_N` (valeur `{await}`). Une liaison ainsi posée n'est qu'une copie : toute AUTRE écriture
// serait perdue ; ces affectations-là, elles, sont le squelette même.
function estInitSquelette(node: any): boolean {
  if (!node) return false
  if (node.type === 'Identifier') return /^__(idx|cst|aw)_\d+$/.test(node.name)
  return node.type === 'MemberExpression' && node.object.type === 'Identifier' && /^__arr_\d+$/.test(node.object.name)
}

function newFunctionScope(parent: Scope | null): Scope {
  const scope: Scope = { parent, names: new Map(), varTarget: null as unknown as Scope }
  scope.varTarget = scope
  return scope
}

function newBlockScope(parent: Scope): Scope {
  return { parent, names: new Map(), varTarget: parent.varTarget }
}

function declare(scope: Scope, name: string, liaison: Liaison): void {
  scope.names.set(name, liaison)
}

// résout `name` dans la chaîne de portées, de la plus interne à la racine — rend `true` si LIÉ et
// CONSTANT, `'gabarit'` si c'est une copie recréée depuis le gabarit ; un nom inconnu (global,
// importé, prédéclaré ailleurs) n'est jamais signalé.
function resolveBinding(scope: Scope, name: string): Liaison {
  for (let s: Scope | null = scope; s; s = s.parent) {
    const c = s.names.get(name)
    if (c !== undefined) return c
  }
  return false
}

// signal de sortie anticipée du walker — jamais levé hors de findConstReassignment, jamais
// exposé : la PREMIÈRE violation rencontrée pendant la descente (ordre source, cf. plus bas).
class FoundViolation {
  constructor(public name: string, public line: number, public gabarit: boolean) {}
}

// extrait les identifiants LIÉS d'un motif de déclaration/destructuration (id d'un
// VariableDeclarator, paramètre de fonction, param de catch) — une MemberExpression n'apparaît
// jamais ici (grammaire : une cible de propriété n'est jamais une liaison).
function collectPatternNames(pattern: any, out: string[]): void {
  if (!pattern) return
  switch (pattern.type) {
    case 'Identifier':
      out.push(pattern.name)
      break
    case 'AssignmentPattern':
      collectPatternNames(pattern.left, out)
      break
    case 'RestElement':
      collectPatternNames(pattern.argument, out)
      break
    case 'ArrayPattern':
      for (const el of pattern.elements) if (el) collectPatternNames(el, out)
      break
    case 'ObjectPattern':
      for (const prop of pattern.properties) {
        if (prop.type === 'RestElement') collectPatternNames(prop.argument, out)
        else collectPatternNames(prop.value, out)
      }
      break
  }
}

// même chose, mais pour une cible d'AFFECTATION (`=` sur un motif) — garde le NŒUD (pour sa
// ligne) plutôt que le seul nom. Une MemberExpression rencontrée dans le motif (`{a: obj.x} =
// f()`) est une cible de PROPRIÉTÉ : jamais une liaison, jamais poussée.
function extractAssignmentTargets(pattern: any, out: any[]): void {
  if (!pattern) return
  switch (pattern.type) {
    case 'Identifier':
      out.push(pattern)
      break
    case 'AssignmentPattern':
      extractAssignmentTargets(pattern.left, out)
      break
    case 'RestElement':
      extractAssignmentTargets(pattern.argument, out)
      break
    case 'ArrayPattern':
      for (const el of pattern.elements) if (el) extractAssignmentTargets(el, out)
      break
    case 'ObjectPattern':
      for (const prop of pattern.properties) {
        if (prop.type === 'RestElement') extractAssignmentTargets(prop.argument, out)
        else extractAssignmentTargets(prop.value, out)
      }
      break
  }
}

function checkTarget(node: any, scope: Scope, line: number): void {
  if (node.type !== 'Identifier') return
  const liaison = resolveBinding(scope, node.name)
  if (liaison) throw new FoundViolation(node.name, line, liaison === 'gabarit')
}

// walk restreint qui NE DESCEND JAMAIS dans une fonction imbriquée — sert au hissage `var`
// (function-scoped, traverse tous les blocs/boucles/if/switch/try/catch de la fonction courante,
// jamais son corps ne contient de STATEMENT niché dans une expression sauf via une fonction,
// justement exclue). `function`/`class` ne sont PAS hissées ici (mode strict : block-scoped,
// captées par collectDirectDeclarations sur leur bloc direct).
const STOP_AT_FUNCTION = {
  FunctionDeclaration() {},
  FunctionExpression() {},
  ArrowFunctionExpression() {},
  // un bloc statique de classe a sa propre portée de `var` : ses `var` ne remontent jamais plus haut
  StaticBlock() {},
}

function collectHoistedVars(body: any, into: Scope): void {
  walk.recursive(body, null, {
    VariableDeclaration(node: any) {
      if (node.kind !== 'var') return
      for (const d of node.declarations) {
        const names: string[] = []
        collectPatternNames(d.id, names)
        for (const n of names) declare(into, n, false)
      }
    },
    ...STOP_AT_FUNCTION,
  })
}

// déclarations DIRECTES (non imbriquées) d'une liste d'instructions — `let`/`const`/`class`
// (scopées à CE bloc précis) et `function` (idem, en mode strict — jamais hissée plus haut). Un
// `var` direct est ignoré ici : déjà couvert par collectHoistedVars, à la portée FONCTION.
function collectDirectDeclarations(statements: any[], into: Scope): void {
  for (const stmt of statements) {
    if (stmt.type === 'VariableDeclaration' && stmt.kind !== 'var') {
      const isConst = stmt.kind === 'const'
      for (const d of stmt.declarations) {
        // copie d'un nom du gabarit posée par le squelette d'un gestionnaire (cf. estInitSquelette)
        if (d.id.type === 'Identifier' && localesGabarit.has(d.id.name) && estInitSquelette(d.init)) {
          declare(into, d.id.name, 'gabarit')
          continue
        }
        const names: string[] = []
        collectPatternNames(d.id, names)
        for (const n of names) declare(into, n, isConst)
      }
    }
    else if (stmt.type === 'FunctionDeclaration' && stmt.id) {
      declare(into, stmt.id.name, false)
    }
    else if (stmt.type === 'ClassDeclaration' && stmt.id) {
      declare(into, stmt.id.name, false) // liaison type `let` : une classe reste réaffectable
    }
  }
}

function handleForInOf(node: any, st: any, c: any): void {
  let scope = st.scope
  const left = node.left
  if (left.type === 'VariableDeclaration') {
    if (left.kind !== 'var') {
      scope = newBlockScope(st.scope)
      for (const d of left.declarations) {
        const names: string[] = []
        collectPatternNames(d.id, names)
        for (const n of names) declare(scope, n, left.kind === 'const')
      }
    }
    c(left, { scope })
  }
  else {
    // `for (x of …)` SANS déclaration : `left` est directement une cible d'affectation,
    // réaffectée à CHAQUE tour — vérifiée comme n'importe quelle cible, à la ligne du `for`.
    const targets: any[] = []
    extractAssignmentTargets(left, targets)
    for (const t of targets) checkTarget(t, st.scope, node.loc.start.line)
    c(left, { scope: st.scope }, 'Pattern')
  }
  // le membre de droite (itérable) s'évalue dans la portée ENGLOBANTE, avant toute liaison de la
  // variable de boucle.
  c(node.right, { scope: st.scope }, 'Expression')
  c(node.body, { scope }, 'Statement')
}

const VISITORS = {
  Program(node: any, st: any, c: any) {
    const scope = newFunctionScope(st.scope)
    collectHoistedVars({ type: 'BlockStatement', body: node.body }, scope)
    collectDirectDeclarations(node.body, scope)
    for (const stmt of node.body) c(stmt, { scope }, 'Statement')
  },

  // FunctionDeclaration/FunctionExpression/ArrowFunctionExpression dispatchent TOUTES ici (cf.
  // acorn-walk base.FunctionDeclaration = c(node, st, 'Function'), idem pour les 2 autres).
  Function(node: any, st: any, c: any) {
    const scope = newFunctionScope(st.scope)
    // nom d'une FunctionExpression NOMMÉE : visible seulement DANS son propre corps (auto-référence).
    if (node.type === 'FunctionExpression' && node.id) declare(scope, node.id.name, false)
    for (const p of node.params) {
      const names: string[] = []
      collectPatternNames(p, names)
      for (const n of names) declare(scope, n, false)
    }
    // `arguments` implicite (pas les fléchées, qui n'en ont pas de propre) — pour la complétude
    // du modèle de portée (résolution EXACTE) plutôt que pour un scénario atteignable : lier
    // `arguments` par `const`/`let`, ou le réaffecter, est de toute façon un SyntaxError JS en
    // mode strict (le code analysé ici l'est toujours), donc jamais rencontré en pratique.
    if (node.type !== 'ArrowFunctionExpression') declare(scope, 'arguments', false)
    // motifs de paramètres (valeurs par défaut) AVANT le corps — ordre source.
    for (const p of node.params) c(p, { scope }, 'Pattern')
    if (node.body.type === 'BlockStatement') {
      collectHoistedVars(node.body, scope)
      collectDirectDeclarations(node.body.body, scope)
      for (const stmt of node.body.body) c(stmt, { scope }, 'Statement')
    }
    else {
      c(node.body, { scope }, 'Expression')
    }
  },

  // invoqué pour tout bloc qui N'EST PAS le corps direct d'une fonction (celui-ci est traité dans
  // `Function` ci-dessus, qui ne redélègue jamais son propre `node.body` par `c(...)`) : corps de
  // if/for/while, bloc nu, bloc try/finally, corps d'un catch.
  BlockStatement(node: any, st: any, c: any) {
    const scope = newBlockScope(st.scope)
    collectDirectDeclarations(node.body, scope)
    for (const stmt of node.body) c(stmt, { scope }, 'Statement')
  },

  // corps statique de classe (`static { … }`) : acorn-walk le parcourt par défaut comme un
  // Program/BlockStatement, donc SANS portée propre — un `let x` homonyme y était lu comme une
  // réaffectation de la constante du dehors (faux positif). Portée de FONCTION : le bloc statique
  // porte ses propres `var` (Node exécute `const x = 1; class C { static { var x = 2; x = 3 } }`
  // sans erreur), qui masquent la constante du dehors et ne remontent jamais au-delà.
  StaticBlock(node: any, st: any, c: any) {
    const scope = newFunctionScope(st.scope)
    collectHoistedVars({ type: 'BlockStatement', body: node.body }, scope)
    collectDirectDeclarations(node.body, scope)
    for (const stmt of node.body) c(stmt, { scope }, 'Statement')
  },

  ForStatement(node: any, st: any, c: any) {
    let scope = st.scope
    if (node.init && node.init.type === 'VariableDeclaration' && node.init.kind !== 'var') {
      scope = newBlockScope(st.scope)
      for (const d of node.init.declarations) {
        const names: string[] = []
        collectPatternNames(d.id, names)
        for (const n of names) declare(scope, n, node.init.kind === 'const')
      }
    }
    if (node.init) c(node.init, { scope }, node.init.type === 'VariableDeclaration' ? undefined : 'Expression')
    if (node.test) c(node.test, { scope }, 'Expression')
    if (node.update) c(node.update, { scope }, 'Expression')
    c(node.body, { scope }, 'Statement')
  },

  ForInStatement: handleForInOf,
  ForOfStatement: handleForInOf,

  CatchClause(node: any, st: any, c: any) {
    const scope = newBlockScope(st.scope)
    if (node.param) {
      const names: string[] = []
      collectPatternNames(node.param, names)
      for (const n of names) declare(scope, n, false)
      c(node.param, { scope }, 'Pattern')
    }
    c(node.body, { scope }, 'Statement') // BlockStatement → encore une portée imbriquée (normal, cf. `catch(e){let e=1}`)
  },

  // TOUS les `case` d'un `switch` partagent UNE SEULE portée lexicale (particularité JS) — jamais
  // une par `case`.
  SwitchStatement(node: any, st: any, c: any) {
    const scope = newBlockScope(st.scope)
    const allConsequents = node.cases.flatMap((cs: any) => cs.consequent)
    collectDirectDeclarations(allConsequents, scope)
    c(node.discriminant, { scope: st.scope }, 'Expression')
    for (const cs of node.cases) {
      if (cs.test) c(cs.test, { scope: st.scope }, 'Expression')
      for (const stmt of cs.consequent) c(stmt, { scope }, 'Statement')
    }
  },

  AssignmentExpression(node: any, st: any, c: any) {
    const scope = st.scope
    const line  = node.loc.start.line
    // le squelette lui-même (`index = __idx_1` d'une boucle imbriquée au même nom d'index) : permis
    if (node.operator === '=' && estInitSquelette(node.right)) {
      c(node.left, { scope }, 'Pattern')
      c(node.right, { scope }, 'Expression')
      return
    }
    if (node.operator === '=') {
      const targets: any[] = []
      extractAssignmentTargets(node.left, targets)
      for (const t of targets) checkTarget(t, scope, line)
    }
    else {
      // composée (`+=`, `||=`, `??=`, `**=`…) : la grammaire n'admet ici qu'un Identifier ou une
      // MemberExpression, jamais un motif de déstructuration.
      if (node.left.type === 'Identifier') checkTarget(node.left, scope, line)
    }
    c(node.left, { scope }, 'Pattern')
    c(node.right, { scope }, 'Expression')
  },

  UpdateExpression(node: any, st: any, c: any) {
    if (node.argument.type === 'Identifier') checkTarget(node.argument, st.scope, node.loc.start.line)
    c(node.argument, { scope: st.scope }, 'Expression')
  },
}

// la ligne fautive d'un texte qui ne s'analyse pas, telle qu'acorn la situe (`loc.line` est
// 1-based, comme le reste du fichier) ; `ligne: 0` quand il n'a pas pu la donner.
function decrireErreurAnalyse(js: string, err: any): ErreurAnalyse {
  const ligne = typeof err?.loc?.line === 'number' ? err.loc.line : 0
  const brute = ligne > 0 ? (js.split('\n')[ligne - 1] ?? '') : ''
  return { message: String(err?.message ?? err), ligne, extrait: brute.trim().slice(0, 160) }
}

// analyse le JS produit par Civet et rend la PREMIÈRE affectation à une liaison `const` (ordre
// source : la descente est en profondeur d'abord, donc dans l'ordre naturel du texte) — `null` si
// aucune. `analysable: false` dit que le texte n'a PAS pu être analysé : le contrôle n'a alors
// rien pu voir, ce qu'un appelant qui garde une compilation ne doit jamais confondre avec « rien
// à signaler » (un JavaScript invalide peut sortir d'une compilation par ailleurs acceptée).
// Analyse TOUJOURS (aucun raccourci qui sauterait le parse) : c'est ce qui rend `analysable`
// digne de foi ; le raccourci de perf vit dans findConstReassignment ci-dessous, pour les textes
// entiers où « aucune constante en jeu » se lit dans le texte.
// `constantesExternes` : constantes d'un bloc ENGLOBANT compilé à part (le `<script module>` d'un
// composant, vu par son `<script>`) — portée mère de la racine, masquée comme toute autre par une
// déclaration locale homonyme.
// `locauxDuGabarit` : noms que le gabarit met en portée des gestionnaires analysés — leur copie
// posée par le squelette (cf. estInitSquelette) est traitée comme une constante : la réaffecter
// ailleurs n'écrirait qu'une copie locale, perdue (violation `gabarit: true`).
export function analyserConstReassign(js: string, constantesExternes: Iterable<string> = [], locauxDuGabarit: Iterable<string> = []): { violation: ConstReassignment | null; analysable: boolean; erreur?: ErreurAnalyse } {
  const externes = [...constantesExternes]
  if (!js) return { violation: null, analysable: true }
  let ast: acorn.Node
  try {
    ast = acorn.parse(js, { ecmaVersion: 'latest', sourceType: 'module', locations: true })
  }
  catch (e: any) {
    return { violation: null, analysable: false, erreur: decrireErreurAnalyse(js, e) }
  }
  let englobante: Scope | null = null
  if (externes.length > 0) {
    englobante = newFunctionScope(null)
    for (const n of externes) declare(englobante, n, true)
  }
  localesGabarit = new Set(locauxDuGabarit)
  try {
    walk.recursive(ast, { scope: englobante }, VISITORS)
  }
  catch (e) {
    if (e instanceof FoundViolation) return { violation: { name: e.name, line: e.line, ...(e.gabarit ? { gabarit: true } : {}) }, analysable: true }
    throw e
  }
  finally {
    localesGabarit = new Set()
  }
  return { violation: null, analysable: true }
}

// même analyse, réduite à la violation — pour les appelants qui ne distinguent pas l'échec
// d'analyse d'une absence de violation (le texte vient d'être compilé, donc validé ailleurs).
export function findConstReassignment(js: string, constantesExternes: Iterable<string> = []): ConstReassignment | null {
  const externes = [...constantesExternes]
  // raccourci de PERF, propre à ces appelants-là (textes entiers : bundle, module compilé) —
  // aucun `const` dans le texte ni autour, donc aucune constante à réaffecter, inutile de parser
  // (cf. le même garde-fou dans generator/transform-reactive.ts et effect-deps.ts).
  if (!js) return null
  if (externes.length === 0 && !js.includes('const')) return null
  return analyserConstReassign(js, externes).violation
}
