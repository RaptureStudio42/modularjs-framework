// transpiler/load-sites — le repère de chaque appel du magasin chargé écrit dans le script : un `µ.load(…)` du code compilé (la rune
// `µload(…)`) reçoit en dernier argument le repère de son occurrence dans le fichier, `'<empreinte du module>.<rang>'`. Une dérivée garde
// une poignée par appel écrit (runtime/mjs_load.ts, µ.load) : un autre appel (l'autre branche d'un ternaire, la suite d'un `or`) montre le
// magasin de sa propre adresse, jamais la donnée d'un autre ; seul l'appel écrit directement dans l'expression de la dérivée, hors de toute
// fonction et de toute boucle (la frappe d'une recherche), garde sa donnée pendant que son adresse change ; la fonction que le
// compilateur écrit pour un `switch`, un `try` ou un `do` dans l'expression, appelée aussitôt, ne compte pas. Fait ailleurs — dans une
// fonction (une aide, une flèche, un gestionnaire, une fonction de rang) ou dans une boucle —, le repère commence par `*` : l'appel ne garde
// jamais la donnée d'une adresse d'avant, même fait une seule fois. Un `µ` échappé (`\u00B5.load(`, écrit à la main ou par un outil)
// se lit comme `µ`. Un appel sans repère (code que ce compilateur ne voit pas,
// `µ.load(...args)`, plus de deux arguments) garde son rang dans le calcul, sans donnée d'avant non plus. Les
// appels du gabarit (ses liaisons, la passe de ses blocs) ne se font jamais pendant le calcul d'une dérivée : ils restent sans repère.
// L'empreinte vient du nom du module : deux fichiers ne se prennent pas leurs repères quand une dérivée appelle l'aide d'un autre module

import { createHash } from 'node:crypto'
import * as acorn from 'acorn'
import * as walk from 'acorn-walk'
import MagicString from 'magic-string'
import { unescapeMu } from './mu-escapes.js'

// un appel du magasin chargé dans le texte où `µ` est écrit en clair, blancs et chaînage optionnel compris (même motif que bundler/features.ts)
const LOAD_RE = /µ\s*\??\.\s*load\b/
// l'import du cœur que le squelette écrit avant la résolution des chemins (`import { µ } from µ.asset('mjs_core.js')`, résolu par le
// bundler) n'est pas du JS : acorn le lit comme une chaîne de même longueur, les positions des appels ne bougent pas
const IMPORT_ASSET_RE = /(\bfrom[ \t]*)µ\.asset\([^)\n]*\)/g
export const readableAssetImports = (js: string): string => js.replace(IMPORT_ASSET_RE, (m: string, from: string) => from + '"' + ' '.repeat(m.length - from.length - 2) + '"')

const LOOPS     = new Set(['ForStatement', 'ForInStatement', 'ForOfStatement', 'WhileStatement', 'DoWhileStatement'])
const FUNCTIONS = new Set(['ArrowFunctionExpression', 'FunctionExpression', 'FunctionDeclaration'])
// la fonction que le compilateur écrit pour un `switch`, un `try` ou un `do` dans une expression, `(()=>{…})()` (`(async ()=>{…})()` quand
// elle attend) : appelée aussitôt, une fois, pendant le calcul — une flèche écrite à la main (`(() => {…})()`) reste une fonction
const wrapper = (a: any, p: any, js: string): boolean => a.type === 'ArrowFunctionExpression' && a.params.length === 0 && p?.type === 'CallExpression' && p.callee === a && !p.optional && p.arguments.length === 0 && /^(?:async )?\(\)=>\{$/.test(js.slice(a.start, a.body.start + 1))
// l'appel écrit directement dans l'expression d'une dérivée : la première fonction qui l'entoure, sans boucle entre les deux, est celle que
// le compilateur passe au cœur pour la dérivée (`µ._mjs_setComputed(_mjsThis, 'nom', () => (…))`), ses enveloppes mises à part
const direct = (ancestors: any[], js: string): boolean => {
  for (let i = ancestors.length - 2; i >= 0; i--) {
    const a = ancestors[i]
    if (LOOPS.has(a.type)) return false
    if (!FUNCTIONS.has(a.type)) continue
    const p = ancestors[i - 1]
    if (wrapper(a, p, js)) continue
    return p?.type === 'CallExpression' && p.arguments[2] === a && p.callee.type === 'MemberExpression' && !p.callee.computed && p.callee.object.type === 'Identifier' && p.callee.object.name === 'µ' && p.callee.property.name === '_mjs_setComputed'
  }
  return false
}

// le code du gabarit qu'écrit le compilateur dans le composant : ses liaisons (`const _mjs_eff = [...]`) et la passe de ses blocs
// (`_mjsThis._mjs_renderStruct = () => {...}`)
const inTemplate = (ancestors: any[]): boolean => ancestors.some((a: any) => (a.type === 'VariableDeclarator' && a.id.name === '_mjs_eff') || (a.type === 'AssignmentExpression' && a.left.type === 'MemberExpression' && a.left.property.name === '_mjs_renderStruct'))

/**
 * `js` avec un repère sur chaque appel `µ.load(url)` / `µ.load(url, options)` du script (`µ.load(url, null, 'a1b2.0')`), et la carte qui
 * mène du texte rendu à `js` quand un repère a été posé (à composer par-dessus celle de `js`). Un texte sans appel du script, ou qu'acorn
 * ne lit pas, revient tel quel : ses appels gardent leur rang
 */
export function loadSites(js: string, module: string): { code: string, map?: string } {
  if (!LOAD_RE.test(unescapeMu(js))) return { code: js }
  let ast: acorn.Node
  try {
    const readable = readableAssetImports(js)
    ast = acorn.parse(readable, { ecmaVersion: 'latest', sourceType: 'module', allowReturnOutsideFunction: true })
  }
  catch {
    return { code: js }
  }
  const digest = createHash('md5').update(module).digest('hex').slice(0, 4)
  const ms     = new MagicString(js)
  let rank     = 0
  walk.ancestor(ast, {
    CallExpression(node: any, _walkState: unknown, ancestors: any[]) {
      const callee = node.callee
      const args   = node.arguments
      if (callee.type !== 'MemberExpression' || callee.computed || callee.object.type !== 'Identifier' || callee.object.name !== 'µ' || callee.property.name !== 'load') return
      if (args.length < 1 || args.length > 2 || args.some((a: any) => a.type === 'SpreadElement') || inTemplate(ancestors)) return
      // après le dernier argument, avant une virgule finale éventuelle ; sans options, `null` (aucune règle, aucun avertissement) ; `*`
      // devant le repère d'un appel qui n'est pas écrit directement dans l'expression d'une dérivée
      ms.appendLeft(args[args.length - 1].end, `${args.length === 1 ? ',null' : ''},'${direct(ancestors, js) ? '' : '*'}${digest}.${rank++}'`)
    },
  })
  if (rank === 0) return { code: js }
  return { code: ms.toString(), map: ms.generateMap({ hires: true, source: module + '.js', file: module + '.js' }).toString() }
}
