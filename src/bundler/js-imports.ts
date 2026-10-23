// bundler/js-imports — les imports relatifs d'un fichier .js que le build copie tel quel
//
// un .js publié sous empreinte (cible d'un µimport, d'un @import, d'un µasset) qui importe un voisin
// par chemin relatif le chercherait sous son nom source dans le dossier publié, où le voisin n'existe
// que sous son nom à empreinte : le bundler réécrit ces chemins (Bundler.rewriteRelativeJsImports) et
// suit ces voisins comme dépendances (Bundler.collectTransitiveImportClosure)

import * as acorn from 'acorn'
import * as walk from 'acorn-walk'

export interface JsImportSpecifier {
  /** position du littéral dans le code, guillemets compris */
  start: number
  end: number
  /** chemin tel qu'écrit, sans les guillemets */
  value: string
}

/** `./x.js`, `../x.js` — jamais un nom nu, un chemin absolu ni une URL */
export function isRelativeSpecifier(value: string): boolean {
  return value.startsWith('./') || value.startsWith('../')
}

/** imports relatifs d'un code JS, dans l'ordre du texte : import/export … from, import nu,
 *  import('littéral') — lus sur l'arbre, jamais dans une chaîne ni un commentaire ; code illisible
 *  en module comme en script → aucun */
export function relativeJsImports(code: string): JsImportSpecifier[] {
  let ast: acorn.Node
  try {
    ast = acorn.parse(code, { ecmaVersion: 'latest', sourceType: 'module' })
  } catch {
    try {
      ast = acorn.parse(code, { ecmaVersion: 'latest', sourceType: 'script' })
    } catch {
      return []
    }
  }
  const found: JsImportSpecifier[] = []
  walk.full(ast, (node: any) => {
    if (node.type !== 'ImportDeclaration' && node.type !== 'ExportAllDeclaration' && node.type !== 'ExportNamedDeclaration' && node.type !== 'ImportExpression') return
    const source = node.source
    if (source && source.type === 'Literal' && typeof source.value === 'string' && isRelativeSpecifier(source.value)) found.push({ start: source.start, end: source.end, value: source.value })
  })
  return found.sort((a, b) => a.start - b.start)
}
