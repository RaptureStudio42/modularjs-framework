// table des fichiers compacte, dans un vrai Chromium — pourquoi ce test existe.
//
// En production, une grosse appli publie sa table `µPaths` sous forme compacte (valeur = empreinte
// seule, ou préfixe de dossier + empreinte ; un nom entier garde son point) : sur le site de
// référence, 1 830 entrées passent de 24,3 Ko à 16,1 Ko compressés. Le chemin réel se recolle à la
// lecture, en un seul endroit (`µ.pathOf`, posé par le manifeste). Ce fichier de test prouve que
// tous les lecteurs de la table suivent, dans un navigateur réel : montage d'une page (préchargement
// du manifeste), composant chargé à la demande par l'Autoloader (alias à préfixe de dossier compris),
// `µ.Autoloader.preload`, navigation interne avec fichier de page (la fiche pose une valeur entière
// dans la table compacte).
//
// Ce que le test garde : zéro erreur, zéro 404, chaque fichier demandé existe sur le disque, chaque
// composant attendu est défini, et la table servie est bien la forme compacte (sans quoi le test ne
// prouverait rien). Forme des valeurs et décodage sur la table réelle : manifest-table-des-fichiers-compacte.test.ts.

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

const REMPLISSAGE = Array.from({ length: 70 }, (_, i) => `fiche-${String(i + 1).padStart(3, '0')}`)

