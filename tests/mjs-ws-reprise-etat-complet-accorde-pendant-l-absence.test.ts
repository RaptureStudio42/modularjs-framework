// Reprise de session : une garde asynchrone qui accepte un abonnement pendant l'absence du client (connexion parquée)
// l'abonnait, mais son état complet (le `reset` du flux) était jeté du tampon de reprise comme un simple delta. Repris
// sans rien de ce flux, le client appliquait le delta suivant sur un état vide, sans voir le trou. L'état complet accordé
// pendant l'absence est désormais rejoué à la reprise ; les deltas restent couverts par le rattrapage du client
import assert from 'node:assert/strict'
import { mjsWs } from '../src/mjs-ws/index.js'
import { MemoryTransport } from '../src/mjs-ws/transport.js'

const tick = (ms = 0) => new Promise<void>(r => setTimeout(r, ms))

describe('MJS-WS — reprise de session : état complet accordé pendant l’absence', function () {
  this.timeout(10000)

  it('le reset accordé pendant la grâce est rejoué à la reprise, et le client suit le flux sans état faux', async () => {
    const transport = new MemoryTransport()
    const app = mjsWs({ transport, heartbeat: 0, onLog: () => {}, resume: { grace: 30000 } })
    let repondre: ((ok: boolean) => void) | null = null
    const partie = app.stream('partie', { canSubscribe: () => repondre ? true : new Promise<boolean>(r => { repondre = r }) })
    partie.add('avant', 1)
    await app.listen()
    // client du framework : seq contigu, trou (dès 0 après un reset numéroté) → µ:resync, reset accepté partout
    const client = { lastSeq: 0, seqKnown: false, resyncing: false, store: new Map<string, unknown>(), session: null as unknown, trames: [] as string[] }
    function brancher(): any {
      const ws = transport.connect({ url: 'ws://joueur/' })
      ws.onmessage = (ev: any) => {
        const f = JSON.parse(ev.data)
        if (f.t === 'µ:welcome') { client.session = f.p.session; client.trames.push(f.p.resumed ? 'reprise' : 'accueil'); return }
        if (f.t !== 'partie') return
        client.trames.push(f.p.op + (f.p.key ? ':' + f.p.key : ''))
        if (f.p.op === 'reset') { client.resyncing = false; client.lastSeq = f.seq ?? 0; client.seqKnown = f.seq != null; client.store = new Map(Object.entries(f.p.values)); return }
        if (client.lastSeq && f.seq <= client.lastSeq) return
        if ((client.lastSeq || client.seqKnown) && f.seq > client.lastSeq + 1) { if (!client.resyncing) { client.resyncing = true; ws.send(JSON.stringify({ t: 'µ:resync', p: { stream: 'partie', from: client.lastSeq } })) } return }
        client.resyncing = false
        client.lastSeq = f.seq
        if (f.p.op === 'add') client.store.set(f.p.key, f.p.value)
      }
      ws.onopen = () => ws.send(JSON.stringify({ t: 'µ:hello', p: client.session ? { protocol: 1, session: client.session } : { protocol: 1 } }))
      return ws
    }
    try {
      let ws = brancher()
      await tick(20)
      ws.send(JSON.stringify({ t: 'µ:sub-stream', p: { stream: 'partie' } }))
      await tick(10)
      ws.close()                       // coupure : la connexion est parquée, la garde n'a pas encore répondu
      await tick(10)
      repondre!(true)                  // accordé pendant l'absence
      await tick(10)
      partie.add('pendant-l-absence', 2)
      await tick(10)
      ws = brancher()                  // reprise de session
      await tick(30)
      partie.add('apres', 3)
      await tick(30)
      assert.deepEqual(client.trames.slice(0, 3), ['accueil', 'reprise', 'reset'], 'l’état complet accordé pendant l’absence est rejoué à la reprise')
      assert.deepEqual([...client.store.keys()], Object.keys(partie.snapshot()), 'le client suit le flux, au bon état')
      assert.equal(client.resyncing, false)
    } finally {
      await app.stop()
    }
  })
})
