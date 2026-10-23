// Grappe (deux process, adaptateur partagé) : la partie finie est détruite sur chaque process (`destroy()`), puis rouvre sous
// le même nom. Le compteur partagé continuait, le flux recréé repartait de zéro : le premier delta de la nouvelle partie
// restait bloqué deux secondes dans le tampon de réordonnancement, avec un avertissement « trou », sur chaque process ; et
// un client à jour de l'ancienne partie qui se reconnectait recevait les deltas neufs par-dessus l'ancien état, sans jamais
// être recalé. Le flux recréé reprend la numérotation de l'ancien, et un rejeu demandé depuis l'ancienne partie reçoit
// l'état complet de la nouvelle
import assert from 'node:assert/strict'
import { mjsWs, MemoryAdapter, createMemoryAdapterBus } from '../src/mjs-ws/index.js'
import { MemoryTransport } from '../src/mjs-ws/transport.js'

const tick = (ms = 0) => new Promise<void>(r => setTimeout(r, ms))

describe('MJS-WS — grappe : flux détruit sur chaque process puis redéclaré', function () {
  this.timeout(10000)

  it('premier delta de la nouvelle partie sans attente ni avertissement ; client de l’ancienne partie recalé', async () => {
    const bus = createMemoryAdapterBus()
    const avertissements: string[] = []
    const tA = new MemoryTransport()
    const tB = new MemoryTransport()
    const A = mjsWs({ transport: tA, heartbeat: 0, adapter: new MemoryAdapter({ bus, processId: 'A', onLog: () => {} }), onLog: (niveau: string, m: string) => { if (niveau === 'warn') avertissements.push('A : ' + m) } })
    const B = mjsWs({ transport: tB, heartbeat: 0, adapter: new MemoryAdapter({ bus, processId: 'B', onLog: () => {} }), onLog: (niveau: string, m: string) => { if (niveau === 'warn') avertissements.push('B : ' + m) } })
    let hA = A.stream('partie', { public: true })
    let hB = B.stream('partie', { public: true })
    await A.listen()
    await B.listen()
    // client du framework branché sur A : seq contigu, trou (dès 0 après un reset numéroté) → µ:resync, reset accepté partout, µ:resync depuis le dernier
    // numéro vu à chaque accueil
    const client = { lastSeq: 0, seqKnown: false, resyncing: false, store: new Map<string, unknown>() }
    function brancher(): any {
      const ws = tA.connect({ url: 'ws://joueur/' })
      ws.onmessage = (ev: any) => {
        const f = JSON.parse(ev.data)
        if (f.t === 'µ:welcome') { ws.send(JSON.stringify(client.lastSeq ? { t: 'µ:resync', p: { stream: 'partie', from: client.lastSeq } } : { t: 'µ:sub-stream', p: { stream: 'partie' } })); return }
        if (f.t !== 'partie') return
        if (f.p.op === 'reset') { client.resyncing = false; client.lastSeq = f.seq ?? 0; client.seqKnown = f.seq != null; client.store = new Map(Object.entries(f.p.values)); return }
        if (client.lastSeq && f.seq <= client.lastSeq) return
        if ((client.lastSeq || client.seqKnown) && f.seq > client.lastSeq + 1) { if (!client.resyncing) { client.resyncing = true; ws.send(JSON.stringify({ t: 'µ:resync', p: { stream: 'partie', from: client.lastSeq } })) } return }
        client.resyncing = false
        client.lastSeq = f.seq
        if (f.p.op === 'add') client.store.set(f.p.key, f.p.value)
      }
      ws.onopen = () => ws.send(JSON.stringify({ t: 'µ:hello', p: { protocol: 1 } }))
      return ws
    }
    try {
      let ws = brancher()
      await tick(30)
      hB.add('ancien-1', 1); hB.add('ancien-2', 2); hA.add('ancien-3', 3)
      await tick(50)
      assert.deepEqual([...client.store.keys()].sort(), ['ancien-1', 'ancien-2', 'ancien-3'])   // deux producteurs : l'ordre des numéros varie
      // fin de partie : destroy() sur chaque process, puis la même partie rouvre sous le même nom
      hA.destroy(); hB.destroy()
      hA = A.stream('partie', { public: true }); hB = B.stream('partie', { public: true })
      await tick(10)
      hB.add('neuf-1', 10)
      await tick(50)
      assert.deepEqual(Object.keys(hA.snapshot()), ['neuf-1'], 'le premier delta de la nouvelle partie arrive sans attente')
      assert.deepEqual(avertissements, [], 'aucun trou annoncé')
      // coupure réseau du client, reconnexion : il redemande depuis le dernier numéro de l'ancienne partie
      ws.close()
      await tick(20)
      ws = brancher()
      await tick(50)
      hA.add('neuf-2', 11)
      await tick(50)
      assert.deepEqual([...client.store.keys()], ['neuf-1', 'neuf-2'], 'le client est recalé sur la nouvelle partie')
      assert.deepEqual(Object.keys(hB.snapshot()), ['neuf-1', 'neuf-2'])
      assert.deepEqual(avertissements, [])
    } finally {
      await A.stop()
      await B.stop()
    }
  })
})
