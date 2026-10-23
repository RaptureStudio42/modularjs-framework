// chien de garde systemd : un plancher de 100 ms faisait battre un service réglé sous `WatchdogSec=100ms` moins souvent que
// sa fenêtre — systemd le tuait à chaque fois. Le battement reste à la moitié de la fenêtre, quelle qu'elle soit ; une
// fenêtre de moins de 200 ms est signalée par un avertissement qui dit ce qu'elle coûte
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { armWatchdog } from '../src/mjs-ws/watchdog.js'

// systemd-notify factice, chaque battement réussi
const spawn = (): any => { const e = new EventEmitter(); setImmediate(() => e.emit('exit', 0)); return e }

function armer(usec: number): { periode: number; avertissements: string[] } {
  const logs: Array<[string, string]> = []
  const h = armWatchdog((niveau, message) => { logs.push([niveau, message]) }, { spawn, env: { WATCHDOG_USEC: String(usec) }, pid: 1, quitter: () => {} })
  h!.stop()
  const info = logs.find(([niveau]) => niveau === 'info')
  assert.ok(info, 'battement annoncé : ' + JSON.stringify(logs))
  const m = /(\d+) ms \D+(\d+) ms/.exec(info![1])
  assert.ok(m, 'période et fenêtre lues dans : ' + info![1])
  assert.equal(Number(m![2]), usec / 1000, 'la fenêtre annoncée')
  return { periode: Number(m![1]), avertissements: logs.filter(([niveau]) => niveau === 'warn').map(([, message]) => message) }
}

describe('MJS-WS — chien de garde : le battement tient dans la fenêtre', () => {
  it('WatchdogSec=50ms : battement toutes les 25 ms, avec un avertissement juste', () => {
    const { periode, avertissements } = armer(50000)
    assert.equal(periode, 25)
    assert.equal(avertissements.length, 1)
    assert.match(avertissements[0], /50 ms/)
    assert.match(avertissements[0], /25 ms/)
    assert.doesNotMatch(avertissements[0], /100 ms/, 'aucun battement ramené au-delà de la moitié')
  })

  it('quelle que soit la fenêtre, le battement n\'en dépasse jamais la moitié ; avertissement sous 200 ms seulement', () => {
    for (const ms of [2, 10, 50, 99, 150, 199, 200, 1000, 30000]) {
      const { periode, avertissements } = armer(ms * 1000)
      assert.ok(periode * 2 <= ms, `fenêtre ${ms} ms : battement ${periode} ms`)
      assert.equal(avertissements.length, ms < 200 ? 1 : 0, `fenêtre ${ms} ms : ${JSON.stringify(avertissements)}`)
    }
  })
})
