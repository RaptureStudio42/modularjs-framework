// game.ts — une erreur dans une minuterie APPLICATIVE (def.timers), dans def.view ou dans
// def.history.extract ne doit JAMAIS remonter jusqu'au process (throw nu dans un setInterval/
// setTimeout/microtâche sans requête à qui répondre) : capturée, journalisée, la partie continue.
// hooks.onEnd qui lève arme quand même la grâce emptyTtl (sinon la partie ne serait plus jamais
// détruite), le throw lui-même continuant de remonter normalement à l'appelant de .end().
import assert from 'node:assert/strict'
import { resolveGameDef, createGame } from '../src/mjs-server/index.js'

function fakeApp(): any { return { send() {} } }
function fakeAppCapture(): any {
  const envoyes: any[] = []
  return { send: (client: any, type: string, p: any) => envoyes.push({ client, type, p }), _envoyes: envoyes }
}
function fakeClient(identityId: string): any {
  return { id: 'fake-' + identityId, identity: { id: identityId }, latency: null, meta: {}, send() {}, close() {} }
}
const tick = (ms = 0): Promise<void> => new Promise<void>(r => setTimeout(r, ms))

describe('robustesse — minuteur applicatif / vue / extraction protégés', () => {
  it('une minuterie applicative (def.timers) qui lève est capturée (log error), jamais un throw nu', async () => {
    const erreurs: string[] = []
    const def = resolveGameDef('mv1', {
      seats: 1, state: () => ({}), moves: {}, timers: { rappel: () => { throw new Error('boum-timer') } },
    }, (level, msg) => { if (level === 'error') erreurs.push(String(msg)) })
    const game = createGame(fakeApp(), def, () => {}, 'mv1g')
    game.timer('rappel', 5)
    await tick(30)
    assert.ok(erreurs.some(m => m.includes('rappel') && m.includes('boum-timer')), `un log error doit mentionner la minuterie et l’erreur, reçu : ${JSON.stringify(erreurs)}`)
    game._destroy()
  })

  it('def.view qui lève est capturée — trame ignorée pour ce siège ce round, la partie continue de diffuser ensuite', async () => {
    const app = fakeAppCapture()
    let lever = true
    const erreurs: string[] = []
    const def = resolveGameDef('mv2', {
      seats: 1, state: () => ({ n: 0 }), moves: { inc: (g: any) => { g.state.n++ } },
      view: (g: any) => { if (lever) throw new Error('boum-view'); return g.state },
    }, (level, msg) => { if (level === 'error') erreurs.push(String(msg)) })
    const game = createGame(app, def, () => {}, 'mv2g')
    const client = fakeClient('p1')
    game._createSeat(client)
    await tick()
    assert.ok(erreurs.some(m => m.includes('boum-view')), 'la vue cassée doit être journalisée, jamais un throw nu')

    lever = false
    app._envoyes.length = 0
    game._onMove(client, 'inc', {})
    await tick()
    const frames = app._envoyes.filter((e: any) => e.type === 'µgame:state')
    assert.equal(frames.length, 1, 'la partie continue de diffuser normalement une fois la vue réparée')
    game._destroy()
  })

  it('def.history.extract qui lève est capturé — le tick continue de tourner, aucun throw nu dans la boucle', async () => {
    const erreurs: string[] = []
    let appels = 0
    const def = resolveGameDef('mv3', {
      seats: 1, tick: 50, state: () => ({}), moves: {},
      history: { ticks: 5, extract: () => { appels++; throw new Error('boum-extract') } },
    }, (level, msg) => { if (level === 'error') erreurs.push(String(msg)) })
    const game = createGame(fakeApp(), def, () => {}, 'mv3g')
    game._createSeat(fakeClient('p1'))
    await tick(120)
    assert.ok(appels >= 2, 'plusieurs ticks ont bien tourné malgré l’erreur répétée d’extraction')
    assert.ok(erreurs.some(m => m.includes('boum-extract')))
    game._destroy()
  })

  it('hooks.onEnd qui lève arme quand même la grâce emptyTtl (finally) — le throw continue de remonter à l’appelant', () => {
    const def = resolveGameDef('mv4', {
      seats: 1, state: () => ({}),
      moves: { finir: (g: any) => { g.end({ ok: true }) } },
      hooks: { onEnd: () => { throw new Error('boum-onend') } },
    })
    const game = createGame(fakeApp(), def, () => {}, 'mv4g')
    const client = fakeClient('p1')
    game._createSeat(client)
    assert.throws(() => game._onMove(client, 'finir', {}), /boum-onend/, 'le throw d’onEnd doit continuer de remonter à l’appelant')
    assert.equal(game._ended, true)
    assert.equal(game._timers.has('µempty'), true, 'la grâce emptyTtl doit être armée MÊME si onEnd a levé')
    game._destroy()
  })
})
