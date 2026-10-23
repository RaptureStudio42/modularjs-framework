// `mjs dev` (même instance) : un fichier de thème fautif qui arrive (`Clair.theme.mjs`, nom invalide) est une erreur du
// build, et les thèmes du dernier tour réussi restent publiés. Le manifeste partait sinon sans aucun thème (`µ._themes`
// absent, CSS du thème valide retiré) : la page rechargée perdait ses couleurs

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readFileSync, unlinkSync } from 'node:fs'
import { join } from 'node:path'
import { mjsTmp } from './helpers/tmp.js'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'

describe('thème fautif en développement : les thèmes valides restent publiés', function () {
  this.timeout(60000)
  after(async () => { await terminateSharedWorkerPool() })

  it('un second thème au nom invalide : une erreur, µ._themes et le CSS du thème valide restent', async () => {
    const root = mjsTmp('theme-fautif-garde')
    const src  = join(root, 'src')
    const out  = join(root, 'out')
    mkdirSync(src, { recursive: true })
    writeFileSync(join(src, 'carte.mjs'), '<p>carte</p>\n')
    writeFileSync(join(src, 'sombre.theme.mjs'), '<theme>\n  $$fond: #000\n</theme>\n')
    const manifeste = () => readFileSync(join(out, 'bundle.js'), 'utf-8')
    const themes    = () => {
      const liste = manifeste().match(/µ\._themes = (\[[^\]]*\])/)?.[1]
      return liste === undefined ? '(absent)' : JSON.stringify(JSON.parse(liste).sort())
    }
    const cssFond = () => /µ\._themeCss = .*--mjs-fond/.test(manifeste())
    const b = new Bundler({ sourceDir: src, outputDir: out, manifestPath: join(out, 'bundle.js') })
    try {
      const s1 = await b.compile()
      assert.equal(s1.errors.length, 0, s1.errors.map(e => e.message).join('\n'))
      assert.equal(themes(), '["sombre"]')
      assert.ok(cssFond())

      writeFileSync(join(src, 'Clair.theme.mjs'), '<theme>\n  $$fond: #fff\n</theme>\n')
      const s2 = await b.compile()
      assert.equal(s2.errors.length, 1, s2.errors.map(e => e.message).join('\n'))
      assert.match(s2.errors[0].message, /Clair/)
      assert.equal(themes(), '["sombre"]', 'le thème valide du tour d\'avant reste publié')
      assert.ok(cssFond(), 'son CSS aussi')

      // le fichier corrigé : les deux thèmes partent
      unlinkSync(join(src, 'Clair.theme.mjs'))
      writeFileSync(join(src, 'clair.theme.mjs'), '<theme>\n  $$fond: #fff\n</theme>\n')
      const s3 = await b.compile()
      assert.equal(s3.errors.length, 0, s3.errors.map(e => e.message).join('\n'))
      assert.equal(themes(), '["clair","sombre"]')
    }
    finally {
      await b.close()
    }
  })
})
