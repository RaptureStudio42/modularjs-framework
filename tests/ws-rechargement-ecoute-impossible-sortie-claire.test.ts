// mjs ws et mjs server, rechargement à chaud : quand le nouveau serveur ne peut pas écouter (port pris entre-temps…), l'ancien est
// déjà arrêté — le processus le dit clairement et s'arrête (code 1) au lieu de rester vivant sans aucun serveur
import assert from 'node:assert/strict'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { runEntryServer } from '../src/cli/ws.js'
import { mjsTmp, sweepRegistered } from './helpers/tmp.js'

after(() => sweepRegistered())

describe('mjs ws — rechargement dont le nouveau serveur ne peut pas écouter', function () {
  this.timeout(20000)

  it('message clair puis sortie en code 1, jamais un processus vivant sans serveur', async function () {
    const root  = mjsTmp('ws-ecoute-impossible')
    const entry = join(root, 'ws.mjs')
    writeFileSync(entry, 'export default {}\n')
    const sorties: number[] = []
    const erreurs: string[] = []
    const vraiExit  = process.exit
    const vraiError = console.error
    let ecoutes     = 0
    let handle: Awaited<ReturnType<typeof runEntryServer>> | undefined
    ;(process as any).exit = (code?: number) => { sorties.push(code ?? 0) }
    console.error = (...a: unknown[]) => { erreurs.push(a.map(String).join(' ')) }
    try {
      handle = await runEntryServer(root, entry, true, {
        readContract: () => ({}),
        buildPlan:    () => ({}),
        create:       () => ({ listen: async () => { if (++ecoutes > 1) throw new Error('listen EADDRINUSE: address already in use 127.0.0.1:4100') }, stop: async () => {} }),
        banner:       () => {},
      })
      writeFileSync(entry, 'export default { v: 2 }\n')
      for (let i = 0; i < 80 && sorties.length === 0 && !erreurs.some((e) => e.includes('EADDRINUSE')); i++) await new Promise((ok) => setTimeout(ok, 50))
      await new Promise((ok) => setTimeout(ok, 100))
    }
    finally {
      process.exit  = vraiExit
      console.error = vraiError
      await handle?.stop()
    }
    assert.equal(ecoutes, 2, 'le rechargement n\'a pas eu lieu :\n' + erreurs.join('\n'))
    assert.deepEqual(sorties, [1], 'processus resté vivant sans serveur :\n' + erreurs.join('\n'))
    assert.ok(erreurs.some((e) => e.includes('EADDRINUSE') && e.includes('relancez')), erreurs.join('\n'))
  })
})
