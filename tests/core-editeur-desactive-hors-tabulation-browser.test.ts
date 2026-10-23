// module cœur editor (<@@editor>) et la touche Tab, vraies touches (Chromium, Firefox) : un éditeur en lecture seule reste atteignable (on y
// lit, on y sélectionne) ; un éditeur désactivé ne l'est jamais, même en lecture seule — comme un `<textarea readonly disabled>` natif, Tab
// passe par-dessus.

import assert from 'node:assert/strict'
import { ouvrir } from './helpers/editeur-riche.js'
import { terminateSharedWorkerPool } from '../src/bundler/index.js'

const SOURCE = `<button type="button" class="avant">avant</button>
<@@editor class="lecture" name="l" readonly toolbar="none" value="<p>lecture</p>"></@@editor>
<@@editor class="inerte" name="i" readonly disabled toolbar="none" value="<p>inerte</p>"></@@editor>
<@@editor class="eteint" name="d" disabled toolbar="none" value="<p>éteint</p>"></@@editor>
<button type="button" class="apres">après</button>
`
const ATTENTE = `(() => { const H = document.querySelector('mjs-hote')?._shadow; return !!(H && ['lecture', 'inerte', 'eteint'].every((c) => H.querySelector('.' + c)?._shadow?.querySelector('.surface p'))) })()`
const AIDES  = `
window.__deep = () => { let a = document.activeElement; while (a && (a._shadow || a.shadowRoot) && (a._shadow || a.shadowRoot).activeElement) a = (a._shadow || a.shadowRoot).activeElement; if (!a) return 'rien'; const h = a.getRootNode().host; return (h && h.classList.length ? h.classList[0] + ' ' : '') + a.tagName.toLowerCase() + '.' + a.className }
window.__tab = (c) => document.querySelector('mjs-hote')._shadow.querySelector('.' + c)._shadow.querySelector('.surface').getAttribute('tabindex')
`

for (const moteur of ['chromium', 'firefox'] as const) {
  describe(`mjs-core-editor — désactivé, hors de la tabulation (${moteur} réel)`, function () {
    this.timeout(120000)
    after(async () => { await terminateSharedWorkerPool() })

    it('Tab : du bouton « avant » à l\'éditeur en lecture seule, puis au bouton « après » — les éditeurs désactivés sont sautés', async function () {
      const s = await ouvrir(moteur, 'dev', { source: SOURCE, cle: 'editeur-tab-desactive', attente: ATTENTE, aides: AIDES })
      if (!s) { this.skip(); return }
      try {
        assert.deepEqual(await s.page.evaluate(`[__tab('lecture'), __tab('inerte'), __tab('eteint')]`), ['0', null, null])
        await s.page.evaluate(`document.querySelector('mjs-hote')._shadow.querySelector('.avant').focus()`)
        const vus: string[] = []
        for (let i = 0; i < 2; i++) {
          await s.page.keyboard.press('Tab')
          await s.page.waitForTimeout(80)
          vus.push(await s.page.evaluate(`__deep()`))
        }
        assert.deepEqual(vus, ['lecture div.surface', 'button.apres'])
      } finally {
        await s.fermer()
      }
    })
  })
}
