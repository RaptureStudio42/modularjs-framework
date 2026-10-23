// Une règle d'objet écrite sur plusieurs lignes (`<vars>`, `<types>`) cite la ligne de sa faute, pas celle
// de son nom : une chaîne ou une forme /…/ jamais fermée, une forme vide, un drapeau interdit, une forme
// invalide, un caractère inattendu — les fautes lues pendant le découpage en jetons — comme celles de l'analyse.

import assert from 'node:assert/strict'
import { transpile } from '../src/transpiler/index.js'
import { compileVars, parseTypesBlock } from '../src/transpiler/var-types.js'

const vars = (champ: string) => `<vars>\n$o {\n  a: int,\n  ${champ}\n}\n</vars>\n<p>{$o.a}</p>\n`

describe('règle d\'objet sur plusieurs lignes : la ligne de la faute', () => {
  const fautes: [string, string, RegExp][] = [
    ['chaîne jamais fermée', 'b: \'abc', /n'a pas de guillemet de fin/],
    ['forme /…/ jamais fermée', 'b: string /abc', /n'a pas de \/ de fin/],
    ['forme vide', 'b: string //', /est vide/],
    ['drapeau g', 'b: string /a/g', /drapeau g/],
    ['forme invalide', 'b: string /(/', /est invalide/],
    ['caractère inattendu', 'b: int ;', /caractère « ; » inattendu/],
  ]
  for (const [nom, champ, motif] of fautes) {
    it(`${nom} : la ligne du champ fautif, dans le fichier`, async () => {
      await assert.rejects(
        transpile(vars(champ), { moduleName: 'carte' }),
        (err: any) => /<vars>, ligne 4 :/.test(err.message) && motif.test(err.message)
      )
    })
  }

  it('la même faute sur la première ligne de la règle : la ligne du nom', async () => {
    await assert.rejects(transpile('<vars>\n$o string //\n</vars>\n<p>{$o}</p>\n', { moduleName: 'carte' }), /<vars>, ligne 2 :/)
  })

  it('une faute après deux lignes déjà lues : la troisième', () => {
    const lire = () => compileVars({ raw: '$a int\n$o {\n  a: int,\n  b: int,\n  c: \'x\n}\n', startLine: 10 }, {}, true)
    assert.throws(lire, /<vars>, ligne 14 :/)
  })

  it('fins de ligne Windows : les lignes se comptent aussi', () => {
    const lire = () => compileVars({ raw: '$o {\r\n  a: int,\r\n  b: string /abc\r\n}\r\n', startLine: 10 }, {}, true)
    assert.throws(lire, /<vars>, ligne 12 :/)
  })

  it('<types> : une règle d\'objet sur plusieurs lignes cite sa ligne fautive aussi', () => {
    assert.throws(() => parseTypesBlock('Point {\n  x: int,\n  y: string //\n}\n', 20), /<types>, ligne 22 :/)
    assert.throws(() => parseTypesBlock('Point {\n  x: int,\n  y: int ;\n}\n', 20), /<types>, ligne 22 :/)
  })

  it('les fautes d\'analyse citaient déjà la bonne ligne : elles la gardent', () => {
    assert.throws(() => compileVars({ raw: '$o {\n  a: int,\n  b: bool 1..2\n}\n', startLine: 10 }, {}, true), /<vars>, ligne 12 :/)
    assert.throws(() => compileVars({ raw: '$o {\n  a: int,\n  b: int,\n  a: int\n}\n', startLine: 10 }, {}, true), /<vars>, ligne 13 :/)
  })
})
