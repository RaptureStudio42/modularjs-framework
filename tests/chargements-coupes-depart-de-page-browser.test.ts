// Une requête du runtime coupée parce que le visiteur quitte la page ne s'écrit plus comme une erreur ; une vraie panne réseau,
// page ouverte, reste dite. Vrais navigateurs (Chromium, Firefox, WebKit), vrai build servi par HTTP.
//
// Pourquoi ce test existe : Firefox et Safari coupent les requêtes en vol dès que la navigation part (juste après `beforeunload`,
// lien comme barre d'adresse ou rechargement), bien avant `pagehide` — la page reste en place le temps que la suivante réponde, et
// chaque chargement coupé écrivait son erreur dans la console : le module d'un composant (« [Autoloader] ❌ Failed to import … »,
// suivi d'un rechargement de la page pris pour un bundle périmé, en pleine navigation), le fragment de traduction
// (« i18n : échec de chargement de … »). Le seul signe que la page s'en va est le départ annoncé (navigation vers un autre
// document, `beforeunload`) puis confirmé (`pagehide`). Chromium, lui, ne coupe qu'après `pagehide` : il passe des deux côtés.
//
// Montage : la page porte un composant dont le module est retenu par le serveur et un module dont le fragment de traduction est
// retenu de même ; le visiteur part pendant l'attente, par un lien posé en script puis par la barre d'adresse. Vraie panne : le
// serveur coupe la connexion du module, puis celle du fragment, la page reste ouverte, l'erreur s'écrit (une à la fois, chacune
// dans sa page ; une connexion qui tombe ne fait pas recharger la page, cf. tests/depart-sans-chargement-en-vol-browser.test.ts).

import assert from 'node:assert/strict'
import { createServer, type Server } from 'node:http'
import { mkdirSync, writeFileSync, readFileSync, existsSync, statSync } from 'node:fs'
import { join, extname, normalize, basename } from 'node:path'
import { mjsTmp } from './helpers/tmp.js'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { findConfig, resolveBundlerOpts } from '../src/bundler/config.js'

const RETENU = (chemin: string) => /\/i18n\/[^/]+\/[^/]+\.json$/.test(chemin) || /^lent-[0-9a-z]+\.js$/.test(basename(chemin))
// ce que le runtime écrit ; les lignes du navigateur lui-même (« Failed to load resource », « Loading failed for the module »)
// ne viennent pas du code de la page et ne se taisent pas
const DU_RUNTIME = /\[Autoloader\]|\[ModularJS\]|i18n/

type Mode = 'retenu' | 'module' | 'fragment'

interface Serveur { base: string, server: Server, etat: { mode: Mode, vus: Set<string> } }

