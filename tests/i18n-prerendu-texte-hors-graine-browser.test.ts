// Page prérendue : un texte absent de la graine (clé que le serveur n'a pas lue, ici une clé racine que seul le navigateur lit) n'est jamais perdu, dans un vrai Chromium.
//
// Le HTML prérendu porte la graine `#__mjs_i18n` (langue du rendu, sections et textes racine lus). Un module de cette page paraît aussitôt avec les
// textes de la graine, sans attente, sans retenue cachée, sans indicateur de chargement ni délai de secours, quel que soit le
// réglage `placeholder` (`wait`, `*loader`, `*skeleton`, `key`). Un texte que la graine ne porte pas (ici une clé racine lue
// seulement quand le navigateur rend le module) arrive avec le fichier de langue, et le module se rend une seconde fois avec lui :
// le texte final est juste, jamais perdu. Les textes racine que le serveur lit, eux, sont dans la graine (voir
// i18n-graine-cles-racine-browser.test.ts).
//
// Le fichier de langue est volontairement retardé (700 ms) pour que l'attente se voie : le texte du module est relevé à chaque image
// (`requestAnimationFrame`), depuis la première.

import assert from 'node:assert/strict'
import { createServer, type Server } from 'node:http'
import { mkdirSync, writeFileSync, readFileSync, existsSync, statSync } from 'node:fs'
import { join, extname, normalize } from 'node:path'
import { mjsTmp } from './helpers/tmp.js'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { findConfig, resolveBundlerOpts } from '../src/bundler/config.js'
import { prerenderPages } from '../src/server/prerender.js'
import { emitStartup } from '../src/bundler/startup.js'

async function chromiumDisponible(): Promise<any> {
  try {
    const playwright = await import('playwright')
    if (!existsSync(playwright.chromium.executablePath())) return null
    return await playwright.chromium.launch()
  }
  catch {
    return null
  }
}

const SIMPLE = '@i18n \'accueil\'\n<h1 class="t">{µt(\'salut\')}</h1>\n'
const RACINE = '@i18n \'accueil\'\n<h1 class="t">{µt(\'salut\')} / {if not µ.server}{µt(\'/titre\')}{end}</h1>\n'
const BARRES = ' '.repeat(12)

type Scenario = { nom: string; placeholder?: string; home: string; final: string; verifier: (vus: string[]) => void }

const SCENARIOS: Scenario[] = [
  {
    nom: 'attente (`wait`), clé racine lue par le navigateur seulement : le texte de la graine paraît aussitôt, la clé racine arrive ensuite',
    home: RACINE,
    final: 'Bonjour accueil / Titre',
    verifier: (vus) => {
      assert.equal(vus[0].startsWith('Bonjour accueil'), true, `premier texte vu : ${JSON.stringify(vus)}`)
      assert.equal(vus.every(v => v.startsWith('Bonjour accueil')), true, `jamais vide : ${JSON.stringify(vus)}`)
    }
  },
  {
    nom: '`*loader`, clé racine lue par le navigateur seulement : texte aussitôt, texte final juste',
    placeholder: '*loader(bloom)',
    home: RACINE,
    final: 'Bonjour accueil / Titre',
    verifier: (vus) => {
      assert.equal(vus.every(v => v.startsWith('Bonjour accueil')), true, `jamais vide : ${JSON.stringify(vus)}`)
    }
  },
  {
    nom: '`*skeleton`, clé racine lue par le navigateur seulement : le texte de la graine paraît aussitôt (barres à la place du manquant), puis le texte final',
    placeholder: '*skeleton',
    home: RACINE,
    final: 'Bonjour accueil / Titre',
    verifier: (vus) => {
      assert.equal(vus.every(v => v.startsWith('Bonjour accueil')), true, `jamais vide : ${JSON.stringify(vus)}`)
      assert.deepEqual(vus, ['Bonjour accueil / ', 'Bonjour accueil / ' + BARRES, 'Bonjour accueil / Titre'], 'texte du HTML reçu (sans la clé racine, le serveur ne la lit pas), barres le temps du fichier de langue, texte final')
    }
  },
  {
    nom: '`key`, clé racine lue par le navigateur seulement : texte aussitôt, texte final juste',
    placeholder: 'key',
    home: RACINE,
    final: 'Bonjour accueil / Titre',
    verifier: (vus) => {
      assert.equal(vus.every(v => v.startsWith('Bonjour accueil')), true, `jamais vide : ${JSON.stringify(vus)}`)
    }
  },
  {
    nom: 'attente (`wait`), sans clé racine : une seule valeur visible, celle du HTML reçu',
    home: SIMPLE,
    final: 'Bonjour accueil',
    verifier: (vus) => { assert.deepEqual(vus, ['Bonjour accueil']) }
  },
  {
    nom: '`*loader`, sans clé racine : une seule valeur visible',
    placeholder: '*loader(bloom)',
    home: SIMPLE,
    final: 'Bonjour accueil',
    verifier: (vus) => { assert.deepEqual(vus, ['Bonjour accueil']) }
  },
  {
    nom: '`*skeleton`, sans clé racine : une seule valeur visible',
    placeholder: '*skeleton',
    home: SIMPLE,
    final: 'Bonjour accueil',
    verifier: (vus) => { assert.deepEqual(vus, ['Bonjour accueil']) }
  }
]

