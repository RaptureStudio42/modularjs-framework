// Effets visuels — le travail épargné quand il ne se voit pas, sur de vrais composants compilés
// chargés dans happy-dom : *filter.lens n'écrit rien quand le pointeur est loin de la balise (sa loupe
// part d'un coup quand il s'en va) ; *grid(halo, needle) ne réécrit que les cases qui changent vraiment ; *goo(drip) ne fait
// pas couler de gouttes hors de l'écran ; *autosize ne mesure pas sa boîte quand seul le calque d'un
// effet change dedans (un compteur qui défile).

import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { Window } from 'happy-dom'
import { Bundler, terminateSharedWorkerPool } from '../src/bundler/index.js'
import { stripEsm } from '../src/server/renderToString.js'
import { mjsTmp } from './helpers/tmp.js'
import { mesurer } from './helpers/mesure-balise.js'
import { assertAbsent } from './helpers/dom-assert.js'

const COMPOSANTS: Record<string, string> = {
  'fx-loupe':    '<p class="l" *filter.lens>Un texte flou</p>',
  'fx-halo':     '<div class="h" *grid(halo)></div>',
  'fx-aiguille': '<div class="n" *grid(needle)></div>',
  'fx-goutte':   '<div class="g" *goo(drip, color: #f00)>Goutte</div>',
  'fx-boite':    '<div class="b" *autosize><span class="c" *count(on: click, duration: 1s)>12480</span></div>',
}

async function attendre(cond: () => boolean, ms = 3000) {
  const fin = Date.now() + ms
  while (!cond() && Date.now() < fin) await new Promise((r) => setTimeout(r, 10))
}

const pause = (ms = 20) => new Promise((r) => setTimeout(r, ms))

