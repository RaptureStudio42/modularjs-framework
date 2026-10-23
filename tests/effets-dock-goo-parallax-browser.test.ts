// *dock, *goo(drip) et *parallax dans Chromium, Firefox et WebKit réels : une vraie mise en page est
// nécessaire (happy-dom ne mesure rien).
// *dock : la plus grosse icône est celle sous la souris quand la barre est réduite par un parent
// (transform: scale(.5), zoom: .5), quand elle défile (scrollLeft, scrollTop), en rangée comme en
// colonne, positionnée et bordée ou non, d'icônes <i> ou <svg> ; une icône ajoutée, retirée ou
// remplacée pendant le survol compte aussitôt.
// *goo(drip) : il coule tant que ses gouttes se voient (la balise un peu sous l'écran), et ne fait
// rien quand elle est loin. *parallax : un conteneur devenu défilable après la pose est pris
// (défilement nul = décalage nul), un conteneur intérieur devenu défilable prend la place de
// l'extérieur, une enveloppe qui ne défile pas laisse la page animer la couche. Rien ne tourne au
// repos : ni image d'animation, ni minuterie.
// WebKit n'est présent que si PLAYWRIGHT_BROWSERS_PATH le donne (le test est alors sauté).

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

const icones = (n: number) => '<i></i>'.repeat(n)
const svgs   = (n: number) => '<svg width="48" height="48" viewBox="0 0 48 48"><rect width="48" height="48" fill="#888"></rect></svg>'.repeat(n)
// la barre : des icônes de 48 px côte à côte, 60 px de marge au-dessus et au-dessous
const BARRE  = '\nnav\n  display: flex\n  margin: 60px 40px\n  i, svg\n    display: block\n    flex: none\n    width: 48px\n    height: 48px\n    background: #888\n'
// le parent qui réduit de moitié ce qu'il contient
const MOITIE = '.moitie\n  transform: scale(.5)\n  transform-origin: 0 0\n'

