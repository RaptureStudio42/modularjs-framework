// chien de garde systemd : le battement suit la moitié de `WatchdogSec`, quelle qu'elle soit — un plancher plus haut ferait
// battre un service réglé court moins souvent que sa fenêtre, et systemd le tuerait. Une fenêtre absurde
// (`WatchdogSec=10ms`, `systemd-notify` lancé toutes les 5 ms) est signalée par un avertissement qui nomme la fenêtre ; une
// fenêtre normale garde sa moitié, sans un mot
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { armWatchdog } from '../src/mjs-ws/watchdog.js'

const tick = (ms = 0) => new Promise<void>(r => setTimeout(r, ms))

// systemd-notify factice : compte les battements, chacun réussi
function notifieur(): { spawn: any; battements: () => number } {
  let n = 0
  const spawn = () => { n++; const e = new EventEmitter(); setImmediate(() => e.emit('exit', 0)); return e }
  return { spawn, battements: () => n }
}

describe('MJS-WS — chien de garde : plancher du battement', function () {
  this.timeout(10000)

  it('WatchdogSec=10ms : battement à la moitié, 5 ms, avec un avertissement', async () => {
    const f    = notifieur()
    const logs: Array<[string, string]> = []
    const h    = armWatchdog((niveau, message) => { logs.push([niveau, message]) }, { spawn: f.spawn, env: { WATCHDOG_USEC: '10000' }, pid: 1, quitter: () => {} })
    assert.ok(h, 'armé')
    await tick(100)
    h!.stop()
    assert.ok(f.battements() >= 3, `battements en 100 ms : ${f.battements()} (un toutes les 5 ms, moins le retard de la machine)`)
    assert.ok(logs.some(([niveau, message]) => niveau === 'info' && /\b5 ms/.test(message)), 'battement à 5 ms : ' + JSON.stringify(logs))
    assert.ok(logs.some(([niveau, message]) => niveau === 'warn' && /10 ms/.test(message)), 'avertissement qui nomme la fenêtre : ' + JSON.stringify(logs))
  })

  it('WatchdogSec=1s : battement à la moitié de la fenêtre, sans avertissement', () => {
    const f    = notifieur()
    const logs: Array<[string, string]> = []
    const h    = armWatchdog((niveau, message) => { logs.push([niveau, message]) }, { spawn: f.spawn, env: { WATCHDOG_USEC: '1000000' }, pid: 1, quitter: () => {} })
    h!.stop()
    assert.ok(logs.some(([niveau, message]) => niveau === 'info' && /500/.test(message)), 'battement à 500 ms : ' + JSON.stringify(logs))
    assert.ok(!logs.some(([niveau]) => niveau === 'warn'), 'aucun avertissement')
  })
})
