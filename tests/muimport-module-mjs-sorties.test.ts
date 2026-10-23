// Ce que ce test garantit : le fichier unique coupé en morceaux (`js: 'bundle'` avec un module chargé à la demande) ne retire
// QUE des fichiers que le build a lui-même consignés au registre `.mjs-outputs.json`, jamais d'après la forme d'un nom : un
// fichier d'auteur nommé comme un morceau (`chunk-deadbeef.js`) survit à toutes les constructions, que le manifeste soit dans
// le dossier de sortie ou ailleurs, en API comme en `mjs build`. Un module retiré ou renommé voit ses fichiers consignés
// partir à la purge de `mjs build`, d'un processus à l'autre (`"prune": false` les garde). Les noms des morceaux ne dépendent
// que de leur contenu : une édition sans rapport ne les renomme pas, et le pied `//# mjsVersion=` ne va que sur l'entrée.
// Un module que seuls des modules chargés à la demande atteignent part avec eux : ni téléchargé ni évalué avant l'appel.
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdirSync, writeFileSync, readFileSync, readdirSync, existsSync } from 'node:fs'
import { join, dirname, normalize } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { readBuildVersion } from '../src/server/build-version.js'
import { mjsTmp } from './helpers/tmp.js'

const PARTAGE = "window.__evaluations = (window.__evaluations ?? 0) + 1\nexport marque := 'partage'\nexport compteur := { n: 0 }\n"
const BOUGIE  = "@import marque 'partage.module.civet'\n@import compteur 'partage.module.civet'\n\nexport dessiner = -> \"flamme #{marque}\"\nexport lire = -> compteur.n\nexport default { nom: 'bougie' }\n"
const HOTE    = ["@import compteur 'partage.module.civet'", '', '<script>', '  $dessin = \'rien\'', '  @charger = ->', "    moteur = await µimport('moteurs/bougie.module.civet')", '    $dessin = moteur.dessiner()', '  @compter = -> compteur.n++', '</script>', '', '<button class="charger" @click=@charger>charger</button>', '<p class="d">{$dessin}</p>', ''].join('\n')
const HOTE_SANS = ["@import compteur 'partage.module.civet'", '', '<script>', '  @compter = -> compteur.n++', '</script>', '', '<button class="compter" @click=@compter>compter</button>', ''].join('\n')

const FICHIERS: Record<string, string> = { 'hote.mjs': HOTE, 'moteurs/bougie.module.civet': BOUGIE, 'partage.module.civet': PARTAGE }

// ce qu'un auteur peut poser à côté du manifeste, sous des noms qui ressemblent à ceux des morceaux
const ETRANGERS: Record<string, string> = {
  'chunk-deadbeef.js':     '// auteur : un morceau d\'un autre outil\n',
  'chunk-deadbeef.js.map': '{}',
  'bougie-cafebabe.js':    '// auteur : une copie\n',
  'bundle-12345678.js':    '// auteur : un autre fichier de base\n',
  'vendor-0a1b2c3d.js':    '// auteur : une bibliothèque\n',
}

interface Projet { root: string, srcDir: string, outDir: string, manifest: string, dossier: string }

/** `hors` : le manifeste est dans `public/`, le dossier de sortie dans `public/assets/` (le manifeste hors du dossier de sortie) */
function projet(prefixe: string, fichiers: Record<string, string>, hors = false): Projet {
  const root   = mjsTmp(prefixe)
  const srcDir = join(root, 'src')
  for (const [chemin, contenu] of Object.entries(fichiers)) {
    mkdirSync(dirname(join(srcDir, chemin)), { recursive: true })
    writeFileSync(join(srcDir, chemin), contenu)
  }
  const outDir   = join(root, hors ? 'public/assets' : 'out')
  const manifest = hors ? join(root, 'public', 'app.js') : join(outDir, 'bundle.js')
  return { root, srcDir, outDir, manifest, dossier: dirname(manifest) }
}

const ecrire = (p: Projet, chemin: string, contenu: string): void => {
  mkdirSync(dirname(join(p.srcDir, chemin)), { recursive: true })
  writeFileSync(join(p.srcDir, chemin), contenu)
}

