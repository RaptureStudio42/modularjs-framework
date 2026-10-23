// Présence, flux et anti-entropie relaient les noms `__proto__`, `constructor` et `prototype` comme les autres. Le serveur les
// écartait des seuls instantanés (les deltas `join`, `add`… passaient déjà), alors que le client les trie lui-même, une seule fois,
// au plus près de son état : ses magasins réactifs les refusent. Le serveur garde ce qui protège sa propre mémoire : ses Map, et
// les objets qu'il construit pour l'envoi, où `__proto__` est rangé comme une clé propre — jamais l'affectation, qui changerait le
// prototype de l'objet au lieu d'y ranger la donnée.

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { mjsWs } from '../src/mjs-ws/index.js'
import { MemoryTransport } from '../src/mjs-ws/transport.js'
import { MemoryAdapter, createMemoryAdapterBus } from '../src/mjs-ws/adapter.js'
import type { MemoryAdapterBus } from '../src/mjs-ws/adapter.js'
import type { MjsWsOptions } from '../src/mjs-ws/index.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const clientSrc = readFileSync(join(__dirname, '../src/runtime/mjs_socket.ts'), 'utf8')
const tick      = (ms = 0) => new Promise<void>(r => setTimeout(r, ms))
const NOMS      = ['__proto__', 'constructor', 'prototype']
const propres   = (o: object): string[] => Object.keys(o).sort()

// client µ.socket sur le transport en mémoire ; `trace` reçoit chaque trame telle que lue (JSON.parse : `__proto__` en clé propre)
function makeClient(transport: MemoryTransport, trace?: any[]): any {
  ;(globalThis as any).WebSocket = function(url: string, protocols?: any) {
    const ws: any = transport.connect({ url, protocols })
    if (trace) {
      let real: any = null
      Object.defineProperty(ws, 'onmessage', {
        get() { return real },
        set(fn: any) { real = fn && ((ev: any) => { trace.push(JSON.parse(ev.data)); fn(ev) }) },
      })
    }
    return ws
  }
  // _mjs_logger : traces de développement du client, coupées ici
  const µ: any = { state: (i: any) => ({ ...i }), error: () => {}, warn: () => {}, log: () => {}, _mjs_logger: () => null }
  new Function('µ', clientSrc)(µ)
  return µ
}

async function startApp(bus: MemoryAdapterBus | null, opts: MjsWsOptions = {}) {
  const transport = new MemoryTransport()
  const adapter   = bus ? new MemoryAdapter({ bus }) : undefined
  const app       = mjsWs({ transport, heartbeat: 0, ...(adapter ? { adapter, antiEntropy: 40 } : {}), auth: (h: any) => ({ id: h.auth.uid }), presence: 'public', onLog: () => {}, ...opts })
  await app.listen()
  return { transport, app, adapter }
}

async function visiteur(transport: MemoryTransport, uid: string, trace?: any[]): Promise<any> {
  const µ = makeClient(transport, trace)
  const s = µ.socket('memory://' + encodeURIComponent(uid), { auth: () => ({ uid }), reconnect: { enabled: false } })
  s.connect()
  await tick()
  return s
}

describe('mjs-ws — les noms du prototype sont relayés au client, qui les trie seul', () => {
  afterEach(() => {
    assert.deepEqual(Object.keys(Object.prototype), [], 'la mémoire du serveur n\'a gagné aucune clé héritée')
  })

  it('présence : l\'instantané porte les pairs de ces noms, `__proto__` en clé propre', async () => {
    const { transport, app } = await startApp(null)
    for (const uid of [...NOMS, 'ana']) await visiteur(transport, uid)
    const trace: any[] = []
    const s = await visiteur(transport, 'bea', trace)
    s.presence()
    await tick(5)
    const reset = trace.find(m => m.t === 'µ:presence' && m.p && m.p.op === 'reset')
    assert.ok(reset, 'instantané de présence reçu')
    assert.deepEqual(propres(reset.p.peers), ['__proto__', 'ana', 'bea', 'constructor', 'prototype'])
    await app.stop()
  })

  it('anti-entropie : l\'instantané publié aux autres process porte ces pairs, sans prototype changé', async () => {
    const bus = createMemoryAdapterBus()
    const { transport, app, adapter } = await startApp(bus)
    for (const uid of [...NOMS, 'ana']) await visiteur(transport, uid)
    const espion = new MemoryAdapter({ bus })
    const vus: any[] = []
    espion.subscribe(adapter!.prefix + ':presence:sync', (msg: any) => { vus.push(msg) })
    await tick(120)
    assert.ok(vus.length > 0, 'instantané publié')
    const pairs = vus[vus.length - 1].pairs
    assert.deepEqual(propres(pairs), ['__proto__', 'ana', 'constructor', 'prototype'])
    assert.equal(Object.getPrototypeOf(pairs), Object.prototype, 'l\'objet construit garde son prototype')
    await app.stop()
  })

  it('anti-entropie : un instantané reçu qui porte ces pairs les fait entrer dans la présence', async () => {
    const bus = createMemoryAdapterBus()
    const { transport, app, adapter } = await startApp(bus)
    const trace: any[] = []
    const s = await visiteur(transport, 'bea', trace)
    s.presence()
    await tick(5)
    const autre = new MemoryAdapter({ bus })
    const pairs = JSON.parse('{"__proto__":{"meta":{},"rooms":[]},"constructor":{"meta":{},"rooms":[]},"prototype":{"meta":{},"rooms":[]}}')
    autre.publish(adapter!.prefix + ':presence:sync', { processId: autre.processId, pairs })
    await tick(20)
    const joints = trace.filter(m => m.t === 'µ:presence' && m.p && m.p.op === 'join').map(m => m.p.id).sort()
    assert.deepEqual(joints, ['__proto__', 'constructor', 'prototype'])
    await app.stop()
  })

  it('flux : `snapshot()`, l\'instantané envoyé et un `reset` portent les clés de ces noms, `__proto__` en clé propre', async () => {
    const { transport, app } = await startApp(null)
    const flux = app.stream('scores', { public: true })
    for (const [i, cle] of [...NOMS, 'ana'].entries()) flux.add(cle, { pts: i })
    const vu = flux.snapshot()
    assert.deepEqual(propres(vu), ['__proto__', 'ana', 'constructor', 'prototype'])
    assert.equal(Object.getPrototypeOf(vu), Object.prototype, 'l\'objet construit garde son prototype')
    assert.deepEqual(Object.getOwnPropertyDescriptor(vu, '__proto__')!.value, { pts: 0 })
    const trace: any[] = []
    const s = await visiteur(transport, 'bea', trace)
    s.stream('scores')
    await tick(5)
    const reset = trace.find(m => m.t === 'scores' && m.p && m.p.op === 'reset')
    assert.ok(reset, 'instantané du flux reçu')
    assert.deepEqual(propres(reset.p.values), ['__proto__', 'ana', 'constructor', 'prototype'])
    trace.length = 0
    flux.reset(JSON.parse('{"__proto__":{"pts":5},"constructor":{"pts":6},"zoe":{"pts":7}}'))
    await tick(5)
    const remise = trace.find(m => m.t === 'scores' && m.p && m.p.op === 'reset')
    assert.ok(remise, 'remise à zéro relayée')
    assert.deepEqual(propres(remise.p.values), ['__proto__', 'constructor', 'zoe'])
    assert.deepEqual(propres(flux.snapshot()), ['__proto__', 'constructor', 'zoe'])
    await app.stop()
  })
})
