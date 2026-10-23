// extension VS Code — une balise de la bibliothèque cœur `<@@select>` (deux @) se colore comme
// une balise de composant `<@panier>` : nom de balise, attributs, liaisons, fermante `</@@select>`.
// Tokenisée par le VRAI moteur de VS Code, comme vscode-grammar-routes-parity.test.ts.

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const require   = createRequire(import.meta.url)
const vsctm     = require('vscode-textmate')
const oniguruma = require('vscode-oniguruma')

const __dirname = dirname(fileURLToPath(import.meta.url))
const GRAMMAIRE = join(__dirname, '..', 'editors', 'vscode', 'syntaxes', 'modularjs.tmLanguage.json')
const ONIG_WASM = require.resolve('vscode-oniguruma/release/onig.wasm')

type Jeton = { txt: string, scopes: string[] }
let tokenise: (src: string) => Jeton[][]

before(async () => {
  await oniguruma.loadWASM(readFileSync(ONIG_WASM).buffer)
  const registry = new vsctm.Registry({
    onigLib: Promise.resolve({
      createOnigScanner: (s: string[]) => new oniguruma.OnigScanner(s),
      createOnigString:  (s: string)   => new oniguruma.OnigString(s),
    }),
    loadGrammar: async (scope: string) => scope === 'text.html.modularjs'
      ? vsctm.parseRawGrammar(readFileSync(GRAMMAIRE, 'utf-8'), 'modularjs.tmLanguage.json')
      : null,
  })
  const grammar = await registry.loadGrammar('text.html.modularjs')
  tokenise = (src) => {
    let state = vsctm.INITIAL
    return src.split('\n').map((ligne) => {
      const r = grammar.tokenizeLine(ligne, state)
      state = r.ruleStack
      return r.tokens.map((t: { startIndex: number, endIndex: number, scopes: string[] }) =>
        ({ txt: ligne.slice(t.startIndex, t.endIndex), scopes: t.scopes }))
    })
  }
})

const scopes = (lignes: Jeton[][], n: number, txt: string): string[] => {
  const j = lignes[n].find(x => x.txt === txt)
  assert.ok(j, `ligne ${n} : aucun jeton « ${txt} » — ${JSON.stringify(lignes[n].map(x => x.txt))}`)
  return j!.scopes
}

describe('extension VS Code — balise <@@nom> de la bibliothèque cœur', () => {
  it('<@@select …> et </@@select> : nom de balise, attributs', () => {
    const l = tokenise('<@@select name="pays" value=!{$pays}>\n  <@@option value="fr">France</@@option>\n</@@select>')
    assert.ok(scopes(l, 0, '@@select').includes('entity.name.tag.html'))
    assert.ok(scopes(l, 0, '@@select').includes('meta.tag.custom.modularjs'))
    assert.ok(scopes(l, 1, '@@option').includes('entity.name.tag.html'))
    assert.ok(scopes(l, 2, '@@select').includes('entity.name.tag.html'))
    assert.ok(scopes(l, 0, 'name').includes('entity.other.attribute-name.html'))
    assert.ok(scopes(l, 0, 'value').includes('entity.other.attribute-name.html'))
  })

  it('même couleur de balise qu’un composant du projet <@panier>', () => {
    const coeur  = tokenise('<@@select></@@select>')[0].find(x => x.txt === '@@select')!.scopes
    const projet = tokenise('<@panier></@panier>')[0].find(x => x.txt === '@panier')!.scopes
    assert.deepEqual(coeur, projet)
  })
})
