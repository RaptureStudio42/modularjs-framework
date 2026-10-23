// module cœur clock (<@@clock layout="timer">) : l'aiguille et le point du minuteur suivent le
// chiffre. Tirés d'animations CSS, ils repartaient de zéro à chaque reprise (`running` retiré puis
// remis) pendant que le chiffre reprenait où il s'était arrêté — décalés ensuite à chaque tour ; même
// décalage quand `seconds` changeait en route. La progression affichée se lit désormais sur le
// chiffre lui-même (variable --mjs-clock-p, de 0 à 1).

import assert from 'node:assert/strict'
import { terminateSharedWorkerPool } from '../src/bundler/index.js'
import { monterHote, pause } from './helpers/coeur-monter.js'

const HOTE = [
  '<script>',
  '  $run = true',
  '  $sec = 5',
  '</script>',
  '<@@clock class="tm" layout="timer" seconds={$sec} running={$run}></@@clock>',
  '<button class="stop" @click={$run = false}>stop</button>',
  '<button class="go" @click={$run = true}>go</button>',
  '<button class="dix" @click={$sec = 10}>dix</button>',
].join('\n')

describe('mjs-core-clock minuteur — l\'aiguille suit le chiffre', function () {
  this.timeout(60000)
  after(async () => { await terminateSharedWorkerPool() })

  const lire = (hote: any) => {
    const tm = hote._shadow.querySelector('.tm')
    return { t: Number(tm._shadow.querySelector('.number b').textContent), p: tm._shadow.querySelector('.timer').style.getPropertyValue('--mjs-clock-p') }
  }

  it('arrêté puis relancé : la progression affichée reste celle du chiffre', async () => {
    const { window, hote } = await monterHote(HOTE, 'clock-minuteur-reprise')
    await pause(2200)
    hote._shadow.querySelector('.stop').click()
    await pause(80)
    const arret = lire(hote)
    assert.ok(arret.t >= 1, `préalable : le minuteur a compté (${arret.t})`)
    assert.equal(arret.p, String(arret.t / 5), `arrêté : ${JSON.stringify(arret)}`)
    await pause(1200)
    assert.deepEqual(lire(hote), arret, 'arrêté : rien ne bouge')
    hote._shadow.querySelector('.go').click()
    await pause(1150)
    const reprise = lire(hote)
    assert.equal(reprise.t, arret.t + 1, `le chiffre reprend où il s'était arrêté : ${JSON.stringify(reprise)}`)
    assert.equal(reprise.p, String(reprise.t / 5), `relancé : ${JSON.stringify(reprise)}`)
    window.close()
  })

  it('seconds changé en route : la progression se rapporte à la nouvelle durée', async () => {
    const { window, hote } = await monterHote(HOTE, 'clock-minuteur-duree')
    await pause(1150)
    hote._shadow.querySelector('.dix').click()
    await pause(60)
    const vu = lire(hote)
    assert.ok(vu.t >= 1, `préalable : le minuteur a compté (${vu.t})`)
    assert.equal(vu.p, String(vu.t / 10), JSON.stringify(vu))
    window.close()
  })
})
