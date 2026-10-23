// un réglage texte borné en longueur (`string 4..4`, l'axe de *weight ; `string 0..8`, le préfixe de *count) suit sa règle aussi tenu par une
// variable : le compilateur envoie les bornes au moteur avec la règle, et le moteur écarte un texte trop court ou trop long (valeur par défaut,
// message de développement), comme la compilation refuse la même valeur écrite. La longueur se compte en caractères (un émoji compte pour un).

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

const regle = (nom: string, reglage: string) => parseEffect(nom, reglage + ': $v').spec[reglage]
const norme = (µ: any, v: unknown, sp: unknown[]) => [...µ._mjs_fxNorm(v, sp)]

describe('effets — un texte tenu par une variable respecte ses bornes de longueur', () => {
  it('la règle envoyée au moteur porte les bornes, et garde son texte en dernier', () => {
    assert.deepEqual(regle('weight', 'axis'), ['s', 4, 4, 'string 4..4'])
    assert.deepEqual(regle('count', 'prefix'), ['p', 0, 8, 'string 0..8'])
  })

  it('*weight(axis: $v) : « abcdefgh » et « ab » écartés, « wght » passe', () => {
    const { µ } = moteur()
    const sp = regle('weight', 'axis')
    assert.deepEqual(norme(µ, 'abcdefgh', sp), [undefined, -1])
    assert.deepEqual(norme(µ, 'ab', sp), [undefined, -1])
    assert.deepEqual(norme(µ, 'wght', sp), ['wght', 0])
  })

  it('*count(prefix: $v) : 50 caractères écartés, 8 passent ; un émoji compte pour un', () => {
    const { µ } = moteur()
    const sp = regle('count', 'prefix')
    assert.deepEqual(norme(µ, 'x'.repeat(50), sp), [undefined, -1])
    assert.deepEqual(norme(µ, 'x'.repeat(8), sp), ['x'.repeat(8), 0])
    assert.deepEqual(norme(µ, '🎉'.repeat(8), sp), ['🎉'.repeat(8), 0])
    assert.deepEqual(norme(µ, '🎉'.repeat(9), sp), [undefined, -1])
  })

  it('par le chemin d\'une variable : la valeur par défaut, et le message de développement', () => {
    const { window, µ, messages } = moteur()
    const el = window.document.body.appendChild(window.document.createElement('span'))
    const s  = µ._mjs_fxSettings(el, 'weight', {}, { axis: 'abcdefgh' }, { axis: regle('weight', 'axis') })
    assert.equal(s.axis, undefined)
    assert.equal(messages.length, 1, messages.join('\n'))
    assert.match(messages[0], /fxRefused .*axis = 'abcdefgh' refusé.*permis : string 4\.\.4/)
  })

  it('une valeur CSS, sans bornes, garde sa règle courte et passe à toute longueur', () => {
    const { µ } = moteur()
    const sp = regle('filter', 'shadow')
    assert.equal(sp.length, 2)
    const ombres = Array(30).fill('0 0 4px red').join(', ')
    assert.deepEqual(norme(µ, ombres, sp), [ombres, 0])
  })
})
