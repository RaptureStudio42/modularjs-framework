// une valeur dérivée qui attend sans aucune variable `$` citée (`$moi = await charger()`) : une valeur qui attend, appelée une
// fois, au premier rendu, jamais rappelée par une autre écriture du composant ; écrite dans un `if` sans parenthèses, de même.
// Méthode : le vrai Bundler (développement), happy-dom, un faux `fetch` qui ne répond que sur ordre du test

import assert from 'node:assert/strict'
import { terminateSharedWorkerPool } from '../src/bundler/index.js'
import { construire, monter, repondre, demandes, texte, pause } from './helpers/derivee-await-banc.js'

const MOI = `<script>
  $n      = 0
  charger = -> fetch("/api/moi").then((r) -> r.json())
  $moi    = await charger()
  @plus   = -> $n = $n + 1
</script>
<i>{µpending($moi)}|{$n}</i><b>{($moi or {}).nom}</b>
`

describe('dérivée qui attend sans variable citée — appelée une fois', function () {
  this.timeout(60000)
  after(async () => { await terminateSharedWorkerPool() })

  it('$moi = await charger() : une valeur qui attend, qui ne suit aucune variable', async () => {
    const { unites } = await construire('await-sans-cite-compile', { 'moi.mjs': MOI })
    assert.match(unites, /µ\._mjs_setAwait\(_mjsThis, 'moi', async \(_mjs_sig\) => \(await charger\(\)\), \[\]\)/)
  })

  it('un seul appel, au premier rendu ; la réponse s\'affiche ; une autre écriture du composant ne rappelle rien', async () => {
    const w  = await monter('await-sans-cite', { 'moi.mjs': MOI }, '<mjs-moi></mjs-moi>')
    const el = w.document.querySelector('mjs-moi')
    assert.deepEqual(demandes(w), ['/api/moi'])
    assert.equal(texte(el, 'i'), 'true|0', 'en attente')
    await repondre(w, '/api/moi', { nom: 'Ada' })
    assert.equal(texte(el, 'b'), 'Ada')
    assert.equal(texte(el, 'i'), 'false|0')
    el.plus()
    await pause(60)
    assert.equal(texte(el, 'i'), 'false|1')
    assert.deepEqual(demandes(w), ['/api/moi'], 'aucun autre appel')
    w.close()
  })

  it('écrite dans un if sans parenthèses, sans variable citée : une valeur qui attend aussi', async () => {
    const { unites } = await construire('await-sans-cite-si', { 'si.mjs': `<script>\n  charger = (x) -> fetch("/api/si-#{x}").then((r) -> r.json())\n  $moi = if Math.random() < 2 then await charger(1) else await charger(2)\n</script>\n<i>{($moi or {}).nom}</i>\n` })
    assert.match(unites, /µ\._mjs_setAwait\(_mjsThis, 'moi', async \(_mjs_sig\) => \{/)
  })
})
