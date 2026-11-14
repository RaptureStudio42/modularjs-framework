// une expression du gabarit que l'arbre ne lit pas est refusée à la construction, avec une raison écrite pour l'auteur :
// `{µ$count}` (l'état universel n'est déclaré que dans le <script> ; affiché, il levait « µ$ is not defined »), un contexte
// écrit autrement que par `§x = valeur` (`{§x += 1}`)

import { strict as assert } from 'node:assert'
import { transpile } from '../src/transpiler/index.js'

const refus = async (src: string): Promise<string> => {
  try {
    await transpile(src, { moduleName: 'expression-refusee', defaultScriptLang: 'civet' })
  }
  catch (e) {
    return (e as Error).message
  }
  return ''
}

describe('expressions du gabarit refusées à la construction', () => {
  it('`{µ$count}` : refusé, l\'état universel se lit dans le <script>', async function () {
    this.timeout(8000)
    const message = await refus('<script>\nµ$count = 0\ninc = -> µ$count++\n</script>\n<button @click={inc()}>{µ$count}</button>\n')
    assert.match(message, /« µ\$count » — \S+:\d+:\d+ — ne se lit pas dans le gabarit : l'état universel ne se lit et ne s'écrit que dans le <script>/)
    assert.equal(await refus('<script>\nµ$count = 0\ninc = -> µ$count++\n</script>\n<button @click={inc()}>+</button>\n'), '')
  })

  it('contexte écrit avec `+=` : la raison dit ce qui est écrit et quoi écrire à la place', async function () {
    this.timeout(8000)
    const contexte = await refus('<p>{§x += 1}</p>\n')
    assert.match(contexte, /« §x » : contexte `§x` écrit autrement que par `§x = valeur`.*écrivez `§x = §x \+ 1`/)
    assert.doesNotMatch(contexte, /ancienne lecture|repli|carte/)
  })
})
