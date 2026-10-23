// Un champ lié (`value=!{$n}`) qu'on peut vider (« 5 », Retour arrière) n'est reconnu comme champ nombre que si
// son `type` est « number » ou peut le devenir : `type` écrit en dur, ou donné par une variable
// (`type={$t}`, `type=!{$t}`, `type="{$t}"`, `type="a{$t}"`, `type="$t"`). Un autre type écrit en dur (`text`, `range`), ou
// l'absence de `type`, n'a pas ce traitement. Le code généré le montre : la garde du champ vidé n'existe que pour le champ nombre.

import assert from 'node:assert/strict'
import { transpile } from '../src/transpiler/index.js'

async function vidable(balise: string, templateLang: 'civet' | 'js'): Promise<boolean> {
  const { output } = await transpile(`<script>\n  $t = 'number'\n  $n = 1\n</script>\n${balise}\n`, { moduleName: 'card', templateLang } as any)
  return /_mjs_bv\s*={2,3}\s*0/.test(output)
}

const OUI: Array<[string, string]> = [
  ['type écrit « number »',              '<input type="number" value=!{$n}>'],
  ['type « number » entouré d\'espaces', '<input type=" number " value=!{$n}>'],
  ['type « NUMBER » en majuscules',      '<input type="NUMBER" value=!{$n}>'],
  ['type donné par {$t}',                '<input type={$t} value=!{$n}>'],
  ['type donné par !{$t}',               '<input type=!{$t} value=!{$n}>'],
  ['type "{$t}" entre guillemets',       '<input type="{$t}" value=!{$n}>'],
  ['type "a{$t}" mêlé à du texte',       '<input type="a{$t}" value=!{$n}>'],
  ['type "$t" (variable nue)',           '<input type="$t" value=!{$n}>']
]

const NON: Array<[string, string]> = [
  ['type « text »',     '<input type="text" value=!{$n}>'],
  ['type « range »',    '<input type="range" value=!{$n}>'],
  ['type « numbers »',  '<input type="numbers" value=!{$n}>'],
  ['aucun type',        '<input value=!{$n}>'],
  ['un <textarea> qui porte type={$t}', '<textarea type={$t} value=!{$n}></textarea>']
]

for (const templateLang of ['civet', 'js'] as const) {
  describe(`champ nombre reconnu par son type, écrit ou donné par une variable (gabarit ${templateLang})`, function () {
    this.timeout(60000)

    for (const [nom, balise] of OUI) {
      it(`${nom} : champ qu'on peut vider`, async () => {
        assert.equal(await vidable(balise, templateLang), true, balise)
      })
    }

    for (const [nom, balise] of NON) {
      it(`${nom} : pas de traitement du champ vidé`, async () => {
        assert.equal(await vidable(balise, templateLang), false, balise)
      })
    }
  })
}
