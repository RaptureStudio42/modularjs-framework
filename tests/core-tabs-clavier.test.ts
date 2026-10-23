// module cœur tabs (<@@tabs>) : les onglets sont des enfants quelconques (<span>, <a> sans href),
// souvent non focalisables — le module leur donne un tabindex itinérant (l'actif à 0, les autres à
// -1) pour que la liste soit atteignable au clavier, les flèches, Début et Fin y circulent, et tout
// ce qu'il a posé sur les onglets s'en va avec lui.

import assert from 'node:assert/strict'
import { terminateSharedWorkerPool } from '../src/bundler/index.js'
import { attendre, monterHote, pause } from './helpers/coeur-monter.js'

const HOTE = [
  '<script>',
  '  $t = \'b\'',
  '</script>',
  '<@@tabs class="tabs" value=!{$t}><span value="a">A</span><span value="b">B</span><span value="c">C</span></@@tabs>',
  '<p class="t">{$t}</p>',
].join('\n')

describe('mjs-core-tabs — au clavier', function () {
  this.timeout(60000)
  after(async () => { await terminateSharedWorkerPool() })

  const touche = (window: any, el: any, key: string) => el.dispatchEvent(new window.KeyboardEvent('keydown', { key, bubbles: true, composed: true }))

  it('l\'onglet actif porte tabindex="0", les autres "-1"', async () => {
    const { window, hote } = await monterHote(HOTE, 'tabs-tabindex')
    const tabs = [...hote._shadow.querySelector('.tabs').children]
    assert.deepEqual(tabs.map((t: any) => t.getAttribute('tabindex')), ['-1', '0', '-1'])
    window.close()
  })

  it('flèche droite : l\'onglet suivant prend la valeur et le tabindex 0', async () => {
    const { window, hote } = await monterHote(HOTE, 'tabs-fleche')
    const tabs = [...hote._shadow.querySelector('.tabs').children]
    touche(window, tabs[1], 'ArrowRight')
    await attendre(() => hote._shadow.querySelector('.t').textContent === 'c')
    await pause(30)
    assert.equal(hote._shadow.querySelector('.t').textContent, 'c')
    assert.deepEqual(tabs.map((t: any) => t.getAttribute('tabindex')), ['-1', '-1', '0'])
    window.close()
  })

  it('Début et Fin : le premier et le dernier onglet', async () => {
    const { window, hote } = await monterHote(HOTE, 'tabs-debut-fin')
    const tabs = [...hote._shadow.querySelector('.tabs').children]
    touche(window, tabs[1], 'Home')
    await attendre(() => hote._shadow.querySelector('.t').textContent === 'a')
    assert.equal(hote._shadow.querySelector('.t').textContent, 'a')
    touche(window, tabs[0], 'End')
    await attendre(() => hote._shadow.querySelector('.t').textContent === 'c')
    assert.equal(hote._shadow.querySelector('.t').textContent, 'c')
    window.close()
  })

  it('le module parti : role, tabindex et aria-selected retirés des onglets', async () => {
    const { window, hote } = await monterHote(HOTE, 'tabs-depart')
    const el   = hote._shadow.querySelector('.tabs')
    const tabs = [...el.children]
    assert.equal(tabs[0].getAttribute('role'), 'tab', 'préalable : rôle posé')
    el.remove()
    await pause(60)
    assert.deepEqual(tabs.map((t: any) => [t.hasAttribute('role'), t.hasAttribute('tabindex'), t.hasAttribute('aria-selected')]), [[false, false, false], [false, false, false], [false, false, false]])
    window.close()
  })
})
