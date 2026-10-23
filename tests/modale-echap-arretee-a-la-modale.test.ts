// Échap qui ferme la modale (µ.modal.fire, mjs_modal.ts) s'arrête à elle : l'écouteur de la modale, posé en capture sur le
// document, coupe la propagation de l'événement. Un tiroir ou un menu ouvert sous la modale, qui écoute Échap lui aussi, ne se
// ferme donc pas avec elle. Échap que la modale ignore (allowEscapeKey: false, confirmation en attente) continue sa route.

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

describe('mjs_modal — Échap qui ferme la modale ne va pas plus loin', function () {
  it('Échap ferme la modale et ne parvient pas aux écouteurs de la page', async function () {
    const { window, document, µ } = charger()
    let resultat: any = null
    const recus: string[] = []
    document.addEventListener('keydown', (e: any) => { recus.push('document:' + e.key) })
    document.body.addEventListener('keydown', (e: any) => { recus.push('corps:' + e.key) })
    µ.modal.fire({ title: 'Supprimer ?' }).then((r: any) => { resultat = r })
    document.body.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }))
    await attendre()
    assert.equal(resultat && resultat.dismiss, 'esc')
    assert.deepEqual(recus, [], 'le tiroir ou le menu en dessous ne voit pas Échap')
  })

  it('Échap ignoré par la modale (allowEscapeKey: false) continue sa route', async function () {
    const { window, document, µ } = charger()
    const recus: string[] = []
    document.addEventListener('keydown', (e: any) => { recus.push(e.key) })
    µ.modal.fire({ title: 'Patientez', allowEscapeKey: false })
    document.body.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }))
    await attendre()
    assert.equal(document.querySelectorAll('.mjs-modal-backdrop').length, 1, 'la modale reste ouverte')
    assert.deepEqual(recus, ['Escape'])
  })
})
