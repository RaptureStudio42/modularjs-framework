// transpile() d'un gabarit dont les accolades ne se referment pas (fichier en cours de frappe) : chaque `{` relisait le
// reste du texte, un temps quadratique sur le composant entier — 4 000 lignes `<p>{a b</p>` coûtaient plus de trente
// secondes. Le coût reste du même ordre que celui du même gabarit aux accolades refermées, avec ou sans l'alias de
// symbole (`sigil: 'mjs'`), et le refus garde son message : l'accolade ouverte et sa ligne.

import assert from 'node:assert/strict'
import { transpile } from '../src/transpiler/index.js'

const tete = `<script>\nx = mjs.state\n</script>\n<p>mjs.asset('a.png')</p>\n`

async function mesurer(src: string, sigil?: string): Promise<{ ms: number, message: string }> {
  const t0 = performance.now()
  let message = ''
  try { await transpile(src, { moduleName: 'accolades-ouvertes', sigil }) }
  catch (e: any) { message = String(e?.message ?? e) }
  return { ms: performance.now() - t0, message }
}

describe('transpile() — gabarit aux accolades non refermées : temps linéaire', function () {
  this.timeout(120000)

  for (const sigil of [undefined, 'mjs']) {
    it(`4 000 lignes aux accolades ouvertes${sigil ? ', alias mjs' : ''} : du même ordre que refermées, même refus`, async () => {
      // tour de chauffe : chargement des compilateurs hors mesure
      await mesurer(tete + '<p>{a} b</p>\n', sigil)
      const fermees  = await mesurer(tete + '<p>{a} b</p>\n'.repeat(4000), sigil)
      const ouvertes = await mesurer(tete + '<p>{a b</p>\n'.repeat(4000), sigil)
      assert.match(ouvertes.message, /EXPRESSION NON FERMÉE/)
      assert.match(ouvertes.message, /`\{` ouvert ligne 5/)
      // marge large (machine chargée) : quadratique, la lecture prenait des dizaines de secondes
      assert.ok(ouvertes.ms < Math.max(3000, 15 * fermees.ms), `${Math.round(ouvertes.ms)} ms contre ${Math.round(fermees.ms)} ms refermées`)
    })
  }
})
