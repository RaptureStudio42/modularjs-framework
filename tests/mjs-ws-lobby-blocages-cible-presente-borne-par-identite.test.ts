// Paquet LOBBY — `lobby:block` gardait n'importe quel identifiant, même celui de personne, et sa borne (256 blocages)
// valait par hall : un visiteur anonyme membre de 50 halls (un par salon rejoint) faisait retenir au serveur 2,5 Mo
// par connexion, sans expulsion. Désormais seule une identité présente dans le hall se bloque (une autre :
// `lobby-away`, comme pour une invitation), et la borne de 256 blocages vaut pour l'identité, tous halls confondus.
// Clients bruts (trames JSON à la main) sur MemoryTransport.
import assert from 'node:assert/strict'
import { mjsWs, lobbyPackage } from '../src/mjs-ws/index.js'
import { MemoryTransport } from '../src/mjs-ws/transport.js'
import type { MjsWsApp } from '../src/mjs-ws/index.js'

const tick = (ms = 0) => new Promise<void>(r => setTimeout(r, ms))

interface Brut { trames: any[]; envoyer(o: unknown): void; fermer(): void }

async function brut(transport: MemoryTransport): Promise<Brut> {
  const s: any = transport.connect({})
  const b: Brut = { trames: [], envoyer(o) { s.send(JSON.stringify(o)) }, fermer() { s.close() } }
  s.onmessage = (ev: any) => { b.trames.push(JSON.parse(ev.data)) }
  await tick()
  b.envoyer({ t: 'µ:hello', p: { protocol: 1 } })
  await attendre(b, m => m.t === 'µ:welcome')
  return b
}

async function attendre(b: Brut, pred: (m: any) => boolean, ms = 10000): Promise<any> {
  const t0 = Date.now()
  for (;;) {
    const i = b.trames.findIndex(pred)
    if (i >= 0) return b.trames.splice(i, 1)[0]
    if (Date.now() - t0 > ms) throw new Error('attente expirée')
    await tick(1)
  }
}

let idRequete = 0
async function requete(b: Brut, t: string, p: unknown): Promise<any> {
  const id = ++idRequete
  b.envoyer({ t, p, id })
  return attendre(b, m => m.t === 'µ:ack' && m.id === id)
}

// µ:join du salon du hall puis lobby:enter — rend l'identité vue par le hall
async function entrer(b: Brut, hall: string): Promise<string> {
  b.envoyer({ t: 'µ:join', p: { room: 'lobby:' + hall } })
  const ack = await requete(b, 'lobby:enter', { hall })
  assert.equal(ack.e, undefined, 'entrée acceptée dans ' + hall)
  return ack.p.me.id
}

async function demarrer(): Promise<{ transport: MemoryTransport; app: MjsWsApp; pkg: any }> {
  const transport = new MemoryTransport()
  const app = mjsWs({ transport, heartbeat: 0, onLog: () => {}, limits: { rate: 100000, burst: 100000 } })
  const pkg: any = lobbyPackage({ onLog: () => {} })
  app.use(pkg)
  await app.listen()
  return { transport, app, pkg }
}

function blocagesDe(pkg: any, id: string): number {
  let n = 0
  for (const membres of pkg._presence.values()) n += membres.get(id)?.blocked.size ?? 0
  return n
}

