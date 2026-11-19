// dans de vrais navigateurs (Chromium, Firefox, WebKit), en développement et en production : l'appli demande « Quitter la page ? », le
// visiteur reste. Une demande faite pendant ce départ annoncé, qui échoue, n'est pas perdue : la page toujours là, son erreur se lit par
// `µfailed($r)` (la valeur d'avant reste, l'attente finit) et va une fois à la console quand rien ne la lit ; la demande suivante qui
// échoue se dit aussitôt. Les requêtes répondent 500 (`page.route`)

import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { terminateSharedWorkerPool } from '../src/bundler/index.js'
import { construire, charger } from './helpers/liaison-navigateur.js'

const F     = 'f         = (q, signal) -> if q is 0 then Promise.resolve(\'debut\') else fetch("/api/t?q=#{q}", { signal }).then((r) -> if r.ok then r.json() else throw new Error("panne #{r.status} q#{q}"))'
const RESTE = `<script>
  $q        = 0
  ${F}
  $r        = await f($q, µsignal)
  @chercher = (q) -> $q = q
</script>
<b class="v">{$r}</b><s class="att">{µpending($r)}</s><u class="err">{µfailed($r)?.message}</u>
`
const MUET  = `<script>
  $q        = 0
  ${F}
  $m        = await f($q, µsignal)
  @chercher = (q) -> $q = q
</script>
<b class="v">{$m}</b>
`
const B     = 'mjs-banc'
const EN    = (c: string) => `document.querySelector('${B}')._shadow.querySelector('mjs-c-${c}')`
const VU    = `(() => { const e = ${EN('reste')}; return e ? ['v', 'att', 'err'].map((k) => e._shadow.querySelector('.' + k)?.textContent ?? '-').join('|') : 'absent' })()`
const AIL   = (route: any) => route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>ailleurs</title><p>ailleurs</p>' })

for (const nav of ['chromium', 'firefox', 'webkit'] as const) {
  describe('dérivée qui attend — départ de la page refusé par le visiteur (' + nav + ')', function () {
    this.timeout(120000)
    let browser: any = null

    before(async function () {
      const playwright = await import('playwright')
      if (!existsSync(playwright[nav].executablePath())) { console.log('  ℹ️  ' + nav + ' non installé, test sauté'); return }
      browser = await playwright[nav].launch()
    })

    after(async () => {
      if (browser) await browser.close()
      await terminateSharedWorkerPool()
    })

    for (const mode of ['dev-parents-avant', 'bundle'] as const) {
      it(mode + ' : le visiteur reste — l\'erreur de la demande faite pendant le départ annoncé est dite ensuite, la suivante aussitôt', async function () {
        if (!browser) { this.skip(); return }
        const o = await charger(browser, await construire(mode, { 'banc.mjs': '<@c-reste></@c-reste><@c-muet></@c-muet>', 'c-reste.mjs': RESTE, 'c-muet.mjs': MUET }, [B]), B)
        try {
          const p     = o.page
          const dites = () => o.avis.filter((a) => /\$m\b/.test(a)).length
          await p.route('**/api/**', (route: any) => route.fulfill({ status: 500, contentType: 'application/json', body: '{}' }))
          await p.route('http://liaison.test/ailleurs', AIL)
          // le visiteur refuse de partir
          p.on('dialog', (d: any) => { d.dismiss().catch(() => {}) })
          await p.waitForFunction(`!!(${EN('reste')}) && !!(${EN('muet')})`, null, { timeout: 10000 })
          await p.waitForTimeout(300)
          assert.equal(await p.evaluate(VU), 'debut|false|')
          await p.evaluate('addEventListener(\'beforeunload\', (e) => { e.preventDefault(); e.returnValue = \'\' })')
          // un geste du visiteur : sans lui, le navigateur ne demande rien
          await p.mouse.click(5, 5)
          await p.evaluate('setTimeout(() => { location.href = \'http://liaison.test/ailleurs\' }, 0)')
          await p.waitForTimeout(400)
          await p.evaluate(`${EN('reste')}.chercher(1); ${EN('muet')}.chercher(1)`)
          // dite quand la page est toujours là, au plus tard dix secondes après le départ annoncé
          await p.waitForFunction(`${VU}.includes('panne 500 q1')`, null, { timeout: 15000 })
          assert.equal(p.url(), 'http://liaison.test/', 'le visiteur est resté')
          assert.equal(await p.evaluate(VU), 'debut|false|panne 500 q1', 'µfailed($r) lit l\'erreur, la valeur d\'avant reste, l\'attente finit')
          await p.waitForTimeout(300)
          assert.equal(dites(), 1, 'l\'erreur que rien ne lit va une fois à la console — ' + o.avis.join(' | '))
          // la demande suivante : dite aussitôt
          await p.evaluate(`${EN('reste')}.chercher(2); ${EN('muet')}.chercher(2)`)
          await p.waitForTimeout(800)
          assert.equal(await p.evaluate(VU), 'debut|false|panne 500 q2')
          assert.equal(dites(), 2, o.avis.join(' | '))
        }
        finally {
          await o.fermer()
        }
      })
    }
  })
}
