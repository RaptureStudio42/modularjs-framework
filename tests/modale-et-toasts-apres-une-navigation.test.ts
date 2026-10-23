// Une navigation UJS qui remplace le corps de la page (µ._mjs_zoneFill sur <body>) emporte la modale ouverte et les toasts
// affichés sans passer par leur fermeture. La modale partie est fermée comme par µ.modal.close() : son piège du focus ne
// retient plus Tab sur la nouvelle page, Échap redevient libre, sa promesse se résout (dismiss 'close') à l'arrivée de la
// page (mjs:load) ou au premier appui de touche, et un fullscreenchange ne la ramène pas. Les toasts partis libèrent leur
// place : le suivant paraît, même après cinq permanents (plafond notifyMax par défaut), ceux qui attendaient en file passent
// d'abord, et aucun ancien toast ne revient au fullscreenchange. Même assemblage que mjs-modal-notify.test.ts, plus
// l'extrait de µ._mjs_zoneFill (mjs_ujs.ts).

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

function charger(): { window: any; document: any; µ: any } {
  const window: any = new Window({ url: 'http://localhost/' })
  window.eval(`${sansEsm(lire('mjs_init.ts'))}\n${lire('mjs_page_cache.ts')}\n${lire('mjs_modal.ts')}\n${REMPLIR}\nglobalThis.µ = µ;`)
  return { window, document: window.document, µ: window.µ }
}

// la page suivante : son corps remplace l'ancien, comme le fait UJS
function naviguer(document: any, µ: any): void {
  const main = document.createElement('main')
  main.innerHTML = '<input id="a"><input id="b">'
  µ._mjs_zoneFill(document.body, [main])
}

function touche(window: any, cible: any, key: string): any {
  const ev = new window.KeyboardEvent('keydown', { key, bubbles: true, cancelable: true })
  cible.dispatchEvent(ev)
  return ev
}

const attendre = (): Promise<void> => new Promise((r) => setTimeout(r, 0))
const messages = (document: any): string[] => Array.from(document.querySelectorAll('.mjs-toast .mjs-toast-message')).map((t: any) => t.textContent)

describe('mjs_modal — modale et toasts emportés par une navigation qui remplace le corps', function () {
  it('modale ouverte puis navigation : Tab n\'est plus retenu et la promesse se résout en fermeture', async function () {
    const { window, document, µ } = charger()
    let resultat: any = null
    µ.modal.fire({ title: 'Panier', html: '<a href="/panier">voir le panier</a>' }).then((r: any) => { resultat = r })
    naviguer(document, µ)
    const a = document.getElementById('a')
    a.focus()
    const ev = touche(window, a, 'Tab')
    await attendre()
    assert.equal(ev.defaultPrevented, false, 'Tab suit son cours sur la nouvelle page')
    assert.equal(document.activeElement && document.activeElement.id, 'a', 'le focus n\'est pas renvoyé vers la modale partie')
    assert.ok(resultat, 'la promesse est résolue')
    assert.equal(resultat.dismiss, 'close')
    assert.equal(resultat.isDismissed, true)
  })

  it('Échap sur la nouvelle page parvient à la page, la modale partie se ferme en \'close\'', async function () {
    const { window, document, µ } = charger()
    let resultat: any = null
    const recus: string[] = []
    µ.modal.fire({ title: 'Panier' }).then((r: any) => { resultat = r })
    naviguer(document, µ)
    document.addEventListener('keydown', (e: any) => { recus.push(e.key) })
    const ev = touche(window, document.getElementById('a'), 'Escape')
    await attendre()
    assert.equal(ev.defaultPrevented, false)
    assert.deepEqual(recus, ['Escape'], 'l\'écouteur de la page reçoit Échap')
    assert.equal(resultat && resultat.dismiss, 'close')
  })

  it('à l\'arrivée de la page (mjs:load), la modale partie est fermée sans attendre une touche', async function () {
    const { window, document, µ } = charger()
    let resultat: any = null
    µ.modal.fire({ title: 'Panier' }).then((r: any) => { resultat = r })
    naviguer(document, µ)
    document.dispatchEvent(new window.CustomEvent('mjs:load', { bubbles: true }))
    await attendre()
    assert.equal(resultat && resultat.dismiss, 'close')
  })

  it('un fullscreenchange après la navigation ne ramène pas la modale', async function () {
    const { window, document, µ } = charger()
    let resultat: any = null
    µ.modal.fire({ title: 'Panier' }).then((r: any) => { resultat = r })
    naviguer(document, µ)
    document.dispatchEvent(new window.Event('fullscreenchange'))
    await attendre()
    assert.equal(document.querySelectorAll('.mjs-modal-backdrop').length, 0, 'aucune modale dans la nouvelle page')
    assert.equal(resultat && resultat.dismiss, 'close')
  })

  it('µ.modal.wait() puis navigation : le piège du focus est retiré', async function () {
    const { window, document, µ } = charger()
    µ.modal.wait()
    naviguer(document, µ)
    const a = document.getElementById('a')
    a.focus()
    const ev = touche(window, a, 'Tab')
    assert.equal(ev.defaultPrevented, false)
    // la modale suivante s'ouvre normalement
    µ.modal.fire({ title: 'Suivante' })
    assert.equal(document.querySelectorAll('.mjs-modal-backdrop').length, 1)
  })

  it('cinq toasts permanents puis navigation : le suivant paraît', function () {
    const { document, µ } = charger()
    for (let i = 1; i <= 5; i++) { µ.modal.notify('permanent ' + i, { duration: 0 }) }
    naviguer(document, µ)
    µ.modal.notify('après la navigation', { duration: 3000 })
    assert.deepEqual(messages(document), ['après la navigation'])
  })

  it('toasts en file avant la navigation : ils paraissent ensuite, avant le nouveau', function () {
    const { document, µ } = charger()
    for (let i = 1; i <= 7; i++) { µ.modal.notify('toast ' + i, { duration: 0 }) }
    assert.equal(messages(document).length, 5, 'deux toasts attendent en file')
    naviguer(document, µ)
    µ.modal.notify('après la navigation', { duration: 0 })
    assert.deepEqual(messages(document), ['toast 6', 'toast 7', 'après la navigation'])
  })

  it('un fullscreenchange après la navigation ne ramène pas les anciens toasts', function () {
    const { window, document, µ } = charger()
    for (let i = 1; i <= 5; i++) { µ.modal.notify('permanent ' + i, { duration: 0 }) }
    naviguer(document, µ)
    document.dispatchEvent(new window.Event('fullscreenchange'))
    assert.deepEqual(messages(document), [], 'aucun ancien toast dans la nouvelle page')
    µ.modal.notify('suivant', { duration: 0 })
    assert.deepEqual(messages(document), ['suivant'])
  })
})
