// game.rewind(instantMs, fn) avec un instant qui n'est pas un nombre fini (horodatage client absent : undefined, NaN, Infinity) levait
// une TypeError interne (« Cannot read properties of null (reading 'positions') ») : aucune entrée n'était jamais « plus proche ». Le
// tampon refuse désormais l'appel avec une erreur claire qui cite la valeur reçue, sans appeler `fn`.
import assert from 'node:assert/strict'
import { createHistory } from '../src/mjs-server/index.js'

describe('MJS-Server — rembobiner à un instant invalide', () => {
  it('undefined, NaN, Infinity ou une chaîne : erreur claire qui cite la valeur, fn jamais appelée', () => {
    const histo = createHistory(3)
    histo.pousser(1, 1000, { a: { x: 1, y: 2 } })
    histo.pousser(2, 1050, { a: { x: 3, y: 4 } })
    let appels = 0
    for (const instant of [undefined, NaN, Infinity, -Infinity, '1000']) {
      assert.throws(() => histo.rewind(instant as any, () => { appels++ }), (err: any) => err.constructor === Error && err.message.includes('rewind') && err.message.includes(String(instant)), String(instant))
    }
    assert.equal(appels, 0)
  })

  it('un instant fini rembobine toujours à l entrée la plus proche', () => {
    const histo = createHistory(3)
    histo.pousser(1, 1000, { a: { x: 1, y: 2 } })
    histo.pousser(2, 1050, { a: { x: 3, y: 4 } })
    const vu = histo.rewind(1010, (positions, meta) => ({ x: positions.a.x, tick: meta.tick, gap: meta.gap }))
    assert.deepEqual(vu, { x: 1, tick: 1, gap: 10 })
  })
})
