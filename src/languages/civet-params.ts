// paramètres que Civet lit autrement, sans erreur : `(t, readonly) -> t` devient l'appel `(t, readonly)(function() { return t })`
// (`readonly` est un mot de TypeScript), `(son, loop) -> son` une boucle sans fin lancée dès que la ligne s'exécute,
// `(fenetre, undefined) -> fenetre` une affectation de `undefined` ; contrôle sur l'arbre du JavaScript produit (acorn),
// jamais sur des lignes de texte : une chaîne, un commentaire, une regex, une clé, une propriété, un champ de classe, un
// attribut du gabarit ou un appel voulu (`(readonly)(1)`) qui portent le même mot ne déclenchent rien

import * as acorn from 'acorn'
import * as walk from 'acorn-walk'
import { TraceMap, originalPositionFor } from '@jridgewell/trace-mapping'
import { t } from '../messages/index.js'

export type ReadKind = 'call' | 'loop' | 'assignment'

export interface MisreadParam {
  name: string
  kind: ReadKind
  line: number | null
  column: number | null
  // indice du nœud fautif dans le JavaScript produit (la ligne d'un gestionnaire du gabarit s'y lit)
  offset: number
}

// erreur de construction qui garde le paramètre trouvé et le JavaScript produit : l'appelant qui connaît la vraie ligne
// du fichier (imports ajoutés devant, gestionnaires du gabarit compilés ensemble) refait le message avec elle
export class ParamReadOtherwiseError extends Error {
  param: MisreadParam
  js: string
  // texte d'une expression du gabarit refusée : le transpileur y cherche sa ligne dans le fichier
  expression?: string
  // `partial` : l'expression vient d'un partiel inclus, dont la ligne n'est pas connue
  constructor(param: MisreadParam, file: string, js: string, line: number | null = param.line, column: number | null = param.column, partial = false) {
    const position = line === null ? file : column === null ? `${file}:${line}` : `${file}:${line}:${column}`
    super(t('languages.civet-param-read-otherwise', { position, name: param.name, kind: param.kind, partial: partial }))
    this.param = param
    this.js    = js
  }
}

// noms valides en JavaScript strict que Civet ne lit pas comme des noms dans une liste de paramètres : le mot de TypeScript
// `readonly` partout, les mots de Civet dans une décomposition (`({unless}) ->`, `({loop}) ->`) ou devant un type
// (`(t, not: number) ->`, `(son, loop: boolean) ->`)
const WORDS = new Set(['readonly', 'loop', 'until', 'unless', 'not', 'is', 'and', 'or'])

// tri rapide du JavaScript produit : sans l'un de ces mots, ni boucle vide, ni affectation de `undefined`, aucun arbre à lire
// (le tri seul ne refuse jamais rien)
const SCREEN = /\b(?:readonly|loop|until|unless|not|is|and|or)\b|while\s*\(\s*true\s*\)\s*;|\bundefined\s*=[^=]/

type Node = any

// boucle produite par le mot `loop` de Civet, `(()=>{const results=[];while(true);;return results})()` : sans fin
function civetLoop(n: Node): boolean {
  if (n.type !== 'CallExpression' || n.arguments.length > 0) return false
  const f = n.callee.type === 'ParenthesizedExpression' ? n.callee.expression : n.callee
  return f.type === 'ArrowFunctionExpression' && f.body.type === 'BlockStatement' && f.body.body.some((s: Node) => s.type === 'WhileStatement' && s.test.type === 'Literal' && s.test.value === true && s.body.type === 'EmptyStatement')
}

// un élément de la liste entre parenthèses lu comme un paramètre (nom, défaut, décomposition, reste, `x?`) : `false` si ce
// n'en est pas un (appel, propriété, opération : l'appel est alors voulu), sinon le nœud du mot lu autrement, ou `null`
function paramWord(n: Node): Node | null | false {
  switch (n.type) {
    case 'Identifier':
      return WORDS.has(n.name) ? n : null
    case 'AssignmentExpression':
      return n.operator === '=' ? paramWord(n.left) : false
    case 'AssignmentPattern':
      return paramWord(n.left)
    case 'SpreadElement':
    case 'RestElement':
      return paramWord(n.argument)
    case 'ParenthesizedExpression': {
      // `(t, readonly?) ->` : Civet en fait la comparaison `(readonly != null)`
      const e = n.expression
      return e.type === 'BinaryExpression' && e.operator === '!=' && e.right.type === 'Literal' && e.right.value === null ? paramWord(e.left) : false
    }
    case 'ArrayExpression':
    case 'ArrayPattern':
      return firstWord(n.elements.filter((e: Node) => e !== null))
    case 'ObjectExpression':
    case 'ObjectPattern': {
      let word: Node | null = null
      for (const p of n.properties) {
        if (p.type !== 'Property') {
          const r = paramWord(p)
          if (r === false) return false
          word ??= r
          continue
        }
        if (p.computed || p.kind !== 'init' || p.method) return false
        const r = paramWord(p.value)
        if (r === false) return false
        // `(t, readonly: boolean) ->` : Civet en fait l'objet `{readonly: boolean}`, le mot devient la clé
        word ??= r ?? (p.key.type === 'Identifier' && WORDS.has(p.key.name) ? p.key : null)
      }
      return word
    }
    case 'CallExpression':
      return civetLoop(n) ? n : false
    default:
      return false
  }
}

