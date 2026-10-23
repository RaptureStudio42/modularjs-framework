// Un identifiant recréé : la SUPPRESSION abandonnée de l'ancienne partie répond tard, alors que la partie recréée n'a rien écrit
// (donc rien de plus récent n'est parti). Seule la sauvegarde tardive d'une autre vie a pu remettre l'ancienne ligne ; une suppression
// tardive ne remet rien et ne provoque aucune réécriture ni avertissement de rattrapage.
// Les minuteries sont simulées : aucune vraie attente de 30 s.
import assert from 'node:assert/strict'
import { mock } from 'node:test'
import { createPersistEngine, resolvePersistOption } from '../src/mjs-server/index.js'

const DELAI = 30000

const laisse = async () => { for (let i = 0; i < 20; i++) await new Promise<void>(r => setImmediate(r)) }
const avance = async (ms: number) => { mock.timers.tick(ms); await laisse() }
const partie = (id: string): any => ({ id, n: 0, serialize() { return { id: this.id, n: this.n } }, _onMutate: null })

describe('MJS-Server — suppression tardive d\'une autre vie de l\'identifiant', function () {
  this.timeout(30000)
  beforeEach(() => { mock.timers.enable({ apis: ['setTimeout'] }) })
  afterEach(() => { mock.timers.reset() })

  it('le DELETE abandonné de l\'ancienne partie qui répond tard ne réécrit rien pour la partie recréée', async () => {
    const warns = [] as string[]
    const suppressions = [] as Array<() => void>
    let saves = 0
    const adapter = {
      load: async () => [],
      save: async () => { saves++ },
      remove: () => new Promise<void>(resolve => { suppressions.push(resolve) }),
    }
    const engine = createPersistEngine(resolvePersistOption({ adapter, debounce: 100 })!, (niveau: string, msg: string) => { if (niveau === 'warn') warns.push(msg) })!
    engine.armGame(partie('salon'))
    engine.forgetGame('salon')               // la partie finit : son DELETE part et reste coincé
    await laisse()
    assert.equal(suppressions.length, 1, 'sanity : le DELETE est parti')
    engine.armGame(partie('salon'))          // recréée sous le même identifiant, elle n'écrit rien
    await avance(DELAI)                      // le DELETE est abandonné
    suppressions[0]()                        // il répond tard
    await laisse()
    await avance(DELAI)
    assert.equal(saves, 0, 'aucune réécriture : la partie recréée n\'a rien écrit que la suppression ait pu effacer')
    assert.ok(!warns.some(w => /la suppression abandonnée a fini par répondre/.test(w)), `aucun avertissement de rattrapage : ${JSON.stringify(warns)}`)
  })
})
