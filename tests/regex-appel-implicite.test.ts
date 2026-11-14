// Une expression régulière passée sans parenthèses (appel implicite de CoffeeScript et de Civet : `s.split /@/`,
// `s.replace /'/g, 'X'`) est une expression régulière, pas une division : c'est la règle de leurs lecteurs — après un
// nom suivi d'une espace, une barre suivie d'autre chose qu'une espace ouvre une expression régulière ; `a / b`, `a/b`
// et une barre après une parenthèse fermante divisent. Avant, l'apostrophe de `s.replace /'/g, 'X' # fin` ouvrait une
// fausse chaîne dans la passe des commentaires : le `# fin` restait du code (`'X'(this.length(fin))` à l'exécution) ;
// un `#` dans l'expression (`/#/g`) y passait pour un commentaire ; et le masque du code prenait un guillemet de
// l'expression pour le début d'une chaîne, qui cachait les lignes suivantes (`$x`, runes)

import assert from 'node:assert/strict'
import { maskNonCode } from '../src/mask.js'
import { applyMjsSugarToScript } from '../src/transpiler/index.js'
import { monterModule, textes, pause } from './helpers/module-dynamique.js'

const V = "$v = \"l'a\\\"b#c\"\n"

// mêmes méthodes en Civet et en CoffeeScript : regex avec apostrophe, guillemet, dièse, heregex, divisions
const METHODES = [
  "@a = (s) -> s.replace /'/g, 'X' # fin",
  "@b = (s) -> s.replace /\"/g, 'Q' # fin",
  "@c = (s) -> s.replace /#/g, 'H' # fin",
  '@e = (s) ->',
  "  t = s.replace /'/g, 'Y'",
  "  if t isnt '' then t + '!' else '?'",
  "@h = (s) -> s.replace ///'///g, 'Z' # fin",
  '@h2 = (s) -> s.replace ///',
  "  ' # une apostrophe",
  '  | \\# # un dièse',
  "///g, 'W' # fin",
  "@i = (s) -> if s isnt 'z' then 'ok' else 'ko'",
  '@d1 = (a, b) -> a / b # fin',
  '@d2 = (a, b) -> a/b # fin',
  '@d4 = (a, b) -> a /= b # fin',
  // la regex, puis un `$x` sur la même ligne et sur la suivante (réactivité)
  '@g = ->',
  "  $w = $v.replace /\"/g, 'R'; $n = $n + 1 # fin",
  '  $m = $n * 10',
].join('\n') + '\n'

// `(x) /2` : division en CoffeeScript ; Civet y lit le début d'une regex (`(x) /2` seul ne s'y construit pas)
const D3 = { civet: '@d3 = (x) -> (x)/2 # fin\n', coffee: '@d3 = (x) -> (x) /2 # fin\n' }

const GABARIT = [
  '<p class="r">{@a($v)}</p>',
  '<p class="r">{@b($v)}</p>',
  '<p class="r">{@c($v)}</p>',
  '<p class="r">{@e($v)}</p>',
  '<p class="r">{@h($v)}</p>',
  '<p class="r">{@h2($v)}</p>',
  '<p class="r">{@i($v)}</p>',
  '<p class="r">{@d1(6, 3)}</p>',
  '<p class="r">{@d2(6, 3)}</p>',
  '<p class="r">{@d4(6, 3)}</p>',
  '<p class="r">{@d3(8)}</p>',
  '<p class="m">{@mq($v)}|{@mk($v)}</p>',
].join('\n') + '\n'

const ATTENDUS = ['lXa"b#c', 'l\'aQb#c', 'l\'a"bHc', 'lYa"b#c!', 'lZa"b#c', 'lWa"bWc', 'ok', '2', '2', '2', '4', 'lXa"b#c|lXa"b#c']

const BOUTON = '<button class="g" @click={@g()}>g</button>\n<p class="w">{$w}|{$n}|{$m}</p>\n'

const MODULE = "export q = (s) -> s.replace /'/g, 'X' # fin\nexport k = (s) ->\n  t = s.replace /'/g, 'X' # fin\n  if t isnt '' then t else '?'\n"

