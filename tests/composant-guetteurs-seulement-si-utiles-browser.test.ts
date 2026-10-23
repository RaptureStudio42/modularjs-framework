// Chromium réel : ce que happy-dom ne montre pas — le nombre de guetteurs (`MutationObserver`) créés
// par 1 000 composants feuille d'une liste, le rappel d'attributs réveillé par le seul retrait de
// `mjs-loading`, et les gardes avec le vrai ordonnancement des micro-tâches du navigateur : une balise
// `mjs-*` jamais vue qui apparaît dans un `{if}` est toujours chargée, un attribut changé de l'extérieur
// met toujours la prop à jour. Avant : 2 000 guetteurs + 2 000 `observe` et 1 000 rappels pour rien ;
// après : 1 000 de chaque pour les feuilles, aucun rappel pour `mjs-loading`.
// Chromium absent → test sauté proprement, comme les autres tests navigateur.

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readdirSync, readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { mjsTmp } from './helpers/tmp.js'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { stripEsm } from '../src/server/renderToString.js'

async function chromiumPresent(): Promise<boolean> {
  try {
    const playwright = await import('playwright')
    return existsSync(playwright.chromium.executablePath())
  } catch {
    return false
  }
}

const SOURCES: Record<string, string> = {
  'feuille.mjs':    '<script>\n  $titre = "x"\n</script>\n<p class="t">{$titre}</p>\n',
  'enfant.mjs':     '<p class="e">enfant</p>\n',
  'avecenfant.mjs': '<script>\n  $show = false\n</script>\n{if $show}<@enfant></@enfant>{end}\n',
  'liste.mjs':      '<script>\n  $v = "a"\n  $liste = Array.from({ length: 1000 }, (_, i) => i)\n</script>\n{for i, n in $liste}<@feuille titre={$v}></@feuille>{end}\n',
}

const COMPTEUR = `
globalThis.__mo = { crees: 0, observes: 0, rappelsMjsLoading: 0 };
(() => {
  const Natif = globalThis.MutationObserver;
  globalThis.MutationObserver = class extends Natif {
    constructor(cb) {
      super((records, obs) => {
        if (records.length && records.every((r) => r.attributeName === 'mjs-loading')) globalThis.__mo.rappelsMjsLoading++;
        return cb(records, obs);
      });
      globalThis.__mo.crees++;
    }
    observe(...a) { globalThis.__mo.observes++; return super.observe(...a); }
  };
})();`

