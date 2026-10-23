// Toasts affichés pendant le plein écran d'un élément (lecteur vidéo, présentation), puis navigation qui remplace le corps de
// la page : le conteneur des toasts partait avec l'élément plein écran, détaché mais toujours son enfant. Ses places n'étaient
// pas rendues (le toast suivant n'apparaissait pas) et, à la sortie du plein écran (fullscreenchange), les anciens toasts
// revenaient sur la nouvelle page. Un conteneur sorti de la page rend désormais ses places et n'est jamais ramené. Une sortie
// du plein écran ordinaire, elle, ramène toujours le conteneur dans le corps avec ses toasts, même quand l'appli retire
// l'élément plein écran dans son propre écouteur de fullscreenchange. happy-dom n'a pas l'API Fullscreen :
// `fullscreenElement` est simulé sur le document et fullscreenchange déclenché à la main, comme le ferait le navigateur.

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
  let plein: any = null
  Object.defineProperty(document, 'fullscreenElement', { configurable: true, get: () => plein })
  return { window, document, µ: window.µ, pleinEcran: (el: any) => { plein = el } }
}

// la page suivante : son corps remplace l'ancien, comme le fait UJS
function naviguer(document: any, µ: any): void {
  const main = document.createElement('main')
  main.innerHTML = '<p>page suivante</p>'
  µ._mjs_zoneFill(document.body, [main])
}

const messages = (document: any): string[] => Array.from(document.querySelectorAll('.mjs-toast .mjs-toast-message')).map((t: any) => t.textContent)
const lieu = (document: any): string => { const c = document.querySelector('.mjs-toasts'); return c ? (c.parentNode === document.body ? 'corps' : '#' + c.parentNode.id) : 'aucun' }

describe('mjs_modal — toasts du plein écran emportés par une navigation', function () {
  it('cinq permanents dans l\'élément plein écran, navigation, sortie du plein écran : le suivant paraît, les anciens ne reviennent pas', function () {
    const { window, document, µ, pleinEcran } = charger()
    const lecteur = document.createElement('div')
    lecteur.id = 'lecteur'
    document.body.append(lecteur)
    pleinEcran(lecteur)
    for (let i = 1; i <= 5; i++) { µ.modal.notify('permanent ' + i, { duration: 0 }) }
    assert.equal(lieu(document), '#lecteur', 'les toasts se posent dans l\'élément plein écran')
    naviguer(document, µ)
    pleinEcran(null)
    µ.modal.notify('après la navigation', { duration: 3000 })
    assert.deepEqual(messages(document), ['après la navigation'], 'le toast suivant paraît')
    document.dispatchEvent(new window.Event('fullscreenchange'))
    assert.deepEqual(messages(document), ['après la navigation'], 'aucun ancien toast ne revient')
  })

  it('navigation puis sortie du plein écran, sans nouveau toast : les anciens ne reviennent pas, la file repart', function () {
    const { window, document, µ, pleinEcran } = charger()
    const lecteur = document.createElement('div')
    lecteur.id = 'lecteur'
    document.body.append(lecteur)
    pleinEcran(lecteur)
    for (let i = 1; i <= 7; i++) { µ.modal.notify('toast ' + i, { duration: 0 }) }
    naviguer(document, µ)
    pleinEcran(null)
    document.dispatchEvent(new window.Event('fullscreenchange'))
    assert.deepEqual(messages(document), ['toast 6', 'toast 7'], 'ceux qui attendaient en file paraissent, sur la nouvelle page')
    assert.equal(lieu(document), 'corps')
  })

  it('sortie du plein écran où l\'appli retire son élément dans son propre écouteur : les toasts reviennent dans le corps', function () {
    const { window, document, µ, pleinEcran } = charger()
    const lecteur = document.createElement('div')
    lecteur.id = 'lecteur'
    document.body.append(lecteur)
    // écouteur de l'appli posé AVANT le premier toast : il passe d'ordinaire le premier
    document.addEventListener('fullscreenchange', () => { if (!document.fullscreenElement && lecteur.parentNode) { lecteur.remove() } })
    µ.modal.notify('enregistré', { duration: 0 })
    pleinEcran(lecteur)
    lecteur.dispatchEvent(new window.Event('fullscreenchange', { bubbles: true }))
    assert.equal(lieu(document), '#lecteur')
    µ.modal.notify('pendant le plein écran', { duration: 0 })
    pleinEcran(null)
    lecteur.dispatchEvent(new window.Event('fullscreenchange', { bubbles: true }))
    assert.equal(lecteur.isConnected, false, 'l\'appli a retiré son élément')
    assert.equal(lieu(document), 'corps')
    assert.deepEqual(messages(document), ['enregistré', 'pendant le plein écran'])
  })
})
