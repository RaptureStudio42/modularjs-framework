// le refus d'un `await` au premier niveau du <script> cite la ligne de cet `await` : une forme sans nom simple (`{a, b} = await f()`,
// `window.cfg = await f()`, `console.log(await f())`) ou entre parenthèses (`x = (await f())`) se cherchait par sa forme écrite, que
// trouvait aussi un autre `await`, permis, écrit dans une fonction : le message citait la ligne de celui-là. Un bloc {await} du gabarit
// ne compte pas ; sans certitude, aucune ligne

import assert from 'node:assert/strict'
import { refus } from './helpers/derivee-await-refus.js'

const CAS: Array<[string, string, number]> = [
  ['décomposition', '<script>\n  f = -> Promise.resolve { a: 1, b: 2 }\n  x = 1\n  {a, b} = await f()\n  µmount ->\n    await f()\n</script>\n<p>x</p>\n', 4],
  ['membre', '<script>\n  f = -> Promise.resolve 1\n  window.cfg = await f()\n  go = ->\n    y = 1\n    await f()\n</script>\n<p>x</p>\n', 3],
  ['argument', '<script>\n  f = -> Promise.resolve 1\n  console.log(await f())\n  go = ->\n    await f()\n</script>\n<p>x</p>\n', 3],
  ['parenthèses', '<script>\n  f = -> Promise.resolve 1\n  x = (await f())\n  go = ->\n    x = await f()\n</script>\n<p>x</p>\n', 3],
  ['argument, avec un bloc {await} dans le gabarit', '<script>\n  f = -> Promise.resolve 1\n  go = ->\n    await f()\n  console.log(await f())\n</script>\n{await f()}<i>…</i>{success v}<b>{v}</b>{end}\n', 5],
]

describe('await au premier niveau du <script> : la ligne citée est celle de l\'await fautif', function () {
  this.timeout(60000)

  for (const [nom, source, ligne] of CAS) {
    it(`${nom} : ligne ${ligne}`, async () => {
      const message = await refus(source)
      assert.match(message, /au premier niveau du <script>/, message)
      assert.match(message, new RegExp(`'refus\\.mjs', ligne ${ligne} : « `), message)
    })
  }

  it('parenthèses : la forme dite est celle du code, x = await …', async () => {
    assert.match(await refus(CAS[3][1]), /ligne 3 : « x = await … »/)
  })
})
