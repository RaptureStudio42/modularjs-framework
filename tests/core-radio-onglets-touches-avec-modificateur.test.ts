// radio et onglets (<@@radio>, <@@tabs>) laissent passer une touche tenue avec Alt, Ctrl ou Méta :
// Alt+flèche gauche est le « retour » du navigateur, Ctrl+Fin mène au bas de la page — le module ne
// les prend pas pour des flèches de groupe. Le radio natif fait pareil. Sans modificateur, rien ne
// change : la même touche déplace toujours la sélection.

import assert from 'node:assert/strict'
import { terminateSharedWorkerPool } from '../src/bundler/index.js'
import { attendre, monterHote, pause } from './helpers/coeur-monter.js'

const MODIFICATEURS = ['altKey', 'ctrlKey', 'metaKey'] as const

const touche = (window: any, el: any, key: string, init: Record<string, boolean> = {}) =>
  el.dispatchEvent(new window.KeyboardEvent('keydown', { key, bubbles: true, composed: true, cancelable: true, ...init }))

describe('touches avec Alt, Ctrl ou Méta — radio et onglets', function () {
  this.timeout(60000)
  after(async () => { await terminateSharedWorkerPool() })

  it('<@@radio> : la flèche tenue avec un modificateur ne coche rien et n\'est pas prise ; sans modificateur elle coche', async () => {
    const source = [
      '<script>',
      '  $size = \'m\'',
      '</script>',
      '<@@radio id="ra" name="size" value="s" group=!{$size}>S</@@radio>',
      '<@@radio id="rb" name="size" value="m" group=!{$size}>M</@@radio>',
      '<@@radio id="rc" name="size" value="l" group=!{$size}>L</@@radio>',
      '<p id="val">{$size}</p>',
    ].join('\n')
    const { window, hote } = await monterHote(source, 'radio-modificateurs')
    const natif  = hote._shadow.querySelector('#rb')._shadow.querySelector('input.native')
    const valeur = () => hote._shadow.querySelector('#val').textContent
    for (const modificateur of MODIFICATEURS) {
      for (const key of ['ArrowRight', 'ArrowLeft', 'ArrowDown', 'ArrowUp']) {
        const libre = touche(window, natif, key, { [modificateur]: true })
        await pause(30)
        assert.equal(libre, true, `${modificateur}+${key} : la touche reste au navigateur (défaut non empêché)`)
        assert.equal(valeur(), 'm', `${modificateur}+${key} : la sélection n'a pas bougé`)
      }
    }
    const prise = touche(window, natif, 'ArrowRight')
    await attendre(() => valeur() === 'l')
    assert.equal(prise, false, 'sans modificateur, la touche est prise')
    assert.equal(valeur(), 'l', 'sans modificateur, la flèche coche le voisin')
    window.close()
  })

  it('<@@tabs> : flèches, Début et Fin tenus avec un modificateur ne changent pas d\'onglet et ne sont pas pris ; sans modificateur ils changent', async () => {
    const source = [
      '<script>',
      '  $t = \'b\'',
      '</script>',
      '<@@tabs class="tabs" value=!{$t}><span value="a">A</span><span value="b">B</span><span value="c">C</span></@@tabs>',
      '<p class="t">{$t}</p>',
    ].join('\n')
    const { window, hote } = await monterHote(source, 'tabs-modificateurs')
    const onglet = [...hote._shadow.querySelector('.tabs').children][1]
    const valeur = () => hote._shadow.querySelector('.t').textContent
    for (const modificateur of MODIFICATEURS) {
      for (const key of ['ArrowRight', 'ArrowLeft', 'ArrowDown', 'ArrowUp', 'Home', 'End']) {
        const libre = touche(window, onglet, key, { [modificateur]: true })
        await pause(30)
        assert.equal(libre, true, `${modificateur}+${key} : la touche reste au navigateur (défaut non empêché)`)
        assert.equal(valeur(), 'b', `${modificateur}+${key} : l'onglet actif n'a pas bougé`)
      }
    }
    const prise = touche(window, onglet, 'End')
    await attendre(() => valeur() === 'c')
    assert.equal(prise, false, 'sans modificateur, la touche est prise')
    assert.equal(valeur(), 'c', 'sans modificateur, Fin mène au dernier onglet')
    window.close()
  })
})
