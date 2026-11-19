// « Aucune route » quand le premier rendu d'un composant routé reste gelé par l'attente de ses textes : le contrôle attend
// son montage (il peut rediriger dans son µmount), et, tant que des textes sont en route, il ne demande aucune image. Sous
// `*loader`, un fragment de traductions qui ne vient pas faisait demander une image à chaque image, sans fin ; à son arrivée,
// le composant monte et l'adresse est jugée. Un fragment qui arrive tard (réseau lent, après 600 images et après l'attente
// des textes plus 2 s) sur un composant qui redirige finit sur la bonne route, sans erreur. Sous `wait`, le secours monte le
// composant, fragment toujours en route : son montage réveille le contrôle (adresse sans route jugée, ou redirection suivie).
// La cadence de l'écran est imitée (`requestAnimationFrame` à 240 images par seconde, chaque image avec son instant) et les
// images demandées sont comptées. Chromium, Firefox et WebKit réels, constructions de développement et de production servies par HTTP.

import assert from 'node:assert/strict'
import { createServer, type Server } from 'node:http'
import { mkdirSync, writeFileSync, readFileSync, existsSync, statSync } from 'node:fs'
import { join, extname, normalize } from 'node:path'
import { mjsTmp } from './helpers/tmp.js'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { findConfig, resolveBundlerOpts } from '../src/bundler/config.js'

// les fragments de traductions des modules sont retenus, jusqu'à ce que le test les envoie
const SECTION = /\/i18n\/[^/]+\/[^/]+\.json$/

type Navigateur = 'chromium' | 'firefox' | 'webkit'
type Env = 'dev' | 'prod'
interface Construction { base: string, retenues: Array<() => void>, server: Server }

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
const PAGES: Record<string, string> = {
  '/traduit':     '<mjs-traduit></mjs-traduit>',
  '/charge':      '<mjs-charge></mjs-charge>',
  '/double':      '<mjs-hote></mjs-hote><mjs-charge></mjs-charge>',
  '/double-wait': '<mjs-hote></mjs-hote><mjs-traduit></mjs-traduit>'
}

const constructions = new Map<string, Promise<Construction>>()

async function bati(env: Env): Promise<Construction> {
  const root   = mjsTmp('routeur-aucune-route-textes-en-route')
  const srcDir = join(root, 'src')
  const outDir = join(root, 'out')
  mkdirSync(join(srcDir, 'i18n', 'fr'), { recursive: true })
  writeFileSync(join(srcDir, 'i18n', 'fr.yml'), 'titre: Titre\n')
  writeFileSync(join(srcDir, 'i18n', 'fr', 'traduit.yml'), 'texte: Bonjour\n')
  writeFileSync(join(srcDir, 'i18n', 'fr', 'charge.yml'), 'texte: Bonjour\n')
  writeFileSync(join(srcDir, 'traduit.page.mjs'), "@i18n 'traduit'\n" + ROUTES + MONTAGE + "<p class=\"t\">{µt('texte')}</p>\n<@view v>\n")
  writeFileSync(join(srcDir, 'charge.page.mjs'), "@i18n 'charge'\n@i18nPlaceholder *loader(bloom)\n" + ROUTES + MONTAGE + "<p class=\"t\">{µt('texte')}</p>\n<@view v>\n")
  writeFileSync(join(srcDir, 'fiche.mjs'), '<p class="fiche">FICHE</p>\n')
  // un hôte à sa propre vue, sans textes : il juge l'adresse quand le composant qui attend ses textes n'est plus là
  writeFileSync(join(srcDir, 'hote.page.mjs'), '<routes target="v">\n/y/(:id)  fiche\n</routes>\n<p>HOTE</p>\n<@view v>\n')
  writeFileSync(join(root, 'mjs.config.json'), JSON.stringify({
    sourceDir: 'src', outputDir: 'out', manifestPath: 'out/bundle.js', urlPrefix: '/out',
    i18n: { default: 'fr', hash: false }
  }, null, 2))
  const found   = findConfig(root)!
  const bundler = new Bundler({ ...resolveBundlerOpts(found.config, found.configDir), env } as any)
  const stats   = await bundler.compile()
  assert.equal(stats.errors.length, 0, stats.errors.map((e: any) => e.message).join('\n'))
  await bundler.close()
  const retenues = [] as Array<() => void>
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
      if (!res.headersSent) res.writeHead(200, { 'content-type': extname(fichier) === '.js' ? 'text/javascript; charset=utf-8' : 'application/json' })
      res.end(readFileSync(fichier))
    }
    // fragment retenu : ses en-têtes partent tout de suite, son corps quand le test l'envoie (sans les en-têtes, Firefox voit
    // la requête coupée vers 5 s, un échec qui lève l'attente de `*loader`)
    if (SECTION.test(chemin)) {
      res.writeHead(200, { 'content-type': 'application/json' })
      res.flushHeaders()
      retenues.push(envoyer)
    }
    else envoyer()
  })
  server.keepAliveTimeout = 0
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', () => resolve()))
  return { base: `http://127.0.0.1:${(server.address() as any).port}`, retenues, server }
}

