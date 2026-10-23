// L'extension VS Code : un nom qu'Object porte déjà (`toString`, `constructor`) n'est ni un effet ni un réglage.
// Taper `*toString` (survol) ou `*constructor(` faisait lever le fournisseur, `*neon(constructor: ` aussi, et le survol
// de `constructor` affichait « undefined · défaut : `undefined` ».

import assert from 'node:assert/strict'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const help    = require('../editors/vscode/effects-help.js')

describe('extension VS Code — les noms hérités d\'Object', () => {
  it('survol et complétion ne lèvent pas, et ne proposent rien', () => {
    assert.equal(help.hover('*toString', 3), null)
    assert.equal(help.hover('<p *constructor>', 6), null)
    assert.deepEqual(help.suggest('<p *constructor('), [])
    assert.deepEqual(help.suggest('<p *toString(a, '), [])
    assert.deepEqual(help.suggest('<p *neon(constructor: '), [])
    assert.equal(help.hover('<p *neon(constructor: red)>', 12), null)
    assert.equal(help.settingHelp('neon', 'constructor'), null)
    assert.equal(help.effectHelp('valueOf'), null)
  })

  it('les vrais effets et réglages gardent leur aide', () => {
    assert.match(help.hover('<p *neon>', 5), /\*\*\\\*neon\*\*/)
    assert.match(help.settingHelp('neon', 'color'), /réglage de `\*neon`/)
    assert.ok(help.suggest('<p *neon(').some((s: any) => s.label === 'color'))
  })
})
