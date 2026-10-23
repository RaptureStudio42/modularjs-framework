// *particles, *marquee et *pixels dans Chromium et Firefox réels, là où une mise en page est nécessaire :
//   - « réduire les animations » : la neige et les étoiles filantes restent réparties et immobiles (et
//     non empilées dans un coin), le défilé ne montre qu'une copie de son texte, le réseau ne redessine rien ;
//   - *particles(network, color: var(--c)) : les points prennent la couleur de la variable (le canevas ne
//     lit pas les variables CSS), et la suivent quand elle change ;
//   - *pixels(on: always | view | load) sur une balise cachée à la pose puis montrée : le remplissage joue,
//     les carreaux ne naissent pas déjà pleins (`load` : le compilateur ne l'écrit pas dans un gabarit, le
//     runtime l'accepte comme `always` : posé ici à la main) ;
//   - hors écran, ou sous « réduire les animations » : le réseau ne tourne pas pour rien.

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
  'vb-page.mjs': [
    '<div class="neige" *particles(snow, count: 40)></div>',
    '<div class="meteores" *particles(meteors, count: 12)></div>',
    '<div class="fige" *particles(snow, speed: 0, count: 40)></div>',
    '<div class="reseau" *particles(network, links: 0, color: var(--c))></div>',
    '<div class="defile" *marquee(speed: 4s)>Salut</div>',
    '<div class="haut" *marquee(direction: up, speed: 4s)>Salut</div>',
    '<div class="vide"></div>',
    '<style>',
    'div',
    '  width: 300px',
    '  height: 200px',
    '.reseau',
    '  --c: #00ff00',
    '  background: #000',
    '.defile',
    '  width: 600px',
    '  height: 30px',
    '.haut',
    '  width: 600px',
    '  height: 120px',
    '.vide',
    '  height: 1500px',
    '</style>',
    ''
  ].join('\n'),
  // cachées à la pose (`hidden`) : leurs carreaux naissent quand on les montre
  'vb-carreaux.mjs': [
    '<div class="a" hidden *pixels(on: always, duration: 3s, stagger: 1s)>A</div>',
    '<div class="v" hidden *pixels(on: view, duration: 3s, stagger: 1s)>V</div>',
    '<div class="e" hidden *pixels(explode, on: always, duration: 3s, stagger: 1s)>E</div>',
    '<div class="enveloppe" hidden><@vb-bloc class="bloc" *pixels(on: always, duration: 3s, stagger: 1s)></@vb-bloc></div>',
    '<div class="m" *pixels(on: view, duration: 3s, stagger: 1s)>M</div>',
    '<div class="t" *pixels(on: always, duration: 3s, stagger: 1s)>T</div>',
    '<style>',
    'div',
    '  width: 300px',
    '  height: 100px',
    '.bloc',
    '  display: block',
    '  width: 300px',
    '  height: 100px',
    '</style>',
    ''
  ].join('\n'),
  'vb-bloc.mjs': '<span>B</span>\n'
}

// un compteur des images dessinées par un canevas : le réseau efface tout avant chaque image
// la balise d'un effet de carreaux (`c` : a, v, m, t, e dans le composant de carreaux ; charge, posée à la main ; bloc, une balise-composant), celle qui porte `hidden`, et ses carreaux
const HOTE = [
  'window.__hote = (c) => c === "charge" ? document.getElementById("charge") : document.querySelector("mjs-vb-carreaux")._shadow.querySelector("." + c);',
  'window.__voile = (c) => c === "bloc" ? window.__hote(c).parentElement : window.__hote(c);',
  'window.__tuiles = (c) => { const h = window.__hote(c); return Array.from((h._shadow || h).querySelectorAll(\'[mjs-fx-layer="pixels"] i\')) };'
].join('\n')
const COMPTEUR = 'window.__dessins = 0; const c = CanvasRenderingContext2D.prototype.clearRect; CanvasRenderingContext2D.prototype.clearRect = function(...a) { window.__dessins++; return c.apply(this, a) }'

