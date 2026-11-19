// un `await` écrit seulement dans une fonction que contient l'expression (`$x = $l.map((i) -> await f(i))`) ne fait pas une valeur
// qui attend : l'expression elle-même n'attend rien, la valeur dérivée reste ordinaire (une liste de promesses, comme en JavaScript)

import assert from 'node:assert/strict'
import { compile } from './helpers/derivee-await-refus.js'

describe('dérivée — un await dans une fonction de l\'expression n\'en fait pas une valeur qui attend', function () {
  this.timeout(60000)

  it('$x = $l.map((i) -> await f(i)) : une valeur dérivée ordinaire', async () => {
    const js = await compile(`<script>\n  $l = [1, 2]\n  f = (i) -> fetch("/api/f-#{i}").then((r) -> r.json())\n  $x = $l.map((i) -> await f(i))\n</script>\n<i>{$x.length}</i>\n`)
    assert.doesNotMatch(js, /_mjs_setAwait/, 'aucune valeur qui attend')
    assert.match(js, /µ\._mjs_setComputed\(_mjsThis, 'x', \(\) => \(\$\.l\.map\(async function\(i\)/)
  })

  it('l\'await de l\'expression elle-même en fait toujours une', async () => {
    const js = await compile(`<script>\n  $l = [1, 2]\n  f = (i) -> fetch("/api/f-#{i}").then((r) -> r.json())\n  $x = await Promise.all($l.map((i) -> await f(i)))\n</script>\n<i>{($x or []).length}</i>\n`)
    assert.match(js, /µ\._mjs_setAwait\(_mjsThis, 'x', async \(_mjs_sig\) =>/)
  })
})
