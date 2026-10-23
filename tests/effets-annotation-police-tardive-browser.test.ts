// *annotate dans Chromium, Firefox et WebKit réels : une police web qui arrive après la pose (demandée par
// le mot lui-même, ou `font-family` changé vers une police qui se charge) élargit ou rétrécit le mot sans
// que rien d'autre ne bouge — le trait est redessiné sur le mot tel qu'il est. WebKit n'émet jamais
// `loadingdone` sur `document.fonts` : il émet `loading`, puis résout `ready` ; les deux autres moteurs
// émettent les deux. Les polices sont servies par le test (deux fichiers du système, en retard sur
// demande). Le recalage (une police plus large, puis plus étroite), le repos (aucune mesure, aucune
// minuterie sans événement) et le retrait (aucun écouteur de `document.fonts` ne reste, et une police qui
// arrive ensuite ne réveille rien). WebKit est sauté quand il est absent :
// `PLAYWRIGHT_BROWSERS_PATH=<dossier qui l'a>` ou `npx playwright install webkit`.

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readdirSync, readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { mjsTmp } from './helpers/tmp.js'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { stripEsm } from '../src/server/renderToString.js'

type Moteur = 'chromium' | 'firefox' | 'webkit'

async function navigateurPresent(nom: Moteur): Promise<boolean> {
  try {
    const playwright = await import('playwright')
    return existsSync(playwright[nom].executablePath())
  } catch {
    return false
  }
}

// deux polices du système, servies à la page en @font-face : une large et une étroite ; aucune n'est
// utilisée avant que le test la demande
const POLICES: Record<string, string> = {
  'large.ttf':   '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',
  'etroite.ttf': '/usr/share/fonts/truetype/ubuntu/Ubuntu-C.ttf'
}

// la police du mot vient de `--pf-police` (posée sur la page avant la pose) ; un `font-family` en ligne la
// remplace ensuite. Le bouton `.t` pose l'effet (ou le retire).
const TAG    = 'mjs-pf-trait'
const SOURCE = '<script>\n$on = false\n</script>\n<button class="t" @click={$on = !$on}>t</button>\n<p class="p1">Au début, {if $on}<span class="x" *annotate(on: load, duration: 0s)>un mot important à souligner</span>{end} puis la fin.</p>\n<style>\n.p1\n  font: 24px sans-serif\n  width: 800px\n  height: 100px\n  margin: 20px\n.x\n  font-family: var(--pf-police, sans-serif)\n</style>\n'

// ce que la page montre du mot : sa largeur, sa boîte (gauche, droite) et celle de son trait ; `charge` dit si la police est arrivée
const LIRE = ([police]: string[]) => {
  const x: any  = (document.querySelector('mjs-pf-trait') as any)._shadow.querySelector('.x')
  const r       = x.getBoundingClientRect()
  const chemins = Array.from(x.querySelectorAll('svg[mjs-fx-layer="annotate"] path')) as any[]
  const e       = chemins.map((p) => p.getBoundingClientRect())
  return { charge: document.fonts.check('24px ' + police), largeur: r.width, mot: [r.left, r.right], trait: e.length ? [Math.min(...e.map((q) => q.left)), Math.max(...e.map((q) => q.right))] : null }
}

// le trait couvre le mot, d'un bout à l'autre, à 8 px près (le tracé déborde un peu et tremble)
const juste = (v: any) => !!v.trait && Math.abs(v.trait[0] - v.mot[0]) <= 8 && Math.abs(v.trait[1] - v.mot[1]) <= 8

// le registre des écouteurs posés sur `document.fonts`, tenu depuis le début de la page
const ESPIONNE_POLICES = () => {
  const f: any = document.fonts
  const reg    = new Map<string, Set<any>>()
  const ajoute = f.addEventListener.bind(f)
  const retire = f.removeEventListener.bind(f)
  f.addEventListener = function(type: string, fn: any, o: any) {
    if (!reg.has(type)) reg.set(type, new Set())
    reg.get(type)!.add(fn)
    return ajoute(type, fn, o)
  }
  f.removeEventListener = function(type: string, fn: any, o: any) {
    if (reg.has(type)) reg.get(type)!.delete(fn)
    return retire(type, fn, o)
  }
  ;(window as any).__ecouteurs = () => {
    const out: Record<string, number> = {}
    reg.forEach((s, t) => { if (s.size) out[t] = s.size })
    return out
  }
}

