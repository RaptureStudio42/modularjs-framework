// {for} sur un `Set` ou une `Map`, comme `for…of` en JavaScript : un Set donne ses éléments, une Map ses paires [clé, valeur] ; avec
// ou sans `by`, au premier rendu, après une méthode du Set (`add`, `delete`), après un nouveau Set, et pour une liste vide remplacée par un Set
// (forme `{for i, p in …}`). Navigateur réel (Chromium)

import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { terminateSharedWorkerPool } from '../src/bundler/index.js'
import { construire, charger } from './helpers/liaison-navigateur.js'

const BALISE = 'mjs-for-set-map'

const SOURCES: Record<string, string> = {
  'for-set-map.mjs': `<script lang="coffee">
  $s = new Set([ { id: 1, label: 'A' }, { id: 2, label: 'B' } ])
  $t = new Set([ 'x', 'y' ])
  $m = new Map([ ['k1', { id: 1, label: 'M1' }], ['k2', { id: 2, label: 'M2' }] ])
  $v = []
  @poser = (x) -> $v = x
  @ajouter = ->
    $s.add({ id: 3, label: 'C' })
    $t.delete('x')
  @remplacer = ->
    $s = new Set([ { id: 4, label: 'D' } ])
    $t = new Set([ 'z' ])
    $m = new Map([ ['k3', { id: 3, label: 'M3' }] ])
</script>
<ul class="s">{for x in $s by id}<li>{x.label}</li>{end}</ul>
<ul class="t">{for v in $t}<li>{v}</li>{end}</ul>
<ul class="m">{for p in $m}<li>{p[0]}={p[1].label}</li>{end}</ul>
<ul class="v">{for i, p in $v by id}<li>{i}:{p.label}</li>{end}</ul>
`
}

const LIRE = `(() => {
  const sh = document.querySelector('${BALISE}')._shadow
  const l = (c) => [...sh.querySelectorAll('ul.' + c + ' li')].map((li) => li.textContent).join(',')
  return { s: l('s'), t: l('t'), m: l('m'), v: l('v') }
})()`

const cible = construire('dev-parents-avant', SOURCES, [BALISE])

describe('{for} sur un Set et sur une Map (chromium réel)', function () {
  this.timeout(120000)
  let browser: any = null
  let present = false

  before(async function () {
    const playwright = await import('playwright')
    present = existsSync(playwright.chromium.executablePath())
    if (!present) { console.log('  ℹ️  chromium non installé, test sauté. Activer : `npx playwright install chromium`'); return }
    browser = await playwright.chromium.launch()
  })

  after(async () => {
    if (browser) await browser.close()
    await terminateSharedWorkerPool()
  })

  it('premier rendu, méthodes du Set, nouveau Set, nouvelle Map, liste vide remplacée par un Set : les lignes suivent, comme for…of', async function () {
    if (!present) { this.skip(); return }
    const o = await charger(browser, await cible, BALISE)
    try {
      await o.page.waitForFunction(`!!document.querySelector('${BALISE}')?._shadow?.querySelector('ul.m')`, null, { timeout: 10000 })
      const pause = `new Promise((r) => setTimeout(r, 60))`
      const debut = await o.page.evaluate(`(async () => { await ${pause}; return ${LIRE} })()`)
      const ajout = await o.page.evaluate(`(async () => { document.querySelector('${BALISE}').ajouter(); await ${pause}; return ${LIRE} })()`)
      const neuf  = await o.page.evaluate(`(async () => { document.querySelector('${BALISE}').remplacer(); await ${pause}; return ${LIRE} })()`)
      const pose  = await o.page.evaluate(`(async () => { document.querySelector('${BALISE}').poser(new Set([ { id: 1, label: 'P' }, { id: 2, label: 'Q' } ])); await ${pause}; return ${LIRE} })()`)
      assert.deepEqual(debut, { s: 'A,B', t: 'x,y', m: 'k1=M1,k2=M2', v: '' })
      assert.deepEqual(ajout, { s: 'A,B,C', t: 'y', m: 'k1=M1,k2=M2', v: '' })
      assert.deepEqual(neuf, { s: 'D', t: 'z', m: 'k3=M3', v: '' })
      assert.deepEqual(pose, { s: 'D', t: 'z', m: 'k3=M3', v: '0:P,1:Q' }, 'liste vide remplacée par un Set')
      assert.deepEqual(o.erreurs, [])
    }
    finally {
      await o.fermer()
    }
  })
})
