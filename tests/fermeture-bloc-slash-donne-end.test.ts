// `{/if}` (fermeture d'autres outils) n'existe pas : un bloc se ferme par `{end}`. Le message le dit et cite la
// ligne ; avant, le `/` ouvrait une expression régulière qui avalait le reste du HTML, et l'erreur parlait d'une
// « expression non fermée », loin de la faute.

import assert from 'node:assert/strict'
import { transpile } from '../src/transpiler/index.js'

describe('fermeture de bloc écrite `{/if}`', () => {
  for (const bloc of ['if', 'for', 'each', 'await', 'key']) {
    it(`{/${bloc}} : le message donne {end} et la ligne`, async () => {
      const src = `<script>\n$a = 1\n</script>\n<div>\n{if $a}<p>x</p>{/${bloc}}\n</div>`
      await assert.rejects(transpile(src, { moduleName: 'bloc' }), (err: Error) => {
        assert.match(err.message, new RegExp(`\\{/${bloc}\\}[\\s\\S]*\\{end\\}`))
        assert.match(err.message, /ligne 5/)
        assert.doesNotMatch(err.message, /EXPRESSION NON FERMÉE/)
        return true
      })
    })
  }

  it('témoin : {end} compile', async () => {
    await assert.doesNotReject(transpile('<script>\n$a = 1\n</script>\n{if $a}<p>x</p>{end}', { moduleName: 'bloc' }))
  })
})
