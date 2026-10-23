// Une page rendue par le serveur, lue SANS JavaScript : <@@select>, obligatoire ou non, simple ou multiple, envoie toujours le formulaire par
// les champs cachés que le serveur a écrits dans sa balise — une paire par valeur choisie, jamais deux. Sans JavaScript, la liste n'est pas un
// élément du formulaire : `required` n'y bloque rien, comme avant.
// Chromium, Firefox et WebKit réels, JavaScript coupé : un vrai clic sur le bouton d'envoi.

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { mjsTmp } from './helpers/tmp.js'
import { terminateSharedWorkerPool } from '../src/bundler/index.js'
import { createSSRRenderer } from '../src/server/renderToString.js'

const FRUITS = '<@@option value="abricot">Abricot</@@option><@@option value="banane">Banane</@@option><@@option value="cerise">Cerise</@@option><@@option value="figue">Figue</@@option>'

const HOTE = `<form class="f" method="get" action="/envoi" @noUJS>
  <@@select class="s" name="s" required value="banane">${FRUITS}</@@select>
  <@@select class="m" name="m" multiple required value={['cerise', 'figue']}>${FRUITS}</@@select>
  <@@select class="o" name="o" required>${FRUITS}</@@select>
  <@@select class="l" name="l" value="abricot">${FRUITS}</@@select>
  <button type="submit" class="go">envoyer</button>
</form>
`

let construit: Promise<string> | null = null

function construire() {
  construit ??= (async () => {
    const root   = mjsTmp('select-formulaire-serveur')
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

for (const nom of ['chromium', 'firefox', 'webkit'] as const) describe(`<@@select> dans une page rendue par le serveur, sans JavaScript : le formulaire part comme avant (${nom} réel)`, function () {
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

  it('le rendu porte un champ caché par valeur choisie, et un vrai envoi les porte tous, une fois chacun', async function () {
    if (!present) { this.skip(); return }
    assert.equal((html.match(/<input\b[^>]*\bmjs-f\b[^>]*>/g) || []).length, 4, 'le serveur écrit un champ par valeur choisie')
    await page.goto('http://serveur.test/page', { waitUntil: 'load' })
    await page.locator('form.f button.go').click()
    await page.waitForURL('**/envoi**')
    assert.deepEqual(envois, ['/envoi?s=banane&m=cerise&m=figue&l=abricot'], 'l\'envoi sans JavaScript, required sans effet comme avant')
  })
})
