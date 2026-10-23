// Balise à texte brut (`<textarea>`, `<style>`, `<title>`) précédée d'un « İ » (I majuscule pointé,
// U+0130) : la balise fermante était cherchée dans `gabarit.toLowerCase()`, puis la position appliquée
// au gabarit lui-même. Or `'İ'.toLowerCase()` fait DEUX unités : tout ce qui suivait glissait d'une
// unité par « İ », la balise fermante n'était plus reconnue et la fin du gabarit (`</textarea><p>fin</p>…`)
// devenait le texte de la balise. Le même gabarit écrit avec un « I » simple doit donner la même sortie.

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { createHarness } from '../src/testing/index.js'
import { generateCreateFnBody, extractPaths } from '../src/generator/paths.js'
import { mjsTmp } from './helpers/tmp.js'

const GABARITS = [
  '<div><p>İstanbul</p><textarea>abc</textarea><p>fin</p></div>',
  '<div><p>İİ</p><style>.x{color:red}</style><p>fin</p></div>',
  '<div><p>İ</p><title>T</title><p>fin</p></div>',
  '<div><p>İ</p><TEXTAREA>abc</TEXTAREA ><p>fin</p></div>',
]

describe('balise à texte brut après un « İ » (deux unités en minuscule)', function () {
  this.timeout(60000)

  describe('construction impérative et repérage des chemins', () => {
    for (const html of GABARITS) {
      const simple = html.replaceAll('İ', 'I')

      it(`voie impérative : ${html}`, () => {
        const avec = generateCreateFnBody(html, { forceImperative: true }).body
        const sans = generateCreateFnBody(simple, { forceImperative: true }).body
        assert.equal(avec.replaceAll('İ', 'I'), sans)
        assert.doesNotMatch(avec, /<\/(textarea|style|title)/i, 'la balise fermante ne doit pas finir dans le texte')
      })

      it(`chemins du gabarit cloné : ${html}`, () => {
        const avec = extractPaths(html)
        const sans = extractPaths(simple)
        assert.equal(avec.cleanHtml.replaceAll('İ', 'I'), sans.cleanHtml)
        assert.deepEqual(avec.paths, sans.paths)
        assert.deepEqual(avec.kinds, sans.kinds)
      })
    }
  })

  describe('composant monté', () => {
    let root: string
    let app: any

    before(async () => {
      root = mjsTmp('i-point')
      const srcDir = join(root, 'src')
      mkdirSync(srcDir, { recursive: true })
      writeFileSync(join(srcDir, 'ville-turque.mjs'), [
        '<script>',
        '$n = 1',
        '$p = Promise.resolve("ok")',
        '</script>',
        '<button class="plus" @click={$n++}>+</button>',
        '{await $p}',
        '  <p>attente</p>',
        '{success v}',
        '  <p>İstanbul</p>',
        '  <textarea class="t" aria-label="note">abc</textarea>',
        '  <p class="f">fin {v} {$n}</p>',
        '{end}',
      ].join('\n'))
      writeFileSync(join(root, 'mjs.config.json'), JSON.stringify({ sourceDir: 'src', outputDir: 'out', manifestPath: 'out/bundle.js' }, null, 2))
      app = await createHarness({ root })
    })

    after(async () => {
      if (app) await app.destroy()
    })

    // branche `{success}` qui porte des mises à jour : construite par la voie impérative
    it('le texte de la zone de saisie et la suite du gabarit restent à leur place', async () => {
      const c = await app.mount('ville-turque')
      try {
        await new Promise((r) => setTimeout(r, 20))
        assert.equal(c.find('.t').value, 'abc')
        assert.equal(c.text('.f'), 'fin ok 1')
        await c.click('.plus')
        assert.equal(c.text('.f'), 'fin ok 2')
      } finally {
        c.destroy()
      }
    })
  })
})
