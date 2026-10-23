// module cœur knob (<@@knob>) : un pas nul ou négatif (`step="0"`) retombe sur le pas par défaut —
// la valeur arrondie au pas divisait par zéro, NaN partait chez le parent et dans le formulaire.

import assert from 'node:assert/strict'
import { terminateSharedWorkerPool } from '../src/bundler/index.js'
import { attendre, monterHote } from './helpers/coeur-monter.js'

const HOTE = [
  '<script>',
  '  $k = 5',
  '</script>',
  '<form class="f">',
  '  <@@knob class="k0" value=!{$k} min="0" max="10" step="0" name="vol"></@@knob>',
  '</form>',
  '<p class="pk">{$k}</p>',
].join('\n')

describe('mjs-core-knob — pas nul', function () {
  this.timeout(60000)
  after(async () => { await terminateSharedWorkerPool() })

  it('step="0" : la flèche haut avance d\'un pas de 1, la valeur liée et le formulaire aussi', async () => {
    const { window, hote } = await monterHote(HOTE, 'knob-pas-nul')
    const k = hote._shadow.querySelector('.k0')
    k._shadow.querySelector('.knob').dispatchEvent(new window.KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true }))
    await attendre(() => hote._shadow.querySelector('.pk').textContent !== '5')
    assert.equal(hote._shadow.querySelector('.pk').textContent, '6')
    assert.equal(String(k._state.value), '6')
    assert.deepEqual([...new window.FormData(hote._shadow.querySelector('.f')).entries()], [['vol', '6']])
    window.close()
  })

  it('step="0" : Fin mène au maximum, la molette recule d\'un pas', async () => {
    const { window, hote } = await monterHote(HOTE, 'knob-pas-nul-fin')
    const k    = hote._shadow.querySelector('.k0')
    const dial = k._shadow.querySelector('.knob')
    dial.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'End', bubbles: true }))
    await attendre(() => hote._shadow.querySelector('.pk').textContent !== '5')
    assert.equal(hote._shadow.querySelector('.pk').textContent, '10')
    dial.dispatchEvent(new window.WheelEvent('wheel', { deltaY: 100, bubbles: true, cancelable: true }))
    await attendre(() => hote._shadow.querySelector('.pk').textContent !== '10')
    assert.equal(hote._shadow.querySelector('.pk').textContent, '9')
    window.close()
  })
})