const neuf = (p: Projet, opts: Record<string, unknown> = {}): Bundler => new Bundler({ sourceDir: p.srcDir, outputDir: p.outDir, manifestPath: p.manifest, urlPrefix: '/out', js: 'bundle', ...opts } as any)

async function construire(p: Projet, opts: Record<string, unknown> = {}, purger = false): Promise<{ errors: string[], purge: { removed: string[], failed: string[], skipped?: string } | null }> {
  const bundler = neuf(p, opts)
  try {
    const stats = await bundler.compile()
    return { errors: stats.errors.map((e: any) => e.message), purge: purger ? bundler.pruneOrphans() : null }
  }
  finally {
    await bundler.close()
  }
}

const poserEtrangers = (p: Projet): void => { for (const [nom, contenu] of Object.entries(ETRANGERS)) writeFileSync(join(p.dossier, nom), contenu) }

function etrangersManquants(p: Projet): string[] {
  return Object.entries(ETRANGERS).filter(([nom, contenu]) => !existsSync(join(p.dossier, nom)) || readFileSync(join(p.dossier, nom), 'utf8') !== contenu).map(([nom]) => nom)
}

/** les fichiers du build à côté du manifeste : le morceau partagé et le module chargé à la demande (cartes comprises) */
const morceaux = (p: Projet, base = '(?:bougie|flamme|chunk)'): string[] => readdirSync(p.dossier).filter(f => new RegExp(`^${base}-[a-f0-9]{8}\\.js(?:\\.map)?$`).test(f)).sort()

const racine = join(dirname(fileURLToPath(import.meta.url)), '..')

function mjsBuild(root: string): { status: number | null, sortie: string } {
  const r = spawnSync('npx', ['tsx', 'src/cli.ts', 'build', '--root', root], { cwd: racine, encoding: 'utf-8' })
  return { status: r.status, sortie: `${r.stdout}\n${r.stderr}` }
}

/** le projet d'un `mjs build` : même disposition que `projet(…, hors)`, config écrite pour la CLI */
function projetCli(prefixe: string, hors: boolean, fichiers: Record<string, string>, extra: Record<string, unknown> = {}): Projet {
  const p = projet(prefixe, fichiers, hors)
  const config = { sourceDir: 'src', outputDir: hors ? 'public/assets' : 'dist', manifestPath: hors ? 'public/app.js' : 'dist/bundle.js', urlPrefix: hors ? '/assets' : '/dist', js: 'bundle', runtime: 'core', ...extra }
  writeFileSync(join(p.root, 'mjs.config.json'), JSON.stringify(config, null, 2))
  return { ...p, outDir: join(p.root, config.outputDir), manifest: join(p.root, config.manifestPath), dossier: dirname(join(p.root, config.manifestPath)) }
}

describe('fichier unique coupé — un fichier d\'auteur n\'est jamais retiré', function () {
  this.timeout(120000)

  after(async () => {
    await terminateSharedWorkerPool()
  })

  for (const hors of [false, true]) it(`manifeste ${hors ? 'hors du' : 'dans le'} dossier de sortie : un fichier d'auteur nommé comme un morceau survit à deux constructions neuves, puis à deux tours d'une même instance`, async () => {
    const p = projet('sort-etrangers-' + hors, FICHIERS, hors)
    assert.deepEqual((await construire(p)).errors, [])
    const construits = morceaux(p)
    assert.ok(construits.length >= 2, `le build a écrit le module et le morceau partagé : ${readdirSync(p.dossier).join(', ')}`)
    poserEtrangers(p)
    assert.deepEqual((await construire(p)).errors, [])
    assert.deepEqual(etrangersManquants(p), [], 'deuxième construction (instance neuve) : rien d\'auteur ne disparaît')
    const bundler = neuf(p)
    try {
      for (let tour = 0; tour < 2; tour++) assert.deepEqual((await bundler.compile()).errors, [])
      writeFileSync(join(p.srcDir, 'hote.mjs'), HOTE + '<!-- tour de plus -->\n')
      assert.deepEqual((await bundler.compile()).errors, [])
    }
    finally {
      await bundler.close()
    }
    assert.deepEqual(etrangersManquants(p), [], 'trois tours d\'une même instance : rien d\'auteur ne disparaît')
  })

  it('le registre consigne les fichiers écrits à côté du manifeste, dans le dossier de sortie comme hors de lui', async () => {
    for (const hors of [false, true]) {
      const p = projet('sort-registre-' + hors, FICHIERS, hors)
      assert.deepEqual((await construire(p)).errors, [])
      const registre = readFileSync(join(p.dossier, '.mjs-outputs.json'), 'utf8')
      const ecrits   = morceaux(p).filter(f => !f.endsWith('.map'))
      assert.ok(ecrits.length >= 2, `morceaux écrits : ${ecrits.join(', ')}`)
      for (const f of ecrits) assert.ok(registre.includes(f), `le registre cite ${f} (manifeste ${hors ? 'hors' : 'dans'} le dossier de sortie) :\n${registre}`)
    }
  })

  for (const hors of [false, true]) it(`mjs build deux fois, manifeste ${hors ? 'hors du' : 'dans le'} dossier de sortie : le fichier d'auteur survit, y compris à la purge`, function () {
    this.timeout(240000)
    const p = projetCli('sort-cli-etrangers-' + hors, hors, FICHIERS)
    const premier = mjsBuild(p.root)
    assert.equal(premier.status, 0, `build 1 :\n${premier.sortie}`)
    poserEtrangers(p)
    const second = mjsBuild(p.root)
    assert.equal(second.status, 0, `build 2 :\n${second.sortie}`)
    assert.deepEqual(etrangersManquants(p), [], `fichiers d'auteur disparus après mjs build :\n${second.sortie}`)
  })
})

