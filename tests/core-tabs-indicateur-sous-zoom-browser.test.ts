// module cœur tabs (<@@tabs>) : l'indicateur (la pastille du menu en courbe, le trait de la barre)
// se cale sur l'onglet actif d'après des mesures prises à l'écran. Dans un bloc rapetissé (`zoom`,
// `transform: scale`), ces mesures sont déjà réduites : reportées telles quelles dans le composant,
// elles étaient réduites une seconde fois, et l'indicateur tombait à côté de son onglet.
// Ce test garantit que l'indicateur recouvre l'onglet actif à l'échelle 1, sous `zoom` et sous
// `transform: scale`, pour les deux modèles.
// Chromium et pas happy-dom : il faut une vraie mise en page.

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

const ONGLETS = '<a value="a" icon="⌂">Accueil</a><a value="b" icon="☺">Profil</a><a value="c" icon="?">Aide</a>'

const SOURCES: Record<string, string> = {
  'banc.mjs': [
    '<script>',
    '  $t = \'b\'',
    '</script>',
    '<div class="plein courbe"><@@tabs layout="curve" value=!{$t}>' + ONGLETS + '</@@tabs></div>',
    '<div class="zoom courbe"><@@tabs layout="curve" value=!{$t}>' + ONGLETS + '</@@tabs></div>',
    '<div class="echelle courbe"><@@tabs layout="curve" value=!{$t}>' + ONGLETS + '</@@tabs></div>',
    '<div class="plein barre"><@@tabs value=!{$t}>' + ONGLETS + '</@@tabs></div>',
    '<div class="zoom barre"><@@tabs value=!{$t}>' + ONGLETS + '</@@tabs></div>',
    '<div class="echelle barre"><@@tabs value=!{$t}>' + ONGLETS + '</@@tabs></div>',
    '<style>',
    '  .zoom',
    '    zoom: .5',
    '  .echelle',
    '    transform: scale(.5)',
    '    transform-origin: 0 0',
    '</style>',
    ''
  ].join('\n')
}

describe('mjs-core-tabs (Chromium réel) — l\'indicateur sur l\'onglet actif, même dans un bloc rapetissé', function () {
  this.timeout(60000)
  let present = false
  let script  = ''

  before(async function () {
    present = await chromiumPresent()
    if (!present) {
      console.log('  ℹ️  Chromium non installé, test de l\'indicateur des onglets sauté. Activer : `npx playwright install chromium`')
      return
    }
    const root   = mjsTmp('tabs-zoom')
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

  // l'écart, en pixels d'écran, entre l'indicateur et l'onglet actif de chaque bloc
  const mesure = async (page: any) => page.evaluate(() => {
    const banc: any = document.querySelector('mjs-banc')
    const out: Record<string, number[]> = {}
    for (const bloc of banc._shadow.querySelectorAll('div')) {
      const tabs: any = bloc.querySelector('mjs-core-tabs')
      const actif     = tabs.querySelector('[active]').getBoundingClientRect()
      const courbe    = bloc.classList.contains('courbe')
      const ind       = tabs._shadow.querySelector(courbe ? '.pill' : '.bar').getBoundingClientRect()
      out[bloc.className] = courbe ? [ind.top - actif.top, ind.height - actif.height] : [ind.left - actif.left, ind.width - actif.width]
    }
    return out
  })

  it('la pastille et le trait recouvrent l\'onglet actif à l\'échelle 1, sous `zoom` et sous `transform: scale`', async function () {
    if (!present) { this.skip(); return }
    const { chromium } = await import('playwright')
    const browser = await chromium.launch()
    try {
      const page = await browser.newPage({ viewport: { width: 1400, height: 1200 } })
      await page.setContent(`<!doctype html><html><head><meta charset="utf-8"></head><body><mjs-banc></mjs-banc><script>${script}</script></body></html>`, { waitUntil: 'load' })
      await page.waitForFunction(() => {
        const banc: any = document.querySelector('mjs-banc')
        const tous      = banc?._shadow ? [...banc._shadow.querySelectorAll('mjs-core-tabs')] : []
        return tous.length === 6 && tous.every((t: any) => t._shadow?.querySelector('.ready'))
      })
      await page.waitForTimeout(700)
      const lu = await mesure(page)
      for (const [bloc, ecarts] of Object.entries(lu)) {
        for (const e of ecarts as number[]) assert.ok(Math.abs(e) <= 1, `${bloc} : l'indicateur est à ${(ecarts as number[]).map((x) => x.toFixed(1)).join(' / ')} px de l'onglet actif (position / taille)`)
      }
    } finally {
      await browser.close()
    }
  })
})
