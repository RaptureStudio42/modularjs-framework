// Page rendue par le serveur : jusqu'où va la règle « aucun texte ne disparaît », et la page demandée dans une autre langue que la sienne.
//
// 1. Langue demandée différente de celle de la graine (`?lang=en` sur une page rendue en français) : TOUT reste en français (le texte du
//    serveur ne disparaît jamais), puis TOUTE la page passe à l'anglais d'un coup, quand les textes anglais dont elle a besoin sont là. Une
//    image qui montre deux langues à la fois est un défaut : le parent et son enfant, qu'ils lisent la racine ou une section, passent
//    ensemble. Un module que le serveur n'a pas rendu (dans le slot d'un hôte rendu) reste caché jusqu'à ce passage, puis paraît en
//    anglais, jamais en français. Le passage du démarrage ne retouche ni la mémoire de la langue ni l'adresse (`?lang=` reste ce qu'elle
//    est), comme avant lui.
// 2. Un module sous un hôte rendu ne se rend aussitôt que si ses textes sont dans la graine (ses sections y sont). Sinon (section que le
//    serveur n'a pas lue : module du slot, enfant créé plus tard, graine sans cette section), il suit le chemin de son réglage : `wait` le
//    garde caché jusqu'à ses textes, jamais visible et vide.
// 3. La portée : un petit-enfant (deux niveaux sous l'hôte rendu) garde son texte lui aussi ; un descendant d'une racine que le serveur
//    n'a PAS rendue n'est pas un enfant de page rendue (il attend le démarrage comme un module ordinaire).
//
// Le fichier de langue est retardé (700 ms) pour que l'attente se voie ; le texte de chaque sonde est relevé à chaque image
// (`requestAnimationFrame`), depuis la première. Chromium, Firefox et WebKit réels, page prérendue (moteur happy-dom) ou reprise par hydratation.

import assert from 'node:assert/strict'
import { createServer, type Server } from 'node:http'
import { mkdirSync, writeFileSync, readFileSync, existsSync, statSync, readdirSync } from 'node:fs'
import { join, extname, normalize } from 'node:path'
import { mjsTmp } from './helpers/tmp.js'
import { apresLeVide } from './helpers/graine-page.js'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { findConfig, resolveBundlerOpts } from '../src/bundler/config.js'
import { prerenderPages } from '../src/server/prerender.js'
import { emitStartup } from '../src/bundler/startup.js'
import { createBrowserRenderer } from '../src/server/render-browser.js'

type Moteur = 'chromium' | 'firefox' | 'webkit'
const MOTEURS: Moteur[] = ['chromium', 'firefox', 'webkit']

async function lancer(nom: Moteur): Promise<any> {
  try {
    const playwright = await import('playwright')
    if (!existsSync(playwright[nom].executablePath())) return null
    return await playwright[nom].launch()
  }
  catch {
    return null
  }
}

const FR = 'titre: Titre\nautre: Autre texte\nenfant: Enfant\nlanding:\n  haut: Haut\n  bas: Bas\n'
const ENFANT_RACINE  = '<i class="kr">{µt(\'/enfant\')}</i>\n'
const ENFANT_SECTION = '@i18n \'fiche\'\n<i class="ks">{µt(\'nom\')}</i>\n'
const ENFANT_EXTRA   = '@i18n \'extra\'\n<i class="kx">{µt(\'nom\')}</i>\n'
// un module à deux sections : `nom` est dans `fiche`, `autre` seulement dans `extra`
const ENFANT_DEUX    = '@i18n \'fiche\' \'extra\'\n<i class="kd">{µt(\'nom\')} {µt(\'autre\')}</i>\n'

