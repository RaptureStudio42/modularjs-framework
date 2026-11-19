// Une déclaration de variable de thème écrite après un autre code sur sa ligne (`:host { $$brand: red; }`) : elle ne se lit qu'en
// tête de ligne, et sortait en silence en `var(--mjs-brand): red`, une règle que le navigateur ignore. Refusée à la construction,
// avec le nom et la forme à écrire ; écrite seule sur sa ligne, elle déclare la variable

import assert from 'node:assert/strict'
import { transpile } from '../src/transpiler/index.js'

const S = '<script>\n$a = 1\n</script>\n<div>{$a}</div>\n'

async function construire(style: string): Promise<{ msg: string, out: string }> {
  const orig = console.error
  console.error = () => {}
  try {
    const r: any = await transpile(S + style, { moduleName: 'cas' })
    return { msg: '', out: String(r.output) }
  }
  catch (err: any) {
    return { msg: String(err?.message ?? err), out: '' }
  }
  finally {
    console.error = orig
  }
}

describe('<style> : $$x: écrit au milieu d\'une ligne refusé', function () {
  this.timeout(60000)

  for (const lang of ['css', 'scss']) {
    it(`${lang} — :host { $$brand: red; } : refusé, avec le nom et la ligne`, async () => {
      const r = await construire(`<style lang="${lang}">\n:host { $$brand: red; }\n</style>\n`)
      assert.match(r.msg, /\$\$brand/)
      assert.match(r.msg, /ligne/)
      assert.doesNotMatch(r.msg, /var\(--mjs-brand\)/)
    })

    it(`${lang} — témoin : $$brand: red; seul sur sa ligne déclare la variable`, async () => {
      const r = await construire(`<style lang="${lang}">\n:host {\n  $$brand: red;\n}\n</style>\n`)
      assert.equal(r.msg, '')
      assert.match(r.out, /--mjs-brand: ?red/)
    })
  }

  it('sass indenté — témoin : $$brand: red sous :host déclare la variable', async () => {
    const r = await construire('<style>\n:host\n  $$brand: red\n</style>\n')
    assert.equal(r.msg, '')
    assert.match(r.out, /--mjs-brand: ?red/)
  })
})
