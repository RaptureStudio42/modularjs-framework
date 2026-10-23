// *spotlight en production dans Chromium, Firefox et WebKit réels : le voile de la page entière (`<@document>`), toujours allumé avec un retard, quand la
// FENÊTRE CHANGE DE TAILLE PENDANT QUE LA LUMIÈRE RENTRE AU CENTRE EN GLISSANT. La cible du retour est le centre d'aujourd'hui : la lumière arrive
// sur lui sans saut (au plus 1 px d'écart à la dernière image avant l'arrivée), que la fenêtre devienne plus large ou plus étroite ; la hauteur seule
// ne change rien (le garde) sur une page dont `<html>` garde sa hauteur, mais sur une page haute comme la fenêtre (`body { min-height: 100vh }`) l'observateur de
// taille de `<html>` appelle `size()` : la cible du retour, verticale cette fois, suit elle aussi le centre d'aujourd'hui.

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { mjsTmp } from './helpers/tmp.js'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { stripEsm } from '../src/server/renderToString.js'

type Navigateur = 'chromium' | 'firefox' | 'webkit'

async function navigateurPresent(nom: Navigateur): Promise<boolean> {
  try {
    const playwright = await import('playwright')
    return existsSync(playwright[nom].executablePath())
  } catch {
    return false
  }
}

const SOURCE = '<div class="b">Un cadre</div>\n<@document *spotlight(where: veil, on: always, smooth: .15)>\n<style>\n:host\n  display: block\n.b\n  width: 300px\n  height: 200px\n  margin: 10px\n  background: #fa0\n</style>\n'

// le calque du voile de la page (posé dans `<body>`) et la place de son disque (le `translate` du disque, relatif au centre du calque)
const CALQUE   = `document.body.querySelector('[mjs-fx-layer="spotlight"]')`
const DISQUE   = `(() => { const c = ${CALQUE}; if (!c) return null; const t = getComputedStyle(c.firstChild).translate; const v = t === 'none' ? [] : t.split(' ').map(parseFloat); return [v[0] || 0, v[1] || 0] })()`
const AU_REPOS = `(() => { const c = ${CALQUE}; return !!c && getComputedStyle(c.firstChild).translate === 'none' })()`

// un relevé à chaque image de la place du disque
const FILM = `(() => { const f = window.__film = { v: [], fin: false }; const b = () => { if (f.fin) return; f.v.push(${DISQUE}); requestAnimationFrame(b) }; requestAnimationFrame(b) })()`
const FINI = '(() => { window.__film.fin = true; return window.__film.v })()'

