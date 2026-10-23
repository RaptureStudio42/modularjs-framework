// core.ts — `app.sendUser(id)` et le canal multi-processus `send` parcouraient TOUTES les connexions du
// processus pour trouver celles d'un utilisateur (coût linéaire : ~54 µs par envoi à 5000 connexions), alors que
// l'index par identité existe déjà. Ils passent par l'index (identité, ou `anon:` suivi de l'id d'une connexion anonyme) : le coût
// ne dépend plus que des connexions de l'utilisateur visé. Preuve sans chronomètre : on compte les lectures de
// `identity.id` faites pendant l'envoi — une par connexion du processus avant, aucune après.
import assert from 'node:assert/strict'
import { mjsWs } from '../src/mjs-ws/index.js'
import { MemoryTransport } from '../src/mjs-ws/transport.js'
import { MemoryAdapter, createMemoryAdapterBus } from '../src/mjs-ws/adapter.js'
import type { MjsWsApp, MjsWsOptions } from '../src/mjs-ws/index.js'

const tick = (ms = 0) => new Promise<void>(r => setTimeout(r, ms))

let lectures = 0

// identité dont chaque lecture de `id` est comptée
function identiteComptee(id: string): { id: string } {
  return { get id() { lectures++; return id } }
}

async function demarrer(opts: MjsWsOptions = {}): Promise<{ transport: MemoryTransport; app: MjsWsApp }> {
  const transport = new MemoryTransport()
  const app       = mjsWs({ transport, heartbeat: 0, auth: (hello: any) => (hello.auth?.uid ? identiteComptee(hello.auth.uid) : {}), onLog: () => {}, ...opts })
  await app.listen()
  return { transport, app }
}

async function connecter(transport: MemoryTransport, uid?: string): Promise<{ trames: any[] }> {
  const ws            = transport.connect({ url: 'memory://envoi' })
  const trames: any[] = []
  ws.onmessage = (ev: any) => trames.push(JSON.parse(ev.data))
  await tick()
  ws.send(JSON.stringify({ t: 'µ:hello', p: { protocol: 1, ...(uid ? { auth: { uid } } : {}) } }))
  await tick()
  return { trames }
}

const notifs = (o: { trames: any[] }) => o.trames.filter(f => f.t === 'notif').length

describe('MJS-WS — envoi à un utilisateur par l’index des identités', function () {
  // 200 connexions et plus, ouvertes une à une (deux tours d'horloge chacune) : le budget par défaut de mocha (2 s) partait
  // sous charge ; le test ne chronomètre rien, il compte des lectures
  this.timeout(30000)

  it('app.sendUser ne lit aucune autre connexion que celles de l’utilisateur visé', async () => {
    const { transport, app } = await demarrer()
    try {
      const foule: Array<{ trames: any[] }> = []
      for (let i = 0; i < 200; i++) foule.push(await connecter(transport, 'u' + i))
      const second  = await connecter(transport, 'u7')
      const anonyme = await connecter(transport)
      await tick(10)
      const idAnonyme = Array.from(app.clients).find(c => !(c.identity as any)?.id)!.id
      lectures = 0
      app.sendUser('u7', 'notif', { n: 1 })
      assert.equal(lectures, 0, `aucune lecture d'identité pendant l'envoi (${lectures} lues)`)
      await tick(10)
      assert.equal(notifs(foule[7]), 1, 'premier onglet de u7')
      assert.equal(notifs(second), 1, 'second onglet de u7')
      assert.equal(foule.reduce((n, o, i) => n + (i === 7 ? 0 : notifs(o)), 0), 0, 'personne d’autre')

      app.sendUser('anon:'+ idAnonyme, 'notif', { n: 2 })
      await tick(10)
      assert.equal(notifs(anonyme), 1, 'une connexion anonyme est joignable par `anon:` suivi de son id de connexion')
      const idIdentifie = Array.from(app.clients).find(c => (c.identity as any)?.id === 'u3')!.id
      app.sendUser(idIdentifie, 'notif', { n: 3 })
      await tick(10)
      assert.equal(notifs(foule[3]), 0, 'une connexion identifiée ne répond qu’à son identité, comme avant')
    } finally {
      await app.stop()
    }
  })

  it('canal multi-processus `send` : l’autre processus trouve l’utilisateur par son index', async () => {
    const bus = createMemoryAdapterBus()
    const p1  = await demarrer({ adapter: new MemoryAdapter({ bus }) })
    const p2  = await demarrer({ adapter: new MemoryAdapter({ bus }) })
    try {
      const foule: Array<{ trames: any[] }> = []
      for (let i = 0; i < 200; i++) foule.push(await connecter(p2.transport, 'u' + i))
      await tick(10)
      lectures = 0
      p1.app.sendUser('u42', 'notif', { n: 1 })
      await tick(20)
      assert.equal(notifs(foule[42]), 1, 'l’onglet de u42 servi par l’autre processus reçoit')
      assert.equal(lectures, 0, `aucune lecture d'identité côté réception (${lectures} lues)`)
    } finally {
      await p1.app.stop()
      await p2.app.stop()
    }
  })
})
