// *heatmap : plusieurs effets sur une même connexion. Le serveur ne prend que 10 points par seconde par connexion (un
// seau de 20) : deux `*heatmap(mousemove)` qui en envoient chacun 10 par seconde en faisaient jeter la moitié, en silence.
// Les effets de la connexion se partagent un seau de points du même débit (chaleur-part-unique-par-connexion.test.ts) :
// le serveur ne jette plus rien, et un `*heatmap` de clics n'est pas affamé par un `*heatmap(mousemove)` (ils passent à
// tour de rôle). Le vrai effet, la vraie connexion µ.socket, le vrai paquet heatmapPackage, par un MemoryTransport.

import assert from 'node:assert/strict'
import { visite, attendre, tick, element } from './helpers/chaleur-visite.js'

// `fn(i)` toutes les 8 ms pendant `ms`
async function pendant(ms: number, fn: (i: number) => void) {
  const fin = Date.now() + ms
  for (let i = 0; Date.now() < fin; i++) { fn(i); await tick(8) }
}

describe('*heatmap — plusieurs effets sur une connexion : aucun point n\'est jeté par le serveur', function () {
  this.timeout(60000)

  for (const n of [2, 3]) {
    it(`${n} *heatmap(mousemove) pendant 4 s de mouvement continu : le serveur reçoit tout ce qui est parti`, async () => {
      const v = await visite()
      const zones = Array.from({ length: n }, () => element())
      zones.forEach((z) => v.pose(z.el, { on: 'mousemove' }))
      await pendant(4000, (i) => zones.forEach((z) => z.tire('mousemove', i % 150)))
      await attendre(() => v.recus.length >= v.emis(), 3000)
      await tick(300)
      assert.ok(v.emis() > 20, 'des points sont partis : ' + v.emis())
      assert.equal(v.recus.length, v.emis(), `${v.emis() - v.recus.length} points jetés par le serveur sur ${v.emis()} partis`)
      await v.fermer()
    })
  }

  it('un *heatmap de clics n\'est pas affamé par un *heatmap(mousemove) : les 10 clics arrivent', async () => {
    const v = await visite()
    const souris = element()
    const clics  = element()
    v.pose(souris.el, { on: 'mousemove', name: 'souris' })
    v.pose(clics.el, { on: 'click', name: 'clics' })
    let envoyes = 0
    const mouvement = pendant(3200, (i) => souris.tire('mousemove', i % 150))
    for (let i = 0; i < 10; i++) { await tick(300); clics.tire('click', i); envoyes++ }
    await mouvement
    // la part des effets se dispute (quatre trames par seconde à eux deux) : les derniers clics attendent leur trame
    const deClics = () => v.recus.filter((p) => p.ev === 'click').length
    await attendre(() => deClics() >= envoyes, 8000)
    await tick(500)
    assert.equal(deClics(), envoyes, `${deClics()} clics reçus sur ${envoyes}`)
    assert.equal(v.recus.length, v.emis(), 'et rien n\'est jeté par le serveur')
    await v.fermer()
  })

  it('un seul *heatmap garde son pas de 100 ms : dix points par seconde au plus', async () => {
    const v = await visite()
    const a = element()
    v.pose(a.el, { on: 'mousemove' })
    await pendant(2000, (i) => a.tire('mousemove', i % 150))
    await tick(300)
    assert.ok(v.recus.length >= 9 && v.recus.length <= 21, v.recus.length + ' points en 2 s')
    await v.fermer()
  })
})
