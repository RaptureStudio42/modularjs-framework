// Mode léger (`@lightDom`) : la réécriture de `:host(…)` en nom de balise cherchait la parenthèse
// fermante sans voir les guillemets. Défaut garanti absent : `:host([title=")"]) .a{…}` devenait
// `mjs-x[title=""]) .a{…}` — sélecteur cassé, règle perdue.

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { createHarness } from '../src/testing/index.js'
import { mjsTmp } from './helpers/tmp.js'

function projetTemporaire(): string {
  const root   = mjsTmp('host-guillemets')
  const srcDir = join(root, 'src')
  mkdirSync(srcDir, { recursive: true })
  writeFileSync(join(srcDir, 'hg-vide.mjs'), '<p>x</p>\n')
  writeFileSync(join(root, 'mjs.config.json'), JSON.stringify({ sourceDir: 'src', outputDir: 'out', manifestPath: 'out/bundle.js' }, null, 2))
  return root
}

describe('mode léger — :host(…) dont l\'argument contient une parenthèse entre guillemets', function () {
  this.timeout(180000)

  let app: any

  before(async () => {
    app = await createHarness({ root: projetTemporaire() })
  })

  after(async () => {
    if (app) await app.destroy()
  })

  it('la parenthèse d\'une chaîne ne ferme pas :host( ni :host-context(', () => {
    const f = app.µ._lightHostCss
    assert.equal(f(':host([title=")"]) .a{color:red}', 'mjs-x'), 'mjs-x[title=")"] .a{color:red}')
    assert.equal(f(":host([title=')']){color:red}", 'mjs-x'), "mjs-x[title=')']{color:red}")
    assert.equal(f(':host([title="a\\")"]){}', 'mjs-x'), 'mjs-x[title="a\\")"]{}', 'guillemet échappé dans la chaîne')
    assert.equal(f(':host-context([data-x="("]) .t{}', 'mjs-x'), ':where([data-x="("] mjs-x,mjs-x[data-x="("]) .t{}')
    assert.equal(f(':host(:not([a="("])) .b{}', 'mjs-x'), 'mjs-x:not([a="("]) .b{}', 'parenthèses imbriquées autour de la chaîne')
  })
})
