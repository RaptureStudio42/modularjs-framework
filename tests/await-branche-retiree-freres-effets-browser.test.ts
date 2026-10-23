// Chromium et Firefox réels : un `{await}` dont la promesse devient fausse retire TOUTE sa branche, même quand
// le nettoyage d'une balise retire un frère qu'un effet avait posé à côté d'elle. `*reflect` en mode `moz`
// (Firefox) pose un calque frère ; la bulle de `*guard` aussi. La marche qui détruit la branche lisait le
// nœud suivant AVANT de détruire le courant : le frère retiré arrêtait la marche, les balises suivantes
// restaient dans la page, effets actifs. La liste des nœuds entre les ancres est maintenant figée avant de
// détruire, ceux déjà détachés sont sautés.
// Deux cas par moteur : l'effet réel (`*reflect` : un frère en Firefox, aucun en Chromium, qui sert de témoin) et
// un nettoyage simulé qui retire le frère de la balise détruite (rouge dans les deux moteurs).

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readFileSync, readdirSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { stripEsm } from '../src/server/renderToString.js'
import { mjsTmp } from './helpers/tmp.js'

async function navigateurPresent(nom: 'chromium' | 'firefox'): Promise<boolean> {
  try {
    const playwright = await import('playwright')
    return existsSync(playwright[nom].executablePath())
  } catch {
    return false
  }
}

// la branche d'attente (promesse qui n'aboutit jamais) porte trois balises ; le bouton rend la promesse fausse
const BRANCHE = '<div class="r" *reflect>reflet</div>\n<div class="m" *magnet>aimant</div>\n<div class="z">fin</div>\n'
const REEL    = '<script>\n$p = new Promise(() => {})\n</script>\n{await $p}\n' + BRANCHE + '{success v}\n<p class="ok">{v}</p>\n{end}\n<button class="t" @click={$p = null}>t</button>\n'
const SIMULE  = '<script>\n$p = new Promise(() => {})\n</script>\n{await $p}\n<div class="r">a</div>\n<div class="m">b</div>\n<div class="z">fin</div>\n{success v}\n<p class="ok">{v}</p>\n{end}\n<button class="t" @click={$p = null}>t</button>\n'

describe('{await} : la branche retirée l\'est en entier quand un effet retire un frère (navigateurs réels)', function () {
  this.timeout(120000)
  let script = ''

  before(async () => {
    const root   = mjsTmp('await-branche-freres-browser')
    const srcDir = join(root, 'src')
    const outDir = join(root, 'out')
    mkdirSync(srcDir, { recursive: true })
    writeFileSync(join(srcDir, 'att-reel.mjs'), REEL)
    writeFileSync(join(srcDir, 'att-simule.mjs'), SIMULE)
    const bundler = new Bundler({ sourceDir: srcDir, outputDir: outDir, manifestPath: join(root, 'bundle.js') })
    const stats   = await bundler.compile()
    await bundler.close()
    assert.equal(stats.errors.length, 0, stats.errors.map((e: any) => e.message).join('\n'))
    const files = readdirSync(outDir).filter((f) => f.endsWith('.js'))
    const rang  = (f: string) => f.startsWith('mjs_core') ? 0 : f.startsWith('mjs_') ? 1 : 2
    script = [...files].sort((a, b) => rang(a) - rang(b) || a.localeCompare(b)).map((f) => stripEsm(readFileSync(join(outDir, f), 'utf-8'))).join('\n') + '\nglobalThis.µ = µ;'
  })

  after(async () => {
    await terminateSharedWorkerPool()
  })

  for (const nom of ['chromium', 'firefox'] as const) {
    it(nom, async function () {
      if (!(await navigateurPresent(nom))) return this.skip()
      const playwright: any = await import('playwright')
      const browser = await playwright[nom].launch()
      try {
        const page = await (await browser.newContext({ viewport: { width: 800, height: 600 } })).newPage()
        const erreurs: string[] = []
        page.on('pageerror', (e: any) => erreurs.push(String(e)))
        await page.route('http://t.test/**', (route: any) => {
          if (route.request().url() !== 'http://t.test/') return route.fulfill({ status: 404, body: '' })
          return route.fulfill({ contentType: 'text/html', body: `<!doctype html><html><head><meta charset="utf-8"></head><body><mjs-att-reel></mjs-att-reel><mjs-att-simule></mjs-att-simule><script>${script}</script></body></html>` })
        })
        await page.goto('http://t.test/', { waitUntil: 'load' })
        await page.waitForFunction(() => ['mjs-att-reel', 'mjs-att-simule'].every((t) => !!(document.querySelector(t) as any)?._shadow?.querySelector('.z')))
        await page.evaluate(() => new Promise((r) => setTimeout(r, 300)))
        // ce que contient la coque du composant : balise, classe, calque, effet actif
        const lire = (tag: string) => page.evaluate((t: string) => [...(document.querySelector(t) as any)._shadow.children].filter((c: any) => c.localName !== 'script' && c.localName !== 'style').map((c: any) => c.localName + '.' + (c.getAttribute('class') ?? '') + (c.getAttribute('mjs-fx-layer') ? '[calque]' : '') + (c.getAttribute('mjs-fx') ? '{mjs-fx=' + c.getAttribute('mjs-fx') + '}' : '')).join(' '), tag)
        const clic = (tag: string) => page.evaluate((t: string) => (document.querySelector(t) as any)._shadow.querySelector('.t').click(), tag)

        // le nettoyage simulé : détruire `.r` retire la balise qui la suit, comme le fait le nettoyage d'un effet qui a posé un frère
        await page.evaluate(() => {
          const comp: any = document.querySelector('mjs-att-simule')
          const orig = comp._mjs_destroyNodeAndChildren
          comp._mjs_destroyNodeAndChildren = function (node: any, anim: any) {
            if (node.classList && node.classList.contains('r') && node.nextElementSibling) node.nextElementSibling.remove()
            return orig.call(this, node, anim)
          }
        })

        const avantReel   = await lire('mjs-att-reel')
        const avantSimule = await lire('mjs-att-simule')
        assert.ok(avantReel.includes('div.z') && avantReel.includes('div.m'), nom + ' : la branche d\'attente est montée (réel) : ' + avantReel)
        assert.ok(avantSimule.includes('div.z') && avantSimule.includes('div.m'), nom + ' : la branche d\'attente est montée (simulé) : ' + avantSimule)

        await clic('mjs-att-reel')
        await clic('mjs-att-simule')
        await page.evaluate(() => new Promise((r) => setTimeout(r, 600)))

        // les deux cas sont relevés avant de conclure : un seul échec ne cache pas l'autre
        const ecarts: string[] = []
        const apresSimule = await lire('mjs-att-simule')
        if (apresSimule !== 'button.t') ecarts.push('nettoyage qui retire un frère (simulé) : il reste « ' + apresSimule + ' » au lieu de « button.t »')
        const apresReel = await lire('mjs-att-reel')
        if (apresReel !== 'button.t') ecarts.push('*reflect et *magnet (avant : « ' + avantReel + ' ») : il reste « ' + apresReel + ' » au lieu de « button.t »')
        assert.deepEqual(ecarts, [], nom + ' : toute la branche doit partir')
        assert.deepEqual(erreurs, [], nom + ' : aucune erreur de page')
      }
      finally {
        await browser.close()
      }
    })
  }
})