async function construire(): Promise<Serveur> {
  const root   = mjsTmp('depart-de-page')
  const srcDir = join(root, 'src')
  const outDir = join(root, 'out')
  mkdirSync(join(srcDir, 'i18n', 'fr'), { recursive: true })
  writeFileSync(join(srcDir, 'i18n', 'fr.yml'), 'titre: Titre\n')
  writeFileSync(join(srcDir, 'i18n', 'fr', 'accueil.yml'), 'titre: Bonjour accueil\n')
  writeFileSync(join(srcDir, 'page.mjs'), ["@i18n 'accueil'", '', '<h1 class="t">{µt(\'titre\')}</h1>', ''].join('\n'))
  writeFileSync(join(srcDir, 'lent.mjs'), ['<p class="lent">LENT</p>', ''].join('\n'))
  writeFileSync(join(root, 'mjs.config.json'), JSON.stringify({ sourceDir: 'src', outputDir: 'out', manifestPath: 'out/bundle.js', urlPrefix: '/out', i18n: { default: 'fr', placeholder: 'wait' } }, null, 2))
  const found   = findConfig(root)!
  const bundler = new Bundler({ ...resolveBundlerOpts(found.config, found.configDir), env: 'dev' } as any)
  const stats   = await bundler.compile()
  await bundler.close()
  assert.equal(stats.errors.length, 0, stats.errors.map((e: any) => e.message).join('\n'))
  const etat = { mode: 'retenu' as Mode, vus: new Set<string>() }
  const coquille = (corps: string) => `<!doctype html><html><head><meta charset="utf-8"><script type="module" src="/out/bundle.js"></script></head><body>${corps}</body></html>`
  const server = createServer((req, res) => {
    const chemin = decodeURIComponent((req.url ?? '/').split('?')[0])
    if (chemin === '/' || chemin === '/ailleurs') {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
      res.end(chemin === '/' ? coquille('<mjs-page></mjs-page><mjs-lent></mjs-lent>') : '<!doctype html><p>AILLEURS</p>')
      return
    }
    const fichier = join(root, normalize(chemin))
    if (!fichier.startsWith(outDir) || !existsSync(fichier) || !statSync(fichier).isFile()) { res.writeHead(404); res.end(); return }
    const quoi = RETENU(chemin) ? (/\.json$/.test(chemin) ? 'fragment' : 'module') : ''
    if (quoi) etat.vus.add(quoi)
    // retenu : la réponse ne vient pas (le départ la coupe) ; panne du module ou du fragment : sa connexion tombe, page ouverte
    if (quoi && etat.mode === 'retenu') return
    if (quoi && etat.mode === quoi) { setTimeout(() => res.destroy(), 200); return }
    res.writeHead(200, { 'content-type': extname(fichier) === '.js' ? 'text/javascript; charset=utf-8' : 'application/json' })
    res.end(readFileSync(fichier))
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', () => resolve()))
  return { base: `http://127.0.0.1:${(server.address() as any).port}`, server, etat }
}

async function navigateurPresent(nom: string): Promise<boolean> {
  try {
    const playwright: any = await import('playwright')
    return existsSync(playwright[nom].executablePath())
  }
  catch {
    return false
  }
}

// la page reste ouverte jusqu'à ce que la ligne attendue s'écrive (Firefox retente une requête dont la connexion tombe : l'échec
// arrive plus tard qu'ailleurs), 10 s au plus
async function attendreLigne(page: any, lignes: string[], motif: RegExp): Promise<void> {
  const debut = Date.now()
  while (!lignes.some((l) => motif.test(l)) && Date.now() - debut < 10000) await page.waitForTimeout(100)
}

let serveur: Promise<Serveur> | null = null

for (const nom of ['chromium', 'firefox', 'webkit'] as const) {
  describe(`chargements coupés par le départ de la page — ${nom} réel`, function () {
    this.timeout(120000)
    let browser: any = null
    let s: Serveur

    before(async function () {
      if (!await navigateurPresent(nom)) { console.log(`  ℹ️  ${nom} non installé : test sauté`); this.skip() }
      serveur ??= construire()
      s = await serveur
      browser = await (await import('playwright'))[nom].launch()
    })

    after(async () => { await browser?.close() })

    // ouvre la page, attend que le module et le fragment soient en route, joue `geste`, puis rend les lignes écrites par le runtime
    const ouvrir = async (mode: Mode, geste: (page: any, lignes: string[]) => Promise<void>): Promise<string[]> => {
      s.etat.mode = mode
      s.etat.vus.clear()
      const page   = await browser.newPage()
      const lignes: string[] = []
      page.on('console', (m: any) => { if ((m.type() === 'error' || m.type() === 'warning') && DU_RUNTIME.test(m.text())) lignes.push(m.type() + ' ' + m.text()) })
      page.on('pageerror', (e: Error) => lignes.push('pageerror ' + e.message))
      try {
        await page.goto(s.base + '/', { waitUntil: 'domcontentloaded' })
        const debut = Date.now()
        while (s.etat.vus.size < 2 && Date.now() - debut < 15000) await page.waitForTimeout(50)
        assert.equal(s.etat.vus.size, 2, 'le module et le fragment sont demandés')
        await page.waitForTimeout(150)
        await geste(page, lignes)
        return lignes
      }
      finally {
        await page.close()
      }
    }

    it('départ par un lien (navigation lancée par la page) : aucune erreur du runtime', async () => {
      const lignes = await ouvrir('retenu', async (page) => {
        await page.evaluate(() => { location.href = '/ailleurs' })
        await page.waitForURL('**/ailleurs', { timeout: 15000 })
        await page.waitForTimeout(1000)
      })
      assert.deepEqual(lignes, [])
    })

    it('départ par la barre d\'adresse : aucune erreur du runtime', async () => {
      const lignes = await ouvrir('retenu', async (page) => {
        await page.goto(s.base + '/ailleurs', { waitUntil: 'load' })
        await page.waitForTimeout(1000)
      })
      assert.deepEqual(lignes, [])
    })

    it('vraie panne réseau du module, page ouverte : l\'erreur s\'écrit', async () => {
      const lignes = await ouvrir('module', (page, l) => attendreLigne(page, l, /Failed to import lent/))
      assert.ok(lignes.some((l) => /^error \[Autoloader\] ❌ Failed to import lent/.test(l)), 'le module perdu est dit — ' + JSON.stringify(lignes))
    })

    it('vraie panne réseau du fragment de traduction, page ouverte : l\'erreur s\'écrit', async () => {
      const lignes = await ouvrir('fragment', (page, l) => attendreLigne(page, l, /échec de chargement de « accueil »/))
      assert.ok(lignes.some((l) => /^error .*échec de chargement de « accueil » \(fr\)/.test(l)), 'le fragment perdu est dit — ' + JSON.stringify(lignes))
    })
  })
}

after(async () => {
  if (serveur) (await serveur).server.close()
  await terminateSharedWorkerPool()
})
