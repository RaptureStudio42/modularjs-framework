// Moteur de persistance — nouveaux essais : une suppression refusée est retentée (une seconde après, puis une attente qui double),
// jamais après la recréation de la partie sous le même identifiant, et la rafale finale de l'arrêt la reprend ; un échec suivi d'une
// écriture réussie ne laisse pas partir une écriture de plus ; une partie qui ne se sérialise pas (serialize() lève) n'est pas
// retentée — une erreur de sérialisation ne se répare pas en réessayant : elle est écrite au journal, une fois.
// Moteur réel, parties factices (le moteur ne demande à une partie que `id`, `serialize()` et `_onMutate`).
import assert from 'node:assert/strict'
import { createPersistEngine, resolvePersistOption } from '../src/mjs-server/index.js'
import { attendre } from './helpers/attendre.js'

const pause = (ms = 0) => new Promise<void>(r => setTimeout(r, ms))

class Adaptateur {
  store   = new Map<string, any>()
  saves   = 0
  removes = 0
  constructor(public saveFailures = 0, public removeFailures = 0) {}
  async load(): Promise<any[]> { return [] }
  save(id: string, data: any): Promise<void> {
    this.saves++
    if (this.saveFailures-- > 0) return Promise.reject(new Error('stockage indisponible'))
    this.store.set(id, JSON.parse(JSON.stringify(data)))
    return Promise.resolve()
  }
  remove(id: string): Promise<void> {
    this.removes++
    if (this.removeFailures-- > 0) return Promise.reject(new Error('suppression impossible'))
    this.store.delete(id)
    return Promise.resolve()
  }
}

function partie(id = 'g1', etat: any = { n: 1 }): any {
  return { id, etat, _onMutate: null, serialize() { return { id, state: { ...this.etat } } } }
}

describe('MJS-Server — persistance : suppression retentée, pas d\'écriture de plus, sérialisation impossible', function () {
  this.timeout(15000)
  const engines: any[] = []
  afterEach(async () => { for (const e of engines.splice(0)) await e.stop() })

  function engine(ad: any, logs: string[] = []) {
    const e = createPersistEngine(resolvePersistOption({ adapter: ad, debounce: 5 }), (level: string, msg: string, meta?: any) => { logs.push(level + ' ' + msg + (meta?.err ? ' : ' + meta.err : '')) })!
    engines.push(e)
    return e
  }

  it('une suppression refusée est retentée', async () => {
    const ad   = new Adaptateur(0, 1)
    const logs: string[] = []
    const e    = engine(ad, logs)
    const p    = partie()
    e.armGame(p); p._onMutate(p)
    await attendre(() => ad.store.has('g1'), 'partie sauvegardée')
    e.forgetGame('g1')
    await attendre(() => !ad.store.has('g1'), { message: 'partie retirée du stockage après le refus', delai: 4000 })
    assert.equal(ad.removes, 2)
    assert.ok(logs.some(l => /persist\.remove\('g1'\).*nouvel essai dans 1 s/.test(l)), JSON.stringify(logs))
  })

  it('une suppression refusée n\'est pas retentée quand la partie est recréée sous le même identifiant', async () => {
    const ad = new Adaptateur(0, 1)
    const e  = engine(ad)
    const p  = partie()
    e.armGame(p); p._onMutate(p)
    await attendre(() => ad.store.has('g1'), 'partie sauvegardée')
    e.forgetGame('g1')
    await attendre(() => ad.removes === 1, 'suppression refusée')
    const q = partie('g1', { n: 2 })
    e.armGame(q); q._onMutate(q)
    await attendre(() => ad.store.get('g1')?.state.n === 2, 'nouvelle partie sauvegardée')
    await pause(1500)
    assert.equal(ad.removes, 1)
    assert.equal(ad.store.get('g1')?.state.n, 2)
  })

  it('la rafale finale de l\'arrêt reprend une suppression qui attendait son nouvel essai', async () => {
    const ad = new Adaptateur(0, 1)
    const e  = engine(ad)
    const p  = partie()
    e.armGame(p); p._onMutate(p)
    await attendre(() => ad.store.has('g1'), 'partie sauvegardée')
    e.forgetGame('g1')
    await attendre(() => ad.removes === 1, 'suppression refusée')
    engines.splice(engines.indexOf(e), 1)
    await e.stop()
    assert.equal(ad.store.has('g1'), false)
  })

  it('un échec puis une écriture réussie : le nouvel essai programmé ne part plus', async () => {
    const ad = new Adaptateur(1)
    const e  = engine(ad)
    const p  = partie()
    e.armGame(p); p._onMutate(p)
    await attendre(() => ad.saves === 1, 'première écriture refusée')
    p.etat.n = 2; p._onMutate(p)
    await attendre(() => ad.store.get('g1')?.state.n === 2, 'écriture réussie')
    await pause(1300)
    assert.equal(ad.saves, 2)
  })

  it('serialize() qui lève : un essai, l\'erreur au journal, aucun nouvel essai', async () => {
    const ad   = new Adaptateur()
    const logs: string[] = []
    const e    = engine(ad, logs)
    let essais = 0
    const p: any = { id: 'g1', _onMutate: null, serialize() { essais++; throw new Error('état non sérialisable') } }
    e.armGame(p); p._onMutate(p)
    await attendre(() => essais === 1, 'sérialisation tentée')
    await pause(2300)
    assert.equal(essais, 1)
    assert.equal(ad.saves, 0)
    assert.equal(logs.length, 1, JSON.stringify(logs))
    assert.match(logs[0], /^error .*'g1'.*état non sérialisable/)
  })
})
