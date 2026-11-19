// Une ligne du script mise en commentaire sans espace (`#console.log $a`) : Civet lit `#console` comme un nom privé de classe,
// et la construction le refuse ; le message nomme le fichier et la ligne, et rappelle qu'un commentaire s'écrit `#` suivi
// d'une espace (le message brut de l'analyse ne disait ni l'un ni l'autre)

import assert from 'node:assert/strict'
import { transpile } from '../src/transpiler/index.js'

async function refus(src: string): Promise<string> {
  const orig = console.error
  console.error = () => {}
  try {
    await transpile(src, { moduleName: 'cas' })
  }
  catch (err: any) {
    return String(err?.message ?? err)
  }
  finally {
    console.error = orig
  }
  return ''
}

describe('script : # collé à un nom, message avec le fichier, la ligne et la règle', function () {
  this.timeout(60000)

  it('#console.log $a : refusé avec le fichier, la ligne 3 et la forme « # console »', async () => {
    const msg = await refus('<script>\n$a = 1\n#console.log $a\n</script>\n<div>{$a}</div>\n')
    assert.match(msg, /cas/)
    assert.match(msg, /\(ligne 3\)/)
    assert.match(msg, /#console/)
    assert.match(msg, /# console/)
    assert.doesNotMatch(msg, /\[analyzer\] parse error/)
  })

  it('témoin : « # console.log $a », avec une espace, reste un commentaire', async () => {
    assert.equal(await refus('<script>\n$a = 1\n# console.log $a\n</script>\n<div>{$a}</div>\n'), '')
  })
})
