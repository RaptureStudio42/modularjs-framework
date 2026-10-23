// la transition de l'auteur sous *lift (l'aide commune des effets qui prolongent la transition d'une balise), dans les trois moteurs,
// quand ses listes n'ont pas la même longueur — `transition-property: background-color, color` et une seule durée, la forme de
// `transition-colors` de Tailwind. Firefox rend alors `transition` vide dans le style calculé : la transition se recompose depuis ses
// propriétés longues, les listes courtes répétées comme le fait CSS (une courbe `cubic-bezier(…)` garde ses virgules). Rendue au retrait.

import assert from 'node:assert/strict'
import { existsSync, mkdirSync, writeFileSync, readFileSync, readdirSync } from 'node:fs'
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

const STYLE = 'html,body{margin:0;font:16px sans-serif}'
  + '.couleurs{transition-property:background-color,color;transition-duration:.3s}'
  + '.courbe{transition-property:opacity,color;transition-duration:.2s,.4s;transition-timing-function:cubic-bezier(.4,0,.2,1)}'
  + '.delais{transition-property:opacity,color,background-color;transition-duration:.2s;transition-delay:0s,.1s}'
  + '.egales{transition:background-color .3s,color 1s}'

// la balise, l'effet posé puis retiré : les quatre listes calculées
const ATTENDU: Record<string, { pose: string[], retrait: string }> = {
  couleurs: { pose: ['background-color, color, transform, box-shadow', '0.3s, 0.3s, 0.25s, 0.25s', '0s, 0s, 0s, 0s'], retrait: 'background-color, color' },
  courbe:   { pose: ['opacity, color, transform, box-shadow', '0.2s, 0.4s, 0.25s, 0.25s', '0s, 0s, 0s, 0s'], retrait: 'opacity, color' },
  delais:   { pose: ['opacity, color, background-color, transform, box-shadow', '0.2s, 0.2s, 0.2s, 0.25s, 0.25s', '0s, 0.1s, 0s, 0s, 0s'], retrait: 'opacity, color, background-color' },
  egales:   { pose: ['background-color, color, transform, box-shadow', '0.3s, 1s, 0.25s, 0.25s', '0s, 0s, 0s, 0s'], retrait: 'background-color, color' }
}

describe('*lift garde la transition de l\'auteur, même à listes inégales (trois moteurs)', function () {
  this.timeout(600000)
  let script = ''

  before(async () => {
    const root   = mjsTmp('effets-transition-auteur-listes-inegales')
    const srcDir = join(root, 'src')
    const outDir = join(root, 'out')
    mkdirSync(srcDir, { recursive: true })
    writeFileSync(join(srcDir, 'fx-banc.mjs'), '<div *lift>x</div>\n')
    const bundler = new Bundler({ sourceDir: srcDir, outputDir: outDir, manifestPath: join(root, 'bundle.js') })
    const stats   = await bundler.compile()
    await bundler.close()
    assert.equal(stats.errors.length, 0, stats.errors.map((e: any) => e.message).join('\n'))
    const files = readdirSync(outDir).filter((f) => f.endsWith('.js'))
    const rang  = (f: string) => f.startsWith('mjs_core') ? 0 : f.startsWith('mjs_') ? 1 : 2
    script = [...files].sort((a, b) => rang(a) - rang(b) || a.localeCompare(b)).map((f) => stripEsm(readFileSync(join(outDir, f), 'utf-8'))).join('\n') + '\nglobalThis.µ = µ;'
  })

  after(async () => { await terminateSharedWorkerPool() })

  for (const nom of (process.env.NAVIGATEUR ? [process.env.NAVIGATEUR] : ['chromium', 'firefox', 'webkit']) as Navigateur[]) {
    it(nom, async function () {
      if (!(await navigateurPresent(nom))) {
        console.log(`  ℹ️  ${nom} non installé, test sauté. Activer : \`npx playwright install ${nom}\``)
        return this.skip()
      }
      const browser = await (await import('playwright'))[nom].launch()
      try {
        const page    = await (await browser.newContext({ viewport: { width: 600, height: 400 } })).newPage()
        const erreurs: string[] = []
        page.on('pageerror', (e: any) => erreurs.push(String(e.message ?? e)))
        await page.route('http://t.test/**', (route: any) => {
          if (route.request().url() !== 'http://t.test/') return route.fulfill({ status: 404, body: '' })
          return route.fulfill({ contentType: 'text/html', body: `<!doctype html><html><head><meta charset="utf-8"><style>${STYLE}</style></head><body><div id="zone"></div><script>${script}</script></body></html>` })
        })
        await page.goto('http://t.test/', { waitUntil: 'load' })
        const r: any = await page.evaluate((classes: string[]) => {
          const µ    = (window as any).µ
          const zone = document.getElementById('zone')!
          const out: any = {}
          for (const c of classes) {
            zone.insertAdjacentHTML('beforeend', `<button class="${c}">${c}</button>`)
            const el = zone.lastElementChild as HTMLElement
            µ._mjs_fx(null, el, 'lift', {})
            const cs = getComputedStyle(el)
            const pose = [cs.transitionProperty, cs.transitionDuration, cs.transitionDelay, cs.transitionTimingFunction]
            µ._mjs_fxClear(el)
            out[c] = { pose, retrait: getComputedStyle(el).transitionProperty, marque: el.hasAttribute('mjs-fx-tr'), style: el.getAttribute('style') || '' }
          }
          return out
        }, Object.keys(ATTENDU))
        for (const [c, a] of Object.entries(ATTENDU)) {
          assert.deepEqual(r[c].pose.slice(0, 3), a.pose, `${nom} · .${c} : la transition de l'auteur, puis celle de *lift — ${JSON.stringify(r[c])}`)
          assert.equal(r[c].retrait, a.retrait, `${nom} · .${c} : *lift retiré, celle de l'auteur seule — ${JSON.stringify(r[c])}`)
          assert.ok(!r[c].marque && !/--mjs-fx-tr/.test(r[c].style), `${nom} · .${c} : ni marque ni variable laissées — ${JSON.stringify(r[c])}`)
        }
        // la courbe de l'auteur, répétée sur ses deux propriétés, garde ses virgules
        assert.match(r.courbe.pose[3], /^cubic-bezier\(0\.4, 0, 0\.2, 1\), cubic-bezier\(0\.4, 0, 0\.2, 1\), /, `${nom} · .courbe : la courbe de l'auteur — ${JSON.stringify(r.courbe)}`)
        assert.deepEqual(erreurs, [])
      }
      finally {
        await browser.close()
      }
    })
  }
})
