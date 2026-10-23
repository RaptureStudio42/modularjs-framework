// Quatre lectures du transpileur coûtaient un temps quadratique sur un texte malformé ou sans rapport : le masque des
// styles relancé à chaque `<style>` avalé par un littéral du HTML (2 000 styles : plus d'une seconde), les accolades
// jamais refermées du gabarit relues chacune jusqu'à la fin du texte (4 000 lignes : plusieurs secondes), les balises
// sans `>` lues chacune jusqu'à la fin, et l'analyse complète d'un script sans `µimport` à chaque composant. Même
// résultat, en un temps linéaire : les bornes ci-dessous laissent une marge large à une machine chargée.

import assert from 'node:assert/strict'
import { transpile } from '../src/transpiler/index.js'
import { findStyleMatches } from '../src/transpiler/sections.js'
import { scanEffectImages } from '../src/transpiler/effect-images.js'
import { rewriteMuImportAst } from '../src/sigils.js'

const duree = async (f: () => unknown): Promise<number> => {
  const t0 = performance.now()
  await f()
  return performance.now() - t0
}

describe('lectures linéaires du transpileur', function () {
  this.timeout(60000)

  it('2 000 `<style>` avalés par un `/*` du HTML : tous trouvés, vite', async () => {
    const src = Array.from({ length: 2000 }, (_, i) => `<p>/* x</p>\n<style name="s${i}">\n/* c */\n.a\n  color: red\n</style>\n`).join('')
    let n = 0
    const ms = await duree(() => { n = findStyleMatches(src, []).matches.length })
    assert.equal(n, 2000)
    assert.ok(ms < 400, `${ms.toFixed(0)} ms`)
  })

  it('4 000 lignes aux accolades jamais refermées : même erreur, vite', async () => {
    const src = '<script>\nx = 1\n</script>\n' + '<p>{a b</p>\n'.repeat(4000)
    let message = ''
    const ms = await duree(async () => {
      try { await transpile(src, { moduleName: 'accolades-ouvertes' }) }
      catch (e: any) { message = e.message }
    })
    assert.match(message, /ligne 4/)
    assert.ok(ms < 2000, `${ms.toFixed(0)} ms`)
  })

  it('8 000 balises sans `>` : vite', async () => {
    const ms = await duree(() => scanEffectImages('<a x="y" '.repeat(8000)))
    assert.ok(ms < 300, `${ms.toFixed(0)} ms`)
  })

  it('script sans µimport : rendu tel quel, sans analyse', async () => {
    const js = Array.from({ length: 3000 }, (_, i) => `const v${i} = f(${i}, 'texte ${i}', { a: ${i} });`).join('\n')
    let sortie = ''
    const ms = await duree(() => { for (let i = 0; i < 40; i++) sortie = rewriteMuImportAst(js, '<script>') })
    assert.equal(sortie, js)
    assert.ok(ms < 250, `${ms.toFixed(0)} ms`)
    assert.equal(rewriteMuImportAst("const m = µimport('./a.js')", '<script>'), "const m = µ._mjs_import(µasset('./a.js'))")
  })
})
