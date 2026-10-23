// paquet « suivre l'écran » : le débit de la souris de celui qui mène était gardé dans une seule table de seaux, vidée
// en entier au-delà de 5 000 clés (salon, identité). Remplir la table remettait donc à plein le seau de TOUS, et un
// meneur à bout de débit repartait aussitôt. Les seaux vivent maintenant par salon, et seuls ceux des salons vidés
// sont balayés : un seau vide le reste
import assert from 'node:assert/strict'
import { followPackage } from '../src/mjs-ws/follow.js'

// application factice : garde les écouteurs, compte ce qui part vers chaque salon (tous les salons ont un membre)
function appli(): { app: any; ecouteurs: Map<string, Function>; envois: Map<string, number> } {
  const ecouteurs = new Map<string, Function>()
  const envois    = new Map<string, number>()
  const app: any  = {
    serve: (type: string, h: Function) => { ecouteurs.set(type, h) },
    on: (type: string, h: Function) => { ecouteurs.set(type, h) },
    room: (nom: string) => ({ has: () => true, size: 1, clients: [], send: () => { envois.set(nom, (envois.get(nom) ?? 0) + 1) } }),
  }
  return { app, ecouteurs, envois }
}

const client = (id: string): any => ({ id, identity: { id } })

describe('MJS-WS — suivre l’écran : le débit de la souris n’est jamais remis à zéro pour tous', function () {
  this.timeout(20000)

  it('6 000 seaux créés ailleurs : le meneur à bout de débit le reste', async () => {
    // horloge arrêtée : aucun seau ne se remplit pendant le test, seul compte ce qui le remet à plein
    const vraiNow = Date.now
    const fige    = vraiNow()
    Date.now      = () => fige
    try {
    const { app, ecouteurs, envois } = appli()
    const pkg: any = followPackage({ onLog: () => {}, canLead: () => true } as any)
    pkg.installer(app)
    const souris  = ecouteurs.get('follow:cursor')!
    const meneur  = client('meneur')
    const p       = { room: 'cours', p: [0.5, 0.5] }
    for (let i = 0; i < 100; i++) await souris(p, meneur)
    const partis = envois.get('follow:cours') ?? 0
    assert.ok(partis > 0 && partis < 100, `débit du meneur épuisé (${partis} parties sur 100)`)
    const autre = client('autre')
    for (let i = 0; i < 6000; i++) await souris({ room: 'salon-' + i, p: [0, 0] }, autre)
    for (let i = 0; i < 20; i++) await souris(p, meneur)
    const ensuite = (envois.get('follow:cours') ?? 0) - partis
    assert.equal(ensuite, 0, `après 6 000 seaux ailleurs, le meneur ne repart pas à plein : ${ensuite} sur 20`)
    }
    finally {
      Date.now = vraiNow
    }
  })
})
