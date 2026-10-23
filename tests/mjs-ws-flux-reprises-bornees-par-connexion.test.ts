// Une connexion qui quitte un salon en suivant un flux réservé à ce salon garde de quoi retrouver ce flux à son retour.
// Cette reprise restait jusqu'au retour ou à la déconnexion : une connexion qui visite des parties sans fin (un flux par
// partie, détruit en fin de partie) en accumulait une par partie, environ 400 octets chacune, jusqu'à sa déconnexion.
// Seules les reprises des 50 derniers salons quittés sont gardées
import assert from 'node:assert/strict'
import { mjsWs } from '../src/mjs-ws/index.js'
import { MemoryTransport } from '../src/mjs-ws/transport.js'

const tick = (ms = 0) => new Promise<void>(r => setTimeout(r, ms))

describe('MJS-WS — reprises des flux au retour dans un salon : bornées par connexion', function () {
  this.timeout(20000)

  it('60 parties quittées : le retour dans l’une des 50 dernières rend son flux, la plus ancienne est oubliée', async () => {
    const transport = new MemoryTransport()
    const app = mjsWs({ transport, heartbeat: 0, onLog: () => {}, limits: { rate: 10000, burst: 10000 } })   // 180 trames d'affilée
    const parties = Array.from({ length: 60 }, (_, i) => app.stream('partie-' + i, { room: 'partie-' + i }))
    await app.listen()
    try {
      const ws = transport.connect({ url: 'ws://spectateur/' })
      const trames: any[] = []
      ws.onmessage = (ev: any) => trames.push(JSON.parse(ev.data))
      const envoyer = (t: string, p: unknown) => ws.send(JSON.stringify({ t, p }))
      await tick()
      envoyer('µ:hello', { protocol: 1 })
      await tick(10)
      for (let i = 0; i < 60; i++) {
        envoyer('µ:join', { room: 'partie-' + i })
        envoyer('µ:sub-stream', { stream: 'partie-' + i })
        envoyer('µ:leave', { room: 'partie-' + i })
        await tick(2)
      }
      await tick(20)
      const instantanes = (nom: string, depuis: number) => trames.slice(depuis).filter(f => f.t === nom && f.p?.op === 'reset').length
      let avant = trames.length
      envoyer('µ:join', { room: 'partie-59' })
      await tick(20)
      assert.equal(instantanes('partie-59', avant), 1, 'salon quitté récemment : flux rendu au retour')
      avant = trames.length
      envoyer('µ:join', { room: 'partie-0' })
      await tick(20)
      assert.equal(instantanes('partie-0', avant), 0, 'salon quitté il y a 60 salons : reprise oubliée')
      parties[0].add('apres', 1)
      await tick(10)
      assert.deepEqual(trames.slice(avant).filter(f => f.t === 'partie-0'), [], 'la reprise oubliée ne rend rien')
    } finally {
      await app.stop()
    }
  })
})
