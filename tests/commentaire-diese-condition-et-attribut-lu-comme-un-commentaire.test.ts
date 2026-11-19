// Un commentaire `# …` (ou `### … ###`) se lit comme un commentaire partout où le gabarit compile une expression : texte `{…}`, condition
// d'un bloc (`{if}`, `{elsif}`, `{key}`), itérable d'un `{for}`, attente d'un `{await}`, valeur d'un `{const}`, valeur d'attribut
// calculée, interpolée ou étalée, classe et style conditionnels. La construction passait, puis le composant tombait à l'affichage
// (`note is not defined`) ; en développement comme en production, le code produit ne lit plus `note`, et `### … ###` écrit sur une ligne
// se ferme au `###` suivant (le reste de l'expression est lu) ; quatre dièses ou plus (`######`, `#### x ###`) n'ouvrent aucun bloc : ils
// commentent la fin de l'expression, comme dans le script

import assert from 'node:assert/strict'
import { transpile } from '../src/transpiler/index.js'
import { noHashComment } from '../src/lexer/index.js'

const S = '<script>\n$a = 1\n$b = 0\n$t = \'x\'\n$c = \'red\'\n$o = {}\n$l = [1, 2]\n$p = Promise.resolve(1)\n</script>\n'

const FORMES: Array<[string, string]> = [
  ['{if $a # note}', '{if $a # note}\n<p>v</p>\n{end}'],
  ['{elsif $b # note}', '{if $a}\n<p>a</p>\n{elsif $b # note}\n<p>b</p>\n{end}'],
  ['{for x in $l # note}', '{for x in $l # note}\n<p>{x}</p>\n{end}'],
  ['{await $p # note}', '{await $p # note}\n<p>attente</p>\n{success v}\n<p>{v}</p>\n{end}'],
  ['{key $a # note}', '{key $a # note}\n<p>v</p>\n{end}'],
  ['{const y = x + $a # note} (dans un {for})', '{for x in $l}\n{const y = x + $a # note}\n<p>{y}</p>\n{end}'],
  ['title={$t # note}', '<p title={$t # note}>v</p>'],
  ['title="{$t # note}"', '<p title="{$t # note}">v</p>'],
  ['title="a {$t # note} b"', '<p title="a {$t # note} b">v</p>'],
  [':class{$a # note}="on"', '<p :class{$a # note}="on">v</p>'],
  [':style.color={$c # note}', '<p :style.color={$c # note}>v</p>'],
  ['{...$o # note}', '<p {...$o # note}>v</p>'],
  ['{$a ###### + note}', '<p>{$a ###### + note}</p>'],
  ['{$a #### x ### + note}', '<p>{$a #### x ### + note}</p>'],
  ['title={$a ###### + note}', '<p title={$a ###### + note}>v</p>'],
  ['title="{$a #### x ### + note}"', '<p title="{$a #### x ### + note}">v</p>']
]

async function sortie(src: string, dev: boolean): Promise<string> {
  const r: any = await transpile(src, { moduleName: 'cas', devWarnings: dev })
  return String(r.output)
}

describe('commentaire # partout où le gabarit compile une expression : lu comme un commentaire', function () {
  this.timeout(60000)

  it('expression lue sans ses commentaires : quatre dièses ou plus commentent la fin, un vrai bloc ### se referme', () => {
    for (const [expr, attendu] of [['$a ###### + note', '$a'], ['$a #### x ### + note', '$a'], ['$a #### x', '$a'], ['$a ### x ### + 1', '$a + 1']]) {
      assert.equal(noHashComment(expr).replace(/\s+/g, ' ').trim(), attendu, expr)
    }
  })

  for (const dev of [true, false]) {
    const mode = dev ? 'développement' : 'production'
    for (const [nom, gabarit] of FORMES) {
      it(`${nom} (${mode}) : construit, le code produit ne lit pas note`, async () => {
        const out = await sortie(S + gabarit + '\n', dev)
        assert.ok(!/\bnote\b/.test(out), out.split('\n').filter((l) => /\bnote\b/.test(l)).map((l) => l.trim().slice(0, 200)).join('\n'))
      })
    }

    it(`{$a ### bloc ### + 1} (${mode}) : le bloc se ferme au ### suivant, + 1 est lu`, async () => {
      const out = await sortie(S + '<p>{$a ### bloc ### + 1}</p>\n', dev)
      assert.match(out, /\$\.a\s*\+\s*1/, out.split('\n').filter((l) => l.includes('$.a')).map((l) => l.trim().slice(0, 200)).join('\n'))
    })
  }
})