describe('*spotlight, voile de la page entière, toujours allumé avec un retard : la fenêtre change de taille pendant que la lumière rentre au centre', function () {
  this.timeout(900000)
  let script = ''

  before(async () => {
    const root   = mjsTmp('spotlight-redim-glisse')
    const srcDir = join(root, 'src')
    const outDir = join(root, 'out')
    mkdirSync(srcDir, { recursive: true })
    writeFileSync(join(srcDir, 'g-page.mjs'), SOURCE)
    // un seul fichier (le manifeste) : la pose est celle d'une application de production
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

      before(async function () {
        if (!(await navigateurPresent(nom))) {
          console.log(`  ℹ️  ${nom} non installé, test sauté. Activer : \`npx playwright install ${nom}\``)
          return this.skip()
        }
        browser = await (await import('playwright'))[nom].launch()
      })

      after(async () => { await browser?.close() })

      for (const [titre, largeur, hauteur, style] of [
        ['la fenêtre devient plus large (340 → 400 de large)', 400, 300, ''],
        ['la fenêtre devient plus étroite (340 → 300 de large)', 300, 300, ''],
        ['la hauteur seule change (340 × 300 → 340 × 250) — le garde', 340, 250, ''],
        ['la hauteur seule change sur une page haute comme la fenêtre (body { min-height: 100vh }, 340 × 300 → 340 × 250)', 340, 250, 'body{min-height:100vh}']
      ] as const) {
        it(`${titre} pendant que la lumière rentre au centre en glissant : elle arrive sur le centre d'aujourd'hui, sans saut`, async function () {
          if (!browser) { this.skip(); return }
          const contexte = await browser.newContext({ viewport: { width: 340, height: 300 } })
          const page     = await contexte.newPage()
          const erreurs: string[] = []
          page.on('pageerror', (e: any) => erreurs.push(String(e)))
          page.on('console', (m: any) => { if (m.type() === 'error' || (m.type() === 'warning' && m.text().startsWith('[ModularJS]'))) erreurs.push(m.text()) })
          try {
            await page.route('http://t.test/**', (route: any) => {
              if (route.request().url() !== 'http://t.test/') return route.fulfill({ status: 404, body: '' })
              return route.fulfill({ contentType: 'text/html', body: `<!doctype html><html><head><meta charset="utf-8"><style>html,body{margin:0;background:#fff}${style}</style></head><body><mjs-g-page></mjs-g-page><script>${script}</script></body></html>` })
            })
            await page.goto('http://t.test/', { waitUntil: 'load' })
            await page.waitForFunction(`!!${CALQUE}`, null, { timeout: 20000 })
            await page.waitForTimeout(400)
            // la lumière suit la souris jusqu'au coin haut droit (130, -120 du centre), puis la souris sort : elle rentre au centre en glissant
            await page.mouse.move(170, 150, { steps: 1 })
            await page.waitForFunction(`!${AU_REPOS}`, null, { timeout: 10000 })
            await page.mouse.move(300, 30, { steps: 2 })
            await page.waitForFunction(`(() => { const t = ${DISQUE}; return !!t && Math.abs(t[0] - 130) < 0.6 && Math.abs(t[1] + 120) < 0.6 })()`, null, { timeout: 10000 })
            await page.evaluate(FILM)
            await page.evaluate(`document.documentElement.dispatchEvent(new PointerEvent('pointerleave'))`)
            await page.waitForTimeout(120)
            // la fenêtre change de taille alors que la lumière est encore loin du centre
            await page.setViewportSize({ width: largeur, height: hauteur })
            await page.waitForFunction(`document.documentElement.clientWidth === ${largeur} && document.documentElement.clientHeight === ${hauteur}`, null, { timeout: 10000 })
            await page.waitForFunction(AU_REPOS, null, { timeout: 10000 })
            await page.waitForTimeout(300)
            const film = (await page.evaluate(FINI) as Array<[number, number] | null>).filter((v) => v) as Array<[number, number]>
            const decalees = film.filter((v) => v[0] !== 0 || v[1] !== 0)
            // sous charge, un navigateur dessine peu d'images pendant que la fenêtre change de taille (9 vues dans Firefox à charge 48) : le glissement dure le même temps
            assert.ok(decalees.length >= 3, `la lumière a glissé sur plusieurs images (${decalees.length})`)
            const derniere = decalees[decalees.length - 1]
            const ecart    = Math.hypot(derniere[0], derniere[1])
            assert.ok(ecart <= 1, `la dernière place avant l'arrivée est à ${ecart.toFixed(1)} px du centre d'aujourd'hui (${derniere.map((x) => x.toFixed(1)).join(' ')}) : la lumière sauterait à l'arrivée`)
            assert.deepEqual(film[film.length - 1], [0, 0], 'à l\'arrivée, la lumière est au repos, au centre')
            assert.deepEqual(erreurs, [])
          }
          finally {
            await contexte.close()
          }
        })
      }

      it('la souris est dessus et la lumière glisse vers elle quand la fenêtre change de largeur : elle rejoint la souris, non le centre', async function () {
        if (!browser) { this.skip(); return }
        const contexte = await browser.newContext({ viewport: { width: 340, height: 300 } })
        const page     = await contexte.newPage()
        const erreurs: string[] = []
        page.on('pageerror', (e: any) => erreurs.push(String(e)))
        try {
          await page.route('http://t.test/**', (route: any) => {
            if (route.request().url() !== 'http://t.test/') return route.fulfill({ status: 404, body: '' })
            return route.fulfill({ contentType: 'text/html', body: `<!doctype html><html><head><meta charset="utf-8"><style>html,body{margin:0;background:#fff}</style></head><body><mjs-g-page></mjs-g-page><script>${script}</script></body></html>` })
          })
          await page.goto('http://t.test/', { waitUntil: 'load' })
          await page.waitForFunction(`!!${CALQUE}`, null, { timeout: 20000 })
          await page.waitForTimeout(400)
          await page.mouse.move(170, 150, { steps: 1 })
          await page.waitForFunction(`!${AU_REPOS}`, null, { timeout: 10000 })
          // la souris part vers le coin haut droit : la lumière glisse vers elle, la fenêtre s'élargit en route
          await page.mouse.move(300, 30, { steps: 1 })
          await page.waitForTimeout(60)
          const loin = await page.evaluate(DISQUE) as number[]
          assert.ok(Math.hypot(loin[0] - 130, loin[1] + 120) > 5, `la lumière glisse encore vers la souris (${loin.map((x) => x.toFixed(1)).join(' ')})`)
          await page.setViewportSize({ width: 400, height: 300 })
          // la souris reste à (300, 30) : le centre d'aujourd'hui est à 200, la lumière finit à (100, -120) de lui ; on la laisse finir de glisser
          await page.waitForFunction(`document.documentElement.clientWidth === 400`, null, { timeout: 10000 })
          await page.waitForTimeout(2500)
          const fin = await page.evaluate(DISQUE) as number[]
          assert.ok(Math.hypot(fin[0] - 100, fin[1] + 120) <= 1, `la lumière rejoint la souris, non le centre (${fin.map((x) => x.toFixed(1)).join(' ')} au lieu de 100.0 -120.0)`)
          assert.deepEqual(erreurs, [])
        }
        finally {
          await contexte.close()
        }
      })
    })
  }
})
