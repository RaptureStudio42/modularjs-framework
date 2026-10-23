// extension VS Code — coloration des effets `*nom` et `*nom(réglages)` sur une balise, tokenisés par
// le VRAI moteur de VS Code (vscode-textmate + vscode-oniguruma), comme vscode-grammar-vars-types.
//
// Le contrat : l'étoile et le nom de l'effet ont leur couleur, chaque réglage aussi (nom, couleur,
// nombre ou durée, texte, booléen) ; des parenthèses dans une valeur (`rgb(…)`) ne referment pas
// l'effet ; la balise continue normalement après lui ; une étoile dans le texte n'est pas un effet ;
// le seul rouge est ce que le compilateur refuse aussi (`*neon=…`, une valeur calculée `{…}`).

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

const GABARIT = [
  '<h1 class="t" *neon>Soirée</h1>',                                    // 0
  '<h1 *neon(#f0f, flicker: true)>x</h1>',                              // 1
  '<div *tilt(15, glare: true) @click={go()}>x</div>',                  // 2
  "<p *scale('0.5', delay: 200ms) *neon(rgb(0, 255, 255))>x</p>",    // 3
  '<@card *tilt(10)>x</@card>',                                          // 4
  '<p>5 *neon en texte</p>',                                             // 5
  '<p *neon="#f0f">x</p>',                                               // 6
  '<p *neon(color: {$c})>x</p>',                                         // 7
  '<p *neon($c, size: $$taille)>x</p>',                                  // 8
  "<h2 *gradient([#f0f, #0ff], direction: 90) *cycle([Coder., 'Web, mobile'])>x</h2>", // 9
  '<@document *ripple(size: 80)></@document>',                                          // 10
  '<p @in=*fly(up, distance: 40px) @out.global=*fade @transition=*iris>x</p>', // 11
  '<p @in.fly={ y: 200 }>x</p>',                                          // 12
  '<td *delta(fx: *scramble(20), up: #0f0) class="c">x</td>',            // 13
].join('\n')

/** les scopes du jeton `txt` de la ligne `n` (le `rang`-ième s'il revient) */
function scopes(lignes: Jeton[][], n: number, txt: string, rang = 0): string[] {
  const trouves = lignes[n].filter(j => j.txt === txt)
  assert.ok(trouves[rang], `ligne ${n} : aucun jeton « ${txt} » — ${JSON.stringify(lignes[n].map(j => j.txt))}`)
  return trouves[rang].scopes
}

describe('extension VS Code — le bloc court d\'un modèle, {? nom}', () => {
  it('le « ? » est un mot du langage, comme if ; les noms, des modèles', () => {
    const l = tokenise("{? timer}\n<b>x</b>\n{? chrono, minuteur}\n{end}")
    assert.ok(scopes(l, 0, '?').includes('keyword.control.modularjs'), JSON.stringify(l[0]))
    assert.ok(scopes(l, 0, 'timer').includes('entity.name.type.layout.modularjs'), JSON.stringify(l[0]))
    assert.ok(scopes(l, 2, 'minuteur').includes('entity.name.type.layout.modularjs'), JSON.stringify(l[2]))
  })
})

