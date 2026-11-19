// Fiche du fichier de page lue seulement dans son <script type="application/json"> — pourquoi ce test existe.
//
// Le manifeste (premier chargement) et la navigation interne (UJS) lisaient la fiche `__mjs_page` sur N'IMPORTE QUEL élément de la
// page qui portait cet id, et acceptaient tout chemin qui finissait par `mjs_page-….js`, `../` compris. Un contenu de visiteur
// assaini, rendu par le serveur (un `<div id="__mjs_page">` et du texte, ni script ni gestionnaire), repointait alors un composant
// vers un fichier déposé ailleurs sur le site (`/uploads/mjs_page-x.js`) : la page l'importait et l'exécutait, et le composant ne se
// montait jamais.
//
// Ce que le test garde, dans Chromium et dans Firefox, au premier chargement comme à l'arrivée par un lien interne : un tel élément
// ne fait charger aucun script, et le composant se monte depuis son propre fichier.
// Tests d'unité de la lecture à la navigation : navigation-interne-fichier-de-page.test.ts.

import assert from 'node:assert/strict'
import { createServer, type Server } from 'node:http'
import { mkdirSync, writeFileSync, readFileSync, existsSync, statSync } from 'node:fs'
import { join, extname, normalize } from 'node:path'
import { mjsTmp } from './helpers/tmp.js'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'

// le contenu du visiteur : un élément ordinaire, un id, du texte — ce qu'un assainisseur laisse passer
const VISITEUR = '<div id="__mjs_page">{"file":"../uploads/mjs_page-x.js","names":["carte"]}</div>'

const coquille = (corps: string) => `<!doctype html><html><head><meta charset="utf-8"><script type="module" src="/out/bundle.js"></script></head><body>${corps}</body></html>`

describe('fiche du fichier de page — un élément ordinaire qui en porte l\'id ne fait charger aucun script', function () {
  this.timeout(180000)
  let server: Server | null = null
  let base = ''
  let televerse: string[] = []

  before(async function () {
    const root   = mjsTmp('fiche-de-page-script')
    const srcDir = join(root, 'src')
    const outDir = join(root, 'out')
    mkdirSync(srcDir, { recursive: true })
    // un lien dans un composant : la navigation vers le serveur n'entre au cœur que si un composant en porte un
    writeFileSync(join(srcDir, 'accueil.mjs'), '<h1 class="accueil">accueil</h1>\n<a href="/visiteur">aussi vers la page du visiteur</a>\n')
    writeFileSync(join(srcDir, 'carte.mjs'), '<p class="carte">carte</p>\n')
    const bundler = new Bundler({ sourceDir: srcDir, outputDir: outDir, manifestPath: join(outDir, 'bundle.js'), urlPrefix: '/out', js: 'split', env: 'prod' } as any)
    const stats   = await bundler.compile()
    await bundler.close()
    assert.equal(stats.errors.length, 0, stats.errors.map((e: any) => e.message).join('\n'))
    const pages: Record<string, string> = {
      '/':         coquille('<a id="lien" href="/visiteur">vers la page du visiteur</a><mjs-accueil></mjs-accueil>'),
      '/visiteur': coquille(`${VISITEUR}<mjs-carte></mjs-carte>`)
    }
    server = createServer((req, res) => {
      const chemin = decodeURIComponent((req.url ?? '/').split('?')[0])
      if (pages[chemin] !== undefined) {
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
        res.end(pages[chemin])
        return
      }
      // le fichier qu'un visiteur aurait déposé sur le site
      if (chemin.startsWith('/uploads/')) {
        televerse.push(chemin)
        res.writeHead(200, { 'content-type': 'text/javascript; charset=utf-8' })
        res.end('window.__pris = (window.__pris || 0) + 1;')
        return
      }
      const fichier = join(root, normalize(chemin))
      if (!fichier.startsWith(outDir) || !existsSync(fichier) || !statSync(fichier).isFile()) { res.writeHead(404); res.end(); return }
      res.writeHead(200, { 'content-type': extname(fichier) === '.js' ? 'text/javascript; charset=utf-8' : 'application/octet-stream' })
      res.end(readFileSync(fichier))
    })
    await new Promise<void>(resolve => server!.listen(0, '127.0.0.1', () => resolve()))
    base = `http://127.0.0.1:${(server.address() as any).port}`
  })

  after(async function () {
    if (server) await new Promise(resolve => server!.close(() => resolve(null)))
    await terminateSharedWorkerPool()
  })

  // le script déposé a-t-il tourné, la carte s'est-elle montée, est-ce toujours le même document. Montée : définie, sa balise prise
  // en main par sa classe et visible (une balise de composant reste `visibility: hidden` jusqu'à son premier rendu)
  const MONTEE = `(() => { const el = document.querySelector('mjs-carte'), C = customElements.get('mjs-carte'); return !!C && el instanceof C && getComputedStyle(el).visibility === 'visible' })()`
  const etat   = (page: any) => page.evaluate(`({ pris: window.__pris ?? null, monte: ${MONTEE}, marque: window.__marque ?? null })`)
  const monte  = (page: any) => page.waitForFunction(MONTEE, null, { timeout: 5000 }).catch(() => {})

  for (const nom of ['chromium', 'firefox'] as const) {
    describe(nom, function () {
      let browser: any = null

      before(async function () {
        const playwright = await import('playwright')
        if (!existsSync(playwright[nom].executablePath())) { console.log(`  ℹ️  ${nom} non installé : test sauté`); this.skip() }
        browser = await playwright[nom].launch()
      })

      after(async function () {
        if (browser) await browser.close()
      })

      it(`premier chargement (${nom}) : la carte se monte, aucun fichier du visiteur importé`, async () => {
        televerse = []
        const page = await browser.newPage()
        try {
          await page.goto(base + '/visiteur', { waitUntil: 'load' })
          await monte(page)
          await page.waitForTimeout(300)
          const vu = await etat(page)
          assert.deepEqual(televerse, [], `fichier du visiteur demandé : ${televerse.join(' ')}`)
          assert.equal(vu.pris, null, 'le fichier désigné par le contenu du visiteur a été exécuté')
          assert.equal(vu.monte, true, 'la carte ne s\'est pas montée : son adresse a été repointée')
        }
        finally { await page.close() }
      })

      it(`arrivée par un lien interne (${nom}) : la carte se monte, aucun fichier du visiteur importé`, async () => {
        televerse = []
        const page = await browser.newPage()
        try {
          await page.goto(base + '/', { waitUntil: 'load' })
          await page.waitForFunction(() => !!customElements.get('mjs-accueil'), null, { timeout: 15000 })
          await page.evaluate(() => { (window as any).__marque = 'meme-document' })
          await page.click('#lien')
          await page.waitForFunction(() => location.pathname === '/visiteur' && !!document.querySelector('mjs-carte'), null, { timeout: 15000 })
          await monte(page)
          await page.waitForTimeout(300)
          const vu = await etat(page)
          assert.equal(vu.marque, 'meme-document', 'la page a été rechargée en entier : ce n\'est plus la navigation interne')
          assert.deepEqual(televerse, [], `fichier du visiteur demandé : ${televerse.join(' ')}`)
          assert.equal(vu.pris, null, 'le fichier désigné par le contenu reçu a été exécuté')
          assert.equal(vu.monte, true, 'la carte ne s\'est pas montée : son adresse a été repointée')
        }
        finally { await page.close() }
      })
    })
  }
})
