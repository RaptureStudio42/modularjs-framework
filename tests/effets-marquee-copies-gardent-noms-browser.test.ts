// *marquee(unit: child) dans Chromium réel : les copies ne retirent `name`, `form` et `required` qu'aux champs de formulaire. Une icône
// qui lit son attribut `name` (la forme de `<sl-icon name>`, `<ion-icon name>`, d'une icône maison) s'affiche dans chaque copie comme dans
// l'original, et garde ses attributs qui commencent par `on` sans être des gestionnaires (`online`) ; un gestionnaire en ligne (`onclick`)
// part toujours, et un champ recopié perd toujours son nom. Dans un composant, un `<slot name="logos">` recopié garde son nom : il ne
// devient pas un slot par défaut qui prendrait le contenu par défaut du composant, et la copie, placée après l'original, ne reçoit rien.

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
  'fx-icone.mjs': [
    '<div id="m" *marquee(unit: child)>',
    '  <x-icone name="etoile" online="oui" onclick="window.__clics = (window.__clics || 0) + 1"></x-icone>',
    '  <x-icone name="coeur"></x-icone>',
    '  <input class="champ" name="champ" required aria-label="Champ">',
    '</div>',
    '<style>',
    '#m',
    '  width: 600px',
    'x-icone, .champ',
    '  display: inline-block',
    '  width: 60px',
    '</style>',
    ''
  ].join('\n'),
  'fx-defile.mjs': [
    '<div id="m" *marquee(unit: child)>',
    '  <b>A</b>',
    '  <slot name="logos"></slot>',
    '  <b>B</b>',
    '</div>',
    '<p id="p"><slot></slot></p>',
    '<style>',
    '#m',
    '  width: 600px',
    'b',
    '  display: inline-block',
    '  width: 40px',
    '</style>',
    ''
  ].join('\n')
}

// une icône qui écrit son nom : vide, elle dit « (vide) »
const ICONE = "customElements.define('x-icone', class extends HTMLElement { connectedCallback() { this.textContent = this.getAttribute('name') || '(vide)' } });"

let compilation: Promise<string> | null = null
function compile(): Promise<string> {
  compilation ??= (async () => {
    const root   = mjsTmp('effets-marquee-noms')
    const srcDir = join(root, 'src')
    const outDir = join(root, 'out')
    mkdirSync(srcDir, { recursive: true })
    for (const [nom, source] of Object.entries(SOURCES)) writeFileSync(join(srcDir, nom), source)
    const bundler = new Bundler({ sourceDir: srcDir, outputDir: outDir, manifestPath: join(root, 'bundle.js') })
    const stats   = await bundler.compile()
    await bundler.close()
    assert.equal(stats.errors.length, 0, stats.errors.map((e: any) => e.message).join('\n'))
    const files = readdirSync(outDir).filter((f) => f.endsWith('.js'))
    const rang  = (f: string) => f.startsWith('mjs_core') ? 0 : f.startsWith('mjs_') ? 1 : 2
    return [...files].sort((a, b) => rang(a) - rang(b) || a.localeCompare(b)).map((f) => stripEsm(readFileSync(join(outDir, f), 'utf-8'))).join('\n') + '\nglobalThis.µ = µ;'
  })()
  return compilation
}

