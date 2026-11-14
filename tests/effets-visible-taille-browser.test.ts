// `visible:` sur une balise qui change de taille, en vrais navigateurs (Chromium, Firefox, WebKit). Une balise qui devient plus haute que
// l'écran pendant qu'elle y est en partie (hauteur changée, image chargée tard), une fenêtre ou une zone qui défile qui rétrécit : la part
// se mesure de nouveau, la balise part quand elle remplit ce qu'elle peut montrer, et ne reste jamais cachée. Une haute balise dont l'effet
// tourne ne refait pas son observateur à chaque image ; le panneau d'inspection change la part d'une transition déjà posée ; sans
// `visible`, ni observateur de taille ni observateur de vue de plus. Une vraie mise en page est nécessaire : pas de happy-dom.

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readdirSync, readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { mjsTmp } from './helpers/tmp.js'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { stripEsm } from '../src/server/renderToString.js'
import { playTogether } from './helpers/engines-together.js'

type Moteur = 'chromium' | 'firefox' | 'webkit'

async function navigateurPresent(nom: Moteur): Promise<boolean> {
  try {
    const playwright = await import('playwright')
    return existsSync(playwright[nom].executablePath())
  } catch {
    return false
  }
}

const GRANDIT = [
  '<div class="vide"></div>',
  '<div class="g" id="g0" *stagger(visible: 100%)>témoin sans croissance</div>', '<div class="vide"></div>',
  '<div class="g" id="g1" *fade(visible: 100%)>transition qui grandit</div>', '<div class="vide"></div>',
  '<div class="g" id="g2" *stagger(visible: 100%)>se joue, grandit</div>', '<div class="vide"></div>',
  '<div class="g" id="g3" *ink(on: view, visible: 100%)>encre, grandit</div>', '<div class="vide"></div>',
  '<div class="g" id="g4" *pulse(on: view, visible: 100%)>boucle, grandit</div>', '<div class="vide"></div>',
  '<div id="h0r"></div><div class="c cache" id="h0" *stagger(visible: 100%)>cachée puis montrée</div>', '<div class="vide"></div>',
  '<style>', '.vide', '  height: 1200px', '.g', '  height: 700px', '.c', '  height: 200px', '.cache', '  display: none', '</style>',
].join('\n')

const TAILLE = [
  '<div class="vide"></div>',
  '<div class="t" id="r0" *stagger(visible: 100%)>témoin, fenêtre fixe</div>', '<div class="vide"></div>',
  '<div class="t" id="r1" *stagger(visible: 100%)>se joue, fenêtre réduite</div>', '<div class="vide"></div>',
  '<div class="t" id="r2" *fade(visible: 100%)>transition, fenêtre réduite</div>', '<div class="vide"></div>',
  '<div class="t" id="r3" *pulse(on: view, visible: 100%)>boucle, fenêtre réduite</div>', '<div class="vide"></div>',
  '<style>', '.vide', '  height: 2400px', '.t', '  height: 2000px', '</style>',
].join('\n')

const ZONE = [
  '<div class="vide"></div>',
  '<div class="zone" id="zone"><div class="article" id="article" *stagger(visible: 100%)>article dans une zone qui rétrécit</div></div>',
  '<div class="vide"></div>',
  '<style>', '.vide', '  height: 1200px', '.zone', '  width: 300px', '  height: 300px', '  overflow: auto', '.article', '  height: 3000px', '</style>',
].join('\n')

const RESTE = [
  '<div class="vide"></div>',
  '<figure class="f" id="g5" *ink(on: view, visible: 100%)><div class="txt">écran du téléphone</div><img id="g5i" alt=""></figure>', '<div class="vide"></div>',
  '<div class="g" id="g6" *fade(visible: 100%)>transition qui grandit, opacité</div>', '<div class="vide"></div>',
  '<div class="c" id="p1" *fade(visible: 100%)>panneau : 100 puis 50</div>', '<div class="vide"></div>',
  '<div class="c" id="o1" *fade(visible: 100%, once: false)>once false</div>', '<div class="vide"></div>',
  '<style>', '.vide', '  height: 1200px', '.f', '  margin: 0', '.txt', '  height: 600px', '.f img', '  display: block', '  width: 100%', '.g', '  height: 700px', '.c', '  height: 200px', '</style>',
].join('\n')

const TOURNE = [
  '<div class="vide"></div>',
  '<div class="haut" id="s1" *spin(on: view, visible: 50%)>haute balise qui tourne</div>',
  '<div class="vide"></div>',
  '<style>', '.vide', '  height: 1200px', '.haut', '  height: 2000px', '</style>',
].join('\n')

