// *heatmap : le premier point d'une visite n'est pas perdu. La connexion MJS WS est paresseuse (rien ne l'ouvre avant
// le premier envoi) et se rouvre seule après une coupure : un point qui attend la fait ouvrir, puis part quand elle est
// `open` — il n'est jamais jeté en route (au plus 20 attendent : les plus anciens s'oublient). Le vrai effet
// (mjs_fx_heatmap.ts), la vraie connexion µ.socket (mjs_socket.ts) et le vrai paquet heatmapPackage, par un MemoryTransport.

import assert from 'node:assert/strict'
import { visite, attendre, tick, attendus, place } from './helpers/chaleur-visite.js'

describe('*heatmap — la connexion paresseuse : le premier point part', function () {
  this.timeout(40000)

  it('un clic unique, rien n\'ayant ouvert la connexion avant lui : elle s\'ouvre, le serveur reçoit le point', async () => {
    const v = await visite({ connecte: false })
    v.pose(v.el)
    assert.equal(v.sock.state, 'closed', 'paresseuse : rien ne l\'a ouverte')
    v.clic(0)
    await attendre(() => v.recus.length >= 1, 3000)
    assert.deepEqual(v.places(), [place(0)], `${v.recus.length} point reçu sur 1`)
    assert.equal(v.sock.state, 'open', 'le point en attente l\'a fait ouvrir')
    assert.equal(v.connexions(), 1, 'une seule connexion')
    await v.fermer()
  })

  it('20 clics à 110 ms d\'écart, sans `sock.connect()` préalable : le serveur reçoit les 20, dans l\'ordre', async () => {
    const v = await visite({ connecte: false })
    v.pose(v.el)
    for (let i = 0; i < 20; i++) { v.clic(i); await tick(110) }
    await attendre(() => v.recus.length >= 20)
    assert.deepEqual(v.places(), attendus(20), `${v.recus.length} points reçus sur 20`)
    await v.fermer()
  })

  it('la connexion s\'ouvre pour de bon : pas de connexion de plus à chaque point qui attend', async () => {
    const v = await visite({ connecte: false })
    v.pose(v.el)
    for (let i = 0; i < 5; i++) { v.clic(i); await tick(110) }
    await attendre(() => v.recus.length >= 5)
    assert.deepEqual(v.places(), attendus(5), `${v.recus.length} points reçus sur 5`)
    assert.equal(v.connexions(), 1)
    await v.fermer()
  })
})

describe('*heatmap — pendant une reconnexion, les points attendent l\'ouverture', function () {
  this.timeout(40000)

  // la coupure : le lien tombe, la connexion se rouvre seule un peu plus tard (le délai de `reconnexion`)
  const coupe = (v: any) => v.sock._mjs_ws.close(1006, 'coupure')

  it('un clic pendant que la connexion est coupée attend qu\'elle soit rouverte, puis part', async () => {
    const v = await visite({ reconnexion: 500 })
    v.pose(v.el)
    v.clic(0)
    await attendre(() => v.recus.length >= 1)
    coupe(v)
    await tick(110)
    assert.equal(v.sock.state, 'reconnecting', 'la connexion est tombée, elle se rouvre dans un moment')
    v.clic(1)
    await attendre(() => v.recus.length >= 2, 4000)
    assert.deepEqual(v.places(), attendus(2), `${v.recus.length} points reçus sur 2`)
    assert.equal(v.sock.state, 'open')
    await v.fermer()
  })

  it('un lot qui attend la part des effets quand la connexion tombe : il part à la reconnexion', async () => {
    const v = await visite({ reconnexion: 400, rate: 1 })
    v.pose(v.el)
    v.clic(0)
    await attendre(() => v.recus.length >= 1)
    await tick(110)
    // la part est épuisée : ces deux-là attendent
    v.clic(1)
    await tick(110)
    v.clic(2)
    assert.equal(v.recus.length, 1)
    coupe(v)
    await attendre(() => v.recus.length >= 3, 6000)
    assert.deepEqual(v.places(), attendus(3), `${v.recus.length} points reçus sur 3`)
    await v.fermer()
  })

  it('au plus 20 points attendent : les plus anciens s\'oublient, les 20 derniers partent à l\'ouverture', async () => {
    // la reconnexion tarde : 30 clics pendant la coupure (l'horloge avance d'un coup entre eux : la porte de 100 ms de l'effet les laisse passer)
    const v = await visite({ reconnexion: 1500 })
    v.pose(v.el)
    coupe(v)
    const maintenant = Date.now
    try {
      for (let i = 0; i < 30; i++) { Date.now = () => maintenant() + 1000 * (i + 1); v.clic(i) }
    }
    finally { Date.now = maintenant }
    assert.equal(v.recus.length, 0)
    await attendre(() => v.recus.length >= 20, 8000)
    await tick(300)
    assert.deepEqual(v.places(), attendus(30).slice(10), 'les 20 plus récents, pas un de plus')
    await v.fermer()
  })
})

describe('*heatmap — une connexion que l\'appli a fermée n\'est pas rouverte par un point', function () {
  this.timeout(40000)

  it('close() par l\'appli : le point attend, rien ne se rouvre ; quand l\'appli rouvre, il part avec le suivant', async () => {
    const v = await visite()
    v.pose(v.el)
    v.sock.close()
    assert.equal(v.sock.state, 'closed')
    const avant = v.connexions()
    // le lot attend le point suivant, sans minuteur qui tourne à vide : rien ne peut s'ouvrir tant que l'appli ne le veut pas
    const reel = globalThis.setTimeout
    let relances = 0
    ;(globalThis as any).setTimeout = (f: any, ms?: number, ...reste: any[]) => { if (ms === 100) relances++; return (reel as any)(f, ms, ...reste) }
    try {
      v.clic(0)
      await tick(400)
    }
    finally { globalThis.setTimeout = reel }
    assert.equal(relances, 0, 'aucun minuteur de 100 ms ne relance l\'envoi')
    assert.equal(v.connexions(), avant, 'aucune connexion de plus : l\'appli l\'a voulue fermée')
    assert.equal(v.sock.state, 'closed')
    assert.equal(v.recus.length, 0)
    v.sock.connect()
    await attendre(() => v.sock.state === 'open')
    await tick(150)
    v.clic(1)
    await attendre(() => v.recus.length >= 2, 4000)
    assert.deepEqual(v.places(), attendus(2), 'le point qui attendait part avec le suivant')
    await v.fermer()
  })
})