describe('fichier unique coupé — orphelins d\'un processus à l\'autre', function () {
  this.timeout(120000)

  after(async () => {
    await terminateSharedWorkerPool()
  })

  for (const hors of [false, true]) it(`manifeste ${hors ? 'hors du' : 'dans le'} dossier de sortie, µimport retiré : la purge d'un processus neuf retire les fichiers consignés, jamais ceux d'un auteur`, async () => {
    const p = projet('sort-orphelins-retrait-' + hors, FICHIERS, hors)
    assert.deepEqual((await construire(p)).errors, [])
    const consignes = morceaux(p)
    assert.ok(consignes.length >= 2, `fichiers du build : ${consignes.join(', ')}`)
    poserEtrangers(p)
    ecrire(p, 'hote.mjs', HOTE_SANS)
    const { errors, purge } = await construire(p, {}, true)
    assert.deepEqual(errors, [])
    assert.equal(purge?.skipped, undefined, `la purge tourne : ${JSON.stringify(purge)}`)
    assert.deepEqual(purge?.failed, [])
    const restants = readdirSync(p.dossier)
    for (const f of consignes) assert.equal(restants.includes(f), false, `${f} (consigné par le build) est parti : ${restants.join(', ')}`)
    assert.deepEqual(etrangersManquants(p), [], 'et rien d\'auteur ne part avec eux')
    assert.ok(existsSync(p.manifest), 'le manifeste reste')
  })

  for (const hors of [false, true]) it(`manifeste ${hors ? 'hors du' : 'dans le'} dossier de sortie, module renommé : les fichiers de l'ancien nom partent, ceux du nouveau restent`, async () => {
    const p = projet('sort-orphelins-renom-' + hors, FICHIERS, hors)
    assert.deepEqual((await construire(p)).errors, [])
    const avant = morceaux(p)
    poserEtrangers(p)
    ecrire(p, 'hote.mjs', HOTE.replace('moteurs/bougie.module.civet', 'moteurs/flamme.module.civet'))
    ecrire(p, 'moteurs/flamme.module.civet', BOUGIE)
    const { errors, purge } = await construire(p, {}, true)
    assert.deepEqual(errors, [])
    assert.equal(purge?.skipped, undefined, `la purge tourne : ${JSON.stringify(purge)}`)
    const restants = readdirSync(p.dossier)
    for (const f of avant.filter(n => /^bougie-/.test(n))) assert.equal(restants.includes(f), false, `${f} (ancien nom) est parti : ${restants.join(', ')}`)
    assert.ok(restants.some(f => /^flamme-[a-f0-9]{8}\.js$/.test(f)), `le nouveau module est là : ${restants.join(', ')}`)
    for (const f of avant.filter(n => /^chunk-/.test(n))) assert.ok(restants.includes(f), `${f} (le code partagé, même contenu donc même nom) reste : ${restants.join(', ')}`)
    assert.deepEqual(etrangersManquants(p), [])
  })

  it('code partagé modifié entre deux processus : les anciens fichiers de même base sont remplacés sans attendre la purge, ceux d\'un auteur restent', async () => {
    const p = projet('sort-remplace', FICHIERS)
    assert.deepEqual((await construire(p)).errors, [])
    const avant = morceaux(p)
    assert.ok(avant.length >= 2)
    poserEtrangers(p)
    ecrire(p, 'partage.module.civet', PARTAGE + "export modifie := 'modifie'\n")
    assert.deepEqual((await construire(p)).errors, [])
    const apres = readdirSync(p.dossier)
    for (const f of avant) assert.equal(apres.includes(f), false, `${f} (ancienne version) est remplacé : ${apres.join(', ')}`)
    assert.equal(morceaux(p).filter(f => f.endsWith('.js') && !(f in ETRANGERS)).length >= 2, true, `les nouvelles versions sont là : ${apres.join(', ')}`)
    assert.deepEqual(etrangersManquants(p), [])
  })

  it('un fichier que le build n\'a jamais écrit reste, même sous la forme exacte d\'un morceau et même quand la purge tourne', async () => {
    const p = projet('sort-orphelins-jamais-ecrit', FICHIERS)
    assert.deepEqual((await construire(p)).errors, [])
    poserEtrangers(p)
    ecrire(p, 'hote.mjs', HOTE_SANS)
    const { purge } = await construire(p, {}, true)
    assert.equal(purge?.skipped, undefined)
    assert.deepEqual(purge?.removed.filter(f => f in ETRANGERS), [])
    assert.deepEqual(etrangersManquants(p), [])
  })

  for (const hors of [false, true]) it(`mjs build deux fois (µimport retiré entre les deux), manifeste ${hors ? 'hors du' : 'dans le'} dossier de sortie : les fichiers du module partent, ceux d'un auteur restent`, function () {
    this.timeout(240000)
    const p = projetCli('sort-cli-orphelins-' + hors, hors, FICHIERS)
    const premier = mjsBuild(p.root)
    assert.equal(premier.status, 0, `build 1 :\n${premier.sortie}`)
    const consignes = morceaux(p)
    assert.ok(consignes.length >= 2, `fichiers du build : ${consignes.join(', ')}`)
    poserEtrangers(p)
    ecrire(p, 'hote.mjs', HOTE_SANS)
    const second = mjsBuild(p.root)
    assert.equal(second.status, 0, `build 2 :\n${second.sortie}`)
    const restants = readdirSync(p.dossier)
    for (const f of consignes) assert.equal(restants.includes(f), false, `${f} est parti à la purge : ${restants.join(', ')}\n${second.sortie}`)
    assert.deepEqual(etrangersManquants(p), [])
  })

  it('"prune": false garde les fichiers du module retiré (mjs build)', function () {
    this.timeout(240000)
    const p = projetCli('sort-cli-prune-faux', false, FICHIERS, { prune: false })
    assert.equal(mjsBuild(p.root).status, 0)
    const consignes = morceaux(p)
    assert.ok(consignes.length >= 2)
    ecrire(p, 'hote.mjs', HOTE_SANS)
    const second = mjsBuild(p.root)
    assert.equal(second.status, 0, second.sortie)
    const restants = readdirSync(p.dossier)
    for (const f of consignes) assert.ok(restants.includes(f), `${f} reste avec "prune": false : ${restants.join(', ')}`)
  })
})

