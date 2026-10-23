// une transition à découpe posée directement (*iris, *volet, *bars : leur première image est un clip-path d'aire
// nulle) avec `on: view`, le défaut : elle joue quand la balise arrive à l'écran, comme *fade — déjà à l'écran au
// chargement, sous le pli puis défilée, et de nouveau après une sortie avec `once: false`. Chromium compte la découpe
// de la balise elle-même dans ce que voit l'observateur de visibilité : tenue dans sa première image découpée, la
// balise n'y était jamais « vue », et restait cachée pour toujours ; Firefox jouait
// en attendant, la balise est tenue par la seule opacité, sans recevoir les clics (*blocks compris, sa première image
// est un polygone d'aire nulle) ; une sortie finie est défaite avant l'entrée suivante, quelle que soit la transition ;
// la sortie interrompue par un retour à l'écran, et le réglage changé pendant l'entrée, pendant ou après une sortie,
// laissent la balise à sa place
// Firefox et WebKit ne sont là que s'ils sont installés (le test est alors sauté)

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readdirSync, readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { mjsTmp } from './helpers/tmp.js'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { stripEsm } from '../src/server/renderToString.js'

type Engine = 'chromium' | 'firefox' | 'webkit'

async function browserPresent(name: Engine): Promise<boolean> {
  try {
    const playwright = await import('playwright')
    return existsSync(playwright[name].executablePath())
  } catch {
    return false
  }
}

const IMG = 'data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 width=%22300%22 height=%22200%22%3E%3Crect width=%22300%22 height=%22200%22 fill=%22%23e11d48%22/%3E%3C/svg%3E'

// en haut, à l'écran dès le chargement ; sous le pli, après une grande marge ; tout en bas, une entrée qui rejoue ;
// puis chaque cas à part, séparé par une marge : le réglage `on` changé pendant la sortie, la sortie interrompue par un
// retour, le réglage changé après la sortie, *blocks, les clics, une balise plus haute que l'écran, et six transitions
// qui rejouent leur entrée après une sortie
const SOURCE = [
  '<script>',
  '$m = \'view\'',
  '$n = \'view\'',
  '$z = \'view\'',
  '</script>',
  `<img class="el" id="v-iris" src="${IMG}" alt="" *iris(duration: 300ms)>`,
  `<img class="el" id="v-volet" src="${IMG}" alt="" *volet(duration: 300ms)>`,
  `<img class="el" id="v-bars" src="${IMG}" alt="" *bars(duration: 300ms)>`,
  `<img class="el" id="v-fade" src="${IMG}" alt="" *fade(duration: 300ms)>`,
  '<div class="marge"></div>',
  `<img class="el" id="s-iris" src="${IMG}" alt="" *iris(duration: 300ms)>`,
  `<img class="el" id="s-volet" src="${IMG}" alt="" *volet(duration: 300ms)>`,
  `<img class="el" id="s-bars" src="${IMG}" alt="" *bars(duration: 300ms)>`,
  '<div class="marge"></div>',
  `<img class="el" id="r-iris" src="${IMG}" alt="" *iris(duration: 300ms, once: false)>`,
  '<div class="marge"></div>',
  `<img class="el" id="g-repose" src="${IMG}" alt="" *iris(on: $m, once: false, duration: 1500ms)>`,
  '<div class="marge"></div>',
  `<img class="el" id="g-retour" src="${IMG}" alt="" *iris(once: false, duration: 1500ms)>`,
  '<div class="marge"></div>',
  `<img class="el" id="g-apres" src="${IMG}" alt="" *reveal(on: $n, once: false, duration: 300ms)>`,
  '<div class="marge"></div>',
  `<img class="el" id="m-iris" src="${IMG}" alt="" *iris(once: false, duration: 300ms)>`,
  '<div class="marge"></div>',
  `<img class="el" id="m-bars" src="${IMG}" alt="" *bars(once: false, duration: 300ms)>`,
  '<div class="marge"></div>',
  `<img class="el" id="m-sortie" src="${IMG}" alt="" *iris(once: false, duration: 1500ms)>`,
  '<div class="marge"></div>',
  `<img class="el" id="z-zombie" src="${IMG}" alt="" *iris(on: $z, once: false, duration: 1500ms)>`,
  '<div class="marge"></div>',
  `<img class="el clic" id="k-blocks" src="${IMG}" alt="" *blocks(duration: 300ms)>`,
  '<div class="marge"></div>',
  `<img class="el clic" id="k-iris" src="${IMG}" alt="" *iris(duration: 300ms)>`,
  '<div class="marge"></div>',
  '<div class="grande" id="k-grande" *iris(duration: 300ms)></div>',
  '<div class="marge"></div>',
  `<img class="el" id="e-reveal" src="${IMG}" alt="" *reveal(once: false, duration: 300ms)>`,
  `<img class="el" id="e-turn" src="${IMG}" alt="" *turn(once: false, duration: 300ms)>`,
  `<img class="el" id="e-fade" src="${IMG}" alt="" *fade(once: false, duration: 300ms)>`,
  `<img class="el" id="e-fly" src="${IMG}" alt="" *fly(once: false, duration: 300ms)>`,
  `<img class="el" id="e-volet" src="${IMG}" alt="" *volet(once: false, duration: 300ms)>`,
  `<img class="el" id="e-bars" src="${IMG}" alt="" *bars(once: false, duration: 300ms)>`,
  '<div class="marge"></div>',
  '<style>',
  ':host',
  '  display: block',
  '.el',
  '  display: inline-block',
  '  width: 150px',
  '  height: 100px',
  '  margin: 4px',
  '.clic',
  '  pointer-events: all',
  '.grande',
  '  height: 2500px',
  '  background: #e11d48',
  '.marge',
  '  height: 2400px',
  '</style>',
  ''
].join('\n')

