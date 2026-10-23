// Ce que ce test garantit : deux modules du même nom de fichier dans deux dossiers (`a/outil.module.civet`,
// `b/outil.module.civet`) restent deux modules. Chacun garde son code, qu'on l'atteigne par `@import` ou par `µimport`, en fichiers
// séparés comme en fichier unique, en développement comme en production ; deux sorties de même nom ne s'écrasent jamais, et le
// build n'avertit plus d'une « collision » entre eux. Dans Chromium réel : chaque import rend le code de SON module, un module
// importé des deux façons reste une instance (même objet), et chacun n'est évalué qu'une fois.
import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readFileSync, readdirSync, existsSync } from 'node:fs'
import { join, dirname, normalize } from 'node:path'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { mjsTmp } from './helpers/tmp.js'

const MODULE_A = "window.__ev = (window.__ev ?? 0) + 1\nexport qa := -> 'valeur-de-a'\n"
const MODULE_B = "window.__ev = (window.__ev ?? 0) + 1\nexport qb := -> 'valeur-de-b'\n"

const HOTE_IMPORT = ["@import qa 'a/outil.module.civet'", "@import qb 'b/outil.module.civet'", '', '<script>', "  $r = 'rien'", '  @go = -> $r = qa() + qb()', '</script>', '', '<button class="go" @click=@go>go</button>', '<p class="r">{$r}</p>', ''].join('\n')
const HOTE_TOUT   = ["@import qa 'a/outil.module.civet'", "@import qb 'b/outil.module.civet'", '', '<script>', "  $r = 'rien'", '  @go = ->', "    ma = await µimport('a/outil.module.civet')", "    mb = await µimport('b/outil.module.civet')", '    $r = qa() + qb() + ma.qa() + mb.qb() + String(ma.qa is qa) + String(mb.qb is qb)', '</script>', '', '<button class="go" @click=@go>go</button>', '<p class="r">{$r}</p>', ''].join('\n')
const HOTE_MU     = ['<script>', "  $r = 'rien'", '  @go = ->', "    ma = await µimport('a/outil.module.civet')", "    mb = await µimport('b/outil.module.civet')", '    $r = ma.qa() + mb.qb()', '</script>', '', '<button class="go" @click=@go>go</button>', '<p class="r">{$r}</p>', ''].join('\n')

interface Projet { root: string, srcDir: string, outDir: string }

function projet(prefixe: string, fichiers: Record<string, string>): Projet {
  const root   = mjsTmp(prefixe)
  const srcDir = join(root, 'src')
  for (const [chemin, contenu] of Object.entries(fichiers)) {
    mkdirSync(dirname(join(srcDir, chemin)), { recursive: true })
    writeFileSync(join(srcDir, chemin), contenu)
  }
  return { root, srcDir, outDir: join(root, 'out') }
}

async function construire(p: Projet, opts: Record<string, unknown> = {}): Promise<{ errors: string[], warnings: string[] }> {
  const bundler = new Bundler({ sourceDir: p.srcDir, outputDir: p.outDir, manifestPath: join(p.outDir, 'bundle.js'), urlPrefix: '/out', ...opts } as any)
  try {
    const stats = await bundler.compile()
    return { errors: stats.errors.map((e: any) => e.message), warnings: stats.warnings }
  }
  finally {
    await bundler.close()
  }
}

const jsPublies = (p: Projet): string[] => existsSync(p.outDir) ? readdirSync(p.outDir).filter(f => f.endsWith('.js')).sort() : []
const portant   = (p: Projet, marque: string): string[] => jsPublies(p).filter(f => readFileSync(join(p.outDir, f), 'utf8').includes(marque))

const MODES = [
  { nom: 'développement, fichiers séparés', js: 'split',  prod: false },
  { nom: 'production, fichiers séparés',    js: 'split',  prod: true },
  { nom: 'développement, fichier unique',   js: 'bundle', prod: false },
  { nom: 'production, fichier unique',      js: 'bundle', prod: true },
] as const

const optionsDe = (mode: typeof MODES[number]): Record<string, unknown> => ({ js: mode.js, ...(mode.prod ? { env: 'prod' } : {}) })

