// Callback de transition (`@introstart={...}`, bindingTransition) : le code
// utilisateur injecté ne doit jamais être altéré par la mise en forme du
// gabarit qui l'entoure — ni les espaces internes d'une chaîne littérale, ni
// un commentaire `//` (qui doit rester valide, pas avaler la suite du code).

import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { transpile } from '../src/transpiler/index.js'

const require = createRequire(import.meta.url)
const acorn    = require('acorn')

async function introstartCallbackBody(assignment: string): Promise<string> {
  const source = [
    '<script>', '$x = \'\'', '</script>',
    `<p @transition.fade @introstart={${assignment}}>test</p>`,
  ].join('\n')
  const { output } = await transpile(source, { moduleName: 'transCallback' })
  const m = output.match(/node\._mjs_cb_introstart = \(\) => \{([\s\S]*?)\n?\s*\};/)
  assert.ok(m, 'le callback _mjs_cb_introstart doit être présent dans la sortie')
  return m![1]
}

function runCallback(body: string): unknown {
  const captured: { value: unknown } = { value: undefined }
  Function('µ', '_mjsThis', body)({ _set: (_owner: unknown, _key: unknown, val: unknown) => { captured.value = val } }, {})
  return captured.value
}

describe('bindingTransition — callback ne corrompt pas le code utilisateur', function () {
  this.timeout(15000)

  it('les espaces internes d\'une chaîne littérale sont préservés (pas aplatis à 1 espace)', async () => {
    const body = await introstartCallbackBody('$x = \'a   b\'')
    assert.equal(runCallback(body), 'a   b', 'les 3 espaces de la chaîne littérale doivent survivre intacts')
  })

  it('un commentaire `//` en fin d\'expression reste un commentaire JS valide (JS produit parsable)', async () => {
    const body = await introstartCallbackBody('$x = \'ok\' // un commentaire')
    // pas de crash acorn : le `//` ne doit pas avaler la suite (`; };`)
    assert.doesNotThrow(() => acorn.parse(`() => { ${body} }`, { ecmaVersion: 'latest', sourceType: 'module' }))
    assert.equal(runCallback(body), 'ok')
  })
})
