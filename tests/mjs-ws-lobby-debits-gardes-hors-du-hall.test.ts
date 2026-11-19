// Paquet LOBBY (src/mjs-ws/lobby.ts) — les débits du hall sont par identité (≈ 6 invitations et ≈ 6 annonces par minute, un
// changement de statut par 5 s) : sortir du hall (µ:leave) puis y rentrer (µ:join + lobby:enter) ne les remet pas à neuf. Ils
// vivaient dans la présence, effacée au départ : trois allers-retours rendaient 18 invitations, 18 annonces et 3 statuts.
// Les débits d'une identité partie sont gardés à part, oubliés dès qu'ils ne retiennent plus rien (seaux pleins, délai de statut
// passé) et 10 000 au plus : la table ne grandit pas à son tour. Un blocage n'arrête que les invitations.
// Clients bruts sur MemoryTransport, horloge pilotée (Date.now) : on compte des trames et des entrées, jamais du temps.
import assert from 'node:assert/strict'
import { mjsWs, lobbyPackage } from '../src/mjs-ws/index.js'
import { MemoryTransport } from '../src/mjs-ws/transport.js'
import type { MjsWsApp } from '../src/mjs-ws/index.js'

const vraiNow = Date.now
let maintenant = vraiNow()

interface Brut { trames: any[]; envoyer(t: string, p?: unknown): void; requete(t: string, p?: unknown): Promise<any>; fermer(): void }

let idRequete = 0
async function brut(transport: MemoryTransport, uid?: string): Promise<Brut> {
  const s: any = transport.connect({})
  const attentes = new Map<number, (m: any) => void>()
  let accueil = () => {}
  const accueilli = new Promise<void>(ok => { accueil = ok })
  const b: Brut = {
    trames: [],
    envoyer(t, p) { s.send(JSON.stringify({ t, p })) },
    requete(t, p) {
      const id = ++idRequete
      return new Promise((ok, ko) => {
        const minuterie = setTimeout(() => ko(new Error('sans accusé : ' + t)), 5000)
        attentes.set(id, m => { clearTimeout(minuterie); attentes.delete(id); ok(m) })
        s.send(JSON.stringify({ t, p, id }))
      })
    },
    fermer() { s.close() }
  }
  s.onmessage = (ev: any) => {
    const m = JSON.parse(ev.data)
    b.trames.push(m)
    if (m.t === 'µ:welcome') accueil()
    if (m.t === 'µ:ack') attentes.get(m.id)?.(m)
  }
  await new Promise(r => setImmediate(r))
  b.envoyer('µ:hello', { protocol: 1, ...(uid ? { auth: { uid } } : {}) })
  await accueilli
  return b
}

async function membre(transport: MemoryTransport, uid: string): Promise<Brut> {
  const b = await brut(transport, uid)
  b.envoyer('µ:join', { room: 'lobby:hall' })
  const ack = await b.requete('lobby:enter', {})
  assert.equal(ack.e, undefined, 'entrée acceptée')
  return b
}

async function attendre(b: Brut, pred: (m: any) => boolean): Promise<any> {
  for (let i = 0; i < 3000; i++) {
    const m = b.trames.find(pred)
    if (m) return m
    await new Promise(r => setTimeout(r, 1))
  }
  throw new Error('trame attendue jamais reçue')
}

async function demarrer(): Promise<{ transport: MemoryTransport, app: MjsWsApp, pkg: any }> {
  const transport = new MemoryTransport()
  const app = mjsWs({ transport, heartbeat: 0, ban: false, onLog: () => {}, auth: (h: any) => (h.auth?.uid ? { id: h.auth.uid, name: h.auth.uid } : {}), limits: { rate: 100000, burst: 100000, kickAfter: 100000 } as any })
  const pkg: any = lobbyPackage({ onLog: () => {} })
  app.use(pkg)
  await app.listen()
  return { transport, app, pkg }
}

