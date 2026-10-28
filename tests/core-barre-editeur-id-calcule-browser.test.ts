// <@@editor id={…}> calculé dans un {for}, vrais navigateurs (Chromium, Firefox, WebKit), construction de développement et de production : l'`id` est un
// attribut de la balise de l'éditeur, comme écrit en dur ; la <@@toolbar for="…"> qui le vise (`for` calculé dans la ligne, ou fixe hors de la boucle) le
// trouve, ses boutons ne sont pas grisés, et un clic met en forme le texte de SON éditeur, pas celui de l'autre ligne

import assert from 'node:assert/strict'
import { ouvrir, MOTEURS, BUILDS } from './helpers/editeur-riche.js'
import { terminateSharedWorkerPool } from '../src/bundler/index.js'

const SOURCE = `<script>
  $notes = [{ key: 'a', html: '<p>Premier mot</p>' }, { key: 'b', html: '<p>Second mot</p>' }]
</script>

{for t in $notes by key}
  <@@toolbar data-t={'tb-' + t.key} for={'ck-' + t.key} tools="bold italic"></@@toolbar>
  <@@editor data-t={'ed-' + t.key} id={'ck-' + t.key} toolbar="none" value=!{t.html}></@@editor>
{end}
<@@toolbar data-t="tb-x" for="ck-b" tools="bold"></@@toolbar>
`

const ATTENTE = `(() => { const H = document.querySelector('mjs-hote')?._shadow; const q = (t) => H?.querySelector('[data-t="' + t + '"]'); return !!(q('ed-a')?._shadow?.querySelector('.surface p') && q('ed-b')?._shadow?.querySelector('.surface p') && q('tb-a')?._shadow?.querySelector('button') && q('tb-x')?._shadow?.querySelector('button')) })()`

const AIDES = `
window.__q = (t) => document.querySelector('mjs-hote')._shadow.querySelector('[data-t="' + t + '"]')
window.__btn = (t, n) => __q(t)._shadow.querySelector('[data-tool="' + n + '"]')
window.__html = (t) => __q(t)._shadow.querySelector('.surface').innerHTML
window.__sel = (t, txt) => {
  const sf = __q(t)._shadow.querySelector('.surface'); sf.focus()
  const w = document.createTreeWalker(sf, NodeFilter.SHOW_TEXT)
  let n
  while ((n = w.nextNode())) { const i = n.nodeValue.indexOf(txt); if (i >= 0) { document.getSelection().setBaseAndExtent(n, i, n, i + txt.length); return true } }
  return false
}
`

for (const moteur of MOTEURS) {
  for (const build of BUILDS) {
    describe(`<@@editor id={…}> calculé dans un {for}, visé par <@@toolbar for> (${moteur} réel, ${build})`, function () {
      this.timeout(180000)
      let s: any = null
      after(async () => { await s?.fermer(); await terminateSharedWorkerPool() })

      before(async function () {
        s = await ouvrir(moteur, build, { source: SOURCE, cle: 'barre-id-calcule-' + build, attente: ATTENTE, aides: AIDES })
        if (!s) this.skip()
        await s.page.waitForTimeout(250)
      })

      it('l\'id calculé est un attribut de la balise de chaque éditeur', async () => {
        assert.deepEqual(await s.page.evaluate(`[__q('ed-a').getAttribute('id'), __q('ed-b').getAttribute('id')]`), ['ck-a', 'ck-b'])
      })

      it('les barres trouvent leur éditeur : boutons actifs (for calculé dans la ligne, for fixe hors de la boucle)', async () => {
        assert.equal(await s.page.evaluate(`__btn('tb-a', 'bold').getAttribute('aria-disabled')`), 'false', 'barre de la ligne a')
        assert.equal(await s.page.evaluate(`__btn('tb-b', 'italic').getAttribute('aria-disabled')`), 'false', 'barre de la ligne b')
        assert.equal(await s.page.evaluate(`__btn('tb-x', 'bold').getAttribute('aria-disabled')`), 'false', 'barre hors de la boucle')
      })

      it('un clic met en forme le texte de son éditeur seulement', async () => {
        assert.ok(await s.page.evaluate(`__sel('ed-b', 'mot')`))
        await s.page.evaluate(`__btn('tb-b', 'bold').click()`)
        await s.page.waitForTimeout(100)
        assert.match(await s.page.evaluate(`__html('ed-b')`), /<(b|strong)>mot<\/(b|strong)>/)
        assert.doesNotMatch(await s.page.evaluate(`__html('ed-a')`), /<(b|strong)>/)
        assert.deepEqual(s.logs.filter((l: string) => /PAGEERROR|error/.test(l)), [])
      })
    })
  }
}
