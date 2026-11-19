// <@@virtual> dans Chromium, Firefox et WebKit réels, en développement et en production : chaque hauteur de ligne se relit quand elle
// change, même quand la ligne ne bouge pas. Un texte allongé sur place (la même ligne, plus haute), la largeur de la liste changée (ses
// lignes passent à la ligne autrement), une liste vidée puis remplie : la hauteur totale suit la somme des hauteurs réelles. La liste ne
// mesure à chaque pas que ses lignes neuves ou déplacées ; une ligne restée à sa place doit encore dire sa nouvelle taille

import assert from 'node:assert/strict'
import { construire, essayer, navigateurPresent, NAVIGATEURS } from './helpers/sortable-navigateur.js'
import { terminateSharedWorkerPool } from '../src/bundler/index.js'

const N = 60

// le texte d'une ligne : des mots de 100 px sur 20 px, autant par ligne que la largeur en laisse
const PAGE = `<script>
  $lignes = Array.from({ length: ${N} }, (_, i) -> ({ id: i, n: 1 + i % 4 }))
  $debut  = 0
  $fin    = 20

  @allonger = -> $lignes = $lignes.map((p) -> if p.id is 1 then ({ id: 1, n: 7 }) else p)
  @vider    = -> $lignes = []
  @remplir  = -> $lignes = Array.from({ length: ${N} }, (_, i) -> ({ id: i, n: 1 + (i + 2) % 5 }))
</script>

<@@virtual class="vl" items={$lignes} key="id" size="40" start=!{$debut} end=!{$fin} aria-label="Lignes">
  {for p in $lignes.slice($debut, $fin) by id}
    <div class="ligne" data-id={p.id}>{for m in Array.from({ length: p.n })}<i class="mot"></i>{end}</div>
  {end}
</@@virtual>

<style>
  :host
    display: block
  .vl
    width: 320px
    height: 300px
  .vl.etroite
    width: 220px
  .ligne
    font-size: 0
    line-height: 0
  .mot
    display: inline-block
    width: 100px
    height: 20px
</style>
`

const SONDE = `window.__vl = () => document.querySelector('mjs-vl-hauteurs')._shadow.querySelector('mjs-core-virtual')
window.__vp = () => __vl()._shadow.querySelector('.viewport')
window.__images = (n) => new Promise((ok) => { const f = () => (n-- > 0 ? requestAnimationFrame(f) : ok()); f() })
window.__ligne = (id) => [...__vl().children].find((l) => l.dataset.id === String(id))
window.__parLigne = () => Math.floor(__vl().children[0].clientWidth / 100)
window.__passe = async () => { const vp = __vp(); for (let y = 0; y <= vp.scrollHeight; y += 80) { vp.scrollTop = y; await __images(3) } vp.scrollTop = 0; await __images(6); return Math.round(vp.scrollHeight) }`

// hauteur totale attendue : chaque ligne à 20 px par rangée de mots
const total = (ns: number[], parLigne: number): number => ns.reduce((s, n) => s + 20 * Math.ceil(n / parLigne), 0)
const depart  = Array.from({ length: N }, (_, i) => 1 + i % 4)
const allonge = depart.map((n, i) => (i === 1 ? 7 : n))
const rempli  = Array.from({ length: N }, (_, i) => 1 + (i + 2) % 5)

after(async () => { await terminateSharedWorkerPool() })

for (const nom of NAVIGATEURS) describe(`<@@virtual> : chaque hauteur se relit quand elle change (${nom} réel)`, function () {
  this.timeout(180000)
  let present = false
  let browser: any = null
  const bati: Record<string, { root: string, script: string }> = {}

  before(async function () {
    present = await navigateurPresent(nom)
    if (!present) return
    for (const prod of [false, true]) bati[String(prod)] = await construire('virtual-hauteurs' + (prod ? '-prod' : ''), { 'vl-hauteurs.mjs': PAGE }, prod)
    browser = await (await import('playwright'))[nom].launch(nom === 'chromium' ? { args: ['--no-proxy-server'] } : {})
  })

  after(async () => { await Promise.race([browser?.close(), new Promise((ok) => setTimeout(ok, 10000))]) })

  for (const prod of [false, true]) it(`${prod ? 'production' : 'développement'} : texte allongé sur place, largeur changée, liste vidée puis remplie`, async function () {
    if (!present) { this.skip(); return }
    await essayer(browser, bati[String(prod)], prod, 'mjs-vl-hauteurs', async (page) => {
      await page.waitForFunction(() => { try { return (window as any).__vl().children.length > 0 } catch { return false } })
      const large = await page.evaluate('__parLigne()')
      assert.equal(await page.evaluate('__passe()'), total(depart, large), 'au départ, chaque ligne mesurée')

      await page.evaluate('window.__before = __ligne(1); document.querySelector(\'mjs-vl-hauteurs\').allonger()')
      await page.evaluate('__images(6)')
      assert.equal(await page.evaluate('__ligne(1) === window.__before'), true, 'la ligne allongée est restée la même, à sa place')
      assert.equal(await page.evaluate('Math.round(__vp().scrollHeight)'), total(allonge, large), 'texte allongé sur place : sa hauteur relue')

      await page.evaluate('__vl().classList.add(\'etroite\')')
      await page.evaluate('__images(6)')
      const etroit = await page.evaluate('__parLigne()')
      assert.ok(etroit < large, `la largeur change le nombre de mots par rangée (${large} puis ${etroit})`)
      assert.equal(await page.evaluate('__passe()'), total(allonge, etroit), 'largeur changée : chaque hauteur relue')

      await page.evaluate('document.querySelector(\'mjs-vl-hauteurs\').vider()')
      await page.evaluate('__images(6)')
      assert.equal(await page.evaluate('__vl().children.length'), 0, 'liste vidée')
      await page.evaluate('document.querySelector(\'mjs-vl-hauteurs\').remplir()')
      await page.waitForFunction(() => (window as any).__vl().children.length > 0)
      assert.equal(await page.evaluate('__passe()'), total(rempli, etroit), 'liste vidée puis remplie : chaque hauteur relue')
    }, { listes: 0, script: SONDE })
  })
})
