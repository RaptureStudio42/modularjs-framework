// *sticky dans Chromium, Firefox et WebKit réels : rien de la mise en page n'est lu pendant les images d'animation, et les
// variables que la barre figée pose sur elle-même ne sont pas héritées. La barre figée dans une boîte qui défile relit la
// ligne de la boîte dans l'événement de défilement (jamais dans une image d'animation) à chaque événement qui peut la
// déplacer : le défilement de la boîte elle-même (une image qui se charge au-dessus pendant le geste), de la page ou de ce
// qui contient la boîte, et le redimensionnement de la fenêtre ; pas celui d'un autre élément. Le maximum du défilement
// se garde : il n'est pas relu à chaque événement. Un trace compte les lectures faites PENDANT un rappel d'image
// (boîtes, styles calculés, tailles) : il en faut zéro pendant que la boîte puis la page défilent, barre figée ou cachée.
// Une variable enregistrée sans héritage ne relit que la barre quand on l'écrit, pas ses six descendants.

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

const BARRE = '\n.barre\n  display: flex\n  justify-content: space-between\n  align-items: center\n  height: 64px\n  padding: 0 16px\n  background: #cde\n.barre[mjs-fx-on~=sticky]\n  background: #fff\n'
const BOITE = '.titre\n  margin: 0\n  height: 40px\n.scene\n  height: 360px\n  overflow: auto\n.reste\n  height: 1800px\n.apres\n  height: 3000px\n'
const barre = (fx: string) => `<header class="barre" ${fx}><b>Logo</b><a class="lien" href="#un"><i>Un</i></a></header>`
const boite = (fx: string) => `<h3 class="titre"></h3>\n<div class="scene">${barre(fx)}<div class="reste"></div></div>\n<div class="apres"></div>\n<style>${BARRE}${BOITE}</style>\n`

const TEXTE = 'Un paragraphe assez long pour tenir sur plusieurs lignes quand la fenêtre se rétrécit : la boîte qui défile en dessous descend.'
const PLUS  = '.texte\n  margin: 0\n  font: 20px/28px sans-serif\n.dedans\n  height: 300px\n  overflow: auto\n.autre\n  height: 80px\n  overflow: auto\n.long\n  height: 3000px\n'
// la boîte qui tient la barre est elle-même dans une boîte qui défile
const nid   = (fx: string) => `<h3 class="titre"></h3>\n<div class="scene"><div class="dedans">${barre(fx)}<div class="reste"></div></div><div class="reste"></div></div>\n<div class="apres"></div>\n<style>${BARRE}${BOITE}${PLUS}</style>\n`
// un texte au-dessus de la boîte (sa hauteur suit la largeur de la fenêtre) et un autre élément qui défile, à côté
const texte = (fx: string) => `<p class="texte">${TEXTE}</p>\n<div class="scene">${barre(fx)}<div class="reste"></div></div>\n<div class="autre"><div class="long"></div></div>\n<div class="apres"></div>\n<style>${BARRE}${BOITE}${PLUS}</style>\n`

const SOURCES: Record<string, string> = {
  'gpu-boite-cache.mjs': boite('*sticky(hide: true)'),
  'gpu-boite.mjs':       boite('*sticky(200)'),
  'gpu-nid.mjs':         nid('*sticky(200)'),
  'gpu-texte.mjs':       texte('*sticky(200)')
}

// ce que la page compte : les lectures de mise en page faites PENDANT un rappel d'image d'animation
const COMPTEURS = () => {
  const w = window as any
  w.__enImage  = 0
  w.__lectures = 0
  w.__detail   = {}
  const ra = w.requestAnimationFrame.bind(w)
  w.requestAnimationFrame = (f: any) => ra((t: number) => { w.__enImage++; try { return f(t) } finally { w.__enImage-- } })
  // `__vu(nom, cible)` : un test y met sa propre oreille (qui lit quoi, hors des images aussi)
  const note = (nom: string, cible: any) => {
    if (w.__enImage > 0) { w.__lectures++; w.__detail[nom] = (w.__detail[nom] || 0) + 1 }
    if (w.__vu) w.__vu(nom, cible)
  }
  const surveille = (cible: any, nom: string) => {
    for (let o = cible; o; o = Object.getPrototypeOf(o)) {
      const d = Object.getOwnPropertyDescriptor(o, nom)
      if (!d) continue
      if (d.get) Object.defineProperty(o, nom, { ...d, get() { note(nom, this); return d.get!.call(this) } })
      else if (typeof d.value === 'function') Object.defineProperty(o, nom, { ...d, value: function (this: any, ...a: any[]) { note(nom, this); return d.value.apply(this, a) } })
      return
    }
  }
  for (const n of ['getBoundingClientRect', 'getClientRects', 'scrollTop', 'scrollLeft', 'scrollHeight', 'scrollWidth', 'clientHeight', 'clientWidth', 'clientTop', 'clientLeft', 'offsetWidth', 'offsetHeight', 'offsetTop', 'offsetLeft']) surveille(Element.prototype, n)
  for (const n of ['getComputedStyle', 'scrollY', 'scrollX', 'pageYOffset', 'pageXOffset', 'innerHeight', 'innerWidth']) surveille(w, n)
  w.__trouve = (sel: string) => {
    const marche = (racine: any): any => {
      const hit = racine.querySelector(sel)
      if (hit) return hit
      for (const n of racine.querySelectorAll('*')) {
        if (n._shadow) { const h = marche(n._shadow); if (h) return h }
      }
      return null
    }
    return marche(document)
  }
}

