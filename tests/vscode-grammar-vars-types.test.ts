// extension VS Code — coloration des blocs <vars> (types et valeurs permises d'un composant) et
// <types> (règles nommées d'un fichier *.types.mjs), tokenisés par le VRAI moteur de VS Code
// (vscode-textmate + vscode-oniguruma), comme vscode-grammar-routes-parity.test.ts.
//
// Le contrat : chaque morceau d'une règle a sa couleur (type, plage, valeur, interdit, forme,
// champ facultatif, règle nommée), le `$x` d'une ligne a la couleur qu'il a dans le <script>, un
// `#` dans une valeur n'ouvre pas de commentaire, le bloc se referme sur sa balise, et le seul
// rouge est ce que le compilateur refuse aussi : un attribut sur la balise.

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { transpile } from '../src/transpiler/index.js'

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

const COMPOSANT = [
  '<vars>',                                                         // 0
  '  # le son',                                                     // 1
  '  $volume    int 0..100',                                        // 2
  "  $color     'red' | 'green' | \"blue\"",                        // 3
  "  $nickname  string 3..20 /^[a-z/#]+$/i ! 'admin' | 'root'  # fin", // 4
  '  $level     int 0..100 ! 40..60',                               // 5
  '  $settings  {',                                                 // 6
  '    volume: Percent,',                                           // 7
  '    bass?:  int -10..10',                                        // 8
  '  }',                                                            // 9
  '  $tags      Nick[] ..50',                                       // 10
  "  $sep       '#' | null | bool",                                 // 11
  '  $$cart     { quantity: int 1..99 }',                           // 12
  '</vars>',                                                        // 13
  '<script>',                                                       // 14
  '$volume = 50',                                                   // 15
  '</script>',                                                      // 16
].join('\n')

const FICHIER_TYPES = [
  '<types>',                                                        // 0
  '  Percent    int 0..100',                                        // 1
  '  Settings   {',                                                 // 2
  '    volume : Percent,',                                          // 3
  '    bass?: int',                                                 // 4
  '  }',                                                            // 5
  "  Nick       string 3..20 ! 'admin'   # pseudo",                 // 6
  '</types>',                                                       // 7
].join('\n')

/** les scopes du jeton `txt` de la ligne `n` (le `rang`-ième s'il revient) */
function scopes(lignes: Jeton[][], n: number, txt: string, rang = 0): string[] {
  const trouves = lignes[n].filter(j => j.txt === txt)
  assert.ok(trouves[rang], `ligne ${n} : aucun jeton « ${txt} » — ${JSON.stringify(lignes[n].map(j => j.txt))}`)
  return trouves[rang].scopes
}

/** le texte de la ligne `n` couvert par le scope `scope` */
function couvert(lignes: Jeton[][], n: number, scope: string): string {
  return lignes[n].filter(j => j.scopes.includes(scope)).map(j => j.txt).join('')
}

