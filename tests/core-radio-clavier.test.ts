// module cœur radio (<@@radio>) au clavier : chaque case native vit dans son propre shadow, le
// navigateur y voit autant de groupes que de boutons — les flèches ne changeaient rien et chaque bouton
// comptait un arrêt de tabulation. Le module fait donc lui-même ce que fait un groupe natif : les
// flèches cochent le voisin de même name (en bouclant, en sautant les boutons désactivés) et y
// mettent le focus ; seul le bouton coché (ou tous, quand aucun ne l'est) reste dans l'ordre de
// tabulation.

import assert from 'node:assert/strict'
import { terminateSharedWorkerPool } from '../src/bundler/index.js'
import { attendre, monterHote, pause } from './helpers/coeur-monter.js'

const HOTE = [
  '<script>',
  '  $size = \'m\'',
  '</script>',
  '<@@radio id="ra" name="size" value="s" group=!{$size}>S</@@radio>',
  '<@@radio id="rb" name="size" value="m" group=!{$size}>M</@@radio>',
  '<@@radio id="rc" name="size" value="l" group=!{$size}>L</@@radio>',
  '<p id="val">{$size}</p>',
].join('\n')

const natif  = (hote: any, id: string) => hote._shadow.querySelector('#' + id)._shadow.querySelector('input.native')
const valeur = (hote: any) => hote._shadow.querySelector('#val').textContent
const touche = (window: any, el: any, key: string) => el.dispatchEvent(new window.KeyboardEvent('keydown', { key, bubbles: true, composed: true, cancelable: true }))
const arrets = (hote: any) => ['ra', 'rb', 'rc'].map((id) => natif(hote, id).tabIndex)

describe('mjs-core-radio — au clavier', function () {
  this.timeout(60000)
  after(async () => { await terminateSharedWorkerPool() })

  it('un seul arrêt de tabulation : le bouton coché', async () => {
    const { window, hote } = await monterHote(HOTE, 'radio-arret')
    assert.deepEqual(arrets(hote), [-1, 0, -1])
    window.close()
  })

  it('aucun bouton coché : tous restent atteignables', async () => {
    const { window, hote } = await monterHote(HOTE.replace('$size = \'m\'', '$size = \'\''), 'radio-aucun')
    assert.deepEqual(arrets(hote), [0, 0, 0])
    window.close()
  })

  it('flèche droite : le bouton suivant est coché, la valeur liée suit, le focus y passe, l\'arrêt de tabulation aussi', async () => {
    const { window, hote } = await monterHote(HOTE, 'radio-fleche')
    const ev = touche(window, natif(hote, 'rb'), 'ArrowRight')
    await attendre(() => valeur(hote) === 'l')
    await pause(40)
    assert.equal(valeur(hote), 'l')
    assert.equal(ev, false, 'la touche est prise (défaut empêché)')
    assert.deepEqual(['ra', 'rb', 'rc'].map((id) => natif(hote, id).checked), [false, false, true])
    assert.equal(hote._shadow.querySelector('#rc')._shadow.activeElement === natif(hote, 'rc'), true, 'le focus est sur le bouton coché')
    assert.deepEqual(arrets(hote), [-1, -1, 0])
    window.close()
  })

  it('au bout du groupe, la flèche repart de l\'autre bout ; flèche gauche ou haut reculent', async () => {
    const { window, hote } = await monterHote(HOTE.replace('$size = \'m\'', '$size = \'l\''), 'radio-boucle')
    touche(window, natif(hote, 'rc'), 'ArrowDown')
    await attendre(() => valeur(hote) === 's')
    assert.equal(valeur(hote), 's')
    touche(window, natif(hote, 'ra'), 'ArrowUp')
    await attendre(() => valeur(hote) === 'l')
    assert.equal(valeur(hote), 'l')
    touche(window, natif(hote, 'rc'), 'ArrowLeft')
    await attendre(() => valeur(hote) === 'm')
    assert.equal(valeur(hote), 'm')
    window.close()
  })

  it('un bouton désactivé est sauté', async () => {
    const { window, hote } = await monterHote(HOTE.replace('value="l" group', 'value="l" disabled group'), 'radio-desactive')
    touche(window, natif(hote, 'rb'), 'ArrowRight')
    await attendre(() => valeur(hote) === 's')
    assert.equal(valeur(hote), 's')
    window.close()
  })

  it('le bouton coché retiré de la page : les autres reprennent leur place dans l\'ordre de tabulation', async () => {
    const { window, hote } = await monterHote(HOTE, 'radio-retire')
    const a = natif(hote, 'ra')
    const c = natif(hote, 'rc')
    hote._shadow.querySelector('#rb').remove()
    await pause(80)
    assert.deepEqual([a.tabIndex, c.tabIndex], [0, 0])
    window.close()
  })
})
