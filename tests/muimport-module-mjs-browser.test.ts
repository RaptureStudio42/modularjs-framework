// `µimport` d'un module MJS dans un vrai navigateur : le clic charge le module (compilé au build, publié
// dans son fichier à empreinte), l'appel rend son namespace — exports nommés et `default` —, et rien du
// module n'est demandé avant le clic. Le module `@import`é par le composant ET `µimport`é ailleurs reste
// une instance unique (évalué une fois, même objet des deux côtés). Quatre constructions — fichiers
// séparés ou fichier unique, développement ou production — dans Chromium puis Firefox quand il est installé.
import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs'
import { join, dirname, normalize } from 'node:path'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { mjsTmp } from './helpers/tmp.js'

const FICHIERS: Record<string, string> = {
  // chaque évaluation du module compte : une instance unique ⇒ 1
  'partage.module.civet':        "window.__evaluations = (window.__evaluations ?? 0) + 1\nexport marque := 'partage'\nexport compteur := { n: 0 }\n",
  'moteurs/bougie.module.civet': "@import marque 'partage.module.civet'\n@import compteur 'partage.module.civet'\n\nexport dessiner = -> \"flamme #{marque}\"\nexport lire = -> compteur.n\nexport default { nom: 'bougie' }\n",
  'hote.mjs': [
    "@import compteur 'partage.module.civet'",
    '',
    '<script>',
    "  $dessin = 'rien'",
    "  $nom    = 'rien'",
    "  $lu     = 'rien'",
    "  $meme   = 'rien'",
    '',
    '  @compter = -> compteur.n++',
    '',
    '  @charger = ->',
    "    moteur = await µimport('moteurs/bougie.module.civet')",
    '    $dessin = moteur.dessiner()',
    '    $nom    = moteur.default.nom',
    '    $lu     = String(moteur.lire())',
    '',
    '  @comparer = ->',
    "    espace = await µimport('partage.module.civet')",
    '    $meme  = String(espace.compteur is compteur)',
    '</script>',
    '',
    '<button class="compter" @click=@compter>compter</button>',
    '<button class="charger" @click=@charger>charger</button>',
    '<button class="comparer" @click=@comparer>comparer</button>',
    '<p class="d">{$dessin}</p>',
    '<p class="n">{$nom}</p>',
    '<p class="l">{$lu}</p>',
    '<p class="m">{$meme}</p>',
    '',
  ].join('\n'),
}

const MODES = [
  { nom: 'développement, fichiers séparés', js: 'split',  prod: false },
  { nom: 'production, fichiers séparés',    js: 'split',  prod: true },
  { nom: 'développement, fichier unique',   js: 'bundle', prod: false },
  { nom: 'production, fichier unique',      js: 'bundle', prod: true },
] as const

type Mode = typeof MODES[number]

const PAGE = '<!doctype html><html lang="fr"><head><meta charset="utf-8"></head><body><mjs-hote></mjs-hote><script type="module" src="/out/bundle.js"></script></body></html>'

const sites = new Map<string, Promise<string>>()

/** construit le projet dans ce mode, une fois ; rend la racine servie */
function construire(mode: Mode): Promise<string> {
  const cle = `${mode.js}-${mode.prod}`
  if (!sites.has(cle)) sites.set(cle, (async () => {
    const root   = mjsTmp('imm-nav-' + cle)
    const srcDir = join(root, 'src')
    const outDir = join(root, 'out')
    for (const [chemin, contenu] of Object.entries(FICHIERS)) {
      mkdirSync(dirname(join(srcDir, chemin)), { recursive: true })
      writeFileSync(join(srcDir, chemin), contenu)
    }
    const bundler = new Bundler({ sourceDir: srcDir, outputDir: outDir, manifestPath: join(outDir, 'bundle.js'), urlPrefix: '/out', js: mode.js, ...(mode.prod ? { env: 'prod' } : {}) } as any)
    const stats   = await bundler.compile()
    await bundler.close()
    if (stats.errors.length > 0) throw new Error(stats.errors.map((e: any) => e.message).join('\n'))
    return root
  })())
  return sites.get(cle)!
}

interface Ouverture { page: any, demandes: string[], erreurs: string[], fermer: () => Promise<void> }

