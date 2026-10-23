// Ce que ce test garantit : le plafond de la sauvegarde différée se compte avec une horloge MONOTONE
// (performance.now), jamais avec l'heure murale. Le plafond — une partie qui mute sans répit est
// sauvée au plus tard dix débounces après sa première mutation non sauvée — se calculait avec
// Date.now() : quand l'heure murale RECULE (saut NTP, reprise d'une machine virtuelle), la première
// mutation semblait dater du futur, le plafond ne coupait plus le report du débounce et la partie
// n'était plus sauvée du tout, tant que l'heure n'avait pas rattrapé son retard ; quand elle AVANCE,
// le plafond semblait dépassé d'un coup et chaque mutation partait aussitôt en sauvegarde. Les
// horloges sont simulées : l'heure murale saute, l'horloge monotone avance régulièrement.
import assert from 'node:assert/strict'
import { mock } from 'node:test'
import { createPersistEngine, resolvePersistOption } from '../src/mjs-server/index.js'

const MURALE_DEPART = 1_760_000_000_000   // une heure murale plausible, en ms depuis 1970
const UNE_HEURE     = 3_600_000

// les minuteries simulées ne font pas avancer les promesses : on les laisse se dérouler avant de regarder
const laisse = async () => { for (let i = 0; i < 10; i++) await new Promise<void>(r => setImmediate(r)) }

describe('MJS-Server — sauvegarde différée : le plafond ne suit pas l\'heure murale', function () {
  this.timeout(10000)
  let monotone = 0        // performance.now() simulé, en ms
  let saut     = 0        // écart de l'heure murale (Date.now()) par rapport à l'horloge qui avance
  const murale0 = Date.now
  const perf0   = performance.now

  beforeEach(() => {
    monotone = 5000
    saut     = 0
    mock.timers.enable({ apis: ['setTimeout'] })
    Date.now        = () => MURALE_DEPART + monotone + saut
    performance.now = () => monotone
  })
  afterEach(() => {
    Date.now        = murale0
    performance.now = perf0
    mock.timers.reset()
  })

  const avance = async (ms: number) => { monotone += ms; mock.timers.tick(ms); await laisse() }

  // une partie dont chaque sauvegarde note l'instant monotone où elle part (débounce 100 ms : plafond à 1 000 ms)
  function enRoute() {
    const instants: number[] = []
    const adapter            = { load: async () => [], save: () => { instants.push(monotone) }, remove: () => {} }
    const engine             = createPersistEngine(resolvePersistOption({ adapter, debounce: 100 })!, () => {})!
    const game: any          = { id: 'g-horloge', n: 0, serialize() { return { n: this.n } }, _onMutate: null }
    engine.armGame(game)
    return { engine, game, instants }
  }

  // la partie mute toutes les 10 ms jusqu'à `fin` ms après `debut`, l'heure murale ayant sauté de `ecart` après 30 ms
  async function rafale(game: any, debut: number, fin: number, ecart: number) {
    game.n++; game._onMutate(game)         // 1re mutation, heure normale
    await avance(30)
    saut = ecart
    while (monotone - debut < fin) { game.n++; game._onMutate(game); await avance(10) }
  }

  it('témoin — sans saut d\'heure : la partie qui mute sans répit est sauvée au plus tard dix débounces après sa 1re mutation', async () => {
    const { engine, game, instants } = enRoute()
    const debut                      = monotone
    await rafale(game, debut, 2500, 0)
    const pendant = instants.length
    await engine.stop()
    assert.ok(pendant >= 1, 'aucune sauvegarde pendant 2,5 s de mutations continues')
    assert.ok(instants[0] - debut <= 1000 + 10, `1re sauvegarde ${instants[0] - debut} ms après la 1re mutation : au-delà de dix débounces`)
  })

  it('l\'heure murale recule d\'une heure en pleine rafale : la partie est quand même sauvée au plus tard dix débounces après sa 1re mutation', async () => {
    const { engine, game, instants } = enRoute()
    const debut                      = monotone
    await rafale(game, debut, 2500, -UNE_HEURE)
    const pendant = instants.length
    await engine.stop()
    assert.ok(pendant >= 1, `aucune sauvegarde en 2,5 s de mutations continues (${game.n} mutations) après un recul d'une heure de l'heure murale : le plafond suit l'heure murale`)
    assert.ok(instants[0] - debut <= 1000 + 10, `1re sauvegarde ${instants[0] - debut} ms après la 1re mutation : au-delà de dix débounces`)
  })

  it('l\'heure murale avance d\'une heure en pleine rafale : le plafond ne part pas plus tôt, la 1re sauvegarde reste à dix débounces de la 1re mutation', async () => {
    const { engine, game, instants } = enRoute()
    const debut                      = monotone
    await rafale(game, debut, 2500, UNE_HEURE)
    const pendant = instants.length
    await engine.stop()
    assert.ok(pendant >= 1, 'sanity : la partie est sauvée')
    assert.ok(instants[0] - debut >= 1000 - 10, `1re sauvegarde ${instants[0] - debut} ms après la 1re mutation : le plafond, jugé dépassé d'un coup par le saut de l'heure murale, l'a envoyée avant dix débounces`)
    assert.ok(instants[0] - debut <= 1000 + 10, `1re sauvegarde ${instants[0] - debut} ms après la 1re mutation : au-delà de dix débounces`)
  })
})
