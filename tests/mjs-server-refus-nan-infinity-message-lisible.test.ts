// Le refus d'une paire [n, fenêtreMs] dont la fenêtre vaut NaN ou Infinity dit ce qui a été passé et ce qui est attendu : le message
// affichait `reçu : [2,null]` (JSON écrit null pour NaN et Infinity) et rappelait « fenêtreMs > 0 », qu'Infinity respecte.
import assert from 'node:assert/strict'
import { mjsServer, resolveGameDef } from '../src/mjs-server/index.js'
import { MemoryTransport } from '../src/mjs-ws/transport.js'
import { setMessagesLang } from '../src/messages/index.js'

const jeu = (moves: unknown) => ({ seats: 2, state: () => ({}), moves: {}, limits: { moves } }) as any
const message = (fn: () => unknown): string => { try { fn() } catch (e: any) { return String(e?.message ?? e) } return 'aucun refus' }

describe('MJS-Server — refus de NaN et Infinity : message lisible', () => {
  afterEach(() => setMessagesLang('fr'))

  it('def.limits.moves [2, NaN] et [3, Infinity] : la valeur passée et « finie » dans le message', () => {
    const nan = message(() => resolveGameDef('nan', jeu([2, Number.NaN])))
    assert.match(nan, /reçu : \[2, NaN\]/)
    assert.match(nan, /fenêtreMs finie > 0/)
    assert.match(message(() => resolveGameDef('inf', jeu([3, Number.POSITIVE_INFINITY]))), /reçu : \[3, Infinity\]/)
  })

  it('opts.antiCheat.movesPerIdentity et codePerIp : même rendu', () => {
    const mpi = message(() => mjsServer({ transport: new MemoryTransport(), antiCheat: { movesPerIdentity: [5, Number.NaN] } }))
    assert.match(mpi, /movesPerIdentity/)
    assert.match(mpi, /reçu : \[5, NaN\]/)
    assert.match(mpi, /fenêtreMs finie > 0/)
    const cpi = message(() => mjsServer({ transport: new MemoryTransport(), antiCheat: { codePerIp: [10, Number.POSITIVE_INFINITY] } }))
    assert.match(cpi, /codePerIp/)
    assert.match(cpi, /reçu : \[10, Infinity\]/)
  })

  it('en anglais aussi', () => {
    setMessagesLang('en')
    const nan = message(() => resolveGameDef('nan', jeu([2, Number.NaN])))
    assert.match(nan, /received: \[2, NaN\]/)
    assert.match(nan, /finite windowMs > 0/)
    assert.match(message(() => mjsServer({ transport: new MemoryTransport(), antiCheat: { movesPerIdentity: [5, Number.POSITIVE_INFINITY] } })), /received: \[5, Infinity\]/)
  })
})
