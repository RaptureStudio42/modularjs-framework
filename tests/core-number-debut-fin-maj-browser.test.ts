// module cœur number (<@@number min max>) au clavier, vraies touches (Chromium, Firefox) : Début et Fin seuls mènent au `min` et au `max` ;
// tenus avec Maj (sélectionner jusqu'au début ou jusqu'à la fin du texte), avec Ctrl ou avec Ctrl + Maj, ils gardent leur effet natif — la
// sélection se fait, la valeur et la frappe ne bougent pas, aucun `change` ne part.

import assert from 'node:assert/strict'
import { ouvrir } from './helpers/editeur-riche.js'
import { terminateSharedWorkerPool } from '../src/bundler/index.js'

const SOURCE = `<script>
  $b   = 5
  $chg = 0
</script>

<@@number class="borne" value=!{$b} min="0" max="10" @change={$chg++}></@@number>
<p class="b">{$b}</p>
<p class="chg">{$chg}</p>
`
const ATTENTE = `!!document.querySelector('mjs-hote')?._shadow?.querySelector('.borne')?._shadow?.querySelector('.input')`
const AIDES  = `
window.__in = () => document.querySelector('mjs-hote')._shadow.querySelector('.borne')._shadow.querySelector('.input')
window.__vu = () => { const i = __in(); const H = document.querySelector('mjs-hote')._shadow; return { texte: i.value, sel: [i.selectionStart, i.selectionEnd], b: H.querySelector('.b').textContent, chg: H.querySelector('.chg').textContent } }
window.__caret = (n) => { const i = __in(); i.focus(); i.setSelectionRange(n, n) }
`

for (const moteur of ['chromium', 'firefox'] as const) {
  describe(`mjs-core-number — Début et Fin avec Maj ou Ctrl (${moteur} réel)`, function () {
    this.timeout(120000)
    after(async () => { await terminateSharedWorkerPool() })

    it('Maj + Début, Ctrl + Maj + Fin, Ctrl + Début : la sélection native, la valeur reste 5 ; Début seul mène au min', async function () {
      const s = await ouvrir(moteur, 'dev', { source: SOURCE, cle: 'number-maj', attente: ATTENTE, aides: AIDES })
      if (!s) { this.skip(); return }
      try {
        await s.page.evaluate(`__caret(1)`)
        await s.page.keyboard.press('Shift+Home')
        await s.page.waitForTimeout(80)
        assert.deepEqual(await s.page.evaluate(`__vu()`), { texte: '5', sel: [0, 1], b: '5', chg: '0' }, 'Maj + Début')
        await s.page.evaluate(`__caret(0)`)
        await s.page.keyboard.press('Control+Shift+End')
        await s.page.waitForTimeout(80)
        assert.deepEqual(await s.page.evaluate(`__vu()`), { texte: '5', sel: [0, 1], b: '5', chg: '0' }, 'Ctrl + Maj + Fin')
        await s.page.evaluate(`__caret(1)`)
        await s.page.keyboard.press('Control+Home')
        await s.page.waitForTimeout(80)
        assert.deepEqual(await s.page.evaluate(`__vu()`), { texte: '5', sel: [0, 0], b: '5', chg: '0' }, 'Ctrl + Début')
        await s.page.keyboard.press('End')
        await s.page.waitForTimeout(80)
        const fin = await s.page.evaluate(`__vu()`)
        assert.equal(fin.b, '10', 'Fin seul mène au max')
        assert.equal(fin.chg, '1')
        assert.deepEqual(s.logs.filter((l) => /PAGEERROR/.test(l)), [])
      } finally {
        await s.fermer()
      }
    })
  })
}
