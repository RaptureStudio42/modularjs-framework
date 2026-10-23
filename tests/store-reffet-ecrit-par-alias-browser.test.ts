// magasin `$$`, dans Chromium réel (développement et production) : un reffet qui écrit en cumulant par une variable
// prise HORS de lui — alias (`s2 := $$e2.a` puis `s2.n++`), élément trouvé (`t2 := $$l2.find(f)` puis `t2.n++`),
// méthode (`p9.l.push(1)`), CoffeeScript (`s8 = $$e8.a`) — passe une fois au montage, comme la même écriture par le
// chemin (`$$e2.a.n++`) : sa propre écriture ne le relance pas, une écriture faite ailleurs non plus ; un reffet qui
// ne fait que LIRE par une telle variable garde sa relance à chaque mise à jour (sa lecture ne se voit pas)

import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { terminateSharedWorkerPool } from '../src/bundler/index.js'
import { construire, charger, graves } from './helpers/liaison-navigateur.js'

const SOURCES: Record<string, string> = {
  'reffet-alias.mjs': `<script>
  $$e2 = { a: { n: 0 } }
  $$l2 = [{ id: 1, n: 0 }]
  $$e9 = [{ id: 1, l: [] }]
  $$e4 = { a: { b: 0 } }
  s2 := $$e2.a
  t2 := $$l2.find((x) -> x.id == 1)
  p9 := $$e9[0]
  s4 := $$e4.a
  µeffect ->
    s2.n++
    window.__s2 = (window.__s2 ?? 0) + 1
  µeffect ->
    t2.n++
    window.__t2 = (window.__t2 ?? 0) + 1
  µeffect ->
    p9.l.push(1)
    window.__p9 = (window.__p9 ?? 0) + 1
  µeffect ->
    window.__e4v = s4.b
  @ecrit = ->
    $$e2.a.n = 50
    $$l2[0].n = 50
    $$e9[0].l.push(2)
    $$e4.a.b = 5
</script>

<p class="etat">{JSON.stringify($$e2)} {JSON.stringify($$l2)} {JSON.stringify($$e9)} {JSON.stringify($$e4)}</p>
`,
  'reffet-alias-coffee.mjs': `<script lang="coffee">
$$e8 = { a: { n: 0 } }
s8 = $$e8.a
µeffect ->
  s8.n++
  window.__s8 = (window.__s8 ? 0) + 1
@ecrit = -> $$e8.a.n = 50
</script>

<p class="etat">{JSON.stringify($$e8)}</p>
`,
}
const BALISE = 'mjs-reffet-alias'

const lire = (page: any, balise: string) => page.evaluate(`document.querySelector('${balise}')._shadow.querySelector('.etat').textContent`)
const passages = (page: any) => page.evaluate('JSON.stringify([window.__s2, window.__t2, window.__p9, window.__s8])')

describe('magasin $$, Chromium réel : un reffet qui écrit par une variable prise hors de lui passe une fois, comme par le chemin', function () {
  this.timeout(120000)
  let browser: any = null

  before(async function () {
    const playwright = await import('playwright')
    if (!existsSync(playwright.chromium.executablePath())) {
      console.log('  ℹ️  chromium non installé, test des reffets du magasin sauté. Activer : `npx playwright install chromium`')
      this.skip()
    }
    browser = await playwright.chromium.launch()
  })

  after(async () => {
    if (browser) await browser.close()
    await terminateSharedWorkerPool()
  })

  for (const mode of ['dev-parents-avant', 'bundle'] as const) {
    it(`${mode === 'bundle' ? 'production' : 'développement'} : un passage au montage, aucun sur sa propre écriture ni sur une écriture faite ailleurs`, async () => {
      const o = await charger(browser, await construire(mode, SOURCES, [BALISE]), BALISE)
      try {
        await o.page.waitForFunction(`!!((document.querySelector('${BALISE}') || {})._shadow || {}).textContent`, null, { timeout: 10000 })
        await o.page.evaluate(`document.body.appendChild(document.createElement('mjs-reffet-alias-coffee'))`)
        await o.page.waitForFunction(`!!((document.querySelector('mjs-reffet-alias-coffee') || {})._shadow || {}).textContent`, null, { timeout: 10000 })
        await o.page.waitForTimeout(300)
        assert.equal(await passages(o.page), '[1,1,1,1]', 'un passage au montage')
        assert.equal(await lire(o.page, BALISE), '{"a":{"n":1}} [{"id":1,"n":1}] [{"id":1,"l":[1]}] {"a":{"b":0}}')
        assert.equal(await lire(o.page, 'mjs-reffet-alias-coffee'), '{"a":{"n":1}}')
        await o.page.evaluate(`document.querySelector('${BALISE}').ecrit(); document.querySelector('mjs-reffet-alias-coffee').ecrit()`)
        await o.page.waitForTimeout(300)
        assert.equal(await passages(o.page), '[1,1,1,1]', 'une écriture faite ailleurs ne relance pas le reffet qui cumule')
        assert.equal(await lire(o.page, BALISE), '{"a":{"n":50}} [{"id":1,"n":50}] [{"id":1,"l":[1,2]}] {"a":{"b":5}}')
        assert.equal(await lire(o.page, 'mjs-reffet-alias-coffee'), '{"a":{"n":50}}')
        assert.equal(await o.page.evaluate('window.__e4v'), 5, 'le reffet qui lit seulement par la variable suit l\'écriture faite ailleurs')
        assert.deepEqual(o.avis.filter((a) => /Boucle réactive|Reactive loop/i.test(a)), [])
        assert.deepEqual(graves(o), [])
      }
      finally {
        await o.fermer()
      }
    })
  }
})
