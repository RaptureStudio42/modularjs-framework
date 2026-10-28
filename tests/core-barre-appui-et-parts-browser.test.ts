// <@@toolbar> et la barre que <@@editor> intègre, vrais navigateurs (Chromium, Firefox, WebKit) : ce que la page peut styler par `::part`.
// - la barre intégrée expose ses pièces sous le nom de l'éditeur : `toolbar-bar` (la barre) et `toolbar-button` (chaque bouton) ;
// - la ligne du lien expose ses boutons : `link-button` (les trois), puis `link-apply`, `link-remove` et `link-cancel` (chacun le sien) ;
// - un bouton de barre enfoncé (souris, doigt, stylet) porte aussi la part `down` jusqu'au relâchement, où qu'il ait lieu : Firefox n'allume jamais `:active`
//   sur ces boutons (la barre annule le `mousedown` pour garder la sélection du texte), `down` donne le même retour d'appui dans les trois moteurs ; la
//   sélection reste gardée, et un bouton grisé ne s'enfonce pas.

import assert from 'node:assert/strict'
import { ouvrir } from './helpers/editeur-riche.js'
import { terminateSharedWorkerPool } from '../src/bundler/index.js'

const SOURCE = `<script>
  $texte = '<p>Un mot à graisser</p>'
  $deux  = '<p>Deux <a href="https://exemple.fr">lien</a></p>'
</script>

<@@toolbar class="tb" for="e1"></@@toolbar>
<@@editor id="e1" class="e1" toolbar="none" value=!{$texte}></@@editor>
<@@editor class="e2" toolbar="bold undo link" value={$deux}></@@editor>
<pre class="o1">{$texte}</pre>
`

const ATTENTE = `(() => { const H = document.querySelector('mjs-hote')?._shadow; const b = H?.querySelector('.tb')?._shadow?.querySelector('button'); const d = H?.querySelector('.e2')?._shadow?.querySelector('mjs-core-toolbar')?._shadow?.querySelector('button'); return !!(b && d && H.querySelector('.e1')?._shadow?.querySelector('.surface p')) })()`

// les couleurs que la page donne par `::part` : rouge pour une pièce, bleu pour un bouton enfoncé, des fonds propres à chaque bouton du lien
const STYLE = `
mjs-core-toolbar::part(button down) { color: rgb(0, 0, 255) }
mjs-core-editor::part(toolbar-bar) { background-color: rgb(0, 128, 0) }
mjs-core-editor::part(toolbar-button) { color: rgb(255, 0, 0) }
mjs-core-editor::part(toolbar-button down) { color: rgb(0, 0, 255) }
mjs-core-editor::part(link-button) { color: rgb(255, 0, 0) }
mjs-core-editor::part(link-apply) { background-color: rgb(1, 2, 3) }
mjs-core-editor::part(link-remove) { background-color: rgb(4, 5, 6) }
mjs-core-editor::part(link-cancel) { background-color: rgb(7, 8, 9) }
`

const AIDES = `
window.__H = () => document.querySelector('mjs-hote')._shadow
window.__ed = (c) => __H().querySelector('.' + c)
window.__sf = (c) => __ed(c)._shadow.querySelector('.surface')
window.__btn = (c, t) => (c === 'tb' ? __H().querySelector('.tb') : __ed(c)._shadow.querySelector('mjs-core-toolbar'))._shadow.querySelector('[data-tool="' + t + '"]')
window.__barre = (c) => __ed(c)._shadow.querySelector('mjs-core-toolbar')._shadow.querySelector('.bar')
window.__lien = (cls) => __ed('e2')._shadow.querySelector('.link .' + cls)
window.__couleur = (el) => el ? getComputedStyle(el).color : 'absent'
window.__fond = (el) => el ? getComputedStyle(el).backgroundColor : 'absent'
window.__center = (el) => { el.scrollIntoView({ block: 'center' }); const r = el.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 } }
window.__selText = (c, txt) => {
  const sf = __sf(c); sf.focus()
  const w = document.createTreeWalker(sf, NodeFilter.SHOW_TEXT)
  let n
  while ((n = w.nextNode())) { const i = n.nodeValue.indexOf(txt); if (i >= 0) { document.getSelection().setBaseAndExtent(n, i, n, i + txt.length); return true } }
  return false
}
{ const st = document.createElement('style'); st.textContent = ${JSON.stringify(STYLE)}; __H().appendChild(st) }
`

const ROUGE = 'rgb(255, 0, 0)'
const BLEU  = 'rgb(0, 0, 255)'