const SOURCES: Record<string, string> = {
  'dock-simple.mjs':   `<nav class="d" *dock>${icones(9)}</nav>\n<style>${BARRE}</style>\n`,
  'dock-reduit.mjs':   `<div class="moitie"><nav class="d" *dock>${icones(9)}</nav></div>\n<style>${BARRE}${MOITIE}</style>\n`,
  'dock-defile.mjs':   `<nav class="d" *dock>${icones(9)}</nav>\n<style>${BARRE}.d\n  width: 200px\n  overflow-x: auto\n</style>\n`,
  'dock-positionnee.mjs': `<nav class="d" *dock>${icones(9)}</nav>\n<style>${BARRE}.d\n  position: relative\n  width: 200px\n  overflow-x: auto\n  border: 6px solid #444\n</style>\n`,
  'dock-colonne.mjs':  `<nav class="d" *dock(axis: y)>${icones(9)}</nav>\n<style>${BARRE}.d\n  flex-direction: column\n  width: 60px\n  height: 200px\n  overflow-y: auto\n</style>\n`,
  'dock-colonne-reduite.mjs': `<div class="moitie"><nav class="d" *dock(axis: y)>${icones(9)}</nav></div>\n<style>${BARRE}${MOITIE}.d\n  flex-direction: column\n  width: 60px\n</style>\n`,
  // des icônes <svg> : pas de taille de mise en page à lire, leur boîte à l'écran est ramenée en mise en page
  'dock-svg-reduit.mjs': `<div class="moitie"><nav class="d" *dock>${svgs(9)}</nav></div>\n<style>${BARRE}${MOITIE}</style>\n`,
  'dock-svg-defile.mjs': `<nav class="d" *dock>${svgs(9)}</nav>\n<style>${BARRE}.d\n  width: 200px\n  overflow-x: auto\n</style>\n`,
  'dock-zoom.mjs':     `<div class="moitie"><nav class="d" *dock>${icones(9)}</nav></div>\n<style>${BARRE}.moitie\n  zoom: .5\n</style>\n`,
  'dock-ajout.mjs':    `<nav class="d" *dock>${icones(5)}</nav>\n<style>${BARRE}</style>\n`,
  // une balise 30 px sous l'écran (de 400 px), une autre à plus de 4 000 px
  'dock-goo.mjs':      '<div class="espace"></div>\n<button class="proche" *goo(drip, color: #f00, distance: 300)>Proche</button>\n<div class="grand"></div>\n<button class="loin" *goo(drip, color: #00f, distance: 100)>Loin</button>\n<style>\n.espace\n  height: 430px\n.grand\n  height: 4000px\nbutton\n  display: block\n  margin-left: 300px\n</style>\n',
  // une seule balise, à plus de 4 000 px sous l'écran
  'dock-goo-loin.mjs': '<div class="grand"></div>\n<button class="loin" *goo(drip, color: #00f, distance: 100)>Loin</button>\n<style>\n.grand\n  height: 4000px\n</style>\n',
  // un conteneur qui ne défile pas à la pose (rien ne le fait déborder), puis qui le devient
  'dock-parallax-conteneur.mjs': '<div class="haut"></div>\n<div class="pan"><div class="couche" *parallax(origin: page)>couche</div><div class="rempli"></div></div>\n<div class="bas"></div>\n<style>\n.haut\n  height: 900px\n.pan\n  height: 300px\n  overflow: auto\n  border: 1px solid #888\n.couche\n  height: 60px\n  background: #09f\n.rempli\n  height: 0\n.bas\n  height: 2000px\n</style>\n',
  // deux conteneurs : l'extérieur défile dès la pose, l'intérieur (caché) le devient plus tard
  'dock-parallax-imbriques.mjs': '<div class="ext"><div class="cale"></div><div class="int"><div class="couche" *parallax(origin: page)>couche</div><div class="plein"></div></div><div class="reste"></div></div>\n<style>\n.ext\n  height: 300px\n  overflow: auto\n.cale\n  height: 100px\n.int\n  height: 100px\n  overflow: hidden\n.couche\n  height: 50px\n  background: #f90\n.plein\n  height: 0\n.reste\n  height: 1500px\n</style>\n',
  // une enveloppe en overflow-x: hidden (son overflow-y devient auto) qui ne défile jamais
  'dock-parallax-enveloppe.mjs': '<div class="haut"></div>\n<div class="enveloppe"><div class="couche" *parallax(origin: page)>couche</div></div>\n<div class="bas"></div>\n<style>\n.haut\n  height: 900px\n.enveloppe\n  overflow-x: hidden\n.couche\n  height: 60px\n  background: #09f\n.bas\n  height: 2000px\n</style>\n',
  // un conteneur en overflow: hidden, que le script fait défiler (un carrousel) : il compte aussi
  'dock-parallax-cache.mjs': '<div class="haut"></div>\n<div class="pan"><div class="couche" *parallax(origin: page)>couche</div><div class="plein"></div></div>\n<div class="bas"></div>\n<style>\n.haut\n  height: 900px\n.pan\n  height: 300px\n  overflow: hidden\n.couche\n  height: 60px\n.plein\n  height: 800px\n.bas\n  height: 2000px\n</style>\n',
  // origin: view (par défaut) dans un conteneur déjà défilable : le milieu du conteneur sert de repère
  'dock-parallax-vue.mjs': '<div class="haut"></div>\n<div class="pan"><div class="vide"></div><div class="couche" *parallax>couche</div><div class="vide"></div></div>\n<div class="bas"></div>\n<style>\n.haut\n  height: 900px\n.pan\n  height: 300px\n  overflow: auto\n.vide\n  height: 400px\n.couche\n  height: 60px\n.bas\n  height: 2000px\n</style>\n',
  // une couche dans un conteneur déjà défilable, vue d'un défilement à l'autre
  'dock-parallax-repos.mjs': '<div class="haut"></div>\n<div class="pan"><div class="couche" *parallax(origin: page)>couche</div><div class="plein"></div></div>\n<div class="bas"></div>\n<style>\n.haut\n  height: 900px\n.pan\n  height: 300px\n  overflow: auto\n.couche\n  height: 60px\n.plein\n  height: 800px\n.bas\n  height: 2000px\n</style>\n'
}

