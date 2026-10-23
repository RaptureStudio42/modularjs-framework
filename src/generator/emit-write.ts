// emit-write — UNE logique d'écriture réactive pour les deux passes qui réécrivent les écritures :
// transform-reactive.ts (état local `$.x`) et path-tracker.ts (chemins profonds `$.o.k`, magasin `µ.store.x`).
//
// Une écriture devient un appel qui notifie : `µ._set(_mjsThis, 'x', v)`, `µ._mjs_deepSet(_mjsThis, ["o", "k"], v)`,
// `µ._storeSet("x", v)`, `µ._mjs_storeDeepSet("o", ["k"], v)`, `µ._mjs_storeSetOn("t", objet, "k", v)` (élément trouvé
// dans le magasin). La cible ne change que le début de cet appel
// (`WriteTarget.set`) ; la forme (affectation, composée, `++`/`--`, motif) et les règles de POSITION sont
// communes : writeValueUnused (forme directe ou valeur rendue), asiGuard (point-virgule protecteur),
// rhsStart / closeRhs (parenthèses de la valeur), isInlineHandlerReturn.

import type MagicString from 'magic-string'

// début de l'appel qui écrit, valeur exclue (`µ._set(_mjsThis, 'x', `) ; `read` relit la valeur courante (`$.x`,
// `µ.store.x`) ; `returnsValue` : l'appel rend déjà la valeur écrite (`µ._mjs_deepSet`), sa forme directe vaut partout ;
// `bind` : l'objet de la cible (et sa clé), évalués UNE fois, sont les paramètres `params` d'une fonction fléchée
// appelée sur place avec `values` — `set` et `read` les lisent, aucune case partagée (objet du magasin relu par `+=` ou
// `++`, path-tracker.ts) ; `wait` : la valeur de droite attend (`await`), la fonction est `async`, attendue
export interface WriteTarget {
  set: string
  read: string
  returnsValue?: boolean
  bind?: { params: string, values: string, wait?: boolean }
}

// la fonction fléchée d'une cible liée (cf. WriteTarget.bind), à poser autour de l'écriture ; sans liaison, rien. Elle
// commence par `(` : point-virgule protecteur devant (cf. asiGuard)
function bound(t: WriteTarget, ancestors: any[]): { open: string, close: string } {
  if (!t.bind) return { open: '', close: '' }
  const { params, values, wait } = t.bind
  return { open: `${asiGuard(ancestors)}${wait ? '(await (async ' : '('}(${params}) => `, close: `)(${values})${wait ? ')' : ''}` }
}

// les deux signatures d'un gestionnaire en ligne : `(e, el)` pour celui que l'auteur écrit, `(_mjs_e, _mjs_el)` pour celui
// que le compilateur écrit à une liaison (`value=!{$x}`, `@group=!{$g}`…)
const INLINE_HANDLER_PARAMS = [['e', 'el'], ['_mjs_e', '_mjs_el']]

// retour IMPLICITE d'un gestionnaire en ligne — `(e, el) => { … }` ou `(_mjs_e, _mjs_el) => { … }`, élément du tableau des
// gestionnaires (`_mjs_inline`) : sa valeur n'est lue que par le routeur d'événements, qui APPELLE
// une fonction renvoyée (forme référence `@click={save}`, docs/06-evenements.md). Rendre la valeur
// affectée y ferait exécuter sur-le-champ une fonction qu'on voulait seulement ranger
// (`@click={$cb = -> …}`) : ce retour-là garde la forme directe (non consommée), partout ailleurs
// l'affectation vaut exactement ce qu'elle vaut en JavaScript.
// Deux formes du tableau : `this._mjs_inline = [(e, el) => …, …]`, et la compilation par groupes
// (un nom du gabarit recouvre une variable du script) qui range chaque gestionnaire par son rang :
// `this._mjs_inline[3] = (e, el) => …`.
export function isInlineHandlerReturn(ancestors: any[]): boolean {
  if (ancestors[ancestors.length - 2]?.type !== 'ReturnStatement') return false
  for (let i = ancestors.length - 3; i >= 1; i--) {
    const fn = ancestors[i]
    if (fn.type !== 'ArrowFunctionExpression' && fn.type !== 'FunctionExpression' && fn.type !== 'FunctionDeclaration') continue
    const p = fn.params
    return fn.type === 'ArrowFunctionExpression' && isInlineHandlerSlot(ancestors[i - 1], fn) &&
      p.length === 2 && p[0].type === 'Identifier' && p[1].type === 'Identifier' &&
      INLINE_HANDLER_PARAMS.some(([e, el]) => p[0].name === e && p[1].name === el)
  }
  return false
}

