// Un flux qui naît par le pont (POST /stream) n'est servi à personne tant que le code du process ne l'a pas déclaré
// (app.stream) : sans déclaration, la garde que ce flux porte peut-être ailleurs reste inconnue ici. Avant, le pont le
// créait public : un flux gardé sur le process A (canSubscribe), écrit d'abord par le pont sur le process B, était
// servi en entier aux clients de B, et à ceux des autres process qui ne l'avaient pas déclaré non plus.
import assert from 'node:assert/strict'
import { createHmac, randomBytes } from 'node:crypto'
import { mjsWs, MemoryAdapter, createMemoryAdapterBus } from '../src/mjs-ws/index.js'
import { MemoryTransport } from '../src/mjs-ws/transport.js'
import type { MjsWsApp, MemoryAdapterBus } from '../src/mjs-ws/index.js'

const tick   = (ms = 0) => new Promise<void>(r => setTimeout(r, ms))
const SECRET = 'secret-de-test-flux-du-pont'

function signer(methode: string, chemin: string, corps: string, ts: number, nonce: string): string {
  const canonique = ['in', String(ts), methode, chemin, corps, nonce].map(c => c.length + ':' + c).join('')
  return createHmac('sha256', SECRET).update(canonique).digest('hex')
}

async function poster(port: number, corps: unknown): Promise<number> {
  const brut  = JSON.stringify(corps)
  const ts    = Math.floor(Date.now() / 1000)
  const nonce = randomBytes(16).toString('hex')   // neuf à chaque requête : le pont l'exige par défaut
  const res   = await fetch('http://127.0.0.1:' + port + '/stream', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-mjs-ws-timestamp': String(ts), 'x-mjs-ws-nonce': nonce, 'x-mjs-ws-signature': signer('POST', '/stream', brut, ts, nonce) },
    body: brut,
  })
  await res.json()
  return res.status
}

interface Process { transport: MemoryTransport; app: MjsWsApp; port: number; avertissements: string[] }

let n = 0
async function demarrer(opts: { bus?: MemoryAdapterBus; pont?: boolean } = {}): Promise<Process> {
  const transport = new MemoryTransport()
  const avertissements: string[] = []
  let port = 0
  const app = mjsWs({
    transport, heartbeat: 0, auth: () => ({ id: 'u' + (++n) }),
    onLog: (level, message, meta: any) => {
      if (level === 'warn') avertissements.push(message)
      if (meta?.port && /pont universel|universal bridge/.test(message)) port = meta.port
    },
    ...(opts.bus ? { adapter: new MemoryAdapter({ bus: opts.bus }), antiEntropy: false as const } : {}),
    ...(opts.pont ? { bridge: { port: 0, secret: SECRET, rateLimit: false } } : {}),
  })
  await app.listen()
  return { transport, app, port, avertissements }
}

// ce qu'un client reçoit après un µ:sub-stream : les valeurs du flux, ou 'refus'
async function vu(transport: MemoryTransport, flux: string): Promise<unknown[]> {
  const ws = transport.connect({ url: 'ws://visiteur/' })
  const trames: any[] = []
  ws.onmessage = (ev: any) => trames.push(JSON.parse(ev.data))
  await tick()
  ws.send(JSON.stringify({ t: 'µ:hello', p: { protocol: 1, resub: [], rooms: [] } }))
  await tick()
  ws.send(JSON.stringify({ t: 'µ:sub-stream', p: { stream: flux } }))
  await tick(30)
  return trames.filter(f => f.t === flux || f.t === 'µ:error').map(f => f.t === 'µ:error' ? 'refus' : f.p.values)
}

describe('MJS-WS — un flux né par le pont n\'est jamais servi sans déclaration', function () {
  this.timeout(10000)

  it('plusieurs processus : gardé sur A, écrit par le pont sur B → refusé sur B, et sur C qui ne le déclare pas', async () => {
    const bus = createMemoryAdapterBus()
    const A = await demarrer({ bus }), B = await demarrer({ bus, pont: true }), C = await demarrer({ bus })
    A.app.stream('partie-9', { canSubscribe: () => false })
    assert.equal(await poster(B.port, { name: 'partie-9', op: 'add', id: 'main', value: { cartes: ['As', 'Roi'] } }), 200)
    await tick(30)

    assert.deepEqual(await vu(B.transport, 'partie-9'), ['refus'], 'B a reçu le POST sans déclarer le flux : refus, jamais la main secrète')
    assert.deepEqual(await vu(C.transport, 'partie-9'), ['refus'], 'C ne déclare pas le flux : refus aussi')
    assert.deepEqual(await vu(A.transport, 'partie-9'), ['refus'], 'témoin : A applique sa garde')
    await A.app.stop(); await B.app.stop(); await C.app.stop()
  })

  it('plusieurs processus : le process qui déclare le flux sert ce que le pont écrit ailleurs ; les autres le servent une fois déclaré', async () => {
    const bus = createMemoryAdapterBus()
    const A = await demarrer({ bus }), B = await demarrer({ bus, pont: true })
    A.app.stream('tableau', { public: true })
    assert.equal(await poster(B.port, { name: 'tableau', op: 'add', id: 'score', value: 3 }), 200)
    await tick(30)

    assert.deepEqual(await vu(A.transport, 'tableau'), [{ score: 3 }], 'A a déclaré le flux public : il le sert')
    assert.deepEqual(await vu(B.transport, 'tableau'), ['refus'], 'B ne l\'a pas déclaré : refus')
    B.app.stream('tableau', { public: true })
    assert.deepEqual(await vu(B.transport, 'tableau'), [{ score: 3 }], 'déclaré sur B à son tour : servi')
    await A.app.stop(); await B.app.stop()
  })

  it('un seul processus : écrit par le pont sans déclaration → refusé, l\'avertissement dit quoi faire ; déclaré ensuite → servi', async () => {
    const P = await demarrer({ pont: true })
    assert.equal(await poster(P.port, { name: 'ennemis', op: 'add', id: 'e1', value: { x: 10 } }), 200)

    assert.deepEqual(await vu(P.transport, 'ennemis'), ['refus'])
    assert.ok(P.avertissements.some(l => l.includes('ennemis') && l.includes('app.stream')), 'l\'avertissement nomme le flux et la déclaration à faire : ' + JSON.stringify(P.avertissements))
    P.app.stream('ennemis', { public: true })
    assert.deepEqual(await vu(P.transport, 'ennemis'), [{ e1: { x: 10 } }])
    await P.app.stop()
  })
})
