// `mjs ws` (et `mjs serveur`) relisent leur entrée à chaque modification, par un import dont l'adresse change (`?v=n`). Une entrée
// CommonJS (`ws.js` sans `"type": "module"`, ou `.cjs`) passe par le chargeur CommonJS de Node, qui garde le module en cache
// sous son nom de fichier, quelle que soit l'adresse : l'entrée modifiée n'était jamais relue. Elle l'est maintenant, comme une
// entrée ES.

import assert from 'node:assert/strict'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { importEntryModule } from '../src/cli/ws.js'
import { mjsTmp, sweepRegistered } from './helpers/tmp.js'

after(() => sweepRegistered())

async function versions(nom: string, ecrire: (v: number) => string): Promise<number[]> {
  const root  = mjsTmp('ws-entree-relue')
  const entry = join(root, nom)
  const vues: number[] = []
  for (const v of [1, 2, 3]) {
    writeFileSync(entry, ecrire(v))
    const mod = await importEntryModule(entry, root)
    vues.push((mod.default ?? mod).version)
  }
  return vues
}

describe('mjs ws — entrée relue après modification', () => {
  it('ws.js CommonJS', async () => {
    assert.deepEqual(await versions('ws.js', v => `module.exports = { version: ${v} }\n`), [1, 2, 3])
  })

  it('ws.cjs', async () => {
    assert.deepEqual(await versions('ws.cjs', v => `module.exports = { version: ${v} }\n`), [1, 2, 3])
  })

  it('entrée ES (.mjs) : inchangé', async () => {
    assert.deepEqual(await versions('ws.mjs', v => `export default { version: ${v} }\n`), [1, 2, 3])
  })
})
