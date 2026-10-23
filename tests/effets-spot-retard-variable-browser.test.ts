// *spotlight en production dans Chromium, Firefox et WebKit réels : `smooth` tenu par une variable qui passe sous 1 PENDANT QUE LA SOURIS EST DEHORS, sur une lumière
// toujours allumée (`on: always`). Sans retard (`smooth` à 1), la lumière suit la souris puis rentre au centre à la sortie ; le retard posé ensuite ne doit pas la
// faire repartir de la dernière place suivie : à l'entrée suivante elle naît là où elle est affichée au repos, le centre, et n'en bouge pas si la souris y entre.
// Le halo, le liseré et le voile ont chacun leur lecture de la place de la lumière.

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

const STYLE  = '\n<style>\n:host\n  display: block\n.b\n  width: 300px\n  height: 200px\n  margin: 10px\n.a\n  display: block\n  width: 300px\n  height: 200px\n  background: #fa0\n</style>\n'
const pose   = (mode: string) => `<script>\n$m = 1\n</script>\n<div class="b"><div class="a" *spotlight(where: ${mode}, on: always, smooth: $m)>Un cadre</div></div><button class="lent" @click={$m = .1}>lent</button>` + STYLE
const MODES  = ['fill', 'border', 'veil'] as const

const racine = (tag: string) => `document.querySelector('${tag}')._shadow`
// la place de la lumière dans la balise : le halo (translate du pseudo-élément), le liseré (les deux variables), le disque du voile (décalage du centre, ramené au repère de la balise) ; null au repos
const LUMIERE = (tag: string, mode: string) => ({
  fill:   `(() => { const t = getComputedStyle(${racine(tag)}.querySelector('.a'), '::after').translate; if (t === 'none') return null; const v = t.split(' ').map(parseFloat); return [v[0] || 0, v[1] || 0] })()`,
  border: `(() => { const a = ${racine(tag)}.querySelector('.a'); const x = a.style.getPropertyValue('--mjs-fx-spot-x'); return x ? [parseFloat(x), parseFloat(a.style.getPropertyValue('--mjs-fx-spot-y'))] : null })()`,
  veil:   `(() => { const c = ${racine(tag)}.querySelector('.a').querySelector('[mjs-fx-layer="spotlight"]'); if (!c) return null; const t = getComputedStyle(c.firstChild).translate; if (t === 'none') return null; const v = t.split(' ').map(parseFloat); return [(v[0] || 0) + 150, (v[1] || 0) + 100] })()`
} as Record<string, string>)[mode]

describe('*spotlight toujours allumé : smooth tenu par une variable qui passe sous 1 pendant que la souris est dehors', function () {
  this.timeout(900000)
  const scripts: Record<string, string> = {}

  before(async () => {
    for (const mode of MODES) {
      const root   = mjsTmp('spotlight-retard-variable-' + mode)
      const srcDir = join(root, 'src')
      const outDir = join(root, 'out')
      mkdirSync(srcDir, { recursive: true })
      writeFileSync(join(srcDir, 'v-' + mode + '.mjs'), pose(mode))
      const manifeste = join(outDir, 'bundle.js')
      const bundler   = new Bundler({ sourceDir: srcDir, outputDir: outDir, manifestPath: manifeste, js: 'bundle', env: 'prod' } as any)
      const stats     = await bundler.compile()
      await bundler.close()
      assert.deepEqual(stats.errors.map((e: any) => e.message), [], mode)
      scripts[mode] = stripEsm(readFileSync(manifeste, 'utf-8'))
    }
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

      for (const mode of MODES) {
        const quoi = { fill: 'le halo', border: 'le liseré', veil: 'le voile' }[mode]
        it(`${quoi} : la lumière suivie sans retard, rentrée au repos, puis le retard posé dehors — à l'entrée suivante au centre elle n'en bouge pas`, async function () {
          if (!browser) { this.skip(); return }
          const tag      = 'mjs-v-' + mode
          const contexte = await browser.newContext({ viewport: { width: 400, height: 400 } })
          const page     = await contexte.newPage()
          const erreurs: string[] = []
          page.on('pageerror', (e: any) => erreurs.push(String(e)))
          page.on('console', (m: any) => { if (m.type() === 'error' || (m.type() === 'warning' && m.text().startsWith('[ModularJS]'))) erreurs.push(m.text()) })
          try {
            await page.route('http://t.test/**', (route: any) => {
              if (route.request().url() !== 'http://t.test/') return route.fulfill({ status: 404, body: '' })
              return route.fulfill({ contentType: 'text/html', body: `<!doctype html><html><head><meta charset="utf-8"><style>html,body{margin:0;background:#fff}</style></head><body><${tag}></${tag}><script>${scripts[mode]}</script></body></html>` })
            })
            await page.goto('http://t.test/', { waitUntil: 'load' })
            await page.waitForFunction(`!!${racine(tag)}?.querySelector('.a')?.hasAttribute('mjs-fx')`, null, { timeout: 20000 })
            await page.waitForTimeout(500)
            const b = await page.evaluate(`(() => { const r = ${racine(tag)}.querySelector('.a').getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height } })()`) as { x: number, y: number, w: number, h: number }
            // la souris entre près du coin haut gauche : la lumière la suit (sans retard) ; elle sort : la lumière rentre au centre
            await page.mouse.move(b.x - 5, b.y + 40)
            await page.mouse.move(b.x + 40, b.y + 40, { steps: 1 })
            await page.waitForTimeout(600)
            const suivie = await page.evaluate(LUMIERE(tag, mode)) as number[] | null
            assert.ok(suivie && Math.hypot(suivie[0] - 40, suivie[1] - 40) < 1.5, `la lumière suit la souris au coin (${suivie})`)
            await page.mouse.move(b.x - 5, b.y + 40, { steps: 1 })
            await page.waitForTimeout(600)
            assert.equal(await page.evaluate(LUMIERE(tag, mode)), null, 'la souris dehors, la lumière est au repos, au centre')
            // le retard passe à 0,1 pendant que la souris est dehors, puis la souris rentre d'un trait au centre : un relevé à chaque image
            await page.evaluate(`${racine(tag)}.querySelector('.lent').click()`)
            await page.waitForTimeout(400)
            await page.evaluate(`(() => { const f = window.__film = { v: [], fin: false }; const b = () => { if (f.fin) return; f.v.push(${LUMIERE(tag, mode)}); requestAnimationFrame(b) }; requestAnimationFrame(b) })()`)
            await page.mouse.move(b.x + b.w / 2, b.y + b.h / 2, { steps: 1 })
            await page.waitForTimeout(1500)
            const film = (await page.evaluate('window.__film.fin = true, window.__film.v') as Array<[number, number] | null>).filter((v) => v) as Array<[number, number]>
            assert.ok(film.length >= 10, `la lumière est dessinée sous la souris (${film.length} images)`)
            const ecart = Math.max(...film.map((v) => Math.hypot(v[0] - b.w / 2, v[1] - b.h / 2)))
            assert.ok(ecart <= 1, `la lumière naît au centre, là où elle est affichée au repos, et n'en bouge pas : écart de ${ecart.toFixed(1)} px (premières images : ${film.slice(0, 4).map((v) => v.map((x) => x.toFixed(1)).join(' ')).join(' | ')})`)
            assert.deepEqual(erreurs, [])
          }
          finally {
            await contexte.close()
          }
        })
      }
    })
  }
})
