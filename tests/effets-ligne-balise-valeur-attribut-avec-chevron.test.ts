// La ligne qu'une faute d'effet cite est celle où s'ouvre la balise qui écrit l'effet. Un `<` dans une valeur d'attribut
// (`data-x="a<b"`, `title="x <b>gras</b>"`) n'ouvre aucune balise : il ne compte pas, même sur une balise écrite sur
// plusieurs lignes.

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { transpileFromMsg, withEffectLines } from '../src/bundler/transpile-msg.js'
import { mjsTmp } from './helpers/tmp.js'

const dir = mjsTmp('ligne-chevron')
mkdirSync(dir, { recursive: true })

// la faute telle que le bundler la reçoit du transpileur : le message d'un effet inconnu, avec la ligne que porte le générateur
const fault = (line?: number) => Object.assign(new Error('[ModularJS] *titre : effet inconnu — effets disponibles : *annotate, *attention.'), line ? { mjsLine: line } : {})
const said  = (content: string, line?: number) => withEffectLines(fault(line), content).message

async function realFault(content: string): Promise<string> {
  try {
    await transpileFromMsg({ type: 'transpile', id: 1, content, moduleName: 'carte', baseDir: dir, preResolvedAssets: {} } as any)
  }
  catch (e: any) {
    return String(e.message)
  }
  return 'AUCUNE ERREUR'
}

const cases: Array<[string, string, number]> = [
  ['un `<` dans une valeur entre guillemets doubles', '<p>a</p>\n<p\n  data-x="a<b"\n  *titre>x</p>\n', 2],
  ['un `<` dans une valeur entre guillemets simples', '<p>a</p>\n<p\n  data-x=\'a<b\'\n  *titre>x</p>\n', 2],
  ['un `<` dans une valeur entre accolades', '<p>a</p>\n<p\n  data-x={$a<Math.PI}\n  *titre>x</p>\n', 2],
  ['une balise entière dans une valeur d\'attribut', '<p>a</p>\n<p\n  title="x <b>gras</b>" *titre>x</p>\n', 2],
  ['plusieurs `<` dans des valeurs, sur plusieurs lignes', '<p>a</p>\n<p\n  data-x="a<b"\n  data-y="c<d\n  e<f"\n  *titre>x</p>\n', 2],
  ['une valeur avec `<` sur la même ligne que l\'ouverture', '<p>a</p>\n<p data-x="a<b"\n  *titre>x</p>\n', 2],
  ['la balise d\'avant a une valeur avec `<`', '<p data-x="a<b">a</p>\n<p *titre>x</p>\n', 2],
]

describe('la ligne d\'une faute d\'effet, quand une valeur d\'attribut contient un `<`', () => {
  for (const [name, content, line] of cases) {
    it(`${name} : la repli donne la ligne de l'ouverture`, () => {
      assert.match(said(content), new RegExp(`\\*titre \\(ligne ${line}\\) : effet inconnu`))
    })

    it(`${name} : la ligne du générateur, celle de l'ouverture, est gardée`, () => {
      assert.match(said(content, line), new RegExp(`\\*titre \\(ligne ${line}\\) : effet inconnu`))
    })

    it(`${name} : de bout en bout, le message de la compilation cite la ligne de l'ouverture`, async () => {
      assert.match(await realFault(content), new RegExp(`\\*titre \\(ligne ${line}\\) : effet inconnu`))
    })
  }

  it('un `<` qui n\'ouvre pas de balise (comparaison dans le texte) ne compte toujours pas', () => {
    assert.match(said('<p>a < b</p>\n<p>c</p>\n<p *titre>x</p>\n', 3), /\*titre \(ligne 3\) : effet inconnu/)
  })

  it('une balise sur plusieurs lignes sans `<` dans ses valeurs garde la ligne de son ouverture', () => {
    assert.match(said('<p>a</p>\n<p\n  class="x"\n  *titre>x</p>\n', 2), /\*titre \(ligne 2\) : effet inconnu/)
  })
})
