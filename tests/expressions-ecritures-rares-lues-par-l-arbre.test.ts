// les écritures rares du gabarit que l'arbre ne lisait pas (commentaire, fonction abrégée de Civet, `@$x`,
// `$$$x`, `$prénom`, nom après un point, signe de MJS dans une chaîne, `=:`, `:=`, `&$x`, `isnt` laissé en nom, écriture
// de contexte, `µlayout` écrit, store d'un singleton importé) : lues par l'arbre, même sortie ou même message, au caractère près

import { strict as assert } from 'node:assert'
import { cleanJsExpr } from '../src/generator/utils.js'
import { readFileSync as lireFige } from 'node:fs'
import { expressionCounters } from '../src/reader/expression.js'

type LectureDesExpressions = 'ancienne' | 'arbre'
// sorties et messages de l'ancienne lecture des expressions, relevés avant son retrait
// (dans l'ordre des lectures du test : une même écriture se lit autrement dans une branche de {await})
const ANCIENNE = (JSON.parse(lireFige(new URL('./fixtures/expressions-ancienne-lecture.json', import.meta.url), 'utf-8')) as Record<string, { expr: string, externes: string[] }[]>)['expressions-ecritures-rares-lues-par-l-arbre']
let rang = 0

function lire(expr: string, lecture: LectureDesExpressions, externes: string[]): { texte: string, relues: number } {
  if (lecture === 'ancienne') {
    const fige = ANCIENNE[rang++]
    if (!fige || fige.expr !== expr || JSON.stringify(fige.externes) !== JSON.stringify(externes)) throw new Error(`sortie de l'ancienne lecture non relevée : ${expr}`)
    return { ...fige, arbre: 0, relues: 0, raison: '' } as any
  }
  const relues = expressionCounters.reread
  try {
    return { texte: cleanJsExpr(expr, externes, 'essai'), relues: expressionCounters.reread - relues }
  }
  catch (e) {
    return { texte: `ERREUR ${(e as Error).message}`, relues: expressionCounters.reread - relues }
  }
}

const CAS: [string, string[]][] = [
  ['$a /* note */ + 1', []],
  ['$a # note', []],
  ['$liste.filter(&.prix > $min)', []],
  ['$liste.map &.n * $k', []],
  ['$liste.filter .fait', []],
  ['$liste.some(&.id is @@courant)', []],
  ['@@liste.filter(&.ok)', []],
  ['((µ) -> µ.a)(1)', []],
  ['@$x', []],
  ['$$$x + 1', []],
  ['$prénom + 1', []],
  ['[1..µmax]', []],
  ['\'§ 2\' + $x', []],
  ['\'$x $$y §z §§w @@v &id µr\'', []],
  ['"#{$x} §y"', []],
  ['`${§x} @@y`', []],
  ['$s.replace(/§|@@|&id/g, \'\')', []],
  ['$v =: 2', []],
  ['$v =: $w + 1', ['$v']],
  ['$v := 2', []],
  ['&$panier', []],
  ['(isnt)', []],
  ['($a isnt)', []],
  ['[1, 2].filter (isnt)', []],
  ['[$a isnt]', []],
  ['{k: $a isnt}', []],
  ['§theme = \'sombre\'', []],
  ['§§x = $n + 1', []],
  ['µlayout = \'x\'', []],
  ['$$Panier', ['$Panier']],
  ['$x |>= f', []],
  ['$x ?= 1', []],
]

describe('écritures rares du gabarit : lues par l\'arbre, comme l\'ancienne lecture', () => {
  it('chacune lue par l\'arbre, avec la sortie ou le message de l\'ancienne lecture au caractère près', () => {
    for (const [expr, externes] of CAS) {
      const a = lire(expr, 'ancienne', externes)
      const b = lire(expr, 'arbre', externes)
      assert.equal(b.relues, 0, `${expr} : lue par l'arbre (raison du refus : ${expressionCounters.last})`)
      assert.equal(b.texte, a.texte, expr)
    }
  })
})
