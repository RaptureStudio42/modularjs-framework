// module cœur knob (<@@knob>) : cas limites — désactivé, il ne part pas avec le formulaire (comme un
// champ natif désactivé) ; l'arc du pointeur est borné comme celui du dessin ; seul le bouton
// principal de la souris le tourne ; un glissé horizontal du pavé tactile ne le baisse pas.

import assert from 'node:assert/strict'
import { terminateSharedWorkerPool } from '../src/bundler/index.js'
import { attendre, monterHote, pause } from './helpers/coeur-monter.js'

const lireK = (hote: any) => hote._shadow.querySelector('#pk').textContent

describe('mjs-core-knob — cas limites', function () {
  this.timeout(60000)
  after(async () => { await terminateSharedWorkerPool() })

  it('désactivé avec un name : rien dans le formulaire', async () => {
    const { window, hote } = await monterHote('<form id="f"><@@knob value="50" name="vol" disabled></@@knob></form>', 'knob-desactive')
    assert.deepEqual([...new window.FormData(hote._shadow.querySelector('#f')).entries()], [])
    window.close()
  })

  it('arc="0" : le pointeur donne une valeur bornée, jamais NaN', async () => {
    const { window, hote } = await monterHote('<script>\n  $k = 50\n</script>\n<@@knob id="k" value=!{$k} arc="0"></@@knob>\n<p id="pk">{$k}</p>', 'knob-arc')
    const dial = hote._shadow.querySelector('#k')._shadow.querySelector('.knob')
    dial.dispatchEvent(new window.PointerEvent('pointerdown', { clientX: 100, clientY: 0, button: 0, bubbles: true }))
    await attendre(() => lireK(hote) !== '50')
    assert.ok(Number.isFinite(Number(lireK(hote))), `valeur liée : ${lireK(hote)}`)
    window.close()
  })

  it('clic droit ou du milieu : le bouton ne tourne pas', async () => {
    const { window, hote } = await monterHote('<script>\n  $k = 50\n</script>\n<@@knob id="k" value=!{$k}></@@knob>\n<p id="pk">{$k}</p>', 'knob-bouton')
    const dial = hote._shadow.querySelector('#k')._shadow.querySelector('.knob')
    dial.dispatchEvent(new window.PointerEvent('pointerdown', { clientX: 100, clientY: 0, button: 2, bubbles: true }))
    dial.dispatchEvent(new window.PointerEvent('pointerdown', { clientX: 100, clientY: 0, button: 1, bubbles: true }))
    await pause(60)
    assert.equal(lireK(hote), '50')
    dial.dispatchEvent(new window.PointerEvent('pointerdown', { clientX: 100, clientY: 0, button: 0, bubbles: true }))
    await attendre(() => lireK(hote) !== '50')
    assert.notEqual(lireK(hote), '50', 'témoin : le bouton principal tourne')
    window.close()
  })

  it('molette : un glissé horizontal ne change rien, un cran vertical si', async () => {
    const { window, hote } = await monterHote('<script>\n  $k = 50\n</script>\n<@@knob id="k" value=!{$k}></@@knob>\n<p id="pk">{$k}</p>', 'knob-molette')
    const dial = hote._shadow.querySelector('#k')._shadow.querySelector('.knob')
    dial.dispatchEvent(new window.WheelEvent('wheel', { deltaX: 120, deltaY: 0, bubbles: true, cancelable: true }))
    await pause(60)
    assert.equal(lireK(hote), '50', 'glissé horizontal : rien')
    dial.dispatchEvent(new window.WheelEvent('wheel', { deltaX: 0, deltaY: -100, bubbles: true, cancelable: true }))
    await attendre(() => lireK(hote) !== '50')
    assert.equal(lireK(hote), '51', 'cran vertical : un pas')
    window.close()
  })
})