function isInlineHandlerSlot(parent: any, fn: any): boolean {
  if (parent?.type === 'ArrayExpression') return true
  if (parent?.type !== 'AssignmentExpression' || parent.right !== fn) return false
  const l = parent.left
  return l.type === 'MemberExpression' && l.computed && l.property.type === 'Literal' &&
    l.object.type === 'MemberExpression' && !l.object.computed && l.object.object.type === 'ThisExpression' &&
    l.object.property.name === '_mjs_inline'
}

// la valeur d'une écriture n'est PAS lue : instruction seule, élément d'une suite dont la valeur
// n'est pas lue (le dernier élément vaut ce que vaut la suite), initialisation ou pas d'un `for`,
// retour d'un gestionnaire en ligne (cf. isInlineHandlerReturn). Là, la forme directe (la plus courte,
// elle commence par `µ`) ; PARTOUT ailleurs, l'écriture vaut la valeur écrite (condition d'un `if`
// ou d'un `while`, déclaration, flèche, tableau, gabarit, argument…). Règle partagée par les deux
// passes d'écriture (path-tracker.ts l'importe).
export function writeValueUnused(ancestors: any[]): boolean {
  for (let i = ancestors.length - 1; i >= 1; i--) {
    const node = ancestors[i]
    const parent = ancestors[i - 1]
    switch (parent.type) {
      case 'ExpressionStatement': return true
      case 'SequenceExpression':
        if (parent.expressions[parent.expressions.length - 1] !== node) return true
        continue
      case 'ForStatement': return parent.init === node || parent.update === node
      case 'ReturnStatement': return isInlineHandlerReturn(ancestors.slice(0, i + 1))
      default: return false
    }
  }
  return false
}

// point-virgule protecteur : une forme réécrite qui commence par `(` et se retrouve en TÊTE d'une
// instruction (`$x++ || f()`) serait lue comme l'appel de la ligne précédente — Civet n'écrit pas de
// point-virgule en fin de ligne. Rend `;` dans ce seul cas (instruction d'une liste : programme, bloc,
// `case`) ; un corps sans accolades (`if (c) …`) n'a pas de ligne précédente à prolonger.
export function asiGuard(ancestors: any[]): string {
  const node = ancestors[ancestors.length - 1]
  for (let i = ancestors.length - 2; i >= 1; i--) {
    const p = ancestors[i]
    if (p.start !== node.start) return ''
    if (p.type === 'ExpressionStatement') {
      const t = ancestors[i - 1].type
      return t === 'Program' || t === 'BlockStatement' || t === 'StaticBlock' || t === 'SwitchCase' ? ';' : ''
    }
  }
  return ''
}

// parenthèses autour de la valeur : acorn borne `node.right` À L'INTÉRIEUR des parenthèses mais les
// compte dans `node.end`. La réécriture va jusqu'à `rhsStart` et `closeRhs` remplace le reste de
// fermantes par la sienne : les parenthèses superflues disparaissent (forme la plus courte, la
// valeur devient un argument). Sauf autour d'une expression à virgule, seule valeur qu'un argument
// découpe : `$x = (noter(), 2)` devenait un appel à deux arguments, la première valeur écrite au
// lieu de la dernière — ses parenthèses restent, ouvrante comprise.
export function rhsStart(js: string, node: any): number {
  if (node.right.type !== 'SequenceExpression') return node.right.start
  const op = js.indexOf(node.operator, node.left.end)
  if (op < 0 || op >= node.right.start) return node.right.start
  let i = op + node.operator.length
  while (i < node.right.start && /\s/.test(js[i])) i++
  return i
}

