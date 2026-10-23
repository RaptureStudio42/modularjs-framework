// Le délai de secours réglé, dans de vrais navigateurs (Chromium, Firefox, WebKit) : un vrai build de production servi par HTTP avec
// `"i18n": { "timeout": "400ms" }` et `"effects": { "skeleton": [] }`, la requête du fragment de traduction qui ne répond jamais.
// Le module reste caché jusque vers 400 ms (pas avant), puis paraît avec des barres grises — que `effects.skeleton` vide ne coupe
// pas — et les vrais textes les remplacent à l'arrivée du fragment.

import assert from 'node:assert/strict'
import { createServer, type Server } from 'node:http'
import { mkdirSync, writeFileSync, readFileSync, existsSync, statSync } from 'node:fs'
import { join, extname, normalize } from 'node:path'
import { mjsTmp } from './helpers/tmp.js'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { findConfig, resolveBundlerOpts } from '../src/bundler/config.js'

const SECTION = /\/i18n\/[^/]+\/[^/]+\.json$/
const BARRE   = '\u2007'.repeat(12)

type Navigateur = 'chromium' | 'firefox' | 'webkit'
interface Construction { base: string, retenues: Array<() => void>, server: Server }

async function navigateurPresent(nom: Navigateur): Promise<boolean> {
  try {
    const playwright = await import('playwright')
    return existsSync(playwright[nom].executablePath())
  }
  catch {
    return false
  }
}

let construction: Promise<Construction> | null = null

async function bati(): Promise<Construction> {
  const root   = mjsTmp('i18n-attente-delai-browser')
  const srcDir = join(root, 'src')
  const outDir = join(root, 'out')
  mkdirSync(join(srcDir, 'i18n', 'fr'), { recursive: true })
  writeFileSync(join(srcDir, 'i18n', 'fr.yml'), 'titre: Titre\n')
  writeFileSync(join(srcDir, 'i18n', 'fr', 'accueil.yml'), 'titre: Bonjour accueil\n')
  writeFileSync(join(srcDir, 'att-wait.mjs'), ["@i18n 'accueil'", '<h1 class="t">{µt(\'titre\')}</h1>', '<p class="fixe">partie fixe</p>', ''].join('\n'))
  writeFileSync(join(root, 'mjs.config.json'), JSON.stringify({
    sourceDir: 'src', outputDir: 'out', manifestPath: 'out/bundle.js', urlPrefix: '/out',
    i18n: { default: 'fr', timeout: '400ms' },
    effects: { skeleton: [] },
  }, null, 2))
  const found   = findConfig(root)!
  const bundler = new Bundler({ ...resolveBundlerOpts(found.config, found.configDir), env: 'prod' } as any)
  const stats   = await bundler.compile()
  assert.equal(stats.errors.length, 0, stats.errors.map((e: any) => e.message).join('\n'))
  await bundler.close()
  const retenues: Array<() => void> = []
  const coquille = '<!doctype html><html><head><meta charset="utf-8"><script type="module" src="/out/bundle.js"></script></head><body><mjs-att-wait></mjs-att-wait></body></html>'
  const server = createServer((req, res) => {
    const chemin = decodeURIComponent((req.url ?? '/').split('?')[0])
    if (chemin === '/attente') {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
      res.end(coquille)
      return
    }
    const fichier = join(root, normalize(chemin))
    if (!fichier.startsWith(outDir) || !existsSync(fichier) || !statSync(fichier).isFile()) { res.writeHead(404); res.end(); return }
    const envoyer = () => {
      res.writeHead(200, { 'content-type': extname(fichier) === '.js' ? 'text/javascript; charset=utf-8' : 'application/json' })
      res.end(readFileSync(fichier))
    }
    // le fragment de traduction ne répond que quand le test le libère
    if (SECTION.test(chemin)) retenues.push(envoyer)
    else envoyer()
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', () => resolve()))
  return { base: `http://127.0.0.1:${(server.address() as any).port}`, retenues, server }
}

// l'instant où le module paraît AVEC son contenu (une boîte de rendu et son titre), et son titre brut à chaque image où il est visible
const SONDE = () => {
  const w = window as any
  w.__vu = 0
  w.__titres = []
  const tick = () => {
    const h: any = document.querySelector('mjs-att-wait')
    const o      = h && (h._shadow || h.shadowRoot)
    const t      = o && o.querySelector('h1.t')
    const vu     = !!h && h.getClientRects().length > 0 && !!t
    if (vu && !w.__vu) w.__vu = performance.now()
    if (vu && w.__titres[w.__titres.length - 1] !== t.textContent) w.__titres.push(t.textContent)
    requestAnimationFrame(tick)
  }
  requestAnimationFrame(tick)
}

describe('délai de secours réglé — dans de vrais navigateurs', function () {
  for (const nom of ['chromium', 'firefox', 'webkit'] as const) {
    describe(`délai de secours réglé — ${nom}, production`, function () {
      this.timeout(120000)
      let browser: any = null
      let c: Construction

      before(async function () {
        if (!await navigateurPresent(nom)) { console.log(`  ℹ️  ${nom} non installé : test sauté. Activer : \`npx playwright install ${nom}\``); this.skip() }
        if (!construction) construction = bati()
        c = await construction
        browser = await (await import('playwright'))[nom].launch()
      })

      afterEach(() => { if (c) c.retenues.splice(0) })

      after(async function () {
        if (browser) await browser.close()
      })

      it('timeout "400ms" : caché avant, des barres vers 400 ms (pas 3 s), même avec effects.skeleton vide, puis les vrais textes', async () => {
        const page = await browser.newPage()
        await page.addInitScript(SONDE)
        try {
          await page.goto(c.base + '/attente', { waitUntil: 'load' })
          await page.waitForFunction(() => (window as any).__vu > 0, null, { timeout: 20000 })
          const vu: number = await page.evaluate(() => (window as any).__vu)
          const titres: string[] = await page.evaluate(() => (window as any).__titres)
          assert.ok(vu >= 350, `pas avant le délai réglé (paru à ${Math.round(vu)} ms)`)
          assert.ok(vu < 2500, `bien avant les 3 s du défaut (paru à ${Math.round(vu)} ms)`)
          assert.equal(titres[0], BARRE, 'des barres à la place du texte, effects.skeleton vide ou non')
          c.retenues.splice(0).forEach(f => f())
          await page.waitForFunction(() => { const t = (window as any).__titres; return t[t.length - 1] === 'Bonjour accueil' }, null, { timeout: 20000 })
        }
        finally { await page.close() }
      })
    })
  }

  after(async function () {
    if (construction) {
      const k = await construction
      await new Promise(resolve => k.server.close(() => resolve(null)))
      construction = null
    }
    await terminateSharedWorkerPool()
  })
})
