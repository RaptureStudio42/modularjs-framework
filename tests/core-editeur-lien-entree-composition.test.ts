// Champ d'adresse du lien de l'éditeur riche du cœur (<@@editor>), joué dans happy-dom : la touche qui valide ou annule une composition de saisie
// (japonais, chinois, coréen… : `isComposing`, ou le code 229 que Safari donne à l'Entrée qui valide) appartient à la méthode de saisie :
// le lien n'est pas appliqué et le champ reste ouvert ; hors composition, Entrée applique le lien et ferme le champ.

import assert from 'node:assert/strict'
import { terminateSharedWorkerPool } from '../src/bundler/index.js'
import { attendre, monter } from './helpers/editeur-riche.js'

const HOTE = `<@@editor class="ed" name="a" value="<p>un</p>"></@@editor>`

const pause = (ms: number) => new Promise((r) => setTimeout(r, ms))

describe('éditeur riche : l\'Entrée d\'une composition dans le champ du lien (happy-dom)', function () {
  this.timeout(120000)
  let window: any
  let hote: any

  const ed      = () => hote._shadow.querySelector('.ed')
  const ouvert  = () => !!ed()._shadow.querySelector('.link')
  const touche  = (init: any) => ed()._shadow.querySelector('.link-url').dispatchEvent(new window.KeyboardEvent('keydown', { bubbles: true, composed: true, cancelable: true, ...init }))

  // le champ du lien ouvert, une adresse tapée : chaque essai part de là, quel que soit le précédent
  async function ouvrir() {
    if (!ouvert()) {
      ed()._mjsExec('link')
      await attendre(() => !!ed()._shadow.querySelector('.link-url'), 3000)
    }
    const champ = ed()._shadow.querySelector('.link-url')
    champ.value = 'exemple'
    champ.dispatchEvent(new window.Event('input', { bubbles: true, composed: true }))
    await pause(30)
    assert.ok(ouvert(), 'le champ du lien est ouvert')
  }

  before(async () => {
    ;({ window, hote } = await monter(HOTE, 'editeur-lien-composition'))
    await attendre(() => !!ed()?._shadow?.querySelector('.surface p') && !!ed()._mjsExec, 10000)
  })

  after(async () => {
    await window?.happyDOM?.close()
    await terminateSharedWorkerPool()
  })

  it('l\'Entrée qui valide une composition (isComposing) laisse le champ ouvert', async function () {
    await ouvrir()
    touche({ key: 'Enter', isComposing: true })
    await pause(40)
    assert.ok(ouvert(), 'Entrée valide la composition, pas le lien')
  })

  it('l\'Entrée de code 229 (Safari, composition en cours) laisse le champ ouvert', async function () {
    await ouvrir()
    touche({ key: 'Enter', keyCode: 229 })
    await pause(40)
    assert.ok(ouvert())
  })

  it('l\'Échap qui annule une composition laisse le champ ouvert', async function () {
    await ouvrir()
    touche({ key: 'Escape', isComposing: true })
    await pause(40)
    assert.ok(ouvert(), 'Échap annule la composition, pas le lien')
  })

  it('hors composition, Entrée applique le lien et ferme le champ', async function () {
    await ouvrir()
    touche({ key: 'Enter' })
    await pause(40)
    assert.ok(!ouvert())
  })
})
