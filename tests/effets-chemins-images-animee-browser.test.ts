// un GIF animé passé à <@@img> (la même résolution que µimage et que les réglages d'image des effets) garde son animation
// dans Chromium et Firefox réels quand `sharp` fabrique les variantes : l'image que le navigateur choisit dans le srcset
// change d'aspect au fil du temps (rouge, vert, bleu), elle n'est pas figée sur la première image. Sauté sans `sharp`.

import assert from 'node:assert/strict'
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { join, basename, extname } from 'node:path'
import { mjsTmp } from './helpers/tmp.js'
import { gifAnime } from './helpers/gif-anime.js'
import { resolveSharp } from '../src/bundler/image.js'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { stripEsm } from '../src/server/renderToString.js'

async function navigateurPresent(nom: 'chromium' | 'firefox' | 'webkit'): Promise<boolean> {
  try {
    const playwright = await import('playwright')
    return existsSync(playwright[nom].executablePath())
  } catch {
    return false
  }
}

const TYPES: Record<string, string> = { '.gif': 'image/gif', '.webp': 'image/webp', '.js': 'text/javascript' }

describe('une image animée passée à <@@img> — elle s\'anime dans le navigateur', function () {
  this.timeout(240000)
  let outDir = ''
  let script = ''
  let sharp: any = null

  before(async function () {
    sharp = await resolveSharp()
    if (!sharp) {
      console.log('  ℹ️  sharp non installé, tests sautés (npm i -D sharp).')
      return this.skip()
    }
    const root   = mjsTmp('chemins-images-animee-navigateur')
    const srcDir = join(root, 'src')
    outDir       = join(root, 'out')
    mkdirSync(srcDir, { recursive: true })
    writeFileSync(join(srcDir, 'anim.gif'), gifAnime(3, 64, 64, 10))
    writeFileSync(join(srcDir, 'a.mjs'), '<@@img src="anim.gif" alt="essai"></@@img>')
    const bundler = new Bundler({ sourceDir: srcDir, outputDir: outDir, manifestPath: join(root, 'bundle.js'), image: { widths: [32, 64], formats: ['webp'] } } as any)
    const stats   = await bundler.compile()
    await bundler.close()
    assert.deepEqual(stats.errors.map((e: any) => String(e.message)), [])
    const rang = (f: string) => f.startsWith('mjs_core') ? 0 : f.startsWith('mjs_') ? 1 : 2
    script = readdirSync(outDir).filter((f) => f.endsWith('.js')).sort((a, b) => rang(a) - rang(b) || a.localeCompare(b)).map((f) => stripEsm(readFileSync(join(outDir, f), 'utf-8'))).join('\n')
  })

  after(async () => { await terminateSharedWorkerPool() })

  for (const nom of ['chromium', 'firefox'] as const) describe(nom, function () {
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

    it('l\'image affichée est la variante publiée et elle change d\'aspect : elle n\'est pas figée sur sa première image', async function () {
      if (!present) return this.skip()
      const page = await browser.newPage({ viewport: { width: 1000, height: 800 } })
      try {
        await page.route('http://t.test/**', (route: any) => {
          const chemin = new URL(route.request().url()).pathname
          if (chemin === '/') return route.fulfill({ contentType: 'text/html', body: `<!doctype html><html><head><meta charset="utf-8"><style>html,body{margin:0}</style></head><body><mjs-a></mjs-a><script>${script}</script></body></html>` })
          const fichier = join(outDir, basename(chemin))
          if (!existsSync(fichier)) return route.fulfill({ status: 404, body: '' })
          return route.fulfill({ contentType: TYPES[extname(fichier)] ?? 'application/octet-stream', body: readFileSync(fichier) })
        })
        await page.goto('http://t.test/', { waitUntil: 'load' })
        await page.waitForFunction(() => { const i = (document.querySelector('mjs-a') as any)?._shadow?.querySelector('mjs-core-img')?._shadow?.querySelector('img'); return !!i && i.complete && i.naturalWidth > 0 })
        const boite = await page.evaluate(() => {
          const img = (document.querySelector('mjs-a') as any)._shadow.querySelector('mjs-core-img')._shadow.querySelector('img') as HTMLImageElement
          const r   = img.getBoundingClientRect()
          return { x: r.x, y: r.y, width: r.width, height: r.height, src: img.currentSrc }
        })
        assert.match(boite.src, /\/anim-64-[0-9a-f]{8}\.webp$/, 'le navigateur affiche la variante la plus large')
        // ce que l'écran montre, pas ce que le canvas relit : douze captures de l'image, une toutes les 70 ms ; une image animée en change
        const captures = new Set<string>()
        for (let k = 0; k < 12; k++) {
          captures.add((await page.screenshot({ clip: { x: boite.x, y: boite.y, width: boite.width, height: boite.height } })).toString('base64'))
          await page.waitForTimeout(70)
        }
        assert.ok(captures.size >= 2, `l'image reste figée : ${captures.size} aspect sur 12 captures`)
      }
      finally {
        await page.close()
      }
    })
  })
})
