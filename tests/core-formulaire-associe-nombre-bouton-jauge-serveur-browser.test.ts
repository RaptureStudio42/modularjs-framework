// Une page rendue par le serveur, lue SANS JavaScript : le nombre, le bouton rotatif et la jauge du cœur (<@@number>, <@@knob>, <@@gauge>),
// obligatoires, hors des bornes ou non, envoient toujours le formulaire par le champ caché que le serveur a écrit dans leur balise — une paire
// par module, jamais deux. Sans JavaScript, aucun module n'est un élément du formulaire : `required`, `min` et `max` n'y bloquent rien, comme
// avant. Chromium, Firefox et WebKit réels, JavaScript coupé : un vrai clic sur le bouton d'envoi.

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { mjsTmp } from './helpers/tmp.js'
import { terminateSharedWorkerPool } from '../src/bundler/index.js'
import { createSSRRenderer } from '../src/server/renderToString.js'

const HOTE = `<form class="f" method="get" action="/envoi" @noUJS>
  <@@number class="nb" name="nb" required></@@number>
  <@@number class="haut" name="haut" min="0" max="10" value="15"></@@number>
  <@@knob class="kn" name="kn" required></@@knob>
  <@@gauge class="ga" name="ga" value="3" required></@@gauge>
  <button type="submit" class="go">envoyer</button>
</form>
`

let construit: Promise<string> | null = null

function construire() {
  construit ??= (async () => {
    const root   = mjsTmp('formulaire-associe-nombre-serveur')
    const srcDir = join(root, 'src')
    const outDir = join(root, 'out')
    mkdirSync(srcDir, { recursive: true })
    writeFileSync(join(srcDir, 'hote-ssr.mjs'), HOTE)
    const renderer = await createSSRRenderer({ sourceDir: srcDir, outputDir: outDir, bundlerOpts: { runtime: ['hydrate'] } } as any)
    const { html } = await renderer.renderToString('mjs-hote-ssr', { ssrMode: 'markers' } as any)
    await renderer.close()
    return html
  })()
  return construit
}

for (const nom of ['chromium', 'firefox', 'webkit'] as const) describe(`page rendue par le serveur, sans JavaScript : le nombre, le bouton rotatif et la jauge partent comme avant (${nom} réel)`, function () {
  this.timeout(180000)
  let present = false
  let browser: any
  let page: any
  let html = ''
  const envois: string[] = []

  before(async () => {
    try {
      const playwright = await import('playwright')
      present = existsSync(playwright[nom].executablePath())
      if (!present) return
      html    = await construire()
      browser = await playwright[nom].launch(nom === 'chromium' ? { args: ['--no-proxy-server'] } : {})
      const contexte = await browser.newContext({ javaScriptEnabled: false, viewport: { width: 1000, height: 800 } })
      page = await contexte.newPage()
      await page.route('http://serveur.test/**', async (route: any) => {
        const url = new URL(route.request().url())
        if (url.pathname === '/envoi') {
          envois.push(url.pathname + url.search)
          await route.fulfill({ status: 200, contentType: 'text/html', body: '<!doctype html><title>envoi</title><p>reçu</p>' })
          return
        }
        await route.fulfill({ status: 200, contentType: 'text/html', body: `<!doctype html><html lang="fr"><head><meta charset="utf-8"></head><body>${html}</body></html>` })
      })
    } catch (e) { present = false; throw e }
  })

  after(async () => {
    if (browser) await browser.close()
    await terminateSharedWorkerPool()
  })

  it('le rendu porte un champ caché par module, et un vrai envoi les porte tous, une fois chacun', async function () {
    if (!present) { this.skip(); return }
    assert.equal((html.match(/<input\b[^>]*\bmjs-f\b[^>]*>/g) || []).length, 4, 'le serveur écrit un champ par module')
    await page.goto('http://serveur.test/page', { waitUntil: 'load' })
    await page.locator('form.f button.go').click()
    await page.waitForURL('**/envoi**')
    assert.deepEqual(envois, ['/envoi?nb=&haut=15&kn=50&ga=3'], 'l\'envoi sans JavaScript, required, min et max sans effet comme avant')
  })
})
