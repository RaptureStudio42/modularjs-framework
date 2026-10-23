// La pose automatique de `var` devant une affectation de premier niveau connaît aussi les noms liés par `class`,
// `function*` et `import` : leur réaffectation ne reçoit jamais un `var` en double (module invalide).

import assert from 'node:assert/strict'
import * as acorn from 'acorn'
import { autoDeclareTopLevelBareAssignments as poser } from '../src/bundler/index.js'

const valide = (js: string) => acorn.parse(js, { ecmaVersion: 'latest', sourceType: 'module' })

describe('pose automatique de var : class, function*, import', function () {
  const cas = [
    'class Foo {}\nFoo = 2',
    'function* gen() {}\ngen = 1',
    'function *gen2() {}\ngen2 = 1',
    'async function* flux() {}\nflux = 1',
    "import x from './x.js'\nx = 1",
    "import * as ns from './x.js'\nns = 1",
    "import d, { a, b as c } from './x.js'\nd = 1\na = 2\nc = 3",
    "import {\n  e,\n  f as g\n} from './x.js'\ne = 1\ng = 2",
  ]
  for (const js of cas) {
    it(JSON.stringify(js), () => {
      const out = poser(js)
      assert.ok(!/\bvar\b/.test(out), `var en trop : ${JSON.stringify(out)}`)
      valide(out)
    })
  }

  it('un nom importé sous un alias garde le var de son homonyme non lié', () => {
    const out = poser("import { b as c } from './x.js'\nb = 1")
    assert.match(out, /^var b = 1$/m)
  })
})