describe('fichier unique coupé — des noms qui ne dépendent que du contenu', function () {
  this.timeout(120000)

  after(async () => {
    await terminateSharedWorkerPool()
  })

  for (const env of [undefined, 'prod'] as const) it(`${env ? 'production' : 'développement'} : une édition sans rapport avec le module ne renomme aucun fichier, et deux constructions d'un même contenu donnent les mêmes noms`, async () => {
    const p = projet('sort-noms-' + (env ?? 'dev'), { ...FICHIERS, 'autre.mjs': '<p>autre v1</p>\n' })
    const opts = env ? { env } : {}
    const bundler = neuf(p, opts)
    const noms    = { avant: [] as string[], meme: [] as string[] }
    try {
      assert.deepEqual((await bundler.compile()).errors, [])
      noms.avant = morceaux(p)
      writeFileSync(join(p.srcDir, 'autre.mjs'), '<p>autre v2 : une modification sans rapport avec le module</p>\n')
      assert.deepEqual((await bundler.compile()).errors, [])
      noms.meme = morceaux(p)
    }
    finally {
      await bundler.close()
    }
    assert.ok(noms.avant.filter(f => !f.endsWith('.map')).length >= 2, `le module et le morceau partagé : ${noms.avant.join(', ')}`)
    assert.deepEqual(noms.meme, noms.avant, 'même instance : les noms ne changent pas')
    assert.deepEqual((await construire(p, opts)).errors, [])
    assert.deepEqual(morceaux(p), noms.avant, 'instance neuve, même état : les mêmes noms')
  })

  it('le pied `//# mjsVersion=` ne va que sur l\'entrée, et la version reste lisible', async () => {
    const p = projet('sort-pied', FICHIERS)
    assert.deepEqual((await construire(p)).errors, [])
    const entree = readFileSync(p.manifest, 'utf8')
    assert.equal((entree.match(/\/\/# mjsVersion=[a-f0-9]{8}\n/g) ?? []).length, 1, 'un seul pied sur l\'entrée')
    const autres = morceaux(p).filter(f => f.endsWith('.js'))
    assert.ok(autres.length >= 2)
    for (const f of autres) assert.doesNotMatch(readFileSync(join(p.dossier, f), 'utf8'), /mjsVersion/, `pas de pied sur ${f}`)
    assert.match(readBuildVersion(p.manifest) ?? '', /^[a-f0-9]{8}$/, 'la version de l\'entrée se lit toujours')
  })
})

describe('fichier unique coupé — un module que seuls les modules chargés à la demande atteignent part avec eux', function () {
  this.timeout(120000)

  after(async () => {
    await terminateSharedWorkerPool()
  })

  const PROFOND    = "window.__profond = (window.__profond ?? 0) + 1\nexport texte := 'texte-profond-unique'\n"
  const BOUGIE_PRO = "@import texte 'profond.module.civet'\n" + BOUGIE + "export lireProfond = -> texte\n"
  const AVEC_PRO   = { ...FICHIERS, 'moteurs/bougie.module.civet': BOUGIE_PRO, 'profond.module.civet': PROFOND }

  for (const env of [undefined, 'prod'] as const) it(`${env ? 'production' : 'développement'} : le module n'est ni dans l'entrée ni dans le morceau partagé, il est dans le fichier du module qui l'importe`, async () => {
    const p = projet('sort-profond-' + (env ?? 'dev'), AVEC_PRO)
    assert.deepEqual((await construire(p, env ? { env } : {})).errors, [])
    const portant = readdirSync(p.dossier).filter(f => f.endsWith('.js') && readFileSync(join(p.dossier, f), 'utf8').includes('texte-profond-unique'))
    assert.equal(portant.length, 1, `un seul fichier porte le module : ${portant.join(', ')}`)
    assert.match(portant[0], /^bougie-[a-f0-9]{8}\.js$/, 'et c\'est celui de la bougie, chargé à l\'appel')
    const entree = readFileSync(p.manifest, 'utf8')
    assert.equal(entree.includes('texte-profond-unique'), false, 'pas dans l\'entrée')
    assert.equal(entree.includes('__profond'), false)
  })

  it('un module atteint des deux côtés reste une instance unique, dans le morceau partagé, pendant que le module réservé aux modules chargés à la demande part avec eux', async () => {
    const hote = ["@import vu 'commun.module.civet'", '', '<script>', "  @charger = -> await µimport('moteurs/bougie.module.civet')", '</script>', '<p>{vu}</p>', ''].join('\n')
    const commun = "window.__communs = (window.__communs ?? 0) + 1\nexport vu := 'texte-commun'\n"
    const bougie = "@import texte 'profond.module.civet'\n@import vu 'commun.module.civet'\nexport go = -> texte + vu\n"
    const p = projet('sort-profond-commun', { 'hote.mjs': hote, 'moteurs/bougie.module.civet': bougie, 'profond.module.civet': PROFOND, 'commun.module.civet': commun })
    assert.deepEqual((await construire(p, { env: 'prod' })).errors, [])
    const js = readdirSync(p.dossier).filter(f => f.endsWith('.js'))
    const dans = (marque: string): string[] => js.filter(f => readFileSync(join(p.dossier, f), 'utf8').includes(marque))
    assert.equal(dans('texte-commun').length, 1, `le module commun n'existe que dans un fichier : ${dans('texte-commun').join(', ')}`)
    assert.match(dans('texte-commun')[0], /^chunk-/, 'le morceau partagé')
    assert.deepEqual(dans('texte-profond-unique').filter(f => !/^bougie-/.test(f)), [], 'le module réservé n\'est que dans le fichier de la bougie')
    assert.equal(dans('texte-profond-unique').length, 1)
  })
})

const PAGE = '<!doctype html><html lang="fr"><head><meta charset="utf-8"></head><body><mjs-hote></mjs-hote><script type="module" src="/out/bundle.js"></script></body></html>'

describe('fichier unique coupé — dans Chromium, le module réservé n\'est ni demandé ni évalué avant l\'appel', function () {
  this.timeout(180000)
  let browser: any = null
  let present = false

  before(async function () {
    const playwright = await import('playwright')
    present = existsSync(playwright.chromium.executablePath())
    if (!present) { console.log('  ℹ️  chromium non installé, essai sauté. Activer : `npx playwright install chromium`'); return }
    browser = await playwright.chromium.launch()
  })

  after(async () => {
    if (browser) await browser.close()
    await terminateSharedWorkerPool()
  })

  const PROFOND    = "window.__profond = (window.__profond ?? 0) + 1\nexport texte := 'texte-profond-unique'\n"
  const BOUGIE_PRO = "@import texte 'profond.module.civet'\n" + BOUGIE + "export lireProfond = -> texte\n"

  for (const env of [undefined, 'prod'] as const) it(`${env ? 'production' : 'développement'} : avant le clic, rien du module réservé ; après, une évaluation et le partage évalué une fois`, async function () {
    if (!present) { this.skip(); return }
    const p = projet('sort-nav-' + (env ?? 'dev'), { ...FICHIERS, 'moteurs/bougie.module.civet': BOUGIE_PRO, 'profond.module.civet': PROFOND })
    assert.deepEqual((await construire(p, env ? { env } : {})).errors, [])
    const demandes: string[] = []
    const erreurs: string[]  = []
    const page = await (await browser.newContext()).newPage()
    page.on('pageerror', (e: any) => erreurs.push(String(e.message ?? e).slice(0, 300)))
    page.on('console', (m: any) => { if (m.type() === 'error') erreurs.push(m.text().slice(0, 300)) })
    await page.route('http://sort.test/**', (route: any) => {
      const chemin = decodeURIComponent(new URL(route.request().url()).pathname)
      demandes.push(chemin)
      if (chemin === '/') return route.fulfill({ contentType: 'text/html; charset=utf-8', body: PAGE })
      const fichier = join(p.root, normalize(chemin))
      if (chemin.startsWith('/out/') && existsSync(fichier)) return route.fulfill({ contentType: 'text/javascript; charset=utf-8', body: readFileSync(fichier) })
      return route.fulfill({ status: 404, body: '' })
    })
    try {
      await page.goto('http://sort.test/', { waitUntil: 'load' })
      await page.waitForFunction("!!document.querySelector('mjs-hote')?._shadow?.querySelector('.charger')", null, { timeout: 20000 })
      assert.equal(await page.evaluate('window.__profond'), undefined, 'le module réservé n\'est pas évalué au chargement')
      assert.equal(await page.evaluate('window.__evaluations'), 1, 'le module partagé de l\'hôte est évalué une fois')
      assert.deepEqual(demandes.filter(d => /bougie/.test(d)), [], 'aucune requête du module avant le clic')
      await page.evaluate("document.querySelector('mjs-hote')._shadow.querySelector('.charger').click()")
      await page.waitForFunction("document.querySelector('mjs-hote')._shadow.querySelector('.d').textContent === 'flamme partage'", null, { timeout: 15000 })
      assert.equal(await page.evaluate('window.__profond'), 1, 'évalué une fois, à l\'appel')
      assert.equal(await page.evaluate('window.__evaluations'), 1, 'le partage n\'est jamais évalué deux fois')
      assert.deepEqual(erreurs, [])
    }
    finally {
      await page.close()
    }
  })
})
