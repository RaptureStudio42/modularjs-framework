// Le visiteur qui quitte la page ne la voit jamais se recharger sous lui, quel que soit le moment où un fichier se met à charger
// et quel que soit le temps que met la page suivante ; un bundle vraiment périmé (fichier disparu du serveur) recharge toujours la
// page, une fois. Vrais navigateurs (Chromium, Firefox, WebKit), vrai build en fichiers séparés servi par HTTP.
//
// Pourquoi ce test existe : l'Autoloader rechargeait la page dès qu'un import échouait, pris pour un bundle périmé. Or Safari
// refuse tout fichier demandé pendant que la page s'en va (lien, barre d'adresse) et Firefox comme Safari coupent ceux qui sont
// en route au départ : le rechargement remplaçait la navigation du visiteur. L'aide de départ du cœur taisait l'échec pendant
// 10 s après l'annonce du départ, puis le disait et rechargeait la page si elle était encore là : une page suivante plus lente
// que 10 s était perdue. Et un départ par la barre d'adresse alors que rien n'était en vol n'était pas annoncé du tout
// (`beforeunload` n'est écouté que pendant un chargement, la navigation de la barre d'adresse ne passe pas par l'API Navigation) :
// un module qui se mettait à charger pendant ce départ faisait recharger la page. Le bundle ne se dit plus périmé que sur la
// réponse du serveur (le fichier redemandé revient sans module JavaScript : 404, page HTML de repli), jamais sur un échec réseau,
// et jamais après un départ annoncé. Enfin, Safari écrit lui-même une erreur pour chaque requête lancée pendant que la page s'en
// va (« Fetch API cannot load … due to access control checks ») : le repli sur la langue par défaut, quand le fichier de langue
// a été coupé par le départ, attend comme le message au lieu de demander tout de suite les fragments de la langue par défaut.
// Le départ par la barre d'adresse alors que rien n'est en vol n'était toujours pas annoncé : Chromium et Firefox rechargeaient la
// page quand le module qui se met à charger pendant ce départ avait vraiment disparu du serveur (404), Safari, qui refuse ce module,
// écrivait l'échec comme une panne. `beforeunload` est donc écouté en permanence là où il ne coûte pas le cache de navigation
// (Chromium, Safari) ; dans Firefox, il ne l'est que pendant un chargement, et ce départ-là n'y est toujours pas annoncé.
//
// Montage : `<mjs-pret>` (module servi), `<mjs-lent>` (module retenu, absent ou coupé selon le cas), `<mjs-page>` (section
// `accueil`, fichier de langue anglais retenu selon le cas) ; la page suivante (`/ailleurs`) répond après un délai réglable.

import assert from 'node:assert/strict'
import { createServer, type Server } from 'node:http'
import { mkdirSync, writeFileSync, readFileSync, existsSync, statSync } from 'node:fs'
import { join, extname, normalize, basename } from 'node:path'
import { mjsTmp } from './helpers/tmp.js'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { findConfig, resolveBundlerOpts } from '../src/bundler/config.js'

// ce que le runtime écrit (préfixe de ses messages) ; les lignes propres au navigateur (« Loading failed for the module… ») n'en sont pas
const DU_RUNTIME = /^\[Autoloader\]|^\[ModularJS\]|^i18n /

type Sort = 'ok' | 'retenu' | 'absent' | 'coupe'

interface Etat { module: Sort, langue: Sort, delai: number, racines: number, vus: Set<string> }
interface Serveur { base: string, server: Server, etat: Etat }

