// Test de régression : `minifyJs()` (src/bundler/minify.ts) retire toute ligne ISOLÉE
// « µ.debug = … » par expression régulière SANS masquer les chaînes/gabarits au préalable — une
// ligne de DOCUMENTATION montrant comment activer le mode debug, écrite à l'intérieur d'un
// template literal multiligne (`const aide = \`...µ.debug = true...\``), matchait pareil : le
// texte affiché disparaissait en silence à la minification de production, alors qu'il survit en
// dev (divergence dev/prod silencieuse).
//
// Fix : le retrait se décide sur une vue MASQUÉE (chaînes/gabarits/commentaires blanchis, même
// longueur) — seules les VRAIES lignes de code sont retirées, jamais le contenu d'un gabarit.

import assert from 'node:assert/strict'
import { minifyJs } from '../src/bundler/minify.js'

describe('minifyJs() — retrait de la ligne isolée µ.debug = … (préserve les gabarits)', () => {
  it('une VRAIE ligne isolée "µ.debug = true;" est retirée (comportement inchangé)', async () => {
    const source = 'µ.debug = true;\nconsole.log(1);'
    const { code } = await minifyJs(source, { force: true })
    assert.equal(code.includes('µ.debug'), false, `la ligne de code doit être retirée : ${code}`)
  })

  it('« µ.debug = true » DANS un gabarit multiligne (texte de documentation) survit à la minification', async () => {
    const source = [
      'const aide = `',
      'Pour activer le mode debug dans la console :',
      'µ.debug = true',
      '`;',
      'globalThis.__aide = aide;',
    ].join('\n')
    const { code } = await minifyJs(source, { force: true })
    // Substring ASCII, jamais `µ.debug` littéral : esbuild échappe par défaut les caractères
    // non-ASCII d'un gabarit minifié (`charset` par défaut) — la ligne de doc survit bel et
    // bien, juste réencodée (`\xB5.debug = true`), ce n'est pas ce que ce test vérifie.
    assert.match(code, /\.debug = true/, `le texte du gabarit doit survivre : ${code}`)
    assert.match(code, /Pour activer le mode debug/, `la ligne de doc voisine ne doit pas non plus disparaître : ${code}`)
  })
})
