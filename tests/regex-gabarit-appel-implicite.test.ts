// Une expression régulière passée sans parenthèses dans le gabarit (appel implicite de Civet et de CoffeeScript :
// `@click={ $w = $v.replace /"/g, 'R' # fin }`, `{$v.replace /'/g, 'A'}`) se lit comme dans un script : après un nom suivi
// d'une espace, une barre suivie d'autre chose qu'une espace ouvre une expression régulière, qui se referme sur sa ligne ;
// `a / b` et `a/b` divisent. Avant, le lecteur du gabarit y voyait une division : le guillemet ou l'apostrophe de
// l'expression ouvrait une fausse chaîne, et la construction était refusée (« chaîne non fermée »).

import assert from 'node:assert/strict'
import { Scanner, extractBalanced } from '../src/parser/index.js'
import { convertCoffeeInterpolations } from '../src/lexer/index.js'
import { monterModule, textes, pause } from './helpers/module-dynamique.js'

const ETAT = '$v = "l\'a\\"b#c"\n$w = \'avant\'\n$n = 8\n$k = 0\n'

// gestionnaires écrits dans le gabarit : regex avec guillemet (et un `$k` qui la suit sur la ligne), apostrophe, dièse, deux
// divisions, puis une regex suivie d'une chaîne interpolée
const BOUTONS = [
  `<button class="a" @click={ $w = $v.replace /"/g, 'R'; $k = $k + 1 # fin }>a</button>`,
  `<button class="b" @click={ $w = $v.replace /'/g, 'A' # fin }>b</button>`,
  `<button class="c" @click={ $w = $v.replace /#/g, 'H' # fin }>c</button>`,
  `<button class="d" @click={ $w = String($n / 2) + '|' + ($n/4) # fin }>d</button>`,
  `<button class="e" @click={ $w = $v.replace /"/g, "#{$n}" }>e</button>`,
  '<p class="w">{$w}</p>',
  '<p class="k">{$k}</p>',
].join('\n') + '\n'

const INTERPOLATIONS = `<p class="i">{$v.replace /"/g, 'R'}|{$v.replace /'/g, 'A'}|{$v.replace /#/g, 'H'}|{$n / 2}|{$n/4}</p>\n` +
  `<p class="j">{$v.replace(/"/g, 'R') + "|#{$n}"}|{$v.replace /"/g, "#{$n}"}</p>\n`

const APRES_CLICS = ['l\'aRb#c', 'lAa"b#c', 'l\'a"bHc', '4|2', 'l\'a8b#c']

async function cliquer(m: any): Promise<string[]> {
  const vus: string[] = []
  for (const c of ['a', 'b', 'c', 'd', 'e']) {
    m.hote._shadow.querySelector(`.${c}`).click()
    await pause(30)
    vus.push(...textes(m.hote, '.w'))
  }
  return vus
}

describe('expression régulière en appel implicite — gestionnaires et interpolations du gabarit', function () {
  this.timeout(60000)

  it('lecteur du gabarit : l\'expression se referme sur sa ligne, une division reste une division', () => {
    const lis = (texte: string, dialecte: boolean): string => extractBalanced(new Scanner(texte, 1, dialecte), '}')
    assert.equal(lis(` s.replace /"/g, 'R' # fin }<p>"</p>`, true), ` s.replace /"/g, 'R' # fin `)
    assert.equal(lis(` s.replace /'/g, 'A' }<p>'</p>`, true), ` s.replace /'/g, 'A' `)
    assert.equal(lis(` s.replace /}/g, 'B' }<p></p>`, true), ` s.replace /}/g, 'B' `)
    assert.equal(lis(' a / b + c/d }x', true), ' a / b + c/d ')
    assert.equal(lis(' a /= 2 }x', true), ' a /= 2 ')
    // jamais refermée sur sa ligne : une division
    assert.equal(lis(' a /2\n+ "}" }x', true), ' a /2\n+ "}" ')
    // JavaScript : la barre après un nom divise, la chaîne qui suit est lue
    assert.equal(lis(' $n /2 + "/" + $n }x', false), ' $n /2 + "/" + $n ')
  })

  it('chaînes interpolées : une regex est lue d\'un bloc, ses guillemets n\'ouvrent aucune chaîne', () => {
    assert.equal(convertCoffeeInterpolations(`a = s.replace(/"/g, 'R') ; b = "x#{1}y"`), 'a = s.replace(/"/g, \'R\') ; b = `x${1}y`')
    assert.equal(convertCoffeeInterpolations(`a = s.replace /"/g, 'R' ; b = "x#{1}y"`, undefined, true), 'a = s.replace /"/g, \'R\' ; b = `x${1}y`')
    assert.equal(convertCoffeeInterpolations(`a = b / c ; d = "x#{1}y" ; e = f/g`, undefined, true), 'a = b / c ; d = `x${1}y` ; e = f/g')
    // JavaScript : la barre après un nom divise, la chaîne qui suit est lue
    assert.equal(convertCoffeeInterpolations(`a = n /2 + "x#{1}y" + n /4`), 'a = n /2 + `x${1}y` + n /4')
  })

  for (const lang of ['civet', 'coffee']) {
    it(`gabarit Civet, script ${lang} : gestionnaires et interpolations construits et exécutés`, async () => {
      const script = lang === 'coffee' ? '<script lang="coffee">\n' : '<script>\n'
      const m = await monterModule({ hote: script + ETAT + '</script>\n' + BOUTONS + INTERPOLATIONS }, { prefixe: `regex-gabarit-${lang}` })
      assert.deepEqual(m.erreurs(), [])
      assert.deepEqual(textes(m.hote, '.i'), ['l\'aRb#c|lAa"b#c|l\'a"bHc|4|2'])
      assert.deepEqual(textes(m.hote, '.j'), ['l\'aRb#c|8|l\'a8b#c'])
      assert.deepEqual(await cliquer(m), APRES_CLICS)
      assert.deepEqual(textes(m.hote, '.k'), ['1'])
      assert.deepEqual(m.erreurs(), [])
    })
  }

})
