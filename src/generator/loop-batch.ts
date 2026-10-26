// loop-batch — rendus d'une boucle regroupés. Une boucle du code d'un composant qui écrit l'état (`$x`, `$o.a.b`, `$$x`,
// une méthode qui modifie une liste) ne redessine qu'à sa sortie : la passe l'enveloppe,
//   µ._mjs_lq++;try{<boucle>}finally{--µ._mjs_lq||µ._mjs_lqF()}
// Tant que `µ._mjs_lq` compte une boucle en cours, le rendu d'un composant touché attend dans une file au lieu de se
// jouer à chaque écriture (`_mjs_invalidate`, runtime/mjs_element.ts) ; la sortie de la boucle la plus extérieure joue la
// file (`µ._mjs_lqF`, runtime/mjs_init.ts), une passe par composant, avant l'instruction qui suit. Le `finally` couvre
// l'exception, `return`, `break` et `continue`.
//
// Enveloppée : la boucle la plus extérieure de sa fonction qui contient une écriture de l'état — un des appels que les
// passes d'écriture ont posés (transform-reactive.ts, path-tracker.ts), dans la boucle ou dans une fonction écrite dans la
// boucle (`for … then l.forEach((x) -> $n += x)`, et la forme fléchée d'une écriture dont la valeur est lue) — ou une
// écriture qu'elles laissent passer par l'enveloppe réactive, qui prévient elle aussi : affectation composée d'un chemin
// (`$o.a.b += 1`, `$l[k].n += 1`), clé faite d'une expression, `++`, `delete`, méthode qui modifie (`$l[k].tags.push(x)`),
// sur l'état (`$.…`) comme sur le magasin (`µ.store.…`). Son
// étiquette (`externe: for …`) entre avec elle, sinon un `continue externe` ne trouverait plus sa boucle.
// Pas enveloppée : une boucle sans écriture (elle ne paie rien) et une boucle qui attend — `await` ou `yield` de sa propre
// fonction, `for await` : pendant l'attente, le reste de la page écrirait sans redessiner. Ses boucles intérieures sans
// attente le sont, elles. Les rappels d'un `.forEach` / `.map` écrit hors de toute boucle ne sont pas regroupés.
// Passe posée APRÈS les quatre passes de réécriture (transpiler/index.ts) : elle lit leurs appels, n'en change aucun.

import type * as acorn from 'acorn'
import MagicString from 'magic-string'
import { parseModule } from './ast-helpers.js'
import { passResult, type PassResult } from './pass-map.js'

// les appels qui écrivent l'état, tels que les passes d'écriture les posent (`µ._set(_mjsThis, 'x', v)`…)
const WRITES = new Set([
  '_set', '_mjs_deepSet', '_mjs_deepCall', '_mjs_deepDelete',
  '_storeSet', '_mjs_storeDelete', '_mjs_storeDeepSet', '_mjs_storeDeepCall', '_mjs_storeDeepDelete',
  '_mjs_storeSetOn', '_mjs_storeCallOn', '_mjs_storeDeleteOn',
])
const LOOP_HINT  = /\b(?:for|while|do)\b/
// pré-filtre du texte (l'arbre tranche) : une boucle, et un appel du runtime, un chemin de l'état ou du magasin
const hinted     = (js: string): boolean => LOOP_HINT.test(js) && (js.includes('µ._') || js.includes('$.') || js.includes('$[') || js.includes('µ.store'))
// méthodes qui modifient une liste, une `Map` ou un `Set`
const MUTATORS   = new Set(['push', 'pop', 'shift', 'unshift', 'splice', 'sort', 'reverse', 'fill', 'copyWithin', 'set', 'add', 'delete', 'clear'])
const LOOPS      = new Set(['ForStatement', 'ForInStatement', 'ForOfStatement', 'WhileStatement', 'DoWhileStatement'])
const FUNCTIONS  = new Set(['FunctionDeclaration', 'FunctionExpression', 'ArrowFunctionExpression'])
// une instruction posée dans une liste d'instructions s'enveloppe sans accolades ; ailleurs (`if (c) for …`) il en faut
const LISTS      = new Set(['Program', 'BlockStatement', 'StaticBlock', 'SwitchCase'])
const OPEN       = 'µ._mjs_lq++;try{'
const CLOSE      = '}finally{--µ._mjs_lq||µ._mjs_lqF()}'

