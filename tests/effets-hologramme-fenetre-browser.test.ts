// *hologram, la fenêtre de l'illustration (`zone`), dans Chromium et Firefox réels : une forme CSS écrite telle quelle (inset, polygon,
// circle) découpe le reflet. Trois cartes se comparent pixel à pixel : la jumelle sans effet (T), la même carte au reflet sans fenêtre
// (S : le reflet entier) et la carte à fenêtre (A). Dans la fenêtre A vaut S, hors de la fenêtre A vaut T — et pour frame, sans masque, c'est
// l'inverse : A vaut T dans la fenêtre, S autour. Chaque rectangle mesuré doit être un endroit où le reflet se voit (S diffère de T), sans quoi
// l'égalité ne prouverait rien. Sans éclat sous la souris (`glare: false`) : seul le reflet découpé reste à voir.

import assert from 'node:assert/strict'
import { terminateSharedWorkerPool } from '../src/bundler/index.js'
import { navigateurPresent, construire, construireProd, ouvrir, type Construit } from './helpers/hologramme-zoom.js'

const REGLAGES = 'glare: false, shadow: false, on: always'
// un rectangle, un coin coupé en bas à gauche, un rond
const RECTANGLE = 'inset(10% 20% 30% 40%)'
const COIN      = 'polygon(10% 10%, 90% 10%, 90% 50%, 30% 50%, 10% 40%)'
const ROND      = 'circle(30% at 50% 40%)'

const STYLE = `<style>
.carte
  position: absolute
  width: 200px
  height: 280px
  background: linear-gradient(135deg, #2a4a6a, #7a5a9a)
.t
  left: 10px
  top: 10px
.a
  left: 230px
  top: 10px
.b
  left: 450px
  top: 10px
.c
  left: 670px
  top: 10px
.d
  left: 10px
  top: 310px
.e
  left: 230px
  top: 310px
.s
  left: 450px
  top: 310px
.u
  left: 670px
  top: 310px
button
  position: absolute
  left: 10px
  top: 600px
</style>`

const SOURCES = {
  'hf-page.mjs': `<div class="carte t"></div>
<div class="carte a" *hologram(curtain, zone: ${RECTANGLE}, ${REGLAGES})></div>
<div class="carte b" *hologram(curtain, zone: ${COIN}, ${REGLAGES})></div>
<div class="carte c" *hologram(curtain, zone: ${ROND}, ${REGLAGES})></div>
<div class="carte d" *hologram(frame, zone: ${RECTANGLE}, ${REGLAGES})></div>
<div class="carte e" *hologram(frame, zone: ${COIN}, ${REGLAGES})></div>
<div class="carte s" *hologram(curtain, ${REGLAGES})></div>
<div class="carte u" *hologram(frame, ${REGLAGES})></div>
${STYLE}`,
  'hf-variable.mjs': `<script>
$fenetre = 'inset(10% 60% 20% 0%)'
</script>
<div class="carte t"></div>
<div class="carte s" *hologram(curtain, ${REGLAGES})></div>
<div class="carte a" *hologram(curtain, zone: $fenetre, ${REGLAGES})></div>
<button class="bascule" @click={$fenetre = 'inset(10% 0% 20% 60%)'}>bascule</button>
${STYLE}`
}

// la part des pixels de chaque rectangle [x0, y0, x1, y1] (en px de la carte) qui diffèrent, de plus de 24 sur un canal, entre deux captures de même taille
async function ecarts(p: any, une: Buffer, autre: Buffer, rects: number[][]): Promise<number[]> {
  return p.evaluate(async ([ba, bb, rs]: [string, string, number[][]]) => {
    const lire = async (b64: string) => {
      const img = new Image()
      img.src = 'data:image/png;base64,' + b64
      await img.decode()
      const cv = document.createElement('canvas')
      cv.width = img.width
      cv.height = img.height
      const c = cv.getContext('2d') as CanvasRenderingContext2D
      c.drawImage(img, 0, 0)
      return { d: c.getImageData(0, 0, cv.width, cv.height).data, w: cv.width }
    }
    const x = await lire(ba)
    const y = await lire(bb)
    return rs.map(([x0, y0, x1, y1]) => {
      let n = 0
      let tot = 0
      for (let j = y0; j < y1; j++) {
        for (let i = x0; i < x1; i++) {
          const k = (j * x.w + i) * 4
          tot++
          if (Math.abs(x.d[k] - y.d[k]) > 24 || Math.abs(x.d[k + 1] - y.d[k + 1]) > 24 || Math.abs(x.d[k + 2] - y.d[k + 2]) > 24) n++
        }
      }
      return n / tot
    })
  }, [une.toString('base64'), autre.toString('base64'), rects])
}

