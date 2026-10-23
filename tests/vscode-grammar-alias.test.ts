// extension VS Code — coloration d'un alias d'effet `*effet.nom` et de ses réglages, tokenisée par le VRAI moteur de VS Code
// (vscode-textmate + vscode-oniguruma) : le point et le nom de l'alias ont la couleur du nom de l'effet, les réglages entre
// parenthèses ont celle des réglages d'un effet — sur une balise, après `@in=` / `@out=` / `@transition=`, et dans un
// fichier `*.effects.mjs` (la déclaration et l'effet qu'elle règle).

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

/** les scopes du jeton `txt` de la ligne `n` */
function scopes(lignes: Jeton[][], n: number, txt: string): string[] {
  const trouve = lignes[n].find(j => j.txt === txt)
  assert.ok(trouve, `ligne ${n} : aucun jeton « ${txt} » — ${JSON.stringify(lignes[n].map(j => j.txt))}`)
  return trouve.scopes
}

/** le texte porté par le scope `nom` sur la ligne `n`, jetons collés */
function peint(lignes: Jeton[][], n: number, nom: string): string {
  return lignes[n].filter(j => j.scopes.includes(nom)).map(j => j.txt).join('')
}

describe('extension VS Code — alias d\'effet *effet.nom(réglages)', () => {
  it('sur une balise : *filter.frosted_glass porte la couleur du nom d\'un effet, ses réglages celle des réglages', () => {
    const l = tokenise('<img src="a.png" *filter.frosted_glass(blur: 20, soft: $s)>')
    assert.ok(scopes(l, 0, '*').includes('punctuation.definition.effect.modularjs'))
    assert.equal(peint(l, 0, 'entity.name.function.effect.modularjs'), 'filter.frosted_glass', 'le nom de l\'effet et celui de l\'alias, d\'un seul tenant')
    assert.ok(scopes(l, 0, '(').includes('punctuation.definition.arguments.begin.modularjs'))
    assert.ok(scopes(l, 0, 'blur').includes('variable.parameter.effect.modularjs'))
    assert.ok(scopes(l, 0, '20').includes('constant.numeric.modularjs'))
    assert.ok(scopes(l, 0, ')').includes('punctuation.definition.arguments.end.modularjs'))
    assert.ok(!l[0].some(j => j.scopes.some(s => s.startsWith('invalid'))), 'aucun rouge')
  })

  it('sans réglages : le nom pointé est encore le nom d\'un effet', () => {
    const l = tokenise('<img *filter.net>')
    assert.equal(peint(l, 0, 'entity.name.function.effect.modularjs'), 'filter.net')
    assert.ok(scopes(l, 0, 'filter.net').includes('meta.effect.modularjs'))
  })

  it('l\'écriture refusée (*filter.net=…) reste en rouge, alias compris', () => {
    const l = tokenise('<img *filter.net=3>')
    assert.ok(l[0].some(j => j.scopes.includes('invalid.illegal.effect.modularjs') && j.txt.includes('filter.net')), JSON.stringify(l[0]))
  })

  it('après @in= / @out= / @transition= : l\'alias et ses réglages sont peints comme un effet', () => {
    const l = tokenise('<div @in=*fade.lent(duration: 3s) @out=*fade.lent @transition.global=*fade.lent(up)>x</div>')
    assert.equal(peint(l, 0, 'entity.name.function.effect.modularjs'), 'fade.lentfade.lentfade.lent', 'trois fois le nom pointé')
    assert.ok(scopes(l, 0, 'duration').includes('variable.parameter.effect.modularjs'))
    assert.ok(scopes(l, 0, '3s').includes('constant.numeric.modularjs'))
    assert.ok(!l[0].some(j => j.scopes.some(s => s.startsWith('invalid'))), 'aucun rouge')
  })

  it('dans un fichier d\'effets : la déclaration d\'un alias et l\'effet qu\'elle règle', () => {
    const l = tokenise('<effects>\n  *filter.net = *filter(sepia, amount: 0.5)\n  *tilt.bounce_back = *tilt(follow: 250ms)\n</effects>')
    assert.equal(peint(l, 1, 'entity.name.function.effect.modularjs'), 'filter.netfilter', 'le nom pointé déclaré, puis l\'effet réglé')
    assert.ok(scopes(l, 1, 'filter.net').includes('meta.effect.definition.modularjs'))
    assert.ok(scopes(l, 1, 'amount').includes('variable.parameter.effect.modularjs'))
    assert.equal(peint(l, 2, 'entity.name.function.effect.modularjs'), 'tilt.bounce_back' + 'tilt')
  })

  it('un effet sans alias ne change pas : le point d\'une phrase qui suit reste du texte', () => {
    const l = tokenise('<p *neon>x</p>\n<p *neon(#f0f).</p>')
    assert.equal(peint(l, 0, 'entity.name.function.effect.modularjs'), 'neon')
    assert.equal(peint(l, 1, 'entity.name.function.effect.modularjs'), 'neon')
  })
})
