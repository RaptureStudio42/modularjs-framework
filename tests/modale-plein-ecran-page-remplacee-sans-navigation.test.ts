// Une modale ouverte, puis la page remplacée sans la navigation de MJS (aucun mjs:load : routeur tiers, corps réécrit
// par l'appli). Au fullscreenchange suivant, la modale partie avec l'ancienne page était rattachée à la nouvelle : son
// fond, ses boutons et son piège du focus sur une page qui ne l'avait jamais ouverte. Seule une modale sans parent était
// reconnue comme partie ; celle qui restait dans l'ancien <body>, ou dans l'élément plein écran emporté avec la page,
// revenait. Elle se ferme désormais, comme une modale partie avec sa page ; une modale restée dans un élément plein écran
// que l'appli retire à la sortie le suit toujours dans le corps. happy-dom n'a pas l'API Fullscreen :
// `fullscreenElement` est simulé et `fullscreenchange` déclenché à la main, comme le ferait le navigateur.

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
  window.document.body.innerHTML = '<div id="plein"><p>plein</p></div><p>page</p>'
  return { window, document: window.document, µ: window.µ }
}

function pleinEcran(document: any, el: any): void {
  Object.defineProperty(document, 'fullscreenElement', { configurable: true, get: () => el })
}

const changement = (window: any): void => { window.document.dispatchEvent(new window.Event('fullscreenchange', { bubbles: true, composed: true })) }
const attendre   = (): Promise<void> => new Promise((r) => setTimeout(r, 0))
const fonds      = (document: any): number => document.querySelectorAll('.mjs-modal-backdrop').length

describe('µ.modal — page remplacée sans navigation MJS, puis changement de plein écran', function () {
  it('l\'élément <body> remplacé, puis un plein écran sur la nouvelle page : l\'ancienne modale ne revient pas', async () => {
    const { window, document, µ } = charger()
    let resultat: any = null
    µ.modal.fire({ title: 'Panier' }).then((r: any) => { resultat = r })
    const corps = document.createElement('body')
    corps.innerHTML = '<div id="video">nouvelle page</div>'
    document.documentElement.replaceChild(corps, document.body)
    pleinEcran(document, document.getElementById('video'))
    changement(window)
    await attendre()
    assert.equal(fonds(document), 0, 'aucune modale dans la nouvelle page')
    assert.equal(resultat && resultat.dismiss, 'close', 'la modale partie est fermée')
  })

  it('ouverte en plein écran, le contenu de la page remplacé, puis la sortie du plein écran : elle ne revient pas', async () => {
    const { window, document, µ } = charger()
    let resultat: any = null
    pleinEcran(document, document.getElementById('plein'))
    µ.modal.fire({ title: 'Panier' }).then((r: any) => { resultat = r })
    assert.equal(document.querySelector('#plein .mjs-modal-backdrop') !== null, true, 'posée dans l\'élément plein écran')
    document.body.innerHTML = '<main>nouvelle page</main>'
    pleinEcran(document, null)
    changement(window)
    await attendre()
    assert.equal(fonds(document), 0, 'aucune modale dans la nouvelle page')
    assert.equal(resultat && resultat.dismiss, 'close')
  })

  it('ouverte en plein écran, l\'appli retire l\'élément à la sortie : la modale le quitte pour le corps, toujours ouverte', async () => {
    const { window, document, µ } = charger()
    let resultat: any = null
    pleinEcran(document, document.getElementById('plein'))
    µ.modal.fire({ title: 'Question' }).then((r: any) => { resultat = r })
    pleinEcran(document, null)
    document.getElementById('plein').remove()
    changement(window)
    await attendre()
    assert.equal(document.querySelector('body > .mjs-modal-backdrop') !== null, true, 'la modale est dans le corps')
    assert.equal(resultat, null, 'toujours ouverte')
    assert.equal(document.body.innerHTML.includes('<!--'), false, 'aucun repère laissé dans le corps')
    µ.modal.close()
  })

  it('entrée puis sortie du plein écran, puis fermeture : aucun repère ne reste dans la page', async () => {
    const { window, document, µ } = charger()
    µ.modal.fire({ title: 'Question' })
    pleinEcran(document, document.getElementById('plein'))
    changement(window)
    assert.equal(document.querySelector('#plein .mjs-modal-backdrop') !== null, true, 'la modale suit dans l\'élément')
    µ.modal.close()
    await attendre()
    assert.equal(document.body.innerHTML.includes('<!--'), false)
  })
})
