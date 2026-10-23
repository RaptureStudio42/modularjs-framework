// {{…}} — une valeur null ou undefined n'affiche rien, comme {…} : le HTML brut écrivait le texte « null » ou « undefined »
// au premier rendu comme après un changement.

import assert from 'node:assert/strict'
import { monterHote, pause } from './helpers/coeur-monter.js'
import { terminateSharedWorkerPool } from '../src/bundler/index.js'

const HOTE = `<script>
  $a = null
  $b = undefined
  $c = '<b>x</b>'
</script>
<div class="a">{{$a}}</div><div class="b">{{$b}}</div><div class="c">{{$c}}</div>
`

describe('{{…}} — null et undefined n\'affichent rien', function () {
  this.timeout(60000)
  let window: any

  after(async () => {
    window?.close?.()
    await terminateSharedWorkerPool()
  })

  it('au premier rendu puis quand la valeur redevient vide', async () => {
    const monte = await monterHote(HOTE, 'html-brut-vide')
    window      = monte.window
    const sh    = monte.hote._shadow
    assert.equal(sh.querySelector('.a').textContent, '')
    assert.equal(sh.querySelector('.b').textContent, '')
    assert.equal(sh.querySelector('.c').textContent, 'x')
    monte.hote._set('c', null)
    await pause(60)
    assert.equal(sh.querySelector('.c').textContent, '')
    monte.hote._set('c', undefined)
    monte.hote._set('a', '<i>y</i>')
    await pause(60)
    assert.equal(sh.querySelector('.c').textContent, '')
    assert.equal(sh.querySelector('.a').textContent, 'y')
    assert.deepEqual(Array.from(monte.erreurs), [])
  })
})
