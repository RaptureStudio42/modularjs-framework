// Régression : µ._mjs_navFindByIdIn (appariement par id des éléments `mjs-permanent`, cf.
// tests/ujs-nav-permanent.test.ts) descend récursivement dans `node.children` SANS aucun plafond
// de profondeur — contrairement à sa fonction sœur µ._mjs_deepFind (même fichier, même forme :
// descend dans les enfants ET le shadow root), qui plafonne à 50 niveaux. Un arbre pathologique
// (au-delà d'environ 10 000 niveaux, mesuré) fait planter la récursion (RangeError : Maximum call
// stack size exceeded), appelée sans filet par µ._mjs_navTransplantPermanents. Cas extrême, mais
// une recherche par id ne doit jamais faire planter une navigation.
//
// Fix : même plafond que µ._mjs_deepFind — un paramètre `depth`, incrémenté à chaque descente,
// coupe la recherche au-delà de 50 niveaux (repli : id non trouvé, comme n'importe quelle
// recherche qui échoue).

import { strict as assert } from 'node:assert'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { extractMarked } from './helpers/extract-marked.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const UJS_SRC = readFileSync(join(__dirname, '..', 'src', 'runtime', 'mjs_ujs.ts'), 'utf-8')

function installFindByIdIn(µ: any) {
  new Function('µ', extractMarked(UJS_SRC, '_mjs_navFindByIdIn'))(µ)
}

// chaîne d'ancêtre unique (pire cas : l'id cible est tout au fond, jamais trouvé avant le bout).
function makeChain(depth: number) {
  const root: any = { nodeType: 1, id: '', children: [] as any[] }
  let cur = root
  for (let i = 0; i < depth; i++) {
    const child: any = { nodeType: 1, id: (i === depth - 1) ? 'target' : '', children: [] as any[] }
    cur.children.push(child)
    cur = child
  }
  return root
}

describe("mjs_ujs — µ._mjs_navFindByIdIn : plafond de profondeur, comme sa fonction sœur µ._mjs_deepFind", function () {
  it('profondeur ordinaire (30 niveaux, sous le plafond) : trouve toujours la cible, aucune régression', function () {
    const µ: any = {}
    installFindByIdIn(µ)
    const found = µ._mjs_navFindByIdIn(makeChain(30), 'target', 0)
    assert.ok(found, 'la cible doit être trouvée à une profondeur ordinaire, sous le plafond')
    assert.equal(found.id, 'target')
  })

  it('profondeur pathologique (12 000 niveaux) : ne plante JAMAIS (repli id non trouvé), comme µ._mjs_deepFind', function () {
    const µ: any = {}
    installFindByIdIn(µ)
    assert.doesNotThrow(function () {
      µ._mjs_navFindByIdIn(makeChain(12000), 'target', 0)
    }, 'un arbre pathologique ne doit jamais faire planter la recherche (RangeError avant le fix)')
  })
})
