// stripEsm/ssrScopeFile (renderToString.ts) réécrivaient le JS compilé via des expressions
// régulières sur du TEXTE — une regex ne distingue jamais un mot-clé `import`/`export` RÉEL d'un
// texte qui lui ressemble (chaîne littérale, commentaire). Remplacé par une analyse avec un vrai
// parseur (acorn) : seules les vraies déclarations `import`/`export` (nœuds `Program.body` — la
// grammaire ES les interdit ailleurs) sont réécrites.
import assert from 'node:assert/strict'
import { stripEsm, ssrScopeFile } from '../src/server/renderToString.js'

describe('stripEsm — analyse par un vrai parseur, pas une regex sur le texte', function () {
  it('une CHAÎNE littérale contenant "export default"/"import.meta.url" survit intacte', function () {
    const input = '"export default hello import.meta.url"'
    assert.equal(stripEsm(input), input, 'le contenu textuel de la chaîne ne doit jamais être interprété comme du code')
  })

  it('un VRAI import.meta.url (expression réelle, pas dans une chaîne) est toujours remplacé', function () {
    const out = stripEsm('const u = import.meta.url;\n')
    assert.equal(out, "const u = 'http://localhost/';\n")
  })

  it('un VRAI import est toujours retiré', function () {
    const out = stripEsm(`import { a } from './x.js';\nconsole.log(a);\n`)
    assert.ok(!/\bimport\b/.test(out), `l'import doit disparaître : ${out}`)
    assert.match(out, /console\.log\(a\);/)
  })

  it('un binding renommé vers µ par le mangler (export{i as µ}) est toujours re-exposé', function () {
    const out = stripEsm('const i = {};\nexport{i as µ};\n')
    assert.match(out, /var µ = i;/, `le pont vers µ doit survivre au retrait du bloc export : ${out}`)
  })
})

describe('ssrScopeFile — analyse par un vrai parseur, pas une regex sur le texte', function () {
  it('un import à EFFET DE BORD compte dans les dépendances (tri topologique correct)', function () {
    const resolve = (url: string) => url.includes('helper') ? '_mjsF_helper' : null
    const { code, deps } = ssrScopeFile(`import './helper.js';\nconsole.log('hi')`, '_mjsF_a', resolve)
    assert.ok(!/\bimport\b/.test(code), `l'import doit être retiré du code : ${code}`)
    assert.deepEqual(deps, ['_mjsF_helper'], `la dépendance vers le fichier importé ne doit jamais être perdue : ${JSON.stringify(deps)}`)
  })

  it('un "export" mentionné dans un COMMENTAIRE ne produit jamais de ReferenceError à l\'éval', function () {
    const resolve = () => null
    const raw = `// note : export function clear() {}\nconsole.log('hi')`
    const { code } = ssrScopeFile(raw, '_mjsF_doc', resolve)
    assert.doesNotThrow(() => { new Function(code)() }, `le commentaire ne doit jamais être interprété comme un export réel : ${code}`)
  })

  it('un export réel (déclaration nommée) reste exposé dans le return final', function () {
    const resolve = () => null
    const { code } = ssrScopeFile(`export function clear() { return 42 }\n`, '_mjsF_x', resolve)
    const mod: any = new Function(`return ${code.replace(/^const _mjsF_x = /, '').replace(/;\s*$/, '')}`)()
    assert.equal(typeof mod.clear, 'function')
    assert.equal(mod.clear(), 42)
  })

  it('export default ANONYME reste assignable (pas de "Function statements require a function name")', function () {
    const resolve = () => null
    const { code } = ssrScopeFile(`export default function() { return 'ok' }\n`, '_mjsF_y', resolve)
    const mod: any = new Function(`return ${code.replace(/^const _mjsF_y = /, '').replace(/;\s*$/, '')}`)()
    assert.equal(mod.default(), 'ok')
  })
})