// un projet : racine et fragments français et anglais ; `extra` n'est lue par aucun module de la page rendue
function projet(nomTmp: string, composants: Record<string, string>, i18n: Record<string, unknown>, render: any): { root: string, config: any } {
  const root   = mjsTmp(nomTmp)
  const srcDir = join(root, 'src')
  mkdirSync(join(srcDir, 'i18n', 'fr'), { recursive: true })
  mkdirSync(join(srcDir, 'i18n', 'en'), { recursive: true })
  writeFileSync(join(srcDir, 'i18n', 'fr.yml'), FR)
  writeFileSync(join(srcDir, 'i18n', 'en.json'), JSON.stringify({ titre: 'Title', enfant: 'Child', landing: { haut: 'Top', bas: 'Bottom' } }))
  writeFileSync(join(srcDir, 'i18n', 'fr', 'accueil.yml'), 'salut: Bonjour accueil\n')
  writeFileSync(join(srcDir, 'i18n', 'en', 'accueil.json'), JSON.stringify({ salut: 'Hello home' }))
  writeFileSync(join(srcDir, 'i18n', 'fr', 'fiche.yml'), 'nom: Fiche\n')
  writeFileSync(join(srcDir, 'i18n', 'en', 'fiche.json'), JSON.stringify({ nom: 'Card' }))
  writeFileSync(join(srcDir, 'i18n', 'fr', 'extra.yml'), 'nom: Extra\nautre: Autre extra\n')
  writeFileSync(join(srcDir, 'i18n', 'en', 'extra.json'), JSON.stringify({ nom: 'Extra EN', autre: 'Other extra' }))
  for (const [fichier, source] of Object.entries(composants)) writeFileSync(join(srcDir, fichier + '.mjs'), source)
  const config = { sourceDir: 'src', outputDir: 'out', manifestPath: 'out/bundle.js', urlPrefix: '/out', i18n: { default: 'fr', urlParam: true, ...i18n }, ...render }
  writeFileSync(join(root, 'mjs.config.json'), JSON.stringify(config, null, 2))
  return { root, config }
}

// serveur de la page ; `delais` : [motif du chemin, retard en ms]
function servir(root: string, outDir: string, page: string, delais: [RegExp, number][]): Promise<Server> {
  const server = createServer((req, res) => {
    const chemin = decodeURIComponent((req.url ?? '/').split('?')[0])
    if (chemin === '/') {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
      res.end(page)
      return
    }
    const fichier = join(root, normalize(chemin))
    if (!fichier.startsWith(outDir) || !existsSync(fichier) || !statSync(fichier).isFile()) { res.writeHead(404); res.end(); return }
    const envoyer = () => {
      res.writeHead(200, { 'content-type': extname(fichier) === '.js' ? 'text/javascript; charset=utf-8' : 'application/json' })
      res.end(readFileSync(fichier))
    }
    const retard = delais.find(([motif]) => motif.test(chemin))
    if (retard) setTimeout(envoyer, retard[1])
    else envoyer()
  })
  return new Promise(resolve => server.listen(0, '127.0.0.1', () => resolve(server)))
}

// une sonde : le chemin des hôtes (préfixe `light:` : un enfant du DOM léger de l'hôte précédent), puis le sélecteur du texte
type Sonde = { chemin: string[], sel: string }
interface Releve { vus: string[], etats: string[], erreurs: string[], stockage: string | null, recherche: string }

// relève à chaque image le texte de chaque sonde, réunis par « | » : '-' pour ce qui n'est pas là (ou n'a pas encore de contenu), le
// texte suivi de « [C] » quand un hôte du chemin est caché (`mjs-loading`, `display: none` ou `visibility: hidden`)
async function relever(browser: any, url: string, sondes: Sonde[]): Promise<Releve> {
  const page = await browser.newPage()
  const erreurs: string[] = []
  page.on('pageerror', (e: Error) => erreurs.push(e.message))
  await page.addInitScript((sondes: Sonde[]) => {
    const w = window as any
    w.__vus = []
    w.__etats = []
    const lire = (s: Sonde) => {
      let racine: any = document
      let cache = false
      let hote: any = null
      for (const etape of s.chemin) {
        const lumiere = etape.startsWith('light:')
        const [nom, rang] = (lumiere ? etape.slice(6) : etape).split(':')
        const liste = (lumiere ? hote : racine).querySelectorAll(nom)
        hote = liste[rang ? Number(rang) : 0]
        if (!hote) return '-'
        if (hote.hasAttribute('mjs-loading') || getComputedStyle(hote).display === 'none' || getComputedStyle(hote).visibility === 'hidden') cache = true
        racine = hote._shadow || hote.shadowRoot || hote
      }
      const noeud = racine.querySelector(s.sel)
      return noeud ? noeud.textContent.trim() + (cache ? ' [C]' : '') : '-'
    }
    const t0 = performance.now()
    const tick = () => {
      const v = sondes.map(lire).join(' | ')
      if (w.__vus.length === 0 || w.__vus[w.__vus.length - 1] !== v) {
        w.__vus.push(v)
        w.__etats.push(Math.round(performance.now() - t0) + 'ms ' + v)
      }
      requestAnimationFrame(tick)
    }
    requestAnimationFrame(tick)
  }, sondes)
  try {
    await page.goto(url, { waitUntil: 'load' })
    await page.waitForFunction(() => !!customElements.get('mjs-home'), null, { timeout: 15000 })
    await page.waitForTimeout(2400)
    const vus: string[] = await page.evaluate(() => (window as any).__vus)
    const etats: string[] = await page.evaluate(() => (window as any).__etats)
    const stockage: string | null = await page.evaluate(() => { try { return localStorage.getItem('__mjsLang') } catch { return 'illisible' } })
    const recherche: string = await page.evaluate(() => location.search)
    return { vus, etats, erreurs, stockage, recherche }
  }
  finally { await page.close() }
}

