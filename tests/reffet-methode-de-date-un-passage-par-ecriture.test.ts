// `µeffect -> $d.setHours($h)` : la méthode d'une Date rangée dans l'état, appelée dans un reffet, n'est pas une lecture de `$d` pour
// ce reffet. Il passe une fois au montage, puis une fois par écriture de `$h`, comme `$l.push($h)` sur une liste, sans boucle réactive
// ni effets suspendus. Vraie construction, mode strict

import assert from 'node:assert/strict'
import { terminateSharedWorkerPool } from '../src/bundler/index.js'
import { monterStrict } from './helpers/construction-stricte.js'

const DATE = `<script>
  $d = new Date(2026, 0, 1, 10)
  $h = 5
  window.__passages = 0
  µeffect ->
    window.__passages++
    $d.setHours($h)
  @regler = (v) -> $h = v
</script>
<p>{$h} h</p>
`

describe('méthode d\'une Date de l\'état dans un reffet (`$d.setHours($h)`) : un passage au montage, un par écriture de `$h`', function () {
  this.timeout(120000)
  let page: any

  before(async () => {
    page = await monterStrict('reffet-date', { 'reffet-date': DATE })
  })

  after(async () => {
    await page?.window.happyDOM.close()
    await terminateSharedWorkerPool()
  })

  it('montage puis `$h = 7` : deux passages, l\'heure de la date écrite, l\'écran redessiné, aucune boucle signalée', async () => {
    const e       = page.window.document.querySelector('mjs-reffet-date')
    const montage = page.window.__passages
    e.regler(7)
    await new Promise((r) => setTimeout(r, 80))
    const vu = { montage, apres: page.window.__passages, heure: e._state.d.getHours(), ecran: e._shadow.querySelector('p').textContent, boucle: page.console.filter((m: string) => /boucle/i.test(m)).length }
    assert.deepEqual(vu, { montage: 1, apres: 2, heure: 7, ecran: '7 h', boucle: 0 })
  })
})
