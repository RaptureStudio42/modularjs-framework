// Groupes de fichiers et `µ.Autoloader.preload`, dans un vrai Chromium.
//
// Le besoin : une page à onglets qui chargeait 369 fichiers. Chaque onglet devient un groupe (un seul
// fichier pour sa coquille et toutes ses cartes) et le survol d'un onglet charge d'avance tout l'onglet.
// Ce que la construction promet se vérifie ici dans un navigateur : UNE requête pour le groupe, tous les
// composants montés, un module partagé qui reste une instance unique, zéro erreur ; puis, au survol,
// les liens de préchargement attendus, et le clic qui ne redemande RIEN — chaque fichier n'est servi
// qu'une seule fois au total (compté côté serveur).

import assert from 'node:assert/strict'
import { createServer, type Server } from 'node:http'
import { mkdirSync, writeFileSync, readFileSync, readdirSync, existsSync, statSync } from 'node:fs'
import { join, dirname, extname, normalize } from 'node:path'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { mjsTmp } from './helpers/tmp.js'

const FICHIERS: Record<string, string> = {
  // chaque évaluation du module compte : une instance unique ⇒ 1
  'partage.module.civet': 'window.__evaluations = (window.__evaluations ?? 0) + 1\nexport marque := \'partage\'\n',
  'puce.mjs':             '<i class="puce">puce</i>\n',
  'carte-a.mjs':          '@import marque \'partage.module.civet\'\n\n<p class="a" *glitch>a {marque}</p>\n<mjs-puce></mjs-puce>\n',
  'carte-b.mjs':          '@import marque \'partage.module.civet\'\n\n<p class="b">b {marque}</p>\n<mjs-puce></mjs-puce>\n',
  'onglet.mjs':           '<h2 class="o">onglet</h2>\n<mjs-carte-a></mjs-carte-a>\n<mjs-carte-b></mjs-carte-b>\n',
  'appelant.mjs':         '<script>\n@chauffer = -> µ.Autoloader.preload(\'onglet\')\n</script>\n<button class="s" @mouseover=@chauffer>survol</button>\n',
}

interface Site { root: string; outDir: string; groupe: string; demandes: Map<string, number>; serveur: Server; url: string }

async function construireEtServir(corps: string, opts: { extra?: Record<string, string>; bundles?: any; autre?: string } = {}): Promise<Site> {
  const root   = mjsTmp('groupes-chromium')
  const srcDir = join(root, 'src')
  const outDir = join(root, 'out')
  mkdirSync(srcDir, { recursive: true })
  for (const [nom, src] of Object.entries({ ...FICHIERS, ...opts.extra })) {
    mkdirSync(dirname(join(srcDir, nom)), { recursive: true })
    writeFileSync(join(srcDir, nom), src)
  }
  const bundler = new Bundler({ sourceDir: srcDir, outputDir: outDir, manifestPath: join(outDir, 'bundle.js'), urlPrefix: '/out', env: 'prod', bundles: opts.bundles ?? { onglet: ['onglet'] } } as any)
  const stats   = await bundler.compile()
  assert.equal(stats.errors.length, 0, stats.errors.map((e: any) => e.message).join('\n'))
  await bundler.close()
  const groupe  = readdirSync(outDir).find(f => /^mjs_group-onglet-[0-9a-z]{5}\.js$/.test(f))!
  const page    = (c: string): string => `<!doctype html><html><head><meta charset="utf-8"><script type="module" src="/out/bundle.js"></script></head><body>${c}</body></html>`
  const html    = page(corps)
  const demandes = new Map<string, number>()
  const serveur = createServer((req, res) => {
    const chemin = decodeURIComponent((req.url ?? '/').split('?')[0])
    if (chemin === '/' || (chemin === '/autre' && opts.autre !== undefined)) {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
      res.end(chemin === '/' ? html : page(opts.autre!))
      return
    }
    const fichier = join(root, normalize(chemin))
    if (!fichier.startsWith(outDir) || !existsSync(fichier) || !statSync(fichier).isFile()) {
      res.writeHead(404)
      res.end()
      return
    }
    demandes.set(chemin, (demandes.get(chemin) ?? 0) + 1)
    res.writeHead(200, { 'content-type': extname(fichier) === '.js' ? 'text/javascript; charset=utf-8' : 'application/octet-stream' })
    res.end(readFileSync(fichier))
  })
  await new Promise<void>(resolve => serveur.listen(0, '127.0.0.1', () => resolve()))
  return { root, outDir, groupe, demandes, serveur, url: `http://127.0.0.1:${(serveur.address() as any).port}/` }
}

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

