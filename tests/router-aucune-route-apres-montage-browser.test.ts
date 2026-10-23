// « Aucune route » et premier rendu gelé par l'attente des textes traduits (`'wait'`, le défaut) : un composant routé
// qui redirige à son montage (`location.replace('#/x/1')` dans `µmount`) ne déclenche plus « Aucune route ne correspond
// à '/' ». Son montage attendait le fragment de traduction, le contrôle différé d'une image passait avant et jugeait le
// chemin du démarrage. Le contrôle attend maintenant que les composants routés aient monté, puis juge l'adresse où
// l'on est arrivé. Sans redirection, sur une adresse sans route, l'erreur arrive après le montage ; quand le fragment
// ne vient jamais, le secours de 3 s laisse le montage, puis le contrôle, se faire ; un composant sans traduction a
// l'erreur à la même image qu'avant.
// Chromium, Firefox et WebKit réels, vrai build servi par HTTP.

import assert from 'node:assert/strict'
import { createServer, type Server } from 'node:http'
import { mkdirSync, writeFileSync, readFileSync, existsSync, statSync } from 'node:fs'
import { join, extname, normalize } from 'node:path'
import { mjsTmp } from './helpers/tmp.js'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { findConfig, resolveBundlerOpts } from '../src/bundler/config.js'

const SECTION = /\/i18n\/[^/]+\/[^/]+\.json$/

type Navigateur = 'chromium' | 'firefox' | 'webkit'
type Fragment = 'retard' | 'jamais'
interface Construction { base: string, etat: { fragment: Fragment, retenues: Array<() => void> }, server: Server }

async function navigateurPresent(nom: Navigateur): Promise<boolean> {
  try {
    const playwright = await import('playwright')
    return existsSync(playwright[nom].executablePath())
  }
  catch {
    return false
  }
}

// une seule route, sans `/` ; au montage : l'instant et l'image notés, puis la redirection si l'adresse n'a pas de fragment
const ROUTES  = '<routes target="v">\n/x/(:id)  fiche\n</routes>\n'
const MONTAGE = "<script>\n  µmount ->\n    window.__monte = performance.now()\n    window.__monteImage = window.__image\n    location.replace('#/x/1') unless location.hash\n</script>\n"
const PAGES: Record<string, string> = { '/traduit': '<mjs-traduit></mjs-traduit>', '/simple': '<mjs-simple></mjs-simple>' }

let construction: Promise<Construction> | null = null