// ce que la page compte : les images d'animation en attente, les minuteries vivantes, les écritures de
// propriétés CSS par nom (pour savoir qu'un effet a redessiné)
const COMPTEURS = () => {
  const w = window as any
  w.__raf = new Set()
  const ra = w.requestAnimationFrame.bind(w)
  const ca = w.cancelAnimationFrame.bind(w)
  w.requestAnimationFrame = (f: any) => { const h = ra((t: number) => { w.__raf.delete(h); return f(t) }); w.__raf.add(h); return h }
  w.cancelAnimationFrame = (h: number) => { w.__raf.delete(h); return ca(h) }
  w.__iv = new Set()
  const si = w.setInterval.bind(w)
  const ci = w.clearInterval.bind(w)
  w.setInterval = (f: any, d: number, ...a: any[]) => { const h = si(f, d, ...a); w.__iv.add(h); return h }
  w.clearInterval = (h: number) => { w.__iv.delete(h); return ci(h) }
  w.__ecritures = {}
  const sp = w.CSSStyleDeclaration.prototype.setProperty
  w.CSSStyleDeclaration.prototype.setProperty = function (k: string, ...a: any[]) { w.__ecritures[k] = (w.__ecritures[k] || 0) + 1; return sp.call(this, k, ...a) }
}

const attendre = (ms: number) => new Promise((r) => setTimeout(r, ms))

// relit une valeur jusqu'à ce qu'elle soit celle attendue, ou que le délai passe : rend la dernière lue
async function attend(lire: () => Promise<string>, attendu: string, ms = 2500): Promise<string> {
  const fin = Date.now() + ms
  let v = await lire()
  while (v !== attendu && Date.now() < fin) {
    await attendre(50)
    v = await lire()
  }
  return v
}