interface Options {
  html?: (page: string) => string
  apres?: string
  delais?: [RegExp, number][]
  delaisEn?: Record<string, number>
  hydrate?: boolean
  i18n?: Record<string, unknown>
}

const LANGUE = /\/mjs_i18n-[^/]*\.js$/

// la page rendue d'un projet (bundle, prérendu, démarrage) servie avec le fichier de langue en retard
async function pagePrerendue(nomTmp: string, composants: Record<string, string>, opts: Options): Promise<{ server: Server, base: string }> {
  if (opts.hydrate) return pageHydratee(nomTmp, composants, opts)
  const { root } = projet(nomTmp, composants, opts.i18n ?? {}, { render: { default: 'prerender', engine: { prerender: 'happy-dom' }, startup: 'bundle', routes: { '/': { component: 'mjs-home' } } } })
  const found = findConfig(root)!
  const bundler = new Bundler({ ...resolveBundlerOpts(found.config, found.configDir), env: 'prod' } as any)
  const stats = await bundler.compile()
  assert.equal(stats.errors.length, 0, stats.errors.map((e: any) => e.message).join('\n'))
  const report = await prerenderPages(found.config, found.configDir, () => {}, { env: 'prod' })
  await emitStartup(bundler, found.config.render, report, { prod: true, log: () => {} })
  await bundler.close()
  const corps = readFileSync(report.generated.find(g => g.url === '/')!.file, 'utf-8')
  const delais: [RegExp, number][] = [...(opts.delais ?? [[LANGUE, 700]])]
  if (opts.delaisEn) {
    // le nom compact de chaque fragment anglais est dans le fichier de langue anglais
    const fichier = readdirSync(join(root, 'out')).find(n => /^mjs_i18n-en-.*\.js$/.test(n))!
    const donnees = JSON.parse(readFileSync(join(root, 'out', fichier), 'utf-8').replace(/^export default /, '').replace(/;\s*$/, ''))
    for (const [section, ms] of Object.entries(opts.delaisEn)) delais.push([new RegExp('/i18n/en/' + donnees.sections[section] + '\\.json$'), ms])
  }
  let page = `<!doctype html><html><head><meta charset="utf-8"><script type="module" src="/out/bundle.js"></script></head><body>${corps}${opts.apres ?? ''}</body></html>`
  if (opts.html) page = opts.html(page)
  const server = await servir(root, join(root, 'out'), page, delais)
  return { server, base: `http://127.0.0.1:${(server.address() as any).port}` }
}

// la page reprise par hydratation : le HTML vient du moteur navigateur, le client ne porte que la reprise et les traductions ; le code tient en un
// seul fichier (`js: 'bundle'`) : avec un fichier par composant, la balise d'un petit-enfant n'est définie qu'après le chargement du sien, et les
// images où elle est vide ne parlent plus des traductions
async function pageHydratee(nomTmp: string, composants: Record<string, string>, opts: Options): Promise<{ server: Server, base: string }> {
  const { root, config } = projet(nomTmp, composants, { placeholder: 'wait', ...(opts.i18n ?? {}) }, {})
  const renderer = await createBrowserRenderer(config, { configDir: root })
  const client = new Bundler({ ...resolveBundlerOpts({ ...config, outputDir: 'client', manifestPath: 'client/bundle.js', urlPrefix: '/client', runtime: ['hydrate', 'i18n'], js: 'bundle' }, root), env: 'prod' } as any)
  const stats = await client.compile()
  await client.close()
  assert.equal(stats.errors.length, 0, stats.errors.map((e: any) => e.message).join('\n'))
  const res = await renderer.renderPage('mjs-home', { settleMs: 5000, ssrMode: 'markers' })
  await renderer.close()
  let html = `<!doctype html><html><head><meta charset="utf-8"><script type="module" src="/client/bundle.js"></script></head><body>${res.hydrateScript}${res.sharedScript}${res.html}</body></html>`
  if (opts.html) html = opts.html(html)
  const server = await servir(root, join(root, 'client'), html, opts.delais ?? [[LANGUE, 700]])
  return { server, base: `http://127.0.0.1:${(server.address() as any).port}` }
}

