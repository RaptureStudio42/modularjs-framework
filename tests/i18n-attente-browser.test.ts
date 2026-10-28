// L'attente des textes traduits dans de vrais navigateurs (Chromium, Firefox, WebKit) : un vrai build de production servi par HTTP,
// fichier de langue et fragments retardés, l'état de la page relevé à CHAQUE image (`requestAnimationFrame`).
//
//   - par défaut (`wait`) : le module est caché tant que ses textes manquent, puis paraît d'un coup — aucune image ne le montre nu
//     (liaisons vides), avec le nom de la clé ou avec des barres ;
//   - `*skeleton` : le module est là, des barres grises (espaces de chiffre peints par un surlignage) à la place de chaque texte, puis les textes ;
//   - `*loader(bloom)` : l'indicateur est affiché à la place du module, qui reste caché, puis l'indicateur est retiré et le module paraît ;
//   - un fragment en 404 ou un réseau coupé : le module paraît quand même, avec des barres à la place des textes manquants (jamais invisible pour toujours) ;
//   - une page prérendue (hôtes `mjs-ssr`) n'attend pas : ses textes sont déjà là, elle n'est jamais cachée et n'affiche aucun indicateur.

import assert from 'node:assert/strict'
import { createServer, type Server } from 'node:http'
import { mkdirSync, writeFileSync, readFileSync, existsSync, statSync } from 'node:fs'
import { join, extname, normalize } from 'node:path'
import { mjsTmp } from './helpers/tmp.js'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { findConfig, resolveBundlerOpts } from '../src/bundler/config.js'
import { prerenderPages } from '../src/server/prerender.js'
import { emitStartup } from '../src/bundler/startup.js'

const SECTION = /\/i18n\/[^/]+\/[^/]+\.json$/
const LANGUE  = /\/mjs_i18n-[^/]*\.js$/
const BARRE   = ' '.repeat(12)

type Navigateur = 'chromium' | 'firefox' | 'webkit'
type Panne      = 'ok' | '404' | 'coupe' | 'silence'

interface Etat { retard: number, retardLangue: number, panne: Panne, retenues: Array<() => void> }
interface Construction { base: string, etat: Etat, server: Server }

async function navigateurPresent(nom: Navigateur): Promise<boolean> {
  try {
    const playwright = await import('playwright')
    return existsSync(playwright[nom].executablePath())
  }
  catch {
    return false
  }
}

const module_ = (directive: string) => [
  "@i18n 'accueil'",
  directive,
  '<script>',
  '  $n = 7',
  '</script>',
  '',
  '<h1 class="t">{µt(\'titre\')}</h1>',
  '<p class="n">{$n}</p>',
  '<p class="fixe">partie fixe</p>',
  ''
].join('\n')

let construction: Promise<Construction> | null = null

