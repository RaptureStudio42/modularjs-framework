// module cœur knob (<@@knob>) : `change` part une fois, à la fin du geste, comme <@@number>, <@@gauge> et un curseur natif — un glissé
// (pointeur relâché), une flèche tenue (touche relâchée), une série de crans de molette (molette arrêtée) ; la variable liée, elle,
// suit chaque pas.

import assert from 'node:assert/strict'
import { terminateSharedWorkerPool } from '../src/bundler/index.js'
import { attendre, monterHote, pause } from './helpers/coeur-monter.js'

const HOTE = [
  '<script>',
  '  $k = 5',
  '  $chg = []',
  '  note = (e) -> $chg = [...$chg, e.data]',
  '</script>',
  '<@@knob class="k" value=!{$k} min="0" max="100" @change={note(e)}></@@knob>',
  '<p class="v">{$k}</p><p class="chg">{JSON.stringify($chg)}</p>',
].join('\n')

describe('mjs-core-knob — `change` à la fin du geste', function () {
  this.timeout(60000)
  after(async () => { await terminateSharedWorkerPool() })

  const cadran  = (hote: any) => hote._shadow.querySelector('.k')._shadow.querySelector('.knob')
  const changes = (hote: any) => JSON.parse(hote._shadow.querySelector('.chg').textContent)
  const valeur  = (hote: any) => Number(hote._shadow.querySelector('.v').textContent)

  it('un glissé de cinq mouvements : la variable suit, un seul `change`, au relâché', async () => {
    const { window, hote } = await monterHote(HOTE, 'knob-glisse')
    const dial = cadran(hote)
    dial.getBoundingClientRect = () => ({ left: 0, top: 0, width: 100, height: 100, right: 100, bottom: 100 })
    dial.setPointerCapture = () => {}
    dial.dispatchEvent(new window.PointerEvent('pointerdown', { clientX: 50, clientY: 0, button: 0, bubbles: true }))
    for (const x of [55, 60, 65, 70, 75]) dial.dispatchEvent(new window.PointerEvent('pointermove', { clientX: x, clientY: 2, bubbles: true }))
    await pause(40)
    assert.deepEqual(changes(hote), [], 'rien avant la fin du geste')
    assert.notEqual(valeur(hote), 5, 'la variable liée suit le geste')
    dial.dispatchEvent(new window.PointerEvent('pointerup', { bubbles: true }))
    await pause(40)
    assert.deepEqual(changes(hote), [valeur(hote)])
    window.close()
  })

  it('une flèche tenue (trois répétitions) : un seul `change`, à la touche relâchée', async () => {
    const { window, hote } = await monterHote(HOTE, 'knob-fleche')
    const dial = cadran(hote)
    for (let i = 0; i < 3; i++) dial.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true, cancelable: true }))
    await pause(40)
    assert.equal(valeur(hote), 8)
    assert.deepEqual(changes(hote), [])
    dial.dispatchEvent(new window.KeyboardEvent('keyup', { key: 'ArrowUp', bubbles: true }))
    await pause(40)
    assert.deepEqual(changes(hote), [8])
    window.close()
  })

  it('trois crans de molette : un seul `change`, molette arrêtée', async () => {
    const { window, hote } = await monterHote(HOTE, 'knob-molette')
    const dial = cadran(hote)
    for (let i = 0; i < 3; i++) {
      dial.dispatchEvent(new window.WheelEvent('wheel', { deltaX: 0, deltaY: -100, bubbles: true, cancelable: true }))
      await pause(30)
    }
    assert.equal(valeur(hote), 8)
    assert.deepEqual(changes(hote), [])
    await attendre(() => changes(hote).length > 0, 1500)
    assert.deepEqual(changes(hote), [8])
    window.close()
  })
})
