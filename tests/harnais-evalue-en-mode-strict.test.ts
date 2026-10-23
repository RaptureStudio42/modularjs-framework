// Le navigateur charge le bundle en module ES : tout son code tourne en mode STRICT. Le harnais l'évaluait en mode
// non strict — une écriture dans un objet gelé y passait en silence là où le navigateur lève une TypeError, et un test
// d'application pouvait réussir sur un code qui casse en vrai. Le cœur, les feuilles, les effets et les composants
// sont maintenant évalués en mode strict, comme dans la page.

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { createHarness } from '../src/testing/index.js'
import { mjsTmp } from './helpers/tmp.js'

describe('harnais de test : le code du projet tourne en mode strict, comme dans le navigateur', function () {
  this.timeout(60000)

  let app: any

  before(async () => {
    const root   = mjsTmp('harnais-strict')
    const srcDir = join(root, 'src')
    mkdirSync(srcDir, { recursive: true })
    writeFileSync(join(srcDir, 'etat-gele.mjs'), [
      '<script>',
      '$cfg = Object.freeze({ a: 1 })',
      "$res = 'rien'",
      'ecrire = (v) ->',
      '  try',
      '    $cfg.a = v',
      "    $res = 'silence'",
      '  catch e',
      '    $res = e.name',
      '</script>',
      '<button @click={ecrire(2)}>a</button><p>{$res}</p>',
    ].join('\n'))
    writeFileSync(join(root, 'mjs.config.json'), JSON.stringify({ sourceDir: 'src', outputDir: 'out', manifestPath: 'out/bundle.js' }, null, 2))
    app = await createHarness({ root })
  })

  after(async () => {
    if (app) await app.destroy()
  })

  // l'écriture passe par l'enveloppe réactive de l'état, donc par le cœur : c'est lui que le harnais évaluait en non
  // strict (même TypeError que dans Chromium, cf. objet-gele-dans-l-etat-browser.test.ts)
  it('écrire dans un objet gelé de l\'état lève une TypeError', async () => {
    const c = await app.mount('etat-gele')
    try {
      await c.click('button')
      assert.equal(c.text('p'), 'TypeError')
    }
    finally {
      c.destroy()
    }
  })
})
