// `destroy()` retire un flux du registre, mais la poignée gardée par l'application écrivait encore : ses add / update /
// remove / reset partaient aux connexions abonnées avant la destruction, et un second `destroy()` de l'ancienne poignée
// retirait le flux recréé entre-temps sous le même nom. Après `destroy()`, l'ancienne poignée n'agit plus : ses écritures
// sont sans effet (un avertissement dans le journal, une fois), son `destroy()` ne touche plus au registre
import assert from 'node:assert/strict'
import { mjsWs } from '../src/mjs-ws/index.js'
import { MemoryTransport } from '../src/mjs-ws/transport.js'

const tick = (ms = 0) => new Promise<void>(r => setTimeout(r, ms))

async function demarrer() {
  const transport = new MemoryTransport()
  const journal: string[] = []
  const app = mjsWs({ transport, heartbeat: 0, onLog: (niveau, message) => journal.push(niveau + ' ' + message) })
  return { transport, app, journal }
}

async function abonne(transport: MemoryTransport, nom: string): Promise<any[]> {
  const ws = transport.connect({ url: 'ws://spectateur/' })
  const trames: any[] = []
  ws.onmessage = (ev: any) => trames.push(JSON.parse(ev.data))
  await tick()
  ws.send(JSON.stringify({ t: 'µ:hello', p: { protocol: 1 } }))
  await tick(10)
  ws.send(JSON.stringify({ t: 'µ:sub-stream', p: { stream: nom } }))
  await tick(10)
  return trames
}

describe('MJS-WS — flux détruit : l’ancienne poignée n’agit plus', function () {
  this.timeout(10000)

  it('écritures après destroy() : rien n’arrive aux anciens abonnés, un seul avertissement, aucune exception', async () => {
    const { transport, app, journal } = await demarrer()
    const partie = app.stream('partie-9', { public: true })
    await app.listen()
    try {
      const trames = await abonne(transport, 'partie-9')
      assert.equal(trames.filter(f => f.t === 'partie-9').length, 1, 'abonné : instantané reçu')
      partie.destroy()
      partie.add('k', 1)
      partie.update('k', { v: 2 })
      partie.remove('k')
      partie.reset({ z: 0 })
      await tick(20)
      assert.equal(trames.filter(f => f.t === 'partie-9').length, 1, 'aucun delta après destroy()')
      assert.equal(journal.filter(l => l.startsWith('warn') && l.includes('partie-9')).length, 1, 'un avertissement, une fois')
    } finally {
      await app.stop()
    }
  })

  it('second destroy() de l’ancienne poignée : le flux recréé sous le même nom reste servi', async () => {
    const { transport, app } = await demarrer()
    const ancienne = app.stream('partie-9', { public: true })
    await app.listen()
    try {
      ancienne.destroy()
      const nouvelle = app.stream('partie-9', { public: true })
      nouvelle.add('manche', 1)
      ancienne.destroy()
      const trames = await abonne(transport, 'partie-9')
      nouvelle.add('manche', 2)
      await tick(20)
      assert.deepEqual(trames.filter(f => f.t === 'partie-9').map(f => f.p), [
        { op: 'reset', values: { manche: 1 } },
        { op: 'add', key: 'manche', value: 2 },
      ])
    } finally {
      await app.stop()
    }
  })
})
