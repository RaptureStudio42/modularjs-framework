// *heatmap : UNE part de points par connexion. Le serveur ne prend que dix points par seconde par connexion (un seau de
// 20) ; les `*heatmap` d'une connexion se partagent un seau à jetons du même débit, que seuls ceux qui ont des points à
// envoyer vident, chacun son tour. Un effet lié mais qui n'émet pas ne coûte rien aux autres (le pas de 100 ms multiplié
// par le nombre d'effets liés faisait envoyer 1 point en 4 s à l'unique effet actif d'une liste de 50 cartes), et après une
// coupure, les points que N effets avaient gardés ne reviennent pas d'un coup sur le seau du serveur (jusqu'à 20 jetés).
// Le vrai effet, la vraie connexion µ.socket, le vrai paquet heatmapPackage, par un MemoryTransport.

import assert from 'node:assert/strict'
import { visite, attendre, tick, element } from './helpers/chaleur-visite.js'

// `fn(i)` toutes les 8 ms pendant `ms`
async function pendant(ms: number, fn: (i: number) => void) {
  const fin = Date.now() + ms
  for (let i = 0; Date.now() < fin; i++) { fn(i); await tick(8) }
}

describe('*heatmap — un effet lié qui n\'émet pas ne consomme pas la part de la connexion', function () {
  this.timeout(120000)

  for (const n of [1, 5, 20, 50]) {
    it(`${n} effet(s) liés à la connexion, la souris ne bouge que sur l'un d'eux pendant 4 s : il envoie ses dix points par seconde`, async () => {
      const v = await visite()
      const zones = Array.from({ length: n }, () => element())
      zones.forEach((z) => v.pose(z.el, { on: 'mousemove' }))
      await pendant(4000, (i) => zones[0].tire('mousemove', i % 150))
      await tick(500)
      assert.ok(v.recus.length >= 25, `${v.recus.length} points reçus en 4 s de mouvement continu (un effet seul en envoie une quarantaine)`)
      assert.equal(v.recus.length, v.emis(), `${v.emis() - v.recus.length} points jetés par le serveur sur ${v.emis()} partis`)
      await v.fermer()
    })
  }
})

describe('*heatmap — après une coupure, plusieurs effets ne font jeter aucun point par le serveur', function () {
  this.timeout(120000)

  for (const n of [1, 2, 3, 5]) {
    it(`${n} *heatmap(mousemove), la connexion coupée 2,5 s en plein mouvement : à la réouverture, tout ce qui part arrive`, async () => {
      const v = await visite({ reconnexion: 2500 })
      const zones = Array.from({ length: n }, () => element())
      zones.forEach((z) => v.pose(z.el, { on: 'mousemove' }))
      await pendant(1200, (i) => zones.forEach((z) => z.tire('mousemove', i % 150)))
      await tick(300)
      v.sock._mjs_ws.close(1006, 'coupure')
      await pendant(2600, (i) => zones.forEach((z) => z.tire('mousemove', i % 150)))
      await attendre(() => v.sock.state === 'open', 8000)
      await pendant(1000, (i) => zones.forEach((z) => z.tire('mousemove', i % 150)))
      await attendre(() => v.recus.length >= v.emis(), 4000)
      await tick(500)
      assert.ok(v.emis() > 20, 'des points sont partis : ' + v.emis())
      assert.equal(v.recus.length, v.emis(), `${v.emis() - v.recus.length} points jetés par le serveur sur ${v.emis()} partis`)
      await v.fermer()
    })
  }
})

describe('*heatmap — la part se partage entre les effets qui émettent', function () {
  this.timeout(60000)

  it('deux *heatmap(mousemove) actifs : chacun envoie, à eux deux la rafale du serveur et dix par seconde au plus, rien de jeté — puis le seul actif retrouve ses dix points par seconde', async () => {
    const v = await visite()
    const a = element()
    const b = element()
    v.pose(a.el, { on: 'mousemove', name: 'a' })
    const arretB = v.pose(b.el, { on: 'mousemove', name: 'b' })
    const de = (nom: string) => v.recus.filter((p) => p.z[0][0] === nom).length
    await pendant(4000, (i) => { a.tire('mousemove', i % 150); b.tire('mousemove', i % 150) })
    await tick(400)
    assert.ok(v.recus.length <= 20 + 10 * 4 + 2, 'à eux deux : la rafale de 20 et dix par seconde — ' + v.recus.length + ' points en 4 s')
    assert.ok(de('a') >= 10 && de('b') >= 10, 'chacun envoie sa part : a ' + de('a') + ', b ' + de('b'))
    assert.equal(v.recus.length, v.emis(), 'rien n\'est jeté par le serveur')
    arretB()
    // ce que a et b gardaient en attente part encore, sur le même seau : on le laisse finir avant de mesurer le seul actif
    let vus = -1
    while (v.recus.length !== vus) { vus = v.recus.length; await tick(300) }
    const avant = de('a')
    await pendant(2000, (i) => a.tire('mousemove', i % 150))
    await tick(300)
    const seul = de('a') - avant
    assert.ok(seul >= 15 && seul <= 22, 'seul, il envoie ses dix points par seconde : ' + seul + ' en 2 s')
    await v.fermer()
  })
})
