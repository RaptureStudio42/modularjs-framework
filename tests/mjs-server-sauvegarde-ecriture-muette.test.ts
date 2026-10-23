// Ce que ce test garantit : une écriture de sauvegarde qui ne répond JAMAIS (requête SQL restée
// pendante, Redis qui accepte la connexion et se tait, réseau coupé) ne bloque plus la sauvegarde de
// sa partie. Le moteur accroche chaque écriture d'une partie derrière la précédente (une seule en vol
// à la fois) : sans délai maximum, une écriture muette gelait toutes les suivantes — la partie ne se
// sauvait plus jamais, sans un mot, et le remove() d'une partie finie ne partait jamais. Désormais,
// passé 30 s sans réponse (comme le pont de persistance HTTP), l'écriture est abandonnée avec un
// avertissement qui nomme la partie, puis la sauvegarde continue avec le dernier état. Les minuteries
// sont simulées : aucune vraie attente de 30 s.
import assert from 'node:assert/strict'
import { mock } from 'node:test'
import { createPersistEngine, resolvePersistOption } from '../src/mjs-server/index.js'

const DELAI = 30000

// les minuteries simulées ne font pas avancer les promesses : on les laisse se dérouler avant de regarder
const laisse = async () => { for (let i = 0; i < 10; i++) await new Promise<void>(r => setImmediate(r)) }
const avance = async (ms: number) => { mock.timers.tick(ms); await laisse() }
const muette = () => new Promise<void>(() => {})

function moteur(adapter: any, debounce = 100) {
  const warns: string[] = []
  const engine            = createPersistEngine(resolvePersistOption({ adapter, debounce })!, (niveau: string, msg: string) => { if (niveau === 'warn') warns.push(msg) })!
  return { engine, warns }
}
const partie = (id: string): any => ({ id, n: 0, serialize() { return { n: this.n } }, _onMutate: null })
const mute   = (game: any, n: number) => { game.n = n; game._onMutate(game) }