describe('effets visuels — le travail épargné quand il ne se voit pas', function () {
  this.timeout(60000)
  let window: any
  // les prototypes de happy-dom sont ceux de TOUTES les fenêtres : un bouchon posé dessus survit à `window.close()` et fausse les fichiers suivants du même processus — ce qu'ils portaient est gardé, puis rendu dans `after`
  const anciens: Array<[any, string, PropertyDescriptor | undefined]> = []
  const garder = (cible: any, noms: string[]) => { for (const nom of noms) anciens.push([cible, nom, Object.getOwnPropertyDescriptor(cible, nom)]) }

  before(async () => {
    const root   = mjsTmp('effets-economies')
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
    garder(window.HTMLElement.prototype, ['clientWidth', 'clientHeight'])
    // happy-dom ne met rien en page : le calque d'une grille prend 2000 × 1000 px (un fond de page),
    // pour avoir des cases
    const taille = (dim: string, v: number) => Object.defineProperty(window.HTMLElement.prototype, dim, { configurable: true, get() { return this.getAttribute('mjs-fx-layer') === 'grid' ? v : 0 } })
    taille('clientWidth', 2000)
    taille('clientHeight', 1000)
    // un IntersectionObserver qu'on déclenche à la main
    window.eval('globalThis.__ios = []; globalThis.IntersectionObserver = class { constructor(cb) { this.cb = cb; globalThis.__ios.push(this) } observe(el) { this.el = el } disconnect() { this.off = true } }')
    window.eval(`${code}\nglobalThis.µ = µ;`)
  })

  after(async () => {
    for (const [cible, nom, d] of anciens) {
      if (d) Object.defineProperty(cible, nom, d)
      else delete cible[nom]
    }
    window?.close?.()
    await terminateSharedWorkerPool()
  })

  async function monter(tag: string, sel: string) {
    window.document.body.innerHTML = `<${tag}></${tag}>`
    const comp = window.document.querySelector(tag)
    await attendre(() => !!comp._shadow?.querySelector(sel))
    await pause()
    return comp._shadow.querySelector(sel)
  }

  // les écritures d'attributs (style compris) sous `racine`, le temps de `f`
  async function ecritures(racine: any, f: () => Promise<void>, attrs?: string[]) {
    let n = 0
    const mo = new window.MutationObserver((l: any[]) => { n += l.length })
    mo.observe(racine, { attributes: true, subtree: true, ...(attrs ? { attributeFilter: attrs } : {}) })
    await f()
    await pause(5)
    mo.disconnect()
    return n
  }

  const bouger = async (x: number, y: number) => {
    window.document.dispatchEvent(new window.PointerEvent('pointermove', { clientX: x, clientY: y }))
    await pause(8)
  }

  it('*filter.lens : le pointeur loin de la balise, rien n\'est écrit ; près d\'elle la loupe se montre, puis part d\'un coup', async () => {
    const l    = await monter('mjs-fx-loupe', '.l')
    const tout = l.getRootNode()
    const zone = () => tout.querySelector('[mjs-fx-filter-lens]')
    // happy-dom ne met rien en page : la balise reçoit une boîte de 100 × 20 en (0, 0) ; la zone (200 px de diamètre) ne voit rien au-delà de 100 px
    mesurer(window, l, () => ({ left: 0, top: 0, right: 100, bottom: 20, width: 100, height: 20, x: 0, y: 0 }))
    const loin = await ecritures(tout, async () => { for (let i = 0; i < 20; i++) await bouger(600 + i * 5, 500) })
    assert.equal(loin, 0, `20 mouvements à 600 px de la balise : aucune écriture — vu : ${loin}`)
    assertAbsent(zone())
    await bouger(40, 10)
    await attendre(() => !!zone(), 500)
    assert.ok(zone(), 'près de la balise, la loupe se montre')
    await bouger(600, 500)
    await attendre(() => !zone(), 500)
    assertAbsent(zone(), 'le pointeur parti, la loupe s\'en va')
    await pause(450)
    const apres = await ecritures(tout, async () => { for (let i = 0; i < 10; i++) await bouger(620 + i * 5, 500) })
    assert.equal(apres, 0, 'puis plus rien')
  })

  for (const [nom, tag, sel] of [['halo', 'mjs-fx-halo', '.h'], ['needle', 'mjs-fx-aiguille', '.n']]) {
    it(`*grid(${nom}) : un pas de souris ne réécrit que les cases qui changent vraiment`, async () => {
      const g     = await monter(tag, sel)
      const cases = g.querySelectorAll('[mjs-fx-layer="grid"] i').length
      assert.ok(cases > 100, `une grille de 2000 × 1000 px : ${cases} cases`)
      const pointe = (x: number) => g.dispatchEvent(new window.PointerEvent('pointermove', { bubbles: true, clientX: x, clientY: 500 }))
      pointe(300)
      await pause(10)
      const n = await ecritures(g, async () => {
        for (let i = 1; i <= 10; i++) {
          pointe(300 + i * 10)
          await pause(8)
        }
      })
      assert.ok(n < cases * 10 / 2, `10 pas de 10 px : moins d'une case sur deux réécrite à chaque pas — ${n} écritures pour ${cases} cases`)
    })
  }

  it('*goo(drip) : hors de l\'écran, aucune goutte ; à l\'écran, elles coulent', async () => {
    const g   = await monter('mjs-fx-goutte', '.g')
    const io  = window.__ios.filter((o: any) => o.el === g && !o.off).pop()
    const gouttes = () => g.querySelectorAll('[mjs-fx-layer="goo"] i').length
    assert.ok(io, 'la balise est suivie à l\'écran')
    io.cb([{ target: g, isIntersecting: false }])
    g.querySelectorAll('[mjs-fx-layer="goo"] i').forEach((x: any) => x.remove())
    await pause(350)
    assert.equal(gouttes(), 0, 'hors de l\'écran : aucune goutte')
    io.cb([{ target: g, isIntersecting: true }])
    await attendre(() => gouttes() > 0, 1000)
    assert.ok(gouttes() > 0, 'revenue à l\'écran : les gouttes coulent')
  })

  it('*autosize : un compteur qui défile dedans ne fait pas mesurer la boîte à chaque image', async () => {
    const b = await monter('mjs-fx-boite', '.b')
    let mesures = 0
    const g = b.getBoundingClientRect.bind(b)
    b.getBoundingClientRect = () => { mesures++; return g() }
    b.querySelector('.c').click()
    await pause(500)
    assert.ok(mesures <= 3, `le compte défile dans son calque, la boîte ne change pas : ${mesures} mesures en 500 ms`)
  })
})