type Info = { writes: boolean, waits: boolean }

// un chemin de l'état (`$.a.b`) ou du magasin (`µ.store.a.b`)
const onState = (n: any): boolean => {
  if (n?.type !== 'MemberExpression') return false
  let o = n
  while (o.object.type === 'MemberExpression') o = o.object
  const r = o.object
  return r.type === 'Identifier' && (r.name === '$' || (r.name === 'µ' && !o.computed && o.property.name === 'store'))
}

const isWrite = (n: any): boolean => {
  switch (n.type) {
    case 'CallExpression': {
      const c = n.callee
      if (c?.type !== 'MemberExpression' || c.computed || c.property.type !== 'Identifier') return false
      if (c.object.type === 'Identifier' && c.object.name === 'µ') return WRITES.has(c.property.name)
      return MUTATORS.has(c.property.name) && onState(c.object)
    }
    case 'AssignmentExpression': return onState(n.left)
    case 'UpdateExpression': return onState(n.argument)
    case 'UnaryExpression': return n.operator === 'delete' && onState(n.argument)
    default: return false
  }
}

const children = (n: any): any[] => {
  const out: any[] = []
  for (const k in n) {
    if (k === 'type' || k === 'start' || k === 'end' || k === 'loc' || k === 'range') continue
    const v = n[k]
    if (Array.isArray(v)) { for (const x of v) if (x && typeof x.type === 'string') out.push(x) }
    else if (v && typeof v.type === 'string') out.push(v)
  }
  return out
}

export function batchLoopWrites(js: string): string {
  return batchLoopWritesMapped(js).code
}

export function batchLoopWritesMapped(js: string): PassResult {
  if (!js || !hinted(js)) return { code: js }
  let ast: acorn.Node
  try {
    ast = parseModule(js)
  }
  catch {
    return { code: js }
  }

  // 1. de bas en haut : chaque boucle sait si elle écrit l'état et si elle attend (son `await` / `yield`, pas celui
  //    d'une fonction écrite dedans)
  const infos = new Map<any, Info>()
  const scan = (n: any): Info => {
    let writes = isWrite(n)
    let waits  = n.type === 'AwaitExpression' || n.type === 'YieldExpression' || (n.type === 'ForOfStatement' && n.await === true)
    for (const c of children(n)) {
      const i = scan(c)
      writes ||= i.writes
      if (!FUNCTIONS.has(c.type)) waits ||= i.waits
    }
    const info = { writes, waits }
    if (LOOPS.has(n.type)) infos.set(n, info)
    return info
  }
  scan(ast)

  // 2. de haut en bas : la plus extérieure de sa fonction qui écrit sans attendre est enveloppée, ses boucles intérieures
  //    de la même fonction non ; une fonction écrite dedans repart à zéro
  const ms = new MagicString(js)
  let changed = false
  const wrap = (stmt: any, parent: any) => {
    // l'ouverture tient au premier caractère de la boucle, la fermeture au dernier : deux boucles collées
    // (`for(;;)a();for(;;)b()`) gardent l'ordre fermeture de la première, ouverture de la seconde
    const braces = !LISTS.has(parent.type)
    ms.prependRight(stmt.start, (braces ? '{' : '') + OPEN)
    ms.appendLeft(stmt.end, CLOSE + (braces ? '}' : ''))
    changed = true
  }
  const visit = (n: any, parent: any, inside: boolean) => {
    if (FUNCTIONS.has(n.type)) inside = false
    else if (!inside && (LOOPS.has(n.type) || n.type === 'LabeledStatement')) {
      let loop = n
      while (loop.type === 'LabeledStatement') loop = loop.body
      const info = infos.get(loop)
      if (info && info.writes && !info.waits) {
        wrap(n, parent)
        inside = true
      }
    }
    for (const c of children(n)) visit(c, n, inside)
  }
  visit(ast, null, false)
  return passResult(ms, js, changed, 'loop-batch')
}
