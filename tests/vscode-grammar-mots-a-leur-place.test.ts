// extension VS Code — les mots du langage des blocs du gabarit (`{for … in … by …}`, `{if}`, `{elsif}`, `{else}`, `{end}`, `{await}`,
// `{success}`, `{error}`, `{key}`, `{const}`, `{snippet}`) ne sont colorés qu'à leur place : le mot qui ouvre le bloc, `in` et `by`
// dans l'en-tête d'un `{for}`. Un nom ordinaire qui s'écrit pareil reste une expression : `{key}`, `{g.key}`, `$key`, la clé `by key`
// d'un `{for}` (une variable), `{elsif $r.error}`, l'opérateur `in` dans une condition ou une interpolation.
// Tokenisée par le VRAI moteur de VS Code, comme vscode-grammar-balise-coeur.test.ts.

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

const MOT = 'keyword.control.modularjs'

// les jetons de la ligne `n` dont le texte, espaces ôtés, vaut `txt` sont tous colorés comme un mot du langage
const colore = (l: Jeton[][], n: number, txt: string): boolean => {
  const j = l[n].filter((x) => x.txt.trim() === txt)
  assert.ok(j.length > 0, `ligne ${n} : aucun jeton « ${txt} » — ${JSON.stringify(l[n].map((x) => x.txt))}`)
  return j.every((x) => x.scopes.includes(MOT))
}

// aucun jeton de la ligne `n` qui vaut `txt` n'est coloré comme un mot du langage
const jamais = (l: Jeton[][], n: number, txt: string): boolean => !l[n].some((x) => x.txt.trim() === txt && x.scopes.includes(MOT))

describe('extension VS Code — mots des blocs du gabarit colorés à leur place seulement', () => {
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

  it('{for g in $groups by key} : for, in et by colorés ; key, la variable de la clé, non', () => {
    const l = tokenise('{for g in $groups by key}\n  <p>{g.nom}</p>\n{end}')
    assert.ok(colore(l, 0, 'for') && colore(l, 0, 'in') && colore(l, 0, 'by'), JSON.stringify(l[0]))
    assert.ok(jamais(l, 0, 'key'), JSON.stringify(l[0]))
    assert.ok(colore(l, 2, 'end'))
  })

  it('{key}, {g.key}, {$key} : un nom ordinaire, jamais coloré ; {key $x} ouvre son bloc', () => {
    const l = tokenise('<p>{key}</p>\n<p>{g.key}</p>\n<p>{$key}</p>\n{key $x}\n  <p>a</p>\n{end}')
    assert.ok(jamais(l, 0, 'key'), JSON.stringify(l[0]))
    assert.ok(jamais(l, 1, 'key'), JSON.stringify(l[1]))
    assert.ok(jamais(l, 2, 'key'), JSON.stringify(l[2]))
    assert.ok(colore(l, 3, 'key'), JSON.stringify(l[3]))
  })

  it('{if}, {elsif}, {else}, {end} : le mot d\'ouverture coloré ; in et error dans la condition, non', () => {
    const l = tokenise('{if $a in $liste}\n  <p>a</p>\n{elsif $r.error}\n  <p>b</p>\n{else}\n  <p>c</p>\n{end}')
    assert.ok(colore(l, 0, 'if') && colore(l, 2, 'elsif') && colore(l, 4, 'else') && colore(l, 6, 'end'))
    assert.ok(jamais(l, 0, 'in'), JSON.stringify(l[0]))
    assert.ok(jamais(l, 2, 'error'), JSON.stringify(l[2]))
  })

  it('{await}, {await.keep} (le mot await), {success v}, {success}, {error e}, {error} : colorés', () => {
    const l = tokenise('{await $p}\n{success v}\n{error e}\n{end}\n{await.keep $q}\n{success}\n{error}\n{end}')
    assert.ok(colore(l, 0, 'await') && colore(l, 1, 'success') && colore(l, 2, 'error') && colore(l, 3, 'end'))
    assert.ok(colore(l, 4, 'await') && colore(l, 5, 'success') && colore(l, 6, 'error') && colore(l, 7, 'end'))
  })

  it('{const n = $a.length}, {snippet ligne(x)} : colorés ; un in hors de l\'en-tête d\'un {for}, non', () => {
    const l = tokenise('{const n = $a.length}\n{snippet ligne(x)}\n  <p>{x}</p>\n{end}\n<p>{n in $l}</p>')
    assert.ok(colore(l, 0, 'const') && colore(l, 1, 'snippet') && colore(l, 3, 'end'))
    assert.ok(jamais(l, 4, 'in'), JSON.stringify(l[4]))
  })
})
