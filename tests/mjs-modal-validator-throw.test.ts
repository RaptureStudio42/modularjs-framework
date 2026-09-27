// Régression — µ.modal.fire(options) (mjs_modal.ts) : inputValidator/preConfirm qui LÈVENT
// SYNCHRONEMENT (throw, pas une Promise rejetée). `Promise.resolve(validator(value))` évaluait
// l'appel AVANT de créer la promesse : un throw en sortait directement, hors de tout `.then()`,
// jamais rattrapé par le second argument (le gestionnaire de rejet) qui suit. Boutons désactivés
// à vie, aucun bandeau, µ.error jamais appelé, promesse de fire() jamais résolue. Même méthode que
// mjs-modal-input.test.ts (cf. son en-tête) : celui-ci couvre le rejet ASYNCHRONE
// (Promise.reject), pas le throw SYNCHRONE — angle mort distinct, fichier séparé.

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { Window } from 'happy-dom'

const __dirname = dirname(fileURLToPath(import.meta.url))

function stripEsm(s: string): string {
  return s
    .replace(/^\s*import\s+[^;]+;\s*$/gm, '')
    .replace(/^\s*export\s+\{[^}]*\}\s*;?\s*$/gm, '')
}

const INIT_SRC = stripEsm(readFileSync(join(__dirname, '..', 'src', 'runtime', 'mjs_init.ts'), 'utf-8'))
const PAGE_CACHE_SRC = readFileSync(join(__dirname, '..', 'src', 'runtime', 'mjs_page_cache.ts'), 'utf-8')
const MODAL_SRC = readFileSync(join(__dirname, '..', 'src', 'runtime', 'mjs_modal.ts'), 'utf-8')

function loadModal(): { window: any; document: any; µ: any } {
  const window: any = new Window({ url: 'http://localhost/' })
  window.eval(`${INIT_SRC}\n${PAGE_CACHE_SRC}\n${MODAL_SRC}\nglobalThis.µ = µ;`)
  return { window, document: window.document, µ: window.µ }
}

function box(document: any): any {
  return document.body.querySelector('.mjs-modal-box')
}
function confirmBtn(document: any): any {
  return box(document).querySelector('.mjs-modal-confirm')
}
function wait(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}

describe('mjs_modal — inputValidator/preConfirm qui LÈVENT SYNCHRONEMENT (throw, pas un rejet)', function () {
  it('inputValidator qui THROW : reste ouverte, boutons ré-activés, bandeau affiché, µ.error tracé, jamais résolue', async function () {
    const { document, µ } = loadModal()
    let settled = false
    const errCalls: any[] = []
    µ.error = (...a: any[]) => errCalls.push(a)
    const p = µ.modal.fire({ input: 'text', inputValue: 'x', inputValidator: () => { throw new Error('boom synchrone') } })
    p.then(() => { settled = true })
    confirmBtn(document).click()
    await wait(20)
    assert.equal(settled, false, 'ne doit PAS se fermer — la saisie utilisateur ne doit pas se perdre')
    assert.equal(confirmBtn(document).disabled, false, "ré-activé après l'échec (pas bloqué à vie)")
    assert.equal(errCalls.length, 1, 'µ.error doit être tracé, comme pour un rejet de promesse')
    const msgEl = box(document).querySelector('.mjs-modal-validation-message')
    assert.equal(msgEl.hidden, false)
    assert.equal(msgEl.textContent, 'boom synchrone')
  })

  it('preConfirm qui THROW : reste ouverte, boutons ré-activés, bandeau affiché, µ.error tracé, jamais résolue', async function () {
    const { document, µ } = loadModal()
    let settled = false
    const errCalls: any[] = []
    µ.error = (...a: any[]) => errCalls.push(a)
    const p = µ.modal.fire({ input: 'text', inputValue: 'x', preConfirm: () => { throw new Error('boom synchrone dans preConfirm') } })
    p.then(() => { settled = true })
    confirmBtn(document).click()
    await wait(20)
    assert.equal(settled, false)
    assert.equal(confirmBtn(document).disabled, false, "ré-activé après l'échec")
    assert.equal(errCalls.length, 1)
    const msgEl = box(document).querySelector('.mjs-modal-validation-message')
    assert.equal(msgEl.hidden, false)
    assert.equal(msgEl.textContent, 'boom synchrone dans preConfirm')
  })

  it('inputValidator qui THROW bloque AVANT que preConfirm soit appelé', async function () {
    const { document, µ } = loadModal()
    const preCalls: any[] = []
    let settled = false
    const p = µ.modal.fire({
      input: 'text', inputValue: 'x',
      inputValidator: () => { throw new Error('validator explose') },
      preConfirm: (v: any) => { preCalls.push(v); return v },
    })
    p.then(() => { settled = true })
    confirmBtn(document).click()
    await wait(20)
    assert.deepEqual(preCalls, [], "preConfirm ne doit pas avoir tourné : le validator a explosé avant")
    assert.equal(settled, false)
  })

  it('après un throw : corriger la saisie puis recliquer confirm ferme normalement', async function () {
    const { document, µ } = loadModal()
    let jette = true
    const p = µ.modal.fire({
      input: 'text', inputValue: '',
      inputValidator: () => { if (jette) { throw new Error('premier essai en échec') } return null },
    })
    confirmBtn(document).click()
    await wait(20)
    assert.ok(box(document), 'reste ouverte après le throw')
    jette = false
    box(document).querySelector('.mjs-modal-input').value = 'ok'
    confirmBtn(document).click()
    const r = await p
    assert.equal(r.isConfirmed, true)
    assert.equal(r.value, 'ok')
  })
})
