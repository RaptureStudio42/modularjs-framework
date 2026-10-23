// *ink — une balise apparaît (ou disparaît) à travers un masque qui s'étale : vingt styles dessinés
// dans le navigateur, plus une image de masque à soi. Ce test couvre la compilation (écritures
// valides, refus), les cartes des vingt styles (valeurs 0..1, graine) et le repli en fondu quand il
// n'y a pas de toile 2D (happy-dom n'en a pas) : ni exception ni avertissement, rien ne reste sur la
// balise à la fin.

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { Window } from 'happy-dom'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { transpile } from '../src/transpiler/index.js'
import { stripEsm } from '../src/server/renderToString.js'
import { mjsTmp } from './helpers/tmp.js'

const STYLES = ['blots', 'brush', 'wash', 'smoke', 'drip', 'dots', 'shards', 'swirl', 'tear', 'burn', 'frost', 'rain', 'cells', 'cracks', 'ripple', 'scribble', 'petals', 'glitch', 'topo', 'maze']

const compiler = async (html: string) => (await transpile(html, { moduleName: 'fx-essai' })).output

async function attendre(cond: () => boolean, ms = 3000) {
  const fin = Date.now() + ms
  while (!cond() && Date.now() < fin) await new Promise((r) => setTimeout(r, 10))
}

describe('effets — *ink : la compilation', function () {
  this.timeout(60000)

  it('les écritures valides compilent', async () => {
    await compiler('<div *ink>x</div>')
    await compiler('<div *ink(brush, duration: 2s, direction: 45)>x</div>')
    await compiler('<div *ink(tear, direction: up-left, origin: top-left, soft: .2, count: 8, seed: 12, invert: true)>x</div>')
    await compiler('<script>\n$x = false\n</script>\n{if $x}<p @in=*ink(smoke) @out=*ink(tear)>texte</p>{end}')
    await compiler("<img src=\"a.png\" alt=\"a\" *ink(image: '/m.png', invert: true)>")
  })

  it('les vingt styles sont acceptés', async () => {
    assert.equal(STYLES.length, 20)
    for (const style of STYLES) await compiler(`<div *ink(${style})>x</div>`)
  })

  it('un style inconnu, un nombre trop grand ou une douceur trop forte sont refusés', async () => {
    await assert.rejects(compiler('<div *ink(nimporte)>x</div>'), /\*ink : style = nimporte — permis : 'blots' \| 'brush'.*'maze'/)
    await assert.rejects(compiler('<div *ink(count: 99)>x</div>'), /\*ink : count = 99/)
    await assert.rejects(compiler('<div *ink(soft: 2)>x</div>'), /\*ink : soft = 2/)
  })

  it('µasset(...) en réglage : l\'adresse du fichier, résolue au build', async () => {
    const js = (await transpile("<img src=\"a.png\" alt=\"a\" *ink(image: µasset('m.png'))>", { moduleName: 'fx-essai', resolveAsset: async (chemin: string) => '/assets/' + chemin.replace('.', '-abc123.') })).output
    assert.match(js, /"ink", \{"image":"\/assets\/m-abc123\.png"\}/)
  })
})

