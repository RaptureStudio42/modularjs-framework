// `.#`, la longueur de Civet, écrit dans une expression du gabarit (`{$l.#}`, `{$l.# > 1}`, `title="{$l.#}"`, `data-n={$l.#}`) se lisait
// comme un commentaire `# …` : la construction refusait l'expression coupée (`$l.`). Un `#` juste après un point n'ouvre aucun
// commentaire ; un commentaire écrit après (`{$l.# # note}`) en reste un

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

const S = '<script>\n  $l = [1, 2, 3]\n</script>\n'

describe('expression du gabarit : `.#`, la longueur, n\'ouvre aucun commentaire', function () {
  this.timeout(60000)

  for (const [nom, gabarit, attendu] of [
    ['{$l.#}', '<p>{$l.#}</p>', /_mjs_updText\('\w+', \$\.l\.length\)/],
    ['{$l.# > 1}', '<p>{$l.# > 1}</p>', /_mjs_updText\('\w+', \$\.l\.length > 1\)/],
    ['title="{$l.#}"', '<p title="{$l.#}">t</p>', /'title', \$\.l\.length\b/],
    ['data-n={$l.#}', '<p data-n={$l.#}>t</p>', /'data-n', \$\.l\.length\b/],
    ['{$l.# # note}', '<p>{$l.# # note}</p>', /_mjs_updText\('\w+', \$\.l\.length\)/],
  ] as Array<[string, string, RegExp]>) {
    it(`${nom} : construit, la longueur de la liste`, async () => {
      const r = await construire(S + gabarit + '\n')
      assert.equal(r.msg, '')
      assert.match(r.out, attendu)
      assert.doesNotMatch(r.out, /note/)
    })
  }
})
