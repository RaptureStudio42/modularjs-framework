// extension VS Code — les trois écritures d'une balise ont chacune leur couleur, tokenisées par le VRAI moteur de VS Code (vscode-textmate
// + vscode-oniguruma) : `:mot` un mot de MJS, `*nom` ou `*nom(réglages)` un effet, `@nom` un événement ; un ancien mot écrit `@mot`
// (`@size`, `@lightDom`, `@open`) est en rouge, comme un `:inconnu` ; la liste des mots de la grammaire suit la table du compilateur
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

import { MJS_WORDS, MJS_BOOLEAN_PROPS, STYLE_WORDS } from '../src/parser/mjs-words.js'

type Jeton = { txt: string, scopes: string[] }
let tokenise: (src: string) => Jeton[][]

const GABARIT = [
  '<mjs-c :size="320x48" :lightDom :flip @reorder={ go() } *flash *flip(direction: up)>x</mjs-c>',    // 0
  '<p @size="320x48" @lightDom @open={ $o }>x</p>',                                                    // 1
  '<p :inconnu=3 *neon=2>x</p>',                                                                                // 2
  '<p :class{$on}="vif" :style.color={$c}>x</p>',                                                      // 3
  '<p @input={ go() } @introstart={ go() } @dom={ go() }>x</p>',                                       // 4
].join('\n')

/** les scopes du jeton `txt` de la ligne `n` (le `rang`-ième s'il revient) */
function scopes(lignes: Jeton[][], n: number, txt: string, rang = 0): string[] {
  const trouves = lignes[n].filter(j => j.txt === txt)
  assert.ok(trouves[rang], `ligne ${n} : aucun jeton « ${txt} » — ${JSON.stringify(lignes[n].map(j => j.txt))}`)
  return trouves[rang].scopes
}

const MOT    = 'entity.other.attribute-name.directive.modularjs'
const EFFET  = 'entity.name.function.effect.modularjs'
// un événement : `.event` écrit `@nom="…"`, la portée de tout attribut écrit `@nom={…}` — jamais celle d'un mot ni d'un effet
const EVENT  = ['entity.other.attribute-name.event.modularjs', 'entity.other.attribute-name.modularjs']
const estEvenement = (sc: string[]): boolean => sc.some((x) => EVENT.includes(x)) && !sc.includes(MOT) && !sc.includes(EFFET) && !sc.some((x) => x.startsWith('invalid'))
const ANCIEN = 'invalid.illegal.attribute.old-word.modularjs'

describe('vscode-grammar-mots-deux-points', () => {
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
    assert.ok(grammar, 'grammaire text.html.modularjs introuvable')
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

  it(':mot, *effet et @événement ont trois portées distinctes, sur la même balise', () => {
    const l = tokenise(GABARIT)
    for (const mot of ['size', 'lightDom']) assert.ok(scopes(l, 0, mot).includes(MOT), `${mot} : portée du mot de MJS`)
    assert.ok(scopes(l, 0, 'flip', 0).includes(MOT), ':flip : le mot')
    assert.ok(scopes(l, 0, 'flip', 1).includes(EFFET), '*flip(direction: up) : l\'effet')
    assert.ok(scopes(l, 0, 'flash').includes(EFFET), '*flash : l\'effet')
    assert.ok(estEvenement(scopes(l, 0, 'reorder')), '@reorder : l\'événement')
    for (const mot of ['class', 'style']) assert.ok(scopes(l, 3, mot).includes(MOT), `:${mot}… : portée du mot de MJS`)
  })

  it('un ancien mot écrit @mot est en rouge, un événement nommé comme un mot ne l\'est pas', () => {
    const l = tokenise(GABARIT)
    for (const ancien of ['@size', '@lightDom', '@open']) assert.ok(scopes(l, 1, ancien).includes(ANCIEN), `${ancien} en rouge`)
    for (const evenement of ['input', 'introstart', 'dom']) assert.ok(estEvenement(scopes(l, 4, evenement)), `@${evenement} : un événement`)
    for (const rouge of ['inconnu', '*neon=']) assert.ok(l[2].some((j) => j.txt.includes(rouge) && j.scopes.some((s) => s.startsWith('invalid'))), `${rouge} en rouge`)
  })

  it('la grammaire connaît les mots de la table du compilateur, et leurs anciens noms', () => {
    const g      = JSON.parse(readFileSync(GRAMMAIRE, 'utf-8'))
    const liste  = (re: string, avant: string) => re.slice(re.indexOf(avant) + avant.length).split(')')[0].split('|').sort()
    const mots   = liste(g.repository['directive-attribute'].patterns[2].match, '(:)(')
    // les mots d'une balise et ceux d'un bloc `<style>` (`:css`, `:display`, `:vt`), de la même table
    assert.deepEqual(mots, [...new Set([...Object.keys(MJS_WORDS), ...STYLE_WORDS])].sort())
    const anciens = liste(g.repository['old-word-attribute'].match, '(@)(?:')
    const attendus = [...new Set(Object.values(MJS_WORDS).map((m) => m.inner).concat(['no-ujs', 'noujs'], STYLE_WORDS))].sort()
    assert.deepEqual(anciens, attendus)
    assert.equal(MJS_BOOLEAN_PROPS.length, 26)
  })
})