function construction(env: Env) {
  if (!constructions.has(env)) constructions.set(env, bati(env))
  return constructions.get(env)!
}

// écran imité : `?hz=N` dans l'adresse, N images par seconde, chacune avec son instant (une minuterie en retard rattrape les
// images dues : aucune image sautée) ; compteurs des images jouées et des images demandées par la page, et chaque
// `console.error` noté avec son instant et son image
const SONDE = () => {
  const w    = window as any
  const pas  = 1000 / (Number(new URLSearchParams(location.search).get('hz')) || 60)
  let file   = [] as any[]
  let numero = 0
  let image  = performance.now() + pas
  const battre = () => {
    for (const maintenant = performance.now(); image <= maintenant; image += pas) {
      const dues = file
      file = []
      w.__image++
      for (const [, cb] of dues) cb(image)
    }
    setTimeout(battre, 1)
  }
  w.__image    = 0
  w.__demandes = 0
  w.__erreurs  = []
  w.requestAnimationFrame = (cb: any) => { w.__demandes++; file.push([++numero, cb]); return numero }
  w.cancelAnimationFrame  = (id: number) => { file = file.filter((e) => e[0] !== id) }
  setTimeout(battre, 1)
  const err = console.error.bind(console)
  console.error = (...a: any[]) => { w.__erreurs.push({ t: performance.now(), image: w.__image, m: String(a[0]) }); err(...a) }
}

