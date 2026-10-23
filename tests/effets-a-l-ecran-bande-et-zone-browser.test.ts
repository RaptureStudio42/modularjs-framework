// `on: view` dans Chromium et Firefox réels : une balise est vue quand une part (20 %) de ce qu'elle
// peut montrer à la fois est à l'écran — pas seulement 20 % d'elle-même, ni 20 % de la hauteur de
// l'écran. Une bande très large et basse (2 400 × 60 sur un écran de 390 de large) n'en montre jamais
// plus de 16 % : elle est vue dès qu'elle l'est tout entière en hauteur. Un article de 3 000 px dans
// une zone de 150 px qui défile (plus petite que 20 % de l'écran) est vu quand la zone l'est. Les
// témoins : une bande à peine entrée, une zone à peine entrée, une balise de cinq écrans, ne le sont
// pas encore. Ce qu'une balise peut montrer se mesure aux ancêtres qui la rognent VRAIMENT :
//   - par leur rectangle à l'écran, largeur comme hauteur (un rail étroit, un `zoom` qui double la zone) ;
//   - en franchissant la frontière d'un composant (la balise vit dans son shadow root, la zone qui défile
//     est autour du composant) et en remontant par le `<slot>` où un contenu est glissé ;
//   - sans compter l'ancêtre qui ne la contient pas : une balise `position: fixed` ou `absolute` n'est pas
//     rognée par un `overflow: hidden` qui n'est pas son bloc englobant (l'ancêtre positionné, ou transformé
//     pour une balise fixe, la rogne, lui).
// Chaque ancêtre n'est lu qu'une fois par image, pas une fois par balise. Une vraie mise en page est
// nécessaire : pas de happy-dom.

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

const SOURCE = [
  '<div class="bande" id="bande" *stagger>bande haute</div>',
  '<div class="zone"><div class="article" id="article" *stagger>article dans sa zone</div></div>',
  '<div class="vide"></div>',
  '<div class="bande" id="bande-bas" *stagger>bande basse</div>',
  '<div class="vide"></div>',
  '<div class="zone"><div class="article" id="article-bas" *stagger>article dans sa zone basse</div></div>',
  '<div class="vide"></div>',
  '<div class="cinq" id="cinq" *stagger>cinq écrans</div>',
  '<div class="vide"></div>',
  '<div class="etroit" id="etroit"><div class="large" id="large" *stagger>bande large dans un rail étroit</div></div>',
  '<div class="vide"></div>',
  '<div class="zone" id="cadre-hote"><@vue-carte></@vue-carte></div>',
  '<div class="vide"></div>',
  '<div class="zoome" id="cadre-zoom"><div class="zone"><div class="article" id="article-zoom" *stagger>article dans une zone zoomée</div></div></div>',
  '<div class="vide"></div>',
  '<div class="plain" id="cadre-glisse"><@vue-glisse><div class="article" id="tranche" *stagger>article glissé dans un slot</div></@vue-glisse></div>',
  '<div class="vide"></div>',
  '<div class="cache"><div class="fixe" id="fixe" *stagger>fixe hors du rognage</div></div>',
  '<div class="vide"></div>',
  '<div class="cache transforme" id="cadre-transforme"><div class="fixe-dedans" id="fixe-dedans" *stagger>fixe dans son bloc englobant</div></div>',
  '<div class="vide"></div>',
  '<div class="pos" id="cadre-abs"><div class="cache"><div class="abs" id="abs" *stagger>absolue hors du rognage</div></div></div>',
  '<div class="vide"></div>',
  '<div class="mince" id="cadre-mince"><div class="dedans" id="dans-mince" *stagger>balise qui tient dans l\'écran, plus haute que son conteneur</div></div>',
  '<div class="vide"></div>',
  '<div class="zone" id="cadre-memo"></div>',
  '<div class="vide"></div>',
  '<style>',
  '.bande',
  '  width: 2400px',
  '  height: 60px',
  '.zone',
  '  width: 300px',
  '  height: 150px',
  '  overflow: auto',
  '  margin-top: 20px',
  '.article',
  '  height: 3000px',
  '.cinq',
  '  height: 4220px',
  '.vide',
  '  height: 1200px',
  '.etroit',
  '  width: 60px',
  '  overflow-x: auto',
  '  margin-top: 20px',
  '.large',
  '  width: 1800px',
  '  height: 40px',
  '.zoome',
  '  zoom: 2',
  '.plain',
  '  width: 300px',
  '.cache',
  '  overflow: hidden',
  '  width: 200px',
  '  height: 100px',
  '.transforme',
  '  transform: translateX(0)',
  '.fixe',
  '  position: fixed',
  '  top: 744px',
  '  left: 0',
  '  width: 200px',
  '  height: 3000px',
  '.mince',
  '  overflow: hidden',
  '  width: 300px',
  '  height: 100px',
  '.dedans',
  '  height: 600px',
  '.fixe-dedans',
  '  position: fixed',
  '  top: 0',
  '  left: 0',
  '  width: 200px',
  '  height: 3000px',
  '.pos',
  '  position: relative',
  '  overflow: hidden',
  '  width: 300px',
  '  height: 300px',
  '.abs',
  '  position: absolute',
  '  top: 150px',
  '  left: 0',
  '  width: 200px',
  '  height: 1000px',
  '</style>',
].join('\n')

