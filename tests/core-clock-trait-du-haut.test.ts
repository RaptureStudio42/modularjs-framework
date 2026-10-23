// <@@clock> : à la seconde 0 (et à la minute 0), le trait du haut s'allume — un cadran compte ses
// traits de 1 à 60, le 60 est en haut. Avant, rien ne s'allumait à 0 : une seconde éteinte à chaque
// minute, et le cadran des minutes éteint toute la première minute de chaque heure.

import assert from 'node:assert/strict'
import { monterHote, pause } from './helpers/coeur-monter.js'
import { terminateSharedWorkerPool } from '../src/bundler/index.js'

describe('<@@clock> — le trait du haut, à zéro', function () {
  this.timeout(60000)
  after(async () => { await terminateSharedWorkerPool() })

  it('12:00:00 : les trois cadrans ont leur trait allumé, en haut', async () => {
    const { window, hote } = await monterHote('<@@clock class="horloge"></@@clock>\n', 'clock-trait-du-haut')
    const Vrai = window.Date
    window.Date = class extends Vrai {
      constructor(...a: any[]) {
        if (a.length) super(...(a as []))
        else super(2026, 8, 30, 12, 0, 0)
      }
    }
    try {
      await pause(1150)
      const c = hote._shadow.querySelector('.horloge')
      const actifs = [...c._shadow.querySelectorAll('.tick.active')].map((t: any) => t.style.getPropertyValue('--mjs-clock-a'))
      assert.equal(actifs.length, 3, JSON.stringify(actifs))
      assert.ok(actifs.every((a: string) => a === '360deg'), JSON.stringify(actifs))
    }
    finally {
      window.Date = Vrai
      window.close()
    }
  })
})