describe('table des fichiers compacte — tous les lecteurs de la table dans Chromium', function () {
  this.timeout(180000)
  let browser: any = null
  let server: Server | null = null
  let base = ''
  let outDir = ''
  let table: Record<string, string> = {}
  let pageAutre = ''

  before(async function () {
    browser = await chromiumDisponible()
    if (!browser) { console.log('  ℹ️  Chromium non installé : test sauté'); this.skip() }
    const root   = mjsTmp('table-compacte-browser')
    const srcDir = join(root, 'src')
    outDir       = join(root, 'out')
    mkdirSync(join(srcDir, 'tuto'), { recursive: true })
    for (const nom of REMPLISSAGE) writeFileSync(join(srcDir, `${nom}.mjs`), `<p class="${nom}">${nom}</p>\n`)
    writeFileSync(join(srcDir, 'tuto', 'tuto-ajax.mjs'), '<p class="ajax">ajax du tuto</p>\n')
    writeFileSync(join(srcDir, 'desc.mjs'), '<p class="desc">descendante</p>\n')
    writeFileSync(join(srcDir, 'coque.mjs'), '<p class="coque">coque</p>\n<mjs-desc></mjs-desc>\n')
    writeFileSync(join(srcDir, 'home.mjs'), [
      '<script>',
      '@chauffer = -> µ.Autoloader.preload(\'coque\')',
      '</script>',
      '',
      '<h1 class="t">accueil</h1>',
      '<a id="lien" href="/autre">vers autre</a>',
      '<button id="chauffe" @click=@chauffer>chauffer</button>'
    ].join('\n') + '\n')
    writeFileSync(join(srcDir, 'other.mjs'), '<h2 class="o">autre</h2>\n<mjs-fiche-001></mjs-fiche-001>\n<mjs-fiche-002></mjs-fiche-002>\n')
    writeFileSync(join(root, 'mjs.config.json'), JSON.stringify({
      sourceDir: 'src', outputDir: 'out', manifestPath: 'out/bundle.js', urlPrefix: '/out',
      render: { default: 'prerender', engine: { prerender: 'happy-dom' }, startup: 'bundle', routes: { '/': { component: 'mjs-home' }, '/autre': { component: 'mjs-other' } } },
    }, null, 2))
    const found   = findConfig(root)!
    const bundler = new Bundler({ ...resolveBundlerOpts(found.config, found.configDir), env: 'prod' } as any)
    const stats   = await bundler.compile()
    assert.equal(stats.errors.length, 0, stats.errors.map((e: any) => e.message).join('\n'))
    const report = await prerenderPages(found.config, found.configDir, () => {}, { env: 'prod' })
    await emitStartup(bundler, found.config.render, report, { prod: true, log: () => {} })
    await bundler.close()
    table = JSON.parse(/^const µPaths = (\{.*\});$/m.exec(readFileSync(join(outDir, 'bundle.js'), 'utf-8'))![1])
    pageAutre = (await import('node:fs')).readdirSync(outDir).find(f => /^mjs_page-autre-/.test(f))!
    const corps = (url: string) => readFileSync(report.generated.find(g => g.url === url)!.file, 'utf-8')
    const coquille = (url: string) => `<!doctype html><html><head><meta charset="utf-8"><script type="module" src="/out/bundle.js"></script></head><body>${corps(url)}</body></html>`
    server = createServer((req, res) => {
      const chemin = decodeURIComponent((req.url ?? '/').split('?')[0])
      if (chemin === '/' || chemin === '/autre') {
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
        res.end(coquille(chemin))
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
    if (browser) await browser.close()
    if (server) await new Promise(resolve => server!.close(() => resolve(null)))
    await terminateSharedWorkerPool()
  })

  async function observer(parcours: (page: any) => Promise<void>) {
    const page = await browser.newPage()
    const erreurs: string[] = []
    const js: string[] = []
    const rates: string[] = []
    page.on('pageerror', (e: Error) => erreurs.push(e.message))
    page.on('console', (m: any) => { if (m.type() === 'error') erreurs.push(m.text()) })
    page.on('request', (r: any) => { if (/\.js$/.test(new URL(r.url()).pathname)) js.push(new URL(r.url()).pathname) })
    page.on('response', (r: any) => { if (r.status() >= 400) rates.push(`${r.status()} ${new URL(r.url()).pathname}`) })
    try { await parcours(page) } finally { await page.close() }
    return { erreurs, js, rates }
  }
  const existent = (js: string[]) => js.filter(u => !existsSync(join(outDir, u.replace(/^\/out\//, ''))))

  it('la table servie est bien compacte (sinon rien n\'est prouvé)', () => {
    assert.match(table['fiche-001'], /^[0-9a-z]{5}$/)
    assert.match(table['ajax'], /^tuto-[0-9a-z]{5}$/)
    assert.match(table['fiche-050'], /^[0-9a-z]{5}$/)
  })

  it('une page se monte : composants de la page chargés, alias à préfixe de dossier compris, zéro 404', async () => {
    const { erreurs, js, rates } = await observer(async page => {
      await page.goto(base + '/', { waitUntil: 'load' })
      await page.waitForFunction(() => !!customElements.get('mjs-home'), null, { timeout: 15000 })
      assert.equal(await page.evaluate(() => !!customElements.get('mjs-ajax')), false, 'pas encore chargé : personne ne le cite')
      await page.evaluate(() => document.body.appendChild(document.createElement('mjs-ajax')))
      await page.waitForFunction(() => !!customElements.get('mjs-ajax'), null, { timeout: 15000 })
      assert.equal(await page.evaluate(() => !!document.querySelector('mjs-home')), true, 'la page est là')
    })
    assert.deepEqual(erreurs, [], `erreurs : ${erreurs.join(' | ')}`)
    assert.deepEqual(rates, [], `réponses en erreur : ${rates.join(' ')}`)
    assert.deepEqual(existent(js), [], `fichiers demandés absents du disque : ${existent(js).join(' ')}`)
  })

  it('un composant chargé à la demande arrive par le chemin recollé', async () => {
    const { erreurs, js, rates } = await observer(async page => {
      await page.goto(base + '/', { waitUntil: 'load' })
      await page.waitForFunction(() => !!customElements.get('mjs-home'), null, { timeout: 15000 })
      assert.equal(await page.evaluate(() => !!customElements.get('mjs-fiche-050')), false, 'pas encore chargé')
      await page.evaluate(() => document.body.appendChild(document.createElement('mjs-fiche-050')))
      await page.waitForFunction(() => !!customElements.get('mjs-fiche-050'), null, { timeout: 15000 })
    })
    assert.deepEqual(erreurs, [], `erreurs : ${erreurs.join(' | ')}`)
    assert.deepEqual(rates, [])
    assert.equal(js.some(u => /\/out\/fiche-050-[0-9a-z]{5}\.js$/.test(u)), true, `fichier de fiche-050 demandé, vus : ${js.join(' ')}`)
    assert.deepEqual(existent(js), [])
  })

  it('µ.Autoloader.preload émet des liens vers des fichiers qui existent (coque et descendance)', async () => {
    let liens: string[] = []
    const { erreurs, rates } = await observer(async page => {
      await page.goto(base + '/', { waitUntil: 'load' })
      await page.waitForFunction(() => !!customElements.get('mjs-home'), null, { timeout: 15000 })
      await page.click('#chauffe')
      await page.waitForTimeout(500)
      liens = await page.evaluate(() => [...document.head.querySelectorAll('link[rel="modulepreload"]')].map(l => new URL((l as HTMLLinkElement).href).pathname))
    })
    assert.deepEqual(erreurs, [], `erreurs : ${erreurs.join(' | ')}`)
    assert.deepEqual(rates, [], `réponses en erreur : ${rates.join(' ')}`)
    assert.equal(liens.some(u => /\/out\/coque-[0-9a-z]{5}\.js$/.test(u)), true, `lien de la coque, vus : ${liens.join(' ')}`)
    assert.equal(liens.some(u => /\/out\/desc-[0-9a-z]{5}\.js$/.test(u)), true, 'lien de la descendante')
    assert.deepEqual(existent(liens), [], `liens vers des fichiers absents : ${existent(liens).join(' ')}`)
  })

  it('navigation interne : la fiche de page pose un nom entier dans la table compacte, les composants arrivent par ce fichier', async () => {
    let apres: string[] = []
    const { erreurs, js, rates } = await observer(async page => {
      await page.goto(base + '/', { waitUntil: 'load' })
      await page.waitForFunction(() => !!customElements.get('mjs-home'), null, { timeout: 15000 })
      await page.click('#lien')
      await page.waitForFunction(() => !!customElements.get('mjs-other'), null, { timeout: 15000 })
      await page.waitForTimeout(300)
      apres = await page.evaluate(() => ['mjs-other', 'mjs-fiche-001', 'mjs-fiche-002'].filter(t => !!customElements.get(t)))
      assert.equal(new URL(page.url()).pathname, '/autre')
      const lu = await page.evaluate(() => (window as any).µ?.paths?.['fiche-001'] ?? null)
      if (lu !== null) assert.equal(lu.includes('.'), true, 'la valeur posée par la fiche est un nom entier')
    })
    assert.deepEqual(erreurs, [], `erreurs : ${erreurs.join(' | ')}`)
    assert.deepEqual(rates, [], `réponses en erreur : ${rates.join(' ')}`)
    assert.deepEqual(apres, ['mjs-other', 'mjs-fiche-001', 'mjs-fiche-002'])
    assert.equal(js.includes(`/out/${pageAutre}`), true, `le fichier de page de /autre est demandé, vus : ${js.join(' ')}`)
    assert.deepEqual(existent(js), [])
  })

  it('chargement complet de la page /autre : mêmes composants, zéro erreur, zéro 404', async () => {
    const { erreurs, js, rates } = await observer(async page => {
      await page.goto(base + '/autre', { waitUntil: 'load' })
      await page.waitForFunction(() => !!customElements.get('mjs-other') && !!customElements.get('mjs-fiche-001'), null, { timeout: 15000 })
    })
    assert.deepEqual(erreurs, [], `erreurs : ${erreurs.join(' | ')}`)
    assert.deepEqual(rates, [])
    assert.deepEqual(existent(js), [])
  })
})
