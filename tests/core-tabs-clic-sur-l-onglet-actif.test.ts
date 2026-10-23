// module cœur tabs (<@@tabs>) : un clic sur l'onglet déjà actif n'annonce rien — comme au clavier, `change` ne part que si l'onglet
// actif change (un @change qui recharge un panneau ne le recharge pas pour rien).

import assert from 'node:assert/strict'
import { terminateSharedWorkerPool } from '../src/bundler/index.js'
import { attendre, monterHote, pause } from './helpers/coeur-monter.js'

const HOTE = [
  '<script>',
  '  $t = \'a\'',
  '  $chg = 0',
  '</script>',
  '<@@tabs class="tb" value=!{$t} @change={$chg++}><span value="a">A</span><span value="b">B</span></@@tabs>',
  '<p class="t">{$t}</p><p class="chg">{$chg}</p>',
].join('\n')

describe('mjs-core-tabs — clic sur l\'onglet actif', function () {
  this.timeout(60000)
  after(async () => { await terminateSharedWorkerPool() })

  it('deux clics sur l\'onglet actif : aucun `change` ; un clic sur l\'autre : un `change`', async () => {
    const { window, hote } = await monterHote(HOTE, 'tabs-clic-actif')
    const clic = (v: string) => hote._shadow.querySelector('.tb').querySelector(`[value=${v}]`).dispatchEvent(new window.MouseEvent('click', { bubbles: true, composed: true }))
    clic('a')
    clic('a')
    await pause(50)
    assert.equal(hote._shadow.querySelector('.chg').textContent, '0')
    clic('b')
    await attendre(() => hote._shadow.querySelector('.t').textContent === 'b')
    await pause(30)
    assert.equal(hote._shadow.querySelector('.chg').textContent, '1')
    window.close()
  })
})
