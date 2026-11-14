// la lecture de toutes les accolades d'un texte (lireAccoladesALEnvers : le gabarit d'un composant, <@head>, le repli de <@failed>, dès
// qu'une accolade ne se referme pas) rend, pour chaque accolade, ce que rend extractBalanced lancé seul après elle : son contenu et la
// position qui suit sa fermante, ou rien si elle ne se referme jamais. Textes tirés au hasard (graine fixe) parmi les morceaux qui changent
// la lecture : accolades, parenthèses, chaînes et leurs échappements, `${…}` et `#{…}`, commentaires `//`, `/* */` et `#`, regex et
// divisions, conditions (`if (…) /x/`) jusqu'au-delà des 400 caractères où se cherche leur parenthèse ouvrante

import assert from 'node:assert/strict'
import { Scanner, extractBalanced, lireAccoladesALEnvers } from '../src/parser/index.js'

type Lue = { corps: string, fin: number } | null

// chaque accolade lue seule, du texte qui la suit : la définition
function reference(html: string): Map<number, Lue> {
  const lues = new Map<number, Lue>()
  for (let at = html.indexOf('{'); at !== -1; at = html.indexOf('{', at + 1)) {
    const lecteur = new Scanner(html)
    lecteur.pos = at + 1
    try {
      lues.set(at, { corps: extractBalanced(lecteur, '}'), fin: lecteur.pos })
    }
    catch {
      lues.set(at, null)
    }
  }
  return lues
}

// tirage reproductible (mulberry32)
function tirage(graine: number): () => number {
  let a = graine >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const MORCEAUX = ['{', '}', '{', '}', '{ ', ' }', '(', ')', '(', ')', ' ', 'a', 'x', '1', '/', '/', '*', '//', '/*', '*/', '/*/', '\'', '"', '`', '\\', '\\\\', '#', '#{', '${', '#a', '[', ']', '\n', 'if (', 'while(', 'for (', 'with (', ') /', ')/', '+', '++', '--', '=', '<', '</', 'return ', 'in ', 'é', ':)', '$x']
const LONGS    = ['a'.repeat(190), ' '.repeat(190), '('.repeat(3), ')'.repeat(3), 'if (' + 'a'.repeat(380), '{ '.repeat(60)]

function texte(hasard: () => number, morceaux: number, longs: boolean): string {
  let s = ''
  for (let i = 0; i < morceaux; i++) {
    if (longs && hasard() < 0.08) s += LONGS[Math.floor(hasard() * LONGS.length)]
    else s += MORCEAUX[Math.floor(hasard() * MORCEAUX.length)]
  }
  return s
}

function compare(html: string): void {
  const attendu = [...reference(html)]
  const lu      = [...lireAccoladesALEnvers(html)].sort((a, b) => a[0] - b[0])
  assert.deepEqual(lu, attendu, `texte : ${JSON.stringify(html)}`)
}

describe('lecture de toutes les accolades : chacune comme extractBalanced lancé seul', function () {
  this.timeout(120000)

  it('cas écrits à la main', () => {
    const CAS = [
      '', '{', '}', '{}', '{{}}', '{ { }', 'a { b ) c { d }', '{ if (a) /\'/.test(b) }', '{ (x { ) /\'/ }', '{ if (x { ) /\'/ } }',
      '{/*/ }', '{ /* } */ }', '{ // } \n }', '{ a // b \n } }', '{ x = /[/]/ }', '{ x = /}/ }', '{ "#{ a }" }', '{ "#{\n}" }',
      '{ "#{ { }" }', '{ `${ { }` } }', '{ `${ ` }', '{ # { \n } }', '{ # } }', '{ #{ } }', '{ #a } }', '{ \'\\\'\' }', '{ "\\\\" } }',
      '{ a++ / 2 } }', '{ </p> }', '{ return /\'/ }', 'if ({) / \'{) / ', '{ ( { ) / } ) /\'/ }', '{ while ({ ) /x/ ; }) /\'/ }',
      '{ {{{{ }}}} ', '{ # {{{\n}}} }', '{ # {\n# }\n} ', 'a { '.repeat(50) + '){$x}', '{ "#{ a }\n" } ',
    ]
    for (const html of CAS) compare(html)
  })

  it('20 000 textes courts tirés au hasard', () => {
    const hasard = tirage(20261029)
    for (let i = 0; i < 20000; i++) compare(texte(hasard, 1 + Math.floor(hasard() * 30), false))
  })

  it('400 textes longs : conditions et accolades au-delà de la portée de la parenthèse ouvrante', () => {
    const hasard = tirage(400)
    for (let i = 0; i < 400; i++) compare(texte(hasard, 20 + Math.floor(hasard() * 40), true))
    // la parenthèse ouvrante de la condition juste en deçà, puis juste au-delà, des 400 caractères qui précèdent la `)`
    for (const k of [395, 396, 397, 398, 399, 400, 401, 402]) {
      compare(`{ if (${'a'.repeat(k)}{ ) /'/ } }`)
      compare(`{ if ({${'a'.repeat(k)} ) /'/ } }`)
      compare(`{ { if (${'a'.repeat(k - 10)}{ a ) /'/ } }`)
    }
    // accolades comptées dans des commentaires `#`, puis refermées plus loin : des lectures à plusieurs niveaux qui redescendent ensemble
    for (let k = 1; k <= 24; k++) for (const j of [k - 1, k, k + 1]) {
      compare('{ # '.repeat(k) + '\n' + '}'.repeat(j))
      compare('{ # '.repeat(k) + '\n' + ' \'x\' }'.repeat(j) + ' /* */')
      compare('{ # { '.repeat(k) + '\n' + '{ } } # }\n'.repeat(j))
      compare('{ if ({ # '.repeat(k) + '\n' + ') /\'/ }'.repeat(j))
    }
  })
})