for (const moteur of ['chromium', 'firefox', 'webkit'] as const) {
  describe(`mjs-core-toolbar et mjs-core-editor — parts et appui visible (${moteur} réel)`, function () {
    this.timeout(180000)
    let s: any = null
    after(async () => { await s?.fermer(); await terminateSharedWorkerPool() })

    before(async function () {
      s = await ouvrir(moteur, 'dev', { source: SOURCE, cle: 'barre-appui-parts', attente: ATTENTE, aides: AIDES })
      if (!s) this.skip()
    })

    // un appui de la souris tenu sur un bouton : la couleur du bouton pendant l'appui, puis après le relâchement (sur le bouton, ou ailleurs)
    const appui = async (bouton: string, ailleurs = false): Promise<[string, string]> => {
      const c = await s.page.evaluate(`__center(${bouton})`)
      await s.page.mouse.move(c.x, c.y)
      await s.page.mouse.down()
      await s.page.waitForTimeout(60)
      const pendant = await s.page.evaluate(`__couleur(${bouton})`)
      if (ailleurs) await s.page.mouse.move(c.x, c.y + 300, { steps: 4 })
      await s.page.mouse.up()
      await s.page.waitForTimeout(60)
      return [pendant, await s.page.evaluate(`__couleur(${bouton})`)]
    }

    it('barre intégrée : la barre et ses boutons se stylent par `::part(toolbar-bar)` et `::part(toolbar-button)`', async () => {
      assert.equal(await s.page.evaluate(`__fond(__barre('e2'))`), 'rgb(0, 128, 0)', 'fond de la barre')
      assert.equal(await s.page.evaluate(`__couleur(__btn('e2', 'bold'))`), ROUGE, 'bouton gras')
      assert.equal(await s.page.evaluate(`__couleur(__btn('e2', 'link'))`), ROUGE, 'bouton lien')
    })

    it('barre posée à part : un bouton enfoncé porte la part `down` pendant l\'appui, et la sélection du texte est gardée', async () => {
      assert.ok(await s.page.evaluate(`__selText('e1', 'mot')`))
      const [pendant, apres] = await appui(`__btn('tb', 'bold')`)
      assert.equal(pendant, BLEU, 'pendant l\'appui')
      assert.notEqual(apres, BLEU, 'après le relâchement')
      assert.match(await s.page.evaluate(`__H().querySelector('.o1').textContent`), /<strong>mot<\/strong>/, 'le clic a mis en gras la sélection')
    })

    it('relâché hors du bouton : la part `down` tombe aussi', async () => {
      const [pendant, apres] = await appui(`__btn('tb', 'italic')`, true)
      assert.equal(pendant, BLEU, 'pendant l\'appui')
      assert.notEqual(apres, BLEU, 'après le relâchement hors du bouton')
    })

    it('barre intégrée : `::part(toolbar-button down)` pendant l\'appui ; un bouton grisé ne s\'enfonce pas', async () => {
      assert.equal(await s.page.evaluate(`__btn('e2', 'undo').getAttribute('aria-disabled')`), 'true', 'défaire est grisé (rien à défaire)')
      const [grise] = await appui(`__btn('e2', 'undo')`)
      assert.equal(grise, ROUGE, 'défaire grisé, pendant l\'appui')
      const [pendant, apres] = await appui(`__btn('e2', 'bold')`)
      assert.equal(pendant, BLEU, 'gras, pendant l\'appui')
      assert.equal(apres, ROUGE, 'gras, après le relâchement')
    })

    it('ligne du lien : ses trois boutons se stylent par `::part(link-button)`, chacun par sa part propre', async () => {
      await s.page.evaluate(`(() => { const sf = __sf('e2'); sf.focus(); const t = sf.querySelector('a').firstChild; document.getSelection().setBaseAndExtent(t, 2, t, 2) })()`)
      const c = await s.page.evaluate(`__center(__btn('e2', 'link'))`)
      await s.page.mouse.click(c.x, c.y)
      await s.page.waitForTimeout(150)
      const vu = await s.page.evaluate(`['link-ok', 'link-no', 'link-x'].map((k) => [__couleur(__lien(k)), __fond(__lien(k))])`)
      assert.deepEqual(vu, [[ROUGE, 'rgb(1, 2, 3)'], [ROUGE, 'rgb(4, 5, 6)'], [ROUGE, 'rgb(7, 8, 9)']])
      await s.page.keyboard.press('Escape')
    })

    it('aucune erreur dans la console', () => {
      assert.deepEqual(s.logs.filter((l: string) => !/favicon/.test(l)), [])
    })
  })
}