describe('extension VS Code — effets *nom(réglages)', () => {
  it('l\'étoile et le nom de l\'effet, avec ou sans réglages', () => {
    const l = tokenise(GABARIT)
    for (const n of [0, 1]) {
      assert.ok(scopes(l, n, '*').includes('punctuation.definition.effect.modularjs'), `ligne ${n}`)
      assert.ok(scopes(l, n, 'neon').includes('entity.name.function.effect.modularjs'), `ligne ${n}`)
    }
    assert.ok(scopes(l, 4, 'tilt').includes('entity.name.function.effect.modularjs'), 'sur un composant aussi')
  })

  it('les réglages : nom, couleur, booléen, nombre, durée, texte', () => {
    const l = tokenise(GABARIT)
    assert.ok(scopes(l, 1, '(').includes('punctuation.definition.arguments.begin.modularjs'))
    assert.ok(scopes(l, 1, '#f0f').includes('constant.other.color.modularjs'))
    assert.ok(scopes(l, 1, 'flicker').includes('variable.parameter.effect.modularjs'))
    assert.ok(scopes(l, 1, ':').includes('punctuation.separator.key-value.modularjs'))
    assert.ok(scopes(l, 1, 'true').includes('constant.language.boolean.modularjs'))
    assert.ok(scopes(l, 1, ')').includes('punctuation.definition.arguments.end.modularjs'))
    assert.ok(scopes(l, 2, '15').includes('constant.numeric.modularjs'))
    assert.ok(scopes(l, 3, '200ms').includes('constant.numeric.modularjs'))
    assert.ok(scopes(l, 3, "'0.5'").includes('string.quoted.single.modularjs'))
  })

  it('des parenthèses dans une valeur ne referment pas l\'effet, la balise continue après lui', () => {
    const l = tokenise(GABARIT)
    const fermantes = l[3].filter(j => j.txt === ')' || j.txt === '))')
    assert.ok(fermantes.length > 0)
    assert.ok(scopes(l, 3, '255').includes('meta.effect.modularjs'), 'rgb(…) reste dans l\'effet')
    assert.ok(scopes(l, 2, 'click').some(s => s.startsWith('entity.other.attribute-name')), 'le @click qui suit garde sa couleur')
    const x = l[3].filter(j => j.txt === 'x')
    assert.ok(x.length === 1 && !x[0].scopes.includes('meta.effect.modularjs'), 'le texte de la balise est hors de l\'effet')
  })

  it('une variable entre les parenthèses a la couleur qu\'elle a dans le <script>', () => {
    const l = tokenise(GABARIT)
    assert.ok(scopes(l, 8, '$').includes('keyword.control.directive.reactive.modularjs'))
    assert.ok(scopes(l, 8, 'c').includes('variable.other.readwrite.reactive.modularjs'))
    assert.ok(scopes(l, 8, '$$').includes('keyword.control.directive.store.modularjs'))
    assert.ok(scopes(l, 8, 'taille').includes('variable.other.readwrite.store.modularjs'))
    assert.ok(!l[8].some(j => j.scopes.some(s => s.startsWith('invalid'))), 'aucun rouge')
  })

  it('une liste entre crochets : chaque couleur a sa couleur, la liste ne referme pas l\'effet ; <@document> porte ses effets', () => {
    const l = tokenise(GABARIT)
    assert.ok(scopes(l, 9, '#f0f').includes('constant.other.color.modularjs'))
    assert.ok(scopes(l, 9, '#0ff').includes('constant.other.color.modularjs'))
    assert.ok(scopes(l, 9, '[', 0).includes('punctuation.definition.list.begin.modularjs'))
    assert.ok(scopes(l, 9, 'direction').includes('variable.parameter.effect.modularjs'), 'le réglage après la liste')
    assert.ok(scopes(l, 9, 'cycle').includes('entity.name.function.effect.modularjs'), 'le second effet')
    assert.ok(scopes(l, 9, "'Web, mobile'").includes('string.quoted.single.modularjs'))
    assert.ok(!l[9].some(j => j.scopes.some(s => s.startsWith('invalid'))), 'aucun rouge')
    assert.ok(scopes(l, 10, 'ripple').includes('entity.name.function.effect.modularjs'), 'sur <@document>')
  })

  it('une transition : @in=*fly(…), @out.global=*fade — la directive, puis l\'effet et ses réglages ; @in.fly en rouge', () => {
    const l = tokenise(GABARIT)
    assert.ok(scopes(l, 11, 'in').includes('entity.other.attribute-name.modularjs'))
    assert.ok(scopes(l, 11, 'fly').includes('entity.name.function.effect.modularjs'))
    assert.ok(scopes(l, 11, 'distance').includes('variable.parameter.effect.modularjs'))
    assert.ok(scopes(l, 11, '40px').includes('constant.numeric.modularjs'))
    assert.ok(scopes(l, 11, 'fade').includes('entity.name.function.effect.modularjs'), '@out.global=*fade, sans parenthèses')
    assert.ok(scopes(l, 11, 'iris').includes('entity.name.function.effect.modularjs'))
    assert.ok(!l[11].some(j => j.scopes.some(s => s.startsWith('invalid'))), 'aucun rouge')
    assert.ok(l[12].some(j => j.scopes.includes('invalid.illegal.transition.modularjs')), '@in.fly refusé')
  })

  it('un effet en valeur d\'un réglage (`fx: *scramble(20)`) : coloré comme un effet, ses parenthèses ne referment pas l\'autre', () => {
    const l = tokenise(GABARIT)
    assert.ok(scopes(l, 13, 'delta').includes('entity.name.function.effect.modularjs'))
    assert.ok(scopes(l, 13, 'scramble').includes('entity.name.function.effect.modularjs'), 'l\'effet donné en valeur')
    assert.ok(scopes(l, 13, '20').includes('constant.numeric.modularjs'))
    assert.ok(scopes(l, 13, 'up').includes('variable.parameter.effect.modularjs'), 'le réglage qui suit, toujours dans *delta')
    assert.ok(scopes(l, 13, '#0f0').includes('constant.other.color.modularjs'))
    assert.ok(scopes(l, 13, 'class').some(s => s.startsWith('entity.other.attribute-name')), 'l\'attribut qui suit')
    assert.ok(!l[13].some(j => j.scopes.some(s => s.startsWith('invalid'))), 'aucun rouge')
  })

  it('{await … *skeleton} : l\'effet du bloc d\'attente a sa couleur ; ailleurs dans une expression, une étoile reste une multiplication', () => {
    const l = tokenise('{await $profil *skeleton(radius: 8)}\n{await $liste *skeleton}\n<p>{$prix *quantite}</p>')
    assert.ok(scopes(l, 0, 'await').includes('keyword.control.modularjs'), JSON.stringify(l[0]))
    assert.ok(scopes(l, 0, 'skeleton').includes('entity.name.function.effect.modularjs'), JSON.stringify(l[0]))
    assert.ok(scopes(l, 0, 'radius').includes('variable.parameter.effect.modularjs'), JSON.stringify(l[0]))
    assert.ok(scopes(l, 1, 'skeleton').includes('entity.name.function.effect.modularjs'), JSON.stringify(l[1]))
    assert.ok(!l[2].some((j) => j.scopes.includes('entity.name.function.effect.modularjs')), JSON.stringify(l[2]))
  })

  it('une étoile dans le texte n\'est pas un effet', () => {
    const l = tokenise(GABARIT)
    for (const j of l[5]) assert.ok(!j.scopes.some(s => s.includes('effect')), `« ${j.txt} »`)
  })

  it('le rouge : *neon=… et une valeur calculée, refusés par le compilateur', () => {
    const l = tokenise(GABARIT)
    assert.ok(l[6].some(j => j.scopes.includes('invalid.illegal.effect.modularjs')), '*neon=…')
    assert.ok(l[7].some(j => j.scopes.includes('invalid.illegal.effect-value.modularjs') && j.txt.includes('$c')), '{$c}')
    for (const n of [0, 1, 2, 3, 4]) assert.ok(!l[n].some(j => j.scopes.some(s => s.startsWith('invalid'))), `ligne ${n} sans rouge`)
  })
})

