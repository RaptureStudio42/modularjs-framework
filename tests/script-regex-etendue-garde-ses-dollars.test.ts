// Une regex étendue `///…///` écrite sur plusieurs lignes dans le script garde ses `$` : `$y` y est l'ancre de fin suivie d'un `y`,
// jamais l'état `$.y` (la ligne d'après l'ouverture était lue comme du code) ; une regex étendue qui porte une interpolation `#{…}` se construit

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

const corps = 're = ///\n  ^ \\d+   # nombre\n  $y\n///\nok = re.test "12"\n$y = 2\n'

describe('script : regex étendue sur plusieurs lignes, ses $ restent du texte', function () {
  this.timeout(60000)

  for (const lang of ['', 'civet', 'coffee']) {
    it(`${lang || 'langage par défaut'} : /^\\d+$y/ sans $.y`, async () => {
      const r = await construire(`<script${lang ? ` lang="${lang}"` : ''}>\n${corps}</script>\n<p>a</p>\n`)
      assert.equal(r.msg, '')
      assert.ok(r.out.includes('/^\\d+$y/'), r.out.split('\n').filter((l) => l.includes('re =')).join('\n'))
      assert.ok(!/\$\.y\//.test(r.out))
    })
  }

  it('coffee — témoin : ///^#{$y}$/// (une interpolation dedans) se construit', async () => {
    const r = await construire('<script lang="coffee">\n$y = 2\nre = ///^#{$y}$///\nok = re.test "2"\n</script>\n<p>a</p>\n')
    assert.equal(r.msg, '')
  })
})