// ---- les pages ----

const HOME_MID = '@i18n \'accueil\'\n<h1 class="t">{µt(\'salut\')}</h1>\n<mjs-mid></mjs-mid>\n'
const MID      = '<b class="m">m</b>\n<mjs-leaf></mjs-leaf>\n'
const LEAF     = '@i18n \'fiche\'\n<i class="l">{µt(\'nom\')} {µt(\'/enfant\')}</i>\n'

// l'enfant arrive après `ms` (avant le démarrage s'il est court) ; `lit` : le parent lit la section de l'enfant, qui entre dans la graine
const enfantTardif = (ms: number, lit: boolean) => '@i18n \'accueil\'\n<script>\n  $late = false\n  setTimeout((-> $late = true), ' + ms + ') unless µserver\n</script>\n<h1 class="t">{µt(\'salut\')}' + (lit ? ' {µt(\'/fiche.nom\')}' : '') + '</h1>\n{if $late}<mjs-kid-section></mjs-kid-section>{end}\n'

// l'hôte rendu, un enfant de section, et un module sans `@i18n` que le serveur ne rend pas (jamais créé : `$jamais`) : `fiche` est lue par le serveur, pas `extra`
const HOME_EXTRA = '@i18n \'accueil\'\n<script>\n  $jamais = false\n</script>\n<h1 class="t">{µt(\'salut\')}</h1>\n<mjs-kid-section></mjs-kid-section>\n{if $jamais}<mjs-extra></mjs-extra>{end}\n'
const EXTRA      = '<b class="x">x</b>\n<mjs-kid-section></mjs-kid-section>\n'

// un hôte rendu avec un slot : un module client seul, que le serveur ne rend pas, y est posé à la main
const HOME_SLOT = '@i18n \'accueil\'\n<script>\n  $jamais = false\n</script>\n<h1 class="t">{µt(\'salut\')}</h1>\n<slot></slot>\n{if $jamais}<mjs-extra></mjs-extra>{end}\n'

const HOME_ENFANT_SECTION = '@i18n \'accueil\'\n<h1 class="t">{µt(\'salut\')}</h1>\n<mjs-kid-section></mjs-kid-section>\n'
const HOME_ENFANT_DEUX    = '@i18n \'accueil\'\n<h1 class="t">{µt(\'salut\')}</h1>\n<mjs-kid-deux></mjs-kid-deux>\n'

// la page dont la graine n'a pas une section (le serveur ne l'aurait pas lue)
const graineSans = (section: string) => (page: string) => page.replace(/(<script[^>]*id="__mjs_i18n"[^>]*>)([\s\S]*?)(<\/script>)/, (_m, ouvrante: string, json: string, fermante: string) => {
  const graine = JSON.parse(json)
  delete graine.sections.fr[section]
  return ouvrante + JSON.stringify(graine) + fermante
})

// ---- les verdicts ----

// les images d'avant la page (le HTML pas encore analysé : tout se lit '-') ne comptent pas, comme dans helpers/graine-page.ts ; une machine
// chargée en montre une sous Firefox

// aucune image ne diffère de l'état final
const jamaisVide = (final: string) => (r: Releve) => {
  assert.equal(r.vus[r.vus.length - 1], final, 'état final : ' + r.etats.join(' /// '))
  assert.deepEqual(apresLeVide(r.vus).filter(v => v !== final), [], 'jamais de trou ni de caché : ' + r.etats.join(' /// '))
}

// chaque image est dans l'un des états permis, la dernière est la finale
const parmi = (permis: string[], final: string) => (r: Releve) => {
  assert.equal(r.vus[r.vus.length - 1], final, 'état final : ' + r.etats.join(' /// '))
  assert.deepEqual(apresLeVide(r.vus).filter(v => !permis.includes(v)), [], 'états hors de ' + JSON.stringify(permis) + ' : ' + r.etats.join(' /// '))
}

