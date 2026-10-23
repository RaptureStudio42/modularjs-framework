// Proxy de `render.forwardOrigin` (moteur navigateur) : l'adresse amont se compose à partir du chemin
// que la page demande. Une barre inverse (`/%5Chote/x`, décodée en `/\hote/x`), un slash encodé
// (`/%2F%2Fhote/x`) ou un double slash (`/api/..//hote/x`, que Chromium réduit en `//hote/x`)
// changeaient l'HÔTE de cette adresse : le proxy partait vers un serveur arbitraire, interne compris,
// en y joignant le cookie du visiteur. L'adresse composée doit garder EXACTEMENT l'origine de
// confiance, sinon aucune requête ne part.
//
// Garde de disponibilité — même motif que tests/render-browser.test.ts : Chromium optionnel,
// tests navigateur sautés proprement s'il est absent.
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
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

describe('render-browser — le proxy de forwardOrigin ne quitte jamais l\'origine de confiance', function () {
  let chromiumReady = false

  before(async function () {
    this.timeout(10000)
    chromiumReady = await isChromiumAvailable()
    if (!chromiumReady) {
      console.log('  ℹ️  Chromium non installé, test render-browser-proxy-reste-sur-l-origine sauté.')
    }
  })

  after(async () => { await terminateSharedWorkerPool() })

  it('adresse amont : un chemin ordinaire reste sur l\'origine, requête comprise', () => {
    const adresse = (moteur as any).adresseAmontDuProxy('/api/x', '?q=1', 'https://public.example')
    assert.equal(adresse && adresse.href, 'https://public.example/api/x?q=1')
  })

  it('adresse amont : double slash, barre inverse, triple slash — aucune adresse', () => {
    for (const chemin of ['//127.0.0.1:9/x', '/\\127.0.0.1:9/x', '\\\\127.0.0.1:9/x', '///127.0.0.1:9/x', '//public.example.evil/x']) {
      assert.equal((moteur as any).adresseAmontDuProxy(chemin, '', 'https://public.example'), null, chemin)
    }
  })

  it('page rendue : `//hote/x`, `/\\hote/x`, `/%5Chote/x`, `/%2F%2Fhote/x`, `/api/..//hote/x` — le serveur interne ne reçoit rien, ni requête ni cookie', async function () {
    if (!chromiumReady) { this.skip(); return }
    this.timeout(60000)
    const recu: string[] = []
    const interne = createServer((req, res) => {
      recu.push(`${req.method} ${req.url} cookie=${req.headers.cookie || '-'}`)
      res.setHeader('content-type', 'text/plain')
      res.end('SECRET-INTERNE')
    })
    await new Promise<void>(r => interne.listen(0, '127.0.0.1', () => r()))
    const port = (interne.address() as any).port
    const root = mjsTmp('render-browser-proxy-origine')
    mkdirSync(join(root, 'src'), { recursive: true })
    const chemins = [
      `//127.0.0.1:${port}/a`,
      `/\\127.0.0.1:${port}/b`,
      `/%5C127.0.0.1:${port}/c`,
      `/%2F%2F127.0.0.1:${port}/d`,
      `/api/..//127.0.0.1:${port}/e`,
    ]
    writeFileSync(join(root, 'src', 'ssrf.mjs'), `
<script lang="coffee">
lire = (c) ->
  fetch(c).then((r) -> r.text().then((t) -> r.status + ' ' + t)).catch(-> 'rejet')
$p = Promise.all(${JSON.stringify(chemins)}.map(lire)).then((l) -> l.join(' | '))
</script>
{await $p}<span class="pending">attente</span>{success v}<span class="vu">{v}</span>{end}
`)
    const renderer = await moteur.createBrowserRenderer({ sourceDir: 'src', outputDir: 'out', render: { browserPool: { size: 1 } } }, { configDir: root })
    try {
      const res = await renderer.renderPage('mjs-ssrf', { forwardedUrl: 'http://public.example/page', forwardedCookie: 'sid=COOKIE-DU-VISITEUR', settleMs: 5000 })
      const vu = (res.html.match(/<span class="vu">([^<]*)<\/span>/) || [])[1]
      assert.ok(vu !== undefined, 'les cinq lectures doivent aboutir (réponse ou rejet), html : ' + res.html.slice(0, 300))
      assert.deepEqual(recu, [], 'le serveur interne ne doit recevoir AUCUNE requête')
      assert.doesNotMatch(res.html, /SECRET-INTERNE|COOKIE-DU-VISITEUR/)
    } finally {
      await renderer.close()
      interne.close()
    }
  })
})