// la production, une application par construction : le fichier de l'effet est trié d'après ses seules pages
const PROD = {
  rideau: { 'hf-rideau.mjs': `<div class="carte" *hologram(curtain, zone: ${RECTANGLE}, ${REGLAGES})></div>\n${STYLE}` },
  cadre:  { 'hf-cadre.mjs': `<div class="carte" *hologram(frame, zone: ${COIN}, ${REGLAGES})></div>\n${STYLE}` }
}

let compile: Promise<Construit> | null = null
const prod: Record<string, Promise<Construit>> = {}

for (const nom of ['chromium', 'firefox'] as const) {
  describe(`*hologram, la fenêtre d'une forme CSS (${nom} réel)`, function () {
    this.timeout(240000)
    let present = false
    let construit: Construit

    before(async function () {
      present = await navigateurPresent(nom)
      if (!present) {
        console.log(`  ℹ️  ${nom} non installé, test de la fenêtre sauté. Activer : \`npx playwright install ${nom}\``)
        return
      }
      compile ??= construire(SOURCES, 'effets-hologramme-fenetre-browser')
      construit = await compile
    })

    after(async () => { await terminateSharedWorkerPool() })

    // la page `tag` ouverte ; `ecart(une, autre, rects)` : la part des pixels qui diffèrent entre deux cartes, par rectangle
    async function avecPage(tag: string, essai: (p: any, ecart: (une: string, autre: string, rects: number[][]) => Promise<number[]>) => Promise<void>) {
      const playwright = await import('playwright')
      const browser = await playwright[nom].launch()
      try {
        const { p, erreurs } = await ouvrir(browser, construit, tag, { viewport: { width: 900, height: 640 } })
        const capture = async (s: string) => {
          const b = await p.evaluate(([t, k]: string[]) => {
            const r = ((document.querySelector(t) as any)._shadow.querySelector(k) as HTMLElement).getBoundingClientRect()
            return { x: r.left, y: r.top, width: r.width, height: r.height }
          }, [tag, s])
          return p.screenshot({ clip: b })
        }
        await essai(p, async (une, autre, rects) => ecarts(p, await capture(une), await capture(autre), rects))
        assert.deepEqual(erreurs, [])
      } finally {
        await browser.close()
      }
    }

    // la carte `sel` à fenêtre, et `plein` : la même carte sans fenêtre. `reflet` dit où le reflet doit briller, dans la fenêtre (curtain) ou autour (frame) :
    // là, `sel` vaut `plein` ; ailleurs, `sel` vaut la jumelle `.t` sans effet. `dedans` et `dehors` : des rectangles de la fenêtre et de ses abords
    async function decoupe(ecart: (une: string, autre: string, rects: number[][]) => Promise<number[]>, sel: string, plein: string, dedans: number[][], dehors: number[][], reflet: 'dedans' | 'dehors') {
      const [vu, vaut] = reflet === 'dedans' ? [dedans, dehors] : [dehors, dedans]
      // les rectangles sont des endroits où le reflet se voit : sans lui, la comparaison ne prouverait rien
      const force = await ecart(plein, '.t', [...dedans, ...dehors])
      force.forEach((v, i) => assert.ok(v >= 0.08, `rectangle ${i} : le reflet sans fenêtre y est visible (${(v * 100).toFixed(1)} % des pixels changés)`))
      const avecReflet = await ecart(sel, plein, vu)
      avecReflet.forEach((v, i) => assert.ok(v <= 0.002, `${reflet === 'dedans' ? 'dans' : 'autour de'} la fenêtre (rectangle ${i}) : la carte vaut le reflet entier, ${(v * 100).toFixed(1)} % des pixels changés`))
      const sans = await ecart(sel, '.t', vaut)
      sans.forEach((v, i) => assert.ok(v <= 0.002, `${reflet === 'dedans' ? 'hors de' : 'dans'} la fenêtre (rectangle ${i}) : la carte vaut la jumelle sans reflet, ${(v * 100).toFixed(1)} % des pixels changés`))
    }

    // les rectangles : des bandes où le reflet de curtain se voit (x de 0 à 60, de 80 à 140 et de 160 à 200), de la fenêtre et de ses abords
    it('inset : un rectangle — le reflet brille dans la fenêtre, et nulle part ailleurs', async function () {
      if (!present) { this.skip(); return }
      await avecPage('mjs-hf-page', async (_p, ecart) => {
        // la fenêtre : de 40 % à 80 % de la largeur (80 à 160 px), de 10 % à 70 % de la hauteur (28 à 196 px)
        await decoupe(ecart, '.a', '.s', [[88, 60, 152, 188]], [[0, 60, 72, 240], [168, 60, 200, 200], [72, 204, 168, 250]], 'dedans')
      })
    })

    it('polygon : un coin coupé — le coin reste net, le reste de la fenêtre brille', async function () {
      if (!present) { this.skip(); return }
      await avecPage('mjs-hf-page', async (_p, ecart) => {
        // les points : (20, 28) (180, 28) (180, 140) (60, 140) (20, 112) ; le coin coupé est le triangle en bas à gauche
        await decoupe(ecart, '.b', '.s', [[88, 40, 152, 130]], [[22, 128, 40, 138], [0, 150, 200, 250], [190, 40, 200, 200]], 'dedans')
      })
    })

    it('circle : une forme que clip-path accepte vaut pour la fenêtre', async function () {
      if (!present) { this.skip(); return }
      await avecPage('mjs-hf-page', async (_p, ecart) => {
        // le rayon : 30 % de la diagonale réduite (243 px), soit 73 px, autour du point (100, 112)
        await decoupe(ecart, '.c', '.s', [[70, 82, 130, 142]], [[0, 60, 24, 240], [176, 60, 200, 200], [0, 190, 200, 250]], 'dedans')
      })
    })

    it('frame, sans masque : tout brille sauf la fenêtre — un rectangle, un coin coupé', async function () {
      if (!present) { this.skip(); return }
      await avecPage('mjs-hf-page', async (_p, ecart) => {
        await decoupe(ecart, '.d', '.u', [[88, 60, 152, 188]], [[0, 60, 72, 240], [168, 60, 200, 200], [72, 204, 168, 250]], 'dehors')
        await decoupe(ecart, '.e', '.u', [[88, 40, 152, 130]], [[22, 128, 40, 138], [0, 150, 200, 250], [190, 40, 200, 200]], 'dehors')
      })
    })

    it('une forme tenue par une variable : la fenêtre suit sa valeur', async function () {
      if (!present) { this.skip(); return }
      await avecPage('mjs-hf-variable', async (p, ecart) => {
        // la première fenêtre : la bande de gauche (de 0 à 40 % de la largeur), la seconde : celle de droite (de 40 % à 100 %)
        const gauche = [[4, 64, 76, 216]]
        const droite = [[124, 64, 196, 216]]
        await decoupe(ecart, '.a', '.s', gauche, droite, 'dedans')
        await p.evaluate(() => ((document.querySelector('mjs-hf-variable') as any)._shadow.querySelector('.bascule') as HTMLElement).click())
        await p.waitForTimeout(600)
        await decoupe(ecart, '.a', '.s', droite, gauche, 'dedans')
      })
    })

    // la production : la fenêtre tient dans le fichier trié ; son contraire n'y est que pour frame
    for (const [quoi, tag, attendu] of [['curtain', 'mjs-hf-rideau', RECTANGLE], ['frame', 'mjs-hf-cadre', COIN]] as const) {
      it(`production, ${quoi} seul : la fenêtre ${quoi === 'curtain' ? 'découpe le reflet, sans son contraire' : 'et son contraire découpent le cadre'}`, async function () {
        if (!present) { this.skip(); return }
        const cle = quoi === 'curtain' ? 'rideau' : 'cadre'
        const app = await (prod[cle] ??= construireProd(PROD[cle], 'effets-hologramme-fenetre-prod-' + cle))
        const playwright = await import('playwright')
        const browser = await playwright[nom].launch()
        try {
          const { p, erreurs } = await ouvrir(browser, app, tag, { viewport: { width: 300, height: 320 } })
          const lu = await p.evaluate((t: string) => {
            const carte  = (document.querySelector(t) as any)._shadow.querySelector('.carte') as HTMLElement
            const calque = carte.querySelector('[mjs-fx-layer="hologram"]') as HTMLElement
            return { clip: calque.style.getPropertyValue('--mjs-fx-hologram-clip'), inv: calque.style.getPropertyValue('--mjs-fx-hologram-inv'), calcule: getComputedStyle(calque.querySelector('i') as HTMLElement).clipPath }
          }, tag)
          assert.equal(lu.clip, attendu, 'la forme écrite, telle quelle')
          if (quoi === 'curtain') {
            assert.equal(lu.inv, '', 'curtain seul : le contraire de la fenêtre n\'est pas dans le fichier')
            assert.match(lu.calcule, /^inset\(/, 'le reflet est découpé par la fenêtre')
          }
          else {
            assert.match(lu.inv, /^polygon\(evenodd,/, 'frame : le cadre percé de la fenêtre')
            assert.match(lu.calcule, /^polygon\(/, 'le reflet de frame est découpé par le contraire')
          }
          assert.deepEqual(erreurs, [])
        } finally {
          await browser.close()
        }
      })
    }
  })
}
