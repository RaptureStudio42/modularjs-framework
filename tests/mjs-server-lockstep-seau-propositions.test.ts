// Lockstep — les propositions d'instantané (µgame:snapshot) ont leur propre seau à jetons, jamais celui des hash. Les deux
// partageaient les 30 jetons par seconde des hash : au-delà de 30 Hz, une cadence de 1 perdait des propositions (un accord manqué
// bloque le tick suivant jusqu'à la fin de sa fenêtre), et les hash en mangeaient d'autres. Le seau des propositions suit la cadence
// du jeu : `tick / snapshotEvery` jetons par seconde, autant en réserve que la fenêtre de réception compte de ticks de la cadence,
// plus un. Horloge simulée (Date.now) : partie construite directement, boucle de tick arrêtée, ticks clos à la main
import assert from 'node:assert/strict'
import { resolveGameDef, createGame } from '../src/mjs-server/index.js'

function fakeApp(): any { return { send() {} } }
function fakeClient(identityId: string): any {
  return { id: 'fake-' + identityId, identity: { id: identityId }, latency: null, meta: {}, send() {}, close() {} }
}

// horloge simulée le temps de `fn` — rendue même si `fn` lève
function horloge(fn: (avancer: (ms: number) => void) => void): void {
  const vrai = Date.now
  let maintenant = vrai.call(Date)
  Date.now = () => maintenant
  try { fn(ms => { maintenant += ms }) }
  finally { Date.now = vrai }
}

// partie lockstep à deux sièges, boucle de tick arrêtée (les ticks se closent à la main)
function partie(id: string, tick: number, snapshotEvery: number): { game: any; a: any; b: any } {
  const def  = resolveGameDef('lockstep-seau', { mode: 'lockstep', seats: 2, tick, moves: {}, lockstepJournal: { snapshotEvery } } as any)
  const game = createGame(fakeApp(), def, () => {}, id) as any
  const a = fakeClient('a'), b = fakeClient('b')
  game._createSeat(a); game._createSeat(b)
  game._stopTickLoop()
  return { game, a, b }
}

describe('MJS-Server — lockstep : les propositions d\'instantané ont leur propre seau', () => {
  it('60 Hz, cadence de 1, trois secondes : chaque tick est accordé, aucune proposition perdue', () => {
    horloge(avancer => {
      const { game, a, b } = partie('pseau1', 60, 1)
      const manques: number[] = []
      for (let t = 1; t <= 180; t++) {
        avancer(1000 / 60)
        game._lockstep.closeTick()
        // l'accord du tick précédent est rangé à cette clôture
        if (t > 1 && game._lockstep.snapshot()?.tick !== t - 1) manques.push(t - 1)
        game._receiveSnapshot(a, t, { n: t }, 7)
        game._receiveSnapshot(b, t, { n: t }, 7)
      }
      assert.deepEqual(manques, [], 'chaque tick accordé puis rangé à la clôture du suivant')
      game._destroy()
    })
  })

  it('60 Hz, cadence de 1, avec un hash à chaque tick : les hash ne mangent aucune proposition', () => {
    horloge(avancer => {
      const { game, a, b } = partie('pseau2', 60, 1)
      const manques: number[] = []
      for (let t = 1; t <= 180; t++) {
        avancer(1000 / 60)
        game._lockstep.closeTick()
        if (t > 1 && game._lockstep.snapshot()?.tick !== t - 1) manques.push(t - 1)
        game._receiveHash(a, t, 'h' + t)
        game._receiveHash(b, t, 'h' + t)
        game._receiveSnapshot(a, t, { n: t }, 7)
        game._receiveSnapshot(b, t, { n: t }, 7)
      }
      assert.deepEqual(manques, [])
      game._destroy()
    })
  })

  it('un flot de propositions n\'entame pas le budget des hash, et le seau des propositions reste borné', () => {
    horloge(() => {
      const { game, a, b } = partie('pseau3', 60, 1)
      game._lockstep.closeTick()
      let recues = 0
      const vrai = game._lockstep.receiveSnapshot
      game._lockstep.receiveSnapshot = (...args: any[]) => { recues++; return vrai(...args) }
      for (let i = 0; i < 1000; i++) game._receiveSnapshot(a, 1, { n: 1 }, 7)
      // fenêtre de deux secondes à 60 Hz : 120 ticks de la cadence, plus un
      assert.equal(recues, 121, 'la réserve du seau, rien de plus sans que le temps passe')
      game._receiveHash(b, 1, 'h1'); game._receiveHash(b, 2, 'h2')
      game._receiveHash(a, 3, 'h3'); game._receiveHash(a, 4, 'h4')
      assert.equal(game._lockstep._hashSize(), 4, 'les hash de a (ticks 3 et 4) passent encore')
      game._destroy()
    })
  })

  it('le seau suit la cadence : 20 Hz et une proposition tous les 10 ticks, deux par seconde', () => {
    horloge(avancer => {
      const { game, a } = partie('pseau4', 20, 10)
      for (let t = 1; t <= 10; t++) game._lockstep.closeTick()
      let recues = 0
      const vrai = game._lockstep.receiveSnapshot
      game._lockstep.receiveSnapshot = (...args: any[]) => { recues++; return vrai(...args) }
      for (let i = 0; i < 50; i++) game._receiveSnapshot(a, 10, { n: 10 }, 7)
      // fenêtre de 40 ticks (deux secondes à 20 Hz) : quatre ticks de la cadence, plus un
      assert.equal(recues, 5)
      avancer(1000)
      for (let i = 0; i < 50; i++) game._receiveSnapshot(a, 10, { n: 10 }, 7)
      assert.equal(recues, 7, 'une seconde plus tard : deux jetons de plus')
      game._destroy()
    })
  })
})
