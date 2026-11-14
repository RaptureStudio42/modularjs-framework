// <@@virtual> dans Chromium, Firefox et WebKit réels : une liste relivrée sans changement (mêmes lignes, mêmes clés, mêmes hauteurs) garde sa
// place sans écrire le défilement. Sous WebKit, écrire le défilement, même à sa propre valeur, arrête un défilement animé en cours : une page
// qui relivre la liste à chaque fenêtre rendue (`start=!{…} end=!{…}`) coupait la touche Fin quelques centaines de pixels plus bas

import assert from 'node:assert/strict'
import { construire, essayer, navigateurPresent, NAVIGATEURS } from './helpers/sortable-navigateur.js'
import { terminateSharedWorkerPool } from '../src/bundler/index.js'

const PAGE = `<script>
  haut    = (i) -> 20 + (i * 37) % 201
  $lignes = µraw(Array.from({ length: 5000 }, (_, i) -> ({ id: i, h: haut(i) })))
  $debut  = 0
  $fin    = 20

  @relivrer = -> $lignes = µraw($lignes.slice())
</script>

<@@virtual class="vl" items={$lignes} key="id" size="40" start=!{$debut} end=!{$fin} aria-label="Lignes">
  {for p in $lignes.slice($debut, $fin) by id}
    <div class="ligne" data-id={p.id} --h={p.h + 'px'}>{p.id}</div>
  {end}
</@@virtual>

<style>
  :host
    display: block
  .vl
    width: 300px
    height: 400px
  .ligne
    box-sizing: border-box
    height: var(--h)
</style>
`

// les écritures du défilement de la liste, relevées sur sa zone qui défile ; la ligne du haut et sa place
const SONDE = `window.__vp = () => document.querySelector('mjs-vl-relivree')._shadow.querySelector('mjs-core-virtual')._shadow.querySelector('.viewport')
window.__images = (n) => new Promise((ok) => { const f = () => (n-- > 0 ? requestAnimationFrame(f) : ok()); f() })
window.__ecoute = () => { const vp = __vp(), d = Object.getOwnPropertyDescriptor(Element.prototype, 'scrollTop'); window.__ecrits = []; Object.defineProperty(vp, 'scrollTop', { configurable: true, get() { return d.get.call(this) }, set(v) { window.__ecrits.push(Math.round(v)); d.set.call(this, v) } }) }
window.__haut = () => { const vl = document.querySelector('mjs-vl-relivree')._shadow.querySelector('mjs-core-virtual'), v = __vp().getBoundingClientRect().top, l = [...vl.children].find((x) => x.getBoundingClientRect().bottom > v + 0.5); return l ? { id: l.dataset.id, ecart: Math.round(l.getBoundingClientRect().top - v) } : null }`

// les lignes suivent le défilement à l'image qui suit : quelques images, puis une attente (WebKit sans tête en fait attendre certaines)
const repos = async (page: any) => {
  await page.evaluate('__images(3)')
  await page.waitForTimeout(60)
  await page.evaluate('__images(2)')
}

after(async () => { await terminateSharedWorkerPool() })

for (const nom of NAVIGATEURS) describe(`<@@virtual> : une liste relivrée sans changement n'écrit pas le défilement (${nom} réel)`, function () {
  this.timeout(120000)
  let present = false
  let browser: any = null
  let built: { root: string, script: string }

  before(async function () {
    present = await navigateurPresent(nom)
    if (!present) return
    built = await construire('virtual-relivree', { 'vl-relivree.mjs': PAGE }, false)
    browser = await (await import('playwright'))[nom].launch(nom === 'chromium' ? { args: ['--no-proxy-server'] } : {})
  })

  after(async () => { await Promise.race([browser?.close(), new Promise((ok) => setTimeout(ok, 10000))]) })

  it('défilée au milieu, la liste relivrée garde sa ligne du haut à sa place et n\'écrit pas le défilement', async function () {
    if (!present) { this.skip(); return }
    await essayer(browser, built, false, 'mjs-vl-relivree', async (page) => {
      await page.waitForFunction(() => { try { return (window as any).__vp().scrollHeight > 10000 } catch { return false } })
      await page.evaluate('__vp().scrollTop = 200000')
      await repos(page)
      await repos(page)
      const avant = await page.evaluate('({ haut: __haut(), y: Math.round(__vp().scrollTop) })')
      await page.evaluate('__ecoute(); document.querySelector(\'mjs-vl-relivree\').relivrer()')
      await repos(page)
      await repos(page)
      const apres = await page.evaluate('({ haut: __haut(), y: Math.round(__vp().scrollTop), ecrits: window.__ecrits })')
      assert.ok(avant.y > 100000 && avant.haut, `la liste est défilée au milieu (${avant.y} px, ligne ${avant.haut?.id})`)
      assert.deepEqual(apres, { ...avant, ecrits: [] }, 'liste relivrée : même ligne du haut, même place, aucune écriture du défilement')
    }, { listes: 0, script: SONDE })
  })
})
