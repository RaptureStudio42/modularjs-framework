// <@@editor autofocus>, vrais navigateurs (Chromium, Firefox, WebKit), développement et production : avec plusieurs éditeurs `autofocus` qui se montrent
// ensemble, le PREMIER de la page prend le focus, comme les champs natifs (un éditeur désactivé est passé) ; ouverts ensemble par un clic (un {if}), c'est
// encore le premier des deux. Un éditeur montré ensuite sans geste (un {if} ouvert par un minuteur) prend le focus, même quand un autre éditeur le tient

import assert from 'node:assert/strict'
import { ouvrir, MOTEURS, BUILDS } from './helpers/editeur-riche.js'
import { terminateSharedWorkerPool } from '../src/bundler/index.js'

const SOURCE = `<script>
  $deux = false
  $tard = false

  µmount ->
    window.__ouvrir = -> $deux = true
    window.__plusTard = -> setTimeout((-> $tard = true), 30)
</script>

<button type="button" class="avant">avant</button>
<@@editor class="e0" toolbar="none" disabled autofocus value="<p>Zéro</p>"></@@editor>
<@@editor class="e1" toolbar="none" autofocus value="<p>Un</p>"></@@editor>
<@@editor class="e2" toolbar="none" autofocus value="<p>Deux</p>"></@@editor>
{if $deux}
  <@@editor class="e3" toolbar="none" autofocus value="<p>Trois</p>"></@@editor>
  <@@editor class="e4" toolbar="none" autofocus value="<p>Quatre</p>"></@@editor>
{end}
{if $tard}
  <@@editor class="e5" toolbar="none" autofocus value="<p>Cinq</p>"></@@editor>
{end}
`

const ATTENTE = `(() => { const H = document.querySelector('mjs-hote')?._shadow; return !!(H && H.querySelector('.e2')?._shadow?.querySelector('.surface p') && H.querySelector('.e1')?._shadow?.querySelector('.surface p')) })()`

const AIDES = `
window.__deep = () => { let a = document.activeElement; while (a && a._shadow && a._shadow.activeElement) a = a._shadow.activeElement; return (a && a.getRootNode().host ? (a.getRootNode().host.className || a.getRootNode().host.localName) + ' > ' : '') + (a ? (a.className || a.localName) : 'rien') }
`

for (const moteur of MOTEURS) {
  for (const build of BUILDS) {
    describe(`<@@editor autofocus> : le premier de la page prend le focus (${moteur} réel, ${build})`, function () {
      this.timeout(180000)
      let s: any = null
      after(async () => { await s?.fermer(); await terminateSharedWorkerPool() })

      before(async function () {
        s = await ouvrir(moteur, build, { source: SOURCE, cle: 'autofocus-premier-' + build, attente: ATTENTE, aides: AIDES })
        if (!s) this.skip()
      })

      it('trois éditeurs `autofocus` (le premier désactivé) : le focus est dans le premier qui peut le prendre', async () => {
        assert.equal(await s.page.evaluate('__deep()'), 'e1 > surface')
      })

      it('deux éditeurs `autofocus` ouverts ensemble par un clic : le premier des deux', async () => {
        await s.page.evaluate(`document.querySelector('mjs-hote')._shadow.querySelector('.avant').focus()`)
        await s.page.evaluate('__ouvrir()')
        await s.page.waitForFunction(`(() => !!document.querySelector('mjs-hote')._shadow.querySelector('.e4')?._shadow?.querySelector('.surface p'))()`)
        await s.page.waitForTimeout(300)
        assert.equal(await s.page.evaluate('__deep()'), 'e3 > surface')
        assert.deepEqual(s.logs.filter((l: string) => /PAGEERROR/.test(l)), [])
      })

      it('un éditeur `autofocus` montré plus tard sans geste (un minuteur) prend le focus que tient l\'éditeur montré avant lui', async () => {
        assert.equal(await s.page.evaluate('__deep()'), 'e3 > surface', 'le focus est dans un éditeur `autofocus`')
        await s.page.evaluate('__plusTard()')
        await s.page.waitForFunction(`(() => !!document.querySelector('mjs-hote')._shadow.querySelector('.e5')?._shadow?.querySelector('.surface p'))()`)
        await s.page.waitForFunction(`__deep() === 'e5 > surface'`, null, { timeout: 3000 }).catch(() => {})
        assert.equal(await s.page.evaluate('__deep()'), 'e5 > surface')
        assert.deepEqual(s.logs.filter((l: string) => /PAGEERROR/.test(l)), [])
      })
    })
  }
}
