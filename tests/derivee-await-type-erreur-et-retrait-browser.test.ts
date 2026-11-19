// valeurs dérivées qui attendent, dans de vrais navigateurs (Chromium, Firefox, WebKit), en développement et en production (`bundle`,
// `split`) : une réponse que le type du <vars> refuse est un échec (valeur d'avant gardée, attente finie, erreur lue, `$occupe =
// µpending($r)` suit) ; une erreur que rien ne lit va à la console d'erreurs (en développement, avec quoi écrire) ; un composant retiré
// ne demande plus rien, un composant déplacé refait sa demande coupée. Les requêtes sont tenues par le test (`page.route`)

import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { terminateSharedWorkerPool } from '../src/bundler/index.js'
import { construire, charger, graves } from './helpers/liaison-navigateur.js'

const TYPEE = `<vars>
  $r int 0..100
</vars>
<script>
  $q        = 0
  f         = (q, signal) -> fetch("/api/t?q=#{q}", { signal }).then((r) -> r.json())
  $r        = await f($q, µsignal)
  $occupe   = µpending($r)
  @chercher = (q) -> $q = q
</script>
<b class="v">{$r}</b><i class="occ">{$occupe}</i><u class="err">{µfailed($r)?.message}</u>
`
const MUETTE = `<script>
  $q        = 0
  f         = (q, signal) -> fetch("/api/m?q=#{q}", { signal }).then((r) -> if r.ok then r.json() else throw new Error('statut ' + r.status))
  $m        = await f($q, µsignal)
  @chercher = (q) -> $q = q
</script>
<b class="v">{$m}</b>
`
const FICHE = `<script>
  $id    = 0
  f      = (id, signal) -> fetch("/api/f?q=#{id}", { signal }).then((r) -> r.json())
  $fiche = await f($id, µsignal)
  @voir  = (id) -> $id = id
</script>
<b class="v">{$fiche}</b>
`
const BANC = `<div class="a"><@c-typee></@c-typee><@c-muette></@c-muette><@c-fiche id={1}></@c-fiche><@c-fiche id={2}></@c-fiche></div><div class="b"></div>`
const B    = 'mjs-banc'
const EN   = (sel: string) => `document.querySelector('${B}')._shadow.querySelector('${sel}')`
const VU   = (sel: string) => `(() => { const e = ${EN(sel)}; return e ? ['v', 'occ', 'err'].map((c) => e._shadow.querySelector('.' + c)?.textContent ?? '∅').join('|') : '∅' })()`

for (const nav of ['chromium', 'firefox', 'webkit'] as const) {
  describe('dérivée qui attend — type, erreur non lue, retrait, déplacement (' + nav + ')', function () {
    this.timeout(180000)
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

    for (const mode of ['dev-parents-avant', 'bundle', 'split'] as const) {
      it(mode + ' : réponse refusée par le type, erreur non lue, composant retiré puis déplacé', async function () {
        if (!browser) { this.skip(); return }
        const tenues: Record<string, any[]> = {}
        const vues: string[]    = []
        const coupees: string[] = []
        const relais = async (page: any) => {
          await page.route('**/api/**', (route: any) => { const u = new URL(route.request().url()); const c = u.pathname.slice(5) + u.searchParams.get('q'); vues.push(c); (tenues[c] ||= []).push(route) })
          page.on('requestfailed', (r: any) => { if (/\/api\//.test(r.url())) { const u = new URL(r.url()); coupees.push(u.pathname.slice(5) + u.searchParams.get('q')) } })
        }
        const o = await charger(browser, await construire(mode, { 'banc.mjs': BANC, 'c-typee.mjs': TYPEE, 'c-muette.mjs': MUETTE, 'c-fiche.mjs': FICHE }, [B]), B, '', 200, relais)
        try {
          const p = o.page
          // la dernière requête tenue de cette adresse (celle d'avant un déplacement est coupée)
          const rep = async (c: string, corps: any, status = 200) => { const r = (tenues[c] || []).pop(); assert.ok(r, 'rien de tenu pour ' + c + ' — vues : ' + vues.join(', ')); await r.fulfill({ status, contentType: 'application/json', body: JSON.stringify(corps) }); await p.waitForTimeout(150) }
          await p.waitForFunction(`document.querySelector('${B}')?._shadow?.querySelectorAll('mjs-c-fiche').length === 2`, null, { timeout: 10000 })
          await p.waitForTimeout(300)
          assert.deepEqual([...vues].sort(), ['f1', 'f2', 'm0', 't0'], 'une demande par composant, props reçues')
          await rep('t0', 50)
          await rep('m0', 1)
          // réponse refusée par le type : un échec ; en développement, le mode des types que le manifeste pose dans une vraie page
          if (mode === 'dev-parents-avant') await p.evaluate('µ._typesMode = "warn"')
          await p.evaluate(`${EN('mjs-c-typee')}.chercher(1)`)
          await p.waitForTimeout(150)
          assert.equal(await p.evaluate(VU('mjs-c-typee')), '50|true|', '$occupe dit l\'attente')
          await rep('t1', 'abc')
          const typee = String(await p.evaluate(VU('mjs-c-typee')))
          assert.match(typee, /^50\|false\|.+/, 'la valeur d\'avant reste, l\'attente finit, l\'erreur se lit — ' + typee)
          if (mode === 'dev-parents-avant') assert.ok(o.avis.some((a) => /\$r refuse/.test(a)), 'le refus du type est dit — ' + o.avis.join(' | '))
          // erreur que rien ne lit : à la console d'erreurs
          await p.evaluate(`${EN('mjs-c-muette')}.chercher(1)`)
          await p.waitForTimeout(150)
          await rep('m1', 'panne', 500)
          await p.waitForTimeout(150)
          const dite = o.avis.filter((a) => /\$m\b/.test(a))
          assert.equal(dite.length, 1, 'l\'erreur non lue est dite — ' + o.avis.join(' | '))
          if (mode === 'dev-parents-avant') assert.match(dite[0], /µfailed\(\$m\)/)
          assert.equal(await p.evaluate(`${EN('mjs-c-muette')}._shadow.querySelector('.v').textContent`), '1', 'la valeur d\'avant reste')
          // retiré : sa demande en vol est coupée, plus rien ne part
          await p.evaluate(`(() => { const f = ${EN('mjs-c-fiche')}; f.remove(); f.voir(5) })()`)
          await p.waitForTimeout(300)
          assert.ok(coupees.includes('f1'), 'la demande du composant retiré est coupée — ' + coupees.join(', '))
          assert.ok(!vues.includes('f5'), 'aucune demande après le retrait — ' + vues.join(', '))
          // déplacé : sa demande coupée repart, sa réponse s'écrit
          await p.evaluate(`document.querySelector('${B}')._shadow.querySelector('.b').appendChild(${EN('mjs-c-fiche')})`)
          await p.waitForTimeout(300)
          assert.deepEqual(vues.filter((v) => v === 'f2').length, 2, 'la demande coupée repart une fois — ' + vues.join(', '))
          await rep('f2', 'deux')
          assert.equal(await p.evaluate(`${EN('.b mjs-c-fiche')}._shadow.querySelector('.v').textContent`), 'deux')
          assert.deepEqual(graves(o), [], 'aucune erreur de page')
        }
        finally {
          await o.fermer()
        }
      })
    }
  })
}