describe('page prérendue : texte hors graine jamais perdu (Chromium)', function () {
  this.timeout(240000)
  let browser: any = null

  before(async function () {
    browser = await chromiumDisponible()
    if (!browser) { console.log('  ℹ️  Chromium non installé : test sauté'); this.skip() }
  })

  after(async function () {
    if (browser) await browser.close()
    await terminateSharedWorkerPool()
  })

  for (const sc of SCENARIOS) {
    describe(sc.nom, function () {
      let server: Server | null = null
      let base = ''

      before(async function () {
        const root   = mjsTmp('i18n-prerendu-hors-graine')
        const srcDir = join(root, 'src')
        const outDir = join(root, 'out')
        mkdirSync(join(srcDir, 'i18n', 'fr'), { recursive: true })
        mkdirSync(join(srcDir, 'i18n', 'en'), { recursive: true })
        writeFileSync(join(srcDir, 'i18n', 'fr.yml'), 'titre: Titre\n')
        writeFileSync(join(srcDir, 'i18n', 'en.json'), JSON.stringify({ titre: 'Title' }))
        writeFileSync(join(srcDir, 'i18n', 'fr', 'accueil.yml'), 'salut: Bonjour accueil\n')
        writeFileSync(join(srcDir, 'i18n', 'en', 'accueil.json'), JSON.stringify({ salut: 'Hello home' }))
        writeFileSync(join(srcDir, 'home.mjs'), sc.home)
        const i18n: any = { default: 'fr', urlParam: true }
        if (sc.placeholder) i18n.placeholder = sc.placeholder
        writeFileSync(join(root, 'mjs.config.json'), JSON.stringify({
          sourceDir: 'src', outputDir: 'out', manifestPath: 'out/bundle.js', urlPrefix: '/out', i18n,
          render: { default: 'prerender', engine: { prerender: 'happy-dom' }, startup: 'bundle', routes: { '/': { component: 'mjs-home' } } },
        }, null, 2))
        const found = findConfig(root)!
        const bundler = new Bundler({ ...resolveBundlerOpts(found.config, found.configDir), env: 'prod' } as any)
        const stats = await bundler.compile()
        assert.equal(stats.errors.length, 0, stats.errors.map((e: any) => e.message).join('\n'))
        const report = await prerenderPages(found.config, found.configDir, () => {}, { env: 'prod' })
        await emitStartup(bundler, found.config.render, report, { prod: true, log: () => {} })
        await bundler.close()
        const corps = readFileSync(report.generated.find(g => g.url === '/')!.file, 'utf-8')
        assert.ok(/id="__mjs_i18n"/.test(corps), 'le prérendu porte sa graine de traduction')
        server = createServer((req, res) => {
          const chemin = decodeURIComponent((req.url ?? '/').split('?')[0])
          if (chemin === '/') {
            res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
            res.end(`<!doctype html><html><head><meta charset="utf-8"><script type="module" src="/out/bundle.js"></script></head><body>${corps}</body></html>`)
            return
          }
          const fichier = join(root, normalize(chemin))
          if (!fichier.startsWith(outDir) || !existsSync(fichier) || !statSync(fichier).isFile()) { res.writeHead(404); res.end(); return }
          const envoyer = () => {
            res.writeHead(200, { 'content-type': extname(fichier) === '.js' ? 'text/javascript; charset=utf-8' : 'application/json' })
            res.end(readFileSync(fichier))
          }
          // le fichier de langue traîne : l'attente se voit
          if (/\/mjs_i18n-[^/]*\.js$/.test(chemin)) setTimeout(envoyer, 700)
          else envoyer()
        })
        await new Promise<void>(resolve => server!.listen(0, '127.0.0.1', () => resolve()))
        base = `http://127.0.0.1:${(server.address() as any).port}`
      })

      after(async function () {
        if (server) await new Promise(resolve => server!.close(() => resolve(null)))
      })

      it('texte relevé image par image', async function () {
        const page = await browser.newPage()
        const erreurs: string[] = []
        page.on('pageerror', (e: Error) => erreurs.push(e.message))
        page.on('console', (m: any) => { if (m.type() === 'error') erreurs.push(m.text()) })
        // relève le texte du module à chaque image, et note tout signe d'attente posé sur l'hôte prérendu
        await page.addInitScript(() => {
          const w = window as any
          w.__vus = []
          w.__signes = []
          const tick = () => {
            const h = document.querySelector('mjs-home') as any
            const r = h && (h._shadow || h.shadowRoot)
            const t = r && r.querySelector('h1.t')
            if (t) {
              const v = t.textContent
              if (w.__vus.length === 0 || w.__vus[w.__vus.length - 1] !== v) w.__vus.push(v)
            }
            if (h && h.hasAttribute('mjs-loading') && !w.__signes.includes('mjs-loading')) w.__signes.push('mjs-loading')
            if (document.querySelector('[mjs-i18n-loader]') && !w.__signes.includes('loader')) w.__signes.push('loader')
            requestAnimationFrame(tick)
          }
          requestAnimationFrame(tick)
        })
        try {
          await page.goto(base + '/', { waitUntil: 'load' })
          await page.waitForFunction(() => !!customElements.get('mjs-home'), null, { timeout: 15000 })
          await page.waitForTimeout(2500)
          const vus: string[] = await page.evaluate(() => (window as any).__vus)
          const signes: string[] = await page.evaluate(() => (window as any).__signes)
          assert.deepEqual(erreurs, [], `erreurs : ${erreurs.join(' | ')}`)
          assert.deepEqual(signes, [], 'aucun indicateur ni retenue posé sur l\'hôte prérendu')
          assert.equal(vus[vus.length - 1], sc.final, `texte final : ${JSON.stringify(vus)}`)
          sc.verifier(vus)
        }
        finally { await page.close() }
      })
    })
  }
})
