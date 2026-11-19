// Une chaîne `"…"` Civet écrite sur plusieurs lignes garde son texte : une ligne `foo = bar` à l'intérieur n'est plus réécrite
// (« foo .= bar ») ; une regex qui porte une apostrophe n'ouvre pas de chaîne, l'affectation de la ligne suivante est déclarée

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

describe('sucre : chaîne sur plusieurs lignes laissée intacte', function () {
  this.timeout(60000)

  it('civet — "un / foo = bar / deux" garde foo = bar', async () => {
    const r = await construire('<script>\n$msg = "un\nfoo = bar\ndeux"\n</script>\n<p>{$msg}</p>\n')
    assert.equal(r.msg, '')
    assert.ok(r.out.includes('foo = bar'), r.out.split('\n').filter((l) => l.includes('foo')).join('\n'))
    assert.ok(!r.out.includes('.='))
  })

  it('civet — témoin : une regex à apostrophe puis total = 1 à la ligne suivante, total déclaré', async () => {
    const r = await construire('<script>\ns = "a\'b".replace /\'/g, "x"\ntotal = 1\n$n = total\n</script>\n<p>{$n}</p>\n')
    assert.equal(r.msg, '')
    assert.match(r.out, /let total|var total|const total|total = 1/)
  })
})
