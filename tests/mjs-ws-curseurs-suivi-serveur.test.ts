// Serveurs des curseurs (cursors.ts) et du suivi (follow.ts) :
//   - les positions regroupées d'un grand salon : un visiteur actif voit autant de curseurs des autres
//     qu'il en demande (sa propre position ne prend pas de place) ; le `max` d'un visiteur ne règle pas la
//     trame de tout le salon (elle est bornée) ;
//   - une position du suivi vide (`a: []`) est refusée ;
//   - la dernière position d'un salon part avec lui : deux arrivants dans un salon vidé ne reçoivent pas
//     celle d'un autre cours — mais un salon que d'autres tiennent encore la rend, même si celui qui
//     menait est parti ou recharge sa page ; celui qui mène en est témoin sans l'avoir demandée, et un
//     salon vidé la purge pour de bon (un témoin d'avant qui revient ne la fait pas rendre).

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { mjsWs, cursorsPackage, followPackage } from '../src/mjs-ws/index.js'
import { cleanSpot } from '../src/mjs-ws/follow.js'
import { MemoryTransport } from '../src/mjs-ws/transport.js'

const ICI       = dirname(fileURLToPath(import.meta.url))
const socketSrc = readFileSync(join(ICI, '../src/runtime/mjs_socket.ts'), 'utf8')
const tick      = (ms = 0) => new Promise<void>(r => setTimeout(r, ms))

function makeClient(transport: MemoryTransport): any {
  ;(globalThis as any).WebSocket = function(url: string, protocols?: any) { return transport.connect({ url, protocols }) }
  const µ: any = { state: (o: any) => ({ ...o }), error: () => {}, warn: () => {}, log: () => {} }
  new Function('µ', socketSrc)(µ)
  return µ
}

// un serveur factice : ce que les paquets demandent à `app` (serve, on, room), les salons tenus à la main
function fauxServeur(pkg: any) {
  const serves: Record<string, any> = {}
  const ons: Record<string, any>    = {}
  const salons                      = new Map<string, Set<any>>()
  const envoyes: any[]              = []
  const app: any                    = {
    serve: (t: string, f: any) => { serves[t] = f },
    on: (t: string, f: any) => { ons[t] = f },
    room: (nom: string) => {
      const membres = () => salons.get(nom) ?? new Set<any>()
      return {
        get clients() { return membres().values() },
        get size() { return membres().size },
        has: (c: any) => membres().has(c),
        send: (type: string, p: any, o?: any) => { envoyes.push([nom, type, p, o]) },
      }
    },
  }
  pkg.installer(app)
  const entre = (nom: string, c: any) => { if (!salons.has(nom)) salons.set(nom, new Set()); salons.get(nom)!.add(c) }
  const sort  = (nom: string, c: any) => { salons.get(nom)?.delete(c) }
  return { serves, ons, envoyes, entre, sort }
}

const visiteur = (n: number) => ({ id: 'c' + n, identity: { id: 'u' + n, name: 'Visiteur ' + n } })
const ou       = { a: [0], x: 0.5, y: 0.5 }

describe('mjs-ws — curseurs : les positions regroupées', function () {
  this.timeout(20000)

  it('un visiteur actif voit autant de curseurs des autres qu\'il en demande : sa propre position ne prend pas de place dans la trame', async () => {
    const s    = fauxServeur(cursorsPackage({ groupFrom: 3 }))
    const gens = [1, 2, 3, 4, 5].map(visiteur)
    for (const c of gens) {
      s.entre('cursors:doc', c)
      await s.serves['cursors:me']({ max: 2 }, c)
    }
    for (const c of gens) await s.ons['cursors:move']({ room: 'doc', p: ou }, c)
    await tick(320)
    const trames = s.envoyes.filter((e) => e[1] === 'cursors:moves')
    assert.equal(trames.length, 1, 'une trame regroupée')
    const liste = trames[0][2].list
    for (const c of gens) {
      const autres = liste.filter((e: any) => e.from.id !== c.identity.id).length
      assert.ok(autres >= 2, `${c.identity.name} : ${autres} curseur(s) des autres dans la trame de ${liste.length}, il en demande 2`)
    }
  })

  it('le `max` d\'un visiteur ne règle pas la trame de tout le salon : elle est bornée (100 positions et la sienne), quel que soit ce qu\'il demande', async () => {
    const s    = fauxServeur(cursorsPackage())
    const gens = Array.from({ length: 130 }, (_, i) => visiteur(i + 1))
    for (const c of gens) s.entre('cursors:doc', c)
    // un visiteur demande 1000 curseurs, les autres le défaut
    await s.serves['cursors:me']({ max: 1000 }, gens[0])
    for (const c of gens.slice(1)) await s.serves['cursors:me']({}, c)
    for (const c of gens) await s.ons['cursors:move']({ room: 'doc', p: ou }, c)
    await tick(320)
    const trames = s.envoyes.filter((e) => e[1] === 'cursors:moves')
    assert.equal(trames.length, 1, 'une trame regroupée')
    assert.equal(trames[0][2].list.length, 101, 'au plus 100 positions, et celle du visiteur qui la reçoit')
  })

  it('sans visiteur gourmand, la trame suit le plus grand `max` des visiteurs (le défaut : 20), plus la place de la sienne', async () => {
    const s    = fauxServeur(cursorsPackage({ groupFrom: 3 }))
    const gens = Array.from({ length: 40 }, (_, i) => visiteur(i + 1))
    for (const c of gens) s.entre('cursors:doc', c)
    for (const c of gens) await s.ons['cursors:move']({ room: 'doc', p: ou }, c)
    await tick(320)
    assert.equal(s.envoyes.filter((e) => e[1] === 'cursors:moves')[0][2].list.length, 21)
  })
})

