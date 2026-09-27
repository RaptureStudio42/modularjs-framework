// preprocessHtml masquait les blocs <pre>/<code> et les commentaires HTML avant de réécrire les
// directives d'attribut (@preload, @callback, @confirm, @title…), mais jamais les expressions
// `{…}` : un exemple de doc affiché tel quel dans une chaîne — `{'Exemple : @preload="hover"…'}`
// — se faisait réécrire comme un VRAI attribut (texte affiché corrompu), et une chaîne qui
// MONTRE la forme refusée — `{'…@callback={foo}…'}` — faisait planter la compilation du reste
// de la page pour une raison qui n'existe que dans du texte.

import assert from 'node:assert/strict'
import { transpile } from '../src/transpiler/index.ts'

describe('directives d\'attribut : une chaîne d\'interpolation {…} est inerte', function () {
  this.timeout(8000)

  it('`{\'Exemple : @preload="hover"…\'}` reste un texte littéral, jamais réécrit en data-mjs-preload', async function () {
    const src = `<p>{'Exemple : @preload="hover" active le chargement anticipe.'}</p>\n<script>\n</script>`
    const { output } = await transpile(src, { moduleName: 'directive-interp-preload' })
    assert.ok(output.includes('Exemple : @preload="hover" active le chargement anticipe.'), 'le texte cité doit survivre tel quel')
    assert.ok(!output.includes('data-mjs-preload'), 'aucune réécriture ne doit avoir lieu à l\'intérieur de la chaîne')
  })

  it('`{\'…@callback={foo}…\'}` (contre-exemple documentaire) ne fait pas planter la compilation', async function () {
    const src = `<p>{'Ne pas ecrire @callback={foo}, ca leve une erreur de compilation.'}</p>\n<script>\n</script>`
    await assert.doesNotReject(() => transpile(src, { moduleName: 'directive-interp-callback' }))
  })

  it('`{\'@title="texte"\'}` cité en exemple reste un texte littéral, jamais réécrit en mjs-title', async function () {
    const src = `<p>{'Pose @title="texte" sur n\\'importe quelle balise.'}</p>\n<script>\n</script>`
    const { output } = await transpile(src, { moduleName: 'directive-interp-title' })
    assert.ok(!output.includes('mjs-title='), 'aucune réécriture ne doit avoir lieu à l\'intérieur de la chaîne')
  })

  it('non-régression — un VRAI `@preload="hover"` sur une vraie balise est toujours réécrit', async function () {
    const src = '<a href="/x" @preload="hover">lien</a>'
    const { output } = await transpile(src, { moduleName: 'directive-interp-preload-reel' })
    assert.match(output, /data-mjs-preload=['"]hover['"]/, 'un vrai attribut doit toujours être réécrit')
  })
})
