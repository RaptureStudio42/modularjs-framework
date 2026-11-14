// une transition `.shared` (images clés CSS partagées) interrompue à mi-course reprend depuis sa position, comme le mode standard : un
// `{if}` rouvert pendant la sortie de sa balise la fait revenir de là où en était la sortie, jamais de 0 ; la balise finit à son état
// normal, sans animation qui traîne. Développement et production, Chromium, Firefox et WebKit
import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { terminateSharedWorkerPool } from '../src/bundler/index.js'
import { construire, charger, graves } from './helpers/liaison-navigateur.js'
import type { Cible } from './helpers/liaison-navigateur.js'

const SOURCES = {
  'tp-si.mjs': `<script>
  $v    = true
  @voir = (v) -> $v = v
</script>
{if $v}<p class="p" :transition.shared=*fade(duration: 900ms)>x</p>{end}
<p class="pret">prêt</p>
`
}

// la sortie part, le `{if}` se rouvre au tiers de la sortie : l'opacité juste avant, 60 ms après, puis après la fin ; chaque relevé dans
// une image, la réouverture dans la même image que le relevé d'avant (hors d'une image, WebKit peut rendre un style en retard)
const JOUER = `(async () => {
  const pause   = (ms) => new Promise((r) => setTimeout(r, ms))
  const image   = () => new Promise((r) => requestAnimationFrame(() => r(null)))
  const el      = document.querySelector('mjs-tp-si'), om = el._shadow
  const p       = () => om.querySelectorAll('p.p')
  const opacite = () => Number(getComputedStyle(p()[0]).opacity)
  el.voir(false)
  await pause(300)
  await image()
  const avant = opacite()
  el.voir(true)
  await pause(60)
  await image()
  const juste = opacite()
  await pause(1300)
  const n = p()[0]
  return {
    retour: juste >= avant - 0.05 ? 'depuis sa position' : 'repart de ' + juste.toFixed(2) + ', etait a ' + avant.toFixed(2),
    fin: p().length + ' balise, opacite ' + getComputedStyle(n).opacity + ', animations ' + n.getAnimations().length
  }
})()`

const NAVIGATEURS = (process.env.TP_NAVS || 'chromium,firefox,webkit').split(',')
const cibles      = new Map<string, Promise<Cible>>()
const cible       = (mode: 'dev-parents-avant' | 'bundle') => {
  if (!cibles.has(mode)) cibles.set(mode, construire(mode, SOURCES, ['mjs-tp-si']))
  return cibles.get(mode) as Promise<Cible>
}

for (const nav of NAVIGATEURS) describe(`transition .shared interrompue : elle reprend depuis sa position (${nav})`, function () {
  this.timeout(120000)
  let browser: any = null
  let present      = false
  before(async function () {
    const playwright: any = await import('playwright')
    present = existsSync(playwright[nav].executablePath())
    if (!present) return
    browser = await playwright[nav].launch()
  })
  after(async () => {
    if (browser) await browser.close()
    await terminateSharedWorkerPool()
  })
  for (const mode of ['dev-parents-avant', 'bundle'] as const) it(`${mode === 'bundle' ? 'production' : 'développement'} : un {if} rouvert pendant la sortie la fait revenir de là où elle en était`, async function () {
    if (!present) { this.skip(); return }
    const o = await charger(browser, await cible(mode), 'mjs-tp-si')
    try {
      await o.page.waitForFunction(`(() => { const e = document.querySelector('mjs-tp-si'); return !!(e && e._shadow && e._shadow.querySelector('.pret') && typeof e.voir === 'function') })()`, null, { timeout: 10000 })
      await o.page.waitForTimeout(300)
      assert.deepEqual(await o.page.evaluate(JOUER), { retour: 'depuis sa position', fin: '1 balise, opacite 1, animations 0' })
      assert.deepEqual(graves(o), [], 'aucune erreur')
    } finally { await o.fermer() }
  })
})