const CARTE = [
  '<div class="art" id="carteart" *stagger>carte</div>',
  '<style>',
  ':host',
  '  display: block',
  '.art',
  '  height: 3000px',
  '</style>',
].join('\n')

const GLISSE = [
  '<div class="gz"><slot></slot></div>',
  '<style>',
  ':host',
  '  display: block',
  '.gz',
  '  height: 150px',
  '  overflow: auto',
  '</style>',
].join('\n')

describe('on: view — une bande très large, une zone qui défile (navigateurs réels)', function () {
  this.timeout(180000)
  let script = ''

  before(async function () {
    if (!(await navigateurPresent('chromium')) && !(await navigateurPresent('firefox'))) return
    const root   = mjsTmp('effets-a-l-ecran-bande-et-zone')
    const srcDir = join(root, 'src')
    const outDir = join(root, 'out')
    mkdirSync(srcDir, { recursive: true })
    writeFileSync(join(srcDir, 'vue-ecran.mjs'), SOURCE)
    writeFileSync(join(srcDir, 'vue-carte.mjs'), CARTE)
    writeFileSync(join(srcDir, 'vue-glisse.mjs'), GLISSE)
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
      let page: any = null

      before(async () => {
        present = await navigateurPresent(nom)
        if (!present) {
          console.log(`  ℹ️  ${nom} non installé, test sauté. Activer : \`npx playwright install ${nom}\``)
          return
        }
        const playwright = await import('playwright')
        browser = await playwright[nom].launch()
        page = await browser.newPage({ viewport: { width: 390, height: 844 } })
        await page.route('http://t.test/**', (route: any) => {
          if (route.request().url() !== 'http://t.test/') return route.fulfill({ status: 404, body: '' })
          return route.fulfill({ contentType: 'text/html', body: `<!doctype html><html><head><meta charset="utf-8"><style>html,body{margin:0}</style></head><body><mjs-vue-ecran></mjs-vue-ecran><script>${script}</script></body></html>` })
        })
        await page.goto('http://t.test/', { waitUntil: 'load' })
        await page.waitForFunction(() => {
          const ecran: any = document.querySelector('mjs-vue-ecran')
          const sh = ecran?._shadow
          return !!sh?.querySelector('#fixe-dedans[mjs-fx]') && !!sh.querySelector('#tranche[mjs-fx]') && !!sh.querySelector('mjs-vue-carte')?._shadow?.querySelector('#carteart[mjs-fx]')
        })
        // la balise d'un id, dans la page ou dans l'un de ses composants
        await page.evaluate(() => {
          (window as any).__trouve = (id: string) => {
            const sh: any = (document.querySelector('mjs-vue-ecran') as any)._shadow
            const direct = sh.querySelector('#' + id)
            if (direct) return direct
            for (const hote of Array.from(sh.querySelectorAll('mjs-vue-carte, mjs-vue-glisse')) as any[]) {
              const dedans = hote._shadow?.querySelector('#' + id)
              if (dedans) return dedans
            }
            return null
          }
        })
      })

      after(async () => { if (browser) await browser.close() })

      // la balise attend encore d'être vue (la marque que pose `on: view`) ?
      const attend = (id: string) => page.evaluate((i: string) => (window as any).__trouve(i).hasAttribute('mjs-fx-wait'), id)

      // l'élément remonté de `reste` px au-dessus du bas de l'écran (une partie `reste` px seulement visible)
      async function montrer(id: string, reste: number) {
        await page.evaluate(([i, r]: [string, number]) => {
          const el: any = (window as any).__trouve(i)
          window.scrollBy(0, el.getBoundingClientRect().top - (window.innerHeight - r))
        }, [id, reste])
        await page.waitForTimeout(250)
      }

      it('une bande de 2 400 × 60 sur un écran de 390 : vue, tout entière en hauteur', async function () {
        if (!present) { this.skip(); return }
        await page.waitForTimeout(250)
        assert.equal(await attend('bande'), false)
      })

      it('un article de 3 000 px dans une zone de 150 px : vu, la zone étant à l\'écran', async function () {
        if (!present) { this.skip(); return }
        assert.equal(await attend('article'), false)
      })

      it('témoin : une bande à peine entrée par le bas de l\'écran n\'est pas encore vue, à 30 px de ses 60 elle l\'est', async function () {
        if (!present) { this.skip(); return }
        await montrer('bande-bas', 5)
        assert.equal(await attend('bande-bas'), true, '5 px sur 60')
        await montrer('bande-bas', 30)
        assert.equal(await attend('bande-bas'), false, '30 px sur 60')
      })

      it('témoin : une zone à peine entrée n\'est pas encore vue, à moitié entrée elle l\'est', async function () {
        if (!present) { this.skip(); return }
        await montrer('article-bas', 12)
        assert.equal(await attend('article-bas'), true, '12 px sur 150')
        await montrer('article-bas', 80)
        assert.equal(await attend('article-bas'), false, '80 px sur 150')
      })

      it('témoin : une balise de cinq écrans à peine entrée n\'est pas vue, couvrant le tiers de l\'écran elle l\'est', async function () {
        if (!present) { this.skip(); return }
        await montrer('cinq', 100)
        assert.equal(await attend('cinq'), true, '100 px sur 4 220, 12 % de l\'écran')
        await montrer('cinq', 300)
        assert.equal(await attend('cinq'), false, '300 px, 36 % de l\'écran')
      })

      it('une bande de 1 800 px dans un rail de 60 px qui défile : la LARGEUR du rail borne ce qu\'elle montre, 20 % du rail suffit', async function () {
        if (!present) { this.skip(); return }
        await montrer('etroit', 5)
        assert.equal(await attend('large'), true, '5 px sur 40 : à peine entrée')
        await montrer('etroit', 30)
        assert.equal(await attend('large'), false, '30 px sur 40 : 60 px de large, loin des 78 px que 20 % de l\'écran exigeraient')
      })

      it('un article de 3 000 px dans un composant posé dans une zone de 150 px qui défile : la frontière du composant est franchie', async function () {
        if (!present) { this.skip(); return }
        await montrer('cadre-hote', 12)
        assert.equal(await attend('carteart'), true, '12 px sur 150 : à peine entrée')
        await montrer('cadre-hote', 80)
        assert.equal(await attend('carteart'), false, '80 px sur 150 : la zone borne ce que l\'article montre')
      })

      it('un article glissé dans le <slot> d\'un composant dont la zone défile : vu, la zone étant à l\'écran', async function () {
        if (!present) { this.skip(); return }
        await montrer('cadre-glisse', 12)
        assert.equal(await attend('tranche'), true, '12 px sur 150 : à peine entrée')
        await montrer('cadre-glisse', 80)
        assert.equal(await attend('tranche'), false, '80 px sur 150 : la zone du slot borne ce que l\'article montre')
      })

      it('un article glissé dans le <slot> d\'un composant à shadow root OUVERT : même règle, par assignedSlot', async function () {
        if (!present) { this.skip(); return }
        await page.evaluate(() => {
          class Glisse extends HTMLElement {
            constructor() {
              super()
              this.attachShadow({ mode: 'open' }).innerHTML = '<div class="gz"><slot></slot></div><style>:host{display:block}.gz{height:150px;overflow:auto}</style>'
            }
          }
          customElements.define('x-glisse-ouvert', Glisse)
          const hote = document.createElement('x-glisse-ouvert')
          const article = document.createElement('div')
          article.id = 'ouvert'
          article.style.height = '3000px'
          article.textContent = 'article'
          hote.appendChild(article)
          document.body.appendChild(hote)
          ;(window as any).µ._mjs_fx(null, article, 'stagger', {})
        })
        const montrerOuvert = async (reste: number) => {
          await page.evaluate((r: number) => {
            const hote = document.querySelector('x-glisse-ouvert') as any
            window.scrollBy(0, hote.getBoundingClientRect().top - (window.innerHeight - r))
          }, reste)
          await page.waitForTimeout(250)
        }
        const attendOuvert = () => page.evaluate(() => (document.getElementById('ouvert') as any).hasAttribute('mjs-fx-wait'))
        await montrerOuvert(12)
        assert.equal(await attendOuvert(), true, '12 px sur 150 : à peine entrée')
        await montrerOuvert(80)
        assert.equal(await attendOuvert(), false, '80 px sur 150 : la zone du slot borne ce que l\'article montre')
      })

      it('un article dans une zone zoomée (zoom: 2) : la part se mesure à la zone vue, pas à sa hauteur avant zoom', async function () {
        if (!present) { this.skip(); return }
        await montrer('cadre-zoom', 40)
        assert.equal(await attend('article-zoom'), true, '40 px sur les 300 que la zone montre à l\'écran : 13 %')
        await montrer('cadre-zoom', 80)
        assert.equal(await attend('article-zoom'), false, '80 px sur 300 : 27 %')
      })

      it('une balise fixe dans un overflow: hidden qui ne la contient pas : ce conteneur ne réduit pas ce qu\'elle peut montrer', async function () {
        if (!present) { this.skip(); return }
        assert.equal(await attend('fixe'), true, '100 px de ses 3 000 en bas de l\'écran : 12 % de l\'écran, pas 100 % de la boîte de 100 px qui ne la rogne pas')
        await page.evaluate(() => { (window as any).__trouve('fixe').style.top = '600px' })
        await page.waitForTimeout(250)
        assert.equal(await attend('fixe'), false, '244 px en bas de l\'écran : 29 % de l\'écran')
      })

      it('une balise fixe dans un ancêtre transformé : cet ancêtre est son bloc englobant, il la rogne', async function () {
        if (!present) { this.skip(); return }
        await montrer('cadre-transforme', 5)
        assert.equal(await attend('fixe-dedans'), true, '5 px sur 100 : à peine entrée')
        await montrer('cadre-transforme', 30)
        assert.equal(await attend('fixe-dedans'), false, '30 px sur 100 : la boîte de 100 px borne ce qu\'elle montre')
      })

      it('une balise absolue : son bloc englobant la rogne, l\'overflow: hidden entre elle et lui ne la rogne pas', async function () {
        if (!present) { this.skip(); return }
        // le bloc englobant (300 px, overflow: hidden) ne lui laisse que 150 px ; la boîte de 100 px entre eux ne compte pas
        await montrer('cadre-abs', 190)
        assert.equal(await attend('abs'), true, '40 px de la balise : 40 sur les 300 du bloc englobant, la boîte de 100 px ne la rogne pas')
        await montrer('cadre-abs', 250)
        assert.equal(await attend('abs'), false, '100 px de la balise : un tiers du bloc englobant, loin des 169 px que 20 % de l\'écran exigeraient')
      })

      // 40 balises d'une même zone : le rognage de chaque ancêtre est lu UNE fois pour toutes, pas une fois
      // par balise ; l'image suivante relit (la zone a changé de taille)
      it('chaque ancêtre est mesuré une fois par image, et relu à l\'image suivante', async function () {
        if (!present) { this.skip(); return }
        const r = await page.evaluate(async () => {
          const w: any = window
          const sh: any = (document.querySelector('mjs-vue-ecran') as any)._shadow
          const zone = sh.querySelector('#cadre-memo')
          const balises: any[] = []
          for (let i = 0; i < 42; i++) {
            const p = document.createElement('p')
            p.textContent = 'x'
            zone.appendChild(p)
            balises.push(p)
          }
          const entree = (p: any, hauteur: number) => ({
            isIntersecting: true, intersectionRatio: 0.01, target: p,
            intersectionRect: { width: 285, height: hauteur }, boundingClientRect: { width: 285, height: 3000 }, rootBounds: { width: 390, height: 844 }
          })
          const orig = w.getComputedStyle
          let lectures = 0
          w.getComputedStyle = function (...a: any[]) { lectures++; return orig.apply(this, a) }
          try {
            for (const p of balises.slice(0, 40)) w.µ._mjs_fxSeen(entree(p, 5), 0.2)
          }
          finally {
            w.getComputedStyle = orig
          }
          // 40 px vus : 11 400 de surface, la zone de 150 px en demande 8 550 (vue) ; agrandie à 400 px, 22 800 (pas vue)
          const avant = w.µ._mjs_fxSeen(entree(balises[40], 40), 0.2)
          zone.style.height = '400px'
          await new Promise((fin) => requestAnimationFrame(() => requestAnimationFrame(fin)))
          const apres = w.µ._mjs_fxSeen(entree(balises[41], 40), 0.2)
          zone.style.height = ''
          return { lectures, avant, apres }
        })
        assert.ok(r.lectures < 80, `${r.lectures} lectures de style pour 40 balises d'une même zone`)
        assert.equal(r.avant, true, 'zone de 150 px : 40 px sur 150, vue')
        assert.equal(r.apres, false, 'zone agrandie à 400 px à l\'image suivante : 40 px sur 400, pas vue')
      })

      // une balise ordinaire qui entre par le bord de l'écran : ce qu'elle montre est tout ce que l'écran en laisse,
      // ses ancêtres ne sont pas lus ; coupée par un conteneur à l'écran, ils le sont
      it('une balise qui tient dans l\'écran et que seul son bord coupe est jugée sans lire ses ancêtres', async function () {
        if (!present) { this.skip(); return }
        const r = await page.evaluate(() => {
          const w: any = window
          const sh: any = (document.querySelector('mjs-vue-ecran') as any)._shadow
          const zone = sh.querySelector('#cadre-memo')
          const p = document.createElement('p')
          p.textContent = 'x'
          zone.appendChild(p)
          const rect = (x: number, y: number, l: number, h: number) => ({ left: x, top: y, right: x + l, bottom: y + h, width: l, height: h })
          const ecran = rect(0, 0, 390, 844)
          // 120 px de haut, ses 44 premiers pixels à l'écran (ratio 0,37 si elle ne tient pas) : seul le bord de l'écran la coupe
          const bord = { isIntersecting: true, intersectionRatio: 0.01, target: p, boundingClientRect: rect(0, 800, 285, 120), intersectionRect: rect(0, 800, 285, 44), rootBounds: ecran }
          // 120 px de haut dont 20 seulement visibles, bien que 100 px soient à l'écran : un conteneur la rogne
          const rognee = { isIntersecting: true, intersectionRatio: 0.01, target: p, boundingClientRect: rect(0, 700, 285, 120), intersectionRect: rect(0, 700, 285, 20), rootBounds: ecran }
          const orig = w.getComputedStyle
          let lectures = 0
          w.getComputedStyle = function (...a: any[]) { lectures++; return orig.apply(this, a) }
          try {
            const seuleLEcran = w.µ._mjs_fxSeen(bord, 0.5)
            const lecturesBord = lectures
            w.µ._mjs_fxSeen(rognee, 0.5)
            return { seuleLEcran, lecturesBord, lecturesRognee: lectures - lecturesBord }
          }
          finally {
            w.getComputedStyle = orig
          }
        })
        assert.equal(r.seuleLEcran, false, '44 px sur 120 : pas encore la moitié')
        assert.equal(r.lecturesBord, 0, 'aucun style lu pour une balise que seul le bord de l\'écran coupe')
        assert.ok(r.lecturesRognee > 0, 'une balise que quelque chose rogne à l\'écran remonte ses ancêtres')
      })

      it('une balise de 600 px qui tient dans l\'écran, dans un conteneur de 100 px qui la rogne : vue quand le conteneur est à l\'écran', async function () {
        if (!present) { this.skip(); return }
        // à 300 px du bas de l'écran le conteneur est entier, 100 px de la balise sont visibles : 17 % d'elle-même
        // (jamais 20 %), 100 % de ce que le conteneur lui laisse
        await montrer('cadre-mince', 300)
        assert.equal(await attend('dans-mince'), false)
      })
    })
  }
})
