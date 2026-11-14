// extension VS Code — la grammaire connaît chaque mot de MJS de la table du compilateur (src/parser/mjs-words.ts) : les mots d'une balise,
// ses propriétés booléennes et les mots d'un bloc `<style>` (`:css`, `:display`, `:viewTransition`, `:vt`). Un mot que la grammaire ne
// connaît pas est peint en rouge comme un mot inconnu (`invalid.illegal.attribute.unknown-word.modularjs`) alors que le build l'accepte.
// Tokenisée par le VRAI moteur de VS Code, comme vscode-grammar-balise-coeur.test.ts.

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { MJS_WORDS, MJS_BOOLEAN_PROPS, STYLE_WORDS } from '../src/parser/mjs-words.js'

const require   = createRequire(import.meta.url)
const vsctm     = require('vscode-textmate')
const oniguruma = require('vscode-oniguruma')

const __dirname = dirname(fileURLToPath(import.meta.url))
const GRAMMAIRE = join(__dirname, '..', 'editors', 'vscode', 'syntaxes', 'modularjs.tmLanguage.json')
const ONIG_WASM = require.resolve('vscode-oniguruma/release/onig.wasm')

type Jeton = { txt: string, scopes: string[] }
let tokenise: (src: string) => Jeton[]

// les jetons d'une ligne peints en rouge par la grammaire
const rouges = (ligne: string) => tokenise(ligne).filter((j) => j.scopes.some((s) => s.startsWith('invalid.illegal'))).map((j) => j.txt)

describe('extension VS Code — chaque mot de MJS du compilateur est connu de la grammaire', () => {
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
    tokenise = (ligne) => grammar.tokenizeLine(ligne, vsctm.INITIAL).tokens.map((t: { startIndex: number, endIndex: number, scopes: string[] }) =>
      ({ txt: ligne.slice(t.startIndex, t.endIndex), scopes: t.scopes }))
  })

  it('la liste des mots connus de la grammaire est celle de la table du compilateur, ni plus ni moins', () => {
    const regle  = JSON.parse(readFileSync(GRAMMAIRE, 'utf-8')).repository['unknown-word-attribute'].match as string
    const connus = new Set(regle.match(/\(\?:([^)]*)\)/)![1].split('|'))
    const table  = new Set([...Object.keys(MJS_WORDS), ...MJS_BOOLEAN_PROPS, ...STYLE_WORDS])
    assert.deepEqual({ absents: [...table].filter((w) => !connus.has(w)).sort(), enTrop: [...connus].filter((w) => !table.has(w)).sort() }, { absents: [], enTrop: [] })
  })

  it('les mots d\'un bloc `<style>` ne sont pas peints en rouge ; l\'ancienne écriture `@css` et un mot inconnu le sont', () => {
    assert.deepEqual(rouges('<style :css="a.css">'), [])
    assert.deepEqual(rouges('<style :display="contents">'), [])
    assert.deepEqual(rouges('<style :vt.cube>'), [])
    assert.deepEqual(rouges('<style @css="a.css">'), ['@css'])
    assert.deepEqual(rouges('<style :csss="a.css">'), [':csss'])
  })
})
