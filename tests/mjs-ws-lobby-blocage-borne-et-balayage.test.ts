// Paquet LOBBY (src/mjs-ws/lobby.ts) — deux bornes contre un client qui abuse du hall :
// - `lobby:block` : un identifiant de plus de 128 caractères est refusé (`lobby-block-invalid`) et un membre
//   ne garde pas plus de 256 blocages (`lobby-block-limit` au-delà) — sans borne, un seul client faisait
//   retenir au serveur des millions de caractères (jusqu'à 64 Ko par trame, 40 trames par seconde) ; seule une
//   identité présente dans le hall se bloque (cf. tests/mjs-ws-lobby-blocages-cible-presente-borne-par-identite.test.ts) ;
// - le balayage de la présence : un client qui n'est pas membre du hall ne le déclenche plus (ses trames
//   refusées ne comptent pas), et un balayage parcourt les connexions du hall une fois, pas une fois par
//   membre (le coût était membres × connexions : 25 ms de boucle gelée pour un hall de 2 000 membres).
// Clients bruts (trames JSON à la main) sur MemoryTransport.
import assert from 'node:assert/strict'
import { performance } from 'node:perf_hooks'
import { mjsWs, lobbyPackage } from '../src/mjs-ws/index.js'
import { MemoryTransport } from '../src/mjs-ws/transport.js'
import type { MjsWsApp, MjsWsOptions } from '../src/mjs-ws/index.js'

const tick = (ms = 0) => new Promise<void>(r => setTimeout(r, ms))

interface Brut {
  trames: any[]
  envoyer(o: unknown): void
  attendre(pred: (m: any) => boolean, ms?: number): Promise<any>
  fermer(): void
}

async function brut(transport: MemoryTransport, uid?: string): Promise<Brut> {
  const s: any = transport.connect({})
  const b: Brut = {
    trames: [],
    envoyer(o) { s.send(JSON.stringify(o)) },
    async attendre(pred, ms = 5000) {
      const t0 = Date.now()
      for (;;) {
        const i = b.trames.findIndex(pred)
        if (i >= 0) return b.trames.splice(i, 1)[0]
        if (Date.now() - t0 > ms) throw new Error('attente expirée')
        await tick(1)
      }
    },
    fermer() { s.close() }
  }
  s.onmessage = (ev: any) => { b.trames.push(JSON.parse(ev.data)) }
  await tick()
  b.envoyer({ t: 'µ:hello', p: { protocol: 1, ...(uid ? { auth: { uid } } : {}) } })
  await b.attendre(m => m.t === 'µ:welcome')
  return b
}

let idRequete = 0
async function requete(b: Brut, t: string, p: unknown): Promise<any> {
  const id = ++idRequete
  b.envoyer({ t, p, id })
  return b.attendre(m => m.t === 'µ:ack' && m.id === id)
}

async function demarrer(wsOpts: MjsWsOptions = {}): Promise<{ transport: MemoryTransport, app: MjsWsApp, pkg: any }> {
  const transport = new MemoryTransport()
  const app = mjsWs({ transport, heartbeat: 0, onLog: () => {}, ...wsOpts })
  const pkg: any = lobbyPackage({ onLog: () => {} })
  app.use(pkg)
  await app.listen()
  return { transport, app, pkg }
}

// un membre du hall par défaut : µ:join du salon puis lobby:enter
async function membre(transport: MemoryTransport, uid?: string): Promise<{ b: Brut, id: string }> {
  const b = await brut(transport, uid)
  b.envoyer({ t: 'µ:join', p: { room: 'lobby:hall' } })
  const ack = await requete(b, 'lobby:enter', {})
  assert.equal(ack.e, undefined, 'entrée acceptée')
  return { b, id: ack.p.me.id }
}