describe('guetteurs seulement si utiles (Chromium réel)', function () {
  this.timeout(90000)
  let present = false
  let sortie  = ''
  let fichiers: string[] = []
  const lire = (nom: string) => stripEsm(readFileSync(join(sortie, fichiers.find((f) => f.startsWith(nom + '-'))!), 'utf-8'))

  before(async function () {
    present = await chromiumPresent()
    if (!present) {
      console.log('  ℹ️  Chromium non installé, test des guetteurs sauté. Activer : `npx playwright install chromium`')
      return
    }
    const root   = mjsTmp('guetteurs-utiles-browser')
    const srcDir = join(root, 'src')
    sortie = join(root, 'out')
    mkdirSync(srcDir, { recursive: true })
    for (const [nom, source] of Object.entries(SOURCES)) writeFileSync(join(srcDir, nom), source)
    const bundler = new Bundler({ sourceDir: srcDir, outputDir: sortie, manifestPath: join(root, 'bundle.js') })
    const stats   = await bundler.compile()
    await bundler.close()
    assert.equal(stats.errors.length, 0, stats.errors.map((e: any) => e.message).join('\n'))
    fichiers = readdirSync(sortie).filter((f) => f.endsWith('.js'))
  })

  after(async () => { await terminateSharedWorkerPool() })

  it('1 000 feuilles dans une liste : un guetteur et un `observe` par feuille, aucun rappel pour `mjs-loading` ; la prop suit le parent', async function () {
    if (!present) { this.skip(); return }
    const { chromium } = await import('playwright')
    const script  = [lire('mjs_core'), 'globalThis.µ = µ;', lire('feuille'), lire('liste')].join('\n')
    const browser = await chromium.launch()
    try {
      const page = await browser.newPage()
      await page.setContent(`<!doctype html><html><head><meta charset="utf-8"></head><body><script>${COMPTEUR}</script><script>${script}</script></body></html>`, { waitUntil: 'load' })
      await page.evaluate(() => { document.body.appendChild(document.createElement('mjs-liste')) })
      await page.waitForFunction(() => (document.querySelector('mjs-liste') as any)?._shadow?.querySelectorAll('mjs-feuille').length === 1000, null, { timeout: 30000 })
      await page.waitForTimeout(300)
      const r = await page.evaluate(() => {
        const mo = (globalThis as any).__mo
        const feuilles = Array.from((document.querySelector('mjs-liste') as any)._shadow.querySelectorAll('mjs-feuille')) as any[]
        return { ...mo, feuilles: feuilles.length, chargement: feuilles.filter((f) => f.hasAttribute('mjs-loading')).length }
      })
      assert.equal(r.feuilles, 1000)
      assert.equal(r.chargement, 0, 'mjs-loading retiré partout')
      // 1 000 feuilles à un guetteur chacune ; la liste et le moteur en posent quelques-uns pour eux
      // (avant : au moins 2 000, deux par feuille)
      assert.ok(r.crees >= 1000 && r.crees <= 1010, `MutationObserver créés : ${r.crees} (attendu ~1 000, 1 par feuille)`)
      assert.ok(r.observes >= 1000 && r.observes <= 1010, `appels observe : ${r.observes} (attendu ~1 000, 1 par feuille)`)
      assert.equal(r.rappelsMjsLoading, 0, `rappels pour le seul mjs-loading : ${r.rappelsMjsLoading}`)
      const suit = await page.evaluate(async () => {
        const hote: any = document.querySelector('mjs-liste')
        hote._set('v', 'b')
        await new Promise((res) => setTimeout(res, 300))
        const f: any[] = Array.from(hote._shadow.querySelectorAll('mjs-feuille'))
        return f.filter((x) => x._state.titre !== 'b').length
      })
      assert.equal(suit, 0, 'toutes les feuilles ont reçu la prop du parent')
      const attribut = await page.evaluate(async () => {
        const f: any = (document.querySelector('mjs-liste') as any)._shadow.querySelector('mjs-feuille')
        f.setAttribute('titre', 'externe')
        await new Promise((res) => setTimeout(res, 100))
        return f._state.titre
      })
      assert.equal(attribut, 'externe', 'un attribut changé de l\'extérieur met la prop à jour')
    } finally {
      await browser.close()
    }
  })

  it('un `{if}` fait apparaître un enfant jamais vu : il est chargé (vrai ordonnancement du navigateur)', async function () {
    if (!present) { this.skip(); return }
    const { chromium } = await import('playwright')
    const script  = [lire('mjs_core'), 'globalThis.µ = µ;', lire('avecenfant')].join('\n')
    const browser = await chromium.launch()
    try {
      const page = await browser.newPage()
      await page.setContent(`<!doctype html><html><head><meta charset="utf-8"></head><body><script>${script}</script></body></html>`, { waitUntil: 'load' })
      const charges = await page.evaluate(async () => {
        const w: any = globalThis
        w.µ.paths = { enfant: 'enfant.js' }
        const vus: string[] = []
        w.µ.Autoloader.load = (tag: string) => { vus.push(String(tag).toLowerCase()) }
        const hote: any = document.createElement('mjs-avecenfant')
        document.body.appendChild(hote)
        await new Promise((res) => setTimeout(res, 100))
        hote._set('show', true)
        await new Promise((res) => setTimeout(res, 200))
        return vus
      })
      assert.ok(charges.includes('mjs-enfant'), `chargés : ${charges.join(',')}`)
    } finally {
      await browser.close()
    }
  })
})