async function bati(): Promise<Construction> {
  const root   = mjsTmp('i18n-attente-browser')
  const srcDir = join(root, 'src')
  const outDir = join(root, 'out')
  mkdirSync(join(srcDir, 'i18n', 'fr'), { recursive: true })
  mkdirSync(join(srcDir, 'i18n', 'en'), { recursive: true })
  writeFileSync(join(srcDir, 'i18n', 'fr.yml'), 'titre: Titre\n')
  writeFileSync(join(srcDir, 'i18n', 'en.json'), JSON.stringify({ titre: 'Title' }))
  writeFileSync(join(srcDir, 'i18n', 'fr', 'accueil.yml'), 'titre: Bonjour accueil\n')
  writeFileSync(join(srcDir, 'i18n', 'en', 'accueil.json'), JSON.stringify({ titre: 'Hello home' }))
  writeFileSync(join(srcDir, 'att-wait.mjs'), module_(''))
  writeFileSync(join(srcDir, 'att-skel.mjs'), module_('@i18nPlaceholder *skeleton(color: #ff00aa)'))
  writeFileSync(join(srcDir, 'att-loader.mjs'), module_('@i18nPlaceholder *loader(bloom)'))
  writeFileSync(join(root, 'mjs.config.json'), JSON.stringify({
    sourceDir: 'src', outputDir: 'out', manifestPath: 'out/bundle.js', urlPrefix: '/out',
    i18n: { default: 'fr', urlParam: true },
    render: { default: 'prerender', engine: { prerender: 'happy-dom' }, startup: 'bundle', routes: { '/': { component: 'mjs-att-wait' }, '/chargeur': { component: 'mjs-att-loader' } } },
  }, null, 2))
  const found   = findConfig(root)!
  const bundler = new Bundler({ ...resolveBundlerOpts(found.config, found.configDir), env: 'prod' } as any)
  const stats   = await bundler.compile()
  assert.equal(stats.errors.length, 0, stats.errors.map((e: any) => e.message).join('\n'))
  const report = await prerenderPages(found.config, found.configDir, () => {}, { env: 'prod' })
  await emitStartup(bundler, found.config.render, report, { prod: true, log: () => {} })
  await bundler.close()
  const corps = (url: string) => readFileSync(report.generated.find(g => g.url === url)!.file, 'utf-8')
  assert.ok(/mjs-ssr/.test(corps('/')), 'le prérendu marque ses hôtes mjs-ssr')
  assert.ok(corps('/').includes('Bonjour accueil'), 'le prérendu porte déjà le texte')
  const etat: Etat = { retard: 0, retardLangue: 0, panne: 'ok', retenues: [] }
  const coquille = (dedans: string) => `<!doctype html><html><head><meta charset="utf-8"><script type="module" src="/out/bundle.js"></script></head><body>${dedans}</body></html>`
  const pages: Record<string, string> = {
    '/attente': coquille('<mjs-att-wait></mjs-att-wait>'),
    '/barres': coquille('<mjs-att-skel></mjs-att-skel>'),
    '/chargeur': coquille('<mjs-att-loader></mjs-att-loader>'),
    '/ssr': coquille(corps('/')),
    '/ssr-chargeur': coquille(corps('/chargeur')),
  }
  const server = createServer((req, res) => {
    const chemin = decodeURIComponent((req.url ?? '/').split('?')[0])
    if (pages[chemin]) {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
      res.end(pages[chemin])
      return
    }
    const fichier = join(root, normalize(chemin))
    if (!fichier.startsWith(outDir) || !existsSync(fichier) || !statSync(fichier).isFile()) { res.writeHead(404); res.end(); return }
    const envoyer = () => {
      // une requête qui ne répond jamais : retenue jusqu'à ce que le test la libère
      if (SECTION.test(chemin) && etat.panne === 'silence') { etat.retenues.push(envoyer); return }
      if (SECTION.test(chemin) && etat.panne === 'coupe') { res.destroy(); return }
      if (SECTION.test(chemin) && etat.panne === '404') { res.writeHead(404); res.end(); return }
      res.writeHead(200, { 'content-type': extname(fichier) === '.js' ? 'text/javascript; charset=utf-8' : 'application/json' })
      res.end(readFileSync(fichier))
    }
    if (SECTION.test(chemin)) setTimeout(envoyer, etat.retard)
    else if (LANGUE.test(chemin)) setTimeout(envoyer, etat.retardLangue)
    else envoyer()
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', () => resolve()))
  return { base: `http://127.0.0.1:${(server.address() as any).port}`, etat, server }
}

// relève, à chaque image et seulement quand quelque chose a changé, ce que le visiteur verrait : l'hôte est-il affiché (au moins une
// boîte de rendu), le texte brut de son titre (les barres sont des espaces de chiffre), son nombre, l'indicateur de chargement
// (sa balise posée avant l'hôte, une boîte de rendu), et la feuille des barres adoptée par l'ombre de l'hôte
const SONDE = () => {
  const w = window as any
  w.__images = []
  const vu    = (el: any) => !!el && el.getClientRects().length > 0 && getComputedStyle(el).visibility !== 'hidden'
  const ombre = (el: any) => el && (el._shadow || el.shadowRoot)
  const texte = (racine: any, sel: string) => { const e = racine && racine.querySelector(sel); return e ? e.textContent : null }
  const tick = () => {
    const h: any = document.querySelector('mjs-att-wait, mjs-att-skel, mjs-att-loader')
    const o      = ombre(h)
    const place  = document.querySelector('[mjs-i18n-loader]')
    const couche = place && place.querySelector('[mjs-fx-layer="loader"]')
    const feuilles = o && o.adoptedStyleSheets ? Array.from(o.adoptedStyleSheets).map((f: any) => Array.from(f.cssRules).map((r: any) => r.cssText).join('')).filter((c: string) => c.includes('mjs-i18n-skel')) : []
    // l'instant où le module paraît AVEC son contenu (avant sa mise à niveau, la balise vide a déjà une boîte)
    if (h && vu(h) && o && o.querySelector('h1.t') && !w.__vu) w.__vu = performance.now()
    const image  = { hote: h ? vu(h) : null, titre: texte(o, 'h1.t'), n: texte(o, 'p.n'), chargeur: couche ? vu(couche) : false, feuille: feuilles.length > 0 ? feuilles[0] : null }
    const d      = w.__images[w.__images.length - 1]
    if (!d || JSON.stringify(d) !== JSON.stringify(image)) w.__images.push(image)
    requestAnimationFrame(tick)
  }
  requestAnimationFrame(tick)
}

interface Image { hote: boolean | null, titre: string | null, n: string | null, chargeur: boolean, feuille: string | null }

describe('attente des textes traduits — dans de vrais navigateurs', function () {
  for (const nom of ['chromium', 'firefox', 'webkit'] as const) {
    describe(`attente des textes traduits — ${nom}, production`, function () {
      this.timeout(180000)
      let browser: any = null
      let c: Construction

      before(async function () {
        if (!await navigateurPresent(nom)) { console.log(`  ℹ️  ${nom} non installé : test sauté. Activer : \`npx playwright install ${nom}\``); this.skip() }
        if (!construction) construction = bati()
        c = await construction
        browser = await (await import('playwright'))[nom].launch()
      })

      afterEach(() => { if (c) { c.etat.retard = 0; c.etat.retardLangue = 0; c.etat.panne = 'ok'; c.etat.retenues.splice(0) } })

      after(async function () {
        if (browser) await browser.close()
      })

      // `fin` : ce que la dernière image doit montrer pour que le relevé soit complet
      async function observer(chemin: string, fin: Partial<Image>): Promise<{ images: Image[], erreurs: string[] }> {
        const page = await browser.newPage()
        const erreurs: string[] = []
        page.on('pageerror', (e: Error) => erreurs.push(e.message))
        await page.addInitScript(SONDE)
        try {
          await page.goto(c.base + chemin, { waitUntil: 'load' })
          await page.waitForFunction((attendu: any) => { const a = (window as any).__images; const d = a[a.length - 1]; return !!d && Object.keys(attendu).every(k => d[k] === attendu[k]) }, fin, { timeout: 40000 })
          await page.waitForTimeout(300)
          return { images: await page.evaluate(() => (window as any).__images), erreurs }
        }
        finally { await page.close() }
      }

      const nus = (images: Image[]) => images.filter(i => i.hote === true && i.n === '')

      it('par défaut (wait) : caché pendant l\'attente, puis affiché d\'un coup — jamais nu, ni avec le nom de la clé, ni avec des barres', async () => {
        c.etat.retard = 400
        c.etat.retardLangue = 300
        const { images, erreurs } = await observer('/attente', { hote: true, titre: 'Bonjour accueil', n: '7' })
        assert.deepEqual(erreurs, [], `erreurs : ${erreurs.join(' | ')}`)
        assert.ok(images.some(i => i.hote === false), 'le module a été caché un moment (sinon rien n\'est prouvé)')
        assert.equal(nus(images).length, 0, `${nus(images).length} image(s) montrent le module nu : ${JSON.stringify(nus(images))}`)
        // la balise vide d'avant sa mise à niveau (titre null) n'est pas le module : on regarde ce qu'il montre une fois rendu
        const visibles = images.filter(i => i.hote === true && i.titre !== null)
        assert.ok(visibles.length > 0 && visibles.every(i => i.titre === 'Bonjour accueil'), `une image montre le module sans son texte : ${JSON.stringify(visibles)}`)
        assert.equal(images.filter(i => i.chargeur).length, 0, 'aucun indicateur sans demande')
      })

      for (const panne of ['404', 'coupe'] as const) {
        it(`par défaut, fragment qui n'arrive jamais (${panne === '404' ? '404' : 'réseau coupé'}) : le module paraît quand même, avec ses repères`, async () => {
          c.etat.retard = 300
          c.etat.panne = panne
          const { images } = await observer('/attente', { hote: true, n: '7' })
          assert.equal(nus(images).length, 0, `${nus(images).length} image(s) montrent le module nu`)
          const fin = images[images.length - 1]
          assert.equal(fin.hote, true, 'jamais invisible pour toujours')
          // Firefox met parfois plus de 3 s à constater une connexion coupée : le secours montre alors des barres, que l'échec ne remplace pas
          assert.ok(fin.titre === '' || fin.titre === BARRE, `sans son texte, rendu quand même (repère : ${JSON.stringify(fin.titre)})`)
        })
      }

      it('une requête de traduction qui ne répond jamais : au bout de 3 s le module paraît avec des barres, puis les vrais textes les remplacent', async () => {
        c.etat.panne = 'silence'
        const page = await browser.newPage()
        await page.addInitScript(SONDE)
        try {
          await page.goto(c.base + '/attente', { waitUntil: 'load' })
          // le module rendu (avant sa mise à niveau, la balise vide a déjà une boîte)
          await page.waitForFunction(() => { const a = (window as any).__images; const d = a[a.length - 1]; return !!d && d.hote === true && d.titre !== null }, null, { timeout: 20000 })
          const images: Image[] = await page.evaluate(() => (window as any).__images)
          const vu: number = await page.evaluate(() => (window as any).__vu)
          assert.ok(vu >= 2800, `le module ne paraît qu'après le délai de secours (paru à ${Math.round(vu)} ms)`)
          assert.equal(nus(images).length, 0, 'jamais nu')
          const premiere = images.find(i => i.hote === true && i.titre !== null)!
          assert.equal(premiere.titre, BARRE, 'des barres à la place du texte')
          assert.equal(premiere.n, '7')
          c.etat.panne = 'ok'
          c.etat.retenues.splice(0).forEach(f => f())
          await page.waitForFunction(() => { const a = (window as any).__images; const d = a[a.length - 1]; return !!d && d.titre === 'Bonjour accueil' }, null, { timeout: 20000 })
        }
        finally { await page.close() }
      })

      it('*skeleton : le module est là avec des barres à la place du texte (peintes par un surlignage), puis les textes', async () => {
        c.etat.retard = 500
        const { images } = await observer('/barres', { hote: true, titre: 'Bonjour accueil' })
        const avec = images.filter(i => i.hote === true && i.titre === BARRE)
        assert.ok(avec.length > 0, `aucune image ne montre les barres : ${JSON.stringify(images)}`)
        assert.ok(avec.every(i => i.n === '7'), 'le reste du module est rendu')
        const feuille = images.map(i => i.feuille).find(Boolean)
        if (feuille) assert.match(feuille, /background-color:\s*(?:#ff00aa|rgb\(255,\s*0,\s*170\))/, 'la couleur écrite peint les barres')
        assert.deepEqual(images[images.length - 1], { hote: true, titre: 'Bonjour accueil', n: '7', chargeur: false, feuille: images[images.length - 1].feuille })
      })

      it('*loader(bloom) : l\'indicateur est affiché à la place du module, qui reste caché, puis l\'indicateur est retiré', async () => {
        c.etat.retard = 600
        const { images } = await observer('/chargeur', { hote: true, titre: 'Bonjour accueil', chargeur: false })
        const pendant = images.filter(i => i.chargeur)
        assert.ok(pendant.length > 0, `aucune image ne montre l'indicateur : ${JSON.stringify(images)}`)
        assert.ok(pendant.every(i => i.hote !== true), `le module est montré en même temps que l'indicateur : ${JSON.stringify(pendant)}`)
        assert.equal(nus(images).length, 0, 'jamais nu')
        assert.deepEqual(images[images.length - 1], { hote: true, titre: 'Bonjour accueil', n: '7', chargeur: false, feuille: null })
      })

      it('*loader(bloom), fragment en 404 : l\'indicateur est retiré et le module paraît avec des barres à la place de ses textes', async () => {
        c.etat.retard = 300
        c.etat.panne = '404'
        const { images } = await observer('/chargeur', { hote: true, n: '7', chargeur: false })
        assert.ok(images.some(i => i.chargeur), 'l\'indicateur a été affiché pendant l\'attente')
        const fin = images[images.length - 1]
        assert.equal(fin.titre, BARRE, 'les barres du texte que l\'échec laisse sans valeur, pas le vide')
        assert.equal(fin.chargeur, false)
      })

      it('page prérendue (hôtes mjs-ssr), fragment retardé : jamais cachée, aucun indicateur', async () => {
        c.etat.retard = 600
        for (const chemin of ['/ssr?lang=en', '/ssr-chargeur?lang=en']) {
          const { images, erreurs } = await observer(chemin, { titre: 'Hello home', chargeur: false })
          assert.deepEqual(erreurs, [], `erreurs : ${erreurs.join(' | ')}`)
          const premiere = images.findIndex(i => i.hote === true)
          assert.ok(premiere >= 0, 'la page prérendue est affichée dès le départ')
          assert.equal(images.slice(premiere).filter(i => i.hote === false).length, 0, `${chemin} : l'hôte prérendu est caché un moment`)
          assert.equal(images.filter(i => i.chargeur).length, 0, `${chemin} : un indicateur sur une page prérendue`)
        }
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