describe('MJS-WS — lobby : les débits suivent l\'identité, même sortie du hall', function () {
  this.timeout(120000)
  beforeEach(() => { maintenant = vraiNow(); Date.now = () => maintenant })
  afterEach(() => { Date.now = vraiNow })

  it('sortir du hall et y rentrer ne rend aucun jeton : 6 invitations, 6 annonces et 1 statut en trois allers-retours', async () => {
    const { transport, app } = await demarrer()
    try {
      const alice = await membre(transport, 'alice')
      const bob   = await membre(transport, 'bob')
      for (let k = 0; k < 3; k++) {
        if (k > 0) {
          alice.envoyer('µ:leave', { room: 'lobby:hall' })
          alice.envoyer('µ:join', { room: 'lobby:hall' })
          await alice.requete('lobby:enter', {})
        }
        for (let i = 0; i < 7; i++) alice.envoyer('lobby:invite', { identityId: 'bob' })
        for (let i = 0; i < 7; i++) alice.envoyer('lobby:advertise', { title: 'table ' + k + '-' + i })
        for (let i = 0; i < 2; i++) alice.envoyer('lobby:status', { status: i ? 'busy' : 'away', text: 'pub ' + k })
        await alice.requete('lobby:enter', {})
      }
      await bob.requete('lobby:enter', {})
      const invitations = bob.trames.filter(m => m.t === 'lobby:invitation').length
      const annonces    = bob.trames.filter(m => m.t === 'lobby:listing').length
      const statuts     = bob.trames.filter(m => m.t === 'lobby:member' && m.p.id === 'alice' && m.p.text).length
      console.log(`      trois allers-retours : ${invitations} invitations, ${annonces} annonces, ${statuts} statuts reçus par bob`)
      assert.equal(invitations, 6, 'six invitations au plus, sortie du hall ou non')
      assert.equal(annonces, 6, 'six annonces au plus, sortie du hall ou non')
      assert.equal(statuts, 1, 'un changement de statut par 5 s, sortie du hall ou non')
    } finally {
      await app.stop()
    }
  })

  it('les débits gardés des partis ne grandissent pas : 1 000 partis, 1 000 entrées ; 10 000 au plus ; 0 une fois leurs seaux pleins', async () => {
    const { transport, app, pkg } = await demarrer()
    try {
      const resident = await membre(transport, 'resident')
      const table = () => pkg._departedRates as Map<string, unknown> | undefined
      let apres1000 = -1
      for (let i = 1; i <= 10001; i++) {
        const v = await membre(transport, 'passant-' + i)
        v.envoyer('lobby:status', { status: 'busy' })
        await v.requete('lobby:enter', {})
        v.fermer()
        if (i === 1000) { await resident.requete('lobby:enter', {}); apres1000 = table()?.size ?? -1 }
      }
      await resident.requete('lobby:enter', {})
      const auPlafond = table()?.size ?? -1
      // leurs seaux se remplissent, le délai de statut passe : le balayage suivant (50 actions de membres) les oublie
      maintenant += 10 * 60 * 1000
      for (let i = 0; i < 50; i++) await resident.requete('lobby:enter', {})
      const apresBalayage = table()?.size ?? -1
      console.log(`      débits gardés : ${apres1000} après 1 000 partis, ${auPlafond} après 10 001, ${apresBalayage} après le balayage`)
      assert.equal(apres1000, 1000, 'un départ récent garde ses débits')
      assert.equal(auPlafond, 10000, 'au plus 10 000 débits gardés')
      assert.equal(apresBalayage, 0, 'des débits qui ne retiennent plus rien sont oubliés')
    } finally {
      await app.stop()
    }
  })

  it('un blocage n\'arrête que les invitations : le bloqué rejoint encore la table de celui qui l\'a bloqué', async () => {
    const { transport, app } = await demarrer()
    try {
      const alice = await membre(transport, 'alice')
      const bob   = await membre(transport, 'bob')
      alice.envoyer('lobby:advertise', { title: 'ma table' })
      const annonce = await attendre(bob, m => m.t === 'lobby:listing')
      alice.envoyer('lobby:block', { identityId: 'bob' })
      await alice.requete('lobby:enter', {})
      bob.envoyer('lobby:invite', { identityId: 'alice' })
      bob.envoyer('lobby:join', { id: annonce.p.id })
      await bob.requete('lobby:enter', {})
      const candidat = await attendre(alice, m => m.t === 'lobby:applicant')
      await alice.requete('lobby:enter', {})
      assert.equal(alice.trames.filter(m => m.t === 'lobby:invitation').length, 0, 'l\'invitation du bloqué est ignorée')
      assert.equal(candidat.p.from.id, 'bob', 'le bloqué rejoint la table quand même')
    } finally {
      await app.stop()
    }
  })
})
