// Quotas [n, fenêtreMs] mal formés : `limits.moves: 30` levait une TypeError brute (« number 30 is not iterable ») au lieu du message
// de configuration ; une fenêtre NaN (variable d'environnement absente) était acceptée et désactivait le quota en silence (taux NaN :
// chaque coup passe) ; une fenêtre Infinity était acceptée et bloquait tout après n coups (taux nul). Même contrôle pour
// opts.antiCheat.codePerIp et opts.antiCheat.movesPerIdentity : la fenêtre doit être un nombre fini > 0.
import assert from 'node:assert/strict'
import { resolveGameDef, createGame, mjsServer } from '../src/mjs-server/index.js'
import { MemoryTransport } from '../src/mjs-ws/transport.js'

function declarer(moves: unknown): unknown {
  return resolveGameDef('quota', { seats: 1, state: () => ({}), moves: { m: () => {} }, limits: { moves: moves as any } })
}

function demarrer(antiCheat: Record<string, unknown>): void {
  mjsServer({ transport: new MemoryTransport(), heartbeat: 0, antiCheat: antiCheat as any })
}

describe('MJS-Server — quotas mal formés refusés', () => {
  it('limits.moves qui n est pas un tableau : message de configuration, pas une TypeError', () => {
    for (const valeur of [30, {}, 'ab', true]) {
      assert.throws(() => declarer(valeur), (err: any) => err.constructor === Error && /limits\.moves/.test(err.message), 'valeur ' + String(valeur))
    }
  })

  it('limits.moves avec une fenêtre NaN, Infinity ou négative : refusé à la déclaration', () => {
    for (const valeur of [[2, NaN], [2, Infinity], [2, -Infinity], [2, Number(process.env.FENETRE_DE_TEST_JAMAIS_POSEE)]]) {
      assert.throws(() => declarer(valeur), /limits\.moves/, JSON.stringify(valeur))
    }
  })

  it('une déclaration valide applique toujours son quota', () => {
    const def: any = declarer([2, 60000])
    const game: any = createGame({ send() {} } as any, def, () => {}, 'quota1')
    const client: any = { id: 'c1', identity: { id: 'A' }, latency: null, meta: {}, send() {}, close() {} }
    game._createSeat(client)
    let acceptes = 0
    let refuses = 0
    for (let i = 0; i < 5; i++) {
      try {
        game._onMove(client, 'm', {})
        acceptes++
      } catch {
        refuses++
      }
    }
    game._destroy()
    assert.deepEqual({ acceptes, refuses }, { acceptes: 2, refuses: 3 })
  })

  it('antiCheat.codePerIp et movesPerIdentity : fenêtre NaN ou Infinity refusée au démarrage', () => {
    assert.throws(() => demarrer({ codePerIp: [10, NaN] }), /codePerIp/)
    assert.throws(() => demarrer({ codePerIp: [10, Infinity] }), /codePerIp/)
    assert.throws(() => demarrer({ movesPerIdentity: [5, Infinity] }), /movesPerIdentity/)
    assert.throws(() => demarrer({ movesPerIdentity: [5, NaN] }), /movesPerIdentity/)
    assert.doesNotThrow(() => demarrer({ codePerIp: [10, 60000], movesPerIdentity: [5, 1000] }))
  })
})
