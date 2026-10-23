// Un toast permanent affiché pendant le plein écran d'un élément que l'appli RETIRE pendant ce plein écran (le bouton
// « fermer » d'une lightbox, sans navigation) : le navigateur quitte alors le plein écran, et le toast — encore utile, « Hors
// ligne : vos changements attendent » — revient dans le corps de la page avec le conteneur. Seule une navigation qui remplace
// le corps emporte les toasts du plein écran (tests/toasts-plein-ecran-puis-navigation.test.ts). happy-dom n'a pas l'API
// Fullscreen : `fullscreenElement` est simulé sur le document et fullscreenchange déclenché à la main.

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { Window } from 'happy-dom'

const __dirname = dirname(fileURLToPath(import.meta.url))
const lire = (f: string): string => readFileSync(join(__dirname, '..', 'src', 'runtime', f), 'utf-8')
const sansEsm = (s: string): string => s.replace(/^\s*import\s+[^;]+;\s*$/gm, '').replace(/^\s*export\s+\{[^}]*\}\s*;?\s*$/gm, '')
const UJS = lire('mjs_ujs.ts')
const REMPLIR = UJS.slice(UJS.indexOf('// >>> extrait-test _mjs_zoneFill'), UJS.indexOf('// <<< extrait-test _mjs_zoneFill'))

function charger(): { window: any; document: any; µ: any; pleinEcran: (el: any) => void } {
  const window: any = new Window({ url: 'http://localhost/' })
  window.eval(`${sansEsm(lire('mjs_init.ts'))}\n${lire('mjs_page_cache.ts')}\n${lire('mjs_modal.ts')}\n${REMPLIR}\nglobalThis.µ = µ;`)
  const document = window.document
  document.body.innerHTML = '<main><p>la page</p></main>'
  let plein: any = null
  Object.defineProperty(document, 'fullscreenElement', { configurable: true, get: () => plein })
  return { window, document, µ: window.µ, pleinEcran: (el: any) => { plein = el } }
}

const messages = (document: any): string[] => Array.from(document.querySelectorAll('.mjs-toast .mjs-toast-message')).map((t: any) => t.textContent)
const lieu = (document: any): string => { const c = document.querySelector('.mjs-toasts'); return c ? (c.parentNode === document.body ? 'corps' : '#' + c.parentNode.id) : 'aucun' }

function lightbox(document: any): any {
  const el = document.createElement('div')
  el.id = 'lightbox'
  document.body.append(el)
  return el
}

describe('mjs_modal — toasts du plein écran d un élément retiré sans navigation', function () {
  it('lightbox fermée par son bouton pendant le plein écran : le toast permanent revient dans le corps', function () {
    const { window, document, µ, pleinEcran } = charger()
    const fs = lightbox(document)
    pleinEcran(fs)
    µ.modal.notify('Hors ligne : vos changements attendent', { duration: 0 })
    assert.equal(lieu(document), '#lightbox', 'le toast se pose dans l\'élément plein écran')
    fs.remove()                   // bouton « fermer » : le navigateur quitte alors le plein écran
    pleinEcran(null)
    document.dispatchEvent(new window.Event('fullscreenchange'))
    assert.deepEqual(messages(document), ['Hors ligne : vos changements attendent'], 'le toast est perdu')
    assert.equal(lieu(document), 'corps')
  })

  it('un toast demandé entre le retrait et la sortie du plein écran : un seul conteneur, les deux toasts dans le corps', function () {
    const { window, document, µ, pleinEcran } = charger()
    const fs = lightbox(document)
    pleinEcran(fs)
    µ.modal.notify('permanent', { duration: 0 })
    fs.remove()
    pleinEcran(null)
    µ.modal.notify('enregistré', { duration: 3000 })
    document.dispatchEvent(new window.Event('fullscreenchange'))
    assert.deepEqual(messages(document), ['permanent', 'enregistré'])
    assert.equal(document.querySelectorAll('.mjs-toasts').length, 1, 'un second conteneur est créé')
    assert.equal(lieu(document), 'corps')
  })

  it('les places restent comptées : cinq permanents ramenés, le sixième attend sa place', function () {
    const { window, document, µ, pleinEcran } = charger()
    const fs = lightbox(document)
    pleinEcran(fs)
    for (let i = 1; i <= 6; i++) { µ.modal.notify('permanent ' + i, { duration: 0 }) }
    fs.remove()
    pleinEcran(null)
    document.dispatchEvent(new window.Event('fullscreenchange'))
    assert.deepEqual(messages(document), ['permanent 1', 'permanent 2', 'permanent 3', 'permanent 4', 'permanent 5'])
    const croix: any = document.querySelector('.mjs-toast .mjs-toast-close')
    croix.click()
    assert.deepEqual(messages(document), ['permanent 2', 'permanent 3', 'permanent 4', 'permanent 5', 'permanent 6'])
  })
})
