// stripLineComment : la ligne de CSS d'un effet à soi sans son commentaire `//` (jusqu'au bout de la ligne), et ce qu'elle laisse en place : un
// texte entre guillemets, `url(…)`, une adresse à protocole, un `/* … */`. La lecture des lignes d'un effet est tenue par
// effets-fichier-commentaire-css.test.ts.

import assert from 'node:assert/strict'
import { stripLineComment } from '../src/effects/style-comment.js'

describe('stripLineComment : la ligne sans son commentaire', () => {
  // [ligne écrite, ligne gardée]
  const CAS: Array<[string, string]> = [
    ['a: b // c', 'a: b'],
    ['a: b//c', 'a: b'],
    ['a: b', 'a: b'],
    ['// c', ''],
    ['   // c', ''],
    ['a: "//"', 'a: "//"'],
    ['a: \'//\' // c', 'a: \'//\''],
    ['a: url(//x)', 'a: url(//x)'],
    ['a: url(//x) // c', 'a: url(//x)'],
    ['a: url(\'//x\') // c', 'a: url(\'//x\')'],
    ['a: curl(//x)', 'a: curl('],
    ['a: https://x', 'a: https://x'],
    ['a: https://x // c', 'a: https://x'],
    ['a: HTTP://x // c', 'a: HTTP://x'],
    ['a://x', 'a:'],
    ['a: /* // */ b', 'a: /* // */ b'],
    ['a: /* c */ // d', 'a: /* c */'],
    ['a: /* jamais refermé // d', 'a: /* jamais refermé // d'],
    ['a: b /', 'a: b /'],
    ['a: b / c', 'a: b / c']
  ]

  for (const [ecrite, gardee] of CAS) {
    it(JSON.stringify(ecrite) + ' → ' + JSON.stringify(gardee), () => {
      assert.equal(stripLineComment(ecrite), gardee)
    })
  }
})