// aucun morceau visible et vide (un morceau absent se lit '-', un module caché « … [C] » — son gabarit vide existe, mais il est caché)
const jamaisVisibleEtVide = (final: string) => (r: Releve) => {
  assert.equal(r.vus[r.vus.length - 1], final, 'état final : ' + r.etats.join(' /// '))
  assert.deepEqual(r.vus.filter(v => v.split(' | ').some(morceau => morceau === '')), [], 'visible et vide : ' + r.etats.join(' /// '))
}

const FR_X1 = 'Bonjour accueil | Fiche'
const EN_X1 = 'Hello home | Card'
const FR_L4 = 'Bonjour accueil / Titre / Haut | Enfant | Fiche'
const EN_L4 = 'Hello home / Title / Top | Child | Card'

interface Cas {
  nom: string
  composants: Record<string, string>
  sondes: Sonde[]
  url?: string
  moteurs?: Moteur[]
  options?: Options
  juge: (r: Releve) => void
}

const CAS: Cas[] = [
  // ---- 1. une langue demandée autre que celle de la graine ----
  {
    nom: '?lang=en : la page (accueil + fiche) et son enfant (fiche), fragments anglais à 300 et 450 ms — jamais deux langues dans une image',
    composants: { home: '@i18n \'accueil\' \'fiche\'\n<h1 class="t">{µt(\'salut\')}</h1>\n<mjs-kid-section></mjs-kid-section>\n', 'kid-section': ENFANT_SECTION },
    sondes: [{ chemin: ['mjs-home'], sel: 'h1.t' }, { chemin: ['mjs-home', 'mjs-kid-section'], sel: 'i.ks' }],
    url: '/?lang=en',
    moteurs: MOTEURS,
    options: { delaisEn: { accueil: 300, fiche: 450 } },
    juge: parmi([FR_X1, EN_X1], EN_X1)
  },
  {
    nom: '?lang=en : parent (section et deux clés racine), enfant racine et enfant de section, fragments anglais à 400 ms — tout passe ensemble',
    composants: { home: '@i18n \'accueil\'\n<h1 class="t">{µt(\'salut\')} / {µt(\'/titre\')} / {µt(\'/landing.haut\')}</h1>\n<mjs-kid-racine></mjs-kid-racine>\n<mjs-kid-section></mjs-kid-section>\n', 'kid-racine': ENFANT_RACINE, 'kid-section': ENFANT_SECTION },
    sondes: [{ chemin: ['mjs-home'], sel: 'h1.t' }, { chemin: ['mjs-home', 'mjs-kid-racine'], sel: 'i.kr' }, { chemin: ['mjs-home', 'mjs-kid-section'], sel: 'i.ks' }],
    url: '/?lang=en',
    moteurs: MOTEURS,
    options: { delais: [[LANGUE, 700], [/\/i18n\/en\/[^/]*\.json$/, 400]] },
    juge: parmi([FR_L4, EN_L4], EN_L4)
  },
  {
    nom: '?lang=en : petit-enfant (deux niveaux) et sa page passent ensemble, du français de la graine à l\'anglais',
    composants: { home: HOME_MID, mid: MID, leaf: LEAF },
    sondes: [{ chemin: ['mjs-home'], sel: 'h1.t' }, { chemin: ['mjs-home', 'mjs-mid', 'mjs-leaf'], sel: 'i.l' }],
    url: '/?lang=en',
    options: { delaisEn: { accueil: 300, fiche: 450 } },
    juge: parmi(['Bonjour accueil | Fiche Enfant', 'Hello home | Card Child'], 'Hello home | Card Child')
  },
  {
    nom: '?lang=en : un module du slot que le serveur n\'a pas rendu reste caché jusqu\'au passage, puis paraît en anglais — jamais en français',
    composants: { home: HOME_SLOT, extra: ENFANT_EXTRA },
    sondes: [{ chemin: ['mjs-home'], sel: 'h1.t' }, { chemin: ['mjs-home', 'light:mjs-extra'], sel: 'i.kx' }],
    url: '/?lang=en',
    moteurs: MOTEURS,
    options: { html: page => page.replace('</mjs-home>', '<mjs-extra></mjs-extra></mjs-home>'), delaisEn: { extra: 300 } },
    juge: parmi(['Bonjour accueil | -', 'Bonjour accueil |  [C]', 'Hello home |  [C]', 'Hello home | Extra EN'], 'Hello home | Extra EN')
  },
  {
    nom: '?lang=en : un enfant créé pendant l\'attente des textes anglais se rend dans la langue de la page, puis passe avec elle',
    composants: { home: enfantTardif(900, false), 'kid-section': ENFANT_SECTION },
    sondes: [{ chemin: ['mjs-home'], sel: 'h1.t' }, { chemin: ['mjs-home', 'mjs-kid-section'], sel: 'i.ks' }],
    url: '/?lang=en',
    options: { delaisEn: { accueil: 700 } },
    juge: parmi(['Bonjour accueil | -', 'Bonjour accueil |  [C]', 'Bonjour accueil | Fiche', 'Hello home | Card'], 'Hello home | Card')
  },
  {
    nom: '?lang=en avec la mémoire et l\'adresse : le passage du démarrage n\'écrit ni la mémoire de la langue ni l\'adresse',
    composants: { home: HOME_ENFANT_SECTION, 'kid-section': ENFANT_SECTION },
    sondes: [{ chemin: ['mjs-home'], sel: 'h1.t' }, { chemin: ['mjs-home', 'mjs-kid-section'], sel: 'i.ks' }],
    url: '/?lang=en',
    moteurs: MOTEURS,
    options: { i18n: { persist: true } },
    juge: (r) => {
      parmi([FR_X1, EN_X1], EN_X1)(r)
      assert.equal(r.stockage, null, 'la langue du démarrage n\'est pas mémorisée')
      assert.equal(r.recherche, '?lang=en', 'l\'adresse reste celle de la page')
    }
  },
  // ---- 2. un module dont les textes ne sont pas dans la graine ----
  {
    nom: 'module client seul dans le slot d\'un hôte rendu, section hors graine : caché jusqu\'à ses textes, jamais visible et vide',
    composants: { home: HOME_SLOT, extra: ENFANT_EXTRA },
    sondes: [{ chemin: ['mjs-home'], sel: 'h1.t' }, { chemin: ['mjs-home', 'light:mjs-extra'], sel: 'i.kx' }],
    moteurs: MOTEURS,
    options: { html: page => page.replace('</mjs-home>', '<mjs-extra></mjs-extra></mjs-home>') },
    juge: parmi(['Bonjour accueil | -', 'Bonjour accueil |  [C]', 'Bonjour accueil | Extra'], 'Bonjour accueil | Extra')
  },
  {
    nom: 'enfant créé après 250 ms (avant le démarrage) dont la section n\'est pas dans la graine : caché jusqu\'à ses textes, jamais visible et vide',
    composants: { home: enfantTardif(250, false), 'kid-section': ENFANT_SECTION },
    sondes: [{ chemin: ['mjs-home'], sel: 'h1.t' }, { chemin: ['mjs-home', 'mjs-kid-section'], sel: 'i.ks' }],
    moteurs: MOTEURS,
    juge: parmi(['Bonjour accueil | -', 'Bonjour accueil |  [C]', 'Bonjour accueil | Fiche'], 'Bonjour accueil | Fiche')
  },
  {
    nom: 'enfant d\'un hôte rendu dont la graine n\'a pas la section : recréé, il suit le chemin de son réglage — jamais visible et vide',
    composants: { home: HOME_ENFANT_SECTION, 'kid-section': ENFANT_SECTION },
    sondes: [{ chemin: ['mjs-home'], sel: 'h1.t' }, { chemin: ['mjs-home', 'mjs-kid-section'], sel: 'i.ks' }],
    options: { html: graineSans('fiche') },
    juge: jamaisVisibleEtVide('Bonjour accueil | Fiche')
  },
  {
    nom: 'module à deux sections dont la seconde manque à la graine : caché jusqu\'à ses textes, jamais à moitié rendu',
    composants: { home: HOME_ENFANT_DEUX, 'kid-deux': ENFANT_DEUX },
    sondes: [{ chemin: ['mjs-home'], sel: 'h1.t' }, { chemin: ['mjs-home', 'mjs-kid-deux'], sel: 'i.kd' }],
    moteurs: MOTEURS,
    options: { html: graineSans('extra') },
    juge: parmi(['Bonjour accueil | Fiche Autre extra', 'Bonjour accueil | -', 'Bonjour accueil |  [C]'], 'Bonjour accueil | Fiche Autre extra')
  },
  {
    nom: 'enfant créé après 250 ms dont la section EST dans la graine (le parent la lit) : rendu aussitôt, jamais caché ni vide',
    composants: { home: enfantTardif(250, true), 'kid-section': ENFANT_SECTION },
    sondes: [{ chemin: ['mjs-home'], sel: 'h1.t' }, { chemin: ['mjs-home', 'mjs-kid-section'], sel: 'i.ks' }],
    moteurs: MOTEURS,
    juge: parmi(['Bonjour accueil Fiche | -', 'Bonjour accueil Fiche | Fiche'], 'Bonjour accueil Fiche | Fiche')
  },
  // ---- 3. la portée ----
  {
    nom: 'petit-enfant (home > mid > leaf) : son texte ne disparaît pas, à aucune image',
    composants: { home: HOME_MID, mid: MID, leaf: LEAF },
    sondes: [{ chemin: ['mjs-home'], sel: 'h1.t' }, { chemin: ['mjs-home', 'mjs-mid', 'mjs-leaf'], sel: 'i.l' }],
    moteurs: MOTEURS,
    juge: r => jamaisVide('Bonjour accueil | Fiche Enfant')(r)
  },
  {
    nom: 'page reprise par hydratation : le petit-enfant garde son texte lui aussi',
    composants: { home: HOME_MID, mid: MID, leaf: LEAF },
    sondes: [{ chemin: ['mjs-home'], sel: 'h1.t' }, { chemin: ['mjs-home', 'mjs-mid', 'mjs-leaf'], sel: 'i.l' }],
    moteurs: MOTEURS,
    options: { hydrate: true },
    juge: r => jamaisVide('Bonjour accueil | Fiche Enfant')(r)
  },
  {
    nom: 'descendant d\'une racine que le serveur n\'a pas rendue : il attend le démarrage comme un module ordinaire (pas aussitôt)',
    composants: { home: HOME_EXTRA, 'kid-section': ENFANT_SECTION, extra: EXTRA },
    sondes: [{ chemin: ['mjs-home'], sel: 'h1.t' }, { chemin: ['mjs-extra', 'mjs-kid-section'], sel: 'i.ks' }],
    moteurs: MOTEURS,
    options: { apres: '<mjs-extra></mjs-extra>' },
    juge: (r) => {
      jamaisVisibleEtVide('Bonjour accueil | Fiche')(r)
      // le fichier de langue arrive à 700 ms : avant lui, le module est caché, il ne se rend pas aussitôt avec la graine
      const premier = r.etats.find(e => e.endsWith('| Fiche') && !e.endsWith('[C]'))
      assert.ok(premier, 'le module paraît : ' + r.etats.join(' /// '))
      assert.ok(parseInt(premier!, 10) >= 500, 'il paraît après l\'arrivée du fichier de langue, pas dès le départ : ' + r.etats.join(' /// '))
    }
  }
]