async function construire(): Promise<Serveur> {
  const root   = mjsTmp('depart-sans-vol')
  const srcDir = join(root, 'src')
  const outDir = join(root, 'out')
  mkdirSync(join(srcDir, 'i18n', 'fr'), { recursive: true })
  mkdirSync(join(srcDir, 'i18n', 'en'), { recursive: true })
  writeFileSync(join(srcDir, 'i18n', 'fr.yml'), 'titre: Titre\n')
  writeFileSync(join(srcDir, 'i18n', 'en.yml'), 'titre: Title\n')
  writeFileSync(join(srcDir, 'i18n', 'fr', 'accueil.yml'), 'titre: Bonjour accueil\n')
  writeFileSync(join(srcDir, 'i18n', 'en', 'accueil.yml'), 'titre: Hello home\n')
  writeFileSync(join(srcDir, 'page.mjs'), ["@i18n 'accueil'", '', '<h1 class="t">{µt(\'titre\')}</h1>', ''].join('\n'))
  writeFileSync(join(srcDir, 'lent.mjs'), ['<p class="lent">LENT</p>', ''].join('\n'))
  writeFileSync(join(srcDir, 'pret.mjs'), ['<p class="pret">PRET</p>', ''].join('\n'))
  writeFileSync(join(root, 'mjs.config.json'), JSON.stringify({ sourceDir: 'src', outputDir: 'out', manifestPath: 'out/bundle.js', urlPrefix: '/out', i18n: { default: 'fr', placeholder: 'wait', urlParam: true } }, null, 2))
  const found   = findConfig(root)!
  const bundler = new Bundler({ ...resolveBundlerOpts(found.config, found.configDir), env: 'dev' } as any)
  const stats   = await bundler.compile()
  await bundler.close()
  assert.equal(stats.errors.length, 0, stats.errors.map((e: any) => e.message).join('\n'))
  const etat: Etat = { module: 'ok', langue: 'ok', delai: 0, racines: 0, vus: new Set() }
  const coquille = (corps: string) => `<!doctype html><html><head><meta charset="utf-8"><script type="module" src="/out/bundle.js"></script></head><body>${corps}</body></html>`
  const server = createServer((req, res) => {
    const u      = new URL(req.url ?? '/', 'http://x')
    const chemin = decodeURIComponent(u.pathname)
    if (chemin === '/') {
      etat.racines++
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
      res.end(coquille(u.searchParams.get('p') === 'simple' ? '<mjs-pret></mjs-pret>' : '<mjs-page></mjs-page><mjs-lent></mjs-lent>'))
      return
    }
    if (chemin === '/ailleurs') {
      setTimeout(() => { res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); res.end('<!doctype html><p>AILLEURS</p>') }, etat.delai)
      return
    }
    const fichier = join(root, normalize(chemin))
    if (!fichier.startsWith(outDir) || !existsSync(fichier) || !statSync(fichier).isFile()) { res.writeHead(404); res.end(); return }
    const quoi = /^lent-[0-9a-z]+\.js$/.test(basename(fichier)) ? 'module' : /^mjs_i18n-en-[0-9a-z]+\.js$/.test(basename(fichier)) ? 'langue' : ''
    const sorte: Sort = quoi ? etat[quoi as 'module' | 'langue'] : 'ok'
    if (quoi) etat.vus.add(quoi)
    // retenu : la réponse ne vient jamais ; absent : le fichier a disparu du serveur (déploiement), qui répond sa page d'erreur ;
    // coupe : la connexion tombe, sans réponse
    if (sorte === 'retenu') return
    if (sorte === 'absent') { res.writeHead(404, { 'content-type': 'text/html; charset=utf-8' }); res.end('<!doctype html><p>introuvable</p>'); return }
    if (sorte === 'coupe') { setTimeout(() => res.destroy(), 200); return }
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

let serveur: Promise<Serveur> | null = null

for (const nom of ['chromium', 'firefox', 'webkit'] as const) {
  describe(`départ de la page : jamais de rechargement sous le visiteur — ${nom} réel`, function () {
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

    // ouvre `url` avec le réglage du serveur, rend la page et les lignes écrites par le runtime (et les erreurs de page)
    const ouvrir = async (url: string, reglage: Partial<Etat>): Promise<{ page: any, lignes: string[] }> => {
      Object.assign(s.etat, { module: 'ok', langue: 'ok', delai: 0 }, reglage)
      s.etat.vus.clear()
      s.etat.racines = 0
      const page   = await browser.newPage()
      const lignes: string[] = []
      page.on('console', (m: any) => { if ((m.type() === 'error' || m.type() === 'warning') && DU_RUNTIME.test(m.text())) lignes.push(m.type() + ' ' + m.text()) })
      page.on('pageerror', (e: Error) => lignes.push('pageerror ' + e.message))
      await page.goto(s.base + url, { waitUntil: 'domcontentloaded' })
      return { page, lignes }
    }
    const attendreVu = async (page: any, quoi: string): Promise<void> => {
      const debut = Date.now()
      while (!s.etat.vus.has(quoi) && Date.now() - debut < 15000) await page.waitForTimeout(50)
      assert.ok(s.etat.vus.has(quoi), `le fichier « ${quoi} » est demandé`)
    }

    // départ par la barre d'adresse alors que rien n'est en vol ; le module de `<mjs-lent>`, posé 1,5 s après, se met à charger pendant
    // le départ (page suivante : 8 s, large devant l'échec du module et la seconde demande du fichier, même sur une machine chargée)
    // — rend les lignes écrites
    const departBarre = async (module: Sort): Promise<string[]> => {
      const { page, lignes } = await ouvrir('/?p=simple', { module, delai: 8000 })
      try {
        await page.waitForFunction(() => !!customElements.get('mjs-pret') && !document.querySelector('mjs-pret')!.hasAttribute('mjs-loading'), null, { timeout: 15000 })
        await page.waitForTimeout(300)
        await page.evaluate(() => { setTimeout(() => document.body.appendChild(document.createElement('mjs-lent')), 1500) })
        let nav = 'ok'
        await page.goto(s.base + '/ailleurs', { waitUntil: 'commit', timeout: 30000 }).catch((e: Error) => { nav = String(e.message).split('\n')[0] })
        await page.waitForTimeout(1000)
        assert.equal(nav, 'ok', 'la navigation du visiteur n\'est pas remplacée — ' + JSON.stringify(lignes))
        assert.equal(new URL(page.url()).pathname, '/ailleurs')
        assert.equal(s.etat.racines, 1, 'la page n\'est jamais redemandée (aucun rechargement) — ' + JSON.stringify(lignes))
        assert.ok(!lignes.some((l) => /périmé|stale/i.test(l)), 'aucun bundle dit périmé — ' + JSON.stringify(lignes))
        return lignes
      }
      finally {
        await page.close()
      }
    }

    it('départ par la barre d\'adresse, rien en vol, un module qui se met à charger pendant le départ : la navigation aboutit, rien ne s\'écrit', async () => {
      assert.deepEqual(await departBarre('retenu'), [])
    })

    it('départ par la barre d\'adresse, rien en vol, un module disparu du serveur qui se met à charger pendant le départ : la navigation aboutit, rien ne s\'écrit', async function () {
      // Firefox : ce départ n'y est pas annoncé (beforeunload n'y est écouté que pendant un chargement, pour garder le cache de
      // navigation) — le 404 y recharge encore la page
      if (nom === 'firefox') this.skip()
      assert.deepEqual(await departBarre('absent'), [])
    })

    it('page suivante plus lente que 10 s, module coupé au départ : jamais de rechargement', async () => {
      const { page, lignes } = await ouvrir('/?p=base', { module: 'retenu', delai: 13000 })
      try {
        await attendreVu(page, 'module')
        await page.waitForTimeout(200)
        await page.evaluate(() => { location.href = '/ailleurs' })
        await page.waitForTimeout(14500)
        assert.equal(new URL(page.url()).pathname, '/ailleurs', 'la navigation du visiteur aboutit — ' + JSON.stringify(lignes))
        assert.equal(s.etat.racines, 1, 'la page n\'est jamais redemandée (aucun rechargement) — ' + JSON.stringify(lignes))
        assert.ok(!lignes.some((l) => /périmé|stale/i.test(l)), 'aucun bundle dit périmé — ' + JSON.stringify(lignes))
      }
      finally {
        await page.close()
      }
    })

    it('départ pendant le chargement de la langue (?lang=en) : aucune erreur, ni du runtime ni du navigateur', async () => {
      // page suivante prompte (1 s) : le départ aboutit bien avant le secours des textes en attente (3 s après le montage), qui
      // s'écrit, lui, sur une page restée en place
      const { page, lignes } = await ouvrir('/?p=base&lang=en', { langue: 'retenu', delai: 1000 })
      try {
        await attendreVu(page, 'langue')
        await page.waitForTimeout(300)
        await page.evaluate(() => { location.href = '/ailleurs' })
        await page.waitForURL('**/ailleurs', { timeout: 15000 })
        await page.waitForTimeout(1000)
        assert.deepEqual(lignes, [])
      }
      finally {
        await page.close()
      }
    })

    it('fichier disparu du serveur (déploiement), page ouverte : l\'échec est dit et la page se recharge, une fois', async () => {
      const { page, lignes } = await ouvrir('/?p=base', { module: 'absent' })
      try {
        const debut = Date.now()
        while (s.etat.racines < 2 && Date.now() - debut < 10000) await page.waitForTimeout(100)
        await page.waitForTimeout(1500)
        assert.equal(s.etat.racines, 2, 'un seul rechargement — ' + JSON.stringify(lignes))
        assert.ok(lignes.some((l) => /^warning \[Autoloader\].*(périmé|stale)/i.test(l)), 'le rechargement est annoncé — ' + JSON.stringify(lignes))
      }
      finally {
        await page.close()
      }
    })

    it('connexion qui tombe, page ouverte : l\'échec est dit, la page ne se recharge pas', async () => {
      const { page, lignes } = await ouvrir('/?p=base', { module: 'coupe' })
      try {
        const debut = Date.now()
        while (!lignes.some((l) => /Failed to import lent/.test(l)) && Date.now() - debut < 10000) await page.waitForTimeout(100)
        await page.waitForTimeout(1500)
        assert.ok(lignes.some((l) => /^error \[Autoloader\] ❌ Failed to import lent/.test(l)), 'le module perdu est dit — ' + JSON.stringify(lignes))
        assert.equal(s.etat.racines, 1, 'une panne réseau ne fait pas recharger la page — ' + JSON.stringify(lignes))
      }
      finally {
        await page.close()
      }
    })
  })
}

after(async () => {
  if (serveur) (await serveur).server.close()
  await terminateSharedWorkerPool()
})
