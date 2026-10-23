// ast-helpers — tests d'AST partagés par les passes de réécriture du générateur (transform-reactive.ts,
// path-tracker.ts, effect-deps.ts, store-args.ts). Une seule définition chacun : recopiés, ils divergeaient.

import * as acorn from 'acorn'

// une seule analyse pour un même texte : une passe qui n'a rien changé rend son texte tel quel, la suivante
// (transform-reactive → path-tracker → effect-deps) relit alors l'arbre déjà construit au lieu de reparser le
// module. Les passes ne modifient jamais l'arbre (MagicString travaille sur le texte) ; une erreur d'analyse
// n'est pas gardée, elle se relève à chaque appel
let derniere: { js: string, ast: acorn.Node } | null = null
export function parseModule(js: string): acorn.Node {
  if (derniere?.js === js) return derniere.ast
  const ast = acorn.parse(js, { ecmaVersion: 'latest', sourceType: 'module' })
  derniere = { js, ast }
  return ast
}

// opérateurs d'affectation composée (`$x += 1`, `$$n ??= 0`…) : l'écriture relit la cible
export const COMPOUND_OPS = new Set([
  '+=', '-=', '*=', '/=', '%=', '**=',
  '&=', '|=', '^=', '<<=', '>>=', '>>>=',
  '&&=', '||=', '??=',
])

// `µ.store` : la racine du magasin universel, telle que le lexer écrit `$$x` (`µ.store.x`)
export function isStoreRoot(node: any): boolean {
  return node?.type === 'MemberExpression' && !node.computed &&
    node.object?.type === 'Identifier' && node.object.name === 'µ' &&
    node.property?.type === 'Identifier' && node.property.name === 'store'
}

// feuilles d'un motif de déstructuration (identifiant lié, membre visé…), à toute profondeur, de gauche à
// droite — jamais la valeur par défaut d'un `AssignmentPattern`, qui est une lecture et pas une cible
export function forEachPatternLeaf(pattern: any, visit: (leaf: any) => void): void {
  if (!pattern) return // trou d'ArrayPattern ([a, , b]) ou branche absente
  switch (pattern.type) {
    case 'ArrayPattern':
      for (const el of pattern.elements) forEachPatternLeaf(el, visit)
      return
    case 'ObjectPattern':
      for (const prop of pattern.properties) forEachPatternLeaf(prop.type === 'RestElement' ? prop.argument : prop.value, visit)
      return
    case 'AssignmentPattern':
      forEachPatternLeaf(pattern.left, visit)
      return
    case 'RestElement':
      forEachPatternLeaf(pattern.argument, visit)
      return
  }
  visit(pattern)
}