describe('effets — *ink : les cartes et le repli en fondu', function () {
  this.timeout(60000)
  let window: any
  let alertes: string[] = []
  let animateAvant: any

  before(async () => {
    const root   = mjsTmp('effets-encre-masque')
    const srcDir = join(root, 'src')
    const outDir = join(root, 'out')
    mkdirSync(srcDir, { recursive: true })
    writeFileSync(join(srcDir, 'fx-encre.mjs'), '<div class="a" *ink(on: load, duration: 60ms)>x</div>')
    const bundler = new Bundler({ sourceDir: srcDir, outputDir: outDir, manifestPath: join(root, 'bundle.js') })
    const stats   = await bundler.compile()
    assert.equal(stats.errors.length, 0, stats.errors.map((e: any) => e.message).join('\n'))
    await bundler.close()
    const files = readdirSync(outDir).filter((f) => f.endsWith('.js'))
    const rang  = (f: string) => f.startsWith('mjs_core') ? 0 : f.startsWith('mjs_') ? 1 : 2
    const code  = [...files].sort((a, b) => rang(a) - rang(b)).map((f) => stripEsm(readFileSync(join(outDir, f), 'utf-8'))).join('\n')
    window = new Window({ url: 'http://localhost/' })
    // happy-dom n'a pas animate() : le jeu image par image démarre quand il existe ; la classe Element est partagée par
    // toutes les fenêtres, le vrai animate (aucun sous happy-dom) est rendu après les tests
    animateAvant = window.Element.prototype.animate
    window.Element.prototype.animate = function () { return { cancel() {}, pause() {}, finished: Promise.resolve() } }
    window.eval(`${code}\nglobalThis.µ = µ;`)
    window.µ.warn = (...a: any[]) => { alertes.push(a.join(' ')) }
  })

  after(async () => {
    if (animateAvant === undefined) delete window?.Element?.prototype?.animate
    else if (window) window.Element.prototype.animate = animateAvant
    window?.close?.()
    await terminateSharedWorkerPool()
  })

  const carte = (style: string, seed: number) => window.µ.anim.ink.inkMap(style, 64, 40, { seed, angle: 90, ox: .5, oy: .5, count: 5 })

  for (const style of STYLES) {
    it(`${style} : une carte de valeurs entre 0 et 1, du 0 au 1, la même pour la même graine`, () => {
      const m = carte(style, 3)
      assert.equal(m.length, 64 * 40)
      let min = Infinity, max = -Infinity
      for (let i = 0; i < m.length; i++) {
        // la carte est en simple précision : le minimum ou le maximum peut déborder d'un milliardième
        assert.ok(m[i] >= -1e-6 && m[i] <= 1 + 1e-6, `valeur ${m[i]} hors de 0..1`)
        if (m[i] < min) min = m[i]
        if (m[i] > max) max = m[i]
      }
      assert.ok(Math.abs(min) < 1e-6, `minimum ${min}`)
      assert.ok(Math.abs(max - 1) < 1e-6, `maximum ${max}`)
      const b = carte(style, 3)
      for (let i = 0; i < m.length; i++) assert.equal(m[i], b[i])
    })
  }

  // dots et swirl sont des dessins sans hasard : leur carte ne dépend pas de la graine
  for (const style of STYLES.filter((s) => s !== 'dots' && s !== 'swirl')) {
    it(`${style} : une autre graine, une autre carte`, () => {
      const a = carte(style, 3)
      const b = carte(style, 4)
      let diff = 0
      for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) diff++
      assert.ok(diff > a.length / 10, `${diff} points différents seulement`)
    })
  }

  // un style que le moteur ne connaît pas retombe sur tear : chaque style a SA carte, distincte de toutes les autres
  it('les vingt styles dessinent vingt cartes distinctes', () => {
    const cartes = STYLES.map((s) => carte(s, 3))
    for (let i = 0; i < STYLES.length; i++) for (let j = i + 1; j < STYLES.length; j++) {
      let proche = 0
      for (let k = 0; k < cartes[i].length; k++) if (Math.abs(cartes[i][k] - cartes[j][k]) < 0.02) proche++
      assert.ok(proche < cartes[i].length * 0.5, `${STYLES[i]} et ${STYLES[j]} : ${(proche / cartes[i].length * 100).toFixed(0)} % de points à moins de 0,02 d'écart`)
    }
  })

  it('image: une adresse, ou l\'objet que rend µimage(...), donne l\'adresse à charger', () => {
    assert.equal(typeof window.µ._mjs_fxImage, 'function')
    const el = window.document.createElement('div')
    assert.equal(window.µ._mjs_fxImage('/m.png', el), '/m.png')
    // une balise sans mise en page : la largeur de la fenêtre fait foi (1024 ici), pas la plus petite variante
    assert.equal(window.µ._mjs_fxImage({ src: '/m-640.png', srcset: '/m-320.png 320w, /m-640.png 640w' }, el), '/m-640.png')
    // sans toile 2D, une image donnée en objet ne fait ni exception ni avertissement : le fondu
    alertes = []
    const cfg = window.µ.anim.ink({ image: { src: '/m.png' } }).intro(el)
    cfg.tick(0.5, 0.5)
    assert.equal(Number(el.style.opacity), 0.5)
    assert.deepEqual(alertes, [])
  })

  it('sans toile 2D : le fondu, sans exception ni avertissement, et rien ne reste sur la balise', () => {
    alertes = []
    const el = window.document.createElement('div')
    window.document.body.appendChild(el)
    const cfg = window.µ.anim.ink({ style: 'smoke' }).intro(el)
    assert.equal(cfg.duration, 1800)
    cfg.tick(0, 1)
    assert.equal(Number(el.style.opacity), 0)
    cfg.tick(0.5, 0.5)
    assert.equal(Number(el.style.opacity), 0.5)
    cfg.tick(1, 0)
    assert.equal(el.style.opacity, '')
    assert.equal(el.style.getPropertyValue('mask-image'), '')
    assert.equal(el.style.getPropertyValue('-webkit-mask-image'), '')
    assert.deepEqual(alertes, [])
  })

  it('le fondu rend les valeurs de style que la balise avait avant', () => {
    const el = window.document.createElement('div')
    el.style.opacity = '0.8'
    window.document.body.appendChild(el)
    const cfg = window.µ.anim.ink({}).intro(el)
    cfg.tick(0.3, 0.7)
    assert.equal(Number(el.style.opacity), 0.3)
    cfg.cleanup()
    assert.equal(el.style.opacity, '0.8')
  })

  it('posée sur une balise : joue, puis ne laisse ni opacité ni masque', async () => {
    alertes = []
    window.document.body.innerHTML = '<mjs-fx-encre></mjs-fx-encre>'
    const comp = window.document.querySelector('mjs-fx-encre')
    await attendre(() => !!comp._shadow?.querySelector('.a'))
    const a = comp._shadow.querySelector('.a')
    await new Promise((r) => setTimeout(r, 400))
    assert.equal(a.style.opacity, '')
    assert.equal(a.style.getPropertyValue('mask-image'), '')
    assert.deepEqual(alertes, [])
  })
})
