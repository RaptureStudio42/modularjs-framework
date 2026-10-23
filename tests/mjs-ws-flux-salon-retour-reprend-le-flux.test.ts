// Un joueur qui quitte le salon d'un flux réservé à ce salon (`app.stream(nom, { room })`) puis y revient sur la même
// connexion retrouve le flux sans rien redemander : l'état complet d'abord, puis les deltas. Avant, le serveur l'avait
// désabonné au départ et le client du framework ne redemandait jamais le flux (stream() rend le magasin déjà connu) :
// plus aucun delta, sans aucun signal, jusqu'à la reconnexion.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { mjsWs } from '../src/mjs-ws/index.js'
import { MemoryTransport } from '../src/mjs-ws/transport.js'
import { poserMessages } from './helpers/messages-stub.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const clientSrc = readFileSync(join(__dirname, '../src/runtime/mjs_socket.ts'), 'utf8')
const tick      = (ms = 0) => new Promise<void>(r => setTimeout(r, ms))

// vrai client du framework (runtime/mjs_socket.ts) sur le transport mémoire
function navigateur(transport: MemoryTransport): any {
  ;(globalThis as any).WebSocket = function(url: string, protocols?: any) { return transport.connect({ url, protocols }) }
  const µ: any = { state: (i: any) => ({ ...i }), error: () => {}, warn: () => {}, log: () => {} }
  poserMessages(µ)
  new Function('µ', clientSrc)(µ)
  return µ
}

describe('MJS-WS — flux réservé à un salon : revenu dans le salon, le joueur retrouve le flux', function () {
  this.timeout(10000)

  it('client du framework : quitte la table, y revient, reçoit l\'état complet puis les deltas', async () => {
    const transport = new MemoryTransport()
    const app = mjsWs({ transport, heartbeat: 0, onLog: () => {} })
    const partie = app.stream('partie-42', { room: 'partie-42' })
    await app.listen()
    const s = navigateur(transport).socket('memory://retour', { auth: () => undefined, reconnect: { enabled: false } })
    s.connect()
    await tick(20)
    let salle = s.room('partie-42')
    await tick(20)
    const magasin = s.stream('partie-42')
    await tick(20)
    partie.add('tour-1', { joueur: 'A' })
    await tick(20)
    assert.ok('tour-1' in magasin, 'dans le salon : delta reçu')

    salle.leave()
    await tick(20)
    partie.add('pendant-absence', 1)
    await tick(20)
    assert.equal('pendant-absence' in magasin, false, 'hors du salon : rien')

    salle = s.room('partie-42')
    await tick(20)
    assert.equal(s.stream('partie-42'), magasin, 'le composant garde le même magasin')
    assert.ok('pendant-absence' in magasin, 'au retour : l\'état complet, ce qui a changé pendant l\'absence compris')
    partie.add('tour-2', { joueur: 'B' })
    await tick(20)
    assert.ok('tour-2' in magasin, 'au retour : les deltas suivants')
    s.destroy(); await app.stop()
  })

  it('protocole brut : expulsé puis revenu par µ:join, un reset au seq courant puis les deltas, sans µ:sub-stream', async () => {
    const transport = new MemoryTransport()
    const app = mjsWs({ transport, heartbeat: 0, onLog: () => {} })
    const partie = app.stream('partie-7', { room: 'table-7' })
    await app.listen()
    const ws = transport.connect({ url: 'ws://joueur/' })
    const trames: any[] = []
    ws.onmessage = (ev: any) => trames.push(JSON.parse(ev.data))
    const envoyer = (t: string, p: unknown) => ws.send(JSON.stringify({ t, p }))
    await tick()
    envoyer('µ:hello', { protocol: 1, resub: [], rooms: [] })
    await tick()
    envoyer('µ:join', { room: 'table-7' })
    await tick()
    envoyer('µ:sub-stream', { stream: 'partie-7' })
    await tick(20)
    app.room('table-7').kick(Array.from(app.room('table-7').clients)[0], 'pause')
    await tick()
    partie.add('pendant', { coup: 1 })
    await tick()
    const avant = trames.length

    envoyer('µ:join', { room: 'table-7' })
    await tick(20)
    partie.add('apres', { coup: 2 })
    await tick(20)
    const flux = trames.slice(avant).filter(f => f.t === 'partie-7')
    assert.equal(flux.length, 2, 'un reset puis un delta : ' + JSON.stringify(flux))
    assert.deepEqual(flux[0].p, { op: 'reset', values: { pendant: { coup: 1 } } }, 'état complet au retour')
    assert.deepEqual(flux[1].p, { op: 'add', key: 'apres', value: { coup: 2 } })
    assert.equal(flux[1].seq, flux[0].seq + 1, 'deltas contigus après le reset')
    await app.stop()
  })
})
