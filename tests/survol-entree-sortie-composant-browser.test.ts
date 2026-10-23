// `@pointerenter`/`@pointerleave` (et `@mouseenter`/`@mouseleave`) dans un composant doivent jouer :
// une fois quand le pointeur entre dans l'élément, une fois quand il en sort — pas à chaque passage
// d'un enfant à l'autre à l'intérieur. Défaut garanti absent : ces événements ne remontent pas, et
// Chromium ne les fabrique même pas quand seule la racine du composant les écoute (son écouteur
// unique) — l'écriture ne faisait rien, sans un mot ; quand la page les écoute aussi, ils arrivent,
// et il ne faut pas les compter deux fois. Le gestionnaire reçoit l'événement sous son nom (`e.type`)
// et l'élément survolé pour cible ; un événement fabriqué par du code (`dispatchEvent`) passe encore.
// Chromium et vraie souris (Playwright) : c'est le navigateur qui fabrique ces événements de
// frontière au déplacement du pointeur, happy-dom ne les produit pas.

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
  'survol.mjs': [
    '<script>',
    '$pe = 0',
    '$pl = 0',
    '$me = 0',
    '$ml = 0',
    '$vu = \'\'',
    'entre = (e, el) ->',
    '  $me++',
    '  $vu = e.type + (e.target is el ? \' cible\' : \' ailleurs\')',
    '</script>',
    '<div class="zone" @pointerenter={$pe++} @pointerleave={$pl++}><span class="dedans">dedans</span><span class="aussi">aussi</span></div>',
    '<div class="zone2" @mouseenter={entre} @mouseleave={$ml++}>zone 2</div>',
    '<p class="r">{$pe}/{$pl}/{$me}/{$ml}/{$vu}</p>',
    '<style>',
    '.zone, .zone2',
    '  display: block',
    '  width: 300px',
    '  height: 100px',
    '</style>'
  ].join('\n') + '\n'
}

describe('survol dans un composant (Chromium réel) — @pointerenter/@pointerleave/@mouseenter/@mouseleave jouent', function () {
  this.timeout(60000)
  let present = false
  let script  = ''

  before(async function () {
    present = await chromiumPresent()
    if (!present) {
      console.log('  ℹ️  Chromium non installé, test du survol sauté. Activer : `npx playwright install chromium`')
      return
    }
    const root   = mjsTmp('survol')
    const srcDir = join(root, 'src')
    const outDir = join(root, 'out')
    mkdirSync(srcDir, { recursive: true })
    for (const [nom, source] of Object.entries(SOURCES)) writeFileSync(join(srcDir, nom), source)
    const bundler = new Bundler({ sourceDir: srcDir, outputDir: outDir, manifestPath: join(root, 'bundle.js') })
    const stats   = await bundler.compile()
    await bundler.close()
    assert.equal(stats.errors.length, 0, stats.errors.map((e: any) => e.message).join('\n'))
    const files = readdirSync(outDir).filter((f) => f.endsWith('.js'))
    const ordre = [...files.filter((f) => f.startsWith('mjs_')).sort(), ...files.filter((f) => !f.startsWith('mjs_')).sort()]
    script = ordre.map((f) => stripEsm(readFileSync(join(outDir, f), 'utf-8'))).join('\n') + '\nglobalThis.µ = µ;'
  })

  after(async () => { await terminateSharedWorkerPool() })

  it('entrée puis sortie : un appel chacun, rien en passant d\'un enfant à l\'autre ; l\'événement porte son nom et l\'élément pour cible', async function () {
    if (!present) { this.skip(); return }
    const { chromium } = await import('playwright')
    const browser = await chromium.launch()
    try {
      const page = await browser.newPage()
      await page.setContent(`<!doctype html><html><head><meta charset="utf-8"><style>body { margin: 0 }</style></head><body><div style="height: 40px"></div><mjs-survol></mjs-survol><script>${script}</script></body></html>`, { waitUntil: 'load' })
      await page.waitForFunction(() => !!(document.querySelector('mjs-survol') as any)?._shadow?.querySelector('.zone2'))
      const boites = await page.evaluate(() => {
        const racine: any = (document.querySelector('mjs-survol') as any)._shadow
        const boite       = (sel: string) => { const r = racine.querySelector(sel).getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height } }
        return { zone: boite('.zone'), dedans: boite('.dedans'), aussi: boite('.aussi'), zone2: boite('.zone2') }
      })
      const centre   = (b: { x: number, y: number, w: number, h: number }) => [b.x + b.w / 2, b.y + b.h / 2] as const
      const parcours = async () => {
        await page.mouse.move(700, 5)
        await page.mouse.move(boites.zone.x + 250, boites.zone.y + 80, { steps: 4 })
        await page.mouse.move(...centre(boites.dedans), { steps: 4 })
        await page.mouse.move(...centre(boites.aussi), { steps: 4 })
        await page.mouse.move(boites.zone.x + 250, boites.zone.y + 60, { steps: 4 })
        await page.mouse.move(700, 5, { steps: 4 })
        await page.mouse.move(boites.zone2.x + 150, boites.zone2.y + 50, { steps: 4 })
        await page.mouse.move(700, 5, { steps: 4 })
        await page.waitForTimeout(50)
      }
      const lire = () => page.evaluate(() => (document.querySelector('mjs-survol') as any)._shadow.querySelector('.r').textContent)
      await parcours()
      assert.equal(await lire(), '1/1/1/1/mouseenter cible', 'une entrée et une sortie par élément, sous leur propre nom, l\'élément pour cible')

      // la page écoute elle aussi ces événements : Chromium les présente alors à la racine du
      // composant — le compte ne doit pas doubler
      await page.evaluate(() => { for (const t of ['pointerenter', 'pointerleave', 'mouseenter', 'mouseleave']) document.addEventListener(t, () => {}, true) })
      await parcours()
      assert.equal(await lire(), '2/2/2/2/mouseenter cible', 'un second parcours compte un de plus, pas davantage')

      // un événement fabriqué par du code atteint toujours son gestionnaire
      await page.evaluate(() => { (document.querySelector('mjs-survol') as any)._shadow.querySelector('.zone2').dispatchEvent(new MouseEvent('mouseenter')) })
      await page.waitForTimeout(50)
      assert.equal(await lire(), '2/2/3/2/mouseenter cible', 'mouseenter envoyé par dispatchEvent : routé une fois')
    } finally {
      await browser.close()
    }
  })
})
