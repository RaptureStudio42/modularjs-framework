// <@@editor colors="…"> et le bouton `color` de <@@toolbar>, vrais navigateurs (Chromium, Firefox, WebKit), développement et production :
// - le bouton n'existe que pour un éditeur qui a une palette, dans la barre intégrée comme dans une barre posée à part ;
// - il ouvre une ligne sous la barre : un bouton par couleur, puis « Aucune couleur » ; la couleur du texte choisi y est enfoncée et prend le focus,
//   les flèches, Début et Fin passent d'un bouton à l'autre, Entrée ou un clic colore la sélection, Échap ferme sans rien changer ; le focus revient au texte,
//   le lecteur d'écran entend le nom de la couleur ;
// - le HTML ne porte que `<span data-color>` ; la couleur rendue est celle du thème (`--mjs-editor-color-<nom>`), jamais un style en ligne ; une partie d'un
//   texte coloré est coupée de sa couleur, un curseur sans sélection colore son mot, « Effacer la mise en forme » retire aussi la couleur ;
// - le bouton est enfoncé quand la sélection est colorée ; un collage garde la couleur de la palette et retire les autres

import assert from 'node:assert/strict'
import { ouvrir, MOTEURS, BUILDS } from './helpers/editeur-riche.js'
import { terminateSharedWorkerPool } from '../src/bundler/index.js'

const SOURCE = `<script>
  $texte = '<p>Un mot rouge et vert</p>'
  $deux  = '<p>Deux <span data-color="green">verts</span> ici</p>'
</script>

<@@editor class="e1" colors="red green" value=!{$texte}></@@editor>
<@@toolbar class="tb" for="e2"></@@toolbar>
<@@editor id="e2" class="e2" colors="red green" toolbar="none" value=!{$deux}></@@editor>
<@@editor class="e3" value="<p>Sans palette</p>"></@@editor>
<pre class="o1">{$texte}</pre>
<pre class="o2">{$deux}</pre>
`

const ATTENTE = `(() => { const H = document.querySelector('mjs-hote')?._shadow; return !!(H && H.querySelector('.e1')?._shadow?.querySelector('mjs-core-toolbar')?._shadow?.querySelector('[data-tool="color"]') && H.querySelector('.tb')?._shadow?.querySelector('[data-tool="color"]') && H.querySelector('.e2')?._shadow?.querySelector('.surface p')) })()`

const AIDES = `
window.__H = () => document.querySelector('mjs-hote')._shadow
window.__ed = (c) => __H().querySelector('.' + c)
window.__sf = (c) => __ed(c)._shadow.querySelector('.surface')
window.__btn = (c, t) => (c === 'tb' ? __H().querySelector('.tb') : __ed(c)._shadow.querySelector('mjs-core-toolbar'))?._shadow?.querySelector('[data-tool="' + t + '"]') ?? null
window.__hues = (c) => __ed(c)._shadow.querySelector('.hues')
window.__hue = (c, txt) => Array.from(__hues(c).querySelectorAll('button')).find((b) => b.textContent.trim() === txt)
window.__o = (n) => __H().querySelector('.o' + n).textContent
window.__deep = () => { let a = document.activeElement; while (a && a._shadow && a._shadow.activeElement) a = a._shadow.activeElement; return a }
window.__lieu = () => { const a = __deep(); return (a && a.getRootNode().host ? a.getRootNode().host.className + ' > ' : '') + (a ? (a.className || a.textContent.trim()) : 'rien') }
window.__center = (el) => { el.scrollIntoView({ block: 'center' }); const r = el.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 } }
window.__selText = (c, txt, at) => {
  const sf = __sf(c); sf.focus()
  const w = document.createTreeWalker(sf, NodeFilter.SHOW_TEXT)
  let n
  while ((n = w.nextNode())) { const i = n.nodeValue.indexOf(txt); if (i >= 0) { if (at === undefined) document.getSelection().setBaseAndExtent(n, i, n, i + txt.length); else document.getSelection().setBaseAndExtent(n, i + at, n, i + at); return true } }
  return false
}
window.__span = (c, txt) => Array.from(__sf(c).querySelectorAll('[data-color]')).find((s) => s.textContent === txt) ?? null
window.__coller = (c, html) => { const dt = new DataTransfer(); dt.setData('text/html', html); dt.setData('text/plain', 'x'); let vu = null; const f = (e) => { vu = e.clipboardData ? e.clipboardData.getData('text/html') : 'sans clipboardData' }; __sf(c).addEventListener('paste', f, true); __sf(c).dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true, composed: true })); __sf(c).removeEventListener('paste', f, true); return vu }
{ const st = document.createElement('style'); st.textContent = 'mjs-core-editor { --mjs-editor-color-red: rgb(200, 0, 0); --mjs-editor-color-green: rgb(0, 150, 0) }'; __H().appendChild(st) }
`

