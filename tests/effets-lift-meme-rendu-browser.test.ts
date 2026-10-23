// *lift dans Chromium et Firefox réels : ce que l'auteur voit ne change pas.
// - au repos, la balise reste telle que l'auteur l'a écrite : ni `isolation`, ni `position`, ni pseudo-élément, ni variable
//   ajoutés. Une carte à bordure en dégradé (un `::before` en `z-index: -1` sous la carte, comme on l'écrit d'ordinaire) garde
//   sa face : un `isolation: isolate` posé par l'effet la recouvrirait en entier ;
// - soulevée, l'ombre est celle de la balise (`box-shadow`, qui se transite avec la montée), comme avant.

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readdirSync, readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { mjsTmp } from './helpers/tmp.js'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { stripEsm } from '../src/server/renderToString.js'

async function navigateurPresent(nom: 'chromium' | 'firefox'): Promise<boolean> {
  try {
    const playwright = await import('playwright')
    return existsSync(playwright[nom].executablePath())
  } catch {
    return false
  }
}

const SOURCES: Record<string, string> = {
  'lmr-scene.mjs': `<div class="s">
<div class="g" *lift><p>Carte à bordure dégradée</p></div>
<div class="k" *lift(height: 12, color: rgba(10,20,200,.5), blur: 20)>Carte simple</div>
<div class="p" *lift(on: always, press: true, blur: 0)>Touche</div>
</div>
<style>
.s
  position: relative
  z-index: 0
  padding: 60px
  background: #223
.g
  position: relative
  width: 240px
  height: 100px
  margin: 40px 0
  padding: 10px
  border-radius: 12px
  background: #fff
  color: #000
.g::before
  content: ''
  position: absolute
  inset: -4px
  z-index: -1
  border-radius: 16px
  background: linear-gradient(90deg, #f0f, #0ff)
.k
  width: 240px
  height: 60px
  margin: 40px 0
  background: #345
  color: #fff
.p
  width: 160px
  height: 40px
  margin: 40px 0
  background: #b45309
  color: #fff
</style>
`
}

