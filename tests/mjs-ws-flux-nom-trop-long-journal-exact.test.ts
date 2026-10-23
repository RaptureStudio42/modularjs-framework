// flux (src/mjs-ws/streams.ts) — une demande vers un flux inconnu au nom trop long reçoit une erreur courte au lieu
// d'un reset vide ; la ligne du journal annonçait pourtant « reset vide renvoyé ». Elle dit maintenant ce qui part
import assert from 'node:assert/strict'
import { mjsWs } from '../src/mjs-ws/index.js'
import { MemoryTransport } from '../src/mjs-ws/transport.js'

const tick = (ms = 0) => new Promise<void>(r => setTimeout(r, ms))

async function attendre(cond: () => boolean, ms = 3000): Promise<void> {
  const debut = Date.now()
  while (!cond()) {
    if (Date.now() - debut > ms) throw new Error('condition jamais atteinte en '+ ms +' ms')
    await tick(2)
  }
}

describe('MJS-WS — flux inconnu au nom trop long : le journal dit l\'erreur renvoyée', function () {
  this.timeout(10000)

  for (const [cas, nom, attendu] of [['nom de 300 caractères', 'x'.repeat(300), 'µ:error'], ['nom court', 'inconnu', 'inconnu']] as const) {
    it(cas, async () => {
      const journal: string[] = []
      const transport = new MemoryTransport()
      const app       = mjsWs({ transport, heartbeat: 0, onLog: (_niveau, message) => { journal.push(message) } })
      await app.listen()
      try {
        const ws            = transport.connect({})
        const trames: any[] = []
        ws.onmessage = (ev: any) => trames.push(JSON.parse(String(ev.data)))
        await tick()
        ws.send(JSON.stringify({ t: 'µ:hello', p: { protocol: 1 } }))
        await attendre(() => trames.some(m => m.t === 'µ:welcome'))
        ws.send(JSON.stringify({ t: 'µ:sub-stream', p: { stream: nom } }))
        await attendre(() => trames.some(m => m.t === attendu))
        const ligne = journal.find(l => l.includes('µ:sub-stream'))
        assert.ok(ligne, JSON.stringify(journal))
        if (attendu === 'µ:error') {
          assert.doesNotMatch(ligne!, /reset vide|empty reset/)
          assert.match(ligne!, /200/)
          assert.ok(ligne!.length < 400, 'le nom reste tronqué dans la ligne')
        }
        else assert.match(ligne!, /reset vide|empty reset/)
      }
      finally {
        await app.stop()
      }
    })
  }
})