async function bati(): Promise<Construction> {
  const root   = mjsTmp('routeur-aucune-route-montage')
  const srcDir = join(root, 'src')
  const outDir = join(root, 'out')
  mkdirSync(join(srcDir, 'i18n', 'fr'), { recursive: true })
  writeFileSync(join(srcDir, 'i18n', 'fr.yml'), 'titre: Titre\n')
  writeFileSync(join(srcDir, 'i18n', 'fr', 'traduit.yml'), 'texte: Bonjour\n')
  writeFileSync(join(srcDir, 'traduit.page.mjs'), "@i18n 'traduit'\n" + ROUTES + MONTAGE + "<p class=\"t\">{µt('texte')}</p>\n<@view v>\n")
  writeFileSync(join(srcDir, 'simple.page.mjs'), ROUTES + MONTAGE + '<@view v>\n')
  writeFileSync(join(srcDir, 'fiche.mjs'), '<p class="fiche">FICHE</p>\n')
  writeFileSync(join(root, 'mjs.config.json'), JSON.stringify({
    sourceDir: 'src', outputDir: 'out', manifestPath: 'out/bundle.js', urlPrefix: '/out',
    i18n: { default: 'fr' }
  }, null, 2))
  const found   = findConfig(root)!
  const bundler = new Bundler({ ...resolveBundlerOpts(found.config, found.configDir), env: 'dev' } as any)
  const stats   = await bundler.compile()
  assert.equal(stats.errors.length, 0, stats.errors.map((e: any) => e.message).join('\n'))
  await bundler.close()
  const etat = { fragment: 'retard' as Fragment, retenues: [] as Array<() => void> }
  const coquille = (corps: string) => `<!doctype html><html><head><meta charset="utf-8"><script type="module" src="/out/bundle.js"></script></head><body>${corps}</body></html>`
  const server = createServer((req, res) => {
    const chemin = decodeURIComponent((req.url ?? '/').split('?')[0])
    if (PAGES[chemin]) {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
      res.end(coquille(PAGES[chemin]))
      return
    }
    const fichier = join(root, normalize(chemin))
    if (!fichier.startsWith(outDir) || !existsSync(fichier) || !statSync(fichier).isFile()) { res.writeHead(404); res.end(); return }
    const envoyer = () => {
      res.writeHead(200, { 'content-type': extname(fichier) === '.js' ? 'text/javascript; charset=utf-8' : 'application/json' })
      res.end(readFileSync(fichier))
    }
    // le fragment de traduction arrive en retard, ou jamais
    if (SECTION.test(chemin) && etat.fragment === 'jamais') etat.retenues.push(envoyer)
    else if (SECTION.test(chemin)) setTimeout(envoyer, 400)
    else envoyer()
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', () => resolve()))
  return { base: `http://127.0.0.1:${(server.address() as any).port}`, etat, server }
}

// compteur d'images, et chaque `console.error` noté avec son instant et son image
const SONDE = () => {
  const w = window as any
  w.__image = 0
  w.__erreurs = []
  const tick = () => { w.__image++; requestAnimationFrame(tick) }
  requestAnimationFrame(tick)
  const err = console.error.bind(console)
  console.error = (...a: any[]) => { w.__erreurs.push({ t: performance.now(), image: w.__image, m: String(a[0]) }); err(...a) }
}

describe('aucune route : le contrôle attend le montage des composants routés — dans de vrais navigateurs', function () {
  for (const nom of ['chromium', 'firefox', 'webkit'] as const) {
    describe(`aucune route après le montage — ${nom}`, function () {
      this.timeout(120000)
      let browser: any = null
      let c: Construction

      before(async function () {
        if (!await navigateurPresent(nom)) { console.log(`  ℹ️  ${nom} non installé : test sauté. Activer : \`npx playwright install ${nom}\``); this.skip() }
        if (!construction) construction = bati()
        c = await construction
        browser = await (await import('playwright'))[nom].launch(nom === 'chromium' ? { args: ['--no-proxy-server'] } : {})
      })

      afterEach(() => { if (c) c.etat.retenues.splice(0) })

      after(async function () {
        if (browser) await browser.close()
      })

      // ouvre `adresse` (fragment de traduction `fragment`), attend le montage puis 400 ms, et rend l'état de la vue
      // routée avec les erreurs du routeur en console (instant, image) et le montage (instant, image)
      async function ouvrir(adresse: string, fragment: Fragment) {
        c.etat.fragment = fragment
        const contexte = await browser.newContext()
        const exceptions: string[] = []
        try {
          const page = await contexte.newPage()
          page.on('pageerror', (e: any) => exceptions.push(String(e)))
          await page.addInitScript(SONDE)
          await page.goto(c.base + adresse)
          await page.waitForFunction(() => (window as any).__monte > 0, null, { timeout: 10000 })
          await page.waitForTimeout(400)
          const r = await page.evaluate(() => {
            const w: any = window
            const hote: any = document.querySelector('mjs-traduit, mjs-simple')
            const vue = hote && hote._shadow ? hote._shadow.querySelector('metamjs-view') : null
            return {
              hash:        location.hash,
              vue:         vue && vue.firstElementChild ? vue.firstElementChild.tagName.toLowerCase() : '',
              panneau:     !!(vue && vue.querySelector('[data-mjs-route-error]')),
              monte:       w.__monte as number,
              monteImage:  w.__monteImage as number,
              erreurs:     (w.__erreurs as any[]).filter((e) => e.m.includes('[Router]'))
            }
          })
          return { ...r, exceptions }
        }
        finally { await contexte.close() }
      }

      it('textes en attente, fragment en retard, redirection au montage : aucune erreur, la vue de la route s\'affiche', async () => {
        const r = await ouvrir('/traduit', 'retard')
        assert.deepEqual(r.erreurs.map((e: any) => e.m), [], 'AVANT : « Aucune route ne correspond à \'/\' », jugé avant le montage, gelé par l\'attente des textes')
        assert.equal(r.hash, '#/x/1')
        assert.equal(r.vue, 'mjs-fiche')
        assert.equal(r.panneau, false)
        assert.deepEqual(r.exceptions, [])
      })

      it('textes en attente, sans redirection, adresse sans route : l\'erreur arrive après le montage', async () => {
        const r = await ouvrir('/traduit#/rien', 'retard')
        assert.equal(r.erreurs.length, 1, r.erreurs.map((e: any) => e.m).join('\n'))
        assert.match(r.erreurs[0].m, /'\/rien'/)
        assert.ok(r.erreurs[0].t >= r.monte, `après le montage (erreur à ${Math.round(r.erreurs[0].t)} ms, montage à ${Math.round(r.monte)} ms)`)
        assert.equal(r.panneau, true)
        assert.deepEqual(r.exceptions, [])
      })

      it('fragment qui ne vient jamais, redirection au montage : le secours de 3 s monte le composant, aucune erreur', async () => {
        const r = await ouvrir('/traduit', 'jamais')
        assert.ok(r.monte >= 2500, `montage par le secours (à ${Math.round(r.monte)} ms)`)
        assert.deepEqual(r.erreurs.map((e: any) => e.m), [], 'AVANT : l\'erreur dès la première image')
        assert.equal(r.hash, '#/x/1')
        assert.equal(r.vue, 'mjs-fiche')
        assert.deepEqual(r.exceptions, [])
      })

      it('fragment qui ne vient jamais, sans redirection, adresse sans route : l\'erreur arrive après le montage du secours', async () => {
        const r = await ouvrir('/traduit#/rien', 'jamais')
        assert.ok(r.monte >= 2500, `montage par le secours (à ${Math.round(r.monte)} ms)`)
        assert.equal(r.erreurs.length, 1, r.erreurs.map((e: any) => e.m).join('\n'))
        assert.match(r.erreurs[0].m, /'\/rien'/)
        assert.ok(r.erreurs[0].t >= r.monte, `après le montage (erreur à ${Math.round(r.erreurs[0].t)} ms, montage à ${Math.round(r.monte)} ms)`)
        assert.equal(r.panneau, true)
      })

      it('sans traduction, adresse sans route : l\'erreur à la même image qu\'avant, celle qui suit le montage', async () => {
        const r = await ouvrir('/simple#/rien', 'retard')
        assert.equal(r.erreurs.length, 1, r.erreurs.map((e: any) => e.m).join('\n'))
        assert.match(r.erreurs[0].m, /'\/rien'/)
        assert.ok(r.erreurs[0].image - r.monteImage <= 1, `image du montage ${r.monteImage}, image de l'erreur ${r.erreurs[0].image}`)
        assert.equal(r.panneau, true)
        assert.deepEqual(r.exceptions, [])
      })
    })
  }

  after(async function () {
    if (construction) {
      const k = await construction
      k.server.closeAllConnections()
      await new Promise(resolve => k.server.close(() => resolve(null)))
      construction = null
    }
    await terminateSharedWorkerPool()
  })
})