describe('graine : jusqu\'où va la règle « aucun texte ne disparaît », et la page demandée dans une autre langue que la sienne (Chromium, Firefox, WebKit)', function () {
  this.timeout(300000)
  const navigateurs: Partial<Record<Moteur, any>> = {}

  before(async function () {
    for (const m of MOTEURS) navigateurs[m] = await lancer(m)
    if (!navigateurs.chromium) { console.log('  ℹ️  Chromium non installé : test sauté'); this.skip() }
  })

  after(async function () {
    for (const m of MOTEURS) if (navigateurs[m]) await navigateurs[m].close()
    await terminateSharedWorkerPool()
  })

  CAS.forEach((cas, rang) => {
    describe(cas.nom, function () {
      let server: Server | null = null
      let base = ''

      before(async function () {
        ({ server, base } = await pagePrerendue('i18n-graine-portee-' + rang, cas.composants, cas.options ?? {}))
      })

      after(async function () {
        if (server) await new Promise(resolve => server!.close(() => resolve(null)))
      })

      for (const m of cas.moteurs ?? ['chromium'] as Moteur[]) {
        it(m, async function () {
          if (!navigateurs[m]) { console.log(`  ℹ️  ${m} non installé : test sauté`); this.skip() }
          const releve = await relever(navigateurs[m], base + (cas.url ?? '/'), cas.sondes)
          assert.deepEqual(releve.erreurs, [], `erreurs : ${releve.erreurs.join(' | ')}`)
          cas.juge(releve)
        })
      }
    })
  })
})
