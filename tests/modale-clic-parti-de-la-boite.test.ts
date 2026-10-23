// Clic sur le fond de la modale (µ.modal.fire, mjs_modal.ts) : il ne ferme que s'il est parti du fond. Sélectionner le texte
// d'un champ à la souris et relâcher à côté de la boîte envoie le clic au fond (ancêtre commun de l'appui et du lâcher) : la
// modale se fermait en 'backdrop' et la saisie était perdue. L'appui (pointerdown) parti de la boîte n'arme plus la fermeture ;
// un clic sans appui préalable (click() du code, clavier) ferme comme avant. Le geste réel est rejoué dans Chromium par
// modale-rideaux-fantome-et-flip-browser.test.ts.

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { Window } from 'happy-dom'

const __dirname = dirname(fileURLToPath(import.meta.url))
const lire = (f: string): string => readFileSync(join(__dirname, '..', 'src', 'runtime', f), 'utf-8')
const sansEsm = (s: string): string => s.replace(/^\s*import\s+[^;]+;\s*$/gm, '').replace(/^\s*export\s+\{[^}]*\}\s*;?\s*$/gm, '')

function charger(): { window: any; document: any; µ: any } {
  const window: any = new Window({ url: 'http://localhost/' })
  window.eval(`${sansEsm(lire('mjs_init.ts'))}\n${lire('mjs_page_cache.ts')}\n${lire('mjs_modal.ts')}\nglobalThis.µ = µ;`)
  return { window, document: window.document, µ: window.µ }
}

const attendre = (): Promise<void> => new Promise((r) => setTimeout(r, 0))
const appui = (window: any, cible: any): boolean => cible.dispatchEvent(new window.Event('pointerdown', { bubbles: true }))
const clic = (window: any, cible: any): boolean => cible.dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true }))

describe('mjs_modal — le clic sur le fond ne ferme que s\'il est parti du fond', function () {
  it('appui dans le champ, lâcher sur le fond : la modale reste ouverte', async function () {
    const { window, document, µ } = charger()
    let resultat: any = null
    µ.modal.fire({ title: 'Votre nom', input: 'text', inputValue: 'Jean-Baptiste Dupont' }).then((r: any) => { resultat = r })
    const fond = document.querySelector('.mjs-modal-backdrop')
    appui(window, document.querySelector('.mjs-modal-input'))
    clic(window, fond)
    await attendre()
    assert.equal(resultat, null, 'la modale n\'est pas fermée')
    assert.equal(document.querySelectorAll('.mjs-modal-backdrop').length, 1)
    // le geste suivant, parti du fond, ferme
    appui(window, fond)
    clic(window, fond)
    await attendre()
    assert.equal(resultat && resultat.dismiss, 'backdrop')
  })

  it('appui et lâcher sur le fond : fermée en \'backdrop\'', async function () {
    const { window, document, µ } = charger()
    let resultat: any = null
    µ.modal.fire({ title: 'x' }).then((r: any) => { resultat = r })
    const fond = document.querySelector('.mjs-modal-backdrop')
    appui(window, fond)
    clic(window, fond)
    await attendre()
    assert.equal(resultat && resultat.dismiss, 'backdrop')
  })

  it('clic sur le fond sans appui préalable : fermé comme avant', async function () {
    const { window, document, µ } = charger()
    let resultat: any = null
    µ.modal.fire({ title: 'x' }).then((r: any) => { resultat = r })
    clic(window, document.querySelector('.mjs-modal-backdrop'))
    await attendre()
    assert.equal(resultat && resultat.dismiss, 'backdrop')
  })
})
