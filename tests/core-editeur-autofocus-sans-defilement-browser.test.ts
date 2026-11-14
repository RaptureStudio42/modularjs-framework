// module cœur editor (<@@editor>), vrais navigateurs (Chromium, Firefox, WebKit) : le focus d'`autofocus` se pose sans rien faire défiler, comme
// celui que les autres modules du cœur donnent. Un éditeur `autofocus` posé par un `{if}` plus bas dans un conteneur qui défile, hors de sa vue,
// prend le focus et le conteneur garde sa position (avec ou sans `caret="end"`) ; plus bas que la fenêtre, la page ne défile pas non plus.
// La frappe qui suit le dit : la lettre tapée arrive dans l'éditeur (le navigateur montre alors le curseur, c'est la frappe qui fait défiler :
// chaque cas repart donc de la même position).

import assert from 'node:assert/strict'
import { ouvrir } from './helpers/editeur-riche.js'
import { terminateSharedWorkerPool } from '../src/bundler/index.js'

const SOURCE = `<script>
  $boite = false
  $fin   = false
  $page  = false

  µmount ->
    window.__ouvrir = (k)->
      if k == 'boite' then $boite = true
      else if k == 'fin' then $fin = true
      else $page = true
</script>

<button type="button" class="avant">avant</button>
<div class="defile">
  <div class="haut"></div>
  {if $boite}
    <@@editor class="boite" name="boite" toolbar="none" autofocus value="<p>Texte</p>"></@@editor>
  {end}
  {if $fin}
    <@@editor class="fin" name="fin" toolbar="none" autofocus caret="end" value="<p>Texte</p>"></@@editor>
  {end}
  <div class="bas"></div>
</div>
<div class="loin"></div>
{if $page}
  <@@editor class="page" name="page" toolbar="none" autofocus value="<p>Texte</p>"></@@editor>
{end}

<style>
  .defile
    height: 200px
    overflow: auto
  .haut
    height: 600px
  .bas
    height: 600px
  .loin
    height: 3000px
</style>
`

const ATTENTE = `!!document.querySelector('mjs-hote')?._shadow?.querySelector('.defile')`

const AIDES = `
window.__H = () => document.querySelector('mjs-hote')._shadow
window.__boite = () => __H().querySelector('.defile')
window.__val = (c) => __H().querySelector('.' + c).querySelector(':scope > input[type=hidden]').value
window.__deep = () => { let a = document.activeElement; while (a && (a._shadow || a.shadowRoot) && (a._shadow || a.shadowRoot).activeElement) a = (a._shadow || a.shadowRoot).activeElement; if (!a) return 'rien'; const h = a.getRootNode().host; return (h && h.classList.length ? h.classList[0] + ' ' : '') + a.tagName.toLowerCase() + '.' + a.className }
window.__avant = () => __H().querySelector('.avant').focus()
`

for (const moteur of ['chromium', 'firefox', 'webkit'] as const) {
  describe(`mjs-core-editor — autofocus sans défilement (${moteur} réel)`, function () {
    this.timeout(180000)
    let s: any = null
    after(async () => { await s?.fermer(); await terminateSharedWorkerPool() })

    before(async function () {
      s = await ouvrir(moteur, 'dev', { source: SOURCE, cle: 'editeur-autofocus-defilement', attente: ATTENTE, aides: AIDES })
      if (!s) this.skip()
    })

    // l'éditeur posé par un `{if}`, le focus d'abord sur le bouton « avant » (celui qui ouvre, dans une vraie page), le conteneur défilé à 185 px et
    // la page en haut ; la position du conteneur et celle de la page, une fois l'éditeur montré
    const poser = async (k: string): Promise<number[]> => {
      await s.page.evaluate(`__avant(); __boite().scrollTop = 185; window.scrollTo(0, 0)`)
      assert.deepEqual(await s.page.evaluate(`[__boite().scrollTop, window.scrollY]`), [185, 0], 'position de départ')
      await s.page.evaluate(`__ouvrir('${k}')`)
      await s.page.waitForFunction(`!!__H().querySelector('.${k}')?._shadow?.querySelector('.surface p')`, null, { timeout: 10000 })
      await s.page.waitForTimeout(250)
      return s.page.evaluate(`[__boite().scrollTop, window.scrollY]`)
    }

    const taper = async (c: string, lettre: string): Promise<string> => {
      await s.page.keyboard.type(lettre)
      await s.page.waitForTimeout(120)
      return s.page.evaluate(`__val('${c}')`)
    }

    it('conteneur qui défile, éditeur posé plus bas hors de sa vue : le focus est dans l\'éditeur, le conteneur garde sa position', async () => {
      assert.deepEqual(await poser('boite'), [185, 0], 'ni le conteneur ni la page ne défilent')
      assert.equal(await s.page.evaluate(`__deep()`), 'boite div.surface')
      assert.equal(await taper('boite', 'Z'), '<p>ZTexte</p>')
    })

    it('même chose avec `caret="end"` : le curseur à la fin du texte, le conteneur toujours à sa place', async () => {
      assert.deepEqual(await poser('fin'), [185, 0], 'ni le conteneur ni la page ne défilent')
      assert.equal(await s.page.evaluate(`__deep()`), 'fin div.surface')
      assert.equal(await taper('fin', 'Y'), '<p>TexteY</p>')
    })

    it('éditeur posé plus bas que la fenêtre : le focus est dans l\'éditeur, la page ne défile pas', async () => {
      assert.deepEqual(await poser('page'), [185, 0], 'la page reste en haut')
      assert.equal(await s.page.evaluate(`__deep()`), 'page div.surface')
    })

    it('aucune erreur dans la console', () => {
      assert.deepEqual(s.logs.filter((l: string) => !/favicon/.test(l)), [])
    })
  })
}
