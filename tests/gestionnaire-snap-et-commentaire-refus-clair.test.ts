// `@click={$x =: $y # note}` : le commentaire avalait la fin de la valeur enveloppée par `=:`, et la construction rendait l'erreur
// brute de Civet ; elle refuse maintenant avec la ligne et la forme à écrire (sans commentaire dans le gestionnaire)

import assert from 'node:assert/strict'
import { transpile } from '../src/transpiler/index.js'

async function construire(src: string): Promise<{ msg: string, out: string }> {
  const e = console.error, w = console.warn
  console.error = console.warn = () => {}
  try {
    const r: any = await transpile(src, { moduleName: 'cas' })
    return { msg: '', out: String(r.output) }
  }
  catch (err: any) {
    return { msg: String(err?.message ?? err), out: '' }
  }
  finally {
    console.error = e
    console.warn = w
  }
}

const S = '<script>\n$x = 1\n$y = 2\n</script>\n'

describe('gestionnaire : =: suivi d\'un commentaire, refus clair', function () {
  this.timeout(60000)

  it('@click={$x =: $y # note} : refusé avec sa place (ligne 5) et le commentaire nommé', async () => {
    const r = await construire(S + '<button @click={$x =: $y # note}>b</button>\n')
    assert.match(r.msg, /« =: »/, r.msg)
    assert.match(r.msg, /commentaire/, r.msg)
    assert.match(r.msg, /\.mjs:5:/, r.msg)
    assert.doesNotMatch(r.msg, /Failed to parse/, r.msg)
  })

  it('témoin : @click={$x =: $y} se construit', async () => {
    assert.equal((await construire(S + '<button @click={$x =: $y}>b</button>\n')).msg, '')
  })
})
