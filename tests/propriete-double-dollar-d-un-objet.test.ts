// `obj.$$x` est la propriété `$$x` d'un objet quelconque, pas le store global : le `<script>` en faisait
// `obj.µ.store.x` et le gabarit `obj.$$.x`, deux lectures fausses. Elle reste `obj.$$x` des deux côtés ;
// `$$x` seul, une plage `[1..$$n]` et une décomposition `[...$$l]` lisent toujours le store.

import assert from 'node:assert/strict'
import { tokenize } from '../src/lexer/index.js'
import { cleanJs, cleanJsExpr } from '../src/generator/utils.js'
import { transpile } from '../src/transpiler/index.js'

describe('propriété `$$x` d\'un objet', () => {
  it('dans le <script>, reste une propriété ; le store garde ses formes', () => {
    assert.equal(tokenize('y = obj.$$x'), 'y = obj.$$x')
    assert.equal(tokenize('y = obj?.$$x'), 'y = obj?.$$x')
    assert.equal(tokenize('y = $$x'), 'y = µ.store.x')
    assert.equal(tokenize('y = [1..$$n]'), 'y = [1..µ.store.n]')
    assert.equal(tokenize('y = [...$$l]'), 'y = [...µ.store.l]')
  })

  it('un singleton importé du même nom n\'est pas en cause', () => {
    assert.equal(tokenize('y = obj.$$x', { externalVars: ['$x'] }), 'y = obj.$$x')
  })

  it('dans le gabarit, reste une propriété', () => {
    assert.equal(cleanJs('obj.$$x', []), 'obj.$$x')
    assert.equal(cleanJsExpr('obj.$$x'), 'obj.$$x')
    assert.equal(cleanJs('$$x', []), 'µ.store.x')
  })

  it('construit : le script et le gabarit lisent la propriété', async function () {
    this.timeout(30000)
    const { output } = await transpile("<script>\nobj = { '$$x': 7 }\ny = obj.$$x\n</script>\n<p>{obj.$$x}</p>", { moduleName: 'prop-dd' })
    assert.doesNotMatch(output, /obj\.µ\.store|obj\.\$\$\.x/)
    assert.match(output, /y = obj\.\$\$x/)
    assert.match(output, /_mjs_updText\('t1', obj\.\$\$x\)/)
  })
})