async function ouvrir(browser: any, root: string): Promise<Ouverture> {
  const ctx      = await browser.newContext()
  const page     = await ctx.newPage()
  const demandes: string[] = []
  const erreurs: string[]  = []
  page.on('pageerror', (e: any) => erreurs.push(String(e.message ?? e).slice(0, 300)))
  page.on('console', (m: any) => { if (m.type() === 'error') erreurs.push(m.text().slice(0, 300)) })
  await page.route('http://imm.test/**', (route: any) => {
    const chemin = decodeURIComponent(new URL(route.request().url()).pathname)
    demandes.push(chemin)
    if (chemin === '/') return route.fulfill({ contentType: 'text/html; charset=utf-8', body: PAGE })
    const fichier = join(root, normalize(chemin))
    if (chemin.startsWith('/out/') && existsSync(fichier)) return route.fulfill({ contentType: chemin.endsWith('.js') ? 'text/javascript; charset=utf-8' : 'application/octet-stream', body: readFileSync(fichier) })
    return route.fulfill({ status: 404, body: '' })
  })
  await page.goto('http://imm.test/', { waitUntil: 'load' })
  await page.waitForFunction("!!document.querySelector('mjs-hote')?._shadow?.querySelector('.charger')", null, { timeout: 20000 })
  return { page, demandes, erreurs, fermer: () => ctx.close() }
}

const texte   = (page: any, classe: string): Promise<string> => page.evaluate(`document.querySelector('mjs-hote')._shadow.querySelector('.${classe}').textContent`)
const cliquer = (page: any, classe: string): Promise<unknown> => page.evaluate(`document.querySelector('mjs-hote')._shadow.querySelector('.${classe}').click()`)
const attendre = (page: any, classe: string, valeur: string): Promise<unknown> => page.waitForFunction(`document.querySelector('mjs-hote')._shadow.querySelector('.${classe}').textContent === ${JSON.stringify(valeur)}`, null, { timeout: 15000 })

for (const moteur of ['chromium', 'firefox'] as const) for (const mode of MODES) describe(`µimport d'un module MJS — ${mode.nom} (${moteur} réel)`, function () {
  this.timeout(180000)
  let browser: any = null
  let present = false

  before(async function () {
    const playwright = await import('playwright')
    present = existsSync(playwright[moteur].executablePath())
    if (!present) { console.log(`  ℹ️  ${moteur} non installé, essais µimport de module sautés. Activer : \`npx playwright install ${moteur}\``); return }
    browser = await playwright[moteur].launch()
  })

  after(async () => {
    if (browser) await browser.close()
    await terminateSharedWorkerPool()
  })

  it('rien du module n\'est demandé avant le clic ; le clic le charge, rend ses exports nommés et son default', async function () {
    if (!present) { this.skip(); return }
    const o = await ouvrir(browser, await construire(mode))
    try {
      assert.deepEqual(o.demandes.filter(d => /bougie/.test(d)), [], 'aucune requête du module avant le clic')
      assert.equal(await o.page.evaluate('window.__evaluations'), 1, 'le module partagé de l\'hôte est évalué une fois au chargement')
      await cliquer(o.page, 'compter')
      await cliquer(o.page, 'compter')
      await cliquer(o.page, 'charger')
      await attendre(o.page, 'd', 'flamme partage')
      assert.equal(await texte(o.page, 'n'), 'bougie', 'l\'export default du module')
      assert.deepEqual(o.erreurs, [])
    }
    finally {
      await o.fermer()
    }
  })

  it('instance unique : le module partagé reste évalué une fois, le compteur lu par le module chargé est celui du composant', async function () {
    if (!present) { this.skip(); return }
    const o = await ouvrir(browser, await construire(mode))
    try {
      await cliquer(o.page, 'compter')
      await cliquer(o.page, 'compter')
      await cliquer(o.page, 'charger')
      await attendre(o.page, 'd', 'flamme partage')
      assert.equal(await texte(o.page, 'l'), '2', 'le module chargé lit les deux incréments du composant : même objet')
      await cliquer(o.page, 'comparer')
      await attendre(o.page, 'm', 'true')
      assert.equal(await o.page.evaluate('window.__evaluations'), 1, 'jamais évalué deux fois')
      assert.deepEqual(o.erreurs, [])
    }
    finally {
      await o.fermer()
    }
  })

  it('le fichier du module est demandé une seule fois, au premier appel ; un second appel ne le redemande pas', async function () {
    if (!present) { this.skip(); return }
    const o = await ouvrir(browser, await construire(mode))
    try {
      await cliquer(o.page, 'charger')
      await attendre(o.page, 'd', 'flamme partage')
      await cliquer(o.page, 'charger')
      await o.page.waitForTimeout(300)
      assert.equal(o.demandes.filter(d => /bougie/.test(d)).length, 1, `une seule requête du module : ${o.demandes.filter(d => /bougie/.test(d)).join(', ')}`)
      assert.deepEqual(o.erreurs, [])
    }
    finally {
      await o.fermer()
    }
  })
})
