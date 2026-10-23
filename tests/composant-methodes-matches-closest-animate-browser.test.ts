// Un composant qui déclare `@matches`, `@closest` ou `@animate` (des noms d'appli plausibles : les
// profils compatibles d'un site de rencontres, le lieu le plus proche, un pas d'animation) garde ces
// noms pour lui. Dans un composant, `this` EST la balise : la méthode masque celle de la balise, et
// ModularJS, qui appelle `matches`/`closest`/`animate` sur les balises de la page, faisait partir la
// méthode de l'auteur à la place — le focus d'après navigation se posait sur le composant (une
// liste non vide vaut « oui »), chaque clic dedans appelait sa méthode et jetait une erreur dans la
// navigation, sa transition de sortie ne jouait pas.
// Chromium et pas happy-dom : un écouteur du document n'y voit d'un clic dans un shadow fermé que
// la balise du composant (cible ramenée à l'hôte) — c'est elle que la navigation interroge — et
// les transitions passent par l'animation native du navigateur.

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
  'fiche.mjs': [
    '<script>',
    '$m = 0',
    '$c = 0',
    '$a = 0',
    '@matches = (profil) ->',
    '  $m++',
    "  ['un profil']",
    '@closest = (lieu) ->',
    '  $c++',
    "  'Paris'",
    '@animate = (pas) ->',
    '  $a++',
    '  null',
    '</script>',
    '<button class="dedans">dedans</button>'
  ].join('\n') + '\n',
  'page.mjs': [
    '<script>',
    '$montre = true',
    '</script>',
    '{if $montre}<@fiche class="fiche" @out=*fade(duration: 60ms)></@fiche>{end}',
    '<input class="auto" autofocus aria-label="auto">'
  ].join('\n') + '\n'
}

describe('composant qui déclare @matches, @closest, @animate : ModularJS prend les méthodes de la balise (Chromium réel)', function () {
  this.timeout(60000)
  let present = false
  let script  = ''

  before(async function () {
    present = await chromiumPresent()
    if (!present) {
      console.log('  ℹ️  Chromium non installé, test des méthodes de balise sauté. Activer : `npx playwright install chromium`')
      return
    }
    const root   = mjsTmp('methodes-de-balise')
    const srcDir = join(root, 'src')
    const outDir = join(root, 'out')
    mkdirSync(srcDir, { recursive: true })
    for (const [nom, source] of Object.entries(SOURCES)) writeFileSync(join(srcDir, nom), source)
    const bundler = new Bundler({ sourceDir: srcDir, outputDir: outDir, manifestPath: join(root, 'bundle.js') })
    const stats   = await bundler.compile()
    await bundler.close()
    assert.equal(stats.errors.length, 0, stats.errors.map((e: any) => e.message).join('\n'))
    const files = readdirSync(outDir).filter((f) => f.endsWith('.js'))
    const rang  = (f: string) => f.startsWith('mjs_core') ? 0 : f.startsWith('mjs_') ? 1 : 2
    const ordre = [...files].sort((a, b) => rang(a) - rang(b))
    script = ordre.map((f) => stripEsm(readFileSync(join(outDir, f), 'utf-8'))).join('\n') + '\nglobalThis.µ = µ;'
  })

  after(async () => { await terminateSharedWorkerPool() })

  it('focus après navigation, clic dans le composant, transition de sortie : aucune méthode de l\'auteur appelée', async function () {
    if (!present) { this.skip(); return }
    const { chromium } = await import('playwright')
    const html    = `<!doctype html><html><head><meta charset="utf-8"></head><body><mjs-page></mjs-page><script>${script}</script></body></html>`
    const browser = await chromium.launch()
    try {
      const page    = await browser.newPage()
      const erreurs: string[] = []
      page.on('pageerror', (err) => erreurs.push(err.message))
      await page.route('http://mjs.test/**', (route) => route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: html }))
      await page.goto('http://mjs.test/')
      await page.waitForFunction(() => !!(document.querySelector('mjs-page') as any)?._shadow?.querySelector('mjs-fiche')?._shadow?.querySelector('.dedans'))
      const compteurs = () => page.evaluate(() => {
        const fiche: any = (document.querySelector('mjs-page') as any)._shadow.querySelector('mjs-fiche')
        return { m: fiche._state.m, c: fiche._state.c, a: fiche._state.a }
      })

      // la cascade du focus d'après navigation cherche [autofocus] dans toute la page, composants compris
      const trouve = await page.evaluate(() => {
        const el: any = (globalThis as any).µ._mjs_deepFind(document.body, '[autofocus]', 0)
        return el ? el.tagName.toLowerCase() + (el.className ? '.' + el.className : '') : null
      })
      assert.equal(trouve, 'input.auto', 'focus après navigation : il doit aller au champ [autofocus], pas au composant')
      assert.equal((await compteurs()).m, 0, 'la méthode @matches de l\'auteur a été appelée par ModularJS')

      await page.evaluate(() => { (document.querySelector('mjs-page') as any)._shadow.querySelector('mjs-fiche')._shadow.querySelector('.dedans').click() })
      await page.waitForTimeout(50)
      assert.equal((await compteurs()).c, 0, 'clic dans le composant : la méthode @closest de l\'auteur a été appelée par la navigation')

      const fiche = await page.evaluateHandle(() => (document.querySelector('mjs-page') as any)._shadow.querySelector('mjs-fiche'))
      await page.evaluate(() => { (document.querySelector('mjs-page') as any)._set('montre', false) })
      await page.waitForFunction((f: any) => !f.isConnected, fiche, { timeout: 3000 }).catch(() => {})
      assert.equal(await page.evaluate((f: any) => f.isConnected, fiche), false, 'transition de sortie : le composant est resté dans la page')
      assert.equal(await page.evaluate((f: any) => f._state.a, fiche), 0, 'transition de sortie : la méthode @animate de l\'auteur a été appelée à la place de l\'animation')
      assert.deepEqual(erreurs, [], 'aucune erreur dans la page')
    } finally {
      await browser.close()
    }
  })
})
