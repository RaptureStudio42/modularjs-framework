// *skeleton sur une balise : le réglage `height` donne sa hauteur à la silhouette, ses barres se la partagent (l'écart de 10 px
// gardé entre elles), chacune au moins 14 px. Une longueur : un nombre (en px) ou une valeur CSS (px, %, em, rem, vw, vh) ; un
// pourcentage sans hauteur écrite sur la balise ne vaut rien ; sans lui, la silhouette a la hauteur de ses barres, comme avant
// (14 px chacune). Tenu par une variable, il suit sur place. Mesuré dans Chromium, Firefox et
// WebKit, construit en production.

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { mjsTmp } from './helpers/tmp.js'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { stripEsm } from '../src/server/renderToString.js'
import { parseEffect } from '../src/effects/catalog.js'

type Navigateur = 'chromium' | 'firefox' | 'webkit'

async function navigateurPresent(nom: Navigateur): Promise<boolean> {
  try {
    const playwright = await import('playwright')
    return existsSync(playwright[nom].executablePath())
  } catch {
    return false
  }
}

const SCENE = `<script>
$h = '90px'
</script>
<div class="d" *skeleton></div>
<div class="h" *skeleton(height: 120)></div>
<div class="r" *skeleton(height: 10rem)></div>
<div class="u" *skeleton(lines: 1, height: 200)></div>
<div class="q" *skeleton(height: 100%)></div>
<div class="t" *skeleton(height: 90)>Texte déjà là</div>
<div class="f" *skeleton(height: 100%)></div>
<div class="m" *skeleton(height: 20)></div>
<div class="v" *skeleton(height: $h)></div>
<button class="plus" @click={$h = '6rem'}>+</button>
<style>
:host
  display: block
div
  width: 300px
  margin: 0 0 20px 0
.q
  height: 300px
</style>
`

const TAG    = 'mjs-skh-scene'
const BALISE = (c: string) => `document.querySelector('${TAG}')._shadow.querySelector('.${c}')`
// la hauteur de la silhouette, puis celle de chacune de ses barres, en px arrondis au centième
// deux mesures égales au centième près : les moteurs répartissent autrement les fractions de pixel entre les barres
const proche = (vu: number[], attendu: number[]) => assert.ok(vu.length === attendu.length && vu.every((x, i) => Math.abs(x - attendu[i]) <= 0.02), `${JSON.stringify(vu)} au lieu de ${JSON.stringify(attendu)}`)
const MESURE = (c: string) => `((l) => [l.getBoundingClientRect().height, ...Array.from(l.children).map((i) => i.getBoundingClientRect().height)].map((x) => Math.round(x * 100) / 100))(${BALISE(c)}.querySelector('[mjs-fx-layer="skeleton"]'))`

