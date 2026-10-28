// µ.modal dans Chromium et Firefox réels, face aux méthodes qu'un auteur de composant définit sous un nom du DOM
// (`@contains`, `@focus` : des noms naturels, laissés libres par le compilateur). Un vrai plein écran (Chromium :
// `requestFullscreen` après un clic de l'utilisateur) sur la balise d'un composant qui définit `@contains` : la
// fenêtre s'affiche dans l'élément en plein écran, `@contains` n'est jamais appelée. Une vraie touche Échap ferme la
// fenêtre ouverte depuis un composant qui définit `@focus` : le focus revient à la balise par le DOM, `@focus`
// n'est jamais appelée. Un élément SVG qui avait le focus le reprend aussi : `focus` d'un SVG n'est pas celui d'un
// élément HTML, le cadre ne doit pas les confondre (« Illegal invocation » : la fenêtre ne se fermerait jamais).
// Firefox : le plein écran réel y est refusé hors d'une vraie fenêtre, le test n'y joue que le focus.

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readdirSync, readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { mjsTmp } from './helpers/tmp.js'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { stripEsm } from '../src/server/renderToString.js'

async function navigateurPresent(nom: 'chromium' | 'firefox'): Promise<boolean> {
  try {
    const playwright = await import('playwright')
    return existsSync(playwright[nom].executablePath())
  } catch {
    return false
  }
}

const SCENE = [
  '<script>',
  '@contains = (x) ->',
  '  window.__appels.push(\'contains\')',
  '  true',
  '@focus = (options) ->',
  '  window.__appels.push(\'focus\')',
  '</script>',
  '<div class="scene"><p>scène</p></div>',
  '<style>',
  '.scene',
  '  background: #345',
  '  color: #fff',
  '  width: 400px',
  '  height: 300px',
  '</style>',
  ''
].join('\n')

// le clic de l'utilisateur demande le plein écran de l'élément posé dans `window.__pleinEcran`
const PAGE = (script: string) => `<!doctype html><html><head><meta charset="utf-8"><style>html,body{margin:0}</style></head><body><mjs-scene tabindex="0"></mjs-scene><svg id="forme" tabindex="0" width="20" height="20"><rect width="20" height="20"></rect></svg><script>${script}</script><script>window.__pleinEcran = null; document.addEventListener('click', function () { if (window.__pleinEcran) window.__pleinEcran.requestFullscreen().catch(function (e) { window.__refus = String(e) }) })</script></body></html>`

