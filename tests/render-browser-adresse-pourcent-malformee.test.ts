// Moteur navigateur : chaque ressource que la page demande passe par le gestionnaire de routes de
// Playwright, qui décode le chemin. Un pourcentage malformé (`<img src="/%E0%A4%A">`, `/%zz`) faisait
// lever ce décodage DANS le rappel de Playwright : rejet jamais rattrapé, et le processus Node entier
// tombait (build de prérendu ou serveur `mjs serve`/`mjs dev`). Une telle adresse doit répondre 400.
//
// Garde de disponibilité — même motif que tests/render-browser.test.ts : Chromium optionnel.
import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { mjsTmp } from './helpers/tmp.js'
import { createBrowserRenderer } from '../src/server/render-browser.js'
import { terminateSharedWorkerPool } from '../src/bundler/index.js'

async function isChromiumAvailable(): Promise<boolean> {
  try {
    const playwright = await import('playwright')
    return existsSync(playwright.chromium.executablePath())
  } catch {
    return false
  }
}

describe('render-browser — une ressource à l\'adresse malformée ne tue jamais le processus', function () {
  let chromiumReady = false

  before(async function () {
    this.timeout(10000)
    chromiumReady = await isChromiumAvailable()
    if (!chromiumReady) {
      console.log('  ℹ️  Chromium non installé, test render-browser-adresse-pourcent-malformee sauté.')
    }
  })

  after(async () => { await terminateSharedWorkerPool() })

  it('`<img src="/%E0%A4%A">` et `fetch(\'/%zz\')` : réponse 400, rendu abouti, aucun rejet non rattrapé', async function () {
    if (!chromiumReady) { this.skip(); return }
    this.timeout(60000)
    const rejets: string[] = []
    const temoin = (e: any) => { rejets.push(String(e && e.message || e)) }
    process.on('unhandledRejection', temoin)
    const root = mjsTmp('render-browser-pourcent')
    mkdirSync(join(root, 'src'), { recursive: true })
    writeFileSync(join(root, 'src', 'pourcent.mjs'), `
<script lang="coffee">
$p = fetch('/%zz').then((r) -> r.status).catch(-> 'rejet')
</script>
<img src="/%E0%A4%A">{await $p}<span class="pending">attente</span>{success s}<span class="statut">{s}</span>{end}
`)
    const renderer = await createBrowserRenderer({ sourceDir: 'src', outputDir: 'out', render: { browserPool: { size: 1 } } }, { configDir: root })
    try {
      const res = await renderer.renderPage('mjs-pourcent', { settleMs: 5000 })
      assert.equal((res.html.match(/<span class="statut">([^<]*)<\/span>/) || [])[1], '400', 'html : ' + res.html.slice(0, 300))
      // l'image part en parallèle du rendu : laisse au rappel de route le temps de finir
      await new Promise(r => setTimeout(r, 500))
      assert.deepEqual(rejets, [], 'aucun rejet non rattrapé ne doit sortir du gestionnaire de routes')
    } finally {
      process.off('unhandledRejection', temoin)
      await renderer.close()
    }
  })
})