describe('aucune route : le contrôle attend sans image tant que des textes sont en route — dans de vrais navigateurs', function () {
  for (const nom of ['chromium', 'firefox', 'webkit'] as const) {
    for (const env of ['dev', 'prod'] as const) {
      describe(`aucune route, textes en route — ${nom}, ${env}`, function () {
        this.timeout(120000)
        let browser: any = null

        before(async function () {
          if (!await navigateurPresent(nom)) { console.log(`  ℹ️  ${nom} non installé : test sauté. Activer : \`npx playwright install ${nom}\``); this.skip() }
          browser = await (await import('playwright'))[nom].launch(nom === 'chromium' ? { args: ['--no-proxy-server'] } : {})
        })

        afterEach(async () => {
          for (const c of constructions.values()) (await c).retenues.splice(0)
        })

        after(async function () {
          if (browser) await browser.close()
        })

        // ouvre `adresse`, joue `pendant(page)`, puis rend l'état de la vue routée, les erreurs du routeur en console et le
        // montage (instant, image)
        async function ouvrir(c: Construction, adresse: string, pendant: (page: any) => Promise<void>) {
          const contexte   = await browser.newContext()
          const exceptions = [] as string[]
          try {
            const page = await contexte.newPage()
            page.on('pageerror', (e: any) => exceptions.push(String(e)))
            await page.addInitScript(SONDE)
            await page.goto(c.base + adresse)
            await pendant(page)
            const r = await page.evaluate(() => {
              const w: any = window
              const hote: any = document.querySelector('mjs-hote, mjs-traduit, mjs-charge')
              const vue = hote && hote._shadow ? hote._shadow.querySelector('metamjs-view') : null
              return {
                hash:        location.hash,
                vue:         vue && vue.firstElementChild ? vue.firstElementChild.tagName.toLowerCase() : '',
                panneau:     !!(vue && vue.querySelector('[data-mjs-route-error]')),
                monte:       (w.__monte ?? -1) as number,
                monteImage:  (w.__monteImage ?? -1) as number,
                erreurs:     (w.__erreurs as any[]).filter((e) => e.m.includes('[Router]'))
              }
            })
            return { ...r, exceptions }
          }
          finally { await contexte.close() }
        }

        // le fragment du module demandé et retenu par le serveur
        async function retenu(c: Construction, page: any) {
          for (let i = 0; !c.retenues.length; i++) {
            assert.ok(i < 100, 'le fragment n\'a jamais été demandé')
            await page.waitForTimeout(50)
          }
        }
        const routeur = (page: any) => page.evaluate(() => (window as any).__erreurs.filter((e: any) => e.m.includes('[Router]')).length)
        const lignes  = (r: any) => r.erreurs.map((e: any) => `${Math.round(e.t)} ms, image ${e.image} : ${e.m.slice(0, 90)}`).join('\n')
        // en production, le texte court (`routerNoRoute`) est réécrit en entier à l'arrivée des messages : une ligne de plus
        const jugements = (r: any) => r.erreurs.filter((e: any) => env === 'dev' || e.m.includes('routerNoRoute'))

        for (const [adresse, tag] of [['/double?hz=240#/rien', 'mjs-charge'], ['/double-wait?hz=240#/rien', 'mjs-traduit']] as const) {
          it(`composant qui attend ses textes retiré sans navigation (${tag}) : l'hôte juge l'adresse sans le fragment, au plus tard à l'échéance de l'attente des textes`, async () => {
            const c = await construction(env)
            let retrait = -1
            const r = await ouvrir(c, adresse, async (page) => {
              await retenu(c, page)
              await page.waitForTimeout(1000)
              retrait = await page.evaluate((t: string) => { document.querySelector(t)!.remove(); return performance.now() }, tag)
              await page.waitForFunction(() => (window as any).__erreurs.some((e: any) => e.m.includes('[Router]')), null, { timeout: 6000 })
              await page.waitForTimeout(400)
            })
            assert.ok(c.retenues.length > 0, 'scène : le fragment n\'est jamais envoyé')
            assert.ok(jugements(r).length >= 1, lignes(r))
            for (const e of r.erreurs) assert.match(e.m, /\/rien/)
            assert.ok(r.erreurs[0].t - retrait < 4500, `jugé ${Math.round(r.erreurs[0].t - retrait)} ms après le retrait`)
            assert.equal(r.panneau, true, 'la boîte « aucune route » dans la vue de l\'hôte')
            assert.deepEqual(r.exceptions, [])
          })
        }

        it('fragment en route sous `*loader`, adresse sans route : aucune image demandée tant qu\'il est en route, aucun jugement ; à son arrivée, le composant monte et l\'adresse est jugée une fois', async () => {
          const c = await construction(env)
          let demandes = -1
          let avant    = -1
          const r = await ouvrir(c, '/charge?hz=240#/rien', async (page) => {
            await retenu(c, page)
            await page.waitForTimeout(300)
            const n0 = await page.evaluate(() => (window as any).__demandes)
            await page.waitForTimeout(1000)
            demandes = await page.evaluate(() => (window as any).__demandes) - n0
            avant    = await routeur(page)
            for (const envoyer of c.retenues.splice(0)) envoyer()
            await page.waitForFunction(() => (window as any).__erreurs.some((e: any) => e.m.includes('[Router]')), null, { timeout: 5000 })
            await page.waitForTimeout(400)
          })
          assert.equal(demandes, 0, `AVANT : une image demandée à chaque image tant que le fragment est en route (${demandes} en 1 s)`)
          assert.equal(avant, 0, 'jugé pendant que le fragment était en route')
          assert.ok(r.monte > 0, 'scène : le composant monte à l\'arrivée du fragment')
          assert.equal(jugements(r).length, 1, lignes(r))
          for (const e of r.erreurs) assert.match(e.m, /\/rien/)
          assert.ok(r.erreurs[0].t >= r.monte, 'jugé après le montage')
          assert.equal(r.panneau, true, 'la boîte « aucune route » dans la vue')
          assert.deepEqual(r.exceptions, [])
        })

        it('réseau lent, écran à 240 Hz : le fragment arrive après 5,5 s (au-delà de 600 images et de l\'attente des textes, 3 s, plus 2 s), le composant monte et redirige — la bonne route, aucune « aucune route »', async () => {
          const c = await construction(env)
          let image = -1
          const r = await ouvrir(c, '/charge?hz=240', async (page) => {
            await retenu(c, page)
            await page.waitForTimeout(5500)
            image = await page.evaluate(() => (window as any).__image)
            for (const envoyer of c.retenues.splice(0)) envoyer()
            await page.waitForFunction(() => (window as any).__monte > 0, null, { timeout: 5000 })
            await page.waitForTimeout(400)
          })
          assert.ok(image >= 600, `scène : 600 images avant l'arrivée du fragment (${image})`)
          assert.deepEqual(r.erreurs.map((e: any) => e.m), [], 'jugé à tort pendant que le fragment était en route')
          assert.equal(r.hash, '#/x/1')
          assert.equal(r.vue, 'mjs-fiche')
          assert.equal(r.panneau, false)
          assert.deepEqual(r.exceptions, [])
        })

        it('fragment qui ne vient jamais sous `wait`, adresse sans route : le secours monte le composant (3 s), son montage réveille le contrôle, l\'adresse est jugée une fois', async () => {
          const c = await construction(env)
          const r = await ouvrir(c, '/traduit?hz=240#/rien', async (page) => {
            await page.waitForFunction(() => (window as any).__erreurs.some((e: any) => e.m.includes('[Router]')), null, { timeout: 8000 })
            await page.waitForTimeout(400)
          })
          assert.ok(r.monte >= 2500, `montage par le secours (à ${Math.round(r.monte)} ms)`)
          assert.equal(jugements(r).length, 1, lignes(r))
          for (const e of r.erreurs) assert.match(e.m, /\/rien/)
          assert.ok(r.erreurs[0].t >= r.monte, 'jugé après le montage')
          assert.deepEqual(r.exceptions, [])
        })

        it('fragment qui ne vient jamais sous `wait`, écran à 240 Hz : le secours monte le composant après la 600e image, il redirige, aucune erreur', async () => {
          const c = await construction(env)
          const r = await ouvrir(c, '/traduit?hz=240', async (page) => {
            await page.waitForFunction(() => (window as any).__monte > 0, null, { timeout: 8000 })
            await page.waitForTimeout(400)
          })
          assert.ok(r.monteImage >= 600, `scène : 600 images avant le montage (montage à l'image ${r.monteImage})`)
          assert.deepEqual(r.erreurs.map((e: any) => e.m), [], 'jugé à tort avant le montage')
          assert.equal(r.hash, '#/x/1')
          assert.equal(r.vue, 'mjs-fiche')
          assert.equal(r.panneau, false)
          assert.deepEqual(r.exceptions, [])
        })
      })
    }
  }

  after(async function () {
    for (const c of constructions.values()) {
      const k = await c
      k.server.closeAllConnections()
      await new Promise(resolve => k.server.close(() => resolve(null)))
    }
    constructions.clear()
    await terminateSharedWorkerPool()
  })
})