describe('*dock, *goo(drip), *parallax (navigateurs réels) — barre réduite ou défilée, gouttes à l\'écran, conteneurs tardifs', function () {
  this.timeout(240000)
  let script = ''

  before(async function () {
    if (!(await navigateurPresent('chromium')) && !(await navigateurPresent('firefox')) && !(await navigateurPresent('webkit'))) return
    const root   = mjsTmp('effets-dock-goo-parallax')
    const srcDir = join(root, 'src')
    const outDir = join(root, 'out')
    mkdirSync(srcDir, { recursive: true })
    for (const [nom, source] of Object.entries(SOURCES)) writeFileSync(join(srcDir, nom), source)
    const bundler = new Bundler({ sourceDir: srcDir, outputDir: outDir, manifestPath: join(root, 'bundle.js') })
    const stats   = await bundler.compile()
    await bundler.close()
    assert.equal(stats.errors.length, 0, stats.errors.map((e: any) => e.message).join('\n'))
    const files = readdirSync(outDir).filter((f) => f.endsWith('.js'))
    // le cœur d'abord, puis les animations, puis les composants
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

      // la page d'un composant, à une vraie adresse ; `fn` s'y exécute, la page est refermée ensuite
      async function avec<T>(tag: string, fn: (page: any) => Promise<T>, viewport = { width: 1000, height: 800 }): Promise<T> {
        const page = await browser.newPage({ viewport })
        try {
          await page.addInitScript(COMPTEURS)
          await page.route('http://t.test/**', (route: any) => {
            if (route.request().url() !== 'http://t.test/') return route.fulfill({ status: 404, body: '' })
            return route.fulfill({ contentType: 'text/html', body: `<!doctype html><html><head><meta charset="utf-8"><style>html,body{margin:0}</style></head><body><${tag}></${tag}><script>${script}</script></body></html>` })
          })
          await page.goto('http://t.test/', { waitUntil: 'load' })
          await page.waitForFunction((t: string) => !!(document.querySelector(t) as any)?._shadow?.querySelector('[mjs-fx]'), tag)
          return await fn(page)
        }
        finally {
          await page.close()
        }
      }

      // ce que la page tient au repos, une fois les derniers gestes passés
      const auRepos = async (page: any) => {
        await page.waitForTimeout(300)
        return page.evaluate(() => ({ raf: (window as any).__raf.size, minuteries: (window as any).__iv.size }))
      }

      // ----- *dock -----

      // les échelles des enfants de `.d` ; null : l'icône n'a jamais été écrite
      const echelles = (page: any, tag: string): Promise<(number | null)[]> => page.evaluate((t: string) => Array.from((document.querySelector(t) as any)._shadow.querySelector('.d').children).map((c: any) => {
        const v = c.style.getPropertyValue('--mjs-fx-dock-s')
        return v === '' ? null : parseFloat(v)
      }), tag)

      // la souris au milieu de l'icône n, venue de loin (l'entrée dans la barre puis un mouvement)
      async function survole(page: any, tag: string, n: number) {
        const r = await page.evaluate(([t, i]: [string, number]) => {
          const b = (document.querySelector(t) as any)._shadow.querySelector('.d').children[i].getBoundingClientRect()
          return { x: b.left + b.width / 2, y: b.top + b.height / 2 }
        }, [tag, n])
        await page.mouse.move(990, 790)
        await page.mouse.move(r.x, r.y)
        await page.waitForTimeout(60)
        return r
      }

      // fait défiler la barre (`scrollLeft` ou `scrollTop`) et vérifie qu'elle a défilé : sans débordement, le réglage serait sans effet
      async function defile(page: any, tag: string, propriete: 'scrollLeft' | 'scrollTop', valeur: number) {
        const lu = await page.evaluate(([t, p, v]: [string, string, number]) => {
          const d = (document.querySelector(t) as any)._shadow.querySelector('.d')
          d[p] = v
          return d[p]
        }, [tag, propriete, valeur])
        assert.equal(lu, valeur, `la barre défile de ${valeur} px (sinon elle ne déborde pas : l'essai ne prouve rien)`)
      }

      const plusGrosse = (s: (number | null)[]) => s.indexOf(Math.max(...s.map((v) => v ?? 0)))
      const vu = (s: (number | null)[]) => JSON.stringify(s.map((v) => v === null ? null : Math.round(v * 1000) / 1000))

      // la cloche autour de l'icône n : la plus grosse là, ses deux voisines autant l'une que l'autre
      function cloche(s: (number | null)[], n: number, quoi: string) {
        assert.equal(plusGrosse(s), n, `${quoi} : la plus grosse est l'icône ${n} — ${vu(s)}`)
        assert.ok(s[n] !== null && s[n]! > 1.5, `${quoi} : l'icône sous la souris grossit près de 1.6 — ${vu(s)}`)
        assert.ok(Math.abs((s[n - 1] ?? 1) - (s[n + 1] ?? 1)) < 0.05, `${quoi} : la cloche est symétrique autour de l'icône ${n} — ${vu(s)}`)
      }

      it('témoin : barre simple, l\'icône sous la souris est la plus grosse', async function () {
        if (!present) { this.skip(); return }
        const s = await avec('mjs-dock-simple', async (page) => {
          await survole(page, 'mjs-dock-simple', 4)
          return echelles(page, 'mjs-dock-simple')
        })
        cloche(s, 4, 'barre simple')
      })

      it('barre réduite par un parent (transform: scale(.5)) : l\'icône sous la souris est la plus grosse, la cloche comme sans réduction', async function () {
        if (!present) { this.skip(); return }
        const ref = await avec('mjs-dock-simple', async (page) => {
          await survole(page, 'mjs-dock-simple', 4)
          return echelles(page, 'mjs-dock-simple')
        })
        const s = await avec('mjs-dock-reduit', async (page) => {
          await survole(page, 'mjs-dock-reduit', 4)
          return echelles(page, 'mjs-dock-reduit')
        })
        cloche(s, 4, 'barre réduite')
        for (let i = 0; i < ref.length; i++) assert.ok(Math.abs((s[i] ?? 1) - (ref[i] ?? 1)) < 0.05, `icône ${i} : ${vu(s)} au lieu de ${vu(ref)} (la portée suit la réduction)`)
      })

      it('barre qui défile (scrollLeft 150) : l\'icône sous la souris est la plus grosse', async function () {
        if (!present) { this.skip(); return }
        const s = await avec('mjs-dock-defile', async (page) => {
          await defile(page, 'mjs-dock-defile', 'scrollLeft', 150)
          await survole(page, 'mjs-dock-defile', 5)
          return echelles(page, 'mjs-dock-defile')
        })
        cloche(s, 5, 'barre défilée')
      })

      it('barre positionnée, bordée et défilée : l\'icône sous la souris est la plus grosse', async function () {
        if (!present) { this.skip(); return }
        const s = await avec('mjs-dock-positionnee', async (page) => {
          await defile(page, 'mjs-dock-positionnee', 'scrollLeft', 150)
          await survole(page, 'mjs-dock-positionnee', 5)
          return echelles(page, 'mjs-dock-positionnee')
        })
        cloche(s, 5, 'barre positionnée, bordée, défilée')
      })

      it('icônes <svg> dans une barre réduite par un parent : l\'icône sous la souris est la plus grosse', async function () {
        if (!present) { this.skip(); return }
        const s = await avec('mjs-dock-svg-reduit', async (page) => {
          await survole(page, 'mjs-dock-svg-reduit', 4)
          return echelles(page, 'mjs-dock-svg-reduit')
        })
        cloche(s, 4, 'icônes <svg>, barre réduite')
      })

      it('icônes <svg> dans une barre qui défile (scrollLeft 150) : l\'icône sous la souris est la plus grosse', async function () {
        if (!present) { this.skip(); return }
        const s = await avec('mjs-dock-svg-defile', async (page) => {
          await defile(page, 'mjs-dock-svg-defile', 'scrollLeft', 150)
          await survole(page, 'mjs-dock-svg-defile', 5)
          return echelles(page, 'mjs-dock-svg-defile')
        })
        cloche(s, 5, 'icônes <svg>, barre défilée')
      })

      it('barre sous un `zoom: .5` du parent : l\'icône sous la souris est la plus grosse', async function () {
        if (!present) { this.skip(); return }
        const s = await avec('mjs-dock-zoom', async (page) => {
          await survole(page, 'mjs-dock-zoom', 4)
          return echelles(page, 'mjs-dock-zoom')
        })
        cloche(s, 4, 'barre sous zoom')
      })

      it('colonne (axis: y) qui défile (scrollTop 150) : l\'icône sous la souris est la plus grosse', async function () {
        if (!present) { this.skip(); return }
        const s = await avec('mjs-dock-colonne', async (page) => {
          await defile(page, 'mjs-dock-colonne', 'scrollTop', 150)
          await survole(page, 'mjs-dock-colonne', 5)
          return echelles(page, 'mjs-dock-colonne')
        })
        cloche(s, 5, 'colonne défilée')
      })

      it('colonne (axis: y) réduite par un parent : l\'icône sous la souris est la plus grosse', async function () {
        if (!present) { this.skip(); return }
        const s = await avec('mjs-dock-colonne-reduite', async (page) => {
          await survole(page, 'mjs-dock-colonne-reduite', 4)
          return echelles(page, 'mjs-dock-colonne-reduite')
        })
        cloche(s, 4, 'colonne réduite')
      })

      it('une icône ajoutée pendant le survol grossit aussi ; une icône retirée ou remplacée ne laisse pas la cloche sur l\'ancienne place', async function () {
        if (!present) { this.skip(); return }
        const tag = 'mjs-dock-ajout'
        await avec(tag, async (page) => {
          const r = await survole(page, tag, 2)
          await page.evaluate((t: string) => {
            const d = (document.querySelector(t) as any)._shadow.querySelector('.d')
            const i = document.createElement('i')
            i.className = 'neuf'
            d.insertBefore(i, d.children[3])
          }, tag)
          await page.mouse.move(r.x + 2, r.y)
          await page.waitForTimeout(60)
          let s = await echelles(page, tag)
          assert.equal(s.length, 6, vu(s))
          assert.ok(s[3] !== null && s[3] > 1.2, `l'icône ajoutée grossit comme sa voisine de l'icône sous la souris — ${vu(s)}`)
          assert.equal(plusGrosse(s), 2, vu(s))
          // la première icône part : tout recule d'une place, la souris est maintenant sur l'icône ajoutée
          await page.evaluate((t: string) => { (document.querySelector(t) as any)._shadow.querySelector('.d').children[0].remove() }, tag)
          await page.mouse.move(r.x + 4, r.y)
          await page.waitForTimeout(60)
          s = await echelles(page, tag)
          assert.equal(s.length, 5, vu(s))
          assert.equal(plusGrosse(s), 2, `la plus grosse est celle sous la souris (l'icône ajoutée, devenue la 3e) — ${vu(s)}`)
          // la dernière icône est remplacée par une autre : le même nombre d'enfants, la nouvelle compte aussi
          await page.evaluate((t: string) => {
            const d = (document.querySelector(t) as any)._shadow.querySelector('.d')
            d.children[4].remove()
            const i = document.createElement('i')
            i.className = 'remplace'
            d.appendChild(i)
          }, tag)
          await page.mouse.move(r.x + 2, r.y)
          await page.waitForTimeout(60)
          s = await echelles(page, tag)
          assert.equal(s.length, 5, vu(s))
          assert.ok(s[4] !== null && s[4] > 1.05, `l'icône qui en remplace une autre grossit aussi, à sa distance — ${vu(s)}`)
        })
      })

      it('au repos, la barre ne fait rien : ni image d\'animation, ni minuterie, pendant le survol et après', async function () {
        if (!present) { this.skip(); return }
        const tag = 'mjs-dock-defile'
        await avec(tag, async (page) => {
          await defile(page, 'mjs-dock-defile', 'scrollLeft', 150)
          await survole(page, tag, 5)
          assert.deepEqual(await auRepos(page), { raf: 0, minuteries: 0 }, 'souris immobile sur la barre')
          await page.mouse.move(990, 790)
          assert.deepEqual(await auRepos(page), { raf: 0, minuteries: 0 }, 'souris partie')
          assert.deepEqual(await echelles(page, tag), Array(9).fill(null), 'toutes les icônes rendues à leur taille')
        })
      })

      // ----- *goo(drip) -----

      it('*goo(drip) à 30 px sous l\'écran coule (ses gouttes se voient) ; plus loin que la portée des gouttes, aucune goutte neuve', async function () {
        if (!present) { this.skip(); return }
        const tag = 'mjs-dock-goo'
        await avec(tag, async (page) => {
          const gouttes = (c: string) => page.evaluate(([t, k]: [string, string]) => (document.querySelector(t) as any)._shadow.querySelector('.' + k).querySelectorAll('[mjs-fx-layer="goo"] i').length, [tag, c])
          await page.waitForTimeout(1300)
          const proche = await gouttes('proche')
          assert.ok(proche > 0, `à 30 px sous l'écran, les gouttes (jusqu'à 300 px) se voient : ${proche} goutte(s)`)
          assert.equal(await gouttes('loin'), 0, 'à plus de 4 000 px sous l\'écran : aucune goutte')
          // la page défile de 2 500 px : la proche est loin au-dessus, ses gouttes ne se renouvellent plus (les
          // vieilles finissent leur course). L'observateur prévient avec un peu de retard : on marque les gouttes
          // vues, et on attend une fenêtre sans goutte neuve
          await page.evaluate(() => window.scrollTo(0, 2500))
          const marquer = (t: string) => (document.querySelector(t) as any)._shadow.querySelector('.proche').querySelectorAll('[mjs-fx-layer="goo"] i').forEach((i: any) => i.setAttribute('data-vieille', ''))
          const compter = (t: string) => (document.querySelector(t) as any)._shadow.querySelector('.proche').querySelectorAll('[mjs-fx-layer="goo"] i:not([data-vieille])').length
          let neuves = -1
          const fin = Date.now() + 5000
          while (neuves !== 0 && Date.now() < fin) {
            await page.evaluate(marquer, tag)
            await page.waitForTimeout(400)
            neuves = await page.evaluate(compter, tag)
          }
          assert.equal(neuves, 0, 'loin de l\'écran : plus de goutte neuve')
          assert.equal(await gouttes('loin'), 0, 'la lointaine n\'a toujours rien fait')
          assert.equal(await page.evaluate(() => (window as any).__iv.size), 0, 'aucune minuterie vivante : la cadence des gouttes s\'est arrêtée avec la vue')
        }, { width: 800, height: 400 })
      })

      it('*goo(drip) loin de l\'écran ne travaille pas pour rien : ni goutte, ni minuterie', async function () {
        if (!present) { this.skip(); return }
        await avec('mjs-dock-goo-loin', async (page) => {
          await page.waitForTimeout(1300)
          const gouttes = await page.evaluate(() => (document.querySelector('mjs-dock-goo-loin') as any)._shadow.querySelectorAll('[mjs-fx-layer="goo"] i').length)
          assert.equal(gouttes, 0, 'aucune goutte')
          const minuteries = await page.evaluate(() => (window as any).__iv.size)
          assert.equal(minuteries, 0, 'aucune minuterie vivante : la cadence des gouttes ne tourne pas')
        }, { width: 800, height: 400 })
      })

      // ----- *parallax -----

      const lire = (page: any, tag: string, couche = '.couche') => page.evaluate(([t, c]: [string, string]) => ((t ? (document.querySelector(t) as any)._shadow : document).querySelector(c) as any).style.getPropertyValue('--mjs-fx-parallax-y'), [tag, couche])
      const ecritures = (page: any): Promise<number> => page.evaluate(() => (window as any).__ecritures['--mjs-fx-parallax-y'] || 0)

      // fait le geste, puis attend que l'effet ait redessiné (une écriture de plus) : lire avant, c'est lire la valeur d'avant
      async function apres(page: any, geste: () => Promise<unknown>) {
        const avant = await ecritures(page)
        await geste()
        const fin = Date.now() + 2500
        while ((await ecritures(page)) <= avant && Date.now() < fin) await attendre(30)
      }

      const defiler = (page: any, y: number) => apres(page, () => page.evaluate((v: number) => window.scrollTo(0, v), y))
      // le défilement d'une zone du composant (`.pan`, `.ext`, `.int`)
      const zone = (page: any, tag: string, sel: string, y: number) => apres(page, () => page.evaluate(([t, c, v]: [string, string, number]) => { ((document.querySelector(t) as any)._shadow.querySelector(c) as any).scrollTop = v }, [tag, sel, y]))
      const agrandir = (page: any, tag: string) => page.evaluate((t: string) => { ((document.querySelector(t) as any)._shadow.querySelector('.rempli') as any).style.height = '800px' }, tag)

      it('*parallax(origin: page) : un conteneur devenu défilable après la pose est pris — à défilement nul, décalage nul ; puis il suit son défilement', async function () {
        if (!present) { this.skip(); return }
        const tag = 'mjs-dock-parallax-conteneur'
        await avec(tag, async (page) => {
          await defiler(page, 800)
          assert.equal(await lire(page, tag), '400.0px', 'le conteneur ne défile pas encore : la page anime la couche')
          // son contenu grandit : il défile maintenant, sans avoir défilé
          await agrandir(page, tag)
          await defiler(page, 900)
          assert.equal(await lire(page, tag), '0.0px', 'page à 900 px, conteneur à 0 : la couche reste à sa place')
          await zone(page, tag, '.pan', 200)
          assert.equal(await lire(page, tag), '100.0px', 'conteneur défilé de 200 px : la moitié')
          await defiler(page, 1100)
          assert.equal(await lire(page, tag), '100.0px', 'la page défile encore : c\'est le conteneur qui compte')
        })
      })

      it('*parallax : un conteneur intérieur devenu défilable après la pose prend la place du conteneur extérieur', async function () {
        if (!present) { this.skip(); return }
        const tag = 'mjs-dock-parallax-imbriques'
        await avec(tag, async (page) => {
          await zone(page, tag, '.ext', 40)
          assert.equal(await lire(page, tag), '20.0px', 'l\'extérieur défile de 40 px : la moitié')
          // l'intérieur (d'abord caché, sans débordement) devient défilable, puis défile de 100 px
          await page.evaluate((t: string) => {
            const sh = (document.querySelector(t) as any)._shadow
            sh.querySelector('.int').style.overflow = 'auto'
            sh.querySelector('.plein').style.height = '600px'
          }, tag)
          await zone(page, tag, '.int', 100)
          assert.equal(await lire(page, tag), '50.0px', 'l\'intérieur défile de 100 px : la moitié, pas celle de l\'extérieur')
        })
      })

      it('*parallax : une enveloppe en overflow-x: hidden qui ne défile jamais laisse la page animer la couche', async function () {
        if (!present) { this.skip(); return }
        const tag = 'mjs-dock-parallax-enveloppe'
        await avec(tag, async (page) => {
          await defiler(page, 800)
          assert.equal(await lire(page, tag), '400.0px', 'page défilée de 800 px : la moitié')
        })
      })

      it('*parallax dans un conteneur qui défile déjà à la pose : son défilement, pas celui de la page', async function () {
        if (!present) { this.skip(); return }
        const tag = 'mjs-dock-parallax-repos'
        await avec(tag, async (page) => {
          await defiler(page, 700)
          assert.equal(await lire(page, tag), '0.0px', 'page défilée, conteneur à 0')
          await zone(page, tag, '.pan', 300)
          assert.equal(await lire(page, tag), '150.0px', 'conteneur défilé de 300 px')
        })
      })

      it('*parallax (origin: view) dans un conteneur qui défile : la couche glisse à la moitié du défilement', async function () {
        if (!present) { this.skip(); return }
        const tag = 'mjs-dock-parallax-vue'
        await avec(tag, async (page) => {
          await defiler(page, 700)
          const haut = () => page.evaluate((t: string) => ((document.querySelector(t) as any)._shadow.querySelector('.couche') as any).getBoundingClientRect().top, tag)
          await zone(page, tag, '.pan', 200)
          const a = await haut()
          await zone(page, tag, '.pan', 300)
          const b = await haut()
          assert.ok(Math.abs((b - a) + 50) <= 2, `défilé de 100 px, la couche monte de 50 px (vitesse 0.5) : ${Math.round(b - a)} px`)
        })
      })

      it('*parallax : un conteneur en overflow: hidden que le script fait défiler compte aussi, tant qu\'il défile vraiment', async function () {
        if (!present) { this.skip(); return }
        const tag = 'mjs-dock-parallax-cache'
        await avec(tag, async (page) => {
          await zone(page, tag, '.pan', 200)
          assert.equal(await lire(page, tag), '100.0px', 'conteneur caché défilé de 200 px par le script : la moitié')
          await defiler(page, 700)
          assert.equal(await lire(page, tag), '100.0px', 'la page défile encore : c\'est le conteneur qui compte')
        })
      })

      // la pose directe (µ._mjs_fx) sur une page déjà montée : le conteneur est cherché à la pose, avec sa mise en page
      it('*parallax posé sur une page déjà montée : l\'intérieur devenu défilable prend la place de l\'extérieur, défilable dès la pose', async function () {
        if (!present) { this.skip(); return }
        await avec('mjs-dock-parallax-enveloppe', async (page) => {
          await page.evaluate(() => {
            document.body.innerHTML = '<div id="ext" style="height:300px;overflow:auto"><div style="height:100px"></div><div id="int" style="height:100px;overflow:hidden"><div id="c2" style="height:50px">c2</div><div id="r2" style="height:0"></div></div><div style="height:1500px"></div></div>'
            ;(window as any).µ._mjs_fx(null, document.getElementById('c2'), 'parallax', { origin: 'page', speed: 0.5 })
          })
          await page.evaluate(() => {
            const i = document.getElementById('int') as any
            i.style.overflow = 'auto'
            ;(document.getElementById('r2') as any).style.height = '600px'
          })
          await apres(page, () => page.evaluate(() => { (document.getElementById('int') as any).scrollTop = 100 }))
          assert.equal(await lire(page, '', '#c2'), '50.0px', 'l\'intérieur défile de 100 px : la moitié')
        })
      })

      it('*parallax posé sur une page déjà montée : un conteneur qui grandit après la pose, page défilée, conteneur à 0 : décalage nul', async function () {
        if (!present) { this.skip(); return }
        await avec('mjs-dock-parallax-enveloppe', async (page) => {
          await page.evaluate(() => {
            document.body.innerHTML = '<div style="height:900px"></div><div id="pan" style="height:300px;overflow:auto"><div id="c1" style="height:60px">couche</div><div id="r1" style="height:0"></div></div><div style="height:2000px"></div>'
            ;(window as any).µ._mjs_fx(null, document.getElementById('c1'), 'parallax', { origin: 'page', speed: 0.5 })
          })
          await defiler(page, 800)
          assert.equal(await lire(page, '', '#c1'), '400.0px', 'le conteneur ne défile pas encore : la page anime la couche')
          await page.evaluate(() => { (document.getElementById('r1') as any).style.height = '800px' })
          await defiler(page, 900)
          assert.equal(await lire(page, '', '#c1'), '0.0px', 'page à 900 px, conteneur à 0 : la couche reste à sa place')
        })
      })

      it('au repos, *parallax ne fait rien : ni image d\'animation, ni minuterie, après les défilements', async function () {
        if (!present) { this.skip(); return }
        const tag = 'mjs-dock-parallax-conteneur'
        await avec(tag, async (page) => {
          await agrandir(page, tag)
          await defiler(page, 900)
          await zone(page, tag, '.pan', 200)
          assert.equal(await lire(page, tag), '100.0px')
          assert.deepEqual(await auRepos(page), { raf: 0, minuteries: 0 })
        })
      })
    })
  }
})
