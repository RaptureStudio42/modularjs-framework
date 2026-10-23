// mise au banc par défaut : la faute d'un compte fermait son adresse à tous dès l'arrivée. Avec le paquet comptes, un
// visiteur anonyme se crée un compte en une requête (account:create), se fait expulser trois fois, et tous les comptes
// de son adresse (école, entreprise, opérateur mobile) étaient refusés en 1008 pendant 5 minutes. Le banc vise
// désormais le fautif par défaut (`ban.by: 'account'`) : son compte est refusé au hello, ses voisins entrent
import assert from 'node:assert/strict'
import { mjsWs, accountsPackage, accountsAuth, MemoryAccountsPersistAdapter, DEFAULT_BAN } from '../src/mjs-ws/index.js'
import { MemoryTransport } from '../src/mjs-ws/transport.js'
import type { MjsWsApp } from '../src/mjs-ws/index.js'

const tick   = (ms = 0) => new Promise<void>(r => setTimeout(r, ms))
const SECRET = 'secret-de-test-du-banc-assez-long-pour-les-jetons'

class TransportAvecAdresse extends MemoryTransport {
  onConnection(handler: Parameters<MemoryTransport['onConnection']>[0]): void {
    super.onConnection(conn => {
      const adresse = conn.remoteInfo.headers?.['x-adresse']
      if (typeof adresse === 'string') conn.remoteInfo.address = adresse
      handler(conn)
    })
  }
}

interface Brut { trames: any[]; fermeture: { code: number; reason: string } | null; envoyer(o: unknown): void; brut(texte: string): void }

async function arriver(transport: MemoryTransport, adresse: string): Promise<Brut> {
  const s = transport.connect({ headers: { 'x-adresse': adresse } })
  const b: Brut = { trames: [], fermeture: null, envoyer(o) { s.send(JSON.stringify(o)) }, brut(texte) { s.send(texte) } }
  s.onmessage = (ev: any) => b.trames.push(JSON.parse(String(ev.data)))
  s.onclose   = (ev: any) => { b.fermeture = { code: ev.code, reason: ev.reason } }
  await tick(5)
  return b
}

async function attendre(b: Brut, pred: (m: any) => boolean, ms = 5000): Promise<any> {
  const debut = Date.now()
  for (;;) {
    const m = b.trames.find(pred)
    if (m) return m
    if (b.fermeture) return null
    if (Date.now() - debut > ms) throw new Error('trame attendue jamais reçue')
    await tick(1)
  }
}

async function bonjour(b: Brut, jeton?: string): Promise<any> {
  b.envoyer({ t: 'µ:hello', p: { protocol: 1, auth: jeton ? { token: jeton } : undefined } })
  return attendre(b, m => m.t === 'µ:welcome' || m.t === 'µ:denied')
}

let numero = 0
async function requete(b: Brut, t: string, p: unknown): Promise<any> {
  const id = ++numero
  b.envoyer({ t, p, id })
  return attendre(b, m => m.t === 'µ:ack' && m.id === id)
}

async function demarrer(): Promise<{ transport: MemoryTransport; app: MjsWsApp }> {
  const transport = new TransportAvecAdresse()
  // mise au banc PAR DÉFAUT, paquet comptes : création libre en hello anonyme
  const app = mjsWs({ transport, heartbeat: 0, auth: accountsAuth(SECRET), onLog: () => {} })
  app.use(accountsPackage({ secret: SECRET, persist: new MemoryAccountsPersistAdapter(), onLog: () => {} }))
  await app.listen()
  return { transport, app }
}

async function creerCompte(transport: MemoryTransport, adresse: string, nom: string): Promise<string> {
  const b = await arriver(transport, adresse)
  assert.equal((await bonjour(b)).t, 'µ:welcome')
  const r = await requete(b, 'account:create', { name: nom, secret: 'motdepasse-' + nom })
  assert.equal(typeof r?.p?.token, 'string', 'création refusée : ' + JSON.stringify(r))
  return r.p.token
}

// 51 trames invalides : expulsion pour messages invalides en série, une faute pour le banc
async function seFaireExpulser(transport: MemoryTransport, adresse: string, jeton: string): Promise<void> {
  const b = await arriver(transport, adresse)
  assert.equal((await bonjour(b, jeton)).t, 'µ:welcome')
  for (let i = 0; i < 51; i++) b.brut('{pas du json')
  for (let i = 0; i < 300 && !b.fermeture; i++) await tick(2)
  assert.ok(b.fermeture, 'expulsé')
}

describe('MJS-WS — mise au banc par défaut : un compte créé sur place ne ferme pas l’adresse à ses voisins', function () {
  this.timeout(20000)

  it('le défaut vise le fautif : `by: \'account\'`', () => {
    assert.equal(DEFAULT_BAN.by, 'account')
  })

  it('compte créé par account:create puis expulsé 3 fois : un autre compte de la même adresse est accueilli, le fautif est refusé au hello', async () => {
    const { transport, app } = await demarrer()
    try {
      const jetonProf = await creerCompte(transport, '10.0.0.50', 'professeur')
      const jetonMallory = await creerCompte(transport, '10.0.0.9', 'mallory')
      for (let k = 0; k < 3; k++) await seFaireExpulser(transport, '10.0.0.9', jetonMallory)

      const prof = await arriver(transport, '10.0.0.9')
      assert.equal(prof.fermeture, null, 'jamais refusé à l’arrivée : ' + JSON.stringify(prof.fermeture))
      assert.equal((await bonjour(prof, jetonProf))?.t, 'µ:welcome', 'un autre compte de la même adresse est accueilli')

      const anonyme = await arriver(transport, '10.0.0.9')
      assert.equal((await bonjour(anonyme))?.t, 'µ:welcome', 'un visiteur sans compte de la même adresse aussi')

      const mallory = await arriver(transport, '10.0.0.9')
      assert.equal((await bonjour(mallory, jetonMallory))?.t, 'µ:denied', 'le compte fautif est refusé au hello')
    } finally {
      await app.stop()
    }
  })
})