describe('modules de même nom dans deux dossiers — le code de chacun est gardé', function () {
  this.timeout(120000)

  after(async () => {
    await terminateSharedWorkerPool()
  })

  for (const mode of MODES) it(`@import des deux modules, ${mode.nom} : chaque code est publié une fois, dans son propre fichier, sans avertissement de collision`, async () => {
    const p = projet('hom-import', { 'hote.mjs': HOTE_IMPORT, 'a/outil.module.civet': MODULE_A, 'b/outil.module.civet': MODULE_B })
    const { errors, warnings } = await construire(p, optionsDe(mode))
    assert.deepEqual(errors, [])
    assert.doesNotMatch(warnings.join('\n'), /Collision de basename/, 'deux modules de dossiers différents ne se disputent plus un nom')
    const a = portant(p, 'valeur-de-a')
    const b = portant(p, 'valeur-de-b')
    assert.equal(a.length, 1, `le code de a dans un seul fichier : ${jsPublies(p).join(', ')}`)
    assert.equal(b.length, 1, `le code de b dans un seul fichier : ${jsPublies(p).join(', ')}`)
    if (mode.js === 'split') assert.notEqual(a[0], b[0], 'deux fichiers distincts : aucun n\'écrase l\'autre')
  })

  for (const mode of MODES) it(`µimport des deux modules, ${mode.nom} : chaque module a son fichier, le code de chacun n'est que dans le sien`, async () => {
    const p = projet('hom-mu', { 'hote.mjs': HOTE_MU, 'a/outil.module.civet': MODULE_A, 'b/outil.module.civet': MODULE_B })
    const { errors } = await construire(p, optionsDe(mode))
    assert.deepEqual(errors, [])
    const a = portant(p, 'valeur-de-a')
    const b = portant(p, 'valeur-de-b')
    assert.equal(a.length, 1, `le code de a dans un seul fichier : ${jsPublies(p).join(', ')}`)
    assert.equal(b.length, 1, `le code de b dans un seul fichier : ${jsPublies(p).join(', ')}`)
    assert.notEqual(a[0], b[0], 'deux fichiers distincts')
    const hote = jsPublies(p).find(f => mode.js === 'split' ? /^hote-/.test(f) : f === 'bundle.js')!
    const code = readFileSync(join(p.outDir, hote), 'utf8')
    assert.ok(code.includes(a[0]) && code.includes(b[0]), `l'appel de chaque µimport vise le fichier de son module (${a[0]}, ${b[0]})`)
  })

  it('les noms ne dépendent ni de l\'ordre de compilation ni de l\'instance : deux constructions donnent les mêmes fichiers', async () => {
    const fichiers = { 'hote.mjs': HOTE_TOUT, 'a/outil.module.civet': MODULE_A, 'b/outil.module.civet': MODULE_B, 'outil.module.civet': "export racine := -> 'valeur-racine'\n" }
    const p = projet('hom-stable', fichiers)
    assert.deepEqual((await construire(p, { js: 'split' })).errors, [])
    const premier = jsPublies(p)
    assert.deepEqual((await construire(p, { js: 'split' })).errors, [])
    assert.deepEqual(jsPublies(p), premier)
    assert.equal(portant(p, 'valeur-racine').length, 1, 'le module de la racine, de même nom, garde aussi son fichier')
    assert.equal(new Set([...portant(p, 'valeur-de-a'), ...portant(p, 'valeur-de-b'), ...portant(p, 'valeur-racine')]).size, 3)
  })

  it('un module .civet et un module .coffee de même nom dans le même dossier gardent chacun leur code', async () => {
    const hote = ["@import ca 'lib/outil.civet'", "@import cb 'lib/outil.coffee'", '', '<script>', "  $r = 'rien'", '  @go = -> $r = ca() + cb()', '</script>', '<p>{$r}</p>', ''].join('\n')
    const p = projet('hom-ext', { 'hote.mjs': hote, 'lib/outil.civet': "export ca := -> 'valeur-civet'\n", 'lib/outil.coffee': "export cb = -> 'valeur-coffee'\n" })
    const { errors } = await construire(p, { js: 'split' })
    assert.deepEqual(errors, [])
    assert.equal(portant(p, 'valeur-civet').length, 1)
    assert.equal(portant(p, 'valeur-coffee').length, 1)
    assert.notEqual(portant(p, 'valeur-civet')[0], portant(p, 'valeur-coffee')[0])
  })
})

const PAGE = '<!doctype html><html lang="fr"><head><meta charset="utf-8"></head><body><mjs-hote></mjs-hote><script type="module" src="/out/bundle.js"></script></body></html>'

describe('modules de même nom dans deux dossiers — Chromium réel', function () {
  this.timeout(180000)
  let browser: any = null
  let present = false

  before(async function () {
    const playwright = await import('playwright')
    present = existsSync(playwright.chromium.executablePath())
    if (!present) { console.log('  ℹ️  chromium non installé, essais sautés. Activer : `npx playwright install chromium`'); return }
    browser = await playwright.chromium.launch()
  })

  after(async () => {
    if (browser) await browser.close()
    await terminateSharedWorkerPool()
  })

  for (const mode of MODES) it(`${mode.nom} : chaque import rend le code de son module (@import et µimport), évalué une fois`, async function () {
    if (!present) { this.skip(); return }
    const p = projet('hom-nav', { 'hote.mjs': HOTE_TOUT, 'a/outil.module.civet': MODULE_A, 'b/outil.module.civet': MODULE_B })
    const { errors } = await construire(p, optionsDe(mode))
    assert.deepEqual(errors, [])
    const erreurs: string[] = []
    const page = await (await browser.newContext()).newPage()
    page.on('pageerror', (e: any) => erreurs.push(String(e.message ?? e).slice(0, 300)))
    page.on('console', (m: any) => { if (m.type() === 'error') erreurs.push(m.text().slice(0, 300)) })
    await page.route('http://hom.test/**', (route: any) => {
      const chemin = decodeURIComponent(new URL(route.request().url()).pathname)
      if (chemin === '/') return route.fulfill({ contentType: 'text/html; charset=utf-8', body: PAGE })
      const fichier = join(p.root, normalize(chemin))
      if (chemin.startsWith('/out/') && existsSync(fichier)) return route.fulfill({ contentType: 'text/javascript; charset=utf-8', body: readFileSync(fichier) })
      return route.fulfill({ status: 404, body: '' })
    })
    try {
      await page.goto('http://hom.test/', { waitUntil: 'load' })
      await page.waitForFunction("!!document.querySelector('mjs-hote')?._shadow?.querySelector('.go')", null, { timeout: 20000 })
      await page.evaluate("document.querySelector('mjs-hote')._shadow.querySelector('.go').click()")
      await page.waitForFunction("document.querySelector('mjs-hote')._shadow.querySelector('.r').textContent !== 'rien'", null, { timeout: 15000 })
      assert.equal(await page.evaluate("document.querySelector('mjs-hote')._shadow.querySelector('.r').textContent"), ['valeur-de-a', 'valeur-de-b', 'valeur-de-a', 'valeur-de-b', 'true', 'true'].join(''))
      assert.equal(await page.evaluate('window.__ev'), 2, 'chaque module n\'est évalué qu\'une fois')
      assert.deepEqual(erreurs, [])
    }
    finally {
      await page.close()
    }
  })
})
