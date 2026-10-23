// fade, fly, scale, blur, rotate et slide dans des navigateurs réels : la transition refaite sur l'enveloppe commune (animations/from.ts, telle
// que le vrai bundler l'embarque) et l'ancienne (tests/snapshots/transitions-temoins.ts) sont jouées sur deux balises identiques, l'horloge
// tenue (les animations sont arrêtées puis placées à des instants choisis) : ce que le navigateur calcule à chacun de ces instants, balise
// contre balise, est le même — opacité, transform, filter, origine, hauteur, remplissage, marges, bordures
// Firefox et WebKit ne sont là que s'ils sont installés (le test est alors sauté)

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readdirSync, readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { mjsTmp } from './helpers/tmp.js'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { stripEsm } from '../src/server/renderToString.js'
import { temoins } from './snapshots/transitions-temoins.js'

type Engine = 'chromium' | 'firefox' | 'webkit'

async function browserPresent(name: Engine): Promise<boolean> {
  try {
    const playwright = await import('playwright')
    return existsSync(playwright[name].executablePath())
  } catch {
    return false
  }
}

// une appli qui écrit les six transitions : le bundler embarque leurs fichiers, et ce qu'ils appellent
const SOURCE = [
  '<script>',
  '$on = true',
  '</script>',
  '{if $on}<p @in=*fade @out=*fly(up)>a</p><p @in=*scale @out=*blur>b</p><p @in=*rotate @out=*slide>c</p>{end}',
  ''
].join('\n')

// la balise jouée : trois mises en forme (nue ; transform, opacité et filtre d'auteur ; boîte avec remplissage, marges et bordures)
const MISES = [
  'width:120px;height:60px;background:#369;color:#fff',
  'width:120px;height:60px;background:#369;color:#fff;opacity:.6;transform:rotate(5deg) translateX(7px);filter:grayscale(1)',
  'width:120px;height:60px;padding:6px 4px 9px 3px;margin:5px 2px 8px 1px;border:3px solid #c33;background:#369;color:#fff;box-sizing:content-box'
]

// des réglages par transition : seuls, puis ensemble ; la durée est longue pour que l'horloge se tienne sans hâte
const REGLAGES: Record<string, any[]> = {
  fade:   [{}, { easing: 'ease-in-out' }, { delay: 30 }],
  fly:    [{ x: '0px', y: '40px' }, { x: '-30px', y: '12.5%', opacity: 0.3, blur: 4, skew: 12, rotate: -90 }, { x: '5em', y: '0px', easing: 'linear' }, { x: '0px', y: '-25px', opacity: 0.5, blur: 7.5 }],
  scale:  [{}, { start: 0.5, origin: '0% 0%' }, { start: 20, axis: 'x', opacity: 0.4 }, { start: 3, axis: 'y', origin: '50% 100%', easing: 'ease-in' }],
  blur:   [{}, { amount: 12, opacity: 0.2 }, { amount: '1em', easing: 'linear' }],
  rotate: [{}, { angle: 90, start: 0.5, origin: '100% 0%' }, { angle: -300, opacity: 0.5, easing: 'ease-out' }],
  slide:  [{}, { axis: 'x' }, { easing: 'linear' }]
}
const INSTANTS = [0, 0.02, 0.04, 0.05, 0.1, 0.25, 1 / 3, 0.5, 0.66, 0.75, 0.9, 0.95, 1]
const GRANDEURS = ['opacity', 'transform', 'filter', 'transformOrigin', 'height', 'width', 'paddingTop', 'paddingBottom', 'paddingLeft', 'paddingRight', 'marginTop', 'marginBottom', 'marginLeft', 'marginRight', 'borderTopWidth', 'borderBottomWidth', 'borderLeftWidth', 'borderRightWidth', 'overflow', 'minHeight', 'minWidth']

