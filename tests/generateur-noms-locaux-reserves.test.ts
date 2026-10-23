// Tout ce que le code émis déclare à côté du code de l'auteur — variable, constante, paramètre de fonction, argument d'un
// attrape-erreur — porte un nom que l'auteur n'écrit pas : le préfixe `_mjs` (ou `__`, `_nref_`, `_c_`, que le parseur refuse déjà à l'auteur). Seuls
// restent en clair les noms que le contrat donne EXPRÈS à l'auteur : `e` et `el` dans un gestionnaire d'événement, `_node` dans
// un `@attach`. Le composant porte toutes les formes de helpers/noms-internes-formes.ts, à la racine, dans une ligne de `{for}`
// et dans la branche d'un `{await}` ; ses noms déclarés sont comparés à ceux du même composant sans aucune forme.

import assert from 'node:assert/strict'
import * as acorn from 'acorn'
import * as walk from 'acorn-walk'
import { transpile } from '../src/transpiler/index.js'
import { terminateSharedWorkerPool } from '../src/bundler/index.js'
import { CONTEXTES, FORMES, composant } from './helpers/noms-internes-formes.js'

// les identifiants qu'un motif de déstructuration lie
function lies(motif: any, sortie: Set<string>): void {
  switch (motif?.type) {
    case 'Identifier': sortie.add(motif.name); break
    case 'ObjectPattern': for (const p of motif.properties) lies(p.type === 'RestElement' ? p.argument : p.value, sortie); break
    case 'ArrayPattern': for (const x of motif.elements) lies(x, sortie); break
    case 'AssignmentPattern': lies(motif.left, sortie); break
    case 'RestElement': lies(motif.argument, sortie); break
  }
}

// la sortie du transpileur garde `µ.asset('…')` là où le bundler pose un chemin : un texte pour l'analyseur
const lire = (js: string) => acorn.parse(js.replace(/µ\.asset\(['"]([^'"]+)['"]\)/g, "'/__placeholder/$1'"), { ecmaVersion: 'latest', sourceType: 'module' })

function declares(js: string): Set<string> {
  const sortie = new Set<string>()
  walk.full(lire(js), (n: any) => {
    if (n.type === 'VariableDeclarator') lies(n.id, sortie)
    else if (n.type === 'FunctionDeclaration' || n.type === 'FunctionExpression') {
      if (n.id) lies(n.id, sortie)
      for (const p of n.params) lies(p, sortie)
    }
    else if (n.type === 'ArrowFunctionExpression') for (const p of n.params) lies(p, sortie)
    else if (n.type === 'CatchClause') lies(n.param, sortie)
    else if (n.type === 'ClassDeclaration' || n.type === 'ClassExpression') lies(n.id, sortie)
  })
  return sortie
}

// ce que le contrat donne exprès à l'auteur (`e`, `el`, `_node`), ce que le gabarit nomme (la ligne `l`, son index `index`, la valeur `w`), et les temporaires que Civet
// nomme lui-même (`ref`, `ref1`…) en vérifiant qu'aucun identifiant du même code ne les porte
const DU_CONTRAT = new Set(['e', 'el', '_node', '$', 'µ', 'l', 'index', 'w'])
const DE_CIVET    = /^ref\d*$/
// `_nref_` et `_c_` : préfixes que le parseur refuse déjà à l'auteur pour ses noms de bloc
const RESERVE    = /^_mjs|^__|^_nref_|^_c_/

describe('noms que le code émis déclare — tous réservés, sauf ceux que le contrat donne à l\'auteur', function () {
  this.timeout(120000)
  after(async () => { await terminateSharedWorkerPool() })

  it('aucune variable locale du code émis ne porte un nom que l\'auteur pourrait écrire', async () => {
    const complet = (await transpile(composant('zz'), { moduleName: 'noms-internes' })).output
    const sans    = composant('zz').replace(/^<\/script>\n[\s\S]*$/m, '</script>\n')
    const nu      = (await transpile(sans, { moduleName: 'noms-internes' })).output
    const deja    = declares(nu)
    const emis    = [...declares(complet)].filter((nom) => !deja.has(nom))
    assert.ok(emis.length > 20, `le composant déclare de quoi être audité (${emis.length} noms relevés)`)
    assert.ok(FORMES.length >= 20 && CONTEXTES.length === 3)
    const ouverts = emis.filter((nom) => !RESERVE.test(nom) && !DU_CONTRAT.has(nom) && !DE_CIVET.test(nom)).sort()
    assert.deepEqual(ouverts, [], `noms déclarés par le code émis et que l'auteur peut écrire : ${ouverts.join(', ')}`)
  })

  it('e et el ne sont déclarés que par les gestionnaires d\'événement : une liaison à deux sens garde les siens sous un nom réservé', async () => {
    const source = `<script>
  zz = { t: 'a', b: true, c: 1 }
</script>
<input aria-label="a" value=!{zz.t}>
<input type="checkbox" aria-label="b" checked=!{zz.b}>
<div contenteditable @text=!{zz.t}></div>
<button @click={$ev = zz.c}>x</button>
`
    const sortie = (await transpile(source, { moduleName: 'noms-internes-liaisons' })).output
    const entetes: string[][] = []
    walk.full(lire(sortie), (n: any) => {
      if (n.type !== 'AssignmentExpression' || n.left.type !== 'MemberExpression' || n.left.property.name !== '_mjs_inline' || n.right.type !== 'ArrayExpression') return
      for (const f of n.right.elements) {
        const noms = new Set<string>()
        for (const p of f.params) lies(p, noms)
        entetes.push([...noms])
      }
    })
    assert.equal(entetes.length, 4, 'trois liaisons et un gestionnaire')
    assert.equal(entetes.filter((noms) => noms.includes('e') || noms.includes('el')).length, 1, 'seul le gestionnaire d\'événement reçoit e et el')
  })
})
