// pont universel (src/mjs-ws/bridge.ts) — `POST /send` trouve ses destinataires par les index du
// serveur (connexion par son id, utilisateur par l'index des comptes, comme app.sendUser) au lieu de
// parcourir toutes les connexions du processus à chaque requête : le coût suit les connexions de la
// cible, plus le nombre total de connectés. Mêmes destinataires qu'avant.
import assert from 'node:assert/strict'
import { createHmac, randomBytes } from 'node:crypto'
import { mjsWs, MemoryTransport } from '../src/mjs-ws/index.js'
import type { MjsWsApp } from '../src/mjs-ws/index.js'

const tick   = (ms = 0) => new Promise<void>(r => setTimeout(r, ms))
const SECRET = 'secret-de-test-pont-send-1234567890'

const lp = (champ: string) => champ.length +':'+ champ

async function envoyer(port: number, corps: unknown): Promise<{ status: number, json: any }> {
  const texte = JSON.stringify(corps)
  const ts    = Math.floor(Date.now() / 1000)
  const nonce = randomBytes(16).toString('hex')   // neuf à chaque requête : le pont l'exige par défaut
  const sig   = createHmac('sha256', SECRET).update(['in', String(ts), 'POST', '/send', texte, nonce].map(lp).join('')).digest('hex')
  const res   = await fetch('http://127.0.0.1:'+ port +'/send', { method: 'POST', headers: { 'x-mjs-ws-timestamp': String(ts), 'x-mjs-ws-nonce': nonce, 'x-mjs-ws-signature': sig, 'content-type': 'application/json' }, body: texte })
  return { status: res.status, json: await res.json() }
}

async function monter(): Promise<{ transport: MemoryTransport, app: MjsWsApp, port: number }> {
  const transport = new MemoryTransport()
  let port        = 0
  const app       = mjsWs({
    transport, heartbeat: 0,
    auth:   (hello: any) => (hello.auth?.uid ? { id: hello.auth.uid } : {}),
    bridge: { port: 0, secret: SECRET },
    onLog:  (_niveau, message, meta: any) => { if (meta && typeof meta.port === 'number' && /pont universel en écoute/.test(message)) port = meta.port },
  })
  await app.listen()
  return { transport, app, port }
}

async function connecter(transport: MemoryTransport, uid?: string): Promise<{ recues: any[] }> {
  const ws     = transport.connect({ url: 'memory://pont-send' })
  const recues: any[] = []
  ws.onmessage = (ev: any) => { recues.push(JSON.parse(ev.data)) }
  await new Promise<void>(r => { ws.onopen = () => r() })
  ws.send(JSON.stringify({ t: 'µ:hello', p: { protocol: 1, auth: uid ? { uid } : undefined } }))
  return { recues }
}

// compte les parcours de app.clients — la façade publique que le pont parcourait à chaque /send
function compterParcours(app: MjsWsApp): { readonly n: number } {
  const proto     = Object.getOwnPropertyDescriptor(app, 'clients')!
  const compteur  = { n: 0 }
  Object.defineProperty(app, 'clients', { configurable: true, get() { compteur.n++; return proto.get!.call(app) } })
  return compteur
}

describe('mjs-ws — pont : /send par les index, sans parcourir toutes les connexions', () => {
  it('user → toutes ses connexions, client → la sienne, inconnu → personne ; app.clients jamais parcouru', async () => {
    const { transport, app, port } = await monter()
    try {
      const a1 = await connecter(transport, 'u1')
      const a2 = await connecter(transport, 'u1')
      const b  = await connecter(transport, 'u2')
      const an = await connecter(transport)
      for (let i = 0; i < 20; i++) await connecter(transport, 'autre-'+ i)
      await tick(20)
      const anonyme = Array.from(app.clients).find(c => !(c.identity as any)?.id)!
      const parcours = compterParcours(app)

      const r1 = await envoyer(port, { user: 'u1', type: 'note', p: { n: 1 } })
      assert.deepEqual([r1.status, r1.json], [200, { ok: true, sent: 2 }])
      const r2 = await envoyer(port, { client: anonyme.id, type: 'note', p: { n: 2 } })
      assert.deepEqual([r2.status, r2.json], [200, { ok: true, sent: 1 }])
      const r3 = await envoyer(port, { user: 'personne', type: 'note', p: { n: 3 } })
      assert.deepEqual([r3.status, r3.json], [200, { ok: true, sent: 0 }])
      await tick(20)

      const notes = (x: { recues: any[] }) => x.recues.filter(f => f.t === 'note').map(f => f.p.n)
      assert.deepEqual(notes(a1), [1])
      assert.deepEqual(notes(a2), [1])
      assert.deepEqual(notes(b), [])
      assert.deepEqual(notes(an), [2])
      assert.equal(parcours.n, 0, `app.clients parcouru ${parcours.n} fois par /send`)
    }
    finally { await app.stop() }
  })

  it('user = `anon:` suivi de l\'id de connexion d\'un anonyme → cette connexion, l\'id nu → personne (même résolution que app.sendUser)', async () => {
    const { transport, app, port } = await monter()
    try {
      const an = await connecter(transport)
      await tick(20)
      const anonyme = Array.from(app.clients)[0]
      const nu = await envoyer(port, { user: anonyme.id, type: 'note', p: { n: 6 } })
      assert.deepEqual(nu.json, { ok: true, sent: 0 }, 'un id de connexion nu ne désigne aucune personne')
      const r = await envoyer(port, { user: 'anon:'+ anonyme.id, type: 'note', p: { n: 7 } })
      assert.deepEqual(r.json, { ok: true, sent: 1 })
      await tick(20)
      assert.deepEqual(an.recues.filter(f => f.t === 'note').map(f => f.p.n), [7])
    }
    finally { await app.stop() }
  })
})