// le compte des mesures de mise en page et des minuteries, remis à zéro à chaque appel
const ESPIONNE_MESURES = () => {
  const w: any = window
  w.__mesures = { rect: 0, rects: 0, range: 0, intervalle: 0, image: 0 }
  if (w.__espions) return
  w.__espions = true
  const enveloppe = (proto: any, nom: string, cle: string) => {
    const o = proto[nom]
    proto[nom] = function(...a: any[]) {
      w.__mesures[cle]++
      return o.apply(this, a)
    }
  }
  enveloppe(Element.prototype, 'getBoundingClientRect', 'rect')
  enveloppe(Element.prototype, 'getClientRects', 'rects')
  enveloppe(Range.prototype, 'getBoundingClientRect', 'range')
  enveloppe(window, 'setInterval', 'intervalle')
  enveloppe(window, 'requestAnimationFrame', 'image')
}
const AUCUNE_MESURE = { rect: 0, rects: 0, range: 0, intervalle: 0, image: 0 }

const dort = (ms: number) => new Promise((r) => setTimeout(r, ms))

// relit `lire` jusqu'à ce que `ok` soit vrai (au plus `ms`) ; rend la dernière lecture dans tous les cas
async function jusque(lire: () => Promise<any>, ok: (v: any) => boolean, ms = 4000) {
  const fin = Date.now() + ms
  let v     = await lire()
  while (!ok(v) && Date.now() < fin) {
    await dort(60)
    v = await lire()
  }
  return v
}

