// minuteur d'inactivité (src/mjs-ws/guard.ts, Watchdog) — réarmé à CHAQUE trame reçue : il se
// rafraîchit (`refresh()`) au lieu de créer un minuteur neuf par message, et garde exactement le même
// comportement (déclenche après `ms` sans pet(), se réarme après déclenchement, stop() coupe).
import assert from 'node:assert/strict'
import { Watchdog } from '../src/mjs-ws/guard.js'

const tick = (ms: number) => new Promise<void>(r => setTimeout(r, ms))

describe('mjs-ws — Watchdog : un seul minuteur, rafraîchi à chaque pet()', () => {
  it('1000 pet() de suite ne créent qu\'un seul minuteur', () => {
    const vrai  = globalThis.setTimeout
    let crees   = 0
    const garde = new Watchdog(60000, () => {})
    ;(globalThis as any).setTimeout = (...args: any[]) => { crees++; return (vrai as any)(...args) }
    try {
      for (let i = 0; i < 1000; i++) garde.pet()
    }
    finally {
      globalThis.setTimeout = vrai
      garde.stop()
    }
    assert.equal(crees, 1, `un seul setTimeout attendu, obtenu ${crees}`)
  })

  it('même comportement : déclenche sans pet(), repousse l\'échéance à chaque pet(), se réarme, stop() coupe', async () => {
    let declenchements = 0
    const garde        = new Watchdog(60, () => { declenchements++ })
    garde.pet()
    for (let i = 0; i < 4; i++) { await tick(30); garde.pet() }   // 120 ms écoulées, jamais 60 sans pet()
    assert.equal(declenchements, 0, 'chaque pet() repousse l\'échéance')
    await tick(110)
    assert.equal(declenchements, 1, 'sans pet() pendant 60 ms : déclenché une fois')
    garde.pet()
    await tick(110)
    assert.equal(declenchements, 2, 'un pet() après déclenchement réarme le minuteur')
    garde.pet()
    garde.stop()
    await tick(110)
    assert.equal(declenchements, 2, 'stop() coupe pour de bon')
    garde.pet()
    await tick(110)
    assert.equal(declenchements, 3, 'un pet() après stop() réarme un minuteur neuf')
    garde.stop()
  })

  it('ms <= 0 : désactivé, aucun minuteur', () => {
    const vrai  = globalThis.setTimeout
    let crees   = 0
    const garde = new Watchdog(0, () => {})
    ;(globalThis as any).setTimeout = (...args: any[]) => { crees++; return (vrai as any)(...args) }
    try { garde.pet(); garde.pet() }
    finally { globalThis.setTimeout = vrai }
    assert.equal(crees, 0)
  })
})
