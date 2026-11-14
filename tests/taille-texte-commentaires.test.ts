// la taille du texte adaptable : une déclaration `font-size` en px précédée ou suivie d'un commentaire (le CSS pur des
// feuilles partagées et de mjs_root garde ses commentaires), ou placée après une règle imbriquée, se convertit comme les
// autres ; un commentaire ou une chaîne qui citent une taille restent tels quels

import assert from 'node:assert/strict'
import { fontSizeSettings, rewriteFontSizes } from '../src/transpiler/font-size.js'

const reglages = fontSizeSettings(true)!

const CAS: Array<[string, string, string[]]> = [
  ['.b { /* note */ font-size: 50px; }', '.b { /* note */ font-size: var(--mjs-fs-50); }', ['50']],
  ['.b{color:red;/* titre */font-size:30px}', '.b{color:red;/* titre */font-size:var(--mjs-fs-30)}', ['30']],
  ['.b { font-size: 50px /* titre */; }', '.b { font-size: var(--mjs-fs-50) /* titre */; }', ['50']],
  ['.b{font-size:30px/* a */!/* b */important}', '.b{font-size:var(--mjs-fs-30)/* a */!/* b */important}', ['30']],
  ['.a { .b { color: red } font-size: 50px }', '.a { .b { color: red } font-size: var(--mjs-fs-50) }', ['50']],
]

describe('taille du texte adaptée à l\'écran — commentaires et règles imbriquées', () => {
  for (const [entree, sortie, tailles] of CAS) {
    it(`${entree} → ${sortie}`, () => {
      assert.deepEqual(rewriteFontSizes(entree, reglages), { css: sortie, sizes: tailles })
    })
  }

  it('témoins : un commentaire et une chaîne qui citent une taille restent tels quels', () => {
    const css = '/* a{font-size:30px} */b{content:"x;font-size:30px"}'
    assert.deepEqual(rewriteFontSizes(css, reglages), { css, sizes: [] })
  })
})