describe('*annotate et une police qui arrive tard (navigateurs réels)', function () {
  this.timeout(240000)
  let script = ''

  before(async function () {
    if (!(await navigateurPresent('chromium')) && !(await navigateurPresent('firefox')) && !(await navigateurPresent('webkit'))) return
    const root   = mjsTmp('effets-annotation-police-tardive')
    const srcDir = join(root, 'src')
    const outDir = join(root, 'out')
    mkdirSync(srcDir, { recursive: true })
    writeFileSync(join(srcDir, 'pf-trait.mjs'), SOURCE)
    const bundler = new Bundler({ sourceDir: srcDir, outputDir: outDir, manifestPath: join(root, 'bundle.js') })
    const stats   = await bundler.compile()
    await bundler.close()
    assert.equal(stats.errors.length, 0, stats.errors.map((e: any) => e.message).join('\n'))
    const files = readdirSync(outDir).filter((f) => f.endsWith('.js'))
    const rang  = (f: string) => f.startsWith('mjs_core') ? 0 : f.startsWith('mjs_') ? 1 : 2
    script = [...files].sort((a, b) => rang(a) - rang(b) || a.localeCompare(b)).map((f) => stripEsm(readFileSync(join(outDir, f), 'utf-8'))).join('\n') + '\nglobalThis.µ = µ;'
  })

  after(async () => { await terminateSharedWorkerPool() })

  for (const nom of ['chromium', 'firefox', 'webkit'] as const) {
    describe(nom, function () {
      let present = false
      let browser: any = null

      before(async function () {
        present = await navigateurPresent(nom)
        if (!present) {
          console.log(`  ℹ️  ${nom} non installé, test sauté. Activer : \`npx playwright install ${nom}\``)
          return
        }
        const manque = Object.values(POLICES).filter((f) => !existsSync(f))
        if (manque.length) {
          present = false
          console.log(`  ℹ️  police absente du système (${manque.join(', ')}), test sauté`)
          return
        }
        const playwright = await import('playwright')
        browser = await playwright[nom].launch()
      })

      after(async () => { if (browser) await browser.close() })

      // une page neuve : les polices servies (en retard de `retard.ms`), le registre des écouteurs de `document.fonts`
      async function essai(fn: (page: any, retard: { ms: number }) => Promise<void>) {
        const retard = { ms: 400 }
        const page   = await browser.newPage({ viewport: { width: 900, height: 400 } })
        try {
          await page.addInitScript(ESPIONNE_POLICES)
          await page.route('http://t.test/**', async (route: any) => {
            const url     = route.request().url()
            const fichier = url.replace('http://t.test/', '')
            if (POLICES[fichier]) {
              await dort(retard.ms)
              try {
                await route.fulfill({ contentType: 'font/ttf', body: readFileSync(POLICES[fichier]) })
              } catch {
                // page fermée entre-temps
              }
              return
            }
            if (url !== 'http://t.test/') return route.fulfill({ status: 404, body: '' })
            return route.fulfill({ contentType: 'text/html', body: `<!doctype html><html><head><meta charset="utf-8"><style>@font-face{font-family:Large;src:url(/large.ttf)}@font-face{font-family:Etroite;src:url(/etroite.ttf)}html,body{margin:0;background:#fff}</style></head><body><${TAG}></${TAG}><script>${script}</script></body></html>` })
          })
          await page.goto('http://t.test/', { waitUntil: 'load' })
          await page.waitForFunction((t: string) => !!(document.querySelector(t) as any)?._shadow?.querySelector('.t'), TAG)
          await fn(page, retard)
        }
        finally {
          await page.close()
        }
      }

      // le bouton `.t` : pose l'effet, ou le retire
      const bascule    = (page: any) => page.evaluate((t: string) => (document.querySelector(t) as any)._shadow.querySelector('.t').click(), TAG)
      const attendPose = (page: any) => page.waitForFunction((t: string) => !!(document.querySelector(t) as any)._shadow.querySelector('.x svg[mjs-fx-layer="annotate"] path'), TAG)
      const lit        = (page: any, police: string) => page.evaluate(LIRE, [police])

      it('*annotate : une police arrivée après la pose (celle du mot, puis un font-family changé) redessine le trait sur le mot', async function () {
        if (!present) { this.skip(); return }
        await essai(async (page) => {
          // le mot demande sa police dès la pose : elle arrive 400 ms plus tard
          await page.evaluate((p: string) => document.documentElement.style.setProperty('--pf-police', p), 'Large')
          await bascule(page)
          await attendPose(page)
          const avant = await lit(page, 'Large')
          const v1    = await jusque(() => lit(page, 'Large'), (v) => v.charge && juste(v))
          assert.ok(v1.charge, `la police Large est arrivée : ${JSON.stringify(v1)}`)
          assert.ok(juste(v1), `le trait couvre le mot en Large : ${JSON.stringify(v1)}`)
          // la police était bien en route à la pose : la largeur d'alors n'est pas celle d'après
          if (!avant.charge) assert.ok(Math.abs(v1.largeur - avant.largeur) > 12, `Large change la largeur du mot : ${JSON.stringify(avant)}`)
          // un font-family changé vers une police qui se charge
          await page.evaluate((t: string) => { ((document.querySelector(t) as any)._shadow.querySelector('.x') as any).style.fontFamily = 'Etroite' }, TAG)
          const v2 = await jusque(() => lit(page, 'Etroite'), (v) => v.charge && juste(v))
          assert.ok(v2.charge, `la police Etroite est arrivée : ${JSON.stringify(v2)}`)
          assert.ok(juste(v2), `le trait couvre le mot en Etroite : ${JSON.stringify(v2)} (avant : ${JSON.stringify(v1)})`)
          assert.ok(Math.abs(v2.largeur - v1.largeur) > 12, `Etroite change la largeur du mot : ${JSON.stringify(v2)} / ${JSON.stringify(v1)}`)
        })
      })

      it('*annotate : au repos, une fois la police arrivée, aucune mesure ni minuterie', async function () {
        if (!present) { this.skip(); return }
        await essai(async (page) => {
          await page.evaluate((p: string) => document.documentElement.style.setProperty('--pf-police', p), 'Large')
          await bascule(page)
          await attendPose(page)
          await jusque(() => lit(page, 'Large'), (v) => v.charge && juste(v))
          await dort(900)
          await page.evaluate(ESPIONNE_MESURES)
          await dort(900)
          assert.deepEqual(await page.evaluate(() => (window as any).__mesures), AUCUNE_MESURE, 'rien ne se mesure ni ne tourne au repos')
        })
      })

      it('*annotate : retiré, aucun écouteur de document.fonts ne reste, et une police qui arrive ensuite ne réveille rien', async function () {
        if (!present) { this.skip(); return }
        await essai(async (page, retard) => {
          const ecouteurs = () => page.evaluate(() => (window as any).__ecouteurs())
          const avant     = await ecouteurs()
          await bascule(page)
          await attendPose(page)
          const pose = await ecouteurs()
          assert.notDeepEqual(pose, avant, `l'effet écoute document.fonts : ${JSON.stringify(pose)}`)
          // une police en route (demandée à la main, en retard de 2,5 s) quand l'effet est retiré
          retard.ms = 2500
          await page.evaluate((t: string) => {
            const w: any = window
            w.__tenu     = (document.querySelector(t) as any)._shadow.querySelector('.x')
            w.__en_route = document.fonts.load('24px Etroite')
          }, TAG)
          await dort(100)
          await bascule(page)
          await page.waitForFunction((t: string) => !(document.querySelector(t) as any)._shadow.querySelector('.x'), TAG)
          assert.deepEqual(await ecouteurs(), avant, 'après le retrait, aucun écouteur de document.fonts ne reste')
          await page.evaluate(ESPIONNE_MESURES)
          // la police arrive, l'effet n'est plus là : aucune mesure, aucune marque reposée sur le mot retiré
          await page.evaluate(async () => { await (window as any).__en_route; await document.fonts.ready })
          await dort(600)
          assert.deepEqual(await page.evaluate(() => (window as any).__mesures), AUCUNE_MESURE, 'la police arrivée après le retrait ne déclenche aucune mesure')
          const reste = await page.evaluate(() => {
            const el: any = (window as any).__tenu
            return { marques: Array.from(el.attributes).map((a: any) => a.name).filter((n: string) => n.startsWith('mjs-fx')), calques: el.querySelectorAll('svg').length }
          })
          assert.deepEqual(reste, { marques: [], calques: 0 }, 'le mot retiré n\'a rien repris')
        })
      })
    })
  }
})