const REJEUX = ['e-reveal', 'e-turn', 'e-fade', 'e-fly', 'e-volet', 'e-bars']

describe('les transitions à découpe posées directement jouent quand la balise arrive à l\'écran (navigateurs réels)', function () {
  this.timeout(240000)
  let script = ''

  before(async function () {
    const root   = mjsTmp('effets-transitions-decoupe-vue-browser')
    const srcDir = join(root, 'src')
    const outDir = join(root, 'out')
    mkdirSync(srcDir, { recursive: true })
    writeFileSync(join(srcDir, 'vue-decoupe.mjs'), SOURCE)
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
          console.log(`  ℹ️  ${name} non installé, test des transitions à découpe sauté. Activer : \`npx playwright install ${name}\``)
          return
        }
        const playwright = await import('playwright')
        browser = await playwright[name].launch()
        page = await browser.newPage({ viewport: { width: 900, height: 700 } })
        page.on('pageerror', (e: any) => errors.push(String(e.message ?? e)))
        await page.route('http://t.test/**', (route: any) => {
          if (route.request().url() !== 'http://t.test/') return route.fulfill({ status: 404, body: '' })
          return route.fulfill({ contentType: 'text/html', body: `<!doctype html><html><head><meta charset="utf-8"><style>html,body{margin:0}</style></head><body><mjs-vue-decoupe></mjs-vue-decoupe><script>${script}</script></body></html>` })
        })
        await page.goto('http://t.test/', { waitUntil: 'load' })
        await page.waitForFunction(() => !!(document.querySelector('mjs-vue-decoupe') as any)?._shadow?.querySelector('#e-bars'))
        await page.evaluate(() => {
          const w = window as any
          w.__el = (id: string) => (document.querySelector('mjs-vue-decoupe') as any)._shadow.querySelector('#' + id)
          // l'entrée a joué jusqu'au bout : plus d'animation, plus de découpe, pleinement opaque, à sa place
          w.__joue = (id: string) => {
            const el = w.__el(id)
            const cs = getComputedStyle(el)
            return el.getAnimations().length === 0 && cs.clipPath === 'none' && cs.opacity === '1' && cs.visibility === 'visible' && cs.transform === 'none'
          }
          // ce qu'on voit d'elle : rien tant qu'elle attend (opacité nulle, cachée, ou découpe d'aire nulle)
          w.__cachee = (id: string) => {
            const cs = getComputedStyle(w.__el(id))
            return cs.opacity === '0' || cs.visibility === 'hidden' || /^circle\(0%|^inset\(100%|^inset\(0(px)? 0(px)? 100%|^inset\(0(px)? 100%|^polygon/.test(cs.clipPath)
          }
          // une transition est en cours : une animation à durée, qui court
          w.__cours = (id: string) => w.__el(id).getAnimations().some((a: any) => a.playState === 'running' && a.effect.getComputedTiming().activeDuration > 0)
          // la balise attend à l'écart de sa place (cachée, déplacée ou découpée), rien ne la joue
          w.__repos = (id: string) => {
            const cs = getComputedStyle(w.__el(id))
            return !w.__cours(id) && (cs.opacity !== '1' || cs.transform !== 'none' || cs.clipPath !== 'none')
          }
          // le test vrai `n` images de suite (une image de passage, entre deux animations, ne compte pas), faux au bout de `ms`
          w.__tenu = (test: () => boolean, n: number, ms: number) => new Promise((ok) => {
            const t0 = performance.now()
            let vrai = 0
            const image = () => {
              vrai = test() ? vrai + 1 : 0
              if (vrai >= n) return ok(true)
              if (performance.now() - t0 > ms) return ok(false)
              requestAnimationFrame(image)
            }
            image()
          })
          // un réglage de la maquette changé en route
          w.__regler = (nom: string, valeur: string) => w.µ._set(document.querySelector('mjs-vue-decoupe'), nom, valeur)
          // la balise au milieu de l'écran
          w.__voir = (id: string) => { const r = w.__el(id).getBoundingClientRect(); window.scrollBy(0, r.top - 300) }
          // seuls `px` pixels de sa hauteur sont à l'écran, en bas
          w.__bande = (id: string, px: number) => { const r = w.__el(id).getBoundingClientRect(); window.scrollBy(0, r.top - (window.innerHeight - px)) }
          // seuls `px` pixels de sa hauteur sont à l'écran, en haut
          w.__haut = (id: string, px: number) => { const r = w.__el(id).getBoundingClientRect(); window.scrollBy(0, r.bottom - px) }
          // les clics que reçoivent ces balises
          w.__clics = []
          for (const id of ['k-blocks', 'k-iris', 'k-grande']) w.__el(id).addEventListener('click', () => w.__clics.push(id))
        })
      })

      after(async () => { if (browser) await browser.close() })

      const attendre = async (ids: string[], quoi: string) => {
        try {
          await page.waitForFunction((l: string[]) => l.every((id) => (window as any).__joue(id)), ids, { timeout: 12000 })
        } catch {
          const etat = await page.evaluate((l: string[]) => l.map((id) => { const el = (window as any).__el(id); const cs = getComputedStyle(el); return id + ' : ' + cs.clipPath + ' / ' + cs.opacity + ' / ' + cs.transform + ' / ' + el.getAnimations().map((a: any) => a.playState).join(',') }), ids)
          assert.fail(quoi + ' — ' + etat.join(' ; '))
        }
      }

      // la sortie des balises a fini : plus rien ne joue, elles attendent à l'écart de leur place
      const sorties = async (ids: string[], quoi: string) => {
        const fini = await page.evaluate((l: string[]) => (window as any).__tenu(() => l.every((id) => (window as any).__repos(id)), 3, 12000), ids)
        assert.ok(fini, quoi)
      }

      // seuls `px` pixels de la balise sont à l'écran : l'observateur de visibilité a eu le temps de dire ce qu'il en pense
      const bande = async (id: string, px: number) => {
        await page.evaluate(([i, p]: [string, number]) => (window as any).__bande(i, p), [id, px])
        await page.evaluate(() => (window as any).__tenu(() => true, 12, 12000))
      }

      // ce que la balise montre et laisse passer : [opacité, pointer-events]
      const montre = (id: string) => page.evaluate((i: string) => { const cs = getComputedStyle((window as any).__el(i)); return [cs.opacity, cs.pointerEvents] }, id)

      // un vrai clic à `dy` pixels sous le haut de la balise ; rend les balises qui l'ont reçu
      const cliquer = async (id: string, dy: number) => {
        await page.evaluate(() => { (window as any).__clics.length = 0 })
        const pos = await page.evaluate(([i, d]: [string, number]) => { const r = (window as any).__el(i).getBoundingClientRect(); return { x: r.left + 50, y: r.top + d } }, [id, dy])
        await page.mouse.click(pos.x, pos.y)
        return page.evaluate(() => (window as any).__clics.slice())
      }

      it('à l\'écran dès le chargement : *iris, *volet, *bars jouent leur entrée, comme *fade', async function () {
        if (!present) { this.skip(); return }
        await attendre(['v-iris', 'v-volet', 'v-bars', 'v-fade'], 'une transition déjà à l\'écran n\'a pas joué')
        assert.deepEqual(errors, [])
      })

      it('sous le pli : cachées en attendant, elles jouent quand on les fait défiler à l\'écran', async function () {
        if (!present) { this.skip(); return }
        const avant = await page.evaluate(() => ['s-iris', 's-volet', 's-bars'].map((id) => (window as any).__cachee(id)))
        assert.deepEqual(avant, [true, true, true], 'sous le pli, elles attendent cachées')
        await page.evaluate(() => (window as any).__voir('s-volet'))
        await attendre(['s-iris', 's-volet', 's-bars'], 'une transition défilée à l\'écran n\'a pas joué')
        assert.deepEqual(errors, [])
      })

      it('once: false : défilée à l\'écran elle entre, sortie de l\'écran elle sort, revenue elle entre de nouveau', async function () {
        if (!present) { this.skip(); return }
        await page.evaluate(() => (window as any).__voir('r-iris'))
        await attendre(['r-iris'], 'première entrée')
        await page.evaluate(() => window.scrollTo(0, 0))
        await page.waitForFunction(() => (window as any).__cachee('r-iris') && (window as any).__el('r-iris').getAnimations().every((a: any) => a.playState !== 'running'), null, { timeout: 8000 })
        await page.evaluate(() => (window as any).__voir('r-iris'))
        await attendre(['r-iris'], 'retour à l\'écran')
        assert.deepEqual(errors, [])
      })

      it('le déclencheur change pendant la sortie : la balise rejoue à sa place, elle ne reste pas tenue cachée', async function () {
        if (!present) { this.skip(); return }
        await page.evaluate(() => (window as any).__voir('g-repose'))
        await attendre(['g-repose'], 'première entrée')
        await page.evaluate(() => window.scrollTo(0, 0))
        await page.waitForFunction(() => (window as any).__cours('g-repose'), null, { timeout: 12000 })
        await page.evaluate(() => (window as any).__regler('m', 'load'))
        await attendre(['g-repose'], 'le déclencheur a changé pendant la sortie')
        assert.deepEqual(errors, [])
      })

      it('la sortie est interrompue par un retour à l\'écran : l\'entrée repart d\'où la sortie en était, la balise ne reste pas tenue cachée', async function () {
        if (!present) { this.skip(); return }
        await page.evaluate(() => (window as any).__voir('g-retour'))
        await attendre(['g-retour'], 'première entrée')
        await page.evaluate(() => window.scrollTo(0, 0))
        await page.waitForFunction(() => (window as any).__cours('g-retour'), null, { timeout: 12000 })
        // le rayon de la découpe avant le retour, puis sur les images qui suivent : l'entrée ne retombe pas à sa première image
        const rayons = await page.evaluate(() => {
          const w = window as any
          const rayon = () => { const m = /^circle\(([\d.]+)%/.exec(getComputedStyle(w.__el('g-retour')).clipPath); return m ? Number(m[1]) : 72 }
          const avant = rayon()
          w.__voir('g-retour')
          return new Promise((ok) => {
            const apres: number[] = []
            const image = () => {
              apres.push(rayon())
              if (apres.length >= 12) return ok({ avant, apres })
              requestAnimationFrame(image)
            }
            image()
          })
        })
        assert.ok(Math.min(...rayons.apres) >= rayons.avant / 4, 'l\'entrée est repartie de la première image : rayon ' + rayons.avant + ' % avant le retour, ' + rayons.apres.join(', ') + ' après')
        await attendre(['g-retour'], 'retour à l\'écran avant la fin de la sortie')
        assert.deepEqual(errors, [])
      })

      it('le déclencheur change après la sortie : la sortie gardée est défaite, la balise rejoue à sa place', async function () {
        if (!present) { this.skip(); return }
        await page.evaluate(() => (window as any).__voir('g-apres'))
        await attendre(['g-apres'], 'première entrée')
        await page.evaluate(() => window.scrollTo(0, 0))
        await sorties(['g-apres'], 'la sortie n\'a pas fini')
        await page.evaluate(() => (window as any).__regler('n', 'load'))
        await attendre(['g-apres'], 'le déclencheur a changé après la sortie')
        assert.deepEqual(errors, [])
      })

      it('once: false : une balise coupée par le bord de l\'écran, dont le centre est dehors mais dont plus de 15 % sont visibles, entre et y reste', async function () {
        if (!present) { this.skip(); return }
        // *iris part du centre de la balise, *bars de son bord haut : la première est coupée par le bas de l'écran, la seconde par le haut ;
        // l'observateur ne voit alors rien de leur première image, qu'il ne doit pas prendre pour une sortie
        for (const [id, placer, ressortie] of [['m-iris', '__bande', true], ['m-bars', '__haut', false]] as [string, string, boolean][]) {
          if (ressortie) {
            // entrée puis ressortie une fois : sa tenue d'attente est refaite, c'est elle que l'observateur lit
            await page.evaluate((i: string) => (window as any).__voir(i), id)
            await attendre([id], id + ' : première entrée')
            await page.evaluate(() => window.scrollTo(0, 0))
            await sorties([id], id + ' : la sortie n\'a pas fini')
          }
          await page.evaluate(([i, f]: string[]) => (window as any)[f](i, 30), [id, placer])
          await attendre([id], id + ' : la balise coupée par le bord de l\'écran n\'a pas joué')
          const calme = await page.evaluate((i: string) => (window as any).__tenu(() => (window as any).__joue(i), 30, 12000), id)
          assert.ok(calme, id + ' : elle ne reste pas entrée, elle se défait en boucle')
        }
        assert.deepEqual(errors, [])
      })

      it('once: false : la balise qui quitte l\'écran pendant son entrée sort dès que l\'entrée est finie', async function () {
        if (!present) { this.skip(); return }
        await page.evaluate(() => (window as any).__voir('m-sortie'))
        await page.waitForFunction(() => (window as any).__cours('m-sortie'), null, { timeout: 12000 })
        await page.evaluate(() => window.scrollTo(0, 0))
        await sorties(['m-sortie'], 'la balise sortie de l\'écran pendant son entrée est restée entrée')
        assert.deepEqual(errors, [])
      })

      it('le déclencheur change pendant l\'entrée : l\'ancien effet ne touche plus à la balise, qui quitte l\'écran et y revient à sa place', async function () {
        if (!present) { this.skip(); return }
        const entiere = (id: string) => page.evaluate((i: string) => (window as any).__tenu(() => (window as any).__joue(i), 30, 12000), id)
        await page.evaluate(() => (window as any).__voir('z-zombie'))
        await page.waitForFunction(() => (window as any).__cours('z-zombie'), null, { timeout: 12000 })
        await page.evaluate(() => (window as any).__regler('z', 'load'))
        await attendre(['z-zombie'], 'le déclencheur a changé pendant l\'entrée')
        // posé au chargement, le nouvel effet ne suit plus l'écran : l'ancien, arrêté, ne doit plus ni la sortir ni la rejouer
        await page.evaluate(() => window.scrollTo(0, 0))
        assert.ok(await entiere('z-zombie'), 'sortie de l\'écran : l\'ancien effet a repris la balise')
        await page.evaluate(() => (window as any).__voir('z-zombie'))
        assert.ok(await entiere('z-zombie'), 'retour à l\'écran : l\'ancien effet a repris la balise')
        assert.deepEqual(errors, [])
      })

      it('*blocks, tenue comme les autres découpes : rien à voir ni à cliquer en attendant, puis elle joue', async function () {
        if (!present) { this.skip(); return }
        await bande('k-blocks', 10)
        assert.deepEqual(await montre('k-blocks'), ['0', 'none'], 'en attendant, rien ne se voit et les clics passent')
        assert.deepEqual(await cliquer('k-blocks', 5), [], 'un clic dans la bande visible traverse la balise')
        await page.evaluate(() => (window as any).__voir('k-blocks'))
        await attendre(['k-blocks'], '*blocks n\'a pas joué')
        assert.deepEqual(await cliquer('k-blocks', 50), ['k-blocks'], 'jouée, elle reçoit de nouveau les clics')
        assert.deepEqual(await montre('k-blocks'), ['1', 'all'], 'la valeur de pointer-events de l\'auteur est rendue telle quelle')
        assert.deepEqual(errors, [])
      })

      it('en attendant, une balise à découpe laisse passer les clics, même plus haute que l\'écran ; jouée, elle les reprend', async function () {
        if (!present) { this.skip(); return }
        // une balise de 100 px dont 10 px sont à l'écran, une de 2 500 px dont 100 px le sont : moins de 15 % d'elle, ou de l'écran
        for (const [id, px, auteur] of [['k-iris', 10, 'all'], ['k-grande', 100, 'auto']] as [string, number, string][]) {
          await bande(id, px)
          assert.deepEqual(await montre(id), ['0', 'none'], id + ' : en attendant, rien ne se voit et les clics passent')
          assert.deepEqual(await cliquer(id, px / 2), [], id + ' : un clic dans la bande visible traverse la balise')
          await page.evaluate((i: string) => (window as any).__voir(i), id)
          await attendre([id], id + ' n\'a pas joué')
          assert.deepEqual(await cliquer(id, 50), [id], id + ' : jouée, elle reçoit de nouveau les clics')
          assert.deepEqual(await montre(id), ['1', auteur], id + ' : la valeur de pointer-events de l\'auteur est rendue telle quelle')
        }
        assert.deepEqual(errors, [])
      })

      it('once: false : entrée, sortie, entrée — chaque transition finit à sa place, sans animation gardée', async function () {
        if (!present) { this.skip(); return }
        await page.evaluate(() => (window as any).__voir('e-reveal'))
        await attendre(REJEUX, 'première entrée')
        await page.evaluate(() => window.scrollTo(0, 0))
        await sorties(REJEUX, 'les sorties n\'ont pas fini')
        await page.evaluate(() => (window as any).__voir('e-reveal'))
        await attendre(REJEUX, 'seconde entrée')
        assert.deepEqual(errors, [])
      })
    })
  }
})
