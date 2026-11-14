// un nom de ModularJS écrit en clé d'objet dans un gestionnaire (`@click={$o = {$x: 1}}`) est refusé sur le texte ÉCRIT, à sa place dans
// le fichier : réécrit (`{$.x: 1}`), il n'était plus une clé, et le message citait ce texte réécrit

import assert from 'node:assert/strict'
import { transpile } from '../src/transpiler/index.js'

async function refus(gabarit: string): Promise<string> {
  try {
    await transpile('<script>\n$x = 1\n$o = 0\n</script>\n' + gabarit + '\n', { moduleName: 'essai' })
  }
  catch (err: any) {
    return String(err?.message ?? err)
  }
  return 'aucun refus'
}

describe('nom de ModularJS en clé d\'objet : refusé sur le texte écrit, à sa place', function () {
  it('gestionnaire `@click={$o = {$x: 1}}` : le message cite le texte écrit, jamais `$.x`', async () => {
    const m = await refus('<button @click={$o = {$x: 1}}>a</button>')
    assert.match(m, /« \$o = \{\$x: 1\} »/, m)
    assert.doesNotMatch(m, /\$\.x/, m)
    assert.match(m, /essai\.mjs:5:\d+/, m)
  })
})
