// `@click.prevent` (ou `e.preventDefault()`) sur un lien `<a href="#/…">` d'un composant doit
// empêcher la navigation — comme sur un lien natif. Défaut garanti absent : la couche de
// navigation (UJS) écoutait les clics du composant en CAPTURE sur son shadow root, AVANT le
// gestionnaire du composant, et poussait déjà l'adresse quand `.prevent` arrivait.
// Gardes : un lien simple reste pris en charge par la navigation (adresse poussée, rechargement
// évité : l'événement est prévenu par elle), `.stop` ne la coupe pas, un composant léger (sans
// shadow) imbriqué dans un composant à shadow garde son `.prevent`, et un lien que son gestionnaire
// retire de la page (menu qui se ferme au clic) mène toujours à son adresse.
// Chromium et pas happy-dom : dans un vrai navigateur, un écouteur du document ne voit jamais
// l'intérieur d'un shadow fermé (cible ramenée à l'hôte) — c'est ce qui oblige la navigation à
// lire le lien depuis le shadow root, et happy-dom ne le reproduit pas.

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readdirSync, readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { mjsTmp } from './helpers/tmp.js'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { stripEsm } from '../src/server/renderToString.js'

async function chromiumPresent(): Promise<boolean> {
  try {
    const playwright = await import('playwright')
    return existsSync(playwright.chromium.executablePath())
  } catch {
    return false
  }
}

const SOURCES: Record<string, string> = {
  'liens.mjs': [
    '<script>',
    '$n    = 0',
    '$menu = true',
    '</script>',
    '<a class="prevent" href="#/ailleurs" @click.prevent={$n++}>ailleurs</a>',
    '<a class="simple" href="#/suite">suite</a>',
    '<a class="stop" href="#/stop" @click.stop={$n++}>stop</a>',
    '<p class="n">{$n}</p>',
    '{if $menu}<a class="menu" href="#/menu" @click={$menu = false}>menu</a>{end}',
    '<@interne @lightDom/>'
  ].join('\n') + '\n',
  'interne.mjs': '<script>\n$m = 0\n</script>\n<a class="leger" href="#/leger" @click.prevent={$m++}>léger</a>\n<p class="m">{$m}</p>\n'
}

describe('lien d\'un composant : @click.prevent empêche la navigation (Chromium réel)', function () {
  this.timeout(60000)
  let present = false
  let script  = ''

  before(async function () {
    present = await chromiumPresent()
    if (!present) {
      console.log('  ℹ️  Chromium non installé, test des liens prévenus sauté. Activer : `npx playwright install chromium`')
      return
    }
    const root   = mjsTmp('lien-prevent')
    const srcDir = join(root, 'src')
    const outDir = join(root, 'out')
    mkdirSync(srcDir, { recursive: true })
    for (const [nom, source] of Object.entries(SOURCES)) writeFileSync(join(srcDir, nom), source)
    const bundler = new Bundler({ sourceDir: srcDir, outputDir: outDir, manifestPath: join(root, 'bundle.js') })
    const stats   = await bundler.compile()
    await bundler.close()
    assert.equal(stats.errors.length, 0, stats.errors.map((e: any) => e.message).join('\n'))
    const files = readdirSync(outDir).filter((f) => f.endsWith('.js'))
    const ordre = [...files.filter((f) => f.startsWith('mjs_')), ...files.filter((f) => !f.startsWith('mjs_'))]
    script = ordre.map((f) => stripEsm(readFileSync(join(outDir, f), 'utf-8'))).join('\n') + '\nglobalThis.µ = µ;'
  })

  after(async () => { await terminateSharedWorkerPool() })

  it('.prevent : gestionnaire joué, adresse inchangée ; lien simple et .stop : pris en charge par la navigation ; composant léger imbriqué : .prevent respecté ; lien retiré par son gestionnaire : suivi', async function () {
    if (!present) { this.skip(); return }
    const { chromium } = await import('playwright')
    const html    = `<!doctype html><html><head><meta charset="utf-8"></head><body><mjs-liens></mjs-liens><script>${script}</script></body></html>`
    const browser = await chromium.launch()
    try {
      const page = await browser.newPage()
      await page.route('http://mjs.test/**', (route) => route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: html }))
      await page.goto('http://mjs.test/')
      await page.waitForFunction(() => !!(document.querySelector('mjs-liens') as any)?._shadow?.querySelector('mjs-interne .leger'))
      await page.evaluate(() => { (window as any).__temoin = 'page d\'origine' })
      // clic synthétique : dispatchEvent rend false quand quelqu'un a prévenu l'action par défaut
      const cliquer = (selecteur: string) => page.evaluate((sel) => {
        const hote: any = document.querySelector('mjs-liens')
        const lien      = hote._shadow.querySelector(sel)
        const libre     = lien.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, composed: true, button: 0 }))
        return { prevenu: !libre, hash: location.hash }
      }, selecteur)
      const compteur = (sel: string) => page.evaluate((s) => {
        const hote: any = document.querySelector('mjs-liens')
        return hote._shadow.querySelector(s).textContent
      }, sel)

      const prevent = await cliquer('.prevent')
      await page.waitForTimeout(50)
      assert.equal(await compteur('.n'), '1', 'le gestionnaire .prevent a joué')
      assert.equal(prevent.hash, '', 'lien .prevent : aucune adresse poussée')
      assert.equal(await page.evaluate(() => location.hash), '', 'lien .prevent : l\'adresse reste la même après coup')

      const simple = await cliquer('.simple')
      assert.deepEqual(simple, { prevenu: true, hash: '#/suite' }, 'lien simple : la navigation le prend en charge (adresse poussée, action native prévenue)')

      const stop = await cliquer('.stop')
      assert.deepEqual(stop, { prevenu: true, hash: '#/stop' }, 'lien .stop : la navigation le prend en charge quand même')
      await page.waitForTimeout(50)
      assert.equal(await compteur('.n'), '2', 'le gestionnaire .stop a joué')

      const leger = await cliquer('mjs-interne .leger')
      await page.waitForTimeout(50)
      assert.equal(leger.hash, '#/stop', 'composant léger imbriqué : son .prevent retient la navigation')
      assert.equal(await compteur('mjs-interne .m'), '1', 'le gestionnaire du composant léger a joué')

      const menu = await cliquer('.menu')
      await page.waitForTimeout(50)
      assert.deepEqual(menu, { prevenu: true, hash: '#/menu' }, 'lien retiré par son gestionnaire : la navigation le suit quand même')
      const ferme = await page.evaluate(() => (document.querySelector('mjs-liens') as any)._shadow.querySelector('.menu') === null)
      assert.equal(ferme, true, 'le menu s\'est bien fermé')
      assert.equal(await page.evaluate(() => (window as any).__temoin), 'page d\'origine', 'aucun rechargement de page')
    } finally {
      await browser.close()
    }
  })
})