describe('MJS-WS — lobby : blocages bornés, balayage réservé aux membres et linéaire', function () {
  this.timeout(60000)

  it('lobby:block — un identifiant de plus de 128 caractères est refusé (lobby-block-invalid), rien n\'est gardé ; une identité présente de 128 passe', async () => {
    const { transport, app, pkg } = await demarrer({ auth: (h: any) => (h.auth?.uid ? { id: h.auth.uid } : {}) })
    const { b, id } = await membre(transport)
    assert.equal((await membre(transport, 'z'.repeat(128))).id, 'z'.repeat(128), 'une identité de 128 caractères est dans le hall')
    b.envoyer({ t: 'lobby:block', p: { identityId: 'x'.repeat(129) } })
    const err = await b.attendre(m => m.t === 'µ:error')
    assert.equal(err.p.message, 'lobby-block-invalid')
    b.envoyer({ t: 'lobby:block', p: { identityId: 'y'.repeat(65000) } })
    assert.equal((await b.attendre(m => m.t === 'µ:error')).p.message, 'lobby-block-invalid')
    b.envoyer({ t: 'lobby:block', p: { identityId: 'z'.repeat(128) } })
    await requete(b, 'lobby:enter', {})
    const entree = pkg._presence.get('lobby:hall').get(id)
    assert.deepEqual([...entree.blocked], ['z'.repeat(128)])
    b.fermer()
    await app.stop()
  })

  it('lobby:block — un membre garde 256 blocages au plus : au-delà, lobby-block-limit et rien de plus n\'est gardé ; rebloquer un identifiant déjà bloqué reste permis', async () => {
    const { transport, app, pkg } = await demarrer({ limits: { rate: 10000, burst: 10000 } })
    const { b, id } = await membre(transport)
    // 300 identités présentes dans le hall : seule une identité présente se bloque
    const cibles: string[] = []
    for (let i = 0; i < 300; i += 50) cibles.push(...(await Promise.all(Array.from({ length: 50 }, () => membre(transport)))).map(m => m.id))
    // par lots de 100 : la file d'une connexion garde 200 trames au plus
    for (let lot = 0; lot < 3; lot++) {
      for (let i = 0; i < 100; i++) b.envoyer({ t: 'lobby:block', p: { identityId: cibles[lot * 100 + i] } })
      await requete(b, 'lobby:enter', {})
    }
    const entree = pkg._presence.get('lobby:hall').get(id)
    const refus = b.trames.filter(m => m.t === 'µ:error')
    console.log('      blocked.size =', entree.blocked.size, '· refus =', refus.length)
    assert.equal(entree.blocked.size, 256)
    assert.equal(refus.length, 44)
    assert.ok(refus.every(m => m.p.message === 'lobby-block-limit'))
    b.trames.length = 0
    b.envoyer({ t: 'lobby:block', p: { identityId: cibles[3] } })
    await requete(b, 'lobby:enter', {})
    assert.equal(b.trames.filter(m => m.t === 'µ:error').length, 0, 'rebloquer une identité déjà bloquée ne coûte rien')
    assert.equal(entree.blocked.size, 256)
    b.fermer()
    await app.stop()
  })

  // un départ du hall est annoncé dès la sortie du salon (sans balayage) : le témoin du balayage est une annonce expirée,
  // que seul le balayage retire du registre
  it('balayage — 100 trames lobby:* d\'un client qui n\'est membre d\'aucun hall ne le déclenchent pas : une annonce expirée reste jusqu\'au balayage d\'un membre', async () => {
    const transport = new MemoryTransport()
    const app = mjsWs({ transport, heartbeat: 0, onLog: () => {}, limits: { rate: 10000, burst: 10000 } })
    const pkg: any = lobbyPackage({ onLog: () => {}, listingTtlMs: 20 })
    app.use(pkg)
    await app.listen()
    const zora = await membre(transport)
    const theo = await membre(transport)
    zora.b.envoyer({ t: 'lobby:advertise', p: { title: 'Partie rapide' } })
    await tick(40)
    assert.equal(pkg._listings.get('lobby:hall')?.size, 1, 'annonce expirée, encore au registre')
    const intrus = await brut(transport)
    for (let i = 0; i < 100; i++) intrus.envoyer({ t: 'lobby:block', p: { hall: 'x', identityId: 'y' } })
    for (let i = 0; i < 100; i++) await intrus.attendre(m => m.t === 'µ:error')
    assert.equal(pkg._listings.get('lobby:hall')?.size, 1, 'aucun balayage déclenché par le non-membre')
    // 50 actions d'un membre : un balayage, l'annonce expirée part
    for (let i = 0; i < 50; i++) theo.b.envoyer({ t: 'lobby:block', p: { identityId: 'y' } })
    await requete(theo.b, 'lobby:enter', {})
    assert.equal(pkg._listings.has('lobby:hall'), false, 'balayage par un membre')
    intrus.fermer()
    zora.b.fermer()
    theo.b.fermer()
    await app.stop()
  })

  it('balayage — un hall de 300 membres : les connexions du hall sont parcourues une fois, pas une fois par membre', async () => {
    const { transport, app } = await demarrer({ limits: { rate: 10000, burst: 10000 } })
    const membres: Array<{ b: Brut, id: string }> = []
    for (let i = 0; i < 300; i += 50) membres.push(...await Promise.all(Array.from({ length: 50 }, () => membre(transport))))
    // compte les connexions lues dans room(<hall>).clients par le paquet
    let lues = 0
    const roomDOrigine = app.room.bind(app)
    app.room = (nom: string) => {
      const salon = roomDOrigine(nom)
      return new Proxy(salon, {
        get(cible, prop) {
          if (prop === 'clients') return (function* () { for (const c of cible.clients) { lues++; yield c } })()
          const v = Reflect.get(cible, prop, cible)
          return typeof v === 'function' ? v.bind(cible) : v
        }
      })
    }
    // 50 actions de suite d'un membre : exactement un balayage parmi elles
    const { b } = membres[0]
    const t0 = performance.now()
    for (let i = 0; i < 50; i++) b.envoyer({ t: 'lobby:block', p: { identityId: 'y' } })
    await requete(b, 'lobby:enter', {})
    const duree = performance.now() - t0
    console.log('      300 membres · connexions lues pendant 51 actions (un balayage) :', lues, '·', duree.toFixed(1), 'ms')
    assert.ok(lues > 0, 'un balayage a bien eu lieu')
    assert.ok(lues <= 3 * 300, lues + ' connexions lues : le balayage doit rester linéaire (au plus 900)')
    for (const m of membres) m.b.fermer()
    await app.stop()
  })
})
