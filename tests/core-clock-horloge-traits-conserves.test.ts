// module cœur clock (<@@clock>, l'horloge) : d'une seconde à l'autre, seuls le chiffre et le trait
// allumé changent — les trois cadrans et leurs 180 traits restent les mêmes nœuds. Tirés d'un dérivé,
// ils étaient reconstruits en entier à chaque seconde (le moteur de {for} refait la liste quand son
// corps lit une variable qui change) ; la liste des cadrans est désormais un état, posé par un effet.

import assert from 'node:assert/strict'
import { terminateSharedWorkerPool } from '../src/bundler/index.js'
import { monterHote, pause } from './helpers/coeur-monter.js'

describe('mjs-core-clock horloge — les traits ne sont pas recréés chaque seconde', function () {
  this.timeout(60000)
  after(async () => { await terminateSharedWorkerPool() })

  it('après un changement de seconde, les 180 traits sont les mêmes nœuds ; trois restent allumés', async () => {
    const { window, hote } = await monterHote('<@@clock id="h" colors="#f00, #0f0, #00f"></@@clock>', 'clock-traits')
    const racine = hote._shadow.querySelector('#h')._shadow
    const avant  = [...racine.querySelectorAll('.tick')]
    const sec    = racine.querySelectorAll('.dots')[2].querySelector('h2').firstChild.textContent
    await pause(1250)
    const apres = [...racine.querySelectorAll('.tick')]
    assert.notEqual(racine.querySelectorAll('.dots')[2].querySelector('h2').firstChild.textContent, sec, 'préalable : la seconde a changé')
    assert.equal(apres.length, 180)
    assert.equal(apres.filter((t) => avant.includes(t)).length, 180)
    assert.equal(racine.querySelectorAll('.tick.active').length, 3)
    assert.equal(racine.querySelectorAll('.dots')[0].style.getPropertyValue('--mjs-clock-color'), '#f00', 'les couleurs des cadrans')
    window.close()
  })

  it('les couleurs changées en route redessinent les cadrans ; le minuteur n\'en a pas', async () => {
    const { window, hote } = await monterHote('<script>\n  $c = \'#f00\'\n  $lay = \'\'\n</script>\n<@@clock id="h" colors={$c} layout={$lay}></@@clock>\n<button id="b" @click={$c = \'#abc\'}>b</button>\n<button id="t" @click={$lay = \'timer\'}>t</button>', 'clock-couleurs')
    hote._shadow.querySelector('#b').click()
    await pause(80)
    const racine = () => hote._shadow.querySelector('#h')._shadow
    assert.equal(racine().querySelectorAll('.dots')[0].style.getPropertyValue('--mjs-clock-color'), '#abc')
    hote._shadow.querySelector('#t').click()
    await pause(80)
    assert.equal(racine().querySelectorAll('.dots').length, 0)
    assert.equal(racine().querySelectorAll('.timer').length, 1)
    window.close()
  })
})