describe('*lift (navigateurs réels) — au repos rien ne change pour l\'auteur, soulevée l\'ombre est celle de la balise', function () {
  this.timeout(240000)
  let script = ''

  before(async function () {
    if (!(await navigateurPresent('chromium')) && !(await navigateurPresent('firefox'))) return
    const root   = mjsTmp('effets-lift-meme-rendu')
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
    script = [...files].sort((a, b) => rang(a) - rang(b) || a.localeCompare(b)).map((f) => stripEsm(readFileSync(join(outDir, f), 'utf-8'))).join('\n') + '\nglobalThis.µ = µ;'
  })

  after(async () => { await terminateSharedWorkerPool() })

  for (const nom of ['chromium', 'firefox'] as const) {
    describe(nom, function () {
      let present = false
      let browser: any = null

      before(async function () {
        present = await navigateurPresent(nom)
        if (!present) {
          console.log(`  ℹ️  ${nom} non installé, test sauté. Activer : \`npx playwright install ${nom}\``)
          return
        }
        const playwright = await import('playwright')
        browser = await playwright[nom].launch()
      })

      after(async () => { if (browser) await browser.close() })

      async function avec<T>(fn: (page: any) => Promise<T>): Promise<T> {
        const page = await browser.newPage({ viewport: { width: 800, height: 900 } })
        try {
          await page.route('http://t.test/**', (route: any) => {
            if (route.request().url() !== 'http://t.test/') return route.fulfill({ status: 404, body: '' })
            return route.fulfill({ contentType: 'text/html', body: `<!doctype html><html><head><meta charset="utf-8"><style>html,body{margin:0}</style></head><body><mjs-lmr-scene></mjs-lmr-scene><script>${script}</script></body></html>` })
          })
          await page.goto('http://t.test/', { waitUntil: 'load' })
          await page.waitForFunction(() => !!(document.querySelector('mjs-lmr-scene') as any)?._shadow?.querySelector('.p[mjs-fx]'))
          await page.waitForTimeout(300)
          return await fn(page)
        }
        finally {
          await page.close()
        }
      }

      const rect = (page: any, c: string) => page.evaluate((c: string) => { const r = (document.querySelector('mjs-lmr-scene') as any)._shadow.querySelector('.' + c).getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height } }, c)
      // ce que la balise montre : sa disposition, son ombre, ce qui s'y ajoute
      const etat = (page: any, c: string) => page.evaluate((c: string) => {
        const el = (document.querySelector('mjs-lmr-scene') as any)._shadow.querySelector('.' + c)
        const cs = getComputedStyle(el)
        return {
          isolation: cs.isolation, position: cs.position, ombre: cs.boxShadow, propriete: cs.transitionProperty,
          apres: getComputedStyle(el, '::after').content, avant: getComputedStyle(el, '::before').content,
          style: el.getAttribute('style') || '', marques: el.getAttributeNames().filter((a: string) => a.startsWith('mjs-fx-lift'))
        }
      }, c)
      // la couleur d'un pixel de la page (x, y)
      const pixel = (page: any, x: number, y: number) => page.screenshot({ clip: { x, y, width: 1, height: 1 } }).then((b: Buffer) => page.evaluate(async (s: string) => {
        const bmp = await createImageBitmap(await (await fetch('data:image/png;base64,' + s)).blob())
        const c = new OffscreenCanvas(1, 1)
        const g = c.getContext('2d') as OffscreenCanvasRenderingContext2D
        g.drawImage(bmp, 0, 0)
        return Array.from(g.getImageData(0, 0, 1, 1).data).slice(0, 3)
      }, b.toString('base64')))

      it('une carte à bordure en dégradé garde sa face au repos : sa balise n\'est ni isolée ni déplacée, et le dégradé de dessous ne la recouvre pas', async function () {
        if (!present) { this.skip(); return }
        await avec(async (page) => {
          const e = await etat(page, 'g')
          assert.equal(e.isolation, 'auto', 'au repos : aucune isolation posée par l\'effet')
          assert.equal(e.position, 'relative', 'sa position est celle que l\'auteur a écrite')
          assert.deepEqual(e.marques, [], 'aucune marque de calque')
          const r = await rect(page, 'g')
          // le centre de la carte est blanc (sa face) : le dégradé du ::before (z-index: -1) reste dessous, visible seulement dans les 4 px du bord
          const centre = await pixel(page, r.x + r.w / 2, r.y + r.h - 6)
          assert.deepEqual(centre, [255, 255, 255], 'la face de la carte est blanche, non recouverte par le dégradé')
          const bord = await pixel(page, r.x - 2, r.y + r.h / 2)
          assert.ok(bord[0] > 200 && bord[1] < 100, 'le dégradé se voit dans le bord de 4 px (' + bord.join(',') + ')')
        })
      })

      it('une balise statique ne change pas de position ni d\'isolation, ne gagne ni pseudo-élément ni variable, au repos', async function () {
        if (!present) { this.skip(); return }
        await avec(async (page) => {
          const e = await etat(page, 'k')
          assert.equal(e.position, 'static', 'toujours statique')
          assert.equal(e.isolation, 'auto')
          assert.ok(e.apres === 'none' || e.apres === 'normal', '::after : ' + e.apres)
          assert.ok(e.avant === 'none' || e.avant === 'normal', '::before : ' + e.avant)
          // seule la transition (celle de l'auteur, puis la sienne) s'écrit sur la balise, jamais une variable de lift
          assert.ok(!/(^|;)\s*--mjs-fx-lift/.test(e.style), 'style : ' + e.style)
          assert.deepEqual(e.marques, [])
        })
      })

      it('soulevée, l\'ombre est celle de la balise et se transite avec la montée, comme avant', async function () {
        if (!present) { this.skip(); return }
        await avec(async (page) => {
          const r = await rect(page, 'k')
          await page.mouse.move(r.x + r.w / 2, r.y + r.h / 2, { steps: 4 })
          await page.waitForTimeout(700)
          const e = await etat(page, 'k')
          assert.equal(e.ombre, 'rgba(10, 20, 200, 0.5) 0px 18px 20px 0px', 'l\'ombre soulevée est sur la balise')
          assert.ok(/box-shadow/.test(e.propriete) && /transform/.test(e.propriete), 'la balise transite sa montée et son ombre : ' + e.propriete)
          assert.equal(e.isolation, 'auto')
          assert.equal(e.position, 'static', 'même soulevée, la position est celle de l\'auteur')
          await page.mouse.move(700, 800, { steps: 4 })
          await page.waitForTimeout(700)
          assert.equal((await etat(page, 'k')).ombre, 'none', 'retour à plat : plus d\'ombre')
        })
      })

      it('l\'appui resserre l\'ombre de la balise elle-même', async function () {
        if (!present) { this.skip(); return }
        await avec(async (page) => {
          const r = await rect(page, 'p')
          await page.mouse.move(r.x + r.w / 2, r.y + r.h / 2, { steps: 3 })
          await page.mouse.down()
          await page.waitForTimeout(500)
          const bas = await etat(page, 'p')
          await page.mouse.up()
          assert.equal(bas.ombre, 'rgba(0, 0, 0, 0.45) 0px 4px 0px 0px', 'l\'ombre resserrée (décalage de 4 px, flou 0) est sur la balise')
          assert.equal(bas.isolation, 'auto')
          assert.equal(bas.position, 'static')
        })
      })
    })
  }
})
