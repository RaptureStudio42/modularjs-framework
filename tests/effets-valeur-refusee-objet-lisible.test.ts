// le message de développement d'une valeur écartée par sa règle (`*nom : clé = valeur refusé…`) montre la valeur reçue. Une
// valeur objet (un effet donné en objet par une variable, `{ fx, s }`, ou tout autre objet) s'y lit en forme courte, jamais
// `[object Object]` : le nom de l'effet quand l'objet en porte un, sinon des points de suite. Texte et liste restent écrits
// comme avant.

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Window } from 'happy-dom'
import { parseEffect } from '../src/effects/catalog.js'

const ICI    = dirname(fileURLToPath(import.meta.url))
const MOTEUR = readFileSync(join(ICI, '../src/runtime/mjs_fx.ts'), 'utf-8')

function moteur() {
  const window: any = new Window({ url: 'http://localhost/' })
  const messages: string[] = []
  const µ: any = {
    _typesMode: 'warn',
    warn: (m: string) => { messages.push(String(m)) },
    error: () => {},
    _mjs_msg: (cle: string, vars: Record<string, string> | null, texte: string) => cle + ' ' + texte.replace(/\{(\w+)\}/g, (_m, n) => String(vars?.[n] ?? ''))
  }
  window.eval(`globalThis.__charge = function(µ) {\n${MOTEUR}\n}`)
  window.__charge(µ)
  return { window, µ, messages }
}

const REGLE = parseEffect('delta', 'fx: $v').spec.fx

// le message écrit pour la valeur v de la variable `fx` de *delta (un seul attendu)
function message(v: unknown): string {
  const { window, µ, messages } = moteur()
  const el = window.document.body.appendChild(window.document.createElement('span'))
  µ._mjs_fxSettings(el, 'delta', {}, { fx: v }, { fx: REGLE })
  assert.equal(messages.length, 1, messages.join('\n'))
  return messages[0]
}

describe('effets — une valeur objet écartée se lit dans le message de développement', () => {
  it('un effet inconnu donné en objet : son nom, en forme courte, jamais [object Object]', () => {
    const m = message({ fx: 'magnet', s: { strength: 3 } })
    assert.match(m, /^fxRefused /)
    assert.doesNotMatch(m, /\[object Object\]/)
    assert.ok(m.includes("fx = { fx: 'magnet', … } refusé"), m)
  })

  it('un objet sans nom d\'effet : des points de suite', () => {
    const m = message({ taille: 3 })
    assert.doesNotMatch(m, /\[object Object\]/)
    assert.ok(m.includes('fx = { … } refusé'), m)
  })

  it('un texte reste entre apostrophes, comme avant', () => {
    assert.ok(message('inconnu').includes("fx = 'inconnu' refusé"))
  })
})
