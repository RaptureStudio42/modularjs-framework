// MemoryAdapter (bus en mémoire de plusieurs apps dans un même processus) appelait les rappels de `subscribe` sans les
// protéger : un rappel qui lève devenait une exception non rattrapée, qui fait tomber le processus. L'adaptateur Redis,
// lui, rattrape le rappel qui lève et l'annonce dans le journal, regroupé par canal. MemoryAdapter fait de même : les
// autres rappels reçoivent le message, un avertissement part dans `onLog`
import assert from 'node:assert/strict'
import { MemoryAdapter, createMemoryAdapterBus } from '../src/mjs-ws/adapter.js'

const tick = (ms = 0) => new Promise<void>(r => setTimeout(r, ms))

describe('MJS-WS — MemoryAdapter : un rappel qui lève est rattrapé', function () {
  it('les autres rappels reçoivent chaque message, un seul avertissement regroupé', async () => {
    const bus = createMemoryAdapterBus()
    const journal: string[] = []
    const emetteur = new MemoryAdapter({ bus })
    const recepteur = new MemoryAdapter({ bus, onLog: (niveau: string, message: string) => journal.push(niveau + ' ' + message) } as any)
    const recus: unknown[] = []
    recepteur.subscribe('canal', () => { throw new Error('rappel cassé') })
    recepteur.subscribe('canal', (message) => recus.push(message))
    emetteur.publish('canal', { n: 1 })
    emetteur.publish('canal', { n: 2 })
    await tick(10)
    assert.deepEqual(recus, [{ n: 1 }, { n: 2 }])
    assert.equal(journal.length, 1, 'un avertissement regroupé')
    assert.ok(journal[0].startsWith('warn') && journal[0].includes('canal') && journal[0].includes('rappel cassé'), journal[0])
  })
})
