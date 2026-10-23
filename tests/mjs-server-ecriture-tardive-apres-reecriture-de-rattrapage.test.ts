// Une réécriture de rattrapage ne marque que sa propre écriture : la sauvegarde d'origine lancée APRÈS elle n'est pas, elle, une
// réécriture. Si sa réponse tardive arrive alors qu'une écriture plus récente est déjà PARTIE (sans avoir répondu), elle a pu la
// remplacer : l'état courant est réécrit. Un stockage qui garderait le drapeau de rattrapage levé pour toutes les écritures suivantes
// ne rattraperait plus que ce qui a ABOUTI, et laisserait la ligne sur l'état périmé.
// Les minuteries sont simulées : aucune vraie attente de 30 s.
import assert from 'node:assert/strict'
import { mock } from 'node:test'
import { createPersistEngine, resolvePersistOption } from '../src/mjs-server/index.js'

const DELAI = 30000

const laisse = async () => { for (let i = 0; i < 20; i++) await new Promise<void>(r => setImmediate(r)) }
const avance = async (ms: number) => { mock.timers.tick(ms); await laisse() }
const partie = (id: string): any => ({ id, n: 0, serialize() { return { id: this.id, n: this.n } }, _onMutate: null })
const mute   = (game: any, n: number) => { game.n = n; game._onMutate(game) }

type Ecriture = { n: number; repond: () => void; aboutit: () => void }

// stockage à écritures pilotées : chaque save() rend une promesse que le test fait répondre quand il veut
function stockage() {
  const lignes    = new Map<string, string>()
  const ecritures = [] as Ecriture[]
  const adapter   = {
    load: async () => [],
    remove: async () => {},
    save: (id: string, data: any) => new Promise<void>(resolve => {
      ecritures.push({ n: data.n, repond: () => resolve(), aboutit: () => { lignes.set(id, String(data.n)); resolve() } })
    }),
  }
  return { adapter, lignes, ecritures }
}

describe('MJS-Server — écriture tardive lancée après une réécriture de rattrapage', function () {
  this.timeout(30000)
  beforeEach(() => { mock.timers.enable({ apis: ['setTimeout'] }) })
  afterEach(() => { mock.timers.reset() })

  it('la sauvegarde d\'origine lancée après une réécriture de rattrapage est rattrapée sur ce qui est seulement parti', async () => {
    const { adapter, lignes, ecritures } = stockage()
    const engine = createPersistEngine(resolvePersistOption({ adapter, debounce: 100 })!, () => {})!
    const game   = partie('g')
    engine.armGame(game)
    mute(game, 1)
    await avance(100)                        // écriture 1, coincée
    mute(game, 2)
    await avance(100)                        // l'écriture 2 attend derrière
    await avance(DELAI)                      // la 1re est abandonnée, la 2e part
    ecritures[0].aboutit()                   // la 1re répond tard alors que la 2e est partie : réécriture de rattrapage programmée
    await laisse()
    await avance(DELAI)                      // la 2e, muette, est abandonnée : la réécriture de rattrapage (3e) part
    assert.equal(ecritures.length, 3, 'sanity : la réécriture de rattrapage est partie')
    mute(game, 3)
    await avance(100)                        // une sauvegarde d'origine attend derrière la réécriture
    await avance(DELAI)                      // la réécriture est abandonnée : la sauvegarde d'origine (4e) part
    mute(game, 4)
    await avance(100)                        // la suivante attend derrière la 4e
    await avance(DELAI)                      // la 4e est abandonnée, la 5e part et reste sans réponse
    assert.equal(ecritures.length, 5, 'sanity : cinq écritures parties')
    ecritures[3].aboutit()                   // la sauvegarde d'origine répond tard : la 5e, plus récente, est partie
    await laisse()
    await avance(DELAI)                      // la 5e, muette, est abandonnée : la réécriture part
    assert.equal(ecritures.length, 6, 'la réponse tardive d\'une écriture d\'origine déclenche la réécriture, la plus récente étant seulement partie')
    ecritures[5].aboutit()
    await laisse()
    assert.equal(lignes.get('g'), '4', 'la ligne finit sur l\'état le plus récent')
  })
})