for (const moteur of MOTEURS) {
  for (const build of BUILDS) {
    describe(`<@@editor colors> : la couleur du texte (${moteur} réel, ${build})`, function () {
      this.timeout(180000)
      let s: any = null
      after(async () => { await s?.fermer(); await terminateSharedWorkerPool() })

      before(async function () {
        s = await ouvrir(moteur, build, { source: SOURCE, cle: 'editeur-couleur-' + build, attente: ATTENTE, aides: AIDES })
        if (!s) this.skip()
      })

      const ev  = (code: string): Promise<any> => s.page.evaluate(code)
      const pause = (ms = 120) => s.page.waitForTimeout(ms)
      const cliquer = async (code: string) => { const c = await ev(`__center(${code})`); await s.page.mouse.click(c.x, c.y); await pause() }
      const ouvrirCouleurs = async (barre: string, ed: string) => { await ev(`__btn('${barre}', 'color').click()`); await s.page.waitForFunction(`!!__hues('${ed}')`); await pause() }

      it('le bouton existe avec une palette (barre intégrée, barre à part), pas sans elle', async () => {
        assert.deepEqual(await ev(`[__btn('e1', 'color')?.getAttribute('aria-label'), __btn('e1', 'color')?.getAttribute('aria-pressed'), !!__btn('tb', 'color'), __btn('e3', 'color') === null, !!__btn('e3', 'bold')]`), ['Couleur du texte', 'false', true, true, true])
      })

      it('clavier : la ligne des couleurs prend le focus, Début puis Entrée colore la sélection ; couleur du thème, focus rendu, nom annoncé', async () => {
        assert.ok(await ev(`__selText('e1', 'mot')`))
        await ouvrirCouleurs('e1', 'e1')
        assert.deepEqual(await ev(`Array.from(__hues('e1').querySelectorAll('button')).map((b) => b.textContent.trim() + ':' + b.getAttribute('aria-pressed'))`), ['Rouge:false', 'Vert:false', 'Aucune couleur:true'])
        assert.equal(await ev('__lieu()'), 'e1 > Aucune couleur')
        await s.page.keyboard.press('Home')
        assert.equal(await ev('__lieu()'), 'e1 > Rouge')
        await s.page.keyboard.press('Enter')
        await pause(200)
        assert.match(await ev(`__o(1)`), /Un <span data-color="red">mot<\/span> rouge/)
        assert.equal(await ev(`getComputedStyle(__span('e1', 'mot')).color`), 'rgb(200, 0, 0)')
        assert.equal(await ev(`__span('e1', 'mot').hasAttribute('style')`), false)
        assert.equal(await ev('__lieu()'), 'e1 > surface')
        assert.equal(await ev(`!!__hues('e1')`), false, 'la ligne est fermée')
        assert.equal(await ev(`__btn('e1', 'color').getAttribute('aria-pressed')`), 'true', 'bouton enfoncé sur la sélection colorée')
        assert.equal(await ev(`__ed('e1')._shadow.querySelector('.live').textContent`), 'Rouge')
      })

      it('souris : une autre couleur remplace la première', async () => {
        assert.ok(await ev(`__selText('e1', 'mot')`))
        await ouvrirCouleurs('e1', 'e1')
        assert.equal(await ev('__lieu()'), 'e1 > Rouge', 'la couleur de la sélection a le focus')
        await cliquer(`__hue('e1', 'Vert')`)
        assert.match(await ev(`__o(1)`), /Un <span data-color="green">mot<\/span> rouge/)
        assert.doesNotMatch(await ev(`__o(1)`), /data-color="red"/)
      })

      it('barre à part : une partie d\'un texte coloré est coupée de sa couleur', async () => {
        assert.ok(await ev(`__selText('e2', 'ver')`))
        await ouvrirCouleurs('tb', 'e2')
        await cliquer(`__hue('e2', 'Rouge')`)
        assert.equal(await ev(`__o(2)`), '<p>Deux <span data-color="red">ver</span><span data-color="green">ts</span> ici</p>')
      })

      it('« Aucune couleur » retire la couleur', async () => {
        assert.ok(await ev(`__selText('e2', 'ts')`))
        await ouvrirCouleurs('tb', 'e2')
        await cliquer(`__hue('e2', 'Aucune couleur')`)
        assert.equal(await ev(`__o(2)`), '<p>Deux <span data-color="red">ver</span>ts ici</p>')
      })

      it('Échap ferme sans rien changer, la sélection reste', async () => {
        assert.ok(await ev(`__selText('e2', 'Deux')`))
        await ouvrirCouleurs('tb', 'e2')
        await s.page.keyboard.press('Escape')
        await pause()
        assert.deepEqual(await ev(`[!!__hues('e2'), __lieu(), String(document.getSelection())]`), [false, 'e2 > surface', 'Deux'])
        assert.equal(await ev(`__o(2)`), '<p>Deux <span data-color="red">ver</span>ts ici</p>')
      })

      it('un curseur sans sélection colore son mot', async () => {
        assert.ok(await ev(`__selText('e1', 'rouge', 2)`))
        await ouvrirCouleurs('e1', 'e1')
        await cliquer(`__hue('e1', 'Rouge')`)
        assert.match(await ev(`__o(1)`), / <span data-color="red">rouge<\/span> et vert/)
      })

      it('« Effacer la mise en forme » retire aussi la couleur', async () => {
        assert.ok(await ev(`__selText('e1', 'rouge')`))
        await ev(`__btn('e1', 'clear').click()`)
        await pause(200)
        assert.match(await ev(`__o(1)`), / rouge et vert/)
        assert.doesNotMatch(await ev(`__o(1)`), /data-color="red"/)
      })

      it('un collage garde la couleur de la palette et retire les autres', async function () {
        // Firefox ne remet pas au gestionnaire le `clipboardData` d'un collage fabriqué par le test (`getData('text/html')` y est vide) : le même
        // nettoyeur est vérifié sans navigateur (core-editeur-couleur-texte.test.ts)
        if (moteur === 'firefox') this.skip()
        assert.ok(await ev(`__selText('e1', 'vert', 4)`))
        assert.match(await ev(`__coller('e1', '<p> A <span data-color="red">B</span> <span data-color="blue">C</span> <span style="color:red">D</span> <font color="green">E</font></p>')`), /data-color="red"/, 'le gestionnaire reçoit le HTML collé')
        await pause(200)
        assert.match(await ev(`__o(1)`), /vert ?A <span data-color="red">B<\/span> C D E<\/p>$/)
        assert.deepEqual(s.logs.filter((l: string) => /PAGEERROR/.test(l)), [])
      })
    })
  }
}