describe('*marquee — les copies gardent le nom des balises qui ne sont pas des champs (Chromium réel)', function () {
  this.timeout(300000)
  let present = false
  let script  = ''
  let browser: any = null

  before(async function () {
    present = await chromiumPresent()
    if (!present) {
      console.log('  ℹ️  Chromium indisponible, tests sautés')
      return
    }
    script = await compile()
    const { chromium } = await import('playwright')
    browser = await chromium.launch({ args: ['--no-sandbox', '--no-proxy-server'] })
  })

  after(async () => {
    if (browser) await browser.close()
    await terminateSharedWorkerPool()
  })

  async function ouvre(corps: string) {
    const contexte = await browser.newContext({ viewport: { width: 900, height: 600 } })
    const page     = await contexte.newPage()
    const erreurs: string[] = []
    page.on('pageerror', (e: any) => erreurs.push(String(e.message ?? e)))
    await page.route('http://t.test/**', (route: any) => {
      if (route.request().url() !== 'http://t.test/') return route.fulfill({ status: 404, body: '' })
      return route.fulfill({ contentType: 'text/html', body: `<!doctype html><html><head><meta charset="utf-8"><style>html,body{margin:0}</style></head><body>${corps}<script>${ICONE}\n${script}</script></body></html>` })
    })
    await page.goto('http://t.test/', { waitUntil: 'load' })
    return { contexte, page, erreurs }
  }

  it('une icône lue par son nom s\'affiche dans chaque copie ; `online` reste, `onclick` part, un champ sans formulaire garde son nom', async function () {
    if (!present) return this.skip()
    const { contexte, page, erreurs } = await ouvre('<mjs-fx-icone></mjs-fx-icone>')
    await page.waitForFunction(() => !!(document.querySelector('mjs-fx-icone') as any)?._shadow?.querySelector('[mjs-fx-marquee-copy]'))
    const vu = await page.evaluate(() => {
      const sh: any = (document.querySelector('mjs-fx-icone') as any)._shadow
      const copies = Array.from(sh.querySelectorAll('[mjs-fx-marquee-copy]')) as any[]
      const icones = copies.flatMap((c) => Array.from(c.querySelectorAll('x-icone')) as any[])
      const champs = copies.flatMap((c) => Array.from(c.querySelectorAll('input')) as any[])
      return {
        copies: copies.length,
        textes: icones.map((i) => i.textContent),
        online: icones.filter((i) => i.getAttribute('online') === 'oui').length,
        onclick: icones.filter((i) => i.hasAttribute('onclick')).length,
        nomsDeChamps: champs.filter((c) => c.hasAttribute('name') || c.hasAttribute('required')).length,
        champs: champs.length
      }
    })
    await contexte.close()
    assert.deepEqual(erreurs, [])
    assert.ok(vu.copies > 0, 'des copies sont posées')
    assert.deepEqual(vu.textes.filter((t: string) => t !== 'etoile' && t !== 'coeur'), [], 'chaque icône recopiée garde son nom : ' + JSON.stringify(vu.textes))
    assert.equal(vu.online, vu.copies, 'l\'attribut `online` de l\'icône reste dans chaque copie')
    assert.equal(vu.onclick, 0, 'aucun gestionnaire en ligne dans les copies')
    assert.ok(vu.champs > 0, 'le champ est recopié')
    assert.equal(vu.nomsDeChamps, vu.champs, 'un champ recopié sans formulaire garde son nom et son obligation (seul un champ que son formulaire n\'accompagne pas dans la copie les perd)')
  })

  it('dans un composant, un <slot name> recopié garde son nom : le contenu par défaut reste à sa place, la copie ne reçoit rien', async function () {
    if (!present) return this.skip()
    const { contexte, page, erreurs } = await ouvre('<mjs-fx-defile><span slot="logos">LOGO</span>Texte par défaut</mjs-fx-defile>')
    await page.waitForFunction(() => !!(document.querySelector('mjs-fx-defile') as any)?._shadow?.querySelector('[mjs-fx-marquee-copy]'))
    const vu = await page.evaluate(() => {
      const sh: any = (document.querySelector('mjs-fx-defile') as any)._shadow
      const lus = (s: any) => s.assignedNodes().map((n: any) => (n.textContent || '').trim()).filter(Boolean)
      const copies = Array.from(sh.querySelectorAll('[mjs-fx-marquee-copy] slot')) as any[]
      return {
        p: lus(sh.querySelector('#p slot')),
        original: lus(sh.querySelector('[mjs-fx-marquee-run] > slot')),
        copies: copies.map((s) => (s.getAttribute('name') ?? '') + '=' + JSON.stringify(lus(s)))
      }
    })
    await contexte.close()
    assert.deepEqual(erreurs, [])
    assert.deepEqual(vu.p, ['Texte par défaut'], 'le slot par défaut du composant garde son contenu')
    assert.deepEqual(vu.original, ['LOGO'], 'le slot d\'origine garde le sien')
    assert.ok(vu.copies.length > 0, 'le slot est recopié')
    assert.deepEqual(vu.copies.filter((c: string) => c !== 'logos=[]'), [], 'chaque copie garde le nom et ne reçoit rien : ' + JSON.stringify(vu.copies))
  })
})
