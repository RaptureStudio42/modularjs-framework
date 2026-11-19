// Un paramètre de rappel nommé `$nom` dans une expression du gabarit (`{$l.map(($v) => $v * 2)}`) écrivait l'état `$.v` à chaque
// rendu ; il est refusé à la construction (« ne nommez pas un paramètre `$nom` ») ; un `$x` lu dans la valeur par défaut d'un
// paramètre reste permis

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

const S = '<script>\n$l = [1, 2]\n$d = 0\n</script>\n'

describe('expression du gabarit : paramètre de rappel nommé $nom refusé', function () {
  this.timeout(60000)

  for (const expr of ['{$l.map(($v) => $v * 2)}', '{$l.map(($v, i) -> i)}', '{$l.map($v => 1)}']) {
    it(`${expr} : refusé, avec le nom du paramètre`, async () => {
      const r = await construire(S + `<p>${expr}</p>\n`)
      assert.match(r.msg, /ne nommez pas un paramètre « \$v »/, r.msg)
    })
  }

  for (const expr of ['{$l.map((v) => v * 2)}', '{$l.map((x = $d) => x)}', '{$l.map((x) -> x + $d)}']) {
    it(`témoin : ${expr} se construit`, async () => {
      assert.equal((await construire(S + `<p>${expr}</p>\n`)).msg, '')
    })
  }
})
