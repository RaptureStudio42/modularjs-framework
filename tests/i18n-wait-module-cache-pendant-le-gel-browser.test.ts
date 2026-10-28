// Un module en mode `wait` n'est jamais PEINT nu pendant l'attente de son fragment, dans un vrai Chromium et un
// vrai Firefox — pourquoi ce test existe.
//
// Défaut d'origine : le premier rendu d'un module `wait` est retenu tant que son fragment manque, mais
// l'attribut `mjs-loading` (qui cache le module) était retiré avant : le navigateur peignait le gabarit brut
// (parties fixes visibles, liaisons vides, titres de 1 px, un enfant de 0 px de haut), puis les textes
// arrivaient et poussaient toute la page. Mesuré sur une application réelle, processeur ralenti 4× et
// fragments retardés de 150 ms : gabarit brut peint de 164 à 347 ms pour la page, enfant vide de 380 à 547 ms.
//
// Ce que le test garde, sur un vrai build (développement et production) servi par HTTP, fichier de langue et
// fragments retardés, l'état du module relevé à CHAQUE image (`requestAnimationFrame`) : tant que le gel tient,
// aucune image ne montre le module avec ses liaisons vides (la page, puis l'enfant créé par un `{if}` dont le
// fragment arrive plus tard) ; à la fin le module est complet. Un fragment qui échoue (404, réseau coupé)
// lève la retenue en même temps que le gel : le module paraît rendu avec ses placeholders, jamais invisible
// pour toujours. Une page prérendue (hôtes `mjs-ssr`) n'est jamais cachée, même quand la langue demandée
// diffère de la graine et que son fragment se fait attendre. Chromium tourne avec le processeur ralenti 4×.

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

type Navigateur = 'chromium' | 'firefox'
type Env        = 'dev' | 'prod'
type Panne      = 'ok' | '404' | 'coupe'

interface Etat { retard: number, retardLangue: number, panne: Panne }
interface Construction { base: string, corps: string, etat: Etat, server: Server, bundler: Bundler }

async function navigateurPresent(nom: Navigateur): Promise<boolean> {
  try {
    const playwright = await import('playwright')
    return existsSync(playwright[nom].executablePath())
  }
  catch {
    return false
  }
}

const PAGE = [
  "@i18n 'accueil'",
  '<script>',
  '  $n = 7',
  '  $ouvert = true',
  '</script>',
  '',
  '<h1 class="t">{µt(\'titre\')}</h1>',
  '<p class="n">{$n}</p>',
  '<p class="fixe">partie fixe</p>',
  '{if $ouvert}<@gel-enfant></@gel-enfant>{end}',
  ''
].join('\n')

const ENFANT = [
  "@i18n 'enfant'",
  '<script>',
  '  $m = 9',
  '</script>',
  '',
  '<h2 class="e">{µt(\'titre\')}</h2>',
  '<p class="m">{$m}</p>',
  ''
].join('\n')

// une seule construction par environnement, servie par un serveur à elle (fichier de langue et fragments retardés à la demande)
const constructions = new Map<Env, Promise<Construction>>()

