// Références numériques écrites SANS `;` (`&#169`, `&#xA9`) : le navigateur les décode, dans un texte comme dans
// un attribut (la règle des noms suivis d'une lettre, d'un chiffre ou de `=` ne vaut que pour les entités nommées).
// La voie impérative du générateur (texte posé par `createTextNode`, attribut par `setAttribute`, qui ne décodent
// rien) les laissait telles quelles : `&#169 2026` s'affichait « &#169 2026 » au lieu de « © 2026 ».

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { createHarness } from '../src/testing/index.js'
import { decodeHtmlEntities } from '../src/generator/utils.js'
import { generateCreateFnBody } from '../src/generator/paths.js'
import { mjsTmp } from './helpers/tmp.js'

describe('références numériques sans `;` (comme le navigateur)', function () {
  this.timeout(60000)

  // la référence s'arrête au premier caractère qui n'est pas un chiffre de sa base ; `&#` ou `&#x` sans chiffre reste tel quel
  const CAS: Array<[string, string]> = [
    ['&#169 2026', '© 2026'],
    ['&#xA9 2026', '© 2026'],
    ['&#XA9', '©'],
    ['a&#169b', 'a©b'],
    ['&#65x', 'Ax'],
    ['&#x41g', 'Ag'],
    ['&#169;2026', '©2026'],
    ['&#1114112', '�'],
    ['&# &#x &#xg', '&# &#x &#xg'],
  ]

  describe('dans un texte', () => {
    for (const [brut, attendu] of CAS) {
      it(`${brut} → ${JSON.stringify(attendu)}`, () => {
        assert.equal(decodeHtmlEntities(brut, true), attendu)
      })
    }
  })

  describe('dans un attribut (même règle)', () => {
    for (const [brut, attendu] of [...CAS, ['/x?a=1&#38b=2', '/x?a=1&b=2'] as [string, string]]) {
      it(`${brut} → ${JSON.stringify(attendu)}`, () => {
        assert.equal(decodeHtmlEntities(brut), attendu)
      })
    }
  })

  it('voie impérative : texte et attribut statique décodés', () => {
    const body = generateCreateFnBody('<div><p title="&#169 2026">&#xA9 &#65x</p></div>', { forceImperative: true }).body
    assert.match(body, /createTextNode\("© Ax"\)/)
    assert.match(body, /"© 2026"/)
  })

  describe('composant monté', () => {
    let root: string
    let app: any

    before(async () => {
      root = mjsTmp('references-numeriques')
      const srcDir = join(root, 'src')
      mkdirSync(srcDir, { recursive: true })
      writeFileSync(join(srcDir, 'references-numeriques.mjs'), [
        '<script>',
        '$p = Promise.resolve("ok")',
        '</script>',
        '{await $p}',
        '  <p>attente</p>',
        '{success v}',
        '  <p class="t" title="&#169 2026">&#169 {v} &#x41g</p>',
        '{end}',
      ].join('\n'))
      writeFileSync(join(root, 'mjs.config.json'), JSON.stringify({ sourceDir: 'src', outputDir: 'out', manifestPath: 'out/bundle.js' }, null, 2))
      app = await createHarness({ root })
    })

    after(async () => {
      if (app) await app.destroy()
    })

    it('texte et attribut d\'une branche `{success}` (voie impérative)', async () => {
      const c = await app.mount('references-numeriques')
      try {
        await new Promise((r) => setTimeout(r, 20))
        assert.equal(c.text('.t'), '© ok Ag')
        assert.equal(c.find('.t').getAttribute('title'), '© 2026')
      } finally {
        c.destroy()
      }
    })
  })
})
