// les dépendances d'une expression qui n'est pas écrite en JavaScript sont lues sur le code qu'elle émet : chaque variable que ce
// code lit est suivie. Avant, une lecture du texte en perdait (comparaison chaînée, `|>=`, `for … of`, objet sur
// plusieurs lignes) : l'effet n'était rattaché à aucune variable, l'écran gardait sa première valeur. Gabarit compilé, variables
// suivies lues dans la table des effets
import assert from 'node:assert/strict'
import { compile } from '../src/generator/index.js'
import { Analyzer } from '../src/analyzer/index.js'

// forme, gabarit, variables que l'effet doit suivre
const FORMES: [string, string, string[]][] = [
  ['comparaison chaînée dans un if … then', '<p>{(if 0 < $x < 10 then $y else $z)}</p>', ['x', 'y', 'z']],
  ['comparaison chaînée dans une liste filtrée', '<p>{$l.filter(&.prix < $max < 100)}</p>', ['l', 'max']],
  ['comparaison chaînée dans une compréhension', '<p>{(e for e in $l when 0 < e < $max)}</p>', ['l', 'max']],
  ['comparaison chaînée dans une chaîne interpolée', '<p>{"#{$n} résultat#{if 1 < $n < 9 then \'s\' else \'\'}"}</p>', ['n']],
  ['comparaison chaînée dans un objet', '<p>{{dedans: 0 < $x < 10, $y}}</p>', ['x', 'y']],
  ['|>= sur un chemin', '<p>{$x.y |>= f}</p>', ['x']],
  ['|>= avec une fonction de l\'état', '<p>{$x.y.z |>= $g}</p>', ['x', 'g']],
  ['|>= sur un accès calculé', '<p>{$x[$k] |>= f}</p>', ['x', 'k']],
  ['for … of sur une variable de l\'état', '<p>{($x for $x of $l)}</p>', ['x', 'l']],
  ['for … of dans une expression', '<p>{(e * $k for e of $l)}</p>', ['k', 'l']],
  ['objet sur plusieurs lignes', '<p>{{\n  x: $x\n  y: 0 < $y < 5\n}}</p>', ['x', 'y']]
]

describe('dépendances lues sur le code émis', function () {
  FORMES.forEach(([forme, gabarit, suivies]) => {
    it(`${forme} : ${gabarit.replace(/\n/g, '⏎')} suit ${suivies.join(', ')}`, function () {
      const a = new Analyzer('var f = (q) => q;', [])
      a.autoDeclareFromTemplate(gabarit)
      const [, , , , effectsByVar] = compile(gabarit, { analyzer: a })
      for (const v of suivies) assert.ok(effectsByVar.has(v), `${v} non suivie ; table des effets : ${JSON.stringify([...effectsByVar.keys()])}`)
    })
  })
})