const attendre = (ms: number) => new Promise((r) => setTimeout(r, ms))

async function jusqua<T>(lire: () => Promise<T>, bon: (v: T) => boolean, ms = 4000): Promise<T> {
  const fin = Date.now() + ms
  let v = await lire()
  while (!bon(v) && Date.now() < fin) {
    await attendre(50)
    v = await lire()
  }
  return v
}

describe('*sticky (navigateurs réels) — aucune lecture de la mise en page dans les images, variables sans héritage', function () {
  this.timeout(240000)
  let script = ''

  before(async function () {
    if (!(await navigateurPresent('chromium')) && !(await navigateurPresent('firefox')) && !(await navigateurPresent('webkit'))) return
    const root   = mjsTmp('effets-sticky-gpu')
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
        const playwright = await import('playwright')
        browser = await playwright[nom].launch()
      })

      after(async () => { if (browser) await browser.close() })

      async function avec<T>(tag: string, fn: (page: any) => Promise<T>): Promise<T> {
        const page = await browser.newPage({ viewport: { width: 1000, height: 800 } })
        const erreurs: string[] = []
        page.on('pageerror', (e: any) => erreurs.push(String(e.message ?? e)))
        try {
          await page.addInitScript(COMPTEURS)
          await page.route('http://t.test/**', (route: any) => {
            if (route.request().url() !== 'http://t.test/') return route.fulfill({ status: 404, body: '' })
            return route.fulfill({ contentType: 'text/html', body: `<!doctype html><html><head><meta charset="utf-8"><style>html,body{margin:0}</style></head><body><${tag}></${tag}><script>${script}</script></body></html>` })
          })
          await page.goto('http://t.test/', { waitUntil: 'load' })
          await page.waitForFunction(() => !!(window as any).__trouve('[mjs-fx~="sticky"]'))
          await page.waitForTimeout(300)
          const rendu = await fn(page)
          assert.deepEqual(erreurs, [], 'aucune erreur de page')
          return rendu
        }
        finally {
          await page.close()
        }
      }

      const etat = (page: any) => page.evaluate(() => {
        const b = (window as any).__trouve('.barre')
        return { on: b.getAttribute('mjs-fx-on'), cache: b.getAttribute('mjs-fx-sticky'), haut: b.getBoundingClientRect().top }
      })
      const boiteA = (page: any, y: number) => page.evaluate((v: number) => { (window as any).__trouve('.scene').scrollTop = v }, y)
      const pageA = (page: any, y: number) => page.evaluate((v: number) => scrollTo(0, v), y)
      const lectures = (page: any) => page.evaluate(() => ({ n: (window as any).__lectures, detail: (window as any).__detail }))
      const remet = (page: any) => page.evaluate(() => { (window as any).__lectures = 0; (window as any).__detail = {} })

      it('avec hide, dans la boîte : la barre se fige, se cache en descendant et revient en remontant, sans lire la mise en page dans les images', async function () {
        if (!present) { this.skip(); return }
        await avec('mjs-gpu-boite-cache', async (page) => {
          await boiteA(page, 500)
          assert.equal((await jusqua(() => etat(page), (e: any) => e.on === 'sticky')).on, 'sticky', 'figée')
          await page.waitForTimeout(600)
          await remet(page)
          const vus: string[] = []
          for (const y of [540, 600, 700, 800]) { await boiteA(page, y); await page.waitForTimeout(250) }
          vus.push(String((await etat(page)).cache))
          for (const y of [700, 600, 500, 400]) { await boiteA(page, y); await page.waitForTimeout(250) }
          vus.push(String((await etat(page)).cache))
          const r = await lectures(page)
          assert.deepEqual(vus, ['hidden', 'null'], 'cachée en descendant, revenue en remontant')
          assert.equal(r.n, 0, `lectures de la mise en page dans les rappels d'image : ${JSON.stringify(r.detail)}`)
        })
      })

      it('sans hide, dans la boîte : la boîte puis la page défilent, la barre suit la boîte, sans lire la mise en page dans les images', async function () {
        if (!present) { this.skip(); return }
        await avec('mjs-gpu-boite', async (page) => {
          await boiteA(page, 500)
          assert.equal((await jusqua(() => etat(page), (e: any) => e.on === 'sticky')).on, 'sticky', 'figée')
          await page.waitForTimeout(600)
          await remet(page)
          for (const y of [540, 700, 900, 600]) { await boiteA(page, y); await page.waitForTimeout(250) }
          const bas = await page.evaluate(() => (window as any).__trouve('.scene').getBoundingClientRect().top)
          for (const y of [30, 55, 20]) { await pageA(page, y); await page.waitForTimeout(250) }
          const r = await lectures(page)
          const e = await etat(page)
          const haut = await page.evaluate(() => (window as any).__trouve('.scene').getBoundingClientRect().top)
          assert.ok(haut < bas - 15, `la page a défilé (la boîte est passée de ${bas} à ${haut})`)
          assert.ok(Math.abs(e.haut - (haut + 1)) < 1.5, `la barre est restée en haut de la boîte : ${e.haut} pour une boîte à ${haut}`)
          assert.equal(r.n, 0, `lectures de la mise en page dans les rappels d'image : ${JSON.stringify(r.detail)}`)
        })
      })

      it('les variables --mjs-fx-sticky-* sont enregistrées sans héritage : la barre les porte, ses descendants ne les voient pas', async function () {
        if (!present) { this.skip(); return }
        await avec('mjs-gpu-boite', async (page) => {
          if (!(await page.evaluate(() => typeof (window as any).CSS?.registerProperty === 'function'))) { this.skip(); return }
          await boiteA(page, 500)
          assert.equal((await jusqua(() => etat(page), (e: any) => e.on === 'sticky')).on, 'sticky', 'figée')
          const r = await page.evaluate(() => {
            const b = (window as any).__trouve('.barre')
            const enfant = b.querySelector('i')
            const lire = (n: any, k: string) => getComputedStyle(n).getPropertyValue('--mjs-fx-sticky-' + k).trim()
            return ['x', 'y', 'w', 'from'].map((k) => ({ k, barre: lire(b, k), enfant: lire(enfant, k) }))
          })
          for (const v of r) {
            assert.notEqual(v.barre, '', `la barre porte --mjs-fx-sticky-${v.k}`)
            assert.equal(v.enfant, '', `--mjs-fx-sticky-${v.k} n'est pas héritée par les descendants de la barre (vue : « ${v.enfant} »)`)
          }
        })
      })

      // l'écart entre le haut de la barre et le haut de la boîte qui la tient (0 : collée à son bord)
      const ecart = (page: any, boite: string) => page.evaluate((b: string) => {
        const w = window as any
        return Math.round((w.__trouve('.barre').getBoundingClientRect().top - w.__trouve(b).getBoundingClientRect().top) * 10) / 10
      }, boite)
      const figee = async (page: any) => {
        assert.equal((await jusqua(() => etat(page), (e: any) => e.on === 'sticky')).on, 'sticky', 'figée')
        await page.waitForTimeout(600)
      }

      it('la mise en page bouge au-dessus de la boîte PENDANT un geste dans la boîte (une image qui se charge) : la barre garde le bord de la boîte dès les images suivantes', async function () {
        if (!present) { this.skip(); return }
        await avec('mjs-gpu-boite', async (page) => {
          await boiteA(page, 600)
          await figee(page)
          // une image par rappel : la boîte descend de 100 px à la 6e image, le geste (+8 px par image) ne s'arrête pas
          const vus: number[] = await page.evaluate(() => new Promise<number[]>((ok) => {
            const w = window as any
            const scene = w.__trouve('.scene')
            const barre = w.__trouve('.barre')
            const ecarts: number[] = []
            let k = 0
            const image = () => {
              ecarts.push(Math.round((barre.getBoundingClientRect().top - scene.getBoundingClientRect().top) * 10) / 10)
              if (k === 6) w.__trouve('.titre').style.height = '140px'
              if (k >= 18) { ok(ecarts); return }
              k++
              scene.scrollTop += 8
              requestAnimationFrame(image)
            }
            requestAnimationFrame(image)
          }))
          assert.ok(Math.abs(vus[2]) < 1, `avant le décalage, la barre est au bord de la boîte : ${vus[2]}`)
          // le décalage est lu dès l'événement de défilement de l'image qui suit : trois images de marge pour une machine chargée
          for (const [k, e] of vus.entries()) {
            if (k >= 10) assert.ok(Math.abs(e - vus[2]) < 1, `image ${k} : la barre est à ${e} px du bord de la boîte (écarts relevés : ${JSON.stringify(vus)})`)
          }
        })
      })

      it('la boîte qui tient la barre est dans une autre boîte qui défile : quand celle-ci défile, la barre garde le bord de sa boîte', async function () {
        if (!present) { this.skip(); return }
        await avec('mjs-gpu-nid', async (page) => {
          await page.evaluate(() => { (window as any).__trouve('.dedans').scrollTop = 600 })
          await figee(page)
          const avant = await ecart(page, '.dedans')
          const haut0 = await page.evaluate(() => (window as any).__trouve('.dedans').getBoundingClientRect().top)
          for (const y of [60, 150, 100]) { await boiteA(page, y); await page.waitForTimeout(250) }
          const haut1 = await page.evaluate(() => (window as any).__trouve('.dedans').getBoundingClientRect().top)
          assert.ok(haut0 - haut1 > 80, `la boîte extérieure a défilé : la boîte intérieure est passée de ${haut0} à ${haut1}`)
          assert.ok(Math.abs((await ecart(page, '.dedans')) - avant) < 1, `la barre est restée au bord de sa boîte : ${await ecart(page, '.dedans')} px (${avant} avant)`)
        })
      })

      it('la fenêtre se redimensionne et le texte au-dessus de la boîte change de hauteur : la barre garde le bord de la boîte', async function () {
        if (!present) { this.skip(); return }
        await avec('mjs-gpu-texte', async (page) => {
          await boiteA(page, 600)
          await figee(page)
          const avant = await ecart(page, '.scene')
          const haut0 = await page.evaluate(() => (window as any).__trouve('.scene').getBoundingClientRect().top)
          await page.setViewportSize({ width: 360, height: 800 })
          const haut1 = await jusqua(() => page.evaluate(() => (window as any).__trouve('.scene').getBoundingClientRect().top), (h: number) => h > haut0 + 40)
          assert.ok(haut1 > haut0 + 40, `le texte a pris des lignes : la boîte est passée de ${haut0} à ${haut1}`)
          await page.waitForTimeout(300)
          assert.ok(Math.abs((await ecart(page, '.scene')) - avant) < 1, `la barre est restée au bord de la boîte : ${await ecart(page, '.scene')} px (${avant} avant)`)
        })
      })

      it('un autre élément défile dans la page (ni la boîte, ni ce qui la contient) : la boîte n\'est pas relue', async function () {
        if (!present) { this.skip(); return }
        await avec('mjs-gpu-texte', async (page) => {
          await boiteA(page, 600)
          await figee(page)
          await page.evaluate(() => {
            const w = window as any
            const scene = w.__trouve('.scene')
            w.__rects = 0
            w.__vu = (nom: string, cible: any) => { if (nom === 'getBoundingClientRect' && cible === scene) w.__rects++ }
          })
          const rects = () => page.evaluate(() => (window as any).__rects)
          for (const y of [100, 300, 600, 200]) {
            await page.evaluate((v: number) => { (window as any).__trouve('.autre').scrollTop = v }, y)
            await page.waitForTimeout(120)
          }
          assert.equal(await rects(), 0, 'le défilement d\'un autre élément ne relit pas la boîte')
          // témoin : le défilement de la boîte, lui, la relit
          await boiteA(page, 640)
          await page.waitForTimeout(200)
          assert.ok((await rects()) > 0, 'le défilement de la boîte relit sa place')
        })
      })

      it('hide, dans la boîte : le maximum du défilement se garde, il n\'est pas relu à chaque événement', async function () {
        if (!present) { this.skip(); return }
        await avec('mjs-gpu-boite-cache', async (page) => {
          await boiteA(page, 500)
          await figee(page)
          // un premier mouvement relit le maximum une fois (la mise en page de la figeaison l'a remis à zéro) ; ensuite il se garde
          await boiteA(page, 505)
          await page.waitForTimeout(200)
          await page.evaluate(() => {
            const w = window as any
            const scene = w.__trouve('.scene')
            w.__hauteurs = 0
            w.__vu = (nom: string, cible: any) => { if ((nom === 'scrollHeight' || nom === 'clientHeight') && cible === scene) w.__hauteurs++ }
          })
          for (const y of [510, 520, 540, 560, 600, 580]) { await boiteA(page, y); await page.waitForTimeout(100) }
          assert.equal(await page.evaluate(() => (window as any).__hauteurs), 0, 'ni la hauteur du contenu ni celle de la boîte ne sont relues pendant le geste')
        })
      })
    })
  }
})
