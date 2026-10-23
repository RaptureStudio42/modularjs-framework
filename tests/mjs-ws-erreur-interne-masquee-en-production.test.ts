// core.ts — le message de TOUTE exception levée dans un serve()/on() partait tel quel au client (TypeError
// interne, erreur de connexion à la base avec son hôte…), alors que le hello masque déjà les siennes. En
// production (NODE_ENV=production), une exception INTERNE (moteur JavaScript, bibliothèque, système) ne donne
// plus au client qu'un message générique, le détail allant au journal du serveur ; en développement, le détail
// reste visible pour déboguer. Un refus volontaire en code (`commande-refusee`, comme le font les paquets) part
// toujours tel quel ; une phrase en `Error` nue ne part qu'en développement (cf.
// tests/mjs-ws-erreur-nue-masquee-en-production.test.ts pour MjsWsError et MJS-Server).
import assert from 'node:assert/strict'
import { mjsWs } from '../src/mjs-ws/index.js'
import { MemoryTransport } from '../src/mjs-ws/transport.js'
import { t } from '../src/messages/index.js'
import type { MjsWsApp } from '../src/mjs-ws/index.js'

const tick = (ms = 0) => new Promise<void>(r => setTimeout(r, ms))

interface Client { ws: any; trames: any[] }

// classe d'erreur d'une bibliothèque (pilote de base de données)
class ErreurDePilote extends Error {}

async function demarrer(journal: Array<{ niveau: string; message: string; meta: any }>): Promise<{ transport: MemoryTransport; app: MjsWsApp }> {
  const transport = new MemoryTransport()
  const app       = mjsWs({ transport, heartbeat: 0, onLog: (niveau, message, meta) => journal.push({ niveau, message, meta }) })
  app.serve('profil', (p: any) => p.user.name)
  app.serve('commande', () => { throw new Error('commande-refusee') })
  app.serve('tour', () => { throw new Error('ce n’est pas votre tour') })
  app.serve('pilote', () => { throw new ErreurDePilote('password authentication failed for user "app_prod"') })
  // erreur système telle que Node la fabrique (un pilote de base qui ne joint pas son serveur)
  app.on('note', () => { throw Object.assign(new Error('connect ECONNREFUSED 10.0.3.4:5432'), { errno: -111, code: 'ECONNREFUSED', syscall: 'connect', address: '10.0.3.4', port: 5432 }) })
  await app.listen()
  return { transport, app }
}

async function connecter(transport: MemoryTransport): Promise<Client> {
  const ws        = transport.connect({ url: 'memory://erreurs' })
  const c: Client = { ws, trames: [] }
  ws.onmessage = (ev: any) => c.trames.push(JSON.parse(ev.data))
  await tick()
  ws.send(JSON.stringify({ t: 'µ:hello', p: { protocol: 1 } }))
  await tick(10)
  return c
}

async function requete(c: Client, type: string, id: number): Promise<any> {
  c.ws.send(JSON.stringify({ t: type, p: {}, id }))
  await tick(10)
  return c.trames.find(f => f.t === 'µ:ack' && f.id === id)
}

async function avecNodeEnv(valeur: string | undefined, corps: () => Promise<void>): Promise<void> {
  const avant = process.env.NODE_ENV
  if (valeur === undefined) delete process.env.NODE_ENV
  else process.env.NODE_ENV = valeur
  try { await corps() }
  finally {
    if (avant === undefined) delete process.env.NODE_ENV
    else process.env.NODE_ENV = avant
  }
}

describe('MJS-WS — exception d’un serve()/on() : rien d’interne ne part au client en production', () => {
  it('production : message générique au client, détail au journal du serveur', () => avecNodeEnv('production', async () => {
    const journal: Array<{ niveau: string; message: string; meta: any }> = []
    const { transport, app }                                             = await demarrer(journal)
    try {
      const c   = await connecter(transport)
      const ack = await requete(c, 'profil', 1)
      assert.equal(ack.e, true)
      assert.equal(ack.p, t('ws.core.erreur-interne-client'), 'message générique, jamais le TypeError interne')
      c.ws.send(JSON.stringify({ t: 'note', p: {} }))
      await tick(10)
      const erreur = c.trames.find(f => f.t === 'µ:error')
      assert.equal(erreur.p.message, t('ws.core.erreur-interne-client'))
      assert.ok(!JSON.stringify(c.trames).includes('10.0.3.4'), 'ni hôte ni utilisateur de la base côté client')
      const details = journal.filter(l => l.niveau === 'error').map(l => String(l.meta?.err?.message))
      assert.ok(details.some(m => m.includes('Cannot read properties')), 'le détail du serve() est au journal')
      assert.ok(details.some(m => m.includes('10.0.3.4')), 'le détail du on() est au journal')
    } finally {
      await app.stop()
    }
  }))

  it('production : un code de refus en Error nue part tel quel ; une phrase en Error nue, non', () => avecNodeEnv('production', async () => {
    const { transport, app } = await demarrer([])
    try {
      const c   = await connecter(transport)
      const ack = await requete(c, 'commande', 2)
      assert.equal(ack.e, true)
      assert.equal(ack.p, 'commande-refusee')
      assert.equal((await requete(c, 'tour', 4)).p, t('ws.core.erreur-interne-client'), 'une phrase en Error nue peut porter un détail interne : générique en production')
    } finally {
      await app.stop()
    }
  }))

  it('production : l’erreur d’une bibliothèque (sous-classe d’Error) est masquée elle aussi', () => avecNodeEnv('production', async () => {
    const journal: Array<{ niveau: string; message: string; meta: any }> = []
    const { transport, app }                                             = await demarrer(journal)
    try {
      const c   = await connecter(transport)
      const ack = await requete(c, 'pilote', 5)
      assert.equal(ack.p, t('ws.core.erreur-interne-client'))
      assert.ok(journal.some(l => l.niveau === 'error' && l.meta?.err instanceof ErreurDePilote), 'le détail est au journal')
    } finally {
      await app.stop()
    }
  }))

  it('développement : le détail reste visible au client pour déboguer', () => avecNodeEnv(undefined, async () => {
    const { transport, app } = await demarrer([])
    try {
      const c   = await connecter(transport)
      const ack = await requete(c, 'profil', 3)
      assert.match(String(ack.p), /Cannot read properties/)
    } finally {
      await app.stop()
    }
  }))
})
