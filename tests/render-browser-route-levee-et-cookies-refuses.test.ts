// Moteur navigateur :
// - toute levée dans le rappel de route de Playwright (fichier du dossier de sortie illisible,
//   supprimé entre deux lectures par un build concurrent) devenait un rejet jamais rattrapé qui
//   tuait le processus Node, prérendu comme serveur. La ressource répond désormais 500 et le rendu
//   continue ;
// - un visiteur qui porte un cookie `__Host-…` ou `__Secure-…` (posés par tout site https soigné),
//   ou un cookie de plus de 4 Kio, recevait une page en erreur 500 : Chromium refuse ces paires sur
//   l'origine de rendu et toute la pose échouait. Elles sont écartées, la page voit les autres.
//
// Garde de disponibilité — même motif que tests/render-browser.test.ts : Chromium optionnel.
import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, existsSync, chmodSync } from 'node:fs'
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

describe('render-browser — une ressource qui lève ne tue rien, les cookies refusés par Chromium sont écartés', function () {
  let chromiumReady = false

  before(async function () {
    this.timeout(10000)
    chromiumReady = await isChromiumAvailable()
    if (!chromiumReady) console.log('  ℹ️  Chromium non installé, test render-browser-route-levee-et-cookies-refuses sauté.')
  })

  after(async () => { await terminateSharedWorkerPool() })

  it('fichier illisible du dossier de sortie : réponse 500, rendu abouti, aucun rejet non rattrapé', async function () {
    if (!chromiumReady || typeof process.getuid !== 'function' || process.getuid() === 0) { this.skip(); return }
    this.timeout(60000)
    const rejets: string[] = []
    const temoin = (e: any) => { rejets.push(String(e && e.message || e)) }
    process.on('unhandledRejection', temoin)
    const root = mjsTmp('render-browser-illisible')
    mkdirSync(join(root, 'src'), { recursive: true })
    mkdirSync(join(root, 'out'), { recursive: true })
    const illisible = join(root, 'out', 'illisible.png')
    writeFileSync(illisible, 'x')
    chmodSync(illisible, 0o000)
    writeFileSync(join(root, 'src', 'image.mjs'), `
<script lang="coffee">
$p = fetch('/illisible.png').then((r) -> r.status).catch(-> 'rejet')
</script>
<img alt="" src="/illisible.png">{await $p}<span class="pending">attente</span>{success s}<span class="statut">{s}</span>{end}
`)
    const renderer = await createBrowserRenderer({ sourceDir: 'src', outputDir: 'out', render: { browserPool: { size: 1 } } } as any, { configDir: root })
    try {
      const res = await renderer.renderPage('mjs-image', { settleMs: 5000 })
      assert.equal((res.html.match(/<span class="statut">([^<]*)<\/span>/) || [])[1], '500', 'html : ' + res.html.slice(0, 300))
      await new Promise(r => setTimeout(r, 500))
      assert.deepEqual(rejets, [], 'aucun rejet non rattrapé ne doit sortir du gestionnaire de routes')
    } finally {
      process.off('unhandledRejection', temoin)
      chmodSync(illisible, 0o644)
      await renderer.close()
    }
  })

  it('cookies `__Host-`, `__Secure-` et de plus de 4 Kio : écartés, la page voit les autres', async function () {
    if (!chromiumReady) { this.skip(); return }
    this.timeout(60000)
    const root = mjsTmp('render-browser-cookies-refuses')
    mkdirSync(join(root, 'src'), { recursive: true })
    writeFileSync(join(root, 'src', 'gateau.mjs'), `
<script lang="coffee">
$c = document.cookie
</script>
<span class="cookies">{$c}</span>
`)
    const renderer = await createBrowserRenderer({ sourceDir: 'src', outputDir: 'out', render: { browserPool: { size: 1 } } } as any, { configDir: root })
    try {
      const lu = async (cookie: string): Promise<string> => {
        const res = await renderer.renderPage('mjs-gateau', { forwardedUrl: 'https://public.example/', forwardedCookie: cookie })
        return (res.html.match(/<span class="cookies">([^<]*)<\/span>/) || [])[1] ?? 'introuvable : ' + res.html.slice(0, 200)
      }
      const prefixes = await lu('__Host-session=abc; a=2; __Secure-next-auth.session-token=xyz; __host-bas=1')
      assert.match(prefixes, /\ba=2\b/)
      assert.doesNotMatch(prefixes, /__Host-|__Secure-|__host-/)
      const long = await lu(`long=${'x'.repeat(5000)}; b=3`)
      assert.match(long, /\bb=3\b/)
      assert.doesNotMatch(long, /long=/)
    } finally {
      await renderer.close()
    }
  })
})
