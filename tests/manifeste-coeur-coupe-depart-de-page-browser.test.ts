// Le cœur du runtime coupé parce que le visiteur quitte la page ne s'écrit plus comme une erreur ; une vraie panne du cœur,
// page ouverte, reste dite. Vrais navigateurs (Chromium, Firefox, WebKit), vrai build servi par HTTP.
//
// Pourquoi ce test existe : le manifeste (`bundle.js`) importe le cœur (`import(µCore)`) sans traiter son échec. Firefox et
// Safari coupent les requêtes en vol dès que la navigation part (juste après `beforeunload`), la page restant affichée jusqu'à
// la réponse de la suivante : quitter la page pendant que le cœur arrive écrivait une erreur non rattrapée (« error loading
// dynamically imported module … mjs_core-….js », « Importing a module script failed »). Chromium ne coupe qu'après `pagehide` :
// il passe des deux côtés. Le cœur n'étant pas là, l'aide du cœur ne peut rien : le manifeste applique la même règle (départ
// annoncé par `beforeunload` pendant le démarrage, confirmé par `pagehide`). Le manifeste taisait l'échec 10 s après l'annonce,
// puis l'écrivait si la page était encore là : une page suivante plus lente que 10 s le voyait écrit, erreur non rattrapée.
//
// Montage : le serveur retient le cœur ; le visiteur part pendant l'attente, par un lien posé en script puis par la barre
// d'adresse, la page suivante répondant tout de suite ou après 13 s. Vraie panne : le serveur coupe la connexion du cœur, la
// page reste ouverte, l'erreur s'écrit.

import assert from 'node:assert/strict'
import { createServer, type Server } from 'node:http'
import { mkdirSync, writeFileSync, readFileSync, existsSync, statSync } from 'node:fs'
import { join, extname, normalize, basename } from 'node:path'
import { mjsTmp } from './helpers/tmp.js'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'

const COEUR = (chemin: string) => /^mjs_core-[0-9a-z]+\.js$/.test(basename(chemin))
// lignes du navigateur lui-même sur une requête coupée : elles ne viennent pas du code de la page et ne se taisent pas
const DU_NAVIGATEUR = /Loading failed for the module|Failed to load resource|Le chargement a échoué/

type Mode = 'retenu' | 'panne'

interface Serveur { base: string, server: Server, etat: { mode: Mode, vus: number, delai: number } }

async function construire(): Promise<Serveur> {
  const root   = mjsTmp('coeur-depart-de-page')
  const srcDir = join(root, 'src')
  const outDir = join(root, 'out')
  mkdirSync(srcDir, { recursive: true })
  writeFileSync(join(srcDir, 'page.mjs'), '<h1 class="t">Bonjour</h1>\n')
  const bundler = new Bundler({ sourceDir: srcDir, outputDir: outDir, manifestPath: join(outDir, 'bundle.js'), urlPrefix: '/out', env: 'dev' } as any)
  const stats   = await bundler.compile()
  await bundler.close()
  assert.equal(stats.errors.length, 0, stats.errors.map((e: any) => e.message).join('\n'))
  const etat = { mode: 'retenu' as Mode, vus: 0, delai: 0 }
  const coquille = '<!doctype html><html><head><meta charset="utf-8"><script type="module" src="/out/bundle.js"></script></head><body><mjs-page></mjs-page></body></html>'
  const server = createServer((req, res) => {
    const chemin = decodeURIComponent((req.url ?? '/').split('?')[0])
    if (chemin === '/' || chemin === '/ailleurs') {
      // la page suivante répond après `etat.delai` ms
      setTimeout(() => {
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
        res.end(chemin === '/' ? coquille : '<!doctype html><p>AILLEURS</p>')
      }, chemin === '/' ? 0 : etat.delai)
      return
    }
    const fichier = join(root, normalize(chemin))
    if (!fichier.startsWith(outDir) || !existsSync(fichier) || !statSync(fichier).isFile()) { res.writeHead(404); res.end(); return }
    if (COEUR(chemin)) {
      etat.vus++
      // retenu : la réponse ne vient pas (le départ la coupe) ; panne : la connexion tombe, page ouverte
      if (etat.mode === 'retenu') return
      setTimeout(() => res.destroy(), 200)
      return
    }
    res.writeHead(200, { 'content-type': extname(fichier) === '.js' ? 'text/javascript; charset=utf-8' : 'application/octet-stream' })
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

let serveur: Promise<Serveur> | null = null

for (const nom of ['chromium', 'firefox', 'webkit'] as const) {
  describe(`cœur coupé par le départ de la page — ${nom} réel`, function () {
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

    // ouvre la page, attend que le cœur soit demandé, joue `geste`, puis rend les erreurs écrites par la page ; la page suivante
    // répond après `delai` ms
    const ouvrir = async (mode: Mode, geste: (page: any, lignes: string[]) => Promise<void>, delai = 0): Promise<string[]> => {
      s.etat.mode  = mode
      s.etat.vus   = 0
      s.etat.delai = delai
      const page   = await browser.newPage()
      const lignes: string[] = []
      page.on('console', (m: any) => { if (m.type() === 'error' && !DU_NAVIGATEUR.test(m.text())) lignes.push('console ' + m.text()) })
      page.on('pageerror', (e: Error) => lignes.push('pageerror ' + e.message))
      try {
        await page.goto(s.base + '/', { waitUntil: 'domcontentloaded' })
        const debut = Date.now()
        while (s.etat.vus === 0 && Date.now() - debut < 15000) await page.waitForTimeout(50)
        assert.ok(s.etat.vus > 0, 'le cœur est demandé')
        await page.waitForTimeout(150)
        await geste(page, lignes)
        return lignes
      }
      finally {
        await page.close()
      }
    }

    it('départ par un lien (navigation lancée par la page) : aucune erreur', async () => {
      const lignes = await ouvrir('retenu', async (page) => {
        await page.evaluate(() => { location.href = '/ailleurs' })
        await page.waitForURL('**/ailleurs', { timeout: 15000 })
        await page.waitForTimeout(1000)
      })
      assert.deepEqual(lignes, [])
    })

    it('départ par la barre d\'adresse : aucune erreur', async () => {
      const lignes = await ouvrir('retenu', async (page) => {
        await page.goto(s.base + '/ailleurs', { waitUntil: 'load' })
        await page.waitForTimeout(1000)
      })
      assert.deepEqual(lignes, [])
    })

    it('page suivante plus lente que 10 s : aucune erreur, ni à 10 s ni après', async () => {
      const lignes = await ouvrir('retenu', async (page) => {
        await page.evaluate(() => { location.href = '/ailleurs' })
        await page.waitForURL('**/ailleurs', { timeout: 40000, waitUntil: 'commit' })
        await page.waitForTimeout(1000)
      }, 13000)
      assert.deepEqual(lignes, [])
    })

    it('vraie panne réseau du cœur, page ouverte : l\'erreur s\'écrit', async () => {
      const lignes = await ouvrir('panne', async (page, l) => {
        const debut = Date.now()
        while (l.length === 0 && Date.now() - debut < 15000) await page.waitForTimeout(100)
      })
      assert.ok(lignes.some(l => /^(pageerror|console) /.test(l)), 'la panne du cœur est dite — ' + JSON.stringify(lignes))
    })
  })
}

after(async () => {
  if (serveur) {
    const { server } = await serveur
    server.closeAllConnections()
    server.close()
  }
  await terminateSharedWorkerPool()
})
