// core.ts — chaque refus VOLONTAIRE d'un paquet ou de l'appli (`lobby-denied`, `account-denied`, un code levé par
// un serve()/on()) était journalisé en ERREUR avec sa pile : un client inondait le journal au débit autorisé et
// noyait les vraies erreurs (compteur `erreurs.erreurs` gonflé). Un refus part au client sans rien journaliser ;
// une exception imprévue reste journalisée en erreur.
import assert from 'node:assert/strict'
import { mjsWs, lobbyPackage } from '../src/mjs-ws/index.js'
import { MemoryTransport } from '../src/mjs-ws/transport.js'

const tick = (ms = 0) => new Promise<void>(r => setTimeout(r, ms))

describe('MJS-WS — un refus métier ne remplit pas le journal des erreurs', () => {
  it('75 refus du hall + 3 refus d’un serve() → 0 ligne « error » ; une vraie panne → 1 ligne', async () => {
    const erreurs: Array<{ message: string; meta: any }> = []
    const transport                                      = new MemoryTransport()
    const app                                            = mjsWs({ transport, heartbeat: 0, limits: { rate: 1000, burst: 1000 }, onLog: (niveau, message, meta) => { if (niveau === 'error') erreurs.push({ message, meta }) } })
    app.use(lobbyPackage({ onLog: () => {} }))
    app.serve('commande', () => { throw new Error('commande-refusee') })
    app.serve('panne', () => { throw new TypeError('lecture impossible') })
    await app.listen()
    try {
      const ws            = transport.connect({ url: 'memory://refus' })
      const trames: any[] = []
      ws.onmessage = (ev: any) => trames.push(JSON.parse(ev.data))
      await tick()
      ws.send(JSON.stringify({ t: 'µ:hello', p: { protocol: 1 } }))
      await tick(10)
      // non-membre du hall : chaque lobby:block est refusé (lobby-denied)
      for (let i = 0; i < 75; i++) ws.send(JSON.stringify({ t: 'lobby:block', p: { hall: 'x', identityId: 'y' } }))
      for (let i = 0; i < 3; i++) ws.send(JSON.stringify({ t: 'commande', p: {}, id: 100 + i }))
      await tick(50)
      assert.equal(erreurs.length, 0, 'aucune ligne error pour des refus volontaires')
      assert.equal(app.stats().erreurs.erreurs, 0)
      assert.equal(trames.filter(f => f.t === 'µ:error' && f.p?.message === 'lobby-denied').length, 75, 'le client reçoit toujours chaque refus')
      assert.equal(trames.filter(f => f.t === 'µ:ack' && f.e === true && f.p === 'commande-refusee').length, 3)

      ws.send(JSON.stringify({ t: 'panne', p: {}, id: 200 }))
      await tick(10)
      assert.equal(erreurs.length, 1, 'une exception imprévue reste une erreur journalisée')
      assert.ok(erreurs[0].meta?.err instanceof TypeError, 'avec l’exception (et sa pile) pour la retrouver')
    } finally {
      await app.stop()
    }
  })
})