describe('*particles, *marquee, *pixels (navigateurs réels)', function () {
  this.timeout(240000)
  let scripts = ''
  let construit = false

  before(async function () {
    const root   = mjsTmp('effets-particules-defile-carreaux-browser')
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
    const ordre = [...files].sort((a, b) => rang(a) - rang(b) || a.localeCompare(b))
    const lis   = (f: string) => stripEsm(readFileSync(join(outDir, f), 'utf-8'))
    // la mesure des effets économes ne doit pas décider à la place du test : jamais d'économe, posé avant les composants
    scripts   = ordre.filter((f) => rang(f) < 2).map(lis).join('\n') + '\nµ._fxConf = { lite: "off" };\n' + ordre.filter((f) => rang(f) === 2).map(lis).join('\n') + '\nglobalThis.µ = µ;'
    construit = true
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
        browser = await (await import('playwright'))[nom].launch()
      })

      after(async () => { if (browser) await browser.close() })

      // la page d'un composant, servie à une vraie adresse ; `reduit` : « réduire les animations » demandé par le système
      async function ouvre(tag: string, classe: string, reduit = false) {
        assert.ok(construit, 'la construction a échoué')
        const page = await browser.newPage({ viewport: { width: 800, height: 600 }, reducedMotion: reduit ? 'reduce' : 'no-preference' })
        await page.addInitScript(COMPTEUR + '\n' + HOTE)
        await page.route('http://t.test/**', (route: any) => {
          if (route.request().url() !== 'http://t.test/') return route.fulfill({ status: 404, body: '' })
          return route.fulfill({ contentType: 'text/html', body: `<!doctype html><html><head><meta charset="utf-8"><style>html,body{margin:0;background:#fff}#charge{width:300px;height:100px}</style></head><body><${tag}></${tag}><script>${scripts}</script></body></html>` })
        })
        await page.goto('http://t.test/', { waitUntil: 'load' })
        await page.waitForFunction(([t, c]: string[]) => !!(document.querySelector(t) as any)?._shadow?.querySelector('.' + c), [tag, classe])
        return page
      }

      async function essai(tag: string, classe: string, reduit: boolean, fn: (page: any) => Promise<void>) {
        const page = await ouvre(tag, classe, reduit)
        try {
          await fn(page)
        } finally {
          await page.close()
        }
      }

      // la place de chaque particule dans sa balise, arrondie au pixel
      const places = (page: any, classe: string) => page.evaluate((c: string) => {
        const h: any = (document.querySelector('mjs-vb-page') as any)._shadow.querySelector('.' + c)
        const r0 = h.getBoundingClientRect()
        return (Array.from(h.querySelectorAll('[mjs-fx-layer="particles"] i')) as any[]).map((i) => {
          const b = i.getBoundingClientRect()
          return Math.round(b.left - r0.left) + ',' + Math.round(b.top - r0.top)
        })
      }, classe)

      for (const [classe, libelle] of [['neige', 'la neige'], ['meteores', 'les étoiles filantes']]) {
        it(`« réduire les animations » : ${libelle} reste répartie et immobile — pas empilée dans un coin`, async function () {
          if (!present) { this.skip(); return }
          await essai('mjs-vb-page', classe, true, async (page) => {
            await page.waitForTimeout(300)
            const a = await places(page, classe)
            await page.waitForTimeout(500)
            const b = await places(page, classe)
            assert.ok(a.length >= 10, `des particules posées : ${a.length}`)
            assert.ok(new Set(a).size > a.length / 2, `réparties : ${new Set(a).size} places distinctes pour ${a.length} particules`)
            assert.deepEqual(b, a, 'et immobiles')
          })
        })

        it(`sans « réduire les animations » : ${libelle} bouge toujours`, async function () {
          if (!present) { this.skip(); return }
          await essai('mjs-vb-page', classe, false, async (page) => {
            await page.waitForTimeout(300)
            const a = await places(page, classe)
            await page.waitForTimeout(500)
            const b = await places(page, classe)
            assert.ok(new Set(a).size > a.length / 2, `réparties : ${new Set(a).size} places distinctes pour ${a.length} particules`)
            assert.notDeepEqual(b, a, 'elles bougent')
          })
        })
      }

      it('« réduire les animations » demandé après la pose, puis retiré : la neige se range à son point, puis repart', async function () {
        if (!present) { this.skip(); return }
        await essai('mjs-vb-page', 'neige', false, async (page) => {
          await page.waitForTimeout(300)
          await page.emulateMedia({ reducedMotion: 'reduce' })
          await page.waitForTimeout(300)
          const a = await places(page, 'neige')
          await page.waitForTimeout(400)
          const b = await places(page, 'neige')
          assert.ok(new Set(a).size > a.length / 2, `réparties : ${new Set(a).size} places distinctes pour ${a.length} particules`)
          assert.deepEqual(b, a, 'et immobiles')
          await page.emulateMedia({ reducedMotion: 'no-preference' })
          await page.waitForTimeout(300)
          const c = await places(page, 'neige')
          await page.waitForTimeout(400)
          const d = await places(page, 'neige')
          assert.notDeepEqual(d, c, 'le réglage retiré, elle retombe')
        })
      })

      it('*particles(snow, speed: 0) : des flocons répartis et immobiles', async function () {
        if (!present) { this.skip(); return }
        await essai('mjs-vb-page', 'fige', false, async (page) => {
          await page.waitForTimeout(300)
          const a = await places(page, 'fige')
          await page.waitForTimeout(400)
          const b = await places(page, 'fige')
          assert.ok(new Set(a).size > a.length / 2, `réparties : ${new Set(a).size} places distinctes pour ${a.length} particules`)
          assert.deepEqual(b, a, 'et immobiles')
        })
      })

      // les pixels dessinés par le canevas du réseau : [vert, rouge, noir]
      const couleurs = (page: any) => page.evaluate(() => {
        const cv: any = ((document.querySelector('mjs-vb-page') as any)._shadow.querySelector('.reseau') as any).querySelector('canvas')
        const d = cv.getContext('2d').getImageData(0, 0, cv.width, cv.height).data
        let vert = 0
        let rouge = 0
        let noir  = 0
        for (let i = 0; i < d.length; i += 4) {
          if (d[i + 3] === 0) continue
          if (d[i + 1] > 100 && d[i] < 100) vert++
          else if (d[i] > 100 && d[i + 1] < 100) rouge++
          else noir++
        }
        return { vert, rouge, noir }
      })

      it('*particles(network, color: var(--c)) : les points sont dessinés dans la couleur de la variable, et la suivent quand elle change', async function () {
        if (!present) { this.skip(); return }
        await essai('mjs-vb-page', 'reseau', false, async (page) => {
          await page.waitForFunction(() => (window as any).__dessins > 2)
          const a = await couleurs(page)
          assert.ok(a.vert > 0 && a.noir === 0 && a.rouge === 0, `les points sont verts (la variable) : ${JSON.stringify(a)}`)
          await page.evaluate(() => (((document.querySelector('mjs-vb-page') as any)._shadow.querySelector('.reseau')) as any).style.setProperty('--c', '#ff0000'))
          await page.waitForFunction((n: number) => (window as any).__dessins > n + 2, await page.evaluate(() => (window as any).__dessins))
          const b = await couleurs(page)
          assert.ok(b.rouge > 0 && b.vert === 0 && b.noir === 0, `la variable passe au rouge, les points la suivent : ${JSON.stringify(b)}`)
        })
      })

      // pour chaque défilé : une boîte rendue par copie du texte (une copie cachée n'a aucune boîte)
      const copies = (page: any) => page.evaluate(() => {
        const sh: any = (document.querySelector('mjs-vb-page') as any)._shadow
        const rendues = (c: string) => (Array.from(sh.querySelector('.' + c).querySelectorAll('[mjs-fx-marquee-track] > span')) as any[]).map((s) => s.getClientRects().length > 0)
        const hote  = sh.querySelector('.defile').getBoundingClientRect()
        const prem  = sh.querySelector('.defile [mjs-fx-marquee-track] > span').getBoundingClientRect()
        return { defile: rendues('defile'), haut: rendues('haut'), animations: sh.querySelector('.defile [mjs-fx-marquee-track]').getAnimations().length, decalage: Math.round(prem.left - hote.left) }
      })

      it('*marquee sous « réduire les animations » : la seconde copie du texte est cachée, la première reste en place — à l\'horizontale comme à la verticale', async function () {
        if (!present) { this.skip(); return }
        await essai('mjs-vb-page', 'defile', true, async (page) => {
          await page.waitForTimeout(300)
          const r = await copies(page)
          assert.deepEqual(r.defile, [true, false], `défilé horizontal : une seule copie rendue ${JSON.stringify(r)}`)
          assert.deepEqual(r.haut, [true, false], `défilé vertical : une seule copie rendue ${JSON.stringify(r)}`)
          assert.equal(r.animations, 0, 'la piste ne bouge pas')
          assert.equal(r.decalage, 0, 'la copie reste au début de la balise')
        })
      })

      it('*marquee sans « réduire les animations » : les deux copies du texte sont rendues, la piste défile', async function () {
        if (!present) { this.skip(); return }
        await essai('mjs-vb-page', 'defile', false, async (page) => {
          await page.waitForTimeout(300)
          const r = await copies(page)
          assert.deepEqual(r.defile, [true, true], `défilé horizontal : les deux copies ${JSON.stringify(r)}`)
          assert.deepEqual(r.haut, [true, true], `défilé vertical : les deux copies ${JSON.stringify(r)}`)
          assert.equal(r.animations, 1, 'la piste défile')
        })
      })

      // l'état des carreaux d'une balise
      const carreaux = (page: any, classe: string) => page.evaluate((c: string) => {
        const w: any = window
        const tuiles = w.__tuiles(c) as any[]
        const op = (t: any) => parseFloat(getComputedStyle(t).opacity)
        return {
          cachee:  w.__voile(c).hidden,
          total:   tuiles.length,
          pleines: tuiles.filter((t) => op(t) > 0.99).length,
          vides:   tuiles.filter((t) => op(t) < 0.01).length,
          enCours: tuiles.filter((t) => t.getAnimations().some((a: any) => a.transitionProperty === 'opacity')).length
        }
      }, classe)

      // attend les carreaux nés et l'effet actif (`nes`), tous pleins (`pleins`) ou tous envolés (`envoles`)
      const jusqua = (page: any, classe: string, quoi: 'nes' | 'pleins' | 'envoles') => page.waitForFunction(([c, q]: string[]) => {
        const w: any = window
        const tuiles = w.__tuiles(c) as any[]
        const op = (t: any) => parseFloat(getComputedStyle(t).opacity)
        if (q === 'nes') return tuiles.length > 0 && (w.__hote(c).getAttribute('mjs-fx-on') || '').split(' ').includes('pixels')
        if (q === 'pleins') return tuiles.length > 0 && tuiles.every((t) => op(t) > 0.99)
        return tuiles.length > 0 && tuiles.every((t) => op(t) < 0.01)
      }, [classe, quoi], { timeout: 20000 })

      const montre = async (page: any, classe: string) => {
        await page.evaluate((c: string) => { (window as any).__voile(c).hidden = false }, classe)
        await jusqua(page, classe, 'nes')
        await page.waitForTimeout(150)
      }

      // le jeu commence : des carreaux, pas déjà au bout (`nappe` : la nappe de l'explosion couvre encore la balise), leur fondu en cours
      const commence = async (page: any, classe: string, nappe = false) => {
        const r = await carreaux(page, classe)
        assert.ok(r.total > 50, `des carreaux : ${JSON.stringify(r)}`)
        if (nappe) assert.ok(r.vides < r.total / 2, `la nappe couvre encore la balise, elle n'est pas déjà envolée : ${JSON.stringify(r)}`)
        else assert.ok(r.pleines < r.total / 2, `le remplissage commence, les carreaux ne sont pas déjà pleins : ${JSON.stringify(r)}`)
        assert.ok(r.enCours > r.total / 2, `leur fondu est en cours : ${JSON.stringify(r)}`)
      }

      for (const [on, classe] of [['always', 'a'], ['view', 'v'], ['load', 'charge'], ['always', 'bloc']]) {
        it(`*pixels(on: ${on}) sur ${classe === 'bloc' ? 'une balise-composant' : 'une balise'} cachée à la pose puis montrée : le remplissage joue — les carreaux ne naissent pas pleins`, async function () {
          if (!present) { this.skip(); return }
          await essai('mjs-vb-carreaux', 'a', false, async (page) => {
            // `load` : la balise est posée à la main, cachée, avec ses réglages
            if (classe === 'charge') await page.evaluate(() => {
              const d = document.createElement('div')
              d.id     = 'charge'
              d.hidden = true
              document.body.appendChild(d)
              ;(window as any).µ._mjs_fx(null, d, 'pixels', { on: 'load', duration: '3s', stagger: '1s' })
            })
            const avant = await carreaux(page, classe)
            assert.ok(avant.cachee && avant.total === 0, `cachée à la pose, sans carreau : ${JSON.stringify(avant)}`)
            await montre(page, classe)
            await commence(page, classe)
            // et il finit : tous pleins
            await jusqua(page, classe, 'pleins')
          })
        })
      }

      for (const [on, classe] of [['view', 'm'], ['always', 't']]) {
        it(`*pixels(on: ${on}) sur une balise visible dès la pose : le remplissage joue aussi, puis finit`, async function () {
          if (!present) { this.skip(); return }
          await essai('mjs-vb-carreaux', 'a', false, async (page) => {
            await jusqua(page, classe, 'nes')
            await page.waitForTimeout(150)
            await commence(page, classe)
            await jusqua(page, classe, 'pleins')
          })
        })
      }

      it('*pixels(on: always) sur une balise cachée à la pose puis montrée, sous « réduire les animations » : les carreaux sont pleins d\'emblée, rien ne se joue', async function () {
        if (!present) { this.skip(); return }
        await essai('mjs-vb-carreaux', 'a', true, async (page) => {
          await montre(page, 'a')
          const r = await carreaux(page, 'a')
          assert.ok(r.total > 50, `des carreaux : ${JSON.stringify(r)}`)
          assert.ok(r.pleines === r.total && r.enCours === 0, `pleins d'emblée, aucun fondu : ${JSON.stringify(r)}`)
        })
      })

      it('*pixels(explode, on: always) sur une balise cachée à la pose puis montrée : la nappe couvre la balise, puis vole en éclats', async function () {
        if (!present) { this.skip(); return }
        await essai('mjs-vb-carreaux', 'e', false, async (page) => {
          await montre(page, 'e')
          await commence(page, 'e', true)
          await jusqua(page, 'e', 'envoles')
        })
      })

      // le réseau ne redessine rien quand rien ne bouge : sous « réduire les animations », hors de l'écran
      it('*particles(network) sous « réduire les animations » : une image dessinée, pas de boucle', async function () {
        if (!present) { this.skip(); return }
        await essai('mjs-vb-page', 'reseau', true, async (page) => {
          await page.waitForFunction(() => (window as any).__dessins > 0)
          await page.waitForTimeout(500)
          const a = await page.evaluate(() => (window as any).__dessins)
          await page.waitForTimeout(700)
          const b = await page.evaluate(() => (window as any).__dessins)
          assert.ok(b - a <= 1, `images dessinées en 700 ms : ${b - a}`)
        })
      })

      it('*particles(network) : à l\'écran il tourne, hors de l\'écran il ne dessine plus rien', async function () {
        if (!present) { this.skip(); return }
        await essai('mjs-vb-page', 'reseau', false, async (page) => {
          await page.waitForFunction(() => (window as any).__dessins > 0)
          const n0 = await page.evaluate(() => (window as any).__dessins)
          await page.waitForTimeout(500)
          const n1 = await page.evaluate(() => (window as any).__dessins)
          assert.ok(n1 - n0 > 3, `à l'écran il se redessine : ${n1 - n0} images en 500 ms`)
          await page.evaluate(() => window.scrollTo(0, 5000))
          await page.waitForTimeout(400)
          const a = await page.evaluate(() => (window as any).__dessins)
          await page.waitForTimeout(700)
          const b = await page.evaluate(() => (window as any).__dessins)
          assert.ok(b - a <= 1, `hors de l'écran, images dessinées en 700 ms : ${b - a}`)
        })
      })
    })
  }
})
