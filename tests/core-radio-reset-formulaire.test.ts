// module cœur radio (<@@radio>) : `form.reset()` ramène le bouton à l'état de son premier rendu. La
// case native vit dans le shadow du module, hors du formulaire : sa remise à zéro ne l'atteignait pas,
// et un bouton « réinitialiser » laissait le choix de l'utilisateur. Un groupe lié (group=!{…}) revient
// à sa valeur de départ, un bouton `checked` à coché, les autres à décochés ; un reset annulé par un
// écouteur (preventDefault) ne change rien.

import assert from 'node:assert/strict'
import { terminateSharedWorkerPool } from '../src/bundler/index.js'
import { attendre, monterHote, pause } from './helpers/coeur-monter.js'

const HOTE = [
  '<script>',
  '  $size = \'m\'',
  '</script>',
  '<form id="f" @noUJS>',
  '  <@@radio id="ra" name="size" value="s" group=!{$size}>S</@@radio>',
  '  <@@radio id="rb" name="size" value="m" group=!{$size}>M</@@radio>',
  '  <@@radio id="rc" name="size" value="l" group=!{$size}>L</@@radio>',
  '  <@@radio id="va" name="couleur" value="rouge" checked>Rouge</@@radio>',
  '  <@@radio id="vb" name="couleur" value="vert">Vert</@@radio>',
  '  <@@radio id="wa" name="forme" value="rond">Rond</@@radio>',
  '  <@@radio id="wb" name="forme" value="carre">Carré</@@radio>',
  '</form>',
  '<p id="val">{$size}</p>',
].join('\n')

const natif      = (hote: any, id: string) => hote._shadow.querySelector('#' + id)._shadow.querySelector('input.native')
const valeur     = (hote: any) => hote._shadow.querySelector('#val').textContent
const coches     = (hote: any, ids: string[]) => ids.map((id) => natif(hote, id).checked)
const formulaire = (hote: any) => hote._shadow.querySelector('#f')

// un clic de l'utilisateur : le natif passe à coché PUIS l'événement change part
function choisir(window: any, el: any) {
  el.checked = true
  el.dispatchEvent(new window.Event('change', { bubbles: true, cancelable: true, composed: true }))
}

describe('mjs-core-radio — form.reset()', function () {
  this.timeout(60000)
  after(async () => { await terminateSharedWorkerPool() })

  it('un groupe lié revient à sa valeur de départ, et la variable de la page avec lui', async () => {
    const { window, hote } = await monterHote(HOTE, 'radio-reset-lie')
    assert.deepEqual(coches(hote, ['ra', 'rb', 'rc']), [false, true, false], 'départ')
    choisir(window, natif(hote, 'rc'))
    await attendre(() => valeur(hote) === 'l')
    assert.deepEqual(coches(hote, ['ra', 'rb', 'rc']), [false, false, true], 'le choix de l\'utilisateur')
    formulaire(hote).reset()
    await attendre(() => valeur(hote) === 'm')
    await pause(40)
    assert.equal(valeur(hote), 'm', 'la variable liée est revenue')
    assert.deepEqual(coches(hote, ['ra', 'rb', 'rc']), [false, true, false], 'le bouton de départ est recoché, l\'autre décoché')
    assert.deepEqual(['ra', 'rb', 'rc'].map((id) => natif(hote, id).tabIndex), [-1, 0, -1], 'l\'arrêt de tabulation suit')
    window.close()
  })

  it('un reset alors que rien n\'a changé laisse le bouton de départ coché', async () => {
    const { window, hote } = await monterHote(HOTE, 'radio-reset-intact')
    formulaire(hote).reset()
    await pause(80)
    assert.equal(valeur(hote), 'm')
    assert.deepEqual(coches(hote, ['ra', 'rb', 'rc']), [false, true, false])
    window.close()
  })

  it('un bouton `checked` hors liaison revient à coché, son voisin à décoché', async () => {
    const { window, hote } = await monterHote(HOTE, 'radio-reset-checked')
    assert.deepEqual(coches(hote, ['va', 'vb']), [true, false], 'départ')
    choisir(window, natif(hote, 'vb'))
    await attendre(() => natif(hote, 'va').checked === false)
    assert.deepEqual(coches(hote, ['va', 'vb']), [false, true], 'le choix de l\'utilisateur')
    formulaire(hote).reset()
    await attendre(() => natif(hote, 'va').checked === true)
    await pause(40)
    assert.deepEqual(coches(hote, ['va', 'vb']), [true, false], 'le bouton `checked` est recoché, son voisin décoché')
    window.close()
  })

  it('un groupe sans bouton coché au départ redevient sans bouton coché', async () => {
    const { window, hote } = await monterHote(HOTE, 'radio-reset-aucun')
    choisir(window, natif(hote, 'wb'))
    await attendre(() => natif(hote, 'wb').checked === true)
    await pause(40)
    formulaire(hote).reset()
    await attendre(() => natif(hote, 'wb').checked === false)
    await pause(40)
    assert.deepEqual(coches(hote, ['wa', 'wb']), [false, false])
    window.close()
  })

  it('un reset annulé par un écouteur (preventDefault) ne change pas la sélection', async () => {
    const { window, hote } = await monterHote(HOTE, 'radio-reset-annule')
    choisir(window, natif(hote, 'rc'))
    await attendre(() => valeur(hote) === 'l')
    formulaire(hote).addEventListener('reset', (e: any) => e.preventDefault())
    formulaire(hote).reset()
    await pause(120)
    assert.equal(valeur(hote), 'l', 'la variable liée garde le choix')
    assert.deepEqual(coches(hote, ['ra', 'rb', 'rc']), [false, false, true], 'le bouton choisi reste coché')
    window.close()
  })
})
