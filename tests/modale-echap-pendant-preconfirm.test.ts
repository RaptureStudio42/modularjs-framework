// µ.modal.fire — Échap et clic sur le fond pendant qu'une confirmation attend sa réponse (inputValidator ou
// preConfirm asynchrone). Les boutons sont grisés pendant l'attente, Annuler compris : fermer la fenêtre par Échap
// ou par un clic à côté résolvait pourtant la promesse en « annulée » (dismiss 'esc' ou 'backdrop') alors que le
// preConfirm allait aboutir — l'écriture sur le serveur se faisait, l'appelant croyait l'inverse. Tant que la
// confirmation attend, ces deux fermetures sont ignorées (même sort que allowEscapeKey: false) ; la fenêtre se
// ferme confirmée à la réponse, ou reste ouverte quand le preConfirm refuse ou échoue, et Échap marche de nouveau.
// Les fermetures décidées par le code (µ.modal.close(), un autre fire()) restent possibles.
// Même méthode que mjs-modal-dismiss.test.ts (chargement direct de mjs_init.ts + mjs_modal.ts dans un happy-dom
// Window frais par test).

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { Window } from 'happy-dom'
import { assertAbsent } from './helpers/dom-assert.js'

const __dirname = dirname(fileURLToPath(import.meta.url))

function stripEsm(s: string): string {
  return s
    .replace(/^\s*import\s+[^;]+;\s*$/gm, '')
    .replace(/^\s*export\s+\{[^}]*\}\s*;?\s*$/gm, '')
}

const INIT_SRC       = stripEsm(readFileSync(join(__dirname, '..', 'src', 'runtime', 'mjs_init.ts'), 'utf-8'))
const PAGE_CACHE_SRC = readFileSync(join(__dirname, '..', 'src', 'runtime', 'mjs_page_cache.ts'), 'utf-8')
const MODAL_SRC      = readFileSync(join(__dirname, '..', 'src', 'runtime', 'mjs_modal.ts'), 'utf-8')

function loadModal(): { window: any; document: any; µ: any } {
  const window: any = new Window({ url: 'http://localhost/' })
  window.eval(`${INIT_SRC}\n${PAGE_CACHE_SRC}\n${MODAL_SRC}\nglobalThis.µ = µ;`)
  return { window, document: window.document, µ: window.µ }
}

const box       = (document: any): any => document.body.querySelector('.mjs-modal-box')
const backdrop  = (document: any): any => document.body.querySelector('.mjs-modal-backdrop')
const confirmer = (document: any): void => box(document).querySelector('.mjs-modal-confirm').click()
const echap     = (window: any, document: any): void => { document.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })) }
const clicFond  = (window: any, document: any): void => { backdrop(document).dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true })) }
const wait      = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

// une réponse que le test libère à la main
function attente(): { promesse: Promise<any>, fin: (v?: any) => void } {
  let fin: (v?: any) => void = () => {}
  const promesse = new Promise<any>((r) => { fin = r })
  return { promesse, fin }
}

describe('mjs_modal — Échap et clic sur le fond pendant qu\'une confirmation attend sa réponse', function () {
  it('Échap pendant un preConfirm qui attend : la fenêtre reste ouverte, puis se ferme confirmée à sa réponse', async function () {
    const { window, document, µ } = loadModal()
    const a = attente()
    let resultat: any = null
    const p = µ.modal.fire({ text: 'x', preConfirm: () => a.promesse }).then((r: any) => { resultat = r; return r })
    confirmer(document)
    await wait(10)
    echap(window, document)
    await wait(10)
    assert.equal(resultat, null, 'la promesse de la fenêtre n\'est pas résolue')
    assert.ok(box(document), 'la boîte reste affichée')
    a.fin('enregistré')
    const r = await p
    assert.equal(r.isConfirmed, true)
    assert.equal(r.isDismissed, false)
    assert.equal(r.dismiss, undefined)
    assert.equal(r.value, 'enregistré')
    assertAbsent(box(document), 'la boîte est retirée à la réponse')
  })

  it('clic sur le fond pendant un preConfirm qui attend : ignoré de même', async function () {
    const { window, document, µ } = loadModal()
    const a = attente()
    let resultat: any = null
    const p = µ.modal.fire({ text: 'x', preConfirm: () => a.promesse }).then((r: any) => { resultat = r; return r })
    confirmer(document)
    await wait(10)
    clicFond(window, document)
    await wait(10)
    assert.equal(resultat, null, 'la promesse de la fenêtre n\'est pas résolue')
    assert.ok(box(document), 'la boîte reste affichée')
    a.fin('ok')
    const r = await p
    assert.equal(r.isConfirmed, true)
    assert.equal(r.dismiss, undefined)
  })

  it('Échap pendant un inputValidator asynchrone qui attend : ignoré de même', async function () {
    const { window, document, µ } = loadModal()
    const a = attente()
    let resultat: any = null
    const p = µ.modal.fire({ input: 'text', inputValue: 'abc', inputValidator: () => a.promesse }).then((r: any) => { resultat = r; return r })
    confirmer(document)
    await wait(10)
    echap(window, document)
    await wait(10)
    assert.equal(resultat, null, 'la promesse de la fenêtre n\'est pas résolue')
    assert.ok(box(document), 'la boîte reste affichée')
    a.fin(null)
    const r = await p
    assert.equal(r.isConfirmed, true)
    assert.equal(r.value, 'abc')
  })

  it('preConfirm qui refuse (false) : la fenêtre reste ouverte et Échap la ferme de nouveau', async function () {
    const { window, document, µ } = loadModal()
    const a = attente()
    const p = µ.modal.fire({ text: 'x', preConfirm: () => a.promesse })
    confirmer(document)
    await wait(10)
    echap(window, document)
    a.fin(false)
    await wait(10)
    assert.ok(box(document), 'la boîte reste ouverte après le refus')
    assert.equal(box(document).querySelector('.mjs-modal-confirm').disabled, false, 'les boutons sont rendus')
    echap(window, document)
    const r = await p
    assert.equal(r.isDismissed, true)
    assert.equal(r.dismiss, 'esc')
  })

  it('preConfirm qui échoue : la fenêtre reste ouverte et Échap la ferme de nouveau', async function () {
    const { window, document, µ } = loadModal()
    µ.error = () => {}
    const a = attente()
    const p = µ.modal.fire({ text: 'x', preConfirm: () => a.promesse.then(() => { throw new Error('panne') }) })
    confirmer(document)
    await wait(10)
    a.fin()
    await wait(10)
    assert.ok(box(document), 'la boîte reste ouverte après l\'échec')
    echap(window, document)
    const r = await p
    assert.equal(r.dismiss, 'esc')
  })

  it('sans confirmation en cours : Échap et clic sur le fond ferment comme avant', async function () {
    const { window, document, µ } = loadModal()
    const p1 = µ.modal.fire({ text: 'x', preConfirm: () => 1 })
    echap(window, document)
    assert.equal((await p1).dismiss, 'esc')
    const p2 = µ.modal.fire({ text: 'x', preConfirm: () => 1 })
    clicFond(window, document)
    assert.equal((await p2).dismiss, 'backdrop')
  })

  it('µ.modal.close() pendant un preConfirm qui attend : la fermeture décidée par le code reste possible', async function () {
    const { document, µ } = loadModal()
    const a = attente()
    const p = µ.modal.fire({ text: 'x', preConfirm: () => a.promesse })
    confirmer(document)
    await wait(10)
    µ.modal.close()
    const r = await p
    assert.equal(r.dismiss, 'close')
    a.fin('tard')
    await wait(10)
  })
})