const compte = (v: string) => [...Array.from({ length: 20 }, (_, i) => `<div class="vide"></div>\n<div class="b" id="c${i}" *fade(on: view${v})>c${i}</div>\n<div class="b" id="d${i}" *pulse(on: view${v})>d${i}</div>`), '<div class="vide"></div>', '<style>', '.vide', '  height: 300px', '.b', '  height: 200px', '</style>'].join('\n')

// posé avant le montage : lectures de style, observateurs de vue et observateurs de taille créés, comptés
const CROCHET = `(function(){
  var w = window; w.__gcs = 0; w.__io = 0; w.__ro = 0;
  var g = w.getComputedStyle; w.getComputedStyle = function(){ w.__gcs++; return g.apply(this, arguments); };
  var IO = w.IntersectionObserver; w.IntersectionObserver = function(a, b){ w.__io++; return new IO(a, b); }; w.IntersectionObserver.prototype = IO.prototype;
  var RO = w.ResizeObserver; if (RO) { w.ResizeObserver = function(a){ w.__ro++; return new RO(a); }; w.ResizeObserver.prototype = RO.prototype; }
})();`

describe('visible : une balise qui change de taille (navigateurs réels)', function () {
  this.timeout(280000)
  let script = ''

  before(async function () {
    const root   = mjsTmp('effets-visible-taille-browser')
    const srcDir = join(root, 'src')
    const outDir = join(root, 'out')
    mkdirSync(srcDir, { recursive: true })
    writeFileSync(join(srcDir, 'v-grandit.mjs'), GRANDIT + '\n')
    writeFileSync(join(srcDir, 'v-taille.mjs'), TAILLE + '\n')
    writeFileSync(join(srcDir, 'v-zone.mjs'), ZONE + '\n')
    writeFileSync(join(srcDir, 'v-reste.mjs'), RESTE + '\n')
    writeFileSync(join(srcDir, 'v-tourne.mjs'), TOURNE + '\n')
    writeFileSync(join(srcDir, 'v-compte-sans.mjs'), compte('') + '\n')
    writeFileSync(join(srcDir, 'v-compte-avec.mjs'), compte(', visible: 50%') + '\n')
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
    playTogether(describe(nom, function () {
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
      })

      after(async () => { if (browser) await browser.close() })

      // une page neuve (390 × 844) qui monte le composant `mjs-<t>` ; chaque entrée d'une transition jouée est comptée sur sa balise
      async function ouvrir(t: string) {
        if (page) await page.close()
        const tag = 'mjs-' + t
        page = await browser.newPage({ viewport: { width: 390, height: 844 } })
        await page.route('http://t.test/**', (route: any) => {
          if (route.request().url() !== 'http://t.test/') return route.fulfill({ status: 404, body: '' })
          return route.fulfill({ contentType: 'text/html', body: `<!doctype html><html><head><meta charset="utf-8"><style>html,body{margin:0}</style></head><body><script>${script}</script><script>${CROCHET}</script><script>document.body.appendChild(document.createElement('${tag}'))</script></body></html>` })
        })
        await page.goto('http://t.test/', { waitUntil: 'load' })
        await page.waitForFunction((x: string) => !!(document.querySelector(x) as any)?._shadow?.querySelector('[mjs-fx]'), tag)
        await page.evaluate((x: string) => {
          const w: any = window
          const jouer = w.µ._mjs_playTransition
          w.µ._mjs_playTransition = function(this: any, ...args: any[]) {
            if (args[2] === 'in') args[0].__entrees = (args[0].__entrees || 0) + 1
            return jouer.apply(this, args)
          }
          w.__trouve = (id: string) => (document.querySelector(x) as any)._shadow.querySelector('#' + id)
        }, tag)
      }

      // le haut de la balise placé à `haut` px du haut de l'écran
      async function placer(id: string, haut: number, ms = 350) {
        await page.evaluate(([i, h]: [string, number]) => { window.scrollBy(0, (window as any).__trouve(i).getBoundingClientRect().top - h) }, [id, haut])
        await page.waitForTimeout(ms)
      }
      const entrees = (id: string) => page.evaluate((i: string) => (window as any).__trouve(i).__entrees || 0, id)
      const entree  = async (id: string) => (await entrees(id)) > 0
      const attend  = (id: string) => page.evaluate((i: string) => (window as any).__trouve(i).hasAttribute('mjs-fx-wait'), id)
      const joue    = async (id: string) => !(await attend(id))
      const tourne  = (id: string) => page.evaluate((i: string) => (window as any).__trouve(i).style.getPropertyValue('--mjs-fx-pulse-go') !== 'none', id)
      const hauteur = (id: string, px: number) => page.evaluate(([i, h]: [string, number]) => { (window as any).__trouve(i).style.height = h + 'px' }, [id, px])
      // l'opacité revenue à 1 (l'entrée jouée jusqu'au bout), au plus 4 s
      const visibleEnfin = (id: string) => page.waitForFunction((i: string) => getComputedStyle((window as any).__trouve(i)).opacity === '1', id, { timeout: 4000 }).then(() => true, () => false)

      it('une balise qui devient plus haute que l\'écran pendant qu\'elle y est en partie part quand elle le remplit', async function () {
        if (!present) { this.skip(); return }
        await ouvrir('v-grandit')
        const etat: string[] = []
        await placer('g0', 444)
        await placer('g0', 100)
        etat.push('g0 témoin, entière : ' + (await joue('g0') ? 'partie' : 'ATTEND'))
        for (const [id, f] of [['g1', entree], ['g2', joue], ['g3', entree], ['g4', tourne]] as Array<[string, (i: string) => Promise<boolean>]>) {
          await placer(id, 444)
          const avant = await f(id)
          const io0   = await page.evaluate(() => (window as any).__io)
          await hauteur(id, 1000)
          await page.waitForTimeout(350)
          // un changement de taille refait au plus un observateur
          const refaits = (await page.evaluate(() => (window as any).__io)) - io0
          await placer(id, -60)
          const rempli = await f(id)
          await placer(id, -110)
          const encore = await f(id)
          etat.push(`${id} : 400 px sur 700 → ${avant ? 'TROP TÔT' : 'attend'} ; devenue 1000 px (${refaits} observateur refait${refaits > 1 ? ', TROP' : ''}), remplit l'écran → ${rempli ? 'partie' : 'ATTEND'} ; 50 px plus bas → ${encore ? 'partie' : 'ATTEND'}`)
        }
        await placer('h0r', 300)
        await page.evaluate(() => (window as any).__trouve('h0').classList.remove('cache'))
        await page.waitForTimeout(400)
        etat.push('h0 cachée puis montrée entière → ' + (await joue('h0') ? 'partie' : 'ATTEND'))
        console.log(`    [${nom}] ` + etat.join(' | '))
        assert.ok(!etat.some((e) => e.includes('ATTEND') || e.includes('TROP')), etat.join(' | '))
      })

      it('une fenêtre qui rétrécit pendant qu\'une haute balise y est en partie : elle part quand elle remplit l\'écran', async function () {
        if (!present) { this.skip(); return }
        await ouvrir('v-taille')
        const etat: string[] = []
        await placer('r0', 250)
        await placer('r0', -100)
        etat.push('r0 témoin : ' + (await joue('r0') ? 'partie' : 'ATTEND'))
        for (const [id, f] of [['r1', joue], ['r2', entree], ['r3', tourne]] as Array<[string, (i: string) => Promise<boolean>]>) {
          await page.setViewportSize({ width: 390, height: 844 })
          await placer(id, 250)
          const avant = await f(id)
          await page.setViewportSize({ width: 390, height: 700 })
          await page.waitForTimeout(350)
          await placer(id, -100)
          const rempli = await f(id)
          await placer(id, -300)
          const encore = await f(id)
          etat.push(`${id} : 594 px sur 2000 → ${avant ? 'TROP TÔT' : 'attend'} ; fenêtre 844 → 700, remplit l'écran → ${rempli ? 'partie' : 'ATTEND'} ; 200 px plus bas → ${encore ? 'partie' : 'ATTEND'}`)
        }
        console.log(`    [${nom}] ` + etat.join(' | '))
        assert.ok(!etat.some((e) => e.includes('ATTEND') || e.includes('TROP TÔT')), etat.join(' | '))
      })

      it('une zone qui défile et rétrécit jusqu\'à tenir à l\'écran : l\'article qui la remplit part', async function () {
        if (!present) { this.skip(); return }
        await ouvrir('v-zone')
        await placer('zone', 844 - 200)
        assert.equal(await joue('article'), false, '200 px de la zone sur 300')
        await page.evaluate(() => { (window as any).__trouve('zone').style.height = '160px' })
        await page.waitForTimeout(350)
        const rentree = await joue('article')
        await placer('zone', 844 - 300)
        assert.equal(rentree, true, 'zone réduite à 160 px, entière à l\'écran')
        assert.equal(await joue('article'), true, 'zone entière, 140 px plus haut')
      })

      it('une image chargée tard : *ink et *fade partent quand la balise remplit l\'écran, opacité rendue', async function () {
        if (!present) { this.skip(); return }
        await ouvrir('v-reste')
        const IMG = 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="390" height="400"><rect width="390" height="400" fill="#36c"/></svg>')
        await placer('g5', 444)
        assert.equal(await entree('g5'), false, '*ink : 400 px sur 600')
        await page.evaluate(([u]: [string]) => { (window as any).__trouve('g5i').src = u }, [IMG])
        await page.waitForTimeout(500)
        const h = await page.evaluate(() => Math.round((window as any).__trouve('g5').getBoundingClientRect().height))
        assert.equal(h, 1000, 'figure agrandie par son image')
        await placer('g5', -60)
        assert.equal(await entree('g5'), true, '*ink : figure de 1000 px qui remplit l\'écran')
        assert.equal(await visibleEnfin('g5'), true, '*ink : opacité 1 après l\'entrée')
        await placer('g6', 444)
        await hauteur('g6', 1000)
        await page.waitForTimeout(350)
        await placer('g6', -60)
        assert.equal(await entree('g6'), true, '*fade : devenue 1000 px, remplit l\'écran')
        assert.equal(await visibleEnfin('g6'), true, '*fade : opacité 1 après l\'entrée')
      })

      it('le panneau d\'inspection change la part d\'une transition posée ; once: false', async function () {
        if (!present) { this.skip(); return }
        await ouvrir('v-reste')
        await placer('p1', 844 - 120)
        assert.equal(await entree('p1'), false, 'panneau : 60 % sous visible 100 %')
        await page.evaluate(() => { const w: any = window; w.µ._mjs_fxSet(w.__trouve('p1'), 'fade', { visible: 50 }) })
        await page.waitForTimeout(200)
        await placer('p1', 844 - 130)
        assert.equal(await entree('p1'), true, 'panneau : visible changé en 50 %, 65 % à l\'écran')
        await placer('o1', 844 - 190)
        const a = await entrees('o1')
        await placer('o1', 844 - 300)
        const b = await entrees('o1')
        await placer('o1', 2000)
        await placer('o1', 844 - 190)
        const c = await entrees('o1')
        await placer('o1', 300)
        const d = await entrees('o1')
        assert.deepEqual([a, b, c, d], [0, 1, 1, 2], 'once: false — entrées à 95 %, entière, sortie puis 95 %, entière')
      })

      it('une haute balise dont l\'effet tourne ne refait pas son observateur à chaque image', async function () {
        if (!present) { this.skip(); return }
        await ouvrir('v-tourne')
        await placer('s1', -100, 600)
        const go  = await page.evaluate(() => (window as any).__trouve('s1').style.getPropertyValue('--mjs-fx-spin-go'))
        const io0 = await page.evaluate(() => (window as any).__io)
        await page.waitForTimeout(1000)
        const io1 = await page.evaluate(() => (window as any).__io)
        console.log(`    [${nom}] *spin sur 2000 px, visible 50 %, en marche : ${io1 - io0} observateur(s) de vue créé(s) en 1 s`)
        assert.notEqual(go, 'none', 'l\'effet tourne')
        assert.ok(io1 - io0 <= 1, `${io1 - io0} observateurs créés en 1 s`)
      })

      for (const v of ['sans', 'avec']) it(`20 *fade et 20 *pulse ${v} visible : lectures de style et observateurs comptés`, async function () {
        if (!present) { this.skip(); return }
        await ouvrir('v-compte-' + v)
        const debut = await page.evaluate(() => [(window as any).__gcs, (window as any).__io, (window as any).__ro])
        for (let y = 0; y < 60; y++) {
          await page.evaluate(() => window.scrollBy(0, 157))
          await page.waitForTimeout(40)
        }
        await page.waitForTimeout(300)
        const fin = await page.evaluate(() => [(window as any).__gcs, (window as any).__io, (window as any).__ro])
        console.log(`    [${nom}] ${v} visible : montage ${debut[0]} lectures de style, ${debut[1]} observateurs de vue, ${debut[2]} de taille ; défilement (60 pas) +${fin[0] - debut[0]} lectures, +${fin[1] - debut[1]} observateurs de vue, +${fin[2] - debut[2]} de taille`)
        if (v === 'sans') assert.deepEqual([debut[1], fin[1], fin[2]], [40, 40, 0], 'sans visible : un observateur de vue par effet, aucun observateur de taille')
      })
    }))
  }
})
