// chien de garde systemd (src/mjs-ws/watchdog.ts) — le battement part à la MOITIÉ de WatchdogSec,
// la marge que recommande systemd, quelle que soit la fenêtre. Un plancher d'une seconde faisait battre
// un service réglé à WatchdogSec=1 toutes les 1000 ms, soit la fenêtre entière : le moindre retard
// (fork de systemd-notify, ramasse-miettes) et systemd tuait un service sain, en boucle.
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { armWatchdog } from '../src/mjs-ws/watchdog.js'
import type { MjsWsLogLevel } from '../src/mjs-ws/core.js'

// faux `spawn` : un émetteur qui sort en 0, comme le vrai systemd-notify quand tout va bien
function fauxSpawn() {
  const appels: number[] = []
  const spawn = (() => {
    const enfant = new EventEmitter()
    appels.push(Date.now())
    queueMicrotask(() => enfant.emit('exit', 0))
    return enfant
  }) as unknown as Parameters<typeof armWatchdog>[1] extends { spawn?: infer S } ? S : never
  return { appels, spawn }
}

// la période annoncée au journal (« … toutes les N ms … »)
function periodeAnnoncee(usec: string): number {
  const lignes: string[] = []
  const log = (_niveau: MjsWsLogLevel, message: string) => { lignes.push(message) }
  const { spawn } = fauxSpawn()
  const h = armWatchdog(log, { spawn, env: { WATCHDOG_USEC: usec } })
  h!.stop()
  const m = /(\d+) ms/.exec(lignes.at(-1) ?? '')
  assert.ok(m, 'la ligne d\'armement annonce sa période')
  return Number(m![1])
}

describe('mjs-ws — chien de garde systemd : battement à la moitié de la fenêtre', () => {
  it('WatchdogSec=1 → un battement toutes les 500 ms, pas toutes les 1000', () => {
    assert.equal(periodeAnnoncee('1000000'), 500)
  })

  it('WatchdogSec=0,4 → 200 ms ; WatchdogSec=30 → 15 000 ms (inchangé)', () => {
    assert.equal(periodeAnnoncee('400000'), 200)
    assert.equal(periodeAnnoncee('30000000'), 15000)
  })

  it('les battements suivent vraiment cette période (fenêtre de 0,4 s : au moins 4 battements en 700 ms)', async () => {
    const { appels, spawn } = fauxSpawn()
    const h = armWatchdog(() => {}, { spawn, env: { WATCHDOG_USEC: '400000' } })
    await new Promise<void>(r => setTimeout(r, 700))
    h!.stop()
    assert.ok(appels.length >= 4, `au moins 4 battements attendus, obtenu ${appels.length}`)
  })
})
