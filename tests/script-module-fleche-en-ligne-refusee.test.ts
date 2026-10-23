// `<script module>` : une flèche écrite sur une seule ligne dont le corps affecte un if/then/else
// (`f = => x = if a then 'b' else 'c'`) compilait SANS erreur en JavaScript invalide (Civet sort sa variable temporaire
// derrière la flèche, `() =>let ref;…`) : construction verte, page morte au chargement. Même refus clair que dans le
// <script>, qui dit quoi écrire

import assert from 'node:assert/strict'
import { transpile } from '../src/transpiler/index.js'

const composant = (module: string) => `<script module>\na = 1\nx = ''\n${module}\n</script>\n<script>\n$n = 0\n</script>\n<p>{$n}</p>\n`

describe('<script module> : flèche en ligne qui affecte un if/then/else', () => {
  it('refus clair, qui nomme le <script module> et l\'écriture qui passe', async () => {
    await assert.rejects(transpile(composant("f = => x = if a then 'b' else 'c'"), { moduleName: 'module-fleche' }), (e: any) => {
      assert.match(e.message, /le <script module> contient une flèche écrite sur une seule ligne/)
      assert.match(e.message, /f = => x = \(if a then 'b' else 'c'\)/)
      return true
    })
  })

  it('les écritures conseillées passent, sans la variable temporaire sortie de la flèche', async () => {
    for (const corps of ["f = => x = (if a then 'b' else 'c')", "f = =>\n  x = if a then 'b' else 'c'"]) {
      const r = await transpile(composant(corps), { moduleName: 'module-fleche' })
      assert.doesNotMatch(r.output, /=>\s*let ref\d*;/, corps)
    }
  })

  it('le <script> garde son message', async () => {
    await assert.rejects(transpile("<script>\na = 1\nx = ''\nf = => x = if a then 'b' else 'c'\n$n = 0\n</script>\n<p>{$n}</p>\n", { moduleName: 'module-fleche' }), /le <script> contient une flèche écrite sur une seule ligne/)
  })
})
