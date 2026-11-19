// `µsignal` est le signal de l'appel d'une valeur qui attend (ou d'un bloc {await}), lu dans son expression ; écrit ailleurs (une
// fonction locale, un gestionnaire, le gabarit hors d'un bloc {await}), il ne valait rien et rien n'était coupé, sans un mot : refusé
// à la construction, le message dit de le passer en argument. Dans l'expression, il reste le signal de l'appel

import assert from 'node:assert/strict'
import { refus, compile } from './helpers/derivee-await-refus.js'

const G = '  g = (q) -> fetch("/api/g-#{q}", { signal: µsignal })\n'

describe('µsignal hors de l\'expression d\'une valeur qui attend : refusé', function () {
  this.timeout(60000)

  for (const [nom, source] of [
    ['une fonction locale appelée par une valeur qui attend', `<script>\n  $q = ''\n${G}  $r = await g($q)\n</script>\n<i>{($r or []).length}</i>\n`],
    ['une fonction locale, sans valeur qui attend', `<script>\n  $q = ''\n${G}  @go = -> g($q)\n</script>\n<i>{$q}</i>\n`],
    ['le gabarit, hors d\'un bloc {await}', `<script>\n  $q = ''\n</script>\n<i>{µsignal}</i>\n`],
  ] as Array<[string, string]>) {
    it(nom + ' : refusé, le message dit de le passer en argument', async () => {
      const message = await refus(source)
      assert.match(message, /« µsignal » se lit dans l'expression d'une valeur qui attend/, message)
      assert.match(message, /passez-le en argument/, message)
    })
  }

  it('dans l\'expression d\'une valeur qui attend et d\'un bloc {await} : le signal de l\'appel', async () => {
    const js = await compile(`<script>\n  $q = ''\n  g = (q, signal) -> fetch("/api/g-#{q}", { signal })\n  $r = await g($q, µsignal)\n</script>\n<i>{($r or []).length}</i>{await g($q, µsignal)}<b>…</b>{success v}<b>{v}</b>{end}\n`)
    assert.match(js, /µ\._mjs_setAwait\(_mjsThis, 'r', async \(_mjs_sig\) => \(await g\(\$\.q, _mjs_sig\)\)/)
    assert.doesNotMatch(js, /µ\.signal/)
  })
})