describe('fade, fly, scale, blur, rotate, slide : jouées pareil dans les navigateurs réels (horloge tenue)', function () {
  this.timeout(240000)
  let script = ''

  before(async function () {
    const root   = mjsTmp('anim-transitions-meme-rendu-browser')
    const srcDir = join(root, 'src')
    const outDir = join(root, 'out')
    mkdirSync(srcDir, { recursive: true })
    writeFileSync(join(srcDir, 'essai-app.mjs'), SOURCE)
    const bundler = new Bundler({ sourceDir: srcDir, outputDir: outDir, manifestPath: join(root, 'bundle.js') })
    const stats   = await bundler.compile()
    await bundler.close()
    assert.equal(stats.errors.length, 0, stats.errors.map((e: any) => e.message).join('\n'))
    const files = readdirSync(outDir).filter((f) => f.endsWith('.js'))
    const rank  = (f: string) => f.startsWith('mjs_core') ? 0 : f.startsWith('mjs_') ? 1 : 2
    script = [...files].sort((a, b) => rank(a) - rank(b) || a.localeCompare(b)).map((f) => stripEsm(readFileSync(join(outDir, f), 'utf-8'))).join('\n') + '\nglobalThis.µ = µ;'
  })

  after(async () => { await terminateSharedWorkerPool() })

  for (const name of ['chromium', 'firefox', 'webkit'] as const) {
    describe(name, function () {
      let present = false
      let browser: any = null
      let page: any = null
      const errors: string[] = []

      before(async () => {
        present = await browserPresent(name)
        if (!present) {
          console.log(`  ℹ️  ${name} non installé, test des transitions sauté. Activer : \`npx playwright install ${name}\``)
          return
        }
        const playwright = await import('playwright')
        browser = await playwright[name].launch()
        page = await browser.newPage({ viewport: { width: 900, height: 700 } })
        page.on('pageerror', (e: any) => errors.push(String(e.message ?? e)))
        // le compilateur du test pose __name(…) autour des fonctions qu'il envoie à la page : elle doit le connaître
        await page.addInitScript('window.__name = function(f) { return f; };')
        await page.route('http://t.test/**', (route: any) => {
          if (route.request().url() !== 'http://t.test/') return route.fulfill({ status: 404, body: '' })
          return route.fulfill({ contentType: 'text/html', body: `<!doctype html><html><head><meta charset="utf-8"><style>html,body{margin:0}</style></head><body><mjs-essai-app></mjs-essai-app><script>${script}</script></body></html>` })
        })
        await page.goto('http://t.test/', { waitUntil: 'load' })
        await page.waitForFunction(() => typeof (window as any).µ?.anim?.fade === 'function')
        // les anciens témoins, posés à côté des transitions du bundle ; jouer(…) : la même balise jouée avec l'une puis avec l'autre
        const sources: Record<string, string> = {}
        for (const [n, f] of Object.entries(temoins)) sources[n] = f.toString()
        await page.evaluate(({ sources, grandeurs, instants }: any) => {
          const w: any = window
          w.__vieux = {}
          for (const n of Object.keys(sources)) w.__vieux[n] = (0, eval)('(' + sources[n] + ')')(w.µ)
          const attendre = (ms: number) => new Promise((ok) => setTimeout(ok, ms))
          w.__jouer = async (nom: string, opts: any, mise: string, version: 'neuf' | 'vieux') => {
            const hote = document.createElement('div')
            hote.style.cssText = 'position:absolute;left:10px;top:10px;width:400px'
            const el = document.createElement('div')
            el.style.cssText = mise
            el.textContent = 'x'
            hote.appendChild(el)
            document.body.appendChild(hote)
            const paire = (version === 'neuf' ? w.µ.anim[nom] : w.__vieux[nom])({ ...opts, duration: 20000 })
            w.µ._mjs_playTransition(el, paire.intro, 'in')
            // l'animation principale : celle qui porte toutes les images clés
            let anim: any = null
            for (let i = 0; i < 400 && !anim; i++) {
              anim = el.getAnimations().find((a: any) => a.effect && a.effect.getKeyframes().length > 2)
              if (!anim) await attendre(5)
            }
            if (!anim) throw new Error(`${nom} ${version} : aucune animation principale`)
            const retard = anim.effect.getComputedTiming().delay
            anim.pause()
            const total = anim.effect.getComputedTiming().duration
            const out: any[] = []
            for (const quand of instants) {
              anim.currentTime = retard + quand * total
              const cs = getComputedStyle(el)
              const lu: any = {}
              for (const g of grandeurs) lu[g] = (cs as any)[g]
              out.push(lu)
            }
            el.getAnimations().forEach((a: any) => a.cancel())
            hote.remove()
            return { images: anim.effect.getKeyframes().length, out }
          }
        }, { sources, grandeurs: GRANDEURS, instants: INSTANTS })
      })

      after(async () => { if (browser) await browser.close() })

      it('l\'enveloppe commune est embarquée avec les transitions, et la page ne signale aucune erreur', async function () {
        if (!present) { this.skip(); return }
        assert.equal(await page.evaluate(() => typeof (window as any).µ._mjs_animFrom), 'function')
        assert.deepEqual(errors, [])
      })

      for (const nom of Object.keys(REGLAGES)) {
        it(`${nom} : mêmes valeurs calculées à chaque instant, ${REGLAGES[nom].length} réglages × ${MISES.length} balises × ${INSTANTS.length} instants`, async function () {
          if (!present) { this.skip(); return }
          let comparees = 0
          let mouvement = 0
          for (const opts of REGLAGES[nom]) {
            for (const mise of MISES) {
              const neuf  = await page.evaluate(([n, o, m]: any) => (window as any).__jouer(n, o, m, 'neuf'), [nom, opts, mise])
              const vieux = await page.evaluate(([n, o, m]: any) => (window as any).__jouer(n, o, m, 'vieux'), [nom, opts, mise])
              assert.equal(neuf.images, vieux.images, `${nom} ${JSON.stringify(opts)} : le nombre d'images clés`)
              INSTANTS.forEach((quand, i) => {
                for (const g of GRANDEURS) {
                  assert.equal(neuf.out[i][g], vieux.out[i][g], `${nom} ${JSON.stringify(opts)} [${mise}] à ${quand} : ${g}`)
                  comparees++
                }
                if (JSON.stringify(neuf.out[i]) !== JSON.stringify(neuf.out[0])) mouvement++
              })
            }
          }
          // un test qui ne bouge rien ne prouve rien : la balise a changé d'état entre les instants
          assert.ok(mouvement > 0, `${nom} : aucune valeur ne change entre les instants`)
          console.log(`    ${name} ${nom} : ${comparees} valeurs calculées comparées, identiques`)
        })
      }
    })
  }
})