// la liste entière : chaque élément doit être un paramètre ; rend le premier mot lu autrement
function firstWord(elements: Node[]): Node | null | false {
  let word: Node | null = null
  for (const e of elements) {
    const r = paramWord(e)
    if (r === false) return false
    word ??= r
  }
  return word
}

// noms liés par un paramètre : nom, défaut, reste, décomposition
function boundNames(p: Node, names: Set<string>): Set<string> {
  if (!p) return names
  if (p.type === 'Identifier') names.add(p.name)
  else if (p.type === 'AssignmentPattern') boundNames(p.left, names)
  else if (p.type === 'RestElement') boundNames(p.argument, names)
  else if (p.type === 'ArrayPattern') for (const e of p.elements) boundNames(e, names)
  else if (p.type === 'ObjectPattern') for (const q of p.properties) boundNames(q.type === 'Property' ? q.value : q.argument, names)
  return names
}

const isFunction = (n: Node): boolean => n?.type === 'FunctionExpression' || n?.type === 'FunctionDeclaration' || n?.type === 'ArrowFunctionExpression'

// premier paramètre lu autrement dans le JavaScript que Civet vient de produire, avec sa position dans la source (carte de
// Civet) ; `carte` n'est lue que si un paramètre est trouvé
export function paramReadOtherwise(js: string, map: () => unknown): MisreadParam | null {
  if (!SCREEN.test(js)) return null
  let found: { node: Node, name: string, kind: ReadKind } | null = null
  try {
    const ast = acorn.parse(js, { ecmaVersion: 'latest', sourceType: 'module', locations: true, preserveParens: true, allowReturnOutsideFunction: true, allowAwaitOutsideFunction: true, allowHashBang: true })
    walk.ancestor(ast, {
      CallExpression(n: Node) {
        if (found || n.arguments.length !== 1) return
        // la lecture fautive de Civet : la liste entre parenthèses appelée avec la fonction qui la suivait (`-> t`), seul
        // argument ; tout autre appel est voulu (`(readonly)(1)`). `function m(t, readonly)` suivi de son corps n'est pas
        // reconnu : Civet en fait `function m() {return (t, readonly)(…) }`, que rien ne sépare d'un appel voulu
        const arg = n.arguments[0]
        if (arg.type !== 'FunctionExpression' && arg.type !== 'ArrowFunctionExpression') return
        // `(loop) -> 1` : la boucle elle-même est appelée
        if (civetLoop(n.callee)) {
          found = { node: n.callee, name: 'loop', kind: 'loop' }
          return
        }
        if (n.callee.type !== 'ParenthesizedExpression') return
        const inside = n.callee.expression
        const word   = firstWord(inside.type === 'SequenceExpression' ? inside.expressions : [inside])
        if (word) found = word.type === 'Identifier' ? { node: word, name: word.name, kind: 'call' } : { node: word, name: 'loop', kind: 'loop' }
      },
      // `(fenetre, undefined) -> fenetre` (de même avec un défaut, un reste, une décomposition) : Civet renomme le paramètre
      // et affecte `undefined` en tête du corps
      AssignmentExpression(n: Node, _walkState: unknown, ancestors: Node[]) {
        if (found || n.operator !== '=' || n.left.type !== 'Identifier' || n.left.name !== 'undefined' || n.right.type !== 'Identifier') return
        const fn = [...ancestors].reverse().find(isFunction)
        if (fn?.params.some((p: Node) => boundNames(p, new Set()).has(n.right.name))) found = { node: n, name: 'undefined', kind: 'assignment' }
      },
    })
  }
  catch {
    // JavaScript qu'acorn ne lit pas (les contrôles du compilateur qui suivent le disent), ou arbre trop profond pour la
    // pile : le contrôle se tait
    return null
  }
  if (!found) return null
  const { node, name, kind } = found as { node: Node, name: string, kind: ReadKind }
  let line: number | null    = null
  let column: number | null  = null
  try {
    const o = sourcePosition(new TraceMap(map() as ConstructorParameters<typeof TraceMap>[0]), node)
    if (o) {
      line   = o.line
      column = o.column + 1
    }
  }
  catch {
    // carte illisible : le message garde le nom, sans la ligne
  }
  return { name, kind, line, column, offset: node.start }
}

// position du nœud dans la source, sinon celle du premier de ses descendants que la carte de Civet situe (la boucle de
// `loop` est un code ajouté par Civet : seuls certains de ses morceaux portent la position du mot)
function sourcePosition(trace: TraceMap, node: Node): { line: number, column: number } | null {
  const candidates: Node[] = []
  walk.full(node, (d: Node) => {
    candidates.push(d)
  })
  candidates.sort((a, b) => a.start - b.start)
  for (const c of candidates) {
    const o = originalPositionFor(trace, { line: c.loc.start.line, column: c.loc.start.column })
    if (o.line !== null) return { line: o.line, column: o.column }
  }
  return null
}