describe('extension VS Code — le bloc <effects> d\'un fichier *.effects.mjs', () => {
  const BLOC = [
    '<effects>',
    '  *titre = *scramble(311, on: click)',
    '  *halo(color: #0ff, size: 12px) =',
    '    box-shadow: 0 0 $size $color',
    '    @keyframes',
    '      50%',
    '        transform: scale(1.1)',
    '</effects>',
  ].join('\n')

  it('le nom de l\'effet défini, le =, l\'effet qu\'il règle ; ses réglages ; ses lignes CSS, $réglage, @keyframes et ses étapes', () => {
    const l = tokenise(BLOC)
    assert.ok(scopes(l, 1, 'titre').includes('entity.name.function.effect.modularjs'))
    assert.ok(scopes(l, 1, '=').includes('keyword.operator.assignment.modularjs'))
    assert.ok(scopes(l, 1, 'scramble').includes('entity.name.function.effect.modularjs'))
    assert.ok(scopes(l, 2, 'color').includes('variable.parameter.effect.modularjs'))
    assert.ok(scopes(l, 2, '#0ff').includes('constant.other.color.modularjs'))
    assert.ok(scopes(l, 3, 'box-shadow').includes('support.type.property-name.css'))
    assert.ok(scopes(l, 3, 'size').includes('variable.parameter.effect.modularjs'), '$size')
    assert.ok(scopes(l, 4, '@keyframes').includes('keyword.control.at-rule.keyframes.css'))
    assert.ok(scopes(l, 5, '50%').includes('entity.other.keyframe-offset.css'))
    for (const n of [1, 2, 3, 4, 5, 6]) assert.ok(!l[n].some(j => j.scopes.some(s => s.startsWith('invalid'))), `ligne ${n} sans rouge`)
  })
})
