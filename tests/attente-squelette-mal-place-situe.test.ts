// `*skeleton` finit la tête d'un {await} : une expression écrite après lui (`{await $p *skeleton $q}`) ne se compile pas, et
// la faute doit être citée à sa place dans le fichier (`fichier.mjs:ligne:colonne`), comme toute faute d'expression du
// gabarit — elle l'était dans l'expression isolée (`a-un.expr:1:7`), sans la ligne du composant

import assert from 'node:assert/strict'
import { transpile } from '../src/transpiler/index.js'

const faute = async (source: string): Promise<string> => {
  try {
    await transpile(source, { moduleName: 'a-un' } as any)
  }
  catch (e: any) {
    return String(e.message)
  }
  return 'compilé'
}

describe('{await} : une faute dans la tête est citée à sa place dans le fichier', function () {
  this.timeout(30000)

  it('`{await $p *skeleton $q}` : refusé, avec la ligne et la colonne du fichier', async () => {
    const m = await faute('<p>a</p>\n<div>{await $p *skeleton $q}<p>b</p>{then v}<p>{v}</p>{end}</div>\n<script>\n$p = Promise.resolve(1)\n$q = 2\n</script>\n')
    assert.notEqual(m, 'compilé')
    assert.doesNotMatch(m, /a-un\.expr:/, m)
    assert.match(m, /a-un\.mjs:2:17\b/, m)
  })

  it('`{await.keep $p *x $q}` : la faute d\'expression de la tête est citée à sa place', async () => {
    const m = await faute('<p>a</p>\n<p>x</p>\n<div>{await.keep $p *x $q}<p>b</p>{then v}<p>{v}</p>{end}</div>\n<script>\n$p = Promise.resolve(1)\n$q = 2\n</script>\n')
    assert.notEqual(m, 'compilé')
    assert.doesNotMatch(m, /a-un\.expr:/, m)
    assert.match(m, /a-un\.mjs:3:22\b/, m)
  })

  it('témoin : une faute d\'expression ordinaire reste citée à sa place', async () => {
    const m = await faute('<p>a</p>\n<p>{$p *x $q}</p>\n<script>\n$p = 1\n$q = 2\n</script>\n')
    assert.match(m, /a-un\.mjs:2:9\b/, m)
  })
})