for (const nom of ['chromium', 'firefox'] as const) {
  describe(`µ.modal et les méthodes de l'auteur (${nom} réel)`, function () {
    this.timeout(120000)
    let present = false
    let script  = ''
    let browser: any = null

    before(async function () {
      present = await navigateurPresent(nom)
      if (!present) {
        console.log(`  ℹ️  ${nom} non installé, test de µ.modal sauté. Activer : \`npx playwright install ${nom}\``)
        return
      }
      const root   = mjsTmp('modale-methodes-auteur-' + nom)
      const srcDir = join(root, 'src')
      const outDir = join(root, 'out')
      mkdirSync(srcDir, { recursive: true })
      writeFileSync(join(srcDir, 'scene.mjs'), SCENE)
      // le test appelle µ.modal depuis son propre code, hors des sources compilées (en production, une page n'atteint pas µ) : rien ne le révèle au repérage, 'all' rend le cœur complet
      const bundler = new Bundler({ sourceDir: srcDir, outputDir: outDir, manifestPath: join(root, 'bundle.js'), runtime: 'all' })
      const stats   = await bundler.compile()
      await bundler.close()
      assert.equal(stats.errors.length, 0, stats.errors.map((e: any) => e.message).join('\n'))
      const files = readdirSync(outDir).filter((f) => f.endsWith('.js'))
      const rang  = (f: string) => f.startsWith('mjs_core') ? 0 : f.startsWith('mjs_') ? 1 : 2
      script = [...files].sort((a, b) => rang(a) - rang(b) || a.localeCompare(b)).map((f) => stripEsm(readFileSync(join(outDir, f), 'utf-8'))).join('\n') + '\nglobalThis.µ = µ;'
      browser = await (await import('playwright'))[nom].launch()
    })

    after(async () => {
      if (browser) await browser.close()
      await terminateSharedWorkerPool()
    })

    async function ouvre() {
      const page = await browser.newPage({ viewport: { width: 800, height: 600 } })
      const erreurs: string[] = []
      await page.addInitScript('window.__appels = []')
      page.on('pageerror', (e: any) => erreurs.push(String(e && e.message)))
      await page.route('http://t.test/**', (route: any) => {
        if (route.request().url() !== 'http://t.test/') return route.fulfill({ status: 404, body: '' })
        return route.fulfill({ contentType: 'text/html', body: PAGE(script) })
      })
      await page.goto('http://t.test/', { waitUntil: 'load' })
      await page.waitForFunction(() => !!(document.querySelector('mjs-scene') as any)?._shadow?.querySelector('.scene'))
      return { page, erreurs }
    }

    it('plein écran réel sur la balise d\'un composant qui définit @contains : la fenêtre s\'affiche dans l\'élément en plein écran, @contains n\'est pas appelée', async function () {
      if (!present || nom !== 'chromium') { this.skip(); return }
      const { page, erreurs } = await ouvre()
      try {
        await page.evaluate(() => { (window as any).__pleinEcran = document.querySelector('mjs-scene') })
        await page.mouse.click(5, 5)
        await page.waitForFunction(() => !!document.fullscreenElement, null, { timeout: 10000 })
        const r = await page.evaluate(async () => {
          const µ = (window as any).µ
          const hote: any = document.querySelector('mjs-scene')
          const p = µ.modal.fire({ title: 'Question' })
          const out = {
            pleinEcran: document.fullscreenElement === hote,
            dansOmbre:  !!hote._shadow.querySelector('.mjs-modal-backdrop'),
            dansCorps:  !!document.body.querySelector(':scope > .mjs-modal-backdrop'),
            appels:     Array.from((window as any).__appels)
          }
          µ.modal.close()
          await p
          return out
        })
        assert.deepEqual(r, { pleinEcran: true, dansOmbre: true, dansCorps: false, appels: [] })
        assert.deepEqual(erreurs, [])
      } finally {
        await page.close()
      }
    })

    it('Échap ferme la fenêtre ouverte depuis un composant qui définit @focus : le focus revient à la balise, @focus n\'est pas appelée', async function () {
      if (!present) { this.skip(); return }
      const { page, erreurs } = await ouvre()
      try {
        await page.evaluate(() => {
          const w: any = window
          HTMLElement.prototype.focus.call(document.querySelector('mjs-scene'))
          w.__p = w.µ.modal.fire({ title: 'Question' }).then((r: any) => { w.__r = r })
        })
        await page.keyboard.press('Escape')
        await page.waitForFunction(() => !!(window as any).__r, null, { timeout: 10000 })
        const r = await page.evaluate(() => ({
          dismiss:         (window as any).__r.dismiss,
          focusSurBalise:  document.activeElement === document.querySelector('mjs-scene'),
          appels:          Array.from((window as any).__appels)
        }))
        assert.deepEqual(r, { dismiss: 'esc', focusSurBalise: true, appels: [] })
        assert.deepEqual(erreurs, [])
      } finally {
        await page.close()
      }
    })

    it('un élément SVG qui avait le focus le reprend à la fermeture, sans erreur', async function () {
      if (!present) { this.skip(); return }
      const { page, erreurs } = await ouvre()
      try {
        await page.evaluate(() => {
          const w: any = window
          ;(document.getElementById('forme') as any).focus()
          w.__p = w.µ.modal.fire({ title: 'Question' }).then((r: any) => { w.__r = r })
        })
        await page.keyboard.press('Escape')
        await page.waitForFunction(() => !!(window as any).__r, null, { timeout: 10000 })
        const r = await page.evaluate(() => ({
          dismiss:      (window as any).__r.dismiss,
          focusSurSvg:  document.activeElement === document.getElementById('forme')
        }))
        assert.deepEqual(r, { dismiss: 'esc', focusSurSvg: true })
        assert.deepEqual(erreurs, [])
      } finally {
        await page.close()
      }
    })
  })
}