describe('mjs-ws — suivi : une position vide, la dernière position d\'un salon', function () {
  this.timeout(20000)

  it('une position sans balise (`a: []`) est refusée, comme une position mal formée', async () => {
    assert.equal(cleanSpot({ a: [], y: 0 }), null)
    assert.deepEqual(cleanSpot({ a: [0], y: 0 }), { a: [0], y: 0 }, 'une balise : acceptée')
    const s    = fauxServeur(followPackage({ canLead: () => true }))
    const prof = visiteur(1)
    s.entre('follow:cours', prof)
    await s.ons['follow:at']({ room: 'cours', a: [], y: 0 }, prof)
    assert.deepEqual(s.envoyes, [], 'rien n\'est rediffusé')
    const eleve = visiteur(2)
    s.entre('follow:cours', eleve)
    assert.equal(await s.serves['follow:last']({ room: 'cours' }, eleve), null, 'rien n\'est gardé')
  })

  it('deux élèves qui arrivent dans un salon vidé ne reçoivent pas la position du cours d\'avant (vrais clients, vrai serveur)', async () => {
    const transport = new MemoryTransport()
    const app       = mjsWs({ transport, heartbeat: 0, auth: (h: any) => h.auth, onLog: () => {} } as any)
    app.use(followPackage({ canLead: () => true }))
    await app.listen()
    const ouvre = async (url: string, qui: any) => {
      const µ = makeClient(transport)
      const s = µ.socket(url, { auth: () => qui, reconnect: { enabled: false } })
      s.connect()
      await tick(5)
      return s
    }
    const prof  = await ouvre('memory://p', { id: 'p', name: 'Prof' })
    const salon = prof.room('follow:cours')
    await tick(5)
    prof.send('follow:at', { room: 'cours', a: [7, 1], y: 0.5 })
    await tick(5)
    salon.leave()
    await tick(5)
    const e1 = await ouvre('memory://e1', { id: 'e1', name: 'E1' })
    const e2 = await ouvre('memory://e2', { id: 'e2', name: 'E2' })
    e1.room('follow:cours')
    e2.room('follow:cours')
    await tick(10)
    assert.equal(await e1.request('follow:last', { room: 'cours' }), null, 'le premier arrivé, salon à deux')
    assert.equal(await e2.request('follow:last', { room: 'cours' }), null, 'le second')
    for (const s of [prof, e1, e2]) s.destroy()
    await app.stop()
  })

  it('un salon que d\'autres tiennent encore rend la position : celui qui menait est parti, ou recharge sa page', async () => {
    const s    = fauxServeur(followPackage({ canLead: () => true }))
    const prof = visiteur(1)
    const e1   = visiteur(2)
    const e2   = visiteur(3)
    const e3   = visiteur(4)
    // l'élève 1 est là avant que le prof ne mène : il demande en arrivant (rien encore)
    s.entre('follow:cours', e1)
    assert.equal(await s.serves['follow:last']({ room: 'cours' }, e1), null, 'rien à rendre')
    s.entre('follow:cours', prof)
    await s.ons['follow:at']({ room: 'cours', a: [3, 1], y: 0.25 }, prof)
    // le prof part, l'élève 2 arrive : l'élève 1 y est resté
    s.sort('follow:cours', prof)
    s.entre('follow:cours', e2)
    assert.equal(JSON.stringify(await s.serves['follow:last']({ room: 'cours' }, e2)), '{"a":[3,1],"y":0.25}', 'l\'élève 1 est resté : la position est rendue')
    // le prof revient (une autre connexion), l'élève 1 part : l'élève 2, à qui elle a été rendue, reste
    s.entre('follow:cours', visiteur(1))
    s.sort('follow:cours', e1)
    s.entre('follow:cours', e3)
    assert.equal(JSON.stringify(await s.serves['follow:last']({ room: 'cours' }, e3)), '{"a":[3,1],"y":0.25}', 'l\'élève 2 est resté')
  })

  it('le salon se vide pour de bon, puis revient : rien ne reste de la position d\'avant', async () => {
    const s    = fauxServeur(followPackage({ canLead: () => true }))
    const prof = visiteur(1)
    const e1   = visiteur(2)
    s.entre('follow:cours', e1)
    await s.serves['follow:last']({ room: 'cours' }, e1)
    s.entre('follow:cours', prof)
    await s.ons['follow:at']({ room: 'cours', a: [3, 1], y: 0.25 }, prof)
    s.sort('follow:cours', prof)
    s.sort('follow:cours', e1)
    const a = visiteur(5)
    const b = visiteur(6)
    s.entre('follow:cours', a)
    s.entre('follow:cours', b)
    assert.equal(await s.serves['follow:last']({ room: 'cours' }, a), null, 'le premier arrivé')
    assert.equal(await s.serves['follow:last']({ room: 'cours' }, b), null, 'le second')
    // un nouveau prof mène : sa position, elle, est rendue
    const prof2 = visiteur(7)
    s.entre('follow:cours', prof2)
    await s.ons['follow:at']({ room: 'cours', a: [9], y: 0 }, prof2)
    const c = visiteur(8)
    s.entre('follow:cours', c)
    assert.equal(JSON.stringify(await s.serves['follow:last']({ room: 'cours' }, c)), '{"a":[9],"y":0}')
  })

  it('celui qui mène est un témoin de sa position, même sans l\'avoir jamais demandée : l\'élève qui arrive la reçoit tant que le prof est là', async () => {
    const s    = fauxServeur(followPackage({ canLead: () => true }))
    const prof = visiteur(1)
    s.entre('follow:cours', prof)
    await s.ons['follow:at']({ room: 'cours', a: [3, 1], y: 0.25 }, prof)
    const eleve = visiteur(2)
    s.entre('follow:cours', eleve)
    assert.equal(JSON.stringify(await s.serves['follow:last']({ room: 'cours' }, eleve)), '{"a":[3,1],"y":0.25}', 'le prof, resté dans le salon, l\'a posée : il en témoigne')
  })

  it('un salon vidé purge la position : un témoin d\'avant qui revient (même connexion) ne la fait pas rendre à un autre arrivant', async () => {
    const s    = fauxServeur(followPackage({ canLead: () => true }))
    const prof = visiteur(1)
    const e1   = visiteur(2)
    const e2   = visiteur(3)
    const e3   = visiteur(4)
    // l'élève 1 demande en arrivant, avant que le prof ne mène : il est témoin de ce qui sera posé ensuite
    s.entre('follow:cours', e1)
    assert.equal(await s.serves['follow:last']({ room: 'cours' }, e1), null, 'rien encore')
    s.entre('follow:cours', prof)
    await s.ons['follow:at']({ room: 'cours', a: [3, 1], y: 0.25 }, prof)
    // le salon se vide, l'élève 2 y arrive seul : rien n'est rendu, et la position d'avant est purgée
    s.sort('follow:cours', prof)
    s.sort('follow:cours', e1)
    s.entre('follow:cours', e2)
    assert.equal(await s.serves['follow:last']({ room: 'cours' }, e2), null, 'le salon était vidé : la position est celle d\'un autre cours')
    // l'élève 1 revient, l'élève 3 arrive : l'élève 1 est un témoin d'avant, mais la position n'existe plus
    s.entre('follow:cours', e1)
    s.entre('follow:cours', e3)
    assert.equal(await s.serves['follow:last']({ room: 'cours' }, e3), null, 'la position d\'avant a été purgée : elle ne revient pas')
  })
})