// les balises mjs-* définies ET montées, jusque dans les ombres
const MONTEES = () => {
  const trouves: string[] = []
  const parcourir = (racine: any): void => {
    for (const el of Array.from(racine.querySelectorAll('*')) as any[]) {
      if (!el.tagName.startsWith('MJS-')) continue
      if (customElements.get(el.tagName.toLowerCase())) trouves.push(el.tagName.toLowerCase())
      const sr = el._shadow || el.shadowRoot
      if (sr) parcourir(sr)
    }
  }
  parcourir(document)
  return [...new Set(trouves)].sort()
}

describe('groupes de fichiers et preload — Chromium', function () {
  this.timeout(120000)
  let browser: any = null

  before(async function () {
    browser = await chromiumDisponible()
    if (!browser) console.log('  ℹ️  Chromium non installé : ces essais sont sautés. Activer : `npx playwright install chromium`')
  })

  after(async () => {
    if (browser) await browser.close()
    await terminateSharedWorkerPool()
  })

  it('une page qui monte l\'onglet : UNE requête pour le groupe, tous les composants montés, le module évalué une seule fois, zéro erreur', async function () {
    if (!browser) this.skip()
    const site = await construireEtServir('<mjs-onglet></mjs-onglet>')
    const page = await browser.newPage()
    const erreurs: string[] = []
    page.on('pageerror', (e: Error) => erreurs.push(e.message))
    page.on('console', (m: any) => { if (m.type() === 'error') erreurs.push(m.text()) })
    try {
      await page.goto(site.url, { waitUntil: 'load' })
      await page.waitForFunction(() => !!customElements.get('mjs-puce'), null, { timeout: 15000 }).catch(() => {})
      await page.waitForTimeout(300)
      const montees = await page.evaluate(MONTEES)
      assert.deepEqual(erreurs, [], `erreurs de page : ${erreurs.join(' | ')}`)
      assert.deepEqual(montees, ['mjs-carte-a', 'mjs-carte-b', 'mjs-onglet', 'mjs-puce'])
      assert.equal(site.demandes.get(`/out/${site.groupe}`), 1, `le groupe est demandé une fois, demandes : ${[...site.demandes].map(([k, v]) => k + '×' + v).join(' ')}`)
      const separes = [...site.demandes.keys()].filter(u => /\/out\/(onglet|carte-a|carte-b|puce)-[0-9a-z]{5}\.js$/.test(u))
      assert.deepEqual(separes, [], 'aucun fichier séparé des composants du groupe n\'est demandé')
      assert.equal(await page.evaluate(() => (window as any).__evaluations), 1, 'le module partagé reste une instance unique, hors du groupe')
      const modules = [...site.demandes].filter(([u]) => /partage\.module-/.test(u))
      assert.deepEqual(modules.map(([, n]) => n), [1], 'le module est servi une fois')
    }
    finally {
      await page.close()
      await new Promise(resolve => site.serveur.close(() => resolve(null)))
    }
  })

  it('le survol appelle preload : les liens attendus sont posés, puis le clic qui monte l\'onglet ne redemande aucun fichier', async function () {
    if (!browser) this.skip()
    const site = await construireEtServir('<mjs-appelant></mjs-appelant>')
    const page = await browser.newPage()
    const erreurs: string[] = []
    page.on('pageerror', (e: Error) => erreurs.push(e.message))
    page.on('console', (m: any) => { if (m.type() === 'error') erreurs.push(m.text()) })
    try {
      await page.goto(site.url, { waitUntil: 'load' })
      await page.waitForFunction(() => {
        const a: any = document.querySelector('mjs-appelant')
        return !!(a && (a._shadow || a.shadowRoot))
      }, null, { timeout: 15000 })
      const avant = await page.evaluate(() => Array.from(document.head.querySelectorAll('link[rel="modulepreload"]')).map((l: any) => l.getAttribute('href')))
      // survol simulé : l'événement que le gestionnaire du bouton écoute
      await page.evaluate(() => {
        const a: any = document.querySelector('mjs-appelant')
        const bouton = (a._shadow || a.shadowRoot).querySelector('button')
        bouton.dispatchEvent(new MouseEvent('mouseover', { bubbles: true, composed: true }))
      })
      await page.waitForTimeout(800)
      const apres = await page.evaluate(() => Array.from(document.head.querySelectorAll('link[rel="modulepreload"]')).map((l: any) => l.getAttribute('href')))
      const poses = apres.filter(h => !avant.includes(h))
      assert.equal(poses.filter(h => h === `/out/${site.groupe}`).length, 1, `un lien pour le groupe, posés : ${poses.join(' ')}`)
      assert.equal(poses.filter(h => /partage\.module-/.test(h)).length, 1, 'un lien pour le module')
      assert.equal(poses.filter(h => /mjs_fx_glitch-/.test(h)).length, 1, 'un lien pour le fichier d\'effet')
      assert.equal(poses.length, 3, `rien d'autre, posés : ${poses.join(' ')}`)
      assert.equal(await page.evaluate(() => (window as any).__evaluations), undefined, 'précharger n\'exécute rien')

      // le clic : l'onglet se monte, sans nouvelle requête pour des fichiers déjà préchargés
      const comptes = new Map(site.demandes)
      await page.evaluate(() => document.body.appendChild(document.createElement('mjs-onglet')))
      await page.waitForFunction(() => !!customElements.get('mjs-puce'), null, { timeout: 15000 })
      await page.waitForTimeout(300)
      assert.deepEqual(erreurs, [], `erreurs de page : ${erreurs.join(' | ')}`)
      assert.deepEqual(await page.evaluate(MONTEES), ['mjs-appelant', 'mjs-carte-a', 'mjs-carte-b', 'mjs-onglet', 'mjs-puce'])
      for (const [url, n] of site.demandes) {
        if (/bundle\.js|mjs_core/.test(url)) continue
        assert.equal(n, 1, `${url} servi ${n} fois`)
        if (/mjs_group-|partage\.module-|mjs_fx_glitch-/.test(url)) assert.equal(comptes.get(url), 1, `${url} déjà servi avant le clic`)
      }
      assert.equal(await page.evaluate(() => (window as any).__evaluations), 1)
    }
    finally {
      await page.close()
      await new Promise(resolve => site.serveur.close(() => resolve(null)))
    }
  })

  // « sauf ces composants » dans un vrai navigateur — pourquoi ces essais existent : la promesse de `except`
  // est une promesse de téléchargement. Le groupe se monte avec sa coquille, les composants laissés dehors
  // arrivent par leurs fichiers séparés quand la coquille les appelle, et une AUTRE page qui n'utilise que
  // l'un d'eux ne télécharge pas le groupe. Ici `champ` (avec `loupe`, qu'il est seul à appeler) est exclu.
  const EXCLUS = {
    'champ.mjs': '<input class="champ" aria-label="champ">\n<mjs-loupe></mjs-loupe>\n',
    'loupe.mjs': '<s class="loupe">loupe</s>\n',
    'onglet.mjs': '<h2 class="o">onglet</h2>\n<mjs-carte-a></mjs-carte-a>\n<mjs-carte-b></mjs-carte-b>\n<mjs-champ></mjs-champ>\n',
  }
  const EXCEPT = { onglet: { roots: ['onglet'], except: ['champ'] } }
  const SEPARES = /\/out\/(champ|loupe)-[0-9a-z]{5}\.js$/
  const lesDemandes = (site: Site): string => [...site.demandes].map(([k, v]) => k + '×' + v).join(' ')

  it('except : la coquille du groupe se monte, champ et loupe arrivent par leurs fichiers séparés, chaque fichier une seule fois', async function () {
    if (!browser) this.skip()
    const site = await construireEtServir('<mjs-onglet></mjs-onglet>', { extra: EXCLUS, bundles: EXCEPT })
    const page = await browser.newPage()
    const erreurs: string[] = []
    page.on('pageerror', (e: Error) => erreurs.push(e.message))
    page.on('console', (m: any) => { if (m.type() === 'error') erreurs.push(m.text()) })
    try {
      await page.goto(site.url, { waitUntil: 'load' })
      await page.waitForFunction(() => !!customElements.get('mjs-loupe'), null, { timeout: 15000 }).catch(() => {})
      await page.waitForTimeout(300)
      assert.deepEqual(erreurs, [], `erreurs de page : ${erreurs.join(' | ')}`)
      assert.deepEqual(await page.evaluate(MONTEES), ['mjs-carte-a', 'mjs-carte-b', 'mjs-champ', 'mjs-loupe', 'mjs-onglet', 'mjs-puce'])
      assert.equal(site.demandes.get(`/out/${site.groupe}`), 1, `le groupe est demandé une fois, demandes : ${lesDemandes(site)}`)
      const separes = [...site.demandes].filter(([u]) => SEPARES.test(u))
      assert.deepEqual(separes.map(([u, n]) => `${u.replace(/-[0-9a-z]{5}\.js$/, '')}×${n}`).sort(), ['/out/champ×1', '/out/loupe×1'], `les deux exclus, une fois chacun, demandes : ${lesDemandes(site)}`)
    }
    finally {
      await page.close()
      await new Promise(resolve => site.serveur.close(() => resolve(null)))
    }
  })

  it('except : une autre page qui n\'utilise que champ ne télécharge pas le groupe', async function () {
    if (!browser) this.skip()
    const site = await construireEtServir('<mjs-onglet></mjs-onglet>', { extra: EXCLUS, bundles: EXCEPT, autre: '<mjs-champ></mjs-champ>' })
    const page = await browser.newPage()
    const erreurs: string[] = []
    page.on('pageerror', (e: Error) => erreurs.push(e.message))
    page.on('console', (m: any) => { if (m.type() === 'error') erreurs.push(m.text()) })
    try {
      await page.goto(site.url + 'autre', { waitUntil: 'load' })
      await page.waitForFunction(() => !!customElements.get('mjs-loupe'), null, { timeout: 15000 }).catch(() => {})
      await page.waitForTimeout(300)
      assert.deepEqual(erreurs, [], `erreurs de page : ${erreurs.join(' | ')}`)
      assert.deepEqual(await page.evaluate(MONTEES), ['mjs-champ', 'mjs-loupe'])
      assert.equal(site.demandes.has(`/out/${site.groupe}`), false, `le groupe n'est pas demandé, demandes : ${lesDemandes(site)}`)
      assert.equal([...site.demandes.keys()].filter(u => SEPARES.test(u)).length, 2, 'champ et loupe par leurs fichiers')
    }
    finally {
      await page.close()
      await new Promise(resolve => site.serveur.close(() => resolve(null)))
    }
  })

  it('except : preload(racine) pose le groupe, les fichiers séparés des exclus, le module et l\'effet ; le montage ne redemande rien', async function () {
    if (!browser) this.skip()
    const site = await construireEtServir('<mjs-appelant></mjs-appelant>', { extra: EXCLUS, bundles: EXCEPT })
    const page = await browser.newPage()
    const erreurs: string[] = []
    page.on('pageerror', (e: Error) => erreurs.push(e.message))
    page.on('console', (m: any) => { if (m.type() === 'error') erreurs.push(m.text()) })
    try {
      await page.goto(site.url, { waitUntil: 'load' })
      await page.waitForFunction(() => {
        const a: any = document.querySelector('mjs-appelant')
        return !!(a && (a._shadow || a.shadowRoot))
      }, null, { timeout: 15000 })
      const avant = await page.evaluate(() => Array.from(document.head.querySelectorAll('link[rel="modulepreload"]')).map((l: any) => l.getAttribute('href')))
      await page.evaluate(() => {
        const a: any = document.querySelector('mjs-appelant')
        const bouton = (a._shadow || a.shadowRoot).querySelector('button')
        bouton.dispatchEvent(new MouseEvent('mouseover', { bubbles: true, composed: true }))
      })
      await page.waitForTimeout(800)
      const apres = await page.evaluate(() => Array.from(document.head.querySelectorAll('link[rel="modulepreload"]')).map((l: any) => l.getAttribute('href')))
      const poses = apres.filter(h => !avant.includes(h))
      assert.equal(poses.filter(h => h === `/out/${site.groupe}`).length, 1, `un lien pour le groupe, posés : ${poses.join(' ')}`)
      assert.equal(poses.filter(h => /\/champ-[0-9a-z]{5}\.js$/.test(h)).length, 1, `un lien pour le fichier séparé de champ, posés : ${poses.join(' ')}`)
      assert.equal(poses.filter(h => /\/loupe-[0-9a-z]{5}\.js$/.test(h)).length, 1, 'un lien pour le fichier séparé de loupe')
      assert.equal(poses.filter(h => /partage\.module-/.test(h)).length, 1, 'un lien pour le module')
      assert.equal(poses.filter(h => /mjs_fx_glitch-/.test(h)).length, 1, 'un lien pour le fichier d\'effet')
      assert.equal(poses.length, 5, `rien d'autre, posés : ${poses.join(' ')}`)

      const comptes = new Map(site.demandes)
      await page.evaluate(() => document.body.appendChild(document.createElement('mjs-onglet')))
      await page.waitForFunction(() => !!customElements.get('mjs-loupe'), null, { timeout: 15000 })
      await page.waitForTimeout(300)
      assert.deepEqual(erreurs, [], `erreurs de page : ${erreurs.join(' | ')}`)
      for (const [url, n] of site.demandes) {
        if (/bundle\.js|mjs_core/.test(url)) continue
        assert.equal(n, 1, `${url} servi ${n} fois`)
        if (/mjs_group-|champ-|loupe-|partage\.module-|mjs_fx_glitch-/.test(url)) assert.equal(comptes.get(url), 1, `${url} déjà servi avant le montage`)
      }
    }
    finally {
      await page.close()
      await new Promise(resolve => site.serveur.close(() => resolve(null)))
    }
  })
  // un composant à deux clés (`x-y/x-y-zed.mjs` : `zed` et `x-y-zed`) donné par un alias comme racine de groupe.
  // Avant : seule la clé donnée suivait le groupe, la clé sœur gardait son fichier séparé — deux
  // téléchargements, code exécuté deux fois, « déjà défini par un autre bundle ». Maintenant : un seul
  // fichier servi, une seule fois, aucun avertissement.
  it('racine de groupe donnée par un alias : un seul téléchargement pour les deux balises, aucun avertissement', async function () {
    if (!browser) this.skip()
    const site = await construireEtServir('<mjs-x-y-zed></mjs-x-y-zed><mjs-zed></mjs-zed>', { extra: { 'x-y/x-y-zed.mjs': '<p class="z">zed</p>\n' }, bundles: { g: ['zed'] } })
    const page = await browser.newPage()
    const messages: string[] = []
    page.on('pageerror', (e: Error) => messages.push(e.message))
    page.on('console', (m: any) => { if (m.type() === 'error' || m.type() === 'warning') messages.push(m.text()) })
    try {
      await page.goto(site.url, { waitUntil: 'load' })
      await page.waitForFunction(() => !!customElements.get('mjs-zed') && !!customElements.get('mjs-x-y-zed'), null, { timeout: 15000 }).catch(() => {})
      await page.waitForTimeout(300)
      assert.deepEqual(messages, [], `erreurs ou avertissements : ${messages.join(' | ')}`)
      assert.deepEqual(await page.evaluate(MONTEES), ['mjs-x-y-zed', 'mjs-zed'])
      const servis = [...site.demandes].filter(([u]) => /\/out\/(mjs_group-g|x-y-zed|zed)-[0-9a-z]{5}\.js$/.test(u))
      assert.equal(servis.length, 1, `un seul fichier de composant servi, vus : ${servis.map(([k, v]) => k + '×' + v).join(' ')}`)
      assert.match(servis[0][0], /mjs_group-g-/)
      assert.equal(servis[0][1], 1, 'servi une seule fois')
    }
    finally {
      await page.close()
      await new Promise(resolve => site.serveur.close(() => resolve(null)))
    }
  })
})
