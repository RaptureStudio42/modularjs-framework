// Un composant auto-fermé dont une expression d'attribut contient `>` (`<mjs-badge show={$count > 0} />`, un
// gestionnaire `@change={(v) => …}`) se construit comme sa forme fermée : avant, il était refusé pour un
// « déséquilibre structurel » dont le message proposait d'écrire exactement ce qui était écrit.

import assert from 'node:assert/strict'
import { transpile } from '../src/transpiler/index.js'

describe('composant auto-fermé avec > dans une expression', () => {
  it('<mjs-badge show={$count > 0} /> : même sortie que la forme fermée', async () => {
    const script = '<script>\n$count = 1\n</script>\n'
    const auto = await transpile(script + '<mjs-badge show={$count > 0} />', { moduleName: 'badge' })
    const ferme = await transpile(script + '<mjs-badge show={$count > 0}></mjs-badge>', { moduleName: 'badge' })
    assert.equal(auto.output, ferme.output)
  })

  it('gestionnaire fléché @change={(v) => …} sur un composant auto-fermé : accepté', async () => {
    await assert.doesNotReject(transpile('<script>\nf = (v) -> v\n</script>\n<mjs-x @change={(v) => f(v)} />', { moduleName: 'fleche' }))
  })
})