describe('MJS-WS — lobby : on ne bloque qu’une identité présente, 256 blocages par identité tous halls confondus', function () {
  this.timeout(60000)

  it('50 halls × 20 identifiants inventés : chaque blocage refusé (lobby-away), rien n’est gardé', async () => {
    const { transport, app, pkg } = await demarrer()
    try {
      const b  = await brut(transport)
      let moi  = ''
      for (let h = 0; h < 50; h++) {
        moi = await entrer(b, 'h' + h)
        for (let i = 0; i < 20; i++) b.envoyer({ t: 'lobby:block', p: { hall: 'h' + h, identityId: ('fantome-' + h + '-' + i + '-').padEnd(128, 'x') } })
        await requete(b, 'lobby:enter', { hall: 'h' + h })
      }
      const refus = b.trames.filter(m => m.t === 'µ:error')
      console.log('      50 halls × 20 cibles absentes : blocages gardés', blocagesDe(pkg, moi), '· refus', refus.length)
      assert.equal(blocagesDe(pkg, moi), 0, 'aucun identifiant inventé n’est gardé')
      assert.equal(refus.length, 1000)
      assert.ok(refus.every(m => m.p.message === 'lobby-away'), JSON.stringify(refus[0]))
    } finally {
      await app.stop()
    }
  })

  it('une identité présente se bloque ; au-delà de 256 blocages, tous halls confondus : lobby-block-limit, rien de plus n’est gardé', async () => {
    const { transport, app, pkg } = await demarrer()
    try {
      const bloqueur = await brut(transport)
      const moi      = await entrer(bloqueur, 'a')
      await entrer(bloqueur, 'b')
      // 129 identités présentes dans les deux halls
      const cibles: string[] = []
      for (let lot = 0; lot < 129; lot += 43) {
        const ids = await Promise.all(Array.from({ length: Math.min(43, 129 - lot) }, async () => {
          const c  = await brut(transport)
          const id = await entrer(c, 'a')
          await entrer(c, 'b')
          return id
        }))
        cibles.push(...ids)
      }
      assert.equal(cibles.length, 129)
      // hall a : les 129 ; hall b : 128 de plus = 257 blocages demandés, par lots (la file d'une connexion est bornée)
      const demandes = [...cibles.map(id => ({ hall: 'a', identityId: id })), ...cibles.slice(0, 128).map(id => ({ hall: 'b', identityId: id }))]
      for (let i = 0; i < demandes.length; i += 100) {
        for (const p of demandes.slice(i, i + 100)) bloqueur.envoyer({ t: 'lobby:block', p })
        await requete(bloqueur, 'lobby:enter', { hall: 'a' })
      }
      const refus = bloqueur.trames.filter(m => m.t === 'µ:error')
      console.log('      257 blocages sur deux halls : gardés', blocagesDe(pkg, moi), '· refus', JSON.stringify(refus.map(m => m.p.message)))
      assert.equal(blocagesDe(pkg, moi), 256, 'borne par identité, tous halls confondus')
      assert.deepEqual(refus.map(m => m.p.message), ['lobby-block-limit'])
      bloqueur.trames.length = 0
      bloqueur.envoyer({ t: 'lobby:block', p: { hall: 'a', identityId: cibles[0] } })
      await requete(bloqueur, 'lobby:enter', { hall: 'a' })
      assert.equal(bloqueur.trames.filter(m => m.t === 'µ:error').length, 0, 'rebloquer une identité déjà bloquée ne coûte rien')
    } finally {
      await app.stop()
    }
  })

  it('le décompte se libère au départ : la présence balayée d’un hall rend ses blocages', async () => {
    const { transport, app, pkg } = await demarrer()
    try {
      const bloqueur = await brut(transport)
      const moi      = await entrer(bloqueur, 'a')
      const autre    = await brut(transport)
      const cible    = await entrer(autre, 'a')
      bloqueur.envoyer({ t: 'lobby:block', p: { hall: 'a', identityId: cible } })
      await requete(bloqueur, 'lobby:enter', { hall: 'a' })
      assert.equal(blocagesDe(pkg, moi), 1)
      assert.equal(pkg._blockedCount.get(moi), 1)
      // le bloqueur quitte le hall ; 50 actions d'un membre balaient sa présence
      bloqueur.envoyer({ t: 'µ:leave', p: { room: 'lobby:a' } })
      await tick(10)
      for (let i = 0; i < 50; i++) autre.envoyer({ t: 'lobby:block', p: { hall: 'a', identityId: 'personne' } })
      await requete(autre, 'lobby:enter', { hall: 'a' })
      assert.equal(pkg._presence.get('lobby:a')?.has(moi), false, 'présence balayée')
      assert.equal(pkg._blockedCount.has(moi), false, 'plus aucun blocage compté pour cette identité')
    } finally {
      await app.stop()
    }
  })
})
