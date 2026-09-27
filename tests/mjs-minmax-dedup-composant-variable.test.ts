// Régression — `µ.minmax` (bornes inversées `min > max`) dédoublonnait son
// avertissement par COUPLE (min,max) pour TOUTE LA PAGE : deux composants
// (ou deux variables) DIFFÉRENTS qui commettent la MÊME faute de bornes ne
// voyaient que le PREMIER averti — le second, pourtant une faute distincte,
// restait silencieux.
//
// Fix : dédoublonnage par COMPOSANT ET PAR VARIABLE (WeakMap instance → Set
// des clés déjà averties) — une répétition sur la MÊME variable du MÊME
// composant reste muette (bruit), mais deux fautes distinctes avertissent
// chacune la leur.

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Window } from 'happy-dom'

const __dirname = dirname(fileURLToPath(import.meta.url))

function loadRareRunes(win: any) {
  const initSrc = readFileSync(join(__dirname, '../src/runtime/mjs_init.ts'), 'utf-8')
    .replace(/export\s*\{[^}]*\}/, '')
  const rareRunesSrc = readFileSync(join(__dirname, '../src/runtime/mjs_rare_runes.ts'), 'utf-8')
  const sandbox = `
    ${initSrc}
    ${rareRunesSrc}
    return µ;
  `
  // eslint-disable-next-line @typescript-eslint/no-implied-eval
  const µ: any = new Function('window', 'document', 'customElements', 'HTMLElement', 'CSSStyleSheet', sandbox)(
    win, win.document, win.customElements, win.HTMLElement, win.CSSStyleSheet,
  )
  const warnCalls: string[] = []
  µ.warn = (...a: any[]) => { warnCalls.push(String(a[0])) }
  return { µ, warnCalls }
}

// Composant minimal : `_state` (lu par µ.minmax pour le clamp) + `_set`
// (écriture clampée, appelée par µ._set — cf. mjs_init.ts).
function fakeComponent(x: number) {
  const state: any = { x }
  return { _state: state, _set: (k: string, v: any) => { state[k] = v } }
}

describe('µ.minmax — dédup des bornes inversées PAR COMPOSANT ET PAR VARIABLE', function () {
  it('2 composants DIFFÉRENTS, même variable et mêmes bornes fautives → 2 avertissements (AVANT le fix : le 2e était avalé, dédup globale par couple)', () => {
    const win: any = new Window({ url: 'http://localhost/' })
    const { µ, warnCalls } = loadRareRunes(win)
    const compA = fakeComponent(5)
    const compB = fakeComponent(5)

    µ.minmax(compA, 'x', 100, 0)
    µ.minmax(compB, 'x', 100, 0)

    assert.equal(warnCalls.length, 2, `attendu 2 avertissements (un par composant), reçu : ${JSON.stringify(warnCalls)}`)
  })

  it('même composant, même variable, appelé 2 fois avec les mêmes bornes → 1 seul avertissement (dédup toujours active PAR PAIRE)', () => {
    const win: any = new Window({ url: 'http://localhost/' })
    const { µ, warnCalls } = loadRareRunes(win)
    const comp = fakeComponent(5)

    µ.minmax(comp, 'x', 100, 0)
    µ.minmax(comp, 'x', 100, 0)

    assert.equal(warnCalls.length, 1, `une répétition sur la même paire (composant, variable) ne doit pas spammer, reçu : ${JSON.stringify(warnCalls)}`)
  })

  it('bornes normales (min < max) : jamais d\'avertissement', () => {
    const win: any = new Window({ url: 'http://localhost/' })
    const { µ, warnCalls } = loadRareRunes(win)
    const comp = fakeComponent(5)

    µ.minmax(comp, 'x', 0, 100)

    assert.equal(warnCalls.length, 0)
  })
})
