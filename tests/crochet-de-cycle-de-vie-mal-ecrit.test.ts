// Un crochet de cycle de vie mal écrit (`µmounted ->`, `µonDestroy ->`, `µdestory ->`) se construisait sans un
// mot, puis levait à l'exécution (« µ.mounted is not a function »). La construction le refuse, à sa ligne, en
// proposant le crochet le plus proche. Les six crochets, les autres runes et un nom µ sans rapport avec eux se
// construisent comme avant.

import assert from 'node:assert/strict'
import { transpile } from '../src/transpiler/index.js'

const composant = (ligne: string): string => ['<script>', '$n = 0', ligne, '  $n = 1', '</script>', '<p>{$n}</p>'].join('\n')

async function refus(ligne: string): Promise<string> {
  try {
    await transpile(composant(ligne), { moduleName: 'crochet' })
  }
  catch (e: any) {
    return String(e.message)
  }
  return assert.fail(`construction acceptée : ${ligne}`)
}

describe('crochet de cycle de vie mal écrit', function () {
  this.timeout(30000)

  it('`µmounted ->` est refusé à sa ligne et propose `µmount`', async () => {
    const message = await refus('µmounted ->')
    assert.match(message, /crochet\.script:3:1 /)
    assert.match(message, /« µmounted »/)
    assert.match(message, /« µmount »/)
  })

  it('les fautes courantes proposent le bon crochet', async () => {
    assert.match(await refus('µonDestroy ->'), /« µdestroy »/)
    assert.match(await refus('µdestory ->'), /« µdestroy »/)
    assert.match(await refus('µawaken ->'), /« µawake »/)
    assert.match(await refus('µurlchange (p, a)->'), /« µurlChange »/)
    assert.match(await refus('µfail (e, r)->'), /« µfailed »/)
    assert.match(await refus('µ.mounted ->'), /« µmount »/)
  })

  it('les six crochets, µeffect et µevery se construisent comme avant', async () => {
    for (const ligne of ['µmount ->', 'µawake ->', 'µsleep ->', 'µdestroy ->', 'µurlChange (p, a)->', 'µfailed (e, r)->', 'µeffect ->', 'µevery 1000, ->']) {
      await transpile(composant(ligne), { moduleName: 'crochet' })
    }
  })

  it('un nom µ sans rapport avec les crochets, ou hors de leur silhouette, n\'est pas jugé ici', async () => {
    await transpile(composant('µwatch ->'), { moduleName: 'crochet' })
    await transpile(composant('x = µmounted'), { moduleName: 'crochet' })
  })
})
