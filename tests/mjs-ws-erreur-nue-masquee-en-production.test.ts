// core.ts — en production (NODE_ENV=production), une `Error` NUE levée dans un serve()/on() partait telle quelle au
// client : des bibliothèques et du code d'appli en lèvent avec des détails internes (« connect ECONNREFUSED
// 10.0.3.4:5432 (pg) user=app_prod »). En production, le client ne reçoit plus que le message générique, sauf pour
// un refus volontaire : un code (`commande-refusee`, la convention des paquets), une `MjsWsError` (une phrase faite
// pour le client), ou le refus d'une partie MJS-Server (`µgame:*`, dont le message est la réponse du joueur). En
// développement, rien ne change : le message part, pour déboguer.
import assert from 'node:assert/strict'
import { mjsWs, MjsWsError } from '../src/mjs-ws/index.js'
import { mjsServer } from '../src/mjs-server/index.js'
import { MemoryTransport } from '../src/mjs-ws/transport.js'
import { t } from '../src/messages/index.js'
import type { MjsWsApp } from '../src/mjs-ws/index.js'

const tick = (ms = 0) => new Promise<void>(r => setTimeout(r, ms))

interface Client { ws: any; trames: any[] }

async function connecter(transport: MemoryTransport): Promise<Client> {
  const ws        = transport.connect({ url: 'memory://erreurs' })
  const c: Client = { ws, trames: [] }
  ws.onmessage = (ev: any) => c.trames.push(JSON.parse(ev.data))
  await tick()
  ws.send(JSON.stringify({ t: 'µ:hello', p: { protocol: 1, auth: { id: 'joueur' } } }))
  await tick(10)
  return c
}

let numero = 0
async function requete(c: Client, type: string, p: unknown = {}): Promise<any> {
  const id = ++numero
  c.ws.send(JSON.stringify({ t: type, p, id }))
  for (let i = 0; i < 200; i++) {
    const ack = c.trames.find(f => f.t === 'µ:ack' && f.id === id)
    if (ack) return ack
    await tick(5)
  }
  throw new Error('accusé jamais reçu pour ' + type)
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

async function demarrer(): Promise<{ transport: MemoryTransport; app: MjsWsApp }> {
  const transport = new MemoryTransport()
  const app       = mjsWs({ transport, heartbeat: 0, auth: (h: any) => h.auth, onLog: () => {} })
  app.on('note', () => { throw new Error('connect ECONNREFUSED 10.0.3.4:5432 (pg) user=app_prod') })
  app.serve('tour', () => { throw new Error('ce n’est pas votre tour') })
  app.serve('commande', () => { throw new Error('commande-refusee') })
  app.serve('phrase', () => { throw new MjsWsError('ce n’est pas votre tour') })
  await app.listen()
  return { transport, app }
}

describe('MJS-WS — Error nue d’un serve()/on() : message générique en production, sauf refus volontaire', () => {
  it('production : une Error nue porteuse d’un détail interne ne part plus au client', () => avecNodeEnv('production', async () => {
    const { transport, app } = await demarrer()
    try {
      const c = await connecter(transport)
      c.ws.send(JSON.stringify({ t: 'note', p: {} }))
      await tick(20)
      const erreur = c.trames.find(f => f.t === 'µ:error')
      assert.equal(erreur?.p?.message, t('ws.core.erreur-interne-client'), JSON.stringify(erreur))
      assert.ok(!JSON.stringify(c.trames).includes('10.0.3.4'), 'ni hôte ni utilisateur de la base côté client')
      assert.equal((await requete(c, 'tour')).p, t('ws.core.erreur-interne-client'), 'une phrase en Error nue : message générique')
    } finally {
      await app.stop()
    }
  }))

  it('production : un code de refus et une MjsWsError partent tels quels', () => avecNodeEnv('production', async () => {
    const { transport, app } = await demarrer()
    try {
      const c = await connecter(transport)
      const commande = await requete(c, 'commande')
      assert.equal(commande.e, true)
      assert.equal(commande.p, 'commande-refusee')
      assert.equal((await requete(c, 'phrase')).p, 'ce n’est pas votre tour')
    } finally {
      await app.stop()
    }
  }))

  it('production : le refus d’un coup MJS-Server (Error nue du code de jeu) reste la réponse du joueur', () => avecNodeEnv('production', async () => {
    const transport = new MemoryTransport()
    const app       = mjsServer({ transport, heartbeat: 0, auth: (h: any) => h.auth, onLog: () => {} })
    app.game('solo', { seats: 1, state: () => ({}), moves: { jouer: () => { throw new Error('case occupée') } } })
    await app.listen()
    try {
      const c     = await connecter(transport)
      const siege = await requete(c, 'µgame:play', { type: 'solo' })
      assert.equal(siege.e, undefined, JSON.stringify(siege))
      const coup = await requete(c, 'µgame:move', { game: siege.p.game, move: 'jouer' })
      assert.equal(coup.e, true)
      assert.equal(coup.p, 'case occupée')
    } finally {
      await app.stop()
    }
  }))

  it('développement : une Error nue part telle quelle, pour déboguer', () => avecNodeEnv(undefined, async () => {
    const { transport, app } = await demarrer()
    try {
      const c = await connecter(transport)
      assert.equal((await requete(c, 'tour')).p, 'ce n’est pas votre tour')
      c.ws.send(JSON.stringify({ t: 'note', p: {} }))
      await tick(20)
      assert.match(String(c.trames.find(f => f.t === 'µ:error')?.p?.message), /ECONNREFUSED/)
    } finally {
      await app.stop()
    }
  }))
})