describe('*skeleton : le réglage height', function () {
  this.timeout(900000)

  describe('catalogue', () => {
    it('une longueur : un nombre (px) ou une valeur CSS ; un mot refusé avec la règle', () => {
      assert.equal(parseEffect('skeleton', 'height: 120').fixed.height, 120)
      assert.equal(parseEffect('skeleton', 'height: 8rem').fixed.height, '8rem')
      assert.equal(parseEffect('skeleton', 'height: 50%').fixed.height, '50%')
      assert.throws(() => parseEffect('skeleton', 'height: grand'), /longueur/)
      assert.equal(parseEffect('skeleton', '').fixed.height, undefined, 'sans valeur par défaut : la hauteur des barres, comme avant')
    })
  })

  describe('navigateurs', () => {
    let script = ''

    before(async () => {
      const root   = mjsTmp('skeleton-hauteur')
      const srcDir = join(root, 'src')
      const outDir = join(root, 'out')
      mkdirSync(srcDir, { recursive: true })
      writeFileSync(join(srcDir, 'skh-scene.mjs'), SCENE)
      const manifeste = join(outDir, 'bundle.js')
      const bundler   = new Bundler({ sourceDir: srcDir, outputDir: outDir, manifestPath: manifeste, js: 'bundle', env: 'prod' } as any)
      const stats     = await bundler.compile()
      await bundler.close()
      assert.deepEqual(stats.errors.map((e: any) => e.message), [])
      script = stripEsm(readFileSync(manifeste, 'utf-8'))
    })

    after(async () => { await terminateSharedWorkerPool() })

    for (const nom of (process.env.NAVIGATEUR ? [process.env.NAVIGATEUR] : ['chromium', 'firefox', 'webkit']) as Navigateur[]) {
      describe(nom, function () {
        let browser: any
        let page: any
        const erreurs: string[] = []

        before(async function () {
          if (!(await navigateurPresent(nom))) {
            console.log(`  ℹ️  ${nom} non installé, test sauté. Activer : \`npx playwright install ${nom}\``)
            return this.skip()
          }
          browser = await (await import('playwright'))[nom].launch()
          page    = await (await browser.newContext({ viewport: { width: 400, height: 1600 } })).newPage()
          page.on('pageerror', (e: any) => erreurs.push(String(e)))
          page.on('console', (m: any) => { if (m.type() === 'error' || (m.type() === 'warning' && m.text().startsWith('[ModularJS]'))) erreurs.push(m.text()) })
          await page.route('http://t.test/**', (route: any) => {
            if (route.request().url() !== 'http://t.test/') return route.fulfill({ status: 404, body: '' })
            return route.fulfill({ contentType: 'text/html', body: `<!doctype html><html><head><meta charset="utf-8"><style>html,body{margin:0}</style></head><body><${TAG}></${TAG}><script>${script}</script></body></html>` })
          })
          await page.goto('http://t.test/', { waitUntil: 'load' })
          await page.waitForFunction(`(() => { const s = document.querySelector('${TAG}')?._shadow; return !!s && ['d', 'h', 'r', 'u', 'q', 't', 'f', 'm', 'v'].every((c) => !!s.querySelector('.' + c + ' > [mjs-fx-layer="skeleton"]')) })()`, null, { timeout: 60000, polling: 50 })
        })

        after(async () => { await browser?.close() })

        it('sans height : la silhouette a la hauteur de ses trois barres de 14 px, comme avant', async () => {
          proche(await page.evaluate(MESURE('d')), [62, 14, 14, 14])
        })

        it('height: 120 — la silhouette fait 120 px, ses trois barres se les partagent', async () => {
          proche(await page.evaluate(MESURE('h')), [120, 33.33, 33.33, 33.33])
        })

        it('height: 10rem — 160 px ; lines: 1, height: 200 — une barre de 200 px', async () => {
          proche(await page.evaluate(MESURE('r')), [160, 46.67, 46.67, 46.67])
          proche(await page.evaluate(MESURE('u')), [200, 200])
        })

        it('height: 100% — la hauteur de la balise (300 px écrits par l\'auteur)', async () => {
          proche(await page.evaluate(MESURE('q')), [300, 93.33, 93.33, 93.33])
        })

        it('sur une balise qui a déjà du texte : la silhouette a sa hauteur, sous le texte', async () => {
          proche(await page.evaluate(MESURE('t')), [90, 23.33, 23.33, 23.33])
        })

        it('un pourcentage sans hauteur écrite sur la balise ne vaut rien : la hauteur des barres', async () => {
          proche(await page.evaluate(MESURE('f')), [62, 14, 14, 14])
        })

        it('une hauteur trop courte pour ses barres : chacune garde 14 px', async () => {
          proche(await page.evaluate(MESURE('m')), [20, 14, 14, 14])
        })

        it('tenu par une variable : la hauteur suit sur place', async () => {
          assert.equal((await page.evaluate(MESURE('v')))[0], 90)
          // la même silhouette, marquée avant le changement : rien n'est reposé
          await page.evaluate(`${BALISE('v')}.querySelector('[mjs-fx-layer="skeleton"]')._marque = 1`)
          await page.evaluate(`document.querySelector('${TAG}')._shadow.querySelector('.plus').click()`)
          await page.waitForFunction(`${BALISE('v')}.querySelector('[mjs-fx-layer="skeleton"]').getBoundingClientRect().height > 95`, null, { timeout: 5000, polling: 20 })
          assert.equal((await page.evaluate(MESURE('v')))[0], 96)
          assert.equal(await page.evaluate(`${BALISE('v')}.querySelector('[mjs-fx-layer="skeleton"]')._marque`), 1, 'la silhouette n\'a pas été reposée')
        })

        it('aucune erreur ni avertissement', () => {
          assert.deepEqual(erreurs, [])
        })
      })
    }
  })
})
