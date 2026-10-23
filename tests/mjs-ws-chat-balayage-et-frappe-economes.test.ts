// Discussion : un client qui n'est membre d'aucun salon faisait tourner les balayages de mémoire (un toutes les 50
// actions, lancé avant même le contrôle d'appartenance), qui parcourent les seaux, muets et textes de tous les salons ; et
// l'indicateur de frappe encodait sa charge une fois par membre du salon. Seules les actions des membres comptent pour le
// balayage, et la frappe est encodée une seule fois pour tout le salon — mêmes destinataires, toujours hors de l'historique
import assert from 'node:assert/strict'
import { mjsWs, chatPackage } from '../src/mjs-ws/index.js'
import { MemoryTransport } from '../src/mjs-ws/transport.js'

const tick = (ms = 0) => new Promise<void>(r => setTimeout(r, ms))

// un encodage compté : un JSON.stringify appelé depuis le serveur temps réel (src/mjs-ws/), lu sur la pile d'appel. Le reste du
// process ne compte pas : une fenêtre happy-dom laissée par un fichier de tests précédent, où un effet tourne encore, appelle
// JSON.stringify des milliers de fois pendant les 30 ms de la frappe
const parLeServeur = (): boolean => /[\\/]src[\\/]mjs-ws[\\/]/.test(new Error().stack ?? '')

async function connexion(transport: MemoryTransport, nom: string): Promise<{ trames: any[]; envoyer: (t: string, p: unknown) => void }> {
  const ws = transport.connect({ url: 'ws://' + nom + '/' })
  const trames: any[] = []
  ws.onmessage = (ev: any) => trames.push(JSON.parse(ev.data))
  const envoyer = (t: string, p: unknown) => ws.send(JSON.stringify({ t, p }))
  await tick()
  envoyer('µ:hello', { protocol: 1 })
  await tick(5)
  return { trames, envoyer }
}

describe('MJS-WS — discussion : balayage réservé aux membres, frappe encodée une fois', function () {
  this.timeout(20000)

  it('120 actions d’un non-membre ne lancent aucun balayage ; celles d’un membre, si', async () => {
    const transport = new MemoryTransport()
    const app = mjsWs({ transport, heartbeat: 0, onLog: () => {}, limits: { rate: 10000, burst: 10000 } })
    const pkg = chatPackage({ onLog: () => {} })
    app.use(pkg)
    await app.listen()
    try {
      const a = await connexion(transport, 'a')
      a.envoyer('µ:join', { room: 'chat:salle' })
      await tick(5)
      a.envoyer('chat:send', { room: 'salle', text: 'bonjour' })
      await tick(5)
      a.envoyer('µ:leave', { room: 'chat:salle' })
      await tick(5)
      assert.equal((pkg as any)._buckets.has('chat:salle'), true, 'seau du salon vidé encore là')
      const intrus = await connexion(transport, 'intrus')
      for (let i = 0; i < 120; i++) intrus.envoyer('chat:typing', { room: 'salle' })
      await tick(30)
      assert.equal((pkg as any)._buckets.has('chat:salle'), true, 'aucun balayage lancé par un non-membre')
      const m = await connexion(transport, 'membre')
      m.envoyer('µ:join', { room: 'chat:autre' })
      await tick(5)
      for (let i = 0; i < 60; i++) m.envoyer('chat:typing', { room: 'autre' })
      await tick(30)
      assert.equal((pkg as any)._buckets.has('chat:salle'), false, 'balayage lancé par les actions d’un membre')
    } finally {
      await app.stop()
    }
  })

  it('frappe dans un salon de 50 membres : charge encodée une fois, reçue par les 49 autres, absente de l’historique', async () => {
    const transport = new MemoryTransport()
    const app = mjsWs({ transport, heartbeat: 0, onLog: () => {}, limits: { rate: 10000, burst: 10000 } })
    app.use(chatPackage({ onLog: () => {} }))
    await app.listen()
    try {
      const membres = []
      for (let i = 0; i < 50; i++) {
        const c = await connexion(transport, 'm' + i)
        c.envoyer('µ:join', { room: 'chat:salle' })
        membres.push(c)
      }
      await tick(20)
      membres[0].envoyer('chat:send', { room: 'salle', text: 'bonjour' })
      await tick(20)
      const original = JSON.stringify
      let encodages = 0
      ;(JSON as any).stringify = function (...args: any[]) { if (parLeServeur()) encodages++; return (original as any).apply(JSON, args) }
      try {
        membres[0].envoyer('chat:typing', { room: 'salle' })
        await tick(30)
      } finally {
        ;(JSON as any).stringify = original
      }
      assert.ok(encodages > 0, 'aucun encodage du serveur compté : le compte ne le voit plus')
      assert.ok(encodages <= 2, `encodages pour une frappe : ${encodages} (un seul mesuré, marge d'un)`)
      const frappes = membres.map(c => c.trames.filter(f => f.t === 'chat:typing').length)
      assert.equal(frappes[0], 0, 'l’auteur ne reçoit pas sa propre frappe')
      assert.deepEqual(frappes.slice(1), new Array(49).fill(1), 'chacun des 49 autres la reçoit une fois')
      assert.equal(membres[1].trames.find(f => f.t === 'chat:typing').p.room, 'salle')
      const tard = await connexion(transport, 'tard')
      tard.envoyer('µ:join', { room: 'chat:salle' })
      await tick(20)
      assert.deepEqual(tard.trames.filter(f => f.t === 'chat:message' || f.t === 'chat:typing').map(f => f.t), ['chat:message'], 'historique : le message, jamais la frappe')
    } finally {
      await app.stop()
    }
  })
})
