// Entités HTML héritées écrites SANS `;` (`&amp`, `&copy`, `&eacute`…) : le navigateur les décode (les
// 106 noms historiques du standard HTML), dans un texte comme dans un attribut — sauf, dans un
// attribut, quand le nom est suivi d'une lettre, d'un chiffre ou de `=` (`?a=1&copy=2` reste tel quel).
// La voie impérative du générateur (texte posé par `createTextNode`, attribut par `setAttribute`, qui
// ne décodent rien) les laissait telles quelles : `a &amp b` s'affichait « a &amp b » au lieu de « a & b »,
// alors que la même page construite par clonage (analyseur du navigateur) affichait « a & b ».

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { createHarness } from '../src/testing/index.js'
import { decodeHtmlEntities } from '../src/generator/utils.js'
import { generateCreateFnBody } from '../src/generator/paths.js'
import { mjsTmp } from './helpers/tmp.js'

describe('entités héritées sans `;` (comme le navigateur)', function () {
  this.timeout(60000)

  describe('dans un texte', () => {
    const CAS: Array<[string, string]> = [
      ['a &amp b', 'a & b'],
      ['&copy 2026', '© 2026'],
      ['&copy2026', '©2026'],
      ['&eacutex', 'éx'],
      ['&lt3', '<3'],
      ['&AMP&GT', '&>'],
      ['&notit;', '¬it;'],
      ['&notin;', '∉'],
      ['&ampx;', '&x;'],
      ['&nbsp;&nbsp', '  '],
      ['&frac12', '½'],
      ['&foo &Amp &hellip', '&foo &Amp &hellip'],
      ['&amp;amp;', '&amp;'],
    ]
    for (const [brut, attendu] of CAS) {
      it(`${brut} → ${attendu}`, () => {
        assert.equal(decodeHtmlEntities(brut, true), attendu)
      })
    }
  })

  describe('dans un attribut', () => {
    const CAS: Array<[string, string]> = [
      ['&copy 2026', '© 2026'],
      ['/x?a=1&copy=2', '/x?a=1&copy=2'],
      ['&copy2026', '&copy2026'],
      ['&notit', '&notit'],
      ['&ampx;', '&ampx;'],
      ['&amp_b', '&_b'],
      ['fin &not', 'fin ¬'],
      ['&amp;x', '&x'],
      ['&copy;2026', '©2026'],
    ]
    for (const [brut, attendu] of CAS) {
      it(`${brut} → ${attendu}`, () => {
        assert.equal(decodeHtmlEntities(brut), attendu)
      })
    }
  })

  it('voie impérative : texte et attribut statique décodés comme par le navigateur', () => {
    const body = generateCreateFnBody('<div><p title="&copy 2026" data-u="?a=1&copy=2">a &amp b &eacutet&eacute</p></div>', { forceImperative: true }).body
    assert.match(body, /createTextNode\("a & b été"\)/)
    assert.match(body, /"© 2026"/)
    assert.match(body, /"\?a=1&copy=2"/)
  })

  describe('composant monté', () => {
    let root: string
    let app: any

    before(async () => {
      root = mjsTmp('entites-heritees')
      const srcDir = join(root, 'src')
      mkdirSync(srcDir, { recursive: true })
      writeFileSync(join(srcDir, 'entites-heritees.mjs'), [
        '<script>',
        '$n = 1',
        '$p = Promise.resolve("ok")',
        '</script>',
        '{await $p}',
        '  <p>attente</p>',
        '{success v}',
        '  <p class="t" title="&copy 2026">Dupont &amp Fils &copy {v} {$n}</p>',
        '{end}',
      ].join('\n'))
      writeFileSync(join(root, 'mjs.config.json'), JSON.stringify({ sourceDir: 'src', outputDir: 'out', manifestPath: 'out/bundle.js' }, null, 2))
      app = await createHarness({ root })
    })

    after(async () => {
      if (app) await app.destroy()
    })

    // branche `{success}` qui porte des mises à jour : construite par la voie impérative
    it('le texte et l\'attribut affichent les caractères, pas les entités', async () => {
      const c = await app.mount('entites-heritees')
      try {
        await new Promise((r) => setTimeout(r, 20))
        assert.equal(c.text('.t'), 'Dupont & Fils © ok 1')
        assert.equal(c.find('.t').getAttribute('title'), '© 2026')
      } finally {
        c.destroy()
      }
    })
  })
})
