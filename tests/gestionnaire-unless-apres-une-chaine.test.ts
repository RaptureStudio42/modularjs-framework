// `expr unless cond` (forme postfixe) dans un gestionnaire, quand l'expression ou la condition contient
// une chaîne : la réécriture se faisait morceau par morceau entre les chaînes, et le morceau qui portait
// `unless` ne voyait que la fin de l'expression. `$msg = 'oui' unless $bloque` se construisait en
// `'oui'($.bloque)` (TypeError au clic), `alert('x') unless $ok` et `§theme = 'dark' unless $clair`
// faisaient échouer la construction sur un message de Civet sans rapport.

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { createHarness } from '../src/testing/index.js'
import { cleanJs } from '../src/generator/utils.js'
import { mjsTmp } from './helpers/tmp.js'

describe('`unless` postfixe après une chaîne, dans un gestionnaire', function () {
  this.timeout(60000)

  describe('réécriture', () => {
    const CAS: Array<[string, string]> = [
      ['$msg = \'oui\' unless $bloque', '(!($.bloque) && ($.msg = \'oui\'))'],
      ['alert(\'x\') unless $bloque', '(!($.bloque) && (alert(\'x\')))'],
      ['$n++ unless $mode == \'x\'', '(!($.mode == \'x\') && ($.n++))'],
      ['§theme = \'dark\' unless $clair', '(!($.clair) && (this._mjs_setContext(\'theme\', \'dark\')))'],
      ['$msg = "a" + \'b\' unless not $ok', '(!(!$.ok) && ($.msg = "a" + \'b\'))'],
    ]
    for (const [brut, attendu] of CAS) {
      it(`${brut} → ${attendu}`, () => {
        assert.equal(cleanJs(brut), attendu)
      })
    }

    it('sans chaîne, rien ne change ; le mot `unless` DANS une chaîne reste du texte', () => {
      assert.equal(cleanJs('$n++ unless $bloque'), '(!($.bloque) && ($.n++))')
      assert.equal(cleanJs('unless $bloque'), '!($.bloque)')
      assert.equal(cleanJs('$msg = \'a unless b\''), '$.msg = \'a unless b\'')
    })
  })

  describe('composant monté', () => {
    let root: string
    let app: any

    before(async () => {
      root = mjsTmp('unless-chaine')
      const srcDir = join(root, 'src')
      mkdirSync(srcDir, { recursive: true })
      writeFileSync(join(srcDir, 'unless-chaine.mjs'), [
        '<script>',
        '$msg = ""',
        '$bloque = false',
        '</script>',
        '<button class="ecrire" @click={$msg = \'oui\' unless $bloque}>écrire</button>',
        '<button class="bloquer" @click={$bloque = true}>bloquer</button>',
        '<p class="m">{$msg}</p>',
      ].join('\n'))
      writeFileSync(join(root, 'mjs.config.json'), JSON.stringify({ sourceDir: 'src', outputDir: 'out', manifestPath: 'out/bundle.js' }, null, 2))
      app = await createHarness({ root })
    })

    after(async () => {
      if (app) await app.destroy()
    })

    it('écrit quand la condition est fausse', async () => {
      const c = await app.mount('unless-chaine')
      try {
        await c.click('.ecrire')
        assert.equal(c.text('.m'), 'oui')
      } finally {
        c.destroy()
      }
    })

    it('n\'écrit rien quand la condition est vraie', async () => {
      const c = await app.mount('unless-chaine')
      try {
        await c.click('.bloquer')
        await c.click('.ecrire')
        assert.equal(c.text('.m'), '')
      } finally {
        c.destroy()
      }
    })
  })
})
