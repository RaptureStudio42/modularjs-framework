// core.ts — chaque connexion refusée pour son origine (ou au-delà d'un plafond) écrivait une ligne « warn »
// contenant l'en-tête Origin fourni par le visiteur, sans aucune limite : 300 refus = 300 lignes et 1,8 million
// de caractères journalisés. Le journal est regroupé : une ligne au plus par minute et par motif, la ligne
// suivante annonce combien de refus semblables ont été tus ; l'Origin est tronquée ; les compteurs restent exacts.
import assert from 'node:assert/strict'
import { mjsWs } from '../src/mjs-ws/index.js'
import { MemoryTransport } from '../src/mjs-ws/transport.js'

const tick = (ms = 0) => new Promise<void>(r => setTimeout(r, ms))

describe('MJS-WS — connexions refusées : un journal regroupé, une Origin tronquée', () => {
  it('origine refusée : 300 refus → 1 ligne courte ; une minute plus tard, la ligne suivante compte les refus tus', async () => {
    const lignes: string[] = []
    const transport        = new MemoryTransport()
    const app              = mjsWs({ transport, heartbeat: 0, verifyOrigin: ['https://site.test'], onLog: (niveau, message) => { if (niveau === 'warn') lignes.push(message) } })
    await app.listen()
    const vraiNow = Date.now
    try {
      const avant  = lignes.length
      const longue = 'https://' + 'a'.repeat(6000) + '.example'
      for (let i = 0; i < 300; i++) transport.connect({ origin: longue })
      await tick(20)
      const nouvelles = lignes.slice(avant)
      assert.equal(nouvelles.length, 1, 'une seule ligne pour 300 refus de suite')
      assert.ok(nouvelles[0].length < 400, `Origin tronquée (ligne de ${nouvelles[0].length} caractères)`)
      assert.equal(app.stats().connexions.refuseesOrigine, 300, 'le compteur, lui, voit chaque refus')

      const decalage = 61000
      Date.now = () => vraiNow() + decalage
      transport.connect({ origin: 'https://ailleurs.test' })
      await tick(20)
      const suite = lignes.slice(avant + 1)
      assert.equal(suite.length, 1, 'la minute écoulée, une nouvelle ligne')
      assert.match(suite[0], /299/, 'elle annonce les 299 refus tus depuis la précédente')
      assert.match(suite[0], /ailleurs\.test/)
    } finally {
      Date.now = vraiNow
      await app.stop()
    }
  })

  it('plafond global atteint : 50 refus → 1 ligne', async () => {
    const lignes: string[] = []
    const transport        = new MemoryTransport()
    const app              = mjsWs({ transport, heartbeat: 0, limits: { maxConnections: 1 }, onLog: (niveau, message) => { if (niveau === 'warn') lignes.push(message) } })
    await app.listen()
    try {
      transport.connect({ url: 'memory://plafond' })
      const avant = lignes.length
      for (let i = 0; i < 50; i++) transport.connect({ url: 'memory://plafond' })
      await tick(20)
      assert.equal(lignes.length - avant, 1)
      assert.equal(app.stats().connexions.refuseesPlafond, 50)
    } finally {
      await app.stop()
    }
  })
})