// `start` : la position rendue par rhsStart — ouvrante gardée, fermantes gardées aussi
export function closeRhs(ms: MagicString, node: any, start: number, closer: string): void {
  if (start === node.right.start && node.right.end < node.end) ms.overwrite(node.right.end, node.end, closer)
  else ms.appendLeft(node.end, closer)
}

// `cible = valeur` / `cible op= valeur` (composée : la valeur devient `read op (valeur)`). Édits de BORDURE
// seulement : la valeur reste en place, les réécritures déjà faites à l'intérieur survivent. Valeur LUE (cf.
// writeValueUnused) : la fermeture rend la valeur écrite, comme en JavaScript ; non lue, la forme directe
export function emitAssign(ms: MagicString, js: string, node: any, ancestors: any[], t: WriteTarget): void {
  const start           = rhsStart(js, node)
  const { open, close } = bound(t, ancestors)
  const head            = t.returnsValue || writeValueUnused(ancestors) ? t.set : `${asiGuard(ancestors)}((_v) => (${t.set}_v), _v))(`
  if (node.operator === '=') {
    ms.overwrite(node.start, start, open + head)
    closeRhs(ms, node, start, ')' + close)
  }
  else {
    ms.overwrite(node.start, start, `${open}${head}${t.read} ${node.operator.slice(0, -1)} (`)
    closeRhs(ms, node, start, '))' + close)
  }
}

// `cible++` / `--cible`. `(+read)` : `++`/`--` convertissent TOUJOURS l'opérande en nombre (sans lui, `"2" + 1`
// concatène). Valeur non lue : forme directe, qui commence par `µ` — les formes fidèles commencent par `(` et Civet
// n'écrit pas de point-virgule : posées après une autre ligne, elles étaient lues comme l'appel de cette ligne.
// Valeur lue : préfixe → la nouvelle valeur (rendue par l'appel s'il la rend, relue sinon), postfixe → l'ancienne,
// convertie (`+_v`), même forme pour toute cible ; une cible liée passe entière dans sa fonction (cf. bound), le
// point-virgule protecteur devant elle
export function emitUpdate(ms: MagicString, node: any, ancestors: any[], t: WriteTarget): void {
  const op              = node.operator === '++' ? '+' : '-'
  const set             = (v: string) => `${t.set}${v} ${op} 1)`
  const { open, close } = bound(t, ancestors)
  const asi             = t.bind ? '' : asiGuard(ancestors)
  let out: string
  if (writeValueUnused(ancestors) || (node.prefix && t.returnsValue)) out = set(`(+${t.read})`)
  else if (node.prefix) out = `${asi}(${set(`(+${t.read})`)}, ${t.read})`
  else out = `${asi}((_v) => (${set('(+_v)')}, +_v))(${t.read})`
  ms.overwrite(node.start, node.end, open + out + close)
}

// motif de déstructuration (`[$a, $b] = [$b, $a]`) : chaque cible devient une variable (`${vars}0`…) écrite
// ensuite par son appel (`sets[i]`), la valeur passe une fois par `valeur`. Édits de BORDURE autour du motif, qui
// reste en place. Valeur non lue : `void` coupe l'ASI (mot-clé, pas une parenthèse) et reste valide comme corps
// d'un `if` sans accolades ; lue : la fonction rend la valeur. Les parenthèses autour du motif sont obligatoires :
// `{a: x} = r` nu en tête d'instruction serait lu comme un BLOC
export function emitPattern(ms: MagicString, js: string, node: any, ancestors: any[], targets: any[], sets: string[], vars: string, valeur: string): void {
  for (let i = 0; i < targets.length; i++) ms.overwrite(targets[i].start, targets[i].end, `${vars}${i}`)
  const unused = writeValueUnused(ancestors)
  const decls  = targets.map((_t: any, i: number) => `${vars}${i}`).join(', ')
  const corps  = sets.map((s, i) => `${s}${vars}${i})`).join('; ')
  const start  = rhsStart(js, node)
  ms.prependLeft(node.start, `${unused ? 'void ' : asiGuard(ancestors)}((${valeur}) => { let ${decls}; (`)
  ms.overwrite(node.left.end, start, ` = ${valeur}); ${corps}${unused ? '' : `; return ${valeur}`} })(`)
  closeRhs(ms, node, start, ')')
}