async function bati(env: Env): Promise<Construction> {
  const root   = mjsTmp('i18n-wait-cache-' + env)
  const srcDir = join(root, 'src')
  const outDir = join(root, 'out')
  mkdirSync(join(srcDir, 'i18n', 'fr'), { recursive: true })
  mkdirSync(join(srcDir, 'i18n', 'en'), { recursive: true })
  writeFileSync(join(srcDir, 'i18n', 'fr.yml'), 'titre: Titre\n')
  writeFileSync(join(srcDir, 'i18n', 'en.json'), JSON.stringify({ titre: 'Title' }))
  writeFileSync(join(srcDir, 'i18n', 'fr', 'accueil.yml'), 'titre: Bonjour accueil\n')
  writeFileSync(join(srcDir, 'i18n', 'en', 'accueil.json'), JSON.stringify({ titre: 'Hello home' }))
  writeFileSync(join(srcDir, 'i18n', 'fr', 'enfant.yml'), 'titre: Bonjour enfant\n')
  writeFileSync(join(srcDir, 'i18n', 'en', 'enfant.json'), JSON.stringify({ titre: 'Hello child' }))
  writeFileSync(join(srcDir, 'gel-page.mjs'), PAGE)
  writeFileSync(join(srcDir, 'gel-enfant.mjs'), ENFANT)
  writeFileSync(join(root, 'mjs.config.json'), JSON.stringify({
    sourceDir: 'src', outputDir: 'out', manifestPath: 'out/bundle.js', urlPrefix: '/out',
    i18n: { default: 'fr', placeholder: 'wait', urlParam: true },
    render: { default: 'prerender', engine: { prerender: 'happy-dom' }, startup: 'bundle', routes: { '/': { component: 'mjs-gel-page' } } },
  }, null, 2))
  const found   = findConfig(root)!
  const bundler = new Bundler({ ...resolveBundlerOpts(found.config, found.configDir), env } as any)
  const stats   = await bundler.compile()
  assert.equal(stats.errors.length, 0, stats.errors.map((e: any) => e.message).join('\n'))
  const report = await prerenderPages(found.config, found.configDir, () => {}, { env })
  await emitStartup(bundler, found.config.render, report, { prod: env === 'prod', log: () => {} })
  await bundler.close()
  const corps = readFileSync(report.generated.find(g => g.url === '/')!.file, 'utf-8')
  assert.ok(/mjs-ssr/.test(corps), 'le prérendu marque ses hôtes mjs-ssr')
  assert.ok(corps.includes('Bonjour accueil'), 'le prérendu porte déjà le texte')
  const etat: Etat = { retard: 0, retardLangue: 0, panne: 'ok' }
  const coquille = (dedans: string) => `<!doctype html><html><head><meta charset="utf-8"><script type="module" src="/out/bundle.js"></script></head><body>${dedans}</body></html>`
  const server = createServer((req, res) => {
    const chemin = decodeURIComponent((req.url ?? '/').split('?')[0])
    if (chemin === '/' || chemin === '/ssr') {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
      res.end(coquille(chemin === '/' ? '<mjs-gel-page></mjs-gel-page>' : corps))
      return
    }
    const fichier = join(root, normalize(chemin))
    if (!fichier.startsWith(outDir) || !existsSync(fichier) || !statSync(fichier).isFile()) { res.writeHead(404); res.end(); return }
    const envoyer = () => {
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
  return { base: `http://127.0.0.1:${(server.address() as any).port}`, corps, etat, server, bundler }
}

const construire = (env: Env) => {
  if (!constructions.has(env)) constructions.set(env, bati(env))
  return constructions.get(env)!
}

// relève, à chaque image et seulement quand quelque chose a changé, ce que le visiteur verrait : l'hôte de la page
// est-il affiché (au moins une boîte de rendu, et visible : le bouclier du cœur cache par `visibility`, la place restant), les
// textes de ses liaisons (vides une fois rognés = gabarit brut), idem pour l'enfant
const SONDE = () => {
  const w = window as any
  w.__images = []
  const vu     = (el: any) => !!el && el.getClientRects().length > 0 && getComputedStyle(el).visibility !== 'hidden'
  const ombre  = (el: any) => el && (el._shadow || el.shadowRoot)
  const texte  = (racine: any, sel: string) => { const e = racine && racine.querySelector(sel); return e ? e.textContent.trim() : null }
  const tick = () => {
    const h: any  = document.querySelector('mjs-gel-page')
    const o       = ombre(h)
    const e: any  = o && o.querySelector('mjs-gel-enfant')
    const oe      = ombre(e)
    const image   = { page: h ? vu(h) : null, titre: texte(o, 'h1.t'), n: texte(o, 'p.n'), enfant: e ? vu(e) : null, enfantTitre: texte(oe, 'h2.e'), m: texte(oe, 'p.m') }
    const d       = w.__images[w.__images.length - 1]
    if (!d || JSON.stringify(d) !== JSON.stringify(image)) w.__images.push(image)
    requestAnimationFrame(tick)
  }
  requestAnimationFrame(tick)
}

interface Image { page: boolean | null, titre: string | null, n: string | null, enfant: boolean | null, enfantTitre: string | null, m: string | null }

describe('module en mode wait : jamais peint nu pendant l\'attente', function () {
  for (const nom of ['chromium', 'firefox'] as const) {
    for (const env of ['dev', 'prod'] as const) {
      describe(`module en mode wait : jamais peint nu pendant l'attente — ${nom}, ${env}`, function () {
        this.timeout(180000)
        let browser: any = null
        let c: Construction

        before(async function () {
          if (!await navigateurPresent(nom)) { console.log(`  ℹ️  ${nom} non installé : test sauté. Activer : \`npx playwright install ${nom}\``); this.skip() }
          c = await construire(env)
          browser = await (await import('playwright'))[nom].launch()
        })

        afterEach(() => { if (c) { c.etat.retard = 0; c.etat.retardLangue = 0; c.etat.panne = 'ok' } })

        after(async function () {
          if (browser) await browser.close()
        })

        // `fin` : ce que la dernière image doit montrer pour que le relevé soit complet
        async function observer(chemin: string, fin: Partial<Image>): Promise<{ images: Image[], erreurs: string[] }> {
          const page = await browser.newPage()
          const erreurs: string[] = []
          page.on('pageerror', (e: Error) => erreurs.push(e.message))
          page.on('console', (m: any) => { if (m.type() === 'error') erreurs.push(m.text()) })
          await page.addInitScript(SONDE)
          // processeur ralenti 4× (Chromium seulement : Firefox n'a pas ce réglage)
          if (nom === 'chromium') await (await page.context().newCDPSession(page)).send('Emulation.setCPUThrottlingRate', { rate: 4 })
          try {
            await page.goto(c.base + chemin, { waitUntil: 'load' })
            await page.waitForFunction((attendu: any) => { const a = (window as any).__images; const d = a[a.length - 1]; return !!d && Object.keys(attendu).every(k => d[k] === attendu[k]) }, fin, { timeout: 40000 })
            await page.waitForTimeout(300)
            return { images: await page.evaluate(() => (window as any).__images), erreurs }
          }
          finally { await page.close() }
        }

        const nues        = (images: Image[]) => images.filter(i => i.page === true && i.n === '')
        const enfantsNus  = (images: Image[]) => images.filter(i => i.enfant === true && i.m === '')

        it('fichier de langue et fragments retardés : aucune image ne montre le gabarit brut, ni de la page ni de l\'enfant, puis tout est complet', async () => {
          c.etat.retard = 400
          c.etat.retardLangue = 300
          const { images, erreurs } = await observer('/', { m: '9' })
          assert.deepEqual(erreurs, [], `erreurs : ${erreurs.join(' | ')}`)
          assert.ok(images.some(i => i.n === ''), 'le gabarit de la page a existé un moment (sinon rien n\'est prouvé)')
          assert.ok(images.some(i => i.m === ''), 'le gabarit de l\'enfant a existé un moment (sinon rien n\'est prouvé)')
          assert.equal(nues(images).length, 0, `${nues(images).length} image(s) montrent la page nue : ${JSON.stringify(nues(images))}`)
          assert.equal(enfantsNus(images).length, 0, `${enfantsNus(images).length} image(s) montrent l'enfant nu : ${JSON.stringify(enfantsNus(images))}`)
          assert.deepEqual(images[images.length - 1], { page: true, titre: 'Bonjour accueil', n: '7', enfant: true, enfantTitre: 'Bonjour enfant', m: '9' })
        })

        for (const panne of ['404', 'coupe'] as const) {
          it(`fragment qui n'arrive jamais (${panne === '404' ? '404' : 'réseau coupé'}) : jamais peint nu, puis rendu avec ses placeholders — pas invisible`, async () => {
            c.etat.retard = 300
            c.etat.panne = panne
            const { images } = await observer('/', { m: '9' })
            assert.ok(images.some(i => i.n === ''), 'le gabarit de la page a existé un moment (sinon rien n\'est prouvé)')
            assert.equal(nues(images).length, 0, `${nues(images).length} image(s) montrent la page nue : ${JSON.stringify(nues(images))}`)
            assert.equal(enfantsNus(images).length, 0, `${enfantsNus(images).length} image(s) montrent l'enfant nu : ${JSON.stringify(enfantsNus(images))}`)
            const fin = images[images.length - 1]
            assert.equal(fin.page, true, 'la page finit montrée')
            assert.equal(fin.n, '7', 'rendue, pas laissée nue')
            assert.equal(fin.titre, env === 'dev' ? '⟦accueil.titre⟧' : '', 'placeholder du mode')
            assert.equal(fin.enfant, true, 'l\'enfant finit montré')
            assert.equal(fin.m, '9')
          })
        }

        it('page prérendue (hôtes mjs-ssr) dans une autre langue que la graine, fragment retardé : l\'hôte n\'est jamais caché', async () => {
          c.etat.retard = 600
          const { images, erreurs } = await observer('/ssr?lang=en', { titre: 'Hello home', m: '9' })
          assert.deepEqual(erreurs, [], `erreurs : ${erreurs.join(' | ')}`)
          const premiere = images.findIndex(i => i.page === true)
          assert.ok(premiere >= 0, 'la page prérendue est affichée dès le départ')
          const cachees = images.slice(premiere).filter(i => i.page === false)
          assert.equal(cachees.length, 0, `${cachees.length} image(s) cachent l'hôte prérendu : ${JSON.stringify(cachees)}`)
          assert.deepEqual(images[images.length - 1], { page: true, titre: 'Hello home', n: '7', enfant: true, enfantTitre: 'Hello child', m: '9' })
        })
      })
    }
  }

  after(async function () {
    for (const [env, promesse] of constructions) {
      const k = await promesse
      await new Promise(resolve => k.server.close(() => resolve(null)))
      constructions.delete(env)
    }
    await terminateSharedWorkerPool()
  })
})
