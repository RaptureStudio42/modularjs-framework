// *blend dans Chromium, Firefox et WebKit réels : le moteur est reconnu par un signe que l'agent d'utilisateur
// d'une émulation ne change pas. Un Chromium qui se donne l'agent de Safari reste Chromium, un WebKit qui se
// donne celui de Chrome reste WebKit, un Firefox qui se donne l'un ou l'autre reste Firefox : le filtre de
// chaque balise (unités, bornes, région, masque) est le même sous trois agents. Les bornes se disent en px dans
// Chromium et Firefox (le repère de Firefox part du pixel CSS entier : à densité 2 et position fractionnaire, la
// boîte y est décalée), en fractions de la boîte dans WebKit (voir effets-fusion-browser.test.ts).

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readdirSync, readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { mjsTmp } from './helpers/tmp.js'
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

const SAFARI_IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1'
const CHROME_LINUX  = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36'
const AGENTS: [string, string | undefined][] = [['agent d\'origine', undefined], ['agent de Safari sur iPhone', SAFARI_IPHONE], ['agent de Chrome', CHROME_LINUX]]

const BLEND = '*blend(multiply, color: #ff0000, order: under)'
// quatre balises à filtre : une boîte à position et taille fractionnaires, une boîte à coins arrondis, un <svg> racine
// à viewBox, un <canvas> (balise sans contenu)
const SOURCE = [
  `<div class="a" ${BLEND}></div>`,
  `<div class="b" ${BLEND}></div>`,
  `<svg class="c" width="100" height="60" viewBox="0 0 50 30" *blend(multiply, color: #ff0000)><rect width="50" height="30" fill="#b4b4b4"></rect></svg>`,
  `<canvas class="d" width="100" height="60" *blend(multiply, color: #ff0000)></canvas>`,
  '<style>',
  'div, svg, canvas',
  '  position: absolute',
  '  top: 20.25px',
  '.a',
  '  left: 20.25px',
  '  width: 100.5px',
  '  height: 60.5px',
  '  background: #b4b4b4',
  '.b',
  '  left: 200.25px',
  '  width: 100px',
  '  height: 60px',
  '  border-radius: 10px',
  '  background: #b4b4b4',
  '.c',
  '  left: 400px',
  '.d',
  '  left: 550px',
  '</style>',
  ''
].join('\n')
const CLASSES = ['a', 'b', 'c', 'd']

for (const nom of ['chromium', 'firefox', 'webkit'] as const) {
  describe(`*blend (${nom} réel) — le moteur se reconnaît à un signe que l'agent d'utilisateur ne change pas`, function () {
    this.timeout(180000)
    let present = false
    let script  = ''

    before(async function () {
      present = await navigateurPresent(nom)
      if (!present) {
        console.log(`  ℹ️  ${nom} non installé, test des moteurs de *blend sauté. Activer : \`npx playwright install ${nom}\``)
        return
      }
      const root   = mjsTmp('effets-fusion-moteurs-' + nom)
      const srcDir = join(root, 'src')
      const outDir = join(root, 'out')
      mkdirSync(srcDir, { recursive: true })
      writeFileSync(join(srcDir, 'fb-moteurs.mjs'), SOURCE)
      const bundler = new Bundler({ sourceDir: srcDir, outputDir: outDir, manifestPath: join(root, 'bundle.js') })
      const stats   = await bundler.compile()
      await bundler.close()
      assert.equal(stats.errors.length, 0, stats.errors.map((e: any) => e.message).join('\n'))
      const files = readdirSync(outDir).filter((f) => f.endsWith('.js'))
      const rang  = (f: string) => f.startsWith('mjs_core') ? 0 : f.startsWith('mjs_') ? 1 : 2
      script = [...files].sort((a, b) => rang(a) - rang(b) || a.localeCompare(b)).map((f) => stripEsm(readFileSync(join(outDir, f), 'utf-8'))).join('\n') + '\nglobalThis.µ = µ;'
    })

    after(async () => { await terminateSharedWorkerPool() })

    // le filtre de chaque balise tel que le moteur l'a écrit : ses attributs et ses primitives, sans son numéro
    async function filtres(browser: any, ua: string | undefined): Promise<Record<string, any>> {
      const contexte = await browser.newContext({ viewport: { width: 700, height: 200 }, deviceScaleFactor: 2, ...(ua ? { userAgent: ua } : {}) })
      try {
        const page = await contexte.newPage()
        await page.route('http://t.test/**', (route: any) => {
          if (route.request().url() !== 'http://t.test/') return route.fulfill({ status: 404, body: '' })
          return route.fulfill({ contentType: 'text/html', body: `<!doctype html><html><head><meta charset="utf-8"><style>html,body{margin:0;background:#fff}</style></head><body><mjs-fb-moteurs></mjs-fb-moteurs><script>${script}</script></body></html>` })
        })
        await page.goto('http://t.test/', { waitUntil: 'load' })
        await page.waitForFunction(() => !!(document.querySelector('mjs-fb-moteurs') as any)?._shadow?.querySelector('.d'))
        await page.waitForTimeout(700)
        return await page.evaluate((classes: string[]) => {
          const sh = (document.querySelector('mjs-fb-moteurs') as any)._shadow
          const out: Record<string, any> = {}
          for (const c of classes) {
            const id = /#([^)]+)\)/.exec(sh.querySelector('.' + c).style.getPropertyValue('--mjs-fx-blend-filter'))?.[1]
            const f = sh.querySelector('#' + id)
            out[c] = { unites: f.getAttribute('primitiveUnits'), balisage: f.outerHTML.replace(/mjs-fx-blend-\d+/g, 'F') }
          }
          return out
        }, CLASSES)
      } finally {
        await contexte.close()
      }
    }

    it('le même filtre, balise par balise, sous l\'agent d\'origine, celui de Safari sur iPhone et celui de Chrome', async function () {
      if (!present) { this.skip(); return }
      const lanceur = (await import('playwright'))[nom]
      const browser = await lanceur.launch()
      try {
        const fautes: string[] = []
        let reference: Record<string, any> | null = null
        for (const [libelle, ua] of AGENTS) {
          const f = await filtres(browser, ua)
          if (!reference) {
            reference = f
            // le moteur d'origine : fractions de la boîte dans WebKit (un <svg> racine : unités de son viewBox), px dans les autres ; les unités sont toujours posées
            for (const c of CLASSES) {
              const attendu = nom === 'webkit' && c !== 'c' ? 'objectBoundingBox' : 'userSpaceOnUse'
              if (f[c].unites !== attendu) fautes.push(`${libelle} : .${c} a des unités « ${f[c].unites} », attendu « ${attendu} »`)
            }
          }
          else for (const c of CLASSES) if (f[c].balisage !== reference[c].balisage) fautes.push(`${libelle} : le filtre de .${c} n'est plus celui de l'agent d'origine\n  origine : ${reference[c].balisage.slice(0, 260)}\n  ${libelle} : ${f[c].balisage.slice(0, 260)}`)
        }
        assert.deepEqual(fautes, [], fautes.join('\n'))
      } finally {
        await browser.close()
      }
    })
  })
}
