// Une expression du gabarit qui finit par un opérateur (`{$a +}`, `{if $a ==}`, `title="a {$x +} b"`) devenait une fonction pour Civet,
// affichée telle quelle ou toujours vraie : refusée à la construction, avec la forme à écrire. Un commentaire `# …` dans une expression
// (`{$t # note}`, qui compilait en appels) se lit comme un commentaire : l'expression affiche `$t`. Restent permis : un `#` dans une
// chaîne, une interpolation `#{…}`, une regex en fin d'expression, un générique TypeScript (`$o as Record<string, number>`), `$a > 1`

import assert from 'node:assert/strict'
import { transpile } from '../src/transpiler/index.js'

async function construire(src: string): Promise<{ msg: string, out: string }> {
  const e = console.error, w = console.warn
  console.error = console.warn = () => {}
  try {
    const r: any = await transpile(src, { moduleName: 'cas' })
    return { msg: '', out: String(r.output) }
  }
  catch (err: any) {
    return { msg: String(err?.message ?? err), out: '' }
  }
  finally {
    console.error = e
    console.warn = w
  }
}

const S = '<script>\n$a = 1\n$b = 2\n$t = \'x\'\n$x = 3\n$o = {}\n</script>\n'

describe('expression du gabarit : opérateur final refusé, commentaire lu comme un commentaire', function () {
  this.timeout(60000)

  for (const [nom, gabarit] of [['{$a +}', '<p>{$a +}</p>'], ['{if $a ==}', '{if $a ==}\n<p>v</p>\n{end}'], ['title="a {$x +} b"', '<p title="a {$x +} b">v</p>'], ['{$a and}', '<p>{$a and}</p>']]) {
    it(`${nom} : refusé, l'opérateur final nommé`, async () => {
      const r = await construire(S + gabarit + '\n')
      assert.match(r.msg, /finit par l'opérateur/, r.msg)
    })
  }

  it('{$t # note} : le commentaire se lit comme un commentaire, l\'expression affiche $t', async () => {
    const r = await construire(S + '<p>{$t # note}</p>\n')
    assert.equal(r.msg, '')
    assert.ok(!r.out.includes('this.length(note)'), r.out.split('\n').filter((l) => l.includes('$.t')).join('\n'))
    assert.match(r.out, /\$\.t\b/)
  })

  for (const gabarit of ['<p>{$a + 1}</p>', '<p>{$a?}</p>', '<p>{"#" + $t}</p>', '<p>{"a#{$t}"}</p>', '<p>{/a+/.test($t)}</p>', '<p>{$a / 2}</p>', '<p>{-$a}</p>', '<p>{$a ? "x" : "y"}</p>', '<p>{$a and $b}</p>', '<p>{$o as Record<string, number>}</p>', '<p>{$o satisfies Record<string, number>}</p>', '<p>{$o as Array<number>}</p>', '<p>{$a > 1}</p>']) {
    it(`témoin : ${gabarit} se construit`, async () => {
      assert.equal((await construire(S + gabarit + '\n')).msg, '')
    })
  }

  it('{$a => $a} : aucun opérateur final ; refusé pour son paramètre $a ($ est réservé à l\'état)', async () => {
    const r = await construire(S + '<p>{$a => $a}</p>\n')
    assert.doesNotMatch(r.msg, /finit par l'opérateur/)
    assert.match(r.msg, /ne nommez pas un paramètre « \$a »/)
  })
})
