// Une expression régulière passée sans parenthèses, puis une chaîne interpolée sur la même ligne
// (`$z = $v.replace /"/g, "#{$n}"`) : le lexeur lit l'expression d'un bloc en CoffeeScript comme en Civet, selon la règle
// de l'appel implicite de leurs lecteurs (regexEnArgument). Lue comme une division, son guillemet ouvrait une fausse
// chaîne refermée par le guillemet de l'interpolation, et `#{$n}"` passait pour un commentaire : `$n` restait tel quel
// (`ReferenceError: $n` à l'exécution, en CoffeeScript comme en Civet). En JavaScript et en TypeScript la règle ne vaut pas :
// `a /2 + b /4` divise

import assert from 'node:assert/strict'
import { tokenize } from '../src/lexer/index.js'
import { monterModule, textes, pause } from './helpers/module-dynamique.js'

const SCRIPT = [
  "$v = 'a\"b\\'c#d'",
  "$n = 'N'",
  '$a = 6',
  '$b = 3',
  "$w = 'avant'",
  '$z = $v.replace /"/g, "#{$n}"',
  "$y = $v.replace /'/g, \"#{$n}\"",
  '$x = $v.replace /#/g, "#{$n}"',
  '$d1 = $a / $b + "#{$n}/"',
  '$d2 = $a/$b + "#{$n}/"',
  "$$n = 'S'",
  '$mq = q($v)',
  '$mr = r($v)',
].join('\n') + '\n'

// le même code dans le <script module> et dans un module importé : l'interpolation y lit le store
const SECTION_MODULE = "r = (s) -> s.replace /\"/g, \"#{$$n}\"\n</script>\n"
const MODULE         = 'export q = (s) -> s.replace /"/g, "#{$$n}"\n'

// le même code dans un gestionnaire du gabarit
const BOUTON = '<button class="g" @click={$w = $v.replace /"/g, "#{$n}"}>g</button>\n<p class="w">{$w}</p>\n'

describe('expression régulière en appel implicite suivie d\'une chaîne interpolée — lexeur', function () {
  this.timeout(60000)

  for (const lang of ['coffee', 'civet'] as const) {
    it(`lexeur (${lang}) : l'expression est lue d'un bloc, le \`$n\` de l'interpolation qui la suit est réécrit`, () => {
      for (const re of ['/"/g', "/'/g", '/#/g']) {
        const out = tokenize(`$z = $v.replace ${re}, "#{$n}"\n`, { lang })
        assert.equal(out, `$.z = $.v.replace ${re}, "#{$.n}"\n`)
      }
    })

    it(`lexeur (${lang}) : une division reste une division (espaces des deux côtés, collée, \`/=\`)`, () => {
      assert.equal(tokenize('$d1 = $a / $b + "#{$n}/"\n', { lang }), '$.d1 = $.a / $.b + "#{$.n}/"\n')
      assert.equal(tokenize('$d2 = $a/$b + "#{$n}/"\n', { lang }), '$.d2 = $.a/$.b + "#{$.n}/"\n')
      assert.equal(tokenize('$d3 /= $b ; $s = "#{$n}/"\n', { lang }), '$.d3 /= $.b ; $.s = "#{$.n}/"\n')
    })

    it(`composant ${lang} : construit et exécuté`, async () => {
      const attribut = lang === 'coffee' ? ' lang="coffee"' : ''
      const script   = `<script module${attribut}>\n${SECTION_MODULE}<script${attribut}>\n@import q 'outil.${lang}.mjs'\n`
      const m = await monterModule({
        'hote':           script + SCRIPT + '</script>\n<p class="r">{$z}|{$y}|{$x}|{$d1}|{$d2}|{$mq}|{$mr}</p>\n' + BOUTON,
        [`outil.${lang}`]: MODULE,
      }, { prefixe: `regex-interpolation-${lang}` })
      assert.deepEqual(m.erreurs(), [])
      assert.deepEqual(textes(m.hote, '.r'), ['aNb\'c#d|a"bNc#d|a"b\'cNd|2N/|2N/|aSb\'c#d|aSb\'c#d'])
      m.hote._shadow.querySelector('.g').click()
      await pause(50)
      assert.deepEqual(textes(m.hote, '.w'), ['aNb\'c#d'])
      assert.deepEqual(m.erreurs(), [])
    })
  }

  for (const lang of ['js', 'ts'] as const) {
    it(`lexeur (${lang}) : la règle de l'appel implicite ne vaut pas, \`a /2 + b /4\` divise`, () => {
      assert.equal(tokenize('n = $a /2 + $b /4\n', { lang }), 'n = $.a /2 + $.b /4\n')
    })
  }
})
