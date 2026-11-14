// Construction : la machinerie des valeurs dérivées (blocs balisés `<derivees>` de runtime/mjs_element.ts, mjs_init.ts et mjs_store_globals.ts —
// `_mjs_setComputed`, l'horloge `_MJS_HORLOGE` et ses comptes `_mjsCompte`) n'entre au cœur que si une unité de la construction a une valeur
// dérivée : son code compilé appelle `µ._mjs_setComputed(` (`$total = $a * 2`, `µderived`, une dérivée qui lit un magasin `$$x`). Une construction
// qui n'est pas de production la garde, quelle que soit la clé `runtime` (cœur nu compris) : l'atelier de thème et le journal d'erreurs, compilés
// à la volée hors de la construction, s'en servent. Une appli dont la seule dérivée vit dans un composant chargé à la demande garde des valeurs
// justes en production (Chromium). La précision ne sert que les valeurs dérivées : sans elles, le cœur de production est, à l'octet, celui de la règle
// de l'horloge, et une dérivée y fait venir le texte de la précision

import assert from 'node:assert/strict'
import { existsSync, mkdirSync, writeFileSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import * as features from '../src/bundler/features.js'
import { transpile } from '../src/transpiler/index.js'
import { mjsTmp } from './helpers/tmp.js'
import { construire, charger } from './helpers/liaison-navigateur.js'

const SANS       = '<script>\n  $n = 1\n  @plus = -> $n += 1\n</script>\n<p class="n">{$n}</p>\n'
const MAGASIN    = '<script>\n  $$prix = 3\n  @plus = -> $$prix += 1\n</script>\n<p class="n">{$$prix}</p>\n'
const DERIVEE    = '<script>\n  $a = 1\n  $total = $a * 2\n</script>\n<p>{$total}</p>\n'
const MU_DERIVED = '<script>\n  $a = 1\n  µderived $double = $a * 2, $a\n</script>\n<p>{$double}</p>\n'
const DU_MAGASIN = '<script>\n  $$prix = 3\n  $ttc = $$prix * 2\n</script>\n<p>{$ttc}</p>\n'
// la seule dérivée de l'appli vit dans l'enfant, chargé à la demande quand la page le pose
const PAGE       = '<script>\n  $vu = 1\n</script>\n<@c-total></@c-total>\n'
const ENFANT     = '<script>\n  $a = 1\n  $$prix = 3\n  $total = $a * 2\n  µderived $triple = $a * 3, $a\n  $ttc = $$prix * 2\n  @plus = -> $a += 1\n  @cher = -> $$prix += 1\n</script>\n<p class="v">{$total} {$triple} {$ttc}</p>\n'

// les morceaux de la machinerie, sous leur forme de code (un commentaire qui la nomme ne compte pas), et le repère de ses blocs ; la
// signature, sans sa fin : la précision y ajoute la source de la valeur (`src`)
const MORCEAUX = ['µ._mjs_setComputed = function', '_mjs_setComputed(k, fn', 'mjs-horloge', '_mjsCompte(', '// <derivees>']

function sansMachinerie(texte: string, cas: string) {
  for (const m of MORCEAUX) assert.equal(texte.includes(m), false, `${cas} : « ${m} » n'est plus au cœur`)
}

function avecMachinerie(texte: string, cas: string) {
  for (const m of MORCEAUX.slice(0, 4)) assert.equal(texte.includes(m), true, `${cas} : « ${m} » est au cœur`)
}

// sans dérivée, rien de la précision : le cœur est, à l'octet, celui d'une construction réglée sur la règle de l'horloge (`derived: "clock"`)
function pareilQueLHorloge(texte: string, horloge: string, cas: string) {
  assert.equal(texte.length, horloge.length, `${cas} : le cœur a la taille de celui de l'horloge`)
  assert.ok(texte === horloge, `${cas} : le cœur est celui de l'horloge`)
}

// le cœur construit (non minifié) d'une appli faite de ces composants
async function coeur(nom: string, sources: Record<string, string>, reglages: Record<string, unknown>): Promise<string> {
  const root   = mjsTmp('derivees-' + nom)
  const srcDir = join(root, 'src')
  const outDir = join(root, 'out')
  mkdirSync(srcDir, { recursive: true })
  for (const [fichier, source] of Object.entries(sources)) writeFileSync(join(srcDir, fichier), source)
  const bundler = new Bundler({ sourceDir: srcDir, outputDir: outDir, manifestPath: join(root, 'bundle.js'), minify: false, ...reglages } as any)
  const stats   = await bundler.compile()
  await bundler.close()
  if (stats.errors.length) throw new Error(stats.errors.map((e: any) => e.message).join('\n'))
  const fichier = readdirSync(outDir).find((f) => /^mjs_core/.test(f) && f.endsWith('.js'))
  assert.ok(fichier, `cœur introuvable dans ${readdirSync(outDir).join(', ')}`)
  return readFileSync(join(outDir, fichier), 'utf-8')
}

// l'appli en un seul fichier minifié, comme celle du banc de l'accueil
async function paquet(nom: string, sources: Record<string, string>): Promise<string> {
  const root   = mjsTmp('derivees-paquet-' + nom)
  const srcDir = join(root, 'src')
  const outDir = join(root, 'out')
  mkdirSync(srcDir, { recursive: true })
  for (const [fichier, source] of Object.entries(sources)) writeFileSync(join(srcDir, fichier), source)
  const bundler = new Bundler({ sourceDir: srcDir, outputDir: outDir, manifestPath: join(outDir, 'bundle.js'), urlPrefix: '/out', env: 'prod', js: 'bundle', forceMinify: true, minimalRuntime: true } as any)
  const stats   = await bundler.compile()
  await bundler.close()
  if (stats.errors.length) throw new Error(stats.errors.map((e: any) => e.message).join('\n'))
  return readFileSync(join(outDir, 'bundle.js'), 'utf-8')
}

describe('valeurs dérivées — leur machinerie au cœur seulement quand une unité en a une', function () {
  this.timeout(180000)

  after(async () => { await terminateSharedWorkerPool() })

  it('signal : une dérivée, un µderived, une dérivée d\'un magasin le posent ; un état ou un magasin sans dérivée, non', async () => {
    const signal = (features as any).DERIVED_VALUES
    assert.equal(typeof signal, 'string', 'le signal est publié par le module des signaux')
    const sortie = async (source: string) => (await transpile(source, { moduleName: 'mjs-essai' })).output
    assert.equal(features.scanCompiledFeatures(await sortie(DERIVEE)).has(signal), true, '$total = $a * 2')
    assert.equal(features.scanCompiledFeatures(await sortie(MU_DERIVED)).has(signal), true, 'µderived')
    assert.equal(features.scanCompiledFeatures(await sortie(DU_MAGASIN)).has(signal), true, 'dérivée qui lit un magasin')
    assert.equal(features.scanCompiledFeatures(await sortie(SANS)).has(signal), false, 'état sans dérivée')
    assert.equal(features.scanCompiledFeatures(await sortie(MAGASIN)).has(signal), false, 'magasin sans dérivée')
  })

  it('production : sans dérivée, le cœur n\'en porte rien ; une dérivée dans un seul composant la fait venir', async () => {
    const sans = await coeur('prod-sans', { 'compteur.mjs': SANS }, { env: 'prod' })
    sansMachinerie(sans, 'production sans dérivée')
    pareilQueLHorloge(sans, await coeur('prod-sans-horloge', { 'compteur.mjs': SANS }, { env: 'prod', derivedMode: 'clock' }), 'production sans dérivée')
    const avec = await coeur('prod-avec', { 'compteur.mjs': SANS, 'total.mjs': DERIVEE }, { env: 'prod' })
    avecMachinerie(avec, 'production, une dérivée')
    assert.equal(avec.includes('_mjs_setComputed(k, fn, src) {'), true, 'production, une dérivée : le texte de la précision')
    avecMachinerie(await coeur('prod-mu', { 'compteur.mjs': SANS, 'double.mjs': MU_DERIVED }, { env: 'prod' }), 'production, un µderived')
  })

  it('magasin : sans dérivée, ses écritures brutes ne comptent rien ; une dérivée qui le lit garde le compte', async () => {
    const sans = await coeur('magasin-sans', { 'prix.mjs': MAGASIN }, { env: 'prod' })
    assert.equal(sans.includes('µ._mjs_storeRawWrite'), true, 'le module du magasin est au cœur')
    sansMachinerie(sans, 'magasin sans dérivée')
    pareilQueLHorloge(sans, await coeur('magasin-sans-horloge', { 'prix.mjs': MAGASIN }, { env: 'prod', derivedMode: 'clock' }), 'magasin sans dérivée')
    const avec = await coeur('magasin-avec', { 'prix.mjs': MAGASIN, 'ttc.mjs': DU_MAGASIN }, { env: 'prod' })
    avecMachinerie(avec, 'dérivée d\'un magasin')
    assert.equal(avec.includes('if (comp._mjs_computeds) _mjsCompte(comp._mjs_computeds, k);'), true, 'l\'écriture brute du magasin périme ses dérivées')
  })

  it('développement : toute construction la garde, cœur nu sans dérivée compris (atelier de thème, journal d\'erreurs)', async () => {
    avecMachinerie(await coeur('dev-nu', { 'compteur.mjs': SANS }, { env: 'dev', runtime: 'core' }), 'développement, cœur nu sans dérivée')
    avecMachinerie(await coeur('dev-liste', { 'compteur.mjs': SANS }, { env: 'dev', runtime: ['router'] }), 'développement, liste de modules sans dérivée')
    avecMachinerie(await coeur('dev-nu-avec', { 'compteur.mjs': SANS, 'total.mjs': DERIVEE }, { env: 'dev', runtime: 'core' }), 'développement, cœur nu, une dérivée')
    avecMachinerie(await coeur('dev-complet', { 'compteur.mjs': SANS }, { env: 'dev' }), 'développement complet sans dérivée')
  })

  it('paquet minifié (réglages du banc) : sans dérivée, ni l\'horloge ni la fiche d\'une dérivée ; avec, les deux', async () => {
    const sans = await paquet('sans', { 'compteur.mjs': SANS })
    assert.equal(sans.includes('mjs-horloge'), false, 'sans dérivée : pas d\'horloge')
    assert.equal(sans.includes('_mjs_c:!0'), false, 'sans dérivée : pas de fiche de dérivée (`_mjs_setComputed`)')
    const avec = await paquet('avec', { 'compteur.mjs': SANS, 'total.mjs': DERIVEE })
    assert.equal(avec.includes('mjs-horloge'), true, 'avec dérivée : l\'horloge')
    assert.equal(avec.includes('_mjs_c:!0'), true, 'avec dérivée : la fiche d\'une dérivée')
  })

  describe('Chromium, production', function () {
    let browser: any = null

    before(async function () {
      const playwright = await import('playwright')
      if (!existsSync(playwright.chromium.executablePath())) {
        console.log('  ℹ️  chromium non installé, essai en navigateur sauté. Activer : `npx playwright install chromium`')
        this.skip()
      }
      browser = await playwright.chromium.launch()
    })

    after(async () => {
      if (browser) await browser.close()
    })

    it('une appli sans dérivée, au cœur allégé, rend et réagit', async () => {
      const cible = await construire('bundle', { 'compteur.mjs': SANS }, ['mjs-compteur'])
      sansMachinerie(readFileSync(join(cible.racine, 'out', 'bundle.js'), 'utf-8'), 'paquet de production sans dérivée')
      const o = await charger(browser, cible, 'mjs-compteur')
      try {
        const lire = () => o.page.evaluate(`((document.querySelector('mjs-compteur') || {})._shadow || document).querySelector('.n')?.textContent`)
        await o.page.waitForFunction(`!!((document.querySelector('mjs-compteur') || {})._shadow || {}).textContent`, null, { timeout: 10000 })
        assert.equal(await lire(), '1')
        await o.page.evaluate(`document.querySelector('mjs-compteur').plus()`)
        await o.page.waitForTimeout(50)
        assert.equal(await lire(), '2', 'l\'écriture est rendue')
        assert.deepEqual(o.erreurs, [], 'aucune erreur de page')
      }
      finally {
        await o.fermer()
      }
    })

    it('une dérivée, un µderived et une dérivée d\'un magasin dans un composant chargé à la demande restent justes', async () => {
      const cible = await construire('split', { 'dpage.mjs': PAGE, 'c-total.mjs': ENFANT }, ['mjs-dpage'])
      const noyau = readdirSync(join(cible.racine, 'out')).find((f) => /^mjs_core/.test(f) && f.endsWith('.js'))
      assert.ok(noyau, 'le cœur est un fichier à part')
      assert.equal(readFileSync(join(cible.racine, 'out', noyau), 'utf-8').includes('mjs-horloge'), true, 'l\'horloge est au cœur')
      const o = await charger(browser, cible, 'mjs-dpage')
      try {
        const enfant = `document.querySelector('mjs-dpage')._shadow.querySelector('mjs-c-total')`
        const lire   = () => o.page.evaluate(`${enfant}._shadow.querySelector('.v').textContent`)
        await o.page.waitForFunction(`(() => { try { return !!${enfant}._shadow.querySelector('.v') } catch (e) { return false } })()`, null, { timeout: 10000 })
        assert.equal(await lire(), '2 3 6', 'valeurs de départ')
        await o.page.evaluate(`${enfant}.plus()`)
        await o.page.waitForTimeout(50)
        assert.equal(await lire(), '4 6 6', '$a écrit : la dérivée et le µderived suivent')
        await o.page.evaluate(`${enfant}.cher()`)
        await o.page.waitForTimeout(50)
        assert.equal(await lire(), '4 6 8', '$$prix écrit : la dérivée du magasin suit')
        assert.deepEqual(o.erreurs, [], 'aucune erreur de page')
      }
      finally {
        await o.fermer()
      }
    })
  })
})
