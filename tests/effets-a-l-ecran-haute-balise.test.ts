// `on: view` : une balise est vue quand 20 % d'elle est à l'écran, ou, plus haute que l'écran, quand
// elle en couvre 20 % — une balise de cinq écrans ne montre jamais 20 % d'elle-même (banc navigateur
// réel : tests/browser-smoke/effets-grande-balise.browser.mts). Ici, le critère seul, sur des entrées
// d'observateur telles qu'un navigateur les donne : happy-dom n'en calcule aucune.

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { Window } from 'happy-dom'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { stripEsm } from '../src/server/renderToString.js'
import { mjsTmp } from './helpers/tmp.js'

const COMPOSANTS: Record<string, string> = {
  'a-l-ecran': '<p class="t" *tracking>Un long texte</p>',
}

async function attendre(cond: () => boolean, ms = 3000) {
  const fin = Date.now() + ms
  while (!cond() && Date.now() < fin) await new Promise((r) => setTimeout(r, 10))
}

describe('on: view — vue par sa part, ou par la part de l\'écran qu\'elle couvre', function () {
  this.timeout(60000)
  let window: any
  const ios: any[] = []

  before(async () => {
    const root   = mjsTmp('a-l-ecran')
    const srcDir = join(root, 'src')
    const outDir = join(root, 'out')
    mkdirSync(srcDir, { recursive: true })
    for (const [nom, src] of Object.entries(COMPOSANTS)) writeFileSync(join(srcDir, nom + '.mjs'), src)
    const bundler = new Bundler({ sourceDir: srcDir, outputDir: outDir, manifestPath: join(root, 'bundle.js') })
    const stats   = await bundler.compile()
    assert.equal(stats.errors.length, 0, stats.errors.map((e: any) => e.message).join('\n'))
    await bundler.close()
    const files = readdirSync(outDir).filter((f) => f.endsWith('.js'))
    const rang  = (f: string) => f.startsWith('mjs_core') ? 0 : f.startsWith('mjs_') ? 1 : 2
    const code  = [...files].sort((a, b) => rang(a) - rang(b)).map((f) => stripEsm(readFileSync(join(outDir, f), 'utf-8'))).join('\n')
    window = new Window({ url: 'http://localhost/' })
    window.IntersectionObserver = class {
      cb: any; o: any; el: any = null
      constructor(cb: any, o: any) { this.cb = cb; this.o = o; ios.push(this) }
      observe(el: any) { this.el = el }
      disconnect() { this.el = null }
    }
    window.eval(`${code}\nglobalThis.µ = µ;`)
  })

  after(async () => {
    window?.close?.()
    await terminateSharedWorkerPool()
  })

  async function monter() {
    window.document.body.innerHTML = '<mjs-a-l-ecran></mjs-a-l-ecran>'
    const comp = window.document.querySelector('mjs-a-l-ecran')
    await attendre(() => !!comp._shadow?.querySelector('.t[mjs-fx]'))
    const t  = comp._shadow.querySelector('.t')
    const io = ios.filter((o) => o.el === t).pop()
    return { t, io }
  }

  // une entrée d'observateur : `h` px de la balise à l'écran, sur une balise de `total` px, un écran de 700 px
  const entree = (el: any, h: number, total: number) => ({ target: el, isIntersecting: h > 0, intersectionRatio: h / total, intersectionRect: { height: h }, rootBounds: { height: 700 } })

  it('balise de 5 000 px qui couvre la moitié de l\'écran : vue', async () => {
    const { t, io } = await monter()
    assert.equal(t.hasAttribute('mjs-fx-wait'), true)
    io.cb([entree(t, 350, 5000)])
    assert.equal(t.hasAttribute('mjs-fx-wait'), false)
  })

  it('balise de 5 000 px dont un pixel dépasse en bas de l\'écran : pas encore vue', async () => {
    const { t, io } = await monter()
    io.cb([entree(t, 1, 5000)])
    assert.equal(t.hasAttribute('mjs-fx-wait'), true)
    io.cb([entree(t, 140, 5000)])
    assert.equal(t.hasAttribute('mjs-fx-wait'), false, '20 % de l\'écran')
  })

  it('balise ordinaire : vue à 20 % d\'elle-même, comme avant', async () => {
    const { t, io } = await monter()
    io.cb([entree(t, 50, 300)])
    assert.equal(t.hasAttribute('mjs-fx-wait'), true)
    io.cb([entree(t, 60, 300)])
    assert.equal(t.hasAttribute('mjs-fx-wait'), false)
  })

  it('l\'observateur prévient par paliers sous 20 % : une très haute balise est suivie au fil du défilement', async () => {
    const { io } = await monter()
    const seuils: number[] = io.o.threshold
    assert.ok(Array.isArray(seuils) && seuils[0] === 0 && seuils.includes(0.2) && seuils.some((x) => x > 0 && x <= 0.01), JSON.stringify(seuils))
  })
})