describe('expression régulière en appel implicite — passe des commentaires, masque du code', function () {
  this.timeout(60000)

  it('passe des commentaires : `s.replace /\'/g, \'X\' # fin` garde la regex et convertit le commentaire', () => {
    const out = applyMjsSugarToScript("y = s.replace /'/g, 'X' # fin\nz = s.split /#/\n", 'civet')
    assert.match(out, /\/'\/g, 'X' \/\/ fin/, out)
    assert.match(out, /s\.split \/#\//, out)
  })

  for (const lang of ['civet', 'coffee']) {
    it(`composant ${lang}, modules .civet.mjs et .coffee.mjs : construits et exécutés`, async () => {
      const script = lang === 'coffee' ? '<script lang="coffee">\n' : '<script>\n'
      const imports = "@import q 'outil.civet.mjs'\n@import k 'outilk.coffee.mjs'\n@mq = (s) -> q(s)\n@mk = (s) -> k(s)\n"
      const m = await monterModule({
        'hote':          script + imports + V + "$w = 'avant'\n$n = 1\n$m = 0\n" + METHODES + D3[lang as 'civet' | 'coffee'] + '</script>\n' + GABARIT + BOUTON,
        'outil.civet':   MODULE,
        'outilk.coffee': MODULE,
      }, { prefixe: `regex-implicite-${lang}` })
      assert.deepEqual(m.erreurs(), [])
      assert.deepEqual([...textes(m.hote, '.r'), ...textes(m.hote, '.m')], ATTENDUS)
      assert.deepEqual(textes(m.hote, '.w'), ['avant|1|0'])
      m.hote._shadow.querySelector('.g').click()
      await pause(50)
      assert.deepEqual(textes(m.hote, '.w'), ['l\'aRb#c|2|20'])
      assert.deepEqual(m.erreurs(), [])
    })
  }

  // le code reste lu après l'expression : `$x` et runes à leur place, sur la même ligne et les suivantes
  const vu = (masque: string, ecrit: string, mot: string): void => {
    let at = -1
    while ((at = ecrit.indexOf(mot, at + 1)) !== -1) assert.equal(masque.slice(at, at + mot.length), mot, `${mot} masqué dans ${JSON.stringify(ecrit)} → ${JSON.stringify(masque)}`)
  }

  for (const lang of ['civet', 'coffee']) {
    it(`maskNonCode (${lang}) : l'expression régulière est masquée, le code qui la suit reste lu`, () => {
      const cas = [
        "s.split /@/ ; $x = µt('k')\ny = $x",
        "h = s.replace /\"/g, '&quot;' ; $x = 1\ny = µt($x)",
        "s.replace /'/g, 'X' # fin $z\ny = $x",
        "s.replace /#/g, 'H' ; y = $x\nz = µt($x)",
        "ok = Boolean s.match /^[^@'\"]+@[^@]+$/ ; $x = 1\ny = $x",
      ]
      for (const ecrit of cas) {
        const masque = maskNonCode(ecrit, lang)
        assert.equal(masque.length, ecrit.length)
        vu(masque, ecrit, '$x')
        vu(masque, ecrit, 'µt')
        assert.doesNotMatch(masque, /\$z|['"#@]|&quot/, `${JSON.stringify(ecrit)} → ${JSON.stringify(masque)}`)
      }
    })
  }

  it('maskNonCode : une division reste une division (espaces des deux côtés, collée, après une parenthèse ou un nombre)', () => {
    for (const ecrit of ['n = $a / $b # fin $z\ny = $x', 'n = $a/$b # fin $z\ny = $x', 'n = ($a) /2 # fin $z\ny = $x', 'n = 6 /2 # fin $z\ny = $x', 'n = $a /= 2 # fin $z\ny = $x']) {
      const masque = maskNonCode(ecrit, 'civet')
      vu(masque, ecrit, '$x')
      vu(masque, ecrit, '$a')
      assert.doesNotMatch(masque, /\$z|#/, `${JSON.stringify(ecrit)} → ${JSON.stringify(masque)}`)
    }
  })

  it('maskNonCode (js) : la règle de l\'appel implicite ne vaut pas pour JavaScript, `a /2 + b /4` divise', () => {
    const ecrit = 'n = $a /2 + $b /4\ny = $x'
    const masque = maskNonCode(ecrit, 'js')
    vu(masque, ecrit, '$b')
    vu(masque, ecrit, '$x')
  })
})