describe('MJS-Server — sauvegarde : une écriture qui ne répond jamais', function () {
  this.timeout(10000)
  beforeEach(() => { mock.timers.enable({ apis: ['setTimeout'] }) })
  afterEach(() => { mock.timers.reset() })

  it('au bout de 30 s sans réponse, un avertissement nomme la partie, puis la sauvegarde repart avec le dernier état', async () => {
    const ecrites: number[] = []
    const adapter           = { load: async () => [], remove() {}, save: (_id: string, data: any) => { ecrites.push(data.n); return ecrites.length === 1 ? muette() : undefined } }
    const { engine, warns } = moteur(adapter)
    const game              = partie('g-muette')
    engine.armGame(game)

    mute(game, 1)
    await avance(100)                      // le débounce échoit : la 1re écriture part, et ne répond jamais
    assert.deepEqual(ecrites, [1], 'sanity : la 1re écriture est partie')
    mute(game, 2)
    await avance(100)                      // le débounce échoit : la 2e attend derrière la 1re (une seule en vol)
    await avance(DELAI - 101)              // t = 30 099 ms : une milliseconde avant le délai de la 1re (partie à 100 ms)
    assert.deepEqual(ecrites, [1], 'trop tôt : la 2e écriture ne doit partir qu\'une fois la 1re abandonnée')
    assert.deepEqual(warns, [], 'aucun avertissement avant le délai')

    await avance(1)
    assert.deepEqual(ecrites, [1, 2], 'passé le délai, la sauvegarde repart avec le dernier état : la partie ne reste pas bloquée derrière une écriture muette')
    assert.equal(warns.length, 1, `un seul avertissement attendu : ${JSON.stringify(warns)}`)
    assert.match(warns[0], /g-muette/, 'l\'avertissement nomme la partie')
  })

  it('une écriture lente qui répond avant le délai n\'est pas abandonnée, et sa minuterie ne sonne plus après coup : aucun avertissement', async () => {
    let ecrites             = 0
    const adapter           = { load: async () => [], remove() {}, save: () => { ecrites++; return new Promise<void>(r => setTimeout(r, DELAI - 1000)) } }
    const { engine, warns } = moteur(adapter)
    const game              = partie('g-lente')
    engine.armGame(game)

    mute(game, 1)
    await avance(100)                      // l'écriture part, elle répondra 29 s plus tard
    await avance(DELAI - 1000)             // elle répond
    await avance(DELAI)                    // bien au-delà des 30 s de son départ : plus rien ne doit sonner
    assert.equal(ecrites, 1)
    assert.deepEqual(warns, [])
  })

  it('le remove() d\'une partie finie part une fois le délai écoulé, derrière une sauvegarde qui ne répond jamais', async () => {
    const retirees: string[] = []
    const adapter            = { load: async () => [], save: () => muette(), remove: (id: string) => { retirees.push(id) } }
    const { engine, warns }  = moteur(adapter)
    const game               = partie('g-finie')
    engine.armGame(game)

    mute(game, 1)
    await avance(100)                      // sauvegarde en vol, muette (partie à 100 ms)
    engine.forgetGame('g-finie')           // la partie se termine
    await avance(DELAI - 1)
    assert.deepEqual(retirees, [], 'trop tôt : le remove() passe après la sauvegarde en vol')

    await avance(1)
    assert.deepEqual(retirees, ['g-finie'], 'passé le délai, le remove() de la partie finie part')
    assert.ok(warns.some(w => /g-finie/.test(w)), `l'avertissement nomme la partie : ${JSON.stringify(warns)}`)
  })

  it('un remove() qui ne répond jamais est borné lui aussi : la partie recréée sous le même identifiant finit par se sauvegarder', async () => {
    const ecrites: number[] = []
    const adapter           = { load: async () => [], remove: () => muette(), save: (_id: string, data: any) => { ecrites.push(data.n) } }
    const { engine, warns } = moteur(adapter)
    engine.armGame(partie('g-vie'))
    engine.forgetGame('g-vie')             // la partie se termine : son remove() part, et ne répond jamais
    await laisse()

    const neuve = partie('g-vie')
    engine.armGame(neuve)                  // recréée sous le même identifiant : elle s'accroche derrière le remove() de la vie précédente
    mute(neuve, 5)
    await avance(100)
    assert.deepEqual(ecrites, [], 'sanity : sa sauvegarde attend derrière le remove() muet')

    await avance(DELAI)
    assert.deepEqual(ecrites, [5], 'passé le délai, la partie recréée se sauvegarde')
    assert.ok(warns.some(w => /g-vie/.test(w)), `l'avertissement nomme la partie : ${JSON.stringify(warns)}`)
  })

  it('stop() rend la main une fois le délai écoulé : une écriture muette ne retient plus l\'arrêt du serveur, le dernier état est écrit', async () => {
    const ecrites: number[] = []
    const adapter           = { load: async () => [], remove() {}, save: (_id: string, data: any) => { ecrites.push(data.n); return ecrites.length === 1 ? muette() : undefined } }
    const { engine }        = moteur(adapter)
    const game              = partie('g-arret')
    engine.armGame(game)

    mute(game, 1)
    await avance(100)                      // 1re écriture en vol, muette
    mute(game, 2)                          // partie sale, pas encore sauvée
    let rendu = false
    void engine.stop().then(() => { rendu = true })
    await laisse()
    assert.equal(rendu, false, 'sanity : stop() attend l\'écriture en vol')

    await avance(DELAI)
    assert.equal(rendu, true, 'stop() doit rendre la main une fois la 1re écriture abandonnée')
    assert.deepEqual(ecrites, [1, 2], 'le dernier état est écrit avant de rendre la main')
  })

  it('un stockage entièrement muet : une seule écriture en vol, une nouvelle tentative et un avertissement par délai, rien ne s\'accumule', async () => {
    let tentees             = 0
    const adapter           = { load: async () => [], remove() {}, save: () => { tentees++; return muette() } }
    const { engine, warns } = moteur(adapter)
    const game              = partie('g-sourde')
    engine.armGame(game)

    for (let i = 1; i <= 95; i++) { mute(game, i); await avance(1000) }
    assert.equal(tentees, 4, 'écritures tentées à 0,1 s, 30,1 s, 60,1 s et 90,1 s : une par délai écoulé')
    assert.equal(warns.length, 3, `un avertissement par écriture abandonnée : ${JSON.stringify(warns)}`)
    assert.ok(warns.every(w => /g-sourde/.test(w)), 'chacun nomme la partie')
  })

  it('une écriture abandonnée qui échoue bien plus tard ne laisse aucun rejet non géré (témoin : vert aussi sans le délai)', async () => {
    const rejets: unknown[] = []
    const surRejet          = (e: unknown) => { rejets.push(e) }
    process.on('unhandledRejection', surRejet)
    try {
      let echoue: (e: Error) => void = () => {}
      const adapter                  = { load: async () => [], remove() {}, save: () => new Promise<void>((_, rejet) => { echoue = rejet }) }
      const { engine }               = moteur(adapter)
      const game                     = partie('g-tardive')
      engine.armGame(game)

      mute(game, 1)
      await avance(100)
      await avance(DELAI)                  // l'écriture est abandonnée
      echoue(new Error('réponse bien trop tardive'))
      await laisse()
      assert.deepEqual(rejets, [], 'le rejet tardif d\'une écriture abandonnée doit rester intercepté')
    } finally { process.off('unhandledRejection', surRejet) }
  })
})
