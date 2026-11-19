// `µpending($n)` et `µfailed($n)` sur une variable qui n'attend aucune réponse : refusés à la construction (dans le gabarit et le
// script, que le composant ait ou non une valeur qui attend), au lieu de « µ.pending is not a function » à l'affichage ; le message
// dit ce qu'elles lisent. Sur une valeur qui attend, elles lisent son état

import assert from 'node:assert/strict'
import { refus, compile } from './helpers/derivee-await-refus.js'

const SOURCE = (ligne: string, gabarit: string) => `<script>\n  $q = ''\n  $n = 1\n  f = (q) -> fetch("/api/o-#{q}").then((r) -> r.json())\n${ligne}</script>\n${gabarit}\n`

describe('µpending et µfailed sur une variable ordinaire : refusés', function () {
  this.timeout(60000)

  for (const [nom, source, forme] of [
    ['µpending($n) dans le gabarit, à côté d\'une valeur qui attend', SOURCE('  $r = await f($q)\n', '<i>{µpending($n)}</i>'), /« µpending\(\$n\) »/],
    ['µfailed($n) dans une méthode', SOURCE('  $r = await f($q)\n  @lire = -> µfailed($n)\n', '<i>{($r or []).length}</i>'), /« µfailed\(\$n\) »/],
    ['µpending($n) sans aucune valeur qui attend', SOURCE('', '<i>{µpending($n)}</i>'), /« µpending\(\$n\) »/],
  ] as Array<[string, string, RegExp]>) {
    it(nom + ' : refusé, le message dit ce qu\'elles lisent', async () => {
      const message = await refus(source)
      assert.match(message, forme, message)
      assert.match(message, /\$n n'attend aucune réponse/, message)
      assert.match(message, /« \$x = await … »/, message)
    })
  }

  it('sur une valeur qui attend : son attente et son erreur', async () => {
    const js = await compile(SOURCE('  $r = await f($q)\n  @lire = -> µfailed($r)\n', '<i>{µpending($r)}</i>'))
    assert.match(js, /µ\._mjs_awPending\(_mjsThis, 'r'\)/)
    assert.match(js, /µ\._mjs_awFailed\(_mjsThis, 'r'\)/)
  })
})
