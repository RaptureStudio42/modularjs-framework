// game.timer(nom) n'arme qu'une minuterie déclarée dans `timers` (propriété propre, comme moves et intents) : un nom non déclaré,
// ou hérité d'Object.prototype (toString, constructor…), est refusé tout de suite avec la liste des minuteries déclarées. Avant, il
// était armé et rien ne se passait à l'échéance (ou une fonction d'Object.prototype était appelée). Une minuterie restaurée d'une
// sauvegarde sous un tel nom ne lance rien à son échéance
import assert from 'node:assert/strict'
import { resolveGameDef, createGame, restoreGame } from '../src/mjs-server/index.js'
import { t, setMessagesLang, getMessagesLang } from '../src/messages/index.js'

const tick = (ms = 0) => new Promise<void>(r => setTimeout(r, ms))
function fakeApp(): any { return { send() {} } }

describe('MJS-Server — game.timer() : seule une minuterie déclarée est armée', () => {
  it('un nom non déclaré est refusé, le message cite les minuteries déclarées ; un nom déclaré est armé', () => {
    const game = createGame(fakeApp(), resolveGameDef('minuterie', { seats: 1, state: () => ({}), moves: {}, timers: { rappel: () => {}, fin: () => {} } }), () => {}, 'm1')
    try {
      assert.throws(() => game.timer('rapel', 50), (e: any) => e.message === t('serveur.partie-timer-inconnu', { nom: 'rapel', timers: 'rappel, fin' }) && /rappel, fin/.test(e.message))
      assert.equal(game._timers.has('rapel'), false)
      game.timer('rappel', 50)
      assert.equal(game._timers.has('rappel'), true)
    }
    finally {
      game._destroy()
    }
  })

  it('un nom hérité d Object.prototype n est pas une minuterie déclarée ; sans timers, le message le dit', () => {
    const game = createGame(fakeApp(), resolveGameDef('minuterie', { seats: 1, state: () => ({}), moves: {} }), () => {}, 'm2')
    try {
      for (const nom of ['toString', 'constructor', 'hasOwnProperty']) {
        assert.throws(() => game.timer(nom, 50), (e: any) => e.message === t('serveur.partie-timer-inconnu', { nom, timers: t('serveur.partie-timer-aucun') }))
      }
      assert.equal(game._timers.size, 0)
    }
    finally {
      game._destroy()
    }
  })

  it('le message existe en français et en anglais', () => {
    const avant = getMessagesLang()
    try {
      setMessagesLang('en')
      assert.match(t('serveur.partie-timer-inconnu', { nom: 'x', timers: 'a' }), /undeclared timer/)
      setMessagesLang('fr')
      assert.match(t('serveur.partie-timer-inconnu', { nom: 'x', timers: 'a' }), /minuterie non déclarée/)
    }
    finally {
      setMessagesLang(avant)
    }
  })

  it('une minuterie restaurée sous un nom hérité ne lance rien à son échéance', async () => {
    const journal: string[] = []
    const def  = resolveGameDef('minuterie', { seats: 1, state: () => ({}), moves: {}, timers: { rappel: () => {} } }, (niveau, message) => journal.push(niveau + ' ' + message))
    const game = restoreGame(fakeApp(), def, () => {}, { id: 'm3', type: 'minuterie', code: null, state: {}, phase: null, turn: null, seq: 0, journal: [], seats: [null], timers: [{ name: 'hasOwnProperty', at: Date.now() + 5 }] } as any)
    try {
      await tick(40)
      assert.deepEqual(journal.filter(l => l.startsWith('error')), [])
    }
    finally {
      game._destroy()
    }
  })
})
