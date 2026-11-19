// les écritures que l'arbre ne lisait pas encore : runes à forme (`µread`, `µwrite`, `µrefresh`, `µinspect`,
// `µtoggle`, `µimport`, runes du script refusées), comparaison chaînée, nom en clé ou en paramètre, objet abrégé, lettre de
// déguisement écrite, nom après un point qui garde son signe, `$` écrit, expression illisible : lues par l'arbre, même sortie ou même
// message, au caractère près

import { strict as assert } from 'node:assert'
import { cleanJsExpr } from '../src/generator/utils.js'
import { readFileSync as lireFige } from 'node:fs'
import { expressionCounters } from '../src/reader/expression.js'

type LectureDesExpressions = 'ancienne' | 'arbre'
// sorties et messages de l'ancienne lecture des expressions, relevés avant son retrait
// (dans l'ordre des lectures du test : une même écriture se lit autrement dans une branche de {await})
const ANCIENNE = (JSON.parse(lireFige(new URL('./fixtures/expressions-ancienne-lecture.json', import.meta.url), 'utf-8')) as Record<string, { expr: string, externes: string[] }[]>)['expressions-runes-et-fautes-lues-par-l-arbre']
let rang = 0
import { RESERVED_LETTERS } from '../src/reader/disguise.js'

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

const lettre = RESERVED_LETTERS['§']

const CAS: [string, string[]][] = [
  ['µread $x', []],
  ['µread($$x) + 1', []],
  ['µread $x + 1', []],
  ['µwrite $x, 2', []],
  ['µwrite($x, $y + 1)', []],
  ['µwrite $$x, \'a\'', []],
  ['µwrite $x = 1', []],
  ['µread', []],
  ['µrefresh $x', []],
  ['µinspect($x)', []],
  ['µinspect $x.a', []],
  ['µinspect($$x)', []],
  ['µtoggle $x', []],
  ['µtoggle($x, \'a\', \'b\')', []],
  ['µimport(\'a.js\')', []],
  ['mjsimport(\'a.js\')', []],
  ['µimport(\'a.js\').then (m) -> $x = m', []],
  ['µevery(1000, f)', []],
  ['µmount', []],
  ['µderived $x', []],
  ['µminmax($x)', []],
  ['\'µread $x\' + $y', []],
  ['a < $x < b', []],
  ['a < $x.y < b', []],
  ['$x.y |>= f', []],
  ['($x) -> $x', []],
  ['{$x: 1}', []],
  ['{a: 1, $b: 2}', []],
  ['{µlayout}', []],
  [`$x + ${lettre}y`, []],
  ['obj.§x', []],
  ['isnt + 1', []],
  ['{…}', []],
  ['$[$k] > 3', []],
  ['$l.map(&.n + $[$i])', []],
]

describe('runes à forme, comparaison chaînée, clé, paramètre, lettre écrite, faute de Civet : lues par l\'arbre', () => {
  it('chacune lue par l\'arbre, avec la sortie ou le message de l\'ancienne lecture au caractère près', () => {
    for (const [expr, externes] of CAS) {
      const a = lire(expr, 'ancienne', externes)
      const b = lire(expr, 'arbre', externes)
      // un paramètre nommé `$x` est refusé (`$` est réservé à l'état) ; l'ancienne lecture écrivait l'état à chaque appel
      if (expr === '($x) -> $x') {
        assert.match(b.texte, /^ERREUR .*ne nommez pas un paramètre « \$x »/, expr)
        continue
      }
      assert.equal(b.texte, a.texte, expr)
      assert.equal(b.relues, 0, `${expr} : lue par l'arbre (raison du refus : ${expressionCounters.last})`)
    }
  })
})