describe('extension VS Code — blocs <vars> et <types>', () => {
  it('les balises et le corps du bloc <vars>', () => {
    const l = tokenise(COMPOSANT)
    assert.ok(scopes(l, 0, 'vars').includes('entity.name.tag.vars.html'))
    assert.ok(scopes(l, 13, 'vars').includes('entity.name.tag.vars.html'))
    for (let n = 1; n <= 12; n++) {
      for (const j of l[n]) assert.ok(j.scopes.includes('meta.vars.modularjs'), `ligne ${n}, « ${j.txt} » hors du bloc`)
    }
  })

  it('la variable a la couleur qu’elle a dans le <script>, le store aussi', () => {
    const l = tokenise(COMPOSANT)
    assert.ok(scopes(l, 2, '$').includes('keyword.control.directive.reactive.modularjs'))
    assert.ok(scopes(l, 2, 'volume').includes('variable.other.readwrite.reactive.modularjs'))
    assert.ok(scopes(l, 12, '$$').includes('keyword.control.directive.store.modularjs'))
    assert.ok(scopes(l, 12, 'cart').includes('variable.other.readwrite.store.modularjs'))
  })

  it('types, plages, valeurs, interdits', () => {
    const l = tokenise(COMPOSANT)
    assert.ok(scopes(l, 2, 'int').includes('support.type.primitive.modularjs'))
    assert.ok(scopes(l, 2, '0').includes('constant.numeric.modularjs'))
    assert.ok(scopes(l, 2, '..').includes('keyword.operator.range.modularjs'))
    assert.ok(scopes(l, 2, '100').includes('constant.numeric.modularjs'))
    assert.equal(couvert(l, 3, 'string.quoted.single.modularjs'), "'red''green'")
    assert.equal(couvert(l, 3, 'string.quoted.double.modularjs'), '"blue"')
    assert.ok(scopes(l, 3, '|').includes('keyword.operator.union.modularjs'))
    assert.ok(scopes(l, 5, '!').includes('keyword.operator.negation.modularjs'))
    assert.ok(scopes(l, 8, '-10').includes('constant.numeric.modularjs'))
    assert.ok(scopes(l, 10, '..').includes('keyword.operator.range.modularjs'))
    assert.ok(scopes(l, 11, 'null').includes('constant.language.modularjs'))
    assert.ok(scopes(l, 11, 'bool').includes('support.type.primitive.modularjs'))
  })

  it('une forme /…/ se lit d’un bloc, `/` et `#` de sa classe compris', () => {
    const l = tokenise(COMPOSANT)
    assert.equal(couvert(l, 4, 'string.regexp.modularjs'), '/^[a-z/#]+$/i')
    assert.equal(couvert(l, 4, 'comment.line.number-sign.vars.modularjs'), '# fin')
  })

  it('commentaires : en tête de ligne ou en fin de règle, jamais dans une valeur', () => {
    const l = tokenise(COMPOSANT)
    assert.equal(couvert(l, 1, 'comment.line.number-sign.vars.modularjs'), '# le son')
    assert.equal(couvert(l, 11, 'comment.line.number-sign.vars.modularjs'), '')
    assert.ok(scopes(l, 11, "'#'").includes('string.quoted.single.modularjs'))
  })

  it('objet : champs, champ facultatif `?`, règle nommée, liste', () => {
    const l = tokenise(COMPOSANT)
    assert.ok(scopes(l, 6, '{').includes('punctuation.definition.block.begin.modularjs'))
    assert.ok(scopes(l, 7, 'volume').includes('variable.other.property.modularjs'))
    assert.ok(scopes(l, 7, ':').includes('punctuation.separator.key-value.modularjs'))
    assert.ok(scopes(l, 7, 'Percent').includes('entity.name.type.modularjs'))
    assert.ok(scopes(l, 8, 'bass').includes('variable.other.property.modularjs'))
    assert.ok(scopes(l, 8, '?').includes('keyword.operator.optional.modularjs'))
    assert.ok(scopes(l, 9, '}').includes('punctuation.definition.block.end.modularjs'))
    assert.ok(scopes(l, 10, 'Nick').includes('entity.name.type.modularjs'))
    assert.ok(scopes(l, 10, '[]').includes('meta.brace.square.modularjs'))
    assert.ok(scopes(l, 12, 'quantity').includes('variable.other.property.modularjs'))
  })

  it('aucun rouge dans un bloc valide, et le <script> qui suit reste un script', () => {
    const l = tokenise(COMPOSANT)
    const rouges = l.flat().filter(j => j.scopes.some(s => s.startsWith('invalid.')))
    assert.deepEqual(rouges.map(j => j.txt), [])
    const apres = scopes(l, 15, 'volume')
    assert.ok(!apres.includes('meta.vars.modularjs'), 'le bloc <vars> doit être refermé')
    assert.ok(apres.includes('meta.embedded.block.coffee'), JSON.stringify(apres))
  })

  it('le bloc tient sur une ligne', () => {
    const l = tokenise('<vars>$x int 0..9</vars>')
    assert.ok(scopes(l, 0, 'x').includes('variable.other.readwrite.reactive.modularjs'))
    assert.ok(scopes(l, 0, 'int').includes('support.type.primitive.modularjs'))
    assert.equal(l[0].filter(j => j.txt === 'vars').length, 2)
  })

  it('un attribut sur la balise rougit, et le compilateur le refuse aussi', async () => {
    const src = '<vars lang="x">\n$x int\n</vars>\n<p>{$x}</p>'
    const l = tokenise(src)
    assert.equal(couvert(l, 0, 'invalid.illegal.attribute.vars.modularjs').trim(), 'lang="x"')
    await assert.rejects(transpile(src, { moduleName: 'grammaire-vars-attribut' }), /ne prend aucun attribut/)
  })

  it('<types> : le nom défini, la règle nommée citée, un champ écrit `volume :`', () => {
    const l = tokenise(FICHIER_TYPES)
    assert.ok(scopes(l, 0, 'types').includes('entity.name.tag.types.html'))
    assert.ok(scopes(l, 7, 'types').includes('entity.name.tag.types.html'))
    assert.ok(scopes(l, 1, 'Percent').includes('entity.name.type.alias.modularjs'))
    assert.ok(scopes(l, 2, 'Settings').includes('entity.name.type.alias.modularjs'))
    assert.ok(scopes(l, 3, 'volume').includes('variable.other.property.modularjs'))
    assert.ok(!scopes(l, 3, 'volume').includes('entity.name.type.alias.modularjs'))
    const cite = scopes(l, 3, 'Percent')
    assert.ok(cite.includes('entity.name.type.modularjs') && !cite.includes('entity.name.type.alias.modularjs'))
    assert.ok(scopes(l, 4, 'bass').includes('variable.other.property.modularjs'))
    assert.ok(scopes(l, 6, "'admin'").includes('string.quoted.single.modularjs'))
    assert.equal(couvert(l, 6, 'comment.line.number-sign.types.modularjs'), '# pseudo')
    for (let n = 1; n <= 6; n++) {
      for (const j of l[n]) assert.ok(j.scopes.includes('meta.types.modularjs'), `ligne ${n}, « ${j.txt} » hors du bloc`)
    }
    assert.deepEqual(l.flat().filter(j => j.scopes.some(s => s.startsWith('invalid.'))).map(j => j.txt), [])
  })
})
