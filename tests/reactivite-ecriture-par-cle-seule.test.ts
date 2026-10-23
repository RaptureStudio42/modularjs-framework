// Un bloc qui n'écrit l'état QUE par une clé calculée (`$[k] = v`, `$[k].x = v`, `delete $[k]`,
// `$[k].push(…)`) : les deux passes d'écriture (transform-reactive.ts, path-tracker.ts) étaient
// sautées dès que le texte ne contenait aucun `$.` — l'écriture restait nue, l'état changeait sans
// aucune invalidation et le DOM ne bougeait plus, sans le moindre message. Le même code, précédé
// d'une simple lecture `$.z`, était correctement réécrit.

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { createHarness } from '../src/testing/index.js'
import { transformReactiveWrites } from '../src/generator/transform-reactive.js'
import { applyPathTracking, applyPathTrackingMapped } from '../src/generator/path-tracker.js'
import { mjsTmp } from './helpers/tmp.js'

const passes = (js: string): string => applyPathTracking(transformReactiveWrites(js))

describe('écriture d\'état par clé calculée seule (aucun autre accès `$.`)', function () {
  this.timeout(60000)

  describe('les deux passes d\'écriture', () => {
    const FORMES = [
      'function f(k) { $[k] = 1 }',
      'function f(k) { $[k] += 2 }',
      'function f(k) { $[k]++ }',
      'function f(k) { $[k].x = 1 }',
      'function f(k) { delete $[k] }',
      'function f(k) { $[k].push(3) }',
    ]

    for (const forme of FORMES) {
      it(`${forme} est réécrit comme en présence d'une lecture \`$.z\``, () => {
        const seule = passes(forme)
        const avecLecture = passes(forme.replace('{ ', '{ $.z; '))
        assert.notEqual(seule, forme, 'l\'écriture par clé calculée doit être réécrite')
        assert.equal(seule, avecLecture.replace('$.z; ', ''))
      })
    }

    it('un module autonome (racines du magasin seules) ne suit toujours pas `$[k]`', () => {
      const js = 'function f(k) { $[k].x = 1 }'
      assert.equal(applyPathTrackingMapped(js, { storeOnly: true }).code, js)
    })
  })

  describe('composant monté', () => {
    let root: string
    let app: any

    before(async () => {
      root = mjsTmp('cle-seule')
      const srcDir = join(root, 'src')
      mkdirSync(srcDir, { recursive: true })
      // gestionnaire en ligne : aucun autre gestionnaire n'accède à l'état par `$x`
      writeFileSync(join(srcDir, 'cle-en-ligne.mjs'), [
        '<script>',
        '$a = 1',
        'cle = "a"',
        '</script>',
        '<button class="poser" @click={$[cle] = 5}>poser</button>',
        '<p class="v">{$a}</p>',
      ].join('\n'))
      // script qui n'écrit l'état que par une clé calculée
      writeFileSync(join(srcDir, 'cle-en-script.mjs'), [
        '<script lang="js">',
        'function poser(k, v) { $[k] = v }',
        '</script>',
        '<button class="poser" @click={poser("a", 9)}>poser</button>',
        '<p class="v">{$a}</p>',
      ].join('\n'))
      writeFileSync(join(root, 'mjs.config.json'), JSON.stringify({ sourceDir: 'src', outputDir: 'out', manifestPath: 'out/bundle.js' }, null, 2))
      app = await createHarness({ root })
    })

    after(async () => {
      if (app) await app.destroy()
    })

    it('gestionnaire en ligne `$[cle] = 5` : l\'état ET le DOM suivent', async () => {
      const c = await app.mount('cle-en-ligne')
      try {
        await c.click('.poser')
        assert.equal(c.state.a, 5)
        assert.equal(c.text('.v'), '5')
      } finally {
        c.destroy()
      }
    })

    it('script `$[k] = v` sans autre accès à l\'état : l\'état ET le DOM suivent', async () => {
      const c = await app.mount('cle-en-script')
      try {
        await c.click('.poser')
        assert.equal(c.state.a, 9)
        assert.equal(c.text('.v'), '9')
      } finally {
        c.destroy()
      }
    })
  })
})
