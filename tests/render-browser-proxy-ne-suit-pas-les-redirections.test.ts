// Proxy de `render.forwardOrigin` (moteur navigateur) : la garde ne voit que la PREMIÈRE adresse,
// celle de l'origine de confiance. Le `fetch` du proxy suivait pourtant les redirections : une
// origine de confiance qui redirige (redirection ouverte) vers un serveur interne (métadonnées du
// nuage, 127.0.0.1…) y envoyait la requête. Une redirection vers une autre origine n'est plus
// suivie ; une redirection sur la même origine est rendue à la page telle quelle.
//
// L'origine de confiance est un NOM public (`confiance.example`) : la garde refuse à bon droit
// 127.0.0.1 comme origine. Sa résolution est simulée en réécrivant, dans le `fetch` du processus,
// ce nom vers le serveur de test — les options (`redirect` compris) passent telles quelles.
//
// Garde de disponibilité — même motif que tests/render-browser.test.ts : Chromium optionnel,
// tests navigateur sautés proprement s'il est absent.
import assert from 'node:assert/strict'
import { createServer, type Server } from 'node:http'
import { mkdirSync, writeFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { mjsTmp } from './helpers/tmp.js'
import * as moteur from '../src/server/render-browser.js'
import { terminateSharedWorkerPool } from '../src/bundler/index.js'

async function isChromiumAvailable(): Promise<boolean> {
  try {
    const playwright = await import('playwright')
    return existsSync(playwright.chromium.executablePath())
  } catch {
    return false
  }
}

const ecouter = (s: Server) => new Promise<number>(r => s.listen(0, '127.0.0.1', () => r((s.address() as any).port)))

describe('render-browser — le proxy de forwardOrigin ne suit pas une redirection hors de l\'origine', function () {
  let chromiumReady = false

  before(async function () {
    this.timeout(10000)
    chromiumReady = await isChromiumAvailable()
    if (!chromiumReady) console.log('  ℹ️  Chromium non installé, test render-browser-proxy-ne-suit-pas-les-redirections sauté.')
  })

  after(async () => { await terminateSharedWorkerPool() })

  it('302 vers un serveur interne : le serveur interne ne reçoit rien ; 302 sur l\'origine : suivie', async function () {
    if (!chromiumReady) { this.skip(); return }
    this.timeout(60000)
    const recuInterne: string[] = []
    const interne = createServer((req, res) => {
      recuInterne.push(`${req.method} ${req.url} cookie=${req.headers.cookie || '-'}`)
      res.setHeader('content-type', 'text/plain')
      res.end('SECRET-INTERNE')
    })
    const portInterne = await ecouter(interne)
    const confiance = createServer((req, res) => {
      if (req.url === '/api/fuite') { res.statusCode = 302; res.setHeader('location', `http://127.0.0.1:${portInterne}/secret`); res.end(); return }
      if (req.url === '/api/ancien') { res.statusCode = 302; res.setHeader('location', '/api/nouveau'); res.end(); return }
      if (req.url === '/api/nouveau') { res.setHeader('content-type', 'text/plain'); res.end('NOUVEAU'); return }
      res.statusCode = 404; res.end()
    })
    const portConfiance = await ecouter(confiance)
    const root = mjsTmp('render-browser-proxy-redirection')
    mkdirSync(join(root, 'src'), { recursive: true })
    writeFileSync(join(root, 'src', 'redir.mjs'), `
<script lang="coffee">
lire = (c) ->
  fetch(c).then((r) -> r.text().then((t) -> r.status + ' ' + t)).catch(-> 'rejet')
$p = Promise.all(['/api/fuite', '/api/ancien'].map(lire)).then((l) -> l.join(' | '))
</script>
{await $p}<span class="pending">attente</span>{success v}<span class="vu">{v}</span>{end}
`)
    const fetchOrigine = globalThis.fetch
    globalThis.fetch = ((url: any, init?: any) => fetchOrigine(String(url).replace('http://confiance.example', `http://127.0.0.1:${portConfiance}`), init)) as typeof fetch
    const renderer = await moteur.createBrowserRenderer({ sourceDir: 'src', outputDir: 'out', render: { browserPool: { size: 1 } } }, { configDir: root })
    try {
      const res = await renderer.renderPage('mjs-redir', { forwardedUrl: 'http://confiance.example/page', forwardedCookie: 'sid=COOKIE-DU-VISITEUR', settleMs: 5000 })
      const vu = (res.html.match(/<span class="vu">([^<]*)<\/span>/) || [])[1]
      assert.ok(vu !== undefined, 'les lectures doivent aboutir, html : ' + res.html.slice(0, 300))
      assert.deepEqual(recuInterne, [], 'le serveur interne ne doit recevoir AUCUNE requête')
      assert.doesNotMatch(res.html, /SECRET-INTERNE/)
      assert.match(vu!, /200 NOUVEAU/, 'une redirection sur la même origine reste suivie : ' + vu)
    } finally {
      globalThis.fetch = fetchOrigine
      await renderer.close()
      interne.close()
      confiance.close()
    }
  })
})
